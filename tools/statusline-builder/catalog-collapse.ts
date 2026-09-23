/**
 * T3.1（(internal design doc) §D8「行動版目錄收合」
 * G8；TASKS.md T3.1）：收合狀態機——只承接「狀態讀寫與謂詞」的純邏輯
 * 部分（比照 `tutorial-band.ts` 單一常數出口的模組形態）。DOM 接線
 * （`<summary>` click／keydown 監聽、`<details>` 節點操作、跨斷點強制
 * 展開／恢復的 `matchMedia` change 監聽）屬後續 T3.4，本檔**不做任何 DOM
 * 操作、不掛任何監聽**。
 *
 * 語意權威：PLAN §D8＋其「MS1 定案」回填註記、`spikes/S-f-RESULT.md`
 * （獨立原型 11/11 PASS 實證）。
 *
 * ── 單一謂詞（PLAN §D8 硬性契約）──
 * **收合 ⟺ `localStorage.getItem(KEY) === '1'` 且視窗 <1100px**：
 * key 缺失（`getItem` 回傳 `null`）、`getItem` 本身擲錯（無痕模式）、任意
 * 怪值（非 `'1'`）、`matchMedia` 不可用或擲錯 → 一律判定「展開」
 * （fail-open——PLAN 原文：桌面態失敗態是「少一條提示」，行動版目錄的
 * 失敗態是「核心功能消失」，故只可能倒向展開，不可能倒向收合）。
 *
 * ── localStorage 鍵與 sentinel ──
 * key＝`clientkit-statusline-builder-catalog-collapsed`（PLAN §D8 定死字面
 * 值，循 SPEC `<brand>-<scope>-<name>` 慣例，同
 * `tutorial-band.ts` 的 `TUTORIAL_DISMISS_KEY`；品牌前綴 sprint 17 M1 改為
 * `clientkit`，字面釘值集中於 `src/storage-keys-pin.test.ts`）；sentinel
 * 定死 `'1'`。
 *
 * ── 斷點判定 ──
 * 惰性 `matchMedia('(max-width: 1099.98px)')`——與 `style.css` 既有
 * `@media (min-width: 1100px)` 桌面規則的邊界互補（見該檔 D7 層疊紀律
 * 註解），避免 1100px 整數邊界雙規則同時命中的縫隙。查詢字面值單一出口
 * 匯出（`CATALOG_COLLAPSE_BREAKPOINT_QUERY`），供 T3.4 的跨斷點
 * change 監聽（`wireBreakpointForcing`，見 S-f-RESULT.md 對 MS3 施工建議
 * 第 4 點）共用同一份字面值，不得另行字面重複一份（防測試網與實作漂移，
 * 同 `tutorial-band.ts` 對 e2e seed 步驟的要求）。
 *
 * ── 持久化寫入（best-effort，供 T3.4 接線用）──
 * `setCatalogCollapsed()`／`clearCatalogCollapsed()` 分別寫入 sentinel／
 * 移除 key，比照 `src/theme.ts` `toggleTheme()` 的 `setItem` 慣例：寫入
 * 失敗（無痕模式／配額）僅靜默降級，不冒出例外，呼叫端（T3.4 的
 * summary-only 持久化機制）仍可讓「本次」UI 狀態變化生效，只是下次重新
 * 載入不會記得。
 *
 * ── 惰性存取、無 jsdom 依賴 ──
 * 模組頂層不碰 `localStorage`／`matchMedia`（同 `src/theme.ts`／
 * `tutorial-band.ts` 慣例：全部惰性存取，函式內部才參照全域）——使本檔
 * 可獨立以 `vi.stubGlobal` 換陽春假 storage／假 matchMedia 單元測試，不需
 * 要 jsdom（見 `catalog-collapse.test.ts`）。
 */

/**
 * localStorage 鍵——單一出口：main.ts／T3.4 DOM 接線與本檔測試皆從此
 * 匯入；未來 e2e seed 步驟（node 端）亦應 import 同一常數，不得另行字面
 * 重複一份。
 */
export const CATALOG_COLLAPSE_KEY = 'clientkit-statusline-builder-catalog-collapsed'

/** 收合狀態之 sentinel 值（PLAN §D8 定死 `'1'`）。 */
export const CATALOG_COLLAPSE_SENTINEL = '1'

/**
 * 行動版斷點媒體查詢字面值——單一出口，與謂詞內部使用的字面值同源，供
 * T3.4 的跨斷點強制展開／恢復監聽共用（見檔頭「斷點判定」段落）。
 */
export const CATALOG_COLLAPSE_BREAKPOINT_QUERY = '(max-width: 1099.98px)'

/**
 * 惰性判定目前是否為行動版斷點。`matchMedia` 不可用（極舊瀏覽器／測試
 * 環境未 stub）或呼叫本身擲錯 → 視為桌面（fail-open 的一環：非行動版即
 * 不可能收合，見 `isCatalogCollapsed`）。
 */
function isMobileViewport(): boolean {
  try {
    return matchMedia(CATALOG_COLLAPSE_BREAKPOINT_QUERY).matches
  } catch {
    return false
  }
}

/**
 * 單一謂詞：目錄是否應收合。見檔頭「單一謂詞」段落——非行動版恆
 * `false`；行動版下讀 `localStorage`，讀取擲錯或非 sentinel 值一律
 * `false`（fail-open，不讓壞掉的 storage 或非預期怪值打斷「核心功能不得
 * 被藏起來」的承諾）。
 */
export function isCatalogCollapsed(): boolean {
  if (!isMobileViewport()) return false
  try {
    return localStorage.getItem(CATALOG_COLLAPSE_KEY) === CATALOG_COLLAPSE_SENTINEL
  } catch {
    return false
  }
}

/**
 * 持久化「收合」：best-effort 寫入 sentinel（同 `toggleTheme()` 慣例）。
 * 寫入失敗僅靜默降級，見檔頭「持久化寫入」段落。
 */
export function setCatalogCollapsed(): void {
  try {
    localStorage.setItem(CATALOG_COLLAPSE_KEY, CATALOG_COLLAPSE_SENTINEL)
  } catch {
    // best-effort 持久化，見檔頭「持久化寫入」段落。
  }
}

/**
 * 持久化「展開」：best-effort 移除 key（而非寫入非 sentinel 怪值——移除
 * 才是「無偏好」的正確表達，怪值屬 fail-open 涵蓋範圍但不是本函式應主動
 * 寫入的狀態）。寫入（移除）失敗僅靜默降級，見檔頭「持久化寫入」段落。
 */
export function clearCatalogCollapsed(): void {
  try {
    localStorage.removeItem(CATALOG_COLLAPSE_KEY)
  } catch {
    // best-effort 持久化，見檔頭「持久化寫入」段落。
  }
}
