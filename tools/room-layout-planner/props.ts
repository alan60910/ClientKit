/**
 * T5.3 — 物件屬性欄（(internal design doc) Milestone 5 回饋
 * (3)「新增物件屬性欄，並獨立一區」與 (10)「清單列是整排無樣式表單、與屬性
 * 欄重複」；PLAN.md §D5 四向需留表、§D6「門的『牆』欄唯讀」、§D7「DOM 寫入
 * 不變量」、§D10「原地更新硬契約／`change` 才 dispatch」「非破壞性刪除」、
 * §Accessibility Forms）。
 *
 * 本檔只服務**目前選取的那一個**物件：`ui.selectedId` 在家具／方塊／門三個
 * 集合裡解析，命中即顯示對應的那一份表單、隱藏另外兩份，未命中（含未選取）
 * 顯示提示句。沿用 `panel.ts` 的四條硬契約：
 *
 * 1. **零 DOM 生成**——三份表單與每個欄位都由 `index.html` 靜態提供，本檔
 *    只查詢、接線與填值；連 `createElement` 都不呼叫，D7 自然成立。
 * 2. **原地更新**——`render()` 只寫值與 `hidden`／`disabled`，永不重建節點；
 *    取得焦點的欄位一律跳過回寫（使用者正在打字時不得覆寫）。
 * 3. **`change` 才 dispatch**——數值／文字欄只掛 `change`，`input` 零監聽。
 * 4. **驗證在先、拒收不送**——欄位級不過即 `aria-invalid`＋`aria-describedby`
 *    指向 `#props-error` 並**不** dispatch；送出後被 reducer 拒（牆體硬上限、
 *    門合法性）則把拒絕原因寫進同一個元素，輸入值維持使用者所打的樣子。
 *
 * 播報一律不由本檔發出：`main.ts` 的 `dispatch()` 已對每個成功動作播報，
 * 這裡再播一次會讓單一 live region 收到重複內容。
 */
import type { Messages } from './messages.js'
import {
  isValidColor,
  isValidName,
  LIMITS,
  type Action,
  type ClearanceReport,
  type Door,
  type Furniture,
  type RoomBlock,
  type RoomPlan,
  type Side,
} from './model.js'
import type { PanelHost } from './panel.js'
import type { ApplyResult, Rejection } from './reducer.js'
import type { UiState } from './ui-state.js'

/**
 * 依賴面與 `panel.ts` 逐欄相同（取值、送出、改選、移焦、播報），故直接沿用
 * 同一份介面——`main.ts` 因此可把同一個 host 物件交給兩者，不必維護兩份。
 */
export type PropsHost = PanelHost

export interface Props {
  /** 原地重繪：解析選取 → 切換三份表單 → 回寫欄位（聚焦中的欄位除外）。 */
  render(plan: RoomPlan, ui: UiState, report: ClearanceReport | null): void
  detach(): void
}

/** 寬深共用範圍（與 `model.isSize` 同界）。 */
const SIZE_MIN = 1
const SIZE_MAX = 5000

/** 座標欄位範圍（與 `panel.ts` 同界，見該檔註解）。 */
const COORD_MIN = -5000
const COORD_MAX = 10000

/** 各面需留：0＝無（送出時整面略去），其餘同寬深上界。 */
const NEED_MIN = 0

const SIDES: readonly Side[] = ['N', 'E', 'S', 'W']

type ItemPatch = Extract<Action, { type: 'item/update' }>['patch']
type BlockPatch = Extract<Action, { type: 'block/update' }>['patch']
type DoorPatch = Extract<Action, { type: 'door/update' }>['patch']

/** 目前選取物件在 plan 裡的解析結果（三集合各一形，未命中為 `null`）。 */
type Target =
  | { kind: 'item'; item: Furniture }
  | { kind: 'block'; block: RoomBlock }
  | { kind: 'door'; door: Door }
  | null

