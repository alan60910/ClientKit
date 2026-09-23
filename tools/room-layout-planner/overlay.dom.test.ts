// @vitest-environment jsdom
/**
 * T3.1 回歸網（(internal design doc) §Verification jsdom
 * 「switch→overlay 子節點增減；閾值變更→重算」、§D3 四段呈現、§D4 門洞／
 * `suppressed`、§D5 各面需留、§D7「DOM 寫入不變量」、§D9 玄關實例與反向案
 * (a)(b)、§D10 render（key 差集、原地更新硬契約、OQ5 單一多段 `<path>`、
 * 標籤隱藏門檻）、§Frontend Accessibility「overlay `aria-hidden`」）。
 *
 * 報告一律由**真的** `clearance(plan)` 產出（不手捏 report），故本檔同時是
 * 「引擎輸出 → 畫面呈現」這條接線的回歸網；幾何期望值取自 PLAN §D9 釘死的
 * 玄關實例與其反向案。
 *
 * 斷言一律數節點／讀屬性，不比對序列化字串（PLAN §D10：overlay 的結構本來
 * 就會隨節點預算調整，字串比對會變成假失敗來源）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createBoard } from './board.js'
import { clearance } from './clearance.js'
import type { Rect } from './geometry.js'
import { t } from './messages.js'
import type { ClearanceReport, Corridor, Door, Furniture, RoomBlock, RoomPlan } from './model.js'
import {
  corridorKey,
  createOverlayState,
  dimensionGeometry,
  hatchPathD,
  renderOverlayDynamic,
  renderOverlayStatic,
  sideBandRect,
  type OverlayContext,
  type OverlayState,
} from './overlay.js'
import { normalize } from './room-shape.js'
import { DEFAULT_UI, type UiState } from './ui-state.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MESSAGES = t()

// jsdom 下全域 `URL` 為 jsdom 實作，`fileURLToPath` 只認 node 自家的 URL
// 實例，故沿 `board.dom.test.ts` 既有手法先轉字串路徑再 join。
const OVERLAY_SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'overlay.ts'),
  'utf-8',
)

// ── fixture ──────────────────────────────────────────────────────────

function svgGroup(id: string): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('id', id)
  return group
}

function buildDom(): { svg: SVGSVGElement; staticG: SVGGElement; dynamicG: SVGGElement } {
  document.body.textContent = ''
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('id', 'board-svg')
  for (const id of ['layer-floor', 'layer-walls', 'layer-items', 'layer-doors']) {
    svg.appendChild(svgGroup(id))
  }
  const overlay = svgGroup('layer-overlay')
  const staticG = svgGroup('overlay-static')
  const dynamicG = svgGroup('overlay-dynamic')
  overlay.appendChild(staticG)
  overlay.appendChild(dynamicG)
  svg.appendChild(overlay)
  document.body.appendChild(svg)
  return { svg, staticG, dynamicG }
}

function furniture(over: Partial<Furniture> & { id: string }): Furniture {
  return {
    name: '方塊',
    color: '#9db4d6',
    width: 100,
    depth: 50,
    x: 0,
    y: 0,
    rotation: 0,
    // 預設可通行＝正常評級（D5：只有茶几是 `passable:false`）。
    passable: true,
    ...over,
  }
}

interface PlanOptions {
  width?: number
  depth?: number
  blocks?: RoomBlock[]
  doors?: Door[]
  items?: Furniture[]
  warnBelow?: number
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
      warnBelow: options.warnBelow ?? 60,
      adviseBelow: 75,
      snap: 5,
      showSwing: true,
      maxItems: 20, // T4.7 軟上限：本檔不測上限行為，取預設值
    },
  }
}

function uiOf(over: Partial<UiState> = {}): UiState {
  return { ...DEFAULT_UI, ...over }
}

function ctxOf(
  plan: RoomPlan,
  ui: UiState,
  report: ClearanceReport | null,
  scale = 2,
): OverlayContext {
  return { plan, ui, report, bounds: normalize(plan.room).bounds, messages: MESSAGES, scale }
}

/** 依 class token 蒐集子孫節點（不依賴選擇器引擎對 SVG `class` 的支援）。 */
function byClass(root: Element, token: string): Element[] {
  const out: Element[] = []
  const walk = (el: Element): void => {
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children.item(i)
      if (child === null) continue
      const classes = (child.getAttribute('class') ?? '').split(/\s+/)
      if (classes.includes(token)) out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out
}

function nodeByKey(root: Element, key: string): Element | null {
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children.item(i)
    if (child !== null && child.getAttribute('data-key') === key) return child
  }
  return null
}

function textOf(group: Element): string | null {
  const found = byClass(group, 'dimension-text')[0]
  return found === undefined ? null : found.textContent
}

