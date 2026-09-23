/**
 * T1.4（(internal design doc) §D1／§D2／§D4／§D9「M0 實作
 * 注意」／§Verification「geometry」）：正重疊（零長度不算）、`gap` 公式
 * 對退化矩形為負、`pairwise` 碰撞／通道／none 三態（含 d=0 零寬矩形）、
 * 交集面積／矩形、區間正規化（相接亦合併）與區間減法、`pxToCm`／`cmToPx`
 * 定值表（含 minX 負與 zoom≠1）、`fitViewBox`。
 */
import { describe, expect, it } from 'vitest'
import {
  cmToPx,
  fitViewBox,
  gap,
  hasPositiveOverlap,
  intersectArea,
  intersectRect,
  normalizeIntervals,
  overlapLength,
  pairwise,
  pxToCm,
  rectArea,
  rectFromXYWH,
  subtractIntervals,
  viewScale,
  type Rect,
} from './geometry.js'

describe('overlapLength / hasPositiveOverlap（D4：投影重疊＝重疊段長度 > 0）', () => {
  it('touching edges（重疊長度 0）→ false', () => {
    const a: Rect = { x0: 0, y0: 0, x1: 5, y1: 1 }
    const b: Rect = { x0: 5, y0: 0, x1: 10, y1: 1 }
    expect(overlapLength(a.x0, a.x1, b.x0, b.x1)).toBe(0)
    expect(hasPositiveOverlap(a, b, 'x')).toBe(false)
  })

  it('1 cm 重疊 → true', () => {
    const a: Rect = { x0: 0, y0: 0, x1: 5, y1: 1 }
    const b: Rect = { x0: 4, y0: 0, x1: 10, y1: 1 }
    expect(overlapLength(a.x0, a.x1, b.x0, b.x1)).toBe(1)
    expect(hasPositiveOverlap(a, b, 'x')).toBe(true)
  })
})

describe('gap（d = max(aLo−bHi, bLo−aHi)，D4）', () => {
  it('分離矩形 → 正值', () => {
    expect(gap(0, 5, 10, 15)).toBe(5)
  })

  it('重疊矩形 → 負值', () => {
    expect(gap(0, 10, 5, 15)).toBe(-5)
  })

  it('零厚框邊落在另一矩形內部（退化矩形）→ 負值', () => {
    // 邊在 5（零長度），另一矩形涵蓋 [0,10]，邊嚴格落在其內部。
    expect(gap(5, 5, 0, 10)).toBe(-5)
  })
})

describe('pairwise（D4 契約）', () => {
  it('兩軸皆正重疊 → collision', () => {
    const a: Rect = { x0: 0, y0: 0, x1: 10, y1: 10 }
    const b: Rect = { x0: 5, y0: 5, x1: 15, y1: 15 }
    expect(pairwise(a, b)).toEqual({ kind: 'collision' })
  })

  it('恰一軸正重疊、X 為間距軸（Y 對齊）→ corridor，手算矩形', () => {
    // Y 軸重疊 [5,15]（長 10）；X 軸分離，d = max(0−25, 15−10) = 5。
    const a: Rect = { x0: 0, y0: 0, x1: 10, y1: 20 }
    const b: Rect = { x0: 15, y0: 5, x1: 25, y1: 15 }
    expect(pairwise(a, b)).toEqual({
      kind: 'corridor',
      axis: 'x',
      gap: 5,
      rect: { x0: 10, y0: 5, x1: 15, y1: 15 },
    })
  })

  it('恰一軸正重疊、Y 為間距軸（X 對齊）→ corridor，手算矩形', () => {
    // X 軸重疊 [2,8]（長 6）；Y 軸分離，d = max(0−20, 8−5) = 3。
    const a: Rect = { x0: 0, y0: 0, x1: 10, y1: 5 }
    const b: Rect = { x0: 2, y0: 8, x1: 8, y1: 20 }
    expect(pairwise(a, b)).toEqual({
      kind: 'corridor',
      axis: 'y',
      gap: 3,
      rect: { x0: 2, y0: 5, x1: 8, y1: 8 },
    })
  })

  it('d=0（恰相接）→ corridor 矩形在間距軸零寬', () => {
    // X 軸重疊 [2,8]；Y 軸恰相接於 5，d = max(0−15, 5−5) = 0。
    const a: Rect = { x0: 0, y0: 0, x1: 10, y1: 5 }
    const b: Rect = { x0: 2, y0: 5, x1: 8, y1: 15 }
    expect(pairwise(a, b)).toEqual({
      kind: 'corridor',
      axis: 'y',
      gap: 0,
      rect: { x0: 2, y0: 5, x1: 8, y1: 5 },
    })
  })

  it('恰一軸正重疊、零厚框邊卡在家具內部（d<0）→ collision（卡在牆裡）', () => {
    // X 軸重疊 [5,15]；Y 軸為零厚邊 (y=0) 落在家具 [-5,5] 內部，d=-5。
    const furniture: Rect = { x0: 0, y0: -5, x1: 20, y1: 5 }
    const wallEdge: Rect = { x0: 5, y0: 0, x1: 15, y1: 0 }
    expect(pairwise(furniture, wallEdge)).toEqual({ kind: 'collision' })
  })

  it('斜對角（兩軸皆無正重疊）→ none', () => {
    const a: Rect = { x0: 0, y0: 0, x1: 5, y1: 5 }
    const b: Rect = { x0: 10, y0: 10, x1: 15, y1: 15 }
    expect(pairwise(a, b)).toEqual({ kind: 'none' })
  })
})

