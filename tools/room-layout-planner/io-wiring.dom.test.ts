// @vitest-environment jsdom
/**
 * T4.w — M4 io 接線的 jsdom 回歸網（(internal design doc)
 * §D7「URL hash 分享」生命週期（讀一次 → `replaceState` 清 hash → 預覽態
 * `ui.fromShare`：debounce 與 flush 皆停用、`fromShare && dirty` 掛
 * `beforeunload`、匯出 JSON／PNG／複製連結皆可用、`#status` 提示＋「儲存為
 * 我的平面圖」鈕（按下前先寫 backup））、backup 時點 (1)(2)、JSON 匯入
 * 前置閘、PNG `aria-busy` 時序、§Verification jsdom「hash 三種失敗播報且
 * localStorage 不動；預覽態不寫 backup；匯入壞 JSON→plan 不變；PNG
 * `aria-busy`」）。
 *
 * 與既有兩支的分工：`main.dom.test.ts` 釘 `main.ts` 自身的時序契約
 * （播報、backup、flush），三支 `io-*.dom.test.ts` 各自釘模組的單體行為，
 * **本檔只釘「模組裝上 `main.ts` 之後」的合流行為**——真 `index.html` 骨架
 * ＋真 `main.ts`，不注入任何 host。
 *
 * 啟動方式同 `main.dom.test.ts`：node 讀真實 `index.html` 取 `<body>` 灌進
 * jsdom、`vi.resetModules()` 後動態 import `main.ts`（模組頂層自我啟動）。
 * hash 必須在 **import 之前**以 `history.replaceState` 佈好——`main.ts` 在
 * 開機當下就讀一次並清掉。
 *
 * jsdom 缺口與對策：
 * - `navigator.clipboard` 不存在 → 以 `Object.defineProperty` 注入假物件。
 * - `<img>` 不會真的載入（既不 `onload` 也不 `onerror`）→ PNG 案以
 *   `vi.stubGlobal('Image', …)` 換成「設 `src` 即 `onerror`」的假物件，
 *   讓預設管線**確定性地**失敗，用以驗證失敗路徑端到端接通。
 * - `<a download>` 點擊會觸發 jsdom 的「navigation not implemented」噪音
 *   → 以 spy 換掉 `HTMLAnchorElement.prototype.click` 並就地取證。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORT_MAX_BYTES, JSON_IO_TEXT } from './io-json.js'
import { PNG_TEXT, STYLE_PROPS } from './io-png.js'
import { buildShareUrl, SHARE_TEXT } from './io-share.js'
import { t } from './messages.js'
import { defaultPlan, type Furniture, type RoomPlan } from './model.js'
import { BACKUP_KEY, STORAGE_KEY } from './storage-keys.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const RAW_HTML = readFileSync(path.resolve(DIR, 'index.html'), 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]!

const m = t()

type MainModule = typeof import('./main.js')

/**
 * 灌乾淨 DOM ＋ 佈好 `location.hash` ＋ 重置模組快取後啟動 `main.ts`。
 * `hash` 為空字串時一併把上一案殘留的 hash 清掉。
 */
async function boot(hash = ''): Promise<MainModule> {
  document.body.innerHTML = BODY_HTML
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
  vi.resetModules()
  return await import('./main.js')
}

// ── DOM 小工具（同 main.dom.test.ts）─────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`測試骨架缺少 #${id}`)
  return found as T
}

function statusText(): string {
  return el('status').textContent ?? ''
}

function errorText(): string {
  return el('error').textContent ?? ''
}

function noticeText(): string {
  return el('io-notice').textContent ?? ''
}

function itemRowCount(): number {
  return document.querySelectorAll('#items-list > li').length
}

function setValue(id: string, value: string): void {
  el<HTMLInputElement>(id).value = value
}

