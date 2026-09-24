# SPEC

Architecture and feature spec, kept in sync with the codebase. Updated by
`(internal workflow command)` when project-level changes warrant it.

## Architecture overview
ClientKit（原 EZTools）是一個純靜態的網頁工具合集，以 TypeScript 開發，部署於 GitHub Pages。
沒有後端伺服器，所有處理（媒體轉換／編輯、開發者小工具之設定產生與空間／幾何
規劃）皆在使用者的瀏覽器端完成。以 Vite 建置為 MPA（Multi-Page Application）：入口頁面
（`index.html`）靜態列出所有工具；入口頁零框架 JS，唯一例外為 `<head>`
內主題切換 inline script（零依賴、零網路請求，白名單受 verify-dist
斷言把關）；各工具為 `tools/<slug>/` 下的獨立頁面，建置時自動掃描收錄。入口頁清單於建置／開發期由 `src/tools.ts`
（唯一資料來源）經 `src/render.ts` 注入 HTML。部署管線：私有 repo `main`
為發佈基準 → `npm run publish:public` 快照推送至公開 repo ClientKit `main` →
ClientKit Actions（`deploy.yml`，job 以 repository 條件只在公開側生效）部署
Pages。

## Components
- 入口頁面 — 工具總覽與導覽（靜態產生，依 `available`／`planned` 狀態產生卡片）
- 工具清單資料模組 `src/tools.ts`（唯一事實來源，定義各工具中繼資料與狀態）
- 渲染模組 `src/render.ts`（依清單資料產生入口頁 HTML 的純函式）
- 全站主題模組 `src/theme.ts`（唯一事實來源：三態主題邏輯——`<html>`
  無 `data-theme` 跟隨系統、`data-theme="dark"`／`"light"` 為手動覆寫，
  優先次序 localStorage＞系統偏好＞淺色預設；對外僅雙態的 toggle 切換、
  `aria-pressed` 同步、localStorage 讀寫皆 best-effort；matchMedia
  change／storage 事件雙監聽（`initThemeSync`），OS 變更與跨分頁切換
  即時同步 toggle 態；跨分頁 storage 清除（外部事件、非 toggle 路徑）
  時回跟隨系統）；六頁共用的
  footer（作者／GitHub／授權連結）與主題切換鈕則以共用 markup＋
  `src/style.css` token 呈現，各頁 `<head>` 另有防 FOUC 的 inline
  bootstrap script（見 Conventions／Architecture overview 的零框架 JS
  例外）
- 工具頁範本 `tools/_probe/`（新增工具的起始骨架範本；僅 repo 內範本、不建進
  dist——vite 掃描排除 `_` 前綴目錄）
- APNG → GIF 轉換工具 — apng-js 解碼 → 共用 `src/lib/` 合成／編碼管線
  （module Web Worker）；位於 `tools/apng-to-gif/`
- GIF 編輯工具 — gifuct-js 解碼＋走訪 application extension 抽 loop →
  共用 composite 全幀化 → 純函式編輯（刪幀／停留時間／播放次數）→ 共用
  gif-encode 重編碼（module Web Worker）；位於 `tools/gif-editor/`
- 共用純邏輯模組 `src/lib/`（composite 合成、gif-encode 編碼管線、
  gif-reader（byte 級測試 oracle）、color（WCAG 相對亮度／對比／自動前景，
  自 statusline-builder 抽出）、共用測試工具）
- 影片格式轉換工具 — ffmpeg.wasm（單執行緒 core，self-host vendor）
  ffprobe 探測 → 白名單 remux 優先／轉碼後備／blind-transcode 降級 → MP4；
  位於 `tools/video-converter/`
