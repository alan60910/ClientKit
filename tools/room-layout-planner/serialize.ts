/**
 * T1.9 — 存檔清洗與序列化（(internal design doc) §D7
 * 「契約——`parsePlan(raw): RoomPlan`」逐條白名單、§D3 三閾值三元組、
 * §D6 門 `wall` 恆重推＋幾何非法者保留（r3.4：未附著改由 report 標記，
 * 不再丟扇）、§D9「blocks 整組判定、自尾端丟」、§D10 n 口徑
 * （家具 75／結構 50／門 10／牆體 200）、§Verification「serialize」）。
 *
 * 四條載入路徑（localStorage／JSON 匯入／URL hash／還原 backup）共用本檔
 * 的 `parsePlan()`。全域原則：
 * 1. **逐欄白名單重建**——永不 spread raw、永不搬未知欄；輸出物件一律以
 *    物件字面值組出，故 `__proto__` 之類的鍵不可能進入輸出圖，也不可能
 *    污染 `Object.prototype`。讀取一律經 `field()`（`Object.hasOwn`），
 *    原型鏈上的值不算數。
 * 2. **drop-and-continue**——逐元素丟棄並記一筆 `DropNote`；只有「JSON
 *    壞／頂層非物件／版本無遷移步進」三種情形整份失敗（呼叫端據此回落
 *    預設並先寫 backup，時點見 D7，屬 main.ts 職責）。
 * 3. **先 slice 再清洗**——10⁵ 件的敵意輸入只會清洗前 75 件。
 *
 * 純邏輯葉模組：不參照 DOM。`TextEncoder`／`TextDecoder`／`atob`／`btoa`／
 * `crypto` 在 Node 24 與瀏覽器皆為全域。維持純可抹除語法（無 enum／
 * namespace，PLAN §Implementation notes）。
 */
import { withDerivedWall, type DoorInput } from './door.js'
import {
  DEFAULT_COLOR,
  DEFAULT_ROOM,
  DEFAULT_SETTINGS,
  effectiveSize,
  ID_RE,
  isRotation,
  isSize,
  isSnapValue,
  isValidColor,
  isValidMaxItems,
  isValidName,
  isValidThresholds,
  LIMITS,
  NAME_MAX_CODEPOINTS,
  newId,
  normalizeColor,
  type Door,
  type Furniture,
  type RoomBlock,
  type RoomPlan,
  type Rotation,
  type Settings,
  type Side,
} from './model.js'
import { normalize, type NormalizedRoom } from './room-shape.js'
import type { Rect } from './geometry.js'

/**
 * 欄位級謂詞（名稱／色碼／尺寸／列舉／三閾值三元組）已集中於 `model.ts`
 * （T1.8 refactor，D3「`apply()` 與 `parsePlan()` 同規」）。此處再匯出兩個
 * 常數以維持既有呼叫點相容。
 */
export { DEFAULT_COLOR, NAME_MAX_CODEPOINTS }

/** 現行存檔版本（資料形見 model.ts `RoomPlan`）。 */
export const PLAN_VERSION = 1

/**
 * 被丟棄／被退回預設的欄位紀錄；`path` 為元素位置、`reason` 為肇因欄位。
 *
 * `level`（T4.8，PLAN §D7）區分「真的丟東西／退預設」（`'drop'`）與純資訊性
 * 記錄（`'info'`）。`'info'` 目前有兩個來源，共同點是**什麼都沒少**，不該被
 * 呼叫端算進「存檔有 N 處無法辨識」的播報（見 `countDropped()`）：
 * 1. `raiseMaxItems()` 的 `maxItems-raised`——軟上限被抬高但沒有家具被丟；
 * 2. `cleanDoor()` 的 `door-unattached`——門幾何非法但**仍保留**，改由
 *    `report.unattachedDoors` 標「門未附著」（r3.4 D7）。
 */
export interface DropNote {
  path: string
  reason: string
  level: 'drop' | 'info'
}

