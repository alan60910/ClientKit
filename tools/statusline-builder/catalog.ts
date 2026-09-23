/**
 * T5.9（(internal design doc) §D3-R4「transfer-list
 * 互動（灰化留位）」，依賴 T5.8 三欄結構）：左欄目錄 view-model 純函式
 * ——DOM-free，供 main.ts 消費／可獨立單元測試（main.ts 檔尾即執行 DOM
 * query，import 該檔在 node 測試環境無 jsdom 會立即拋錯，故沿用
 * row-groups.ts／row-select.ts 先例把可測邏輯抽出獨立零 DOM 依賴模組；
 * DOM 組裝——建立左欄常駐 `<li>`、掛勾選事件——留在 main.ts，只機械消費
 * 本模組的計算結果）。
 *
 * 「目錄定義序恆定」不變量（PLAN §D3-R4「左欄…目錄順序恆定（目錄定義
 * 序），永不重排、無拖曳」）：本模組僅依 `descriptors` 陣列既有順序輸出
 * 分組結果，刻意**不**依賴 `segments`（`BuilderConfig.segments`）的陣列
 * 順序——`segments` 僅作為「id → enabled」查表使用。`segments` 陣列序
 * 可能因 T5.5 同列交換等操作而與目錄定義序（`SEGMENT_DESCRIPTORS`）
 * 偏離，若誤用其順序建置左欄項會違反「永不重排」契約；main.ts 呼叫本
 * 函式時固定傳入 `SEGMENT_DESCRIPTORS`（目錄定義序恆定的真來源）。
 */
import type { SegmentConfig } from './config.js'
import type { SegmentCategory } from './segments.js'

/** 左欄目錄單一項目 view-model（main.ts 據此生成/更新輕量常駐 `<li>`）。 */
export interface CatalogItemView {
  id: string
  label: string
  enabled: boolean
}

/**
 * `buildCatalogGroups` 的最小輸入面（非直接用 `Pick<SegmentDescriptor,
 * …>`）：`SegmentDescriptor.id` 型別為 `SegmentId`（真目錄字面聯合），
 * 對本模組的分組/排序邏輯而言無須收窄至該聯合——用寬鬆 `string` 讓
 * 測試可餵入不屬於真目錄的假 descriptor，不因型別耦合被迫依賴
 * segments.ts 的完整 25 段字面聯合。`SEGMENT_DESCRIPTORS`（`id:
 * SegmentId`，`SegmentId extends string`）結構相容，main.ts 可直接
 * 傳入不需轉型。
 */
export interface CatalogDescriptorLike {
  readonly id: string
  readonly label: string
  readonly category: SegmentCategory
}

/**
 * 依 `categoryOrder`（分區順序）分組＋各類別內沿用 `descriptors` 既有
 * 順序，計算左欄目錄 view-model。`enabled` 狀態查表自 `segments`；查無
 * 對應項（理論上不應發生——config 清洗保證每個目錄 id 恰有一筆）視為
 * 未啟用（防禦性預設，非拒收）。
 *
 * 輸出結構＝`Record<category, CatalogItemView[]>`，每個類別鍵恆存在
 * （即使該類別於 `descriptors` 中無成員，仍回傳空陣列，非缺鍵）——
 * main.ts 可直接以 `categoryOrder` 逐一取用，不需額外防禦缺鍵。
 */
export function buildCatalogGroups(
  descriptors: readonly CatalogDescriptorLike[],
  segments: readonly Pick<SegmentConfig, 'id' | 'enabled'>[],
  categoryOrder: readonly SegmentCategory[],
): Record<SegmentCategory, CatalogItemView[]> {
  const enabledById = new Map(segments.map((seg) => [seg.id, seg.enabled]))
  const groups = Object.fromEntries(
    categoryOrder.map((category) => [category, [] as CatalogItemView[]]),
  ) as Record<SegmentCategory, CatalogItemView[]>
  for (const descriptor of descriptors) {
    groups[descriptor.category].push({
      id: descriptor.id,
      label: descriptor.label,
      enabled: enabledById.get(descriptor.id) ?? false,
    })
  }
  return groups
}
