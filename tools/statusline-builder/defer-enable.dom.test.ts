// @vitest-environment jsdom
/**
 * T3.1（(internal design doc) §D3 A-1「defer-commit
 * 旗標」）：main.ts 新增匯出 `markSegmentEnabledDeferred`（供 T3.2
 * commitSegmentMove 串接使用之積木，本身尚無 UI 接線）的回歸網。鎖死
 * 兩件事：
 * (1) defer 路徑本身：只 mutate `seg.enabled`，不 clamp row、不動
 *     rowSlots／rowSeparators、不 syncSegmentEnabledUi、不 commitConfig、
 *     不播報、不回焦。
 * (2) 既有單獨勾選路徑（setSegmentEnabled，非 defer）行為零變——本次
 *     變更未觸及 setSegmentEnabled 本體，此案顯式鎖住其契約（clamp／
 *     commit／UI 同步／播報／回焦皆與變更前一致）。
 *
 * main.ts 全模組頂層即執行 init()（見 bar-toggle.dom.test.ts 檔頭同一段
 * 說明），本檔沿用其「灌真實 index.html body → 動態 import 觸發 init()」
 * 全頁面整合測試形；唯一差異：本檔額外需要 `markSegmentEnabledDeferred`
 * 這個尚未有 UI 接線的匯出本身可直接呼叫，故 boot 皆回傳 dynamic import
 * 的模組命名空間物件，供各案直接呼叫（main.ts 過去不匯出任何符號，見
 * bar-toggle.dom.test.ts 檔頭——本次新增的匯出僅此一個測試用積木，
 * 不影響既有「全頁面整合測試」慣例）。
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

// 直接匯入以取得 main.js 匯出型別（動態 import 於 boot() 內才實際觸發
// init 副作用；此處僅借用型別，不在頂層執行）。
type MainModule = typeof import('./main.js')

// main.ts 主設定 localStorage 鍵——經 config-storage-key.ts 單一出口匯入（同 bar-toggle.dom.test.ts）。
import { STORAGE_KEY } from './config-storage-key.js'

interface StoredSegment {
  id: string
  enabled?: boolean
  row?: number
}

/** 讀 localStorage 存檔中某段目前狀態（main.ts 每次 commitConfig 皆 persist，見其文件）。 */
function readStoredSegment(id: string): StoredSegment | undefined {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return undefined
  const parsed = JSON.parse(raw) as { segments: StoredSegment[] }
  return parsed.segments.find((seg) => seg.id === id)
}

/**
 * 種子存檔：`model` 已啟用（row 0）——建立現行僅 1 個渲染列
 * （`lastRowGroups.length === 1`）；`git-branch` 停用中、帶越界舊 row 值
 * 5（`clampReenableRow(5, 1) === 0`，見 row-select.test.ts 組合矩陣）。
 * 用越界值區辨「defer 路徑：不 clamp」與「一般路徑：既有 clamp 契約
 * 不變」——兩案共用同一種子，僅呼叫路徑不同。
 */
