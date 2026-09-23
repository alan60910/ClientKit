/**
 * T1.3（(internal design doc) §D8；§Verification messages
 * bullet「key 集合與 Messages 型別一致（比照 statusline i18n 巡檢）」）：
 * messages.ts 純核心單元測試，比照
 * `tools/statusline-builder/messages.test.ts` 的巡檢手法（key path 集合、
 * 插值函式 arity、非空字串、注入存取形式），但本工具 v1 只有 `zhHant`
 * 一份實作，故無「兩語言深度相等」案，改為「`t('en')` 回退 `zhHant`」案。
 *
 * 本檔（連同 messages.ts）不 import 任何 DOM-facing 模組——本測試檔在
 * 本專案 vitest 預設環境（node，無 `.dom.test.ts` pragma）即可順利執行，
 * 即為「零 DOM」自證。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, t, zhHant, type Locale, type Messages } from './messages.js'

// ── 1. key 集合：遞迴收集、非空、涵蓋必要鍵、規模穩定 ──

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

/** 遞迴檢查所有字串葉節點皆非空（函式葉節點另以第 2 節逐一呼叫驗證）。 */
function collectEmptyStringPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return []
  const empties: string[] = []
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    const value = (obj as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.length === 0) {
      empties.push(path)
    } else if (typeof value === 'object' && value !== null) {
      empties.push(...collectEmptyStringPaths(value, path))
    }
  }
  return empties
}

const REQUIRED_KEY_PATHS = [
  'ui.title',
  'ui.skipNav.toCanvas',
  'ui.skipNav.toSettings',
  // T5.3：第四條 skip-nav（`#props-section`）。
  'ui.skipNav.toProps',
  'ui.skipNav.toList',
  'ui.section.room',
  'ui.section.analysisResult',
  'ui.button.add',
  'ui.button.restore',
  'ui.button.restorePrevious',
  'ui.switch.showDistance',
  'ui.threshold.ignoreBelow',
  // T2.4 panel.ts 動態建列／分頁所需的兩個群組（見 messages.ts 群組註解）。
  'ui.form.thresholdOrder',
  // T4.7 家具件數軟上限：label、效能警告、低於現有件數的欄位級錯誤。
  'ui.threshold.maxItems',
  'ui.form.maxItemsWarning',
  'ui.form.maxItemsBelowCount',
  'status.itemCapReached',
  'ui.form.integerRange',
  'ui.form.nameRequired',
  'ui.form.wall',
  'ui.form.kindExtend',
  'ui.form.kindCutout',
  'ui.list.pageLabel',
  'ui.list.select',
  // T5.3 物件屬性欄與簡化後的清單列摘要。
  'ui.props.heading',
  'ui.props.empty',
  'ui.props.need',
  'ui.props.selectAction',
  'ui.list.itemSummary',
  'ui.list.blockSummary',
  'ui.list.doorSummary',
  'ui.door.wallName',
  'ui.board.itemAriaLabel',
  'ui.board.itemRoledescription',
  'ui.shareNotice',
  // T4.w：M4 io 接線收攏進來的六句 status ＋兩句 ui／errors。
  'ui.previewNotice',
  // review 🟡-5 修復批：預覽態下「還原上一份」被拒的提示、清空的專用問句。
  'ui.restoreBlockedInPreview',
  'ui.confirmClearPreview',
  'status.planExported',
  'status.pngDone',
  'status.linkCopied',
  'status.linkCopyFallback',
  'status.previewLoaded',
  'status.savedAsMine',
  'errors.importTooLarge',
  'status.itemMoved',
  'status.itemAdded',
  'status.blockAdded',
  'status.doorAdded',
  'status.limitReached',
  'status.wallCapExceeded',
  'status.warningsSummary',
  'errors.importFailed',
  'errors.hashTooLong',
  'errors.shareTooLong',
  'report.level.touch',
  'report.level.narrow',
  'report.level.tight',
  'report.level.ok',
  'report.kind.doorway',
  'report.kind.unrated',
  // T3.2 report-list.ts 的文字等價群組（PLAN §Accessibility「overlay
  // `aria-hidden`，資訊由 `report-list` 文字等價」）。
  'report.text.corridor',
  'report.text.doorway',
  'report.text.suppressed',
  'report.text.collision',
  'report.text.side',
  'report.text.door',
  'report.text.unattachedDoor',
  'report.text.unconnectedBlock',
  'report.wallName',
  'report.doorName',
  'report.sideName',
  'report.summaryExtra',
  'report.empty',
]

