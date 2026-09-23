/**
 * sprint 17 D5（(internal design doc) §D5）：bash＋jq 真執行
 * 環境探測的共用測試 helper——收斂 emit-bash.test.ts（`detectRealExec`）、
 * fixtures.test.ts／pipeline.integration.test.ts（`detectBashExec`）三份各自
 * 維護的複本，並去除硬編使用者家目錄路徑與 repo 內 gitignored 便攜 jq 的
 * 相依（公開鏡像不含私有工作流目錄，舊寫法在匯出樹內指向不存在的檔）。
 *
 * 設計：
 *   - **依賴注入**：`platform`／`env`／`exists`／`spawn`／`mkdtemp`／`copy`／`rm`
 *     皆可注入，省略時取 process／node:fs 真值——單元測試（見
 *     exec-detect-test-utils.test.ts）全以假函式注入，任何 OS 皆可跑。
 *   - **候選由 env 推導**（不採 PATH 探測：PATH 上的 bash 可能是 WSL，無法
 *     吃 Windows 路徑的腳本）；env 未定義（或空字串）者不產生候選；win32 以
 *     `path.win32` 拼接，不經 host `path.join`（注入 win32 時在 posix 主機上
 *     仍產生正確反斜線路徑）。
 *   - **win32 jq 只認 `SP5_JQ_DIR`**：目錄內 `jq.exe` 或 `jq-windows-amd64.exe`
 *     皆接受，一律複製成暫存目錄下的 `jq.exe`（`owned:true`）——呼叫端
 *     afterAll 經 `cleanupOwnedJqDir` 只刪 `owned` 目錄，永不碰 `SP5_JQ_DIR`
 *     來源目錄（歷史上曾誤刪來源）。
 *   - 非 win32 維持 `jq --version` PATH 探測（CI ubuntu leg 由 test.yml 的
 *     Ensure jq step 提供），`jqDir: undefined`、`owned:false`。
 *
 * 命名刻意**不**用 `*.test.ts`：本檔是測試支援模組、非測試套件本身
 * （vitest 預設只收集檔名含 `.test.`／`.spec.` 者），比照同目錄
 * `css-scan-test-utils.ts` 的既有形。**僅供測試 import**：出貨程式碼
 * （main.ts 等）不引用本檔，故本檔不進 dist bundle。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'

/** 探測可見的環境變數表（`process.env` 或測試注入的字面物件）。 */
export type ExecEnv = Readonly<Record<string, string | undefined>>

/** `spawn` 注入形：只取探測所需的 `status`／`error`。 */
export type ExecSpawn = (cmd: string, args: readonly string[]) => { status: number | null; error?: Error }

export interface BashCandidateDeps {
  readonly platform: NodeJS.Platform
  readonly env: ExecEnv
}

export interface BashDetectDeps extends BashCandidateDeps {
  readonly exists: (p: string) => boolean
}

export interface JqDetectDeps extends BashDetectDeps {
  readonly spawn: ExecSpawn
  /** 建立暫存目錄並回傳其絕對路徑；`prefix` 為目錄名前綴。 */
  readonly mkdtemp: (prefix: string) => string
  readonly copy: (src: string, dest: string) => void
  /**
   * 刪除目錄（見 `detectJq` win32 分支：`copy` 於 `mkdtemp` 成功後拋錯時，
   * 用來清掉已建立的暫存目錄，避免洩漏）。預設同 `cleanupOwnedJqDir` 的
   * 預設 rm（`recursive/force/maxRetries/retryDelay`，見 minority「jq 暫存
   * 清理」：EBUSY 需重試）。
   */
  readonly rm: (dir: string) => void
}

/**
 * bash＋jq 真執行探測結果。`owned:true` ＝ `jqDir` 為本 helper 建立的暫存
 * 複本、呼叫端負責刪除；`owned:false` ＝ 走 PATH jq、無目錄可刪。
 */
export type BashJqExec =
  | { readonly ok: true; readonly bash: string; readonly jqDir: string; readonly owned: true }
  | { readonly ok: true; readonly bash: string; readonly jqDir: undefined; readonly owned: false }
  | { readonly ok: false; readonly reason: string }

/** reason 字串全集（三個呼叫端 CI 拓撲鎖 regex 以此為準）。 */
export const EXEC_DETECT_REASONS = {
  bashMissing: 'Git Bash 不存在（SP5_BASH 可指定；PATH 上的 bash 可能為 WSL 不可用）',
  jqDirUnset: 'SP5_JQ_DIR 未設',
  jqDirNoJq: 'SP5_JQ_DIR 指定目錄無 jq.exe／jq-windows-amd64.exe',
  posixJqMissing: '系統 jq 不在 PATH（非 win32 leg）',
} as const

/** win32 `SP5_JQ_DIR` 內接受的 jq 檔名（依序優先）。 */
export const WIN_JQ_BIN_NAMES = ['jq.exe', 'jq-windows-amd64.exe'] as const

/** 暫存 jq 複本目錄前綴。 */
export const JQ_TMP_PREFIX = 'sl-jq-'

const defaultSpawn: ExecSpawn = (cmd, args) => {
  const r = spawnSync(cmd, args)
  return r.error === undefined ? { status: r.status } : { status: r.status, error: r.error }
}

