/**
 * T5.9（(internal design doc) §D3-R4「transfer-list
 * 互動（灰化留位）」）：catalog.ts 純函式單元測試——25 段×enabled 態→
 * 左欄項清單、目錄定義序恆定（不受 segments 陣列序影響）、分組正確性、
 * 查無對應 segment 之防禦預設。
 */
import { describe, expect, it } from 'vitest'
import type { SegmentConfig } from './config.js'
import { buildCatalogGroups } from './catalog.js'
import { defaultConfig } from './config.js'
import {
  DESCRIPTORS_BY_ID,
  SEGMENT_CATALOG,
  SEGMENT_DESCRIPTORS,
  type SegmentCategory,
  type SegmentId,
} from './segments.js'

const CATEGORY_ORDER: readonly SegmentCategory[] = ['always', 'percentage', 'conditional', 'shell-out']

const descriptor = (id: string, category: SegmentCategory, label = id) => ({ id, label, category })

const seg = (id: string, enabled: boolean): SegmentConfig => ({
  id,
  enabled,
  icon: false,
  color: { kind: 'default' },
})

describe('buildCatalogGroups（左欄目錄 view-model）', () => {
  it('依 categoryOrder 分組，各類別鍵恆存在（即使該類別無成員）', () => {
    const descriptors = [descriptor('a', 'always')]
    const groups = buildCatalogGroups(descriptors, [seg('a', false)], CATEGORY_ORDER)
    expect(Object.keys(groups)).toEqual(CATEGORY_ORDER)
    expect(groups.always).toEqual([{ id: 'a', label: 'a', enabled: false }])
    expect(groups.percentage).toEqual([])
    expect(groups.conditional).toEqual([])
    expect(groups['shell-out']).toEqual([])
  })

  it('各類別內保留 descriptors 既有序（混合類別輸入，非事先排序）', () => {
    const descriptors = [
      descriptor('p1', 'percentage'),
      descriptor('a1', 'always'),
      descriptor('a2', 'always'),
      descriptor('p2', 'percentage'),
    ]
    const segments = [seg('p1', false), seg('a1', false), seg('a2', false), seg('p2', false)]
    const groups = buildCatalogGroups(descriptors, segments, CATEGORY_ORDER)
    expect(groups.always.map((item) => item.id)).toEqual(['a1', 'a2'])
    expect(groups.percentage.map((item) => item.id)).toEqual(['p1', 'p2'])
  })

  it('enabled 狀態查表自 segments', () => {
    const descriptors = [descriptor('a', 'always'), descriptor('b', 'always')]
    const groups = buildCatalogGroups(descriptors, [seg('a', true), seg('b', false)], CATEGORY_ORDER)
    expect(groups.always).toEqual([
      { id: 'a', label: 'a', enabled: true },
      { id: 'b', label: 'b', enabled: false },
    ])
  })

  it('查無對應 segment（防禦性情境，正常不應發生）→ enabled 預設 false', () => {
    const descriptors = [descriptor('ghost', 'always')]
    const groups = buildCatalogGroups(descriptors, [], CATEGORY_ORDER)
    expect(groups.always).toEqual([{ id: 'ghost', label: 'ghost', enabled: false }])
  })

  it('目錄定義序恆定：輸出順序僅隨 descriptors 序，不受 segments 陣列序影響', () => {
    const descriptors = [descriptor('a', 'always'), descriptor('b', 'always'), descriptor('c', 'always')]
    const forward = buildCatalogGroups(descriptors, [seg('a', true), seg('b', true), seg('c', true)], CATEGORY_ORDER)
    // segments 陣列刻意反序＋部分 enabled 態不同（模擬 T5.5 同列交換後
    // config.segments 陣列序漂移的情境）：分組輸出的 id 順序不應受影響。
    const reversedSegments = [seg('c', true), seg('a', false), seg('b', true)]
    const reversed = buildCatalogGroups(descriptors, reversedSegments, CATEGORY_ORDER)
    expect(forward.always.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(reversed.always.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    // enabled 態則忠實反映各自傳入的 segments。
    expect(reversed.always.map((item) => item.enabled)).toEqual([false, true, true])
  })

  it('與真實 30 段目錄整合（T3.2 新 5 段後）：categoryOrder 四類分佈恰 12/5/10/3，總數 30，各類別內序＝SEGMENT_DESCRIPTORS 既有序', () => {
    const config = defaultConfig(SEGMENT_CATALOG)
    const groups = buildCatalogGroups(SEGMENT_DESCRIPTORS, config.segments, CATEGORY_ORDER)
    expect(groups.always).toHaveLength(12)
    expect(groups.percentage).toHaveLength(5)
    expect(groups.conditional).toHaveLength(10)
    expect(groups['shell-out']).toHaveLength(3)
    const total = groups.always.length + groups.percentage.length + groups.conditional.length + groups['shell-out'].length
    expect(total).toBe(30)
    // 全部預設停用（defaultConfig 全停用）。
    for (const category of CATEGORY_ORDER) {
      expect(groups[category].every((item) => item.enabled === false)).toBe(true)
    }
    // 各類別內序＝該類別在 SEGMENT_DESCRIPTORS 中的既有相對序。
    const expectedAlwaysIds = SEGMENT_DESCRIPTORS.filter((d) => d.category === 'always').map((d) => d.id)
    expect(groups.always.map((item) => item.id)).toEqual(expectedAlwaysIds)
    // label 忠實取自 descriptor（非 id 字面）。
    for (const item of groups.always) {
      expect(item.label).toBe(DESCRIPTORS_BY_ID[item.id as SegmentId].label)
    }
  })
})
