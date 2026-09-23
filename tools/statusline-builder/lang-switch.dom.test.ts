// @vitest-environment jsdom
/**
 * T5.6（(internal design doc) §D5 A-4「語言切換重繪
 * 五步序」；TASKS.md T5.6）：語言切換鈕 click 後的完整重繪回歸網——三面向
 * 翻轉（`<html lang>`／可見文字／aria-label）＋(5) 播報＋狀態不變＋
 * 冪等（連續切換無殘留）。
 *
 * 五步序本身（main.ts `handleLocaleSwitch`）：(1) 主樹重套 `applyI18n`→
 * (2) rebuild 中欄 segment rows＋刷新左欄目錄項名／row-select 選項→
 * (3) 強制 preview 重 resolve→(4) `<html lang>` 翻轉→(5) 以切換後語言經
 * `#global-live-status` 播報。既有 `i18n-dom.dom.test.ts` 已覆蓋（1）與
 * template clone 時序（示範面），`default-hint.dom.test.ts` 已 byte-lock
 * zh 渲染結果；本檔聚焦「切換當下的追溯翻轉」——即切換**前**已寫入 DOM
 * 的舊語言文字，切換**後**是否正確覆寫為新語言（含 rebuild 後的 clone
 * 實例、default-hint 結構化改造後的 en 輸出、preview 強制 resolve 後的
 * 逐列 aria／「重置」代換）。
 *
 * 全頁面整合測試形（同 bar-toggle.dom.test.ts／i18n-dom.dom.test.ts 先例，
 * 檔頭說明不重複抄錄）：jsdom 剖析真實 index.html 取得 `<body>`，動態
 * import main.ts 觸發其 init()。所有查詢皆於每次斷言時重新
 * `document.querySelector`（不快取跨 click 的節點參照）——rebuild 會
 * 產出全新 `<li>`，快取的舊參照會讀到已離開文件樹的孤兒節點。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from './messages.js'

// 同 pipeline.integration.test.ts 既有 micro-fix 慣例（eztools 環境已知
// 坑）：本檔每案皆 `vi.resetModules()` ＋動態 import 整份 main.ts 觸發真
// 頁面 init()（比其餘僅斷言單一互動的 dom.test 檔案更重——多數案額外
// enableSegment 兩三段＋來回 click 語言鈕觸發整輪 rebuild）。隔離跑
// 每案 ~1.6s，全量 55 檔並行負載下曾實測單案超過 vitest 預設 5000ms
// timeout（純屬負載期間排程延遲，非邏輯迴歸——同檔隔離執行與全量並行
// 結果一致，僅耗時不同）。以檔案級 `vi.setConfig` 一次性把本檔全部
// it 的 timeout 提升為 30s，不外溢其他測試檔。
vi.setConfig({ testTimeout: 30_000 })

const HTML_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

// main.ts 主設定 localStorage 鍵——經無副作用常數模組 config-storage-key.ts
// 單一出口匯入（本檔以 CONFIG_STORAGE_KEY 別名與語言鍵區辨）；語言鍵經
// i18n-dom.ts 的 LANG_STORAGE_KEY 單一出口匯入（同 i18n-dom.dom.test.ts）。
import { STORAGE_KEY as CONFIG_STORAGE_KEY } from './config-storage-key.js'
import { LANG_STORAGE_KEY } from './i18n-dom.js'

async function boot(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

function langToggleBtn(): HTMLButtonElement {
  return document.querySelector('.lang-toggle') as HTMLButtonElement
}

function enableSegment(id: string): void {
  const checkbox = document.getElementById(`${id}-catalog`) as HTMLInputElement | null
  if (checkbox === null) throw new Error(`missing catalog checkbox for ${id}`)
  checkbox.click()
}

function catalogName(id: string): string | null {
  return document.querySelector(`.catalog-item[data-segment-id="${id}"] .catalog-item__name`)?.textContent ?? null
}

function segmentRowName(id: string): string | null {
  return document.querySelector(`.segment-row[data-segment-id="${id}"] .segment-row__name`)?.textContent ?? null
}

function moveUpAria(id: string): string | null {
  return document
    .querySelector(`.segment-row[data-segment-id="${id}"] .segment-row__move-up`)
    ?.getAttribute('aria-label') ?? null
}

function removeAria(id: string): string | null {
  return document
    .querySelector(`.segment-row[data-segment-id="${id}"] .segment-row__remove`)
    ?.getAttribute('aria-label') ?? null
}

function rowGroupHeading(): string | null {
  return document.querySelector('#segment-row-groups .segment-section__heading')?.textContent ?? null
}

function rowSelectOptionTexts(id: string): string[] {
  const select = document.getElementById(`${id}-row`) as HTMLSelectElement | null
  if (select === null) throw new Error(`missing row-select for ${id}`)
  return Array.from(select.options, (o) => o.text)
}

/** 五個 label-based 欄位的提示 span（同 default-hint.dom.test.ts `fieldHint` 慣例）。 */
function fieldHint(controlId: string): string | null {
  const control = document.getElementById(controlId)
  const field = control?.closest('.segment-row__field') ?? null
  return field?.querySelector('.segment-row__default-hint')?.textContent ?? null
}