- Claude Code statusline 產生器 — segment 目錄（tri-path 描述子）／閾值變色／
  執行期 join／三後端產生器（bash／ps1／settings.json 片段）＋emit-ansi oracle，
  零 runtime 依賴；圖示改為英文短 token 前綴（07 M1.5 裁決，推翻 emoji
  定案）；30 段目錄（tokens 三段＋雙倒數）、百分比段 bar 正交欄（靜態
  4-run、null 退單 run）、model/effort auto 配色（resolve 期展開為具體
  ColorSpec、比對 model.id）、閾值雙模板、`STATUSLINE_NOW_EPOCH` 注入；
  config 相容性：auto／bar 為 v2 內選填擴充，舊碼讀取為有損降級、不
  bump；powerline 段間箭頭（``）由 config schema
  `powerlineArrow` 欄位條件化，新建 config 預設關閉（色塊直接相接＋每段
  右側 padding），既有 v1 存檔依原 `mode` 自動遷移續用箭頭觀感；**多列
  輸出**：`SegmentConfig.row?: number`（選填、缺欄視同 0，CONFIG_VERSION
  維持 2 不 bump）驅動 `resolve()` 回傳 `rows: StyledRun[][]`（按渲染列序
  分組、空列壓縮，全隱藏退化為單一空列 `[[]]`），三後端與預覽逐列同步
  輸出，行尾契約＝列間單一 LF join、無尾隨換行；**版面**（sprint 15
  全面改寫，取代 sprint 14 三欄形）——**不變量（變更需重議）**：見
  Conventions 節「拖放編排可用性不變量」／「skip 落點快照謂詞」／
  「版位判準」三句（見各自標題起之段落，引用不複製全文）。**現行
  形態（sprint 15，可調整）**：頂＝預覽全寬頂帶（`#preview-section`，
  role=region 隨遷、自身不掛 tabindex）；下三欄左→右＝segment 目錄
  ｜列區（已選擇，最寬）｜全域設定；DOM 序＝skip-nav → status/error
  → 頂帶 → 目錄 → 列區 → 設定，DOM 序＝視覺序＝Tab 序，兩斷點同一
  DOM 序、零 JS 搬移零 CSS order；頂帶高度上限 ≤40dvh 掛自身、全
  斷點 sticky，終端框改 `flex:1` 內捲吸收超出（上限不再掛終端框
  自身 max-height）；skip-nav 五條落點——跳至設定（排第一）→
  `#global-section`、跳至目錄→`#catalog-section`、跳至已選擇→
  `#selected-section`、跳至預覽→`#preview-section`、跳至產出腳本
  →`#output-dialog-open`，皆有 scroll-margin-top 綁 `--band-h`；
  桌面兩欄（目錄欄＋列區）各自獨立捲動容器（sticky top 綁
  `--band-h`、max-height calc(100dvh−`--band-h`) 單項扣除，皆
  `overscroll-behavior: contain`——S-g 定案，欄內捲不連鎖外頁）；
  `<1100px` 目錄可收合——key 字面值＝
  `clientkit-statusline-builder-catalog-collapsed`、sentinel＝`'1'`，
  完整謂詞＝**收合 ⟺ `localStorage.getItem(KEY)==='1'` 且視窗
  <1100px；key 缺失、`getItem` 擲錯、任意怪值一律展開
  （fail-open）**；桌面（≥1100px）恆展開、`<summary>` 隱藏非停點。
  **捲動停點契約（新增）**：作者顯式停點＝預覽終端框
  （`#preview-terminal` tabindex="0"，頂帶內唯一）＋產出 dialog 內
  三份產出 `<pre>`；兩欄捲動容器不自行加停點、不加 role="region"；
  Chromium 對「無可聚焦子節點的捲動容器」自動補的 UA 停點不屬
  作者契約範圍（jsdom 層鎖作者顯式清單，真瀏覽器停點行為歸 e2e
  層）。目錄項可**拖移入列**直接啟用至列區（中欄）已選擇清單目標
  列，checkbox 鍵盤等效保留、落列播報採視覺顯示編號；目錄列
  compact 形——未啟用「☐ 段名＋預設形樣例值」（樣例由逐段單段
  -enabled 預設 config × FULL mock 唯讀 resolve 合成、per-locale
  快取，合成失敗退 fallback 文案）／已啟用「☑ 段名＋已加入」；
  已選擇清單依渲染列分組，各列群組容器自帶地標／標題可跳達，列
  header 帶逐列分隔符覆寫控件；行動版（<1100px）摺疊序＝預覽→
  目錄→列區→設定（**DOM 序＝視覺序**不變，同序堆疊、回歸文件
  流）；move 鈕行為契約＝**預設收納、鍵盤導航浮現、滑鼠點擊不
  浮現**（收納態佔位零躍動、保留 Tab 序）；產出仍收斂為單一按鈕
  開 `<dialog>`（鈕改居頂帶控制列右端；
  stacked 三產物各含複製／下載；showModal＋feature-detect
  fallback，`#output-status` live region 常駐 dialog 外）；dialog
  尺寸＝`min(90vw, max(640px, 55vw), 72rem)`×`min(85dvh, 60rem)`；
  拖曳教學帶顯示謂詞＝**讀值 ≠ `'1'`（fail-open：key 缺失、讀取
  失敗、怪值皆顯示）**，dismiss 寫入後永久隱藏，localStorage
  key＝`clientkit-statusline-builder-drag-tutorial`、sentinel＝
  `'1'`（比照 lang key `clientkit-statusline-builder-lang` 列名、
  不入 BuilderConfig）；**逐列分隔符覆寫**
  `BuilderConfig.rowSeparators?: (SeparatorConfig|null)[]`（v2 內選填
  欄不 bump，缺項／null 退全域；索引綁**啟用列位**、三後端與預覽同
  基準；僅 plain 模式生效，powerline 保值惰性；golden 採「既有凍結＋
  新增帶覆寫 fixture」策略）；**i18n 雙語**（zh-Hant 預設／en）：純
  核心 `messages.ts`（typed `Messages` 介面雙字典，typecheck 罩插值
  arity）＋DOM 套用器 `i18n-dom.ts`（data-i18n／data-i18n-attr、
  localStorage `clientkit-statusline-builder-lang`、`<html lang>` 同步、
  五步序切換重繪）雙層，純函式模組以 locale 注入（選填預設 zh-Hant），
  產出腳本內容不雙語化；config schema 現為 CONFIG_VERSION 2（含
  v1→v2 遷移，`row`／`rowSeparators` 為 v2 內選填欄）；位於
  `tools/statusline-builder/`
