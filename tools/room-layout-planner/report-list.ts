/**
 * T3.2 — 分析結果的文字等價清單（(internal design doc)
 * §D3「『警示』在驗收語境下＝`narrow`＋碰撞＋`sideViolations`＋
 * `doorViolations`；`tight` 為提示」、§D4「門洞不評級／`passable` 抑制為
 * `suppressed`」、§Frontend Component tree「`report-list` 置於畫布正下方
 * （同分區、內捲、分頁）」、§Accessibility「overlay `aria-hidden`，資訊由
 * `report-list` 文字等價」「大量項目 skip＋分頁＋換頁焦點管理與播報」
 * 「Live regions：警示數只播報摘要」、§Open questions OQ1「分頁門檻
 * 預設 20」）。
 *
 * 四條硬契約：
 *
 * 1. **文字等價**——overlay 是 `aria-hidden` 的純視覺層，畫布上每一筆
 *    通道／碰撞／各面違規／門違規在本清單都有一行文字，**含不評級筆數**
 *    （門洞與 `passable` 抑制），否則輔助技術使用者看不到分析結果。
 * 2. **原地更新**（D10）——列以 `key` 差集更新，同一頁跨 render 的 `<li>`
 *    參考不變；絕不 `replaceChildren`／`innerHTML` 整批抽換。
 * 3. **DOM 寫入只經 `createElement`／`textContent`／`setAttribute`**（D7
 *    「DOM 寫入不變量」）——家具名稱是使用者字串，本檔不出現任何 HTML
 *    字串注入 API。
 * 4. **換頁的焦點與播報**——換頁後焦點進入 `#report-list`（無可聚焦控件
 *    時落在清單自身，`tabindex="-1"`）並播報 `status.pageChanged`。
 *
 * 純函式（`buildEntries`／`countReport`／`summaryText`）與 DOM 層
 * （`attachReportList`）刻意分離：前三者零 DOM，node 環境即可直測，`main.ts`
 * 的摘要播報也直接取用 `countReport`／`summaryText`，不必碰畫面。
 */
import type { Messages } from './messages.js'
import type { ClearanceReport, Corridor, RoomPlan, Side } from './model.js'
import type { UiState } from './ui-state.js'

/** OQ1 定案：`report-list` 分頁門檻 20 列（與 `panel.ts` 的 `ITEMS_PAGE_SIZE` 同制）。 */
export const REPORT_PAGE_SIZE = 20

/**
 * 一筆文字等價項目。
 *
 * `kind` 前九種直接對應 PLAN 的通道／碰撞／違規分類；`unattached`
 * （`unattachedDoors`）與 `unconnected`（`unconnectedBlocks`）是 D6／D9
 * 要求 report 標示、但不屬上述任一類的**結構性**問題，故於此列舉補上——
 * 兩者皆不計入 `ReportCounts`（摘要只播報四類警示數與提示／不評級數）。
 *
 * `severity`：2＝警示（`narrow`／碰撞／各面違規／門違規，另含兩種結構性
 * 問題）、1＝提示（`tight`）、0＝資訊（`ok`／`doorway`／`suppressed`／
 * `touch`）。
 */
export interface ReportEntry {
  key: string
  kind:
    | 'narrow'
    | 'tight'
    | 'ok'
    | 'touch'
    | 'doorway'
    | 'suppressed'
    | 'collision'
    | 'side'
    | 'door'
    | 'unattached'
    | 'unconnected'
  text: string
  focus: { kind: 'item' | 'block' | 'door'; id: string } | null
  severity: 0 | 1 | 2
}

/** 摘要用的筆數分佈（`unrated` ＝ `doorway` ＋ `suppressed`，D4）。 */
export interface ReportCounts {
  narrow: number
  collisions: number
  side: number
  door: number
  tight: number
  unrated: number
  ok: number
  touch: number
}

export const EMPTY_COUNTS: ReportCounts = {
  narrow: 0,
  collisions: 0,
  side: 0,
  door: 0,
  tight: 0,
  unrated: 0,
  ok: 0,
  touch: 0,
}

