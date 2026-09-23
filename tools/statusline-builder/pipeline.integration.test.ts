/**
 * S5-T2.7（(internal design doc) §Verification 3 真執行／§SP-7
 * 格式化對等＋shell-out 等價／§CI 拓撲 skipIf 不變量＋meta 斷言）：三後端
 * 統合真執行 harness。單元／黃金（emit-*.test.ts）之外的「行為層背書」——
 * 真跑 bash＋jq／Windows PowerShell 5.1／（可選）pwsh 7，斷言與 TS 參考
 * （formatValue 經 resolve→toAnsi oracle）字面／byte-exact 相等。
 *
 * ── 七塊 ──
 * 1. **比對函式正負自測**：hexEqual（byte-exact 比對輔助，本 sprint 無共用
 *    比對函式故建最小形）——正向（一致對→真）＋負向（不一致對→假）。
 * 2. **SP-7 格式化對等**：對抗值集（cost 補尾零／0.0029 float 下緣 Decimal
 *    陷阱／duration 59999·60000·3599999／context-size 10⁶ 門檻／percentage
 *    邊界）三後端真跑斷言字面相等；0.0029 於 ps1 5.1／pwsh 7 分別斷言
 *    `[double]` 轉型後＝$0.0028。
 * 3. **shell-out 等價**：真 git repo 諸態（乾淨／髒／detached HEAD／無 branch
 *    空 repo）——emit-bash 產腳本真跑 vs emit-ps1 產腳本真跑，git-branch／
 *    git-dirty 段輸出 byte-exact 等價。
 * 4. **D1 gating 真執行覆蓋**：powerline＋`powerlineArrow:false` 單列
 *    config（threshold／dash-null／shell-out 三者共存）——bash／ps1 皆與
 *    oracle byte-exact。
 * 5. **多列真執行場景（T3.3；(internal design doc)
 *    §Verification 1）**：三列 config、其中一條**非末列**的段在
 *    `conditional-absent` 情境（mock-data.ts；條件欄鍵缺席）runtime 全滅
 *    ——emitBash／emitPs1 真跑 stdout 對 `toAnsi(resolve(...))` hex 比對，
 *    另補「無空行、LF 數＝存活列−1」結構斷言（plain／powerline＋arrow
 *    gating true 各一）；含全列全滅退化為單一 SGR reset 一案（對齊
 *    `resolve()` 的 `[[]]` 退化與 `toAnsi([[]])==='\x1b[0m'` 不變量）。
 * 6. **T4.6 整合收攏案（08-PLAN Rev 4 §5／TASKS.md T4.6）**：(a)
 *    bar×倒數×auto 同列——單列內同時含 auto 配色段、bar 開啟段、倒數段，
 *    置於雙列 config 內（`row` 分組，佐證「多列情境下同列多特徵共存」）；
 *    plain／powerline（arrow=true）各一，倒數段以 `STATUSLINE_NOW_EPOCH`
 *    顯式釘 now 對齊 oracle（同 emit-bash.test.ts／emit-ps1.test.ts 既有
 *    idiom）。(b) auto×powerline arrow／noarrow 兩形——sp4/REPORT.md
 *    verify.mjs 案 10/11 已驗證 auto 展開色參與 powerline 併元素／autoFg
 *    對比的位元組配方，本節補三後端（bash＋ps1）對實際 auto 段
 *    （model／effort）在 arrow=true／arrow=false 下的端到端覆蓋（先前
 *    emit-bash.test.ts／emit-ps1.test.ts 的 auto 組合案恆為 arrow=true，
 *    未含 noarrow）。
 * 7. **skipIf meta**：蒐集各 real-exec leg 的 enable 狀態，斷言「至少一後端
 *    未 skip」＋「平台載重後端（win32→ps1 5.1、posix→bash+jq）present 卻
 *    skip＝skipIf 條件 bug」——某後端全 leg skip 即紅。
 *
 * ── 環境（.t23 §9／.t24／.t26）──
 * Git Bash 候選由 env 推導＋`SP5_BASH` 覆寫；jq＝win32 leg 只認 `SP5_JQ_DIR`
 * （copy 為 jq.exe 入暫存 PATH；見 exec-detect-test-utils.ts）；spawn env 帶 `MSYS_NO_PATHCONV=1`（擋 MSYS
 * 引數路徑轉換）；ps1 spawn 形＝settings 生產形逐字（`-NoProfile
 * -ExecutionPolicy Bypass -File`）、檔案帶 UTF-8 BOM、stdout 以 Buffer 收；
 * resets／時間斷言用 spawn 當下 TZ（不寫死時刻，三後端同機同 TZ 一致）。
 *
 * spike／harness 檔——非產品碼；沿用 vitest include 預設（`.test.ts` 命名，
 * 進主測試套件）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ColorSpec } from './color.js'
import type { BuilderConfig, SegmentConfig } from './config.js'
import { toAnsi } from './emit-ansi.js'
import { emitBash, type SegmentDescriptorCatalog } from './emit-bash.js'
import { emitPs1 } from './emit-ps1.js'
import {
  cleanupOwnedJqDir,
  detectBash,
  detectJq,
  WIN_JQ_BIN_NAMES,
  type BashJqExec,
} from './exec-detect-test-utils.js'
import { MOCK_SCENARIOS_BY_ID } from './mock-data.js'
import { NA_TEXT, POWERLINE_ARROW, resolve } from './resolve.js'
import { DESCRIPTORS_BY_ID, type StatusData } from './segments.js'
import { THRESHOLD_TEMPLATES } from './threshold.js'

// micro-fix（gate 基建修復）：本檔絕大多數案皆真 spawn 子程序（bash/jq、
// powershell、pwsh、git）——全量 52 檔並行負載下，單一子程序 spawn 曾實測
// 超過 vitest 預設 5000ms timeout（隔離跑 2.5s、負載下 5.1–5.9s，byte 對拍
// 本身非迴歸，純屬負載期間排程延遲）。以檔案級 `vi.setConfig` 一次性把本
// 檔全部 it／it.each 的 timeout 提升為 30s，取代逐案補第三參數——本檔案
// vitest 預設隔離執行（無自訂 pool/isolate 設定，見 vite.config.ts 無 test
// 區塊），此設定只影響本檔、不外溢其他測試檔。斷言與生產碼皆未變動。
vi.setConfig({ testTimeout: 30_000 })

const CATALOG: SegmentDescriptorCatalog = DESCRIPTORS_BY_ID
const TRAFFIC = THRESHOLD_TEMPLATES.traffic
const FULL = MOCK_SCENARIOS_BY_ID.full
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const A = (index: number): ColorSpec => ({ kind: 'ansi256', index })

function segT(id: string, over: Partial<SegmentConfig> = {}): SegmentConfig {
  return { id, enabled: true, icon: false, color: { kind: 'default' }, ...over }
}
/**
 * MAGI code review Important #8 修復：`powerlineArrow` 開放可控（預設仍
 * ＝`mode === 'powerline'`，既有呼叫端零改動）——先前恆由 mode 派生，本檔
 * 從無 `powerline+powerlineArrow:false`（v2 預設模式）真執行覆蓋，見下方
 * 「D1 gating 真執行覆蓋」區塊。
 */
function cfgT(
  mode: BuilderConfig['mode'],
  segments: SegmentConfig[],
  powerlineArrow: boolean = mode === 'powerline',
): BuilderConfig {
  return {
    version: 2,
    mode,
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: true,
    powerlineArrow,
    segments,
  }
}

// ── 1. 比對函式（byte-exact）＋正負自測 ──

/**
 * byte-exact 比對輔助：以 hex 字串比對（可讀 diff 基礎；長度不同即不等）。
 * 本 sprint 之 emit-bash.test／emit-ps1.test 皆內聯比對、無共用函式 → 建此
 * 最小形供統合 harness 用，並自測正負向（PLAN §Verification 1 比對函式受測）。
 */
function hexEqual(a: Buffer, b: Buffer): boolean {
  return a.toString('hex') === b.toString('hex')
}