/**
 * 依 `level` 分計筆數（T4.8）。呼叫端（`main.ts` 開機／匯入／還原播報）只該
 * 用 `.drop` 決定要不要播報「無法辨識」；`.info` 供日後需要時使用，目前
 * 不驅動任何播報。
 */
export function countDropped(notes: readonly DropNote[]): { drop: number; info: number } {
  let drop = 0
  let info = 0
  for (const note of notes) {
    if (note.level === 'info') info += 1
    else drop += 1
  }
  return { drop, info }
}

/** 整份失敗的三種原因（D7：只有這三種才回落預設）。 */
export type ParseFailure = 'not-json' | 'not-object' | 'unsupported-version'

/** `parsePlan()` 結果；成功時附逐項 `dropped` 供播報。 */
export type ParseResult =
  | { ok: true; plan: RoomPlan; dropped: DropNote[] }
  | { ok: false; reason: ParseFailure }

/** 版本遷移步進：僅在 raw 層搬動／剝除／派生欄位，**不**做清洗。 */
export type MigrationStep = (old: Record<string, unknown>) => Record<string, unknown>

/**
 * 遷移階梯（比照 `tools/statusline-builder/config.ts` 的 `MIGRATION_STEPS`）：
 * 鍵＝**來源**版本號，值＝該版本 → 鍵+1 的 raw 層轉換。v1 即現行版本，
 * 故今日為空表；日後 bump 至 v2 時在此加鍵 `1:`，`parsePlan` 的 while
 * 迴圈不動。空表不代表迴圈是死碼——它同時是「未知版本一律 unsupported」
 * 的唯一出口。
 */
export const MIGRATION_STEPS: Readonly<Record<number, MigrationStep>> = Object.freeze({})

// ── 內部常數與小工具 ──────────────────────────────────────────────────

/**
 * blocks 與門鉸鏈的座標範圍（D7：允許負座標的凸出區；r3.4 起門 x／y 亦
 * 沿用同一組範圍，故常數由兩處共用，不另抄一份數字）。
 */
const COORD_MIN = -5000
const COORD_MAX = 10000

const SIDES: readonly Side[] = ['N', 'E', 'S', 'W']

