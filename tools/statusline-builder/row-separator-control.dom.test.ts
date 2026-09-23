// @vitest-environment jsdom
/**
 * T1.7（(internal design doc) §D1「UI」／TASKS.md T1.7）：
 * 各列群組 header 逐列分隔符控件（preset select＋custom 子欄＋
 * 「（全域）」還原繼承選項）——含 T1.2 `row-separators.ts` helper 於三個
 * real-slot 變異點（`setSegmentEnabled` drain／`performRowDeletion`／
 * `commitSegmentMove`）的接線＋powerline 模式整組停用（保值不清除）。
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

type StoredSeparator = { kind: 'preset' | 'custom'; value: string } | null

interface StoredConfig {
  mode: 'plain' | 'powerline'
  separator: { kind: string; value: string }
  rowSeparators?: StoredSeparator[]
  segments: { id: string; enabled?: boolean; row?: number }[]
}

function readStoredConfig(): StoredConfig {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) throw new Error('no stored config')
  return JSON.parse(raw) as StoredConfig
}

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（見 bar-toggle.dom.test.ts 檔頭「隔離」段）。 */
async function boot(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

/** 以存檔種子啟動（同 bar-toggle.dom.test.ts I4c 案慣例）——迴避拖曳／select 指派 UI 往返，直接建構多列狀態。 */
async function bootWithSeed(config: unknown): Promise<void> {
  localStorage.clear()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

/** 列群組容器（DOM 順序＝real index 順序，見 main.ts rowGroupContainers 文件）。 */
function rowGroupSections(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.segment-row-group')]
}

function separatorPresetSelect(realIndex: number): HTMLSelectElement {
  const section = rowGroupSections()[realIndex]
  if (section === undefined) throw new Error(`missing row group section at index ${realIndex}`)
  const el = section.querySelector<HTMLSelectElement>('.segment-row-group__separator-preset')
  if (el === null) throw new Error(`missing separator preset select for row ${realIndex}`)
  return el
}

function separatorCustomField(realIndex: number): HTMLElement {
  const section = rowGroupSections()[realIndex]!
  const el = section.querySelector<HTMLElement>('.segment-row-group__separator-custom-field')
  if (el === null) throw new Error(`missing separator custom field for row ${realIndex}`)
  return el
}

function separatorCustomInput(realIndex: number): HTMLInputElement {
  const section = rowGroupSections()[realIndex]!
  const el = section.querySelector<HTMLInputElement>('.segment-row-group__separator-custom')
  if (el === null) throw new Error(`missing separator custom input for row ${realIndex}`)
  return el
}

/** 段的「顯示於第 N 列」select（main.ts commitSegmentMove 之非拖曳觸發路徑，見其 change handler）。 */
function rowSelect(id: string): HTMLSelectElement {
  const el = document.getElementById(`${id}-row`) as HTMLSelectElement | null
  if (el === null) throw new Error(`missing row select for ${id}`)
  return el
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function typeCustomValue(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 產出的 bash 腳本原始碼（main.ts refreshOutputs 填入，見 emit-bash.ts SEP_k 宣告契約）。 */
function bashCode(): string {
  return document.querySelector('#output-bash code')!.textContent ?? ''
}

/** 兩段式整列刪除（trigger → confirm，見 main.ts wireRowDeleteButton）；rowIndex＝real index。 */
function deleteRowAt(realIndex: number): void {
  const section = rowGroupSections()[realIndex]!
  const trigger = section.querySelector<HTMLButtonElement>('.segment-row-group__delete-trigger')!
  trigger.click()
  const confirmBtn = section.querySelector<HTMLButtonElement>('.segment-row-group__delete-confirm-btn')!
  confirmBtn.click()
}

// 兩列種子：row0=[cwd]（單段，永在類）、row1=[model, cost]（雙段，皆永在
// 類、任何 mock 情境皆非空值——用於斷言「該列 join 變化」不受情境影響）。
const TWO_ROW_SEED = {
  version: 2,
  mode: 'plain',
  separator: { kind: 'preset', value: '|' },
  lastArrowCap: true,
  powerlineArrow: false,
  segments: [
    { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
    { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
    { id: 'cost', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
  ],
}

describe('T1.7 — 控件渲染：每列 header 逐列分隔符控件，預設「（全域）」', () => {
  beforeAll(async () => {
    await bootWithSeed(TWO_ROW_SEED)
  })

  it('兩列皆存在 preset select＋custom 子欄（隱藏態）', () => {
    expect(rowGroupSections()).toHaveLength(2)
    expect(separatorPresetSelect(0)).not.toBeNull()
    expect(separatorPresetSelect(1)).not.toBeNull()
    expect(separatorCustomField(0).hidden).toBe(true)
    expect(separatorCustomField(1).hidden).toBe(true)
  })

  it('無 rowSeparators 覆寫時兩列預設顯示「（全域）」（value="inherit"）', () => {
    expect(separatorPresetSelect(0).value).toBe('inherit')
    expect(separatorPresetSelect(1).value).toBe('inherit')
    expect(
      [...separatorPresetSelect(1).options].some((o) => o.value === 'inherit' && o.text === '（全域）'),
    ).toBe(true)
  })

  it('config.rowSeparators 未寫入本欄（正規形＝全繼承時省略欄位）', () => {
    expect(readStoredConfig().rowSeparators).toBeUndefined()
  })
})

describe('T1.7 — 覆寫後行為：config 寫回＋三後端 SEP_k 反映＋不影響其他列', () => {
  beforeAll(async () => {
    await bootWithSeed(TWO_ROW_SEED)
  })

  it('改列 1（real index 1）為 preset "›" → config.rowSeparators[1] 更新、[0] 仍 null（繼承）', () => {
    setSelectValue(separatorPresetSelect(1), 'preset:›')
    expect(readStoredConfig().rowSeparators).toEqual([null, { kind: 'preset', value: '›' }])
    expect(separatorCustomField(1).hidden).toBe(true) // preset 選項不顯示 custom 子欄。
  })

  it('bash 產物：有覆寫時逐列 SEP_k 展開——row1 為覆寫值，row0 退全域值', () => {
    const bash = bashCode()
    expect(bash).toContain("SEP_1='›'")
    expect(bash).toContain("SEP_0='|'") // row0 未覆寫，rowSeparatorValue 退 config.separator。
  })

  it('改列 1 為自訂 "~~"：select 切 custom → 顯子欄＋輸入值即時寫回', () => {
    setSelectValue(separatorPresetSelect(1), 'custom')
    expect(separatorCustomField(1).hidden).toBe(false)
    typeCustomValue(separatorCustomInput(1), '~~')
    expect(readStoredConfig().rowSeparators).toEqual([null, { kind: 'custom', value: '~~' }])
    expect(bashCode()).toContain("SEP_1='~~'")
  })

  it('列 1 選回「（全域）」→ 寫回 null，正規形收斂為省略欄位（全 null）', () => {
    setSelectValue(separatorPresetSelect(1), 'inherit')
    expect(separatorCustomField(1).hidden).toBe(true)
    expect(separatorCustomInput(1).value).toBe('')
    // 兩列皆 null（全繼承）→ 正規形省略 rowSeparators 欄位（見
    // normalizeRowSeparatorsField／config.ts sanitizeRowSeparators 同精神）。
    expect(readStoredConfig().rowSeparators).toBeUndefined()
    // 無覆寫 → fast path：單一 SEP 宣告（非逐列 SEP_k），byte 凍結行為不變。
    expect(bashCode()).toContain("SEP='|'")
    expect(bashCode()).not.toContain('SEP_0=')
    expect(bashCode()).not.toContain('SEP_1=')
  })
})

describe('T1.7 — powerline 灰化：列級控件停用，切回 plain 後恢復且值保留', () => {
  beforeAll(async () => {
    await bootWithSeed(TWO_ROW_SEED)
    setSelectValue(separatorPresetSelect(1), 'custom')
    typeCustomValue(separatorCustomInput(1), '~')
  })

  it('前置條件：plain 模式下列級控件可用', () => {
    expect(separatorPresetSelect(0).disabled).toBe(false)
    expect(separatorPresetSelect(1).disabled).toBe(false)
    expect(separatorCustomInput(1).disabled).toBe(false)
  })

  it('切至 powerline → 兩列 preset select＋custom input 皆 disabled', () => {
    ;(document.getElementById('mode-powerline') as HTMLInputElement).click()
    expect(separatorPresetSelect(0).disabled).toBe(true)
    expect(separatorPresetSelect(1).disabled).toBe(true)
    expect(separatorCustomInput(0).disabled).toBe(true)
    expect(separatorCustomInput(1).disabled).toBe(true)
  })

  it('powerline 下 config.rowSeparators 保值不清除', () => {
    expect(readStoredConfig().rowSeparators).toEqual([null, { kind: 'custom', value: '~' }])
  })

  it('切回 plain → 控件恢復可用，值原樣保留（DOM 顯示與 config 皆未變）', () => {
    ;(document.getElementById('mode-plain') as HTMLInputElement).click()
    expect(separatorPresetSelect(0).disabled).toBe(false)
    expect(separatorPresetSelect(1).disabled).toBe(false)
    expect(separatorCustomInput(1).disabled).toBe(false)
    expect(separatorPresetSelect(1).value).toBe('custom')
    expect(separatorCustomInput(1).value).toBe('~')
    expect(readStoredConfig().rowSeparators).toEqual([null, { kind: 'custom', value: '~' }])
  })
})

describe('T1.7 — 刪列 reindex：覆寫跟列走（real-slot 集合縮減時 splice 同步）', () => {
  // 三列各設覆寫：row0='·'／row1='›'／row2=custom '~'。刪除 row1（中間列）
  // 後，原 row2 應變為新 row1（跟列走），row0 不受影響。
  const THREE_ROW_SEED = {
    version: 2,
    mode: 'plain',
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: true,
    powerlineArrow: false,
    segments: [
      { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
      { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
      { id: 'cost', enabled: true, icon: true, color: { kind: 'default' }, row: 2 },
    ],
    rowSeparators: [
      { kind: 'preset', value: '·' },
      { kind: 'preset', value: '›' },
      { kind: 'custom', value: '~' },
    ],
  }

  beforeAll(async () => {
    await bootWithSeed(THREE_ROW_SEED)
  })

  it('前置條件：三列皆顯示各自覆寫值', () => {
    expect(rowGroupSections()).toHaveLength(3)
    expect(separatorPresetSelect(0).value).toBe('preset:·')
    expect(separatorPresetSelect(1).value).toBe('preset:›')
    expect(separatorPresetSelect(2).value).toBe('custom')
    expect(separatorCustomInput(2).value).toBe('~')
  })

  it('刪除 row1（含 model 之列）→ config.rowSeparators 縮為 2 項：row0 不變、原 row2 前移為新 row1', () => {
    deleteRowAt(1)
    expect(rowGroupSections()).toHaveLength(2)
    expect(readStoredConfig().rowSeparators).toEqual([
      { kind: 'preset', value: '·' },
      { kind: 'custom', value: '~' },
    ])
  })

  it('DOM 控件同步：新 row0 仍顯示「·」、新 row1（原 row2，隨 cost 段跟列走）顯示自訂 "~"', () => {
    expect(separatorPresetSelect(0).value).toBe('preset:·')
    expect(separatorPresetSelect(1).value).toBe('custom')
    expect(separatorCustomField(1).hidden).toBe(false)
    expect(separatorCustomInput(1).value).toBe('~')
  })
})

// 三列＋一額外段（用於 commitSegmentMove 兩案：real target 來源列耗盡、
// pending target 中間空列物化）：row0=[cwd]'·'／row1=[model]'›'（唯一段，
// 移走即耗盡）／row2=[cost, project-dir]custom'~'（雙段，移走其一不耗盡）。
const MOVE_SEED = {
  version: 2,
  mode: 'plain',
  separator: { kind: 'preset', value: '|' },
  lastArrowCap: true,
  powerlineArrow: false,
  segments: [
    { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
    { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
    { id: 'cost', enabled: true, icon: true, color: { kind: 'default' }, row: 2 },
    { id: 'project-dir', enabled: true, icon: true, color: { kind: 'default' }, row: 2 },
  ],
  rowSeparators: [
    { kind: 'preset', value: '·' },
    { kind: 'preset', value: '›' },
    { kind: 'custom', value: '~' },
  ],
}

describe('T1.7 — commitSegmentMove（real target，來源列耗盡）：覆寫跟列走', () => {
  beforeAll(async () => {
    await bootWithSeed(MOVE_SEED)
  })

  it('前置條件：三列各顯示覆寫值', () => {
    expect(rowGroupSections()).toHaveLength(3)
    expect(separatorPresetSelect(0).value).toBe('preset:·')
    expect(separatorPresetSelect(1).value).toBe('preset:›')
    expect(separatorPresetSelect(2).value).toBe('custom')
    expect(separatorCustomInput(2).value).toBe('~')
  })

  it('把 row1 唯一段（model）以「顯示於第 N 列」select 指派入既有 row2 → row1 原地耗盡消失，其覆寫一併消滅、row2 覆寫跟列前移', () => {
    // 三列皆 real、無暫存列，slot index＝real index，row2 之 slot index＝2。
    setSelectValue(rowSelect('model'), '2')
    expect(rowGroupSections()).toHaveLength(2)
    expect(readStoredConfig().rowSeparators).toEqual([
      { kind: 'preset', value: '·' },
      { kind: 'custom', value: '~' },
    ])
  })

  it('DOM 同步：新 row0 仍「·」、新 row1（原 row2，含 model/cost/project-dir）仍自訂 "~"', () => {
    expect(separatorPresetSelect(0).value).toBe('preset:·')
    expect(separatorPresetSelect(1).value).toBe('custom')
    expect(separatorCustomInput(1).value).toBe('~')
  })
})

describe('T1.7 — commitSegmentMove（pending target，中間空列物化）：insertNullAtReal 跟列走', () => {
  beforeAll(async () => {
    await bootWithSeed(MOVE_SEED)
    // 前置步驟：model（row1 唯一段）移入既有 row2 → row1 原地耗盡為
    // **中間**暫存列（位置不變，convertRealToPending 語意，見 row-slots.ts）。
    setSelectValue(rowSelect('model'), '2')
  })

  it('前置條件：row1 原地耗盡為中間暫存列（真實列容器僅剩 2 個＋1 個 pending 節點）', () => {
    expect(rowGroupSections()).toHaveLength(2)
    expect(document.querySelectorAll('.segment-pending-row')).toHaveLength(1)
    expect(readStoredConfig().rowSeparators).toEqual([
      { kind: 'preset', value: '·' },
      { kind: 'custom', value: '~' },
    ])
  })

  it('把 project-dir（現與 cost/model 同列、非唯一段）以 select 指派入中間暫存列 → 該列物化為新真實列（本身無覆寫）、原合併列覆寫跟列前移', () => {
    // 中間暫存列之 slot index＝1（見前置步驟文件；slots=['real','pending','real']）。
    setSelectValue(rowSelect('project-dir'), '1')
    expect(rowGroupSections()).toHaveLength(3)
    expect(readStoredConfig().rowSeparators).toEqual([
      { kind: 'preset', value: '·' },
      null,
      { kind: 'custom', value: '~' },
    ])
  })

  it('DOM 同步：新列（project-dir 獨居）顯示「（全域）」、原合併列（cost/model）覆寫跟列前移仍自訂 "~"', () => {
    expect(separatorPresetSelect(0).value).toBe('preset:·')
    expect(separatorPresetSelect(1).value).toBe('inherit')
    expect(separatorPresetSelect(2).value).toBe('custom')
    expect(separatorCustomInput(2).value).toBe('~')
  })
})

describe('T1.7 — setSegmentEnabled（左欄取消勾選，唯一段列真刪除）：覆寫跟列走', () => {
  // 兩列、皆唯一段：row0=[cwd]'·'／row1=[model]'›'。取消勾選 cwd（其列唯一
  // 段）→ row0 真刪除（壓縮語意，不留空列，見 setSegmentEnabled 文件），
  // row1 前移為新 row0，其覆寫跟列走。
  const SEED = {
    version: 2,
    mode: 'plain',
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: true,
    powerlineArrow: false,
    segments: [
      { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
      { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
    ],
    rowSeparators: [
      { kind: 'preset', value: '·' },
      { kind: 'preset', value: '›' },
    ],
  }

  beforeAll(async () => {
    await bootWithSeed(SEED)
  })

  it('前置條件：兩列各顯示覆寫值', () => {
    expect(rowGroupSections()).toHaveLength(2)
    expect(separatorPresetSelect(0).value).toBe('preset:·')
    expect(separatorPresetSelect(1).value).toBe('preset:›')
  })

  it('左欄取消勾選 cwd（其列唯一段）→ row0 真刪除（不留空列）、row1 前移為新 row0，覆寫跟列走', () => {
    ;(document.getElementById('cwd-catalog') as HTMLInputElement).click()
    expect(rowGroupSections()).toHaveLength(1)
    expect(document.querySelectorAll('.segment-pending-row')).toHaveLength(0) // 壓縮語意：不留暫存空列。
    expect(readStoredConfig().rowSeparators).toEqual([{ kind: 'preset', value: '›' }])
  })

  it('DOM 同步：唯一剩下的 row0（原 row1，model）顯示「›」', () => {
    expect(separatorPresetSelect(0).value).toBe('preset:›')
  })
})
