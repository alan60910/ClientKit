// @vitest-environment jsdom
/**
 * T2.6（(internal design doc) §D5「拖曳教學」；TASKS.md
 * T2.6）：教學帶結構與樣式回歸網——抓取圖示＋一句文案＋SVG keyframes
 * 迷你動畫＋「知道了」dismiss 鈕。本 task 只落**結構與樣式**（見
 * index.html `#tutorial-band-slot` 節點自身註解的完整範圍界定）：
 * dismiss 狀態機接線（localStorage）屬 T3.5、雙語文案進 messages.ts
 * 屬 T3.6——本檔只驗證「靜態骨架＋樣式契約」本身，不驗證任何互動行為
 * （鈕存在但未接事件，點擊無反應為預期，不在本檔斷言範圍）。
 *
 * 回歸網比照既有 layout-columns.dom.test.ts／preview-band.dom.test.ts
 * 的「先以 jsdom 剖析真實 index.html 取得 <body>、動態 import main.ts
 * 觸發其 init()」全頁面整合測試形＋「style.css 原始文字比對」慣例
 * （jsdom 不套用外部 stylesheet，見該檔檔頭說明，不重複抄錄）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TUTORIAL_DISMISS_KEY, TUTORIAL_DISMISS_SENTINEL } from './tutorial-band.js'

// 檔級 testTimeout（比照 i18n-dom.dom.test.ts／lang-switch.dom.test.ts／
// pipeline.integration.test.ts／layout-columns.dom.test.ts／
// catalog-sample-values.dom.test.ts 既有先例，同以 30_000 收斂）：本檔多數
// 案於 beforeEach `await boot()`（重跑 main.ts 全依賴圖＋init()），部分案
// 另疊第二輪 `boot()` 驗證 dismiss 狀態跨重啟持久化——隔離跑 22/22 恆綠、
// 全檔耗時約 10s；sprint 15 的 index.html 增量（MS2 四區版面＋MS3
// details/skip-nav 結構）墊高每次 jsdom boot 成本，使本檔在全套件並行
// 負載下（實測約 26s／full-suite vs 10s／isolated）由偶發轉常發跨過
// vitest 預設 5000ms timeout（純屬負載期間排程延遲，非邏輯迴歸）。此處
// 把該病史體制化，避免教學帶回歸網的紅燈訊號被環境負載雜訊淹沒。
vi.setConfig({ testTimeout: 30_000 })

const DIR = path.dirname(fileURLToPath(import.meta.url))
const HTML_PATH = path.resolve(DIR, 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

const STYLE_CSS_PATH = path.resolve(DIR, 'style.css')
const STYLE_CSS = readFileSync(STYLE_CSS_PATH, 'utf-8')

const ROOT_STYLE_CSS_PATH = path.resolve(DIR, '../../src/style.css')
const ROOT_STYLE_CSS = readFileSync(ROOT_STYLE_CSS_PATH, 'utf-8')

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（同既有 dom.test 慣例）。 */
async function boot(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

/**
 * T3.5：重灌乾淨 DOM＋重置模組快取後重新啟動 main.ts，**不**清 localStorage
 * ——供「dismiss 後重載仍記憶隱藏」「怪值預先寫入後開機」等案模擬「同一
 * 分頁重新整理」（既有 localStorage 內容延續），與 `boot()`（每次測試起手
 * 式皆清空）刻意區分。
 */
async function reboot(): Promise<void> {
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

/** 取 CSS 原始文字中，選擇器第一次出現處對應的規則區塊內文（不含大括號、假設無巢狀大括號）。 */
function firstRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (match === null) throw new Error(`style.css 找不到符合 ${selectorPattern} 的規則`)
  const openIndex = css.indexOf('{', match.index)
  const closeIndex = css.indexOf('}', openIndex)
  return css.slice(openIndex + 1, closeIndex)
}

/** 取 index.html 原始文字中 `#tutorial-band-slot` 容器整段（含子節點）的原始標記，供屬性級原始文字比對。 */
function tutorialBandMarkup(): string {
  // MAGI review 🟡-5（FOUC 修法）：靜態出貨態起手式已帶 `hidden`（見下方
  // 「靜態出貨態」describe 區塊），起始標記同步含該屬性。
  const startMarker = '<div class="tutorial-band" id="tutorial-band-slot" hidden>'
  const startIndex = RAW_HTML.indexOf(startMarker)
  if (startIndex === -1) throw new Error('index.html 找不到 #tutorial-band-slot 起始標記')
  // 容器內無巢狀同名 <div>，取至其後第一個 "</div>\n        </div>"（本容器收尾），
  // 簡化以「取到 tutorial-band__dismiss 收尾 </button> 之後第一個 </div>」為界。
  const dismissCloseMarker = '</button>'
  const dismissCloseIndex = RAW_HTML.indexOf(dismissCloseMarker, startIndex)
  if (dismissCloseIndex === -1) throw new Error('index.html 找不到教學帶 dismiss 鈕收尾標記')
  const containerCloseIndex = RAW_HTML.indexOf('</div>', dismissCloseIndex)
  if (containerCloseIndex === -1) throw new Error('index.html 找不到教學帶容器收尾標記')
  return RAW_HTML.slice(startIndex, containerCloseIndex + '</div>'.length)
}

/**
 * MAGI review 🟡-5（FOUC 修法，2026-07-21 裁定採「預設 hidden 反轉」）：
 * index.html `#tutorial-band-slot` 靜態出貨態（main.ts 尚未執行、或無 JS
 * 環境）已帶 `hidden` 屬性——已 dismiss 使用者冷載/慢網下不再有「帶閃現
 * 後才收合」的 FOUC 窗口。本區塊直接比對 RAW_HTML 原始文字（不 boot，
 * 純靜態骨架），與下方「結構存在性」（boot 後行為）區隔。
 */
describe('T2.6 教學帶：靜態出貨態（原始文字比對，MAGI 🟡-5 FOUC 修法）', () => {
  it('index.html 原始文字：#tutorial-band-slot 靜態帶 hidden 屬性（main.ts 尚未執行前不可見）', () => {
    expect(RAW_HTML).toContain('<div class="tutorial-band" id="tutorial-band-slot" hidden>')
  })
})

describe('T2.6 教學帶：結構存在性', () => {
  beforeAll(async () => {
    await boot()
  })

  it('#tutorial-band-slot 帶 .tutorial-band class；boot 後（預設未 dismiss）main.ts 依 shouldShowTutorialBand() 移除靜態 hidden，顯示', () => {
    const band = document.getElementById('tutorial-band-slot')
    expect(band).not.toBeNull()
    expect(band!.classList.contains('tutorial-band')).toBe(true)
    expect(band!.hasAttribute('hidden')).toBe(false)
  })

  it('含抓取圖示（裝飾、aria-hidden，非互動）', () => {
    const grip = document.querySelector('#tutorial-band-slot .tutorial-band__grip')
    expect(grip).not.toBeNull()
    expect(grip!.getAttribute('aria-hidden')).toBe('true')
    expect(grip!.textContent).toBe('⠿')
  })

  it('含一句文案，掛 data-i18n（zh-Hant 原文字面，鍵留待 T3.6 掛進 messages.ts）', () => {
    const text = document.querySelector('#tutorial-band-slot .tutorial-band__text')
    expect(text).not.toBeNull()
    expect(text!.tagName.toLowerCase()).toBe('p')
    expect(text!.getAttribute('data-i18n')).toBe('tutorial.dragHint')
    expect(text!.textContent).toBe('拖曳段名可排序與移列')
  })

  it('含 inline SVG 迷你動畫，aria-hidden="true"＋focusable="false"（裝飾性，語意由文案句承載）', () => {
    const svg = document.querySelector('#tutorial-band-slot svg.tutorial-band__svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
    expect(svg!.getAttribute('focusable')).toBe('false')

    const box = svg!.querySelector('.tutorial-band__svg-box')
    expect(box).not.toBeNull()
  })

  it('含「知道了」dismiss 鈕：type="button"、可見文字掛 data-i18n、不接事件（main.ts 不動，本 task 範圍外）', () => {
    const dismiss = document.getElementById('tutorial-dismiss')
    expect(dismiss).not.toBeNull()
    expect(dismiss!.tagName.toLowerCase()).toBe('button')
    expect(dismiss!.getAttribute('type')).toBe('button')
    expect(dismiss!.getAttribute('data-i18n')).toBe('tutorial.dismiss')
    expect(dismiss!.textContent).toBe('知道了')
    expect(document.getElementById('tutorial-band-slot')!.contains(dismiss)).toBe(true)
  })
})

describe('T2.6 教學帶：SVG currentColor（原始文字比對，svg 屬性契約）', () => {
  it('index.html 原始文字：教學帶 SVG 的 line／rect 皆以 currentColor 承接主題色', () => {
    const markup = tutorialBandMarkup()
    expect(markup).toMatch(/<svg[^>]*class="tutorial-band__svg"[^>]*aria-hidden="true"[^>]*focusable="false"/)
    expect(markup).toMatch(/<line[^>]*stroke="currentColor"/)
    expect(markup).toMatch(/<rect[^>]*class="tutorial-band__svg-box"[^>]*fill="currentColor"/)
  })
})

describe('T2.6 教學帶：prefers-reduced-motion 停格（style.css 原始文字比對）', () => {
  it('style.css 含 @media (prefers-reduced-motion: reduce) 區塊，內含 .tutorial-band__svg-box { animation: none }', () => {
    const mediaMatch = /@media \(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(STYLE_CSS)
    expect(mediaMatch).not.toBeNull()
    const mediaBlock = mediaMatch![1]
    expect(mediaBlock).toMatch(/\.tutorial-band__svg-box\s*\{\s*animation:\s*none;?\s*\}/)
  })

  it('停格版面穩定性（結構性檢核）：keyframes 動畫僅宣告 transform，未動任何影響版面尺寸的屬性', () => {
    const keyframesBlock = firstRuleBlock(STYLE_CSS, /@keyframes tutorial-band-drift\s*\{/)
    // 僅允許 transform／百分比選擇器語法字元存在；不得出現任何寬高/邊界/位移類版面屬性。
    expect(keyframesBlock).toMatch(/transform:\s*translateX/)
    for (const layoutProp of ['width', 'height', 'margin', 'padding', 'top:', 'left:', 'right:', 'bottom:']) {
      expect(keyframesBlock).not.toContain(layoutProp)
    }
  })

  it('停格規則本身（reduced-motion 區塊）不額外宣告版面尺寸屬性——僅 animation:none，證「停格不位移佈局」的靜態面（jsdom 無 layout engine，動態面留待真機／e2e 驗證）', () => {
    const mediaMatch = /@media \(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(STYLE_CSS)
    const mediaBlock = mediaMatch![1]
    const ruleMatch = /\.tutorial-band__svg-box\s*\{([\s\S]*?)\}/.exec(mediaBlock)
    expect(ruleMatch).not.toBeNull()
    const ruleBody = ruleMatch![1]
    expect(ruleBody.trim()).toBe('animation: none;')
  })
})

describe('T2.6 教學帶：[hidden] 防禦不變量（S1-RESULT.md「hidden 警語」）', () => {
  it('src/style.css 仍具備 [hidden]{display:none!important} 防禦規則（T3.5 dismiss 將倚賴此規則）', () => {
    expect(ROOT_STYLE_CSS).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/)
  })

  it('教學帶自身樣式規則（.tutorial-band 系列）不含 display 宣告帶 !important（不得以更高 specificity 蓋過 [hidden] 防禦）', () => {
    const tutorialRuleBlocks = [...STYLE_CSS.matchAll(/\.tutorial-band[\w-]*\s*\{([\s\S]*?)\}/g)].map((m) => m[1])
    expect(tutorialRuleBlocks.length).toBeGreaterThan(0)
    for (const block of tutorialRuleBlocks) {
      expect(block).not.toMatch(/display\s*:\s*[^;]*!important/)
    }
  })

  it('教學帶自身樣式選擇器不含 id 選擇器（`#tutorial-band-slot { ... }`）承載 display——避免高於 [hidden] attribute selector 的 specificity', () => {
    expect(STYLE_CSS).not.toMatch(/#tutorial-band-slot\s*\{[^}]*display\s*:/)
  })
})

describe('T2.6 教學帶：i18n 屬性巡檢不落地未涵蓋屬性', () => {
  it('dismiss 鈕未掛獨立 aria-label（避免 i18n-meta-scan en 重掃因未解析 key 殘留 CJK；可見文字本身即可及名稱，同 #output-dialog-close 慣例）', () => {
    const markup = tutorialBandMarkup()
    const dismissMatch = /<button[^>]*id="tutorial-dismiss"[^>]*>/.exec(markup)
    expect(dismissMatch).not.toBeNull()
    expect(dismissMatch![0]).not.toContain('aria-label')
  })
})

/**
 * T3.5（(internal design doc) §D5 round-2 單一謂詞定稿；
 * TASKS.md T3.5）：教學帶 dismiss 狀態機接線——單一謂詞「顯示 ⟺ 讀值 !==
 * SENTINEL」（key 缺失／讀取失敗／怪值皆顯示，fail-open）。全部案皆收斂
 * 於「`#tutorial-band-slot` 的 `hidden` 屬性有無」這一個觀察面，與該謂詞
 * 語意一一對應；`beforeEach` 清 key，隔離各案（多數案另會自行 boot()，
 * 該函式本身亦清 localStorage，雙重保險不影響案間獨立性）。
 */
describe('T3.5 教學帶 dismiss：狀態機單一謂詞（顯示 ⟺ 讀值 !== SENTINEL，fail-open）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('key 缺失 → 顯示（無 hidden 屬性）', async () => {
    await boot()
    const band = document.getElementById('tutorial-band-slot')!
    expect(band.hasAttribute('hidden')).toBe(false)
  })

  it('「知道了」點擊 → 隱藏＋key 寫入 SENTINEL', async () => {
    await boot()
    const band = document.getElementById('tutorial-band-slot')!
    const dismiss = document.getElementById('tutorial-dismiss') as HTMLButtonElement
    expect(band.hasAttribute('hidden')).toBe(false)

    dismiss.click()

    expect(band.hasAttribute('hidden')).toBe(true)
    expect(localStorage.getItem(TUTORIAL_DISMISS_KEY)).toBe(TUTORIAL_DISMISS_SENTINEL)
  })

  it('dismiss 後重載（重 boot，不清 key）→ 記憶隱藏', async () => {
    await boot()
    ;(document.getElementById('tutorial-dismiss') as HTMLButtonElement).click()
    expect(localStorage.getItem(TUTORIAL_DISMISS_KEY)).toBe(TUTORIAL_DISMISS_SENTINEL)

    await reboot()

    const band = document.getElementById('tutorial-band-slot')!
    expect(band.hasAttribute('hidden')).toBe(true)
  })

  it.each(['true', '0', ''])('怪值（%j，非 SENTINEL）→ 顯示', async (weird) => {
    localStorage.setItem(TUTORIAL_DISMISS_KEY, weird)
    await reboot()
    const band = document.getElementById('tutorial-band-slot')!
    expect(band.hasAttribute('hidden')).toBe(false)
  })

  it('localStorage.getItem 擲錯（如無痕模式封鎖）→ 顯示，且 init 不炸（fail-open）', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    await expect(boot()).resolves.toBeUndefined()

    const band = document.getElementById('tutorial-band-slot')!
    expect(band.hasAttribute('hidden')).toBe(false)
  })

  it('localStorage.setItem 擲錯（如無痕模式封鎖）→ 本次仍隱藏，且不炸（best-effort）', async () => {
    await boot()
    const band = document.getElementById('tutorial-band-slot')!
    const dismiss = document.getElementById('tutorial-dismiss') as HTMLButtonElement

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => dismiss.click()).not.toThrow()
    expect(band.hasAttribute('hidden')).toBe(true)
  })
})
