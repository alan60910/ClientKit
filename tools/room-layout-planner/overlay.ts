/**
 * T3.1 — 分析層 overlay 渲染（(internal design doc) §G3 距離
 * 顯示、§G4 通道警示、§D3 四段半開區間的**呈現**規則、§D4 門洞尺寸線與
 * `suppressed`、§D5 各面需留、§D7「契約——DOM 寫入不變量」、§D10 render
 * （overlay 拆 `overlay-static`／`overlay-dynamic`、通道節點以
 * `${aId}|${bId}|${axis}|${segIndex}` 為 key 差集更新、OQ5 定案「斜線改單一
 * 多段 `<path>`」、`vector-effect="non-scaling-stroke"`、標籤隱藏門檻）、
 * §Frontend Accessibility「overlay `aria-hidden`，資訊由 report-list 文字
 * 等價」）。
 *
 * **四段呈現（D3／D4，PLAN 為準）**：
 * - `touch`（`d < ignoreBelow`）——灰、**不標**，連節點都不建。
 * - `narrow`（`[ignoreBelow, warnBelow)`）——紅斜線區＋外框＋數值；由
 *   「顯示警示」管，**不**受「顯示距離」影響。
 * - `tight`（`[warnBelow, adviseBelow)`）——琥珀數值＋「偏窄」；同上。
 * - `ok`（`≥ adviseBelow`）——僅「顯示距離」開啟時畫尺寸線＋數值。
 * - `kind:'doorway'`／`'suppressed'`——不評級，僅「顯示距離」下看尺寸線
 *   （門洞另冠 `門洞` 字樣，D4）。
 * 「顯示警示」關閉時三者（`narrow`／`tight`／碰撞）皆不畫，但 report 仍由
 * `clearance.ts` 照算——本檔只決定畫不畫，不影響任何計算。
 *
 * **拖移期節點預算（T3.4，OQ5 定案第 (1) 項）**：`ui.dragging` 非 null 時
 * `overlay-dynamic` 只畫 `narrow` 通道與碰撞（見 `visibleWhileDragging()`），
 * `tight`／`ok`／門洞／`suppressed`／各面需留／門迴旋區違規 commit 後再畫。
 * 兩個方向都走同一套 key 差集，故是**真的增刪節點**，不是隱藏。
 *
 * **DOM 寫入不變量（D7）**：所有進 DOM 的字串一律只經
 * `document.createElementNS()`／`setAttribute()`／`textContent` 三條路徑；
 * 本檔不使用任何以字串拼 HTML／SVG 的注入 API（`overlay.dom.test.ts` 以讀
 * 原始碼的方式把這條釘成回歸網）。
 *
 * **原地更新硬契約（D10）**：絕不整批替換子節點。兩層 key 差集——
 * 外層以 `corridorKey()`／`col|`／`sidev|`／`doorv|`／`need|` 前綴為 key 對
 * 群組節點做增／改／刪；內層對每個通道群組的子部件（斜線／外框／尺寸線／
 * 數值）以 `data-part` 做同樣的增／改／刪。既有節點只改屬性、`d` 與
 * `textContent`，永不重建——節點參考穩定是 T3.4 拖移期差集更新的前提。
 *
 * 迴旋區扇形（D6）仍由 `board.ts` 畫進同一個 `overlay-static` 群組，本檔
 * **不重複**：差集只走自己 key 表裡的節點，故兩者共存互不干擾。
 *
 * 本檔為 DOM 層葉節點：只被 `board.ts` 呼叫，不反向 import 任何 DOM 層模組。
 */
import type { Rect } from './geometry.js'
import type { Messages } from './messages.js'
import {
  effectiveRect,
  worldSide,
  type ClearanceReport,
  type Corridor,
  type Furniture,
  type RoomPlan,
  type Side,
} from './model.js'
import { LABEL_HIDE_BELOW_PX, type UiState } from './ui-state.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * 通道數值的字級（user unit）。與 `style.css` 的 `.dimension-text`
 * （`font: 10px …`）同值——標籤隱藏門檻（OQ2 精神）以此乘上渲染比例判定。
 */
