/**
 * (internal design doc) 里程碑 2（T2.4）：入口頁 inline <script>
 * 的「外部事件即時同步」行為測試——直接讀 repo 根 index.html 原始碼、抽出
 * inline script body，以 `new Function` 在假 document/window/localStorage
 * 下執行，驗證其行為與 src/theme.ts 的 `initThemeSync` 對齊（各自獨立維護
 * ——見 index.html 該 <script> 上方 HTML 註解）。
 *
 * 不 import scripts/verify-dist-checks.mjs 的抽取工具：tsconfig.json 的
 * include 只有 `src`／`tools`（scripts/ 下這幾個檔案只在 tsconfig.scripts.json
 * 的 include 裡），從 src/ 下的測試檔 import 它會跨出 tsconfig.json 的
 * include 邊界（typecheck 會報錯）——因此本檔自寫最小的 <script> body 抽取
 * （入口頁只有單一 inline script、無屬性、無 HTML 註解干擾，比
 * verify-dist-checks.mjs 的通用版本單純得多，不需要它的 comment-strip／
 * 大小寫容忍等泛用邏輯）。
 *
 * `new Function(body)` 建出的函式在被呼叫時，函式體內對 `document`／
 * `window`／`localStorage` 這些自由變數的參照是透過 realm 的全域物件解析
 * （與一般 ES module 相同機制——src/theme.ts 也是靠這個機制讓
 * `vi.stubGlobal` 生效，見 theme.ts 檔頭「惰性存取」說明）。所以只要用
 * `vi.stubGlobal` 換掉 globalThis 上的這三個名字，`new Function` 建出的
 * 程式碼看到的就是假物件，不需要真的 jsdom。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY } from './theme.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 自寫最小抽取：入口頁目前只有一個無屬性的 inline `<script>`。 */
function extractInlineScriptBody(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) {
    throw new Error('index.html 找不到 inline <script> — 抽取邏輯或原始檔可能已變動，需一併檢查本測試')
  }
  return match[1]
}

// ── 與 src/theme.test.ts（T2.1）同構的假物件，供 new Function 執行的 inline
// script 存取。兩份測試各自獨立維護（一份測 module，一份測 inline vanilla
// script），故此處不 import theme.test.ts（測試檔互相 import 也不合慣例）。

class FakeElement {
  private attrs = new Map<string, string>()

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name)
  }
  addEventListener(_type: string, _listener: () => void): void {
    // button 的 click 監聽不在本檔驗證範圍（T2.2 module 版與既有
    // verify-dist-checks.test.ts 的白名單漂移案已覆蓋 click 邏輯本身）；
    // 本檔只驗證新增的 matchMedia／storage 同步，這裡只需存在避免
    // `new Function` 執行到 button.addEventListener('click', ...) 時噴
    // TypeError。
  }
}

class FakeMediaQueryList {
  matches: boolean
  private listeners: Array<(event: { matches: boolean }) => void> = []

  constructor(matches: boolean) {
    this.matches = matches
  }

  addEventListener(type: string, listener: (event: { matches: boolean }) => void): void {
    if (type === 'change') this.listeners.push(listener)
  }

  simulateChange(matches: boolean): void {
    this.matches = matches
    for (const listener of this.listeners) listener({ matches })
  }
}

type FakeStorageEvent = { key: string | null; newValue: string | null }

function createFakeWindow(matches: boolean): {
  matchMedia: (query: string) => MediaQueryList
  addEventListener: (type: string, listener: (event: FakeStorageEvent) => void) => void
  simulateOsChange: (matches: boolean) => void
  simulateStorage: (event: FakeStorageEvent) => void
} {
  const mql = new FakeMediaQueryList(matches)
  const storageListeners: Array<(event: FakeStorageEvent) => void> = []
  return {
    matchMedia: (_query: string) => mql as unknown as MediaQueryList,
    addEventListener: (type: string, listener: (event: FakeStorageEvent) => void) => {
      if (type === 'storage') storageListeners.push(listener)
    },
    simulateOsChange: (next: boolean) => mql.simulateChange(next),
    simulateStorage: (event: FakeStorageEvent) => {
      for (const listener of storageListeners) listener(event)
    },
  }
}

function createFakeStorage(initial: Record<string, string> = {}, options: { throwOnGet?: boolean } = {}): Storage {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => {
      if (options.throwOnGet) throw new Error('storage 被封鎖（模擬無痕模式）')
      return store.has(key) ? (store.get(key) as string) : null
    },
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

/** document.addEventListener('DOMContentLoaded', ...) 捕捉面＋querySelector 固定回傳假 button。 */
class FakeDocument {
  documentElement: FakeElement
  private button: FakeElement
  private domContentLoadedListeners: Array<() => void> = []

  constructor(root: FakeElement, button: FakeElement) {
    this.documentElement = root
    this.button = button
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'DOMContentLoaded') this.domContentLoadedListeners.push(listener)
  }

  querySelector(_selector: string): FakeElement {
    return this.button
  }

  /** 測試專用：手動觸發已捕捉的 DOMContentLoaded 監聽器（fake document 不會自己派送事件）。 */
  fireDomContentLoaded(): void {
    for (const listener of this.domContentLoadedListeners) listener()
  }
}

