/**
 * T4.2 — PNG 匯出（(internal design doc) §D7「PNG 匯出
 * （順序釘死）」、§Verification jsdom「序列化後 `xmlns` 恰一次且
 * `DOMParser` 無 `parsererror`」「PNG 匯出中 `getComputedStyle` 呼叫對象
 * 全為 `isConnected===true`」「PNG `aria-busy` 時序」、e2e 案 4）。
 *
 * **順序釘死（D7，經 `sp3/REPORT.md` 實測背書）**：
 * (1) 對**文件內原始節點** `[svg, ...svg.querySelectorAll('*')]` 批次讀
 *     computed style 進陣列；
 * (2) `svg.cloneNode(true)`；
 * (3) 依**相同節點序**把 (1) 的值寫成 clone 上的 presentation attribute
 *     ——**clone 上絕不呼叫 `getComputedStyle`**。
 * 這條順序不是防禦性假設：sp3 spike 實測 detached clone 上的
 * `getComputedStyle` 會落回 CSS 初始值（`fill:black`／`stroke:none`），
 * 既不擲錯也不回空字串，整張匯出圖近乎純黑；原節點取樣路徑則與 CDP 真機
 * 截圖**逐 byte 相同**。本檔以型別把這條契約做成結構性保證——
 * `cloneWithStyles()` 根本收不到 `getStyle`，想違約得先改簽章。
 *
 * 批次（讀完全部再寫）而非交錯：sp3 三輪實測兩者耗時差距落在雜訊內
 * （寫入對象是 detached 節點，不會讓文件內 originals 的樣式快取失效，
 * 故無 layout thrashing），採批次純為「clone 尚未存在時無從誤用」的
 * 結構清晰度。
 *
 * **jsdom 承接**：jsdom 29.1.1 的 `<canvas>.getContext()` 回 `null`、
 * `Image` 不解碼、無 `URL.createObjectURL`。故光柵化兩階段抽成
 * `PngPipeline` 由呼叫端可注入，`*.dom.test.ts` 以 stub 承接；預設實作
 * 只在瀏覽器實跑時才會被呼叫（模組載入期不碰任何瀏覽器 API）。
 *
 * **不外連**：序列化結果不內嵌 HTML 子樹、不引用外部 `href`／字型檔
 * （D7 末句），故 canvas 不會被污染，`getImageData` 回讀探針才有意義。
 *
 * 本檔為 DOM 層葉節點：只被 `main.ts`（唯一 orchestrator）呼叫，不 import
 * 任何 DOM 層模組，也不自行查 `document` 以外的全域——`announce`／
 * `showError`／`download` 一律由 host 注入。
 */
import type { Rect } from './geometry.js'

/* ------------------------------------------------------------------ *
 * 契約常數（D7 像素上限）
 * ------------------------------------------------------------------ */

/** 桌面長邊像素上限（D7）。 */
export const PNG_LONG_EDGE_DESKTOP = 4096
/** 行動版長邊像素上限（D7「行動版預設長邊 2048」）。 */
export const PNG_LONG_EDGE_MOBILE = 2048
/** 總面積像素上限（D7）。 */
export const PNG_MAX_AREA = 16_000_000
/**
 * 比例上限（px per cm，D7 經 S3 定案的 20）：極小房間（例如 50×50 cm 的
 * 轉角收納格）不得反推出不合理的匯出密度。
 */
export const PNG_MAX_SCALE = 20

/** 行動版判定的 media query（PLAN §Frontend：行動版 <1100px）。 */
export const PNG_MOBILE_QUERY = '(max-width: 1099px)'

/** 下載檔名。 */
export const PNG_FILENAME = 'room-layout-plan.png'

/**
 * 逐節點取樣的 CSS 屬性（D7 列出 fill／stroke／stroke-width／font-family／
 * font-size 五項；本表另補 `stroke-dasharray`（style.css 的斜線／未附著門
 * 虛線）、`font-weight`、`opacity`、`visibility`（`board.ts` 對超出
 * OQ2 門檻的標籤寫的是 `visibility` 屬性而非 `display`，正是為了讓匯出
 * 取樣穩定））。順序即 `sampleComputedStyles()` 每列的欄序，
 * `cloneWithStyles()` 依同一順序寫回。
 *
 * **T4.w 補 `fill-opacity`／`stroke-opacity`**：`style.css` 對凹入區方塊
 * 用的是 `fill-opacity: 0.35`（非 `opacity`），不取樣會讓匯出的 PNG 把
 * 凹入區畫成全不透明、蓋住底下的地板與家具，與螢幕不一致；`stroke-opacity`
 * 一併補上以免日後用到時再漏一次。
 */