export const DIMENSION_FONT_SIZE = 10

/** 紅斜線區的斜線間距（cm，沿 45° 線的截距步長）。 */
export const HATCH_SPACING_CM = 10

/**
 * 單一通道斜線 `<path>` 的線段數上限。OQ5 把每筆通道壓成一個節點後，剩下
 * 的成本只在 `d` 字串長度；極長的窄縫（如 5000 cm 牆面）仍可能算出數百段，
 * 故超過上限時**放大間距**而非增加節點，維持單節點與有界字串長度。
 */
export const HATCH_MAX_LINES = 240

/** `clearances` 巡檢序（與 `clearance.ts` 的 `SIDE_KEYS` 同序，輸出決定性）。 */
const SIDE_KEYS: readonly Side[] = ['N', 'E', 'S', 'W']

// ── 純函式 ───────────────────────────────────────────────────────────

/**
 * 通道節點的 key（D10 render 契約字面）：`${aId}|${bId}|${axis}|${segIndex}`。
 * `segIndex` 不保證跨幀穩定（D4），故幾何不變但段數改變時本來就該換節點；
 * 閾值變更**不**動幾何，key 因此穩定，同一個 `<g>` 只換 class 與子部件。
 */
export function corridorKey(c: Corridor): string {
  return `${c.a}|${c.b}|${c.axis}|${c.segIndex}`
}

/** 數值字串：整數直接輸出，非整數留兩位小數並去掉尾零（`d` 字串長度可控）。 */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

/**
 * 45° 斜線區的單一多段 `<path>` 的 `d`（OQ5 定案：由 6 條 `<line>` 改為
 * 1 條 `<path>`，每筆通道 8 元素 → 3）。斜線族為 `x + y = c`（螢幕座標下的
 * 「／」向），`c` 取 `spacingCm` 的**全域倍數**——同一道縫被切成多筆子段時
 * 斜線仍然接得起來。每段恰裁到矩形邊界：端點必落在四條邊之一。
 *
 * 純函式（不碰 DOM）：`d` 只含 `M x y L x y` 對，退化段（零長度）略過。
 */
export function hatchPathD(rect: Rect, spacingCm: number = HATCH_SPACING_CM): string {
  const cLo = rect.x0 + rect.y0
  const cHi = rect.x1 + rect.y1
  const span = cHi - cLo
  if (!(span > 0) || !(spacingCm > 0)) return ''
  const step = span / spacingCm > HATCH_MAX_LINES ? span / HATCH_MAX_LINES : spacingCm
  const first = Math.ceil(cLo / step) * step
  const segments: string[] = []
  for (let k = 0; ; k++) {
    const c = first + k * step
    if (c >= cHi) break
    if (c <= cLo) continue
    const xa = Math.max(rect.x0, c - rect.y1)
    const xb = Math.min(rect.x1, c - rect.y0)
    if (xb - xa <= 0) continue
    segments.push(`M ${fmt(xa)} ${fmt(c - xa)} L ${fmt(xb)} ${fmt(c - xb)}`)
  }
  return segments.join(' ')
}

/**
 * CAD 式尺寸線幾何（G3）：沿**間距軸**橫跨整條縫、位於重疊段正中；數值
 * 錨點取同一點（`text-anchor="middle"`）。`Corridor.rect` 的語意見 D4／
 * `clearance.ts` 的 `materialize()`——間距軸那一邊即縫寬，另一邊為重疊段。
 */
export function dimensionGeometry(c: Corridor): {
  x1: number
  y1: number
  x2: number
  y2: number
  tx: number
  ty: number
} {
  const r = c.rect
  if (c.axis === 'x') {
    const mid = (r.y0 + r.y1) / 2
    return { x1: r.x0, y1: mid, x2: r.x1, y2: mid, tx: (r.x0 + r.x1) / 2, ty: mid }
  }
  const mid = (r.x0 + r.x1) / 2
  return { x1: mid, y1: r.y0, x2: mid, y2: r.y1, tx: mid, ty: (r.y0 + r.y1) / 2 }
}

