/**
 * T0.3（(internal design doc) §D4「7 把 localStorage
 * key」列＋Implementation notes「`STORAGE_KEY` 不得從 `main.ts` export」）：
 * statusline-builder 主設定（BuilderConfig 序列化存放）localStorage 鍵的
 * 單一常數出口（比照 `catalog-collapse.ts`／`tutorial-band.ts` 單一出口的
 * 模組形態）。
 *
 * ── 為何獨立成模組 ──
 * `main.ts` 模組頂層即執行 DOM 查詢與 `init()`（頂層副作用），dom 測試皆
 * 須 `vi.resetModules()` 後動態 import 才能取得乾淨實例——若鍵常數由
 * `main.ts` 匯出，任何靜態 import 都會提早觸發 init()。故鍵常數收斂於本
 * 無副作用模組：`main.ts`、各 `*.dom.test.ts`、`scripts/e2e-statusline.mjs`
 * （node 端 seed 步驟）一律從此匯入，不得另行字面重複一份（防測試網與
 * 實作漂移）。
 *
 * ── 命名 ──
 * 冒號式 `<brand>:statusline-builder:config` 為舊命名形狀（SPEC
 * Conventions grandfathered，與 `i18n-dom.ts` 的 `LANG_STORAGE_KEY` 等
 * 連字號式鍵並存）。品牌前綴已於 sprint 17 M1 的 7 把 key 原子 commit 改為
 * `clientkit`（沿用舊形狀，僅換前綴；T0.3 建立出口、T1.2 改值）。字面釘值
 * 集中於 `src/storage-keys-pin.test.ts`。
 *
 * ── 無副作用 ──
 * 本檔只匯出字串常數：不碰 `localStorage`、不 import 任何模組、無 DOM
 * 依賴——可被 node 環境測試與 e2e 腳本安全靜態 import。
 */

/**
 * localStorage 鍵（BuilderConfig 序列化存放）——單一出口：main.ts 的
 * 讀檔／persist 與 dom 測試、e2e seed 步驟皆從此匯入。
 */
export const STORAGE_KEY = 'clientkit:statusline-builder:config'
