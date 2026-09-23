/**
 * S5-T3.3（(internal design doc) §Builder UI a11y 契約／
 * §預覽契約／§產生器契約 8）：工具頁 UI 全流程狀態機（browser-only）。
 *
 * 職責分工（不重複既有模組）：
 * - 預覽渲染 → render-preview.ts 的 createPreview controller（本檔只呼
 *   setConfig/setScenario/setTheme，不自碰預覽 DOM、不自行 resolve）。
 * - resolve／emit-ansi／aria-label 純函式在 controller 內；三後端產生器
 *   emitBash／emitPs1／emitSettings 於本檔呼叫填三 <pre>。
 * - config 型別／清洗、色盤色表、閾值模板、輸入驗證皆用既有純函式模組。
 *
 * 單一真相＝BuilderConfig：localStorage 讀（deserializeConfig＋清洗，重整
 * 不丟）／寫（變更即存）；任何控件變動 → 改 config → persist → 刷預覽＋
 * 三產物。DOM 結構契約（<template> 生成／token 取代／節點命名）無集中
 * 文件，見 index.html 各 <template> 附近與本檔「<template> 實例化」
 * ／「固定節點」兩節的內嵌註解；controller API 見 render-preview.ts
 * 的 createPreview／PreviewController 型別定義。
 *
 * 掛載：檔尾 <script type="module">（deferred，執行時 DOM 已解析）；仍以
 * readyState 守衛使初始化嚴格於 DOMContentLoaded 後（PLAN 明訂）。
 */
// T4.2（(internal design doc) §D4）：主題模組於任何渲染前
// import——<head> 的 inline script 已在解析階段套用 data-theme（防 FOUC），
// 這裡只需接上 toggle 鈕的 wiring 與 aria-pressed 同步，故在檔案最上方、
// 其餘功能邏輯（含下方 init() 的實際渲染）之前完成。
import { initThemeSync, initThemeToggle } from '../../src/theme.js'
// T5.4（(internal design doc) §D5 A-3／A-4）：i18n
// DOM-facing 套用器——同上，於檔案最上方接上語言鈕 wiring；`applyI18n`／
// `currentLocale` 供下方 clone 點（buildSegmentRow／createColorPickerCore／
// buildThresholdEditor／createRowGroupContainer）與閾值模板名查表消費。
// T5.6（09-PLAN §D5 A-4 五步序）：`syncHtmlLang` 供語言切換五步序第 (4)
// 步（見 handleLocaleSwitch）；`initLangToggle` 第二參數（callback）新增。
import { applyI18n, currentLocale, initLangToggle, syncHtmlLang } from './i18n-dom.js'

import '../../src/style.css'
import './style.css'

import {
  ansi256SwatchName,
  ansi256ToHex,
  clampAnsi256Index,
  normalizeHex,
  type ColorSpec,
} from './color.js'
import {
  defaultConfig,
  deserializeConfig,
  normalizeRows,
  segmentColorPlaceholder,
  serializeConfig,
  type BuilderConfig,
  type SegmentColor,
  type SegmentConfig,
  type SeparatorConfig,
  type SeparatorPresetValue,
} from './config.js'
import {
  DESCRIPTORS_BY_ID,
  SEGMENT_CATALOG,
  SEGMENT_DESCRIPTORS,
  segmentLabel,
  type SegmentCategory,
  type SegmentDescriptor,
  type SegmentId,
} from './segments.js'
import {
  THRESHOLD_BUCKET_COUNT,
  THRESHOLD_TEMPLATES,
  type ThresholdBuckets,
  type ThresholdTemplateId,
} from './threshold.js'
import { validateCustomText, type CustomTextRejectReason } from './validate.js'
import { containsPua } from './resolve.js'
import { emitBash } from './emit-bash.js'
import { emitPs1 } from './emit-ps1.js'
import { emitSettings, type SettingsTarget } from './emit-settings.js'
import { createPreview, type PreviewController } from './render-preview.js'
import type { MockScenarioId } from './mock-data.js'
import {
  computeCrossRowMove,
  computeRowDeletion,
  computeRowGroups,
  computeRowSwap,
  formatMoveAnnouncement,
  resolveBlankAreaInsertIndex,
  resolveDropSide,
  rowGroupsEqual,
  type RowGroup,
  type RowSwapResult,
} from './row-groups.js'
import {
  clampReenableRow,
  computeRowSelectOptionOps,
  type RowSelectOption,
  type RowSelectOptionOp,
} from './row-select.js'
import {
  appendPendingSlot,
  planSegmentMove,
  realIndexOfSlot,
  reconcileRealSlots,
  removeSlotAt,
  slotIndexOfRealRow,
  slotsEqual,
  type DropTarget,
  type RowSlot,
} from './row-slots.js'
import { insertNullAtReal, padToLength, removeRealAt, type RowSeparator } from './row-separators.js'
import { planEnableIntoTarget } from './enable-into-target.js'
import { buildCatalogGroups } from './catalog.js'
// T3.2/T3.3（(internal design doc) §D2′；TASKS.md T3.2；
// 回饋 #5「目錄樣例值」）：目錄 compact 列樣例值合成＋per-locale 快取
// （見該檔檔頭）——本檔只機械消費 getSampleValue，不重複合成邏輯。
import { getSampleValue } from './sample-values.js'
// T3.5（14-PLAN §D5「拖曳教學」round-2 單一謂詞定稿；TASKS.md T3.5）：
// 教學帶 dismiss 狀態機——key／sentinel 常數與單一謂詞／dismiss 動作皆在
// tutorial-band.ts（單一出口，見該檔檔頭），本檔只消費、不重複定義。
import { dismissTutorialBand, shouldShowTutorialBand } from './tutorial-band.js'
// sprint 15 T3.1/T3.4（(internal design doc) §D8「行動版
// 目錄收合」；TASKS.md T3.4）：收合狀態機的「狀態讀寫與謂詞」純邏輯部分
// 皆在 catalog-collapse.ts（單一出口，該檔為 T3.1 產物，本檔只消費、不
// 重複定義、不改動——見其檔頭），本檔（T3.4）只負責 DOM 接線：init 時
// 決定初始 open 態＋移除回訪防閃動標記、<summary> click/keydown 持久化
// （機制 (a) summary-only）、跨斷點強制展開/恢復。
import {
  CATALOG_COLLAPSE_BREAKPOINT_QUERY,
  clearCatalogCollapsed,
  isCatalogCollapsed,
  setCatalogCollapsed,
} from './catalog-collapse.js'
import {
  computeSegmentFieldDefaults,
  isSegmentFieldAtDefault,
  type SegmentFieldDefaultDescriptor,
  type SegmentFieldDefaultInfo,
  type SegmentFieldKey,
} from './segment-defaults.js'
// T5.4：`thresholdTemplateLabel` 查表——取代原本地 THRESHOLD_TEMPLATE_LABELS
// 常數表（見其原定義處刪除註記），單一事實來源收斂至 messages.ts。
import { t, type Locale, type Messages } from './messages.js'

// T5.14（PLAN Rev 11「列耗盡保留＋暫存列位置制」）：統一移動入口
// commitSegmentMove 的落點型別＝`DropTarget`（見 row-slots.ts：`real`＝
// 落在既有真實列，`pending`＝落在某 UI 暫存空列）——跨列拖曳（li／gap／
// 容器空白處）與 select 指派共用同一型別，語意一致（見 commitSegmentMove）。
//
// MAGI code review I-3（(internal design doc)
// REVIEW.md，2026-07-12 使用者裁決「修」）：型別原宣告於本檔（T5.14
// TASKS.md「若想放共用處，放 main.ts 即可」之選項），因決策層
// `planSegmentMove`（row-slots.ts）需要此型別作參數，改移入 row-slots.ts
// 單一事實來源、本檔改 import type——擇一並記於此，不重複宣告。

// ── 常數／查表 ──

/** localStorage 鍵（BuilderConfig 序列化存放）——單一出口見 config-storage-key.ts。 */
import { STORAGE_KEY } from './config-storage-key.js'

/**
 * UTF-8 BOM（U+FEFF）：前置於 .ps1 內容 → Blob 編碼為 EF BB BF（PLAN 契約
 * 8）。**僅下載通道**（refreshOutputs 的下載 Blob 組裝處）前置此 BOM；
 * **複製到剪貼簿通道刻意不加**（見 wireOutputActions 的 copy-ps1 掛點）。
 *
 * T1.1（(internal design doc) 工作面 1，06a DRIFT C）曾一度讓
 * 兩通道對齊（複製亦前置 BOM），sprint 12 review 經協調者以 PS 5.1 真機
 * 探針證實回退：使用者依產出腳本自帶「請以 UTF-8（含 BOM）儲存」指引
 * 存檔時，若剪貼簿貼上內容已帶前置 U+FEFF，貼入編輯器存檔後會疊成
 * **雙 BOM**——PS 5.1 把第二個 U+FEFF 黏進首 token（如 `?#`／
 * `?Write-Output`，觸發 CommandNotFoundException），statusline 每次渲染
 * 噴錯（字串中段 U+FEFF 則無害）。2026-07-19 使用者裁決回退：複製通道
 * 不加 BOM，存檔編碼改由腳本頭既有指引引導，本 BOM 常數僅供下載 Blob 使用。
 */
const UTF8_BOM = String.fromCharCode(0xfeff)

/** 分區顯示順序＝目錄類別序（永在→百分比→條件→shell-out）；DOM order 亦此序。 */
const SECTION_ORDER: readonly SegmentCategory[] = ['always', 'percentage', 'conditional', 'shell-out']

/**
 * T5.5（(internal design doc) §D5 D5「全量文案遷移」）：
 * 原本檔三張硬編中文常數表——`VARIANT_LABELS`（variant 值→顯示名）、
 * `PREVIEW_MOCK_CLOCK_HINT_TEXT`（mock 時鐘常駐說明）、`REJECT_MESSAGES`
 * ／`PUA_REJECT_MESSAGE`（驗證拒收文案）——全數收進 messages.ts 字典
 * （`variantLabel`／`ui.mockClockHint`／`validation.fieldReject`），呼叫點
 * 改即時查 `t(currentLocale())`（見 `msg()` 助手）。mock 時鐘說明改走
 * index.html 的 `data-i18n="ui.mockClockHint"`（靜態、開機 applyI18n 套用），
 * 不再由 main.ts 寫入，故 `initPreviewMockClockHint` 一併移除。
 * `THRESHOLD_TEMPLATE_LABELS` 早於 T5.4 收斂為 `thresholdTemplateLabel`。
 */

/**
 * 色選態（對齊 ColorSpec.kind，T5.2 追加 'auto' 對齊 SegmentColor 第四態
 * ——僅 allowAuto=true 的 picker 實例可達此態，見 createColorPicker）。
 */
type ColorMode = 'default' | 'ansi256' | 'truecolor' | 'auto'

interface ColorPickerHandle {
  element: HTMLElement
  /** 程式化設值（初始化／閾值模板套用）；**不觸發 onChange**。 */
  setValue(spec: ColorSpec): void
  /**
   * T5.1（08-PLAN §5）：整組停用／恢復（`<fieldset disabled>`——原生語意
   * 連帶停用內部全部 radio／spinbutton／原生 color input，一行覆蓋三態
   * 全部子控件，無需逐一枚舉）。供 powerline 下 bar 段 fgOverride 停用
   * 使用（見 syncFgOverrideDisabled）；**不**觸發 onChange。
   */
  setDisabled(disabled: boolean): void
}

// ── 模組狀態 ──

let config: BuilderConfig
let preview: PreviewController
let draggingId: string | null = null
/**
 * T5.5 起：拖曳起手時的原容器＋原下一個手足節點。與 draggingId 同步生滅
 * （dragstart 設值、dragend／drop 完成後清空）。
 *
 * T5.10（PLAN Rev 5「跨列 drop＝實際移動」）：跨列 drop 已改為真正移動
 * （見 performCrossRowMove），本欄位不再用於「吸附回原位」——有效落點
 * （同列／跨列，皆有對應 drop handler）一律經 commitConfig 落地新排列，
 * 節點只在該路徑下才會被搬動。無效落點（如拖到左欄目錄／頁面其他未接線
 * 區域）因該處從未 `preventDefault()` dragover，瀏覽器不會觸發 `drop`
 * 事件、DOM 也從未被搬動（li 於整個拖曳期間只有 opacity 變化），故無需
 * 任何程式化復位；本欄位保留作為防禦性錨點（若未來新增更多 drop 目標時
 * 誤觸發非預期搬移，仍有原始位置可供追查／擴充復位邏輯）。
 */
let dragOrigin: { id: string; parent: HTMLElement | null; nextSibling: Element | null } | null = null
/**
 * T3.3（09-PLAN §D3 A-2「來源感知的視覺與清理」）：本次拖曳手勢的起手
 * 來源——`'row'`＝中欄已啟用段完整控件列（`li.segment-row`，既有
 * `wireDragAndDrop`）；`'catalog'`＝左欄目錄項（`li.catalog-item`，本
 * 任務新增第二個 dragstart 來源，見 `wireCatalogDragAndDrop`）。與
 * `draggingId` 同步生滅（dragstart 設值、`endDragCleanup` 歸零）。存在
 * 理由：兩種來源的 li 以相同 segment id 分別存放於 `rowElements`／
 * `catalogItemElements` 兩個不同 Map——`endDragCleanup` 復原 opacity 時
 * 須依本欄位分派查對的 Map，查錯 Map 會清錯節點（沿用中欄節點清錯，
 * 目錄項卡在半透明）。
 */
let dragSource: 'row' | 'catalog' | null = null
/**
 * T5.11（PLAN §排序與列指派 UX Rev 6「插入點挪空間視覺」）：dragover 期間
 * 顯示的 placeholder gap 節點——純 UI 態，絕不進 config、絕不承載任何段
 * 的狀態／監聽器（故整段搬移／重建皆安全，不違節點重用鐵律）。同一
 * 拖曳手勢全程只有一個實例（`ensureDropGap` 依目的容器型別〔`<ol>`→
 * `<li>`／其餘〔如暫存列 `<div>`〕→`<div>`〕惰性建立或重建），dragover
 * 期間隨指標位置以 `insertBefore` 在容器內搬移；drop／dragend 呼叫
 * `clearDropGap` 自 DOM 移除（見其文件）。
 */
let dropGapEl: HTMLElement | null = null
/**
 * dropGapEl 目前代表的落點（DropTarget，見其型別文件）——與 dropGapEl
 * 同步生滅（showDropGap 每次呼叫更新、clearDropGap 清空）。gap 自身的
 * drop handler（見 ensureDropGap）據此得知該提交到哪一列（真實列或暫存
 * 空列），因其為單一共用節點、可能於同一拖曳手勢中橫跨不同列容器（列
 * 群組 ↔ 暫存空列）移動，無法用建立時的閉包固定落點（對比
 * wireRowContainerDrop／wirePendingRowDrop 掛在恆定容器上、target 可安全
 * 閉包）。T5.14：由單一 `number`（列號）升級為 DropTarget（位置制下拖至
 * 中間暫存列須以 slotIndex 而非列號表達）。
 */
let dropGapTarget: DropTarget | null = null
/**
 * T5.6 驗收修復：`body.is-segment-dragging` 改為延遲一幀（`requestAnimationFrame`）
 * 才加上（見 wireDragAndDrop dragstart handler 文件其緣由），本欄位存放待執行
 * rAF 的 id，供 dragend 在極短拖曳時取消（避免 callback 晚於 dragend 才執行、
 * 把 class 永久殘留在 body 上）。與 draggingId 同步生滅（dragstart 設值、
 * dragend 執行或取消後清空為 null）。
 */
let dragClassRafId: number | null = null
let pickerCounter = 0
let thresholdCounter = 0

/**
 * T5.9：segment id → 其 `config.segments` 內既有 SegmentConfig 物件參照
 * （init() 建立一次，config.segments 陣列大小／物件身分終生不變——僅
 * 內部欄位被 mutate，見 buildSegmentRows／buildCatalogItems 皆從同一份
 * config.segments 取物件參照）。左欄目錄 checkbox 的 change handler
 * （setSegmentEnabled）據此查得目標段物件並直接 mutate `enabled`／
 * `row`，與既有色選/前綴等控件「直接 mutate 閉包捕捉的 seg 物件」慣例
 * 一致（見 T5.3 commitConfig 文件「正確性關鍵」段落：絕不整批替換
 * config.segments 或其元素物件，否則既有控件的閉包會寫壞孤兒物件）。
 */
let segmentConfigById: Map<string, SegmentConfig>

/**
 * T5.14（PLAN Rev 11「列耗盡保留＋暫存列位置制」，取代 T5.9 計數制
 * `pendingRowCount`）：中欄「列」的 UI 位置制 slots（純 DOM 態、不進
 * config——config 恆無空列）。每個元素為 `'real'`（承載真實渲染列，其第
 * k 個 real ↔ normalizeRows 後 config 第 k 個渲染列）或 `'pending'`（純
 * UI 暫存空列，可落在中間）。slot 的**位置**即顯示列序（「第 N 列」＝
 * slot index + 1）。各變異點（commitSegmentMove／setSegmentEnabled／
 * performRowDeletion／wirePendingRowButton／removePendingRow）顯式維護，
 * layoutSegmentContainers 以 reconcileRealSlots 作防禦收斂（見 row-slots.ts）。
 */
let rowSlots: RowSlot[] = []

/**
 * T5.14 追修（協調者 CDP 實證 S4「空列成真＋來源耗盡抵銷」，2026-07-12）：
 * 上次已同步至 DOM 的 rowSlots（純值快照，非同一參照）——與 `lastRowGroups`
 * 同性質的「已渲染基準」，commitConfig 據此以 slotsEqual 判斷 slots 是否
 * 實際變動（見 commitConfig 之重繪閘門文件：`rowGroupsEqual` 為真時 slots
 * 仍可能已變，如「指派入某空列」的 real+1 與「來源列同幀耗盡」的 real-1
 * 恰好抵銷、真實分組結構前後完全相同，僅靠 rowGroupsEqual 會漏重繪）。
 * layoutSegmentContainers 末端與 lastRowGroups 同點更新
 * （`lastRenderedSlots = rowSlots`）；不經 commitConfig 的兩條 slots 變異
 * 路徑（wirePendingRowButton／removePendingRow，直接重繪不經
 * layoutSegmentContainers）亦須各自同步更新，見其文件。初始為空陣列
 * （尚未同步過，同 lastRowGroups 慣例）。
 */
let lastRenderedSlots: RowSlot[] = []

/** segment id → 左欄目錄項 <li>（一次建置、永不重排——見 buildCatalogItems）。 */
const catalogItemElements = new Map<string, HTMLLIElement>()

/** segment id → 左欄目錄項的啟停 checkbox（唯一啟停入口，見 setSegmentEnabled）。 */
const catalogCheckboxElements = new Map<string, HTMLInputElement>()

/** segment id → 其列 <li>（重排以移動節點、保留內部接線與焦點，不重建）。 */
const rowElements = new Map<string, HTMLLIElement>()

/**
 * T5.4：segment id → 其「顯示於第 N 列」select（於 buildSegmentRow 建立
 * 一次，不隨列變動重建；refreshRowSelects 只原地更新既有 select 的
 * <option> 集合，見 row-select.ts）。T5.9：每段獨立「新增一列」按鈕
 * （原與 select 同放於此 map 的 value）已移除，map value 簡化為 select
 * 節點本身。
 */
const rowSelectElements = new Map<string, HTMLSelectElement>()

/**
 * T5.5：segment id → 其上/下移鈕（於 buildSegmentRow 建立一次，不隨列
 * 變動重建）。refreshMoveButtonStates 於分組/順序變動後（layoutSegment
 * Containers 內）依各列子序列位置同步兩鈕的 disabled 態（列首/列末停用、
 * 維持可見）。
 */
const moveButtonElements = new Map<string, { up: HTMLButtonElement; down: HTMLButtonElement }>()

/**
 * T2.5（(internal design doc) §D1-B′，S3/S4 選型定案）：
 * 上/下移鈕「收納／浮現」的輸入模態旗標——`'keyboard'`＝最近一次 document
 * 層輸入事件為鍵盤（keydown，見 wireMoveRevealModality）；`'mouse'`＝最近
 * 一次為滑鼠/指標（mousedown／pointerdown）。純 CSS `:has(:focus-visible)`
 * 經 S3 於 Chromium 實測有兩處滑鼠模態破口（select 滑鼠點擊即
 * focus-visible；列內 prefix 文字輸入任何 focus 皆 focus-visible）而棄用
 * ，改由本旗標於 focusin 時判定是否對該列切 `.row--reveal`（見
 * spikes/S3-RESULT.md D1 選型結論）。初始值 'keyboard'：開機尚未有任何
 * 輸入事件時不影響任何列（尚無 focusin），僅為型別預設。
 */
let inputModality: 'mouse' | 'keyboard' = 'keyboard'

/**
 * T5.1（08-PLAN §5）：segment id → 其前景覆寫色選 handle（於 buildSegmentRow
 * 建立一次，所有段皆有——見 index.html segment-row-template 契約 5.，
 * fg-mount 對全段存在、僅 CSS 依 mode 顯隱）。供 syncFgOverrideDisabled
 * 依 `mode==='powerline' && seg.bar===true` 整組停用／恢復（見其文件）。
 */
const fgPickerElements = new Map<string, ColorPickerHandle>()

/**
 * T5.1（08-PLAN §5）：segment id → 其閾值編輯器 handle（僅 category
 * ==='percentage' 之段建立，見 buildThresholdEditor）。供 setSegmentBar
 * 於 bar 切開且 `seg.threshold===undefined` 時呼叫 `applyTemplate` 寫入
 * 預設模板＋同步 templateSelect.value＋10 桶色選（見其文件）。
 */
const thresholdEditorElements = new Map<string, ThresholdEditorHandle>()

/**
 * T2.2（(internal design doc) §D2「預設值標示」）：
 * segment id → 其八欄位（SegmentFieldKey）「（預設：X）」提示 span（於
 * buildSegmentRow 建立，僅該段實際 applicable 的欄位有 entry——不適用
 * 欄位如非 variants 段的 variant、非百分比段的 threshold／bar，其鍵不
 * 存在於內層 record，比照 fgPickerElements 等既有 id→元素 map 慣例）。
 * 供 syncDefaultHintDims 逐段逐欄位同步「現值＝預設」淡化 class（PLAN
 * §D2 選項 C）。
 */
const defaultHintElements = new Map<string, Partial<Record<SegmentFieldKey, HTMLElement>>>()

/**
 * T5.1（08-PLAN §5）：目前因「powerline 模式＋該段 bar 開啟」而停用中的
 * fgOverride 色選段 id 集合（syncFgOverrideDisabled 維護）。僅用於偵測
 * 「本次呼叫新停用」（供播報一次性提示，避免同一狀態重複播報 live
 * region——SPEC「live region 不得 spam」不變量），非任何渲染依據。
 */
const fgOverrideDisabledIds = new Set<string>()

/**
 * T5.3：目前的列群組容器（索引＝渲染列序，0-index、恆連續——由
 * applyRowNormalization 於每次 commitConfig／init 時維持啟用段 row 值
 * 連續 0..N-1，見下）。growRowGroupContainers／shrinkRowGroupContainers
 * 依渲染列數增減維護此陣列與其 DOM（#segment-row-groups 底下的
 * .segment-row-group <section>）。容器一經建立，其在本陣列的索引（＝
 * 渲染列序）終生穩定（growRowGroupContainers 僅於末端新增、
 * shrinkRowGroupContainers 僅自末端移除）——`deleteTrigger`（T5.11：
 * 「刪除此列」鈕，見 wireRowDeleteButton）之 click handler 於建立時以
 * 該索引為閉包，故無需在容器存活期間重新綁定。
 */
const rowGroupContainers: {
  section: HTMLElement
  ol: HTMLOListElement
  deleteTrigger: HTMLButtonElement
  /**
   * T1.7（(internal design doc) §D1「UI」）：本列逐列
   * 分隔符控件（preset select＋custom 子欄），與 `deleteTrigger` 同構——
   * 建立時以容器索引（＝real index，見上方文件「容器一經建立…索引終生
   * 穩定」）為閉包，存活期間無需重新綁定。
   */
  separatorPresetEl: HTMLSelectElement
  separatorCustomFieldEl: HTMLElement
  separatorCustomEl: HTMLInputElement
}[] = []

/**
 * 上次已同步至 DOM 的分組結果（純函式 computeRowGroups 輸出）；commitConfig
 * 據此與最新分組結果比較（rowGroupsEqual），僅於「分組實際變動」時才重跑
 * 列群組容器生命週期／跨容器搬移（PLAN §D2 正規化接線 Rev 2 釘死：與 row
 * 無關的 commit 不得觸發全體刷新）。初始為空陣列（尚未同步過）。
 */
let lastRowGroups: RowGroup[] = []

/** 最新三產物字串（複製鈕來源）。 */
const lastOutputs = { bash: '', ps1: '', settings: '' }

/** 三下載鈕的既有 Blob URL（換發前撤銷，避免洩漏）。 */
const downloadState: Record<'bash' | 'ps1' | 'settings', string | null> = {
  bash: null,
  ps1: null,
  settings: null,
}

// ── DOM 取得工具 ──

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`缺少必要節點 #${id}`)
  return el as T
}

function queryOne<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (el === null) throw new Error(`缺少必要節點 ${selector}`)
  return el
}

function outputCode(preId: string): HTMLElement {
  const code = byId(preId).querySelector('code')
  if (code === null) throw new Error(`#${preId} 缺少 <code>`)
  return code
}

function contextSpan(scope: Element): HTMLElement {
  const span = scope.querySelector<HTMLElement>('.control-name-context')
  if (span === null) throw new Error('缺少 .control-name-context')
  return span
}

/**
 * T2.2（09-PLAN §D2「預設值標示」選項 A）：欄位「（預設：X）」提示——
 * 純視覺（`aria-hidden`，不入 accessible name），追加為 `container` 的
 * 最後一個子節點。`container` 依欄位結構而異：row／icon／prefix／
 * variant／bar 五欄傳其 `<label>`（緊接既有可見文字後）；color／
 * fgOverride 兩欄傳其 mount div（該欄位無獨立可見 label，legend 本身即
 * 承載 accessible name，見 createColorPickerCore／.color-picker__legend，
 * 提示故置於 fieldset 外層 mount，不擾動 legend 內容）；threshold 傳其
 * disclosure `.threshold__toggle` 鈕（緊接「閾值變色設定」文字後）。
 * a11y 取捨（各欄位 container 選型理由）已詳述於上；buildSegmentRow 為
 * 實際呼叫處。回傳建立的
 * span，供呼叫端存進 `defaultHintElements`（syncDefaultHintDims 之後據
 * 此同步「現值＝預設」淡化 class，PLAN 選項 C）。
 */
/**
 * T5.6（09-PLAN §D5 D5 收口；default-hint 結構化改造，收 T5.5-report
 * 「混語形」已知限制）：segment-defaults.ts 回傳的結構化描述子 → 目前
 * 語言的可讀字串——render 層以 `t(currentLocale())` 解讀（segment-
 * defaults.ts 本身零 messages.ts import，維持純描述子模組定位，見其檔頭）。
 * 多數 kind 直接複用既有域，避免與 `messages.defaultDescriptor` 重複：
 * `firstRow`→`rowGroup.heading(1)`（與列群組標題同一份「第 N 列」字面，
 * 單一事實來源）、`variant`→`variantLabel[value]`（缺表退原值，同
 * messages.ts `VARIANT_LABELS_ZH`/`VARIANT_LABELS_EN` 缺表慣例——原
 * main.ts 本地版本已隨此改造移除，見 segment-defaults.ts 檔頭）、
 * `colorDefault`/`colorAuto`→
 * `colorPicker.modeDefault`/`modeAuto`。`literalPrefix`／`colorLiteral`
 * 為使用者可見原值本身（前綴字面／ansi256 swatch 名或 hex），locale-
 * invariant，兩語言原樣顯示。窮盡 switch，無 default 分支（TS 覆蓋新增
 * kind 時強制此處補齊）。
 */
