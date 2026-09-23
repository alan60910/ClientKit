/**
 * T2.4 — 左欄面板（(internal design doc) §Frontend Component
 * tree「`#settings-section`／`#items-section`」、§D3「三閾值以三元組為單位
 * 驗證」、§D5 預設庫、§D6「panel 的『牆』欄唯讀」、§D7「DOM 寫入不變量」、
 * §D9「blocks 在清單以房間結構分組、不可設顏色；`structure-list` 最多 60 列
 * 不分頁」、§D10「原地更新硬契約」、§Accessibility「Forms：`label[for]`＋
 * 獨立 id；錯誤 `aria-describedby`＋`aria-invalid`」與「大量項目分頁＋換頁
 * 焦點管理與播報」、§Open questions OQ1「分頁門檻 20」）。
 *
 * 四條貫穿全檔的硬契約：
 * 1. **DOM 寫入只經 `createElement`／`textContent`／`setAttribute`**（D7）
 *    ——本檔不出現 HTML 字串注入 API，`panel.dom.test.ts` 有原始碼掃描案把關。
 * 2. **原地更新**（D10）——清單以 id 為 key 差集更新；同一頁內的列節點參考
 *    跨 render 不變（`syncRows()` 只新增／移除／`insertBefore` 搬位，不整批
 *    抽換子節點）。`drag.ts` 才能在 Delete 後靠 `restoreButton(id)` 拿到穩定
 *    的按鈕節點。
 * 3. **`change` 才 dispatch**（D10）——數值輸入一律只掛 `change`；本檔對
 *    `input` 事件零監聽，打字過程不會進 reducer、不會入 undo 棧。
 * 4. **驗證在先、拒收不送**——欄位級（整數／範圍／名稱／色碼／三元組違序）
 *    不過即標 `aria-invalid`＋`aria-describedby` 指向錯誤 `<p>` 並**不**
 *    dispatch；送出後被 reducer 拒（上限守衛、牆體硬上限、門合法性）則把拒絕
 *    原因寫進同一個錯誤元素，輸入值保持使用者所打的樣子。
 *
 * 靜態骨架（所有 `#id` 元素）由 `index.html`（lane A）提供，本檔只查詢、
 * 接線與填值；**動態產生的只有兩份清單的列**。動態列的 DOM id 一律
 * `item-row-{id}`／`structure-row-{id}` 前綴形——與 `serialize.ts` 的
 * `domId()`（`{kind}-{id}`，畫布節點用）分屬不同前綴，故同一件家具的畫布
 * 節點與清單列不會撞 id，亦符合 D7「裸 id 不進 DOM」。
 *
 * 加入表單依「種類」切換可用欄位：不適用的控件設 `disabled`（移出 Tab 序），
 * 若該控件有 `[data-field]` 祖先則一併 `hidden`——後者是給 `index.html` 的
 * **選配**接點（包不包 `[data-field]` 都不影響行為），故本檔不假設版面結構。
 *
 * **T5.3 清單簡化**（TASKS.md Milestone 5 回饋 (3)(10)）：兩份清單的列不再
 * 內嵌整排輸入欄——可編輯屬性移到 `props.ts` 的 `#props-section`，列上只留
 * 「選取（名稱／種類）＋摘要文字＋旋轉／刪除（或還原）」一行。`item-row-{id}`
 * ／`structure-row-{id}` 的列 id、`restore-{id}` 的 testid、`.row-select`／
 * `.row-delete` 類名與「列錯誤 `<p>`」皆刻意保留（`drag.ts` 的 Delete 後移焦、
 * D9 牆體硬上限的拒絕文案都掛在上面）。
 */
import type { Messages } from './messages.js'
import {
  effectiveSize,
  isSnapValue,
  isValidColor,
  isValidMaxItems,
  isValidName,
  isValidThresholds,
  LIMITS,
  MAX_ITEMS_WARN_ABOVE,
  type Action,
  type ClearanceReport,
  type Door,
  type Furniture,
  type RoomBlock,
  type RoomPlan,
} from './model.js'
import { findPreset, PRESETS } from './presets.js'
import type { ApplyResult, Rejection } from './reducer.js'
import type { UiState } from './ui-state.js'

/** OQ1 定案：`items-list` 分頁門檻預設 20 列。 */
export const ITEMS_PAGE_SIZE = 20

/** 寬深共用範圍（與 `model.isSize` 同界，D7）。 */
const SIZE_MIN = 1
const SIZE_MAX = 5000

/**
 * 座標欄位範圍：取 `reducer.ts` 對 blocks 的 `[−5000, 10000]`。家具 x／y 在
 * reducer 只要求整數（之後夾框），此處與方塊同界即可——比 reducer 寬鬆會讓
 * 面板放行後才被拒，比它嚴格會擋掉 reducer 本來會接受並夾框的值。
 */
const COORD_MIN = -5000
const COORD_MAX = 10000

/** 三閾值範圍（D7「數值 `Number.isInteger` ＋範圍」）。 */
const THRESHOLD_MIN = 0
const THRESHOLD_MAX = 5000

/** 加入表單的四種種類（`input[name="add-kind"]` 的 value 集合）。 */
type AddKind = 'item' | 'extend' | 'cutout' | 'door'

type ItemAddFields = NonNullable<Extract<Action, { type: 'item/add' }>['item']>
type BlockAddFields = Extract<Action, { type: 'block/add' }>['block']
type DoorAddFields = Extract<Action, { type: 'door/add' }>['door']

