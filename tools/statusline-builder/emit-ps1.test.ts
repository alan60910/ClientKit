/**
 * S5-T2.5（PLAN §產生器契約 1–12＋§格式化對等規則 ps1 面／§Verification
 * 1–3／.t23 §5,§7）：emit-ps1 產生器測試。
 *
 * 三層：
 * 1. **結構契約（跨平台）**：檔頭三行／stdin 讀入／exit-0／輸出形／PS 5.1
 *    底線（禁 `??`/`?.`/Set-StrictMode、顯式 `$null -eq`）／escaping 單引號
 *    context（`'`→`''`、`$()` 不插值）／`[double]` idiom／powerline `$ARROW`
 *    ／cap 兩態／未知 id TypeError。
 * 2. **黃金（跨平台）**：canonical config（plain 滿配／powerline+閾值+C1）→
 *    emitPs1 產出 toEqual 簽入黃金（`__golden__/*.ps1`）。**BOM 比對口徑**：
 *    黃金檔含 UTF-8 BOM（另以 Buffer 斷言首 3 bytes），文字比對時剝 BOM
 *    ＋正規化 EOL（防 autocrlf；本機 core.autocrlf=false 但防禦）；emitPs1
 *    回傳**不含 BOM**（BOM 屬檔案層職責，契約 8）。
 * 3. **端到端 byte-exact（win32-only，skipIf）**：emitPs1(config)→帶 BOM
 *    寫檔→spawn `powershell -NoProfile -ExecutionPolicy Bypass -File`（.t15
 *    生產形逐字）餵 stdin → stdout Buffer 與 `toAnsi(resolve())` byte-exact
 *    ＋exit 0。涵蓋 SP-5 a/b/c×cap 7 組合＋escaping `$()` 對抗案＋0.0029
 *    Decimal 案（證 `[double]` idiom）＋plain 滿配（非 shell-out）行為驗證。
 *    非 win32 跳過並輸出 reason。
 *
 * canonical config 與 scripts/golden-statusline-ps1.mjs 內同名 config
 * 逐字同步（golden 測試為漂移守門）。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ColorSpec } from './color.js'
import type { BuilderConfig, SegmentConfig, SeparatorConfig } from './config.js'
import { emitPs1 } from './emit-ps1.js'
import { toAnsi } from './emit-ansi.js'
import { resolve, type ResolveInput } from './resolve.js'
import { DESCRIPTORS_BY_ID, type StatusData } from './segments.js'
import { MOCK_SCENARIOS_BY_ID } from './mock-data.js'
import { THRESHOLD_TEMPLATES } from './threshold.js'
import { MULTIROW_GOLDEN_CASES } from './multirow-golden-configs.js'

// 檔級 testTimeout（比照 pipeline.integration.test.ts 等 7 檔體制）：「端到端
// byte-exact（win32；powershell 真執行）」首案承擔 powershell.exe 冷啟動，
// 2026-09-23 PR #1 windows-latest 於全套並行負載下兩次實測 7.0 s／8.6 s 超過
// vitest 預設 5000ms（DEV push 同 commit 則通過）——純排程延遲、非迴歸。
// 斷言與生產碼皆未變動；設定只影響本檔。
vi.setConfig({ testTimeout: 30_000 })

const CATALOG = DESCRIPTORS_BY_ID

// ── config 建構小工具（與 scripts/golden-statusline-ps1.mjs 逐字同步） ──

const A = (index: number): ColorSpec => ({ kind: 'ansi256', index })
const TRAFFIC = THRESHOLD_TEMPLATES.traffic
// T4.6（08-PLAN Rev 4 §5）雙模板：與 scripts/golden-statusline-ps1.mjs 內
// 手抄 LIMIT_GRADIENT／REMAINING_GRADIENT 同值（此檔可直接 import 真
// threshold.ts，無需手抄——golden 側因 registerHooks 時序限制才手抄，見
// 該檔檔頭）。
const LIMIT_GRADIENT = THRESHOLD_TEMPLATES['limit-gradient']
const REMAINING_GRADIENT = THRESHOLD_TEMPLATES['remaining-gradient']
const seg = (id: string, over: Partial<SegmentConfig> = {}): SegmentConfig => ({
  id,
  enabled: true,
  icon: true,
  color: { kind: 'default' },
  ...over,
})
const cfg = (over: Partial<BuilderConfig>): BuilderConfig => {
  const mode = over.mode ?? 'plain'
  return {
    version: 2,
    mode,
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: true,
    powerlineArrow: mode === 'powerline',
    segments: [],
    ...over,
  }
}

// canonical config（icon 全開＝seg 預設 true）
const PLAIN_FULL: BuilderConfig = cfg({
  mode: 'plain',
  separator: { kind: 'preset', value: '|' },
  segments: [
    seg('model', { color: A(75) }),
    seg('cwd', { variant: 'tilde', prefix: '@' }),
    seg('project-dir'),
    seg('output-style'),
    seg('version', { prefix: 'v' }),
    seg('cost', { color: A(220) }),
    seg('duration'),
    seg('lines-changed'),
    seg('context-size'),
    seg('thinking'),
    seg('context-used', { threshold: TRAFFIC, prefix: "it's " }),
    seg('context-remaining'),
    seg('rate-5h', { variant: 'percent-reset' }),
    seg('rate-7d', { variant: 'percent-reset' }),
    seg('session-name', { prefix: '$(x)' }),
    seg('effort'),
    seg('vim-mode'),
    seg('agent-name'),
    seg('pr'),
    seg('repo'),
    seg('worktree'),
    seg('worktree-branch'),
    seg('git-branch'),
    seg('git-dirty'),
    seg('clock'),
  ],
})

// T4.6（08-PLAN Rev 4 §5；TASKS.md T4.6）：全 30 段單列（plain）——涵蓋新
// 5 段（token-in／token-out／cache-hit／reset-5h／reset-7d）ps1 產生路徑。
// **獨立新 config，刻意不擴充 PLAIN_FULL**：後者被多處既有結構斷言
// （「無倒數段」不變量、`fullBehaviorCases()` 真執行等）依賴其現行 25 段
// 形狀，擴充會打破那些既有斷言的前提；與
// scripts/golden-statusline-ps1.mjs 內同名 'full-30-plain' 逐字同步。
const FULL_30_PLAIN: BuilderConfig = cfg({
  mode: 'plain',
  separator: { kind: 'preset', value: '|' },
  segments: [
    seg('model', { color: A(75) }),
    seg('cwd', { variant: 'tilde', prefix: '@' }),
    seg('project-dir'),
    seg('output-style'),
    seg('version', { prefix: 'v' }),
    seg('cost', { color: A(220) }),
    seg('duration'),
    seg('lines-changed'),
    seg('context-size'),
    seg('thinking'),
    seg('token-in', { color: A(80) }),
    seg('token-out', { color: A(81) }),
    seg('context-used', { threshold: TRAFFIC, prefix: "it's " }),
    seg('context-remaining'),
    seg('cache-hit', { color: A(214) }),
    seg('rate-5h', { variant: 'percent-reset' }),
    seg('rate-7d', { variant: 'percent-reset' }),
    seg('reset-5h', { color: A(99) }),
    seg('reset-7d', { color: A(99) }),
    seg('session-name', { prefix: '$(x)' }),
    seg('effort'),
    seg('vim-mode'),
    seg('agent-name'),
    seg('pr'),
    seg('repo'),
    seg('worktree'),
    seg('worktree-branch'),
    seg('git-branch'),
    seg('git-dirty'),
    seg('clock'),
  ],
})

const POWERLINE_THRESHOLD: BuilderConfig = cfg({
  mode: 'powerline',
  lastArrowCap: true,
  segments: [
    seg('model', { color: A(226) }),
    seg('session-name', { prefix: '[s]', color: A(99) }),
    seg('context-used', { threshold: TRAFFIC, color: A(240) }),
    seg('cost', { color: A(16) }),
  ],
})

// powerline＋powerlineArrow:false（MAGI code review Important #8 修復；與
// scripts/golden-statusline-ps1.mjs 內同名 config 逐字同步）：v2 預設模式
// 的完整黃金 byte 覆蓋——lastArrowCap:true 但 powerlineArrow:false → cap
// 全面無效（收尾箭頭區塊恆不 emit，證 cap 值本身不影響輸出）。段組合：
// context-used（threshold）＝閾值桶陣列段；rate-5h（無 threshold）＝dash
// 政策段；session-name／git-branch＝2 個 icon-enabled 段（pad＋emoji
// codepoint 跳脫＋無箭頭三者共存於單一 fixture）。
const POWERLINE_NOARROW: BuilderConfig = cfg({
  mode: 'powerline',
  powerlineArrow: false,
  lastArrowCap: true,
  segments: [
    seg('model', { color: A(226) }),
    seg('session-name', { prefix: '[s]', color: A(99) }),
    seg('context-used', { icon: false, threshold: TRAFFIC, color: A(240) }),
    seg('rate-5h', { icon: false, color: A(99) }),
    seg('git-branch', { color: A(46) }),
  ],
})

// T4.6（08-PLAN Rev 4 §5；TASKS.md T4.6）golden 擴案：與
// scripts/golden-statusline-ps1.mjs 內同名 config 逐字同步（golden 測試
// 為漂移守門）。

// bar 結構覆蓋（plain）：雙模板（limit-gradient／remaining-gradient）＋
// traffic＋percent-reset 併 bar＋無閾值 bar（threshold===undefined →
// filled／pct 退段主色，與有閾值分支為結構性不同 ps1 程式碼路徑）。
const BAR_TEMPLATES: BuilderConfig = cfg({
  mode: 'plain',
  segments: [
    seg('context-used', { icon: false, bar: true, threshold: LIMIT_GRADIENT, color: A(240) }),
    seg('context-remaining', { icon: false, bar: true, threshold: REMAINING_GRADIENT, color: A(45) }),
    seg('rate-5h', { icon: false, bar: true, variant: 'percent-reset', threshold: TRAFFIC, color: A(88) }),
    seg('cache-hit', { icon: false, bar: true, color: A(200) }),
  ],
})

// bar＋auto＋倒數同列（powerline arrow=true, cap=true）：auto(model) 展開
// 色參與箭頭交接／autoFg 對比＋bar 併元素累加器＋countdown 段三者同列
// 共存（sp4/verify.mjs 案 10 配方；T4.6 §Verification 錨點）。
const BAR_AUTO_POWERLINE_ARROW: BuilderConfig = cfg({
  mode: 'powerline',
  lastArrowCap: true,
  segments: [
    seg('model', { color: { kind: 'auto' } }),
    seg('context-used', { icon: false, bar: true, threshold: TRAFFIC, color: A(240) }),
    seg('reset-5h', { icon: false, color: A(99) }),
  ],
})

// bar（無閾值）＋auto(effort)＋倒數同列（powerline powerlineArrow:false／
// noarrow）：D1 gating 右 padding 與 auto／bar 併元素三者共存（sp4/
// verify.mjs 案 11 配方）。
const BAR_AUTO_POWERLINE_NOARROW: BuilderConfig = cfg({
  mode: 'powerline',
  powerlineArrow: false,
  lastArrowCap: true,
  segments: [
    seg('effort', { color: { kind: 'auto' } }),
    seg('rate-7d', { icon: false, bar: true, color: A(88) }),
    seg('reset-7d', { icon: false, color: A(99) }),
  ],
})

// T1.6（(internal design doc) §D1 golden 策略）：與
// scripts/golden-statusline-ps1.mjs 內同名 config 逐字同步（golden 測試
// 為漂移守門）。單列＋列 0（唯一啟用位）覆寫：全域 '|'、rowSeparators[0]
// 覆寫為 preset '·'。
const ROWSEP_SINGLE_OVERRIDE: BuilderConfig = cfg({
  mode: 'plain',
  rowSeparators: [{ kind: 'preset', value: '·' }],
  segments: [
    seg('model', { color: A(226) }),
    seg('cost', { color: A(220) }),
    seg('duration', { color: A(118) }),
  ],
})

// 單列覆寫值為 custom 且含須逸出字元（單引號）：驗 psSingleQuote 對覆寫值
// 本身的逸出（比照既有 escaping 案分隔符逸出精神，惟該案逸出全域
// separator、本案逸出 rowSeparators 覆寫值）。
const ROWSEP_CUSTOM_ESCAPE: BuilderConfig = cfg({
  mode: 'plain',
  rowSeparators: [{ kind: 'custom', value: "'" }],
  segments: [seg('model', { prefix: "'$(x)", color: A(226) }), seg('version', {})],
})

const GOLDENS: ReadonlyArray<{ name: string; config: BuilderConfig }> = [
  { name: 'plain-full', config: PLAIN_FULL },
  { name: 'powerline-threshold', config: POWERLINE_THRESHOLD },
  { name: 'powerline-noarrow', config: POWERLINE_NOARROW },
  { name: 'full-30-plain', config: FULL_30_PLAIN },
  { name: 'bar-templates', config: BAR_TEMPLATES },
  { name: 'bar-auto-powerline-arrow', config: BAR_AUTO_POWERLINE_ARROW },
  { name: 'bar-auto-powerline-noarrow', config: BAR_AUTO_POWERLINE_NOARROW },
  { name: 'rowsep-single-override', config: ROWSEP_SINGLE_OVERRIDE },
  { name: 'rowsep-custom-escape', config: ROWSEP_CUSTOM_ESCAPE },
]

// ── 1. 結構契約（跨平台） ──

describe('檔頭與框架（契約 1／8／9）', () => {
  const script = emitPs1(POWERLINE_THRESHOLD, CATALOG)

  it('檔頭 Input/Output 雙編碼行＋$e（契約 8）', () => {
    expect(script).toContain('[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)')
    expect(script).toContain('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)')
    expect(script).toContain('$e = [char]27')
  })

  it('stdin 讀入 ReadToEnd | ConvertFrom-Json（契約 1）', () => {
    expect(script).toContain('[Console]::In.ReadToEnd()')
    expect(script).toContain('ConvertFrom-Json')
  })

  it('輸出 [Console]::Out.Write($out)＋結尾顯式 exit 0（契約 9）', () => {
    expect(script).toContain('[Console]::Out.Write($out)')
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })

  it('回傳不含 BOM（BOM 屬檔案層職責，契約 8）', () => {
    expect(script.charCodeAt(0)).not.toBe(0xfeff)
    expect(script.startsWith('#')).toBe(true)
  })
})

describe('PS 5.1 底線（禁 ?:/??/?. 、不得 Set-StrictMode、顯式 $null）', () => {
  const scripts = GOLDENS.map((g) => emitPs1(g.config, CATALOG))

  it('無 `??`／`?.`／`?:` 三元／Set-StrictMode', () => {
    for (const s of scripts) {
      expect(s).not.toContain('??')
      expect(s).not.toContain('?.')
      expect(s).not.toMatch(/Set-StrictMode/)
    }
  })

  it('null 判定顯式 $null -eq／$null -ne', () => {
    for (const s of scripts) {
      expect(s).toMatch(/\$null -(eq|ne) /)
    }
  })
})

describe('escaping（契約 6：單引號 context、$() 不插值）', () => {
  it("使用者前綴 ' → '' 雙寫（走單引號）", () => {
    const script = emitPs1(cfg({ segments: [seg('model', { icon: false, prefix: "a'b" })] }), CATALOG)
    expect(script).toContain("'a''b'")
  })

  it('$() 前綴嵌於單引號字面、非雙引號（不插值）', () => {
    const script = emitPs1(cfg({ segments: [seg('model', { icon: false, prefix: '$(x)' })] }), CATALOG)
    expect(script).toContain("'$(x)'") // 單引號緊鄰 payload
    expect(script).not.toContain('"$(x)') // 絕不落雙引號 context
  })

  it('backtick 前綴走單引號字面（不觸發 PS escape）', () => {
    const script = emitPs1(cfg({ segments: [seg('model', { icon: false, prefix: '`n' })] }), CATALOG)
    expect(script).toContain("'`n'")
    expect(script).not.toContain('"`n')
  })
})

describe('[double] 轉型 idiom（Decimal 陷阱；格式化對等規則）', () => {
  it('cost helper 帶 [double]$c 轉型', () => {
    const script = emitPs1(cfg({ segments: [seg('cost', { icon: false })] }), CATALOG)
    expect(script).toContain('[math]::Floor([double]$c * 10000)')
  })

  it('百分比取值帶 [double]$v／[double]$p（於 $null 判定之後）', () => {
    const script = emitPs1(cfg({ segments: [seg('context-used', { icon: false, threshold: TRAFFIC })] }), CATALOG)
    // null 判定在前、[double] 轉型在 else 分支（不誤殺 null）
    expect(script).toMatch(/if \(\$null -eq \$v\)[\s\S]*\} else \{[\s\S]*\$p = \[double\]\$v/)
  })
})

describe('mode 分歧與 cap 兩態', () => {
  it('powerline 印 $ARROW；plain 不印', () => {
    expect(emitPs1(POWERLINE_THRESHOLD, CATALOG)).toContain('$ARROW = [string][char]0xE0B0')
    expect(emitPs1(PLAIN_FULL, CATALOG)).not.toContain('$ARROW')
  })

  it('lastArrowCap true → 收尾箭頭區塊；false → 無', () => {
    const capOn = emitPs1(POWERLINE_THRESHOLD, CATALOG)
    const capOff = emitPs1({ ...POWERLINE_THRESHOLD, lastArrowCap: false }, CATALOG)
    expect(capOn).toContain('if ($n -gt 0) {')
    expect(capOff).not.toContain('if ($n -gt 0) {')
  })

  it('plain 閾值段：桶色作 fg 陣列＋head/value 分裂（精確結構由黃金鎖）', () => {
    // context-used（default 色＋prefix "it's "）→ head 非空 → head/value 兩 run
    const script = emitPs1(PLAIN_FULL, CATALOG)
    expect(script).toContain('$Th0Fg = @(') // plain 桶色作 fg 陣列
    expect(script).toContain("it''s") // head run 前綴 escaping（'→''）
    // head 非空（prefix "it's "）→ head run 後補 reset 起 value run（分裂證據）；
    // head 空時此 reset 不補（見 pipeline.integration bare-head byte-exact 回歸鎖）。
    expect(script).toContain('$s += "$e[0m"')
  })

  it('未知 segment id → TypeError（programmer error）', () => {
    expect(() => emitPs1(cfg({ segments: [seg('not-a-segment')] }), CATALOG)).toThrow(TypeError)
  })
})

// ── D1 gating（powerlineArrow × lastArrowCap 四組合） ──

describe('D1 gating（powerlineArrow × lastArrowCap，emit-ps1）', () => {
  const segs = [seg('model', { icon: false, color: A(226) }), seg('cost', { icon: false, color: A(16) })]
  const pa = (lastArrowCap: boolean, powerlineArrow: boolean): BuilderConfig => ({
    ...cfg({ mode: 'powerline', lastArrowCap, segments: segs }),
    powerlineArrow,
  })

  it.each([true, false])(
    'powerlineArrow=false（lastArrowCap=%s 無效）：無 $ARROW、無段間箭頭迴圈、無 cap 區塊、每段 value 尾綴空白',
    (lastArrowCap) => {
      const script = emitPs1(pa(lastArrowCap, false), CATALOG)
      expect(script).not.toContain('$ARROW')
      expect(script).not.toContain('if ($n -gt 0) {')
      // 每段 value 顯示運算式尾綴 `+ ' '`（padLit）。
      expect(script).toContain(`+ ' '`)
    },
  )

  it.each([true, false])(
    'powerlineArrow=true（lastArrowCap=%s）：有 $ARROW、cap 區塊依 lastArrowCap、value 無 padding',
    (lastArrowCap) => {
      const script = emitPs1(pa(lastArrowCap, true), CATALOG)
      expect(script).toContain('$ARROW = [string][char]0xE0B0')
      expect(script.includes('if ($n -gt 0) {')).toBe(lastArrowCap)
      expect(script).not.toContain(`+ ' '`)
    },
  )

  it('padding 只在 powerline＋powerlineArrow=false 生效；plain 模式不受影響', () => {
    const plainScript = emitPs1(cfg({ mode: 'plain', segments: segs }), CATALOG)
    expect(plainScript).not.toContain(`+ ' '`)
  })

  // T1.2（06a WORKS 死資料清理）：`$BgT`／`$BgT<k>` 只在 `joinPowerline` 的
  // `if (powerlineArrow)` 區塊於 powerlineArrow=true 時被讀取——arrow=false
  // 的 powerline 腳本不應再宣告／累加該死陣列。負向鎖：單列與多列各一案，
  // 逐字 `not.toContain('$BgT')`（涵蓋宣告與累加兩面，任一處殘留即紅）。
  it('powerlineArrow=false：單列腳本零 $BgT（宣告＋累加皆不 emit）', () => {
    const script = emitPs1(pa(true, false), CATALOG)
    expect(script).not.toContain('$BgT')
  })

  it('powerlineArrow=false：多列腳本零 $BgT<k>（宣告＋累加皆不 emit，跨列一致）', () => {
    const multirowNoarrow = MULTIROW_GOLDEN_CASES.find((c) => c.name === 'multirow-powerline-noarrow')!
    const script = emitPs1(multirowNoarrow.config, CATALOG)
    expect(script).not.toContain('$BgT')
  })
})

// ── icon glyph 純 ASCII escape（S1／T1.2 裁決） ──

describe('icon glyph 純 ASCII escape（T1.2 契約）', () => {
  // T1.5.2（prefix-table.md）：25 段 icon.glyph 由 emoji 改 ASCII 前綴後，
  // 真 catalog 已無 astral／多 codepoint glyph（'model:'／'vim:' 皆純
  // BMP 單 codepoint 逐字元）；iconGlyphExpr 逐 codepoint 跳脫機制本身
  // 維持不動（最小改動原則，機制對 astral／多 codepoint 輸入仍正確）。
  // 下列兩案改以 test-local 合成 catalog（真 descriptor 覆寫 icon.glyph）
  // 保留對該機制的覆蓋，不依賴真 catalog 現已不存在的 astral／多
  // codepoint 字面。

  it('astral glyph（🤖，合成 fixture）：[char]::ConvertFromUtf32 escape、無原始 emoji bytes', () => {
    const astralCatalog = { ...CATALOG, model: { ...CATALOG.model, icon: { ...CATALOG.model.icon, glyph: '🤖' } } }
    const script = emitPs1(cfg({ segments: [seg('model', { icon: true })] }), astralCatalog)
    expect(script).toContain('[char]::ConvertFromUtf32(0x1F916)')
    expect(script).not.toContain('🤖')
  })

  it('BMP glyph（dur: 工作時長，T1.5.2 前綴）：[char]0xHEX escape（跟隨既有 $ARROW idiom），非 ConvertFromUtf32', () => {
    const script = emitPs1(cfg({ segments: [seg('duration', { icon: true })] }), CATALOG)
    expect(script).toContain('[char]0x64 + [char]0x75 + [char]0x72 + [char]0x3A')
    expect(script).not.toContain('ConvertFromUtf32')
    expect(script).not.toContain('dur:')
  })

  it('多 codepoint glyph（⌨️，合成 fixture，U+2328+U+FE0F）：兩個 [char] escape 以 + 相接', () => {
    const multiCpCatalog = {
      ...CATALOG,
      'vim-mode': { ...CATALOG['vim-mode'], icon: { ...CATALOG['vim-mode'].icon, glyph: '⌨️' } },
    }
    const script = emitPs1(cfg({ segments: [seg('vim-mode', { icon: true })] }), multiCpCatalog)
    expect(script).toContain('[char]0x2328 + [char]0xFE0F')
    expect(script).not.toContain('⌨')
  })

  it('icon 全開：每一段 icon.glyph 字面皆不出現於產出腳本（僅留檔頭中文註解等非 icon 內容）', () => {
    // 注意：整份腳本仍含檔頭中文註解（非 icon 內容，不受本契約約束）；
    // pure-ASCII 保證的範圍僅「icon glyph」本身——逐段斷言其字面缺席。
    const script = emitPs1(PLAIN_FULL, CATALOG)
    for (const s of PLAIN_FULL.segments) {
      if (!s.icon) continue
      const glyph = CATALOG[s.id as keyof typeof CATALOG].icon.glyph
      expect(script, `${s.id} 的 icon.glyph（${glyph}）不應以字面出現`).not.toContain(glyph)
    }
  })
})

// ── 分隔符 preset 純 ASCII escape（MAGI code review Important #7 修復） ──

describe('分隔符跳脫（preset ›/·，Important #7 修復）', () => {
  it("preset '›'（U+203A）：emit 腳本內分隔符運算式純 ASCII、無原始字面", () => {
    const script = emitPs1(
      cfg({ segments: [seg('model', { icon: false }), seg('cost', { icon: false })], separator: { kind: 'preset', value: '›' } }),
      CATALOG,
    )
    expect(script).toContain('[char]0x203A')
    expect(script).not.toContain('›')
  })

  it("preset '·'（U+00B7）：emit 腳本內分隔符運算式純 ASCII、無原始字面", () => {
    const script = emitPs1(
      cfg({ segments: [seg('model', { icon: false }), seg('cost', { icon: false })], separator: { kind: 'preset', value: '·' } }),
      CATALOG,
    )
    expect(script).toContain('[char]0xB7')
    expect(script).not.toContain('·')
  })

  it('preset 分隔符純 ASCII（|、空白）：退化為單一 psSingleQuote 呼叫（行為與修復前零差異）', () => {
    const pipeScript = emitPs1(
      cfg({ segments: [seg('model', { icon: false })], separator: { kind: 'preset', value: '|' } }),
      CATALOG,
    )
    expect(pipeScript).toContain(`+ '|' }`)
    const spaceScript = emitPs1(
      cfg({ segments: [seg('model', { icon: false })], separator: { kind: 'preset', value: ' ' } }),
      CATALOG,
    )
    expect(spaceScript).toContain(`+ ' ' }`)
  })

  it("custom 分隔符混 ASCII＋非 ASCII（'a›b'）：ASCII 段落單引號、非 ASCII 逐 codepoint 跳脫、以 + 相接", () => {
    const script = emitPs1(
      cfg({ segments: [seg('model', { icon: false })], separator: { kind: 'custom', value: 'a›b' } }),
      CATALOG,
    )
    expect(script).toContain(`'a' + [char]0x203A + 'b'`)
    expect(script).not.toContain('›')
  })
})

// ── T4.4：dash 分派（nullPolicy 驅動、tokens）── ──────────────────────

describe('dash 分派（nullPolicy 驅動；T4.4，PLAN Rev 4 §4）', () => {
  it('token-in（nullPolicy dash、非 percentage 段）：Format-Tokens helper 只在用到時印出', () => {
    const withToken = emitPs1(cfg({ segments: [seg('token-in', { icon: false })] }), CATALOG)
    expect(withToken).toContain('function Format-Tokens($v) {')
    expect(withToken).toContain("$vt = '--'")
    expect(withToken).toContain('$vt = (Format-Tokens $v)')

    const without = emitPs1(cfg({ segments: [seg('model', { icon: false })] }), CATALOG)
    expect(without).not.toContain('Format-Tokens')
  })

  it('token-out 同構（dash 分派零 id 特判——同一 nullPolicy 驅動路徑）', () => {
    const script = emitPs1(cfg({ segments: [seg('token-out', { icon: false })] }), CATALOG)
    expect(script).toContain('function Format-Tokens($v) {')
  })

  it('Format-Tokens 函式本體：<1000 原樣、≥1000 插小數點＋k（鏡像 resolve.ts formatTokens）', () => {
    const script = emitPs1(cfg({ segments: [seg('token-in', { icon: false })] }), CATALOG)
    expect(script).toContain('if ($n -lt 1000) { return [string][long][math]::Floor($n) }')
    expect(script).toContain("return ([string]$w) + '.' + ([string]$f) + 'k'")
  })
})

// ── T4.4：bar 4-run（結構斷言；byte 級由下方 e2e 覆蓋） ──────────────────

describe('bar 4-run 結構（T4.4；PLAN §4／sp4/REPORT.md）', () => {
  it('plain＋threshold：filled/empty 碼位跳脫、桶陣列宣告、無 bg 相關碼', () => {
    const script = emitPs1(
      cfg({ segments: [seg('context-used', { icon: false, bar: true, threshold: TRAFFIC })] }),
      CATALOG,
    )
    expect(script).toContain('$Th0Fg = @(')
    expect(script).toContain('([string][char]0x2588) * [int]$bn')
    expect(script).toContain('([string][char]0x2591) * [int](20 - $bn)')
    expect(script).not.toContain('█')
    expect(script).not.toContain('░')
    // plain 無 bg：不應出現 "$e[48;" 動態組裝（bar 段本身）。
    expect(script).not.toMatch(/\$s \+= "\$e\[48;"/)
  })

  it('powerline＋threshold：bg 全段維持段主色（4 run 均一 mainTail 常數）＋fgOverride 停用（headFg 恆 autoFg）', () => {
    const script = emitPs1(
      cfg({
        mode: 'powerline',
        segments: [
          seg('context-used', {
            icon: false,
            bar: true,
            threshold: TRAFFIC,
            color: A(20),
            fgOverride: A(9),
          }),
        ],
      }),
      CATALOG,
    )
    // headFg 用 autoFg 常數字面（不含 fgOverride 之 9 值）；bg 常數＝段主色 20 之 tail。
    expect(script).toContain(`'5;20'`)
    expect(script).not.toContain(`'38;5;9'`)
  })

  it('threshold undefined 而 bar 開：filled／value 退段主色 fg（無 $ThXFg 陣列）', () => {
    const script = emitPs1(cfg({ segments: [seg('context-used', { icon: false, bar: true })] }), CATALOG)
    expect(script).not.toContain('$Th0Fg')
  })

  it('bar＋percent-reset（M6 C3：倒數形，rate-5h→Format-Reset5h）：$sfx 死值守衛＋併入 run4', () => {
    const script = emitPs1(
      cfg({
        segments: [seg('rate-5h', { icon: false, bar: true, variant: 'percent-reset', threshold: TRAFFIC })],
      }),
      CATALOG,
    )
    expect(script).toContain('function Format-Reset5h($epoch, $now) {')
    expect(script).not.toContain('Format-ResetsAt')
    expect(script).toContain('$rst = $d.rate_limits.five_hour.resets_at')
    expect(script).toMatch(/if \(\$null -ne \$rst -and \$Now -lt \$rst\) \{\s*\n\s*\$sfx = ' ' \+ \(Format-Reset5h \$rst \$Now\)/)
  })

  it('bar＋percent-reset（rate-7d→Format-Reset7d，零 id 特判——目錄 countdown 欄驅動）', () => {
    const script = emitPs1(
      cfg({ segments: [seg('rate-7d', { icon: false, bar: true, variant: 'percent-reset' })] }),
      CATALOG,
    )
    expect(script).toContain('function Format-Reset7d($epoch, $now) {')
    expect(script).not.toContain('Format-ResetsAt')
  })

  it('bar 段主值 null 退化（M6 C2：恆 4-run，撤除舊單 run 路徑）：dash 分支僅早設 $bn=0／桶色退主色／NA_TEXT，filled／empty 組裝與存活分支共用', () => {
    const script = emitPs1(cfg({ segments: [seg('context-used', { icon: false, bar: true })] }), CATALOG)
    const dashBranch = script.slice(script.indexOf('if ($null -eq $v) {'), script.indexOf('} else {'))
    expect(dashBranch).toContain('$bn = 0')
    expect(dashBranch).toContain("$vt = '(n/a)'")
    expect(dashBranch).not.toContain('$filled')
    // filled／empty 組裝已移出 if/else、兩分支共用同一運算式（4-run 恆定形）。
    expect(script).toContain('$filled = ([string][char]0x2588) * [int]$bn')
    expect(script).toContain('$empty = ([string][char]0x2591) * [int](20 - $bn)')
  })
})

// ── T4.4：auto 配色查表（-clike／-ceq，禁 -match） ── ─────────────────────

describe('auto 配色查表（T4.4；PLAN Rev 4 §3／§4）', () => {
  it('model auto：-clike 前綴比對（大小寫敏感），禁 -match', () => {
    const script = emitPs1(cfg({ segments: [seg('model', { icon: false, color: { kind: 'auto' } })] }), CATALOG)
    expect(script).toContain(`-clike 'claude-fable-*'`)
    expect(script).toContain(`-clike 'claude-opus-*'`)
    expect(script).toContain(`-clike 'claude-haiku-*'`)
    expect(script).not.toContain('-match')
    expect(script).toContain('$Ac0Id = $d.model.id')
  })

  it('effort auto：-ceq 精確比對（大小寫敏感），禁 -match／-clike', () => {
    const script = emitPs1(cfg({ segments: [seg('effort', { icon: false, color: { kind: 'auto' } })] }), CATALOG)
    expect(script).toContain(`-ceq 'low'`)
    expect(script).toContain(`-ceq 'medium'`)
    expect(script).toContain(`-ceq 'high'`)
    expect(script).toContain(`-ceq 'xhigh'`)
    expect(script).toContain(`-ceq 'max'`)
    expect(script).not.toContain('-match')
    expect(script).not.toContain('-clike')
    expect(script).toContain('$Ac0Id = $d.effort.level')
  })

  it('auto 段未帶 autoColor 通道（programmer error）：TypeError（防繞道，比照 resolve.ts expandSegmentColor）', () => {
    // cost 段本無 autoColor 欄（僅 model／effort 有）；直接餵 auto 色＝
    // config 未經 deserializeConfig 清洗（該函式應退 default）→ 拋錯。
    expect(() =>
      emitPs1(cfg({ segments: [seg('cost', { icon: false, color: { kind: 'auto' } })] }), CATALOG),
    ).toThrow(TypeError)
  })

  it('多段皆 auto：變數名以索引區隔（$Ac0.../$Ac1...），不互相覆蓋', () => {
    const script = emitPs1(
      cfg({
        segments: [
          seg('model', { icon: false, color: { kind: 'auto' } }),
          seg('effort', { icon: false, color: { kind: 'auto' } }),
        ],
      }),
      CATALOG,
    )
    expect(script).toContain('$Ac0Id')
    expect(script).toContain('$Ac1Id')
  })
})

// ── T4.4：倒數段（$Now 注入；同機 oracle regime） ── ──────────────────────

describe('倒數段 $Now 注入（T4.4；sp2/REPORT.md §2.3 idiom）', () => {
  it('config 含 reset-5h：印出 $Now 計算區塊＋Format-Reset5h helper', () => {
    const script = emitPs1(cfg({ segments: [seg('reset-5h', { icon: false })] }), CATALOG)
    expect(script).toContain('$__nowEnv = $env:STATUSLINE_NOW_EPOCH')
    expect(script).toContain('if ([string]::IsNullOrEmpty($__nowEnv)) {')
    expect(script).toContain('[long]::TryParse($__nowEnv, [ref]$__nowParsed)')
    expect(script).toContain('function Format-Reset5h($epoch, $now) {')
  })

  it('config 含 reset-7d：Format-Reset7d helper＋$Now 注入', () => {
    const script = emitPs1(cfg({ segments: [seg('reset-7d', { icon: false })] }), CATALOG)
    expect(script).toContain('function Format-Reset7d($epoch, $now) {')
    expect(script).toContain('$__nowEnv = $env:STATUSLINE_NOW_EPOCH')
  })

  it('reset-5h／reset-7d 存活守衛含 expiresAtPath 通用規則（$Now -lt $v）', () => {
    const script = emitPs1(cfg({ segments: [seg('reset-5h', { icon: false })] }), CATALOG)
    expect(script).toMatch(/if \(\$null -ne \$v -and \$Now -lt \$v\) \{/)
  })

  it('config 無倒數段／無 expiresAtPath／無 percent-reset 變體：不印 $Now（真無使用情境，零額外開銷）', () => {
    // M6（TASKS.md T6.3）C5：PLAIN_FULL 因含 rate-5h／rate-7d 的
    // percent-reset variant 已不再是「無使用情境」（見下方 C5 正向案）——
    // 本案改用真正不觸及任一 $Now 消費路徑的 config（無倒數段、無
    // expiresAtPath、rate 段亦非 percent-reset variant）。
    const script = emitPs1(
      cfg({
        segments: [
          seg('model', { icon: false }),
          seg('cost', { icon: false }),
          seg('rate-5h', { icon: false }),
        ],
      }),
      CATALOG,
    )
    expect(script).not.toContain('STATUSLINE_NOW_EPOCH')
    expect(script).not.toContain('$Now')
  })

  it('C5 閘門擴充（M6，2026-07-14 拍板）：僅 percent-reset 變體、無倒數段（reset-5h／reset-7d）／無 expiresAtPath——仍印 $Now', () => {
    // PLAIN_FULL：rate-5h／rate-7d 皆 variant:'percent-reset'，但不含
    // reset-5h／reset-7d（那兩段只在 FULL_30_PLAIN）——證 C5 閘門確實已
    // 擴為「有倒數段 或 有 percent-reset 變體的 rate 段」，非僅沿用舊閘門。
    const script = emitPs1(PLAIN_FULL, CATALOG)
    expect(script).toContain('STATUSLINE_NOW_EPOCH')
    expect(script).toContain('$Now')
    expect(script).toContain('function Format-Reset5h($epoch, $now) {')
    expect(script).toContain('function Format-Reset7d($epoch, $now) {')
  })

  it('C5 閘門兩向 sanity：單一 percent-reset rate 段（無 threshold、無 bar）亦觸發 $Now', () => {
    const script = emitPs1(
      cfg({ segments: [seg('rate-7d', { icon: false, variant: 'percent-reset' })] }),
      CATALOG,
    )
    expect(script).toContain('STATUSLINE_NOW_EPOCH')
    expect(script).toContain('$Now')
  })
})

// ── T4.4：引擎自產字面純 ASCII（機械化斷言）＋文化不變性 ── ───────────────

function isAsciiLine(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) > 0x7f) return false
  }
  return true
}

describe('引擎自產字面純 ASCII（PLAN §4「ps1 非 ASCII 值字面跳脫」機械化斷言）', () => {
  it('bar／countdown／auto／分隔符／icon 全開、無使用者非 ASCII prefix：排除註解行後逐行純 ASCII', () => {
    const script = emitPs1(
      cfg({
        mode: 'powerline',
        powerlineArrow: true,
        separator: { kind: 'preset', value: '›' },
        segments: [
          seg('model', { icon: true, color: { kind: 'auto' } }),
          seg('effort', { icon: true, color: { kind: 'auto' } }),
          seg('context-used', { icon: true, bar: true, threshold: TRAFFIC }),
          seg('reset-5h', { icon: true }),
          seg('reset-7d', { icon: true }),
          seg('token-in', { icon: true }),
          seg('token-out', { icon: true }),
          seg('cache-hit', { icon: true }),
        ],
      }),
      CATALOG,
    )
    const lines = script.split('\n').filter((l) => !l.trimStart().startsWith('#'))
    for (const line of lines) {
      expect(isAsciiLine(line), `非 ASCII 行：${line}`).toBe(true)
    }
  })

  it('分隔符純 ASCII 版本亦成立（plain 模式；·）', () => {
    const script = emitPs1(
      cfg({
        mode: 'plain',
        separator: { kind: 'preset', value: '·' },
        segments: [seg('model', { icon: true }), seg('reset-5h', { icon: true })],
      }),
      CATALOG,
    )
    const lines = script.split('\n').filter((l) => !l.trimStart().startsWith('#'))
    for (const line of lines) {
      expect(isAsciiLine(line), `非 ASCII 行：${line}`).toBe(true)
    }
  })

  it('使用者 CJK prefix：排除註解行＋含 prefix 字面的行後，其餘（含新段引擎字面）仍純 ASCII', () => {
    const script = emitPs1(
      cfg({
        segments: [
          seg('model', { icon: false, prefix: '測試' }),
          seg('context-used', { icon: false, bar: true, threshold: TRAFFIC }),
          seg('reset-5h', { icon: false }),
        ],
      }),
      CATALOG,
    )
    // sanity：carve-out 通道確實含 CJK（否則本測試對「排除」邏輯零覆蓋）。
    expect(script).toContain('測試')
    const lines = script.split('\n').filter((l) => !l.trimStart().startsWith('#') && !l.includes('測試'))
    for (const line of lines) {
      expect(isAsciiLine(line), `非 ASCII 行（非 prefix 通道）：${line}`).toBe(true)
    }
  })
})

const goldenPath = (name: string): string => fileURLToPath(new URL(`./__golden__/${name}.ps1`, import.meta.url))
const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)
const normEol = (s: string): string => s.replace(/\r\n/g, '\n')

describe('黃金檔（emitPs1 產出 == 簽入 __golden__/*.ps1）', () => {
  it.each(GOLDENS)('$name：文字 toEqual（剝 BOM＋正規化 EOL）', ({ name, config }) => {
    const golden = normEol(stripBom(readFileSync(goldenPath(name), 'utf8')))
    expect(normEol(emitPs1(config, CATALOG))).toEqual(golden)
  })

  it.each(GOLDENS)('$name：檔案首 3 bytes ＝ UTF-8 BOM（EF BB BF；契約 8）', ({ name }) => {
    const bytes = readFileSync(goldenPath(name))
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  // R2 Note（MAGI code review 對稱缺口）：bash 側黃金已有無 CR 斷言
  // （emit-bash.test.ts:53-56），ps1 側先前缺對稱——normEol 剝 CRLF 後
  // toEqual 比對無法抓 CRLF 回歸（正規化後兩者字面相同）。此處補上，
  // BOM 3 bytes（EF BB BF）本身不含 0x0D，不干擾判定。
  it.each(GOLDENS)('$name：黃金檔皆 LF、無 CR（對稱 emit-bash.test.ts 契約）', ({ name }) => {
    const bytes = readFileSync(goldenPath(name))
    expect(bytes.includes(0x0d), `${name} 含 CR`).toBe(false)
  })
})

// MAGI code review 2026-07-11 Important #2（Fix 2）：4 個 multirow golden
// 先前僅由 T3.3 人審產出（golden-statusline.mjs／golden-statusline-ps1.mjs
// 各自 inline 定義），未被本檔黃金比對迴圈覆蓋——emit 回歸不會轉紅。config
// 單一來源已收攏至 multirow-golden-configs.ts（bash／ps1 共用），此處補一
// 個純 emit（不牽 powershell 真執行）常駐比對迴圈，比對口徑同上方既有
// GOLDENS 迴圈（剝 BOM＋正規化 EOL）。
describe('黃金比對（多列，emitPs1 === __golden__/multirow-*.ps1；Fix 2）', () => {
  it.each(MULTIROW_GOLDEN_CASES)('$name：文字 toEqual（剝 BOM＋正規化 EOL）', ({ name, config }) => {
    const golden = normEol(stripBom(readFileSync(goldenPath(name), 'utf8')))
    expect(normEol(emitPs1(config, CATALOG))).toEqual(golden)
  })

  it.each(MULTIROW_GOLDEN_CASES)('$name：檔案首 3 bytes ＝ UTF-8 BOM（EF BB BF；契約 8）', ({ name }) => {
    const bytes = readFileSync(goldenPath(name))
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  it.each(MULTIROW_GOLDEN_CASES)('$name：黃金檔皆 LF、無 CR（對稱 emit-bash.test.ts 契約）', ({ name }) => {
    const bytes = readFileSync(goldenPath(name))
    expect(bytes.includes(0x0d), `${name} 含 CR`).toBe(false)
  })
})

// ── T1.6（09-PLAN §D1 golden 策略）：rowSeparators 對 powerline 惰性——
// 機械證據（同 emit-bash.test.ts 對稱區塊；理由詳見該檔同名 describe 檔頭）。
// ps1 側既有 powerline golden 檔集與 bash 側名稱不完全重疊（GOLDENS 為
// 獨立 canonical 集，見檔頭「與 scripts/golden-statusline-ps1.mjs 逐字
// 同步」），本檔明列各自實際集合（單列 4 個＋多列 2 個，合計 6 個 ps1
// powerline 黃金檔；與 emit-bash.test.ts 明列的 8 個 .sh 為各自獨立事實
// 來源，數字不必相等）。
describe('rowSeparators 對 powerline 惰性（T1.6 機械證據；既有 powerline golden .ps1 零 diff 佐證）', () => {
  const GARBAGE_ROW_SEPS: (SeparatorConfig | null)[] = [
    { kind: 'custom', value: '###' },
    { kind: 'preset', value: '·' },
    null,
  ]

  it('單列來源（GOLDENS）：明列 4 個 powerline case，帶 rowSeparators 塞值 vs 不帶，emitPs1 產出逐位元組相同', () => {
    const powerlineCases = GOLDENS.filter((c) => c.config.mode === 'powerline')
    expect(powerlineCases.map((c) => c.name).sort()).toEqual(
      [
        'powerline-threshold',
        'powerline-noarrow',
        'bar-auto-powerline-arrow',
        'bar-auto-powerline-noarrow',
      ].sort(),
    )
    for (const { name, config } of powerlineCases) {
      const withSeps: BuilderConfig = { ...config, rowSeparators: GARBAGE_ROW_SEPS }
      expect(emitPs1(withSeps, CATALOG), `${name}：帶 rowSeparators 不應改變 powerline 輸出`).toEqual(
        emitPs1(config, CATALOG),
      )
    }
  })

  it('多列來源（MULTIROW_GOLDEN_CASES）：明列 2 個 powerline case，帶 rowSeparators 塞值 vs 不帶，emitPs1 產出逐位元組相同', () => {
    const powerlineCases = MULTIROW_GOLDEN_CASES.filter((c) => c.config.mode === 'powerline')
    expect(powerlineCases.map((c) => c.name).sort()).toEqual(
      ['multirow-powerline', 'multirow-powerline-noarrow'].sort(),
    )
    for (const { name, config } of powerlineCases) {
      const withSeps: BuilderConfig = { ...config, rowSeparators: GARBAGE_ROW_SEPS }
      expect(emitPs1(withSeps, CATALOG), `${name}：帶 rowSeparators 不應改變 powerline 輸出`).toEqual(
        emitPs1(config, CATALOG),
      )
    }
  })
})

// ── 多列展開（T3.2；四步展開結構斷言，PLAN §多列輸出／emit-ps1.ts 多列分支同構） ──

describe('多列展開（T3.2）：plain 兩列', () => {
  const TWO_ROW_PLAIN: BuilderConfig = cfg({
    mode: 'plain',
    separator: { kind: 'preset', value: '|' },
    segments: [
      seg('model', { icon: false, row: 0 }),
      seg('cost', { icon: false, row: 0 }),
      seg('git-branch', { icon: false, row: 1 }),
      seg('duration', { icon: false, row: 1 }),
    ],
  })
  const script = emitPs1(TWO_ROW_PLAIN, CATALOG)

  it('步驟 1：逐列緩衝宣告＋列內段 emit 依渲染列序出現（row0 先於 row1）', () => {
    const decl0 = script.indexOf('$Segs0 = @()')
    const decl1 = script.indexOf('$Segs1 = @()')
    const modelLine = script.indexOf('# model')
    const costLine = script.indexOf('# cost')
    const branchLine = script.indexOf('# git-branch')
    const durationLine = script.indexOf('# duration')
    expect(decl0).toBeGreaterThan(-1)
    expect(decl1).toBeGreaterThan(decl0)
    // row0 段（model／cost）落在兩列宣告之間；row1 段（git-branch／duration）在 row1 宣告之後。
    expect(modelLine).toBeGreaterThan(decl0)
    expect(modelLine).toBeLessThan(decl1)
    expect(costLine).toBeGreaterThan(decl0)
    expect(costLine).toBeLessThan(decl1)
    expect(branchLine).toBeGreaterThan(decl1)
    expect(durationLine).toBeGreaterThan(decl1)
  })

  it('步驟 1（續）：逐列 join 讀寫該列自己的累加器／輸出變數（$Segs0→$RowOut0、$Segs1→$RowOut1）', () => {
    expect(script).toContain('$RowOut0 = ')
    expect(script).toContain('$n = $Segs0.Count')
    expect(script).toContain('$RowOut0 += $Segs0[$i]')
    expect(script).toContain('$RowOut1 = ')
    expect(script).toContain('$n = $Segs1.Count')
    expect(script).toContain('$RowOut1 += $Segs1[$i]')
  })

  it('列內分隔符只出現於該列 join 區塊（各列各一次、不跨列共用）', () => {
    const sepRow0 = `if ($i -gt 0) { $RowOut0 += "$e[0m" + '|' }`
    const sepRow1 = `if ($i -gt 0) { $RowOut1 += "$e[0m" + '|' }`
    expect(script).toContain(sepRow0)
    expect(script).toContain(sepRow1)
    // 不得有跨列混用的分隔符寫法（$RowOut0 搭配讀 $Segs1 或反之）。
    expect(script).not.toContain(`$RowOut0 += "$e[0m" + '|' }\n  $RowOut0 += $Segs1`)
  })

  it('步驟 2–4：存活列過濾＋LF 串接＋零存活列退化', () => {
    expect(script).toContain('$Rows = @()')
    expect(script).toContain('if ($Segs0.Count -gt 0) { $Rows += $RowOut0 }')
    expect(script).toContain('if ($Segs1.Count -gt 0) { $Rows += $RowOut1 }')
    expect(script).toContain('if ($Rows.Count -gt 0) {')
    expect(script).toContain('$out = [string]::Join("`n", $Rows)')
    expect(script).toContain('$out = "$e[0m"')
    // 過濾／組裝在兩列的 join 之後（執行序：先兩列各自 join 完，才過濾組裝）。
    const lastRowOut1Join = script.lastIndexOf('$RowOut1 += "$e[0m"')
    const filterBlock = script.indexOf('$Rows = @()')
    expect(filterBlock).toBeGreaterThan(lastRowOut1Join)
  })

  it('no-CR：產出腳本不含 CR（LF 串接不引入 CRLF）', () => {
    expect(script.includes('\r')).toBe(false)
  })

  it('$out 仍以 [Console]::Out.Write($out) 輸出（輸出介面不變）', () => {
    expect(script).toContain('[Console]::Out.Write($out)')
    expect(script).not.toContain('WriteLine')
  })
})

describe('多列展開（T3.2）：powerline 兩列（箭頭／cap 列內獨立）', () => {
  const TWO_ROW_POWERLINE: BuilderConfig = cfg({
    mode: 'powerline',
    powerlineArrow: true,
    lastArrowCap: true,
    segments: [
      seg('model', { icon: false, row: 0, color: A(226) }),
      seg('cost', { icon: false, row: 0, color: A(16) }),
      seg('git-branch', { icon: false, row: 1, color: A(46) }),
      seg('duration', { icon: false, row: 1, color: A(99) }),
    ],
  })
  const script = emitPs1(TWO_ROW_POWERLINE, CATALOG)

  it('逐列緩衝宣告含 $BgT<k>（powerline 專用）', () => {
    expect(script).toContain('$Segs0 = @()')
    expect(script).toContain('$BgT0 = @()')
    expect(script).toContain('$Segs1 = @()')
    expect(script).toContain('$BgT1 = @()')
  })

  it('段間箭頭迴圈讀寫該列自己的 $BgT<k>（不跨列）', () => {
    expect(script).toContain(`if ($BgT0[$i - 1] -ne '') { $RowOut0 += "$e[38;" + $BgT0[$i - 1] + 'm' }`)
    expect(script).toContain(`if ($BgT1[$i - 1] -ne '') { $RowOut1 += "$e[38;" + $BgT1[$i - 1] + 'm' }`)
  })

  it('lastArrowCap 逐列各自收尾（cap 區塊出現兩次，各用自己列的 $BgT<k>／$RowOut<k>）', () => {
    expect(script).toContain(`if ($BgT0[$n - 1] -ne '') { $RowOut0 += "$e[38;" + $BgT0[$n - 1] + 'm' }`)
    expect(script).toContain(`if ($BgT1[$n - 1] -ne '') { $RowOut1 += "$e[38;" + $BgT1[$n - 1] + 'm' }`)
    const capBlocks = script.match(/if \(\$n -gt 0\) \{/g) ?? []
    expect(capBlocks.length).toBe(2)
  })

  it('步驟 2–4：存活列過濾＋LF 串接＋零存活列退化', () => {
    expect(script).toContain('if ($Segs0.Count -gt 0) { $Rows += $RowOut0 }')
    expect(script).toContain('if ($Segs1.Count -gt 0) { $Rows += $RowOut1 }')
    expect(script).toContain('$out = [string]::Join("`n", $Rows)')
  })

  it('no-CR：產出腳本不含 CR', () => {
    expect(script.includes('\r')).toBe(false)
  })
})

describe('多列展開（T3.2）：單列（含零啟用段）退化為既有扁平結構', () => {
  it('單列 config：不含任何 $Segs0／$RowOut0／$Rows（走既有扁平路徑，非多列展開）', () => {
    const script = emitPs1(PLAIN_FULL, CATALOG)
    expect(script).not.toContain('$Segs0')
    expect(script).not.toContain('$RowOut0')
    expect(script).not.toContain('$Rows')
    expect(script).toContain('$Segs = @()')
  })

  it('零啟用段 config：同走扁平路徑（$Segs = @()、無多列變數）', () => {
    const script = emitPs1(cfg({ segments: [] }), CATALOG)
    expect(script).toContain('$Segs = @()')
    expect(script).not.toContain('$Segs0')
    expect(script).not.toContain('$Rows')
  })
})

// ── T1.5（09-PLAN §D1 A-4）：emit-ps1 逐列傳參——joinPlain 兩呼叫點改傳
// 逐列分隔符值（rowSeparators[啟用位] ?? config.separator），separatorExpr
// 本身零改動（逐字元 ASCII／非 ASCII 分流展開機制不變，僅入參來源改變）。
describe('逐列分隔符覆寫（T1.5：joinPlain 兩呼叫點傳參）', () => {
  const TWO_ROW_BASE: Partial<BuilderConfig> = {
    mode: 'plain',
    separator: { kind: 'preset', value: '|' },
    segments: [
      seg('model', { icon: false, row: 0 }),
      seg('cost', { icon: false, row: 0 }),
      seg('git-branch', { icon: false, row: 1 }),
      seg('duration', { icon: false, row: 1 }),
    ],
  }

  it('no-override fast path：rowSeparators 缺席時多列輸出與既有（無此欄）逐 byte 相同', () => {
    const withoutField = emitPs1(cfg(TWO_ROW_BASE), CATALOG)
    // 兩列皆沿用全域分隔符 '|'——與 T3.2 既有多列案（無 rowSeparators 欄）同形。
    expect(withoutField).toContain(`if ($i -gt 0) { $RowOut0 += "$e[0m" + '|' }`)
    expect(withoutField).toContain(`if ($i -gt 0) { $RowOut1 += "$e[0m" + '|' }`)
  })

  it('no-override fast path：rowSeparators 全 null 與缺席欄產出逐 byte 相同（皆退全域）', () => {
    const withoutField = emitPs1(cfg(TWO_ROW_BASE), CATALOG)
    const allNull = emitPs1(cfg({ ...TWO_ROW_BASE, rowSeparators: [null, null] }), CATALOG)
    expect(allNull).toEqual(withoutField)
  })

  it("多列＋第 2 列（row1）覆寫 preset 非 ASCII '·'：該列 join 用覆寫值＋separatorExpr 逐 codepoint 展開，row0 仍用全域 '|'", () => {
    const script = emitPs1(
      cfg({ ...TWO_ROW_BASE, rowSeparators: [null, { kind: 'preset', value: '·' }] }),
      CATALOG,
    )
    // row0 無覆寫（null＝繼承全域）→ 仍是 '|'。
    expect(script).toContain(`if ($i -gt 0) { $RowOut0 += "$e[0m" + '|' }`)
    // row1 覆寫 '·'（U+00B7，非 ASCII）→ separatorExpr 逐 codepoint 跳脫形，純 ASCII、無原始字面。
    expect(script).toContain(`if ($i -gt 0) { $RowOut1 += "$e[0m" + [char]0xB7 }`)
    expect(script).not.toContain('·')
  })

  it("多列＋第 2 列（row1）覆寫 custom 混 ASCII／非 ASCII（'a›b'）：該列 join 用覆寫值、ASCII 段落單引號＋非 ASCII 逐 codepoint 以 + 相接", () => {
    const script = emitPs1(
      cfg({ ...TWO_ROW_BASE, rowSeparators: [null, { kind: 'custom', value: 'a›b' }] }),
      CATALOG,
    )
    expect(script).toContain(`if ($i -gt 0) { $RowOut0 += "$e[0m" + '|' }`)
    expect(script).toContain(`if ($i -gt 0) { $RowOut1 += "$e[0m" + 'a' + [char]0x203A + 'b' }`)
    expect(script).not.toContain('›')
  })

  it('單列＋列 0 覆寫：既有扁平結構（$Segs／$out）之 join 用覆寫值，非全域分隔符', () => {
    const script = emitPs1(
      cfg({
        mode: 'plain',
        separator: { kind: 'preset', value: '|' },
        rowSeparators: [{ kind: 'preset', value: '·' }],
        segments: [seg('model', { icon: false }), seg('cost', { icon: false })],
      }),
      CATALOG,
    )
    // 單列扁平路徑走 $Segs／$out（非 $Segs0／$RowOut0）——沿既有 M3 acceptance。
    expect(script).not.toContain('$Segs0')
    expect(script).not.toContain('$RowOut0')
    expect(script).toContain(`if ($i -gt 0) { $out += "$e[0m" + [char]0xB7 }`)
    expect(script).not.toContain(`+ '|' }`)
  })

  it('powerline＋rowSeparators 存在（含覆寫）：輸出與無此欄完全相同（powerline 走 joinPowerline，零觸碰）', () => {
    const POWERLINE_BASE = {
      mode: 'powerline' as const,
      powerlineArrow: true,
      lastArrowCap: true,
      segments: [
        seg('model', { icon: false, row: 0, color: { kind: 'ansi256' as const, index: 226 } }),
        seg('cost', { icon: false, row: 0, color: { kind: 'ansi256' as const, index: 16 } }),
        seg('git-branch', { icon: false, row: 1, color: { kind: 'ansi256' as const, index: 46 } }),
        seg('duration', { icon: false, row: 1, color: { kind: 'ansi256' as const, index: 99 } }),
      ],
    }
    const withoutField = emitPs1(cfg(POWERLINE_BASE), CATALOG)
    const withOverrides = emitPs1(
      cfg({ ...POWERLINE_BASE, rowSeparators: [{ kind: 'custom', value: 'X' }, { kind: 'preset', value: '·' }] }),
      CATALOG,
    )
    expect(withOverrides).toEqual(withoutField)
  })
})

// ── 3. 端到端 byte-exact（win32-only；skipIf 非 win32 並輸出 reason） ──

const IS_WIN = process.platform === 'win32'
const BOM = Buffer.from([0xef, 0xbb, 0xbf])

interface E2ECase {
  id: string
  config: BuilderConfig
  data: StatusData
  input: ResolveInput
}

function runPs1(script: string, stdin: string, extraEnv: Record<string, string> = {}): {
  status: number | null
  stdout: Buffer
  stderr: string
} {
  const dir = mkdtempSync(join(tmpdir(), 'ezps1-'))
  const file = join(dir, 'statusline.ps1')
  writeFileSync(file, Buffer.concat([BOM, Buffer.from(script, 'utf8')]))
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
      input: Buffer.from(stdin, 'utf8'),
      env: { ...process.env, ...extraEnv },
      maxBuffer: 1024 * 1024,
    })
    return {
      status: r.status,
      stdout: r.stdout ?? Buffer.alloc(0),
      stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8'),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── SP-5 a/b/c×cap 7 組合（照 sp5/expected.mjs 字面重建） ──

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const FULL = MOCK_SCENARIOS_BY_ID.full
const EARLY = MOCK_SCENARIOS_BY_ID['early-null']

function sp5Cases(): E2ECase[] {
  const scenarioA = (): { data: StatusData; segments: SegmentConfig[] } => {
    const data = clone(FULL.data)
    delete data.session_name
    data.context_window.used_percentage = 100
    return {
      data,
      segments: [
        seg('model', { icon: false, color: A(226) }),
        seg('session-name', { icon: false, color: A(99) }),
        seg('context-used', { icon: false, threshold: TRAFFIC, color: A(240) }),
      ],
    }
  }
  const scenarioB = (): { data: StatusData; segments: SegmentConfig[] } => {
    const data = clone(FULL.data)
    data.rate_limits!.five_hour!.used_percentage = null
    data.cost.total_cost_usd = 0.5
    return {
      data,
      segments: [
        seg('model', { icon: false, color: A(226) }),
        seg('rate-5h', { icon: false, color: A(240), threshold: TRAFFIC }),
        seg('cost', { icon: false, color: A(16) }),
      ],
    }
  }
  const scenarioCPlain = (): { data: StatusData; segments: SegmentConfig[] } => ({
    data: clone(EARLY.data),
    segments: [
      seg('model', { icon: false }),
      seg('session-name', { prefix: '[s]', icon: true, color: A(99) }),
      seg('cost', { icon: false }),
    ],
  })
  const scenarioCPowerline = scenarioCPlain

  const build = (
    mode: BuilderConfig['mode'],
    cap: boolean,
    make: () => { data: StatusData; segments: SegmentConfig[] },
    id: string,
  ): E2ECase => {
    const { data, segments } = make()
    const config = cfg({ mode, lastArrowCap: cap, segments })
    const base = make === scenarioCPlain ? EARLY : FULL
    return { id, config, data, input: { data, shell: base.shell, env: base.env, now: base.now } }
  }

  return [
    build('powerline', true, scenarioA, 'a-cap'),
    build('powerline', false, scenarioA, 'a-nocap'),
    build('powerline', true, scenarioB, 'b-cap'),
    build('powerline', false, scenarioB, 'b-nocap'),
    build('plain', true, scenarioCPlain, 'c-plain'),
    build('powerline', true, scenarioCPowerline, 'c-pl-cap'),
    build('powerline', false, scenarioCPowerline, 'c-pl-nocap'),
  ]
}

// escaping 對抗案（$() / ' 前綴走單引號；byte-exact 證不插值）
function escapingCase(): E2ECase {
  const data = clone(FULL.data)
  const config = cfg({
    mode: 'plain',
    segments: [
      seg('model', { icon: false, prefix: '$(1)' }),
      seg('cwd', { icon: false, variant: 'full', prefix: "a'b" }),
    ],
  })
  return { id: 'escaping', config, data, input: { data, shell: FULL.shell, env: FULL.env, now: FULL.now } }
}

// 0.0029 Decimal 案（[double] idiom：三後端同得 $0.0028）
function decimalCase(): E2ECase {
  const data = clone(FULL.data)
  data.cost.total_cost_usd = 0.0029
  const config = cfg({ mode: 'plain', segments: [seg('cost', { icon: false })] })
  return { id: 'decimal-0.0029', config, data, input: { data, shell: FULL.shell, env: FULL.env, now: FULL.now } }
}

// 分隔符 preset 跳脫 byte-exact（Important #7 修復；證逐 codepoint escape
// 只改「原始碼」bytes，runtime 輸出與 oracle 一致——'›'/'·' 兩組 preset）。
function separatorPresetCases(): E2ECase[] {
  const build = (value: '›' | '·'): E2ECase => {
    const data = clone(FULL.data)
    const config = cfg({
      mode: 'plain',
      separator: { kind: 'preset', value },
      segments: [seg('model', { icon: false }), seg('cost', { icon: false })],
    })
    return { id: `separator-preset/${value}`, config, data, input: { data, shell: FULL.shell, env: FULL.env, now: FULL.now } }
  }
  return [build('›'), build('·')]
}

// plain 滿配（非 shell-out 21 段）× 3 情境行為驗證（USERPROFILE=情境 home）。
// M6（TASKS.md T6.3）：PLAIN_FULL 的 rate-5h／rate-7d 帶 percent-reset
// variant，C3 起後綴需 $Now（見 resetSuffixEmit）——原本零 $Now 依賴（舊
// Format-ResetsAt 只吃 resets_at 本身，與現實時鐘無關），故此處補
// STATUSLINE_NOW_EPOCH 決定論注入（同 resetCountdownCases／barCases 既有
// idiom），避免真執行時系統時鐘飄移於 oracle 固定 mock now 之外導致誤判。
function fullBehaviorCases(): Array<EnvE2ECase & { home: string }> {
  const nonShellOut = PLAIN_FULL.segments.filter(
    (s) => !['git-branch', 'git-dirty', 'clock'].includes(s.id),
  )
  const config = cfg({ mode: 'plain', separator: { kind: 'preset', value: '|' }, segments: nonShellOut })
  return (['full', 'windows-cjk', 'early-null'] as const).map((sid) => {
    const scen = MOCK_SCENARIOS_BY_ID[sid]
    const data = clone(scen.data)
    return {
      id: `full-behavior/${sid}`,
      config,
      data,
      input: { data, shell: scen.shell, env: scen.env, now: scen.now },
      home: scen.env.home,
      extraEnv: { STATUSLINE_NOW_EPOCH: String(scen.now) },
    }
  })
}

// 兩列真執行對 oracle byte-exact（T3.2 選配補強；四步展開真機驗證，非
// shell-out 段——temp 目錄非 git repo，比照 fullBehaviorCases 排除 shell-out）。
function twoRowCases(): E2ECase[] {
  const data = clone(FULL.data)
  const plainConfig = cfg({
    mode: 'plain',
    separator: { kind: 'preset', value: '|' },
    segments: [
      seg('model', { icon: false, row: 0 }),
      seg('cost', { icon: false, row: 0 }),
      seg('duration', { icon: false, row: 1 }),
      seg('context-size', { icon: false, row: 1 }),
    ],
  })
  const powerlineConfig = cfg({
    mode: 'powerline',
    powerlineArrow: true,
    lastArrowCap: true,
    segments: [
      seg('model', { icon: false, row: 0, color: A(226) }),
      seg('cost', { icon: false, row: 0, color: A(16) }),
      seg('duration', { icon: false, row: 1, color: A(46) }),
      seg('context-size', { icon: false, row: 1, color: A(99) }),
    ],
  })
  return [
    { id: 'two-row/plain', config: plainConfig, data, input: { data, shell: FULL.shell, env: FULL.env, now: FULL.now } },
    { id: 'two-row/powerline', config: powerlineConfig, data, input: { data, shell: FULL.shell, env: FULL.env, now: FULL.now } },
  ]
}

// ── T4.4：5 新段＋bar＋auto 真執行（win32；byte-exact vs toAnsi(resolve())） ──

/** e2e case 附加 extraEnv（倒數段需 STATUSLINE_NOW_EPOCH 決定論注入，同機 oracle regime，見 sp2/sp6 REPORT）。 */
interface EnvE2ECase extends E2ECase {
  extraEnv?: Record<string, string>
}

