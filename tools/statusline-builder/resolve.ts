/**
 * S5-T2.2（(internal design doc) §產生器契約 4 執行期 join／
 * 契約 3 null 三態／契約 5 閾值／§D2 auto-fg 成對／§D3 mode 語意／
 * §型別契約 StyledRun／§預覽契約 aria-label）：決策核心 resolve——
 * BuilderConfig＋情境三通道 → StyledRun[]。與 emit-bash/emit-ps1 的
 * 執行期算式**同一 join 演算法**（宣告式包裝）；SP-5／§3 真執行以
 * `emit-ansi.toAnsi(resolve(...))` 為兩 shell stdout 的比對基準。
 *
 * ── 兩趟演算法（契約 4，兩後端同構）──
 * 第一趟：依 config.segments 序逐**啟用**段求值（tsPath／shell 通道→
 * nullPolicy→format→composition）。存活判定基準在 **value**：
 * hide/empty 政策下值死（isValueDead）→ 整段（含 prefix、icon）剔除，
 * 不殘留懸空前綴；dash 政策下主值 nullish → 顯示 '--' 仍存活、不套
 * 閾值色。段內 composition 單源：`prefix + icon-glyph + ' ' +
 * formatted-value (+ resets 後綴)`——prefix 與 icon 著色隨段主色
 * （非閾值色）。
 * 第二趟 join：plain＝存活段以分隔符串接（無 leading/trailing/雙分隔
 * 符）；powerline＝段間箭頭 `fg=前段bg, bg=後段bg`，lastArrowCap 為真
 * 時末段補 `fg=末段bg` 對終端底色的收尾箭頭。dash-null 段 bg 退回
 * SegmentConfig.color（fg=autoFg 或 fgOverride）——鏈上每存活段恆有
 * 定義的 bg（含 `default`＝不著色），箭頭交接色恆有定義。
 *
 * ── D1 gating（06a：`config.powerlineArrow`，僅 powerline 模式適用）──
 * `powerlineArrow=false`（v2 預設）：joinPowerline **不** emit 段間箭頭、
 * `lastArrowCap` 全面無效（cap 恆不 emit，與其值無關）；改為每段主 run
 * 收尾補一格右側空白（`head + value + suffix + ' '`，composition 單源，
 * 併入段的著色 run——色塊直接相接，行前無 padding，靠此格分隔避免視覺
 * 黏連）。`powerlineArrow=true`（v1 遷移沿襲）：joinPowerline 語意不變
 * （箭頭＋`lastArrowCap` 生效、run 不補格）。emit-bash／emit-ps1 對本欄
 * 同構鏡像（bash `$v` 尾綴空格／ps1 `$disp` 尾綴 `' '`，powerline 模式
 * 才適用；plain 模式完全不受 `powerlineArrow` 影響）。
 *
 * ── T4.1（(internal design doc) Rev 4 §4）──
 * `ResolveInput` 增必填 `now`（epoch 秒）——resolve 純函式不碰 Date.now，
 * mock 消費端以 `MockScenario.now` 接線（每情境固定值；真時鐘留給未來
 * 非 mock 輸入路徑）。resolveSegment 於既有 isValueDead 判定後追加
 * `expiresAtPath` 通用死值規則（零 id 特判）；`'tokens'`／
 * `'reset-countdown-5h'`／`'reset-countdown-7d'` 三 FormatKind 需 now、
 * 真實作在本檔 formatMainValue（shell 端同構屬 T4.3／T4.4）。
 *
 * ── T4.2（08-PLAN Rev 4 §3/§4；byte 形 oracle＝sp4/REPORT.md 41 案）──
 * bar 4-run：bar 啟用（config 清洗限 percentage 段）且主值存活 →
 * run1=head（prefix＋icon 皆空仍 emit 空 text run 佔位，4-run 恆定形）、
 * run2=filled `█`×`max(0, min(20, floor(pct/5)))`（桶色）、run3=empty
 * `░`×餘格（default 色）、run4=**`' '+pct%+suffix+pad` 單一運算式**
 * （percent-reset 後綴與 powerline-noarrow 右 padding 一律併入 run4）。
 * 主值 null（T6.1 前）→ 整段退單 run；**T6.1 起改 4-run**（見下方 M6
 * 節 C2，該單 run 路徑隨之整條消失）。powerline 下 bar 段**停用
 * fgOverride**（4-run 分支本身向來如此——S4 保守解讀定案，M6 未變動此
 * 點；下方 powerline fg 推導的 `bar` 分支因而恆不可達，一併簡化）。
 * `threshold === undefined` 而 bar 開（手改存檔可達）→ filled／pct 退段
 * 主色。auto 配色（`SegmentColor` 'auto'）於 run 建構**之前**依
 * descriptor.autoColor 展開為具體 ColorSpec（palette 查表、零 id 特判；
 * powerline autoFg 對展開後 index 計算）——SGR／預覽同源。倒數段 value
 * run 的 ariaText 顯式代換 `↺`→「重置」。
 *
 * ── T6.1（M6，(internal design doc)；使用者
 * 2026-07-14 拍板契約 C1–C4，見 WORKS.md 同日條目）：真機回饋修正 ──
 * **C1 百分比無資料標記**：`nullPolicy:'dash'` **且**
 * `descriptor.category==='percentage'` 且主值 null → 顯示 `NA_TEXT`
 * （'(n/a)'）取代 DASH_TEXT；閘門走 category（零 id 特判，見
 * resolveSegment 的 `isNa` 判定）。token-in／token-out（dash 但
 * category='always'）不受影響、仍顯 DASH_TEXT——全域 DASH_TEXT 值不改動
 * （契約 3 沿用：不套閾值色、段仍存活）。
 * **C2 bar×null 不再退單 run**：`bar===true && category==='percentage'`
 * 恆走 4-run（撤除舊 `&& !isDash` 閘門）；null 時 filled=0、run3=
 * `░`×BAR_CELL_COUNT、run4 值部＝NA_TEXT（+suffix+pad）。bucket 色沿用
 * 既有派生（isDash 時 threshold 恆為 null → bucket 退段主色，零新分支）。
 * **C3 percent-reset 後綴升級倒數形**：`resetsAtSuffix` 簽章擴為
 * `(v, now, kind)`——kind 由 `descriptor.resetsAt.countdown` 目錄驅動
 * （rate-5h='reset-countdown-5h'／rate-7d='reset-countdown-7d'，零 id
 * 特判）；null／已過期（`now >= resets_at`）→''，否則複用
 * formatResetCountdown5h/7d（本檔既有）。**函式歸屬**：因需 now 與倒數
 * 格式化兩函式（本檔既有），`resetsAtSuffix` 整函式自 segments.ts 遷入
 * 本檔（segments.ts 為純目錄資料層、不碰 now；resolve.ts 早已 import
 * segments.ts，逆向遷入會成循環——遷入本檔為零循環的最小改動路徑）。
 * segments.ts 端保留 `resetsAt` tri-path 與新 `countdown` 欄（目錄資料），
 * 純格式化邏輯歸此檔。
 * **C4 aria**：後綴含 `↺` 之三處組裝點（powerline／plain 單 run、plain
 * 閾值分裂 value run、bar run4）比照倒數段既有 `↺`→「重置」代換慣例
 * 顯式代換 ariaText（見下方 `ariaSuffix`／`needsSuffixAria`）；未含 `↺`
 * 之後綴（或無 suffix）維持原省略／組裝規則不變。
 *
 * ── T5.3（(internal design doc) Rev 2 §5.3；messages.ts
 * i18n 純核心注入）──
 * `ResolveInput.locale?: Locale` 選填、預設 `DEFAULT_LOCALE`（zh-Hant）
 * ──既有呼叫點（main.ts／render-preview／各測試／golden scripts）零改動
 * 仍編譯、輸出 byte 不變。resolveSegment 內 `locale = input.locale ??
 * DEFAULT_LOCALE` 供兩處 ariaText 組裝消費：(a) `headAria` 改走
 * `segmentAriaText(descriptor.id, locale)`（segments.ts 匯出的 locale
 * 感知 accessor，取代直讀恆為 zh-Hant 的 `descriptor.icon.ariaText`）；
 * (b) C4 的 `↺`→「重置」代換詞改為 `t(locale).resetAriaWord`（`resetWord`
 * 變數，`en` 下代換為 `'reset'`）。**單一事實來源反轉**：segments.ts
 * 目錄的 `label`／`icon.ariaText` 欄位值本身也改自 messages.ts zh-Hant
 * 字典於模組初始化時取得（見該檔「T5.3」節）——本檔 import 不變、僅新增
 * `t`／`DEFAULT_LOCALE`／`Locale`（messages.js）與 `segmentAriaText`
 * （segments.js）。`text` 主文字通道（`descriptor.label`／腳本輸出）不
 * 受 locale 影響，僅 aria-label 組裝分岔。
 *
 * ── 契約沉默處選擇（T2.3/T2.4/T2.5/T3.2 依賴面，勿改動語意）──
 * 1. **run 粒度**：powerline 段恆為單 run（段只有一組 fg/bg，箭頭交接
 *    才有唯一 bg 可取）——**bar 段例外（4 run）；箭頭交接 bg 一律取段
 *    主色**（T4.2 不變量改寫，08-PLAN Rev 4 §4）。plain 段單 run，分裂
 *    例外＝(a) 閾值生效且 head（prefix+icon）非空 → 兩 run（head fg=
 *    段主色、value+後綴 fg=閾值桶色）；(b) bar 啟用且主值存活 → 4 run
 *    （見檔頭 T4.2 節）。不做「色相同即合併」的深比較——粒度規則決定
 *    論，emitter 逐 run 著色自然同構。
 * 2. **default 色不落 run 屬性**：fg/bg 只在非 `{kind:'default'}` 時
 *    設定（正規形，結構斷言穩定）；toAnsi 對缺席／default 皆不 emit。
 * 3. **resets 後綴獨立於主值**：variant 'percent-reset' 時後綴只看
 *    resets_at 自身與 now（M6 T6.1 起升級倒數形，見上方 C3）——
 *    null／已過期→''、否則→倒數字串；主值 dash（'--' 或百分比類的
 *    NA_TEXT '(n/a)'，見上方 C1）仍可帶後綴——composition 正交、emitter
 *    無條件耦合。後綴附於 value 部（閾值分裂時隨值色）。
 * 4. **閾值只作用 percentage 類**：config 清洗保留任意段的 threshold
 *    （T1.3 契約 9），resolve 對非 percentage 段忽略之。
 * 5. **plain 分隔符 run ariaText=''**：分隔符與 powerline 箭頭同屬
 *    純裝飾，不進 aria-label；custom 空分隔符＝不產生 run（直接串接）。
 * 6. **resolve 輸入＝T2.1 三通道形**（data/shell/env）：MockScenario
 *    可整顆直傳（結構子集）；shell-out 段取 shell 通道（死值語意同
 *    isValueDead），tilde home 取 env 通道。
 * 7. **D1 padding 不增 run 數**（T2.3）：`powerlineArrow=false` 的右
 *    padding 併入既有段 run 的 text（`+ ' '`；bar 段併入 run4，T4.2），
 *    不新開一個裝飾 run——選擇 1 的粒度規則（含 bar 4-run 例外）不受
 *    影響。
 *
 * ── StyledRun.ariaText 規則（型別契約；toAriaLabel 機械 enforcement）──
 * 凡 text 含 PUA／裝飾 glyph 之 run 一律顯式設 ariaText：裝飾箭頭／
 * 分隔符＝''、icon run＝glyph→icon.ariaText 機械代換（prefix 保留字面）。
 * 「省略→fallback text」僅限純可列印文字 run——toAriaLabel 對省略
 * ariaText 的 PUA run 拋 TypeError（.t17 §4 負向 enforcement 沿用）。
 *
 * 純函式、零 DOM import，node 可測。
 */
