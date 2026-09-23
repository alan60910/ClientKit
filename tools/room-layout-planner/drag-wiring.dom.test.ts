// @vitest-environment jsdom
/**
 * T3.4b — 拖移期接線的真頁面回歸網（(internal design doc)
 * §D10「拖移態統一」「處置（OQ4 定案）」「render（OQ5 定案）」、§D4 門洞與
 * `maxGap` 兩路徑、§Frontend Accessibility「overlay `aria-hidden`，資訊由
 * report-list 文字等價」）。
 *
 * 與既有三支的分工：`overlay.dom.test.ts` 釘 `overlay.ts`／`board.ts` 的節點
 * 預算本身、`clearance-moved.test.ts` 釘增量與全量的逐字等價、
 * `integration.dom.test.ts` 釘 M2 的使用者路徑；本檔只釘**`main.ts` 把三者
 * 接起來**的那一層：拖移期畫面走不走節點預算、增量報告有沒有反映**當下**
 * 位置、commit 後有沒有回到全量。
 *
 * 取證一律走 DOM 與純函式 `clearance()`——`main.ts` 的 `cache` 是模組內部
 * 變數，無法 spy，故以「畫面上的 report 等於重新全量算一次的 report」為
 * 增量正確性的觀測面（逐字等價本身已由 S6 property test 保證）。
 *
 * jsdom 的 SVG `getBoundingClientRect()` 恆全零（PLAN §D2 實證），故 boot 前
 * 先 stub 成 300×400：樣本房恰為 300×400，`preserveAspectRatio` 的 scale 因此
 * 恰為 1、letterbox 位移恰為 0，指標路徑的 px 數值即 cm 數值。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearance } from './clearance.js'
import { t } from './messages.js'
import { defaultPlan, type Furniture, type RoomPlan } from './model.js'
import { buildEntries, countReport, summaryText, REPORT_PAGE_SIZE } from './report-list.js'
import { parsePlan } from './serialize.js'
import { STORAGE_KEY } from './storage-keys.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const RAW_HTML = readFileSync(path.resolve(DIR, 'index.html'), 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]!

const m = t()

/**
 * 假畫布尺寸：scale 恰為 1、letterbox 位移恰為 0 → px 數值即 cm 數值。
 *
 * T5.1 起 `board.ts` 的 fit 框是外接框**加 `FIT_MARGIN_CM`＝24 cm**
 * （尺寸標註畫在框外），故樣本房 300×400 的 viewBox 是
 * `-24 -24 348 448`。要維持「px 數值即 cm 數值」這條讓本檔可讀的性質，
 * 假畫布盒同步位移並放大同一段邊距：盒 348×448、原點 (−24,−24)。
 */
const BOARD_RECT = { left: -24, top: -24, width: 348, height: 448 }

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

async function boot(plan: RoomPlan): Promise<MainModule> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
  document.body.innerHTML = BODY_HTML
  const svg = document.getElementById('board-svg')
  if (svg === null) throw new Error('測試骨架缺少 #board-svg')
  svg.getBoundingClientRect = stubbedRect
  vi.resetModules()
  return await import('./main.js')
}

// ── 樣本 ─────────────────────────────────────────────────────────────

function item(
  id: string,
  x: number,
  y: number,
  width: number,
  depth: number,
  extra: Partial<Furniture> = {},
): Furniture {
  return {
    id,
    name: `櫃${id}`,
    color: '#9db4d6',
    width,
    depth,
    x,
    y,
    rotation: 0,
    passable: true,
    ...extra,
  }
}

/**
 * 節點預算樣本（房 300×400、預設閾值 5／60／75）。五類節點各至少一個，
 * 否則「拖移期這些節點為 0」的斷言會是空的：
 *
 * - `a1`／`b1` 隔著門扇跨距 x∈[100,170] 對望 → 母通道命中 D4 門洞三條件。
 * - `a1`／`c1` 相距 50 cm → `narrow`（紅斜線區）。
 * - `c1`／`e1` 相距 130 cm → `ok`（僅「顯示距離」開啟時畫尺寸線）。
 * - `d1` 壓在門迴旋區（鉸鏈 (100,0)、半徑 70）裡 → `doorViolations`；
 *   它與 a1／b1 的通道矩形只**相切**（y=60），故不當遮擋物。
 * - `e1` 南面需留 100 cm、離南框只有 40 cm → `sideViolations`。
 */