// bar：plain/powerline×threshold/無threshold、null 退化、percent-reset 併 run4。
function barCases(): EnvE2ECase[] {
  const mk = (
    id: string,
    config: BuilderConfig,
    scen: (typeof MOCK_SCENARIOS_BY_ID)['full'],
    extraEnv?: Record<string, string>,
  ): EnvE2ECase => {
    const data = clone(scen.data)
    return { id: `bar/${id}`, config, data, input: { data, shell: scen.shell, env: scen.env, now: scen.now }, extraEnv }
  }
  const other = seg('model', { icon: false, color: A(226) })
  return [
    mk(
      'plain-threshold',
      cfg({ mode: 'plain', segments: [other, seg('context-used', { icon: false, bar: true, threshold: TRAFFIC })] }),
      FULL,
    ),
    mk(
      'plain-nothreshold',
      cfg({ mode: 'plain', segments: [seg('context-used', { icon: false, bar: true })] }),
      FULL,
    ),
    mk(
      'powerline-threshold-arrow',
      cfg({
        mode: 'powerline',
        powerlineArrow: true,
        lastArrowCap: true,
        segments: [
          { ...other, color: A(226) },
          seg('context-used', { icon: false, bar: true, threshold: TRAFFIC, color: A(20) }),
        ],
      }),
      FULL,
    ),
    mk(
      'powerline-threshold-noarrow',
      cfg({
        mode: 'powerline',
        powerlineArrow: false,
        lastArrowCap: true,
        segments: [
          { ...other, color: A(226) },
          seg('context-used', { icon: false, bar: true, threshold: TRAFFIC, color: A(20) }),
        ],
      }),
      FULL,
    ),
    mk(
      'plain-percent-reset',
      cfg({
        mode: 'plain',
        segments: [seg('rate-5h', { icon: false, bar: true, variant: 'percent-reset', threshold: TRAFFIC })],
      }),
      FULL,
      // M6 C3：percent-reset 倒數後綴需 $Now——同 resetCountdownCases／
      // percentResetSuffixCases 既有 idiom，決定論注入避免真執行時系統
      // 時鐘飄移於 oracle 固定 mock now 之外。
      { STATUSLINE_NOW_EPOCH: String(FULL.now) },
    ),
    mk(
      'plain-null',
      cfg({ mode: 'plain', segments: [seg('context-used', { icon: false, bar: true, threshold: TRAFFIC })] }),
      EARLY,
    ),
    mk(
      'powerline-null-cap',
      cfg({
        mode: 'powerline',
        powerlineArrow: true,
        lastArrowCap: true,
        segments: [seg('context-used', { icon: false, bar: true, threshold: TRAFFIC, color: A(20) })],
      }),
      EARLY,
    ),
    // 邊界：9.99%／90.01%（conditional-absent 情境）填格數字錨點覆蓋。
    mk(
      'plain-boundary-9.99',
      cfg({ mode: 'plain', segments: [seg('context-used', { icon: false, bar: true, threshold: TRAFFIC })] }),
      MOCK_SCENARIOS_BY_ID['conditional-absent'],
    ),
  ]
}