/** 合法牆側列舉（未附著門的 `wall` 佔位取值用；見 `cleanDoor`）。 */
function isSide(value: unknown): value is Side {
  return value === 'N' || value === 'E' || value === 'S' || value === 'W'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 自有屬性讀取；原型鏈上的同名值視同不存在（`__proto__` 防線）。 */
function field(raw: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(raw, key) ? raw[key] : undefined
}

/** 該鍵是否為自有屬性——決定「非法值」要不要記 note（缺欄退預設不記）。 */
function present(raw: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(raw, key)
}

/** 整數且落在閉區間內才回傳其值，否則 `null`（`1e309`／`NaN`／`'12'` 皆不過）。 */
function intIn(value: unknown, lo: number, hi: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi
    ? value
    : null
}

/** 寬深欄位（`model.isSize`：整數 1–5000）取值形，不過則 `null`。 */
function sizeOrNull(value: unknown): number | null {
  return isSize(value) ? value : null
}

/** 純整數（門的鉸鏈座標無獨立範圍，合法性交由 `edges` 判定）。 */
function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/** 合法 id 字串（D7 `ID_RE`），否則 `null`——待 `assignIds()` 重生。 */
function validId(value: unknown): string | null {
  return typeof value === 'string' && ID_RE.test(value) ? value : null
}

/** 清洗中的元素：`value.id` 於 `assignIds()` 統一回填。 */
interface Pending<T extends { id: string }> {
  value: T
  path: string
  rawId: string | null
}

/**
 * id 唯一性（D7：`items` + `blocks` + `doors` 聯集，**先出現者勝**）。
 * 非法或重複者以 `newId()` 重生（極低機率撞號時續抽），並記一筆 note。
 * 三陣列的元素 id 在此之前皆為佔位空字串——`normalize()` 只用 block id
 * 做「未連接」回報、`withDerivedWall()` 只原樣搬運 door id，兩者都不影響
 * 幾何判定，故延後到此一次指派是安全的。
 */
function assignIds(pendings: readonly Pending<{ id: string }>[], drop: DropNote[]): void {
  const seen = new Set<string>()
  for (const pending of pendings) {
    const raw = pending.rawId
    if (raw !== null && !seen.has(raw)) {
      pending.value.id = raw
      seen.add(raw)
      continue
    }
    let fresh = newId()
    while (seen.has(fresh)) fresh = newId()
    pending.value.id = fresh
    seen.add(fresh)
    drop.push({ path: pending.path, reason: 'id', level: 'drop' })
  }
}

// ── 逐欄清洗 ─────────────────────────────────────────────────────────

/** 房間寬深：整數 1–5000，否則退 `DEFAULT_ROOM`（記 note）。 */
function cleanRoomSize(
  room: Record<string, unknown> | null,
  drop: DropNote[],
): { width: number; depth: number } {
  const readOne = (key: 'width' | 'depth', fallback: number): number => {
    if (room === null) return fallback
    const value = sizeOrNull(field(room, key))
    if (value !== null) return value
    if (present(room, key)) drop.push({ path: 'room', reason: key, level: 'drop' })
    return fallback
  }
  return {
    width: readOne('width', DEFAULT_ROOM.width),
    depth: readOne('depth', DEFAULT_ROOM.depth),
  }
}

/** 單一方塊：kind 列舉、座標 [−5000, 10000]、寬深 1–5000；任一不過即丟。 */
function cleanBlock(raw: unknown, path: string, drop: DropNote[]): Pending<RoomBlock> | null {
  if (!isRecord(raw)) {
    drop.push({ path, reason: 'not-object', level: 'drop' })
    return null
  }
  const kind = field(raw, 'kind')
  if (kind !== 'extend' && kind !== 'cutout') {
    drop.push({ path, reason: 'kind', level: 'drop' })
    return null
  }
  const x = intIn(field(raw, 'x'), COORD_MIN, COORD_MAX)
  if (x === null) {
    drop.push({ path, reason: 'x', level: 'drop' })
    return null
  }
  const y = intIn(field(raw, 'y'), COORD_MIN, COORD_MAX)
  if (y === null) {
    drop.push({ path, reason: 'y', level: 'drop' })
    return null
  }
  const width = sizeOrNull(field(raw, 'width'))
  if (width === null) {
    drop.push({ path, reason: 'width', level: 'drop' })
    return null
  }
  const depth = sizeOrNull(field(raw, 'depth'))
  if (depth === null) {
    drop.push({ path, reason: 'depth', level: 'drop' })
    return null
  }
  return { value: { id: '', kind, x, y, width, depth }, path, rawId: validId(field(raw, 'id')) }
}

/**
 * blocks **整組判定**（D9／D7）：逐件清洗後，若正規化牆體 > `LIMITS.walls`
 * 則**自陣列尾端**逐一丟棄並重算，直到 ≤ 上限。自尾端丟使「同一組 blocks
 * 的判定結果與清洗順序無關」、且匯出→匯入等冪（第二次載入已 ≤ 上限，迴圈
 * 不再動作）。blocks 為空時牆體必為 0，迴圈保證終止。
 */
function enforceWallLimit(
  width: number,
  depth: number,
  blocks: Pending<RoomBlock>[],
  drop: DropNote[],
): NormalizedRoom {
  let shape = normalize({ width, depth, blocks: blocks.map((b) => b.value) })
  while (shape.walls.length > LIMITS.walls && blocks.length > 0) {
    const removed = blocks.pop()
    if (removed !== undefined) drop.push({ path: removed.path, reason: 'wall-limit', level: 'drop' })
    shape = normalize({ width, depth, blocks: blocks.map((b) => b.value) })
  }
  return shape
}

/** 家具 `clearances`：只留 N/E/S/W 且值為正整數者；全無則省略該欄。 */
function cleanClearances(
  raw: Record<string, unknown>,
  path: string,
  drop: DropNote[],
): Partial<Record<Side, number>> | undefined {
  if (!present(raw, 'clearances')) return undefined
  const source = field(raw, 'clearances')
  if (!isRecord(source)) {
    drop.push({ path, reason: 'clearances', level: 'drop' })
    return undefined
  }
  const kept: Partial<Record<Side, number>> = {}
  let bad = false
  let count = 0
  for (const side of SIDES) {
    if (!present(source, side)) continue
    const value = sizeOrNull(field(source, side))
    if (value === null) {
      bad = true
      continue
    }
    kept[side] = value
    count += 1
  }
  if (bad) drop.push({ path, reason: 'clearances', level: 'drop' })
  return count > 0 ? kept : undefined
}

/**
 * 單件家具。必要欄（`name`／`width`／`depth`）不過即丟；其餘欄非法時
 * **保留該件**、退預設並記 note。`x`／`y` 取整後夾至 `bounds`——夾的是
 * **有效外框**（旋轉後寬深），故 rotation 須先定案。
 */
function cleanItem(
  raw: unknown,
  path: string,
  bounds: Rect,
  drop: DropNote[],
): Pending<Furniture> | null {
  if (!isRecord(raw)) {
    drop.push({ path, reason: 'not-object', level: 'drop' })
    return null
  }

  // `isValidName()` 內含 UTF-16 長度粗篩，避免對超長敵意字串展開。
  const nameRaw = field(raw, 'name')
  if (!isValidName(nameRaw)) {
    drop.push({ path, reason: 'name', level: 'drop' })
    return null
  }

  const width = sizeOrNull(field(raw, 'width'))
  if (width === null) {
    drop.push({ path, reason: 'width', level: 'drop' })
    return null
  }
  const depth = sizeOrNull(field(raw, 'depth'))
  if (depth === null) {
    drop.push({ path, reason: 'depth', level: 'drop' })
    return null
  }

  const colorRaw = field(raw, 'color')
  let color = DEFAULT_COLOR
  if (isValidColor(colorRaw)) {
    color = normalizeColor(colorRaw)
  } else if (present(raw, 'color')) {
    drop.push({ path, reason: 'color', level: 'drop' })
  }

  const rotationRaw = field(raw, 'rotation')
  let rotation: Rotation = 0
  if (isRotation(rotationRaw)) {
    rotation = rotationRaw
  } else if (present(raw, 'rotation')) {
    drop.push({ path, reason: 'rotation', level: 'drop' })
  }

  const passableRaw = field(raw, 'passable')
  let passable = true
  if (typeof passableRaw === 'boolean') {
    passable = passableRaw
  } else if (present(raw, 'passable')) {
    drop.push({ path, reason: 'passable', level: 'drop' })
  }

  const readCoord = (key: 'x' | 'y'): number => {
    const value = field(raw, key)
    if (isInt(value)) return value
    if (present(raw, key)) drop.push({ path, reason: key, level: 'drop' })
    return 0
  }
  const { w, d } = effectiveSize({ width, depth, rotation })
  const x = Math.max(bounds.x0, Math.min(readCoord('x'), bounds.x1 - w))
  const y = Math.max(bounds.y0, Math.min(readCoord('y'), bounds.y1 - d))

  const item: Furniture = { id: '', name: nameRaw, color, width, depth, x, y, rotation, passable }
  const clearances = cleanClearances(raw, path, drop)
  if (clearances !== undefined) item.clearances = clearances
  // `deleted` 僅接受字面 `true`；`false`／缺欄同為「未刪除」，不記 note。
  if (field(raw, 'deleted') === true) item.deleted = true
  return { value: item, path, rawId: validId(field(raw, 'id')) }
}

/**
 * 單扇門。`wall` **一律不信任輸入**——可推導者一律交 `withDerivedWall()`
 * 自 `edges` 重推（D6／D7）。
 *
 * **幾何合法性不是丟棄條件**（r3.4 D7，與 D6「房間或方塊變動後門重跑合法
 * 性，非法者 report 標『門未附著』」對齊）：鉸鏈不在任何極大牆段上、或門扇
 * 跨距超出該牆段時**仍保留該扇**——否則「縮房 → autosave → reload」會讓
 * reducer 刻意留下的門憑空消失。保留時 `wall` 取輸入值（限合法列舉
 * `N|E|S|W`）、否則以 `'N'` 佔位，並記一筆**資訊性** `door-unattached`
 * （`level:'info'`，不計入「無法辨識」播報，見 `countDropped()`）。未附著
 * 的門由 `clearance.ts` 的 `buildClearanceInput()` 重跑同一組 D6 判定後入
 * `report.unattachedDoors`，不參與 `doorViolations` 與門洞。
 *
 * 只有**欄位級**非法才丟該扇（`level:'drop'`）：x／y 非整數或超出
 * [−5000, 10000]（與 blocks 同範圍）、`width` 非 1–5000 整數、`leafDir`／
 * `swing` 不在列舉內。
 *
 * 保留的未附著門 round-trip **冪等**：輸出的 `wall` 必為合法列舉，第二次
 * `parsePlan` 讀到它後逐欄不變。
 */
function cleanDoor(
  raw: unknown,
  path: string,
  shape: NormalizedRoom,
  drop: DropNote[],
): Pending<Door> | null {
  if (!isRecord(raw)) {
    drop.push({ path, reason: 'not-object', level: 'drop' })
    return null
  }
  const x = intIn(field(raw, 'x'), COORD_MIN, COORD_MAX)
  if (x === null) {
    drop.push({ path, reason: 'x', level: 'drop' })
    return null
  }
  const y = intIn(field(raw, 'y'), COORD_MIN, COORD_MAX)
  if (y === null) {
    drop.push({ path, reason: 'y', level: 'drop' })
    return null
  }
  const width = sizeOrNull(field(raw, 'width'))
  if (width === null) {
    drop.push({ path, reason: 'width', level: 'drop' })
    return null
  }
  const leafDir = field(raw, 'leafDir')
  if (leafDir !== '+' && leafDir !== '-') {
    drop.push({ path, reason: 'leafDir', level: 'drop' })
    return null
  }
  const swing = field(raw, 'swing')
  if (swing !== 'in' && swing !== 'out') {
    drop.push({ path, reason: 'swing', level: 'drop' })
    return null
  }
  const rawId = validId(field(raw, 'id'))
  const input: DoorInput = { id: '', x, y, leafDir, width, swing }
  const door = withDerivedWall(input, shape)
  if (door !== null) return { value: door, path, rawId }

  // 未附著：保留該扇，`wall` 僅作佔位（不代表幾何事實），欄序與
  // `withDerivedWall()` 的輸出一致。
  const wallRaw = field(raw, 'wall')
  const wall: Side = isSide(wallRaw) ? wallRaw : 'N'
  drop.push({ path, reason: 'door-unattached', level: 'info' })
  return { value: { id: '', x, y, wall, leafDir, width, swing }, path, rawId }
}

/**
 * settings：三閾值以**三元組**為單位驗證（D3）——三者皆為 0–5000 整數
 * **且** `ignoreBelow ≤ warnBelow ≤ adviseBelow` 才採用，任一不過（含
 * 數值全合法但純違序的 `[80,60,75]`）即**整組**退預設。`snap` 列舉
 * {1,5,10}、`showSwing` 布林、`maxItems` 整數 1–75（T4.7），各自獨立退
 * 預設。
 *
 * `itemCount` ＝本份存檔**清洗後留下**的家具件數（已先 slice 至
 * `LIMITS.items`）。軟上限低於實際件數時**抬高軟上限、不丟家具**：舊版
 * 存檔沒有 `maxItems` 欄、他人分享的圖可能調高過上限，兩者都不該因為一個
 * 效能取捨欄位而少掉家具。
 */
function cleanSettings(raw: unknown, itemCount: number, drop: DropNote[]): Settings {
  const fallback: Settings = { ...DEFAULT_SETTINGS }
  if (raw === undefined) return raiseMaxItems(fallback, itemCount, drop)
  if (!isRecord(raw)) {
    drop.push({ path: 'settings', reason: 'not-object', level: 'drop' })
    return raiseMaxItems(fallback, itemCount, drop)
  }

  const triple = {
    ignoreBelow: field(raw, 'ignoreBelow'),
    warnBelow: field(raw, 'warnBelow'),
    adviseBelow: field(raw, 'adviseBelow'),
  }
  if (isValidThresholds(triple)) {
    fallback.ignoreBelow = triple.ignoreBelow
    fallback.warnBelow = triple.warnBelow
    fallback.adviseBelow = triple.adviseBelow
  } else if (
    present(raw, 'ignoreBelow') ||
    present(raw, 'warnBelow') ||
    present(raw, 'adviseBelow')
  ) {
    drop.push({ path: 'settings', reason: 'thresholds', level: 'drop' })
  }

  const snap = field(raw, 'snap')
  if (isSnapValue(snap)) {
    fallback.snap = snap
  } else if (present(raw, 'snap')) {
    drop.push({ path: 'settings', reason: 'snap', level: 'drop' })
  }

  const showSwing = field(raw, 'showSwing')
  if (typeof showSwing === 'boolean') {
    fallback.showSwing = showSwing
  } else if (present(raw, 'showSwing')) {
    drop.push({ path: 'settings', reason: 'showSwing', level: 'drop' })
  }

  const maxItems = field(raw, 'maxItems')
  if (isValidMaxItems(maxItems)) {
    fallback.maxItems = maxItems
  } else if (present(raw, 'maxItems')) {
    drop.push({ path: 'settings', reason: 'maxItems', level: 'drop' })
  }

  return raiseMaxItems(fallback, itemCount, drop)
}

/**
 * 軟上限不得低於實際件數（T4.7）：低了就抬到實際件數並記一筆資訊性
 * `maxItems-raised`。`itemCount` 恆 ≤ `LIMITS.items`（呼叫端已 slice），
 * 故抬高後仍在 `isValidMaxItems` 的範圍內。
 */
function raiseMaxItems(settings: Settings, itemCount: number, drop: DropNote[]): Settings {
  if (settings.maxItems >= itemCount) return settings
  settings.maxItems = itemCount
  // T4.8：純資訊性——沒有家具被丟棄，不計入「無法辨識」播報。
  drop.push({ path: 'settings', reason: 'maxItems-raised', level: 'info' })
  return settings
}

/** 取陣列並先 slice 至上限（D7「先 slice 再逐件清洗」）；非陣列 → 空。 */
function sliceArray(value: unknown, limit: number, path: string, drop: DropNote[]): unknown[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) drop.push({ path, reason: 'not-array', level: 'drop' })
    return []
  }
  if (value.length > limit) {
    drop.push({ path, reason: 'over-limit', level: 'drop' })
    return value.slice(0, limit)
  }
  return value
}

