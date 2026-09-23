/**
 * T1.6 — 門（(internal design doc) §D6「門」：`wall` 由 x,y
 * 推導＋角點消歧、開象限表、合法性（跨距須落在極大牆段內）、裁象限相交
 * 謂詞；§D4「契約——門洞」：`leaf` 零厚門扇線段＋跨距供 clearance.ts 判
 * 條件 (b)(c)；§D9 玄關實例與反向案 (a)(f)；§Verification「door」）。
 *
 * 本檔為純邏輯葉模組：只取用 `geometry.js` 與 `model.js` 的型別、
 * `room-shape.js` 的 `Edge`／`NormalizedRoom` 輸出，不參照 DOM。座標一律
 * 整數 cm，原點為基底矩形左上、y 向下。
 *
 * 三條 D6 硬契約，實作與測試皆以此為準：
 * 1. `wall` **恆由 x,y 推導**（＝鉸鏈所在地板邊界線段上「非地板」的一側），
 *    呼叫端帶進來的 `wall` 一律不信任——`withDerivedWall()` 逐欄重建。
 * 2. 合法性以 D9 合併後的**極大牆段**（`NormalizedRoom.edges`）為準：鉸鏈
 *    須落在某條 `edges` 上，且門扇跨距須完整落在該條之內。房間或方塊變動
 *    後須重跑，非法者由 report 標「門未附著」。
 * 3. 相交謂詞先裁到**開象限**（嚴格），再以**平方距離**與 `width` 比較且
 *    取嚴格 `<`（相切不警示）——全程無三角函式。
 */
import type { Axis, Rect } from './geometry.js'
import type { Door, Side } from './model.js'
import type { Edge, NormalizedRoom } from './room-shape.js'

/** 門的輸入形：`wall` 永不由輸入決定，恆自 x,y 推導（D6／D7）。 */
export type DoorInput = Omit<Door, 'wall'>

/** D6 兩種拒收原因：鉸鏈不在任何極大牆段上／門扇跨距超出該牆段。 */
export type DoorRejectReason = 'hinge-off-edge' | 'span-exceeds-wall'

/** `deriveWall()`／`validateDoor()` 的判定結果（成功時附推導出的牆段）。 */
export type DoorValidation =
  | { ok: true; wall: Side; edge: Edge }
  | { ok: false; reason: DoorRejectReason }

/** 門扇沿牆軸的跨距（D6 表；N／S 牆沿 x、E／W 牆沿 y）。 */
export interface DoorSpan {
  axis: Axis
  lo: number
  hi: number
}

/** 迴旋區開象限相對鉸鏈的方向符號：−1 代表小於鉸鏈座標、+1 代表大於。 */
export type Sign = 1 | -1

/** 開象限（D6 表；`swing:'out'` 時垂直牆面的那一軸翻號、沿牆軸不動）。 */
export interface Quadrant {
  xSign: Sign
  ySign: Sign
}

/** 門的幾何衍生量；`clearance.ts` 取 `leaf`／`span` 判門洞，`swingRect` 供繪製與 report。 */
export interface DoorGeometry {
  wall: Side
  hinge: { x: number; y: number }
  /** 門扇跨距（位於牆線上）。 */
  span: DoorSpan
  /** 牆線上的零厚門扇線段矩形（D4 門洞條件 (c) 的共邊對象）。 */
  leaf: Rect
  quadrant: Quadrant
  /** 四分之一圓的外接正方形＝鉸鏈 ± `width`（僅供繪製／report，謂詞不用）。 */
  swingRect: Rect
}

/** 角點消歧序（D6：「皆可／皆不可取 N→E→S→W 序」）。 */
const WALL_ORDER: readonly Side[] = ['N', 'E', 'S', 'W']

/**
 * 內開時「垂直牆面」那一軸的內法線符號：牆在北 → 室內在南（+y）；牆在南
 * → 室內在北（−y）；牆在東 → 室內在西（−x）；牆在西 → 室內在東（+x）。
 */
const INWARD: Record<Side, Sign> = { N: 1, S: -1, E: -1, W: 1 }

/** 牆側 → 門扇跨距所在軸（D6 表：N／S 牆沿 x，E／W 牆沿 y）。 */
function spanAxis(wall: Side): Axis {
  return wall === 'N' || wall === 'S' ? 'x' : 'y'
}