- 房間家具擺放規劃器 — SVG 畫布＋Pointer 拖移、矩形方塊組合房型、門迴旋區、
  純邏輯 clearance 引擎（遮擋子段／四段閾值／門洞／各面需留）、預設庫、
  JSON／PNG 匯出、URL hash 分享（連結本身含整份平面圖，載入為預覽態）、
  物件屬性欄、家具件數軟上限 `settings.maxItems`，零 runtime 依賴；位於
  `tools/room-layout-planner/`，設計細節見 `(internal design doc)`

## Public surface
- 靜態網頁（GitHub Pages 託管的 HTML/CSS/JS）
- 站台網址：https://alan60910.github.io/ClientKit/
- 公開原始碼：`github.com/alan60910/ClientKit`（唯讀快照鏡像；由私有 repo
  `publish:public` 同步；開發歷程目錄與代理指令檔不公開）
- 每工具路徑慣例：`tools/<slug>/`（如 `/tools/apng-to-gif/`）
- 資產採相對 base（`base: './'`），站台可搬移不需改建置
- room-layout-planner 分享連結：`tools/room-layout-planner/#plan=<base64url>`
  （整份平面圖內嵌於 hash、≤8,000 字元；載入後立即 `replaceState` 清除、進
  預覽態不寫 localStorage；UI 常駐「連結本身即包含整份平面圖」告知句）

## Conventions
- TypeScript（strict、ESM）
- 純前端處理，不依賴任何後端 API
- 新增工具兩步驟：建立 `tools/<slug>/`（含 `index.html` + `main.ts`，自動被
  build 收錄）＋在 `src/tools.ts` 登記一筆（狀態 `planned` → `available`
  時卡片才會產生連結）
- 工具頁範本要點：`lang="zh-Hant"`、`../../` 返回入口連結、`main.ts` 以
  `import '../../src/style.css'` 消費共用樣式（入口頁零框架 JS，唯一
  例外為主題切換 inline script（含 toggle 監聽及其同步機制——OS 偏好
  變化、跨分頁切換），故改以 `<link>`
  消費樣式）；範本並含 `<meta name="color-scheme">`、換頁白閃防護
  critical style、header 尾端主題切換鈕（`.theme-toggle`）、`main.ts`
  於任何渲染前 `import '../../src/theme.ts'` 並於 `initThemeToggle` 後
  呼叫 `initThemeSync`、六頁共用 footer 構成
  （隱私句＋作者／GitHub／授權連結）——以 `tools/_probe/` 為範本
