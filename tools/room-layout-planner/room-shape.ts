/**
 * 房間家具擺放規劃器 — D9 非矩形房間正規化（(internal design doc)
 * PLAN.md §D9「契約——正規化（`room-shape.ts`）」、§D9「M0 實作注意」、
 * §Verification「room-shape」）。
 *
 * 演算法逐條移植自 M0 spike `(internal design doc)`
 * （S4；`sp4/REPORT.md` 已以逐格參考實作對拍、427,914 項斷言驗證）：
 * bbox → cutout 裁框 → 帶分解 → 每帶 `floorX`／`wallX` → 逐條縱向
 * run-length 合併 → `edges` 極大共線同法線線段 → extend 自基底可達性
 * （r3.2）。**不做橫向合併**——S4 在隨機集與階梯、棋盤對抗集上加橫向合併
 * pass 與不加逐字相同，零收益，D9 明文否決。
 *
 * 呼叫圖葉節點：只取用 `geometry.js`（純函式）與 `model.js` 的型別，
 * 不參照 DOM。座標一律整數 cm，原點為基底矩形左上、y 向下；extend 貼
 * 北／西側時座標為負。
 */
import {
  normalizeIntervals,
  rectFromXYWH,
  subtractIntervals,
  type Interval,
  type Rect,
} from './geometry.js'
import type { RoomPlan, Side } from './model.js'

/**
 * 地板邊界線段（D9：「格邊一側是地板、另一側是牆體或框外者入列，再把
 * 共線、同法線側、端點相接者合併為極大線段」；門吸附與合法性以此為準）。
 *
 * `wall` ＝**相對地板**、非地板所在的那一側（`E` ＝牆在地板之東）。
 * 縱向段 `x0===x1`、橫向段 `y0===y1`；恆 `x0<=x1`、`y0<=y1`。
 */
export interface Edge {
  x0: number
  y0: number
  x1: number
  y1: number
  wall: Side
}

/** `normalize()` 輸出（D9）。`floor` 與 `walls` 恰好鋪滿 `bounds`。 */
export interface NormalizedRoom {
  /** bbox(基底 ∪ extends)；未連接的 extend 一樣撐大 `bounds`。 */
  bounds: Rect
  /** 帶分解＋逐條縱向合併後的地板矩形，兩兩不重疊。 */
  floor: Rect[]
  /** `bounds` − 地板，同一套帶分解＋逐條縱向合併，兩兩不重疊。 */
  walls: Rect[]
  /** 極大地板邊界線段。 */
  edges: Edge[]
  /**
   * 自基底不可達的 extend block id（D9 r3.2：相鄰＝共享正長度邊，角點
   * 相接不算；取傳遞閉包）。不可達者仍計入 `floor` 與 `bounds`，只在
   * report 標「未連接」、不阻擋拖曳。
   */
  unconnected: string[]
  stats: {
    /** 水平帶數。 */
    bands: number
    /** 縱向合併**前**的牆體樸素條數（D9 階梯族 9／2,500 等釘死值）。 */
    naiveStrips: number
  }
}

/** `normalize()` 輸入：只看房間寬深與 blocks，不看門與家具。 */
export type RoomShapeInput = Pick<RoomPlan['room'], 'width' | 'depth' | 'blocks'>

/** 一條水平帶：`[ya, yb]` 內地板在 y 方向為常數，故只需記 x 區間。 */
interface Band {
  ya: number
  yb: number
  floorX: Interval[]
  wallX: Interval[]
}

/** 縱向 `edges` 分組：同一 x 與同一法線側的候選段，待串成極大線段。 */
interface VerticalGroup {
  x: number
  wall: Side
  segs: Interval[]
}

/**
 * 多段被減數的區間差集：逐段呼叫 `subtractIntervals`（其內部以
 * `normalizeIntervals` 把 `cuts` **相接亦合併**，D9「M0 實作注意」；否則
 * `[[0,3],[3,10]]` 會把整面牆的 `edges` 切段）。被減數若本身兩兩不相接，
 * 輸出亦為極大區間集合。
 */
function subtractAll(bases: Interval[], cuts: Interval[]): Interval[] {
  const result: Interval[] = []
  for (const base of bases) {
    for (const piece of subtractIntervals(base, cuts)) result.push(piece)
  }
  return result
}

/**
 * 逐條縱向 run-length 合併（D9：**非整帶集合比對**）——對每條帶內矩形，
 * 若下一帶存在 x 區間完全相同且 y 相鄰者則原地延長 `y1`，否則開新條。
 * `open` 只保留「上一帶尚可延續」的條，故輸出兩兩不重疊。
 */
