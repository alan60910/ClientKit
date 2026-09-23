/**
 * S5-T1.3（(internal design doc) §型別契約 BuilderConfig／
 * config 清洗註解）：BuilderConfig／SegmentConfig 型別、serialize／
 * deserialize／migrate 骨架＋drop-unknown-and-continue 清洗純函式。
 *
 * 清洗承諾（「重整不丟」）：絕不整份拒收——未知 id 丟棄、未知 variant
 * 退預設、ansi256 越界 clamp（color.ts 同源）、壞 hex 退 default、未知
 * 欄忽略、threshold buckets 桶數校正恰 10（不足補預設、超長截斷；
 * auto-fg 平行陣列不入 config——emit 期由 threshold.ts autoFgBuckets
 * 派生，校正後自然同步）、separator／prefix 過 validate.ts 失敗即退
 * 預設；version≠CONFIG_VERSION（現＝2）→ migrate——v1 存檔逐欄清洗＋
 * 依 mode 派生 powerlineArrow（v1→v2，PLAN §D2 06a）；其餘版本（0、3、
 * 字串、缺欄）無前代可依，重置為預設。
 *
 * segment 目錄以 SegmentCatalog 注入（segments.ts 於 M2 才建立，本模組
 * 不依賴之）：id 型別暫為 string，清洗以「id ∈ catalog.ids」執行期保證
 * ——M2 segments.ts 建立 SegmentId 字面聯合後，resolve 端可安全窄化。
 *
 * 純函式、零 DOM import、不碰 localStorage（讀寫在 main.ts 層）。
 */
import { clampAnsi256Index, normalizeHex, type ColorSpec } from './color.js'
import { THRESHOLD_BUCKET_COUNT, type ThresholdRule } from './threshold.js'
import { validateCustomText } from './validate.js'

// ── 目錄注入 ──

/**
 * segment 目錄的最小注入面（M2 segments.ts 派生真目錄；測試可給假目錄）。
 *
 * `barEligibleIds`／`autoEligibleIds`（T3.3，(internal design doc)
 * expansion/PLAN.md Rev 4 §3；round 2 補閉）：segments.ts 側的
 * `SEGMENT_CATALOG` 導出依據——`barEligibleIds`＝`category === 'percentage'`
 * 之段、`autoEligibleIds`＝有 `autoColor` 欄之段。本檔（config.ts）維持
 * 不依賴 segments.ts（檔頭現行架構明文）、零硬編 id 清單，故兩集合僅落
 * 型別於此、由 catalog 注入方（segments.ts）實際導出——目錄擴充時兩集合
 * 自動跟進，本檔無需同步改動。**本任務只落型別＋導出**：`sanitizeSegment`
 * 對兩集合的實際清洗消費（bar 限百分比段／auto 限 model・effort 段）屬
 * T3.4（下一棒），此處先開放型別供其直接消費。
 */
export interface SegmentCatalog {
  /** 全部 segment id，目錄順序＝缺段補列時的附加順序。 */
  ids: readonly string[]
  /** 各 id 的允許 variant 集（目錄衍生，非自由字串）；無 variant 之段可缺鍵。 */
  variantsById: Readonly<Record<string, readonly string[] | undefined>>
  /** 允許套用長條圖（`bar`）之段集（category==='percentage'）；T3.4 消費。 */
  barEligibleIds: ReadonlySet<string>
  /** 允許套用自動配色（`SegmentColor.kind==='auto'`）之段集（有 autoColor 欄）；T3.4 消費。 */
  autoEligibleIds: ReadonlySet<string>
}

// ── 型別（PLAN 型別契約） ──

export const CONFIG_VERSION = 2

/** 分隔符 preset 正面表列（PLAN：'|'／'›'／'·'／空格）。 */
export const SEPARATOR_PRESETS = ['|', '›', '·', ' '] as const
export type SeparatorPresetValue = (typeof SEPARATOR_PRESETS)[number]

export type SeparatorConfig =
  | { kind: 'preset'; value: SeparatorPresetValue }
  | { kind: 'custom'; value: string } // plain 限定，≤8、過拒收集 R