/** D6 表的跨距公式：`'+'` → `[h, h+w]`、`'-'` → `[h−w, h]`（h 為鉸鏈在該軸的座標）。 */
function spanFromWall(
  door: Pick<DoorInput, 'x' | 'y' | 'leafDir' | 'width'>,
  wall: Side,
): DoorSpan {
  const axis = spanAxis(wall)
  const h = axis === 'x' ? door.x : door.y
  return door.leafDir === '+' ? { axis, lo: h, hi: h + door.width } : { axis, lo: h - door.width, hi: h }
}

/**
 * 包含 (x,y) 的極大牆段（閉線段、端點含入）。`Edge` 恆軸對齊且
 * `x0<=x1`／`y0<=y1`，故縱橫兩種共用同一組不等式：縱向段 `x0===x1` 時
 * 第一組不等式退化為「x 必須等於 x0」。鉸鏈落在牆角時回傳 2 條。
 */
export function edgesAtPoint(x: number, y: number, edges: Edge[]): Edge[] {
  const hits: Edge[] = []
  for (const edge of edges) {
    if (x >= edge.x0 && x <= edge.x1 && y >= edge.y0 && y <= edge.y1) hits.push(edge)
  }
  return hits
}

/** 依 `edge.wall` 決定跨距軸後套 D6 表（`edge` 只用來取牆側，不裁切）。 */
export function spanOnEdge(
  door: Pick<DoorInput, 'x' | 'y' | 'leafDir' | 'width'>,
  edge: Edge,
): DoorSpan {
  return spanFromWall(door, edge.wall)
}

/** 跨距是否完整落在該極大牆段之內（D6 合法性；端點齊平算落入）。 */
export function spanFits(span: DoorSpan, edge: Edge): boolean {
  const lo = span.axis === 'x' ? edge.x0 : edge.y0
  const hi = span.axis === 'x' ? edge.x1 : edge.y1
  return span.lo >= lo && span.hi <= hi
}

/** N→E→S→W 序中最前者；同序者取陣列先出現的一條（穩定）。 */
function pickByWallOrder(edges: Edge[]): Edge {
  let best = edges[0]
  let bestRank = WALL_ORDER.indexOf(best.wall)
  for (let i = 1; i < edges.length; i++) {
    const rank = WALL_ORDER.indexOf(edges[i].wall)
    if (rank < bestRank) {
      best = edges[i]
      bestRank = rank
    }
  }
  return best
}

/**
 * D6 `wall` 推導＋合法性：候選＝含鉸鏈的極大牆段。
 * - 0 條 → `hinge-off-edge`；
 * - 1 條 → 取其 `wall`，再看跨距是否落入（否則 `span-exceeds-wall`）；
 * - ≥2 條（鉸鏈在牆角）→ **優先取能讓跨距完整落入者**；若數條皆可或皆
 *   不可，改取 N→E→S→W 序最前者，再對選中者套一次 `spanFits`。
 */
export function deriveWall(door: DoorInput, edges: Edge[]): DoorValidation {
  const candidates = edgesAtPoint(door.x, door.y, edges)
  if (candidates.length === 0) return { ok: false, reason: 'hinge-off-edge' }
  const fitting = candidates.filter((edge) => spanFits(spanOnEdge(door, edge), edge))
  const picked = pickByWallOrder(fitting.length > 0 ? fitting : candidates)
  if (!spanFits(spanOnEdge(door, picked), picked)) {
    return { ok: false, reason: 'span-exceeds-wall' }
  }
  return { ok: true, wall: picked.wall, edge: picked }
}

/** 對正規化後的房型跑一次 D6 合法性（房間／方塊變動後須重跑）。 */
export function validateDoor(door: DoorInput, shape: NormalizedRoom): DoorValidation {
  return deriveWall(door, shape.edges)
}

/**
 * 合法時回傳補上推導 `wall` 的完整 `Door`，否則 `null`（供 reducer 的
 * 門 action 與 `parsePlan` 直接使用）。**逐欄重建**：呼叫端物件上若殘留
 * 偽造的 `wall` 或未知欄位一律不搬（D7 白名單精神）。
 */
export function withDerivedWall(door: DoorInput, shape: NormalizedRoom): Door | null {
  const result = validateDoor(door, shape)
  if (!result.ok) return null
  return {
    id: door.id,
    x: door.x,
    y: door.y,
    wall: result.wall,
    leafDir: door.leafDir,
    width: door.width,
    swing: door.swing,
  }
}

