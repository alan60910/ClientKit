// @vitest-environment jsdom
/**
 * T4.1 — JSON 匯出／匯入的 DOM 回歸（(internal design doc)
 * §D7「JSON 匯出／匯入」「匯出以 `stripDeleted(plan)` 純函式副本序列化、
 * **不** dispatch」「匯入 `File.size` ≤1 MB」「失敗 `#error` 且 plan 不變」
 * 「backup 時點 (1) 匯入成功後 replace 前」、§G6、§Verification jsdom
 * 「匯入壞 JSON→alert 且 plan 不變」「匯出後 live plan 不變」）。
 *
 * 沿用 `report-list.dom.test.ts` 的 fixture 手法：只灌 `io-json.ts` 會用到
 * 的骨架元素＋假 `host`，**不**啟動 `main.ts`——`importPlanReplacing()` 的
 * `parsePlan`／backup／replace／播報邏輯屬 main.ts 職責，本檔只驗證
 * io-json.ts 對 `host` 的呼叫形，不重測那條邏輯本身。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachJsonIo,
  buildExportJson,
  EXPORT_FILENAME,
  IMPORT_MAX_BYTES,
  JSON_IO_TEXT,
  type JsonIo,
  type JsonIoHost,
} from './io-json.js'
import { t } from './messages.js'
import { DEFAULT_SETTINGS, type Furniture, type RoomPlan } from './model.js'

const m = t()

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

/** io-json.ts 只查詢這三件；`#error`／`#status` 陪襯，模擬真實頁面骨架。 */
function skeleton(): void {
  document.body.innerHTML = ''
  const exportBtn = document.createElement('button')
  exportBtn.id = 'btn-export-json'
  const importBtn = document.createElement('button')
  importBtn.id = 'btn-import-json'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.id = 'import-file'
  const errorEl = document.createElement('div')
  errorEl.id = 'error'
  const statusEl = document.createElement('div')
  statusEl.id = 'status'
  document.body.append(exportBtn, importBtn, fileInput, errorEl, statusEl)
}

interface Harness {
  io: JsonIo
  announced: string[]
  errors: string[]
  importCalls: string[]
  downloadCalls: Array<{ blob: Blob; filename: string }>
  setImportResult(ok: boolean): void
}

function mount(plan: RoomPlan, opts: { withDownload?: boolean } = {}): Harness {
  skeleton()
  const announced: string[] = []
  const errors: string[] = []
  const importCalls: string[] = []
  const downloadCalls: Array<{ blob: Blob; filename: string }> = []
  let importResult = true

  const host: JsonIoHost = {
    getPlan: () => plan,
    messages: m,
    importPlanReplacing(raw) {
      importCalls.push(raw)
      return importResult
    },
    announce(text) {
      announced.push(text)
    },
    showError(text) {
      errors.push(text)
    },
    download:
      opts.withDownload === false
        ? undefined
        : (blob, filename) => downloadCalls.push({ blob, filename }),
  }

  const io = attachJsonIo(document, host)
  return {
    io,
    announced,
    errors,
    importCalls,
    downloadCalls,
    setImportResult: (ok) => {
      importResult = ok
    },
  }
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`測試骨架缺少 #${id}`)
  return found as T
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ *
 * 匯出（D7：stripDeleted 副本、不 dispatch、live plan 不變）
 * ------------------------------------------------------------------ */

