// @vitest-environment jsdom
/**
 * T2.5（(internal design doc) §D1-B′；TASKS.md T2.5；S3/S4
 * 選型定案，見 spikes/S3-RESULT.md／S4-RESULT.md）：上/下移鈕「收納／
 * 浮現」——
 *
 * - 視覺收納（style.css `.segment-row__move`）：`opacity:0 +
 *   pointer-events:none`（S3 實測零版面躍動、收納鈕點擊原位置 no-op、
 *   留 Tab 序）。
 * - 浮現機制＝**JS 模態旗標**（main.ts `wireMoveRevealModality`）＋
 *   `.row--reveal` class（`.segment-row.row--reveal .segment-row__move`）
 *   ——document 層 mousedown/pointerdown→旗標=滑鼠、keydown→旗標=鍵盤，
 *   focusin 落在段列（`.segment-row`）內任一控件時依旗標切該列
 *   `.row--reveal`。純 CSS `:has(:focus-visible)` 經 S3 於 Chromium 實測
 *   有兩處滑鼠模態破口（select 滑鼠點擊即 focus-visible；列內 prefix
 *   文字輸入任何 focus 皆 focus-visible）而棄用——S4 確認 jsdom
 *   `:focus-visible` 對 select 的判定與真機**相反**（會假綠），故本檔
 *   一律走 JS 旗標＋classList 斷言路徑（S4 定層：dom 可證）。
 *
 * 本檔涵蓋（依 task brief 五類）：
 * (1) 預設收納：style.css 原始文字比對收納/浮現規則區塊＋未聚焦列無
 *     `.row--reveal`。
 * (2) 鍵盤模態浮現：`keydown(Tab)` → `focusin` → `.row--reveal`。
 * (3) 常駐回歸案「滑鼠點擊列內控件不加 reveal class」：逐控件類別
 *     （button／checkbox／select／prefix 文字輸入）。
 * (4) move 重渲染＋程式化還焦後 `.row--reveal` 延續（旗標式免疫，S3
 *     (d)）。
 * (5) 旗標切換序：滑鼠後再鍵盤 → 浮現恢復。
 *
 * 既有 move 鈕行為斷言（moveSegment 語意）：本 repo 既有 dom 測試網未有
 * 直接點擊 move-up/move-down 鈕之行為案（僅間接經 #segment-move-status
 * 文字覆蓋於 catalog-drag/bar-toggle 等檔），故本檔案 (4) 之描述順帶
 * 補上「move-up 點擊觸發真實 moveSegment→同列交換→還焦」的行為斷言
 * （見該 describe 區塊）。
 *
 * 沿用既有 dom.test 慣例（見 bar-toggle.dom.test.ts／defer-enable.dom.
 * test.ts 檔頭）：先以 jsdom 剖析真實 index.html 取得 `<body>`，灌
 * localStorage 種子，動態 import main.ts 觸發其 init()。style.css 原始
 * 文字比對手法沿用 layout-columns.dom.test.ts（jsdom 不套用外部
 * stylesheet，getComputedStyle 不可靠——P1 spike 已證，見 S4-RESULT.md）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const HTML_PATH = path.resolve(DIR, 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

const STYLE_CSS = readFileSync(path.resolve(DIR, 'style.css'), 'utf-8')

// main.ts 主設定 localStorage 鍵——經無副作用常數模組 config-storage-key.ts
// 單一出口匯入（同 bar-toggle.dom.test.ts 慣例）。
import { STORAGE_KEY } from './config-storage-key.js'

/** 單段種子（row 0，僅此一段——move 鈕本身首末皆是，皆 disabled，不影響本檔聚焦的收納/浮現態）。 */
const SINGLE_SEGMENT_SEED = {
  version: 2,
  mode: 'plain',
  separator: { kind: 'preset', value: '|' },
  lastArrowCap: true,
  powerlineArrow: false,
  segments: [{ id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 0 }],
}