function budgetPlan(): RoomPlan {
  const plan = defaultPlan()
  plan.room.doors = [{ id: 'dr1', x: 100, y: 0, wall: 'N', leafDir: '+', width: 70, swing: 'in' }]
  plan.items = [
    item('a1', 40, 0, 60, 60),
    item('b1', 170, 0, 60, 60),
    item('c1', 40, 110, 60, 60),
    item('d1', 110, 60, 40, 10),
    item('e1', 40, 300, 60, 60, { clearances: { S: 100 } }),
  ]
  return plan
}

/** 方塊拖移樣本：D9 玄關凸出區（貼在東邊、與基底房相接）＋一件家具。 */
function vestibulePlan(): RoomPlan {
  const plan = defaultPlan()
  plan.room.blocks = [{ id: 'k1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }]
  plan.items = [item('a1', 40, 0, 60, 60)]
  return plan
}

// ── DOM 小工具 ───────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`測試骨架缺少 #${id}`)
  return found as T
}

function node(domId: string): Element {
  const found = document.getElementById(domId)
  if (found === null) throw new Error(`畫布缺少節點 #${domId}`)
  return found
}

function statusText(): string {
  return el('status').textContent ?? ''
}

/** `overlay-dynamic` 內符合選擇器的節點數（拖移期節點預算的觀測面）。 */
function dynamic(selector: string): number {
  return document.querySelectorAll(`#overlay-dynamic ${selector}`).length
}

/** 地板／牆體的幾何指紋（方塊拖移是否**即時**重推房型的觀測面）。 */
function shapeSignature(): string {
  return Array.from(document.querySelectorAll('#layer-floor > rect, #layer-walls > rect'))
    .map((r) => ['x', 'y', 'width', 'height'].map((a) => r.getAttribute(a)).join(','))
    .join('|')
}

function keydown(target: Element, key: string, shiftKey = false): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init })
}

/** 「顯示距離」開關（`ok`／門洞尺寸線的畫不畫，D3／D4）。 */
function toggleDistance(): void {
  el<HTMLButtonElement>('sw-distance').click()
}

function storedPlan(): RoomPlan {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) throw new Error('localStorage 沒有存檔')
  const parsed = parsePlan(raw)
  if (!parsed.ok) throw new Error(`存檔無法解析：${parsed.reason}`)
  return parsed.plan
}

/** 畫面上分析清單第一頁的逐列文字。 */
function reportRows(): string[] {
  return Array.from(document.querySelectorAll('#report-list > li')).map((li) => li.textContent ?? '')
}

// ── rAF（`main.ts` 未注入 `raf`，指標路徑走全域）────────────────────
const frames = new Map<number, () => void>()
let nextFrame = 1

function stubRaf(): void {
  vi.stubGlobal('requestAnimationFrame', (fn: () => void): number => {
    const handle = nextFrame++
    frames.set(handle, fn)
    return handle
  })
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    frames.delete(handle)
  })
}

function flushFrames(): void {
  const pending = Array.from(frames.values())
  frames.clear()
  for (const fn of pending) fn()
}

beforeEach(() => {
  localStorage.clear()
  frames.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // 排空前一個 app 實例殘留的未決 autosave（理由同 `main.dom.test.ts`）。
  window.dispatchEvent(new Event('pagehide'))
  document.body.innerHTML = ''
  frames.clear()
})

/* ------------------------------------------------------------------ *
 * 零、樣本自檢
 * ------------------------------------------------------------------ */

