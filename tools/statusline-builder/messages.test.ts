/**
 * T5.1（(internal design doc) §D5 A-1／A-2；PLAN Spike 5）：
 * messages.ts 純核心單元測試。
 *
 * 本檔（連同 messages.ts）不 import 任何 DOM-facing 模組——本測試檔本身
 * 在本專案 vitest 預設環境（node，見 vite.config.ts 無 environment 覆寫；
 * `.dom.test.ts` 才以 `// @vitest-environment jsdom` pragma 另行加開）
 * 即可順利執行，即為「零 DOM」自證：若 messages.ts 意外 import 到
 * document/window 相依模組，node 環境下 import 階段就會拋錯，本檔任何一
 * 個 case 皆無法通過。
 *
 * 四類案：
 * 1. meta：zh-Hant／en 的 key 集合（含巢狀域 segments/rowSelect/announce）
 *    深度相等。
 * 2. 插值函式：兩語言各抽數鍵驗輸出含代入的參數。
 * 3. segment label/ariaText：兩語言 30+30 全量非空；zh-Hant 與
 *    segments.ts 現行 SEGMENT_DESCRIPTORS 字面逐段比對一致（唯讀 import
 *    segments.ts——它是純函式目錄模組，零 DOM，可安全 import 供比對；
 *    本案同時是「字典抄寫零漂移」的機械證據，非僅存在性檢查）。
 * 4. 注入 PoC：純函式語境內以 `(locale, messages)` 兩參數呼叫一個自訂
 *    組句函式，證明 messages.ts 的「純模組注入」存取形式在下游可行——
 *    不改動任何既有模組（T5.2/T5.3 的事）。
 */
import { describe, expect, it } from 'vitest'
import { SEGMENT_DESCRIPTORS } from './segments.js'
import { DEFAULT_LOCALE, t, type Locale, type Messages } from './messages.js'

const LOCALES: Locale[] = ['zh-Hant', 'en']

// ── 1. meta：key 集合相等 ──

/** 遞迴收集物件的 key path 集合（函式值視為葉節點，不展開其內部）。 */
function collectKeyPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return []
  const paths: string[] = []
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    paths.push(path)
    const value = (obj as Record<string, unknown>)[key]
    if (typeof value === 'object' && value !== null) {
      paths.push(...collectKeyPaths(value, path))
    }
  }
  return paths.sort()
}

describe('meta：zh-Hant／en key 集合相等', () => {
  it('DEFAULT_LOCALE 為 zh-Hant', () => {
    expect(DEFAULT_LOCALE).toBe('zh-Hant')
  })

  it('兩語言字典的 key path 集合（含巢狀域）深度相等', () => {
    const zhKeys = collectKeyPaths(t('zh-Hant'))
    const enKeys = collectKeyPaths(t('en'))
    expect(enKeys).toEqual(zhKeys)
  })

  it('segments 域涵蓋 segments.ts 現行全量 SegmentId（兩語言皆同）', () => {
    const expectedIds = SEGMENT_DESCRIPTORS.map((d) => d.id).sort()
    for (const locale of LOCALES) {
      const actualIds = Object.keys(t(locale).segments).sort()
      expect(actualIds).toEqual(expectedIds)
    }
  })

  it('情境縮短文字（Short）為對應全文（Full）的前綴子字串（WCAG 2.5.3 Label in Name，兩語言四組全掃）', () => {
    const scenarioKeys = ['scenarioFull', 'scenarioEarly', 'scenarioCond', 'scenarioWin'] as const
    for (const locale of LOCALES) {
      const ui = t(locale).ui
      for (const key of scenarioKeys) {
        const short = ui[`${key}Short`]
        const full = ui[`${key}Full`]
        expect(full.startsWith(short)).toBe(true)
      }
    }
  })
})

// ── 2. 插值函式：輸出含代入參數 ──