describe('比對函式自測（hexEqual 正負向）', () => {
  it('正向：已知一致對 → 判一致', () => {
    expect(hexEqual(Buffer.from('abc', 'utf8'), Buffer.from('abc', 'utf8'))).toBe(true)
    expect(hexEqual(Buffer.alloc(0), Buffer.alloc(0))).toBe(true)
    // 含 ESC／CJK 的真實形（byte 級一致）
    expect(hexEqual(Buffer.from('\x1b[0m工作區\x1b[0m', 'utf8'), Buffer.from('\x1b[0m工作區\x1b[0m', 'utf8'))).toBe(true)
  })
  it('負向：已知不一致對 → 判不一致', () => {
    expect(hexEqual(Buffer.from('abc', 'utf8'), Buffer.from('abd', 'utf8'))).toBe(false)
    // 長度不同（前綴相同）：防「短視為相等」
    expect(hexEqual(Buffer.from('abc', 'utf8'), Buffer.from('abcd', 'utf8'))).toBe(false)
    // $0.0028 vs $0.0029（0.0029 Decimal 陷阱的判別力）
    expect(hexEqual(Buffer.from('$0.0028', 'utf8'), Buffer.from('$0.0029', 'utf8'))).toBe(false)
  })
})

// ── 後端探測（.t23 §9／.t24／.t26） ──

type ExeExec = { ok: true; exe: string } | { ok: false; reason: string }

// sprint 17 D5：bash＋jq 探測收斂至 exec-detect-test-utils.ts（`detectJq`；原本檔
// `detectBash`／`detectBashExec` 複本已移除，與 emit-bash.test.ts／fixtures.test.ts
// 共用同一實作與 reason 字串全集）。win32 leg 只認 `SP5_JQ_DIR`（jq.exe 或
// jq-windows-amd64.exe 皆接受），一律複製為暫存目錄下的 jq.exe（`owned:true`）；
// afterAll 經 `cleanupOwnedJqDir` 只刪該暫存複本、永不碰 `SP5_JQ_DIR` 來源目錄。
// 非 win32 走 PATH `jq --version`；`SP5_BASH` 覆寫語意不變。

function detectPs1(): ExeExec {
  if (process.platform !== 'win32') return { ok: false, reason: '非 win32：無 Windows PowerShell 5.1（powershell.exe）' }
  const r = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0'])
  if (r.error !== undefined || r.status !== 0) return { ok: false, reason: 'powershell.exe 探測失敗' }
  return { ok: true, exe: 'powershell' }
}

function detectPwsh7(): ExeExec {
  const r = spawnSync('pwsh', ['--version'], { encoding: 'utf8' })
  if (r.error !== undefined || r.status !== 0) {
    return { ok: false, reason: 'pwsh（PowerShell 7）不在 PATH（本機無則交 CI windows leg 覆蓋）' }
  }
  return { ok: true, exe: 'pwsh' }
}

const BASH: BashJqExec = detectJq()
const PS1 = detectPs1()
const PWSH7 = detectPwsh7()
const PS1_EXE = PS1.ok ? PS1.exe : 'powershell'

// ── spawn 執行輔助 ──

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const bashScriptDir = BASH.ok ? mkdtempSync(join(tmpdir(), 'sl-sh-')) : ''
let seq = 0
const tempDirs: string[] = []

interface RunResult {
  status: number | null
  stdout: Buffer
  stderr: string
}

/** env 去所有大小寫變體之 path 鍵後設單一 PATH（Windows env 大小寫不敏）。 */
function withPath(env: NodeJS.ProcessEnv, newPath: string): NodeJS.ProcessEnv {
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === 'path') delete env[k]
  }
  env.PATH = newPath
  return env
}

/**
 * `extraEnv`（T4.6）：倒數段 STATUSLINE_NOW_EPOCH 顯式釘 now（S2 idiom 合法
 * 整數分支；同機 oracle regime 下與 `oracle()` 的固定 `FULL.now` 對齊，見
 * emit-bash.test.ts／emit-ps1.test.ts 既有「STATUSLINE_NOW_EPOCH 顯式釘
 * now」慣例）——不傳則沿舊行為（同機現算）。
 */
function runBash(script: string, stdinJson: string, cwd?: string, extraEnv: Record<string, string> = {}): RunResult {
  if (!BASH.ok) throw new Error('runBash without bash')
  const scriptPath = join(bashScriptDir, `s-${seq++}.sh`)
  writeFileSync(scriptPath, script) // emitBash 已 LF、無 BOM
  // MSYS_NO_PATHCONV：擋 Git Bash 呼叫原生 exe 時的 MSYS 引數路徑轉換（.t24）。
  let env: NodeJS.ProcessEnv = { ...process.env, MSYS_NO_PATHCONV: '1', ...extraEnv }
  if (BASH.jqDir !== undefined) env = withPath(env, BASH.jqDir + delimiter + (process.env.PATH ?? ''))
  const r = spawnSync(BASH.bash, [scriptPath], { input: Buffer.from(stdinJson, 'utf8'), env, cwd })
  return {
    status: r.status,
    stdout: r.stdout ?? Buffer.alloc(0),
    stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8'),
  }
}

/** ps1 spawn＝settings 生產形逐字（`-NoProfile -ExecutionPolicy Bypass -File`）；檔案帶 BOM。 */
function runPs1(
  exe: string,
  script: string,
  stdinJson: string,
  cwd?: string,
  extraEnv: Record<string, string> = {},
): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'sl-ps-'))
  const file = join(dir, 'statusline.ps1')
  writeFileSync(file, Buffer.concat([BOM, Buffer.from(script, 'utf8')]))
  try {
    const r = spawnSync(exe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
      input: Buffer.from(stdinJson, 'utf8'),
      env: { ...process.env, ...extraEnv },
      cwd,
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

/** STATUSLINE_NOW_EPOCH 注入 env（倒數段真執行與 oracle 對齊；T4.6）。 */
function nowEnv(now: number): Record<string, string> {
  return { STATUSLINE_NOW_EPOCH: String(now) }
}

/** TS 參考 oracle：resolve→toAnsi（單段 default 色 → `ESC[0m<值>ESC[0m`）。 */
function oracle(config: BuilderConfig, data: StatusData): Buffer {
  return Buffer.from(toAnsi(resolve(config, { data, shell: FULL.shell, env: FULL.env, now: FULL.now })), 'utf8')
}

/** 剝所有 SGR 序列 → 純顯示文字（單段 default 色時＝格式化值本身）。 */
function strip(buf: Buffer): string {
  return buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '')
}

// ── 2. SP-7 格式化對等（對抗值集） ──

interface Sp7Case {
  id: string
  config: BuilderConfig
  data: StatusData
  expected: string
}

function costCase(usd: number, expected: string): Sp7Case {
  const data = clone(FULL.data)
  data.cost.total_cost_usd = usd
  return { id: `cost/${usd}`, config: cfgT('plain', [segT('cost')]), data, expected }
}
function durationCase(ms: number, expected: string): Sp7Case {
  const data = clone(FULL.data)
  data.cost.total_duration_ms = ms
  return { id: `duration/${ms}`, config: cfgT('plain', [segT('duration')]), data, expected }
}
function ctxSizeCase(inTok: number, outTok: number, expected: string): Sp7Case {
  const data = clone(FULL.data)
  data.context_window.total_input_tokens = inTok
  data.context_window.total_output_tokens = outTok
  return { id: `context-size/${inTok}+${outTok}`, config: cfgT('plain', [segT('context-size')]), data, expected }
}
function pctCase(p: number, expected: string): Sp7Case {
  const data = clone(FULL.data)
  data.context_window.used_percentage = p
  return { id: `percentage/${p}`, config: cfgT('plain', [segT('context-used')]), data, expected }
}

const SP7_CASES: readonly Sp7Case[] = [
  // cost：單次浮點乘 floor＋4 位補尾零；0.0029＝float 乘積下緣（三後端同 double 同偏）。
  costCase(1.0, '$1.0000'),
  costCase(0.5, '$0.5000'),
  costCase(0.005, '$0.0050'),
  costCase(0.0029, '$0.0028'),
  costCase(0.01235, '$0.0123'),
  costCase(0, '$0.0000'),
  // duration：整數除法三階（59999→59s、60000→1m0s、3599999→59m59s、3600000→1h0m）。
  durationCase(59999, '59s'),
  durationCase(60000, '1m0s'),
  durationCase(3599999, '59m59s'),
  durationCase(3600000, '1h0m'),
  // context-size：10⁶ 門檻（999999→999k、10⁶→1M、10⁶+1→1M）。
  ctxSizeCase(999999, 0, '999k'),
  ctxSizeCase(1000000, 0, '1M'),
  ctxSizeCase(1000001, 0, '1M'),
  // percentage：⌊p⌋%（9.99→9%、10.0→10%、99→99%、100→100%、0→0%）。
  pctCase(9.99, '9%'),
  pctCase(10.0, '10%'),
  pctCase(99, '99%'),
  pctCase(100, '100%'),
  pctCase(0, '0%'),
]

/** 三後端共用的單案斷言：backend stdout == oracle（byte-exact）＋顯示 == expected。 */
function assertFormatCase(c: Sp7Case, run: (script: string, stdin: string) => RunResult, emit: (config: BuilderConfig) => string): void {
  const o = oracle(c.config, c.data)
  // TS 參考自檢：oracle 顯示須等於 expected（同時驗 expected 未寫錯）。
  expect(strip(o), `TS 參考顯示 ≠ expected（${c.id}）`).toBe(c.expected)
  const r = run(emit(c.config), JSON.stringify(c.data))
  expect(r.status, `${c.id} 非零 exit；stderr=${r.stderr}`).toBe(0)
  expect(hexEqual(r.stdout, o), `${c.id} byte 不符\n backend=${r.stdout.toString('hex')}\n oracle =${o.toString('hex')}`).toBe(true)
  expect(strip(r.stdout), `${c.id} 顯示 ≠ expected`).toBe(c.expected)
}

describe.skipIf(!BASH.ok)('SP-7 格式化對等 — bash＋jq', () => {
  it.each(SP7_CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    assertFormatCase(c, (s, stdin) => runBash(s, stdin), (config) => emitBash(config, CATALOG))
  })
})

