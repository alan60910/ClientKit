// @vitest-environment jsdom
/**
 * T1.1（(internal design doc) §D4「殘留檢查」列、
 * §Verification (f)）：資料驅動品牌測試——7 個 `index.html`（repo 根＋六個
 * `tools/<slug>/index.html`，含 `_probe` 範本）的 `<title>`／`<h1>`／返回
 * 連結／footer 說明句／footer LICENSE 連結皆為 ClientKit 品牌，且去除 HTML
 * 註解與 `<script>` 內容後的可見文字（含 `<template>` 內容）與所有屬性值
 * 不含舊品牌字樣（不分大小寫）。
 *
 * 只讀 HTML 原始檔（`readFileSync`＋jsdom `DOMParser`），不 import 任何
 * 工具頁 main.ts。HTML 註解本身不在 DOM 文字節點內（`Comment` 節點不計入
 * 走訪），品牌走訪（`collectVisible`）對 `<script>` 子樹整個略過——舊品牌
 * 掃描本就不該誤判 script 原始碼裡的識別字。
 *
 * 🟡-9（(internal design doc)）：FOUC inline script 內的 localStorage key 另有
 * 專屬守護（見下方「FOUC inline script localStorage key」describe 區塊）——
 * 直接抽取每頁 inline `<script>`（無 `src`）原始文字，斷言其中每個
 * `localStorage.getItem('…')`／`localStorage.setItem('…'` 字面 key 皆等於
 * `src/theme.ts` 的 `THEME_STORAGE_KEY`。`src/storage-keys-pin.test.ts`
 * 只釘各模組匯出常數的值，不讀 HTML，不能取代本檔這道守護。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY } from './theme.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const BRAND = 'ClientKit'
const FOOTER_TAGLINE = 'ClientKit — 所有處理皆於瀏覽器端完成，不會上傳任何資料。'
const LICENSE_URL = 'https://github.com/alan60910/ClientKit/blob/main/LICENSE'
/** 舊品牌（不分大小寫：同時涵蓋 `EZTools` 與 `eztools`）。 */
const OLD_BRAND = /eztools/i

/** 工具頁 slug（`tools/<slug>/index.html`）；`_probe` 為新增工具骨架範本，一併驗。 */
const TOOL_SLUGS = [
  'apng-to-gif',
  'gif-editor',
  'video-converter',
  'statusline-builder',
  'room-layout-planner',
  '_probe',
] as const

interface Page {
  /** repo 根相對路徑（亦作為案名）。 */
  readonly rel: string
  readonly isRoot: boolean
}

const PAGES: readonly Page[] = [
  { rel: 'index.html', isRoot: true },
  ...TOOL_SLUGS.map((slug) => ({ rel: `tools/${slug}/index.html`, isRoot: false })),
]

function parsePage(rel: string): Document {
  const html = readFileSync(resolve(repoRoot, rel), 'utf-8')
  return new DOMParser().parseFromString(html, 'text/html')
}

/**
 * 走訪節點蒐集可見文字與屬性值：略過 `<script>` 子樹與 Comment 節點；
 * `<template>` 的內容位於其 `content` DocumentFragment（非子節點），
 * 一併遞迴——生成範本 clone 後即為可見 UI。
 */
function collectVisible(node: Node, texts: string[], attrs: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    texts.push(node.nodeValue ?? '')
    return
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'script') return
    for (const attr of Array.from(el.attributes)) attrs.push(`${attr.name}=${attr.value}`)
    if (tag === 'template') {
      collectVisible((el as HTMLTemplateElement).content, texts, attrs)
      return
    }
  }
  for (const child of Array.from(node.childNodes)) collectVisible(child, texts, attrs)
}

describe('品牌：7 個 index.html 的資料驅動斷言', () => {
  it('頁面清單恰為 7 個（根＋六個工具頁）', () => {
    expect(PAGES).toHaveLength(7)
  })

  describe.each(PAGES)('$rel', ({ rel, isRoot }) => {
    const doc = parsePage(rel)

    it('<title> 含 ClientKit 且不含舊品牌', () => {
      const title = doc.title
      expect(title).toContain(BRAND)
      expect(title).not.toMatch(OLD_BRAND)
      if (isRoot) expect(title).toBe(BRAND)
    })

    if (isRoot) {
      it('<h1> 為 ClientKit', () => {
        const h1 = doc.querySelector('h1')
        expect(h1).not.toBeNull()
        expect(h1!.textContent?.trim()).toBe(BRAND)
      })
    } else {
      it('header 返回入口頁連結文字含 ClientKit', () => {
        const back = doc.querySelector('header a[href="../../"]')
        expect(back).not.toBeNull()
        expect(back!.textContent).toContain(`返回 ${BRAND}`)
        expect(back!.textContent).not.toMatch(OLD_BRAND)
      })
    }

    it('footer 說明句為 ClientKit 版', () => {
      const firstP = doc.querySelector('footer p')
      expect(firstP).not.toBeNull()
      expect(firstP!.textContent?.trim()).toBe(FOOTER_TAGLINE)
    })

    it('footer LICENSE 連結指向 ClientKit repo', () => {
      const links = Array.from(doc.querySelectorAll('footer a')).filter((a) =>
        (a.getAttribute('href') ?? '').endsWith('/LICENSE'),
      )
      expect(links).toHaveLength(1)
      expect(links[0]!.getAttribute('href')).toBe(LICENSE_URL)
    })

    it('去註解與 <script> 後的可見文字（含 <template> 內容）與屬性值不含舊品牌', () => {
      const texts: string[] = []
      const attrs: string[] = []
      collectVisible(doc, texts, attrs)
      const visible = texts.join('')
      // 非空洞守衛：footer 說明句必在可見文字內。
      expect(visible).toContain(BRAND)
      expect(visible).not.toMatch(OLD_BRAND)
      expect(attrs.filter((a) => OLD_BRAND.test(a))).toEqual([])
    })
  })
})

/** 頁面內無 `src` 屬性的 inline `<script>` 原始文字（FOUC 防護所在）。 */
function extractInlineScripts(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('script'))
    .filter((s) => !s.hasAttribute('src'))
    .map((s) => s.textContent ?? '')
}

/** 擷取 `localStorage.getItem('…')`／`localStorage.setItem('…', …)` 的字面 key（單／雙引號皆可）。 */
const LOCAL_STORAGE_CALL = /localStorage\.(?:getItem|setItem)\(\s*(['"])((?:(?!\1).)*)\1/g

describe('🟡-9：7 頁 FOUC inline script 的 localStorage key 守護', () => {
  describe.each(PAGES)('$rel', ({ rel }) => {
    const doc = parsePage(rel)
    const scriptText = extractInlineScripts(doc).join('\n')

    it('至少有一個 inline <script>（無 src）', () => {
      expect(extractInlineScripts(doc).length).toBeGreaterThan(0)
    })

    it('每個 localStorage.getItem/setItem 字面 key 皆等於 THEME_STORAGE_KEY，且至少出現一次', () => {
      const keys = Array.from(scriptText.matchAll(LOCAL_STORAGE_CALL)).map((m) => m[2])
      // 非空洞守衛：本頁 inline script 必須真的呼叫過 localStorage.getItem/setItem。
      expect(keys.length).toBeGreaterThan(0)
      for (const key of keys) {
        expect(key).toBe(THEME_STORAGE_KEY)
      }
    })
  })
})
