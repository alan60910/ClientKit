/**
 * S5-T2.1（(internal design doc) §Segment 目錄／§型別契約
 * SegmentDescriptor／§格式化對等規則／產生器契約 3 null 三態／§D1）：
 * StatusData＝真 stdin JSON 的忠實 typed mirror（照 F1 巢狀結構，不改名
 * 不扁平化）、tri-path SegmentDescriptor 全目錄、格式化 TS 參考純函式
 * （FormatKind 鍵供 bash/ps1 emitter 對等實作）。
 *
 * ── provisional 體制（SP-0 對帳後，2026-07-09）──
 * SP-0 真機 fixture（fixtures/stdin-dump.jsonl，73 筆）逐欄對帳完成：全部
 * tri-path jqPath 皆命中真檔、無一錯路徑（null 三態、epoch 秒、雙表述
 * 皆坐實）。已驗欄位拆 `provisional` 標記；**僅 vim-mode／pr 兩段維持
 * `provisional: true`**（73 筆真檔皆未出現：vim 於本環境為 Unknown
 * command、DEV 分支無開啟 PR），其 presence／shape 仍未驗證。對帳協定
 * 與逐欄證據見 sp0/INSTRUCTIONS.md §4＋WORKS 2026-07-09。
 *
 * ── worktree 雙表述裁定（SP-0 判定：獨立並存 → 拆兩段）──
 * SP-0 實證（fixture L22）：`workspace.git_worktree`（字串＝工作樹名稱）與
 * top-level `worktree` 物件（{name,path,branch,original_cwd,original_branch}）
 * **同時並存且互補**——名稱兩者皆給、`worktree.branch`（工作樹分支名）為
 * 額外資訊。故依 PLAN 名目拆回兩段：`worktree`（名稱，取值 fallback 鏈
 * `workspace.git_worktree` 優先、次 `worktree.name`；tsPath `??`／jqPath `//`
 * ／ps1Path `$(if …)` 三路同構）＋`worktree-branch`（`.worktree.branch`）。
 * 目錄當時（SP-0）實數 **25 段**（＝PLAN 名目；T3.2 追補至現役 **30 段**，
 * 見下方「T3.2」節與 :525 定義處，二者不矛盾——此處為 SP-0 時間點快照）。
 *
 * ── tri-path 取值 idiom（下游 emitter 依此抄寫）──
 * - tsPath：`(d: StatusData) => unknown`，回傳「未格式化的來源節點」；
 *   條件欄以 optional chaining（缺席 → undefined）。
 * - jqPath：對根 `.` 的 jq 表達式，**裸取值、不含 null 政策 idiom**
 *   （`// "--"`／`// empty` 由 emitter 依 nullPolicy 附加——單一來源在
 *   nullPolicy 欄，路徑不重複編碼）。唯一例外：worktree 的 `//` 是
 *   fallback 值邏輯、非 null 政策。
 * - ps1Path：對 `$d`（`ConvertFrom-Json` 結果）的 PS 5.1 表達式，可直接
 *   `$value = <ps1Path>` 嵌入。**產出腳本不得 Set-StrictMode**（缺席屬性
 *   鏈須靜默回 $null）；null 判定一律顯式 `$null -eq/-ne`（PS 把 0 視為
 *   falsy，truthiness 判定會誤殺 0%）。TS 端同理用 `v == null`、禁 `!v`。
 * - shell-out 段：值不出於 stdin JSON——jqPath/ps1Path 為空字串（不可
 *   用），命令在 `shellOut.{bash,ps1}`（核心命令；`2>/dev/null || true`
 *   等防禦包裹＝emitter 契約 9 的職責）。預覽側的值由 mock-data.ts 的
 *   shell 通道供給（tsPath 恆回 undefined）。
 *
 * ── null／存活語意（resolve（T2.2）依此實作）──
 * - nullPolicy 'dash'（百分比段＋token 兩段）：主值 nullish → 顯示 '--'、
 *   不套閾值色，段仍存活。
 * - 'hide'／'empty'：值「死」→ 整段（含 prefix、icon）自段陣列剔除。
 *   死值判定見 isValueDead：null／undefined／''／false——false 入列使
 *   thinking 的 jq `// empty`（false 亦 fallback）語意三後端同構
 *   （PLAN 契約 3：null/false 同視為不顯示，刻意選擇）。
 *
 * ── T3.2（(internal design doc) Rev 4 §3；
 * TASKS.md T3.2；前綴表核可見 (internal design doc)
 * prefix-table.md「06c 新 5 段增列」節，2026-07-12 使用者核可）追補 ──
 * 目錄 25→30 段：新增 token-in／token-out（category='always'、
 * nullPolicy='dash'，主值＝`current_usage.input_tokens`／`output_tokens`）、
 * cache-hit（category='percentage'、nullPolicy='dash'，主值＝
 * tri-path 取值層算出的公式結果，見下方 computeCacheHitPercentage）、
 * reset-5h／reset-7d（category='conditional'、nullPolicy='hide'，主值＝
 * `rate_limits.*.resets_at`，與 rate-5h／rate-7d 的 `resetsAt` 後綴通道
 * 共用同一底層欄位、但屬獨立段）。兩條新 TriPath 通道
 * （`autoColor`／`expiresAtPath`）僅落型別＋掛欄——resolve／emit 消費屬
 * M4（T4.1／T4.2），本次變更後兩欄皆 inert（未被任何現行程式碼讀取）。
 * **FormatKind 占位聲明（T4.1 已解除）**：T3.2 曾以 `'cost'`／`'duration'`
 * 暫掛 token×2／reset×2 段（當時 emit-bash 窮盡 switch 屬禁改範圍）；
 * T4.1（08-PLAN Rev 4 §4）換掛真 kind——token-in／token-out＝`'tokens'`
 * （k 縮寫）、reset-5h／reset-7d＝`'reset-countdown-5h'／'-7d'`（倒數兩套
 * 階梯，需 now）。三 kind 真實作在 resolve.ts（本檔 formatValue 對其拋
 * TypeError 防繞道）；emit-bash `jqFormatSuffix`／emit-ps1 對應 switch
 * 對這三 kind 同樣刻意 throw（防繞道，非 stub）——真實作已於 T4.3／T4.4
 * 落地，改走各自專屬 jq／ps1 pipeline（tokens 整數縮寫、reset-countdown-*
 * 全 jq/ps1 倒數管線），不經這條窮盡 switch。
 *
 * ── T6.1（M6，(internal design doc)；使用者
 * 2026-07-14 拍板契約 C1–C4，見 WORKS.md 同日條目）追補 ──
 * `resetsAt` 型別擴為 `TriPath & {countdown}`：rate-5h／rate-7d 各掛
 * 'reset-countdown-5h'／'reset-countdown-7d'（percent-reset 後綴格式選擇，
 * 目錄驅動、零 id 特判——與該兩段 FormatKind 字面同名但語意獨立：後綴
 * 用途 vs 主值格式）。`resetsAtSuffix` 因升級為倒數形需 `now`，整函式
 * 遷至 resolve.ts（segments.ts 維持純目錄資料層、不碰 now，避免逆向
 * import 循環——resolve.ts 早已 import segments.ts）；真實作與理由見
 * resolve.ts 檔頭「T6.1」節。`NA_TEXT`（百分比類 dash-null 顯示形，取代
 * DASH_TEXT）與 bar×null 4-run／aria 代換規則亦屬 M6，皆落 resolve.ts
 * 端行為，本檔零改動。
 *
 * 純函式、零 DOM import，node 可測。
 */
