/**
 * T2.2 — 畫布 SVG 渲染（(internal design doc) §D1 座標系／
 * viewBox／zoom／`vector-effect`、§D2「拖移期以父 `<g transform>` 位移，
 * commit 才回寫」、§D7「契約——DOM 寫入不變量」、§D10 render
 * （`renderCommit` key diff、overlay 拆 static／dynamic、標籤隱藏門檻
 * OQ2 定案、比例文字＝zoom 倍率）、§Frontend Component tree／
 * Accessibility checklist）。
 *
 * **DOM 寫入不變量（D7）**：本檔所有進 DOM 的字串一律只經
 * `document.createElementNS()`／`setAttribute()`／`textContent` 三條路徑，
 * 不使用任何以字串拼 HTML／SVG 的注入 API，亦不以字串模板拼節點——
 * 家具名稱可為任意使用者輸入（`parsePlan` 只擋控制字元，`<img onerror>`
 * 類字面是合法名稱），必須由 DOM API 自行轉義。`board.dom.test.ts` 以
 * 讀原始碼的方式把這條不變量釘成回歸網。
 *
 * **原地更新硬契約（D10）**：絕不整批替換子節點；家具／方塊／門節點以
 * id 為 key 差集更新（`Map<key, Element>`），既有節點只改屬性不重建——
 * 節點參考穩定是焦點不掉、拖移期 transform 不被抹掉的前提。地板／牆體
 * 矩形條數少且無身分，以「索引池」原地更新（同樣不重建、不整批替換）。
 *
 * 本檔為 DOM 層葉節點：只被 `main.ts`（唯一 orchestrator）與拖移期的
 * `drag.ts` 呼叫，不反向 import 任何 DOM 層模組。畫 floor／walls／items／
 * blocks／doors 與門迴旋區（`overlay-static`）；分析層兩個 overlay 群組的
 * 內容（通道尺寸線、斜線紅區、碰撞框、各面需留、門違規）委由 `overlay.ts`
 * （T3.1）渲染——本檔只負責建群組、算渲染比例、在提交時呼叫它。
 *
 * ── T5.1／T5.2（M5 UX 回饋批；TASKS.md Milestone 5 回饋 1／2／5／6／7）──
 *
 * 1. **房間尺寸標註**（回饋 1／5）：`overlay-static` 增一組 key 差集節點
 *    （`dim|…`）——外接框北緣上方的寬度尺寸線、西緣左方的深度尺寸線、每個
 *    方塊的「寬×深」、每扇合法門的門寬。標註畫在 `bounds` **之外**，故
 *    `fitViewBox()` 吃的是加了 `FIT_MARGIN_CM` 邊距的框；`getRoomBounds()`
 *    仍回未加邊距的 `normalize()` 外接框（overlay 的需留帶要裁到房內）。
 * 2. **家具標籤溢出**（回饋 7）：`labelLayout()` 純函式決定 normal／
 *    vertical（−90°）／squeeze（`textLength`）／hidden 四態，`renderCommit`
 *    原地改屬性；`aria-label` 一律不受影響（文字等價恆完整）。
 * 3. **門命中區**（回饋 2／6）：門節點在可見門扇**之前**加兩塊透明命中形
 *    ——迴旋區扇形 `<path>` 與門扇加厚 12 cm 的 `<rect>`。兩者屬
 *    `node--door`，`drag.ts` 既有的 `closest('[data-kind][data-id]')` 委派
 *    因此直接生效；命中區**不受**「顯示迴旋區」開關影響（開關只管畫不畫
 *    `overlay-static` 的那片 arc，關掉仍要拖得到門）。
 */
import { autoFgIsBlack } from '../../src/lib/color.js'
import { doorGeometry, withDerivedWall, type DoorGeometry } from './door.js'
import { fitViewBox, viewScale, type BoardRect, type Rect, type ViewBox } from './geometry.js'
import type { Messages } from './messages.js'
import {
  DEFAULT_ROOM,
  effectiveRect,
  type ClearanceReport,
  type Door,
  type Furniture,
  type RoomBlock,
  type RoomPlan,
  type Side,
} from './model.js'
import {
  createOverlayState,
  renderOverlayDynamic,
  renderOverlayStatic,
  type OverlayContext,
} from './overlay.js'
import { normalize } from './room-shape.js'
import { domId } from './serialize.js'
import { LABEL_FONT_SIZE, LABEL_HIDE_BELOW_PX, type UiState } from './ui-state.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 家具／方塊／門節點共同的 `aria-describedby` 落點（`index.html` 的操作說明句）。 */
const HINT_ID = 'board-hint'

/**
 * 方塊種類的可及名稱前綴。`messages.ts`（T1.3）v1 未開這兩個鍵，且本
 * sprint 不得修改該檔；故前綴在此以字面值落地，**組句仍複用**
 * `messages.ui.board.itemAriaLabel`（格式逐字相同：
 * `{名稱} {寬}×{深} cm，位置 {x},{y}`），日後補 `Messages` 鍵時只需換掉
 * 這張表、不動組句。
 */
const BLOCK_KIND_NAME: Readonly<Record<RoomBlock['kind'], string>> = {
  extend: '凸出區',
  cutout: '凹入區',
}

/** 門節點可及名稱前綴（同 `BLOCK_KIND_NAME` 的理由）。 */
const DOOR_NAME = '門'

/**
 * 尺寸標註的長度單位字（T5.1）。`messages.ts` v1 未開此鍵且本批不得修改該
 * 檔（lane B 持有），故在此以字面值落地——**待 T5.4 補進 `Messages`**。
 */
const DIM_UNIT = 'cm'

/** 尺寸標註字級（user unit；與 `style.css` 的 `.dim-text` 同值）。 */
export const DIM_FONT_SIZE = 11

/** 尺寸線離外接框邊緣的距離（cm）。 */
export const DIM_OFFSET_CM = 12

/** 尺寸線兩端短刻度的半長（cm）。 */
const DIM_TICK_CM = 3

/** 尺寸數值文字再往外推的距離（cm；`DIM_OFFSET_CM` 之外）。 */
const DIM_TEXT_CM = 6

/** 門寬標註自門扇往**室內**內推的距離（cm）。 */
const DIM_DOOR_INSET_CM = 6