/**
 * 某一**世界**面外側的「需留」帶（D5）：家具有效外框沿該面外推 `need` cm，
 * 再裁到外接框內（`bounds` 為 `normalize()` 輸出，由 `board.ts` 傳入）。
 * 裁切後非正面積（家具已貼框、帶整條落在框外）回 `null`——不畫，該面的
 * 文字等價仍由 report-list 承載。
 */
export function sideBandRect(
  rect: Rect,
  side: Side,
  need: number,
  bounds: Rect | null,
): Rect | null {
  if (!(need > 0)) return null
  let band: Rect
  if (side === 'N') band = { x0: rect.x0, y0: rect.y0 - need, x1: rect.x1, y1: rect.y0 }
  else if (side === 'S') band = { x0: rect.x0, y0: rect.y1, x1: rect.x1, y1: rect.y1 + need }
  else if (side === 'W') band = { x0: rect.x0 - need, y0: rect.y0, x1: rect.x0, y1: rect.y1 }
  else band = { x0: rect.x1, y0: rect.y0, x1: rect.x1 + need, y1: rect.y1 }
  if (bounds !== null) {
    band = {
      x0: Math.max(band.x0, bounds.x0),
      y0: Math.max(band.y0, bounds.y0),
      x1: Math.min(band.x1, bounds.x1),
      y1: Math.min(band.y1, bounds.y1),
    }
  }
  if (band.x1 - band.x0 <= 0 || band.y1 - band.y0 <= 0) return null
  return band
}

// ── 型別 ─────────────────────────────────────────────────────────────

/** 兩支 render 函式的完整輸入（純資料；不查 document、不讀 DOM 尺寸）。 */
export interface OverlayContext {
  plan: RoomPlan
  ui: UiState
  /** `null`＝尚未分析（M2 路徑）；`overlay-dynamic` 此時為空。 */
  report: ClearanceReport | null
  /** `normalize().bounds`；由 `board.ts` 傳入既有結果，避免重跑 D9 正規化。 */
  bounds: Rect
  messages: Messages
  /** 每 cm 的渲染 px（`board.labelScale()`）；`10 * scale < 9` 時隱藏數值。 */
  scale: number
}

/**
 * 跨幀保存的 key 表（D10 原地更新硬契約）。五張表各管一類節點，
 * `createOverlayState()` 建一次、由 `board.ts` 持有。
 */
export interface OverlayState {
  /** `overlay-dynamic`：通道群組，key ＝ `corridorKey()`。 */
  corridors: Map<string, SVGGElement>
  /** `overlay-dynamic`：碰撞框，key ＝ `col|{a}|{b}`。 */
  collisions: Map<string, SVGRectElement>
  /** `overlay-dynamic`：各面需留違規帶，key ＝ `sidev|{id}|{side}`。 */
  sideViolations: Map<string, SVGRectElement>
  /** `overlay-dynamic`：門迴旋區違規框，key ＝ `doorv|{doorId}|{itemId}`。 */
  doorViolations: Map<string, SVGRectElement>
  /** `overlay-static`：各面需留標示帶，key ＝ `need|{id}|{side}`。 */
  needs: Map<string, SVGRectElement>
}

export function createOverlayState(): OverlayState {
  return {
    corridors: new Map(),
    collisions: new Map(),
    sideViolations: new Map(),
    doorViolations: new Map(),
    needs: new Map(),
  }
}

// ── DOM 小工具（一律走 createElementNS／setAttribute／textContent）──

function createSvgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag)
}

function setAttrs(el: Element, attrs: Readonly<Record<string, string | number>>): void {
  for (const name of Object.keys(attrs)) {
    const value = attrs[name]
    el.setAttribute(name, typeof value === 'number' ? String(value) : value)
  }
}

/**
 * key 差集更新（與 `board.ts` 的同名私有工具同一套語意，刻意各自持有一份
 * ——DOM 層葉節點之間不互相 import，避免 `board → overlay → board` 的環）：
 * 缺的建、有的原地更新、消失的移除，既有節點永不重建。
 */
