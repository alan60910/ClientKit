/**
 * T4.2 單元測試（(internal design doc) §D4）。
 *
 * 本專案 vitest 無 jsdom：`document`／`localStorage`／`window` 一律以
 * `vi.stubGlobal` 換成陽春假物件，驗證 theme.ts 對這些全域的「惰性存取」
 * 設計（模組頂層不碰任何全域，只在函式內部參照）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  getEffectiveTheme,
  getStoredTheme,
  initThemeSync,
  initThemeToggle,
  THEME_STORAGE_KEY,
  toggleTheme,
  type Theme,
} from './theme.js'

// ── 假 localStorage：Map 後端，getItem/setItem 皆可選擇性拋錯以模擬無痕模式 ──
function createFakeStorage(
  initial: Record<string, string> = {},
  options: { throwOnGet?: boolean; throwOnSet?: boolean } = {},
): Storage {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => {
      if (options.throwOnGet) throw new Error('storage 被封鎖（模擬無痕模式）')
      return store.has(key) ? (store.get(key) as string) : null
    },
    setItem: (key: string, value: string) => {
      if (options.throwOnSet) throw new Error('storage 被封鎖（模擬無痕模式）')
      store.set(key, value)
    },
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

// ── 假 MediaQueryList：可變 matches，addEventListener 捕捉 change 監聽器
// （T2.1：模擬 OS 主題切換即時通知——真實 MediaQueryList 的 matches 在 OS
// 偏好改變時就地更新，同一顆 instance 之後每次讀 matches 都拿到新值；下方
// createFakeWindow 對每次 matchMedia() 呼叫都回傳同一顆 instance，重現這個
// 特性，讓測試能驗證監聽器讀到的是「新」值而非舊快照）──
class FakeMediaQueryList {
  matches: boolean
  private listeners: Array<(event: { matches: boolean }) => void> = []

  constructor(matches: boolean) {
    this.matches = matches
  }

  addEventListener(type: string, listener: (event: { matches: boolean }) => void): void {
    if (type === 'change') this.listeners.push(listener)
  }

  /** 測試專用：模擬 OS 主題切換——先更新 matches 再廣播 change，讓監聽器讀到新值。 */
  simulateChange(matches: boolean): void {
    this.matches = matches
    for (const listener of this.listeners) listener({ matches })
  }
}

/** storage 事件 payload：只帶 theme.ts 會讀的兩個欄位（key／newValue）。 */
type FakeStorageEvent = { key: string | null; newValue: string | null }

// ── 假 window：matchMedia（每次呼叫回傳同一顆可變 FakeMediaQueryList，見
// 上方類別註解）＋ addEventListener('storage', ...) 捕捉面（T2.1 升級：原本
// 只回傳固定 matches 值的陽春物件、無 addEventListener）。額外掛
// simulateOsChange／simulateStorage 兩個測試專用方法，供測試直接觸發已捕捉
// 的監聽器（結構化 payload：matches／key／newValue）──
function createFakeWindow(matches: boolean): Window &
  typeof globalThis & {
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
  } as unknown as Window &
    typeof globalThis & {
      simulateOsChange: (matches: boolean) => void
      simulateStorage: (event: FakeStorageEvent) => void
    }
}

// ── 假 DOM element：涵蓋 theme.ts 需要的最小介面 ──
class FakeElement {
  private attrs = new Map<string, string>()
  private listeners = new Map<string, Array<() => void>>()

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name)
  }
  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

function createFakeDocument(root: FakeElement): Document {
  return { documentElement: root } as unknown as Document
}

/**
 * 一次備妥 storage/window/document 三個全域 stub 的便利函式。回傳的
 * `storage`／`window` 是實際被 `vi.stubGlobal` 換上去的同一顆 instance
 * （非另外複製），供測試直接呼叫 `storage.setItem(...)`／
 * `window.simulateOsChange(...)`／`window.simulateStorage(...)` 模擬「其他
 * 分頁寫入」或「OS 偏好改變」，而不必依賴 bare 全域識別字。
 */