import type { SegmentCatalog } from './config.js'
import { DEFAULT_LOCALE, t, type Locale } from './messages.js'

// ── StatusData：stdin JSON 忠實 typed mirror（F1） ──

/**
 * `context_window.current_usage` 非 null 時的形狀（T3.2：自 `Record<string,
 * unknown>` 收緊為具名型別，08-PLAN Rev4 §3）。SP-0 對帳確認真 stdin：
 * `{cache_creation_input_tokens, cache_read_input_tokens, input_tokens,
 * output_tokens}` 皆 number、欄位永在（null 期 4/73＝首回應前／compact
 * 後）；但本檔既有 mock-data.ts（S5-T2.1，禁改）canonical 情境集現形僅設
 * `input_tokens`／`output_tokens` 兩欄、未曾提供 cache 兩欄——為與現行
 * mock 情境相容（M4／T4.5 才補齊 cache 兩欄＋partial-null 矩陣情境），
 * `input_tokens`／`output_tokens` 維持必填（mock 情境恆同時齊備兩者）、
 * `cache_creation_input_tokens`／`cache_read_input_tokens` 收為選填。
 * token-in／token-out／cache-hit 三段消費本型別（見下方 TriPath 定義）。
 */
export interface CurrentUsage {
  input_tokens: number | null
  output_tokens: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/**
 * rate_limits 視窗（SP-0 對帳確認：Pro/Max＋首次回應後出現，69/73 在席）。
 * `resets_at` 為 epoch 秒（fixture 實測 1783575600 ≈ 2026-07；PLAN 產生器
 * 契約 12 FromUnixTimeSeconds 坐實）。`used_percentage` 恆為 number（真檔
 * 未見 null，nullable 為防禦保留）。
 */
export interface RateLimitWindow {
  used_percentage: number | null
  resets_at: number | null
}

/**
 * 真 stdin JSON 的 typed mirror：欄名、巢狀結構照 F1，不改名不扁平化。
 * 三態建模：永在欄＝必填；「欄位在、值可 null」＝`| null`；條件欄
 * （缺席＝狀態不成立）＝`?:` optional（序列化時**鍵缺席**，非 null）。
 */
export interface StatusData {
  cwd: string
  session_id: string
  transcript_path: string
  version: string
  model: { id: string; display_name: string }
  workspace: {
    current_dir: string
    project_dir: string
    added_dirs: string[]
    /** SP-0 確認：字串＝工作樹名稱；條件欄，與 top-level worktree 並存（L22）。 */
    git_worktree?: string
    /** SP-0 確認：恆在（73/73）、形狀 {host,owner,name}。 */
    repo?: { host: string; owner: string; name: string }
  }
  output_style: { name: string }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_api_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  context_window: {
    /** F6：v2.1.132 起＝「當前 context」語意（非累計）——僅支援現行語意。 */
    total_input_tokens: number
    total_output_tokens: number
    context_window_size: number
    used_percentage: number | null
    remaining_percentage: number | null
    current_usage: CurrentUsage | null
  }
  exceeds_200k_tokens: boolean
  thinking: { enabled: boolean }
  session_name?: string
  /** SP-0 確認：條件欄（67/73 在席），string。 */
  prompt_id?: string
  /** SP-0 確認：真檔恆在（值 'xhigh'）；enum 全集未窮舉但 v1 原樣顯示不受限。 */
  effort?: { level: string }
  /** ⚠ vim-mode provisional：73 筆真檔皆無 vim 欄（本環境 /vim＝Unknown command）。 */
  vim?: { mode: string }
  /** SP-0 確認：條件欄（1/73，值 'magi:developer'），形狀 {name}。 */
  agent?: { name: string }
  /** ⚠ pr provisional：73 筆真檔皆無 pr 欄（DEV 分支無開啟 PR）；shape 未驗證。 */
  pr?: { number: number; url: string; review_state: string }
  rate_limits?: { five_hour?: RateLimitWindow; seven_day?: RateLimitWindow }
  /**
   * SP-0 確認（fixture L22）：top-level worktree 物件與 workspace.git_worktree
   * 並存互補——name 兩者皆給、branch 為額外工作樹分支名。名稱段走 worktree
   * （此物件的 name 為 fallback 次選）；branch 另立 worktree-branch 段。
   */
  worktree?: {
    name?: string
    path?: string
    branch?: string
    original_cwd?: string
    original_branch?: string
  }
  /** SP-0 新欄位（73/73，boolean）：/fast 模式旗標。v1 不設段（backlog）。 */
  fast_mode?: boolean
  /** SP-0 新欄位（1/73，string；與 agent.name 同值）。v1 不設段（backlog）。 */
  agent_type?: string
}

// ── 目錄型別 ──

export type SegmentId =
  | 'model' | 'cwd' | 'project-dir' | 'output-style' | 'version'
  | 'cost' | 'duration' | 'lines-changed' | 'context-size' | 'thinking'
  | 'token-in' | 'token-out'
  | 'context-used' | 'context-remaining' | 'rate-5h' | 'rate-7d' | 'cache-hit'
  | 'session-name' | 'effort' | 'vim-mode' | 'agent-name' | 'pr' | 'repo'
  | 'worktree' | 'worktree-branch' | 'reset-5h' | 'reset-7d'
  | 'git-branch' | 'git-dirty' | 'clock'

export type SegmentCategory = 'always' | 'percentage' | 'conditional' | 'shell-out'

export type NullPolicy = 'dash' | 'hide' | 'empty'

/**
 * 格式化規則鍵（§格式化對等規則）：TS 參考實作在本檔 formatValue；
 * bash（jq 端）／ps1 emitter 逐鍵實作同語意（行為相等歸 §3 真執行）。
 */
export type FormatKind =
  | 'text'          // 字串原樣
  | 'path'          // cwd variants：full／basename／tilde
  | 'cost'          // $D.DDDD（單次浮點乘 floor、4 位補尾零）
  | 'duration'      // 整數除法 h/m/s 三階
  | 'percentage'    // ⌊p⌋%
  | 'context-size'  // context_window 節點 → in+out 總和 → ≥10⁶→⌊n/10⁶⌋M else ⌊n/10³⌋k
  | 'lines-changed' // cost 節點 → +A/-R
  | 'flag'          // true → 'on'（thinking；false/null 由 empty 政策剔段）
  | 'dirty'         // true → '*'（git-dirty；false/null 由 hide 政策剔段）
  | 'pr'            // pr 節點 → #<number>
  | 'repo'          // repo 節點 → <owner>/<name>
  | 'clock'         // ClockParts → HH:mm（零填補）
  | 'tokens'        // token 縮寫：≥10³→⌊n/100⌋插小數點 'X.Yk'（僅 k 檔）；<10³ 原整數字串（T4.1；真實作 resolve.ts）
  | 'reset-countdown-5h' // ↺ Xh/Xm (HH:MM) 兩階梯；需 now，真實作 resolve.ts（T4.1）
  | 'reset-countdown-7d' // ↺ Xd/XhYm (MM/DD HH:MM) 兩階梯；需 now，真實作 resolve.ts（T4.1）

/** 三後端取值路徑組（resets_at 後綴通道複用）。 */
export interface TriPath {
  tsPath: (d: StatusData) => unknown
  jqPath: string
  ps1Path: string
}

/**
 * tri-path 描述子——三後端取值語意的單一事實來源（PLAN 型別契約）。
 * 契約沉默處的本檔擴充欄：resetsAt／shellOut／provisional(+Note)／
 * autoColor／expiresAtPath（T3.2 新增，見下方欄位文件）；icon 收窄為
 * 必填（06a 核可對照表 25 段全覆蓋；T3.2 新增 5 段循 T1.5.2／06c 核可
 * 對照表比照辦理，現役 30 段全覆蓋，見 prefix-table.md）。
 */
export interface SegmentDescriptor {
  id: SegmentId
  /** UI 顯示＋控件 accessible name 的段身分部。 */
  label: string
  category: SegmentCategory
  tsPath: (d: StatusData) => unknown
  jqPath: string
  ps1Path: string
  format: FormatKind
  /**
   * glyph＝T1.5.2 核可對照表 ASCII 前綴字面（如 'cwd:'；推翻 06a emoji
   * 對照表定案，見 prefix-table.md）；ariaText＝SR 文字等價——T5.3 起單一
   * 事實來源反轉：本欄與 `label` 欄的值改自 messages.ts zh-Hant 字典於
   * 模組初始化時取得（見下方 `M` 常數與 `SEGMENT_DESCRIPTOR_LIST`），非
   * 本檔字面自身；locale 感知取值走下方 `segmentLabel`／`segmentAriaText`
   * accessor（messages 為源、segments 為消費者）。
   */
  icon: { glyph: string; ariaText: string }
  nullPolicy: NullPolicy
  /** 允許集（目錄衍生）；預設＝variants[0]（見 defaultVariant）。 */
  variants?: readonly string[]
  /**
   * rate 段限定：resets_at 後綴 tri-path＋倒數 kind（M6 C3，2026-07-14
   * 拍板；(internal design doc) T6.1）。variant
   * 'percent-reset' 且值非 null／未過期時，於主值後附倒數字串（如
   * ` ↺ 4h (02:40)`）——真格式化派發（`resetsAtSuffix`）因需 `now` 已遷
   * 至 resolve.ts（本檔僅目錄資料，見該檔檔頭「T6.1」節歸屬理由）。
   * `countdown` 為目錄驅動的格式選擇（零 id 特判）：rate-5h 掛
   * 'reset-countdown-5h'、rate-7d 掛 'reset-countdown-7d'。後綴為段內
   * composition 成分、非主值——主值 null 判定不看它。
   */
  resetsAt?: TriPath & { countdown: 'reset-countdown-5h' | 'reset-countdown-7d' }
  /**
   * auto 配色承載欄（T3.2，08-PLAN Rev4 §3；沿 resetsAt 先例、選填、不動
   * 既有段語意）：`palette` 指定套哪組色票（model／effort，resolve／emit
   * 不得出現任何 id 特判）；`key` 為比對來源 TriPath（缺省＝主值本身
   * 免 key，如 effort 段直接複用 `.effort.level`）。model 段掛
   * `{palette:'model', key: .model.id 三式}`（id 較 display_name 穩定，
   * 色票對照鍵以 model id family 前綴比對）。**resolve／emit 消費屬
   * M4——本任務只落型別＋掛欄，欄位 inert（未被任何現行程式碼讀取）**。
   */
  autoColor?: { palette: 'model' | 'effort'; key?: TriPath }
  /**
   * 通用「過期即死值」標記 TriPath（T3.2，08-PLAN Rev4 §3；沿 resetsAt
   * 先例、選填）：reset-5h／reset-7d 掛 `resets_at`（與該兩段主值
   * tsPath/jqPath/ps1Path 為同一底層欄位，僅承載角色不同）。**T4.1 已
   * 消費**：resolve 於既有 isValueDead 判定後追加通用步驟「expiresAtPath
   * 存在且（值 null 或 now ≥ 該值）→ 視同死值」，零 id 特判（見
   * resolve.ts resolveSegment）。
   */
  expiresAtPath?: TriPath
  /** shell-out 段限定：兩後端核心命令（防禦包裹＝emitter 契約 9）。 */
  shellOut?: { bash: string; ps1: string }
  /** SP-0 前全目錄 true（provisional 體制）；對帳後逐段拆標。 */
  provisional: boolean
  /** 段別的具體待驗點（worktree 雙表述、enum 集、epoch 假設等）。 */
  provisionalNote?: string
}

// ── variants 表列 ──

export const CWD_VARIANTS = ['full', 'basename', 'tilde'] as const
export type CwdVariant = (typeof CWD_VARIANTS)[number]

/** rate 段：'percent'＝僅百分比；'percent-reset'＝附 resets_at 後綴。 */
export const RATE_VARIANTS = ['percent', 'percent-reset'] as const
export type RateVariant = (typeof RATE_VARIANTS)[number]

/** 預設 variant＝表列第一項（config 清洗後 variant 缺席時 resolve 用此）。 */
export function defaultVariant(descriptor: SegmentDescriptor): string | undefined {
  return descriptor.variants?.[0]
}

// ── 存活語意 ──

/**
 * hide／empty 政策的「死值」判定（dash 段不適用——null 顯示 '--' 仍存活）：
 * null／undefined（缺席）、''（空字串段身空殼）、false（jq `// empty`
 * 對 false 亦 fallback——thinking 三後端同構的關鍵）。0 存活（0% 合法）。
 */
export function isValueDead(v: unknown): boolean {
  return v === null || v === undefined || v === '' || v === false
}

// ── 格式化純函式（TS 參考實作；對抗值測試見 segments.test.ts） ──

/**
 * cost：`$⌊usd×10⁴⌋ 插小數點、4 位補尾零`。單次浮點乘後 floor，其後全
 * 整數運算（禁捨入模式相依格式化）；float 乘積下緣一致偏（0.0029 →
 * 28.999… → '$0.0028'，三後端同 double 同偏）。負值 clamp 0（cost 恆
 * ≥0 假設；clamp 為 FormatKind 'cost' 語意的一部分，emitter 同構）。
 */
export function formatCost(usd: number): string {
  const scaled = Math.max(0, Math.floor(usd * 10000))
  const whole = Math.floor(scaled / 10000)
  const frac = String(scaled % 10000).padStart(4, '0')
  return `$${whole}.${frac}`
}

/** duration：h=⌊ms/3.6e6⌋、m=⌊ms/6e4⌋%60、s=⌊ms/1e3⌋%60；h>0→`{h}h{m}m`、m>0→`{m}m{s}s`、else `{s}s`。 */
export function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor(ms / 60000) % 60
  const s = Math.floor(ms / 1000) % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

/** percentage：`⌊p⌋%`（顯示層不 clamp——閾值分桶的 clamp 在 threshold.ts）。 */
export function formatPercentage(p: number): string {
  return `${Math.floor(p)}%`
}

/** context-size：tokens ≥10⁶ → `⌊n/10⁶⌋M`、else `⌊n/10³⌋k`（<10³ → '0k'）。 */
export function formatContextSize(totalTokens: number): string {
  if (totalTokens >= 1_000_000) return `${Math.floor(totalTokens / 1_000_000)}M`
  return `${Math.floor(totalTokens / 1_000)}k`
}

/** lines-changed：`+A/-R` 原整數。 */
export function formatLinesChanged(added: number, removed: number): string {
  return `+${added}/-${removed}`
}

/** 預覽時鐘的決定論輸入（真腳本用系統時鐘：`date +%H:%M`／Get-Date）。 */
export interface ClockParts {
  hours: number
  minutes: number
}

/** clock／resets_at 共用的 HH:mm 渲染（兩欄皆零填補兩位）。 */
export function formatClockHM(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * resets_at（epoch 秒，provisional）→ 本地 HH:mm。epoch→本地時分的分解
 * 屬環境（bash `date`／ps1 ToLocalTime 同語意）；渲染鎖 formatClockHM。
 */
export function formatResetsAt(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  return formatClockHM(d.getHours(), d.getMinutes())
}

// resetsAtSuffix（rate 段 percent-reset 後綴格式化）已於 M6 T6.1 遷至
// resolve.ts（升級為倒數形需 `now`；見該檔檔頭「T6.1」節歸屬理由與上方
// `SegmentDescriptor.resetsAt` 欄位 doc）。本檔僅保留 formatResetsAt
// （HH:mm 渲染，clock／resets_at 共用，倒數格式化的 clock 字串生成仍靠它）。

/**
 * path（cwd variants）：'full' 原樣；'basename' 取最後路徑節（`/`／`\`
 * 皆為分隔、尾分隔忽略）；'tilde' 以 home 前綴（嚴格逐字比對，含大小寫
 * ——Windows 大小寫寬鬆比對不做，保守）換 `~`（home 為空字串時原樣）。
 */
export function formatPath(p: string, variant: CwdVariant, home: string): string {
  switch (variant) {
    case 'full':
      return p
    case 'basename': {
      const parts = p.split(/[\\/]+/).filter((part) => part !== '')
      return parts.length > 0 ? parts[parts.length - 1] : p
    }
    case 'tilde': {
      if (home === '') return p
      if (p === home) return '~'
      if (p.startsWith(`${home}/`) || p.startsWith(`${home}\\`)) return `~${p.slice(home.length)}`
      return p
    }
  }
}

// ── formatValue：FormatKind 派發（resolve 消費面） ──

export interface FormatContext {
  /** 段 variant（config 已清洗；未知值＝programmer error → TypeError）。 */
  variant?: string
  /** tilde 縮寫的 home（bash `$HOME`／ps1 `$env:USERPROFILE`；預覽由 mock env 通道供給）。 */
  home?: string
}

function asNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError(`${what} 預期 number，得到 ${typeof v === 'number' ? 'NaN' : typeof v}`)
  return v
}

function asString(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new TypeError(`${what} 預期 string，得到 ${typeof v}`)
  return v
}

function asRecord(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new TypeError(`${what} 預期物件節點`)
  return v as Record<string, unknown>
}

/**
 * 存活主值 → 顯示字串。**只對存活值呼叫**（dash 的 '--'、hide/empty 的
 * 剔段判定皆在 resolve 層先行）；形狀不符＝programmer error → TypeError
 * （對齊 color.ts hexToRgb 邊界哲學——使用者輸入的驗證閘在上游）。
 */
export function formatValue(kind: FormatKind, value: unknown, ctx: FormatContext = {}): string {
  switch (kind) {
    case 'text':
      return asString(value, 'text 值')
    case 'path': {
      const variant = ctx.variant ?? CWD_VARIANTS[0]
      if (!(CWD_VARIANTS as readonly string[]).includes(variant)) {
        throw new TypeError(`未知 path variant：${variant}`)
      }
      return formatPath(asString(value, 'path 值'), variant as CwdVariant, ctx.home ?? '')
    }
    case 'cost':
      return formatCost(asNumber(value, 'cost 值'))
    case 'duration':
      return formatDuration(asNumber(value, 'duration 值'))
    case 'percentage':
      return formatPercentage(asNumber(value, 'percentage 值'))
    case 'context-size': {
      const node = asRecord(value, 'context_window 節點')
      return formatContextSize(
        asNumber(node.total_input_tokens, 'total_input_tokens') +
          asNumber(node.total_output_tokens, 'total_output_tokens'),
      )
    }
    case 'lines-changed': {
      const node = asRecord(value, 'cost 節點')
      return formatLinesChanged(
        asNumber(node.total_lines_added, 'total_lines_added'),
        asNumber(node.total_lines_removed, 'total_lines_removed'),
      )
    }
    case 'flag':
      if (value !== true) throw new TypeError('flag 只對 true 呼叫（false/null 由 empty 政策剔段）')
      return 'on'
    case 'dirty':
      if (value !== true) throw new TypeError('dirty 只對 true 呼叫（false/null 由 hide 政策剔段）')
      return '*'
    case 'pr': {
      const node = asRecord(value, 'pr 節點')
      return `#${asNumber(node.number, 'pr.number')}`
    }
    case 'repo': {
      const node = asRecord(value, 'repo 節點')
      return `${asString(node.owner, 'repo.owner')}/${asString(node.name, 'repo.name')}`
    }
    case 'clock': {
      const node = asRecord(value, 'clock 值')
      return formatClockHM(asNumber(node.hours, 'clock.hours'), asNumber(node.minutes, 'clock.minutes'))
    }
    case 'tokens':
    case 'reset-countdown-5h':
    case 'reset-countdown-7d':
      // T4.1：三 kind 真實作在 resolve.ts formatMainValue（倒數需 now，
      // 本函式簽章不擴）；此 case 僅滿足 FormatKind 窮盡 switch。
      throw new TypeError(`FormatKind '${kind}' 由 resolve 層格式化（T4.1），不經 formatValue`)
  }
}

// ── cache-hit 公式（tri-path 取值層完成；T3.2，08-PLAN Rev4 §3） ──

/**
 * cache-hit 主值公式：`floor(cache_read × 100 / (input + cache_creation +
 * cache_read))`。分母 0 → `0`；`usage` 為 null 或任一輸入欄
 * null／undefined（缺席）→ `null`——**恆回 `number | null`，不得取節點**
 * （PLAN 明文：resolve 閾值閘要求 `typeof raw === 'number'`、ps1
 * percentage 路徑 `[double]$v` 對物件會擲例外，故公式必須在此完成、不
 * 可沿 context-size「取節點＋FormatKind 算」慣例）。jqPath／ps1Path 為
 * 本函式的字串鏡像（同語意，真執行對等驗證屬 M4）。
 */
function computeCacheHitPercentage(usage: CurrentUsage | null): number | null {
  // `== null` 涵蓋 null／undefined 兩態：真 stdin context_window 可能整包
  // 省略 current_usage key（非顯式 null），此時 `d.context_window.current_usage`
  // 為 undefined；嚴格 `=== null` 會漏接、fall through 到下方解構賦值而
  // TypeError。對齊下方欄位守衛（:501 起）與檔頭 `== null` 慣例，兩個 shell
  // 鏡像（CACHE_HIT_JQ_PATH／CACHE_HIT_PS1_PATH，見下方）本就把缺席
  // current_usage 當 null 處理，此處對齊三後端一致行為（回歸見 segments.test.ts）。
  if (usage == null) return null
  const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens } = usage
  if (input_tokens == null || cache_creation_input_tokens == null || cache_read_input_tokens == null) {
    return null
  }
  const denominator = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
  if (denominator === 0) return 0
  return Math.floor((cache_read_input_tokens * 100) / denominator)
}

