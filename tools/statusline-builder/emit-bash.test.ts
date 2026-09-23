/**
 * S5-T2.4（(internal design doc) §Verification 1/2/3）：
 * emit-bash 三層驗證——
 *   1. **黃金比對**（node，每-commit 迴歸主力）：`emitBash(config)` ===
 *      簽入 `__golden__/<name>.sh`（`toEqual(readFileSync)`；重生僅經
 *      `scripts/golden-statusline.mjs`／`npm run golden:update`，禁 CI／
 *      禁 snapshot API）。config 單一來源＝statusline-golden-configs.ts。
 *   2. **結構／契約斷言**（node）：jq 缺件守衛條件 emit、exit-0 不變量
 *      （禁 set -e、shell-out 防禦包裹、結尾 exit 0）、`printf '%s'` 負向
 *      不變量（使用者文字不進格式位）、escaping 單引號 context。
 *   3. **端到端 byte-exact**（真跑 bash＋jq；skipIf 環境缺件並輸出
 *      reason）：`emitBash(config)` 產出腳本真跑 → stdout 與
 *      `toAnsi(resolve(config, scenario))` byte-exact。含 SP-5 a/b/c×cap、
 *      滿配、escaping、CJK basename/tilde、dash 三態、全隱藏/空鏈。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { ColorSpec } from './color.js'
import type { BuilderConfig, SegmentConfig, SeparatorConfig } from './config.js'
import { toAnsi } from './emit-ansi.js'
import { emitBash, JQ_MISSING_HINT, type SegmentDescriptorCatalog } from './emit-bash.js'
import { cleanupOwnedJqDir, detectJq, type BashJqExec } from './exec-detect-test-utils.js'
import { MOCK_SCENARIOS_BY_ID, type MockScenarioId } from './mock-data.js'
import { resolve } from './resolve.js'
import { DESCRIPTORS_BY_ID, type StatusData } from './segments.js'
import { THRESHOLD_TEMPLATES } from './threshold.js'
import {
  GOLDEN_CASES,
  type ByteExactScenario,
} from '../../scripts/statusline-golden-configs.js'
import { MULTIROW_GOLDEN_CASES } from './multirow-golden-configs.js'

const CATALOG: SegmentDescriptorCatalog = DESCRIPTORS_BY_ID

// ── 1. 黃金比對 ──

const goldenPath = (name: string): string =>
  fileURLToPath(new URL(`./__golden__/${name}.sh`, import.meta.url))

describe('黃金比對（emitBash === __golden__/*.sh）', () => {
  it.each(GOLDEN_CASES.map((c) => [c.name, c] as const))(
    '%s',
    (name, testCase) => {
      const script = emitBash(testCase.config, CATALOG)
      const golden = readFileSync(goldenPath(name), 'utf8')
      // 失敗＝審 diff、勿盲目重生（npm run golden:update 僅供刻意變更後）。
      expect(script).toEqual(golden)
    },
  )

  it('黃金檔皆 LF、無 CR（Unix 可執行前提）', () => {
    for (const { name } of GOLDEN_CASES) {
      const bytes = readFileSync(goldenPath(name))
      expect(bytes.includes(0x0d), `${name} 含 CR`).toBe(false)
    }
  })
})

// MAGI code review 2026-07-11 Important #2（Fix 2）：4 個 multirow golden
// 先前僅由 T3.3 人審產出（scripts/golden-statusline.mjs／
// golden-statusline-ps1.mjs 各自 inline 定義），未被本檔黃金比對迴圈覆蓋
// ——emit 回歸不會轉紅。config 單一來源已收攏至 multirow-golden-configs.ts
// （bash／ps1 共用），此處補一個純 emit（不牽 bash 真執行）常駐比對迴圈。
describe('黃金比對（多列，emitBash === __golden__/multirow-*.sh；Fix 2）', () => {
  it.each(MULTIROW_GOLDEN_CASES.map((c) => [c.name, c] as const))('%s', (name, testCase) => {
    const script = emitBash(testCase.config, CATALOG)
    const golden = readFileSync(goldenPath(name), 'utf8')
    expect(script).toEqual(golden)
  })
})

// ── 局部 config 建構 helper（結構斷言＋byte-exact 額外組合用） ──

const A = (index: number): ColorSpec => ({ kind: 'ansi256', index })

function segT(id: string, over: Partial<SegmentConfig> = {}): SegmentConfig {
  return { id, enabled: true, icon: false, color: { kind: 'default' }, ...over }
}

function cfgT(mode: BuilderConfig['mode'], cap: boolean, segments: SegmentConfig[]): BuilderConfig {
  return {
    version: 2,
    mode,
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: cap,
    powerlineArrow: mode === 'powerline',
    segments,
  }
}

function mockScen(id: MockScenarioId): ByteExactScenario {
  const base = MOCK_SCENARIOS_BY_ID[id]
  return { data: JSON.parse(JSON.stringify(base.data)), shell: base.shell, env: base.env, now: base.now }
}

/** `mockScen` 派生＋原地突變（T4.3 新段測試：tokens 邊界／倒數過期等自訂資料點）。 */
function mockScenWith(id: MockScenarioId, mutate: (d: StatusData) => void): ByteExactScenario {
  const s = mockScen(id)
  mutate(s.data)
  return s
}

// ── 2. 結構／契約斷言 ──

describe('產生器契約（結構斷言）', () => {
  const jqConfig = cfgT('plain', true, [segT('model', { color: A(226) }), segT('cost')])
  const jqScript = emitBash(jqConfig, CATALOG)

  it('契約 1/7/9：input=$(cat)、ESC=$\\033、結尾 exit 0、無 set -e', () => {
    expect(jqScript).toContain('input=$(cat)')
    expect(jqScript).toContain("ESC=$'\\033'")
    expect(jqScript.trimEnd().endsWith('exit 0')).toBe(true)
    expect(jqScript).not.toMatch(/^\s*set -/m)
  })

  it('契約 2：有 jq 消費段 → emit `command -v jq` 守衛＋提示＋exit 0', () => {
    expect(jqScript).toContain('command -v jq')
    expect(jqScript).toContain(JQ_MISSING_HINT)
  })

  it('契約 2/10：純 shell-out config → 不 emit jq 守衛', () => {
    const clockOnly = cfgT('plain', true, [segT('clock', { color: A(33) })])
    const script = emitBash(clockOnly, CATALOG)
    expect(script).not.toContain('command -v jq')
    expect(script).not.toContain(JQ_MISSING_HINT)
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })

  it('契約 9：shell-out 段防禦包裹 `2>/dev/null || true`', () => {
    const shellCfg = cfgT('plain', true, [
      segT('git-branch'),
      segT('git-dirty'),
      segT('clock'),
    ])
    const script = emitBash(shellCfg, CATALOG)
    expect(script).toContain('git branch --show-current 2>/dev/null || true')
    expect(script).toContain('git status --porcelain 2>/dev/null || true')
    expect(script).toContain('date +%H:%M 2>/dev/null || true')
  })

  it('契約 6 負向：所有 printf 皆 `printf \'%s\'`（使用者文字不進格式位）', () => {
    const escCfg = GOLDEN_CASES.find((c) => c.name === 'escaping')!.config
    for (const script of [jqScript, emitBash(escCfg, CATALOG)]) {
      expect(script.match(/printf (?!'%s')/g)).toBeNull()
      expect(script).toContain(`printf '%s' "$out"`)
    }
  })

  it('契約 6：使用者前綴／自訂分隔符走單引號 context（`\'`→`\'\\\'\'`）', () => {
    const escScript = emitBash(GOLDEN_CASES.find((c) => c.name === 'escaping')!.config, CATALOG)
    // custom separator `'` → SEP=''\'''
    expect(escScript).toContain("SEP=''\\'''")
    // prefix `'$(x)` → '\''$(x)'（$(…) 在單引號 context 不展開）
    expect(escScript).toContain("'\\''$(x)'")
  })

  it('未知 segment id → TypeError（對齊 resolve；config 應先清洗）', () => {
    const bad = cfgT('plain', true, [segT('no-such-segment')])
    expect(() => emitBash(bad, CATALOG)).toThrow(TypeError)
  })

  it('全停用 config → 空鏈骨架（仍 printf/exit 0）', () => {
    const empty = cfgT('plain', true, [])
    const script = emitBash(empty, CATALOG)
    expect(script).toContain('texts=()')
    expect(script).toContain(`printf '%s' "$out"`)
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })
})