// token-in/token-out：dash（null）、<1000 原樣、≥1000 縮寫邊界（999/1000 精確錨點）、大數值。
function tokenCases(): EnvE2ECase[] {
  const mk = (id: string, tokens: number | null, segId: 'token-in' | 'token-out'): EnvE2ECase => {
    const data = clone(FULL.data)
    if (data.context_window.current_usage) {
      if (segId === 'token-in') data.context_window.current_usage.input_tokens = tokens
      else data.context_window.current_usage.output_tokens = tokens
    }
    const config = cfg({ mode: 'plain', segments: [seg(segId, { icon: false })] })
    return { id, config, data, input: { data, shell: FULL.shell, env: FULL.env, now: FULL.now } }
  }
  return [
    mk('token-in/below-1000', 999, 'token-in'),
    mk('token-in/at-1000-boundary', 1000, 'token-in'),
    mk('token-in/large', 1234567, 'token-in'),
    mk('token-in/null-dash', null, 'token-in'),
    mk('token-in/zero', 0, 'token-in'),
    mk('token-out/below-1000', 42, 'token-out'),
    mk('token-out/null-dash', null, 'token-out'),
  ]
}

// cache-hit：full（存活，公式非 0）／conditional-absent（分母 0 → 0）／windows-cjk（partial-null → dash）。
function cacheHitCases(): EnvE2ECase[] {
  const config = cfg({ mode: 'plain', segments: [seg('cache-hit', { icon: false })] })
  return (['full', 'conditional-absent', 'windows-cjk'] as const).map((sid) => {
    const scen = MOCK_SCENARIOS_BY_ID[sid]
    const data = clone(scen.data)
    return { id: `cache-hit/${sid}`, config, data, input: { data, shell: scen.shell, env: scen.env, now: scen.now } }
  })
}

