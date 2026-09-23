#!/usr/bin/env node
/**
 * CDP 整合案（statusline-builder 多列拖曳／位置制 slots 迴歸網）。
 *
 * 依據 `(internal design doc)` §D-b（CDP 腳本重建
 * 形態：獨立 node script＋`npm run test:e2e`、不進 vitest 預設 gate）與
 * `(internal design doc)`（T1.5 PoC 結論）
 * 定案：
 *   - **零新依賴**：Node ≥22 內建 global `fetch`／`WebSocket`／
 *     `node:child_process` 足以完成 CDP 全鏈，不需
 *     `chrome-remote-interface`／`puppeteer-core` 等套件。
 *   - **headless(new) 為預設執行形態**（`E2E_HEADED=1` 可切 headed 供
 *     人工除錯——PoC 實測 headed 耗時不可預期、曾見單輪暴增十餘倍，
 *     不建議常態使用）。
 *   - **逐案全新瀏覽器＋全新 `--user-data-dir`**（sprint 07「單 drag 單
 *     browser session」教訓：同 session 第二次拖曳的合成 drop 管線不
 *     穩，故每案皆重啟一個全新 `msedge.exe` 行程）。
 *   - 座標計算一律先 `element.scrollIntoView({behavior:'instant'})`
 *     再讀 `getBoundingClientRect()`（PoC 實測：≥3 列版面下段控件列
 *     加總高度遠超任何固定 viewport，不捲入視野會導致
 *     `Input.dragIntercepted` 永遠不發生——behavior 必須是 'instant'，
 *     smooth 捲動是非同步動畫，同一次 `Runtime.evaluate` 內緊接著讀到
 *     的 rect 仍是捲動前的舊值）。
 *   - `spawn`／`spawnSync` 呼叫 `npm`（Windows 上為 `npm.cmd`）一律帶
 *     `{ shell: true }`（純 spawn 直接丟 `EINVAL`）。
 *   - `vite preview` 自起自收：起時解析其自報的實際埠（vite 埠衝突時
 *     自動找下一個可用埠，本腳本不用自己防撞，只需正確剝除 ANSI
 *     escape 後解析輸出）；跑完 `taskkill /T /F` 整條行程樹。
 *
 * 涵蓋清單（使用者依 sp8/REPORT.md 核可的五案；底本＝
 * `(internal design doc)`（same-row-swap 原型）
 * ＋ sprint 07 scratchpad `cdp-slots.mjs`（S1–S9 位置制 slots 情境定義，
 * 本機若尚存可對照，未簽入 repo）：
 *   1. 同列交換拖曳（多列拖曳基本盤）。
 *   2. S1：跨列拖 drain——唯一段拖離、來源列原地保留為空占位列
 *      （`.segment-pending-row`，非消失）。
 *   3. S4：select 先排空一列（變 pending）、再把另一段用 select 指派
 *      進中間 pending（插入語意最刁鑽的一案：目標 pending 變真實列，
 *      被指派段的原列若因此排空亦轉為新 pending）。
 *   4. S9：drain 後刪除該 pending → 其後真實列編號緊縮重排。
 *   5. S7：drag drain 後 reload——pending 為純 UI 態，不入
 *      `localStorage` 存檔（SPEC：空列不入存檔），reload 後 pending
 *      消失、真實列緊湊重編（本腳本開發期以 CDP 對 dist 建置的真實頁面
 *      實測驗證此行為，與五案清單描述一致，非臆測）。
 *
 * T6.1（(internal design doc)，2026-07-17 使用者核可）
 * 追加兩案，五案→七案：
 *   6. 目錄拖入指定列——真拖曳（`Input.dispatchDragEvent`）觸發
 *      enable-into-target seam（main.ts `commitEnableIntoTarget`）。
 *      `catalog-drag.dom.test.ts` 僅以 jsdom 手工 `MouseEvent` dispatch
 *      驗證邏輯層（無原生 DnD／dataTransfer），本案補上真實瀏覽器拖放
 *      管線的一致性驗證。
 *   7. 產出 dialog 開→複製→Esc 關→焦點還原產出鈕——`Input.dispatchKeyEvent`
 *      注入真實 Esc 按鍵，觸發原生 `<dialog>` 的 cancel→close 鏈路（非
 *      `output-dialog.dom.test.ts` 該檔手工 `dispatchEvent(new
 *      Event('close'))` 模擬的邏輯層驗證），確認 `wireOutputDialog` 的
 *      `close` 監聽器在真實瀏覽器下確實把焦點還原至開鈕。
 *
 * T3.1（(internal design doc) M3，09 review 缺口——jsdom 層
 * `catalog-drag.dom.test.ts` 僅模擬 DnD、無真機覆蓋「非 inherit 覆寫值 ×
 * 真拖曳」組合）追加一案，七案→八案：
 *   8. 非 inherit 覆寫（色＋variant）× 真 DnD 跨列拖曳存活：`cwd` 段（唯一
 *      三段可設 variant 之一，見 segments.ts CWD_VARIANTS）主色設為
 *      ansi256 索引 3（非 `{kind:'default'}`）＋ variant 設為 `basename`
 *      （非預設 `full`），皆透過真實 DOM 事件（radio/checkbox `.checked`
 *      ＋`change` 事件，比照既有 `selectMove` 手法，非 jsdom 模擬——本腳本
 *      全案皆走真 Chromium）。真拖曳（`dragBySelector`，同案 2/5/6 手法）
 *      把 `cwd` 握把跨列拖至另一列列尾，斷言：(a) UI 控件（色選 mode
 *      radio／ANSI 索引 spinbutton／variant `<select>`）與 localStorage
 *      config 中的覆寫值拖後不變、僅 `row` 變；(b) 產出 bash 腳本（`
 *      #output-bash code`，main.ts `refreshOutputs` 隨每次 `commitConfig`
 *      即時更新，不需開 dialog）內 `cwd` 專屬區塊（`emit-bash.ts`
 *      `emitSegment` 恆以 `# <id>` 起頭、區塊內部行皆不以 `#` 開頭，見
 *      `extractSegmentBlock` 文件）含覆寫指紋（ansi256 fg SGR 字面
 *      `'38;5;3'`＋`basename` variant 專屬 jq `split("[/…` 片段）；拖前拖後
 *      兩份區塊逐字比較——去除多列陣列變數列位尾碼（`texts_N`／`fgs_N`／
 *      `segstart_N`，見 `emit-bash.ts` `pushLine`／`rowSuffix`）後必須逐字
 *      相同（`normalizeRowSuffix`），去除前必須不同（證明列位確實有變、
 *      非恆真空比對）。
 *
 * T4.1／T4.2（(internal design doc)；PLAN §D5「拖曳教學」
 * round-2）：三欄版面重排（左＝設定／中＝預覽 sticky／右＝`#list-column`
 * 單一捲動容器，內容序＝教學帶→目錄→已選擇清單，見 index.html T2.1／
 * T2.2 節點註解）後的選擇器／座標校準＋新增兩案，八案→十案：
 *   - **全案明文前置步驟**：`seedExpr` 預設一併 seed 教學帶 dismiss
 *     sentinel（`TUTORIAL_DISMISS_KEY`／`TUTORIAL_DISMISS_SENTINEL`，
 *     從 `tools/statusline-builder/tutorial-band.ts` import，見檔頭
 *     import 處與 `seedExpr` 文件——本腳本零字面重複一份 key/sentinel）
 *     ——每案皆全新 profile，`shouldShowTutorialBand()` fail-open（無
 *     key 即顯示），不 seed 教學帶即擋在段列／目錄之前搶座標。逐案可用
 *     `testCase.seedTutorial: false` 關閉此預設步驟（案 9 用）。既有
 *     案 1–8 選擇器／`data-testid` 錨點與 `scrollIntoView`＋
 *     `getBoundingClientRect` 活座標紀律經實跑校準後**零需求變更**（右欄
 *     單一捲動容器重排未破壞任何錨點）。
 *   9. 「教學帶不擋拖曳」無條件回歸案：`seedTutorial:false` 保留教學帶
 *      可見，驗證同容器內真拖曳（同案 1 same-row-swap 手法）不受阻、
 *      且拖曳手勢本身不誤觸 dismiss（band 拖後仍在場）。
 *      〔**已於 sprint 15 T4.1 改寫**：教學帶遷目錄欄後本案退化為恆真，
 *      改測「教學帶在場時**目錄欄內起手**的跨欄拖曳不受阻」，id 亦隨之
 *      更名為 `tutorial-band-does-not-block-catalog-drag`。完整理由見
 *      下方「sprint 15 T4.1」節與該案自身註解。〕
 *   10. mode 切換（plain→powerline）前後 `window.scrollY` 不變：鎖 T3.1
 *      （09-PLAN §D4 回饋 #4）刪除 `segmentListsEl.focus()` 的焦點竊取
 *      回歸——真實滑鼠點擊 powerline radio（CDP `Input.dispatchMouseEvent`
 *      mousePressed→mouseReleased，非 JS `.click()` 方法——校準實跑發現
 *      `.click()` 方法不觸發瀏覽器原生 focus 行為，見 `clickBySelector`
 *      文件；原生 mousedown 才會給 radio 焦點，正是舊 bug 觸發形）。主
 *      判準 `window.scrollY`；若三欄版面下整頁本身因各欄自身
 *      `overflow-y:auto` 而不可捲（`scrollY` 恆 0），後備改捲
 *      `#list-column` 自身 `scrollTop` 為斷言標的（兩判準皆先斷言「捲動
 *      後 >0」防空泛恆真，見案文件）。`document.activeElement` 為選配
 *      斷言。
 *
 * S-d（(internal design doc) §S-d，MS0 前置 spike）：
 * harness 加 `testCase.viewport` 欄位，改寫原本 `launchBrowser`
 * `--window-size`／`runCase` `Emulation.setDeviceMetricsOverride` 雙處
 * 硬編 1400×1000 為逐案取值（未指定即落 `DEFAULT_VIEWPORT`，見該常數
 * 文件——既有十案皆走此分支、零迴歸），並追加第 11 案，十案→十一案：
 *   11. 1280×800 viewport 探針：不做拖曳，只驗 harness 座標系本身——
 *       `window.innerWidth`/`innerHeight` 確實等於本案指定值、已知元素
 *       （`#preview-section`）`getBoundingClientRect` 合理（寬度 >0 且
 *       右緣落在 viewport 內）、該 rect 中心點 `elementFromPoint` 命中
 *       目標本身或其後代。常駐迴歸哨兵，永久保留（非驗完即刪），為
 *       MS2/MS4 後續里程碑所需的 1280×800／390×844 等多種 viewport
 *       鋪路。詳見 spikes/S-d-RESULT.md。
 *
 * T2.6（(internal design doc) MS2「G2 桌面硬驗收」）：
 * 頂帶 sticky 黏著幾何＋兩欄遮蔽殘差斷言，追加兩案（1400×1000／1280×800
 * 各一），十一案→十三案。判準取自 `spikes/S-a-RESULT.md`「二、三門檻判定
 * 矩陣」／「七、MS2 施工指令」第 4 條（S-a 已拍板，本批僅落地為 e2e 斷言，
 * 未新增判準本身）：
 *   12/13. T1 頂帶（`#preview-section`）每一取樣點完整在視窗內；T2 穩態
 *       （scrollY 已達「頂帶自然文件流位置」，執行期於 scrollY=0 量得，
 *       不寫死頁首 px 數字——S-a-RESULT「六」節已記錄原型頁首 268px 與
 *       真實頁落差，動態量測天然免疫）時頂帶 `rect.top===0`（±2px 次
 *       像素容許，S-a-RESULT 未對真實 dist 頁面明定確切值，依 brief 指示
 *       採 ±2px）；T3 兩欄（`#catalog-section`／`#list-column`）
 *       `rect.top ≥ 頂帶 rect.bottom`。
 *
 *       **容許量重新校準**（brief 明文授權：「若 MS2 實作後...與本原型
 *       有出入，須重新量測校準此容許量」）：對真實 dist 頁面實測發現，
 *       候選 2 定案的 ≤140px N4 遮蔽殘差**並非只在 literal max-scroll
 *       取樣點出現**——欄一旦進入「頂帶已黏著」的捲動區段（scrollY≥穩態
 *       捲距）即無停留窗口、隨捲動連續線性退化直到文件真正捲到底，與
 *       `S-a-RESULT.md`「二」節原型判定矩陣完全同型（該表 m1a 三個
 *       viewport 皆於 `scroll400`／`max` 兩取樣點同時判「未過」，且明文
 *       歸類為**同一組**已接受 N4，非兩個獨立問題）。已用最小 seed
 *       （`{model:0}`）與 8 段 seed 兩種組態複測：`maxScroll`／退化曲線
 *       逐位元相同（catalog 欄固定約 24 項、恆撐出 ~2146px scrollHeight，
 *       與 seed 段數無關），排除「seed 選太滿造成偽陽性」的可能。故本批
 *       將 140px 容許的**適用範圍**由「僅 literal max 取樣點」重新校準為
 *       「穩態捲距之後的所有取樣點（含 max）」；穩態捲距**之前**仍是
 *       零容許（實測此段兩欄恆為 32px 正值安全帶，未觀察到任何非預期
 *       遮蔽）。詳見案本身程式碼註解（`runG2PreviewBandSticky`）與 T2.6
 *       DONE 報告。
 *
 *       種子沿用案 10（mode-switch-scroll-position-stable）5 列組態；
 *       取樣點 scrollY∈{0,200,400,max}（max=`documentElement.scrollHeight
 *       − innerHeight`，執行期量得）；案內先斷言 `maxScroll>0` 防假綠
 *       （brief 明文要求）。〔**code review 🟡-5／🟡-8／🟢 已加固**：取樣
 *       點插入穩態捲距本身（頂帶剛黏住那一刻的幾何把關）、補
 *       `maxScroll ≥ steadyThreshold` 前提防呆、補「穩態後遮蔽劣化單調
 *       性」輔助斷言、穩態判定改讀實際 `window.scrollY`，見
 *       `runG2PreviewBandSticky` 內逐條註解。〕
 *
 * ── sprint 15 MS4（(internal design doc)）──────────
 *
 * T4.1（既有案校準，**不增減案數**，十三案仍為十三案）：
 *   - 案 9 **改寫**（id：`tutorial-band-does-not-block-drag` →
 *     `tutorial-band-does-not-block-catalog-drag`）：MS2 把教學帶自右欄頂
 *     遷至**目錄欄頂**後，「帶在場 × 列區內同列互換拖曳」兩者已無幾何
 *     交集、案退化為恆真。改測「教學帶在場時，**目錄欄內起手**的跨欄
 *     拖曳（目錄項 → 列區目標列）不受阻，且拖曳手勢不誤觸 dismiss」，
 *     並加一條前提斷言（`#catalog-section` 必須 contains 教學帶）防它
 *     日後再度悄悄變成恆真。選「改寫」而非「退場」的理由（與 G4 新案
 *     不重疊）見該案自身註解。
 *   - 案 10 **校準**：`#list-column` 語意自「唯一捲動容器」改為「列區欄」
 *     （id 本身不需更換，MS2 只搬不刪）；實跑確認主判準 `window.scrollY`
 *     在 M1′-a 捲動模型下是活路徑（後備分支保留為版面前提失守時的逃生
 *     路徑，已誠實標注其現行角色）；**新增補充判準**——兩個欄級捲動容器
 *     （`#catalog-section`／`#list-column`）各自的 `scrollTop` 亦納入
 *     「切換前後不變」斷言（新版面下焦點竊取造成的捲動可能只反映在欄
 *     容器上、不反映在頁面捲距）。
 *   - 其餘案：MS2／MS3 落地後選擇器全數沿用、零校準需求（實跑十三案
 *     全綠確認）。
 *
 * T4.2（G4 拖曳幾何硬驗收）：十三案→十五案。
 *   14/15. 跨欄拖曳（目錄欄 shell-out 分區的停用段 → 列區非首列）全程
 *       `window.scrollY`／目錄欄 `scrollTop`／列區欄 `scrollTop` 不變
 *       （容許量 ±2px，取自 `spikes/S-i-RESULT.md`「G4 定案」）；1400×1000
 *       與 1280×800 各一案、共用 runner。harness 為此新增
 *       `dragFixedPoints`（座標由呼叫端算好、全程固定、不 `scrollIntoView`、
 *       drop 前不重求值、逐階段取樣）與 `assertAwayFromScrollEdge`
 *       （S-i 建議的 ≥40px 容器邊緣安全帶共用檢查）。**本批新發現**：
 *       dragstart 後一幀落地的 `body.is-segment-dragging` 命中區擴張
 *       （style.css，T5.11 刻意設計）會造成一次性、有界、可逆的位移，
 *       依 viewport 不同分別落在「`scrollTop` 補償」或「畫面位移」通道
 *       ——判準因此以**執行期實測的擴張量**為上界處理該次跳動，拖曳期間
 *       （dragstart→drop）與 drop 後回歸則維持 ±2px 嚴格斷言。完整論證
 *       見該 runner 內註解。〔**code review 🟡-3 已限縮該上界**：由「全部
 *       列群組加總」改為「**目標列之上**列群組的實測長高總量」（涵蓋
 *       padding-bottom 與 min-height 兩條通道）＋單群組量級天花板，見
 *       `G4_SCROLL_SAMPLE_EXPR` 文件。〕
 *
 * T4.3（G8＋skip 可見性）：十五案→十九案。
 *   16/17. G8：390×844、seed 行動版收合 key（自 `catalog-collapse.ts`
 *       import，見檔頭 import 處）、頂帶 sticky 穩態下斷言「列區起始完整
 *       落在視窗內」（口徑見該 runner 註解）；**教學帶顯示／已 dismiss
 *       兩種前置態各一案**。
 *   18/19. skip 可見性：1400×1000 與 390×844 各一案，逐條走完五條
 *       skip-link 的「聚焦 → 命中測試 → 真 Enter → 落點與頂帶不相交」；
 *       落點在頂帶內的兩條（`#preview-section` 自身／`#output-dialog-open`
 *       ——MS2 已把產出鈕移進頂帶右端）豁免相交斷言、改驗焦點與命中測試，
 *       理由見該案註解。
 *
 * ── sprint 15 code review 修正批（`(internal design doc)
 *    (internal design doc)`，e2e 側五條）────────────────────────────────
 *
 * 既有案內部的判準加固**不增減案數**：🟡-3（G4 動態上界由「全部列群組
 * 加總 ≈200px」限縮為「目標列之上列群組的實測長高總量」＋單群組量級天
 * 花板）、🟡-5／🟡-8／🟢「isSteady 用要求值」（G2 四項：前提防呆、穩態
 * 交界取樣點、穩態後遮蔽單調性、實得捲距判穩態）、🟡-2 選配（G8 兩案補
 * 「出貨態 `js-init-pending` class 確實被 init() 移除」斷言——jsdom 對此
 * 恆真，唯真瀏覽器有鑑別力）。另新增兩案，十九案→二十一案：
 *   20. 🟡-6（e2e 部分）：D8「桌面態硬條件」1400×1000——
 *       `#catalog-collapse-summary` 的 computed `display==='none'`＋
 *       `#catalog-collapse-details.open===true`＋目錄清單確實可見
 *       （渲染高度 >0），把只在 style.css 存在、改版前零紅燈的桌面規則
 *       納入真瀏覽器回歸網。
 *   21. 🟡-7：<1100px（390×844）`<summary>` **真點擊**持久化——不 seed 收合
 *       key，真滑鼠事件點擊 → 收合 → 等雙 rAF＋餘裕 → 斷言 localStorage
 *       終值為 sentinel；再點一次 → 展開 → 斷言 key 已移除。行使
 *       `scheduleCatalogCollapsePersist()` 的雙 rAF 真時序（S-f 平台坑的
 *       回歸護欄；jsdom 的 `<details>` 同步翻轉 `open`，零鑑別力）。
 * 逐條完整判準與論證見對應 runner／案自身註解（皆標 review 編號）。
 *
 * 用法：
 *   node scripts/e2e-statusline.mjs      # 或 npm run test:e2e
 *   E2E_HEADED=1 node scripts/e2e-statusline.mjs   # 人工除錯用 headed
 *
 * 找不到本機 Edge/Chromium → 印明確 skip 訊息、exit 0（不算失敗）。
 * 任一案 FAIL → exit 1；全過 → exit 0。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

// MAGI review 🟡-2（4 票採納：Node 22.0–22.17 跑本腳本會以隱晦 loader
// 錯誤炸裂——`import '...tutorial-band.ts'` 這種 static import 語句在
// ESM 規範下一律 hoist 到模組頂端求值，早於模組主體內任何一行程式碼，
// 故無法靠「import 之後再檢查版本」防禦；改為 import 前先手動解析
// `process.versions.node`，未達門檻即印友善訊息＋`exit(1)`，通過後才
// 以 top-level await 動態 import 同一份常數出口）。
const [nodeMajorStr, nodeMinorStr] = process.versions.node.split('.')
const nodeMajor = Number(nodeMajorStr)
const nodeMinor = Number(nodeMinorStr)
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 18)) {
  console.error(
    `[e2e] 本腳本需 Node ≥22.18（.ts type stripping 預設啟用）；偵測到 v${process.versions.node}`,
  )
  process.exit(1)
}

// T4.1（(internal design doc)；PLAN §D5「e2e seed 步驟應
// import 同一常數，不得字面重複」）：教學帶 dismiss key／sentinel 單一
// 出口——直接 import tools/statusline-builder/tutorial-band.ts（純可抹除
// 語法，無 enum/namespace，可安全 strip）而非在本腳本另行字面複製一份。
// **本依賴需 Node ≥22.18**（type stripping 預設啟用版本；本腳本本機
// 限定、`package.json` engines `>=22`，屬可接受的 dev-only 前提，實測
// 本機 Node v24.10.0 可直接 `import` .ts 檔）——上方版本門檻檢查已通過
// 才會執行到此行，故改為 top-level await 動態 import（而非 static
// import，見上方 MAGI review 🟡-2 註解，static import 的 hoisting 特性
// 使其無法被任何執行期檢查攔在前面）。
const { TUTORIAL_DISMISS_KEY, TUTORIAL_DISMISS_SENTINEL } = await import(
  '../tools/statusline-builder/tutorial-band.ts'
)

// T4.3（(internal design doc) MS4）：行動版目錄收合的
// localStorage key／sentinel——比照上方教學帶常數的作法，**直接 import
// `catalog-collapse.ts` 的單一出口**（該檔檔頭明文要求：「未來 e2e seed
// 步驟（node 端）亦應 import 同一常數，不得另行字面重複一份」），不在本
// 腳本字面複製一份 `'clientkit-statusline-builder-catalog-collapsed'`／`'1'`。
// 同一 Node ≥22.18 type-stripping 前提（該檔為純可抹除語法：僅型別註記、
// 無 enum/namespace），同樣以 top-level await 動態 import 排在版本門檻之後。
const { CATALOG_COLLAPSE_KEY, CATALOG_COLLAPSE_SENTINEL } = await import(
  '../tools/statusline-builder/catalog-collapse.ts'
)

// sprint 17 M1（(internal design doc) §D4「7 把
// localStorage key」列）：主設定存檔 key——同上兩處先例，**直接 import
// `config-storage-key.ts` 的單一出口**（該檔無副作用、純字串常數），不在本
// 腳本字面複製一份。下方 seed 與三處存檔讀取的 `Runtime.evaluate` 內插字串
// 一律以 `JSON.stringify(CONFIG_STORAGE_KEY)` 內插（同 seedExpr 既有紀律）。
const { STORAGE_KEY: CONFIG_STORAGE_KEY } = await import(
  '../tools/statusline-builder/config-storage-key.ts'
)

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const SCRATCH_ROOT = join(tmpdir(), 'eztools-e2e-statusline-profiles')
const HEADED = process.env.E2E_HEADED === '1'

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe') : null,
  // 非 Windows／Chromium 後備路徑（本腳本以 Windows+Edge 為主要開發／
  // 驗證環境，其餘平台路徑列出以求探測完整，未逐一實跑驗證）。
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p) => p !== null)

const ALL_SEGMENT_IDS = [
  'model', 'cwd', 'project-dir', 'output-style', 'version', 'cost', 'duration',
  'lines-changed', 'context-size', 'thinking', 'context-used', 'context-remaining',
  'rate-5h', 'rate-7d', 'session-name', 'effort', 'vim-mode', 'agent-name', 'pr',
  'repo', 'worktree', 'worktree-branch', 'git-branch', 'git-dirty', 'clock',
]

// ── 瀏覽器探測 ─────────────────────────────────────────────────────────

function detectBrowser() {
  for (const p of EDGE_CANDIDATES) {
    if (existsSync(p)) return p
  }
  return null
}

// ── vite preview 生命週期 ──────────────────────────────────────────────

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

function ensureBuilt() {
  const marker = join(REPO_ROOT, 'dist', 'tools', 'statusline-builder', 'index.html')
  if (existsSync(marker)) {
    console.log('[e2e] dist/ already built (found tools/statusline-builder/index.html) — skipping build.')
    console.log('[e2e] Run `npm run build` manually first if you want to test a fresh change.')
    return
  }
  console.log('[e2e] dist/ missing — running `npm run build` once ...')
  const result = spawnSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit', shell: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`npm run build failed (exit ${result.status})`)
}

function startPreview() {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('npm', ['run', 'preview'], { cwd: REPO_ROOT, shell: true })
    let resolved = false
    let buf = ''
    const onData = (chunk) => {
      buf += stripAnsi(chunk.toString())
      const m = buf.match(/Local:\s+(http:\/\/localhost:\d+)\//)
      if (m && !resolved) {
        resolved = true
        resolvePromise({ proc, baseUrl: m[1] })
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', (code) => {
      if (!resolved) reject(new Error(`vite preview exited early (code ${code}); output so far: ${buf}`))
    })
    setTimeout(() => {
      if (!resolved) reject(new Error(`timed out waiting for vite preview URL; output so far: ${buf}`))
    }, 15000)
  })
}

function killProcessTree(pid) {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already dead
    }
  }
}

/**
 * 最終掃尾（sp8 PoC 實測發現：`taskkill /PID <pid> /T /F` 未必能清掉
 * Chromium 分離出的輔助行程，如 crashpad handler——這類行程刻意不在 OS
 * 記錄的親子關係樹內，`/T` 找不到）：以 command line 是否含本次
 * `SCRATCH_ROOT` 路徑片段為準，逐一強制關閉殘留的瀏覽器行程——只掃「本次
 * 腳本開出的」profile，不動使用者自己開著的瀏覽器視窗。僅 best-effort，
 * 靜默失敗（非 Windows 平台略過——`taskkill`／`Get-CimInstance` 皆
 * Windows 專屬，其餘平台的殘留行程清理留待後續需要時再補）。
 */