function defaultDescriptorLabel(descriptor: SegmentFieldDefaultDescriptor): string {
  const m = msg()
  switch (descriptor.kind) {
    case 'firstRow':
      return m.rowGroup.heading(1)
    case 'iconState':
      return descriptor.on ? m.defaultDescriptor.iconOn : m.defaultDescriptor.iconOff
    case 'emptyPrefix':
      return m.defaultDescriptor.emptyPrefix
    case 'literalPrefix':
      return descriptor.value
    case 'variant':
      return m.variantLabel[descriptor.value] ?? descriptor.value
    case 'colorDefault':
      return m.colorPicker.modeDefault
    case 'colorAuto':
      return m.colorPicker.modeAuto
    case 'colorLiteral':
      return descriptor.value
    case 'noFgOverride':
      return m.defaultDescriptor.noFgOverride
    case 'noThreshold':
      return m.defaultDescriptor.noThreshold
    case 'barState':
      return descriptor.on ? m.defaultDescriptor.barOn : m.defaultDescriptor.barOff
  }
}

function appendDefaultHint(container: Element, info: SegmentFieldDefaultInfo): HTMLElement {
  const hint = document.createElement('span')
  hint.className = 'segment-row__default-hint'
  hint.setAttribute('aria-hidden', 'true')
  hint.textContent = msg().defaultHint(info.descriptor === null ? '' : defaultDescriptorLabel(info.descriptor))
  container.appendChild(hint)
  return hint
}

/**
 * 顯隱切換：只切 `hidden` 屬性（同時移除 a11y tree ＋視覺隱藏）。src/style.css
 * reset 的 `[hidden]{display:none!important}` 已根治「作者 display:flex／
 * inline-block 蓋過 UA `[hidden]{display:none}`」的舊坑（CR3 裁定根治），故不再
 * 需 inline display workaround；一併消除 #separator-custom-field 的 pre-JS 閃現與
 * threshold panel 初始態的僥倖依賴（元素初始帶 hidden 即由 reset 規則收合）。
 */
function setHidden(el: HTMLElement, hidden: boolean): void {
  el.hidden = hidden
}

// ── 固定節點（index.html 靜態骨架既有節點，非 <template> 生成；main.ts 直接 query） ──

const errorMessageEl = byId('error-message')
const globalLiveStatusEl = byId('global-live-status')
const modePlainEl = byId<HTMLInputElement>('mode-plain')
const modePowerlineEl = byId<HTMLInputElement>('mode-powerline')
const separatorPresetEl = byId<HTMLSelectElement>('separator-preset')
const separatorCustomFieldEl = byId('separator-custom-field')
const separatorCustomEl = byId<HTMLInputElement>('separator-custom')
const powerlineArrowEl = byId<HTMLInputElement>('powerline-arrow')
const lastArrowCapEl = byId<HTMLInputElement>('last-arrow-cap')
const powerlineNoBoundaryHintEl = byId('powerline-no-boundary-hint')
const settingsPathEl = byId<HTMLInputElement>('settings-path')
const segmentMoveStatusEl = byId('segment-move-status')
const previewBgDarkEl = byId<HTMLInputElement>('preview-bg-dark')
const previewBgLightEl = byId<HTMLInputElement>('preview-bg-light')
const previewTerminalEl = byId('preview-terminal')
// sprint 15 T2.3（PLAN §D6）：預覽頂帶根節點——`--band-h` 的量測對象
// （ResizeObserver 觀測標的），見下方 syncBandHeight／wireBandHeightObserver。
const previewBandEl = byId('preview-section')
// T5.5：頂帶預覽區常駐 mock 時鐘說明改由 index.html 的
// `data-i18n="ui.mockClockHint"` 承載（開機 applyI18n 套用，切換自動翻轉），
// 不再由 main.ts 寫入 textContent，故原 previewMockClockHintEl 節點取得與
// initPreviewMockClockHint() 一併移除。
const outputStatusEl = byId('output-status')
// T4.2：產出腳本收斂為單一按鈕開啟的 <dialog>（見 index.html 該節點
// 註解）——開鈕／dialog 本體／顯式「關閉」鈕三個掛點。
const outputDialogEl = byId<HTMLDialogElement>('output-dialog')
const outputDialogOpenEl = byId<HTMLButtonElement>('output-dialog-open')
const outputDialogCloseEl = byId<HTMLButtonElement>('output-dialog-close')
// T4.3：skip-nav「跳至產出腳本」錨點（見 index.html 該節點註解）——原
// `href="#output-section"` 隨 T4.2 dialog 化消失，click 改由
// wireSkipToOutput() 攔截，聚焦此鈕本身而非開啟 dialog。
const skipToOutputEl = queryOne<HTMLAnchorElement>('[data-testid="skip-to-output"]')
const copyBashEl = byId<HTMLButtonElement>('copy-bash')
const copyPs1El = byId<HTMLButtonElement>('copy-ps1')
const copySettingsEl = byId<HTMLButtonElement>('copy-settings')
const downloadBashEl = byId<HTMLAnchorElement>('download-bash')
const downloadPs1El = byId<HTMLAnchorElement>('download-ps1')
const downloadSettingsEl = byId<HTMLAnchorElement>('download-settings')
const outputBashCodeEl = outputCode('output-bash')
const outputPs1CodeEl = outputCode('output-ps1')
const outputSettingsCodeEl = outputCode('output-settings')
// T5.3：啟用段依渲染列分組的容器掛載點（雙區清單之「啟用區」；列群組
// <section> 由 main.ts 動態生成/銷毀於此節點下，見 index.html 註解）。
const segmentRowGroupsEl = byId('segment-row-groups')
// T5.14：UI 暫存空列不再有獨立容器（#segment-pending-rows 已移除）——
// 位置制下暫存列 <div> 依 slots 位置插進 #segment-row-groups 內（可落在
// 真實列之間），見 renderPendingRowContainers。
// T5.9：中欄頂部單一「新增一列」按鈕（取代 T5.4 每段獨立按鈕）。
const addPendingRowEl = byId<HTMLButtonElement>('add-pending-row')
// T5.9：停用段完整控件列的隱藏池（display:none，不銷毀；見其自身註解）。
const segmentHiddenPoolEl = byId('segment-hidden-pool')
// T3.5：教學帶（T2.6 已落地結構，見 index.html 該節點註解）容器＋「知道
// 了」dismiss 鈕掛點——wireTutorialBand() 據此接線狀態機。
const tutorialBandEl = byId('tutorial-band-slot')
const tutorialDismissEl = byId<HTMLButtonElement>('tutorial-dismiss')
// sprint 15 T3.3/T3.4：行動版目錄收合結構（T3.3 已落地，見 index.html
// #catalog-collapse-details 節點自身註解）——wireCatalogCollapse() 據此
// 接線狀態機。<summary> 無專屬型別（HTML 規格未定義獨立
// HTMLSummaryElement 介面），沿用 HTMLElement。
const catalogCollapseDetailsEl = byId<HTMLDetailsElement>('catalog-collapse-details')
const catalogCollapseSummaryEl = byId<HTMLElement>('catalog-collapse-summary')

// 主題切換鈕 wiring：模組層級立即執行，早於下方 init()（無論 init() 是同步
// 立即跑或掛在 DOMContentLoaded，這行都先執行——見上方 import 註解）。
initThemeToggle(queryOne<HTMLButtonElement>('.theme-toggle'))
// (internal design doc) 里程碑 2：OS 偏好變更／其他分頁 storage 事件即時同步 toggle 鈕。
initThemeSync(queryOne<HTMLButtonElement>('.theme-toggle'))

// T5.4（09-PLAN §D5 A-4）：語言啟動同步——依已持久化的語言（預設
// DEFAULT_LOCALE＝zh-Hant）同步 <html lang> 並對整份主文件樹套用一次
// applyI18n（此刻僅 header 語言鈕本身掛 data-i18n；zh-Hant 為 no-op，
// 因靜態 HTML 字面本就對齊 zh-Hant 字典之值）。語言鈕 wiring（click →
// 取反→setLocale→重跑 applyI18n）委由 initLangToggle 封裝，比照上一行
// initThemeToggle 慣例於模組層級立即執行。
const bootLocale = currentLocale()
syncHtmlLang(bootLocale)
applyI18n(document, bootLocale)
// T5.6（09-PLAN §D5 A-4 五步序）：`handleLocaleSwitch`（定義於下方「語言
// 切換」節，函式宣告故此處提前參照有效）接續 initLangToggle 完成第 (1)
// 步後的第 (2)-(5) 步；本檔依賴方向不變（handleLocaleSwitch 定義於
// main.ts 內，i18n-dom.ts 僅收 callback 型別，不 import main.ts）。
initLangToggle(queryOne<HTMLButtonElement>('.lang-toggle'), handleLocaleSwitch)

const SEGMENT_LIST_BY_CATEGORY: Record<SegmentCategory, HTMLOListElement> = {
  always: byId<HTMLOListElement>('segment-list-always'),
  percentage: byId<HTMLOListElement>('segment-list-percentage'),
  conditional: byId<HTMLOListElement>('segment-list-conditional'),
  'shell-out': byId<HTMLOListElement>('segment-list-shellout'),
}

// ── <template> 實例化（token 取代；機制見下方 instantiateTemplate 文件） ──

/**
 * clone 指定 <template> 並把其中所有 token（`__ID__`／`__PID__`／`__TID__`，
 * 只出現於屬性值、不出現於可見文字）替換為唯一 key，回傳根元素。
 */
function instantiateTemplate(templateId: string, token: string, key: string): HTMLElement {
  const template = byId<HTMLTemplateElement>(templateId)
  const wrapper = document.createElement('template')
  wrapper.innerHTML = template.innerHTML.replaceAll(token, key)
  const root = wrapper.content.firstElementChild
  if (root === null) throw new Error(`template #${templateId} 無根元素`)
  return root as HTMLElement
}

// ── 訊息／播報 ──

/**
 * T5.5：目前語言的訊息字典（即時求值）——播報／組句／aria-label 一律經此
 * 取值，故新產生的文字自然跟隨呼叫當下的 `currentLocale()`（先前已寫入
 * DOM 的舊語言文字之追溯翻轉屬 T5.6 五步序）。
 */
function msg(): Messages {
  return t(currentLocale())
}

/** T5.5：目前語言的段 label（取代直讀 `descriptor.label`／`DESCRIPTORS_BY_ID[id].label`）。 */
function segLabel(id: SegmentId): string {
  return segmentLabel(id, currentLocale())
}

function showError(message: string): void {
  errorMessageEl.classList.remove('is-empty')
  errorMessageEl.textContent = message
}

function clearError(): void {
  errorMessageEl.classList.add('is-empty')
  errorMessageEl.textContent = ''
}

/** 全域提醒（mode 切換顏色語意翻轉、閾值模板批次套用）。 */
function announceGlobal(text: string): void {
  globalLiveStatusEl.textContent = text
}

/** segment 排序後位置回饋（與全域提醒分流，避免頻繁移位淹沒重要提醒）。 */
function announceMove(text: string): void {
  segmentMoveStatusEl.textContent = text
}

/**
 * T3.4（09-PLAN §D3 A-3「播報語意」）：落列播報的 origin 感知組句——
 * `'move'` 沿用既有 `formatMoveAnnouncement`（row-groups.ts「移至」模板，
 * 本 sprint 該檔禁改）；`'catalog-add'` 為本任務新增的「已加入」模板。
 * 集中於此供**兩個**呼叫點共用同一份文案常數（G5 i18n 抽離時的單一
 * 落點；M5 前僅集中常數，非完整 i18n，故仍是硬編中文字面）：
 * 1. `performCrossRowMove`（經其 origin 參數）——目錄拖入停用段
 *    （`commitEnableIntoTarget`）傳 `'catalog-add'`；其餘既有呼叫點
 *    （中欄拖曳／select 指派／已啟用目錄項拖入）沿用預設 `'move'`，
 *    行為零變。
 * 2. `setSegmentEnabled` 啟用分支（checkbox 勾選，非拖曳、無
 *    `performCrossRowMove` 可套，故此處直接呼叫）——checkbox 勾選語意
 *    同為「把段加入某列」，與目錄拖入啟用一致，故亦用「已加入」模板。
 *
 * 顯示編號定案（PLAN「所有落列播報一律採視覺顯示編號」）由呼叫端負責
 * ——`info.row` 須已由呼叫端以 `slotIndexOfRealRow` 映射，本函式僅組句
 * ／播報，不做任何 row 值轉換。
 */
function announceSegmentLanded(
  origin: 'move' | 'catalog-add',
  label: string,
  info: Pick<RowSwapResult, 'row' | 'position' | 'rowSize'>,
): void {
  announceMove(
    origin === 'catalog-add'
      ? msg().announce.catalogAdd(label, info.row, info.position, info.rowSize)
      : formatMoveAnnouncement(label, info, currentLocale()),
  )
}

/** 複製／下載成功回饋。 */
function announceOutput(text: string): void {
  outputStatusEl.classList.remove('is-empty')
  outputStatusEl.textContent = text
}

// ── 輸入驗證（validate.ts 拒收集 R，含 PUA 單一咽喉） ──

function validateUserText(value: string): { ok: true } | { ok: false; reason: CustomTextRejectReason } {
  const result = validateCustomText(value)
  // T5.5：回傳機器可判 `reason`（非成品文案）——呼叫端以
  // `msg().validation.fieldReject(field, reason)` 組出「欄位名＋原因」的當下
  // 語言訊息（欄位名前綴由呼叫端傳入，見各 showError 呼叫點）。
  if (!result.ok) return { ok: false, reason: result.reason }
  // PUA 已併入 validateCustomText（reason 'pua'）為主防線——config 清洗與此
  // UI 驗證單一咽喉共擋。resolve.containsPua 於此保留為第二道（防未來 validate
  // 回歸；命中回同一 pua reason），正常情況下 value 已無 PUA、此支不觸發。
  if (containsPua(value)) return { ok: false, reason: 'pua' }
  return { ok: true }
}

// ── 色選元件（SP-6 pattern B：16 swatch＋0–255 spinbutton＋原生 color） ──

function specToMode(spec: ColorSpec | SegmentColor): ColorMode {
  if (spec.kind === 'auto') return 'auto'
  return spec.kind === 'default' ? 'default' : spec.kind === 'ansi256' ? 'ansi256' : 'truecolor'
}

/** createColorPickerCore 內部統一 onChange 型別（涵蓋三態封閉與 auto 第四態兩種呼叫端）。 */
type ColorPickerOnChange = (spec: ColorSpec | SegmentColor) => void

/**
 * 色選實例核心建構（clone #color-picker-template）。nameContext＝群組可及
 * 名稱（legend），initial＝起始色，onChange＝使用者實際變更時回呼（程式化
 * setValue 不回呼），allowAuto＝是否保留「自動配色」第四態（見下方兩個
 * 公開包裝函式）。
 *
 * T5.2（08-PLAN §5「auto 配色選項（model／effort 段限定 UI）」）：模板內
 * 第四顆 `.color-picker__mode-auto-field` radio 恆存在於 DOM（見
 * index.html color-picker-template），`allowAuto` 為假時本函式**移除**
 * 該節點（比照 variantField／barField 之「非合格整組移除」既有慣例）——
 * 故 `modeRadios` 查詢結果與 UI 呈現天然一致，非合格段的 UI 完全不出現
 * 「自動」選項。
 *
 * 不直接對外開放本函式：本函式 `onChange` 參數型別統一收最寬的
 * `ColorPickerOnChange`（`ColorSpec | SegmentColor` 聯集，因 `allowAuto`
 * 為執行期布林值，TS 無法據其字面值窄化 `currentSpec()` 的靜態回傳型
 * 別）。改由下方 `createColorPicker`／`createSegmentColorPicker` 兩個
 * 各自窄化簽章的包裝函式對外開放——「三態封閉」與「auto 第四態」兩種呼叫
 * 端各自收到型別系統保證正確的 onChange 參數型別，`allowAuto` 引數則由
 * 包裝函式本身的呼叫固定寫死（非使用者可誤傳的獨立引數），兩者天然同步
 * 不會契約失準。
 */
function createColorPickerCore(
  nameContext: string,
  initial: ColorSpec | SegmentColor,
  onChange: ColorPickerOnChange,
  allowAuto: boolean,
): ColorPickerHandle {
  const pid = `sb-pick-${(pickerCounter += 1)}`
  const root = instantiateTemplate('color-picker-template', '__PID__', pid)
  // T5.4（09-PLAN §D5 A-3 clone 時序）：clone 後立即對子樹套用目前語言
  // （本模板目前僅 ANSI 索引 label／索引加減鈕 aria-label 掛 data-i18n，
  // 其餘靜態文案留 T5.5）。
  applyI18n(root, currentLocale())

  contextSpan(root.querySelector('.color-picker__legend')!).textContent = nameContext
  // T5.2：非 auto 合格 picker——整組移除「自動」radio 節點，下方 modeRadios
  // 查詢結果天然不含它，UI 完全不出現此態。
  if (!allowAuto) root.querySelector('.color-picker__mode-auto-field')?.remove()

  const modeRadios = Array.from(root.querySelectorAll<HTMLInputElement>('.color-picker__mode'))
  const ansiPanel = root.querySelector<HTMLElement>('[data-mode-panel="ansi256"]')!
  const truePanel = root.querySelector<HTMLElement>('[data-mode-panel="truecolor"]')!
  const swatchContainer = root.querySelector<HTMLElement>('[data-swatch-container]')!
  const spinControl = root.querySelector<HTMLElement>('.color-spinbutton__control')!
  const spinValue = root.querySelector<HTMLElement>('.color-spinbutton__value')!
  const decBtn = root.querySelector<HTMLButtonElement>('.color-spinbutton__dec')!
  const incBtn = root.querySelector<HTMLButtonElement>('.color-spinbutton__inc')!
  const previewChip = root.querySelector<HTMLElement>('.color-swatch--preview')!
  const nativeInput = root.querySelector<HTMLInputElement>('.color-picker__native')!

  let mode: ColorMode = 'default'
  let ansiIndex = 0
  let hex = '#000000'

  // 16 基本色 swatch（radio；accessible name＝ansi256SwatchName，chip 裝飾）。
  const swatchInputs: HTMLInputElement[] = []
  for (let i = 0; i < 16; i++) {
    const label = document.createElement('label')
    label.className = 'color-swatch'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = `${pid}-swatch`
    input.value = String(i)
    input.setAttribute('aria-label', ansi256SwatchName(i))
    const chip = document.createElement('span')
    chip.className = 'color-swatch__chip'
    chip.setAttribute('aria-hidden', 'true')
    chip.style.backgroundColor = ansi256ToHex(i)
    label.append(input, chip)
    input.addEventListener('change', () => {
      if (!input.checked) return
      setAnsiIndex(i)
      report()
    })
    swatchContainer.appendChild(label)
    swatchInputs.push(input)
  }

  function syncSwatchChecked(): void {
    for (let i = 0; i < swatchInputs.length; i++) {
      swatchInputs[i].checked = mode === 'ansi256' && ansiIndex === i
    }
  }

  function updateAnsiUi(): void {
    spinControl.setAttribute('aria-valuenow', String(ansiIndex))
    spinControl.setAttribute('aria-valuetext', ansi256SwatchName(ansiIndex))
    spinValue.textContent = String(ansiIndex)
    previewChip.style.backgroundColor = ansi256ToHex(ansiIndex)
    syncSwatchChecked()
  }

  function setAnsiIndex(next: number): void {
    ansiIndex = clampAnsi256Index(next)
    updateAnsiUi()
  }

  function currentSpec(): ColorSpec | SegmentColor {
    if (mode === 'auto') return { kind: 'auto' }
    if (mode === 'ansi256') return { kind: 'ansi256', index: ansiIndex }
    if (mode === 'truecolor') return { kind: 'truecolor', hex }
    return { kind: 'default' }
  }

  function report(): void {
    onChange(currentSpec())
  }

  function applyMode(next: ColorMode): void {
    mode = next
    setHidden(ansiPanel, mode !== 'ansi256')
    setHidden(truePanel, mode !== 'truecolor')
    for (const radio of modeRadios) radio.checked = radio.value === mode
    syncSwatchChecked()
  }

  for (const radio of modeRadios) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return
      applyMode(radio.value as ColorMode)
      report()
    })
  }

  // spinbutton：↑/↓（±1）、PageUp/Down（±16）、Home/End（0/255）、數字直入。
  let typeBuffer = ''
  let typeTimer: number | undefined
  spinControl.addEventListener('keydown', (event) => {
    let handled = true
    if (event.key === 'ArrowUp') setAnsiIndex(ansiIndex + 1)
    else if (event.key === 'ArrowDown') setAnsiIndex(ansiIndex - 1)
    else if (event.key === 'PageUp') setAnsiIndex(ansiIndex + 16)
    else if (event.key === 'PageDown') setAnsiIndex(ansiIndex - 16)
    else if (event.key === 'Home') setAnsiIndex(0)
    else if (event.key === 'End') setAnsiIndex(255)
    else if (/^[0-9]$/.test(event.key)) {
      typeBuffer += event.key
      setAnsiIndex(Number.parseInt(typeBuffer, 10))
      window.clearTimeout(typeTimer)
      typeTimer = window.setTimeout(() => {
        typeBuffer = ''
      }, 900)
    } else {
      handled = false
    }
    if (handled) {
      event.preventDefault()
      report()
    }
  })

  decBtn.addEventListener('click', () => {
    setAnsiIndex(ansiIndex - 1)
    report()
  })
  incBtn.addEventListener('click', () => {
    setAnsiIndex(ansiIndex + 1)
    report()
  })

  nativeInput.addEventListener('input', () => {
    hex = normalizeHex(nativeInput.value) ?? '#000000'
    report()
  })

  function setValue(spec: ColorSpec | SegmentColor): void {
    if (spec.kind === 'ansi256') ansiIndex = clampAnsi256Index(spec.index)
    if (spec.kind === 'truecolor') {
      hex = spec.hex
      nativeInput.value = spec.hex
    }
    applyMode(specToMode(spec))
    updateAnsiUi()
  }

  function setDisabled(disabled: boolean): void {
    ;(root as HTMLFieldSetElement).disabled = disabled
  }

  setValue(initial)

  return { element: root, setValue, setDisabled }
}

/**
 * 三態封閉版本（fgOverride／閾值桶色選使用）：`allowAuto` 恆假、模板第四
 * 態「自動配色」radio 恆移除——onChange 型別鎖 `ColorSpec`，滿足「fgOverride
 * picker 不得出現 auto 態」（T5.2）。
 */
function createColorPicker(
  nameContext: string,
  initial: ColorSpec,
  onChange: (spec: ColorSpec) => void,
): ColorPickerHandle {
  return createColorPickerCore(nameContext, initial, onChange as ColorPickerOnChange, false)
}

/**
 * T5.2（08-PLAN §5「auto 配色選項（model／effort 段限定 UI）」）：auto 第
 * 四態開放版本——僅 `SEGMENT_CATALOG.autoEligibleIds` 成員段的主色 picker
 * 呼叫（見 buildSegmentRow）。`allowAuto` 恆真、模板第四態「自動配色」
 * radio 保留；onChange 型別為 `SegmentColor`（多 `{kind:'auto'}`）。
 */
function createSegmentColorPicker(
  nameContext: string,
  initial: SegmentColor,
  onChange: (spec: SegmentColor) => void,
): ColorPickerHandle {
  return createColorPickerCore(nameContext, initial, onChange as ColorPickerOnChange, true)
}

// ── 閾值編輯器（disclosure；10 桶各一色選；模板批次套用） ──

interface ThresholdEditorHandle {
  /**
   * T5.1（08-PLAN §5）：材料化 `seg.threshold` 為指定模板的 10 桶＋同步
   * 10 桶色選＋`templateSelect.value` 設為該模板 id（避免面板顯示「（自
   * 訂）」與心智模型脫節）。供 setSegmentBar 於 bar 切開且
   * `seg.threshold===undefined` 時呼叫——**不** commitConfig、**不**
   * announce（呼叫端統一處理，與 templateSelect 自身 change handler 的
   * 播報文字故意不同，見 setSegmentBar 文件）。
   */
  applyTemplate(templateId: ThresholdTemplateId): void
}

function buildThresholdEditor(
  mount: HTMLElement,
  seg: SegmentConfig,
  descriptor: SegmentDescriptor,
): ThresholdEditorHandle {
  const tid = `sb-th-${(thresholdCounter += 1)}`
  const root = instantiateTemplate('threshold-editor-template', '__TID__', tid)
  // T5.4（09-PLAN §D5 A-3 clone 時序）：clone 後立即套用目前語言——本模板
  // 6 個模板 `<option>` 掛 data-i18n（見 index.html），此處翻正確語言後
  // 下方 templateSelect.value 設值等既有邏輯不受影響（依 value 非
  // textContent 判斷）。
  applyI18n(root, currentLocale())

  const toggle = root.querySelector<HTMLButtonElement>('.threshold__toggle')!
  const panel = root.querySelector<HTMLElement>('.threshold__panel')!
  const templateSelect = root.querySelector<HTMLSelectElement>('.threshold__template')!
  const bucketContainer = root.querySelector<HTMLElement>('[data-bucket-container]')!

  contextSpan(toggle).textContent = msg().segmentControl.thresholdContext(segLabel(descriptor.id))
  contextSpan(templateSelect.closest('.threshold__template-field')!).textContent =
    msg().segmentControl.thresholdContext(segLabel(descriptor.id))

  // disclosure：展開才進 tab 序；播報＋展開時焦點移入面板首控件。
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-expanded') !== 'true'
    toggle.setAttribute('aria-expanded', String(next))
    setHidden(panel, !next)
    announceGlobal(msg().announce.thresholdToggle(segLabel(descriptor.id), next))
    if (next) templateSelect.focus()
  })

  // 10 桶色選（0–9%…90–100%；legend 承載「<段名> 閾值 <範圍>」＝控件命名）。
  const bucketHandles: ColorPickerHandle[] = []
  for (let i = 0; i < THRESHOLD_BUCKET_COUNT; i++) {
    const low = i * 10
    const high = i === THRESHOLD_BUCKET_COUNT - 1 ? 100 : i * 10 + 9
    const range = `${low}–${high}%`
    const initial = seg.threshold?.buckets[i] ?? { kind: 'default' }
    const handle = createColorPicker(msg().segmentControl.thresholdBucketName(segLabel(descriptor.id), range), initial, (spec) => {
      // 逐桶手改 → 材料化 threshold（若尚無）並回填；模板標記回「（自訂）」。
      updateBucket(seg, i, spec)
      templateSelect.value = ''
    })
    bucketContainer.appendChild(handle.element)
    bucketHandles.push(handle)
  }

  // T5.1：材料化 buckets（模板套用 change handler 與 setSegmentBar 共用）。
  function applyTemplate(templateId: ThresholdTemplateId): void {
    const template = THRESHOLD_TEMPLATES[templateId]
    const buckets = [...template.buckets] as ColorSpec[]
    seg.threshold = { buckets: buckets as unknown as ThresholdBuckets }
    for (let i = 0; i < THRESHOLD_BUCKET_COUNT; i++) bucketHandles[i].setValue(buckets[i])
    templateSelect.value = templateId
  }

  // 模板套用＝批次寫 10 桶＋更新 10 色選＋常駐 live region 播報。
  templateSelect.addEventListener('change', () => {
    const value = templateSelect.value
    if (value === '') return // 「（自訂）」為狀態標記、非動作。
    applyTemplate(value as ThresholdTemplateId)
    const label = templateSelect.options[templateSelect.selectedIndex]?.textContent ?? value
    announceGlobal(msg().announce.thresholdApplied(label))
    commitConfig()
  })

  mount.appendChild(root)
  return { applyTemplate }
}

/** 逐桶寫入（材料化 threshold 為恰 10 桶不可變 tuple）。 */
function updateBucket(seg: SegmentConfig, index: number, spec: ColorSpec): void {
  const buckets: ColorSpec[] = seg.threshold
    ? [...seg.threshold.buckets]
    : Array.from({ length: THRESHOLD_BUCKET_COUNT }, () => ({ kind: 'default' }) as ColorSpec)
  buckets[index] = spec
  seg.threshold = { buckets: buckets as unknown as ThresholdBuckets }
  commitConfig()
}

// ── segment 目錄（左欄，輕量常駐項；T5.9） ──