function query<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector)
  if (found === null) throw new Error(`props.ts：DOM 契約缺少元素 ${selector}`)
  return found
}

function isFocused(el: Element): boolean {
  return el.ownerDocument.activeElement === el
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

/** 回寫輸入框：取得焦點時一律跳過（uncontrolled 表單的必然推論）。 */
function setValue(input: HTMLInputElement, value: string): void {
  if (isFocused(input)) return
  if (input.value !== value) input.value = value
}

function setSelect(select: HTMLSelectElement, value: string): void {
  if (select.value !== value) select.value = value
}

/** 嚴格整數解析（同 `panel.ts`：空字串／小數／`1e3`／`abc` 皆回 `null`）。 */
function parseIntStrict(raw: string): number | null {
  const text = raw.trim()
  if (!/^-?\d+$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : null
}

export function attachProps(root: ParentNode, host: PropsHost): Props {
  const m: Messages = host.messages

  // ── 靜態骨架（缺件即擲錯：DOM 契約漂移要當場炸，不要靜默失能）────────
  const empty = query<HTMLElement>(root, '#props-empty')
  const error = query<HTMLElement>(root, '#props-error')

  const itemForm = query<HTMLFormElement>(root, '#props-item')
  const itemName = query<HTMLInputElement>(root, '#props-item-name')
  const itemWidth = query<HTMLInputElement>(root, '#props-item-width')
  const itemDepth = query<HTMLInputElement>(root, '#props-item-depth')
  const itemX = query<HTMLInputElement>(root, '#props-item-x')
  const itemY = query<HTMLInputElement>(root, '#props-item-y')
  const itemRotation = query<HTMLSelectElement>(root, '#props-item-rotation')
  const itemColor = query<HTMLInputElement>(root, '#props-item-color')
  const itemPassable = query<HTMLInputElement>(root, '#props-item-passable')
  const itemRotate = query<HTMLButtonElement>(root, '#props-item-rotate')
  const itemDelete = query<HTMLButtonElement>(root, '#props-item-delete')
  const itemRestore = query<HTMLButtonElement>(root, '#props-item-restore')
  const swatchBox = query<HTMLElement>(root, '#props-swatches')
  const swatches = Array.from(swatchBox.querySelectorAll<HTMLButtonElement>('button.swatch'))
  const needInputs: Readonly<Record<Side, HTMLInputElement>> = {
    N: query<HTMLInputElement>(root, '#props-item-need-n'),
    E: query<HTMLInputElement>(root, '#props-item-need-e'),
    S: query<HTMLInputElement>(root, '#props-item-need-s'),
    W: query<HTMLInputElement>(root, '#props-item-need-w'),
  }

  const blockForm = query<HTMLFormElement>(root, '#props-block')
  const blockKind = query<HTMLElement>(root, '#props-block-kind')
  const blockX = query<HTMLInputElement>(root, '#props-block-x')
  const blockY = query<HTMLInputElement>(root, '#props-block-y')
  const blockWidth = query<HTMLInputElement>(root, '#props-block-width')
  const blockDepth = query<HTMLInputElement>(root, '#props-block-depth')
  const blockDelete = query<HTMLButtonElement>(root, '#props-block-delete')

  const doorForm = query<HTMLFormElement>(root, '#props-door')
  const doorX = query<HTMLInputElement>(root, '#props-door-x')
  const doorY = query<HTMLInputElement>(root, '#props-door-y')
  const doorWidth = query<HTMLInputElement>(root, '#props-door-width')
  const doorLeafDir = query<HTMLSelectElement>(root, '#props-door-leafdir')
  const doorSwing = query<HTMLSelectElement>(root, '#props-door-swing')
  const doorWall = query<HTMLElement>(root, '#props-door-wall')
  const doorDelete = query<HTMLButtonElement>(root, '#props-door-delete')

  /** 會被標 `aria-invalid` 的控件全集（換選取時一次清乾淨）。 */
  const controls: readonly (HTMLInputElement | HTMLSelectElement)[] = [
    itemName,
    itemWidth,
    itemDepth,
    itemX,
    itemY,
    itemRotation,
    itemColor,
    itemPassable,
    needInputs.N,
    needInputs.E,
    needInputs.S,
    needInputs.W,
    blockX,
    blockY,
    blockWidth,
    blockDepth,
    doorX,
    doorY,
    doorWidth,
    doorLeafDir,
    doorSwing,
  ]

  const cleanups: Array<() => void> = []
  let detached = false
  /** 上一次 render 的選取 id——換物件時把錯誤標記清空。 */
  let lastId: string | null = null

  function on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    const wrapped = (event: Event): void => {
      if (detached) return
      handler(event as HTMLElementEventMap[K])
    }
    target.addEventListener(type, wrapped)
    cleanups.push(() => target.removeEventListener(type, wrapped))
  }

  // ── 錯誤呈現（單一 `#props-error` 服務三份表單）──────────────────────

  /**
   * `#props-error` 的當前「持有者」控件：一個錯誤 `<p>` 服務整份屬性欄，
   * 清除時只有持有者能把文字抹掉——否則 A 欄位改對了會順手清掉 B 欄位仍然
   * 成立的訊息（同 `panel.ts` 的 `errorOwner` 取徑，只是這裡恆為單一元素，
   * 用區域變數即可）。
   */
  let errorOwner: Element | null = null

  function markInvalid(control: Element, text: string): void {
    control.setAttribute('aria-invalid', 'true')
    control.setAttribute('aria-describedby', error.id)
    setText(error, text)
    errorOwner = control
  }

  function clearInvalid(control: Element): void {
    control.removeAttribute('aria-invalid')
    control.removeAttribute('aria-describedby')
    if (errorOwner === control) {
      setText(error, '')
      errorOwner = null
    }
  }

  function clearAllErrors(): void {
    for (const control of controls) {
      control.removeAttribute('aria-invalid')
      control.removeAttribute('aria-describedby')
    }
    setText(error, '')
    errorOwner = null
  }

  function rejectionText(rejection: Rejection): string {
    switch (rejection.reason) {
      case 'limit-items':
        return m.status.itemCapReached(host.getPlan().settings.maxItems, LIMITS.items)
      case 'limit-blocks':
        return m.status.limitReached('結構', LIMITS.blocks)
      case 'limit-doors':
        return m.status.limitReached('門', LIMITS.doors)
      case 'wall-cap':
        return m.status.wallCapExceeded(rejection.walls ?? LIMITS.walls, LIMITS.walls)
      case 'door-invalid':
        return m.ui.form.doorInvalid
      case 'not-found':
        return m.ui.form.notFound
      default:
        return m.ui.form.invalidInput
    }
  }

  /** 送出並在被拒時把原因寫進 `#props-error`（值保持使用者所打的樣子）。 */
  function dispatchOrShow(action: Action, control?: Element): ApplyResult {
    const result = host.dispatch(action)
    if (!result.ok) {
      setText(error, rejectionText(result.rejection))
      errorOwner = control ?? null
      if (control !== undefined) {
        control.setAttribute('aria-invalid', 'true')
        control.setAttribute('aria-describedby', error.id)
      }
    }
    return result
  }

  function readInt(input: HTMLInputElement, min: number, max: number): number | null {
    const value = parseIntStrict(input.value)
    if (value === null || value < min || value > max) {
      markInvalid(input, m.ui.form.integerRange(min, max))
      return null
    }
    clearInvalid(input)
    return value
  }

  // ── 選取解析 ───────────────────────────────────────────────────────

  function resolve(plan: RoomPlan, id: string | null): Target {
    if (id === null) return null
    const item = plan.items.find((candidate) => candidate.id === id)
    if (item !== undefined) return { kind: 'item', item }
    const block = plan.room.blocks.find((candidate) => candidate.id === id)
    if (block !== undefined) return { kind: 'block', block }
    const door = plan.room.doors.find((candidate) => candidate.id === id)
    if (door !== undefined) return { kind: 'door', door }
    return null
  }

  function current(): Target {
    return resolve(host.getPlan(), host.getUi().selectedId)
  }

  function itemId(): string | null {
    const target = current()
    return target !== null && target.kind === 'item' ? target.item.id : null
  }

  function blockId(): string | null {
    const target = current()
    return target !== null && target.kind === 'block' ? target.block.id : null
  }

  function doorId(): string | null {
    const target = current()
    return target !== null && target.kind === 'door' ? target.door.id : null
  }

  // ── 家具欄位 ───────────────────────────────────────────────────────

  on(itemForm, 'submit', (event) => event.preventDefault())
  on(blockForm, 'submit', (event) => event.preventDefault())
  on(doorForm, 'submit', (event) => event.preventDefault())

  on(itemName, 'change', () => {
    const id = itemId()
    if (id === null) return
    const value = itemName.value.trim()
    if (!isValidName(value)) {
      markInvalid(itemName, m.ui.form.nameRequired)
      return
    }
    clearInvalid(itemName)
    dispatchOrShow({ type: 'item/update', id, patch: { name: value } }, itemName)
  })

  function patchItemNumber(
    input: HTMLInputElement,
    toPatch: (value: number) => ItemPatch,
    min: number,
    max: number,
  ): void {
    on(input, 'change', () => {
      const id = itemId()
      if (id === null) return
      const value = readInt(input, min, max)
      if (value === null) return
      dispatchOrShow({ type: 'item/update', id, patch: toPatch(value) }, input)
    })
  }
  patchItemNumber(itemWidth, (value) => ({ width: value }), SIZE_MIN, SIZE_MAX)
  patchItemNumber(itemDepth, (value) => ({ depth: value }), SIZE_MIN, SIZE_MAX)
  patchItemNumber(itemX, (value) => ({ x: value }), COORD_MIN, COORD_MAX)
  patchItemNumber(itemY, (value) => ({ y: value }), COORD_MIN, COORD_MAX)

  on(itemRotation, 'change', () => {
    const id = itemId()
    if (id === null) return
    const value = parseIntStrict(itemRotation.value)
    if (value !== 0 && value !== 90 && value !== 180 && value !== 270) {
      markInvalid(itemRotation, m.ui.form.invalidInput)
      return
    }
    clearInvalid(itemRotation)
    dispatchOrShow({ type: 'item/update', id, patch: { rotation: value } }, itemRotation)
  })

  function applyColor(value: string, control: HTMLElement): void {
    const id = itemId()
    if (id === null) return
    if (!isValidColor(value)) {
      markInvalid(control, m.ui.form.invalidInput)
      return
    }
    clearInvalid(control)
    dispatchOrShow({ type: 'item/update', id, patch: { color: value } }, control)
  }

  on(itemColor, 'change', () => applyColor(itemColor.value, itemColor))

  // 快選色在屬性欄是**即時套用**（沒有送出鈕可按），與加入表單的
  // 「只填值、加入時才生效」刻意不同。
  for (const swatch of swatches) {
    on(swatch, 'click', () => {
      const color = swatch.dataset.color
      if (color === undefined) return
      itemColor.value = color
      applyColor(color, itemColor)
    })
  }

  on(itemPassable, 'change', () => {
    const id = itemId()
    if (id === null) return
    dispatchOrShow(
      { type: 'item/update', id, patch: { passable: itemPassable.checked } },
      itemPassable,
    )
  })

  /**
   * 各面需留（D5）：四欄一起讀成**整張表**送出——`item/update` 的
   * `clearances` 是整組覆蓋（reducer 不逐面合併），逐欄送會把其餘三面抹掉。
   * 空字串與 0 皆視為「該面無需留」，整張表為空即等於清掉（reducer 於
   * `Object.keys(cleaned).length === 0` 時 `delete next.clearances`）。
   */
  function onNeedChange(): void {
    const id = itemId()
    if (id === null) return
    const map: Partial<Record<Side, number>> = {}
    for (const side of SIDES) {
      const input = needInputs[side]
      const raw = input.value.trim()
      if (raw === '') {
        clearInvalid(input)
        continue
      }
      const value = parseIntStrict(raw)
      if (value === null || value < NEED_MIN || value > SIZE_MAX) {
        markInvalid(input, m.ui.form.integerRange(NEED_MIN, SIZE_MAX))
        return
      }
      clearInvalid(input)
      if (value > 0) map[side] = value
    }
    dispatchOrShow({ type: 'item/update', id, patch: { clearances: map } }, needInputs.N)
  }

  for (const side of SIDES) on(needInputs[side], 'change', onNeedChange)

  on(itemRotate, 'click', () => {
    const id = itemId()
    if (id === null) return
    dispatchOrShow({ type: 'item/rotate', id }, itemRotate)
  })

  /**
   * 非破壞性刪除（D10）：刪除後**維持選取**，把「刪除」換成「還原」並把
   * 焦點移過去——來源鈕在同一瞬間會被隱藏，焦點不接手就會掉到 `<body>`。
   * host 的重繪會做同一件事（`render()` 走 `syncItemDeleted()`），此處先手
   * 是為了 host 尚未重繪時也不掉焦。
   */
  function syncItemDeleted(deleted: boolean): void {
    for (const control of [
      itemName,
      itemWidth,
      itemDepth,
      itemX,
      itemY,
      itemColor,
      itemPassable,
      needInputs.N,
      needInputs.E,
      needInputs.S,
      needInputs.W,
    ]) {
      control.disabled = deleted
    }
    itemRotation.disabled = deleted
    itemRotate.disabled = deleted
    for (const swatch of swatches) swatch.disabled = deleted
    itemDelete.hidden = deleted
    itemRestore.hidden = !deleted
  }

  on(itemDelete, 'click', () => {
    const id = itemId()
    if (id === null) return
    const result = dispatchOrShow({ type: 'item/delete', id })
    if (!result.ok) return
    syncItemDeleted(true)
    itemRestore.focus()
  })

  on(itemRestore, 'click', () => {
    const id = itemId()
    if (id === null) return
    const result = dispatchOrShow({ type: 'item/restore', id })
    if (!result.ok) return
    syncItemDeleted(false)
    itemDelete.focus()
  })

  // ── 方塊欄位 ───────────────────────────────────────────────────────

  function patchBlockNumber(
    input: HTMLInputElement,
    toPatch: (value: number) => BlockPatch,
    min: number,
    max: number,
  ): void {
    on(input, 'change', () => {
      const id = blockId()
      if (id === null) return
      const value = readInt(input, min, max)
      if (value === null) return
      dispatchOrShow({ type: 'block/update', id, patch: toPatch(value) }, input)
    })
  }
  patchBlockNumber(blockX, (value) => ({ x: value }), COORD_MIN, COORD_MAX)
  patchBlockNumber(blockY, (value) => ({ y: value }), COORD_MIN, COORD_MAX)
  patchBlockNumber(blockWidth, (value) => ({ width: value }), SIZE_MIN, SIZE_MAX)
  patchBlockNumber(blockDepth, (value) => ({ depth: value }), SIZE_MIN, SIZE_MAX)

  on(blockDelete, 'click', () => {
    const id = blockId()
    if (id === null) return
    // 拒收（D9 牆體硬上限）時保留選取，讓使用者看得到自己剛動的是哪一塊。
    if (!dispatchOrShow({ type: 'block/remove', id }).ok) return
    host.setUi({ selectedId: null })
  })

  // ── 門欄位（D6：`wall` 唯讀，不給輸入控件）──────────────────────────

  function patchDoorNumber(
    input: HTMLInputElement,
    toPatch: (value: number) => DoorPatch,
    min: number,
    max: number,
  ): void {
    on(input, 'change', () => {
      const id = doorId()
      if (id === null) return
      const value = readInt(input, min, max)
      if (value === null) return
      dispatchOrShow({ type: 'door/update', id, patch: toPatch(value) }, input)
    })
  }
  patchDoorNumber(doorX, (value) => ({ x: value }), COORD_MIN, COORD_MAX)
  patchDoorNumber(doorY, (value) => ({ y: value }), COORD_MIN, COORD_MAX)
  patchDoorNumber(doorWidth, (value) => ({ width: value }), SIZE_MIN, SIZE_MAX)

  on(doorLeafDir, 'change', () => {
    const id = doorId()
    if (id === null) return
    const value = doorLeafDir.value === '-' ? '-' : '+'
    dispatchOrShow({ type: 'door/update', id, patch: { leafDir: value } }, doorLeafDir)
  })

  on(doorSwing, 'change', () => {
    const id = doorId()
    if (id === null) return
    const value = doorSwing.value === 'out' ? 'out' : 'in'
    dispatchOrShow({ type: 'door/update', id, patch: { swing: value } }, doorSwing)
  })

  on(doorDelete, 'click', () => {
    const id = doorId()
    if (id === null) return
    if (!dispatchOrShow({ type: 'door/remove', id }).ok) return
    host.setUi({ selectedId: null })
  })

  // ── render ─────────────────────────────────────────────────────────

  function fillItem(item: Furniture): void {
    setValue(itemName, item.name)
    setValue(itemWidth, String(item.width))
    setValue(itemDepth, String(item.depth))
    setValue(itemX, String(item.x))
    setValue(itemY, String(item.y))
    setSelect(itemRotation, String(item.rotation))
    setValue(itemColor, item.color)
    if (!isFocused(itemPassable)) itemPassable.checked = item.passable
    for (const side of SIDES) {
      const need = item.clearances?.[side]
      setValue(needInputs[side], need === undefined ? '' : String(need))
    }
    syncItemDeleted(item.deleted === true)
  }

  function fillBlock(block: RoomBlock): void {
    setText(blockKind, block.kind === 'extend' ? m.ui.form.kindExtend : m.ui.form.kindCutout)
    setValue(blockX, String(block.x))
    setValue(blockY, String(block.y))
    setValue(blockWidth, String(block.width))
    setValue(blockDepth, String(block.depth))
  }

  function fillDoor(door: Door): void {
    setValue(doorX, String(door.x))
    setValue(doorY, String(door.y))
    setValue(doorWidth, String(door.width))
    setSelect(doorLeafDir, door.leafDir)
    setSelect(doorSwing, door.swing)
    setText(doorWall, m.ui.door.wallName(door.wall))
  }

  function render(plan: RoomPlan, ui: UiState, _report: ClearanceReport | null): void {
    const target = resolve(plan, ui.selectedId)
    const id = target === null ? null : ui.selectedId
    // 換了物件＝上一個物件的欄位級錯誤不再成立。
    if (id !== lastId) {
      clearAllErrors()
      lastId = id
    }

    empty.hidden = target !== null
    itemForm.hidden = target === null || target.kind !== 'item'
    blockForm.hidden = target === null || target.kind !== 'block'
    doorForm.hidden = target === null || target.kind !== 'door'
    if (target === null) return

    if (target.kind === 'item') fillItem(target.item)
    else if (target.kind === 'block') fillBlock(target.block)
    else fillDoor(target.door)
  }

  function detach(): void {
    detached = true
    for (const off of cleanups) off()
    cleanups.length = 0
  }

  return { render, detach }
}
