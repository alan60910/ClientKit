/**
 * T3.2（(internal design doc) §D2′；TASKS.md T3.2，回饋 #5
 * 「目錄樣例值」核心）：左欄目錄 compact 列樣例值合成——逐段以單段-
 * enabled 的預設 config × FULL mock scenario 唯讀呼叫既有 `resolve()`
 * （`mode:'plain'`；**不改 resolve.ts 本身**），取該段 toAnsi 前純文字
 * （PLAN §D2′「精度」：樣例反映段預設形，非使用者現行設定——目錄是選單
 * 不是預覽）。
 *
 * ── 合成演算法（Spike S2 已實測 30/30 段非空、單列、零控制碼、7–33
 *    字元；(internal design doc)）──
 * 對 `defaultConfig(SEGMENT_CATALOG)` 的每個 segment：`structuredClone`
 * 深拷貝 base config（S2（c）1 提醒：避免淺拷貝令多次迭代共用同一巢狀
 * `color` 物件參照）→ `mode:'plain'` → 僅該段 `enabled:true`、其餘段
 * `enabled:false` → `resolve(cfg, { data, shell, env, now } =
 * MOCK_SCENARIOS_BY_ID.full, locale)` → 串接全部 rows／runs 的 `.text`
 * （即 toAnsi 前純文字）＝該段樣例。單段-enabled 恆落單一渲染列
 * （`seg.row` 缺欄 → 分組鍵 0），故「串接全部 rows」實務上只有一列；仍以
 * `flatMap` 處理保留形狀彈性（不假設恆一列）。
 *
 * ── per-locale 快取（模組層 lazy 單例）──
 * `getSampleValues(locale)`／`getSampleValue(id, locale)` 首次呼叫某
 * locale 才計算（未呼叫不算成本、無 top-level 立即求值）；同 locale
 * 重複呼叫回同一快取物件（引用相等，供呼叫端 identity 檢查快取命中）。
 * 語言切換時呼叫端（main.ts `refreshCatalogHints`）改傳新 locale 即自然
 * 落新的快取鍵、無需顯式失效舊鍵——各 locale 快取彼此獨立、互不干擾。
 * `resetSampleValueCacheForTests` 為 **test-only** 匯出：清空全部
 * locale 快取，供 dom 案 `beforeEach` 呼叫達成案間隔離（S4-RESULT.md
 * 定案：vitest 實測模組單例跨案存活，純 `vi.resetModules()` 不足以隔離
 * 未經模組重新 import 的直接單元測試）。
 *
 * ── fallback（整批 try/catch＋逐段空值兩層，皆 fallback 至同一
 *    `t(locale).catalog.sampleUnavailable` 文案、locale 相依走 i18n）──
 * 1. **逐段空值**：該段 `resolve()` 輸出串接後為空字串 → 該段樣例改為
 *    fallback 文案。FULL mock 下 S2 實測 0 段落入此路（30/30 皆非空）
 *    ——本路徑仍以下方「測試注入面」構造合成空值情境獨立驗證（S2-RESULT
 *    §(b) 明文：FULL 情境測不出 fallback 路徑本身是否正確工作）。
 * 2. **整批擲錯**：`resolve()`（或 `defaultConfig`／深拷貝）任一段擲錯
 *    → **整批**（全部段）fallback 至同一文案，不阻斷 `init()`——呼叫端
 *    `getSampleValue` 恆有字串可回，零 throw 外洩。
 *
 * ── 測試注入面（`resolveFn` 選填參數，預設值＝真 `resolve`）──
 * 生產路徑（main.ts）呼叫時不傳第三參數，恆用真 `resolve`（本模組僅
 * import、不改該檔任何邏輯，符合「唯讀呼叫」鐵律）；單元測試注入替身
 * `resolveFn`（同簽章）模擬「該段回傳空 runs」／「該段擲錯」情境（S2
 * 實測 FULL 下不可達，見上）。沿本 repo 既有「純函式＋依賴顯式參數注入」
 * 慣例（如 segment-defaults.ts `computeSegmentFieldDefaults` 吃呼叫端已
 * 備妥的 `descriptor` 而非自行查表），不採 `vi.mock` 模組替換手法（本
 * repo 既有測試網無此先例，替換手法會連帶影響同進程內其他呼叫真
 * `resolve` 的模組如 render-preview.ts）。
 *
 * 純函式核心＋模組層快取狀態，零 DOM import（`resolve`／`config`／
 * `segments`／`mock-data`／`messages` 皆 DOM-free），node 可測。
 */