function addFurniture(name: string, width: number, depth: number): void {
  const radio = el<HTMLInputElement>('add-kind-item')
  radio.checked = true
  radio.dispatchEvent(new Event('change', { bubbles: true }))
  setValue('add-name', name)
  setValue('add-width', String(width))
  setValue('add-depth', String(depth))
  el('add-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/** 下一個 macrotask（涵蓋 `Blob.text()`／`setTimeout(0)` 之後的 microtask 排空）。 */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// ── fixture ──────────────────────────────────────────────────────────

function furniture(index: number, name = `家具${index}`): Furniture {
  return {
    id: `i${index}`,
    name,
    color: '#9db4d6',
    width: 20,
    depth: 20,
    x: (index % 10) * 20,
    y: Math.floor(index / 10) * 20,
    rotation: 0,
    passable: true,
  }
}

/** 本機既有存檔（一件家具）；回傳種進 `STORAGE_KEY` 的**原始字串**。 */
function seedStored(): string {
  const plan = defaultPlan()
  plan.items = [furniture(0, '本機桌')]
  const raw = JSON.stringify(plan)
  localStorage.setItem(STORAGE_KEY, raw)
  return raw
}

/** 別人分享過來的平面圖（兩件家具，與本機存檔內容明顯不同）。 */
function sharedPlan(): RoomPlan {
  const plan = defaultPlan()
  plan.items = [furniture(1, '分享桌'), furniture(2, '分享椅')]
  return plan
}

/** `#plan=…`（以 `io-share.ts` 自己的編碼器產生，空 base 即只剩 hash 段）。 */
function shareHash(plan: RoomPlan): string {
  const url = buildShareUrl(plan, { origin: '', pathname: '', search: '' })
  if (url === null) throw new Error('測試 fixture 過大，無法產生分享連結')
  return url
}

/** 設 `src` 即非同步 `onerror` 的假 `Image`（jsdom 不會真的載入圖片）。 */
class FailingImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    setTimeout(() => this.onerror?.(), 0)
  }
}

/** 攔下 `<a download>` 的實際點擊，就地取證檔名與 Blob 內容。 */
function captureDownloads(): { blobs: Blob[]; names: string[] } {
  const blobs: Blob[] = []
  const names: string[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    blobs.push(blob as Blob)
    return 'blob:room-layout-test'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download)
  })
  return { blobs, names }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (navigator as unknown as { clipboard?: unknown }).clipboard
  // 同 main.dom.test.ts：`vi.resetModules()` 不解既有監聽器，舊實例的未決
  // autosave 計時器必須在本案內就地 flush 掉，否則會污染下一案的 setItem。
  window.dispatchEvent(new Event('pagehide'))
  window.history.replaceState(null, '', window.location.pathname)
  document.body.innerHTML = ''
})

/* ------------------------------------------------------------------ *
 * D7 hash 三種失敗：一次 #error、清掉 hash、localStorage 全程不動
 * ------------------------------------------------------------------ */

describe('hash 載入失敗（D7 三種）', () => {
  it('原始長度 >32 KB → hashTooLong、hash 清空、開機期間零 setItem、回落預設平面圖', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await boot(`#plan=${'A'.repeat(40000)}`)

    expect(errorText()).toBe(m.errors.hashTooLong)
    expect(window.location.hash).toBe('')
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(el<HTMLInputElement>('room-width').value).toBe(String(defaultPlan().room.width))
    expect(itemRowCount()).toBe(0)
  })

  it('非 base64url 字元 → hashDecodeFailed 且不動既有存檔', async () => {
    const stored = seedStored()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await boot('#plan=@@@')

    expect(errorText()).toBe(m.errors.hashDecodeFailed)
    expect(window.location.hash).toBe('')
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    // 失敗後照常走 localStorage 路徑（既有存檔仍載入）。
    expect(itemRowCount()).toBe(1)
  })

  it('解得開但不是平面圖（`[]`）→ hashInvalidPlan 且不動既有存檔', async () => {
    const stored = seedStored()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    // base64url('[]') === 'W10'
    await boot('#plan=W10')

    expect(errorText()).toBe(m.errors.hashInvalidPlan)
    expect(window.location.hash).toBe('')
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(itemRowCount()).toBe(1)
  })
})

