/**
 * T1.7 — 通道／碰撞／遮擋／門洞／各面需留分析引擎（(internal design doc)
 * PLAN.md §D3「四段半開區間」、§D4「哪些距離算通道」全段（謂詞、`d` 公式、
 * 遮擋、門洞 (a)(b)(c)＋容差、同牆面合併、`passable`、必要實作 grid、
 * `maxGap` 兩路徑契約）、§D5「`sideViolations` 判準」、§D6「相交謂詞」、
 * §D9 玄關實例與反向案 (a)–(f)、§D10 S1 實測結論、§狀態與資料形
 * `ClearanceReport`）。
 *
 * 呼叫圖：本檔依賴 geometry／model／room-shape／door，為純邏輯層的最後一環，
 * 不參照 DOM。座標一律整數 cm。
 *
 * 五條硬契約，實作與測試皆以此為準：
 * 1. **樸素路徑永久 export**（`{index:false}`）——差分 oracle 依賴它，M3 後
 *    亦不得刪除（PLAN §Implementation notes）。兩路徑輸出必須逐字相同，只在
 *    `occlusionTests`／`cellVisits` 上不同。
 * 2. **遮擋排除零厚框邊**：框邊不當遮擋物，故 `d = 0` 的通道（間距軸零寬、
 *    正面積相交恆不成立）**永不被遮擋**——規則的直接推論，非 bug
 *    （S1 §範圍外觀察 1）。
 * 3. **門洞三條件以遮擋前的母通道判定**，標記繼承給所有子段；條件 (a) 的
 *    軸向檢查即使 (b)(c) 成立亦不得省略（§D4 R2-C2 回歸鎖）。
 * 4. **`maxGap` 預篩只影響通道輸出**：碰撞、`sideViolations`、`doorViolations`
 *    一律由**未預篩**的逐對迴圈計算（§D4 OQ4 兩路徑契約）。
 * 5. **不做 SoA 攤平**：S1 實測 AoS 與 SoA 差 ±5% 落在雜訊內，D4 已將其自
 *    必要實作降為可選；uniform grid 索引則**維持硬契約**（實測 2.99×）。
 * 6. **增量 ≡ 全量**（T3.4／D10 OQ4 備案）：`clearanceForMoved()` 的輸出必須
 *    與 `clearance()` 逐字相同。兩條路徑因此共用同一份核心零件
 *    （`pairOutcome`／`occludeCandidate`／`sideTable`／`assembleReport`），
 *    各寫一份會讓等價退化成巧合。
 */
import { doorGeometry, intersectsSwing, withDerivedWall, type DoorGeometry } from './door.js'
import {
  intersectArea,
  overlapLength,
  pairwise,
  subtractIntervals,
  type Axis,
  type Interval,
  type Rect,
} from './geometry.js'
import {
  effectiveRect,
  worldSide,
  type ClearanceReport,
  type Collision,
  type Corridor,
  type DoorViolation,
  type Furniture,
  type Level,
  type RoomPlan,
  type Settings,
  type Side,
  type SideViolation,
} from './model.js'
import { frameEdges, normalize } from './room-shape.js'

/* ------------------------------------------------------------------ *
 * 輸入／輸出資料形
 * ------------------------------------------------------------------ */

/** 逐家具攤平後的分析單元（`rect` 即 `effectiveRect()`，不在逐對迴圈內重算）。 */
export interface ClearanceItem {
  id: string
  rect: Rect
  passable: boolean
  clearances?: Partial<Record<Side, number>>
  rotation: Furniture['rotation']
}

/**
 * 牆體單元：`id` 為 `wall:<index>`（D9 `normalize().walls` 索引）或
 * `frame:N|E|S|W`（外接框零厚邊）。`frame:true` 者**不得當遮擋物**（D4）。
 */
export interface ClearanceWall {
  id: string
  rect: Rect
  frame: boolean
}

/** 已通過 D6 合法性的門；未附著的門不入此列（見 `buildClearanceInput`）。 */
export interface ClearanceDoor {
  id: string
  geom: DoorGeometry
}

/** `clearanceCore()` 的完整輸入（D4「契約——輸入」）。 */
export interface ClearanceInput {
  items: ClearanceItem[]
  walls: ClearanceWall[]
  bounds: Rect
  doors: ClearanceDoor[]
  settings: Pick<Settings, 'ignoreBelow' | 'warnBelow' | 'adviseBelow'>
}

/**
 * `index` 選路（樸素／uniform grid）；`cellSize` 預設 50（D4：50–100 實測
 * 等效）；`maxGap` 為 OQ4 預篩，`undefined` 即完整路徑。
 */
export interface ClearanceCoreOptions {
  index: boolean
  cellSize?: number
  maxGap?: number
}

/** 兩路徑各回「遮擋測試次數」與「cell 造訪數」供差分 oracle 斷言。 */
export interface ClearanceCoreResult {
  report: ClearanceReport
  occlusionTests: number
  cellVisits: number
}

/** D4：cell 50–100 cm 實測等效，預設 50。 */
export const DEFAULT_CELL_SIZE = 50

/** `frameEdges()` 的輸出序（room-shape.ts 契約：N、E、S、W）。 */
const FRAME_SIDES: readonly Side[] = ['N', 'E', 'S', 'W']

/** `clearances` 巡檢序；輸出排序亦依此序以保證決定性。 */
const SIDE_KEYS: readonly Side[] = ['N', 'E', 'S', 'W']

/**
 * D3 四段**半開**區間：`touch: d < ignoreBelow`、
 * `narrow: [ignoreBelow, warnBelow)`、`tight: [warnBelow, adviseBelow)`、
 * `ok: d ≥ adviseBelow`。三閾值的合法性（三元組驗證）屬 reducer／parsePlan
 * 職責，本函式只做分段。
 */
export function levelFor(gap: number, s: ClearanceInput['settings']): Level {
  if (gap < s.ignoreBelow) return 'touch'
  if (gap < s.warnBelow) return 'narrow'
  if (gap < s.adviseBelow) return 'tight'
  return 'ok'
}

/* ------------------------------------------------------------------ *
 * 內部資料形
 * ------------------------------------------------------------------ */

