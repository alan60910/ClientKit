/**
 * T5.4（(internal design doc) §D2「列選擇 UI」／
 * §排序與列指派 UX「重新啟用帶舊 row 值的段」；S7 spike 裁決見
 * `(internal design doc)`）：每段「顯示於第
 * N 列」`<select>` 之目標 option 狀態計算與原地更新指令、以及重啟用
 * 帶舊 row 值段的 clamp 落點——皆為 DOM-free 純函式，main.ts 只消費其
 * 輸出（select 節點本身的建立／查詢／option 增刪皆留在 main.ts，比照
 * row-groups.ts 先例：main.ts 檔尾即執行 DOM query，import 會在 node
 * 測試環境無 jsdom 立即拋錯，故把可測邏輯抽出獨立零 DOM 依賴模組）。
 *
 * S7 裁決結論（Chromium 系實測）：更新既有 `<option>` 之 text/value＋於
 * 尾端增補/裁剪不搬焦點、不跳捲動、選取值不漂移——**select 節點與既有
 * option 皆不重建，只原地更新**；「新增一列」不進 select（T5.4 之
 * 獨立按鈕於 T5.9 移除，見下）。
 *
 * T5.9（(internal design doc) §D3-R4「新增一列
 * （第三修）」，依賴 T5.8）：T5.4 每段獨立「新增一列」按鈕移除，改為
 * 中欄頂部單一按鈕＋main.ts 端維護的 UI 暫存空列（純 DOM 態、不進
 * config）。select 枚舉來源＝**渲染列 ∪ 暫存列**。
 *
 * T5.14（(internal design doc) T5.14／PLAN Rev 11，
 * 2026-07-12 使用者裁決「列耗盡保留＋暫存列位置制」）：暫存列由計數制
 * （單一 `pendingRowCount`，暫存列恆接於真實列之後）升級為**位置制
 * slots**（`RowSlot[]`，空列可落在中間，見 row-slots.ts）。本模組的枚舉
 * 改**依 slots**：
 * - `rowSelectOptionsForCount(rowCount, pendingRowCount)` →
 *   `rowSelectOptionsForSlots(slots)`：option value＝**slot index 字串**
 *   （非渲染列序；main.ts 據此於 change 時判定 real／pending 再交
 *   commitSegmentMove）、text＝`第 ${slot+1} 列`（real）／
 *   `第 ${slot+1} 列（新列）`（pending）。
 * - `computeRowSelectOptionOps(current, rowCount, pendingRowCount)` →
 *   `computeRowSelectOptionOps(current, slots)`（op 模型不變，target 改
 *   用上式）。
 * - `nextPendingRowCount` **刪除**——位置制下暫存列位置由 main.ts 各
 *   變異點顯式維護（consume／convert／removeSlotAt／append），計數推斷法
 *   （「依前後渲染列成長量扣除」）廢止。
 *
 * T5.2（(internal design doc) §D5 A-1；messages.ts 見
 * T5.1）：`rowSelectOptionsForSlots` 的 option 文字改由 `t(locale)` 注入
 * （取自 `messages.rowSelect`），不再內嵌中文字面——`locale` 選填、預設
 * `DEFAULT_LOCALE`（'zh-Hant'），既有呼叫端（main.ts／
 * `computeRowSelectOptionOps`）零改動下繼續編譯且輸出不變；實際語言
 * 穿線留待 T5.5。`computeRowSelectOptionOps` 同步加一選填 `locale` 尾參，
 * 原樣轉發給內部的 `rowSelectOptionsForSlots` 呼叫，保持兩函式的注入
 * 語意一致。
 */

import { DEFAULT_LOCALE, t, type Locale } from './messages.js'
import type { RowSlot } from './row-slots.js'

/** 既有／目標 `<option>` 狀態（value／text 皆為字串，對齊 DOM `HTMLOptionElement`）。 */
export interface RowSelectOption {
  value: string
  text: string
}

/**
 * 對既有 `<option>` 集合的原地更新指令（main.ts 據此逐一施作，不重建
 * select 節點、不整批 replaceChildren）：
 * - `update`：既有 index 位置的 option text/value 與目標不同 → 原地改寫。
 * - `append`：目標列數多於現有 option 數 → 於尾端新增。
 * - `trim`：現有 option 數多於目標列數 → 自 `fromIndex` 起（含）全數移除。
 */
export type RowSelectOptionOp =
  | { kind: 'update'; index: number; value: string; text: string }
  | { kind: 'append'; value: string; text: string }
  | { kind: 'trim'; fromIndex: number }