/**
 * 段主色三態＋auto（T3.4，(internal design doc)
 * Rev 4 §3）：`ColorSpec`（color.ts）維持封閉三態不動——該檔為 SGR 建構
 * ＋色彩數學（亮度／auto-fg／SGR 參數段）的單一事實來源，其檔頭明文
 * 「零 DOM import、純函式」職責邊界不收容「使用者選了 auto 配色」這種
 * config 層選填語意。`SegmentColor` 故於此（config.ts）另立、僅用於
 * `SegmentConfig.color`——落點屬本任務裁量（型別放哪個檔案由 developer
 * 依現行架構判斷），選 config.ts 自持。
 */
export type SegmentColor = ColorSpec | { kind: 'auto' }

export interface SegmentConfig {
  id: string // 清洗保證 ∈ catalog.ids（見檔頭）
  enabled: boolean
  icon: boolean
  prefix?: string // ≤8 字元，過 validate.ts 拒收集 R（Q4 進 v1）
  color: SegmentColor // plain=fg；powerline=bg（D3：mode 切換保值）；auto 限 catalog.autoEligibleIds 段
  fgOverride?: ColorSpec // powerline 覆寫 auto-fg；三態封閉，一律不收 auto（見 sanitizeSegment）
  threshold?: ThresholdRule
  variant?: string // 須 ∈ catalog.variantsById[id]，否則清洗退預設
  /**
   * 長條圖正交欄（T3.4，08-PLAN Rev 4 §3；D-c：CONFIG_VERSION 不 bump，
   * 選填欄缺省 false，先例同 06b `row`）：限 `catalog.barEligibleIds`
   * （category==='percentage'）之段——raw `true` 且段合格 → `true`；
   * 其餘一切（`false`／缺席／非 boolean／非百分比段）→ 欄位**缺席**（比照
   * `prefix`／`fgOverride` 等既有選填欄「不搬運非法值」慣例，非寫入
   * `false`）。resolve／emit 消費（4-run bar 展開）屬 M4。
   */
  bar?: boolean
  /**
   * 多列佈局（T2.1，PLAN §D2 06b）：所屬渲染列（0-index）。**缺欄**＝
   * 語意上等同 0（分組鍵 `seg.row ?? 0`，供 resolve（T2.2）沿用），鍵維持
   * 缺席以與 defaultSegmentConfig（不帶 row）天然一致；**存在但非法**
   * （非整數／負值／NaN）清洗為 0；**存在且越界**（> catalog 現役段數−1）
   * clamp 至該上限——防手改存檔 `row:999999999` 讓列選單枚舉凍死頁面。
   * `normalizeRows` 於每次 config 寫回時將啟用段 row 重寫為 0..N−1，使
   * 存檔口徑與渲染列序永久合一（M5／T5.3 於 main.ts commitConfig 接線）。
   */
  row?: number
}

export interface BuilderConfig {
  version: typeof CONFIG_VERSION
  mode: 'plain' | 'powerline'
  separator: SeparatorConfig
  /**
   * 逐列分隔符覆寫（T1.1，(internal design doc) §D1
   * A-1／A-2；D-c：CONFIG_VERSION 不 bump，選填欄缺省即「全繼承」，
   * 先例同 06b `row`／08 `bar`）：索引對位「config 正規化後的啟用列位」
   * ——全部 `enabled` 段依 row 值升冪去重排序後的 dense 位置，與
   * emit-bash `groupByRow`／emit-ps1 `groupSegmentsByRow` 的分組序同
   * 基準（消費端見 T1.3 resolve 映射、T1.4/T1.5 emitter）。`null`／缺項
   * ＝該列繼承全域 `separator`。**僅 plain 模式生效**——mode 為
   * powerline 時本欄保值不清除（惰性存續，比照既有 `separator` 慣例），
   * 由 emit 端依 mode 忽略，本模組不做 mode gating。正規形（
   * `sanitizeConfig` 產出）：陣列已修剪尾端 `null`、全 `null`／空陣列
   * 省略本欄——本任務只管 schema／清洗，reindex（跟列走）屬 T1.2。
   */
  rowSeparators?: (SeparatorConfig | null)[]
  lastArrowCap: boolean // powerline 末段收尾箭頭（預設 true，Q1）
  powerlineArrow: boolean // powerline 段間箭頭（預設 false，v2 新欄；D1 gating 見 emitter，本模組不碰）
  segments: SegmentConfig[]
}

// ── 預設值工廠 ──

function defaultSeparator(): SeparatorConfig {
  return { kind: 'preset', value: '|' }
}

