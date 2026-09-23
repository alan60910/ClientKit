// @vitest-environment jsdom
/**
 * T3.2 — `report-list` 的文字等價／分頁／聚焦回路（(internal design doc)
 * /PLAN.md §D3「警示」定義、§D4 corridor `kind`（doorway／suppressed 不評級）、
 * §D9 玄關實例「期望 report」、§Frontend Component tree「`report-list` 置於
 * 畫布正下方（同分區、內捲、分頁）」、§Accessibility「overlay 資訊由
 * `report-list` 文字等價」「大量項目分頁＋換頁焦點管理與播報」「Live regions：
 * 警示數只播報摘要」、§Verification jsdom「玄關實例筆數分佈、`report-list`
 * 與畫布同分區」、§Open questions OQ1「分頁門檻預設 20」）。
 *
 * 三層：
 * 1. **純函式**（`countReport`／`buildEntries`／`summaryText`）——以 D9 玄關
 *    實例真跑 `clearance()` 取報告，再對筆數分佈與組句斷言。
 * 2. **DOM fixture**——只灌 `#report-*` 六件套骨架，驗原地更新、分頁、換頁
 *    焦點與播報、點擊聚焦回路。
 * 3. **真頁面 boot**（同 `main.dom.test.ts` 手法）——版位判準與 `main.ts`
 *    的警示摘要播報接線。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearance } from './clearance.js'
import { t } from './messages.js'
import {
  DEFAULT_SETTINGS,
  type ClearanceReport,
  type Corridor,
  type Furniture,
  type RoomPlan,
} from './model.js'
import {
  attachReportList,
  buildEntries,
  countReport,
  REPORT_PAGE_SIZE,
  summaryText,
  type ReportList,
  type ReportListHost,
} from './report-list.js'
import { STORAGE_KEY } from './storage-keys.js'
import { DEFAULT_UI, type UiState } from './ui-state.js'

const m = t()

const DIR = path.dirname(fileURLToPath(import.meta.url))
const RAW_HTML = readFileSync(path.resolve(DIR, 'index.html'), 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]!

/* ------------------------------------------------------------------ *
 * fixture 工具
 * ------------------------------------------------------------------ */

function mkFurniture(over: Partial<Furniture> & Pick<Furniture, 'id'>): Furniture {
  return {
    name: over.id,
    color: '#336699',
    width: 50,
    depth: 50,
    x: 0,
    y: 0,
    rotation: 0,
    passable: true,
    ...over,
  }
}

