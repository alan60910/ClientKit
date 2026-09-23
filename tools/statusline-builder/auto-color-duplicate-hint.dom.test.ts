// @vitest-environment jsdom
/**
 * T5.2（(internal design doc) §5）：
 * 1. auto 配色選項（model／effort 段限定 UI）——主色 picker 第四態
 *    「自動配色」radio 僅 `SEGMENT_CATALOG.autoEligibleIds` 成員段顯示；
 *    fgOverride picker 恆不出現此態；選取寫入／讀檔還原正確。
 * 2. `percent-reset` variant × reset 獨立段同列並開 → 重複提示（常駐
 *    `#global-live-status` live region 播報）；觸發時機涵蓋啟用段／改
 *    variant／改列；同一 pair 狀態未變不重播。
 *
 * 沿用 bar-toggle.dom.test.ts 建立的「真實 index.html 灌 jsdom＋動態
 * import 觸發 init()」整合測試形（見其檔頭文件，不重複贅述）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const HTML_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

// main.ts 主設定 localStorage 鍵——經無副作用常數模組 config-storage-key.ts
// 單一出口匯入（同 bar-toggle.dom.test.ts 慣例）。
import { STORAGE_KEY } from './config-storage-key.js'

interface StoredSegment {
  id: string
  enabled?: boolean
  color?: { kind: string }
  variant?: string
  row?: number
}

/** 讀 localStorage 存檔中某段目前狀態（main.ts 每次 commitConfig 皆 persist，見其文件）。 */
function readStoredSegment(id: string): StoredSegment | undefined {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return undefined
  const parsed = JSON.parse(raw) as { segments: StoredSegment[] }
  return parsed.segments.find((seg) => seg.id === id)
}

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（見 bar-toggle.dom.test.ts 檔頭「隔離」段）。 */
async function boot(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

/**
 * T5.2：重整（reload）情境專用——**不**清空 localStorage，僅重灌乾淨 DOM＋
 * 重置模組快取後重新啟動，模擬使用者重新整理頁面（既有存檔仍在）。
 */
async function rebootKeepingStorage(): Promise<void> {
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

function baseColorPicker(id: string): HTMLFieldSetElement {
  const el = row(id).querySelector<HTMLFieldSetElement>('.segment-row__color-mount .color-picker')
  if (el === null) throw new Error(`missing base color picker for ${id}`)
  return el
}

function fgColorPicker(id: string): HTMLFieldSetElement {
  const el = row(id).querySelector<HTMLFieldSetElement>('.segment-row__fg-mount .color-picker')
  if (el === null) throw new Error(`missing fg-override color picker for ${id}`)
  return el
}

/** 色選 fieldset 內的「自動配色」radio（見 index.html color-picker-template；不存在則 null）。 */
function autoRadio(picker: HTMLFieldSetElement): HTMLInputElement | null {
  return picker.querySelector<HTMLInputElement>('.color-picker__mode--auto')
}

function variantSelect(id: string): HTMLSelectElement {
  const el = document.getElementById(`${id}-variant`) as HTMLSelectElement | null
  if (el === null) throw new Error(`missing variant select for ${id}`)
  return el
}

function rowSelect(id: string): HTMLSelectElement {
  const el = document.getElementById(`${id}-row`) as HTMLSelectElement | null
  if (el === null) throw new Error(`missing row select for ${id}`)
  return el
}

function iconCheckbox(id: string): HTMLInputElement {
  const el = document.getElementById(`${id}-icon`) as HTMLInputElement | null
  if (el === null) throw new Error(`missing icon checkbox for ${id}`)
  return el
}

function barCheckbox(id: string): HTMLInputElement {
  const el = document.getElementById(`${id}-bar`) as HTMLInputElement | null
  if (el === null) throw new Error(`missing bar checkbox for ${id}`)
  return el
}

/** <select> 值變更＋觸發 change（main.ts 各 select handler 皆監聽 'change'）。 */
function setSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function liveStatus(): string {
  return document.getElementById('global-live-status')!.textContent ?? ''
}

// 播報句原文（main.ts duplicateResetHintMessage；VARIANT_LABELS['percent-reset']
// ＝「百分比＋重置時間」，見其文件；分工語意：variant＝rate 段內附時刻
// (14:30)，獨立段＝完整倒數 ↺2h (14:30)）。
const MSG_5H =
  '「5 小時限額」已選「百分比＋重置時間」樣式，與「5 小時限額重置倒數」同列並開，' +
  '重置時間將重複顯示：前者僅於百分比後方附註時刻（如 (14:30)），' +
  '後者為獨立完整倒數（如 ↺2h (14:30)）'
const MSG_7D =
  '「7 日限額」已選「百分比＋重置時間」樣式，與「7 日限額重置倒數」同列並開，' +
  '重置時間將重複顯示：前者僅於百分比後方附註時刻（如 (14:30)），' +
  '後者為獨立完整倒數（如 ↺2h (14:30)）'

describe('T5.2 — auto 配色選項：限定顯示＋寫入／讀檔還原', () => {
  beforeAll(async () => {
    await boot()
    enableSegment('model') // autoEligibleIds 成員（palette='model'）。
    enableSegment('effort') // autoEligibleIds 成員（palette='effort'）。
    enableSegment('cwd') // 非成員（對照組）。
    enableSegment('context-used') // 百分比段（對照組：閾值桶色選）。
  })

  it('autoEligibleIds 成員段（model）主色 picker 含「自動配色」radio', () => {
    expect(autoRadio(baseColorPicker('model'))).not.toBeNull()
  })

  it('autoEligibleIds 成員段（effort）主色 picker 含「自動配色」radio', () => {
    expect(autoRadio(baseColorPicker('effort'))).not.toBeNull()
  })

  it('非 autoEligibleIds 段（cwd）主色 picker 不含「自動配色」radio', () => {
    expect(autoRadio(baseColorPicker('cwd'))).toBeNull()
  })

  it('autoEligibleIds 成員段（model）的 fgOverride picker 仍不得出現「自動配色」radio', () => {
    expect(autoRadio(fgColorPicker('model'))).toBeNull()
    expect(autoRadio(fgColorPicker('effort'))).toBeNull()
  })

  it('百分比段（context-used）閾值桶色選一律不含「自動配色」radio', () => {
    const buckets = row('context-used').querySelectorAll<HTMLFieldSetElement>(
      '.segment-row__threshold-mount .color-picker',
    )
    expect(buckets.length).toBeGreaterThan(0)
    for (const bucket of buckets) expect(autoRadio(bucket)).toBeNull()
  })

  it('選取「自動配色」→ seg.color 寫入 {kind:"auto"}（存檔同步）', () => {
    const radio = autoRadio(baseColorPicker('model'))!
    radio.click()
    expect(radio.checked).toBe(true)
    expect(readStoredSegment('model')?.color).toEqual({ kind: 'auto' })
  })

  it('非成員段（cwd）色選 DOM 內找不到 value="auto" 的 radio（防禦：非僅隱藏，是整組不存在）', () => {
    expect(baseColorPicker('cwd').querySelector('input[value="auto"]')).toBeNull()
  })

  it('重整（reload，存檔不清空）：auto 選取狀態於下次啟動時 radio 仍為 checked', async () => {
    await rebootKeepingStorage()
    const radio = autoRadio(baseColorPicker('model'))!
    expect(radio.checked).toBe(true)
    // 其餘三態皆未勾選（互斥語意，非僅本 radio 為真）。
    const others = baseColorPicker('model').querySelectorAll<HTMLInputElement>(
      '.color-picker__mode:not(.color-picker__mode--auto)',
    )
    for (const other of others) expect(other.checked).toBe(false)
  })
})

describe('T5.2 — 重複提示：啟用段／改 variant 觸發＋不重複播報＋跨 pair 獨立判定', () => {
  beforeAll(async () => {
    await boot()
    enableSegment('rate-5h') // 單獨啟用（同列尚無 reset-5h，尚不構成重複）。
  })

  it('rate-5h 改選「百分比＋重置時間」，但 reset-5h 尚未啟用 → 不判定重複（無播報）', () => {
    setSelectValue(variantSelect('rate-5h'), 'percent-reset')
    expect(liveStatus()).toBe('')
  })

  it('啟用 reset-5h（預設同列）→ 觸發重複提示（啟用段觸發）', () => {
    enableSegment('reset-5h')
    expect(liveStatus()).toBe(MSG_5H)
  })

  it('狀態未變時不重複播報（無關 commit，如切換顯示文字 checkbox）', () => {
    iconCheckbox('reset-5h').click()
    expect(liveStatus()).toBe(MSG_5H) // 未被清空、亦未重複附加。
  })

  it('rate-5h 改回「僅百分比」→ 重複解除，但不主動播報「解除」訊息（維持原文字）', () => {
    setSelectValue(variantSelect('rate-5h'), 'percent')
    expect(liveStatus()).toBe(MSG_5H)
  })

  it('插入一則不相關播報後，重新選回「百分比＋重置時間」→ 重新播報（證明非殘留字串）', () => {
    enableSegment('context-used') // 對照段：切開 bar 會產生另一則 live region 訊息。
    barCheckbox('context-used').click()
    expect(liveStatus()).not.toBe(MSG_5H)

    setSelectValue(variantSelect('rate-5h'), 'percent-reset')
    expect(liveStatus()).toBe(MSG_5H)
  })

  it('rate-7d／reset-7d 為獨立 pair：各自判定，訊息不與 5h pair 混雜', () => {
    enableSegment('rate-7d')
    enableSegment('reset-7d')
    setSelectValue(variantSelect('rate-7d'), 'percent-reset')
    expect(liveStatus()).toBe(MSG_7D) // 本次 commit 僅 7d pair 轉場，訊息不含 5h 句。
  })
})

describe('T5.2 — 重複提示：改列觸發', () => {
  beforeAll(async () => {
    // 直接以存檔種子兩段分落不同列（rate-5h row 0／reset-5h row 1），
    // 迴避列指派 UI 的暫存列往返、聚焦本測試於「改列」本身這個觸發點。
    localStorage.clear()
    const seeded = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [
        { id: 'rate-5h', enabled: true, icon: true, color: { kind: 'default' }, variant: 'percent-reset', row: 0 },
        { id: 'reset-5h', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
      ],
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    document.body.innerHTML = BODY_HTML
    vi.resetModules()
    await import('./main.js')
  })

  it('初始：percent-reset 已選但不同列 → 不判定重複', () => {
    expect(liveStatus()).toBe('')
    expect(rowSelect('reset-5h').value).toBe('1') // 起始落點＝自身現行列。
  })

  it('改列（select 指派回 rate-5h 所在列）→ 觸發重複提示', () => {
    setSelectValue(rowSelect('reset-5h'), '0')
    expect(liveStatus()).toBe(MSG_5H)
  })

  it('再次改列離開同列 → 不主動播報解除（訊息維持不變）', () => {
    // 來源列耗盡＝保留為空列（Rev 11 語意）：離開後的空列仍在 slots 中，
    // select 應仍能選回一個非本列的空位。
    const options = Array.from(rowSelect('reset-5h').options).map((o) => o.value)
    const otherSlot = options.find((v) => v !== rowSelect('reset-5h').value)!
    setSelectValue(rowSelect('reset-5h'), otherSlot)
    expect(liveStatus()).toBe(MSG_5H)
  })
})

/**
 * I5 回歸（code review I5，(internal design doc)）：
 * reload 後既有的「重複倒數」狀態，在首次「無關」編輯時才被誤當新出現而
 * 播報。根因：duplicateResetPairIds 為模組層級 Set，reload 後為空；init()
 * 不呼叫 commitConfig，故不判定重複、不播報（這是對的）；但之後任一次
 * commitConfig（含與重複條件無關的操作，如切某段顯示文字 checkbox）皆會
 * 讓 checkDuplicateResetHints 視此為「新出現」而播報整段長提示，與使用者
 * 當下操作脫節。修法：init() 末端以靜默模式先跑一次 checkDuplicateResetHints
 * seed duplicateResetPairIds（只 seed 不 announce），之後只有真正的轉場
 * （新形成的重複）才播報。
 */
describe('I5 回歸 — reload 後既有的重複狀態不得於首次無關編輯時才誤判為新出現', () => {
  beforeAll(async () => {
    // 存檔種子：rate-5h(percent-reset, row0)＋reset-5h(row0) 同列——載入前
    // 即已重複；rate-7d(percent-reset, row1)／reset-7d(row2) 起始不同列，
    // 供「新形成」對照組（見下方最後一個 it）。
    localStorage.clear()
    const seeded = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [
        { id: 'rate-5h', enabled: true, icon: true, color: { kind: 'default' }, variant: 'percent-reset', row: 0 },
        { id: 'reset-5h', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'rate-7d', enabled: true, icon: true, color: { kind: 'default' }, variant: 'percent-reset', row: 1 },
        { id: 'reset-7d', enabled: true, icon: true, color: { kind: 'default' }, row: 2 },
      ],
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    document.body.innerHTML = BODY_HTML
    vi.resetModules()
    await import('./main.js')
  })

  it('載入（init）：既有重複狀態（rate-5h／reset-5h 同列）不播報（liveStatus 為空）', () => {
    expect(liveStatus()).toBe('')
  })

  it('接著做一個與重複條件無關的編輯（切 reset-5h 的顯示文字 icon checkbox）：不得誤播重複提示', () => {
    iconCheckbox('reset-5h').click()
    expect(liveStatus()).toBe('')
  })

  it('對照組：新形成一組同列重複（把 reset-7d 拖進 rate-7d 所在列）→ 應正常播報', () => {
    setSelectValue(rowSelect('reset-7d'), '1')
    expect(liveStatus()).toBe(MSG_7D)
  })
})