/**
 * 建立單一左欄目錄項（clone #catalog-item-template）。checkbox 為唯一
 * 啟停入口：change → setSegmentEnabled（mutate config、切換本項灰化態＋
 * 中欄完整控件列的容器歸屬）。本函式只建立節點與接線，不設初始
 * checked／灰化態——由呼叫端 buildCatalogItems 依 catalog.ts 之
 * buildCatalogGroups 計算結果統一設定（單一事實來源，避免兩處各自
 * 判斷 enabled 而漂移）。
 *
 * T3.3（09-PLAN §D3 A-1／A-2）：目錄項本身終生不重排（見 buildCatalogItems
 * 文件），但現可拖曳入中欄目標列——`wireCatalogDragAndDrop` 接線
 * dragstart／dragend（checkbox 命中區豁免），落點側沿用中欄既有 drop
 * handler（皆只依賴模組層級 draggingId，不分辨來源），無需另接。
 *
 * T3.3（(internal design doc) §D2′；TASKS.md T3.3，回饋
 * #5「目錄樣例值」）：`.catalog-item__hint` 樣例值文字亦於本函式一次性
 * 寫入（`getSampleValue(id, currentLocale())`，一律 **textContent**——
 * 禁走 `instantiateTemplate` 的 innerHTML token 通道，見 index.html
 * catalog-item-template 註解第 6 點）。顯隱態（未啟用顯示／已啟用
 * hidden）由呼叫端 `buildCatalogItems` 與 `setSegmentEnabled` 的
 * `syncSegmentEnabledUi` 統一設定，本函式僅寫文字、不碰 hidden。
 */
function buildCatalogItem(id: string, label: string): HTMLLIElement {
  const li = instantiateTemplate('catalog-item-template', '__CID__', id) as HTMLLIElement
  li.dataset.segmentId = id
  const checkbox = li.querySelector<HTMLInputElement>('.catalog-item__checkbox')!
  li.querySelector<HTMLElement>('.catalog-item__name')!.textContent = label
  li.querySelector<HTMLElement>('.catalog-item__hint')!.textContent = getSampleValue(id, currentLocale())
  checkbox.addEventListener('change', () => setSegmentEnabled(id, checkbox.checked))
  catalogCheckboxElements.set(id, checkbox)
  catalogItemElements.set(id, li)
  wireCatalogDragAndDrop(li, id)
  return li
}

/**
 * 建置左欄四類目錄（一次性，init() 呼叫；目錄項本身終生不重建、不重排
 * ——見 PLAN §D3-R4「目錄順序恆定…永不重排、無拖曳」）。分組與 view-
 * model 計算交給 catalog.ts 之 buildCatalogGroups 純函式（依
 * SEGMENT_DESCRIPTORS 目錄定義序，非 config.segments 陣列序，見其
 * 文件），本函式只機械消費輸出、掛載 DOM。
 *
 * T3.3（14-PLAN §D2′）：`.catalog-item__hint`（樣例值）與
 * `.catalog-item__badge`（已加入）顯隱恰好互斥——未啟用顯樣例、已啟用
 * 顯「已加入」，同一 `item.enabled` 布林值分別驅動兩者相反的 hidden。
 */
function buildCatalogItems(): void {
  for (const category of SECTION_ORDER) SEGMENT_LIST_BY_CATEGORY[category].textContent = ''
  catalogCheckboxElements.clear()
  catalogItemElements.clear()
  const groups = buildCatalogGroups(SEGMENT_DESCRIPTORS, config.segments, SECTION_ORDER)
  for (const category of SECTION_ORDER) {
    for (const item of groups[category]) {
      const li = buildCatalogItem(item.id, segLabel(item.id as SegmentId))
      catalogCheckboxElements.get(item.id)!.checked = item.enabled
      li.classList.toggle('catalog-item--enabled', item.enabled)
      setHidden(li.querySelector<HTMLElement>('.catalog-item__hint')!, item.enabled)
      setHidden(li.querySelector<HTMLElement>('.catalog-item__badge')!, !item.enabled)
      SEGMENT_LIST_BY_CATEGORY[category].appendChild(li)
    }
  }
}

/**
 * T5.6（09-PLAN §D5 D5 交接「catalog 項名」）：語言切換用——
 * `.catalog-item__name` 為 `buildCatalogItem` clone 時的一次性 textContent
 * 賦值（依段 id 逐一查 `segLabel(id)`，非固定鍵，故不掛 `data-i18n`），
 * 切換時不會被 `applyI18n` 追溯翻轉，須顯式重新賦值一次。純文字原地
 * 更新、不重建／不搬移節點——目錄項「終生不重建、不重排」不變量（見
 * `buildCatalogItems` 文件）不受影響，亦不影響 checkbox 勾選態／drag
 * wiring。
 */
function refreshCatalogNames(): void {
  for (const [id, li] of catalogItemElements) {
    const nameEl = li.querySelector<HTMLElement>('.catalog-item__name')
    if (nameEl !== null) nameEl.textContent = segLabel(id as SegmentId)
  }
}

/**
 * T3.4（(internal design doc) §D2′；TASKS.md T3.4，回饋
 * #5「目錄樣例值」語言連動）：語言切換用——同 `refreshCatalogNames`
 * 同構（`.catalog-item__hint` 亦為 `buildCatalogItem` clone 時的一次性
 * textContent 賦值，非 `data-i18n`，不被 `applyI18n` 追溯翻轉，須顯式
 * 重新賦值）。`getSampleValue` 內部 lazy per-locale 快取——呼叫新 locale
 * 時自然觸發該 locale 的首次合成（未快取則算、已快取則命中），呼叫端
 * 不需另外呼叫 `resetSampleValueCacheForTests`（該 hook 為 test-only，
 * 見 sample-values.ts 檔頭）。純文字原地更新、不重建／不搬移節點，亦不
 * 影響 hidden 顯隱態（顯隱由 enabled 布林值驅動，語言切換不改變任何段
 * 啟停狀態，見 handleLocaleSwitch 文件「不 mutate config」）。
 */
function refreshCatalogHints(): void {
  const locale = currentLocale()
  for (const [id, li] of catalogItemElements) {
    const hintEl = li.querySelector<HTMLElement>('.catalog-item__hint')
    if (hintEl !== null) hintEl.textContent = getSampleValue(id, locale)
  }
}

/**
 * 段啟停狀態的視覺同步（T5.9 抽出、T5.11 擴充）：原地更新左欄目錄項
 * （灰化＋徽章＋ checkbox 勾選態）與中欄完整控件列（.segment-row--enabled
 * class／移位鈕欄／移除鈕顯隱）——皆為既有節點原地更新，不搬移、不重建
 * （中欄 <li> 的實際容器歸屬〔列群組 ↔ 隱藏池〕交由 commitConfig →
 * layoutSegmentContainers 的分組變動偵測統一處理，見其文件）。純 DOM
 * 同步，**不** mutate SegmentConfig、**不**呼叫 commitConfig／不處理焦點
 * ——供 setSegmentEnabled（單段、逐次 commit＋回焦）與 performRowDeletion
 * （T5.11：整列批次停用、單次 commit，見其文件「避免 N 次 relayout」）
 * 共用。
 *
 * checkbox.checked 同步（T5.6 UI 驗收期間發現，2026-07-11 補）：T5.11
 * 新增的「中欄 ✕ 移除」／「整列刪除」兩條停用路徑皆繞過左欄 checkbox 本身
 * （不像使用者直接點 checkbox 時，瀏覽器已原生先切換其 .checked 才觸發
 * change），故本函式須顯式補 `checkbox.checked = enabled`，否則左欄勾勾
 * 會殘留與 seg.enabled 不一致的視覺假象。程式設定 `.checked` 屬性**不會**
 * 觸發 change 事件（僅使用者互動或 `.click()` 才會）——故此處賦值不會
 * 迴圈呼叫 buildCatalogItem 的 change handler、不會重入 setSegmentEnabled。
 */
function syncSegmentEnabledUi(id: string, enabled: boolean): void {
  const rowLi = rowElements.get(id)
  if (rowLi !== undefined) {
    rowLi.classList.toggle('segment-row--enabled', enabled)
    const moveField = rowLi.querySelector<HTMLElement>('.segment-row__move')
    if (moveField !== null) setHidden(moveField, !enabled)
    const removeBtn = rowLi.querySelector<HTMLElement>('.segment-row__remove')
    if (removeBtn !== null) setHidden(removeBtn, !enabled)
  }

  const catalogLi = catalogItemElements.get(id)
  if (catalogLi !== undefined) {
    catalogLi.classList.toggle('catalog-item--enabled', enabled)
    // T3.3（14-PLAN §D2′）：.catalog-item__hint（樣例值）與
    // .catalog-item__badge（已加入）顯隱互斥，同 buildCatalogItems 契約。
    const hint = catalogLi.querySelector<HTMLElement>('.catalog-item__hint')
    if (hint !== null) setHidden(hint, enabled)
    const badge = catalogLi.querySelector<HTMLElement>('.catalog-item__badge')
    if (badge !== null) setHidden(badge, !enabled)
  }

  const checkbox = catalogCheckboxElements.get(id)
  if (checkbox !== undefined) checkbox.checked = enabled
}

/**
 * 段啟停的唯一入口（T5.9；取代原 buildSegmentRow 內 li 自身 enable
 * checkbox 的 change handler）：mutate `segmentConfigById` 查得的既有
 * SegmentConfig 物件參照（非替換物件本身，理由同 applyRowNormalization
 * 「正確性關鍵」註解——既有控件閉包握著同一物件參照）；啟用時比照原邏輯
 * 先套用 clampReenableRow（見其文件，須在 commitConfig 的 normalizeRows
 * 升冪壓縮介入前完成）；接著呼叫 syncSegmentEnabledUi 原地同步視覺；
 * commitConfig 之後再呼叫 syncFgOverrideDisabled（棄用回傳值、不播報，
 * 見其呼叫處註解「I4b 回歸修復」）收斂 fgOverride picker 停用態；最後
 * 顯式回焦左欄 checkbox（連續勾選 N 段時焦點不跳失——PLAN 驗收語意）。
 *
 * T5.11（PLAN §排序與列指派 UX Rev 6「中欄每段『移除』鈕」）：移除鈕
 * （removeSegment）與左欄目錄取消勾選走**同一路徑**——皆呼叫本函式
 * （enabled=false），故回焦左欄 checkbox 之焦點策略對兩者一致（「回歸
 * 位」語意：使用者無論從左欄取消或中欄移除，皆回到左欄可再次勾選的
 * 位置，不落 body）。
 *
 * T5.6 UI 驗收回饋（2026-07-11，兩欄斷點 ~1100–1400px「目錄＋已選擇」
 * 上下堆疊於左欄）：中欄「✕ 移除」鈕距目錄區可能有一整欄之遙，
 * `.focus()` 預設會捲動視口至目標可見處，導致滑鼠使用者按下 ✕ 後畫面
 * 跳離原操作點（取消動作預期停留原地）。裁決＝依輸入模態區分：
 * `preventScroll=true`（滑鼠觸發，呼叫端依 click 事件 detail>0 判斷）
 * 時改用 `focus({ preventScroll: true })`——焦點語意與 SR 播報不變、
 * 但不捲動視口；鍵盤觸發（Enter/Space 合成 click，detail===0）維持
 * `preventScroll=false`（預設 focus() 行為），讓鍵盤使用者仍能看到
 * 焦點落點。左欄 checkbox 自身取消勾選（見 buildCatalogItem 的
 * change handler）呼叫本函式時不傳第三參數＝ false——該路徑的回焦
 * 目標與觸發元素相同（checkbox 取消勾選當下已持有焦點），不會捲動，
 * 故不需模態區分。
 *
 * T3.4（09-PLAN §D3 A-3「鍵盤 checkbox 啟用路徑補落列播報」）：啟用分支
 * 先前完全不播報（新增工作，非既有行為復用）——commitConfig 之後、回焦
 * 之前補一次 announceSegmentLanded('catalog-add', …)，語意同「目錄拖入
 * 啟用」（checkbox 勾選同為「把段加入某列」，非「移動既有段」，故非
 * 'move' 模板）。落列位置＝上方 clampReenableRow 決定的 `seg.row`（含
 * BACKLOG:37「舊 row 值越界被 clamp」情境）；position／rowSize 取
 * commitConfig 後最新分組（`computeRowGroups`——本分支無跨列移動語意可
 * 套用 `performCrossRowMove`，故直接查分組，非復用它）；顯示編號依 PLAN
 * 定案一律 `slotIndexOfRealRow` 映射（`rowSlots` 已於上方 real-slot 插入
 * 分支同步更新，此刻映射正確）。停用分支（!enabled）維持既有零播報
 * ——removeSegment／checkbox 取消勾選的既有播報路徑不變。
 */
function setSegmentEnabled(id: string, enabled: boolean, preventScroll = false): void {
  const seg = segmentConfigById.get(id)
  if (seg === undefined) return

  if (!enabled) {
    // T5.14：✕移除／左欄取消勾選——若該段是其列唯一啟用段（該列即將
    // 消失），維持**壓縮語意**：removeSlotAt 於該真實列的 slot 位置移除、
    // 不留空列（Rev 11 明文——與拖曳搬空的「原地保留」不同語意）。於
    // commitConfig 前做（此刻 rowSlots／config 尚為停用前狀態，slot 位置
    // 正確）。
    const row = seg.row ?? 0
    const drains = !config.segments.some(
      (other) => other.id !== id && other.enabled && (other.row ?? 0) === row,
    )
    if (drains) {
      rowSlots = removeSlotAt(rowSlots, slotIndexOfRealRow(rowSlots, row))
      // T1.7（09-PLAN §D1 A-3）：該真實列消失＋其 rowSeparators 覆寫一併
      // 消滅（real-slot 集合縮減，non-null 尾巴需重新修剪，見
      // normalizeRowSeparatorsField）。`row` 於此刻仍為停用前的 dense
      // real index（與 rowSeparators 索引基準同源），直接對應。
      config.rowSeparators = normalizeRowSeparatorsField(removeRealAt(config.rowSeparators ?? [], row))
    }
  }

  seg.enabled = enabled
  if (enabled) {
    const clamped = clampReenableRow(seg.row, lastRowGroups.length)
    if (clamped === undefined) delete seg.row
    else seg.row = clamped
    // T5.14：僅當啟用前尚無任何渲染列（lastRowGroups.length === 0，此段
    // 即首個啟用段、渲染列 0→1）時於 slot 0 插入 'real'；其他啟用情形
    // clampReenableRow 保證落入既有列、不成長渲染列數，slots 不動。
    if (lastRowGroups.length === 0) rowSlots = ['real', ...rowSlots]
  }

  syncSegmentEnabledUi(id, enabled)

  commitConfig()
  // I4b 回歸修復（協調者續 T7.4，2026-07-15）：syncFgOverrideDisabled 的
  // shouldDisable 判定式（I4 修復新增）現依賴 seg.enabled，但本函式從未
  // 呼叫過它——導致 powerline 下「停用一個開了 bar 的百分比段→再重新
  // 啟用」時，其 fgOverride picker 停在停用當下同步的 disabled=false
  // 過期狀態，直到下次使用者切 bar／mode 才會收斂，UI 顯示（可互動）與
  // 實質（resolve 對 bar 段本就忽略 fgOverride）不一致。此處補一次呼叫
  // 使其隨每次啟停即時收斂。純 UI 附帶收斂、非本次啟停操作的播報主體，
  // 故顯式棄用回傳值——不 announceGlobal（比照 syncGlobalControls 呼叫
  // applyModeConstraints 棄用回傳值的既有慣例／I5 duplicateResetPairIds
  // 的「seed 不播」精神），避免蓋掉或多播一句與「啟停」本身無關的訊息
  // （announceGlobal 為單一 live region、後寫覆寫前寫，見其文件）。
  syncFgOverrideDisabled()

  if (enabled) {
    const landedRow = seg.row ?? 0
    const group = computeRowGroups(config.segments).find((g) => g.row === landedRow)
    announceSegmentLanded('catalog-add', segLabel(id as SegmentId), {
      row: slotIndexOfRealRow(rowSlots, landedRow) + 1,
      position: group === undefined ? 1 : group.segmentIds.indexOf(id) + 1,
      rowSize: group === undefined ? 1 : group.segmentIds.length,
    })
  }

  catalogCheckboxElements.get(id)?.focus(preventScroll ? { preventScroll: true } : undefined)
}

/**
 * T3.1（09-PLAN §D3 A-1「defer-commit 旗標」）：`commitSegmentMove`
 * 專用的積木——拖曳一個**停用中**的目錄項落到某個列/暫存列時，落點的
 * row/slots 由 T3.2 的 target 決策（`planSegmentMove` 既有落點運算）
 * 唯一決定，`setSegmentEnabled` 內建的 `clampReenableRow`（落回
 * `lastRowGroups.length` 範圍內既有列）會與該決策衝突、產生中間態
 * （PLAN C1 明文禁止的 clamp 中間態——「先 clamp 進舊列、再搬到新列」
 * 這種使用者不曾要求、亦不應可觀察到的過渡狀態）。故本函式**只** mutate
 * `seg.enabled = true`，刻意跳過 `setSegmentEnabled` 其餘全部步驟：
 * 不動 `seg.row`（不 clamp）、不動 `rowSlots`／`config.rowSeparators`、
 * 不 `syncSegmentEnabledUi`（左欄/中欄視覺不同步）、不 `commitConfig`
 * （不 persist、不觸發 `layoutSegmentContainers`）、不
 * `syncFgOverrideDisabled`、不回焦。row/slots 落點、視覺同步、**唯一
 * 一次** commit＋播報，全部交由呼叫端（T3.2 的 `commitSegmentMove`）
 * 在 target 定案後才補跑（見 `commitSegmentMove` 文件；補跑須含
 * `syncSegmentEnabledUi`＋`syncFgOverrideDisabled`，否則拖入啟用中的
 * powerline+bar 百分比段會重演 I4b 過期態回歸）。
 *
 * 僅支援「啟用」方向——語意上就是「先標記這段即將被啟用」，故簽章上
 * 不收 `enabled` 參數（非 `setSegmentEnabled` 疊加 `defer` 旗標的
 * 選項物件形），從根本避免「defer+停用」這個無意義組合的存在，毋須
 * 額外註解／斷言把關。對已啟用段呼叫是安全的 no-op 疊寫（冪等：
 * `seg.enabled = true` 疊加一次仍是 `true`），呼叫端毋須自行判斷目標
 * 段目前是否已啟用。
 *
 * 回傳查得的 `SegmentConfig` 物件參照（`segmentConfigById` 內部持有的
 * 同一參照，非拷貝——同檔既有「直接 mutate 既有物件參照」慣例，見
 * `setSegmentEnabled` 文件），供呼叫端／測試檢視 mutate 後狀態（如
 * `.row` 確未被 clamp 改寫）；查無該 id（防禦，理論上不會發生——目錄
 * 項來源必為 `segmentConfigById` 已知 id）回傳 `undefined`。
 */
export function markSegmentEnabledDeferred(id: string): SegmentConfig | undefined {
  const seg = segmentConfigById.get(id)
  if (seg === undefined) return undefined
  seg.enabled = true
  return seg
}

/**
 * T5.11（PLAN §排序與列指派 UX Rev 6「中欄每段『移除』鈕」）：中欄控件列
 * 「移除」鈕的入口——走 setSegmentEnabled(id, false) 同一路徑（含焦點回
 * 左欄 checkbox），額外補一則 #segment-move-status 播報「〈段名〉已從
 * 清單移除」（checkbox 取消勾選本身不額外播報——取消動作的語意已由
 * checkbox unchecked 狀態呈現；移除鈕則是使用者於中欄的「隱性」操作，
 * 段從中欄消失需明確告知去向）。
 *
 * `preventScroll`（T5.6 UI 驗收回饋，見 setSegmentEnabled 文件）：呼叫端
 * （removeBtn click handler）依 MouseEvent.detail 判斷輸入模態後轉交，
 * 本函式只原樣透傳，不自行判斷。
 */
function removeSegment(id: string, preventScroll: boolean): void {
  setSegmentEnabled(id, false, preventScroll)
  announceMove(msg().announce.removed(segLabel(id as SegmentId)))
}

// ── 長條圖（bar）正交開關（T5.1，08-PLAN §5） ──

/**
 * bar 切開（false→true）且 `seg.threshold===undefined` 時的預設模板判定
 * （PLAN §In-scope line 62-63 釘死，不可更動）：`context-remaining`（剩餘
 * 類，數值越高越好）用逆序版「剩餘漸層」；其餘百分比段（用量類，數值越
 * 高越壞）一律用「限額漸層」。純函式、零 DOM——與 hasNoBoundaryRisk 同
 * 慣例（main.ts 內既有純函式先例，見其文件）。
 */
function pickDefaultThresholdTemplateId(id: string): ThresholdTemplateId {
  return id === 'context-remaining' ? 'remaining-gradient' : 'limit-gradient'
}

/**
 * powerline 下 bar 段 fgOverride 停用提示句（T5.1）：單一段名版本，供
 * syncFgOverrideDisabled 回傳的「新停用」段清單逐一套用組句（mode 切換
 * 可能一次牽動多段，見 handleModeChange；bar 切開一次僅牽動自身一段，見
 * setSegmentBar）。純字串組句，無副作用。
 */
function fgOverrideDisabledMessage(label: string): string {
  return msg().announce.fgOverrideDisabled(label)
}

/**
 * T2.2（09-PLAN §D2「預設值標示」選項 C）：現值＝預設時淡化各欄位
 * 「（預設：X）」提示（凸顯偏離預設之欄位；反之現值≠預設時恢復正常樣式）
 * ——與 `computeSegmentFieldDefaults` 同一權威來源比對（`isSegmentFieldAt
 * Default`，見 segment-defaults.ts）。
 *
 * 呼叫時機＝ `commitConfig` 尾端＋`buildSegmentRows` 尾端（初始渲染，
 * `commitConfig` 依 T7.4/I5 慣例不在 init() 內呼叫，見其文件），比照
 * `updateNoBoundaryHint`／`checkDuplicateResetHints` 既有「commitConfig
 * 統一收束」慣例——欄位變動路徑眾多（逐欄位 change handler、拖曳／上下
 * 移、閾值模板批次套用等皆各自呼叫 commitConfig，唯獨部分路徑〔如列指
 * 派〕不逐一掛淡化同步），單一進入點可避免掛一漏萬，不需逐一補呼叫。
 */
function syncDefaultHintDims(): void {
  for (const [id, hints] of defaultHintElements) {
    const seg = segmentConfigById.get(id)
    const descriptor = DESCRIPTORS_BY_ID[id as SegmentId] as SegmentDescriptor | undefined
    if (seg === undefined || descriptor === undefined) continue
    for (const key of Object.keys(hints) as SegmentFieldKey[]) {
      const hintEl = hints[key]
      if (hintEl === undefined) continue
      hintEl.classList.toggle(
        'segment-row__default-hint--at-default',
        isSegmentFieldAtDefault(seg, descriptor, key),
      )
    }
  }
}

/**
 * T5.1（08-PLAN §5）：powerline 模式下 bar 段 fgOverride 停用同步——判定
 * 範圍依 resolve.ts 實際引擎語意鏡射（resolveSegment 內的 `bar` 分支，見
 * `const bar = seg.bar === true && descriptor.category === 'percentage'`
 * 判定式——以符號引用取代 file:line，避免行號隨編輯漂移；code review N7）：
 * **僅 `seg.bar===true` 之段**（bar 4-run 路徑與其 null 退單 run 路徑皆
 * 停用 fgOverride、恆用 autoFg(段主色)），非 bar 段或 plain 模式一律不受
 * 影響——不可擴大停用範圍至全段或全部百分比段。
 *
 * 逐段同步 fgPickerElements 的 `<fieldset disabled>`；以模組層級
 * `fgOverrideDisabledIds` 追蹤「目前停用中」集合，回傳本次呼叫「由可用
 * 變停用」的段名清單——供呼叫端組 live region 播報（僅狀態實際變動時提
 * 示一次，避免重複呼叫〔如逐次 commitConfig〕造成 live region spam）。
 * 呼叫時機：applyModeConstraints（mode 切換／初始化）、setSegmentBar
 * （bar 切開/關閉）。
 */
function syncFgOverrideDisabled(): string[] {
  const powerline = config.mode === 'powerline'
  const newlyDisabledLabels: string[] = []
  for (const seg of config.segments) {
    const picker = fgPickerElements.get(seg.id)
    if (picker === undefined) continue
    // I4 回歸修復（code review I4）：加 seg.enabled 閘——已停用（左欄取消
    // 勾選、退隱藏池）的段即使 seg.bar 仍為 true（bar 與 enabled 正交，
    // 停用不清 seg.bar），也不應被算進「新停用」清單、不應對螢幕閱讀器
    // 播報一個使用者已從清單移除的段的停用提示。比照本檔
    // checkDuplicateResetHints 既有的 rate.enabled && reset.enabled 閘。
    const shouldDisable = powerline && seg.enabled && seg.bar === true
    picker.setDisabled(shouldDisable)
    if (shouldDisable) {
      if (!fgOverrideDisabledIds.has(seg.id)) {
        newlyDisabledLabels.push(segLabel(seg.id as SegmentId))
      }
      fgOverrideDisabledIds.add(seg.id)
    } else {
      fgOverrideDisabledIds.delete(seg.id)
    }
  }
  return newlyDisabledLabels
}

/**
 * 長條圖（bar）checkbox 的唯一入口（T5.1，08-PLAN §5）：`checked` 反映
 * `<input class="segment-row__bar">` 的新狀態，僅 barEligibleIds 成員段
 * 的控件存在（見 buildSegmentRow）。
 *
 * 切開（false→true）：`seg.threshold===undefined` → 呼叫
 * `thresholdEditorElements` 的 `applyTemplate`
 * （pickDefaultThresholdTemplateId 判定模板）材料化預設閾值＋同步 10 桶
 * 色選與 templateSelect.value（避免面板顯示「（自訂）」與心智模型脫
 * 節）；`seg.threshold` 已有值（自訂桶或既有模板） → **保留不動**。兩情
 * 形皆組一句播報。
 *
 * 關閉（true→false）：`seg.threshold` 不動（bar 與 threshold 正交，見
 * config.ts SegmentConfig.bar 文件「長條圖正交欄」）——僅 `delete
 * seg.bar`（比照 prefix／fgOverride 等既有選填欄「不搬運 false」慣例，
 * 與 config.ts sanitizeSegment 的清洗結果一致）。
 *
 * 兩種切態後皆呼叫 syncFgOverrideDisabled 同步 fgOverride 停用態——若
 * 目前為 powerline 模式，切開會使本段新停用（回傳含本段名），該句併入
 * 同一次 announceGlobal（多句以「；」相接，一次 live region 呼叫，避免
 * 覆寫）；關閉則使本段解除停用，不另播報（PLAN 僅要求「停用＋提示」，
 * 未要求對稱的「恢復」提示——且 plain 模式下 fg-mount 本身 CSS 隱藏，恢
 * 復可用一般伴隨 mode 切回 plain 之情形，已由 handleModeChange 的既有
 * 色彩語意翻轉播報涵蓋語境）。
 */
function setSegmentBar(id: string, checked: boolean): void {
  const seg = segmentConfigById.get(id)
  if (seg === undefined) return
  const descriptor = DESCRIPTORS_BY_ID[id as SegmentId]
  const messages: string[] = []

  if (checked) {
    seg.bar = true
    if (seg.threshold === undefined) {
      const templateId = pickDefaultThresholdTemplateId(id)
      thresholdEditorElements.get(id)?.applyTemplate(templateId)
      messages.push(msg().announce.barOnWithTemplate(segLabel(descriptor.id), msg().thresholdTemplateLabel[templateId]))
    } else {
      messages.push(msg().announce.barOnKeepCustom(segLabel(descriptor.id)))
    }
  } else {
    delete seg.bar
  }

  for (const label of syncFgOverrideDisabled()) messages.push(fgOverrideDisabledMessage(label))
  if (messages.length > 0) announceGlobal(msg().announce.join(messages))
  commitConfig()
}

// ── segment 列（複合控件） ──