function stubEnvironment(options: {
  stored?: Record<string, string>
  storageThrows?: { onGet?: boolean; onSet?: boolean }
  systemPrefersDark?: boolean
} = {}): { root: FakeElement; storage: Storage; window: ReturnType<typeof createFakeWindow> } {
  const storage = createFakeStorage(options.stored ?? {}, {
    throwOnGet: options.storageThrows?.onGet,
    throwOnSet: options.storageThrows?.onSet,
  })
  vi.stubGlobal('localStorage', storage)
  const fakeWindow = createFakeWindow(options.systemPrefersDark ?? false)
  vi.stubGlobal('window', fakeWindow)

  const root = new FakeElement()
  vi.stubGlobal('document', createFakeDocument(root))

  return { root, storage, window: fakeWindow }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getStoredTheme / getEffectiveTheme — 優先次序：localStorage ＞ 系統 ＞ 淺色', () => {
  it('localStorage 有 dark → 有效主題 dark，即使系統偏好淺色', () => {
    stubEnvironment({ stored: { [THEME_STORAGE_KEY]: 'dark' }, systemPrefersDark: false })
    expect(getStoredTheme()).toBe('dark')
    expect(getEffectiveTheme()).toBe('dark')
  })

  it('localStorage 有 light → 有效主題 light，即使系統偏好深色', () => {
    stubEnvironment({ stored: { [THEME_STORAGE_KEY]: 'light' }, systemPrefersDark: true })
    expect(getStoredTheme()).toBe('light')
    expect(getEffectiveTheme()).toBe('light')
  })

  it('localStorage 未設定、系統偏好深色 → 有效主題 dark', () => {
    stubEnvironment({ systemPrefersDark: true })
    expect(getStoredTheme()).toBeNull()
    expect(getEffectiveTheme()).toBe('dark')
  })

  it('localStorage 未設定、系統偏好淺色 → 有效主題 light（淺色預設）', () => {
    stubEnvironment({ systemPrefersDark: false })
    expect(getStoredTheme()).toBeNull()
    expect(getEffectiveTheme()).toBe('light')
  })

  it('localStorage 存有非法值（損壞存檔）→ 視為未設定，落到系統偏好', () => {
    stubEnvironment({ stored: { [THEME_STORAGE_KEY]: 'blue' }, systemPrefersDark: true })
    expect(getStoredTheme()).toBeNull()
    expect(getEffectiveTheme()).toBe('dark')
  })
})