function syncKeyed<T, E extends Element>(
  parent: Element,
  map: Map<string, E>,
  entries: readonly T[],
  keyOf: (entry: T) => string,
  create: (entry: T) => E,
  update: (node: E, entry: T) => void,
): void {
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = keyOf(entry)
    seen.add(key)
    let node = map.get(key)
    if (node === undefined) {
      node = create(entry)
      map.set(key, node)
      parent.appendChild(node)
    }
    update(node, entry)
  }
  for (const [key, node] of map) {
    if (seen.has(key)) continue
    node.remove()
    map.delete(key)
  }
}

function createRect(className: string): SVGRectElement {
  const el = createSvgElement('rect')
  setAttrs(el, { class: className, 'vector-effect': 'non-scaling-stroke' })
  return el
}

/** 寫入矩形四屬性；零厚（卡在牆線上的碰撞）亦合法，故寬高夾到 ≥0。 */
function setRect(el: SVGRectElement, r: Rect): void {
  setAttrs(el, {
    x: r.x0,
    y: r.y0,
    width: Math.max(0, r.x1 - r.x0),
    height: Math.max(0, r.y1 - r.y0),
  })
}

/** 標籤隱藏門檻（OQ2 同一精神）：渲染字級 < 9 px 即隱藏，回大時移除屬性。 */
function applyTextVisibility(el: Element, scale: number): void {
  if (DIMENSION_FONT_SIZE * scale < LABEL_HIDE_BELOW_PX) el.setAttribute('visibility', 'hidden')
  else el.removeAttribute('visibility')
}

// ── 通道群組的子部件（內層 key 差集）────────────────────────────────

/** 一個通道群組可能有的四種子部件；以 `data-part` 為內層 key。 */
type PartName = 'hatch' | 'rect' | 'line' | 'text'

const PART_TAG: Readonly<Record<PartName, 'path' | 'rect' | 'line' | 'text'>> = {
  hatch: 'path',
  rect: 'rect',
  line: 'line',
  text: 'text',
}

const PART_CLASS: Readonly<Record<PartName, string>> = {
  hatch: 'hatch',
  rect: 'corridor-rect',
  line: 'dimension',
  text: 'dimension-text',
}

function findPart(group: SVGGElement, part: PartName): SVGElement | null {
  for (let i = 0; i < group.children.length; i++) {
    const child = group.children.item(i)
    if (child !== null && child.getAttribute('data-part') === part) return child as SVGElement
  }
  return null
}

function ensurePart(group: SVGGElement, part: PartName): SVGElement {
  const found = findPart(group, part)
  if (found !== null) return found
  const el = createSvgElement(PART_TAG[part])
  setAttrs(el, { class: PART_CLASS[part], 'data-part': part })
  if (part === 'text') {
    setAttrs(el, {
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-size': DIMENSION_FONT_SIZE,
    })
  } else {
    // 螢幕恆定線寬（D1／D10）：斜線、外框、尺寸線三者皆須。
    setAttrs(el, { 'vector-effect': 'non-scaling-stroke' })
  }
  group.appendChild(el)
  return el
}

/** 移除本幀不需要的子部件（外層群組本身留著，不整批替換）。 */
function pruneParts(group: SVGGElement, wanted: readonly PartName[]): void {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const child = group.children.item(i)
    if (child === null) continue
    const part = child.getAttribute('data-part')
    if (part === null || !wanted.includes(part as PartName)) child.remove()
  }
}

/**
 * 本幀該畫哪些部件（D3／D4 呈現規則的唯一落點）。回空陣列＝整個群組不該
 * 存在，外層差集據此把節點移除。
 */
