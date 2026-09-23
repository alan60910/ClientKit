/**
 * T2.3 — 畫布拖移與鍵盤等效（(internal design doc) §D2
 * 「拖移實作：Pointer Events」、§D10「拖移態統一」、§Frontend
 * Accessibility checklist「Keyboard」、§Recommended approach `drag.ts` 段）。
 *
 * 本檔只做**事件接線與拖移態機**，不碰 reducer、不改 DOM 內容：
 * - 監聽一律**委派在 `<svg>` 上**（家具節點由 `board.ts` 建立／更新，本檔
 *   不持有節點參考），命中以 `closest('[data-kind][data-id]')` 判定。
 * - 指標像素 → cm 的換算走 `geometry.ts` 的純函式 `pxToCm()`（D2：jsdom
 *   無 `getScreenCTM`／`createSVGPoint`，換算必須獨立於 DOM 才能 node 直測）。
 * - `setPointerCapture`／`releasePointerCapture` 一律**特徵偵測＋try/catch**
 *   （D2：jsdom 29.1.1 有 `PointerEvent` 建構子但無 capture 三件）。
 * - `pointermove` 以 rAF 合併；三個出口（`pointerup`／`pointercancel`／
 *   `lostpointercapture`）一律先 `cancelAnimationFrame(pending)` 再 commit
 *   或取消（D2）。
 * - **門的指標落點吸到極大牆段**（T5.2，M5 回饋 2）：`moveTo()` 對
 *   `kind:'door'` 取 `snapContext().edges` 上的最近點（`DOOR_SNAP_CM`
 *   內才吸）。命中區由 `board.ts` 的 `.door-hit` 提供，委派選擇器不變。
 * - 拖移態單一機制、指標與鍵盤共用；commit 觸發由 `source` 決定——
 *   pointer → `pointerup`；keyboard → 最後一次按鍵後 `KEYBOARD_QUIET_MS`
 *   靜默（D10）。靜默期間收到 undo／其他 action／`pointerdown` →
 *   **先 commit 再處理**（`commitNow()`）。
 *
 * 與 host 的分工：本檔**只呼叫** `getPlan`／`getUi`／`getBoardRect`／
 * `getViewBox`／`snapContext`／`select`／`dragBegin`／`dragMove`／
 * `dragCancel`／`dragCommit`／`dispatch`／`focusRestoreButton`。
 * `messages`／`announce`／`dragInterrupt` 屬 host 自身接線的一部分（播報
 * 一律由 host 於 `select`／`dragCommit`／`dispatch` 後發出，避免同一次
 * 操作播報兩遍），列於 `DragHost` 僅為維持 `main.ts` 的單一介面。
 */
import { nearestPointOnEdges } from './door.js'
import { pxToCm } from './geometry.js'
import type { BoardRect, ViewBox } from './geometry.js'
import { effectiveRect, effectiveSize } from './model.js'
import type { Action, RoomPlan } from './model.js'
import { snapPosition } from './snap.js'
import type { SnapContext } from './snap.js'
import type { Messages } from './messages.js'
import type { UiState } from './ui-state.js'

/** 可拖移節點的三種種類（`data-kind`）。 */
export type NodeKind = 'item' | 'block' | 'door'

/**
 * `main.ts` 提供給本檔的宿主介面。本檔不直接讀寫 plan／history／DOM 內容，
 * 一切狀態轉移都經此介面回呼（PLAN §呼叫圖：`main.ts` 是 `apply`／
 * `clearance`／`board.renderCommit` 的唯一 orchestrator）。
 */
