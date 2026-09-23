// @vitest-environment jsdom
/**
 * T2.5 — `main.ts` 接線的 jsdom 回歸網（(internal design doc)
 * §Verification jsdom 段「**播報**（措辭「內容變為拒絕原因且未被後續覆寫」）：
 * 上限守衛、牆體硬上限、autosave 首次失敗；**backup 時序**：四時點各寫入
 * backup、還原 swap 兩次回原狀、壞 backup 還原 plan 與 backup 不動、backup
 * `setItem` 擲錯 → 該次覆蓋中止且 `#error`；`visibilitychange`／`pagehide`
 * 各觸發一次 `setItem`」、§D7、§D10）。
 *
 * 啟動方式沿用 `tools/statusline-builder/skip-nav.dom.test.ts` 的全頁整合
 * 形：以 node 讀真實 `index.html` 取 `<body>` 灌進 jsdom、`vi.resetModules()`
 * 後動態 import `main.ts`（模組頂層即自我啟動）。每個案子各自一次 boot，
 * localStorage 於 `beforeEach` 清空後再種子。
 *
 * 計時器**只在需要的案子內**才切成假的（`boot()` 走動態 import，先切假
 * 計時器會把 module loading 的時序一併攔下，徒增不確定性）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from './messages.js'
import {
  defaultPlan,
  LIMITS,
  MAX_ITEMS_DEFAULT,
  MAX_ITEMS_WARN_ABOVE,
  type Furniture,
  type RoomBlock,
  type RoomPlan,
} from './model.js'
import { normalize } from './room-shape.js'
import { BACKUP_KEY, STORAGE_KEY } from './storage-keys.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const RAW_HTML = readFileSync(path.resolve(DIR, 'index.html'), 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]!

const m = t()

type MainModule = typeof import('./main.js')

/** 灌乾淨 DOM ＋ 重置模組快取後啟動 `main.ts`（回傳模組命名空間供直呼 helper）。 */
async function boot(): Promise<MainModule> {
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  return await import('./main.js')
}

// ── DOM 小工具 ───────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`測試骨架缺少 #${id}`)
  return found as T
}

function statusText(): string {
  return el('status').textContent ?? ''
}

function errorText(): string {
  return el('error').textContent ?? ''
}

function setValue(id: string, value: string): void {
  el<HTMLInputElement>(id).value = value
}