describe('meta：key 集合', () => {
  it('DEFAULT_LOCALE 為 zh-Hant', () => {
    expect(DEFAULT_LOCALE).toBe('zh-Hant')
  })

  it('key path 集合規模穩定（>40）且涵蓋所有必要鍵', () => {
    const keys = collectKeyPaths(zhHant)
    expect(keys.length).toBeGreaterThan(40)
    for (const required of REQUIRED_KEY_PATHS) {
      expect(keys).toContain(required)
    }
  })

  it('無空字串葉節點', () => {
    expect(collectEmptyStringPaths(zhHant)).toEqual([])
  })
})

// ── 2. 插值函式：輸出為非空字串且含代入參數 ──

describe('插值函式：輸出含代入參數', () => {
  it('ui.button.restore(name) 含 name', () => {
    const out = zhHant.ui.button.restore('衣櫃')
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('衣櫃')
  })

  it('ui.door.wallName(side) 四向皆非空且互異', () => {
    const sides = ['N', 'E', 'S', 'W'] as const
    const names = sides.map((side) => zhHant.ui.door.wallName(side))
    for (const name of names) expect(name.length).toBeGreaterThan(0)
    expect(new Set(names).size).toBe(4)
  })

  it('ui.board.itemAriaLabel(name, w, d, x, y) 格式為「{name} {w}×{d} cm，位置 {x},{y}」', () => {
    expect(zhHant.ui.board.itemAriaLabel('單人床 3 尺', 91, 188, 10, 20)).toBe(
      '單人床 3 尺 91×188 cm，位置 10,20',
    )
  })

  it('status.itemMoved(name, x, y) 含三個參數', () => {
    const out = zhHant.status.itemMoved('書桌', 5, 6)
    expect(out).toContain('書桌')
    expect(out).toContain('5')
    expect(out).toContain('6')
  })

  it('status.itemRotated(name, rotation) 含 name 與角度', () => {
    const out = zhHant.status.itemRotated('沙發', 90)
    expect(out).toContain('沙發')
    expect(out).toContain('90')
  })

  it('status.itemDeleted／itemRestored(name) 含 name 且兩者不同形', () => {
    expect(zhHant.status.itemDeleted('茶几')).toContain('茶几')
    expect(zhHant.status.itemRestored('茶几')).toContain('茶几')
    expect(zhHant.status.itemDeleted('茶几')).not.toBe(zhHant.status.itemRestored('茶几'))
  })

  it('status.limitReached(kind, max) 三種 kind 皆含 kind 與 max', () => {
    for (const kind of ['家具', '結構', '門'] as const) {
      const out = zhHant.status.limitReached(kind, 75)
      expect(out).toContain(kind)
      expect(out).toContain('75')
    }
  })

  it('status.itemCapReached(max, hard) 含當前上限、硬上限與「調高」出路（T4.7）', () => {
    const out = zhHant.status.itemCapReached(20, 75)
    expect(out).toContain('20')
    expect(out).toContain('75')
    expect(out).toContain('調高')
    // 與 limitReached 刻意分流：後者沒有出路句
    expect(out).not.toBe(zhHant.status.limitReached('家具', 20))
  })

  it('ui.form.maxItemsWarning(n) 帶門檻與兩級實測數字（T4.7）', () => {
    const out = zhHant.ui.form.maxItemsWarning(20)
    expect(out).toContain('20')
    expect(out).toContain('16.7 ms')
    expect(out).toContain('100 ms')
  })

  it('ui.form.maxItemsBelowCount(count) 含件數且點明含已刪除（T4.7）', () => {
    const out = zhHant.ui.form.maxItemsBelowCount(20)
    expect(out).toContain('20')
    expect(out).toContain('已刪除')
  })

  it('status.wallCapExceeded(count, max) 含兩數字且提示移除其他方塊', () => {
    const out = zhHant.status.wallCapExceeded(200, 200)
    expect(out).toContain('200')
    expect(out).toContain('移除')
  })

  it('ui.form.integerRange(min, max) 含上下界', () => {
    const out = zhHant.ui.form.integerRange(1, 5000)
    expect(out).toContain('1')
    expect(out).toContain('5000')
  })

  it('ui.form.thresholdOrder 提及三個閾值名稱（D3 三元組違序文案）', () => {
    const out = zhHant.ui.form.thresholdOrder
    expect(out).toContain('忽略')
    expect(out).toContain('警示')
    expect(out).toContain('建議')
  })

  it('ui.list.pageLabel(page, total) 為「第 {page}/{total} 頁」', () => {
    expect(zhHant.ui.list.pageLabel(1, 2)).toBe('第 1/2 頁')
  })

  it('ui.list.select(name) 含 name（項目身分承載於控件可及名稱）', () => {
    expect(zhHant.ui.list.select('書桌')).toContain('書桌')
  })

  it('ui.props.need(side) 四向互異、以方位字起頭（T5.3 各面需留 label）', () => {
    const sides = ['N', 'E', 'S', 'W'] as const
    const names = sides.map((side) => zhHant.ui.props.need(side))
    expect(new Set(names).size).toBe(4)
    for (const side of sides) {
      expect(zhHant.ui.props.need(side).startsWith(zhHant.report.sideName(side))).toBe(true)
    }
    expect(zhHant.ui.props.need('N')).toBe('北側需留')
  })

  it('ui.list.*Summary 三種摘要含各自的數值（T5.3 簡化後的清單列）', () => {
    expect(zhHant.ui.list.itemSummary(120, 60, 10, 20)).toBe('120×60，(10,20)')
    expect(zhHant.ui.list.blockSummary(0, 0, 60, 60)).toBe('0,0 60×60')
    expect(zhHant.ui.list.doorSummary(70, zhHant.ui.door.wallName('W'))).toContain('西牆')
    expect(zhHant.ui.list.doorSummary(70, '西牆')).toContain('70')
  })

  it('ui.restoreBlockedInPreview 指路「儲存為我的平面圖」（review 🟡-5 預覽態拒絕還原）', () => {
    expect(zhHant.ui.restoreBlockedInPreview).toContain(zhHant.ui.button.saveAsMine)
    expect(zhHant.ui.restoreBlockedInPreview).toContain('預覽')
  })

  it('ui.confirmClearPreview 與 confirmClear 分流，且不承諾備份（review 🟡-5）', () => {
    expect(zhHant.ui.confirmClearPreview).not.toBe(zhHant.ui.confirmClear)
    expect(zhHant.ui.confirmClear).toContain(zhHant.ui.button.restorePrevious)
    expect(zhHant.ui.confirmClearPreview).not.toContain(zhHant.ui.button.restorePrevious)
  })

  it('status.itemAdded(name) 含 name', () => {
    expect(zhHant.status.itemAdded('書桌')).toContain('書桌')
  })

  it('status.blockAdded(kind) 兩種種類文字互異且與 ui.form.kind* 同字面', () => {
    const extend = zhHant.status.blockAdded('extend')
    const cutout = zhHant.status.blockAdded('cutout')
    expect(extend).not.toBe(cutout)
    expect(extend).toContain(zhHant.ui.form.kindExtend)
    expect(cutout).toContain(zhHant.ui.form.kindCutout)
  })

  it('status.doorAdded() 為非空字串', () => {
    expect(zhHant.status.doorAdded().length).toBeGreaterThan(0)
  })

  it('status.pageChanged(page, total) 含兩數字', () => {
    const out = zhHant.status.pageChanged(2, 5)
    expect(out).toContain('2')
    expect(out).toContain('5')
  })

  it('status.pngDone(w, h) 含兩個像素尺寸（T4.w：與 io-png.ts 的 PNG_TEXT.done 逐字相同）', () => {
    const out = zhHant.status.pngDone(3072, 4096)
    expect(out).toContain('3072')
    expect(out).toContain('4096')
  })

  it('status.warningsSummary(narrow, collisions, side, door) 含四個計數', () => {
    const out = zhHant.status.warningsSummary(1, 2, 3, 4)
    expect(out).toContain('1')
    expect(out).toContain('2')
    expect(out).toContain('3')
    expect(out).toContain('4')
  })

  // ── T3.2 文字等價群組 ──

  it('report.text.corridor(a, b, gap, level) 含兩端名稱、間距與分段名', () => {
    const out = zhHant.report.text.corridor('書桌', '北牆', 50, zhHant.report.level.narrow)
    expect(out).toContain('書桌')
    expect(out).toContain('北牆')
    expect(out).toContain('50 cm')
    expect(out).toContain(zhHant.report.level.narrow)
  })

  it('report.text.doorway／suppressed 皆標「不評級」且彼此不同形（D4）', () => {
    const doorway = zhHant.report.text.doorway('衣櫃', '牆體', 70)
    const suppressed = zhHant.report.text.suppressed('沙發', '茶几', 30)
    expect(doorway).toContain('門洞（不評級）')
    expect(doorway).toContain('70 cm')
    expect(suppressed).toContain(zhHant.report.kind.unrated)
    expect(doorway).not.toBe(suppressed)
  })

  it('report.text.collision(a, b) 含兩端名稱', () => {
    const out = zhHant.report.text.collision('書桌', '沙發')
    expect(out).toContain('書桌')
    expect(out).toContain('沙發')
  })

  it('report.text.side(name, sideName, need, actual, against) 含五個參數', () => {
    const out = zhHant.report.text.side('衣櫃', zhHant.report.sideName('W'), 90, 30, '書桌')
    expect(out).toContain('衣櫃')
    expect(out).toContain('西')
    expect(out).toContain('90')
    expect(out).toContain('30')
    expect(out).toContain('書桌')
  })

  it('report.text.door(name, doorName) 含家具名與門名', () => {
    const out = zhHant.report.text.door('衣櫃', zhHant.report.doorName('E'))
    expect(out).toContain('衣櫃')
    expect(out).toContain('東牆')
    expect(out).toContain('迴旋區')
  })

  it('report.text.unattachedDoor／unconnectedBlock 含 id', () => {
    expect(zhHant.report.text.unattachedDoor('d1')).toContain('d1')
    expect(zhHant.report.text.unconnectedBlock('b1')).toContain('b1')
    expect(zhHant.report.text.unconnectedBlock('b1')).toContain(zhHant.ui.form.kindExtend)
  })

  it('report.sideName(side) 四向互異且為 wallName 的前綴（同一組方位字）', () => {
    const sides = ['N', 'E', 'S', 'W'] as const
    const names = sides.map((side) => zhHant.report.sideName(side))
    expect(new Set(names).size).toBe(4)
    for (const side of sides) {
      expect(zhHant.ui.door.wallName(side).startsWith(zhHant.report.sideName(side))).toBe(true)
    }
  })

  it('report.doorName(side) 四向互異且含牆名', () => {
    const sides = ['N', 'E', 'S', 'W'] as const
    const names = sides.map((side) => zhHant.report.doorName(side))
    expect(new Set(names).size).toBe(4)
    expect(zhHant.report.doorName('S')).toContain(zhHant.ui.door.wallName('S'))
  })

  it('report.summaryExtra(tight, unrated) 含兩數字', () => {
    const out = zhHant.report.summaryExtra(3, 1)
    expect(out).toContain('3')
    expect(out).toContain('1')
  })
})

