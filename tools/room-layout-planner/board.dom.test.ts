// @vitest-environment jsdom
/**
 * T2.2 回歸網（(internal design doc) §Verification jsdom
 * 「家具節點 role／name／僅一個 `tabindex="0"`」「名稱 `<img onerror>&"]]>`
 * 字面顯示、`svg.innerHTML` 不含 `<img`」、§D7「DOM 寫入不變量」、
 * §D10 render（key diff 不重建、標籤隱藏門檻 OQ2 定案、比例文字＝zoom
 * 倍率）、§D1 viewBox、§D2 拖移期 `<g transform>`、§D6 迴旋區開關）。
 *
 * 本檔**自建最小 SVG fixture**（`createElementNS`），不讀 `index.html`
 * ——lane A 的 `index.html` 與本檔同 sprint 併行中，測試只釘 `board.ts`
 * 消費的那份 DOM 契約（四圖層＋overlay 兩子群組＋`#zoom-label`）。
 *
 * jsdom 29.1.1 對 SVG 的已知缺口（PLAN §D2 實證）：無 `getScreenCTM`、
 * `getBoundingClientRect()` 恆全零——標籤隱藏門檻因此走
 * `labelScale()` 的純函式分支，以注入的 `getBoardRect` 造出真實比例。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createBoard,
  doorHitRect,
  labelLayout,
  labelScale,
  FIT_MARGIN_CM,
  type Board,
} from './board.js'
import { doorGeometry } from './door.js'
import type { BoardRect } from './geometry.js'
import { t } from './messages.js'
import type { Door, Furniture, RoomBlock, RoomPlan } from './model.js'
import type { DragState } from './reducer.js'
import { DEFAULT_UI, type UiState } from './ui-state.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MESSAGES = t()

// jsdom 環境下全域 `URL` 為 jsdom 實作，`fileURLToPath` 只認 node 自家的
// URL 實例（會擲 ERR_INVALID_URL_SCHEME），故沿 statusline 既有手法先轉
// 成字串路徑再 join。
const BOARD_SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'board.ts'),
  'utf-8',
)

/** T5.1：地板外框是 CSS 的事（jsdom 不套外部樣式），故以原始碼釘規則。 */
const STYLE_SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),
  'utf-8',
)

// ── fixture ──────────────────────────────────────────────────────────

function svgGroup(id: string): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('id', id)
  return group
}

/** lane A `index.html` 宣告的畫布骨架：四圖層＋overlay 拆 static／dynamic。 */
function buildDom(): { svg: SVGSVGElement; zoomLabel: HTMLElement } {
  document.body.textContent = ''
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('id', 'board-svg')
  svg.setAttribute('role', 'group')
  svg.setAttribute('aria-label', MESSAGES.ui.board.label)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('aria-describedby', 'board-hint')
  for (const id of ['layer-floor', 'layer-walls', 'layer-items', 'layer-doors']) {
    svg.appendChild(svgGroup(id))
  }
  const overlay = svgGroup('layer-overlay')
  overlay.appendChild(svgGroup('overlay-static'))
  overlay.appendChild(svgGroup('overlay-dynamic'))
  svg.appendChild(overlay)
  const zoomLabel = document.createElement('span')
  zoomLabel.id = 'zoom-label'
  document.body.appendChild(svg)
  document.body.appendChild(zoomLabel)
  return { svg, zoomLabel }
}

function furniture(over: Partial<Furniture> & { id: string }): Furniture {
  return {
    name: '床',
    color: '#9db4d6',
    width: 100,
    depth: 50,
    x: 10,
    y: 20,
    rotation: 0,
    passable: false,
    ...over,
  }
}

/** D9 玄關實例的凸出區：x∈[300,360]、y∈[0,270]。 */
const VESTIBULE_BLOCK: RoomBlock = { id: 'e1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }

/** D9 玄關實例的門：鉸鏈 (360,270)、`wall` 推導為 E、`leafDir:'-'`、寬 70、內開。 */
const VESTIBULE_DOOR: Door = { id: 'd1', x: 360, y: 270, wall: 'E', leafDir: '-', width: 70, swing: 'in' }

interface PlanOptions {
  width?: number
  depth?: number
  blocks?: RoomBlock[]
  doors?: Door[]
  items?: Furniture[]
  showSwing?: boolean
}

function planOf(options: PlanOptions = {}): RoomPlan {
  return {
    version: 1,
    room: {
      width: options.width ?? 300,
      depth: options.depth ?? 400,
      blocks: options.blocks ?? [],
      doors: options.doors ?? [],
    },
    items: options.items ?? [],
    settings: {
      ignoreBelow: 5,
      warnBelow: 60,
      adviseBelow: 75,
      snap: 5,
      showSwing: options.showSwing ?? true,
      maxItems: 20, // T4.7 軟上限：本檔不測上限行為，取預設值
    },
  }
}

function uiOf(over: Partial<UiState> = {}): UiState {
  return { ...DEFAULT_UI, ...over }
}

function rectOf(board: BoardRect): () => BoardRect {
  return () => board
}

function attrs(el: Element | null, names: readonly string[]): (string | null)[] {
  return names.map((name) => (el === null ? null : el.getAttribute(name)))
}

function tagChildren(parent: Element, localName: string): Element[] {
  const result: Element[] = []
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children.item(i)
    if (child !== null && child.localName === localName) result.push(child)
  }
  return result
}

let svg: SVGSVGElement
let zoomLabel: HTMLElement
let board: Board

beforeEach(() => {
  const dom = buildDom()
  svg = dom.svg
  zoomLabel = dom.zoomLabel
  board = createBoard({ svg, zoomLabel, messages: MESSAGES })
})

// ── a11y：roving tabindex ────────────────────────────────────────────