describe('插值函式：輸出含代入參數（兩語言各抽數鍵）', () => {
  it.each(LOCALES)('%s：rowSelect.rowOption／rowOptionPending 含列號', (locale) => {
    const m = t(locale)
    expect(m.rowSelect.rowOption(3)).toContain('3')
    expect(m.rowSelect.rowOptionPending(5)).toContain('5')
    // 兩者不應同形（新列版須與真實列版有可辨識差異）。
    expect(m.rowSelect.rowOptionPending(3)).not.toBe(m.rowSelect.rowOption(3))
  })

  it.each(LOCALES)('%s：announce.move 含 label／row／position／rowSize 四參數', (locale) => {
    const out = t(locale).announce.move('模型', 2, 3, 4)
    expect(out).toContain('模型')
    expect(out).toContain('2')
    expect(out).toContain('3')
    expect(out).toContain('4')
  })

  it.each(LOCALES)('%s：announce.catalogAdd 含 label／row／position／rowSize 四參數', (locale) => {
    const out = t(locale).announce.catalogAdd('Cache 命中率', 1, 1, 1)
    expect(out).toContain('Cache 命中率')
    expect(out).toContain('1')
  })

  it.each(LOCALES)('%s：announce.removed 含 label', (locale) => {
    expect(t(locale).announce.removed('版本')).toContain('版本')
  })

  it.each(LOCALES)('%s：announce.rowDeleted 含 row／count 兩參數', (locale) => {
    const out = t(locale).announce.rowDeleted(2, 3)
    expect(out).toContain('2')
    expect(out).toContain('3')
  })
})

// ── 3. segment label/ariaText：全量非空＋zh-Hant 與 segments.ts 零漂移 ──

describe('segment label／ariaText：兩語言 30+30 全量非空', () => {
  it.each(LOCALES)('%s：每段 label／ariaText 皆非空字串', (locale) => {
    const { segments } = t(locale)
    for (const id of Object.keys(segments) as (keyof Messages['segments'])[]) {
      expect(segments[id].label.length).toBeGreaterThan(0)
      expect(segments[id].ariaText.length).toBeGreaterThan(0)
    }
  })

  it('段數恰為 segments.ts 現行段數（回歸網：目錄擴充需同步補字典）', () => {
    const zhCount = Object.keys(t('zh-Hant').segments).length
    const enCount = Object.keys(t('en').segments).length
    expect(zhCount).toBe(SEGMENT_DESCRIPTORS.length)
    expect(enCount).toBe(SEGMENT_DESCRIPTORS.length)
  })
})

describe('zh-Hant 字典抄寫零漂移：逐段比對 segments.ts 現行字面', () => {
  it.each(SEGMENT_DESCRIPTORS.map((d) => [d.id, d.label, d.icon.ariaText] as const))(
    '%s：zh-Hant label／ariaText 與 SEGMENT_DESCRIPTORS 一致',
    (id, label, ariaText) => {
      const entry = t('zh-Hant').segments[id]
      expect(entry.label).toBe(label)
      expect(entry.ariaText).toBe(ariaText)
    },
  )
})

// ── 4. 注入 PoC：純函式語境以 (locale, messages) 呼叫組句函式 ──

/**
 * 示範「純模組注入」存取形式的下游消費範式：本函式吃 `(locale,
 * messages)`，本身零 import DOM／零讀 t()——由呼叫端先解出 Messages 物件
 * 再傳入，證明 T5.2/T5.3 要接的注入模式（純函式收 locale＋字典兩參數，
 * 不自行 import DOM 模組）可行。此函式僅為測試內 PoC，不修改任何既有
 * 模組（row-groups.ts／row-select.ts 等留待 T5.2/T5.3）。
 */
function demoAnnounceSegmentMoved(
  locale: Locale,
  messages: Messages,
  segmentId: keyof Messages['segments'],
  row: number,
  position: number,
  rowSize: number,
): string {
  const label = messages.segments[segmentId].label
  return messages.announce.move(label, row, position, rowSize)
}

describe('注入 PoC：純函式收 (locale, messages) 組句', () => {
  it.each(LOCALES)('%s：demoAnnounceSegmentMoved 組出含段 label 與位置數字的句子', (locale) => {
    const messages = t(locale)
    const out = demoAnnounceSegmentMoved(locale, messages, 'model', 2, 1, 3)
    expect(out).toContain(messages.segments.model.label)
    expect(out).toContain('2')
    expect(out).toContain('1')
    expect(out).toContain('3')
  })

  it('同一 messages 物件可反覆注入不同 segmentId，不需重新解 locale', () => {
    const messages = t('zh-Hant')
    const a = demoAnnounceSegmentMoved('zh-Hant', messages, 'cwd', 1, 1, 2)
    const b = demoAnnounceSegmentMoved('zh-Hant', messages, 'clock', 1, 2, 2)
    expect(a).toContain('目前目錄')
    expect(b).toContain('時鐘')
  })
})