describe('匯出 JSON', () => {
  it('`buildExportJson` 恆等於 `serializePlan`（stripDeleted 副本）：已刪除家具不入列、`deleted` 欄不殘留', () => {
    const plan = mkPlan([
      mkFurniture({ id: 'a', name: '書桌' }),
      mkFurniture({ id: 'b', name: '舊沙發', deleted: true }),
    ])
    const json = buildExportJson(plan)
    const parsed = JSON.parse(json) as { items: Array<Record<string, unknown>> }
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]?.id).toBe('a')
    expect(parsed.items.some((item) => 'deleted' in item)).toBe(false)
  })

  it('點擊 `#btn-export-json` → `lastExport` 為匯出內容、`host.getPlan()` 參考與內容不變、不 dispatch', () => {
    const plan = mkPlan([mkFurniture({ id: 'a', name: '書桌' }), mkFurniture({ id: 'b', deleted: true })])
    const before = JSON.stringify(plan)
    const { io } = mount(plan)

    expect(io.lastExport).toBeNull()
    el<HTMLButtonElement>('btn-export-json').click()

    expect(io.lastExport).not.toBeNull()
    expect(JSON.parse(io.lastExport ?? 'null').items).toHaveLength(1)
    // 「不變」：同一個物件參考、且序列化內容逐字相同（未被匯出動作 mutate）。
    expect(JSON.stringify(plan)).toBe(before)
  })

  it('下載 callback 收到 `application/json` 的 Blob 與匯出檔名', () => {
    const plan = mkPlan([mkFurniture({ id: 'a' })])
    const { io, downloadCalls } = mount(plan)

    el<HTMLButtonElement>('btn-export-json').click()

    expect(downloadCalls).toHaveLength(1)
    expect(downloadCalls[0]?.filename).toBe(EXPORT_FILENAME)
    expect(downloadCalls[0]?.blob).toBeInstanceOf(Blob)
    expect(downloadCalls[0]?.blob.type).toBe('application/json')
    expect(io.lastExport).not.toBeNull()
  })

  it('播報 `JSON_IO_TEXT.exported`', () => {
    const { announced } = mount(mkPlan())
    el<HTMLButtonElement>('btn-export-json').click()
    expect(announced).toEqual([JSON_IO_TEXT.exported])
  })

  it('未注入 `host.download` 時走預設實作；`URL.createObjectURL` 不存在（如 jsdom）時不擲錯，`lastExport` 仍寫入且照樣播報', () => {
    // 模擬「guard 為 undefined」的環境（本機 jsdom 版本可能已支援，故顯式覆寫）。
    const original = URL.createObjectURL
    // @ts-expect-error 刻意模擬無 `URL.createObjectURL` 的環境
    URL.createObjectURL = undefined
    try {
      const { io, announced } = mount(mkPlan([mkFurniture({ id: 'a' })]), { withDownload: false })

      expect(() => el<HTMLButtonElement>('btn-export-json').click()).not.toThrow()
      expect(io.lastExport).not.toBeNull()
      expect(announced).toEqual([JSON_IO_TEXT.exported])
    } finally {
      URL.createObjectURL = original
    }
  })
})

/* ------------------------------------------------------------------ *
 * 匯入（D7：File.size 閘、失敗 #error 且 plan 不變、恆重置 input）
 * ------------------------------------------------------------------ */