import { autoFg, type ColorSpec } from './color.js'
import type { BuilderConfig, SegmentColor, SegmentConfig } from './config.js'
import type { MockShellChannel } from './mock-data.js'
import { DEFAULT_LOCALE, t, type Locale } from './messages.js'
import {
  DESCRIPTORS_BY_ID,
  defaultVariant,
  formatClockHM,
  formatResetsAt,
  formatValue,
  isValueDead,
  segmentAriaText,
  type FormatKind,
  type SegmentDescriptor,
  type SegmentId,
  type StatusData,
} from './segments.js'
import { autoFgBuckets, bucketIndex, type ThresholdRule } from './threshold.js'

// ── 型別（PLAN 型別契約） ──

export interface StyledRun {
  text: string
  /**
   * SR 文字通道。PUA／裝飾 run 一律顯式（箭頭・分隔符=''、icon run=
   * 代換文）；省略＝純文字 run 以 text fallback（PUA run 省略為
   * programmer error，toAriaLabel 拋 TypeError）。
   */
  ariaText?: string
  fg?: ColorSpec
  bg?: ColorSpec
}

/**
 * resolve 輸入＝mock-data.ts 三通道契約的結構子集（MockScenario 可
 * 整顆直傳）；T2.7 真執行 harness 不用 shell 通道（真跑命令），僅
 * 預覽／單元測試消費。
 */
