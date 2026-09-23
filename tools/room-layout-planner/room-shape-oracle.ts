/**
 * `room-shape.ts` 的逐格（unit cell）參考實作 —— **只供單元測試對拍**，
 * 不進產品路徑（(internal design doc) §Verification
 * 「room-shape」：小房型以 `Uint8Array` 逐格重算 `edges` 與面積後
 * deepEqual；移植自 `(internal design doc)`）。
 *
 * 刻意寫得笨而直白：照 D9 條文字面「格邊一側是地板、另一側是牆體或框外
 * 者入列」逐格收集，除最後一步的線段串接外不做任何合併最佳化，才能擋住
 * 「帶分解／合併寫錯一格」這類錯誤。成本隨 `bounds` 面積成長，故只對
 * 小房型使用。
 *
 * 檔名不含 `.test.`，不會被 vitest 預設 include 當成測試檔收集；只由
 * `room-shape.test.ts` import。
 */
import type { Side } from './model.js'
import type { Edge, RoomShapeInput } from './room-shape.js'

/** 逐格地板點陣（`bounds` 內每格一個 byte，1 ＝地板）。 */
export interface BruteGrid {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  cells: Uint8Array
  /** 格 (i, j) 是否為地板；框外恆 0。 */
  isFloor: (i: number, j: number) => number
}

/** 逐格塗地板：基底 ∪ extends 塗 1，再以 cutouts 塗 0（cutout 勝 extend）。 */
export function bruteFloorGrid(room: RoomShapeInput): BruteGrid {
  const extend = room.blocks.filter((b) => b.kind === 'extend')
  const cutout = room.blocks.filter((b) => b.kind === 'cutout')

  let minX = 0
  let minY = 0
  let maxX = room.width
  let maxY = room.depth
  for (const e of extend) {
    minX = Math.min(minX, e.x)
    minY = Math.min(minY, e.y)
    maxX = Math.max(maxX, e.x + e.width)
    maxY = Math.max(maxY, e.y + e.depth)
  }
  const width = maxX - minX
  const height = maxY - minY
  const cells = new Uint8Array(width * height)
  const at = (i: number, j: number): number => (j - minY) * width + (i - minX)

  const paint = (x: number, y: number, w: number, d: number, value: number): void => {
    const x0 = Math.max(x, minX)
    const x1 = Math.min(x + w, maxX)
    const y0 = Math.max(y, minY)
    const y1 = Math.min(y + d, maxY)
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) cells[at(i, j)] = value
    }
  }
  paint(0, 0, room.width, room.depth, 1)
  for (const e of extend) paint(e.x, e.y, e.width, e.depth, 1)
  for (const c of cutout) paint(c.x, c.y, c.width, c.depth, 0)

  const isFloor = (i: number, j: number): number =>
    i < minX || i >= maxX || j < minY || j >= maxY ? 0 : cells[at(i, j)]

  return { minX, minY, maxX, maxY, width, height, cells, isFloor }
}

/** 逐格面積：地板格數、牆體格數、`bounds` 格數。 */
export function bruteAreas(room: RoomShapeInput): {
  floorArea: number
  wallArea: number
  boundsArea: number
} {
  const grid = bruteFloorGrid(room)
  let floorArea = 0
  for (let k = 0; k < grid.cells.length; k++) floorArea += grid.cells[k]
  const boundsArea = grid.width * grid.height
  return { floorArea, wallArea: boundsArea - floorArea, boundsArea }
}

/** 逐格邊 → 極大共線同法線線段（與 `normalize().edges` 對拍）。 */
export function bruteEdges(room: RoomShapeInput): Edge[] {
  const { minX, minY, maxX, maxY, isFloor } = bruteFloorGrid(room)
  const raw: Edge[] = []
  // 縱向格邊：x 固定，y..y+1
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y < maxY; y++) {
      const west = isFloor(x - 1, y)
      const east = isFloor(x, y)
      if (west && !east) raw.push({ x0: x, y0: y, x1: x, y1: y + 1, wall: 'E' })
      else if (!west && east) raw.push({ x0: x, y0: y, x1: x, y1: y + 1, wall: 'W' })
    }
  }
  // 橫向格邊：y 固定，x..x+1
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const north = isFloor(x, y - 1)
      const south = isFloor(x, y)
      if (north && !south) raw.push({ x0: x, y0: y, x1: x + 1, y1: y, wall: 'S' })
      else if (!north && south) raw.push({ x0: x, y0: y, x1: x + 1, y1: y, wall: 'N' })
    }
  }

  // 合併：共線（同 x 或同 y）＋同法線側＋端點相接
  const groups = new Map<string, Edge[]>()
  for (const edge of raw) {
    const vertical = edge.x0 === edge.x1
    const key = vertical ? `V|${edge.x0}|${edge.wall}` : `H|${edge.y0}|${edge.wall}`
    let arr = groups.get(key)
    if (arr === undefined) {
      arr = []
      groups.set(key, arr)
    }
    arr.push(edge)
  }
  const merged: Edge[] = []
  for (const [key, arr] of groups) {
    const vertical = key.startsWith('V|')
    arr.sort((a, b) => (vertical ? a.y0 - b.y0 : a.x0 - b.x0))
    let current: Edge | null = null
    for (const edge of arr) {
      if (current !== null && (vertical ? current.y1 === edge.y0 : current.x1 === edge.x0)) {
        if (vertical) current.y1 = edge.y1
        else current.x1 = edge.x1
      } else {
        current = { x0: edge.x0, y0: edge.y0, x1: edge.x1, y1: edge.y1, wall: edge.wall }
        merged.push(current)
      }
    }
  }
  return merged
}

/** 線段的可比較鍵（順序無關的 deepEqual 用）。 */
export function edgeKey(edge: { x0: number; y0: number; x1: number; y1: number; wall: Side }): string {
  return `${edge.x0},${edge.y0},${edge.x1},${edge.y1},${edge.wall}`
}

/** 線段集合排序後的鍵陣列。 */
export function sortedEdgeKeys(
  edges: readonly { x0: number; y0: number; x1: number; y1: number; wall: Side }[],
): string[] {
  return edges.map(edgeKey).sort()
}