/**
 * 單一 segment 的預設列（未啟用、終端預設色、選填欄全缺）。icon（顯示
 * 文字前綴）預設 true——T5.12（Rev 7，2026-07-11 使用者裁決）：M1.5 已將
 * 25 段 icon.glyph 全數由 emoji 換成 ASCII 文字前綴（如 `cwd:`），「顯示
 * 圖示」措辭與預設關閉已過時，改名「顯示文字」並預設開啟。此翻轉不影響
 * `sanitizeSegment` 對既有存檔的解讀——該函式以 `raw.icon === true` 直接
 * 判斷（缺欄／非 true 皆退 false），不讀本函式的預設值；僅影響全新
 * config（`defaultConfig`）與存檔缺席、需補列的全新 segment。
 */
export function defaultSegmentConfig(id: string): SegmentConfig {
  return { id, enabled: false, icon: true, color: { kind: 'default' } }
}

/** 預設 config：目錄順序全列、全停用（初始啟用集屬 M3 UI 決策）。 */
export function defaultConfig(catalog: SegmentCatalog): BuilderConfig {
  return {
    version: CONFIG_VERSION,
    mode: 'plain',
    separator: defaultSeparator(),
    lastArrowCap: true,
    powerlineArrow: false,
    segments: catalog.ids.map((id) => defaultSegmentConfig(id)),
  }
}

// ── serialize ──

/** BuilderConfig → JSON 字串（localStorage 存放形；main.ts 層負責讀寫）。 */
export function serializeConfig(config: BuilderConfig): string {
  return JSON.stringify(config)
}

// ── deserialize（drop-unknown-and-continue 清洗） ──

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 無法辨識（含壞 hex、非數字 index、未知 kind）→ null，呼叫端退各自預設。 */
function sanitizeColorSpec(raw: unknown): ColorSpec | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'default':
      return { kind: 'default' }
    case 'ansi256':
      return typeof raw.index === 'number'
        ? { kind: 'ansi256', index: clampAnsi256Index(raw.index) }
        : null
    case 'truecolor': {
      if (typeof raw.hex !== 'string') return null
      const hex = normalizeHex(raw.hex)
      return hex === null ? null : { kind: 'truecolor', hex }
    }
    default:
      return null
  }
}

/**
 * `.color` 專用清洗（T3.4，08-PLAN Rev 4 §3；清洗順序釘死——**先判
 * auto**：先進 `sanitizeColorSpec` 會被其 `default` case 吃掉、id 合格
 * 判定太遲，round 2 haiku 發現）：`raw?.kind === 'auto'` 時，allowAuto
 * （呼叫端傳入該段 id ∈ `catalog.autoEligibleIds`）才放行
 * `{kind:'auto'}`，否則退 `{kind:'default'}`；非 auto 一律委派既有三態
 * 封閉的 `sanitizeColorSpec`。**`fgOverride` 不得走此函式**——一律維持
 * `sanitizeColorSpec`（見 `sanitizeSegment`），杜絕手改存檔
 * `{fgOverride:{kind:'auto'}}` 讓 auto 流入 SGR 建構（`colorSgrParams`
 * 窮盡 switch 無 default，未攔截的 auto 會使該處回傳 undefined）。
 */
function sanitizeSegmentColor(raw: unknown, allowAuto: boolean): SegmentColor {
  if (isRecord(raw) && raw.kind === 'auto') {
    return allowAuto ? { kind: 'auto' } : { kind: 'default' }
  }
  return sanitizeColorSpec(raw) ?? { kind: 'default' }
}

/**
 * `SegmentColor` → `ColorSpec` 佔位轉換（M3／M4 邊界，08-PLAN Rev 4 §3
 * 「M3 邊界」條款）：`auto` 尚未展開為具體色票——真正的色票查表展開屬
 * M4（resolve.ts T4.2／emit-bash.ts T4.3／emit-ps1.ts T4.4；main.ts 基色
 * 選色器 UI 屬 M5 T5.2）。本函式只供上述下游消費點滿足 TypeScript
 * strict 的最小防禦：遇 `auto` 暫以 `{kind:'default'}` 頂替，**不得**在
 * 此或任何下游消費點實作色票展開邏輯（該邏輯換裝時直接刪除本函式的
 * 呼叫點、改接 M4／M5 的真展開）。
 */
export function segmentColorPlaceholder(color: SegmentColor): ColorSpec {
  return color.kind === 'auto' ? { kind: 'default' } : color
}