- 樣式策略：純手寫 CSS、不引入框架，a11y 基線（`:focus-visible`、WCAG AA、
  `prefers-reduced-motion`）全站適用
- a11y 實作細節：「規劃中」工具卡不產生 `<a>`、不可聚焦，狀態以可見文字標籤傳達
- 工具頁 CPU 密集的「編碼／轉檔運算」採 module Web Worker（worker 可由
  vendored 依賴內建提供，不限自寫 `*.worker.ts`；合成等前處理得留主執行緒）；
  SharedArrayBuffer 不可用之硬約束見 (internal design doc) Constraints
- 大型第三方 runtime 資產以 npm exact pin 為源，建置期（predev/prebuild
  hook）自 node_modules 複製至 `public/vendor/<name>/`（不進 git），複製
  腳本斷言版本與 pin 同步、verify-dist 斷言產物存在；經 dynamic import／
  Worker 載入之 runtime JS/wasm 資產一律以顯式同源**絕對** URL 載入，
  禁止依賴套件內建 CDN fallback
- 非執行型小型第三方靜態資產（字型／圖片／資料，約數十 KB 級）可直接
  簽入工具目錄：須附授權聲明檔、來源版本＋再生工序記錄（provenance），
  並列入 README 第三方元件段；以 HTML/CSS 同源相對參照載入、由 Vite
  資產管線處理，不受上述絕對-URL 條文約束；本慣例不設全站硬編上限，
  下一個簽入此類資產的工具須自帶 verify-dist 斷言把關存在性與大小
  （statusline-builder 的 Nerd Font subset <100KB 曾是此類活例＋把關
  斷言，sprint 06a 已將字型資產與該斷言一併移除，見 Status）
- 工具頁骨架：header（含返回入口連結）／`<main>`／footer、單一 `<h1>`、
  描述性 `<title>`、meta description
- 互動工具 a11y 不變量：拖放具鍵盤等效（原生 file input 留在 tab
  order）、進度／狀態用 aria-live、動態結果做焦點管理、自動播放媒體可暫停
  ＋尊重 prefers-reduced-motion、資訊性 alt、錯誤用 role=alert；暫停控制
  與靜態 poster 須在媒體開始播放當下即可用（不得延後至後續流程階段）；
  live region 須常駐 a11y tree（不得以 display:none／hidden 切換承載播報）；
  媒體之替代呈現（poster 等靜態代表畫面）須繼承等效文字——canvas 頂替
  `<img>` 時以 role=img＋aria-label 比照對應 alt，不得因元素替換而遺失；
  畫布自由拖移之鍵盤等效＝單一 roving Tab 停點＋方向鍵步進（1 cm，Shift
  十倍）＋清單數值輸入雙路徑，播報含新座標；拖移為模態，Esc 取消回原位
- 可編輯項目清單 a11y 不變量：批次／狀態切換操作須經常駐 live region
  播報；項目刪除採非破壞性切換（焦點不遷移）；裝飾性縮圖 aria-hidden、
  項目身分承載於控件 accessible name；含值控件（spinbutton／textbox 等）
  之 accessible name 以 `label[for]`＋獨立 id 承載、不得以 wrap-label 包
  裹（避免現值滲入名稱）；大量項目須有 skip 機制與分頁
  （或等效導覽策略），換頁／視圖切換須管理焦點並播報
- 工具可含多模組切分（如 decode/composite/convert/worker），純邏輯模組須
  為 node 可測（不 import DOM runtime）；跨工具共用的純邏輯模組置於
  `src/lib/`，同樣須為 node 可測（不 import DOM runtime）
- localStorage key 統一格式 `clientkit-<scope>-<name>`；全站範圍可省略
  scope（如 `clientkit-theme`）。06a 立此慣例；
  sprint 17 於站台首次上線前將全部 7 把 key 自 `eztools-` 一次改名，
  statusline-builder 主設定 key 沿用舊冒號形狀
  `clientkit:statusline-builder:config`（形狀例外，新 key 勿仿效）。同帳號 GitHub
  Pages 各 repo 共享同一 origin 的 localStorage 配額與命名空間，讀取端一律視為
  不可信輸入（room-layout-planner 四條載入路徑皆走 `parsePlan` 白名單）