/** io-panel 的鈕位；本檔只查出來交給 `main.ts`（T2.5）接線，不自行監聽。 */
export interface PanelIoElements {
  undo: HTMLButtonElement
  redo: HTMLButtonElement
  exportJson: HTMLButtonElement
  importJson: HTMLButtonElement
  importFile: HTMLInputElement
  exportPng: HTMLButtonElement
  restoreBackup: HTMLButtonElement
  purge: HTMLButtonElement
  clear: HTMLButtonElement
  share: HTMLButtonElement
  saveShared: HTMLButtonElement
  /** 「複製分享連結」旁的常駐說明句（D7）。 */
  shareNote: HTMLElement
  notice: HTMLElement
}

export interface PanelElements {
  roomForm: HTMLFormElement
  structureList: HTMLOListElement
  addForm: HTMLFormElement
  itemsList: HTMLOListElement
  io: PanelIoElements
}

/**
 * 面板對外部的依賴。`dispatch` 由 `main.ts` 實作：套 reducer、入 undo 棧、
 * autosave、重繪（board＋panel）並播報拒絕原因，**回傳 `ApplyResult` 讓本檔
 * 能把欄位級錯誤標在對應控件上**。
 */
export interface PanelHost {
  getPlan(): RoomPlan
  getUi(): UiState
  messages: Messages
  dispatch(action: Action): ApplyResult
  /** 只收面板會動到的 UI 欄位；由 host 負責重繪。 */
  setUi(patch: Partial<Pick<UiState, 'selectedId' | 'page' | 'showDistance' | 'showWarnings'>>): void
  focusBoardNode(kind: 'item' | 'block' | 'door', id: string): void
  announce(text: string): void
}

export interface Panel {
  /**
   * 原地重繪：列以 id 為 key 差集更新、絕不整批抽換；表單欄位只在該控件
   * **未取得焦點**時回寫（避免蓋掉正在打的字）。`report` 供 M3 的
   * report-list 消費，T2.4 尚未使用。
   */
  render(plan: RoomPlan, ui: UiState, report: ClearanceReport | null): void
  /** 已刪除家具該列的「還原 {name}」鈕（`drag.ts` 於 Delete 後移焦用）。 */
  restoreButton(id: string): HTMLButtonElement | null
  readonly el: PanelElements
  detach(): void
}

// ── DOM 小工具（皆為 createElement／textContent／setAttribute 路徑）──────

function query<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector)
  if (found === null) throw new Error(`panel.ts：DOM 契約缺少元素 ${selector}`)
  return found
}

function isFocused(el: Element): boolean {
  return el.ownerDocument.activeElement === el
}

/** 只在文字真的不同時寫入，避免無謂的 DOM 變動與 live region 誤觸發。 */
function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

/**
 * 回寫輸入框：**取得焦點時一律跳過**（D10「表單 uncontrolled」的必然推論
 * ——使用者正在打字時 render 不得覆寫）。`<select>` 不走本函式：下拉不會
 * 被「打到一半」，且拒收後需要立刻回正。
 */
function setValue(input: HTMLInputElement, value: string): void {
  if (isFocused(input)) return
  if (input.value !== value) input.value = value
}

function setSelect(select: HTMLSelectElement, value: string): void {
  if (select.value !== value) select.value = value
}

function setPressed(button: HTMLButtonElement, on: boolean): void {
  button.setAttribute('aria-pressed', on ? 'true' : 'false')
}

/**
 * 錯誤元素的當前「持有者」控件。一個錯誤 `<p>` 可能服務多個控件（`#th-error`
 * 服務三個閾值、列錯誤服務整列），清除時只有持有者能把文字清掉，否則 A 欄位
 * 修正後會順手抹掉 B 欄位仍然有效的錯誤訊息。
 */
const errorOwner = new WeakMap<HTMLElement, Element>()

function markInvalid(control: Element, error: HTMLElement, text: string): void {
  control.setAttribute('aria-invalid', 'true')
  control.setAttribute('aria-describedby', error.id)
  setText(error, text)
  errorOwner.set(error, control)
}

function clearInvalid(control: Element, error: HTMLElement): void {
  control.removeAttribute('aria-invalid')
  control.removeAttribute('aria-describedby')
  if (errorOwner.get(error) === control) {
    setText(error, '')
    errorOwner.delete(error)
  }
}

/** dispatch 被拒時的顯示（值保持使用者所打的樣子，只加訊息與 `aria-invalid`）。 */
function showRejection(error: HTMLElement, text: string, control?: Element): void {
  setText(error, text)
  if (control !== undefined) {
    control.setAttribute('aria-invalid', 'true')
    control.setAttribute('aria-describedby', error.id)
    errorOwner.set(error, control)
  }
}

/** 嚴格整數解析：空字串、小數、`1e3`、`abc` 皆回 `null`（不靠 `parseInt` 的寬鬆前綴解析）。 */
function parseIntStrict(raw: string): number | null {
  const text = raw.trim()
  if (!/^-?\d+$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : null
}

function createErrorParagraph(doc: Document, id: string): HTMLParagraphElement {
  const p = doc.createElement('p')
  p.id = id
  p.className = 'field-error'
  p.setAttribute('aria-live', 'polite')
  return p
}

/**
 * 列上的鈕：一律套 T5.4 的 `.btn btn--small` 視覺形，`className` 只帶
 * 角色類（`row-*`／`btn--danger`），行為不變。
 */
function createButton(doc: Document, text: string, className: string): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = `btn btn--small ${className}`
  button.textContent = text
  return button
}

/** 列上的純文字欄（摘要／種類 badge）：只有 `data-testid`，不掛裸 id（D7）。 */
function createSpan(doc: Document, className: string, testId?: string): HTMLSpanElement {
  const span = doc.createElement('span')
  span.className = className
  if (testId !== undefined) span.setAttribute('data-testid', testId)
  return span
}