/** cache-hit jqPath：`computeCacheHitPercentage` 的 jq 鏡像（單一運算式，`as` 綁定分段）。 */
const CACHE_HIT_JQ_PATH =
  '.context_window.current_usage as $u | ' +
  'if ($u == null) or ($u.input_tokens == null) or ($u.cache_creation_input_tokens == null) or ($u.cache_read_input_tokens == null) then null ' +
  'else (($u.input_tokens + $u.cache_creation_input_tokens + $u.cache_read_input_tokens) as $denom | ' +
  'if $denom == 0 then 0 else (($u.cache_read_input_tokens * 100 / $denom) | floor) end) end'

/** cache-hit ps1Path：`computeCacheHitPercentage` 的 ps1 鏡像（`$(...)` scriptblock，null 判定顯式 `$null -eq`）。 */
const CACHE_HIT_PS1_PATH =
  '$(' +
  '$u = $d.context_window.current_usage; ' +
  'if (($null -eq $u) -or ($null -eq $u.input_tokens) -or ($null -eq $u.cache_creation_input_tokens) -or ($null -eq $u.cache_read_input_tokens)) { $null } ' +
  'else { $denom = $u.input_tokens + $u.cache_creation_input_tokens + $u.cache_read_input_tokens; ' +
  'if ($denom -eq 0) { 0 } else { [math]::Floor($u.cache_read_input_tokens * 100 / $denom) } }' +
  ')'