// reset-5h／reset-7d：兩階梯（<1h/≥1h、<1d/≥1d）＋過期／null 隱藏——STATUSLINE_NOW_EPOCH
// 決定論注入（同機 oracle regime，sp6/REPORT.md §4.3 結局 (b)；HH:mm／MM/dd 不寫死）。
function resetCountdownCases(): EnvE2ECase[] {
  const now = FULL.now
  const mk = (
    id: string,
    resetsAt: number | null,
    which: 'five_hour' | 'seven_day',
    segId: 'reset-5h' | 'reset-7d',
  ): EnvE2ECase => {
    const data = clone(FULL.data)
    data.rate_limits![which]!.resets_at = resetsAt
    const config = cfg({ mode: 'plain', segments: [seg(segId, { icon: false })] })
    return {
      id,
      config,
      data,
      input: { data, shell: FULL.shell, env: FULL.env, now },
      extraEnv: { STATUSLINE_NOW_EPOCH: String(now) },
    }
  }
  return [
    mk('reset-5h/lt-1h-minutes-branch', now + 1800, 'five_hour', 'reset-5h'),
    mk('reset-5h/ge-1h-hours-branch', now + 7200, 'five_hour', 'reset-5h'),
    mk('reset-5h/expired-hidden', now - 10, 'five_hour', 'reset-5h'),
    mk('reset-5h/null-hidden', null, 'five_hour', 'reset-5h'),
    mk('reset-7d/lt-1d-hm-branch', now + 19800, 'seven_day', 'reset-7d'),
    mk('reset-7d/ge-1d-days-branch', now + 410400, 'seven_day', 'reset-7d'),
    mk('reset-7d/expired-hidden', now - 10, 'seven_day', 'reset-7d'),
  ]
}

