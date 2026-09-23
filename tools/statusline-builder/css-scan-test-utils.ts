/**
 * sprint 15 MAGI code review 🟡-4 修法（(internal design doc)
 * (internal design doc)）：CSS **原始文字**掃描的共用測試 helper。
 *
 * 背景：jsdom 不套用外部 stylesheet，故 statusline-builder 的 CSS 契約案
 * 一律讀 `style.css` 原始文字比對（理由見 layout-columns.dom.test.ts 檔頭），
 * 且依 D7 紀律一律採**歸屬斷言**（規則字面落在哪個 `@media` 區塊內），
 * 禁「規則存在性」比對。
 *
 * 為何收斂成模組（🟡-4 兩項病灶）：
 *   1. sprint 15 T2.5 在 layout-columns.dom.test.ts 內把區塊定位強化為
 *      「掃描前先剝除註解」以治本大括號深度計數錯位，但同批
 *      skip-nav.dom.test.ts 手刻了一份**未強化**的等價邏輯，繞過該治本；
 *   2. 兩份實作又同懷「檔內唯一同條件 `@media` 區塊」的隱性假設，而
 *      `style.css` 自 sprint 15 起同條件區塊實有**兩個**（三欄版面節／
 *      D8 目錄收合節）。
 * 本模組因此同時提供單一實作與**顯式的「第 N 個同條件區塊」定址**
 * （`mediaBlockRange` 的 `occurrence`）／全區塊列舉（`allMediaBlockRanges`）。
 *
 * 命名刻意**不**用 `*.test.ts`：本檔是測試支援模組、非測試套件本身
 * （vitest 預設只收集檔名含 `.test.`／`.spec.` 者，不會把本檔當套件跑），比照
 * 同目錄 `multirow-golden-configs.ts`「純工具/資料模組供多個測試共用」的
 * 既有形。**僅供測試 import**：出貨程式碼（main.ts 等）不引用本檔，故
 * 本檔不進 dist bundle。
 */

/** CSS 原始文字中的半開區間 `[start, end)`（index 皆對映**原始**字串座標）。 */
export interface CssSourceRange {
  /** `@media` 關鍵字在原始字串中的起點 index。 */
  readonly start: number
  /** 該 `@media` 區塊閉合大括號之後一位。 */
  readonly end: number
}

/**
 * 把 css 全文中區塊註解的**內文**逐字元換成半形空白（保留換行不動），
 * 只做等長替換、不刪字元——回傳字串長度與原字串完全相同，故所有 index
 * 仍精準對映原字串座標。供 `allMediaBlockRanges` 在掃描前先行呼叫，treat
 * 掉「註解內含孤立 `{`／`}` 會使大括號深度計數錯位」這個根因（機械規則
 * 路線只是約定、防不了未來違規，故採此掃描前剝除路線）。
 *
 * 非貪婪 `[\s\S]*?` 確保跨行註解也只吃到最近的註解結束符，不會把兩段
 * 註解之間的真實規則一併吃掉。
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
}

/**
 * 取**所有**標頭符合 `headerPattern` 的 `@media` 規則在原始文字中的字面
 * 範圍，依源序回傳（`style.css` 現行有兩個 `@media (min-width: 1100px)`
 * 區塊，見本檔頭 🟡-4）。以括號配對定位閉合（比起「找下一個頂層
 * selector」更不受區塊內巢狀規則數量影響）——純 source-text 索引比對，
 * 不依賴 CSS 解析器（同 `scripts/verify-dist-checks.mjs` 等既有工具讀
 * 原始文字的慣例，非新發明手法）。
 *
 * 掃描前先過 `stripCssComments`；剝除只換字元不動長度，故 `match.index`
 * 與深度計數得出的座標皆仍是原始 `css` 字串的合法 index，回傳範圍可直接
 * 用於原字串 slice。
 *
 * `headerPattern` 可帶或不帶 `g` 旗標——本函式一律以其 source/flags 另建
 * 一份帶 `g` 的複本掃描，不改動呼叫端傳入之 regex 的 `lastIndex`。列舉
 * 以**標頭出現序**為準（同條件區塊即使巢在另一區塊內亦各自計一次），
 * 使「同條件區塊恰 N 個」這類契約斷言不會被巢狀寫法悄悄繞過。
 */
export function allMediaBlockRanges(css: string, headerPattern: RegExp): CssSourceRange[] {
  const scanCss = stripCssComments(css)
  const flags = headerPattern.flags.includes('g') ? headerPattern.flags : `${headerPattern.flags}g`
  const pattern = new RegExp(headerPattern.source, flags)

  const ranges: CssSourceRange[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(scanCss)) !== null) {
    const openIndex = scanCss.indexOf('{', match.index)
    if (openIndex === -1) {
      throw new Error(`CSS 掃描：@media 標頭（${String(headerPattern)}）之後找不到 '{'`)
    }

    let depth = 0
    let i = openIndex
    for (; i < scanCss.length; i++) {
      if (scanCss[i] === '{') depth++
      else if (scanCss[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) {
      throw new Error(`CSS 掃描：@media 規則（${String(headerPattern)}）括號未配對閉合`)
    }
    ranges.push({ start: match.index, end: i + 1 })

    // 零長度匹配防呆：headerPattern 若寫成可匹配空字串的形，lastIndex 不
    // 前進會無限迴圈。
    if (pattern.lastIndex === match.index) pattern.lastIndex = match.index + 1
  }
  return ranges
}

/**
 * 取**第 `occurrence` 個**（1-indexed，預設 1＝第一個，等同 🟡-4 修法前
 * 的既有語意）標頭符合 `headerPattern` 的 `@media` 區塊字面範圍。找不到
 * 時擲錯並回報實得個數——「規則搬到第二個同條件區塊」這類改動因此會得到
 * 明確訊號，而非靜默假紅/假綠。
 */
export function mediaBlockRange(
  css: string,
  headerPattern: RegExp,
  occurrence = 1,
): CssSourceRange {
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error(`CSS 掃描：occurrence 須為 ≥1 的整數，收到 ${String(occurrence)}`)
  }
  const ranges = allMediaBlockRanges(css, headerPattern)
  const range = ranges[occurrence - 1]
  if (range === undefined) {
    throw new Error(
      `CSS 掃描：找不到第 ${occurrence} 個符合 ${String(headerPattern)} 的 @media 規則（實得 ${ranges.length} 個）`,
    )
  }
  return range
}
