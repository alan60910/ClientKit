// @vitest-environment jsdom
/**
 * T3.3／T3.4（(internal design doc) §D2′；TASKS.md T3.3／
 * T3.4，回饋 #5「目錄樣例值」）：左欄目錄 compact 列 dom 回歸網——
 * 未啟用＝`☐ 段名 樣例值`（淡化，checkbox 未勾＋`.catalog-item__hint`
 * 可見）／已啟用＝`☑ 段名 已加入`（checkbox 已勾＋`.catalog-item__badge`
 * 可見，`.catalog-item__hint` 隱藏）；`textContent` 注入回歸（`<`／`&`
 * 文字不被解析為節點／實體）；語言切換後 hint／已加入文字連動；截斷樣式
 * 規則存在（style.css 原始文字比對）。
 *
 * 回歸網比照既有 lang-switch.dom.test.ts／mode-switch.dom.test.ts 的
 * 「先以 jsdom 剖析真實 index.html 取得 <body>、動態 import main.ts
 * 觸發其 init()」全頁面整合測試形（檔頭說明不重複抄錄）。
 *
 * ── 注入回歸／語言連動兩案的快取預先播種手法（見 sample-values.ts
 *    檔頭「per-locale 快取」）──
 * `sample-values.ts` 的 `getSampleValues(locale, resolveFn)` 於快取命中
 * 時**完全忽略** `resolveFn`（見其原始碼）——利用此既有設計本身作為白箱
 * 測試注入面：在呼叫 `vi.resetModules()` 之後、動態 `import('./main.js')`
 * 之前，先動態 `import('./sample-values.js')` 並以自訂 `resolveFn` 呼叫
 * `getSampleValues(locale, stub)` 預先播種該 locale 的快取——兩次動態
 * import 落在同一 `vi.resetModules()` 世代（epoch）內，ESM 模組登錄表
 * 保證兩處 `import('./sample-values.js')`（測試檔本身＋main.ts 內部
 * import）解析到同一模組實例、共用同一 `cacheByLocale` Map，故隨後
 * `main.ts` 的 `buildCatalogItems()`／`refreshCatalogHints()` 呼叫真
 * `getSampleValue(id, locale)`（不傳 resolveFn，走預設真 `resolve`）時
 * 會命中已播種的快取值，而非重新真合成。此手法不需要 `vi.mock` 模組替換
 * （本 repo 既有測試網無此先例，見 sample-values.ts 檔頭「測試注入面」
 * 說明），純粹是「白箱運用既有 lazy 快取設計本身」。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from './messages.js'
import type { ResolveFn } from './sample-values.js'

// 檔級 testTimeout（比照 i18n-dom.dom.test.ts／lang-switch.dom.test.ts／
// pipeline.integration.test.ts／layout-columns.dom.test.ts 既有先例，同以
// 30_000 收斂）：本檔既是 sprint 14 BACKLOG 列名的既知 timeout flake（多
// 案皆 `boot()` 重跑 main.ts 全依賴圖＋init() 建 30 段目錄，部分案另疊
// `bootWithSeededSample()` 的第二輪動態 import），單案隔離跑穩定約
// 2284ms，本非邏輯迴歸；sprint 15 的 index.html 三欄版面增量（目錄欄／
// 列區欄結構膨脹）進一步墊高 init() 成本，使其在全套件並行負載下由偶發
// 轉常發。此處把該病史體制化，避免樣例值回歸網的紅燈訊號被環境負載雜訊
// 淹沒。
vi.setConfig({ testTimeout: 30_000 })

const DIR = path.dirname(fileURLToPath(import.meta.url))
const HTML_PATH = path.resolve(DIR, 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

const STYLE_CSS = readFileSync(path.resolve(DIR, 'style.css'), 'utf-8')

/** 取 style.css 原始文字中，選擇器第一次出現處對應的規則區塊內文（同 output-dialog.dom.test.ts 既有慣例）。 */
function firstRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (match === null) throw new Error(`style.css 找不到符合 ${selectorPattern} 的規則`)
  const openIndex = css.indexOf('{', match.index)
  const closeIndex = css.indexOf('}', openIndex)
  return css.slice(openIndex + 1, closeIndex)
}

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（同既有 dom.test 慣例）。 */
async function boot(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

/**
 * 見檔頭「快取預先播種手法」：`vi.resetModules()` 之後、`main.js` 之前
 * 先 import `sample-values.js`，以 `stub` 播種指定 `locale` 的整批快取
 * （stub 對任何輸入皆回傳同一組 runs，故 30 段皆播種為同一文字——測試
 * 只需其中一段可觀察即可）。
 */
async function bootWithSeededSample(locale: 'zh-Hant' | 'en', text: string): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  const sampleValues = await import('./sample-values.js')
  const stub: ResolveFn = () => [[{ text }]]
  sampleValues.getSampleValues(locale, stub)
  await import('./main.js')
}