function partsFor(c: Corridor, ui: UiState): PartName[] {
  if (c.kind === 'doorway' || c.kind === 'suppressed') {
    // 不評級：只在「顯示距離」下看尺寸線（門洞以門洞尺寸線顯示，D4）。
    return ui.showDistance ? ['line', 'text'] : []
  }
  if (c.level === 'narrow') return ui.showWarnings ? ['hatch', 'rect', 'text'] : []
  if (c.level === 'tight') return ui.showWarnings ? ['text'] : []
  if (c.level === 'ok') return ui.showDistance ? ['line', 'text'] : []
  return [] // touch：貼齊，灰、不標。
}

/**
 * 拖移期節點預算（T3.4；OQ5 定案第 (1) 項，D10 render）：`ui.dragging`
 * 非 null 時 `overlay-dynamic` **只畫 `narrow` 通道與碰撞**——`narrow` 占
 * 候選 19–20%，連同砍掉的 `tight`／`ok`／門洞／`suppressed`／各面需留／
 * 門違規，約砍去 3/4 節點。`tight`／`ok` 的尺寸線 commit 後再畫。
 *
 * 這是「畫不畫」的取捨，**不影響任何計算**：report 仍由 `clearance.ts`
 * 照算，report-list 的文字等價也照列（PLAN §Frontend Accessibility）。
 */
export function visibleWhileDragging(c: Corridor): boolean {
  return c.kind === 'corridor' && c.level === 'narrow'
}

/** 群組 class 的分級字尾：評級筆用 `level`，不評級筆用 `kind`。 */
function gradeOf(c: Corridor): string {
  if (c.kind !== 'corridor') return c.kind
  return c.level ?? 'touch'
}

/** 數值文字（D3／D4）：門洞冠「門洞」、`tight` 附「偏窄」，其餘只有整數縫寬。 */
function corridorText(c: Corridor, messages: Messages): string {
  if (c.kind === 'doorway') return `${messages.report.kind.doorway} ${c.gap}`
  if (c.kind === 'corridor' && c.level === 'tight') return `${c.gap} ${messages.report.level.tight}`
  return `${c.gap}`
}

function updateCorridorGroup(group: SVGGElement, c: Corridor, ctx: OverlayContext): void {
  setAttrs(group, { class: `corridor corridor--${gradeOf(c)}`, 'data-key': corridorKey(c) })
  const wanted = partsFor(c, ctx.ui)
  pruneParts(group, wanted)
  const dim = dimensionGeometry(c)
  for (const part of wanted) {
    const el = ensurePart(group, part)
    if (part === 'hatch') {
      el.setAttribute('d', hatchPathD(c.rect))
    } else if (part === 'rect') {
      setRect(el as SVGRectElement, c.rect)
    } else if (part === 'line') {
      setAttrs(el, { x1: dim.x1, y1: dim.y1, x2: dim.x2, y2: dim.y2 })
    } else {
      setAttrs(el, { x: dim.tx, y: dim.ty })
      // 使用者不可控字串，仍一律走 textContent（D7 DOM 寫入不變量）。
      el.textContent = corridorText(c, ctx.messages)
      applyTextVisibility(el, ctx.scale)
    }
  }
}

// ── 對外：兩支 render ────────────────────────────────────────────────

/** 非 deleted 家具的 id → 本體（違規框要回查有效外框）。 */
function itemIndex(plan: RoomPlan): Map<string, Furniture> {
  const map = new Map<string, Furniture>()
  for (const item of plan.items) {
    if (item.deleted === true) continue
    map.set(item.id, item)
  }
  return map
}

/** 需留帶差集用的中介形（key 與幾何都先算好，render 只做 DOM）。 */
interface BandEntry {
  key: string
  rect: Rect
}

/**
 * `overlay-static`（D10）：**各面需留標示**——每件非 deleted、帶
 * `clearances` 的家具，逐面在世界方向外側畫一條淡帶（D5；`worldSide()`
 * 做區域座標→世界方向映射）。屬建議性標示，隨「顯示警示」一起收起。
 *
 * 門迴旋區扇形同樣住在這個群組，但由 `board.ts` 畫（D6）；本函式只動自己
 * key 表裡的節點，兩者共存。
 */
