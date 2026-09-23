/**
 * T1.2（(internal design doc) §狀態與資料形／§D5／§D6／§D9／
 * §D10 n 口徑）：核心型別（`RoomPlan`／`Furniture`／`Door`／`RoomBlock`／
 * `Side`／`ClearanceReport`／`Action`）、`defaultPlan()`、id 產生器、
 * `effectiveRect`／`effectiveSize`（四 rotation 表）、`worldSide`（12 組
 * 順時針映射）、`rotateAboutCenter`（定向取整、四次 R 回原座標）。
 *
 * 純函式、零 DOM import，node 可測。`Rect` 僅作型別使用（`import type`，
 * 編譯期抹除），geometry.ts 尚未存在亦可跑本檔測試。
 */
import type { Rect } from './geometry.js'

/** 家具區域座標／世界方向的四向枚舉。 */
export type Side = 'N' | 'E' | 'S' | 'W'

/** 螢幕座標順時針旋轉度數；唯一事實來源（PLAN §狀態與資料形）。 */
export type Rotation = 0 | 90 | 180 | 270

/** D9 非矩形房間的凸出／凹入方塊（座標為整數 cm）。 */
export interface RoomBlock {
  id: string
  kind: 'extend' | 'cutout'
  x: number
  y: number
  width: number
  depth: number
}

/** D6 門：`wall` 恆由 x,y 推導、apply() 重寫，不可獨立編輯。 */
export interface Door {
  id: string
  x: number
  y: number
  wall: Side
  leafDir: '+' | '-'
  width: number
  swing: 'in' | 'out'
}

/**
 * 家具。`width`／`depth` 為本身尺寸恆不變；`x`／`y` 為**有效外框**左上角
 * （旋轉後座標）；`rotation` 為唯一事實來源；`deleted` 為非破壞性刪除標記
 * （不渲染、不入 roving 序，仍計入 LIMITS.items 上限）。
 */
export interface Furniture {
  id: string
  name: string
  color: string
  width: number
  depth: number
  x: number
  y: number
  rotation: Rotation
  passable: boolean
  clearances?: Partial<Record<Side, number>>
  deleted?: true
}

/** 三閾值三元組＋網格吸附＋迴旋區顯示開關（D3／D6）＋家具件數軟上限（T4.7）。 */
export interface Settings {
  ignoreBelow: number
  warnBelow: number
  adviseBelow: number
  snap: 1 | 5 | 10
  showSwing: boolean
  /**
   * T4.7 家具件數**軟上限**（隨圖存檔、使用者可調）。預設 20＝e2e 案 6 實測
   * 仍守得住 16.7 ms 單幀預算的件數；上界為 `LIMITS.items` 這個**硬上限**，
   * 兩者職責不同：軟上限是使用者的效能取捨，硬上限是 `parsePlan` 先 slice
   * 與記憶體的最後防線，任何路徑都不得超過。
   */
  maxItems: number
}

/** 整份存檔資料形（D7 `parsePlan()` 白名單重建的目標型別）。 */
export interface RoomPlan {
  version: 1
  room: { width: number; depth: number; blocks: RoomBlock[]; doors: Door[] }
  items: Furniture[]
  settings: Settings
}

/** D10（r3.2，OQ4 定案）：家具／牆體／門／框邊數量上限。 */
export const LIMITS = { items: 75, blocks: 50, doors: 10, walls: 200 } as const

/** T4.7：`settings.maxItems` 預設值（e2e 案 6 於此件數守住 16.7 ms 單幀）。 */
export const MAX_ITEMS_DEFAULT = 20

/** T4.7：超過此件數即於面板顯示效能警告（與預設值同數，但語意不同）。 */
export const MAX_ITEMS_WARN_ABOVE = 20

/** D3 契約預設：`ignoreBelow` 5、`warnBelow` 60、`adviseBelow` 75；`maxItems` 20（T4.7）。 */
export const DEFAULT_SETTINGS: Settings = {
  ignoreBelow: 5,
  warnBelow: 60,
  adviseBelow: 75,
  snap: 5,
  showSwing: true,
  maxItems: MAX_ITEMS_DEFAULT,
}

