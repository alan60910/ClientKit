// @vitest-environment jsdom
/**
 * T5.3 — `props.ts` 的 jsdom 回歸網（(internal design doc)
 * Milestone 5 回饋 (3)「新增物件屬性欄，並獨立一區」；PLAN.md §D5 四向需留、
 * §D6「門的『牆』欄唯讀」、§D10「`change` 才 dispatch」「非破壞性刪除」、
 * §Accessibility Forms）。
 *
 * 骨架來源：**直接讀 `index.html` 的 `<body>`**（與 `integration.dom.test.ts`
 * 同手法）——屬性欄的每個欄位都是靜態骨架的一部分，用現搭的假骨架測就等於
 * 沒測到「HTML 與 props.ts 是否對得上」。本檔不 import `main.ts`，故仍是
 * 單模組測試。
 *
 * host 是假的、reducer 是真的：`dispatch` 記下 action 後交給真正的 `apply()`，
 * 拒收路徑（門合法性、查無項目）因此是真實行為。`setUi` **刻意不重繪**，
 * 重繪時機由測試自行呼叫 `render()` 扮演。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { t } from './messages.js'
import { defaultPlan, type Action, type Furniture, type RoomPlan } from './model.js'
import { attachProps, type Props, type PropsHost } from './props.js'
import { apply } from './reducer.js'
import { DEFAULT_UI, type UiState } from './ui-state.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const RAW_HTML = readFileSync(path.resolve(DIR, 'index.html'), 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]!

const m = t()

// ── 假 host（真 reducer）──────────────────────────────────────────────

interface Harness {
  host: PropsHost
  actions: Action[]
  setUiCalls: Partial<UiState>[]
  getPlan(): RoomPlan
  getUi(): UiState
  patchUi(patch: Partial<UiState>): void
}

function makeHarness(initial: RoomPlan, ui0: Partial<UiState> = {}): Harness {
  let plan = initial
  let ui: UiState = { ...DEFAULT_UI, ...ui0 }
  const actions: Action[] = []
  const setUiCalls: Partial<UiState>[] = []

  const host: PropsHost = {
    getPlan: () => plan,
    getUi: () => ui,
    messages: m,
    dispatch(action) {
      actions.push(action)
      const result = apply(plan, action)
      if (result.ok) plan = result.plan
      return result
    },
    setUi(patch) {
      setUiCalls.push(patch)
      ui = { ...ui, ...patch }
    },
    focusBoardNode() {
      /* 屬性欄不移焦畫布 */
    },
    announce() {
      /* 播報由 main.ts 負責 */
    },
  }

  return {
    host,
    actions,
    setUiCalls,
    getPlan: () => plan,
    getUi: () => ui,
    patchUi: (patch) => {
      ui = { ...ui, ...patch }
    },
  }
}

// ── fixture ──────────────────────────────────────────────────────────

function itemPlan(overrides: Partial<Furniture> = {}): RoomPlan {
  const item: Furniture = {
    id: 'f1',
    name: '書桌',
    color: '#9db4d6',
    width: 120,
    depth: 60,
    x: 10,
    y: 20,
    rotation: 0,
    passable: true,
    ...overrides,
  }
  return { ...defaultPlan(), items: [item] }
}