/** 攤平後的逐對迴圈單元：家具在前（索引 < `itemCount`）、牆體在後。 */
interface Entry {
  id: string
  rect: Rect
  /** 家具本體；牆體為 `null`（牆無 `passable`／`clearances`）。 */
  item: ClearanceItem | null
  /** 零厚外接框邊：排除於遮擋物之外（D4）。 */
  frame: boolean
}

/**
 * 遮擋前的「母通道」候選（D4）。`segLo`／`segHi` 在重疊軸、`gapLo`／`gapHi`
 * 在間距軸。本型別（與 `Entry`／`Draft`）刻意**不 export**：它們是
 * `ClearanceCache` 的內部形，對呼叫端而言 cache 是不透明的一包東西，只有
 * `clearanceForMoved()` 會讀它。
 */
interface Candidate {
  ai: number
  bi: number
  axis: Axis
  overlapAxis: Axis
  gap: number
  rect: Rect
  segLo: number
  segHi: number
  gapLo: number
  gapHi: number
  kind: Corridor['kind']
  level: Level | null
  /**
   * 正面積遮擋本候選的第三矩形數（D10「處置（OQ4 定案）」明列於 cache）。
   * `clearanceForMoved()` 的重算判準：`0` 代表上一幀沒有任何第三矩形切過
   * 本候選，被移動家具的**舊**矩形必不在其中，故可省掉舊矩形那一次相交
   * 測試。兩路徑此數相同——grid 以 stamp 去重、建表時已排除框邊，命中
   * 集合與樸素掃描一致。
   */
  occluderCount: number
  /**
   * 遮擋後的子段（`maxGap` 預篩掉者恆為空陣列）。`clearanceForMoved()`
   * 逐筆重用的單位，故**視為不可變**——重算時另建 Candidate 物件，不就地
   * 改寫 cache 裡的這個陣列。
   */
  drafts: Draft[]
}

/** 遮擋後、合併前的通道子段（`segIndex` 於 `materialize()` 統一編號）。 */
interface Draft {
  a: string
  b: string
  axis: Axis
  gap: number
  gapLo: number
  gapHi: number
  segLo: number
  segHi: number
  level: Level | null
  kind: Corridor['kind']
  /** 對側為牆體（含框邊）時才參與同牆面合併（D4：「牆體側不看 id」）。 */
  againstWall: boolean
}

/** uniform grid 空間索引（CSR 佈局；`stamp` 以世代編號去重）。 */
interface Grid {
  nx: number
  ny: number
  ox: number
  oy: number
  cellSize: number
  start: Int32Array
  members: Int32Array
  stamp: Int32Array
  gen: number
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 逐軸夾出的重疊盒。兩軸皆正重疊時即交集矩形；「恰一軸正重疊且 d<0」
 * （家具跨在零厚框線上）時退化為框線上的零厚線段——碰撞筆的 `rect`
 * 即取此形（D4「併入碰撞」）。恆滿足 `x1>=x0`、`y1>=y0`。
 */
function overlapBox(a: Rect, b: Rect): Rect {
  return {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  }
}

/** 矩形在指定軸上的投影區間。 */
function projection(r: Rect, axis: Axis): Interval {
  return axis === 'x' ? { lo: r.x0, hi: r.x1 } : { lo: r.y0, hi: r.y1 }
}

function clampIdx(v: number, max: number): number {
  if (v < 0) return 0
  if (v > max - 1) return max - 1
  return v
}

/**
 * 對 `bounds` 鋪 uniform grid（D4 必要實作 (1)）。只登記**非框邊**矩形
 * （框邊不當遮擋物）。負原點 bounds 直接以 `bounds.x0`／`bounds.y0` 為
 * grid 原點，整數 cell 座標經 `clampIdx` 夾住越界者。
 */
function buildGrid(entries: Entry[], bounds: Rect, cellSize: number): Grid {
  const nx = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cellSize))
  const ny = Math.max(1, Math.ceil((bounds.y1 - bounds.y0) / cellSize))
  const nCells = nx * ny
  const grid: Grid = {
    nx,
    ny,
    ox: bounds.x0,
    oy: bounds.y0,
    cellSize,
    start: new Int32Array(nCells + 1),
    members: new Int32Array(0),
    stamp: new Int32Array(entries.length),
    gen: 0,
  }
  // pass 1：計數（`start[c+1]` 暫存 cell c 的成員數，之後就地做前綴和）。
  for (let t = 0; t < entries.length; t++) {
    if (entries[t].frame) continue
    forEachCell(grid, entries[t].rect, (c) => {
      grid.start[c + 1]++
    })
  }
  for (let c = 0; c < nCells; c++) grid.start[c + 1] += grid.start[c]
  grid.members = new Int32Array(grid.start[nCells])
  const cursor = new Int32Array(nCells)
  // pass 2：填入。
  for (let t = 0; t < entries.length; t++) {
    if (entries[t].frame) continue
    forEachCell(grid, entries[t].rect, (c) => {
      grid.members[grid.start[c] + cursor[c]] = t
      cursor[c]++
    })
  }
  return grid
}

/** 逐一走訪矩形覆蓋的 cell（含邊界所在 cell；`clampIdx` 保證索引合法）。 */
function forEachCell(grid: Grid, rect: Rect, visit: (cell: number) => void): void {
  const cx0 = clampIdx(Math.floor((rect.x0 - grid.ox) / grid.cellSize), grid.nx)
  const cx1 = clampIdx(Math.floor((rect.x1 - grid.ox) / grid.cellSize), grid.nx)
  const cy0 = clampIdx(Math.floor((rect.y0 - grid.oy) / grid.cellSize), grid.ny)
  const cy1 = clampIdx(Math.floor((rect.y1 - grid.oy) / grid.cellSize), grid.ny)
  for (let cy = cy0; cy <= cy1; cy++) {
    const row = cy * grid.nx
    for (let cx = cx0; cx <= cx1; cx++) visit(row + cx)
  }
}