function mountHint(id: string, mountClass: string): string | null {
  const mount = document.querySelector(`.segment-row[data-segment-id="${id}"] .${mountClass}`)
  return mount?.querySelector('.segment-row__default-hint')?.textContent ?? null
}

function thresholdHint(id: string): string | null {
  const mount = document.querySelector(`.segment-row[data-segment-id="${id}"] .segment-row__threshold-mount`)
  return mount?.querySelector('.segment-row__default-hint')?.textContent ?? null
}

function thresholdOptionText(templateId: string): string | null {
  return document.querySelector(
    `[data-segment-id="context-used"] select.threshold__template option[value="${templateId}"]`,
  )?.textContent ?? null
}

function ansiIndexLabelText(): string | null {
  return document.querySelector('[data-segment-id="cwd"] .color-spinbutton-field__label')?.textContent ?? null
}

function previewGroupAria(): string | null {
  return document.getElementById('preview-terminal')?.getAttribute('aria-label') ?? null
}

function previewFirstRowAria(): string | null {
  return document.getElementById('preview-terminal')?.children[0]?.getAttribute('aria-label') ?? null
}

function liveStatus(): string {
  return document.getElementById('global-live-status')?.textContent ?? ''
}

function storedConfigJson(): string | null {
  return localStorage.getItem(CONFIG_STORAGE_KEY)
}

describe('T5.6 — <html lang> 翻轉', () => {
  it('zh-Hant boot：lang=zh-Hant；click 一次 → en；再 click → 回 zh-Hant', async () => {
    await boot()
    expect(document.documentElement.getAttribute('lang')).toBe('zh-Hant')
    langToggleBtn().click()
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    langToggleBtn().click()
    expect(document.documentElement.getAttribute('lang')).toBe('zh-Hant')
  })
})