function sweepOrphanBrowser() {
  if (process.platform !== 'win32') return
  const marker = 'eztools-e2e-statusline-profiles'
  const script = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${marker}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' })
}

// ── CDP 基礎設施 ───────────────────────────────────────────────────────

async function waitForEndpoint(port, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await delay(200)
  }
  throw new Error('CDP endpoint not ready (timeout waiting for /json/version)')
}

async function waitForPageTarget(port, urlPrefix, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (res.ok) {
        const list = await res.json()
        const page = list.find((t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith(urlPrefix))
        if (page) return page
      }
    } catch {
      // not up yet
    }
    await delay(200)
  }
  throw new Error('page target not found under /json/list (timeout)')
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', (err) => reject(new Error(`WebSocket error: ${String(err)}`)))
  })
}

function makeClient(ws) {
  let id = 0
  const pending = new Map()
  const waiters = []
  const eventLog = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method) {
      eventLog.push(msg)
      for (const w of waiters) if (w.method === msg.method) w.resolve(msg.params)
    }
  })
  return {
    eventLog,
    send(method, params = {}) {
      const thisId = ++id
      return new Promise((resolve, reject) => {
        pending.set(thisId, { resolve, reject })
        ws.send(JSON.stringify({ id: thisId, method, params }))
      })
    },
    waitForEvent(method) {
      return new Promise((resolve) => waiters.push({ method, resolve }))
    },
  }
}

function launchBrowser(browserPath, { headless, userDataDir, url, port, viewport }) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
  ]
  if (headless) {
    args.push('--headless=new')
  } else {
    // 挪到主螢幕外側，減少對操作者前景視窗的干擾；不影響
    // getBoundingClientRect（皆為 viewport 相對座標，與視窗實際螢幕位置無關）。
    // S-d：headed 分支視窗尺寸改用呼叫端傳入的逐案 viewport（預設值＝
    // DEFAULT_VIEWPORT，見該常數文件），headless 分支則完全不吃這個
    // window-size、實際 viewport 由下方 runCase 的 CDP metrics override
    // 決定（本函式對 headless 分支不需要 viewport 參數，僅 headed 分支用到）。
    args.push('--window-position=2400,50', `--window-size=${viewport.width},${viewport.height}`)
  }
  args.push(url)
  return spawn(browserPath, args, { stdio: 'ignore' })
}

// T4.1（TASKS.md；14-PLAN §D5）：全案明文前置步驟——除既有 config seed
// 外，預設一併 seed 教學帶 dismiss sentinel（每案皆全新 profile，
// `shouldShowTutorialBand()` fail-open：無 key 即顯示，見
// tutorial-band.ts 檔頭），使既有拖曳/座標案不被教學帶（現與段列同居
// 右欄同一捲動容器）搶走座標或攔截拖曳事件。`dismissTutorial` 預設
// true（= harness 級預設前置步驟）；T4.2 新案「教學帶不擋拖曳」需保留
// 教學帶可見時傳 `false` 關閉本步驟（見 runCase 呼叫處 `testCase.
// seedTutorial`）。key/sentinel 皆從 tutorial-band.ts import（見檔頭），
// 不在此字面重複一份。
//
// T4.3（sprint 15 MS4）：新增 `collapseCatalog` 選項（預設 false＝不寫
// 收合 key，既有全部案零影響）——G8 案需要「使用者曾在行動版收合目錄」
// 的回訪前置態。key/sentinel 同樣 import 自 `catalog-collapse.ts`（見檔頭
// import 處），且**只寫 key**：是否真的收合仍由該檔的單一謂詞「收合 ⟺
// getItem(KEY)==='1' 且 <1100px」在頁面端裁決（本 seed 不繞過謂詞、不直接
// 動 `<details open>`），故同一把 key 於桌面 viewport 下 seed 也不會收合
// ——這正是謂詞該有的行為。
function seedExpr(enabledRows, { dismissTutorial = true, collapseCatalog = false } = {}) {
  return `
    (() => {
      const enabled = ${JSON.stringify(enabledRows)};
      const ALL = ${JSON.stringify(ALL_SEGMENT_IDS)};
      const segments = ALL.map((id) => enabled[id] !== undefined
        ? { id, enabled: true, icon: true, color: { kind: 'default' }, row: enabled[id] }
        : { id, enabled: false, icon: true, color: { kind: 'default' } });
      const config = { version: 2, mode: 'plain', separator: { kind: 'preset', value: '|' }, lastArrowCap: true, powerlineArrow: false, segments };
      localStorage.setItem(${JSON.stringify(CONFIG_STORAGE_KEY)}, JSON.stringify(config));
      ${dismissTutorial ? `localStorage.setItem(${JSON.stringify(TUTORIAL_DISMISS_KEY)}, ${JSON.stringify(TUTORIAL_DISMISS_SENTINEL)});` : ''}
      ${collapseCatalog ? `localStorage.setItem(${JSON.stringify(CATALOG_COLLAPSE_KEY)}, ${JSON.stringify(CATALOG_COLLAPSE_SENTINEL)});` : ''}
      return 'seeded';
    })()
  `
}

// S-d（sprint 15 MS0 前置 spike，PLAN.md §S-d）：viewport 單一事實來源。
// 改造前本檔雙處硬編 1400×1000（`launchBrowser` headed 分支 `--window-
// size`＋`runCase` 的 `Emulation.setDeviceMetricsOverride`）、10 案共用，
// 兩處各自字面重複，日後若要調其中一處極易漏改另一處。改為 `runCase`
// 內解出 `testCase.viewport ?? DEFAULT_VIEWPORT` 單一決策點，再往下傳給
// `launchBrowser`／CDP metrics override 兩處消費端——既有 10 案不逐案添
// `viewport` 欄位、一律落此預設值，效果與改造前的硬編 1400×1000 完全
// 相同（＝「帶原值」跑一輪、零迴歸）。sprint 15 後續里程碑（MS2/MS4）
// 需要 1280×800／390×844 等多種 viewport，本常數即其前置基礎設施。
const DEFAULT_VIEWPORT = { width: 1400, height: 1000 }

// ── 幾何輔助（多列版面下每段控件列很高，任何固定 viewport 都可能不夠；
// drop 前必須先把來源／目標元素捲入視野，且 scrollIntoView 須帶
// behavior:'instant'——見檔頭「零依賴 CDP 全鏈」段落文件）──
//
// T3.5（09-PLAN §D3 e2e 穩定錨點慣例，2026-07-17 拍板）：selector 全數
// 改走 `data-testid`（見 tools/statusline-builder/index.html 模板契約
// 「T3.5」條目與 main.ts 對應寫入點），不再依賴 `li.segment-row`／
// `.segment-row__grip` 等 class 名稱結構路徑——M4 版面重構／M5 i18n 皆
// 不會動搖這些錨點。

function gripPointExpr(segmentId) {
  return `(() => { const li = document.querySelector('[data-testid="segment-row"][data-segment-id=${JSON.stringify(segmentId)}]'); const grip = li.querySelector('[data-testid="segment-grip"]'); grip.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); const r = grip.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
}

function liPointExpr(segmentId, verticalFrac) {
  return `(() => { const li = document.querySelector('[data-testid="segment-row"][data-segment-id=${JSON.stringify(segmentId)}]'); li.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); const r = li.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * ${verticalFrac}) }; })()`
}

// T6.1：左欄目錄項（停用段）拖曳起點——落在 `.catalog-item__name`（段名
// 文字）而非 checkbox 本身。main.ts wireCatalogDragAndDrop 的 checkbox
// 命中區豁免僅檢查 `event.target.closest('input, select, button,
// textarea, [role="spinbutton"]')`，`<label>`／文字 span 皆不在排除清單
// 內，故名稱文字節點本就是合法拖曳起點——style.css `.catalog-item`
// `user-select: none` 正是為此互動預先鋪的防選字（見其文件 T3.3 段），
// 非本腳本繞路取巧。
function catalogPointExpr(segmentId) {
  return `(() => { const li = document.querySelector('[data-testid="catalog-item"][data-segment-id=${JSON.stringify(segmentId)}]'); li.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); const name = li.querySelector('.catalog-item__name'); const r = name.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
}

// T4.2：mode radio 點擊座標——**刻意不**呼叫 `scrollIntoView`（同檔案其餘
// 座標函式「先 scrollIntoView 再讀 rect」活座標紀律的唯一例外，T4.1 校準
// 實跑發現）：案 10 的斷言標的正是「點擊後捲動位置不變」，若座標計算本身
// 先呼叫 `el.scrollIntoView({block:'center'})`，該呼叫依規範對
// `block:'center'` 為**無條件**置中（即使元素已在可視範圍內也會捲動，
// 不像 `block:'nearest'` 僅在需要時才動）——會在測「不變」之前就先動了
// 捲動位置，汙染訊號。改為直接讀當前 `getBoundingClientRect()`：本案種子
// 資料（見案文件）之下，實測全域設定欄的 mode radio 於任一合法捲動位置
// （0–166px，本案版面之全頁最大可捲範圍）皆恆落在 1000px 高 viewport
// 內，故省略 scrollIntoView 不影響座標可點擊性。
function modeRadioClickPointExpr(selector) {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
}

// ── 兩欄捲動容器（sprint 15 MS2 版面；T4.1／T4.2 共用）─────────────────
//
// `#catalog-section`（目錄欄）與 `#list-column`（列區欄）自 MS2 起於
// ≥1100px 各自 `overflow-y:auto; max-height: calc(100dvh - var(--band-h))`
// ——**兩個**獨立捲動容器（sprint 14 的「單一捲動容器」幾何已消滅，見
// style.css「四區版面」節與 index.html 兩欄節點註解）。凡是要對「捲動
// 位置不變」下斷言的案（T4.1 案 10 補充判準、T4.2 G4 主判準）都應同時
// 涵蓋這兩個容器＋`window.scrollY`，只驗其中之一會漏掉另外兩個維度。
const COLUMN_IDS = ['catalog-section', 'list-column']

// 拖曳 session「建立位移」的步數與每步位移（`dragBySelector`／
// `dragFixedPoints` 共用同一組參數——CDP `Input.setInterceptDrags` 下
// 需要一段實際的滑鼠位移才會發出 `Input.dragIntercepted`）。T4.2 的 G4
// 案需要在**拖曳開始前**就能算出這十個中繼點的座標並逐點檢查
// 「距兩欄容器邊緣 ≥40px」安全帶（S-i 前提紀律），故自本批起把原本寫死
// 在 `dragBySelector` 迴圈內的 `i * 6`／`i * 3` 提為具名常數。
// dy 由 3 收斂為 2（10 步累計 30px → 20px）：純為 G4 安全帶預算讓路，
// 對既有案的拖曳建立行為無影響（實測既有八個拖曳案全綠）。
const DRAG_ESTABLISH_STEPS = 10
const DRAG_ESTABLISH_DX = 6
const DRAG_ESTABLISH_DY = 2

/** 兩欄容器各自的 `scrollTop`（不含 `window.scrollY`，後者見 G4 取樣式）。 */
const COLUMN_SCROLL_EXPR = `
  (() => Object.fromEntries(${JSON.stringify(COLUMN_IDS)}.map((id) => [id, document.getElementById(id).scrollTop])))()
`

// 全列群組快照（真實列＋pending 占位，DOM 序＝slot 序）；S1/S4/S9/S7 皆用
// 此比對。T3.5：改讀 `data-row-index`（序數屬性，main.ts refreshRowNumbering／
// renderPendingRowContainers 同步維護，語意＝顯示編號）取代原本比對
// heading textContent「第 N 列」——去除 i18n 可見文字依賴（M5 heading
// 文案將可切換語言，屆時文字比對必崩，序數屬性不受影響）。一併納入
// **每列 separator 覆寫狀態**（T1.7 新增控件）：真實列讀
// `.segment-row-group__separator-preset`（data-testid="row-separator-preset"）
// 的 `value`——'inherit'/'preset:X'/'custom' 為程式碼態值、非可見文字，
// 直接讀 DOM 控件值（而非重新推導 localStorage config 的 rowSeparators
// 正規化邏輯）更貼近「使用者實際看到的控件狀態」，且不需複刻
// main.ts refreshRowSeparatorControls 的映射規則於本腳本。pending 列無
// separator 控件，快照物件不含該欄位。
const SNAPSHOT_EXPR = `
  [...document.querySelectorAll('#segment-row-groups [data-testid="row-group"], #segment-row-groups [data-testid="pending-row-group"]')].map((el) => {
    const rowIndex = Number(el.dataset.rowIndex);
    if (el.dataset.testid === 'pending-row-group') return { kind: 'pending', rowIndex };
    const segs = [...el.querySelectorAll('[data-testid="segment-row"]')].map((li) => li.dataset.segmentId);
    const separatorOverride = el.querySelector('[data-testid="row-separator-preset"]')?.value ?? null;
    return { kind: 'real', rowIndex, segs, separatorOverride };
  })
`

// ── 段落區塊擷取（T3.1 新案專用；純字串處理，跑在 Node 端而非瀏覽器內，
// 不需另外進 evaluate） ──
//
// emit-bash.ts `emitSegment` 恆以 `# <id>`（單行，無前後綴）起頭；區塊
// 內部各行（jq 賦值／if-fi／push 陳述式）皆不以 `# ` 起首——僅下一個段的
// `# <nextId>` 或該列收尾的 `# -- row N join --` 會再次以 `# ` 起首（見
// emit-bash.ts emitSegment／groupByRow 檔頭文件），故「找下一個 `# `
// 開頭行」對任一段皆為安全邊界，不需複刻 emit-bash.ts 的分組演算法。

/** 從完整 bash 產出腳本擷取 `segmentId` 專屬區塊；找不到回 null。 */
function extractSegmentBlock(script, segmentId) {
  const lines = script.split('\n')
  const startIdx = lines.findIndex((line) => line === `# ${segmentId}`)
  if (startIdx === -1) return null
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('# ')) {
      endIdx = i
      break
    }
  }
  // 多列展開時，若該段恰為所屬列群組最後一個段，`emitBash` 會在其後補一個
  // 空行（列緩衝迴圈收尾）才輪到下一個 `# ` 開頭行——與該段是否列首/列尾
  // 無關的純結構性尾巴，比較「僅列位差異」前先修剪掉，否則會被誤判為內容
  // 差異（見本案 run() 內註解）。
  const slice = lines.slice(startIdx, endIdx)
  while (slice.length > 0 && slice[slice.length - 1] === '') slice.pop()
  return slice.join('\n')
}

/**
 * 多列展開時，段自身 push 陳述式的陣列變數帶列位尾碼（`texts_0`／`fgs_1`／
 * `segstart_2` 等，見 emit-bash.ts `pushLine`／`rowSuffix`）——這是「同一
 * 段搬到另一列」時腳本區塊唯一應該改變之處。比對「除列位外覆寫值／格式
 * 是否存活」前，先把尾碼正規化掉（統一換成 `_R`），使兩份區塊只在與列位
 * 無關的內容上比較。
 */
function normalizeRowSuffix(block) {
  return block.replace(/(texts|fgs|bgs|segstart)_\d+/g, '$1_R')
}

// ── 五案定義 ───────────────────────────────────────────────────────────

// 1. 多列拖曳基本盤：同列相鄰兩段拖曳互換順序。
const caseSameRowSwap = {
  id: 'same-row-swap',
  label: '同列交換拖曳（基本盤）',
  seed: { model: 0, cost: 0 },
  async run({ evaluate, dragBySelector }) {
    const before = await evaluate(
      `[...document.querySelectorAll('[data-testid="row-group"]')[0].querySelectorAll('[data-testid="segment-row"]')].map((li) => li.dataset.segmentId)`,
    )
    if (JSON.stringify(before) !== JSON.stringify(['model', 'cost'])) {
      return { ok: false, symptom: `unexpected seed order: ${JSON.stringify(before)}` }
    }
    const dragResult = await dragBySelector(gripPointExpr('cost'), liPointExpr('model', 0.25))
    if (!dragResult.ok) return dragResult
    const after = await evaluate(
      `[...document.querySelectorAll('[data-testid="row-group"]')[0].querySelectorAll('[data-testid="segment-row"]')].map((li) => li.dataset.segmentId)`,
    )
    if (JSON.stringify(after) === JSON.stringify(['cost', 'model'])) return { ok: true }
    return { ok: false, symptom: `order after drop: ${JSON.stringify(after)} (expected ["cost","model"])` }
  },
}

