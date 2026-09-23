/**
 * S5-T2.6（(internal design doc) §產生器契約 11 settings 片段
 * ／§F4／§F12）：emitSettings——由 BuilderConfig＋opts 產生 `settings.json`
 * 的 `statusLine` 片段（JSON 字串，可 `JSON.parse` 回讀）。
 *
 * ── command 形（契約 11／F12；.t15／.t23 spawn 生產形逐字）──
 * - Windows：`<powershell|pwsh> -NoProfile -ExecutionPolicy Bypass -File <路徑>`
 *   （路徑 forward-slash；含空白時以雙引號包覆——見下方沉默處選擇）。
 *   Bypass wrapper 繞過 MOTW／預設 ExecutionPolicy（F12）。
 * - POSIX：`<路徑>`（依 shebang＋執行位；chmod +x 提示見 CHMOD_HINT）。
 * 路徑由 opts 傳入（UI 提供）；缺省用 DEFAULT_*_SCRIPT_PATH。
 *
 * ── refreshInterval（契約 11；F4 最小 1 秒）──
 * config 含**啟用**之 clock 段、啟用之 rate 段用 `percent-reset` variant
 * （resets_at 倒數）、或啟用之 reset-5h／reset-7d 倒數段（T4.5 補列，
 * (internal design doc) Rev 4 §4：倒數段輸出隨
 * 時間變動，需 statusline 週期刷新）→ 附 refreshInterval（秒，clock 建議
 * 60）；否則省略。只計啟用段（停用段不 emit、輸出不隨時間變動、無需刷新）。
 *
 * ── hideVimModeIndicator（契約 11）──
 * config 含**啟用**之 vim-mode 段 → 附 `hideVimModeIndicator: true`
 * （statusline 已顯示 vim 模式，關閉 Claude Code 內建指示器）。
 *
 * ── 沉默處選擇 ──
 * (1) 片段形＝完整 `{ "statusLine": {...} }` 物件（可直接貼入／合併進
 *     settings.json，非裸 statusLine 值）。
 * (2) Windows -File 路徑含空白 → 雙引號包覆（.t15 逐字定稿形只鎖旗標
 *     結構，未涵蓋含空白 home；quote 為正確性補強，不含空白時零差異）。
 * (3) refreshInterval clamp 至 ≥1 整數（F4「最小 1 秒」）。
 * (4) 不需 descriptor catalog——僅按 config.segments 的 id／variant 判定
 *     條件（config 應已經 deserializeConfig 清洗）。
 *
 * 純函式、零 DOM import，node 可測。
 */
import type { BuilderConfig } from './config.js'

/** command 目標：POSIX 直呼路徑／Windows PowerShell 5.1 wrapper／Windows pwsh 7 wrapper。 */
export type SettingsTarget = 'posix' | 'windows-powershell' | 'windows-pwsh'

export interface EmitSettingsOptions {
  target: SettingsTarget
  /** 腳本路徑（UI 提供）；缺省依 target 用 DEFAULT_*_SCRIPT_PATH。 */
  scriptPath?: string
  /** refreshInterval 秒（clamp ≥1）；缺省 DEFAULT_REFRESH_INTERVAL_SECONDS。 */
  refreshInterval?: number
}

// ── 缺省值 ──

export const DEFAULT_POSIX_SCRIPT_PATH = '~/.claude/statusline.sh'
export const DEFAULT_WINDOWS_SCRIPT_PATH = '~/.claude/statusline.ps1'
/** clock 建議刷新秒數（契約 11）。 */
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 60

// ── 附帶文案（UI／README 用；PLAN 契約 11／F12） ──

/** POSIX：腳本需可執行位（settings command 依 shebang 直呼）。 */
export const CHMOD_HINT =
  'POSIX：請確認腳本具執行權限：chmod +x ~/.claude/statusline.sh（settings 直接呼叫腳本路徑，依 shebang 執行）。'

/** MOTW／Unblock-File：瀏覽器下載之 .ps1 帶 Zone.Identifier，預設 ExecutionPolicy 下被拒→statusline 靜默空白（F12）。 */
export const MOTW_HINT =
  '瀏覽器下載的 .ps1 會被標記為「來自網際網路」（Mark-of-the-Web）。settings 採 -ExecutionPolicy Bypass wrapper 已可繞過；若仍空白，於 PowerShell 執行 Unblock-File <你的 .ps1 路徑>（或檔案內容→勾選「解除封鎖」）解除標記。'