// ── 共用 plan：兩件家具相距 50 cm（預設閾值 → narrow）──────────────────

const TWO_ITEMS: Furniture[] = [
  furniture({ id: 'a1', x: 0, y: 0 }),
  furniture({ id: 'a2', x: 0, y: 100 }),
]

/** D9 玄關實例：基底 300×400＋凸出區 E1、門寬 70、衣櫃 200×60 旋轉 90。 */
const VESTIBULE_BLOCK: RoomBlock = { id: 'e1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }

function vestibuleDoor(width = 70): Door {
  return { id: 'd1', x: 360, y: 270, wall: 'E', leafDir: '-', width, swing: 'in' }
}

function wardrobe(y = 0): Furniture {
  return furniture({
    id: 'w1',
    name: '衣櫃',
    width: 200,
    depth: 60,
    rotation: 90,
    x: 300,
    y,
    clearances: { S: 90 },
  })
}

function vestibulePlan(options: { doorWidth?: number; wardrobeY?: number } = {}): RoomPlan {
  return planOf({
    blocks: [VESTIBULE_BLOCK],
    doors: [vestibuleDoor(options.doorWidth ?? 70)],
    items: [wardrobe(options.wardrobeY ?? 0)],
  })
}

let svg: SVGSVGElement
let staticG: SVGGElement
let dynamicG: SVGGElement
let state: OverlayState

beforeEach(() => {
  const dom = buildDom()
  svg = dom.svg
  staticG = dom.staticG
  dynamicG = dom.dynamicG
  state = createOverlayState()
})

function renderBoth(plan: RoomPlan, ui: UiState, scale = 2): ClearanceReport {
  const report = clearance(plan)
  const ctx = ctxOf(plan, ui, report, scale)
  renderOverlayStatic(staticG, ctx, state)
  renderOverlayDynamic(dynamicG, ctx, state)
  return report
}

// ── 純函式 ───────────────────────────────────────────────────────────

describe('hatchPathD（OQ5：單一多段 <path>）', () => {
  const rect: Rect = { x0: 0, y0: 0, x1: 100, y1: 50 }

  /** `d` → 逐段 [x1,y1,x2,y2]；順帶斷言字串只由 `M x y L x y` 對組成。 */
  function parse(d: string): number[][] {
    const tokens = d.split(' ')
    const segments: number[][] = []
    for (let i = 0; i < tokens.length; i += 6) {
      expect(tokens[i]).toBe('M')
      expect(tokens[i + 3]).toBe('L')
      segments.push([
        Number(tokens[i + 1]),
        Number(tokens[i + 2]),
        Number(tokens[i + 4]),
        Number(tokens[i + 5]),
      ])
    }
    return segments
  }

  it('100×50 矩形、間距 10 → 14 段（兩端截距退化為角點，不輸出）', () => {
    const segments = parse(hatchPathD(rect, 10))
    expect(segments).toHaveLength(14)
    expect(segments.length).toBeGreaterThanOrEqual(Math.floor((100 + 50) / 10) - 1)
  })

  it('每段兩端點都落在矩形邊界上，且皆為 45°', () => {
    for (const [x1, y1, x2, y2] of parse(hatchPathD(rect, 10))) {
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ]) {
        expect(x).toBeGreaterThanOrEqual(rect.x0)
        expect(x).toBeLessThanOrEqual(rect.x1)
        expect(y).toBeGreaterThanOrEqual(rect.y0)
        expect(y).toBeLessThanOrEqual(rect.y1)
        expect(x === rect.x0 || x === rect.x1 || y === rect.y0 || y === rect.y1).toBe(true)
      }
      expect(Math.abs(x2 - x1)).toBeCloseTo(Math.abs(y2 - y1), 10)
    }
  })

  it('截距對齊全域格線：平移整數倍間距後 `d` 逐字相同（子段接得起來）', () => {
    const a = hatchPathD({ x0: 0, y0: 0, x1: 60, y1: 40 }, 10)
    const b = hatchPathD({ x0: 10, y0: 0, x1: 70, y1: 40 }, 10)
    expect(parse(a)).toHaveLength(parse(b).length)
    expect(parse(b).map(([x1, y1, x2, y2]) => [x1 - 10, y1, x2 - 10, y2])).toEqual(parse(a))
  })

  it('極長窄縫不爆節點也不爆字串：段數有上限', () => {
    const segments = hatchPathD({ x0: 0, y0: 0, x1: 5000, y1: 5000 }, 10)
    expect(segments.split('M').length - 1).toBeLessThanOrEqual(240)
  })

  it('退化矩形（零面積）回空字串', () => {
    expect(hatchPathD({ x0: 10, y0: 10, x1: 10, y1: 10 })).toBe('')
  })
})

