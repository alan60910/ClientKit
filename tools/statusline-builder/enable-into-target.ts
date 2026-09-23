/**
 * T3.2（(internal design doc) §D3 A-1「enable-into-target
 * seam」，本 sprint 唯一 Critical 級設計 C1 之決策核心）：把「enable 一個
 * **停用中**的段至 target（真實列 / 暫存 pending / 列內位置）」的落點決策
 * 抽為 DOM-free 純函式——不依賴 drag event、不 mutate 任何輸入（比照
 * row-slots.ts `planSegmentMove`／row-groups.ts 慣例：node 可測、零 DOM
 * import；main.ts 檔尾即於模組頂層執行 DOM query，故可測邏輯一律外抽）。
 *
 * 為何獨立於 `planSegmentMove`（row-slots.ts）另立分支，而非復用：
 * `planSegmentMove` 的輸入假設段**已啟用**（`sourceRow`＝其現列），其步驟
 * 1（取來源列＋判 `srcDrains`）／2（`srcSlot`）／4（來源列耗盡 →
 * `convertRealToPending`）皆環繞「來源列」。停用段沒有來源列——enable-
 * into-target 的語意本質是**純插入**（pure insertion）而非移動：
 * - 無來源列 drain（不把任何 real slot 翻回 pending）；
 * - 無來源位縮併；
 * - `bumpIds` 只受 target 側影響（落 pending 時使「real-index ≥ 落點」者
 *   全數後移一列）。
 * 故本函式僅取 `planSegmentMove` 的步驟 3（落點解析＋pending 側 bump 收集
 * ＋consume），刻意不含步驟 1/2/4。row-slots.ts 在本任務禁改清單，且以
 * 「虛擬來源列」包裝 `planSegmentMove` 會重演 C1 的 clamp/drain 中間態
 * （PLAN 明文禁止），故決策層一步到位、獨立成本模組。
 *
 * 型別／位映射 helper 皆自 row-slots.ts import（單一事實來源；本模組只
 * 新增決策分支，不重複宣告 `DropTarget`／`SegmentMovePlan`／位映射）。
 */
import {
  consumePendingSlot,
  realIndexOfSlot,
  type DropTarget,
  type PlanSegmentInput,
  type RowSlot,
  type SegmentMovePlan,
} from './row-slots.js'

/**
 * enable-into-target 的落點決策（純插入）：輸入現行 `slots`／`segments`
 * （用以收集 target 側受 bump 的段）／`movedId`（即將被啟用的停用段，
 * 自 bump 排除）／`target`（drop 落點描述），輸出與 `planSegmentMove`
 * 同形的 `SegmentMovePlan`：
 * - `targetRow`：被啟用段最終應寫回的 `row`（0-index 渲染列序）。
 * - `nextSlots`：套用本次插入後的新 slots（純值；`pending` target 於原
 *   位 consume 成 `real`，`real` target 不動 slots）。
 * - `bumpIds`：呼叫端須逐一把這些段的 `row` `+1`（原地 mutate；本函式
 *   不 mutate 任何輸入，只回傳決策，同 `planSegmentMove` 慣例）。
 *
 * `pending` target：`targetRow = realIndexOfSlot(slots, slotIndex)`（該
 * pending 位置指派成真後即成為第此數個 real）→ 收集「非 moved 的啟用段、
 * 其 `row ?? 0 ≥ targetRow`」為 `bumpIds`（新列插入使其後所有 real 後移
 * 一列，語意同 `planSegmentMove` 之 pending 分支）→ `nextSlots =
 * consumePendingSlot(slots, slotIndex)`（原位翻 kind，位置不變）。
 *
 * `real` target：`targetRow = target.row`、`bumpIds = []`（落既有列不新增
 * real、無後移）、`nextSlots = [...slots]`（不動）。列內位置（第 M 位）由
 * 呼叫端以 `beforeId` 交 `computeCrossRowMove` 決定，非本決策層職責。
 *
 * 不變量：`realCount(nextSlots)` 於 `pending` target 為 `realCount(slots)
 * + 1`、於 `real` target 不變——恆等於呼叫端 commit 後的實際渲染列數
 * （純插入不減 real）。
 */
export function planEnableIntoTarget(
  slots: readonly RowSlot[],
  segments: readonly PlanSegmentInput[],
  movedId: string,
  target: DropTarget,
): SegmentMovePlan {
  if (target.kind === 'pending') {
    const targetRow = realIndexOfSlot(slots, target.slotIndex)
    const bumpIds: string[] = []
    for (const other of segments) {
      if (other.id === movedId || !other.enabled) continue
      if ((other.row ?? 0) >= targetRow) bumpIds.push(other.id)
    }
    return { targetRow, nextSlots: consumePendingSlot(slots, target.slotIndex), bumpIds }
  }
  return { targetRow: target.row, nextSlots: [...slots], bumpIds: [] }
}