// 2. S1：跨列拖 drain——唯一段拖離、來源列原地保留為空占位列（非消失）。
const caseS1CrossRowDrain = {
  id: 's1-cross-row-drain',
  label: 'S1：跨列拖 drain（來源列保留為空占位列）',
  seed: { model: 0, cost: 1, duration: 2 },
  async run({ evaluate, dragBySelector }) {
    const dragResult = await dragBySelector(gripPointExpr('duration'), liPointExpr('cost', 0.75))
    if (!dragResult.ok) return dragResult
    const snapshot = await evaluate(SNAPSHOT_EXPR)
    const expected = [
      { kind: 'real', rowIndex: 1, segs: ['model'], separatorOverride: 'inherit' },
      { kind: 'real', rowIndex: 2, segs: ['cost', 'duration'], separatorOverride: 'inherit' },
      { kind: 'pending', rowIndex: 3 },
    ]
    if (JSON.stringify(snapshot) === JSON.stringify(expected)) return { ok: true }
    return { ok: false, symptom: `snapshot after drop: ${JSON.stringify(snapshot)} (expected ${JSON.stringify(expected)})` }
  },
}

// 3. S4：select 先排空一列（變 pending）、再把另一段 select 指派進中間
//    pending（目標 pending 變真實列；被指派段的原列若因此排空亦轉為新
//    pending——見檔頭文件，本行為已用 CDP 對真實建置頁面實測確認）。
const caseS4SelectIntoMiddlePending = {
  id: 's4-select-into-middle-pending',
  label: 'S4：select 排空後再 select 指派進中間 pending',
  seed: { model: 0, cost: 1, duration: 2 },
  async run({ evaluate, selectMove }) {
    // step 1：model（slot0 唯一段）select 到 duration 的列（slot2）→ slot0 排空.
    await selectMove('model', 2)
    const mid = await evaluate(SNAPSHOT_EXPR)
    const expectedMid = [
      { kind: 'pending', rowIndex: 1 },
      { kind: 'real', rowIndex: 2, segs: ['cost'], separatorOverride: 'inherit' },
      { kind: 'real', rowIndex: 3, segs: ['duration', 'model'], separatorOverride: 'inherit' },
    ]
    if (JSON.stringify(mid) !== JSON.stringify(expectedMid)) {
      return { ok: false, symptom: `snapshot after step1 (drain via select): ${JSON.stringify(mid)} (expected ${JSON.stringify(expectedMid)})` }
    }
    // step 2：cost（slot1 唯一段）select 指派進 slot0 的 pending。
    await selectMove('cost', 0)
    const after = await evaluate(SNAPSHOT_EXPR)
    const expected = [
      { kind: 'real', rowIndex: 1, segs: ['cost'], separatorOverride: 'inherit' },
      { kind: 'pending', rowIndex: 2 },
      { kind: 'real', rowIndex: 3, segs: ['duration', 'model'], separatorOverride: 'inherit' },
    ]
    if (JSON.stringify(after) === JSON.stringify(expected)) return { ok: true }
    return { ok: false, symptom: `snapshot after step2 (assign into pending): ${JSON.stringify(after)} (expected ${JSON.stringify(expected)})` }
  },
}

// 4. S9：drain 後刪除該 pending → 其後真實列編號緊縮重排。
const caseS9DeletePendingRenumber = {
  id: 's9-delete-pending-renumber',
  label: 'S9：刪除 pending 後真實列編號重排',
  seed: { model: 0, cost: 1, duration: 2 },
  async run({ evaluate, selectMove, delayFn }) {
    // drain model（slot0 唯一段）到 duration 的列（slot2）→ slot0 變 pending.
    await selectMove('model', 2)
    const mid = await evaluate(SNAPSHOT_EXPR)
    if (mid[0]?.kind !== 'pending') {
      return { ok: false, symptom: `expected slot0 pending after drain, got: ${JSON.stringify(mid)}` }
    }
    // 點該 pending 的刪除鈕（免確認，見 main.ts wirePendingRowButton 文件）。
    await evaluate(`
      (() => {
        const p = document.querySelector('[data-testid="pending-row-group"]');
        p.querySelector('[data-testid="pending-row-delete"]').click();
        return 'clicked';
      })()
    `)
    await delayFn(300)
    const after = await evaluate(SNAPSHOT_EXPR)
    const expected = [
      { kind: 'real', rowIndex: 1, segs: ['cost'], separatorOverride: 'inherit' },
      { kind: 'real', rowIndex: 2, segs: ['duration', 'model'], separatorOverride: 'inherit' },
    ]
    if (JSON.stringify(after) === JSON.stringify(expected)) return { ok: true }
    return { ok: false, symptom: `snapshot after deleting pending: ${JSON.stringify(after)} (expected ${JSON.stringify(expected)})` }
  },
}

// 5. S7：drag drain 後 reload——pending 為純 UI 態，不入存檔；reload 後
//    pending 消失、真實列緊湊重編。
const caseS7DragDrainReload = {
  id: 's7-drag-drain-reload',
  label: 'S7：drag drain 後 reload（pending 不入存檔、真實列緊湊重編）',
  seed: { model: 0, cost: 1, duration: 2 },
  async run({ evaluate, dragBySelector, navigate }) {
    const dragResult = await dragBySelector(gripPointExpr('duration'), liPointExpr('cost', 0.75))
    if (!dragResult.ok) return dragResult
    const mid = await evaluate(SNAPSHOT_EXPR)
    if (mid.length !== 3 || mid[2]?.kind !== 'pending') {
      return { ok: false, symptom: `expected 3-slot snapshot with pending at slot2 before reload, got: ${JSON.stringify(mid)}` }
    }
    // SPEC：空列（pending）不入存檔——只有真實啟用段的 row 寫進
    // localStorage；驗證存檔本身也不記錄 pending（非只驗 DOM）。
    const stored = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(CONFIG_STORAGE_KEY)})).segments.filter((s) => s.enabled).map((s) => ({ id: s.id, row: s.row }))`)
    const expectedStored = [
      { id: 'model', row: 0 },
      { id: 'cost', row: 1 },
      { id: 'duration', row: 1 },
    ]
    if (JSON.stringify(stored) !== JSON.stringify(expectedStored)) {
      return { ok: false, symptom: `localStorage segments before reload: ${JSON.stringify(stored)} (expected ${JSON.stringify(expectedStored)})` }
    }
    await navigate()
    const after = await evaluate(SNAPSHOT_EXPR)
    const expected = [
      { kind: 'real', rowIndex: 1, segs: ['model'], separatorOverride: 'inherit' },
      { kind: 'real', rowIndex: 2, segs: ['cost', 'duration'], separatorOverride: 'inherit' },
    ]
    if (JSON.stringify(after) === JSON.stringify(expected)) return { ok: true }
    return { ok: false, symptom: `snapshot after reload: ${JSON.stringify(after)} (expected ${JSON.stringify(expected)}, pending must NOT survive reload)` }
  },
}

// 6. T6.1：目錄拖入指定列——真拖曳把一個停用中的目錄段（duration，seed
//    刻意排除於 enabled 之外）拖進既有列（cost 所在列），觸發
//    enable-into-target seam（commitEnableIntoTarget）。斷言分兩層：
//    (a) 結構性（SNAPSHOT_EXPR 落列位置＋catalog-item 灰化 class／badge
//        hidden／checkbox.checked，皆非 i18n 可見文字，本 sprint 慣例）；
//    (b) 例外：播報 live region 含「已加入」（zh 預設語系字面比對——見
//        下方 run() 內註解，非唯一斷言依據，僅作額外訊號驗證）。
const caseCatalogDragIntoRow = {
  id: 'catalog-drag-into-row',
  label: 'T6.1：目錄拖入指定列（真拖曳觸發 enable-into-target）',
  seed: { model: 0, cost: 1 },
  async run({ evaluate, dragBySelector }) {
    const dragResult = await dragBySelector(catalogPointExpr('duration'), liPointExpr('cost', 0.75))
    if (!dragResult.ok) return dragResult
    const snapshot = await evaluate(SNAPSHOT_EXPR)
    const expectedSnapshot = [
      { kind: 'real', rowIndex: 1, segs: ['model'], separatorOverride: 'inherit' },
      { kind: 'real', rowIndex: 2, segs: ['cost', 'duration'], separatorOverride: 'inherit' },
    ]
    if (JSON.stringify(snapshot) !== JSON.stringify(expectedSnapshot)) {
      return { ok: false, symptom: `snapshot after catalog drag-in: ${JSON.stringify(snapshot)} (expected ${JSON.stringify(expectedSnapshot)})` }
    }
    const catalogState = await evaluate(`
      (() => {
        const li = document.querySelector('[data-testid="catalog-item"][data-segment-id="duration"]');
        const badge = li.querySelector('.catalog-item__badge');
        const checkbox = li.querySelector('.catalog-item__checkbox');
        return { enabledClass: li.classList.contains('catalog-item--enabled'), badgeHidden: badge.hidden, checked: checkbox.checked };
      })()
    `)
    const expectedCatalogState = { enabledClass: true, badgeHidden: false, checked: true }
    if (JSON.stringify(catalogState) !== JSON.stringify(expectedCatalogState)) {
      return { ok: false, symptom: `catalog item state after drag-in: ${JSON.stringify(catalogState)} (expected ${JSON.stringify(expectedCatalogState)})` }
    }
    // 例外斷言（本 sprint「e2e 避免比對 i18n 可見文字」慣例的例外一案，
    // 比照 T3.5-report.md 決策記錄精神）：落列播報句本身是使用者可感知
    // 的功能訊號（非純裝飾文案），目前僅 zh 為預設可測語系，故此處斷言
    // zh 播報含「已加入」；上方結構性斷言已足以判定成敗，本行僅為額外
    // 訊號驗證，非唯一依據。
    const liveText = await evaluate(`document.getElementById('segment-move-status').textContent`)
    if (typeof liveText !== 'string' || !liveText.includes('已加入')) {
      return { ok: false, symptom: `live region after catalog drag-in missing "已加入": ${JSON.stringify(liveText)}` }
    }
    return { ok: true }
  },
}

// 7. T6.1：產出 dialog 開→複製→Esc 關→焦點還原產出鈕。複製鈕不斷言
//    剪貼簿「成功」與否（headless 環境 navigator.clipboard.writeText 的
//    權限行為不定，見 copyOutput：成功／失敗兩分支皆呼叫
//    announceOutput，皆會移除 #output-status 的 is-empty class）——只驗
//    按鈕確實可點、確實觸發某個結果播報，取捨見 T6.1-report.md。Esc 以
//    CDP `Input.dispatchKeyEvent` 注入真實按鍵（非 JS dispatchEvent 模擬），
//    驗證原生 <dialog> 的 cancel→close 鏈路。
const caseOutputDialogEscFocusReturn = {
  id: 'output-dialog-esc-focus-return',
  label: 'T6.1：產出 dialog 開→複製→Esc 關→焦點還原產出鈕',
  seed: { model: 0, cost: 1 },
  async run({ evaluate, delayFn, pressEscape }) {
    await evaluate(`document.querySelector('[data-testid="output-dialog-open"]').click()`)
    await delayFn(250)
    const afterOpen = await evaluate(`
      (() => {
        const dialog = document.querySelector('[data-testid="output-dialog"]');
        return { open: dialog.open, focusInside: dialog.contains(document.activeElement) };
      })()
    `)
    if (!afterOpen.open || !afterOpen.focusInside) {
      return { ok: false, symptom: `dialog state after open click: ${JSON.stringify(afterOpen)} (expected open+focus inside)` }
    }

    await evaluate(`document.getElementById('copy-bash').click()`)
    await delayFn(300)
    const statusIsEmpty = await evaluate(`document.getElementById('output-status').classList.contains('is-empty')`)
    if (statusIsEmpty !== false) {
      return { ok: false, symptom: `#output-status still is-empty after clicking copy-bash (button seems unresponsive): is-empty=${statusIsEmpty}` }
    }

    await pressEscape()
    await delayFn(300)
    const afterEsc = await evaluate(`
      (() => {
        const dialog = document.querySelector('[data-testid="output-dialog"]');
        const openBtn = document.querySelector('[data-testid="output-dialog-open"]');
        return { open: dialog.open, activeIsOpenButton: document.activeElement === openBtn };
      })()
    `)
    if (afterEsc.open || !afterEsc.activeIsOpenButton) {
      return { ok: false, symptom: `dialog/focus state after Esc: ${JSON.stringify(afterEsc)} (expected closed + focus restored to open button)` }
    }
    return { ok: true }
  },
}

// 8. T3.1（(internal design doc) M3）：非 inherit 覆寫（色＋
//    variant）× 真 DnD 跨列拖曳存活——見檔頭文件「T3.1」節。段選擇＝
//    `cwd`（segments.ts 三個可設 variant 的段之一，且不在 barEligibleIds／
//    autoEligibleIds，主色 picker 為既有三態封閉版 createColorPicker，無
//    auto/bar 正交干擾）。seed 刻意讓 cwd 原列（row 0）尚有另一段
//    （duration）同列——跨列拖出 cwd 後來源列仍是真實列（非 pending 占位
//    列），聚焦本案主旨（覆寫存活），不與已由案 2/5 覆蓋的 drain/pending
//    語意重複。
const caseColorVariantOverrideSurvivesDrag = {
  id: 'color-variant-override-survives-drag',
  label: 'T3.1：非 inherit 覆寫（色＋variant）× 真 DnD 跨列拖曳存活',
  seed: { cwd: 0, duration: 0, cost: 1 },
  async run({ evaluate, dragBySelector, delayFn }) {
    // 設非 inherit 覆寫：真實 DOM 事件（比照既有 selectMove 手法：直接改
    // 控件狀態＋dispatch 'change'，非 CDP 座標點擊——picker 面板以
    // `hidden` 屬性隱藏未選中模式，座標點擊需先切模式才能命中，徒增
    // flake 面而不增測試價值，本案價值在「覆寫存活於真 DnD」而非「picker
    // 本身可點擊」，後者已有 default-hint/auto-color-duplicate-hint 等
    // dom.test.ts 覆蓋）。
    await evaluate(`
      (() => {
        const li = document.querySelector('[data-testid="segment-row"][data-segment-id="cwd"]');
        const picker = li.querySelector('.segment-row__color-mount .color-picker');
        const modeRadio = picker.querySelector('.color-picker__mode[value="ansi256"]');
        modeRadio.checked = true;
        modeRadio.dispatchEvent(new Event('change', { bubbles: true }));
        const swatchInput = picker.querySelectorAll('[data-swatch-container] input')[3];
        swatchInput.checked = true;
        swatchInput.dispatchEvent(new Event('change', { bubbles: true }));
        return 'color-set';
      })()
    `)
    await evaluate(`
      (() => {
        const sel = document.getElementById('cwd-variant');
        sel.value = 'basename';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return sel.value;
      })()
    `)
    await delayFn(300)

    const overrideExpr = `
      (() => {
        const li = document.querySelector('[data-testid="segment-row"][data-segment-id="cwd"]');
        const picker = li.querySelector('.segment-row__color-mount .color-picker');
        const modeRadio = picker.querySelector('.color-picker__mode:checked');
        const spinValue = picker.querySelector('.color-spinbutton__value');
        const variantSelect = document.getElementById('cwd-variant');
        return {
          colorMode: modeRadio ? modeRadio.value : null,
          ansiIndex: spinValue ? Number(spinValue.textContent) : null,
          variant: variantSelect ? variantSelect.value : null,
        };
      })()
    `
    const storedExpr = `
      (() => {
        const cfg = JSON.parse(localStorage.getItem(${JSON.stringify(CONFIG_STORAGE_KEY)}));
        const seg = cfg.segments.find((s) => s.id === 'cwd');
        return { color: seg.color, variant: seg.variant, row: seg.row };
      })()
    `
    const expectedOverride = { colorMode: 'ansi256', ansiIndex: 3, variant: 'basename' }

    const beforeUi = await evaluate(overrideExpr)
    if (JSON.stringify(beforeUi) !== JSON.stringify(expectedOverride)) {
      return { ok: false, symptom: `UI override state before drag not applied: ${JSON.stringify(beforeUi)} (expected ${JSON.stringify(expectedOverride)})` }
    }
    const beforeStored = await evaluate(storedExpr)
    if (beforeStored.color?.kind !== 'ansi256' || beforeStored.color.index !== 3 || beforeStored.variant !== 'basename' || beforeStored.row !== 0) {
      return { ok: false, symptom: `stored config before drag not applied: ${JSON.stringify(beforeStored)}` }
    }

    const beforeSnapshot = await evaluate(SNAPSHOT_EXPR)
    const expectedBeforeSnapshot = [
      { kind: 'real', rowIndex: 1, segs: ['cwd', 'duration'], separatorOverride: 'inherit' },
      { kind: 'real', rowIndex: 2, segs: ['cost'], separatorOverride: 'inherit' },
    ]
    if (JSON.stringify(beforeSnapshot) !== JSON.stringify(expectedBeforeSnapshot)) {
      return { ok: false, symptom: `unexpected row snapshot before drag: ${JSON.stringify(beforeSnapshot)} (expected ${JSON.stringify(expectedBeforeSnapshot)})` }
    }

    const beforeScript = await evaluate(`document.querySelector('#output-bash code').textContent`)
    const beforeBlock = extractSegmentBlock(beforeScript, 'cwd')
    if (beforeBlock === null) {
      return { ok: false, symptom: `cwd block not found in bash output before drag; full script: ${beforeScript}` }
    }
    // 指紋字面說明＋耦合意圖：`'38;5;3'` 為 ANSI 256 色前景 SGR 組碼字面
    // （`38;5;<idx>`，對應上方 seed 指定的 ansi256 index=3）；`split("[/`
    // 為 `basename` variant 專屬的 jq 片段開頭（cwd 段取路徑 basename 用，
    // 見 emit-bash.ts 對應 emitSegment 分支）。兩者皆是對 emit-bash 具體
    // 輸出格式的字面 snapshot——emit-bash 輸出格式（SGR 組碼寫法／jq 片段
    // 寫法）未來若改動，本案（案 #8）此處與下方拖曳後同款檢查應同步更新，
    // 否則會產生假陰性（指紋永遠找不到、誤判為「覆寫遺失」而非「格式已變」）。
    if (!beforeBlock.includes("'38;5;3'") || !beforeBlock.includes('split("[/')) {
      return { ok: false, symptom: `cwd block before drag missing override fingerprints (fg SGR '38;5;3' / basename split jq): ${beforeBlock}` }
    }

    // 真 DnD：cwd 握把拖至 cost 所在列列尾（同案 2/5/6 手法：dragBySelector
    // + gripPointExpr/liPointExpr(0.75)＝插入目標列尾）。
    const dragResult = await dragBySelector(gripPointExpr('cwd'), liPointExpr('cost', 0.75))
    if (!dragResult.ok) return dragResult

    const afterUi = await evaluate(overrideExpr)
    if (JSON.stringify(afterUi) !== JSON.stringify(expectedOverride)) {
      return { ok: false, symptom: `UI override state changed after drag: ${JSON.stringify(afterUi)} (expected unchanged ${JSON.stringify(expectedOverride)})` }
    }
    const afterStored = await evaluate(storedExpr)
    if (afterStored.color?.kind !== 'ansi256' || afterStored.color.index !== 3 || afterStored.variant !== 'basename') {
      return { ok: false, symptom: `stored color/variant changed after drag (expected unchanged): ${JSON.stringify(afterStored)}` }
    }
    if (afterStored.row !== 1) {
      return { ok: false, symptom: `expected cwd row to change 0→1 after cross-row drag, got row=${afterStored.row}` }
    }

    const afterSnapshot = await evaluate(SNAPSHOT_EXPR)
    const expectedAfterSnapshot = [
      { kind: 'real', rowIndex: 1, segs: ['duration'], separatorOverride: 'inherit' },
      { kind: 'real', rowIndex: 2, segs: ['cost', 'cwd'], separatorOverride: 'inherit' },
    ]
    if (JSON.stringify(afterSnapshot) !== JSON.stringify(expectedAfterSnapshot)) {
      return { ok: false, symptom: `unexpected row snapshot after drag: ${JSON.stringify(afterSnapshot)} (expected ${JSON.stringify(expectedAfterSnapshot)})` }
    }

    const afterScript = await evaluate(`document.querySelector('#output-bash code').textContent`)
    const afterBlock = extractSegmentBlock(afterScript, 'cwd')
    if (afterBlock === null) {
      return { ok: false, symptom: `cwd block not found in bash output after drag; full script: ${afterScript}` }
    }
    // 指紋字面同上（拖曳前 beforeBlock 檢查處）之說明，此處為拖曳後複驗、
    // 同一組耦合意圖（emit-bash 輸出格式改動時本檢查亦須同步更新）。
    if (!afterBlock.includes("'38;5;3'") || !afterBlock.includes('split("[/')) {
      return { ok: false, symptom: `cwd block after drag missing override fingerprints (fg SGR '38;5;3' / basename split jq): ${afterBlock}` }
    }

    // 後綴身分一致性（🟢-8 補強，封「混寫迴歸雙過兩道檢查」縫隙）：下方
    // normalizeRowSuffix 把 texts_N/fgs_N/bgs_N/segstart_N 全部收斂成 _R
    // 才比對「除列位外是否相同」——若把 beforeBlock／afterBlock 兩側誤混寫
    // （例如兩側其實代入了同一份 block），收斂後仍可能逐字相同，「正規化後
    // 相同」這道檢查本身測不出這種誤植。故先各自驗證 raw 列位尾碼的身分：
    // beforeBlock 應恆為 `_0`（cwd 種子在 row 0，見上方 seed／beforeStored.row
    // 斷言）；afterBlock 應恆為 `_1`（cwd 真拖曳落點在 cost 所在 row 1，見
    // 上方 afterStored.row 斷言）——先證兩側確實取自不同列位，下方正規化
    // 比對才有意義。
    const beforeSuffixes = beforeBlock.match(/(?:texts|fgs|bgs|segstart)_\d+/g) ?? []
    const afterSuffixes = afterBlock.match(/(?:texts|fgs|bgs|segstart)_\d+/g) ?? []
    if (beforeSuffixes.length === 0 || !beforeSuffixes.every((s) => s.endsWith('_0'))) {
      return { ok: false, symptom: `beforeBlock row-suffixes should all be _0 (cwd seeded at row0): ${JSON.stringify(beforeSuffixes)}` }
    }
    if (afterSuffixes.length === 0 || !afterSuffixes.every((s) => s.endsWith('_1'))) {
      return { ok: false, symptom: `afterBlock row-suffixes should all be _1 (cwd dragged to row1): ${JSON.stringify(afterSuffixes)}` }
    }

    // (b) 產出腳本含該覆寫＋拖前拖後僅列位差異：先證兩份區塊確實不同
    // （排除「腳本壓根沒變、比較恆真」的假陽性），再證去除列位尾碼
    // （texts_N/fgs_N/segstart_N）後逐字相同。
    if (beforeBlock === afterBlock) {
      return { ok: false, symptom: 'cwd block byte-identical before/after drag — expected row-suffix (texts_N/fgs_N/segstart_N) to differ since row grouping changed' }
    }
    const normalizedBefore = normalizeRowSuffix(beforeBlock)
    const normalizedAfter = normalizeRowSuffix(afterBlock)
    if (normalizedBefore !== normalizedAfter) {
      return {
        ok: false,
        symptom: `cwd block differs beyond row position after normalizing row suffix:\nbefore: ${normalizedBefore}\nafter: ${normalizedAfter}`,
      }
    }

    return { ok: true }
  },
}