export interface ResolveInput {
  data: StatusData
  shell: MockShellChannel
  env: { home: string }
  /**
   * 決定論「現在」（epoch 秒；T4.1，08-PLAN Rev 4 §4）：expiresAtPath
   * 過期判定與倒數段格式化的時間基準。resolve 為純函式、不碰 Date.now
   * ——mock 消費端以 `MockScenario.now` 填入（結構子集直傳即含此欄）。
   */
  now: number
  /**
   * 預覽 aria-label 語系（T5.3，09-PLAN Rev 2 §5.3）：選填、缺席＝
   * `DEFAULT_LOCALE`（zh-Hant）——既有呼叫點（main.ts／render-preview／
   * 各測試／golden scripts）零改動仍編譯、輸出 byte 不變（結構子集直傳
   * 的 MockScenario 本就不帶此欄，可選性使其照樣賦值相容）。僅影響
   * ariaText 組裝（倒數後綴「重置」代換詞、icon run 的 SR 文字等價）；
   * `text` 主文字通道（描述子 `label`／腳本輸出）不受影響——見
   * resolveSegment 消費點（`headAria`／`ariaSuffix`／`valueAria`）。
   */
  locale?: Locale
}

/** powerline 轉場箭頭（v1 固定 U+E0B0，PLAN Non-Goals 記 minority）。 */
export const POWERLINE_ARROW = ''

/** dash 政策的 null 顯示形（契約 3：顯示 '--'、不套閾值色、段存活）。 */
export const DASH_TEXT = '--'

/**
 * 百分比類 dash-null 顯示形（M6 C1，2026-07-14 使用者拍板；取代
 * DASH_TEXT）：`nullPolicy:'dash'` 且 `category==='percentage'` 時顯示
 * 本常數——token-in／token-out（dash 但 category='always'）不受影響，
 * 閘門走 category（零 id 特判，見 resolveSegment 的 `isNa` 判定）。全域
 * DASH_TEXT 值本身不改動（仍為非百分比 dash 段的顯示形）。
 */
export const NA_TEXT = '(n/a)'

/**
 * bar 顯示字元與格數（T4.2，08-PLAN Rev 4 §4；S7 真機 gate 已閉合——
 * `█░` 如實顯示、fallback 條款失效不啟用）。emit-bash（T4.3）沿用同一
 * 字面；emit-ps1（T4.4）以 `[char]0x2588`／`[char]0x2591` 執行期建構
 * （純 ASCII 腳本不變量），碼位與此同值。
 */
export const BAR_FILLED_CHAR = '█'
export const BAR_EMPTY_CHAR = '░'
export const BAR_CELL_COUNT = 20

// ── T4.1 FormatKind 真實作（08-PLAN Rev 4 §4；需 now／落 resolve 端） ──

/**
 * tokens 縮寫（FormatKind 'tokens'；T4.1）：`n ≥ 1000 → ⌊n/100⌋ 手動插
 * 小數點 'X.Yk'`（比照 formatCost「floor 後插點」idiom；僅 k 檔——
 * `1500000 → '1500.0k'` 不升 M）；`< 1000` 原整數字串。禁 Math.round、
 * 全 floor（threshold.ts 檔頭不變量沿用）。shell 端同構屬 T4.3／T4.4。
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  const scaled = Math.floor(n / 100)
  return `${Math.floor(scaled / 10)}.${scaled % 10}k`
}

/**
 * reset-5h 倒數（FormatKind 'reset-countdown-5h'；T4.1，08-PLAN Rev 4 §4）：
 * diff＝resets_at−now（秒）——`diff ≥ 3600 → "↺ Xh (HH:MM)"`
 * （X=⌊diff/3600⌋）；否則 `"↺ Xm (HH:MM)"`（X=⌊diff/60⌋）。HH:MM＝
 * resets_at 本地時刻**同機現算**（sp6/REPORT.md S6 結局 (b)；沿
 * formatResetsAt 的 Date 先例）。空格照字面：`↺` 後一格、時刻括號前一格；
 * 全 floor 禁 Math.round。過期（diff ≤ 0）不至此——expiresAtPath 通用
 * 死值規則已於 resolveSegment 剔段。
 */