function buildSegmentRow(seg: SegmentConfig, descriptor: SegmentDescriptor): HTMLLIElement {
  const li = instantiateTemplate('segment-row-template', '__ID__', descriptor.id) as HTMLLIElement
  // T5.4（09-PLAN §D5 A-3 clone 時序）：clone 後立即套用目前語言——本模板
  // 尚無 data-i18n 標記（本任務示範面未含此模板，全量遷移留 T5.5），現階段
  // 為 no-op，屆時新增標記即自動生效、不需再動本呼叫點。
  applyI18n(li, currentLocale())
  li.dataset.segmentId = descriptor.id

  // T2.2（09-PLAN §D2「預設值標示」）：本段八欄位的預設值描述，一次查表
  // 供下方各欄位 label 後綴「（預設：X）」；hints 累積各 applicable 欄位
  // 建立的提示 span，函式尾端存進 defaultHintElements（供 syncDefault
  // HintDims 之後同步淡化態）。
  const fieldDefaults = computeSegmentFieldDefaults(descriptor.id, descriptor)
  const hints: Partial<Record<SegmentFieldKey, HTMLElement>> = {}

  // T5.9：段名為純視覺標籤（啟停唯一入口＝左欄目錄 checkbox，見
  // buildCatalogItem／setSegmentEnabled，本列自身不再有 enable
  // checkbox）。
  li.querySelector<HTMLElement>('.segment-row__name')!.textContent = segLabel(descriptor.id)
  li.classList.toggle('segment-row--enabled', seg.enabled)
  // T5.5：上/下移鈕移至 .segment-row__enable-field 尾端（不在自動收合的
  // .segment-row__controls 塊內），故顯隱須於此與 setSegmentEnabled 內
  // 顯式同步（僅啟用列顯示；見 index.html 模板註解 10.）。
  const moveField = li.querySelector<HTMLElement>('.segment-row__move')!
  setHidden(moveField, !seg.enabled)

  // 上/下移鈕（鍵盤等效；aria-label＝段名＋角色）；T5.5：列首/列末停用態
  // 由 refreshMoveButtonStates（分組/順序變動後）同步，此處僅建立節點與
  // 事件、存進 moveButtonElements 供該函式查找。
  const moveUp = li.querySelector<HTMLButtonElement>('.segment-row__move-up')!
  const moveDown = li.querySelector<HTMLButtonElement>('.segment-row__move-down')!
  moveUp.setAttribute('aria-label', msg().segmentControl.moveUp(segLabel(descriptor.id)))
  moveDown.setAttribute('aria-label', msg().segmentControl.moveDown(segLabel(descriptor.id)))
  moveUp.addEventListener('click', () => moveSegment(descriptor.id, 'up'))
  moveDown.addEventListener('click', () => moveSegment(descriptor.id, 'down'))
  moveButtonElements.set(descriptor.id, { up: moveUp, down: moveDown })

  // T5.11：移除鈕——與上/下移鈕同屬 .segment-row__enable-field（不在
  // .segment-row__controls 收合塊內），顯隱須於此與 setSegmentEnabled／
  // syncSegmentEnabledUi 內顯式同步（僅啟用列顯示；見 index.html 模板
  // 註解 12.）。
  const removeBtn = li.querySelector<HTMLButtonElement>('.segment-row__remove')!
  removeBtn.setAttribute('aria-label', msg().segmentControl.remove(segLabel(descriptor.id)))
  setHidden(removeBtn, !seg.enabled)
  // T5.6 UI 驗收回饋（2026-07-11）：以 MouseEvent.detail 區分輸入模態
  // ——瀏覽器原生語意，真滑鼠點擊 detail 恆 ≥1（連按次數），鍵盤
  // Enter/Space 觸發之合成 click 事件 detail 恆為 0。滑鼠觸發時回焦
  // 左欄 checkbox 改 preventScroll（見 removeSegment／setSegmentEnabled
  // 文件），修正兩欄堆疊斷點下視口捲動跳躍；鍵盤觸發維持可捲動。
  removeBtn.addEventListener('click', (event) => removeSegment(descriptor.id, event.detail > 0))

  // T5.4／T5.9（PLAN §D2「列選擇 UI」／§D3-R4「新增一列（第三修）」）：
  // 「顯示於第 N 列」select（S7 裁決：新增一列不放進 select option，
  // 避免 Windows 閉合 select 方向鍵導航逐按即提交造成無限誤觸建列；
  // T5.9 起改中欄頂部單一按鈕，見 wirePendingRowButton）。select 的
  // <option> 集合本身於此僅建立空殼——實際內容由 refreshRowSelects
  // （分組或暫存列數實際變動時才呼叫）以 row-select.ts 之
  // computeRowSelectOptionOps 原地填入/更新（枚舉含暫存列），不在此處
  // 預先枚舉（此刻尚不知全域列數）。
  const rowSelect = li.querySelector<HTMLSelectElement>('.segment-row__row-select')!
  const rowField = rowSelect.closest('.segment-row__field')!
  contextSpan(rowField).textContent = msg().segmentControl.namePrefix(segLabel(descriptor.id))
  hints.row = appendDefaultHint(rowField.querySelector('label')!, fieldDefaults.row)
  rowSelectElements.set(descriptor.id, rowSelect)
  // T5.14：select value 現為 **slot index**（非渲染列序）——依 rowSlots
  // 判定該 slot 為 real／pending，轉為 DropTarget 交統一移動入口
  // commitSegmentMove（與拖曳同語意：來源列搬空則原地保留空列、指入
  // 中間空列則於該位置插入真實列，見其文件）。
  //
  // MAGI code review I-1（(internal design doc)
  // REVIEW.md，2026-07-12 使用者裁決「修」）：commitSegmentMove →
  // layoutSegmentContainers 以 appendChild 把該段 `<li>`（含此 select）
  // 重新定位至目標容器——聚焦中的 select 因此 blur，若不顯式回焦會落
  // body（PLAN Rev 5 明訂 select 為鍵盤跨列路徑之一；S7 spike 實證
  // Windows 閉合 select 方向鍵導航逐按即提交，落 body 即斷航，等同鍵盤
  // 陷阱）。回焦目標＝select 自身（節點重用：appendChild 搬移不銷毀，
  // rowSelectElements 持有的仍是同一節點）；select 觸發本質上鍵盤／滑鼠
  // 皆可能，但回焦自身不會造成視口跳躍疑慮——它只是換了容器、頁面內位置
  // 通常仍在可視範圍附近，不比照 setSegmentEnabled／removeSegment 的
  // preventScroll 模態區分。
  rowSelect.addEventListener('change', () => {
    const slotIndex = Number.parseInt(rowSelect.value, 10)
    if (Number.isNaN(slotIndex)) return
    if (rowSlots[slotIndex] === 'pending') {
      commitSegmentMove(descriptor.id, { kind: 'pending', slotIndex }, undefined)
    } else {
      commitSegmentMove(descriptor.id, { kind: 'real', row: realIndexOfSlot(rowSlots, slotIndex) }, undefined)
    }
    rowSelectElements.get(descriptor.id)?.focus()
  })

  // 顯示文字 checkbox（T5.12 措辭更名；M1.5 起 icon.glyph 皆 ASCII 文字前綴）。
  const iconInput = li.querySelector<HTMLInputElement>('.segment-row__icon')!
  const iconField = iconInput.closest('.segment-row__field')!
  contextSpan(iconField).textContent = msg().segmentControl.namePrefix(segLabel(descriptor.id))
  hints.icon = appendDefaultHint(iconField.querySelector('label')!, fieldDefaults.icon)
  iconInput.checked = seg.icon
  iconInput.addEventListener('change', () => {
    seg.icon = iconInput.checked
    commitConfig()
  })

  // 前綴（≤8；過 validate.ts＋PUA 補判；拒收→role=alert）。
  const prefixInput = li.querySelector<HTMLInputElement>('.segment-row__prefix')!
  const prefixField = prefixInput.closest('.segment-row__field')!
  contextSpan(prefixField).textContent = msg().segmentControl.namePrefix(segLabel(descriptor.id))
  hints.prefix = appendDefaultHint(prefixField.querySelector('label')!, fieldDefaults.prefix)
  prefixInput.value = seg.prefix ?? ''
  prefixInput.addEventListener('input', () => {
    const result = validateUserText(prefixInput.value)
    if (!result.ok) {
      showError(msg().validation.fieldReject('prefix', result.reason))
      return
    }
    clearError()
    seg.prefix = prefixInput.value === '' ? undefined : prefixInput.value
    commitConfig()
  })

  // variant（僅有 variants 之段保留；否則移除整組）。
  const variantField = li.querySelector<HTMLElement>('.segment-row__variant-field')!
  if (descriptor.variants !== undefined) {
    const variantSelect = li.querySelector<HTMLSelectElement>('.segment-row__variant')!
    contextSpan(variantField).textContent = msg().segmentControl.namePrefix(segLabel(descriptor.id))
    for (const variant of descriptor.variants) {
      const option = document.createElement('option')
      option.value = variant
      option.textContent = msg().variantLabel[variant] ?? variant
      variantSelect.appendChild(option)
    }
    variantSelect.value = seg.variant ?? descriptor.variants[0]
    variantSelect.addEventListener('change', () => {
      seg.variant = variantSelect.value
      commitConfig()
    })
    hints.variant = appendDefaultHint(variantField.querySelector('label')!, fieldDefaults.variant)
  } else {
    variantField.remove()
  }

  // base 色（plain=前景／powerline=背景；mode 切換值不重映射）。
  // T5.2（08-PLAN §5）：autoEligibleIds 成員段（model／effort）主色 picker
  // 走 createSegmentColorPicker——直接以 seg.color（SegmentColor，可能為
  // {kind:'auto'}）為初值／回呼型別，不經 segmentColorPlaceholder（該函式
  // 會把 auto 塌陷成 default，若用於此處寫回會遺失使用者選的 auto 態）。
  // 非合格段維持既有三態封閉路徑（createColorPicker＋segmentColorPlaceholder
  // 佔位轉換；該類段 seg.color 本就不可能為 auto，見 config.ts
  // sanitizeSegmentColor 之 allowAuto 限制，此處轉換恆為 no-op，僅滿足
  // 型別）。
  const baseMount = li.querySelector<HTMLElement>('.segment-row__color-mount')!
  const basePicker = SEGMENT_CATALOG.autoEligibleIds.has(descriptor.id)
    ? createSegmentColorPicker(msg().segmentControl.colorName(segLabel(descriptor.id)), seg.color, (spec) => {
        seg.color = spec
        commitConfig()
      })
    : createColorPicker(msg().segmentControl.colorName(segLabel(descriptor.id)), segmentColorPlaceholder(seg.color), (spec) => {
        seg.color = spec
        commitConfig()
      })
  baseMount.appendChild(basePicker.element)
  hints.color = appendDefaultHint(baseMount, fieldDefaults.color)

  // powerline 前景覆寫（「終端預設」態＝清除覆寫→回 auto-fg）。
  const fgMount = li.querySelector<HTMLElement>('.segment-row__fg-mount')!
  const fgPicker = createColorPicker(
    msg().segmentControl.fgColorName(segLabel(descriptor.id)),
    seg.fgOverride ?? { kind: 'default' },
    (spec) => {
      seg.fgOverride = spec.kind === 'default' ? undefined : spec
      commitConfig()
    },
  )
  fgMount.appendChild(fgPicker.element)
  hints.fgOverride = appendDefaultHint(fgMount, fieldDefaults.fgOverride)
  // T5.1：全段皆註冊（fg-mount 對全段存在，僅 CSS 依 mode 顯隱，見上方
  // fgPickerElements 宣告文件）——供 syncFgOverrideDisabled 統一巡走。
  fgPickerElements.set(descriptor.id, fgPicker)

  // 閾值（僅百分比段）。
  const thresholdMount = li.querySelector<HTMLElement>('.segment-row__threshold-mount')!
  if (descriptor.category === 'percentage') {
    thresholdEditorElements.set(descriptor.id, buildThresholdEditor(thresholdMount, seg, descriptor))
    // T2.2：無獨立 label，提示掛在 disclosure 觸發鈕（「閾值變色設定」）後。
    const thresholdToggle = thresholdMount.querySelector<HTMLButtonElement>('.threshold__toggle')!
    hints.threshold = appendDefaultHint(thresholdToggle, fieldDefaults.threshold)
  } else {
    thresholdMount.remove()
  }

  // T5.1（08-PLAN §5）：長條圖（bar）正交開關，限 barEligibleIds（一律吃
  // catalog set，不硬編 category==='percentage'——與 config.ts sanitizeSegment
  // 同一份判準）。
  const barField = li.querySelector<HTMLElement>('.segment-row__bar-field')!
  if (SEGMENT_CATALOG.barEligibleIds.has(descriptor.id)) {
    const barInput = li.querySelector<HTMLInputElement>('.segment-row__bar')!
    contextSpan(barField).textContent = msg().segmentControl.namePrefix(segLabel(descriptor.id))
    barInput.checked = seg.bar === true
    barInput.addEventListener('change', () => setSegmentBar(descriptor.id, barInput.checked))
    hints.bar = appendDefaultHint(barField.querySelector('label')!, fieldDefaults.bar)
  } else {
    barField.remove()
  }

  defaultHintElements.set(descriptor.id, hints)
  wireDragAndDrop(li, descriptor)
  return li
}

// ── 插入點挪空間視覺（T5.11；PLAN §排序與列指派 UX Rev 6「插入點挪 ──
// ── 空間視覺」） ──

/**
 * 自 `node`（段 `<li>` 或插入點 gap placeholder 自身）之後，找下一個
 * 「真實段」id：跳過 placeholder gap（`.segment-drop-gap`）與
 * `excludeId`（通常為被拖曳段本身——同列相鄰情形下，其原位可能恰為
 * `node` 之後的下一個手足節點，須排除以免誤傳其 id 給
 * `computeCrossRowMove`，見其 no-op 防衛文件）。找不到（`node` 已是列尾
 * 前的最後一個真實段）→ `undefined`（供 `computeCrossRowMove`「無
 * beforeId＝插入列尾」語意直接使用）。`resolveInsertBeforeId`（li 級
 * drop）與 gap 節點自身的 drop handler（見 ensureDropGap）共用本函式。
 */
function nextSegmentId(node: Element, excludeId: string): string | undefined {
  let sibling = node.nextElementSibling
  while (sibling !== null) {
    const id = (sibling as HTMLElement).dataset.segmentId
    if (sibling.classList.contains('segment-drop-gap') || id === excludeId) {
      sibling = sibling.nextElementSibling
      continue
    }
    return id
  }
  return undefined
}

/**
 * 惰性建立／必要時重建 dropGapEl：目的容器為 `<ol>`／`<ul>`（列群組
 * `.segment-list`）時建 `<li>`（HTML 語意要求 list 只能直接容納 `<li>`）；
 * 其餘（暫存空列 `<div>` 容器）建 `<div>`。同一拖曳手勢跨越不同類型容器
 * （如自列群組拖到暫存空列上方）時，既有節點型別不符則整個重建——本
 * 元素恆為純 UI 節點、無監聽器無承載狀態（僅下方兩個拖放 listener 之
 * 閉包讀取模組層級的 `draggingId`／`dropGapTarget`，非節點自身狀態），
 * 重建不違節點重用鐵律（該鐵律的保護對象是承載狀態的段 `<li>`，見
 * rowElements 文件）。
 *
 * 新建節點時就地接線自身的 dragover／drop（**刻意不用
 * `pointer-events:none` 讓事件穿透至下層真實目標**——曾考慮該做法，但
 * gap 一旦成長至可視高度會在版面中佔據實際區塊，使用者的指標常會靜止
 * 於該區塊內〔它正是視覺提示的「放這裡」〕，若指標事件穿透，會落到
 * 其父容器 `<ol>`／`<div>` 本身、被 wireRowContainerDrop 的「空白處＝
 * 落列尾」邏輯誤判，導致 gap 在使用者尚未移動指標的情況下自行跳到
 * 列尾——故改為 gap 自身即為合法 drop 目標，`stopPropagation()` 防止
 * 冒泡至容器重複判定，維持指標靜止時插入點不漂移）：dragover 僅
 * `preventDefault()`＋維持現狀（不重新定位，故指標留在 gap 內時插入點
 * 穩定不跳動）；drop 依 `dropGapTarget`＋`nextSegmentId(gap, movedId)`
 * 交 commitSegmentMove 提交（等同「維持目前視覺插入點」）。
 */
function ensureDropGap(container: HTMLElement): HTMLElement {
  const wantTag = container.tagName === 'OL' || container.tagName === 'UL' ? 'li' : 'div'
  if (dropGapEl !== null && dropGapEl.tagName.toLowerCase() === wantTag) return dropGapEl
  dropGapEl?.remove()
  // 明確標註 HTMLElement（而非讓 TS 由 'li'|'div' 聯集字面推得 HTMLLIElement
  // | HTMLDivElement）：後者在部分 TS 版本下對聯集型別呼叫多載泛型方法
  // （如 addEventListener）會退化推導為非泛型簽章，導致下方 DragEvent
  // 專屬欄位（dataTransfer）型別檢查失敗。
  const el: HTMLElement = wantTag === 'li' ? document.createElement('li') : document.createElement('div')
  el.className = 'segment-drop-gap'
  el.setAttribute('aria-hidden', 'true')
  el.addEventListener('dragover', (event) => {
    if (draggingId === null) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  })
  el.addEventListener('drop', (event) => {
    if (draggingId === null || dropGapTarget === null) return
    event.preventDefault()
    event.stopPropagation()
    const movedId = draggingId
    const target = dropGapTarget
    // pending target 的 gap 落在暫存列 <div> 內、無段 <li> → nextSegmentId
    // 回 undefined（＝落列尾）；real target 則跳過 gap／被拖曳段自身取下一
    // 真實段 id。見 commitSegmentMove（統一移動入口）。
    const beforeId = nextSegmentId(el, movedId)
    endDragCleanup()
    commitSegmentMove(movedId, target, beforeId)
  })
  dropGapEl = el
  return el
}

/**
 * 於 `container` 內、`beforeNode`（`null`＝容器末端）之前顯示插入點
 * placeholder，並記錄 `targetRow`（供 gap 自身 drop handler 使用，見
 * ensureDropGap 文件）：首次出現（新建立／新容器）時強制 reflow 後才加
 * `--visible` 修飾類別，確保 CSS 高度過渡有「前一狀態」可過渡（新插入
 * 節點若初始狀態與終態同幀套用，瀏覽器不會播放 transition）；已存在且
 * 位置未變時略過重插（避免 dragover 高頻觸發造成不必要 DOM 抖動）。
 * `prefers-reduced-motion: reduce` 由 src/style.css 全站規則將
 * transition-duration 收斂至 0.01ms，此處不需額外分支。
 */
function showDropGap(container: HTMLElement, beforeNode: Element | null, target: DropTarget): void {
  dropGapTarget = target
  const gap = ensureDropGap(container)
  if (gap.parentElement !== container || gap.nextElementSibling !== beforeNode) {
    container.insertBefore(gap, beforeNode)
  }
  if (!gap.classList.contains('segment-drop-gap--visible')) {
    void gap.getBoundingClientRect() // 強制 reflow，見上方文件。
    gap.classList.add('segment-drop-gap--visible')
  }
}

/** 拖曳結束（drop／dragend）清除插入點 placeholder；冪等（節點已移除時安全）。 */
function clearDropGap(): void {
  dropGapEl?.remove()
  dropGapEl?.classList.remove('segment-drop-gap--visible')
  dropGapTarget = null
}

/**
 * T3.3（09-PLAN §D3 A-2「endDragCleanup 冪等合流」）：拖曳收尾的**單一
 * 冪等出口**——取代原本散落於 dragend＋5 個 drop handler（li／gap／
 * 列容器空白處／暫存列，跨中欄與目錄兩來源）各自重複的六步驟（
 * draggingId／dragOrigin／dragSource 歸零、opacity 復原、clearDropGap、
 * rAF 取消、body class 移除）。07 DRIFT 既有項——因本任務新增第二個
 * dragstart 來源（目錄）而被正當化合流（PLAN 明文非範圍蔓延）。
 *
 * 來源感知（opacity 復原節點）：`dragSource==='catalog'` 時查
 * `catalogItemElements`（左欄目錄 li），否則（`'row'`，既有中欄拖曳）查
 * `rowElements`（中欄完整控件列 li）——兩者以相同 id 存放**不同**節點，
 * 若不分派直接沿用其中一個 Map，另一來源的節點會清錯（清錯節點半透明
 * 卡住、正確節點反而漏清）。
 *
 * 冪等：讀值（`draggingId`／`dragSource`）先於歸零，故重複呼叫時
 * `draggingId` 已為 `null`，opacity 復原分支整段略過；`clearDropGap`
 * 本身冪等（見其文件）；`cancelAnimationFrame` 對已為 `null` 的
 * `dragClassRafId` 略過；`classList.remove` 對不存在的 class 為 no-op。
 * 故「drop handler 已跑過一次、dragend 再跑一次」（或反之）皆安全，不會
 * throw、不會使 class／opacity 卡死——drop 側現時序上提早（於 drop 當下
 * 即清 rAF／body class，不再延後至保證隨後才到的 dragend），對使用者
 * 不可辨（drop→dragend 間隔通常同一輪任務內），且更早收斂視覺無副作用。
 */
function endDragCleanup(): void {
  if (draggingId !== null) {
    const opacityTarget =
      dragSource === 'catalog' ? catalogItemElements.get(draggingId) : rowElements.get(draggingId)
    if (opacityTarget !== undefined) opacityTarget.style.opacity = ''
  }
  draggingId = null
  dragOrigin = null
  dragSource = null
  clearDropGap()
  if (dragClassRafId !== null) {
    cancelAnimationFrame(dragClassRafId)
    dragClassRafId = null
  }
  document.body.classList.remove('is-segment-dragging')
}

/**
 * 依插入方向解析 `computeCrossRowMove` 所需的 `beforeId`：`'before'`＝
 * 目標段本身；`'after'`＝目標段之後的下一個真實段（`nextSegmentId`，
 * 跳過 placeholder gap 與被拖曳段本身）。
 */
function resolveInsertBeforeId(li: HTMLElement, side: 'before' | 'after', movedId: string): string | undefined {
  if (side === 'before') return li.dataset.segmentId
  return nextSegmentId(li, movedId)
}

/**
 * 拖曳排序（鍵盤等效由上/下移鈕承擔）。整列可拖，但自 value 控件
 * （input/select/button/spinbutton）起手則取消，以免干擾控件互動。
 *
 * T5.11（PLAN §排序與列指派 UX Rev 6「拖曳統一插入制」，取代 T5.5「同列
 * ＝交換」／T5.10「跨列＝實際移動」的雙軌分支）：drop 在任一段 `<li>`
 * 上——無論同列或跨列——一律走**插入**語意：targetRow＝drop 目標所在的
 * 列群組容器（`rowIndexOfOl(li.parentElement)`，同列時即被拖曳段的原
 * 列——`computeCrossRowMove` 本身涵蓋此情形，見其文件）；`beforeId`
 * 依指標在目標段矩形之上/下半（`resolveDropSide`）解析（上半＝插其
 * 前，下半＝插其後）。上/下移**按鈕**（moveSegment／performSwap）維持
 * 相鄰交換語意不變。li 級 dragover 一律 `preventDefault()` 令 drop 事件
 * 觸發、`dropEffect` 一律 `'move'`（同列／跨列插入皆為合法搬移，不再有
 * `'none'` 分支），並同步顯示插入點 gap placeholder（見上方
 * showDropGap）。「列容器空白處／暫存空列＝落列尾」分支由
 * wireRowContainerDrop（掛在列群組 `<ol>`／暫存列容器本身）承接，見其
 * 文件；兩者共用 performCrossRowMove 核心。
 */
function wireDragAndDrop(li: HTMLLIElement, descriptor: SegmentDescriptor): void {
  li.draggable = true
  li.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement
    if (target.closest('input, select, button, textarea, [role="spinbutton"]')) {
      event.preventDefault()
      return
    }
    draggingId = descriptor.id
    dragSource = 'row'
    dragOrigin = { id: descriptor.id, parent: li.parentElement, nextSibling: li.nextElementSibling }
    event.dataTransfer?.setData('text/plain', descriptor.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    li.style.opacity = '0.5' // opacity 不影響版面（layout），可與上方同步設定，無此限制。
    // T5.11：拖曳期間放寬列尾命中區（scoped class，見 style.css；不動共用 .segment-list）。
    // T5.6 驗收修復：Chromium 會在 dragstart 派發期間偵測「來源元素」版面
    // （layout）位移，一旦偵測到即立即中止原生拖曳（表現為 dragstart 後數 ms
    // 內即 dragend、拖曳 session 從未建立），且此偵測不限第一列——只要來源 li
    // 在 dragstart 派發的同一幀內因版面變動而位移即會觸發。若在此同步加上
    // is-segment-dragging，其 CSS 規則（見 style.css）會讓「上方每一個」列
    // 群組清單立即長高，導致非第一列的來源 li 同幀下移，故拖曳一定被中止；
    // 第一列因其上方無其他列群組清單增高，位移量為 0，故不受影響（與回報
    // 「第一列永遠正常、其餘列一定失敗」完全吻合）。故必須延後至下一幀
    // （dragstart 派發已完成、瀏覽器判定拖曳 session 已建立之後）才加上，
    // 對命中區放寬的時機僅晚一幀，肉眼不可辨。
    dragClassRafId = requestAnimationFrame(() => {
      dragClassRafId = null
      if (draggingId !== null) document.body.classList.add('is-segment-dragging')
    })
  })
  li.addEventListener('dragend', endDragCleanup)
  li.addEventListener('dragover', (event) => {
    if (draggingId === null || draggingId === descriptor.id) return
    const dragged = rowElements.get(draggingId)
    if (dragged === undefined) return
    // 一律接受（含跨列）；T5.10 起跨列亦為合法搬移，dropEffect 一律 'move'。
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const container = li.parentElement
    if (container === null) return
    const targetRow = rowIndexOfOl(container)
    if (targetRow === null) return // 防禦：理論上不會發生（啟用段恆屬某列群組）。
    const rect = li.getBoundingClientRect()
    const side = resolveDropSide(event.clientY, rect.top, rect.height)
    const beforeNode = side === 'before' ? li : li.nextElementSibling
    showDropGap(container, beforeNode, { kind: 'real', row: targetRow })
  })
  li.addEventListener('drop', (event) => {
    if (draggingId === null || draggingId === descriptor.id) return
    const dragged = rowElements.get(draggingId)
    if (dragged === undefined) return
    event.preventDefault()
    event.stopPropagation() // 防冒泡至列容器（wireRowContainerDrop）重複處理同一次 drop。
    const movedId = draggingId
    const targetRow = rowIndexOfOl(li.parentElement) // li.parentElement 恆為某 rowGroupContainers[i].ol（真實列容器）。
    const rect = li.getBoundingClientRect()
    const side = resolveDropSide(event.clientY, rect.top, rect.height)
    const beforeId = resolveInsertBeforeId(li, side, movedId)
    endDragCleanup()
    if (targetRow === null) return // 防禦：理論上不會發生（啟用段恆屬某列群組）。
    commitSegmentMove(movedId, { kind: 'real', row: targetRow }, beforeId)
  })
}

/**
 * T3.3（09-PLAN §D3 A-1／A-2）：左欄目錄項的拖曳起手——與中欄
 * `wireDragAndDrop` 共用同一 `draggingId`／`commitSegmentMove` 統一入口，
 * 僅新增第二個 dragstart 來源（`dragSource='catalog'`，供 `endDragCleanup`
 * 分派 opacity 復原節點）。checkbox 命中區豁免（比照 `wireDragAndDrop`
 * 對 input/select/button 的起手豁免，見其文件）：`event.target` 落在
 * `.catalog-item__checkbox` 內時 `preventDefault()` 放棄拖曳，讓原生
 * 點選勾取行為照常進行，不被拖曳手勢攔截。
 *
 * 目錄項不接自身 dragover／drop——落點側（列容器空白處／li／gap
 * placeholder／暫存列）既有 handler 皆只依賴模組層級 `draggingId`（不
 * 分辨來源），`commitSegmentMove` 依 `movedSeg.enabled` 自動分派停用段
 * （enable-into-target，T3.2）或已啟用段（原移動路徑——A-3「已啟用
 * 目錄項被拖入＝退化為純 move」正是此自動分派的直接結果，無需另立
 * 分支），故目錄項只需負責 dragstart／dragend 兩端。
 */