/**
 * D4 門洞三條件，對**遮擋前的母通道**判定：
 * (a) 間距軸與門所在牆線平行——牆線沿門扇跨距軸延伸，故等價於
 *     `候選間距軸 === span.axis`（N／S 牆 → `x`，E／W 牆 → `y`）。
 *     **即使 (b)(c) 成立亦不得省略**（R2-C2 回歸鎖；D9 (e) 反向案）。
 * (b) 間距區間與門扇跨距的**兩端偏差量總和**
 *     `|span.lo − gapLo| + |gapHi − span.hi|` < `ignoreBelow`（r3.4：**雙向
 *     容差**——超出與短缺皆計。只量超出會讓「門口被家具擋窄」的真子集
 *     間距區間偏差為 0 而誤標門洞、不評級）。
 *     （D9 (c) 總和 2 → 門洞；(d) 總和 8 → 照常評級。）
 * (c) 通道矩形與零厚門扇線段共享**正長度**邊：門扇所在的那條格線恰為通道
 *     矩形在**門扇退化軸**上的某一端，且兩者在跨距軸的重疊長度 > 0。
 *
 * (b)(c) 皆刻意寫成與候選間距軸**無關**的純幾何比較——D9 (e) 的反向案正是
 * 「(b)(c) 數值上成立、只有 (a) 不成立」，若這兩條偷偷夾帶軸向假設，(a) 的
 * 回歸鎖就形同虛設。
 */
function isDoorway(doors: ClearanceDoor[], cand: Candidate, ignoreBelow: number): boolean {
  for (const door of doors) {
    const span = door.geom.span
    if (cand.axis !== span.axis) continue
    const deviation = Math.abs(span.lo - cand.gapLo) + Math.abs(cand.gapHi - span.hi)
    if (deviation >= ignoreBelow) continue
    const cross: Axis = span.axis === 'x' ? 'y' : 'x'
    const leafLine = cross === 'x' ? door.geom.leaf.x0 : door.geom.leaf.y0
    const crossExtent = projection(cand.rect, cross)
    if (leafLine !== crossExtent.lo && leafLine !== crossExtent.hi) continue
    const alongExtent = projection(cand.rect, span.axis)
    if (overlapLength(alongExtent.lo, alongExtent.hi, span.lo, span.hi) <= 0) continue
    return true
  }
  return false
}

/**
 * D4 同牆面合併：同一家具、同間距軸、同 gap、同間距區間（＝同一面）、
 * 重疊段相接或重疊者併為一筆，**牆體側不看 id**（取字典序最小者作代表，
 * 與走訪順序無關）。只對「對側為牆體」的通道生效；家具×家具不合併。
 * `kind`／`level` 亦納入分組鍵，避免把評級不同的筆併在一起。
 *
 * **不得就地改動輸入 draft**（`run = { ...draft }` 先複製再改）——
 * `clearanceForMoved()` 逐幀重用 cache 裡的同一批 draft 物件，就地改寫會
 * 讓 cache 自第二幀起失真。
 */
function mergeWallFaces(drafts: Draft[]): Draft[] {
  const out: Draft[] = []
  const groups = new Map<string, Draft[]>()
  for (const draft of drafts) {
    if (!draft.againstWall) {
      out.push(draft)
      continue
    }
    const key = `${draft.a}|${draft.axis}|${draft.gap}|${draft.gapLo}|${draft.kind}|${draft.level}`
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [draft])
    else bucket.push(draft)
  }
  for (const bucket of groups.values()) {
    const sorted = bucket.slice().sort((p, q) => p.segLo - q.segLo || p.segHi - q.segHi)
    let run: Draft | null = null
    for (const draft of sorted) {
      if (run !== null && draft.segLo <= run.segHi) {
        if (draft.segHi > run.segHi) run.segHi = draft.segHi
        if (draft.b < run.b) run.b = draft.b
        continue
      }
      run = { ...draft }
      out.push(run)
    }
  }
  return out
}

/**
 * 子段 → `Corridor`：`segIndex` 於每個 `(a, b, 間距軸)` 群組內沿**重疊軸**
 * 自 0 遞增重新編號（同牆面合併可能換掉代表 id，故統一在此編號），再以
 * 決定性序輸出供 deepEqual 比對。
 */
function materialize(drafts: Draft[]): Corridor[] {
  const groups = new Map<string, Draft[]>()
  for (const draft of drafts) {
    const key = `${draft.a}|${draft.b}|${draft.axis}`
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [draft])
    else bucket.push(draft)
  }
  const corridors: Corridor[] = []
  for (const bucket of groups.values()) {
    const sorted = bucket.slice().sort((p, q) => p.segLo - q.segLo || p.segHi - q.segHi)
    for (let i = 0; i < sorted.length; i++) {
      const draft = sorted[i]
      const rect: Rect =
        draft.axis === 'x'
          ? { x0: draft.gapLo, y0: draft.segLo, x1: draft.gapHi, y1: draft.segHi }
          : { x0: draft.segLo, y0: draft.gapLo, x1: draft.segHi, y1: draft.gapHi }
      corridors.push({
        a: draft.a,
        b: draft.b,
        axis: draft.axis,
        gap: draft.gap,
        rect,
        level: draft.level,
        kind: draft.kind,
        segIndex: i,
      })
    }
  }
  corridors.sort(
    (p, q) =>
      cmpStr(p.a, q.a) ||
      cmpStr(p.b, q.b) ||
      cmpStr(p.axis, q.axis) ||
      p.rect.x0 - q.rect.x0 ||
      p.rect.y0 - q.rect.y0 ||
      p.segIndex - q.segIndex,
  )
  return corridors
}

/**
 * D5：候選通道落在家具的哪一**世界**面。間距軸 `x` 時對側在較大 x → `E`、
 * 否則 `W`；間距軸 `y` 時對側在較大 y → `S`、否則 `N`（螢幕座標 y 向下）。
 * `d ≥ 0` 保證兩者在間距軸上已分離，故比較端點即可判邊。
 */
function sideOf(self: Rect, other: Rect, axis: Axis): Side {
  if (axis === 'x') return other.x0 >= self.x1 ? 'E' : 'W'
  return other.y0 >= self.y1 ? 'S' : 'N'
}

/* ------------------------------------------------------------------ *
 * 核心
 * ------------------------------------------------------------------ */

/**
 * D4 全套判定（單一 pass，實作在 `runCore()`）。`opts.index` 決定遮擋查詢
 * 策略（樸素掃全表／uniform grid），**兩路徑輸出必須逐字相同**，只在回傳的
 * `occlusionTests`／`cellVisits` 上不同（差分 oracle 依此斷言）。
 *
 * `report.unattachedDoors`／`unconnectedBlocks` 恆為空陣列——那兩欄由外殼
 * `clearance()` 自 `buildClearanceInput()` 填入（core 看不到原始 plan）。
 */
