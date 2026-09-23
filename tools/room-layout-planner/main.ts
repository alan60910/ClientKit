/**
 * T2.5 — 唯一 orchestrator（(internal design doc)
 * §Recommended approach 呼叫圖「`main.ts` 是 `apply`／`clearance`／
 * `board.renderCommit` 的**唯一 orchestrator**」、§D7 存檔／載入／backup
 * 四時點與「還原上一份」swap、§D10「拖移態統一／commit＝入棧＋autosave＋
 * renderCommit／結構共享／比例文字＝zoom 倍率／`maxGap` 預篩」、
 * §狀態與資料形「UI 態、undo／redo 不經 `apply()`、Delete 後焦點移『還原』」、
 * §Frontend Component tree／Live regions／Keyboard／Motion）。
 *
 * 本檔持有全部可變狀態（`history`／`ui`／`report`），並把三個 DOM 層模組
 * （`board.ts`／`drag.ts`／`panel.ts`）以 host 介面串起來。三條貫穿全檔的
 * 硬契約：
 *
 * 1. **單一狀態轉移入口**——所有 plan 變更只經 `dispatch()` → `apply()`；
 *    undo／redo 是對棧的直接操作、**刻意不經 `apply()`**（PLAN 資料形）。
 * 2. **backup 先於整份覆蓋**（D7 四時點）——`overwriteStoredPlan()` 是唯一
 *    的整份覆蓋通道：先把 `STORAGE_KEY` 的**原始字串**（不 parse→serialize）
 *    搬進 `BACKUP_KEY`，backup `setItem` 擲錯即**中止該次覆蓋**並 `#error`，
 *    呼叫端據 `false` 放棄整個動作（plan 不得改動）。
 * 3. **autosave 為尾沿 debounce ＋ 可重入 flush**（D7／D10）——
 *    `flushAutosave()` 只在有未決計時器時寫入，`visibilitychange`(hidden)
 *    與 `pagehide` 共用同一個函式，重複呼叫為 no-op。
 *
 * **T3.4 拖移期接線**（D10「拖移態統一」／「處置（OQ4 定案）」／「render
 * （OQ5 定案）」）：家具拖移每幀走**輕量狀態路徑**——`dragTo()` →
 * `board.renderDrag()` → `clearanceForMoved()` 增量 → `board.renderOverlay()`
 * （`ui.dragging` 非 null，`overlay.ts` 自行套「只畫 `narrow`＋碰撞」的節點
 * 預算），**不**碰面板與分析清單（它們在 commit 那一幀才更新）。方塊／門的
 * 拖移會改變房型（地板／牆體／外接框），無法只動一個 `<g transform>`，故走
 * 全量 `clearanceWithCache()` ＋ `board.renderCommit()`；節點數少（上限 50
 * 塊／10 扇），成本落在同一個量級。commit／取消／undo／redo／整份覆蓋一律
 * 回到全量路徑，cache 也在那一刻重建。
 *
 * **T4.w M4 io 接線**（D7 JSON 匯出入／PNG 匯出／URL hash 分享）：三個 io
 * 模組（`io-json.ts`／`io-png.ts`／`io-share.ts`）各自持有自己的鈕與 DOM
 * 契約，本檔只提供 host——`getPlan`／`announce`／`showError`／`notice`／
 * `download` 與兩條整份覆蓋通道 `importPlanReplacing()`（backup 時點 (1)）
 * ／`savePreviewAsMine()`（時點 (2)）。**hash 生命週期留在本檔**：開機讀
 * 一次 → 無論成敗立刻 `replaceState` 清 hash → 成功則進預覽態
 * （`ui.fromShare`：autosave 的 debounce 與 flush 皆停用、改記 `ui.dirty`
 * 供 `beforeunload` 守衛判斷），詳見開機載入段與 `scheduleAutosave()`。
 *
 * **預覽態下的整份覆蓋**（D7 r3.4）：「清空」／「匯入 JSON」只換記憶體
 * plan（仍經 `parsePlan`／`apply`），**不**寫 `STORAGE_KEY`／`BACKUP_KEY`
 * 且**維持**預覽態（`adoptPlan()` 特意讓 `fromShare` 跨過 `DEFAULT_UI`
 * 歸零）；「還原上一份」在預覽態直接拒絕並指路。離開預覽態的唯一路徑是
 * `savePreviewAsMine()`（backup 時點 (2)）。
 */
import { initThemeSync, initThemeToggle } from '../../src/theme.js'

import '../../src/style.css'
import './style.css'

import { createBoard } from './board.js'
import { clearanceForMoved, clearanceWithCache, type ClearanceCache } from './clearance.js'
import { attachDrag, type DragController, type DragHost, type NodeKind } from './drag.js'
import type { Rect } from './geometry.js'
import { attachJsonIo } from './io-json.js'
import { attachPngExport } from './io-png.js'
import { attachShare, hashFailureText, readShareHash } from './io-share.js'
import { t } from './messages.js'
import {
  defaultPlan,
  effectiveRect,
  LIMITS,
  type Action,
  type ClearanceReport,
  type RoomPlan,
} from './model.js'
import { attachPanel, type Panel, type PanelHost } from './panel.js'
import { attachProps, type Props } from './props.js'
import {
  attachReportList,
  countReport,
  summaryText,
  EMPTY_COUNTS,
  type ReportCounts,
  type ReportList,
  type ReportListHost,
} from './report-list.js'
import {
  apply,
  beginDrag,
  cancelDrag,
  commit,
  commitDrag,
  createHistory,
  dragTo,
  redo as redoHistory,
  undo as undoHistory,
  type ApplyResult,
  type History,
  type Rejection,
} from './reducer.js'
import { normalize } from './room-shape.js'
import { countDropped, parsePlan } from './serialize.js'
import type { SnapContext } from './snap.js'
import { BACKUP_KEY, STORAGE_KEY } from './storage-keys.js'
import { DEFAULT_UI, ZOOM_STEPS, type UiState } from './ui-state.js'

