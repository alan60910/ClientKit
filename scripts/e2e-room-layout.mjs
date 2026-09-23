#!/usr/bin/env node
/**
 * CDP 整合案（room-layout-planner 拖移／玄關實例／鍵盤全程／PNG 像素／
 * 分享生命週期／單幀預算回歸網）。
 *
 * 依據 `(internal design doc)` §Verification「`npm run
 * test:e2e`」五案＋§D10 render（OQ5 (3)：單幀 ≤16.7 ms @rate=4）追加的
 * 第六案，並照 §Decisions「e2e 腳本先複製殼、檔名
 * `scripts/e2e-room-layout.mjs`；key 常數自零 import 的 `storage-keys.ts`
 * import；`serialize.ts` 不被 e2e 直接 import」定案。
 *
 * **本檔的殼（基礎設施）逐字複製自 `scripts/e2e-statusline.mjs`**
 * （2026-09-21 讀取版本，約 L245-500／L2533-2869）：Node ≥22.18 版本閘門、
 * `EDGE_CANDIDATES`／`detectBrowser`、`stripAnsi`／`ensureBuilt`／
 * `startPreview`、`killProcessTree`／`sweepOrphanBrowser`、
 * `waitForEndpoint`／`waitForPageTarget`／`connectWs`／`makeClient`／
 * `launchBrowser`、`runCase`（逐案全新瀏覽器＋全新 `--user-data-dir`＋
 * `Emulation.setDeviceMetricsOverride`）、`Runtime.exceptionThrown` 監聽、
 * SUMMARY 列印與 exit code 語意。**差異僅四處設定值與一處刪除**：
 *   - `SCRATCH_ROOT`／`sweepOrphanBrowser` 的 marker 換成
 *     `eztools-e2e-room-layout-profiles`（orphan sweep 只掃本腳本開出的
 *     profile，不動同時並行的 statusline 跑批或使用者自己的瀏覽器）；
 *   - `ensureBuilt` 的 marker 換成 `dist/tools/room-layout-planner/index.html`；
 *   - 頁面網址換成 `${baseUrl}/tools/room-layout-planner/`、除錯埠自 9433 起算
 *     （statusline 自 9700 起算，兩支同時跑不撞）；
 *   - **不呼叫 `Input.setInterceptDrags`**：本工具的拖移是 Pointer Events
 *     （PLAN §D2），`sp2/REPORT.md`「方法論校準」第 3 點實測
 *     `Input.dispatchMouseEvent`（mousePressed→mouseMoved×N→mouseReleased）
 *     即可驅動整條 pointer 事件鏈，`setInterceptDrags`／`dispatchDragEvent`
 *     那組是 HTML5 原生 DnD 專屬管線，此處用不到也不該用。
 *
 * ── 八案（`CASES` 陣列為本工具案數的唯一事實來源，見 SPEC Conventions）──
 *
 *   1. `add-drag-narrow-second-drag`（PLAN e2e 案 1）：以加入表單建一件
 *      書桌 120×60 → 真拖曳（Pointer）到「東緣距東牆 30 cm」→ `report-list`
 *      恰一筆 `narrow` → 忽略值調 40 → 該筆消失（30 < 40 ⇒ 貼齊）→ **同一
 *      頁面**再加第二件並再拖一次，兩次位移皆生效（承接 sp2 案 2「同
 *      session 連續拖曳穩定」的結論）。全程 `window.scrollY` 不變
 *      （PLAN §Frontend「拖曳過程不得要求捲動」；拖曳前先斷言本頁**確實
 *      可捲**，否則「不變」是恆真的空斷言）。
 *   2. `vestibule-acceptance`（PLAN e2e 案 2；幾何取自 §D9「使用者玄關
 *      實例（釘死座標）」）：凹槽（extend [300,360]×[0,270]）＋門（鉸鏈
 *      (360,270)、`E`、`-`、70、內開）＋衣櫃（預設庫 `wardrobe-hinged`
 *      帶 `clearances.S=90`，尺寸覆寫為 200×60，加入後按一次 `R` 轉 90°、
 *      再以清單輸入落位 (300,0)）→ report 零 `narrow`／零碰撞／零 side／
 *      零 door、門洞恰一筆 → 關「顯示迴旋區」→ `#overlay-static` 無扇形
 *      → 衣櫃 ArrowDown 推 1 cm → 門違規恰一筆。
 *   3. `keyboard-only`（PLAN e2e 案 3）：Tab 走到畫布單一停點（斷言該節點
 *      `tabindex="0"`）→ `.` 切件 → 方向鍵 ×3 → 靜默期後清單 x 欄 +3 →
 *      `Delete` → 焦點落在該列「還原」鈕 → 真 Enter → 節點回到畫布。
 *      全程真實 CDP 鍵盤事件（`Input.dispatchKeyEvent`），不用
 *      `element.click()`／`element.focus()` 代打焦點路徑。
 *   4. `png-export-pixels`（PLAN e2e 案 4）：攔截下載（覆寫
 *      `URL.createObjectURL` 只記錄 `image/png` 的 Blob、`revokeObjectURL`
 *      與 `HTMLAnchorElement.prototype.click` 改 no-op）→ 匯出 → 把 PNG
 *      畫進 canvas → `getImageData` 取樣地板與家具兩點（非透明、非全黑、
 *      家具點與其 `fill` 色差 ≤8）＋`naturalWidth/naturalHeight` 與外接框
 *      等比（±1 px）＋與 `#export-scale` 的「1:N」互洽。
 *   5. `reload-and-share-preview`（PLAN e2e 案 5）：改值 → autosave →
 *      `Page.reload({ignoreCache:true})` → 值仍在；再造一份狀態 B 的分享
 *      連結（攔 `navigator.clipboard.writeText` 取 URL）、把 localStorage
 *      還原回狀態 A → `about:blank` 中繼 → 帶 `#plan=` 導覽 → 預覽態
 *      （「儲存為我的平面圖」現身、hash 已清、畫面是 B、localStorage 仍
 *      逐字是 A）→ 再 `about:blank` 中繼 → 不帶 hash → 回到 A。
 *      **`about:blank` 中繼是硬前提**（`sp2/REPORT.md`「方法論校準」第 1
 *      點：同文件只差一個 hash 的 `Page.navigate` 是 same-document 導覽，
 *      `DOMContentLoaded` 不重跑，hash 解析邏輯完全測不到）。
 *   6. `frame-budget-rate4`（PLAN §D10 render／OQ5 (3)）：600×800 房的密集
 *      fixture（欄距 40 cm／列距 50 cm，幾乎每一對都是 `narrow`），
 *      `Emulation.setCPUThrottlingRate {rate:4}` 下量測鍵盤拖移單步的
 *      JS＋style＋layout 成本。**斷言對象是 20 件**，雙門檻 p50 ≤16.7 ms
 *      且 p95 ≤25 ms（2026-09-22 使用者裁決：三輪量測 p95 17.9／15.2／
 *      16.2 ms 在單一 16.7 ms 門檻下邊界閃爍，改採雙軌吸收尾端抖動），
 *      同案再以 40 件量一次但**只列印不斷言**（`info:` 行）。
 *      **迴圈整段留在頁面內、一次 `Runtime.evaluate` 取回整組樣本**
 *      （PLAN §Implementation notes「M0 實作注意」：逐迭代往返會量到
 *      harness 本身且隨負載惡化）。量完再等靜默期 commit，並斷言家具
 *      確實走了 30 cm——否則「很快」可能只是因為每一步都被夾框擋掉。
 *   7. `frame-budget-rate4-max-items`（同上，上限側）：75 件
 *      （`model.ts` `LIMITS.items`／`settings.maxItems` 硬上限）同一量測式，
 *      斷言 p95 **< 100 ms**（RAIL「perceived-instant」門檻）。60 fps 只適用
 *      實務單房件數；上限側改以「不掉出即時感」把關。
 *   8. `door-drag-along-wall`（T5.2／TASKS M5 回饋 2）：玄關 seed → 以真
 *      指標抓**迴旋區扇形內**的一點（鉸鏈 −20,−20 cm，只落在透明命中區
 *      上、不在門扇線上）沿東牆往北拖 30 cm → 門節點 `data-y` 自 270 →
 *      ≈240（±5，經極大牆段磁吸與 reducer 的 D6 驗證）、`data-x` 仍 360、
 *      `#status` 播報「門已移至」。起點另斷言 `elementFromPoint` 命中的是
 *      `.door-hit`（`data-part` 為 `hit-swing`／`hit-leaf`）——否則測到的
 *      不是命中區。
 *
 * ── 本腳本刻意不做的事 ──
 *
 * - **不 import `serialize.ts`**（PLAN §Decisions I-13）：seed 一律是本檔
 *   手寫的 plan 物件經 `JSON.stringify` 寫進 `localStorage`，載入時由產品碼
 *   自己的 `parsePlan()` 清洗——這正是要驗的那條路徑。
 * - **不 import `geometry.ts`**：cm ↔ 螢幕 px 的換算改用瀏覽器自己的
 *   `SVGGraphicsElement.getScreenCTM()`（viewBox＋`preserveAspectRatio`
 *   皆已內含），故 harness 端**零**幾何公式重寫，不存在 `sp2/REPORT.md`
 *   擔心的「兩處算法漂移」。
 * - **不依賴 rAF**：PLAN §Implementation notes 記載 headless=new 下 rAF
 *   幾乎不觸發。本工具 `drag.ts` 的 `pointerup` 會同步補套最後一筆未決
 *   位移（`onPointerUp` 的 `flush` 分支），故落點不靠 rAF；本腳本的拖曳
 *   斷言一律針對 commit 後的**資料**（清單列摘要文字與節點 `data-x`），不對
 *   拖曳中的中間影格下斷言。
 * - **不用 `Page.captureScreenshot`**（同上，第二張後會掛）。
 *
 * 用法：
 *   node scripts/e2e-room-layout.mjs      # 或 npm run test:e2e（兩支依序）
 *   E2E_HEADED=1 node scripts/e2e-room-layout.mjs   # 人工除錯用 headed
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

// 比照 `e2e-statusline.mjs`（MAGI review 🟡-2）：`import '...storage-keys.ts'`
// 這種 static import 在 ESM 規範下一律 hoist 到模組頂端求值，早於模組主體
// 任何一行程式碼，故「import 之後再檢查版本」無效。改為 import 前先手動
// 解析 `process.versions.node`，未達門檻即印友善訊息＋`exit(1)`，通過後才
// 以 top-level await 動態 import。
const [nodeMajorStr, nodeMinorStr] = process.versions.node.split('.')
const nodeMajor = Number(nodeMajorStr)
const nodeMinor = Number(nodeMinorStr)
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 18)) {
  console.error(
    `[e2e] 本腳本需 Node ≥22.18（.ts type stripping 預設啟用）；偵測到 v${process.versions.node}`,
  )
  process.exit(1)
}

// PLAN §D7／§Decisions（I-13）：localStorage 兩把 key 的**單一出口**——
// 直接 import `tools/room-layout-planner/storage-keys.ts`（該檔檔頭明文
// 「零相依硬約束」正是為了讓本腳本在 Node 型別剝離下直接載入），不在本檔
// 字面重複一份 key 字串。`serialize.ts` 有相對載入語法，**不得**於此 import。
const { STORAGE_KEY, BACKUP_KEY } = await import(
  '../tools/room-layout-planner/storage-keys.ts'
)

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
/** orphan sweep 的比對 marker：只掃本腳本開出的 profile（見 `sweepOrphanBrowser`）。 */
const PROFILE_MARKER = 'eztools-e2e-room-layout-profiles'
const SCRATCH_ROOT = join(tmpdir(), PROFILE_MARKER)
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
  const marker = join(REPO_ROOT, 'dist', 'tools', 'room-layout-planner', 'index.html')
  if (existsSync(marker)) {
    console.log('[e2e] dist/ already built (found tools/room-layout-planner/index.html) — skipping build.')
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
 * 最終掃尾（`e2e-statusline.mjs` 檔頭記載的 sp8 PoC 實測發現：
 * `taskkill /PID <pid> /T /F` 未必能清掉 Chromium 分離出的輔助行程，如
 * crashpad handler——這類行程刻意不在 OS 記錄的親子關係樹內，`/T` 找不到）：
 * 以 command line 是否含本次 `PROFILE_MARKER` 為準，逐一強制關閉殘留的
 * 瀏覽器行程——**只掃本腳本開出的 profile**，不動 statusline 那支同時跑批
 * 開的視窗，更不動使用者自己開著的瀏覽器。僅 best-effort，靜默失敗
 * （非 Windows 平台略過）。
 */
function sweepOrphanBrowser() {
  if (process.platform !== 'win32') return
  const script = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${PROFILE_MARKER}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
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
    args.push('--window-position=2400,50', `--window-size=${viewport.width},${viewport.height}`)
  }
  args.push(url)
  return spawn(browserPath, args, { stdio: 'ignore' })
}