// ── D1 gating（powerlineArrow × lastArrowCap 四組合） ──

describe('D1 gating（powerlineArrow × lastArrowCap，emit-bash）', () => {
  const segs = [segT('model', { color: A(226) }), segT('git-dirty', { color: A(196) })]
  const pa = (lastArrowCap: boolean, powerlineArrow: boolean): BuilderConfig => ({
    ...cfgT('powerline', lastArrowCap, segs),
    powerlineArrow,
  })

  it.each([true, false])(
    'powerlineArrow=false（lastArrowCap=%s 無效）：無 ARROW 變數、無段間箭頭、無 cap 區塊、每段 value 補右側空格',
    (lastArrowCap) => {
      const script = emitBash(pa(lastArrowCap, false), CATALOG)
      expect(script).not.toContain('ARROW=')
      expect(script).not.toContain('$ARROW')
      expect(script).not.toContain('if [ "$n" -gt 0 ]; then') // cap 區塊專屬結構
      // 每段 value 尾綴一格空白：一般段 "$v "、dirty 段字面 '<icon>*<pad>'。
      expect(script).toContain('"$v "')
      expect(script).toContain("'* '") // git-dirty：head=''、字面 '*'+pad → '* '
    },
  )

  it.each([true, false])(
    'powerlineArrow=true（lastArrowCap=%s）：有 ARROW 變數、cap 區塊依 lastArrowCap、value 無 padding',
    (lastArrowCap) => {
      const script = emitBash(pa(lastArrowCap, true), CATALOG)
      expect(script).toContain('ARROW=')
      expect(script).toContain('$ARROW')
      expect(script.includes('if [ "$n" -gt 0 ]; then')).toBe(lastArrowCap)
      expect(script).not.toContain('"$v "')
    },
  )

  it('padding 只在 powerline＋powerlineArrow=false 生效；plain 模式不受影響', () => {
    const plainScript = emitBash(cfgT('plain', true, segs), CATALOG)
    expect(plainScript).toContain('"$v"')
    expect(plainScript).not.toContain('"$v "')
  })
})

// ── T3.1 多列：emit 期依 row 分組 → 執行期四步展開（PLAN §shell 端執行期展開語意） ──

describe('多列（T3.1：emit-bash 執行期四步展開，結構斷言）', () => {
  const twoRowPlain = cfgT('plain', true, [
    segT('model', { color: A(226), row: 0 }),
    segT('cost', { color: A(220), row: 1 }),
  ])
  const script = emitBash(twoRowPlain, CATALOG)

  it('步驟 1：逐列緩衝——各列各自宣告獨立陣列變數（texts_N/fgs_N/segstart_N），依列序 emit', () => {
    const idxTexts0 = script.indexOf('texts_0=()')
    const idxTexts1 = script.indexOf('texts_1=()')
    expect(idxTexts0).toBeGreaterThan(-1)
    expect(idxTexts1).toBeGreaterThan(-1)
    expect(idxTexts0).toBeLessThan(idxTexts1)
    expect(script).toContain('fgs_0=()')
    expect(script).toContain('fgs_1=()')
    // plain 模式：segstart_N（無 bgs_N，powerline 專屬）。
    expect(script).toContain('segstart_0=()')
    expect(script).toContain('segstart_1=()')
    expect(script).not.toContain('bgs_0=()')
    // 單列扁平變數（texts=()／不帶列尾碼）不應出現在多列腳本。
    expect(script).not.toMatch(/\btexts=\(\)/)
  })

  it('步驟 2：runtime 空列過濾——依各列存活計數（n_N）條件性收進 outs，不吐空行', () => {
    expect(script).toContain('outs=()')
    expect(script).toContain('if [ "$n_0" -gt 0 ]; then outs+=("$out_0"); fi')
    expect(script).toContain('if [ "$n_1" -gt 0 ]; then outs+=("$out_1"); fi')
  })

  it('步驟 3：存活列以 LF 串接、reset 恆在 LF 之前（各列 out_N 本身已含尾端 reset）', () => {
    expect(script).toContain('out_0+="${ESC}[0m"')
    expect(script).toContain('out_1+="${ESC}[0m"')
    expect(script).toContain(`out+=$'\\n'`)
  })

  it('步驟 4：零存活列退化——outs 為空時 out 直接賦值單一 SGR reset', () => {
    expect(script).toContain('if [ "${#outs[@]}" -eq 0 ]; then')
    expect(script).toContain('out="${ESC}[0m"')
  })

  it('段落順序正確：逐列緩衝（texts_0…texts_1）先於逐列 join（out_0…out_1）、join 先於過濾＋LF 串接', () => {
    const buffer0 = script.indexOf('texts_0=()')
    const buffer1 = script.indexOf('texts_1=()')
    const join0 = script.indexOf('out_0=""')
    const join1 = script.indexOf('out_1=""')
    const filter = script.indexOf('outs=()')
    expect(buffer0).toBeLessThan(buffer1)
    expect(buffer1).toBeLessThan(join0)
    expect(join0).toBeLessThan(join1)
    expect(join1).toBeLessThan(filter)
  })

  it('列內分隔符只作用於該列緩衝：SEP 插入條件式各自引用該列 segstart_N（不跨列）', () => {
    expect(script).toContain('[ "${segstart_0[$i]}" = "1" ]')
    expect(script).toContain('[ "${segstart_1[$i]}" = "1" ]')
    expect(script).not.toContain('[ "${segstart[$i]}" = "1" ]')
  })

  it('列內 cap 只作用於該列緩衝（powerline＋cap）：cap 區塊各自引用該列 bgs_N/n_N', () => {
    const twoRowPowerline = cfgT('powerline', true, [
      segT('model', { color: A(226), row: 0 }),
      segT('cost', { color: A(220), row: 1 }),
    ])
    const psScript = emitBash(twoRowPowerline, CATALOG)
    expect(psScript).toContain('if [ "$n_0" -gt 0 ]; then')
    expect(psScript).toContain('if [ "$n_1" -gt 0 ]; then')
    expect(psScript).toContain('${bgs_0[$((n_0 - 1))]}')
    expect(psScript).toContain('${bgs_1[$((n_1 - 1))]}')
    expect(psScript).not.toContain('if [ "$n" -gt 0 ]; then')
  })

  it('三列 config：非連續 row 值（5,0,2）壓縮為 3 個緩衝區塊（texts_0/_1/_2），無 texts_3', () => {
    const threeRow = cfgT('plain', true, [
      segT('model', { color: A(226), row: 5 }),
      segT('cost', { color: A(220), row: 0 }),
      segT('duration', { color: A(45), row: 2 }),
    ])
    const s = emitBash(threeRow, CATALOG)
    expect(s).toContain('texts_0=()')
    expect(s).toContain('texts_1=()')
    expect(s).toContain('texts_2=()')
    expect(s).not.toContain('texts_3=()')
  })

  it('產出腳本 no-CR（plain／powerline 皆同，既有慣例沿用）', () => {
    expect(script.includes('\r')).toBe(false)
    const psScript = emitBash(
      cfgT('powerline', true, [
        segT('model', { color: A(226), row: 0 }),
        segT('cost', { color: A(220), row: 1 }),
      ]),
      CATALOG,
    )
    expect(psScript.includes('\r')).toBe(false)
  })

  it('契約 6/9 維持：printf \'%s\' "$out"、結尾 exit 0', () => {
    expect(script).toContain(`printf '%s' "$out"`)
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })
})