/** D9 使用者玄關實例的基底矩形（300×400）。 */
export const DEFAULT_ROOM = { width: 300, depth: 400 } as const

/** D7：id 白名單（1–32 碼、大小寫英數字與 `_`／`-`）。 */
export const ID_RE = /^[A-Za-z0-9_-]{1,32}$/

/**
 * 16 字元小寫 hex id（`randomUUID().replace(/-/g,'').slice(0,16)`）——
 * 36 字元完整 UUID 含 `-` 會被 `ID_RE` 拒而每次重生，round-trip 必失，
 * 故截短（D7）。`globalThis.crypto` 在 Node 24 與瀏覽器皆存在。
 */
export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

// ── 共用欄位驗證 ─────────────────────────────────────────────────────
//
// D3 明文要求「`apply()` 與 `parsePlan()` 同規」，故所有欄位級謂詞集中在
// 本葉模組，由 `reducer.ts`（T1.8）與 `serialize.ts`（T1.9）共同取用——
// 兩邊各寫一份會讓「同規」退化成巧合。`serialize.ts` 再匯出
// `DEFAULT_COLOR`／`NAME_MAX_CODEPOINTS` 以維持既有呼叫點相容。

/** 家具預設色（`color` 缺漏時的填補值）。 */
export const DEFAULT_COLOR = '#9db4d6'

/** 名稱長度上限，以 **code point** 計（D7：`Array.from(name).length ≤ 30`）。 */
export const NAME_MAX_CODEPOINTS = 30

/** 寬深（房間、方塊、家具、門）共用範圍（D7）。 */
const SIZE_MIN = 1
const SIZE_MAX = 5000

/** 三閾值上限（D7「數值 `Number.isInteger` ＋範圍」）。 */
const THRESHOLD_MAX = 5000

const COLOR_RE = /^#[0-9a-f]{6}$/i

/** 孤立代理對（前導後面沒跟後尾、或後尾前面沒有前導）。 */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** 整數且落在閉區間內（`1e309`／`NaN`／`'12'` 皆不過）。 */
function isIntIn(value: unknown, lo: number, hi: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi
}

/**
 * 名稱禁用字元（D7 名稱字元集）：C0 控制字元（U+0000–U+001F）、DEL
 * （U+007F）、U+FFFE 與 U+FFFF。**刻意以 code unit 數值逐一比對而非正規
 * 表示式字面值**——字面控制字元會讓本檔含 NUL byte（git 判為 binary、diff
 * 不可讀、部分編輯器會吃掉），而逸出寫法又易在工具鏈間被還原成字面值；
 * 改用十六進位數值比較後，本函式全為 ASCII 原始碼，無此類風險。
 */
function hasForbiddenNameChar(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f || code === 0xfffe || code === 0xffff) return true
  }
  return false
}

/**
 * 合法名稱（D7）：字串、1–30 個 **code point**、不含 C0／DEL／U+FFFE／
 * U+FFFF 與孤立代理對。先以 UTF-16 長度粗篩（每個 code point 至多 2 個
 * code unit），避免對超長敵意字串做 `Array.from` 展開。
 */
export function isValidName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > NAME_MAX_CODEPOINTS * 2) return false
  if (Array.from(name).length > NAME_MAX_CODEPOINTS) return false
  return !hasForbiddenNameChar(name) && !LONE_SURROGATE_RE.test(name)
}

/** 合法 `#rrggbb`（大小寫不拘；小寫化交給 `normalizeColor()`）。 */
export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_RE.test(value)
}

/** 色碼正規形＝全小寫（D7：`color` 過 regex 後小寫化）。 */
export function normalizeColor(value: string): string {
  return value.toLowerCase()
}

/**
 * 三閾值**三元組**驗證（D3）：三者皆為 0–5000 整數**且**
 * `ignoreBelow ≤ warnBelow ≤ adviseBelow`。任一不過（含數值全合法但純違序
 * 的 `[80,60,75]`）即為假，呼叫端據此**整組**退預設。型別謂詞形式，narrow
 * 後三欄皆為 `number`。
 */