describe('dimensionGeometry／sideBandRect／corridorKey（純函式）', () => {
  it('間距軸 y：尺寸線沿 y 橫跨縫寬、位於重疊段正中', () => {
    const geom = dimensionGeometry({
      a: 'a1',
      b: 'a2',
      axis: 'y',
      gap: 50,
      rect: { x0: 0, y0: 50, x1: 100, y1: 100 },
      level: 'narrow',
      kind: 'corridor',
      segIndex: 0,
    })
    expect(geom).toEqual({ x1: 50, y1: 50, x2: 50, y2: 100, tx: 50, ty: 75 })
  })

  it('間距軸 x：尺寸線沿 x', () => {
    const geom = dimensionGeometry({
      a: 'a1',
      b: 'frame:E',
      axis: 'x',
      gap: 200,
      rect: { x0: 100, y0: 0, x1: 300, y1: 50 },
      level: 'ok',
      kind: 'corridor',
      segIndex: 0,
    })
    expect(geom).toEqual({ x1: 100, y1: 25, x2: 300, y2: 25, tx: 200, ty: 25 })
  })

  it('需留帶在世界面外側，裁到外接框內；整條落框外回 null', () => {
    const rect: Rect = { x0: 0, y0: 100, x1: 100, y1: 150 }
    const bounds: Rect = { x0: 0, y0: 0, x1: 300, y1: 400 }
    expect(sideBandRect(rect, 'S', 90, bounds)).toEqual({ x0: 0, y0: 150, x1: 100, y1: 240 })
    expect(sideBandRect(rect, 'W', 90, bounds)).toBeNull()
    expect(sideBandRect(rect, 'N', 90, bounds)).toEqual({ x0: 0, y0: 10, x1: 100, y1: 100 })
  })

  it('key 為 `a|b|axis|segIndex`，segIndex 不同即不同節點', () => {
    const base = {
      a: 'a1',
      b: 'a2',
      axis: 'y' as const,
      gap: 50,
      rect: { x0: 0, y0: 50, x1: 100, y1: 100 },
      level: 'narrow' as const,
      kind: 'corridor' as const,
      segIndex: 0,
    }
    expect(corridorKey(base)).toBe('a1|a2|y|0')
    expect(corridorKey({ ...base, segIndex: 1 })).toBe('a1|a2|y|1')
  })
})

// ── switch → 子節點增減（PLAN §Verification）──────────────────────────

describe('switch → overlay 子節點增減', () => {
  const plan = planOf({ items: TWO_ITEMS })

  it('顯示警示開 → narrow 群組含單一 <path class="hatch">＋外框＋數值', () => {
    const report = renderBoth(plan, uiOf({ showWarnings: true, showDistance: false }))
    const narrow = byClass(dynamicG, 'corridor--narrow')
    expect(narrow).toHaveLength(1)
    const corridor = report.corridors.find((c) => c.a === 'a1' && c.b === 'a2')
    expect(corridor?.gap).toBe(50)
    expect(narrow[0].getAttribute('data-key')).toBe(corridorKey(corridor!))
    expect(byClass(narrow[0], 'hatch')).toHaveLength(1)
    expect(byClass(narrow[0], 'hatch')[0].localName).toBe('path')
    expect(byClass(narrow[0], 'hatch')[0].getAttribute('vector-effect')).toBe('non-scaling-stroke')
    expect(byClass(narrow[0], 'corridor-rect')).toHaveLength(1)
    expect(textOf(narrow[0])).toBe('50')
  })

  it('顯示警示關 → 斜線與群組一併移除（report 仍照算）', () => {
    renderBoth(plan, uiOf({ showWarnings: true }))
    expect(byClass(dynamicG, 'hatch')).toHaveLength(1)
    const report = renderBoth(plan, uiOf({ showWarnings: false }))
    expect(byClass(dynamicG, 'hatch')).toHaveLength(0)
    expect(byClass(dynamicG, 'corridor--narrow')).toHaveLength(0)
    expect(report.corridors.some((c) => c.level === 'narrow')).toBe(true)
  })

  it('顯示距離開 → ok 通道與門洞尺寸線出現；關 → 消失（narrow 不受影響）', () => {
    renderBoth(plan, uiOf({ showDistance: false }))
    expect(byClass(dynamicG, 'corridor--ok')).toHaveLength(0)

    renderBoth(plan, uiOf({ showDistance: true }))
    const ok = byClass(dynamicG, 'corridor--ok')
    expect(ok.length).toBeGreaterThan(0)
    expect(byClass(ok[0], 'dimension')).toHaveLength(1)
    expect(byClass(dynamicG, 'corridor--narrow')).toHaveLength(1)

    renderBoth(plan, uiOf({ showDistance: false }))
    expect(byClass(dynamicG, 'corridor--ok')).toHaveLength(0)
    expect(byClass(dynamicG, 'corridor--narrow')).toHaveLength(1)
  })

  it('貼齊（touch）四段最左一段永不建節點', () => {
    // a1 貼北框（間距 0 < ignoreBelow 5）→ 不標。
    const report = renderBoth(plan, uiOf({ showDistance: true, showWarnings: true }))
    expect(report.corridors.some((c) => c.level === 'touch')).toBe(true)
    expect(byClass(dynamicG, 'corridor--touch')).toHaveLength(0)
  })
})