describe.skipIf(!PS1.ok)('SP-7 格式化對等 — ps1 5.1', () => {
  it.each(SP7_CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    assertFormatCase(c, (s, stdin) => runPs1(PS1_EXE, s, stdin), (config) => emitPs1(config, CATALOG))
  })

  it('0.0029 Decimal 陷阱：[double] 轉型後 = $0.0028（非 Decimal 直算的 $0.0029）', () => {
    const data = clone(FULL.data)
    data.cost.total_cost_usd = 0.0029
    const config = cfgT('plain', [segT('cost')])
    const o = oracle(config, data)
    expect(strip(o), 'oracle（double 下緣）應為 $0.0028').toBe('$0.0028')
    const r = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data))
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    // PS 5.1 ConvertFrom-Json 回 Decimal(0.0029)*10⁴=29；emit-ps1 的 [double] 轉型
    // 恢復 double 下緣 → floor(28.999…)=28 → $0.0028。得 $0.0029 即 idiom 失效。
    expect(strip(r.stdout), 'PS 5.1 [double] 轉型應得 $0.0028；$0.0029＝Decimal 未轉型').toBe('$0.0028')
    expect(hexEqual(r.stdout, o)).toBe(true)
  })
})

describe.skipIf(!PWSH7.ok)('SP-7 格式化對等 — pwsh 7', () => {
  it.each(SP7_CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    assertFormatCase(c, (s, stdin) => runPs1(PWSH7.ok ? PWSH7.exe : 'pwsh', s, stdin), (config) => emitPs1(config, CATALOG))
  })

  it('0.0029：pwsh 7 原生 Double → $0.0028（[double] 轉型冗餘但不害）', () => {
    const data = clone(FULL.data)
    data.cost.total_cost_usd = 0.0029
    const config = cfgT('plain', [segT('cost')])
    const o = oracle(config, data)
    const r = runPs1(PWSH7.ok ? PWSH7.exe : 'pwsh', emitPs1(config, CATALOG), JSON.stringify(data))
    expect(r.status, `stderr=${r.stderr}`).toBe(0)
    expect(strip(r.stdout)).toBe('$0.0028')
    expect(hexEqual(r.stdout, o)).toBe(true)
  })
})

// ── resets 後綴三後端一致（Step 0 落地的統合驗證：oracle==bash==ps1） ──

describe.skipIf(!(BASH.ok && PS1.ok))('resets 後綴 — bash==ps1==oracle（同機同 TZ byte-exact）', () => {
  it('rate-5h percent-reset（plain 無閾值）：63% + " ↺ 2h (HH:mm)"（M6 C3 倒數形）', () => {
    const config = cfgT('plain', [segT('rate-5h', { variant: 'percent-reset', color: A(99) })])
    const data = clone(FULL.data) // five_hour.resets_at=FULL_NOW+2h（number）
    const o = oracle(config, data)
    const env = nowEnv(FULL.now) // C3 起 percent-reset 需 now（S2 idiom 注入，對齊 oracle 固定 now）。
    const b = runBash(emitBash(config, CATALOG), JSON.stringify(data), undefined, env)
    const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data), undefined, env)
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    // 後綴形（diff 固定＝FULL.now 注入下決定論；HH:mm 本地時刻不寫死——spawn 當下 TZ）。
    expect(strip(o)).toMatch(/^63% ↺ 2h \(\d\d:\d\d\)$/)
  })

  it("dash+後綴正交（used=null）：'(n/a) ↺ 2h (HH:mm)' 三後端一致（M6 C1 NA_TEXT＋C3 倒數形）", () => {
    const config = cfgT('plain', [segT('rate-5h', { variant: 'percent-reset', color: A(99) })])
    const data = clone(FULL.data)
    data.rate_limits!.five_hour!.used_percentage = null
    const o = oracle(config, data)
    const env = nowEnv(FULL.now)
    const b = runBash(emitBash(config, CATALOG), JSON.stringify(data), undefined, env)
    const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data), undefined, env)
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    expect(hexEqual(b.stdout, o)).toBe(true)
    expect(hexEqual(p.stdout, o)).toBe(true)
    expect(strip(o)).toMatch(/^\(n\/a\) ↺ 2h \(\d\d:\d\d\)$/)
  })

  // ── M6 C3 補案：percent-reset 倒數後綴 × {rate-5h, rate-7d} × {plain, powerline} ──
  // 既有兩案已覆蓋 rate-5h×plain（含 dash 正交）；本節補齊剩餘三格
  // （rate-5h×powerline、rate-7d×plain、rate-7d×powerline），湊滿 2×2 矩陣。

  it('rate-5h percent-reset × powerline（noarrow）：後綴倒數形＋D1 尾隨 pad，三後端一致', () => {
    const config = cfgT('powerline', [segT('rate-5h', { variant: 'percent-reset', color: A(99) })], false)
    const data = clone(FULL.data)
    const o = oracle(config, data)
    const env = nowEnv(FULL.now)
    const b = runBash(emitBash(config, CATALOG), JSON.stringify(data), undefined, env)
    const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data), undefined, env)
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    // D1 gating（powerlineArrow=false）：value 尾綴一格 pad，併入後綴之後。
    expect(strip(o)).toMatch(/^63% ↺ 2h \(\d\d:\d\d\) $/)
  })

  it('rate-7d percent-reset × plain：後綴倒數形（Xd 階梯，MM/DD HH:mm），三後端一致', () => {
    const config = cfgT('plain', [segT('rate-7d', { variant: 'percent-reset', color: A(129) })])
    const data = clone(FULL.data) // seven_day.used_percentage=21、resets_at=FULL_NOW+114h→diff≥86400（4d 階梯）
    const o = oracle(config, data)
    const env = nowEnv(FULL.now)
    const b = runBash(emitBash(config, CATALOG), JSON.stringify(data), undefined, env)
    const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data), undefined, env)
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(strip(o)).toMatch(/^21% ↺ 4d \(\d\d\/\d\d \d\d:\d\d\)$/)
  })

  it('rate-7d percent-reset × powerline（noarrow）：後綴倒數形＋D1 尾隨 pad，三後端一致', () => {
    const config = cfgT('powerline', [segT('rate-7d', { variant: 'percent-reset', color: A(129) })], false)
    const data = clone(FULL.data)
    const o = oracle(config, data)
    const env = nowEnv(FULL.now)
    const b = runBash(emitBash(config, CATALOG), JSON.stringify(data), undefined, env)
    const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data), undefined, env)
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(strip(o)).toMatch(/^21% ↺ 4d \(\d\d\/\d\d \d\d:\d\d\) $/)
  })

  // ── M6 C3 死值規則補案：resets_at 已過期 → 後綴消失但 rate 段主值仍存活 ──
  it('percent-reset 後綴已過期（now≥resets_at）→ 後綴消失、rate 段主值仍存活（只剔後綴，非整段死值）', () => {
    const config = cfgT('plain', [segT('rate-5h', { variant: 'percent-reset', color: A(99) })])
    const data = clone(FULL.data)
    data.rate_limits!.five_hour!.resets_at = FULL.now - 3600 // 已過期（now ≥ resets_at）
    const o = oracle(config, data)
    // 前置自檢：後綴全消、主值 63% 原樣存活（非整段剔除）。
    expect(strip(o), '前置自檢：oracle 顯示').toBe('63%')
    const env = nowEnv(FULL.now)
    const b = runBash(emitBash(config, CATALOG), JSON.stringify(data), undefined, env)
    const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data), undefined, env)
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
  })
})