/**
 * 預設 viewport。1400×1000 使桌面版面（`style.css` `@media (min-width:1100px)`
 * 兩欄 grid）生效，且 `.board`（`aspect-ratio: 3/4`、`max-height: 80dvh`）
 * 完整落在視窗內——案 1／2 的真拖曳座標即依賴這一點（座標算出來後仍會逐點
 * 斷言落在 viewport 內，不靠這段註解背書）。
 */
const DEFAULT_VIEWPORT = { width: 1400, height: 1000 }

// ── 頁面錨點與純資料 fixture ───────────────────────────────────────────
//
// PLAN §Verification：「e2e 一律走 `data-testid`、不依賴可見文字」。畫布
// 節點的 testid 由 `board.ts` `createNodeShell` 寫成 `{kind}-{id}`（如
// `item-f01`），清單列由 `panel.ts` 寫成 `item-row-{id}`。
//
// **T5.3 後清單列不再內嵌任何輸入欄**（可編輯屬性搬到 `props.ts` 的
// `#props-section`），故本腳本對「某件家具的 x」只有兩條路徑：
//   - **讀**：`[data-testid="item-row-<id>-pos"]` 的摘要文字
//     `{w_eff}×{d_eff}，({x},{y})`（`messages.ui.list.itemSummary`），由
//     `itemPosExpr()`／`readItemPos()` 以 regex 解析——不必選取、不動焦點，
//     故案 1（scrollY 不變）與案 3（全程真鍵盤）都能安全使用。
//   - **寫**：先點 `[data-testid="select-<id>"]`（`selectItem()`）讓
//     `#props-item` 現身，再對 `[data-testid="props-item-<field>"]` 設值並
//     派發 `change`（`setItemProp()`；`props.ts` 零 `input` 監聽）。
// 旋轉角同理只能走屬性欄的 `props-item-rotation`——`board.ts` 的節點不寫
// `data-rotation`，清單列也已無 select。

const SVG_SEL = '[data-testid="board-svg"]'

/** 預設 settings（`model.ts` `DEFAULT_SETTINGS`，seed 用）。 */
const SETTINGS = { ignoreBelow: 5, warnBelow: 60, adviseBelow: 75, snap: 5, showSwing: true }

/** 空的預設平面圖（`model.ts` `defaultPlan()` 的等價 JSON）。 */
function emptyPlan() {
  return {
    version: 1,
    room: { width: 300, depth: 400, blocks: [], doors: [] },
    items: [],
    settings: { ...SETTINGS },
  }
}

function furniture(id, name, width, depth, x, y, extra = {}) {
  return {
    id,
    name,
    color: '#9db4d6',
    width,
    depth,
    x,
    y,
    rotation: 0,
    passable: true,
    ...extra,
  }
}

/**
 * seed 一份平面圖到 `localStorage[STORAGE_KEY]`（key 自 `storage-keys.ts`
 * import，本檔零字面重複）。**刻意順手清掉 `BACKUP_KEY`**：逐案皆全新
 * profile，但把兩把 key 的起手式都寫明比「相信 profile 是乾淨的」更禁得起
 * 日後改動。寫入的是**未經 `parsePlan` 的原始字串**——載入時由產品碼自己
 * 清洗，正是 PLAN §D7「四條載入路徑全部經同一 `parsePlan()`」要驗的路徑。
 */
function seedPlanExpr(plan) {
  return `
    (() => {
      localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(plan))});
      localStorage.removeItem(${JSON.stringify(BACKUP_KEY)});
      return 'seeded';
    })()
  `
}

/** 讀 `localStorage[STORAGE_KEY]` 原始字串（`null` 代表沒有存檔）。 */
const READ_STORED_EXPR = `localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`

/**
 * 捲動取樣式：`window.scrollY` ＋ 三個可能自成捲動容器的分區 `scrollTop`
 * （`style.css` 桌面版把 `#board-section` 設成 `overflow:auto`）。案 1 的
 * 判準是 `window.scrollY`（PLAN 明文），其餘欄位一併取樣只為失敗時能指出
 * 「到底是誰捲了」，不另立斷言。
 */
const SCROLL_SAMPLE_EXPR = `
  (() => ({
    scrollY: window.scrollY,
    board: document.querySelector('[data-testid="board-section"]')?.scrollTop ?? null,
    report: document.querySelector('[data-testid="report-list"]')?.scrollTop ?? null,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
  }))()
`

/** report-list 目前頁面上各 `kind` 的筆數＋分頁狀態（`report-list.ts` 的 class 契約）。 */
const REPORT_COUNT_EXPR = `
  (() => {
    const list = document.querySelector('[data-testid="report-list"]');
    const counts = {};
    for (const li of list.querySelectorAll('li')) {
      for (const cls of li.classList) {
        if (!cls.startsWith('report-entry--')) continue;
        const kind = cls.slice('report-entry--'.length);
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
    const pager = document.querySelector('[data-testid="report-pager"]');
    return { counts, total: list.children.length, paged: pager !== null && !pager.hidden };
  })()
`

/**
 * 清單列的位置摘要——T5.3 後列上唯一的數值出口。`panel.ts`
 * `updateItemRow` 把 `messages.ui.list.itemSummary` 寫成
 * `` `${w_eff}×${d_eff}，(${x},${y})` ``（寬深取**有效**外框，旋轉 90／270
 * 時互換），故 x/y 與有效寬深各以一條 regex 取出，皆回傳**字串**
 * （與舊的 `input.value` 同型，既有比對式不必改寫）。
 */
function itemPosExpr(id) {
  const sel = JSON.stringify(`[data-testid="item-row-${id}-pos"]`)
  return `
    (() => {
      const el = document.querySelector(${sel});
      if (el === null) return { ok: false, present: false, text: null, x: null, y: null, w: null, d: null };
      const text = el.textContent ?? '';
      const coords = /\\((-?\\d+),\\s*(-?\\d+)\\)/.exec(text);
      const size = /^\\s*(\\d+)×(\\d+)/.exec(text);
      return {
        ok: coords !== null && size !== null,
        present: true,
        text,
        x: coords === null ? null : coords[1],
        y: coords === null ? null : coords[2],
        w: size === null ? null : size[1],
        d: size === null ? null : size[2],
      };
    })()
  `
}

/** 家具節點與清單列兩邊的座標（兩條路徑應一致；不一致即 render 漏了一邊）。 */
function itemStateExpr(id) {
  const q = JSON.stringify(`[data-testid="item-${id}"]`)
  const row = JSON.stringify(`[data-testid="item-row-${id}"]`)
  return `
    (() => {
      const node = document.querySelector(${q});
      const li = document.querySelector(${row});
      const pos = ${itemPosExpr(id)};
      return {
        nodePresent: node !== null,
        nodeX: node === null ? null : Number(node.getAttribute('data-x')),
        nodeY: node === null ? null : Number(node.getAttribute('data-y')),
        rowPresent: li !== null,
        rowText: pos.text,
        rowX: pos.x,
        rowY: pos.y,
        rowWidth: pos.w,
        rowDepth: pos.d,
      };
    })()
  `
}

/**
 * 以瀏覽器自己的 `getScreenCTM()` 把「家具目前中心」與「目標中心」換成
 * viewport px（PLAN §D1 座標系；`sp2/REPORT.md` 建議的「不得在 harness
 * 裡另寫一份 fit 公式」——此處連公式都沒有，直接問瀏覽器）。
 *
 * 一併回傳三項前提檢查，讓失敗時的 symptom 直接指出原因，而不是變成
 * 「拖了但沒動」這種沒有資訊量的斷言失敗：
 *   - 兩點皆落在 viewport 內（否則 CDP 送出的滑鼠事件打不到任何東西）；
 *   - 起點的 `elementFromPoint` 命中的正是這件家具（overlay 蓋住起點時
 *     `pointerdown` 的 `closest('[data-kind][data-id]')` 會是 null，拖移
 *     根本不會開始）；
 *   - `scale`（px/cm）回報出來，供 symptom 佐證。
 */
function dragPlanExpr(id, targetX, targetY) {
  const q = JSON.stringify(`[data-testid="item-${id}"]`)
  return `
    (() => {
      const svg = document.querySelector(${JSON.stringify(SVG_SEL)});
      const node = document.querySelector(${q});
      if (svg === null) return { ok: false, symptom: 'board svg not found' };
      if (node === null) return { ok: false, symptom: 'item node ' + ${q} + ' not found' };
      const rect = node.querySelector('rect');
      if (rect === null) return { ok: false, symptom: 'item node has no <rect> child' };
      const m = svg.getScreenCTM();
      if (m === null) return { ok: false, symptom: 'getScreenCTM() returned null (svg not rendered)' };
      const x0 = Number(rect.getAttribute('x'));
      const y0 = Number(rect.getAttribute('y'));
      const w = Number(rect.getAttribute('width'));
      const h = Number(rect.getAttribute('height'));
      const toScreen = (cx, cy) => ({ x: m.a * cx + m.c * cy + m.e, y: m.b * cx + m.d * cy + m.f });
      const from = toScreen(x0 + w / 2, y0 + h / 2);
      const to = toScreen(${targetX} + w / 2, ${targetY} + h / 2);
      const inView = (p) => p.x >= 1 && p.y >= 1 && p.x <= window.innerWidth - 2 && p.y <= window.innerHeight - 2;
      if (!inView(from) || !inView(to)) {
        return { ok: false, symptom: 'drag endpoints outside viewport: from=' + JSON.stringify(from) + ' to=' + JSON.stringify(to) + ' viewport=' + window.innerWidth + 'x' + window.innerHeight };
      }
      const hit = document.elementFromPoint(Math.round(from.x), Math.round(from.y));
      const owner = hit === null ? null : hit.closest('[data-kind][data-id]');
      if (owner === null || owner.getAttribute('data-id') !== ${JSON.stringify(id)}) {
        return { ok: false, symptom: 'elementFromPoint at drag origin hits ' + (owner === null ? String(hit && hit.tagName) : owner.getAttribute('data-testid')) + ', not item ' + ${JSON.stringify(id)} };
      }
      return { ok: true, from, to, scale: m.a, current: { x: x0, y: y0 }, size: { w, h } };
    })()
  `
}

/**
 * 設一個表單控件的值並派發 `input`＋`change`（產品碼一律只在 `change`
 * 才 dispatch，見 PLAN §D10「數值輸入掛 `change` 才 dispatch」）。
 *
 * **刻意不走真滑鼠／鍵盤輸入**：本工具的設定欄位在桌面版面裡位於左欄下段，
 * 真點擊必須先 `scrollIntoView`，而案 1 的判準正是「`window.scrollY` 不變」
 * ——用真點擊填表單會在測「不變」之前先把頁面捲掉，汙染訊號。焦點行為本身
 * 不是這幾案的斷言標的（案 3 才是，那一案全程走真鍵盤）。
 */
function setValueExpr(selector, value) {
  return `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return { ok: false, symptom: 'control not found: ' + ${JSON.stringify(selector)} };
      el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: el.value };
    })()
  `
}

function clickExpr(selector) {
  return `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return { ok: false, symptom: 'element not found: ' + ${JSON.stringify(selector)} };
      el.click();
      return { ok: true };
    })()
  `
}

/** 勾選一個 radio 並派發 `change`（`panel.ts` `syncKindFields` 掛在 `change`）。 */
function checkRadioExpr(selector) {
  return `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return { ok: false, symptom: 'radio not found: ' + ${JSON.stringify(selector)} };
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()
  `
}

/**
 * 讀一件家具的清單列摘要（不選取、不動焦點）。回傳
 * `{ ok, present, text, x, y, w, d }`，數值皆為字串。
 */
