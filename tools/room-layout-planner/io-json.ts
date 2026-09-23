/**
 * T4.1 — JSON 匯出／匯入（(internal design doc) §D7「JSON
 * 匯出／匯入」「匯出以 `stripDeleted(plan)` 純函式副本序列化、**不**
 * dispatch」「匯入 `File.size` ≤1 MB」「失敗 `#error` 且 plan 不變」
 * 「backup 時點 (1) 匯入成功後 replace 前」、§G6、§Verification jsdom
 * 「匯入壞 JSON→alert 且 plan 不變」「匯出後 live plan 不變」）。
 *
 * DOM 層模組（接線手法同 `report-list.ts`／`panel.ts`）：掛
 * `#btn-export-json`／`#btn-import-json`／`#import-file` 三件套。本檔
 * **不重做**任何 backup／`parsePlan`／整份覆蓋邏輯——那三步已在 `main.ts`
 * 的 `importPlanReplacing()` 內完成（backup 時點 (1)），本檔只做前置的
 * `File.size` 閘與把檔案文字交過去；成功／失敗後的 `#status`／`#error`
 * 播報一律由 `host` 負責，本檔不重複播報。
 *
 * 兩條硬契約：
 * 1. **匯出零副作用**——`buildExportJson()` 恆等於 `serializePlan(plan)`
 *    （`stripDeleted` 的純函式副本），不 mutate 傳入的 `plan`、不
 *    dispatch 任何 action；live plan 物件參考在匯出前後不變。
 * 2. **匯入前置檢查止步於本檔**——`file.size > IMPORT_MAX_BYTES` 時直接
 *    `host.showError()` 並重置 `<input>`、**不**呼叫
 *    `host.importPlanReplacing()`；≤1 MB 才讀檔文字並交過去，無論成敗都
 *    重置 `input.value`（讓同一個檔案能重選再匯）。
 *
 * 兩句文案（匯出完成／檔案過大）已於 T4.w 接線時併入 `messages.ts`
 * （`status.planExported`／`errors.importTooLarge`），執行期由
 * `host.messages` 取用。DOM 寫入只經 `createElement`／`append`／屬性賦值，
 * 不使用任何 HTML 字串注入或整批子節點替換 API（D7 DOM 寫入不變量）。
 */
import { zhHant, type Messages } from './messages.js'
import type { RoomPlan } from './model.js'
import { serializePlan } from './serialize.js'

/** D7：匯入檔案大小閘，恆以 `File.size`（bytes）判定。 */
export const IMPORT_MAX_BYTES = 1024 * 1024

/** 匯出檔名（無對應 `messages.ts` key，檔名本非語系文案）。 */
export const EXPORT_FILENAME = 'room-layout-plan.json'

/**
 * T4.w：兩句文案已收進 `messages.ts`（`status.planExported`／
 * `errors.importTooLarge`），執行期一律由 `host.messages` 取用；本常數
 * 降為**指向同一份字典的別名**，只供既有測項與 e2e 取字面值比對，
 * 不再是文案的事實來源（改字請改 `messages.ts`）。
 */
export const JSON_IO_TEXT = {
  exported: zhHant.status.planExported,
  tooLarge: zhHant.errors.importTooLarge,
} as const

export interface JsonIoHost {
  getPlan(): RoomPlan
  messages: Messages
  /** main.ts 既有函式：parsePlan＋backup（時點 (1)）＋replace＋播報，全含在內。 */
  importPlanReplacing(raw: string): boolean
  announce(text: string): void
  showError(text: string): void
  /** 可注入（測試／e2e）；預設＝`<a download>` ＋ `URL.createObjectURL`。 */
  download?: (blob: Blob, filename: string) => void
}

export interface JsonIo {
  detach(): void
  /** 最近一次匯出的 JSON 全文；尚未匯出過為 `null`。 */
  readonly lastExport: string | null
  /** 供測試／e2e 直接餵文字，繞過 `<input type="file">`。 */
  importText(text: string): boolean
  importFile(file: File): Promise<boolean>
}