describe('storage 例外韌性（無痕模式等環境 getItem/setItem 拋錯）', () => {
  it('getItem 拋錯 → getStoredTheme 回傳 null（不冒出例外）', () => {
    stubEnvironment({ storageThrows: { onGet: true }, systemPrefersDark: true })
    expect(getStoredTheme()).toBeNull()
    expect(getEffectiveTheme()).toBe('dark')
  })

  it('setItem 拋錯 → toggleTheme 仍回傳並套用新主題（persist 失敗不阻斷本次切換）', () => {
    const { root } = stubEnvironment({ systemPrefersDark: false, storageThrows: { onSet: true } })
    const result = toggleTheme()
    expect(result).toBe('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
  })
})

describe('applyTheme — 設定／移除 data-theme，冪等', () => {
  it('theme 為具體值 → 設定 data-theme', () => {
    const { root } = stubEnvironment()
    applyTheme('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
  })

  it('theme 為 null → 移除 data-theme', () => {
    const { root } = stubEnvironment()
    applyTheme('dark')
    applyTheme(null)
    expect(root.getAttribute('data-theme')).toBeNull()
  })

  it('重複套用同一值為冪等操作（多次呼叫結果相同）', () => {
    const { root } = stubEnvironment()
    applyTheme('light')
    applyTheme('light')
    applyTheme('light')
    expect(root.getAttribute('data-theme')).toBe('light')
  })
})

describe('toggleTheme — 取反並持久化', () => {
  it('light → dark，寫入 localStorage 且套用到 DOM', () => {
    const { root } = stubEnvironment({ systemPrefersDark: false })
    const next = toggleTheme()
    expect(next).toBe('dark')
    expect(getStoredTheme()).toBe('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
  })

  it('再次呼叫取反回 light（第二次切換）', () => {
    stubEnvironment({ systemPrefersDark: false })
    toggleTheme()
    const next = toggleTheme()
    expect(next).toBe('light')
    expect(getStoredTheme()).toBe('light')
  })
})

describe('initThemeToggle — 接鈕：click 取反＋aria-pressed／可及名稱同步', () => {
  it('初始化時 aria-pressed 反映目前有效主題（深色 → true）', () => {
    stubEnvironment({ systemPrefersDark: true })
    const button = new FakeElement()
    initThemeToggle(button as unknown as HTMLElement)
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('初始化時 aria-pressed 反映目前有效主題（淺色 → false）', () => {
    stubEnvironment({ systemPrefersDark: false })
    const button = new FakeElement()
    initThemeToggle(button as unknown as HTMLElement)
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('初始化即設定固定的可及名稱', () => {
    stubEnvironment()
    const button = new FakeElement()
    initThemeToggle(button as unknown as HTMLElement)
    expect(button.getAttribute('aria-label')).toBe('深色模式切換')
  })

  it('click 一次 → 取反主題、更新 aria-pressed、寫入 localStorage、套用到 DOM', () => {
    const { root } = stubEnvironment({ systemPrefersDark: false })
    const button = new FakeElement()
    initThemeToggle(button as unknown as HTMLElement)
    expect(button.getAttribute('aria-pressed')).toBe('false')

    button.dispatch('click')

    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(getStoredTheme()).toBe('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
  })

  it('click 兩次 → 回到初始主題（雙態往返）', () => {
    stubEnvironment({ systemPrefersDark: false })
    const button = new FakeElement()
    initThemeToggle(button as unknown as HTMLElement)

    button.dispatch('click')
    button.dispatch('click')

    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(getStoredTheme()).toBe('light')
  })
})

describe('initThemeSync — OS 偏好變更／其他分頁 storage 事件即時同步 toggle 鈕', () => {
  it('OS 系統偏好變更（matchMedia change）→ aria-pressed 翻轉，讀到的是「新」matches 值（非舊快照）', () => {
    const { window } = stubEnvironment({ systemPrefersDark: false })
    const button = new FakeElement()
    // 比照 T2.3 實際接線順序：initThemeToggle 先完成初始同步，initThemeSync
    // 才接上後續事件監聽（本函式本身不做初始同步）。
    initThemeToggle(button as unknown as HTMLElement)
    initThemeSync(button as unknown as HTMLElement)
    expect(button.getAttribute('aria-pressed')).toBe('false')

    window.simulateOsChange(true)

    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('OS 系統偏好變更但使用者已手動切換過（localStorage 有值）→ toggle 鈕不受 OS 值影響（優先次序不變）', () => {
    const { window } = stubEnvironment({ stored: { [THEME_STORAGE_KEY]: 'light' }, systemPrefersDark: false })
    const button = new FakeElement()
    initThemeToggle(button as unknown as HTMLElement)
    initThemeSync(button as unknown as HTMLElement)
    expect(button.getAttribute('aria-pressed')).toBe('false')

    window.simulateOsChange(true)

    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('matchMedia 完全不可用（如 Safari <14 缺 addEventListener）→ matchMedia 段吞錯不冒例外，storage 段仍獨立掛載並生效（兩段 try/catch 互不影響）', () => {
    // (internal design doc) Minority 3（sonnet）修法：舊寫法假 window 連
    // `addEventListener` 都沒有，兩段（matchMedia／storage）同時失敗，無法
    // 區分「獨立 try/catch」與「合併 try/catch」兩種寫法，也不貼近 Safari
    // <14 實況（window.addEventListener 本身正常、僅 MQL 缺席）。改為：
    // window.addEventListener 保留可運作的 storage 捕捉面（比照
    // stubEnvironment 假 window 的實作），僅 `matchMedia()` 回傳的
    // MediaQueryList 缺 `addEventListener`（只有已棄用的 addListener）——
    // 呼叫 `matchMedia(...).addEventListener('change', ...)` 直接拋
    // TypeError，須被第一段 try/catch 吞下；第二段 storage 監聽須完全不受
    // 影響地成功掛載＋生效，才能證明兩段 try/catch 真的各自獨立（若程式碼
    // 誤改為合併成單一 try/catch，第一段的拋錯會連帶讓第二段的
    // `window.addEventListener('storage', ...)` 也掛不上，storageListeners
    // 長度斷言與後續同步斷言即翻紅）。
    const storage = createFakeStorage({ [THEME_STORAGE_KEY]: 'light' })
    vi.stubGlobal('localStorage', storage)
    const storageListeners: Array<(event: { key: string | null; newValue: string | null }) => void> = []
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }) as unknown as MediaQueryList, // 無 addEventListener
      addEventListener: (
        type: string,
        listener: (event: { key: string | null; newValue: string | null }) => void,
      ) => {
        if (type === 'storage') storageListeners.push(listener)
      },
    } as unknown as Window & typeof globalThis)
    const root = new FakeElement()
    vi.stubGlobal('document', createFakeDocument(root))
    const button = new FakeElement()

    expect(() => initThemeSync(button as unknown as HTMLElement)).not.toThrow()

    // storage 監聽確實成功掛載（非隨 matchMedia 段一起被吞掉、掛不上）。
    expect(storageListeners).toHaveLength(1)

    // 模擬其他分頁寫入 localStorage 後觸發一次 storage 事件（handler 不信任
    // event 自帶 newValue、重讀 getStoredTheme()，故須先真的寫入 storage）。
    storage.setItem(THEME_STORAGE_KEY, 'dark')
    for (const listener of storageListeners) listener({ key: THEME_STORAGE_KEY, newValue: 'dark' })

    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('他分頁 storage 設值 → data-theme 與 aria-pressed 同步套用新值', () => {
    const { root, window, storage } = stubEnvironment({ systemPrefersDark: false })
    const button = new FakeElement()
    initThemeToggle(button as unknown as HTMLElement)
    initThemeSync(button as unknown as HTMLElement)
    expect(button.getAttribute('aria-pressed')).toBe('false')

    storage.setItem(THEME_STORAGE_KEY, 'dark')
    window.simulateStorage({ key: THEME_STORAGE_KEY, newValue: 'dark' })

    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('storage 清除（key===null，clear() 全清）→ 移除 data-theme，回到系統偏好', () => {
    const { root, window, storage } = stubEnvironment({
      stored: { [THEME_STORAGE_KEY]: 'dark' },
      systemPrefersDark: false,
    })
    root.setAttribute('data-theme', 'dark') // 模擬先前 inline bootstrap 已套用過
    const button = new FakeElement()
    initThemeSync(button as unknown as HTMLElement)

    storage.clear()
    window.simulateStorage({ key: null, newValue: null })

    expect(root.getAttribute('data-theme')).toBeNull()
    expect(button.getAttribute('aria-pressed')).toBe('false') // 系統偏好淺色
  })

  it('storage 清除（key===THEME_STORAGE_KEY 且 newValue===null，removeItem() 單鍵清除）→ 移除 data-theme，回到系統偏好', () => {
    const { root, window, storage } = stubEnvironment({
      stored: { [THEME_STORAGE_KEY]: 'dark' },
      systemPrefersDark: true,
    })
    root.setAttribute('data-theme', 'dark')
    const button = new FakeElement()
    initThemeSync(button as unknown as HTMLElement)

    storage.removeItem(THEME_STORAGE_KEY)
    window.simulateStorage({ key: THEME_STORAGE_KEY, newValue: null })

    expect(root.getAttribute('data-theme')).toBeNull()
    expect(button.getAttribute('aria-pressed')).toBe('true') // 系統偏好深色，跟隨系統
  })

  it('無關 key 的 storage 事件 → 忽略，data-theme／aria-pressed 皆不變', () => {
    const { root, window } = stubEnvironment({
      stored: { [THEME_STORAGE_KEY]: 'light' },
      systemPrefersDark: true,
    })
    root.setAttribute('data-theme', 'light')
    const button = new FakeElement()
    initThemeToggle(button as unknown as HTMLElement)
    initThemeSync(button as unknown as HTMLElement)
    const before = button.getAttribute('aria-pressed')
    expect(before).toBe('false')

    window.simulateStorage({ key: 'some-other-app-key', newValue: 'whatever' })

    expect(root.getAttribute('data-theme')).toBe('light')
    expect(button.getAttribute('aria-pressed')).toBe(before)
  })

  it('storage 事件觸發時讀取拋錯 → 不冒出例外（getStoredTheme 內部已吞錯，視為未設定回系統偏好）', () => {
    const { root, window } = stubEnvironment({ storageThrows: { onGet: true }, systemPrefersDark: true })
    const button = new FakeElement()
    initThemeSync(button as unknown as HTMLElement)

    expect(() => window.simulateStorage({ key: THEME_STORAGE_KEY, newValue: 'dark' })).not.toThrow()
    expect(root.getAttribute('data-theme')).toBeNull()
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})

// 型別煙霧測試：Theme 只允許這兩個字面值（編譯期檢查，執行期無斷言）。
const _typeCheck: Theme[] = ['dark', 'light']
void _typeCheck