- 不公開的目錄或檔（含 import 自私有目錄的 spike 腳本）以 `.gitattributes`
  `export-ignore` 宣告；只有會被匯出文字引用、且不與產品字串同名的目錄才另加
  進發佈腳本 `INTERNAL_ROOTS`；`git archive` 為公開子集唯一事實來源（僅私有
  repo 適用）
- 互動工具關鍵節點以 `data-testid` 提供 e2e 穩定錨點，e2e selector
  一律走錨點、不依賴 DOM 結構路徑；e2e 斷言亦**不得依賴 i18n 可見
  文字**，位置／序數類斷言走 `data-*` 序數屬性（如 `data-row-index`）。
  此慣例為 sprint 09 新增（statusline-builder e2e 案例集為現行活例）；
  每支 `scripts/e2e-*.mjs` 各自的 `CASES` 陣列為該工具案數的事實來源
- repo 以 `.gitattributes` `* text=auto` 為 EOL 基線；byte-exact
  fixtures（golden、二進位測試輸入）須顯式 `-text`／`binary` 豁免，
  新增此類檔案時同步補規則。此慣例為 sprint 10 新增
- **拖放編排可用性不變量**：拖放操作的來源與目標須分屬獨立捲動容器，
  可用性不得依賴程式化捲動；拖曳過程中不得要求捲動
- **skip 落點快照謂詞**：`<main>` 內每個頂層分區於 skip-nav 須有對應
  落點；特化自本節「可編輯項目清單 a11y 不變量」中「大量項目須有 skip
  機制與分頁」規約
  ——該規約以量觸發，本句以結構觸發，可對單一版本快照直接機械驗證
  （口徑：「分區」＝帶 accessible name 的 `<section>`／`[role=region]`；
  「頂層」＝自 `<main>` 直接子節點起算，純版面 wrapper 視為透明、以其
  直接子節點代入，並扣除 `[hidden]`／`[aria-hidden="true"]` 節點與
  `<dialog>` 覆蓋層——後者可達性由其開啟控件自身的落點承擔，餘者中
  「自身是分區或其後代含至少一個分區」者入列；「有對應落點」＝存在
  skip 連結之 href 解析到該分區自身或其後代。機械守門人見
  `tools/statusline-builder/skip-nav.dom.test.ts`）
- **版位判準**：互動所需的共視元素不得以捲動換取共視；低頻互動面板取
  視覺權重最低位；核心產出恆佔最大可視寬度。此三句為 sprint 15 新增
  （statusline-builder 版型重構為現行活例）
- **Components 摘要句同步規則**：Components 每工具一條現況摘要句＋指向該
  工具最近設計文件的連結；行為變更只更新摘要句，已收斂的 sprint PLAN 為
  凍結紀錄不回頭編輯。適用於新工具與日後改寫；既有長條目
  （statusline-builder）拆分見 BACKLOG，拆分時其「不變量」指標移入本節或
  該工具 PLAN，不得隨摘要句刪去。此規則為 sprint 16 新增；公開鏡像中
  該連結由發佈腳本清洗為 `(internal design doc)`

## Status
入口頁骨架已完成（Vite MPA 架構、工具清單注入機制、a11y 基線）。部署由
公開鏡像 ClientKit 承擔（私有 Free 不發佈 Pages）。
apng-to-gif、gif-editor、video-converter、statusline-builder、
room-layout-planner 五工具皆已可用；
PRD 四大工具目標完成，statusline-builder 已上線（Claude Code statusline 設定
產生器；segment schema 基準版與人工重核註記見 README）。
video-converter 之「上線」宣告以 GPL 授權聲明落地（README License 段）
為前置。

sprint 06a（statusline-builder UI refresh 第一段）已交付：segment 圖示
全面改為通用 emoji（不再要求終端安裝字型，簽入字型資產與其建置工序、
verify-dist 的字型把關斷言皆已移除，改為「字型資產不得回歸」的負向
斷言；此 emoji 定案已被 07 M1.5 使用者裁決推翻，圖示現改為英文短
token 前綴，見上方 Components 段與下方 sprint 06c 段）；powerline 段間
箭頭（``）改由 config schema `powerlineArrow`
欄位條件化，新建 config 恆預設關閉，config schema 隨之升版至
CONFIG_VERSION 2（v1→v2 自動遷移，既有 v1 powerline 存檔續用原箭頭
觀感）；全站（入口頁＋四個工具頁）新增深／淺主題切換（跟隨系統／手動
切換／localStorage 記憶，含換頁白閃防護）與統一 footer（作者／GitHub／
授權連結）。

