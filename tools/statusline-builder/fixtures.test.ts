/**
 * T5.4（(internal design doc) §Verification 手動驗收
 * 「複刻使用者現役 7 列配置」／TASKS.md T5.4）：`fixtures/reference-7row.json`
 * ——複刻 `(internal design doc)`（使用者
 * 現役 PowerShell statusline，7 列：line1／context／Lim5H／Lim7D／
 * Tokens／cwd／末列）的自動化驗收面。
 *
 * ── 逐列對映表（reference 列 → 段配置；權威來源見 fixtures/reference-7row.json） ──
 * | reference 列 | 段（依 config.segments 內順序） | 備註 |
 * |---|---|---|
 * | line1（branch\|model+effort\|[session]） | git-branch, model(auto),
 *   effort(auto), session-name | model／effort 原腳本以 regex 手刻顏色，
 *   語意對應本引擎 `color:{kind:'auto'}`（實際色票值早於本任務定案，
 *   不強求與舊腳本色碼一致）；session-name 原腳本以 `[...]` 包裹，本目錄
 *   僅有 prefix（無 suffix 通道）可用，故不加中括號——純視覺差異。 |
 * | context（Context bar） | context-remaining（bar+remaining-gradient） |
 *   **差異**：原腳本顯示 `used_percentage`（本段替換為語意互補的
 *   `remaining_percentage`＋逆序模板）——同一份 context window 用量資料，
 *   僅顯示視角（已用/剩餘）互換；此替換同時是 T5.4 驗收明訂
 *   「`context-remaining` 逆序模板顏色方向」特徵的落點。 |
 * | Lim 5H | rate-5h（bar+limit-gradient）, reset-5h（倒數） | bar+數值+
 *   倒數同列＝T5.4 驗收明訂特徵之一；rate-5h 用 variant 預設
 *   'percent'（非 'percent-reset'）以免與 reset-5h 重複倒數（T5.2 重複
 *   提示語意）。 |
 * | Lim 7D | rate-7d（bar+limit-gradient）, reset-7d（倒數） | 同上結構。 |
 * | Tokens | token-in, token-out, cache-hit | 原腳本以 `·` 分隔、本 fixture
 *   全域分隔符＝`\|`（BuilderConfig 分隔符為單一全域設定，非逐列可調——
 *   既有架構限制，非本任務新缺口）。 |
 * | cwd | cwd（variant='full'） | 原腳本印 `workspace.current_dir` 全路徑。 |
 * | 末列（thinking\|vim\|datetime） | thinking, vim-mode, clock | 原腳本無
 *   色（皆 plain 字面），fixture 同步不掛色。 |
 *
 * 其餘 14 段（project-dir／output-style／version／cost／duration／
 * lines-changed／context-size／context-used／agent-name／pr／repo／
 * worktree／worktree-branch／git-dirty）於 reference 腳本無對應內容，
 * fixture 內維持停用（defaultSegmentConfig 形）。
 *
 * ── 本檔涵蓋（brief 分工：使用者親測項見
 * (internal design doc)，不在此列）──
 * 1. fixture JSON 經 `deserializeConfig` 往返冪等（載入即所得）。
 * 2. 7 列結構斷言（啟用段 row 分佈＝0..6 恰 7 列）＋逐列段序機械比對。
 * 3. bar＋數值＋倒數同列（rate-5h／rate-7d 各自與 reset-5h／reset-7d 同列）。
 * 4. `context-remaining` 套 `remaining-gradient`（逆序模板）：結構斷言＋
 *    resolve 實跑顏色方向斷言（低剩餘%→紅、較高剩餘%→綠）。
 * 5. auto 配色（model／effort）預覽端展開為具體 ColorSpec（resolve 實跑）。
 * 6. 「auto 預覽 vs 產出腳本一致」自動化形：以 fixture config 跑
 *    `resolve()`（FULL 情境 now）取得 preview bytes，與 emitBash／emitPs1
 *    真執行（`STATUSLINE_NOW_EPOCH` 注入對齊 now）byte-exact 對拍——沿
 *    `pipeline.integration.test.ts` 的三後端 real-exec 慣例。
 *
 * SR 播報三處（T5.1／T5.2 DOM 測試已覆蓋，見 bar-toggle.dom.test.ts／
 * auto-color-duplicate-hint.dom.test.ts）與「倒數段真機 Claude Code 渲染」
 * 為使用者親測項，本檔不重複。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { deserializeConfig, serializeConfig, type BuilderConfig } from './config.js'
import { toAnsi } from './emit-ansi.js'
import { emitBash } from './emit-bash.js'
import { emitPs1 } from './emit-ps1.js'
import { cleanupOwnedJqDir, detectJq, type BashJqExec } from './exec-detect-test-utils.js'
import { MOCK_SCENARIOS_BY_ID } from './mock-data.js'
import { resolve, type ResolveInput, type StyledRun } from './resolve.js'
import { DESCRIPTORS_BY_ID, SEGMENT_CATALOG } from './segments.js'
import { bucketIndex, THRESHOLD_TEMPLATES } from './threshold.js'

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/reference-7row.json', import.meta.url))
const rawFixture: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
const FULL = MOCK_SCENARIOS_BY_ID.full
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

// ── 1. sanitizeConfig 往返冪等 ──

describe('reference-7row fixture — sanitizeConfig 往返冪等', () => {
  it('deserializeConfig(fixture) 與 fixture 本身逐欄深相等（無欄位被清洗掉）', () => {
    const loaded = deserializeConfig(JSON.stringify(rawFixture), SEGMENT_CATALOG)
    expect(loaded).toEqual(rawFixture)
  })

  it('二次序列化／反序列化仍與首次結果相同（冪等）', () => {
    const once = deserializeConfig(JSON.stringify(rawFixture), SEGMENT_CATALOG)
    const twice = deserializeConfig(serializeConfig(once), SEGMENT_CATALOG)
    expect(twice).toEqual(once)
  })

  it('fixture 為合法 BuilderConfig v2（version=2、mode=plain、30 段）', () => {
    const loaded = deserializeConfig(JSON.stringify(rawFixture), SEGMENT_CATALOG)
    expect(loaded.version).toBe(2)
    expect(loaded.mode).toBe('plain')
    expect(loaded.segments.length).toBe(SEGMENT_CATALOG.ids.length)
  })
})

/**
 * canary — migration-forgotten path 防護（T3.3(a)，(internal design doc)
 * hardening/PLAN.md §Milestone 3）：與上方「sanitizeConfig 往返冪等」
 * 檢驗的維度不同——冪等測的是「清洗是否穩定」，本案測的是「未來版本忘寫
 * 遷移步進時是否亮紅」。
 *
 * **bump CONFIG_VERSION 時勿重生本 fixture**：`reference-7row.json` 內的
 * `version: 2` 永久凍結，本檔代表一份「舊存檔」。未來 CONFIG_VERSION 升
 * 至 3 時，本檔會因 `raw.version(2) !== CONFIG_VERSION(3)` 而改走
 * `migrateConfig`（config.ts `MIGRATION_STEPS` 階梯，T3.2）；若忘寫
 * `MIGRATION_STEPS[2]`（2→3 步進），依 T3.2 契約 migrate 會回傳
 * `defaultConfig(catalog)`（30 段全停用），與下方凍結的期望（7 列滿配
 * ＝fixture 本身）相差懸殊，本斷言即由綠翻紅、逼出忘寫——這正是本檔
 * 「不得重生」的理由：一旦用當時最新的 sanitizeConfig 輸出覆寫重生，
 * canary 就永遠測不到「舊存檔走 migrate」這條路徑。
 */