/** GPO 強制 AllSigned：wrapper 亦無效（GPO 優先於命令列參數）；不在 v1 保證內（F12）。 */
export const GPO_ALLSIGNED_NOTE =
  '受管環境若以群組原則（GPO）強制 ExecutionPolicy 為 AllSigned，-ExecutionPolicy Bypass wrapper 亦無效（GPO 優先於命令列參數），未簽章腳本仍被拒。此情形不在 v1 保證範圍內，需改用簽章腳本或改採 POSIX/bash 方案。'

// ── command 建構 ──

/** 反斜線 → forward-slash（Windows -File 路徑；契約 11／F12）。 */
function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 含空白 → 雙引號包覆（沉默處選擇 2；不含空白時原樣）。 */
function quoteIfNeeded(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p
}

function buildCommand(target: SettingsTarget, scriptPath: string): string {
  if (target === 'posix') return scriptPath
  const shell = target === 'windows-pwsh' ? 'pwsh' : 'powershell'
  return `${shell} -NoProfile -ExecutionPolicy Bypass -File ${quoteIfNeeded(toForwardSlash(scriptPath))}`
}

// ── 條件判定（只計啟用段） ──

function hasEnabled(config: BuilderConfig, id: string): boolean {
  return config.segments.some((seg) => seg.enabled && seg.id === id)
}

/** 啟用之 rate 段用 percent-reset variant（resets_at 倒數 → 需刷新）。 */
function hasResetsCountdown(config: BuilderConfig): boolean {
  return config.segments.some(
    (seg) =>
      seg.enabled && (seg.id === 'rate-5h' || seg.id === 'rate-7d') && seg.variant === 'percent-reset',
  )
}

/** 啟用之 reset-5h／reset-7d 獨立倒數段（08-PLAN Rev 4 §4 補列）。 */
function hasResetCountdownSegment(config: BuilderConfig): boolean {
  return hasEnabled(config, 'reset-5h') || hasEnabled(config, 'reset-7d')
}

// M6 C6（(internal design doc) T6.4；使用者
// 2026-07-14 拍板契約）：percent-reset 後綴自 C3 起升級為倒數形（隨 now
// 變動、需週期刷新畫面）。`hasResetsCountdown` 早於 T4.5 已無條件依
// variant 名判定（不看 resets_at 是否實際存活），故本契約條件已由既有
// `needsRefreshInterval` 涵蓋——C6 落地時零生產碼變更，僅補 emit-settings.
// test.ts 正反兩向釘住（見該檔「C6」節）與本節說明作為單一事實來源對帳點。

/** clock（時鐘）、rate 段 resets_at 後綴倒數、或 reset-5h／reset-7d 倒數段 → 輸出隨時間變動 → 需 refreshInterval。 */
function needsRefreshInterval(config: BuilderConfig): boolean {
  return hasEnabled(config, 'clock') || hasResetsCountdown(config) || hasResetCountdownSegment(config)
}

// ── 主入口 ──

/**
 * BuilderConfig＋opts → `settings.json` 的 statusLine 片段（完整
 * `{ "statusLine": {...} }` 物件、2-space 縮排、尾隨換行；`JSON.parse` 回讀
 * 合法）。key 序：type → command →（refreshInterval）→（hideVimModeIndicator）。
 */
export function emitSettings(config: BuilderConfig, opts: EmitSettingsOptions): string {
  const scriptPath =
    opts.scriptPath ??
    (opts.target === 'posix' ? DEFAULT_POSIX_SCRIPT_PATH : DEFAULT_WINDOWS_SCRIPT_PATH)

  const statusLine: Record<string, unknown> = {
    type: 'command',
    command: buildCommand(opts.target, scriptPath),
  }

  if (needsRefreshInterval(config)) {
    const raw = opts.refreshInterval ?? DEFAULT_REFRESH_INTERVAL_SECONDS
    // F4：最小 1 秒；整數化（clamp 沉默處選擇 3）。
    statusLine.refreshInterval = Math.max(1, Math.floor(raw))
  }

  if (hasEnabled(config, 'vim-mode')) {
    statusLine.hideVimModeIndicator = true
  }

  return `${JSON.stringify({ statusLine }, null, 2)}\n`
}
