// @vitest-environment jsdom
/**
 * T3.3（(internal design doc) §D3 A-1／A-2「目錄項
 * draggable＋來源感知冪等清理」）／T3.4（§D3 A-3「播報語意」）合併回歸網。
 *
 * jsdom 無原生 DnD（無 `DragEvent` 建構子）——本檔以 `MouseEvent(type, …)`
 * 手工 dispatch 模擬 dragstart／dragend／drop（處理器僅以 `event.target`／
 * `event.dataTransfer?.…`／`event.clientY` 消費事件，皆對 MouseEvent 相容
 * 或有 optional chaining 防禦，故可行）；真正的原生拖曳行為（游標／
 * dataTransfer 實際承載）歸 T3.5／T6.1 e2e，本檔僅驗證邏輯層：
 * (1) `endDragCleanup` 來源感知冪等收尾（drop 不待 dragend 亦不殘留）；
 * (2) 目錄項 dragstart 的 checkbox 命中區豁免；
 * (3) 目錄項 dragstart → 落點 drop 的完整鏈路（含停用段 enable-into-target
 *     分支與已啟用段退化為純 move 分支）；
 * (4) `performCrossRowMove` 的 origin 感知播報模板（'catalog-add' vs
 *     'move'）；
 * (5) `setSegmentEnabled` 啟用分支（checkbox 勾選，非拖曳）的新增落列
 *     播報，含 BACKLOG:37「clamp 落點與顯示編號不同」情境。
 *
 * 沿用 enable-into-target.dom.test.ts／defer-enable.dom.test.ts 的「灌真實
 * index.html body → 動態 import 觸發 init()」全頁面整合測試形。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const HTML_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

// main.ts 主設定 localStorage 鍵——經 config-storage-key.ts 單一出口匯入（同 bar-toggle.dom.test.ts）。
import { STORAGE_KEY } from './config-storage-key.js'

type MainModule = typeof import('./main.js')

interface StoredSegment {
  id: string
  enabled?: boolean
  row?: number
}

interface StoredConfig {
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

/** 清空 localStorage、灌入種子存檔、重灌乾淨 DOM＋重置模組快取後啟動 main.ts。 */
async function bootWithSeed(config: unknown): Promise<MainModule> {
  localStorage.clear()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  return (await import('./main.js')) as MainModule
}

function row(id: string): HTMLLIElement {
  const el = document.querySelector<HTMLLIElement>(`.segment-row[data-segment-id="${id}"]`)
  if (el === null) throw new Error(`missing segment row for ${id}`)
  return el
}

function catalogItem(id: string): HTMLLIElement {
  const el = document.querySelector<HTMLLIElement>(`.catalog-item[data-segment-id="${id}"]`)
  if (el === null) throw new Error(`missing catalog item for ${id}`)
  return el
}

function catalogCheckbox(id: string): HTMLInputElement {
  const el = document.getElementById(`${id}-catalog`) as HTMLInputElement | null
  if (el === null) throw new Error(`missing catalog checkbox for ${id}`)
  return el
}

function inHiddenPool(id: string): boolean {
  return row(id).closest('#segment-hidden-pool') !== null
}

function rowGroupSections(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.segment-row-group')]
}

function pendingRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.segment-pending-row')]
}

function rowSelect(id: string): HTMLSelectElement {
  const el = document.getElementById(`${id}-row`) as HTMLSelectElement | null
  if (el === null) throw new Error(`missing row select for ${id}`)
  return el
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function moveStatus(): string {
  return document.getElementById('segment-move-status')!.textContent ?? ''
}

/** 手工模擬 dragstart／dragend／drop（jsdom 無 DragEvent，見檔頭說明）。 */
function fireDrag(el: Element, type: 'dragstart' | 'dragend' | 'drop', clientY = 0): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY })
  el.dispatchEvent(event)
  return event
}

const SEED_BASE = {
  version: 2,
  mode: 'plain' as const,
  separator: { kind: 'preset', value: '|' },
  lastArrowCap: true,
  powerlineArrow: false,
}

// ── (1) T3.3 — endDragCleanup 來源感知冪等清理 ──