describe('單列退化（T3.1：emit 期分組壓縮為 1 列 → 扁平結構逐位元組不變）', () => {
  it('同 row 顯式值與缺 row（隱式 0）皆視為單列：不 emit 任何多列標記，且兩者產出逐位元組相同', () => {
    const sameRowExplicit = cfgT('plain', true, [
      segT('model', { color: A(226), row: 0 }),
      segT('cost', { color: A(220), row: 0 }),
    ])
    const noRow = cfgT('plain', true, [segT('model', { color: A(226) }), segT('cost', { color: A(220) })])
    for (const cfg of [sameRowExplicit, noRow]) {
      const s = emitBash(cfg, CATALOG)
      expect(s).toContain('texts=()')
      expect(s).not.toMatch(/texts_\d/)
      expect(s).not.toContain('outs=()')
      expect(s).not.toMatch(/out_\d/)
    }
    // 分組鍵 `seg.row ?? 0` 同構：顯式 row:0 與缺 row 產出逐位元組相同。
    expect(emitBash(sameRowExplicit, CATALOG)).toEqual(emitBash(noRow, CATALOG))
  })

  it('單一啟用段亦視為單列（0 或 1 個分組桶皆走扁平路徑）：不 emit 多列標記', () => {
    const single = cfgT('plain', true, [segT('model', { color: A(226) })])
    const s = emitBash(single, CATALOG)
    expect(s).not.toMatch(/texts_\d/)
    expect(s).not.toContain('outs=()')
  })

  it('黃金比對套件（既有 GOLDEN_CASES，皆單列 config）已於本檔頂部驗證逐位元組不變；此處另證扁平路徑未洩漏多列標記', () => {
    for (const { name, config } of GOLDEN_CASES) {
      const s = emitBash(config, CATALOG)
      expect(s, `${name} 不應含多列標記`).not.toMatch(/texts_\d/)
    }
  })
})

// ── T1.4（09-PLAN §D1 A-4）：emit-bash 逐列分隔符（SEP_k 展開）＋
// no-override fast path ──