/**
 * 桶數校正恰 10：不足補 { kind:'default' }、超長截斷、壞桶逐桶退
 * default。threshold 整體非物件／buckets 非陣列＝形狀不可辨 → undefined
 * （退「無閾值」預設，不猜）。
 */
function sanitizeThreshold(raw: unknown): ThresholdRule | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.buckets)) return undefined
  const buckets: ColorSpec[] = []
  for (let i = 0; i < THRESHOLD_BUCKET_COUNT; i++) {
    buckets.push(sanitizeColorSpec(raw.buckets[i]) ?? { kind: 'default' })
  }
  return { buckets: buckets as unknown as ThresholdRule['buckets'] }
}

/**
 * row 清洗（見 SegmentConfig.row 文件）：`undefined`（鍵缺席）→
 * `undefined`（維持缺席，與 defaultSegmentConfig 一致）；其餘「存在」值
 * 一律清洗為合法 number——非數字型別／NaN／非整數（含 float，不四捨
 * 五入）／負值 → 0；整數超出 `[0, catalog.ids.length−1]` 上界 → clamp
 * 至上界（現役目錄段數計，不寫死 25）；合法整數原樣保留。
 */
function sanitizeRow(raw: unknown, catalog: SegmentCatalog): number | undefined {
  if (raw === undefined) return undefined
  const max = Math.max(0, catalog.ids.length - 1)
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return 0
  return Math.min(raw, max)
}

function sanitizeSeparator(raw: unknown): SeparatorConfig {
  if (!isRecord(raw) || typeof raw.value !== 'string') return defaultSeparator()
  if (raw.kind === 'preset') {
    return (SEPARATOR_PRESETS as readonly string[]).includes(raw.value)
      ? { kind: 'preset', value: raw.value as SeparatorPresetValue }
      : defaultSeparator()
  }
  if (raw.kind === 'custom') {
    return validateCustomText(raw.value).ok
      ? { kind: 'custom', value: raw.value }
      : defaultSeparator()
  }
  return defaultSeparator()
}

/**
 * `rowSeparators` 陣列單一元素清洗（T1.1，09-PLAN §D1 A-2）：`null`／
 * 缺項／畸形一律回 `null`（該列繼承全域分隔符）——**不得**複用
 * `sanitizeSeparator`：其全失敗路徑回 `defaultSeparator()`（＝明示
 * `'|'`），直接複用會把畸形覆寫污染成「明示選 preset '|'」、破壞
 * 「`null`＝繼承全域」的語意。與 `sanitizeSeparator` 平行實作、各自
 * 獨立的失敗出口，僅結構完整者委派既有驗證核心（preset 白名單、
 * `validateCustomText`）。
 */
function sanitizeRowSeparator(raw: unknown): SeparatorConfig | null {
  if (!isRecord(raw) || typeof raw.value !== 'string') return null
  if (raw.kind === 'preset') {
    return (SEPARATOR_PRESETS as readonly string[]).includes(raw.value)
      ? { kind: 'preset', value: raw.value as SeparatorPresetValue }
      : null
  }
  if (raw.kind === 'custom') {
    return validateCustomText(raw.value).ok ? { kind: 'custom', value: raw.value } : null
  }
  return null
}

/**
 * `rowSeparators` 陣列級清洗（T1.1，09-PLAN §D1 A-2）：非陣列 → 回
 * `undefined`（欄位缺席）；逐元素委派 `sanitizeRowSeparator`；長度
 * clamp 上界比照 `sanitizeRow`（見上方，對 `row:999999999` 的 DoS
 * 防禦精神）——上界取目錄段數 `catalog.ids.length`（現役啟用列數不可能
 * 超過段數，防手改存檔塞巨陣列讓列群組渲染凍死頁面）；clamp 後修剪
 * 尾端 `null`（正規形不留冗餘「全繼承」尾巴）；修剪後全 `null`／空陣列
 * → `undefined`（回「全繼承」正規形，省略本欄避免存檔膨脹）。
 */
function sanitizeRowSeparators(
  raw: unknown,
  catalog: SegmentCatalog,
): (SeparatorConfig | null)[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const max = catalog.ids.length
  const clamped = raw.slice(0, max).map((entry) => sanitizeRowSeparator(entry))
  let end = clamped.length
  while (end > 0 && clamped[end - 1] === null) end--
  const trimmed = clamped.slice(0, end)
  return trimmed.length > 0 ? trimmed : undefined
}

