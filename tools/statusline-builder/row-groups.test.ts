/**
 * T5.3（(internal design doc) §排序與列指派 UX）：
 * computeRowGroups／rowGroupsEqual 純函式單元測試（多列分組、單列、
 * 停用段排除、列內順序保留、重編號〔壓縮輸入亦可正確分組〕、分組變動
 * 偵測真/假案）。
 *
 * T5.5：computeRowSwap／formatMoveAnnouncement 純函式單元測試（同列相鄰
 * ／不相鄰交換、列首/列末停用資訊、播報文案格式化）。
 */
import { describe, expect, it } from 'vitest'
import type { SegmentConfig } from './config.js'
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
} from './row-groups.js'

const seg = (id: string, enabled: boolean, row?: number): SegmentConfig => {
  const base: SegmentConfig = { id, enabled, icon: false, color: { kind: 'default' } }
  return row === undefined ? base : { ...base, row }
}

describe('computeRowGroups（依渲染列分組；僅啟用段）', () => {
  it('單列：全部啟用段 row 皆 0（含缺 row）→ 一組', () => {
    const segments = [seg('a', true, 0), seg('b', true), seg('c', true, 0)]
    expect(computeRowGroups(segments)).toEqual([{ row: 0, segmentIds: ['a', 'b', 'c'] }])
  })

  it('多列：已正規化的連續 row 值（0,1,2）→ 依 row 升冪排序之多組，列內保留輸入陣列序', () => {
    const segments = [seg('a', true, 1), seg('b', true, 0), seg('c', true, 2), seg('d', true, 1)]
    expect(computeRowGroups(segments)).toEqual([
      { row: 0, segmentIds: ['b'] },
      { row: 1, segmentIds: ['a', 'd'] },
      { row: 2, segmentIds: ['c'] },
    ])
  })

  it('未正規化（亂序 row 值 5,2,9）仍依現值分組＋升冪排序（呼叫端負責先 normalizeRows）', () => {
    const segments = [seg('a', true, 5), seg('b', true, 2), seg('c', true, 9)]
    expect(computeRowGroups(segments)).toEqual([
      { row: 2, segmentIds: ['b'] },
      { row: 5, segmentIds: ['a'] },
      { row: 9, segmentIds: ['c'] },
    ])
  })

  it('停用段排除在外，即使帶 row 值也不進任何分組', () => {
    const segments = [seg('a', true, 0), seg('b', false, 0), seg('c', false, 5)]
    expect(computeRowGroups(segments)).toEqual([{ row: 0, segmentIds: ['a'] }])
  })

  it('全部停用 → 空陣列（零列群組）', () => {
    const segments = [seg('a', false), seg('b', false, 3)]
    expect(computeRowGroups(segments)).toEqual([])
  })

  it('空陣列輸入 → 空陣列', () => {
    expect(computeRowGroups([])).toEqual([])
  })

  it('缺 row 之啟用段視同 row 0（分組鍵 seg.row ?? 0），與顯式 row:0 同組', () => {
    const segments = [seg('a', true), seg('b', true, 0)]
    expect(computeRowGroups(segments)).toEqual([{ row: 0, segmentIds: ['a', 'b'] }])
  })
})