/**
 * 方塊尺寸標註自方塊左上角內推的距離（cm，T5.5b M5 回饋批）：標籤原本置中
 * 會與塞滿方塊的家具（如玄關 60 cm 衣櫃）的直放標籤重疊，故改釘左上角。
 */
const DIM_BLOCK_INSET_CM = 4

/**
 * fit 時外接框四周預留的邊距（cm，T5.1）。房間尺寸標註畫在 `bounds`
 * **之外**（北緣上方／西緣左方各 `DIM_OFFSET_CM`，文字再外推
 * `DIM_TEXT_CM`、半個字高 5.5），不留這段邊距就會被 viewBox 裁掉。
 * `getRoomBounds()` 回的仍是未加邊距的 `normalize()` 外接框。
 */
export const FIT_MARGIN_CM = 24

/** 門扇命中帶自牆線往室內加厚的厚度（cm，T5.2）。 */
export const DOOR_HIT_CM = 12

/**
 * 「室內」在垂直牆面那一軸的符號（＝`door.ts` 的 `INWARD`，該表未 export；
 * 此處為繪製用途重列一份，語意以 D6 為準：牆在北 → 室內在南(+y)）。
 */
const INWARD_SIGN: Readonly<Record<Side, 1 | -1>> = { N: 1, S: -1, E: -1, W: 1 }

/** 家具標籤左右各留的內距（cm）。 */
const LABEL_PAD_CM = 4

/** `squeeze` 的下限：可用寬度 / 估計寬度低於此值就改隱藏（壓過頭不可讀）。 */
export const LABEL_SQUEEZE_MIN = 0.6

/** 畫布依賴注入（`svg` 由 `main.ts` 自 `index.html` 取得；本檔不查 document）。 */
export interface BoardDeps {
  svg: SVGSVGElement
  /** 「目前比例」文字節點；缺席時不寫倍率文字。 */
  zoomLabel?: HTMLElement | null
  messages: Messages
  /**
   * 畫布 DOM 盒（測試與 jsdom 承接用；缺席時退回
   * `svg.getBoundingClientRect()`——jsdom 下恆全零，見 D2）。
   */
  getBoardRect?: () => BoardRect
}

/** 可拖移節點的三種身分（DOM id 恆為 `{kind}-{id}`，D7：裸 id 不進 DOM）。 */
export type NodeKind = 'item' | 'block' | 'door'

/** 四圖層（overlay 依 D10 拆 static／dynamic 兩個子群組）。 */
export interface BoardLayers {
  floor: SVGGElement
  walls: SVGGElement
  items: SVGGElement
  doors: SVGGElement
  overlayStatic: SVGGElement
  overlayDynamic: SVGGElement
}

export interface Board {
  /**
   * 全量提交渲染（D10）：地板／牆體／家具／方塊／門＋門迴旋區，並依
   * `ui` 套 viewBox、roving tabindex 與標籤隱藏門檻。既有節點一律原地
   * 更新；離場節點才移除。`report` 為 M3（`overlay-dynamic`）的輸入，
   * M2 不消費。
   *
   * **T3.4c 拖曳中凍結 viewBox（PLAN §D1／§D2）**：`ui.dragging` 非 null
   * 時（方塊／門拖移期每幀都會呼叫本函式重推房型）`bounds` 仍照常更新
   * 為本幀的 `normalize()` 外接框（供 `getBounds()`／放開後的 fit 使用），
   * 但**不**呼叫 `setView()`——viewBox 屬性維持上一次提交的值，避免拖曳
   * 中途外接框變大讓 `pxToCm` 的映射基準跳動。放開（`ui.dragging` 回
   * null）那一幀才依本幀 `zoom`／`panX`／`panY` 重新 fit。
   */
  renderCommit(plan: RoomPlan, ui: UiState, report: ClearanceReport | null): void
  /**
   * 只重畫分析層兩個 overlay 群組（T3.1）。不動 items／doors／viewBox，
   * 也不重跑 `normalize()`——沿用最近一次 `renderCommit` 的外接框（拖移
   * 家具不會改變房型），故**首次 `renderCommit()` 之後即可單獨呼叫**。
   *
   * **T3.4 拖移期接線**：每幀 `renderDrag(id, kind, x, y)` 之後呼叫
   * `renderOverlay(present, ui, report)`，其中 `ui.dragging` 非 null、
   * `report` 為 `clearanceForMoved()` 的增量報告；`overlay.ts` 據
   * `ui.dragging` 自行套節點預算（只畫 `narrow`＋碰撞）。commit 那一幀
   * 回到 `renderCommit()`、`ui.dragging` 為 null，其餘節點原樣補回。
   */
  renderOverlay(plan: RoomPlan, ui: UiState, report: ClearanceReport | null): void
  /** 拖移期位移（D2）：只動被拖節點的 `transform`，不回寫 `x`／`y`、不重算 viewBox。 */
  renderDrag(id: string, kind: NodeKind, x: number, y: number): void
  /** 清掉拖移期的 `transform` 與 `is-dragging`（取消或 commit 前皆可呼叫）。 */
  clearDrag(id: string): void
  /** 依 zoom／pan 改寫 viewBox（D1）＋更新倍率文字與標籤隱藏。 */
  setView(zoom: number, panX: number, panY: number): void
  /** fit ＝ zoom 1、pan 歸零（D1：fit 鈕語意）。 */
  fit(): void
  getViewBox(): ViewBox
  /**
   * 匯出／fit 口徑的外接框＝`normalize()` 外接框**加 `FIT_MARGIN_CM`
   * 邊距**（T5.1）。`io-png.ts` 檔頭契約明文「`bounds` 為
   * `board.getBounds()` 的外接框——與 `viewBox` 同一口徑，故
   * `widthPx`／`heightPx` 與 `viewBox` 等比」，故加了邊距的 viewBox 必須
   * 由本函式一起改口徑，否則 PNG 會被拉伸。
   */
  getBounds(): Rect
  /** 最近一次 `renderCommit` 的 `normalize()` 外接框（未加邊距）。 */
  getRoomBounds(): Rect
  node(kind: NodeKind, id: string): SVGGElement | null
  /** 可拖移節點，DOM 序（家具 → 方塊 → 門）；已刪除家具不在列。 */
  draggableNodes(): SVGGElement[]
  focus(kind: NodeKind, id: string): void
  readonly layers: BoardLayers
}