describe('roving tabindex（單一 Tab 停點）', () => {
  const items = [
    furniture({ id: 'a1' }),
    furniture({ id: 'a2', x: 120, y: 200 }),
    furniture({ id: 'a3', x: 20, y: 300 }),
  ]
  const plan = planOf({ items, blocks: [VESTIBULE_BLOCK], doors: [VESTIBULE_DOOR] })

  it('家具 3＋方塊 1＋門 1 共五個可拖移節點，DOM 序為家具→方塊→門', () => {
    board.renderCommit(plan, uiOf(), null)
    const nodes = board.draggableNodes()
    expect(nodes.map((n) => n.getAttribute('data-testid'))).toEqual([
      'item-a1',
      'item-a2',
      'item-a3',
      'block-e1',
      'door-d1',
    ])
  })

  it('無選中時恰一個 tabindex="0"，落在第一件家具', () => {
    board.renderCommit(plan, uiOf(), null)
    const nodes = board.draggableNodes()
    expect(nodes.filter((n) => n.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(nodes[0].getAttribute('tabindex')).toBe('0')
  })

  it('選中時停點移至該節點（門亦可），其餘一律 -1', () => {
    board.renderCommit(plan, uiOf({ selectedId: 'd1' }), null)
    const nodes = board.draggableNodes()
    expect(nodes.filter((n) => n.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(board.node('door', 'd1')?.getAttribute('tabindex')).toBe('0')
    expect(board.node('item', 'a1')?.getAttribute('tabindex')).toBe('-1')
    expect(board.node('door', 'd1')?.getAttribute('class')).toContain('is-selected')
  })

  it('已刪除家具不產生節點、不入 roving 序', () => {
    const withDeleted = planOf({
      items: [furniture({ id: 'a1' }), furniture({ id: 'gone', deleted: true })],
    })
    board.renderCommit(withDeleted, uiOf(), null)
    expect(board.node('item', 'gone')).toBeNull()
    expect(board.layers.items.children.length).toBe(1)
    expect(board.draggableNodes()).toHaveLength(1)
  })

  it('家具節點帶 role／roledescription／describedby／aria-label', () => {
    board.renderCommit(plan, uiOf(), null)
    const node = board.node('item', 'a1')
    expect(attrs(node, ['role', 'aria-roledescription', 'aria-describedby', 'aria-label'])).toEqual([
      'button',
      MESSAGES.ui.board.itemRoledescription,
      'board-hint',
      '床 100×50 cm，位置 10,20',
    ])
  })

  it('focus() 不擲錯（SVG `<g tabindex>` 焦點）', () => {
    board.renderCommit(plan, uiOf(), null)
    expect(() => {
      board.focus('item', 'a1')
    }).not.toThrow()
  })
})

// ── key diff：節點參考穩定 ───────────────────────────────────────────

describe('renderCommit key diff（原地更新、不重建）', () => {
  it('同一件家具移動後仍為同一個節點物件，rect 與 aria-label 已更新', () => {
    board.renderCommit(planOf({ items: [furniture({ id: 'a1' })] }), uiOf(), null)
    const node = board.node('item', 'a1')
    const rect = node === null ? null : node.children.item(0)
    board.renderCommit(planOf({ items: [furniture({ id: 'a1', x: 111, y: 33 })] }), uiOf(), null)
    expect(board.node('item', 'a1')).toBe(node)
    expect(node === null ? null : node.children.item(0)).toBe(rect)
    expect(attrs(rect, ['x', 'y', 'width', 'height'])).toEqual(['111', '33', '100', '50'])
    expect(node?.getAttribute('aria-label')).toBe('床 100×50 cm，位置 111,33')
  })

  it('旋轉 90° 後有效外框寬深互換並寫入 rect 與名稱', () => {
    board.renderCommit(
      planOf({ items: [furniture({ id: 'a1', width: 200, depth: 60, rotation: 90, x: 300, y: 0 })] }),
      uiOf(),
      null,
    )
    const rect = board.node('item', 'a1')?.children.item(0) ?? null
    expect(attrs(rect, ['x', 'y', 'width', 'height'])).toEqual(['300', '0', '60', '200'])
    expect(board.node('item', 'a1')?.getAttribute('aria-label')).toBe('床 60×200 cm，位置 300,0')
  })

  it('移除一件只刪該節點，新增一件附加於末尾，其餘參考不變', () => {
    const a1 = furniture({ id: 'a1' })
    const a2 = furniture({ id: 'a2', x: 150, y: 150 })
    board.renderCommit(planOf({ items: [a1, a2] }), uiOf(), null)
    const first = board.node('item', 'a1')
    const second = board.node('item', 'a2')

    board.renderCommit(planOf({ items: [a1] }), uiOf(), null)
    expect(board.node('item', 'a1')).toBe(first)
    expect(board.node('item', 'a2')).toBeNull()
    expect(board.layers.items.children.length).toBe(1)
    expect(second?.parentNode).toBeNull()

    const a3 = furniture({ id: 'a3', x: 5, y: 5 })
    board.renderCommit(planOf({ items: [a1, a3] }), uiOf(), null)
    expect(board.node('item', 'a1')).toBe(first)
    expect(board.layers.items.children.item(1)).toBe(board.node('item', 'a3'))
  })

  it('家具前景色由 src/lib/color.ts 自動取黑／白', () => {
    board.renderCommit(
      planOf({
        items: [
          furniture({ id: 'dark', color: '#111111' }),
          furniture({ id: 'light', color: '#eeeeee', x: 150 }),
        ],
      }),
      uiOf(),
      null,
    )
    expect(board.node('item', 'dark')?.children.item(1)?.getAttribute('fill')).toBe('#ffffff')
    expect(board.node('item', 'light')?.children.item(1)?.getAttribute('fill')).toBe('#000000')
  })
})

// ── DOM 寫入不變量（D7）──────────────────────────────────────────────

describe('DOM 寫入不變量（PLAN §D7）', () => {
  /**
   * PLAN 的驗收句為「名稱字面顯示、`svg.innerHTML` 不含 `<img`」。兩者在
   * `aria-label` 亦須承載同一份原始名稱的前提下不可能同時字面成立——HTML
   * 序列化規則對**屬性值**只轉義 `&` 與 `"`，不轉義 `<`（再剖析時 `<` 留在
   * 屬性值內、不會生成元素，故無注入風險）。因此本案把該句拆成三條各自
   * 精確、合起來更強的斷言：(1) 元素**內容**確實轉義（`&lt;img`）；
   * (2) 整份 DOM 不存在 `img` 元素，且序列化→再剖析亦不生成；(3) D7 PNG
   * 匯出真正走的 `XMLSerializer` 路徑（屬性值會轉義 `<`）全文不含 `<img`。
   */
  it('名稱中的標記字面顯示，序列化與再剖析皆不生成元素', () => {
    const name = '<img onerror>&"]]>'
    board.renderCommit(planOf({ items: [furniture({ id: 'x1', name })] }), uiOf(), null)
    const node = board.node('item', 'x1')
    const label = node?.children.item(1) ?? null
    expect(label?.textContent).toBe(name)
    expect(node?.getAttribute('aria-label')).toContain(name)

    expect(label?.innerHTML).toBe('&lt;img onerror&gt;&amp;"]]&gt;')
    expect(svg.querySelector('img')).toBeNull()

    const probe = document.createElement('div')
    probe.innerHTML = svg.innerHTML
    expect(probe.querySelector('img')).toBeNull()

    expect(new XMLSerializer().serializeToString(svg)).not.toContain('<img')
  })

  it('board.ts 原始碼不含任何字串 HTML 注入 API，建節點一律經 createElementNS', () => {
    expect(BOARD_SOURCE).not.toContain('innerHTML')
    expect(BOARD_SOURCE).not.toContain('insertAdjacentHTML')
    expect(BOARD_SOURCE).not.toContain('outerHTML')
    expect(BOARD_SOURCE).not.toContain('document.createElement(')
    expect(BOARD_SOURCE).toContain('document.createElementNS(')
  })

  it('DOM id 恆為 {kind}-{id} 前綴形（裸 id 不進 DOM）', () => {
    board.renderCommit(
      planOf({
        items: [furniture({ id: 'a1' })],
        blocks: [VESTIBULE_BLOCK],
        doors: [VESTIBULE_DOOR],
      }),
      uiOf(),
      null,
    )
    expect(board.draggableNodes().map((n) => n.getAttribute('id'))).toEqual([
      'item-a1',
      'block-e1',
      'door-d1',
    ])
  })
})

// ── viewBox／zoom（D1）───────────────────────────────────────────────

describe('viewBox 與 zoom 倍率（PLAN §D1／§D10；T5.1 fit 邊距）', () => {
  const plan = planOf({ blocks: [VESTIBULE_BLOCK], items: [furniture({ id: 'a1' })] })

  it('玄關房（含凸出區）fit 後 viewBox ＝ 外接框＋FIT_MARGIN_CM 邊距', () => {
    board.renderCommit(plan, uiOf(), null)
    // 外接框 0 0 360 400，四周各留 24 cm 給尺寸標註 → -24 -24 408 448。
    expect(FIT_MARGIN_CM).toBe(24)
    expect(svg.getAttribute('viewBox')).toBe('-24 -24 408 448')
    // `getBounds()` 與 viewBox 同口徑（io-png 契約）；未加邊距的框走 `getRoomBounds()`。
    expect(board.getBounds()).toEqual({ x0: -24, y0: -24, x1: 384, y1: 424 })
    expect(board.getRoomBounds()).toEqual({ x0: 0, y0: 0, x1: 360, y1: 400 })
    expect(zoomLabel.textContent).toBe('100%')
  })

  it('zoom 2 以中心為軸對半，倍率文字 200%；fit 還原', () => {
    board.renderCommit(plan, uiOf(), null)
    board.setView(2, 0, 0)
    // 加邊距後的框中心 (180,200)、半寬 102／半高 112。
    expect(svg.getAttribute('viewBox')).toBe('78 88 204 224')
    expect(board.getViewBox()).toEqual({ minX: 78, minY: 88, w: 204, h: 224 })
    expect(zoomLabel.textContent).toBe('200%')
    board.fit()
    expect(svg.getAttribute('viewBox')).toBe('-24 -24 408 448')
    expect(zoomLabel.textContent).toBe('100%')
  })

  it('pan 以 cm 平移 viewBox 原點', () => {
    board.renderCommit(plan, uiOf(), null)
    board.setView(1, 40, -25)
    expect(svg.getAttribute('viewBox')).toBe('16 -49 408 448')
  })

  it('renderCommit 依 ui 的 zoom／pan 套用 viewBox', () => {
    board.renderCommit(plan, uiOf({ zoom: 2, panX: 10, panY: 0 }), null)
    expect(svg.getAttribute('viewBox')).toBe('88 88 204 224')
    expect(zoomLabel.textContent).toBe('200%')
  })
})

// ── 拖曳中凍結 viewBox（T3.4c，PLAN §D1／§D2）───────────────────────

describe('拖曳中凍結 viewBox（外接框變大也不重新 fit，放開才 fit）', () => {
  function draggingOf(origin: RoomPlan, over: Partial<DragState> = {}): DragState {
    return { id: 'e1', kind: 'block', source: 'keyboard', origin, cancelled: false, ...over }
  }

  it('ui.dragging 非 null：bounds 隨外接框更新，viewBox 屬性維持前一次提交的值', () => {
    const plan = planOf({ items: [furniture({ id: 'a1' })] })
    board.renderCommit(plan, uiOf(), null)
    expect(svg.getAttribute('viewBox')).toBe('-24 -24 348 448')

    // 拖曳期間外接框因凸出區而變大（300×400 → 360×400）。
    const grown = planOf({ items: [furniture({ id: 'a1' })], blocks: [VESTIBULE_BLOCK] })
    board.renderCommit(grown, uiOf({ dragging: draggingOf(plan) }), null)

    // (c) getRoomBounds() 拖曳中即反映新外接框。
    expect(board.getRoomBounds()).toEqual({ x0: 0, y0: 0, x1: 360, y1: 400 })
    // (a) viewBox 屬性凍結，仍是拖曳前那一次提交的值。
    expect(svg.getAttribute('viewBox')).toBe('-24 -24 348 448')
    expect(zoomLabel.textContent).toBe('100%')
  })

  it('ui.dragging 回 null：同一份外接框才依本幀 viewBox 重新 fit', () => {
    const plan = planOf({ items: [furniture({ id: 'a1' })] })
    board.renderCommit(plan, uiOf(), null)
    const grown = planOf({ items: [furniture({ id: 'a1' })], blocks: [VESTIBULE_BLOCK] })
    board.renderCommit(grown, uiOf({ dragging: draggingOf(plan) }), null)
    expect(svg.getAttribute('viewBox')).toBe('-24 -24 348 448')

    // (b) 放開（dragging 歸零）→ fit 到新外接框。
    board.renderCommit(grown, uiOf(), null)
    expect(svg.getAttribute('viewBox')).toBe('-24 -24 408 448')
    expect(board.getRoomBounds()).toEqual({ x0: 0, y0: 0, x1: 360, y1: 400 })
  })

  it('凍結期間仍以（凍結中的）viewBox 重跑標籤隱藏門檻，不因外接框變大而誤判', () => {
    const stubbed = createBoard({
      svg,
      zoomLabel,
      messages: MESSAGES,
      getBoardRect: rectOf({ left: 0, top: 0, width: 800, height: 600 }),
    })
    const plan = planOf({ items: [furniture({ id: 'a1' })] })
    stubbed.renderCommit(plan, uiOf(), null)
    expect(stubbed.node('item', 'a1')?.children.item(1)?.getAttribute('visibility')).toBeNull()

    // 外接框大幅放大足以讓字級掉到隱藏門檻以下，但拖曳中仍套用凍結的
    // （較小的）viewBox，故標籤仍可見；直到放開才會依新外接框重算。
    const hugeBlock: RoomBlock = { id: 'e1', kind: 'extend', x: 300, y: 0, width: 4700, depth: 1 }
    const grown = planOf({ items: [furniture({ id: 'a1' })], blocks: [hugeBlock] })
    stubbed.renderCommit(grown, uiOf({ dragging: draggingOf(plan) }), null)
    expect(stubbed.node('item', 'a1')?.children.item(1)?.getAttribute('visibility')).toBeNull()
  })
})

// ── 標籤隱藏門檻（OQ2 定案）──────────────────────────────────────────

describe('標籤隱藏門檻（OQ2：fontSize × scale < 9 px）', () => {
  function labelOf(b: Board, id: string): Element | null {
    return b.node('item', id)?.children.item(1) ?? null
  }

  it('jsdom 量不到畫布尺寸（寬 0）時比例視為 1，標籤可見', () => {
    board.renderCommit(planOf({ items: [furniture({ id: 'a1' })] }), uiOf(), null)
    expect(labelOf(board, 'a1')?.getAttribute('visibility')).toBeNull()
    expect(labelScale(svg, { left: 0, top: 0, width: 0, height: 0 }, { minX: 0, minY: 0, w: 300, h: 400 })).toBe(1)
  })

  it('1×5000 極端房在 800×600 畫布上比例 0.12（字級 1.44 px）→ 標籤隱藏', () => {
    const stubbed = createBoard({
      svg,
      zoomLabel,
      messages: MESSAGES,
      getBoardRect: rectOf({ left: 0, top: 0, width: 800, height: 600 }),
    })
    stubbed.renderCommit(
      planOf({ width: 1, depth: 5000, items: [furniture({ id: 'a1', width: 1, depth: 10, x: 0, y: 0 })] }),
      uiOf(),
      null,
    )
    expect(svg.getAttribute('viewBox')).toBe('-24 -24 49 5048')
    expect(labelScale(svg, { left: 0, top: 0, width: 800, height: 600 }, { minX: 0, minY: 0, w: 1, h: 5000 })).toBeCloseTo(0.12, 10)
    expect(labelOf(stubbed, 'a1')?.getAttribute('visibility')).toBe('hidden')
  })

  it('300×400 房 fit 於 800×600 畫布（字級 18 px）→ 標籤可見，放大後仍可見', () => {
    const stubbed = createBoard({
      svg,
      zoomLabel,
      messages: MESSAGES,
      getBoardRect: rectOf({ left: 0, top: 0, width: 800, height: 600 }),
    })
    stubbed.renderCommit(planOf({ items: [furniture({ id: 'a1' })] }), uiOf(), null)
    expect(labelOf(stubbed, 'a1')?.getAttribute('visibility')).toBeNull()
    stubbed.setView(2, 0, 0)
    expect(labelOf(stubbed, 'a1')?.getAttribute('visibility')).toBeNull()
  })

  it('縮到字級 < 9 px 後再 fit，隱藏屬性被移除（非單向）', () => {
    const stubbed = createBoard({
      svg,
      zoomLabel,
      messages: MESSAGES,
      getBoardRect: rectOf({ left: 0, top: 0, width: 800, height: 600 }),
    })
    stubbed.renderCommit(planOf({ items: [furniture({ id: 'a1' })] }), uiOf(), null)
    stubbed.setView(0.25, 0, 0)
    expect(labelOf(stubbed, 'a1')?.getAttribute('visibility')).toBe('hidden')
    stubbed.fit()
    expect(labelOf(stubbed, 'a1')?.getAttribute('visibility')).toBeNull()
  })
})

// ── 拖移期 transform（D2）───────────────────────────────────────────

describe('renderDrag／clearDrag（PLAN §D2 拖移期以 <g transform> 位移）', () => {
  const plan = planOf({ items: [furniture({ id: 'a1' })], blocks: [VESTIBULE_BLOCK] })

  it('位移為相對已提交座標的 translate，並加上 is-dragging', () => {
    board.renderCommit(plan, uiOf(), null)
    board.renderDrag('a1', 'item', 30, 45)
    const node = board.node('item', 'a1')
    expect(node?.getAttribute('transform')).toBe('translate(20 25)')
    expect(node?.getAttribute('class')).toContain('is-dragging')
    // 提交座標未回寫（D2：commit 才回寫 x/y 與 aria-label）。
    expect(node?.children.item(0)?.getAttribute('x')).toBe('10')
    expect(node?.getAttribute('aria-label')).toBe('床 100×50 cm，位置 10,20')
  })

  it('clearDrag 清掉 transform 與 is-dragging', () => {
    board.renderCommit(plan, uiOf(), null)
    board.renderDrag('a1', 'item', 30, 45)
    board.clearDrag('a1')
    const node = board.node('item', 'a1')
    expect(node?.getAttribute('transform')).toBeNull()
    expect(node?.getAttribute('class')).toBe('node node--item')
  })

  it('方塊亦可拖移；renderCommit 一律清掉殘留的 transform', () => {
    board.renderCommit(plan, uiOf(), null)
    board.renderDrag('e1', 'block', 280, 10)
    expect(board.node('block', 'e1')?.getAttribute('transform')).toBe('translate(-20 10)')
    board.renderCommit(plan, uiOf(), null)
    expect(board.node('block', 'e1')?.getAttribute('transform')).toBeNull()
    expect(board.node('block', 'e1')?.getAttribute('class')).toBe('node node--block block--extend')
  })

  it('不存在的 id 不擲錯', () => {
    board.renderCommit(plan, uiOf(), null)
    expect(() => {
      board.renderDrag('nope', 'item', 1, 2)
      board.clearDrag('nope')
    }).not.toThrow()
  })
})

// ── 地板／牆體／方塊／門（D9／D6）────────────────────────────────────

describe('圖層內容（PLAN §D9 normalize／§D6 門）', () => {
  const plan = planOf({ blocks: [VESTIBULE_BLOCK], doors: [VESTIBULE_DOOR] })

  it('玄關房牆體唯一一條 [300,360]×[270,400]，地板兩條，方塊節點排在地板矩形之後', () => {
    board.renderCommit(plan, uiOf(), null)
    const walls = tagChildren(board.layers.walls, 'rect')
    expect(walls).toHaveLength(1)
    expect(attrs(walls[0], ['x', 'y', 'width', 'height', 'class'])).toEqual([
      '300',
      '270',
      '60',
      '130',
      'wall',
    ])
    expect(tagChildren(board.layers.floor, 'rect')).toHaveLength(2)
    expect(board.layers.floor.children.item(2)).toBe(board.node('block', 'e1'))
  })

  it('房間縮小後牆體矩形池原地縮減（不整批重建）', () => {
    board.renderCommit(plan, uiOf(), null)
    const floorFirst = board.layers.floor.children.item(0)
    board.renderCommit(planOf(), uiOf(), null)
    expect(tagChildren(board.layers.walls, 'rect')).toHaveLength(0)
    expect(tagChildren(board.layers.floor, 'rect')).toHaveLength(1)
    expect(board.layers.floor.children.item(0)).toBe(floorFirst)
    expect(attrs(floorFirst, ['x', 'y', 'width', 'height'])).toEqual(['0', '0', '300', '400'])
  })

  it('方塊節點：role／aria-label／kind class', () => {
    board.renderCommit(plan, uiOf(), null)
    const node = board.node('block', 'e1')
    expect(attrs(node, ['role', 'aria-label', 'class'])).toEqual([
      'button',
      '凸出區 60×270 cm，位置 300,0',
      'node node--block block--extend',
    ])
  })

  it('門節點：門扇線段依推導後的牆側（E）擺放，可及名稱含寬度／牆／開向', () => {
    board.renderCommit(plan, uiOf(), null)
    const node = board.node('door', 'd1')
    expect(node?.getAttribute('aria-label')).toBe('門 70 cm，東牆，內開')
    expect(node?.getAttribute('class')).toBe('node node--door')
    expect(attrs(node?.querySelector('.door-leaf') ?? null, ['x1', 'y1', 'x2', 'y2'])).toEqual([
      '360',
      '200',
      '360',
      '270',
    ])
  })

  it('showSwing 開時迴旋區扇形進 overlay-static（key swing-<id>），關時消失', () => {
    board.renderCommit(plan, uiOf(), null)
    const arc = board.layers.overlayStatic.querySelector('[data-testid="swing-d1"]')
    expect(arc?.getAttribute('d')).toBe('M 360 270 L 360 200 A 70 70 0 0 0 290 270 Z')
    expect(board.layers.overlayDynamic.children.length).toBe(0)

    board.renderCommit(planOf({ blocks: [VESTIBULE_BLOCK], doors: [VESTIBULE_DOOR], showSwing: false }), uiOf(), null)
    // 尺寸標註（T5.1）同住這一層，故以 class 計數而非子節點總數。
    expect(board.layers.overlayStatic.querySelectorAll('.door-swing')).toHaveLength(0)
    expect(board.node('door', 'd1')).not.toBeNull()
  })

  it('未附著的門（鉸鏈不在任何極大牆段上）標 is-unattached 且不畫迴旋區', () => {
    const stray: Door = { id: 'd9', x: 50, y: 50, wall: 'N', leafDir: '+', width: 80, swing: 'in' }
    board.renderCommit(planOf({ doors: [stray] }), uiOf(), null)
    expect(board.node('door', 'd9')?.getAttribute('class')).toContain('is-unattached')
    expect(board.layers.overlayStatic.querySelectorAll('.door-swing')).toHaveLength(0)
    // 未附著的門不標門寬（幾何不可信），但命中區照給——拖回牆上是使用者要做的事。
    expect(board.layers.overlayStatic.querySelectorAll('.dim-text')).toHaveLength(2)
    expect(board.node('door', 'd9')?.querySelectorAll('.door-hit')).toHaveLength(2)
  })
})

// ── T5.2 門命中區 ────────────────────────────────────────────────────

describe('門命中區（T5.2：迴旋區扇形＋門扇加厚帶，屬 node--door）', () => {
  const plan = planOf({ blocks: [VESTIBULE_BLOCK], doors: [VESTIBULE_DOOR] })

  it('門節點內含兩塊命中形，且排在可見門扇之前', () => {
    board.renderCommit(plan, uiOf(), null)
    const node = board.node('door', 'd1')
    const parts: (string | null)[] = []
    for (let i = 0; i < (node?.children.length ?? 0); i++) {
      parts.push(node?.children.item(i)?.getAttribute('data-part') ?? null)
    }
    expect(parts).toEqual(['hit-swing', 'hit-leaf', 'leaf', 'hinge'])
  })

  it('扇形命中區的 d 自鉸鏈起算，與 overlay 的可見扇形同式', () => {
    board.renderCommit(plan, uiOf(), null)
    const sector = board.node('door', 'd1')?.querySelector('[data-part="hit-swing"]')
    expect(sector?.getAttribute('class')).toBe('door-hit door-hit--swing')
    expect(sector?.getAttribute('d')).toBe('M 360 270 L 360 200 A 70 70 0 0 0 290 270 Z')
  })

  it('門扇帶為 x∈[348,360]、y∈[200,270]（東牆往室內加厚 12 cm）', () => {
    board.renderCommit(plan, uiOf(), null)
    const band = board.node('door', 'd1')?.querySelector('[data-part="hit-leaf"]')
    expect(attrs(band ?? null, ['x', 'y', 'width', 'height'])).toEqual(['348', '200', '12', '70'])
    // 純函式與 DOM 同一口徑。
    expect(doorHitRect(doorGeometry(VESTIBULE_DOOR))).toEqual({
      x0: 348,
      y0: 200,
      x1: 360,
      y1: 270,
    })
  })

  it('關掉「顯示迴旋區」後命中區仍在（開關只管畫不畫可見 arc）', () => {
    board.renderCommit(
      planOf({ blocks: [VESTIBULE_BLOCK], doors: [VESTIBULE_DOOR], showSwing: false }),
      uiOf(),
      null,
    )
    const node = board.node('door', 'd1')
    expect(node?.querySelectorAll('.door-hit')).toHaveLength(2)
    expect(node?.querySelector('[data-part="hit-swing"]')?.getAttribute('d')).toBe(
      'M 360 270 L 360 200 A 70 70 0 0 0 290 270 Z',
    )
  })

  it('鉸鏈點畫在 (360,270)；命中形原地更新、節點與子部件參考不變', () => {
    board.renderCommit(plan, uiOf(), null)
    const node = board.node('door', 'd1')
    const sector = node?.querySelector('[data-part="hit-swing"]') ?? null
    expect(attrs(node?.querySelector('[data-part="hinge"]') ?? null, ['cx', 'cy'])).toEqual([
      '360',
      '270',
    ])

    const moved: Door = { ...VESTIBULE_DOOR, y: 240 }
    board.renderCommit(planOf({ blocks: [VESTIBULE_BLOCK], doors: [moved] }), uiOf(), null)
    expect(board.node('door', 'd1')).toBe(node)
    expect(node?.querySelector('[data-part="hit-swing"]')).toBe(sector)
    expect(sector?.getAttribute('d')).toBe('M 360 240 L 360 170 A 70 70 0 0 0 290 240 Z')
    expect(
      attrs(node?.querySelector('[data-part="hit-leaf"]') ?? null, ['x', 'y', 'width', 'height']),
    ).toEqual(['348', '170', '12', '70'])
  })
})

// ── T5.1 房間尺寸標註 ────────────────────────────────────────────────

describe('房間尺寸標註（T5.1：overlay-static、key 差集、OQ2 門檻）', () => {
  function dimTexts(): string[] {
    return Array.from(board.layers.overlayStatic.querySelectorAll('.dim-text')).map(
      (el) => el.textContent ?? '',
    )
  }

  it('純矩形房恰兩筆：北緣寬度與西緣深度', () => {
    board.renderCommit(planOf(), uiOf(), null)
    expect(dimTexts()).toEqual(['300 cm', '400 cm'])
    const width = board.layers.overlayStatic.querySelector('[data-testid="dim-w"]')
    // 尺寸線在北緣上方 12 cm，兩端各一道短刻度（單一 <path>）。
    expect(width?.querySelector('[data-part="line"]')?.getAttribute('d')).toBe(
      'M 0 -12 L 300 -12 M 0 -15 L 0 -9 M 300 -15 L 300 -9',
    )
    expect(attrs(width?.querySelector('[data-part="text"]') ?? null, ['x', 'y'])).toEqual([
      '150',
      '-18',
    ])
    const depth = board.layers.overlayStatic.querySelector('[data-testid="dim-d"]')
    expect(depth?.querySelector('[data-part="text"]')?.getAttribute('transform')).toBe(
      'rotate(-90 -18 200)',
    )
  })

  it('每個方塊加一筆「寬×深」、每扇合法門加一筆門寬', () => {
    board.renderCommit(
      planOf({ blocks: [VESTIBULE_BLOCK], doors: [VESTIBULE_DOOR] }),
      uiOf(),
      null,
    )
    expect(dimTexts()).toEqual(['360 cm', '400 cm', '60×270', '70'])
    // 門寬標在門扇往室內 6 cm 處（東牆 → −x）。
    expect(
      attrs(
        board.layers.overlayStatic.querySelector('[data-testid="dim-door-d1"] [data-part="text"]'),
        ['x', 'y'],
      ),
    ).toEqual(['354', '235'])
    // T5.5b：方塊標籤釘在方塊左上角內推 4 cm（不再置中），避免與塞滿方塊
    // 的家具標籤重疊；`text-anchor="start"`、`dominant-baseline="hanging"`。
    const blockText = board.layers.overlayStatic.querySelector(
      '[data-testid="dim-block-e1"] [data-part="text"]',
    )
    expect(attrs(blockText, ['x', 'y'])).toEqual(['304', '4'])
    expect(attrs(blockText, ['text-anchor', 'dominant-baseline'])).toEqual(['start', 'hanging'])
  })

  it('房間／門的尺寸文字維持置中錨點（text-anchor="middle"）', () => {
    board.renderCommit(planOf({ doors: [VESTIBULE_DOOR], blocks: [] }), uiOf(), null)
    const widthText = board.layers.overlayStatic.querySelector('[data-testid="dim-w"] [data-part="text"]')
    expect(attrs(widthText, ['text-anchor', 'dominant-baseline'])).toEqual(['middle', 'middle'])
  })

  it('方塊標籤錨點被家具有效外框覆蓋時 visibility=hidden；未覆蓋則可見', () => {
    // 玄關凸出區 x∈[300,360]、y∈[0,270]，錨點在 (304,4)——塞滿方塊的衣櫃
    // 覆蓋此點時標籤該隱藏；家具挪開後標籤該回復可見。
    const wardrobe = furniture({ id: 'w1', name: '衣櫃', width: 60, depth: 270, x: 300, y: 0 })
    board.renderCommit(planOf({ blocks: [VESTIBULE_BLOCK], items: [wardrobe] }), uiOf(), null)
    const blockText = board.layers.overlayStatic.querySelector(
      '[data-testid="dim-block-e1"] [data-part="text"]',
    )
    expect(blockText?.getAttribute('visibility')).toBe('hidden')

    const movedAway = { ...wardrobe, x: 0, y: 0 }
    board.renderCommit(planOf({ blocks: [VESTIBULE_BLOCK], items: [movedAway] }), uiOf(), null)
    const blockText2 = board.layers.overlayStatic.querySelector(
      '[data-testid="dim-block-e1"] [data-part="text"]',
    )
    expect(blockText2?.getAttribute('visibility')).toBeNull()
  })

  it('已刪除家具不參與覆蓋判定：標籤仍可見', () => {
    const deletedWardrobe = furniture({
      id: 'w1',
      name: '衣櫃',
      width: 60,
      depth: 270,
      x: 300,
      y: 0,
      deleted: true,
    })
    board.renderCommit(planOf({ blocks: [VESTIBULE_BLOCK], items: [deletedWardrobe] }), uiOf(), null)
    const blockText = board.layers.overlayStatic.querySelector(
      '[data-testid="dim-block-e1"] [data-part="text"]',
    )
    expect(blockText?.getAttribute('visibility')).toBeNull()
  })

  it('key 差集：房間改尺寸只改屬性，節點參考不變；方塊移除則該筆離場', () => {
    board.renderCommit(planOf({ blocks: [VESTIBULE_BLOCK] }), uiOf(), null)
    const widthNode = board.layers.overlayStatic.querySelector('[data-testid="dim-w"]')
    const blockNode = board.layers.overlayStatic.querySelector('[data-testid="dim-block-e1"]')
    expect(blockNode).not.toBeNull()
    expect(widthNode?.getAttribute('data-key')).toBe('dim|w')

    board.renderCommit(planOf({ width: 500 }), uiOf(), null)
    expect(board.layers.overlayStatic.querySelector('[data-testid="dim-w"]')).toBe(widthNode)
    expect(dimTexts()).toEqual(['500 cm', '400 cm'])
    expect(blockNode?.parentNode).toBeNull()
  })

  it('字級低於 OQ2 門檻時數值文字隱藏，放大後回復', () => {
    const stubbed = createBoard({
      svg,
      zoomLabel,
      messages: MESSAGES,
      getBoardRect: rectOf({ left: 0, top: 0, width: 800, height: 600 }),
    })
    stubbed.renderCommit(planOf(), uiOf(), null)
    const text = svg.querySelector('[data-testid="dim-w"] [data-part="text"]')
    expect(text?.getAttribute('visibility')).toBeNull()
    stubbed.setView(0.25, 0, 0)
    expect(text?.getAttribute('visibility')).toBe('hidden')
    stubbed.fit()
    expect(text?.getAttribute('visibility')).toBeNull()
  })

  it('標註層沿用 layer-overlay 的 aria-hidden（不另外進 a11y tree）', () => {
    board.renderCommit(planOf(), uiOf(), null)
    const layer = svg.querySelector('#layer-overlay')
    expect(layer?.getAttribute('aria-hidden')).toBe('true')
    expect(
      board.layers.overlayStatic.querySelector('[data-testid="dim-w"]')?.getAttribute('aria-hidden'),
    ).toBeNull()
  })
})

// ── T5.1 地板對比與外框（CSS 契約）──────────────────────────────────

describe('地板／牆體填色與外框（T5.1，M5 回饋 5）', () => {
  it('地板與牆體矩形帶 class，供 CSS 上色描邊', () => {
    board.renderCommit(planOf({ blocks: [VESTIBULE_BLOCK] }), uiOf(), null)
    expect(tagChildren(board.layers.floor, 'rect')[0].getAttribute('class')).toBe('floor')
    expect(tagChildren(board.layers.walls, 'rect')[0].getAttribute('class')).toBe('wall')
  })

  it('style.css 的 .floor 有外框 stroke，且雙主題各宣告 --rlp-floor／--rlp-outline', () => {
    const floorRule = /\.floor\s*\{([^}]*)\}/.exec(STYLE_SOURCE)?.[1] ?? ''
    expect(floorRule).toContain('fill: var(--rlp-floor)')
    expect(floorRule).toContain('stroke: var(--rlp-outline)')
    expect(floorRule).toContain('vector-effect: non-scaling-stroke')
    // 地板不得再等於頁面底色（回饋 5：深淺主題皆幾乎同色）。
    expect(STYLE_SOURCE).not.toContain('--rlp-floor: var(--surface-dim)')
    // 深色兩個區塊（@media 與 data-theme）都要宣告，值須一致。
    expect(STYLE_SOURCE.match(/--rlp-floor: #1c2430/g)).toHaveLength(2)
    expect(STYLE_SOURCE.match(/--rlp-outline: #8b95a5/g)).toHaveLength(2)
  })

  it('overlay 整層不吃指標事件（否則迴旋區 arc 蓋住門的命中區）', () => {
    expect(/#layer-overlay\s*\{[^}]*pointer-events:\s*none/.test(STYLE_SOURCE)).toBe(true)
  })

  it('門命中區樣式：透明填色＋pointer-events: all＋cursor: move', () => {
    const rule = /\.door-hit\s*\{([^}]*)\}/.exec(STYLE_SOURCE)?.[1] ?? ''
    expect(rule).toContain('fill: transparent')
    expect(rule).toContain('pointer-events: all')
    expect(rule).toContain('cursor: move')
  })
})

// ── T5.1 家具標籤溢出（純函式表）────────────────────────────────────

describe('labelLayout（T5.1，M5 回饋 7：名稱寬於家具）', () => {
  // 估寬 ＝ fontSize ×（CJK/全形 1、其餘 0.55）；左右各留 4 cm。
  it('「書桌」12 px 於 120×60 → normal（估寬 24 ≤ 可用 112）', () => {
    expect(labelLayout('書桌', 120, 60, 12)).toEqual({ mode: 'normal' })
  })

  it('「衣櫃（開門式）」於 60×200 → vertical（估寬 84 > 52，但 ≤ 直放的 192）', () => {
    expect(labelLayout('衣櫃（開門式）', 60, 200, 12)).toEqual({ mode: 'vertical', rotate: -90 })
  })

  it('「衣櫃（開門式）」於 60×60 → squeeze：52/84 ＝ 0.619 ≥ 0.6，textLength 52', () => {
    expect(labelLayout('衣櫃（開門式）', 60, 60, 12)).toEqual({ mode: 'squeeze', textLength: 52 })
  })

  it('ASCII「Desk」於 30×20 → squeeze：估寬 4×0.55×12 ＝ 26.4、可用 22、比值 0.833', () => {
    // 派工單列的期望是 hidden，但同一單給的公式算出來是 squeeze（0.833 ≥ 0.6）。
    // 依「公式為準、數字寫進測試」處理，另補一筆真正壓不下去的案例。
    expect(labelLayout('Desk', 30, 20, 12)).toEqual({ mode: 'squeeze', textLength: 22 })
  })

  it('ASCII「Desk」於 20×12 → hidden（可用 12／估寬 26.4 ＝ 0.45 < 0.6）', () => {
    expect(labelLayout('Desk', 20, 12, 12)).toEqual({ mode: 'hidden' })
  })

  it('高瘦且壓縮後仍直放（rotate −90 與 textLength 並存）', () => {
    // 60×100：估寬 84 > 可用寬 52、> 可用高 92？ 84 ≤ 92 → vertical；
    // 改用 60×90（可用高 82 < 84）→ squeeze 且直放，textLength 82。
    expect(labelLayout('衣櫃（開門式）', 60, 90, 12)).toEqual({
      mode: 'squeeze',
      textLength: 82,
      rotate: -90,
    })
  })

  it('空名稱視為 normal（不生任何屬性）', () => {
    expect(labelLayout('', 10, 10, 12)).toEqual({ mode: 'normal' })
  })
})

describe('家具標籤四態寫進 DOM（T5.1）', () => {
  function labelOf(id: string): Element | null {
    return board.node('item', id)?.children.item(1) ?? null
  }

  it('normal：無 transform／textLength，且 data-fit 記錄態', () => {
    board.renderCommit(planOf({ items: [furniture({ id: 'a1', name: '書桌' })] }), uiOf(), null)
    const label = labelOf('a1')
    expect(label?.getAttribute('data-fit')).toBe('normal')
    expect(label?.getAttribute('transform')).toBeNull()
    expect(label?.getAttribute('textLength')).toBeNull()
    expect(label?.getAttribute('visibility')).toBeNull()
  })

  it('vertical：繞有效外框中心 −90°', () => {
    board.renderCommit(
      planOf({
        items: [
          furniture({ id: 'a1', name: '衣櫃（開門式）', width: 60, depth: 200, x: 0, y: 0 }),
        ],
      }),
      uiOf(),
      null,
    )
    const label = labelOf('a1')
    expect(label?.getAttribute('data-fit')).toBe('vertical')
    expect(label?.getAttribute('transform')).toBe('rotate(-90 30 100)')
  })

  it('squeeze：textLength＋lengthAdjust；hidden：visibility 但 aria-label 完整', () => {
    board.renderCommit(
      planOf({
        items: [
          furniture({ id: 'sq', name: '衣櫃（開門式）', width: 60, depth: 60, x: 0, y: 0 }),
          furniture({ id: 'hd', name: 'Desk', width: 20, depth: 12, x: 200, y: 0 }),
        ],
      }),
      uiOf(),
      null,
    )
    expect(labelOf('sq')?.getAttribute('textLength')).toBe('52')
    expect(labelOf('sq')?.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs')
    expect(labelOf('hd')?.getAttribute('data-fit')).toBe('hidden')
    expect(labelOf('hd')?.getAttribute('visibility')).toBe('hidden')
    expect(labelOf('hd')?.textContent).toBe('Desk')
    expect(board.node('item', 'hd')?.getAttribute('aria-label')).toBe('Desk 20×12 cm，位置 200,0')
  })

  it('尺寸放大回得去：squeeze → normal 時屬性被移除', () => {
    board.renderCommit(
      planOf({ items: [furniture({ id: 'a1', name: '衣櫃（開門式）', width: 60, depth: 60 })] }),
      uiOf(),
      null,
    )
    expect(labelOf('a1')?.getAttribute('textLength')).toBe('52')
    board.renderCommit(
      planOf({ items: [furniture({ id: 'a1', name: '衣櫃（開門式）', width: 200, depth: 60 })] }),
      uiOf(),
      null,
    )
    expect(labelOf('a1')?.getAttribute('textLength')).toBeNull()
    expect(labelOf('a1')?.getAttribute('lengthAdjust')).toBeNull()
    expect(labelOf('a1')?.getAttribute('data-fit')).toBe('normal')
  })
})