describe('逐列分隔符（T1.4：emit-bash SEP_k 展開，結構斷言）', () => {
  const threeRowSegs = [
    segT('model', { color: A(226), row: 0 }),
    segT('cost', { color: A(220), row: 1 }),
    segT('duration', { color: A(45), row: 2 }),
  ]

  it('no-override fast path：rowSeparators 缺席（多列）→ 單一 SEP= 宣告，逐位元組同改動前；不含 SEP_0', () => {
    const noField = cfgT('plain', true, threeRowSegs)
    const script = emitBash(noField, CATALOG)
    // 單一全域宣告：恰一個 `SEP=` 開頭行。
    const sepDeclLines = script.split('\n').filter((l) => /^SEP[=_]/.test(l))
    expect(sepDeclLines).toEqual([`SEP='|'`])
    expect(script).not.toContain('SEP_0')
    expect(script).not.toContain('SEP_1')
    expect(script).not.toContain('SEP_2')
    // joinPlain 三列皆引用 bare $SEP／${SEP}（不含底線尾碼）。
    expect(script).toContain('"$SEP"')
    expect(script).toContain('${SEP}')
  })

  it('no-override fast path：rowSeparators 全 null（多列）→ 與缺席欄位產出逐位元組相同', () => {
    const noField = cfgT('plain', true, threeRowSegs)
    const allNull: BuilderConfig = { ...noField, rowSeparators: [null, null, null] }
    expect(emitBash(allNull, CATALOG)).toEqual(emitBash(noField, CATALOG))
  })

  it('多列＋第 2 列（index 1）覆寫：逐列 SEP_k 展開，未覆寫列退全域值，joinPlain 各自引用對應列', () => {
    const overridden: BuilderConfig = {
      ...cfgT('plain', true, threeRowSegs),
      rowSeparators: [null, { kind: 'preset', value: '·' }, null],
    }
    const script = emitBash(overridden, CATALOG)
    // 三列皆宣告（未覆寫列退全域 '|'，覆寫列用 '·'）。
    expect(script).toContain(`SEP_0='|'`)
    expect(script).toContain(`SEP_1='·'`)
    expect(script).toContain(`SEP_2='|'`)
    // 不再有 bare 全域宣告／引用殘留。
    expect(script).not.toMatch(/^SEP='/m)
    expect(script).not.toContain('"$SEP"')
    expect(script).not.toContain('${SEP}')
    // joinPlain 逐列引用各自的 SEP_k（順序：row0→row1→row2，且各自對應）。
    expect(script).toContain('[ -n "$SEP_0" ]')
    expect(script).toContain('${ESC}[0m${SEP_0}')
    expect(script).toContain('[ -n "$SEP_1" ]')
    expect(script).toContain('${ESC}[0m${SEP_1}')
    expect(script).toContain('[ -n "$SEP_2" ]')
    expect(script).toContain('${ESC}[0m${SEP_2}')
    // 段落序：row 1 的 join 區塊須引用 segstart_1（不跨列，同 T3.1 既有斷言精神）。
    expect(script).toContain('[ "${segstart_1[$i]}" = "1" ]')
  })

  it('單列路徑＋列 0 覆寫：SEP（非 SEP_0）直接綁覆寫值', () => {
    const singleRowSegs = [segT('model', { color: A(226) }), segT('cost', { color: A(220) })]
    const overridden: BuilderConfig = {
      ...cfgT('plain', true, singleRowSegs),
      rowSeparators: [{ kind: 'preset', value: '·' }],
    }
    const script = emitBash(overridden, CATALOG)
    expect(script).toContain(`SEP='·'`)
    expect(script).not.toContain('SEP_0')
    expect(script).not.toContain('SEP_1')
    // 單列扁平路徑：join 引用仍是 bare $SEP／${SEP}。
    expect(script).toContain('"$SEP"')
    expect(script).toContain('${SEP}')
  })

  it('custom 覆寫含單引號等需逸出字元：bashSingleQuote 正確逸出（`\'`→`\'\\\'\'`）', () => {
    const overridden: BuilderConfig = {
      ...cfgT('plain', true, threeRowSegs),
      rowSeparators: [null, { kind: 'custom', value: "'" }, null],
    }
    const script = emitBash(overridden, CATALOG)
    // bashSingleQuote("'") === `''\'''`（既有「契約 6」escaping 案同一逸出規則）。
    expect(script).toContain(`SEP_1=''\\'''`)
  })

  it('powerline 模式零觸碰：rowSeparators 有值時不 emit 任何 SEP 相關宣告／引用', () => {
    const overridden: BuilderConfig = {
      ...cfgT('powerline', true, threeRowSegs),
      rowSeparators: [null, { kind: 'preset', value: '·' }, null],
    }
    const script = emitBash(overridden, CATALOG)
    expect(script).not.toContain('SEP')
  })
})

// ── T1.6（09-PLAN §D1 golden 策略）：rowSeparators 對 powerline 惰性——
// 機械證據 ──
//
// 「既有 powerline golden 檔全數零 diff」無法在測試內直接比對「舊版黃金
// bytes」（測試沒有歷史參照）；改為機械化的**間接證明**：powerline 分支
// 對 `config.rowSeparators` 零觸碰（見 emitBash 主體 `if (config.mode ===
// 'plain')` 區塊——powerline 段落完全不讀此欄），故對任一既有 powerline
// config 塞入（無論何值）rowSeparators，emitBash 產出必須逐位元組不變。
// 這正是「rowSeparators schema 落地後既有 8 個 powerline golden 檔（.sh）
// 恆凍結」的機械擔保——不需，也無法，直接比對「golden:update 前後」的
// bytes（該比對屬人審 `git diff --stat` 稽核，見 T1.6-report.md）。
describe('rowSeparators 對 powerline 惰性（T1.6 機械證據；既有 powerline golden .sh 零 diff 佐證）', () => {
  const GARBAGE_ROW_SEPS: (SeparatorConfig | null)[] = [
    { kind: 'custom', value: '###' },
    { kind: 'preset', value: '·' },
    null,
  ]

  it('單列來源（GOLDEN_CASES）：明列 6 個 powerline case，帶 rowSeparators 塞值 vs 不帶，emitBash 產出逐位元組相同', () => {
    const powerlineCases = GOLDEN_CASES.filter((c) => c.config.mode === 'powerline')
    // 明列既有 6 個單列 powerline golden 案名（若此清單漂移，需連動更新
    // T1.6-report.md 與下方多列清單合計「8 檔」的稽核佐證）。
    expect(powerlineCases.map((c) => c.name).sort()).toEqual(
      [
        'sp5-a-powerline',
        'sp5-b-powerline',
        'powerline-rich',
        'powerline-noarrow',
        'bar-auto-powerline-arrow',
        'bar-auto-powerline-noarrow',
      ].sort(),
    )
    for (const { name, config } of powerlineCases) {
      const withSeps: BuilderConfig = { ...config, rowSeparators: GARBAGE_ROW_SEPS }
      expect(emitBash(withSeps, CATALOG), `${name}：帶 rowSeparators 不應改變 powerline 輸出`).toEqual(
        emitBash(config, CATALOG),
      )
    }
  })

  it('多列來源（MULTIROW_GOLDEN_CASES）：明列 2 個 powerline case（合計 8 檔），帶 rowSeparators 塞值 vs 不帶，emitBash 產出逐位元組相同', () => {
    const powerlineCases = MULTIROW_GOLDEN_CASES.filter((c) => c.config.mode === 'powerline')
    expect(powerlineCases.map((c) => c.name).sort()).toEqual(
      ['multirow-powerline', 'multirow-powerline-noarrow'].sort(),
    )
    for (const { name, config } of powerlineCases) {
      const withSeps: BuilderConfig = { ...config, rowSeparators: GARBAGE_ROW_SEPS }
      expect(emitBash(withSeps, CATALOG), `${name}：帶 rowSeparators 不應改變 powerline 輸出`).toEqual(
        emitBash(config, CATALOG),
      )
    }
  })
})

// ── T4.3：bar／auto／tokens／倒數（結構斷言；不牽真執行，恆跑） ──

describe('bar（結構斷言）', () => {
  it('plain：bar 段 push 4 元素（segstart 1/0/0/0），非 4 段獨立 push 亦非單元素合併', () => {
    const cfg = cfgT('plain', true, [
      segT('context-used', { icon: true, prefix: 'ctx:', bar: true, threshold: THRESHOLD_TEMPLATES.traffic }),
    ])
    const s = emitBash(cfg, CATALOG)
    expect(s).toContain(`segstart+=(1)`)
    expect(s).toContain(`segstart+=(0)`)
    expect(s).toContain(`filled+=`)
    expect(s).toContain(`empty+=`)
    expect(s).toContain('█')
    expect(s).toContain('░')
  })

  it('powerline：bar 段併單一累加器元素（btext 變數；run2-4 各自烘 reset+fg+bg，非 4 次獨立 push）', () => {
    const cfg = cfgT('powerline', true, [
      segT('context-used', { bar: true, threshold: THRESHOLD_TEMPLATES.traffic }),
    ])
    const s = emitBash(cfg, CATALOG)
    expect(s).toContain('btext=')
    expect(s).toContain('btext+="$filled"')
    expect(s).toContain('btext+="$empty"')
    expect(s).toContain('texts+=("$btext")')
    // 併元素：M6 C2（撤除舊「null 退單 run」分支）起不論死活恆走同一
    // btext 組裝路徑，故僅一次 push（"$btext"）——非逐 run push、亦非
    // 死活兩條互斥 push 路徑（舊版兩路徑各自一次 push、總計 2 次；C2 起
    // 死活合流，僅 1 次）。
    const texPushes = s.match(/texts\+=\(/g) ?? []
    expect(texPushes.length).toBe(1)
  })

  it('threshold===undefined：filled／value 退段主色（bfg 靜態指派，非陣列索引）', () => {
    const cfg = cfgT('plain', true, [segT('context-remaining', { bar: true, color: A(240) })])
    const s = emitBash(cfg, CATALOG)
    expect(s).not.toContain('idx=')
    expect(s).toContain(`bfg='38;5;240'`)
  })

  it('bar null 退化（M6 C2：不再退單 run，恆 4-run；value 部＝NA_TEXT）：powerline 停用 fgOverride，恆用 autoFg，非 fgOverride', () => {
    const cfg = cfgT('powerline', true, [
      segT('rate-5h', { bar: true, color: A(240), fgOverride: A(93) }),
    ])
    const s = emitBash(cfg, CATALOG)
    expect(s).toContain(`if [ -z "$v" ]; then`)
    expect(s).toContain(`bval='(n/a)'`)
    // fgOverride(93) 不應出現在 bar 段（停用），autoFg(240) 應出現。
    expect(s).not.toContain('38;5;93')
  })
})

describe('auto 配色（結構斷言）', () => {
  it('model 段：bash case 大小寫敏感前綴（claude-fable-*／claude-opus-*／claude-haiku-*／收尾 *）', () => {
    const cfg = cfgT('plain', true, [segT('model', { color: { kind: 'auto' } })])
    const s = emitBash(cfg, CATALOG)
    expect(s).toContain('case "$ackey" in')
    expect(s).toContain('claude-fable-*)')
    expect(s).toContain('claude-opus-*)')
    expect(s).toContain('claude-haiku-*)')
    expect(s).toContain("acfg='38;5;214'") // fable→214
    expect(s).toContain("acfg='38;5;135'") // opus→135
    expect(s).toContain("acfg='38;5;2'") // haiku→2
    expect(s).toContain("acfg='38;5;6'") // fallback→6
  })

  it('effort 段：精確字面比對（low/medium/high/xhigh/max＋收尾 *）、比對來源＝主值本身（無獨立 key jqPath）', () => {
    const cfg = cfgT('plain', true, [segT('effort', { color: { kind: 'auto' } })])
    const s = emitBash(cfg, CATALOG)
    expect(s).toContain('ackey=$(jq -r \'.effort.level // empty\'')
    expect(s).toContain('low)')
    expect(s).toContain('medium)')
    expect(s).toContain('high)')
    expect(s).toContain('xhigh)')
    expect(s).toContain('max)')
    expect(s).toContain("acfg='38;5;9'") // 未知→9
  })

  it('powerline＋fgOverride：auto tail 仍查表，但 fg 走 fgOverride 靜態字面（非 acautofg 變數）', () => {
    const cfg = cfgT('powerline', true, [
      segT('effort', { color: { kind: 'auto' }, fgOverride: A(201) }),
    ])
    const s = emitBash(cfg, CATALOG)
    expect(s).toContain("'38;5;201'")
    expect(s).not.toContain('$acautofg')
  })

  it('bar／auto 互斥：auto 段不落入 emitBarSegment（案例本身即證——effort 非 percentage 類、無 bar 分支結構）', () => {
    const cfg = cfgT('plain', true, [segT('effort', { color: { kind: 'auto' } })])
    const s = emitBash(cfg, CATALOG)
    expect(s).not.toContain('bfg=')
  })
})

describe('tokens 縮寫（結構斷言）', () => {
  it('token-in／token-out：dash 分派（nullPolicy 驅動，非 percentage category）＋ tokens jq 縮寫鏈', () => {
    const cfg = cfgT('plain', true, [segT('token-in', {}), segT('token-out', {})])
    const s = emitBash(cfg, CATALOG)
    expect(s).toContain('.context_window.current_usage.input_tokens')
    expect(s).toContain('.context_window.current_usage.output_tokens')
    // dash 分派：`// "--"` 而非 `// empty`（token 段不隱藏，null 顯 '--'）。
    expect(s.match(/current_usage\.input_tokens \/\/ "--"/)).not.toBeNull()
    expect(s).toContain('"k"')
    expect(s).toContain('if . < 1000 then tostring')
  })
})

describe('倒數段（reset-5h／reset-7d；結構斷言）', () => {
  it('全 jq pipeline：S2 now idiom＋localtime|strftime＋通用死值規則（非 id 特判，兩段同一模板）', () => {
    const cfg = cfgT('plain', true, [segT('reset-5h', {}), segT('reset-7d', {})])
    const s = emitBash(cfg, CATALOG)
    expect(s).toContain('STATUSLINE_NOW_EPOCH // empty | tonumber?')
    // (internal design doc)：`$now` 綁定式外層括號（jq 1.7.x／
    // 1.8.x `// ... as $x` 運算子優先序歧義修正，見 emit-bash.ts nowAndR
    // 檔頭註解）；HH:MM／MM:DD 改走 `localtime | strftime(fmt)`（jq 1.6+
    // 通用 idiom，`strflocaltime` builtin 之展開，輸出恆等）。
    expect(s).toContain('(now | floor)) as $now')
    expect(s).toContain('localtime | strftime("%H:%M")')
    expect(s).toContain('localtime | strftime("%m/%d %H:%M")')
    expect(s).not.toContain('strflocaltime')
    expect(s).toContain('$now >= $r')
    expect(s).toContain('↺')
    // 通用死值規則：兩段皆用同一 jqResetCountdown* 模板（零 id 特判）——
    // 出現次數與段數一致，非各自客製字串。
    expect(s.match(/\(\$r \| type\) != "number"\) or \(\$now >= \$r\)/g)?.length).toBe(2)
  })

  it('hide 政策：與其餘 conditional 段同構（`if [ -n "$v" ]` 剔空，非 dash "--"）', () => {
    const cfg = cfgT('plain', true, [segT('reset-5h', {})])
    const s = emitBash(cfg, CATALOG)
    expect(s).toContain('if [ -n "$v" ]; then')
    expect(s).not.toContain('reset-5h // "--"')
  })
})

// ── 3. 端到端 byte-exact（真跑 bash＋jq） ──

// sprint 17 D5：探測收斂至 exec-detect-test-utils.ts（`detectJq`；原本檔
// `detectRealExec` 複本已移除）。win32 leg 只認 `SP5_JQ_DIR`（目錄內 jq.exe
// 或 jq-windows-amd64.exe 皆接受，一律複製為暫存目錄下的 jq.exe、`owned:true`），
// 未設即 skip（reason 字面 `SP5_JQ_DIR 未設`）；非 win32 走 PATH `jq --version`。
// `SP5_BASH` 覆寫語意不變；bash 候選改由 env 推導（見 helper `bashCandidates`）。
// (internal design doc) 的單步定位結論仍成立：win32 leg 的 jq 與 PATH
// 內容無關（恆吃 `jqDir` 內複本），本機雙 jq 版本矩陣驗證以切換 `SP5_JQ_DIR` 達成。
const REAL_EXEC: BashJqExec = detectJq()
const scriptDir = REAL_EXEC.ok ? mkdtempSync(join(tmpdir(), 'sl-sh-')) : ''

afterAll(() => {
  // 只刪 helper 建立的暫存 jq 複本（`owned`）；永不碰 `SP5_JQ_DIR` 來源目錄。
  cleanupOwnedJqDir(REAL_EXEC)
})
let scriptSeq = 0

/** 移除 env 中所有大小寫變體的 path 鍵後設單一 PATH（Windows env 大小寫不敏）。 */
function withPath(env: NodeJS.ProcessEnv, newPath: string): NodeJS.ProcessEnv {
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === 'path') delete env[k]
  }
  env.PATH = newPath
  return env
}

