/**
 * T1.8 — 狀態轉移（(internal design doc) §Recommended approach
 * 「`reducer.ts` — `apply(plan, action) → plan`（結構共享；夾框對
 * `item/move`／`item/rotate`／`item/update`／`block/*`／`room/set` 生效，門走
 * D6 合法性拒收不套夾框；上限守衛與牆體硬上限後置條件回「不變＋拒絕原因」）
 * ＋ undo 棧純函式（上限 50；棧深 50 時第 51 次 undo 為 no-op）」、§D9
 * 「執行期硬上限（後置條件）」、§D10「n 口徑／結構共享／拖移態統一」、
 * §狀態與資料形「旋轉錨點：夾框優先於中心不變」、§Implementation notes
 * 「M0 實作注意：reducer 對牆體上限只呼叫一次 `normalize()`」）。
 *
 * 三條貫穿全檔的硬契約：
 * 1. **不變＋拒絕原因**——任何被拒的 action 回傳的 `plan` 是**原參考**
 *    （`ok:false` 分支恆 `plan === 輸入 plan`），播報文字由 messages.ts 組。
 * 2. **結構共享**——只換動到的那一層：改一件家具時 `plan.room`、
 *    `plan.settings` 與其餘 `items` 元素的參考皆不變；完全沒變動的 action
 *    直接回原 plan 參考。
 * 3. **夾框只夾 `bounds`**——非凸房型下家具可以壓在牆體上（由 clearance
 *    報碰撞，不由 reducer 阻擋），否則凹槽旁的家具會被夾到卡住。
 *
 * undo／redo 是對棧的直接操作、**不經 `apply()`**（PLAN 刻意）；拖移態的
 * 純狀態部分（begin／to／cancel／commit／interrupt）亦在本檔，計時器與
 * Pointer 事件屬 M2 的 `drag.ts`。純函式、零 DOM。
 */
import { withDerivedWall, type DoorInput } from './door.js'
import type { Rect } from './geometry.js'
import {
  DEFAULT_COLOR,
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
  newId,
  normalizeColor,
  rotateAboutCenter,
  type Action,
  type Door,
  type Furniture,
  type RoomBlock,
  type RoomPlan,
  type Rotation,
  type Settings,
  type Side,
} from './model.js'
import { findPreset } from './presets.js'
import { normalize } from './room-shape.js'

/** 拒絕原因（`main.ts` 據此查 messages.ts 的播報字串）。 */
export type RejectReason =
  | 'limit-items'
  | 'limit-blocks'
  | 'limit-doors'
  | 'wall-cap'
  | 'door-invalid'
  | 'not-found'
  | 'invalid-input'

/** 拒絕詳情；`detail` 為肇因欄位或 id，本檔不做 i18n。 */
export interface Rejection {
  reason: RejectReason
  detail?: string
  /** `wall-cap` 專用：合併後超出 `LIMITS.walls` 的牆體條數。 */
  walls?: number
}

/**
 * `apply()` 結果。`ok:false` 時 `plan` 恆為**輸入的同一參考**（D9
 * 「整個 action 回『不變＋拒絕原因』」）；`ok:true` 且無實質變動時亦可能
 * 回原參考（no-op，如原地移動）。
 */
export type ApplyResult =
  | { ok: true; plan: RoomPlan; notes?: string[] }
  | { ok: false; plan: RoomPlan; rejection: Rejection }

/** blocks 座標範圍（D7；`serialize.ts` 的 `parsePlan` 持同一組界）。 */
const BLOCK_COORD_MIN = -5000
const BLOCK_COORD_MAX = 10000

const SIDES: readonly Side[] = ['N', 'E', 'S', 'W']

// ── 小工具 ───────────────────────────────────────────────────────────

function reject(
  plan: RoomPlan,
  reason: RejectReason,
  detail?: string,
  walls?: number,
): ApplyResult {
  const rejection: Rejection = { reason }
  if (detail !== undefined) rejection.detail = detail
  if (walls !== undefined) rejection.walls = walls
  return { ok: false, plan, rejection }
}

/** 純整數（座標無獨立範圍者共用）。 */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/** 方塊座標：整數且落在 [−5000, 10000]（D7）。 */
function isBlockCoord(value: unknown): value is number {
  return isInteger(value) && value >= BLOCK_COORD_MIN && value <= BLOCK_COORD_MAX
}

/**
 * `clearances`：鍵須為 N/E/S/W、值須為 `isSize`（整數 1–5000）；任一不過回
 * `null`（→ `'invalid-input'`）。全空時回空物件，呼叫端據此省略該欄。
 */
