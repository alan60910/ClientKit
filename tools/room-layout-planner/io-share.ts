/**
 * T4.3 — URL hash 分享模組（(internal design doc) §D7「URL hash
 * 分享」：順序＝原始 `location.hash` 長度 ≤32 KB → `decodeURIComponent` 容錯
 * → base64url 解 → `TextDecoder` → `parsePlan()`；編碼 `stripDeleted` →
 * `TextEncoder` → base64url（去 `=`），>8,000 字元不產生連結並提示改用
 * JSON；三種失敗皆 `#error` 一次播報且不觸碰 localStorage；預覽態
 * `ui.fromShare=true`：debounce 與 flush 皆停用、`fromShare && dirty` 時掛
 * `beforeunload`、匯出可用、`#status` 提示＋「儲存為我的平面圖」鈕；「複製
 * 分享連結」鈕旁常駐說明句；§Verification jsdom「hash 三種失敗播報且
 * localStorage 不動、預覽態不寫 backup」）。
 *
 * 本檔只做**純狀態／DOM** 部分：hash 編解碼的薄封裝（`buildShareUrl`／
 * `readShareHash`／`hashFailureText`，底層邏輯皆在 `serialize.ts`，本檔不
 * 重做）、「複製分享連結」／「儲存為我的平面圖」兩鈕接線、`#share-note`
 * 常駐句、預覽態 UI 切換、`beforeunload` 守衛。**不**讀 `location.hash`、
 * **不**呼叫 `history.replaceState`、**不**在 `DOMContentLoaded` 掛勾——那些
 * 屬於載入生命週期，由 `main.ts` 的後續接線步驟以 `readShareHash()`／
 * `hashFailureText()` 兩個純函式自行組裝（見檔尾「交接備忘」）。
 *
 * DOM 層模組（接線手法同 `io-json.ts`／`report-list.ts`）：直接查詢並持有
 * `#btn-share`／`#share-note`／`#btn-save-shared` 三件（本模組專屬控件）；
 * `#status`／`#error`／`#io-notice` 皆**不**直接觸碰，一律經
 * `host.announce`／`host.showError`／`host.notice` 寫入（`host.notice` 對應
 * `#io-notice`，比照 `main.ts` 既有的 `noticeEl` 職責分工）。DOM 寫入只經
 * `textContent`／屬性賦值，不出現整批 HTML 字串注入 API（D7 DOM 寫入
 * 不變量；見檔尾原始碼掃描測項的禁用清單）。
 */
import { zhHant, type Messages } from './messages.js'
import type { RoomPlan } from './model.js'
import { decodePlanHash, encodePlanHash, HASH_PREFIX, type HashResult } from './serialize.js'

/**
 * T4.w：四句文案已收進 `messages.ts`（`status.linkCopied`／
 * `status.linkCopyFallback`／`status.savedAsMine`／`ui.previewNotice`），
 * 執行期一律由 `host.messages` 取用；本常數降為**指向同一份字典的別名**，
 * 只供既有測項與 e2e 取字面值比對，不再是文案的事實來源。
 */
export const SHARE_TEXT = {
  copied: zhHant.status.linkCopied,
  copyFallback: zhHant.status.linkCopyFallback,
  savedAsMine: zhHant.status.savedAsMine,
  previewNotice: zhHant.ui.previewNotice,
} as const

/**
 * 分享連結編碼（D7 順序，底層見 `serialize.ts` 的 `encodePlanHash`）：
 * `${origin}${pathname}${search}#plan=${encoded}`。`encodePlanHash` 回 `null`
 * 代表編碼後 >8,000 字元——呼叫端據此不產生連結並提示改用 JSON。
 */
export function buildShareUrl(
  plan: RoomPlan,
  base: { origin: string; pathname: string; search: string },
): string | null {
  const encoded = encodePlanHash(plan)
  if (encoded === null) return null
  return `${base.origin}${base.pathname}${base.search}#${HASH_PREFIX}${encoded}`
}

/**
 * 分享連結解碼：`hash` 不以 `#plan=` 開頭時視為「沒有可載入的分享內容」，
 * 回 `null`（供呼叫端判斷「本次開機沒有 hash」與「hash 存在但解碼失敗」的
 * 差異，兩者播報行為不同）；否則交給 `decodePlanHash()`（D7 順序釘死：長度
 * 閘 → `decodeURIComponent` 容錯 → base64url → `TextDecoder` → `parsePlan`）。
 */
export function readShareHash(hash: string): HashResult | null {
  if (!hash.startsWith(`#${HASH_PREFIX}`)) return null
  return decodePlanHash(hash)
}

/** D7 三種失敗原因 → `#error` 文案；`decode-failed`／`too-long` 各一句，其餘（`parsePlan` 三種）共用「非有效平面圖」。 */
export function hashFailureText(
  reason: Exclude<HashResult, { ok: true }>['reason'],
  messages: Messages,
): string {
  if (reason === 'too-long') return messages.errors.hashTooLong
  if (reason === 'decode-failed') return messages.errors.hashDecodeFailed
  return messages.errors.hashInvalidPlan
}

