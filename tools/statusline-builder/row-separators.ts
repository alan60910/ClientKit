/**
 * T1.2（(internal design doc) §D1 A-3，2026-07-17 使用者
 * 拍板「跟列走」）：`rowSeparators` 的 reindex 純函式 helper——DOM-free
 * 模組（比照 row-slots.ts／row-groups.ts 慣例：node 可測、零 DOM import）。
 *
 * 資料模型（A-1／A-3）：`rowSeparators` 為與 `rowSlots`（row-slots.ts）
 * 的 `'real'` slot **一對一的平行陣列**（main.ts:243 註解「第 k 個 real
 * ↔ 第 k 個渲染列」）——`rowSeparators[k]` 為第 k 個真實渲染列（0-index，
 * 對位「啟用列位」，見 PLAN A-1）的分隔符覆寫；`null`＝該列未覆寫、
 * 沿用全域 `config.separator`。**唯 real-slot 集合／序改變時**才 splice
 * 同步（PLAN A-3）：
 * - 真實列被刪除（`performRowDeletion`）或清空壓縮（`setSegmentEnabled`
 *   drain／`commitSegmentMove` 之 `srcDrains`，皆對應 row-slots.ts
 *   `convertRealToPending`）→ 該列的覆寫**一併消滅**、其後覆寫前移
 *   （陣列縮短一格）：見 {@link removeRealAt}。
 * - pending 空列物化成真實列（`commitSegmentMove` 之 pending consume，
 *   對應 row-slots.ts `consumePendingSlot`）→ 於該啟用列位 splice 入
 *   `null`（新列本身無覆寫）、其後覆寫同步後移：見 {@link insertNullAtReal}。
 * - **pending-only 變異點對 rowSeparators 為 no-op**——`removePendingRow`
 *   （守衛 `!== 'pending' return`）與 `appendPendingSlot`（末端追加）皆
 *   不動 real slot。本模組刻意**不提供以 slot index 為座標的 API**（僅
 *   收 real index），呼叫端（T1.7）對 pending-only 操作自然不會呼叫本
 *   模組任何函式——不得照 slot index 機械 splice（slot index ≠ real
 *   index，中間 pending 刪除會誤刪錯位覆寫，見 PLAN A-3）。
 *
 * 各函式皆為純函式：回傳新陣列，絕不 mutate 輸入（同 row-slots.ts 慣例）。
 * 型別 `SeparatorConfig` type-only 引入 config.ts（該檔本任務不得編輯，
 * T1.1 並行改動中）。
 */
import type { SeparatorConfig } from './config.js'

/** 單一渲染列的分隔符覆寫：`null`＝該列未覆寫、沿用全域 `separator`。 */
export type RowSeparator = SeparatorConfig | null

/**
 * 移除第 `realIndex` 個 real slot 對應的覆寫（splice 移除，其後覆寫
 * 前移一格）。用於：真實列被刪除（`performRowDeletion`）或清空壓縮
 * （`setSegmentEnabled` drain／`commitSegmentMove` 之 `srcDrains`）——
 * 該列的覆寫一併消滅，符合 PLAN A-3「列被刪除或清空壓縮時，其覆寫一併
 * 消滅」。`realIndex` 超出範圍（防禦；正常呼叫下呼叫端傳入的 real index
 * 恆有效）時視為 no-op、回傳淺拷貝。
 */
export function removeRealAt(seps: readonly RowSeparator[], realIndex: number): RowSeparator[] {
  if (realIndex < 0 || realIndex >= seps.length) return [...seps]
  return seps.filter((_, i) => i !== realIndex)
}

/**
 * 於第 `realIndex` 個位置 splice 入 `null`（該新列本身無覆寫），其後
 * 覆寫同步後移一格。用於：pending 空列物化成真實列（`commitSegmentMove`
 * 之 pending consume），符合 PLAN A-3「pending 空列物化成真實列＝於該
 * 啟用列位 splice 入 null、其後覆寫同步後移」。`realIndex` 允許等於
 * `seps.length`（末端追加，防禦性 clamp；同 row-slots.ts
 * `slotIndexOfRealRow` past-the-end 慣例）。
 */
export function insertNullAtReal(seps: readonly RowSeparator[], realIndex: number): RowSeparator[] {
  const clamped = Math.max(0, Math.min(realIndex, seps.length))
  const next = [...seps]
  next.splice(clamped, 0, null)
  return next
}

/**
 * 防禦性長度對齊：把 `seps` 長度補到至少 `targetLength`（尾端補
 * `null`）。僅處理「不足」——真實列數增加卻未經 {@link insertNullAtReal}
 * 顯式同步時的安全網（同 row-slots.ts `reconcileRealSlots` 慣例）。
 * `seps.length >= targetLength` 時為 no-op：過長（尾端多餘 `null`）之
 * 修剪委回 config 端既有清洗邏輯（PLAN A-2「序列化前修剪尾端 null」），
 * 本模組不重複實作。
 */
export function padToLength(seps: readonly RowSeparator[], targetLength: number): RowSeparator[] {
  if (seps.length >= targetLength) return [...seps]
  return [...seps, ...new Array<RowSeparator>(targetLength - seps.length).fill(null)]
}