// M6（TASKS.md T6.3；2026-07-14 拍板 C3）：rate-5h／rate-7d 的 percent-reset
// 後綴（非獨立倒數段本體）——兩階梯 × 兩段＋死值（過期／null）「無後綴但
// 段仍存活」對照組（與上方 resetCountdownCases 的「整段剔除」語意刻意
// 區隔：rate 段的 used_percentage 主值恆非 null，只有後綴本身生滅）。
function percentResetSuffixCases(): EnvE2ECase[] {
  const now = FULL.now
  const mk = (
    id: string,
    resetsAt: number | null,
    which: 'five_hour' | 'seven_day',
    segId: 'rate-5h' | 'rate-7d',
  ): EnvE2ECase => {
    const data = clone(FULL.data)
    data.rate_limits![which]!.resets_at = resetsAt
    const config = cfg({ mode: 'plain', segments: [seg(segId, { icon: false, variant: 'percent-reset' })] })
    return {
      id,
      config,
      data,
      input: { data, shell: FULL.shell, env: FULL.env, now },
      extraEnv: { STATUSLINE_NOW_EPOCH: String(now) },
    }
  }
  return [
    mk('percent-reset/rate-5h/minutes-branch', now + 1800, 'five_hour', 'rate-5h'),
    mk('percent-reset/rate-5h/hours-branch', now + 7200, 'five_hour', 'rate-5h'),
    mk('percent-reset/rate-5h/expired-suffix-gone-segment-alive', now - 10, 'five_hour', 'rate-5h'),
    mk('percent-reset/rate-5h/null-suffix-gone-segment-alive', null, 'five_hour', 'rate-5h'),
    mk('percent-reset/rate-7d/hm-branch', now + 19800, 'seven_day', 'rate-7d'),
    mk('percent-reset/rate-7d/days-branch', now + 410400, 'seven_day', 'rate-7d'),
    mk('percent-reset/rate-7d/expired-suffix-gone-segment-alive', now - 10, 'seven_day', 'rate-7d'),
    mk('percent-reset/rate-7d/null-suffix-gone-segment-alive', null, 'seven_day', 'rate-7d'),
  ]
}