export function isValidThresholds(t: {
  ignoreBelow: unknown
  warnBelow: unknown
  adviseBelow: unknown
}): t is { ignoreBelow: number; warnBelow: number; adviseBelow: number } {
  const { ignoreBelow, warnBelow, adviseBelow } = t
  return (
    isIntIn(ignoreBelow, 0, THRESHOLD_MAX) &&
    isIntIn(warnBelow, 0, THRESHOLD_MAX) &&
    isIntIn(adviseBelow, 0, THRESHOLD_MAX) &&
    ignoreBelow <= warnBelow &&
    warnBelow <= adviseBelow
  )
}

/**
 * T4.7 家具件數軟上限：整數 1–`LIMITS.items`（＝75 硬上限，不得再高）。
 * 與三閾值同理由集中於本檔——`reducer.ts` 的 `settings/update` 與
 * `serialize.ts` 的 `parsePlan` 須同規（D3「`apply()` 與 `parsePlan()`
 * 同規」）。「不得低於現有件數」是**呼叫端**的額外條件（需要 plan 才判得
 * 出來），不在本謂詞內。
 */
export function isValidMaxItems(value: unknown): value is number {
  return isIntIn(value, 1, LIMITS.items)
}

/** 網格吸附列舉（設定 `snap`；`snap.ts` 的 `GridSize` 同集合）。 */
export function isSnapValue(value: unknown): value is 1 | 5 | 10 {
  return value === 1 || value === 5 || value === 10
}

/** 旋轉列舉（螢幕座標順時針 0／90／180／270）。 */
export function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270
}

/** 寬深：整數 1–5000（房間、方塊、家具、門共用，D7）。 */
export function isSize(value: unknown): value is number {
  return isIntIn(value, SIZE_MIN, SIZE_MAX)
}