/** 未知 id／非物件 → null（整列丟棄）；其餘欄逐欄清洗、未知欄不搬運即忽略。 */
function sanitizeSegment(raw: unknown, catalog: SegmentCatalog): SegmentConfig | null {
  if (!isRecord(raw)) return null
  const id = raw.id
  if (typeof id !== 'string' || !catalog.ids.includes(id)) return null

  const seg: SegmentConfig = {
    id,
    enabled: raw.enabled === true,
    icon: raw.icon === true,
    // auto 段別限定：allowAuto＝該 id ∈ catalog.autoEligibleIds（T3.4）。
    color: sanitizeSegmentColor(raw.color, catalog.autoEligibleIds.has(id)),
  }
  if (typeof raw.prefix === 'string' && validateCustomText(raw.prefix).ok) {
    seg.prefix = raw.prefix
  }
  // fgOverride 一律不收 auto（維持三態封閉 sanitizeColorSpec，見上方
  // sanitizeSegmentColor 檔頭說明；防手改存檔 {kind:'auto'} 注入）。
  const fgOverride = sanitizeColorSpec(raw.fgOverride)
  if (fgOverride !== null) seg.fgOverride = fgOverride
  // bar：限 catalog.barEligibleIds；其餘（false/缺席/非 boolean/非百分比
  // 段）欄位缺席（比照 prefix／fgOverride 慣例，不搬運 false）。
  if (raw.bar === true && catalog.barEligibleIds.has(id)) {
    seg.bar = true
  }
  const threshold = sanitizeThreshold(raw.threshold)
  if (threshold !== undefined) seg.threshold = threshold
  const variants = catalog.variantsById[id]
  if (typeof raw.variant === 'string' && variants !== undefined && variants.includes(raw.variant)) {
    seg.variant = raw.variant
  }
  const row = sanitizeRow(raw.row, catalog)
  if (row !== undefined) seg.row = row
  return seg
}

/**
 * segments 清洗＋目錄對帳：保留存檔順序（使用者拖曳序）、未知 id 丟、
 * 重複 id 取首見；目錄新增而存檔缺列者，依目錄順序補預設列於末——
 * 產出恆為 catalog.ids 的一個排列（UI 25 列清單直接可用）。
 */
function sanitizeSegments(raw: unknown, catalog: SegmentCatalog): SegmentConfig[] {
  const out: SegmentConfig[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const seg = sanitizeSegment(entry, catalog)
      if (seg !== null && !seen.has(seg.id)) {
        seen.add(seg.id)
        out.push(seg)
      }
    }
  }
  for (const id of catalog.ids) {
    if (!seen.has(id)) out.push(defaultSegmentConfig(id))
  }
  return out
}

/**
 * 頂層欄位清洗核心（`rowSeparators` 除外——見 `sanitizeConfig`）：
 * `migrateConfig`（v1→v2）與 `sanitizeConfig`（v2）共用同一套逐欄清洗，
 * 但 `rowSeparators` 故意不在此——v1 存檔無「config 正規化後啟用列位」
 * 這個 v2 專屬概念可依附，migrateConfig 分支**不得**產生此欄（09-PLAN
 * §D1 A-2 補充契約），故該欄清洗獨立於此核心之外、僅 `sanitizeConfig`
 * 呼叫。
 */
function sanitizeConfigCore(
  raw: Record<string, unknown>,
  catalog: SegmentCatalog,
): Omit<BuilderConfig, 'rowSeparators'> {
  return {
    version: CONFIG_VERSION,
    mode: raw.mode === 'powerline' ? 'powerline' : 'plain',
    separator: sanitizeSeparator(raw.separator),
    lastArrowCap: typeof raw.lastArrowCap === 'boolean' ? raw.lastArrowCap : true,
    powerlineArrow: typeof raw.powerlineArrow === 'boolean' ? raw.powerlineArrow : false,
    segments: sanitizeSegments(raw.segments, catalog),
  }
}

function sanitizeConfig(raw: Record<string, unknown>, catalog: SegmentCatalog): BuilderConfig {
  const core = sanitizeConfigCore(raw, catalog)
  const rowSeparators = sanitizeRowSeparators(raw.rowSeparators, catalog)
  return rowSeparators !== undefined ? { ...core, rowSeparators } : core
}