/**
 * 以 key 差集原地更新一份 `<ol>`（D10 原地更新硬契約）。既有列只搬位
 * （`insertBefore` 對已在文件中的節點是移動，節點參考不變），不在期望集合裡
 * 的列才移除，缺的才新建——同一頁內的列跨 render 恆為同一個節點。
 */
function syncRows<E, R extends { li: HTMLLIElement }>(
  list: HTMLOListElement,
  entries: readonly E[],
  keyOf: (entry: E) => string,
  rows: Map<string, R>,
  create: (entry: E) => R,
  update: (row: R, entry: E) => void,
): void {
  const wanted = new Set(entries.map(keyOf))
  for (const [key, row] of rows) {
    if (wanted.has(key)) continue
    row.li.remove()
    rows.delete(key)
  }
  let index = 0
  for (const entry of entries) {
    const key = keyOf(entry)
    let row = rows.get(key)
    if (row === undefined) {
      row = create(entry)
      rows.set(key, row)
    }
    update(row, entry)
    const atIndex = list.children[index]
    if (atIndex !== row.li) list.insertBefore(row.li, atIndex ?? null)
    index += 1
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}

// ── 列的資料形 ───────────────────────────────────────────────────────

interface ItemRow {
  li: HTMLLIElement
  select: HTMLButtonElement
  /** 「{w_eff}×{d_eff}，({x},{y})」摘要（可編輯欄位在 `#props-section`）。 */
  pos: HTMLSpanElement
  badge: HTMLSpanElement
  rotate: HTMLButtonElement
  remove: HTMLButtonElement
  restore: HTMLButtonElement
  error: HTMLParagraphElement
  deleted: boolean
}

interface StructureRow {
  li: HTMLLIElement
  kind: 'block' | 'door'
  /** 種類 badge（凸出區／凹入區／門）。 */
  badge: HTMLSpanElement
  /** 方塊「x,y {w}×{d}」／門「門 {width} cm，{wall}」（D6：牆只出現在文字裡）。 */
  summary: HTMLSpanElement
  select: HTMLButtonElement
  remove: HTMLButtonElement
  error: HTMLParagraphElement
}

type StructureEntry =
  | { kind: 'block'; key: string; block: RoomBlock }
  | { kind: 'door'; key: string; door: Door }

// ── 對外入口 ─────────────────────────────────────────────────────────

export function attachPanel(root: ParentNode, host: PanelHost): Panel {
  const m = host.messages

  // ── 靜態骨架查詢（缺件即擲錯：整合期的 DOM 契約漂移要當場炸，不要靜默失能）
  const roomForm = query<HTMLFormElement>(root, '#room-form')
  const roomWidth = query<HTMLInputElement>(root, '#room-width')
  const roomDepth = query<HTMLInputElement>(root, '#room-depth')
  const structureList = query<HTMLOListElement>(root, '#structure-list')

  const addForm = query<HTMLFormElement>(root, '#add-form')
  const addPreset = query<HTMLSelectElement>(root, '#add-preset')
  const addName = query<HTMLInputElement>(root, '#add-name')
  const addWidth = query<HTMLInputElement>(root, '#add-width')
  const addDepth = query<HTMLInputElement>(root, '#add-depth')
  const addX = query<HTMLInputElement>(root, '#add-x')
  const addY = query<HTMLInputElement>(root, '#add-y')
  const addColor = query<HTMLInputElement>(root, '#add-color')
  const swatchBox = query<HTMLElement>(root, '#color-swatches')
  const addDoorFields = query<HTMLFieldSetElement>(root, '#add-door-fields')
  const addDoorLeafDir = query<HTMLSelectElement>(root, '#add-door-leafdir')
  const addDoorSwing = query<HTMLSelectElement>(root, '#add-door-swing')
  const addError = query<HTMLElement>(root, '#add-error')
  const kindRadios = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="add-kind"]'))
  const swatches = Array.from(swatchBox.querySelectorAll<HTMLButtonElement>('button.swatch'))

  const swDistance = query<HTMLButtonElement>(root, '#sw-distance')
  const swWarnings = query<HTMLButtonElement>(root, '#sw-warnings')
  const swSwing = query<HTMLButtonElement>(root, '#sw-swing')
  const thIgnore = query<HTMLInputElement>(root, '#th-ignore')
  const thWarn = query<HTMLInputElement>(root, '#th-warn')
  const thAdvise = query<HTMLInputElement>(root, '#th-advise')
  const thError = query<HTMLElement>(root, '#th-error')
  const snapGrid = query<HTMLSelectElement>(root, '#snap-grid')
  const maxItems = query<HTMLInputElement>(root, '#max-items')
  const maxItemsWarning = query<HTMLElement>(root, '#max-items-warning')

  const itemsList = query<HTMLOListElement>(root, '#items-list')
  const itemsPager = query<HTMLElement>(root, '#items-pager')
  const itemsPrev = query<HTMLButtonElement>(root, '#items-prev')
  const itemsNext = query<HTMLButtonElement>(root, '#items-next')
  const itemsPageLabel = query<HTMLElement>(root, '#items-page-label')

  const io: PanelIoElements = {
    undo: query<HTMLButtonElement>(root, '#btn-undo'),
    redo: query<HTMLButtonElement>(root, '#btn-redo'),
    exportJson: query<HTMLButtonElement>(root, '#btn-export-json'),
    importJson: query<HTMLButtonElement>(root, '#btn-import-json'),
    importFile: query<HTMLInputElement>(root, '#import-file'),
    exportPng: query<HTMLButtonElement>(root, '#btn-export-png'),
    restoreBackup: query<HTMLButtonElement>(root, '#btn-restore-backup'),
    purge: query<HTMLButtonElement>(root, '#btn-purge'),
    clear: query<HTMLButtonElement>(root, '#btn-clear'),
    share: query<HTMLButtonElement>(root, '#btn-share'),
    saveShared: query<HTMLButtonElement>(root, '#btn-save-shared'),
    shareNote: query<HTMLElement>(root, '#share-note'),
    notice: query<HTMLElement>(root, '#io-notice'),
  }

  const doc = roomForm.ownerDocument

  // `#room-error` 不在 lane A 的 DOM 契約內（房間只有兩個欄位），由本檔補上
  // ——`aria-describedby` 必須指向**存在的**元素才有意義。
  const roomError =
    root.querySelector<HTMLElement>('#room-error') ?? createErrorParagraph(doc, 'room-error')
  if (roomError.parentNode === null) roomForm.append(roomError)

  // ── 內部狀態 ───────────────────────────────────────────────────────
  const cleanups: Array<() => void> = []
  const itemRows = new Map<string, ItemRow>()
  const structureRows = new Map<string, StructureRow>()
  let detached = false
  /** 使用者按下換頁鈕後「等待中」的頁碼；render 對上同一頁才移焦並播報。 */
  let pendingPageFocus: number | null = null

  /** 靜態骨架上的監聽：`detach()` 要能解乾淨，故登記 cleanup。 */
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

  /**
   * 動態列上的監聽：**刻意不登記 cleanup**——列節點被移除且自 `Map` 掉出
   * 後，節點與其監聽器一起可回收；登記反而會讓每次換頁產生的數百個閉包
   * 永久掛在 `cleanups` 上（連帶吊住已移除的 DOM 節點）。`detached` 旗標
   * 仍然生效，`detach()` 後殘留的列不會再 dispatch。
   */
  function onRow<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(type, (event: Event): void => {
      if (detached) return
      handler(event as HTMLElementEventMap[K])
    })
  }

  function rejectionText(rejection: Rejection): string {
    switch (rejection.reason) {
      case 'limit-items':
        // T4.7：軟上限的文案要帶出路；`plan` 在被拒時是原參考，故現值可讀。
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
      case 'invalid-input':
        // T4.7：面板自己先擋過一次，此分支只在競態（他處先加了家具）時走到。
        return rejection.detail === 'max-items-below-count'
          ? m.ui.form.maxItemsBelowCount(host.getPlan().items.length)
          : m.ui.form.invalidInput
      default:
        return m.ui.form.invalidInput
    }
  }

  /**
   * 讀一個整數欄位：不合法即標 `aria-invalid`＋寫錯誤文字並回 `null`
   * （呼叫端據此**不** dispatch）；合法即清掉該欄位的錯誤標記。
   */
  function readInt(
    input: HTMLInputElement,
    error: HTMLElement,
    min: number,
    max: number,
  ): number | null {
    const value = parseIntStrict(input.value)
    if (value === null || value < min || value > max) {
      markInvalid(input, error, m.ui.form.integerRange(min, max))
      return null
    }
    clearInvalid(input, error)
    return value
  }

  /** 加入表單用：空字串視為「未填」（`undefined`），其餘同 `readInt`。 */
  function readOptionalInt(
    input: HTMLInputElement,
    error: HTMLElement,
    min: number,
    max: number,
  ): { ok: true; value: number | undefined } | { ok: false } {
    if (input.value.trim() === '') {
      clearInvalid(input, error)
      return { ok: true, value: undefined }
    }
    const value = readInt(input, error, min, max)
    return value === null ? { ok: false } : { ok: true, value }
  }

  /** 送出並在被拒時把原因寫進指定的錯誤元素；回傳結果供呼叫端接續。 */
  function dispatchOrShow(
    action: Action,
    error: HTMLElement,
    control?: Element,
  ): ApplyResult {
    const result = host.dispatch(action)
    if (!result.ok) showRejection(error, rejectionText(result.rejection), control)
    return result
  }

  // ── 房間表單 ───────────────────────────────────────────────────────

  function onRoomChange(changed: HTMLInputElement): void {
    const width = readInt(roomWidth, roomError, SIZE_MIN, SIZE_MAX)
    const depth = readInt(roomDepth, roomError, SIZE_MIN, SIZE_MAX)
    if (width === null || depth === null) return
    dispatchOrShow({ type: 'room/set', width, depth }, roomError, changed)
  }

  on(roomWidth, 'change', () => onRoomChange(roomWidth))
  on(roomDepth, 'change', () => onRoomChange(roomDepth))
  // 房間表單沒有送出鈕：Enter 不得觸發原生送出（會捲掉整頁狀態）。
  on(roomForm, 'submit', (event) => event.preventDefault())

  // ── 加入表單 ───────────────────────────────────────────────────────

  /** D5 預設庫 → `<select>` 選項（value＝preset.key、text＝名稱）；只填一次。 */
  function populatePresets(): void {
    if (addPreset.dataset.presetsFilled === 'true') return
    if (addPreset.options.length === 0) {
      const custom = doc.createElement('option')
      custom.value = ''
      custom.textContent = m.ui.form.presetCustom
      addPreset.append(custom)
    }
    for (const preset of PRESETS) {
      const option = doc.createElement('option')
      option.value = preset.key
      option.textContent = preset.name
      addPreset.append(option)
    }
    addPreset.dataset.presetsFilled = 'true'
  }
  populatePresets()

  function currentKind(): AddKind {
    const checked = kindRadios.find((radio) => radio.checked)
    const value = checked === undefined ? 'item' : checked.value
    return value === 'extend' || value === 'cutout' || value === 'door' ? value : 'item'
  }

  /** 不適用的欄位設 `disabled`（移出 Tab 序）；有 `[data-field]` 祖先則一併隱藏。 */
  function setFieldEnabled(
    control: HTMLInputElement | HTMLSelectElement | HTMLFieldSetElement,
    enabled: boolean,
  ): void {
    control.disabled = !enabled
    const wrap = control.closest('[data-field]')
    if (wrap instanceof HTMLElement && wrap !== control) wrap.hidden = !enabled
  }

  function syncKindFields(): void {
    const kind = currentKind()
    const isItem = kind === 'item'
    const isDoor = kind === 'door'
    setFieldEnabled(addName, isItem)
    setFieldEnabled(addPreset, isItem)
    setFieldEnabled(addColor, isItem)
    setFieldEnabled(addDepth, !isDoor)
    for (const swatch of swatches) swatch.disabled = !isItem
    swatchBox.hidden = !isItem
    addDoorFields.disabled = !isDoor
    addDoorFields.hidden = !isDoor
  }

  for (const radio of kindRadios) on(radio, 'change', syncKindFields)
  syncKindFields()

  // 快選色只改 `#add-color` 的值，**不** dispatch（加入時才成為 action 的一部分）。
  for (const swatch of swatches) {
    on(swatch, 'click', () => {
      const color = swatch.dataset.color
      if (color !== undefined && isValidColor(color)) addColor.value = color
    })
  }

  // 預設庫選項 → 帶入名稱與寬深；欄位維持可編輯（D5「一鍵加入」但不鎖死）。
  on(addPreset, 'change', () => {
    const preset = findPreset(addPreset.value)
    if (preset === undefined) return
    addName.value = preset.name
    addWidth.value = String(preset.width)
    addDepth.value = String(preset.depth)
    clearInvalid(addName, addError)
    clearInvalid(addWidth, addError)
    clearInvalid(addDepth, addError)
  })

  function clearAddErrors(): void {
    for (const control of [addName, addWidth, addDepth, addX, addY]) {
      clearInvalid(control, addError)
    }
    setText(addError, '')
  }

  /** 送出後新出現的 id（diff 前後陣列）——用來選取剛加入的物件。 */
  function addedId(before: readonly { id: string }[], after: readonly { id: string }[]): string | null {
    const seen = new Set(before.map((entry) => entry.id))
    for (const entry of after) {
      if (!seen.has(entry.id)) return entry.id
    }
    return null
  }

  function resetAddFields(): void {
    addName.value = ''
    addWidth.value = ''
    addDepth.value = ''
    addX.value = ''
    addY.value = ''
  }

  function submitItem(): void {
    const presetKey = addPreset.value
    const preset = presetKey === '' ? undefined : findPreset(presetKey)

    const rawName = addName.value.trim()
    let name: string | undefined
    if (rawName !== '') {
      if (!isValidName(rawName)) {
        markInvalid(addName, addError, m.ui.form.nameRequired)
        return
      }
      name = rawName
    } else if (preset === undefined) {
      markInvalid(addName, addError, m.ui.form.nameRequired)
      return
    }

    const width = readOptionalInt(addWidth, addError, SIZE_MIN, SIZE_MAX)
    if (!width.ok) return
    const depth = readOptionalInt(addDepth, addError, SIZE_MIN, SIZE_MAX)
    if (!depth.ok) return
    if (preset === undefined && (width.value === undefined || depth.value === undefined)) {
      markInvalid(width.value === undefined ? addWidth : addDepth, addError, m.ui.form.sizeRequired)
      return
    }
    const x = readOptionalInt(addX, addError, COORD_MIN, COORD_MAX)
    if (!x.ok) return
    const y = readOptionalInt(addY, addError, COORD_MIN, COORD_MAX)
    if (!y.ok) return

    const fields: ItemAddFields = { x: x.value ?? 0, y: y.value ?? 0 }
    if (name !== undefined) fields.name = name
    if (width.value !== undefined) fields.width = width.value
    if (depth.value !== undefined) fields.depth = depth.value
    if (isValidColor(addColor.value)) fields.color = addColor.value

    const before = host.getPlan().items
    const action: Action =
      preset === undefined
        ? { type: 'item/add', item: fields }
        : { type: 'item/add', item: fields, preset: presetKey }
    const result = dispatchOrShow(action, addError, addName)
    if (!result.ok) return

    const newId = addedId(before, result.plan.items)
    const added = result.plan.items.find((item) => item.id === newId)
    resetAddFields()
    if (added !== undefined) {
      host.announce(m.status.itemAdded(added.name))
      host.setUi({ selectedId: added.id })
    }
  }

  function submitBlock(kind: 'extend' | 'cutout'): void {
    const width = readInt(addWidth, addError, SIZE_MIN, SIZE_MAX)
    const depth = readInt(addDepth, addError, SIZE_MIN, SIZE_MAX)
    const x = readOptionalInt(addX, addError, COORD_MIN, COORD_MAX)
    const y = readOptionalInt(addY, addError, COORD_MIN, COORD_MAX)
    if (width === null || depth === null || !x.ok || !y.ok) return

    const block: BlockAddFields = { kind, x: x.value ?? 0, y: y.value ?? 0, width, depth }
    const before = host.getPlan().room.blocks
    const result = dispatchOrShow({ type: 'block/add', block }, addError, addWidth)
    if (!result.ok) return

    const newId = addedId(before, result.plan.room.blocks)
    resetAddFields()
    host.announce(m.status.blockAdded(kind))
    if (newId !== null) host.setUi({ selectedId: newId })
  }

  function submitDoor(): void {
    const width = readInt(addWidth, addError, SIZE_MIN, SIZE_MAX)
    const x = readOptionalInt(addX, addError, COORD_MIN, COORD_MAX)
    const y = readOptionalInt(addY, addError, COORD_MIN, COORD_MAX)
    if (width === null || !x.ok || !y.ok) return
    const leafDir = addDoorLeafDir.value === '-' ? '-' : '+'
    const swing = addDoorSwing.value === 'out' ? 'out' : 'in'

    const door: DoorAddFields = { x: x.value ?? 0, y: y.value ?? 0, width, leafDir, swing }
    const before = host.getPlan().room.doors
    const result = dispatchOrShow({ type: 'door/add', door }, addError, addWidth)
    if (!result.ok) return

    const newId = addedId(before, result.plan.room.doors)
    resetAddFields()
    host.announce(m.status.doorAdded())
    if (newId !== null) host.setUi({ selectedId: newId })
  }

  on(addForm, 'submit', (event) => {
    event.preventDefault()
    clearAddErrors()
    const kind = currentKind()
    if (kind === 'door') submitDoor()
    else if (kind === 'extend' || kind === 'cutout') submitBlock(kind)
    else submitItem()
  })

  // ── 分析面板（三 switch＋三閾值三元組＋網格）────────────────────────

  on(swDistance, 'click', () => {
    const next = !host.getUi().showDistance
    setPressed(swDistance, next)
    host.setUi({ showDistance: next })
  })

  on(swWarnings, 'click', () => {
    const next = !host.getUi().showWarnings
    setPressed(swWarnings, next)
    host.setUi({ showWarnings: next })
  })

  // 迴旋區顯示屬 `plan.settings`（隨圖存檔），故走 dispatch 而非 ui。
  on(swSwing, 'click', () => {
    const next = !host.getPlan().settings.showSwing
    const result = dispatchOrShow({ type: 'settings/update', patch: { showSwing: next } }, thError)
    if (result.ok) setPressed(swSwing, next)
  })

  /**
   * D3：三閾值以**三元組**為單位驗證——任一欄變更都重讀三欄一起判，違序
   * （如 warn 80 > advise 75）整組**拒收**、不 dispatch，錯誤標在剛改的那欄。
   */
  function onThresholdChange(changed: HTMLInputElement): void {
    const triple = {
      ignoreBelow: parseIntStrict(thIgnore.value),
      warnBelow: parseIntStrict(thWarn.value),
      adviseBelow: parseIntStrict(thAdvise.value),
    }
    if (!isValidThresholds(triple)) {
      const inRange = [triple.ignoreBelow, triple.warnBelow, triple.adviseBelow].every(
        (value) => value !== null && value >= THRESHOLD_MIN && value <= THRESHOLD_MAX,
      )
      markInvalid(
        changed,
        thError,
        inRange ? m.ui.form.thresholdOrder : m.ui.form.integerRange(THRESHOLD_MIN, THRESHOLD_MAX),
      )
      return
    }
    for (const input of [thIgnore, thWarn, thAdvise]) clearInvalid(input, thError)
    dispatchOrShow({ type: 'settings/update', patch: triple }, thError, changed)
  }

  on(thIgnore, 'change', () => onThresholdChange(thIgnore))
  on(thWarn, 'change', () => onThresholdChange(thWarn))
  on(thAdvise, 'change', () => onThresholdChange(thAdvise))

  on(snapGrid, 'change', () => {
    const snap = parseIntStrict(snapGrid.value)
    if (!isSnapValue(snap)) {
      markInvalid(snapGrid, thError, m.ui.form.invalidInput)
      return
    }
    clearInvalid(snapGrid, thError)
    dispatchOrShow({ type: 'settings/update', patch: { snap } }, thError, snapGrid)
  })

  /**
   * T4.7 家具件數軟上限。`aria-describedby` 可能同時要指向兩個元素——欄位級
   * 錯誤（`#th-error`）與常駐效能提示（`#max-items-warning`）——故由本函式
   * **統一組**這個屬性，`markInvalid`／`clearInvalid` 寫完後再呼叫一次補上
   * 提示那一半，否則警告的關聯會在標錯誤時被覆寫掉。
   */
  function syncMaxItemsHints(cap: number): void {
    const warn = cap > MAX_ITEMS_WARN_ABOVE
    if (warn) setText(maxItemsWarning, m.ui.form.maxItemsWarning(MAX_ITEMS_WARN_ABOVE))
    maxItemsWarning.hidden = !warn

    const ids: string[] = []
    if (maxItems.getAttribute('aria-invalid') === 'true') ids.push(thError.id)
    if (warn) ids.push(maxItemsWarning.id)
    if (ids.length === 0) maxItems.removeAttribute('aria-describedby')
    else maxItems.setAttribute('aria-describedby', ids.join(' '))
  }

  on(maxItems, 'change', () => {
    const cap = parseIntStrict(maxItems.value)
    const current = host.getPlan()
    if (!isValidMaxItems(cap)) {
      markInvalid(maxItems, thError, m.ui.form.integerRange(1, LIMITS.items))
      syncMaxItemsHints(current.settings.maxItems)
      return
    }
    // 「不得低於現有件數」與 reducer 同口徑（含 `deleted`）；面板先擋是為了
    // 給出比 `invalid-input` 更具體的文案。
    if (cap < current.items.length) {
      markInvalid(maxItems, thError, m.ui.form.maxItemsBelowCount(current.items.length))
      syncMaxItemsHints(current.settings.maxItems)
      return
    }
    clearInvalid(maxItems, thError)
    dispatchOrShow({ type: 'settings/update', patch: { maxItems: cap } }, thError, maxItems)
    syncMaxItemsHints(host.getPlan().settings.maxItems)
  })

  // ── 房間結構清單（blocks＋doors，≤60 列不分頁）──────────────────────

  /**
   * T5.3 起方塊列與門列的骨架完全相同（badge＋摘要＋選取＋刪除），差別只在
   * `kind` 決定移焦的畫布節點種類與 `block/remove`／`door/remove`，故合成
   * 同一個建構子。
   */
  function createStructureRow(entry: StructureEntry): StructureRow {
    const kind = entry.kind
    const id = entry.kind === 'block' ? entry.block.id : entry.door.id
    const rowId = `structure-row-${id}`
    const li = doc.createElement('li')
    li.id = rowId
    li.className = 'structure-row'
    li.setAttribute('data-testid', rowId)

    // T5.5b：可見控件擠在一個 nowrap 列裡（`.row__main`），列錯誤 `<p>` 留在
    // 外層——`li` 本身不是 flex 容器，錯誤文字才能照常換到下一行，不受
    // 「動作鈕不換行」的 nowrap 影響。
    const main = doc.createElement('div')
    main.className = 'row__main'

    const badge = createSpan(doc, 'row-badge', `${rowId}-kind`)
    // `row__summary`（BEM 記法）與既有 `row-summary` 並存：後者是
    // CSS／既有測試的選擇器，前者是本批（T5.5b）給版面契約的語意類名。
    const summary = createSpan(doc, 'row-summary row__summary', `${rowId}-summary`)
    const select = createButton(doc, m.ui.props.selectAction, 'row-select')
    select.setAttribute('data-testid', `select-${id}`)
    const remove = createButton(doc, m.ui.button.delete, 'btn--danger row-delete')
    const actions = doc.createElement('span')
    actions.className = 'row__actions'
    actions.append(select, remove)
    main.append(badge, summary, actions)

    const error = createErrorParagraph(doc, `${rowId}-error`)
    li.append(main, error)

    const row: StructureRow = { li, kind, badge, summary, select, remove, error }

    onRow(select, 'click', () => {
      host.setUi({ selectedId: id })
      host.focusBoardNode(kind, id)
    })
    onRow(remove, 'click', () => {
      const action: Action =
        kind === 'block' ? { type: 'block/remove', id } : { type: 'door/remove', id }
      dispatchOrShow(action, row.error)
    })
    return row
  }

  function updateStructureRow(row: StructureRow, entry: StructureEntry, selectedId: string | null): void {
    if (entry.kind === 'block') {
      const block = entry.block
      const kindName = block.kind === 'extend' ? m.ui.form.kindExtend : m.ui.form.kindCutout
      setText(row.badge, kindName)
      setText(row.summary, m.ui.list.blockSummary(block.x, block.y, block.width, block.depth))
      row.select.setAttribute('aria-label', m.ui.list.select(kindName))
      row.li.classList.toggle('is-selected', block.id === selectedId)
      return
    }
    const door = entry.door
    const wallName = m.ui.door.wallName(door.wall)
    setText(row.badge, m.ui.form.door)
    // D6：「牆」恆由 x,y 推導、`apply()` 重寫 → 只出現在摘要文字裡，列上不給
    // 任何 wall 輸入控件（可編輯的門欄位在 `#props-section`）。
    setText(row.summary, m.ui.list.doorSummary(door.width, wallName))
    row.select.setAttribute('aria-label', m.ui.list.select(`${m.ui.form.door} ${wallName}`))
    row.li.classList.toggle('is-selected', door.id === selectedId)
  }

  // ── 家具清單（分頁、原地更新）──────────────────────────────────────

  function createItemRow(item: Furniture): ItemRow {
    const id = item.id
    const rowId = `item-row-${id}`
    const li = doc.createElement('li')
    li.id = rowId
    li.className = 'item-row'
    li.setAttribute('data-testid', rowId)

    // T5.5b：同 `createStructureRow`——可見控件在 nowrap 的 `.row__main`
    // 裡，列錯誤 `<p>` 留在外層自然換行。
    const main = doc.createElement('div')
    main.className = 'row__main'

    const select = createButton(doc, item.name, 'row-select')
    select.setAttribute('data-testid', `select-${id}`)

    const pos = createSpan(doc, 'row-pos', `${rowId}-pos`)

    const badge = createSpan(doc, 'row-badge')
    badge.textContent = m.ui.list.deleted
    badge.hidden = true

    const rotate = createButton(doc, m.ui.button.rotate, 'row-rotate')
    const remove = createButton(doc, m.ui.button.delete, 'btn--danger row-delete')
    // 非破壞性刪除（D10）：accessible name 含項目身分，兩件已刪除家具的
    // 「還原」鈕名稱因此互異。
    const restore = createButton(doc, m.ui.button.restore(item.name), 'row-restore')
    restore.setAttribute('data-testid', `restore-${id}`)
    restore.hidden = true

    const actions = doc.createElement('span')
    actions.className = 'row__actions'
    actions.append(rotate, remove, restore)
    main.append(select, badge, pos, actions)

    const error = createErrorParagraph(doc, `${rowId}-error`)
    li.append(main, error)

    const row: ItemRow = {
      li,
      select,
      pos,
      badge,
      rotate,
      remove,
      restore,
      error,
      deleted: item.deleted === true,
    }
    wireItemRow(row, id)
    return row
  }

  function wireItemRow(row: ItemRow, id: string): void {
    onRow(row.select, 'click', () => {
      host.setUi({ selectedId: id })
      host.focusBoardNode('item', id)
    })

    onRow(row.rotate, 'click', () => {
      dispatchOrShow({ type: 'item/rotate', id }, row.error, row.rotate)
    })

    // 刪除後來源控件失能 → 焦點必須落到同一列的「還原」鈕（D10 非破壞性
    // 刪除；SPEC「焦點不遷移」之特例）。host 的重繪會做同一件事，這裡先手
    // 是為了讓焦點在 host 尚未重繪時也不掉到 `<body>`。
    onRow(row.remove, 'click', () => {
      const result = dispatchOrShow({ type: 'item/delete', id }, row.error)
      if (!result.ok) return
      row.deleted = true
      row.restore.hidden = false
      row.restore.focus()
    })

    onRow(row.restore, 'click', () => {
      const result = dispatchOrShow({ type: 'item/restore', id }, row.error)
      if (!result.ok) return
      row.deleted = false
      row.restore.hidden = true
      row.select.disabled = false
      row.select.focus()
    })
  }

  function updateItemRow(row: ItemRow, item: Furniture, selectedId: string | null): void {
    const deleted = item.deleted === true
    row.deleted = deleted
    row.li.classList.toggle('is-deleted', deleted)
    row.li.classList.toggle('is-selected', item.id === selectedId)

    setText(row.select, item.name)
    row.select.setAttribute('aria-label', m.ui.list.select(item.name))
    setText(row.restore, m.ui.button.restore(item.name))
    row.restore.hidden = !deleted
    row.badge.hidden = !deleted

    // 摘要取**有效**外框（旋轉 90／270 時寬深互換），與畫布所見一致。
    const { w, d } = effectiveSize(item)
    setText(row.pos, m.ui.list.itemSummary(w, d, item.x, item.y))

    row.select.disabled = deleted
    row.rotate.disabled = deleted
    row.remove.disabled = deleted
  }

  // ── 分頁 ───────────────────────────────────────────────────────────

  function pageCount(itemCount: number): number {
    return Math.max(1, Math.ceil(itemCount / ITEMS_PAGE_SIZE))
  }

  function goToPage(next: number): void {
    const total = pageCount(host.getPlan().items.length)
    const page = clamp(next, 1, total)
    if (page === clamp(host.getUi().page, 1, total)) return
    pendingPageFocus = page
    host.setUi({ page })
  }

  on(itemsPrev, 'click', () => goToPage(Math.max(1, host.getUi().page) - 1))
  on(itemsNext, 'click', () => goToPage(Math.max(1, host.getUi().page) + 1))

  /** 換頁後把焦點帶進清單第一個可用控件（Accessibility「換頁焦點管理」）。 */
  function focusFirstControl(): void {
    const control = itemsList.querySelector<HTMLElement>(
      'button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled])',
    )
    if (control !== null) control.focus()
  }

  // ── render ─────────────────────────────────────────────────────────

  function render(plan: RoomPlan, ui: UiState, _report: ClearanceReport | null): void {
    // 房間
    setValue(roomWidth, String(plan.room.width))
    setValue(roomDepth, String(plan.room.depth))

    // 分析：距離／警示屬 UI 態，迴旋區屬 settings（隨圖存檔）。
    setPressed(swDistance, ui.showDistance)
    setPressed(swWarnings, ui.showWarnings)
    setPressed(swSwing, plan.settings.showSwing)
    setValue(thIgnore, String(plan.settings.ignoreBelow))
    setValue(thWarn, String(plan.settings.warnBelow))
    setValue(thAdvise, String(plan.settings.adviseBelow))
    setSelect(snapGrid, String(plan.settings.snap))
    setValue(maxItems, String(plan.settings.maxItems))
    syncMaxItemsHints(plan.settings.maxItems)

    // 房間結構：方塊在前、門在後（D9「以房間結構分組」），≤60 列不分頁。
    const entries: StructureEntry[] = [
      ...plan.room.blocks.map((block): StructureEntry => ({ kind: 'block', key: `block:${block.id}`, block })),
      ...plan.room.doors.map((door): StructureEntry => ({ kind: 'door', key: `door:${door.id}`, door })),
    ]
    syncRows(
      structureList,
      entries,
      (entry) => entry.key,
      structureRows,
      (entry) => createStructureRow(entry),
      (row, entry) => updateStructureRow(row, entry, ui.selectedId),
    )

    // 家具：OQ1 分頁；頁碼夾回有效範圍（刪到剩一頁時不會停在空白頁）。
    const total = pageCount(plan.items.length)
    const page = clamp(ui.page, 1, total)
    const start = (page - 1) * ITEMS_PAGE_SIZE
    const visible = plan.items.slice(start, start + ITEMS_PAGE_SIZE)
    syncRows(
      itemsList,
      visible,
      (item) => item.id,
      itemRows,
      (item) => createItemRow(item),
      (row, item) => updateItemRow(row, item, ui.selectedId),
    )

    setText(itemsPageLabel, m.ui.list.pageLabel(page, total))
    itemsPrev.disabled = page <= 1
    itemsNext.disabled = page >= total
    itemsPager.hidden = total <= 1

    if (pendingPageFocus !== null && pendingPageFocus === page) {
      pendingPageFocus = null
      focusFirstControl()
      host.announce(m.status.pageChanged(page, total))
    }
  }

  function restoreButton(id: string): HTMLButtonElement | null {
    const row = itemRows.get(id)
    if (row === undefined || !row.deleted) return null
    return row.restore
  }

  function detach(): void {
    detached = true
    for (const off of cleanups) off()
    cleanups.length = 0
  }

  return {
    render,
    restoreButton,
    el: {
      roomForm,
      structureList,
      addForm,
      itemsList,
      io,
    },
    detach,
  }
}