export function formatResetCountdown5h(resetsAt: number, now: number): string {
  const diff = resetsAt - now
  const clock = formatResetsAt(resetsAt)
  if (diff >= 3600) return `↺ ${Math.floor(diff / 3600)}h (${clock})`
  return `↺ ${Math.floor(diff / 60)}m (${clock})`
}

/**
 * reset-7d 倒數（FormatKind 'reset-countdown-7d'；T4.1）：
 * `diff ≥ 86400 → "↺ Xd (MM/DD HH:MM)"`（X=⌊diff/86400⌋）；否則
 * `"↺ XhYm (MM/DD HH:MM)"`（X=⌊diff/3600⌋、Y=⌊(diff%3600)/60⌋）。
 * MM/DD 零填、本地時刻同機現算（同上 S6 結局 (b)）。
 */
export function formatResetCountdown7d(resetsAt: number, now: number): string {
  const diff = resetsAt - now
  const d = new Date(resetsAt * 1000)
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  const stamp = `${mmdd} ${formatClockHM(d.getHours(), d.getMinutes())}`
  if (diff >= 86400) return `↺ ${Math.floor(diff / 86400)}d (${stamp})`
  return `↺ ${Math.floor(diff / 3600)}h${Math.floor((diff % 3600) / 60)}m (${stamp})`
}

/**
 * resets_at 後綴（M6 C3，2026-07-14 拍板；遷自 segments.ts——見檔頭
 * 「T6.1」節函式歸屬理由）：null/undefined → ''；已過期
 * （`now >= resets_at`，恰等亦算過期）→ ''（沿倒數段 expiresAtPath hide
 * 精神，僅影響後綴、rate 段本體仍存活——rate 段沒有 expiresAtPath，不
 * 整段剔除）；否則依 `kind` 派發 formatResetCountdown5h/7d、前綴一格
 * 空白（` ` + 倒數字串，例：' ↺ 4h (02:40)'）。非 number 的非 null 值＝
 * epoch 假設破產（SP-0 對帳點）→ TypeError（沿舊版 segments.ts 邊界
 * 哲學不變）。
 */
export function resetsAtSuffix(
  v: unknown,
  now: number,
  kind: 'reset-countdown-5h' | 'reset-countdown-7d',
): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new TypeError(`resets_at 預期 epoch 秒（number），得到 ${typeof v}`)
  }
  if (now >= v) return ''
  const countdown =
    kind === 'reset-countdown-5h' ? formatResetCountdown5h(v, now) : formatResetCountdown7d(v, now)
  return ` ${countdown}`
}

/** 形狀不符＝programmer error → TypeError（對齊 segments.ts asNumber 邊界哲學）。 */
function asNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new TypeError(`${what} 預期 number，得到 ${typeof v === 'number' ? 'NaN' : typeof v}`)
  }
  return v
}

/**
 * 主值格式化派發（T4.1）：'tokens'／'reset-countdown-5h'／
 * 'reset-countdown-7d' 需 now、真實作在本檔（segments.ts formatValue 對
 * 三者拋 TypeError 防繞道）；其餘 kind 沿 formatValue（TS 參考實作）。
 */
function formatMainValue(
  kind: FormatKind,
  raw: unknown,
  input: ResolveInput,
  variant: string | undefined,
): string {
  switch (kind) {
    case 'tokens':
      return formatTokens(asNumber(raw, 'tokens 值'))
    case 'reset-countdown-5h':
      return formatResetCountdown5h(asNumber(raw, 'resets_at'), input.now)
    case 'reset-countdown-7d':
      return formatResetCountdown7d(asNumber(raw, 'resets_at'), input.now)
    default:
      return formatValue(kind, raw, { variant, home: input.env.home })
  }
}

// ── T4.2 auto 配色展開（08-PLAN Rev 4 §3；resolve＝預覽端真展開） ──

/**
 * model 色票（PLAN Rev 4 §3）：對 model.id 做**大小寫敏感前綴比對**——
 * `claude-fable-*`→214（金）、`claude-opus-*`→135（紫）、
 * `claude-haiku-*`→2（綠）、`claude-sonnet-*`／未知 fallback→6（青）。
 * 三後端同構規則釘死：bash `case "$id" in claude-opus-*)`（glob 前綴、
 * 大小寫敏感）／ps1 `-clike`・`StartsWith`（禁 `-match`）／TS
 * `startsWith`——T4.3／T4.4 依此抄寫。0–15 基本色可被終端主題覆寫屬
 * 傘狀明文裁決（與參考方案一致），不重開。
 */
function modelPaletteIndex(id: string): number {
  if (id.startsWith('claude-fable-')) return 214
  if (id.startsWith('claude-opus-')) return 135
  if (id.startsWith('claude-haiku-')) return 2
  return 6
}

/**
 * effort 色票（PLAN Rev 4 §3）：low=3／medium=2／high=4／xhigh=5／
 * max=15＋unknown 值=9（亮紅）。欄位缺席不至此——effort 段 nullPolicy
 * 'hide' 已於 resolveSegment 死值判定整段剔除（「無欄位→灰」分支不可
 * 達，勿補）。
 */
function effortPaletteIndex(level: string): number {
  switch (level) {
    case 'low':
      return 3
    case 'medium':
      return 2
    case 'high':
      return 4
    case 'xhigh':
      return 5
    case 'max':
      return 15
    default:
      return 9
  }
}

