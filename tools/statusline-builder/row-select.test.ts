/**
 * T5.4（(internal design doc) §D2「列選擇 UI」／
 * §排序與列指派 UX「重新啟用帶舊 row 值的段」）：row-select.ts 純函式
 * 單元測試——option 目標狀態計算、原地更新指令 diff（列數增/減、與 row
 * 無關 commit 之空操作）、重啟用超界 clamp。
 *
 * T5.14（(internal design doc) T5.14／PLAN Rev 11）：
 * 枚舉改依位置制 slots（`rowSelectOptionsForSlots`／
 * `computeRowSelectOptionOps(current, slots)`）；`nextPendingRowCount`
 * 已刪除（其測試一併移除）；option value 改為 slot index、text 依 slot
 * kind 附「（新列）」字尾。
 */
import { describe, expect, it } from 'vitest'
import {
  clampReenableRow,
  computeRowSelectOptionOps,
  rowSelectOptionsForSlots,
  type RowSelectOption,
} from './row-select.js'
import type { RowSlot } from './row-slots.js'

describe('rowSelectOptionsForSlots（目標 option 全集，依 slots 位置制）', () => {
  it('空 slots → 空陣列', () => {
    expect(rowSelectOptionsForSlots([])).toEqual([])
  })

  it('全 real → value 為 slot index、text 為「第 N 列」', () => {
    expect(rowSelectOptionsForSlots(['real', 'real', 'real'])).toEqual([
      { value: '0', text: '第 1 列' },
      { value: '1', text: '第 2 列' },
      { value: '2', text: '第 3 列' },
    ])
  })

  it('中間 pending：value＝slot index、pending 附「（新列）」字尾', () => {
    expect(rowSelectOptionsForSlots(['real', 'pending', 'real'])).toEqual([
      { value: '0', text: '第 1 列' },
      { value: '1', text: '第 2 列（新列）' },
      { value: '2', text: '第 3 列' },
    ])
  })

  it('末端 pending（新增一列接於真實列之後）', () => {
    expect(rowSelectOptionsForSlots(['real', 'real', 'pending', 'pending'])).toEqual([
      { value: '0', text: '第 1 列' },
      { value: '1', text: '第 2 列' },
      { value: '2', text: '第 3 列（新列）' },
      { value: '3', text: '第 4 列（新列）' },
    ])
  })

  it('全 pending（所有段停用時累積的空列）：從 slot 0 起算', () => {
    expect(rowSelectOptionsForSlots(['pending'])).toEqual([{ value: '0', text: '第 1 列（新列）' }])
  })

  it('T5.2：locale="en" → 英文 option 文字（real／pending 皆覆蓋）', () => {
    expect(rowSelectOptionsForSlots(['real', 'pending', 'real'], 'en')).toEqual([
      { value: '0', text: 'Row 1' },
      { value: '1', text: 'Row 2 (new)' },
      { value: '2', text: 'Row 3' },
    ])
  })
})