function readItemPos(evaluate, id) {
  return evaluate(itemPosExpr(id))
}

/**
 * 選取一件家具：點清單列的「選取」鈕（`panel.ts` `wireItemRow` →
 * `host.setUi({ selectedId })` ＋ `focusBoardNode`），`setUi()` 內同步
 * `render()`，故回來時 `#props-item` 必已顯示這件的屬性。
 *
 * **屬性欄只服務 `ui.selectedId`**（`props.ts` `current()`）——任何對
 * `#props-item-*` 的寫入都必須先經過這裡，否則 `itemId()` 為 null、
 * change 監聽直接 return，症狀會變成「設了值但什麼都沒發生」。
 */
async function selectItem(evaluate, id) {
  const clicked = await evaluate(clickExpr(`[data-testid="select-${id}"]`))
  if (!clicked.ok) return { ok: false, symptom: `selectItem(${id}): ${clicked.symptom}` }
  const shown = await evaluate(`
    (() => {
      const form = document.querySelector('[data-testid="props-item"]');
      if (form === null) return { ok: false, symptom: '#props-item form not found' };
      if (form.hidden) return { ok: false, symptom: '#props-item is still hidden after clicking the row select button' };
      return { ok: true };
    })()
  `)
  if (!shown.ok) return { ok: false, symptom: `selectItem(${id}): ${shown.symptom}` }
  return { ok: true }
}

/**
 * 改一件家具的一個屬性：選取 → 對 `[data-testid="props-item-<field>"]`
 * 設值＋派發 `change`（`props.ts` 零 `input` 監聽，`change` 才 dispatch）
 * → 確認 `#props-error` 仍空（被驗證或 reducer 擋下時它會有字，值不會生效）。
 */
async function setItemProp(evaluate, id, field, value) {
  const selected = await selectItem(evaluate, id)
  if (!selected.ok) return selected
  const written = await evaluate(setValueExpr(`[data-testid="props-item-${field}"]`, value))
  if (!written.ok) return written
  const rejected = await evaluate(`document.querySelector('[data-testid="props-error"]').textContent`)
  if (rejected !== '') {
    return { ok: false, symptom: `setting ${field}=${value} on ${id} was rejected: #props-error = ${JSON.stringify(rejected)}` }
  }
  return { ok: true }
}

/** 目前畫布上所有可拖移節點的 `data-kind`／`data-id`（DOM 序＝資料序）。 */
const NODES_EXPR = `
  [...document.querySelectorAll(${JSON.stringify(SVG_SEL)} + ' [data-kind][data-id]')].map((el) => ({
    kind: el.getAttribute('data-kind'),
    id: el.getAttribute('data-id'),
    tabindex: el.getAttribute('tabindex'),
  }))
`

/** 目前焦點元素的身分（供案 3 的逐步斷言；SVG 元素亦有 `closest`）。 */
const ACTIVE_EXPR = `
  (() => {
    const a = document.activeElement;
    if (a === null) return null;
    return {
      tag: a.tagName,
      id: a.id || null,
      testid: a.getAttribute ? a.getAttribute('data-testid') : null,
      dataId: a.getAttribute ? a.getAttribute('data-id') : null,
      tabindex: a.getAttribute ? a.getAttribute('tabindex') : null,
      inBoard: !!(a.closest && a.closest(${JSON.stringify(SVG_SEL)})),
    };
  })()
`

// ── 案 1 ───────────────────────────────────────────────────────────────

/**
 * PLAN §Verification e2e 案 1。幾何推演（房 300×400、書桌 120×60、
 * 三閾值 5／60／75、網格 5）：
 *
 * - 拖到 x=150 ⇒ 東緣 270、距東框 30 cm ⇒ 落在 `[ignoreBelow, warnBelow)`
 *   ⇒ **`narrow`**（D3 四段半開區間）。
 * - 「顯示距離」預設關閉 ⇒ `maxGap = adviseBelow = 75` 預篩（D4 兩路徑）：
 *   西框 150 cm／南框 340 cm 兩條 `ok` 通道根本不產出；北框 gap 0 是
 *   `touch`，而 `touch` 只在「顯示距離」開啟時才列進清單（report-list.ts
 *   `render()`）。故清單上**恰好一筆**，就是那筆 `narrow`。
 * - 忽略值調到 40 ⇒ 30 < 40 ⇒ 改判 `touch` ⇒ 清單清空（同上，`touch`
 *   不列）。三閾值三元組 40/60/75 合法（`0 ≤ ignore ≤ warn ≤ advise`）。
 * - 刻意用**自訂**家具（`#add-preset` 留空）而非預設庫的「書桌」：後者帶
 *   `clearances.S = 75`，會讓清單多出 side 相關筆數，模糊「恰一筆」的判準。
 *   預設庫路徑由案 2 覆蓋。
 */
const caseAddDragNarrowSecondDrag = {
  id: 'add-drag-narrow-second-drag',
  label: '案 1：加入→拖到牆邊→narrow→調忽略值→消失→同頁第二次拖移',
  seed: emptyPlan(),
  async run({ evaluate, pointerDrag, delayFn }) {
    const base = await evaluate(SCROLL_SAMPLE_EXPR)
    if (!(base.maxScroll > 0)) {
      return { ok: false, symptom: `page is not scrollable (maxScroll=${base.maxScroll}); the "scrollY unchanged" assertion would be vacuous` }
    }

    // ── 第一件家具 ──
    const add1 = await addCustomItem(evaluate, { name: '書桌', width: 120, depth: 60, x: 0, y: 0 })
    if (!add1.ok) return add1
    const id1 = add1.id
    const before1 = await evaluate(itemStateExpr(id1))
    if (before1.nodeX !== 0) {
      return { ok: false, symptom: `item 1 should start at x=0, got ${before1.nodeX}` }
    }

    // ── 拖到東緣距東牆 30 cm（x=150）──
    const plan1 = await evaluate(dragPlanExpr(id1, 150, 0))
    if (!plan1.ok) return { ok: false, symptom: `drag 1 setup: ${plan1.symptom}` }
    const drag1 = await pointerDrag(plan1.from, plan1.to, { sampleExpr: SCROLL_SAMPLE_EXPR })
    const scrollBad = drag1.samples.find((s) => s.value.scrollY !== base.scrollY)
    if (scrollBad !== undefined) {
      return { ok: false, symptom: `window.scrollY changed during drag 1 at stage "${scrollBad.stage}": ${base.scrollY} → ${scrollBad.value.scrollY} (samples: ${JSON.stringify(drag1.samples)})` }
    }
    await delayFn(300)
    const after1 = await evaluate(itemStateExpr(id1))
    if (after1.nodeX !== 150 || after1.nodeY !== 0) {
      return { ok: false, symptom: `drag 1 landed at (${after1.nodeX},${after1.nodeY}), expected (150,0) — scale was ${plan1.scale} px/cm, from=${JSON.stringify(plan1.from)} to=${JSON.stringify(plan1.to)}` }
    }
    // 清單側的對照讀取走列摘要文字（T5.3 後列上已無輸入欄）。
    const rowAfter1 = await readItemPos(evaluate, id1)
    if (rowAfter1.x !== '150') {
      return { ok: false, symptom: `list row x for item 1 is "${rowAfter1.x}", expected "150" (canvas and list disagree); summary=${JSON.stringify(rowAfter1.text)}` }
    }

    // ── report-list 恰一筆 narrow ──
    const report1 = await evaluate(REPORT_COUNT_EXPR)
    if (report1.paged) {
      return { ok: false, symptom: `report-list is paginated (${report1.total} rows on page 1); per-class counts below would be incomplete` }
    }
    if (report1.total !== 1 || (report1.counts.narrow ?? 0) !== 1) {
      return { ok: false, symptom: `expected exactly one narrow entry, got total=${report1.total} counts=${JSON.stringify(report1.counts)}` }
    }

    // ── 忽略值 5 → 40 ⇒ 30 cm 改判 touch ⇒ 清單清空 ──
    const setIgnore = await evaluate(setValueExpr('[data-testid="th-ignore"]', 40))
    if (!setIgnore.ok) return setIgnore
    await delayFn(250)
    const thError = await evaluate(`document.querySelector('[data-testid="th-error"]').textContent`)
    if (thError !== '') {
      return { ok: false, symptom: `threshold 40/60/75 was rejected: #th-error = ${JSON.stringify(thError)}` }
    }
    const report2 = await evaluate(REPORT_COUNT_EXPR)
    if (report2.total !== 0) {
      return { ok: false, symptom: `after raising ignoreBelow to 40 the narrow entry should disappear, but report-list still has ${report2.total} row(s): ${JSON.stringify(report2.counts)}` }
    }

    // ── 同一頁面：第二件家具再拖一次（sp2 案 2「同 session 連續拖曳」）──
    const add2 = await addCustomItem(evaluate, { name: '椅子', width: 80, depth: 50, x: 0, y: 200 })
    if (!add2.ok) return add2
    const id2 = add2.id
    if (id2 === id1) return { ok: false, symptom: 'second add did not create a new item' }
    const before2 = await evaluate(itemStateExpr(id2))
    if (before2.nodeX !== 0 || before2.nodeY !== 200) {
      return { ok: false, symptom: `item 2 should start at (0,200), got (${before2.nodeX},${before2.nodeY})` }
    }

    const base2 = await evaluate(SCROLL_SAMPLE_EXPR)
    const plan2 = await evaluate(dragPlanExpr(id2, 100, 200))
    if (!plan2.ok) return { ok: false, symptom: `drag 2 setup: ${plan2.symptom}` }
    const drag2 = await pointerDrag(plan2.from, plan2.to, { sampleExpr: SCROLL_SAMPLE_EXPR })
    const scrollBad2 = drag2.samples.find((s) => s.value.scrollY !== base2.scrollY)
    if (scrollBad2 !== undefined) {
      return { ok: false, symptom: `window.scrollY changed during drag 2 at stage "${scrollBad2.stage}": ${base2.scrollY} → ${scrollBad2.value.scrollY}` }
    }
    await delayFn(300)

    // ── 兩次位移皆生效（兩件家具的清單 x 欄都已離開加入時的值）──
    const final1 = await evaluate(itemStateExpr(id1))
    const final2 = await evaluate(itemStateExpr(id2))
    if (final1.rowX !== '150') {
      return { ok: false, symptom: `item 1 x regressed after the second drag: "${final1.rowX}" (expected "150")` }
    }
    if (final2.nodeX === 0 || final2.rowX === '0') {
      return { ok: false, symptom: `second drag had no effect: item 2 still at x=${final2.nodeX} (row "${final2.rowX}")` }
    }
    if (final2.nodeY !== 200) {
      return { ok: false, symptom: `second drag moved item 2 off its row: y=${final2.nodeY} (expected 200)` }
    }
    return { ok: true }
  },
}

/**
 * 以「加入家具」表單建一件自訂家具，回傳新家具的 id。
 *
 * id 取法＝送出前後 `[data-kind="item"]` 集合的差集——不依賴「最後一個節點
 * 就是新的」這種順序假設（`board.ts` 的 `orderChildren` 只保證 DOM 序＝資料
 * 序，資料序本身在還原／刪除路徑下會偏離建立序）。
 */
async function addCustomItem(evaluate, { name, width, depth, x, y }) {
  const idsBefore = await evaluate(NODES_EXPR)
  const steps = [
    checkRadioExpr('[data-testid="add-kind-item"]'),
    setValueExpr('[data-testid="add-preset"]', ''),
    setValueExpr('[data-testid="add-name"]', name),
    setValueExpr('[data-testid="add-width"]', width),
    setValueExpr('[data-testid="add-depth"]', depth),
    setValueExpr('[data-testid="add-x"]', x),
    setValueExpr('[data-testid="add-y"]', y),
  ]
  for (const step of steps) {
    const result = await evaluate(step)
    if (!result.ok) return result
  }
  const clicked = await evaluate(clickExpr('[data-testid="btn-add"]'))
  if (!clicked.ok) return clicked
  const addError = await evaluate(`document.querySelector('[data-testid="add-error"]').textContent`)
  if (addError !== '') {
    return { ok: false, symptom: `add form rejected "${name}": #add-error = ${JSON.stringify(addError)}` }
  }
  const idsAfter = await evaluate(NODES_EXPR)
  const known = new Set(idsBefore.map((n) => n.id))
  const fresh = idsAfter.filter((n) => n.kind === 'item' && !known.has(n.id))
  if (fresh.length !== 1) {
    return { ok: false, symptom: `expected exactly one new item node after adding "${name}", got ${fresh.length} (before=${idsBefore.length}, after=${idsAfter.length})` }
  }
  return { ok: true, id: fresh[0].id }
}