describe('canary — migration-forgotten path 防護（T3.3(a)）', () => {
  it('reference-7row fixture：deserializeConfig 輸出與凍結期望（fixture 本身＝現行 sanitizeConfig 輸出）整份 deepEqual', () => {
    const result = deserializeConfig(JSON.stringify(rawFixture), SEGMENT_CATALOG)
    // toStrictEqual（非 toEqual，(internal design doc) Minority 4 採納）：
    // 「整份 deepEqual」的 PLAN 宣稱粒度須含「欄位留成 undefined」型部分損失
    // ——toEqual 對此盲視（undefined 值視同欄位缺席）。
    expect(result).toStrictEqual(rawFixture)
  })
})

const CONFIG: BuilderConfig = deserializeConfig(JSON.stringify(rawFixture), SEGMENT_CATALOG)

// ── 2. 7 列結構＋逐列段序機械比對（檔頭對映表的可執行版本） ──

/** 逐列對映（reference 列 → 段序）；權威敘述見檔頭表格。 */
const ROW_MAP: Readonly<Record<number, readonly string[]>> = {
  0: ['git-branch', 'model', 'effort', 'session-name'],
  1: ['context-remaining'],
  2: ['rate-5h', 'reset-5h'],
  3: ['rate-7d', 'reset-7d'],
  4: ['token-in', 'token-out', 'cache-hit'],
  5: ['cwd'],
  6: ['thinking', 'vim-mode', 'clock'],
}