describe('T3.3 — endDragCleanup（drop 已跑清理、dragend 再跑一次仍安全）', () => {
  let mod: MainModule

  beforeAll(async () => {
    mod = await bootWithSeed({
      ...SEED_BASE,
      segments: [
        { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
      ],
    })
    void mod
  })

  it('drop 發生（未待 dragend）：opacity 已復原、body 無 is-segment-dragging 殘留、config 已真的移動', () => {
    fireDrag(row('cwd'), 'dragstart')
    // dragstart 後同步（同一輪任務內，rAF 尚未執行）立即 drop——驗證
    // endDragCleanup 的 cancelAnimationFrame 確實搶在 rAF 回呼之前執行。
    fireDrag(row('model'), 'drop')
    expect(row('cwd').style.opacity).toBe('')
    expect(document.body.classList.contains('is-segment-dragging')).toBe(false)
    expect(readStoredSegment('cwd')?.row).toBe(readStoredSegment('model')?.row) // 真的移動到 model 所在列。
  })

  it('等待一個動畫幀後 body 仍無 is-segment-dragging（證明 rAF 回呼真的被取消，非僅時機未到）', async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expect(document.body.classList.contains('is-segment-dragging')).toBe(false)
  })

  it('補發 dragend（模擬原生保證隨後仍會觸發）：無 throw、opacity／class 仍乾淨（冪等）', () => {
    expect(() => fireDrag(row('cwd'), 'dragend')).not.toThrow()
    expect(row('cwd').style.opacity).toBe('')
    expect(document.body.classList.contains('is-segment-dragging')).toBe(false)
  })
})

// ── (2) T3.3 — 目錄項 checkbox 命中區豁免 ──