// ── 純函式 ───────────────────────────────────────────────────────────

/**
 * 渲染字級所乘的縮放倍率（OQ2 定案，D10）：優先取真實
 * `getScreenCTM().a`；jsdom 無此 API（D2 實證）時以純函式
 * `viewScale()`＝`min(boardW/vbW, boardH/vbH)` 承接；畫布盒寬高為 0
 * （jsdom 的 SVG `getBoundingClientRect()` 恆全零）則回 1，令標籤可見
 * ——測試環境不應因量不到尺寸而把標籤判為隱藏。
 */
export function labelScale(svg: SVGSVGElement, boardRect: BoardRect, vb: ViewBox): number {
  const ctmA = svg.getScreenCTM?.()?.a
  if (typeof ctmA === 'number' && Number.isFinite(ctmA) && ctmA > 0) return ctmA
  if (!(boardRect.width > 0) || !(boardRect.height > 0)) return 1
  const { scale } = viewScale(boardRect, vb)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

/**
 * 迴旋區四分之一圓扇形的 `d`（D6 開象限表）：自鉸鏈拉到門扇端點、沿
 * 半徑＝門寬的圓弧掃到開象限的另一軸、再收回鉸鏈。sweep-flag 由
 * 「門扇向量 × 開向向量」的外積符號決定（>0 ＝螢幕順時針＝1），
 * 八種象限共用同一式，無三角函式。
 */
export function swingPathD(geom: DoorGeometry): string {
  const hx = geom.hinge.x
  const hy = geom.hinge.y
  const radius = geom.span.hi - geom.span.lo
  const alongX = geom.span.axis === 'x'
  const far = (geom.span.lo === (alongX ? hx : hy) ? geom.span.hi : geom.span.lo)
  const tipX = alongX ? far : hx
  const tipY = alongX ? hy : far
  const endX = alongX ? hx : hx + geom.quadrant.xSign * radius
  const endY = alongX ? hy + geom.quadrant.ySign * radius : hy
  const cross = (tipX - hx) * (endY - hy) - (tipY - hy) * (endX - hx)
  const sweep = cross > 0 ? 1 : 0
  return `M ${hx} ${hy} L ${tipX} ${tipY} A ${radius} ${radius} 0 0 ${sweep} ${endX} ${endY} Z`
}

/**
 * 門扇加厚成命中帶（T5.2）：以牆線上的零厚門扇為底，往**室內**加厚
 * `DOOR_HIT_CM`。東牆（鉸鏈 x=360、跨距 y∈[200,270]）→ x∈[348,360]、
 * y∈[200,270]。純函式，不碰 DOM。
 */
export function doorHitRect(geom: DoorGeometry): Rect {
  const inward = INWARD_SIGN[geom.wall]
  if (geom.span.axis === 'x') {
    const wallY = geom.leaf.y0
    const y0 = inward === 1 ? wallY : wallY - DOOR_HIT_CM
    return { x0: geom.span.lo, y0, x1: geom.span.hi, y1: y0 + DOOR_HIT_CM }
  }
  const wallX = geom.leaf.x0
  const x0 = inward === 1 ? wallX : wallX - DOOR_HIT_CM
  return { x0, y0: geom.span.lo, x1: x0 + DOOR_HIT_CM, y1: geom.span.hi }
}

/**
 * 字串的估計繪製寬度（T5.1）：CJK／全形字算 1 個字級、其餘算 0.55 個
 * （system-ui 西文平均字寬的保守值）。CJK 判準＝code point ≥ 0x2E80
 * （CJK 部首補充起點）或落在全形區 0xFF00–0xFFEF。以 code point 迭代
 * （`for…of`），代理對不會被算成兩個字。
 */
export function estimateTextWidth(name: string, fontSize: number): number {
  let units = 0
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0
    units += cp >= 0x2e80 || (cp >= 0xff00 && cp <= 0xffef) ? 1 : 0.55
  }
  return fontSize * units
}

/** 家具標籤的四種呈現（`labelLayout()` 的輸出，T5.1 回饋 7）。 */
export type LabelMode = 'normal' | 'vertical' | 'squeeze' | 'hidden'

export interface LabelLayout {
  mode: LabelMode
  /** `squeeze` 專用：`<text textLength>`（user unit）。 */
  textLength?: number
  /** `vertical` 專用：繞矩形中心旋轉的角度。 */
  rotate?: -90
}

/**
 * 家具名稱標籤的溢出規則（T5.1，TASKS M5 回饋 7「60 cm 衣櫃的名稱壓到
 * 報告文字」）。矩形左右各留 `LABEL_PAD_CM`：
 *
 * 1. 估計寬度放得下 → `normal`；
 * 2. 高瘦（`rectH > rectW`）且直放放得下 → `vertical`（繞中心 −90°）；
 * 3. 可用長度 / 估計寬度 ≥ `LABEL_SQUEEZE_MIN` → `squeeze`
 *    （`textLength` ＋ `lengthAdjust="spacingAndGlyphs"`）；
 * 4. 否則 `hidden`——只藏**視覺**文字，`aria-label` 與 report-list 的文字
 *    等價一概不受影響（PLAN §Frontend Accessibility）。
 *
 * 純函式，不碰 DOM（測試以定值表直測）。
 */
export function labelLayout(
  name: string,
  rectW: number,
  rectH: number,
  fontSize: number,
): LabelLayout {
  const estimated = estimateTextWidth(name, fontSize)
  if (!(estimated > 0)) return { mode: 'normal' }
  const availW = rectW - LABEL_PAD_CM * 2
  const availH = rectH - LABEL_PAD_CM * 2
  if (estimated <= availW) return { mode: 'normal' }
  const tall = rectH > rectW
  if (tall && estimated <= availH) return { mode: 'vertical', rotate: -90 }
  // 壓縮沿「較長的那條可用邊」進行；高瘦者壓縮後仍直放。
  const vertical = tall && availH > availW
  const available = vertical ? availH : availW
  if (available > 0 && available / estimated >= LABEL_SQUEEZE_MIN) {
    return vertical
      ? { mode: 'squeeze', textLength: available, rotate: -90 }
      : { mode: 'squeeze', textLength: available }
  }
  return { mode: 'hidden' }
}