function validateClearances(raw: unknown): Partial<Record<Side, number>> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const kept: Partial<Record<Side, number>> = {}
  for (const key of Object.keys(source)) {
    if (!SIDES.includes(key as Side)) return null
    const value = source[key]
    if (value === undefined) continue
    if (!isSize(value)) return null
    kept[key as Side] = value
  }
  return kept
}

function sameClearances(
  a: Partial<Record<Side, number>> | undefined,
  b: Partial<Record<Side, number>> | undefined,
): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  for (const side of SIDES) {
    if (a[side] !== b[side]) return false
  }
  return true
}

/** 逐欄比較——用來判定「這次 action 其實沒改到東西」以維持參考不變。 */
function sameFurniture(a: Furniture, b: Furniture): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.color === b.color &&
    a.width === b.width &&
    a.depth === b.depth &&
    a.x === b.x &&
    a.y === b.y &&
    a.rotation === b.rotation &&
    a.passable === b.passable &&
    a.deleted === b.deleted &&
    sameClearances(a.clearances, b.clearances)
  )
}

function sameBlock(a: RoomBlock, b: RoomBlock): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.depth === b.depth
  )
}

function sameDoor(a: Door, b: Door): boolean {
  return (
    a.id === b.id &&
    a.x === b.x &&
    a.y === b.y &&
    a.wall === b.wall &&
    a.leafDir === b.leafDir &&
    a.width === b.width &&
    a.swing === b.swing
  )
}

function sameSettings(a: Settings, b: Settings): boolean {
  return (
    a.ignoreBelow === b.ignoreBelow &&
    a.warnBelow === b.warnBelow &&
    a.adviseBelow === b.adviseBelow &&
    a.snap === b.snap &&
    a.showSwing === b.showSwing &&
    a.maxItems === b.maxItems
  )
}

/** 三陣列聯集的已用 id（D7：id 在 items／blocks／doors 之間亦須唯一）。 */
function usedIds(plan: RoomPlan): Set<string> {
  const ids = new Set<string>()
  for (const item of plan.items) ids.add(item.id)
  for (const block of plan.room.blocks) ids.add(block.id)
  for (const door of plan.room.doors) ids.add(door.id)
  return ids
}

/** 沿用呼叫端指定的 id（須過 `ID_RE` 且未被佔用），否則 `newId()` 重生。 */
function resolveId(requested: unknown, plan: RoomPlan): string {
  const taken = usedIds(plan)
  if (typeof requested === 'string' && ID_RE.test(requested) && !taken.has(requested)) {
    return requested
  }
  let fresh = newId()
  while (taken.has(fresh)) fresh = newId()
  return fresh
}

// ── 夾框（PLAN 六類：item/move、item/rotate、item/update、block/*、room/set）──

/** `hi < lo` 代表家具比外接框還大 → pin 到 `lo`（PLAN：pin 到 bounds.x0/y0）。 */
function clampAxis(value: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return value < lo ? lo : value > hi ? hi : value
}

/**
 * 夾**有效外框**至 `bounds`（非凸房型只夾外接框，家具可壓在牆體上——
 * 由 clearance 報碰撞，不由此處阻擋）。無位移時回原物件參考。
 */
function clampItem(item: Furniture, bounds: Rect): Furniture {
  const { w, d } = effectiveSize(item)
  const x = clampAxis(item.x, bounds.x0, bounds.x1 - w)
  const y = clampAxis(item.y, bounds.y0, bounds.y1 - d)
  return x === item.x && y === item.y ? item : { ...item, x, y }
}

/**
 * 房型改變後重夾**所有未刪除**家具（PLAN：「`room/set` 與 `block/*` 後
 * 重新夾框」）。`deleted` 家具不渲染也不參與 clearance，座標原樣保留，
 * 還原時再由呼叫端的 `item/restore` 之後的動作處理。全無位移時回原陣列。
 */
function clampAllItems(items: Furniture[], bounds: Rect): Furniture[] {
  let changed = false
  const next = items.map((item) => {
    if (item.deleted === true) return item
    const clamped = clampItem(item, bounds)
    if (clamped !== item) changed = true
    return clamped
  })
  return changed ? next : items
}

/** 只換 `items` 這一層（`room`／`settings` 參考不動）。 */
function withItems(plan: RoomPlan, items: Furniture[]): RoomPlan {
  return items === plan.items ? plan : { ...plan, items }
}

/** 單件替換；新值與原物件同參考時整份 plan 亦不換。 */
function replaceItem(plan: RoomPlan, index: number, next: Furniture): RoomPlan {
  if (plan.items[index] === next) return plan
  const items = plan.items.slice()
  items[index] = next
  return { ...plan, items }
}