// 9. T4.1（sprint 15，(internal design doc) MS4）
//    **改寫**自 sprint 14 的「教學帶不擋拖曳」案（原 id
//    `tutorial-band-does-not-block-drag`）。
//
//    ── 為何改寫而非退場（TASKS.md T4.1 明文二擇一，理由須留痕）──
//    原案驗的是「教學帶與段列同居右欄**同一捲動容器**時，帶的存在不擋
//    同容器內的 same-row-swap 拖曳」。MS2 把教學帶遷到**目錄欄頂**
//    （index.html `.builder-columns__catalog#catalog-section` 內）、段列
//    留在列區欄，兩者已非同一容器——原案的拖曳（列區內同列互換）與教學帶
//    之間再無任何幾何交集，`seedTutorial:false` 與否都必然通過，退化為
//    恆真。故本批把案的**語意**搬到帶真正還在場的那個容器：改測「教學帶
//    在場時，**目錄欄內起手**的跨欄拖曳（目錄項 → 列區目標列）不受阻」。
//
//    與 T4.2 新增之 G4 幾何案**不重疊**（此為選「改寫」而非「退場」的
//    判準）：G4 驗的是「拖曳全程三個捲動量不變」的**幾何**硬條件，且刻意
//    走預設前置態（教學帶已 dismiss）以排除干擾變因；本案驗的是「教學帶
//    **在場**（佔住目錄欄頂部空間、且自身是個帶按鈕的互動節點）時，
//    自目錄欄起手的拖曳仍能建立 drag session 並成功落地」，且拖曳手勢
//    本身不得誤觸 dismiss。兩者前置態相反、斷言標的相異。
//
//    斷言序：(a) 前提防呆——band 確實在場（`hidden === false`，證
//    `seedTutorial:false` 生效）**且**確實位於目錄欄內（`#catalog-section`
//    contains `#tutorial-band-slot`：本案的立論前提是「帶與拖曳來源同欄」，
//    若日後版面再搬動，本斷言會直接把案打紅而非讓它悄悄變恆真）；
//    (b) 目錄項真拖曳落入指定列（沿用案 6 catalog-drag 手法）；(c) 落列
//    結構與目錄項狀態正確；(d) 拖後 band 仍在場（dismiss 唯一入口是
//    `#tutorial-dismiss` 鈕點擊，見 tutorial-band.ts／main.ts
//    wireTutorialBand——拖曳握把／目錄項本身皆非該鈕）。
const caseTutorialBandDoesNotBlockCatalogDrag = {
  id: 'tutorial-band-does-not-block-catalog-drag',
  label: 'T4.1：教學帶在場時目錄欄拖曳不受阻（改寫自 sprint 14 同容器案）',
  seed: { model: 0, cost: 1 },
  seedTutorial: false,
  async run({ evaluate, dragBySelector }) {
    const bandBefore = await evaluate(`
      (() => {
        const band = document.getElementById('tutorial-band-slot');
        const catalog = document.getElementById('catalog-section');
        return { hidden: band.hidden, insideCatalogColumn: catalog.contains(band) };
      })()
    `)
    if (bandBefore.hidden !== false) {
      return { ok: false, symptom: `tutorial band unexpectedly hidden before drag (seedTutorial:false should keep it visible — dismiss precondition step must be skipped): ${JSON.stringify(bandBefore)}` }
    }
    if (bandBefore.insideCatalogColumn !== true) {
      return { ok: false, symptom: `tutorial band is not inside #catalog-section — this case's premise (band shares the catalog column with the drag source) no longer holds; re-derive the case instead of letting it pass vacuously: ${JSON.stringify(bandBefore)}` }
    }

    const dragResult = await dragBySelector(catalogPointExpr('duration'), liPointExpr('cost', 0.75))
    if (!dragResult.ok) return dragResult

    const snapshot = await evaluate(SNAPSHOT_EXPR)
    const expectedSnapshot = [
      { kind: 'real', rowIndex: 1, segs: ['model'], separatorOverride: 'inherit' },
      { kind: 'real', rowIndex: 2, segs: ['cost', 'duration'], separatorOverride: 'inherit' },
    ]
    if (JSON.stringify(snapshot) !== JSON.stringify(expectedSnapshot)) {
      return { ok: false, symptom: `snapshot after catalog drag-in with tutorial band present: ${JSON.stringify(snapshot)} (expected ${JSON.stringify(expectedSnapshot)})` }
    }
    const catalogState = await evaluate(`
      (() => {
        const li = document.querySelector('[data-testid="catalog-item"][data-segment-id="duration"]');
        const checkbox = li.querySelector('.catalog-item__checkbox');
        return { enabledClass: li.classList.contains('catalog-item--enabled'), checked: checkbox.checked };
      })()
    `)
    if (catalogState.enabledClass !== true || catalogState.checked !== true) {
      return { ok: false, symptom: `catalog item state after drag-in: ${JSON.stringify(catalogState)} (expected enabled+checked)` }
    }

    const bandHiddenAfter = await evaluate(`document.getElementById('tutorial-band-slot').hidden`)
    if (bandHiddenAfter !== false) {
      return { ok: false, symptom: `tutorial band became hidden after drag (a drag gesture must not mis-trigger dismiss — only #tutorial-dismiss click should): hidden=${bandHiddenAfter}` }
    }
    return { ok: true }
  },
}

// 10. T4.2（TASKS.md；14-PLAN §D5）：mode 切換（plain→powerline）前後
//     `window.scrollY` 不變——鎖 T3.1（09-PLAN §D4 回饋 #4）的焦點竊取
//     回歸：main.ts handleModeChange 已刪除 `segmentListsEl.focus()`
//     （見該函式文件），改由 radio 保持瀏覽器原生點擊焦點，不再有程式化
//     `.focus()` 呼叫把視窗捲動到目錄／清單所在區塊。
//
//     真實點擊實作（T4.1 校準發現）：改走真滑鼠事件序
//     `clickBySelector`（CDP `Input.dispatchMouseEvent`
//     mousePressed→mouseReleased）而非 JS `element.click()` 方法——實跑
//     證實 `.click()` 方法本身不觸發瀏覽器對表單控件的原生 focus 行為
//     （headless Chromium 下 `.click()` 後 `document.activeElement`
//     仍是 `<body>`），無法忠實重現舊 bug 觸發前提（見 clickBySelector
//     文件）。
//
//     ── T4.1（sprint 15 MS4）校準 ──
//     (1) **`#list-column` 的語意校準**：該 id 自 MS2 起掛在**列區欄**
//         （`.builder-columns__list`，index.html 只搬不刪紀律使 id 原地
//         保留），不再是 sprint 14 那個「教學帶／目錄／已選擇同居的唯一
//         捲動容器」——目錄已獨立為 `#catalog-section` 欄，本頁共有**兩個**
//         欄級捲動容器（≥1100px 各自 `overflow-y:auto`，見 style.css
//         「四區版面」節）。故 id 本身不需更換，需要更換的是敘述與斷言
//         組合（見下方 (2)(3)）。
//     (2) **主判準（`window.scrollY`）自 MS2 起是活路徑**：捲動模型
//         M1′-a（`<main>` 為一般 block、頂帶與兩欄 sticky，整頁本身仍可
//         捲）已由 T2.6 的 G2 案實測坐實（該案先斷言 `maxScroll > 0` 才
//         取樣），本批實跑亦確認本案種子下 `window.scrollTo(300)` 後
//         `scrollY > 0`。故 `usePageScroll` 恆真、`#list-column.scrollTop`
//         後備分支在**現行版面**下不會被走到——**保留但誠實標注**：它是
//         「整頁不可捲」這個版面前提一旦失守時的防呆逃生路徑（sprint 14
//         的單一捲動容器版面即屬此形），不是死碼式的裝飾；若哪天前提真的
//         變了，主分支的 `>0` 防呆會把案打紅而非讓「不變」斷言變恆真，
//         後備分支則接手提供有意義的斷言標的。
//     (3) **補充判準（本批新增，T4.1 授權之裁量）**：兩個欄級捲動容器
//         （`#catalog-section`／`#list-column`）各自的 `scrollTop` 亦一併
//         納入「切換前後不變」斷言。理由：舊 bug（`segmentListsEl.focus()`）
//         的傷害形態是「程式化搶焦點 → 瀏覽器把焦點元素捲進視野」，在
//         **兩欄各自為獨立捲動容器**的新版面下，這種捲動會落在**欄容器**
//         上而未必反映到 `window.scrollY`——只驗頁面捲距會漏掉半個版面。
//         兩欄先各自 `scrollTop = 200`（直接賦值），實得值若被夾為 0
//         （該欄在本案種子下不可捲）僅印警告不阻斷（該欄的「不變」斷言
//         退化為恆真，但主判準仍在把關）。
//
//     主/後備判準（brief 明文要求先證非空泛恆真）：先 `window.scrollTo`
//     再讀 `window.scrollY`；欄自身即為 `overflow-y:auto` 捲動容器
//     （style.css `max-height: calc(100dvh - var(--band-h))`），若整頁
//     本身因此被裁在 viewport 內而不可捲（`scrollY` 恆 0），改捲
//     `#list-column` 自身 `scrollTop`，並以其作為斷言標的——兩種判準皆先
//     斷言「捲動後位置 > 0」防呆，確保後續「不變」斷言非恆真空比對。
const caseModeSwitchScrollStable = {
  id: 'mode-switch-scroll-position-stable',
  label: 'T4.2：mode 切換前後捲動位置不變（回歸 T3.1 焦點竊取）',
  seed: { model: 0, cost: 1, duration: 1, 'context-size': 2, thinking: 2, 'agent-name': 3, 'git-branch': 3, clock: 4 },
  async run({ evaluate, delayFn, clickBySelector }) {
    await evaluate(`window.scrollTo({ top: 300, left: 0, behavior: 'instant' })`)
    await delayFn(100)
    const pageScrollY = await evaluate(`window.scrollY`)

    const usePageScroll = pageScrollY > 0
    let before
    let metricExpr
    if (usePageScroll) {
      before = pageScrollY
      metricExpr = `window.scrollY`
    } else {
      // 後備判準：整頁不可捲，改捲右欄清單容器本身（見上方案文件）。
      await evaluate(`document.getElementById('list-column').scrollTo({ top: 300, left: 0, behavior: 'instant' })`)
      await delayFn(100)
      before = await evaluate(`document.getElementById('list-column').scrollTop`)
      metricExpr = `document.getElementById('list-column').scrollTop`
      if (!(before > 0)) {
        return {
          ok: false,
          symptom: `neither window.scrollY nor #list-column.scrollTop became >0 after scrollTo(300) (page/container not scrollable at seeded content size — cannot construct a non-vacuous "unchanged" assertion): window.scrollY=${pageScrollY}, list-column.scrollTop=${before}`,
        }
      }
    }

    // T4.1 補充判準（見上方案文件 (3)）：兩欄各自的容器捲距亦納入
    // 「不變」斷言。此處對兩欄各賦一次 `scrollTop`（直接賦值，非
    // `scrollIntoView`——後者會連帶動到頁面捲距、汙染主判準）。
    await evaluate(`document.getElementById('catalog-section').scrollTop = 200`)
    await evaluate(`document.getElementById('list-column').scrollTop = 200`)
    await delayFn(120)
    const columnsBefore = await evaluate(COLUMN_SCROLL_EXPR)
    for (const [colId, value] of Object.entries(columnsBefore)) {
      if (!(value > 0)) {
        console.log(
          `[e2e] warn: #${colId}.scrollTop clamped to ${value} after assigning 200 (column not scrollable at this seed) — its "unchanged" assertion below degrades to vacuous; the window.scrollY primary criterion still guards this case.`,
        )
      }
    }

    // 真實滑鼠點擊（CDP Input.dispatchMouseEvent，非 JS `.click()` 方法——
    // 見 clickBySelector 文件：`.click()` 不觸發瀏覽器原生 focus 行為，
    // 無法忠實重現舊 bug 觸發前提）：原生 mousedown 會賦予 radio 焦點，
    // 正是舊 bug（`segmentListsEl.focus()`）的觸發形。
    await clickBySelector(modeRadioClickPointExpr('#mode-powerline'))
    await delayFn(300)

    const after = await evaluate(metricExpr)
    if (after !== before) {
      return {
        ok: false,
        symptom: `scroll position changed after mode switch click (${usePageScroll ? 'window.scrollY' : '#list-column.scrollTop'}): before=${before}, after=${after}`,
      }
    }

    const columnsAfter = await evaluate(COLUMN_SCROLL_EXPR)
    if (JSON.stringify(columnsAfter) !== JSON.stringify(columnsBefore)) {
      return {
        ok: false,
        symptom: `column scroll position(s) changed after mode switch click (two independent column scroll containers, see case doc (3)): before=${JSON.stringify(columnsBefore)}, after=${JSON.stringify(columnsAfter)}`,
      }
    }

    // 選配斷言（MAGI review 🟡-7：對齊 PLAN §D4「activeElement 同斷言
    // 選配」字面——選配＝記錄不阻斷，非阻斷式失敗；核心捲動位置斷言已在
    // 上方把關本案主判準）：mode radio 本身應保有焦點（T3.1 修復後的
    // 預期落點——不再被程式化奪走；真滑鼠點擊的 mousedown 原生行為賦予
    // 的焦點）。失敗僅印警告，不影響本案 ok 結果。
    const activeIsModeRadio = await evaluate(`document.activeElement === document.getElementById('mode-powerline')`)
    if (activeIsModeRadio !== true) {
      console.log(
        `[e2e] warn: document.activeElement is not #mode-powerline after real mouse click (optional assertion, not blocking): activeIsModeRadio=${activeIsModeRadio}`,
      )
    }

    return { ok: true }
  },
}

// 11. S-d（sprint 15 MS0 前置 spike，PLAN.md §S-d 空殼案）：1280×800
//     viewport 探針——常駐迴歸哨兵，驗證「逐案 viewport」機制本身正確
//     接上 CDP 座標系與 `elementFromPoint`（非拖曳邏輯案；為 MS2/MS4
//     後續需要 1280×800／390×844 等多種 viewport 的里程碑鋪路，見
//     spikes/S-d-RESULT.md）。**永久保留於 CASES**（S-d-RESULT.md 記錄此
//     決定），非一次性驗證後即刪。不做拖曳，只驗三件事：
//     (a) `window.innerWidth`/`innerHeight` 確實等於本案指定的
//         1280×800（證明 `testCase.viewport` 真的傳到 CDP metrics
//         override，不是默默落回 DEFAULT_VIEWPORT）；
//     (b) 已知元素（`#preview-section`——中欄 sticky 預覽框，內容有界，
//         不像 `.segment-lists` 目錄可能因段數多而遠高於任何固定
//         viewport，見檔頭「幾何輔助」段落文件）的 `getBoundingClientRect`
//         寬度 >0 且右緣落在 1280 viewport 內；
//     (c) 該 rect 中心點 `elementFromPoint` 命中目標本身或其後代——先
//         `scrollIntoView` 確保中心點落在可視範圍內（本案是 harness
//         座標系驗證，允許程式化捲動，非拖曳判準案，見 brief）。
const caseViewportProbe1280x800 = {
  id: 'viewport-probe-1280x800',
  label: 'S-d：1280×800 viewport 探針（座標系／elementFromPoint 常駐迴歸哨兵）',
  seed: { model: 0 },
  viewport: { width: 1280, height: 800 },
  async run({ evaluate }) {
    const size = await evaluate(`({ width: window.innerWidth, height: window.innerHeight })`)
    if (size.width !== 1280 || size.height !== 800) {
      return { ok: false, symptom: `window.innerWidth/innerHeight mismatch: ${JSON.stringify(size)} (expected 1280x800)` }
    }
    const probe = await evaluate(`
      (() => {
        const el = document.getElementById('preview-section');
        el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return {
          rectWidth: r.width,
          rectRight: r.right,
          cx,
          cy,
          hitIsTargetOrDescendant: hit !== null && (hit === el || el.contains(hit)),
        };
      })()
    `)
    if (!(probe.rectWidth > 0)) {
      return { ok: false, symptom: `#preview-section rect width not >0: ${JSON.stringify(probe)}` }
    }
    if (!(probe.rectRight <= 1280)) {
      return { ok: false, symptom: `#preview-section rect.right exceeds 1280 viewport width: ${JSON.stringify(probe)}` }
    }
    if (probe.hitIsTargetOrDescendant !== true) {
      return { ok: false, symptom: `elementFromPoint at rect center did not hit target or its descendant: ${JSON.stringify(probe)}` }
    }
    return { ok: true }
  },
}

// 12/13. T2.6：頂帶 sticky 黏著幾何＋兩欄遮蔽殘差斷言（1400×1000／
//     1280×800 各一案，共用同一 `run`）。判準與容許量重新校準說明詳見
//     檔頭「T2.6」節，此處不重複。

function bandRectExpr() {
  return `
    (() => {
      const el = document.getElementById('preview-section');
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    })()
  `
}

function colRectExpr(id) {
  return `
    (() => {
      const el = document.getElementById(${JSON.stringify(id)});
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    })()
  `
}