// ── 閾值變更 → 重算重繪（同一節點原地換裝）────────────────────────────

describe('閾值變更 → 重算後原地更新同一個節點', () => {
  it('50 cm 縫：預設 narrow → warnBelow 40 後 tight，節點參考不變且斜線移除', () => {
    const plan = planOf({ items: TWO_ITEMS })
    const report = renderBoth(plan, uiOf({ showWarnings: true }))
    const corridor = report.corridors.find((c) => c.a === 'a1' && c.b === 'a2')!
    const key = corridorKey(corridor)
    const group = nodeByKey(dynamicG, key)
    expect(group?.getAttribute('class')).toBe('corridor corridor--narrow')
    expect(byClass(group!, 'hatch')).toHaveLength(1)

    const retuned = planOf({ items: TWO_ITEMS, warnBelow: 40 })
    const report2 = renderBoth(retuned, uiOf({ showWarnings: true }))
    expect(report2.corridors.find((c) => c.a === 'a1' && c.b === 'a2')?.level).toBe('tight')
    // **同一個** <g>：key 不變 → 原地換 class 與子部件，不重建。
    expect(nodeByKey(dynamicG, key)).toBe(group)
    expect(group?.getAttribute('class')).toBe('corridor corridor--tight')
    expect(byClass(group!, 'hatch')).toHaveLength(0)
    expect(byClass(group!, 'corridor-rect')).toHaveLength(0)
    expect(textOf(group!)).toBe(`50 ${MESSAGES.report.level.tight}`)
  })

  it('忽略值調高到 60 → 50 cm 縫降為 touch，節點整個移除', () => {
    const plan = planOf({ items: TWO_ITEMS })
    renderBoth(plan, uiOf({ showWarnings: true }))
    expect(byClass(dynamicG, 'corridor--narrow')).toHaveLength(1)

    const relaxed: RoomPlan = {
      ...plan,
      settings: { ...plan.settings, ignoreBelow: 60, warnBelow: 60 },
    }
    renderBoth(relaxed, uiOf({ showWarnings: true }))
    expect(byClass(dynamicG, 'corridor--narrow')).toHaveLength(0)
  })
})

// ── key 差集穩定性 ───────────────────────────────────────────────────

describe('key 差集：重繪不重建、離場即移除', () => {
  it('同一份 report 連畫兩次 → 所有節點參考不變', () => {
    const plan = planOf({ items: TWO_ITEMS })
    const report = clearance(plan)
    const ui = uiOf({ showDistance: true, showWarnings: true })
    const ctx = ctxOf(plan, ui, report)
    renderOverlayDynamic(dynamicG, ctx, state)
    const before = Array.from(dynamicG.children)
    renderOverlayDynamic(dynamicG, ctx, state)
    expect(Array.from(dynamicG.children)).toEqual(before)
    expect(dynamicG.children.length).toBe(before.length)
  })

  it('通道自 report 消失 → 該節點移除，其餘不動', () => {
    const plan = planOf({ items: TWO_ITEMS })
    const report = clearance(plan)
    const ui = uiOf({ showDistance: true, showWarnings: true })
    renderOverlayDynamic(dynamicG, ctxOf(plan, ui, report), state)
    const narrowKey = corridorKey(report.corridors.find((c) => c.level === 'narrow')!)
    const survivorKey = corridorKey(report.corridors.find((c) => c.level === 'ok')!)
    const survivor = nodeByKey(dynamicG, survivorKey)

    const trimmed: ClearanceReport = {
      ...report,
      corridors: report.corridors.filter((c) => corridorKey(c) !== narrowKey),
    }
    renderOverlayDynamic(dynamicG, ctxOf(plan, ui, trimmed), state)
    expect(nodeByKey(dynamicG, narrowKey)).toBeNull()
    expect(nodeByKey(dynamicG, survivorKey)).toBe(survivor)
  })

  it('report 為 null → dynamic 清空（群組本身留著）', () => {
    const plan = planOf({ items: TWO_ITEMS })
    const ui = uiOf({ showDistance: true, showWarnings: true })
    renderOverlayDynamic(dynamicG, ctxOf(plan, ui, clearance(plan)), state)
    expect(dynamicG.children.length).toBeGreaterThan(0)
    renderOverlayDynamic(dynamicG, ctxOf(plan, ui, null), state)
    expect(dynamicG.children.length).toBe(0)
    expect(dynamicG.parentElement?.getAttribute('id')).toBe('layer-overlay')
  })
})