/**
 * 預設 rm：`maxRetries`／`retryDelay` 因應 Windows EBUSY（防毒／檔案總管
 * 短暫鎖定剛複製完的檔）——minority「jq 暫存清理」條目，與 `cleanupOwnedJqDir`
 * 共用同一預設。
 */
const defaultRm: (dir: string) => void = (dir) =>
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

function resolveJqDeps(deps: Partial<JqDetectDeps>): JqDetectDeps {
  return {
    platform: deps.platform ?? process.platform,
    env: deps.env ?? process.env,
    exists: deps.exists ?? existsSync,
    spawn: deps.spawn ?? defaultSpawn,
    mkdtemp: deps.mkdtemp ?? ((prefix: string): string => mkdtempSync(join(tmpdir(), prefix))),
    copy: deps.copy ?? ((src: string, dest: string): void => copyFileSync(src, dest)),
    rm: deps.rm ?? defaultRm,
  }
}

/** env 值：未定義或空字串皆視為未設。 */
function envValue(env: ExecEnv, key: string): string | undefined {
  const v = env[key]
  return v === undefined || v === '' ? undefined : v
}

/**
 * bash 候選序（純函式，不查檔）。win32：`SP5_BASH` → `%ProgramFiles%\Git\bin\bash.exe`
 * → `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` → `%SCOOP%\apps\git\current\bin\bash.exe`
 * → `%USERPROFILE%\scoop\apps\git\current\bin\bash.exe`；非 win32：`SP5_BASH` →
 * `/usr/bin/bash` → `/bin/bash`。env 未設者整條略過（不產生 `undefined\…` 字首），
 * 重複者去重。
 */
export function bashCandidates(deps: Partial<BashCandidateDeps> = {}): string[] {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  const cands: string[] = []
  const override = envValue(env, 'SP5_BASH')
  if (override !== undefined) cands.push(override)
  if (platform === 'win32') {
    const w = win32
    const programFiles = envValue(env, 'ProgramFiles')
    const localAppData = envValue(env, 'LOCALAPPDATA')
    const scoop = envValue(env, 'SCOOP')
    const userProfile = envValue(env, 'USERPROFILE')
    if (programFiles !== undefined) cands.push(w.join(programFiles, 'Git', 'bin', 'bash.exe'))
    if (localAppData !== undefined) cands.push(w.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'))
    if (scoop !== undefined) cands.push(w.join(scoop, 'apps', 'git', 'current', 'bin', 'bash.exe'))
    if (userProfile !== undefined) cands.push(w.join(userProfile, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'))
  } else {
    cands.push('/usr/bin/bash', '/bin/bash')
  }
  return [...new Set(cands)]
}

/** 第一個存在的 bash 候選；皆不存在 → `undefined`。 */
export function detectBash(deps: Partial<BashDetectDeps> = {}): string | undefined {
  const exists = deps.exists ?? existsSync
  return bashCandidates(deps).find((p) => exists(p))
}

/**
 * bash＋jq 真執行探測（名為 detectJq：bash 先行、jq 定案整體 ok）。
 * win32 只認 `SP5_JQ_DIR`（一律複製到 mkdtemp、`owned:true`）；非 win32 走 PATH
 * `jq --version`。reason 字面見 `EXEC_DETECT_REASONS`。
 */
export function detectJq(deps: Partial<JqDetectDeps> = {}): BashJqExec {
  const d = resolveJqDeps(deps)
  const bash = detectBash(d)
  if (bash === undefined) return { ok: false, reason: EXEC_DETECT_REASONS.bashMissing }
  if (d.platform === 'win32') {
    const srcDir = envValue(d.env, 'SP5_JQ_DIR')
    if (srcDir === undefined) return { ok: false, reason: EXEC_DETECT_REASONS.jqDirUnset }
    const src = WIN_JQ_BIN_NAMES.map((n) => win32.join(srcDir, n)).find((p) => d.exists(p))
    if (src === undefined) return { ok: false, reason: EXEC_DETECT_REASONS.jqDirNoJq }
    const jqDir = d.mkdtemp(JQ_TMP_PREFIX)
    try {
      d.copy(src, win32.join(jqDir, 'jq.exe'))
    } catch (err) {
      // copy 於 mkdtemp 成功後才失敗：清掉已建立的暫存目錄再重新拋出，維持
      // 既有呼叫端契約（`detectJq()` 目前在模組頂層直接呼叫、未包
      // try/catch，異常本就會往外傳；差別只在暫存目錄不再洩漏）。
      d.rm(jqDir)
      throw err
    }
    return { ok: true, bash, jqDir, owned: true }
  }
  const probe = d.spawn('jq', ['--version'])
  if (probe.error !== undefined || probe.status !== 0) return { ok: false, reason: EXEC_DETECT_REASONS.posixJqMissing }
  return { ok: true, bash, jqDir: undefined, owned: false }
}

/**
 * 呼叫端 afterAll 用：只刪 `owned` 的暫存 jq 目錄；`ok:false` 或 `owned:false`
 * 皆不動作。`rm` 可注入（預設見 `defaultRm`：遞迴強制刪除＋`maxRetries`／
 * `retryDelay` 應付 Windows EBUSY）。
 */
export function cleanupOwnedJqDir(exec: BashJqExec, rm: (dir: string) => void = defaultRm): void {
  if (exec.ok && exec.owned) rm(exec.jqDir)
}