// auto：model（4 分支＋大小寫敏感負例）× plain/powerline。
function autoModelCases(): EnvE2ECase[] {
  const branches: Array<[string, string]> = [
    ['claude-fable-5', 'fable'],
    ['claude-opus-4-8', 'opus'],
    ['claude-haiku-4-5-20251001', 'haiku'],
    ['claude-sonnet-5', 'other-fallback'],
    ['Claude-Opus-4-8', 'case-sensitive-negative'],
  ]
  const cases: EnvE2ECase[] = []
  for (const mode of ['plain', 'powerline'] as const) {
    for (const [id, tag] of branches) {
      const data = clone(FULL.data)
      data.model.id = id
      const config = cfg({
        mode,
        powerlineArrow: mode === 'powerline',
        lastArrowCap: true,
        segments: [seg('model', { icon: false, color: { kind: 'auto' } })],
      })
      cases.push({
        id: `auto-model/${mode}/${tag}`,
        config,
        data,
        input: { data, shell: FULL.shell, env: FULL.env, now: FULL.now },
      })
    }
  }
  return cases
}

// auto：effort（6 分支＋大小寫敏感負例）× plain（全覆蓋）；powerline 兩代表分支（low/max）。
function autoEffortCases(): EnvE2ECase[] {
  const branches: Array<[string, string]> = [
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'max'],
    ['unknown-level', 'fallback'],
    ['Low', 'case-sensitive-negative'],
  ]
  const build = (mode: BuilderConfig['mode'], level: string, tag: string): EnvE2ECase => {
    const data = clone(FULL.data)
    data.effort = { level }
    const config = cfg({
      mode,
      powerlineArrow: mode === 'powerline',
      lastArrowCap: true,
      segments: [seg('effort', { icon: false, color: { kind: 'auto' } })],
    })
    return {
      id: `auto-effort/${mode}/${tag}`,
      config,
      data,
      input: { data, shell: FULL.shell, env: FULL.env, now: FULL.now },
    }
  }
  const cases: EnvE2ECase[] = branches.map(([level, tag]) => build('plain', level, tag))
  cases.push(build('powerline', 'low', 'low'))
  cases.push(build('powerline', 'max', 'max'))
  return cases
}