sprint 06b（statusline-builder 多列輸出＋三欄版面＋排序語意）已交付：
`SegmentConfig.row` 選填欄驅動多列輸出（`resolve()` 回傳
`rows: StyledRun[][]`，按渲染列序分組、空列壓縮、全隱藏退化 `[[]]`；
三後端與預覽同步逐列輸出，行尾契約＝列間單一 LF join、無尾隨換行）；
版面由單欄改三欄滿版（左＝segment 目錄 transfer-list、中＝已選擇依
渲染列分組（列群組容器自帶地標／標題）、右＝即時預覽＋產出腳本
sticky），斷點 3→2→1 欄退化；排序語意重構為「依渲染列分組」清單，
上／下移＝同列內交換、跨列移動走「顯示於第 N 列」select 與拖曳插入；
列可暫存為 UI 空列（位置制、可居中間；純顯示態、不入存檔——config
恆無空列，跨列移動搬空來源列時原地保留為空列）；
CONFIG_VERSION 維持 2（`row` 為既有版本內選填欄，不 bump）。

sprint 09（statusline-builder UX 重構，真機回饋批）已交付：逐列分隔符
覆寫（v2 選填欄；golden 既有凍結＋新增 6 fixture）、欄位預設值標示
（八欄位＋值＝預設淡化）、目錄拖移入列（enable-into-target 原子路徑＋
來源感知冪等清理＋落列播報）、全寬 sticky 預覽頂帶＋單一產出鈕
`<dialog>`、zh-Hant／en 雙語 i18n（20+ 域字典、五步序切換重繪）；
e2e 5→7 案（data-testid 錨點制）、測試 1454→1738 案。真機驗收
（T6.2-CHECKLIST）遞延至下個 sprint（BACKLOG 真機驗收批）。

sprint 06c（statusline-builder 目錄擴充＋前置加固）已交付：目錄
25→30 段（新增 token-in／token-out／cache-hit／reset-5h／reset-7d，
icon 沿用英文短 token 前綴體制）；百分比段新增 bar 正交欄
（`SegmentConfig.bar?: boolean`，靜態 4-run、null 值退化單 run）；
閾值雙模板（限額漸層／剩餘漸層逆序版，`context-remaining` 預設套
逆序版）；model／effort auto 配色（`SegmentColor` 新增
`{ kind: 'auto' }`，resolve 期展開為具體 ColorSpec、比對
`model.id`）；倒數段三後端實作＋ `now` 注入（`ResolveInput.now`，
產出腳本可選環境變數 `STATUSLINE_NOW_EPOCH`，缺席回落腳本端真時鐘）；
前置加固（引擎邊界補測、jsdom UI 回歸網、CDP 整合案重建）；新增
`scripts/e2e-statusline.mjs`＋`npm run test:e2e`（本機限定，不進
CI）。CONFIG_VERSION 維持 2（`bar`／`autoColor`／`expiresAtPath` 為
既有版本內選填擴充，不 bump）。