export const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'font-family',
  'font-size',
  'font-weight',
  'opacity',
  'visibility',
] as const

/**
 * 本模組的在地文案（zh-Hant）。`messages.ts` v1 未開 PNG 完成播報的鍵，
 * 且本 sprint 不得修改該檔；`failed` 逐字等同 `messages.errors.pngFailed`，
 * 接線步驟可直接改由 `messages` 取用而不動到文字本身。
 */
export const PNG_TEXT = {
  /** `#export-scale`：「匯出比例 1:N」（D7）。 */
  scale: (ratio: string): string => `匯出比例 1:${ratio}`,
  /** 完成播報（D7「匯出期間鈕 `aria-busy="true"`＋完成播報」）。 */
  done: (widthPx: number, heightPx: number): string =>
    `PNG 匯出完成，${widthPx}×${heightPx} 像素`,
  /** `#error` 文案；與 `messages.errors.pngFailed` 逐字相同。 */
  failed: 'PNG 匯出失敗',
} as const

/* ------------------------------------------------------------------ *
 * 純函式：比例
 * ------------------------------------------------------------------ */

export interface FitScaleOptions {
  longEdge?: number
  maxArea?: number
  maxScale?: number
}

export interface FitScaleResult {
  /** px per cm。 */
  scale: number
  widthPx: number
  heightPx: number
}

/** 取正有限數，否則退回 `fallback`（房型退化為零寬時不讓比例變成 Infinity）。 */
function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 由房間 cm 尺寸反推匯出比例與像素尺寸（D7）：
 * `scale = min(longEdge / max(w,d), sqrt(maxArea / (w·d)), maxScale)`。
 *
 * **取整採 `Math.round`**（S3 實測值即以此釘死：5000×100 → 4096×82，
 * `floor` 會得到 81）。長邊上限在 `round` 下恆成立（`x ≤ longEdge` 且
 * `longEdge` 為整數 ⇒ `round(x) ≤ longEdge`）；面積上限則可能被 `round`
 * 溢出極小量（兩軸小數部皆 ≥0.5 時，上界約 80 px²／16,000,000），故補一道
 * 後置守衛：溢出即兩軸改用 `floor`（`floor` 恆 ≤ 精確值 ⇒ 硬上限必成立）。
 * 四個 S3 釘死案皆不觸發這道守衛。像素下限 1（零寬房型仍可出圖）。
 */
export function fitScale(
  widthCm: number,
  depthCm: number,
  opts: FitScaleOptions = {},
): FitScaleResult {
  const longEdge = positive(opts.longEdge, PNG_LONG_EDGE_DESKTOP)
  const maxArea = positive(opts.maxArea, PNG_MAX_AREA)
  const maxScale = positive(opts.maxScale, PNG_MAX_SCALE)
  const w = positive(widthCm, 1)
  const d = positive(depthCm, 1)

  const byEdge = longEdge / Math.max(w, d)
  const byArea = Math.sqrt(maxArea / (w * d))
  const scale = Math.min(byEdge, byArea, maxScale)

  let widthPx = Math.max(1, Math.round(w * scale))
  let heightPx = Math.max(1, Math.round(d * scale))
  if (widthPx * heightPx > maxArea) {
    widthPx = Math.max(1, Math.floor(w * scale))
    heightPx = Math.max(1, Math.floor(d * scale))
  }
  return { scale, widthPx, heightPx }
}

/**
 * 「匯出比例 1:N」的 N（D7）。**定義（釘死、無地區化）**：
 * `N = (1 / scale).toFixed(2)`，再去掉尾隨的 0 與小數點——即「圖上 1 px
 * 代表現實 N cm」。例：`scale 0.8 → "1.25"`、`scale 1 → "1"`、
 * `scale 10.24 → "0.1"`、`scale 20 → "0.05"`。
 * `toFixed` 的半進位由 ECMAScript 釘死，故同一 `scale` 恆得同一字串。
 * 非有限或非正的 `scale` 退回 `"1"`（UI 不顯示 NaN）。
 */
export function scaleLabel(scale: number): string {
  return PNG_TEXT.scale(ratioText(scale))
}

function ratioText(scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) return '1'
  const fixed = (1 / scale).toFixed(2)
  if (!fixed.includes('.')) return fixed
  return fixed.replace(/0+$/, '').replace(/\.$/, '')
}

/* ------------------------------------------------------------------ *
 * 步驟 (1)(2)(3)：取樣 → clone → 寫入
 * ------------------------------------------------------------------ */