// ── 碰撞／各面需留／門違規 ───────────────────────────────────────────

describe('碰撞框、各面需留、門違規（D3／D5／D6）', () => {
  it('兩件重疊 → 碰撞框涵蓋交集；顯示警示關即消失', () => {
    const plan = planOf({
      items: [furniture({ id: 'a1', x: 0, y: 0 }), furniture({ id: 'a2', x: 50, y: 20 })],
    })
    const report = renderBoth(plan, uiOf({ showWarnings: true }))
    expect(report.collisions).toHaveLength(1)
    const boxes = byClass(dynamicG, 'collision')
    expect(boxes).toHaveLength(1)
    expect(
      ['x', 'y', 'width', 'height'].map((name) => boxes[0].getAttribute(name)),
    ).toEqual(['50', '20', '50', '30'])

    renderBoth(plan, uiOf({ showWarnings: false }))
    expect(byClass(dynamicG, 'collision')).toHaveLength(0)
  })

  it('需留標示帶進 overlay-static（顯示警示關即收起），違規面另加虛線框', () => {
    const plan = planOf({
      items: [
        furniture({ id: 'a1', x: 0, y: 0, clearances: { S: 90 } }),
        furniture({ id: 'a2', x: 0, y: 100 }),
      ],
    })
    const report = renderBoth(plan, uiOf({ showWarnings: true }))
    expect(report.sideViolations.map((v) => [v.id, v.worldSide, v.actual])).toEqual([
      ['a1', 'S', 50],
    ])

    const bands = byClass(staticG, 'side-need')
    expect(bands).toHaveLength(1)
    expect(['x', 'y', 'width', 'height'].map((name) => bands[0].getAttribute(name))).toEqual([
      '0',
      '50',
      '100',
      '90',
    ])
    const violated = byClass(dynamicG, 'side-need--violated')
    expect(violated).toHaveLength(1)
    expect(violated[0].getAttribute('class')).toBe('side-need side-need--violated')

    renderBoth(plan, uiOf({ showWarnings: false }))
    expect(byClass(staticG, 'side-need')).toHaveLength(0)
    expect(byClass(dynamicG, 'side-need--violated')).toHaveLength(0)
  })

  it('passable:false 的通道為 suppressed：只在顯示距離下畫尺寸線、不評級', () => {
    const plan = planOf({
      items: [
        furniture({ id: 'a1', x: 0, y: 0, passable: false }),
        furniture({ id: 'a2', x: 0, y: 100 }),
      ],
    })
    const report = renderBoth(plan, uiOf({ showWarnings: true, showDistance: false }))
    expect(report.corridors.find((c) => c.a === 'a1' && c.b === 'a2')?.kind).toBe('suppressed')
    expect(byClass(dynamicG, 'corridor--suppressed')).toHaveLength(0)
    expect(byClass(dynamicG, 'hatch')).toHaveLength(0)

    const shown = renderBoth(plan, uiOf({ showWarnings: true, showDistance: true }))
    // a1 不可通行 → **含它的每一筆**通道皆 suppressed（D4），逐筆比對筆數。
    const suppressedCount = shown.corridors.filter((c) => c.kind === 'suppressed').length
    expect(byClass(dynamicG, 'corridor--suppressed')).toHaveLength(suppressedCount)
    const pair = shown.corridors.find((c) => c.a === 'a1' && c.b === 'a2')!
    const group = nodeByKey(dynamicG, corridorKey(pair))!
    expect(group.getAttribute('class')).toBe('corridor corridor--suppressed')
    expect(byClass(group, 'dimension')).toHaveLength(1)
    expect(byClass(group, 'hatch')).toHaveLength(0)
    expect(textOf(group)).toBe('50')
  })
})

// ── D9 玄關實例與反向案 ──────────────────────────────────────────────