const STORAGE_SEED = {
  version: 2,
  mode: 'plain',
  separator: { kind: 'preset', value: '|' },
  lastArrowCap: true,
  powerlineArrow: false,
  segments: [
    { id: 'model', enabled: true, icon: true, color: { kind: 'default' }, row: 0 },
    { id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' }, row: 5 },
  ],
}

/** 清空 localStorage、灌入上述種子存檔、重灌乾淨 DOM＋重置模組快取後啟動 main.ts。 */
async function bootWithSeed(): Promise<MainModule> {
  localStorage.clear()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(STORAGE_SEED))
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

/** 模擬使用者於左欄目錄勾選啟用某段（同 setSegmentEnabled 入口，非 defer）。 */
function enableSegment(id: string): void {
  catalogCheckbox(id).click()
}

/** 段的完整控件列 `<li>` 目前是否仍屬隱藏池（未被 syncSegmentEnabledUi／layoutSegmentContainers 搬出）。 */
function inHiddenPool(id: string): boolean {
  return row(id).closest('#segment-hidden-pool') !== null
}

function liveStatus(): string {
  return document.getElementById('global-live-status')!.textContent ?? ''
}

function moveStatus(): string {
  return document.getElementById('segment-move-status')!.textContent ?? ''
}

describe('T3.1 — markSegmentEnabledDeferred（defer-commit 旗標）', () => {
  let mod: MainModule

  beforeAll(async () => {
    mod = await bootWithSeed()
  })

  it('前置條件：git-branch 種子為停用中、row=5（越界舊值），仍在隱藏池、checkbox 未勾選', () => {
    expect(readStoredSegment('git-branch')?.enabled).toBe(false)
    expect(inHiddenPool('git-branch')).toBe(true)
    expect(catalogCheckbox('git-branch').checked).toBe(false)
  })

  it('呼叫後回傳的 SegmentConfig 參照 enabled===true，但 row 維持 5——未被 clampReenableRow 改寫（此刻 lastRowGroups.length===1，一般路徑會 clamp 為 0，見下方回歸 describe 對照）', () => {
    const seg = mod.markSegmentEnabledDeferred('git-branch')
    expect(seg?.enabled).toBe(true)
    expect(seg?.row).toBe(5)
  })

  it('未 commitConfig：localStorage 仍是呼叫前的停用態（未 persist，enabled／row 皆未變）', () => {
    expect(readStoredSegment('git-branch')?.enabled).toBe(false)
    expect(readStoredSegment('git-branch')?.row).toBe(5)
  })

  it('未 syncSegmentEnabledUi：li 仍留隱藏池、checkbox 視覺仍未勾選、.segment-row--enabled 未套用', () => {
    expect(inHiddenPool('git-branch')).toBe(true)
    expect(catalogCheckbox('git-branch').checked).toBe(false)
    expect(row('git-branch').classList.contains('segment-row--enabled')).toBe(false)
  })

  it('未播報：#global-live-status／#segment-move-status 內容皆未變（維持初始空字串）', () => {
    expect(liveStatus()).toBe('')
    expect(moveStatus()).toBe('')
  })

  it('未回焦：document.activeElement 不是該段的目錄 checkbox', () => {
    expect(document.activeElement).not.toBe(catalogCheckbox('git-branch'))
  })

  it('冪等：對已被 defer 標記的段再次呼叫仍安全——回傳同一參照、row 不變、無副作用', () => {
    const seg = mod.markSegmentEnabledDeferred('git-branch')
    expect(seg?.enabled).toBe(true)
    expect(seg?.row).toBe(5)
    expect(liveStatus()).toBe('')
    expect(inHiddenPool('git-branch')).toBe(true)
  })

  it('查無 id（防禦）：回傳 undefined，不丟例外', () => {
    expect(mod.markSegmentEnabledDeferred('does-not-exist')).toBeUndefined()
  })
})

describe('T3.1 回歸 — 既有單獨勾選路徑（setSegmentEnabled，非 defer）行為零變', () => {
  let mod: MainModule

  beforeAll(async () => {
    mod = await bootWithSeed()
  })

  it('前置條件：與 defer 案同一種子，git-branch 停用中、row=5、仍在隱藏池', () => {
    expect(readStoredSegment('git-branch')?.enabled).toBe(false)
    expect(inHiddenPool('git-branch')).toBe(true)
  })

  it('左欄勾選 git-branch：row 被 clampReenableRow 改寫為 0（既有契約——現行僅 1 列，越界舊值 5 落回末列 0；defer 路徑不會如此，見上方 describe）', () => {
    enableSegment('git-branch')
    expect(readStoredSegment('git-branch')?.row).toBe(0)
  })

  it('commitConfig 已 persist：localStorage enabled 轉 true', () => {
    expect(readStoredSegment('git-branch')?.enabled).toBe(true)
  })

  it('syncSegmentEnabledUi 已同步：li 移出隱藏池、checkbox 勾選、.segment-row--enabled 套用', () => {
    expect(inHiddenPool('git-branch')).toBe(false)
    expect(catalogCheckbox('git-branch').checked).toBe(true)
    expect(row('git-branch').classList.contains('segment-row--enabled')).toBe(true)
  })

  it('回焦：焦點回到左欄 checkbox（既有語意，見 setSegmentEnabled 文件「連續勾選 N 段時焦點不跳失」）', () => {
    expect(document.activeElement).toBe(catalogCheckbox('git-branch'))
  })

  it('mod.markSegmentEnabledDeferred 匯出存在，供 T3.2 銜接（本檔僅驗證積木本身，串接留待 T3.2）', () => {
    expect(typeof mod.markSegmentEnabledDeferred).toBe('function')
  })
})