/** 寫值＋送 `change`（面板一律只聽 `change`，D10）。 */
function setControl(id: string, value: string): void {
  const control = el<HTMLInputElement | HTMLSelectElement>(id)
  control.value = value
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

function chooseKind(kind: 'item' | 'extend' | 'cutout' | 'door'): void {
  const radio = el<HTMLInputElement>(`add-kind-${kind}`)
  radio.checked = true
  radio.dispatchEvent(new Event('change', { bubbles: true }))
}

function submitAddForm(): void {
  el('add-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

function addFurniture(name: string, width: number, depth: number): void {
  chooseKind('item')
  setValue('add-name', name)
  setValue('add-width', String(width))
  setValue('add-depth', String(depth))
  submitAddForm()
}

function itemRowCount(): number {
  return document.querySelectorAll('#items-list > li').length
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

function resetVisibility(): void {
  delete (document as unknown as Record<string, unknown>).visibilityState
}

// ── 種子 fixture ─────────────────────────────────────────────────────

function furniture(index: number): Furniture {
  return {
    id: `i${index}`,
    name: `家具${index}`,
    color: '#9db4d6',
    width: 20,
    depth: 20,
    x: (index % 15) * 20,
    y: Math.floor(index / 15) * 20,
    rotation: 0,
    passable: true,
  }
}

/** D9 棋盤 50 塊（縱 25 條在前、橫 25 條在後；與 `reducer.test.ts` 同序）。 */
function checkerboardBlocks(): RoomBlock[] {
  const blocks: RoomBlock[] = []
  for (let i = 0; i < 25; i++) {
    blocks.push({ id: `v${i}`, kind: 'cutout', x: 2 * i, y: 0, width: 1, depth: 50 })
  }
  for (let j = 0; j < 25; j++) {
    blocks.push({ id: `h${j}`, kind: 'cutout', x: 0, y: 2 * j, width: 50, depth: 1 })
  }
  return blocks
}

function seedPlan(plan: RoomPlan): string {
  const raw = JSON.stringify(plan)
  localStorage.setItem(STORAGE_KEY, raw)
  return raw
}

function samplePlan(): RoomPlan {
  const plan = defaultPlan()
  plan.items = [furniture(0)]
  return plan
}

beforeEach(() => {
  localStorage.clear()
  resetVisibility()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  // 同一份 jsdom `document`／`window` 跨案共用，而每次 boot 都是一個新的
  // app 實例（`vi.resetModules()` 只換模組快取，不解既有監聽器）。`pagehide`
  // 會讓**所有**實例跑一次可重入的 `flushAutosave()`：有未決計時器的就地
  // 寫入並清掉，沒有的為 no-op——否則舊實例的 300 ms 計時器會在後續案子
  // 裡才觸發，污染那一案的 `setItem` 計數與 localStorage 內容。
  window.dispatchEvent(new Event('pagehide'))
  resetVisibility()
  document.body.innerHTML = ''
})

/* ------------------------------------------------------------------ *
 * 播報四類（措辭：內容變為 X 且未被後續覆寫）
 * ------------------------------------------------------------------ */

describe('播報：家具件數上限（T4.7 軟上限 20、硬上限 75）', () => {
  /** 種子 n 件家具（軟上限預設 20；`parsePlan` 會把它抬到 ≥ n）。 */
  function seedItems(count: number): void {
    const plan = defaultPlan()
    plan.items = Array.from({ length: count }, (_, i) => furniture(i))
    seedPlan(plan)
  }

  it('種子 20 件（預設軟上限）後再加一件 → #status 變為 itemCapReached 且未被後續覆寫', async () => {
    seedItems(MAX_ITEMS_DEFAULT)
    await boot()

    expect(itemRowCount()).toBeGreaterThan(0)
    addFurniture('書桌', 120, 60)

    const expected = m.status.itemCapReached(MAX_ITEMS_DEFAULT, LIMITS.items)
    expect(statusText()).toBe(expected)
    expect(expected).toContain('調高')

    // 「未被後續覆寫」：讓微任務與計時器都跑完，文字仍然是同一句。
    await Promise.resolve()
    vi.useFakeTimers()
    vi.advanceTimersByTime(2000)
    expect(statusText()).toBe(expected)
  })

  it('被拒的加入不改變 plan（清單列數不變）', async () => {
    seedItems(MAX_ITEMS_DEFAULT)
    await boot()
    const before = itemRowCount()
    addFurniture('書桌', 120, 60)
    expect(itemRowCount()).toBe(before)
  })

  it('把 #max-items 調到 25 → 同一次加入即成功（軟上限可由使用者調高）', async () => {
    seedItems(MAX_ITEMS_DEFAULT)
    await boot()

    setControl('max-items', '25')
    addFurniture('書桌', 120, 60)

    // 20 件家具互相重疊，播報會在加入句後串上警示摘要，故取 `toContain`。
    expect(statusText()).toContain(m.status.itemAdded('書桌'))
    expect(el('max-items-warning').hidden).toBe(false)
    expect(el('max-items-warning').textContent).toBe(
      m.ui.form.maxItemsWarning(MAX_ITEMS_WARN_ABOVE),
    )
  })

  it('種子 75 件（軟上限被抬到 75）後再加一件 → 硬上限仍擋下', async () => {
    seedItems(LIMITS.items)
    await boot()
    addFurniture('書桌', 120, 60)
    expect(statusText()).toBe(m.status.itemCapReached(LIMITS.items, LIMITS.items))
  })
})

describe('播報：牆體硬上限（D9 執行期後置條件）', () => {
  it('32 塊棋盤後再加第 33 塊 → #status 變為 wallCapExceeded(實際條數, 200)', async () => {
    const accepted = checkerboardBlocks().slice(0, 32)
    // 前置條件核對（與 reducer.test.ts 的釘死值同源）：32 塊 → 182 條。
    expect(normalize({ width: 50, depth: 50, blocks: accepted }).walls).toHaveLength(182)

    const thirtyThird: RoomBlock = { id: 'h7', kind: 'cutout', x: 0, y: 14, width: 50, depth: 1 }
    const expectedWalls = normalize({
      width: 50,
      depth: 50,
      blocks: [...accepted, thirtyThird],
    }).walls.length
    expect(expectedWalls).toBeGreaterThan(LIMITS.walls)

    const plan = defaultPlan()
    plan.room = { width: 50, depth: 50, blocks: accepted, doors: [] }
    seedPlan(plan)
    await boot()

    chooseKind('cutout')
    setValue('add-width', String(thirtyThird.width))
    setValue('add-depth', String(thirtyThird.depth))
    setValue('add-x', String(thirtyThird.x))
    setValue('add-y', String(thirtyThird.y))
    submitAddForm()

    expect(statusText()).toBe(m.status.wallCapExceeded(expectedWalls, LIMITS.walls))
    expect(document.querySelectorAll('#structure-list > li')).toHaveLength(32)
  })
})

describe('播報：autosave 首次失敗（D7「只播報一次」）', () => {
  it('首次失敗 → #status 為 autosaveFailed 且 #io-notice 非空；第二次變更不再覆寫 #status', async () => {
    await boot()
    vi.useFakeTimers()
    const mod = await import('./main.js')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    addFurniture('書桌', 120, 60)
    expect(statusText()).toBe(m.status.itemAdded('書桌'))
    vi.advanceTimersByTime(mod.AUTOSAVE_DEBOUNCE_MS)
    expect(statusText()).toBe(m.errors.autosaveFailed)
    expect(el('io-notice').textContent).not.toBe('')

    addFurniture('沙發', 200, 90)
    // T3.2：第二件家具疊在第一件上 → 碰撞數由 0 變 1，播報句後綴警示摘要
    // （PLAN §Accessibility「Live regions：警示數只播報摘要」，單一 live
    // region 併成一串）。本案只關心「不再覆寫」，故取實際播報內容為基準。
    const afterSecondAction = statusText()
    expect(afterSecondAction.startsWith(m.status.itemAdded('沙發'))).toBe(true)
    expect(afterSecondAction).toContain(m.status.warningsSummary(0, 1, 0, 0))
    vi.advanceTimersByTime(mod.AUTOSAVE_DEBOUNCE_MS)
    // 只播報一次：第二次失敗不得把 #status 再改回 autosaveFailed。
    expect(statusText()).toBe(afterSecondAction)
  })
})

describe('播報：undo／redo', () => {
  it('復原與重做各自播報對應句', async () => {
    await boot()
    addFurniture('書桌', 120, 60)
    el<HTMLButtonElement>('btn-undo').click()
    expect(statusText()).toBe(m.status.undone)
    el<HTMLButtonElement>('btn-redo').click()
    expect(statusText()).toBe(m.status.redone)
  })
})

/* ------------------------------------------------------------------ *
 * backup 時序（D7 四時點＋還原 swap）
 * ------------------------------------------------------------------ */

describe('backup 時點 (3)：壞資料整份回落預設前', () => {
  it('種子壞字串 → backup 存原始字串、STORAGE_KEY 存預設 plan、#error 有文字', async () => {
    localStorage.setItem(STORAGE_KEY, 'not json')
    await boot()

    expect(localStorage.getItem(BACKUP_KEY)).toBe('not json')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(defaultPlan())
    expect(errorText()).toBe(m.errors.storedPlanInvalid)
  })
})

describe('backup 時點 (4)：清空前（confirm）', () => {
  it('confirm 通過 → backup 為清空前的原始字串、present 回預設', async () => {
    const raw = seedPlan(samplePlan())
    await boot()
    expect(itemRowCount()).toBe(1)

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    el<HTMLButtonElement>('btn-clear').click()

    expect(localStorage.getItem(BACKUP_KEY)).toBe(raw)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(defaultPlan())
    expect(itemRowCount()).toBe(0)
    expect(statusText()).toBe(m.status.planCleared)
  })

  it('confirm 取消 → 兩把 key 與 plan 皆不動', async () => {
    const raw = seedPlan(samplePlan())
    await boot()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    el<HTMLButtonElement>('btn-clear').click()

    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw)
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
    expect(itemRowCount()).toBe(1)
  })
})

describe('backup：`setItem` 擲錯 → 中止該次整份覆蓋並 #error', () => {
  it('只讓寫 BACKUP_KEY 擲錯 → #error 為 backupFailed、STORAGE_KEY 與 plan 皆不動', async () => {
    const raw = seedPlan(samplePlan())
    await boot()

    const realSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === BACKUP_KEY) throw new Error('quota exceeded')
      realSetItem.call(localStorage, key, value)
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    el<HTMLButtonElement>('btn-clear').click()

    expect(errorText()).toBe(m.errors.backupFailed)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw)
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
    expect(itemRowCount()).toBe(1)
  })
})

describe('「還原上一份」＝swap（D7）', () => {
  it('連按兩次回原狀（兩把 key 皆為 byte-identical 的原字串）', async () => {
    const current = JSON.stringify(samplePlan())
    const backupPlan = defaultPlan()
    backupPlan.items = [{ ...furniture(1), name: '備份家具' }]
    const backup = JSON.stringify(backupPlan)
    localStorage.setItem(STORAGE_KEY, current)
    localStorage.setItem(BACKUP_KEY, backup)
    await boot()

    const button = el<HTMLButtonElement>('btn-restore-backup')
    button.click()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(backup)
    expect(localStorage.getItem(BACKUP_KEY)).toBe(current)
    expect(statusText()).toBe(m.status.backupRestored)

    button.click()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(current)
    expect(localStorage.getItem(BACKUP_KEY)).toBe(backup)
  })

  it('壞 backup → #error、plan 與兩把 key 皆不動', async () => {
    const current = seedPlan(samplePlan())
    localStorage.setItem(BACKUP_KEY, '{"bad":')
    await boot()

    el<HTMLButtonElement>('btn-restore-backup').click()

    expect(errorText()).toBe(m.errors.importFailed)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(current)
    expect(localStorage.getItem(BACKUP_KEY)).toBe('{"bad":')
    expect(itemRowCount()).toBe(1)
  })

  it('沒有 backup → 播報 noBackup 且不動 STORAGE_KEY', async () => {
    const current = seedPlan(samplePlan())
    await boot()

    el<HTMLButtonElement>('btn-restore-backup').click()

    expect(statusText()).toBe(m.status.noBackup)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(current)
  })
})

describe('backup 時點 (1)：`importPlanReplacing()` 匯入成功後 replace 前', () => {
  it('先寫 backup 再覆蓋；回傳 true 且清單換成新 plan', async () => {
    const current = seedPlan(samplePlan())
    const mod = await boot()

    const incoming = defaultPlan()
    incoming.items = [
      { ...furniture(2), name: '匯入桌' },
      { ...furniture(3), name: '匯入椅' },
    ]
    expect(mod.importPlanReplacing(JSON.stringify(incoming))).toBe(true)

    expect(localStorage.getItem(BACKUP_KEY)).toBe(current)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').items).toHaveLength(2)
    expect(itemRowCount()).toBe(2)
  })

  it('壞 JSON → 回 false、#error 為 importFailed、兩把 key 不動', async () => {
    const current = seedPlan(samplePlan())
    const mod = await boot()

    expect(mod.importPlanReplacing('{ not json')).toBe(false)
    expect(errorText()).toBe(m.errors.importFailed)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(current)
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
    expect(itemRowCount()).toBe(1)
  })
})

/* ------------------------------------------------------------------ *
 * autosave flush（D7：兩事件共用可重入 flushAutosave()）
 * ------------------------------------------------------------------ */

describe('flush：`visibilitychange`(hidden)／`pagehide` 各觸發一次 setItem', () => {
  it('未決 autosave 於 hidden 寫一次；無未決時 pagehide 不再寫；新變更後 pagehide 恰再寫一次', async () => {
    await boot()
    vi.useFakeTimers()
    const spy = vi.spyOn(Storage.prototype, 'setItem')

    addFurniture('書桌', 120, 60)
    expect(spy).not.toHaveBeenCalled()

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toBe(STORAGE_KEY)

    window.dispatchEvent(new Event('pagehide'))
    expect(spy).toHaveBeenCalledTimes(1)

    addFurniture('沙發', 200, 90)
    spy.mockClear()
    window.dispatchEvent(new Event('pagehide'))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('`visibilitychange` 為 visible 時不 flush', async () => {
    await boot()
    vi.useFakeTimers()
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    addFurniture('書桌', 120, 60)

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('尾沿 debounce：連續兩次變更只在最後一次後 300 ms 寫一次', async () => {
    await boot()
    vi.useFakeTimers()
    const mod = await import('./main.js')
    const spy = vi.spyOn(Storage.prototype, 'setItem')

    addFurniture('書桌', 120, 60)
    vi.advanceTimersByTime(mod.AUTOSAVE_DEBOUNCE_MS - 50)
    addFurniture('沙發', 200, 90)
    vi.advanceTimersByTime(mod.AUTOSAVE_DEBOUNCE_MS - 50)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------------------------ *
 * undo／redo 鈕與 `item/purge`
 * ------------------------------------------------------------------ */

describe('undo／redo 鈕（棧操作不經 apply()）', () => {
  it('加入 → 復原 → 家具消失；重做 → 回來', async () => {
    await boot()
    addFurniture('書桌', 120, 60)
    expect(itemRowCount()).toBe(1)

    el<HTMLButtonElement>('btn-undo').click()
    expect(itemRowCount()).toBe(0)

    el<HTMLButtonElement>('btn-redo').click()
    expect(itemRowCount()).toBe(1)
  })

  it('disabled 狀態隨棧深同步', async () => {
    await boot()
    const undoBtn = el<HTMLButtonElement>('btn-undo')
    const redoBtn = el<HTMLButtonElement>('btn-redo')
    expect(undoBtn.disabled).toBe(true)
    expect(redoBtn.disabled).toBe(true)

    addFurniture('書桌', 120, 60)
    expect(undoBtn.disabled).toBe(false)
    expect(redoBtn.disabled).toBe(true)

    undoBtn.click()
    expect(undoBtn.disabled).toBe(true)
    expect(redoBtn.disabled).toBe(false)
  })
})

describe('`#btn-purge`：只由「清空已刪除」鈕觸發（D7）', () => {
  it('無已刪除家具時 disabled；刪除後啟用，confirm 通過即永久移除並播報', async () => {
    await boot()
    const purge = el<HTMLButtonElement>('btn-purge')
    expect(purge.disabled).toBe(true)

    addFurniture('書桌', 120, 60)
    expect(purge.disabled).toBe(true)

    const remove = document.querySelector<HTMLButtonElement>('#items-list .row-delete')
    expect(remove).not.toBeNull()
    remove!.click()
    expect(purge.disabled).toBe(false)
    expect(itemRowCount()).toBe(1)

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    purge.click()
    expect(itemRowCount()).toBe(0)
    expect(statusText()).toBe(m.status.itemsPurged(1))
    expect(purge.disabled).toBe(true)
  })

  it('confirm 取消 → 已刪除家具仍在', async () => {
    await boot()
    addFurniture('書桌', 120, 60)
    document.querySelector<HTMLButtonElement>('#items-list .row-delete')!.click()

    vi.spyOn(window, 'confirm').mockReturnValue(false)
    el<HTMLButtonElement>('btn-purge').click()
    expect(itemRowCount()).toBe(1)
  })
})

/* ------------------------------------------------------------------ *
 * 開機載入路徑（D7：四條載入路徑皆經 parsePlan）
 * ------------------------------------------------------------------ */

describe('開機載入', () => {
  it('無存檔 → 預設 plan，且開機本身不寫 localStorage', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    await boot()
    expect(itemRowCount()).toBe(0)
    expect(el<HTMLInputElement>('room-width').value).toBe(String(defaultPlan().room.width))
    expect(spy).not.toHaveBeenCalled()
  })

  it('部分壞資料 → 其餘照載並播報 planRepaired', async () => {
    const plan = defaultPlan() as unknown as Record<string, unknown>
    const room = plan.room as Record<string, unknown>
    plan.items = [furniture(0), { id: 'bad', name: '', width: 10 }]
    void room
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
    await boot()

    expect(itemRowCount()).toBe(1)
    expect(statusText()).toContain('略過')
    // T4.8：只有 1 筆真正被丟棄的家具，播報句的計數就該是 1。
    expect(statusText()).toBe(m.status.planRepaired(1))
  })

  // T4.8（PLAN §D7）：`maxItems-raised` 是純資訊性 note（軟上限被抬高但
  // 沒有任何家具被丟棄），不該讓「存檔有 N 處無法辨識」誤報——舊版存檔
  // （無 `maxItems` 欄）只要家具超過預設軟上限 20 就會觸發抬高。
  it('30 件家具、存檔缺 maxItems 欄 → 軟上限抬高不觸發「無法辨識」播報，30 件全數載入', async () => {
    const plan = defaultPlan() as unknown as Record<string, unknown>
    plan.items = Array.from({ length: 30 }, (_, i) => furniture(i))
    const settings = plan.settings as Record<string, unknown>
    delete settings.maxItems
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
    await boot()

    expect(statusText()).toBe('')
    expect(statusText()).not.toContain('無法辨識')
    // `#items-list` 分頁門檻 20（OQ1）：第一頁 20 列＋換頁後 10 列＝
    // 30 件全數載入（而非因軟上限被誤判為需要丟棄而少了幾件）。
    expect(itemRowCount()).toBe(20)
    el<HTMLButtonElement>('items-next').click()
    expect(itemRowCount()).toBe(10)
  })

  it('存檔缺 maxItems 欄且另有 1 件真正壞資料 → 播報計數僅算 drop 筆（不含 info）', async () => {
    const plan = defaultPlan() as unknown as Record<string, unknown>
    plan.items = [
      ...Array.from({ length: 30 }, (_, i) => furniture(i)),
      { id: 'bad', name: '', width: 10 },
    ]
    const settings = plan.settings as Record<string, unknown>
    delete settings.maxItems
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
    await boot()

    expect(statusText()).toBe(m.status.planRepaired(1))
    expect(itemRowCount()).toBe(20)
    el<HTMLButtonElement>('items-next').click()
    expect(itemRowCount()).toBe(10)
  })

  // T4.w 起 `loadFromHash()` 回報「這次開機是否自分享連結載入」；沒有
  // `#plan=` 時恆為 false，預覽態的正案在 `io-wiring.dom.test.ts`。
  it('`loadFromHash()`／`isPreview()` 在沒有分享 hash 時皆為 false', async () => {
    const mod = await boot()
    expect(mod.loadFromHash()).toBe(false)
    expect(mod.isPreview()).toBe(false)
  })
})