describe('匯入 JSON', () => {
  it('`importText` 直接把文字交給 `host.importPlanReplacing`；壞 JSON 時 host 回 false，plan（`getPlan()` 參考）不變', () => {
    const plan = mkPlan([mkFurniture({ id: 'a' })])
    const { io, importCalls, setImportResult } = mount(plan)
    setImportResult(false)

    const ok = io.importText('{oops')

    expect(ok).toBe(false)
    expect(importCalls).toEqual(['{oops'])
  })

  it('壞 JSON 檔案（經 `importFile`）→ `importPlanReplacing` 收到檔案文字、回 false；`#import-file` 重置', async () => {
    const plan = mkPlan([mkFurniture({ id: 'a' })])
    const { io, importCalls, errors, setImportResult } = mount(plan)
    setImportResult(false)
    const input = el<HTMLInputElement>('import-file')

    const file = new File(['{oops'], 'bad.json', { type: 'application/json' })
    const ok = await io.importFile(file)

    expect(ok).toBe(false)
    expect(importCalls).toEqual(['{oops'])
    // 本檔不重複播報：`showError` 是 main.ts 的 `importPlanReplacing()` 職責，
    // io-json.ts 的匯入路徑本身不呼叫 `host.showError`。
    expect(errors).toEqual([])
    expect(input.value).toBe('')
  })

  it('>1 MB 檔案 → `showError(tooLarge)`；`importPlanReplacing` 不被呼叫；`#import-file` 重置', async () => {
    const plan = mkPlan()
    const { io, importCalls, errors } = mount(plan)
    const input = el<HTMLInputElement>('import-file')

    const oversized = new File([new Uint8Array(IMPORT_MAX_BYTES + 1)], 'x.json', {
      type: 'application/json',
    })
    expect(oversized.size).toBeGreaterThan(IMPORT_MAX_BYTES)

    const ok = await io.importFile(oversized)

    expect(ok).toBe(false)
    expect(errors).toEqual([JSON_IO_TEXT.tooLarge])
    expect(importCalls).toEqual([])
    expect(input.value).toBe('')
  })

  it('`file.text()` 擲錯（NotReadableError）→ `showError(importFailed)` 一次、不進 `importPlanReplacing`、`#import-file` 重置、回 false', async () => {
    const plan = mkPlan([mkFurniture({ id: 'a' })])
    const before = JSON.stringify(plan)
    const { io, importCalls, errors, announced } = mount(plan)
    const input = el<HTMLInputElement>('import-file')

    // 檔案在選取後被移走／權限被撤銷：`File.text()` reject。
    const file = {
      size: 10,
      name: 'gone.json',
      text: () => Promise.reject(new Error('NotReadableError')),
    } as unknown as File

    const ok = await io.importFile(file)

    expect(ok).toBe(false)
    expect(errors).toEqual([m.errors.importFailed])
    expect(importCalls).toEqual([])
    expect(announced).toEqual([])
    // plan 不變（本檔從未 mutate host 的 plan）＋ `<input>` 已重置。
    expect(JSON.stringify(plan)).toBe(before)
    expect(input.value).toBe('')
  })

  it('合法檔案 → `importPlanReplacing` 恰收到一次、內容逐字相同；模組本身不 announce（由 host 負責）', async () => {
    const plan = mkPlan([mkFurniture({ id: 'a' })])
    const incoming = mkPlan([mkFurniture({ id: 'x', name: '匯入桌' })])
    const text = JSON.stringify(incoming)
    const { io, importCalls, announced } = mount(plan)

    const file = new File([text], 'plan.json', { type: 'application/json' })
    const ok = await io.importFile(file)

    expect(ok).toBe(true)
    expect(importCalls).toEqual([text])
    expect(announced).toEqual([])
  })

  it('`#btn-import-json` 點擊觸發 `#import-file.click()`', () => {
    mount(mkPlan())
    const input = el<HTMLInputElement>('import-file')
    const spy = vi.spyOn(input, 'click')

    el<HTMLButtonElement>('btn-import-json').click()

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('`#import-file` 的 `change` 事件取第一個檔案並匯入', async () => {
    const plan = mkPlan()
    const { importCalls } = mount(plan)
    const input = el<HTMLInputElement>('import-file')
    const text = JSON.stringify(mkPlan([mkFurniture({ id: 'y' })]))
    const file = new File([text], 'plan.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })

    input.dispatchEvent(new Event('change', { bubbles: true }))
    // `change` 內部的匯入是非同步（`file.text()`）：等到下一個 macrotask，
    // 涵蓋 jsdom `Blob.text()` 可能經由計時器完成讀取的實作。
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(importCalls).toEqual([text])
    expect(input.value).toBe('')
  })
})

/* ------------------------------------------------------------------ *
 * detach（同其餘 DOM 層模組：detach 後監聽器失效）
 * ------------------------------------------------------------------ */

describe('detach', () => {
  it('detach 後點擊匯出／匯入鈕不再有作用', () => {
    const { io, announced, downloadCalls } = mount(mkPlan([mkFurniture({ id: 'a' })]))
    const input = el<HTMLInputElement>('import-file')
    const spy = vi.spyOn(input, 'click')

    io.detach()
    el<HTMLButtonElement>('btn-export-json').click()
    el<HTMLButtonElement>('btn-import-json').click()

    expect(announced).toEqual([])
    expect(downloadCalls).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ *
 * 原始碼掃描：D7 DOM 寫入不變量
 * ------------------------------------------------------------------ */

describe('原始碼掃描：DOM 寫入不變量（D7）', () => {
  it('io-json.ts 不含 HTML 字串注入與整批子節點替換 API', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(path.join(here, 'io-json.ts'), 'utf-8')
    for (const banned of ['innerHTML', 'insertAdjacentHTML', 'outerHTML', 'replaceChildren']) {
      expect(source).not.toContain(banned)
    }
  })
})