/**
 * `strictPath`＝true 時 PATH **嚴格等於** `jqDir`（不附加系統 PATH）——
 * 供「PATH 無 jq」的負向情境使用（契約 2），對齊呼叫端「PATH 僅空目錄」
 * 的測試語意；預設 false 維持一般 byte-exact combo 現行行為（`jqDir` 前
 * 綴系統 PATH，令 `cat` 等一般工具仍可用）。環境洩漏修復：本機系統 PATH
 * 含 scoop jq shim，非嚴格模式下「emptyDir＋系統 PATH」會意外命中系統
 * jq，令契約 2 假陰性通過真輸出分支而非提示分支（sp5 時代機器無此洩漏，
 * 僥倖通過）。bash 以絕對路徑 spawn、不依賴 PATH 尋找自身，嚴格 PATH 下
 * `cat` 亦缺（`command -v jq` 之前的 `input=$(cat)` 找不到 `cat`、失敗但
 * 非致命——無 `set -e`，input 空、無害），僅 `command -v jq` 找不到 jq→
 * 印 JQ_MISSING_HINT、exit 0，與契約 2 語意一致。
 */
function runScript(
  script: string,
  stdinJson: string,
  home: string,
  jqDir: string | undefined,
  strictPath = false,
  extraEnv: Readonly<Record<string, string>> = {},
): { status: number | null; stdout: Buffer; stderr: string } {
  if (!REAL_EXEC.ok) throw new Error('runScript called without real-exec')
  const scriptPath = join(scriptDir, `sl-${scriptSeq++}.sh`)
  writeFileSync(scriptPath, script) // emitBash 已 LF、無 BOM
  // MSYS_NO_PATHCONV：Git Bash（win32 leg）呼叫原生 jq.exe 時，MSYS 執行期
  // 會把看似 Unix 路徑的引數（tilde 的 `--arg home /home/alan`）改寫成 Windows
  // 路徑，令 jq 內 $home ≠ mock home、tilde 前綴比對失敗。真 POSIX 目標無此
  // 轉換；設此旗標令 win32 測試 leg 與 POSIX 引數傳遞等價（非 win32 上為無害
  // 空操作）。bash 本身的 $HOME 不受影響（env 變數不經引數轉換）。
  let env: NodeJS.ProcessEnv = { ...process.env, HOME: home, MSYS_NO_PATHCONV: '1', ...extraEnv }
  if (jqDir !== undefined) {
    env = withPath(env, strictPath ? jqDir : jqDir + delimiter + (process.env.PATH ?? ''))
  }
  const r = spawnSync(REAL_EXEC.bash, [scriptPath], { input: Buffer.from(stdinJson, 'utf8'), env })
  return {
    status: r.status,
    stdout: r.stdout ?? Buffer.alloc(0),
    stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8'),
  }
}

interface ByteExactCombo {
  name: string
  config: BuilderConfig
  scenario: ByteExactScenario
}