/**
 * 預覽態 `beforeunload` 守衛（D7：「`fromShare && dirty` 時掛
 * `beforeunload`」）：`isGuarded()` 由呼叫端組成該判準（`attachShare()` 內部
 * 以 `host.isPreview() && host.isDirty()` 組出，供本函式獨立於 DOM 層之外
 * 也可單獨測試／複用）。回傳的移除函式為冪等寫法的鏡像（`removeEventListener`
 * 對未註冊的監聽器是安全的 no-op）。
 */
export function installPreviewGuard(win: Window, isGuarded: () => boolean): () => void {
  const handler = (event: Event): void => {
    if (!isGuarded()) return
    event.preventDefault()
    // 舊版瀏覽器仍讀 `returnValue`（非標準相容路徑）；一般 `Event` 型別未必
    // 宣告此欄位，故经由型別斷言寫入，不影響 `preventDefault()` 已生效。
    ;(event as unknown as { returnValue: string }).returnValue = ''
  }
  win.addEventListener('beforeunload', handler)
  return () => win.removeEventListener('beforeunload', handler)
}

// ── DOM 層 ──────────────────────────────────────────────────────────

export interface ShareHost {
  getPlan(): RoomPlan
  messages: Messages
  /** 目前是否為分享預覽態（`ui.fromShare`）。 */
  isPreview(): boolean
  /** 預覽態下是否已有未保存的變更（`ui.dirty`）。 */
  isDirty(): boolean
  announce(text: string): void
  showError(text: string): void
  /** `#io-notice`（常駐提示，非 live region 播報）。 */
  notice(text: string): void
  /** `main.ts` 既有函式：backup 時點 (2) ＋整份覆蓋＋退出預覽態，全含在內。 */
  savePreviewAsMine(): boolean
  /** `savePreviewAsMine()` 成功後呼叫；host 據此重繪／隱藏本模組的鈕。 */
  onExitPreview(): void
  /** 可注入（測試）；預設＝目前文件的 `window.location`。 */
  location?: { origin: string; pathname: string; search: string }
  /** 可注入（測試／feature-detect）；預設＝`navigator.clipboard`（可能不存在）。 */
  clipboard?: { writeText(text: string): Promise<void> }
}

export interface Share {
  detach(): void
  /** `#btn-share` 點擊邏輯的可直呼版本（測試／e2e 用）；回傳是否複製成功。 */
  copyLink(): Promise<boolean>
  /** 顯示／隱藏 `#btn-save-shared`；`true` 時一併把常駐提示寫進 `#io-notice`。 */
  setPreviewUi(preview: boolean): void
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector)
  if (found === null) throw new Error(`io-share.ts：DOM 契約缺少元素 ${selector}`)
  return found
}

/**
 * 掛上 `#btn-share`／`#share-note`／`#btn-save-shared` 三件套（靜態骨架由
 * `index.html` 提供，本檔只查詢、接線與填值）。附帶把 D7「`fromShare &&
 * dirty` 時掛 `beforeunload`」的守衛一併掛上——`ShareHost.isPreview()`／
 * `isDirty()` 存在的唯一理由就是組出這個判準，故收在本函式內、隨
 * `detach()` 一併解除，呼叫端不必另外管理這條監聽器的生命週期。
 */
export function attachShare(root: ParentNode, host: ShareHost): Share {
  const m = host.messages
  const shareBtn = query<HTMLButtonElement>(root, '#btn-share')
  const noteEl = query<HTMLElement>(root, '#share-note')
  const saveBtn = query<HTMLButtonElement>(root, '#btn-save-shared')

  // 常駐說明句（D7：「『複製分享連結』鈕旁常駐一句…」）。
  noteEl.textContent = m.ui.shareNotice

  const doc = shareBtn.ownerDocument
  const win = doc.defaultView ?? window

  let detached = false
  const cleanups: Array<() => void> = []

  function on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    const wrapped = (event: Event): void => {
      if (detached) return
      handler(event as HTMLElementEventMap[K])
    }
    target.addEventListener(type, wrapped)
    cleanups.push(() => target.removeEventListener(type, wrapped))
  }

  function resolveLocation(): { origin: string; pathname: string; search: string } {
    return host.location ?? win.location
  }

  /** feature-detect：`host.clipboard` 優先，否則退回 `navigator.clipboard`（可能不存在，如 jsdom）。 */
  function resolveClipboard(): { writeText(text: string): Promise<void> } | undefined {
    if (host.clipboard !== undefined) return host.clipboard
    return typeof navigator === 'undefined' ? undefined : navigator.clipboard
  }

  /**
   * `#btn-share` 的核心邏輯：`buildShareUrl()` 為 `null`（>8,000 字元）→
   * `notice` ＋ `announce` 提示改用 JSON（PLAN 明文不用 `#error`：這不是
   * 載入失敗，是「這次操作做不到」）；否則嘗試複製，複製不可用或失敗皆走
   * 同一條降級路徑（把連結寫進 `#io-notice`、播報「請手動複製」）。
   */
  async function copyLink(): Promise<boolean> {
    const url = buildShareUrl(host.getPlan(), resolveLocation())
    if (url === null) {
      host.notice(m.errors.shareTooLong)
      host.announce(m.errors.shareTooLong)
      return false
    }
    const clipboard = resolveClipboard()
    if (clipboard === undefined) {
      host.notice(url)
      host.announce(m.status.linkCopyFallback)
      return false
    }
    try {
      await clipboard.writeText(url)
    } catch {
      host.notice(url)
      host.announce(m.status.linkCopyFallback)
      return false
    }
    host.announce(m.status.linkCopied)
    return true
  }

  function setPreviewUi(preview: boolean): void {
    saveBtn.hidden = !preview
    if (preview) host.notice(m.ui.previewNotice)
  }

  on(shareBtn, 'click', () => {
    void copyLink()
  })

  on(saveBtn, 'click', () => {
    if (!host.savePreviewAsMine()) return
    setPreviewUi(false)
    host.onExitPreview()
    host.announce(m.status.savedAsMine)
  })

  const removeGuard = installPreviewGuard(win, () => host.isPreview() && host.isDirty())
  cleanups.push(removeGuard)

  function detach(): void {
    detached = true
    for (const off of cleanups) off()
    cleanups.length = 0
  }

  return { detach, copyLink, setPreviewUi }
}