// ── M6 C2 補案：bar×null 恆 4-run（不再退單 run）× {plain, powerline} ──

describe.skipIf(!(BASH.ok && PS1.ok))('bar×null（M6 C2；4-run 恆定形，NA_TEXT 值部）— bash==ps1==oracle', () => {
  it('context-used bar×null（threshold 定義、桶退段主色）× plain：三後端 byte-exact', () => {
    const config = cfgT('plain', [segT('context-used', { bar: true, threshold: TRAFFIC, color: A(240) })])
    const data = clone(FULL.data)
    data.context_window.used_percentage = null
    const input = { data, shell: FULL.shell, env: FULL.env, now: FULL.now }
    const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
    // 前置自檢：filled=0（20 empty）、value 部＝NA_TEXT（無 pad，plain 模式）。
    expect(strip(o), '前置自檢：oracle 顯示').toBe('░'.repeat(20) + ' (n/a)')
    const b = runBash(emitBash(config, CATALOG), JSON.stringify(data))
    const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data))
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
  })

  it('context-used bar×null（threshold 定義、桶退段主色）× powerline（noarrow）：三後端 byte-exact', () => {
    const config = cfgT(
      'powerline',
      [segT('context-used', { bar: true, threshold: TRAFFIC, color: A(240) })],
      false,
    )
    const data = clone(FULL.data)
    data.context_window.used_percentage = null
    const input = { data, shell: FULL.shell, env: FULL.env, now: FULL.now }
    const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
    // 前置自檢：D1 padding 併入 run4（尾綴一格）。
    expect(strip(o), '前置自檢：oracle 顯示').toBe('░'.repeat(20) + ' (n/a) ')
    const b = runBash(emitBash(config, CATALOG), JSON.stringify(data))
    const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data))
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
  })
})

// ── plain 閾值 × bare head（icon:false 無 prefix）× 數值：三後端 byte-exact ──
// CR2 覆蓋盲區 #2 回歸鎖：唯此格同時滿足 plain＋閾值＋head 空＋數值——emit-ps1
// 曾在 head 空時多吐一個 ESC[0m（雙 reset），破 SP-5 byte-exact；oracle＋bash 為
// 單 reset。既有受測閾值 config 非 powerline 即帶 head，從未覆蓋此路徑。此案永久
// 釘住三後端單 reset 等價（前置自檢：oracle 開頭恰一個 ESC[0m）。

describe.skipIf(!(BASH.ok && PS1.ok))('plain 閾值 bare head 數值 — bash==ps1==oracle', () => {
  it('context-used 55%（icon:false 無 prefix，TRAFFIC 閾值）：三後端單 reset byte-exact', () => {
    const config = cfgT('plain', [segT('context-used', { threshold: TRAFFIC })])
    const data = clone(FULL.data)
    data.context_window.used_percentage = 55 // 桶索引 5 → TRAFFIC[5]=ansi256(226)
    const o = oracle(config, data)
    // 前置自檢：oracle 為單 reset（非 `ESC[0m ESC[0m`）＋桶色 226——判別力來源。
    expect(o.toString('utf8')).toBe('\x1b[0m\x1b[38;5;226m55%\x1b[0m')
    const b = runBash(emitBash(config, CATALOG), JSON.stringify(data))
    const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data))
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
  })
})

// ── 3. shell-out 等價（真 git repo 諸態） ──

