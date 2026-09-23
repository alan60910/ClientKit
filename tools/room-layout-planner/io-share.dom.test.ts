// @vitest-environment jsdom
/**
 * T4.3 — URL hash 分享模組的 DOM／純函式回歸（(internal design doc)
 * PLAN.md §D7「URL hash 分享」：順序＝原始 `location.hash` 長度 ≤32 KB →
 * `decodeURIComponent` 容錯 → base64url → `TextDecoder` → `parsePlan()`；
 * 編碼 `stripDeleted` → `TextEncoder` → base64url（去 `=`），>8,000 字元不
 * 產生連結並提示改用 JSON；三種失敗皆 `#error` 一次播報且不觸碰
 * localStorage；預覽態 `beforeunload` 守衛；「儲存為我的平面圖」按下前先由
 * host 寫 backup（本檔只驗證「本模組自己不寫」）；§Verification jsdom「hash
 * 三種失敗播報且 localStorage 不動、預覽態不寫 backup」）。
 *
 * 沿用 `io-json.dom.test.ts` 的 fixture 手法：只灌 `io-share.ts` 會用到的
 * 骨架元素（`#btn-share`／`#share-note`／`#btn-save-shared`）＋假 `host`，
 * **不**啟動 `main.ts`——hash 生命週期（`DOMContentLoaded` 讀取、
 * `history.replaceState`）與 backup 時點 (2) 的實際寫入屬 main.ts 接線步驟
 * 職責，本檔只驗證 io-share.ts 對 `host` 的呼叫形與純函式本身。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachShare,
  buildShareUrl,
  hashFailureText,
  installPreviewGuard,
  readShareHash,
  SHARE_TEXT,
  type Share,
  type ShareHost,
} from './io-share.js'
import { t } from './messages.js'
import { DEFAULT_SETTINGS, type Furniture, type RoomPlan } from './model.js'
import { HASH_RAW_MAX, stripDeleted } from './serialize.js'

const m = t()
const BASE = { origin: 'https://x.test', pathname: '/tools/room-layout-planner/', search: '' }

/* ------------------------------------------------------------------ *
 * fixture 工具
 * ------------------------------------------------------------------ */

function mkFurniture(over: Partial<Furniture> & Pick<Furniture, 'id'>): Furniture {
  return {
    name: over.id,
    color: '#336699',
    width: 50,
    depth: 50,
    x: 0,
    y: 0,
    rotation: 0,
    passable: true,
    ...over,
  }
}

function mkPlan(items: Furniture[] = []): RoomPlan {
  return {
    version: 1,
    room: { width: 300, depth: 400, blocks: [], doors: [] },
    items,
    settings: { ...DEFAULT_SETTINGS },
  }
}

/** 75 件家具（`LIMITS.items` 上限）：足以讓編碼後 >8,000 字元（D7）。 */
function manyFurniture(count: number): Furniture[] {
  const items: Furniture[] = []
  for (let i = 0; i < count; i++) {
    items.push(
      mkFurniture({
        id: `f${i}`,
        name: `家具編號${String(i).padStart(4, '0')}`,
        x: i % 200,
        y: Math.floor(i / 200),
      }),
    )
  }
  return items
}

/** io-share.ts 只查詢這三件；不含 `#status`／`#error`／`#io-notice`（皆走 host）。 */
function skeleton(): void {
  document.body.innerHTML = ''
  const shareBtn = document.createElement('button')
  shareBtn.id = 'btn-share'
  const noteEl = document.createElement('p')
  noteEl.id = 'share-note'
  const saveBtn = document.createElement('button')
  saveBtn.id = 'btn-save-shared'
  saveBtn.hidden = true
  document.body.append(shareBtn, noteEl, saveBtn)
}

interface Harness {
  share: Share
  announced: string[]
  errors: string[]
  notices: string[]
  saveCalls: number
  exitPreviewCalls: number
  setSaveResult(ok: boolean): void
  setClipboard(stub: { writeText(text: string): Promise<void> } | undefined): void
  setPreview(preview: boolean): void
  setDirty(dirty: boolean): void
}