// 捲動後等版面穩定再讀 rect（比照 spikes/proto/measure.mjs 雙 rAF 慣例：
// sticky/overflow 重排可能跨一兩幀，單一 rAF 不保證足夠）。
const SETTLE_AFTER_SCROLL_EXPR = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`

// G2 三個容許量常數（sprint 15 MAGI code review 🟡-5 加固批；逐條幾何
// 論證見 `runG2PreviewBandSticky` 內對應註解）。
//
// ・`G2_POST_STEADY_OCCLUSION_LIMIT`＝穩態後 N4 遮蔽殘差上界（原地字面
//   140 提為具名常數，數值與適用範圍未變，見檔頭「T2.6」節）。
// ・`G2_STEADY_POINT_TOLERANCE`＝「頂帶剛黏住那一刻」取樣點的遮蔽殘差
//   容許量，以幾何論證定值：該點的要求捲距為 `Math.ceil(steadyThreshold)`，
//   相對真正的穩態捲距最多過衝 1px（ceil），而穩態後的遮蔽退化對捲距的
//   斜率上界為 1（欄頂最多跟著捲距等量後退），故「過衝造成的殘差」≤1px；
//   再加本檔對 rect 次像素一貫採用的 ±2px 餘裕，取 4px 為上界（多留 1px
//   給 `scrollTo` 實得值與要求值之間的取整差）。
//   實測佐證（1400×1000）：steadyThreshold=268.375、取樣點 269，該點兩欄
//   遮蔽量為 **−31.375**（＝仍保有設計上 32px 正值安全帶的絕大部分，過衝
//   0.625px 恰等量吃掉 0.625px），且 269→400 之間遮蔽量自 −31.375 增至
//   99.625（斜率恰為 1，與上述論證一致）——本容許量餘裕逾 35px，卻擋得住
//   任何「交界處就已經開始遮蔽」的回歸。
// ・`G2_MONOTONIC_TOLERANCE`＝穩態後遮蔽單調性斷言的浮點/次像素容許量
//   （同 ±2px 慣例）。
const G2_POST_STEADY_OCCLUSION_LIMIT = 140
const G2_STEADY_POINT_TOLERANCE = 4
const G2_MONOTONIC_TOLERANCE = 2

async function runG2PreviewBandSticky({ evaluate, delayFn }) {
  const maxScroll = await evaluate(`Math.max(0, document.documentElement.scrollHeight - window.innerHeight)`)
  if (!(maxScroll > 0)) {
    return {
      ok: false,
      symptom: `page not scrollable at seeded content size (maxScroll=${maxScroll}) — cannot exercise G2 scroll/sticky assertions; seed needs more content`,
    }
  }

  // 穩態捲距＝頂帶尚未黏著前的自然文件流位置（scrollY=0 時量得的
  // band.top）；執行期量測，見檔頭「T2.6」節 T2 小節文件。同一數值也是
  // T3 容許量重新校準的分界點（見下方迴圈內註解）。
  await evaluate(`window.scrollTo(0, 0)`)
  await evaluate(SETTLE_AFTER_SCROLL_EXPR)
  await delayFn(120)
  const steadyThreshold = (await evaluate(bandRectExpr())).top

  // 前提防呆（MAGI code review 🟡-8；比照 G4 `runG4DragGeometry`／G8
  // `runG8CatalogCollapsedListStart` 同款三行）：內容一旦縮水到「整頁最大
  // 捲距 < 穩態捲距」，全部取樣點都落在 pre-steady 段，本案最承重的 T2
  // （穩態下頂帶 rect.top===0）與 T3 穩態分支就會靜默從未執行、整案空轉
  // 全綠。量測 `steadyThreshold` 之後才檢查得了，故置於此處而非案首。
  if (!(maxScroll >= steadyThreshold)) {
    return {
      ok: false,
      symptom: `page cannot reach preview-band steady state (maxScroll=${maxScroll} < steadyThreshold=${steadyThreshold}) — T2/T3 steady-state assertions would never execute; seed needs more content`,
    }
  }

  // 取樣點（MAGI code review 🟡-5(b)）：除既有 {0,200,400,max} 外插入
  // **穩態捲距本身**（`Math.ceil`，取樣點須為整數捲距）——「頂帶剛黏住
  // 那一刻」的幾何在改版前無任何取樣點把關（該點之前是 32px 正值安全帶、
  // 之後一律吃 140px 平頂，唯獨交界本身沒人驗）。升冪排序＋去重：下方
  // 「遮蔽劣化單調性」斷言以取樣順序即 scrollY 遞增為前提。
  const steadyPoint = Math.ceil(steadyThreshold)
  const scrollPoints = [...new Set([0, 200, 400, steadyPoint, maxScroll])].sort((a, b) => a - b)

  // 穩態後逐取樣點的遮蔽量（`-gap`），逐欄各記一份，供單調性斷言比對
  // （MAGI code review 🟡-5(c)）。
  const lastOcclusion = new Map()

  for (const y of scrollPoints) {
    await evaluate(`window.scrollTo(0, ${y})`)
    await evaluate(SETTLE_AFTER_SCROLL_EXPR)
    await delayFn(120)
    const innerHeight = await evaluate(`window.innerHeight`)
    // 🟢（角度 1「isSteady 用要求值」）：穩態判定改讀**實際**捲距而非
    // 要求值 `y`——`maxScroll < y` 時 `scrollTo` 會把捲距夾住（例如要求
    // 400、實得 350，而穩態捲距為 360），用要求值判定會把一個實際上仍在
    // pre-steady 的取樣點當成穩態，於是 T2 拿「頂帶尚未黏住」的 rect 去
    // 要求 `top===0` 而誤紅。屬防禦性緊固（現行 seed 下 maxScroll 遠大於
    // 400，此路徑不可達）。
    const actualY = await evaluate(`window.scrollY`)
    const band = await evaluate(bandRectExpr())
    const at = `scrollY=${actualY} (requested ${y})`

    // T1：頂帶完整在視窗內（±0.5px 次像素容許）。
    if (!(band.top >= -0.5 && band.bottom <= innerHeight + 0.5 && band.height > 0)) {
      return { ok: false, symptom: `T1 failed at ${at}: band=${JSON.stringify(band)}, innerHeight=${innerHeight}` }
    }

    // T2：穩態（實得捲距已達穩態捲距）時頂帶 rect.top===0（±2px 次像素容許）。
    const isSteady = actualY >= steadyThreshold
    if (isSteady && Math.abs(band.top) > 2) {
      return {
        ok: false,
        symptom: `T2 failed at ${at} (steady state, expected rect.top===0 ±2px): band.top=${band.top}, steadyThreshold=${steadyThreshold}`,
      }
    }

    // T3：兩欄 rect.top >= 頂帶 rect.bottom。穩態捲距之前一律零容許
    // （實測恆為 32px 正值安全帶，見檔頭文件）；穩態捲距之後（含
    // max-scroll）容許 ≤140px 候選 2 N4 遮蔽殘差——此為本批對 brief
    // 原始「僅 literal max 取樣點」容許範圍的重新校準，理由見檔頭
    // 「T2.6」節。**本批另加兩道輔助斷言**（🟡-5：140px 平頂會把「只在
    // 中段出現、與 N4 無關的獨立遮蔽 bug」整個吸收掉）：
    //   (b) 交界點（`steadyPoint`）遮蔽殘差須近 0；
    //   (c) 穩態後遮蔽量須隨 scrollY 非遞減（N4 是「隨捲動連續線性退化」
    //       的單一現象，其曲線單調；任何「中段冒出、之後又縮回」的遮蔽
    //       都不是 N4，必須發紅）。
    for (const colId of ['catalog-section', 'list-column']) {
      const col = await evaluate(colRectExpr(colId))
      const gap = col.top - band.bottom
      const occlusion = -gap
      const geom = `col.top=${col.top}, band.bottom=${band.bottom}, gap=${gap}`

      // (b) 交界點（頂帶剛黏住那一刻）：兩欄須仍完整落在頂帶下緣之下，
      //     遮蔽殘差 ≈0（上界＝G2_STEADY_POINT_TOLERANCE，幾何論證與實測
      //     佐證見該常數文件）。改版前這一點落在「穩態」側、吃 140px 平頂
      //     ——交界處若一開始就遮掉幾十 px 也不會發紅。
      if (y === steadyPoint && occlusion > G2_STEADY_POINT_TOLERANCE) {
        return {
          ok: false,
          symptom: `T3 failed for #${colId} at ${at} (the moment the band sticks: the columns must still sit below the band edge, occlusion ≈0 ±${G2_STEADY_POINT_TOLERANCE}px): occlusion=${occlusion}, steadyThreshold=${steadyThreshold}, ${geom}`,
        }
      }

      // (c) 穩態後單調性：遮蔽量不得隨捲動變小（超過浮點容許量）。
      if (isSteady) {
        const previous = lastOcclusion.get(colId)
        if (previous !== undefined && occlusion < previous - G2_MONOTONIC_TOLERANCE) {
          return {
            ok: false,
            symptom: `T3 failed for #${colId} at ${at} (post-steady occlusion is not monotonically non-decreasing: ${previous} → ${occlusion}, tolerance ${G2_MONOTONIC_TOLERANCE}px) — the accepted N4 residual degrades continuously with scroll; an occlusion that shrinks again indicates a different, independent bug that the 140px plateau would otherwise absorb: ${geom}`,
          }
        }
        lastOcclusion.set(colId, occlusion)
      }

      if (gap >= -0.5) continue
      if (!isSteady) {
        return {
          ok: false,
          symptom: `T3 failed for #${colId} at ${at} (pre-steady, zero tolerance expected): ${geom}`,
        }
      }
      if (occlusion > G2_POST_STEADY_OCCLUSION_LIMIT) {
        return {
          ok: false,
          symptom: `T3 failed for #${colId} at ${at} (post-steady, ≤${G2_POST_STEADY_OCCLUSION_LIMIT}px N4 tolerance exceeded): ${geom}`,
        }
      }
    }
  }

  return { ok: true }
}

const G2_SEED = { model: 0, cost: 1, duration: 1, 'context-size': 2, thinking: 2, 'agent-name': 3, 'git-branch': 3, clock: 4 }

const caseG2PreviewBandSticky1400x1000 = {
  id: 'g2-preview-band-sticky-1400x1000',
  label: 'T2.6：G2 桌面硬驗收（頂帶 sticky＋兩欄遮蔽殘差，1400×1000）',
  seed: G2_SEED,
  viewport: { width: 1400, height: 1000 },
  run: runG2PreviewBandSticky,
}

const caseG2PreviewBandSticky1280x800 = {
  id: 'g2-preview-band-sticky-1280x800',
  label: 'T2.6：G2 桌面硬驗收（頂帶 sticky＋兩欄遮蔽殘差，1280×800）',
  seed: G2_SEED,
  viewport: { width: 1280, height: 800 },
  run: runG2PreviewBandSticky,
}

// 14/15. T4.2（TASKS.md MS4；PLAN §Verification G4；判準出處＝
//     `spikes/S-i-RESULT.md`「G4 定案」節）：跨欄拖曳幾何硬驗收——
//     1400×1000／1280×800 各一案，共用同一 `runG4DragGeometry`（比照 G2
//     先例）。
//
//     ── 判準（S-i 定案，本批只落地、未新增判準）──
//     ・容許量 **±2px**（S-i：安全帶內三輪實測恆為 0，±2px 純為次像素
//       餘裕，實質等同嚴格 0；**不採用「放寬為大容許量」路線**——一旦真
//       觸發原生邊緣自動捲動，位移量級是數百 px／~700px/s，任何合理容許
//       量都吸收不了）。
//     ・**前提紀律（缺一則容許量無效）**：拖曳全程每一個指標座標的 y，
//       與**兩欄容器各自**的 `rect.top`／`rect.bottom` 皆須保持 ≥40px
//       安全帶（S-i：24px 為實測「零例外」下界，40px 為交界精度未知＋
//       run5 環境敏感異常的雙重保守緩衝）。本案把這條紀律實作為
//       `assertAwayFromScrollEdge`（S-i「對 MS2／MS4 施工的具體建議」第 1
//       點明文建議的共用 helper），對 from／十個建立位移中繼點／to 全部
//       逐點檢查後才開始拖曳。
//     ・S-i 只實測垂直方向（兩欄皆僅 `overflow-y`，無水平溢出），故安全
//       帶只對 y 設限；x 僅檢查落在 viewport 內。
//
//     ── 與既有 `dragBySelector` 的差異（TASKS.md T4.2 明文要求）──
//     既有 helper 會 (a) 於座標函式內 `scrollIntoView`、(b) drop 前重新
//     求值目標座標並補一次 dragOver。兩者在本案皆**不可用**：(a) 會在
//     測「捲動位置不變」之前先動捲動位置；(b) 重求值等於默許拖曳過程中
//     版面有位移。故本案改走 harness 新增的 `dragFixedPoints`（見 runCase
//     內該函式文件）：座標為**呼叫端算好的固定數字**，drag 序列全程不再
//     求值任何座標，並於 dragStart／dragEnter／dragOver／drop 前／drop 後
//     五個階段各取樣一次三個捲動量。
//
//     ── 前置設定（允許，且為必要）──
//     1. **先把頁面捲到「頂帶 sticky 穩態」**（scrollY = 頂帶自然文件流
//        位置，執行期量得，同 G2 案手法）。這一步不是可有可無的方便措施：
//        T4.2 硬性要求來源段取自**目錄捲動序最尾**的 shell-out 分區，而
//        捲動模型 M1′-a 下，scrollY=0 時兩欄的容器下緣落在 viewport 之外
//        （欄 `max-height` 起算點在頁首之下），欄內容的最後一段**在任何
//        `scrollTop` 值下都無法進入視窗**——不先進穩態就取不到合法座標。
//        穩態下欄的 rect 恰為〔頂帶下緣, 視窗下緣〕，安全帶也最寬。
//        基線（三個捲動量）於此步驟**之後**才記錄，故「起手至 drop 全程
//        不變」的語意完整保留。
//     2. 對兩欄各**設一次** `scrollTop`（直接賦值，非 `scrollIntoView`）
//        把來源目錄項與目標列帶到安全帶正中；賦值後重新量一次座標，此為
//        兩個座標表達式的**最後一次求值**（拖曳開始後不再求值）。
//     3. 以 `document.elementFromPoint` 驗證兩點確實命中預期元素（T4.2
//        明文：取代 rect 落界斷言）。
//
//     ── 種子（T4.2 明文）──
//     8 段啟用／5 列（≥3 列 ✅）；三個 shell-out 段（`git-branch`／
//     `git-dirty`／`clock`，segments.ts 目錄序最後一個分區，見該檔
//     「shell-out（3）」節與 `SEGMENT_DESCRIPTORS` 檔頭「順序＝永在 12→
//     百分比 5→條件 10→shell-out 3」）**全部不啟用**，來源取該分區首項
//     `git-branch`（刻意不取整份目錄最後一項 `clock`：目錄捲到底時最後一
//     項的中心必然貼近容器下緣、與 ≥40px 安全帶直接衝突）。目標列＝
//     `cost` 所在列（列序 1，**非首列** ✅）。

const G4_EDGE_MARGIN = 40
const G4_SCROLL_TOLERANCE = 2
// 拖曳期「單一列群組長高量」的量級天花板（MAGI code review 🟢 節角度 5：
// 動態上界若無天花板，CSS 回歸把命中區擴張放大時上界會連動放大、判準退化
// 為橡皮圖章）。**非 CSS 字面複製**：本值不等於任何一條規則的值，只界定
// 「一個列群組於拖曳期長高多少仍屬可解釋」的量級——現行設計的兩條通道
// （列清單 padding-bottom／pending 列 min-height）皆為個位數 rem，64px
// （＝預設根字級 4rem）留有充裕餘裕，卻擋得住任何量級級別的放大。
const G4_GROUP_GROWTH_CEILING = 64
const G4_SEED = { model: 0, cost: 1, duration: 1, 'context-size': 2, thinking: 2, 'agent-name': 3, pr: 3, 'session-name': 4 }
const G4_SOURCE_SEGMENT = 'git-branch'
const G4_TARGET_SEGMENT = 'cost'
const G4_TARGET_ROW_FRAC = 0.75

/**
 * 單次取樣：三個捲動量（T4.2 指名的判準標的）＋兩個佐證量：
 * ・`targetTop`＝目標列 `<li>` 的**視窗座標**——G4 真正要保護的使用者
 *   可感知不變量（「拖曳過程中畫面不會自己跑掉」）。原生邊緣自動捲動
 *   （S-i (c) 量到的 ~700px/s 失效模式）必然同時改變 `scrollTop` **與**
 *   本值；下方命中區擴張那種「捲距補償」則只動前者。
 * ・`groupHeightsAboveTarget`＝**目標列所屬列群組之上**（DOM 序）每一個
 *   列群組（真實列＋pending 占位列）的實際渲染高度（執行期
 *   `getBoundingClientRect` 實測，**不在本腳本複製任何 CSS 字面值**）。
 *   style.css `body.is-segment-dragging …` 於 dragstart 後一幀把每個列
 *   群組的 `.segment-list` 撐出 `padding-bottom`／`min-height`（且對
 *   `.segment-pending-row` 另有一條 `min-height` 通道），使列區內容長高
 *   ——量「群組實際高度」而非只加總 `padding-bottom`，可**同時**涵蓋這
 *   兩條通道（🟡-3 指出的漏算），且天然只計入「真的會推動目標列／被
 *   scroll anchoring 補償」的那一段內容。
 *
 * ── 為何上界是「目標列之上」而非「全部列群組」（MAGI code review
 *    🟡-3，4 票）──
 * 改版前的上界是**全部**列群組的 padding 增量加總（本案 5 群組 ≈200px），
 * 為物理可解釋量（實測跳動 40px）的約 5 倍，最該把關的 dragstart 起手
 * 瞬間近乎不設防（`after-dragstart` 取樣前有 300ms delay，S-i 的邊緣自動
 * 捲動 ~700px/s × 300ms ≈ 210px 與舊上界同量級）。物理論證：
 *   1. 目標列**之下**的內容長高不會推動目標列，也不在 scroll anchoring
 *      的補償範圍（anchoring 只補償錨點**之上**的版面變化）。
 *   2. 前置步驟已把目標列擺在欄可視區正中，故列區欄 scrollport 頂端必然
 *      落在目標列**之上** ⇒ Chromium 選出的錨點亦在目標列之上 ⇒ 補償量
 *      ≤「目標列之上的長高量」`aboveGrowth`。
 *   3. 兩條通道是同一份長高量的分配：`scrollTop` 補償 c ∈ [0, aboveGrowth]、
 *      畫面位移 = aboveGrowth − c，故兩者絕對值之和恰 ≤ aboveGrowth。
 * 上界因此收緊為 `aboveGrowth ＋ ±2px 容許量`（本案 = 單一群組增量 40px
 * ＋2px），與實測跳動 40px 僅餘 2px 餘裕。
 *
 * 實測佐證（本批改後兩 viewport 各實跑）：目標列（`cost`）落在群組 index
 * 1，其上恰一個列群組，該群組高度 510→550（`aboveGrowth`＝40）；
 * 1400×1000 為 `scrollTop` 765→805、`targetTop` 不動，1280×800 為
 * `scrollTop` 不動、`targetTop` 256→296——兩條通道各自呈現，`startJump`
 * 皆恰為 40，落在新上界 42 之內。（本案 seed 無 pending 列，故
 * `.segment-pending-row` 的 `min-height` 通道現值為 0；量群組實際高度
 * 使該通道**若日後出現**亦自動計入，不需改判準。）
 */
const G4_SCROLL_SAMPLE_EXPR = `
  (() => {
    const target = document.querySelector('[data-testid="segment-row"][data-segment-id=${JSON.stringify(G4_TARGET_SEGMENT)}]');
    const groups = [...document.querySelectorAll('#segment-row-groups [data-testid="row-group"], #segment-row-groups [data-testid="pending-row-group"]')];
    const targetGroupIndex = groups.findIndex((el) => el.contains(target));
    const above = targetGroupIndex < 0 ? [] : groups.slice(0, targetGroupIndex);
    return {
      scrollY: window.scrollY,
      'catalog-section': document.getElementById('catalog-section').scrollTop,
      'list-column': document.getElementById('list-column').scrollTop,
      targetTop: Math.round(target.getBoundingClientRect().top),
      targetGroupIndex,
      groupHeightsAboveTarget: above.map((el) => Math.round(el.getBoundingClientRect().height)),
    };
  })()
`

// 目錄項／段列座標——**無 scrollIntoView 版**（既有 catalogPointExpr／
// liPointExpr 的活座標紀律在 G4 案是禁忌，見上方案文件）。
function catalogPointExprNoScroll(segmentId) {
  return `(() => { const li = document.querySelector('[data-testid="catalog-item"][data-segment-id=${JSON.stringify(segmentId)}]'); const name = li.querySelector('.catalog-item__name'); const r = name.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
}

function liPointExprNoScroll(segmentId, verticalFrac) {
  return `(() => { const li = document.querySelector('[data-testid="segment-row"][data-segment-id=${JSON.stringify(segmentId)}]'); const r = li.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * ${verticalFrac}) }; })()`
}

/**
 * 欄捲動設定（前置步驟 2）：於**單一** `Runtime.evaluate` 內量得目標點
 * 現座標、換算所需 `scrollTop` 並**賦值一次**（夾在 [0, maxScrollTop]），
 * 回傳前後量測值供診斷。刻意不用 `scrollIntoView`（T4.2 明文禁止：它對
 * `block:'center'` 為無條件捲動且會連帶捲動祖先，包含整頁）。
 */
function columnScrollSetupExpr(containerId, pointExpr, desiredY) {
  return `
    (() => {
      const el = document.getElementById(${JSON.stringify(containerId)});
      const before = ${pointExpr};
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const wanted = Math.round(Math.min(maxTop, Math.max(0, el.scrollTop + (before.y - ${desiredY}))));
      el.scrollTop = wanted;
      return { beforeY: before.y, wanted, maxTop, scrollTopAfter: el.scrollTop };
    })()
  `
}

/** 指定座標的命中驗證（取代 rect 落界斷言，T4.2 明文）。 */
function hitTestExpr(x, y, selector) {
  return `
    (() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      const hit = document.elementFromPoint(${x}, ${y});
      return {
        hitsTargetOrDescendant: hit !== null && (hit === target || target.contains(hit)),
        hitTag: hit === null ? null : hit.tagName,
        hitTestid: hit === null ? null : (hit.closest('[data-testid]')?.dataset.testid ?? null),
        hitSegmentId: hit === null ? null : (hit.closest('[data-segment-id]')?.dataset.segmentId ?? null),
      };
    })()
  `
}

/** 版面幾何快照（頂帶＋兩欄 rect＋viewport）。 */
const G4_GEOMETRY_EXPR = `
  (() => {
    const rect = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    return { innerWidth: window.innerWidth, innerHeight: window.innerHeight, band: rect('preview-section'), 'catalog-section': rect('catalog-section'), 'list-column': rect('list-column') };
  })()
