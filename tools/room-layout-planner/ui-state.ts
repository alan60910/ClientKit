/**
 * T2.2 — UI 態型別與畫布常數（(internal design doc)
 * §狀態與資料形「UI 態（不入存檔）」、§D10 render「標籤隱藏門檻（OQ2
 * 定案）」、§D1「zoom 一律改 viewBox」）。
 *
 * 呼叫圖葉模組：只以 `import type` 取用 `reducer.ts` 的 `DragState`
 * （編譯期抹除，無執行期相依），不參照 DOM，亦不被 `reducer.ts` 反向
 * 依賴——故 board／drag／panel／main 四處共用同一份 UI 態定義而無循環。
 *
 * 本檔與存檔資料形（`model.ts` 的 `RoomPlan`）嚴格分離：這裡的欄位一律
 * **不入 localStorage、不入匯出 JSON、不入分享連結**。
 */
import type { DragState } from './reducer.js'

/**
 * 畫布與面板共用的 UI 態。`zoom`／`panX`／`panY` 為 viewBox 的唯一輸入
 * （D1：zoom 改 viewBox，不用 CSS transform；`zoom` 為相對 fit 的倍率）；
 * `dragging` 於拖移期由 `drag.ts` 維護，非 null 時 `main.ts` 不呼叫
 * `board.setView()`（D2：拖曳中凍結 viewBox）。
 */
export interface UiState {
  /** 目前選中的家具／方塊／門 id；roving tabindex 的 `0` 停點（null 時落在第一個可拖移節點）。 */
  selectedId: string | null
  /** 相對 fit 的縮放倍率（1＝fit）；「目前比例」文字即 `zoom × 100%`。 */
  zoom: number
  /** 以 cm 計的平移量（相對 bounds 中心）。 */
  panX: number
  panY: number
  /** `items-list` 目前頁碼（自 1 起）。 */
  page: number
  /** `report-list` 目前頁碼（自 1 起）。 */
  reportPage: number
  /** 自分享連結載入的預覽態（D7：debounce 與 flush 皆停用）。 */
  fromShare: boolean
  /** 預覽態下是否已有未保存的變更（決定是否掛 `beforeunload`）。 */
  dirty: boolean
  /** 「顯示距離」switch（關閉時 `clearanceCore` 走 `maxGap` 預篩，D4 兩路徑）。 */
  showDistance: boolean
  /** 「顯示警示」switch（關閉時三類警示皆不畫，report 仍計算，D3）。 */
  showWarnings: boolean
  /** 拖移態（D10「拖移態統一」）；非拖移期為 null。 */
  dragging: DragState | null
}

/** 初始 UI 態：無選中、fit、第一頁、非預覽態、顯示距離關／顯示警示開。 */
export const DEFAULT_UI: UiState = {
  selectedId: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  page: 1,
  reportPage: 1,
  fromShare: false,
  dirty: false,
  showDistance: false,
  showWarnings: true,
  dragging: null,
}

/**
 * 標籤隱藏門檻（OQ2 定案，D10）：**渲染字級** < 9 px 即隱藏家具名稱——
 * 以 `fontSize × getScreenCTM().a` 為準、不以 zoom 倍率為準（`meet`
 * 取兩軸較小者，1×5000 極端房的「僅寬公式」會算出 9600 px 而實際只有
 * 1.44 px）。門檻 7–9 px 隱藏集合相同，取 9 px 居中穩健。
 */
export const LABEL_HIDE_BELOW_PX = 9

/** 家具名稱標籤字級（user unit；`board.ts` 寫為 `font-size` presentation attribute，PNG 匯出據此取樣）。 */
export const LABEL_FONT_SIZE = 12

/** 縮放級距（fit＝1×；`board-toolbar` 的縮放 ± 鈕沿此表移動）。 */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const