/**
 * 房型類 action 的共同尾段（D9 執行期硬上限後置條件）：對套用後的房型跑
 * **一次** `normalize()`——判定與落地共用同一結果（PLAN M0 實作注意：最壞
 * p95 ≈ 4 ms，勿重複呼叫）。超過 `LIMITS.walls` 即整個 action 回「不變＋
 * 拒絕原因」（`block/remove` 亦拒），否則以新 `bounds` 重夾所有家具。
 */
function commitRoom(plan: RoomPlan, room: RoomPlan['room']): ApplyResult {
  const shape = normalize(room)
  if (shape.walls.length > LIMITS.walls) {
    return reject(plan, 'wall-cap', undefined, shape.walls.length)
  }
  const items = clampAllItems(plan.items, shape.bounds)
  return { ok: true, plan: { ...plan, room, items } }
}

// ── 家具 ─────────────────────────────────────────────────────────────

function addItem(plan: RoomPlan, action: Extract<Action, { type: 'item/add' }>): ApplyResult {
  // T4.7：守衛是**軟上限** `settings.maxItems`（使用者可於面板調高，拒絕
  // 文字據此提示）；`LIMITS.items` 仍留作第二道硬上限，擋掉未經 `parsePlan`
  // 清洗就塞進來的 plan（如測試直接組的物件）。D10／OQ4：`deleted` 家具兩
  // 道都計入。
  const cap = plan.settings.maxItems
  if (plan.items.length >= cap) return reject(plan, 'limit-items', String(cap))
  if (plan.items.length >= LIMITS.items) return reject(plan, 'limit-items', String(LIMITS.items))

  const source = action.item ?? {}
  const preset = action.preset === undefined ? undefined : findPreset(action.preset)

  const name = source.name ?? preset?.name
  if (!isValidName(name)) return reject(plan, 'invalid-input', 'name')
  const width = source.width ?? preset?.width
  if (!isSize(width)) return reject(plan, 'invalid-input', 'width')
  const depth = source.depth ?? preset?.depth
  if (!isSize(depth)) return reject(plan, 'invalid-input', 'depth')

  let color = DEFAULT_COLOR
  if (source.color !== undefined) {
    if (!isValidColor(source.color)) return reject(plan, 'invalid-input', 'color')
    color = normalizeColor(source.color)
  }

  let rotation: Rotation = 0
  if (source.rotation !== undefined) {
    if (!isRotation(source.rotation)) return reject(plan, 'invalid-input', 'rotation')
    rotation = source.rotation
  }

  let passable = preset?.passable ?? true
  if (source.passable !== undefined) {
    if (typeof source.passable !== 'boolean') return reject(plan, 'invalid-input', 'passable')
    passable = source.passable
  }

  const x = source.x ?? 0
  if (!isInteger(x)) return reject(plan, 'invalid-input', 'x')
  const y = source.y ?? 0
  if (!isInteger(y)) return reject(plan, 'invalid-input', 'y')

  // 預設庫的 `clearances` 為區域座標原表，明示欄位整組覆蓋（不逐面合併）。
  let clearances = preset?.clearances === undefined ? undefined : { ...preset.clearances }
  if (source.clearances !== undefined) {
    const cleaned = validateClearances(source.clearances)
    if (cleaned === null) return reject(plan, 'invalid-input', 'clearances')
    clearances = Object.keys(cleaned).length > 0 ? cleaned : undefined
  }

  const item: Furniture = {
    id: resolveId(source.id, plan),
    name,
    color,
    width,
    depth,
    x,
    y,
    rotation,
    passable,
  }
  if (clearances !== undefined) item.clearances = clearances

  const bounds = normalize(plan.room).bounds
  return { ok: true, plan: withItems(plan, [...plan.items, clampItem(item, bounds)]) }
}

