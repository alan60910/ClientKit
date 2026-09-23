/**
 * T1.8 — `snap.ts` 單元測試（(internal design doc)
 * §Verification「snap／reducer：順序…」、§Recommended approach「`snap.ts`
 * 順序：取整 → 網格 → 磁吸 → 夾框」、§D6「磁吸亦以極大牆段為準」、
 * §Implementation notes「磁吸距離跟隨 `ignoreBelow`」）。
 *
 * 磁吸案一律以 D3 預設 `ignoreBelow = 5` 為距離，並用玄關實例（基底
 * 300×400＋extend `E1` [300,360]×[0,270]）的 `normalize()` 輸出當牆段來源
 * ——同一組座標也出現在 room-shape／clearance 的測試裡，便於對照。
 */
import { describe, expect, it } from 'vitest'
import type { Rect } from './geometry.js'
import { normalize } from './room-shape.js'
import { snapPosition, snapToGrid, type GridSize, type SnapContext } from './snap.js'

/** D3 預設磁吸距離。 */
const MAGNET = 5

/** 玄關實例的極大牆段：縱向 x=0／x=360（y≤270）／x=300（y≥270）；橫向 y=0／y=270（x∈[300,360]）／y=400（x∈[0,300]）。 */
const VESTIBULE = normalize({
  width: 300,
  depth: 400,
  blocks: [{ id: 'e1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }],
})

function ctx(over: Partial<SnapContext> = {}): SnapContext {
  return { grid: 1, magnet: MAGNET, edges: [], neighbors: [], ...over }
}

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 })

describe('snapToGrid', () => {
  it('grid 1 即取最近整數', () => {
    expect(snapToGrid(12.4, 1)).toBe(12)
    expect(snapToGrid(12.6, 1)).toBe(13)
    expect(snapToGrid(-3.2, 1)).toBe(-3)
  })

  it('grid 5／10 取最近倍數', () => {
    expect(snapToGrid(12, 5)).toBe(10)
    expect(snapToGrid(13, 5)).toBe(15)
    expect(snapToGrid(204, 10)).toBe(200)
    expect(snapToGrid(206, 10)).toBe(210)
    expect(snapToGrid(-24, 10)).toBe(-20)
  })

  it('正中間一律往 +∞ 靠（`Math.round` 語意），且不產生 -0', () => {
    expect(snapToGrid(2.5, 5)).toBe(5)
    expect(snapToGrid(5, 10)).toBe(10)
    expect(snapToGrid(-2.5, 5)).toBe(0)
    expect(snapToGrid(-5, 10)).toBe(0)
    // `Object.is(-0, 0)` 為假，故 `toBe(0)` 同時鎖住「不得回 -0」。
    expect(Object.is(snapToGrid(-5, 10), 0)).toBe(true)
  })

  it('已在格線上時原值不動', () => {
    for (const grid of [1, 5, 10] as GridSize[]) {
      expect(snapToGrid(100, grid)).toBe(100)
    }
  })
})

describe('snapPosition — 取整與網格', () => {
  it('先取整再套網格；magnet 0 時只剩這兩步', () => {
    const size = { w: 50, d: 50 }
    expect(snapPosition(12.4, 7.6, size, ctx({ grid: 1, magnet: 0 }))).toEqual({ x: 12, y: 8 })
    expect(snapPosition(12.4, 7.6, size, ctx({ grid: 10, magnet: 0 }))).toEqual({ x: 10, y: 10 })
  })

  it('magnet 0 關閉磁吸：近在 1 cm 的鄰邊也不吸', () => {
    const neighbors = [rect(100, 0, 200, 100)]
    const result = snapPosition(201, 20, { w: 50, d: 50 }, ctx({ magnet: 0, neighbors }))
    expect(result).toEqual({ x: 201, y: 20 })
  })
})