function wireCatalogDragAndDrop(li: HTMLLIElement, id: string): void {
  li.draggable = true
  li.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement
    if (target.closest('input, select, button, textarea, [role="spinbutton"]')) {
      event.preventDefault()
      return
    }
    draggingId = id
    dragSource = 'catalog'
    dragOrigin = { id, parent: li.parentElement, nextSibling: li.nextElementSibling }
    event.dataTransfer?.setData('text/plain', id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    li.style.opacity = '0.5'
    // 比照中欄 wireDragAndDrop 之 T5.6 驗收修復（見其文件）：延後一幀才加
    // body class，避免 dragstart 派發同幀版面位移中止原生拖曳。
    dragClassRafId = requestAnimationFrame(() => {
      dragClassRafId = null
      if (draggingId !== null) document.body.classList.add('is-segment-dragging')
    })
  })
  li.addEventListener('dragend', endDragCleanup)
}

/**
 * 依 `<ol>` 節點反查其在 `rowGroupContainers` 的索引（＝渲染列序，
 * 0-index）——容器建立後位置終生穩定（growRowGroupContainers 僅於末端
 * 新增、shrinkRowGroupContainers 僅自末端移除，見兩者文件），故此查找
 * 結果對容器生命週期內任一時點皆正確。找不到（防禦；理論上不會發生）
 * 回傳 `null`。
 */
function rowIndexOfOl(ol: Element | null): number | null {
  if (ol === null) return null
  const index = rowGroupContainers.findIndex((container) => container.ol === ol)
  return index === -1 ? null : index
}

// ── 逐列分隔符（T1.7，09-PLAN §D1）：real-index 空間的維護 helper ──

/**
 * `config.rowSeparators` 正規形（比照 config.ts `sanitizeRowSeparators`
 * 之修剪規則，該檔本任務禁改、於此複刻同一收斂——UI 寫回路徑須自行維持
 * 正規形，不能只靠下次 `deserializeConfig` 才收斂）：修剪尾端連續
 * `null`；修剪後空陣列 → `undefined`（省略欄位，「全繼承」正規形）。
 * `removeRealAt`／`insertNullAtReal` 皆可能在陣列中段挖除/插入而使尾端
 * 產生新的連續 `null`（如原陣列 `[a, null, c]` 移除 real index 2 後變
 * `[a, null]`——尾端多了一個未修剪的 `null`），故三個變異點（
 * `setSegmentEnabled` drain／`performRowDeletion`／`commitSegmentMove`）
 * 皆須經此收斂，不得直接賦值裸陣列。
 */
function normalizeRowSeparatorsField(seps: readonly RowSeparator[]): RowSeparator[] | undefined {
  let end = seps.length
  while (end > 0 && seps[end - 1] === null) end--
  const trimmed = seps.slice(0, end)
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * commitSegmentMove 專用：把 `rowSlots`／`config.segments` 的 real-slot
 * 增減換算至 `rowSeparators`（real-index 空間，PLAN A-1 索引基準）的
 * splice 操作。**不可**直接借用 `planSegmentMove` 回傳的 `nextSlots`——
 * 該陣列是 slot-index 空間（`convertRealToPending` 只翻 kind、位置不
 * 動，故「顯示編號」不因來源列耗盡而漂移，見 row-slots.ts 文件），而
 * `rowSeparators` 索引的是「real 集合中的第 k 個」（real-index 空間，
 * 一個 real slot 轉 pending 後，其後全部 real 的 real-index 皆前移一格
 * ——即使 slot-index／顯示編號完全不變）。兩座標系有別，故本函式獨立於
 * `sourceRow`（movedSeg 移動前的 real index，即其正規化後 `row` 欄）／
 * `srcDrains`（來源列是否僅剩 moved 一段）／`targetRow`（`plan.targetRow`，
 * 已是 real-index 空間）三個既有量重新推導，呼叫端（`commitSegmentMove`）
 * 之 `sourceRow`／`srcDrains` 為獨立重算、非重用 `planSegmentMove` 內部
 * 同名決策（該函式無此欄位可取）。
 *
 * 操作順序**與 `planSegmentMove` 同構**（先落點插入、後來源移除——見其
 * 文件步驟 3→4）：
 * 1. `target.kind==='pending'`（落點為既有暫存列指派成真）→ 於
 *    `targetRow`（此位置尚未插入前即為該新 real 的 real-index，理由同
 *    `planSegmentMove` 之 `bumpIds` 收集邏輯——「other.row >= targetRow」
 *    與此處「插入使 real-index >= targetRow 者全數 +1」為同一件事的兩種
 *    描述）`insertNullAtReal`（新列本身無覆寫）。`target.kind==='real'`
 *    （落點為既有真實列）不觸發任何插入——bumpIds 恆空，佐證無 real 集合
 *    成長。
 * 2. 來源列耗盡且非同列插入（`sameRowInsert` 判定與 `planSegmentMove`
 *    步驟 4 同式）→ `removeRealAt`。**移除的 real-index 須計入步驟 1 是否
 *    已使其偏移**：若剛插入的位置 `targetRow <= sourceRow`，來源列的
 *    real-index 已被步驟 1 的插入向後推一格（`sourceRow + 1`）；否則
 *    （`target.kind==='real'` 或 `targetRow > sourceRow`）未受影響
 *    （`sourceRow` 原值）。
 */
function computeRowSeparatorsAfterMove(
  seps: readonly RowSeparator[],
  target: DropTarget,
  targetRow: number,
  sourceRow: number,
  srcDrains: boolean,
): RowSeparator[] {
  let next = target.kind === 'pending' ? insertNullAtReal(seps, targetRow) : [...seps]
  const sameRowInsert = target.kind === 'real' && targetRow === sourceRow
  if (srcDrains && !sameRowInsert) {
    const srcRealIndex = target.kind === 'pending' && targetRow <= sourceRow ? sourceRow + 1 : sourceRow
    next = removeRealAt(next, srcRealIndex)
  }
  return next
}

/**
 * 逐列分隔符控件的寫回入口（select／custom input 共用）：`realIndex` 為
 * 該列群組容器建立時的閉包索引（＝real index，見 `rowGroupContainers`
 * 文件「容器一經建立…索引終生穩定」）；`value` 為 `null`＝還原繼承全域、
 * 或明確 `SeparatorConfig` 覆寫。長度不足時先 `padToLength`（T1.2 交付
 * 呼叫方，見其文件「目前無呼叫方」）補 `null` 至可寫入該位置，寫入後經
 * `normalizeRowSeparatorsField` 收斂正規形，最後單次 `commitConfig`（與
 * 全域分隔符控件 `wireGlobalControls` 同慣例：每次控件變動即 commit）。
 */
function setRowSeparatorOverride(realIndex: number, value: SeparatorConfig | null): void {
  const padded = padToLength(config.rowSeparators ?? [], realIndex + 1)
  padded[realIndex] = value
  config.rowSeparators = normalizeRowSeparatorsField(padded)
  commitConfig()
}

/**
 * T1.7：依 `config.rowSeparators[i] ?? null`（`i`＝容器 real index，與其
 * `rowSeparators` 索引同基準）同步每列群組的分隔符控件顯示值——與
 * `refreshRowNumbering` 同點呼叫（見 `layoutSegmentContainers`）：凡
 * `rowSeparators` 因 real-slot 增減而重新對位（列刪除／耗盡／pending
 * 物化）皆伴隨分組或 slots 實際變動，必然觸發 `layoutSegmentContainers`
 * （見三個變異點文件），故毋須在「只改分隔符本身、未牽動列結構」的一般
 * commit 路徑額外呼叫——該路徑本就由控件自身的 change handler 直接同步
 * 已變更列的 DOM 值，無需反查 config 回填。
 */
function refreshRowSeparatorControls(): void {
  for (let i = 0; i < rowGroupContainers.length; i++) {
    const container = rowGroupContainers[i]
    const override = config.rowSeparators?.[i] ?? null
    if (override === null) {
      container.separatorPresetEl.value = 'inherit'
      setHidden(container.separatorCustomFieldEl, true)
      container.separatorCustomEl.value = ''
    } else if (override.kind === 'preset') {
      container.separatorPresetEl.value = `preset:${override.value}`
      setHidden(container.separatorCustomFieldEl, true)
      container.separatorCustomEl.value = ''
    } else {
      container.separatorPresetEl.value = 'custom'
      setHidden(container.separatorCustomFieldEl, false)
      container.separatorCustomEl.value = override.value
    }
  }
}

/**
 * T1.7：powerline 模式下逐列分隔符控件整組停用（比照 `applyModeConstraints`
 * 對全域 `separatorCustomEl` 的停用精神，見其文件；本控件群組**整組**
 * 停用而非僅 custom 子欄——逐列覆寫僅 plain 模式生效，見 `config.ts`
 * `BuilderConfig.rowSeparators` 文件「僅 plain 模式生效」，powerline 下
 * preset 亦無意義）。**保值不清除**：僅切 `disabled`，`config.rowSeparators`
 * 資料本身不變（惰性存續，比照既有 `separator` 慣例）。
 */
function applyRowSeparatorModeConstraints(): void {
  const powerline = config.mode === 'powerline'
  for (const container of rowGroupContainers) {
    container.separatorPresetEl.disabled = powerline
    container.separatorCustomEl.disabled = powerline
  }
}

/**
 * T5.14（PLAN Rev 11「列耗盡保留＋暫存列位置制」）：**統一移動入口**——
 * 跨列拖曳（li／gap／真實列容器空白處／暫存列容器）與 select 指派皆收斂
 * 至此，實現三大語意：
 * (1) 來源列耗盡（moved 是其列唯一啟用段）→ 該列**原地保留為空列**
 *     （位置不變）；
 * (2) 落點為中間暫存列 → 於該位置**插入真實列**（其下真實列 row +1，讓
 *     normalizeRows 收斂後 moved 正落該位）；
 * (3) 其餘列的顯示編號不因搬空／插入而漂移（slot 位置制保證）。
 *
 * MAGI code review I-3（(internal design doc)
 * REVIEW.md，2026-07-12 使用者裁決「修」）：原內含步驟 1–4 的全部決策
 * 邏輯（sourceRow／srcDrains 判定、pending 分支 targetRow／bump／
 * consumePendingSlot、srcDrains 轉 pending）已抽為純函式
 * `planSegmentMove`（row-slots.ts，含完整組合矩陣單元測試）。本函式現
 * 僅為**機械執行層**：
 * 1. 呼叫 `planSegmentMove(rowSlots, config.segments, movedId, target)`
 *    取得 `SegmentMovePlan`（`targetRow`／`nextSlots`／`bumpIds`）。
 * 2. 依 `bumpIds` 原地 bump 對應段的 `row +1`（既有 `segmentConfigById`
 *    物件參照 mutate 慣例，`planSegmentMove` 本身不 mutate 任何輸入）。
 * 3. `rowSlots = plan.nextSlots`。
 * 4. `performCrossRowMove`（既有：computeCrossRowMove＋seg.row 寫回＋
 *    commitConfig＋播報顯示編號）——行為與抽出前完全等價（`planSegmentMove`
 *    為原邏輯逐行搬遷，見其文件；本函式呼叫順序與原版一致：先決策、後
 *    mutate bump、再換 rowSlots、最後才 performCrossRowMove，未改變任何
 *    可觀察行為）。
 *
 * 不變量：pending consume（real +1）與來源耗盡 convert（real −1）任意
 * 組合後，realCount(rowSlots) 恆等於 commit 後實際渲染列數（見 row-slots.ts
 * reconcileRealSlots 為防禦收斂、理論上 no-op）；`beforeId === movedId` 由
 * computeCrossRowMove 既有 no-op 分支安全退化。
 *
 * T1.7（09-PLAN §D1 A-3）：`rowSeparators` 隨 `rowSlots` 同步 splice——
 * `sourceRow`／`srcDrains` 於此**獨立重算**（非重用 `planSegmentMove`
 * 內部同名決策，該函式的回傳形不含這兩值；純讀取、與 `planSegmentMove`
 * 內部判定同一套規則，見其文件步驟 1），供 {@link computeRowSeparatorsAfterMove}
 * 換算 real-index 空間的 splice（`rowSlots`／`convertRealToPending` 是
 * **slot-index 空間**、位置不變只翻 kind；`rowSeparators` 是**real-index
 * 空間**、real 集合縮減時其後項目位置會前移——兩者座標系不同，故不可能
 * 直接借用 `plan.nextSlots`，須另以 real-index 語意獨立推算，見該函式
 * 文件的座標系換算）。
 */
export function commitSegmentMove(movedId: string, target: DropTarget, beforeId?: string): void {
  const movedSeg = segmentConfigById.get(movedId)
  // T3.2（09-PLAN §D3 A-1「enable-into-target」，本 sprint 唯一 Critical
  // 級設計 C1）：拖入一個**停用中**的段——語意是「純插入」（無來源列可
  // 耗盡）非「移動」，走專用分支（見 commitEnableIntoTarget）。已啟用段
  // 走下方原路徑，行為零變（本分支僅於 `!enabled` 時進入）。
  if (movedSeg !== undefined && !movedSeg.enabled) {
    commitEnableIntoTarget(movedId, target, beforeId)
    return
  }
  const plan = planSegmentMove(rowSlots, config.segments, movedId, target)
  const sourceRow = movedSeg !== undefined && movedSeg.enabled ? movedSeg.row ?? 0 : 0
  const srcDrains = !config.segments.some(
    (other) => other.id !== movedId && other.enabled && (other.row ?? 0) === sourceRow,
  )
  for (const id of plan.bumpIds) {
    const other = segmentConfigById.get(id)
    if (other !== undefined) other.row = (other.row ?? 0) + 1
  }
  rowSlots = plan.nextSlots
  config.rowSeparators = normalizeRowSeparatorsField(
    computeRowSeparatorsAfterMove(config.rowSeparators ?? [], target, plan.targetRow, sourceRow, srcDrains),
  )
  performCrossRowMove(movedId, plan.targetRow, beforeId)
}

/**
 * T3.2（09-PLAN §D3 A-1「enable-into-target seam」，本 sprint 唯一 Critical
 * 級設計 C1 落地核心）：`commitSegmentMove` 的**停用段**分支——拖入一個
 * 停用中的目錄段落到某列/暫存列時，語意是「純插入」（無來源列，故無
 * `srcDrains` 耗盡、無來源位縮併，bump 僅受 target 側影響）而非「移動」。
 *
 * C1 崩解根因（PLAN §D3 verbatim）：停用段不進列群組（row-groups.ts
 * `if (!seg.enabled) continue`），且 `setSegmentEnabled` 內部自呼
 * `commitConfig()` 並變異 `rowSlots`（clamp 落回既有列）——「先 enable 再
 * move」會經**兩段** commit，enable 中間態使 drop 當下捕捉的 slotIndex
 * stale、`planSegmentMove` 依假來源列算 drain/bump（空清單拖入唯一 pending、
 * 中間 pending 列兩情境落點錯亂）。故本分支採 T3.1 交付的
 * `markSegmentEnabledDeferred`（只設 `enabled=true`，不 clamp／不動 slots／
 * 不 commit）＋由本函式以 drop 當下的 target 一步到位定 row/slots，
 * **唯一一次** commit：
 * 1. defer-mark 啟用（`seg.enabled=true`；row 落點交步驟 2 的 seam 一步定，
 *    不經 `clampReenableRow` 中間態）。
 * 2. seam 決策 `planEnableIntoTarget`（enable-into-target.ts）——純插入，
 *    不含 `planSegmentMove` 的來源列耗盡步驟；bump 僅收「row ≥ targetRow」
 *    者。drop 目標的 slotIndex 於此同一同步事件內取用，不跨 relayout。
 * 3. 套 bump（`row +1`，原地 mutate 既有物件參照）／`rowSlots`／
 *    `rowSeparators`。rowSeparators 復用 `computeRowSeparatorsAfterMove`，
 *    但**純插入＝`srcDrains` 恆 false**（無來源列），故其只做 pending 側的
 *    `insertNullAtReal`、絕不觸發來源 `removeRealAt`；`sourceRow` 於
 *    `srcDrains=false` 時不被讀取（見該函式 `sameRowInsert` 閘），傳 0
 *    佔位。
 * 4. **唯一一次** `commitConfig`（於 `performCrossRowMove` 內；本函式他處
 *    不再 commit）＋播報「已加入」（T3.4：`performCrossRowMove` 的 origin
 *    參數傳 `'catalog-add'`——目錄拖入啟用語意上是「把段加入某列」，非
 *    「移動既有段」，見 `announceSegmentLanded` 文件）。`seg.row` 由
 *    `performCrossRowMove` 寫回 target。
 * 5. **唯一 commit 後**補跑啟用側 UI 同步 `syncSegmentEnabledUi`＋
 *    `syncFgOverrideDisabled`（round 2 收口，防 I4b 重演）——否則拖入
 *    啟用中的 powerline+bar 百分比段，其 fgOverride picker 停在停用當下的
 *    過期 disabled 態；左欄 checkbox／中欄啟用態亦賴此同步。呼叫序比照
 *    `setSegmentEnabled`（先 syncSegmentEnabledUi、後 syncFgOverrideDisabled），
 *    唯本分支兩者皆置於**唯一 commit 之後**（PLAN §D3 收口要求）。
 *
 * T3.3：目錄項 draggable 的 drop handler（落點側沿用中欄既有 handler，
 * 見 `wireCatalogDragAndDrop` 文件）直接呼叫 `commitSegmentMove(disabledId,
 * target, beforeId)` 即自動走本分支（`commitSegmentMove` 依 `!seg.enabled`
 * 自判），無需另接。已啟用目錄項被拖入時 `movedSeg.enabled` 為 true，
 * `commitSegmentMove` 走下方一般分支（非本函式）——即 A-3「已啟用目錄項
 * 被拖入＝退化為純 move」，由該自動分派天然達成，非本函式關注點。
 */
function commitEnableIntoTarget(movedId: string, target: DropTarget, beforeId: string | undefined): void {
  markSegmentEnabledDeferred(movedId)
  const plan = planEnableIntoTarget(rowSlots, config.segments, movedId, target)
  for (const id of plan.bumpIds) {
    const other = segmentConfigById.get(id)
    if (other !== undefined) other.row = (other.row ?? 0) + 1
  }
  rowSlots = plan.nextSlots
  // 純插入無來源列耗盡：srcDrains 恆 false（見上方文件步驟 3；sourceRow
  // 於 srcDrains=false 時不被讀取，傳 0 佔位）。
  config.rowSeparators = normalizeRowSeparatorsField(
    computeRowSeparatorsAfterMove(config.rowSeparators ?? [], target, plan.targetRow, 0, false),
  )
  performCrossRowMove(movedId, plan.targetRow, beforeId, 'catalog-add')
  // 唯一 commit 後補跑啟用側 UI 同步（round 2 收口，防 I4b 重演；見步驟 5）。
  syncSegmentEnabledUi(movedId, true)
  syncFgOverrideDisabled()
}

/**
 * T5.10（PLAN §排序與列指派 UX Rev 5「跨列 drop＝實際移動」）／T5.11
 * （Rev 6「拖曳統一插入制」，同列拖放亦改走本函式，targetRow＝原列）：
 * 拖放核心——computeCrossRowMove（row-groups.ts）→ 移動段 `row` 欄位
 * 原地寫回（segmentConfigById 既有物件參照，同 setSegmentEnabled／
 * applyRowNormalization mutate 慣例）＋整批寫回 config.segments（沿用
 * computeCrossRowMove 回傳之既有物件參照排列）→ commitConfig（分組偵測
 * 自然接手 DOM 搬移／select 刷新，見 layoutSegmentContainers）→ 播報
 * 「〈段名〉移至第 N 列第 M 位（共 K）」——同列插入與跨列移動共用同一
 * 播報格式，滿足 PLAN「播報沿用移動文案」。
 *
 * T3.4（09-PLAN §D3 A-3）：`origin` 參數選擇播報模板（見
 * `announceSegmentLanded` 文件）——預設 `'move'`，既有全部呼叫點
 * （中欄拖曳／select 指派／已啟用目錄項拖入）零改動；`commitEnableIntoTarget`
 * （目錄拖入停用段）顯式傳 `'catalog-add'`，播「已加入」。
 *
 * T5.14：rowSlots 已於呼叫端（commitSegmentMove）先行維護，commitConfig
 * 內 layoutSegmentContainers 依其重繪；播報之「第 N 列」須為**顯示編號**
 * ——computeCrossRowMove 回傳的 result.row 是 real 1-index，映射為 slot
 * 顯示編號 `slotIndexOfRealRow(rowSlots, result.row - 1) + 1`（rowSlots
 * 於 commit 前已更新，映射正確；formatMoveAnnouncement 本身不動）。
 *
 * 焦點策略（PLAN 要求「合理焦點處理」，拖曳為滑鼠操作，非鍵盤觸發）：
 * 刻意**不**額外 `.focus()` 任何節點——同列拖放交換（既有 performSwap
 * 呼叫路徑）本就不做此事、被搬移的 `<li>` 於 commitConfig 內以
 * appendChild 重新定位時瀏覽器原生不會使其失焦（如原本沒有焦點於其上，
 * 拖曳全程本就不涉及焦點；PLAN「重渲染＝節點重用」的顯式 re-focus
 * 條款針對的是鍵盤觸發的按鈕操作，見 moveSegment），故沿用既有拖放路徑
 * 慣例、不新增焦點管理。
 */
function performCrossRowMove(
  movedId: string,
  targetRow: number,
  beforeId: string | undefined,
  origin: 'move' | 'catalog-add' = 'move',
): void {
  const result = computeCrossRowMove(config.segments, movedId, targetRow, beforeId)
  const seg = segmentConfigById.get(movedId)
  if (seg !== undefined) seg.row = targetRow
  config.segments = result.segments
  commitConfig()
  const descriptor = DESCRIPTORS_BY_ID[movedId as SegmentId]
  announceSegmentLanded(origin, segLabel(descriptor.id), {
    ...result,
    row: slotIndexOfRealRow(rowSlots, result.row - 1) + 1,
  })
}

/**
 * T5.10／T5.14：**真實**列群組容器 `<ol>` 的「空白處」drop 目標——承接
 * PLAN「拖至列容器空白處＝落列尾」（UI 暫存空列 <div> 改由
 * wirePendingRowDrop 承接，見其文件；本函式僅掛在真實列 `<ol>` 上）。以
 * 冒泡事件委派：若拖放事件的實際目標（`event.target`）落在某個 `<li>`
 * 內，代表已由該 `<li>` 自身的 dragover／drop（wireDragAndDrop，含
 * `stopPropagation`）處理，本函式略過，避免同一次 drop 被處理兩次；gap
 * placeholder 自身亦接線獨立的 dragover／drop（見 ensureDropGap，含
 * `stopPropagation`），故指標停留於 gap 本身（如 li 級 dragover 已於中段
 * 插入 gap、指標仍在該可視區塊內）不會冒泡到此處被誤判為「空白處」而
 * 重置至列尾。`targetRow` 於呼叫端（createRowGroupContainer）以閉包捕捉
 * 之固定列號（＝real index）傳入——真實列容器位置終生穩定（見 rowIndexOfOl
 * 文件），故 targetRow 恆為呼叫當下的正確 real 列號，交 commitSegmentMove
 * 以 {kind:'real', row: targetRow} 提交。
 *
 * T5.11：dragover 期間於容器末端顯示插入點 gap placeholder（見
 * showDropGap）。
 *
 * T5.6 驗收修復（使用者裁決 2026-07-12）：「空白處＝落列尾」細化為——
 * 段間縫隙（`.segment-list` 的 flex gap 條帶，事件目標非任一 `<li>` 但
 * 落在其他段之間）依指標 Y 幾何解析插入點（與 li 級 `resolveDropSide`
 * 同一中線語意，見 `resolveBlankAreaInsertIndex`）；僅最末段中線以下的
 * 尾端空白（含拖曳中放寬的命中區）才真正落列尾。原邏輯對容器內全部
 * 非-li 目標一律視為列尾，使用者實測回報「拖一到兩個中間的黑區會預設
 * 到最後段，但拖到其他段上就 OK」——CDP 真機證實 gap 條帶
 * `elementFromPoint` 命中的正是容器本身。
 */
function wireRowContainerDrop(container: HTMLElement, targetRow: number): void {
  const isBlankAreaTarget = (event: Event): boolean =>
    draggingId !== null && (event.target as Element | null)?.closest('li') === null
  // dragover／drop 共用同一幾何解析：依指標 Y 對照當下各段 `<li>` 矩形
  // 中線，找出應插入之前的段（`null`＝落列尾 append）。`:scope > li.
  // segment-row` 天然排除 gap placeholder 本身（其 class 為
  // `segment-drop-gap`，非 `segment-row`）；**刻意不排除**被拖曳段自身
  // 的 `<li>`（拖曳期間它仍在原位佔版面，幾何需與使用者所見一致）——
  // `beforeNode` 恰為被拖曳段時，`performCrossRowMove` 內
  // `computeCrossRowMove` 之 `beforeId === id` 分支已安全退化為「維持
  // 原位、不重排」。暫存空列 `<div>` 容器無 `li.segment-row` 子節點 →
  // 恆回傳 `null` → 落列尾語意不變。
  const resolveBeforeNode = (event: DragEvent): HTMLLIElement | null => {
    const lis = [...container.querySelectorAll<HTMLLIElement>(':scope > li.segment-row')]
    const idx = resolveBlankAreaInsertIndex(
      event.clientY,
      lis.map((li) => {
        const rect = li.getBoundingClientRect()
        return { top: rect.top, height: rect.height }
      }),
    )
    return idx === null ? null : lis[idx]
  }
  container.addEventListener('dragover', (event) => {
    if (!isBlankAreaTarget(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    showDropGap(container, resolveBeforeNode(event), { kind: 'real', row: targetRow })
  })
  container.addEventListener('drop', (event) => {
    if (!isBlankAreaTarget(event)) return
    event.preventDefault()
    const movedId = draggingId!
    const beforeNode = resolveBeforeNode(event)
    endDragCleanup()
    commitSegmentMove(movedId, { kind: 'real', row: targetRow }, beforeNode?.dataset.segmentId)
  })
}

/**
 * T5.14（PLAN Rev 11「暫存列位置制」）：UI 暫存空列 `<div>` 容器的 drop
 * 目標——落此列＝於該 slot 位置指派真實列（見 commitSegmentMove pending
 * 分支）。暫存列每次重繪（renderPendingRowContainers）重新接線，`slotIndex`
 * 以閉包捕捉當下位置（重繪時以最新 slot 序重算，故閉包安全——暫存列
 * `<div>` 無承載狀態的段 `<li>`，整段重繪不違節點重用鐵律）。dragover
 * 顯示插入點 gap（暫存列無段 → beforeNode 恆 null＝落此列）；drop 交
 * commitSegmentMove（beforeId undefined＝該空列尾）。
 */
function wirePendingRowDrop(container: HTMLElement, slotIndex: number): void {
  container.addEventListener('dragover', (event) => {
    if (draggingId === null) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    showDropGap(container, null, { kind: 'pending', slotIndex })
  })
  container.addEventListener('drop', (event) => {
    if (draggingId === null) return
    event.preventDefault()
    const movedId = draggingId
    endDragCleanup()
    commitSegmentMove(movedId, { kind: 'pending', slotIndex }, undefined)
  })
}

// ── 排序（config.segments 同 row 子序列索引運算；同列限定） ──

/**
 * 同列交換核心：computeRowSwap（row-groups.ts，T5.5）→ 成功則整批寫回
 * config.segments（沿用既有物件參照，非新建/複製）→ commitConfig（既有
 * <li> 節點經 layoutSegmentContainers／assignSegmentsToContainers 之
 * appendChild 重新定位，非銷毀重建）→ 播報「〈段名〉移至第 N 列第 M 位
 * （共 K）」。回傳結果供呼叫端（moveSegment）另行 re-focus 觸發鈕；
 * null＝已在列首/列末（理論上鈕已 disabled 不會觸發，仍防禦返回）。
 */
function performSwap(id: string, direction: 'up' | 'down'): RowSwapResult | null {
  const result = computeRowSwap(config.segments, id, direction)
  if (result === null) return null
  config.segments = result.segments
  commitConfig()
  const descriptor = DESCRIPTORS_BY_ID[id as SegmentId]
  // T5.14：播報之「第 N 列」須為顯示編號——result.row 是 real 1-index，
  // 映射為 slot 顯示編號（同列交換不改 slots，但若上方有暫存空列則顯示
  // 編號與 real index 不同，故仍須映射）。formatMoveAnnouncement 本身不動。
  announceMove(
    formatMoveAnnouncement(
      segLabel(descriptor.id),
      {
        ...result,
        row: slotIndexOfRealRow(rowSlots, result.row - 1) + 1,
      },
      currentLocale(),
    ),
  )
  return result
}

function moveSegment(id: SegmentId, direction: 'up' | 'down'): void {
  const result = performSwap(id, direction)
  if (result === null) return
  // 移動的是同一元素、焦點自然保留；顯式再聚焦以防瀏覽器差異（PLAN
  // 「重渲染＝節點重用」節點重定位後 re-focus 觸發鈕之契約）。
  //
  // 邊界修正（PLAN §排序與列指派 UX Rev 9，2026-07-11 review 修訂）：段
  // 被移成列首/列末時，commitConfig（見 performSwap）已透過
  // refreshMoveButtonStates 把「觸發本次移動的同方向鈕」設 disabled——若
  // 仍聚焦該鈕會立即 blur 落 body（隨後對 disabled 鈕 .focus() 為
  // no-op）。改依 computeRowSwap 回傳的 1-index position/rowSize 判斷
  // 落點是否邊界（免查 DOM），是則改聚焦反方向鈕（邊界處必為 enabled，
  // 因 rowSize ≥ 2 才可能觸發 up/down——見 computeRowSwap 單段列回傳
  // null 的防禦）。
  const triggerLandedAtBoundary =
    (direction === 'up' && result.position === 1) ||
    (direction === 'down' && result.position === result.rowSize)
  const focusDirection = triggerLandedAtBoundary ? (direction === 'up' ? 'down' : 'up') : direction
  moveButtonElements.get(id)?.[focusDirection].focus()
}

/**
 * T2.5：全域接線——document 層擷取滑鼠/鍵盤模態，並於 focusin/focusout
 * 依旗標對段列（`.segment-row`）切換 `.row--reveal`（style.css 據此把
 * `.segment-row__move` 由收納 opacity:0 切為浮現 opacity:1，見該檔案
 * 「移位鈕橫排」規則區塊註解）。僅呼叫一次（init() 內），監聽器掛
 * document 全域、不隨列的建立/銷毀重綁——涵蓋動態渲染的段列。
 *
 * 模態判定：mousedown／pointerdown（capture 階段，確保早於目標元素自身
 * 的 focus 副作用）→ `'mouse'`；keydown 除純修飾鍵（Control/Alt/Shift/
 * Meta 單獨按下，尚未構成導覽意圖）外皆視為 `'keyboard'`（涵蓋契約所舉
 * Tab／方向鍵，亦含 Enter/Space 等，寬鬆判定不影響「滑鼠不浮現」核心
 * 保證）。
 *
 * 浮現/收合：focusin 冒泡至 document 時，以 event.target 就近找
 * `.segment-row` 祖先，依當下旗標切換其 `.row--reveal`（'keyboard' 加、
 * 'mouse' 移除）。focusout 時若新焦點（relatedTarget）不在同一列內（含
 * 焦點整個離開文件，relatedTarget===null），移除該列的 `.row--reveal`
 * ——move 操作觸發的重渲染＋程式化還焦（見 moveSegment 上方）依序觸發
 * focusout（若節點曾被搬移離開再插回）＋新的 focusin，旗標本身跨此過程
 * 不變（仍是觸發 move 當下的鍵盤模態），故浮現態延續（S3 (d) 實測對應
 * 行為，見 spikes/S3-RESULT.md D1 選型結論）。
 *
 * MAGI review 🟡-8：document 級冪等 guard，防重複掛監聽器。生產環境
 * `init()` 僅單次執行，本無害；但測試網（`*.dom.test.ts`）逐案
 * `vi.resetModules()` 後重新 `import('./main.js')` 觸發整條 init 鏈路
 * 重跑——**模組層旗標防不了這種累掛**：`vi.resetModules()` 讓模組重新
 * 求值，任何模組層 `let wired = false` 也隨之歸零，於是每個測試案都會
 * 對同一個共享 jsdom `document`（jsdom 環境下 `document` 是跨 import
 * 存活的單例，不隨模組快取重置而換新）再掛一份監聽器，線上累積。目前
 * 靠「同一事件會被所有累掛的監聽器重放、彼此語意相同」的巧合維持測試
 * 無害，並非設計保證。改用掛在 `document.documentElement.dataset` 的
 * marker——`document` 本身跨 `resetModules()` 存活，故此 marker 亦跨
 * epoch 存活，第二次以後的 `wireMoveRevealModality()` 呼叫直接
 * no-op；舊 epoch（前一次 import）閉包住的監聽器仍是函式作用域內的
 * 一般變數捕獲，繼續正確服務後續所有案次（同一份實作、同一組行為，
 * 沒有「舊快照」問題）。
 */
function wireMoveRevealModality(): void {
  if (document.documentElement.dataset.moveRevealWired === '1') return
  document.documentElement.dataset.moveRevealWired = '1'

  const MODIFIER_ONLY_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

  document.addEventListener(
    'mousedown',
    () => {
      inputModality = 'mouse'
    },
    true,
  )
  document.addEventListener(
    'pointerdown',
    () => {
      inputModality = 'mouse'
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (MODIFIER_ONLY_KEYS.has(event.key)) return
      inputModality = 'keyboard'
    },
    true,
  )
  document.addEventListener('focusin', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const row = target.closest<HTMLElement>('.segment-row')
    if (row === null) return
    row.classList.toggle('row--reveal', inputModality === 'keyboard')
  })
  document.addEventListener('focusout', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const row = target.closest<HTMLElement>('.segment-row')
    if (row === null) return
    const next = (event as FocusEvent).relatedTarget
    if (next instanceof Node && row.contains(next)) return
    row.classList.remove('row--reveal')
  })
}

/**
 * 列首/列末停用態同步（PLAN §排序與列指派 UX「段已是該列首/末時對應鈕
 * 停用」）：僅由 layoutSegmentContainers（分組/順序實際變動後）呼叫，
 * 依最新列群組之列內順序（segmentIds［0］＝列首、最後一個＝列末）逐段
 * 設定 disabled（維持可見，非 hidden）。與 row 分組無關的 commit（如
 * 改顏色）不觸發本函式（沿用 refreshRowSelects 同一收斂點慣例）。
 */
function refreshMoveButtonStates(groups: readonly RowGroup[]): void {
  for (const group of groups) {
    const ids = group.segmentIds
    for (let i = 0; i < ids.length; i++) {
      const handle = moveButtonElements.get(ids[i])
      if (handle === undefined) continue
      handle.up.disabled = i === 0
      handle.down.disabled = i === ids.length - 1
    }
  }
}

/**
 * 「刪除此列」鈕disabled 態同步（PLAN §排序與列指派 UX Rev 6「僅剩最後
 * 一個真實列時該鈕 disabled（維持可見，防清空）」）：僅由
 * layoutSegmentContainers（分組/順序實際變動後）呼叫，與 refreshMoveButtonStates
 * 同一收斂點——與 row 分組無關的 commit 不觸發本函式。
 */
function refreshRowDeleteButtons(): void {
  const disabled = rowGroupContainers.length <= 1
  for (const container of rowGroupContainers) {
    container.deleteTrigger.disabled = disabled
  }
}

/**
 * MAGI code review I-2（(internal design doc)
 * REVIEW.md，2026-07-12 使用者裁決「修」，「整列刪除 inline 確認態隨
 * 容器錯位復用殘留」）：**新不變量**——「確認刪除」的 inline 兩段式
 * 確認態**不跨 relayout 存活**。
 *
 * Root cause：`shrinkRowGroupContainers` 只從 `rowGroupContainers`
 * **末端**移除多餘容器；刪除非最後一列（或任何導致分組重排的操作，如
 * 拖曳／select 跨列移動）時，倖存容器（索引 < 新列數）的內容經
 * `assignSegmentsToContainers` 被**重新指派**成別的列——若某倖存容器的
 * 確認態原本已展開（trigger 隱、confirmGroup 顯），relayout 後其
 * 標題／label 雖經 `refreshRowNumbering` 刷成新列號，但「確認刪除」鈕
 * 仍是活體、仍會觸發 `performRowDeletion(index)`（`index` 為該容器閉包
 * 之固定渲染列序，其內容已換成別列）——形同「使用者本要刪 A 列、UI 卻
 * 對著已換成 B 列內容的確認鈕、稍後誤觸即刪掉 B 列」的一鍵誤刪陷阱。
 *
 * 修復：`layoutSegmentContainers` 每次呼叫皆對**全部**倖存容器復位確認
 * 態（純 DOM 態重設 hidden 屬性，不違節點重用鐵律——不銷毀任何節點、
 * 監聽器不重綁）。**焦點保全**：復位當下若 `document.activeElement`
 * 落在某個即將被隱藏的 confirmGroup 內（如確認框開著、使用者改以滑鼠
 * 拖曳觸發另一次 relayout），復位後把焦點移回該容器的 trigger（避免
 * 落 body——隱藏元素無法持有焦點，瀏覽器會將其 blur 至 body）。
 *
 * 與 `performRowDeletion` 焦點順序的相容性：本函式由
 * `layoutSegmentContainers`（`commitConfig` 內）呼叫，早於
 * `performRowDeletion` 尾端顯式 `addPendingRowEl.focus()`——縱使本函式
 * 於復位過程中挪動了焦點（如刪除列 A 導致容器 B 的確認態被復位＋回焦
 * 其 trigger），`performRowDeletion` 隨後的顯式回焦仍會覆蓋、最終落點
 * 正確為 `#add-pending-row`（不搶焦點）。
 */
function resetRowGroupDeleteConfirmStates(): void {
  for (const container of rowGroupContainers) {
    const confirmGroup = container.section.querySelector<HTMLElement>('.segment-row-group__delete-confirm')
    if (confirmGroup === null || confirmGroup.hidden) continue // 已是復位態，無需重複寫入 DOM。
    const wasFocusedInside = confirmGroup.contains(document.activeElement)
    setHidden(confirmGroup, true)
    setHidden(container.deleteTrigger, false)
    if (wasFocusedInside) container.deleteTrigger.focus()
  }
}

/**
 * T5.11（PLAN §排序與列指派 UX Rev 6「整列刪除」，confirm 鈕 click 觸發，
 * 見 wireRowDeleteButton）：確認後的批次刪除核心——computeRowDeletion
 * （row-groups.ts）取得該列全部段 id 集合，逐段 mutate `enabled=false`＋
 * syncSegmentEnabledUi（純視覺同步；**不**逐段呼叫 setSegmentEnabled／
 * **不**逐段 commitConfig，PLAN「批次路徑一次 commitConfig，避免 N 次
 * relayout」裁決）；批次完成後單次 commitConfig（分組偵測自然觸發該列
 * 容器銷毀，見 shrinkRowGroupContainers；左欄對應目錄項同步恢復可勾）
 * → 播報「第 N 列已刪除，M 個段已回到目錄」→ 焦點移至「新增一列」鈕
 * （#add-pending-row，恆存在；該列容器本身已隨 commitConfig 銷毀，無
 * 穩定的「前一列標題」可回焦，故選定此為落點——不落 body）。
 *
 * I4c 回歸修復（協調者續 T7.4，2026-07-15，I4 家族最後一個停用進入點——
 * grep 已證 main.ts 內僅 setSegmentEnabled／本函式兩處會停用段）：本函式
 * 逐段 mutate `enabled=false` 後與 setSegmentEnabled 同樣繞過
 * syncFgOverrideDisabled（見其呼叫處 I4b 註解）——批次刪除一列含
 * 「powerline 下已開 bar 的百分比段」時，該段進隱藏池後 fgOverride
 * picker 會停在刪除前（仍啟用時）同步的過期停用態。commitConfig 之後補
 * 一次 syncFgOverrideDisabled()（棄用回傳值、不 announceGlobal），與
 * setSegmentEnabled 的補法同構；置於 announceMove 之前或之後皆可（不同
 * live region，互不干擾），此處選擇之後、緊接 commitConfig，與
 * setSegmentEnabled 內的呼叫順序一致，便於對照閱讀。
 */
function performRowDeletion(rowIndex: number): void {
  const groups = computeRowGroups(config.segments)
  const info = computeRowDeletion(groups, rowIndex)
  if (info.segmentIds.length === 0 || info.isLastRow) return // 防禦：鈕已 disabled／列不存在，理論上不會觸發。
  // T5.14：整列刪除＝**真刪除**（壓縮語意，不留空列）——removeSlotAt 於該
  // 真實列的 slot 位置移除；播報之「第 N 列」用**刪除前**的顯示編號
  // （removeSlotAt 前計算）。
  const slot = slotIndexOfRealRow(rowSlots, rowIndex)
  const displayRow = slot + 1
  rowSlots = removeSlotAt(rowSlots, slot)
  // T1.7（09-PLAN §D1 A-3）：整列刪除＝真刪除，`rowSeparators[rowIndex]`
  // （若有）一併消滅、其後覆寫前移一格——`rowIndex` 即該列的 real index
  // （函式簽章本就以 real index 為單位，與 rowSeparators 索引基準同源）。
  config.rowSeparators = normalizeRowSeparatorsField(removeRealAt(config.rowSeparators ?? [], rowIndex))
  for (const id of info.segmentIds) {
    const seg = segmentConfigById.get(id)
    if (seg === undefined) continue
    seg.enabled = false
    syncSegmentEnabledUi(id, false)
  }
  commitConfig()
  syncFgOverrideDisabled() // I4c：批次停用後收斂 fgOverride picker 停用態；棄用回傳值，不播報。
  announceMove(msg().announce.rowDeleted(displayRow, info.segmentIds.length))
  addPendingRowEl.focus()
}

// ── 產物：三後端 emit → 填 <pre>／下載 Blob（BOM 規則） ──

function inferSettingsTarget(path: string): SettingsTarget {
  // 契約沉默處：index.html 無 target 選擇器 → 以腳本路徑副檔名推斷
  // （.ps1 → Windows PowerShell wrapper；否則 POSIX 直呼）。
  return /\.ps1\s*$/i.test(path) ? 'windows-powershell' : 'posix'
}

function updateDownload(anchor: HTMLAnchorElement, key: 'bash' | 'ps1' | 'settings', blob: Blob): void {
  const prev = downloadState[key]
  if (prev !== null) URL.revokeObjectURL(prev)
  const url = URL.createObjectURL(blob)
  downloadState[key] = url
  anchor.href = url
}

function refreshOutputs(): void {
  const bash = emitBash(config, DESCRIPTORS_BY_ID)
  const ps1 = emitPs1(config, DESCRIPTORS_BY_ID)
  const path = settingsPathEl.value.trim()
  const settings = emitSettings(config, {
    target: inferSettingsTarget(path),
    scriptPath: path === '' ? undefined : path,
  })

  lastOutputs.bash = bash
  lastOutputs.ps1 = ps1
  lastOutputs.settings = settings
  outputBashCodeEl.textContent = bash
  outputPs1CodeEl.textContent = ps1
  outputSettingsCodeEl.textContent = settings

  // 下載 Blob 編碼契約（PLAN 產生器契約 8；BOM 僅本通道適用，複製通道
  // 刻意不加，見 UTF8_BOM 常數 JSDoc 與 wireOutputActions 的 copy-ps1
  // 掛點註解）：
  // - .sh：無 BOM＋LF（emitBash 已 LF；Blob 以 UTF-8 編碼、不加 BOM）。
  // - .ps1：UTF-8 BOM（前置 U+FEFF → EF BB BF；PS 5.1 無 BOM 會以 ANSI
  //   誤讀原始碼致 CJK/glyph 毀損）；LF（emitPs1 已 LF）。
  // - settings.json：一般 UTF-8（無 BOM）。
  updateDownload(downloadBashEl, 'bash', new Blob([bash], { type: 'text/x-shellscript;charset=utf-8' }))
  updateDownload(downloadPs1El, 'ps1', new Blob([UTF8_BOM + ps1], { type: 'application/octet-stream' }))
  updateDownload(
    downloadSettingsEl,
    'settings',
    new Blob([settings], { type: 'application/json;charset=utf-8' }),
  )
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeConfig(config))
  } catch {
    // localStorage 不可用（私密模式／配額）→ 靜默降級，不阻斷編輯。
  }
}

