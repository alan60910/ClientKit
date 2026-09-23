/**
 * T5.3（(internal design doc) §排序與列指派 UX／
 * §D2 正規化接線）：依渲染列分組與分組變動偵測——DOM-free 純函式。
 *
 * 從 main.ts 抽出獨立成模組：main.ts 檔尾即執行 DOM query（`byId`／
 * `queryOne` 於模組頂層呼叫），import 該檔會在 node 測試環境（無
 * jsdom/happy-dom）立即拋錯，故無法對其內部函式直接單元測試。比照
 * render-preview.ts 的 buildPreviewSpec 先例，把「rows→分組」與「分組
 * 是否實際變動」這兩個決策抽成零 DOM 依賴的純函式模組，main.ts 於
 * commitConfig／init 內 import 使用（DOM 組裝——建立/銷毀列群組容器、
 * 搬移既有 <li>——留在 main.ts，只機械消費本模組的計算結果）。
 *
 * T5.2（(internal design doc) §D5 A-1；messages.ts 見
 * T5.1）：`formatMoveAnnouncement` 播報句形改由 `t(locale)` 注入，不再
 * 內嵌中文字面——`locale` 選填、預設 `DEFAULT_LOCALE`（'zh-Hant'），既有
 * 呼叫端（main.ts）零改動下繼續編譯且輸出不變；實際語言穿線（UI 切換
 * 帶動 locale 傳遞）留待 T5.5。
 */
import type { SegmentConfig } from './config.js'
import { DEFAULT_LOCALE, t, type Locale } from './messages.js'

/** 單一渲染列的分組結果（僅啟用段）。 */
export interface RowGroup {
  /** 渲染列序（0-index）。呼叫端應先對 segments 套用 normalizeRows（T2.1）
   * 使啟用段 row 值恆為連續 0..N-1；本函式僅依現有 row 值分組＋按其值
   * 升冪排序，不自行正規化、不 clamp。 */
  row: number
  /** 該列的段 id，依傳入 segments 陣列原順序（列內順序＝視覺順序＝陣列序）。 */
  segmentIds: string[]
}

/**
 * 依渲染列分組（純函式；僅納入啟用段——停用段不屬於任何列群組，由呼叫端
 * 另行歸屬四類分區）。分組鍵＝`seg.row ?? 0`（與 resolve.ts／normalizeRows
 * 同義：未指定 row 視同 0）。輸出依 row 值升冪排序；列內 id 順序＝輸入
 * 陣列中該列成員的相對順序（不重排）。
 */
export function computeRowGroups(segments: readonly SegmentConfig[]): RowGroup[] {
  const byRow = new Map<number, string[]>()
  for (const seg of segments) {
    if (!seg.enabled) continue
    const row = seg.row ?? 0
    const ids = byRow.get(row)
    if (ids === undefined) byRow.set(row, [seg.id])
    else ids.push(seg.id)
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, segmentIds]) => ({ row, segmentIds }))
}

/**
 * 兩次分組結果是否等價（純函式）：列數、各列 row 值、各列段 id 與其列內
 * 順序皆須完全相同。main.ts commitConfig 據此判斷是否需要重跑「row 相關
 * UI 同步」（列群組容器生命週期／跨容器搬移既有 `<li>`）——與 row
 * 分組無關的 commit（如改顏色、前綴）比較結果恆為 true，不觸發全體刷新
 * （PLAN §D2 正規化接線 Rev 2 釘死）。
 */
export function rowGroupsEqual(a: readonly RowGroup[], b: readonly RowGroup[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const groupA = a[i]
    const groupB = b[i]
    if (groupA.row !== groupB.row) return false
    if (groupA.segmentIds.length !== groupB.segmentIds.length) return false
    for (let j = 0; j < groupA.segmentIds.length; j++) {
      if (groupA.segmentIds[j] !== groupB.segmentIds[j]) return false
    }
  }
  return true
}

// ── 同列交換（T5.5；(internal design doc) §排序與 ──
// ── 列指派 UX「上／下移＝同列內交換」） ──

/**
 * `computeRowSwap` 的成功結果：交換後的新 `segments` 陣列＋播報所需的
 * 位置資訊（皆已轉為 1-index，對齊播報文案「第 N 列第 M 位（共 K）」）。
 */