/** 外接框四周加 `margin`（T5.1：尺寸標註住在框外，viewBox 要含得下）。 */
export function padRect(r: Rect, margin: number): Rect {
  return { x0: r.x0 - margin, y0: r.y0 - margin, x1: r.x1 + margin, y1: r.y1 + margin }
}

/** 尺寸線（含兩端短刻度）的單一 `<path>` `d`；`axis` 為尺寸線本身的方向。 */
export function dimensionPathD(
  axis: 'x' | 'y',
  lo: number,
  hi: number,
  offset: number,
  tick: number = DIM_TICK_CM,
): string {
  if (axis === 'x') {
    return (
      `M ${lo} ${offset} L ${hi} ${offset}` +
      ` M ${lo} ${offset - tick} L ${lo} ${offset + tick}` +
      ` M ${hi} ${offset - tick} L ${hi} ${offset + tick}`
    )
  }
  return (
    `M ${offset} ${lo} L ${offset} ${hi}` +
    ` M ${offset - tick} ${lo} L ${offset + tick} ${lo}` +
    ` M ${offset - tick} ${hi} L ${offset + tick} ${hi}`
  )
}

/** 一筆尺寸標註（key 差集的中介形；幾何先算好，render 只做 DOM）。 */
export interface DimEntry {
  key: string
  /** 尺寸線的 `d`；`null` ＝只有文字（方塊／門）。 */
  d: string | null
  x: number
  y: number
  text: string
  /** 文字是否繞自身錨點轉 −90°（深度尺寸線）。 */
  rotate: boolean
  /** 文字的附加 class（方塊標註淡一階）。 */
  extraClass: string | null
  /** `text-anchor`；預設沿用房間／門既有的置中風格。 */
  anchor?: 'start' | 'middle'
  /** `dominant-baseline`；預設沿用房間／門既有的置中風格。 */
  baseline?: 'hanging' | 'middle'
  /**
   * T5.5b：方塊標籤錨點被家具有效外框覆蓋時為 `true`——標籤與塞滿方塊的
   * 家具標籤重疊，且 props 面板已顯示同一組尺寸，故隱藏冗餘的視覺文字。
   */
  hidden?: boolean
}

/** 點是否落在矩形內（含邊界）；方塊標籤錨點的覆蓋判定用（T5.5b）。 */
export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1
}

/**
 * 本幀該畫的尺寸標註（T5.1）：外接框寬／深各一筆，每個方塊一筆
 * 「寬×深」，每扇**合法**門一筆門寬。純函式：輸入已正規化的幾何，
 * 輸出 key 與座標，不碰 DOM。
 *
 * **T5.5b**：`items`（已濾掉 `deleted` 的家具）供方塊標籤的覆蓋判定——
 * 標籤釘在方塊左上角內推 `DIM_BLOCK_INSET_CM`，任一家具的有效外框蓋住這個
 * 錨點就標 `hidden: true`（塞滿方塊的家具本身已有尺寸標籤，props 面板也
 * 顯示同一組尺寸，此時方塊標籤是冗餘且會與家具的直放標籤重疊）。
 */
export function dimensionEntries(
  bounds: Rect,
  blocks: readonly RoomBlock[],
  doors: readonly { door: Door; geom: DoorGeometry }[],
  items: readonly Furniture[] = [],
): DimEntry[] {
  const entries: DimEntry[] = []
  const width = bounds.x1 - bounds.x0
  const depth = bounds.y1 - bounds.y0
  const northY = bounds.y0 - DIM_OFFSET_CM
  const westX = bounds.x0 - DIM_OFFSET_CM
  entries.push({
    key: 'dim|w',
    d: dimensionPathD('x', bounds.x0, bounds.x1, northY),
    x: (bounds.x0 + bounds.x1) / 2,
    y: northY - DIM_TEXT_CM,
    text: `${width} ${DIM_UNIT}`,
    rotate: false,
    extraClass: null,
  })
  entries.push({
    key: 'dim|d',
    d: dimensionPathD('y', bounds.y0, bounds.y1, westX),
    x: westX - DIM_TEXT_CM,
    y: (bounds.y0 + bounds.y1) / 2,
    text: `${depth} ${DIM_UNIT}`,
    rotate: true,
    extraClass: null,
  })
  for (const block of blocks) {
    const anchorX = block.x + DIM_BLOCK_INSET_CM
    const anchorY = block.y + DIM_BLOCK_INSET_CM
    const covered = items.some((item) => pointInRect(anchorX, anchorY, effectiveRect(item)))
    entries.push({
      key: `dim|block|${block.id}`,
      d: null,
      x: anchorX,
      y: anchorY,
      text: `${block.width}×${block.depth}`,
      rotate: false,
      extraClass: 'dim-text--block',
      anchor: 'start',
      baseline: 'hanging',
      hidden: covered,
    })
  }
  for (const { door, geom } of doors) {
    const inward = INWARD_SIGN[geom.wall]
    const midX = (geom.leaf.x0 + geom.leaf.x1) / 2
    const midY = (geom.leaf.y0 + geom.leaf.y1) / 2
    entries.push({
      key: `dim|door|${door.id}`,
      d: null,
      x: geom.span.axis === 'x' ? midX : midX + inward * DIM_DOOR_INSET_CM,
      y: geom.span.axis === 'x' ? midY + inward * DIM_DOOR_INSET_CM : midY,
      text: `${door.width}`,
      rotate: false,
      extraClass: null,
    })
  }
  return entries
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

function readClasses(el: Element): string[] {
  const raw = el.getAttribute('class')
  if (raw === null) return []
  return raw.split(/\s+/).filter((token) => token !== '')
}

/** 加一個 class token（不動其餘 token；不使用 `classList`——SVG 端行為在 jsdom 下不一致）。 */
function addClass(el: Element, token: string): void {
  const classes = readClasses(el)
  if (classes.includes(token)) return
  classes.push(token)
  el.setAttribute('class', classes.join(' '))
}

function removeClass(el: Element, token: string): void {
  const classes = readClasses(el)
  if (!classes.includes(token)) return
  el.setAttribute('class', classes.filter((c) => c !== token).join(' '))
}

/** 整組覆寫 class（`renderCommit` 用：一併清掉拖移期殘留的 `is-dragging`）。 */
function setClasses(el: Element, classes: readonly string[]): void {
  el.setAttribute('class', classes.join(' '))
}

/**
 * 既有圖層：以 id 在 `<svg>` 子樹內取得（不查 document——`index.html`
 * 的其餘部分屬 lane A）。缺席時就地補建，讓本檔在最小 fixture 下亦可用。
 */
function resolveLayer(svg: SVGSVGElement, id: string, parent: Element): SVGGElement {
  const found = svg.querySelector(`#${id}`)
  if (found !== null) return found as SVGGElement
  const group = createSvgElement('g')
  group.setAttribute('id', id)
  parent.appendChild(group)
  return group
}

/** 索引池原地更新：前 n 個重用（只改屬性）、多出來的自尾端移除。 */
function syncRectPool(
  layer: SVGGElement,
  pool: SVGRectElement[],
  rects: readonly Rect[],
  className: string,
): SVGRectElement[] {
  for (let i = 0; i < rects.length; i++) {
    let el: SVGRectElement | undefined = i < pool.length ? pool[i] : undefined
    if (el === undefined) {
      el = createSvgElement('rect')
      setAttrs(el, { class: className, 'vector-effect': 'non-scaling-stroke' })
      pool.push(el)
      layer.appendChild(el)
    }
    const r = rects[i]
    setAttrs(el, { x: r.x0, y: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 })
  }
  while (pool.length > rects.length) {
    const extra = pool.pop()
    if (extra !== undefined) extra.remove()
  }
  return pool
}

/**
 * key 差集更新（D10）：缺的建、有的原地更新、消失的移除；回傳依
 * `entries` 序排好的節點陣列。**既有節點永不重建**——回傳的是同一批
 * 物件參考。
 */
function syncKeyed<T, E extends Element>(
  parent: Element,
  map: Map<string, E>,
  entries: readonly T[],
  keyOf: (entry: T) => string,
  create: (entry: T) => E,
  update: (node: E, entry: T) => void,
): E[] {
  const seen = new Set<string>()
  const ordered: E[] = []
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
    ordered.push(node)
  }
  for (const [key, node] of map) {
    if (seen.has(key)) continue
    node.remove()
    map.delete(key)
  }
  return ordered
}