sprint 10（06 殘項批——主題即時同步、config 遷移階梯、verify-dist 測試網、
repo 衛生）已交付：主題即時同步（`src/theme.ts` 新增 `initThemeSync`，
matchMedia change／`window` storage 事件雙監聽，OS 偏好變更即時同步
toggle 鈕 `aria-pressed`、跨分頁 storage 切換／清除即時反映；跨分頁
storage 清除屬外部事件路徑，回跟隨系統、不改「對外僅雙態的 toggle
切換」既有取捨）；五頁（四工具頁＋`tools/_probe/`）`main.ts` 於
`initThemeToggle` 後接線 `initThemeSync`，入口頁 `<head>` inline script
增補等價 vanilla 邏輯並同步 `ENTRY_ALLOWED_INLINE_SCRIPTS` 白名單；
config 遷移階梯化（`MIGRATION_STEPS` 版本步進表＋while 鏈取代單次
if 判斷，缺步進版本回落 `defaultConfig()`、不 throw）＋v2 存檔 canary
回歸案（既有 `reference-7row.json`＋合成最小 v2 fixture，皆整份
deepEqual 把關，堵未來 CONFIG_VERSION bump 忘寫遷移步驟的資料損失
陷阱）；verify-dist 檢查邏輯抽為可 import 純函式
（`scripts/verify-dist-checks.mjs`，CLI 殼薄化為彙整輸出的殼層）＋
合成 dist fixture 正反向 39 案測試面，新增 `tsconfig.scripts.json`
納入 `npm run typecheck` 第三鏈，script 擷取 regex 收嚴（大小寫不
敏感、跳過 HTML 註解內容）；`.gitattributes` 補 `* text=auto` 全域
EOL 基線＋byte-exact／二進位資產顯式例外（golden `-text` 維持、
`*.jsonl eol=lf`、`*.apng`／`*.gif`／`*.mkv`／`*.webm`／`*.png` 標
`binary`），拋棄分支 renormalize 實證零額外 churn；README 補 powerline
關箭頭模式末段尾隨空格為契約行為之註記。CONFIG_VERSION 維持 2（本
sprint 純遷移機制重構，不新增遷移步驟）。

sprint 16（房間家具擺放規劃器）已交付第五個工具，也是首個以幾何互動為
核心的工具：SVG 畫布（floor／walls／items／doors／overlay 五圖層）＋Pointer
Events 拖移與鍵盤等效、矩形方塊組合非矩形房型（牆體正規化硬上限 200
條）、門迴旋區、純邏輯 clearance 引擎（遮擋子段、四段半開區間閾值、
門洞、各面需留）、預設家具庫、JSON／PNG 匯出；共用色彩純函式抽出為
`src/lib/color.ts`（statusline-builder 改薄 wrapper）。動工前先跑 M0
五支 spike（S1 clearance 基準／S2 CDP 拖移與 hash／S3 PNG 取樣順序／
S4 矩形差集對抗集／S9 對比管線），結論回寫 `PLAN.md` r3.2 並引出兩項
使用者裁決：家具硬上限 200 → **75**（S1 判定 (c)：200 件 p95 50.3 ms，
75 件落 (b)）＋「顯示距離」關閉時 `maxGap = adviseBelow` 預篩；overlay
節點預算三項全採（拖移期只畫 `narrow`＋碰撞、斜線改單一 `<path>`、
效能門檻由「1.5 ms」改為「單幀 ≤16.7 ms」）。`verify:dist` 新增
room-layout-planner 三格 gzip 體積斷言（JS 自家＋共享 chunk ≤45 KB、
CSS ≤8 KB、HTML ≤12 KB，KB＝1000；gzip level 9 為 brotli 的代理指標）。
M4 暫停點裁決新增使用者可調家具件數軟上限 `settings.maxItems`（預設 20、
硬上限 75）與 e2e 兩級單幀預算；URL hash 分享（OQ3）交付；M5 UX 回饋批
（2026-09-22 真機回饋）補畫布尺寸標註、門迴旋區可拖、獨立物件屬性欄
（skip-nav 四條）、按鈕系統與版面美化；review-code（2026-09-23，角度制
7 票）修復批對齊 D6／D7 未附著門保留、門洞雙向容差、預覽態不寫存檔。

sprint 17（公開發佈準備）：品牌改為 ClientKit（原 EZTools）——頁面標題／
返回連結／footer、README、產出腳本標頭同步；全站 7 把 localStorage key 於
站台首次上線前一次改名為 `clientkit-` 前綴（見 Conventions）；DEV 首次合入
`main`；快照發佈流程就緒（`npm run publish:public`，預設 dry-run、`--push`
才推送至公開鏡像 ClientKit；`git archive` 公開子集、秘密掃描與身分斷言
fail-closed），`deploy.yml` 兩 repo 同一份、job 以 repository 條件只在
ClientKit 側執行。2026-09-23 首次快照發佈（私有 `origin/main` `5cc5ded` →
ClientKit `main`），**Pages 已上線**：`https://alan60910.github.io/ClientKit/`
（專案路徑區分大小寫，小寫 `/clientkit/` 為 404）。