function mergeVertical(bands: Band[], key: 'floorX' | 'wallX'): Rect[] {
  const result: Rect[] = []
  let open = new Map<string, Rect>()
  for (const band of bands) {
    const next = new Map<string, Rect>()
    for (const iv of band[key]) {
      const k = `${iv.lo}:${iv.hi}`
      const previous = open.get(k)
      if (previous !== undefined && previous.y1 === band.ya) {
        // 原地延長；`result` 內為同一物件參考，故同步更新。
        previous.y1 = band.yb
        next.set(k, previous)
      } else {
        const rect: Rect = { x0: iv.lo, y0: band.ya, x1: iv.hi, y1: band.yb }
        result.push(rect)
        next.set(k, rect)
      }
    }
    open = next
  }
  return result
}

/**
 * `edges`：帶分解保證「橫向格邊只可能出現在帶界線上、縱向格邊只可能出現
 * 在 `floorX` 各區間端點 x 上」，故解析式與 D9 條文的逐格定義等價
 * （S4 已以 `sp4/brute.mjs` 對拍證實）。
 */
function buildEdges(bands: Band[], ys: number[]): Edge[] {
  const edges: Edge[] = []

  // 縱向：每帶地板區間的左端 ⇒ 牆在西（W）、右端 ⇒ 牆在東（E）；
  // 再依 (x, wall) 分組、依 y 排序、端點相接者串成極大線段。
  const groups = new Map<string, VerticalGroup>()
  const collect = (x: number, wall: Side, lo: number, hi: number): void => {
    const key = `${x}|${wall}`
    let group = groups.get(key)
    if (group === undefined) {
      group = { x, wall, segs: [] }
      groups.set(key, group)
    }
    group.segs.push({ lo, hi })
  }
  for (const band of bands) {
    for (const iv of band.floorX) {
      collect(iv.lo, 'W', band.ya, band.yb)
      collect(iv.hi, 'E', band.ya, band.yb)
    }
  }
  for (const group of groups.values()) {
    const segs = group.segs.slice().sort((p, q) => p.lo - q.lo)
    let current: Edge | null = null
    for (const seg of segs) {
      if (current !== null && current.y1 === seg.lo) {
        current.y1 = seg.hi
      } else {
        current = { x0: group.x, y0: seg.lo, x1: group.x, y1: seg.hi, wall: group.wall }
        edges.push(current)
      }
    }
  }

  // 橫向：每條帶界線上，地板只在南側 ⇒ 牆在北（N）、只在北側 ⇒ 牆在南（S）。
  // 區間差集的輸出天生即極大，無需再合併。
  const none: Interval[] = []
  for (let i = 0; i < ys.length; i++) {
    const above = i > 0 ? bands[i - 1].floorX : none
    const below = i < bands.length ? bands[i].floorX : none
    const y = ys[i]
    for (const iv of subtractAll(below, above)) {
      edges.push({ x0: iv.lo, y0: y, x1: iv.hi, y1: y, wall: 'N' })
    }
    for (const iv of subtractAll(above, below)) {
      edges.push({ x0: iv.lo, y0: y, x1: iv.hi, y1: y, wall: 'S' })
    }
  }

  return edges
}

/** 兩矩形是否共享正長度邊界（含正面積重疊）；角點相接（兩軸皆 0）為否。 */
function sharesPositiveEdge(a: Rect, b: Rect): boolean {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w >= 0 && h >= 0 && (w > 0 || h > 0)
}

/**
 * extend 連接性（D9 r3.2 定案）：以**自基底出發的相鄰關係傳遞閉包**判定。
 * 兩個互相接觸但整體懸空的 extends 因此**雙雙**列為未連接（字面規則會讓
 * 它們互相認證，S4 §範圍外觀察 6）。
 */
function findUnconnected(base: Rect, rects: Rect[], ids: string[]): string[] {
  const reached: boolean[] = new Array<boolean>(rects.length).fill(false)
  let frontier: Rect[] = [base]
  while (frontier.length > 0) {
    const nextFrontier: Rect[] = []
    for (const from of frontier) {
      for (let i = 0; i < rects.length; i++) {
        if (reached[i]) continue
        if (sharesPositiveEdge(from, rects[i])) {
          reached[i] = true
          nextFrontier.push(rects[i])
        }
      }
    }
    frontier = nextFrontier
  }
  const unconnected: string[] = []
  for (let i = 0; i < ids.length; i++) {
    if (!reached[i]) unconnected.push(ids[i])
  }
  return unconnected
}