/** 雙段同列種子（row 0：model idx0／git-branch idx1）——供 (4) 案觸發真實 moveSegment 同列交換。 */
const TWO_SEGMENT_SAME_ROW_SEED = {
  version: 2,
  mode: 'plain',
  separator: { kind: 'preset', value: '|' },
  lastArrowCap: true,
  powerlineArrow: false,
  segments: [
    { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
    { id: 'git-branch', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
  ],
}

/** 清空 localStorage、灌入種子存檔、重灌乾淨 DOM＋重置模組快取後啟動 main.ts（同既有 dom.test 慣例）。 */
async function boot(seed: typeof SINGLE_SEGMENT_SEED): Promise<void> {
  localStorage.clear()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.segment-row[data-segment-id="${id}"]`)
  if (el === null) throw new Error(`missing segment row for ${id}`)
  return el
}

function isRevealed(id: string): boolean {
  return row(id).classList.contains('row--reveal')
}

/** 取左欄目錄項的啟停 checkbox（唯一啟停入口，見 main.ts buildCatalogItem 文件）。 */
function catalogCheckbox(id: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`.catalog-item[data-segment-id="${id}"] .catalog-item__checkbox`)
  if (el === null) throw new Error(`missing catalog checkbox for ${id}`)
  return el
}

/** 勾選/取消勾選目錄 checkbox 並派發 change（同 main.ts checkbox.addEventListener('change', ...) 觸發手法）。 */
function toggleCatalogCheckbox(id: string, checked: boolean): void {
  const checkbox = catalogCheckbox(id)
  checkbox.checked = checked
  checkbox.dispatchEvent(new Event('change', { bubbles: true }))
}

/** 取 style.css 原始文字中，選擇器第一次出現處對應的規則區塊內文（不含大括號、假設無巢狀大括號，同 layout-columns.dom.test.ts 慣例）。 */
function firstRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (match === null) throw new Error(`style.css 找不到符合 ${selectorPattern} 的規則`)
  const openIndex = css.indexOf('{', match.index)
  const closeIndex = css.indexOf('}', openIndex)
  return css.slice(openIndex + 1, closeIndex)
}

/** 模擬使用者滑鼠按下（不含 click——本檔僅需模態旗標判定，見 wireMoveRevealModality 文件）。 */
function dispatchMousedown(el: Element): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}

/** 模擬使用者鍵盤導覽起手（document 層 keydown，見 wireMoveRevealModality 模態判定）。 */
function dispatchTabKeydown(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
}

describe('T2.5 style.css 原始文字檢核：move 鈕群收納/浮現規則（S3 選型定案）', () => {
  it('.segment-row__move 規則區塊含 opacity:0／pointer-events:none（預設收納，零版面躍動、留 Tab 序）', () => {
    const block = firstRuleBlock(STYLE_CSS, /(?:^|\n)\.segment-row__move\s*\{/)
    expect(block).toMatch(/opacity:\s*0\b/)
    expect(block).toMatch(/pointer-events:\s*none\b/)
  })

  it('.segment-row.row--reveal .segment-row__move 規則區塊含 opacity:1／pointer-events:auto（浮現態）', () => {
    const block = firstRuleBlock(STYLE_CSS, /\.segment-row\.row--reveal\s+\.segment-row__move\s*\{/)
    expect(block).toMatch(/opacity:\s*1\b/)
    expect(block).toMatch(/pointer-events:\s*auto\b/)
  })
})

describe('T2.5 (1) 預設收納：初始渲染（未聚焦）無 .row--reveal', () => {
  beforeEach(async () => {
    await boot(SINGLE_SEGMENT_SEED)
  })

  it('剛開機、尚無任何 focus 事件：段列無 .row--reveal', () => {
    expect(isRevealed('model')).toBe(false)
  })
})

describe('T2.5 (2) 鍵盤模態浮現：keydown(Tab) → focusin → .row--reveal', () => {
  beforeEach(async () => {
    await boot(SINGLE_SEGMENT_SEED)
  })

  it('document 層 keydown(Tab) 後，focusin 落在列內任一控件（icon 勾選框）→ 該列加上 .row--reveal', () => {
    dispatchTabKeydown()
    const iconCheckbox = row('model').querySelector<HTMLInputElement>('.segment-row__icon')!
    iconCheckbox.focus()
    expect(isRevealed('model')).toBe(true)
  })

  it('Tab 直達收納鈕本身（非其他控件）：remove 鈕（恆顯、與收納態正交）focus 亦令其所屬列浮現', () => {
    dispatchTabKeydown()
    const removeBtn = row('model').querySelector<HTMLButtonElement>('.segment-row__remove')!
    removeBtn.focus()
    expect(isRevealed('model')).toBe(true)
  })
})

describe('T2.5 (2b) 鍵盤模態浮現——鈕本身（收納態下亦可 Tab 直達，S3「留 Tab 序」保證）', () => {
  beforeEach(async () => {
    await boot(TWO_SEGMENT_SAME_ROW_SEED)
  })

  it('Tab 直達收納中的 move-up 鈕本身（git-branch，未 disabled）：focus 令其所屬列浮現', () => {
    dispatchTabKeydown()
    const moveUp = row('git-branch').querySelector<HTMLButtonElement>('.segment-row__move-up')!
    expect(moveUp.disabled).toBe(false)
    moveUp.focus()
    expect(isRevealed('git-branch')).toBe(true)
  })

  it('Tab 直達收納中的 move-down 鈕本身（model，未 disabled）：focus 令其所屬列浮現', () => {
    dispatchTabKeydown()
    const moveDown = row('model').querySelector<HTMLButtonElement>('.segment-row__move-down')!
    expect(moveDown.disabled).toBe(false)
    moveDown.focus()
    expect(isRevealed('model')).toBe(true)
  })
})

describe('T2.5 (3) 常駐回歸：滑鼠點擊列內控件不加 .row--reveal（逐控件類別）', () => {
  beforeEach(async () => {
    await boot(SINGLE_SEGMENT_SEED)
  })

  it('button（remove 鈕）：mousedown → focusin → 無 .row--reveal', () => {
    const removeBtn = row('model').querySelector<HTMLButtonElement>('.segment-row__remove')!
    dispatchMousedown(removeBtn)
    removeBtn.focus()
    expect(isRevealed('model')).toBe(false)
  })

  it('checkbox（顯示文字 icon 勾選框）：mousedown → focusin → 無 .row--reveal', () => {
    const iconCheckbox = row('model').querySelector<HTMLInputElement>('.segment-row__icon')!
    dispatchMousedown(iconCheckbox)
    iconCheckbox.focus()
    expect(isRevealed('model')).toBe(false)
  })

  it('select（「顯示於第 N 列」select）：mousedown → focusin → 無 .row--reveal（S3 實錘破口：純 CSS :has(:focus-visible) 下此類會誤浮現，見 S3-RESULT.md D1 選型結論）', () => {
    const rowSelect = row('model').querySelector<HTMLSelectElement>('.segment-row__row-select')!
    dispatchMousedown(rowSelect)
    rowSelect.focus()
    expect(isRevealed('model')).toBe(false)
  })

  it('prefix 文字輸入：mousedown → focusin → 無 .row--reveal（S3 實錘第二破口：文字輸入任何 focus 皆 focus-visible）', () => {
    const prefixInput = row('model').querySelector<HTMLInputElement>('.segment-row__prefix')!
    dispatchMousedown(prefixInput)
    prefixInput.focus()
    expect(isRevealed('model')).toBe(false)
  })
})

describe('T2.5 (5) 旗標切換序：滑鼠後再鍵盤 → 浮現恢復', () => {
  beforeEach(async () => {
    await boot(SINGLE_SEGMENT_SEED)
  })

  it('mousedown+focusin（不浮現）後，同列內 keydown(Tab)+focusin 另一控件 → 浮現恢復', () => {
    const rowSelect = row('model').querySelector<HTMLSelectElement>('.segment-row__row-select')!
    dispatchMousedown(rowSelect)
    rowSelect.focus()
    expect(isRevealed('model')).toBe(false)

    dispatchTabKeydown()
    const prefixInput = row('model').querySelector<HTMLInputElement>('.segment-row__prefix')!
    prefixInput.focus()
    expect(isRevealed('model')).toBe(true)
  })
})

describe('T2.5 (4) move 重渲染＋程式化還焦後 .row--reveal 延續（既有 moveSegment 行為斷言：同列交換＋還焦落於反方向鈕）', () => {
  beforeEach(async () => {
    await boot(TWO_SEGMENT_SAME_ROW_SEED)
  })

  it('鍵盤浮現 git-branch 列 → 點 move-up（觸發真實 moveSegment：同列與 model 交換，git-branch 移至列首）→ 重渲染後程式化還焦落於 move-down 鈕（列首邊界修正）、節點重用、.row--reveal 延續', () => {
    dispatchTabKeydown()
    const gitBranchRow = row('git-branch')
    const moveUp = gitBranchRow.querySelector<HTMLButtonElement>('.segment-row__move-up')!
    moveUp.focus()
    expect(isRevealed('git-branch')).toBe(true)
    // 前置條件：git-branch 為列內第 2 段（idx1），up 鈕未 disabled。
    expect(moveUp.disabled).toBe(false)

    moveUp.click()

    // 既有 moveSegment 行為：git-branch 移至列首，up 鈕隨之 disabled、
    // down 鈕維持 enabled（refreshMoveButtonStates，見 main.ts 文件）。
    expect(moveUp.disabled).toBe(true)
    const moveDown = gitBranchRow.querySelector<HTMLButtonElement>('.segment-row__move-down')!
    expect(moveDown.disabled).toBe(false)
    // 節點重用：layoutSegmentContainers 以 appendChild 重新定位既有
    // <li>，不銷毀重建——row('git-branch') 查詢應仍是同一節點。
    expect(row('git-branch')).toBe(gitBranchRow)
    // 邊界修正（main.ts moveSegment 文件）：觸發鈕（move-up）落列首邊界
    // 後改回焦反方向鈕（move-down）。
    expect(document.activeElement).toBe(moveDown)
    // 旗標式免疫（S3 (d) 實測）：整段同步流程未曾發生 mousedown/
    // pointerdown，旗標仍為鍵盤——浮現態延續。
    expect(isRevealed('git-branch')).toBe(true)
  })
})

/**
 * MAGI review 🟡-3（協調者實證確認）：`assignSegmentsToContainers`
 * （main.ts）把停用段 `appendChild` 進 `#segment-hidden-pool` 屬純節點
 * 重定位（搬移不觸發 focusout），若該列先前在鍵盤模態下浮現過，
 * `.row--reveal` 會殘留在節點上、隨停用/重新啟用的往返一併搬回列——
 * 重新啟用的列因此會在**無焦點**的情況下浮現，違反 SPEC「預設收納」。
 * 本案：鍵盤模態下 focus 列內控件（列浮現）→ 停用該段（catalog
 * checkbox 取消勾選，觸發 assignSegmentsToContainers 入池）→ 重新啟用
 * → 斷言該列無 `.row--reveal`。
 */
describe('T2.5 (6) 隱藏池往返殘留（MAGI review 🟡-3）：停用/重新啟用後 .row--reveal 不殘留', () => {
  beforeEach(async () => {
    await boot(SINGLE_SEGMENT_SEED)
  })

  it('鍵盤浮現 model 列 → 取消勾選停用（入隱藏池）→ 重新勾選啟用 → 該列無 .row--reveal（無焦點卻浮現的殘留缺陷已修）', () => {
    dispatchTabKeydown()
    const iconCheckbox = row('model').querySelector<HTMLInputElement>('.segment-row__icon')!
    iconCheckbox.focus()
    expect(isRevealed('model')).toBe(true)

    toggleCatalogCheckbox('model', false)
    toggleCatalogCheckbox('model', true)

    expect(isRevealed('model')).toBe(false)
  })
})