/**
 * 取樣／寫入共用的節點序：**根元素在前**，其後為
 * `querySelectorAll('*')` 的文件序。原圖與 clone 同構，故兩邊以同一式
 * 走訪即可一一對應。
 */
function collectNodes(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll('*'))]
}

/**
 * 預設取樣器：取節點自身文件的 `window`。只有**連接在文件內**的節點才有
 * `ownerDocument.defaultView`，故這條預設路徑本身就擋掉了對 detached
 * clone 取樣的可能。
 */
function defaultGetStyle(el: Element): CSSStyleDeclaration {
  const view = el.ownerDocument.defaultView
  if (view === null) {
    throw new Error('io-png.ts：節點不在具 window 的文件內，無法讀取 computed style')
  }
  return view.getComputedStyle(el)
}

/**
 * 步驟 (1)：對**文件內原始節點**批次讀 `STYLE_PROPS`，回傳逐節點的值
 * 陣列（欄序＝`STYLE_PROPS` 序）。呼叫對象全為 `isConnected === true`
 * ——這正是 §Verification 要 spy 斷言的那條。
 */
export function sampleComputedStyles(
  svg: SVGSVGElement,
  getStyle: (el: Element) => CSSStyleDeclaration = defaultGetStyle,
): string[][] {
  const nodes = collectNodes(svg)
  const samples: string[][] = []
  for (const node of nodes) {
    const declaration = getStyle(node)
    const row: string[] = []
    for (const prop of STYLE_PROPS) {
      const value = declaration.getPropertyValue(prop)
      row.push(typeof value === 'string' ? value : '')
    }
    samples.push(row)
  }
  return samples
}

/** clone 上要清掉的互動／測試專用屬性（純名稱比對，不牽動任何樣式）。 */
const STRIP_EXACT: ReadonlySet<string> = new Set(['tabindex', 'role'])
const STRIP_PREFIXES: readonly string[] = ['aria-', 'data-']

/**
 * 只清互動／測試屬性；`id`／`class` 刻意保留（對光柵化無害，且留著方便
 * 人工檢視匯出的 SVG 中介結果）。先快照屬性名再移除——`attributes` 是
 * live 的 `NamedNodeMap`，邊走訪邊移除會跳號。
 */
function stripNonVisual(el: Element): void {
  const names = Array.from(el.attributes, (attr: Attr) => attr.name)
  for (const name of names) {
    const lower = name.toLowerCase()
    if (STRIP_EXACT.has(lower) || STRIP_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      el.removeAttribute(name)
    }
  }
}

/**
 * 步驟 (2)(3)：`cloneNode(true)` 後依**相同節點序**把 `samples` 寫成
 * presentation attribute，根元素另補 `width`／`height`／`viewBox`。
 *
 * **`viewBox` 一律改寫為 `bounds`**（review 🟡-4）：畫面上的 `viewBox` 由
 * `board.setView()` 寫成 `fitViewBox(padRect(bounds, FIT_MARGIN_CM), zoom,
 * panX, panY)`，含縮放與平移，`cloneNode(true)` 會原樣帶走——不覆寫的話，
 * 使用者放大／平移後匯出的 PNG 只有畫面上看得到的那一塊，且
 * 「匯出比例 1:N」（由 `bounds` 反推）與實際像素密度對不起來。**匯出永遠
 * 以 `bounds` 為 viewBox、與畫面縮放無關**，`widthPx`／`heightPx` 亦由同一
 * 個 `bounds` 反推，兩者恆等比。
 *
 * **刻意不補 `xmlns`**（D7）：`XMLSerializer` 會自行宣告，手動再補一次
 * 會讓序列化結果出現兩份宣告——§Verification 的「恰一次」即鎖這件事。
 * 空字串值跳過（不產生 `fill=""` 這種會覆蓋掉繼承值的空屬性）。
 * 本函式**收不到取樣器**，故結構上不可能對 clone 呼叫 `getComputedStyle`。
 */
export function cloneWithStyles(
  svg: SVGSVGElement,
  samples: readonly string[][],
  widthPx: number,
  heightPx: number,
  bounds: Rect,
): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const nodes = collectNodes(clone)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const row = i < samples.length ? samples[i] : undefined
    if (row !== undefined) {
      for (let p = 0; p < STYLE_PROPS.length; p++) {
        const value = row[p]
        if (value === undefined || value === '') continue
        node.setAttribute(STYLE_PROPS[p], value)
      }
    }
    stripNonVisual(node)
  }
  clone.setAttribute('width', String(widthPx))
  clone.setAttribute('height', String(heightPx))
  clone.setAttribute(
    'viewBox',
    `${bounds.x0} ${bounds.y0} ${bounds.x1 - bounds.x0} ${bounds.y1 - bounds.y0}`,
  )
  return clone
}

