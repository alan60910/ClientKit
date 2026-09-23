/**
 * T1.6（(internal design doc) §D6「門」、§D4「契約——門洞」、
 * §D9 玄關實例＋反向案 (a)(f)、§Verification「door」與 clearance 的
 * `doorViolations` 條目）。
 *
 * 房型一律由 `room-shape.ts` 的 `normalize()` 產出（`edges` 為 D9 合併後的
 * **極大牆段**，手寫 edges 只用於 `spanFits` 之類的微型單元案），因此本檔
 * 同時鎖住「門合法性建立在極大牆段之上」這條 D6／N3 契約：任一 block 把牆
 * 切段都會讓既有門被誤判非法。
 *
 * 釘死 fixture：D9 使用者玄關實例——基底 300×400、extend `E1`
 * x∈[300,360] y∈[0,270]、門鉸鏈 (360,270) `leafDir:'-'` 寬 70 內開、衣櫃
 * 有效外框 [300,360]×[0,200]（相切於 70，嚴格 `<` 故不違規）。
 */
import { describe, expect, it } from 'vitest'
import { intersectArea, type Rect } from './geometry.js'
import type { Door, Side } from './model.js'
import { normalize, type Edge, type NormalizedRoom, type RoomShapeInput } from './room-shape.js'
import {
  deriveWall,
  doorGeometry,
  edgesAtPoint,
  intersectsSwing,
  nearestPointOnEdges,
  spanFits,
  spanOnEdge,
  validateDoor,
  withDerivedWall,
  type DoorInput,
  type DoorSpan,
  type Quadrant,
} from './door.js'

/* ------------------------------------------------------------------ *
 * fixture 與工具
 * ------------------------------------------------------------------ */

/** 純矩形房 300×400；`edges` 恰四段（N/E/S/W 各一）。 */
const PURE_RECT: RoomShapeInput = { width: 300, depth: 400, blocks: [] }

/** D9 玄關實例；`extendDepth` 可調以驗「房間變動後重跑」。 */
function vestibule(extendDepth = 270): RoomShapeInput {
  return {
    width: 300,
    depth: 400,
    blocks: [{ id: 'E1', kind: 'extend', x: 300, y: 0, width: 60, depth: extendDepth }],
  }
}

function doorAt(
  x: number,
  y: number,
  leafDir: '+' | '-',
  width: number,
  swing: 'in' | 'out' = 'in',
): DoorInput {
  return { id: 'd1', x, y, leafDir, width, swing }
}

/** 取合法門的完整 `Door`（含推導出的 `wall`）；非法即當場失敗。 */
function derivedDoor(shape: NormalizedRoom, input: DoorInput): Door {
  const door = withDerivedWall(input, shape)
  expect(door).not.toBeNull()
  return door as Door
}

/** 衣櫃（開門式 200×60，rotation 90）的有效外框；`y` 可調作反向案 (a)。 */
const wardrobe = (y: number): Rect => ({ x0: 300, y0: y, x1: 360, y1: y + 200 })

/* ------------------------------------------------------------------ *
 * D9 玄關實例（正案＋反向案 (a)）
 * ------------------------------------------------------------------ */