// ── 3. t()：v1 只填 zhHant，'en' 回退 ──

describe('t(locale)：v1 只填 zhHant', () => {
  it('t() 無參數回傳 zhHant（DEFAULT_LOCALE）', () => {
    expect(t()).toBe(zhHant)
  })

  it("t('zh-Hant') 回傳 zhHant", () => {
    expect(t('zh-Hant')).toBe(zhHant)
  })

  it("t('en') 回退回傳 zhHant（v1 未填 en，見 messages.ts t() 註解）", () => {
    expect(t('en')).toBe(zhHant)
  })

  it.each<Locale>(['zh-Hant', 'en'])('%s：t() 回傳物件符合 Messages 頂層四群組', (locale) => {
    const messages: Messages = t(locale)
    expect(Object.keys(messages).sort()).toEqual(['errors', 'report', 'status', 'ui'])
  })
})

// ── 4. 注入 PoC：純函式收 (locale, messages) 組句 ──

/**
 * 示範「純模組注入」存取形式的下游消費範式（同 statusline
 * messages.test.ts 的第 4 節）：本函式吃 `(locale, messages)`，本身零
 * import DOM／零讀 `t()`，證明下游模組（`board.ts`／`main.ts`）可用同一
 * 注入模式，不需自行解字典。
 */
function demoAnnounceItemMoved(locale: Locale, messages: Messages, name: string, x: number, y: number): string {
  return `[${locale}] ${messages.status.itemMoved(name, x, y)}`
}

describe('注入 PoC：純函式收 (locale, messages) 組句', () => {
  it('demoAnnounceItemMoved 組出含 locale 標記與播報句的字串', () => {
    const messages = t('zh-Hant')
    const out = demoAnnounceItemMoved('zh-Hant', messages, '床頭櫃', 12, 34)
    expect(out).toContain('zh-Hant')
    expect(out).toContain('床頭櫃')
    expect(out).toContain('12')
    expect(out).toContain('34')
  })
})
