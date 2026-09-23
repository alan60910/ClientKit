// @vitest-environment jsdom
/**
 * T4.2 回歸網（(internal design doc) §D7「PNG 匯出（順序
 * 釘死）」、§Verification jsdom「序列化後 `xmlns` 恰一次且 `DOMParser`
 * 無 `parsererror`」「PNG 匯出中 `getComputedStyle` 呼叫對象全為
 * `isConnected===true`」「PNG `aria-busy` 時序」）。
 *
 * jsdom 29.1.1 的缺口（PLAN §D2 實證延伸）：`<canvas>.getContext()` 回
 * `null`、`Image` 不解碼、無 `URL.createObjectURL`。故所有案一律以
 * `PngPipeline` stub 承接光柵化兩階段；真機像素比對歸 e2e 案 4
 * （手法見 `sp3/REPORT.md` 方法論 1、3）。
 *
 * `getComputedStyle` 同樣以 stub 承接：jsdom 不把 `<style>` 的 CSS 變數
 * 串接進 SVG presentation property，真跑會整排回空字串，無從驗證「寫入
 * 值與取樣值一致」這條。stub 版反而能逐格對拍。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rect } from './geometry.js'
import {
  attachPngExport,
  cloneWithStyles,
  exportSvgToPng,
  fitScale,
  PNG_FILENAME,
  PNG_LONG_EDGE_MOBILE,
  PNG_TEXT,
  sampleComputedStyles,
  scaleLabel,
  serializeSvg,
  STYLE_PROPS,
  type PngHost,
  type PngPipeline,
} from './io-png.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

// jsdom 環境下全域 `URL` 為 jsdom 實作，`fileURLToPath` 只認 node 自家的
// URL 實例，故沿 `board.dom.test.ts` 既有手法先轉成字串路徑再 join。
const PNG_SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'io-png.ts'),
  'utf-8',
)

/* ------------------------------------------------------------------ *
 * fixture
 * ------------------------------------------------------------------ */

/** 假 computed style：依 `class` 給值，模擬 CSS 變數串接後的結果。 */
const FAKE_STYLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  root: { fill: 'rgb(0, 0, 0)', 'font-family': 'system-ui, sans-serif' },
  floor: { fill: 'rgb(232, 240, 254)', stroke: 'none' },
  // T4.w：`fill-opacity`／`stroke-opacity` 兩欄（`style.css` 的凹入區方塊
  // 用的是 `fill-opacity`，不是 `opacity`）亦須逐欄搬進 clone。
  'item-rect': {
    fill: 'rgb(51, 102, 204)',
    'fill-opacity': '0.35',
    stroke: 'rgb(0, 0, 0)',
    'stroke-opacity': '0.8',
    'stroke-width': '1px',
  },
  'item-label': {
    fill: 'rgb(255, 255, 255)',
    'font-family': 'system-ui, sans-serif',
    'font-size': '18px',
    'font-weight': '600',
    visibility: 'hidden',
  },
  hatch: {
    stroke: 'rgb(176, 0, 32)',
    'stroke-width': '2px',
    'stroke-dasharray': '4px 3px',
    opacity: '0.85',
  },
}

function stylesFor(el: Element): Readonly<Record<string, string>> {
  if (el.tagName.toLowerCase() === 'svg') return FAKE_STYLES.root
  const classes = (el.getAttribute('class') ?? '').split(/\s+/)
  for (const token of classes) {
    const found = FAKE_STYLES[token]
    if (found !== undefined) return found
  }
  return {}
}

function fakeGetStyle(el: Element): CSSStyleDeclaration {
  const table = stylesFor(el)
  return {
    getPropertyValue: (prop: string): string => table[prop] ?? '',
  } as unknown as CSSStyleDeclaration
}

interface Harness {
  svg: SVGSVGElement
  button: HTMLButtonElement
  scaleEl: HTMLElement
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  for (const name of Object.keys(attrs)) node.setAttribute(name, attrs[name])
  return node
}