// ── 案 2 ───────────────────────────────────────────────────────────────

/**
 * PLAN §Verification e2e 案 2＋§D9「使用者玄關實例（釘死座標）」。
 *
 * 建法刻意全走 UI（加入表單＋`R` 鍵＋清單輸入），不 seed 現成的 plan：
 * 這一案的價值正在於「使用者照著做得出來」，而不只是「引擎對這份 JSON
 * 算得對」（後者由 `clearance.test.ts` 的玄關正案／反向案覆蓋）。
 *
 * 衣櫃走**預設庫** `wardrobe-hinged`（帶 `clearances.S = 90`），尺寸再覆寫
 * 為 D9 釘死的 200×60——若用自訂家具，`sideViolations` 為 0 會變成空斷言
 * （沒有任何需留面可違規）。按一次 `R` ⇒ `rotation:90` ⇒ 有效外框 60 寬
 * 200 深；區域 S 面經順時針映射為世界 **W**，唯一配對是西框、間距 300 ≥ 90
 * ⇒ 零 side。
 *
 * 期望 report（D9「期望 report」段，扣掉被 `maxGap` 預篩掉的 `ok` 與不列的
 * `touch`）：清單上恰一筆，`kind` 為 `doorway`。
 */
const caseVestibuleAcceptance = {
  id: 'vestibule-acceptance',
  label: '案 2：玄關實例（凹槽＋門＋衣櫃 R）零警示／門洞一筆／關迴旋區／推 1 cm 出門違規',
  seed: emptyPlan(),
  async run({ evaluate, clickNode, pressKey, delayFn }) {
    // ── 凹槽（extend [300,360]×[0,270]）──
    for (const step of [
      checkRadioExpr('[data-testid="add-kind-extend"]'),
      setValueExpr('[data-testid="add-width"]', 60),
      setValueExpr('[data-testid="add-depth"]', 270),
      setValueExpr('[data-testid="add-x"]', 300),
      setValueExpr('[data-testid="add-y"]', 0),
      clickExpr('[data-testid="btn-add"]'),
    ]) {
      const result = await evaluate(step)
      if (!result.ok) return result
    }
    await delayFn(200)
    const afterBlock = await evaluate(NODES_EXPR)
    if (afterBlock.filter((n) => n.kind === 'block').length !== 1) {
      const err = await evaluate(`document.querySelector('[data-testid="add-error"]').textContent`)
      return { ok: false, symptom: `extend block was not added (#add-error=${JSON.stringify(err)}); nodes=${JSON.stringify(afterBlock)}` }
    }

    // ── 門（鉸鏈 (360,270)、leafDir '-'、寬 70、內開；`wall` 由 x,y 推導）──
    for (const step of [
      checkRadioExpr('[data-testid="add-kind-door"]'),
      setValueExpr('[data-testid="add-width"]', 70),
      setValueExpr('[data-testid="add-x"]', 360),
      setValueExpr('[data-testid="add-y"]', 270),
      setValueExpr('[data-testid="add-door-leafdir"]', '-'),
      setValueExpr('[data-testid="add-door-swing"]', 'in'),
      clickExpr('[data-testid="btn-add"]'),
    ]) {
      const result = await evaluate(step)
      if (!result.ok) return result
    }
    await delayFn(200)
    const afterDoor = await evaluate(NODES_EXPR)
    if (afterDoor.filter((n) => n.kind === 'door').length !== 1) {
      const err = await evaluate(`document.querySelector('[data-testid="add-error"]').textContent`)
      return { ok: false, symptom: `door was not added (#add-error=${JSON.stringify(err)}); nodes=${JSON.stringify(afterDoor)}` }
    }

    // ── 衣櫃：預設庫 `wardrobe-hinged` ＋尺寸覆寫 200×60 ──
    const before = await evaluate(NODES_EXPR)
    for (const step of [
      checkRadioExpr('[data-testid="add-kind-item"]'),
      setValueExpr('[data-testid="add-preset"]', 'wardrobe-hinged'),
      setValueExpr('[data-testid="add-width"]', 200),
      setValueExpr('[data-testid="add-depth"]', 60),
      setValueExpr('[data-testid="add-x"]', 300),
      setValueExpr('[data-testid="add-y"]', 0),
      clickExpr('[data-testid="btn-add"]'),
    ]) {
      const result = await evaluate(step)
      if (!result.ok) return result
    }
    await delayFn(200)
    const after = await evaluate(NODES_EXPR)
    const known = new Set(before.map((n) => n.id))
    const fresh = after.filter((n) => n.kind === 'item' && !known.has(n.id))
    if (fresh.length !== 1) {
      const err = await evaluate(`document.querySelector('[data-testid="add-error"]').textContent`)
      return { ok: false, symptom: `wardrobe was not added (#add-error=${JSON.stringify(err)}); fresh=${JSON.stringify(fresh)}` }
    }
    const wardrobe = fresh[0].id

    // ── 按一次 R（真鍵盤；焦點先以真滑鼠點擊取得，走 drag.ts 的
    //    `pointerdown → node.el.focus()` 正規路徑）──
    const focused = await clickNode(wardrobe)
    if (!focused.ok) return focused
    await pressKey({ key: 'r', code: 'KeyR', text: 'r', vk: 82 })
    await delayFn(250)
    // 旋轉角唯一的讀取出口是屬性欄的 `#props-item-rotation`：畫布節點不寫
    // `data-rotation`，清單列 T5.3 後也不再有 select。`clickNode` 已把
    // `ui.selectedId` 設成衣櫃，這裡再點一次列上的「選取」鈕把前提寫明。
    const selected = await selectItem(evaluate, wardrobe)
    if (!selected.ok) return selected
    const rotation = await evaluate(`document.querySelector('[data-testid="props-item-rotation"]').value`)
    if (rotation !== '90') {
      return { ok: false, symptom: `R did not rotate the wardrobe: #props-item-rotation="${rotation}" (expected "90")` }
    }
    // 佐證：列摘要取的是**有效**外框，90° 下 200×60 應已互換成 60×200。
    const rotatedPos = await readItemPos(evaluate, wardrobe)
    if (rotatedPos.w !== '60' || rotatedPos.d !== '200') {
      return { ok: false, symptom: `rotated wardrobe should summarise as 60×200, got ${JSON.stringify(rotatedPos.text)}` }
    }

    // ── 落位 (300,0)（加入時 x=300 會被夾框推回，D9 座標由屬性欄補正）──
    for (const [field, value] of [['x', 300], ['y', 0]]) {
      const result = await setItemProp(evaluate, wardrobe, field, value)
      if (!result.ok) return result
    }
    await delayFn(250)
    const placed = await evaluate(itemStateExpr(wardrobe))
    if (placed.nodeX !== 300 || placed.nodeY !== 0) {
      return { ok: false, symptom: `wardrobe should sit at (300,0), got (${placed.nodeX},${placed.nodeY})` }
    }

    // ── 驗收口徑：零紅、零碰撞、零 side、零 door；門洞一筆 ──
    const report = await evaluate(REPORT_COUNT_EXPR)
    if (report.paged) {
      return { ok: false, symptom: `report-list is paginated (${report.total} rows); per-class counts would be incomplete` }
    }
    const zeros = ['narrow', 'collision', 'side', 'door', 'unattached', 'unconnected']
    for (const kind of zeros) {
      if ((report.counts[kind] ?? 0) !== 0) {
        return { ok: false, symptom: `vestibule report should be clean, but has ${report.counts[kind]} "${kind}" entr(y|ies): ${JSON.stringify(report.counts)}` }
      }
    }
    if ((report.counts.doorway ?? 0) !== 1 || report.total !== 1) {
      return { ok: false, symptom: `expected exactly one doorway entry and nothing else, got total=${report.total} counts=${JSON.stringify(report.counts)}` }
    }

    // ── 迴旋區 switch 關 ⇒ overlay-static 無扇形（D6「開關只管畫不畫」）──
    const swingBefore = await evaluate(`document.querySelectorAll('[data-testid="overlay-static"] [data-testid^="swing-"]').length`)
    if (swingBefore !== 1) {
      return { ok: false, symptom: `expected one swing arc before toggling, got ${swingBefore}` }
    }
    const toggled = await evaluate(clickExpr('[data-testid="sw-swing"]'))
    if (!toggled.ok) return toggled
    await delayFn(250)
    const swingAfter = await evaluate(`document.querySelectorAll('[data-testid="overlay-static"] [data-testid^="swing-"]').length`)
    if (swingAfter !== 0) {
      return { ok: false, symptom: `overlay-static still has ${swingAfter} swing arc(s) after turning the switch off` }
    }
    const pressedState = await evaluate(`document.querySelector('[data-testid="sw-swing"]').getAttribute('aria-pressed')`)
    if (pressedState !== 'false') {
      return { ok: false, symptom: `#sw-swing aria-pressed = ${JSON.stringify(pressedState)} after toggling off` }
    }

    // ── 衣櫃推 1 cm（ArrowDown）⇒ 門違規一筆（`doorViolations` 恆計算，
    //    與迴旋區顯示開關無關——此處開關已關，違規仍須出現）──
    const refocus = await clickNode(wardrobe)
    if (!refocus.ok) return refocus
    await pressKey({ key: 'ArrowDown', code: 'ArrowDown', vk: 40 })
    // 鍵盤拖移的 commit 觸發是「最後一次按鍵後 500 ms 靜默」（drag.ts
    // `KEYBOARD_QUIET_MS`）；600 ms 等到 commit 那一幀的 renderCommit。
    await delayFn(700)
    const pushed = await evaluate(itemStateExpr(wardrobe))
    if (pushed.nodeY !== 1) {
      return { ok: false, symptom: `ArrowDown should move the wardrobe to y=1, got y=${pushed.nodeY}` }
    }
    const report2 = await evaluate(REPORT_COUNT_EXPR)
    if ((report2.counts.door ?? 0) !== 1) {
      return { ok: false, symptom: `pushing the wardrobe 1 cm into the door swing should raise exactly one door violation, got counts=${JSON.stringify(report2.counts)}` }
    }
    return { ok: true }
  },
}

// ── 案 3 ───────────────────────────────────────────────────────────────

const KEYBOARD_ITEMS = [
  furniture('f01', '書桌', 100, 50, 0, 0),
  furniture('f02', '櫃子', 100, 50, 0, 200),
]

/**
 * PLAN §Verification e2e 案 3（鍵盤全程）。全部按鍵皆為真實 CDP 事件
 * （`Input.dispatchKeyEvent`），焦點一律由鍵盤自己走到——`sp2/REPORT.md`
 * 案 3 的明文提醒：`element.focus()`／`element.click()` 方法不走瀏覽器原生
 * 焦點管線，用它們代打就測不到這一案要測的東西。
 *
 * **為什麼按兩次 `.`**：`drag.ts` `cycleSelection` 以 `ui.selectedId` 為
 * 游標，而 `ui.selectedId` 開機為 `null`（`ui-state.ts` `DEFAULT_UI`），
 * Tab 只是讓焦點落在 roving 停點、不會設 `selectedId`。故第一次 `.` 把
 * 游標「歸位」到第一件（index −1 → 0，焦點不動），第二次才真的切到下一件。
 * 這是產品行為、不是 harness 妥協，斷言因此逐步寫死：第一次後仍是 nodes[0]、
 * 第二次後是 nodes[1]。
 */