/** byte-exact 組合＝黃金（有 scenario）＋cap 兩態＋c powerline＋CJK＋dash 三態＋空鏈。 */
function buildByteExactCombos(): ByteExactCombo[] {
  const combos: ByteExactCombo[] = []
  for (const c of GOLDEN_CASES) {
    if (c.scenario !== undefined) combos.push({ name: c.name, config: c.config, scenario: c.scenario })
  }
  const byName = (n: string) => GOLDEN_CASES.find((c) => c.name === n)!
  // cap 兩態（powerline 黃金翻 lastArrowCap）。
  for (const n of ['sp5-a-powerline', 'sp5-b-powerline', 'powerline-rich']) {
    const c = byName(n)
    combos.push({
      name: `${n}-nocap`,
      config: { ...c.config, lastArrowCap: !c.config.lastArrowCap },
      scenario: c.scenario!,
    })
  }
  // c 情境 powerline 兩態（EARLY：prefix＋icon 段 value null → 整段剔除）。
  for (const cap of [true, false]) {
    combos.push({
      name: `sp5-c-powerline-${cap ? 'cap' : 'nocap'}`,
      config: cfgT('powerline', cap, [
        segT('model', { color: A(226) }),
        segT('session-name', { prefix: '[s]', icon: true, color: A(99) }),
        segT('cost', { color: A(16) }),
      ]),
      scenario: mockScen('early-null'),
    })
  }
  // CJK 路徑：basename（反斜線 regex）＋tilde（home≠前綴 passthrough）。
  combos.push({
    name: 'basename-cjk',
    config: cfgT('plain', true, [segT('cwd', { variant: 'basename', color: A(45) })]),
    scenario: mockScen('windows-cjk'),
  })
  combos.push({
    name: 'tilde-cjk',
    config: cfgT('plain', true, [segT('cwd', { variant: 'tilde', color: A(45) })]),
    scenario: mockScen('windows-cjk'),
  })
  // dash 三態（rate-7d 無閾值）：數值（FULL 21%）／dash（conditional-absent 缺 rate_limits）。
  combos.push({
    name: 'pct-nothreshold',
    config: cfgT('plain', true, [segT('rate-7d', { color: A(99) })]),
    scenario: mockScen('full'),
  })
  combos.push({
    name: 'dash-nothreshold',
    config: cfgT('plain', true, [segT('rate-7d', { color: A(99) })]),
    scenario: mockScen('conditional-absent'),
  })
  // 全隱藏 → 空鏈（plain／powerline 皆單一 reset）。
  combos.push({
    name: 'all-hidden-plain',
    config: cfgT('plain', true, [segT('session-name', { color: A(99) })]),
    scenario: mockScen('conditional-absent'),
  })
  combos.push({
    name: 'all-hidden-powerline',
    config: cfgT('powerline', true, [segT('session-name', { color: A(99) })]),
    scenario: mockScen('conditional-absent'),
  })
  // 空 config（0 段）→ 空鏈。
  combos.push({
    name: 'empty-config',
    config: cfgT('plain', true, []),
    scenario: mockScen('full'),
  })
  // resets 後綴（percent-reset variant；M6 C3 升級倒數形）：三後端同 idiom
  // （jq jqResetSuffix5h/7d／ps1 對應／oracle resetsAtSuffix），同機同刻
  // pin（STATUSLINE_NOW_EPOCH=scenario.now，見下方 runScript 呼叫）
  // byte-exact。FULL five_hour.resets_at=now+2h（number）→ ` ↺ 2h
  // (HH:MM)`；涵蓋 plain 無閾值／powerline 交接／plain 閾值分裂（後綴隨
  // 值色）／dash+後綴正交（used=null→'(n/a) ↺ 2h (HH:MM)'，M6 C1+C3
  // 合流）／後綴過期但 rate 段本體仍存活（M6 C3 死值規則，只剔後綴、非
  // 整段剔除）。
  const TRAFFIC = THRESHOLD_TEMPLATES.traffic
  combos.push({
    name: 'rate-reset-plain',
    config: cfgT('plain', true, [segT('rate-5h', { variant: 'percent-reset', color: A(99) })]),
    scenario: mockScen('full'),
  })
  combos.push({
    name: 'rate-reset-powerline',
    config: cfgT('powerline', true, [
      segT('model', { color: A(226) }),
      segT('rate-5h', { variant: 'percent-reset', color: A(99) }),
    ]),
    scenario: mockScen('full'),
  })
  combos.push({
    name: 'rate-reset-threshold',
    config: cfgT('plain', true, [
      segT('rate-5h', {
        variant: 'percent-reset',
        prefix: 'R',
        icon: true,
        color: A(214),
        threshold: TRAFFIC,
      }),
    ]),
    scenario: mockScen('full'),
  })
  // dash+後綴正交：used_percentage=null（→ NA_TEXT）但 resets_at 仍為 number。
  const dashReset = mockScen('full')
  dashReset.data.rate_limits!.five_hour!.used_percentage = null
  combos.push({
    name: 'rate-reset-dash',
    config: cfgT('plain', true, [segT('rate-5h', { variant: 'percent-reset', color: A(99) })]),
    scenario: dashReset,
  })
  // M6 C3 死值規則（已過期）：resets_at 為 number 但 `now >= resets_at`
  // ——後綴剔除為 ''，rate 段本體（主值百分比）仍存活，區別於倒數段
  // （reset-5h/7d）expiresAtPath 的整段剔除語意（見下方獨立 describe）。
  const expiredReset = mockScen('full')
  expiredReset.data.rate_limits!.five_hour!.resets_at = expiredReset.now - 5
  combos.push({
    name: 'rate-reset-expired',
    config: cfgT('plain', true, [segT('rate-5h', { variant: 'percent-reset', color: A(99) })]),
    scenario: expiredReset,
  })
  // bar × dash × percent-reset 正交（M6 C2+C3 合流）：主值 null（NA_TEXT、
  // bn=0）但後綴獨立存活（`sfx` 於 `emitBarSegment` 恆在 if/else 之前
  // 計算，見該函式文件）。
  const barDashReset = mockScen('full')
  barDashReset.data.rate_limits!.five_hour!.used_percentage = null
  combos.push({
    name: 'bar-dash-percent-reset',
    config: cfgT('plain', true, [
      segT('rate-5h', { bar: true, variant: 'percent-reset', color: A(88) }),
    ]),
    scenario: barDashReset,
  })
  // Important 3（CR4）＋SP-0 拆段：對稱「全段」真執行案——鏡像 emit-ps1.test.ts。
  // 把 22 個非 shell-out stdin 段放一個 config，對 {full, windows-cjk, early-null} 三
  // 情境 byte-exact 比對 toAnsi(resolve())。worktree 為唯一手寫 jq fallback
  // （`.workspace.git_worktree // .worktree.name`），本案驗兩路徑：full 走
  // workspace.git_worktree、windows-cjk 走 worktree.name；worktree-branch（SP-0
  // 拆段新增，`.worktree.branch`）於 full／windows-cjk 皆有值、early-null 缺席剔段。
  const segF = (id: string, over: Partial<SegmentConfig> = {}): SegmentConfig =>
    segT(id, { icon: true, ...over })
  const fullBehaviorConfig = cfgT('plain', true, [
    segF('model', { color: A(75) }),
    segF('cwd', { variant: 'tilde', prefix: '@' }),
    segF('project-dir'),
    segF('output-style'),
    segF('version', { prefix: 'v' }),
    segF('cost', { color: A(220) }),
    segF('duration'),
    segF('lines-changed'),
    segF('context-size'),
    segF('thinking'),
    segF('context-used', { threshold: TRAFFIC, prefix: "it's " }),
    segF('context-remaining'),
    segF('rate-5h', { variant: 'percent-reset' }),
    segF('rate-7d', { variant: 'percent-reset' }),
    segF('session-name', { prefix: '$(x)' }),
    segF('effort'),
    segF('vim-mode'),
    segF('agent-name'),
    segF('pr'),
    segF('repo'),
    segF('worktree'),
    segF('worktree-branch'),
  ])
  for (const sid of ['full', 'windows-cjk', 'early-null'] as const) {
    combos.push({ name: `full-behavior/${sid}`, config: fullBehaviorConfig, scenario: mockScen(sid) })
  }
  // T3.1（非必須，額外真跑信心）：兩列 config 真執行對 oracle byte-exact；
  // 全景多列場景（三列、非末列全滅、全列全滅）留待 T3.3
  // pipeline.integration，本任務單元測試已把展開結構釘住（見上方描述區塊）。
  combos.push({
    name: 'two-row-plain',
    config: cfgT('plain', true, [
      segT('model', { color: A(75), row: 0 }),
      segT('cost', { color: A(220), row: 1 }),
    ]),
    scenario: mockScen('full'),
  })
  combos.push({
    name: 'two-row-powerline',
    config: cfgT('powerline', true, [
      segT('model', { color: A(75), row: 0 }),
      segT('cost', { color: A(220), row: 1 }),
    ]),
    scenario: mockScen('full'),
  })

  // ── T4.3：bar（percentage 類 seg.bar===true；sp4/REPORT.md 41-案 recipe） ──
  combos.push({
    name: 'bar-plain-threshold',
    config: cfgT('plain', true, [
      segT('context-used', {
        icon: true,
        prefix: 'ctx',
        bar: true,
        threshold: THRESHOLD_TEMPLATES.traffic,
        color: A(240),
      }),
    ]),
    scenario: mockScen('full'), // used_percentage=42.5
  })
  combos.push({
    name: 'bar-plain-nothreshold',
    config: cfgT('plain', true, [segT('context-remaining', { bar: true, color: A(45) })]),
    scenario: mockScen('full'), // remaining_percentage=57.5，退段主色（無 idx 查表）
  })
  combos.push({
    name: 'bar-powerline-threshold-cap',
    config: cfgT('powerline', true, [
      segT('model', { color: A(226) }),
      segT('context-used', {
        bar: true,
        threshold: THRESHOLD_TEMPLATES.traffic,
        color: A(240),
        fgOverride: A(93), // bar 停用 fgOverride——byte-exact 若誤用會轉紅
      }),
    ]),
    scenario: mockScen('full'),
  })
  combos.push({
    name: 'bar-powerline-noarrow',
    config: {
      ...cfgT('powerline', true, [
        segT('model', { color: A(226) }),
        segT('context-used', { bar: true, threshold: THRESHOLD_TEMPLATES.traffic, color: A(240) }),
      ]),
      powerlineArrow: false,
    },
    scenario: mockScen('full'),
  })
  combos.push({
    name: 'bar-dash-plain',
    config: cfgT('plain', true, [segT('rate-5h', { bar: true, color: A(88) })]),
    scenario: mockScen('early-null'), // rate_limits 缺席 → 主值 undefined → dash
  })
  combos.push({
    name: 'bar-dash-powerline-cap',
    config: cfgT('powerline', true, [segT('rate-5h', { bar: true, color: A(88), fgOverride: A(93) })]),
    scenario: mockScen('early-null'),
  })
  combos.push({
    name: 'bar-percent-reset',
    config: cfgT('plain', true, [
      segT('rate-5h', {
        bar: true,
        variant: 'percent-reset',
        color: A(88),
        threshold: THRESHOLD_TEMPLATES.traffic,
      }),
    ]),
    scenario: mockScen('full'),
  })
  combos.push({
    name: 'bar-0-pct',
    config: cfgT('plain', true, [segT('context-used', { bar: true, color: A(200) })]),
    scenario: mockScenWith('conditional-absent', (d) => {
      d.context_window.used_percentage = 0
    }),
  })
  combos.push({
    name: 'bar-100-pct',
    config: cfgT('powerline', true, [segT('context-used', { bar: true, color: A(200) })]),
    scenario: mockScenWith('conditional-absent', (d) => {
      d.context_window.used_percentage = 100
    }),
  })

  // ── T4.3：auto 配色（model／effort；PLAN Rev4 §3 色票，bash case 大小寫敏感） ──
  combos.push({
    name: 'auto-model-fable-plain',
    config: cfgT('plain', true, [segT('model', { color: { kind: 'auto' } })]),
    scenario: mockScen('full'), // model.id='claude-fable-5' → 214
  })
  combos.push({
    name: 'auto-model-opus-powerline-cap',
    config: cfgT('powerline', true, [segT('model', { color: { kind: 'auto' } })]),
    scenario: mockScen('windows-cjk'), // model.id='claude-opus-4-8' → 135
  })
  combos.push({
    name: 'auto-model-haiku-plain',
    config: cfgT('plain', true, [segT('model', { color: { kind: 'auto' } })]),
    scenario: mockScen('conditional-absent'), // model.id='claude-haiku-4-5-20251001' → 2
  })
  combos.push({
    name: 'auto-model-fallback-plain',
    config: cfgT('plain', true, [segT('model', { color: { kind: 'auto' } })]),
    scenario: mockScen('early-null'), // model.id='claude-sonnet-5' → fallback 6
  })
  combos.push({
    name: 'auto-effort-plain',
    config: cfgT('plain', true, [segT('effort', { color: { kind: 'auto' }, icon: true })]),
    scenario: mockScen('full'), // effort.level='high' → 4
  })
  combos.push({
    name: 'auto-effort-powerline-fgoverride',
    config: cfgT('powerline', true, [segT('effort', { color: { kind: 'auto' }, fgOverride: A(201) })]),
    scenario: mockScen('windows-cjk'), // effort.level='medium' → tail=2、fg=fgOverride(201)
  })
  combos.push({
    name: 'auto-effort-unknown-fallback',
    config: cfgT('plain', true, [segT('effort', { color: { kind: 'auto' } })]),
    scenario: mockScenWith('full', (d) => {
      d.effort = { level: 'ultra' } // 未知值 → fallback 9
    }),
  })

  // ── T4.3：tokens 縮寫（token-in／token-out；dash 政策，nullPolicy 驅動） ──
  combos.push({
    name: 'tokens-full-plain',
    config: cfgT('plain', true, [segT('token-in', { color: A(80) }), segT('token-out', { color: A(81) })]),
    scenario: mockScen('full'), // input=52341→"52.3k"、output=8123→"8.1k"
  })
  combos.push({
    name: 'tokens-full-powerline',
    config: cfgT('powerline', true, [segT('model', { color: A(226) }), segT('token-in', { color: A(80) })]),
    scenario: mockScen('full'),
  })
  combos.push({
    name: 'tokens-dash-null',
    config: cfgT('plain', true, [segT('token-in', { color: A(80) }), segT('token-out', { color: A(81) })]),
    scenario: mockScen('early-null'), // current_usage=null → '--'
  })
  combos.push({
    name: 'tokens-boundary-999',
    config: cfgT('plain', true, [segT('token-in', { color: A(80) })]),
    scenario: mockScenWith('full', (d) => {
      d.context_window.current_usage!.input_tokens = 999 // <1000 原整數字串
    }),
  })
  combos.push({
    name: 'tokens-boundary-1000',
    config: cfgT('plain', true, [segT('token-in', { color: A(80) })]),
    scenario: mockScenWith('full', (d) => {
      d.context_window.current_usage!.input_tokens = 1000 // 邊界 →"1.0k"
    }),
  })
  combos.push({
    name: 'tokens-large-no-M-upgrade',
    config: cfgT('plain', true, [segT('token-in', { color: A(80) })]),
    scenario: mockScenWith('full', (d) => {
      d.context_window.current_usage!.input_tokens = 1500000 // 僅 k 檔，不升 M →"1500.0k"
    }),
  })

  return combos
}

