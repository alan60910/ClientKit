/**
 * T1.5（(internal design doc) §D9「非矩形房間」、§D9「M0
 * 實作注意」、§Verification「room-shape」）：D9 釘死 fixture（階梯族
 * 9／3 與 2,500／50、棋盤 650、純矩形房 4 段 `edges`、L 形、使用者玄關
 * 凹槽、柱子八段法線、cutout 勝 extend、懸空／角點／互相接觸的 extend
 * 連接性、負座標、D9 (f) 東界單一線段、實務 3-block 房）、`frameEdges`，
 * 以及移植自 `sp4/brute.mjs` 的**逐格參考實作對拍**與種子化 property
 * test（面積守恆、輸出互斥、半整數格心取樣、`edges` 極大性）。
 *
 * fixture 與 property harness 皆移植自 M0 spike
 * `(internal design doc)`（`fixtures.mjs`／`run.mjs`）。
 * **點取樣一律用半整數格心**：整數中點會正好壓在兩塊地板矩形的接縫上，
 * 嚴格內部測試兩側皆判否而造成假失敗（S4 實錄）。
 */
import { describe, expect, it } from 'vitest'
import { intersectArea, rectArea, rectFromXYWH, type Rect } from './geometry.js'
import type { RoomBlock, Side } from './model.js'
import { bruteAreas, bruteEdges, sortedEdgeKeys } from './room-shape-oracle.js'
import { frameEdges, normalize, type Edge, type RoomShapeInput } from './room-shape.js'

/* ------------------------------------------------------------------ *
 * 測試工具
 * ------------------------------------------------------------------ */

const totalArea = (rects: Rect[]): number => rects.reduce((sum, r) => sum + rectArea(r), 0)

const sortRects = (rects: Rect[]): Rect[] =>
  rects.slice().sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0 || a.x1 - b.x1 || a.y1 - b.y1)

/** 第一組正面積重疊的索引對；無則 null（輸出兩兩不重疊的檢查）。 */
function firstOverlappingPair(rects: Rect[]): [number, number] | null {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (intersectArea(rects[i], rects[j]) > 0) return [i, j]
    }
  }
  return null
}

/**
 * 第一組「x 區間完全相同且 y 相鄰」的索引對；無則 null。逐條縱向 run-length
 * 合併（D9）跑到位時恆為 null——`open` map 保有上一帶每一條，故同 x 區間
 * 的相鄰帶必被併掉。這條不變量直接鎖住合併本身（否則只有階梯族等固定
 * fixture 抓得到）。
 */
function firstUnmergedPair(rects: Rect[]): [number, number] | null {
  for (let i = 0; i < rects.length; i++) {
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue
      const a = rects[i]
      const b = rects[j]
      if (a.x0 === b.x0 && a.x1 === b.x1 && a.y1 === b.y0) return [i, j]
    }
  }
  return null
}

/** 嚴格內部；取樣點恆為半整數格心，故不會壓在矩形邊界上。 */
const inside = (px: number, py: number, r: Rect): boolean =>
  px > r.x0 && px < r.x1 && py > r.y0 && py < r.y1

