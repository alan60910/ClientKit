/**
 * T3.5 單元測試（(internal design doc) §D5；TASKS.md
 * T3.5）：教學帶 dismiss 狀態機——常數字面值鎖定（防漂移，e2e M4 將引用
 * 同源）＋單一謂詞／dismiss 動作的純函式行為。
 *
 * 本專案 vitest 無 jsdom 預設環境（同 `src/theme.test.ts` 慣例）：
 * `tutorial-band.ts` 模組頂層不碰 `localStorage`，以 `vi.stubGlobal`
 * 換陽春假 storage（可選擇性拋錯模擬無痕模式），驗證「惰性存取」設計＋
 * try/catch best-effort 行為，不需 jsdom。互動整合面（DOM click／reload
 * 記憶）併入 tutorial-band.dom.test.ts。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dismissTutorialBand,
  shouldShowTutorialBand,
  TUTORIAL_DISMISS_KEY,
  TUTORIAL_DISMISS_SENTINEL,
} from './tutorial-band.js'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('常數字面值（防漂移；main.ts 接線與未來 e2e seed 步驟同源引用）', () => {
  // sprint 17 M1（PLAN §D4「7 把 localStorage key」列）：字面釘值集中到
  // `src/storage-keys-pin.test.ts`（單一出處，防分散字面斷言各自漂移）；
  // 本檔只驗匯入常數的 `<brand>-<scope>-<name>` 形狀，其餘案一律經常數
  // 存取 storage。
  it('TUTORIAL_DISMISS_KEY 符合 <brand>-<scope>-<name> 慣例形狀（字面釘值見 storage-keys-pin.test.ts）', () => {
    expect(TUTORIAL_DISMISS_KEY).toMatch(/^[a-z]+-statusline-builder-drag-tutorial$/)
  })

  it('TUTORIAL_DISMISS_SENTINEL 鎖定為 "1"', () => {
    expect(TUTORIAL_DISMISS_SENTINEL).toBe('1')
  })
})

describe('shouldShowTutorialBand — 單一謂詞：顯示 ⟺ 讀值 !== SENTINEL', () => {
  it('key 缺失（getItem 回傳 null）→ 顯示', () => {
    vi.stubGlobal('localStorage', createFakeStorage())
    expect(shouldShowTutorialBand()).toBe(true)
  })

  it('讀值＝SENTINEL（"1"）→ 不顯示', () => {
    vi.stubGlobal('localStorage', createFakeStorage({ [TUTORIAL_DISMISS_KEY]: TUTORIAL_DISMISS_SENTINEL }))
    expect(shouldShowTutorialBand()).toBe(false)
  })

  it.each(['true', '0', ''])('怪值（%j）→ 顯示（非 SENTINEL 皆顯示）', (weird) => {
    vi.stubGlobal('localStorage', createFakeStorage({ [TUTORIAL_DISMISS_KEY]: weird }))
    expect(shouldShowTutorialBand()).toBe(true)
  })

  it('getItem 擲錯（無痕模式）→ 顯示，且不冒出例外（fail-open）', () => {
    vi.stubGlobal('localStorage', createFakeStorage({}, { throwOnGet: true }))
    expect(() => shouldShowTutorialBand()).not.toThrow()
    expect(shouldShowTutorialBand()).toBe(true)
  })
})

describe('dismissTutorialBand — best-effort 寫入 sentinel（同 persist() 慣例）', () => {
  it('寫入成功 → key 存為 SENTINEL，之後 shouldShowTutorialBand() 回 false', () => {
    const storage = createFakeStorage()
    vi.stubGlobal('localStorage', storage)
    dismissTutorialBand()
    expect(storage.getItem(TUTORIAL_DISMISS_KEY)).toBe(TUTORIAL_DISMISS_SENTINEL)
    expect(shouldShowTutorialBand()).toBe(false)
  })

  it('setItem 擲錯（無痕模式／配額）→ 不冒出例外（呼叫端仍可讓本次隱藏生效）', () => {
    vi.stubGlobal('localStorage', createFakeStorage({}, { throwOnSet: true }))
    expect(() => dismissTutorialBand()).not.toThrow()
  })
})