/**
 * 把 `nodes` 排成 `parent` 自 `offset` 起的連續子節點序（DOM 序＝資料序
 * ＝Tab 序）。常態下零搬移；只有「刪掉後再還原」這類會讓建立序偏離資料
 * 序的路徑才真的 `insertBefore`（搬移不換物件參考）。
 */
function orderChildren(parent: Element, nodes: readonly Element[], offset: number): void {
  for (let i = 0; i < nodes.length; i++) {
    const want = nodes[i]
    const current = parent.children.item(offset + i)
    if (current !== want) parent.insertBefore(want, current)
  }
}

/** 取第 n 個子元素（建立時即固定結構，缺席代表節點被外力破壞）。 */
function childAt(node: Element, index: number): Element | null {
  return node.children.item(index)
}

/**
 * 以 `data-part` 取子部件（門節點與尺寸標註用；同 `overlay.ts` 的內層
 * key 慣例）。子節點數個位數，線性掃描即可。
 */
function findPart(node: Element, part: string): Element | null {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children.item(i)
    if (child !== null && child.getAttribute('data-part') === part) return child
  }
  return null
}

function readNumberAttr(el: Element, name: string): number {
  const raw = el.getAttribute(name)
  if (raw === null) return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

// ── 節點工廠（家具／方塊／門）─────────────────────────────────────────

/** 三種可拖移節點共用的骨架屬性（D7 DOM id＋a11y：role／roving／describedby）。 */
function createNodeShell(kind: NodeKind, id: string): SVGGElement {
  const group = createSvgElement('g')
  setAttrs(group, {
    id: domId(kind, id),
    'data-testid': domId(kind, id),
    'data-kind': kind,
    'data-id': id,
    role: 'button',
    tabindex: '-1',
    'aria-describedby': HINT_ID,
  })
  return group
}

function createItemNode(item: Furniture): SVGGElement {
  const group = createNodeShell('item', item.id)
  const rect = createSvgElement('rect')
  setAttrs(rect, { class: 'item-rect', 'vector-effect': 'non-scaling-stroke' })
  const label = createSvgElement('text')
  setAttrs(label, {
    class: 'item-label',
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    'font-size': LABEL_FONT_SIZE,
  })
  group.appendChild(rect)
  group.appendChild(label)
  return group
}

function createBlockNode(block: RoomBlock): SVGGElement {
  const group = createNodeShell('block', block.id)
  const rect = createSvgElement('rect')
  setAttrs(rect, { class: 'block-rect', 'vector-effect': 'non-scaling-stroke' })
  group.appendChild(rect)
  return group
}

/**
 * 門節點（T5.2）：**命中形在前、可見形在後**——`pointerdown` 的
 * `closest()` 只看祖先鏈，前後只影響疊圖；命中形透明且面積大，畫在下面
 * 才不會蓋掉門扇與鉸鏈點的顏色。四個子部件以 `data-part` 為內層 key：
 *
 * - `hit-swing`：迴旋區扇形（`swingPathD()`），**不隨「顯示迴旋區」開關**；
 * - `hit-leaf`：門扇往室內加厚 `DOOR_HIT_CM` 的帶（`doorHitRect()`）；
 * - `leaf`：可見門扇線（粗 4、圓端）；
 * - `hinge`：鉸鏈點，讓門一眼認得出鉸在哪一端。
 */
function createDoorNode(door: Door): SVGGElement {
  const group = createNodeShell('door', door.id)
  const hitSwing = createSvgElement('path')
  setAttrs(hitSwing, { class: 'door-hit door-hit--swing', 'data-part': 'hit-swing' })
  const hitLeaf = createSvgElement('rect')
  setAttrs(hitLeaf, { class: 'door-hit door-hit--leaf', 'data-part': 'hit-leaf' })
  const leaf = createSvgElement('line')
  setAttrs(leaf, {
    class: 'door-leaf',
    'data-part': 'leaf',
    'vector-effect': 'non-scaling-stroke',
  })
  const hinge = createSvgElement('circle')
  setAttrs(hinge, { class: 'door-hinge', 'data-part': 'hinge', r: 3 })
  group.appendChild(hitSwing)
  group.appendChild(hitLeaf)
  group.appendChild(leaf)
  group.appendChild(hinge)
  return group
}

/**
 * 尺寸標註節點（T5.1）：`<g class="dim">`＋（選配）尺寸線＋數值文字。
 * `data-testid` 把 key 的 `|` 換成 `-`（`dim|block|e1` → `dim-block-e1`）
 * ——選擇器字串裡不出現 `|`，測試與 e2e 的屬性選擇器最不容易踩到引擎差異。
 */
function createDimNode(entry: DimEntry): SVGGElement {
  const group = createSvgElement('g')
  setAttrs(group, {
    class: 'dim',
    'data-testid': entry.key.split('|').join('-'),
    'data-key': entry.key,
  })
  if (entry.d !== null) {
    const line = createSvgElement('path')
    setAttrs(line, {
      class: 'dim-line',
      'data-part': 'line',
      'vector-effect': 'non-scaling-stroke',
    })
    group.appendChild(line)
  }
  const text = createSvgElement('text')
  setAttrs(text, {
    class: 'dim-text',
    'data-part': 'text',
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    'font-size': DIM_FONT_SIZE,
  })
  group.appendChild(text)
  return group
}

function createSwingNode(door: Door): SVGPathElement {
  const path = createSvgElement('path')
  setAttrs(path, {
    id: `swing-${door.id}`,
    'data-testid': `swing-${door.id}`,
    class: 'door-swing',
    'vector-effect': 'non-scaling-stroke',
    'aria-hidden': 'true',
  })
  return path
}

// ── 工廠 ─────────────────────────────────────────────────────────────

export function createBoard(deps: BoardDeps): Board {
  const svg = deps.svg
  const messages = deps.messages
  const zoomLabel = deps.zoomLabel ?? null

  const layerFloor = resolveLayer(svg, 'layer-floor', svg)
  const layerWalls = resolveLayer(svg, 'layer-walls', svg)
  const layerItems = resolveLayer(svg, 'layer-items', svg)
  const layerDoors = resolveLayer(svg, 'layer-doors', svg)
  const layerOverlay = resolveLayer(svg, 'layer-overlay', svg)
  const overlayStatic = resolveLayer(svg, 'overlay-static', layerOverlay)
  const overlayDynamic = resolveLayer(svg, 'overlay-dynamic', layerOverlay)
  // a11y（PLAN §Frontend Accessibility）：overlay 純裝飾，資訊由 report-list
  // 以文字等價承載，故整層對輔助技術隱藏。
  layerOverlay.setAttribute('aria-hidden', 'true')

  const overlayState = createOverlayState()

  const floorPool: SVGRectElement[] = []
  const wallPool: SVGRectElement[] = []
  const itemMap = new Map<string, SVGGElement>()
  const blockMap = new Map<string, SVGGElement>()
  const doorMap = new Map<string, SVGGElement>()
  const swingMap = new Map<string, SVGPathElement>()
  /** T5.1 房間尺寸標註（`overlay-static`），key ＝ `dim|…`。 */
  const dimMap = new Map<string, SVGGElement>()

  /** DOM 序的可拖移節點（家具 → 方塊 → 門）；每次 `renderCommit` 重建。 */
  let draggable: SVGGElement[] = []

  /** 最近一次提交的外接框；首次 `renderCommit` 前以預設房尺寸佔位，避免 viewBox 為零寬。 */
  let bounds: Rect = { x0: 0, y0: 0, x1: DEFAULT_ROOM.width, y1: DEFAULT_ROOM.depth }
  let viewBox: ViewBox = fitViewBox(padRect(bounds, FIT_MARGIN_CM), 1, 0, 0)

  function boardRect(): BoardRect {
    return deps.getBoardRect !== undefined ? deps.getBoardRect() : svg.getBoundingClientRect()
  }

  /**
   * 寫 viewBox＋依 OQ2 門檻套用標籤隱藏（`visibility` 屬性，非 `display`
   * ——PNG 匯出取樣才穩定）。兩條隱藏規則在此**合流**：渲染字級
   * < 9 px（OQ2），或 `labelLayout()` 判定該名稱無論如何都放不下
   * （T5.1，由 `updateItemNode` 寫在標籤的 `data-fit` 上）。尺寸標註
   * （T5.1）以自己的字級套同一門檻。
   */
  function applyView(): void {
    setAttrs(svg, { viewBox: `${viewBox.minX} ${viewBox.minY} ${viewBox.w} ${viewBox.h}` })
    const scale = labelScale(svg, boardRect(), viewBox)
    const hidden = LABEL_FONT_SIZE * scale < LABEL_HIDE_BELOW_PX
    for (const node of itemMap.values()) {
      const label = childAt(node, 1)
      if (label === null) continue
      if (hidden || label.getAttribute('data-fit') === 'hidden') {
        label.setAttribute('visibility', 'hidden')
      } else label.removeAttribute('visibility')
    }
    const dimHidden = DIM_FONT_SIZE * scale < LABEL_HIDE_BELOW_PX
    for (const node of dimMap.values()) {
      const text = findPart(node, 'text')
      if (text === null) continue
      // 兩條隱藏規則合流（同 item-label 的 data-fit 模式）：OQ2 字級門檻，
      // 或（T5.5b）方塊標籤錨點被家具蓋住（`data-covered`，見 updateDimText）。
      if (dimHidden || text.getAttribute('data-covered') === 'true') {
        text.setAttribute('visibility', 'hidden')
      } else text.removeAttribute('visibility')
    }
  }

  function updateItemNode(node: SVGGElement, item: Furniture, selectedId: string | null): void {
    const r = effectiveRect(item)
    const classes = ['node', 'node--item']
    if (selectedId === item.id) classes.push('is-selected')
    setClasses(node, classes)
    node.removeAttribute('transform')
    setAttrs(node, {
      'data-x': item.x,
      'data-y': item.y,
      'aria-roledescription': messages.ui.board.itemRoledescription,
      'aria-label': messages.ui.board.itemAriaLabel(
        item.name,
        r.x1 - r.x0,
        r.y1 - r.y0,
        item.x,
        item.y,
      ),
    })
    const rect = childAt(node, 0)
    if (rect !== null) {
      setAttrs(rect, {
        x: r.x0,
        y: r.y0,
        width: r.x1 - r.x0,
        height: r.y1 - r.y0,
        fill: item.color,
      })
    }
    const label = childAt(node, 1)
    if (label !== null) {
      const cx = (r.x0 + r.x1) / 2
      const cy = (r.y0 + r.y1) / 2
      setAttrs(label, {
        x: cx,
        y: cy,
        fill: autoFgIsBlack(item.color) ? '#000000' : '#ffffff',
      })
      // 使用者字串唯一入口：textContent（D7 DOM 寫入不變量）。
      label.textContent = item.name
      // T5.1 溢出四態；`visibility` 統一由 `applyView()` 依 `data-fit` 與
      // OQ2 門檻合流決定（兩條規則共用同一個屬性，不得各寫各的）。
      const layout = labelLayout(item.name, r.x1 - r.x0, r.y1 - r.y0, LABEL_FONT_SIZE)
      label.setAttribute('data-fit', layout.mode)
      if (layout.rotate === -90) label.setAttribute('transform', `rotate(-90 ${cx} ${cy})`)
      else label.removeAttribute('transform')
      if (layout.textLength !== undefined) {
        setAttrs(label, { textLength: layout.textLength, lengthAdjust: 'spacingAndGlyphs' })
      } else {
        label.removeAttribute('textLength')
        label.removeAttribute('lengthAdjust')
      }
    }
  }

  function updateBlockNode(node: SVGGElement, block: RoomBlock, selectedId: string | null): void {
    const classes = ['node', 'node--block', `block--${block.kind}`]
    if (selectedId === block.id) classes.push('is-selected')
    setClasses(node, classes)
    node.removeAttribute('transform')
    setAttrs(node, {
      'data-x': block.x,
      'data-y': block.y,
      'aria-label': messages.ui.board.itemAriaLabel(
        BLOCK_KIND_NAME[block.kind],
        block.width,
        block.depth,
        block.x,
        block.y,
      ),
    })
    const rect = childAt(node, 0)
    if (rect !== null) {
      setAttrs(rect, { x: block.x, y: block.y, width: block.width, height: block.depth })
    }
  }

  function updateDoorNode(
    node: SVGGElement,
    door: Door,
    geom: DoorGeometry,
    attached: boolean,
    selectedId: string | null,
  ): void {
    const classes = ['node', 'node--door']
    if (!attached) classes.push('is-unattached')
    if (selectedId === door.id) classes.push('is-selected')
    setClasses(node, classes)
    node.removeAttribute('transform')
    const swingName = door.swing === 'in' ? messages.ui.door.swingIn : messages.ui.door.swingOut
    setAttrs(node, {
      'data-x': door.x,
      'data-y': door.y,
      'aria-label': `${DOOR_NAME} ${door.width} cm，${messages.ui.door.wallName(geom.wall)}，${swingName}`,
    })
    // T5.2：命中形逐幀原地更新（`data-part` 為內層 key，節點不重建）。
    // 未附著的門同樣給命中區——「拖回牆上」正是使用者要做的事。
    const hitSwing = findPart(node, 'hit-swing')
    if (hitSwing !== null) hitSwing.setAttribute('d', swingPathD(geom))
    const hitLeaf = findPart(node, 'hit-leaf')
    if (hitLeaf !== null) {
      const band = doorHitRect(geom)
      setAttrs(hitLeaf, {
        x: band.x0,
        y: band.y0,
        width: band.x1 - band.x0,
        height: band.y1 - band.y0,
      })
    }
    const leaf = findPart(node, 'leaf')
    if (leaf !== null) {
      setAttrs(leaf, { x1: geom.leaf.x0, y1: geom.leaf.y0, x2: geom.leaf.x1, y2: geom.leaf.y1 })
    }
    const hinge = findPart(node, 'hinge')
    if (hinge !== null) setAttrs(hinge, { cx: geom.hinge.x, cy: geom.hinge.y })
  }

  /** roving tabindex（G7／a11y）：可拖移節點中恰一個 `0`——選中者優先，否則第一個。 */
  function applyRoving(selectedId: string | null): void {
    let target: SVGGElement | null = null
    if (selectedId !== null) {
      for (const node of draggable) {
        if (node.getAttribute('data-id') === selectedId) {
          target = node
          break
        }
      }
    }
    if (target === null && draggable.length > 0) target = draggable[0]
    for (const node of draggable) node.setAttribute('tabindex', node === target ? '0' : '-1')
  }

  function findNode(id: string): SVGGElement | null {
    return itemMap.get(id) ?? blockMap.get(id) ?? doorMap.get(id) ?? null
  }

  function setView(zoom: number, panX: number, panY: number): void {
    // T5.1：fit 的基準框含 `FIT_MARGIN_CM` 邊距——尺寸標註畫在 `bounds`
    // 之外，不留邊距就會被 viewBox 裁掉（`getRoomBounds()` 不受影響）。
    viewBox = fitViewBox(padRect(bounds, FIT_MARGIN_CM), zoom, panX, panY)
    applyView()
    if (zoomLabel !== null) zoomLabel.textContent = `${Math.round(zoom * 100)}%`
  }

  /**
   * 分析層 overlay（T3.1）：渲染比例與標籤隱藏同一口徑（`labelScale()`），
   * `bounds` 取最近一次提交的外接框——需留帶要裁到框內。
   */
  function renderOverlay(plan: RoomPlan, ui: UiState, report: ClearanceReport | null): void {
    const ctx: OverlayContext = {
      plan,
      ui,
      report,
      bounds,
      messages,
      scale: labelScale(svg, boardRect(), viewBox),
    }
    renderOverlayStatic(overlayStatic, ctx, overlayState)
    renderOverlayDynamic(overlayDynamic, ctx, overlayState)
  }

  function renderCommit(plan: RoomPlan, ui: UiState, report: ClearanceReport | null): void {
    const shape = normalize(plan.room)
    bounds = shape.bounds

    syncRectPool(layerFloor, floorPool, shape.floor, 'floor')
    syncRectPool(layerWalls, wallPool, shape.walls, 'wall')

    const blocks = plan.room.blocks
    const blockNodes = syncKeyed(
      layerFloor,
      blockMap,
      blocks,
      (block) => block.id,
      createBlockNode,
      (node, block) => {
        updateBlockNode(node, block, ui.selectedId)
      },
    )
    // 地板矩形在前、方塊節點在後（方塊是可拖移把手，須疊在地板之上）。
    orderChildren(layerFloor, floorPool, 0)
    orderChildren(layerFloor, blockNodes, floorPool.length)

    const items = plan.items.filter((item) => item.deleted !== true)
    const itemNodes = syncKeyed(
      layerItems,
      itemMap,
      items,
      (item) => item.id,
      createItemNode,
      (node, item) => {
        updateItemNode(node, item, ui.selectedId)
      },
    )
    orderChildren(layerItems, itemNodes, 0)

    // 門：`wall` 恆重推（D6 契約 1）；不合法者仍畫門扇但標記未附著、不畫迴旋區。
    const doors = plan.room.doors
    const geometries = new Map<string, { geom: DoorGeometry; attached: boolean }>()
    for (const door of doors) {
      const derived = withDerivedWall(door, shape)
      geometries.set(door.id, {
        geom: doorGeometry(derived ?? door),
        attached: derived !== null,
      })
    }
    const doorNodes = syncKeyed(
      layerDoors,
      doorMap,
      doors,
      (door) => door.id,
      createDoorNode,
      (node, door) => {
        const entry = geometries.get(door.id)
        if (entry === undefined) return
        updateDoorNode(node, door, entry.geom, entry.attached, ui.selectedId)
      },
    )
    orderChildren(layerDoors, doorNodes, 0)

    // 迴旋區（D6「顯示迴旋區」開關只管畫不畫；T5.2：命中區另計，不受此
    // 開關影響）：overlay-static，key `swing-<id>`。
    const swingDoors = plan.settings.showSwing
      ? doors.filter((door) => geometries.get(door.id)?.attached === true)
      : []
    syncKeyed(
      overlayStatic,
      swingMap,
      swingDoors,
      (door) => door.id,
      createSwingNode,
      (node, door) => {
        const entry = geometries.get(door.id)
        if (entry === undefined) return
        node.setAttribute('d', swingPathD(entry.geom))
      },
    )

    // T5.1 房間尺寸標註（同住 overlay-static，key 前綴 `dim|`——與迴旋區
    // 及 `overlay.ts` 的需留帶各走各的 key 表，三者共存互不清除）。
    const validDoors: { door: Door; geom: DoorGeometry }[] = []
    for (const door of doors) {
      const entry = geometries.get(door.id)
      if (entry === undefined || !entry.attached) continue
      validDoors.push({ door, geom: entry.geom })
    }
    syncKeyed(
      overlayStatic,
      dimMap,
      dimensionEntries(bounds, blocks, validDoors, items),
      (entry) => entry.key,
      createDimNode,
      (node, entry) => {
        const line = findPart(node, 'line')
        if (line !== null && entry.d !== null) line.setAttribute('d', entry.d)
        const text = findPart(node, 'text')
        if (text === null) return
        setAttrs(text, {
          x: entry.x,
          y: entry.y,
          class: entry.extraClass === null ? 'dim-text' : `dim-text ${entry.extraClass}`,
          'data-part': 'text',
          'text-anchor': entry.anchor ?? 'middle',
          'dominant-baseline': entry.baseline ?? 'middle',
        })
        if (entry.rotate) text.setAttribute('transform', `rotate(-90 ${entry.x} ${entry.y})`)
        else text.removeAttribute('transform')
        text.textContent = entry.text
        // T5.5b：`visibility` 本身留給 `applyView()` 統一合流（OQ2 字級門檻
        // ＋此處的覆蓋判定），本函式只落地「有沒有被蓋住」這個事實。
        if (entry.hidden === true) text.setAttribute('data-covered', 'true')
        else text.removeAttribute('data-covered')
      },
    )

    draggable = [...itemNodes, ...blockNodes, ...doorNodes]
    applyRoving(ui.selectedId)
    // T3.4c（PLAN §D1／§D2）：拖曳中（`ui.dragging` 非 null）凍結 viewBox——
    // `bounds` 已於上方更新，`getBounds()` 拖曳中即可看到新外接框，但
    // viewBox 屬性本身要等放開才重新 fit。`applyView()` 仍會執行（以現有、
    // 凍結中的 viewBox 重寫同一個屬性值並重跑標籤隱藏門檻），只是不比對
    // `ui.zoom`／`panX`／`panY`，故 viewBox 字串維持不變。
    if (ui.dragging === null) setView(ui.zoom, ui.panX, ui.panY)
    else applyView()
    // overlay 在 viewBox 定案（或凍結維持）之後：數值文字的隱藏門檻要吃
    // 本幀（或凍結中）的 viewBox。
    renderOverlay(plan, ui, report)
  }

  function renderDrag(id: string, kind: NodeKind, x: number, y: number): void {
    const node =
      kind === 'item' ? itemMap.get(id) : kind === 'block' ? blockMap.get(id) : doorMap.get(id)
    if (node === undefined) return
    const dx = x - readNumberAttr(node, 'data-x')
    const dy = y - readNumberAttr(node, 'data-y')
    node.setAttribute('transform', `translate(${dx} ${dy})`)
    addClass(node, 'is-dragging')
  }

  function clearDrag(id: string): void {
    const node = findNode(id)
    if (node === null) return
    node.removeAttribute('transform')
    removeClass(node, 'is-dragging')
  }

  return {
    renderCommit,
    renderOverlay,
    renderDrag,
    clearDrag,
    setView,
    fit(): void {
      setView(1, 0, 0)
    },
    getViewBox(): ViewBox {
      return { ...viewBox }
    },
    getBounds(): Rect {
      return padRect(bounds, FIT_MARGIN_CM)
    },
    getRoomBounds(): Rect {
      return { ...bounds }
    },
    node(kind: NodeKind, id: string): SVGGElement | null {
      const map = kind === 'item' ? itemMap : kind === 'block' ? blockMap : doorMap
      return map.get(id) ?? null
    },
    draggableNodes(): SVGGElement[] {
      return [...draggable]
    },
    focus(kind: NodeKind, id: string): void {
      const map = kind === 'item' ? itemMap : kind === 'block' ? blockMap : doorMap
      map.get(id)?.focus()
    },
    layers: {
      floor: layerFloor,
      walls: layerWalls,
      items: layerItems,
      doors: layerDoors,
      overlayStatic,
      overlayDynamic,
    },
  }
}