// ── 對外 API ────────────────────────────────────────────────────────

/**
 * D7 白名單重建。`raw` 可為 JSON 字串（內部 `JSON.parse`）或已解析的值。
 *
 * 失敗（整份回落預設，呼叫端須先寫 backup）：JSON 壞 → `'not-json'`；
 * 頂層非物件（`null`／陣列／純量）→ `'not-object'`；版本非整數、大於
 * 現行版本、或查無遷移步進 → `'unsupported-version'`。
 *
 * 成功時 `plan` 為全新物件圖（`version: 1`），`dropped` 逐筆記錄被丟棄的
 * 元素與被退回預設的欄位。
 *
 * `opts.steps` 供測試注入假遷移階梯；`opts.now` 為日後需要時鐘的遷移步進
 * 保留，v1 資料形無時間欄位，故目前不讀取。
 */
export function parsePlan(
  raw: unknown,
  opts?: { steps?: Readonly<Record<number, MigrationStep>>; now?: () => string },
): ParseResult {
  let source: unknown = raw
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      return { ok: false, reason: 'not-json' }
    }
  }
  if (!isRecord(source)) return { ok: false, reason: 'not-object' }

  // 版本階梯（比照 statusline `migrateConfig`）：每步後硬性寫回
  // `version + 1`，故版本嚴格遞增、迴圈必定終止；步進表有限，未知版本
  // 一律自 `step === undefined` 出口回 unsupported。
  const steps = opts?.steps ?? MIGRATION_STEPS
  let current: Record<string, unknown> = source
  while (field(current, 'version') !== PLAN_VERSION) {
    const version = field(current, 'version')
    if (typeof version !== 'number' || !Number.isInteger(version) || version > PLAN_VERSION) {
      return { ok: false, reason: 'unsupported-version' }
    }
    const step: MigrationStep | undefined = steps[version]
    if (step === undefined) return { ok: false, reason: 'unsupported-version' }
    current = { ...step(current), version: version + 1 }
  }

  const dropped: DropNote[] = []
  const roomRaw = field(current, 'room')
  let room: Record<string, unknown> | null = null
  if (isRecord(roomRaw)) room = roomRaw
  else if (roomRaw !== undefined) dropped.push({ path: 'room', reason: 'not-object', level: 'drop' })

  const { width, depth } = cleanRoomSize(room, dropped)

  const blockPendings: Pending<RoomBlock>[] = []
  const rawBlocks = sliceArray(
    room === null ? undefined : field(room, 'blocks'),
    LIMITS.blocks,
    'blocks',
    dropped,
  )
  for (let i = 0; i < rawBlocks.length; i++) {
    const cleaned = cleanBlock(rawBlocks[i], `blocks[${i}]`, dropped)
    if (cleaned !== null) blockPendings.push(cleaned)
  }
  const shape = enforceWallLimit(width, depth, blockPendings, dropped)

  const itemPendings: Pending<Furniture>[] = []
  const rawItems = sliceArray(field(current, 'items'), LIMITS.items, 'items', dropped)
  for (let i = 0; i < rawItems.length; i++) {
    const cleaned = cleanItem(rawItems[i], `items[${i}]`, shape.bounds, dropped)
    if (cleaned !== null) itemPendings.push(cleaned)
  }

  const doorPendings: Pending<Door>[] = []
  const rawDoors = sliceArray(
    room === null ? undefined : field(room, 'doors'),
    LIMITS.doors,
    'doors',
    dropped,
  )
  for (let i = 0; i < rawDoors.length; i++) {
    const cleaned = cleanDoor(rawDoors[i], `doors[${i}]`, shape, dropped)
    if (cleaned !== null) doorPendings.push(cleaned)
  }

  // 聯集唯一性，順序＝items → blocks → doors（D7「先出現者勝」）。
  assignIds([...itemPendings, ...blockPendings, ...doorPendings], dropped)

  const plan: RoomPlan = {
    version: PLAN_VERSION,
    room: {
      width,
      depth,
      blocks: blockPendings.map((p) => p.value),
      doors: doorPendings.map((p) => p.value),
    },
    items: itemPendings.map((p) => p.value),
    settings: cleanSettings(field(current, 'settings'), itemPendings.length, dropped),
  }
  return { ok: true, plan, dropped }
}

