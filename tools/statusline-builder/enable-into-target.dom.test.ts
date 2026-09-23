// @vitest-environment jsdom
/**
 * T3.2（(internal design doc) §D3 A-1「enable-into-target
 * seam」，本 sprint 唯一 Critical 級設計 C1）：拖入一個**停用中**的段至
 * target（真實列／暫存 pending／列內位置）的落點決策與唯一 commit 收口
 * 回歸網。兩層：
 * (1) **seam 直測**——純函式 `planEnableIntoTarget`（enable-into-target.ts）
 *     以手構 slots/segments/target 直測三情境的決策輸出（nextSlots／
 *     targetRow／bumpIds），不需 boot（DOM-free 純模組，node 可測）。
 * (2) **整合**——沿用 bar-toggle.dom.test.ts／defer-enable.dom.test.ts 的
 *     「灌真實 index.html body → 動態 import 觸發 init()」全頁面整合形，
 *     驅動 `commitSegmentMove`（本任務新匯出）的停用段分支，斷言：唯一
 *     commit（spy localStorage.setItem 計數）、最終 rowSlots（DOM 真實列
 *     ／暫存列容器計數）、各段 row（localStorage）、rowSeparators 跟列走、
 *     啟用側 UI 同步（I4b 不重演＋checkbox 勾選），並顯式鎖住已啟用段走
 *     同一入口行為零變。
 *
 * C1 崩解案全覆蓋：空清單拖入唯一 pending／中間 pending 列物化／真實列
 * 指定位——三者皆為 PLAN §D3 點名的「先 enable 再 move 兩段 commit、
 * enable 中間態使 slotIndex stale／假來源列」會落點錯亂之情境。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { planEnableIntoTarget } from './enable-into-target.js'
import type { PlanSegmentInput, RowSlot } from './row-slots.js'

const HTML_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

// main.ts 主設定 localStorage 鍵——經無副作用常數模組 config-storage-key.ts
// 單一出口匯入（同 bar-toggle.dom.test.ts 慣例）。
import { STORAGE_KEY } from './config-storage-key.js'

// 動態 import 於 boot() 內才實際觸發 init 副作用；此處僅借用型別。
type MainModule = typeof import('./main.js')

type StoredSeparator = { kind: 'preset' | 'custom'; value: string } | null

interface StoredSegment {
  id: string
  enabled?: boolean
  row?: number
  bar?: boolean
}

interface StoredConfig {
  mode: 'plain' | 'powerline'
  rowSeparators?: StoredSeparator[]
  segments: StoredSegment[]
}

function readStoredConfig(): StoredConfig {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) throw new Error('no stored config')
  return JSON.parse(raw) as StoredConfig
}

function readStoredSegment(id: string): StoredSegment | undefined {
  return readStoredConfig().segments.find((seg) => seg.id === id)
}

/** 清空 localStorage、灌入種子存檔、重灌乾淨 DOM＋重置模組快取後啟動 main.ts，回傳模組命名空間。 */
async function bootWithSeed(config: unknown): Promise<MainModule> {
  localStorage.clear()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  return (await import('./main.js')) as MainModule
}

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.segment-row[data-segment-id="${id}"]`)
  if (el === null) throw new Error(`missing segment row for ${id}`)
  return el
}

function catalogCheckbox(id: string): HTMLInputElement {
  const el = document.getElementById(`${id}-catalog`) as HTMLInputElement | null
  if (el === null) throw new Error(`missing catalog checkbox for ${id}`)
  return el
}

/** 段的完整控件列 `<li>` 目前是否仍屬隱藏池。 */
function inHiddenPool(id: string): boolean {
  return row(id).closest('#segment-hidden-pool') !== null
}

/** 真實列群組容器（DOM 順序＝real index 順序，見 main.ts rowGroupContainers 文件）。 */
function rowGroupSections(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.segment-row-group')]
}

/** UI 暫存空列容器（pending slot）。 */
function pendingRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.segment-pending-row')]
}

/** 第 `realIndex` 個真實列群組容器內的段 id（依列內視覺順序）。 */
function segIdsInRow(realIndex: number): string[] {
  const section = rowGroupSections()[realIndex]
  if (section === undefined) throw new Error(`missing row group section at index ${realIndex}`)
  return [...section.querySelectorAll<HTMLElement>('.segment-row')].map((li) => li.dataset.segmentId ?? '')
}

/** 段的「顯示於第 N 列」select（enabled 段限定）——setSelectValue 觸發其 change → commitSegmentMove（既有 enabled 路徑）。 */
function rowSelect(id: string): HTMLSelectElement {
  const el = document.getElementById(`${id}-row`) as HTMLSelectElement | null
  if (el === null) throw new Error(`missing row select for ${id}`)
  return el
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

/** 中欄「＋ 新增一列」按鈕（appendPendingSlot；純 UI，不 commit）。 */
function addPendingRow(): void {
  ;(document.getElementById('add-pending-row') as HTMLButtonElement).click()
}

/** powerline 下 bar 段 fgOverride 停用態同步之目標 fieldset（見 bar-toggle.dom.test.ts 同 helper）。 */
function fgOverrideFieldset(id: string): HTMLFieldSetElement {
  const el = row(id).querySelector<HTMLFieldSetElement>('.segment-row__fg-mount .color-picker')
  if (el === null) throw new Error(`missing fg-override fieldset for ${id}`)
  return el
}

const P = (id: string, enabled: boolean, rowValue?: number): PlanSegmentInput => ({ id, enabled, row: rowValue })

// ── (1) seam 直測：planEnableIntoTarget 決策核心（DOM-free，無 boot） ──

describe('T3.2 — planEnableIntoTarget（enable-into-target seam，純插入決策核心）', () => {
  it('情境 1：空清單拖入唯一 pending（rowSlots=[pending]，無其他啟用段）→ 物化為 [real]、targetRow=0、無 bump', () => {
    const slots: RowSlot[] = ['pending']
    // markSegmentEnabledDeferred 後 moved 已 enabled；bump 收集自 moved 排除，
    // 故唯一啟用段（moved 自身）不入 bump。
    const plan = planEnableIntoTarget(slots, [P('git-branch', true)], 'git-branch', {
      kind: 'pending',
      slotIndex: 0,
    })
    expect(plan.nextSlots).toEqual(['real'])
    expect(plan.targetRow).toBe(0)
    expect(plan.bumpIds).toEqual([])
    // 純函式不 mutate 輸入。
    expect(slots).toEqual(['pending'])
  })

  it('情境 2：中間 pending 列（rowSlots=[real,pending,real]，real 0/1 各有段）→ 物化 [real,real,real]、targetRow=1、原 row1 段全數 bump', () => {
    const slots: RowSlot[] = ['real', 'pending', 'real']
    const segments = [
      P('cwd', true, 0),
      P('cost', true, 1),
      P('model', true, 1),
      P('git-branch', true), // moved（defer 後 enabled，row 尚未定）
    ]
    const plan = planEnableIntoTarget(slots, segments, 'git-branch', { kind: 'pending', slotIndex: 1 })
    expect(plan.targetRow).toBe(1)
    // real-index ≥ 1 者（row1 的 cost／model）後移一列；moved 自身排除、cwd(row0) 不動。
    expect(plan.bumpIds).toEqual(['cost', 'model'])
    expect(plan.nextSlots).toEqual(['real', 'real', 'real'])
  })

  it('情境 3：真實列指定位（target real row N）→ targetRow=N、無 bump、slots 不動（列內位置交 beforeId 決定，非決策層職責）', () => {
    const slots: RowSlot[] = ['real', 'real']
    const segments = [P('cwd', true, 0), P('model', true, 1), P('cost', true, 1), P('git-branch', true)]
    const plan = planEnableIntoTarget(slots, segments, 'git-branch', { kind: 'real', row: 1 })
    expect(plan.targetRow).toBe(1)
    expect(plan.bumpIds).toEqual([])
    expect(plan.nextSlots).toEqual(['real', 'real'])
  })
})

// ── (2) 整合：commitSegmentMove 停用段分支（唯一 commit＋UI 同步收口） ──

const SEED_BASE = {
  version: 2,
  mode: 'plain' as const,
  separator: { kind: 'preset', value: '|' },
  lastArrowCap: true,
  powerlineArrow: false,
}

describe('T3.2 整合 情境 1 — 空清單拖入唯一 pending：唯一 commit、[real]、row=0、無孤兒 pending', () => {
  let mod: MainModule
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    // 全停用種子：boot 後 0 真實列；按「＋ 新增一列」得唯一 pending（rowSlots=[pending]）。
    mod = await bootWithSeed({
      ...SEED_BASE,
      segments: [{ id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' } }],
    })
    addPendingRow()
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterAll(() => setItemSpy.mockRestore())

  it('前置條件：0 真實列＋1 暫存列（rowSlots=[pending]），git-branch 停用中、在隱藏池', () => {
    expect(rowGroupSections()).toHaveLength(0)
    expect(pendingRows()).toHaveLength(1)
    expect(inHiddenPool('git-branch')).toBe(true)
  })

  it('enable git-branch 至唯一 pending → rowSlots=[real]、無孤兒 pending、row=0、恰 commit 一次', () => {
    setItemSpy.mockClear()
    mod.commitSegmentMove('git-branch', { kind: 'pending', slotIndex: 0 }, undefined)
    expect(setItemSpy).toHaveBeenCalledTimes(1) // 唯一 commit（markSegmentEnabledDeferred 不 commit、UI 同步不 commit）。
    expect(rowGroupSections()).toHaveLength(1)
    expect(pendingRows()).toHaveLength(0)
    expect(readStoredSegment('git-branch')?.enabled).toBe(true)
    expect(readStoredSegment('git-branch')?.row).toBe(0)
  })

  it('啟用側 UI 同步：checkbox 勾選、退出隱藏池、.segment-row--enabled 套用', () => {
    expect(catalogCheckbox('git-branch').checked).toBe(true)
    expect(inHiddenPool('git-branch')).toBe(false)
    expect(row('git-branch').classList.contains('segment-row--enabled')).toBe(true)
  })
})

describe('T3.2 整合 情境 2 — 中間 pending 列物化：段落列 1、原列 1 段 bump 至列 2、rowSeparators 跟列走', () => {
  let mod: MainModule
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    // 三列各設覆寫（row0=cwd '·'／row1=model '›'／row2=cost '~'）＋停用 git-branch。
    mod = await bootWithSeed({
      ...SEED_BASE,
      segments: [
        { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
        { id: 'cost', enabled: true, icon: true, color: { kind: 'default' }, row: 2 },
        { id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' } },
      ],
      rowSeparators: [
        { kind: 'preset', value: '·' },
        { kind: 'preset', value: '›' },
        { kind: 'custom', value: '~' },
      ],
    })
    // 前置：把 row1 唯一段 model 併入既有 row2 → row1 原地耗盡為**中間**暫存列
    //（convertRealToPending，rowSlots=[real,pending,real]）；其覆寫 '›' 一併消滅，
    // row2 之 '~' 前移為新 row1（跟列走）。此步走既有 enabled 路徑（rowSelect）。
    setSelectValue(rowSelect('model'), '2')
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterAll(() => setItemSpy.mockRestore())

  it('前置條件：row1 原地耗盡為中間暫存列（2 真實列＋1 pending），rowSeparators=[·, ~]（跟列走）', () => {
    expect(rowGroupSections()).toHaveLength(2)
    expect(pendingRows()).toHaveLength(1)
    expect(readStoredConfig().rowSeparators).toEqual([
      { kind: 'preset', value: '·' },
      { kind: 'custom', value: '~' },
    ])
  })

  it('enable git-branch 至中間暫存列（slotIndex 1）→ 物化 3 真實列、git-branch 落列 1、原列 1 段 bump 至列 2、恰 commit 一次', () => {
    setItemSpy.mockClear()
    mod.commitSegmentMove('git-branch', { kind: 'pending', slotIndex: 1 }, undefined)
    expect(setItemSpy).toHaveBeenCalledTimes(1)
    expect(rowGroupSections()).toHaveLength(3)
    expect(pendingRows()).toHaveLength(0)
    // git-branch 落 real index 1；原合併列（cost/model）bump 至 real index 2。
    expect(readStoredSegment('git-branch')?.row).toBe(1)
    expect(readStoredSegment('cost')?.row).toBe(2)
    expect(readStoredSegment('model')?.row).toBe(2)
    expect(segIdsInRow(1)).toEqual(['git-branch'])
  })

  it('rowSeparators 於位 1 splice 入 null（新列本身無覆寫），原合併列覆寫 "~" 跟列後移至位 2', () => {
    expect(readStoredConfig().rowSeparators).toEqual([
      { kind: 'preset', value: '·' },
      null,
      { kind: 'custom', value: '~' },
    ])
  })
})

describe('T3.2 整合 情境 3 — 真實列指定位（beforeId）：插入該列位置 M、同列其他段序正確、slots 不變', () => {
  let mod: MainModule
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    // row0=[cwd]／row1=[model, cost]（雙段）＋停用 git-branch。
    mod = await bootWithSeed({
      ...SEED_BASE,
      segments: [
        { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
        { id: 'cost', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
        { id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' } },
      ],
    })
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterAll(() => setItemSpy.mockRestore())

  it('前置條件：2 真實列，row1=[model, cost]', () => {
    expect(rowGroupSections()).toHaveLength(2)
    expect(segIdsInRow(1)).toEqual(['model', 'cost'])
  })

  it('enable git-branch 至 row1、beforeId=cost（插 cost 之前，即列內第 2 位）→ row1=[model, git-branch, cost]、slots 不變、恰 commit 一次', () => {
    setItemSpy.mockClear()
    mod.commitSegmentMove('git-branch', { kind: 'real', row: 1 }, 'cost')
    expect(setItemSpy).toHaveBeenCalledTimes(1)
    expect(rowGroupSections()).toHaveLength(2) // slots 不變（real target 不新增列）。
    expect(pendingRows()).toHaveLength(0)
    expect(segIdsInRow(1)).toEqual(['model', 'git-branch', 'cost'])
    expect(readStoredSegment('git-branch')?.enabled).toBe(true)
    expect(readStoredSegment('git-branch')?.row).toBe(1)
  })
})

describe('T3.2 整合 情境 4 — 啟用側 UI 同步（I4b 不重演）：powerline+bar 百分比段拖入後 fgOverride picker disabled＋checkbox 勾選', () => {
  let mod: MainModule

  beforeAll(async () => {
    // powerline 模式；context-remaining 為百分比段（barEligibleIds），停用中、bar=true。
    mod = await bootWithSeed({
      ...SEED_BASE,
      mode: 'powerline',
      segments: [
        { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'context-remaining', enabled: false, icon: true, color: { kind: 'default' }, bar: true },
      ],
    })
  })

  it('前置條件：context-remaining 停用中、bar=true、其 fgOverride picker 尚未 disabled（enabled=false 未觸發停用閘——正是 I4b 過期態根因）', () => {
    expect(readStoredSegment('context-remaining')?.bar).toBe(true)
    expect(inHiddenPool('context-remaining')).toBe(true)
    expect(fgOverrideFieldset('context-remaining').disabled).toBe(false)
  })

  it('enable context-remaining 至 row0 → 唯一 commit 後補跑 syncFgOverrideDisabled：fgOverride picker disabled（I4b 不重演）＋左欄 checkbox 勾選', () => {
    mod.commitSegmentMove('context-remaining', { kind: 'real', row: 0 }, undefined)
    expect(readStoredSegment('context-remaining')?.enabled).toBe(true)
    expect(fgOverrideFieldset('context-remaining').disabled).toBe(true)
    expect(catalogCheckbox('context-remaining').checked).toBe(true)
    expect(row('context-remaining').classList.contains('segment-row--enabled')).toBe(true)
  })
})

describe('T3.2 整合 情境 5 — 已啟用段走 commitSegmentMove 行為零變（顯式回歸）', () => {
  let mod: MainModule
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    // row0=[cwd]／row1=[model, cost]；移動已啟用的 cost 至 row0（非耗盡：row1 仍留 model）。
    mod = await bootWithSeed({
      ...SEED_BASE,
      segments: [
        { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
        { id: 'cost', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
      ],
    })
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterAll(() => setItemSpy.mockRestore())

  it('已啟用段（cost）移至 row0 → 走既有 enabled 路徑（非 enable-into-target 分支）：cost 落 row0、model 留 row1、2 列不變、恰 commit 一次', () => {
    setItemSpy.mockClear()
    mod.commitSegmentMove('cost', { kind: 'real', row: 0 }, undefined)
    expect(setItemSpy).toHaveBeenCalledTimes(1)
    expect(rowGroupSections()).toHaveLength(2)
    expect(pendingRows()).toHaveLength(0)
    expect(readStoredSegment('cost')?.row).toBe(0)
    expect(readStoredSegment('cost')?.enabled).toBe(true)
    expect(readStoredSegment('model')?.row).toBe(1)
    expect(segIdsInRow(0)).toEqual(['cwd', 'cost'])
    expect(segIdsInRow(1)).toEqual(['model'])
  })
})