/* ------------------------------------------------------------------ *
 * 純函式：計數、名稱解析、組句
 * ------------------------------------------------------------------ */

/**
 * 純函式計數（D3「警示」定義）。`doorway`／`suppressed` 的 `level` 恆為
 * `null`（D4），故 `narrow`／`tight`／`ok`／`touch` 只會數到
 * `kind === 'corridor'` 的筆。
 */
export function countReport(report: ClearanceReport): ReportCounts {
  const counts: ReportCounts = { ...EMPTY_COUNTS }
  counts.collisions = report.collisions.length
  counts.side = report.sideViolations.length
  counts.door = report.doorViolations.length
  for (const corridor of report.corridors) {
    if (corridor.kind === 'doorway' || corridor.kind === 'suppressed') {
      counts.unrated += 1
      continue
    }
    switch (corridor.level) {
      case 'narrow':
        counts.narrow += 1
        break
      case 'tight':
        counts.tight += 1
        break
      case 'ok':
        counts.ok += 1
        break
      case 'touch':
        counts.touch += 1
        break
      default:
        break
    }
  }
  return counts
}

/**
 * 摘要句：四類**警示**數（`status.warningsSummary`，與 `main.ts` 的 live
 * region 播報共用同一組句）＋提示／不評級數後綴（`report.summaryExtra`）。
 */
export function summaryText(counts: ReportCounts, messages: Messages): string {
  const head = messages.status.warningsSummary(counts.narrow, counts.collisions, counts.side, counts.door)
  return `${head}；${messages.report.summaryExtra(counts.tight, counts.unrated)}`
}

const FRAME_PREFIX = 'frame:'
const WALL_PREFIX = 'wall:'

/** `Side` 白名單——`frame:` 參照的尾碼由 `clearance.ts` 產生，此處仍守一次。 */
function asSide(raw: string): Side | null {
  return raw === 'N' || raw === 'E' || raw === 'S' || raw === 'W' ? raw : null
}

/**
 * 參照 → 人類可讀名稱：家具 id → 名稱；`frame:N|E|S|W` → 北牆／東牆／
 * 南牆／西牆；`wall:<i>` → 「牆體」（D9 牆體矩形無個別身分，逐條編號對
 * 使用者無意義）。認不得的參照原樣回傳，寧可露出 id 也不要讓該筆消失。
 */
function nameOf(ref: string, plan: RoomPlan, messages: Messages): string {
  if (ref.startsWith(FRAME_PREFIX)) {
    const side = asSide(ref.slice(FRAME_PREFIX.length))
    return side === null ? ref : messages.ui.door.wallName(side)
  }
  if (ref.startsWith(WALL_PREFIX)) return messages.report.wallName
  const item = plan.items.find((candidate) => candidate.id === ref)
  return item === undefined ? ref : item.name
}

/** 參照是否為畫布上仍然存在（且未刪除）的可聚焦節點。 */
function focusTargetOf(ref: string, plan: RoomPlan): ReportEntry['focus'] {
  const item = plan.items.find((candidate) => candidate.id === ref)
  if (item !== undefined) return item.deleted === true ? null : { kind: 'item', id: ref }
  if (plan.room.blocks.some((block) => block.id === ref)) return { kind: 'block', id: ref }
  if (plan.room.doors.some((door) => door.id === ref)) return { kind: 'door', id: ref }
  return null
}

/** 通道兩端取第一個可聚焦者（牆與框邊不是節點，故通常是家具那一端）。 */
function pairFocus(a: string, b: string, plan: RoomPlan): ReportEntry['focus'] {
  return focusTargetOf(a, plan) ?? focusTargetOf(b, plan)
}