describe('D9 玄關實例', () => {
  const shape = normalize(vestibule())
  const input = doorAt(360, 270, '-', 70)

  it('鉸鏈在牆角 (360,270)，消歧後 wall 為 E 且取到 x=360 的極大牆段', () => {
    const result = validateDoor(input, shape)
    expect(result).toEqual({
      ok: true,
      wall: 'E',
      edge: { x0: 360, y0: 0, x1: 360, y1: 270, wall: 'E' },
    })
  })

  it('doorGeometry 給出 D9 釘死的跨距／門扇線段／開象限／迴旋區', () => {
    const geom = doorGeometry(derivedDoor(shape, input))
    expect(geom.wall).toBe('E')
    expect(geom.hinge).toEqual({ x: 360, y: 270 })
    expect(geom.span).toEqual({ axis: 'y', lo: 200, hi: 270 })
    expect(geom.leaf).toEqual({ x0: 360, y0: 200, x1: 360, y1: 270 })
    expect(geom.quadrant).toEqual({ xSign: -1, ySign: -1 })
    expect(geom.swingRect).toEqual({ x0: 290, y0: 200, x1: 360, y1: 270 })
  })

  it('衣櫃最近點恰距 70（相切）→ 不相交（嚴格 <）', () => {
    const geom = doorGeometry(derivedDoor(shape, input))
    expect(intersectsSwing(geom, wardrobe(0))).toBe(false)
  })

  it('反向案 (a)：衣櫃 y 改 1 → 最近點距 69 → 相交', () => {
    const geom = doorGeometry(derivedDoor(shape, input))
    expect(intersectsSwing(geom, wardrobe(1))).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * `wall` 由 x,y 推導、不信任輸入（D6／D7 parsePlan 用例）
 * ------------------------------------------------------------------ */

describe('wall 恆由 x,y 推導', () => {
  it('呼叫端偽造 wall:"N" 仍推出 E，且輸出逐欄重建（不搬未知欄）', () => {
    const shape = normalize(vestibule())
    const forged = { ...doorAt(360, 270, '-', 70), wall: 'N' as Side, bogus: 'x' }
    const door = withDerivedWall(forged, shape)
    expect(door?.wall).toBe('E')
    expect(Object.keys(door ?? {}).sort()).toEqual([
      'id',
      'leafDir',
      'swing',
      'wall',
      'width',
      'x',
      'y',
    ])
  })

  it('非法門 withDerivedWall 回 null', () => {
    const shape = normalize(vestibule())
    expect(withDerivedWall(doorAt(100, 100, '-', 70), shape)).toBeNull()
  })

  it('牆側＝非地板側：x=300 在凹槽段內是地板內部（無邊界）、在凹槽下方才是東界', () => {
    const shape = normalize(vestibule())
    // y=100 時 x=300 兩側皆為地板（基底與 extend 相接），不是邊界。
    expect(edgesAtPoint(300, 100, shape.edges)).toEqual([])
    expect(validateDoor(doorAt(300, 100, '+', 70), shape)).toEqual({
      ok: false,
      reason: 'hinge-off-edge',
    })
    // y=300 時 x=300 東側為牆體 → 推出 E。
    expect(withDerivedWall(doorAt(300, 300, '+', 70), shape)?.wall).toBe('E')
  })
})

/* ------------------------------------------------------------------ *
 * 合法性（D6）
 * ------------------------------------------------------------------ */

describe('合法性', () => {
  it('跨距超出極大牆段 → span-exceeds-wall', () => {
    const shape = normalize(vestibule())
    // 東牆段 y∈[0,270]；寬 300 的跨距為 y∈[−30,270]，上端超出。
    expect(validateDoor(doorAt(360, 270, '-', 300), shape)).toEqual({
      ok: false,
      reason: 'span-exceeds-wall',
    })
  })

  it('鉸鏈在房間內部 → hinge-off-edge', () => {
    const shape = normalize(vestibule())
    expect(validateDoor(doorAt(100, 100, '-', 70), shape)).toEqual({
      ok: false,
      reason: 'hinge-off-edge',
    })
  })

  it('鉸鏈在外接框上但非地板邊界（(360,300) 落在牆體 S 內）→ hinge-off-edge', () => {
    const shape = normalize(vestibule())
    // 該處地板東界已退回 x=300（edge x=300, y∈[270,400]），x=360 無地板邊界。
    expect(edgesAtPoint(360, 300, shape.edges)).toEqual([])
    expect(validateDoor(doorAt(360, 300, '-', 70), shape)).toEqual({
      ok: false,
      reason: 'hinge-off-edge',
    })
  })

  it('跨距端點與牆段端點齊平算落入', () => {
    const shape = normalize(vestibule())
    // 東牆段 y∈[0,270]；寬 270 的跨距恰為 y∈[0,270]。
    expect(validateDoor(doorAt(360, 270, '-', 270), shape)).toMatchObject({ ok: true, wall: 'E' })
  })
})

/* ------------------------------------------------------------------ *
 * 角點消歧（D6：先取跨距落入者，皆可／皆不可取 N→E→S→W）
 * ------------------------------------------------------------------ */

describe('角點消歧', () => {
  const shape = normalize(PURE_RECT)

  it('鉸鏈 (0,0) 同屬 N 與 W 兩段', () => {
    expect(edgesAtPoint(0, 0, shape.edges).map((e) => e.wall).sort()).toEqual(['N', 'W'])
  })

  it('兩段皆可落入 → 依 N→E→S→W 取 N，跨距 x∈[0,80]', () => {
    const input = doorAt(0, 0, '+', 80)
    expect(validateDoor(input, shape)).toMatchObject({ ok: true, wall: 'N' })
    const geom = doorGeometry(derivedDoor(shape, input))
    expect(geom.span).toEqual({ axis: 'x', lo: 0, hi: 80 })
  })

  it('只有一段可落入 → 取該段（(300,0) 的 N 跨距超界、E 跨距落入 → E）', () => {
    const input = doorAt(300, 0, '+', 80)
    expect(edgesAtPoint(300, 0, shape.edges).map((e) => e.wall).sort()).toEqual(['E', 'N'])
    expect(validateDoor(input, shape)).toMatchObject({ ok: true, wall: 'E' })
    const geom = doorGeometry(derivedDoor(shape, input))
    expect(geom.span).toEqual({ axis: 'y', lo: 0, hi: 80 })
  })

  it('兩段皆不可落入 → 仍依序取 N，並回報 span-exceeds-wall', () => {
    expect(validateDoor(doorAt(0, 0, '-', 80), shape)).toEqual({
      ok: false,
      reason: 'span-exceeds-wall',
    })
  })
})

/* ------------------------------------------------------------------ *
 * 極大牆段：D9 (f) 邊界穩定案／房間變動後重跑
 * ------------------------------------------------------------------ */

describe('極大牆段與重跑', () => {
  it('D9 (f)：加入不相干 cutout 後東邊界仍為單一線段，既有門仍合法', () => {
    const input = doorAt(300, 270, '-', 70)
    const before = normalize(PURE_RECT)
    expect(validateDoor(input, before)).toMatchObject({ ok: true, wall: 'E' })

    const after = normalize({
      width: 300,
      depth: 400,
      blocks: [{ id: 'C1', kind: 'cutout', x: 0, y: 210, width: 40, depth: 40 }],
    })
    const eastEdges = after.edges.filter((e) => e.wall === 'E')
    expect(eastEdges).toEqual([{ x0: 300, y0: 0, x1: 300, y1: 400, wall: 'E' }])
    expect(validateDoor(input, after)).toMatchObject({ ok: true, wall: 'E' })
  })

  it('房間變動後重跑：extend 縮到 y∈[0,200] → 鉸鏈 (360,270) 不再附著', () => {
    const input = doorAt(360, 270, '-', 70)
    expect(validateDoor(input, normalize(vestibule()))).toMatchObject({ ok: true, wall: 'E' })
    expect(validateDoor(input, normalize(vestibule(200)))).toEqual({
      ok: false,
      reason: 'hinge-off-edge',
    })
  })
})

/* ------------------------------------------------------------------ *
 * 八格開象限表（D6）
 * ------------------------------------------------------------------ */

interface QuadrantRow {
  wall: Side
  leafDir: '+' | '-'
  hinge: { x: number; y: number }
  span: DoorSpan
  quadrant: Quadrant
  swingRect: Rect
}

/** D6 表八列，鉸鏈取各牆段內點（純矩形房 300×400，門寬 80、內開）。 */
const QUADRANT_ROWS: readonly QuadrantRow[] = [
  {
    wall: 'N',
    leafDir: '+',
    hinge: { x: 150, y: 0 },
    span: { axis: 'x', lo: 150, hi: 230 },
    quadrant: { xSign: 1, ySign: 1 },
    swingRect: { x0: 150, y0: 0, x1: 230, y1: 80 },
  },
  {
    wall: 'N',
    leafDir: '-',
    hinge: { x: 150, y: 0 },
    span: { axis: 'x', lo: 70, hi: 150 },
    quadrant: { xSign: -1, ySign: 1 },
    swingRect: { x0: 70, y0: 0, x1: 150, y1: 80 },
  },
  {
    wall: 'S',
    leafDir: '+',
    hinge: { x: 150, y: 400 },
    span: { axis: 'x', lo: 150, hi: 230 },
    quadrant: { xSign: 1, ySign: -1 },
    swingRect: { x0: 150, y0: 320, x1: 230, y1: 400 },
  },
  {
    wall: 'S',
    leafDir: '-',
    hinge: { x: 150, y: 400 },
    span: { axis: 'x', lo: 70, hi: 150 },
    quadrant: { xSign: -1, ySign: -1 },
    swingRect: { x0: 70, y0: 320, x1: 150, y1: 400 },
  },
  {
    wall: 'E',
    leafDir: '+',
    hinge: { x: 300, y: 200 },
    span: { axis: 'y', lo: 200, hi: 280 },
    quadrant: { xSign: -1, ySign: 1 },
    swingRect: { x0: 220, y0: 200, x1: 300, y1: 280 },
  },
  {
    wall: 'E',
    leafDir: '-',
    hinge: { x: 300, y: 200 },
    span: { axis: 'y', lo: 120, hi: 200 },
    quadrant: { xSign: -1, ySign: -1 },
    swingRect: { x0: 220, y0: 120, x1: 300, y1: 200 },
  },
  {
    wall: 'W',
    leafDir: '+',
    hinge: { x: 0, y: 200 },
    span: { axis: 'y', lo: 200, hi: 280 },
    quadrant: { xSign: 1, ySign: 1 },
    swingRect: { x0: 0, y0: 200, x1: 80, y1: 280 },
  },
  {
    wall: 'W',
    leafDir: '-',
    hinge: { x: 0, y: 200 },
    span: { axis: 'y', lo: 120, hi: 200 },
    quadrant: { xSign: 1, ySign: -1 },
    swingRect: { x0: 0, y0: 120, x1: 80, y1: 200 },
  },
]

describe('八格開象限表（內開）', () => {
  const shape = normalize(PURE_RECT)

  for (const row of QUADRANT_ROWS) {
    it(`${row.wall} 牆 leafDir ${row.leafDir}：跨距與開象限依表`, () => {
      const input = doorAt(row.hinge.x, row.hinge.y, row.leafDir, 80)
      const door = derivedDoor(shape, input)
      expect(door.wall).toBe(row.wall)
      const geom = doorGeometry(door)
      expect(geom.span).toEqual(row.span)
      expect(geom.quadrant).toEqual(row.quadrant)
      expect(geom.swingRect).toEqual(row.swingRect)
      // 內開迴旋區恆在外接框內。
      expect(intersectArea(geom.swingRect, shape.bounds)).toBe(80 * 80)
    })
  }
})

describe('外開（swing:"out"）', () => {
  const shape = normalize(PURE_RECT)

  /** 每一牆側各一案：沿牆軸符號與跨距不動，只翻垂直牆面那一軸。 */
  const OUT_ROWS: readonly { wall: Side; hinge: { x: number; y: number }; quadrant: Quadrant }[] = [
    { wall: 'N', hinge: { x: 150, y: 0 }, quadrant: { xSign: 1, ySign: -1 } },
    { wall: 'E', hinge: { x: 300, y: 200 }, quadrant: { xSign: 1, ySign: 1 } },
    { wall: 'S', hinge: { x: 150, y: 400 }, quadrant: { xSign: 1, ySign: 1 } },
    { wall: 'W', hinge: { x: 0, y: 200 }, quadrant: { xSign: -1, ySign: 1 } },
  ]

  for (const row of OUT_ROWS) {
    it(`${row.wall} 牆：垂直牆面的軸翻號、沿牆軸不變，迴旋區落在房外`, () => {
      const inGeom = doorGeometry(derivedDoor(shape, doorAt(row.hinge.x, row.hinge.y, '+', 80)))
      const outGeom = doorGeometry(
        derivedDoor(shape, doorAt(row.hinge.x, row.hinge.y, '+', 80, 'out')),
      )
      expect(outGeom.quadrant).toEqual(row.quadrant)
      // 跨距（沿牆軸）與門扇線段不受內／外開影響。
      expect(outGeom.span).toEqual(inGeom.span)
      expect(outGeom.leaf).toEqual(inGeom.leaf)
      // 恰有一軸翻號。
      const flipped =
        (outGeom.quadrant.xSign !== inGeom.quadrant.xSign ? 1 : 0) +
        (outGeom.quadrant.ySign !== inGeom.quadrant.ySign ? 1 : 0)
      expect(flipped).toBe(1)
      // 外開迴旋區整塊落在外接框外（與 bounds 零正面積）。
      expect(intersectArea(outGeom.swingRect, shape.bounds)).toBe(0)
    })
  }
})

/* ------------------------------------------------------------------ *
 * 裁象限相交謂詞（D6）
 * ------------------------------------------------------------------ */

describe('裁象限相交謂詞', () => {
  const shape = normalize(vestibule())
  // 鉸鏈 (360,270)、開象限 x<360 且 y<270、width 70。
  const geom = doorGeometry(derivedDoor(shape, doorAt(360, 270, '-', 70)))

  it('跨軸矩形：只有落在開象限內的部分算數', () => {
    // 橫跨 x=360：裁後 [350,360]×[250,260]，最近點 (360,260) 距 10。
    expect(intersectsSwing(geom, { x0: 350, y0: 250, x1: 400, y1: 260 })).toBe(true)
    // 橫跨 y=270：裁後 [340,355]×[260,270]，最近點 (355,270) 距 5。
    expect(intersectsSwing(geom, { x0: 340, y0: 260, x1: 355, y1: 300 })).toBe(true)
  })

  it('整塊落在開象限外 → false（即使離鉸鏈很近）', () => {
    // x 全在鉸鏈右側：裸最近點距 (370,260) 僅 √200，但不在開象限內。
    expect(intersectsSwing(geom, { x0: 370, y0: 250, x1: 400, y1: 260 })).toBe(false)
    // y 全在鉸鏈下方。
    expect(intersectsSwing(geom, { x0: 340, y0: 275, x1: 355, y1: 300 })).toBe(false)
    // 邊界嚴格：x0 恰等於 hx 不算落入開象限。
    expect(intersectsSwing(geom, { x0: 360, y0: 250, x1: 400, y1: 260 })).toBe(false)
  })

  it('貼門扇滑過：緊貼門扇線但超出迴旋半徑 → false；在半徑內 → true', () => {
    expect(intersectsSwing(geom, { x0: 300, y0: 100, x1: 360, y1: 150 })).toBe(false)
    expect(intersectsSwing(geom, { x0: 300, y0: 230, x1: 360, y1: 260 })).toBe(true)
  })

  it('恰好等於 width 為相切 → false；少 1 cm → true', () => {
    expect(intersectsSwing(geom, { x0: 340, y0: 100, x1: 360, y1: 200 })).toBe(false)
    expect(intersectsSwing(geom, { x0: 340, y0: 100, x1: 360, y1: 201 })).toBe(true)
  })

  it('鉸鏈在牆角：開象限 x>0,y>0，鄰牆另一側自動排除', () => {
    const rect = normalize(PURE_RECT)
    const corner = doorGeometry(derivedDoor(rect, doorAt(0, 0, '+', 80)))
    expect(corner.wall).toBe('N')
    expect(corner.quadrant).toEqual({ xSign: 1, ySign: 1 })
    expect(intersectsSwing(corner, { x0: 0, y0: 0, x1: 10, y1: 10 })).toBe(true)
    // 完全在 x<0（框外、鄰牆另一側）→ 排除。
    expect(intersectsSwing(corner, { x0: -20, y0: 0, x1: -5, y1: 10 })).toBe(false)
  })

  it('零面積矩形（退化）不算相交', () => {
    expect(intersectsSwing(geom, { x0: 350, y0: 260, x1: 350, y1: 265 })).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * 微型單元：edgesAtPoint／spanOnEdge／spanFits
 * ------------------------------------------------------------------ */

describe('跨距微型單元', () => {
  const north: Edge = { x0: 0, y0: 0, x1: 100, y1: 0, wall: 'N' }
  const east: Edge = { x0: 100, y0: 0, x1: 100, y1: 200, wall: 'E' }

  it('spanOnEdge 依 edge.wall 決定軸與方向', () => {
    expect(spanOnEdge({ x: 40, y: 0, leafDir: '+', width: 30 }, north)).toEqual({
      axis: 'x',
      lo: 40,
      hi: 70,
    })
    expect(spanOnEdge({ x: 40, y: 0, leafDir: '-', width: 30 }, north)).toEqual({
      axis: 'x',
      lo: 10,
      hi: 40,
    })
    expect(spanOnEdge({ x: 100, y: 50, leafDir: '+', width: 30 }, east)).toEqual({
      axis: 'y',
      lo: 50,
      hi: 80,
    })
  })

  it('spanFits：端點齊平算落入，超出一格即否', () => {
    expect(spanFits({ axis: 'x', lo: 0, hi: 100 }, north)).toBe(true)
    expect(spanFits({ axis: 'x', lo: -1, hi: 99 }, north)).toBe(false)
    expect(spanFits({ axis: 'x', lo: 1, hi: 101 }, north)).toBe(false)
    expect(spanFits({ axis: 'y', lo: 0, hi: 200 }, east)).toBe(true)
  })

  it('edgesAtPoint 含端點，且 deriveWall 對空 edges 回 hinge-off-edge', () => {
    expect(edgesAtPoint(100, 0, [north, east])).toEqual([north, east])
    expect(edgesAtPoint(50, 0, [north, east])).toEqual([north])
    expect(edgesAtPoint(50, 1, [north, east])).toEqual([])
    expect(deriveWall(doorAt(50, 0, '+', 10), [])).toEqual({
      ok: false,
      reason: 'hinge-off-edge',
    })
  })
})

/* ------------------------------------------------------------------ *
 * nearestPointOnEdges（磁吸；snap.ts／T1.8 呼叫）
 * ------------------------------------------------------------------ */

describe('nearestPointOnEdges', () => {
  const shape = normalize(PURE_RECT)

  it('靠近某段中段 → 投影點落在該段上、dist2 正確', () => {
    const near = nearestPointOnEdges(150, 5, shape.edges)
    expect(near).not.toBeNull()
    expect(near?.edge.wall).toBe('N')
    expect({ x: near?.x, y: near?.y }).toEqual({ x: 150, y: 0 })
    expect(near?.dist2).toBe(25)
  })

  it('超出線段端點時夾到端點（角落外側）', () => {
    const near = nearestPointOnEdges(-3, -4, shape.edges)
    expect({ x: near?.x, y: near?.y }).toEqual({ x: 0, y: 0 })
    expect(near?.dist2).toBe(25)
  })

  it('等距時取陣列先出現的一條', () => {
    const [first, second] = shape.edges
    // 房中心到東西兩牆段等距，兩者皆為縱向段。
    const near = nearestPointOnEdges(150, 200, shape.edges)
    expect(second.x0 - 150).toBe(150 - first.x0)
    expect(near?.edge).toBe(first)
    expect(near?.dist2).toBe(150 * 150)
  })

  it('edges 為空 → null', () => {
    expect(nearestPointOnEdges(10, 10, [])).toBeNull()
  })
})