/**
 * `SegmentColor` → 具體 ColorSpec（T4.2 真展開——取代 T3.4 的
 * `segmentColorPlaceholder` 最小防禦，該函式文件明示換裝時直接刪呼叫
 * 點；emit-bash／emit-ps1／main.ts 的佔位各歸 T4.3／T4.4／M5）。
 * `kind==='auto'` 依 descriptor.autoColor 查色票（palette 驅動、零 id
 * 特判）；比對來源＝autoColor.key（model 段＝`.model.id`），key 缺省＝
 * 主值本身（effort 段直接複用 `.effort.level`）。展開時機在 run 建構
 * 之前（SGR／預覽同源；powerline autoFg 對展開後具體 index 計算）。
 * auto 落在無 autoColor 通道之段＝config 未經清洗（sanitizeSegmentColor
 * 會退 default）→ programmer error，比照未知 id 慣例拋 TypeError。
 */
function expandSegmentColor(
  color: SegmentColor,
  descriptor: SegmentDescriptor,
  input: ResolveInput,
  mainRaw: unknown,
): ColorSpec {
  if (color.kind !== 'auto') return color
  const autoColor = descriptor.autoColor
  if (autoColor === undefined) {
    throw new TypeError(
      `segment ${descriptor.id} 無 autoColor 通道卻收到 auto 色（config 應先經 deserializeConfig 清洗）`,
    )
  }
  const raw = autoColor.key !== undefined ? autoColor.key.tsPath(input.data) : mainRaw
  if (typeof raw !== 'string') {
    throw new TypeError(`auto 配色比對鍵預期 string，得到 ${typeof raw}`)
  }
  const index = autoColor.palette === 'model' ? modelPaletteIndex(raw) : effortPaletteIndex(raw)
  return { kind: 'ansi256', index }
}

// ── 第一趟：逐段求值 ──

/** 存活段的 join 素材：runs＝段內 run 序；bg＝powerline 箭頭交接色（plain 不使用）。 */
interface ResolvedSegment {
  runs: StyledRun[]
  bg: ColorSpec
}

/** 主值來源：shell-out 段走 shell 通道（tsPath 恆 undefined），其餘走 tsPath。 */
function mainValue(descriptor: SegmentDescriptor, input: ResolveInput): unknown {
  if (descriptor.category === 'shell-out') {
    return input.shell[descriptor.id as keyof MockShellChannel]
  }
  return descriptor.tsPath(input.data)
}

/** default 不落屬性（正規形，沉默處選擇 2）；非 default 複製新物件（run 不別名 config）。 */
function assignColor(run: StyledRun, layer: 'fg' | 'bg', spec: ColorSpec): void {
  if (spec.kind !== 'default') run[layer] = { ...spec }
}