/** 300×400 基底＋一個凹入區 `b1` ＋一扇貼西牆的門 `d1`。 */
function structurePlan(): RoomPlan {
  const withBlock = apply(defaultPlan(), {
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

// ── DOM 小工具 ───────────────────────────────────────────────────────

function q<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (found === null) throw new Error(`骨架缺少 ${selector}`)
  return found
}

function input(id: string): HTMLInputElement {
  return q<HTMLInputElement>(`#${id}`)
}

function fire(target: EventTarget, type: string): void {
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
}

function setAndChange(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  control.value = value
  fire(control, 'change')
}

let harness: Harness
let props: Props

function mount(plan: RoomPlan, ui: Partial<UiState> = {}): void {
  document.body.innerHTML = BODY_HTML
  harness = makeHarness(plan, ui)
  props = attachProps(document, harness.host)
  rerender()
}

function rerender(): void {
  props.render(harness.getPlan(), harness.getUi(), null)
}

function visibleForms(): string[] {
  return ['props-item', 'props-block', 'props-door'].filter(
    (id) => !q<HTMLFormElement>(`#${id}`).hidden,
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
})

// ── 1. 選取解析：三種物件各顯示一份表單 ───────────────────────────────

describe('選取解析：一次只顯示一份表單', () => {
  it('未選取：顯示提示句、三份表單全隱藏', () => {
    mount(itemPlan())
    expect(q<HTMLElement>('#props-empty').hidden).toBe(false)
    expect(visibleForms()).toEqual([])
  })

  it('選取家具：家具表單現身、提示句收起、欄位帶回現值', () => {
    mount(itemPlan({ rotation: 90, passable: false, clearances: { S: 90 } }), { selectedId: 'f1' })

    expect(visibleForms()).toEqual(['props-item'])
    expect(q<HTMLElement>('#props-empty').hidden).toBe(true)
    expect(input('props-item-name').value).toBe('書桌')
    expect(input('props-item-width').value).toBe('120')
    expect(input('props-item-depth').value).toBe('60')
    expect(input('props-item-x').value).toBe('10')
    expect(input('props-item-y').value).toBe('20')
    expect(q<HTMLSelectElement>('#props-item-rotation').value).toBe('90')
    expect(input('props-item-passable').checked).toBe(false)
    expect(input('props-item-need-s').value).toBe('90')
    expect(input('props-item-need-n').value).toBe('')
  })

  it('選取方塊：方塊表單現身，種類為唯讀文字', () => {
    mount(structurePlan(), { selectedId: 'b1' })

    expect(visibleForms()).toEqual(['props-block'])
    expect(q<HTMLElement>('#props-block-kind').textContent).toBe(m.ui.form.kindCutout)
    expect(input('props-block-x').value).toBe('0')
    expect(input('props-block-width').value).toBe('60')
    expect(input('props-block-depth').value).toBe('60')
  })

  it('選取門：門表單現身，牆為唯讀文字且沒有 wall 輸入控件（D6）', () => {
    mount(structurePlan(), { selectedId: 'd1' })

    expect(visibleForms()).toEqual(['props-door'])
    const wall = harness.getPlan().room.doors[0]!.wall
    expect(q<HTMLElement>('#props-door-wall').textContent).toBe(m.ui.door.wallName(wall))
    expect(document.querySelector('input#props-door-wall, select#props-door-wall')).toBeNull()
    expect(input('props-door-width').value).toBe('70')
    expect(q<HTMLSelectElement>('#props-door-swing').value).toBe('in')
  })

  it('選取的 id 不在任何集合裡（如剛被永久移除）：回到提示句', () => {
    mount(itemPlan(), { selectedId: 'ghost' })
    expect(visibleForms()).toEqual([])
    expect(q<HTMLElement>('#props-empty').hidden).toBe(false)
  })

  it('切換選取：家具 → 方塊，表單跟著換（節點不重建）', () => {
    const plan = { ...structurePlan(), items: itemPlan().items }
    mount(plan, { selectedId: 'f1' })
    const form = q<HTMLFormElement>('#props-item')

    harness.patchUi({ selectedId: 'b1' })
    rerender()
    expect(visibleForms()).toEqual(['props-block'])
    expect(q<HTMLFormElement>('#props-item')).toBe(form)
  })
})

// ── 2. change 才 dispatch（D10）────────────────────────────────────────

describe('change 才 dispatch（D10）', () => {
  beforeEach(() => {
    mount(itemPlan(), { selectedId: 'f1' })
  })

  it('打字（input 事件）不 dispatch，change 才送出 item/update', () => {
    const width = input('props-item-width')
    width.value = '150'
    fire(width, 'input')
    expect(harness.actions).toHaveLength(0)

    fire(width, 'change')
    expect(harness.actions).toEqual([{ type: 'item/update', id: 'f1', patch: { width: 150 } }])
  })

  it('名稱／X／旋轉／可通行／顏色各自送出對應 patch', () => {
    setAndChange(input('props-item-name'), '大書桌')
    setAndChange(input('props-item-x'), '30')
    setAndChange(q<HTMLSelectElement>('#props-item-rotation'), '180')
    const passable = input('props-item-passable')
    passable.checked = false
    fire(passable, 'change')
    setAndChange(input('props-item-color'), '#ff0000')

    expect(harness.actions).toEqual([
      { type: 'item/update', id: 'f1', patch: { name: '大書桌' } },
      { type: 'item/update', id: 'f1', patch: { x: 30 } },
      { type: 'item/update', id: 'f1', patch: { rotation: 180 } },
      { type: 'item/update', id: 'f1', patch: { passable: false } },
      { type: 'item/update', id: 'f1', patch: { color: '#ff0000' } },
    ])
  })

  it('快選色即時套用：改寫顏色欄並送出 item/update', () => {
    q<HTMLButtonElement>('#props-swatches button.swatch[data-color="#d6b89d"]').click()
    expect(input('props-item-color').value).toBe('#d6b89d')
    expect(harness.actions).toEqual([
      { type: 'item/update', id: 'f1', patch: { color: '#d6b89d' } },
    ])
  })
})

// ── 3. 欄位級驗證 ────────────────────────────────────────────────────

describe('非法輸入 → aria-invalid＋錯誤文字且不 dispatch', () => {
  beforeEach(() => {
    mount(itemPlan(), { selectedId: 'f1' })
  })

  it('寬 0 越界：標記 aria-invalid、describedby 指向 #props-error、不送出', () => {
    const width = input('props-item-width')
    setAndChange(width, '0')

    expect(harness.actions).toHaveLength(0)
    expect(width.getAttribute('aria-invalid')).toBe('true')
    expect(width.getAttribute('aria-describedby')).toBe('props-error')
    expect(q<HTMLElement>('#props-error').textContent).toBe(m.ui.form.integerRange(1, 5000))
  })

  it('改回合法值：清掉標記與文字並送出', () => {
    const width = input('props-item-width')
    setAndChange(width, '0')
    setAndChange(width, '140')

    expect(harness.actions).toEqual([{ type: 'item/update', id: 'f1', patch: { width: 140 } }])
    expect(width.hasAttribute('aria-invalid')).toBe(false)
    expect(q<HTMLElement>('#props-error').textContent).toBe('')
  })

  it('名稱清空：標記 aria-invalid 且不送出（isValidName）', () => {
    const name = input('props-item-name')
    setAndChange(name, '   ')
    expect(harness.actions).toHaveLength(0)
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(q<HTMLElement>('#props-error').textContent).toBe(m.ui.form.nameRequired)
  })

  it('打字中的欄位不被 render 覆寫（uncontrolled 表單）', () => {
    const name = input('props-item-name')
    name.focus()
    name.value = '打到一半'
    rerender()
    expect(name.value).toBe('打到一半')

    name.blur()
    rerender()
    expect(name.value).toBe('書桌')
  })

  it('換選取時清掉上一個物件留下的欄位錯誤', () => {
    setAndChange(input('props-item-width'), '0')
    expect(q<HTMLElement>('#props-error').textContent).not.toBe('')

    harness.patchUi({ selectedId: null })
    rerender()
    expect(q<HTMLElement>('#props-error').textContent).toBe('')
    expect(input('props-item-width').hasAttribute('aria-invalid')).toBe(false)
  })
})

// ── 4. 各面需留（D5：整張表一起送）────────────────────────────────────

describe('各面需留 N/E/S/W（D5）', () => {
  it('南側填 90 → item/update {clearances:{S:90}}', () => {
    mount(itemPlan(), { selectedId: 'f1' })
    setAndChange(input('props-item-need-s'), '90')

    expect(harness.actions).toEqual([
      { type: 'item/update', id: 'f1', patch: { clearances: { S: 90 } } },
    ])
    expect(harness.getPlan().items[0]!.clearances).toEqual({ S: 90 })
  })

  it('已有兩面時只改其中一面：另一面不被抹掉（整張表重建）', () => {
    mount(itemPlan({ clearances: { N: 60, S: 90 } }), { selectedId: 'f1' })
    setAndChange(input('props-item-need-n'), '75')

    expect(harness.actions).toEqual([
      { type: 'item/update', id: 'f1', patch: { clearances: { N: 75, S: 90 } } },
    ])
  })

  it('清空該面（空字串或 0）→ 該面自表中消失；全空即整欄移除', () => {
    mount(itemPlan({ clearances: { S: 90 } }), { selectedId: 'f1' })
    setAndChange(input('props-item-need-s'), '0')

    expect(harness.actions).toEqual([{ type: 'item/update', id: 'f1', patch: { clearances: {} } }])
    expect(harness.getPlan().items[0]!.clearances).toBeUndefined()
  })

  it('負值：標 aria-invalid 且整組不送出', () => {
    mount(itemPlan(), { selectedId: 'f1' })
    const need = input('props-item-need-e')
    setAndChange(need, '-5')

    expect(harness.actions).toHaveLength(0)
    expect(need.getAttribute('aria-invalid')).toBe('true')
  })
})

// ── 5. 非破壞性刪除（D10）─────────────────────────────────────────────

describe('刪除／還原：維持選取、鈕互換、焦點接手', () => {
  it('刪除 → 還原鈕現身且取得焦點、輸入失能；還原 → 復原', () => {
    mount(itemPlan(), { selectedId: 'f1' })
    const del = q<HTMLButtonElement>('#props-item-delete')
    const restore = q<HTMLButtonElement>('#props-item-restore')

    del.click()
    expect(harness.actions).toEqual([{ type: 'item/delete', id: 'f1' }])
    expect(restore.hidden).toBe(false)
    expect(del.hidden).toBe(true)
    expect(document.activeElement).toBe(restore)
    expect(input('props-item-width').disabled).toBe(true)
    // 仍選著同一件（清單列的「還原」也還在同一個位置）。
    expect(harness.getUi().selectedId).toBe('f1')

    rerender()
    expect(restore.hidden).toBe(false)
    expect(visibleForms()).toEqual(['props-item'])

    restore.click()
    expect(harness.actions.at(-1)).toEqual({ type: 'item/restore', id: 'f1' })
    expect(restore.hidden).toBe(true)
    expect(del.hidden).toBe(false)
    expect(input('props-item-width').disabled).toBe(false)
  })

  it('旋轉鈕送出 item/rotate', () => {
    mount(itemPlan(), { selectedId: 'f1' })
    q<HTMLButtonElement>('#props-item-rotate').click()
    expect(harness.actions).toEqual([{ type: 'item/rotate', id: 'f1' }])
  })
})

// ── 6. 方塊／門 ──────────────────────────────────────────────────────

describe('方塊與門', () => {
  it('方塊寬 change → block/update；刪除 → block/remove 後清空選取', () => {
    mount(structurePlan(), { selectedId: 'b1' })
    setAndChange(input('props-block-width'), '80')
    expect(harness.actions).toEqual([{ type: 'block/update', id: 'b1', patch: { width: 80 } }])

    q<HTMLButtonElement>('#props-block-delete').click()
    expect(harness.actions.at(-1)).toEqual({ type: 'block/remove', id: 'b1' })
    expect(harness.setUiCalls).toEqual([{ selectedId: null }])
  })

  it('門的 leafDir／swing change → door/update；刪除 → door/remove 後清空選取', () => {
    mount(structurePlan(), { selectedId: 'd1' })
    setAndChange(q<HTMLSelectElement>('#props-door-leafdir'), '-')
    setAndChange(q<HTMLSelectElement>('#props-door-swing'), 'out')
    expect(harness.actions).toEqual([
      { type: 'door/update', id: 'd1', patch: { leafDir: '-' } },
      { type: 'door/update', id: 'd1', patch: { swing: 'out' } },
    ])

    q<HTMLButtonElement>('#props-door-delete').click()
    expect(harness.actions.at(-1)).toEqual({ type: 'door/remove', id: 'd1' })
    expect(harness.setUiCalls).toEqual([{ selectedId: null }])
  })

  it('被 reducer 拒（門移到牆外）：#props-error 顯示拒絕原因、值保持使用者所打的樣子', () => {
    mount(structurePlan(), { selectedId: 'd1' })
    const x = input('props-door-x')
    setAndChange(x, '150')

    expect(harness.actions).toEqual([{ type: 'door/update', id: 'd1', patch: { x: 150 } }])
    expect(q<HTMLElement>('#props-error').textContent).toBe(m.ui.form.doorInvalid)
    expect(x.getAttribute('aria-invalid')).toBe('true')
    expect(x.value).toBe('150')
  })
})

// ── 7. detach ────────────────────────────────────────────────────────

describe('detach()', () => {
  it('detach 後互動不再 dispatch', () => {
    mount(itemPlan(), { selectedId: 'f1' })
    props.detach()

    setAndChange(input('props-item-width'), '99')
    q<HTMLButtonElement>('#props-item-delete').click()
    expect(harness.actions).toHaveLength(0)
  })
})

// ── 8. 原始碼掃描：D7 DOM 寫入不變量 ─────────────────────────────────

describe('原始碼掃描：DOM 寫入不變量（D7）', () => {
  it('props.ts 不含 HTML 字串注入與整批子節點替換 API', () => {
    const source = readFileSync(path.join(DIR, 'props.ts'), 'utf-8')
    for (const banned of ['innerHTML', 'insertAdjacentHTML', 'outerHTML', 'replaceChildren']) {
      expect(source).not.toContain(banned)
    }
  })
})