describe('intersectArea / intersectRect', () => {
  it('重疊 → 正面積與交集矩形', () => {
    const a: Rect = { x0: 0, y0: 0, x1: 10, y1: 10 }
    const b: Rect = { x0: 5, y0: 5, x1: 15, y1: 15 }
    expect(intersectArea(a, b)).toBe(25)
    expect(intersectRect(a, b)).toEqual({ x0: 5, y0: 5, x1: 10, y1: 10 })
  })

  it('僅相接（0 面積）→ 0／null', () => {
    const a: Rect = { x0: 0, y0: 0, x1: 10, y1: 10 }
    const b: Rect = { x0: 10, y0: 0, x1: 20, y1: 10 }
    expect(intersectArea(a, b)).toBe(0)
    expect(intersectRect(a, b)).toBeNull()
  })

  it('包含關係 → 面積與矩形皆為內層矩形', () => {
    const outer: Rect = { x0: 0, y0: 0, x1: 20, y1: 20 }
    const inner: Rect = { x0: 5, y0: 5, x1: 15, y1: 15 }
    expect(intersectArea(outer, inner)).toBe(100)
    expect(intersectRect(outer, inner)).toEqual(inner)
  })
})

describe('normalizeIntervals（D9「M0 實作注意」：相接亦合併）', () => {
  it('相接區間合併（[0,3],[3,10] → [0,10]）', () => {
    expect(normalizeIntervals([{ lo: 0, hi: 3 }, { lo: 3, hi: 10 }])).toEqual([{ lo: 0, hi: 10 }])
  })

  it('重疊區間合併', () => {
    expect(normalizeIntervals([{ lo: 0, hi: 5 }, { lo: 3, hi: 8 }])).toEqual([{ lo: 0, hi: 8 }])
  })

  it('捨去空區間（hi<=lo）', () => {
    expect(normalizeIntervals([{ lo: 5, hi: 5 }, { lo: 0, hi: 2 }])).toEqual([{ lo: 0, hi: 2 }])
  })

  it('排序（輸入逆序）', () => {
    expect(normalizeIntervals([{ lo: 10, hi: 12 }, { lo: 0, hi: 2 }])).toEqual([
      { lo: 0, hi: 2 },
      { lo: 10, hi: 12 },
    ])
  })
})

describe('subtractIntervals', () => {
  it('中段扣除 → 兩段', () => {
    expect(subtractIntervals({ lo: 0, hi: 10 }, [{ lo: 4, hi: 6 }])).toEqual([
      { lo: 0, hi: 4 },
      { lo: 6, hi: 10 },
    ])
  })

  it('整段扣除 → []', () => {
    expect(subtractIntervals({ lo: 0, hi: 10 }, [{ lo: -5, hi: 15 }])).toEqual([])
  })

  it('扣除區間在外 → base 不變', () => {
    expect(subtractIntervals({ lo: 0, hi: 10 }, [{ lo: 20, hi: 30 }])).toEqual([
      { lo: 0, hi: 10 },
    ])
  })

  it('多筆重疊扣除', () => {
    expect(
      subtractIntervals({ lo: 0, hi: 20 }, [
        { lo: 2, hi: 6 },
        { lo: 5, hi: 9 },
        { lo: 15, hi: 18 },
      ]),
    ).toEqual([
      { lo: 0, hi: 2 },
      { lo: 9, hi: 15 },
      { lo: 18, hi: 20 },
    ])
  })

  it('扣除區間貼齊 base 兩端', () => {
    expect(
      subtractIntervals({ lo: 0, hi: 10 }, [
        { lo: 0, hi: 3 },
        { lo: 8, hi: 10 },
      ]),
    ).toEqual([{ lo: 3, hi: 8 }])
  })
})

