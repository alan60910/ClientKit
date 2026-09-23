// @vitest-environment jsdom
/**
 * sprint 15 T2.4（(internal design doc) §D1／§D2／§D5；
 * TASKS.md T2.4，改寫 sprint 14 T2.1 版本）：即時預覽自「三欄終形中欄」
 * **復位為 `<main>` 直接子節點的全寬 sticky 頂帶**（捲動模型 M1′-a）。
 * 本檔承接頂帶自身這一面：舊 wrapper 沿革、**捲動停點新契約**、頂帶在
 * `<main>` 內的相對位置、繪序（z-index）歸屬。四區 DOM 序／欄歸屬／兩欄
 * 捲動容器 CSS 契約／`--band-h` 接線見 layout-columns.dom.test.ts。
 *
 * 回歸網比照既有 default-hint.dom.test.ts 的「先以 jsdom 剖析真實
 * index.html 取得 <body>、動態 import main.ts 觸發其 init()」全頁面整合
 * 測試形（見該檔檔頭說明，不重複抄錄）。
 *
 * ── 捲動停點契約（本檔核心，PLAN §D2 末條「捲動停點契約須重定」）──
 * sprint 14 的契約是「停點總數＝1」，以「全頁無 `[role="region"]
 * [tabindex="0"]` 節點」機械斷言。本批版面把捲動容器由 1 個變成 3 個
 * （頂帶內的終端框＋目錄欄＋列區欄），該總數契約須重定，但**不能**在
 * jsdom 層宣稱「瀏覽器實際停點總數」：
 *
 *   ・Chromium 會自動為「無可聚焦子節點的捲動容器」補上鍵盤停點，該停點
 *     **不帶** `role="region"`、也不寫進 DOM——現有選擇器抓不到它。
 *   ・jsdom 沒有 layout 引擎，更不會模擬這條瀏覽器行為。
 *
 * 故本層改鎖**作者顯式宣告**的停點清單與順序（`[tabindex="0"]` 的實際
 * 節點集合），並顯式斷言「兩個欄捲動容器不自行加停點／不加 role=region」
 * ——真瀏覽器的停點總數與 Tab 序回歸基準由 MS4 e2e 承接（PLAN
 * §Verification「測試層歸屬」硬性規定：純 CSS/瀏覽器行為的斷言不得落
 * jsdom，否則只能寫死 mock 值＝恆真斷言）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const HTML_PATH = path.resolve(DIR, 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

const STYLE_CSS = readFileSync(path.resolve(DIR, 'style.css'), 'utf-8')

/** 取 style.css 原始文字中，選擇器第一次出現處對應的規則區塊內文（不含大括號、假設無巢狀大括號，同 layout-columns.dom.test.ts 慣例）。 */
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

describe('T2.1 版面沿革：舊 wrapper 退役／復用', () => {
  beforeAll(async () => {
    await boot()
  })

  it('.builder-columns__aside 已退役（不存在於 DOM，T4.1 沿革）', () => {
    expect(document.querySelector('.builder-columns__aside')).toBeNull()
  })

  it('.builder-columns__selected 已退役（#selected-section 不自帶此 class，改巢在列區欄內）', () => {
    expect(document.querySelector('.builder-columns__selected')).toBeNull()
  })

  /*
   * sprint 15 T2.1：`.builder-columns__catalog` **復用**（sprint 14 曾判
   * 「已退役」，因當時該 class 的語意是「設定＋目錄同欄」的混合欄，目錄
   * 搬走後名不副實）。本批的四區版面下，它的語意精確等於「segment 目錄
   * 欄」——沿用既有 BEM 命名（`.builder-columns__*`）比另造新名更一致，
   * 故改寫舊斷言為「復用且必須是目錄欄本身」，而非放著一條與現況相反的
   * 退役斷言。
   */
  it('.builder-columns__catalog 復用為「segment 目錄欄」（＝#catalog-section，D4 skip 落點的外層容器）', () => {
    const catalogCol = document.querySelector('.builder-columns__catalog')
    expect(catalogCol).not.toBeNull()
    expect(catalogCol!.id).toBe('catalog-section')
    expect(catalogCol!.querySelector('.segment-lists')).not.toBeNull()
    // 設定不再與目錄同欄（sprint 14 混合欄語意就此消滅）。
    expect(catalogCol!.querySelector('#global-section')).toBeNull()
  })
})