describe('T5.6 — 可見文字：rebuild 後追溯翻轉（含 clone 實例／default-hint 結構化）', () => {
  beforeEach(async () => {
    await boot()
    enableSegment('cost') // always，恆適用 row/icon/prefix/color/fgOverride 五欄，無 variants。
    enableSegment('cwd') // always＋有 variants（無 threshold/bar）。
    enableSegment('context-used') // percentage＋barEligible（無 variants）。
  })

  it('切至 en：左欄目錄項名／中欄段名／列群組標題／row-select 選項皆翻轉（rebuild 前這些節點已存在、承載舊語言字面）', () => {
    langToggleBtn().click()
    expect(catalogName('cost')).toBe(t('en').segments.cost.label)
    expect(catalogName('cwd')).toBe(t('en').segments.cwd.label)
    expect(segmentRowName('cost')).toBe(t('en').segments.cost.label)
    expect(segmentRowName('context-used')).toBe(t('en').segments['context-used'].label)
    expect(rowGroupHeading()).toBe(t('en').rowGroup.heading(1))
    expect(rowSelectOptionTexts('cost')).toEqual([t('en').rowSelect.rowOption(1)])
  })

  it('切至 en：八欄位 default-hint 結構化描述正確解讀為英文（收 T5.5「混語形」限制、T5.6 結構化改造驗收）', () => {
    langToggleBtn().click()
    expect(fieldHint('cost-row')).toBe(t('en').defaultHint(t('en').rowGroup.heading(1)))
    expect(fieldHint('cost-row')).toBe('(default: Row 1)')
    expect(fieldHint('cost-icon')).toBe('(default: Shown)')
    expect(fieldHint('cost-prefix')).toBe('(default: (empty))')
    expect(mountHint('cost', 'segment-row__color-mount')).toBe('(default: Terminal default)')
    expect(mountHint('cost', 'segment-row__fg-mount')).toBe('(default: None (not overridden))')
    expect(thresholdHint('context-used')).toBe('(default: None (all 10 buckets use the terminal default color))')
    expect(fieldHint('context-used-bar')).toBe('(default: Off)')
    expect(fieldHint('cwd-variant')).toBe('(default: Full path)')
  })

  it('切回 zh-Hant：全部字面與切換前 byte 一致（雙向往返）', () => {
    const before = {
      catalogCost: catalogName('cost'),
      rowName: segmentRowName('cost'),
      heading: rowGroupHeading(),
      rowOptions: rowSelectOptionTexts('cost'),
      hintRow: fieldHint('cost-row'),
      hintColor: mountHint('cost', 'segment-row__color-mount'),
      hintThreshold: thresholdHint('context-used'),
      hintVariant: fieldHint('cwd-variant'),
    }
    langToggleBtn().click() // → en
    langToggleBtn().click() // → zh-Hant
    expect(catalogName('cost')).toBe(before.catalogCost)
    expect(segmentRowName('cost')).toBe(before.rowName)
    expect(rowGroupHeading()).toBe(before.heading)
    expect(rowSelectOptionTexts('cost')).toEqual(before.rowOptions)
    expect(fieldHint('cost-row')).toBe(before.hintRow)
    expect(mountHint('cost', 'segment-row__color-mount')).toBe(before.hintColor)
    expect(thresholdHint('context-used')).toBe(before.hintThreshold)
    expect(fieldHint('cwd-variant')).toBe(before.hintVariant)
    // 明確字面鎖（同 default-hint.dom.test.ts 既有 zh 斷言）。
    expect(fieldHint('cost-row')).toBe('（預設：第 1 列）')
    expect(thresholdHint('context-used')).toBe('（預設：無（10 桶皆為終端預設色））')
  })

  it('rebuild 後 clone 實例（閾值模板選項／ANSI 索引 label）隨切換一併翻轉（不僅開機期，重繪後仍正確）', () => {
    expect(thresholdOptionText('traffic')).toBe('交通號誌（綠→黃→紅）')
    expect(ansiIndexLabelText()).toBe('ANSI 索引（0–255）')
    langToggleBtn().click()
    expect(thresholdOptionText('traffic')).toBe(t('en').thresholdTemplateLabel.traffic)
    expect(ansiIndexLabelText()).toBe(t('en').colorPicker.ansiIndexLabel)
  })
})