/**
 * (internal design doc)：實測消費端真正呼叫到的 jq 二進位版本
 * （非僅印路徑）——CI log 可稽，杜絕下次 jq 1.7.x／1.8.x 版本分岔盲飛
 * （本 hotfix 起因即 CI ubuntu leg 內建 jq 1.7.x 與本機 1.8.1 分岔卻無
 * log 線索）。win32：`jqDir` 恆非 undefined（helper 暫存複本），二進位固定名 `jq.exe`；
 * 非 win32：`jqDir` 為 undefined 時吃繼承 PATH 的 `jq`。
 */
function probeJqVersion(): string {
  if (!REAL_EXEC.ok) return '(n/a)'
  const jqCmd = REAL_EXEC.jqDir !== undefined ? join(REAL_EXEC.jqDir, 'jq.exe') : 'jq'
  const r = spawnSync(jqCmd, ['--version'])
  if (r.error !== undefined || r.status !== 0) {
    return `(探測失敗：${r.error?.message ?? `exit ${String(r.status)}`})`
  }
  return (r.stdout ?? Buffer.alloc(0)).toString('utf8').trim()
}

// skip 時輸出 reason（PLAN §CI skipIf 不變量：skip 須有理由；本測本機在則跑，
// CI ubuntu/windows leg 亦應為假——恆真死測由 T2.7 harness 的 meta 斷言把關）。
//
// ── skipIf meta（(internal design doc) T2.1・T2.2：CI 跨後端 gate 守門，
//    08 DRIFT 同族合帳） ──
//
// T2.1 真值表（CI 兩 leg 由 test.yml＋exec-detect-test-utils.ts `detectJq`
// 邏輯推導，標「推導」；完整逐環境對照落 (internal design doc)；
// sprint 17 D5 起 win32 只認 `SP5_JQ_DIR`）：
//   | gate                   | 本機 win32 | CI ubuntu | CI windows |
//   |-------------------------|-----------|-----------|------------|
//   | REAL_EXEC.ok（bash+jq） | 依 SP5_JQ_DIR：設且有效→true／未設→false | true（推導：Ensure jq step） | false（推導：SP5_JQ_DIR 未設） |
// 本檔僅 bash＋jq 一路（無 ps1 概念）——windows leg 恆假即整份「端到端
// byte-exact」「T4.3 倒數段」兩個 describe.skipIf 區塊於該 leg 恆靜默跳過
// （既有刻意拓撲，見 test.yml 檔頭註解；非 bug）；ubuntu leg 為該 leg 唯一
// 真執行載重，present 卻 skip＝bug。
it('端到端 byte-exact 環境自述', () => {
  if (!REAL_EXEC.ok) {
    console.warn(`[emit-bash] 端到端 byte-exact 跳過：${REAL_EXEC.reason}`)
  } else {
    console.warn(
      `[emit-bash] 端到端 byte-exact 啟用：bash=${REAL_EXEC.bash} jqDir=${REAL_EXEC.jqDir ?? '(系統 PATH)'} jqVersion=${probeJqVersion()}`,
    )
  }
  expect(true).toBe(true)
})