describe('7 列結構', () => {
  it('啟用段的 row 分佈恰為 [0,1,2,3,4,5,6]（7 列，與 reference 腳本列數相符）', () => {
    const rows = [...new Set(CONFIG.segments.filter((s) => s.enabled).map((s) => s.row ?? 0))].sort(
      (a, b) => a - b,
    )
    expect(rows).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('逐列段序符合對映表（ROW_MAP）', () => {
    for (const [rowStr, ids] of Object.entries(ROW_MAP)) {
      const row = Number(rowStr)
      const actual = CONFIG.segments.filter((s) => s.enabled && (s.row ?? 0) === row).map((s) => s.id)
      expect(actual, `row ${row}`).toEqual(ids)
    }
  })

  it('停用段恰為目錄扣除 16 個啟用段後的餘下 14 段', () => {
    const enabledIds = new Set(Object.values(ROW_MAP).flat())
    const disabled = CONFIG.segments.filter((s) => !s.enabled).map((s) => s.id)
    expect(disabled.length).toBe(SEGMENT_CATALOG.ids.length - enabledIds.size)
    for (const id of disabled) expect(enabledIds.has(id)).toBe(false)
  })
})

// ── 3. bar＋數值＋倒數同列 ──

describe('bar＋數值＋倒數同列', () => {
  it('rate-5h（bar）與 reset-5h（倒數）同 row；rate-7d（bar）與 reset-7d（倒數）同 row', () => {
    const byId = new Map(CONFIG.segments.map((s) => [s.id, s]))
    expect(byId.get('rate-5h')?.bar).toBe(true)
    expect(byId.get('rate-5h')?.row).toBe(byId.get('reset-5h')?.row)
    expect(byId.get('rate-7d')?.bar).toBe(true)
    expect(byId.get('rate-7d')?.row).toBe(byId.get('reset-7d')?.row)
  })

  it('resolve 實跑（FULL 情境）：Lim 5H 列同時含 bar 字元（█）、百分比數值與倒數箭頭（↺）', () => {
    const input: ResolveInput = { data: FULL.data, shell: FULL.shell, env: FULL.env, now: FULL.now }
    const rows = resolve(CONFIG, input)
    const limRow5h = strip(toAnsi([rows[2]])) // row 2＝Lim 5H（rate-5h+reset-5h，見 ROW_MAP）
    expect(limRow5h).toContain('█')
    expect(limRow5h).toMatch(/\d+%/)
    expect(limRow5h).toContain('↺')
  })
})

// ── 4. context-remaining 套 remaining-gradient（逆序模板）＋顏色方向 ──

describe('context-remaining — remaining-gradient 逆序模板', () => {
  it('threshold buckets 與 THRESHOLD_TEMPLATES["remaining-gradient"] 逐桶相等', () => {
    const seg = CONFIG.segments.find((s) => s.id === 'context-remaining')!
    expect(seg.threshold).toEqual(THRESHOLD_TEMPLATES['remaining-gradient'])
    expect(seg.bar).toBe(true)
  })

  it('resolve 實跑：低剩餘% 呈紅（196）、較高剩餘% 呈綠（34）——與 limit-gradient 同數值之桶色方向相反', () => {
    const build = (pct: number): readonly StyledRun[] => {
      const data = clone(FULL.data)
      data.context_window.remaining_percentage = pct
      const rows = resolve(CONFIG, { data, shell: FULL.shell, env: FULL.env, now: FULL.now })
      return rows[1] // row 1＝context-remaining（僅此一段，見 ROW_MAP）
    }
    const low = build(5) // bucket 0
    const high = build(25) // bucket 2
    // bar 4-run：run[1]=filled、run[3]=value，兩者皆套桶色（resolve.ts bar 分支）。
    expect(low[1].fg).toEqual({ kind: 'ansi256', index: 196 })
    expect(low[3].fg).toEqual({ kind: 'ansi256', index: 196 })
    expect(high[1].fg).toEqual({ kind: 'ansi256', index: 34 })
    expect(high[3].fg).toEqual({ kind: 'ansi256', index: 34 })
    // 方向對照：同數值於「用量」語意模板（limit-gradient）不會得到相同顏色——
    // 非僅結構上是逆序陣列，而是 resolve 實際派發的桶色確實方向相反。
    expect(THRESHOLD_TEMPLATES['limit-gradient'].buckets[bucketIndex(5)]).not.toEqual({
      kind: 'ansi256',
      index: 196,
    })
    expect(THRESHOLD_TEMPLATES['limit-gradient'].buckets[bucketIndex(25)]).not.toEqual({
      kind: 'ansi256',
      index: 34,
    })
  })
})

// ── 5. auto 配色（model／effort；依 reference 實況——原腳本以 regex 手刻對應邏輯） ──

describe('auto 配色（model／effort）', () => {
  it('config 層：model／effort 段色皆為 {kind:"auto"}', () => {
    const byId = new Map(CONFIG.segments.map((s) => [s.id, s]))
    expect(byId.get('model')?.color).toEqual({ kind: 'auto' })
    expect(byId.get('effort')?.color).toEqual({ kind: 'auto' })
  })

  it('resolve 實跑（FULL 情境）：auto 展開為具體 ColorSpec（model.id=claude-fable-5→214；effort.level=high→4）', () => {
    const input: ResolveInput = { data: FULL.data, shell: FULL.shell, env: FULL.env, now: FULL.now }
    const rows = resolve(CONFIG, input)
    const line1 = toAnsi([rows[0]]) // row 0＝line1（見 ROW_MAP）
    expect(line1).toContain('\x1b[38;5;214m')
    expect(line1).toContain('\x1b[38;5;4m')
  })
})

// ── 6. 「auto 預覽 vs 產出腳本一致」：三後端 real-exec byte-exact
//    （沿 pipeline.integration.test.ts 慣例；STATUSLINE_NOW_EPOCH 注入對齊 now） ──

// sprint 17 D5：探測收斂至 exec-detect-test-utils.ts（`detectJq`；原本檔
// `detectBashExec` 複本已移除，與 emit-bash.test.ts／pipeline.integration.test.ts
// 共用同一實作與 reason 字串全集）。win32 leg 只認 `SP5_JQ_DIR`（jq.exe 或
// jq-windows-amd64.exe 皆接受），一律複製為暫存目錄下的 jq.exe（`owned:true`）；
// afterAll 經 `cleanupOwnedJqDir` 只刪該暫存複本、永不碰 `SP5_JQ_DIR` 來源目錄
// （歷史上曾因直吃來源目錄而遞迴誤刪）。非 win32 走 PATH `jq --version`。
const BASH: BashJqExec = detectJq()
const IS_WIN = process.platform === 'win32'
const bashScriptDir = BASH.ok ? mkdtempSync(join(tmpdir(), 'sl-fx-sh-')) : ''
const BOM = Buffer.from([0xef, 0xbb, 0xbf])
let seq = 0

function withPath(env: NodeJS.ProcessEnv, newPath: string): NodeJS.ProcessEnv {
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === 'path') delete env[k]
  }
  env.PATH = newPath
  return env
}