function corridorEntry(corridor: Corridor, plan: RoomPlan, messages: Messages): ReportEntry {
  const a = nameOf(corridor.a, plan, messages)
  const b = nameOf(corridor.b, plan, messages)
  const key = `corridor:${corridor.a}|${corridor.b}|${corridor.axis}|${corridor.segIndex}`
  const focus = pairFocus(corridor.a, corridor.b, plan)
  if (corridor.kind === 'doorway') {
    return { key, kind: 'doorway', text: messages.report.text.doorway(a, b, corridor.gap), focus, severity: 0 }
  }
  if (corridor.kind === 'suppressed') {
    return { key, kind: 'suppressed', text: messages.report.text.suppressed(a, b, corridor.gap), focus, severity: 0 }
  }
  const level = corridor.level ?? 'ok'
  const text = messages.report.text.corridor(a, b, corridor.gap, messages.report.level[level])
  const severity: 0 | 1 | 2 = level === 'narrow' ? 2 : level === 'tight' ? 1 : 0
  return { key, kind: level, text, focus, severity }
}

/**
 * `ClearanceReport` → 文字等價項目（純函式）。輸出順序：`severity` 由高
 * 到低，同 severity 內 `touch` 殿後（畫布上不標，屬純參考資訊），其餘
 * 維持 report 的來源順序——`key` 互異，故此序為全序且可重現。
 *
 * **不**在此濾掉 `touch`：那是 `ui.showDistance` 的畫面決定，留給
 * `render()`，好讓純函式層的筆數分佈與 `countReport` 對得上。
 */
export function buildEntries(plan: RoomPlan, report: ClearanceReport, messages: Messages): ReportEntry[] {
  const entries: ReportEntry[] = []

  for (const corridor of report.corridors) {
    entries.push(corridorEntry(corridor, plan, messages))
  }

  for (const collision of report.collisions) {
    entries.push({
      key: `collision:${collision.a}|${collision.b}`,
      kind: 'collision',
      text: messages.report.text.collision(
        nameOf(collision.a, plan, messages),
        nameOf(collision.b, plan, messages),
      ),
      focus: pairFocus(collision.a, collision.b, plan),
      severity: 2,
    })
  }

  for (const violation of report.sideViolations) {
    entries.push({
      key: `side:${violation.id}|${violation.side}`,
      kind: 'side',
      // 面名用**世界方向**（`worldSide`）：使用者看到的是畫布上的北東南西，
      // 區域座標的 `side` 只是資料形內部事實（D5）。
      text: messages.report.text.side(
        nameOf(violation.id, plan, messages),
        messages.report.sideName(violation.worldSide),
        violation.need,
        violation.actual,
        nameOf(violation.against, plan, messages),
      ),
      focus: focusTargetOf(violation.id, plan),
      severity: 2,
    })
  }

  for (const violation of report.doorViolations) {
    const door = plan.room.doors.find((candidate) => candidate.id === violation.doorId)
    const doorName =
      door === undefined ? messages.ui.form.door : messages.report.doorName(door.wall)
    entries.push({
      key: `door:${violation.doorId}|${violation.itemId}`,
      kind: 'door',
      text: messages.report.text.door(nameOf(violation.itemId, plan, messages), doorName),
      focus: focusTargetOf(violation.itemId, plan),
      severity: 2,
    })
  }

  for (const id of report.unattachedDoors) {
    entries.push({
      key: `unattached:${id}`,
      kind: 'unattached',
      text: messages.report.text.unattachedDoor(id),
      focus: focusTargetOf(id, plan),
      severity: 2,
    })
  }

  for (const id of report.unconnectedBlocks) {
    entries.push({
      key: `unconnected:${id}`,
      kind: 'unconnected',
      text: messages.report.text.unconnectedBlock(id),
      focus: focusTargetOf(id, plan),
      severity: 2,
    })
  }

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      if (left.entry.severity !== right.entry.severity) return right.entry.severity - left.entry.severity
      const leftTouch = left.entry.kind === 'touch' ? 1 : 0
      const rightTouch = right.entry.kind === 'touch' ? 1 : 0
      if (leftTouch !== rightTouch) return leftTouch - rightTouch
      return left.index - right.index
    })
    .map((wrapped) => wrapped.entry)
}

/* ------------------------------------------------------------------ *
 * DOM 層
 * ------------------------------------------------------------------ */