function resolveSegment(
  seg: SegmentConfig,
  descriptor: SegmentDescriptor,
  input: ResolveInput,
  mode: BuilderConfig['mode'],
  powerlineArrow: boolean,
): ResolvedSegment | null {
  const raw = mainValue(descriptor, input)
  // T5.3（09-PLAN Rev 2 §5.3）：ariaText 組裝的語系基準——選填、缺席退
  // DEFAULT_LOCALE（zh-Hant，既有輸出 byte 不變的相容錨點）。
  const locale = input.locale ?? DEFAULT_LOCALE
  const isDash = descriptor.nullPolicy === 'dash' && raw == null
  if (descriptor.nullPolicy !== 'dash' && isValueDead(raw)) return null
  // T4.1（08-PLAN Rev 4 §4）：expiresAtPath 通用死值規則——欄位存在且
  // 「該路徑值 null／undefined，或 now ≥ 該值（已過期）」→ 視同死值、
  // 整段剔除。descriptor 掛欄驅動（reset-5h／reset-7d 掛 resets_at），
  // 禁 id 特判。
  if (descriptor.expiresAtPath !== undefined) {
    const expiresAt = descriptor.expiresAtPath.tsPath(input.data)
    if (expiresAt == null) return null
    if (input.now >= asNumber(expiresAt, 'expiresAtPath 值（epoch 秒）')) return null
  }
  // T4.2（08-PLAN Rev 4 §3）：auto 色票真展開（palette 查表；死值判定
  // 之後、run 建構之前——SGR／預覽同源，powerline autoFg 對展開後 index）。
  const segColor = expandSegmentColor(seg.color, descriptor, input, raw)

  const variant = seg.variant ?? defaultVariant(descriptor)
  // M6 C1（2026-07-14 拍板）：閘門走 category（零 id 特判）——百分比類
  // dash-null 顯 NA_TEXT；其餘 dash 政策段（token-in/out 等 category
  // 'always'）dash-null 仍顯 DASH_TEXT（全域 DASH_TEXT 值不動）。
  const isNa = isDash && descriptor.category === 'percentage'
  const valueText = isDash
    ? isNa
      ? NA_TEXT
      : DASH_TEXT
    : formatMainValue(descriptor.format, raw, input, variant)
  const suffix =
    descriptor.resetsAt !== undefined && variant === 'percent-reset'
      ? resetsAtSuffix(descriptor.resetsAt.tsPath(input.data), input.now, descriptor.resetsAt.countdown)
      : ''
  // M6 C4（2026-07-14 拍板；T5.3 起代換詞 locale 感知）：後綴含 `↺` 代換
  // 為 `t(locale).resetAriaWord`（沿倒數段既有 aria 代換慣例）——suffix
  // 非空時恆含 `↺`（resetsAtSuffix 兩套倒數形皆以 `↺` 起首），故
  // needsSuffixAria ⟺ suffix !== ''；仍以 includes 判定保留形狀彈性
  // （零 id 特判）。三處 ariaText 組裝點（下方 powerline／plain 單 run、
  // plain 閾值分裂 value run、bar run4）皆消費本二值。
  const resetWord = t(locale).resetAriaWord
  const ariaSuffix = suffix.includes('↺') ? suffix.replace('↺', resetWord) : suffix
  const needsSuffixAria = ariaSuffix !== suffix
  const prefix = seg.prefix ?? ''
  const head = prefix + (seg.icon ? `${descriptor.icon.glyph} ` : '')
  // icon run 的顯式 aria＝glyph 機械代換為 segmentAriaText(id, locale)
  // （T5.3 起走 locale 感知 accessor，取代直讀 descriptor.icon.ariaText
  // ——該欄位本身固定 zh-Hant，見 segments.ts SegmentDescriptor.icon 文件；
  // prefix 字面保留）；icon 關閉＝null → 純文字 fallback（省略 ariaText）。
  const headAria = seg.icon ? prefix + segmentAriaText(descriptor.id, locale) : null

  // 閾值只作用 percentage 類（沉默處選擇 4）；dash 不套閾值色（契約 3）。
  const threshold: { rule: ThresholdRule; index: number } | null =
    descriptor.category === 'percentage' &&
    seg.threshold !== undefined &&
    !isDash &&
    typeof raw === 'number'
      ? { rule: seg.threshold, index: bucketIndex(raw) }
      : null

  // ── T4.2 bar 4-run（08-PLAN Rev 4 §4；byte 形＝sp4/REPORT.md oracle）──
  // bar 啟用（config 清洗已限百分比段；resolve 端沿閾值慣例對非
  // percentage 段忽略）→ 靜態 4-run。**M6 C2（2026-07-14 拍板）撤除舊
  // `&& !isDash` 閘門**：不論主值是否存活恆走本節 4-run（null 時
  // filled=0、value 部＝NA_TEXT，見下方）。
  const bar = seg.bar === true && descriptor.category === 'percentage'
  if (bar) {
    // 填格＝max(0, min(20, floor(pct/5)))（負值防禦下界，比照 bucketIndex
    // 雙向 clamp 慣例）；主值 null（isDash）→ 填格恆 0（M6 C2，不取 raw）。
    const filled = isDash
      ? 0
      : Math.max(0, Math.min(BAR_CELL_COUNT, Math.floor(asNumber(raw, 'bar 百分比主值') / 5)))
    // threshold === undefined 而 bar 開（手改存檔可達）→ filled／pct 退段主色。
    // isDash 時 threshold 本就為 null（上方 `!isDash` 閘門）→ bucket 自然
    // 退段主色，M6 C2 零新分支。
    const bucket = threshold !== null ? threshold.rule.buckets[threshold.index] : segColor
    const pad = mode === 'powerline' && !powerlineArrow ? ' ' : ''
    // run1＝head：prefix＋icon 皆空仍 emit 空 text run 佔位（4-run 恆定形）。
    const headRun: StyledRun = { text: head }
    if (headAria !== null) headRun.ariaText = headAria
    // run2 filled／run3 empty 顯式 ariaText:''（PLAN §4 a11y：20 格方塊字
    // 不得進列 aria-label；數值語意由 run4 承載——run4 純文字 fallback）。
    const filledRun: StyledRun = { text: BAR_FILLED_CHAR.repeat(filled), ariaText: '' }
    const emptyRun: StyledRun = { text: BAR_EMPTY_CHAR.repeat(BAR_CELL_COUNT - filled), ariaText: '' }
    // run4＝' '+pct%+suffix+pad 單一運算式（percent-reset 後綴與
    // powerline-noarrow 右 padding 一律併入，沿「後綴附於 value 部」規則；
    // pct% 部分 null 時即 NA_TEXT，M6 C1）。M6 C4：後綴含 `↺` 時顯式代換
    // ariaText（pad 不入 aria，沿 D1 padding 慣例）。
    const valueRun: StyledRun = { text: ` ${valueText}${suffix}${pad}` }
    if (needsSuffixAria) valueRun.ariaText = ` ${valueText}${ariaSuffix}`
    assignColor(filledRun, 'fg', bucket)
    assignColor(valueRun, 'fg', bucket)
    if (mode === 'powerline') {
      // 桶色套 fg、bg 全段維持段主色（箭頭交接 bg 一律取段主色）、停用
      // fgOverride——head 恆 autoFg(段主色)，非 fgOverride ?? autoFg。
      assignColor(headRun, 'fg', autoFg(segColor))
      assignColor(headRun, 'bg', segColor)
      assignColor(filledRun, 'bg', segColor)
      assignColor(emptyRun, 'bg', segColor)
      assignColor(valueRun, 'bg', segColor)
    } else {
      assignColor(headRun, 'fg', segColor)
    }
    return { runs: [headRun, filledRun, emptyRun, valueRun], bg: segColor }
  }

  // 倒數段 value 部 aria 代換（T4.2，08-PLAN Rev 4 §4；T5.3 起代換詞
  // locale 感知）：引擎自產 `↺` 非 PUA、機械 enforcement 不攔——顯式代換
  // `resetWord`（沿 icon glyph→ariaText 代換慣例；使用者 prefix 通道字面
  // 保留不代換；S7 失守換 ASCII 替代時自然退場）。
  const valueAria =
    descriptor.format === 'reset-countdown-5h' || descriptor.format === 'reset-countdown-7d'
      ? valueText.replace('↺', resetWord)
      : null
  const ariaValue = valueAria ?? valueText

  if (mode === 'powerline') {
    // 段恆單 run（bar 段例外已於上方 return）：bg=閾值桶或段主色
    // （dash-null 退主色），fg=成對 auto-fg 陣列索引（D2）或 fgOverride；
    // 非閾值段同一派生規則。
    const bg = threshold !== null ? threshold.rule.buckets[threshold.index] : segColor
    const fg =
      threshold !== null
        ? autoFgBuckets(threshold.rule, seg.fgOverride)[threshold.index]
        : // bar 段的 fgOverride 停用規則已於上方 4-run 分支無條件 return
          // 落地（M6 C2 起不論主值死活皆走該分支）——`bar` 到此處恆為
          // false，fgOverride 對非 bar 段正常生效。
          (seg.fgOverride ?? autoFg(segColor))
    // D1 gating：powerlineArrow=false → 每段 value 後補一格右側空白（併入
    // 著色 run，composition 單源）；ariaText 維持不補格——toAriaLabel 逐
    // chunk trim，補了也會被削掉，省略較不易誤導閱讀者「aria 有格」。
    const pad = powerlineArrow ? '' : ' '
    const run: StyledRun = { text: head + valueText + suffix + pad }
    // M6 C4：後綴含 `↺` 時併入 ariaSuffix（代換 resetWord，T5.3 起 locale
    // 感知）；headAria 為 null 但後綴仍需代換（needsSuffixAria）時比照
    // valueAria 分支組裝。
    if (headAria !== null) run.ariaText = `${headAria} ${ariaValue}${ariaSuffix}`
    else if (valueAria !== null || needsSuffixAria) run.ariaText = `${prefix}${ariaValue}${ariaSuffix}`
    assignColor(run, 'fg', fg)
    assignColor(run, 'bg', bg)
    return { runs: [run], bg }
  }

  // plain：唯一分裂例外＝閾值生效且 head 非空（沉默處選擇 1）。
  if (threshold !== null && head !== '') {
    const headRun: StyledRun = { text: head }
    if (headAria !== null) headRun.ariaText = headAria
    assignColor(headRun, 'fg', segColor)
    const valueRun: StyledRun = { text: valueText + suffix }
    // M6 C4：本分裂路徑 valueAria 恆為 null（reset-countdown 格式僅見於
    // conditional 類、不落閾值分裂路徑）——僅後綴代換需求觸發顯式 ariaText。
    if (needsSuffixAria) valueRun.ariaText = `${valueText}${ariaSuffix}`
    assignColor(valueRun, 'fg', threshold.rule.buckets[threshold.index])
    return { runs: [headRun, valueRun], bg: segColor }
  }
  const run: StyledRun = { text: head + valueText + suffix }
  if (headAria !== null) run.ariaText = `${headAria} ${ariaValue}${ariaSuffix}`
  else if (valueAria !== null || needsSuffixAria) run.ariaText = `${prefix}${ariaValue}${ariaSuffix}`
  assignColor(run, 'fg', threshold !== null ? threshold.rule.buckets[threshold.index] : segColor)
  return { runs: [run], bg: segColor }
}

