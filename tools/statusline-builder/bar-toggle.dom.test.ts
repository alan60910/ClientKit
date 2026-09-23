// @vitest-environment jsdom
/**
 * T5.1（(internal design doc) §5）：main.ts 左欄
 * 「已選擇」列的長條圖（bar）checkbox（百分比段限定顯示）／切開時預設
 * 閾值模板寫入或既有自訂桶保留／powerline 模式下 bar 段 fgOverride
 * 停用——三處提示皆經常駐 `#global-live-status` live region 播報，本檔
 * 為其回歸網。
 *
 * main.ts 全模組頂層即執行 DOM 查詢與 `init()`（見其檔尾 readyState
 * 守衛——jsdom 環境內建立的 `document.readyState` 於 import 當下已是
 * `'complete'`，故 import 即同步觸發 init()，非等 DOMContentLoaded），
 * 故無法像 render-preview.ts 等純函式模組單獨匯入個別 export 測試——
 * main.ts 本身不匯出任何符號。本檔沿用「先以 jsdom 剖析真實 index.html
 * 取得 `<body>` 內容灌入測試環境 document，再動態 import 觸發其自然完
 * 成 init()」的全頁面整合測試形（本專案首次直接測 main.ts；既有
 * render-preview.dom.test.ts／jsdom-smoke.test.ts 僅測輸出端純函式，
 * 未涵蓋 main.ts 本身的 DOM 接線邏輯）。
 *
 * 隔離：每個 describe 各自於 `beforeAll` 內 `vi.resetModules()`＋重新灌
 * 一份乾淨 body HTML＋清空 localStorage 後才 `await import('./main.js')`
 * ——取得一份全新模組實例（module-level 狀態如 `config`／各 id→元素
 * Map 不跨 describe 殘留）。describe 內的 it() 依序操作**同一份已啟動
 * 頁面**，模擬真實使用者連續互動（如「先切開 bar、再切到 powerline」）
 * ——刻意非彼此獨立的單元，執行序不可打亂（vitest 同檔案內 it() 依撰寫
 * 序執行）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// 直接讀真實 tools/statusline-builder/index.html 取其 <body>…</body> 原始
// 字串作為每次 boot 的乾淨骨架——單一事實來源，DOM 契約變動時本檔自動
// 跟進，不需重複維護一份手抄 fixture。以字串切片（非另建 jsdom.JSDOM
// 實例剖析）：'jsdom' 套件無型別宣告（@types/jsdom 未裝、非 In-scope
// 依賴變動），且此處僅需原始 HTML 文字餵給下方 `document.body.innerHTML`
// （由 vitest 本檔 `@vitest-environment jsdom` 既有的全域 document 剖析
// 即可），不需要 'jsdom' 套件本身的 API。
const HTML_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

// main.ts 主設定 localStorage 鍵——經無副作用常數模組 config-storage-key.ts
// 單一出口靜態匯入（見其檔頭；main.ts 本身仍於 boot() 內動態 import）。
import { STORAGE_KEY } from './config-storage-key.js'

interface StoredSegment {
  id: string
  enabled?: boolean
  bar?: boolean
  threshold?: { buckets: unknown[] }
  fgOverride?: unknown
}

/** 讀 localStorage 存檔中某段目前狀態（main.ts 每次 commitConfig 皆 persist，見其文件）。 */
function readStoredSegment(id: string): StoredSegment | undefined {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return undefined
  const parsed = JSON.parse(raw) as { segments: StoredSegment[] }
  return parsed.segments.find((seg) => seg.id === id)
}

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（見檔頭「隔離」段）。 */
async function boot(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.segment-row[data-segment-id="${id}"]`)
  if (el === null) throw new Error(`missing segment row for ${id}`)
  return el
}

/** 模擬使用者於左欄目錄勾選啟用某段（同 setSegmentEnabled 入口）。 */
function enableSegment(id: string): void {
  const checkbox = document.getElementById(`${id}-catalog`) as HTMLInputElement | null
  if (checkbox === null) throw new Error(`missing catalog checkbox for ${id}`)
  checkbox.click()
}

/** I4 回歸：左欄取消勾選（同一 checkbox，語意反向——同 setSegmentEnabled(id, false) 入口）。 */
function disableSegment(id: string): void {
  const checkbox = document.getElementById(`${id}-catalog`) as HTMLInputElement | null
  if (checkbox === null) throw new Error(`missing catalog checkbox for ${id}`)
  if (!checkbox.checked) throw new Error(`segment ${id} is not enabled, cannot disable`)
  checkbox.click()
}

function barCheckbox(id: string): HTMLInputElement {
  const el = document.getElementById(`${id}-bar`) as HTMLInputElement | null
  if (el === null) throw new Error(`missing bar checkbox for ${id}`)
  return el
}

function templateSelectOf(id: string): HTMLSelectElement {
  const el = row(id).querySelector<HTMLSelectElement>('.threshold__template')
  if (el === null) throw new Error(`missing threshold template select for ${id}`)
  return el
}

function fgOverrideFieldset(id: string): HTMLFieldSetElement {
  const el = row(id).querySelector<HTMLFieldSetElement>('.segment-row__fg-mount .color-picker')
  if (el === null) throw new Error(`missing fg-override fieldset for ${id}`)
  return el
}

function liveStatus(): string {
  return document.getElementById('global-live-status')!.textContent ?? ''
}

/** I4c：段排序／整列刪除播報走的獨立 live region（main.ts announceMove，見其文件）。 */
function moveStatus(): string {
  return document.getElementById('segment-move-status')!.textContent ?? ''
}

/** I4c：某段目前所在列群組容器（.segment-row-group，見 index.html segment-row-group-template）。 */
function rowGroupSectionOf(id: string): HTMLElement {
  const section = row(id).closest('.segment-row-group') as HTMLElement | null
  if (section === null) throw new Error(`missing row group section for ${id}`)
  return section
}

/**
 * I4c：模擬使用者對某段所在列走「整列刪除」UI 兩段式確認流程（同
 * wireRowDeleteButton：trigger click → confirm click → performRowDeletion）。
 */
function deleteRowOf(id: string): void {
  const section = rowGroupSectionOf(id)
  const trigger = section.querySelector<HTMLButtonElement>('.segment-row-group__delete-trigger')
  if (trigger === null) throw new Error(`missing delete trigger for row containing ${id}`)
  trigger.click()
  const confirmBtn = section.querySelector<HTMLButtonElement>('.segment-row-group__delete-confirm-btn')
  if (confirmBtn === null) throw new Error(`missing delete confirm button for row containing ${id}`)
  confirmBtn.click()
}

describe('T5.1 — bar checkbox 目錄限定顯示', () => {
  beforeAll(async () => {
    await boot()
    enableSegment('cwd') // always 類（非百分比）：不應有 bar checkbox。
    enableSegment('context-used') // percentage 類：應有 bar checkbox。
  })

  it('barEligibleIds 成員段（context-used）保有 .segment-row__bar-field＋對應 checkbox', () => {
    expect(row('context-used').querySelector('.segment-row__bar-field')).not.toBeNull()
    expect(document.getElementById('context-used-bar')).not.toBeNull()
  })

  it('非 barEligibleIds 段（cwd，always 類）整組移除 .segment-row__bar-field', () => {
    expect(row('cwd').querySelector('.segment-row__bar-field')).toBeNull()
    expect(document.getElementById('cwd-bar')).toBeNull()
  })

  it('bar checkbox 初始未勾選（seg.bar 缺席，反映預設 config）', () => {
    expect(barCheckbox('context-used').checked).toBe(false)
  })
})

describe('T5.1 — bar 切開語意（預設模板寫入／自訂桶保留）＋ powerline fgOverride 停用', () => {
  beforeAll(async () => {
    await boot()
    enableSegment('context-used')
    enableSegment('context-remaining')
    enableSegment('cache-hit') // 對照組：全程 bar 保持關閉，驗證停用範圍不外溢。
    enableSegment('rate-5h') // 用於「已在 powerline 下才切開 bar」情境。
  })

  it('切開（threshold undefined）→ 寫入預設模板「限額漸層」＋同步 templateSelect.value＋播報模板寫入句', () => {
    const bar = barCheckbox('context-used')
    bar.click()
    expect(bar.checked).toBe(true)

    const stored = readStoredSegment('context-used')
    expect(stored?.bar).toBe(true)
    expect(stored?.threshold?.buckets).toHaveLength(10)
    expect(templateSelectOf('context-used').value).toBe('limit-gradient')
    expect(liveStatus()).toBe('「上下文已用」已開啟長條圖，套用預設閾值模板「限額漸層（按用量）」')
  })

  it('context-remaining 切開 → In-scope line 62-63 釘死之逆序版「剩餘漸層」（非用量版）', () => {
    const bar = barCheckbox('context-remaining')
    bar.click()
    expect(bar.checked).toBe(true)

    expect(readStoredSegment('context-remaining')?.bar).toBe(true)
    expect(templateSelectOf('context-remaining').value).toBe('remaining-gradient')
    expect(liveStatus()).toBe('「上下文剩餘」已開啟長條圖，套用預設閾值模板「剩餘漸層（逆序）」')
  })

  it('關閉不清桶；threshold 已有值時再切開 → 保留不覆寫＋播報保留句（非模板寫入句）', () => {
    const bar = barCheckbox('context-used')
    bar.click() // 關閉。
    expect(bar.checked).toBe(false)
    expect(readStoredSegment('context-used')?.threshold?.buckets).toHaveLength(10) // 桶未被清除。

    bar.click() // 再切開。
    expect(bar.checked).toBe(true)
    expect(templateSelectOf('context-used').value).toBe('limit-gradient') // 未被重寫。
    expect(liveStatus()).toBe('「上下文已用」已開啟長條圖，既有自訂閾值顏色已保留')
  })

  it('切至 powerline：bar 開啟中的段（context-used／context-remaining）fgOverride 被停用＋播報；bar 關閉的百分比段（cache-hit）不受影響', () => {
    ;(document.getElementById('mode-powerline') as HTMLInputElement).click()

    expect(fgOverrideFieldset('context-used').disabled).toBe(true)
    expect(fgOverrideFieldset('context-remaining').disabled).toBe(true)
    expect(fgOverrideFieldset('cache-hit').disabled).toBe(false) // bar===false → 範圍不外溢。

    const status = liveStatus()
    expect(status).toContain('已切換至 Powerline 模式')
    expect(status).toContain('「上下文已用」的前景覆寫色因長條圖已停用，改由主色自動決定')
    expect(status).toContain('「上下文剩餘」的前景覆寫色因長條圖已停用，改由主色自動決定')
  })

  it('已在 powerline 模式下才切開 bar（rate-5h，threshold undefined）→ 模板寫入句＋fgOverride 停用句併入同一次播報', () => {
    const bar = barCheckbox('rate-5h')
    bar.click()

    expect(fgOverrideFieldset('rate-5h').disabled).toBe(true)
    expect(liveStatus()).toBe(
      '「5 小時限額」已開啟長條圖，套用預設閾值模板「限額漸層（按用量）」；' +
        '「5 小時限額」的前景覆寫色因長條圖已停用，改由主色自動決定',
    )
  })

  it('切回 plain：fgOverride 恢復可用', () => {
    ;(document.getElementById('mode-plain') as HTMLInputElement).click()
    expect(fgOverrideFieldset('context-used').disabled).toBe(false)
    expect(fgOverrideFieldset('context-remaining').disabled).toBe(false)
    expect(fgOverrideFieldset('rate-5h').disabled).toBe(false)
  })
})

/**
 * I4 回歸（code review I4，(internal design doc)）：
 * syncFgOverrideDisabled 迴圈原缺 `seg.enabled` 閘，使「bar 開啟中但已被
 * 停用（左欄取消勾選、退隱藏池）」的段，切到 powerline 時仍被算進
 * newlyDisabledLabels——對螢幕閱讀器播報一個使用者已從清單移除的段的
 * 停用提示。修法：shouldDisable 加 `seg.enabled` 閘，比照
 * checkDuplicateResetHints 既有的 `rate.enabled && reset.enabled` 慣例。
 *
 * I4b 回歸（協調者續 T7.4，2026-07-15）：上述 `seg.enabled` 閘的自然副
 * 作用——`setSegmentEnabled` 從未呼叫過 `syncFgOverrideDisabled`，故
 * 「powerline 下停用一個開了 bar 的段→再重新啟用」時，其 fgOverride
 * picker 停在停用當下同步的 `disabled=false` 過期狀態，直到下次切
 * bar／mode 才收斂。修法：`setSegmentEnabled` 內 commitConfig 之後補一次
 * `syncFgOverrideDisabled()`（棄用回傳值、不播報）。
 */
describe('I4 回歸 — 已停用的 bar 段切至 powerline 不得播報停用提示', () => {
  beforeAll(async () => {
    await boot()
    enableSegment('context-used') // 待停用組：開 bar 後停用（bar／enabled 正交，停用不清 seg.bar）。
    enableSegment('cache-hit') // 對照組：全程啟用，開 bar，驗證修復未過度停用播報範圍。
    barCheckbox('context-used').click()
    barCheckbox('cache-hit').click()
  })

  it('開啟兩段 bar：context-used／cache-hit 皆為 checked', () => {
    expect(barCheckbox('context-used').checked).toBe(true)
    expect(barCheckbox('cache-hit').checked).toBe(true)
  })

  it('停用 context-used（左欄取消勾選）：seg.bar 仍為 true、seg.enabled 轉 false（bar 與 enabled 正交，停用不清 bar）', () => {
    disableSegment('context-used')
    expect(readStoredSegment('context-used')?.bar).toBe(true)
    expect(readStoredSegment('context-used')?.enabled).toBe(false)
  })

  it('切至 powerline：已停用段（context-used）不得出現於播報中；仍啟用中的 bar 段（cache-hit）照常播報停用提示（對照組，證明未修過頭）', () => {
    ;(document.getElementById('mode-powerline') as HTMLInputElement).click()
    const status = liveStatus()
    expect(status).not.toContain('上下文已用')
    expect(status).toContain('「Cache 命中率」的前景覆寫色因長條圖已停用，改由主色自動決定')
  })

  it('已停用段的 fgOverride fieldset 未被 syncFgOverrideDisabled 標記為停用（停用段本就在隱藏池，setDisabled(false) 對其無害）', () => {
    expect(fgOverrideFieldset('context-used').disabled).toBe(false)
  })

  it('I4b 回歸：重新啟用 context-used（左欄再勾選）→ fgOverride picker 隨即收斂為正確的 disabled=true（此刻 bar／enabled／powerline 三者皆真），且此附帶收斂為靜默——未觸發／未覆寫任何多餘播報', () => {
    const statusBeforeReenable = liveStatus()
    enableSegment('context-used')
    expect(fgOverrideFieldset('context-used').disabled).toBe(true)
    expect(liveStatus()).toBe(statusBeforeReenable) // 靜默收斂：live region 內容未被新增或覆寫。
  })
})

/**
 * I4c 回歸（協調者續 T7.4，2026-07-15，I4 家族最後一個停用進入點——grep
 * 已證 main.ts 內僅 setSegmentEnabled／performRowDeletion 兩處會停用段，
 * 補完此處即完整覆蓋）：performRowDeletion（整列刪除，confirm 鈕兩段式
 * 確認路徑）逐段 mutate `seg.enabled = false` 後同樣繞過
 * syncFgOverrideDisabled（與 I4b 同根因、不同進入點）——批次刪除一列含
 * 「powerline 下已開 bar 的百分比段」時，該段進隱藏池後 fgOverride picker
 * 停在刪除前（仍啟用時）同步的 disabled=true 過期狀態，未隨 enabled 轉
 * false 一併收斂。修法：performRowDeletion 內 commitConfig() 之後補一次
 * syncFgOverrideDisabled()（棄用回傳值、不 announceGlobal），與
 * setSegmentEnabled 的補法（I4b）同構。
 */
describe('I4c 回歸 — 整列刪除（performRowDeletion）繞過 fgOverride 收斂', () => {
  // 以存檔種子直接建立兩個真實列（context-used row0／cwd row1）——迴避
  // 列指派 UI 往返，聚焦本測試於「整列刪除」這個停用進入點本身；context-
  // used 種子即 bar:true（合法沉默處，見 config.ts sanitizeSegment「bar
  // 限 catalog.barEligibleIds；threshold 缺席時维持 undefined」）。僅剩
  // context-used 一段的列非最後一列（cwd 尚在），deleteTrigger 不受
  // 「僅剩最後一列」防清空閘卡住（見 wireRowDeleteButton 文件）。
  const STORAGE_SEED = {
    version: 2,
    mode: 'plain',
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: true,
    powerlineArrow: false,
    segments: [
      { id: 'context-used', enabled: true, icon: true, color: { kind: 'default' }, bar: true, row: 0 },
      { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
    ],
  }

  beforeAll(async () => {
    localStorage.clear()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STORAGE_SEED))
    document.body.innerHTML = BODY_HTML
    vi.resetModules()
    await import('./main.js')
    // 切 powerline：context-used（enabled+bar）fgOverride 隨即被停用（前置條件）。
    ;(document.getElementById('mode-powerline') as HTMLInputElement).click()
  })

  it('前置條件：切 powerline 後 context-used 的 fgOverride fieldset 已停用', () => {
    expect(fgOverrideFieldset('context-used').disabled).toBe(true)
  })

  it('整列刪除 context-used 所在列（confirm 鈕兩段式路徑）→ 該段轉停用＋回目錄；fgOverride picker 應收斂為 disabled=false（enabled 轉 false 使 shouldDisable 隨之為 false）；#segment-move-status 播報刪除（預期內）；#global-live-status 未被新增／覆寫多餘 fgOverride 播報（本次 syncFgOverrideDisabled 呼叫棄用回傳值，不 announceGlobal，故維持刪除前的既有內容不變）', () => {
    const globalStatusBeforeDelete = liveStatus() // 刪除前既有內容（mode 切換播報）——用於驗證刪除不覆寫／不追加。
    deleteRowOf('context-used')

    expect(readStoredSegment('context-used')?.enabled).toBe(false)
    expect(readStoredSegment('context-used')?.bar).toBe(true) // bar／enabled 正交，整列刪除不清 bar。
    expect(fgOverrideFieldset('context-used').disabled).toBe(false)
    expect(moveStatus()).toContain('已刪除')
    expect(liveStatus()).toBe(globalStatusBeforeDelete) // 靜默收斂：global live region 內容未被新增或覆寫。
  })
})