export interface ReportListHost {
  getPlan(): RoomPlan
  getUi(): UiState
  messages: Messages
  /** 只收本清單會動到的 UI 欄位；由 host 負責重繪。 */
  setUi(patch: Partial<Pick<UiState, 'reportPage' | 'selectedId'>>): void
  focusBoardNode(kind: 'item' | 'block' | 'door', id: string): void
  announce(text: string): void
}

export interface ReportList {
  /** 原地重繪：列以 `key` 差集更新、絕不整批抽換。`report` 為 `null` 時只寫摘要。 */
  render(plan: RoomPlan, ui: UiState, report: ClearanceReport | null): void
  detach(): void
}

interface EntryRow {
  li: HTMLLIElement
  /** `<button>`（有可聚焦目標）或 `<span>`（無）。 */
  control: HTMLElement
  focusable: boolean
  kind: ReportEntry['kind']
  text: string
  /** 點擊時要聚焦的畫布節點；隨 render 更新，按鈕的監聽器由此讀取。 */
  focus: ReportEntry['focus']
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector)
  if (found === null) throw new Error(`report-list.ts：DOM 契約缺少元素 ${selector}`)
  return found
}

/** 只在文字真的不同時寫入，避免無謂的 DOM 變動。 */
function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}

/**
 * 掛上 `#report-summary`／`#report-list`／`#report-pager` 三件套（靜態骨架
 * 由 `index.html` 提供，本檔只查詢、接線與填值）。
 */