function updateItem(
  plan: RoomPlan,
  action: Extract<Action, { type: 'item/update' }>,
): ApplyResult {
  const index = plan.items.findIndex((item) => item.id === action.id)
  if (index < 0) return reject(plan, 'not-found', action.id)
  const current = plan.items[index]
  const patch = action.patch
  const next: Furniture = { ...current }

  if (Object.hasOwn(patch, 'name')) {
    if (!isValidName(patch.name)) return reject(plan, 'invalid-input', 'name')
    next.name = patch.name
  }
  if (Object.hasOwn(patch, 'color')) {
    if (!isValidColor(patch.color)) return reject(plan, 'invalid-input', 'color')
    next.color = normalizeColor(patch.color)
  }
  if (Object.hasOwn(patch, 'width')) {
    if (!isSize(patch.width)) return reject(plan, 'invalid-input', 'width')
    next.width = patch.width
  }
  if (Object.hasOwn(patch, 'depth')) {
    if (!isSize(patch.depth)) return reject(plan, 'invalid-input', 'depth')
    next.depth = patch.depth
  }
  if (Object.hasOwn(patch, 'rotation')) {
    if (!isRotation(patch.rotation)) return reject(plan, 'invalid-input', 'rotation')
    next.rotation = patch.rotation
  }
  if (Object.hasOwn(patch, 'passable')) {
    if (typeof patch.passable !== 'boolean') return reject(plan, 'invalid-input', 'passable')
    next.passable = patch.passable
  }
  if (Object.hasOwn(patch, 'x')) {
    if (!isInteger(patch.x)) return reject(plan, 'invalid-input', 'x')
    next.x = patch.x
  }
  if (Object.hasOwn(patch, 'y')) {
    if (!isInteger(patch.y)) return reject(plan, 'invalid-input', 'y')
    next.y = patch.y
  }
  if (Object.hasOwn(patch, 'clearances')) {
    // 明示 `undefined` ＝清掉整張需留表（panel 的「無」選項）。
    if (patch.clearances === undefined) {
      delete next.clearances
    } else {
      const cleaned = validateClearances(patch.clearances)
      if (cleaned === null) return reject(plan, 'invalid-input', 'clearances')
      if (Object.keys(cleaned).length > 0) next.clearances = cleaned
      else delete next.clearances
    }
  }

  const clamped = clampItem(next, normalize(plan.room).bounds)
  return { ok: true, plan: replaceItem(plan, index, sameFurniture(current, clamped) ? current : clamped) }
}

function moveItem(plan: RoomPlan, action: Extract<Action, { type: 'item/move' }>): ApplyResult {
  const index = plan.items.findIndex((item) => item.id === action.id)
  if (index < 0) return reject(plan, 'not-found', action.id)
  if (!isInteger(action.x)) return reject(plan, 'invalid-input', 'x')
  if (!isInteger(action.y)) return reject(plan, 'invalid-input', 'y')
  const current = plan.items[index]
  const moved: Furniture = { ...current, x: action.x, y: action.y }
  const clamped = clampItem(moved, normalize(plan.room).bounds)
  return { ok: true, plan: replaceItem(plan, index, sameFurniture(current, clamped) ? current : clamped) }
}

/**
 * `item/rotate` ＝ `rotateAboutCenter()`（中心不變、依目標 rotation 定向
 * 取整）再夾框——**夾框優先於中心不變**（PLAN §狀態與資料形）。
 */
function rotateItem(plan: RoomPlan, action: Extract<Action, { type: 'item/rotate' }>): ApplyResult {
  const index = plan.items.findIndex((item) => item.id === action.id)
  if (index < 0) return reject(plan, 'not-found', action.id)
  const current = plan.items[index]
  const rotated: Furniture = { ...current, ...rotateAboutCenter(current) }
  const clamped = clampItem(rotated, normalize(plan.room).bounds)
  return { ok: true, plan: replaceItem(plan, index, sameFurniture(current, clamped) ? current : clamped) }
}

/** 非破壞性刪除（D7／資料形）：只設旗標，座標與其餘欄位原樣保留。 */
function deleteItem(plan: RoomPlan, id: string): ApplyResult {
  const index = plan.items.findIndex((item) => item.id === id)
  if (index < 0) return reject(plan, 'not-found', id)
  if (plan.items[index].deleted === true) return { ok: true, plan }
  return { ok: true, plan: replaceItem(plan, index, { ...plan.items[index], deleted: true }) }
}

/**
 * 還原時一併重夾：`clampAllItems()` 刻意跳過 `deleted` 家具，房間在刪除
 * 期間縮小的話，原座標可能已落在 `bounds` 外——不夾就會還原成一件畫不出
 * 來的家具。房間沒變時夾框為恆等，座標逐字保留。
 */
function restoreItem(plan: RoomPlan, id: string): ApplyResult {
  const index = plan.items.findIndex((item) => item.id === id)
  if (index < 0) return reject(plan, 'not-found', id)
  if (plan.items[index].deleted !== true) return { ok: true, plan }
  const next: Furniture = { ...plan.items[index] }
  delete next.deleted
  return { ok: true, plan: replaceItem(plan, index, clampItem(next, normalize(plan.room).bounds)) }
}

/** 「清空已刪除」鈕專用（D7：不由匯出／PNG／分享觸發）。 */
function purgeItems(plan: RoomPlan): ApplyResult {
  const kept = plan.items.filter((item) => item.deleted !== true)
  return { ok: true, plan: kept.length === plan.items.length ? plan : { ...plan, items: kept } }
}

