/**
 * T5.14（(internal design doc) T5.14／PLAN Rev 11，
 * 2026-07-12 使用者裁決「列耗盡保留＋暫存列位置制」）：中欄「列」的 UI
 * 位置制 slots——DOM-free 純函式模組（比照 row-groups.ts／row-select.ts
 * 慣例：main.ts 檔尾即於模組頂層執行 DOM query，import 該檔會在 node 測試
 * 環境〔無 jsdom〕立即拋錯，故把可測邏輯抽出獨立零 DOM 依賴模組）。
 *
 * 由來（Rev 11 取代 T5.9 計數制暫存列）：跨列移動把來源列搬空時，該列
 * 須**原地保留為空列**（暫存列樣式、位置編號不變，不被空列壓縮立即吃
 * 掉）。計數制（單一 `pendingRowCount`，暫存列恆接於真實列之後）無法表達
 * 「空列在中間」，故升級為**位置制**：一條 `RowSlot[]` 陣列，每個元素為
 * `'real'`（承載真實渲染列）或 `'pending'`（純 UI 空列），slot 的**位置**
 * 即其顯示列序（「第 N 列」＝slot index + 1），空列可落在任一位置。
 *
 * 引擎鐵律（不得動；見 TASKS.md T5.14 §引擎鐵律）：config 恆無空列——空列
 * 僅存在於本模組的 slots（UI 態）。真實列與 config 的對應：第 k 個 `'real'`
 * slot ↔ normalizeRows 後 config 的第 k 個渲染列（0-index），映射即
 * `realIndexOfSlot`／`slotIndexOfRealRow` 互逆對。
 *
 * 各函式皆為純函式：回傳新陣列，絕不 mutate 輸入（同 row-groups.ts
 * computeRowSwap／computeCrossRowMove「不 mutate 輸入」慣例）。
 */

/** 單一 UI 列位（slot）的種類：承載真實渲染列 vs 純 UI 暫存空列。 */
export type RowSlot = 'real' | 'pending'

/** slots 中 `'real'` slot 的總數（＝目前實際渲染列數，恆等於 commit 後
 * computeRowGroups(...).length，見 reconcileRealSlots 防禦收斂）。 */
export function realCount(slots: readonly RowSlot[]): number {
  let n = 0
  for (const slot of slots) if (slot === 'real') n += 1
  return n
}

/**
 * `slotIndex` **之前**（不含）的 `'real'` slot 數：
 * - `slotIndex` 為某 `'real'` slot ＝其真實列 index（0-index）；
 * - `slotIndex` 為某 `'pending'` slot ＝「指派成真時的插入 real index」
 *   （consume 後該位置即成為第此數個 real）；
 * - `slotIndex` 為 slots 長度（末端）＝全部 real 數。
 * 與 `slotIndexOfRealRow` 對 `'real'` slot 互逆。
 */
export function realIndexOfSlot(slots: readonly RowSlot[], slotIndex: number): number {
  let n = 0
  const upper = Math.min(slotIndex, slots.length)
  for (let i = 0; i < upper; i++) if (slots[i] === 'real') n += 1
  return n
}

/**
 * 第 `rowIndex` 個 `'real'` slot 的 slot 位置（0-index）——顯示列編號即
 * `slotIndexOfRealRow(slots, realIndex) + 1`（真實列之上的中間 pending 會
 * 把其 slot 位置向後推）。`rowIndex` 超出 real 數（防禦；正常互動下不會
 * 發生——各呼叫端傳入的 real index 恆有效）時回傳 slots 長度（past-the-
 * end，供 insertBefore(null)＝末端 append 語意安全退化）。
 */
export function slotIndexOfRealRow(slots: readonly RowSlot[], rowIndex: number): number {
  let n = 0
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === 'real') {
      if (n === rowIndex) return i
      n += 1
    }
  }
  return slots.length
}

/** 新增一列（中欄「＋ 新增一列」按鈕）：於末端追加一個 pending slot。 */
export function appendPendingSlot(slots: readonly RowSlot[]): RowSlot[] {
  return [...slots, 'pending']
}

/**
 * 移除 `slotIndex` 位置的 slot（陣列縮短一格；其後 slot 前移）。用於：
 * 暫存列刪除鈕（**點哪刪哪**）、真實列消失（✕移除／取消勾選耗盡、整列
 * 刪除——**壓縮語意**：列消失、不留空列）。
 */
export function removeSlotAt(slots: readonly RowSlot[], slotIndex: number): RowSlot[] {
  return slots.filter((_, i) => i !== slotIndex)
}