export function attachReportList(root: ParentNode, host: ReportListHost): ReportList {
  const m = host.messages

  const summaryEl = query<HTMLElement>(root, '#report-summary')
  const listEl = query<HTMLOListElement>(root, '#report-list')
  const pagerEl = query<HTMLElement>(root, '#report-pager')
  const prevEl = query<HTMLButtonElement>(root, '#report-prev')
  const nextEl = query<HTMLButtonElement>(root, '#report-next')
  const pageLabelEl = query<HTMLElement>(root, '#report-page-label')

  const doc = listEl.ownerDocument

  // 無可聚焦控件時的換頁焦點落點（Accessibility「換頁焦點管理」）。
  listEl.setAttribute('tabindex', '-1')

  const rows = new Map<string, EntryRow>()
  const cleanups: Array<() => void> = []
  let detached = false
  /** 使用者按下換頁鈕後「等待中」的頁碼；render 對上同一頁才移焦並播報。 */
  let pendingPageFocus: number | null = null
  /** 最近一次 render 的頁數，供換頁鈕算界（避免重複建 entries）。 */
  let lastTotal = 1

  function on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    const wrapped = (event: Event): void => {
      if (detached) return
      handler(event as HTMLElementEventMap[K])
    }
    target.addEventListener(type, wrapped)
    cleanups.push(() => target.removeEventListener(type, wrapped))
  }

  // ── 列 ─────────────────────────────────────────────────────────────

  function makeControl(row: EntryRow, focusable: boolean): HTMLElement {
    if (!focusable) {
      const span = doc.createElement('span')
      span.setAttribute('class', 'report-entry__text')
      return span
    }
    const button = doc.createElement('button')
    button.setAttribute('type', 'button')
    button.setAttribute('class', 'report-entry__focus')
    // 監聽器**刻意不登記 cleanup**：列節點被移除且自 `rows` 掉出後，節點與
    // 閉包一起可回收（同 `panel.ts` 的 `onRow` 取捨）；`detached` 旗標仍生效。
    button.addEventListener('click', () => {
      if (detached) return
      const target = row.focus
      if (target === null) return
      host.setUi({ selectedId: target.id })
      host.focusBoardNode(target.kind, target.id)
    })
    return button
  }

  function createRow(entry: ReportEntry): EntryRow {
    const li = doc.createElement('li')
    li.setAttribute('data-key', entry.key)
    const row: EntryRow = {
      li,
      control: doc.createElement('span'),
      focusable: false,
      kind: entry.kind,
      text: '',
      focus: entry.focus,
    }
    row.control = makeControl(row, entry.focus !== null)
    row.focusable = entry.focus !== null
    li.append(row.control)
    return row
  }

  function updateRow(row: EntryRow, entry: ReportEntry): void {
    row.focus = entry.focus
    if (row.kind !== entry.kind) {
      row.kind = entry.kind
    }
    row.li.setAttribute('class', `report-entry report-entry--${entry.kind}`)

    const focusable = entry.focus !== null
    if (focusable !== row.focusable) {
      // 可聚焦性翻轉（家具被刪除／還原）：只換控件，`<li>` 參考維持不變。
      const next = makeControl(row, focusable)
      row.li.replaceChild(next, row.control)
      row.control = next
      row.focusable = focusable
      row.text = ''
    }

    if (row.text !== entry.text) {
      row.text = entry.text
      setText(row.control, entry.text)
      if (focusable) row.control.setAttribute('aria-label', entry.text)
    }
  }

  /** 差集更新（同 `panel.ts` 的 `syncRows`）：新增／移除／`insertBefore` 搬位。 */
  function syncRows(entries: readonly ReportEntry[]): void {
    const wanted = new Set(entries.map((entry) => entry.key))
    for (const [key, row] of rows) {
      if (wanted.has(key)) continue
      row.li.remove()
      rows.delete(key)
    }
    let index = 0
    for (const entry of entries) {
      let row = rows.get(entry.key)
      if (row === undefined) {
        row = createRow(entry)
        rows.set(entry.key, row)
      }
      updateRow(row, entry)
      const atIndex = listEl.children[index]
      if (atIndex !== row.li) listEl.insertBefore(row.li, atIndex ?? null)
      index += 1
    }
  }

  // ── 分頁 ───────────────────────────────────────────────────────────

  function pageCount(entryCount: number): number {
    return Math.max(1, Math.ceil(entryCount / REPORT_PAGE_SIZE))
  }

  function goToPage(next: number): void {
    const page = clamp(next, 1, lastTotal)
    if (page === clamp(Math.max(1, host.getUi().reportPage), 1, lastTotal)) return
    pendingPageFocus = page
    host.setUi({ reportPage: page })
  }

  on(prevEl, 'click', () => goToPage(Math.max(1, host.getUi().reportPage) - 1))
  on(nextEl, 'click', () => goToPage(Math.max(1, host.getUi().reportPage) + 1))

  /** 換頁後把焦點帶進清單（無可聚焦控件時落在 `<ol tabindex="-1">` 自身）。 */
  function focusFirstControl(): void {
    const control = listEl.querySelector<HTMLElement>('button:not([disabled])')
    if (control !== null) control.focus()
    else listEl.focus()
  }

  // ── render ─────────────────────────────────────────────────────────

  function render(plan: RoomPlan, ui: UiState, report: ClearanceReport | null): void {
    if (report === null) {
      setText(summaryEl, m.report.empty)
      syncRows([])
      setText(pageLabelEl, m.ui.list.pageLabel(1, 1))
      prevEl.disabled = true
      nextEl.disabled = true
      pagerEl.hidden = true
      lastTotal = 1
      pendingPageFocus = null
      return
    }

    setText(summaryEl, summaryText(countReport(report), m))

    // `touch`（貼齊）畫布上不標（D3），故只在「顯示距離」開啟時列出。
    const all = buildEntries(plan, report, m)
    const entries = ui.showDistance ? all : all.filter((entry) => entry.kind !== 'touch')

    const total = pageCount(entries.length)
    lastTotal = total
    const page = clamp(ui.reportPage, 1, total)
    const start = (page - 1) * REPORT_PAGE_SIZE
    syncRows(entries.slice(start, start + REPORT_PAGE_SIZE))

    setText(pageLabelEl, m.ui.list.pageLabel(page, total))
    prevEl.disabled = page <= 1
    nextEl.disabled = page >= total
    pagerEl.hidden = total <= 1

    if (pendingPageFocus !== null && pendingPageFocus === page) {
      pendingPageFocus = null
      focusFirstControl()
      host.announce(m.status.pageChanged(page, total))
    }
  }

  function detach(): void {
    detached = true
    for (const off of cleanups) off()
    cleanups.length = 0
  }

  return { render, detach }
}
