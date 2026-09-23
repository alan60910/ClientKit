// @vitest-environment jsdom
/**
 * T2.4 — `panel.ts` 的 jsdom 回歸網（(internal design doc)
 * §Verification「jsdom（`*.dom.test.ts`）：清單 `change` 才 dispatch 且列
 * 節點參考不變；『還原 {name}』兩鈕名稱相異；閾值變更→重算；非法輸入→
 * `aria-invalid`」、§D3 三元組驗證、§D6「panel 的『牆』欄唯讀」、§D7「DOM
 * 寫入不變量」、§D10 原地更新硬契約、§Accessibility Forms／分頁、OQ1）。
 *
 * 骨架來源：**不讀 `index.html`**（lane A 仍在改），改由本檔的
 * `buildFixture()` 依 T2.4 的 DOM 契約以 `createElement` 現場搭一份最小骨架
 * ——測的是 `panel.ts` 對契約的接線，不是 lane A 的版面。
 *
 * host 是假的、reducer 是真的：`dispatch` 記錄 action 後交給真正的
 * `apply()`，因此上限守衛、門合法性、夾框等拒收路徑都是真實行為，不是
 * mock 出來的巧合。`setUi` **刻意不重繪**——換頁焦點與播報的時序因此看得見
 * （由測試自行呼叫 `render()` 扮演 host 的重繪）。
 *
 * **T5.3 後的分工**：列上的可編輯欄位已移到 `props.ts`（`#props-section`），
 * 故「欄位級驗證／`change` 才 dispatch／打字中不被覆寫」等案改由
 * `props.dom.test.ts` 把關；本檔只留清單自己的契約——列節點原地更新、摘要
 * 文字、選取、非破壞性刪除的「還原 {name}」、分頁與加入表單。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { t } from './messages.js'
import {
  defaultPlan,
  MAX_ITEMS_DEFAULT,
  MAX_ITEMS_WARN_ABOVE,
  type Action,
  type Furniture,
  type RoomPlan,
} from './model.js'
import { PRESETS } from './presets.js'
import { apply } from './reducer.js'
import { attachPanel, ITEMS_PAGE_SIZE, type Panel, type PanelHost } from './panel.js'
import { DEFAULT_UI, type UiState } from './ui-state.js'

const messages = t()

// ── 骨架 ─────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  id?: string,
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (id !== undefined) node.id = id
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  return node
}

function numberInput(id: string): HTMLInputElement {
  const input = el('input', id)
  input.type = 'number'
  return input
}

function selectWith(id: string, values: readonly string[]): HTMLSelectElement {
  const select = el('select', id)
  for (const value of values) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    select.append(option)
  }
  return select
}

function pressableButton(id: string): HTMLButtonElement {
  const button = el('button', id, { 'aria-pressed': 'false' })
  button.type = 'button'
  return button
}

/** 依 T2.4 的 DOM 契約搭出 lane A 應提供的靜態骨架（純 createElement）。 */
function buildFixture(): HTMLElement {
  const root = el('div', 'panel-root')

  const roomForm = el('form', 'room-form')
  roomForm.append(numberInput('room-width'), numberInput('room-depth'))

  const structureList = el('ol', 'structure-list')

  const addForm = el('form', 'add-form')
  for (const kind of ['item', 'extend', 'cutout', 'door'] as const) {
    const radio = el('input', `add-kind-${kind}`)
    radio.type = 'radio'
    radio.name = 'add-kind'
    radio.value = kind
    radio.checked = kind === 'item'
    addForm.append(radio)
  }
  const preset = el('select', 'add-preset')
  const custom = document.createElement('option')
  custom.value = ''
  custom.textContent = '自訂'
  preset.append(custom)
  const addName = el('input', 'add-name')
  addName.type = 'text'
  const addColor = el('input', 'add-color')
  addColor.type = 'color'
  const swatchBox = el('div', 'color-swatches')
  for (const color of [
    '#9db4d6',
    '#d69d9d',
    '#9dd6a8',
    '#d6cf9d',
    '#b49dd6',
    '#9dd0d6',
    '#d6a89d',
    '#aab3bd',
  ]) {
    const swatch = el('button', undefined, { 'data-color': color })
    swatch.type = 'button'
    swatch.className = 'swatch'
    swatchBox.append(swatch)
  }
  const doorFields = el('fieldset', 'add-door-fields')
  doorFields.append(selectWith('add-door-leafdir', ['+', '-']), selectWith('add-door-swing', ['in', 'out']))
  const btnAdd = el('button', 'btn-add')
  btnAdd.type = 'submit'
  addForm.append(
    preset,
    addName,
    numberInput('add-width'),
    numberInput('add-depth'),
    numberInput('add-x'),
    numberInput('add-y'),
    addColor,
    swatchBox,
    doorFields,
    btnAdd,
    el('p', 'add-error', { 'aria-live': 'polite' }),
  )

  const analysis = el('div', 'analysis-panel')
  analysis.append(
    pressableButton('sw-distance'),
    pressableButton('sw-warnings'),
    pressableButton('sw-swing'),
    numberInput('th-ignore'),
    numberInput('th-warn'),
    numberInput('th-advise'),
    el('p', 'th-error', { 'aria-live': 'polite' }),
    selectWith('snap-grid', ['1', '5', '10']),
    numberInput('max-items'),
    el('p', 'max-items-warning', { 'aria-live': 'polite', hidden: '' }),
  )

  const io = el('div', 'io-panel')
  for (const id of [
    'btn-undo',
    'btn-redo',
    'btn-export-json',
    'btn-import-json',
    'btn-export-png',
    'btn-restore-backup',
    'btn-purge',
    'btn-clear',
    'btn-share',
    'btn-save-shared',
  ]) {
    const button = el('button', id)
    button.type = 'button'
    io.append(button)
  }
  const importFile = el('input', 'import-file')
  importFile.type = 'file'
  io.append(importFile, el('p', 'share-note'), el('p', 'io-notice'))

  const itemsList = el('ol', 'items-list')
  const pager = el('div', 'items-pager')
  const prev = el('button', 'items-prev')
  prev.type = 'button'
  const next = el('button', 'items-next')
  next.type = 'button'
  pager.append(prev, el('span', 'items-page-label'), next)

  root.append(roomForm, structureList, addForm, analysis, io, itemsList, pager)
  return root
}