describe('rowGroupsEqual（分組變動偵測；main.ts commitConfig 據此判斷是否重跑 row UI 同步）', () => {
  it('結構相同（同列數、同 row 值、同列內 id 序）→ true', () => {
    const a: RowGroup[] = [
      { row: 0, segmentIds: ['x', 'y'] },
      { row: 1, segmentIds: ['z'] },
    ]
    const b: RowGroup[] = [
      { row: 0, segmentIds: ['x', 'y'] },
      { row: 1, segmentIds: ['z'] },
    ]
    expect(rowGroupsEqual(a, b)).toBe(true)
  })

  it('與己身比較（同物件不同參照）→ true（純函式，非參照比較）', () => {
    const groups = computeRowGroups([seg('a', true, 1), seg('b', true, 0)])
    const groupsAgain = computeRowGroups([seg('a', true, 1), seg('b', true, 0)])
    expect(groups).not.toBe(groupsAgain)
    expect(rowGroupsEqual(groups, groupsAgain)).toBe(true)
  })

  it('列數不同（新增/刪除一列）→ false', () => {
    const a: RowGroup[] = [{ row: 0, segmentIds: ['x'] }]
    const b: RowGroup[] = [
      { row: 0, segmentIds: ['x'] },
      { row: 1, segmentIds: ['y'] },
    ]
    expect(rowGroupsEqual(a, b)).toBe(false)
  })

  it('同列數但某列成員不同（新增/移除段）→ false', () => {
    const a: RowGroup[] = [{ row: 0, segmentIds: ['x', 'y'] }]
    const b: RowGroup[] = [{ row: 0, segmentIds: ['x'] }]
    expect(rowGroupsEqual(a, b)).toBe(false)
  })

  it('同列數同成員但列內順序不同（同列內移位）→ false', () => {
    const a: RowGroup[] = [{ row: 0, segmentIds: ['x', 'y'] }]
    const b: RowGroup[] = [{ row: 0, segmentIds: ['y', 'x'] }]
    expect(rowGroupsEqual(a, b)).toBe(false)
  })

  it('列內容相同但 row 值不同（列重編號）→ false', () => {
    const a: RowGroup[] = [{ row: 0, segmentIds: ['x'] }]
    const b: RowGroup[] = [{ row: 1, segmentIds: ['x'] }]
    expect(rowGroupsEqual(a, b)).toBe(false)
  })

  it('與 row 分組無關的變動（如僅改顏色，segments 分組結果不變）→ true，不應觸發 row UI 同步', () => {
    const before = computeRowGroups([seg('a', true, 0), seg('b', true, 1)])
    // 模擬「改顏色」commit：segments 內容變了但 enabled/row 分組不變。
    const afterColorChange = computeRowGroups([
      { ...seg('a', true, 0), color: { kind: 'ansi256', index: 42 } },
      seg('b', true, 1),
    ])
    expect(rowGroupsEqual(before, afterColorChange)).toBe(true)
  })

  it('兩者皆空陣列（全部停用時比較）→ true', () => {
    expect(rowGroupsEqual([], [])).toBe(true)
  })
})

describe('computeRowSwap（同列子序列索引運算；上／下移＝與前／後一個同列段交換）', () => {
  it('同列相鄰交換：上移 → 與前一個同列段互換完整陣列位置', () => {
    const segments = [seg('a', true, 0), seg('b', true, 0)]
    const result = computeRowSwap(segments, 'b', 'up')
    expect(result).not.toBeNull()
    expect(result!.segments.map((s) => s.id)).toEqual(['b', 'a'])
    expect(result).toMatchObject({ row: 1, position: 1, rowSize: 2 })
    // 沿用原物件參照（非新建），供 main.ts closures 慣例整批寫回。
    expect(result!.segments[0]).toBe(segments[1])
    expect(result!.segments[1]).toBe(segments[0])
  })

  it('同列相鄰交換：下移 → 與後一個同列段互換', () => {
    const segments = [seg('a', true, 0), seg('b', true, 0)]
    const result = computeRowSwap(segments, 'a', 'down')
    expect(result!.segments.map((s) => s.id)).toEqual(['b', 'a'])
    expect(result).toMatchObject({ row: 1, position: 2, rowSize: 2 })
  })

  it('同列不相鄰交換（完整陣列中夾著他列段）：交換的是列子序列相鄰成員，其餘段位置不受影響', () => {
    // 完整陣列序：a(row0), b(row1), c(row0) —— row0 子序列＝[a, c]。
    const segments = [seg('a', true, 0), seg('b', true, 1), seg('c', true, 0)]
    const result = computeRowSwap(segments, 'c', 'up')
    expect(result).not.toBeNull()
    // a/c 互換絕對索引；b（他列段，夾在中間）維持原位不動。
    expect(result!.segments.map((s) => s.id)).toEqual(['c', 'b', 'a'])
    expect(result!.segments[1]).toBe(segments[1]) // b 物件參照不變、位置不變
    expect(result).toMatchObject({ row: 1, position: 1, rowSize: 2 })
  })

  it('段已在其列子序列首位 → 上移回傳 null（對應鈕應 disabled）', () => {
    const segments = [seg('a', true, 0), seg('b', true, 0)]
    expect(computeRowSwap(segments, 'a', 'up')).toBeNull()
  })

  it('段已在其列子序列末位 → 下移回傳 null（對應鈕應 disabled）', () => {
    const segments = [seg('a', true, 0), seg('b', true, 0)]
    expect(computeRowSwap(segments, 'b', 'down')).toBeNull()
  })

  it('單段列：上移／下移皆回傳 null（兩鈕皆停用）', () => {
    const segments = [seg('a', true, 0), seg('b', true, 1)]
    expect(computeRowSwap(segments, 'a', 'up')).toBeNull()
    expect(computeRowSwap(segments, 'a', 'down')).toBeNull()
  })

  it('段不存在（防禦）→ null', () => {
    const segments = [seg('a', true, 0)]
    expect(computeRowSwap(segments, 'ghost', 'up')).toBeNull()
  })

  it('段存在但未啟用（不屬任何列群組）→ null（防禦；正常互動下鈕僅啟用列可見不會觸發）', () => {
    const segments = [seg('a', false, 0), seg('b', true, 0)]
    expect(computeRowSwap(segments, 'a', 'down')).toBeNull()
  })

  it('多列場景：row 與 position 依渲染列序（1-index）與列內新位置（1-index）正確回報', () => {
    const segments = [seg('a', true, 1), seg('b', true, 0), seg('c', true, 1), seg('d', true, 1)]
    // 渲染列序：row0→[b]（第 1 列）、row1→[a,c,d]（第 2 列）。
    const result = computeRowSwap(segments, 'd', 'up') // d 與 c 交換 → [a,d,c]
    expect(result).not.toBeNull()
    expect(result).toMatchObject({ row: 2, position: 2, rowSize: 3 })
  })
})