/**
 * 匯出／PNG／分享編碼共用的純函式副本（D7）：移除 `deleted` 家具，其餘
 * **逐欄保留**。回傳全新物件圖——原 plan 與其三個陣列、家具物件、
 * `clearances` 子物件一律不被改動、也不被共用參考。
 */
export function stripDeleted(plan: RoomPlan): RoomPlan {
  const items: Furniture[] = []
  for (const item of plan.items) {
    if (item.deleted === true) continue
    const copy: Furniture = {
      id: item.id,
      name: item.name,
      color: item.color,
      width: item.width,
      depth: item.depth,
      x: item.x,
      y: item.y,
      rotation: item.rotation,
      passable: item.passable,
    }
    if (item.clearances !== undefined) copy.clearances = { ...item.clearances }
    items.push(copy)
  }
  return {
    version: plan.version,
    room: {
      width: plan.room.width,
      depth: plan.room.depth,
      blocks: plan.room.blocks.map((b) => ({
        id: b.id,
        kind: b.kind,
        x: b.x,
        y: b.y,
        width: b.width,
        depth: b.depth,
      })),
      doors: plan.room.doors.map((d) => ({
        id: d.id,
        x: d.x,
        y: d.y,
        wall: d.wall,
        leafDir: d.leafDir,
        width: d.width,
        swing: d.swing,
      })),
    },
    items,
    settings: { ...plan.settings },
  }
}