/**
 * 最小 fixture：`<style>` 在 `<head>`（刻意不放進 `<svg>` 子樹——否則
 * `cloneNode(true)` 會把樣式表一起搬走，整個「原節點取樣」的意義就沒了，
 * 見 `sp3/REPORT.md` 原型設計摘要）；`<svg>` 內含地板矩形、家具 `<g>`
 * （rect＋中文 text）、斜線 `<path class="hatch">`；節點上一律無
 * presentation attribute。
 */
function mount(): Harness {
  document.head.innerHTML =
    '<style>:root{--rlp-floor:#e8f0fe}.floor{fill:var(--rlp-floor)}</style>'
  document.body.innerHTML =
    '<button type="button" id="btn-export-png">匯出 PNG</button>' +
    '<span id="export-scale"></span>'

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('id', 'board-svg')
  svg.setAttribute('viewBox', '0 0 300 400')
  svg.setAttribute('role', 'group')
  svg.setAttribute('aria-label', '房間平面圖')

  const floorLayer = el('g', { id: 'layer-floor' })
  floorLayer.appendChild(el('rect', { class: 'floor', x: '0', y: '0', width: '300', height: '400' }))

  const itemsLayer = el('g', { id: 'layer-items' })
  const item = el('g', {
    id: 'item-a1',
    'data-testid': 'item-a1',
    'data-kind': 'item',
    'data-id': 'a1',
    role: 'button',
    tabindex: '0',
    'aria-describedby': 'board-hint',
    'aria-label': '衣櫃 60×200 cm，位置 300,0',
  })
  item.appendChild(el('rect', { class: 'item-rect', x: '10', y: '10', width: '60', height: '200' }))
  const label = el('text', { class: 'item-label', x: '40', y: '110' })
  label.textContent = '衣櫃'
  item.appendChild(label)
  itemsLayer.appendChild(item)

  const overlay = el('g', { id: 'layer-overlay', 'aria-hidden': 'true' })
  overlay.appendChild(el('path', { class: 'hatch', d: 'M 0 0 L 40 40 M 10 0 L 50 40' }))

  svg.appendChild(floorLayer)
  svg.appendChild(itemsLayer)
  svg.appendChild(overlay)
  document.body.appendChild(svg)

  return {
    svg,
    button: document.querySelector('#btn-export-png') as HTMLButtonElement,
    scaleEl: document.querySelector('#export-scale') as HTMLElement,
  }
}

const BOUNDS: Rect = { x0: 0, y0: 0, x1: 300, y1: 400 }

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function pngBlob(): Blob {
  return new Blob(['png'], { type: 'image/png' })
}

interface HostSpies {
  host: PngHost
  announced: string[]
  errors: string[]
  downloads: Array<{ blob: Blob; filename: string }>
  loadImage: ReturnType<typeof vi.fn>
  rasterize: ReturnType<typeof vi.fn>
}

function makeHost(h: Harness, pipeline: Partial<PngPipeline> = {}): HostSpies {
  const announced: string[] = []
  const errors: string[] = []
  const downloads: Array<{ blob: Blob; filename: string }> = []
  const loadImage = vi.fn(pipeline.loadImage ?? (async () => ({ width: 1, height: 1 })))
  const rasterize = vi.fn(pipeline.rasterize ?? (async () => pngBlob()))
  return {
    announced,
    errors,
    downloads,
    loadImage,
    rasterize,
    host: {
      getSvg: () => h.svg,
      getBounds: () => BOUNDS,
      announce: (text) => {
        announced.push(text)
      },
      showError: (text) => {
        errors.push(text)
      },
      download: (blob, filename) => {
        downloads.push({ blob, filename })
      },
      isMobile: () => false,
      pipeline: { loadImage, rasterize } as Partial<PngPipeline>,
    },
  }
}

/* ------------------------------------------------------------------ *
 * 案
 * ------------------------------------------------------------------ */

