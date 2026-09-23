/**
 * T1.3（(internal design doc) §D7 存檔、載入與分享；
 * §Recommended approach 模組表）：localStorage 兩把 key 的零相依葉模組。
 *
 * **零相依硬約束（檔頭自我提醒，見 storage-keys.test.ts 原始碼掃描）**：
 * 本檔不得使用任何跨模組載入語法（ECMAScript 模組載入關鍵字、CommonJS
 * 載入函式），也不得使用列舉宣告、命名空間宣告或裝飾器語法——一切非
 * 可抹除語法皆禁。理由：`scripts/e2e-room-layout.mjs` 於 Node ≥22.18
 * 型別剝離（type-stripping）機制下直接載入本檔（PLAN §D7、
 * §Recommended approach「`serialize.ts` 有相對載入語法，不可被 e2e 直接
 * 載入」——本檔是唯二例外之一），一旦混入前述語法，Node 原生剝離會失敗
 * 或行為偏離 `tsc` 編譯結果。單元測試逐字掃描本檔原始碼把關，任何未來
 * 修改若違反本約束會立即變紅。
 */

export const STORAGE_KEY = 'clientkit-room-layout-planner-plan'
export const BACKUP_KEY = 'clientkit-room-layout-planner-plan-backup'