export function renderOverlayStatic(
  g: SVGGElement,
  ctx: OverlayContext,
  state: OverlayState,
): void {
  const entries: BandEntry[] = []
  if (ctx.ui.showWarnings) {
    for (const item of ctx.plan.items) {
      if (item.deleted === true || item.clearances === undefined) continue
      const rect = effectiveRect(item)
      for (const local of SIDE_KEYS) {
        const need = item.clearances[local]
        if (need === undefined) continue
        const band = sideBandRect(rect, worldSide(item.rotation, local), need, ctx.bounds)
        if (band === null) continue
        entries.push({ key: `need|${item.id}|${local}`, rect: band })
      }
    }
  }
  syncKeyed(
    g,
    state.needs,
    entries,
    (entry) => entry.key,
    () => createRect('side-need'),
    (node, entry) => {
      setRect(node, entry.rect)
    },
  )
}

/**
 * `overlay-dynamic`（D10）：通道（尺寸線／斜線紅區／琥珀「偏窄」／門洞）、
 * 碰撞粗虛線框、各面需留違規帶、門迴旋區違規框。四類各自 key 差集，
 * `report` 為 `null` 時整區清空（節點移除，群組本身不動）。
 *
 * **拖移期（`ui.dragging !== null`）走節點預算**（T3.4／OQ5 (1)）：只留
 * `narrow` 通道與碰撞，其餘四類本幀的輸入為空——key 差集據此把既有節點
 * **真的移除**（節點數要降下來才有意義，隱藏不算）。commit 那一幀
 * `dragging` 回 null，同一套差集把它們原樣補回；`narrow` 的群組節點全程
 * 沒離場，故參考不變。
 */
export function renderOverlayDynamic(
  g: SVGGElement,
  ctx: OverlayContext,
  state: OverlayState,
): void {
  const report = ctx.report
  const ui = ctx.ui
  const dragging = ui.dragging !== null
  const items = itemIndex(ctx.plan)

  const corridors =
    report === null
      ? []
      : report.corridors.filter(
          (c) => partsFor(c, ui).length > 0 && (!dragging || visibleWhileDragging(c)),
        )
  syncKeyed(
    g,
    state.corridors,
    corridors,
    corridorKey,
    () => createSvgElement('g'),
    (node, c) => {
      updateCorridorGroup(node, c, ctx)
    },
  )

  const collisions = report !== null && ui.showWarnings ? report.collisions : []
  syncKeyed(
    g,
    state.collisions,
    collisions,
    (col) => `col|${col.a}|${col.b}`,
    () => createRect('collision'),
    (node, col) => {
      setRect(node, col.rect)
    },
  )

  // 各面需留違規（D5）：帶的幾何與 static 同一式，另加虛線框標出「這一面
  // 沒留夠」；未列入 report 的面只有淡帶、沒有虛線框。
  const sideBands: BandEntry[] = []
  if (report !== null && ui.showWarnings && !dragging) {
    for (const violation of report.sideViolations) {
      const item = items.get(violation.id)
      if (item === undefined) continue
      const band = sideBandRect(
        effectiveRect(item),
        violation.worldSide,
        violation.need,
        ctx.bounds,
      )
      if (band === null) continue
      sideBands.push({ key: `sidev|${violation.id}|${violation.side}`, rect: band })
    }
  }
  syncKeyed(
    g,
    state.sideViolations,
    sideBands,
    (entry) => entry.key,
    () => createRect('side-need side-need--violated'),
    (node, entry) => {
      setRect(node, entry.rect)
    },
  )

  const doorBands: BandEntry[] = []
  if (report !== null && ui.showWarnings && !dragging) {
    for (const violation of report.doorViolations) {
      const item = items.get(violation.itemId)
      if (item === undefined) continue
      doorBands.push({
        key: `doorv|${violation.doorId}|${violation.itemId}`,
        rect: effectiveRect(item),
      })
    }
  }
  syncKeyed(
    g,
    state.doorViolations,
    doorBands,
    (entry) => entry.key,
    () => createRect('door-violation'),
    (node, entry) => {
      setRect(node, entry.rect)
    },
  )
}