describe('玄關實例（PLAN §D9）', () => {
  it('正案：門洞一筆（門洞 70）、零斜線、零碰撞、零門違規', () => {
    const plan = vestibulePlan()
    const report = renderBoth(plan, uiOf({ showDistance: true, showWarnings: true }))
    expect(report.collisions).toHaveLength(0)
    expect(report.doorViolations).toHaveLength(0)
    expect(report.sideViolations).toHaveLength(0)

    const doorways = byClass(dynamicG, 'corridor--doorway')
    expect(doorways).toHaveLength(1)
    expect(textOf(doorways[0])).toBe(`${MESSAGES.report.kind.doorway} 70`)
    expect(byClass(doorways[0], 'dimension')).toHaveLength(1)
    expect(byClass(dynamicG, 'hatch')).toHaveLength(0)
    expect(byClass(dynamicG, 'collision')).toHaveLength(0)
    expect(byClass(dynamicG, 'door-violation')).toHaveLength(0)
  })

  it('門洞尺寸線只在「顯示距離」開啟時畫（D4）', () => {
    const plan = vestibulePlan()
    renderBoth(plan, uiOf({ showDistance: false, showWarnings: true }))
    expect(byClass(dynamicG, 'corridor--doorway')).toHaveLength(0)
  })

  it('反向案 (b)：門寬 50 → 同一條縫改評 tight，畫琥珀「偏窄」', () => {
    const plan = vestibulePlan({ doorWidth: 50 })
    const report = renderBoth(plan, uiOf({ showDistance: true, showWarnings: true }))
    expect(report.corridors.filter((c) => c.kind === 'doorway')).toHaveLength(0)
    const tight = byClass(dynamicG, 'corridor--tight')
    expect(tight).toHaveLength(1)
    expect(textOf(tight[0])).toBe(`70 ${MESSAGES.report.level.tight}`)
    expect(byClass(tight[0], 'dimension')).toHaveLength(0)
  })

  it('反向案 (a)：衣櫃 y=1 → 門違規框涵蓋該家具有效外框', () => {
    const plan = vestibulePlan({ wardrobeY: 1 })
    const report = renderBoth(plan, uiOf({ showDistance: true, showWarnings: true }))
    expect(report.doorViolations).toEqual([{ doorId: 'd1', itemId: 'w1' }])
    const boxes = byClass(dynamicG, 'door-violation')
    expect(boxes).toHaveLength(1)
    expect(['x', 'y', 'width', 'height'].map((name) => boxes[0].getAttribute(name))).toEqual([
      '300',
      '1',
      '60',
      '200',
    ])

    renderBoth(plan, uiOf({ showWarnings: false }))
    expect(byClass(dynamicG, 'door-violation')).toHaveLength(0)
  })
})

// ── 標籤隱藏門檻 ─────────────────────────────────────────────────────

describe('數值隱藏門檻（10 × scale < 9 px）', () => {
  const plan = planOf({ items: TWO_ITEMS })

  it('scale 0.5（字級 5 px）→ 所有數值隱藏；1.5（15 px）→ 一律可見', () => {
    const ui = uiOf({ showDistance: true, showWarnings: true })
    renderBoth(plan, ui, 0.5)
    const hidden = byClass(dynamicG, 'dimension-text')
    expect(hidden.length).toBeGreaterThan(0)
    expect(hidden.every((el) => el.getAttribute('visibility') === 'hidden')).toBe(true)

    renderBoth(plan, ui, 1.5)
    const shown = byClass(dynamicG, 'dimension-text')
    expect(shown.every((el) => el.getAttribute('visibility') === null)).toBe(true)
  })
})

// ── 拖移期節點預算（T3.4／OQ5 (1)）─────────────────────────────────────