export function clearanceCore(input: ClearanceInput, opts: ClearanceCoreOptions): ClearanceCoreResult {
  const state = runCore(input, opts)
  return {
    report: state.report,
    occlusionTests: state.occlusionTests,
    cellVisits: state.cellVisits,
  }
}

/* ------------------------------------------------------------------ *
 * 核心零件（`clearanceCore()` 與 `clearanceForMoved()` 共用同一份實作，
 * 兩條路徑不得各寫一份——否則「增量 ≡ 全量」只會是巧合）
 * ------------------------------------------------------------------ */

/** 家具在前（索引 < `itemCount`）、牆體在後的攤平表。 */
function buildEntries(input: ClearanceInput): { entries: Entry[]; itemCount: number } {
  const entries: Entry[] = []
  for (const item of input.items) {
    entries.push({ id: item.id, rect: item.rect, item, frame: false })
  }
  const itemCount = entries.length
  for (const wall of input.walls) {
    entries.push({ id: wall.id, rect: wall.rect, item: null, frame: wall.frame })
  }
  return { entries, itemCount }
}

/** 單一配對的 D4 判定結果；`null` ＝兩軸皆無正重疊（斜對角）→ 不計。 */
type PairOutcome =
  | { kind: 'collision'; collision: Collision }
  | { kind: 'candidate'; candidate: Candidate }
  | null

/**
 * 一對（家具×家具／家具×牆）的 D4 謂詞判定。門洞與 `passable` 皆以
 * **母通道**判定、標記繼承給所有子段，故在此一併定案。
 *
 * `pairwise()` 對兩個引數對稱，故呼叫端一律以 `ai < bi` 的正規序呼叫，
 * 輸出的 `a`／`b` 順序即與全量逐對迴圈逐字相同。
 */
function pairOutcome(entries: Entry[], ai: number, bi: number, input: ClearanceInput): PairOutcome {
  const a = entries[ai]
  const b = entries[bi]
  const result = pairwise(a.rect, b.rect)
  if (result.kind === 'none') return null
  if (result.kind === 'collision') {
    return { kind: 'collision', collision: { a: a.id, b: b.id, rect: overlapBox(a.rect, b.rect) } }
  }
  const overlapAxis: Axis = result.axis === 'x' ? 'y' : 'x'
  const seg = projection(result.rect, overlapAxis)
  const gapInterval = projection(result.rect, result.axis)
  const candidate: Candidate = {
    ai,
    bi,
    axis: result.axis,
    overlapAxis,
    gap: result.gap,
    rect: result.rect,
    segLo: seg.lo,
    segHi: seg.hi,
    gapLo: gapInterval.lo,
    gapHi: gapInterval.hi,
    kind: 'corridor',
    level: null,
    occluderCount: 0,
    drafts: [],
  }
  const settings = input.settings
  const doorway = isDoorway(input.doors, candidate, settings.ignoreBelow)
  const suppressed = (a.item !== null && !a.item.passable) || (b.item !== null && !b.item.passable)
  candidate.kind = doorway ? 'doorway' : suppressed ? 'suppressed' : 'corridor'
  candidate.level = candidate.kind === 'corridor' ? levelFor(result.gap, settings) : null
  return { kind: 'candidate', candidate }
}

/** 遮擋掃描計數器（差分 oracle 斷言用；增量路徑不對外回報）。 */
interface ScanCounters {
  occlusionTests: number
  cellVisits: number
}

/**
 * 單一候選的 D4 遮擋扣除，就地寫回 `occluderCount` 與 `drafts`。
 * 兩路徑（樸素掃全表／grid）命中集合相同，只在計數器上不同。
 *
 * **只能對自己剛建好的 Candidate 呼叫**——對 cache 裡的候選要先複製一份，
 * 否則會就地改掉上一幀的 cache（見 `clearanceForMoved()`）。
 */
function occludeCandidate(
  cand: Candidate,
  entries: Entry[],
  itemCount: number,
  grid: Grid | null,
  counters: ScanCounters,
): void {
  const cuts: Interval[] = []
  let occluders = 0
  if (grid !== null) {
    grid.gen++
    forEachCell(grid, cand.rect, (cell) => {
      const end = grid.start[cell + 1]
      counters.cellVisits += end - grid.start[cell]
      for (let p = grid.start[cell]; p < end; p++) {
        const t = grid.members[p]
        if (grid.stamp[t] === grid.gen) continue
        grid.stamp[t] = grid.gen
        if (t === cand.ai || t === cand.bi) continue
        counters.occlusionTests++
        if (intersectArea(cand.rect, entries[t].rect) <= 0) continue
        occluders++
        cuts.push(projection(entries[t].rect, cand.overlapAxis))
      }
    })
  } else {
    for (let t = 0; t < entries.length; t++) {
      if (t === cand.ai || t === cand.bi || entries[t].frame) continue
      counters.occlusionTests++
      if (intersectArea(cand.rect, entries[t].rect) <= 0) continue
      occluders++
      cuts.push(projection(entries[t].rect, cand.overlapAxis))
    }
  }
  cand.occluderCount = occluders
  // 剩餘正長度子段各自成一筆；全被扣掉即作廢（`subtractIntervals` 內部
  // 先正規化 cuts，故兩路徑的 cuts 蒐集順序不同不影響輸出）。
  const drafts: Draft[] = []
  for (const seg of subtractIntervals({ lo: cand.segLo, hi: cand.segHi }, cuts)) {
    drafts.push({
      a: entries[cand.ai].id,
      b: entries[cand.bi].id,
      axis: cand.axis,
      gap: cand.gap,
      gapLo: cand.gapLo,
      gapHi: cand.gapHi,
      segLo: seg.lo,
      segHi: seg.hi,
      level: cand.level,
      kind: cand.kind,
      againstWall: cand.bi >= itemCount,
    })
  }
  cand.drafts = drafts
}

/** 每面配對間距表的一格（D10 cache 明列的「每面配對間距表」）。 */
interface SideGap {
  gap: number
  against: string
}

