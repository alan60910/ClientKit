// @vitest-environment jsdom
/**
 * sprint 15 T2.4（(internal design doc) §D1／§D2／§D3／
 * §D6／§D7；TASKS.md T2.4，改寫 sprint 14 版本）：四區版面的結構與 CSS
 * 契約案。preview-band.dom.test.ts 承接「頂帶自身＋捲動停點＋繪序」那一
 * 面（見該檔），本檔承接：
 *
 * 1. **四區 DOM 序**：`<main>` 直接子節點序＝skip-nav → #output-status／
 *    #error-message → 預覽頂帶 → `.builder-columns`（G3：DOM 序＝視覺序
 *    ＝Tab 序，零 CSS `order`、零 JS 搬移）。
 * 2. **欄歸屬**：`.builder-columns` 內恰三欄（目錄｜列區｜設定），且教學帶／
 *    目錄四類分區／已選擇／全域設定各自落在正確的欄內。
 * 3. **捲動容器數量與 CSS 契約**：目錄欄與列區為**兩個**獨立捲動容器
 *    （sticky／top:var(--band-h)／max-height calc／overflow-y／
 *    overscroll-behavior:contain），設定欄**不**設獨立捲軸（OQ-2 定案）。
 * 4. **`--band-h` 接線**（取代已作廢的 `--column-top` 體制）：main.ts
 *    `syncBandHeight()` 於 init 一次性同步寫入 **`<main>` 元素**（不掛
 *    `:root`）。jsdom 無真實 layout 引擎、`getBoundingClientRect()` 恆回
 *    全零矩形，故以 stub 驗證「依頂帶高度寫入 CSS 變數」的接線本身。
 * 5. **層疊歸屬斷言**（D7）：斷言規則的**字面位置落在哪個 `@media` 區塊
 *    內**，禁用「規則存在性」比對——後者曾在 sprint 14 產生假綠（基準
 *    規則寫在 media 外、源序後到而整條蓋掉行動版解除規則，1932 案全綠
 *    仍帶 Critical）。
 *
 * jsdom 不套用外部 stylesheet（main.ts 的 `import './style.css'` 在 vitest
 * 下為無 side-effect 的模組匯入），無法靠 `getComputedStyle` 斷言 CSS，
 * 故 CSS 面一律讀 style.css **原始文字**比對（同 scripts/verify-dist-checks.mjs
 * 等既有工具的慣例，非新發明手法）。真實 layout 幾何（頂帶恆可見、欄頭
 * 遮蔽殘差 ≤140px 等）**刻意不落本層**——PLAN §Verification「測試層歸屬」
 * 硬性規定該類斷言須以 e2e 真瀏覽器編碼，否則只能寫死 mock 值＝恆真斷言。
 *
 * 回歸網比照既有 preview-band.dom.test.ts 的「先以 jsdom 剖析真實
 * index.html 取得 <body>、動態 import main.ts 觸發其 init()」全頁面整合
 * 測試形（見該檔檔頭說明，不重複抄錄）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { allMediaBlockRanges, mediaBlockRange, stripCssComments } from './css-scan-test-utils.js'

// 檔級 testTimeout（比照 i18n-dom.dom.test.ts／lang-switch.dom.test.ts／
// pipeline.integration.test.ts 既有先例，同以 30_000 收斂）：下方
// 「--band-h 接線」describe 的每個案都在案內 `await boot()`（重跑 main.ts
// 全依賴圖＋init() 建 30 段目錄／列群組），其中「高度變動於下次 init 反映
// 新值」一案更是**單案兩次 boot**——隔離跑約 2s，但全套件 21 個 jsdom 檔
// 並行時排程延遲會把它推過 vitest 預設 5000ms（sprint 15 前的等價案
// 〔`--column-top` 版〕即已列在既知 flake 名單內，見 spikes/S-h-RESULT.md
// 「隔離重跑判別」表）。此處把該病史體制化，避免版面契約案的紅燈訊號被
// 環境負載雜訊淹沒。
vi.setConfig({ testTimeout: 30_000 })

const DIR = path.dirname(fileURLToPath(import.meta.url))
const HTML_PATH = path.resolve(DIR, 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

const STYLE_CSS = readFileSync(path.resolve(DIR, 'style.css'), 'utf-8')
const MAIN_TS = readFileSync(path.resolve(DIR, 'main.ts'), 'utf-8')

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（同既有 dom.test 慣例）。 */
async function boot(html: string = BODY_HTML): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = html
  vi.resetModules()
  await import('./main.js')
}

/** 取 style.css 原始文字中，選擇器第一次出現處對應的規則區塊內文（不含大括號、假設無巢狀大括號）。 */
function firstRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (match === null) throw new Error(`style.css 找不到符合 ${selectorPattern} 的規則`)
  const openIndex = css.indexOf('{', match.index)
  const closeIndex = css.indexOf('}', openIndex)
  return css.slice(openIndex + 1, closeIndex)
}

/**
 * 取 style.css 原始文字中，指定 class 選擇器（獨立成行）每一次出現對應
 * 的規則區塊內文。sprint 15 T2.4 微調：行尾允許 `,`（逗號複選規則的
 * 任一子句皆算命中）——本批的兩欄捲動契約刻意寫成單一逗號複選規則
 * （`.builder-columns__catalog, .builder-columns__list { … }`），是「兩欄
 * 共用同一份契約」的單一事實來源，若只認 `{` 結尾會整條漏抓。
 */