// ── 第二趟：join ──

function joinPlain(segments: readonly ResolvedSegment[], separator: string): StyledRun[] {
  const runs: StyledRun[] = []
  for (const segment of segments) {
    if (runs.length > 0 && separator !== '') runs.push({ text: separator, ariaText: '' })
    runs.push(...segment.runs)
  }
  return runs
}

/**
 * D1 gating：`powerlineArrow=false` → 不 emit 段間箭頭、`lastArrowCap`
 * 全面無效（cap 恆不 emit）；段本身的右 padding 已在 resolveSegment 併入
 * run.text，此函式僅需視 powerlineArrow 決定是否插箭頭／cap。
 */
function joinPowerline(
  segments: readonly ResolvedSegment[],
  lastArrowCap: boolean,
  powerlineArrow: boolean,
): StyledRun[] {
  const runs: StyledRun[] = []
  for (let i = 0; i < segments.length; i++) {
    if (powerlineArrow && i > 0) {
      const arrow: StyledRun = { text: POWERLINE_ARROW, ariaText: '' }
      assignColor(arrow, 'fg', segments[i - 1].bg)
      assignColor(arrow, 'bg', segments[i].bg)
      runs.push(arrow)
    }
    runs.push(...segments[i].runs)
  }
  if (powerlineArrow && lastArrowCap && segments.length > 0) {
    // 收尾箭頭：fg=末段bg、bg 缺席＝對終端底色 reset 過渡（Q1）。
    const cap: StyledRun = { text: POWERLINE_ARROW, ariaText: '' }
    assignColor(cap, 'fg', segments[segments.length - 1].bg)
    runs.push(cap)
  }
  return runs
}