// ── Segment 目錄（30 段；順序＝PLAN 目錄表序＝UI 清單序） ──

function deepFreeze<T>(v: T): T {
  if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
    for (const key of Object.getOwnPropertyNames(v)) {
      deepFreeze((v as Record<string, unknown>)[key])
    }
    Object.freeze(v)
  }
  return v
}

/**
 * T5.3（09-PLAN Rev 2 §5.3）：單一事實來源反轉——本檔目錄的 label／
 * icon.ariaText 值改自 messages.ts zh-Hant 字典於模組初始化時取得（純→
 * 純 import，非執行期循環；見 messages.ts 對本檔的 type-only import）。
 * `M` 為 zh-Hant 字典的模組級快取，下方 SEGMENT_DESCRIPTOR_LIST 逐段
 * 取值（`M.segments['id'].label`／`.ariaText`）；messages.test.ts 的
 * 「零漂移」比對測試因而由「兩處手抄需同步」轉為結構性恆真（反轉後
 * 自然成立，保留無妨）。
 */
const M = t(DEFAULT_LOCALE)

const SEGMENT_DESCRIPTOR_LIST: SegmentDescriptor[] = [
  // ── 永在（12） ──
  {
    id: 'model',
    label: M.segments.model.label,
    category: 'always',
    tsPath: (d) => d.model.display_name,
    jqPath: '.model.display_name',
    ps1Path: '$d.model.display_name',
    format: 'text',
    icon: { glyph: 'model:', ariaText: M.segments.model.ariaText },
    nullPolicy: 'empty',
    // auto 配色承載欄（T3.2，欄位 inert；resolve/emit 消費屬 M4）：比對
    // 來源＝.model.id（較 display_name 穩定）。
    autoColor: {
      palette: 'model',
      key: { tsPath: (d) => d.model.id, jqPath: '.model.id', ps1Path: '$d.model.id' },
    },
    provisional: false,
  },
  {
    id: 'cwd',
    label: M.segments.cwd.label,
    category: 'always',
    // 採 top-level `.cwd`（官方範例慣用欄）；workspace.current_dir 疑為
    // 同值雙表述（未驗證），SP-0 對帳。
    tsPath: (d) => d.cwd,
    jqPath: '.cwd',
    ps1Path: '$d.cwd',
    format: 'path',
    icon: { glyph: 'cwd:', ariaText: M.segments.cwd.ariaText },
    nullPolicy: 'empty',
    variants: CWD_VARIANTS,
    provisional: false,
  },
  {
    id: 'project-dir',
    label: M.segments['project-dir'].label,
    category: 'always',
    tsPath: (d) => d.workspace.project_dir,
    jqPath: '.workspace.project_dir',
    ps1Path: '$d.workspace.project_dir',
    format: 'text',
    icon: { glyph: 'proj:', ariaText: M.segments['project-dir'].ariaText },
    nullPolicy: 'empty',
    provisional: false,
  },
  {
    id: 'output-style',
    label: M.segments['output-style'].label,
    category: 'always',
    tsPath: (d) => d.output_style.name,
    jqPath: '.output_style.name',
    ps1Path: '$d.output_style.name',
    format: 'text',
    icon: { glyph: 'style:', ariaText: M.segments['output-style'].ariaText },
    nullPolicy: 'empty',
    provisional: false,
  },
  {
    id: 'version',
    label: M.segments.version.label,
    category: 'always',
    tsPath: (d) => d.version,
    jqPath: '.version',
    ps1Path: '$d.version',
    format: 'text',
    icon: { glyph: 'ver:', ariaText: M.segments.version.ariaText },
    nullPolicy: 'empty',
    provisional: false,
  },
  {
    id: 'cost',
    label: M.segments.cost.label,
    category: 'always',
    tsPath: (d) => d.cost.total_cost_usd,
    jqPath: '.cost.total_cost_usd',
    ps1Path: '$d.cost.total_cost_usd',
    format: 'cost',
    icon: { glyph: 'cost:', ariaText: M.segments.cost.ariaText },
    nullPolicy: 'empty',
    provisional: false,
  },
  {
    id: 'duration',
    label: M.segments.duration.label,
    category: 'always',
    // 取 total_duration_ms（wall clock）；total_api_duration_ms 不設段。
    tsPath: (d) => d.cost.total_duration_ms,
    jqPath: '.cost.total_duration_ms',
    ps1Path: '$d.cost.total_duration_ms',
    format: 'duration',
    icon: { glyph: 'dur:', ariaText: M.segments.duration.ariaText },
    nullPolicy: 'empty',
    provisional: false,
  },
  {
    id: 'lines-changed',
    label: M.segments['lines-changed'].label,
    category: 'always',
    // 多欄位段：取 cost 節點，欄位讀取歸 FormatKind 'lines-changed'。
    tsPath: (d) => d.cost,
    jqPath: '.cost',
    ps1Path: '$d.cost',
    format: 'lines-changed',
    icon: { glyph: 'diff:', ariaText: M.segments['lines-changed'].ariaText },
    nullPolicy: 'empty',
    provisional: false,
  },
  {
    id: 'context-size',
    label: M.segments['context-size'].label,
    category: 'always',
    // in+out 總和＝「當前 context」token 數（F6 現行語意鎖定）。
    tsPath: (d) => d.context_window,
    jqPath: '.context_window',
    ps1Path: '$d.context_window',
    format: 'context-size',
    icon: { glyph: 'ctx:', ariaText: M.segments['context-size'].ariaText },
    nullPolicy: 'empty',
    provisional: false,
  },
  {
    id: 'thinking',
    label: M.segments.thinking.label,
    category: 'always',
    tsPath: (d) => d.thinking.enabled,
    jqPath: '.thinking.enabled',
    ps1Path: '$d.thinking.enabled',
    format: 'flag',
    icon: { glyph: 'think:', ariaText: M.segments.thinking.ariaText },
    // empty＝null/false 同視為不顯示（jq `// empty` 對 false 亦 fallback
    // ——刻意選擇，PLAN 契約 3）。
    nullPolicy: 'empty',
    provisional: false,
  },
  {
    id: 'token-in',
    label: M.segments['token-in'].label,
    category: 'always',
    // 主值＝current_usage.input_tokens（number|null）；current_usage 整包
    // null 或缺席時 optional chaining 天然回 undefined（isValueDead 對
    // undefined／null 一視同仁，dash 政策下皆顯 '--'，行為不受影響）。
    tsPath: (d) => d.context_window.current_usage?.input_tokens,
    jqPath: '.context_window.current_usage.input_tokens',
    ps1Path: '$d.context_window.current_usage.input_tokens',
    // FormatKind 'tokens'（T4.1，08-PLAN Rev 4 §4；k 縮寫真實作在
    // resolve.ts formatTokens；bash/ps1 端同構已於 T4.3/T4.4 落地，走
    // 各自專屬 jq/ps1 pipeline——見檔頭「占位聲明（T4.1 已解除）」節）。
    format: 'tokens',
    icon: { glyph: 'in:', ariaText: M.segments['token-in'].ariaText },
    nullPolicy: 'dash',
    provisional: false,
  },
  {
    id: 'token-out',
    label: M.segments['token-out'].label,
    category: 'always',
    tsPath: (d) => d.context_window.current_usage?.output_tokens,
    jqPath: '.context_window.current_usage.output_tokens',
    ps1Path: '$d.context_window.current_usage.output_tokens',
    format: 'tokens', // 同 token-in（見上方註解；T4.1）。
    icon: { glyph: 'out:', ariaText: M.segments['token-out'].ariaText },
    nullPolicy: 'dash',
    provisional: false,
  },
  // ── 百分比（5，可掛閾值；主值 null → '--' 不套閾值色） ──
  {
    id: 'context-used',
    label: M.segments['context-used'].label,
    category: 'percentage',
    tsPath: (d) => d.context_window.used_percentage,
    jqPath: '.context_window.used_percentage',
    ps1Path: '$d.context_window.used_percentage',
    format: 'percentage',
    icon: { glyph: 'used:', ariaText: M.segments['context-used'].ariaText },
    nullPolicy: 'dash',
    provisional: false,
  },
  {
    id: 'context-remaining',
    label: M.segments['context-remaining'].label,
    category: 'percentage',
    tsPath: (d) => d.context_window.remaining_percentage,
    jqPath: '.context_window.remaining_percentage',
    ps1Path: '$d.context_window.remaining_percentage',
    format: 'percentage',
    icon: { glyph: 'left:', ariaText: M.segments['context-remaining'].ariaText },
    nullPolicy: 'dash',
    provisional: false,
  },
  {
    id: 'rate-5h',
    label: M.segments['rate-5h'].label,
    category: 'percentage',
    // rate_limits 整包缺席（非 Pro/Max）→ 主值 undefined → dash '--'
    // （PLAN 目錄把 rate 段歸百分比類、dash 政策；不做整段隱藏）。
    tsPath: (d) => d.rate_limits?.five_hour?.used_percentage,
    jqPath: '.rate_limits.five_hour.used_percentage',
    ps1Path: '$d.rate_limits.five_hour.used_percentage',
    format: 'percentage',
    icon: { glyph: '5h:', ariaText: M.segments['rate-5h'].ariaText },
    nullPolicy: 'dash',
    variants: RATE_VARIANTS,
    resetsAt: {
      tsPath: (d) => d.rate_limits?.five_hour?.resets_at,
      jqPath: '.rate_limits.five_hour.resets_at',
      ps1Path: '$d.rate_limits.five_hour.resets_at',
      countdown: 'reset-countdown-5h',
    },
    provisional: false,
  },
  {
    id: 'rate-7d',
    label: M.segments['rate-7d'].label,
    category: 'percentage',
    tsPath: (d) => d.rate_limits?.seven_day?.used_percentage,
    jqPath: '.rate_limits.seven_day.used_percentage',
    ps1Path: '$d.rate_limits.seven_day.used_percentage',
    format: 'percentage',
    icon: { glyph: '7d:', ariaText: M.segments['rate-7d'].ariaText },
    nullPolicy: 'dash',
    variants: RATE_VARIANTS,
    resetsAt: {
      tsPath: (d) => d.rate_limits?.seven_day?.resets_at,
      jqPath: '.rate_limits.seven_day.resets_at',
      ps1Path: '$d.rate_limits.seven_day.resets_at',
      countdown: 'reset-countdown-7d',
    },
    provisional: false,
  },
  {
    id: 'cache-hit',
    label: M.segments['cache-hit'].label,
    category: 'percentage',
    // 公式在取值層完成（computeCacheHitPercentage／CACHE_HIT_JQ_PATH／
    // CACHE_HIT_PS1_PATH，見上方定義）：三式恆回 number | null、不取節點
    // ——percentage 類主值型別契約（08-PLAN Rev4 §3 round 2 釘死）。
    tsPath: (d) => computeCacheHitPercentage(d.context_window.current_usage),
    jqPath: CACHE_HIT_JQ_PATH,
    ps1Path: CACHE_HIT_PS1_PATH,
    format: 'percentage',
    icon: { glyph: 'cache:', ariaText: M.segments['cache-hit'].ariaText },
    nullPolicy: 'dash',
    provisional: false,
  },
  // ── 條件性（10；缺席 → 整段剔除） ──
  {
    id: 'session-name',
    label: M.segments['session-name'].label,
    category: 'conditional',
    tsPath: (d) => d.session_name,
    jqPath: '.session_name',
    ps1Path: '$d.session_name',
    format: 'text',
    icon: { glyph: 'sess:', ariaText: M.segments['session-name'].ariaText },
    nullPolicy: 'hide',
    provisional: false,
  },
  {
    id: 'effort',
    label: M.segments.effort.label,
    category: 'conditional',
    tsPath: (d) => d.effort?.level,
    jqPath: '.effort.level',
    ps1Path: '$d.effort.level',
    format: 'text',
    icon: { glyph: 'eff:', ariaText: M.segments.effort.ariaText },
    nullPolicy: 'hide',
    // auto 配色承載欄（T3.2，欄位 inert；resolve/emit 消費屬 M4）：主值
    // 即 .effort.level，直接複用免 key。
    autoColor: { palette: 'effort' },
    provisional: false,
  },
  {
    id: 'vim-mode',
    label: M.segments['vim-mode'].label,
    category: 'conditional',
    tsPath: (d) => d.vim?.mode,
    jqPath: '.vim.mode',
    ps1Path: '$d.vim.mode',
    format: 'text',
    icon: { glyph: 'vim:', ariaText: M.segments['vim-mode'].ariaText },
    nullPolicy: 'hide',
    provisional: true,
    provisionalNote:
      'SP-0 provisional：73 筆真檔皆無 vim 欄（本環境 /vim＝Unknown command）；presence／enum 集皆未驗證',
  },
  {
    id: 'agent-name',
    label: M.segments['agent-name'].label,
    category: 'conditional',
    tsPath: (d) => d.agent?.name,
    jqPath: '.agent.name',
    ps1Path: '$d.agent.name',
    format: 'text',
    icon: { glyph: 'agent:', ariaText: M.segments['agent-name'].ariaText },
    nullPolicy: 'hide',
    provisional: false,
  },
  {
    id: 'pr',
    label: M.segments.pr.label,
    category: 'conditional',
    // 顯示 #<number>；url／review_state 為 mirror 欄、v1 不顯示。
    tsPath: (d) => d.pr,
    jqPath: '.pr',
    ps1Path: '$d.pr',
    format: 'pr',
    icon: { glyph: 'pr:', ariaText: M.segments.pr.ariaText },
    nullPolicy: 'hide',
    provisional: true,
    provisionalNote:
      'SP-0 provisional：73 筆真檔皆無 pr 欄（DEV 分支無開啟 PR）；presence／shape 皆未驗證',
  },
  {
    id: 'repo',
    label: M.segments.repo.label,
    category: 'conditional',
    // 顯示 <owner>/<name>；host 為 mirror 欄、v1 不顯示。
    tsPath: (d) => d.workspace.repo,
    jqPath: '.workspace.repo',
    ps1Path: '$d.workspace.repo',
    format: 'repo',
    icon: { glyph: 'repo:', ariaText: M.segments.repo.ariaText },
    nullPolicy: 'hide',
    provisional: false,
  },
  {
    id: 'worktree',
    label: M.segments.worktree.label,
    category: 'conditional',
    // 名稱段（SP-0 拆段後）：取值 fallback 鏈 git_worktree 優先、次
    // worktree.name。tsPath `??`（nullish）≈ jq `//`（null/false）——本欄
    // 為字串、false 不會出現，同構成立。分支資訊另立 worktree-branch 段。
    tsPath: (d) => d.workspace.git_worktree ?? d.worktree?.name,
    jqPath: '.workspace.git_worktree // .worktree.name',
    ps1Path:
      '$(if ($null -ne $d.workspace.git_worktree) { $d.workspace.git_worktree } else { $d.worktree.name })',
    format: 'text',
    icon: { glyph: 'wt:', ariaText: M.segments.worktree.ariaText },
    nullPolicy: 'hide',
    provisional: false,
  },
  {
    id: 'worktree-branch',
    label: M.segments['worktree-branch'].label,
    category: 'conditional',
    // SP-0 實證（fixture L22）：worktree.branch＝工作樹分支名
    // （'worktree-calm-purring-sifakis'）；與 worktree 名稱段互補。普通
    // stdin 段（ps1Path === $d + jqPath）。glyph＝'wtbr:'（T1.5.2 核可
    // 前綴對照表；與 'wt:'（worktree 名稱段）成對，'br' 後綴標示分支）。
    tsPath: (d) => d.worktree?.branch,
    jqPath: '.worktree.branch',
    ps1Path: '$d.worktree.branch',
    format: 'text',
    icon: { glyph: 'wtbr:', ariaText: M.segments['worktree-branch'].ariaText },
    nullPolicy: 'hide',
    provisional: false,
  },
  {
    id: 'reset-5h',
    label: M.segments['reset-5h'].label,
    category: 'conditional',
    // 主值＝resets_at epoch（number|null；rate_limits／five_hour 任一層
    // 缺席時 optional chaining 天然回 undefined，hide 政策下 isValueDead
    // 對 undefined／null 一視同仁，效果相同）。與 rate-5h 的 resetsAt
    // 後綴通道讀同一底層欄位，但為獨立段（分工見 prefix-table.md）。
    tsPath: (d) => d.rate_limits?.five_hour?.resets_at,
    jqPath: '.rate_limits.five_hour.resets_at',
    ps1Path: '$d.rate_limits.five_hour.resets_at',
    // FormatKind 'reset-countdown-5h'（T4.1，08-PLAN Rev 4 §4）：
    // 「↺ Xh/Xm (HH:MM)」兩階梯真實作在 resolve.ts formatResetCountdown5h
    // （需 now）；shell 端已於 T4.3/T4.4 落地，走專屬 jq/ps1 倒數 pipeline。
    format: 'reset-countdown-5h',
    icon: { glyph: 'r5h:', ariaText: M.segments['reset-5h'].ariaText },
    nullPolicy: 'hide',
    // 通用「過期即死值」標記（T4.1 起由 resolve 消費）：與主值同一底層欄位。
    expiresAtPath: {
      tsPath: (d) => d.rate_limits?.five_hour?.resets_at,
      jqPath: '.rate_limits.five_hour.resets_at',
      ps1Path: '$d.rate_limits.five_hour.resets_at',
    },
    provisional: false,
  },
  {
    id: 'reset-7d',
    label: M.segments['reset-7d'].label,
    category: 'conditional',
    tsPath: (d) => d.rate_limits?.seven_day?.resets_at,
    jqPath: '.rate_limits.seven_day.resets_at',
    ps1Path: '$d.rate_limits.seven_day.resets_at',
    format: 'reset-countdown-7d', // 同 reset-5h（見上方註解；T4.1 兩套階梯之 7d 檔）。
    icon: { glyph: 'r7d:', ariaText: M.segments['reset-7d'].ariaText },
    nullPolicy: 'hide',
    expiresAtPath: {
      tsPath: (d) => d.rate_limits?.seven_day?.resets_at,
      jqPath: '.rate_limits.seven_day.resets_at',
      ps1Path: '$d.rate_limits.seven_day.resets_at',
    },
    provisional: false,
  },
  // ── shell-out（3；值不出於 stdin JSON，見檔頭 idiom 節） ──
  {
    id: 'git-branch',
    label: M.segments['git-branch'].label,
    category: 'shell-out',
    tsPath: () => undefined,
    jqPath: '',
    ps1Path: '',
    format: 'text',
    icon: { glyph: 'git:', ariaText: M.segments['git-branch'].ariaText },
    // 非 git 目錄／detached → 空輸出 → 剔段。
    nullPolicy: 'hide',
    shellOut: { bash: 'git branch --show-current', ps1: 'git branch --show-current' },
    provisional: false,
  },
  {
    id: 'git-dirty',
    label: M.segments['git-dirty'].label,
    category: 'shell-out',
    tsPath: () => undefined,
    jqPath: '',
    ps1Path: '',
    format: 'dirty',
    icon: { glyph: 'dirty:', ariaText: M.segments['git-dirty'].ariaText },
    // porcelain 空（乾淨）／非 git 目錄 → 剔段；非空 → '*'。
    nullPolicy: 'hide',
    shellOut: { bash: 'git status --porcelain', ps1: 'git status --porcelain' },
    provisional: false,
  },
  {
    id: 'clock',
    label: M.segments.clock.label,
    category: 'shell-out',
    tsPath: () => undefined,
    jqPath: '',
    ps1Path: '',
    format: 'clock',
    icon: { glyph: 'time:', ariaText: M.segments.clock.ariaText },
    // 恆有值；啟用 → settings 附 refreshInterval: 60（emit-settings）。
    nullPolicy: 'empty',
    shellOut: { bash: 'date +%H:%M', ps1: 'Get-Date -Format HH:mm' },
    provisional: false,
  },
]