describe.skipIf(!IS_WIN)('端到端 byte-exact（win32；powershell 真執行）', () => {
  it.each(twoRowCases())('$id：兩列 stdout == toAnsi(resolve()) ＋exit 0（LF 列分隔、非 CRLF）', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data))
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })


  it.each(sp5Cases())('SP-5 $id：stdout == toAnsi(resolve()) ＋exit 0', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data))
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it('escaping $()／\' 前綴 byte-exact（證走單引號非雙引號）', () => {
    const c = escapingCase()
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data))
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it('0.0029 Decimal 案 byte-exact（證 [double] idiom＝$0.0028）', () => {
    const c = decimalCase()
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    // 前置：oracle 確為 $0.0028（Decimal 未轉型會得 $0.0029）
    expect(expected.toString('utf8')).toContain('$0.0028')
    const r = runPs1(script, JSON.stringify(c.data))
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it.each(separatorPresetCases())('$id：preset 分隔符跳脫 byte-exact（runtime 輸出與 oracle 一致，證跳脫只改原始碼 bytes）', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data))
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it.each(fullBehaviorCases())('$id：plain 滿配（非 shell-out）byte-exact', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data), { USERPROFILE: c.home, ...(c.extraEnv ?? {}) })
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  // ── T4.4：5 新段＋bar＋auto 真執行（PLAN Rev 4 §4；沿既有慣例 byte-exact vs toAnsi(resolve())） ──

  it.each(barCases())('$id：bar 4-run byte-exact', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data), c.extraEnv ?? {})
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it.each(tokenCases())('$id：token-in/out（dash 分派）byte-exact', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data), c.extraEnv ?? {})
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it.each(cacheHitCases())('$id：cache-hit byte-exact', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data), c.extraEnv ?? {})
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it.each(resetCountdownCases())('$id：倒數段 byte-exact（STATUSLINE_NOW_EPOCH 同機 oracle）', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data), c.extraEnv ?? {})
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it.each(percentResetSuffixCases())('$id：percent-reset 倒數後綴 byte-exact（M6 C3；STATUSLINE_NOW_EPOCH 同機 oracle）', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data), c.extraEnv ?? {})
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it.each(autoModelCases())('$id：auto model 查表 byte-exact（含大小寫敏感負例）', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data), c.extraEnv ?? {})
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  it.each(autoEffortCases())('$id：auto effort 查表 byte-exact（含大小寫敏感負例）', (c) => {
    const script = emitPs1(c.config, CATALOG)
    const expected = Buffer.from(toAnsi(resolve(c.config, c.input)), 'utf8')
    const r = runPs1(script, JSON.stringify(c.data), c.extraEnv ?? {})
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(r.stdout.equals(expected), `\nexpected ${expected.toString('hex')}\nactual   ${r.stdout.toString('hex')}`).toBe(true)
  })

  // 文化不變性（PLAN §4／sp6/REPORT.md §4.2；同機 oracle 慣例：實跑切換
  // CurrentCulture，證 InvariantCulture 修法後輸出與預設文化逐位元組相同）。
  it('文化不變性：CurrentCulture=de-DE 執行結果與預設文化 byte-exact 相同（rate-5h percent-reset＋reset-5h 倒數）', () => {
    const data = clone(FULL.data)
    const config = cfg({
      mode: 'plain',
      segments: [seg('rate-5h', { icon: false, variant: 'percent-reset' }), seg('reset-5h', { icon: false })],
    })
    const script = emitPs1(config, CATALOG)
    const cultureScript =
      "[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::GetCultureInfo('de-DE')\n" +
      script
    const extraEnv = { STATUSLINE_NOW_EPOCH: String(FULL.now) }
    const stdin = JSON.stringify(data)
    const defaultRun = runPs1(script, stdin, extraEnv)
    const deRun = runPs1(cultureScript, stdin, extraEnv)
    expect(defaultRun.status, `stderr=${defaultRun.stderr}`).toBe(0)
    expect(deRun.status, `stderr=${deRun.stderr}`).toBe(0)
    expect(
      deRun.stdout.equals(defaultRun.stdout),
      `\ndefault ${defaultRun.stdout.toString('hex')}\nde-DE   ${deRun.stdout.toString('hex')}`,
    ).toBe(true)
  })
})

it('端到端跳過 reason（非 win32）', () => {
  if (!IS_WIN) {
    console.warn('emit-ps1 端到端於非 win32 跳過：需 powershell.exe（Windows PowerShell 5.1）；windows CI leg 覆蓋')
  }
  expect(true).toBe(true)
})