function gitCfg(dir: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗（cwd=${dir}）：${r.stderr}`)
}

/** git init＋本機 config（autocrlf off 防 CRLF 誤判髒、關 gpg 簽章、設身分）。 */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sl-git-'))
  tempDirs.push(dir)
  gitCfg(dir, ['init', '-q', '-b', 'main'])
  gitCfg(dir, ['config', 'core.autocrlf', 'false'])
  gitCfg(dir, ['config', 'commit.gpgsign', 'false'])
  gitCfg(dir, ['config', 'user.email', 'ez@test.local'])
  gitCfg(dir, ['config', 'user.name', 'ez'])
  return dir
}
function repoClean(): string {
  const dir = initRepo()
  writeFileSync(join(dir, 'f.txt'), 'hello\n')
  gitCfg(dir, ['add', 'f.txt'])
  gitCfg(dir, ['commit', '-q', '-m', 'init'])
  return dir
}
function repoDirty(): string {
  const dir = repoClean()
  writeFileSync(join(dir, 'f.txt'), 'hello world\n') // 已追蹤檔改動 → porcelain 非空
  return dir
}
function repoDetached(): string {
  const dir = repoClean()
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
  gitCfg(dir, ['checkout', '-q', sha]) // detached HEAD → branch --show-current 空
  return dir
}
function repoEmpty(): string {
  return initRepo() // 無 commit（unborn branch）→ branch --show-current 空
}

interface GitState {
  id: string
  mk: () => string
  /**
   * 期望顯示（plain `|` 分隔；branch 綠、dirty 紅；剝 SGR 後）。**只釘跨
   * git 版本決定論的態**（clean='main'／dirty='main|*'）；detached（分支空）
   * ／empty-repo（unborn 分支名依 git 版本——2.47 顯 'main'）之分支呈現
   * 隨版本浮動，故僅斷言 bash==ps1 等價、不釘字面（`undefined`）。假等價
   * 由 clean／dirty 的字面斷言全局排除（證 git 於本 harness 真的可跑）。
   */
  expectedDisplay?: string
}

const GIT_STATES: readonly GitState[] = [
  { id: 'clean', mk: repoClean, expectedDisplay: 'main' },
  { id: 'dirty', mk: repoDirty, expectedDisplay: 'main|*' },
  { id: 'detached', mk: repoDetached }, // 分支空＋乾淨 → 空鏈（branch 剔）
  { id: 'empty-repo', mk: repoEmpty }, // unborn 分支（2.47 顯 'main'）＋無檔（dirty 剔）
]

describe.skipIf(!(BASH.ok && PS1.ok))('shell-out 等價 — bash vs ps1（真 git repo）', () => {
  const shellCfg = cfgT('plain', [
    segT('git-branch', { color: A(46) }),
    segT('git-dirty', { color: A(196) }),
  ])
  const bashScript = emitBash(shellCfg, CATALOG)
  const ps1Script = emitPs1(shellCfg, CATALOG)

  // 回歸鎖（T2.7 授權補）：每態**兩後端皆真跑**——emit-ps1 亦真執行 clean／dirty／
  // detached／unborn 四態（不只 emit-bash）。此為 emit-ps1 shell-out 空輸出 bug 的
  // 回歸鎖：T2.5 e2e 把 git-branch/git-dirty/clock filter 掉 → shell-out 段從未真跑 →
  // 覆蓋盲區；本 harness 首次真執行覆蓋，per-backend 獨立釘住修後行為。
  it.each(GIT_STATES.map((s) => [s.id, s] as const))('%s：bash 產腳本 == ps1 產腳本（兩後端各真跑）', (_id, state) => {
    const dir = state.mk()
    const b = runBash(bashScript, '', dir)
    const p = runPs1(PS1_EXE, ps1Script, '', dir)
    expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
    expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
    // 主斷言：同一 repo 狀態下兩後端 byte-exact 等價（git-branch／git-dirty 段輸出同）。
    expect(hexEqual(b.stdout, p.stdout), `bash≠ps1\n b=${b.stdout.toString('hex')}\n p=${p.stdout.toString('hex')}`).toBe(true)
    if (state.expectedDisplay !== undefined) {
      // 決定論態：兩後端各獨立釘字面（排「git 找不到→皆空」假等價；乾淨 repo 誤顯 '*' 即紅）。
      expect(strip(b.stdout), `${state.id} bash 顯示`).toBe(state.expectedDisplay)
      expect(strip(p.stdout), `${state.id} ps1 顯示`).toBe(state.expectedDisplay)
    } else {
      // detached／unborn 分支名隨 git 版本浮動 → 不釘字面；但工作樹乾淨 → 兩後端皆不得有
      // dirty '*'（版本無關的 per-backend 回歸鎖：git-dirty 空輸出誤存活即紅）。
      expect(strip(b.stdout), `${state.id} bash 不得含 '*'`).not.toContain('*')
      expect(strip(p.stdout), `${state.id} ps1 不得含 '*'`).not.toContain('*')
    }
  })

  it('非 git 目錄：兩後端皆 exit 0＋空鏈（契約 9）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-nogit-'))
    tempDirs.push(dir)
    const b = runBash(bashScript, '', dir)
    const p = runPs1(PS1_EXE, ps1Script, '', dir)
    expect(b.status).toBe(0)
    expect(p.status).toBe(0)
    expect(hexEqual(b.stdout, p.stdout)).toBe(true)
    expect(strip(b.stdout)).toBe('') // 空鏈（僅行尾 reset）
  })
})

// ── D1 gating 真執行覆蓋（powerline＋powerlineArrow:false；threshold／
//    dash-null／shell-out 三者共存於單一 config；MAGI code review
//    Important #8 修復）──
// cfgT 先前恆令 powerlineArrow = mode==='powerline'，本檔從無
// powerline+powerlineArrow:false（v2 預設模式、新使用者最常見輸出）之
// 真執行覆蓋——emit-bash.test.ts／emit-ps1.test.ts 的「D1 gating」describe
// 僅有結構性子字串斷言（無 byte-exact／真執行）。本區塊補：bash／ps1 各
// 真跑於真 clean git repo（branch='main'、乾淨），輸出與 oracle
// （resolve+toAnsi，shell 通道釘住為同一 clean 態）byte-exact，同時涵蓋
// 閾值分裂桶色（context-used=55%→桶 5＝ansi256(226)）、dash-null
// （rate-5h=null→'--'，無閾值）、shell-out（git-branch，真 repo）三者
// 共存於單一 powerline+powerlineArrow:false config。
describe.skipIf(!(BASH.ok && PS1.ok))(
  'D1 gating 真執行覆蓋 — powerline+powerlineArrow:false（threshold／dash-null／shell-out）',
  () => {
    it('context-used 55%（threshold）＋rate-5h null（dash）＋git-branch（clean repo）：bash/ps1 皆與 oracle byte-exact', () => {
      const config = cfgT(
        'powerline',
        [
          segT('context-used', { threshold: TRAFFIC, color: A(240) }),
          segT('rate-5h', { color: A(99) }),
          segT('git-branch', { color: A(46) }),
        ],
        false, // powerlineArrow=false（D1 gating：無箭頭、lastArrowCap 全面無效）
      )
      const data = clone(FULL.data)
      data.context_window.used_percentage = 55 // 桶索引 5 → TRAFFIC[5]=ansi256(226)
      data.rate_limits!.five_hour!.used_percentage = null // dash-null（無閾值段）
      // shell 通道釘住＝真 clean repo 狀態（branch='main'、無 dirty）——oracle
      // 與真執行環境同一態，byte-exact 才有意義（非決定論通道人工對齊）。
      const shell = { ...FULL.shell, 'git-branch': 'main', 'git-dirty': false }
      const input = { data, shell, env: FULL.env, now: FULL.now }
      const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
      // 前置自檢：D1 padding（每段尾綴一格）＋無箭頭／無 cap 之顯示形。
      // M6 C1：rate-5h 無 threshold、無 percent-reset variant——dash-null
      // 仍走百分比類 NA_TEXT（'(n/a)'，取代舊 '--'）。
      expect(strip(o), '前置自檢：oracle 顯示').toBe('55% (n/a) main ')

      const dir = repoClean()
      const b = runBash(emitBash(config, CATALOG), JSON.stringify(data), dir)
      const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), JSON.stringify(data), dir)
      expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
      expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
      expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    })
  },
)

// ── 5. 多列真執行場景（T3.3；(internal design doc)
//    §Verification 1／§shell 端執行期展開語意）──
// 三列 config、其中一條**非末列**的段在 `conditional-absent` 情境（mock-data.ts；
// session-name／effort／agent-name 等條件欄鍵缺席、hide 政策全數剔段——見
// segments.ts isValueDead／nullPolicy 文件）runtime 全滅：emit 期（groupByRow／
// groupSegmentsByRow）依**已啟用**段分組恆得三列、觸發四步執行期展開；執行期
// 該列全部段死亡 → 該列被剔除（步驟 2），不吐空行，存活列以單一 LF 相接
// （步驟 3，LF 數＝存活列−1）。emitBash／emitPs1 真跑 stdout 對
// `toAnsi(resolve(...))` hex 比對；另含三列全數 hide 段皆死→退化單一 SGR
// reset 一案（步驟 4，對齊 `resolve()` 的 `[[]]` 與 `toAnsi([[]])==='\x1b[0m'`
// 不變量）。另補（T1.3；(internal design doc) PLAN §前置加固）多列 × powerline ×
// powerlineArrow:false（v2 預設）真執行案——三列皆全存活（FULL 情境），驗
// D1 gating 語意（無箭頭／右 padding／lastArrowCap 無效）於多列場景列內
// 獨立成立。

const CONDITIONAL_ABSENT = MOCK_SCENARIOS_BY_ID['conditional-absent']

/** stdout 內 LF（0x0A）計數（bash／ps1 兩後端本檔其他區塊已驗證輸出無 CR）。 */
function countLf(buf: Buffer): number {
  let n = 0
  for (const byte of buf) if (byte === 0x0a) n++
  return n
}

/** 多列 stdout 結構斷言：LF 數＝expectedRows−1（步驟 3）＋逐列非空（步驟 2 不吐空行）。 */
function assertRowLayout(stdout: Buffer, expectedRows: number, label: string): void {
  expect(countLf(stdout), `${label} LF 數`).toBe(expectedRows - 1)
  const lines = stdout.toString('utf8').split('\n')
  expect(lines.length, `${label} 列數`).toBe(expectedRows)
  for (const [i, line] of lines.entries()) {
    expect(line, `${label} 第 ${i} 列不得為空行`).not.toBe('')
  }
}

describe.skipIf(!(BASH.ok && PS1.ok))(
  '多列真執行場景（T3.3；三列 config 非末列 row runtime 全滅／全列全滅退單一 reset）',
  () => {
    const input = { data: CONDITIONAL_ABSENT.data, shell: CONDITIONAL_ABSENT.shell, env: CONDITIONAL_ABSENT.env, now: CONDITIONAL_ABSENT.now }
    const stdin = JSON.stringify(CONDITIONAL_ABSENT.data)

    it('plain 三列：row 1（非末列，session-name＋effort）runtime 全滅 → 存活 2 列（row 0／row 2），LF 數正確、無空行', () => {
      const config = cfgT('plain', [
        segT('model', { color: A(75), row: 0 }),
        segT('session-name', { color: A(99), row: 1 }),
        segT('effort', { color: A(214), row: 1 }),
        segT('cost', { color: A(220), row: 2 }),
      ])
      const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
      // 前置自檢：conditional-absent 缺 session_name／effort（mock-data.ts）
      // → row 1（中間、非末列）全滅剔除，oracle 恰兩列。
      assertRowLayout(o, 2, 'oracle 前置自檢')

      const b = runBash(emitBash(config, CATALOG), stdin)
      const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), stdin)
      expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
      expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
      expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      assertRowLayout(b.stdout, 2, 'bash')
      assertRowLayout(p.stdout, 2, 'ps1')
    })

    it('powerline 三列（arrow gating true）：row 1（非末列，session-name＋effort）runtime 全滅 → 存活 2 列、箭頭與 cap 皆列內獨立', () => {
      const config = cfgT('powerline', [
        segT('model', { color: A(75), row: 0 }),
        segT('session-name', { color: A(99), row: 1 }),
        segT('effort', { color: A(214), row: 1 }),
        segT('cost', { color: A(220), row: 2 }),
      ]) // powerlineArrow 預設 mode==='powerline' → true（arrow gating true）
      const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
      assertRowLayout(o, 2, 'oracle 前置自檢')

      const b = runBash(emitBash(config, CATALOG), stdin)
      const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), stdin)
      expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
      expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
      expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      assertRowLayout(b.stdout, 2, 'bash')
      assertRowLayout(p.stdout, 2, 'ps1')
    })

    it('三列全滅（session-name／effort／agent-name 皆 hide 政策、conditional-absent 全缺席）→ 退化單一 SGR reset（非空字串）', () => {
      const config = cfgT('plain', [
        segT('session-name', { color: A(99), row: 0 }),
        segT('effort', { color: A(214), row: 1 }),
        segT('agent-name', { color: A(46), row: 2 }),
      ])
      const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
      // 前置自檢：resolve() 全滅退化 [[]] → toAnsi 恆為單一 reset（非空字串）。
      expect(o.toString('utf8'), 'oracle 前置自檢：單一 reset').toBe('\x1b[0m')

      const b = runBash(emitBash(config, CATALOG), stdin)
      const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), stdin)
      expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
      expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
      expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      assertRowLayout(b.stdout, 1, 'bash')
      assertRowLayout(p.stdout, 1, 'ps1')
      expect(b.stdout.toString('utf8'), 'bash 單一 reset 字面').toBe('\x1b[0m')
      expect(p.stdout.toString('utf8'), 'ps1 單一 reset 字面').toBe('\x1b[0m')
    })

    // (internal design doc) T1.3（PLAN §前置加固）：多列 ×
    // powerline mode × powerlineArrow:false（v2 預設）真執行補位——先前僅
    // 單列有此 gating 真執行覆蓋（見上方「D1 gating 真執行覆蓋」describe），
    // 多列版本缺席；契約出處同 06 傘狀 PLAN §D1 gating 條件表。段組合與
    // multirow-golden-configs.ts 之 multirow-powerline-noarrow 案同構（僅純
    // emit 黃金比對，未真執行）：三列（row 0/1/2）皆全存活（FULL 情境，非
    // conditional-absent，本案驗證重點非 row 死亡而是 D1 gating 語意本身）。
    it('powerline 三列 × powerlineArrow:false（FULL 情境，三列皆全存活）：無箭頭／右 padding／lastArrowCap 無效／跨列獨立，bash/ps1 皆與 oracle byte-exact', () => {
      const config = cfgT(
        'powerline',
        [
          segT('model', { color: A(93), row: 0 }),
          segT('cwd', { variant: 'basename', color: A(20), row: 0 }),
          segT('cost', { color: A(202), row: 1 }),
          segT('duration', { color: A(82), row: 1 }),
          segT('context-used', { threshold: TRAFFIC, color: A(240), row: 2 }),
          segT('rate-5h', { color: A(129), row: 2 }),
        ],
        false, // powerlineArrow=false（lastArrowCap 預設 true 但無效——D1 gating）
      )
      const fullInput = { data: FULL.data, shell: FULL.shell, env: FULL.env, now: FULL.now }
      const fullStdin = JSON.stringify(FULL.data)
      const o = Buffer.from(toAnsi(resolve(config, fullInput)), 'utf8')
      assertRowLayout(o, 3, 'oracle 前置自檢')
      // 前置自檢：無箭頭字面（段間僅 reset+色碼交接，無 powerline 箭頭
      // glyph）＋每段 value 後右 padding 一空格＋列間單一 LF、無跨列殘留。
      expect(strip(o), '前置自檢：oracle 顯示（無箭頭、右 padding）').toBe(
        'Fable 5 ClientKit \n$3.3341 1h23m \n42% 63% ',
      )

      const b = runBash(emitBash(config, CATALOG), fullStdin)
      const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), fullStdin)
      expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
      expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
      expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      assertRowLayout(b.stdout, 3, 'bash')
      assertRowLayout(p.stdout, 3, 'ps1')
    })
  },
)

// ── rowSeparators 端到端（T1.6；(internal design doc) §D1
//    golden 策略）：整列執行期死亡＋後列覆寫 ──
// resolve.test.ts「rowSeparators 啟用位映射」describe 的「整列執行期死亡
// 對位案」（node 單元層級，resolve() 直接呼叫）已釘住：`rowSeparators` 的
// 索引基準＝「config 正規化後的啟用列位」（enabledRowOrder），與「執行期
// 存活列緊縮序」（renderRowOrder）分岔時不得混淆。本區塊補其端到端 byte-
// exact 覆蓋（真跑 bash／ps1，非僅 TS 參考互證）：同一 config／scenario，
// 證 emitBash／emitPs1 的逐列 SEP 展開對此分岔亦不混淆——若兩產生器誤以
// 「存活列緊縮序」索引 rowSeparators（如直接以迴圈變數 r 取代啟用位），
// 存活輸出的最後一列會誤取啟用位 1 的 null（退全域 '|'）而非啟用位 2 的
// 覆寫 '›'，本案即可揪出。
describe.skipIf(!(BASH.ok && PS1.ok))(
  'rowSeparators 端到端（T1.6）：整列執行期死亡＋後列覆寫',
  () => {
    it(
      '三列 plain：啟用位 0（session-name+vim-mode）於 early-null 情境全滅、' +
        '啟用位 1（context-used+context-remaining，dash 政策，null 顯式繼承）／' +
        '啟用位 2（git-branch+cost，覆寫「›」，亦為存活輸出最後一列）存活——' +
        'bash/ps1 皆與 oracle byte-exact',
      () => {
        const EARLY = MOCK_SCENARIOS_BY_ID['early-null']
        const config: BuilderConfig = {
          ...cfgT('plain', [
            segT('session-name', { row: 0 }),
            segT('vim-mode', { row: 0 }),
            segT('context-used', { row: 1 }),
            segT('context-remaining', { row: 1 }),
            segT('git-branch', { color: A(46), row: 2 }),
            segT('cost', { color: A(220), row: 2 }),
          ]),
          rowSeparators: [
            { kind: 'preset', value: '·' }, // 啟用位 0：全滅列的覆寫（distractor，不得滲入輸出）。
            null, // 啟用位 1：null 顯式繼承全域 '|'。
            { kind: 'preset', value: '›' }, // 啟用位 2：存活輸出最後一列，須用此覆寫。
          ],
        }
        // git-branch 為真 shell-out 段：受控 clean repo（branch='main'）對齊
        // EARLY.shell['git-branch']（沿 D1 gating 真執行覆蓋區塊的 repoClean 慣例）。
        const dir = repoClean()
        const stdin = JSON.stringify(EARLY.data)
        const input = { data: EARLY.data, shell: EARLY.shell, env: EARLY.env, now: EARLY.now }
        const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
        // 前置自檢：啟用位 0 全滅剔除、存活恰兩列；第一列（原啟用位 1）
        // 用全域 '|'（null 繼承）、第二列（原啟用位 2，亦存活最後一列）
        // 用覆寫 '›'（非誤用啟用位 1 的 null）。
        assertRowLayout(o, 2, 'oracle 前置自檢')
        expect(strip(o), '前置自檢：oracle 顯示').toBe(`${NA_TEXT}|${NA_TEXT}\nmain›$0.0000`)

        const b = runBash(emitBash(config, CATALOG), stdin, dir)
        const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), stdin, dir)
        expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
        expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
        expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
        expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
        assertRowLayout(b.stdout, 2, 'bash')
        assertRowLayout(p.stdout, 2, 'ps1')
      },
    )
  },
)

// ── 6. T4.6 整合收攏案（08-PLAN Rev 4 §5／TASKS.md T4.6）──
// (a) bar×倒數×auto 同列：置於雙列 config（row 0＝三特徵同列、row 1＝
//     對照段），驗證「同列多特徵共存」於多列語意（分隔符／箭頭不跨列）下
//     仍成立；倒數段需 STATUSLINE_NOW_EPOCH 顯式釘 now 對齊 oracle
//     （FULL scenario：model.id='claude-fable-5'→auto 214、
//     context_window.used_percentage=42.5→bar 填 8 格・桶索引 4（190）、
//     five_hour.resets_at=now+7200s→"↺ 2h (HH:MM)"）。
// (b) auto×powerline（arrow／noarrow 兩形）：sp4/REPORT.md verify.mjs
//     案 10/11 已驗證 auto 展開色參與 powerline 併元素／autoFg 對比的
//     位元組配方；既有 emit-bash.test.ts／emit-ps1.test.ts 的 auto 組合
//     案恆為 arrow=true（cfgT 預設 `powerlineArrow: mode==='powerline'`
//     無 override），從未真執行覆蓋 arrow=false——本節補齊。

const AUTO_BAR_RESET_ROW: SegmentConfig[] = [
  segT('model', { color: { kind: 'auto' } }),
  segT('context-used', { prefix: 'ctx', bar: true, threshold: TRAFFIC, color: A(240) }),
  segT('reset-5h', { color: A(99) }),
]

describe.skipIf(!(BASH.ok && PS1.ok))(
  'T4.6 整合案：bar×倒數×auto 同列（雙列 config，row 0 三特徵同列）',
  () => {
    it('plain：row 0＝model(auto)+context-used(bar,threshold)+reset-5h(倒數)、row 1＝cost，byte-exact', () => {
      const config = cfgT('plain', [
        ...AUTO_BAR_RESET_ROW.map((s) => ({ ...s, row: 0 })),
        segT('cost', { color: A(220), row: 1 }),
      ])
      const data = clone(FULL.data)
      const input = { data, shell: FULL.shell, env: FULL.env, now: FULL.now }
      const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
      assertRowLayout(o, 2, 'oracle 前置自檢')

      const stdin = JSON.stringify(data)
      const env = nowEnv(FULL.now)
      const b = runBash(emitBash(config, CATALOG), stdin, undefined, env)
      const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), stdin, undefined, env)
      expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
      expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
      expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      assertRowLayout(b.stdout, 2, 'bash')
      assertRowLayout(p.stdout, 2, 'ps1')
    })

    it('powerline（arrow=true, cap=true）：row 0＝同三特徵同列、row 1＝duration，byte-exact', () => {
      const config = cfgT(
        'powerline',
        [
          ...AUTO_BAR_RESET_ROW.map((s) => ({ ...s, row: 0 })),
          segT('duration', { color: A(46), row: 1 }),
        ],
        true,
      )
      const data = clone(FULL.data)
      const input = { data, shell: FULL.shell, env: FULL.env, now: FULL.now }
      const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
      assertRowLayout(o, 2, 'oracle 前置自檢')

      const stdin = JSON.stringify(data)
      const env = nowEnv(FULL.now)
      const b = runBash(emitBash(config, CATALOG), stdin, undefined, env)
      const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), stdin, undefined, env)
      expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
      expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
      expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      assertRowLayout(b.stdout, 2, 'bash')
      assertRowLayout(p.stdout, 2, 'ps1')
    })
  },
)

describe.skipIf(!(BASH.ok && PS1.ok))(
  'T4.6 整合案：auto × powerline（arrow／noarrow 兩形；sp4 已驗配方）',
  () => {
    it('arrow=true：model(explicit A226)→effort(auto) 箭頭交接，byte-exact', () => {
      const config = cfgT(
        'powerline',
        [segT('model', { color: A(226) }), segT('effort', { color: { kind: 'auto' } })],
        true,
      )
      const data = clone(FULL.data) // effort.level='high' → auto 索引 4
      const input = { data, shell: FULL.shell, env: FULL.env, now: FULL.now }
      const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')

      const stdin = JSON.stringify(data)
      const b = runBash(emitBash(config, CATALOG), stdin)
      const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), stdin)
      expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
      expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
      expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    })

    it('arrow=false（noarrow）：effort(auto)+model(explicit A226)，右 padding＋auto byte-exact', () => {
      const config = cfgT(
        'powerline',
        [segT('effort', { color: { kind: 'auto' } }), segT('model', { color: A(226) })],
        false,
      )
      const data = clone(FULL.data) // effort.level='high' → auto 索引 4
      const input = { data, shell: FULL.shell, env: FULL.env, now: FULL.now }
      const o = Buffer.from(toAnsi(resolve(config, input)), 'utf8')
      // 前置自檢：無箭頭字面（powerlineArrow:false）。
      expect(o.toString('utf8')).not.toContain(POWERLINE_ARROW)

      const stdin = JSON.stringify(data)
      const b = runBash(emitBash(config, CATALOG), stdin)
      const p = runPs1(PS1_EXE, emitPs1(config, CATALOG), stdin)
      expect(b.status, `bash stderr=${b.stderr}`).toBe(0)
      expect(p.status, `ps1 stderr=${p.stderr}`).toBe(0)
      expect(hexEqual(b.stdout, o), `bash≠oracle\n b=${b.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
      expect(hexEqual(p.stdout, o), `ps1≠oracle\n p=${p.stdout.toString('hex')}\n o=${o.toString('hex')}`).toBe(true)
    })
  },
)