// ── 重複提示（percent-reset variant × reset 獨立段同列，T5.2） ──

/**
 * T5.2（08-PLAN §5「`percent-reset` variant × reset 段同列並開重複
 * 提示」）：rate 段（`variant==='percent-reset'`）與其對映 reset 獨立段
 * （分工見 prefix-table.md：前者僅於百分比後方附註時刻 `(14:30)`，後者
 * 為獨立完整倒數 `↺2h (14:30)`）——兩者若同列並開，對使用者觀感即「同列
 * 出現兩次重置時間」，故提示告知（純告知性：不阻擋操作、不改寫
 * config）。
 */
const RESET_DUPLICATE_PAIRS: readonly { rateId: SegmentId; resetId: SegmentId }[] = [
  { rateId: 'rate-5h', resetId: 'reset-5h' },
  { rateId: 'rate-7d', resetId: 'reset-7d' },
]

/**
 * 目前判定為「重複中」的 pair 集合（以 rateId 為鍵）——供
 * checkDuplicateResetHints 判斷「本次是否為新出現」，避免每次
 * commitConfig 皆重播（同一 pair 狀態未變時 live region 不重複騷擾；同
 * fgOverrideDisabledIds 慣例，見其文件）。
 */
const duplicateResetPairIds = new Set<SegmentId>()

/** 重複提示句：分工說明語意（variant＝rate 段內附時刻；獨立段＝完整倒數）。 */
function duplicateResetHintMessage(rateLabel: string, resetLabel: string): string {
  return msg().announce.duplicateResetHint(rateLabel, resetLabel)
}

/**
 * 逐 pair 判定＋去重播報：僅由「非重複變重複」的轉場才推播提示句；持續
 * 重複或持續不重複皆不重播；重複→解除→再重複因 duplicateResetPairIds
 * 已移除鍵，會視為新出現而再次提示。由 commitConfig 統一呼叫——本 sprint
 * 內一切造成此狀態成立的操作（啟用段、改 variant、改列，含拖曳／
 * select／上下移鈕）終皆呼叫 commitConfig，單一收斂點即涵蓋全部觸發
 * 時機，不需逐一操作點各自判斷。
 *
 * I5 回歸修復（code review I5，T7.4）：`{ silent: true }`——僅更新
 * duplicateResetPairIds（判定＋seed），**不**推播訊息。供 init() 於載入
 * 存檔後呼叫一次：duplicateResetPairIds 為模組層級 Set，reload 後恆空，
 * 若不預先 seed，既有（reload 前即成立）的重複狀態會在「之後第一次任意
 * commitConfig」（可能與重複條件完全無關，如切某段顯示文字 checkbox）時
 * 才被誤判為「新出現」而播報——與使用者當下操作脫節。init() 本身不呼叫
 * commitConfig，故此處需獨立呼叫一次靜默版本；之後所有 commitConfig 觸發
 * 的呼叫（不傳 options，預設 silent=false）維持原播報語意不變。
 */
function checkDuplicateResetHints(options?: { silent?: boolean }): void {
  const silent = options?.silent === true
  const messages: string[] = []
  for (const pair of RESET_DUPLICATE_PAIRS) {
    const rate = segmentConfigById.get(pair.rateId)
    const reset = segmentConfigById.get(pair.resetId)
    const isDuplicate =
      rate !== undefined &&
      reset !== undefined &&
      rate.enabled &&
      reset.enabled &&
      rate.variant === 'percent-reset' &&
      (rate.row ?? 0) === (reset.row ?? 0)
    if (isDuplicate) {
      if (!duplicateResetPairIds.has(pair.rateId)) {
        duplicateResetPairIds.add(pair.rateId)
        if (!silent) {
          messages.push(duplicateResetHintMessage(segLabel(pair.rateId), segLabel(pair.resetId)))
        }
      }
    } else {
      duplicateResetPairIds.delete(pair.rateId)
    }
  }
  if (messages.length > 0) announceGlobal(msg().announce.join(messages))
}

/**
 * 任何 config 變動的統一收束：正規化列＋（僅分組實際變動時）同步列群組
 * UI →存檔＋刷預覽（controller 內部 resolve）＋刷三產物。
 *
 * T5.3（PLAN §D2 正規化接線）：commitConfig 寫回點先套用 normalizeRows
 * （applyRowNormalization，原地改寫既有物件的 row 欄位），再以
 * computeRowGroups／rowGroupsEqual 判斷分組是否實際變動——僅變動時才
 * 呼叫 layoutSegmentContainers（列群組容器生命週期＋跨容器搬移既有
 * <li>）；與 row 分組無關的 commit（如改顏色、前綴）分組結果不變，
 * 不觸發此段 DOM 重排（Rev 2 釘死：不得觸發全體刷新）。
 *
 * T5.14（PLAN Rev 11「暫存列位置制」）：rowSlots 已於各變異點
 * （commitSegmentMove／setSegmentEnabled／performRowDeletion）顯式維護，
 * 此處**不再**推斷收斂（T5.9 的 nextPendingRowCount 計數推斷法已廢止）；
 * layoutSegmentContainers 內以 reconcileRealSlots 作防禦收斂（理論上
 * no-op），並依 rowSlots 重繪暫存列容器＋刷新 select 枚舉／顯示編號。
 *
 * T5.14 追修（協調者 CDP 實證 S4，2026-07-12「重繪閘門缺口」）：僅以
 * `rowGroupsEqual` 判斷「是否需重繪」不足——**空列成真＋來源列同幀耗盡**
 * 可使 real slot 的淨數量抵銷、真實分組結構（segments 依 row 分組後的
 * 內容）前後完全相同，但 `rowSlots` 本身已變（如把某段自其唯一列指派入
 * 另一個既有空列：目標空列 real+1、來源列 real-1，兩者位置不同，
 * `rowGroupsEqual` 看不出來——分組數與各列段集合前後一致）。故重繪條件
 * 改為「分組實際變動 **或** slots 實際變動」雙閘門（`slotsEqual` 見
 * row-slots.ts；與 row 分組、slots 皆無關的 commit——如改顏色／前綴——
 * 兩者皆為 true，仍不觸發重繪，Rev 2「不觸發全體刷新」語意不變）。
 */
function commitConfig(): void {
  applyRowNormalization()
  const nextRowGroups = computeRowGroups(config.segments)
  if (!rowGroupsEqual(lastRowGroups, nextRowGroups) || !slotsEqual(rowSlots, lastRenderedSlots)) {
    layoutSegmentContainers(nextRowGroups)
  }
  persist()
  try {
    preview.setConfig(config)
    refreshOutputs()
  } catch (error) {
    // config 恆經清洗、prefix/分隔符已擋 PUA，理論上 resolve/emit 不拋；
    // 防禦性顯示以免整頁凍結。
    showError(msg().validation.unexpectedOutputError(error instanceof Error ? error.message : String(error)))
  }
  updateNoBoundaryHint() // segment 色／啟用態亦可能改變 D1 無邊界提示條件，逐次收束時一併重算。
  checkDuplicateResetHints() // T5.2：percent-reset variant × reset 段同列並開重複提示，逐次收束時一併判定。
  syncDefaultHintDims() // T2.2：任一欄位變動皆可能使其現值與預設之異同翻轉，逐次收束時一併同步淡化態。
}

// ── 全域控制 ──

/**
 * D1「全段預設色＋powerline＋無箭頭」無色塊邊界提示判定（PLAN §D1 條件
 * 表末句）：純函式（無 DOM），main.ts 無既有測試環境（無 jsdom/happy-dom
 * 依賴，import 會在模組頂層即執行 DOM query 而在 node 測試環境拋錯），
 * 依 task brief 裁決保留於 main.ts 內、以簡單易於肉眼核對為原則，不另立
 * 測試檔。條件：powerline 模式＋箭頭未開＋至少一個啟用中 segment＋
 * 全部啟用中 segment 皆為終端預設色（無啟用 segment 時空集合視為
 * 「無色塊可言」，不構成邊界問題，故排除）。
 */
function hasNoBoundaryRisk(cfg: BuilderConfig): boolean {
  if (cfg.mode !== 'powerline' || cfg.powerlineArrow) return false
  const enabled = cfg.segments.filter((seg) => seg.enabled)
  if (enabled.length === 0) return false
  return enabled.every((seg) => seg.color.kind === 'default')
}

/** 依 hasNoBoundaryRisk 顯隱提示節點（hidden 屬性，非 live region，見 index.html 註解）。 */
function updateNoBoundaryHint(): void {
  setHidden(powerlineNoBoundaryHintEl, !hasNoBoundaryRisk(config))
}

/**
 * 回傳值（T5.1，08-PLAN §5）：syncFgOverrideDisabled 本次呼叫「新停用」
 * 的段名清單——呼叫端（handleModeChange）用於併入 mode 切換播報；
 * syncGlobalControls（init／存檔載入路徑）呼叫時刻意棄用回傳值，因該
 * 路徑非使用者觸發的「切換」動作，不應播報。
 */
function applyModeConstraints(): string[] {
  const powerline = config.mode === 'powerline'
  powerlineArrowEl.disabled = !powerline // 箭頭選項僅 powerline 有意義。
  lastArrowCapEl.disabled = !powerline || !config.powerlineArrow // D1 gating：false 時 cap 本身無效，一併停用。
  separatorCustomEl.disabled = powerline // powerline 以箭頭轉場，停用自訂分隔符（D3）。
  applyRowSeparatorModeConstraints() // T1.7：逐列分隔符覆寫僅 plain 模式生效，比照本函式對全域控件的停用精神。
  updateNoBoundaryHint()
  return syncFgOverrideDisabled()
}

function syncGlobalControls(): void {
  modePlainEl.checked = config.mode === 'plain'
  modePowerlineEl.checked = config.mode === 'powerline'
  document.body.dataset.mode = config.mode

  if (config.separator.kind === 'preset') {
    separatorPresetEl.value = `preset:${config.separator.value}`
    setHidden(separatorCustomFieldEl, true)
    separatorCustomEl.value = ''
  } else {
    separatorPresetEl.value = 'custom'
    setHidden(separatorCustomFieldEl, false)
    separatorCustomEl.value = config.separator.value
  }

  powerlineArrowEl.checked = config.powerlineArrow
  lastArrowCapEl.checked = config.lastArrowCap
  applyModeConstraints()
}

function handleModeChange(nextMode: 'plain' | 'powerline'): void {
  config.mode = nextMode
  document.body.dataset.mode = nextMode
  // T5.1：切至 powerline 時，既有 bar 開啟中的段一併新停用 fgOverride
  // （syncFgOverrideDisabled 判定範圍，見其文件）——併入同一次
  // announceGlobal（多句以「；」相接）；切回 plain 時回傳恆空陣列（plain
  // 下 syncFgOverrideDisabled 之 shouldDisable 恆假，見其邏輯）。
  const newlyDisabledFg = applyModeConstraints()
  commitConfig()
  const messages = [msg().announce.modeSwitch(nextMode), ...newlyDisabledFg.map(fgOverrideDisabledMessage)]
  announceGlobal(msg().announce.join(messages))
  // T3.1（D4，回饋 #4）：不再奪焦至 segment-lists——radio 保持瀏覽器預設
  // 焦點（零跳動），SR 回饋改由上方 announceGlobal 承擔（訊息含模式名＋
  // 連帶停用清單）。
}