describe('fitScale（D7 像素上限；S3 釘死值）', () => {
  it('5000×5000 → 面積上限生效，scale 0.8、4000×4000', () => {
    expect(fitScale(5000, 5000)).toEqual({ scale: 0.8, widthPx: 4000, heightPx: 4000 })
  })

  it('5000×100 → 長邊上限生效，scale 0.8192、4096×82', () => {
    const fit = fitScale(5000, 100)
    expect(fit.scale).toBeCloseTo(0.8192, 10)
    expect(fit.widthPx).toBe(4096)
    expect(fit.heightPx).toBe(82)
  })

  it('300×400 → 兩上限皆未觸發，scale 10.24、3072×4096', () => {
    expect(fitScale(300, 400)).toEqual({ scale: 10.24, widthPx: 3072, heightPx: 4096 })
  })

  it('行動版 5000×5000（longEdge 2048）→ 2048×2048', () => {
    const fit = fitScale(5000, 5000, { longEdge: PNG_LONG_EDGE_MOBILE })
    expect(fit.widthPx).toBe(2048)
    expect(fit.heightPx).toBe(2048)
    expect(fit.scale).toBeCloseTo(0.4096, 10)
  })

  it('10×10 → 比例封頂於 20 px/cm、200×200', () => {
    expect(fitScale(10, 10)).toEqual({ scale: 20, widthPx: 200, heightPx: 200 })
  })

  it('四捨五入若溢出面積上限則整體改用 floor（硬上限恆成立）', () => {
    // 3×3 cm、maxArea 12.25 → scale 7/6、兩軸皆 3.5 px：round 得 4×4=16
    // > 12.25，守衛改 floor → 3×3=9。
    const fit = fitScale(3, 3, { maxArea: 12.25 })
    expect(fit.scale).toBeCloseTo(7 / 6, 12)
    expect(fit.widthPx).toBe(3)
    expect(fit.heightPx).toBe(3)
    expect(fit.widthPx * fit.heightPx).toBeLessThanOrEqual(12.25)
  })

  it('退化尺寸不產生 NaN／Infinity，像素下限為 1', () => {
    const fit = fitScale(0, 0)
    expect(Number.isFinite(fit.scale)).toBe(true)
    expect(fit.widthPx).toBeGreaterThanOrEqual(1)
    expect(fit.heightPx).toBeGreaterThanOrEqual(1)
  })
})

describe('scaleLabel（「匯出比例 1:N」）', () => {
  it('N ＝ 1/scale 取兩位小數後去尾零，確定性逐值', () => {
    expect(scaleLabel(0.8)).toBe('匯出比例 1:1.25')
    expect(scaleLabel(1)).toBe('匯出比例 1:1')
    expect(scaleLabel(10.24)).toBe('匯出比例 1:0.1')
    expect(scaleLabel(20)).toBe('匯出比例 1:0.05')
    expect(scaleLabel(0.8192)).toBe('匯出比例 1:1.22')
  })

  it('同一輸入恆得同一字串；非法 scale 退回 1', () => {
    expect(scaleLabel(0.8)).toBe(scaleLabel(0.8))
    expect(scaleLabel(0)).toBe('匯出比例 1:1')
    expect(scaleLabel(Number.NaN)).toBe('匯出比例 1:1')
  })
})