export interface DragHost {
  getPlan(): RoomPlan
  getUi(): UiState
  messages: Messages
  /** 畫布 `<svg>` 的 `getBoundingClientRect()`（D2：由 host 讀出後傳入純函式）。 */
  getBoardRect(): BoardRect
  getViewBox(): ViewBox
  /** 目前網格／磁吸／鄰邊／極大牆段（`snap.ts`）；呼叫端須排除被拖者自身。 */
  snapContext(kind: NodeKind, id: string): SnapContext
  /** host：設 `ui.selectedId`、重繪 roving tabindex、播報該節點 `aria-label`。 */
  select(kind: NodeKind, id: string): void
  /** host：`reducer.beginDrag`（記 origin 供 Esc 還原與 commit 入棧）。 */
  dragBegin(kind: NodeKind, id: string, source: 'pointer' | 'keyboard'): void
  /** host：`reducer.dragTo` ＋ `board.renderDrag`（拖移期不入棧、不 autosave）。 */
  dragMove(kind: NodeKind, id: string, x: number, y: number): void
  /** host：`reducer.cancelDrag` ＋ `renderCommit`（回 origin）。 */
  dragCancel(): void
  /** host：`reducer.commitDrag` ＋ autosave ＋ `renderCommit` ＋ 播報 itemMoved。 */
  dragCommit(): void
  /**
   * 保留欄位：語意同 `dragCommit()`（D10 commit-then-handle）。本檔的
   * commit-then-handle 一律走 `commitNow()` → `dragCommit()`，不呼叫本欄；
   * 選填以免 host 端實作了此方法時被 TS 的多餘屬性檢查擋下。
   */
  dragInterrupt?(): void
  /** 旋轉／刪除等非 move 動作；本檔於拖移態中會先 `commitNow()` 再送出。 */
  dispatch(action: Action): void
  announce(text: string): void
  /** host：`item/delete` 後把焦點移到該列「還原 {name}」鈕（D10 非破壞性刪除特例）。 */
  focusRestoreButton(id: string): void
  /** 可注入的計時器（測試用假計時器）；預設走全域。 */
  timers?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void }
  /** 可注入的 rAF（測試用假幀佇列）；預設走全域。 */
  raf?: { request: (fn: () => void) => number; cancel: (h: number) => void }
}

/** 鍵盤拖移的 commit 門檻：最後一次按鍵後這麼久沒有新按鍵就 commit（D10）。 */
export const KEYBOARD_QUIET_MS = 500

/** 方向鍵單步位移（cm）。 */
export const STEP_CM = 1

/** Shift＋方向鍵位移（cm）。 */
export const STEP_CM_SHIFT = 10

/**
 * 門的指標拖移磁吸距離（cm，T5.2）。門的合法落點是**極大牆段上的離散
 * 點**（D6），指標只要離牆線這麼近就直接吸到牆上最近的點——沿牆拖有黏
 * 性、跨到另一面牆也接得住，不必把指標壓在一條零厚線上。家具／方塊的
 * 磁吸距離是 `settings.ignoreBelow`（`snap.ts`），兩者刻意不共用：那是
 * 「貼齊鄰邊」的容忍度，這是「門本來就只能在牆上」的投影半徑。
 */
export const DOOR_SNAP_CM = 30

/** `attachDrag()` 回傳的控制介面。 */
export interface DragController {
  /** 移除所有監聽並清掉未決的計時器／rAF。 */
  detach(): void
  isDragging(): boolean
  /**
   * 靜默期間收到 undo／redo／其他 action 時由 host 呼叫：立刻 commit 當前
   * 鍵盤拖移態（清計時器＋`host.dragCommit()`），再由 host 處理該 action
   * （D10）。指標拖移態不受影響——它的 commit 觸發是 `pointerup`。
   */
  commitNow(): void
}

/** 可拖移節點的委派選擇器（`board.ts` 對家具／方塊／門一致套用）。 */
const NODE_SELECTOR = '[data-kind][data-id]'

/** 方向鍵 → 單位位移（乘上 `STEP_CM`／`STEP_CM_SHIFT`）。 */
const ARROW_DELTA: Record<string, { dx: number; dy: number } | undefined> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

function isNodeKind(value: string | null): value is NodeKind {
  return value === 'item' || value === 'block' || value === 'door'
}

interface DragNode {
  el: SVGElement
  kind: NodeKind
  id: string
}

/**
 * 自事件目標往上找可拖移節點。`closest` 在非 Element 目標（如 document）
 * 上不存在，故先以 duck typing 擋掉——本檔刻意不參照 `Element` 全域，
 * 以免在非 DOM 環境下 import 即炸。
 */
function nodeFrom(target: EventTarget | null): DragNode | null {
  const start = target as Element | null
  if (start === null || typeof start.closest !== 'function') return null
  const el = start.closest(NODE_SELECTOR)
  if (el === null) return null
  const kind = el.getAttribute('data-kind')
  const id = el.getAttribute('data-id')
  if (!isNodeKind(kind) || id === null || id === '') return null
  // 節點恆為 `<svg>` 內的 `<g>`（board.ts 契約）；轉型只為取得 focus()。
  return { el: el as SVGElement, kind, id }
}