const caseKeyboardOnly = {
  id: 'keyboard-only',
  label: '案 3：鍵盤全程（Tab→句號切件→方向鍵→Delete→還原鈕獲焦→復原）',
  seed: { ...emptyPlan(), items: KEYBOARD_ITEMS },
  async run({ evaluate, pressKey, pressEnter, delayFn }) {
    const nodes = await evaluate(NODES_EXPR)
    if (nodes.length !== 2 || nodes[0].id !== 'f01' || nodes[1].id !== 'f02') {
      return { ok: false, symptom: `seed did not produce two item nodes in order [f01, f02]: ${JSON.stringify(nodes)}` }
    }
    if (nodes.filter((n) => n.tabindex === '0').length !== 1) {
      return { ok: false, symptom: `roving tabindex broken: ${JSON.stringify(nodes)}` }
    }

    // ── Tab 直到焦點落進畫布（有界迴圈；超過即 FAIL 並回報走過的落點）──
    const visited = []
    let landed = null
    for (let i = 0; i < 30; i++) {
      await pressKey({ key: 'Tab', code: 'Tab', vk: 9 })
      await delayFn(40)
      const active = await evaluate(ACTIVE_EXPR)
      visited.push(active === null ? 'null' : active.testid ?? active.id ?? active.tag)
      if (active !== null && active.inBoard) {
        landed = active
        break
      }
    }
    if (landed === null) {
      return { ok: false, symptom: `Tab never reached the board canvas in 30 presses; focus path was: ${visited.join(' → ')}` }
    }
    if (landed.tabindex !== '0') {
      return { ok: false, symptom: `the canvas Tab stop should be the roving node with tabindex="0", got tabindex=${JSON.stringify(landed.tabindex)} on ${JSON.stringify(landed.testid)}` }
    }
    if (landed.dataId !== 'f01') {
      return { ok: false, symptom: `Tab landed on ${JSON.stringify(landed.dataId)}, expected the first draggable node f01` }
    }

    // ── `.` 切件（見本案文件：第一次歸位、第二次才換件）──
    await pressKey({ key: '.', code: 'Period', text: '.', vk: 190 })
    await delayFn(120)
    const afterDot1 = await evaluate(ACTIVE_EXPR)
    if (afterDot1 === null || afterDot1.dataId !== 'f01') {
      return { ok: false, symptom: `first "." should normalise selection onto f01, focus is now ${JSON.stringify(afterDot1)}` }
    }
    await pressKey({ key: '.', code: 'Period', text: '.', vk: 190 })
    await delayFn(120)
    const afterDot2 = await evaluate(ACTIVE_EXPR)
    if (afterDot2 === null || afterDot2.dataId !== 'f02') {
      return { ok: false, symptom: `second "." should move focus to the other item (f02), focus is now ${JSON.stringify(afterDot2)}` }
    }

    // ── 方向鍵 ×3（鍵盤步進刻意不過網格與磁吸，drag.ts `stepBy`）──
    const beforeArrows = await evaluate(itemStateExpr('f02'))
    for (let i = 0; i < 3; i++) {
      await pressKey({ key: 'ArrowRight', code: 'ArrowRight', vk: 39 })
      await delayFn(60)
    }
    await delayFn(700) // KEYBOARD_QUIET_MS = 500，留餘裕等 commit 那一幀
    const afterArrows = await evaluate(itemStateExpr('f02'))
    const expectedX = String(Number(beforeArrows.rowX) + 3)
    if (afterArrows.rowX !== expectedX) {
      return { ok: false, symptom: `3× ArrowRight should take f02 from x=${beforeArrows.rowX} to x=${expectedX}, list shows "${afterArrows.rowX}" (node data-x=${afterArrows.nodeX})` }
    }

    // ── Delete ⇒ 節點消失、焦點移到該列「還原」鈕（D10 非破壞性刪除特例）──
    await pressKey({ key: 'Delete', code: 'Delete', vk: 46 })
    await delayFn(300)
    const afterDelete = await evaluate(ACTIVE_EXPR)
    if (afterDelete === null || afterDelete.testid !== 'restore-f02') {
      return { ok: false, symptom: `after Delete the focus should sit on [data-testid="restore-f02"], got ${JSON.stringify(afterDelete)}` }
    }
    const deletedState = await evaluate(itemStateExpr('f02'))
    if (deletedState.nodePresent) {
      return { ok: false, symptom: 'deleted item is still rendered on the canvas' }
    }

    // ── 真 Enter 啟動還原鈕 ⇒ 節點回到畫布 ──
    await pressEnter()
    await delayFn(300)
    const restored = await evaluate(itemStateExpr('f02'))
    if (!restored.nodePresent) {
      return { ok: false, symptom: 'Enter on the restore button did not bring the item back to the canvas' }
    }
    if (restored.rowX !== expectedX) {
      return { ok: false, symptom: `restored item lost its position: x="${restored.rowX}" (expected "${expectedX}")` }
    }
    return { ok: true }
  },
}

// ── 案 4 ───────────────────────────────────────────────────────────────

/** 玄關幾何的 plan 形（案 4／案 6 以外的案走 UI 建置；此處 seed 求確定性）。 */
const VESTIBULE_PLAN = {
  version: 1,
  room: {
    width: 300,
    depth: 400,
    blocks: [{ id: 'b01', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }],
    doors: [{ id: 'd01', x: 360, y: 270, wall: 'E', leafDir: '-', width: 70, swing: 'in' }],
  },
  items: [furniture('f01', '衣櫃', 200, 60, 300, 0, { rotation: 90, clearances: { S: 90 } })],
  settings: { ...SETTINGS },
}

/**
 * 下載攔截（案 4）。三件事，皆在點匯出**之前**裝好：
 *
 * 1. `URL.createObjectURL` 包一層，只在 `blob.type === 'image/png'` 時記下
 *    Blob——`io-png.ts` `defaultLoadImage` 也會對**SVG** Blob 呼叫同一支
 *    API（把 SVG 餵進 `<img>`），不分類型就會抓錯那一顆。
 * 2. `URL.revokeObjectURL` 改 no-op：`main.ts` `downloadBlob` 會在
 *    `setTimeout(…, 0)` 裡撤銷 URL，不擋掉就來不及取樣。
 * 3. `HTMLAnchorElement.prototype.click` 改 no-op：避免真的觸發下載
 *    （headless 下載會落到磁碟、且與本案無關）。
 */
const INSTALL_PNG_CAPTURE_EXPR = `
  (() => {
    window.__pngBlob = null;
    window.__origCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj) => {
      if (obj && obj.type === 'image/png') window.__pngBlob = obj;
      return window.__origCreateObjectURL(obj);
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {};
    return 'installed';
  })()
`

/**
 * PLAN §Verification e2e 案 4。取樣點刻意避開兩處會讓單像素斷言變脆的東西：
 * 家具中央的名稱標籤（`board.ts` 把 `<text>` 放在有效外框正中）與矩形描邊
 * （`non-scaling-stroke`）——故家具取樣點落在左上角內縮處 (310,20)，地板
 * 取樣點落在基底矩形中段 (150,350)，遠離迴旋區 [290,360]×[200,270] 與門洞
 * 尺寸線。
 */
const casePngExportPixels = {
  id: 'png-export-pixels',
  label: '案 4：PNG 匯出→getImageData 取樣像素非全黑＋naturalWidth 符合比例',
  seed: VESTIBULE_PLAN,
  async run({ evaluate, evaluateAsync, delayFn }) {
    const nodes = await evaluate(NODES_EXPR)
    if (nodes.filter((n) => n.kind === 'item').length !== 1 || nodes.filter((n) => n.kind === 'door').length !== 1) {
      return { ok: false, symptom: `seeded vestibule plan did not load as expected: ${JSON.stringify(nodes)}` }
    }

    const installed = await evaluate(INSTALL_PNG_CAPTURE_EXPR)
    if (installed !== 'installed') return { ok: false, symptom: `capture hooks not installed: ${String(installed)}` }

    const clicked = await evaluate(clickExpr('[data-testid="btn-export-png"]'))
    if (!clicked.ok) return clicked

    let ready = false
    for (let i = 0; i < 60; i++) {
      await delayFn(200)
      const state = await evaluate(`({ blob: window.__pngBlob !== null, error: document.querySelector('[data-testid="error"]').textContent })`)
      if (state.error !== '') {
        return { ok: false, symptom: `PNG export reported an error: ${JSON.stringify(state.error)}` }
      }
      if (state.blob) {
        ready = true
        break
      }
    }
    if (!ready) return { ok: false, symptom: 'PNG blob never arrived within 12 s (no #error either)' }

    const probe = await evaluateAsync(`
      (async () => {
        const url = window.__origCreateObjectURL(window.__pngBlob);
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const svg = document.querySelector(${JSON.stringify(SVG_SEL)});
        const vb = svg.viewBox.baseVal;
        const sx = img.naturalWidth / vb.width;
        const sy = img.naturalHeight / vb.height;
        const sample = (cx, cy) => {
          const px = Math.min(img.naturalWidth - 1, Math.max(0, Math.round((cx - vb.x) * sx)));
          const py = Math.min(img.naturalHeight - 1, Math.max(0, Math.round((cy - vb.y) * sy)));
          return Array.from(ctx.getImageData(px, py, 1, 1).data);
        };
        const itemFill = document.querySelector('[data-testid="item-f01"] rect').getAttribute('fill');
        const scaleText = document.querySelector('[data-testid="export-scale"]').textContent;
        return {
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          viewBox: { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
          floor: sample(150, 350),
          item: sample(310, 20),
          itemFill,
          scaleText,
        };
      })()
    `)

    // (a) 地板像素：非透明、非全黑（PLAN「取樣像素非全黑」）。
    const [fr, fg, fb, fa] = probe.floor
    if (fa === 0 || (fr === 0 && fg === 0 && fb === 0)) {
      return { ok: false, symptom: `floor sample at (150,350) cm is blank/black: rgba(${probe.floor.join(',')}) — the S3 "clone sampling loses styles" failure mode looks exactly like this` }
    }

    // (b) 家具像素 ≈ 其 `fill`（±8／通道）。
    const hex = String(probe.itemFill).trim()
    const expected = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    if (expected.some((v) => !Number.isInteger(v))) {
      return { ok: false, symptom: `could not parse the item fill colour: ${JSON.stringify(probe.itemFill)}` }
    }
    const diff = expected.map((v, i) => Math.abs(v - probe.item[i]))
    if (probe.item[3] === 0 || diff.some((d) => d > 8)) {
      return { ok: false, symptom: `item sample at (310,20) cm is rgba(${probe.item.join(',')}), expected ≈ ${hex} = rgb(${expected.join(',')}) (per-channel diff ${diff.join(',')})` }
    }

    // (c) 長寬比與外接框一致（±1 px），且不逾 D7 的像素硬上限。
    const expectedWidth = Math.round((probe.naturalHeight * probe.viewBox.width) / probe.viewBox.height)
    if (Math.abs(probe.naturalWidth - expectedWidth) > 1) {
      return { ok: false, symptom: `PNG is ${probe.naturalWidth}×${probe.naturalHeight}, not proportional to the ${probe.viewBox.width}×${probe.viewBox.height} cm bounds (expected width ≈ ${expectedWidth})` }
    }
    if (Math.max(probe.naturalWidth, probe.naturalHeight) > 4096 || probe.naturalWidth * probe.naturalHeight > 16_000_000) {
      return { ok: false, symptom: `PNG ${probe.naturalWidth}×${probe.naturalHeight} exceeds the D7 pixel caps (long edge ≤4096, area ≤16,000,000)` }
    }

    // (d) 「匯出比例 1:N」與實得像素互洽。N 是 `(1/scale).toFixed(2)` 去尾零
    //     （`io-png.ts` `ratioText`），故容許量就是那一次 round 的半個單位。
    const matched = /1:\s*([0-9]*\.?[0-9]+)/.exec(String(probe.scaleText))
    if (matched === null) {
      return { ok: false, symptom: `#export-scale does not carry a "1:N" ratio: ${JSON.stringify(probe.scaleText)}` }
    }
    const labelled = Number(matched[1])
    const actual = probe.viewBox.height / probe.naturalHeight
    if (!(Math.abs(labelled - actual) <= 0.0051)) {
      return { ok: false, symptom: `#export-scale says 1:${labelled} (cm per px) but the PNG works out to 1:${actual.toFixed(5)} (${probe.viewBox.height} cm / ${probe.naturalHeight} px)` }
    }
    return { ok: true }
  },
}

// ── 案 5 ───────────────────────────────────────────────────────────────

const SHARE_PLAN_A = { ...emptyPlan(), items: [furniture('f01', '書桌', 100, 50, 123, 0)] }