`

/**
 * S-i「對 MS2／MS4 施工的具體建議」第 1 點：逐點檢查拖曳座標與兩欄容器
 * 邊緣的安全帶。回傳違規清單（空陣列＝全部合格）。
 */
function assertAwayFromScrollEdge(points, geo, margin) {
  const violations = []
  for (const point of points) {
    if (point.x < 0 || point.x > geo.innerWidth || point.y < 0 || point.y > geo.innerHeight) {
      violations.push(`${point.label} ${JSON.stringify({ x: point.x, y: point.y })} outside viewport ${geo.innerWidth}x${geo.innerHeight}`)
      continue
    }
    for (const colId of COLUMN_IDS) {
      const rect = geo[colId]
      const fromTop = point.y - rect.top
      const fromBottom = rect.bottom - point.y
      if (fromTop < margin || fromBottom < margin) {
        violations.push(
          `${point.label} y=${point.y} too close to #${colId} edges (top=${rect.top}, bottom=${rect.bottom}, fromTop=${fromTop}, fromBottom=${fromBottom}, required ≥${margin})`,
        )
      }
    }
  }
  return violations
}

async function runG4DragGeometry({ evaluate, delayFn, dragFixedPoints }) {
  // ── 前置 1：進「頂帶 sticky 穩態」（見案文件『前置設定』1）──
  const maxScroll = await evaluate(`Math.max(0, document.documentElement.scrollHeight - window.innerHeight)`)
  await evaluate(`window.scrollTo(0, 0)`)
  await evaluate(SETTLE_AFTER_SCROLL_EXPR)
  await delayFn(120)
  const steadyThreshold = (await evaluate(bandRectExpr())).top
  if (!(maxScroll >= steadyThreshold)) {
    return {
      ok: false,
      symptom: `page cannot reach preview-band steady state (maxScroll=${maxScroll} < steadyThreshold=${steadyThreshold}) — seed needs more content for G4 geometry`,
    }
  }
  await evaluate(`window.scrollTo(0, ${Math.ceil(steadyThreshold)})`)
  await evaluate(SETTLE_AFTER_SCROLL_EXPR)
  await delayFn(150)

  const geo = await evaluate(G4_GEOMETRY_EXPR)
  if (Math.abs(geo.band.top) > 2) {
    return { ok: false, symptom: `preview band not stuck at viewport top after scrolling to steady state (expected rect.top≈0 ±2px): ${JSON.stringify(geo)}` }
  }

  // 安全帶＝兩欄可視區的交集，再各縮 40px（S-i 前提紀律）。
  const safeTop = Math.max(geo['catalog-section'].top, geo['list-column'].top, geo.band.bottom, 0) + G4_EDGE_MARGIN
  const safeBottom = Math.min(geo['catalog-section'].bottom, geo['list-column'].bottom, geo.innerHeight) - G4_EDGE_MARGIN
  if (!(safeBottom - safeTop >= 80)) {
    return { ok: false, symptom: `safe drag band too narrow (safeTop=${safeTop}, safeBottom=${safeBottom}) at this viewport/band height: ${JSON.stringify(geo)}` }
  }
  const desiredY = Math.round((safeTop + safeBottom) / 2)

  // ── 前置 2：兩欄各設一次 scrollTop（非 scrollIntoView）──
  const catalogSetup = await evaluate(columnScrollSetupExpr('catalog-section', catalogPointExprNoScroll(G4_SOURCE_SEGMENT), desiredY))
  const listSetup = await evaluate(columnScrollSetupExpr('list-column', liPointExprNoScroll(G4_TARGET_SEGMENT, G4_TARGET_ROW_FRAC), desiredY))
  await evaluate(SETTLE_AFTER_SCROLL_EXPR)
  await delayFn(150)

  // 座標定案：兩個座標表達式在此**各求值一次**，之後拖曳全程只用這組
  // 固定數字（T4.2「`toPointExpr` 只求值一次」的落地形）。
  const from = await evaluate(catalogPointExprNoScroll(G4_SOURCE_SEGMENT))
  const to = await evaluate(liPointExprNoScroll(G4_TARGET_SEGMENT, G4_TARGET_ROW_FRAC))
  const setupDiag = `desiredY=${desiredY}, safe=[${safeTop},${safeBottom}], from=${JSON.stringify(from)}, to=${JSON.stringify(to)}, catalogSetup=${JSON.stringify(catalogSetup)}, listSetup=${JSON.stringify(listSetup)}, geo=${JSON.stringify(geo)}`

  // ── 前置 3：命中驗證（取代 rect 落界斷言）──
  const fromHit = await evaluate(hitTestExpr(from.x, from.y, `[data-testid="catalog-item"][data-segment-id="${G4_SOURCE_SEGMENT}"]`))
  if (fromHit.hitsTargetOrDescendant !== true) {
    return { ok: false, symptom: `source point does not hit catalog item "${G4_SOURCE_SEGMENT}": ${JSON.stringify(fromHit)}; ${setupDiag}` }
  }
  const toHit = await evaluate(hitTestExpr(to.x, to.y, `[data-testid="segment-row"][data-segment-id="${G4_TARGET_SEGMENT}"]`))
  if (toHit.hitsTargetOrDescendant !== true) {
    return { ok: false, symptom: `target point does not hit segment row "${G4_TARGET_SEGMENT}": ${JSON.stringify(toHit)}; ${setupDiag}` }
  }

  // ── 座標紀律：from／建立位移中繼點／to 全部逐點檢查安全帶 ──
  const dragPoints = [{ label: 'from', x: from.x, y: from.y }]
  for (let i = 1; i <= DRAG_ESTABLISH_STEPS; i++) {
    dragPoints.push({ label: `establish#${i}`, x: from.x + i * DRAG_ESTABLISH_DX, y: from.y + i * DRAG_ESTABLISH_DY })
  }
  dragPoints.push({ label: 'to', x: to.x, y: to.y })
  const violations = assertAwayFromScrollEdge(dragPoints, geo, G4_EDGE_MARGIN)
  if (violations.length > 0) {
    return { ok: false, symptom: `drag coordinates violate the ≥${G4_EDGE_MARGIN}px scroll-edge safety margin (S-i precondition):\n  - ${violations.join('\n  - ')}\n  ${setupDiag}` }
  }

  // ── 基線＋拖曳（全程取樣）──
  const baseline = await evaluate(G4_SCROLL_SAMPLE_EXPR)
  const dragResult = await dragFixedPoints(from, to, { sampleExpr: G4_SCROLL_SAMPLE_EXPR })
  const samplesDiag = `baseline=${JSON.stringify(baseline)}, samples=${JSON.stringify(dragResult.samples)}`
  if (!dragResult.ok) {
    return { ok: false, symptom: `${dragResult.symptom}; ${samplesDiag}; ${setupDiag}` }
  }
  const fail = (text) => ({ ok: false, symptom: `G4 failed: ${text}; ${samplesDiag}; ${setupDiag}` })
  const drift = (a, b, key) => Math.abs(a[key] - b[key])

  // (i) `window.scrollY` 與目錄欄 `scrollTop`：自拖曳前基線起、經全部拖曳
  //     階段、到 drop 後，一律 ±2px 不動（**零例外**——兩者沒有任何合法的
  //     位移來源：頁面在穩態、目錄欄內容於拖曳期間完全不變）。
  for (const { stage, value } of dragResult.samples) {
    for (const key of ['scrollY', 'catalog-section']) {
      const d = drift(value, baseline, key)
      if (d > G4_SCROLL_TOLERANCE) {
        return fail(`${key} drifted ${d}px at stage "${stage}" (tolerance ±${G4_SCROLL_TOLERANCE}px, S-i 定案)`)
      }
    }
  }

  // (ii)(iii) 列區欄的兩個量（`scrollTop` 與目標列的視窗座標 `targetTop`）
  //     ——本批實測發現，這兩個量在 dragstart 那一刻會發生**一次**有界的
  //     位移，成因與 S-i 要防的失效模式無關，必須分開處理（S-i 的獨立原型
  //     沒有這條 CSS，故該 spike 量不到本現象）：
  //
  //     成因：dragstart 後一幀 main.ts 加上 `body.is-segment-dragging`，
  //     style.css 隨即撐開**每個**列群組 `.segment-list` 的
  //     `padding-bottom`／`min-height`（以及 pending 列的 `min-height`）
  //     ——拖曳期間放寬列尾命中區，T5.11 刻意的互動設計；延後一幀本身是
  //     T5.6 驗收修復。位於捲動位置之上／之內的列群組因此長高，這個
  //     「一次性、可逆、量體＝目標列之上的長高總量」的版面變化會由
  //     Chromium 在兩條通道間分配：
  //       ・1400×1000 實測：scroll anchoring 補償 → `scrollTop` +40px、
  //         `targetTop` **逐位元不動**（畫面完全沒動）；
  //       ・1280×800 實測：不補償 → `scrollTop` **不動**、`targetTop`
  //         +40px（畫面內容下移一個擴張量）。
  //     兩者是同一件事的兩種呈現，drop 後 class 移除、兩個量皆精準回到
  //     拖曳前的值。與 S-i 的失效模式（原生邊緣自動捲動：數百 px、
  //     ~700px/s、且會持續累積直到衝頂）性質完全不同。
  //
  //     故判準這樣切（既守 T4.2「起手至 drop 全程不變」的字面，又不把
  //     刻意的命中區設計誤判為捲動）：
  //     ・**拖曳期間**（dragstart→drop 前）兩個量各自相對 `after-dragstart`
  //       ±2px——「起手至 drop 全程不變」的落地形，也正是「`toPointExpr`
  //       只求值一次仍然有效」的前提（目標在拖曳期間不會跑掉）。
  //     ・**drop 後**兩個量各自回到拖曳前基線 ±2px（一次性位移可逆的機械
  //       證據）。
  //     ・**基線→dragstart** 的那一次跳動：兩條通道的位移量**加總**不得
  //       超過執行期實測的「**目標列之上**列群組長高總量」
  //       （`groupHeightsAboveTarget` 差值加總）＋容許量。上界為何只算
  //       目標列之上（而非全部列群組）的完整物理論證見
  //       `G4_SCROLL_SAMPLE_EXPR` 文件（MAGI code review 🟡-3）。擴張量
  //       以外的任何位移（例如真被邊緣自動捲動帶走幾百 px）仍會把案打紅
  //       ——本案列區欄 maxScrollTop 逾 3000px，真觸發時的量級遠超此上界。
  //     ・上界所依據的實測量本身另受一道**量級天花板**把關
  //       （`G4_GROUP_GROWTH_CEILING`，🟢 節角度 5 建議）：CSS 回歸若把
  //       命中區擴張放大一個量級，上界會跟著放大、把案變成橡皮圖章；故
  //       單一列群組的拖曳期長高量超過天花板即直接判紅。
  const dragStart = dragResult.samples.find((s) => s.stage === 'after-dragstart')
  const postDrop = dragResult.samples.find((s) => s.stage === 'post-drop')
  if (dragStart === undefined || postDrop === undefined) {
    return fail('missing after-dragstart / post-drop sample (harness bug)')
  }
  const heightsBefore = baseline.groupHeightsAboveTarget
  const heightsAfter = dragStart.value.groupHeightsAboveTarget
  if (baseline.targetGroupIndex < 0 || dragStart.value.targetGroupIndex !== baseline.targetGroupIndex || heightsAfter.length !== heightsBefore.length) {
    return fail(
      `target row group index/count changed between baseline and dragstart (baseline=${baseline.targetGroupIndex}/${heightsBefore.length}, dragstart=${dragStart.value.targetGroupIndex}/${heightsAfter.length}) — the "content above the target row" upper bound cannot be derived`,
    )
  }
  const growthPerGroup = heightsAfter.map((h, i) => Math.max(0, h - heightsBefore[i]))
  const worstGroupGrowth = growthPerGroup.length === 0 ? 0 : Math.max(...growthPerGroup)
  if (worstGroupGrowth > G4_GROUP_GROWTH_CEILING) {
    return fail(
      `單一列群組於拖曳期長高 ${worstGroupGrowth}px，超出量級天花板 ${G4_GROUP_GROWTH_CEILING}px（per-group growth=${JSON.stringify(growthPerGroup)}）— 命中區擴張的量級已與設計不符，下方動態上界會隨之被放大成橡皮圖章，故直接判紅`,
    )
  }
  const aboveGrowth = growthPerGroup.reduce((sum, g) => sum + g, 0)
  const startJump = drift(dragStart.value, baseline, 'list-column') + drift(dragStart.value, baseline, 'targetTop')
  if (startJump > aboveGrowth + G4_SCROLL_TOLERANCE) {
    return fail(
      `列區欄位移（scrollTop 位移＋畫面位移合計 ${startJump}px）在 baseline→dragstart 之間超出執行期實測的「目標列之上列群組長高總量」${aboveGrowth}px（per-group growth=${JSON.stringify(growthPerGroup)}）＋容許量 — 超出的部分無法以「命中區擴張＋scroll anchoring」解釋，形同真實捲動`,
    )
  }
  for (const key of ['list-column', 'targetTop']) {
    for (const { stage, value } of dragResult.samples) {
      if (stage === 'post-drop') continue
      const d = drift(value, dragStart.value, key)
      if (d > G4_SCROLL_TOLERANCE) {
        return fail(`${key} drifted ${d}px at stage "${stage}" relative to dragstart (tolerance ±${G4_SCROLL_TOLERANCE}px, S-i 定案)`)
      }
    }
    const back = drift(postDrop.value, baseline, key)
    if (back > G4_SCROLL_TOLERANCE) {
      return fail(`${key} did not return to the pre-drag baseline after drop (drift ${back}px, tolerance ±${G4_SCROLL_TOLERANCE}px) — the drag hit-area expansion should be fully reversible`)
    }
  }

  // ── 落地驗證：來源段確實落進目標列（沿用既有 data-testid 快照手法）──
  const snapshot = await evaluate(SNAPSHOT_EXPR)
  const rowsOf = (segs) => segs.filter((id) => id !== G4_SOURCE_SEGMENT)
  const expectedOtherRows = [['model'], null, ['context-size', 'thinking'], ['agent-name', 'pr'], ['session-name']]
  if (snapshot.length !== expectedOtherRows.length) {
    return { ok: false, symptom: `unexpected row count after drop: ${JSON.stringify(snapshot)}; ${samplesDiag}` }
  }
  const landedRows = snapshot.filter((row) => row.kind === 'real' && row.segs.includes(G4_SOURCE_SEGMENT))
  if (landedRows.length !== 1 || landedRows[0].rowIndex !== 2) {
    return {
      ok: false,
      symptom: `expected "${G4_SOURCE_SEGMENT}" to land exactly once in display row 2 (the target row, non-first): ${JSON.stringify(snapshot)}`,
    }
  }
  for (const [index, expected] of expectedOtherRows.entries()) {
    const row = snapshot[index]
    if (row.kind !== 'real') return { ok: false, symptom: `row ${index} is not a real row after drop: ${JSON.stringify(snapshot)}` }
    // 目標列（index 1）只比對「去掉落地段之後」的成員與順序——落地段插在
    // `cost`／`duration` 之間或之後皆為合法的 drop 語意（依指標於目標 li
    // 的垂直位置而定），本案驗的是幾何不變量，不是插入位置的精確語意
    // （後者由案 1／2／6 覆蓋）。
    const want = expected ?? ['cost', 'duration']
    if (JSON.stringify(rowsOf(row.segs)) !== JSON.stringify(want)) {
      return { ok: false, symptom: `row ${index} membership changed unexpectedly after drop: got ${JSON.stringify(row.segs)}, expected ${JSON.stringify(want)} (plus the landed segment in row 1)` }
    }
  }
  const stored = await evaluate(`
    (() => {
      const cfg = JSON.parse(localStorage.getItem(${JSON.stringify(CONFIG_STORAGE_KEY)}));
      const seg = cfg.segments.find((s) => s.id === ${JSON.stringify(G4_SOURCE_SEGMENT)});
      return { enabled: seg.enabled, row: seg.row };
    })()
  `)
  if (stored.enabled !== true || stored.row !== 1) {
    return { ok: false, symptom: `stored config for "${G4_SOURCE_SEGMENT}" after drop: ${JSON.stringify(stored)} (expected enabled=true, row=1)` }
  }
  return { ok: true }
}

const caseG4DragGeometry1400x1000 = {
  id: 'g4-drag-geometry-1400x1000',
  label: 'T4.2：G4 跨欄拖曳幾何硬驗收（拖曳期間三捲動量不變 ±2px＋落地，1400×1000）',
  seed: G4_SEED,
  viewport: { width: 1400, height: 1000 },
  run: runG4DragGeometry,
}

const caseG4DragGeometry1280x800 = {
  id: 'g4-drag-geometry-1280x800',
  label: 'T4.2：G4 跨欄拖曳幾何硬驗收（拖曳期間三捲動量不變 ±2px＋落地，1280×800）',
  seed: G4_SEED,
  viewport: { width: 1280, height: 800 },
  run: runG4DragGeometry,
}

// 16/17. T4.3（TASKS.md MS4；PLAN §D8 G8）：行動版（390×844）目錄收合後
//     「列區起始完整落在視窗內」——教學帶顯示／已 dismiss **兩種前置態
//     各一案**，共用同一 runner。
//
//     ── 收合觸發方式（TASKS.md 明文二擇一，理由須留痕）──
//     採 **seed 收合 key**（`CATALOG_COLLAPSE_KEY`／`CATALOG_COLLAPSE_
//     SENTINEL`，自 `catalog-collapse.ts` import，見檔頭 import 處與
//     `seedExpr` 的 `collapseCatalog` 選項），不採真點擊 `<summary>`。理由：
//     ・本案要驗的是**版面幾何**（收合態下列區起始的可見性），不是收合
//       互動本身——後者已由 T3.4 的六情境 dom 案＋S-f 原型 11/11 實證覆蓋，
//       真點擊只會把「Chromium `<summary>` 預設動作非同步翻轉 `open`」這個
//       已知平台時序坑（S-f-RESULT.md「平台坑」節，main.ts 為此用雙 rAF）
//       引進本案，換來零額外覆蓋。
//     ・seed key **不繞過狀態機**：頁面端仍由 `isCatalogCollapsed()` 的
//       單一謂詞（收合 ⟺ `getItem(KEY)==='1'` 且 <1100px）裁決，走的正是
//       「使用者曾在行動版收合過、之後回訪」這條真實路徑（main.ts
//       `applyInitialCatalogCollapseState()` 於 init 收起）。案內先斷言
//       `<details>.open === false` 與 `<summary>` 可見，證明收合確實生效
//       ——若謂詞或接線壞掉，本案會紅在這個前提斷言上，而非讓幾何斷言
//       悄悄變成「其實沒收合」的假綠。
//
//     ── 「列區起始完整落在視窗內」的機械化口徑（本批定義）──
//     前置：頁面捲到**頂帶 sticky 穩態**（scrollY = 頂帶自然文件流位置，
//     執行期量得，同 G2／G4 手法）——G8 的語境是「頂帶 sticky 生效下」，
//     而 <1100px 兩欄已解除 sticky／max-height 回文件流（style.css），
//     故此時唯一還黏著的就是頂帶本身。然後：
//     (a) `#list-column`（列區欄）與 `#selected-section`（列區內容根）的
//         `rect.top` 皆 ≥ 頂帶 `rect.bottom`（±2px 次像素容許）——列區起始
//         未被不透明頂帶蓋住；
//     (b) 兩者的 `rect.top` 亦須 ≥0 且 < `innerHeight`——列區起始確實在
//         視窗內（防「非常誠實地沒被頂帶蓋住，因為它整個在螢幕外」）；
//     (c) **列區起始的首個可辨識錨點**＝`#add-pending-row`（「＋ 新增一列」
//         鈕，列區內第一個可見且可互動的元素——其上只有 sr-only live region
//         與排序說明 `<p>`，皆非可操作錨點）**完整**落在視窗內：
//         `top ≥ 頂帶 bottom` 且 `bottom ≤ innerHeight`（各 ±2px）；
//     (d) 該錨點中心點 `elementFromPoint` 命中其自身或後代——把「幾何上
//         沒被蓋住」升級為「命中測試也證明沒被任何東西蓋住」。

const G8_SEED = { model: 0, cost: 1, duration: 1, 'context-size': 2, thinking: 2, 'agent-name': 3, 'git-branch': 3, clock: 4 }
const G8_VIEWPORT = { width: 390, height: 844 }
const G8_TOLERANCE = 2

const G8_PRECONDITION_EXPR = `
  (() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    tutorialHidden: document.getElementById('tutorial-band-slot').hidden,
    // MAGI code review 🟡-2（選配授權：「G8 e2e 補一條 class 已除斷言」）：
    // 出貨態 <html class="js-init-pending"> 的暫抑樣式（style.css，僅
    // <1100px 生效）會把目錄內容壓成 0 高度；init() 起手 + finally 兩處
    // 移除該 class。jsdom 測試網對此恆真（jsdom 從未帶過該 class），唯有
    // 真瀏覽器載入真 dist 才驗得到「出貨態的 class 確實被移除」。本案為
    // 390×844（暫抑樣式的生效斷點），正是該保險最該把關的視窗尺寸。
    initPending: document.documentElement.classList.contains('js-init-pending'),
    detailsOpen: document.getElementById('catalog-collapse-details').open,
    summaryDisplayed: getComputedStyle(document.getElementById('catalog-collapse-summary')).display !== 'none',
    // 收合的**版面後果**（非只讀 open 屬性）：目錄欄整欄高度。展開態光
    // 四類分區就把本欄撐到兩千餘 px（遠高於任何 viewport），收合後只剩
    // 教學帶＋hint＋summary。刻意不改讀 .segment-lists 自身的 rect——
    // Chromium 對關閉的 details 走 content-visibility 隱藏，被跳過渲染的
    // 子樹仍可能回報非零 rect、量不準；欄自身的高度才是「收合真的改變了
    // 版面」的可靠證據。（本註解位於 JS 樣板字串內，刻意不使用反引號。）
    catalogColumnHeight: Math.round(document.getElementById('catalog-section').getBoundingClientRect().height),
  }))()
`

