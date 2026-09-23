// @vitest-environment jsdom
/**
 * T2.2（(internal design doc) §D2「預設值標示」；
 * TASKS.md T2.2）：main.ts buildSegmentRow 的八欄位（列位／顯示文字／
 * 前綴／顯示樣式／顏色／fg 覆寫／閾值／bar）label 後綴「（預設：X）」
 * 提示——選項 A（恆顯示）＋選項 C（現值＝預設時淡化，main.ts
 * syncDefaultHintDims）。回歸網比照既有 bar-toggle.dom.test.ts 的「先以
 * jsdom 剖析真實 index.html 取得 <body>、動態 import main.ts 觸發其
 * init()」全頁面整合測試形（見該檔檔頭說明，不重複抄錄）。
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

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（同 bar-toggle.dom.test.ts）。 */
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

/**
 * row／icon／prefix／variant／bar 五個 label-based 欄位的提示 span 共用
 * 查找法：控件所在 `.segment-row__field` 內僅有一組 label＋一個提示
 * span（見 main.ts appendDefaultHint 呼叫處，逐欄位各自的 field 容器）。
 */
function fieldHint(controlId: string): HTMLElement {
  const control = document.getElementById(controlId)
  if (control === null) throw new Error(`missing control #${controlId}`)
  const field = control.closest('.segment-row__field')
  if (field === null) throw new Error(`missing .segment-row__field for #${controlId}`)
  const hint = field.querySelector<HTMLElement>('.segment-row__default-hint')
  if (hint === null) throw new Error(`missing default-hint for #${controlId}`)
  return hint
}

/** color／fgOverride 兩欄無獨立 label——提示掛在各自 mount div（見 main.ts）。 */
function mountHint(id: string, mountClass: string): HTMLElement {
  const mount = row(id).querySelector(`.${mountClass}`)
  if (mount === null) throw new Error(`missing ${mountClass} for ${id}`)
  const hint = mount.querySelector<HTMLElement>('.segment-row__default-hint')
  if (hint === null) throw new Error(`missing default-hint in ${mountClass} for ${id}`)
  return hint
}

/** threshold 欄無獨立 label——提示掛在 disclosure 觸發鈕（見 main.ts）。 */
function thresholdHint(id: string): HTMLElement {
  const mount = row(id).querySelector('.segment-row__threshold-mount')
  if (mount === null) throw new Error(`missing threshold mount for ${id}`)
  const hint = mount.querySelector<HTMLElement>('.segment-row__default-hint')
  if (hint === null) throw new Error(`missing threshold default-hint for ${id}`)
  return hint
}

const AT_DEFAULT_CLASS = 'segment-row__default-hint--at-default'

function isDimmed(hint: HTMLElement): boolean {
  return hint.classList.contains(AT_DEFAULT_CLASS)
}

