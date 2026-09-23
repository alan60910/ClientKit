// @vitest-environment jsdom
/**
 * T2.5 — 真頁面整合冒煙（(internal design doc) §Milestone 2
 * Acceptance「`npm run dev` 可操作」的 jsdom 代理、§Frontend Component tree／
 * Keyboard、§D2「拖移期以父 `<g transform>` 位移，commit 才回寫 `x`/`y` 與
 * `aria-label`」、§D9 使用者玄關實例「釘死座標」與其驗收口徑）。
 *
 * 與 `main.dom.test.ts` 的分工：那一支釘 `main.ts` 自身的時序契約（播報、
 * backup、flush），本檔只走**使用者路徑**——表單、清單、畫布鍵盤——再以
 * 純函式 `clearance()` 對最終 plan 取證，確認「接線產出的狀態」與 PLAN 的
 * 驗收狀態一致（M3 才負責把它畫出來）。
 *
 * jsdom 的 SVG `getBoundingClientRect()` 恆全零（PLAN §D2 實證），故在
 * import `main.ts` **之前**先把 `#board-svg` 的該方法 stub 成 300×400——
 * 這樣 `preserveAspectRatio="xMidYMid meet"` 的 scale 恰為 1、letterbox
 * 位移恰為 0，px 數值即 cm 數值，標籤也不會被 OQ2 門檻判為隱藏。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearance } from './clearance.js'
import { t } from './messages.js'
import { effectiveRect, type RoomPlan } from './model.js'
import { parsePlan } from './serialize.js'
import { STORAGE_KEY } from './storage-keys.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const RAW_HTML = readFileSync(path.resolve(DIR, 'index.html'), 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]!

const m = t()

/** 假畫布尺寸：scale 恰為 1、letterbox 位移恰為 0（同 `drag.dom.test.ts`）。 */
const BOARD_RECT = { left: 0, top: 0, width: 300, height: 400 }

function stubbedRect(): DOMRect {
  const { left, top, width, height } = BOARD_RECT
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

type MainModule = typeof import('./main.js')

async function boot(): Promise<MainModule> {
  document.body.innerHTML = BODY_HTML
  const svg = document.getElementById('board-svg')
  if (svg === null) throw new Error('測試骨架缺少 #board-svg')
  svg.getBoundingClientRect = stubbedRect
  vi.resetModules()
  return await import('./main.js')
}

// ── DOM 小工具 ───────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`測試骨架缺少 #${id}`)
  return found as T
}

function statusText(): string {
  return el('status').textContent ?? ''
}

function setValue(id: string, value: string): void {
  el<HTMLInputElement>(id).value = value
}