function catalogItem(id: string): HTMLLIElement {
  return document.querySelector(`.catalog-item[data-segment-id="${id}"]`) as HTMLLIElement
}

function catalogCheckbox(id: string): HTMLInputElement {
  return document.getElementById(`${id}-catalog`) as HTMLInputElement
}

function catalogHint(id: string): HTMLElement | null {
  return catalogItem(id).querySelector('.catalog-item__hint')
}

function catalogBadge(id: string): HTMLElement | null {
  return catalogItem(id).querySelector('.catalog-item__badge')
}

function langToggleBtn(): HTMLButtonElement {
  return document.querySelector('.lang-toggle') as HTMLButtonElement
}

describe('T3.3 compact 形渲染：未啟用＝checkbox 未勾＋樣例可見；已啟用＝checkbox 已勾＋「已加入」可見', () => {
  beforeEach(async () => {
    await boot()
  })

  it('未啟用段（開機預設全停用）：checkbox 未勾、.catalog-item__hint 可見且非空、.catalog-item__badge 隱藏', () => {
    expect(catalogCheckbox('model').checked).toBe(false)
    const hint = catalogHint('model')!
    expect(hint.hidden).toBe(false)
    expect(hint.textContent).not.toBe('')
    expect(hint.textContent).toBe('model: Fable 5') // S2-RESULT.md 已實測值（sample-values.test.ts 同斷言，此處證 DOM 落點一致）。
    expect(catalogBadge('model')!.hidden).toBe(true)
    expect(catalogItem('model').classList.contains('catalog-item--enabled')).toBe(false)
  })

  it('勾選啟用後：checkbox 已勾、.catalog-item__badge 可見顯「已加入」、.catalog-item__hint 隱藏', () => {
    catalogCheckbox('model').click()
    expect(catalogCheckbox('model').checked).toBe(true)
    expect(catalogItem('model').classList.contains('catalog-item--enabled')).toBe(true)
    const badge = catalogBadge('model')!
    expect(badge.hidden).toBe(false)
    expect(badge.textContent).toBe(t('zh-Hant').catalog.addedBadge)
    expect(catalogHint('model')!.hidden).toBe(true)
  })

  it('再次取消勾選：回到未啟用態（樣例重新可見、badge 重新隱藏）', () => {
    catalogCheckbox('model').click() // 啟用
    catalogCheckbox('model').click() // 取消
    expect(catalogCheckbox('model').checked).toBe(false)
    expect(catalogHint('model')!.hidden).toBe(false)
    expect(catalogBadge('model')!.hidden).toBe(true)
  })

  it('30 段（四類分區）逐段皆有 .catalog-item__hint 節點且開機時可見', () => {
    const items = document.querySelectorAll('.catalog-item')
    expect(items.length).toBe(30)
    for (const item of Array.from(items)) {
      const hint = item.querySelector<HTMLElement>('.catalog-item__hint')
      expect(hint).not.toBeNull()
      expect(hint!.hidden).toBe(false)
    }
  })
})

