// @vitest-environment jsdom
/**
 * T3.1（(internal design doc) §D4；TASKS.md T3.1，回饋
 * #4「點 mode 跳走」根治）：`handleModeChange` 曾於切換 mode 後把焦點
 * 強奪至 `.segment-lists`（`setAttribute('tabindex','-1')`＋`.focus()`），
 * 使觸發用的 radio 失焦、頁面視覺跳動。本任務刪除該兩行——radio 保持
 * 瀏覽器原生 click 焦點（零跳動），SR 回饋改由既有 `announceGlobal`
 * （`#global-live-status` live region）承擔，訊息本就含模式名＋連帶
 * fgOverride 停用清單（見 handleModeChange 本體）。
 *
 * 斷言分層（PLAN §D4）：jsdom 的 `Element.scrollIntoView`／捲動為
 * no-op，「無 scroll 呼叫」本身空洞、不具偵錯力——本檔僅做三項有效
 * dom 層斷言：(1) 正向 `document.activeElement` 仍為觸發用的 radio；
 * (2) 具名 spy `vi.spyOn(segmentListsEl, 'focus')` 全程未被呼叫；(3)
 * live region 播報訊息含切換後的模式名。jsdom 的 `HTMLElement.click()`
 * 本身不模擬瀏覽器原生「點擊表單控件即聚焦」副作用（見下方 `clickAndFocus`
 * 說明），故各案先顯式 `.focus()`，模擬使用者以滑鼠/鍵盤操作 radio 後
 * 瀏覽器賦予的焦點——藉此驗證「本次修法沒有再把它奪走」。e2e 層的
 * `window.scrollY` 前後不變斷言屬 M4，本檔不涵蓋。
 *
 * 回歸網比照既有 bar-toggle.dom.test.ts／skip-nav.dom.test.ts 的「先以
 * jsdom 剖析真實 index.html 取得 <body>、動態 import main.ts 觸發其
 * init()」全頁面整合測試形（見該二檔檔頭說明，不重複抄錄）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HTML_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（同既有 dom.test 慣例）。 */
async function boot(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

function modePlainRadio(): HTMLInputElement {
  return document.getElementById('mode-plain') as HTMLInputElement
}

function modePowerlineRadio(): HTMLInputElement {
  return document.getElementById('mode-powerline') as HTMLInputElement
}

/** main.ts 內部無 id、以 class 取得的 segment 清單容器——舊焦點移轉目標（本任務刪除該行為的 spy 對象）。 */
function segmentListsEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.segment-lists')
  if (el === null) throw new Error('missing .segment-lists')
  return el
}

function liveStatus(): string {
  return document.getElementById('global-live-status')!.textContent ?? ''
}

/**
 * 模擬瀏覽器原生「點擊表單控件即聚焦」副作用——jsdom 的 `click()` 本身
 * 不移動焦點（僅觸發 change/click 事件），故顯式呼叫 `.focus()` 還原
 * 真實使用者情境，讓斷言（1）具備意義（否則 activeElement 恆為
 * document.body，斷言空洞通過）。
 */
function clickAndFocus(radio: HTMLInputElement): void {
  radio.focus()
  radio.click()
}

describe('T3.1（D4）mode 切換焦點：radio 保焦，不奪焦至 segment-lists', () => {
  beforeEach(async () => {
    await boot()
  })

  it('切至 powerline：document.activeElement 為觸發用的 radio 本身（非 segment-lists）', () => {
    const radio = modePowerlineRadio()
    clickAndFocus(radio)
    expect(document.activeElement).toBe(radio)
  })

  it('切至 powerline：segmentListsEl.focus 全程未被呼叫（具名 spy）', () => {
    const focusSpy = vi.spyOn(segmentListsEl(), 'focus')
    clickAndFocus(modePowerlineRadio())
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('切至 powerline：live region 播報訊息含模式名「Powerline」', () => {
    clickAndFocus(modePowerlineRadio())
    expect(liveStatus()).toContain('已切換至 Powerline 模式')
  })

  it('切回 plain：document.activeElement 為觸發用的 radio 本身（非 segment-lists）', () => {
    clickAndFocus(modePowerlineRadio()) // 先切至 powerline，才有「切回」可測。
    const radio = modePlainRadio()
    clickAndFocus(radio)
    expect(document.activeElement).toBe(radio)
  })

  it('切回 plain：segmentListsEl.focus 全程未被呼叫（具名 spy）', () => {
    clickAndFocus(modePowerlineRadio())
    const focusSpy = vi.spyOn(segmentListsEl(), 'focus')
    clickAndFocus(modePlainRadio())
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('切回 plain：live region 播報訊息含模式名「純文字」', () => {
    clickAndFocus(modePowerlineRadio())
    clickAndFocus(modePlainRadio())
    expect(liveStatus()).toContain('已切換至純文字模式')
  })

  it('segmentListsEl 不再殘留 tabindex="-1"（本任務刪除的舊行為副作用一併消失，非僅 focus 呼叫本身）', () => {
    clickAndFocus(modePowerlineRadio())
    expect(segmentListsEl().hasAttribute('tabindex')).toBe(false)
  })
})
