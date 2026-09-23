// @vitest-environment jsdom
/**
 * T3.4（(internal design doc) §D8「行動版目錄收合」；
 * TASKS.md T3.4；spikes/S-f-RESULT.md 11/11 實證）：main.ts
 * `wireCatalogCollapse()` 的 DOM 接線回歸網——六情境（收合／展開／持久化／
 * 桌面恆展開／跨斷點強制展開後持久化值不變／localStorage 擲錯
 * fail-open）。狀態讀寫與謂詞本身（`catalog-collapse.ts`，T3.1 產物）已有
 * 獨立單元測試 `catalog-collapse.test.ts`，本檔不重複驗其純函式行為，只驗
 * main.ts 把它接到真實 `<details>`/`<summary>` DOM 節點後的整合行為。
 *
 * 回歸網比照既有 `tutorial-band.dom.test.ts`／`layout-columns.dom.test.ts`
 * 的「先以 jsdom 剖析真實 index.html 取得 <body>、動態 import main.ts 觸發
 * 其 init()」全頁面整合測試形（見該二檔檔頭說明，不重複抄錄）。
 *
 * ── jsdom 無真 matchMedia（見 catalog-collapse.ts 檔頭「惰性存取」段落；
 * `catalog-collapse.test.ts` 已機械證實 jsdom 環境下 `matchMedia` 為未定義
 * 全域）——本檔比照 `src/theme.test.ts` 的 `FakeMediaQueryList` 手法自建
 * 一顆可控假物件，經 `vi.stubGlobal('matchMedia', …)` 覆寫
 * `globalThis.matchMedia`；main.ts／catalog-collapse.ts 皆參照裸全域識別字
 * `matchMedia`（非 `window.matchMedia`），`vi.stubGlobal` 寫入 `globalThis`
 * 即可讓兩者讀到同一顆假物件，同 `catalog-collapse.test.ts` 既有驗證手法
 * （唯該檔為非 jsdom 環境的純函式單元測試，本檔為 jsdom 全頁面整合測試，
 * stub 手法相同、環境不同）。
 *
 * ── 持久化讀值時序（S-f-RESULT.md「平台坑：<summary> 點擊→open 翻轉的
 * 實測時序證據」）：main.ts `scheduleCatalogCollapsePersist()` 以雙
 * `requestAnimationFrame` 延後讀值。本檔以 `vi.waitFor` 輪詢
 * localStorage 最終值，不假設精確幀數——jsdom 的 `<details>`/`<summary>`
 * 原生 toggle 行為經獨立診斷腳本證實**同步**翻轉 `.open`（比真實瀏覽器
 * 的非同步「element task」時序更快，但雙 rAF 讀到的最終值一致，見本檔
 * DONE report「Notes」段落之逐字證據），故等待策略只需覆蓋「rAF 何時
 * 觸發」本身的不確定性，不影響斷言正確性。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_COLLAPSE_BREAKPOINT_QUERY, CATALOG_COLLAPSE_KEY, CATALOG_COLLAPSE_SENTINEL } from './catalog-collapse.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const HTML_PATH = path.resolve(DIR, 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

// 檔級 testTimeout（比照 layout-columns.dom.test.ts／preview-band.dom.test.ts
// 等既有先例，同以 30_000 收斂）：本檔每案皆 `await boot()` 重跑 main.ts 全
// 依賴圖＋init()，部分案另含 `vi.waitFor` 輪詢等待雙 rAF 完成——全套件多檔
// 並行時排程延遲有機會把它推過 vitest 預設 5000ms，體制化避免環境負載雜訊
// 被誤判為紅燈（見 spikes/S-h-RESULT.md「隔離重跑判別」表同病史）。
vi.setConfig({ testTimeout: 30_000 })

/**
 * 可控假 `MediaQueryList`：`matches` 可變、`addEventListener('change', …)`
 * 捕捉監聽器、`simulateChange` 供測試模擬跨斷點（先更新 `matches` 再廣播
 * `change`，比照 `src/theme.test.ts` `FakeMediaQueryList` 同款設計）。
 */
class FakeMediaQueryList {
  matches: boolean
  readonly media: string
  private listeners: Array<(event: { matches: boolean }) => void> = []

  constructor(media: string, matches: boolean) {
    this.media = media
    this.matches = matches
  }