const G8_GEOMETRY_EXPR = `
  (() => {
    const rect = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    const anchor = document.getElementById('add-pending-row');
    const ar = anchor.getBoundingClientRect();
    const cx = Math.round(ar.left + ar.width / 2);
    const cy = Math.round(ar.top + ar.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    return {
      innerHeight: window.innerHeight,
      band: rect('preview-section'),
      listColumn: rect('list-column'),
      selected: rect('selected-section'),
      anchor: { top: ar.top, bottom: ar.bottom, left: ar.left, right: ar.right },
      anchorHitPoint: { cx, cy },
      anchorHitsSelf: hit !== null && (hit === anchor || anchor.contains(hit)),
      anchorHitDesc: hit === null ? null : (hit.id || hit.className || hit.tagName),
    };
  })()
`

async function runG8CatalogCollapsedListStart({ evaluate, delayFn }, { expectTutorialVisible }) {
  const pre = await evaluate(G8_PRECONDITION_EXPR)
  if (pre.innerWidth !== G8_VIEWPORT.width || pre.innerHeight !== G8_VIEWPORT.height) {
    return { ok: false, symptom: `viewport mismatch: ${JSON.stringify(pre)} (expected ${G8_VIEWPORT.width}x${G8_VIEWPORT.height})` }
  }
  if (pre.tutorialHidden !== !expectTutorialVisible) {
    return {
      ok: false,
      symptom: `tutorial band precondition not met (expected ${expectTutorialVisible ? 'visible' : 'dismissed'}): ${JSON.stringify(pre)}`,
    }
  }
  if (pre.initPending !== false) {
    return {
      ok: false,
      symptom: `<html class="js-init-pending"> still present after load — the initial-render suppression style is stuck on and the catalog stays 0-height at <1100px (init() must remove it both on its first statement and in its finally): ${JSON.stringify(pre)}`,
    }
  }
  if (pre.detailsOpen !== false || pre.summaryDisplayed !== true || !(pre.catalogColumnHeight < pre.innerHeight)) {
    return {
      ok: false,
      symptom: `catalog collapse precondition not met (expected details.open=false, summary displayed, and the catalog column collapsed to less than one viewport height): ${JSON.stringify(pre)}`,
    }
  }

  // 進頂帶 sticky 穩態（見案文件「機械化口徑」前置）。
  const maxScroll = await evaluate(`Math.max(0, document.documentElement.scrollHeight - window.innerHeight)`)
  await evaluate(`window.scrollTo(0, 0)`)
  await evaluate(SETTLE_AFTER_SCROLL_EXPR)
  await delayFn(120)
  const steadyThreshold = (await evaluate(bandRectExpr())).top
  if (!(maxScroll >= steadyThreshold)) {
    return { ok: false, symptom: `page cannot reach preview-band steady state (maxScroll=${maxScroll} < steadyThreshold=${steadyThreshold})` }
  }
  await evaluate(`window.scrollTo(0, ${Math.ceil(steadyThreshold)})`)
  await evaluate(SETTLE_AFTER_SCROLL_EXPR)
  await delayFn(150)

  const geo = await evaluate(G8_GEOMETRY_EXPR)
  const diag = `${JSON.stringify(geo)}; precondition=${JSON.stringify(pre)}`
  if (Math.abs(geo.band.top) > G8_TOLERANCE) {
    return { ok: false, symptom: `preview band not stuck at viewport top in steady state (G8 premise: band sticky at all breakpoints): ${diag}` }
  }
  for (const [name, rect] of [['#list-column', geo.listColumn], ['#selected-section', geo.selected]]) {
    if (!(rect.top >= geo.band.bottom - G8_TOLERANCE)) {
      return { ok: false, symptom: `G8 (a) failed: ${name} start is covered by the sticky preview band: ${diag}` }
    }
    if (!(rect.top >= -G8_TOLERANCE && rect.top < geo.innerHeight)) {
      return { ok: false, symptom: `G8 (b) failed: ${name} start is not within the viewport: ${diag}` }
    }
  }
  if (!(geo.anchor.top >= geo.band.bottom - G8_TOLERANCE && geo.anchor.top >= -G8_TOLERANCE && geo.anchor.bottom <= geo.innerHeight + G8_TOLERANCE)) {
    return { ok: false, symptom: `G8 (c) failed: #add-pending-row (first identifiable anchor of the row region) is not fully inside the viewport below the band: ${diag}` }
  }
  if (geo.anchorHitsSelf !== true) {
    return { ok: false, symptom: `G8 (d) failed: elementFromPoint at #add-pending-row centre did not hit the button (something covers it): ${diag}` }
  }
  return { ok: true }
}

function makeG8Case({ id, label, tutorialVisible }) {
  return {
    id,
    label,
    seed: G8_SEED,
    viewport: G8_VIEWPORT,
    // 預設 seed 步驟會 dismiss 教學帶；`false` 保留其可見（見 seedExpr 文件）。
    seedTutorial: tutorialVisible ? false : true,
    seedCatalogCollapsed: true,
    run: (ctx) => runG8CatalogCollapsedListStart(ctx, { expectTutorialVisible: tutorialVisible }),
  }
}

const caseG8CatalogCollapsedTutorialShown = makeG8Case({
  id: 'g8-catalog-collapsed-tutorial-shown-390x844',
  label: 'T4.3：G8 行動版目錄收合後列區起始可見（教學帶顯示，390×844）',
  tutorialVisible: true,
})

const caseG8CatalogCollapsedTutorialDismissed = makeG8Case({
  id: 'g8-catalog-collapsed-tutorial-dismissed-390x844',
  label: 'T4.3：G8 行動版目錄收合後列區起始可見（教學帶已 dismiss，390×844）',
  tutorialVisible: false,
})

// 20. sprint 15 MAGI code review 🟡-6（e2e 部分；2 票＋協調者實證：
//     e2e 對 `<summary>` 僅 390×844 一處引用，桌面態規則零回歸覆蓋）：
//     PLAN §D8「桌面態硬條件」納入真瀏覽器回歸網。style.css
//     `@media (min-width:1100px) { .segment-lists-details__summary
//     { display:none } }` 誤刪／錯字在本案之前不會有任何紅燈——唯一驗過
//     該規則的是已退役的 S-f 原型。
//
//     判準（三條，皆為 PLAN §D8 桌面態硬條件的機械口徑）：
//     (a) `#catalog-collapse-summary` 的 **computed** `display === 'none'`
//         ——PLAN 明文選 `display:none` 而非 `visibility:hidden`／
//         `opacity:0`，正因前者同時移出 render tree 與 a11y tree，「非
//         Tab 停點／不可點擊／a11y 播報與可見狀態一致」三項硬條件因此
//         同時成立；驗 computed display 這一個量即涵蓋三者（改成後兩者
//         任一或整條規則被刪，本斷言立刻紅）。
//     (b) `#catalog-collapse-details.open === true`——桌面恆展開（收合
//         謂詞 `isCatalogCollapsed()` 於 ≥1100px 恆 false，見
//         catalog-collapse.ts）。
//     (c) 目錄清單確實可見（渲染高度 >0＋項目數 >0）——防「summary 的確
//         不見了，因為整個 details 子樹被藏起來」這種假綠。錨點取
//         `#segment-list-always`（四類分區第一個 `<ol>`，有穩定 id；
//         `.segment-lists` wrapper 無 id，本 sprint e2e 慣例走 id／
//         data-testid）。
const caseD8CatalogSummaryDesktop = {
  id: 'd8-catalog-summary-desktop-1400x1000',
  label: '🟡-6：D8 桌面態硬條件（summary display:none＋details open＋目錄可見，1400×1000）',
  seed: { model: 0, cost: 1 },
  viewport: { width: 1400, height: 1000 },
  async run({ evaluate }) {
    const state = await evaluate(`
      (() => {
        const summary = document.getElementById('catalog-collapse-summary');
        const details = document.getElementById('catalog-collapse-details');
        const list = document.getElementById('segment-list-always');
        const r = list.getBoundingClientRect();
        return {
          innerWidth: window.innerWidth,
          summaryDisplay: getComputedStyle(summary).display,
          detailsOpen: details.open,
          listHeight: Math.round(r.height),
          listItemCount: list.querySelectorAll('[data-testid="catalog-item"]').length,
        };
      })()
    `)
    if (state.innerWidth < 1100) {
      return { ok: false, symptom: `viewport is not in the desktop range (≥1100px) — the D8 desktop hard condition does not apply here: ${JSON.stringify(state)}` }
    }
    if (state.summaryDisplay !== 'none') {
      return {
        ok: false,
        symptom: `(a) D8 desktop hard condition failed: computed display of #catalog-collapse-summary is "${state.summaryDisplay}" (expected "none" — check the @media (min-width:1100px) rule in style.css): ${JSON.stringify(state)}`,
      }
    }
    if (state.detailsOpen !== true) {
      return { ok: false, symptom: `(b) #catalog-collapse-details must stay open on desktop: ${JSON.stringify(state)}` }
    }
    if (!(state.listHeight > 0) || !(state.listItemCount > 0)) {
      return {
        ok: false,
        symptom: `(c) the catalog list is not visible on desktop (the summary being display:none must not come from the whole details subtree being hidden): ${JSON.stringify(state)}`,
      }
    }
    return { ok: true }
  },
}

// 21. sprint 15 MAGI code review 🟡-7（1 票＋協調者實證：e2e 零 summary
//     真點擊路徑——G8 兩案皆走 seed key；jsdom 的 `<details>` 於 click
//     同步翻轉 `open`，對「把雙 rAF 改回 queueMicrotask」這種退化零鑑別
//     力）：<1100px 真點擊 `<summary>` → 收合 → localStorage 持久化終值。
//
//     行使的正是 S-f-RESULT.md 費工挖出的平台坑：Chromium 對
//     `<summary>` 的預設動作（翻轉 `details.open`、派發 `toggle`）以
//     「queue an element task」非同步排入，晚於同一輪 microtask——
//     `queueMicrotask` 讀到的是翻轉**前**的舊值，main.ts
//     `scheduleCatalogCollapsePersist()` 因此改用雙 `requestAnimationFrame`。
//     該時序唯有真瀏覽器驗得出來（退化成 microtask 版會把兩次點擊的持久
//     化終值整個顛倒：收合寫不進去、展開反而寫入 sentinel）。
//
//     步驟／斷言序：
//     (a) 前提防呆（防假綠）：`summary` computed display ≠ 'none'（真的
//         在行動版斷點）、`details.open === true`（未 seed 收合 key，出貨
//         態展開）、收合 key 不存在；再以 `elementFromPoint` 確認點擊座標
//         確實命中 summary（頂帶 sticky 於全斷點生效，座標若躲進頂帶底下
//         會打在頂帶上——本案會紅在這裡而非誤判狀態機）。
//     (b) 真滑鼠事件點擊（`clickBySelector`，同案 10 手法：CDP
//         `Input.dispatchMouseEvent` mousePressed→mouseReleased，非 JS
//         `.click()`）→ 等足夠幀 → `details.open === false` 且
//         `localStorage[KEY] === SENTINEL`。
//     (c) 再點一次 → `details.open === true` 且 key **已移除**（`null`）
//         ——`clearCatalogCollapsed()` 的語意是移除而非寫怪值。
//
//     key／sentinel 一律 import 自 `catalog-collapse.ts`（見檔頭 import
//     處），本案零字面複製。點擊座標允許 `scrollIntoView`（本案不對捲動
//     位置下任何斷言，非 G4 那種拖曳幾何案）。
const CATALOG_SUMMARY_SELECTOR = '#catalog-collapse-summary'

/**
 * 真點擊座標（`clickBySelector` 用）：先 `scrollIntoView({block:'center'})`
 * 再讀 rect 中心。用 `'center'` 而非 `'start'`——頂帶 sticky 於全斷點生效，
 * 捲到 start 會讓目標剛好躲進頂帶底下，真滑鼠事件就打在頂帶上。
 */
function centeredClickPointExpr(selector) {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
}

const CATALOG_COLLAPSE_STATE_EXPR = `
  (() => ({
    summaryDisplay: getComputedStyle(document.getElementById('catalog-collapse-summary')).display,
    detailsOpen: document.getElementById('catalog-collapse-details').open,
    stored: localStorage.getItem(${JSON.stringify(CATALOG_COLLAPSE_KEY)}),
  }))()
`

const caseCatalogCollapseSummaryClickPersist = {
  id: 'catalog-collapse-summary-click-persist-390x844',
  label: '🟡-7：行動版 summary 真點擊 → 收合／展開持久化終值（雙 rAF 時序，390×844）',
  seed: G8_SEED,
  viewport: G8_VIEWPORT,
  // 刻意**不** seed 收合 key（`seedCatalogCollapsed` 保持預設 false）：本案
  // 要走的是「使用者當場點擊」這條路徑，起手態必須是出貨態展開。
  async run({ evaluate, delayFn, clickBySelector }) {
    /**
     * 等 main.ts `scheduleCatalogCollapsePersist()` 的雙 rAF 走完：400ms
     * 在 60Hz 下 ≈24 幀，遠超兩幀。刻意**不**用 `SETTLE_AFTER_SCROLL_EXPR`
     * ——本 harness 的 `Runtime.evaluate` 未帶 `awaitPromise`，該表達式回傳
     * 的 Promise 不會被等待（見 MAGI code review 🟢 節同名條目），而本案的
     * 時序護欄必須是真的等待，不能是形式上的。
     */
    const settlePersist = () => delayFn(400)

    const before = await evaluate(CATALOG_COLLAPSE_STATE_EXPR)
    if (before.summaryDisplay === 'none') {
      return { ok: false, symptom: `precondition failed: <summary> is display:none at ${G8_VIEWPORT.width}px (mobile breakpoint expected): ${JSON.stringify(before)}` }
    }
    if (before.detailsOpen !== true || before.stored !== null) {
      return {
        ok: false,
        symptom: `precondition failed: expected the shipped expanded state with no persisted preference (details.open=true, stored=null): ${JSON.stringify(before)}`,
      }
    }

    const point = await evaluate(centeredClickPointExpr(CATALOG_SUMMARY_SELECTOR))
    const hit = await evaluate(hitTestExpr(point.x, point.y, CATALOG_SUMMARY_SELECTOR))
    if (hit.hitsTargetOrDescendant !== true) {
      return { ok: false, symptom: `precondition failed: click point ${JSON.stringify(point)} does not hit the <summary> (something covers it): ${JSON.stringify(hit)}` }
    }

    await clickBySelector(centeredClickPointExpr(CATALOG_SUMMARY_SELECTOR))
    await settlePersist()
    const collapsed = await evaluate(CATALOG_COLLAPSE_STATE_EXPR)
    if (collapsed.detailsOpen !== false) {
      return { ok: false, symptom: `first real click did not collapse the catalog: ${JSON.stringify(collapsed)}` }
    }
    if (collapsed.stored !== CATALOG_COLLAPSE_SENTINEL) {
      return {
        ok: false,
        symptom: `collapse was not persisted after the double-rAF settle (expected ${JSON.stringify(CATALOG_COLLAPSE_SENTINEL)}, got ${JSON.stringify(collapsed.stored)}) — scheduleCatalogCollapsePersist() must read the flipped open state (S-f platform pitfall: <summary> flips it in a later element task)`,
      }
    }

    const point2 = await evaluate(centeredClickPointExpr(CATALOG_SUMMARY_SELECTOR))
    const hit2 = await evaluate(hitTestExpr(point2.x, point2.y, CATALOG_SUMMARY_SELECTOR))
    if (hit2.hitsTargetOrDescendant !== true) {
      return { ok: false, symptom: `second click point ${JSON.stringify(point2)} does not hit the <summary> (collapsed layout): ${JSON.stringify(hit2)}` }
    }
    await clickBySelector(centeredClickPointExpr(CATALOG_SUMMARY_SELECTOR))
    await settlePersist()
    const expanded = await evaluate(CATALOG_COLLAPSE_STATE_EXPR)
    if (expanded.detailsOpen !== true) {
      return { ok: false, symptom: `second real click did not expand the catalog again: ${JSON.stringify(expanded)}` }
    }
    if (expanded.stored !== null) {
      return {
        ok: false,
        symptom: `expanding must remove the key (clearCatalogCollapsed(), not write a non-sentinel value): stored=${JSON.stringify(expanded.stored)}`,
      }
    }
    return { ok: true }
  },
}

// 18/19. T4.3（TASKS.md MS4；PLAN §D4 五條 skip-nav＋`scroll-margin-top`
//     補償）：skip 可見性——1400×1000 與 390×844 各一案，共用同一 runner。
//     逐條 skip-link（DOM 序，選擇器走 `href` 屬性而非可見文字／結構路徑，
//     守本 sprint「e2e 不得依賴 i18n 可見文字」慣例）驗兩件事：
//     (A) **聚焦中的 skip-link 本身未被頂帶遮蔽**：`focus()` 後斷言其為
//         `document.activeElement`，再以其 rect 中心 `elementFromPoint`
//         命中該連結自身或其後代。這條斷言不是形式主義——`.skip-nav` 自身
//         高度為 0（其五個 `.skip-link` 皆 `position:absolute`），故聚焦
//         顯現的連結**正好疊在頂帶頂部區域上**，命中與否完全取決於
//         `.skip-link{z-index:10}` > `.preview-section{z-index:2}` 這條
//         層疊契約（style.css 兩處註解互相指名的那條）。
//     (B) **跳轉後落點 rect 與頂帶 rect 不相交**：真 Enter 鍵啟動（非 JS
//         `.click()`，見 `pressEnter` 文件）→ 斷言 `location.hash` 確實
//         變成該連結的 href（證明導覽真的發生）→ 斷言落點元素 rect 與頂帶
//         rect 幾何不相交（±2px 次像素容許）＋落點確實進了視窗
//         （`top < innerHeight`，防「因為落點還在螢幕外所以不相交」的
//         假綠）。此即 `scroll-margin-top: var(--band-h)` 補償的硬驗收。
//
//     ── 兩條豁免（相交斷言邏輯上不適用，理由須留痕）──
//     ・「跳至預覽」→ `#preview-section` **即頂帶自身**：任何元素與自己
//       必然「相交」，(B) 的相交斷言無意義（TASKS.md 明文豁免）。本連結
//       仍驗 (A) 與「hash 確實變更」。
//     ・「跳至產出腳本」→ `#output-dialog-open`：MS2（T2.1／D5「頂帶整包」）
//       把產出腳本鈕移進**頂帶右端**，落點因此是頂帶的**後代**——與上一
//       條同構的邏輯（落點在頂帶內，必然相交），故同樣豁免 (B) 的相交
//       斷言。此豁免為 TASKS.md 原文豁免（`#preview-section` 即頂帶）在
//       MS2 版面下的必然延伸，非本批放寬判準。補償斷言：本連結的 click 由
//       main.ts `wireSkipToOutput()` 攔截（`preventDefault()`＋聚焦該鈕、
//       不開 dialog），故改斷言「Enter 後 `document.activeElement` 確為
//       該鈕」＋「該鈕中心 `elementFromPoint` 命中其自身」——後者正是
//       「未被遮蔽」的等價硬驗收（它就在頂帶裡，不該被頂帶內任何東西蓋住）。

const SKIP_LINKS = [
  { href: '#global-section', landingId: 'global-section', mode: 'anchor' },
  { href: '#catalog-section', landingId: 'catalog-section', mode: 'anchor' },
  { href: '#selected-section', landingId: 'selected-section', mode: 'anchor' },
  { href: '#preview-section', landingId: 'preview-section', mode: 'band-self' },
  { href: '#output-dialog-open', landingId: 'output-dialog-open', mode: 'in-band-focus' },
]
const SKIP_TOLERANCE = 2

/** 兩個 rect 是否幾何相交（兩軸皆需重疊超過容許量才算相交）。 */
function rectsIntersect(a, b, tolerance) {
  const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  return vertical > tolerance && horizontal > tolerance
}

function skipLinkFocusExpr(href) {
  return `
    (() => {
      const link = document.querySelector('.skip-nav a[href=${JSON.stringify(href)}]');
      if (link === null) return { found: false };
      link.focus();
      const r = link.getBoundingClientRect();
      const b = document.getElementById('preview-section').getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return {
        found: true,
        isActiveElement: document.activeElement === link,
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        band: { top: b.top, bottom: b.bottom, left: b.left, right: b.right },
        point: { cx, cy },
        hitsLink: hit !== null && (hit === link || link.contains(hit)),
        hitDesc: hit === null ? null : (hit.id || hit.className || hit.tagName),
        scrollY: window.scrollY,
      };
    })()
  `
}

function skipLandingExpr(landingId) {
  return `
    (() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const landing = document.getElementById(${JSON.stringify(landingId)});
      const lr = rect(landing);
      const cx = Math.round((lr.left + lr.right) / 2);
      const cy = Math.round((lr.top + lr.bottom) / 2);
      const hit = document.elementFromPoint(cx, cy);
      return {
        hash: location.hash,
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        band: rect(document.getElementById('preview-section')),
        landing: lr,
        activeId: document.activeElement === null ? null : document.activeElement.id,
        landingCentreHitsSelf: hit !== null && (hit === landing || landing.contains(hit)),
      };
    })()
  `
}

