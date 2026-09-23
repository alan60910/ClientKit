// @vitest-environment jsdom
/**
 * T4.2（(internal design doc) §D4 A-2／A-3；TASKS.md
 * T4.2）：產出腳本收斂為單一「產出腳本」鈕（`#output-dialog-open`）開啟
 * 原生 `<dialog id="output-dialog">`（stacked 三區塊，不做分頁）。焦點
 * 管理為**顯式**——開＝聚焦 dialog 內第一個可聚焦元素、關＝顯式還原焦點
 * 至「產出腳本」鈕，不依賴瀏覽器原生 showModal／自動焦點還原演算法。
 *
 * jsdom（見 node_modules/jsdom/lib/jsdom/living/nodes/HTMLDialogElement-
 * impl.js）僅實作 `open` IDL 屬性、**未**實作 `showModal()`／`close()`／
 * `close`／`cancel` 事件——main.ts 的 `openOutputDialog`／
 * `closeOutputDialog` 皆以 `typeof el.showModal/close === 'function'`
 * 特徵偵測 fallback（僅切 `open` 屬性＋手動派送 `close` 事件），故本檔
 * 測試路徑走的正是 fallback 分支；真實瀏覽器下 showModal／原生 close 事件
 * 走同一段 `close` 監聽器（見 main.ts `wireOutputDialog` 文件），行為一致。
 *
 * 回歸網比照既有 preview-band.dom.test.ts 的「先以 jsdom 剖析真實
 * index.html 取得 <body>、動態 import main.ts 觸發其 init()」全頁面整合
 * 測試形（見該檔檔頭說明，不重複抄錄）。本檔各 `it` 皆會開關 dialog／
 * 搬移焦點，彼此互相隔離較安全，故採 `beforeEach` 每案重新 boot（非既有
 * 部分 dom.test 慣用的 `beforeAll`）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const HTML_PATH = path.resolve(DIR, 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

const STYLE_CSS = readFileSync(path.resolve(DIR, 'style.css'), 'utf-8')

/**
 * 取 style.css 原始文字中，選擇器第一次出現處對應的規則區塊內文（不含大
 * 括號、假設無巢狀大括號）——同 layout-columns.dom.test.ts 既有慣例（該
 * 檔檔頭已載明 jsdom 不套外部 stylesheet、樣式規則以原始文字比對之緣由，
 * 不重複抄錄）。
 */
function firstRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (match === null) throw new Error(`style.css 找不到符合 ${selectorPattern} 的規則`)
  const openIndex = css.indexOf('{', match.index)
  const closeIndex = css.indexOf('}', openIndex)
  return css.slice(openIndex + 1, closeIndex)
}

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（同既有 dom.test 慣例）。 */
async function boot(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

function openBtn(): HTMLButtonElement {
  return document.getElementById('output-dialog-open') as HTMLButtonElement
}

function closeBtn(): HTMLButtonElement {
  return document.getElementById('output-dialog-close') as HTMLButtonElement
}

function dialogEl(): HTMLDialogElement {
  return document.getElementById('output-dialog') as HTMLDialogElement
}

describe('T4.2 產出 dialog：開啟＋焦點管理', () => {
  beforeEach(async () => {
    await boot()
  })

  it('click 產出鈕 → dialog 具 open 屬性（jsdom 無 showModal，走 main.ts 特徵偵測 fallback）', () => {
    expect(dialogEl().hasAttribute('open')).toBe(false)
    openBtn().click()
    expect(dialogEl().hasAttribute('open')).toBe(true)
  })

  it('click 產出鈕 → 焦點顯式落於 dialog 內第一個可聚焦元素（DOM 序最前之 bash 複製鈕）', () => {
    openBtn().click()
    // bash output-block 為 dialog 內第一個區塊，其複製鈕先於下載連結
    // （下載連結雖有 href 但仍排在複製鈕之後），故為第一個可聚焦元素。
    expect(document.activeElement).toBe(document.getElementById('copy-bash'))
  })

  it('開啟時保險重算一次 refreshOutputs：settings-path 開啟前已改值，dialog 內容仍為最新', () => {
    const input = document.getElementById('settings-path') as HTMLInputElement
    input.value = '/custom/statusline.ps1'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    openBtn().click()
    const settingsCode = document.querySelector('#output-settings code')!.textContent ?? ''
    expect(settingsCode).toContain('/custom/statusline.ps1')
  })
})

describe('T4.2 產出 dialog：關閉焦點還原（統一經 close 事件，不分關閉來源）', () => {
  beforeEach(async () => {
    await boot()
  })

  it('dispatch close（模擬 Esc 原生 cancel→close）→ 焦點顯式還原至「產出腳本」鈕', () => {
    openBtn().click()
    openBtn().blur() // 確保還原斷言不是「焦點本來就沒動過」的偽陽性
    dialogEl().dispatchEvent(new Event('close'))
    expect(document.activeElement).toBe(openBtn())
  })

  it('點擊顯式「關閉」鈕 → dialog 關閉屬性移除＋焦點還原', () => {
    openBtn().click()
    closeBtn().click()
    expect(dialogEl().hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(openBtn())
  })

  it('backdrop click（event.target === dialog 本身）→ 關閉＋焦點還原', () => {
    openBtn().click()
    dialogEl().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(dialogEl().hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(openBtn())
  })

  it('點擊 dialog 內部子元素（非 backdrop 本身）不觸發關閉', () => {
    openBtn().click()
    document.getElementById('copy-bash')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(dialogEl().hasAttribute('open')).toBe(true)
  })
})

describe('T4.2 #output-status live region 常駐 dialog 外（守 SPEC.md:102）', () => {
  beforeEach(async () => {
    await boot()
  })

  it('#output-status 不是 #output-dialog 的子孫節點', () => {
    const status = document.getElementById('output-status')!
    expect(dialogEl().contains(status)).toBe(false)
  })

  it('無論 dialog 開或關，#output-status 沿祖先鏈皆無 hidden 屬性（常駐 a11y tree，非以 hidden/display:none 承載）', () => {
    const status = document.getElementById('output-status')!
    const assertNoHiddenAncestor = (): void => {
      let el: HTMLElement | null = status
      while (el !== null) {
        expect(el.hasAttribute('hidden')).toBe(false)
        el = el.parentElement
      }
    }
    expect(status.getAttribute('role')).toBe('status')
    assertNoHiddenAncestor() // dialog 關閉狀態
    openBtn().click()
    assertNoHiddenAncestor() // dialog 開啟狀態
  })

  it('複製操作播報仍寫入 #output-status（即使 dialog 已開啟）', async () => {
    openBtn().click()
    const status = document.getElementById('output-status')!
    expect(status.classList.contains('is-empty')).toBe(true)
    document.getElementById('copy-bash')!.click()
    // copyOutput 為 async（navigator.clipboard 於 jsdom 缺席時走 catch
    // 分支播報「複製失敗」）；多讓幾個 microtask 跑完以求穩健。
    await Promise.resolve()
    await Promise.resolve()
    expect(status.classList.contains('is-empty')).toBe(false)
    expect(status.textContent).toBeTruthy()
  })
})

describe('T4.2 #settings-path 仍在左側 config 區（不入 dialog）', () => {
  beforeEach(async () => {
    await boot()
  })

  it('#settings-path 不是 #output-dialog 的子孫節點', () => {
    const input = document.getElementById('settings-path')!
    expect(dialogEl().contains(input)).toBe(false)
  })
})

describe('T4.2 三個 output-block 皆在 dialog 內 stacked（不分頁）＋複製/下載鈕接線', () => {
  beforeEach(async () => {
    await boot()
  })

  it('bash／ps1／settings 三個 .output-block 皆為 dialog 子孫、無 tablist 結構（stacked，非分頁）', () => {
    const blocks = dialogEl().querySelectorAll('.output-block')
    expect(blocks.length).toBe(3)
    expect(dialogEl().querySelector('[role="tablist"]')).toBeNull()
  })

  it('複製鈕接線正常（click 不拋錯）', () => {
    openBtn().click()
    expect(() => {
      ;(document.getElementById('copy-ps1') as HTMLButtonElement).click()
      ;(document.getElementById('copy-settings') as HTMLButtonElement).click()
    }).not.toThrow()
  })

  it('下載連結接線正常：三份皆為 blob URL（.ps1 BOM byte-exact 斷言沿既有案，見 emit-ps1.test.ts；本案僅驗證接線未斷）', () => {
    openBtn().click()
    expect((document.getElementById('download-bash') as HTMLAnchorElement).href).toMatch(/^blob:/)
    expect((document.getElementById('download-ps1') as HTMLAnchorElement).href).toMatch(/^blob:/)
    expect((document.getElementById('download-settings') as HTMLAnchorElement).href).toMatch(/^blob:/)
  })
})

/**
 * sprint 12 review 裁決回退（2026-07-19，見 main.ts `UTF8_BOM` 常數
 * JSDoc）：協調者以 PS 5.1 真機探針證實，copy 通道前置 U+FEFF 於使用者
 * 依腳本頭指引「另存為 UTF-8（含 BOM）」存檔時會疊成雙 BOM，PS 5.1 將
 * 第二個 U+FEFF 黏進首 token 致執行期噴錯——故 T1.1 當時讓複製通道對齊
 * 下載 Blob（前置 BOM）的決定已回退：**複製通道刻意無 BOM**，三鈕
 * payload 皆為 `lastOutputs` 原文（下載通道 BOM 不受影響，仍見
 * emit-ps1.test.ts 既有斷言）。
 *
 * 上方「複製操作播報仍寫入 #output-status」一案（:140-151）刻意依賴
 * jsdom 原生**沒有** `navigator.clipboard`（走 `copyOutput` 的 catch 分
 * 支斷言「複製失敗」播報）。本 describe 需要 spy `navigator.clipboard.
 * writeText` 才能斷言實際傳入的 payload 內容，故逐案以
 * `Object.defineProperty` 安裝 stub、並在 `afterEach` 精確還原
 * `navigator.clipboard` 的原始 property descriptor（jsdom 原生未定義此
 * 屬性時直接 `delete`，不留下一個「值為 undefined 但屬性存在」的殘影）
 * ——避免 stub 洩漏進其他檔案／案例、改變其原本依賴「無 clipboard」的
 * 假設。
 */
describe('複製通道刻意無 BOM（回退裁決，見 UTF8_BOM 常數 JSDoc）', () => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    await boot()
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  afterEach(() => {
    if (originalClipboardDescriptor === undefined) {
      Reflect.deleteProperty(navigator, 'clipboard')
    } else {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
    }
  })

  it('click copy-ps1 → payload 無 BOM，內容與產出 ps1 全文一致', async () => {
    openBtn().click()
    document.getElementById('copy-ps1')!.click()
    // copyOutput 為 async，讓 microtask 落定（同 :140-151 既有案手法）。
    await Promise.resolve()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledTimes(1)
    const payload = writeText.mock.calls[0]?.[0] as string
    expect(payload).not.toMatch(/^\uFEFF/)
    const ps1Code = document.querySelector('#output-ps1 code')!.textContent ?? ''
    expect(payload).toBe(ps1Code)
  })

  it('click copy-bash → payload 無 BOM，內容與產出 bash 全文一致', async () => {
    openBtn().click()
    document.getElementById('copy-bash')!.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledTimes(1)
    const payload = writeText.mock.calls[0]?.[0] as string
    expect(payload).not.toMatch(/^\uFEFF/)
    const bashCode = document.querySelector('#output-bash code')!.textContent ?? ''
    expect(payload).toBe(bashCode)
  })

  it('click copy-settings → payload 無 BOM，內容與產出 settings 片段全文一致', async () => {
    openBtn().click()
    document.getElementById('copy-settings')!.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledTimes(1)
    const payload = writeText.mock.calls[0]?.[0] as string
    expect(payload).not.toMatch(/^\uFEFF/)
    const settingsCode = document.querySelector('#output-settings code')!.textContent ?? ''
    expect(payload).toBe(settingsCode)
  })

  it('writeText 拒絕 → copy-ps1 播報「複製失敗」落於 #output-status（工作項 3）', async () => {
    writeText.mockRejectedValue(new Error('x'))
    openBtn().click()
    const status = document.getElementById('output-status')!
    expect(status.classList.contains('is-empty')).toBe(true)
    document.getElementById('copy-ps1')!.click()
    // copyOutput 為 async，讓 microtask（含 catch 分支）落定（同上既有案手法）。
    await Promise.resolve()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(status.classList.contains('is-empty')).toBe(false)
    expect(status.textContent).toContain('複製失敗')
  })
})

/**
 * T2.4（(internal design doc) §D3；TASKS.md T2.4）：dialog
 * 尺寸公式定案——`width: min(90vw, max(640px, 55vw), 72rem)`＋
 * `max-height: min(85dvh, 60rem)`。72rem 上限僅約束超寬幕（3440px 下
 * 1892px→1152px）；一般桌面（≤2094px）行為與純 55vw 式相同；行動版
 * 90vw 仍主導（600px 視窗→540px，與前一版 `min(90vw, 640px)` 同值）。
 * dvh（非 vh、非 svh）——與既有頂帶 40dvh 精度一致（見 PLAN §D3
 * tradeoff 說明）。jsdom 不套外部 stylesheet，故沿 layout-columns.dom.
 * test.ts 既有慣例改讀 style.css 原始文字比對規則區塊。
 */
describe('T2.4 dialog 尺寸公式（style.css 原始文字檢核）', () => {
  it('dialog.output-dialog 帶 width: min(90vw, max(640px, 55vw), 72rem)（公式全文比對）', () => {
    const block = firstRuleBlock(STYLE_CSS, /dialog\.output-dialog\s*\{/)
    expect(block).toMatch(/width:\s*min\(90vw,\s*max\(640px,\s*55vw\),\s*72rem\)/)
  })

  it('dialog.output-dialog 帶 max-height: min(85dvh, 60rem)（公式全文比對；dvh 非 vh／svh）', () => {
    const block = firstRuleBlock(STYLE_CSS, /dialog\.output-dialog\s*\{/)
    expect(block).toMatch(/max-height:\s*min\(85dvh,\s*60rem\)/)
    expect(block).not.toMatch(/max-height:\s*min\(85vh/)
  })
})