describe('sampleComputedStyles（步驟 1：只碰文件內原始節點）', () => {
  let h: Harness

  beforeEach(() => {
    h = mount()
  })

  it('每次呼叫的對象皆 isConnected===true（§Verification spy 斷言）', () => {
    const seen: Element[] = []
    sampleComputedStyles(h.svg, (node) => {
      seen.push(node)
      return fakeGetStyle(node)
    })
    expect(seen.length).toBeGreaterThan(1)
    for (const node of seen) expect(node.isConnected).toBe(true)
  })

  it('節點序＝根元素在前、其後為 querySelectorAll("*") 文件序，且逐節點恰一次', () => {
    const seen: Element[] = []
    sampleComputedStyles(h.svg, (node) => {
      seen.push(node)
      return fakeGetStyle(node)
    })
    const expected = [h.svg, ...Array.from(h.svg.querySelectorAll('*'))]
    expect(seen).toEqual(expected)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('每列欄序對齊 STYLE_PROPS，缺值為空字串', () => {
    const samples = sampleComputedStyles(h.svg, fakeGetStyle)
    expect(samples).toHaveLength(1 + h.svg.querySelectorAll('*').length)
    for (const row of samples) expect(row).toHaveLength(STYLE_PROPS.length)

    const nodes = [h.svg, ...Array.from(h.svg.querySelectorAll('*'))]
    const labelIndex = nodes.findIndex((node) => node.getAttribute('class') === 'item-label')
    const row = samples[labelIndex]
    expect(row[STYLE_PROPS.indexOf('font-size')]).toBe('18px')
    expect(row[STYLE_PROPS.indexOf('visibility')]).toBe('hidden')
    expect(row[STYLE_PROPS.indexOf('stroke')]).toBe('')
  })
})

describe('cloneWithStyles（步驟 2、3：寫 clone、不碰原圖）', () => {
  let h: Harness

  beforeEach(() => {
    h = mount()
  })

  it('依相同節點序寫入 presentation attribute，空值不寫', () => {
    const samples = sampleComputedStyles(h.svg, fakeGetStyle)
    const clone = cloneWithStyles(h.svg, samples, 3072, 4096, BOUNDS)
    const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))]
    expect(cloneNodes).toHaveLength(samples.length)

    for (let i = 0; i < cloneNodes.length; i++) {
      for (let p = 0; p < STYLE_PROPS.length; p++) {
        const prop = STYLE_PROPS[p]
        const value = samples[i][p]
        if (value === '') expect(cloneNodes[i].hasAttribute(prop)).toBe(false)
        else expect(cloneNodes[i].getAttribute(prop)).toBe(value)
      }
    }

    const hatch = clone.querySelector('.hatch') as Element
    expect(hatch.getAttribute('stroke-dasharray')).toBe('4px 3px')
    expect(hatch.getAttribute('opacity')).toBe('0.85')
    const label = clone.querySelector('.item-label') as Element
    expect(label.getAttribute('visibility')).toBe('hidden')
    expect(label.textContent).toBe('衣櫃')
  })

  it('根元素補 width／height／viewBox（＝bounds），且不補 xmlns', () => {
    const samples = sampleComputedStyles(h.svg, fakeGetStyle)
    const clone = cloneWithStyles(h.svg, samples, 3072, 4096, BOUNDS)
    expect(clone.getAttribute('width')).toBe('3072')
    expect(clone.getAttribute('height')).toBe('4096')
    expect(clone.hasAttribute('xmlns')).toBe(false)
    expect(clone.getAttribute('viewBox')).toBe('0 0 300 400')
  })

  it('clone 上的 tabindex／role／aria-*／data-* 一律清掉，id／class 保留', () => {
    const samples = sampleComputedStyles(h.svg, fakeGetStyle)
    const clone = cloneWithStyles(h.svg, samples, 100, 100, BOUNDS)
    const item = clone.querySelector('#item-a1') as Element
    expect(item).not.toBeNull()
    expect(item.hasAttribute('tabindex')).toBe(false)
    expect(item.hasAttribute('role')).toBe(false)
    expect(item.hasAttribute('aria-label')).toBe(false)
    expect(item.hasAttribute('aria-describedby')).toBe(false)
    expect(item.hasAttribute('data-testid')).toBe(false)
    expect(item.hasAttribute('data-kind')).toBe(false)
    expect(item.getAttribute('id')).toBe('item-a1')
    expect(clone.hasAttribute('role')).toBe(false)
    expect(clone.hasAttribute('aria-label')).toBe(false)
    expect((clone.querySelector('.hatch') as Element).getAttribute('class')).toBe('hatch')
    expect((clone.querySelector('#layer-overlay') as Element).hasAttribute('aria-hidden')).toBe(
      false,
    )
  })

  it('原圖逐 byte 不變（序列化前後比對）', () => {
    const before = new XMLSerializer().serializeToString(h.svg)
    const samples = sampleComputedStyles(h.svg, fakeGetStyle)
    cloneWithStyles(h.svg, samples, 3072, 4096, BOUNDS)
    expect(new XMLSerializer().serializeToString(h.svg)).toBe(before)
  })

  it('取樣器只看得到連接節點——clone 節點永不入鏡', () => {
    const spy = vi.fn((node: Element) => fakeGetStyle(node))
    const samples = sampleComputedStyles(h.svg, spy)
    const clone = cloneWithStyles(h.svg, samples, 100, 100, BOUNDS)
    const cloneNodes = new Set<Element>([clone, ...Array.from(clone.querySelectorAll('*'))])
    for (const call of spy.mock.calls) {
      expect(call[0].isConnected).toBe(true)
      expect(cloneNodes.has(call[0])).toBe(false)
    }
  })
})