// ── 房間與方塊 ───────────────────────────────────────────────────────

function setRoom(plan: RoomPlan, action: Extract<Action, { type: 'room/set' }>): ApplyResult {
  if (!isSize(action.width)) return reject(plan, 'invalid-input', 'width')
  if (!isSize(action.depth)) return reject(plan, 'invalid-input', 'depth')
  if (plan.room.width === action.width && plan.room.depth === action.depth) {
    return { ok: true, plan }
  }
  return commitRoom(plan, { ...plan.room, width: action.width, depth: action.depth })
}

function withBlocks(plan: RoomPlan, blocks: RoomBlock[]): RoomPlan['room'] {
  return { ...plan.room, blocks }
}

function addBlock(plan: RoomPlan, action: Extract<Action, { type: 'block/add' }>): ApplyResult {
  if (plan.room.blocks.length >= LIMITS.blocks) return reject(plan, 'limit-blocks')
  const raw = action.block
  if (raw.kind !== 'extend' && raw.kind !== 'cutout') return reject(plan, 'invalid-input', 'kind')
  if (!isBlockCoord(raw.x)) return reject(plan, 'invalid-input', 'x')
  if (!isBlockCoord(raw.y)) return reject(plan, 'invalid-input', 'y')
  if (!isSize(raw.width)) return reject(plan, 'invalid-input', 'width')
  if (!isSize(raw.depth)) return reject(plan, 'invalid-input', 'depth')
  const block: RoomBlock = {
    id: resolveId(raw.id, plan),
    kind: raw.kind,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    depth: raw.depth,
  }
  return commitRoom(plan, withBlocks(plan, [...plan.room.blocks, block]))
}

function updateBlock(
  plan: RoomPlan,
  action: Extract<Action, { type: 'block/update' }>,
): ApplyResult {
  const index = plan.room.blocks.findIndex((block) => block.id === action.id)
  if (index < 0) return reject(plan, 'not-found', action.id)
  const current = plan.room.blocks[index]
  const patch = action.patch
  const next: RoomBlock = { ...current }
  if (Object.hasOwn(patch, 'kind')) {
    if (patch.kind !== 'extend' && patch.kind !== 'cutout') {
      return reject(plan, 'invalid-input', 'kind')
    }
    next.kind = patch.kind
  }
  if (Object.hasOwn(patch, 'x')) {
    if (!isBlockCoord(patch.x)) return reject(plan, 'invalid-input', 'x')
    next.x = patch.x
  }
  if (Object.hasOwn(patch, 'y')) {
    if (!isBlockCoord(patch.y)) return reject(plan, 'invalid-input', 'y')
    next.y = patch.y
  }
  if (Object.hasOwn(patch, 'width')) {
    if (!isSize(patch.width)) return reject(plan, 'invalid-input', 'width')
    next.width = patch.width
  }
  if (Object.hasOwn(patch, 'depth')) {
    if (!isSize(patch.depth)) return reject(plan, 'invalid-input', 'depth')
    next.depth = patch.depth
  }
  if (sameBlock(current, next)) return { ok: true, plan }
  const blocks = plan.room.blocks.slice()
  blocks[index] = next
  return commitRoom(plan, withBlocks(plan, blocks))
}

function moveBlock(plan: RoomPlan, action: Extract<Action, { type: 'block/move' }>): ApplyResult {
  const index = plan.room.blocks.findIndex((block) => block.id === action.id)
  if (index < 0) return reject(plan, 'not-found', action.id)
  if (!isBlockCoord(action.x)) return reject(plan, 'invalid-input', 'x')
  if (!isBlockCoord(action.y)) return reject(plan, 'invalid-input', 'y')
  const current = plan.room.blocks[index]
  if (current.x === action.x && current.y === action.y) return { ok: true, plan }
  const blocks = plan.room.blocks.slice()
  blocks[index] = { ...current, x: action.x, y: action.y }
  return commitRoom(plan, withBlocks(plan, blocks))
}

/**
 * 移除方塊**同樣**要過牆體硬上限（D9 明文：「`block/remove` 亦拒，播報建議
 * 先移除其他方塊」）——拿掉一個橋接用的大 cutout 會讓底下的梳齒全部現形。
 */
function removeBlock(plan: RoomPlan, id: string): ApplyResult {
  const index = plan.room.blocks.findIndex((block) => block.id === id)
  if (index < 0) return reject(plan, 'not-found', id)
  const blocks = plan.room.blocks.filter((_, i) => i !== index)
  return commitRoom(plan, withBlocks(plan, blocks))
}