/* ------------------------------------------------------------------ *
 * D7 預覽態：不觸碰 localStorage、debounce 與 flush 皆停用、beforeunload
 * ------------------------------------------------------------------ */

describe('分享連結載入 → 預覽態', () => {
  it('畫面來自分享、hash 已清、存檔未動；autosave 與 flush 皆停用；dirty 後才掛 beforeunload', async () => {
    const stored = seedStored()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const mod = await boot(shareHash(sharedPlan()))

    // 載入結果
    expect(mod.loadFromHash()).toBe(true)
    expect(mod.isPreview()).toBe(true)
    expect(window.location.hash).toBe('')
    expect(itemRowCount()).toBe(2)
    expect(el('btn-save-shared').hidden).toBe(false)
    expect(noticeText()).toBe(m.ui.previewNotice)
    expect(statusText()).toBe(m.status.previewLoaded)
    // 預覽態不寫 backup、不 autosave：整段開機零 setItem，存檔逐字不變。
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()

    // 乾淨預覽態不攔離開（本案是本檔第一個進預覽態的實例，`beforeunload`
    // 上沒有其他仍是 dirty 的舊實例守衛）。
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    // 變更 → 過了 debounce 仍不寫（D7：debounce 停用）
    vi.useFakeTimers()
    addFurniture('預覽椅', 40, 40)
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    expect(itemRowCount()).toBe(3)
    expect(setItem).not.toHaveBeenCalled()

    // 卸載 flush 同樣停用（`pagehide`／`visibilitychange` 共用同一函式）
    window.dispatchEvent(new Event('pagehide'))
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)

    // dirty 後才攔離開
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('預覽態仍可匯出 JSON，且匯出的是預覽中的平面圖（讀 present）', async () => {
    seedStored()
    const downloads = captureDownloads()
    await boot(shareHash(sharedPlan()))

    el<HTMLButtonElement>('btn-export-json').click()

    expect(downloads.names).toEqual(['room-layout-plan.json'])
    expect(downloads.blobs).toHaveLength(1)
    const exported = JSON.parse(await downloads.blobs[0].text()) as RoomPlan
    expect(exported.items.map((item) => item.name)).toEqual(['分享桌', '分享椅'])
    expect(statusText()).toBe(m.status.planExported)
  })
})

/* ------------------------------------------------------------------ *
 * backup 時點 (2)：「儲存為我的平面圖」
 * ------------------------------------------------------------------ */

describe('儲存為我的平面圖（backup 時點 (2)）', () => {
  it('先搬原始字串進 BACKUP_KEY 再覆蓋；鈕收起、退出預覽態後 autosave 恢復', async () => {
    const stored = seedStored()
    const shared = sharedPlan()
    const mod = await boot(shareHash(shared))

    el<HTMLButtonElement>('btn-save-shared').click()

    expect(localStorage.getItem(BACKUP_KEY)).toBe(stored)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(shared)
    expect(el('btn-save-shared').hidden).toBe(true)
    expect(statusText()).toBe(m.status.savedAsMine)
    // 預覽態的常駐提示已不成立。
    expect(noticeText()).toBe('')
    expect(mod.isPreview()).toBe(false)

    // 退出預覽態 → 後續變更回到正常 autosave（尾沿 debounce）
    vi.useFakeTimers()
    addFurniture('自己的椅', 40, 40)
    vi.advanceTimersByTime(mod.AUTOSAVE_DEBOUNCE_MS)
    vi.useRealTimers()

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as RoomPlan
    expect(saved.items).toHaveLength(3)
    expect(saved.items.at(-1)?.name).toBe('自己的椅')
  })
})

/* ------------------------------------------------------------------ *
 * 預覽態下的三條整份覆蓋路徑（D7 r3.4，review 🟡-5）
 *
 * 契約：「清空」「匯入 JSON」只換記憶體 plan（仍經 `parsePlan`／`apply`），
 * 不寫 localStorage、不寫 backup、維持預覽態；「還原上一份」直接拒絕並於
 * `#io-notice` 指路。離開預覽態的唯一路徑仍是「儲存為我的平面圖」。
 * ------------------------------------------------------------------ */

describe('預覽態下的清空／匯入／還原（D7 r3.4）', () => {
  it('「清空」只換記憶體 plan：兩把 key 逐字不動、仍是預覽態、`#btn-save-shared` 仍在', async () => {
    const stored = seedStored()
    const mod = await boot(shareHash(sharedPlan()))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    el<HTMLButtonElement>('btn-clear').click()

    // 問句換成不承諾備份的預覽態版本。
    expect(confirmSpy.mock.calls[0][0]).toBe(m.ui.confirmClearPreview)
    // plan 回到預設（分享來的兩件家具消失）。
    expect(itemRowCount()).toBe(0)
    expect(el<HTMLInputElement>('room-width').value).toBe(String(defaultPlan().room.width))
    expect(statusText()).toBe(m.status.planCleared)
    // localStorage 全程零寫入。
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
    // 預覽態未結束。
    expect(mod.isPreview()).toBe(true)
    expect(el('btn-save-shared').hidden).toBe(false)
  })

  it('「匯入 JSON」只換記憶體 plan：plan 換成匯入內容、兩把 key 不動、仍是預覽態', async () => {
    const stored = seedStored()
    const mod = await boot(shareHash(sharedPlan()))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const incoming = defaultPlan()
    incoming.items = [furniture(5, '匯入桌')]

    expect(mod.importPlanReplacing(JSON.stringify(incoming))).toBe(true)

    expect(itemRowCount()).toBe(1)
    expect(el('items-list').textContent).toContain('匯入桌')
    expect(statusText()).toBe(m.status.planImported)
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
    expect(mod.isPreview()).toBe(true)
    expect(el('btn-save-shared').hidden).toBe(false)
  })

  it('「還原上一份」被拒：`#io-notice` 換成指路句、兩把 key 與畫面皆不動', async () => {
    const stored = seedStored()
    // 另有一份 backup 可還原——證明「拒絕」不是因為沒東西可還原。
    const backupPlan = defaultPlan()
    backupPlan.items = [furniture(6, '備份桌')]
    const backup = JSON.stringify(backupPlan)
    localStorage.setItem(BACKUP_KEY, backup)

    const mod = await boot(shareHash(sharedPlan()))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    el<HTMLButtonElement>('btn-restore-backup').click()

    expect(noticeText()).toBe(m.ui.restoreBlockedInPreview)
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(localStorage.getItem(BACKUP_KEY)).toBe(backup)
    // 畫面仍是分享來的預覽（沒被 backup 換掉）。
    expect(itemRowCount()).toBe(2)
    expect(mod.isPreview()).toBe(true)
    expect(el('btn-save-shared').hidden).toBe(false)
  })

  it('清空過的預覽仍能「儲存為我的平面圖」：backup 為本機原字串、存檔為清空後的 plan', async () => {
    const stored = seedStored()
    const mod = await boot(shareHash(sharedPlan()))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    el<HTMLButtonElement>('btn-clear').click()
    el<HTMLButtonElement>('btn-save-shared').click()

    expect(localStorage.getItem(BACKUP_KEY)).toBe(stored)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(defaultPlan())
    expect(mod.isPreview()).toBe(false)
    expect(el('btn-save-shared').hidden).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * JSON 匯入／匯出（經 #import-file 的真實接線）
 * ------------------------------------------------------------------ */

describe('JSON 匯入（`#import-file` change）', () => {
  it('壞 JSON → #error importFailed、plan 不變、兩把 key 皆不動', async () => {
    const stored = seedStored()
    await boot()

    const input = el<HTMLInputElement>('import-file')
    const file = new File(['{ not json'], 'plan.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(errorText()).toBe(m.errors.importFailed)
    expect(itemRowCount()).toBe(1)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
  })

  it('合法 JSON → 清單換新、backup 時點 (1) 保住原始字串、播報 planImported', async () => {
    const stored = seedStored()
    await boot()

    const incoming = defaultPlan()
    incoming.items = [furniture(3, '匯入桌'), furniture(4, '匯入椅')]
    const input = el<HTMLInputElement>('import-file')
    const file = new File([JSON.stringify(incoming)], 'plan.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(itemRowCount()).toBe(2)
    expect(localStorage.getItem(BACKUP_KEY)).toBe(stored)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(incoming)
    expect(statusText()).toBe(m.status.planImported)
    expect(input.value).toBe('')
  })

  it('>1 MB → #error importTooLarge、不進 importPlanReplacing（plan 與兩把 key 不動）', async () => {
    const stored = seedStored()
    await boot()

    const input = el<HTMLInputElement>('import-file')
    const file = new File(['{}'], 'huge.json', { type: 'application/json' })
    Object.defineProperty(file, 'size', { configurable: true, value: IMPORT_MAX_BYTES + 1 })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(errorText()).toBe(m.errors.importTooLarge)
    expect(itemRowCount()).toBe(1)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * PNG 匯出（D7：`aria-busy` 時序＋比例文字；jsdom 下管線必然失敗）
 * ------------------------------------------------------------------ */

describe('PNG 匯出', () => {
  it('點擊即 aria-busy＋寫比例文字；管線失敗 → #error pngFailed 且 aria-busy 清除', async () => {
    await boot()
    vi.stubGlobal('Image', FailingImage)
    const button = el<HTMLButtonElement>('btn-export-png')

    button.click()

    // 同步前段（第一個 await 之前）就已設好：整段管線期間恆為 true。
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.disabled).toBe(true)
    expect(el('export-scale').textContent).toContain('匯出比例 1:')

    await vi.waitFor(() => {
      expect(button.hasAttribute('aria-busy')).toBe(false)
    })
    expect(button.disabled).toBe(false)
    expect(errorText()).toBe(m.errors.pngFailed)
  })
})

/* ------------------------------------------------------------------ *
 * 複製分享連結
 * ------------------------------------------------------------------ */

describe('複製分享連結', () => {
  it('寫入剪貼簿的 URL 含 `#plan=`、播報 linkCopied、`#share-note` 為常駐說明句', async () => {
    // 顯式標型：`vi.fn(async () => …)` 會推導出零參數簽章，`mock.calls[0][0]`
    // 隨即觸發 TS2493（同 lane B 在 `io-png.dom.test.ts` 踩過的坑）。
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await boot()

    el<HTMLButtonElement>('btn-share').click()

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
    })
    expect(writeText.mock.calls[0][0]).toContain('#plan=')
    expect(statusText()).toBe(m.status.linkCopied)
    expect(el('share-note').textContent).toBe(m.ui.shareNotice)
  })
})

/* ------------------------------------------------------------------ *
 * 文案收攏與 STYLE_PROPS（T4.w 接線時的兩個同步鎖）
 * ------------------------------------------------------------------ */

describe('文案收攏（T4.w）', () => {
  it('io 模組的在地常數與 messages 字典為同一份文案', () => {
    expect(JSON_IO_TEXT.exported).toBe(m.status.planExported)
    expect(JSON_IO_TEXT.tooLarge).toBe(m.errors.importTooLarge)
    expect(SHARE_TEXT.copied).toBe(m.status.linkCopied)
    expect(SHARE_TEXT.copyFallback).toBe(m.status.linkCopyFallback)
    expect(SHARE_TEXT.savedAsMine).toBe(m.status.savedAsMine)
    expect(SHARE_TEXT.previewNotice).toBe(m.ui.previewNotice)
  })

  it('PNG_TEXT 與 messages 逐字相同（`PngHost` 無 messages 欄，以本測項鎖同步）', () => {
    expect(PNG_TEXT.failed).toBe(m.errors.pngFailed)
    expect(PNG_TEXT.done(3072, 4096)).toBe(m.status.pngDone(3072, 4096))
  })

  it('STYLE_PROPS 含 fill-opacity／stroke-opacity（style.css 的凹入區用 fill-opacity）', () => {
    expect(STYLE_PROPS).toContain('fill-opacity')
    expect(STYLE_PROPS).toContain('stroke-opacity')
  })
})