function allRuleBlocksForClassSelector(css: string, className: string): string[] {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|\\n)[ \\t]*\\.${escaped}\\s*[,{]`, 'g')
  const blocks: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    const openIndex = css.indexOf('{', match.index)
    const closeIndex = css.indexOf('}', openIndex)
    blocks.push(css.slice(openIndex + 1, closeIndex))
  }
  return blocks
}

/**
 * 桌面斷點的 `@media` 標頭 pattern（本檔既有三處歸屬斷言＋下方 D8
 * summary 歸屬斷言共用；skip-nav.dom.test.ts 另有同語意的一份，各自
 * 鎖各自檔內的契約）。
 *
 * `stripCssComments`／`mediaBlockRange`／`allMediaBlockRanges` 的實作
 * （含 sprint 15 T2.5 的「掃描前剝除註解」治本）自 MAGI code review
 * 🟡-4 起收斂於 `./css-scan-test-utils.ts`，本檔改為 import 共用——原
 * 因與 API 說明見該模組檔頭；下方 T2.5 三例即該模組的自身回歸案（留在
 * 本檔的理由見該 describe 註解）。
 */
const DESKTOP_MEDIA_HEADER = /@media \(min-width:\s*1100px\)\s*\{/

/** `<main>` 的直接子元素清單（不含文字節點／註解）。 */
function mainChildren(): Element[] {
  const main = document.querySelector('main')
  if (main === null) throw new Error('缺少 <main>')
  return Array.from(main.children)
}

describe('T2.1 四區 DOM 序（<main> 直接子節點；G3 DOM 序＝視覺序＝Tab 序）', () => {
  beforeAll(async () => {
    await boot()
  })

  it('skip-nav 為 <main> 的第一個直接子元素（G6 提升；非 Tab 首站——<header> 內恆有三個可聚焦元素在前）', () => {
    const [first] = mainChildren()
    expect(first).toBeDefined()
    expect(first!.tagName).toBe('NAV')
    expect(first!.classList.contains('skip-nav')).toBe(true)
    // 提升後不再巢在任一欄內（sprint 14 曾住 .builder-columns__settings）。
    expect(first!.closest('.builder-columns')).toBeNull()
  })

  it('前四區依序＝skip-nav → #output-status → #error-message → #preview-section → .builder-columns', () => {
    const order = mainChildren()
      .map((el) => el.id || el.className)
      .filter((key) => key.length > 0)
    const skipIndex = order.findIndex((k) => k.includes('skip-nav'))
    const statusIndex = order.indexOf('output-status')
    const errorIndex = order.indexOf('error-message')
    const bandIndex = order.indexOf('preview-section')
    const columnsIndex = order.findIndex((k) => k.split(/\s+/).includes('builder-columns'))

    for (const [name, index] of Object.entries({ skipIndex, statusIndex, errorIndex, bandIndex, columnsIndex })) {
      expect(index, `${name} 應存在於 <main> 直接子節點`).toBeGreaterThanOrEqual(0)
    }
    expect(skipIndex).toBeLessThan(statusIndex)
    expect(statusIndex).toBeLessThan(errorIndex)
    expect(errorIndex).toBeLessThan(bandIndex)
    expect(bandIndex).toBeLessThan(columnsIndex)
  })

  it('頂帶為 <main> 直接子節點、**不在** .builder-columns 內（捲動模型 M1′-a：sticky 包含塊須為 main 的 content box）', () => {
    const band = document.getElementById('preview-section')!
    const columns = document.querySelector('.builder-columns')!
    expect(band.parentElement).toBe(document.querySelector('main'))
    expect(columns.contains(band)).toBe(false)
  })

  it('#segment-hidden-pool 與 #output-dialog 仍在 <main> 內、三欄 wrapper 之外（隱藏元素/對話框不參與欄版面）', () => {
    const columns = document.querySelector('.builder-columns')!
    for (const id of ['segment-hidden-pool', 'output-dialog']) {
      const el = document.getElementById(id)
      expect(el, `#${id} 應存在`).not.toBeNull()
      expect(document.querySelector('main')!.contains(el)).toBe(true)
      expect(columns.contains(el)).toBe(false)
    }
  })
})

