/**
 * T3.3（(internal design doc) §Frontend Accessibility「Color」
 * 「警示色 token 雙主題 ≥4.5:1（S9 管線）」、§Verification「警示色雙主題
 * 對比 ≥4.5:1（S9 管線）」；TASKS.md T3.3）：CSS 原始文字掃描
 * （`tools/statusline-builder/css-scan-test-utils.ts`）抽
 * `tools/room-layout-planner/style.css` 的 `--rlp-warn`／`--rlp-tight`／
 * `--rlp-collide` 淺色 `:root`／dark(media)／dark(attr) 三處**字面** hex，
 * 配 `src/style.css` 的 `--bg`／`--dark-bg`，用 `src/lib/color.ts` 真算
 * WCAG 對比並斷言 ≥4.5:1；另驗證 dark(media) 與 dark(attr) 兩區塊字面值
 * 鍵值相同（防手誤漂移，兩處各自寫字面 hex、不走 `--dark-*` 間接層，見
 * `style.css` 檔頭與 PLAN §Decision Log 897-905 行）。
 *
 * 管線可行性已由 `(internal design doc)`（拋棄式原型）
 * 驗證，本檔是其 vitest 落地版（見 `sp9/REPORT.md`「T3.3 實作處方」）。
 * jsdom 不套用外部 stylesheet，故一律讀 CSS 原始文字比對，不讀
 * computed style（`css-scan-test-utils.ts` 檔頭）。
 *
 * 另驗證 PLAN §Frontend Accessibility「Color」「名稱前景色由
 * `src/lib/color.ts` 自動取黑／白，任意填色 ≥4.58:1」：對 `index.html` 的
 * 兩組快選色票（`#color-swatches`＋T5.3 的 `#props-swatches`，去重後 8 色）
 * 與 `model.ts` 的 `DEFAULT_COLOR`，以及 200 組 seeded 隨機色，
 * 套用 `autoFgIsBlack()` 選出的黑／白前景，斷言對比皆 ≥4.5:1（數學下限
 * sqrt(21)≈4.58：bg 落在 WCAG 中點時黑白兩前景對比皆恰為此值，見
 * `color.ts` `autoFgIsBlack` 分界值說明）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  allMediaBlockRanges,
  mediaBlockRange,
  stripCssComments,
} from '../statusline-builder/css-scan-test-utils.js'
import { autoFgIsBlack, contrastRatio, relativeLuminance } from '../../src/lib/color.js'
import { DEFAULT_COLOR } from './model.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const TOOL_CSS = readFileSync(path.resolve(DIR, 'style.css'), 'utf-8')
const ROOT_CSS = readFileSync(path.resolve(DIR, '../../src/style.css'), 'utf-8')
const INDEX_HTML = readFileSync(path.resolve(DIR, 'index.html'), 'utf-8')

const WARN_TOKENS = ['--rlp-warn', '--rlp-tight', '--rlp-collide'] as const

const RLP_TOKEN_RE = /(--rlp-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/g

/** 範圍內抽 `--rlp-*` 字面 hex（`var(...)` 引用的 token 不匹配，天然略過）。 */
function extractRlpTokens(slice: string): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const m of slice.matchAll(RLP_TOKEN_RE)) {
    tokens[m[1]] = m[2].toLowerCase()
  }
  return tokens
}

// ── 三個互斥範圍定位（沿用 sp9 probe 手法，見 sp9/REPORT.md「T3.3 實作處方」）