// ── 門（D6：只拒收、不夾框）──────────────────────────────────────────

interface DoorFields {
  x: number
  y: number
  leafDir: '+' | '-'
  width: number
  swing: 'in' | 'out'
}

type DoorFieldsResult = { ok: true; value: DoorFields } | { ok: false; field: string }

function validateDoorFields(raw: {
  x: unknown
  y: unknown
  leafDir: unknown
  width: unknown
  swing: unknown
}): DoorFieldsResult {
  if (!isInteger(raw.x)) return { ok: false, field: 'x' }
  if (!isInteger(raw.y)) return { ok: false, field: 'y' }
  if (!isSize(raw.width)) return { ok: false, field: 'width' }
  if (raw.leafDir !== '+' && raw.leafDir !== '-') return { ok: false, field: 'leafDir' }
  if (raw.swing !== 'in' && raw.swing !== 'out') return { ok: false, field: 'swing' }
  return {
    ok: true,
    value: { x: raw.x, y: raw.y, width: raw.width, leafDir: raw.leafDir, swing: raw.swing },
  }
}

function withDoors(plan: RoomPlan, doors: Door[]): RoomPlan {
  return { ...plan, room: { ...plan.room, doors } }
}

/**
 * 門的共同尾段：欄位過關後交 `withDerivedWall()` 對**現行**房型重推
 * `wall` 並驗合法性（鉸鏈須在極大牆段上、跨距須完整落入）；`null` →
 * `'door-invalid'`，**不夾框**（門沒有「最近合法位置」的定義，硬挪會把
 * 門搬到別面牆上）。
 */
function deriveDoorOrReject(
  plan: RoomPlan,
  id: string,
  fields: DoorFields,
): { ok: true; door: Door } | { ok: false; result: ApplyResult } {
  const input: DoorInput = { id, ...fields }
  const door = withDerivedWall(input, normalize(plan.room))
  if (door === null) return { ok: false, result: reject(plan, 'door-invalid', id) }
  return { ok: true, door }
}

function addDoor(plan: RoomPlan, action: Extract<Action, { type: 'door/add' }>): ApplyResult {
  if (plan.room.doors.length >= LIMITS.doors) return reject(plan, 'limit-doors')
  const fields = validateDoorFields(action.door)
  if (!fields.ok) return reject(plan, 'invalid-input', fields.field)
  const derived = deriveDoorOrReject(plan, resolveId(action.door.id, plan), fields.value)
  if (!derived.ok) return derived.result
  return { ok: true, plan: withDoors(plan, [...plan.room.doors, derived.door]) }
}

function updateDoor(plan: RoomPlan, action: Extract<Action, { type: 'door/update' }>): ApplyResult {
  const index = plan.room.doors.findIndex((door) => door.id === action.id)
  if (index < 0) return reject(plan, 'not-found', action.id)
  const current = plan.room.doors[index]
  const patch = action.patch
  const fields = validateDoorFields({
    x: Object.hasOwn(patch, 'x') ? patch.x : current.x,
    y: Object.hasOwn(patch, 'y') ? patch.y : current.y,
    width: Object.hasOwn(patch, 'width') ? patch.width : current.width,
    leafDir: Object.hasOwn(patch, 'leafDir') ? patch.leafDir : current.leafDir,
    swing: Object.hasOwn(patch, 'swing') ? patch.swing : current.swing,
  })
  if (!fields.ok) return reject(plan, 'invalid-input', fields.field)
  const derived = deriveDoorOrReject(plan, current.id, fields.value)
  if (!derived.ok) return derived.result
  if (sameDoor(current, derived.door)) return { ok: true, plan }
  const doors = plan.room.doors.slice()
  doors[index] = derived.door
  return { ok: true, plan: withDoors(plan, doors) }
}

function moveDoor(plan: RoomPlan, action: Extract<Action, { type: 'door/move' }>): ApplyResult {
  const index = plan.room.doors.findIndex((door) => door.id === action.id)
  if (index < 0) return reject(plan, 'not-found', action.id)
  const current = plan.room.doors[index]
  const fields = validateDoorFields({
    x: action.x,
    y: action.y,
    width: current.width,
    leafDir: current.leafDir,
    swing: current.swing,
  })
  if (!fields.ok) return reject(plan, 'invalid-input', fields.field)
  const derived = deriveDoorOrReject(plan, current.id, fields.value)
  if (!derived.ok) return derived.result
  if (sameDoor(current, derived.door)) return { ok: true, plan }
  const doors = plan.room.doors.slice()
  doors[index] = derived.door
  return { ok: true, plan: withDoors(plan, doors) }
}