describe('T5.6 — aria-label：段列控件＋preview 逐列（「重置」代換／群組與列前綴）', () => {
  it('段列控件 aria（上移／移除鈕）切換後翻轉', async () => {
    await boot()
    enableSegment('cost')
    langToggleBtn().click()
    expect(moveUpAria('cost')).toBe(t('en').segmentControl.moveUp(t('en').segments.cost.label))
    expect(removeAria('cost')).toBe(t('en').segmentControl.remove(t('en').segments.cost.label))
  })

  it('preview 強制 resolve：群組 aria-label／逐列前綴／「重置」代換詞皆翻轉（reset-5h 段，含 icon ariaText）', async () => {
    await boot()
    enableSegment('reset-5h')

    // zh-Hant 基準（強制 resolve 前，boot 當下即為 zh）。
    expect(previewGroupAria()).toBe(t('zh-Hant').previewAria.groupLabel)
    const zhRow = previewFirstRowAria()
    expect(zhRow).toContain('第 1 列：')
    expect(zhRow).toContain(t('zh-Hant').segments['reset-5h'].ariaText) // icon ariaText。
    expect(zhRow).toContain('重置')
    expect(zhRow).not.toContain('reset')

    langToggleBtn().click()

    expect(previewGroupAria()).toBe(t('en').previewAria.groupLabel)
    const enRow = previewFirstRowAria()
    expect(enRow).toContain('Row 1: ')
    expect(enRow).toContain(t('en').segments['reset-5h'].ariaText)
    expect(enRow).toContain('reset')
    expect(enRow).not.toContain('重置')

    langToggleBtn().click() // 切回 zh：雙向往返亦需正確。

    expect(previewGroupAria()).toBe(t('zh-Hant').previewAria.groupLabel)
    const zhRowAgain = previewFirstRowAria()
    expect(zhRowAgain).toBe(zhRow) // byte 一致，非僅「不含 reset」。
  })
})

describe('T5.6 — (5) 播報：以切換後語言播報新語言名稱', () => {
  it('切至 en 後 live status 含英文切換句；切回 zh 含中文切換句', async () => {
    await boot()
    langToggleBtn().click()
    expect(liveStatus()).toBe(t('en').langToggle.switchedAnnounce)
    langToggleBtn().click()
    expect(liveStatus()).toBe(t('zh-Hant').langToggle.switchedAnnounce)
  })
})

describe('T5.6 — 狀態不變：config／localStorage 不受語言切換影響', () => {
  it('切換語言前後 config 存檔 byte 相同；LANG_STORAGE_KEY 獨立寫入', async () => {
    await boot()
    enableSegment('cost')
    enableSegment('context-used')
    const configBefore = storedConfigJson()
    expect(configBefore).not.toBeNull()

    langToggleBtn().click()
    expect(storedConfigJson()).toBe(configBefore) // 切換語言不觸碰 config 存檔。
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en')

    langToggleBtn().click()
    expect(storedConfigJson()).toBe(configBefore)
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('zh-Hant')
  })
})

describe('T5.6 — 冪等：連續切換多次無殘留、無重複播報疊字', () => {
  it('連續 click 4 次（偶數次回到 zh-Hant）→ 字面與初始 boot 狀態 byte 一致', async () => {
    await boot()
    enableSegment('cost')
    const initialName = segmentRowName('cost')
    const initialHint = fieldHint('cost-row')
    const initialHeading = rowGroupHeading()

    for (let i = 0; i < 4; i++) langToggleBtn().click()

    expect(document.documentElement.getAttribute('lang')).toBe('zh-Hant')
    expect(segmentRowName('cost')).toBe(initialName)
    expect(fieldHint('cost-row')).toBe(initialHint)
    expect(rowGroupHeading()).toBe(initialHeading)
    // 播報句本身非疊字（單次切換句，非重複拼接）。
    expect(liveStatus()).toBe(t('zh-Hant').langToggle.switchedAnnounce)
    expect(liveStatus().split(t('zh-Hant').langToggle.switchedAnnounce)).toHaveLength(2) // 恰出現一次。
  })

  it('連續 click 3 次（奇數次停在 en）→ 每步文字皆正確、非累積疊加', async () => {
    await boot()
    enableSegment('cost')
    langToggleBtn().click() // en
    langToggleBtn().click() // zh-Hant
    langToggleBtn().click() // en
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    expect(segmentRowName('cost')).toBe(t('en').segments.cost.label)
    expect(fieldHint('cost-row')).toBe('(default: Row 1)')
    expect(liveStatus()).toBe(t('en').langToggle.switchedAnnounce)
  })
})