/**
 * migrate 階梯步進表（T3.2，(internal design doc)
 * §Milestone 3；階梯化取代原本 06a 的單步 `if (raw.version !== 1)`）：
 * 鍵＝來源版本號（`raw.version`），值＝該版本→下一版本（鍵+1）的 raw
 * 層轉換純函式——僅搬動／剝除／派生欄位，**不**呼叫任何 sanitize（收尾
 * 統一由 `migrateConfig` 的 while 迴圈跑完全部步進後一次呼叫
 * `sanitizeConfigCore`，見下方）。
 *
 * v1→v2（沿用 06a 語意）：
 * - 剝除 v2 專屬欄 `rowSeparators`（v1 無「config 正規化後啟用列位」這個
 *   v2 概念可依附，即使 raw 湊巧夾帶亦不遷移——09-PLAN §D1 A-2 補充
 *   契約，config.test.ts 「migrateConfig 分支不得產生此欄」凍結案）。
 * - `powerlineArrow` 依 `mode` **無條件派生**、覆寫 raw 原夾帶值
 *   （'powerline'→true——保留既有箭頭觀感；'plain' 或 mode 缺欄／非法
 *   → false）——非 fill-if-missing，config.test.ts T3.1 凍結案（正反
 *   兩案）明文鎖死此語意：即使 v1 raw 湊巧夾帶與 mode 矛盾的顯式
 *   `powerlineArrow`，該值仍被無視、整個覆寫為派生值。
 *
 * 未來 v2→v3 時在此加鍵 `2:`，v1 分支（鍵 `1`）原封不動——階梯設計的
 * 存在意義即令「新版本只加新鍵」，不需複製貼上舊清洗邏輯、不動舊步進。
 */
const MIGRATION_STEPS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  1: (raw) => {
    const { rowSeparators: _rowSeparators, ...rest } = raw
    return { ...rest, powerlineArrow: rest.mode === 'powerline' }
  },
}

/**
 * migrate（版本階梯，T3.2 重構自 06a 單步 if）：從 `raw.version` 起步，
 * 沿 `MIGRATION_STEPS` 逐版查表步進至 `CONFIG_VERSION`——每步僅在 raw
 * 層搬動欄位（見上方步進表逐版說明），迴圈中**不**呼叫任何 sanitize，
 * 避免中繼版本的半成品 raw 被提早清洗、吃掉尚待下一步讀取的欄位。
 *
 * **缺步進函式（`MIGRATION_STEPS[version]` 為 `undefined`）→ 視同未知
 * 版本，回傳 `defaultConfig(catalog)`**（不得對 `undefined` 求值拋
 * TypeError）：`version` 非 `number`（如字串 "1"、缺欄）或雖為 `number`
 * 但查無對應步進（如未來 v3 忘寫 2→3 步進時卡在中繼態、或人工注入的
 * 非整數版本 `1.5`）皆走此出口——config.test.ts 有一條獨立測試（T3.2）
 * 直接斷言此路徑不 throw、回預設。到達 `CONFIG_VERSION` 後跳出迴圈，
 * 收尾呼叫 `sanitizeConfigCore`（**絕不呼叫 `sanitizeConfig`**——
 * `rowSeparators` 為 v2 專屬新欄，v1 遷移產出恆不帶此欄，即使 raw 湊巧
 * 夾帶亦不遷移，09-PLAN §D1 A-2 補充契約；config.test.ts 「migrateConfig
 * 分支不得產生此欄」凍結案）；派生欄（`powerlineArrow`）已於步進函式內
 * 寫入 raw、以布林值存在，`sanitizeConfigCore` 讀取時直接原樣搬運，故
 * 此處不需額外覆寫。
 *
 * 其餘版本（0、3、字串、缺欄——非可步進之版本）無前代 schema 可依，一律
 * 經上述缺步進出口重置為預設。
 *
 * 第三參數 `steps`（選填、預設 `MIGRATION_STEPS`）：唯一目的是供下方
 * `_migrateConfigForTest` 注入假步進表，讓測試能不依賴真實版本 bump 就走出
 * 「連續步進 ≥2 次」的接力路徑；本函式的唯一生產呼叫端（`deserializeConfig`）
 * 永遠不傳第三參數，行為與新增此參數前完全一致。
 */
function migrateConfig(
  raw: Record<string, unknown>,
  catalog: SegmentCatalog,
  steps: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = MIGRATION_STEPS,
): BuilderConfig {
  let current: Record<string, unknown> = raw
  while (current.version !== CONFIG_VERSION) {
    const version = current.version
    if (typeof version !== 'number') return defaultConfig(catalog)
    const step = steps[version]
    if (step === undefined) return defaultConfig(catalog)
    current = { ...step(current), version: version + 1 }
  }
  return sanitizeConfigCore(current, catalog)
}