describe('skipIf meta（T2.2；REAL_EXEC 拓撲守門——本檔僅 bash＋jq 一路，無 ps1）', () => {
  // GITHUB_ACTIONS 辨識現在跑在哪個 leg；本機無此 env，if 條件不觸發下列
  // 斷言本體（本機 win32 設 SP5_JQ_DIR 時若誤觸發會因 REAL_EXEC.ok 為 true
  // 而翻紅，見 DONE 報告「非恆真紅證」段落）。
  const isCi = process.env.GITHUB_ACTIONS === 'true'
  const isWin = process.platform === 'win32'

  it('ubuntu leg（CI 非 win32）：bash+jq 為該 leg 唯一真執行載重，present 卻 skip＝bug（不得靜默跳過）', () => {
    if (isCi && !isWin) {
      expect(
        REAL_EXEC.ok,
        `ubuntu leg REAL_EXEC.ok 應為 true；若 skip：${REAL_EXEC.ok ? '' : (REAL_EXEC as { reason: string }).reason}`,
      ).toBe(true)
    }
  })

  it('windows leg（CI）：REAL_EXEC.ok 依既有刻意拓撲恆假（SP5_JQ_DIR 未設）——鎖住此拓撲、reason 須為已知原因', () => {
    // 鎖住現況（非鎖死改動）：若未來拓撲改變（CI 誤設 SP5_JQ_DIR），本斷言會
    // 翻紅逼出人工覆核並更新 T2.1 真值表——而非讓本檔兩個 describe.skipIf 區塊悄悄從「windows
    // leg 不可跑」變成「可跑」卻無人知曉（或反之，悄悄失去該 leg 覆蓋）。
    if (isCi && isWin) {
      expect(
        REAL_EXEC.ok,
        'windows leg REAL_EXEC.ok 預期為 false（SP5_JQ_DIR 未設）；若為 true 代表拓撲已改變，需人工覆核並更新 WORKS 真值表' +
          '（或本機誤設 GITHUB_ACTIONS env——非 CI 環境請先 unset 再判斷）',
      ).toBe(false)
      // reason 字串全集（exec-detect-test-utils.ts `EXEC_DETECT_REASONS`，
      // `detectJq` win32 分支可能產生）：
      //   - 'Git Bash 不存在（SP5_BASH 可指定；PATH 上的 bash 可能為 WSL 不可用）'（bash 二進位未偵得）
      //   - 'SP5_JQ_DIR 未設'（CI windows leg 現行既有拓撲之預期落點）
      //   - 'SP5_JQ_DIR 指定目錄無 jq.exe／jq-windows-amd64.exe'（顯式設定但該目錄缺 jq）
      // 下方 regex 只鎖「未設」一者（sprint 17 D5 收緊）：CI 不應設 SP5_JQ_DIR，
      // 設了卻指錯目錄同屬拓撲改變、應翻紅。
      if (!REAL_EXEC.ok) {
        expect(
          (REAL_EXEC as { reason: string }).reason,
          `windows leg REAL_EXEC skip 理由須匹配已知原因，實際：${(REAL_EXEC as { reason: string }).reason}`,
        ).toMatch(/^SP5_JQ_DIR 未設/)
      }
    }
  })
})

describe.skipIf(!REAL_EXEC.ok)('端到端 byte-exact（bash＋jq 真執行）', () => {
  const jqDir = REAL_EXEC.ok ? REAL_EXEC.jqDir : undefined
  const combos = buildByteExactCombos()

  it.each(combos.map((c) => [c.name, c] as const))('%s', (_name, combo) => {
    const script = emitBash(combo.config, CATALOG)
    const oracle = Buffer.from(toAnsi(resolve(combo.config, combo.scenario)), 'utf8')
    const stdin = JSON.stringify(combo.scenario.data)
    // M6 T6.2（C3）：percent-reset 變體的倒數後綴現依賴 `$now`（jq S2
    // idiom）——顯式釘 `STATUSLINE_NOW_EPOCH=scenario.now`（與 oracle 的
    // `resolve(..., scenario)` 同一 now 來源），避免 bash 端落回真時鐘
    // 與 oracle 的固定 mock now 不同刻而假陽性失敗（沿下方「T4.3 倒數段」
    // 描述區塊已建立的 pin-now 慣例；非倒數段的 jq 程式不讀此 env，無害）。
    const r = runScript(script, stdin, combo.scenario.env.home, jqDir, false, {
      STATUSLINE_NOW_EPOCH: String(combo.scenario.now),
    })
    expect(r.status, `非零 exit；stderr=${r.stderr}`).toBe(0)
    // hex 比對＝可讀 diff；byte-exact 命中 oracle（emit-ansi.toAnsi）。
    expect(r.stdout.toString('hex')).toBe(oracle.toString('hex'))
  })

  it('契約 2：jq 缺件（PATH 無 jq）→ 提示字串＋exit 0', () => {
    const config = cfgT('plain', true, [segT('model', { color: A(226) })])
    const script = emitBash(config, CATALOG)
    const emptyDir = mkdtempSync(join(tmpdir(), 'sl-nojq-'))
    // PATH 僅空目錄（strictPath＝true，不附加系統 PATH——見 runScript 文件：
    // 本機系統 PATH 含 scoop jq shim，非嚴格模式會意外命中而假陰性通過）：
    // command -v jq 找不到（cat 亦缺 → input 空、無害），走提示分支。
    const r = runScript(script, JSON.stringify(mockScen('full').data), '/home/x', emptyDir, true)
    expect(r.status).toBe(0)
    expect(r.stdout.toString('utf8')).toBe(JQ_MISSING_HINT)
  })
})

// ── T4.3：倒數段（reset-5h／reset-7d）端到端 byte-exact ──
//
// sp6/REPORT.md 定案「同機 oracle」體制：oracle（toAnsi(resolve(...))）與
// bash 產出腳本皆於同一測試進程／同一時刻執行期即時算 now，天然一致、不
// 釘 CI 時區。本區塊更進一步——顯式將 `STATUSLINE_NOW_EPOCH` 注入 bash
// 子行程（值＝scenario.now，與 oracle 的 ResolveInput.now 同一來源），令
// 兩側 now 完全相同（非僅「同機同刻」的近似一致），徹底排除次毫秒級時序
// race，同時是 S2 idiom「合法整數注入」分支的真執行覆蓋。
describe.skipIf(!REAL_EXEC.ok)('T4.3 倒數段（reset-5h／reset-7d；STATUSLINE_NOW_EPOCH 顯式釘 now）', () => {
  const jqDir = REAL_EXEC.ok ? REAL_EXEC.jqDir : undefined

  interface ResetCombo {
    name: string
    config: BuilderConfig
    scenario: ByteExactScenario
  }

  const fullNow = mockScen('full').now

  const combos: ResetCombo[] = [
    {
      name: 'reset-5h-hours-plain',
      config: cfgT('plain', true, [segT('reset-5h', { color: A(99) })]),
      scenario: mockScen('full'), // five_hour.resets_at=now+7200 → "↺ 2h (HH:MM)"
    },
    {
      name: 'reset-7d-days-plain',
      config: cfgT('plain', true, [segT('reset-7d', { color: A(99) })]),
      scenario: mockScen('full'), // seven_day.resets_at=now+114h → "↺ 4d (MM/DD HH:MM)"
    },
    {
      name: 'reset-7d-null-hidden',
      config: cfgT('plain', true, [segT('model', { color: A(226) }), segT('reset-7d', { color: A(99) })]),
      scenario: mockScen('windows-cjk'), // seven_day.resets_at=null → 隱藏
    },
    {
      name: 'reset-5h-expired-hidden',
      config: cfgT('plain', true, [segT('model', { color: A(226) }), segT('reset-5h', { color: A(99) })]),
      scenario: mockScenWith('full', (d) => {
        d.rate_limits!.five_hour!.resets_at = fullNow - 100 // now-100，已過期 → 隱藏
      }),
    },
    {
      name: 'reset-5h-minutes-plain',
      config: cfgT('plain', true, [segT('reset-5h', { color: A(99) })]),
      scenario: mockScenWith('full', (d) => {
        d.rate_limits!.five_hour!.resets_at = fullNow + 1500 // now+25m → "↺ 25m (...)"
      }),
    },
    {
      name: 'reset-7d-hours-minutes-plain',
      config: cfgT('plain', true, [segT('reset-7d', { color: A(99) })]),
      scenario: mockScenWith('full', (d) => {
        d.rate_limits!.seven_day!.resets_at = fullNow + 5000 // now+1h23m20s → "↺ 1h23m (...)"
      }),
    },
    {
      name: 'reset-5h-powerline-cap',
      config: cfgT('powerline', true, [segT('model', { color: A(226) }), segT('reset-5h', { color: A(99) })]),
      scenario: mockScen('full'),
    },
  ]

  it.each(combos.map((c) => [c.name, c] as const))('%s', (_name, combo) => {
    const script = emitBash(combo.config, CATALOG)
    const oracle = Buffer.from(toAnsi(resolve(combo.config, combo.scenario)), 'utf8')
    const stdin = JSON.stringify(combo.scenario.data)
    const r = runScript(script, stdin, combo.scenario.env.home, jqDir, false, {
      STATUSLINE_NOW_EPOCH: String(combo.scenario.now),
    })
    expect(r.status, `非零 exit；stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.toString('hex')).toBe(oracle.toString('hex'))
  })
})