/**
 * D5 `sideViolations`：由**未預篩**的候選全集計算。每（家具,世界面）一個
 * 最小值累加器，key ＝ `${家具在 entries 的索引}|${世界面}`；同距離時取 id
 * 字典序較小者——取 min 與 tie-break 皆與走訪順序無關，故增量路徑重排
 * 候選序不會動到輸出。
 */
function sideTable(
  entries: Entry[],
  itemCount: number,
  candidates: readonly Candidate[],
): { table: Map<string, SideGap>; violations: SideViolation[] } {
  const table = new Map<string, SideGap>()
  const note = (selfIdx: number, otherIdx: number, cand: Candidate): void => {
    const self = entries[selfIdx]
    if (self.item === null || self.item.clearances === undefined) return
    const other = entries[otherIdx]
    const key = `${selfIdx}|${sideOf(self.rect, other.rect, cand.axis)}`
    const prev = table.get(key)
    if (prev === undefined || cand.gap < prev.gap || (cand.gap === prev.gap && other.id < prev.against)) {
      table.set(key, { gap: cand.gap, against: other.id })
    }
  }
  for (const cand of candidates) {
    note(cand.ai, cand.bi, cand)
    note(cand.bi, cand.ai, cand)
  }
  const violations: SideViolation[] = []
  for (let i = 0; i < itemCount; i++) {
    const item = entries[i].item
    if (item === null || item.clearances === undefined) continue
    for (const local of SIDE_KEYS) {
      const need = item.clearances[local]
      if (need === undefined) continue
      const world = worldSide(item.rotation, local)
      // 該面完全沒有投影重疊的配對 → 不列違規（D5：斜對角不計）。
      const found = table.get(`${i}|${world}`)
      if (found === undefined) continue
      if (found.gap < need) {
        violations.push({
          id: item.id,
          side: local,
          worldSide: world,
          need,
          actual: found.gap,
          against: found.against,
        })
      }
    }
  }
  return { table, violations }
}

/** D6 `doorViolations`：內／外開皆檢查，與 `maxGap` 預篩無關。 */
function doorViolationsFor(
  doors: readonly ClearanceDoor[],
  entries: Entry[],
  itemCount: number,
): DoorViolation[] {
  const out: DoorViolation[] = []
  for (const door of doors) {
    for (let i = 0; i < itemCount; i++) {
      if (intersectsSwing(door.geom, entries[i].rect)) {
        out.push({ doorId: door.id, itemId: entries[i].id })
      }
    }
  }
  return out
}

/**
 * 同牆面合併 → 重新編號 → 決定性排序。三個 violation 陣列**就地排序**，
 * 故呼叫端一律傳自己剛建好的陣列。`unattachedDoors`／`unconnectedBlocks`
 * 恆為空陣列——那兩欄由外殼自 `buildClearanceInput()` 填入。
 */
function assembleReport(
  drafts: Draft[],
  collisions: Collision[],
  sideViolations: SideViolation[],
  doorViolations: DoorViolation[],
): ClearanceReport {
  collisions.sort(
    (p, q) => cmpStr(p.a, q.a) || cmpStr(p.b, q.b) || p.rect.x0 - q.rect.x0 || p.rect.y0 - q.rect.y0,
  )
  sideViolations.sort(
    (p, q) => cmpStr(p.id, q.id) || cmpStr(p.side, q.side) || cmpStr(p.against, q.against),
  )
  doorViolations.sort((p, q) => cmpStr(p.doorId, q.doorId) || cmpStr(p.itemId, q.itemId))
  return {
    corridors: materialize(mergeWallFaces(drafts)),
    collisions,
    sideViolations,
    doorViolations,
    unattachedDoors: [],
    unconnectedBlocks: [],
  }
}

/** `runCore()` 的完整內部狀態；`clearanceWithCache()` 據此組 cache。 */
interface CoreState extends ClearanceCoreResult {
  /** 本次跑過的 `pairwise()` 配對數（`clearanceForMoved()` 的 stats 用）。 */
  pairsEvaluated: number
  entries: Entry[]
  itemCount: number
  candidates: Candidate[]
  collisions: Collision[]
  sideGaps: Map<string, SideGap>
}

/** D4 全套判定的單一 pass 實作（`clearanceCore()` 只是它的公開薄殼）。 */
function runCore(input: ClearanceInput, opts: ClearanceCoreOptions): CoreState {
  const cellSize = opts.cellSize === undefined ? DEFAULT_CELL_SIZE : opts.cellSize
  const maxGap = opts.maxGap
  const { entries, itemCount } = buildEntries(input)

  const collisions: Collision[] = []
  const candidates: Candidate[] = []
  let pairsEvaluated = 0

  // ── 單一 pass 逐對迭代：家具×家具、家具×牆；**牆×牆不配對**（外層只走
  //    家具索引即為此契約的實作）。────────────────────────────────────
  for (let ai = 0; ai < itemCount; ai++) {
    for (let bi = ai + 1; bi < entries.length; bi++) {
      pairsEvaluated++
      const outcome = pairOutcome(entries, ai, bi, input)
      if (outcome === null) continue
      if (outcome.kind === 'collision') collisions.push(outcome.collision)
      else candidates.push(outcome.candidate)
    }
  }

  // sideViolations／doorViolations 由**未預篩**的候選全集與逐對迴圈計算
  // （D4 兩路徑契約：預篩只影響通道輸出）。
  const side = sideTable(entries, itemCount, candidates)
  const doorViolations = doorViolationsFor(input.doors, entries, itemCount)

  // ── 遮擋子段（D4）：`maxGap` 預篩在此生效——`d > maxGap` 的候選不做
  //    遮擋、不產出通道；上面三類判定已先算完，故不受影響。────────────
  const grid = opts.index ? buildGrid(entries, input.bounds, cellSize) : null
  const counters: ScanCounters = { occlusionTests: 0, cellVisits: 0 }
  const drafts: Draft[] = []
  for (const cand of candidates) {
    if (maxGap !== undefined && cand.gap > maxGap) continue
    occludeCandidate(cand, entries, itemCount, grid, counters)
    for (const draft of cand.drafts) drafts.push(draft)
  }

  return {
    report: assembleReport(drafts, collisions, side.violations, doorViolations),
    occlusionTests: counters.occlusionTests,
    cellVisits: counters.cellVisits,
    pairsEvaluated,
    entries,
    itemCount,
    candidates,
    collisions,
    sideGaps: side.table,
  }
}