describe('T2.1 欄歸屬（.builder-columns 恰三欄：目錄｜列區｜設定）', () => {
  beforeAll(async () => {
    await boot()
  })

  it('.builder-columns 的直接子元素恰為三欄、且序＝目錄 → 列區 → 設定', () => {
    const columns = document.querySelector('.builder-columns')!
    const children = Array.from(columns.children)
    expect(children.length).toBe(3)
    expect(children[0]!.classList.contains('builder-columns__catalog')).toBe(true)
    expect(children[0]!.id).toBe('catalog-section') // D4「跳至目錄」落點（連結本身屬 MS3）
    expect(children[1]!.classList.contains('builder-columns__list')).toBe(true)
    expect(children[1]!.id).toBe('list-column')
    expect(children[2]!.classList.contains('builder-columns__settings')).toBe(true)
  })

  it('目錄欄內容序＝教學帶 → 目錄四類分區（D5 附掛遷移：教學帶自右欄頂遷至目錄欄頂）', () => {
    const catalogCol = document.getElementById('catalog-section')!
    const tutorial = document.getElementById('tutorial-band-slot')
    const segmentLists = catalogCol.querySelector('.segment-lists')
    expect(tutorial).not.toBeNull()
    expect(segmentLists).not.toBeNull()
    expect(catalogCol.contains(tutorial)).toBe(true)
    expect(
      Boolean(tutorial!.compareDocumentPosition(segmentLists!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
    // 四類分區的 <ol> 掛點全數隨遷（只搬不刪）。
    for (const id of ['segment-list-always', 'segment-list-percentage', 'segment-list-conditional', 'segment-list-shellout']) {
      expect(catalogCol.contains(document.getElementById(id)), `#${id} 應在目錄欄內`).toBe(true)
    }
  })

  it('列區欄只裝 #selected-section（含列群組容器／新增一列鈕／排序播報 live region）', () => {
    const listCol = document.getElementById('list-column')!
    const selected = document.getElementById('selected-section')
    expect(selected).not.toBeNull()
    expect(listCol.contains(selected)).toBe(true)
    for (const id of ['segment-row-groups', 'add-pending-row', 'segment-move-status']) {
      expect(listCol.contains(document.getElementById(id)), `#${id} 應在列區欄內`).toBe(true)
    }
    // 目錄已搬出列區欄（sprint 14 的「同居單一捲動容器」就此消滅——本批
    // 承重不變量：拖曳的來源與目標分屬獨立捲動容器）。
    expect(listCol.querySelector('.segment-lists')).toBeNull()
    expect(listCol.contains(document.getElementById('tutorial-band-slot'))).toBe(false)
  })

  it('設定欄只裝 #global-section（skip-nav 已提升出去，不再與設定同欄）', () => {
    const settingsCol = document.querySelector('.builder-columns__settings')!
    const global = document.getElementById('global-section')
    expect(global).not.toBeNull()
    expect(settingsCol.contains(global)).toBe(true)
    expect(settingsCol.querySelector('nav.skip-nav')).toBeNull()
  })

  it('#selected-section 保留 role="region"／aria-label，不帶 tabindex（本容器非捲動容器——捲動歸外層列區欄）', () => {
    const selected = document.getElementById('selected-section')!
    expect(selected.getAttribute('role')).toBe('region')
    expect(selected.hasAttribute('aria-label')).toBe(true)
    expect(selected.hasAttribute('tabindex')).toBe(false)
  })
})

describe('T2.3 --band-h 接線（main.ts syncBandHeight，jsdom 下 stub 頂帶高度）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.querySelector('main')?.removeAttribute('style')
  })

  /** 讓 `#preview-section` 的 getBoundingClientRect 回傳指定高度、其餘元素回零矩形。 */
  function stubBandHeight(height: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const h = this.id === 'preview-section' ? height : 0
      return {
        height: h,
        width: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: h,
        x: 0,
        y: 0,
        toJSON() {
          return {}
        },
      } as DOMRect
    })
  }

  it('init 時依頂帶實際渲染高度（四捨五入）寫入 <main> 的 --band-h，而**非** :root', async () => {
    stubBandHeight(191.6)
    await boot()

    // 191.6 四捨五入為 192（syncBandHeight 以 Math.round 取整）。
    expect(document.querySelector('main')!.style.getPropertyValue('--band-h')).toBe('192px')
    // S-a 三項防護 (b)：作用域限縮在消費它的子樹，不得污染 :root。
    expect(document.documentElement.style.getPropertyValue('--band-h')).toBe('')
  })

  it('頂帶高度變動（終端框列數／控制列換行）於下次 init 反映新值——非寫死常數', async () => {
    stubBandHeight(300)
    await boot()
    expect(document.querySelector('main')!.style.getPropertyValue('--band-h')).toBe('300px')

    vi.restoreAllMocks()
    stubBandHeight(232)
    await boot()
    expect(document.querySelector('main')!.style.getPropertyValue('--band-h')).toBe('232px')
  })

  it('缺 <main> 節點時 no-op（防禦性：RO 回呼可於任意時點呼叫，不因此拋錯）', async () => {
    // 只拔除 <main>／</main> 標籤本身（子節點全部留在文件中，避免 main.ts
    // 其他接線因找不到節點而拋錯——本案只想測 syncBandHeight 的 no-op 分支）。
    const bodyWithoutMainTag = BODY_HTML.replace('<main>', '').replace('</main>', '')
    expect(bodyWithoutMainTag).not.toBe(BODY_HTML)

    stubBandHeight(200)
    await boot(bodyWithoutMainTag)

    expect(document.querySelector('main')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--band-h')).toBe('')
  })

  it('jsdom 無 ResizeObserver：init() 不因 RO 接線而拋錯（特徵偵測守衛，S-e 定案修法步驟 1）', async () => {
    expect(typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBe('undefined')
    stubBandHeight(180)
    await expect(boot()).resolves.toBeUndefined()
    // 守衛跳過 RO，但初始同步寫入仍發生（S-e 定案修法步驟 2 的用意）。
    expect(document.querySelector('main')!.style.getPropertyValue('--band-h')).toBe('180px')
  })
})