// ── 7. skipIf meta（CI 設定不變量；PLAN §CI 拓撲／(internal design doc)
//    T2.1・T2.2：CI 跨後端 gate meta 守門，08 DRIFT 同族合帳） ──
//
// T2.1 真值表（本機 win32 實測；CI 兩 leg 由 test.yml＋本檔 detect*／
// exec-detect-test-utils.ts `detectJq` 邏輯推導，標「推導」；完整逐環境對照落
// (internal design doc)；sprint 17 D5 起 win32 bash+jq 只認 `SP5_JQ_DIR`）：
//   | gate                        | 本機 win32 | CI ubuntu | CI windows |
//   |------------------------------|-----------|-----------|------------|
//   | BASH.ok（bash+jq）           | 依 SP5_JQ_DIR：設且有效→true／未設→false | true（推導：Ensure jq step）| false（推導：SP5_JQ_DIR 未設） |
//   | PS1.ok（ps1 5.1）            | true（實測）| false（推導：detectPs1 非 win32 短路）| true（推導：powershell.exe 內建） |
//   | PWSH7.ok（pwsh 7）           | true（實測）| 推導不確定（未鎖，見下）    | true（推導：test.yml 檔頭註解明文「runner 預裝」） |
//   | BASH.ok && PS1.ok（9 個跨後端等價案 describe 之門——見全檔 9 個
//     `describe.skipIf(!(BASH.ok && PS1.ok))`，grep 可得；標題錨點例：
//     「resets 後綴 — bash==ps1==oracle（同機同 TZ byte-exact）」／
//     「shell-out 等價 — bash vs ps1（真 git repo）」） | true（實測） | false（PS1.ok 恆假） | false（BASH.ok 恆假） |
// 「BASH.ok && PS1.ok」兩 leg 皆恆假＝「僅本機雙後端環境可跑」，非無聲消失
// ——本節新增守門明文標記＋鎖住此拓撲（見下方新增二案）。
describe('skipIf meta（每後端至少一 leg 未 skip；present 卻 skip＝bug；T2.2 拓撲鎖）', () => {
  it('環境自述（各後端 enable／reason＋跨後端組合門）', () => {
    const say = (name: string, e: { ok: boolean; reason?: string }): void =>
      console.warn(`[t27] ${name}: ${e.ok ? 'ENABLED' : `SKIP（${(e as { reason: string }).reason}）`}`)
    say('bash+jq', BASH)
    say('ps1 5.1', PS1)
    say('pwsh 7', PWSH7)
    const dual = BASH.ok && PS1.ok
    console.warn(
      `[t27] cross-backend combo (BASH.ok && PS1.ok，9 個跨後端等價案 describe 之門): ${
        dual ? 'ENABLED（本機雙後端）' : 'SKIP（僅本機雙後端環境可跑；CI 兩 leg 依已知拓撲恆假，非 bug——見下方拓撲鎖斷言）'
      }`,
    )
    expect(true).toBe(true)
  })

  it('至少一後端未 skip（防全 skip 的環境全毀／CI 設定 bug）', () => {
    expect([BASH.ok, PS1.ok, PWSH7.ok].some((e) => e), '所有真執行後端全 skip').toBe(true)
  })

  it('平台載重後端 present 卻 skip = skipIf 條件 bug', () => {
    if (process.platform === 'win32') {
      // 獨立新鮮探測（不重用 PS1 detection）：win32 恆有 powershell.exe。
      const fresh = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0'])
      expect(fresh.error === undefined && fresh.status === 0, 'win32 應有 powershell.exe').toBe(true)
      expect(PS1.ok, `ps1 5.1 present 卻 skip（skipIf bug）：${PS1.ok ? '' : (PS1 as { reason: string }).reason}`).toBe(true)
    } else {
      const fresh = spawnSync('bash', ['-c', 'exit 0'])
      if (fresh.error === undefined && fresh.status === 0) {
        expect(BASH.ok, `bash present 卻 skip（skipIf bug）：${BASH.ok ? '' : (BASH as { reason: string }).reason}`).toBe(true)
      }
    }
  })

  it('本機可用之 bash＋jq 不得 skip（.t23/.t24 環境前提；win32：bash 存在且 SP5_JQ_DIR 有效 ⇒ BASH.ok 必真）', () => {
    // sprint 17 D5 改寫：win32 jq 只認 `SP5_JQ_DIR`（不再有 repo 內 bundled
    // 候選）。新鮮探測（不重用 BASH）：bash 走 helper `detectBash`（純候選＋
    // existsSync）、`SP5_JQ_DIR` 有效性以本案自行 existsSync 兩個接受檔名判定
    // ——兩者皆真而 BASH.ok 為假＝skipIf/偵測 bug。`SP5_JQ_DIR` 指向無 jq
    // 之目錄時刻意 skip 屬正確行為（非此不變量）。非 win32 由上一案
    // 「平台載重後端 present 卻 skip」涵蓋。
    if (process.platform !== 'win32') return
    const jqSrcDir = process.env.SP5_JQ_DIR
    if (jqSrcDir === undefined || jqSrcDir === '') {
      // 本機 win32 非 CI 未設：bash＋jq 真執行案全數 skip——提醒一次（CI
      // windows leg 未設為既有刻意拓撲，由下方拓撲鎖把關，不另提醒）。
      if (process.env.GITHUB_ACTIONS !== 'true') {
        console.warn(
          '[t27] win32 本機未設 SP5_JQ_DIR：bash＋jq 真執行案全數 skip' +
            `（設 SP5_JQ_DIR=<含 ${WIN_JQ_BIN_NAMES.join(' 或 ')} 之目錄> 以啟用）`,
        )
      }
      return
    }
    const bashPresent = detectBash() !== undefined
    const jqDirValid = WIN_JQ_BIN_NAMES.some((n) => existsSync(join(jqSrcDir, n)))
    if (bashPresent && jqDirValid) {
      expect(BASH.ok, 'bash 存在且 SP5_JQ_DIR 有效卻 skip（skipIf/偵測 bug）').toBe(true)
    }
  })

  // ── T2.2 新增：CI leg 專屬拓撲守門（GITHUB_ACTIONS 辨識現在跑在哪個
  //    leg；本機無此 env、恆不觸發下列斷言本體，if 條件本身非恆真——見
  //    T2.1 真值表；CI 上依 leg 觸發對應分支）──
  const isCi = process.env.GITHUB_ACTIONS === 'true'
  const isWin = process.platform === 'win32'

  // ubuntu leg 不斷言之理由：test.yml 檔頭註解僅明文保證 windows runner
  // 「預裝」pwsh 7，未對 ubuntu leg 做同等承諾——若在此對 ubuntu leg 也斷言
  // PWSH7.ok，一旦 ubuntu runner image 未附 pwsh（非本專案控制範圍）即會
  // 平白翻紅，故本案刻意只鎖 windows leg（防誤紅）。
  it('windows leg（CI）：pwsh 7 present 卻 skip＝bug（test.yml 檔頭註解明文「runner 預裝」）', () => {
    if (isCi && isWin) {
      expect(
        PWSH7.ok,
        `windows leg pwsh 7 present 卻 skip（skipIf bug）：${PWSH7.ok ? '' : (PWSH7 as { reason: string }).reason}`,
      ).toBe(true)
    }
  })

  it('跨後端等價案門（BASH.ok && PS1.ok）之 CI 拓撲鎖：兩 leg 皆恆假為既有刻意拓撲，非無聲消失', () => {
    // 鎖住現況（非鎖死改動）：若未來拓撲改變（如 CI 誤設 SP5_JQ_DIR），本斷言
    // 會翻紅逼出人工覆核並更新 T2.1 真值表／本斷言——而非讓 9 個跨後端等價案
    // describe 悄悄從「僅本機可跑」變成「CI 亦可跑」卻無人知曉（或反之，悄悄
    // 失去 CI 覆蓋）。
    if (isCi && isWin) {
      expect(
        BASH.ok,
        `windows leg BASH.ok 預期為 false（SP5_JQ_DIR 未設）；若為 true 代表拓撲已改變，需人工覆核並更新 WORKS 真值表` +
          '（或本機誤設 GITHUB_ACTIONS env——非 CI 環境請先 unset 再判斷）',
      ).toBe(false)
      // reason 字串全集（exec-detect-test-utils.ts `EXEC_DETECT_REASONS`，
      // `detectJq` win32 分支可能產生）：
      //   - 'Git Bash 不存在（SP5_BASH 可指定；PATH 上的 bash 可能為 WSL 不可用）'（bash 二進位未偵得）
      //   - 'SP5_JQ_DIR 未設'（CI windows leg 現行既有拓撲之預期落點）
      //   - 'SP5_JQ_DIR 指定目錄無 jq.exe／jq-windows-amd64.exe'（顯式設定但該目錄缺 jq）
      // 下方 regex 只鎖「未設」一者（sprint 17 D5 收緊）：CI 不應設 SP5_JQ_DIR，
      // 設了卻指錯目錄同屬拓撲改變、應翻紅。
      if (!BASH.ok) {
        expect(
          (BASH as { reason: string }).reason,
          `windows leg BASH skip 理由須匹配已知原因（SP5_JQ_DIR 未設），實際：${(BASH as { reason: string }).reason}`,
        ).toMatch(/^SP5_JQ_DIR 未設/)
      }
    }
    if (isCi && !isWin) {
      // ubuntu leg：PS1.ok 恆假為 detectPs1() 對非 win32 之短路（程式邏輯
      // 事實，非環境探測結果）——仍明文斷言，防未來改動誤放寬此短路而未察覺。
      expect(PS1.ok, 'ubuntu leg PS1.ok 預期為 false（detectPs1 對非 win32 短路）').toBe(false)
    }
    if (isCi) {
      expect(
        BASH.ok && PS1.ok,
        '跨後端等價案門（BASH.ok && PS1.ok）於 CI 兩 leg 依現況拓撲皆應為 false（僅本機雙後端環境可跑）',
      ).toBe(false)
    }
  })
})

afterAll(() => {
  if (bashScriptDir !== '') rmSync(bashScriptDir, { recursive: true, force: true })
  cleanupOwnedJqDir(BASH) // 只刪 owned 暫存 jq 複本
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})