const lightRootRanges = allMediaBlockRanges(TOOL_CSS, /:root\s*\{/)
const darkMediaRanges = allMediaBlockRanges(TOOL_CSS, /@media\s*\(prefers-color-scheme:\s*dark\)/)
const darkAttrRanges = allMediaBlockRanges(TOOL_CSS, /:root\[data-theme=['"]dark['"]\]\s*\{/)

if (lightRootRanges.length < 1) {
  throw new Error(`style.css 應至少有一個純 :root {} 區塊，實得 ${lightRootRanges.length}`)
}
if (darkAttrRanges.length !== 1) {
  throw new Error(`style.css 應恰有一個 :root[data-theme='dark']{} 區塊，實得 ${darkAttrRanges.length}`)
}

const lightRange = lightRootRanges[0]!
const darkMediaRange = mediaBlockRange(TOOL_CSS, /@media\s*\(prefers-color-scheme:\s*dark\)/)
const darkAttrRange = darkAttrRanges[0]!

const lightTokens = extractRlpTokens(TOOL_CSS.slice(lightRange.start, lightRange.end))
const darkMediaTokens = extractRlpTokens(TOOL_CSS.slice(darkMediaRange.start, darkMediaRange.end))
const darkAttrTokens = extractRlpTokens(TOOL_CSS.slice(darkAttrRange.start, darkAttrRange.end))

// ── 背景色：src/style.css 單一來源（:root 的 --bg／--dark-bg 字面值）───────

const rootLightRanges = allMediaBlockRanges(ROOT_CSS, /:root\s*\{/)
if (rootLightRanges.length !== 1) {
  throw new Error(`src/style.css 應恰有一個純 :root {} 區塊，實得 ${rootLightRanges.length}`)
}
const rootLightSlice = ROOT_CSS.slice(rootLightRanges[0]!.start, rootLightRanges[0]!.end)
const lightBgMatch = /--bg\s*:\s*(#[0-9a-fA-F]{6})/.exec(rootLightSlice)
const darkBgMatch = /--dark-bg\s*:\s*(#[0-9a-fA-F]{6})/.exec(rootLightSlice)
if (!lightBgMatch || !darkBgMatch) {
  throw new Error('src/style.css 的 :root 應含 --bg／--dark-bg 字面 hex 值')
}
const lightBg = lightBgMatch[1].toLowerCase()
const darkBg = darkBgMatch[1].toLowerCase()

describe('overlay 警示色雙主題對比（S9 管線；PLAN §Frontend Accessibility「Color」／§Verification）', () => {
  it('三個互斥範圍：淺色 :root 恰 1 個、dark(media) 恰 1 個、dark(attr) 恰 1 個', () => {
    expect(lightRootRanges.length).toBeGreaterThanOrEqual(1)
    expect(darkMediaRanges.length).toBe(1)
    expect(darkAttrRanges.length).toBe(1)
  })

  it('stripCssComments：等長替換，且 dark media 區塊即使檔案含註解仍恰命中 1 個', () => {
    const stripped = stripCssComments(TOOL_CSS)
    expect(stripped.length).toBe(TOOL_CSS.length)
    expect(darkMediaRanges.length).toBe(1)
  })

  it('淺色／dark(media)／dark(attr) 三處皆含 --rlp-warn／--rlp-tight／--rlp-collide', () => {
    for (const token of WARN_TOKENS) {
      expect(lightTokens).toHaveProperty(token)
      expect(darkMediaTokens).toHaveProperty(token)
      expect(darkAttrTokens).toHaveProperty(token)
    }
  })

  it('背景色：src/style.css 抽到 --bg／--dark-bg 字面 hex', () => {
    expect(lightBg).toMatch(/^#[0-9a-f]{6}$/)
    expect(darkBg).toMatch(/^#[0-9a-f]{6}$/)
  })

  it.each(WARN_TOKENS)('%s 淺色對 --bg 對比 ≥4.5:1', (token) => {
    const ratio = contrastRatio(relativeLuminance(lightTokens[token]!), relativeLuminance(lightBg))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it.each(WARN_TOKENS)('%s dark(media) 對 --dark-bg 對比 ≥4.5:1', (token) => {
    const ratio = contrastRatio(relativeLuminance(darkMediaTokens[token]!), relativeLuminance(darkBg))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it.each(WARN_TOKENS)('%s dark(attr) 對 --dark-bg 對比 ≥4.5:1', (token) => {
    const ratio = contrastRatio(relativeLuminance(darkAttrTokens[token]!), relativeLuminance(darkBg))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('dark(media) 與 dark(attr) 兩區塊的 --rlp-* 字面 hex 鍵值相同（防手誤漂移）', () => {
    expect(darkMediaTokens).toEqual(darkAttrTokens)
  })
})

describe('家具名稱前景色自動取黑／白 ≥4.5:1（PLAN §Frontend Accessibility「Color」）', () => {
  /**
   * 取某一組快選色票的色碼（T5.3 起有兩組：加入表單的 `#color-swatches` 與
   * 物件屬性欄的 `#props-swatches`，兩組刻意同一套色）。以 id 起算切到最近的
   * `</div>`——兩個容器內都只有 `<button>`，故第一個結束標籤即其收尾。
   */
  function swatchGroup(id: string): string[] {
    const start = INDEX_HTML.indexOf(`id="${id}"`)
    if (start < 0) throw new Error(`index.html 缺少 #${id}`)
    const end = INDEX_HTML.indexOf('</div>', start)
    if (end < 0) throw new Error(`#${id} 沒有收尾的 </div>`)
    return Array.from(
      INDEX_HTML.slice(start, end).matchAll(/data-color="(#[0-9a-fA-F]{6})"/g),
    ).map((m) => m[1]!)
  }

  const addSwatches = swatchGroup('color-swatches')
  const propsSwatches = swatchGroup('props-swatches')
  /** 對比斷言跑在**去重後**的色盤上（兩組同色，逐組跑等於跑兩遍同樣的數字）。 */
  const swatchColors = Array.from(new Set([...addSwatches, ...propsSwatches]))

  it('兩組快選色票各恰 8 色，色值集合相同，去重後恰 8 色', () => {
    expect(addSwatches).toHaveLength(8)
    expect(propsSwatches).toHaveLength(8)
    expect(new Set(propsSwatches)).toEqual(new Set(addSwatches))
    expect(swatchColors).toHaveLength(8)
  })

  it.each([DEFAULT_COLOR, ...swatchColors])('bg=%s 的自動前景色對比 ≥4.5:1', (bg) => {
    const fg = autoFgIsBlack(bg) ? '#000000' : '#ffffff'
    const ratio = contrastRatio(relativeLuminance(fg), relativeLuminance(bg))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('200 組 seeded 隨機色的自動前景色對比皆 ≥4.5:1（數學下限 sqrt(21)≈4.58：任一 bg 對黑／白兩前景對比較大者恆 ≥ 此值）', () => {
    // mulberry32（inline，固定種子，確定性、跨執行/跨機一致）
    let state = 0x1234_5678
    function next(): number {
      state = (state + 0x6d2b79f5) | 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    for (let i = 0; i < 200; i++) {
      const channel = () => Math.floor(next() * 256)
      const hex = [channel(), channel(), channel()]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
      const bg = `#${hex}`
      const fg = autoFgIsBlack(bg) ? '#000000' : '#ffffff'
      const ratio = contrastRatio(relativeLuminance(fg), relativeLuminance(bg))
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    }
  })
})