/**
 * PLAN §Verification e2e 案 5。分享連結的造法：把狀態改成 B、攔
 * `navigator.clipboard.writeText` 取回「複製分享連結」鈕算出來的 URL，
 * 然後把 `localStorage` **寫回狀態 A** 再導覽——這樣「預覽態不觸碰
 * localStorage」（D7）才有東西可驗：hash 帶的是 B、存檔裡是 A，導覽後
 * 畫面必須是 B 而存檔必須逐字還是 A。
 *
 * 兩次導覽都先跳 `about:blank`：`sp2/REPORT.md`「方法論校準」第 1 點實測，
 * 同一文件只差一個 hash 的 `Page.navigate` 是 same-document 導覽，
 * `DOMContentLoaded` 不重跑，hash 解析邏輯完全測不到。
 */
const caseReloadAndSharePreview = {
  id: 'reload-and-share-preview',
  label: '案 5：reload 後自 localStorage 還原；帶 #plan= 進預覽態、存檔未動；不帶 hash 回原狀',
  seed: SHARE_PLAN_A,
  async run({ evaluate, reload, navigateVia, appUrl, delayFn }) {
    const seeded = await evaluate(itemStateExpr('f01'))
    if (!seeded.nodePresent || seeded.nodeX !== 123) {
      return { ok: false, symptom: `plan A did not load from localStorage: ${JSON.stringify(seeded)}` }
    }

    // ── 改值（選取 → 屬性欄 X）→ autosave（debounce 300 ms）→ 真重載 →
    //    值仍在 ──
    const edit = await setItemProp(evaluate, 'f01', 'x', 130)
    if (!edit.ok) return edit
    await delayFn(500)
    await reload()
    const afterReload = await evaluate(itemStateExpr('f01'))
    if (afterReload.nodeX !== 130) {
      return { ok: false, symptom: `after reload the item should be at x=130 (restored from localStorage), got ${afterReload.nodeX}` }
    }
    const rawA = await evaluate(READ_STORED_EXPR)
    if (typeof rawA !== 'string' || !rawA.includes('130')) {
      return { ok: false, symptom: `localStorage does not hold the edited plan A: ${JSON.stringify(rawA)}` }
    }

    // ── 造狀態 B 的分享連結 ──
    // 重載後 `ui.selectedId` 回到 null，故 `setItemProp` 會自己再選一次。
    const editB = await setItemProp(evaluate, 'f01', 'x', 200)
    if (!editB.ok) return editB
    await delayFn(500)
    await evaluate(`
      (() => {
        window.__copied = null;
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (text) => { window.__copied = text; } },
        });
        return 'stubbed';
      })()
    `)
    const shareClicked = await evaluate(clickExpr('[data-testid="btn-share"]'))
    if (!shareClicked.ok) return shareClicked
    let shareUrl = null
    for (let i = 0; i < 30; i++) {
      await delayFn(100)
      shareUrl = await evaluate('window.__copied')
      if (typeof shareUrl === 'string') break
    }
    if (typeof shareUrl !== 'string' || !shareUrl.includes('#plan=')) {
      const notice = await evaluate(`document.querySelector('[data-testid="io-notice"]').textContent`)
      return { ok: false, symptom: `"copy share link" produced no #plan= URL (captured=${JSON.stringify(shareUrl)}, #io-notice=${JSON.stringify(notice)})` }
    }

    // ── 把存檔寫回狀態 A（此時無未決 autosave：上一次改值已過 debounce，
    //    按分享鈕不改 plan），讓「預覽態不觸碰 localStorage」有東西可驗 ──
    await evaluate(`(() => { localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(rawA)}); return 'restored'; })()`)
    const restoredRaw = await evaluate(READ_STORED_EXPR)
    if (restoredRaw !== rawA) {
      return { ok: false, symptom: 'failed to restore localStorage to plan A before the share navigation' }
    }

    // ── 帶 `#plan=` 導覽（about:blank 中繼）⇒ 預覽態 ──
    await navigateVia(shareUrl)
    const preview = await evaluate(`
      (() => ({
        hash: window.location.hash,
        saveVisible: !document.querySelector('[data-testid="btn-save-shared"]').hidden,
        stored: localStorage.getItem(${JSON.stringify(STORAGE_KEY)}),
      }))()
    `)
    const previewItem = await evaluate(itemStateExpr('f01'))
    if (previewItem.nodeX !== 200) {
      return { ok: false, symptom: `share preview should show plan B (x=200), got x=${previewItem.nodeX}` }
    }
    if (preview.hash !== '') {
      return { ok: false, symptom: `hash should be cleared by history.replaceState after a share load, got ${JSON.stringify(preview.hash)}` }
    }
    if (!preview.saveVisible) {
      return { ok: false, symptom: '#btn-save-shared is still hidden in share preview mode' }
    }
    if (preview.stored !== rawA) {
      return { ok: false, symptom: `share preview must not touch localStorage, but STORAGE_KEY changed:\n  before: ${rawA}\n  after:  ${preview.stored}` }
    }

    // ── 不帶 hash（about:blank 中繼）⇒ 回到存檔裡的狀態 A ──
    await navigateVia(appUrl)
    const back = await evaluate(itemStateExpr('f01'))
    if (back.nodeX !== 130) {
      return { ok: false, symptom: `navigating back without a hash should restore plan A (x=130), got x=${back.nodeX}` }
    }
    const previewGone = await evaluate(`document.querySelector('[data-testid="btn-save-shared"]').hidden`)
    if (previewGone !== true) {
      return { ok: false, symptom: '#btn-save-shared is visible on a plain (non-share) load' }
    }
    return { ok: true }
  },
}

// ── 案 6／案 7（共用量測式）─────────────────────────────────────────────

/** 五欄的 x 座標（家具 80 寬 ⇒ 欄距 40 cm）；房深由列數推導。 */
const DENSE_COLS = [0, 120, 240, 360, 480]

/** 本 fixture 在指定件數下的房深（見 `densePlan()` 的「房深」段）。 */
function denseRoomDepth(count) {
  return Math.max(800, Math.ceil(count / DENSE_COLS.length) * 100)
}

/**
 * 密集 fixture（PLAN §D10 render／OQ5 (3) 的量測對象），**以家具件數為參數**
 * ——案 6 與案 7 共用同一份幾何，唯一的變數是件數：80×50 的家具排成 5 欄，
 * 欄距 40 cm、列距 50 cm——兩者皆落在 `[ignoreBelow 5, warnBelow 60)`，故
 * 幾乎每一對相鄰家具與每一道牆都產出 `narrow` 通道，正是「拖移期 overlay
 * 只畫 narrow＋碰撞」這條節點預算最不討好的輸入（OQ5 (1) 在這裡完全省不下
 * 節點）。刻意如此：門檻是驗收數字，要用最壞而非典型的 fixture 打。
 *
 * 房深：20／40 件皆維持 PLAN 原本寫定的 **600×800**（4 列／8 列都放得下）；
 * 75 件需 15 列（最後一列佔 [1400,1450]），故房深取 `max(800, 列數×100)`
 * 以維持**完全相同的欄距／列距**——把密度攤平去遷就 800 深才會讓上限側的
 * 數字失真。`SIZE_MAX = 5000`（`model.ts`），1500 遠在界內。
 *
 * `settings.maxItems` 一律寫成本 fixture 的件數：今日 `parsePlan()` 白名單
 * 不含此欄、直接忽略；T4.7 落地後它是「使用者可調上限（預設 20、硬上限
 * 75）」，明寫可確保 40／75 件的 fixture 不會被上限截掉。
 *
 * 被量測的 `f00` 位於 (0,0)，向右 30 cm 後是 [30,110]，與第二欄 (120) 仍差
 * 10 cm——全程不碰撞、不觸夾框，每一步都真的會改 plan（夾框擋掉時
 * `dragMove` 會因 `history === previous` 直接 return，量出來的會是假的快）。
 */
function densePlan(count) {
  const cols = DENSE_COLS
  const items = []
  for (let index = 0; index < count; index++) {
    const col = cols[index % cols.length]
    const row = Math.floor(index / cols.length)
    items.push(furniture(`f${String(index).padStart(2, '0')}`, `家具${index}`, 80, 50, col, row * 100))
  }
  return {
    version: 1,
    room: { width: 600, depth: denseRoomDepth(count), blocks: [], doors: [] },
    items,
    settings: { ...SETTINGS, maxItems: count },
  }
}

/** 單幀樣本數（30 步鍵盤拖移，PLAN §D10 render 的量測口徑）。 */
const FRAME_SAMPLES = 30

/**
 * OQ5 (3) 定案門檻：單幀 p50 ≤16.7 ms（60 fps）於 `rate=4` 下量得。
 *
 * **雙門檻裁決（使用者 2026-09-22）**：件數維持 20 件（見下方
 * `FRAME_ASSERT_ITEMS`），連續三輪量測 p95 17.9 / 15.2 / 16.2 ms（對應同輪
 * p50 13.4 / 11.9 / 10.2 ms）——單一 p95 ≤16.7 ms 門檻在邊界閃爍。改為雙軌：
 * p50 仍須守住 16.7 ms（60 fps 中位數，本常數未動），p95 另見
 * `FRAME_BUDGET_P95_MS`，放寬至 25 ms 吸收尾端抖動。
 */
const FRAME_BUDGET_P50_MS = 16.7

/** 案 6 雙門檻的 p95 側；裁決紀錄見 `FRAME_BUDGET_P50_MS` 的文件註解。 */
const FRAME_BUDGET_P95_MS = 25

/**
 * 案 6 斷言用的件數（使用者裁決 2026-09-21）。實務單房 10–25 件，`maxItems`
 * 預設亦為 20；T4.5 的家具數掃描實測 20 件 @rate=4 p95 16.3 ms，交界落在
 * 20–25 件。**門檻本身沒有放寬**（仍是 16.7 ms），改的是量測對象的件數。
 */
const FRAME_ASSERT_ITEMS = 20

/**
 * 案 6 附帶量測的件數：只列印、不斷言。留著是為了讓「密集大房會掉幀」這件
 * 事持續有數字可看（T4.5 實測 40 件 @rate=4 p95 28.5–37.5 ms），日後
 * `renderOverlay`／`clearanceForMoved` 若再優化，回歸網會直接顯示進展。
 */
const FRAME_INFO_ITEMS = 40

/** 案 7：`model.ts` `LIMITS.items` 硬上限，亦即 `settings.maxItems` 的上界。 */
const FRAME_MAX_ITEMS = 75

/**
 * 案 7 門檻：RAIL 的「perceived-instant」100 ms。上限側不套 60 fps——
 * `rate=4`（T4.5 實測等效 ~10×）下 75 件必然掉幀，此處把關的是「仍在即時
 * 感範圍內、不會變成卡死」。
 */
const FRAME_MAX_BUDGET_MS = 100

/**
 * 頁面內的單幀量測式（案 6／案 7 共用的唯一一份）。逐字照 PLAN
 * §Implementation notes「M0 實作注意」：**迴圈整段留在頁面內、一個集合一次
 * 往返**（逐迭代 `Runtime.evaluate` 會把 CDP 往返算進來，且隨負載惡化）；
 * 每一步量的是「派發 keydown（JS：reducer→`clearanceForMoved`→`renderDrag`
 * ＋`renderOverlay`）＋強制 `getBoundingClientRect()`（style＋layout）」，
 * 與 `sp1/browser/measure.mjs` 同一口徑。
 *
 * 用合成 `KeyboardEvent` 而非 CDP 真鍵盤：真鍵盤每一下都是一次 CDP 往返，
 * 正是上面那條禁令要避開的東西；受測的程式路徑（`drag.ts` 的 `keydown`
 * 委派 → `stepBy` → `host.dragMove`）兩者完全相同。
 */
const FRAME_MEASURE_EXPR = `
  (() => {
    const svg = document.querySelector(${JSON.stringify(SVG_SEL)});
    const node = document.querySelector('[data-testid="item-f00"]');
    if (node === null) return { ok: false, symptom: 'probe node item-f00 missing' };
    node.focus();
    const samples = [];
    for (let i = 0; i < ${FRAME_SAMPLES}; i++) {
      const t0 = performance.now();
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      svg.getBoundingClientRect();
      samples.push(performance.now() - t0);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
    return {
      ok: true,
      samples,
      p50: at(0.5),
      p95: at(0.95),
      max: sorted[sorted.length - 1],
      overlayNodes: document.querySelector('[data-testid="overlay-dynamic"]').childElementCount,
    };
  })()
`

