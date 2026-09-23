/**
 * 房間家具擺放規劃器 — 純幾何函式（(internal design doc)
 * §D1 座標系／viewBox／zoom、§D2 pxToCm 純函式邊界、§D4 通道／碰撞／
 * 遮擋／門洞謂詞、§D9「M0 實作注意」區間正規化相接亦合併）。
 *
 * 本檔為呼叫圖葉節點：**零 import**，不得參照 DOM 或其他模組；
 * `model.ts` 自本檔取用 `Rect`。除 `pxToCm`／`cmToPx` 外全部整數 cm
 * 輸入／輸出（像素↔cm 換算回傳浮點，呼叫端負責四捨五入，見 D2）。
 */

/** 軸對齊矩形：x1≥x0、y1≥y0；零厚度合法（外接框邊、門扇線段）。 */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type Axis = 'x' | 'y'

/** 閉區間 [lo, hi]；`hi<=lo` 視為空區間。 */
export interface Interval {
  lo: number
  hi: number
}

function axisBounds(r: Rect, axis: Axis): readonly [number, number] {
  return axis === 'x' ? [r.x0, r.x1] : [r.y0, r.y1]
}

/**
 * 投影重疊段長度：`min(hi) − max(lo)`；不重疊或恰相接時 ≤0（D4：
 * 「投影重疊」定義為此值 > 0，正負判讀交由呼叫端）。
 */
export function overlapLength(aLo: number, aHi: number, bLo: number, bHi: number): number {
  return Math.min(aHi, bHi) - Math.max(aLo, bLo)
}

/** 兩矩形在指定軸上是否有正重疊（D4：碰撞／通道候選的前提判準）。 */
export function hasPositiveOverlap(a: Rect, b: Rect, axis: Axis): boolean {
  const [aLo, aHi] = axisBounds(a, axis)
  const [bLo, bHi] = axisBounds(b, axis)
  return overlapLength(aLo, aHi, bLo, bHi) > 0
}

/**
 * 間距 `d = max(aLo − bHi, bLo − aHi)`（D4）。兩矩形在該軸重疊時為負；
 * 零厚框邊落在另一矩形內部（退化矩形）時同樣為負——即「家具跨在框線
 * 上」判定卡在牆裡的依據，非 bug。
 */
export function gap(aLo: number, aHi: number, bLo: number, bHi: number): number {
  return Math.max(aLo - bHi, bLo - aHi)
}

/** `pairwise()` 回傳形（D4）。`axis`／`gap` 為「間距軸」；`rect` 為候選通道矩形。 */
export type PairwiseResult =
  | { kind: 'collision' }
  | { kind: 'corridor'; axis: Axis; gap: number; rect: Rect }
  | { kind: 'none' }

/**
 * 兩矩形配對判定（D4 契約）：兩軸皆正重疊 → 碰撞（此處永不因 `passable`
 * 抑制，抑制在 clearance.ts 層套用）；恰一軸正重疊 → 另一軸間距 `d`：
 * `d<0` 併入碰撞、`d≥0` 為候選通道（矩形＝重疊段 × 間距，`d=0` 時間距
 * 軸零寬）；兩軸皆無正重疊（斜對角）→ `none`。
 */
export function pairwise(a: Rect, b: Rect): PairwiseResult {
  const xOverlap = hasPositiveOverlap(a, b, 'x')
  const yOverlap = hasPositiveOverlap(a, b, 'y')
  if (xOverlap && yOverlap) return { kind: 'collision' }
  if (!xOverlap && !yOverlap) return { kind: 'none' }

  const overlapAxis: Axis = xOverlap ? 'x' : 'y'
  const gapAxis: Axis = xOverlap ? 'y' : 'x'
  const [aOLo, aOHi] = axisBounds(a, overlapAxis)
  const [bOLo, bOHi] = axisBounds(b, overlapAxis)
  const [aGLo, aGHi] = axisBounds(a, gapAxis)
  const [bGLo, bGHi] = axisBounds(b, gapAxis)
  const d = gap(aGLo, aGHi, bGLo, bGHi)
  if (d < 0) return { kind: 'collision' }

  const overlapLo = Math.max(aOLo, bOLo)
  const overlapHi = Math.min(aOHi, bOHi)
  const gapLo = Math.min(aGHi, bGHi)
  const gapHi = Math.max(aGLo, bGLo)
  const rect: Rect =
    overlapAxis === 'x'
      ? { x0: overlapLo, y0: gapLo, x1: overlapHi, y1: gapHi }
      : { x0: gapLo, y0: overlapLo, x1: gapHi, y1: overlapHi }
  return { kind: 'corridor', axis: gapAxis, gap: d, rect }
}

/** 兩矩形交集面積（≥0；不重疊或僅相接為 0）。 */
export function intersectArea(a: Rect, b: Rect): number {
  const w = overlapLength(a.x0, a.x1, b.x0, b.x1)
  const h = overlapLength(a.y0, a.y1, b.y0, b.y1)
  return w > 0 && h > 0 ? w * h : 0
}