// ── 假 host（真 reducer）──────────────────────────────────────────────

/** UI 態以 lane B 的 `DEFAULT_UI` 為基底，只覆寫測項關心的欄位。 */
type Ui = UiState

function makeUi(patch: Partial<Ui> = {}): Ui {
  return { ...DEFAULT_UI, ...patch }
}

interface Harness {
  host: PanelHost
  actions: Action[]
  setUiCalls: Partial<Ui>[]
  announcements: string[]
  focused: string[]
  getPlan(): RoomPlan
  getUi(): Ui
  setPlan(plan: RoomPlan): void
  patchUi(patch: Partial<Ui>): void
}

function makeHarness(initial: RoomPlan): Harness {
  let plan = initial
  let ui = makeUi()
  const actions: Action[] = []
  const setUiCalls: Partial<Ui>[] = []
  const announcements: string[] = []
  const focused: string[] = []

  const host: PanelHost = {
    getPlan: () => plan,
    getUi: () => ui,
    messages,
    dispatch(action) {
      actions.push(action)
      const result = apply(plan, action)
      if (result.ok) plan = result.plan
      return result
    },
    setUi(patch) {
      setUiCalls.push(patch as Partial<Ui>)
      ui = { ...ui, ...patch }
    },
    focusBoardNode(kind, id) {
      focused.push(`${kind}:${id}`)
    },
    announce(text) {
      announcements.push(text)
    },
  }

  return {
    host,
    actions,
    setUiCalls,
    announcements,
    focused,
    getPlan: () => plan,
    getUi: () => ui,
    setPlan: (next) => {
      plan = next
    },
    patchUi: (patch) => {
      ui = { ...ui, ...patch }
    },
  }
}

/** 產出 n 件家具的 plan（分頁案用；座標留在 300×400 房間內）。 */
function planWithItems(count: number): RoomPlan {
  const items: Furniture[] = []
  for (let i = 0; i < count; i++) {
    items.push({
      id: `f${String(i).padStart(2, '0')}`,
      name: `家具${i}`,
      color: '#9db4d6',
      width: 40,
      depth: 40,
      x: 0,
      y: 0,
      rotation: 0,
      passable: true,
    })
  }
  return { ...defaultPlan(), items }
}

function fire(target: EventTarget, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
}

function setAndChange(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  input.value = value
  fire(input, 'change')
}

function q<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector)
  if (found === null) throw new Error(`fixture 缺少 ${selector}`)
  return found
}

let root: HTMLElement
let harness: Harness
let panel: Panel

function mount(plan: RoomPlan, ui: Partial<Ui> = {}): void {
  document.body.textContent = ''
  root = buildFixture()
  document.body.append(root)
  harness = makeHarness(plan)
  harness.patchUi(ui)
  panel = attachPanel(root, harness.host)
  panel.render(harness.getPlan(), harness.getUi(), null)
}

function rerender(): void {
  panel.render(harness.getPlan(), harness.getUi(), null)
}

beforeEach(() => {
  document.body.textContent = ''
})

// ── 1. change-only dispatch（D10 硬契約）──────────────────────────────

describe('change 才 dispatch（D10）', () => {
  beforeEach(() => {
    mount(planWithItems(1))
  })

  it('清單列不再內嵌任何輸入控件（可編輯屬性移至 #props-section，T5.3）', () => {
    const row = q<HTMLLIElement>(root, '#item-row-f00')
    expect(row.querySelectorAll('input, select, textarea')).toHaveLength(0)
  })

  it('房間寬深同樣只在 change 時送出 room/set（兩欄一起讀）', () => {
    const width = q<HTMLInputElement>(root, '#room-width')
    width.value = '350'
    fire(width, 'input')
    expect(harness.actions).toHaveLength(0)

    fire(width, 'change')
    expect(harness.actions).toEqual([{ type: 'room/set', width: 350, depth: 400 }])
  })
})

// ── 2. 原地更新：列節點參考穩定 ───────────────────────────────────────