/**
 * D6 開象限表的完整展開：沿牆軸符號＝`leafDir`；垂直牆面那一軸取內法線
 * （`swing:'in'`）或其鏡像（`'out'`，**只翻垂直牆面那一軸、沿牆軸不動**）。
 * `door.wall` 視為已由 `deriveWall()` 推導過。
 */
export function doorGeometry(door: Door): DoorGeometry {
  const span = spanFromWall(door, door.wall)
  const along: Sign = door.leafDir === '+' ? 1 : -1
  const inward = INWARD[door.wall]
  const across: Sign = door.swing === 'in' ? inward : inward === 1 ? -1 : 1
  const quadrant: Quadrant =
    span.axis === 'x' ? { xSign: along, ySign: across } : { xSign: across, ySign: along }
  const leaf: Rect =
    span.axis === 'x'
      ? { x0: span.lo, y0: door.y, x1: span.hi, y1: door.y }
      : { x0: door.x, y0: span.lo, x1: door.x, y1: span.hi }
  const swingRect: Rect = {
    x0: quadrant.xSign === 1 ? door.x : door.x - door.width,
    y0: quadrant.ySign === 1 ? door.y : door.y - door.width,
    x1: quadrant.xSign === 1 ? door.x + door.width : door.x,
    y1: quadrant.ySign === 1 ? door.y + door.width : door.y,
  }
  return { wall: door.wall, hinge: { x: door.x, y: door.y }, span, leaf, quadrant, swingRect }
}

/**
 * D6 相交謂詞：先把矩形**嚴格**裁到開象限（`xSign:-1` 要求 `rect.x0 < hx`
 * 並把 x1 壓到 `min(x1, hx)`；`+1` 要求 `rect.x1 > hx` 並把 x0 抬到
 * `max(x0, hx)`；y 軸同理），裁後為空（非正面積）即不相交——鉸鏈在牆角時
 * 鄰牆一側的家具因此自動排除。非空時取鉸鏈到裁後矩形的最近點，回傳
 * `dx²+dy² < width²`：**嚴格小於**，恰好等於 `width` 為相切、不警示
 * （D9 玄關實例正案即靠這一條為零違規）。全程平方距離，無 `atan2`。
 */
export function intersectsSwing(geom: DoorGeometry, rect: Rect): boolean {
  const hx = geom.hinge.x
  const hy = geom.hinge.y
  let x0 = rect.x0
  let x1 = rect.x1
  if (geom.quadrant.xSign === -1) {
    if (rect.x0 >= hx) return false
    if (x1 > hx) x1 = hx
  } else {
    if (rect.x1 <= hx) return false
    if (x0 < hx) x0 = hx
  }
  let y0 = rect.y0
  let y1 = rect.y1
  if (geom.quadrant.ySign === -1) {
    if (rect.y0 >= hy) return false
    if (y1 > hy) y1 = hy
  } else {
    if (rect.y1 <= hy) return false
    if (y0 < hy) y0 = hy
  }
  if (x1 <= x0 || y1 <= y0) return false

  const nearestX = Math.max(x0, Math.min(hx, x1))
  const nearestY = Math.max(y0, Math.min(hy, y1))
  const dx = hx - nearestX
  const dy = hy - nearestY
  const width = geom.span.hi - geom.span.lo
  return dx * dx + dy * dy < width * width
}

/**
 * 距 (x,y) 最近的極大牆段上的點（磁吸用；D6「磁吸亦以極大牆段為準」，
 * 距離門檻由 `snap.ts` 以 `ignoreBelow` 施加）。軸對齊線段的投影＝逐軸
 * 夾到端點之間。同距離時取陣列先出現的一條（嚴格 `<` 比較）。
 * `edges` 為空時回傳 `null`。
 */
export function nearestPointOnEdges(
  x: number,
  y: number,
  edges: Edge[],
): { x: number; y: number; edge: Edge; dist2: number } | null {
  let best: { x: number; y: number; edge: Edge; dist2: number } | null = null
  for (const edge of edges) {
    const px = Math.max(edge.x0, Math.min(x, edge.x1))
    const py = Math.max(edge.y0, Math.min(y, edge.y1))
    const dx = x - px
    const dy = y - py
    const dist2 = dx * dx + dy * dy
    if (best === null || dist2 < best.dist2) best = { x: px, y: py, edge, dist2 }
  }
  return best
}