describe('T2.1 捲動停點契約（新版面：3 個捲動容器，作者顯式停點仍只有終端框）', () => {
  beforeAll(async () => {
    await boot()
  })

  it('#preview-section 保留 role="region"，不帶 tabindex（頂帶自身非捲動容器——40dvh 由終端框內捲吸收）', () => {
    const band = document.getElementById('preview-section')
    expect(band).not.toBeNull()
    expect(band!.getAttribute('role')).toBe('region')
    expect(band!.hasAttribute('tabindex')).toBe(false)
  })

  it('#preview-terminal 維持 tabindex="0"（頂帶內唯一顯式捲動停點）', () => {
    const terminal = document.getElementById('preview-terminal')
    expect(terminal).not.toBeNull()
    expect(terminal!.getAttribute('tabindex')).toBe('0')
  })

  it('全頁無 [role="region"][tabindex="0"] 節點（sprint 14 既有不變量，新版面續守）', () => {
    expect(document.querySelectorAll('[role="region"][tabindex="0"]').length).toBe(0)
  })

  it('兩個新捲動容器（目錄欄／列區欄）不自加 tabindex、不掛 role="region"', () => {
    for (const selector of ['#catalog-section', '#list-column']) {
      const col = document.querySelector(selector)!
      expect(col, `${selector} 應存在`).not.toBeNull()
      expect(col.hasAttribute('tabindex'), `${selector} 不應自加停點`).toBe(false)
      expect(col.getAttribute('role'), `${selector} 不應掛 role`).toBeNull()
    }
  })

  /*
   * 「停點總數」新契約在本層的可測形式＝**作者顯式宣告的停點清單與順序**
   * （`[tabindex="0"]`）。刻意不寫「瀏覽器停點總數＝N」：Chromium 會為
   * 無可聚焦子節點的捲動容器自動補停點（不帶 role="region"、不落 DOM），
   * jsdom 也不模擬——在此宣稱總數等同把 mock 值寫成答案（恆真斷言）。
   * 真瀏覽器的停點總數與 Tab 序回歸基準由 MS4 e2e 承接。
   */
  it('版面骨架的顯式 tabindex="0" 節點清單＝終端框 → 三份產出 <pre>（DOM 序，無其他作者停點）', () => {
    const main = document.querySelector('main')!
    // 排除段列子樹（#segment-row-groups／#segment-hidden-pool）：其中的
    // 色彩 spinbutton 等控件由 <template> 動態生成、數量隨啟用段浮動，
    // 屬控件層契約（各自的 dom 案負責），不是版面骨架的停點契約。
    const explicitStops = Array.from(main.querySelectorAll('[tabindex="0"]'))
      .filter((el) => el.closest('#segment-row-groups, #segment-hidden-pool') === null)
      .map((el) => el.id)
    expect(explicitStops).toEqual(['preview-terminal', 'output-bash', 'output-ps1', 'output-settings'])
  })
})