async function runSkipVisibility({ evaluate, delayFn, pressEnter }) {
  // 前提：DOM 內的 skip-link 清單（**含順序**）與上方表格一致——D4 表訂
  // 「跳至設定排第一」等順序即編碼在 SKIP_LINKS 內。若日後增刪或改序而
  // 忘了同步本表，本斷言會直接打紅，而不是讓本案默默少驗一條。
  const hrefs = await evaluate(`[...document.querySelectorAll('.skip-nav a[href]')].map((a) => a.getAttribute('href'))`)
  if (JSON.stringify(hrefs) !== JSON.stringify(SKIP_LINKS.map((l) => l.href))) {
    return { ok: false, symptom: `skip-nav link set/order in DOM ${JSON.stringify(hrefs)} differs from this case's table ${JSON.stringify(SKIP_LINKS.map((l) => l.href))} (D4 contract)` }
  }
  for (const link of SKIP_LINKS) {
    // 每條連結都自 scrollY=0 起手：skip-link 為 `.skip-nav`（高度 0）內的
    // 絕對定位元素，隨頁面捲動離場，唯有頁首在視窗內時才談得上「聚焦顯現
    // 的連結是否被頂帶遮蔽」。
    await evaluate(`window.scrollTo(0, 0)`)
    await evaluate(SETTLE_AFTER_SCROLL_EXPR)
    await delayFn(120)

    const focusState = await evaluate(skipLinkFocusExpr(link.href))
    if (focusState.found !== true) {
      return { ok: false, symptom: `skip-link ${link.href} not found under .skip-nav (D4 requires exactly five links)` }
    }
    if (focusState.isActiveElement !== true) {
      return { ok: false, symptom: `skip-link ${link.href} did not become document.activeElement after focus(): ${JSON.stringify(focusState)}` }
    }
    if (focusState.hitsLink !== true) {
      return {
        ok: false,
        symptom: `(A) focused skip-link ${link.href} is obscured — elementFromPoint at its centre hit "${focusState.hitDesc}" instead (check .skip-link z-index:10 vs .preview-section z-index:2): ${JSON.stringify(focusState)}`,
      }
    }
    // 非空泛性自我檢查（不阻斷）：(A) 之所以是硬驗收，前提是聚焦顯現的
    // 連結**確實疊在頂帶上**（`.skip-nav` 自身高度 0，故其絕對定位子節點
    // 落在後續內容——即頂帶——的覆蓋區）。若哪天頁首結構改到兩者不再重疊，
    // (A) 會退化為恆真；此時印警告留痕，而非讓案悄悄失去把關力。
    if (!rectsIntersect(focusState.rect, focusState.band, 0)) {
      console.log(
        `[e2e] warn: focused skip-link ${link.href} rect does not overlap the preview band rect at scrollY=0 — assertion (A) is degenerate for this link (link=${JSON.stringify(focusState.rect)}, band=${JSON.stringify(focusState.band)}).`,
      )
    }

    await pressEnter()
    await evaluate(SETTLE_AFTER_SCROLL_EXPR)
    await delayFn(250)
    const landingState = await evaluate(skipLandingExpr(link.landingId))
    const diag = `link=${link.href}, ${JSON.stringify(landingState)}`

    if (link.mode === 'in-band-focus') {
      // 豁免相交斷言（落點是頂帶的後代，見案文件）；改驗攔截後焦點落點
      // 與命中測試。
      if (landingState.activeId !== link.landingId) {
        return { ok: false, symptom: `(B-exempt) Enter on ${link.href} did not focus #${link.landingId} (wireSkipToOutput intercept): ${diag}` }
      }
      if (landingState.landingCentreHitsSelf !== true) {
        return { ok: false, symptom: `(B-exempt) #${link.landingId} centre is obscured (elementFromPoint miss) although it lives inside the preview band: ${diag}` }
      }
      continue
    }

    if (landingState.hash !== link.href) {
      return { ok: false, symptom: `Enter on skip-link did not perform fragment navigation (location.hash mismatch): ${diag}` }
    }
    if (link.mode === 'band-self') {
      // 豁免相交斷言：落點即頂帶自身（TASKS.md 明文），(A) 已於上方驗畢。
      continue
    }
    if (!(landingState.landing.top < landingState.innerHeight)) {
      return { ok: false, symptom: `(B) landing #${link.landingId} did not come into the viewport after the jump (non-intersection would be vacuous): ${diag}` }
    }
    if (rectsIntersect(landingState.landing, landingState.band, SKIP_TOLERANCE)) {
      return {
        ok: false,
        symptom: `(B) landing #${link.landingId} rect intersects the sticky preview band rect after the jump (scroll-margin-top compensation failed): ${diag}`,
      }
    }
  }
  return { ok: true }
}

const SKIP_SEED = G8_SEED

const caseSkipVisibility1400x1000 = {
  id: 'skip-visibility-1400x1000',
  label: 'T4.3：skip 可見性（聚焦連結未被頂帶遮蔽＋落點不與頂帶相交，1400×1000）',
  seed: SKIP_SEED,
  viewport: { width: 1400, height: 1000 },
  run: runSkipVisibility,
}

const caseSkipVisibility390x844 = {
  id: 'skip-visibility-390x844',
  label: 'T4.3：skip 可見性（聚焦連結未被頂帶遮蔽＋落點不與頂帶相交，390×844）',
  seed: SKIP_SEED,
  viewport: G8_VIEWPORT,
  run: runSkipVisibility,
}

const CASES = [
  caseSameRowSwap,
  caseS1CrossRowDrain,
  caseS4SelectIntoMiddlePending,
  caseS9DeletePendingRenumber,
  caseS7DragDrainReload,
  caseCatalogDragIntoRow,
  caseOutputDialogEscFocusReturn,
  caseColorVariantOverrideSurvivesDrag,
  caseTutorialBandDoesNotBlockCatalogDrag,
  caseModeSwitchScrollStable,
  caseViewportProbe1280x800,
  caseG2PreviewBandSticky1400x1000,
  caseG2PreviewBandSticky1280x800,
  caseG4DragGeometry1400x1000,
  caseG4DragGeometry1280x800,
  caseG8CatalogCollapsedTutorialShown,
  caseG8CatalogCollapsedTutorialDismissed,
  caseD8CatalogSummaryDesktop,
  caseCatalogCollapseSummaryClickPersist,
  caseSkipVisibility1400x1000,
  caseSkipVisibility390x844,
]

// ── 單案執行器：全新瀏覽器＋全新 user-data-dir ─────────────────────────

let portCounter = 9700

async function runCase({ browserPath, baseUrl, headless, testCase }) {
  const port = portCounter++
  const userDataDir = join(SCRATCH_ROOT, testCase.id)
  const appUrl = `${baseUrl}/tools/statusline-builder/`
  const t0 = Date.now()
  // S-d（sprint 15 MS0）：逐案 viewport——未指定則落 DEFAULT_VIEWPORT（既有
  // 10 案皆走此分支，效果等同改造前的硬編 1400×1000，零迴歸）；此為本檔
  // viewport 的單一決策點，往下同時餵給 launchBrowser（headed 分支
  // window-size）與 CDP metrics override 兩個消費端。
  const viewport = testCase.viewport ?? DEFAULT_VIEWPORT
  const child = launchBrowser(browserPath, { headless, userDataDir, url: appUrl, port, viewport })
  let ws
  try {
    await waitForEndpoint(port)
    const target = await waitForPageTarget(port, baseUrl)
    ws = await connectWs(target.webSocketDebuggerUrl)
    const client = makeClient(ws)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
    await client.send('Input.setInterceptDrags', { enabled: true })

    // sprint 15 T2.3（(internal design doc) §D6-3
    // 「可觀測性」；spikes/S-a-RESULT.md「七」3 末條）：頁面未捕捉例外的
    // 監聽。動機＝`--band-h` 改走 ResizeObserver 後，Chromium 對 RO 迴圈
    // （回呼內寫入樣式 → 版面重算 → 回呼再觸發）會丟
    // `ResizeObserver loop completed with undelivered notifications` 這條
    // **window error**；它不影響任何既有斷言的成敗，harness 若不監聽就
    // 完全測不出來（PLAN 明文：「若採此路徑，harness 須補該監聽」）。
    //
    // 實作刻意獨立於 makeClient：在同一個 ws 上另掛一個 message 監聽器
    // （WebSocket 支援多監聽器），純增量、不動既有事件通道——特別是
    // `takeIntercepted()` 會把 `client.eventLog` 整個清空，若把例外記錄在
    // 那裡會被拖曳案清掉。收到任何例外即記錄，於案子跑完後令該案 FAIL。
    const pageExceptions = []
    ws.addEventListener('message', (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return // 非 JSON（理論上不會發生）：不干擾主通道。
      }
      if (msg.method !== 'Runtime.exceptionThrown') return
      const details = msg.params?.exceptionDetails ?? {}
      const text = details.exception?.description ?? details.text ?? '(no description)'
      const where = details.url ? ` @ ${details.url}:${details.lineNumber ?? '?'}` : ''
      pageExceptions.push(`${String(text).split('\n')[0]}${where}`)
    })

    async function evaluate(expression) {
      const result = await client.send('Runtime.evaluate', { expression, returnByValue: true })
      if (result.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`)
      return result.result.value
    }

    async function navigate() {
      const loaded = client.waitForEvent('Page.loadEventFired')
      await client.send('Page.navigate', { url: appUrl })
      await loaded
      await delay(700)
    }

    // 啟動參數已直接開到 appUrl，此處先等一次載入完成再重跑一次 navigate
    // （下方 seed 後還會再 reload 一次）以確保 headed／headless 起手式一致。
    await navigate()
    // T4.1：逐案可關閉 dismiss 前置步驟（預設 true，見 seedExpr 文件）——
    // `testCase.seedTutorial === false` 時保留教學帶可見（T4.2 案 9 用）。
    await evaluate(seedExpr(testCase.seed, {
      dismissTutorial: testCase.seedTutorial !== false,
      // T4.3：`testCase.seedCatalogCollapsed === true` 時一併 seed 行動版
      // 目錄收合 key（G8 兩案用；預設不寫，既有案零影響）。
      collapseCatalog: testCase.seedCatalogCollapsed === true,
    }))
    await navigate()

    function takeIntercepted() {
      const hits = client.eventLog.filter((m) => m.method === 'Input.dragIntercepted')
      client.eventLog.length = 0
      return hits
    }

    async function dragBySelector(fromPointExpr, toPointExpr) {
      const from = await evaluate(fromPointExpr)
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y })
      await delay(50)
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
      await delay(60)
      for (let i = 1; i <= DRAG_ESTABLISH_STEPS; i++) {
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + i * DRAG_ESTABLISH_DX, y: from.y + i * DRAG_ESTABLISH_DY, button: 'left', buttons: 1 })
        await delay(40)
      }
      await delay(300)
      const intercepted = takeIntercepted()
      if (intercepted.length === 0) {
        // 沒建立拖曳 session，仍需釋放滑鼠鍵避免殘留按壓狀態。
        await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x, y: from.y, button: 'left', clickCount: 1 })
        return { ok: false, symptom: 'no Input.dragIntercepted (drag session never established)' }
      }
      const data = intercepted[0].params.data
      const pt = await evaluate(toPointExpr)
      await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: pt.x, y: pt.y, data })
      await delay(60)
      await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: pt.x, y: pt.y, data })
      await delay(250)
      // 拖曳中插入點 gap 在指標下生長會改變命中目標：drop 前重查活座標、
      // 補發第二次 dragOver（sprint 07 教訓，sp8 PoC 沿用）。
      const pt2 = await evaluate(toPointExpr)
      await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: pt2.x, y: pt2.y, data })
      await delay(60)
      await client.send('Input.dispatchDragEvent', { type: 'drop', x: pt2.x, y: pt2.y, data })
      await delay(200)
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt2.x, y: pt2.y, button: 'left', clickCount: 1 })
      await delay(300)
      return { ok: true }
    }

    /**
     * T4.2（G4 專用拖曳變體）：座標**由呼叫端算好、全程固定**的拖曳。
     * 與上方 `dragBySelector` 的三點差異，皆為 G4 判準所必需：
     * 1. **不呼叫任何座標表達式**（更不 `scrollIntoView`）——`from`／`to`
     *    是呼叫端算好的 `{x, y}` 數字；G4 的斷言標的正是「捲動位置不變」，
     *    座標計算若自己先捲動就自我否定。
     * 2. **drop 前不重求值目標座標**（`dragBySelector` 會重求值＋補一次
     *    dragOver，以吸收插入點 gap 生長造成的位移）——T4.2 明文要求
     *    `toPointExpr` 只求值一次；本函式改為對**同一組固定座標**補發
     *    第二次 dragOver（仍保留「兩次 dragOver」的節奏，只是不換座標）。
     * 3. **逐階段取樣**：`sampleExpr` 給定時，於 dragStart 後／dragEnter
     *    後／dragOver 後／drop 前／drop 後各求值一次，回傳
     *    `samples: [{stage, value}]` 供呼叫端與基線比對。
     *
     * 建立位移沿用 `DRAG_ESTABLISH_*` 常數（與 `dragBySelector` 同一組，
     * 使呼叫端能在拖曳前預先算出全部中繼點座標並檢查安全帶）。
     */
    async function dragFixedPoints(from, to, { sampleExpr = null } = {}) {
      const samples = []
      const sample = async (stage) => {
        if (sampleExpr === null) return
        samples.push({ stage, value: await evaluate(sampleExpr) })
      }
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y })
      await delay(50)
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
      await delay(60)
      for (let i = 1; i <= DRAG_ESTABLISH_STEPS; i++) {
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + i * DRAG_ESTABLISH_DX, y: from.y + i * DRAG_ESTABLISH_DY, button: 'left', buttons: 1 })
        await delay(40)
      }
      await delay(300)
      const intercepted = takeIntercepted()
      if (intercepted.length === 0) {
        await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x, y: from.y, button: 'left', clickCount: 1 })
        return { ok: false, symptom: 'no Input.dragIntercepted (drag session never established)', samples }
      }
      await sample('after-dragstart')
      const data = intercepted[0].params.data
      await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: to.x, y: to.y, data })
      await delay(60)
      await sample('after-dragenter')
      await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: to.x, y: to.y, data })
      await delay(250)
      await sample('after-dragover')
      await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: to.x, y: to.y, data })
      await delay(60)
      await sample('pre-drop')
      await client.send('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data })
      await delay(200)
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 })
      await delay(300)
      await sample('post-drop')
      return { ok: true, samples }
    }

    // T6.1：CDP 注入真實 Esc 按鍵（rawKeyDown→keyUp）——與 JS
    // `dispatchEvent(new KeyboardEvent(...))` 不同，真實鍵盤事件才會被
    // Chromium 原生 `<dialog>` 的 cancel（Esc）處理管線接住並觸發
    // cancel→close；純 DOM 派發的 KeyboardEvent 不具備這條原生行為。
    async function pressEscape() {
      const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
      await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
      await delay(30)
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    }

    /**
     * T4.3（skip 可見性案）：CDP 注入真實 Enter 按鍵，觸發**聚焦中連結**
     * 的原生啟動（片段導覽／click 事件），而非以 JS `element.click()` 繞過
     * 鍵盤路徑——skip-link 的使用情境本就是「Tab 到它、按 Enter」，本案
     * 的價值正在於走完整條真實鍵盤路徑。
     *
     * 型別用 `keyDown`＋`text: '\r'`（**非** `rawKeyDown`）：`rawKeyDown`
     * 不產生 char 事件，Chromium 對連結的 Enter 啟動走的是帶 text 的
     * keyDown 管線（同 pressEscape 之所以能用 rawKeyDown 是因為 Esc 的
     * cancel 行為掛在 keydown 本身）。
     */
    async function pressEnter() {
      const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', unmodifiedText: '\r', ...base })
      await delay(30)
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    }

    async function selectMove(segmentId, slotValue) {
      await evaluate(`
        (() => {
          const li = document.querySelector('[data-testid="segment-row"][data-segment-id=${JSON.stringify(segmentId)}]');
          const sel = li.querySelector('[data-testid="row-select"]');
          sel.value = ${JSON.stringify(String(slotValue))};
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return sel.value;
        })()
      `)
      await delay(300)
    }

    // T4.2：真實 CDP 滑鼠點擊（mousePressed→mouseReleased 序，非 JS
    // `element.click()` 方法）——實跑校準發現：僅呼叫 `.click()` 方法
    // 不會觸發瀏覽器對表單控件的原生 focus 行為（Chromium 的「點擊聚焦」
    // 是 mousedown 事件的預設動作，`HTMLElement.click()` 方法本身不模擬
    // mousedown/mouseup 序列——實測 `.click()` 後 `document.activeElement`
    // 仍是 `<body>`）。案 10（mode 切換 scrollY 回歸）需要「使用者真點擊
    // →原生取得焦點」這個前提，才能忠實重現舊 bug 場景（change handler
    // 內 `segmentListsEl.focus()` 奪走剛由使用者點擊取得的焦點），故改走
    // 真滑鼠事件序（同 dragBySelector 的 Input.dispatchMouseEvent 手法，
    // 僅無拖曳/drop 階段）。
    async function clickBySelector(pointExpr) {
      const pt = await evaluate(pointExpr)
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
      await delay(30)
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 })
      await delay(40)
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
      await delay(60)
    }

    const outcome = await testCase.run({
      evaluate,
      dragBySelector,
      dragFixedPoints,
      selectMove,
      navigate,
      delayFn: delay,
      pressEscape,
      pressEnter,
      clickBySelector,
    })
    const durationMs = Date.now() - t0
    // sprint 15 T2.3：頁面例外一律讓該案 FAIL（含 RO 迴圈警告——它以
    // 未捕捉例外的形式浮出，是「回呼內寫入造成無限重排」的唯一機械證據）。
    // 印在 symptom 內，跑批摘要即可直接讀到訊息，不需另開 devtools。
    if (pageExceptions.length > 0) {
      const list = pageExceptions.map((e) => `  - ${e}`).join('\n')
      console.log(`\n[e2e] uncaught page exception(s) during ${testCase.id}:\n${list}`)
      return {
        success: false,
        symptom: `${pageExceptions.length} uncaught page exception(s) (Runtime.exceptionThrown): ${pageExceptions.join(' | ')}`,
        durationMs,
      }
    }
    return { success: outcome.ok, symptom: outcome.symptom ?? null, durationMs }
  } catch (err) {
    const durationMs = Date.now() - t0
    return { success: false, symptom: String(err && err.message ? err.message : err), durationMs }
  } finally {
    try {
      ws?.close()
    } catch {
      // ignore
    }
    killProcessTree(child.pid)
    await delay(300) // 讓 Windows 釋放 user-data-dir 檔案鎖
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup only
    }
  }
}

// ── 主流程 ─────────────────────────────────────────────────────────────

async function main() {
  const browserPath = detectBrowser()
  if (browserPath === null) {
    console.log('[e2e] SKIP: no local Edge/Chromium executable found in known install paths:')
    for (const p of EDGE_CANDIDATES) console.log(`  - ${p}`)
    console.log('[e2e] Install Microsoft Edge (or adjust EDGE_CANDIDATES) to run this suite locally.')
    console.log('[e2e] Nothing to test — exiting 0 (browser-less environment, not a failure).')
    process.exit(0)
  }
  console.log(`[e2e] Browser found: ${browserPath}`)
  console.log(`[e2e] Mode: ${HEADED ? 'headed (E2E_HEADED=1)' : 'headless(new) [default]'}`)

  mkdirSync(SCRATCH_ROOT, { recursive: true })

  ensureBuilt()

  console.log('[e2e] starting vite preview ...')
  const { proc: previewProc, baseUrl } = await startPreview()
  console.log(`[e2e] preview ready at ${baseUrl}`)

  const suiteStart = Date.now()
  const results = []
  try {
    for (const testCase of CASES) {
      process.stdout.write(`[e2e] ${testCase.id} — ${testCase.label} ... `)
      const result = await runCase({ browserPath, baseUrl, headless: !HEADED, testCase })
      results.push({ ...result, id: testCase.id, label: testCase.label })
      console.log(`${result.success ? 'PASS' : 'FAIL'} (${result.durationMs}ms)${result.symptom ? ` — ${result.symptom}` : ''}`)
    }
  } finally {
    console.log('\n[e2e] stopping vite preview ...')
    killProcessTree(previewProc.pid)
    console.log('[e2e] sweeping any orphaned browser processes from this run ...')
    sweepOrphanBrowser()
    try {
      rmSync(SCRATCH_ROOT, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
  const totalMs = Date.now() - suiteStart

  console.log('\n=== SUMMARY ===')
  for (const r of results) {
    console.log(`  ${r.success ? 'PASS' : 'FAIL'}  ${r.id.padEnd(28)} ${String(r.durationMs).padStart(6)}ms  ${r.label}${r.symptom ? `\n        symptom: ${r.symptom}` : ''}`)
  }
  const passCount = results.filter((r) => r.success).length
  console.log(`\n${passCount}/${results.length} passed — total ${totalMs}ms`)

  process.exitCode = passCount === results.length ? 0 : 1
}

main().catch((err) => {
  console.error('[e2e] FATAL', err)
  process.exitCode = 1
})