/* ------------------------------------------------------------------ *
 * 外殼
 * ------------------------------------------------------------------ */

/**
 * 逐家具攤平（排除 `deleted`）。獨立成函式是因為 `clearanceForMoved()` 的
 * 增量前提檢查要**逐字沿用同一份規則**重建家具列再比對——若兩邊各寫一份，
 * 「只有被拖的那一件變了」這個前提就會在某些欄位上悄悄失準。
 */
function clearanceItems(plan: RoomPlan): ClearanceItem[] {
  const items: ClearanceItem[] = []
  for (const furniture of plan.items) {
    if (furniture.deleted === true) continue
    const item: ClearanceItem = {
      id: furniture.id,
      rect: effectiveRect(furniture),
      passable: furniture.passable,
      rotation: furniture.rotation,
    }
    if (furniture.clearances !== undefined) item.clearances = furniture.clearances
    items.push(item)
  }
  return items
}

/**
 * `RoomPlan` → `ClearanceInput`（PLAN §Recommended approach 呼叫圖：
 * `normalize()` → 逐家具 `effectiveRect()`（排除 `deleted`）→ 建索引）。
 * `walls` ＝ D9 牆體（`wall:<index>`）＋外接框四邊零厚矩形
 * （`frame:N|E|S|W`）；門逐扇跑 D6 合法性，非法者入 `unattachedDoors`
 * 並**排除**於 `doors` 外（不參與 `doorViolations` 與門洞）。
 */
export function buildClearanceInput(
  plan: RoomPlan,
): ClearanceInput & { unattachedDoors: string[]; unconnectedBlocks: string[] } {
  const shape = normalize(plan.room)
  const items = clearanceItems(plan)

  const walls: ClearanceWall[] = shape.walls.map((rect, i) => ({
    id: `wall:${i}`,
    rect,
    frame: false,
  }))
  frameEdges(shape.bounds).forEach((rect, i) => {
    walls.push({ id: `frame:${FRAME_SIDES[i]}`, rect, frame: true })
  })

  const doors: ClearanceDoor[] = []
  const unattachedDoors: string[] = []
  for (const door of plan.room.doors) {
    const valid = withDerivedWall(door, shape)
    if (valid === null) {
      unattachedDoors.push(door.id)
      continue
    }
    doors.push({ id: valid.id, geom: doorGeometry(valid) })
  }

  return {
    items,
    walls,
    bounds: shape.bounds,
    doors,
    settings: {
      ignoreBelow: plan.settings.ignoreBelow,
      warnBelow: plan.settings.warnBelow,
      adviseBelow: plan.settings.adviseBelow,
    },
    unattachedDoors,
    unconnectedBlocks: shape.unconnected,
  }
}

/**
 * 外殼：`buildClearanceInput()` → `clearanceCore()`（預設索引版、cell 50）
 * → 補上 `unattachedDoors`／`unconnectedBlocks`。`maxGap` 由 `main.ts` 在
 * 「顯示距離」**關閉**時傳 `adviseBelow`（D4 OQ4 兩路徑契約）。
 */
export function clearance(
  plan: RoomPlan,
  opts: { index?: boolean; cellSize?: number; maxGap?: number } = {},
): ClearanceReport {
  const input = buildClearanceInput(plan)
  const core = clearanceCore(input, resolveOptions(opts))
  return {
    ...core.report,
    unattachedDoors: input.unattachedDoors,
    unconnectedBlocks: input.unconnectedBlocks,
  }
}

/* ------------------------------------------------------------------ *
 * 拖移期增量（T3.4／D10「處置（OQ4 定案）」）
 * ------------------------------------------------------------------ */

/** 三支外殼共用的選項正規化（索引預設開、cell 預設 50）。 */
function resolveOptions(opts: { index?: boolean; cellSize?: number; maxGap?: number }): ClearanceCoreOptions {
  return {
    index: opts.index !== false,
    cellSize: opts.cellSize === undefined ? DEFAULT_CELL_SIZE : opts.cellSize,
    maxGap: opts.maxGap,
  }
}

/**
 * `clearanceForMoved()` 的增量輸入（D10：cache 含**候選全集**、每筆
 * **`occluderCount`**、**每面配對間距表**）。對呼叫端而言是不透明的一包
 * 東西：拿到就原樣傳回下一次呼叫即可。
 *
 * **不可變**：`clearanceForMoved()` 不改動傳入的 cache（含其中的 Candidate
 * 與 Draft 物件），而是回一份新的——`drag.ts` 的 Esc 還原路徑因此可以安心
 * 退回任何一幀的舊 cache。
 */
export interface ClearanceCache {
  /** 產生本 cache 的 plan；`room` 參考用於增量前提檢查（見 `clearanceForMoved()`）。 */
  plan: RoomPlan
  input: ClearanceInput
  opts: ClearanceCoreOptions
  /** 家具在前、牆體在後的攤平表（索引即候選的 `ai`／`bi`）。 */
  entries: Entry[]
  itemCount: number
  /** 遮擋前的候選全集，依 `(ai, bi)` 字典序；每筆帶 `occluderCount` 與遮擋後子段。 */
  candidates: Candidate[]
  /** 碰撞全集（已排序）。 */
  collisions: Collision[]
  /** 每面配對間距表，key ＝ `${entries 索引}|${世界面}`。 */
  sideGaps: Map<string, SideGap>
  /** 上一幀的完整報告（`unattachedDoors`／`unconnectedBlocks` 已補）。 */
  report: ClearanceReport
}

/** `clearanceForMoved()` 的重算量（測試據此證明它不是偽裝的全量重算）。 */
export interface ClearanceMovedStats {
  /** 本次重跑的 `pairwise()` 配對數；增量路徑 ＝ `entries.length - 1`。 */
  pairsRecomputed: number
  /** 未重跑遮擋掃描、逐字沿用 cache 子段的候選數（`maxGap` 預篩掉者兩條路徑都不掃描，不計入）。 */
  corridorsReused: number
}