/**
 * 匯出用序列化——恆等於 `serializePlan(plan)`（`stripDeleted` 的純函式
 * 副本，D7）：拿到的是全新物件圖，`plan` 與其巢狀陣列／物件一律不被
 * mutate、也不被共用參考。
 */
export function buildExportJson(plan: RoomPlan): string {
  return serializePlan(plan)
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector)
  if (found === null) throw new Error(`io-json.ts：DOM 契約缺少元素 ${selector}`)
  return found
}

/**
 * 預設下載實作：`<a download>` ＋ `URL.createObjectURL`。jsdom 等無
 * `URL.createObjectURL` 的環境 feature-detect 後改為 no-op——呼叫端仍能
 * 從 `lastExport` 取得匯出內容，不必真的觸發瀏覽器下載。
 */
function defaultDownload(doc: Document): (blob: Blob, filename: string) => void {
  return (blob, filename) => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(blob)
    const a = doc.createElement('a')
    a.href = url
    a.download = filename
    doc.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/**
 * 掛上 `#btn-export-json`／`#btn-import-json`／`#import-file` 三件套（靜態
 * 骨架由 `index.html` 提供，本檔只查詢、接線與填值）。
 */
export function attachJsonIo(root: ParentNode, host: JsonIoHost): JsonIo {
  const exportBtn = query<HTMLButtonElement>(root, '#btn-export-json')
  const importBtn = query<HTMLButtonElement>(root, '#btn-import-json')
  const fileInput = query<HTMLInputElement>(root, '#import-file')

  const doc = fileInput.ownerDocument
  const download = host.download ?? defaultDownload(doc)

  let detached = false
  let lastExport: string | null = null
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

  /** 匯出：純函式序列化 → Blob → 下載 → 播報。不碰 `history`／不 dispatch。 */
  function doExport(): void {
    const json = buildExportJson(host.getPlan())
    lastExport = json
    const blob = new Blob([json], { type: 'application/json' })
    download(blob, EXPORT_FILENAME)
    host.announce(host.messages.status.planExported)
  }

  function resetInput(): void {
    fileInput.value = ''
  }

  /** 供測試／e2e 直接餵文字；不動 `<input>`（沒有對應的檔案選取狀態）。 */
  function importText(text: string): boolean {
    return host.importPlanReplacing(text)
  }

  /**
   * `File.size` 閘 → 讀檔文字 → 交給 `host.importPlanReplacing()`。無論
   * 成敗都重置 `input.value`（**唯一**的重置點在 `finally`），讓使用者能
   * 重選同一個檔案再匯一次。
   *
   * `file.text()` 會擲錯（檔案在選取後被移走／權限被撤銷 → `NotReadableError`）：
   * 不接住的話是一個未捕捉的 promise rejection——畫面上沒有 `#error`、
   * `<input>` 也沒重置，症狀是「按了匯入沒反應，而且重選同一個檔案也不再
   * 觸發」。讀檔失敗與內容無法辨識對使用者是同一件事（這個檔匯不進來），
   * 故共用 `errors.importFailed`。
   */
  async function importFile(file: File): Promise<boolean> {
    try {
      if (file.size > IMPORT_MAX_BYTES) {
        host.showError(host.messages.errors.importTooLarge)
        return false
      }
      let text: string
      try {
        text = await file.text()
      } catch {
        host.showError(host.messages.errors.importFailed)
        return false
      }
      return importText(text)
    } finally {
      resetInput()
    }
  }

  on(exportBtn, 'click', doExport)
  on(importBtn, 'click', () => fileInput.click())
  on(fileInput, 'change', () => {
    const file = fileInput.files?.[0]
    if (file === undefined) return
    void importFile(file)
  })

  function detach(): void {
    detached = true
    for (const off of cleanups) off()
    cleanups.length = 0
  }

  return {
    detach,
    get lastExport() {
      return lastExport
    },
    importText,
    importFile,
  }
}