describe('原地更新：列節點參考不變（D10）', () => {
  it('改別件家具後重繪，同一頁的列仍是同一個節點且摘要文字原地更新', () => {
    mount(planWithItems(3))
    const rowA = q<HTMLLIElement>(root, '#item-row-f00')
    const rowB = q<HTMLLIElement>(root, '#item-row-f01')
    const posB = q<HTMLElement>(root, '[data-testid="item-row-f01-pos"]')
    expect(posB.textContent).toBe(messages.ui.list.itemSummary(40, 40, 0, 0))

    harness.setPlan({
      ...harness.getPlan(),
      items: harness.getPlan().items.map((item) => (item.id === 'f01' ? { ...item, width: 77 } : item)),
    })
    rerender()

    expect(q<HTMLLIElement>(root, '#item-row-f00')).toBe(rowA)
    expect(q<HTMLLIElement>(root, '#item-row-f01')).toBe(rowB)
    // 同一個 span 節點被改寫（原地更新，非重建）。
    expect(q<HTMLElement>(root, '[data-testid="item-row-f01-pos"]')).toBe(posB)
    expect(posB.textContent).toBe(messages.ui.list.itemSummary(77, 40, 0, 0))
  })

  it('旋轉鈕 → item/rotate，摘要寬深互換（有效外框）', () => {
    mount(planWithItems(1))
    const plan = harness.getPlan()
    harness.setPlan({
      ...plan,
      items: [{ ...plan.items[0]!, width: 120, depth: 60 }],
    })
    rerender()
    expect(q<HTMLElement>(root, '[data-testid="item-row-f00-pos"]').textContent).toBe(
      messages.ui.list.itemSummary(120, 60, 0, 0),
    )

    q<HTMLButtonElement>(root, '#item-row-f00 .row-rotate').click()
    rerender()
    expect(harness.actions).toEqual([{ type: 'item/rotate', id: 'f00' }])
    // 中心不變會算出 y=−30，夾框（reducer）把它壓回房內的 0。
    expect(q<HTMLElement>(root, '[data-testid="item-row-f00-pos"]').textContent).toBe(
      messages.ui.list.itemSummary(60, 120, 30, 0),
    )
  })

  it('連續三次 render 皆不重建列（節點參考恆等）', () => {
    mount(planWithItems(2))
    const rowA = q<HTMLLIElement>(root, '#item-row-f00')
    rerender()
    rerender()
    expect(q<HTMLLIElement>(root, '#item-row-f00')).toBe(rowA)
    expect(root.querySelectorAll('#items-list > li')).toHaveLength(2)
  })

  it('移出本頁的列被移除、切回該頁時重新建立（跨頁不保證同一節點）', () => {
    mount(planWithItems(ITEMS_PAGE_SIZE + 5))
    const firstOfPage1 = q<HTMLLIElement>(root, '#item-row-f00')

    harness.patchUi({ page: 2 })
    rerender()
    expect(root.querySelector('#item-row-f00')).toBeNull()
    expect(root.querySelectorAll('#items-list > li')).toHaveLength(5)

    harness.patchUi({ page: 1 })
    rerender()
    const rebuilt = q<HTMLLIElement>(root, '#item-row-f00')
    expect(rebuilt).not.toBe(firstOfPage1)
    expect(root.querySelectorAll('#items-list > li')).toHaveLength(ITEMS_PAGE_SIZE)
  })

  it('刪除中段家具後重繪，其餘列節點參考不變且順序正確', () => {
    mount(planWithItems(3))
    const rowA = q<HTMLLIElement>(root, '#item-row-f00')
    const rowC = q<HTMLLIElement>(root, '#item-row-f02')

    harness.setPlan({
      ...harness.getPlan(),
      items: harness.getPlan().items.filter((item) => item.id !== 'f01'),
    })
    rerender()

    const rows = Array.from(root.querySelectorAll('#items-list > li'))
    expect(rows).toEqual([rowA, rowC])
  })
})

// ── 3. 非破壞性刪除與「還原 {name}」────────────────────────────────────

describe('非破壞性刪除：還原鈕承載項目身分（D10）', () => {
  it('兩件已刪除家具的還原鈕可及名稱相異，restoreButton(id) 取得同一節點', () => {
    const plan = planWithItems(2)
    plan.items[0].name = 'A'
    plan.items[1].name = 'B'
    mount(plan)

    q<HTMLButtonElement>(root, '#item-row-f00 .row-delete').click()
    q<HTMLButtonElement>(root, '#item-row-f01 .row-delete').click()
    rerender()

    const restoreA = panel.restoreButton('f00')
    const restoreB = panel.restoreButton('f01')
    expect(restoreA).not.toBeNull()
    expect(restoreB).not.toBeNull()
    expect(restoreA?.textContent).toBe('還原 A')
    expect(restoreB?.textContent).toBe('還原 B')
    expect(restoreA?.textContent).not.toBe(restoreB?.textContent)
    expect(restoreA).toBe(q<HTMLButtonElement>(root, '[data-testid="restore-f00"]'))
    expect(restoreB).toBe(q<HTMLButtonElement>(root, '[data-testid="restore-f01"]'))
  })

  it('未刪除的家具 restoreButton(id) 回 null，且還原鈕隱藏', () => {
    mount(planWithItems(1))
    expect(panel.restoreButton('f00')).toBeNull()
    expect(q<HTMLButtonElement>(root, '[data-testid="restore-f00"]').hidden).toBe(true)
  })

  it('刪除後列標 is-deleted、列上動作鈕失能、焦點落在還原鈕；還原後復原', () => {
    mount(planWithItems(1))
    q<HTMLButtonElement>(root, '#item-row-f00 .row-delete').click()

    const restore = q<HTMLButtonElement>(root, '[data-testid="restore-f00"]')
    expect(document.activeElement).toBe(restore)
    expect(harness.actions).toEqual([{ type: 'item/delete', id: 'f00' }])

    rerender()
    expect(q<HTMLLIElement>(root, '#item-row-f00').classList.contains('is-deleted')).toBe(true)
    expect(q<HTMLButtonElement>(root, '#item-row-f00 .row-select').disabled).toBe(true)
    expect(q<HTMLButtonElement>(root, '#item-row-f00 .row-rotate').disabled).toBe(true)

    restore.click()
    rerender()
    expect(harness.actions.at(-1)).toEqual({ type: 'item/restore', id: 'f00' })
    expect(q<HTMLLIElement>(root, '#item-row-f00').classList.contains('is-deleted')).toBe(false)
    expect(q<HTMLButtonElement>(root, '#item-row-f00 .row-select').disabled).toBe(false)
    expect(panel.restoreButton('f00')).toBeNull()
  })
})