/** 已 `attachShare()` 掛上的模組；`afterEach` 逐一 `detach()`，避免 `beforeunload` 監聽器跨案洩漏。 */
const mounted: Share[] = []

function mount(plan: RoomPlan): Harness {
  skeleton()
  const announced: string[] = []
  const errors: string[] = []
  const notices: string[] = []
  let saveCalls = 0
  let exitPreviewCalls = 0
  let saveResult = true
  let clipboardStub: { writeText(text: string): Promise<void> } | undefined
  let preview = false
  let dirty = false

  const host: ShareHost = {
    getPlan: () => plan,
    messages: m,
    isPreview: () => preview,
    isDirty: () => dirty,
    announce(text) {
      announced.push(text)
    },
    showError(text) {
      errors.push(text)
    },
    notice(text) {
      notices.push(text)
    },
    savePreviewAsMine() {
      saveCalls += 1
      return saveResult
    },
    onExitPreview() {
      exitPreviewCalls += 1
    },
    location: BASE,
    get clipboard() {
      return clipboardStub
    },
  }

  const share = attachShare(document, host)
  mounted.push(share)

  return {
    share,
    announced,
    errors,
    notices,
    get saveCalls() {
      return saveCalls
    },
    get exitPreviewCalls() {
      return exitPreviewCalls
    },
    setSaveResult: (ok) => {
      saveResult = ok
    },
    setClipboard: (stub) => {
      clipboardStub = stub
    },
    setPreview: (p) => {
      preview = p
    },
    setDirty: (d) => {
      dirty = d
    },
  }
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`測試骨架缺少 #${id}`)
  return found as T
}