/** 步驟 (4)：序列化（`xmlns` 由 `XMLSerializer` 自行宣告，恰一次）。 */
export function serializeSvg(clone: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(clone)
}

/* ------------------------------------------------------------------ *
 * 光柵化管線（可注入；jsdom 以 stub 承接）
 * ------------------------------------------------------------------ */

const SVG_MIME = 'image/svg+xml;charset=utf-8'

export interface PngPipeline {
  /** Blob → object URL → `<img>`；`onerror` 一律 reject（D7）。 */
  loadImage(svgText: string): Promise<HTMLImageElement | { width: number; height: number }>
  /** canvas 2d → `drawImage` → 回讀探針 → `toBlob`；`null` 一律 reject（D7）。 */
  rasterize(img: unknown, widthPx: number, heightPx: number): Promise<Blob>
}

function toError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback, { cause })
}

/**
 * 預設 `loadImage`。物件 URL 在 `onload`／`onerror` 當下即 revoke：圖片
 * 此時已完成載入與解析，後續 `drawImage` 不再回源，提早釋放可避免匯出
 * 失敗路徑漏掉 revoke。
 */
export function defaultLoadImage(svgText: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const blob = new Blob([svgText], { type: SVG_MIME })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    const settle = (finish: () => void): void => {
      img.onload = null
      img.onerror = null
      URL.revokeObjectURL(url)
      finish()
    }
    img.onload = (): void => {
      settle(() => {
        resolve(img)
      })
    }
    img.onerror = (): void => {
      settle(() => {
        reject(new Error('io-png.ts：SVG 影像載入失敗'))
      })
    }
    img.src = url
  })
}

/**
 * 預設 `rasterize`。`getImageData(0,0,1,1)` 回讀探針（D7）只判定「回讀
 * 得到」——canvas 被污染時它會擲錯，而本管線不引用任何外部資源，故擲錯
 * 即代表管線出了預期外的狀況，直接走 `#error`。**刻意不在此斷言像素非
 * 空白**：外接框的角落本來就可能落在地板之外（非矩形房型），對 (0,0)
 * 斷言非透明會產生假失敗；「非全黑」留給 e2e 案 4 以有意義的取樣點驗證。
 */
export function defaultRasterize(img: unknown, widthPx: number, heightPx: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      reject(new Error('io-png.ts：無法取得 2D 繪圖脈絡'))
      return
    }
    try {
      ctx.drawImage(img as CanvasImageSource, 0, 0, widthPx, heightPx)
    } catch (cause) {
      reject(toError(cause, 'io-png.ts：繪製失敗'))
      return
    }
    try {
      ctx.getImageData(0, 0, 1, 1)
    } catch (cause) {
      reject(toError(cause, 'io-png.ts：畫布回讀探針失敗'))
      return
    }
    try {
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error('io-png.ts：toBlob 回傳 null'))
        else resolve(blob)
      }, 'image/png')
    } catch (cause) {
      reject(toError(cause, 'io-png.ts：toBlob 擲錯'))
    }
  })
}

function resolvePipeline(partial: Partial<PngPipeline> | undefined): PngPipeline {
  return {
    loadImage: partial?.loadImage ?? defaultLoadImage,
    rasterize: partial?.rasterize ?? defaultRasterize,
  }
}

/* ------------------------------------------------------------------ *
 * 全流程
 * ------------------------------------------------------------------ */

export interface PngExportOptions {
  longEdge?: number
  pipeline?: Partial<PngPipeline>
  getStyle?: (el: Element) => CSSStyleDeclaration
}

export interface PngExportResult {
  blob: Blob
  widthPx: number
  heightPx: number
  scale: number
}

/**
 * D7 釘死順序的完整實作。`bounds` 為 `board.getBounds()` 的外接框（cm，
 * 已含 `FIT_MARGIN_CM` 邊距）——**匯出永遠以 `bounds` 為 viewBox、與畫面
 * 縮放無關**：`cloneWithStyles()` 會把 clone 的 `viewBox` 改寫成 `bounds`
 * （原圖屬性上的那一份含 zoom／pan，見該函式註解），故 `widthPx`／
 * `heightPx` 與匯出的 `viewBox` 恆等比、成品恆為全圖。
 * **全程只讀 `svg`，不寫入任何原始節點**（樣式寫在 clone 上）。
 * 任何階段失敗皆 reject 一個 `Error`。
 */