describe('computeRowSelectOptionOps（原地更新指令 diff，依 slots）', () => {
  it('現有為空、目標 2 個 real → 兩個 append 操作', () => {
    expect(computeRowSelectOptionOps([], ['real', 'real'])).toEqual([
      { kind: 'append', value: '0', text: '第 1 列' },
      { kind: 'append', value: '1', text: '第 2 列' },
    ])
  })

  it('slots 增長（2 real → 3 real）：既有 2 個 option 不變、尾端 append 第 3 個', () => {
    const current: RowSelectOption[] = [
      { value: '0', text: '第 1 列' },
      { value: '1', text: '第 2 列' },
    ]
    expect(computeRowSelectOptionOps(current, ['real', 'real', 'real'])).toEqual([
      { kind: 'append', value: '2', text: '第 3 列' },
    ])
  })

  it('slots 縮短（3 → 1）：僅裁尾（trim fromIndex=1），保留的第 1 個 option 不變不產生 update', () => {
    const current: RowSelectOption[] = [
      { value: '0', text: '第 1 列' },
      { value: '1', text: '第 2 列' },
      { value: '2', text: '第 3 列' },
    ]
    expect(computeRowSelectOptionOps(current, ['real'])).toEqual([{ kind: 'trim', fromIndex: 1 }])
  })

  it('slot kind 翻轉（某位置 real→pending 或 pending→real）→ update 該筆 text', () => {
    const current: RowSelectOption[] = [
      { value: '0', text: '第 1 列' },
      { value: '1', text: '第 2 列' },
    ]
    // 第 2 列（slot 1）耗盡保留為空列 → text 應更新為「（新列）」字面。
    expect(computeRowSelectOptionOps(current, ['real', 'pending'])).toEqual([
      { kind: 'update', index: 1, value: '1', text: '第 2 列（新列）' },
    ])
  })

  it('與 row 分組無關的 commit（現有 option 已與目標 slots 完全相同）→ 空陣列', () => {
    const slots: RowSlot[] = ['real', 'pending', 'real']
    const current: RowSelectOption[] = rowSelectOptionsForSlots(slots)
    expect(computeRowSelectOptionOps(current, slots)).toEqual([])
  })

  it('空 slots → 空目標（全部停用態）：現有為空、目標亦空 → 空陣列', () => {
    expect(computeRowSelectOptionOps([], [])).toEqual([])
  })

  it('按下「新增一列」（末端追加 pending）：既有選項不變、尾端 append 一個暫存列 option', () => {
    const current: RowSelectOption[] = rowSelectOptionsForSlots(['real', 'real'])
    expect(computeRowSelectOptionOps(current, ['real', 'real', 'pending'])).toEqual([
      { kind: 'append', value: '2', text: '第 3 列（新列）' },
    ])
  })

  it('段指入中間空列後收斂（pending→real）：該筆 option 由「（新列）」字面 update 為真實列字面，無 append/trim', () => {
    const current: RowSelectOption[] = rowSelectOptionsForSlots(['real', 'pending', 'real'])
    expect(computeRowSelectOptionOps(current, ['real', 'real', 'real'])).toEqual([
      { kind: 'update', index: 1, value: '1', text: '第 2 列' },
    ])
  })

  it('T5.2：locale="en" 原樣轉發給 rowSelectOptionsForSlots → append 操作帶英文 text', () => {
    expect(computeRowSelectOptionOps([], ['real', 'pending'], 'en')).toEqual([
      { kind: 'append', value: '0', text: 'Row 1' },
      { kind: 'append', value: '1', text: 'Row 2 (new)' },
    ])
  })
})

describe('clampReenableRow（重新啟用帶舊 row 值段之落點）', () => {
  it('row === undefined → 維持 undefined（不論現行列數）', () => {
    expect(clampReenableRow(undefined, 0)).toBeUndefined()
    expect(clampReenableRow(undefined, 5)).toBeUndefined()
  })

  it('row ≤ 現行最大渲染列（currentRowCount-1）→ 原樣保留（round-trip 保留列分佈）', () => {
    expect(clampReenableRow(1, 3)).toBe(1) // 現行 3 列（0..2），1 在範圍內
    expect(clampReenableRow(0, 3)).toBe(0)
    expect(clampReenableRow(2, 3)).toBe(2) // 恰為末列
  })

  it('row 超出現行最大渲染列 → clamp 至最後一列（currentRowCount-1）', () => {
    expect(clampReenableRow(5, 3)).toBe(2)
    expect(clampReenableRow(999999999, 3)).toBe(2)
  })

  it('currentRowCount === 0（尚無使用中渲染列）→ 原樣返回，無列可 clamp', () => {
    expect(clampReenableRow(5, 0)).toBe(5)
    expect(clampReenableRow(0, 0)).toBe(0)
  })
})