interface RunResult {
  status: number | null
  stdout: Buffer
  stderr: string
}

function runBash(script: string, stdinJson: string, extraEnv: Record<string, string>, cwd?: string): RunResult {
  if (!BASH.ok) throw new Error('runBash without bash')
  const scriptPath = join(bashScriptDir, `fx-${seq++}.sh`)
  writeFileSync(scriptPath, script) // emitBash 已 LF、無 BOM
  let env: NodeJS.ProcessEnv = { ...process.env, MSYS_NO_PATHCONV: '1', ...extraEnv }
  if (BASH.jqDir !== undefined) env = withPath(env, BASH.jqDir + delimiter + (process.env.PATH ?? ''))
  const r = spawnSync(BASH.bash, [scriptPath], { input: Buffer.from(stdinJson, 'utf8'), env, cwd })
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8') }
}

function runPs1(script: string, stdinJson: string, extraEnv: Record<string, string>, cwd?: string): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'sl-fx-ps-'))
  const file = join(dir, 'statusline.ps1')
  writeFileSync(file, Buffer.concat([BOM, Buffer.from(script, 'utf8')]))
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
      input: Buffer.from(stdinJson, 'utf8'),
      env: { ...process.env, ...extraEnv },
      cwd,
      maxBuffer: 1024 * 1024,
    })
    return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function fixtureOracle(): Buffer {
  const input: ResolveInput = { data: FULL.data, shell: FULL.shell, env: FULL.env, now: FULL.now }
  return Buffer.from(toAnsi(resolve(CONFIG, input)), 'utf8')
}