export interface RowSwapResult {
  /**
   * 交換後的完整 `segments` 陣列——沿用輸入陣列中原有的物件參照（僅調整
   * 陣列內排列順序，不複製／不新建任何 SegmentConfig 物件），供呼叫端
   * 直接整批寫回 `config.segments`（main.ts commitConfig 慣例：closures
   * 捕捉的是既有物件參照，故本函式絕不替換物件本身，只換其陣列位置）。
   */
  segments: SegmentConfig[]
  /** 移動後所在渲染列（1-index，即播報文案之 N）。 */
  row: number
  /** 移動後於該列子序列內的新位置（1-index，即播報文案之 M）。 */
  position: number
  /** 該列段數（即播報文案之 K）。 */
  rowSize: number
}

/**
 * 上／下移＝「`config.segments` 中同 `row ?? 0` 子序列」的索引運算（PLAN
 * 契約：不再依賴 DOM 相鄰節點交換）——以 `computeRowGroups` 取得目標段
 * 所屬列的列內順序（僅啟用段；停用段回傳 `null`，因其不屬於任何列群組），
 * 找出該列子序列中與其相鄰（依方向）的段，交換兩者在**完整** `segments`
 * 陣列中的位置（兩者在完整陣列中未必相鄰——列與列的段可能交錯排列，
 * 故交換的是各自的絕對索引，而非陣列相鄰位置；同列其餘段、他列段的
 * 相對順序不受影響）。
 *
 * 段已是其列子序列首（`direction:'up'`）或末（`direction:'down'`）時
 * 回傳 `null`（呼叫端據此得知對應鈕應 `disabled`，同一資訊亦用於同步
 * 列首/列末停用態）。段不存在或未啟用（不屬任何列群組）時同樣回傳
 * `null`（防禦；正常互動下不會發生——上／下移鈕僅啟用列可見）。
 */
export function computeRowSwap(
  segments: readonly SegmentConfig[],
  id: string,
  direction: 'up' | 'down',
): RowSwapResult | null {
  const groups = computeRowGroups(segments)
  const rowIndex = groups.findIndex((group) => group.segmentIds.includes(id))
  if (rowIndex === -1) return null
  const group = groups[rowIndex]
  const idx = group.segmentIds.indexOf(id)
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= group.segmentIds.length) return null

  const otherId = group.segmentIds[targetIdx]
  const i = segments.findIndex((seg) => seg.id === id)
  const j = segments.findIndex((seg) => seg.id === otherId)
  const next = [...segments]
  next[i] = segments[j]
  next[j] = segments[i]

  return { segments: next, row: rowIndex + 1, position: targetIdx + 1, rowSize: group.segmentIds.length }
}

/**
 * 排序位置回饋播報文案（PLAN 契約：「〈段名〉移至第 N 列第 M 位（共
 * K）」）——純函式化以供單元測試；main.ts 呼叫 `announceMove` 時代入本
 * 函式輸出。`info` 接受 `RowSwapResult`（或其 `row`/`position`/`rowSize`
 * 子集，供拖曳等其他觸發路徑復用同一格式化邏輯而不必產生完整交換結果）。
 *
 * `locale`（T5.2 注入，選填、預設 `DEFAULT_LOCALE`）：句形取自
 * `messages.ts` 的 `t(locale).announce.move`，不再內嵌中文字面——不傳
 * 時輸出與既有中文字面完全一致（相容性硬約束）。
 */
export function formatMoveAnnouncement(
  label: string,
  info: Pick<RowSwapResult, 'row' | 'position' | 'rowSize'>,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(locale).announce.move(label, info.row, info.position, info.rowSize)
}

// ── 跨列移動（T5.10；(internal design doc) §排序與 ──
// ── 列指派 UX Rev 5「跨列 drop＝實際移動」，取代 Rev 2 之 accept-then- ──
// ── revert-and-announce） ──

/**
 * `computeCrossRowMove` 的成功結果——形狀與 `RowSwapResult` 相同（皆為
 * 1-index，供 `formatMoveAnnouncement` 直用），供呼叫端（main.ts）以同一
 * 播報格式化函式復用。
 */