/**
 * `clearance()` 的帶 cache 版（D10「處置（OQ4 定案）」：`clearance()` 回
 * `{report, cache}`）。`report` 與 `clearance(plan, opts)` 逐字相同；`cache`
 * 供拖移期的 `clearanceForMoved()` 做增量。
 */
export function clearanceWithCache(
  plan: RoomPlan,
  opts: { index?: boolean; cellSize?: number; maxGap?: number } = {},
): { report: ClearanceReport; cache: ClearanceCache } {
  const full = buildCache(plan, resolveOptions(opts))
  return { report: full.report, cache: full.cache }
}

/** 全量計算 ＋ 組 cache（`clearanceWithCache()` 與增量退回路徑共用）。 */
function buildCache(
  plan: RoomPlan,
  opts: ClearanceCoreOptions,
): { report: ClearanceReport; cache: ClearanceCache; pairsEvaluated: number } {
  const input = buildClearanceInput(plan)
  const state = runCore(input, opts)
  const report: ClearanceReport = {
    ...state.report,
    unattachedDoors: input.unattachedDoors,
    unconnectedBlocks: input.unconnectedBlocks,
  }
  return {
    report,
    pairsEvaluated: state.pairsEvaluated,
    cache: {
      plan,
      input,
      opts,
      entries: state.entries,
      itemCount: state.itemCount,
      candidates: state.candidates,
      collisions: state.collisions,
      sideGaps: state.sideGaps,
      report,
    },
  }
}

/**
 * 增量前提：房型（`room`，含 blocks／doors）與三閾值未動。房型比對走
 * **參考相等**——`reducer.apply()` 的結構共享硬契約保證「只改一件家具時
 * `plan.room` 參考不變」；拿不到同一參考的呼叫端會退回全量（仍然正確，
 * 只是沒省到），而不是拿到一份過期的房型算出來的錯報告。
 */
function samePremise(cache: ClearanceCache, plan: RoomPlan): boolean {
  if (plan.room !== cache.plan.room) return false
  const next = plan.settings
  const prev = cache.plan.settings
  return (
    next.ignoreBelow === prev.ignoreBelow &&
    next.warnBelow === prev.warnBelow &&
    next.adviseBelow === prev.adviseBelow
  )
}

/** 兩筆分析單元是否在**所有**影響報告的欄位上相同。 */
function sameItem(a: ClearanceItem, b: ClearanceItem): boolean {
  if (a.id !== b.id || a.passable !== b.passable || a.rotation !== b.rotation) return false
  if (a.rect.x0 !== b.rect.x0 || a.rect.y0 !== b.rect.y0) return false
  if (a.rect.x1 !== b.rect.x1 || a.rect.y1 !== b.rect.y1) return false
  for (const side of SIDE_KEYS) {
    if (a.clearances?.[side] !== b.clearances?.[side]) return false
  }
  return true
}

/**
 * 被移動家具的新／舊矩形是否可能改變此候選的遮擋集合。只有**它**與候選
 * 通道矩形正面積相交才可能——其餘矩形一格都沒動，通道矩形本身也沒動
 * （候選不含被移動者）。`occluderCount === 0` 代表上一幀沒有任何第三矩形
 * 切過本候選，舊矩形必不在其中，故可省掉舊矩形那一測。
 */
function mayReocclude(cand: Candidate, prevRect: Rect, nextRect: Rect): boolean {
  if (intersectArea(cand.rect, nextRect) > 0) return true
  if (cand.occluderCount === 0) return false
  return intersectArea(cand.rect, prevRect) > 0
}

/** 候選的 `(ai, bi)` 字典序比較（合併兩串候選時維持與全量路徑同序）。 */
function pairBefore(p: Candidate, q: Candidate): boolean {
  return p.ai < q.ai || (p.ai === q.ai && p.bi < q.bi)
}

/** 會真的跑遮擋掃描的候選數（`maxGap` 預篩掉者不算）。 */
function scannedCount(candidates: readonly Candidate[], maxGap: number | undefined): number {
  if (maxGap === undefined) return candidates.length
  let n = 0
  for (const cand of candidates) if (cand.gap <= maxGap) n++
  return n
}

/**
 * 拖移期增量（D10「處置（OQ4 定案）」的備案）：只重算與被移動家具有關的
 * 部分，其餘逐筆沿用 cache。
 *
 * **輸出契約**：`report` 與 `clearance(plan, cache.opts)` 逐字相同（含
 * `kind:'suppressed'`／`'doorway'`、`level`、碰撞、`sideViolations`、
 * `doorViolations`）——S6 等價 property test 是這條的回歸網。
 *
 * 只重算四件事（D4 規則的直接推論）：
 * 1. **含被移動家具的所有配對**——碰撞、候選、門洞／`suppressed` 標記。
 * 2. **其餘候選中，通道矩形與被移動家具「舊」或「新」有效外框正面積相交者**
 *    的遮擋子段——能改變某候選遮擋集合的只有那一個動過的矩形，其餘候選
 *    逐字沿用（`stats.corridorsReused`）。
 * 3. **`doorViolations`**：只重測被移動家具 × 各扇門。
 * 4. **`sideViolations`**：自候選全集**整表重算**。成本 O(候選數)、與逐對
 *    迴圈同級（S1 實測 <5%，95% 在遮擋），而逐鍵髒標記需要逐家具候選索引、
 *    最壞情形反而更慢；整表重算同時免費保證與全量路徑逐字相同。
 *
 * **適用範圍**：家具。房型／門／閾值變動會改變房間本身，呼叫端須走
 * `clearance()`／`clearanceWithCache()`；本函式偵測到前提不成立時會自行
 * 退回全量（正確但沒省到），不會回一份錯的報告。被移動家具本身若同時改了
 * `rotation`／`passable`／`clearances` 亦正確——增量前提只要求「變動限於
 * 那一件」。
 *
 * @throws TypeError `movedId` 不是本平面圖中未刪除的家具 id（方塊／門／
 *   不存在的 id ＝呼叫端用錯路徑，不靜默吞掉）。
 */
