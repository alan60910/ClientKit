/**
 * T1.8 — 網格與磁吸（(internal design doc) §Recommended
 * approach「`snap.ts` — 只做網格（1／5／10）與磁吸（鄰邊／極大牆段，距離＝
 * `ignoreBelow`，預設 5）；夾框在 `reducer.ts`。順序：取整 → 網格 → 磁吸 →
 * 夾框」、§Implementation notes「磁吸距離跟隨 `ignoreBelow`；網格 → 磁吸
 * 順序固定」、§D6「磁吸亦以極大牆段為準」）。
 *
 * 本檔只負責前三步（取整 → 網格 → 磁吸），**不夾框**——夾框需要
 * `normalize()` 的 `bounds` 與「非凸房型只夾外接框」的規則，屬
 * `reducer.ts` 職責。純函式、零 DOM。
 *
 * 磁吸語意（兩軸各自獨立）：把移動中矩形在該軸的**兩條邊**（`lo` 與
 * `hi`）分別與候選座標比對，取最近者；候選＝其他家具有效外框的兩側邊，
 * 以及該軸向的極大牆段（x 軸取縱向 `Edge`、y 軸取橫向 `Edge`）。候選須與
 * 移動矩形在**另一軸**有正重疊才納入，否則會吸到房間另一頭的牆。
 */
import type { Axis, Rect } from './geometry.js'
import type { Edge } from './room-shape.js'

/** 網格粒度（＝`Settings['snap']`；D3 設定面板三選一）。 */
export type GridSize = 1 | 5 | 10

/** 磁吸所需的周遭幾何；由 `main.ts`／`drag.ts` 自 plan 與 `normalize()` 組出。 */
export interface SnapContext {
  grid: GridSize
  /** 磁吸距離，恆＝`settings.ignoreBelow`（PLAN Implementation notes）；`0` 關閉磁吸。 */
  magnet: number
  /** D9 `normalize()` 輸出的**極大**牆段（未合併的碎段會讓磁吸點過密）。 */
  edges: Edge[]
  /** **其他**未刪除家具的有效外框（呼叫端須排除自己）。 */
  neighbors: Rect[]
}

/** 一個磁吸候選：該軸座標 `coord`，以及它在另一軸上的涵蓋區間 `[lo, hi]`。 */
interface Candidate {
  coord: number
  lo: number
  hi: number
}

/**
 * 取最近的網格倍數。**正中間（.5）一律往 +∞ 靠**（`Math.round` 語意，
 * 如 grid 10 時 5 → 10、−5 → 0），與 `rotateAboutCenter` 的定向取整
 * 無關。輸出抹掉 `-0`，以免 `Object.is` 比較（vitest `toBe`）失敗。
 */
export function snapToGrid(value: number, grid: GridSize): number {
  const snapped = Math.round(value / grid) * grid
  return snapped === 0 ? 0 : snapped
}

/** 該軸的磁吸候選集合（家具兩側邊＋同向極大牆段）。 */
function candidatesOn(ctx: SnapContext, axis: Axis): Candidate[] {
  const out: Candidate[] = []
  for (const n of ctx.neighbors) {
    if (axis === 'x') {
      out.push({ coord: n.x0, lo: n.y0, hi: n.y1 }, { coord: n.x1, lo: n.y0, hi: n.y1 })
    } else {
      out.push({ coord: n.y0, lo: n.x0, hi: n.x1 }, { coord: n.y1, lo: n.x0, hi: n.x1 })
    }
  }
  for (const edge of ctx.edges) {
    if (axis === 'x') {
      // 縱向段（`x0===x1`）才提供 x 座標；其涵蓋區間為 y。
      if (edge.x0 === edge.x1) out.push({ coord: edge.x0, lo: edge.y0, hi: edge.y1 })
    } else if (edge.y0 === edge.y1) {
      out.push({ coord: edge.y0, lo: edge.x0, hi: edge.x1 })
    }
  }
  return out
}

/** 同距離時的決勝序（PLAN 契約）：較小位移優先，再取較小座標。 */
function isBetter(shift: number, coord: number, best: { shift: number; coord: number }): boolean {
  const distance = Math.abs(shift)
  const bestDistance = Math.abs(best.shift)
  if (distance !== bestDistance) return distance < bestDistance
  if (shift !== best.shift) return shift < best.shift
  return coord < best.coord
}

/**
 * 單軸磁吸位移：`[lo, hi]` 為移動矩形在該軸的兩條邊，`[acrossLo,
 * acrossHi]` 為它在另一軸的涵蓋區間（用來篩掉不共面的候選）。無候選落在
 * `magnet` 內時回 `0`。
 */
function magnetShift(
  lo: number,
  hi: number,
  acrossLo: number,
  acrossHi: number,
  candidates: Candidate[],
  magnet: number,
): number {
  let best: { shift: number; coord: number } | null = null
  for (const candidate of candidates) {
    // 另一軸須**正重疊**（沿用 D4 慣例：長度 >0），僅角點相接不算共面。
    if (Math.min(candidate.hi, acrossHi) - Math.max(candidate.lo, acrossLo) <= 0) continue
    for (const movingEdge of [lo, hi]) {
      const shift = candidate.coord - movingEdge
      if (Math.abs(shift) > magnet) continue
      if (best === null || isBetter(shift, candidate.coord, best)) {
        best = { shift, coord: candidate.coord }
      }
    }
  }
  return best === null ? 0 : best.shift
}

/**
 * 順序固定：**取整 → 網格 → 磁吸**（PLAN）。夾框由呼叫端（`reducer.ts`
 * 的 `apply()`）在此之後施加。
 *
 * 兩軸各自獨立求位移，且「另一軸涵蓋區間」一律取**磁吸前**（網格後）的
 * 外框——否則 x 的吸附結果會改變 y 的候選集合，結果隨求解順序而異。
 */
export function snapPosition(
  x: number,
  y: number,
  size: { w: number; d: number },
  ctx: SnapContext,
): { x: number; y: number } {
  const gridX = snapToGrid(Math.round(x), ctx.grid)
  const gridY = snapToGrid(Math.round(y), ctx.grid)
  if (ctx.magnet <= 0) return { x: gridX, y: gridY }

  const dx = magnetShift(
    gridX,
    gridX + size.w,
    gridY,
    gridY + size.d,
    candidatesOn(ctx, 'x'),
    ctx.magnet,
  )
  const dy = magnetShift(
    gridY,
    gridY + size.d,
    gridX,
    gridX + size.w,
    candidatesOn(ctx, 'y'),
    ctx.magnet,
  )
  return { x: gridX + dx, y: gridY + dy }
}