describe('T3.3 — 目錄項 dragstart 的 checkbox 命中區豁免', () => {
  beforeAll(async () => {
    await bootWithSeed({
      ...SEED_BASE,
      segments: [
        { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' } },
      ],
    })
  })

  it('對 checkbox 本身派發 dragstart：被拒（preventDefault），不進入拖曳', () => {
    const event = fireDrag(catalogCheckbox('git-branch'), 'dragstart')
    expect(event.defaultPrevented).toBe(true)
  })

  it('豁免後 draggingId 未設：對既有列派發 drop 為 no-op（config 不變、無 throw——drop handler 的 draggingId===null 早退分支）', () => {
    const before = readStoredSegment('git-branch')
    expect(() => fireDrag(row('cwd'), 'drop')).not.toThrow()
    expect(readStoredSegment('git-branch')).toEqual(before)
    expect(readStoredSegment('cwd')?.row).toBe(0) // cwd 自身亦未被誤搬移。
  })

  it('對名稱文字（非 checkbox）派發 dragstart：不被攔截（對照組，豁免僅限命中區）', () => {
    const nameSpan = catalogItem('git-branch').querySelector('.catalog-item__name')!
    const event = fireDrag(nameSpan, 'dragstart')
    expect(event.defaultPrevented).toBe(false)
  })
})

// ── (3)(4) T3.3 全鏈路＋T3.4 origin 播報：目錄拖入停用段 ──

describe('T3.3＋T3.4 — 目錄拖入停用段：enable-into-target 分支＋「已加入」播報', () => {
  let mod: MainModule

  beforeAll(async () => {
    mod = await bootWithSeed({
      ...SEED_BASE,
      segments: [
        { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' } },
      ],
    })
    void mod
  })

  it('前置條件：git-branch 停用中、在隱藏池、目錄 checkbox 未勾選', () => {
    expect(inHiddenPool('git-branch')).toBe(true)
    expect(catalogCheckbox('git-branch').checked).toBe(false)
  })

  it('目錄項 dragstart（非 checkbox）→ drop 在 cwd 所在列 → 啟用、退出隱藏池、checkbox 勾選、恰為 enable-into-target 分支', () => {
    const dragstart = fireDrag(catalogItem('git-branch'), 'dragstart')
    expect(dragstart.defaultPrevented).toBe(false)
    fireDrag(row('cwd'), 'drop')
    expect(readStoredSegment('git-branch')?.enabled).toBe(true)
    expect(inHiddenPool('git-branch')).toBe(false)
    expect(catalogCheckbox('git-branch').checked).toBe(true)
  })

  it('播報使用「已加入」模板（非「移至」），含視覺顯示編號', () => {
    expect(moveStatus()).toMatch(/已加入第 \d+ 列第 \d+ 位（共 \d+）/)
    expect(moveStatus()).not.toContain('移至')
  })

  it('拖曳收尾乾淨：目錄項 opacity 已復原（endDragCleanup 依 dragSource=catalog 查對 catalogItemElements）', () => {
    expect(catalogItem('git-branch').style.opacity).toBe('')
  })
})

// ── (4) T3.4 — 已啟用目錄項被拖入退化為純 move（非 catalog-add） ──

describe('T3.4 — 已啟用目錄項被拖入：退化為純 move，播「移至」', () => {
  beforeAll(async () => {
    await bootWithSeed({
      ...SEED_BASE,
      segments: [
        { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
      ],
    })
  })

  it('拖曳已啟用的目錄項 model（非 checkbox 命中區）落到 cwd 所在列 → 移動成功、播「移至」非「已加入」', () => {
    fireDrag(catalogItem('model'), 'dragstart')
    fireDrag(row('cwd'), 'drop')
    expect(readStoredSegment('model')?.row).toBe(0)
    expect(moveStatus()).toContain('移至')
    expect(moveStatus()).not.toContain('已加入')
  })
})

// ── (5) T3.4 — setSegmentEnabled 啟用分支（checkbox）新增落列播報 ──

describe('T3.4 — checkbox 啟用分支落列播報（含 BACKLOG:37 clamp 落點與顯示編號不同情境）', () => {
  let mod: MainModule

  beforeAll(async () => {
    // 沿用 defer-enable.dom.test.ts 同款越界種子：model 已啟用 row=0
    // （現行僅 1 列），git-branch 停用中、帶越界舊 row 值 5。
    mod = await bootWithSeed({
      ...SEED_BASE,
      segments: [
        { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' }, row: 5 },
      ],
    })
    void mod
  })

  it('勾選 git-branch → row 被 clamp 為 0（既有契約）、播報「已加入第 1 列第 2 位（共 2）」（視覺顯示編號，非原始越界值）', () => {
    catalogCheckbox('git-branch').click()
    expect(readStoredSegment('git-branch')?.row).toBe(0)
    expect(moveStatus()).toBe(`${descriptorLabel('git-branch')} 已加入第 1 列第 2 位（共 2）`)
  })
})

describe('T3.4 — checkbox 啟用分支：clamp 落點併入既有多段列（顯示編號與 clamp 後 row 值不同）', () => {
  let mod: MainModule

  beforeAll(async () => {
    mod = await bootWithSeed({
      ...SEED_BASE,
      segments: [
        { id: 'cwd', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
        { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 1 },
        { id: 'cost', enabled: true, icon: true, color: { kind: 'default' }, row: 2 },
        { id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' }, row: 5 },
      ],
    })
    // 把 model（row1，唯一段）併入 cost 所在列（row2）→ row1 原地耗盡為
    // 中間暫存列（rowSlots=[real,pending,real]，同 T3.2 情境 2 手法）。
    setSelectValue(rowSelect('model'), '2')
    void mod
  })

  it('前置條件：合併後 2 真實列＋1 中間 pending', () => {
    expect(rowGroupSections()).toHaveLength(2)
    expect(pendingRows()).toHaveLength(1)
  })

  it('勾選 git-branch → clamp 落入 cost/model 所在真實列（非中間 pending 空列），播報之顯示編號反映 slot 位置（第 3 列，非 clamp 後的 row 值 1＋1）', () => {
    catalogCheckbox('git-branch').click()
    // clampReenableRow(5, 2) === 1——與 cost/model 同一真實列（real index 1）。
    expect(readStoredSegment('git-branch')?.row).toBe(1)
    expect(inHiddenPool('git-branch')).toBe(false)
    // real index 1 對應 rowSlots=[real,pending,real] 的 slot 2 → 顯示「第 3 列」
    // ——與其 clamp 後 row 值（1，若誤用會播「第 2 列」）不同，正是 BACKLOG:37
    // 「clamp 落點與顯示編號不符」的直接證據。
    expect(moveStatus()).toContain('已加入第 3 列')
  })
})

/** 段 id → descriptor label（測試斷言用；main.ts 未匯出 DESCRIPTORS_BY_ID，改由 catalog 目錄項名稱節點反查，單一事實來源）。 */
function descriptorLabel(id: string): string {
  return catalogItem(id).querySelector('.catalog-item__name')!.textContent ?? ''
}