/**
 * 把 Pointer／鍵盤事件接上宿主的拖移態（PLAN D2／D10）。回傳的
 * `DragController` 由 `main.ts` 持有：undo／redo 等路徑先 `commitNow()`，
 * 頁面卸載或重建畫布時 `detach()`。
 */
export function attachDrag(svg: SVGSVGElement, host: DragHost): DragController {
  const timers = host.timers ?? {
    setTimeout: (fn: () => void, ms: number): unknown => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle: unknown): void => {
      globalThis.clearTimeout(handle as number)
    },
  }
  const raf = host.raf ?? {
    request: (fn: () => void): number => globalThis.requestAnimationFrame(fn),
    cancel: (handle: number): void => {
      globalThis.cancelAnimationFrame(handle)
    },
  }

  // ── 指標拖移態 ──────────────────────────────────────────────────────
  let pointerId: number | null = null
  let pointerKind: NodeKind | null = null
  let pointerTarget: string | null = null
  /** 抓取位移：按下當下「節點已提交座標 − 指標 cm 座標」，全程不變。 */
  let grabX = 0
  let grabY = 0
  let lastClientX = 0
  let lastClientY = 0
  /** 未決的 rAF handle；`0` 為「無」——瀏覽器 rAF handle 自 1 起算。 */
  let pendingFrame = 0
  /** 已收到但尚未套用的 `pointermove`（決定 `pointerup` 是否要補套最後一筆）。 */
  let pendingMove = false

  // ── 鍵盤拖移態 ──────────────────────────────────────────────────────
  let keyboardKind: NodeKind | null = null
  let keyboardTarget: string | null = null
  let quietTimer: unknown = null

  /** 節點目前**已提交**的左上角座標（家具取有效外框）。 */
  function positionOf(kind: NodeKind, id: string): { x: number; y: number } | null {
    const plan = host.getPlan()
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

  /** 磁吸所需的有效外框尺寸（門不走網格／磁吸，見 `moveTo`）。 */
  function sizeOf(kind: 'item' | 'block', id: string): { w: number; d: number } | null {
    const plan = host.getPlan()
    if (kind === 'item') {
      const item = plan.items.find((candidate) => candidate.id === id)
      return item === undefined ? null : effectiveSize(item)
    }
    const block = plan.room.blocks.find((candidate) => candidate.id === id)
    return block === undefined ? null : { w: block.width, d: block.depth }
  }

  /**
   * 指標路徑的位移落點：**取整 → 網格 → 磁吸**（`snap.ts` 契約；夾框在
   * `reducer.ts`）。
   *
   * **門走另一條（T5.2）**：不過網格、不過 `snap.ts` 的鄰邊磁吸，改吸到
   * `snapContext().edges`（D9 極大牆段）上的最近點——距離在
   * `DOOR_SNAP_CM` 內才吸，超過就原樣送出（由 reducer 依 D6 拒收，plan
   * 不變）。牆段本身就是門的合法軌道，吸完再取整即可；沒有任何牆段時
   * （`edges` 為空）退回只取整的舊行為。
   */
  function moveTo(kind: NodeKind, id: string, rawX: number, rawY: number): void {
    const x = Math.round(rawX)
    const y = Math.round(rawY)
    if (kind === 'door') {
      const near = nearestPointOnEdges(x, y, host.snapContext(kind, id).edges)
      if (near !== null && near.dist2 <= DOOR_SNAP_CM * DOOR_SNAP_CM) {
        host.dragMove(kind, id, Math.round(near.x), Math.round(near.y))
        return
      }
      host.dragMove(kind, id, x, y)
      return
    }
    const size = sizeOf(kind, id)
    if (size === null) return
    const snapped = snapPosition(x, y, size, host.snapContext(kind, id))
    host.dragMove(kind, id, snapped.x, snapped.y)
  }

  function applyPointerPosition(): void {
    if (pointerKind === null || pointerTarget === null) return
    const cm = pxToCm(lastClientX, lastClientY, host.getBoardRect(), host.getViewBox())
    moveTo(pointerKind, pointerTarget, cm.x + grabX, cm.y + grabY)
  }

  /** D2：三個出口一律先取消未決的幀（handle `0` 對真實 rAF 為 no-op）。 */
  function cancelFrame(): void {
    raf.cancel(pendingFrame)
    pendingFrame = 0
  }

  function clearPointerDrag(): void {
    pointerId = null
    pointerKind = null
    pointerTarget = null
    pendingMove = false
  }

  function releaseCapture(id: number): void {
    try {
      svg.releasePointerCapture?.(id)
    } catch {
      // jsdom 無 capture 三件；真實瀏覽器在 capture 已失效時會擲
      // NotFoundError。兩者都不影響拖移語意（D2 特徵偵測）。
    }
  }

  function clearQuietTimer(): void {
    if (quietTimer === null) return
    timers.clearTimeout(quietTimer)
    quietTimer = null
  }

  /** PLAN D10：每次方向鍵 keydown **與** keyup 都重啟靜默計時。 */
  function restartQuietTimer(): void {
    clearQuietTimer()
    quietTimer = timers.setTimeout(() => {
      quietTimer = null
      finishKeyboardDrag()
    }, KEYBOARD_QUIET_MS)
  }

  function finishKeyboardDrag(): void {
    keyboardKind = null
    keyboardTarget = null
    host.dragCommit()
  }

  function commitNow(): void {
    if (quietTimer === null) return
    clearQuietTimer()
    finishKeyboardDrag()
  }

  function cancelPointerDrag(): void {
    cancelFrame()
    const released = pointerId
    clearPointerDrag()
    if (released !== null) releaseCapture(released)
    host.dragCancel()
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    // D10：`pointerdown` 屬「其他動作」，先 commit 未決的鍵盤拖移態再處理。
    // 按在空白處（未命中節點）同樣是使用者動作，故置於命中判定之前。
    commitNow()
    const node = nodeFrom(event.target)
    if (node === null) return
    // 已有一指在拖：忽略第二指（本工具不做多點手勢，見 Non-Goals）。
    if (pointerId !== null) return
    event.preventDefault()
    host.select(node.kind, node.id)
    // `preventDefault()` 擋掉原生聚焦，roving 單一停點須自行補上——否則
    // 滑鼠拖完後方向鍵會落在 `<body>` 上（PLAN G7 鍵盤等效）。
    node.el.focus()
    const position = positionOf(node.kind, node.id)
    if (position === null) return
    const cm = pxToCm(event.clientX, event.clientY, host.getBoardRect(), host.getViewBox())
    grabX = position.x - cm.x
    grabY = position.y - cm.y
    lastClientX = event.clientX
    lastClientY = event.clientY
    pendingMove = false
    pointerId = event.pointerId
    pointerKind = node.kind
    pointerTarget = node.id
    try {
      svg.setPointerCapture?.(event.pointerId)
    } catch {
      // 同 releaseCapture：無 capture 的環境照樣能拖（事件委派在 svg 上）。
    }
    host.dragBegin(node.kind, node.id, 'pointer')
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointerId === null || event.pointerId !== pointerId) return
    lastClientX = event.clientX
    lastClientY = event.clientY
    pendingMove = true
    if (pendingFrame !== 0) return
    pendingFrame = raf.request(() => {
      pendingFrame = 0
      if (!pendingMove) return
      pendingMove = false
      applyPointerPosition()
    })
  }

  function onPointerUp(event: PointerEvent): void {
    if (pointerId === null || event.pointerId !== pointerId) return
    const flush = pendingMove
    cancelFrame()
    // 末段位移不得遺失：未套用的最後一筆在此同步補上（與 rAF 內同一算式）。
    if (flush) {
      pendingMove = false
      applyPointerPosition()
    }
    const released = pointerId
    // 先清狀態再釋放 capture——`releasePointerCapture()` 會引發
    // `lostpointercapture`，若此時拖移態還在就會被誤判為取消。
    clearPointerDrag()
    releaseCapture(released)
    host.dragCommit()
  }

  /** `pointercancel`／`lostpointercapture`：與 Esc 三者等效（D2）。 */
  function onPointerAbort(event: PointerEvent): void {
    if (pointerId === null || event.pointerId !== pointerId) return
    cancelPointerDrag()
  }

  function onEscape(event: KeyboardEvent): void {
    if (pointerId !== null) {
      event.preventDefault()
      cancelPointerDrag()
      return
    }
    if (keyboardTarget === null) return
    event.preventDefault()
    clearQuietTimer()
    keyboardKind = null
    keyboardTarget = null
    host.dragCancel()
  }

  function stepBy(event: KeyboardEvent, node: DragNode, delta: { dx: number; dy: number }): void {
    event.preventDefault()
    const step = event.shiftKey ? STEP_CM_SHIFT : STEP_CM
    // 拖到一半改按另一件：先 commit 前一件再開新拖移（commit-then-handle）。
    if (keyboardTarget !== null && (keyboardTarget !== node.id || keyboardKind !== node.kind)) {
      commitNow()
    }
    if (keyboardTarget === null) {
      keyboardKind = node.kind
      keyboardTarget = node.id
      host.dragBegin(node.kind, node.id, 'keyboard')
    }
    // 自**目前** plan 座標累加：拖移期 host 每次 dragMove 都已寫進 present。
    const position = positionOf(node.kind, node.id)
    if (position === null) return
    // 鍵盤步進為精確的 1／10 cm，刻意不過網格與磁吸（PLAN Keyboard）。
    host.dragMove(node.kind, node.id, position.x + delta.dx * step, position.y + delta.dy * step)
    restartQuietTimer()
  }

  /** `,`／`.`：DOM 序上一／下一個可拖移節點，環狀；deleted 家具無節點故自然跳過。 */
  function cycleSelection(event: KeyboardEvent, delta: 1 | -1): void {
    event.preventDefault()
    // 切換選取屬「其他動作」：先 commit，否則焦點已離開仍留著未決拖移態。
    commitNow()
    const nodes = Array.from(svg.querySelectorAll<SVGElement>(NODE_SELECTOR))
    if (nodes.length === 0) return
    const selected = host.getUi().selectedId
    let index = nodes.findIndex((el) => el.getAttribute('data-id') === selected)
    // 無選中時：`.` 自第一件起、`,` 自最後一件起。
    if (index < 0) index = delta === 1 ? -1 : 0
    const next = nodes[(index + delta + nodes.length) % nodes.length]
    const kind = next.getAttribute('data-kind')
    const id = next.getAttribute('data-id')
    if (!isNodeKind(kind) || id === null) return
    host.select(kind, id)
    next.focus()
  }

  function onKeyDown(event: KeyboardEvent): void {
    const node = nodeFrom(event.target)
    if (node === null) return
    if (event.key === 'Escape') {
      onEscape(event)
      return
    }
    // Ctrl／Alt／Meta 組合鍵留給瀏覽器（Ctrl+R 重新整理等），不攔截。
    if (event.ctrlKey || event.altKey || event.metaKey) return
    // 指標拖移進行中不處理鍵盤動作：該次 commit 的唯一觸發是 `pointerup`，
    // 兩條拖移態同時開著會互相覆寫 origin。
    if (pointerId !== null) return
    const arrow = ARROW_DELTA[event.key]
    if (arrow !== undefined) {
      stepBy(event, node, arrow)
      return
    }
    if (event.key === ',') {
      cycleSelection(event, -1)
      return
    }
    if (event.key === '.') {
      cycleSelection(event, 1)
      return
    }
    if (event.key === 'r' || event.key === 'R') {
      if (node.kind !== 'item') return
      event.preventDefault()
      commitNow()
      host.dispatch({ type: 'item/rotate', id: node.id })
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // M2：方塊與門的刪除只走清單，畫布上不接（PLAN T2.3）。
      if (node.kind !== 'item') return
      event.preventDefault()
      commitNow()
      host.dispatch({ type: 'item/delete', id: node.id })
      host.focusRestoreButton(node.id)
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (ARROW_DELTA[event.key] === undefined) return
    if (keyboardTarget === null || quietTimer === null) return
    restartQuietTimer()
  }

  svg.addEventListener('pointerdown', onPointerDown)
  svg.addEventListener('pointermove', onPointerMove)
  svg.addEventListener('pointerup', onPointerUp)
  svg.addEventListener('pointercancel', onPointerAbort)
  svg.addEventListener('lostpointercapture', onPointerAbort)
  svg.addEventListener('keydown', onKeyDown)
  svg.addEventListener('keyup', onKeyUp)

  function detach(): void {
    svg.removeEventListener('pointerdown', onPointerDown)
    svg.removeEventListener('pointermove', onPointerMove)
    svg.removeEventListener('pointerup', onPointerUp)
    svg.removeEventListener('pointercancel', onPointerAbort)
    svg.removeEventListener('lostpointercapture', onPointerAbort)
    svg.removeEventListener('keydown', onKeyDown)
    svg.removeEventListener('keyup', onKeyUp)
    cancelFrame()
    clearQuietTimer()
    clearPointerDrag()
    keyboardKind = null
    keyboardTarget = null
  }

  return {
    detach,
    isDragging: () => pointerId !== null || keyboardTarget !== null,
    commitNow,
  }
}