function mkPlan(over: Partial<RoomPlan['room']> & { items?: Furniture[] } = {}): RoomPlan {
  return {
    version: 1,
    room: {
      width: over.width ?? 300,
      depth: over.depth ?? 400,
      blocks: over.blocks ?? [],
      doors: over.doors ?? [],
    },
    items: over.items ?? [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

/**
 * D9 玄關實例（釘死座標）：基底 300×400 ＋ extend `E1` x∈[300,360]、
 * y∈[0,270]；衣櫃 200×60 rotation 90 於 (300,0)；門鉸鏈 (360,270)、
 * `leafDir:'-'`、寬 70、內開。
 */
function vestibulePlan(): RoomPlan {
  return mkPlan({
    blocks: [{ id: 'E1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }],
    doors: [{ id: 'D1', x: 360, y: 270, wall: 'E', leafDir: '-', width: 70, swing: 'in' }],
    items: [
      mkFurniture({
        id: 'W1',
        name: '衣櫃（開門式）',
        width: 200,
        depth: 60,
        x: 300,
        y: 0,
        rotation: 90,
        clearances: { S: 90 },
      }),
    ],
  })
}

function emptyReport(): ClearanceReport {
  return {
    corridors: [],
    collisions: [],
    sideViolations: [],
    doorViolations: [],
    unattachedDoors: [],
    unconnectedBlocks: [],
  }
}

function mkCorridor(over: Partial<Corridor> & Pick<Corridor, 'a' | 'b'>): Corridor {
  return {
    axis: 'x',
    gap: 50,
    rect: { x0: 0, y0: 0, x1: 1, y1: 1 },
    level: 'narrow',
    kind: 'corridor',
    segIndex: 0,
    ...over,
  }
}

/* ------------------------------------------------------------------ *
 * 一、純函式：玄關實例的筆數分佈與組句
 * ------------------------------------------------------------------ */

describe('countReport：D9 玄關實例的筆數分佈', () => {
  it('零紅／零碰撞／零各面違規／零門違規；不評級 1（門洞）、ok 1、touch 2', () => {
    const plan = vestibulePlan()
    const counts = countReport(clearance(plan))

    expect(counts).toEqual({
      narrow: 0,
      collisions: 0,
      side: 0,
      door: 0,
      tight: 0,
      unrated: 1,
      ok: 1,
      touch: 2,
    })
  })

  it('`doorway`／`suppressed` 皆計入 unrated、不落入 level 四段（D4）', () => {
    const report = emptyReport()
    report.corridors = [
      mkCorridor({ a: 'i0', b: 'wall:0', kind: 'doorway', level: null }),
      mkCorridor({ a: 'i0', b: 'i1', kind: 'suppressed', level: null, segIndex: 1 }),
      mkCorridor({ a: 'i0', b: 'frame:N', level: 'tight', segIndex: 2 }),
    ]
    const counts = countReport(report)
    expect(counts.unrated).toBe(2)
    expect(counts.tight).toBe(1)
    expect(counts.narrow + counts.ok + counts.touch).toBe(0)
  })
})

describe('buildEntries：玄關實例的文字等價', () => {
  const plan = vestibulePlan()
  const entries = buildEntries(plan, clearance(plan), m)

  it('恰一筆門洞，含「門洞（不評級）」與「70 cm」', () => {
    const doorway = entries.filter((entry) => entry.kind === 'doorway')
    expect(doorway).toHaveLength(1)
    expect(doorway[0].text).toContain('門洞（不評級）')
    expect(doorway[0].text).toContain('70 cm')
  })

  it('牆體參照 `wall:<i>` 顯示為「牆體」、框邊 `frame:W` 顯示為「西牆」', () => {
    const doorway = entries.find((entry) => entry.kind === 'doorway')!
    expect(doorway.text).toContain(m.report.wallName)

    const ok = entries.filter((entry) => entry.kind === 'ok')
    expect(ok).toHaveLength(1)
    expect(ok[0].text).toContain(m.ui.door.wallName('W'))
    expect(ok[0].text).toContain('衣櫃（開門式）')
  })

  it('每一筆通道都有可聚焦目標（衣櫃），且 touch 兩筆排在最後', () => {
    expect(entries).toHaveLength(4)
    for (const entry of entries) {
      expect(entry.focus).toEqual({ kind: 'item', id: 'W1' })
    }
    expect(entries.slice(2).map((entry) => entry.kind)).toEqual(['touch', 'touch'])
  })
})

describe('buildEntries：四類警示與結構性問題的組句', () => {
  it('frame:N|E|S|W → 北牆／東牆／南牆／西牆', () => {
    const plan = mkPlan({ items: [mkFurniture({ id: 'i0', name: '書桌' })] })
    const report = emptyReport()
    report.corridors = (['N', 'E', 'S', 'W'] as const).map((side, index) =>
      mkCorridor({ a: 'i0', b: `frame:${side}`, segIndex: index }),
    )
    const texts = buildEntries(plan, report, m).map((entry) => entry.text)
    for (const side of ['N', 'E', 'S', 'W'] as const) {
      expect(texts.some((text) => text.includes(m.ui.door.wallName(side)))).toBe(true)
    }
  })

  it('碰撞：「{a} 與 {b} 重疊」且 severity 2', () => {
    const plan = mkPlan({
      items: [mkFurniture({ id: 'i0', name: '書桌' }), mkFurniture({ id: 'i1', name: '沙發' })],
    })
    const report = emptyReport()
    report.collisions = [{ a: 'i0', b: 'i1', rect: { x0: 0, y0: 0, x1: 1, y1: 1 } }]
    const [entry] = buildEntries(plan, report, m)
    expect(entry.kind).toBe('collision')
    expect(entry.severity).toBe(2)
    expect(entry.text).toBe(m.report.text.collision('書桌', '沙發'))
    expect(entry.text).toContain('重疊')
  })

  it('各面違規：含世界方向面名與 need／actual／對象', () => {
    const plan = mkPlan({
      items: [
        mkFurniture({ id: 'i0', name: '衣櫃', clearances: { S: 90 } }),
        mkFurniture({ id: 'i1', name: '書桌' }),
      ],
    })
    const report = emptyReport()
    // rotation 90 時 local S → world W（D5 `worldSide`）。
    report.sideViolations = [
      { id: 'i0', side: 'S', worldSide: 'W', need: 90, actual: 30, against: 'i1' },
    ]
    const [entry] = buildEntries(plan, report, m)
    expect(entry.kind).toBe('side')
    expect(entry.severity).toBe(2)
    expect(entry.text).toBe(m.report.text.side('衣櫃', m.report.sideName('W'), 90, 30, '書桌'))
    expect(entry.text).toContain('西側')
    expect(entry.focus).toEqual({ kind: 'item', id: 'i0' })
  })

  it('門違規：「{家具} 進入{東牆的門}的迴旋區」，聚焦落在家具', () => {
    const plan = mkPlan({
      doors: [{ id: 'D1', x: 300, y: 100, wall: 'E', leafDir: '-', width: 80, swing: 'in' }],
      items: [mkFurniture({ id: 'i0', name: '衣櫃' })],
    })
    const report = emptyReport()
    report.doorViolations = [{ doorId: 'D1', itemId: 'i0' }]
    const [entry] = buildEntries(plan, report, m)
    expect(entry.kind).toBe('door')
    expect(entry.text).toBe(m.report.text.door('衣櫃', m.report.doorName('E')))
    expect(entry.focus).toEqual({ kind: 'item', id: 'i0' })
  })

  it('未附著的門與未連接的凸出區各成一筆，聚焦落在該節點', () => {
    const plan = mkPlan({
      blocks: [{ id: 'B9', kind: 'extend', x: 1000, y: 1000, width: 10, depth: 10 }],
      doors: [{ id: 'D9', x: 5, y: 5, wall: 'N', leafDir: '+', width: 80, swing: 'in' }],
    })
    const report = emptyReport()
    report.unattachedDoors = ['D9']
    report.unconnectedBlocks = ['B9']
    const entries = buildEntries(plan, report, m)
    const unattached = entries.find((entry) => entry.kind === 'unattached')!
    const unconnected = entries.find((entry) => entry.kind === 'unconnected')!
    expect(unattached.text).toContain('D9')
    expect(unattached.focus).toEqual({ kind: 'door', id: 'D9' })
    expect(unconnected.text).toContain('B9')
    expect(unconnected.focus).toEqual({ kind: 'block', id: 'B9' })
  })

  it('已刪除的家具不給聚焦目標（畫布上沒有該節點）', () => {
    const plan = mkPlan({ items: [mkFurniture({ id: 'i0', name: '書桌', deleted: true })] })
    const report = emptyReport()
    report.corridors = [mkCorridor({ a: 'i0', b: 'frame:N' })]
    expect(buildEntries(plan, report, m)[0].focus).toBeNull()
  })

  it('排序：severity 由高到低，touch 殿後', () => {
    const plan = mkPlan({ items: [mkFurniture({ id: 'i0', name: '書桌' })] })
    const report = emptyReport()
    report.corridors = [
      mkCorridor({ a: 'i0', b: 'frame:N', level: 'touch', segIndex: 0 }),
      mkCorridor({ a: 'i0', b: 'frame:E', level: 'ok', segIndex: 1 }),
      mkCorridor({ a: 'i0', b: 'frame:S', level: 'tight', segIndex: 2 }),
      mkCorridor({ a: 'i0', b: 'frame:W', level: 'narrow', segIndex: 3 }),
    ]
    expect(buildEntries(plan, report, m).map((entry) => entry.kind)).toEqual([
      'narrow',
      'tight',
      'ok',
      'touch',
    ])
  })
})

describe('summaryText：四類警示數＋提示／不評級後綴', () => {
  it('以 status.warningsSummary 起頭、report.summaryExtra 收尾', () => {
    const counts = {
      narrow: 1,
      collisions: 2,
      side: 3,
      door: 4,
      tight: 5,
      unrated: 6,
      ok: 7,
      touch: 8,
    }
    expect(summaryText(counts, m)).toBe(
      `${m.status.warningsSummary(1, 2, 3, 4)}；${m.report.summaryExtra(5, 6)}`,
    )
  })
})

/* ------------------------------------------------------------------ *
 * 二、DOM fixture：原地更新、分頁、聚焦回路
 * ------------------------------------------------------------------ */

interface Harness {
  list: ReportList
  ui: UiState
  setUiCalls: Array<Partial<UiState>>
  focusCalls: Array<[string, string]>
  announced: string[]
  render(plan: RoomPlan, report: ClearanceReport | null): void
}

function skeleton(): void {
  const doc = document
  doc.body.textContent = ''
  const summary = doc.createElement('p')
  summary.id = 'report-summary'
  const list = doc.createElement('ol')
  list.id = 'report-list'
  const pager = doc.createElement('div')
  pager.id = 'report-pager'
  for (const [id, tag] of [
    ['report-prev', 'button'],
    ['report-page-label', 'span'],
    ['report-next', 'button'],
  ] as const) {
    const el = doc.createElement(tag)
    el.id = id
    pager.append(el)
  }
  doc.body.append(summary, list, pager)
}

function mount(plan: RoomPlan, report: ClearanceReport | null): Harness {
  skeleton()
  const ui: UiState = { ...DEFAULT_UI }
  const setUiCalls: Array<Partial<UiState>> = []
  const focusCalls: Array<[string, string]> = []
  const announced: string[] = []
  let currentPlan = plan
  let currentReport = report
  let list: ReportList

  const host: ReportListHost = {
    getPlan: () => currentPlan,
    getUi: () => ui,
    messages: m,
    setUi(patch) {
      setUiCalls.push({ ...patch })
      Object.assign(ui, patch)
      // 與 `main.ts` 同樣由 host 負責重繪。
      list.render(currentPlan, ui, currentReport)
    },
    focusBoardNode(kind, id) {
      focusCalls.push([kind, id])
    },
    announce(text) {
      announced.push(text)
    },
  }

  list = attachReportList(document, host)
  list.render(plan, ui, report)

  return {
    list,
    ui,
    setUiCalls,
    focusCalls,
    announced,
    render(nextPlan, nextReport) {
      currentPlan = nextPlan
      currentReport = nextReport
      list.render(nextPlan, ui, nextReport)
    },
  }
}

function rowTexts(): string[] {
  return Array.from(document.querySelectorAll('#report-list > li'), (li) => li.textContent ?? '')
}

function rowNodes(): HTMLLIElement[] {
  return Array.from(document.querySelectorAll<HTMLLIElement>('#report-list > li'))
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`測試骨架缺少 #${id}`)
  return found as T
}

afterEach(() => {
  document.body.textContent = ''
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('render：玄關實例的可見筆數受「顯示距離」管（D3：touch 不標）', () => {
  it('showDistance 關閉時 touch 兩筆不出現；開啟後出現', () => {
    const plan = vestibulePlan()
    const report = clearance(plan)
    const harness = mount(plan, report)

    expect(harness.ui.showDistance).toBe(false)
    expect(rowTexts()).toHaveLength(2)
    expect(rowTexts().some((text) => text.includes('門洞（不評級）'))).toBe(true)

    harness.ui.showDistance = true
    harness.render(plan, report)
    expect(rowTexts()).toHaveLength(4)
  })

  it('`#report-summary` 恆為摘要句；report 為 null 時為「尚無分析結果」', () => {
    const plan = vestibulePlan()
    const report = clearance(plan)
    const harness = mount(plan, report)
    expect(el('report-summary').textContent).toBe(summaryText(countReport(report), m))

    harness.render(plan, null)
    expect(el('report-summary').textContent).toBe(m.report.empty)
    expect(rowTexts()).toHaveLength(0)
  })
})

describe('render：原地更新（D10 硬契約）', () => {
  it('同一份報告重繪兩次 → `<li>` 參考逐一不變', () => {
    const plan = vestibulePlan()
    const report = clearance(plan)
    const harness = mount(plan, report)

    const before = rowNodes()
    harness.render(plan, report)
    const after = rowNodes()

    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i])
  })

  it('列帶 `data-key` 與 `report-entry--{kind}` class', () => {
    const plan = vestibulePlan()
    mount(plan, clearance(plan))
    const first = rowNodes()[0]
    expect(first.getAttribute('data-key')).not.toBeNull()
    expect(first.getAttribute('class')).toContain('report-entry--')
  })

  it('不使用 innerHTML：原始碼（去註解後）無 HTML 字串注入 API', () => {
    // 註解裡會引述 PLAN §D7 的禁令字面，先剝掉註解再掃程式碼本體。
    const code = readFileSync(path.resolve(DIR, 'report-list.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
      expect(code.includes(banned), `report-list.ts 不得使用 ${banned}`).toBe(false)
    }
  })
})

describe('聚焦回路：點擊列上的鈕 → 選取＋聚焦畫布節點', () => {
  it('setUi({selectedId}) 與 focusBoardNode("item", id) 依序被呼叫', () => {
    const plan = vestibulePlan()
    const harness = mount(plan, clearance(plan))

    const button = document.querySelector<HTMLButtonElement>('#report-list button')
    expect(button).not.toBeNull()
    expect(button!.getAttribute('type')).toBe('button')
    expect(button!.getAttribute('aria-label')).toBe(button!.textContent)

    button!.click()
    expect(harness.setUiCalls).toContainEqual({ selectedId: 'W1' })
    expect(harness.focusCalls).toEqual([['item', 'W1']])
  })

  it('無聚焦目標的項目渲染為 `<span>`，不產生按鈕', () => {
    const plan = mkPlan()
    const report = emptyReport()
    report.corridors = [mkCorridor({ a: 'wall:0', b: 'frame:N' })]
    mount(plan, report)

    expect(document.querySelectorAll('#report-list button')).toHaveLength(0)
    expect(document.querySelectorAll('#report-list span')).toHaveLength(1)
  })
})

describe('分頁（OQ1＝20）：頁數、換頁、焦點與播報', () => {
  /** 45 筆 narrow 通道（各自對上一件真家具，故每筆都有聚焦目標）。 */
  function manyNarrow(): { plan: RoomPlan; report: ClearanceReport } {
    const items: Furniture[] = []
    const corridors: Corridor[] = []
    for (let i = 0; i < 45; i++) {
      items.push(mkFurniture({ id: `i${i}`, name: `家具${i}` }))
      corridors.push(mkCorridor({ a: `i${i}`, b: 'frame:N', segIndex: i }))
    }
    const report = emptyReport()
    report.corridors = corridors
    return { plan: mkPlan({ items }), report }
  }

  it('45 筆 → 3 頁；第一頁 20 列、prev 停用、next 可用', () => {
    const { plan, report } = manyNarrow()
    mount(plan, report)

    expect(REPORT_PAGE_SIZE).toBe(20)
    expect(rowTexts()).toHaveLength(20)
    expect(el('report-page-label').textContent).toBe(m.ui.list.pageLabel(1, 3))
    expect(el<HTMLButtonElement>('report-prev').disabled).toBe(true)
    expect(el<HTMLButtonElement>('report-next').disabled).toBe(false)
    expect(el('report-pager').hidden).toBe(false)
  })

  it('按「下一頁」→ setUi({reportPage:2})、焦點落在 `#report-list` 內、播報 pageChanged', () => {
    const { plan, report } = manyNarrow()
    const harness = mount(plan, report)

    el<HTMLButtonElement>('report-next').click()

    expect(harness.setUiCalls).toContainEqual({ reportPage: 2 })
    expect(el('report-page-label').textContent).toBe(m.ui.list.pageLabel(2, 3))
    expect(rowTexts()).toHaveLength(20)
    expect(el('report-list').contains(document.activeElement)).toBe(true)
    expect(harness.announced).toContain(m.status.pageChanged(2, 3))
  })

  it('末頁只有 5 列且 next 停用；prev 回第 2 頁', () => {
    const { plan, report } = manyNarrow()
    const harness = mount(plan, report)

    el<HTMLButtonElement>('report-next').click()
    el<HTMLButtonElement>('report-next').click()
    expect(rowTexts()).toHaveLength(5)
    expect(el<HTMLButtonElement>('report-next').disabled).toBe(true)

    el<HTMLButtonElement>('report-prev').click()
    expect(harness.ui.reportPage).toBe(2)
    expect(rowTexts()).toHaveLength(20)
  })

  it('筆數縮到一頁以內 → 頁碼夾回第 1 頁且分頁列隱藏', () => {
    const { plan, report } = manyNarrow()
    const harness = mount(plan, report)
    el<HTMLButtonElement>('report-next').click()
    expect(harness.ui.reportPage).toBe(2)

    const small = emptyReport()
    small.corridors = [mkCorridor({ a: 'i0', b: 'frame:N' })]
    harness.render(plan, small)

    expect(rowTexts()).toHaveLength(1)
    expect(el('report-page-label').textContent).toBe(m.ui.list.pageLabel(1, 1))
    expect(el('report-pager').hidden).toBe(true)
  })

  it('無可聚焦控件時換頁焦點落在 `#report-list` 自身（tabindex -1）', () => {
    const corridors: Corridor[] = []
    for (let i = 0; i < 25; i++) {
      corridors.push(mkCorridor({ a: 'wall:0', b: 'frame:N', segIndex: i }))
    }
    const report = emptyReport()
    report.corridors = corridors
    mount(mkPlan(), report)

    expect(el('report-list').getAttribute('tabindex')).toBe('-1')
    el<HTMLButtonElement>('report-next').click()
    expect(document.activeElement).toBe(el('report-list'))
  })
})

/* ------------------------------------------------------------------ *
 * 三、真頁面 boot：版位判準與 main.ts 的警示摘要播報
 * ------------------------------------------------------------------ */

type MainModule = typeof import('./main.js')

async function boot(): Promise<MainModule> {
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  return await import('./main.js')
}

function statusText(): string {
  return el('status').textContent ?? ''
}

function setValue(id: string, value: string): void {
  el<HTMLInputElement>(id).value = value
}

function addItem(name: string, width: number, depth: number, x: number, y: number): void {
  const radio = el<HTMLInputElement>('add-kind-item')
  radio.checked = true
  radio.dispatchEvent(new Event('change', { bubbles: true }))
  setValue('add-name', name)
  setValue('add-width', String(width))
  setValue('add-depth', String(depth))
  setValue('add-x', String(x))
  setValue('add-y', String(y))
  el('add-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

beforeEach(() => {
  localStorage.clear()
})

describe('版位判準：`report-list` 與畫布同分區（PLAN §Accessibility 共視）', () => {
  it('`#report-list` 的最近祖先分區為 `#board-section`', async () => {
    await boot()
    const list = document.getElementById('report-list')
    expect(list).not.toBeNull()
    expect(list!.closest('section')?.closest('#board-section')).not.toBeNull()
    expect(list!.closest('#board-section')).toBe(document.getElementById('board-section'))
    expect(list!.closest('#settings-section')).toBeNull()
    expect(list!.closest('#items-section')).toBeNull()
  })

  it('開機即寫摘要句（零警示），清單為空、分頁列隱藏', async () => {
    await boot()
    expect(el('report-summary').textContent).toBe(
      `${m.status.warningsSummary(0, 0, 0, 0)}；${m.report.summaryExtra(0, 0)}`,
    )
    expect(document.querySelectorAll('#report-list > li')).toHaveLength(0)
    expect(el('report-pager').hidden).toBe(true)
    // 開機不得播報警示摘要（沒有「上一步」可比）。
    expect(statusText()).toBe('')
  })
})

describe('main.ts：警示數只播報摘要，且與動作句併成一串（單一 live region）', () => {
  it('加入相距 50 cm 的第二件家具 → `#status` ＝「已加入 X；摘要」', async () => {
    await boot()

    addItem('甲', 40, 40, 0, 0)
    // 第一件不產生任何警示：四類計數未變，不追加摘要。
    expect(statusText()).toBe(m.status.itemAdded('甲'))

    addItem('乙', 40, 40, 90, 0)
    const summary = `${m.status.warningsSummary(1, 0, 0, 0)}；${m.report.summaryExtra(0, 0)}`
    expect(statusText()).toBe(`${m.status.itemAdded('乙')}；${summary}`)
    expect(statusText().startsWith(m.status.itemAdded('乙'))).toBe(true)
    expect(statusText().endsWith(summary)).toBe(true)

    // report-list 也同步列出那一筆過窄。
    expect(el('report-summary').textContent).toBe(summary)
    expect(
      Array.from(document.querySelectorAll('#report-list > li'), (li) => li.textContent ?? '').some(
        (text) => text.includes(m.report.level.narrow),
      ),
    ).toBe(true)
  })

  it('後續不改變警示數的動作不再追加摘要（不重複播報）', async () => {
    await boot()
    addItem('甲', 40, 40, 0, 0)
    addItem('乙', 40, 40, 90, 0)
    const afterSecond = statusText()

    // 切換「顯示迴旋區」：`settings/update` 不改四類警示數，`#status` 不動。
    el<HTMLButtonElement>('sw-swing').click()
    expect(statusText()).toBe(afterSecond)

    // 加入一件離群家具：有動作句、但警示數未變 → 沒有摘要後綴。
    addItem('丙', 10, 10, 200, 200)
    expect(statusText()).toBe(m.status.itemAdded('丙'))
    expect(statusText()).not.toContain(m.status.warningsSummary(1, 0, 0, 0))
  })

  it('復原回到零警示 → 復原句後綴摘要', async () => {
    await boot()
    addItem('甲', 40, 40, 0, 0)
    addItem('乙', 40, 40, 90, 0)

    el<HTMLButtonElement>('btn-undo').click()
    const summary = `${m.status.warningsSummary(0, 0, 0, 0)}；${m.report.summaryExtra(0, 0)}`
    expect(statusText()).toBe(`${m.status.undone}；${summary}`)
  })

  it('自存檔開機時不播報摘要（只對齊快照）', async () => {
    const plan = mkPlan({
      items: [
        mkFurniture({ id: 'a0', name: '甲', width: 40, depth: 40, x: 0, y: 0 }),
        mkFurniture({ id: 'a1', name: '乙', width: 40, depth: 40, x: 90, y: 0 }),
      ],
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
    await boot()

    expect(statusText()).toBe('')
    expect(el('report-summary').textContent).toBe(
      `${m.status.warningsSummary(1, 0, 0, 0)}；${m.report.summaryExtra(0, 0)}`,
    )
  })
})