// ── 4.（T5.3 起）家具欄位級驗證改由 `props.dom.test.ts` 把關 ────────────
//
// 「寬 0 越界／非數字不送出／改回合法值清標記／名稱空白／旋轉・可通行・顏色
// 各自 patch」六案隨可編輯欄位一起搬到屬性欄，`#props-error` 為新的錯誤落點。

// ── 5. 三閾值三元組（D3）──────────────────────────────────────────────

describe('三閾值三元組驗證（D3）', () => {
  beforeEach(() => {
    mount(defaultPlan())
  })

  it('違序（警示 80 > 建議 75）整組拒收：不 dispatch、#th-error 有文字、該欄 aria-invalid', () => {
    const warn = q<HTMLInputElement>(root, '#th-warn')
    setAndChange(warn, '80')

    expect(harness.actions).toHaveLength(0)
    const error = q<HTMLElement>(root, '#th-error')
    expect(error.textContent).toBe(messages.ui.form.thresholdOrder)
    expect(warn.getAttribute('aria-invalid')).toBe('true')
    expect(warn.getAttribute('aria-describedby')).toBe('th-error')
  })

  it('合法三元組：送出 settings/update 並清掉錯誤', () => {
    const warn = q<HTMLInputElement>(root, '#th-warn')
    setAndChange(warn, '80')
    setAndChange(q<HTMLInputElement>(root, '#th-advise'), '90')

    expect(harness.actions).toEqual([
      { type: 'settings/update', patch: { ignoreBelow: 5, warnBelow: 80, adviseBelow: 90 } },
    ])
    expect(q<HTMLElement>(root, '#th-error').textContent).toBe('')
    expect(warn.hasAttribute('aria-invalid')).toBe(false)
  })

  it('非整數／越界：錯誤文字為範圍提示而非違序提示', () => {
    setAndChange(q<HTMLInputElement>(root, '#th-ignore'), '-3')
    expect(harness.actions).toHaveLength(0)
    expect(q<HTMLElement>(root, '#th-error').textContent).toBe(messages.ui.form.integerRange(0, 5000))
  })

  it('網格 change → settings/update {snap}', () => {
    setAndChange(q<HTMLSelectElement>(root, '#snap-grid'), '10')
    expect(harness.actions).toEqual([{ type: 'settings/update', patch: { snap: 10 } }])
  })
})

// ── 5b. 家具件數軟上限（T4.7）──────────────────────────────────────────

describe('家具件數上限（T4.7 軟上限＋效能警告）', () => {
  function maxItemsInput(): HTMLInputElement {
    return q<HTMLInputElement>(root, '#max-items')
  }

  function warning(): HTMLElement {
    return q<HTMLElement>(root, '#max-items-warning')
  }

  it('預設 20：輸入框帶回當前值，警告隱藏且無 aria-describedby', () => {
    mount(defaultPlan())
    expect(maxItemsInput().value).toBe(String(MAX_ITEMS_DEFAULT))
    expect(warning().hidden).toBe(true)
    expect(maxItemsInput().hasAttribute('aria-describedby')).toBe(false)
  })

  it('調至 30 → dispatch settings/update{maxItems:30}，警告現身並被 aria-describedby 指到', () => {
    mount(defaultPlan())
    setAndChange(maxItemsInput(), '30')

    expect(harness.actions).toEqual([{ type: 'settings/update', patch: { maxItems: 30 } }])
    expect(warning().hidden).toBe(false)
    expect(warning().textContent).toBe(messages.ui.form.maxItemsWarning(MAX_ITEMS_WARN_ABOVE))
    expect(warning().textContent).toContain('16.7 ms')
    expect(maxItemsInput().getAttribute('aria-describedby')).toBe('max-items-warning')
  })

  it('由 30 調回 20 → 警告收起、describedby 移除', () => {
    mount({ ...defaultPlan(), settings: { ...defaultPlan().settings, maxItems: 30 } })
    expect(warning().hidden).toBe(false)

    setAndChange(maxItemsInput(), '20')
    expect(harness.actions).toEqual([{ type: 'settings/update', patch: { maxItems: 20 } }])
    expect(warning().hidden).toBe(true)
    expect(maxItemsInput().hasAttribute('aria-describedby')).toBe(false)
  })

  it('低於現有件數（20 件調成 5）→ aria-invalid＋專屬文案，不 dispatch', () => {
    mount(planWithItems(MAX_ITEMS_DEFAULT))
    setAndChange(maxItemsInput(), '5')

    expect(harness.actions).toHaveLength(0)
    expect(maxItemsInput().getAttribute('aria-invalid')).toBe('true')
    expect(q<HTMLElement>(root, '#th-error').textContent).toBe(
      messages.ui.form.maxItemsBelowCount(MAX_ITEMS_DEFAULT),
    )
  })

  it.each(['x', '', '0', '76', '2.5'])('非整數／越界 %s → aria-invalid 且不 dispatch', (value) => {
    mount(defaultPlan())
    setAndChange(maxItemsInput(), value)

    expect(harness.actions).toHaveLength(0)
    expect(maxItemsInput().getAttribute('aria-invalid')).toBe('true')
    expect(q<HTMLElement>(root, '#th-error').textContent).toBe(
      messages.ui.form.integerRange(1, 75),
    )
  })

  it('警告生效時標錯誤：aria-describedby 同時指向錯誤與警告兩個元素', () => {
    mount({ ...defaultPlan(), settings: { ...defaultPlan().settings, maxItems: 30 } })
    setAndChange(maxItemsInput(), 'x')

    expect(maxItemsInput().getAttribute('aria-describedby')).toBe('th-error max-items-warning')
    expect(warning().hidden).toBe(false)
  })
})