/**
 * 匯出／分享用序列化：恆經 `stripDeleted`（D7）。
 * autosave 存的是**完整** plan（含 deleted），由 main.ts 直接
 * `JSON.stringify(plan)`，不走本函式。
 */
export function serializePlan(plan: RoomPlan): string {
  return JSON.stringify(stripDeleted(plan))
}

/** `location.hash` 的 payload 前綴（`#plan=…`）。 */
export const HASH_PREFIX = 'plan='

/** 原始 `location.hash` 長度閘（D7：≤32 KB 才往下解）。 */
export const HASH_RAW_MAX = 32 * 1024

/** 編碼後長度閘（D7：超過即不產生連結，提示改用 JSON）。 */
export const HASH_SHARE_MAX = 8000

/** hash 解碼的失敗原因（含 `parsePlan` 的三種）。 */
export type HashFailure = 'too-long' | 'decode-failed' | ParseFailure

export type HashResult =
  | { ok: true; plan: RoomPlan; dropped: DropNote[] }
  | { ok: false; reason: HashFailure }

/** bytes → base64url（去 `=` 補位）。分塊展開避免超長 arguments。 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url → bytes；字元集或長度不合法即 `null`（`atob` 亦包 try）。 */
function base64UrlToBytes(text: string): Uint8Array | null {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null
  const body = normalized.replace(/=+$/, '')
  // 長度 %4===1 在 base64 不可能出現（1 個字元編不出整個 byte）。
  if (body.length % 4 === 1) return null
  const padded = body + '='.repeat((4 - (body.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * 分享連結編碼（D7 順序）：`stripDeleted` → JSON → `TextEncoder` →
 * base64url（去 `=`）。超過 `HASH_SHARE_MAX` 回 `null`——呼叫端據此
 * 不產生連結並提示改用 JSON 匯出。
 */
export function encodePlanHash(plan: RoomPlan): string | null {
  const bytes = new TextEncoder().encode(serializePlan(plan))
  const encoded = bytesToBase64Url(bytes)
  return encoded.length > HASH_SHARE_MAX ? null : encoded
}

/**
 * 分享連結解碼（D7 順序釘死）：原始長度閘 → `decodeURIComponent` 容錯
 * （擲錯即用原字串）→ base64url → `TextDecoder('utf-8', {fatal:true})`
 * → `parsePlan`。`hashFragment` 可為完整 `#plan=…`，亦可只給 payload。
 */
export function decodePlanHash(hashFragment: string): HashResult {
  if (hashFragment.length > HASH_RAW_MAX) return { ok: false, reason: 'too-long' }

  let payload = hashFragment.startsWith('#') ? hashFragment.slice(1) : hashFragment
  if (payload.startsWith(HASH_PREFIX)) payload = payload.slice(HASH_PREFIX.length)
  try {
    payload = decodeURIComponent(payload)
  } catch {
    // 壞的百分號序列：維持原字串續解，交由 base64url 字元集判定。
  }

  const bytes = base64UrlToBytes(payload)
  if (bytes === null) return { ok: false, reason: 'decode-failed' }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, reason: 'decode-failed' }
  }
  return parsePlan(text)
}

/**
 * DOM id（D7 不變量：**裸 id 不進 DOM**，恆為 `{kind}-{id}` 前綴形，
 * 避免家具／方塊／門同號時撞 id，也避免與頁面既有 id 相撞）。
 */
export function domId(kind: 'item' | 'block' | 'door', id: string): string {
  return `${kind}-${id}`
}