export interface CrossRowMoveResult {
  /**
   * 移動後的完整 `segments` 陣列——沿用輸入陣列中原有的物件參照（不複製
   * ／不新建任何 SegmentConfig 物件，同 `computeRowSwap` 慣例），供呼叫端
   * 直接整批寫回 `config.segments`。**本函式不 mutate 任何輸入物件的
   * 欄位（含 `row`）**——「陣列自原位移除＋插入目標位」僅重排陣列本身；
   * 移動段的 `row` 欄位原地寫回（改為 `targetRow`）由呼叫端於整批寫回
   * `config.segments` 之外另行 mutate 該物件（main.ts `segmentConfigById`
   * 慣例，同 `applyRowNormalization`／`setSegmentEnabled`），本函式僅回傳
   * 供播報用的 1-index `row`/`position`/`rowSize`（視同該段已落在
   * `targetRow` 後之分組結果）。
   */
  segments: SegmentConfig[]
  /** 移動後所在渲染列（1-index，即播報文案之 N；依「該段已落在 targetRow」
   * 之假設分組計算，未反映輸入陣列元素實際 `row` 欄位——後者由呼叫端
   * 寫回後才真正生效）。 */
  row: number
  /** 移動後於該列子序列內的新位置（1-index，即播報文案之 M）。 */
  position: number
  /** 該列段數（即播報文案之 K）。 */
  rowSize: number
}

/**
 * 跨列 drop＝實際移動（PLAN Rev 5 契約）：把 `id` 段自 `segments` 陣列
 * 原位移除，插入至：
 * - `beforeId` 指定時＝該段之前（他列某段上＝插入其前）；
 * - `beforeId` 缺省時＝`targetRow` 子序列末段之後（列容器空白處／暫存
 *   空列＝落列尾）；`targetRow` 目前無任何啟用段（如落空暫存列，
 *   `targetRow` 為全新列號）時無「末段」可言，退化為陣列尾（PLAN「目標列
 *   無段＝陣列合理落點，建議陣列尾」）。
 *
 * **純函式，不 mutate 輸入**：回傳的 `segments` 為全新排列的陣列（沿用
 * 原物件參照），移動段的 `row` 欄位本身**不**在此改寫——呼叫端須另行把
 * `targetRow` 寫回該段物件（原地 mutate 慣例，見 `CrossRowMoveResult.
 * segments` 文件）；本函式回傳的 `row`/`position`/`rowSize` 為**假設**
 * 移動段已落在 `targetRow` 後、依 `computeRowGroups` 分組計算之播報用
 * 1-index 位置資訊，直接供 `formatMoveAnnouncement` 使用。
 *
 * 同段 no-op 防衛：`beforeId === id`（插入己身之前，無意義指令——正常
 * 拖放路徑不會產生此輸入，因同一格拖曳目標一律視為同列，交由
 * `computeRowSwap` 處理；此處純為函式邊界防禦）時忽略 `targetRow`、
 * 完全不重排，回傳陣列原順序＋依段目前實際分組（`seg.row` 現值）算出的
 * 位置資訊。
 */
export function computeCrossRowMove(
  segments: readonly SegmentConfig[],
  id: string,
  targetRow: number,
  beforeId?: string,
): CrossRowMoveResult {
  if (beforeId === id) {
    return currentPositionResult(segments, id, targetRow)
  }

  const moved = segments.find((seg) => seg.id === id)
  if (moved === undefined) {
    // 防禦：id 不存在於陣列中（正常互動下不會發生——呼叫端僅對既有啟用段
    // 觸發跨列拖放）。不重排，位置資訊以 targetRow 為準之空列假設回報。
    return { segments: [...segments], row: targetRow + 1, position: 1, rowSize: 1 }
  }

  const without = segments.filter((seg) => seg.id !== id)

  let insertIndex: number
  if (beforeId !== undefined) {
    const idx = without.findIndex((seg) => seg.id === beforeId)
    insertIndex = idx === -1 ? without.length : idx
  } else {
    // 無 beforeId：插入 targetRow 子序列末段之後；該列無段（含全新
    // 列號）→ 陣列尾。
    let lastIndexInTargetRow = -1
    for (let i = 0; i < without.length; i++) {
      const seg = without[i]
      if (seg.enabled && (seg.row ?? 0) === targetRow) lastIndexInTargetRow = i
    }
    insertIndex = lastIndexInTargetRow === -1 ? without.length : lastIndexInTargetRow + 1
  }

  const next = [...without.slice(0, insertIndex), moved, ...without.slice(insertIndex)]

  // 播報位置：假設 moved 已落在 targetRow（純計算視圖，不 mutate moved 本身）。
  const projected = next.map((seg) => (seg.id === id ? { ...seg, row: targetRow } : seg))
  const groups = computeRowGroups(projected)
  const rowIndex = groups.findIndex((group) => group.segmentIds.includes(id))
  const group = rowIndex === -1 ? undefined : groups[rowIndex]

  return {
    segments: next,
    row: rowIndex === -1 ? targetRow + 1 : rowIndex + 1,
    position: group === undefined ? 1 : group.segmentIds.indexOf(id) + 1,
    rowSize: group === undefined ? 1 : group.segmentIds.length,
  }
}