/** 全目錄（凍結；順序＝PLAN 目錄表序：永在 12→百分比 5→條件 10→shell-out 3）。 */
export const SEGMENT_DESCRIPTORS: readonly SegmentDescriptor[] = deepFreeze(SEGMENT_DESCRIPTOR_LIST)

export const SEGMENT_IDS: readonly SegmentId[] = Object.freeze(
  SEGMENT_DESCRIPTORS.map((descriptor) => descriptor.id),
)

export const DESCRIPTORS_BY_ID: Readonly<Record<SegmentId, SegmentDescriptor>> = Object.freeze(
  Object.fromEntries(SEGMENT_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor])) as Record<
    SegmentId,
    SegmentDescriptor
  >,
)

/**
 * locale 感知 accessor（T5.3，09-PLAN Rev 2 §5.3）：`descriptor.label`／
 * `descriptor.icon.ariaText` 欄位仍固定為 zh-Hant（main.ts 大量直讀該兩
 * 欄，欄位 API 保留不動）；本兩函式供下游（T5.5/T5.6 main.ts 穿線）依
 * `locale` 取任一語言的段文字，單一事實來源仍在 messages.ts（`t(locale)`）
 * ——本檔僅轉發、不重複維護字典。`locale` 選填，預設 `DEFAULT_LOCALE`
 * （zh-Hant），與 `ResolveInput.locale` 同一預設值語意。
 */