describe('拖移期節點預算：只畫 narrow ＋ 碰撞（T3.4／OQ5 定案 (1)）', () => {
  const plan = planOf({ items: TWO_ITEMS })

  /**
   * 六類各一筆的 report。通道筆的幾何與 `kind`／`level` 皆照 D4／D3 的形狀
   * 手寫——這一組測的是「哪幾類進 DOM」的記帳，不是幾何；真實 plan 的
   * 每一件家具都會同時與四條框邊配對，湊不出「恰好一筆」的可讀基準。
   * 幾何正確性由本檔其餘（一律跑真 `clearance()` 的）案負責。
   */
  function sixKinds(): ClearanceReport {
    const corridor = (
      a: string,
      kind: Corridor['kind'],
      level: Corridor['level'],
      gap: number,
      y0: number,
    ): Corridor => ({
      a,
      b: 'wall:0',
      axis: 'y',
      gap,
      rect: { x0: 0, y0, x1: 100, y1: y0 + gap },
      level,
      kind,
      segIndex: 0,
    })
    return {
      corridors: [
        corridor('n1', 'corridor', 'narrow', 50, 50),
        corridor('t1', 'corridor', 'tight', 70, 150),
        corridor('o1', 'corridor', 'ok', 90, 250),
        corridor('d1', 'doorway', null, 70, 350),
      ],
      collisions: [{ a: 'a1', b: 'a2', rect: { x0: 0, y0: 0, x1: 20, y1: 20 } }],
      sideViolations: [
        { id: 'a1', side: 'S', worldSide: 'S', need: 90, actual: 50, against: 'a2' },
      ],
      doorViolations: [],
      unattachedDoors: [],
      unconnectedBlocks: [],
    }
  }

  function draggingUi(): UiState {
    return uiOf({
      showDistance: true,
      showWarnings: true,
      dragging: { id: 'a1', kind: 'item', source: 'pointer', origin: plan, cancelled: false },
    })
  }

  function renderDynamic(ui: UiState, report: ClearanceReport): void {
    renderOverlayDynamic(dynamicG, ctxOf(plan, ui, report), state)
  }

  it('非拖移 6 群組 → 拖移剩 2（narrow＋碰撞），另外 4 個節點真的離開 DOM', () => {
    const report = sixKinds()
    const idle = uiOf({ showDistance: true, showWarnings: true })
    renderDynamic(idle, report)
    expect(dynamicG.children.length).toBe(6)

    const survivors = [
      nodeByKey(dynamicG, corridorKey(report.corridors[0])),
      byClass(dynamicG, 'collision')[0],
    ]
    const dropped = [
      nodeByKey(dynamicG, corridorKey(report.corridors[1])),
      nodeByKey(dynamicG, corridorKey(report.corridors[2])),
      nodeByKey(dynamicG, corridorKey(report.corridors[3])),
      byClass(dynamicG, 'side-need--violated')[0],
    ]
    expect(dropped.every((el) => el !== null && el !== undefined)).toBe(true)

    renderDynamic(draggingUi(), report)
    expect(dynamicG.children.length).toBe(2)
    // 「移除」不是「隱藏」：節點數要真的降下來才省得到 style／layout。
    for (const el of dropped) expect(el?.isConnected).toBe(false)
    for (const el of survivors) expect(el?.isConnected).toBe(true)
    expect(byClass(dynamicG, 'corridor--narrow')).toHaveLength(1)
    expect(byClass(dynamicG, 'collision')).toHaveLength(1)
  })

  it('commit（dragging 回 null）→ 6 個回來，narrow 群組仍是同一個節點參考', () => {
    const report = sixKinds()
    const idle = uiOf({ showDistance: true, showWarnings: true })
    renderDynamic(idle, report)
    const narrow = nodeByKey(dynamicG, corridorKey(report.corridors[0]))

    renderDynamic(draggingUi(), report)
    expect(dynamicG.children.length).toBe(2)

    renderDynamic(idle, report)
    expect(dynamicG.children.length).toBe(6)
    expect(nodeByKey(dynamicG, corridorKey(report.corridors[0]))).toBe(narrow)
  })

  it('拖移期 narrow 仍受「顯示警示」管；`overlay-static` 的需留標示帶不受影響', () => {
    const report = sixKinds()
    const ctx = ctxOf(plan, draggingUi(), report)
    renderOverlayDynamic(dynamicG, ctx, state)
    expect(dynamicG.children.length).toBe(2)

    const quiet = uiOf({
      showDistance: true,
      showWarnings: false,
      dragging: draggingUi().dragging,
    })
    renderOverlayDynamic(dynamicG, ctxOf(plan, quiet, report), state)
    expect(dynamicG.children.length).toBe(0)
  })

  it('真 plan（玄關實例）：拖移期節點數下降，且留下的通道群組只有 narrow', () => {
    const real = vestiblePlanWithNarrow()
    const idle = uiOf({ showDistance: true, showWarnings: true })
    const report = clearance(real)
    renderOverlayStatic(staticG, ctxOf(real, idle, report), state)
    renderOverlayDynamic(dynamicG, ctxOf(real, idle, report), state)
    const before = dynamicG.children.length
    const staticBefore = staticG.children.length
    expect(byClass(dynamicG, 'corridor--narrow').length).toBeGreaterThan(0)

    const dragUi = uiOf({
      showDistance: true,
      showWarnings: true,
      dragging: { id: 'w1', kind: 'item', source: 'pointer', origin: real, cancelled: false },
    })
    renderOverlayStatic(staticG, ctxOf(real, dragUi, report), state)
    renderOverlayDynamic(dynamicG, ctxOf(real, dragUi, report), state)
    expect(dynamicG.children.length).toBeLessThan(before)
    expect(dynamicG.children.length).toBe(byClass(dynamicG, 'corridor--narrow').length)
    // `overlay-static`（迴旋區、需留標示）在拖移期照舊。
    expect(staticG.children.length).toBe(staticBefore)
  })

  /** 玄關實例＋一件擠出 50 cm 窄縫的家具（確保真 report 裡有 narrow）。 */
  function vestiblePlanWithNarrow(): RoomPlan {
    return planOf({
      blocks: [VESTIBULE_BLOCK],
      doors: [vestibuleDoor()],
      items: [wardrobe(), furniture({ id: 'a1', x: 0, y: 0 }), furniture({ id: 'a2', x: 0, y: 100 })],
    })
  }
})

// ── board.ts 接線 ────────────────────────────────────────────────────