/** no-op 防衛與防禦分支共用：依段目前實際分組算出播報用位置資訊，陣列原順序不變。 */
function currentPositionResult(
  segments: readonly SegmentConfig[],
  id: string,
  fallbackRow: number,
): CrossRowMoveResult {
  const groups = computeRowGroups(segments)
  const rowIndex = groups.findIndex((group) => group.segmentIds.includes(id))
  const group = rowIndex === -1 ? undefined : groups[rowIndex]
  return {
    segments: [...segments],
    row: rowIndex === -1 ? fallbackRow + 1 : rowIndex + 1,
    position: group === undefined ? 1 : group.segmentIds.indexOf(id) + 1,
    rowSize: group === undefined ? 1 : group.segmentIds.length,
  }
}

// ── 插入點挪空間視覺（T5.11；(internal design doc) ──
// ── §排序與列指派 UX Rev 6「插入點挪空間視覺」） ──

/**
 * 依指標 Y 座標相對目標元素矩形的位置，判定拖曳插入方向——矩形上半＝
 * `'before'`（插目標之前）、下半（含中點）＝`'after'`（插目標之後，即
 * 下一段之前）。純幾何計算（DOM-free），main.ts 之 dragover（gap
 * placeholder 定位）與 drop（`beforeId` 解析）皆呼叫本函式，確保視覺
 * 提示與實際插入結果一致。
 */
export function resolveDropSide(pointerY: number, rectTop: number, rectHeight: number): 'before' | 'after' {
  return pointerY < rectTop + rectHeight / 2 ? 'before' : 'after'
}

/**
 * `wireRowContainerDrop` 的空白處插入點幾何解析——段間縫隙（flex gap，
 * 事件目標為容器本身，非任一 `<li>`）依指標 Y 對齊視覺插入點；僅最末段
 * 中線以下的尾端空白（含拖曳中放寬的命中區）才回傳 `null` 落列尾
 * （T5.6 使用者裁決 2026-07-12：使用者回報「拖一到兩個中間的黑區會預設
 * 到最後段」——原邏輯對容器內所有非 li 目標一律視為「空白處＝落列尾」，
 * 誤把段與段之間 0.5rem 的 flex gap 條帶（elementFromPoint 落在
 * `.segment-list` 本身）也判為列尾，故改為依指標 Y 逐項比對中線，找出
 * 縫隙所在的實際插入位置）。
 *
 * 回傳第一個「垂直中線低於 `pointerY`」的項目索引（即 `resolveDropSide`
 * 同義之 `pointerY < top + height / 2` 成立的第一個 index，插於其前）；
 * 全部項目中線皆在 `pointerY` 之上（含空陣列）時回傳 `null`（＝落列尾
 * append）。邊界採與 `resolveDropSide` 相同的 `<` 語意：`pointerY`
 * 恰等於某項中線時不算其前，跳至下一項（或無下一項則回傳 `null`）。
 */
export function resolveBlankAreaInsertIndex(
  pointerY: number,
  items: readonly { top: number; height: number }[],
): number | null {
  for (let i = 0; i < items.length; i++) {
    const { top, height } = items[i]
    if (pointerY < top + height / 2) return i
  }
  return null
}

// ── 整列刪除（T5.11；(internal design doc) §排序與 ──
// ── 列指派 UX Rev 6「整列刪除」） ──

/** `computeRowDeletion` 的計算結果。 */
export interface RowDeletionInfo {
  /** 該列全部啟用段 id（依列內順序）；列索引超出範圍（防禦）時為空陣列。 */
  segmentIds: string[]
  /** 是否為僅剩的最後一個真實列——`true` 時呼叫端應阻止刪除（鈕
   * `disabled`，維持可見，防清空）。 */
  isLastRow: boolean
}

/**
 * 計算「刪除第 `rowIndex` 列」的受影響段集合＋是否為僅剩最後一列（純
 * 函式，DOM-free）：main.ts 據此批次停用（`enabled=false`）該列全部段
 * （單次 `commitConfig`，不逐段呼叫 `setSegmentEnabled` 以避免 N 次
 * relayout），並依 `isLastRow` 同步刪除鈕之 `disabled` 態。
 */
export function computeRowDeletion(groups: readonly RowGroup[], rowIndex: number): RowDeletionInfo {
  const group = groups[rowIndex]
  return {
    segmentIds: group === undefined ? [] : [...group.segmentIds],
    isLastRow: groups.length <= 1,
  }
}