const hasEdge = (
  edges: Edge[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  wall: Side,
): boolean => sortedEdgeKeys(edges).includes(`${x0},${y0},${x1},${y1},${wall}`)

/** 法線半格位移：`wall` 指向非地板側，故「地板側」＝減去法線。 */
const NORMALS: Record<Side, { nx: number; ny: number }> = {
  N: { nx: 0, ny: -0.5 },
  S: { nx: 0, ny: 0.5 },
  E: { nx: 0.5, ny: 0 },
  W: { nx: -0.5, ny: 0 },
}

/** mulberry32 種子亂數（移植自 `sp4/room-shape.mjs`，可重現）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 小型隨機房：`bounds` 面積受控，逐格 oracle 才跑得動。 */
function randomSmallRoom(rnd: () => number, k: number): RoomShapeInput {
  const ri = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
  const width = ri(6, 30)
  const depth = ri(6, 30)
  const blocks: RoomBlock[] = []
  for (let i = 0; i < k; i++) {
    blocks.push({
      id: `b${i}`,
      kind: rnd() < 0.5 ? 'extend' : 'cutout',
      x: ri(-8, width + 8),
      y: ri(-8, depth + 8),
      width: ri(1, 12),
      depth: ri(1, 12),
    })
  }
  return { width, depth, blocks }
}

/* ------------------------------------------------------------------ *
 * D9 釘死 fixture（移植自 sp4/fixtures.mjs）
 * ------------------------------------------------------------------ */

/** 階梯族：`cutout_i = x∈[2i,2i+1] × y∈[i, i+k]`，i=0…k−1，基底 2k×2k。 */
function staircase(k: number): RoomShapeInput {
  const blocks: RoomBlock[] = []
  for (let i = 0; i < k; i++) {
    blocks.push({ id: `s${i}`, kind: 'cutout', x: 2 * i, y: i, width: 1, depth: k })
  }
  return { width: 2 * k, depth: 2 * k, blocks }
}

/** 棋盤：縱 25 條 × 橫 25 條，基底 50×50。 */
function checkerboard(): RoomShapeInput {
  const blocks: RoomBlock[] = []
  for (let i = 0; i < 25; i++) {
    blocks.push({ id: `v${i}`, kind: 'cutout', x: 2 * i, y: 0, width: 1, depth: 50 })
  }
  for (let j = 0; j < 25; j++) {
    blocks.push({ id: `h${j}`, kind: 'cutout', x: 0, y: 2 * j, width: 50, depth: 1 })
  }
  return { width: 50, depth: 50, blocks }
}

const pureRect = (): RoomShapeInput => ({ width: 300, depth: 400, blocks: [] })

const lShape = (): RoomShapeInput => ({
  width: 300,
  depth: 400,
  blocks: [{ id: 'L', kind: 'cutout', x: 200, y: 0, width: 100, depth: 150 }],
})

/** 使用者玄關凹槽（D9 釘死實例）。 */
const vestibule = (): RoomShapeInput => ({
  width: 300,
  depth: 400,
  blocks: [{ id: 'E1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }],
})

/** 柱子：房內不觸邊的 cutout。 */
const pillar = (): RoomShapeInput => ({
  width: 300,
  depth: 400,
  blocks: [{ id: 'P', kind: 'cutout', x: 120, y: 150, width: 40, depth: 40 }],
})

const floatingExtend = (): RoomShapeInput => ({
  width: 300,
  depth: 400,
  blocks: [{ id: 'F', kind: 'extend', x: 400, y: 500, width: 60, depth: 60 }],
})

const cornerTouchExtend = (): RoomShapeInput => ({
  width: 300,
  depth: 400,
  blocks: [{ id: 'C', kind: 'extend', x: 300, y: 400, width: 60, depth: 60 }],
})

/** 兩個互相接觸但整體懸空的 extends（r3.2 自基底可達性的分歧案）。 */
const floatingPair = (): RoomShapeInput => ({
  width: 300,
  depth: 400,
  blocks: [
    { id: 'P1', kind: 'extend', x: 400, y: 100, width: 60, depth: 60 },
    { id: 'P2', kind: 'extend', x: 460, y: 100, width: 60, depth: 60 },
  ],
})

const negativeExtend = (): RoomShapeInput => ({
  width: 300,
  depth: 400,
  blocks: [{ id: 'N1', kind: 'extend', x: -60, y: -40, width: 60, depth: 100 }],
})

/** cutout 落在 extend 內部：cutout 勝 extend。 */
const cutoutBeatsExtend = (): RoomShapeInput => ({
  width: 100,
  depth: 100,
  blocks: [
    { id: 'E', kind: 'extend', x: 100, y: 0, width: 60, depth: 100 },
    { id: 'C', kind: 'cutout', x: 120, y: 0, width: 20, depth: 100 },
  ],
})

/** D9 (f) 邊界穩定案：純矩形房 ＋ 西牆上一個不相干 cutout。 */
const d9f = (): RoomShapeInput => ({
  width: 300,
  depth: 400,
  blocks: [{ id: 'X', kind: 'cutout', x: 0, y: 210, width: 40, depth: 40 }],
})

/** 實務級 3-block 房（凹槽／出窗 ＋ 角落結構柱 ＋ 管道間）。 */
const realistic = (): RoomShapeInput => ({
  width: 420,
  depth: 360,
  blocks: [
    { id: 'E1', kind: 'extend', x: 420, y: 40, width: 60, depth: 220 },
    { id: 'C1', kind: 'cutout', x: 0, y: 0, width: 90, depth: 60 },
    { id: 'C2', kind: 'cutout', x: 180, y: 300, width: 50, depth: 60 },
  ],
})

/* ================================================================== *
 * 1. 純矩形房
 * ================================================================== */

describe('normalize — 純矩形房（D9：零 blocks 牆體集合為空）', () => {
  it('walls 為空、bounds 即基底、面積全歸地板', () => {
    const n = normalize(pureRect())
    expect(n.walls).toEqual([])
    expect(n.bounds).toEqual({ x0: 0, y0: 0, x1: 300, y1: 400 })
    expect(n.floor).toEqual([{ x0: 0, y0: 0, x1: 300, y1: 400 }])
    expect(n.stats).toEqual({ bands: 1, naiveStrips: 0 })
    expect(totalArea(n.floor) + totalArea(n.walls)).toBe(rectArea(n.bounds))
  })

  it('edges 恰 4 段，四邊座標與法線側逐字比對', () => {
    const n = normalize(pureRect())
    expect(n.edges).toHaveLength(4)
    expect(sortedEdgeKeys(n.edges)).toEqual(
      sortedEdgeKeys([
        { x0: 0, y0: 0, x1: 0, y1: 400, wall: 'W' },
        { x0: 300, y0: 0, x1: 300, y1: 400, wall: 'E' },
        { x0: 0, y0: 0, x1: 300, y1: 0, wall: 'N' },
        { x0: 0, y0: 400, x1: 300, y1: 400, wall: 'S' },
      ]),
    )
  })
})

/* ================================================================== *
 * 2. 階梯族與棋盤（D9 釘死值）
 * ================================================================== */

describe('normalize — 階梯族（D9 釘死值）', () => {
  it('k=3 → 樸素 9 條／合併後 3 條，且每條恰等於原 cutout', () => {
    const room = staircase(3)
    const n = normalize(room)
    expect(n.stats.naiveStrips).toBe(9)
    expect(n.walls).toHaveLength(3)
    expect(sortRects(n.walls)).toEqual(
      sortRects(room.blocks.map((b) => rectFromXYWH(b.x, b.y, b.width, b.depth))),
    )
  })

  it('k=50 → 樸素 2,500 條／合併後 50 條，且每條恰等於原 cutout', () => {
    const room = staircase(50)
    const n = normalize(room)
    expect(n.stats.naiveStrips).toBe(2500)
    expect(n.walls).toHaveLength(50)
    expect(sortRects(n.walls)).toEqual(
      sortRects(room.blocks.map((b) => rectFromXYWH(b.x, b.y, b.width, b.depth))),
    )
  })
})

describe('normalize — 棋盤對抗集（D9 釘死值 650）', () => {
  it('縱 25 × 橫 25 → 牆體 650 條（縱向合併省不到，樸素亦 650）', () => {
    const n = normalize(checkerboard())
    expect(n.walls).toHaveLength(650)
    expect(n.stats.naiveStrips).toBe(650)
    expect(totalArea(n.floor) + totalArea(n.walls)).toBe(rectArea(n.bounds))
    expect(firstOverlappingPair(n.walls)).toBeNull()
    expect(firstUnmergedPair(n.walls)).toBeNull()
    expect(firstUnmergedPair(n.floor)).toBeNull()
  })
})

/* ================================================================== *
 * 3. L 形／玄關凹槽／柱子
 * ================================================================== */

describe('normalize — L 形', () => {
  it('牆體恰 1 條＝角落 cutout，edges 6 段', () => {
    const n = normalize(lShape())
    expect(n.walls).toEqual([{ x0: 200, y0: 0, x1: 300, y1: 150 }])
    expect(n.edges).toHaveLength(6)
    expect(hasEdge(n.edges, 0, 0, 0, 400, 'W')).toBe(true)
    expect(hasEdge(n.edges, 200, 0, 200, 150, 'E')).toBe(true)
    expect(hasEdge(n.edges, 300, 150, 300, 400, 'E')).toBe(true)
  })
})

describe('normalize — 使用者玄關凹槽（D9 釘死實例座標）', () => {
  it('bounds [0,360]×[0,400]、牆體唯一一條 S＝[300,360]×[270,400]', () => {
    const n = normalize(vestibule())
    expect(n.bounds).toEqual({ x0: 0, y0: 0, x1: 360, y1: 400 })
    expect(n.walls).toEqual([{ x0: 300, y0: 270, x1: 360, y1: 400 }])
    expect(n.unconnected).toEqual([])
    expect(totalArea(n.floor) + totalArea(n.walls)).toBe(rectArea(n.bounds))
  })

  it('edges 6 段：東界兩段＋S 條的北面', () => {
    const n = normalize(vestibule())
    expect(n.edges).toHaveLength(6)
    expect(hasEdge(n.edges, 360, 0, 360, 270, 'E')).toBe(true)
    expect(hasEdge(n.edges, 300, 270, 300, 400, 'E')).toBe(true)
    expect(hasEdge(n.edges, 300, 270, 360, 270, 'S')).toBe(true)
    expect(n.edges.filter((e) => e.wall === 'E')).toHaveLength(2)
  })
})

describe('normalize — 柱子（房內不觸邊的 cutout）', () => {
  it('3 帶、牆體恰 1 條且等於 cutout 本身', () => {
    const n = normalize(pillar())
    expect(n.stats).toEqual({ bands: 3, naiveStrips: 1 })
    expect(n.walls).toEqual([{ x0: 120, y0: 150, x1: 160, y1: 190 }])
  })

  it('edges 8 段＝外框 4 ＋ 柱面 4，四面法線各自斷言（朝房內反向）', () => {
    const n = normalize(pillar())
    expect(n.edges).toHaveLength(8)
    // 柱子西面：牆在地板之東
    expect(hasEdge(n.edges, 120, 150, 120, 190, 'E')).toBe(true)
    // 柱子東面：牆在地板之西
    expect(hasEdge(n.edges, 160, 150, 160, 190, 'W')).toBe(true)
    // 柱子北面：牆在地板之南
    expect(hasEdge(n.edges, 120, 150, 160, 150, 'S')).toBe(true)
    // 柱子南面：牆在地板之北
    expect(hasEdge(n.edges, 120, 190, 160, 190, 'N')).toBe(true)
  })
})

/* ================================================================== *
 * 4. cutout 勝 extend
 * ================================================================== */

describe('normalize — cutout 勝 extend（D9）', () => {
  it('cutout 落在 extend 內部 → 挖穿，extend 蓋不回', () => {
    const n = normalize(cutoutBeatsExtend())
    expect(n.bounds).toEqual({ x0: 0, y0: 0, x1: 160, y1: 100 })
    expect(n.walls).toEqual([{ x0: 120, y0: 0, x1: 140, y1: 100 }])
    expect(n.edges).toHaveLength(8)
    expect(totalArea(n.floor) + totalArea(n.walls)).toBe(rectArea(n.bounds))
  })

  it('完全落在 bounds 外的 cutout 裁切後為空 → 直接忽略', () => {
    const n = normalize({
      width: 300,
      depth: 400,
      blocks: [{ id: 'Z', kind: 'cutout', x: 900, y: 900, width: 50, depth: 50 }],
    })
    expect(n.bounds).toEqual({ x0: 0, y0: 0, x1: 300, y1: 400 })
    expect(n.walls).toEqual([])
    expect(n.edges).toHaveLength(4)
  })
})

/* ================================================================== *
 * 5. extend 連接性（r3.2 自基底傳遞閉包）
 * ================================================================== */

describe('normalize — extend 連接性（D9 r3.2）', () => {
  it('懸空 extend → unconnected [F]，但仍計入 floor 與 bounds', () => {
    const n = normalize(floatingExtend())
    expect(n.unconnected).toEqual(['F'])
    expect(n.bounds).toEqual({ x0: 0, y0: 0, x1: 460, y1: 560 })
    expect(n.floor).toContainEqual({ x0: 400, y0: 500, x1: 460, y1: 560 })
    expect(totalArea(n.floor) + totalArea(n.walls)).toBe(rectArea(n.bounds))
  })

  it('角點相接（兩軸交集長度皆 0）→ 仍屬未連接', () => {
    const n = normalize(cornerTouchExtend())
    expect(n.unconnected).toEqual(['C'])
  })

  it('兩個互相接觸但整體懸空的 extends → **雙雙**未連接（傳遞閉包自基底出發）', () => {
    const n = normalize(floatingPair())
    expect(n.unconnected).toEqual(['P1', 'P2'])
  })

  it('與基底共享正長度邊的 extend → 已連接', () => {
    expect(normalize(vestibule()).unconnected).toEqual([])
    expect(normalize(negativeExtend()).unconnected).toEqual([])
  })
})

/* ================================================================== *
 * 6. 負座標與面積守恆
 * ================================================================== */

describe('normalize — 負座標 extend（北／西側外擴）', () => {
  it('bounds minX／minY 為負，面積守恆且輸出互斥', () => {
    const n = normalize(negativeExtend())
    expect(n.bounds).toEqual({ x0: -60, y0: -40, x1: 300, y1: 400 })
    expect(rectArea(n.bounds)).toBe(360 * 440)
    expect(totalArea(n.floor) + totalArea(n.walls)).toBe(rectArea(n.bounds))
    expect(firstOverlappingPair(n.walls)).toBeNull()
    expect(firstOverlappingPair(n.floor)).toBeNull()
  })
})

/* ================================================================== *
 * 7. D9 (f) 邊界穩定（edges 合併為極大線段）
 * ================================================================== */

describe('normalize — edges 極大線段（D9 (f) 反向案）', () => {
  it('加入不相干 cutout [0,40]×[210,250] 後，東邊界仍是單一線段', () => {
    const n = normalize(d9f())
    const east = n.edges.filter((e) => e.wall === 'E')
    expect(east).toHaveLength(1)
    expect(east[0]).toEqual({ x0: 300, y0: 0, x1: 300, y1: 400, wall: 'E' })
  })

  it('同一房型未加 cutout 時東界亦為單一線段（對照組）', () => {
    const east = normalize(pureRect()).edges.filter((e) => e.wall === 'E')
    expect(east).toEqual([{ x0: 300, y0: 0, x1: 300, y1: 400, wall: 'E' }])
  })
})

/* ================================================================== *
 * 8. 實務 3-block 房
 * ================================================================== */

describe('normalize — 實務 3-block 房（S4 記錄值）', () => {
  it('5 帶／樸素 6 條／合併後 4 條／edges 14 段', () => {
    const n = normalize(realistic())
    expect(n.stats).toEqual({ bands: 5, naiveStrips: 6 })
    expect(n.walls).toHaveLength(4)
    expect(n.edges).toHaveLength(14)
    expect(n.unconnected).toEqual([])
    expect(totalArea(n.floor) + totalArea(n.walls)).toBe(rectArea(n.bounds))
    expect(firstOverlappingPair(n.walls)).toBeNull()
    expect(firstOverlappingPair(n.floor)).toBeNull()
  })
})

/* ================================================================== *
 * 9. frameEdges
 * ================================================================== */

describe('frameEdges（D4：外接框四邊零厚矩形，N／E／S／W 序）', () => {
  it('純矩形房 bounds → 四條零厚矩形', () => {
    expect(frameEdges({ x0: 0, y0: 0, x1: 300, y1: 400 })).toEqual([
      { x0: 0, y0: 0, x1: 300, y1: 0 },
      { x0: 300, y0: 0, x1: 300, y1: 400 },
      { x0: 0, y0: 400, x1: 300, y1: 400 },
      { x0: 0, y0: 0, x1: 0, y1: 400 },
    ])
  })

  it('負原點 bounds → 座標跟著平移，四條面積皆 0', () => {
    const frame = frameEdges(normalize(negativeExtend()).bounds)
    expect(frame).toEqual([
      { x0: -60, y0: -40, x1: 300, y1: -40 },
      { x0: 300, y0: -40, x1: 300, y1: 400 },
      { x0: -60, y0: 400, x1: 300, y1: 400 },
      { x0: -60, y0: -40, x1: -60, y1: 400 },
    ])
    expect(frame.map(rectArea)).toEqual([0, 0, 0, 0])
  })
})

/* ================================================================== *
 * 10. 逐格參考實作對拍（固定 fixture）
 * ================================================================== */

describe('逐格參考實作對拍（移植 sp4/brute.mjs）', () => {
  const cases: [string, RoomShapeInput][] = [
    ['pureRect', pureRect()],
    ['lShape', lShape()],
    ['vestibule', vestibule()],
    ['pillar', pillar()],
    ['cutoutBeatsExtend', cutoutBeatsExtend()],
    ['negativeExtend', negativeExtend()],
    ['d9f', d9f()],
    ['staircase k=3', staircase(3)],
    ['staircase k=9', staircase(9)],
    ['checkerboard', checkerboard()],
    ['floatingExtend', floatingExtend()],
    ['cornerTouchExtend', cornerTouchExtend()],
    ['floatingPair', floatingPair()],
    ['realistic', realistic()],
  ]

  for (const [name, room] of cases) {
    it(`${name}：edges 與地板／牆體面積皆與逐格參考逐字相符`, () => {
      const n = normalize(room)
      const brute = bruteAreas(room)
      expect(sortedEdgeKeys(n.edges)).toEqual(sortedEdgeKeys(bruteEdges(room)))
      expect(totalArea(n.floor)).toBe(brute.floorArea)
      expect(totalArea(n.walls)).toBe(brute.wallArea)
      expect(rectArea(n.bounds)).toBe(brute.boundsArea)
    })
  }
})

/* ================================================================== *
 * 11. property test（種子化；每 k 200 房）
 * ================================================================== */

const SEED = 0x5a4d0001
const SEED_HEX = `0x${SEED.toString(16)}`
const ROOMS_PER_K = 200
const SAMPLE_POINTS = 120

describe(`property test — 小隨機房（mulberry32 seed ${SEED_HEX}，每 k ${ROOMS_PER_K} 房）`, () => {
  for (const k of [1, 2, 3, 5, 8]) {
    it(`k=${k}：面積守恆／輸出互斥／半整數格心取樣／edges 對拍與極大性（seed ${SEED_HEX}）`, () => {
      const rnd = mulberry32((SEED + k * 7919) >>> 0)
      for (let t = 0; t < ROOMS_PER_K; t++) {
        const room = randomSmallRoom(rnd, k)
        const label = `k=${k} #${t}`
        const n = normalize(room)
        const isFloorAt = (x: number, y: number): boolean => n.floor.some((r) => inside(x, y, r))

        // (i) 面積守恆 ＋ 逐格 oracle 面積
        const brute = bruteAreas(room)
        expect(totalArea(n.floor) + totalArea(n.walls), `${label} 面積守恆`).toBe(
          rectArea(n.bounds),
        )
        expect(totalArea(n.floor), `${label} 地板面積 ≡ 逐格`).toBe(brute.floorArea)
        expect(totalArea(n.walls), `${label} 牆體面積 ≡ 逐格`).toBe(brute.wallArea)

        // (ii) 兩兩不重疊（牆體、地板各自）＋逐條縱向合併已到極大
        expect(firstOverlappingPair(n.walls), `${label} 牆體兩兩交集面積 0`).toBeNull()
        expect(firstOverlappingPair(n.floor), `${label} 地板兩兩交集面積 0`).toBeNull()
        expect(firstUnmergedPair(n.walls), `${label} 牆體有同 x 區間且 y 相鄰者未合併`).toBeNull()
        expect(firstUnmergedPair(n.floor), `${label} 地板有同 x 區間且 y 相鄰者未合併`).toBeNull()

        // (iii) 半整數格心取樣：恰落在 floor 或恰一條 wall
        let badPoints = 0
        for (let s = 0; s < SAMPLE_POINTS; s++) {
          const px = n.bounds.x0 + Math.floor(rnd() * (n.bounds.x1 - n.bounds.x0)) + 0.5
          const py = n.bounds.y0 + Math.floor(rnd() * (n.bounds.y1 - n.bounds.y0)) + 0.5
          let hits = 0
          for (const r of n.floor) if (inside(px, py, r)) hits++
          for (const r of n.walls) if (inside(px, py, r)) hits++
          if (hits !== 1) badPoints++
        }
        expect(badPoints, `${label} 取樣點非「恰落在 floor 或恰一條 wall」`).toBe(0)

        // (iv) edges 與逐格參考實作對拍
        expect(sortedEdgeKeys(n.edges), `${label} edges ≡ 逐格`).toEqual(
          sortedEdgeKeys(bruteEdges(room)),
        )

        // (v) edges 法線側正確且已合併到極大
        let badSides = 0
        let notMaximal = 0
        for (const e of n.edges) {
          const vertical = e.x0 === e.x1
          const mx = vertical ? e.x0 : Math.floor((e.x0 + e.x1) / 2) + 0.5
          const my = vertical ? Math.floor((e.y0 + e.y1) / 2) + 0.5 : e.y0
          const { nx, ny } = NORMALS[e.wall]
          if (!isFloorAt(mx - nx, my - ny) || isFloorAt(mx + nx, my + ny)) badSides++
          // 極大性：兩端各再前進一格後，同法線的「地板／非地板」配對必不再成立
          const dx = vertical ? 0 : 1
          const dy = vertical ? 1 : 0
          for (const sgn of [-1, 1]) {
            const ex = (sgn < 0 ? e.x0 : e.x1) + sgn * dx * 0.5
            const ey = (sgn < 0 ? e.y0 : e.y1) + sgn * dy * 0.5
            if (isFloorAt(ex - nx, ey - ny) && !isFloorAt(ex + nx, ey + ny)) notMaximal++
          }
        }
        expect(badSides, `${label} edges 法線側判定錯誤`).toBe(0)
        expect(notMaximal, `${label} edges 未合併到極大`).toBe(0)
      }
    })
  }
})

/* ================================================================== *
 * 12. 計時（資訊用，不作斷言——Node 值隨機器浮動）
 * ================================================================== */

describe('normalize 計時（資訊用，不斷言）', () => {
  it('棋盤 50 塊 / 650 條：印出 p50／p95 供參考', () => {
    const room = checkerboard()
    for (let i = 0; i < 10; i++) normalize(room)
    const samples: number[] = []
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now()
      normalize(room)
      samples.push(performance.now() - t0)
    }
    samples.sort((a, b) => a - b)
    const p50 = samples[Math.floor(samples.length * 0.5)]
    const p95 = samples[Math.floor(samples.length * 0.95)]
    console.log(
      `[room-shape] checkerboard normalize(): p50 ${p50.toFixed(3)} ms / p95 ${p95.toFixed(3)} ms`,
    )
    expect(normalize(room).walls).toHaveLength(650)
  })
})