function loadInlineScriptBody(): string {
  const html = readFileSync(resolve(repoRoot, 'index.html'), 'utf-8')
  return extractInlineScriptBody(html)
}

/** 執行 index.html 的 inline script body，回傳 root／button／storage／window 供斷言與後續事件模擬。 */
function runInlineScript(
  options: {
    stored?: Record<string, string>
    storageThrows?: { onGet?: boolean }
    systemPrefersDark?: boolean
  } = {},
): {
  root: FakeElement
  button: FakeElement
  storage: Storage
  window: ReturnType<typeof createFakeWindow>
} {
  const storage = createFakeStorage(options.stored ?? {}, { throwOnGet: options.storageThrows?.onGet })
  vi.stubGlobal('localStorage', storage)
  const fakeWindow = createFakeWindow(options.systemPrefersDark ?? false)
  vi.stubGlobal('window', fakeWindow)

  const root = new FakeElement()
  const button = new FakeElement()
  const doc = new FakeDocument(root, button)
  vi.stubGlobal('document', doc)

  const body = loadInlineScriptBody()
  // sentinel（(internal design doc) Minority 6 採納，opus）：本檔自寫的
  // extractInlineScriptBody 只抓第一個 `<script>`、不剝除 HTML 註解——現況
  // 安全（index.html 該 <script> 上方的說明性註解已核無 `<script` 子字串），
  // 但日後若註解改成含字面 `<script>` 例示（如引用範例程式碼），抽取邏輯會
  // 誤抓到註解內的假標籤、靜默拿到錯誤內容而非真正的 inline script body。
  // 補這句防禦性斷言：body 必須含 THEME_STORAGE_KEY 字面值，確保抽出的
  // 確實是真正會執行的主題同步邏輯，而非誤抓的註解殘片。
  expect(body).toContain(THEME_STORAGE_KEY)
  // 刻意執行入口頁真實 inline script 原始碼字串本身（而非重新實作一份），
  // 讓本測試對 index.html 的實際內容有效，不會因重構漂移而悄悄失真。
  const run = new Function(body)
  run()
  doc.fireDomContentLoaded()

  return { root, button, storage, window: fakeWindow }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('index.html inline <script>：OS 偏好變更／其他分頁 storage 事件即時同步（等價 src/theme.ts initThemeSync）', () => {
  it('OS 系統偏好變更（matchMedia change）→ aria-pressed 翻轉', () => {
    const { button, window } = runInlineScript({ systemPrefersDark: false })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    window.simulateOsChange(true)

    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('他分頁 storage 設值 → data-theme 與 aria-pressed 同步套用新值', () => {
    const { root, button, window, storage } = runInlineScript({ systemPrefersDark: false })

    storage.setItem(THEME_STORAGE_KEY, 'dark')
    window.simulateStorage({ key: THEME_STORAGE_KEY, newValue: 'dark' })

    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('storage 清除（key===null，clear() 全清）→ 移除 data-theme，回到系統偏好', () => {
    const { root, button, window, storage } = runInlineScript({
      stored: { [THEME_STORAGE_KEY]: 'dark' },
      systemPrefersDark: false,
    })
    expect(root.getAttribute('data-theme')).toBe('dark') // FOUC bootstrap 上半段已套用

    storage.clear()
    window.simulateStorage({ key: null, newValue: null })

    expect(root.getAttribute('data-theme')).toBeNull()
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('storage 清除（key===THEME_STORAGE_KEY 且 newValue===null，removeItem() 單鍵清除）→ 移除 data-theme，回到系統偏好', () => {
    const { root, button, window, storage } = runInlineScript({
      stored: { [THEME_STORAGE_KEY]: 'dark' },
      systemPrefersDark: true,
    })

    storage.removeItem(THEME_STORAGE_KEY)
    window.simulateStorage({ key: THEME_STORAGE_KEY, newValue: null })

    expect(root.getAttribute('data-theme')).toBeNull()
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('無關 key 的 storage 事件 → 忽略，data-theme／aria-pressed 皆不變', () => {
    const { root, button, window } = runInlineScript({
      stored: { [THEME_STORAGE_KEY]: 'light' },
      systemPrefersDark: true,
    })
    const before = button.getAttribute('aria-pressed')

    window.simulateStorage({ key: 'some-other-app-key', newValue: 'whatever' })

    expect(root.getAttribute('data-theme')).toBe('light')
    expect(button.getAttribute('aria-pressed')).toBe(before)
  })

  it('storage 事件觸發時讀取拋錯 → 不冒出例外（回到系統偏好）', () => {
    const { root, button, window } = runInlineScript({ storageThrows: { onGet: true }, systemPrefersDark: true })

    expect(() => window.simulateStorage({ key: THEME_STORAGE_KEY, newValue: 'dark' })).not.toThrow()
    expect(root.getAttribute('data-theme')).toBeNull()
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})