describe('T2.2 — 八欄位預設值標示：applicable 欄位齊全＋不適用欄位不渲染', () => {
  beforeAll(async () => {
    await boot()
    enableSegment('context-used') // percentage＋barEligible，無 variants。
    enableSegment('cwd') // always＋有 variants，非 percentage（無 threshold／bar）。
  })

  it('context-used：row/icon/prefix/color/fgOverride/threshold/bar 七欄提示齊全，皆非空字串', () => {
    expect(fieldHint('context-used-row').textContent).toBe('（預設：第 1 列）')
    expect(fieldHint('context-used-icon').textContent).toBe('（預設：顯示）')
    expect(fieldHint('context-used-prefix').textContent).toBe('（預設：（空））')
    expect(mountHint('context-used', 'segment-row__color-mount').textContent).toBe('（預設：終端預設）')
    expect(mountHint('context-used', 'segment-row__fg-mount').textContent).toBe('（預設：無（未覆寫））')
    expect(thresholdHint('context-used').textContent).toBe('（預設：無（10 桶皆為終端預設色））')
    expect(fieldHint('context-used-bar').textContent).toBe('（預設：關閉）')
  })

  it('context-used 無 variants → 整組 .segment-row__variant-field 不渲染（無標示可言）', () => {
    expect(row('context-used').querySelector('.segment-row__variant-field')).toBeNull()
  })

  it('cwd 有 variants → variant 欄提示存在，文字＝descriptor.variants[0]（\'full\'）之顯示名「完整路徑」', () => {
    expect(fieldHint('cwd-variant').textContent).toBe('（預設：完整路徑）')
  })

  it('cwd 非 percentage／非 barEligible → 整組 threshold／bar 欄不渲染（無標示可言）', () => {
    expect(row('cwd').querySelector('.segment-row__threshold-mount')).toBeNull()
    expect(row('cwd').querySelector('.segment-row__bar-field')).toBeNull()
  })

  it('所有提示 span 皆 aria-hidden="true"（純視覺，不進 accessible name）', () => {
    const hints = [
      fieldHint('context-used-row'),
      fieldHint('context-used-icon'),
      fieldHint('context-used-prefix'),
      mountHint('context-used', 'segment-row__color-mount'),
      mountHint('context-used', 'segment-row__fg-mount'),
      thresholdHint('context-used'),
      fieldHint('context-used-bar'),
      fieldHint('cwd-variant'),
    ]
    for (const hint of hints) expect(hint.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('T2.2 選項 C — 現值＝預設時淡化，變更後翻轉', () => {
  beforeAll(async () => {
    await boot()
    enableSegment('context-used')
    enableSegment('cwd')
  })

  it('初始狀態：新啟用段所有 applicable 欄位現值皆＝預設 → 提示皆淡化', () => {
    expect(isDimmed(fieldHint('context-used-row'))).toBe(true)
    expect(isDimmed(fieldHint('context-used-icon'))).toBe(true)
    expect(isDimmed(fieldHint('context-used-prefix'))).toBe(true)
    expect(isDimmed(mountHint('context-used', 'segment-row__color-mount'))).toBe(true)
    expect(isDimmed(mountHint('context-used', 'segment-row__fg-mount'))).toBe(true)
    expect(isDimmed(thresholdHint('context-used'))).toBe(true)
    expect(isDimmed(fieldHint('context-used-bar'))).toBe(true)
    expect(isDimmed(fieldHint('cwd-variant'))).toBe(true)
  })

  it('取消「顯示文字」（icon: true→false，≠預設）→ icon 提示淡化解除；其餘欄位不受影響', () => {
    const iconInput = document.getElementById('context-used-icon') as HTMLInputElement
    iconInput.click()
    expect(isDimmed(fieldHint('context-used-icon'))).toBe(false)
    expect(isDimmed(fieldHint('context-used-prefix'))).toBe(true) // 對照組：未變動欄位維持淡化。
  })

  it('重新勾選「顯示文字」（false→true，回到預設）→ icon 提示淡化恢復', () => {
    const iconInput = document.getElementById('context-used-icon') as HTMLInputElement
    iconInput.click()
    expect(isDimmed(fieldHint('context-used-icon'))).toBe(true)
  })

  it('前綴輸入非空值（≠預設「（空）」）→ prefix 提示淡化解除', () => {
    const prefixInput = document.getElementById('context-used-prefix') as HTMLInputElement
    prefixInput.value = 'X'
    prefixInput.dispatchEvent(new Event('input', { bubbles: true }))
    expect(isDimmed(fieldHint('context-used-prefix'))).toBe(false)
  })

  it('前綴清空（回到預設空字串）→ prefix 提示淡化恢復', () => {
    const prefixInput = document.getElementById('context-used-prefix') as HTMLInputElement
    prefixInput.value = ''
    prefixInput.dispatchEvent(new Event('input', { bubbles: true }))
    expect(isDimmed(fieldHint('context-used-prefix'))).toBe(true)
  })

  it('開啟長條圖（bar: undefined→true，≠預設「關閉」）→ bar 提示淡化解除；且連帶材料化 threshold（≠預設「無」）→ threshold 提示同步解除淡化（同一次 commitConfig 收束，一次互動牽動兩欄）', () => {
    const barInput = document.getElementById('context-used-bar') as HTMLInputElement
    barInput.click()
    expect(isDimmed(fieldHint('context-used-bar'))).toBe(false)
    expect(isDimmed(thresholdHint('context-used'))).toBe(false)
  })

  it('cwd 顯示樣式改選 basename（≠預設 \'full\'）→ variant 提示淡化解除；改回 full → 恢復淡化', () => {
    const variantSelect = document.getElementById('cwd-variant') as HTMLSelectElement
    variantSelect.value = 'basename'
    variantSelect.dispatchEvent(new Event('change', { bubbles: true }))
    expect(isDimmed(fieldHint('cwd-variant'))).toBe(false)

    variantSelect.value = 'full'
    variantSelect.dispatchEvent(new Event('change', { bubbles: true }))
    expect(isDimmed(fieldHint('cwd-variant'))).toBe(true)
  })
})