function wireGlobalControls(): void {
  modePlainEl.addEventListener('change', () => {
    if (modePlainEl.checked) handleModeChange('plain')
  })
  modePowerlineEl.addEventListener('change', () => {
    if (modePowerlineEl.checked) handleModeChange('powerline')
  })

  separatorPresetEl.addEventListener('change', () => {
    const value = separatorPresetEl.value
    if (value === 'custom') {
      setHidden(separatorCustomFieldEl, false)
      const result = validateUserText(separatorCustomEl.value)
      if (result.ok) {
        clearError()
        config.separator = { kind: 'custom', value: separatorCustomEl.value }
        commitConfig()
      } else {
        showError(msg().validation.fieldReject('separator', result.reason))
      }
      separatorCustomEl.focus()
    } else if (value.startsWith('preset:')) {
      clearError()
      config.separator = {
        kind: 'preset',
        value: value.slice('preset:'.length) as SeparatorPresetValue,
      }
      setHidden(separatorCustomFieldEl, true)
      commitConfig()
    }
  })

  separatorCustomEl.addEventListener('input', () => {
    const result = validateUserText(separatorCustomEl.value)
    if (!result.ok) {
      showError(msg().validation.fieldReject('separator', result.reason))
      return
    }
    clearError()
    config.separator = { kind: 'custom', value: separatorCustomEl.value }
    commitConfig()
  })

  powerlineArrowEl.addEventListener('change', () => {
    config.powerlineArrow = powerlineArrowEl.checked
    applyModeConstraints() // 連動 last-arrow-cap 停用態＋無邊界提示重算。
    commitConfig()
  })

  lastArrowCapEl.addEventListener('change', () => {
    config.lastArrowCap = lastArrowCapEl.checked
    commitConfig()
  })

  settingsPathEl.addEventListener('input', () => {
    refreshOutputs()
  })
}

function wirePreviewControls(): void {
  previewBgDarkEl.addEventListener('change', () => {
    if (previewBgDarkEl.checked) preview.setTheme('dark')
  })
  previewBgLightEl.addEventListener('change', () => {
    if (previewBgLightEl.checked) preview.setTheme('light')
  })
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="preview-scenario"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) preview.setScenario(radio.value as MockScenarioId)
    })
  }
}

async function copyOutput(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    announceOutput(msg().output.copied(label))
  } catch {
    announceOutput(msg().output.copyFailed(label))
  }
}

// ── T4.2：產出腳本 dialog（PLAN §D4 A-2，showModal＋顯式焦點管理） ──

/**
 * dialog 內第一個可聚焦元素的選取子——與原生 showModal 聚焦演算法採同一
 * 判準子集（button／連結／表單控件／顯式 tabindex，且排除 disabled／
 * tabindex="-1"）。找不到時退回 container 本身（同原生演算法「無可聚焦
 * 子孫則聚焦 dialog 自身」的 fallback）。
 */
const DIALOG_FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusFirstFocusable(container: HTMLElement): void {
  const target = container.querySelector<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)
  ;(target ?? container).focus()
}

/**
 * 開啟產出 dialog。`showModal()` 為首選（PLAN §D4 A-2 拍板取捨：真模態、
 * 頁面 inert、無法邊改 config 邊看產出碼——接受理由見 index.html 該節點
 * 註解）；`typeof .showModal === 'function'` 特徵偵測 fallback（僅設
 * `open` 屬性、非真模態）供 jsdom 與無 showModal 環境（如舊版 iOS
 * Safari）不炸——完整相容矩陣裁決留待 T4.4 spike，本處只求「不炸＋
 * 可測」，不逾越該任務範圍。
 *
 * 開啟前先保險重算一次 `refreshOutputs()`：config 若在上次開啟後有
 * 變動（含 `#settings-path` 改值），dialog 內容確保為最新。開啟後**顯式**
 * 聚焦 dialog 內第一個可聚焦元素——不依賴瀏覽器原生自動聚焦，理由：
 * (1) jsdom 未實作 showModal／原生聚焦演算法，測試需可測路徑；(2) 與下方
 * `close` 事件的顯式焦點還原對稱，行為不受瀏覽器實作差異影響。
 */
function openOutputDialog(): void {
  refreshOutputs()
  if (typeof outputDialogEl.showModal === 'function') {
    outputDialogEl.showModal()
  } else {
    outputDialogEl.setAttribute('open', '')
  }
  focusFirstFocusable(outputDialogEl)
}

/**
 * 關閉產出 dialog 的單一出口——「關閉」鈕點擊／backdrop click 皆呼叫本
 * 函式。`typeof .close === 'function'` 為真時原生 `close()` 本身即會
 * 觸發 `close` 事件（無需重複派送）；fallback 路徑（jsdom／無 showModal
 * 環境）手動移除 `open` 屬性後**顯式**派送一個 `close` 事件，確保與真實
 * 瀏覽器路徑走同一段焦點還原邏輯（見 `wireOutputDialog` 的 `close`
 * 監聽器），不分兩套行為。
 */
function closeOutputDialog(): void {
  if (typeof outputDialogEl.close === 'function' && outputDialogEl.open) {
    outputDialogEl.close()
  } else {
    outputDialogEl.removeAttribute('open')
    outputDialogEl.dispatchEvent(new Event('close'))
  }
}

/**
 * T4.2（PLAN §D4 A-2「關閉**顯式**還原焦點至『產出腳本』鈕（不依賴
 * 瀏覽器自動還原）」）：`close` 事件為**唯一**焦點還原出口——不分關閉
 * 來源（顯式「關閉」鈕／backdrop click／Esc 原生 cancel→close），三者
 * 皆統一在此還原，避免各自還原分岔出不同行為。backdrop click 關閉為
 * PLAN 未強制的選配功能（本 task 決策採用，見 T4.2 report「關鍵決策」）
 * ——僅在 `event.target === outputDialogEl` 時關閉（點擊落在 dialog
 * padding-box／backdrop，非任何子元素），避免點擊產出內容誤觸關閉。
 *
 * jsdom 無原生 showModal／close 事件實作，測試以
 * `outputDialogEl.dispatchEvent(new Event('close'))` 直接驅動本監聽器
 * （見 output-dialog.dom.test.ts），與真實瀏覽器路徑共用同一段邏輯。
 */
function wireOutputDialog(): void {
  outputDialogOpenEl.addEventListener('click', openOutputDialog)
  outputDialogCloseEl.addEventListener('click', closeOutputDialog)
  outputDialogEl.addEventListener('click', (event) => {
    if (event.target === outputDialogEl) closeOutputDialog()
  })
  outputDialogEl.addEventListener('close', () => {
    outputDialogOpenEl.focus()
  })
}

/**
 * T4.3（PLAN §D4 A-3）：skip-nav「跳至產出腳本」不再依賴已消失的
 * `#output-section` 錨點捲動，改為顯式聚焦「產出腳本」鈕
 * （`outputDialogOpenEl`）本身——skip 的目的是「到達控制項」，非
 * 「觸發」，故僅 `focus()`、**不**呼叫 `openOutputDialog()`。
 * `preventDefault()` 蓋掉 href 的原生錨點跳轉（href 保留
 * `#output-dialog-open` 僅作無 JS 環境的語意化備援，見 index.html
 * 該節點註解）。
 */
function wireSkipToOutput(): void {
  skipToOutputEl.addEventListener('click', (event) => {
    event.preventDefault()
    outputDialogOpenEl.focus()
  })
}

/**
 * T3.5（14-PLAN §D5 round-2 單一謂詞定稿）：教學帶狀態機接線。init 時依
 * `shouldShowTutorialBand()`（單一謂詞：顯示 ⟺ 讀值 !== SENTINEL，key
 * 缺失／讀取失敗／怪值皆顯示，fail-open）決定教學帶 `hidden`；「知道了」
 * 點擊 → `dismissTutorialBand()`（best-effort 寫入 sentinel）＋立即
 * `setHidden(el, true)`——寫入失敗仍隱藏本次（下次載入 fail-open 再現，
 * 見 tutorial-band.ts 檔頭「best-effort 讀寫」段）。隱藏走 `hidden` 屬性
 * （`setHidden` 既有慣例，同 T2.6 驗證過的 `[hidden]{display:none
 * !important}` 防禦；右欄單一捲動容器高度自然回收）。
 *
 * MAGI review 🟡-5（FOUC 修法，index.html `#tutorial-band-slot` 節點自身
 * 註解有完整論證）：index.html 靜態出貨態已預先帶 `hidden`（反轉自舊法
 * 「JS 才補掛」），故本函式起手式改為**依謂詞移除**——
 * `setHidden(el, !shouldShowTutorialBand())`：謂詞為真（該顯示）時傳入
 * `false` 移除 `hidden`；謂詞為假（已 dismiss）時傳入 `true` 維持
 * `hidden`（此時本為 no-op，因 HTML 已是 hidden 態，寫法統一沿用
 * `setHidden` 不特判）。此舉消解已 dismiss 使用者的冷載 FOUC 窗口。
 */
function wireTutorialBand(): void {
  setHidden(tutorialBandEl, !shouldShowTutorialBand())
  tutorialDismissEl.addEventListener('click', () => {
    dismissTutorialBand()
    setHidden(tutorialBandEl, true)
  })
}

// ── D8 行動版目錄收合（sprint 15 T3.3/T3.4；PLAN §D8；spikes/
// S-f-RESULT.md 11/11 實證＋「對 MS3 施工的具體建議」）──

/**
 * init 時的初始收合態決定＋回訪防閃動標記移除（S-f-RESULT.md「對 MS3
 * 施工的具體建議」1）。只在「<1100px 且謂詞為收合」時才把 HTML 出貨態
 * 的 `open` 收起，其餘一律維持出貨態的展開（PLAN §D8「首繪方向」
 * fail-open 方向，見 catalog-collapse.ts `isCatalogCollapsed()` 檔頭）。
 *
 * `js-init-pending` class 的移除**必須晚於**上一行完成——順序不可
 * 顛倒，否則會有一格「已展開」的畫面先閃過再收起（見 index.html
 * `<html class="js-init-pending">` 節點與 style.css「D8 行動版目錄
 * 收合」節防閃動規則的完整論證）。
 *
 * 呼叫點（sprint 15 code review 🟡-1）：`init()` 的**起手第一敘述**（已自
 * `wireCatalogCollapse()` 內前移，理由見 init() 上方註解）。本函式是正常
 * 路徑的移除點；init() 另有一道 `finally` 保險移除（冪等重複），涵蓋
 * 「日後有人在本呼叫之上插入會擲錯的程式碼」的假想敵。
 */
function applyInitialCatalogCollapseState(): void {
  if (isCatalogCollapsed()) {
    catalogCollapseDetailsEl.open = false
  }
  document.documentElement.classList.remove('js-init-pending')
}

/**
 * S-f-RESULT.md「平台坑：<summary> 點擊→open 翻轉的實測時序證據」：
 * Chromium 對 `<summary>` 點擊的預設動作（翻轉 `details.open`、派發
 * `toggle`）透過「queue an element task」非同步排入，晚於同一輪
 * microtask——`queueMicrotask` 讀到的是**翻轉前**的舊值，故改用雙
 * `requestAnimationFrame`（單一 rAF 實測已足夠，多一層是保險餘裕、
 * 成本可忽略，語意上更貼合「等這一輪畫面穩定後再讀」，見該檔「機制
 * 比較」節第 3 點）。
 *
 * 讀到翻轉後的值後才依 `details.open` 決定持久化 set／clear——本函式
 * 完全不掛任何 `toggle` 監聽器（機制 (a) summary-only，S-f-RESULT.md
 * 「機制比較」定案），故跨斷點強制展開/恢復（見下方
 * `wireCatalogBreakpointForcing`）的程式化 `details.open = …` 賦值天生
 * 不會被本函式誤判為使用者互動，不需要抑制旗標這層額外狀態。
 *
 * matchMedia 守衛：桌面態 `<summary>` 應 `display:none` 不可點擊，理論
 * 上不會觸發本函式；仍加守衛防禦極端情境（如斷點交界處的短暫可見）把
 * 桌面態互動誤寫為行動版偏好。`matchMedia` 特徵偵測比照
 * `wireBandHeightObserver` 慣例（typeof 早退，非拋錯）。
 */
function scheduleCatalogCollapsePersist(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (typeof matchMedia === 'undefined') return
      let mobile: boolean
      try {
        mobile = matchMedia(CATALOG_COLLAPSE_BREAKPOINT_QUERY).matches
      } catch {
        mobile = false
      }
      if (!mobile) return
      if (catalogCollapseDetailsEl.open) clearCatalogCollapsed()
      else setCatalogCollapsed()
    })
  })
}

/**
 * PLAN §D8「跨斷點強制展開／恢復」；S-f-RESULT.md 對 MS3 施工建議第 4
 * 點：單一 `matchMedia` change 監聽＋單一 `apply()` 函式——桌面態恆
 * 展開（不清除 localStorage 偏好）、行動版態依目前持久化偏好恢復，
 * 不需要為「強制展開」與「恢復收合」寫兩套邏輯。特徵偵測守衛比照
 * `wireBandHeightObserver`（typeof 早退＋try/catch）：`matchMedia`
 * 不可用時僅不掛跨斷點監聽，不影響 `applyInitialCatalogCollapseState`
 * 已決定的初始態。
 */
function wireCatalogBreakpointForcing(): void {
  if (typeof matchMedia === 'undefined') return
  try {
    const mql = matchMedia(CATALOG_COLLAPSE_BREAKPOINT_QUERY)
    const apply = (): void => {
      const desiredOpen = mql.matches ? !isCatalogCollapsed() : true
      if (catalogCollapseDetailsEl.open !== desiredOpen) {
        catalogCollapseDetailsEl.open = desiredOpen
      }
    }
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', apply)
    } else {
      // 舊版 API 後備（現行 Chromium 皆支援 addEventListener，此分支僅防禦）。
      mql.addListener(apply)
    }
  } catch {
    // 極舊環境（matchMedia 建構/掛載擲錯）：僅不掛跨斷點監聽，不影響
    // init 已決定的初始態。
  }
}

/**
 * T3.4 接線總覽：init() 呼叫本函式一次，依序完成①`<summary>` 持久化監聽
 * （click／keydown，機制 (a) summary-only）、②跨斷點強制展開/恢復監聽。
 * `keydown` 監聽 Enter／Space（Chromium 對 focus 中的 `<summary>` 按
 * Enter/Space 本就會觸發原生 `click`，此處為 S-f-RESULT.md 建議的防禦性
 * 重複，非必要但成本可忽略）。
 *
 * 初始態決定＋防閃動標記移除（`applyInitialCatalogCollapseState()`）原為
 * 本函式第一步，sprint 15 code review 🟡-1 已前移至 init() 起手——它零前
 * 置依賴，留在 init 倒數第二步會讓「init 半路擲錯」把行動版目錄鎖成 0
 * 高度（完整理由見 init() 上方註解）。index.html／style.css 的 D8 註解仍
 * 以「wireCatalogCollapse() 於 init()」描述該順序，語意（先定 open 態、
 * 後移除 class）不變、僅呼叫點上移。
 */
function wireCatalogCollapse(): void {
  catalogCollapseSummaryEl.addEventListener('click', () => scheduleCatalogCollapsePersist())
  catalogCollapseSummaryEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      scheduleCatalogCollapsePersist()
    }
  })
  wireCatalogBreakpointForcing()
}

function wireOutputActions(): void {
  copyBashEl.addEventListener('click', () => void copyOutput(lastOutputs.bash, msg().output.bashLabel))
  // sprint 12 review 裁決回退（見 UTF8_BOM 常數 JSDoc）：複製通道刻意
  // 不前置 BOM——三鈕 payload 一律用 lastOutputs 原文，行為一致（
  // copyOutput 本身仍是通用函式，不在裡面塞 ps1 特判）。
  copyPs1El.addEventListener('click', () => void copyOutput(lastOutputs.ps1, msg().output.ps1Label))
  copySettingsEl.addEventListener('click', () => void copyOutput(lastOutputs.settings, msg().output.settingsLabel))
}

// ── segment 清單建置 ──

/**
 * T5.9：完整控件列初始一律先掛進隱藏池（#segment-hidden-pool）——啟用段
 * 隨即由下方 layoutSegmentContainers（init() 內接於本函式之後呼叫）搬進
 * 其列群組，appendChild 為既有節點重定位，非二次建立。左欄目錄項的建置
 * 已分離為獨立函式 buildCatalogItems（見上，職責不重疊：本函式只建置
 * 中欄的重控件列）。
 *
 * T5.6（09-PLAN §D5 A-4「rebuild 中欄 segment rows」）：本函式除 init()
 * 首次呼叫外，語言切換五步序第 (2) 步（`handleLocaleSwitch`）亦會再次
 * 呼叫——**重繪**語意，非僅首次建置。初次呼叫時 `rowElements` 為空
 * Map，下方清除迴圈為 no-op；重繪時 `rowElements` 持有**上一輪**的舊
 * `<li>` 參照，這些節點此刻可能已被 `layoutSegmentContainers` 搬到列
 * 群組 `<ol>`（啟用段）而不在隱藏池內——僅清空隱藏池
 * （`segmentHiddenPoolEl.textContent = ''`）不會動到它們，若不顯式
 * `.remove()`，舊節點會與新建節點並存於文件樹（重複 id、`querySelector`
 * 命中順序不定，語言切換即無法追溯翻轉——實測即此問題）。故先於清空
 * 隱藏池／清 Map 之前，逐一 `.remove()` 舊 `rowElements` 之值（不論其
 * 現居何處），確保重繪後文件樹內每個 segment id 只有一份 `<li>`。
 */
function buildSegmentRows(): void {
  for (const li of rowElements.values()) li.remove()
  segmentHiddenPoolEl.textContent = ''
  rowElements.clear()
  defaultHintElements.clear()
  for (const seg of config.segments) {
    const descriptor = DESCRIPTORS_BY_ID[seg.id as SegmentId] as SegmentDescriptor | undefined
    if (descriptor === undefined) continue // 清洗後不應發生；防禦。
    const li = buildSegmentRow(seg, descriptor)
    rowElements.set(seg.id, li)
    segmentHiddenPoolEl.appendChild(li)
  }
  // T2.2：init() 依 T7.4/I5 慣例不呼叫 commitConfig（見其文件），故初始
  // 淡化態須於此顯式同步一次，之後每次 commitConfig 尾端接手（見其呼叫）。
  syncDefaultHintDims()
}

// ── 列群組容器（T5.3；啟用段依渲染列分組，PLAN §排序與列指派 UX） ──

/**
 * normalizeRows（T2.1，config.ts）套用：僅重寫 config.segments 內既有
 * SegmentConfig 物件的 row 欄位（原地 mutate，絕不整批替換陣列或物件
 * 參照）。各列 <li> 的事件監聽器閉包捕捉的正是 buildSegmentRows 逐元素
 * 遍歷 config.segments 時取得的物件參照；若改以 normalizeRows 回傳值
 * 整批取代 config.segments，閉包仍握著舊物件，後續互動（改色／前綴等）
 * 會寫壞已脫離 config.segments 的孤兒物件而非真正生效的設定。PLAN §D2
 * 「正規化落在 commitConfig() 寫回點直接改寫記憶體 config.segments[i].row」
 * 之字面即此意：改寫既有物件之欄位，非替換物件本身。
 */
function applyRowNormalization(): void {
  const normalized = normalizeRows(config.segments)
  for (let i = 0; i < config.segments.length; i++) {
    const seg = config.segments[i]
    const nextRow = normalized[i].row
    if (nextRow === undefined) delete seg.row
    else if (seg.row !== nextRow) seg.row = nextRow
  }
}

/**
 * T5.11（PLAN §排序與列指派 UX Rev 6「整列刪除」）：單一列群組標題旁
 * 「刪除此列」鈕接線——inline 兩段式確認（非原生 `confirm()`）：
 * trigger 顯示「刪除第 N 列」；click → 隱 trigger、顯 confirm/cancel
 * 鈕對，焦點移至「取消」（安全預設：確認刪除為破壞性動作，預設焦點落
 * 於非破壞性選項，避免使用者連按 Enter／方向鍵誤觸連續 click 觸發的
 * 焦點造成誤刪；此為本棒裁決之確認型式，理由：(a) 與全站零原生對話框
 * 慣例一致——此 codebase 未見任何 `confirm()`/`alert()` 用例，皆以既有
 * live region＋自訂 DOM 呈現互動回饋；(b) inline 型式的鍵盤/SR 焦點
 * 完全可控（顯式 .focus()），原生 confirm() 之焦點回歸行為則依瀏覽器
 * 而異、且會中斷/搶佔頁面自身的 live region 播報語境）＋播報確認提示。
 * confirm 鈕 click → performRowDeletion（批次停用＋單次 commit，見其
 * 文件）；cancel 鈕 click → 收合 confirm、trigger 復顯＋回焦 trigger
 * （不落 body）。`index` 為容器建立時的渲染列序閉包——容器位置終生
 * 穩定（見 rowIndexOfOl 文件），故此索引於容器存活期間恆正確，無需
 * 重新綁定。回傳 trigger 供 refreshRowDeleteButtons 同步 disabled 態
 * （僅剩最後一個真實列時停用，見其文件）。
 */
function wireRowDeleteButton(root: HTMLElement, index: number): HTMLButtonElement {
  const trigger = root.querySelector<HTMLButtonElement>('.segment-row-group__delete-trigger')!
  const confirmGroup = root.querySelector<HTMLElement>('.segment-row-group__delete-confirm')!
  const confirmBtn = root.querySelector<HTMLButtonElement>('.segment-row-group__delete-confirm-btn')!
  const cancelBtn = root.querySelector<HTMLButtonElement>('.segment-row-group__delete-cancel-btn')!
  // T5.14：trigger 文字／confirm・cancel aria-label 的「第 N 列」為**顯示
  // 編號**，隨 slots 變動——不於此烙定，交 refreshRowNumbering（每次 slots
  // 或分組變動後）以 slotIndexOfRealRow(rowSlots, index) 刷新。

  trigger.addEventListener('click', () => {
    if (trigger.disabled) return
    setHidden(trigger, true)
    setHidden(confirmGroup, false)
    cancelBtn.focus()
    // 點擊當下以 rowSlots 計算顯示編號（閉包持 real index，事件時查）。
    announceMove(msg().rowGroup.deleteConfirmPrompt(slotIndexOfRealRow(rowSlots, index) + 1))
  })
  cancelBtn.addEventListener('click', () => {
    setHidden(confirmGroup, true)
    setHidden(trigger, false)
    trigger.focus()
  })
  confirmBtn.addEventListener('click', () => performRowDeletion(index))

  return trigger
}

/**
 * 建立單一列群組容器（clone #segment-row-group-template；index＝渲染列序，
 * 0-index）。T5.10：`<ol>` 本身接線 wireRowContainerDrop（「列容器空白處」
 * drop 目標，targetRow 即此 index——容器一經建立位置終生穩定，見
 * rowIndexOfOl 文件）。T5.11：一併接線「刪除此列」鈕（見
 * wireRowDeleteButton）。
 */
function createRowGroupContainer(index: number): {
  section: HTMLElement
  ol: HTMLOListElement
  deleteTrigger: HTMLButtonElement
  separatorPresetEl: HTMLSelectElement
  separatorCustomFieldEl: HTMLElement
  separatorCustomEl: HTMLInputElement
} {
  const key = `row-group-${index}`
  const root = instantiateTemplate('segment-row-group-template', '__RID__', key)
  // T5.4（09-PLAN §D5 A-3 clone 時序）：clone 後立即套用目前語言——本模板
  // 尚無 data-i18n 標記（本任務示範面未含此模板，全量遷移留 T5.5），現階段
  // 為 no-op；下一行 heading 為動態組句（含數字），不改走 data-i18n（見
  // i18n-dom.ts 檔頭「A-4 中間態邊界」對此類動態組句的處理範圍）。
  applyI18n(root, currentLocale())
  root.querySelector<HTMLElement>('.segment-section__heading')!.textContent = msg().rowGroup.heading(index + 1)
  // T3.5：data-row-index 為顯示編號，與上一行 heading 文字同一組數值
  // （建立當下 index===顯示編號-1；容器存活期間隨後由 refreshRowNumbering
  // 依 rowSlots 同步，見其文件）——供 e2e 序數斷言，不必比對 i18n 文字。
  root.dataset.rowIndex = String(index + 1)
  const ol = root.querySelector<HTMLOListElement>('.segment-list')!
  wireRowContainerDrop(ol, index)
  const deleteTrigger = wireRowDeleteButton(root, index)
  const { separatorPresetEl, separatorCustomFieldEl, separatorCustomEl } = wireRowSeparatorControl(root, index)
  return { section: root, ol, deleteTrigger, separatorPresetEl, separatorCustomFieldEl, separatorCustomEl }
}

/**
 * T1.7（09-PLAN §D1「UI」）：單一列群組的逐列分隔符控件接線——結構與
 * change handler 皆比照全域分隔符控件（`wireGlobalControls` 內
 * `separatorPresetEl`／`separatorCustomEl` 兩段，見其文件），差異僅在
 * 多一個 `'inherit'` 選項（還原繼承，寫回 `null`）與寫回目標為
 * `config.rowSeparators[realIndex]`（經 `setRowSeparatorOverride`）而非
 * `config.separator`。`realIndex` 為容器建立時的閉包索引（終生穩定，見
 * `rowGroupContainers` 文件），與 `wireRowContainerDrop(ol, index)`／
 * `wireRowDeleteButton(root, index)` 同一 index 來源。
 */
function wireRowSeparatorControl(
  root: HTMLElement,
  realIndex: number,
): { separatorPresetEl: HTMLSelectElement; separatorCustomFieldEl: HTMLElement; separatorCustomEl: HTMLInputElement } {
  const separatorPresetEl = root.querySelector<HTMLSelectElement>('.segment-row-group__separator-preset')!
  const separatorCustomFieldEl = root.querySelector<HTMLElement>('.segment-row-group__separator-custom-field')!
  const separatorCustomEl = root.querySelector<HTMLInputElement>('.segment-row-group__separator-custom')!

  separatorPresetEl.addEventListener('change', () => {
    const value = separatorPresetEl.value
    if (value === 'inherit') {
      setHidden(separatorCustomFieldEl, true)
      separatorCustomEl.value = ''
      clearError()
      setRowSeparatorOverride(realIndex, null)
    } else if (value === 'custom') {
      setHidden(separatorCustomFieldEl, false)
      const result = validateUserText(separatorCustomEl.value)
      if (result.ok) {
        clearError()
        setRowSeparatorOverride(realIndex, { kind: 'custom', value: separatorCustomEl.value })
      } else {
        showError(msg().validation.fieldReject('separator', result.reason))
      }
      separatorCustomEl.focus()
    } else if (value.startsWith('preset:')) {
      clearError()
      setHidden(separatorCustomFieldEl, true)
      setRowSeparatorOverride(realIndex, {
        kind: 'preset',
        value: value.slice('preset:'.length) as SeparatorPresetValue,
      })
    }
  })

  separatorCustomEl.addEventListener('input', () => {
    const result = validateUserText(separatorCustomEl.value)
    if (!result.ok) {
      showError(msg().validation.fieldReject('separator', result.reason))
      return
    }
    clearError()
    setRowSeparatorOverride(realIndex, { kind: 'custom', value: separatorCustomEl.value })
  })

  return { separatorPresetEl, separatorCustomFieldEl, separatorCustomEl }
}

/** 列群組容器數量成長至 count（缺者於 #segment-row-groups 末端新建並掛載）。 */
function growRowGroupContainers(count: number): void {
  while (rowGroupContainers.length < count) {
    const container = createRowGroupContainer(rowGroupContainers.length)
    rowGroupContainers.push(container)
    segmentRowGroupsEl.appendChild(container.section)
  }
}

/**
 * 列群組容器數量收縮至 count：多餘容器（索引 ≥ count）由末端往前移除。
 * 呼叫此函式前應已完成 assignSegmentsToContainers（見下）——此時多餘
 * 容器的 <ol> 理論上已空（最新分組結果中已無該列）。仍防禦式「先搬離
 * 再移除」：若容器內意外仍有 <li>，先搬到仍存活的最後一列（無存活列
 * 則退隱藏池 #segment-hidden-pool，T5.9 起完整控件列的停用態歸屬，避免
 * 節點遺失於 document 樹外），再移除 <section>——絕不連 <li> 一併丟棄
 * （PLAN §列群容器生命週期）。
 */
function shrinkRowGroupContainers(count: number): void {
  while (rowGroupContainers.length > count) {
    const container = rowGroupContainers.pop()!
    let orphan = container.ol.firstElementChild
    while (orphan !== null) {
      const fallback = rowGroupContainers.at(-1)?.ol ?? segmentHiddenPoolEl
      fallback.appendChild(orphan)
      orphan = container.ol.firstElementChild
    }
    container.section.remove()
  }
}