export function clearanceForMoved(
  cache: ClearanceCache,
  plan: RoomPlan,
  movedId: string,
): { report: ClearanceReport; cache: ClearanceCache; stats: ClearanceMovedStats } {
  const moved = plan.items.find((f) => f.id === movedId && f.deleted !== true)
  if (moved === undefined) {
    throw new TypeError(`clearanceForMoved：「${movedId}」不是本平面圖中未刪除的家具 id`)
  }

  const maxGap = cache.opts.maxGap
  const movedIdx = cache.input.items.findIndex((item) => item.id === movedId)
  const nextItems = clearanceItems(plan)
  // 前提檢查：房型／閾值未動、家具集合對得上、且**只有**被移動的那一件變了。
  let diffIdx = -1
  let diffCount = 0
  if (movedIdx >= 0 && nextItems.length === cache.input.items.length) {
    for (let i = 0; i < nextItems.length; i++) {
      if (sameItem(cache.input.items[i], nextItems[i])) continue
      diffCount++
      diffIdx = i
    }
  }
  const usable =
    movedIdx >= 0 &&
    nextItems.length === cache.input.items.length &&
    nextItems[movedIdx].id === movedId &&
    diffCount <= 1 &&
    (diffCount === 0 || diffIdx === movedIdx) &&
    samePremise(cache, plan)
  if (!usable) {
    const full = buildCache(plan, cache.opts)
    return {
      report: full.report,
      cache: full.cache,
      stats: { pairsRecomputed: full.pairsEvaluated, corridorsReused: 0 },
    }
  }
  if (diffCount === 0) {
    // 原地未動：連 cache 都不必換（D10 拖移態常見的同格重複事件）。
    return {
      report: cache.report,
      cache,
      stats: { pairsRecomputed: 0, corridorsReused: scannedCount(cache.candidates, maxGap) },
    }
  }

  const itemCount = cache.itemCount
  const prevRect = cache.input.items[movedIdx].rect
  const nextItem = nextItems[movedIdx]
  const nextRect = nextItem.rect
  const entries = cache.entries.slice()
  entries[movedIdx] = { id: nextItem.id, rect: nextRect, item: nextItem, frame: false }
  const input: ClearanceInput = { ...cache.input, items: nextItems }

  // ── (1) 含被移動家具的所有配對。`pairwise()` 對稱，故一律以 `(min,max)`
  //    正規序呼叫；t 由小到大掃，產出的串天然依 `(ai,bi)` 字典序。────────
  const movedCandidates: Candidate[] = []
  const movedCollisions: Collision[] = []
  let pairsRecomputed = 0
  for (let t = 0; t < entries.length; t++) {
    if (t === movedIdx) continue
    pairsRecomputed++
    const outcome = pairOutcome(entries, Math.min(movedIdx, t), Math.max(movedIdx, t), input)
    if (outcome === null) continue
    if (outcome.kind === 'collision') movedCollisions.push(outcome.collision)
    else movedCandidates.push(outcome.candidate)
  }

  // ── (2) 候選全集 ＝ cache 中不含被移動家具者 ∪ 新算的；兩串皆依
  //    `(ai,bi)` 字典序，線性合併即與全量路徑同序。合併途中順手決定每筆
  //    「沿用子段」或「重跑遮擋」——重跑者**另建物件**，cache 不被改寫。──
  const cellSize = cache.opts.cellSize === undefined ? DEFAULT_CELL_SIZE : cache.opts.cellSize
  // grid 直接重建：涵蓋量與 `buildGrid()` 原本那一趟相同（S1 歸在逐對迴圈
  // 的 <5% 裡），比維護 CSR 版面的增量刪改簡單得多也不會漏。
  const grid = cache.opts.index ? buildGrid(entries, input.bounds, cellSize) : null
  // 計數器是差分 oracle 的斷言材料，增量路徑不對外回報，收在這裡就丟。
  const counters: ScanCounters = { occlusionTests: 0, cellVisits: 0 }
  const candidates: Candidate[] = []
  const drafts: Draft[] = []
  let corridorsReused = 0

  const take = (cand: Candidate, fresh: boolean): void => {
    if (maxGap !== undefined && cand.gap > maxGap) {
      // 預篩：不做遮擋、不產出通道（D4 OQ4）。新算的候選子段本來就是空的。
      candidates.push(cand)
      return
    }
    if (!fresh && !mayReocclude(cand, prevRect, nextRect)) {
      candidates.push(cand)
      corridorsReused++
      for (const draft of cand.drafts) drafts.push(draft)
      return
    }
    const target = fresh ? cand : { ...cand }
    occludeCandidate(target, entries, itemCount, grid, counters)
    candidates.push(target)
    for (const draft of target.drafts) drafts.push(draft)
  }

  let k = 0
  for (const cand of cache.candidates) {
    if (cand.ai === movedIdx || cand.bi === movedIdx) continue
    while (k < movedCandidates.length && pairBefore(movedCandidates[k], cand)) {
      take(movedCandidates[k++], true)
    }
    take(cand, false)
  }
  while (k < movedCandidates.length) take(movedCandidates[k++], true)

  // ── (3) 碰撞：只有含被移動家具者會變（id 比對即可——牆體 id 帶 `:`，
  //    與家具 id 字集互斥）。────────────────────────────────────────────
  const collisions: Collision[] = []
  for (const col of cache.collisions) {
    if (col.a === movedId || col.b === movedId) continue
    collisions.push(col)
  }
  for (const col of movedCollisions) collisions.push(col)

  // ── (4) doorViolations：只重測被移動家具 × 各扇門。─────────────────
  const doorViolations: DoorViolation[] = []
  for (const violation of cache.report.doorViolations) {
    if (violation.itemId === movedId) continue
    doorViolations.push(violation)
  }
  for (const door of input.doors) {
    if (intersectsSwing(door.geom, nextRect)) doorViolations.push({ doorId: door.id, itemId: movedId })
  }

  const side = sideTable(entries, itemCount, candidates)
  const report: ClearanceReport = {
    ...assembleReport(drafts, collisions, side.violations, doorViolations),
    // 房型未動（增量前提），故這兩欄逐字沿用上一幀。
    unattachedDoors: cache.report.unattachedDoors,
    unconnectedBlocks: cache.report.unconnectedBlocks,
  }
  return {
    report,
    cache: {
      plan,
      input,
      opts: cache.opts,
      entries,
      itemCount,
      candidates,
      collisions: report.collisions,
      sideGaps: side.table,
      report,
    },
    stats: { pairsRecomputed, corridorsReused },
  }
}