afterEach(() => {
  for (const share of mounted.splice(0)) share.detach()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ *
 * round-trip（D7：編碼→解碼還原逐欄相同、stripDeleted 已排除已刪除家具）
 * ------------------------------------------------------------------ */

describe('round-trip：buildShareUrl → readShareHash', () => {
  it('中文＋emoji 名稱、已刪除家具被 stripDeleted 排除，其餘逐欄相同', () => {
    const plan = mkPlan([
      mkFurniture({ id: 'a1', name: '書桌🪑', x: 10, y: 10 }),
      mkFurniture({ id: 'b2', name: '舊沙發（已刪除）', deleted: true }),
    ])

    const url = buildShareUrl(plan, BASE)
    expect(url).not.toBeNull()
    expect(url).toMatch(/^https:\/\/x\.test\/tools\/room-layout-planner\/#plan=/)

    const parsed = new URL(url ?? '')
    const result = readShareHash(parsed.hash)
    expect(result).not.toBeNull()
    if (result === null || !result.ok) throw new Error('expected ok result')

    expect(result.plan).toEqual(stripDeleted(plan))
    expect(result.plan.items).toHaveLength(1)
    expect(result.plan.items[0]?.id).toBe('a1')
    expect(result.plan.items[0]?.name).toBe('書桌🪑')
  })
})

/* ------------------------------------------------------------------ *
 * readShareHash：非 #plan= 開頭回 null（沒有可載入的分享內容）
 * ------------------------------------------------------------------ */

describe('readShareHash：非 #plan= 開頭回 null', () => {
  it.each(['', '#other'])('%j → null', (hash) => {
    expect(readShareHash(hash)).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * 三種 hash 失敗（D7）：各自一次判定＋對應文案，且全程不觸碰 localStorage
 * ------------------------------------------------------------------ */

describe('三種 hash 失敗：判定與 hashFailureText 對應，且不觸碰 localStorage', () => {
  it('原始長度 >32 KB → too-long → errors.hashTooLong', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const hash = `#plan=${'A'.repeat(HASH_RAW_MAX + 100)}`

    const result = readShareHash(hash)
    if (result === null || result.ok) throw new Error('expected failure result')
    expect(result.reason).toBe('too-long')
    expect(hashFailureText(result.reason, m)).toBe(m.errors.hashTooLong)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('base64url 字元集不合法（#plan=@@@）→ decode-failed → errors.hashDecodeFailed', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const result = readShareHash('#plan=@@@')
    if (result === null || result.ok) throw new Error('expected failure result')
    expect(result.reason).toBe('decode-failed')
    expect(hashFailureText(result.reason, m)).toBe(m.errors.hashDecodeFailed)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('內容為 JSON 陣列（[] 的 base64url）→ not-object → errors.hashInvalidPlan', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const payload = Buffer.from('[]', 'utf-8').toString('base64url')

    const result = readShareHash(`#plan=${payload}`)
    if (result === null || result.ok) throw new Error('expected failure result')
    expect(result.reason).toBe('not-object')
    expect(hashFailureText(result.reason, m)).toBe(m.errors.hashInvalidPlan)
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ *
 * 複製分享連結（#btn-share／Share.copyLink）
 * ------------------------------------------------------------------ */

describe('複製分享連結', () => {
  it('clipboard 可用且成功 → announce copied，不寫 #io-notice', async () => {
    const h = mount(mkPlan([mkFurniture({ id: 'a' })]))
    const writeText = vi.fn().mockResolvedValue(undefined)
    h.setClipboard({ writeText })

    const ok = await h.share.copyLink()

    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]?.[0]).toMatch(/^https:\/\/x\.test.*#plan=/)
    expect(h.announced).toEqual([SHARE_TEXT.copied])
    expect(h.notices).toEqual([])
  })

  it('clipboard 不可用（未注入且 jsdom 無 navigator.clipboard）→ notice 含連結、announce copyFallback', async () => {
    const h = mount(mkPlan([mkFurniture({ id: 'a' })]))

    const ok = await h.share.copyLink()

    expect(ok).toBe(false)
    expect(h.notices).toHaveLength(1)
    expect(h.notices[0]).toMatch(/^https:\/\/x\.test.*#plan=/)
    expect(h.announced).toEqual([SHARE_TEXT.copyFallback])
  })

  it('clipboard.writeText 擲錯 → 同降級路徑（notice 連結、announce copyFallback）', async () => {
    const h = mount(mkPlan([mkFurniture({ id: 'a' })]))
    h.setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })

    const ok = await h.share.copyLink()

    expect(ok).toBe(false)
    expect(h.notices).toHaveLength(1)
    expect(h.announced).toEqual([SHARE_TEXT.copyFallback])
  })

  it('平面圖過大（75 件、編碼後 >8,000 字元）→ notice shareTooLong、announce shareTooLong、clipboard 不被呼叫', async () => {
    const h = mount(mkPlan(manyFurniture(75)))
    const writeText = vi.fn().mockResolvedValue(undefined)
    h.setClipboard({ writeText })

    const ok = await h.share.copyLink()

    expect(ok).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    expect(h.notices).toEqual([m.errors.shareTooLong])
    expect(h.announced).toEqual([m.errors.shareTooLong])
  })

  it('點擊 #btn-share 觸發同一條邏輯（clipboard 成功路徑）', async () => {
    const h = mount(mkPlan([mkFurniture({ id: 'a' })]))
    const writeText = vi.fn().mockResolvedValue(undefined)
    h.setClipboard({ writeText })

    el<HTMLButtonElement>('btn-share').click()
    await Promise.resolve()
    await Promise.resolve()

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(h.announced).toEqual([SHARE_TEXT.copied])
  })

  it('掛上時 #share-note 寫入 messages.ui.shareNotice', () => {
    mount(mkPlan())
    expect(el('share-note').textContent).toBe(m.ui.shareNotice)
  })
})

/* ------------------------------------------------------------------ *
 * 預覽態 UI（setPreviewUi／#btn-save-shared；D7：預覽態不寫 backup）
 * ------------------------------------------------------------------ */

describe('預覽態 UI', () => {
  it('setPreviewUi(true) → #btn-save-shared 可見（無 hidden）、notice 寫入 previewNotice', () => {
    const h = mount(mkPlan())

    h.share.setPreviewUi(true)

    expect(el<HTMLButtonElement>('btn-save-shared').hidden).toBe(false)
    expect(h.notices).toEqual([SHARE_TEXT.previewNotice])
  })

  it('setPreviewUi(false) → #btn-save-shared 隱藏、不寫 notice', () => {
    const h = mount(mkPlan())

    h.share.setPreviewUi(true)
    h.share.setPreviewUi(false)

    expect(el<HTMLButtonElement>('btn-save-shared').hidden).toBe(true)
    expect(h.notices).toEqual([SHARE_TEXT.previewNotice])
  })

  it('點擊 #btn-save-shared：host.savePreviewAsMine 成功 → 鈕重新隱藏、onExitPreview、announce savedAsMine', () => {
    const h = mount(mkPlan())
    h.share.setPreviewUi(true)
    h.setSaveResult(true)

    el<HTMLButtonElement>('btn-save-shared').click()

    expect(h.saveCalls).toBe(1)
    expect(el<HTMLButtonElement>('btn-save-shared').hidden).toBe(true)
    expect(h.exitPreviewCalls).toBe(1)
    expect(h.announced).toEqual([SHARE_TEXT.savedAsMine])
  })

  it('點擊 #btn-save-shared：host.savePreviewAsMine 失敗 → 鈕仍可見、不 exitPreview、不 announce（host 已自行處理 #error）', () => {
    const h = mount(mkPlan())
    h.share.setPreviewUi(true)
    h.setSaveResult(false)

    el<HTMLButtonElement>('btn-save-shared').click()

    expect(h.saveCalls).toBe(1)
    expect(el<HTMLButtonElement>('btn-save-shared').hidden).toBe(false)
    expect(h.exitPreviewCalls).toBe(0)
    expect(h.announced).toEqual([])
  })

  it('成功／失敗兩種結果皆不呼叫 localStorage.setItem（本模組不寫 backup，由 host 內部負責）', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const h = mount(mkPlan())
    h.share.setPreviewUi(true)

    h.setSaveResult(true)
    el<HTMLButtonElement>('btn-save-shared').click()
    h.share.setPreviewUi(true)
    h.setSaveResult(false)
    el<HTMLButtonElement>('btn-save-shared').click()

    expect(setItemSpy).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ *
 * installPreviewGuard（D7：fromShare && dirty 時掛 beforeunload）
 * ------------------------------------------------------------------ */

describe('installPreviewGuard', () => {
  it('guard 為 true → beforeunload 被 preventDefault', () => {
    const remove = installPreviewGuard(window, () => true)
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    remove()
  })

  it('guard 為 false → 不 preventDefault', () => {
    const remove = installPreviewGuard(window, () => false)
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    remove()
  })

  it('remover 解除監聽：移除後再 dispatch 不再 preventDefault', () => {
    const remove = installPreviewGuard(window, () => true)
    remove()
    const event = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('attachShare 內部以 host.isPreview() && host.isDirty() 組成 guard', () => {
    const h = mount(mkPlan())
    h.setPreview(true)
    h.setDirty(true)
    const event1 = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event1)
    expect(event1.defaultPrevented).toBe(true)

    h.setDirty(false)
    const event2 = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event2)
    expect(event2.defaultPrevented).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * detach（同其餘 DOM 層模組：detach 後監聽器與 beforeunload 守衛皆失效）
 * ------------------------------------------------------------------ */

describe('detach', () => {
  it('detach 後點擊兩鈕不再有作用；beforeunload 守衛亦解除', () => {
    const h = mount(mkPlan())
    h.share.setPreviewUi(true)
    h.setPreview(true)
    h.setDirty(true)

    h.share.detach()
    mounted.splice(mounted.indexOf(h.share), 1)

    el<HTMLButtonElement>('btn-share').click()
    el<HTMLButtonElement>('btn-save-shared').click()
    expect(h.announced).toEqual([])
    expect(h.saveCalls).toBe(0)

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * 原始碼掃描：D7 DOM 寫入不變量
 * ------------------------------------------------------------------ */

describe('原始碼掃描：DOM 寫入不變量（D7）', () => {
  it('io-share.ts 不含 HTML 字串注入與整批子節點替換 API', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(path.join(here, 'io-share.ts'), 'utf-8')
    for (const banned of ['innerHTML', 'insertAdjacentHTML', 'outerHTML', 'replaceChildren']) {
      expect(source).not.toContain(banned)
    }
  })
})