/**
 * config＋情境三通道 → rows: StyledRun[][]（T2.3 多列語意落地，PLAN
 * §D2／§多列輸出的引擎契約）。
 *
 * ── 分組與渲染列序 ──
 * 第一趟存活段求值不變（逐段 resolveSegment）；存活段依**分組鍵
 * `seg.row ?? 0`** 歸桶（`defaultSegmentConfig` 不帶 `row` 與清洗後
 * 顯式 `row:0` 併同一桶，確保無存檔預設 config 與清洗後 config 列
 * 分佈一致）、桶內維持 `config.segments` 陣列既有序（列內順序＝陣列
 * 序，契約）。分組鍵**升冪排序**後即渲染列序（邏輯列 1..N）——亂序
 * `row` 輸入（如 5,2,9）依升冪 2,5,9 壓縮為列 1,2,3。某桶在本次
 * resolve 內全部段死亡（hide/empty）者，其鍵**不進 Map**、自然不佔
 * 渲染列序（空列剔除，無需額外過濾步驟）。
 *
 * ── 逐列 join（第二趟，桶內獨立管線） ──
 * 每個渲染列各自呼叫 joinPlain／joinPowerline——分隔符、箭頭、
 * `lastArrowCap` 收尾**皆不跨列**；`lastArrowCap` 因而天然逐列套用
 * （每列各自收尾箭頭，僅 `powerlineArrow===true` 生效，gating 見
 * joinPowerline）。`powerlineArrow===false` 的每段右 padding 語意
 * 不受多列影響（padding 已在 resolveSegment 併入段 run，與分組無關）
 * ——多列下即「每列末段亦帶尾隨空格」。
 *
 * ── rowSeparators 啟用位映射（T1.3，09-PLAN §D1 A-1；僅 plain 分支消費，
 * powerline 分支零觸碰＝天然忽略） ──
 * `config.rowSeparators[i]` 對位「config 正規化後的啟用列位」——**全部**
 * `enabled` 段（不論本次執行期存活與否）的相異 `seg.row ?? 0` 值升冪去重
 * 後的 dense 位置，與 `emit-bash.ts` `groupByRow`／`emit-ps1.ts`
 * `groupSegmentsByRow` 的分組序同基準。此基準**獨立於** `renderRowOrder`
 * （上方「執行期存活列」緊縮序，分桶前已剔除死亡段）——兩者於某啟用列
 * 整列執行期死亡時分岔，故**禁止**直接以 `renderRowOrder.map` 的迭代
 * index 取 `rowSeparators` 覆寫。實作另計 `enabledRowOrder`（全部 enabled
 * 段的相異 row 值升冪陣列，不受本次存活結果影響），每個存活渲染列
 * `row` 鍵先以 `enabledRowOrder.indexOf(row)` 映射回其啟用位，再取
 * `config.rowSeparators?.[啟用位]?.value ?? config.separator.value`
 * （`null`／缺項／整欄缺席皆退全域）——確保「整列死亡＋後列有覆寫」
 * 情境下預覽與腳本仍 byte 一致。
 *
 * ── 全段隱藏退化（實作層防衛） ──
 * 零存活列時（Map 為空）回傳 **`[[]]`**（一列空列）而非 `[]`——保住
 * `toAnsi`「全隱藏輸出恆為單一 reset、非空字串」的既有鎖死不變量；
 * `rows.length > 0 ? rows : [[]]` 結構性保證 `resolve()` 回傳長度
 * 恆 ≥1（永不 `[]`），測試層另補等價斷言。
 *
 * 未知 segment id＝programmer error（config 應先經 deserializeConfig
 * 對真 catalog 清洗）→ TypeError。
 */
export function resolve(config: BuilderConfig, input: ResolveInput): StyledRun[][] {
  const groups = new Map<number, ResolvedSegment[]>()
  for (const seg of config.segments) {
    if (!seg.enabled) continue
    const descriptor = DESCRIPTORS_BY_ID[seg.id as SegmentId] as SegmentDescriptor | undefined
    if (descriptor === undefined) {
      throw new TypeError(`未知 segment id：${seg.id}（config 應先經 deserializeConfig 清洗）`)
    }
    const segment = resolveSegment(seg, descriptor, input, config.mode, config.powerlineArrow)
    if (segment === null) continue
    const row = seg.row ?? 0
    const bucket = groups.get(row)
    if (bucket === undefined) groups.set(row, [segment])
    else bucket.push(segment)
  }
  const renderRowOrder = [...groups.keys()].sort((a, b) => a - b)
  // T1.3（09-PLAN §D1 A-1）：啟用位基準——全部 enabled 段（不論存活）的
  // 相異 row 值升冪去重陣列，與 renderRowOrder（執行期存活列緊縮序）
  // 分開計算，避免整列執行期死亡時兩基準分岔而誤取覆寫（見上方 docstring）。
  const enabledRowOrder = [...new Set(
    config.segments.filter((seg) => seg.enabled).map((seg) => seg.row ?? 0),
  )].sort((a, b) => a - b)
  const rows: StyledRun[][] = renderRowOrder.map((row) => {
    const bucket = groups.get(row)!
    if (config.mode === 'powerline') {
      return joinPowerline(bucket, config.lastArrowCap, config.powerlineArrow)
    }
    // 存活渲染列 row 鍵 → 啟用位 → rowSeparators 覆寫（null／缺項退全域）。
    const enabledPos = enabledRowOrder.indexOf(row)
    const separatorValue = config.rowSeparators?.[enabledPos]?.value ?? config.separator.value
    return joinPlain(bucket, separatorValue)
  })
  return rows.length > 0 ? rows : [[]]
}

// ── aria-label 組裝純函式（§預覽契約；render-preview 只呼叫） ──

/**
 * BMP 私用區＋兩補充私用平面（Nerd Font glyph／powerline 箭頭皆落 BMP
 * PUA）。全範圍以顯式 `\u{...}` 轉義寫出、不嵌字面不可見字元——T1.4 裁定：
 * raw 不可見字元易被編輯器誤刪／正規化致 enforcement 靜默失效（與
 * validate.ts 的 PUA_RE 同一定義同一慣例）。
 */
const PUA_RE = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u

export function containsPua(text: string): boolean {
  return PUA_RE.test(text)
}

/**
 * StyledRun[] → 預覽區 aria-label：逐 run 取 ariaText（省略＝純文字
 * fallback text，PUA run 省略→拋 TypeError）、修剪端空白、剔空 chunk、
 * 以單一空白串接（「空段落分隔以單一空白正規化」）。結果再做零 PUA
 * 機械斷言（顯式 ariaText 夾帶 PUA 亦拋）——兩層負向 enforcement 皆
 * 可測（.t17 §4 形沿用）。
 */
export function toAriaLabel(runs: readonly StyledRun[]): string {
  const chunks: string[] = []
  for (const run of runs) {
    let chunk: string
    if (run.ariaText !== undefined) {
      chunk = run.ariaText
    } else {
      if (containsPua(run.text)) {
        throw new TypeError(
          `PUA run 不得省略 ariaText（fallback 僅限純文字 run）：${JSON.stringify(run.text)}`,
        )
      }
      chunk = run.text
    }
    const trimmed = chunk.trim()
    if (trimmed !== '') chunks.push(trimmed)
  }
  const label = chunks.join(' ')
  if (containsPua(label)) {
    throw new TypeError('aria-label 不得含 PUA 碼位（顯式 ariaText 夾帶 glyph）')
  }
  return label
}