// ── 6. 三個 switch ───────────────────────────────────────────────────

describe('分析開關（button[aria-pressed]）', () => {
  beforeEach(() => {
    mount(defaultPlan())
  })

  it('顯示距離：setUi({showDistance:true}) 且 aria-pressed 立即翻面', () => {
    const button = q<HTMLButtonElement>(root, '#sw-distance')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    button.click()
    expect(harness.setUiCalls).toEqual([{ showDistance: true }])
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(harness.actions).toHaveLength(0)
  })

  it('顯示警示：預設開啟，按下後轉為 false', () => {
    const button = q<HTMLButtonElement>(root, '#sw-warnings')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    button.click()
    expect(harness.setUiCalls).toEqual([{ showWarnings: false }])
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('迴旋區屬 settings：送出 settings/update {showSwing:false}', () => {
    const button = q<HTMLButtonElement>(root, '#sw-swing')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    button.click()
    expect(harness.actions).toEqual([{ type: 'settings/update', patch: { showSwing: false } }])
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(harness.setUiCalls).toHaveLength(0)
  })
})

// ── 7. 加入表單（D5 預設庫、四種種類）─────────────────────────────────

describe('加入表單', () => {
  function selectKind(kind: 'item' | 'extend' | 'cutout' | 'door'): void {
    for (const radio of root.querySelectorAll<HTMLInputElement>('input[name="add-kind"]')) {
      radio.checked = radio.value === kind
    }
    fire(q<HTMLInputElement>(root, `#add-kind-${kind}`), 'change')
  }

  beforeEach(() => {
    mount(defaultPlan())
  })

  it('預設庫選項齊備且選取後帶入名稱與寬深（欄位仍可編輯）', () => {
    const preset = q<HTMLSelectElement>(root, '#add-preset')
    expect(preset.options).toHaveLength(PRESETS.length + 1)

    setAndChange(preset, 'desk')
    expect(q<HTMLInputElement>(root, '#add-name').value).toBe('書桌')
    expect(q<HTMLInputElement>(root, '#add-width').value).toBe('120')
    expect(q<HTMLInputElement>(root, '#add-depth').value).toBe('60')
    expect(q<HTMLInputElement>(root, '#add-name').readOnly).toBe(false)
  })

  it('送出家具：item/add 帶 preset key 與名稱，成功後清欄位、播報並選取新件', () => {
    setAndChange(q<HTMLSelectElement>(root, '#add-preset'), 'desk')
    setAndChange(q<HTMLInputElement>(root, '#add-x'), '10')
    fire(q<HTMLFormElement>(root, '#add-form'), 'submit')

    expect(harness.actions).toHaveLength(1)
    const action = harness.actions[0]
    expect(action.type).toBe('item/add')
    if (action.type !== 'item/add') throw new Error('unreachable')
    expect(action.preset).toBe('desk')
    expect(action.item?.name).toBe('書桌')
    expect(action.item?.width).toBe(120)
    expect(action.item?.x).toBe(10)

    const added = harness.getPlan().items[0]
    expect(harness.announcements).toEqual([messages.status.itemAdded('書桌')])
    expect(harness.setUiCalls).toEqual([{ selectedId: added.id }])
    expect(q<HTMLInputElement>(root, '#add-name').value).toBe('')
    expect(q<HTMLInputElement>(root, '#add-width').value).toBe('')
  })

  it('名稱空白且未選預設：#add-error 有文字且不 dispatch', () => {
    setAndChange(q<HTMLInputElement>(root, '#add-width'), '100')
    setAndChange(q<HTMLInputElement>(root, '#add-depth'), '50')
    fire(q<HTMLFormElement>(root, '#add-form'), 'submit')

    expect(harness.actions).toHaveLength(0)
    expect(q<HTMLElement>(root, '#add-error').textContent).toBe(messages.ui.form.nameRequired)
    expect(q<HTMLInputElement>(root, '#add-name').getAttribute('aria-invalid')).toBe('true')
  })

  it('有名稱但缺寬深且未選預設：錯誤落在寬欄且不 dispatch', () => {
    setAndChange(q<HTMLInputElement>(root, '#add-name'), '自製櫃')
    fire(q<HTMLFormElement>(root, '#add-form'), 'submit')

    expect(harness.actions).toHaveLength(0)
    expect(q<HTMLInputElement>(root, '#add-width').getAttribute('aria-invalid')).toBe('true')
    expect(q<HTMLElement>(root, '#add-error').textContent).toBe(messages.ui.form.sizeRequired)
  })

  it('快選色只改 #add-color，不 dispatch；送出時帶進 action', () => {
    const swatch = q<HTMLButtonElement>(root, '#color-swatches button.swatch[data-color="#d69d9d"]')
    swatch.click()
    expect(q<HTMLInputElement>(root, '#add-color').value).toBe('#d69d9d')
    expect(harness.actions).toHaveLength(0)

    setAndChange(q<HTMLInputElement>(root, '#add-name'), '自製櫃')
    setAndChange(q<HTMLInputElement>(root, '#add-width'), '100')
    setAndChange(q<HTMLInputElement>(root, '#add-depth'), '50')
    fire(q<HTMLFormElement>(root, '#add-form'), 'submit')

    const action = harness.actions[0]
    if (action.type !== 'item/add') throw new Error('unreachable')
    expect(action.item?.color).toBe('#d69d9d')
  })

  it('種類切到門：門欄位現身、名稱與顏色失能，送出 door/add 帶 leafDir 與 swing', () => {
    selectKind('door')
    expect(q<HTMLFieldSetElement>(root, '#add-door-fields').hidden).toBe(false)
    expect(q<HTMLInputElement>(root, '#add-name').disabled).toBe(true)
    expect(q<HTMLInputElement>(root, '#add-color').disabled).toBe(true)

    setAndChange(q<HTMLInputElement>(root, '#add-x'), '0')
    setAndChange(q<HTMLInputElement>(root, '#add-y'), '100')
    setAndChange(q<HTMLInputElement>(root, '#add-width'), '80')
    setAndChange(q<HTMLSelectElement>(root, '#add-door-leafdir'), '-')
    setAndChange(q<HTMLSelectElement>(root, '#add-door-swing'), 'out')
    fire(q<HTMLFormElement>(root, '#add-form'), 'submit')

    expect(harness.actions).toEqual([
      { type: 'door/add', door: { x: 0, y: 100, width: 80, leafDir: '-', swing: 'out' } },
    ])
    expect(harness.announcements).toEqual([messages.status.doorAdded()])
  })

  it('種類為 item 時門欄位隱藏；切到凹入區送出 block/add', () => {
    expect(q<HTMLFieldSetElement>(root, '#add-door-fields').hidden).toBe(true)

    selectKind('cutout')
    expect(q<HTMLInputElement>(root, '#add-color').disabled).toBe(true)
    setAndChange(q<HTMLInputElement>(root, '#add-x'), '0')
    setAndChange(q<HTMLInputElement>(root, '#add-y'), '0')
    setAndChange(q<HTMLInputElement>(root, '#add-width'), '60')
    setAndChange(q<HTMLInputElement>(root, '#add-depth'), '60')
    fire(q<HTMLFormElement>(root, '#add-form'), 'submit')

    expect(harness.actions).toEqual([
      { type: 'block/add', block: { kind: 'cutout', x: 0, y: 0, width: 60, depth: 60 } },
    ])
    expect(harness.announcements).toEqual([messages.status.blockAdded('cutout')])
  })

  it('被 reducer 拒收（門未貼牆）：#add-error 顯示拒絕原因、欄位值保留', () => {
    selectKind('door')
    setAndChange(q<HTMLInputElement>(root, '#add-x'), '150')
    setAndChange(q<HTMLInputElement>(root, '#add-y'), '150')
    setAndChange(q<HTMLInputElement>(root, '#add-width'), '80')
    fire(q<HTMLFormElement>(root, '#add-form'), 'submit')

    expect(harness.actions).toHaveLength(1)
    expect(harness.getPlan().room.doors).toHaveLength(0)
    expect(q<HTMLElement>(root, '#add-error').textContent).toBe(messages.ui.form.doorInvalid)
    expect(q<HTMLInputElement>(root, '#add-width').value).toBe('80')
    expect(harness.announcements).toHaveLength(0)
  })
})

// ── 8. 房間結構清單（D6 牆唯讀、D9 分組）──────────────────────────────

describe('房間結構清單', () => {
  /** 300×400 基底＋一個凹入區＋一扇貼西牆的門。 */
  function planWithStructure(): RoomPlan {
    const base = defaultPlan()
    const withBlock = apply(base, {
      type: 'block/add',
      block: { id: 'b1', kind: 'cutout', x: 0, y: 0, width: 60, depth: 60 },
    })
    if (!withBlock.ok) throw new Error('fixture: block/add 應成功')
    const withDoor = apply(withBlock.plan, {
      type: 'door/add',
      door: { id: 'd1', x: 0, y: 200, width: 70, leafDir: '+', swing: 'in' },
    })
    if (!withDoor.ok) throw new Error('fixture: door/add 應成功')
    return withDoor.plan
  }

  beforeEach(() => {
    mount(planWithStructure())
  })

  it('方塊在前門在後，各一列且 id 為 structure-row-{id}', () => {
    const rows = Array.from(root.querySelectorAll('#structure-list > li'))
    expect(rows.map((row) => row.id)).toEqual(['structure-row-b1', 'structure-row-d1'])
  })

  it('方塊列：種類 badge＋摘要文字，列上無任何輸入控件（T5.3）', () => {
    const row = q<HTMLLIElement>(root, '#structure-row-b1')
    expect(q<HTMLElement>(row, '.row-badge').textContent).toBe(messages.ui.form.kindCutout)
    expect(q<HTMLElement>(row, '[data-testid="structure-row-b1-summary"]').textContent).toBe(
      messages.ui.list.blockSummary(0, 0, 60, 60),
    )
    expect(row.querySelectorAll('input, select')).toHaveLength(0)
  })

  it('T5.5b：版面契約——.row__summary 排在動作鈕（.row__actions）之前，選取／刪除鈕同擠一個不換行的動作區', () => {
    const row = q<HTMLLIElement>(root, '#structure-row-b1')
    const summary = q<HTMLElement>(row, '.row__summary')
    const actions = q<HTMLElement>(row, '.row__actions')
    const position = summary.compareDocumentPosition(actions)
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(actions.contains(q<HTMLButtonElement>(row, '.row-select'))).toBe(true)
    expect(actions.contains(q<HTMLButtonElement>(row, '.row-delete'))).toBe(true)
  })

  it('門列的「牆」只以摘要文字呈現：沒有任何 wall 輸入控件（D6）', () => {
    const row = q<HTMLLIElement>(root, '#structure-row-d1')
    const wall = harness.getPlan().room.doors[0].wall
    expect(q<HTMLElement>(row, '[data-testid="structure-row-d1-summary"]').textContent).toBe(
      messages.ui.list.doorSummary(70, messages.ui.door.wallName(wall)),
    )
    expect(row.querySelectorAll('input, select')).toHaveLength(0)
  })

  it('點選取鈕：選取並把焦點交給畫布節點（門列同理）', () => {
    q<HTMLButtonElement>(root, '[data-testid="select-b1"]').click()
    expect(harness.setUiCalls).toEqual([{ selectedId: 'b1' }])
    expect(harness.focused).toEqual(['block:b1'])

    q<HTMLButtonElement>(root, '[data-testid="select-d1"]').click()
    expect(harness.setUiCalls.at(-1)).toEqual({ selectedId: 'd1' })
    expect(harness.focused.at(-1)).toBe('door:d1')
  })

  it('選取鈕的可及名稱帶物件身分（門帶牆名）', () => {
    expect(q<HTMLButtonElement>(root, '[data-testid="select-b1"]').getAttribute('aria-label')).toBe(
      messages.ui.list.select(messages.ui.form.kindCutout),
    )
    const wall = messages.ui.door.wallName(harness.getPlan().room.doors[0].wall)
    expect(q<HTMLButtonElement>(root, '[data-testid="select-d1"]').getAttribute('aria-label')).toBe(
      messages.ui.list.select(`${messages.ui.form.door} ${wall}`),
    )
  })

  it('is-selected 隨 ui.selectedId 落在對應的結構列', () => {
    harness.patchUi({ selectedId: 'd1' })
    rerender()
    expect(q<HTMLLIElement>(root, '#structure-row-d1').classList.contains('is-selected')).toBe(true)
    expect(q<HTMLLIElement>(root, '#structure-row-b1').classList.contains('is-selected')).toBe(false)
  })

  it('刪除鈕送出 block/remove／door/remove', () => {
    q<HTMLButtonElement>(root, '#structure-row-d1 .row-delete').click()
    expect(harness.actions).toEqual([{ type: 'door/remove', id: 'd1' }])
    rerender()
    expect(root.querySelector('#structure-row-d1')).toBeNull()
  })

  it('牆體硬上限拒收（wall-cap）時，列錯誤顯示 status.wallCapExceeded 文字', () => {
    // D9 棋盤對抗集：縱橫梳齒交叉，移除橋接 cutout 會讓牆體條數暴增。
    const combed = buildCombPlan()
    mount(combed.plan)
    const target = `#structure-row-${combed.bridgeId} .row-delete`
    q<HTMLButtonElement>(root, target).click()

    expect(harness.getPlan().room.blocks.some((block) => block.id === combed.bridgeId)).toBe(true)
    const error = q<HTMLElement>(root, `#structure-row-${combed.bridgeId}-error`)
    expect(error.textContent?.startsWith('牆體已達上限')).toBe(true)
  })
})

/**
 * 造一份「移除某塊就會撞牆體硬上限」的 plan（PLAN §Verification reducer
 * bullet：「先加橋接 cutout 再加 comb 後 `block/remove` 橋接塊 → 拒」）。
 *
 * 先放一塊蓋滿整間房的 cutout，地板因此全空、牆體合併後恆為 1 條；再疊上
 * D9 對抗族的縱橫梳齒（各自被橋接塊蓋住，加入期間條數不變、不會中途被拒）。
 * 移除橋接塊後梳齒全數現形，合併後遠超 `LIMITS.walls`（200），`block/remove`
 * 依 D9 後置條件整個拒收。
 */
function buildCombPlan(): { plan: RoomPlan; bridgeId: string } {
  const ROOM = 50
  const VERTICALS = 16
  const HORIZONTALS = 20

  let plan = defaultPlan()
  const sized = apply(plan, { type: 'room/set', width: ROOM, depth: ROOM })
  if (!sized.ok) throw new Error('fixture: room/set 應成功')
  plan = sized.plan

  const bridgeId = 'bridge'
  const bridge = apply(plan, {
    type: 'block/add',
    block: { id: bridgeId, kind: 'cutout', x: 0, y: 0, width: ROOM, depth: ROOM },
  })
  if (!bridge.ok) throw new Error('fixture: 橋接 cutout 應成功')
  plan = bridge.plan

  const comb: Array<{ id: string; x: number; y: number; width: number; depth: number }> = []
  for (let i = 0; i < VERTICALS; i++) {
    comb.push({ id: `v${i}`, x: 2 * i, y: 0, width: 1, depth: ROOM })
  }
  for (let j = 0; j < HORIZONTALS; j++) {
    comb.push({ id: `h${j}`, x: 0, y: 2 * j, width: ROOM, depth: 1 })
  }
  for (const block of comb) {
    const result = apply(plan, { type: 'block/add', block: { kind: 'cutout', ...block } })
    if (!result.ok) throw new Error(`fixture: ${block.id} 被拒（${result.rejection.reason}）`)
    plan = result.plan
  }
  return { plan, bridgeId }
}

// ── 9. 分頁（OQ1）────────────────────────────────────────────────────

describe('家具清單分頁（OQ1 門檻 20）', () => {
  it('25 件 → 兩頁，首頁 20 列、標籤「第 1/2 頁」、上一頁失能', () => {
    mount(planWithItems(25))
    expect(root.querySelectorAll('#items-list > li')).toHaveLength(ITEMS_PAGE_SIZE)
    expect(q<HTMLElement>(root, '#items-page-label').textContent).toBe('第 1/2 頁')
    expect(q<HTMLButtonElement>(root, '#items-prev').disabled).toBe(true)
    expect(q<HTMLButtonElement>(root, '#items-next').disabled).toBe(false)
  })

  it('按下一頁 → setUi({page:2})；重繪後焦點進入清單並播報換頁', () => {
    mount(planWithItems(25))
    q<HTMLButtonElement>(root, '#items-next').click()
    expect(harness.setUiCalls).toEqual([{ page: 2 }])
    expect(harness.announcements).toHaveLength(0)

    rerender()
    expect(q<HTMLElement>(root, '#items-page-label').textContent).toBe('第 2/2 頁')
    expect(q<HTMLButtonElement>(root, '#items-next').disabled).toBe(true)
    expect(harness.announcements).toEqual([messages.status.pageChanged(2, 2)])

    const itemsList = q<HTMLOListElement>(root, '#items-list')
    expect(itemsList.contains(document.activeElement)).toBe(true)
  })

  it('單頁時不顯示 pager；頁碼超出範圍時夾回最後一頁', () => {
    mount(planWithItems(3))
    expect(q<HTMLElement>(root, '#items-pager').hidden).toBe(true)

    mount(planWithItems(25), { page: 9 })
    expect(q<HTMLElement>(root, '#items-page-label').textContent).toBe('第 2/2 頁')
    expect(root.querySelectorAll('#items-list > li')).toHaveLength(5)
  })

  it('一般 render（非使用者換頁）不搶焦點、不播報', () => {
    mount(planWithItems(25))
    harness.patchUi({ page: 2 })
    rerender()
    expect(harness.announcements).toHaveLength(0)
    expect(document.activeElement).toBe(document.body)
  })
})

// ── 10. 選取、a11y 標記與 detach ─────────────────────────────────────

describe('選取與可及名稱', () => {
  it('列首鈕文字為名稱、aria-label 為「選取 {name}」，點擊後選取並移焦畫布', () => {
    const plan = planWithItems(1)
    plan.items[0].name = '書桌'
    mount(plan)

    const select = q<HTMLButtonElement>(root, '#item-row-f00 .row-select')
    expect(select).toBe(q<HTMLButtonElement>(root, '[data-testid="select-f00"]'))
    expect(select.textContent).toBe('書桌')
    expect(select.getAttribute('aria-label')).toBe('選取 書桌')

    select.click()
    expect(harness.setUiCalls).toEqual([{ selectedId: 'f00' }])
    expect(harness.focused).toEqual(['item:f00'])
  })

  it('is-selected 隨 ui.selectedId 移動', () => {
    mount(planWithItems(2), { selectedId: 'f01' })
    expect(q<HTMLLIElement>(root, '#item-row-f01').classList.contains('is-selected')).toBe(true)
    expect(q<HTMLLIElement>(root, '#item-row-f00').classList.contains('is-selected')).toBe(false)

    harness.patchUi({ selectedId: 'f00' })
    rerender()
    expect(q<HTMLLIElement>(root, '#item-row-f00').classList.contains('is-selected')).toBe(true)
    expect(q<HTMLLIElement>(root, '#item-row-f01').classList.contains('is-selected')).toBe(false)
  })

  it('列上沒有 label（沒有輸入控件可標），只有鈕與純文字（T5.3）', () => {
    mount(planWithItems(1))
    const row = q<HTMLLIElement>(root, '#item-row-f00')
    expect(row.querySelectorAll('label')).toHaveLength(0)
    // T5.4：四顆鈕的角色類與順序不變，外加統一的 `.btn btn--small` 視覺形
    //（刪除鈕再加 `btn--danger`）。
    expect(Array.from(row.querySelectorAll('button')).map((b) => b.className)).toEqual([
      'btn btn--small row-select',
      'btn btn--small row-rotate',
      'btn btn--small btn--danger row-delete',
      'btn btn--small row-restore',
    ])
  })

  it('detach() 後互動不再 dispatch', () => {
    mount(planWithItems(1))
    panel.detach()
    q<HTMLButtonElement>(root, '#item-row-f00 .row-rotate').click()
    q<HTMLButtonElement>(root, '#item-row-f00 .row-delete').click()
    q<HTMLButtonElement>(root, '#sw-distance').click()
    expect(harness.actions).toHaveLength(0)
    expect(harness.setUiCalls).toHaveLength(0)
  })

  it('el.io 對外露出 io-panel 各鈕（main.ts 自行接線）', () => {
    mount(defaultPlan())
    expect(panel.el.io.undo).toBe(q<HTMLButtonElement>(root, '#btn-undo'))
    expect(panel.el.io.importFile).toBe(q<HTMLInputElement>(root, '#import-file'))
    expect(panel.el.io.notice).toBe(q<HTMLElement>(root, '#io-notice'))
    expect(panel.el.itemsList).toBe(q<HTMLOListElement>(root, '#items-list'))
  })
})

// ── 11. 原始碼掃描：D7 DOM 寫入不變量 ────────────────────────────────

describe('原始碼掃描：DOM 寫入不變量（D7）', () => {
  it('panel.ts 不含 HTML 字串注入與整批子節點替換 API', () => {
    // 沿用 `bar-toggle.dom.test.ts` 的取徑手法：jsdom 環境下 `new URL(…)` 走的
    // 是 jsdom 的 URL 實作，`fileURLToPath` 會判為非 file: scheme。
    const here = path.dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(path.join(here, 'panel.ts'), 'utf-8')
    for (const banned of ['innerHTML', 'insertAdjacentHTML', 'outerHTML', 'replaceChildren']) {
      expect(source).not.toContain(banned)
    }
  })
})