/**
 * `clock`（末列，row 6）為 shell-out 段：預覽端讀 mock 固定值
 * （`FULL.shell.clock`），真執行端讀**當下系統真時鐘**（`date +%H:%M`／
 * `Get-Date -Format HH:mm`）——兩者本質上不可能 byte-exact（既有測試套件
 * 對此的一貫作法：byte-exact real-exec 案一律不含 `clock` 段，見
 * emit-bash.test.ts／emit-ps1.test.ts／pipeline.integration.test.ts 全數
 * 迴避）。本 fixture 為求「複刻使用者現役配置」忠實度刻意保留 `clock`
 * （reference-statusline.ps1 末列本就含即時鐘面），故此處改為「遮罩掉
 * 該非決定論欄位後再比對」而非移除該段——除 `time: HH:MM` 的具體數字
 * 外，其餘位元組（含 SGR、色碼、其餘 29 段全部輸出）仍要求 byte-exact。
 *
 * 注意：`clock` 並非本 fixture 唯一的非決定論欄位——row 0 的 `git-branch`
 * 亦為 shell-out 段（真執行讀當下 cwd 的 `git branch --show-current`），
 * 但該欄位改用 `gitBranchRepo()` 釘住真執行的 cwd（受控 temp git repo，
 * 分支名與 oracle 的 mock 值同步），而非比照 clock 用正則遮罩——因
 * detached HEAD／非同名分支下 `git-branch` 段會被 `nullPolicy:'hide'`
 * 整段剔除，導致真執行與 oracle **結構**不同（段數不同），遮罩救不了
 * 這種差異，必須從源頭讓真執行環境與 oracle 一致。
 */
function maskClock(buf: Buffer): string {
  return buf.toString('utf8').replace(/time: \d{2}:\d{2}/g, 'time: __:__')
}