/** 全新預設平面圖：version 1、300×400 基底房、空陣列、預設設定。每次呼叫回傳新物件（不共享陣列／設定參考）。 */
export function defaultPlan(): RoomPlan {
  return {
    version: 1,
    room: { width: DEFAULT_ROOM.width, depth: DEFAULT_ROOM.depth, blocks: [], doors: [] },
    items: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

/**
 * 旋轉前家具本身尺寸 → 有效尺寸：90／270 度寬深互換，0／180 度不變
 * （狀態與資料形：「90/270 時有效外框寬深交換」）。
 */
export function effectiveSize(item: Pick<Furniture, 'width' | 'depth' | 'rotation'>): {
  w: number
  d: number
} {
  const swapped = item.rotation === 90 || item.rotation === 270
  return swapped ? { w: item.depth, d: item.width } : { w: item.width, d: item.depth }
}

/**
 * 有效外框（世界座標整數矩形）：`x`／`y` 即左上角，寬深取
 * `effectiveSize()`。
 */
export function effectiveRect(
  item: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>,
): Rect {
  const { w, d } = effectiveSize(item)
  return { x0: item.x, y0: item.y, x1: item.x + w, y1: item.y + d }
}

/** 順時針方向序（N→E→S→W→N），worldSide 以此環走 `rotation/90` 步。 */
const SIDE_ORDER: readonly Side[] = ['N', 'E', 'S', 'W']

/**
 * 區域座標 `local` 經 `rotation`（順時針度數）映射為世界方向（D5／狀態與
 * 資料形）：90 → N→E、E→S、S→W、W→N；180 → N↔S、E↔W；
 * 270 → N→W、W→S、S→E、E→N；0 → 恆等。
 */
export function worldSide(rotation: Rotation, local: Side): Side {
  const steps = rotation / 90
  const idx = SIDE_ORDER.indexOf(local)
  return SIDE_ORDER[(idx + steps) % 4]!
}

/**
 * 以有效外框中心為軸的 90° 步進旋轉（`item/rotate`；R 鍵）。
 * `w_eff`／`d_eff` 取**旋轉前**有效尺寸；取整方向依**目標** rotation
 * 固定（→90/270 用 `floor`、→0/180 用 `ceil`），使連按四次 R 回原座標。
 * 不做夾框（夾框優先於中心不變，屬 reducer／T1.8 職責，見 PLAN §狀態與
 * 資料形）。
 */
export function rotateAboutCenter(
  item: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>,
): { x: number; y: number; rotation: Rotation } {
  const nextRotation = (((item.rotation + 90) % 360) as Rotation)
  const { w: wEff, d: dEff } = effectiveSize(item)
  const rawX = item.x + (wEff - dEff) / 2
  const rawY = item.y + (dEff - wEff) / 2
  const round = nextRotation === 90 || nextRotation === 270 ? Math.floor : Math.ceil
  return { x: round(rawX), y: round(rawY), rotation: nextRotation }
}

// ── clearance.ts（T1.7）消費的 report 形狀；集中定義於此供各模組共用 ──

/** 通道評級（D3 四段半開區間；`doorway`／`suppressed` 為 `null`）。 */
export type Level = 'touch' | 'narrow' | 'tight' | 'ok'

/** 間距軸（D4：恰一軸正重疊時的另一軸）。 */
export type Axis = 'x' | 'y'

/**
 * 通道筆（D4）。`a`／`b` 為家具 id 或牆參照（`wall:<index>`／
 * `frame:N|E|S|W`）；`segIndex` 沿重疊軸自 0，不保證跨幀穩定。
 */
export interface Corridor {
  a: string
  b: string
  axis: Axis
  gap: number
  rect: Rect
  level: Level | null
  kind: 'corridor' | 'doorway' | 'suppressed'
  segIndex: number
}

/** 碰撞（含「卡在牆裡」；永不因 `passable` 抑制）。 */
export interface Collision {
  a: string
  b: string
  rect: Rect
}

/** 家具某面需留距離未達標（D5）。 */
export interface SideViolation {
  id: string
  side: Side
  worldSide: Side
  need: number
  actual: number
  against: string
}

/** 家具與門迴旋區正面積相交（D6）。 */
export interface DoorViolation {
  doorId: string
  itemId: string
}

/** `clearance(plan)` 輸出（狀態與資料形）。 */
export interface ClearanceReport {
  corridors: Corridor[]
  collisions: Collision[]
  sideViolations: SideViolation[]
  doorViolations: DoorViolation[]
  unattachedDoors: string[]
  unconnectedBlocks: string[]
}

/** reducer.ts（T1.8）`apply(plan, action)` 的動作聯集（狀態與資料形）。 */
export type Action =
  | { type: 'room/set'; width: number; depth: number }
  | { type: 'block/add'; block: Omit<RoomBlock, 'id'> & { id?: string } }
  | { type: 'block/update'; id: string; patch: Partial<Omit<RoomBlock, 'id'>> }
  | { type: 'block/remove'; id: string }
  | { type: 'block/move'; id: string; x: number; y: number }
  | { type: 'door/add'; door: Omit<Door, 'id' | 'wall'> & { id?: string } }
  | { type: 'door/update'; id: string; patch: Partial<Omit<Door, 'id' | 'wall'>> }
  | { type: 'door/remove'; id: string }
  | { type: 'door/move'; id: string; x: number; y: number }
  /**
   * `preset` 命中預設庫時補 `name`／寬深／`passable`／`clearances`，`item`
   * 的明示欄位優先；故全欄皆為選填。欄位級驗證在 `reducer.ts`（T1.8）——
   * panel 送進來的是未經驗證的表單值，型別擋不住，非法者回
   * `'invalid-input'`。
   */
  | {
      type: 'item/add'
      item?: Partial<
        Pick<
          Furniture,
          | 'id'
          | 'name'
          | 'color'
          | 'width'
          | 'depth'
          | 'x'
          | 'y'
          | 'rotation'
          | 'passable'
          | 'clearances'
        >
      >
      preset?: string
    }
  | { type: 'item/update'; id: string; patch: Partial<Omit<Furniture, 'id' | 'deleted'>> }
  | { type: 'item/move'; id: string; x: number; y: number }
  | { type: 'item/rotate'; id: string }
  | { type: 'item/delete'; id: string }
  | { type: 'item/restore'; id: string }
  | { type: 'item/purge' }
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'plan/replace'; plan: RoomPlan }