describe('snapPosition — 磁吸鄰居邊', () => {
  const size = { w: 50, d: 50 }
  const neighbors = [rect(100, 0, 200, 100)]

  it('距離 ≤ ignoreBelow（5）時吸到鄰居的邊', () => {
    // 移動中矩形左緣 205 距鄰居右緣 200 為 5 → 位移 −5，兩者貼齊。
    expect(snapPosition(205, 20, size, ctx({ neighbors }))).toEqual({ x: 200, y: 20 })
  })

  it('距離 6 時不吸（嚴格以 magnet 為上界）', () => {
    expect(snapPosition(206, 20, size, ctx({ neighbors }))).toEqual({ x: 206, y: 20 })
  })

  it('另一軸無正重疊的鄰居不列入候選（不會吸到房間另一頭）', () => {
    // y∈[205,255] 與鄰居 y∈[0,100] 無重疊 → x 不動。
    expect(snapPosition(205, 205, size, ctx({ neighbors }))).toEqual({ x: 205, y: 205 })
  })

  it('僅角點相接（重疊長度 0）不算共面', () => {
    // y∈[100,150] 與鄰居 y∈[0,100] 恰相接，重疊長度 0 → 不吸。
    expect(snapPosition(205, 100, size, ctx({ neighbors }))).toEqual({ x: 205, y: 100 })
  })

  it('同距離時取較小位移（負向優先）', () => {
    const both = [rect(40, 0, 90, 100), rect(100, 0, 150, 100)]
    // 左緣 95 距左鄰右緣 90 與右鄰左緣 100 皆為 5 → 決勝取 −5。
    expect(snapPosition(95, 20, size, ctx({ neighbors: both }))).toEqual({ x: 90, y: 20 })
  })

  it('兩軸各自獨立吸附（各由不同鄰居供候選）', () => {
    // A 只與移動框在 y 有重疊 → 供 x 候選 200；B 只在 x 有重疊 → 供 y 候選 150。
    const two = [rect(100, 0, 200, 100), rect(220, 150, 300, 250)]
    expect(snapPosition(204, 96, size, ctx({ neighbors: two }))).toEqual({ x: 200, y: 100 })
  })
})

describe('snapPosition — 磁吸極大牆段（D6）', () => {
  const size = { w: 60, d: 60 }
  const edges = VESTIBULE.edges

  it('吸到玄關 `S` 牆的北面 y=270（x 區間重疊時）', () => {
    // 家具 x∈[300,360] 與該段 x∈[300,360] 完全重疊；下緣 267 距 270 為 3。
    expect(snapPosition(300, 207, size, ctx({ edges }))).toEqual({ x: 300, y: 210 })
  })

  it('x 區間不重疊時不吸 y=270（房間西半邊的家具不受玄關牆影響）', () => {
    expect(snapPosition(0, 207, size, ctx({ edges }))).toEqual({ x: 0, y: 207 })
  })

  it('吸到縱向牆段 x=360（東側外緣）', () => {
    // 右緣 356 距 x=360 為 4；該段 y∈[0,270] 與家具 y∈[0,60] 有正重疊。
    expect(snapPosition(296, 0, size, ctx({ edges }))).toEqual({ x: 300, y: 0 })
  })

  it('極大牆段才是候選：y=400 的 `S` 段只涵蓋 x∈[0,300]', () => {
    // 家具 x∈[300,360] 與 [0,300] 重疊長度 0 → 下緣 357 不吸 y=400。
    expect(snapPosition(300, 337, size, ctx({ edges }))).toEqual({ x: 300, y: 337 })
  })
})

describe('snapPosition — 順序：取整 → 網格 → 磁吸', () => {
  const size = { w: 50, d: 50 }
  const neighbors = [rect(95, 0, 195, 100)]

  it('網格先跑，把值帶進磁吸範圍（grid 10 → 吸到 95）', () => {
    // 88.7 →（取整）89 →（網格 10）90 →（磁吸）距 95 恰 5 → 95。
    expect(snapPosition(88.7, 20, size, ctx({ grid: 10, neighbors })).x).toBe(95)
  })

  it('同一輸入改 grid 1 就不吸：89 距 95 為 6 > magnet', () => {
    expect(snapPosition(88.7, 20, size, ctx({ grid: 1, neighbors })).x).toBe(89)
  })

  it('磁吸在網格之後：結果可以不是網格倍數', () => {
    const x = snapPosition(88.7, 20, size, ctx({ grid: 10, neighbors })).x
    expect(x % 10).not.toBe(0)
    expect(x).toBe(95)
  })
})