/**
 * pending → real（指派成真）：**位置不變**，僅翻該 slot 的 kind——空列
 * 於原位轉為真實列，其上／下所有 slot 位置皆不動（故顯示編號穩定）。
 */
export function consumePendingSlot(slots: readonly RowSlot[], slotIndex: number): RowSlot[] {
  return slots.map((slot, i) => (i === slotIndex ? 'real' : slot))
}

/**
 * real → pending（列耗盡保留）：**位置不變**，僅翻該 slot 的 kind——來源
 * 列被搬空後於原位保留為暫存空列，其上／下所有 slot 位置皆不動（故其餘
 * 列的顯示編號不變，修正舊「空列壓縮立即吃掉」根因）。
 */
export function convertRealToPending(slots: readonly RowSlot[], slotIndex: number): RowSlot[] {
  return slots.map((slot, i) => (i === slotIndex ? 'pending' : slot))
}

/**
 * T5.14 追修（協調者 CDP 實證 S4「空列成真＋來源耗盡抵銷」）：兩條
 * `RowSlot[]` 是否等價（長度與逐位置 kind 皆相同）。main.ts 據此偵測
 * 「slots 是否實際變動」——見 commitConfig 之
 * `lastRenderedSlots`／`slotsEqual` 重繪閘門文件：分組結構 rowGroupsEqual
 * 為真時，slots 仍可能已變（如「指派入某空列」與「來源列同幀耗盡」的
 * real +1／−1 恰好抵銷，真實分組結構 before/after 完全相同），若僅依
 * rowGroupsEqual 判斷會漏重繪。與 rowGroupsEqual／row-groups.ts 同慣例：
 * 純函式、無 DOM 依賴。
 */
export function slotsEqual(a: readonly RowSlot[], b: readonly RowSlot[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * 防禦收斂（理論上不會觸發——各變異點〔consume／convert／removeSlotAt／
 * appendPendingSlot〕已顯式維護 `realCount(slots)` 與渲染列數同步）：把
 * slots 的 real 數校正為 `targetRealCount`。
 * - real 數不足：於**最後一個 real 之後**補 real（無 real 則自 slot 0 補）；
 * - real 數過多：**自尾端 real** 逐一移除。
 * 純函式（回傳新陣列，不 mutate 輸入）；main.ts layoutSegmentContainers
 * 於每次分組變動後呼叫作為安全網。
 */
export function reconcileRealSlots(slots: readonly RowSlot[], targetRealCount: number): RowSlot[] {
  const next = [...slots]
  let current = realCount(next)
  if (current < targetRealCount) {
    let insertAt = 0
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i] === 'real') {
        insertAt = i + 1
        break
      }
    }
    while (current < targetRealCount) {
      next.splice(insertAt, 0, 'real')
      insertAt += 1
      current += 1
    }
  } else if (current > targetRealCount) {
    for (let i = next.length - 1; i >= 0 && current > targetRealCount; i--) {
      if (next[i] === 'real') {
        next.splice(i, 1)
        current -= 1
      }
    }
  }
  return next
}

// ── 統一移動入口的決策層（MAGI code review I-3，(internal design doc) ──
// ── multirow-layout/(internal design doc)，2026-07-12 使用者裁決「修」） ──

/**
 * 跨列移動／指派的落點（main.ts commitSegmentMove 之統一移動入口共用；
 * I-3 前原宣告於 main.ts，因 `planSegmentMove` 需要此型別而移入本模組
 * ——main.ts 改 `import type { DropTarget } from './row-slots.js'`，
 * 單一事實來源，不重複宣告）：`real`＝落在既有真實列（row＝該列 0-index
 * 渲染列序）；`pending`＝落在某 UI 暫存空列（slotIndex＝其在 slots 的
 * 位置）。
 */
export type DropTarget = { kind: 'real'; row: number } | { kind: 'pending'; slotIndex: number }

/** `planSegmentMove` 所需的段最小結構（結構型別——`SegmentConfig` 等具
 * 完整欄位的物件皆可直接傳入，多餘欄位不影響比對）。 */
export interface PlanSegmentInput {
  id: string
  enabled: boolean
  row?: number
}

/**
 * `planSegmentMove` 的決策結果：
 * - `targetRow`：移動段最終應寫回的 `row`（real 1-index？不——為 0-index
 *   渲染列序，供呼叫端直接 `seg.row = targetRow` 並交
 *   `computeCrossRowMove`／`performCrossRowMove`）；
 * - `nextSlots`：套用本次移動後的新 slots（純值，呼叫端整批取代
 *   `rowSlots`）；
 * - `bumpIds`：呼叫端須逐一把這些段的 `row` 欄位 `+1`（原地 mutate，
 *   `planSegmentMove` 本身不 mutate 任何輸入——純函式僅回傳「決策」，
 *   實際 config 的 bump／寫回交呼叫端執行，同 `computeRowSwap`／
 *   `computeCrossRowMove`「不 mutate 輸入」慣例）。
 */