function removeDoor(plan: RoomPlan, id: string): ApplyResult {
  const index = plan.room.doors.findIndex((door) => door.id === id)
  if (index < 0) return reject(plan, 'not-found', id)
  return { ok: true, plan: withDoors(plan, plan.room.doors.filter((_, i) => i !== index)) }
}

// ── 設定 ─────────────────────────────────────────────────────────────

/**
 * 三閾值以**三元組**為單位驗證（D3：「`apply()` 與 `parsePlan()` 同規：
 * 任一非法或違反 `0 ≤ ignoreBelow ≤ warnBelow ≤ adviseBelow` 即整組退
 * 預設」）——注意是 `ok` ＋ `notes`，不是拒收：panel 層（M2）會先擋掉多數
 * 情形，本條是最後一道防線。`snap`／`showSwing` 則各自拒收。
 */
function updateSettings(
  plan: RoomPlan,
  action: Extract<Action, { type: 'settings/update' }>,
): ApplyResult {
  const patch = action.patch
  const next: Settings = { ...plan.settings }
  if (Object.hasOwn(patch, 'snap')) {
    if (!isSnapValue(patch.snap)) return reject(plan, 'invalid-input', 'snap')
    next.snap = patch.snap
  }
  if (Object.hasOwn(patch, 'showSwing')) {
    if (typeof patch.showSwing !== 'boolean') return reject(plan, 'invalid-input', 'showSwing')
    next.showSwing = patch.showSwing
  }
  // T4.7 `maxItems` 走**拒收**（不是三閾值那種整組退預設）：調低上限是明確
  // 的使用者意圖，靜默改成別的數字比拒絕更難察覺。兩種拒絕以 `detail` 區
  // 分，面板據此挑文案。「現有件數」含 `deleted`，與 `item/add` 守衛同口徑。
  if (Object.hasOwn(patch, 'maxItems')) {
    if (!isValidMaxItems(patch.maxItems)) return reject(plan, 'invalid-input', 'maxItems')
    if (patch.maxItems < plan.items.length) {
      return reject(plan, 'invalid-input', 'max-items-below-count')
    }
    next.maxItems = patch.maxItems
  }

  const triple = {
    ignoreBelow: Object.hasOwn(patch, 'ignoreBelow') ? patch.ignoreBelow : plan.settings.ignoreBelow,
    warnBelow: Object.hasOwn(patch, 'warnBelow') ? patch.warnBelow : plan.settings.warnBelow,
    adviseBelow: Object.hasOwn(patch, 'adviseBelow')
      ? patch.adviseBelow
      : plan.settings.adviseBelow,
  }
  const notes: string[] = []
  if (isValidThresholds(triple)) {
    next.ignoreBelow = triple.ignoreBelow
    next.warnBelow = triple.warnBelow
    next.adviseBelow = triple.adviseBelow
  } else {
    next.ignoreBelow = DEFAULT_SETTINGS.ignoreBelow
    next.warnBelow = DEFAULT_SETTINGS.warnBelow
    next.adviseBelow = DEFAULT_SETTINGS.adviseBelow
    notes.push('thresholds-reset')
  }

  const settingsChanged = !sameSettings(plan.settings, next)
  const result: ApplyResult = {
    ok: true,
    plan: settingsChanged ? { ...plan, settings: next } : plan,
  }
  if (notes.length > 0) result.notes = notes
  return result
}

// ── 對外 API ────────────────────────────────────────────────────────

/**
 * 單一狀態轉移入口（`main.ts` 為唯一 orchestrator，PLAN §呼叫圖）。
 * 被拒時回原 plan 參考＋`Rejection`；成功時只換動到的那一層。
 */
export function apply(plan: RoomPlan, action: Action): ApplyResult {
  switch (action.type) {
    case 'item/add':
      return addItem(plan, action)
    case 'item/update':
      return updateItem(plan, action)
    case 'item/move':
      return moveItem(plan, action)
    case 'item/rotate':
      return rotateItem(plan, action)
    case 'item/delete':
      return deleteItem(plan, action.id)
    case 'item/restore':
      return restoreItem(plan, action.id)
    case 'item/purge':
      return purgeItems(plan)
    case 'room/set':
      return setRoom(plan, action)
    case 'block/add':
      return addBlock(plan, action)
    case 'block/update':
      return updateBlock(plan, action)
    case 'block/move':
      return moveBlock(plan, action)
    case 'block/remove':
      return removeBlock(plan, action.id)
    case 'door/add':
      return addDoor(plan, action)
    case 'door/update':
      return updateDoor(plan, action)
    case 'door/move':
      return moveDoor(plan, action)
    case 'door/remove':
      return removeDoor(plan, action.id)
    case 'settings/update':
      return updateSettings(plan, action)
    case 'plan/replace':
      // 四條載入路徑皆已先過 `parsePlan()`，此處只擋非物件（D7）。
      if (typeof action.plan !== 'object' || action.plan === null) {
        return reject(plan, 'invalid-input', 'plan')
      }
      return { ok: true, plan: action.plan }
    default:
      return reject(plan, 'invalid-input', 'type')
  }
}