/**
 * 測試專用注入面（(internal design doc)「🟡 `migrateConfig` 多步串接（while
 * ≥2 次迭代）零自動化覆蓋」採納項）：讓 config.test.ts 能注入假步進表，
 * 直接斷言 while 鏈「連續步進 ≥2 次」的接力正確性——真實 `MIGRATION_STEPS`
 * 現僅鍵 `1`（v1→v2），v3 首次 bump 前無法透過真實遷移走出多步鏈，只能靠
 * 假步進表提前驗證版本遞增／欄位接力／終止三件事。**僅供測試呼叫**——
 * 生產路徑（`deserializeConfig` → `migrateConfig`）恆用預設參數
 * （`MIGRATION_STEPS`），不經此函式；`migrateConfig` 本身簽章新增的第三個
 * 選填參數對生產呼叫端零改動，`deserializeConfig` 對外行為與既有測試零
 * 變動。
 */
export function _migrateConfigForTest(
  raw: Record<string, unknown>,
  catalog: SegmentCatalog,
  steps: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>,
): BuilderConfig {
  return migrateConfig(raw, catalog, steps)
}

/**
 * JSON 字串 → BuilderConfig。絕不丟例外、絕不整份拒收：壞 JSON／非
 * 物件頂層 → 預設 config；version≠CONFIG_VERSION（嚴格 ===，"2" 字串
 * 不收）→ migrate（v1 專用遷移；其他版本重置）；version=CONFIG_VERSION
 * → 逐欄清洗（drop-unknown-and-continue，未知頂層欄不搬運即忽略）。
 * 清洗為冪等純函式。
 */
export function deserializeConfig(json: string, catalog: SegmentCatalog): BuilderConfig {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return defaultConfig(catalog)
  }
  if (!isRecord(raw)) return defaultConfig(catalog)
  if (raw.version !== CONFIG_VERSION) return migrateConfig(raw, catalog)
  return sanitizeConfig(raw, catalog)
}

// ── normalizeRows（多列佈局，T2.1；純函式，M5／T5.3 於 main.ts commitConfig 接線） ──

/**
 * 多列渲染列序正規化：僅重寫**啟用段**的 `row`——依現值升冪排序、去重
 * 壓縮為連續 0..N−1（N＝啟用段中相異 row 值個數，即使用中渲染列數）；
 * 未指定 row（`undefined`）視同 0（與分組鍵 `seg.row ?? 0` 同義）。停用
 * 段 `row` 原值凍結（含 `undefined` 維持 `undefined`）——不正規化、不
 * 讀取、不寫回。
 *
 * 純函式：不 mutate 輸入陣列或其元素；停用段沿用原物件參照（未變更、
 * 非拷貝亦不違反純度），啟用段回傳淺拷貝＋新 `row`。**不重排陣列本身
 * ──列內順序＝`config.segments` 陣列既有順序（PLAN 契約），此函式只
 * 重寫 row 標籤、不搬動元素位置**，故同 row 段的相對順序自然穩定。
 *
 * 冪等：正規化後的 row 值集恆為 `[0, N)` 且已排序，故重複套用等價於
 * 套用一次（`normalizeRows(normalizeRows(xs))` deepEqual
 * `normalizeRows(xs)`）。
 *
 * 簽章選型：對 `SegmentConfig[]`（而非整個 `BuilderConfig`）操作——本
 * 任務不改動 `version`／其餘欄位，行為與呼叫端無關，segments 陣列即
 * 最小必要輸入面；main.ts 於 M5 接線時可直接
 * `{ ...config, segments: normalizeRows(config.segments) }`。
 */
export function normalizeRows(segments: readonly SegmentConfig[]): SegmentConfig[] {
  const enabledRows = segments.filter((seg) => seg.enabled).map((seg) => seg.row ?? 0)
  const sortedUniqueRows = [...new Set(enabledRows)].sort((a, b) => a - b)
  const rewritten = new Map(sortedUniqueRows.map((row, index) => [row, index]))
  return segments.map((seg) => {
    if (!seg.enabled) return seg
    return { ...seg, row: rewritten.get(seg.row ?? 0)! }
  })
}