/** D7：autosave 尾沿 debounce ≥300 ms。 */
export const AUTOSAVE_DEBOUNCE_MS = 300

/** 模組級對外把手（測試與 M4 由此取用；頁面骨架缺席時恆為 `null`）。 */
interface PlannerApp {
  flushAutosave(): void
  importPlanReplacing(raw: string): boolean
  savePreviewAsMine(): boolean
  loadFromHash(): boolean
  isPreview(): boolean
}

let app: PlannerApp | null = null

// ── 主題（比照 `tools/_probe/main.ts`：theme import 最先、任何渲染之前）──
const themeToggle = document.querySelector('.theme-toggle')
if (themeToggle instanceof HTMLElement) {
  initThemeToggle(themeToggle)
  initThemeSync(themeToggle)
}

function createApp(svg: SVGSVGElement): PlannerApp {
  const messages = t()
  const statusEl = document.getElementById('status')
  const errorEl = document.getElementById('error')
  const noticeEl = document.getElementById('io-notice')
  const zoomLabel = document.getElementById('zoom-label')

  /**
   * T3.2：本次動作已單獨播報、仍可被呼叫端的播報句併吞的警示摘要（同一個
   * 任務內有效，見 `announceAction()`）。PLAN §Accessibility「Live regions：
   * **警示數只播報摘要**」要求單一 live region、不重複寫入，故摘要與動作句
   * 併成一串，而非各寫一次。
   */
  let carriedSummary: string | null = null

  // ── live region（PLAN §Implementation notes：一律以「內容變為 X 且未被
  //    後續覆寫」為斷言措辭，故此處只做單純賦值，不做清空再寫的抖動）──
  function announce(text: string): void {
    const out = carriedSummary === null ? text : `${text}；${carriedSummary}`
    carriedSummary = null
    if (statusEl !== null) statusEl.textContent = out
  }

  function showError(text: string): void {
    if (errorEl === null) return
    errorEl.textContent = text
    errorEl.classList.remove('is-empty')
  }

  /**
   * `#io-notice` 的**單一寫入者**（常駐提示，非 live region 播報；T4.w）。
   * 語意釘死為「顯示最新一句」。目前只有兩個來源，且兩者在時間上互斥：
   * autosave 首次失敗的常駐提示（`noteStorageFailure()`）與分享預覽態的提示
   * 句（`io-share.ts` 經 `host.notice`）——預覽態不寫 localStorage，也就不會
   * 觸發 autosave 失敗；而離開預覽態（`savePreviewAsMine()`）會在同一步把
   * 提示清掉。即使日後有交錯，autosave 的提示不受「只播報一次」限制、每次
   * 寫入失敗都會重貼，故被蓋掉也會自動回來。
   */
  function notice(text: string): void {
    if (noticeEl !== null) noticeEl.textContent = text
  }

  /** 下一次成功動作時清掉 `#error`（`role="alert"` 只該留著仍然成立的錯誤）。 */
  function clearError(): void {
    if (errorEl === null || errorEl.classList.contains('is-empty')) return
    errorEl.textContent = ''
    errorEl.classList.add('is-empty')
  }

  // ── localStorage 存取（無痕模式／配額不足時 `getItem` 亦可能擲錯）──
  /** D7：`setItem` 失敗只播報**一次**，避免每 300 ms 洗版；寫入照樣續試。 */
  let storageFailureAnnounced = false

  function readRaw(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  function noteStorageFailure(): void {
    if (!storageFailureAnnounced) {
      storageFailureAnnounced = true
      announce(messages.errors.autosaveFailed)
    }
    // 常駐提示不受「只播報一次」限制：它是狀態顯示，不是 live region。
    notice(messages.ui.autosaveNotice)
  }

  function writeStoredPlan(raw: string): boolean {
    try {
      localStorage.setItem(STORAGE_KEY, raw)
      return true
    } catch {
      noteStorageFailure()
      return false
    }
  }

  /**
   * D7 backup 四時點的**唯一**通道：(1) JSON 匯入成功後 replace 前、
   * (2)「儲存為我的平面圖」按下前、(3) 壞資料整份回落預設前、(4) 清空前。
   *
   * 搬的是 `STORAGE_KEY` 的**原始字串**（不 parse→serialize），backup
   * `setItem` 擲錯即中止該次整份覆蓋並 `#error`、回 `false`——呼叫端必須
   * 據此放棄整個動作，`present` 不得改動。
   */
  function overwriteStoredPlan(nextRaw: string): boolean {
    const currentRaw = readRaw(STORAGE_KEY)
    if (currentRaw !== null) {
      try {
        localStorage.setItem(BACKUP_KEY, currentRaw)
      } catch {
        showError(messages.errors.backupFailed)
        return false
      }
    }
    return writeStoredPlan(nextRaw)
  }

  // ── 狀態 ───────────────────────────────────────────────────────────
  const ui: UiState = { ...DEFAULT_UI }
  let report: ClearanceReport | null = null
  /**
   * 最近一次**全量**分析留下的增量 cache（T3.4）。恆與 `report` 同一幀產出；
   * `null` 只出現在第一次 `recomputeReport()` 之前。
   */
  let cache: ClearanceCache | null = null
  let panel: Panel | null = null
  /** T5.3：目前選取物件的屬性欄（`#props-section`），與 panel 共用同一 host。 */
  let props: Props | null = null
  let reportList: ReportList | null = null
  let drag: DragController | null = null
  /** 上一次**已播報過**的四類警示數快照（T3.2 摘要播報的比較基準）。 */
  let lastCounts: ReportCounts = EMPTY_COUNTS

  // ── 開機載入（D7：四條載入路徑皆經 `parsePlan`；順序＝hash → localStorage）
  let bootNotice: string | null = null
  let bootError: string | null = null
  /** hash 三種失敗的 `#error` 文案；優先於 `bootError` 顯示（見首次渲染段）。 */
  let hashError: string | null = null

  /**
   * D7「URL hash 分享」生命週期：`DOMContentLoaded` 讀**一次**，且無論成敗
   * 都立刻清掉 hash——重新整理不該再吃同一份分享，失敗時留著 hash 也只會讓
   * 同一則錯誤重播。成功 → 進預覽態（`ui.fromShare`），**完全不觸碰
   * localStorage**（不寫 backup、不 autosave）；失敗 → 一次 `#error` 後照常
   * 走 localStorage 路徑（失敗本身不寫任何 key）。
   *
   * 注意：`history` 在本函式內是 undo 棧的區域變數，故清 hash 必須寫成
   * `window.history.replaceState`，不可裸用 `history`。
   */
  const shared = readShareHash(window.location.hash)
  if (shared !== null) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    if (!shared.ok) hashError = hashFailureText(shared.reason, messages)
  }

  let initialPlan: RoomPlan
  if (shared !== null && shared.ok) {
    initialPlan = shared.plan
    ui.fromShare = true
    ui.dirty = false
    // T4.8：只計「真的丟棄」筆數——`maxItems-raised` 等資訊性 note 不觸發
    // 「存檔有 N 處無法辨識」播報（否則舊版存檔一超過軟上限就誤報）。
    const sharedDropCount = countDropped(shared.dropped).drop
    if (sharedDropCount > 0) {
      bootNotice = messages.status.planRepaired(sharedDropCount)
    }
  } else {
    const storedRaw = readRaw(STORAGE_KEY)
    if (storedRaw === null) {
      initialPlan = defaultPlan()
    } else {
      const parsed = parsePlan(storedRaw)
      if (parsed.ok) {
        initialPlan = parsed.plan
        const localDropCount = countDropped(parsed.dropped).drop
        if (localDropCount > 0) {
          bootNotice = messages.status.planRepaired(localDropCount)
        }
      } else {
        // backup 時點 (3)：壞資料整份回落預設前先搬原始字串。
        initialPlan = defaultPlan()
        overwriteStoredPlan(JSON.stringify(initialPlan))
        bootError = messages.errors.storedPlanInvalid
      }
    }
  }
  let history: History = createHistory(initialPlan)

  const board = createBoard({ svg, zoomLabel, messages })

  // ── autosave（D7：尾沿 debounce ≥300 ms＋可重入 flush）──────────────
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null

  function cancelAutosave(): void {
    if (autosaveTimer === null) return
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }

  function scheduleAutosave(): void {
    /**
     * 預覽態（D7）：debounce 與 flush 皆停用，不觸碰 localStorage；改為標記
     * `ui.dirty`（`io-share.ts` 的 `beforeunload` 守衛判準＝`fromShare &&
     * dirty`）。本函式正好是「`present` 真的變了」的**單一匯流點**——
     * `dispatch()` 的變更分支、`dragCommit()` 的 `moved` 分支、undo／redo
     * 的 `applyHistory()` 三處都會走到這裡，故髒旗標只在此寫一次，不散落。
     * 反向歸零在 `adoptPlan()`（`Object.assign(ui, DEFAULT_UI)`）與
     * `savePreviewAsMine()`。
     */
    if (ui.fromShare) {
      ui.dirty = true
      return
    }
    cancelAutosave()
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null
      // 存的是**完整** plan（含 deleted）；`stripDeleted` 只用於匯出（D7）。
      writeStoredPlan(JSON.stringify(history.present))
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  /**
   * 可重入：有未決計時器才寫，否則 no-op（兩個卸載事件共用同一個函式）。
   * 預覽態一律 no-op（D7：「debounce 與 flush **皆**停用」）——否則
   * `visibilitychange`／`pagehide` 會把別人分享的平面圖寫進 `STORAGE_KEY`。
   */
  function flushAutosave(): void {
    if (ui.fromShare) return
    if (autosaveTimer === null) return
    cancelAutosave()
    writeStoredPlan(JSON.stringify(history.present))
  }

  // ── 渲染 ───────────────────────────────────────────────────────────
  /**
   * D4／OQ4 兩路徑：「顯示距離」**關閉**時以 `maxGap = adviseBelow` 預篩
   * （此時 `ok` 通道本來就不畫，使用者可見行為零變化）；開啟時不預篩、
   * 走完整路徑。`undefined` ＝不預篩。
   */
  function maxGapOpt(): number | undefined {
    return ui.showDistance ? undefined : history.present.settings.adviseBelow
  }

  /**
   * 全量分析（T3.4：一併重建增量 cache）。**任何**會動到房型、家具集合、
   * 三閾值或 `maxGap` 預篩口徑的路徑都必須走這裡——`clearanceForMoved()`
   * 的前提就是「除了被拖的那一件家具，其餘一切沒動」。
   */
  function recomputeReport(): void {
    const result = clearanceWithCache(history.present, { maxGap: maxGapOpt() })
    report = result.report
    cache = result.cache
  }

  /**
   * 拖移期的家具增量（D10「處置（OQ4 定案）」備案）：`report` 與
   * `clearance(plan, cache.opts)` 逐字相同，只是省下與被拖家具無關的配對
   * 與遮擋掃描。
   *
   * 兩道退回全量的關卡：(1) cache 尚未建立、或 `maxGap` 預篩口徑與本幀不符
   * （cache 的 `opts` 是綁死的，`clearanceForMoved()` 不會察覺「顯示距離」
   * 已切換）；(2) `movedId` 不是未刪除家具時它會擲 `TypeError`——那代表呼叫
   * 端用錯路徑，此處不靜默吞掉語意，但也不讓拖移中斷，本幀改走全量。
   * 房型／閾值／家具集合變動的前提檢查由 `clearanceForMoved()` 自行負責。
   */
  function recomputeMovedReport(id: string): void {
    const current = cache
    if (current === null || current.opts.maxGap !== maxGapOpt()) {
      recomputeReport()
      return
    }
    try {
      const result = clearanceForMoved(current, history.present, id)
      report = result.report
      cache = result.cache
    } catch {
      recomputeReport()
    }
  }

  const btnUndo = document.getElementById('btn-undo') as HTMLButtonElement | null
  const btnRedo = document.getElementById('btn-redo') as HTMLButtonElement | null
  const btnPurge = document.getElementById('btn-purge') as HTMLButtonElement | null

  function syncToolbar(): void {
    if (btnUndo !== null) btnUndo.disabled = history.past.length === 0
    if (btnRedo !== null) btnRedo.disabled = history.future.length === 0
    if (btnPurge !== null) {
      btnPurge.disabled = !history.present.items.some((item) => item.deleted === true)
    }
  }

  function render(): void {
    board.renderCommit(history.present, ui, report)
    panel?.render(history.present, ui, report)
    // 屬性欄只看 `ui.selectedId`，故畫布／拖移／清單／分析清單任一處改選取
    // 都會經 `setUi()`／`dragHost.select()` 走到這裡重繪（T5.3）。
    props?.render(history.present, ui, report)
    reportList?.render(history.present, ui, report)
    syncToolbar()
  }

  // ── 警示摘要播報（T3.2；PLAN §Accessibility「警示數只播報摘要」）───────
  //
  // 「警示」＝`narrow`＋碰撞＋`sideViolations`＋`doorViolations`（D3）；
  // `tight` 是提示、不算警示，故不觸發播報（但出現在摘要句後綴裡）。

  function currentCounts(): ReportCounts {
    return report === null ? EMPTY_COUNTS : countReport(report)
  }

  /** 靜默對齊快照：整份覆蓋／取消拖移／切換顯示距離等「非動作」路徑用。 */
  function syncCounts(): void {
    lastCounts = currentCounts()
  }

  /** 四類警示數自上次快照後有變則回摘要句（並更新快照），否則回 `null`。 */
  function takeWarningSummary(): string | null {
    const counts = currentCounts()
    const changed =
      counts.narrow !== lastCounts.narrow ||
      counts.collisions !== lastCounts.collisions ||
      counts.side !== lastCounts.side ||
      counts.door !== lastCounts.door
    lastCounts = counts
    return changed ? summaryText(counts, messages) : null
  }

  /**
   * 動作播報的單一出口：把動作句與警示摘要併成**一串**寫進 `#status`。
   *
   * 動作本身沒有播報句時（如 `item/add` 由 `panel.ts` 事後播 `itemAdded`）
   * 先單獨播摘要，並留在 `carriedSummary` 讓同一個任務內後續的 `announce()`
   * 併吞——如此既不會漏播（沒人接手時摘要已在畫面上），也不會寫兩次。
   */
  function announceAction(text: string | null): void {
    carriedSummary = null
    const summary = takeWarningSummary()
    if (text !== null) {
      announce(summary === null ? text : `${text}；${summary}`)
      return
    }
    if (summary === null) return
    if (statusEl !== null) statusEl.textContent = summary
    carriedSummary = summary
  }

  // ── 播報組句 ───────────────────────────────────────────────────────
  function rejectionText(rejection: Rejection): string {
    switch (rejection.reason) {
      case 'limit-items':
        // T4.7：家具走軟上限，播報要帶「可於設定調高（最多 75 件）」的出路。
        return messages.status.itemCapReached(history.present.settings.maxItems, LIMITS.items)
      case 'limit-blocks':
        return messages.status.limitReached('結構', LIMITS.blocks)
      case 'limit-doors':
        return messages.status.limitReached('門', LIMITS.doors)
      case 'wall-cap':
        return messages.status.wallCapExceeded(rejection.walls ?? LIMITS.walls, LIMITS.walls)
      case 'door-invalid':
        return messages.status.doorInvalid
      case 'not-found':
        return messages.status.notFound
      default:
        return messages.status.invalidInput
    }
  }

  /**
   * 成功動作的播報句；回 `null` 代表交給呼叫端自行播報（如 `item/add`
   * 由 `panel.ts` 播 `itemAdded`，避免同一次操作播報兩遍）。
   */
  function successText(action: Action, plan: RoomPlan): string | null {
    switch (action.type) {
      case 'item/move': {
        const item = plan.items.find((candidate) => candidate.id === action.id)
        if (item === undefined) return null
        const rect = effectiveRect(item)
        return messages.status.itemMoved(item.name, rect.x0, rect.y0)
      }
      case 'item/rotate': {
        const item = plan.items.find((candidate) => candidate.id === action.id)
        return item === undefined ? null : messages.status.itemRotated(item.name, item.rotation)
      }
      case 'item/delete': {
        const item = plan.items.find((candidate) => candidate.id === action.id)
        return item === undefined ? null : messages.status.itemDeleted(item.name)
      }
      case 'item/restore': {
        const item = plan.items.find((candidate) => candidate.id === action.id)
        return item === undefined ? null : messages.status.itemRestored(item.name)
      }
      case 'block/move': {
        const block = plan.room.blocks.find((candidate) => candidate.id === action.id)
        return block === undefined ? null : messages.status.blockMoved(block.x, block.y)
      }
      case 'door/move': {
        const door = plan.room.doors.find((candidate) => candidate.id === action.id)
        return door === undefined ? null : messages.status.doorMoved(door.x, door.y)
      }
      default:
        return null
    }
  }

  // ── 單一狀態轉移入口 ───────────────────────────────────────────────
  /**
   * D10 commit-then-handle：靜默期間收到任何非 move action 先立刻 commit
   * 當前鍵盤拖移態，再處理該 action。成功即入棧＋autosave＋重算 report＋
   * 重繪；被拒則回原 plan 參考並播報拒絕原因（面板據回傳值標欄位錯誤）。
   */
  function dispatch(action: Action): ApplyResult {
    drag?.commitNow()
    // 前一個動作（含 commit-then-handle 剛結掉的拖移）留下的摘要不得沾到本次。
    carriedSummary = null
    const result = apply(history.present, action)
    if (!result.ok) {
      announce(rejectionText(result.rejection))
      return result
    }
    if (result.plan !== history.present) {
      history = commit(history, result.plan)
      scheduleAutosave()
    }
    clearError()
    recomputeReport()
    render()
    announceAction(successText(action, history.present))
    return result
  }

  // ── 磁吸脈絡（`snap.ts` 契約：呼叫端須排除被拖者自身）────────────────
  function snapContext(kind: NodeKind, id: string): SnapContext {
    const plan = history.present
    const shape = normalize(plan.room)
    const neighbors: Rect[] = []
    for (const item of plan.items) {
      if (item.deleted === true) continue
      if (kind === 'item' && item.id === id) continue
      neighbors.push(effectiveRect(item))
    }
    return {
      grid: plan.settings.snap,
      magnet: plan.settings.ignoreBelow,
      edges: shape.edges,
      neighbors,
    }
  }

  /** 節點目前**已提交**的左上角（家具取有效外框）；供 `renderDrag` 算位移。 */
  function positionOf(kind: NodeKind, id: string): { x: number; y: number } | null {
    const plan = history.present
    if (kind === 'item') {
      const item = plan.items.find((candidate) => candidate.id === id)
      if (item === undefined) return null
      const rect = effectiveRect(item)
      return { x: rect.x0, y: rect.y0 }
    }
    if (kind === 'block') {
      const block = plan.room.blocks.find((candidate) => candidate.id === id)
      return block === undefined ? null : { x: block.x, y: block.y }
    }
    const door = plan.room.doors.find((candidate) => candidate.id === id)
    return door === undefined ? null : { x: door.x, y: door.y }
  }

  /** 拖移 commit 後的播報句（交給 `announceAction()` 與警示摘要併成一串）。 */
  function movedText(kind: NodeKind, id: string): string | null {
    const action: Action =
      kind === 'item'
        ? { type: 'item/move', id, x: 0, y: 0 }
        : kind === 'block'
          ? { type: 'block/move', id, x: 0, y: 0 }
          : { type: 'door/move', id, x: 0, y: 0 }
    return successText(action, history.present)
  }

  // ── 拖移宿主（D10 拖移態統一：期間不入棧、不 autosave）──────────────
  const dragHost: DragHost = {
    getPlan: () => history.present,
    getUi: () => ui,
    messages,
    getBoardRect: () => svg.getBoundingClientRect(),
    getViewBox: () => board.getViewBox(),
    snapContext,
    select(kind, id) {
      carriedSummary = null
      ui.selectedId = id
      render()
      const label = board.node(kind, id)?.getAttribute('aria-label')
      if (label !== null && label !== undefined) announce(label)
    },
    dragBegin(kind, id, source) {
      ui.dragging = beginDrag(history, id, kind, source)
    },
    /**
     * T3.4 拖移期每幀（D10 render／OQ5 定案）。兩條路徑：
     *
     * - **家具**——`renderDrag()`（只動被拖節點的 `transform`）→
     *   `clearanceForMoved()` 增量 → `renderOverlay()`（`ui.dragging` 非
     *   null，`overlay.ts` 只畫 `narrow`＋碰撞）。面板與分析清單**刻意不畫**
     *   （D10「期間走輕量狀態路徑」），它們在 commit 那一幀一次補上。
     * - **方塊／門**——會改變房型（地板／牆體／外接框都要重推），只動一個
     *   `<g transform>` 會讓地板跟不上，故走全量＋`renderCommit()`。節點數
     *   受 D10 上限（50 塊／10 扇）保護。
     *
     * 位移被拒或夾框後**原地未動**時 `dragTo()` 回同一個 History 參考——
     * 此時 plan 沒變、畫面已經是對的，整幀直接跳過（指標路徑一秒可收到
     * 數十個同格事件，這條是單幀 ≤16.7 ms 的第一道閥）。
     */
    dragMove(kind, id, x, y) {
      const state = ui.dragging
      if (state === null) return
      const previous = history
      history = dragTo(history, state, x, y)
      if (history === previous) return
      if (kind !== 'item') {
        recomputeReport()
        board.renderCommit(history.present, ui, report)
        return
      }
      // D2：拖移期只動 `<g transform>`，`x`/`y` 與 `aria-label` commit 才回寫。
      const position = positionOf(kind, id)
      if (position !== null) board.renderDrag(id, kind, position.x, position.y)
      recomputeMovedReport(id)
      board.renderOverlay(history.present, ui, report)
    },
    dragCancel() {
      const state = ui.dragging
      if (state === null) return
      const cancelled = cancelDrag(history, state)
      history = cancelled.history
      // `ui.dragging` 必須在 `render()` 之前歸零：overlay 的節點預算看的就是
      // 它，否則取消後畫面會停在「只有 narrow＋碰撞」的拖移態。
      ui.dragging = null
      board.clearDrag(state.id)
      // 拖移期的增量 report／cache 在此作廢，回 origin 後重建全量。
      recomputeReport()
      // 取消＝回到 origin：警示數本來就該回到拖移前，靜默對齊、不播報。
      syncCounts()
      render()
    },
    dragCommit() {
      const state = ui.dragging
      if (state === null) return
      const moved = !state.cancelled && history.present !== state.origin
      history = commitDrag(history, state)
      // 同 `dragCancel()`：先歸零 `ui.dragging`，`render()` 的 overlay 才會
      // 把拖移期省下的 `tight`／`ok`／門洞／各面需留／門違規補回來。
      ui.dragging = null
      board.clearDrag(state.id)
      if (moved) {
        // D10 commit＝入棧＋autosave＋`renderCommit`；順帶把增量 cache 換成
        // 全量的那一份（下一次拖移自此接力）。
        recomputeReport()
        scheduleAutosave()
      }
      render()
      if (moved) announceAction(movedText(state.kind, state.id))
    },
    dispatch(action) {
      dispatch(action)
    },
    announce,
    focusRestoreButton(id) {
      panel?.restoreButton(id)?.focus()
    },
  }

  // ── 面板／分析清單宿主 ─────────────────────────────────────────────
  //
  // 兩份宿主共用同一個 `setUi()`：它收**完整** `Partial<UiState>`，比
  // `PanelHost`／`ReportListHost` 各自宣告的窄型別寬，賦值方向合法（函式
  // 參數逆變），故不需要改 `panel.ts` 的介面就能多收 `reportPage`。
  function setUi(patch: Partial<UiState>): void {
    carriedSummary = null
    // 「顯示距離」切換會換掉 `maxGap` 預篩路徑（D4），須重算 report——且
    // **必須走 `recomputeReport()`（`clearanceWithCache`）**：cache 的 `opts`
    // 是綁死的，增量路徑不會察覺預篩口徑已變（T3.4 cache 失效）。三閾值／
    // 網格／迴旋區走 `settings/update` → `dispatch()`，同樣落在全量路徑上。
    const distanceChanged = patch.showDistance !== undefined && patch.showDistance !== ui.showDistance
    Object.assign(ui, patch)
    if (distanceChanged) {
      recomputeReport()
      // 預篩只影響 `ok` 通道輸出，四類警示數不變（D4 兩路徑契約），但仍
      // 對齊快照，避免 `ok`／不評級數的變動被誤讀為警示變動。
      syncCounts()
    }
    render()
  }

  function focusBoardNode(kind: NodeKind, id: string): void {
    board.focus(kind, id)
  }

  const panelHost: PanelHost = {
    getPlan: () => history.present,
    getUi: () => ui,
    messages,
    dispatch,
    setUi,
    focusBoardNode,
    announce,
  }

  const reportListHost: ReportListHost = {
    getPlan: () => history.present,
    getUi: () => ui,
    messages,
    setUi,
    focusBoardNode,
    announce,
  }

  panel = attachPanel(document, panelHost)
  props = attachProps(document, panelHost)
  reportList = attachReportList(document, reportListHost)
  drag = attachDrag(svg, dragHost)

  // ── M4 io 接線（T4.w：JSON／PNG／分享）──────────────────────────────
  /**
   * 檔案下載（JSON 與 PNG 共用的唯一實作）：`<a download>` ＋
   * `URL.createObjectURL`。無 `URL.createObjectURL` 的環境特徵偵測後為
   * no-op——`io-json.ts` 仍可由 `lastExport` 取內容、`io-png.ts` 仍會播報，
   * 不讓匯出整條路徑擲錯。
   */
  function downloadBlob(blob: Blob, filename: string): void {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  // 匯出讀的是 `history.present`（含預覽態），符合 D7「預覽態下匯出 JSON／
  // PNG／複製連結皆可用」；`importPlanReplacing` 內含 backup 時點 (1)。
  attachJsonIo(document, {
    getPlan: () => history.present,
    messages,
    importPlanReplacing,
    announce,
    showError,
    download: downloadBlob,
  })

  attachPngExport(document, {
    getSvg: () => svg,
    getBounds: () => board.getBounds(),
    announce,
    showError,
    download: downloadBlob,
  })

  /**
   * `io-share.ts` 內部已用 `isPreview()`／`isDirty()` 組出
   * `installPreviewGuard()` 的判準並掛上 `beforeunload`，本檔**不得**再掛
   * 一次（D7：`fromShare && dirty` 時掛一條守衛）。
   */
  const shareIo = attachShare(document, {
    getPlan: () => history.present,
    messages,
    isPreview: () => ui.fromShare,
    isDirty: () => ui.dirty,
    announce,
    showError,
    notice,
    savePreviewAsMine,
    onExitPreview: () => {
      render()
    },
  })

  // ── undo／redo（對棧的直接操作，**不經 `apply()`**；PLAN 資料形）──────
  function applyHistory(next: History, text: string): void {
    if (next === history) return
    history = next
    ui.dragging = null
    recomputeReport()
    render()
    scheduleAutosave()
    announceAction(text)
  }

  function undoStep(): void {
    drag?.commitNow()
    applyHistory(undoHistory(history), messages.status.undone)
  }

  function redoStep(): void {
    drag?.commitNow()
    applyHistory(redoHistory(history), messages.status.redone)
  }

  // ── 整份覆蓋的三條路徑（皆共用 `overwriteStoredPlan()`）──────────────
  /**
   * 覆蓋成功後的共同收尾：history 重置、UI 態歸零、重算重繪。
   *
   * **預覽態跨得過 `DEFAULT_UI` 歸零**（D7 r3.4）：預覽態下的「清空」／
   * 「匯入 JSON」只換記憶體 plan，**不**代表預覽結束——`fromShare` 一旦被
   * `Object.assign(ui, DEFAULT_UI)` 抹掉，autosave 就會重新啟用並把別人分享
   * 的（或剛清空的）平面圖寫進使用者自己的 `STORAGE_KEY`。同時標記
   * `dirty`，讓 `io-share.ts` 的 `beforeunload` 守衛繼續攔離開。離開預覽態的
   * **唯一**路徑仍是 `savePreviewAsMine()`。
   */
  function adoptPlan(plan: RoomPlan): void {
    const keepPreview = ui.fromShare
    history = createHistory(plan)
    Object.assign(ui, DEFAULT_UI)
    if (keepPreview) {
      ui.fromShare = true
      ui.dirty = true
    }
    recomputeReport()
    // 整份覆蓋（清空／匯入／還原上一份）自有專屬播報句，警示數差異在此
    // 沒有可對照的「上一步」，故靜默對齊快照、不追加摘要。
    carriedSummary = null
    syncCounts()
    render()
    clearError()
  }

  /**
   * backup 時點 (4)：清空前（confirm）。
   *
   * **預覽態只換記憶體 plan**（D7 r3.4）：使用者的心智是「清掉這份分享」，
   * 而不是「把我自己的存檔清成空白」——故預覽態下不寫 `STORAGE_KEY`、不寫
   * backup、維持預覽態，問句也換成不承諾備份的那一句。
   */
  function clearAll(): void {
    const question = ui.fromShare ? messages.ui.confirmClearPreview : messages.ui.confirmClear
    if (!window.confirm(question)) return
    drag?.commitNow()
    // 未決的 autosave 會在覆蓋後把舊 plan 寫回去，必須先取消。
    cancelAutosave()
    const fresh = defaultPlan()
    if (ui.fromShare) {
      adoptPlan(fresh)
      announce(messages.status.planCleared)
      return
    }
    if (!overwriteStoredPlan(JSON.stringify(fresh))) return
    adoptPlan(fresh)
    announce(messages.status.planCleared)
  }

  /**
   * backup 時點 (1)：JSON 匯入成功後 replace 前（`io-json.ts` 由此接線）。
   * 預覽態同 `clearAll()`：照樣走 `parsePlan`＋`apply`，但只換記憶體 plan
   * ——不寫 `STORAGE_KEY`、不寫 backup、維持預覽態（D7 r3.4）。
   */
  function importPlanReplacing(raw: string): boolean {
    const parsed = parsePlan(raw)
    if (!parsed.ok) {
      showError(messages.errors.importFailed)
      return false
    }
    drag?.commitNow()
    cancelAutosave()
    const replaced = apply(history.present, { type: 'plan/replace', plan: parsed.plan })
    if (!replaced.ok) {
      showError(messages.errors.importFailed)
      return false
    }
    if (ui.fromShare) {
      adoptPlan(replaced.plan)
      announce(messages.status.planImported)
      return true
    }
    if (!overwriteStoredPlan(JSON.stringify(replaced.plan))) return false
    adoptPlan(replaced.plan)
    announce(messages.status.planImported)
    return true
  }

  /**
   * backup 時點 (2)：「儲存為我的平面圖」按下前。存的是**完整**
   * `history.present`（與 autosave 同口徑，含 `deleted`；`stripDeleted` 只用
   * 於匯出／分享編碼）。backup 或本體寫入失敗即整個動作放棄、預覽態不變。
   *
   * 成功後一併把預覽態 UI 收掉：`io-share.ts` 只在**自己的按鈕**路徑上同步
   * UI，本函式也可能由別處（e2e／未來的鍵盤捷徑）直呼，故在此統一處理；
   * 兩條路徑的效果皆為冪等，重複呼叫無副作用。
   */
  function savePreviewAsMine(): boolean {
    cancelAutosave()
    if (!overwriteStoredPlan(JSON.stringify(history.present))) return false
    ui.fromShare = false
    ui.dirty = false
    // 預覽態的常駐提示已不成立（這份平面圖現在是自己的了）。
    notice('')
    shareIo.setPreviewUi(false)
    render()
    announce(messages.status.savedAsMine)
    return true
  }

  /**
   * D7 生命週期：hash 於 `createApp()` 開機時讀**一次**（見開機載入段），
   * 本函式只回報「這次開機是否自分享連結載入」，**不重讀** `location.hash`
   * ——hash 在開機當下就已被 `replaceState` 清掉，重讀恆為空。想知道「現在
   * 是否仍在預覽態」請用 `isPreview()`（存檔為自己的之後即為 `false`）。
   */
  function loadFromHash(): boolean {
    return shared !== null && shared.ok
  }

  /** 目前是否仍在分享預覽態（`ui.fromShare`）。 */
  function isPreview(): boolean {
    return ui.fromShare
  }

  /**
   * D7「還原上一份」＝**swap**：原 `STORAGE_KEY` 字串搬進 `BACKUP_KEY`、
   * backup 成為 current，連按兩次回原狀。`parsePlan` 整份失敗 → `#error`、
   * plan 與兩把 key 皆不動。
   *
   * **預覽態一律拒絕**（D7 r3.4）：swap 必定寫兩把 key，與「預覽態不觸碰
   * localStorage」直接衝突；且使用者按這顆鈕時想救的是自己的平面圖，若在
   * 預覽態下執行，畫面會換成 backup、預覽內容無聲消失。故只在 `#io-notice`
   * 指路「儲存為我的平面圖」，兩把 key 與畫面皆不動。
   */
  function restoreBackup(): void {
    if (ui.fromShare) {
      notice(messages.ui.restoreBlockedInPreview)
      return
    }
    const backupRaw = readRaw(BACKUP_KEY)
    if (backupRaw === null) {
      announce(messages.status.noBackup)
      return
    }
    const parsed = parsePlan(backupRaw)
    if (!parsed.ok) {
      showError(messages.errors.importFailed)
      return
    }
    drag?.commitNow()
    cancelAutosave()
    const currentRaw = readRaw(STORAGE_KEY)
    // 先寫 backup 端：此時兩份字串都還在手上，失敗則什麼都沒動。
    try {
      if (currentRaw === null) localStorage.removeItem(BACKUP_KEY)
      else localStorage.setItem(BACKUP_KEY, currentRaw)
    } catch {
      showError(messages.errors.backupFailed)
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, backupRaw)
    } catch {
      // 回滾 backup 端，維持「plan 與兩把 key 皆不動」。
      try {
        localStorage.setItem(BACKUP_KEY, backupRaw)
      } catch {
        // 兩邊都寫不進去：此時 backup 已遺失，只能照實回報。
      }
      noteStorageFailure()
      return
    }
    adoptPlan(parsed.plan)
    announce(messages.status.backupRestored)
  }

  /** 「清空已刪除」（`item/purge` 只由本鈕觸發，D7／Implementation notes）。 */
  function purgeDeleted(): void {
    const count = history.present.items.filter((item) => item.deleted === true).length
    if (count === 0) return
    if (!window.confirm(messages.ui.confirmPurge)) return
    const result = dispatch({ type: 'item/purge' })
    if (result.ok) announce(messages.status.itemsPurged(count))
  }

  // ── 畫布工具列（D1：zoom 一律改 viewBox；拖移中凍結）──────────────
  function nearestZoomIndex(zoom: number): number {
    let best = 0
    let bestDiff = Number.POSITIVE_INFINITY
    for (let i = 0; i < ZOOM_STEPS.length; i++) {
      const diff = Math.abs(ZOOM_STEPS[i] - zoom)
      if (diff < bestDiff) {
        bestDiff = diff
        best = i
      }
    }
    return best
  }

  function stepZoom(delta: 1 | -1): void {
    if (ui.dragging !== null) return
    const index = nearestZoomIndex(ui.zoom) + delta
    if (index < 0 || index >= ZOOM_STEPS.length) return
    const next = ZOOM_STEPS[index]
    if (next === ui.zoom) return
    ui.zoom = next
    board.setView(ui.zoom, ui.panX, ui.panY)
  }

  function fitView(): void {
    if (ui.dragging !== null) return
    ui.zoom = 1
    ui.panX = 0
    ui.panY = 0
    board.setView(1, 0, 0)
  }

  function onClick(id: string, handler: () => void): void {
    document.getElementById(id)?.addEventListener('click', handler)
  }

  onClick('btn-undo', undoStep)
  onClick('btn-redo', redoStep)
  onClick('btn-clear', clearAll)
  onClick('btn-purge', purgeDeleted)
  onClick('btn-restore-backup', restoreBackup)
  onClick('btn-fit', fitView)
  onClick('btn-zoom-in', () => stepZoom(1))
  onClick('btn-zoom-out', () => stepZoom(-1))

  // ── flush（D7：兩個事件共用可重入 `flushAutosave()`）──────────────
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutosave()
  })
  window.addEventListener('pagehide', () => {
    flushAutosave()
  })

  // ── 首次渲染 ───────────────────────────────────────────────────────
  // 預覽態的 UI（D7：`#btn-save-shared` 現身＋`#io-notice` 常駐提示句）；
  // hash 本身已在開機載入段讀畢並清除。
  if (ui.fromShare) shareIo.setPreviewUi(true)
  recomputeReport()
  // 開機不播報警示摘要（沒有「上一步」可比），只把快照對齊到初始狀態。
  syncCounts()
  render()
  // hash 失敗是本次開機的**動作結果**，優先於存檔毀損的狀態陳述。
  if (hashError !== null) showError(hashError)
  else if (bootError !== null) showError(bootError)
  // 單一 live region：預覽態提示與「存檔已修復」提示併成一串寫入，
  // 避免後者把前者蓋掉（沿 `announceAction()` 的併句慣例）。
  const bootAnnouncements: string[] = []
  if (ui.fromShare) bootAnnouncements.push(messages.status.previewLoaded)
  if (bootNotice !== null) bootAnnouncements.push(bootNotice)
  if (bootAnnouncements.length > 0) announce(bootAnnouncements.join('；'))

  return { flushAutosave, importPlanReplacing, savePreviewAsMine, loadFromHash, isPreview }
}

// 頁面骨架存在才啟動（其餘 import 本檔的情境——如單元測試——不受影響）。
const boardHost = document.getElementById('board-svg')
if (boardHost !== null) {
  app = createApp(boardHost as unknown as SVGSVGElement)
}

/** 立刻寫入未決的 autosave（可重入；無未決計時器時為 no-op）。 */
export function flushAutosave(): void {
  app?.flushAutosave()
}

/** D7 backup 時點 (1)：整份覆蓋前先搬原始字串進 `BACKUP_KEY`。 */
export function importPlanReplacing(raw: string): boolean {
  return app?.importPlanReplacing(raw) ?? false
}

/** D7 backup 時點 (2)：預覽態的「儲存為我的平面圖」。 */
export function savePreviewAsMine(): boolean {
  return app?.savePreviewAsMine() ?? false
}

/** 這次開機是否自分享連結載入（D7：hash 只在開機讀一次，讀後即清除）。 */
export function loadFromHash(): boolean {
  return app?.loadFromHash() ?? false
}

/** 目前是否仍在分享預覽態（存檔為自己的之後即為 `false`）。 */
export function isPreview(): boolean {
  return app?.isPreview() ?? false
}