describe('樣本前提：五類節點皆非空（否則預算斷言是空的）', () => {
  it('budgetPlan 同時產出 doorway／ok／narrow／doorViolation／sideViolation', () => {
    const report = clearance(budgetPlan())
    const corridors = report.corridors
    expect(corridors.filter((c) => c.kind === 'doorway').length).toBeGreaterThan(0)
    expect(corridors.filter((c) => c.kind === 'corridor' && c.level === 'ok').length).toBeGreaterThan(0)
    expect(corridors.filter((c) => c.kind === 'corridor' && c.level === 'narrow').length).toBeGreaterThan(0)
    expect(report.doorViolations.length).toBeGreaterThan(0)
    expect(report.sideViolations.length).toBeGreaterThan(0)
    expect(report.unattachedDoors).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * 一、拖移期節點預算（OQ5 (1)）
 * ------------------------------------------------------------------ */

describe('拖移期節點預算：overlay-dynamic 只留 narrow＋碰撞', () => {
  it('鍵盤拖移中 ok／門洞／門違規／各面違規節點歸零，500 ms commit 後原樣補回', async () => {
    await boot(budgetPlan())
    toggleDistance()
    vi.useFakeTimers()

    // 拖移前：四類節點都在（斷言有東西可以消失）。
    expect(dynamic('.corridor--ok')).toBeGreaterThan(0)
    expect(dynamic('.corridor--doorway')).toBeGreaterThan(0)
    expect(dynamic('.door-violation')).toBeGreaterThan(0)
    expect(dynamic('.side-need--violated')).toBeGreaterThan(0)
    const narrowBefore = dynamic('.corridor--narrow')
    expect(narrowBefore).toBeGreaterThan(0)

    const a1 = node('item-a1')
    for (let i = 0; i < 3; i++) keydown(a1, 'ArrowRight')

    // 靜默期間（`ui.dragging` 非 null）：只剩 narrow 與碰撞。
    expect(a1.getAttribute('class')).toContain('is-dragging')
    expect(dynamic('.corridor--ok')).toBe(0)
    expect(dynamic('.corridor--doorway')).toBe(0)
    expect(dynamic('.door-violation')).toBe(0)
    expect(dynamic('.side-need--violated')).toBe(0)
    expect(dynamic('.corridor--narrow')).toBeGreaterThan(0)

    vi.advanceTimersByTime(500)

    expect(dynamic('.corridor--ok')).toBeGreaterThan(0)
    expect(dynamic('.corridor--doorway')).toBeGreaterThan(0)
    expect(dynamic('.door-violation')).toBeGreaterThan(0)
    expect(dynamic('.side-need--violated')).toBeGreaterThan(0)
    expect(statusText()).toContain(m.status.itemMoved('櫃a1', 43, 0))
    expect(node('item-a1').getAttribute('transform')).toBeNull()
  })

  it('拖移期 overlay 反映**當下**位置：疊上另一件家具即出現碰撞框（未 commit）', async () => {
    await boot(budgetPlan())
    vi.useFakeTimers()

    expect(dynamic('.collision')).toBe(0)
    const a1 = node('item-a1')
    // Shift＋方向鍵 10 cm × 8 ＝ 80 cm：a1 [40,100] → [120,180]，壓到 b1 [170,230]。
    for (let i = 0; i < 8; i++) keydown(a1, 'ArrowRight', true)

    expect(dynamic('.collision')).toBeGreaterThan(0)
    // 仍在拖移態：x／aria-label 尚未回寫（D2）。
    expect(a1.getAttribute('data-x')).toBe('40')
    expect(a1.getAttribute('transform')).toBe('translate(80 0)')

    vi.advanceTimersByTime(500)
    expect(node('item-a1').getAttribute('data-x')).toBe('120')
    expect(dynamic('.collision')).toBeGreaterThan(0)
  })

  it('夾框後原地未動的一幀整幀跳過：無 transform、overlay 不動、commit 不播報', async () => {
    await boot(budgetPlan())
    toggleDistance()
    vi.useFakeTimers()

    const okBefore = dynamic('.corridor--ok')
    const a1 = node('item-a1')
    // a1 已貼北框（y=0），ArrowUp 夾框後回同一個 plan 參考。
    keydown(a1, 'ArrowUp')

    expect(a1.getAttribute('transform')).toBeNull()
    expect(dynamic('.corridor--ok')).toBe(okBefore)

    vi.advanceTimersByTime(500)
    expect(statusText()).toBe('')
    expect(node('item-a1').getAttribute('data-y')).toBe('0')
  })
})

/* ------------------------------------------------------------------ *
 * 二、增量路徑的等價（畫面上的 report ＝ 重新全量算一次）
 * ------------------------------------------------------------------ */

describe('增量 report 等價：連續鍵盤步進＋commit 後與 clearance() 逐列相同', () => {
  it('#report-summary 與 #report-list 第一頁 ＝ clearance(present) 的文字等價', async () => {
    const mod = await boot(budgetPlan())
    // 「顯示距離」開啟 → 走完整路徑，才與無 `maxGap` 的 `clearance()` 同口徑。
    toggleDistance()
    vi.useFakeTimers()

    const a1 = node('item-a1')
    for (let i = 0; i < 4; i++) keydown(a1, 'ArrowRight', true)
    keydown(node('item-a1'), 'ArrowDown', true)
    vi.advanceTimersByTime(500)

    mod.flushAutosave()
    const plan = storedPlan()
    const fresh = clearance(plan)

    expect(el('report-summary').textContent).toBe(summaryText(countReport(fresh), m))
    const expected = buildEntries(plan, fresh, m)
      .slice(0, REPORT_PAGE_SIZE)
      .map((entry) => entry.text)
    expect(reportRows()).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
  })

  it('連續五次拖移接力（cache 每幀換手）後仍與全量逐列相同', async () => {
    const mod = await boot(budgetPlan())
    toggleDistance()
    vi.useFakeTimers()

    for (let step = 0; step < 5; step++) {
      keydown(node('item-a1'), 'ArrowDown')
      keydown(node('item-a1'), 'ArrowRight')
      vi.advanceTimersByTime(500)
    }

    mod.flushAutosave()
    const plan = storedPlan()
    const fresh = clearance(plan)
    expect(el('report-summary').textContent).toBe(summaryText(countReport(fresh), m))
    expect(reportRows()).toEqual(
      buildEntries(plan, fresh, m).slice(0, REPORT_PAGE_SIZE).map((entry) => entry.text),
    )
  })

  it('Esc 取消 → report 回到拖移前的內容（增量 cache 一併作廢）', async () => {
    await boot(budgetPlan())
    toggleDistance()
    vi.useFakeTimers()

    const summaryBefore = el('report-summary').textContent
    const rowsBefore = reportRows()

    const a1 = node('item-a1')
    for (let i = 0; i < 8; i++) keydown(a1, 'ArrowRight', true)
    expect(dynamic('.collision')).toBeGreaterThan(0)

    keydown(node('item-a1'), 'Escape')

    expect(node('item-a1').getAttribute('data-x')).toBe('40')
    expect(node('item-a1').getAttribute('transform')).toBeNull()
    expect(dynamic('.collision')).toBe(0)
    expect(el('report-summary').textContent).toBe(summaryBefore)
    expect(reportRows()).toEqual(rowsBefore)
    // 取消後回到全量畫面：拖移期省下的節點都回來了。
    expect(dynamic('.corridor--doorway')).toBeGreaterThan(0)
    expect(dynamic('.corridor--ok')).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ *
 * 三、方塊拖移走全量＋renderCommit（房型會變，不能只動 transform）
 * ------------------------------------------------------------------ */

describe('方塊拖移：地板／牆體即時重推', () => {
  it('方向鍵移動凸出區 → 同一幀地板指紋改變、data-x 回寫，500 ms 後播報 blockMoved', async () => {
    await boot(vestibulePlan())
    vi.useFakeTimers()

    const before = shapeSignature()
    const block = node('block-k1')
    // 向左一步：凸出區與基底房仍相接（不與 D9 連接性混在一起談）。
    keydown(block, 'ArrowLeft')

    expect(shapeSignature()).not.toBe(before)
    expect(node('block-k1').getAttribute('data-x')).toBe('299')

    vi.advanceTimersByTime(500)
    expect(statusText()).toContain(m.status.blockMoved(299, 0))
    expect(node('block-k1').getAttribute('transform')).toBeNull()
  })

  it('T3.4c：拖曳中外接框變大也不重新 fit viewBox，500 ms commit 後才 fit', async () => {
    await boot(vestibulePlan())
    vi.useFakeTimers()

    const svg = el('board-svg')
    const before = svg.getAttribute('viewBox')
    // 外接框 360×400 ＋ T5.1 的 24 cm 邊距。
    expect(before).toBe('-24 -24 408 448')

    const block = node('block-k1')
    // 向右一步：凸出區右緣超出原外接框（300..360 → 301..361），bounds 變大。
    keydown(block, 'ArrowRight')

    // 靜默期間：地板已重推（data-x 回寫），但 viewBox 屬性凍結未變（T3.4c）。
    expect(node('block-k1').getAttribute('data-x')).toBe('301')
    expect(svg.getAttribute('viewBox')).toBe(before)

    vi.advanceTimersByTime(500)
    // commit 後才依新外接框重新 fit（361×400 ＋ 24 cm 邊距）。
    expect(svg.getAttribute('viewBox')).toBe('-24 -24 409 448')
  })
})

/* ------------------------------------------------------------------ *
 * 四、指標路徑（rAF 合併 → pointerup commit）
 * ------------------------------------------------------------------ */

describe('指標拖移：pointerdown → pointermove（rAF）→ pointerup', () => {
  it('拖移中走節點預算，pointerup 後座標回寫且 overlay 補回全量', async () => {
    stubRaf()
    await boot(budgetPlan())
    toggleDistance()

    const svg = el('board-svg')
    const a1 = node('item-a1')
    a1.dispatchEvent(pointer('pointerdown', { clientX: 70, clientY: 30, button: 0, pointerId: 1 }))
    svg.dispatchEvent(pointer('pointermove', { clientX: 95, clientY: 30, pointerId: 1 }))
    flushFrames()

    // 抓取位移 −30 → 落點 65（網格 5 的倍數、離鄰邊皆 >5 cm，不觸發磁吸）。
    expect(a1.getAttribute('transform')).toBe('translate(25 0)')
    expect(a1.getAttribute('data-x')).toBe('40')
    expect(dynamic('.corridor--doorway')).toBe(0)
    expect(dynamic('.corridor--ok')).toBe(0)

    svg.dispatchEvent(pointer('pointerup', { clientX: 95, clientY: 30, pointerId: 1 }))

    // T5.3：pointerdown 已選取該件，座標回寫看屬性欄（清單列只剩摘要文字）。
    expect(el<HTMLInputElement>('props-item-x').value).toBe('65')
    expect(document.querySelector('[data-testid="item-row-a1-pos"]')?.textContent).toContain('65')
    expect(node('item-a1').getAttribute('data-x')).toBe('65')
    expect(node('item-a1').getAttribute('transform')).toBeNull()
    expect(dynamic('.corridor--ok')).toBeGreaterThan(0)
    expect(dynamic('.door-violation')).toBeGreaterThan(0)
    expect(statusText()).toContain(m.status.itemMoved('櫃a1', 65, 0))
  })
})

/* ------------------------------------------------------------------ *
 * 五、「顯示距離」切換（非拖移態；cache 換 opts 必須走全量）
 * ------------------------------------------------------------------ */

describe('「顯示距離」切換：ok 通道節點進出（D4 兩路徑）', () => {
  it('關 → 開 → 關，ok 節點 0 → 非 0 → 0，且警示類節點全程不動', async () => {
    await boot(budgetPlan())

    const narrow = dynamic('.corridor--narrow')
    const collisions = dynamic('.collision')
    expect(dynamic('.corridor--ok')).toBe(0)

    toggleDistance()
    expect(dynamic('.corridor--ok')).toBeGreaterThan(0)
    expect(dynamic('.corridor--narrow')).toBe(narrow)
    expect(dynamic('.collision')).toBe(collisions)

    toggleDistance()
    expect(dynamic('.corridor--ok')).toBe(0)
    expect(dynamic('.corridor--narrow')).toBe(narrow)
  })

  it('拖移中切換「顯示距離」→ 預篩口徑改變不會讓增量 report 失真', async () => {
    const mod = await boot(budgetPlan())
    vi.useFakeTimers()

    const a1 = node('item-a1')
    keydown(a1, 'ArrowRight', true)
    // 靜默期間點開關 → `setUi` 重建 cache；後續幀必須接得上新的 `maxGap`。
    toggleDistance()
    keydown(node('item-a1'), 'ArrowRight', true)
    vi.advanceTimersByTime(500)

    mod.flushAutosave()
    const plan = storedPlan()
    const fresh = clearance(plan)
    expect(el('report-summary').textContent).toBe(summaryText(countReport(fresh), m))
    expect(reportRows()).toEqual(
      buildEntries(plan, fresh, m).slice(0, REPORT_PAGE_SIZE).map((entry) => entry.text),
    )
  })
})