describe('T3.3 textContent 注入回歸：樣例值含 `<`／`&` 不被解析為節點／實體', () => {
  it('播種含 `<img>`／`&` 的惡意樣例文字 → hint.textContent 逐字保留、零子節點、DOM 未解析出元素', async () => {
    const malicious = '<img src=x onerror="alert(1)">&amp;evil<script>bad</script>'
    await bootWithSeededSample('zh-Hant', malicious)
    const hint = catalogHint('model')!
    expect(hint.textContent).toBe(malicious) // 逐字保留、無 HTML 解析／實體轉換。
    expect(hint.children.length).toBe(0) // 未被解析出任何元素節點。
    expect(hint.querySelector('img')).toBeNull()
    expect(hint.querySelector('script')).toBeNull()
    // innerHTML 序列化須把 `<`／`&` 轉為實體字面——反向證明寫入時走的是
    // textContent（建立單一文字節點），而非曾把字串當標記解析過。
    expect(hint.innerHTML).not.toContain('<img')
    expect(hint.innerHTML).not.toContain('<script')
  })
})

describe('T3.4 語言切換重渲染：目錄 hint／已加入文字隨切換連動', () => {
  it('播種 zh/en 兩份可辨識樣例文字 → 開機顯 zh 播種值、切至 en 後改顯 en 播種值、切回 zh 再現原值（beforeEach 隔離見下方 reset-hook 單元測試）', async () => {
    localStorage.clear()
    document.body.innerHTML = BODY_HTML
    vi.resetModules()
    const sampleValues = await import('./sample-values.js')
    const zhStub: ResolveFn = () => [[{ text: 'ZH-SAMPLE-TEXT' }]]
    const enStub: ResolveFn = () => [[{ text: 'EN-SAMPLE-TEXT' }]]
    sampleValues.getSampleValues('zh-Hant', zhStub)
    sampleValues.getSampleValues('en', enStub)
    await import('./main.js')

    expect(catalogHint('model')!.textContent).toBe('ZH-SAMPLE-TEXT')

    langToggleBtn().click()
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    expect(catalogHint('model')!.textContent).toBe('EN-SAMPLE-TEXT')

    langToggleBtn().click()
    expect(document.documentElement.getAttribute('lang')).toBe('zh-Hant')
    expect(catalogHint('model')!.textContent).toBe('ZH-SAMPLE-TEXT')
  })

  it('「已加入」徽章文字隨語言切換翻轉（已啟用段）', async () => {
    await boot()
    catalogCheckbox('cost').click()
    expect(catalogBadge('cost')!.textContent).toBe(t('zh-Hant').catalog.addedBadge)
    langToggleBtn().click()
    expect(catalogBadge('cost')!.textContent).toBe(t('en').catalog.addedBadge)
    langToggleBtn().click()
    expect(catalogBadge('cost')!.textContent).toBe(t('zh-Hant').catalog.addedBadge)
  })

  it('真 resolve（未播種、預設 locale zh-Hant）下切語言後 hint 仍為非空真樣例（連動機制未破壞正常路徑）', async () => {
    await boot()
    const before = catalogHint('model')!.textContent
    expect(before).toBe('model: Fable 5')
    langToggleBtn().click()
    const after = catalogHint('model')!.textContent
    expect(after).not.toBe('')
    expect(after).not.toBeNull()
  })
})

describe('T3.3 溢出防護：.catalog-item__hint 單行 ellipsis 截斷規則存在（style.css 原始文字檢核）', () => {
  it('.catalog-item__hint 帶 overflow:hidden／white-space:nowrap／text-overflow:ellipsis', () => {
    const block = firstRuleBlock(STYLE_CSS, /\.catalog-item__hint\s*\{/)
    expect(block).toMatch(/overflow:\s*hidden/)
    expect(block).toMatch(/white-space:\s*nowrap/)
    expect(block).toMatch(/text-overflow:\s*ellipsis/)
  })
})