  addEventListener(type: string, listener: (event: { matches: boolean }) => void): void {
    if (type === 'change') this.listeners.push(listener)
  }

  removeEventListener(): void {
    // 本檔測試場景不需要移除監聽器，維持空實作滿足最小介面。
  }

  /** 測試專用：模擬跨斷點——先更新 matches 再廣播 change，讓監聽器讀到新值。 */
  simulateChange(matches: boolean): void {
    this.matches = matches
    for (const listener of this.listeners) listener({ matches })
  }
}

/**
 * 建一顆可控假 `matchMedia`：`CATALOG_COLLAPSE_BREAKPOINT_QUERY` 這個
 * query 回傳可由測試操縱的 `FakeMediaQueryList`（回傳值供測試直接呼叫
 * `simulateChange` 模擬跨斷點）；main.ts 亦會為 `theme.ts` 的
 * `(prefers-color-scheme: dark)` 呼叫 `matchMedia`——非本檔關注的 query 一律
 * 回傳恆 `matches=false` 的獨立假物件（逐 query 快取，不與斷點 query 共用
 * 同一顆實例），不影響本檔驗收面、也不讓 `theme.ts` 的既有 try/catch 外
 * 呼叫意外炸掉。
 */
function createFakeMatchMedia(initialMobile: boolean): {
  matchMedia: (query: string) => MediaQueryList
  breakpointMql: FakeMediaQueryList
} {
  const registry = new Map<string, FakeMediaQueryList>()
  const breakpointMql = new FakeMediaQueryList(CATALOG_COLLAPSE_BREAKPOINT_QUERY, initialMobile)
  registry.set(CATALOG_COLLAPSE_BREAKPOINT_QUERY, breakpointMql)
  const matchMedia = (query: string): MediaQueryList => {
    let mql = registry.get(query)
    if (mql === undefined) {
      mql = new FakeMediaQueryList(query, false)
      registry.set(query, mql)
    }
    return mql as unknown as MediaQueryList
  }
  return { matchMedia, breakpointMql }
}

/**
 * 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（同既有
 * dom.test 慣例）。`matchMediaImpl` 提供時經 `vi.stubGlobal` 覆寫，**必須**
 * 在 `import('./main.js')` 之前掛好——main.ts 模組頂層的 `init()`（或
 * `DOMContentLoaded` 監聽，視 `document.readyState` 而定）於 import 求值期間
 * 即可能同步執行，太晚 stub 會讀到未覆寫的（未定義）全域。
 *
 * MAGI code review 🟡-2：本檔只重灌 `<body>`，jsdom 的 `<html>` 自始不帶
 * `js-init-pending`——若不補掛，下方兩處「init 後 `documentElement` 無該
 * class」的斷言就恆真（實作即使不移除也綠）。故 import 前先還原 index.html
 * 的出貨態 `<html class="js-init-pending">`（見該檔 `<html>` 節點註解），
 * 讓斷言真正行使 main.ts 的移除路徑；掛載時機與 stub 同樣**必須**早於
 * import（init() 於 import 求值期間即可能同步跑完並移除它）。
 */
async function boot(matchMediaImpl?: (query: string) => MediaQueryList): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  document.documentElement.classList.add('js-init-pending')
  if (matchMediaImpl !== undefined) vi.stubGlobal('matchMedia', matchMediaImpl)
  vi.resetModules()
  await import('./main.js')
}

/**
 * 同 boot()，但**不清 localStorage**——供「持久化」「桌面恆展開」等情境
 * 模擬「同一分頁重新整理」或「先種偏好值再開機」，比照
 * `tutorial-band.dom.test.ts` 既有 `reboot()` 慣例（呼叫端須自行決定是否
 * 先 `localStorage.clear()`／`setItem` 再呼叫本函式）。「重新整理」同樣自
 * 出貨態起算，故 `js-init-pending` 一併補掛（理由見 boot() 文件末段）。
 */
async function reboot(matchMediaImpl?: (query: string) => MediaQueryList): Promise<void> {
  document.body.innerHTML = BODY_HTML
  document.documentElement.classList.add('js-init-pending')
  if (matchMediaImpl !== undefined) vi.stubGlobal('matchMedia', matchMediaImpl)
  vi.resetModules()
  await import('./main.js')
}

function detailsEl(): HTMLDetailsElement {
  return document.getElementById('catalog-collapse-details') as HTMLDetailsElement
}

