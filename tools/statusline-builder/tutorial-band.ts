/**
 * T3.5（(internal design doc) §D5「拖曳教學」round-2 單一
 * 謂詞定稿；TASKS.md T3.5）：教學帶 dismiss 狀態機——結構本身已由 T2.6
 * 落地（index.html `#tutorial-band-slot`；見其自身註解），本檔只提供
 * 「顯示與否的判斷」與「dismiss 動作」兩個純函式＋單一 key/sentinel 常數
 * 出口，供 main.ts 接線（wireTutorialBand，見該檔）與未來 e2e seed 步驟
 * （node 端 import 或字面對照）共用同一份定義，避免測試網與實作各自硬編
 * 一份而漂移。
 *
 * ── 單一謂詞（PLAN 定案，取代 Rev3 雙句）──
 * **顯示 ⟺ `localStorage.getItem(KEY) !== SENTINEL`**：key 缺失（回傳
 * `null`）、`getItem` 本身擲錯（try/catch 後視同非 SENTINEL）、任意怪值
 * （`'true'`／`'0'`／`''`……）皆判定為「顯示」（fail-open）。無第二判準
 * 句、無其他觸發條件——`shouldShowTutorialBand()` 即該謂詞的唯一實作。
 *
 * ── localStorage 鍵與 sentinel ──
 * key＝`clientkit-statusline-builder-drag-tutorial`（循 SPEC
 * `<brand>-<scope>-<name>` 慣例，同 `src/theme.ts` 的 `clientkit-theme`／
 * `i18n-dom.ts` 的 `clientkit-statusline-builder-lang`；與
 * `config-storage-key.ts` `STORAGE_KEY`＝`clientkit:statusline-builder:config`
 * ——冒號式舊命名形狀，grandfathered——亦無碰撞；品牌前綴 sprint 17 M1 改為
 * `clientkit`，字面釘值集中於 `src/storage-keys-pin.test.ts`）；sentinel
 * 定死 `'1'`。不入 BuilderConfig
 * （不隨設定檔匯出/匯入/序列化，純瀏覽器端一次性提示旗標）。
 *
 * ── best-effort 讀寫（比照 main.ts `persist()` 成文慣例）──
 * `shouldShowTutorialBand()` 的 try/catch 已如上述併入單一謂詞語意（讀取
 * 失敗＝視同非 SENTINEL＝顯示）。`dismissTutorialBand()` 寫入失敗（無痕
 * 模式／配額）僅靜默降級：呼叫端（main.ts wireTutorialBand）仍會讓「本次」
 * 教學帶隱藏生效——隱藏是 DOM 層操作、不依賴寫入是否成功；下次重新載入
 * 因未寫入成功會 fail-open 再次顯示，此為預期降級行為，非本函式需額外
 * 處理的錯誤。
 *
 * 模組頂層不碰 `localStorage`（同 `src/theme.ts` 慣例：全部惰性存取，函式
 * 內部才參照全域）——使本檔可獨立以 `vi.stubGlobal('localStorage', ...)`
 * 單元測試 KEY／SENTINEL 字面值與兩函式行為，不需 jsdom（見
 * tutorial-band.test.ts）；互動整合面（dismiss 點擊／記憶／怪值／
 * 拋錯）仍併入 tutorial-band.dom.test.ts 的全頁面 boot() 慣例驗證。
 */

/**
 * localStorage 鍵——單一出口：main.ts 接線與本檔測試皆從此匯入；未來 e2e
 * seed 步驟（node 端）亦應 import 同一常數，不得另行字面重複一份（防測試
 * 網與實作漂移，PLAN §D5「e2e seed 步驟引用同一常數」）。
 */
export const TUTORIAL_DISMISS_KEY = 'clientkit-statusline-builder-drag-tutorial'

/** dismiss 完成之 sentinel 值（PLAN 定死 `'1'`）。 */
export const TUTORIAL_DISMISS_SENTINEL = '1'

/**
 * 單一謂詞：是否應顯示教學帶。`localStorage.getItem` 擲錯（如無痕模式
 * 封鎖 storage）一律視同讀值非 SENTINEL → 顯示（fail-open，不讓壞掉的
 * storage 打斷教學帶顯示判斷，同 `src/theme.ts` `getStoredTheme` 慣例）。
 */
export function shouldShowTutorialBand(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DISMISS_KEY) !== TUTORIAL_DISMISS_SENTINEL
  } catch {
    return true
  }
}

/**
 * dismiss：best-effort 寫入 sentinel（同 main.ts `persist()` 慣例）。寫入
 * 失敗僅靜默降級（無痕模式／配額）——見檔頭「best-effort 讀寫」段落，呼叫
 * 端仍讓本次隱藏生效，本函式不需另行回傳成功與否。
 */
export function dismissTutorialBand(): void {
  try {
    localStorage.setItem(TUTORIAL_DISMISS_KEY, TUTORIAL_DISMISS_SENTINEL)
  } catch {
    // best-effort 持久化，見上方函式註解。
  }
}