export function segmentLabel(id: SegmentId, locale: Locale = DEFAULT_LOCALE): string {
  return t(locale).segments[id].label
}

/** 見 `segmentLabel` 文件；取 icon 的 SR 文字等價（resolve.ts headAria 組裝點消費）。 */
export function segmentAriaText(id: SegmentId, locale: Locale = DEFAULT_LOCALE): string {
  return t(locale).segments[id].ariaText
}

/**
 * config.ts 注入面（{ids, variantsById, barEligibleIds, autoEligibleIds}
 * ——型別由 config.ts 契約鎖定）。`barEligibleIds`／`autoEligibleIds`
 * （T3.3，(internal design doc) Rev 4 §3；round 2
 * 補閉）：導出依據——`barEligibleIds`＝`category === 'percentage'` 之段、
 * `autoEligibleIds`＝有 `autoColor` 欄之段（T3.2 已為 model／effort 段掛
 * `autoColor`）。兩集合由本檔目錄結構衍生、零硬編 id 清單，目錄擴充自動
 * 跟進；`sanitizeSegment`（config.ts）對兩集合的實際清洗消費屬 T3.4。
 */
export const SEGMENT_CATALOG: SegmentCatalog = deepFreeze({
  ids: SEGMENT_IDS,
  variantsById: Object.fromEntries(
    SEGMENT_DESCRIPTORS.filter((descriptor) => descriptor.variants !== undefined).map(
      (descriptor) => [descriptor.id, descriptor.variants],
    ),
  ),
  barEligibleIds: new Set(
    SEGMENT_DESCRIPTORS.filter((descriptor) => descriptor.category === 'percentage').map(
      (descriptor) => descriptor.id,
    ),
  ),
  autoEligibleIds: new Set(
    SEGMENT_DESCRIPTORS.filter((descriptor) => descriptor.autoColor !== undefined).map(
      (descriptor) => descriptor.id,
    ),
  ),
})