export async function exportSvgToPng(
  svg: SVGSVGElement,
  bounds: Rect,
  opts: PngExportOptions = {},
): Promise<PngExportResult> {
  const { scale, widthPx, heightPx } = fitScale(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0, {
    longEdge: opts.longEdge,
  })
  // (1) 原節點批次取樣 →(2) clone →(3) 寫入 clone →(4) 序列化。
  const samples = sampleComputedStyles(svg, opts.getStyle)
  const clone = cloneWithStyles(svg, samples, widthPx, heightPx, bounds)
  const svgText = serializeSvg(clone)

  const pipeline = resolvePipeline(opts.pipeline)
  try {
    const img = await pipeline.loadImage(svgText)
    const blob = await pipeline.rasterize(img, widthPx, heightPx)
    return { blob, widthPx, heightPx, scale }
  } catch (cause) {
    throw toError(cause, PNG_TEXT.failed)
  }
}

/* ------------------------------------------------------------------ *
 * DOM 層接線
 * ------------------------------------------------------------------ */

export interface PngHost {
  getSvg(): SVGSVGElement
  getBounds(): Rect
  announce(text: string): void
  showError(text: string): void
  /** 缺席時只播報不下載（單元測試與預覽態用）。 */
  download?: (blob: Blob, filename: string) => void
  /** 缺席時以 `matchMedia(PNG_MOBILE_QUERY)` 特徵偵測。 */
  isMobile?: () => boolean
  pipeline?: Partial<PngPipeline>
}

export interface PngExport {
  detach(): void
  /** 手動觸發一次匯出；成功回 `true`。匯出中再次呼叫直接回 `false`。 */
  run(): Promise<boolean>
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector)
  if (found === null) throw new Error(`io-png.ts：DOM 契約缺少元素 ${selector}`)
  return found
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

function defaultIsMobile(view: Window | null): boolean {
  if (view === null || typeof view.matchMedia !== 'function') return false
  try {
    return view.matchMedia(PNG_MOBILE_QUERY).matches === true
  } catch {
    return false
  }
}

/**
 * 掛上 `#btn-export-png`（必要）與 `#export-scale`（選配，缺席時不寫比例
 * 文字）。點擊 → `run()`：
 * - 同步先設 `aria-busy="true"`＋`disabled`（§Verification「PNG
 *   `aria-busy` 時序」要求整段管線期間為 true），`finally` 清掉；
 * - 依 `isMobile()` 取長邊上限，寫「匯出比例 1:N」；
 * - 成功 → `download`＋完成播報；失敗 → `showError`。
 * 匯出中重複點擊一律忽略（管線只跑一次）。
 */
export function attachPngExport(root: ParentNode, host: PngHost): PngExport {
  const button = query<HTMLButtonElement>(root, '#btn-export-png')
  const scaleEl = root.querySelector<HTMLElement>('#export-scale')

  let detached = false
  let busy = false

  function longEdgeForViewport(): number {
    const mobile =
      host.isMobile !== undefined
        ? host.isMobile()
        : defaultIsMobile(button.ownerDocument.defaultView)
    return mobile ? PNG_LONG_EDGE_MOBILE : PNG_LONG_EDGE_DESKTOP
  }

  async function run(): Promise<boolean> {
    if (detached || busy) return false
    busy = true
    button.setAttribute('aria-busy', 'true')
    button.disabled = true
    try {
      const bounds = host.getBounds()
      const longEdge = longEdgeForViewport()
      // 比例文字先寫：使用者在管線跑完之前就看得到這次匯出的比例。
      if (scaleEl !== null) {
        const fit = fitScale(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0, { longEdge })
        setText(scaleEl, scaleLabel(fit.scale))
      }
      const result = await exportSvgToPng(host.getSvg(), bounds, {
        longEdge,
        pipeline: host.pipeline,
      })
      if (host.download !== undefined) host.download(result.blob, PNG_FILENAME)
      host.announce(PNG_TEXT.done(result.widthPx, result.heightPx))
      return true
    } catch {
      host.showError(PNG_TEXT.failed)
      return false
    } finally {
      busy = false
      button.removeAttribute('aria-busy')
      button.disabled = false
    }
  }

  const onClick = (): void => {
    if (detached) return
    void run()
  }
  button.addEventListener('click', onClick)

  return {
    run,
    detach(): void {
      detached = true
      button.removeEventListener('click', onClick)
    },
  }
}