describe('board 接線（createBoard／renderCommit／renderOverlay）', () => {
  it('#layer-overlay 帶 aria-hidden="true"（資訊由 report-list 文字等價）', () => {
    createBoard({ svg, messages: MESSAGES })
    expect(svg.querySelector('#layer-overlay')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renderCommit 一併畫兩個 overlay 群組；迴旋區扇形與需留帶共存於 static', () => {
    const board = createBoard({ svg, messages: MESSAGES })
    const plan = vestibulePlan()
    board.renderCommit(plan, uiOf({ showDistance: true, showWarnings: true }), clearance(plan))
    expect(byClass(board.layers.overlayDynamic, 'corridor--doorway')).toHaveLength(1)
    // 扇形（board.ts）＋需留帶（overlay.ts）同層並存，互不清除。
    expect(byClass(board.layers.overlayStatic, 'door-swing')).toHaveLength(1)
    expect(byClass(board.layers.overlayStatic, 'side-need')).toHaveLength(1)
  })

  it('renderOverlay 單獨重畫 overlay，不動家具節點（T3.4 拖移期入口）', () => {
    const board = createBoard({ svg, messages: MESSAGES })
    const plan = planOf({ items: TWO_ITEMS })
    const ui = uiOf({ showWarnings: true })
    board.renderCommit(plan, ui, clearance(plan))
    const itemNode = board.node('item', 'a1')
    expect(byClass(board.layers.overlayDynamic, 'corridor--narrow')).toHaveLength(1)

    board.renderOverlay(plan, uiOf({ showWarnings: false }), clearance(plan))
    expect(byClass(board.layers.overlayDynamic, 'corridor--narrow')).toHaveLength(0)
    expect(board.node('item', 'a1')).toBe(itemNode)
  })

  it('report 為 null（M2 路徑）→ dynamic 空', () => {
    const board = createBoard({ svg, messages: MESSAGES })
    board.renderCommit(planOf({ items: TWO_ITEMS }), uiOf(), null)
    expect(board.layers.overlayDynamic.children.length).toBe(0)
  })

  it('renderCommit 後單獨以「新的 plan＋新的 report」重畫 overlay：通道節點跟著換（T3.4 part B 接線）', () => {
    const board = createBoard({ svg, messages: MESSAGES })
    const plan = planOf({ items: TWO_ITEMS })
    const ui = uiOf({ showWarnings: true })
    board.renderCommit(plan, ui, clearance(plan))
    const first = byClass(board.layers.overlayDynamic, 'corridor--narrow')
    expect(first).toHaveLength(1)

    // 把 a2 往下推到 120 cm 外 → 同一對的縫由 narrow（50）變 ok（70→不畫）。
    const moved = planOf({ items: [TWO_ITEMS[0], furniture({ id: 'a2', x: 0, y: 170 })] })
    board.renderOverlay(moved, ui, clearance(moved))
    expect(byClass(board.layers.overlayDynamic, 'corridor--narrow')).toHaveLength(0)
    // viewBox 與家具節點都不該被 overlay 重畫動到（renderDrag 自己管位移）。
    expect(board.node('item', 'a2')?.getAttribute('data-y')).toBe('100')
  })

  it('拖移期入口：renderDrag ＋ 帶 dragging 的 renderOverlay 只留 narrow＋碰撞', () => {
    const board = createBoard({ svg, messages: MESSAGES })
    const plan = planOf({ blocks: [VESTIBULE_BLOCK], doors: [vestibuleDoor()], items: [wardrobe()] })
    const ui = uiOf({ showDistance: true, showWarnings: true })
    board.renderCommit(plan, ui, clearance(plan))
    expect(byClass(board.layers.overlayDynamic, 'corridor--doorway').length).toBeGreaterThan(0)

    board.renderDrag('w1', 'item', 300, 40)
    const dragUi = uiOf({
      showDistance: true,
      showWarnings: true,
      dragging: { id: 'w1', kind: 'item', source: 'pointer', origin: plan, cancelled: false },
    })
    board.renderOverlay(plan, dragUi, clearance(plan))
    expect(byClass(board.layers.overlayDynamic, 'corridor--doorway')).toHaveLength(0)
    // 被拖節點的 transform 不被 overlay 重畫抹掉。
    expect(board.node('item', 'w1')?.getAttribute('transform')).toBe('translate(0 40)')
  })
})

// ── DOM 寫入不變量（D7）──────────────────────────────────────────────

describe('DOM 寫入不變量（PLAN §D7）', () => {
  it('overlay.ts 原始碼不含字串注入 API，也不整批替換子節點', () => {
    expect(OVERLAY_SOURCE).not.toContain('innerHTML')
    expect(OVERLAY_SOURCE).not.toContain('insertAdjacentHTML')
    expect(OVERLAY_SOURCE).not.toContain('outerHTML')
    expect(OVERLAY_SOURCE).not.toContain('replaceChildren')
    expect(OVERLAY_SOURCE).not.toContain('document.createElement(')
    expect(OVERLAY_SOURCE).toContain('document.createElementNS(')
  })
})