/**
 * 跑一輪單幀量測（案 6 的 20 件與 40 件、案 7 的 75 件皆走這一支，件數是
 * 唯一參數）。回傳 `{ ok:true, p50, p95, max, overlayNodes, stats }`。
 *
 * **本函式不含任何門檻判斷**——門檻是各案自己的事（案 6 硬斷言 16.7 ms、
 * 案 6 的 40 件只列印、案 7 硬斷言 100 ms）。但「量到的東西是真的」這件事
 * 屬於量測本身，故三條前提在此一律硬失敗：fixture 真的載到指定件數、
 * `#sw-warnings` 開著、30 步之後家具真的走了 30 cm（每一步都被夾框擋掉時
 * `dragMove` 會提早 return，量出來的「很快」毫無意義）。
 */
async function measureDragFrame({ evaluate, delayFn }, itemCount) {
  const nodes = await evaluate(NODES_EXPR)
  const loaded = nodes.filter((n) => n.kind === 'item').length
  if (loaded !== itemCount) {
    return { ok: false, symptom: `dense fixture did not load ${itemCount} items: got ${loaded} item node(s) (${nodes.length} nodes total)` }
  }
  const warnings = await evaluate(`document.querySelector('[data-testid="sw-warnings"]').getAttribute('aria-pressed')`)
  if (warnings !== 'true') {
    return { ok: false, symptom: `#sw-warnings should be on for this measurement, aria-pressed=${JSON.stringify(warnings)}` }
  }

  const measured = await evaluate(FRAME_MEASURE_EXPR)
  if (!measured.ok) return measured

  // 靜默期（`drag.ts` `KEYBOARD_QUIET_MS = 500`）後才 commit。件數愈多、
  // commit 那一幀在 rate=4 下愈久，故**輪詢**而非賭一個固定 sleep——
  // 75 件的上限側若寫死 1,200 ms 會變成 flake 來源。
  let moved = null
  for (let i = 0; i < 40; i++) {
    await delayFn(150)
    moved = await evaluate(itemStateExpr('f00'))
    if (moved.nodeX === FRAME_SAMPLES) break
  }
  if (moved === null || moved.nodeX !== FRAME_SAMPLES) {
    return { ok: false, symptom: `probe item should have travelled ${FRAME_SAMPLES} cm, landed at x=${moved === null ? 'n/a' : moved.nodeX} after 6 s — the frame numbers measured a no-op path` }
  }

  const stats = `p50=${measured.p50.toFixed(2)}ms p95=${measured.p95.toFixed(2)}ms max=${measured.max.toFixed(2)}ms overlay-dynamic=${measured.overlayNodes} nodes`
  console.log(`\n[e2e] frame @rate=4 (${FRAME_SAMPLES} keyboard drag steps, ${itemCount} items / 600×${denseRoomDepth(itemCount)}): ${stats}`)
  return { ok: true, p50: measured.p50, p95: measured.p95, max: measured.max, overlayNodes: measured.overlayNodes, stats }
}

// ── 案 6 ───────────────────────────────────────────────────────────────

/**
 * PLAN §D10 render（OQ5 (3)），件數經使用者裁決（2026-09-21）重校，
 * 斷言門檻經使用者裁決（2026-09-22）改為雙軌：
 *
 * - **硬斷言對象＝20 件**：實務單房 10–25 件，`settings.maxItems` 預設亦為
 *   20（件數本身未動）。
 * - **雙門檻 p50 ≤16.7 ms 且 p95 ≤25 ms**：原單一 p95 ≤16.7 ms 門檻連續三輪
 *   量測邊界閃爍（p95 17.9／15.2／16.2 ms，對應同輪 p50 13.4／11.9／
 *   10.2 ms），改為 p50 守 60 fps 中位數、p95 放寬至 25 ms 吸收尾端抖動
 *   （見 `FRAME_BUDGET_P50_MS`／`FRAME_BUDGET_P95_MS` 文件註解）。
 * - **40 件只列印**：同一頁面重新 seed ＋ 重新載入後再量一次，`info:` 行進
 *   SUMMARY。不斷言，但量測本身的三條前提（見 `measureDragFrame`）仍硬失敗
 *   ——否則 seed 壞掉時 `info:` 會靜靜消失，比紅燈更糟。
 *
 * 重新 seed 前**先把節流關掉**再導覽：頁面開機（parsePlan ＋ 首次全量
 * render ＋ 40 件 clearance）在 rate=4 下會拖很久，且那段時間不是本案要量的
 * 東西。量測前才把 rate=4 開回來。
 *
 * 重新 seed 前另等 1.5 s：autosave 是 300 ms 尾沿 debounce（`main.ts`
 * `AUTOSAVE_DEBOUNCE_MS`），上一次 commit 的未決寫入若在 `setItem` 之後才
 * 落地，會把剛 seed 好的 40 件 plan 蓋回 20 件。等過 debounce 後
 * `flushAutosave()`（`pagehide` 共用）沒有未決計時器可寫，導覽即安全。
 */
const caseFrameBudgetRate4 = {
  id: 'frame-budget-rate4',
  label: '案 6：rate=4 下鍵盤拖移單幀 p50 ≤16.7 ms 且 p95 ≤25 ms（20 件；40 件僅列印）',
  seed: densePlan(FRAME_ASSERT_ITEMS),
  cpuThrottlingRate: 4,
  async run(ctx) {
    const { evaluate, navigate, delayFn, setCpuThrottlingRate } = ctx

    // ── (a) 硬斷言：20 件，雙門檻 p50 ≤16.7 ms 且 p95 ≤25 ms ──
    const primary = await measureDragFrame(ctx, FRAME_ASSERT_ITEMS)
    if (!primary.ok) return primary
    const p50Failed = primary.p50 > FRAME_BUDGET_P50_MS
    const p95Failed = primary.p95 > FRAME_BUDGET_P95_MS
    if (p50Failed || p95Failed) {
      const bound = p50Failed && p95Failed
        ? `p50 ${primary.p50.toFixed(2)}ms exceeds ${FRAME_BUDGET_P50_MS}ms and p95 ${primary.p95.toFixed(2)}ms exceeds ${FRAME_BUDGET_P95_MS}ms`
        : p50Failed
          ? `p50 ${primary.p50.toFixed(2)}ms exceeds the ${FRAME_BUDGET_P50_MS}ms budget`
          : `p95 ${primary.p95.toFixed(2)}ms exceeds the ${FRAME_BUDGET_P95_MS}ms budget`
      return { ok: false, symptom: `single-frame ${bound} (OQ5 (3), 2026-09-22 dual-threshold) at ${FRAME_ASSERT_ITEMS} items — ${primary.stats}` }
    }

    // ── (b) 參考值：40 件（同案重新 seed ＋ 重新載入；不斷言門檻）──
    await delayFn(1500) // 過 autosave debounce，見本案文件
    await setCpuThrottlingRate(0)
    await evaluate(seedPlanExpr(densePlan(FRAME_INFO_ITEMS)))
    await navigate()
    await setCpuThrottlingRate(4)
    await delayFn(300)
    const info = await measureDragFrame(ctx, FRAME_INFO_ITEMS)
    if (!info.ok) return { ok: false, symptom: `informational ${FRAME_INFO_ITEMS}-item measurement could not run: ${info.symptom}` }

    const note = `${FRAME_ASSERT_ITEMS} items ${primary.stats} (budget p50≤${FRAME_BUDGET_P50_MS}ms p95≤${FRAME_BUDGET_P95_MS}ms) | info: ${FRAME_INFO_ITEMS} items p50=${info.p50.toFixed(2)}ms p95=${info.p95.toFixed(2)}ms max=${info.max.toFixed(2)}ms overlay-dynamic=${info.overlayNodes} nodes — not asserted`
    console.log(`[e2e] info: ${FRAME_INFO_ITEMS} items p50=${info.p50.toFixed(2)}ms p95=${info.p95.toFixed(2)}ms (no assertion)`)
    return { ok: true, note }
  },
}

// ── 案 7 ───────────────────────────────────────────────────────────────

/**
 * 上限側（`LIMITS.items` ＝ `settings.maxItems` 硬上限＝75）。同一量測式、
 * 同一 fixture 幾何，門檻換成 RAIL 的 100 ms「perceived-instant」：60 fps
 * 是實務單房件數的驗收線（案 6），使用者把上限開到 75 時，要保證的是「還
 * 有即時感」，不是「不掉幀」。
 */
const caseFrameBudgetMaxItems = {
  id: 'frame-budget-rate4-max-items',
  label: '案 7：75 件（上限）@rate=4 單幀 p95 <100 ms',
  seed: densePlan(FRAME_MAX_ITEMS),
  cpuThrottlingRate: 4,
  async run(ctx) {
    const measured = await measureDragFrame(ctx, FRAME_MAX_ITEMS)
    if (!measured.ok) return measured
    if (!(measured.p95 < FRAME_MAX_BUDGET_MS)) {
      return { ok: false, symptom: `single-frame p95 ${measured.p95.toFixed(2)}ms is not below the ${FRAME_MAX_BUDGET_MS}ms perceived-instant budget at ${FRAME_MAX_ITEMS} items (the hard cap) — ${measured.stats}` }
    }
    return { ok: true, note: `${FRAME_MAX_ITEMS} items ${measured.stats} (budget <${FRAME_MAX_BUDGET_MS}ms)` }
  },
}

// ── 案 8 ───────────────────────────────────────────────────────────────

/**
 * 門節點與其命中區的現況（T5.2）。判準一律取畫布節點的 `data-x`／
 * `data-y`（`board.ts` 的 DOM 契約，與 `structure-list` 同源），`structure`
 * 欄只作失敗時的佐證——`structure-list` 的列版型正由 T5.3 改寫，不適合
 * 當硬斷言的錨點。
 */
function doorStateExpr(id) {
  const q = JSON.stringify(`[data-testid="door-${id}"]`)
  const row = JSON.stringify(`#structure-row-${id}`)
  return `
    (() => {
      const node = document.querySelector(${q});
      const li = document.querySelector(${row});
      return {
        nodePresent: node !== null,
        nodeX: node === null ? null : Number(node.getAttribute('data-x')),
        nodeY: node === null ? null : Number(node.getAttribute('data-y')),
        hits: node === null ? 0 : node.querySelectorAll('.door-hit').length,
        structure: li === null ? null : li.textContent.replace(/\\s+/g, ' ').trim(),
        status: document.querySelector('[data-testid="status"]').textContent,
      };
    })()
  `
}

/**
 * 以 `getScreenCTM()` 把「鉸鏈 ＋ 抓取偏移」與「再位移 (dx,dy) cm」換成
 * viewport px（同 `dragPlanExpr` 的作法，連公式都沒有，直接問瀏覽器）。
 * 前提檢查多一項：起點的 `elementFromPoint` 必須命中**門節點**，且命中的
 * 是 `.door-hit` 那兩塊之一——否則本案測到的就不是 T5.2 的命中區。
 */