/**
 * D9 正規化：`bounds` ＝ bbox(基底 ∪ extends)；地板 ＝ (基底 ∪ extends)
 * − cutouts（**cutout 優先於 extend**，實作形式為「先聯集正矩形、再整體
 * 相減」）；牆體 ＝ `bounds` − 地板。cutout 裁到 `bounds` 內，**裁切後為
 * 空者直接忽略**。
 */
export function normalize(room: RoomShapeInput): NormalizedRoom {
  const base: Rect = { x0: 0, y0: 0, x1: room.width, y1: room.depth }
  const extendIds: string[] = []
  const extendRects: Rect[] = []
  const rawCutouts: Rect[] = []
  for (const block of room.blocks) {
    const rect = rectFromXYWH(block.x, block.y, block.width, block.depth)
    if (block.kind === 'extend') {
      extendIds.push(block.id)
      extendRects.push(rect)
    } else {
      rawCutouts.push(rect)
    }
  }

  // --- bounds ＝ bbox(基底 ∪ extends) ---
  let minX = base.x0
  let minY = base.y0
  let maxX = base.x1
  let maxY = base.y1
  for (const r of extendRects) {
    if (r.x0 < minX) minX = r.x0
    if (r.y0 < minY) minY = r.y0
    if (r.x1 > maxX) maxX = r.x1
    if (r.y1 > maxY) maxY = r.y1
  }
  const bounds: Rect = { x0: minX, y0: minY, x1: maxX, y1: maxY }

  // --- cutout 裁到 bounds 內；裁切後為空者忽略 ---
  const cutouts: Rect[] = []
  for (const c of rawCutouts) {
    const x0 = Math.max(c.x0, minX)
    const x1 = Math.min(c.x1, maxX)
    const y0 = Math.max(c.y0, minY)
    const y1 = Math.min(c.y1, maxY)
    if (x1 > x0 && y1 > y0) cutouts.push({ x0, y0, x1, y1 })
  }

  // --- 以所有矩形的 y 邊界切水平帶（帶內地板在 y 方向為常數）---
  const positives: Rect[] = [base, ...extendRects]
  const ySet = new Set<number>([minY, maxY])
  for (const r of positives) {
    ySet.add(r.y0)
    ySet.add(r.y1)
  }
  for (const r of cutouts) {
    ySet.add(r.y0)
    ySet.add(r.y1)
  }
  const ys = [...ySet].filter((y) => y >= minY && y <= maxY).sort((a, b) => a - b)

  const fullSpan: Interval[] = [{ lo: minX, hi: maxX }]
  const bands: Band[] = []
  let naiveStrips = 0
  for (let i = 0; i + 1 < ys.length; i++) {
    const ya = ys[i]
    const yb = ys[i + 1]
    const positiveX: Interval[] = []
    for (const r of positives) {
      if (r.y0 <= ya && r.y1 >= yb) positiveX.push({ lo: r.x0, hi: r.x1 })
    }
    const negativeX: Interval[] = []
    for (const r of cutouts) {
      if (r.y0 <= ya && r.y1 >= yb) negativeX.push({ lo: r.x0, hi: r.x1 })
    }
    const floorX = subtractAll(normalizeIntervals(positiveX), negativeX)
    const wallX = subtractAll(fullSpan, floorX)
    naiveStrips += wallX.length
    bands.push({ ya, yb, floorX, wallX })
  }

  return {
    bounds,
    floor: mergeVertical(bands, 'floorX'),
    walls: mergeVertical(bands, 'wallX'),
    edges: buildEdges(bands, ys),
    unconnected: findUnconnected(base, extendRects, extendIds),
    stats: { bands: bands.length, naiveStrips },
  }
}

/**
 * 外接框四邊的零厚矩形，依 **N、E、S、W** 序（D4：`clearanceCore` 的
 * `walls` ＝ D9 牆體矩形 ＋ 本函式輸出；`frame:N|E|S|W` 的 id 由
 * `clearance.ts` 指派）。純矩形房牆體集合為空，仍恆以這四邊補入。
 */
export function frameEdges(bounds: Rect): Rect[] {
  return [
    { x0: bounds.x0, y0: bounds.y0, x1: bounds.x1, y1: bounds.y0 },
    { x0: bounds.x1, y0: bounds.y0, x1: bounds.x1, y1: bounds.y1 },
    { x0: bounds.x0, y0: bounds.y1, x1: bounds.x1, y1: bounds.y1 },
    { x0: bounds.x0, y0: bounds.y0, x1: bounds.x0, y1: bounds.y1 },
  ]
}