/** 兩矩形交集矩形；正面積相交才回傳，否則 `null`（含僅相切／相接）。 */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x0, b.x0)
  const x1 = Math.min(a.x1, b.x1)
  const y0 = Math.max(a.y0, b.y0)
  const y1 = Math.min(a.y1, b.y1)
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null
  return { x0, y0, x1, y1 }
}

/**
 * 區間正規化：捨去空區間（`hi<=lo`）、排序、合併重疊**與相接**
 * （`a.lo <= last.hi`——等號也併，D9「M0 實作注意」：否則
 * `[[0,3],[3,10]]` 會把邊切段）。不改動輸入陣列／物件。
 */
export function normalizeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .filter((iv) => iv.hi > iv.lo)
    .slice()
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi)
  const result: Interval[] = []
  for (const iv of sorted) {
    const last = result[result.length - 1]
    if (last !== undefined && iv.lo <= last.hi) {
      if (iv.hi > last.hi) last.hi = iv.hi
    } else {
      result.push({ lo: iv.lo, hi: iv.hi })
    }
  }
  return result
}

/**
 * `base` 扣掉 `cuts`（先正規化）後剩餘正長度子區間，遞增序（D4 遮擋
 * 子段即建於此：沿重疊軸把遮擋矩形的投影區間自通道矩形扣掉）。
 */
export function subtractIntervals(base: Interval, cuts: Interval[]): Interval[] {
  const merged = normalizeIntervals(cuts)
  const result: Interval[] = []
  let cursor = base.lo
  for (const cut of merged) {
    const lo = Math.max(cut.lo, base.lo)
    const hi = Math.min(cut.hi, base.hi)
    if (hi <= lo) continue
    if (lo > cursor) result.push({ lo: cursor, hi: lo })
    if (hi > cursor) cursor = hi
  }
  if (base.hi > cursor) result.push({ lo: cursor, hi: base.hi })
  return result
}

/** 矩形面積（依 `Rect` 不變量 x1≥x0、y1≥y0，恆 ≥0）。 */
export function rectArea(r: Rect): number {
  return (r.x1 - r.x0) * (r.y1 - r.y0)
}

/** 由左上角 (x,y)＋寬深組出矩形。 */
export function rectFromXYWH(x: number, y: number, w: number, d: number): Rect {
  return { x0: x, y0: y, x1: x + w, y1: y + d }
}

/**
 * SVG viewBox（D1：`minX minY W H`，外接框；zoom 一律改 viewBox，
 * 不用 CSS transform）。
 */
export interface ViewBox {
  minX: number
  minY: number
  w: number
  h: number
}

/** 畫布 DOM 節點的 `getBoundingClientRect()`；由 `drag.ts` 讀出後傳入（D2）。 */
export interface BoardRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * `preserveAspectRatio="xMidYMid meet"` 的縮放與置中位移：
 * `scale = min(board.width/vb.w, board.height/vb.h)`；letterbox 位移
 * 置中內容（D1、D10「不用 ResizeObserver」）。
 */
export function viewScale(
  board: BoardRect,
  vb: ViewBox,
): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(board.width / vb.w, board.height / vb.h)
  const offsetX = (board.width - vb.w * scale) / 2
  const offsetY = (board.height - vb.h * scale) / 2
  return { scale, offsetX, offsetY }
}

/**
 * 指標像素座標 → cm（D2 純函式邊界：jsdom 無 `getScreenCTM`／
 * `createSVGPoint`，座標換算須獨立於 DOM 之外方可 node 直測）。回傳
 * 浮點，呼叫端負責四捨五入。
 */
export function pxToCm(
  clientX: number,
  clientY: number,
  board: BoardRect,
  vb: ViewBox,
): { x: number; y: number } {
  const { scale, offsetX, offsetY } = viewScale(board, vb)
  return {
    x: vb.minX + (clientX - board.left - offsetX) / scale,
    y: vb.minY + (clientY - board.top - offsetY) / scale,
  }
}

/** `pxToCm` 的精確反函式。 */
export function cmToPx(
  x: number,
  y: number,
  board: BoardRect,
  vb: ViewBox,
): { clientX: number; clientY: number } {
  const { scale, offsetX, offsetY } = viewScale(board, vb)
  return {
    clientX: board.left + offsetX + (x - vb.minX) * scale,
    clientY: board.top + offsetY + (y - vb.minY) * scale,
  }
}

/**
 * 依 zoom／pan 算出 viewBox（D1／D10）：`zoom` 為相對 fit 的倍率
 * （`w = bounds 寬 / zoom`），以 `bounds` 中心平移 `pan`（cm）為新中心；
 * `zoom=1`、`pan=0` → 恰為 `bounds`。
 */
export function fitViewBox(bounds: Rect, zoom: number, panX: number, panY: number): ViewBox {
  const w = (bounds.x1 - bounds.x0) / zoom
  const h = (bounds.y1 - bounds.y0) / zoom
  const centerX = (bounds.x0 + bounds.x1) / 2 + panX
  const centerY = (bounds.y0 + bounds.y1) / 2 + panY
  return { minX: centerX - w / 2, minY: centerY - h / 2, w, h }
}
