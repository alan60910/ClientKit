/**
 * T1.3（(internal design doc) §D5 擺放建議的落地形式；
 * §Recommended approach 模組表）：常見家具預設尺寸庫（D5 表，13 筆）＋
 * 側欄「一般通則」短清單。
 *
 * 純資料＋兩個純函式，零 DOM。`clearances` 為**區域座標**（家具未旋轉時
 * 的本地 N/E/S/W），分析時經 `worldSide()`（model.ts）映射為世界方向——
 * 本檔不做映射，只提供原始表格資料，見 D5 表與 clearance.ts 消費點。
 * `passable` 除茶几外一律 `true`（D5：茶几「整體不參與通道警示」）。
 */
import type { Side } from './model.js'

export interface Preset {
  key: string
  name: string
  width: number
  depth: number
  passable: boolean
  clearances?: Partial<Record<Side, number>>
}

/** D5 表，13 筆定案（key 為 kebab-case ascii，供 UI 一鍵加入與測試鎖定）。 */
export const PRESETS: readonly Preset[] = [
  // 單側上下床。
  { key: 'single-bed-3', name: '單人床 3 尺', width: 91, depth: 188, passable: true, clearances: { E: 60 } },
  // 兩人各自上下床。
  { key: 'double-bed-5', name: '雙人床 5 尺', width: 152, depth: 188, passable: true, clearances: { E: 60, W: 60 } },
  { key: 'queen-bed-6', name: '加大雙人床 6 尺', width: 182, depth: 188, passable: true, clearances: { E: 60, W: 60 } },
  // 門片外開＋站立取物。
  { key: 'wardrobe-hinged', name: '衣櫃（開門式）', width: 120, depth: 60, passable: true, clearances: { S: 90 } },
  // 無門片外開。
  { key: 'wardrobe-sliding', name: '衣櫃（拉門式）', width: 120, depth: 60, passable: true, clearances: { S: 60 } },
  // 椅子後拉＋起身。
  { key: 'desk', name: '書桌', width: 120, depth: 60, passable: true, clearances: { S: 75 } },
  // 拉椅入座（四面皆需）。
  {
    key: 'dining-table-4',
    name: '餐桌 4 人',
    width: 120,
    depth: 75,
    passable: true,
    clearances: { N: 75, E: 75, S: 75, W: 75 },
  },
  // 伸腿；沙發本身可通行，該對通道實務由茶几列抑制（D5 註）。
  { key: 'sofa-3', name: '三人沙發', width: 200, depth: 90, passable: true, clearances: { S: 40 } },
  // 整體不參與通道警示（唯一 passable:false）。
  { key: 'coffee-table', name: '茶几', width: 100, depth: 50, passable: false },
  { key: 'nightstand', name: '床頭櫃', width: 45, depth: 40, passable: true },
  // 開門。
  { key: 'fridge', name: '冰箱', width: 70, depth: 70, passable: true, clearances: { S: 90 } },
  // 開門／取衣。
  { key: 'washer', name: '洗衣機', width: 60, depth: 60, passable: true, clearances: { S: 60 } },
  // 視距建議移至側欄通則文字，不入引擎（D5 註）。
  { key: 'tv-stand', name: '電視櫃', width: 150, depth: 40, passable: true },
]

/** D5 側欄「一般通則」短清單，五句。 */
export const GENERAL_TIPS: readonly string[] = [
  '門迴旋區勿放家具',
  '主動線直線不轉折',
  '窗前避免高櫃',
  '床頭避開門正對',
  '電視視距 ≥ 螢幕對角 1.5 倍',
]

/** 依 key 查表；找不到回傳 `undefined`（呼叫端自行決定是否退預設值）。 */
export function findPreset(key: string): Preset | undefined {
  return PRESETS.find((preset) => preset.key === key)
}