describe('formatMoveAnnouncement（排序位置回饋播報文案）', () => {
  it('格式化為「〈段名〉移至第 N 列第 M 位（共 K）」', () => {
    expect(formatMoveAnnouncement('目錄', { row: 2, position: 3, rowSize: 5 })).toBe(
      '目錄 移至第 2 列第 3 位（共 5）',
    )
  })

  it('可直接代入 computeRowSwap 的成功結果（同一形狀子集）', () => {
    const segments = [seg('a', true, 0), seg('b', true, 0)]
    const result = computeRowSwap(segments, 'b', 'up')!
    expect(formatMoveAnnouncement('段 B', result)).toBe('段 B 移至第 1 列第 1 位（共 2）')
  })

  it('T5.2：locale="en" → 英文句形（插值參數位置正確）', () => {
    expect(formatMoveAnnouncement('Segment', { row: 2, position: 3, rowSize: 5 }, 'en')).toBe(
      'Segment moved to row 2 position 3 (of 5)',
    )
  })
})

describe('computeCrossRowMove（跨列 drop＝實際移動；T5.10，PLAN Rev 5）', () => {
  it('插入他列段前：自原位移除＋插入 beforeId 段之前，其餘段相對順序不變', () => {
    // a(row0), b(row1), c(row1) —— 把 a 移到 row1、插在 c 之前。
    const segments = [seg('a', true, 0), seg('b', true, 1), seg('c', true, 1)]
    const result = computeCrossRowMove(segments, 'a', 1, 'c')
    expect(result.segments.map((s) => s.id)).toEqual(['b', 'a', 'c'])
    // 沿用原物件參照（非新建）。
    expect(result.segments[0]).toBe(segments[1])
    expect(result.segments[1]).toBe(segments[0])
    expect(result.segments[2]).toBe(segments[2])
    // row0 因唯一成員（a）移走而空列壓縮消失，row1 成為唯一渲染列（第 1 列）。
    expect(result).toMatchObject({ row: 1, position: 2, rowSize: 3 })
  })

  it('落他列尾：無 beforeId → 插入目標列子序列末段之後', () => {
    const segments = [seg('a', true, 0), seg('b', true, 1), seg('c', true, 1)]
    const result = computeCrossRowMove(segments, 'a', 1)
    expect(result.segments.map((s) => s.id)).toEqual(['b', 'c', 'a'])
    expect(result).toMatchObject({ row: 1, position: 3, rowSize: 3 })
  })

  it('落空暫存列（targetRow＝全新列號，該列目前無任何段）→ 陣列尾', () => {
    const segments = [seg('a', true, 0), seg('b', true, 0)]
    // targetRow=1 為全新列號（尚無任何段的 row===1）。
    const result = computeCrossRowMove(segments, 'a', 1)
    expect(result.segments.map((s) => s.id)).toEqual(['b', 'a'])
    // 新列僅 a 一員，成為第 2 列（row0 尚存 b，未壓縮）。
    expect(result).toMatchObject({ row: 2, position: 1, rowSize: 1 })
  })

  it('落空暫存列且原列因此清空 → 空列壓縮，目標列變成第 1 列', () => {
    // a 是 row0 唯一成員；移到全新列號 targetRow=5 後，row0 消失、新列為
    // 唯一渲染列（第 1 列）。
    const segments = [seg('a', true, 0)]
    const result = computeCrossRowMove(segments, 'a', 5)
    expect(result.segments.map((s) => s.id)).toEqual(['a'])
    expect(result).toMatchObject({ row: 1, position: 1, rowSize: 1 })
  })

  it('同段 no-op 防衛：beforeId 等於 id（插入己身之前，無意義指令）→ 陣列與位置維持不動，忽略 targetRow', () => {
    const segments = [seg('a', true, 0), seg('b', true, 1)]
    const result = computeCrossRowMove(segments, 'a', 1, 'a')
    expect(result.segments.map((s) => s.id)).toEqual(['a', 'b'])
    expect(result.segments[0]).toBe(segments[0])
    expect(result.segments[1]).toBe(segments[1])
    // a 目前實際在 row0（唯一渲染列第 1 列），與傳入的 targetRow:1 無關。
    expect(result).toMatchObject({ row: 1, position: 1, rowSize: 1 })
  })

  it('插入後列內順序＝陣列序驗證：呼叫端寫回 row 後，computeRowGroups 之列內順序與 result.segments 陣列序一致', () => {
    const segments = [seg('a', true, 0), seg('b', true, 1), seg('d', true, 1), seg('c', true, 1)]
    // 把 a 移到 row1，插在 d 之前 → 預期陣列序 [b, a, d, c]。
    const result = computeCrossRowMove(segments, 'a', 1, 'd')
    expect(result.segments.map((s) => s.id)).toEqual(['b', 'a', 'd', 'c'])
    // 模擬呼叫端「row 原地寫回」慣例：mutate 移動段的 row 為 targetRow，
    // 其餘段沿用原物件（未變）。
    const written = result.segments.map((s) => (s.id === 'a' ? { ...s, row: 1 } : s))
    const groups = computeRowGroups(written)
    expect(groups).toEqual([{ row: 1, segmentIds: ['b', 'a', 'd', 'c'] }])
  })

  it('不 mutate 輸入：原陣列與其元素的 row 欄位不變', () => {
    const segments = [seg('a', true, 0), seg('b', true, 1)]
    const snapshot = segments.map((s) => ({ ...s }))
    computeCrossRowMove(segments, 'a', 1)
    expect(segments).toEqual(snapshot)
  })

  it('beforeId 指定他列段：插入位置精確落在該段之前，不受列內其餘段干擾', () => {
    // row0=[a], row1=[b,c,d]；把 a 插到 c 之前 → [b, a, c, d]。
    const segments = [seg('a', true, 0), seg('b', true, 1), seg('c', true, 1), seg('d', true, 1)]
    const result = computeCrossRowMove(segments, 'a', 1, 'c')
    expect(result.segments.map((s) => s.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(result).toMatchObject({ row: 1, position: 2, rowSize: 4 })
  })

  // ── T5.11（PLAN Rev 6「拖曳統一插入制」）：同列拖放亦改走本函式—— ──
  // ── targetRow＝原列、beforeId＝同列另一段，驗證 targetRow＝原列情形。 ──

  it('同列插入（targetRow＝原列）：插在同列另一段之前，其餘段相對順序不變', () => {
    // 單列（row0）=[a, b, c]；把 c 插到 a 之前 → [c, a, b]。
    const segments = [seg('a', true, 0), seg('b', true, 0), seg('c', true, 0)]
    const result = computeCrossRowMove(segments, 'c', 0, 'a')
    expect(result.segments.map((s) => s.id)).toEqual(['c', 'a', 'b'])
    // 沿用原物件參照。
    expect(result.segments[0]).toBe(segments[2])
    expect(result.segments[1]).toBe(segments[0])
    expect(result.segments[2]).toBe(segments[1])
    expect(result).toMatchObject({ row: 1, position: 1, rowSize: 3 })
  })

  it('同列插入（targetRow＝原列）：無 beforeId → 移至同列子序列末尾', () => {
    // 單列（row0）=[a, b, c]；把 a 移至列尾 → [b, c, a]。
    const segments = [seg('a', true, 0), seg('b', true, 0), seg('c', true, 0)]
    const result = computeCrossRowMove(segments, 'a', 0)
    expect(result.segments.map((s) => s.id)).toEqual(['b', 'c', 'a'])
    expect(result).toMatchObject({ row: 1, position: 3, rowSize: 3 })
  })

  it('多列場景之同列插入：僅該列內部重排，他列與其段位置不受影響', () => {
    // row0=[a,b]，row1=[c,d]；把 b 插到 a 之前（同列 row0）→ [b, a, c, d]。
    const segments = [seg('a', true, 0), seg('b', true, 0), seg('c', true, 1), seg('d', true, 1)]
    const result = computeCrossRowMove(segments, 'b', 0, 'a')
    expect(result.segments.map((s) => s.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(result.segments[2]).toBe(segments[2]) // c 物件參照與位置不變
    expect(result.segments[3]).toBe(segments[3]) // d 物件參照與位置不變
    expect(result).toMatchObject({ row: 1, position: 1, rowSize: 2 })
  })
})

describe('resolveDropSide（插入點上/下半解析；T5.11，PLAN Rev 6「插入點挪空間視覺」）', () => {
  it('指標在矩形上半 → before', () => {
    expect(resolveDropSide(10, 0, 40)).toBe('before')
  })

  it('指標在矩形下半 → after', () => {
    expect(resolveDropSide(30, 0, 40)).toBe('after')
  })

  it('指標恰在中點 → after（下半含中點的邊界）', () => {
    expect(resolveDropSide(20, 0, 40)).toBe('after')
  })

  it('rectTop 非 0 時仍以相對位置判定', () => {
    expect(resolveDropSide(105, 100, 40)).toBe('before')
    expect(resolveDropSide(125, 100, 40)).toBe('after')
  })
})

describe('resolveBlankAreaInsertIndex（空白處插入點幾何解析；T5.6 使用者裁決 2026-07-12）', () => {
  it('空陣列 → null（落列尾）', () => {
    expect(resolveBlankAreaInsertIndex(50, [])).toBeNull()
  })

  it('指標在首項中線之上 → 0', () => {
    const items = [
      { top: 0, height: 40 }, // 中線 20
      { top: 40, height: 40 }, // 中線 60
    ]
    expect(resolveBlankAreaInsertIndex(10, items)).toBe(0)
  })

  it('指標在項 0 底與項 1 頂之間（縫隙情境）→ 1', () => {
    const items = [
      { top: 0, height: 40 }, // 中線 20
      { top: 48, height: 40 }, // 縫隙 40–48，中線 68
    ]
    expect(resolveBlankAreaInsertIndex(44, items)).toBe(1)
  })

  it('指標低於末項中線 → null（落列尾）', () => {
    const items = [
      { top: 0, height: 40 }, // 中線 20
      { top: 48, height: 40 }, // 中線 68
    ]
    expect(resolveBlankAreaInsertIndex(80, items)).toBeNull()
  })

  it('指標恰等於某項中線 → 跳過該項，取下一項', () => {
    const items = [
      { top: 0, height: 40 }, // 中線 20
      { top: 48, height: 40 }, // 中線 68
    ]
    expect(resolveBlankAreaInsertIndex(20, items)).toBe(1)
  })

  it('指標恰等於末項中線 → 跳過末項 → null（落列尾）', () => {
    const items = [
      { top: 0, height: 40 }, // 中線 20
      { top: 48, height: 40 }, // 中線 68
    ]
    expect(resolveBlankAreaInsertIndex(68, items)).toBeNull()
  })
})

describe('computeRowDeletion（整列刪除受影響段集合＋剩餘列數判定；T5.11，PLAN Rev 6）', () => {
  it('多列：回傳該列段 id 集合（依列內順序）＋isLastRow=false', () => {
    const groups: RowGroup[] = [
      { row: 0, segmentIds: ['a', 'b'] },
      { row: 1, segmentIds: ['c'] },
    ]
    expect(computeRowDeletion(groups, 0)).toEqual({ segmentIds: ['a', 'b'], isLastRow: false })
    expect(computeRowDeletion(groups, 1)).toEqual({ segmentIds: ['c'], isLastRow: false })
  })

  it('僅剩一列 → isLastRow=true（呼叫端據此 disabled 刪除鈕，防清空）', () => {
    const groups: RowGroup[] = [{ row: 0, segmentIds: ['a', 'b', 'c'] }]
    expect(computeRowDeletion(groups, 0)).toEqual({ segmentIds: ['a', 'b', 'c'], isLastRow: true })
  })

  it('列索引超出範圍（防禦）→ 空段集合，isLastRow 仍依現有列數判定', () => {
    const groups: RowGroup[] = [{ row: 0, segmentIds: ['a'] }]
    expect(computeRowDeletion(groups, 5)).toEqual({ segmentIds: [], isLastRow: true })
  })

  it('零列（全部停用）→ 空段集合，isLastRow=true（0 ≤ 1）', () => {
    expect(computeRowDeletion([], 0)).toEqual({ segmentIds: [], isLastRow: true })
  })
})