/**
 * T5.14（位置制 slots）：依 UI 列位陣列 `slots`（見 row-slots.ts）計算
 * 「顯示於第 N 列」select 的目標 option 全集，枚舉來源＝**渲染列 ∪ 暫存
 * 列**、順序即 slot 順序（空列可落在中間）：每個 slot 一個 option，
 * value＝**slot index 字串**（供 main.ts 於 change 時以 `slots[value]`
 * 判定 real／pending 再交 commitSegmentMove——非渲染列序，因位置制下
 * 兩者不再一一對應）、text＝`第 ${slot+1} 列`（real）／
 * `第 ${slot+1} 列（新列）`（pending，與真實列區隔）。
 *
 * `locale`（T5.2 注入，選填、預設 `DEFAULT_LOCALE`）：text 取自
 * `messages.ts` 的 `t(locale).rowSelect.rowOption`／`rowOptionPending`，
 * 不再內嵌中文字面——不傳時輸出與既有中文字面完全一致（相容性硬約束）。
 */
export function rowSelectOptionsForSlots(
  slots: readonly RowSlot[],
  locale: Locale = DEFAULT_LOCALE,
): RowSelectOption[] {
  const m = t(locale)
  return slots.map((slot, i) => ({
    value: String(i),
    text: slot === 'pending' ? m.rowSelect.rowOptionPending(i + 1) : m.rowSelect.rowOption(i + 1),
  }))
}

/**
 * 比較既有 option 狀態（`current`，索引即目前 DOM 順序）與目標 slots
 * （T5.14 位置制），計算「原地更新」所需的最小操作序列（見
 * RowSelectOptionOp）。若現狀與目標完全相同（含順序），回傳空陣列——
 * main.ts 僅在分組實際變動或 slots 變動時才呼叫本函式（PLAN §D2 正規化
 * 接線：與 row 分組無關的 commit 不觸發全體 select 刷新），此處的空陣列
 * 回傳確保縱使誤呼叫、目標未變時亦不會產生任何 DOM 操作指令（雙重保險，
 * 非取代 main.ts 層的變動偵測）。
 *
 * `locale`（T5.2 注入，選填、預設 `DEFAULT_LOCALE`）：原樣轉發給內部的
 * `rowSelectOptionsForSlots(slots, locale)` 呼叫，不傳時輸出與既有中文
 * 字面完全一致（相容性硬約束）。
 */
export function computeRowSelectOptionOps(
  current: readonly RowSelectOption[],
  slots: readonly RowSlot[],
  locale: Locale = DEFAULT_LOCALE,
): RowSelectOptionOp[] {
  const target = rowSelectOptionsForSlots(slots, locale)
  const ops: RowSelectOptionOp[] = []
  for (let i = 0; i < target.length; i++) {
    const existing = current[i]
    if (existing === undefined) {
      ops.push({ kind: 'append', value: target[i].value, text: target[i].text })
    } else if (existing.value !== target[i].value || existing.text !== target[i].text) {
      ops.push({ kind: 'update', index: i, value: target[i].value, text: target[i].text })
    }
  }
  if (current.length > target.length) {
    ops.push({ kind: 'trim', fromIndex: target.length })
  }
  return ops
}

/**
 * 重新啟用帶舊 row 值段之落點（PLAN §D2「重新啟用帶舊 row 值的段」Rev 2
 * 釘死）：保留其凍結的 `row` 值——若該值 ≤ 現行最大渲染列
 * （`currentRowCount - 1`）則不變（落對應列，交由 `normalizeRows` 的升冪
 * 壓縮完成 round-trip，列分佈保留）；超出範圍則 clamp 至最後一列
 * （`currentRowCount - 1`）。
 *
 * `currentRowCount === 0`（尚無使用中渲染列，即重啟用前沒有其他啟用段）
 * 時無列可 clamp——原樣返回（該段重啟用後將成為唯一使用中列，
 * `normalizeRows` 自然映射其任意 row 值至 0，行為與現行語意一致）。
 * `row === undefined`（該段從未指定過 row，如全新目錄段）維持
 * `undefined`（視同 0 的既有語意，不需 clamp）。
 *
 * 呼叫時機：main.ts 於段被啟用（重新/首次啟用；T5.9 起唯一入口＝左欄
 * 目錄勾選控件的 change handler，非本檔案內任何 li 自身控件）時、
 * `commitConfig()`（→ `applyRowNormalization` → `normalizeRows`）之前，
 * 以 `lastRowGroups.length`（目前已同步至 DOM 的使用中渲染列數）為
 * `currentRowCount` 呼叫本函式——確保「超界 clamp」在 `normalizeRows`
 * 的升冪壓縮邏輯介入前就已成立（`normalizeRows` 本身只依現有 row 值
 * 去重壓縮，並不知道「clamp 至現行最大渲染列」這條產品語意，若不在此
 * 前處理，超界值會被壓縮成一個全新的列而非落在末列——見本檔案 T5.4
 * 任務說明第 5 點）。
 */
export function clampReenableRow(row: number | undefined, currentRowCount: number): number | undefined {
  if (row === undefined) return undefined
  if (currentRowCount === 0) return row
  return Math.min(row, currentRowCount - 1)
}