describe('rectArea / rectFromXYWH', () => {
  it('由左上角＋寬深組矩形並算面積', () => {
    const r = rectFromXYWH(10, 20, 30, 40)
    expect(r).toEqual({ x0: 10, y0: 20, x1: 40, y1: 60 })
    expect(rectArea(r)).toBe(1200)
  })

  it('零厚矩形面積為 0', () => {
    expect(rectArea({ x0: 0, y0: 0, x1: 10, y1: 0 })).toBe(0)
  })
})

describe('viewScale（D1 preserveAspectRatio="xMidYMid meet"）', () => {
  it('board 與 viewBox 同比例 → 無 letterbox', () => {
    expect(viewScale({ left: 0, top: 0, width: 300, height: 400 }, { minX: -60, minY: 0, w: 150, h: 200 })).toEqual({
      scale: 2,
      offsetX: 0,
      offsetY: 0,
    })
  })

  it('board 較寬 → 水平 letterbox（offsetX > 0）', () => {
    expect(viewScale({ left: 0, top: 0, width: 400, height: 400 }, { minX: 0, minY: 0, w: 150, h: 200 })).toEqual({
      scale: 2,
      offsetX: 50,
      offsetY: 0,
    })
  })
})

describe('pxToCm / cmToPx 定值表（D2）', () => {
  it('clientX = left+30px → 相對 minX 的 offset 15 cm → x = -60+15 = -45 cm', () => {
    const board = { left: 0, top: 0, width: 300, height: 400 }
    const vb = { minX: -60, minY: 0, w: 150, h: 200 }
    expect(pxToCm(30, 0, board, vb)).toEqual({ x: -45, y: 0 })
  })

  it('zoom≠1（viewBox w 75 → scale 4）', () => {
    const board = { left: 0, top: 0, width: 300, height: 400 }
    const vb = { minX: -30, minY: 0, w: 75, h: 100 }
    expect(viewScale(board, vb).scale).toBe(4)
    expect(pxToCm(8, 40, board, vb)).toEqual({ x: -28, y: 10 })
  })

  it('letterbox 案（board 400×400、vb 150:200 → scale 2、offsetX 50，手算）', () => {
    const board = { left: 0, top: 0, width: 400, height: 400 }
    const vb = { minX: 0, minY: 0, w: 150, h: 200 }
    // x = 0 + (100 - 0 - 50) / 2 = 25；y = 0 + (100 - 0 - 0) / 2 = 50
    expect(pxToCm(100, 100, board, vb)).toEqual({ x: 25, y: 50 })
  })

  it('minX 負案：board 帶非零 left/top', () => {
    const board = { left: 20, top: 10, width: 300, height: 400 }
    const vb = { minX: -60, minY: -5, w: 150, h: 200 }
    // x = -60 + (20+30 - 20 - 0)/2 = -60+15 = -45；y = -5 + (10+40-10-0)/2 = -5+20 = 15
    expect(pxToCm(50, 50, board, vb)).toEqual({ x: -45, y: 15 })
  })

  it('cmToPx(pxToCm(p)) ≈ p（往返，附帶檢查）', () => {
    const board = { left: 20, top: 10, width: 400, height: 400 }
    const vb = { minX: -60, minY: -5, w: 150, h: 200 }
    const p = { clientX: 137, clientY: 84 }
    const cm = pxToCm(p.clientX, p.clientY, board, vb)
    const roundTrip = cmToPx(cm.x, cm.y, board, vb)
    expect(roundTrip.clientX).toBeCloseTo(p.clientX, 9)
    expect(roundTrip.clientY).toBeCloseTo(p.clientY, 9)
  })
})

describe('fitViewBox（D1／D10）', () => {
  const bounds: Rect = { x0: 0, y0: 0, x1: 300, y1: 400 }

  it('zoom 1、pan 0 → 恰為 bounds', () => {
    expect(fitViewBox(bounds, 1, 0, 0)).toEqual({ minX: 0, minY: 0, w: 300, h: 400 })
  })

  it('zoom 2 → 半尺寸、置中', () => {
    expect(fitViewBox(bounds, 2, 0, 0)).toEqual({ minX: 75, minY: 100, w: 150, h: 200 })
  })

  it('pan 平移 minX／minY', () => {
    expect(fitViewBox(bounds, 1, 50, -20)).toEqual({ minX: 50, minY: -20, w: 300, h: 400 })
  })
})