function setControl(id: string, value: string): void {
  const control = el<HTMLInputElement | HTMLSelectElement>(id)
  control.value = value
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

function chooseKind(kind: 'item' | 'extend' | 'cutout' | 'door'): void {
  const radio = el<HTMLInputElement>(`add-kind-${kind}`)
  radio.checked = true
  radio.dispatchEvent(new Event('change', { bubbles: true }))
}

function submitAddForm(): void {
  el('add-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/** 畫布上第一個家具節點的裸 id（DOM id 為 `item-{id}`，D7 前綴形）。 */
function firstItemId(): string {
  const node = document.querySelector('#layer-items [data-kind="item"]')
  if (node === null) throw new Error('畫布上沒有家具節點')
  const id = node.getAttribute('data-id')
  if (id === null) throw new Error('家具節點缺少 data-id')
  return id
}

function keydown(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

function viewBoxWidth(): number {
  const raw = el('board-svg').getAttribute('viewBox') ?? '0 0 0 0'
  return Number(raw.split(/\s+/)[2])
}

/** 自 localStorage 取回目前 plan（走 `parsePlan`，與四條載入路徑同一把關）。 */
function storedPlan(): RoomPlan {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) throw new Error('localStorage 沒有存檔')
  const parsed = parsePlan(raw)
  if (!parsed.ok) throw new Error(`存檔無法解析：${parsed.reason}`)
  return parsed.plan
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  // 排空前一個 app 實例殘留的未決 autosave（理由同 `main.dom.test.ts`）。
  window.dispatchEvent(new Event('pagehide'))
  document.body.innerHTML = ''
})

/* ------------------------------------------------------------------ *
 * 一、開機 → 加入 → 鍵盤移動 → 刪除 → 還原
 * ------------------------------------------------------------------ */

describe('真頁面冒煙：開機渲染與加入家具', () => {
  it('開機即畫出地板矩形，skip-nav 四個落點皆存在', async () => {
    await boot()
    expect(document.querySelectorAll('#layer-floor > rect').length).toBeGreaterThan(0)
    for (const href of ['#board-section', '#settings-section', '#props-section', '#items-section']) {
      expect(document.querySelector(href), `${href} 應存在`).not.toBeNull()
    }
  })

  it('由加入表單新增家具 → 畫布節點（role=button、roving 0）與清單列同時出現', async () => {
    await boot()
    chooseKind('item')
    setValue('add-name', '書桌')
    setValue('add-width', '120')
    setValue('add-depth', '60')
    submitAddForm()

    const id = firstItemId()
    const node = el(`item-${id}`)
    expect(node.getAttribute('role')).toBe('button')
    expect(node.getAttribute('tabindex')).toBe('0')
    expect(node.getAttribute('aria-roledescription')).toBe(m.ui.board.itemRoledescription)
    expect(document.getElementById(`item-row-${id}`)).not.toBeNull()
    expect(statusText()).toBe(m.status.itemAdded('書桌'))
  })
})

describe('真頁面冒煙：鍵盤拖移態 → 靜默 commit → 刪除 → 還原', () => {
  it('方向鍵 ×3 → 500 ms 靜默後回寫 x／aria-label 並播報；Delete → 焦點落「還原」鈕；還原 → 節點回來', async () => {
    await boot()
    vi.useFakeTimers()

    chooseKind('item')
    setValue('add-name', '書桌')
    setValue('add-width', '120')
    setValue('add-depth', '60')
    submitAddForm()

    const id = firstItemId()
    const node = el(`item-${id}`)
    node.focus()
    for (let i = 0; i < 3; i++) keydown(node, 'ArrowRight')

    vi.advanceTimersByTime(500)

    // T5.3：座標的可編輯欄位在屬性欄（加入後即為選取中），清單列只留摘要。
    expect(el<HTMLInputElement>('props-item-x').value).toBe('3')
    expect(
      document.querySelector(`[data-testid="item-row-${id}-pos"]`)?.textContent,
    ).toBe(m.ui.list.itemSummary(120, 60, 3, 0))
    expect(el(`item-${id}`).getAttribute('aria-label')).toContain('位置 3,0')
    expect(statusText()).toBe(m.status.itemMoved('書桌', 3, 0))

    keydown(el(`item-${id}`), 'Delete')
    const restore = document.querySelector<HTMLButtonElement>(`[data-testid="restore-${id}"]`)
    expect(restore).not.toBeNull()
    expect(document.activeElement).toBe(restore)
    expect(statusText()).toBe(m.status.itemDeleted('書桌'))
    expect(document.getElementById(`item-${id}`)).toBeNull()

    restore!.click()
    expect(document.getElementById(`item-${id}`)).not.toBeNull()
    expect(statusText()).toBe(m.status.itemRestored('書桌'))
  })
})

describe('真頁面冒煙：設定寫入 autosave 與畫布縮放', () => {
  it('`#sw-swing` 切換 → 300 ms 後 localStorage 的 settings.showSwing 變 false', async () => {
    await boot()
    vi.useFakeTimers()
    const mod = await import('./main.js')

    el<HTMLButtonElement>('sw-swing').click()
    expect(el('sw-swing').getAttribute('aria-pressed')).toBe('false')
    vi.advanceTimersByTime(mod.AUTOSAVE_DEBOUNCE_MS)

    expect(storedPlan().settings.showSwing).toBe(false)
  })

  it('`#btn-zoom-in` → viewBox 變窄且比例文字改變；`#btn-fit` 回 100%', async () => {
    await boot()
    const beforeWidth = viewBoxWidth()
    expect(el('zoom-label').textContent).toBe('100%')

    el<HTMLButtonElement>('btn-zoom-in').click()
    expect(viewBoxWidth()).toBeLessThan(beforeWidth)
    expect(el('zoom-label').textContent).not.toBe('100%')

    el<HTMLButtonElement>('btn-fit').click()
    expect(viewBoxWidth()).toBe(beforeWidth)
    expect(el('zoom-label').textContent).toBe('100%')
  })
})

describe('真頁面冒煙：家具件數上限由使用者調高（T4.7）', () => {
  it('把 #max-items 調到 21 → settings 進 autosave、警告現身、第 21 件加得進去', async () => {
    const mod = await boot()
    vi.useFakeTimers()

    setControl('max-items', '21')
    expect(el('max-items-warning').hidden).toBe(false)
    expect(el('max-items-warning').textContent).toBe(m.ui.form.maxItemsWarning(20))

    chooseKind('item')
    setValue('add-name', '書桌')
    setValue('add-width', '120')
    setValue('add-depth', '60')
    submitAddForm()

    mod.flushAutosave()
    const plan = storedPlan()
    expect(plan.settings.maxItems).toBe(21)
    expect(plan.items).toHaveLength(1)
  })

  it('調到低於現有件數 → 欄位標 aria-invalid、設定不變', async () => {
    const mod = await boot()

    chooseKind('item')
    setValue('add-name', '書桌')
    setValue('add-width', '120')
    setValue('add-depth', '60')
    submitAddForm()

    setControl('max-items', '0')
    expect(el('max-items').getAttribute('aria-invalid')).toBe('true')

    mod.flushAutosave()
    expect(storedPlan().settings.maxItems).toBe(20)
  })
})

/* ------------------------------------------------------------------ *
 * 二、玄關實例（D9 釘死座標）全程走 UI
 * ------------------------------------------------------------------ */

describe('玄關實例：凹槽＋門＋衣櫃全程由 UI 建出（D9 釘死座標）', () => {
  it('extend(300,0,60,270)＋門(360,270,寬70,-,內開)＋衣櫃 200×60 旋轉 90 於 (300,0) → 門洞 1、碰撞 0、門違規 0、各面違規 0', async () => {
    const mod = await boot()

    // (1) 凸出區 E1：x∈[300,360]、y∈[0,270]
    chooseKind('extend')
    setValue('add-width', '60')
    setValue('add-depth', '270')
    setValue('add-x', '300')
    setValue('add-y', '0')
    submitAddForm()
    expect(statusText()).toBe(m.status.blockAdded('extend'))

    // (2) 門：鉸鏈 (360,270)、leafDir '-'、寬 70、內開
    chooseKind('door')
    setValue('add-width', '70')
    setValue('add-x', '360')
    setValue('add-y', '270')
    setControl('add-door-leafdir', '-')
    setControl('add-door-swing', 'in')
    submitAddForm()
    expect(statusText()).toBe(m.status.doorAdded())

    // (3) 衣櫃（開門式）預設庫 → 覆寫為 200×60（D9：本身尺寸 200×60）
    chooseKind('item')
    setControl('add-preset', 'wardrobe-hinged')
    expect(el<HTMLInputElement>('add-name').value).toBe('衣櫃（開門式）')
    setValue('add-width', '200')
    setValue('add-depth', '60')
    setValue('add-x', '300')
    setValue('add-y', '0')
    submitAddForm()

    // (4) 屬性欄雙路徑（T5.3：可編輯欄位自清單列搬到 `#props-section`，加入後
    //     即為選取中）：旋轉 90 後再把座標推回 (300,0)（加入時被夾框到 x=160）
    const id = firstItemId()
    expect(el<HTMLFormElement>('props-item').hidden).toBe(false)
    setControl('props-item-rotation', '90')
    setControl('props-item-x', '300')
    setControl('props-item-y', '0')

    mod.flushAutosave()
    const plan = storedPlan()

    const wardrobe = plan.items.find((item) => item.id === id)
    expect(wardrobe).toBeDefined()
    expect({ ...effectiveRect(wardrobe!) }).toEqual({ x0: 300, y0: 0, x1: 360, y1: 200 })
    expect(plan.room.blocks).toHaveLength(1)
    expect(plan.room.doors).toHaveLength(1)
    expect(plan.room.doors[0].wall).toBe('E')

    // PLAN §D9 驗收口徑：零紅、零碰撞、零各面違規、零門違規；門洞一筆。
    const report = clearance(plan)
    expect(report.corridors.filter((c) => c.kind === 'doorway')).toHaveLength(1)
    expect(report.corridors.filter((c) => c.level === 'narrow')).toHaveLength(0)
    expect(report.collisions).toHaveLength(0)
    expect(report.doorViolations).toHaveLength(0)
    expect(report.sideViolations).toHaveLength(0)
    expect(report.unattachedDoors).toHaveLength(0)
  })
})