function summaryEl(): HTMLElement {
  return document.getElementById('catalog-collapse-summary') as HTMLElement
}

/**
 * 沖刷兩幀 `requestAnimationFrame`——深度刻意對齊 main.ts
 * `scheduleCatalogCollapsePersist()` 的雙 rAF 延遲（見該函式文件）。
 *
 * MAGI code review 🟡-10：情境 5 的負向斷言（跨斷點強制展開後 localStorage
 * 值不變）若緊接 `simulateChange()` 同步斷言，假想敵——日後誤把持久化掛到
 * `<details>` 的 `toggle` 事件、走雙 rAF 延遲寫入——的錯誤寫入會落在斷言
 * **之後**，斷言接不住。故該處兩次跨斷點各沖刷一次，把「延遲寫入」的窗口
 * 拉進斷言範圍內。（jsdom 於 vitest 預設 `pretendToBeVisual` 下具備 rAF，
 * main.ts 的雙 rAF 持久化本檔情境 1–3 已實證可運作。）
 */
async function flushDoubleRaf(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('T3.3 靜態骨架（原始文字比對，主 JS 尚未執行前的出貨態）', () => {
  it('index.html 原始文字：#catalog-collapse-details 靜態帶 open 屬性（HTML 出貨態展開，PLAN §D8「首繪方向」fail-open）', () => {
    expect(RAW_HTML).toMatch(/<details class="segment-lists-details" id="catalog-collapse-details" open>/)
  })

  it('index.html 原始文字：<html> 出貨態帶 js-init-pending class（回訪防閃動開關）', () => {
    expect(RAW_HTML).toMatch(/<html lang="zh-Hant" class="js-init-pending">/)
  })

  it('index.html 原始文字：<noscript> 逃生門存在，且與防閃動選擇器/media query 對稱', () => {
    expect(RAW_HTML).toMatch(
      /<noscript>\s*<style>\s*@media \(max-width: 1099\.98px\) \{\s*html\.js-init-pending #catalog-section \.segment-lists \{\s*max-height: none;\s*overflow: visible;/,
    )
  })
})

describe('六情境 1／2／3：收合／展開／持久化（<1100px，機制 (a) summary-only）', () => {
  it('情境 1（收合）：<1100px 下點擊 summary → details.open 變 false，且 localStorage 寫入 SENTINEL', async () => {
    const { matchMedia } = createFakeMatchMedia(true)
    await boot(matchMedia)
    expect(detailsEl().open).toBe(true) // HTML 出貨態 open；行動版初始無 key → 展開
    expect(document.documentElement.classList.contains('js-init-pending')).toBe(false) // init 已移除暫抑標記

    summaryEl().click()

    await vi.waitFor(() => {
      expect(localStorage.getItem(CATALOG_COLLAPSE_KEY)).toBe(CATALOG_COLLAPSE_SENTINEL)
    })
    expect(detailsEl().open).toBe(false)
  })

  it('情境 2（展開）：已收合的回訪者（key=SENTINEL）點擊 summary 展開 → details.open 變 true，且 key 被清除', async () => {
    localStorage.clear()
    localStorage.setItem(CATALOG_COLLAPSE_KEY, CATALOG_COLLAPSE_SENTINEL) // 種子：模擬回訪者已收合偏好
    const { matchMedia } = createFakeMatchMedia(true)
    await reboot(matchMedia)
    expect(detailsEl().open).toBe(false) // 初始依偏好收合（謂詞：<1100px 且 key===SENTINEL）

    summaryEl().click()

    await vi.waitFor(() => {
      expect(localStorage.getItem(CATALOG_COLLAPSE_KEY)).toBeNull()
    })
    expect(detailsEl().open).toBe(true)
  })

  it('情境 3（持久化）：<1100px 收合 → 重載（reboot，不清 key）→ 仍收合，且 localStorage 值不變', async () => {
    const { matchMedia } = createFakeMatchMedia(true)
    await boot(matchMedia)

    summaryEl().click()
    await vi.waitFor(() => {
      expect(localStorage.getItem(CATALOG_COLLAPSE_KEY)).toBe(CATALOG_COLLAPSE_SENTINEL)
    })

    await reboot(matchMedia)

    expect(detailsEl().open).toBe(false)
    expect(localStorage.getItem(CATALOG_COLLAPSE_KEY)).toBe(CATALOG_COLLAPSE_SENTINEL)
  })
})

describe('六情境 4：桌面恆展開（≥1100px，即使 localStorage 存有收合偏好值也恆展開）', () => {
  it('桌面 viewport 下，即使 localStorage 已存 SENTINEL，details.open 仍為 true（單一謂詞非行動版恆 false）', async () => {
    localStorage.clear()
    localStorage.setItem(CATALOG_COLLAPSE_KEY, CATALOG_COLLAPSE_SENTINEL)
    const { matchMedia } = createFakeMatchMedia(false) // 桌面：斷點 query 恆 matches=false
    await reboot(matchMedia)

    expect(detailsEl().open).toBe(true)
    // 桌面態不清除既有偏好——留給日後切回行動版時恢復用（見情境 5）。
    expect(localStorage.getItem(CATALOG_COLLAPSE_KEY)).toBe(CATALOG_COLLAPSE_SENTINEL)
  })
})

describe('六情境 5：跨斷點強制展開後持久化值不變', () => {
  it('行動版收合 → 切至桌面（強制展開，偏好不清）→ 切回行動版（恢復收合，偏好仍不變）', async () => {
    const { matchMedia, breakpointMql } = createFakeMatchMedia(true)
    await boot(matchMedia)

    summaryEl().click()
    await vi.waitFor(() => {
      expect(localStorage.getItem(CATALOG_COLLAPSE_KEY)).toBe(CATALOG_COLLAPSE_SENTINEL)
    })
    expect(detailsEl().open).toBe(false)

    // 切至桌面：matchMedia change → wireCatalogBreakpointForcing 的 apply()
    // 程式化把 open 設回 true。機制 (a) 下完全不監聽 toggle 事件，此程式化
    // 寫入天生不會被誤判為使用者互動而觸發持久化——localStorage 應維持不變。
    breakpointMql.simulateChange(false)
    await flushDoubleRaf() // 🟡-10：讓「誤走雙 rAF 延遲持久化」的錯誤寫入落在斷言之前（見該 helper 文件）。
    expect(detailsEl().open).toBe(true)
    expect(localStorage.getItem(CATALOG_COLLAPSE_KEY)).toBe(CATALOG_COLLAPSE_SENTINEL)

    // 切回行動版：apply() 依目前持久化偏好重新求值——偏好仍是 SENTINEL，
    // 故正確恢復收合，且過程未動 localStorage。
    breakpointMql.simulateChange(true)
    await flushDoubleRaf() // 同上：本次方向是「恢復收合」，誤寫入會是 clear（值變 null）。
    expect(detailsEl().open).toBe(false)
    expect(localStorage.getItem(CATALOG_COLLAPSE_KEY)).toBe(CATALOG_COLLAPSE_SENTINEL)
  })
})

describe('六情境 6：localStorage 擲錯 fail-open', () => {
  it('localStorage.getItem 擲錯（如無痕模式封鎖）→ 初始態展開，且 init 不炸（fail-open）', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage 被封鎖（模擬無痕模式）')
    })
    const { matchMedia } = createFakeMatchMedia(true)

    await expect(boot(matchMedia)).resolves.toBeUndefined()

    expect(detailsEl().open).toBe(true)
    // js-init-pending 的移除是 applyInitialCatalogCollapseState() 的最後一步、
    // 不受 isCatalogCollapsed() 內部 try/catch 影響——fail-open 不代表暫抑
    // 標記卡住不移除。
    expect(document.documentElement.classList.contains('js-init-pending')).toBe(false)
  })

  it('localStorage.getItem 擲錯，收合後點擊 summary 仍可正常運作（setItem 未被 mock，非本情境擲錯對象）', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage 被封鎖（模擬無痕模式）')
    })
    const { matchMedia } = createFakeMatchMedia(true)
    await boot(matchMedia)
    expect(detailsEl().open).toBe(true) // fail-open：擲錯視同無收合偏好 → 展開

    // 點擊仍可運作：scheduleCatalogCollapsePersist 讀 details.open（DOM 屬性，
    // 非 localStorage）決定呼叫 set／clear；本案 getItem 擲錯不影響這條路徑
    // 本身不炸例外。
    expect(() => summaryEl().click()).not.toThrow()
    expect(detailsEl().open).toBe(false)
  })
})