/**
 * ── 交接備忘（給 M4 main.ts 接線步驟）───────────────────────────────
 *
 * **狀態：T4.w 已照本備忘接線完成**（`main.ts` 的 `loadFromHash()` 已改為
 * 開機讀一次 hash 的實作、`flushAutosave()` 已補 `ui.fromShare` 閘、
 * `ui.dirty` 由 `scheduleAutosave()` 單點寫入、`attachShare()` 已在
 * `createApp()` 內掛上、第 6 點的四句文案已併入 `messages.ts`）。以下保留
 * 為設計理由紀錄。
 *
 * 1. `main.ts` 目前的 `loadFromHash()` 是恆回 `false` 的 stub。接線時改為：
 *    在**首次渲染前**（`DOMContentLoaded`，即 `createApp()` 內、
 *    `recomputeReport()` 之前）呼叫 `readShareHash(location.hash)`；
 *    - `null`：沒有分享內容，行為不變（維持讀 localStorage 或預設）。
 *    - `{ ok: false, reason }`：`showError(hashFailureText(reason, messages))`，
 *      `plan` 與 `localStorage` 皆不動（D7：三種失敗皆 `#error` 一次播報且
 *      不觸碰 localStorage——只需不呼叫 `overwriteStoredPlan()`／
 *      `writeStoredPlan()` 即滿足，`readShareHash`／`decodePlanHash` 本身
 *      已是純函式）。
 *    - `{ ok: true, plan }`：以該 `plan` 取代 `initialPlan`、設
 *      `ui.fromShare = true`，並立即 `history.replaceState(null, '', location.pathname + location.search)`
 *      清除 hash（D7 生命週期）。
 * 2. `scheduleAutosave()` 已判斷 `ui.fromShare` 提前 return（見 `main.ts`
 *    現有實作），`flushAutosave()` 目前**未**做同樣判斷——接線時需比照補上
 *    （D7：「debounce 與 flush 皆停用」），否則 `visibilitychange`／
 *    `pagehide` 仍會在預覽態寫入 `STORAGE_KEY`。
 * 3. `attachShare(document, shareHost)` 的 `shareHost` 需提供：
 *    `isPreview: () => ui.fromShare`、`isDirty: () => ui.dirty`、
 *    `notice: (text) => { noticeEl.textContent = text }`（`main.ts` 既有
 *    `noticeEl` 變數）、`savePreviewAsMine`／`announce`／`showError` 皆為
 *    `main.ts` 既有同名函式或匯出、`onExitPreview: () => render()`
 *    （`savePreviewAsMine()` 內部已改 `ui.fromShare = false` 並呼叫過一次
 *    `render()`，`onExitPreview` 可為 no-op 或再次 `render()`，取決於
 *    `attachShare()` 呼叫時序是否已涵蓋；建議先以 no-op 起手，jsdom 案若
 *    抓到畫面未更新再補）。
 * 4. `#btn-share`／`#btn-save-shared` 兩鈕目前僅存在 enabled、點擊無作用
 *    （`main.ts` JSDoc 開頭明文）；接線只需在 `createApp()` 內加一行
 *    `attachShare(document, shareHost)`，不必先拆除任何 disabled 狀態機。
 * 5. `ui.dirty` 目前無人寫入（`main.ts` 尚未追蹤）；接線時需在預覽態下、
 *    任一會改動 `present` 的動作（`dispatch()` 成功分支、`dragCommit()`
 *    的 `moved` 分支等）把 `ui.dirty = true`——本檔不touch `ui`，這步留給
 *    main.ts 接線。
 * 6. `SHARE_TEXT` 四句是否併入 `messages.ts` 由接線步驟決定（比照
 *    `io-json.ts` 的 `JSON_IO_TEXT` 同一交接模式）。
 */