describe('T2.1 頂帶結構與 DOM 序（M1′-a：`<main>` 直接子節點的全寬頂帶）', () => {
  beforeAll(async () => {
    await boot()
  })

  it('#preview-section 為 <main> 直接子節點，且排在 .builder-columns 之前（不再是三欄中欄）', () => {
    const main = document.querySelector('main')
    const band = document.getElementById('preview-section')
    const columns = document.querySelector('.builder-columns')
    expect(main).not.toBeNull()
    expect(band).not.toBeNull()
    expect(columns).not.toBeNull()

    expect(band!.parentElement).toBe(main)
    expect(columns!.contains(band)).toBe(false)
    expect(Boolean(band!.compareDocumentPosition(columns!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('#output-dialog 位於 <main> 內（產出腳本收斂為 dialog，非已退役的 aside）', () => {
    const main = document.querySelector('main')
    const output = document.getElementById('output-dialog')
    expect(main).not.toBeNull()
    expect(output).not.toBeNull()
    expect(output!.tagName).toBe('DIALOG')
    expect(main!.contains(output)).toBe(true)
  })

  it('D5 頂帶整包：標題／底色 ×2／情境 ×4／產出腳本鈕／示範時鐘句／終端框皆在 #preview-section 內', () => {
    const band = document.getElementById('preview-section')!
    for (const selector of [
      '#preview-heading',
      '#preview-bg-dark',
      '#preview-bg-light',
      '#scenario-full',
      '#scenario-early-null',
      '#scenario-conditional-absent',
      '#scenario-windows-cjk',
      '#output-dialog-open',
      '#preview-mock-clock-hint',
      '#preview-terminal',
    ]) {
      expect(band.querySelector(selector), `${selector} 應在頂帶內`).not.toBeNull()
    }
  })

  it('D5 產出腳本鈕位於頂帶控制列末端（右端對齊由 .preview-controls__output-open 的 margin-left:auto 承擔）', () => {
    const controls = document.querySelector('.preview-controls')!
    expect(controls.lastElementChild!.id).toBe('output-dialog-open')
    const block = firstRuleBlock(STYLE_CSS, /(?:^|\n)\.preview-controls__output-open\s*\{/)
    expect(block).toMatch(/margin-left:\s*auto/)
  })
})

describe('T2.2 頂帶繪序歸屬（style.css 原始文字檢核；D2 頂帶 z-index 值域）', () => {
  it('.preview-section 全斷點 sticky（top:0）——A2 定案，行動版垂直壓力由 D8 目錄收合吸收', () => {
    const block = firstRuleBlock(STYLE_CSS, /(?:^|\n)\.preview-section\s*\{/)
    expect(block).toMatch(/position:\s*sticky/)
    expect(block).toMatch(/top:\s*0/)
    // 全斷點生效＝規則本體不在任何 @media 內；此處以「規則起點早於第一個
    // @media」機械確認（本檔 @media 區塊全數集中在檔尾版面節）。
    const ruleIndex = STYLE_CSS.search(/(?:^|\n)\.preview-section\s*\{/)
    const firstMediaIndex = STYLE_CSS.indexOf('@media (min-width: 1100px)')
    expect(ruleIndex).toBeGreaterThan(-1)
    expect(firstMediaIndex).toBeGreaterThan(-1)
    expect(ruleIndex).toBeLessThan(firstMediaIndex)
  })

  it('頂帶 z-index 須 <10（skip-link 為 10）——否則會蓋掉聚焦中的 skip-link，抵銷 G6 提升的補償', () => {
    const bandBlock = firstRuleBlock(STYLE_CSS, /(?:^|\n)\.preview-section\s*\{/)
    const bandZ = /z-index:\s*(\d+)/.exec(bandBlock)
    expect(bandZ, '.preview-section 應宣告 z-index（繪序保護，MAGI 🟡-4 沿革）').not.toBeNull()

    const skipBlock = firstRuleBlock(STYLE_CSS, /(?:^|\n)\.skip-link\s*\{/)
    const skipZ = /z-index:\s*(\d+)/.exec(skipBlock)
    expect(skipZ, '.skip-link 應宣告 z-index').not.toBeNull()

    expect(Number(bandZ![1])).toBeGreaterThan(0) // 高於預設 auto 的一般後代（如 .color-swatch）
    expect(Number(bandZ![1])).toBeLessThan(Number(skipZ![1]))
  })
})

describe('T2.1 頂帶：mock 時鐘常駐說明（G4，T4.1 沿革）', () => {
  beforeAll(async () => {
    await boot()
  })

  it('#preview-mock-clock-hint 渲染出常駐提示文字（示範時鐘／真時鐘皆提及）', () => {
    const hint = document.getElementById('preview-mock-clock-hint')
    expect(hint).not.toBeNull()
    expect(hint!.textContent).toBeTruthy()
    expect(hint!.textContent).toMatch(/示範時鐘/)
    expect(hint!.textContent).toMatch(/真時鐘/)
  })
})