describe('T2.3 --column-top 體制作廢（全鏈零殘留）', () => {
  it('style.css／index.html／main.ts 皆不再提及 --column-top 或 syncColumnTop', () => {
    expect(STYLE_CSS).not.toMatch(/--column-top/)
    expect(RAW_HTML).not.toMatch(/--column-top/)
    expect(MAIN_TS).not.toMatch(/--column-top/)
    expect(MAIN_TS).not.toMatch(/syncColumnTop/)
  })
})

describe('T2.2 頂帶高度預算掛載點（style.css 原始文字檢核：自 .preview-terminal 遷回頂帶自身）', () => {
  it('.preview-section 帶 max-height:40dvh（D1「頂帶整體 ≤40dvh」，上限掛頂帶）', () => {
    const block = firstRuleBlock(STYLE_CSS, /(?:^|\n)\.preview-section\s*\{/)
    expect(block).toMatch(/max-height:\s*40dvh/)
  })

  it('.preview-terminal 不再帶 max-height，改 flex:1 1 auto＋min-height:0（超出量由本框內捲吸收）', () => {
    const block = firstRuleBlock(STYLE_CSS, /(?:^|\n)\.preview-terminal\s*\{/)
    expect(block).not.toMatch(/max-height/)
    expect(block).toMatch(/flex:\s*1 1 auto/)
    expect(block).toMatch(/min-height:\s*0/)
    expect(block).toMatch(/overflow-y:\s*auto/)
  })
})

describe('T2.2 兩欄獨立捲動容器 CSS 契約（style.css 原始文字檢核）', () => {
  it('目錄欄與列區共用同一條規則：sticky／top:var(--band-h)／max-height calc(100dvh - var(--band-h))／overflow-y:auto／overscroll-behavior:contain', () => {
    const blocks = allRuleBlocksForClassSelector(STYLE_CSS, 'builder-columns__catalog')
    const stickyBlock = blocks.find((block) => /position:\s*sticky/.test(block))
    expect(stickyBlock).toBeDefined()
    expect(stickyBlock).toMatch(/top:\s*var\(--band-h/)
    expect(stickyBlock).toMatch(/max-height:\s*calc\(100dvh\s*-\s*var\(--band-h/)
    expect(stickyBlock).toMatch(/overflow-y:\s*auto/)
    // S-g 定案（組態 O1）：兩欄皆掛 contain。
    expect(stickyBlock).toMatch(/overscroll-behavior:\s*contain/)

    // 同一條規則同時涵蓋列區（逗號複選）——「兩個獨立捲動容器」是單一
    // 事實來源，不得分裂成兩份可能走樣的規則。
    const listBlocks = allRuleBlocksForClassSelector(STYLE_CSS, 'builder-columns__list')
    expect(listBlocks).toContain(stickyBlock)
  })

  it('設定欄不設獨立捲軸（OQ-2 定案：自然高 440px 有正餘裕，不掛 max-height／overflow）', () => {
    for (const block of allRuleBlocksForClassSelector(STYLE_CSS, 'builder-columns__settings')) {
      expect(block).not.toMatch(/max-height/)
      expect(block).not.toMatch(/overflow/)
      expect(block).not.toMatch(/position:\s*sticky/)
    }
  })

  it('D3 軌寬＝minmax(340px, 1fr) 1.6fr 0.9fr（S-j 定案；列區 1.6fr 恆為三欄最寬＝G7）', () => {
    const blocks = allRuleBlocksForClassSelector(STYLE_CSS, 'builder-columns')
    const gridBlock = blocks.find((block) => /grid-template-columns/.test(block))
    expect(gridBlock).toBeDefined()
    expect(gridBlock).toMatch(/grid-template-columns:\s*minmax\(340px,\s*1fr\)\s*1\.6fr\s*0\.9fr/)
  })
})

describe('T2.2 層疊歸屬（D7：斷言規則字面落在哪個 @media 區塊，禁「規則存在性」比對）', () => {
  /** 取所有「以 `.<className>` 起頭的規則」在原始文字中的起點索引，並以述詞過濾規則內文。 */
  function ruleStartIndexes(className: string, predicate: (block: string) => boolean): number[] {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(?:^|\\n)[ \\t]*\\.${escaped}\\s*[,{]`, 'g')
    const indexes: number[] = []
    let match: RegExpExecArray | null
    while ((match = pattern.exec(STYLE_CSS)) !== null) {
      const openIndex = STYLE_CSS.indexOf('{', match.index)
      const closeIndex = STYLE_CSS.indexOf('}', openIndex)
      if (predicate(STYLE_CSS.slice(openIndex + 1, closeIndex))) indexes.push(match.index)
    }
    return indexes
  }

  /**
   * MAGI code review 🟡-4 修法：把「style.css 內同條件 `@media` 區塊有
   * 幾個」這個**隱性假設**變顯性。本檔既有三處歸屬斷言與 skip-nav 的
   * 「不落在 media 內」斷言，都建立在「知道總共有哪些同條件區塊」之上：
   * 前者只指名**第一個**（三欄版面節）、下方 D8 summary 案指名**第二個**
   * （目錄收合節）。日後增／減同條件區塊本案即紅，逼迫同步檢視所有掃描
   * 呼叫點的區塊序號是否仍指向原意的規則群。
   */
  it('style.css 內 @media (min-width: 1100px) 區塊恰為 2 個（三欄版面節／D8 目錄收合節；顯式契約，🟡-4）', () => {
    const ranges = allMediaBlockRanges(STYLE_CSS, DESKTOP_MEDIA_HEADER)
    expect(ranges.length).toBe(2)
    // 兩區塊互不重疊、依源序排列（下方「第 N 個區塊」定址的前提）。
    expect(ranges[0]!.end).toBeLessThanOrEqual(ranges[1]!.start)
  })

  it('兩欄 sticky 基準規則恰一條，且字面位置歸屬 @media (min-width: 1100px) 區塊內', () => {
    const mediaRange = mediaBlockRange(STYLE_CSS, DESKTOP_MEDIA_HEADER)
    const stickyIndexes = ruleStartIndexes(
      'builder-columns__catalog',
      (block) => /position:\s*sticky/.test(block) && /max-height:\s*calc\(100dvh/.test(block),
    )

    expect(stickyIndexes.length).toBe(1)
    const [stickyIndex] = stickyIndexes
    expect(stickyIndex!).toBeGreaterThan(mediaRange.start)
    expect(stickyIndex!).toBeLessThan(mediaRange.end)
  })

  it('不存在 media 外（無條件）的欄 sticky／max-height 基準規則——<1100px 天然回歸文件流，不靠源序覆蓋', () => {
    const mediaRange = mediaBlockRange(STYLE_CSS, DESKTOP_MEDIA_HEADER)
    const outside = [
      ...ruleStartIndexes('builder-columns__catalog', (block) => /position:\s*sticky|max-height/.test(block)),
      ...ruleStartIndexes('builder-columns__list', (block) => /position:\s*sticky|max-height/.test(block)),
    ].filter((index) => index <= mediaRange.start || index >= mediaRange.end)
    expect(outside).toEqual([])
  })

  it('三軌 grid 只在 ≥1100px 生效；wrapper 的無條件規則不得帶 grid-template-columns（<1100px 須單欄堆疊）', () => {
    const mediaRange = mediaBlockRange(STYLE_CSS, DESKTOP_MEDIA_HEADER)
    const gridIndexes = ruleStartIndexes('builder-columns', (block) => /grid-template-columns/.test(block))
    expect(gridIndexes.length).toBe(1)
    expect(gridIndexes[0]!).toBeGreaterThan(mediaRange.start)
    expect(gridIndexes[0]!).toBeLessThan(mediaRange.end)

    const unconditional = ruleStartIndexes('builder-columns', () => true).filter(
      (index) => index <= mediaRange.start || index >= mediaRange.end,
    )
    for (const index of unconditional) {
      const openIndex = STYLE_CSS.indexOf('{', index)
      const closeIndex = STYLE_CSS.indexOf('}', openIndex)
      expect(STYLE_CSS.slice(openIndex + 1, closeIndex)).not.toMatch(/grid-template-columns/)
    }
  })

  /**
   * MAGI code review 🟡-6（dom 部分）修法：PLAN §D8「桌面態硬條件」
   * （≥1100px 時 `<summary>` 不得為 Tab 停點／不可點擊／a11y 播報與可見
   * 狀態一致）唯一的 CSS 承載規則＝`.segment-lists-details__summary
   * { display: none }`，先前**零回歸覆蓋**：誤刪或搬出 media 區塊
   * （＝行動版也隱藏收合把手、目錄再也收不起來）不會有任何紅燈。
   *
   * 本案以歸屬斷言把它納入回歸網：規則字面須落在**第二個**
   * `@media (min-width: 1100px)` 區塊內（D8 目錄收合節；上方「區塊恰
   * 2 個」契約案鎖住此序號的前提）。真瀏覽器桌面態的 computed style
   * （`display === 'none'`）依 PLAN §Verification「測試層歸屬」歸 e2e，
   * 不在本層——jsdom 不套用外部 stylesheet（見本檔檔頭）。
   */
  it('D8 桌面態硬條件：.segment-lists-details__summary 的 display:none 規則字面落在**第二個** @media (min-width: 1100px) 區塊內（🟡-6）', () => {
    const secondMediaRange = mediaBlockRange(STYLE_CSS, DESKTOP_MEDIA_HEADER, 2)
    const hideIndexes = ruleStartIndexes('segment-lists-details__summary', (block) =>
      /display:\s*none/.test(block),
    )

    expect(hideIndexes.length).toBe(1)
    const [hideIndex] = hideIndexes
    expect(hideIndex!).toBeGreaterThan(secondMediaRange.start)
    expect(hideIndex!).toBeLessThan(secondMediaRange.end)

    // 反面：桌面態隱藏**只**由 media 內這一條承擔，media 外不得有同選擇器
    // 的無條件 display:none（那會使 <1100px 也隱藏收合把手，D8 失效）。
    const firstMediaRange = mediaBlockRange(STYLE_CSS, DESKTOP_MEDIA_HEADER)
    const outsideAnyDesktopMedia = hideIndexes.filter(
      (index) =>
        (index <= firstMediaRange.start || index >= firstMediaRange.end) &&
        (index <= secondMediaRange.start || index >= secondMediaRange.end),
    )
    expect(outsideAnyDesktopMedia).toEqual([])
  })

  it('`main` 不再是 grid／flex 版面容器（四區版面把 grid 下移到 .builder-columns；連帶 #output-status 的 grid-column 跨欄宣告作廢）', () => {
    expect(STYLE_CSS).not.toMatch(/(?:^|\n)[ \t]*main\s*\{[^}]*display:\s*(?:grid|flex)/)
    // 比對「宣告」而非字樣：行首＋分號結尾，才不會誤中註解裡的引用。
    expect(STYLE_CSS).not.toMatch(/(?:^|\n)[ \t]*grid-column:\s*1\s*\/\s*-1\s*;/)
  })
})

describe('T2.5 mediaBlockRange 註解剝除（D7 出口條件：CSS 註解內孤立大括號不再使深度計數錯位）＋🟡-4 第 N 區塊定址', () => {
  // 手工小型 css 字串，不依賴真實 style.css（本節案自成一組獨立回歸，
  // 與上方讀真檔的層疊歸屬案互不干擾）。三例皆用同一支 headerPattern，
  // 只換 css 輸入本身。
  //
  // 🟡-4 修法後被測對象搬到 `./css-scan-test-utils.ts`（共用模組），本組
  // 案**留在本檔**而非隨遷到新測試檔：(1) 協調者指定的可改檔案清單只含
  // 一個新模組檔、不含新測試檔；(2) 這組案的立案理由本就是本檔 T2.5 的
  // D7 出口條件（「歸屬斷言的定位工具必須先被證明可靠」），與本檔上方
  // 讀真實 style.css 的歸屬斷言同進退，放在一起讀者可一眼看到「工具正確
  // 性 → 契約斷言」的依存鏈。日後若共用模組長出更多消費者，再連同本組
  // 案一併遷入專屬測試檔。

  it('(a) 註解含孤立 { ：剝除前深度計數失衡（吃到 EOF 仍未歸零），剝除後正確定位到媒體區塊自身的閉合括號、不誤吃後續規則', () => {
    const css = [
      '@media (min-width: 1100px) {',
      '  /* 用 { 標示區塊起點（純文字說明，非真實規則） */',
      '  .b { color: blue; }',
      '}',
      '.c { color: green; }',
    ].join('\n')

    const range = mediaBlockRange(css, /@media \(min-width:\s*1100px\)\s*\{/)
    const block = css.slice(range.start, range.end)

    expect(block.startsWith('@media (min-width: 1100px) {')).toBe(true)
    expect(block.endsWith('}')).toBe(true)
    expect(block).not.toContain('.c')
    // 範圍之後緊接的才是 .c 規則——證明沒有把它一併吞進媒體區塊範圍。
    expect(css.slice(range.end)).toContain('.c { color: green; }')
  })

  it('(b) 註解含孤立 } ：剝除前會在註解處誤判深度提前歸零（漏吃真實規則 `.b`），剝除後正確吃到媒體區塊自身的閉合括號為止', () => {
    const css = [
      '@media (min-width: 1100px) {',
      '  /* 已移除的舊規則說明：原本掛在這裡 } 後來搬走了 */',
      '  .b { color: blue; }',
      '}',
      '.c { color: green; }',
    ].join('\n')

    const range = mediaBlockRange(css, /@media \(min-width:\s*1100px\)\s*\{/)
    const block = css.slice(range.start, range.end)

    expect(block).toContain('.b { color: blue; }')
    expect(block.endsWith('}')).toBe(true)
    expect(block).not.toContain('.c')
  })

  it('(c) 正常無註解 css：行為不變（回歸——剝除路線不得動到既有無註解案的既有正確結果）', () => {
    const css = ['@media (min-width: 1100px) {', '  .b { color: blue; }', '}', '.c { color: green; }'].join('\n')

    const range = mediaBlockRange(css, /@media \(min-width:\s*1100px\)\s*\{/)
    const block = css.slice(range.start, range.end)

    expect(range.start).toBe(0)
    expect(block).toBe('@media (min-width: 1100px) {\n  .b { color: blue; }\n}')
  })

  it('(d) 🟡-4：同條件多個區塊——allMediaBlockRanges 依源序回傳全部，mediaBlockRange 預設仍取第一個（既有呼叫語意零變更）', () => {
    const css = [
      '@media (min-width: 1100px) {',
      '  .first { color: blue; }',
      '}',
      '.between { color: gray; }',
      '@media (min-width: 1100px) {',
      '  .second { color: red; }',
      '}',
    ].join('\n')

    const ranges = allMediaBlockRanges(css, /@media \(min-width:\s*1100px\)\s*\{/)
    expect(ranges.length).toBe(2)
    expect(css.slice(ranges[0]!.start, ranges[0]!.end)).toContain('.first')
    expect(css.slice(ranges[0]!.start, ranges[0]!.end)).not.toContain('.second')
    expect(css.slice(ranges[1]!.start, ranges[1]!.end)).toContain('.second')
    // 區塊之間的規則不屬於任何區塊（skip-nav 的「不落在 media 內」斷言
    // 依賴此性質）。
    const betweenIndex = css.indexOf('.between')
    expect(ranges.some((r) => betweenIndex >= r.start && betweenIndex < r.end)).toBe(false)

    // 預設 occurrence＝1：與 🟡-4 修法前的舊實作逐位元同語意。
    expect(mediaBlockRange(css, /@media \(min-width:\s*1100px\)\s*\{/)).toEqual(ranges[0])
    expect(mediaBlockRange(css, /@media \(min-width:\s*1100px\)\s*\{/, 2)).toEqual(ranges[1])
  })

  it('(e) 🟡-4：指定的區塊序號不存在時擲錯（規則搬進/搬出同條件區塊會得到明確訊號，非靜默假綠）', () => {
    const css = ['@media (min-width: 1100px) {', '  .b { color: blue; }', '}'].join('\n')

    expect(() => mediaBlockRange(css, /@media \(min-width:\s*1100px\)\s*\{/, 2)).toThrow(/實得 1 個/)
    expect(allMediaBlockRanges(css, /@media \(min-width:\s*9999px\)\s*\{/)).toEqual([])
  })

  it('(f) stripCssComments 為**等長**替換：回傳長度與換行位置不變（區塊範圍 index 可直接套回原字串的前提）', () => {
    const css = ['/* 註解含 { 與 } */', '@media (min-width: 1100px) {', '  .b { color: blue; }', '}'].join('\n')
    const stripped = stripCssComments(css)

    expect(stripped.length).toBe(css.length)
    expect(stripped.split('\n').map((line) => line.length)).toEqual(css.split('\n').map((line) => line.length))
    expect(stripped).not.toContain('註解')
    expect(stripped).toContain('.b { color: blue; }')
  })
})

/**
 * T3.5（TASKS.md「Tab 序回歸基準」；PLAN.md §Verification「Tab 序回歸
 * 基準」；spikes/S-c-RESULT.md）：S-c 走查口徑對應之 jsdom 可聚焦元素
 * 枚舉——原生互動元素（`a[href]`／`button`／`input`／`select`／
 * `textarea`／`summary`，比照 `spikes/s-c/tab-walk.mjs` 的
 * `CONTROL_TAGS` 加 `summary`）與顯式 `tabindex`（排除負值）依 DOM 序
 * 枚舉，扣除 `disabled`／`hidden` 屬性（含祖先鏈）／closed `<dialog>`
 * 子孫（原生語意：關閉的 dialog 不參與 Tab 序）。
 *
 * **口徑邊界（須明載，呼應 T3.5 施工要點第 4 點）**：jsdom 不套用外部
 * 樣式表（見本檔檔頭），故桌面態 `<summary id="catalog-collapse-summary">`
 * 的 CSS `display:none`（style.css「D8 行動版目錄收合」節，
 * `@media (min-width: 1100px) { summary { display: none } }`）在本層
 * **不生效**——summary 在 jsdom 下恆為原生可聚焦元素、計入下方枚舉序。
 * 真瀏覽器桌面態下 summary 實際被 CSS 隱藏、不佔真實 Tab 序，此差異屬
 * CSS 可見性層，依 PLAN §Verification「測試層歸屬」硬性規定歸 e2e，
 * 不在 jsdom 層修正——本節鎖的是「現行 DOM 結構序」而非「真瀏覽器渲染
 * 後序」，兩者本節故意不同，此為 TASKS「無假綠疑慮」口徑邊界本身。
 */
function isNativelyDisabled(el: Element): boolean {
  return 'disabled' in el && (el as unknown as { disabled?: boolean }).disabled === true
}

/** 祖先鏈（含自身）是否有 `hidden` 屬性，或落在未開啟的 `<dialog>` 內。 */
function isExcludedByAncestorVisibility(el: Element): boolean {
  let node: Element | null = el
  while (node !== null) {
    if (node.hasAttribute('hidden')) return true
    if (node.tagName === 'DIALOG' && !(node as HTMLDialogElement).open) return true
    node = node.parentElement
  }
  return false
}

/** 全頁可聚焦元素，依 DOM 序（等同瀏覽器 sequential focus navigation 序，本頁無正整數 tabindex）。 */
function enumerateFocusableStops(): Element[] {
  const candidates = Array.from(
    document.body.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]'),
  )
  return candidates.filter((el) => {
    const tabindexAttr = el.getAttribute('tabindex')
    if (tabindexAttr !== null && Number(tabindexAttr) < 0) return false
    if (isNativelyDisabled(el)) return false
    if (isExcludedByAncestorVisibility(el)) return false
    return true
  })
}

/**
 * S-c 基準（spikes/S-c-RESULT.md「三、Gate 判定」）：路徑 A（skip 路徑，
 * 含 Enter）兩 viewport（1400×1000／390×844）皆 6 擊，組成＝
 * `header` 3 站（back-link／深色模式切換／語言切換，PLAN §D1「非 Tab
 * 首站」）→ n=4「跳至設定」skip-link → n=5 Enter（原生 fragment
 * navigation）→ n=6 `#global-section` 內第一個可聚焦控件。此組成不依賴
 * 目錄／列區的內容量（skip 路徑不經過它們），故與真實頁預設開機態
 * 一致，無需校準。
 */
const SKIP_PATH_KEYSTROKE_COUNT = 6

/**
 * T3.5 回歸基準：「設定區起始停點序號」——自文件起始依 DOM 序枚舉可
 * 聚焦元素（口徑見 `enumerateFocusableStops`），`#global-section` 內
 * 第一個可聚焦控件的序號（1-indexed）。
 *
 * 與 S-c-RESULT.md 原始量測值（195，「路徑 B（對照，純 Tab 不用
 * skip）」，兩 viewport 皆同）的差額與原因——**以現行 DOM 實況為基準
 * 值，非放寬既有數字**：
 *   1. S-c 用的是獨立原型 `spikes/s-c/m1a.html`，量測時**種子啟用
 *      ≥8 段、30 目錄項全勾選、5 組列共 21 列（21×7＝147 個列控件）**
 *      （見 S-c-RESULT.md「一、副本可聚焦化清點表」）。本案改走真實
 *      `tools/statusline-builder/index.html` **開機預設態**
 *      （`localStorage` 清空、`config.ts` `defaultConfig()` 全部
 *      segment `enabled:false`——該函式文件明載「全停用，初始啟用集屬
 *      M3 UI 決策」）：`#segment-row-groups` 開機為空（0 列控件，落差
 *      主因）；目錄欄 30 個 checkbox 雖全未勾選，但無論勾選態皆為 Tab
 *      停點，量級與 S-c 略同、非落差主因。
 *   2. S-c 量測時 D8（目錄收合 `<details>`/`<summary>`，T3.3／T3.4）
 *      尚未實作，其枚舉不含 `<summary id="catalog-collapse-summary">`
 *      這一停點；本批 T3.3 落地後，jsdom 層依上方「口徑邊界」註解計入
 *      該 summary，使序號較「若無 summary」的等價值 +1。
 * 上述兩項皆為「S-c 量測當下與現行結構的既知差異」，非鬆綁——此數字
 * 一旦漂移即結構變動訊號，改動前須先對 spikes/S-c-RESULT.md／PLAN.md
 * 重議，不得直接調整本常數了事。
 */
const SETTINGS_SECTION_FIRST_STOP_ORDINAL = 50

describe('T3.5 Tab 序回歸基準（PLAN.md §Verification「Tab 序回歸基準」；spikes/S-c-RESULT.md 基準數字，見本檔上方常數與 enumerateFocusableStops 口徑註解）', () => {
  beforeAll(async () => {
    await boot()
  })

  it(`skip 路徑鍵擊數組成（S-c 基準 ${SKIP_PATH_KEYSTROKE_COUNT} 擊，含 Enter）：header 3 站皆早於 skip-nav，第 4 站為「跳至設定」連結、href 落 #global-section，落點內存在可聚焦控件（對映 S-c n=6 Tab 落點）`, () => {
    const stops = enumerateFocusableStops()

    // header 3 個可聚焦元素恆在 skip-nav 之前（PLAN §D1「非 Tab 首站
    // ——<header> 內恆有三個可聚焦元素在前，契約措辭須照此精確化」；
    // 對映 S-c n=1..3）。
    const headerStops = stops.slice(0, 3)
    expect(headerStops).toHaveLength(3)
    for (const el of headerStops) {
      expect(el.closest('header'), '前三站應皆落在 <header> 內').not.toBeNull()
    }

    // 第 4 站（S-c n=4）：「跳至設定」skip-link，排第一（PLAN §D4「排
    // 第一以降低鍵擊數」），href 落 #global-section。
    const skipToSettings = stops[3]
    expect(skipToSettings, '第 4 個可聚焦元素應存在').toBeDefined()
    expect(skipToSettings!.tagName).toBe('A')
    expect(skipToSettings!.classList.contains('skip-link')).toBe(true)
    expect(skipToSettings!.getAttribute('href')).toBe('#global-section')

    // S-c n=5 為 Enter（原生 fragment navigation，非 jsdom 可模擬的鍵盤
    // 事件——jsdom 無 layout 引擎，不落實此步驟本身）；n=6 落點須確實
    // 存在至少一個可聚焦後代，此為「Enter 後下一次 Tab 可抵達」的 DOM
    // 結構前提（S-c 已在真瀏覽器機械驗證此路徑生效，見該檔「四、
    // Fragment-navigation focus 行為判定」）。
    const target = document.getElementById('global-section')
    expect(target, '#global-section 應存在').not.toBeNull()
    const firstInsideTarget = stops.find((el) => target!.contains(el))
    expect(firstInsideTarget, '#global-section 內應存在至少一個可聚焦控件（S-c n=6 落點）').toBeDefined()

    // 鍵擊數組成＝3（header）+1（skip-link）+1（Enter）+1（落點 Tab）
    // ＝SKIP_PATH_KEYSTROKE_COUNT（6），與 S-c 兩 viewport 實測值一致
    // ——上方三段斷言逐項對映此組成的每一步，本行不再重複同一算式。
  })

  it('設定區起始停點序號：#global-section 內第一個可聚焦控件在 DOM 序枚舉中的序號（1-indexed）＝ 現行基準值（見上方常數與差額註解）', () => {
    const stops = enumerateFocusableStops()
    const target = document.getElementById('global-section')!
    const ordinal = stops.findIndex((el) => target.contains(el)) + 1
    expect(ordinal).toBeGreaterThan(0) // findIndex 找不到時為 0，先排除「根本沒找到」的偽陽性
    expect(ordinal).toBe(SETTINGS_SECTION_FIRST_STOP_ORDINAL)
  })
})
