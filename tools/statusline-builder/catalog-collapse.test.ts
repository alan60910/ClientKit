/**
 * T3.1 單元測試（(internal design doc) §D8；TASKS.md
 * T3.1）：行動版目錄收合狀態機——常數字面值鎖定（防漂移，T3.4 DOM 接線
 * 與未來 e2e seed 步驟將引用同源）＋單一謂詞（斷點雙態＋fail-open 三譜）
 * ／持久化寫入（set／clear）的純函式行為。
 *
 * 本專案 vitest 無 jsdom 預設環境（同 `tutorial-band.test.ts`／
 * `src/theme.test.ts` 慣例）：`catalog-collapse.ts` 模組頂層不碰
 * `localStorage`／`matchMedia`，以 `vi.stubGlobal` 換陽春假物件（可選擇性
 * 拋錯模擬無痕模式／`matchMedia` 不可用），驗證「惰性存取」設計＋
 * try/catch fail-open 行為，不需要 jsdom。互動整合面（`<summary>`
 * click／keydown DOM 接線、跨斷點強制展開／恢復）屬 T3.4，併入該任務的
 * `.dom.test.ts`。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_COLLAPSE_BREAKPOINT_QUERY,
  CATALOG_COLLAPSE_KEY,
  CATALOG_COLLAPSE_SENTINEL,
  clearCatalogCollapsed,
  isCatalogCollapsed,
  setCatalogCollapsed,
} from './catalog-collapse.js'

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

/** 假 matchMedia：固定回傳同一 matches 值，可選擇性讓呼叫本身拋錯。 */
function createFakeMatchMedia(matches: boolean, options: { throwOnCall?: boolean } = {}): typeof matchMedia {
  return ((query: string) => {
    if (options.throwOnCall) throw new Error('matchMedia 不可用')
    return { matches, media: query } as MediaQueryList
  }) as typeof matchMedia
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('常數字面值（防漂移；T3.4 DOM 接線與未來 e2e seed 步驟同源引用）', () => {
  // sprint 17 M1（PLAN §D4「7 把 localStorage key」列）：字面釘值集中到
  // `src/storage-keys-pin.test.ts`（單一出處，防分散字面斷言各自漂移）；
  // 本檔只驗匯入常數的 `<brand>-<scope>-<name>` 形狀，其餘案一律經常數
  // 存取 storage。
  it('CATALOG_COLLAPSE_KEY 符合 <brand>-<scope>-<name> 慣例形狀（字面釘值見 storage-keys-pin.test.ts）', () => {
    expect(CATALOG_COLLAPSE_KEY).toMatch(/^[a-z]+-statusline-builder-catalog-collapsed$/)
  })

  it('CATALOG_COLLAPSE_SENTINEL 鎖定為 "1"', () => {
    expect(CATALOG_COLLAPSE_SENTINEL).toBe('1')
  })

  it('CATALOG_COLLAPSE_BREAKPOINT_QUERY 鎖定為與 style.css 桌面斷點互補的字面值', () => {
    expect(CATALOG_COLLAPSE_BREAKPOINT_QUERY).toBe('(max-width: 1099.98px)')
  })
})

describe('isCatalogCollapsed — 單一謂詞：收合 ⟺ getItem(KEY)==="1" 且 <1100px', () => {
  it('斷點雙態（1）：<1100px 且讀值為 SENTINEL → 收合', () => {
    vi.stubGlobal('matchMedia', createFakeMatchMedia(true))
    vi.stubGlobal('localStorage', createFakeStorage({ [CATALOG_COLLAPSE_KEY]: CATALOG_COLLAPSE_SENTINEL }))
    expect(isCatalogCollapsed()).toBe(true)
  })

  it('斷點雙態（2）：≥1100px 即使讀值為 SENTINEL 仍恆展開（桌面態不看 localStorage 結果）', () => {
    vi.stubGlobal('matchMedia', createFakeMatchMedia(false))
    vi.stubGlobal('localStorage', createFakeStorage({ [CATALOG_COLLAPSE_KEY]: CATALOG_COLLAPSE_SENTINEL }))
    expect(isCatalogCollapsed()).toBe(false)
  })

  it('fail-open（1）：<1100px 但 key 缺失（getItem 回傳 null）→ 展開', () => {
    vi.stubGlobal('matchMedia', createFakeMatchMedia(true))
    vi.stubGlobal('localStorage', createFakeStorage())
    expect(isCatalogCollapsed()).toBe(false)
  })

  it('fail-open（2）：<1100px 但 getItem 擲錯（無痕模式）→ 展開，且不冒出例外', () => {
    vi.stubGlobal('matchMedia', createFakeMatchMedia(true))
    vi.stubGlobal('localStorage', createFakeStorage({}, { throwOnGet: true }))
    expect(() => isCatalogCollapsed()).not.toThrow()
    expect(isCatalogCollapsed()).toBe(false)
  })

  it.each(['true', '0', ''])('fail-open（3）：<1100px 但讀值為怪值（%j，非 SENTINEL）→ 展開', (weird) => {
    vi.stubGlobal('matchMedia', createFakeMatchMedia(true))
    vi.stubGlobal('localStorage', createFakeStorage({ [CATALOG_COLLAPSE_KEY]: weird }))
    expect(isCatalogCollapsed()).toBe(false)
  })

  it('matchMedia 呼叫本身擲錯 → 視為桌面 → 展開，且不冒出例外（fail-open 涵蓋斷點判定本身）', () => {
    vi.stubGlobal('matchMedia', createFakeMatchMedia(true, { throwOnCall: true }))
    vi.stubGlobal('localStorage', createFakeStorage({ [CATALOG_COLLAPSE_KEY]: CATALOG_COLLAPSE_SENTINEL }))
    expect(() => isCatalogCollapsed()).not.toThrow()
    expect(isCatalogCollapsed()).toBe(false)
  })

  it('matchMedia 全域未定義（極舊瀏覽器／測試環境未 stub）→ 視為桌面 → 展開', () => {
    // 刻意不 stub matchMedia：本專案 vitest 無 jsdom，未 stub 時 matchMedia
    // 本身即為未定義全域，模組內 try/catch 須接住這個 ReferenceError。
    vi.stubGlobal('localStorage', createFakeStorage({ [CATALOG_COLLAPSE_KEY]: CATALOG_COLLAPSE_SENTINEL }))
    expect(() => isCatalogCollapsed()).not.toThrow()
    expect(isCatalogCollapsed()).toBe(false)
  })
})

describe('setCatalogCollapsed / clearCatalogCollapsed — best-effort 持久化寫入（同 toggleTheme() 慣例）', () => {
  it('setCatalogCollapsed 寫入成功 → key 存為 SENTINEL', () => {
    const storage = createFakeStorage()
    vi.stubGlobal('localStorage', storage)
    setCatalogCollapsed()
    expect(storage.getItem(CATALOG_COLLAPSE_KEY)).toBe(CATALOG_COLLAPSE_SENTINEL)
  })

  it('setCatalogCollapsed 之後接 isCatalogCollapsed()（<1100px）→ 收合', () => {
    vi.stubGlobal('matchMedia', createFakeMatchMedia(true))
    const storage = createFakeStorage()
    vi.stubGlobal('localStorage', storage)
    setCatalogCollapsed()
    expect(isCatalogCollapsed()).toBe(true)
  })

  it('setItem 擲錯（無痕模式／配額）→ 不冒出例外', () => {
    vi.stubGlobal('localStorage', createFakeStorage({}, { throwOnSet: true }))
    expect(() => setCatalogCollapsed()).not.toThrow()
  })

  it('clearCatalogCollapsed 移除 key（而非寫入怪值）', () => {
    const storage = createFakeStorage({ [CATALOG_COLLAPSE_KEY]: CATALOG_COLLAPSE_SENTINEL })
    vi.stubGlobal('localStorage', storage)
    clearCatalogCollapsed()
    expect(storage.getItem(CATALOG_COLLAPSE_KEY)).toBeNull()
  })

  it('clearCatalogCollapsed 之後接 isCatalogCollapsed()（<1100px）→ 展開', () => {
    vi.stubGlobal('matchMedia', createFakeMatchMedia(true))
    const storage = createFakeStorage({ [CATALOG_COLLAPSE_KEY]: CATALOG_COLLAPSE_SENTINEL })
    vi.stubGlobal('localStorage', storage)
    clearCatalogCollapsed()
    expect(isCatalogCollapsed()).toBe(false)
  })

  it('removeItem 擲錯（無痕模式／配額）→ 不冒出例外', () => {
    const storage = createFakeStorage({ [CATALOG_COLLAPSE_KEY]: CATALOG_COLLAPSE_SENTINEL })
    vi.stubGlobal('localStorage', {
      ...storage,
      removeItem: () => {
        throw new Error('storage 被封鎖（模擬無痕模式）')
      },
    } as Storage)
    expect(() => clearCatalogCollapsed()).not.toThrow()
  })
})