// ── undo／redo 棧（不經 `apply()`，PLAN 刻意）────────────────────────

/** 棧深上限（PLAN：50；棧深 50 時第 51 次 undo 為 no-op）。 */
export const HISTORY_LIMIT = 50

export interface History {
  past: RoomPlan[]
  present: RoomPlan
  future: RoomPlan[]
}

export function createHistory(present: RoomPlan): History {
  return { past: [], present, future: [] }
}

/** 超過上限時自**最舊**端丟棄（最舊的那幾步不可再 undo）。 */
function pushCapped(past: RoomPlan[], entry: RoomPlan): RoomPlan[] {
  const next = [...past, entry]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}

/** 入棧：`present` 推進 `past`、換上 `next`、清空 redo。 */
export function commit(h: History, next: RoomPlan): History {
  return { past: pushCapped(h.past, h.present), present: next, future: [] }
}

/** `past` 為空時回**同一個** History 參考（第 51 次 undo 的 no-op 判準）。 */
export function undo(h: History): History {
  if (h.past.length === 0) return h
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  }
}

/** `future` 為空時回同一參考。 */
export function redo(h: History): History {
  if (h.future.length === 0) return h
  return {
    past: pushCapped(h.past, h.present),
    present: h.future[0],
    future: h.future.slice(1),
  }
}

// ── 拖移態（D10「拖移態統一」的純狀態部分）──────────────────────────

/**
 * 拖移態。`source` 的**唯一用途**是決定 commit 觸發（pointer →
 * `pointerup`；keyboard → 500 ms 靜默），計時器在 M2 的 `drag.ts`。
 * `origin` 為進入拖移態當下的 `present`，供 Esc 還原與 commit 入棧。
 */
export interface DragState {
  id: string
  kind: 'item' | 'block' | 'door'
  source: 'pointer' | 'keyboard'
  origin: RoomPlan
  cancelled: boolean
}

export function beginDrag(
  h: History,
  id: string,
  kind: DragState['kind'],
  source: DragState['source'],
): DragState {
  return { id, kind, source, origin: h.present, cancelled: false }
}

/**
 * 拖移期間只改 `present`（**不入棧、不清 redo**，D10「期間走輕量狀態
 * 路徑」）。已取消的拖移忽略後續移動；被拒的移動（含夾框後無位移）維持
 * 原 History 參考。
 */
export function dragTo(h: History, drag: DragState, x: number, y: number): History {
  if (drag.cancelled) return h
  const action: Action =
    drag.kind === 'item'
      ? { type: 'item/move', id: drag.id, x, y }
      : drag.kind === 'block'
        ? { type: 'block/move', id: drag.id, x, y }
        : { type: 'door/move', id: drag.id, x, y }
  const result = apply(h.present, action)
  if (!result.ok || result.plan === h.present) return h
  return { past: h.past, present: result.plan, future: h.future }
}

/** Esc／`pointercancel`／`lostpointercapture` 三者等效：回 origin 並標記已取消。 */
export function cancelDrag(h: History, drag: DragState): { history: History; drag: DragState } {
  return {
    history: h.present === drag.origin ? h : { past: h.past, present: drag.origin, future: h.future },
    drag: { ...drag, cancelled: true },
  }
}

/** commit＝把 origin 推進 `past`＋清 redo；已取消或原地未動則不入棧。 */
export function commitDrag(h: History, drag: DragState): History {
  if (drag.cancelled || h.present === drag.origin) return h
  return { past: pushCapped(h.past, drag.origin), present: h.present, future: [] }
}

/**
 * D10「靜默期間收到 undo／redo／任何非 move action／`pointerdown` → **先
 * 立即 commit 當前拖移態，再處理該 action**」的純函式形；`then` 即那個
 * 後續處理（`undo`、`redo`，或包成 `h => commit(h, apply(...).plan)`）。
 * 呼叫端 commit 後須一併清掉 `ui.dragging`。
 */
export function interruptDrag(
  h: History,
  drag: DragState,
  then: (history: History) => History,
): History {
  return then(commitDrag(h, drag))
}