function doorDragPlanExpr(id, grabDx, grabDy, moveDx, moveDy) {
  const q = JSON.stringify(`[data-testid="door-${id}"]`)
  return `
    (() => {
      const svg = document.querySelector(${JSON.stringify(SVG_SEL)});
      const node = document.querySelector(${q});
      if (svg === null) return { ok: false, symptom: 'board svg not found' };
      if (node === null) return { ok: false, symptom: 'door node ' + ${q} + ' not found' };
      const m = svg.getScreenCTM();
      if (m === null) return { ok: false, symptom: 'getScreenCTM() returned null (svg not rendered)' };
      const hx = Number(node.getAttribute('data-x'));
      const hy = Number(node.getAttribute('data-y'));
      const toScreen = (cx, cy) => ({ x: m.a * cx + m.c * cy + m.e, y: m.b * cx + m.d * cy + m.f });
      const from = toScreen(hx + (${grabDx}), hy + (${grabDy}));
      const to = toScreen(hx + (${grabDx}) + (${moveDx}), hy + (${grabDy}) + (${moveDy}));
      const inView = (p) => p.x >= 1 && p.y >= 1 && p.x <= window.innerWidth - 2 && p.y <= window.innerHeight - 2;
      if (!inView(from) || !inView(to)) {
        return { ok: false, symptom: 'drag endpoints outside viewport: from=' + JSON.stringify(from) + ' to=' + JSON.stringify(to) + ' viewport=' + window.innerWidth + 'x' + window.innerHeight };
      }
      const hit = document.elementFromPoint(Math.round(from.x), Math.round(from.y));
      const owner = hit === null ? null : hit.closest('[data-kind][data-id]');
      if (owner === null || owner.getAttribute('data-id') !== ${JSON.stringify(id)}) {
        return { ok: false, symptom: 'elementFromPoint inside the swing sector hits ' + (hit === null ? 'nothing' : (hit.getAttribute('class') || hit.tagName)) + ', not door ' + ${JSON.stringify(id)} + ' — the hit sector is missing or something paints over it' };
      }
      const part = hit.getAttribute('data-part');
      if (part !== 'hit-swing' && part !== 'hit-leaf') {
        return { ok: false, symptom: 'the door was hit through data-part=' + JSON.stringify(part) + ', expected one of the transparent .door-hit shapes' };
      }
      return { ok: true, from, to, scale: m.a, part, hinge: { x: hx, y: hy } };
    })()
  `
}

/**
 * T5.2（TASKS M5 回饋 2「門拖不到，建議開門區域整個可拖」）。玄關實例的
 * 門鉸在 (360,270)、內開、開象限在西北，故迴旋區扇形覆蓋
 * [290,360]×[200,270]；取鉸鏈 −20,−20 的那一點（距鉸鏈 28.3 cm < 半徑
 * 70）當**抓取點**——它只落在扇形命中區內，不在門扇線上，正是舊版拖不到
 * 的位置。往北拖 30 cm ⇒ 門沿東牆上移，y 自 270 → 240（跨距 [170,240]
 * 仍在凸出區東牆 [0,270] 之內，D6 合法）。
 *
 * 容許 ±5 cm：落點會先經 `drag.ts` 的極大牆段磁吸（`DOOR_SNAP_CM`）再由
 * reducer 驗一次，像素→cm 的換算也有半個像素的餘裕。
 */
const caseDoorDragAlongWall = {
  id: 'door-drag-along-wall',
  label: '案 8：指標抓迴旋區把門沿東牆拖上 30 cm（y 270 → ≈240）＋播報',
  seed: VESTIBULE_PLAN,
  async run({ evaluate, pointerDrag, delayFn }) {
    const before = await evaluate(doorStateExpr('d01'))
    if (!before.nodePresent || before.nodeY !== 270 || before.nodeX !== 360) {
      return { ok: false, symptom: `seeded door should start at (360,270), got ${JSON.stringify(before)}` }
    }
    if (before.hits !== 2) {
      return { ok: false, symptom: `door node should carry two transparent .door-hit shapes (swing sector + thickened leaf), got ${before.hits}` }
    }

    const plan = await evaluate(doorDragPlanExpr('d01', -20, -20, 0, -30))
    if (!plan.ok) return plan

    await pointerDrag(plan.from, plan.to)
    // commit 那一幀的 renderCommit ＋ 播報（指標路徑的 commit 觸發是
    // `pointerup`，此處只是等 render／autosave 的一輪）。
    await delayFn(600)

    const after = await evaluate(doorStateExpr('d01'))
    if (!after.nodePresent) {
      return { ok: false, symptom: `door node disappeared after the drag: ${JSON.stringify(after)}` }
    }
    if (after.nodeX !== 360) {
      return { ok: false, symptom: `door left the east wall: x=${after.nodeX} (expected 360); state=${JSON.stringify(after)}` }
    }
    if (!(Math.abs(after.nodeY - 240) <= 5)) {
      return { ok: false, symptom: `dragging the swing sector 30 cm north should put the door at y≈240 (±5), got y=${after.nodeY} (hit part was ${plan.part}, scale ${plan.scale.toFixed(3)} px/cm); structure row = ${JSON.stringify(after.structure)}` }
    }
    if (!String(after.status).includes('門已移至')) {
      return { ok: false, symptom: `#status did not announce the door move: ${JSON.stringify(after.status)}` }
    }
    return { ok: true, note: `door y ${before.nodeY} → ${after.nodeY} via ${plan.part}` }
  },
}

// ── 八案 ───────────────────────────────────────────────────────────────

const CASES = [
  caseAddDragNarrowSecondDrag,
  caseVestibuleAcceptance,
  caseKeyboardOnly,
  casePngExportPixels,
  caseReloadAndSharePreview,
  caseFrameBudgetRate4,
  caseFrameBudgetMaxItems,
  caseDoorDragAlongWall,
]

// ── 單案執行器：全新瀏覽器＋全新 user-data-dir ─────────────────────────

let portCounter = 9433

async function runCase({ browserPath, baseUrl, headless, testCase }) {
  const port = portCounter++
  const userDataDir = join(SCRATCH_ROOT, testCase.id)
  const appUrl = `${baseUrl}/tools/room-layout-planner/`
  const t0 = Date.now()
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
    // **刻意不呼叫 `Input.setInterceptDrags`**：見檔頭「差異僅四處設定值與
    // 一處刪除」——本工具走 Pointer Events，那組指令是 HTML5 DnD 專屬。

    // 頁面未捕捉例外的監聽（比照 `e2e-statusline.mjs` T2.3，sp2/REPORT.md
    // 「範圍外觀察」明文建議 T4.5 補上）。獨立於 `makeClient` 另掛一個
    // message 監聽器，純增量、不動既有事件通道。
    const pageExceptions = []
    ws.addEventListener('message', (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
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

    /** 同 `evaluate`，但等待表達式回傳的 Promise 落定（案 4 的 `img.decode()`）。 */
    async function evaluateAsync(expression) {
      const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(`evaluate(await) failed: ${JSON.stringify(result.exceptionDetails)}`)
      return result.result.value
    }

    async function navigate(url = appUrl) {
      const loaded = client.waitForEvent('Page.loadEventFired')
      await client.send('Page.navigate', { url })
      await loaded
      await delay(600)
    }

    /**
     * 先跳 `about:blank` 再導到目標——`sp2/REPORT.md`「方法論校準」第 1 點：
     * 同一文件只差一個 hash 的 `Page.navigate` 會被 Chromium 判成
     * same-document 導覽，`DOMContentLoaded` 不重跑。中繼一次即保證
     * cross-document 完整導覽。
     */
    async function navigateVia(url) {
      await navigate('about:blank')
      await navigate(url)
    }

    async function reload() {
      const loaded = client.waitForEvent('Page.loadEventFired')
      await client.send('Page.reload', { ignoreCache: true })
      await loaded
      await delay(600)
    }

    /**
     * Pointer 拖移（PLAN §D2；`sp2/REPORT.md` 第 3 點：只需
     * `Input.dispatchMouseEvent`）。最後一步的座標**就是** `to`——
     * `drag.ts` `onPointerUp` 用的是最後一次 `pointermove` 的座標
     * （`lastClientX/Y`），而非 `pointerup` 事件自身的座標。
     *
     * `sampleExpr` 給定時於按下前／中段／放開後各取樣一次，供案 1 的
     * 「全程 `window.scrollY` 不變」逐階段比對。
     */
    async function pointerDrag(from, to, { steps = 8, sampleExpr = null } = {}) {
      const samples = []
      const sample = async (stage) => {
        if (sampleExpr === null) return
        samples.push({ stage, value: await evaluate(sampleExpr) })
      }
      const at = (t) => ({
        x: Math.round(from.x + (to.x - from.x) * t),
        y: Math.round(from.y + (to.y - from.y) * t),
      })
      const base = { button: 'left', clickCount: 1, pointerType: 'mouse' }
      await sample('before-press')
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at(0), pointerType: 'mouse' })
      await delay(40)
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at(0), ...base, buttons: 1 })
      await delay(50)
      for (let i = 1; i <= steps; i++) {
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at(i / steps), ...base, buttons: 1 })
        await delay(30)
        if (i === Math.ceil(steps / 2)) await sample('mid-drag')
      }
      await delay(60)
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at(1), ...base, buttons: 0 })
      await delay(250)
      await sample('after-release')
      return { samples }
    }

    /**
     * 真滑鼠點擊一個畫布節點以取得焦點（走 `drag.ts` `onPointerDown` →
     * `host.select()` → `node.el.focus()` 的正規路徑）。無位移，故
     * `onPointerUp` 的 `pendingMove` 為 false、commit 時 `moved` 為 false，
     * 不會意外挪動家具。
     */
    async function clickNode(id) {
      const plan = await evaluate(dragPlanExpr(id, 0, 0))
      if (!plan.ok) return { ok: false, symptom: `clickNode(${id}): ${plan.symptom}` }
      const pt = { x: Math.round(plan.from.x), y: Math.round(plan.from.y) }
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pt, pointerType: 'mouse' })
      await delay(30)
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pt, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
      await delay(40)
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pt, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
      await delay(120)
      const active = await evaluate(ACTIVE_EXPR)
      if (active === null || active.dataId !== id) {
        return { ok: false, symptom: `clicking node ${id} did not focus it (activeElement=${JSON.stringify(active)})` }
      }
      return { ok: true }
    }

    /**
     * 真鍵盤事件。帶 `text` 的鍵走 `keyDown`（產生 char 事件，列印字元如
     * `.`／`r` 需要），其餘走 `rawKeyDown`——比照 `e2e-statusline.mjs`
     * `pressEnter`／`pressEscape` 兩種既有型態。
     */
    async function pressKey({ key, code, vk, text = null, modifiers = 0 }) {
      const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
      if (text === null) {
        await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
      } else {
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', text, unmodifiedText: text, ...base })
      }
      await delay(30)
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      await delay(30)
    }

    async function pressEnter() {
      await pressKey({ key: 'Enter', code: 'Enter', vk: 13, text: '\r' })
    }

    /**
     * CPU 節流開關（`rate: 0`／`1` 皆為不節流）。案 6 在同一案內重新 seed ＋
     * 重新載入，需要先關掉節流再導覽——頁面開機（parsePlan ＋首次全量
     * render）在 rate=4 下會拖很久，而那段不是要量的東西。
     */
    async function setCpuThrottlingRate(rate) {
      await client.send('Emulation.setCPUThrottlingRate', { rate })
    }

    // 起手式：先等一次載入完成 → seed → 再載入一次（與 statusline 同形）。
    await navigate()
    await evaluate(seedPlanExpr(testCase.seed))
    await navigate()

    // 案 6／案 7 的 CPU 節流：seed／導覽都跑完才開，否則連頁面啟動都要吃 4×。
    if (testCase.cpuThrottlingRate !== undefined) {
      await setCpuThrottlingRate(testCase.cpuThrottlingRate)
      await delay(300)
    }

    const outcome = await testCase.run({
      evaluate,
      evaluateAsync,
      navigate,
      navigateVia,
      reload,
      pointerDrag,
      clickNode,
      pressKey,
      pressEnter,
      setCpuThrottlingRate,
      delayFn: delay,
      appUrl,
    })
    const durationMs = Date.now() - t0
    if (pageExceptions.length > 0) {
      const list = pageExceptions.map((e) => `  - ${e}`).join('\n')
      console.log(`\n[e2e] uncaught page exception(s) during ${testCase.id}:\n${list}`)
      return {
        success: false,
        symptom: `${pageExceptions.length} uncaught page exception(s) (Runtime.exceptionThrown): ${pageExceptions.join(' | ')}`,
        durationMs,
      }
    }
    return { success: outcome.ok, symptom: outcome.symptom ?? null, note: outcome.note ?? null, durationMs }
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
    const tail = r.symptom ? `\n        symptom: ${r.symptom}` : r.note ? `\n        note: ${r.note}` : ''
    console.log(`  ${r.success ? 'PASS' : 'FAIL'}  ${r.id.padEnd(28)} ${String(r.durationMs).padStart(6)}ms  ${r.label}${tail}`)
  }
  const passCount = results.filter((r) => r.success).length
  console.log(`\n${passCount}/${results.length} passed — total ${totalMs}ms`)

  process.exitCode = passCount === results.length ? 0 : 1
}

main().catch((err) => {
  console.error('[e2e] FATAL', err)
  process.exitCode = 1
})