/**
 * `git-branch` 段的非決定論解法（與 clock 不同路線；見上方 `maskClock`
 * docstring 說明）：真執行讀 cwd 的 `git branch --show-current`，oracle
 * 讀 mock（`FULL.shell['git-branch']`）——若不控管 cwd，兩者僅在「測試
 * 進程恰好跑在與 mock 同名分支」時偶然相等（即本 repo 目前為 DEV 分支），
 * 換分支開發或 CI 的 detached-HEAD checkout（分支輸出空 → 段被剔）即會
 * 使真執行與 oracle 不再一致。改用受控 temp git repo：`git init` 一個
 * 分支名**與 mock 值同步**（`FULL.shell['git-branch']`，非寫死字面）的
 * repo 並建一個 commit，令真執行的 `git branch --show-current` 恆回傳
 * 與 oracle 相同的值——與外層 repo 目前身處哪個分支、CI checkout 拓撲皆
 * 無關（沿 `pipeline.integration.test.ts` 既有 `repoClean()` 範式，本檔
 * 僅需單一固定態，故簡化為單一函式）。
 */
function gitBranchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sl-fx-git-'))
  const branch = FULL.shell['git-branch']
  const run = (args: string[]): void => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗（cwd=${dir}）：${r.stderr}`)
  }
  run(['init', '-q', '-b', branch])
  run(['config', 'core.autocrlf', 'false'])
  run(['config', 'commit.gpgsign', 'false'])
  run(['config', 'user.email', 'ez@test.local'])
  run(['config', 'user.name', 'ez'])
  writeFileSync(join(dir, 'f.txt'), 'hello\n')
  run(['add', 'f.txt'])
  run(['commit', '-q', '-m', 'init'])
  return dir
}

const NEEDS_GIT_REPO = BASH.ok || IS_WIN
const GIT_REPO_DIR = NEEDS_GIT_REPO ? gitBranchRepo() : ''

describe.skipIf(!BASH.ok)('auto 預覽 vs 產出腳本一致 — bash＋jq 真執行 byte-exact', () => {
  // micro-fix（gate 基建）：全量 52 檔並行負載下曾逾 vitest 預設 5000ms
  // timeout（隔離跑 2.5s、負載下實測 5.1–5.9s，byte 對拍本身非迴歸）——真
  // 子程序 spawn（bash＋jq）耗時受宿主排程影響，補顯式 30s 上限吸收負載
  // 抖動，斷言與生產碼皆未變動。
  it('reference-7row fixture（FULL 情境，STATUSLINE_NOW_EPOCH 顯式釘 now；cwd 釘受控 git repo；clock 段以外 byte-exact）', () => {
    const oracle = fixtureOracle()
    const script = emitBash(CONFIG, DESCRIPTORS_BY_ID)
    const r = runBash(script, JSON.stringify(FULL.data), { STATUSLINE_NOW_EPOCH: String(FULL.now) }, GIT_REPO_DIR)
    expect(r.status, `bash stderr=${r.stderr}`).toBe(0)
    expect(maskClock(r.stdout)).toBe(maskClock(oracle))
  }, 30_000)
})

describe.skipIf(!IS_WIN)('auto 預覽 vs 產出腳本一致 — PowerShell 5.1 真執行 byte-exact', () => {
  // 同上（micro-fix）：ps1 real-exec 同屬子程序 spawn，同一 gate 基建修復。
  it('reference-7row fixture（FULL 情境，STATUSLINE_NOW_EPOCH 顯式釘 now；cwd 釘受控 git repo；clock 段以外 byte-exact）', () => {
    const oracle = fixtureOracle()
    const script = emitPs1(CONFIG, DESCRIPTORS_BY_ID)
    const r = runPs1(script, JSON.stringify(FULL.data), { STATUSLINE_NOW_EPOCH: String(FULL.now) }, GIT_REPO_DIR)
    expect(r.status, `ps1 stderr=${r.stderr}`).toBe(0)
    expect(maskClock(r.stdout)).toBe(maskClock(oracle))
  }, 30_000)
})

// ── skipIf meta（(internal design doc) T2.1・T2.2：CI 跨後端 gate 守門，
//    08 DRIFT 同族合帳） ──
//
// T2.1 真值表（CI 兩 leg 由 test.yml＋exec-detect-test-utils.ts `detectJq`
// 邏輯推導，標「推導」；完整逐環境對照落 (internal design doc)；
// sprint 17 D5 起 win32 只認 `SP5_JQ_DIR`）：
//   | gate                          | 本機 win32 | CI ubuntu | CI windows |
//   |--------------------------------|-----------|-----------|------------|
//   | BASH.ok（bash+jq 真執行）      | 依 SP5_JQ_DIR：設且有效→true／未設→false | true（推導：Ensure jq step） | false（推導：SP5_JQ_DIR 未設） |
//   | IS_WIN（ps1 5.1，僅平台旗標、無真偵測） | true（實測） | false（推導） | true（推導：process.platform 恆 win32） |
// 本檔 ps1 gate（`IS_WIN`）與 pipeline.integration.test.ts 的 `PS1.ok`（真
// spawn 偵測）不同——僅平台旗標即開跑，windows leg 不可能靜默跳過（無需
// 額外守門解跳）；bash gate 才有靜默跳過風險，故本節守門聚焦 BASH.ok。
describe('real-exec skip 環境自述（診斷用）', () => {
  it('bash／ps1 real-exec 啟用狀態', () => {
    console.warn(`[fixtures] bash+jq: ${BASH.ok ? 'ENABLED' : `SKIP（${(BASH as { reason: string }).reason}）`}`)
    console.warn(`[fixtures] ps1 5.1: ${IS_WIN ? 'ENABLED（win32）' : 'SKIP（非 win32）'}`)
    expect(true).toBe(true)
  })

  // T2.2 新增：CI leg 專屬拓撲守門（GITHUB_ACTIONS 辨識現在跑在哪個 leg；
  // 本機無此 env、if 條件不觸發下列斷言本體——本機 win32 設 SP5_JQ_DIR 時
  // 若誤觸發會因 BASH.ok 為 true 而翻紅，見 DONE 報告「非恆真紅證」段落）。
  const isCi = process.env.GITHUB_ACTIONS === 'true'

  it('ubuntu leg（CI 非 win32）：bash+jq 為該 leg 唯一真執行載重，present 卻 skip＝bug（不得靜默跳過）', () => {
    if (isCi && !IS_WIN) {
      expect(
        BASH.ok,
        `ubuntu leg BASH.ok 應為 true；若 skip：${BASH.ok ? '' : (BASH as { reason: string }).reason}`,
      ).toBe(true)
    }
  })

  it('windows leg（CI）：BASH.ok 依既有刻意拓撲恆假（SP5_JQ_DIR 未設）——鎖住此拓撲、reason 須為已知原因', () => {
    if (isCi && IS_WIN) {
      expect(
        BASH.ok,
        'windows leg BASH.ok 預期為 false（SP5_JQ_DIR 未設）；若為 true 代表拓撲已改變，需人工覆核並更新 WORKS 真值表' +
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
          `windows leg BASH skip 理由須匹配已知原因，實際：${(BASH as { reason: string }).reason}`,
        ).toMatch(/^SP5_JQ_DIR 未設/)
      }
      // ps1 gate（IS_WIN）本身不可能靜默跳過（見檔頭說明），此處仍補一道
      // 獨立新鮮探測防線（比照 pipeline.integration.test.ts 同慣例）：
      // windows runner 恆有 powershell.exe，若探測失敗代表 runner 拓撲異常。
      const fresh = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0'])
      expect(fresh.error === undefined && fresh.status === 0, 'windows leg 應有 powershell.exe').toBe(true)
    }
  })
})

afterAll(() => {
  if (bashScriptDir !== '') rmSync(bashScriptDir, { recursive: true, force: true })
  cleanupOwnedJqDir(BASH) // 只刪 owned 暫存 jq 複本
  if (GIT_REPO_DIR !== '') rmSync(GIT_REPO_DIR, { recursive: true, force: true })
})