/**
 * 依最新分組結果，把既有 <li>（rowElements 既有節點，非新建）搬移至
 * 目的容器：啟用段 → 對應列群組 <ol>；停用段 → 隱藏池
 * #segment-hidden-pool（T5.9 起取代原「其類別 <ol>」歸屬——完整控件列
 * 已不住目錄四類分區，四類分區改由 buildCatalogItems 建置的輕量目錄項
 * 佔用，見其文件；停用段不再區分類別，統一收入單一隱藏池）。呼叫前須已
 * growRowGroupContainers 到位（各列容器已存在，故
 * rowGroupContainers[group.row] 恆存在）。純節點重定位
 * （appendChild：node reuse，絕不銷毀重建）——保留內部接線／焦點／
 * 閾值編輯器展開態（純 DOM 態，不在 config），監聽器不重綁。
 *
 * sprint 15 T2.3 覆核（四區版面手術「隨遷」項）：兩個目的容器
 * （`#segment-row-groups` 內的列群組 <ol>／`#segment-hidden-pool`）皆
 * 以 id 取得，與它們**住在哪一欄**無關——列群組隨 #selected-section 遷入
 * 列區欄、隱藏池仍在 wrapper 之外，本函式**零改動**即正確。此即
 * S-h-RESULT.md 量到「62 檔測試意外倖存」的同一性質：節點查找不依賴
 * 父層路徑，手術只要守住「只搬不刪、id/class 全保留」就不連坐。
 */
function assignSegmentsToContainers(groups: readonly RowGroup[]): void {
  for (const group of groups) {
    const ol = rowGroupContainers[group.row]!.ol
    for (const id of group.segmentIds) {
      const li = rowElements.get(id)
      if (li !== undefined) ol.appendChild(li)
    }
  }
  for (const seg of config.segments) {
    if (seg.enabled) continue
    const li = rowElements.get(seg.id)
    if (li === undefined) continue
    // MAGI review 🟡-3：搬回隱藏池前先移除 `.row--reveal`——搬移
    // （appendChild）不觸發 focusout，若該列先前在鍵盤模態下浮現過，
    // class 會殘留在節點上；停用段重新啟用回列時會無焦點卻浮現，違反
    // 「預設收納」不變量（見 wireMoveRevealModality 文件，class 僅由
    // focusin/focusout 兩處維護，此處為隱藏池往返造成的第三個變異點）。
    li.classList.remove('row--reveal')
    segmentHiddenPoolEl.appendChild(li)
  }
}

/**
 * T5.4：把 row-select.ts 計算出的操作序列施作於既有 select 節點——原地
 * 更新／增補／裁剪 <option>，絕不重建 select 節點本身（S7 spike 實測：
 * 原地更新不搬焦點、不跳捲動、選取值不漂移；重建節點才會，故本函式
 * 不得使用 replaceChildren／innerHTML 整批替換）。
 */
function applyRowSelectOptionOps(select: HTMLSelectElement, ops: readonly RowSelectOptionOp[]): void {
  for (const op of ops) {
    if (op.kind === 'update') {
      const option = select.options[op.index]!
      option.value = op.value
      option.text = op.text
    } else if (op.kind === 'append') {
      const option = document.createElement('option')
      option.value = op.value
      option.text = op.text
      select.appendChild(option)
    } else {
      while (select.options.length > op.fromIndex) {
        select.remove(select.options.length - 1)
      }
    }
  }
}

/**
 * T5.4／T5.9／T5.14：依最新分組結果刷新每個啟用段的「顯示於第 N 列」
 * select——枚舉來源＝**rowSlots**（位置制，含中間空列；見 row-select.ts
 * rowSelectOptionsForSlots 文件：value＝slot index、pending 附「（新列）」
 * 字尾），以 computeRowSelectOptionOps 計算最小原地更新指令＋施作，並把
 * select 顯示值錨定為該段所在真實列的 slot index（`slotIndexOfRealRow`；
 * value 錨定，S7 已驗證安全）。只由 layoutSegmentContainers／暫存列增減
 * 路徑（wirePendingRowButton／removePendingRow）呼叫——與 row／slots 皆無
 * 關的 commit（如改顏色、前綴）不觸發，故不產生任何 select 刷新（PLAN
 * §D2 正規化接線 Rev 2 釘死）。停用段的 select 不在 groups 內、維持原狀
 * 不動（其 row 凍結，依 T5.3 雙區結構亦不可見）。
 */
function refreshRowSelects(groups: readonly RowGroup[]): void {
  for (const group of groups) {
    for (const id of group.segmentIds) {
      const select = rowSelectElements.get(id)
      if (select === undefined) continue
      const current: RowSelectOption[] = Array.from(select.options, (option) => ({
        value: option.value,
        text: option.text,
      }))
      // T5.14：枚舉來源＝rowSlots（位置制，含中間空列）；顯示值錨定為該段
      // 所在真實列的 slot index（group.row 為 real index）。
      // T5.5：穿入 currentLocale()——新建／更新的 option 文字跟隨當下語言
      //（切換時的追溯翻轉＝重跑本函式，屬 T5.6 五步序）。
      applyRowSelectOptionOps(select, computeRowSelectOptionOps(current, rowSlots, currentLocale()))
      select.value = String(slotIndexOfRealRow(rowSlots, group.row))
    }
  }
}

/**
 * T5.14（PLAN Rev 11「暫存列位置制」，取代 T5.9 計數制 renderPending-
 * RowContainers(count, rowCount)）：依 `slots`（位置制）重繪 UI 暫存空列
 * `<div>`——**插進 #segment-row-groups 內、正確位置**（可落在真實列
 * 之間），非另一獨立容器（#segment-pending-rows 已移除）。
 *
 * 節點重用鐵律不受影響：暫存列 `<div>` 恆不持有任何段 <li>（段一旦被
 * 指派入某暫存列即經 commitSegmentMove/commitConfig 收斂為真實渲染列、
 * 改由列群組 <section> 承載），故先移除既有全部 `.segment-pending-row`
 * 節點、再依 slots 逐個 pending slot 重繪，不違反該鐵律（其保護對象是
 * 承載狀態／監聽器的段 <li>）。真實列 <section> 彼此相對順序永不變
 * （grow 只在尾端 append、pending 每次整批重插），故 rowIndexOfOl 不受
 * 影響。
 *
 * 插入位置：pending slot s 之後的首個真實列 = 第 `realIndexOfSlot(slots, s)`
 * 個真實列容器（其 `.section`）；無（s 之後無真實列）→ 末端 append
 * （insertBefore(..., null)）。標題／刪除鈕 label 為 slot 顯示編號
 * 「第 s+1 列」；drop 接線 wirePendingRowDrop(root, s)（閉包持當下 slot
 * 位置，重繪即重算，安全）。
 */
function renderPendingRowContainers(slots: readonly RowSlot[]): void {
  for (const existing of segmentRowGroupsEl.querySelectorAll('.segment-pending-row')) {
    existing.remove()
  }
  for (let s = 0; s < slots.length; s++) {
    if (slots[s] !== 'pending') continue
    const root = instantiateTemplate('segment-pending-row-template', '__PRID__', `pending-row-${s}`)
    root.querySelector<HTMLElement>('.segment-section__heading')!.textContent = msg().rowGroup.heading(s + 1)
    root.dataset.rowIndex = String(s + 1) // T3.5：e2e 序數斷言錨點，同步於 heading 文字。
    const deleteBtn = root.querySelector<HTMLButtonElement>('.segment-pending-row__delete')!
    deleteBtn.textContent = msg().rowGroup.deleteRow(s + 1)
    deleteBtn.addEventListener('click', () => removePendingRow(s))
    wirePendingRowDrop(root, s)
    const before = rowGroupContainers[realIndexOfSlot(slots, s)]?.section ?? null
    segmentRowGroupsEl.insertBefore(root, before)
  }
}

/**
 * T5.14（PLAN Rev 11「暫存列刪除鈕點哪刪哪」，修正 T5.9 計數制「移除最高
 * 編號」怪癖）：暫存空列刪除鈕——removeSlotAt 於**被點擊者的 slot 位置**
 * 移除（純 UI 態、免確認），非「暫存池計數 -1／編號最大者消失」。重繪
 * 暫存列容器＋刷新 select 枚舉＋刷新顯示編號（中間空列被刪會使其下真實
 * 列的顯示編號上移一位）→ 播報「空列已移除」→ 焦點移至「新增一列」鈕
 * （不落 body；同 wirePendingRowButton 慣例）。
 */
function removePendingRow(slotIndex: number): void {
  if (rowSlots[slotIndex] !== 'pending') return // 防禦：只刪 pending slot。
  rowSlots = removeSlotAt(rowSlots, slotIndex)
  renderPendingRowContainers(rowSlots)
  refreshRowSelects(lastRowGroups)
  // T5.14：刪除「中間」空列會使其下方真實列的 slot 位置前移一格、顯示
  // 編號連動變化（見 refreshRowNumbering 文件），故本路徑須呼叫；同時本
  // 函式不經 commitConfig／layoutSegmentContainers（純 UI 態直接重繪），
  // 須自行同步「已渲染」基準，否則後續 commitConfig 的 slotsEqual 閘門
  // 會誤判「slots 未變」而漏重繪（協調者 CDP 實證 S4 追修同一 root cause
  // 類型——凡繞過 layoutSegmentContainers 逕改 rowSlots 的路徑皆須此步）。
  refreshRowNumbering()
  lastRenderedSlots = rowSlots
  announceMove(msg().announce.emptyRowRemoved)
  addPendingRowEl.focus()
}

/**
 * T5.14：顯示編號全面同步（新 helper）——每次 slots 或分組變動後，把每個
 * 真實列 `<section>` 標題／「刪除第 N 列」鈕 label／確認鈕對 aria-label
 * 更新為**顯示編號**（slotIndexOfRealRow(rowSlots, i)+1，i＝該容器 real
 * index＝rowGroupContainers 位置，終生穩定）。中間暫存列會把其下真實列
 * 的顯示編號往後推，故不能沿用建立時烙定的 index+1。
 */
function refreshRowNumbering(): void {
  for (let i = 0; i < rowGroupContainers.length; i++) {
    const container = rowGroupContainers[i]
    const displayRow = slotIndexOfRealRow(rowSlots, i) + 1
    container.section.dataset.rowIndex = String(displayRow) // T3.5：e2e 序數斷言錨點，同步於 heading 文字。
    const heading = container.section.querySelector<HTMLElement>('.segment-section__heading')
    if (heading !== null) heading.textContent = msg().rowGroup.heading(displayRow)
    container.deleteTrigger.textContent = msg().rowGroup.deleteRow(displayRow)
    const confirmBtn = container.section.querySelector<HTMLButtonElement>(
      '.segment-row-group__delete-confirm-btn',
    )
    const cancelBtn = container.section.querySelector<HTMLButtonElement>(
      '.segment-row-group__delete-cancel-btn',
    )
    if (confirmBtn !== null) confirmBtn.setAttribute('aria-label', msg().rowGroup.deleteConfirmAria(displayRow))
    if (cancelBtn !== null) cancelBtn.setAttribute('aria-label', msg().rowGroup.deleteCancelAria(displayRow))
  }
}

/**
 * 列群組容器生命週期＋跨容器搬移的統一入口（T5.14 呼叫順序，見 TASKS.md
 * §layoutSegmentContainers）：成長容器→搬移既有 <li>→收縮多餘容器→
 * 復位「刪除此列」inline 確認態（I-2，見 resetRowGroupDeleteConfirmStates
 * 文件「確認態不跨 relayout 存活」新不變量）→reconcile slots（防禦收斂，
 * 理論上 no-op）→依 slots 重繪暫存列容器（插進 #segment-row-groups 正確
 * 位置）→刷新每段 select→刷新顯示編號→移位鈕／刪除鈕狀態，並更新
 * lastRowGroups（供下次 commitConfig 分組變動偵測之比較基準）。真實列
 * <section> 彼此相對順序永不變（grow 只在尾端 append、pending 每次整批
 * 重插），不違「容器位置終生穩定」invariant，rowIndexOfOl 不受影響。
 * commitConfig 僅於偵測到分組實際變動（rowGroupsEqual 為 false）時呼叫
 * 本函式；init() 於 buildSegmentRows 後亦呼叫一次。
 */
function layoutSegmentContainers(nextGroups: RowGroup[]): void {
  growRowGroupContainers(nextGroups.length)
  assignSegmentsToContainers(nextGroups)
  shrinkRowGroupContainers(nextGroups.length)
  resetRowGroupDeleteConfirmStates() // I-2：倖存容器可能已被重新指派內容，確認態不得跨 relayout 存活。
  rowSlots = reconcileRealSlots(rowSlots, nextGroups.length) // 防禦收斂（各變異點已顯式維護，理論上 no-op）。
  renderPendingRowContainers(rowSlots)
  refreshRowSelects(nextGroups)
  refreshRowNumbering() // T5.14：真實列標題／刪除鈕顯示編號隨 slots 同步。
  refreshRowSeparatorControls() // T1.7：容器 real index 可能因 real-slot 增減而對應到不同覆寫值，同步顯示。
  refreshMoveButtonStates(nextGroups) // T5.5：列首/列末停用態隨分組/順序變動同步。
  refreshRowDeleteButtons() // T5.11：僅剩最後一個真實列時「刪除此列」鈕 disabled。
  lastRowGroups = nextGroups
  // T5.14 追修：與 lastRowGroups 同點更新「已渲染」基準（純值快照，非同一
  // 參照——後續 rowSlots 被其他變異點重新賦值不影響此快照）。
  lastRenderedSlots = rowSlots
}

// ── 語言切換（T5.6 五步序；09-PLAN §D5 A-4） ──

/**
 * 語言切換鈕 click 後、`initLangToggle` 完成第 (1) 步（`persistLocale`＋
 * `applyI18n(document,next)`，見 i18n-dom.ts）之後呼叫的 hook——接續五
 * 步序第 (2)-(5) 步：
 *
 * (2) rebuild 中欄 segment rows（`buildSegmentRows`——重跑一次性
 *     aria/label 賦值最可靠的路徑，round 2 釘死「不涉段列焦點保全」：
 *     切換由語言鈕觸發，焦點在鈕上不在段列）＋`layoutSegmentContainers`
 *     重新分組佈局（直接呼叫、不經 `commitConfig` 的 rowGroupsEqual 閘門
 *     ——rebuild 產出全新 `<li>` 節點，即使分組結構未變也必須重新掛載，
 *     比照 init() 首次佈局的無條件呼叫）＋`syncFgOverrideDisabled`（新
 *     picker 節點須重新同步 disabled 態，同 init() 經 syncGlobalControls
 *     間接呼叫的精神；棄用回傳值、不 announceGlobal——非本次操作播報
 *     主體，同 setSegmentEnabled 呼叫處慣例）＋刷新左欄目錄項名
 *     （`refreshCatalogNames`，見其文件）＋刷新左欄目錄項樣例值／
 *     fallback 文案（T3.4，14-PLAN §D2′：`refreshCatalogHints`，見其
 *     文件——`getSampleValue` 內部 lazy per-locale 快取，改傳新 locale
 *     即自然重建該 locale 的快取，呼叫端不需另外失效）；
 * (3) 強制 preview 重 resolve 一次（`preview.setLocale`，刷新逐列
 *     aria-label／外層群組 label，見 render-preview.ts `setLocale` 文件）；
 * (4) `<html lang>` 翻轉（`syncHtmlLang`——PLAN 明訂排在 rebuild／preview
 *     重 resolve 之後，故不在 i18n-dom.ts 的第 (1) 步內完成）；
 * (5) 以**切換後語言**經 `#global-live-status` 播報新語言名稱
 *     （2026-07-17 拍板；此刻 `msg()`／`currentLocale()` 已因
 *     `persistLocale` 完成而讀到 `next`——`msg().langToggle.
 *     switchedAnnounce` 為自我指涉句、無需插值，見其文件）。
 *     `announceGlobal` 單一 live region、後寫覆前寫（見其文件），連續
 *     切換多次無殘留疊字，天然冪等。
 *
 * 不 mutate `config`／`rowSlots`——純視圖重繪：`layoutSegmentContainers`
 * 內部僅依現有 `config.segments`／`rowSlots` 重新分組與重排容器，兩者
 * 本身皆不被本函式改寫（語言切換不改變任何使用者設定狀態）。
 */
function handleLocaleSwitch(next: Locale): void {
  buildSegmentRows()
  layoutSegmentContainers(computeRowGroups(config.segments))
  syncFgOverrideDisabled()
  refreshCatalogNames()
  refreshCatalogHints()
  preview.setLocale(next)
  syncHtmlLang(next)
  announceGlobal(msg().langToggle.switchedAnnounce)
}

/**
 * T5.9／T5.14（PLAN §D3-R4「新增一列」／Rev 11「位置制」）：中欄頂部單一
 * 「＋ 新增一列」按鈕的接線——純 UI 狀態變動（appendPendingSlot：末端追加
 * 一個 pending slot），**不**呼叫 commitConfig（沒有任何 config 欄位變動；
 * config 恆無空列）。直接重繪暫存列容器＋刷新所有啟用段的 select 枚舉
 * （沿用目前 lastRowGroups，本次分組不變）。末端追加不改真實列顯示編號，
 * 故不需 refreshRowNumbering。事件處理後顯式回焦本按鈕（同 moveSegment／
 * setSegmentEnabled 慣例）。
 */
function wirePendingRowButton(): void {
  addPendingRowEl.addEventListener('click', () => {
    rowSlots = appendPendingSlot(rowSlots)
    renderPendingRowContainers(rowSlots)
    refreshRowSelects(lastRowGroups)
    // T5.14：本函式不經 commitConfig／layoutSegmentContainers（純 UI 態
    // 直接重繪），須自行同步「已渲染」基準，否則後續 commitConfig 的
    // slotsEqual 閘門會誤判「slots 未變」而漏重繪（見 removePendingRow
    // 同註解）。末端追加 pending 不改變任何既有真實列的 slot 位置／顯示
    // 編號，故不需 refreshRowNumbering。
    lastRenderedSlots = rowSlots
    addPendingRowEl.focus()
  })
}

// ── 頂帶高度變數 `--band-h`（sprint 15 T2.3；PLAN §D6／§D2） ──

/**
 * 上次寫入的 `--band-h` 整數 px 值——RO 回呼的**去重**基準（S-a 三項
 * 防護 (a) 的後半：四捨五入後值未變就不寫）。寫入本身會改動樣式，若不
 * 去重，子像素抖動足以讓「寫入 → 版面重算 → RO 再觸發」形成迴圈。
 */
let lastBandHeightPx: number | null = null

/**
 * sprint 15 T2.3（PLAN §D6；spikes/S-a-RESULT.md「七」3；
 * S-e-RESULT.md〈定案修法〉步驟 2）：量測預覽頂帶（`#preview-section`）
 * 的當下渲染高度、四捨五入後寫入 **`<main>` 元素**的 `--band-h`
 * ——style.css 中目錄欄／列區的 `top` 與 `max-height: calc(100dvh -
 * var(--band-h))` 是它唯一的消費點。
 *
 * 三件刻意為之：
 * 1. **變數掛 `<main>`、不掛 `:root`**（S-a 三項防護 (b)）：作用域限縮
 *    在真正消費它的子樹，也避免每次回寫都碰 documentElement 的樣式。
 * 2. **`Math.round` 去重**（防護 (a)）：見 `lastBandHeightPx`。
 * 3. **一次性同步呼叫，獨立於 RO 回呼**（S-e 定案修法步驟 2，比照 sprint
 *    14 頁首高度變數那套已作廢的一次性寫入模式）：jsdom 無
 *    `ResizeObserver`，下方
 *    `wireBandHeightObserver()` 的特徵偵測守衛會整段跳過、回呼永不執行
 *    ——若把寫入只掛在回呼上，`--band-h` 在 jsdom 下恆缺席，版面 dom 案
 *    連「初始值正確」都測不到。故 init() 直接呼叫本函式一次，RO 只負責
 *    「之後變動時」的追蹤式更新。
 *
 * 缺 `<main>` 節點時 no-op（防禦性；index.html 固定骨架恆有 `<main>`，
 * 但本函式亦被 RO 回呼於任意時點呼叫，不值得為此拋錯中斷）。
 */
function syncBandHeight(): void {
  const mainEl = document.querySelector<HTMLElement>('main')
  if (mainEl === null) return
  const height = Math.round(previewBandEl.getBoundingClientRect().height)
  if (height === lastBandHeightPx) return
  lastBandHeightPx = height
  mainEl.style.setProperty('--band-h', `${height}px`)
}

/**
 * sprint 15 T2.3（PLAN §D6 RO 路徑；S-e-RESULT.md〈定案修法〉步驟 1）：
 * 以 `ResizeObserver` 追蹤頂帶高度變動。
 *
 * 為何非得 JS 量測（S-a-RESULT.md「四」實測否決 D6 的「CSS 原生」
 * 傾向）：頂帶高度有兩條獨立變動軸——終端框列數 1–5（桌面變動 81.6px／
 * 行動 76.4px）與 viewport 寬造成的控制列換行（390px 寬即使 1 列也比
 * 桌面 3 行基準高 69.2px）；任何 CSS 固定值都必然在「遮蔽欄頭」與
 * 「G9 級垂直浪費」間二選一，且 CSS 無原生機制可讓 sticky 元素的 `top`
 * 動態繫結另一 sibling 的即時高度。
 *
 * 迴圈抑制（S-a 三項防護 (a)）：回呼內以 `requestAnimationFrame` **延後**
 * 寫入並以 `scheduled` 旗標合併同一幀內的多次觸發，實際寫入再經
 * `syncBandHeight()` 的四捨五入去重把關。（防護 (c) 的
 * `scrollbar-gutter: stable` 本批判定不需要，理由見 style.css 四區版面節
 * `--band-h` 註解。）
 *
 * 特徵偵測守衛（比照 `src/theme.ts` 對 `matchMedia` 的惰性＋try/catch
 * 慣例）：`typeof` 早退涵蓋「壓根沒有這個全域」（jsdom：17 個以
 * `await import('./main.js')` 啟動 init() 的測試檔會整批 ReferenceError，
 * S-e 實測 82 案紅），try/catch 涵蓋「有全域但建構擲錯」的極舊環境。
 * 兩者皆靜默降級為「只有初始同步值、不追蹤變動」——欄的 `top`／
 * `max-height` 仍有可用值，不會塌成無版面。
 */
function wireBandHeightObserver(): void {
  if (typeof ResizeObserver === 'undefined') return
  try {
    let scheduled = false
    const observer = new ResizeObserver(() => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        syncBandHeight()
      })
    })
    observer.observe(previewBandEl)
  } catch {
    // 極舊環境（ResizeObserver 已標準化逾 6 年，理論上不會發生）靜默降級。
  }
}

// ── 初始化 ──

/*
  sprint 15 code review 🟡-1（4 票；PLAN §D8 之 S-f 坑 1 語意校準——
  fail-open 承諾須覆蓋「init() 半路擲錯」，不只覆蓋 scripting 停用）：
  舊法把 `applyInitialCatalogCollapseState()` 留在 init 倒數第二步的
  `wireCatalogCollapse()` 內，其前十餘個 build*／wire* 任一擲錯就會讓
  `js-init-pending` 永遠留著、行動版目錄被暫抑樣式鎖成 0 高度（sprint 14
  無此暫抑，同情境目錄仍可見＝強健性倒退）。修法並用兩層：

  (a) 該呼叫前移至本函式**起手第一敘述**——它零前置依賴（只用模組層級
      早已查好的 `catalogCollapseDetailsEl` 與惰性謂詞
      `isCatalogCollapsed()`：前者於模組求值期 `byId()` 取得、失敗會在
      import 期就炸而根本進不了 init，後者只讀 localStorage／matchMedia，
      兩者皆不依賴任何 init 內的建置或接線步驟），故其後任何一步擲錯時，
      初始收合態都已**依使用者偏好正確決定**，非只是落回展開態。
  (b) 函式主體包 try/finally 作結構性保險：日後若有人在 (a) 之上插入會擲錯
      的程式碼，暫抑標記仍保證被移除。`finally` **只做 class 移除、不
      catch**——例外照常往外冒，維持既有可觀測性（e2e 的
      `Runtime.exceptionThrown` 哨兵仍抓得到）；`classList.remove` 對已移除
      的 class 是 no-op，正常路徑下這道保險純屬冪等重複。

  「先定初始 open 態、後移除 class」的防閃動順序封裝在
  `applyInitialCatalogCollapseState()` 內部，本修法未動（見該函式文件）。
*/
function init(): void {
  try {
    applyInitialCatalogCollapseState()
    let stored: string | null = null
    try {
      stored = localStorage.getItem(STORAGE_KEY)
    } catch {
      stored = null
    }
    // 讀取即以真 catalog 清洗（drop-unknown 續用、重整不丟）；無存檔→全停用預設。
    config = stored !== null ? deserializeConfig(stored, SEGMENT_CATALOG) : defaultConfig(SEGMENT_CATALOG)
    applyRowNormalization() // 存檔可能帶未正規化 row（如舊存檔／手改）；初始佈局前先歸一。
    // T5.9：id → SegmentConfig 物件參照查表，供左欄目錄 checkbox 的
    // setSegmentEnabled 直接 mutate（見其宣告處文件）。
    segmentConfigById = new Map(config.segments.map((seg) => [seg.id, seg]))

    preview = createPreview({
      container: previewTerminalEl,
      config,
      scenarioId: 'full',
      theme: 'dark',
      // T5.6：持久化 en 時開機即以 en 呈現（同其餘 T5.4 clone 點慣例，不需
      // 先手動切換一次）；bootLocale 為模組層級既算值（見上方語言啟動同步）。
      locale: bootLocale,
    })

    buildCatalogItems() // T5.9：左欄輕量常駐目錄，一次建置、永不重排。
    buildSegmentRows()
    // 初始佈局：把預設啟用段（若有）自隱藏池搬進其列群組；lastRowGroups
    // 起始值為空陣列，故本次呼叫恆執行（無論是否有啟用段）。
    // T5.14：初始 rowSlots＝初始渲染列數個 'real'（config 恆無空列，初始
    // 亦無暫存列）——須於 layoutSegmentContainers 前設定（reconcileRealSlots
    // 屆時為 no-op）。
    const initialGroups = computeRowGroups(config.segments)
    rowSlots = Array<RowSlot>(initialGroups.length).fill('real')
    layoutSegmentContainers(initialGroups)
    syncGlobalControls()
    // sprint 15 T2.3：兩欄 sticky `top`／`max-height` 所需的 `--band-h`——
    // 先做一次同步初始寫入（jsdom 下亦成立、可測），再掛 RO 追蹤後續變動
    // （終端框列數／viewport 寬換行）。順序不可對調：RO 的首次回呼是
    // 非同步的，初始值不能等它。
    syncBandHeight()
    wireBandHeightObserver()
    wireGlobalControls()
    wireMoveRevealModality() // T2.5：move 鈕收納/浮現模態旗標（document 層，見該函式文件）。
    wireSkipToOutput()
    wirePendingRowButton()
    wirePreviewControls()
    wireOutputActions()
    wireOutputDialog()
    wireTutorialBand() // T3.5：教學帶 dismiss 狀態機（見其自身文件）。
    wireCatalogCollapse() // sprint 15 T3.4：行動版目錄收合狀態機（見其自身文件）。
    refreshOutputs()
    // I5 回歸修復（code review I5，T7.4）：init() 不呼叫 commitConfig，故
    // duplicateResetPairIds 不會如常途經 checkDuplicateResetHints 收斂——
    // 靜默 seed 一次，讓存檔內既有的重複狀態於載入當下即被記為「已知」，
    // 之後只有真正的轉場（新形成的重複）才播報（見 checkDuplicateResetHints
    // 文件「I5 回歸修復」段）。刻意置於 refreshOutputs() 之後：與非 init
    // 路徑下 commitConfig 呼叫 checkDuplicateResetHints 的順序（產物刷新後）
    // 一致，僅播報行為不同。
    checkDuplicateResetHints({ silent: true })
  } finally {
    // 見上方註解 (b)：只保證解除暫抑，不吞任何例外。
    document.documentElement.classList.remove('js-init-pending')
  }
}

// deferred module 執行時 DOM 已解析；仍以 readyState 守衛使初始化嚴格於
// DOMContentLoaded 後（PLAN「DOMContentLoaded 起始」）。
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