describe('serializeSvg（步驟 4）', () => {
  let h: Harness

  beforeEach(() => {
    h = mount()
  })

  it('xmlns 恰出現一次（XMLSerializer 自行宣告，不手動補）', () => {
    const samples = sampleComputedStyles(h.svg, fakeGetStyle)
    const text = serializeSvg(cloneWithStyles(h.svg, samples, 3072, 4096, BOUNDS))
    expect(text.match(/xmlns=/g) ?? []).toHaveLength(1)
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('DOMParser 以 image/svg+xml 解析無 parsererror，且中文標籤存活', () => {
    const samples = sampleComputedStyles(h.svg, fakeGetStyle)
    const text = serializeSvg(cloneWithStyles(h.svg, samples, 3072, 4096, BOUNDS))
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(parsed.documentElement.getAttribute('width')).toBe('3072')
    expect(text).toContain('衣櫃')
  })
})

describe('exportSvgToPng（全流程）', () => {
  let h: Harness

  beforeEach(() => {
    h = mount()
  })

  it('回傳 blob 與比例，並把像素尺寸傳給 rasterize', async () => {
    const rasterize = vi.fn<PngPipeline['rasterize']>(async () => pngBlob())
    const loadImage = vi.fn<PngPipeline['loadImage']>(async () => ({ width: 1, height: 1 }))
    const result = await exportSvgToPng(h.svg, BOUNDS, {
      getStyle: fakeGetStyle,
      pipeline: { loadImage, rasterize },
    })
    expect(result.widthPx).toBe(3072)
    expect(result.heightPx).toBe(4096)
    expect(result.scale).toBe(10.24)
    expect(result.blob.type).toBe('image/png')
    expect(rasterize.mock.calls[0][1]).toBe(3072)
    expect(rasterize.mock.calls[0][2]).toBe(4096)
    expect(loadImage.mock.calls[0][0]).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('loadImage reject（img.onerror）→ 以 Error reject', async () => {
    await expect(
      exportSvgToPng(h.svg, BOUNDS, {
        getStyle: fakeGetStyle,
        pipeline: { loadImage: async () => Promise.reject(new Error('onerror')) },
      }),
    ).rejects.toBeInstanceOf(Error)
  })

  it('rasterize reject（toBlob null）→ 以 Error reject', async () => {
    await expect(
      exportSvgToPng(h.svg, BOUNDS, {
        getStyle: fakeGetStyle,
        pipeline: {
          loadImage: async () => ({ width: 1, height: 1 }),
          rasterize: async () => Promise.reject(new Error('toBlob 回傳 null')),
        },
      }),
    ).rejects.toThrow('toBlob 回傳 null')
  })

  it('zoom≠1／pan≠0（畫面 viewBox 已被 setView 改寫）→ 匯出的 viewBox 仍為 bounds，原圖不變', async () => {
    // `board.setView()` 會把 `fitViewBox(padRect(bounds, 24), 1.5, …)` 寫進
    // svg 屬性；`cloneNode(true)` 原樣帶走就會匯出被裁切的畫面（review 🟡-4）。
    h.svg.setAttribute('viewBox', '-10 -10 232 298')
    const loadImage = vi.fn<PngPipeline['loadImage']>(async () => ({ width: 1, height: 1 }))
    // `getBounds()` 口徑＝`normalize()` 外接框加 FIT_MARGIN_CM 24 cm 邊距。
    const padded: Rect = { x0: -24, y0: -24, x1: 324, y1: 424 }
    const fit = fitScale(348, 448)

    const result = await exportSvgToPng(h.svg, padded, {
      getStyle: fakeGetStyle,
      pipeline: { loadImage, rasterize: async () => pngBlob() },
    })

    const text = loadImage.mock.calls[0][0]
    expect(text).toContain('viewBox="-24 -24 348 448"')
    expect(text.match(/viewBox=/g) ?? []).toHaveLength(1)
    expect(text).toContain(`width="${fit.widthPx}"`)
    expect(text).toContain(`height="${fit.heightPx}"`)
    expect(result.widthPx).toBe(fit.widthPx)
    expect(result.heightPx).toBe(4096)
    // 原圖的 viewBox（含縮放）不得被匯出動作改寫。
    expect(h.svg.getAttribute('viewBox')).toBe('-10 -10 232 298')
  })

  it('非 Error 的 reject 原因也會被包成 Error', async () => {
    await expect(
      exportSvgToPng(h.svg, BOUNDS, {
        getStyle: fakeGetStyle,
        pipeline: { loadImage: async () => Promise.reject('字串原因') },
      }),
    ).rejects.toBeInstanceOf(Error)
  })
})

describe('attachPngExport（接線與 aria-busy 時序）', () => {
  let h: Harness

  beforeEach(() => {
    h = mount()
  })

  it('成功：aria-busy 整段管線期間為 true、完成後清除，並 download＋播報', async () => {
    const gate = deferred<{ width: number; height: number }>()
    const spies = makeHost(h, { loadImage: () => gate.promise })
    const controller = attachPngExport(document, spies.host)
    const before = new XMLSerializer().serializeToString(h.svg)

    const running = controller.run()
    expect(h.button.getAttribute('aria-busy')).toBe('true')
    expect(h.button.disabled).toBe(true)

    gate.resolve({ width: 1, height: 1 })
    await expect(running).resolves.toBe(true)

    expect(h.button.hasAttribute('aria-busy')).toBe(false)
    expect(h.button.disabled).toBe(false)
    expect(spies.downloads).toHaveLength(1)
    expect(spies.downloads[0].filename).toBe(PNG_FILENAME)
    expect(spies.announced).toEqual([PNG_TEXT.done(3072, 4096)])
    expect(spies.errors).toEqual([])
    // 原圖只被讀、不被寫。
    expect(new XMLSerializer().serializeToString(h.svg)).toBe(before)
    controller.detach()
  })

  it('寫入「匯出比例 1:N」到 #export-scale', async () => {
    const spies = makeHost(h)
    const controller = attachPngExport(document, spies.host)
    await controller.run()
    expect(h.scaleEl.textContent).toBe(scaleLabel(fitScale(300, 400).scale))
    expect(h.scaleEl.textContent).toBe('匯出比例 1:0.1')
    controller.detach()
  })

  it('行動版取 2048 長邊（比例與播報皆隨之改變）', async () => {
    const spies = makeHost(h)
    const host: PngHost = { ...spies.host, getBounds: () => ({ x0: 0, y0: 0, x1: 5000, y1: 5000 }) }
    const desktop = attachPngExport(document, host)
    await desktop.run()
    expect(spies.announced.at(-1)).toBe(PNG_TEXT.done(4000, 4000))
    desktop.detach()

    const mobile = attachPngExport(document, { ...host, isMobile: () => true })
    await mobile.run()
    expect(spies.announced.at(-1)).toBe(PNG_TEXT.done(2048, 2048))
    expect(h.scaleEl.textContent).toBe(scaleLabel(fitScale(5000, 5000, { longEdge: 2048 }).scale))
    mobile.detach()
  })

  it('rasterize 失敗（toBlob null）→ showError 且 aria-busy 清除', async () => {
    const spies = makeHost(h, {
      rasterize: async () => Promise.reject(new Error('io-png.ts：toBlob 回傳 null')),
    })
    const controller = attachPngExport(document, spies.host)
    await expect(controller.run()).resolves.toBe(false)
    expect(spies.errors).toEqual([PNG_TEXT.failed])
    expect(spies.announced).toEqual([])
    expect(spies.downloads).toEqual([])
    expect(h.button.hasAttribute('aria-busy')).toBe(false)
    expect(h.button.disabled).toBe(false)
    controller.detach()
  })

  it('loadImage 失敗（img.onerror）→ showError 且 aria-busy 清除', async () => {
    const spies = makeHost(h, {
      loadImage: async () => Promise.reject(new Error('io-png.ts：SVG 影像載入失敗')),
    })
    const controller = attachPngExport(document, spies.host)
    await expect(controller.run()).resolves.toBe(false)
    expect(spies.errors).toEqual([PNG_TEXT.failed])
    expect(spies.rasterize).not.toHaveBeenCalled()
    expect(h.button.hasAttribute('aria-busy')).toBe(false)
    controller.detach()
  })

  it('匯出中重複點擊只跑一次管線', async () => {
    const gate = deferred<{ width: number; height: number }>()
    const spies = makeHost(h, { loadImage: () => gate.promise })
    const controller = attachPngExport(document, spies.host)

    h.button.click()
    h.button.click()
    h.button.click()
    expect(spies.loadImage).toHaveBeenCalledTimes(1)

    gate.resolve({ width: 1, height: 1 })
    await Promise.resolve()
    await Promise.resolve()
    expect(spies.loadImage).toHaveBeenCalledTimes(1)
    controller.detach()
  })

  it('點擊會觸發匯出；detach() 後不再觸發', async () => {
    const spies = makeHost(h)
    const controller = attachPngExport(document, spies.host)
    h.button.click()
    await vi.waitFor(() => {
      expect(spies.downloads).toHaveLength(1)
    })
    controller.detach()
    h.button.click()
    await Promise.resolve()
    expect(spies.loadImage).toHaveBeenCalledTimes(1)
    await expect(controller.run()).resolves.toBe(false)
  })

  it('缺 #btn-export-png 即擲錯（DOM 契約）', () => {
    document.body.innerHTML = ''
    expect(() => attachPngExport(document, makeHost(h).host)).toThrow('#btn-export-png')
  })

  it('缺 #export-scale 不擲錯，其餘行為不變', async () => {
    h.scaleEl.remove()
    const spies = makeHost(h)
    const controller = attachPngExport(document, spies.host)
    await expect(controller.run()).resolves.toBe(true)
    expect(spies.announced).toEqual([PNG_TEXT.done(3072, 4096)])
    controller.detach()
  })

  it('host.download 缺席時只播報、不擲錯', async () => {
    const spies = makeHost(h)
    const host: PngHost = { ...spies.host }
    delete host.download
    const controller = attachPngExport(document, host)
    await expect(controller.run()).resolves.toBe(true)
    expect(spies.announced).toEqual([PNG_TEXT.done(3072, 4096)])
    controller.detach()
  })
})

describe('原始碼不變量（D7）', () => {
  it('不使用字串拼 DOM 的注入 API', () => {
    expect(PNG_SOURCE).not.toContain('inner' + 'HTML')
    expect(PNG_SOURCE).not.toContain('insertAdjacent')
    expect(PNG_SOURCE).not.toContain('outer' + 'HTML')
  })

  it('不內嵌 HTML 子樹元素（D7 末句）', () => {
    expect(PNG_SOURCE).not.toContain('foreign' + 'Object')
  })

  it('不手動補 xmlns（留給 XMLSerializer 宣告，確保恰一次）', () => {
    expect(PNG_SOURCE).not.toContain("setAttribute('xmlns'")
    expect(PNG_SOURCE).not.toContain('setAttribute("xmlns"')
    expect(PNG_SOURCE).not.toContain('setAttributeNS')
  })

  it('模組載入期不碰瀏覽器全域（canvas／Image／createObjectURL 皆在函式內）', () => {
    // 只看程式碼：註解裡本來就會提到這些 API（例如說明 jsdom 缺口）。
    const code = PNG_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const token of ['createObjectURL', 'createElement', 'new Image(', 'getContext']) {
      const index = code.indexOf(token)
      expect(index, `${token} 未出現在程式碼中`).toBeGreaterThan(-1)
      // 皆落在某個 `function` 之後——模組頂層不執行任何一行。
      expect(code.slice(0, index), `${token} 出現在模組頂層`).toContain('function ')
    }
  })
})