import { defaultConfig, type BuilderConfig } from './config.js'
import { t, type Locale } from './messages.js'
import { MOCK_SCENARIOS_BY_ID } from './mock-data.js'
import { resolve, type ResolveInput, type StyledRun } from './resolve.js'
import { SEGMENT_CATALOG, SEGMENT_IDS } from './segments.js'

/** `resolve()` 同簽章——測試注入替身用（見檔頭「測試注入面」）。 */
export type ResolveFn = (config: BuilderConfig, input: ResolveInput) => StyledRun[][]

/** id → 樣例文字（或 fallback 文案）；`Readonly` 防呼叫端誤 mutate 快取物件本身。 */
export type SampleValueMap = Readonly<Record<string, string>>

const FULL_SCENARIO = MOCK_SCENARIOS_BY_ID.full

/** 模組層 lazy per-locale 快取（見檔頭）。 */
const cacheByLocale = new Map<Locale, SampleValueMap>()

/** 單段合成：深拷貝 base、僅該段 enabled、resolve、串接全部 rows/runs 的 text。 */
function synthesizeOne(id: string, base: BuilderConfig, locale: Locale, resolveFn: ResolveFn): string {
  const cfg = structuredClone(base)
  cfg.mode = 'plain'
  for (const seg of cfg.segments) seg.enabled = seg.id === id
  const rows = resolveFn(cfg, {
    data: FULL_SCENARIO.data,
    shell: FULL_SCENARIO.shell,
    env: FULL_SCENARIO.env,
    now: FULL_SCENARIO.now,
    locale,
  })
  const text = rows
    .flatMap((row) => row)
    .map((run) => run.text)
    .join('')
  return text !== '' ? text : t(locale).catalog.sampleUnavailable
}

/** 整批合成＋try/catch fallback（見檔頭「fallback」節 2）。 */
function synthesizeAll(locale: Locale, resolveFn: ResolveFn): SampleValueMap {
  try {
    const base = defaultConfig(SEGMENT_CATALOG)
    const result: Record<string, string> = {}
    for (const id of SEGMENT_IDS) result[id] = synthesizeOne(id, base, locale, resolveFn)
    return Object.freeze(result)
  } catch {
    const fallback = t(locale).catalog.sampleUnavailable
    return Object.freeze(Object.fromEntries(SEGMENT_IDS.map((id) => [id, fallback])))
  }
}

/**
 * 取得整批樣例值（見檔頭 lazy／per-locale 快取說明）。`resolveFn` 選填、
 * 預設真 `resolve`——生產呼叫點（main.ts）恆不傳，僅單元測試注入替身。
 */
export function getSampleValues(locale: Locale, resolveFn: ResolveFn = resolve): SampleValueMap {
  const cached = cacheByLocale.get(locale)
  if (cached !== undefined) return cached
  const computed = synthesizeAll(locale, resolveFn)
  cacheByLocale.set(locale, computed)
  return computed
}

/** 單段樣例值（`getSampleValues` 的單鍵便捷 accessor）。 */
export function getSampleValue(id: string, locale: Locale, resolveFn: ResolveFn = resolve): string {
  return getSampleValues(locale, resolveFn)[id] ?? t(locale).catalog.sampleUnavailable
}

/**
 * test-only：清空全部 locale 快取（見檔頭「per-locale 快取」節）。dom 案
 * `beforeEach` 呼叫以達成案間隔離；非測試呼叫點不得使用（生產路徑無清
 * 快取需求——語言切換改落新 locale 鍵，見 main.ts `refreshCatalogHints`）。
 */
export function resetSampleValueCacheForTests(): void {
  cacheByLocale.clear()
}