export interface SegmentMovePlan {
  targetRow: number
  nextSlots: RowSlot[]
  bumpIds: string[]
}

/**
 * 統一移動入口 commitSegmentMove 的**決策層**（I-3 自 main.ts 抽出）：
 * 純函式，含原 commitSegmentMove 步驟 1–4 的全部決策邏輯——main.ts 呼叫
 * 本函式取得 `SegmentMovePlan` 後，僅需：依 `bumpIds` 原地 bump（既有
 * `segmentConfigById` 物件參照 mutate 慣例）→ `rowSlots = plan.nextSlots`
 * → `performCrossRowMove(movedId, plan.targetRow, beforeId)`（真正搬
 * config／DOM＋播報，不變）。
 *
 * 內部順序**順序敏感**（與原 main.ts 版本行為等價，見 row-slots.test.ts
 * 組合矩陣）：
 * 1. 取來源列 `sourceRow`（`segments` 中 `movedId` 目前 `enabled` 時之
 *    `row ?? 0`；否則 0，防禦——正常呼叫下 moved 恆為啟用段）＋判定
 *    `srcDrains`（來源列除 moved 外無其他啟用段）。
 * 2. `srcSlot`——**必須在任何 slots 變更前**依 `slots`（輸入原樣）計算
 *    （consume／convert 只翻 kind 不移位置，故此值於後續步驟仍有效）。
 * 3. `target.kind==='pending'`：`targetRow=realIndexOfSlot(slots, slotIndex)`
 *    → 收集「非 moved 的啟用段 row ≥ targetRow」者之 id 為 `bumpIds`
 *    （不在此 mutate，僅收集決策）→ `nextSlots=consumePendingSlot(slots,
 *    slotIndex)`。`target.kind==='real'`：`targetRow=target.row`、
 *    `bumpIds=[]`、`nextSlots=[...slots]`（無 bump）。
 * 4. `srcDrains` 且非「同列插入」（`target.kind==='real' &&
 *    targetRow===sourceRow`；pending target 恆非同列插入，即使數值上
 *    `targetRow===sourceRow` 亦然——見測試「pending target sourceRow＝
 *    targetRow」案例）→ `nextSlots=convertRealToPending(nextSlots, srcSlot)`
 *    （套用於**步驟 3 之後**的 `nextSlots`，非原始 `slots`）。
 *
 * 不變量（同原 commitSegmentMove 文件）：pending consume（real +1）與
 * 來源耗盡 convert（real −1）任意組合後，`realCount(nextSlots)` 恆等於
 * 呼叫端 commit 後實際渲染列數。
 */
export function planSegmentMove(
  slots: readonly RowSlot[],
  segments: readonly PlanSegmentInput[],
  movedId: string,
  target: DropTarget,
): SegmentMovePlan {
  // 1. 來源列＋是否搬空。
  const movedSeg = segments.find((seg) => seg.id === movedId)
  const sourceRow = movedSeg !== undefined && movedSeg.enabled ? movedSeg.row ?? 0 : 0
  const srcDrains = !segments.some(
    (other) => other.id !== movedId && other.enabled && (other.row ?? 0) === sourceRow,
  )

  // 2. slots 變更前先算來源列的 slot 位置。
  const srcSlot = slotIndexOfRealRow(slots, sourceRow)

  // 3. 落點解析＋（pending 時）收集 bump 決策＋於該位置插入真實列。
  let targetRow: number
  let nextSlots: RowSlot[]
  const bumpIds: string[] = []
  if (target.kind === 'pending') {
    targetRow = realIndexOfSlot(slots, target.slotIndex)
    for (const other of segments) {
      if (other.id === movedId || !other.enabled) continue
      if ((other.row ?? 0) >= targetRow) bumpIds.push(other.id)
    }
    nextSlots = consumePendingSlot(slots, target.slotIndex)
  } else {
    targetRow = target.row
    nextSlots = [...slots]
  }

  // 4. 來源列耗盡（且非同列插入）→ 原位保留為空列。
  const sameRowInsert = target.kind === 'real' && targetRow === sourceRow
  if (srcDrains && !sameRowInsert) {
    nextSlots = convertRealToPending(nextSlots, srcSlot)
  }

  return { targetRow, nextSlots, bumpIds }
}
