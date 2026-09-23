/**
 * S4-T2.3（(internal design doc) §Recommended approach「limits.ts」、
 * §UI 狀態機播報映射表）：記憶體 gate、進度 clamp／播報 cadence／進度率式
 * ETA、輸出檔名推導。純函式、零 DOM import，node 可測。
 */

/**
 * 記憶體警示閘門檻（warn-continue：超過只警示「仍要繼續」、不阻擋——沿用
 * gif-editor main.ts 的 gate 模式）。影片以輸入檔案大小為 proxy，不同於
 * gif-editor 的解碼後估算：wasm 端實際峰值（MEMFS/WORKERFS＋faststart
 * 二次寫檔）與輸入大小的關係待實測。
 *
 * 暫定 512 MB —— SP-3 於 T4.3 量測後回填定值。
 */
export const MEMORY_GATE_BYTES = 512 * 1024 * 1024

/** 檔案大小是否超過記憶體警示閘（嚴格大於：恰等於門檻不警示）。 */
export function exceedsMemoryGate(fileSizeBytes: number): boolean {
  return fileSizeBytes > MEMORY_GATE_BYTES
}

/**
 * 進度 clamp 至 [0,1]（PLAN §UI 狀態機 converting 列）：ffmpeg.wasm 的
 * progress 事件可能吐出範圍外值或非數值，播報與進度條一律先收斂。
 * 非 number／NaN／負值 → 0；>1 → 1。
 */
export function clampProgress(p: unknown): number {
  if (typeof p !== 'number' || Number.isNaN(p)) return 0
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}

/**
 * 進度率式 ETA（PLAN §UI 狀態機：probe 與 blind-transcode 兩路徑統一，
 * 不依賴 durationSec）：`elapsed × (1 − progress) / progress`。
 *
 * 回傳 null＝無可信估計（呼叫端不播 ETA、退心跳）：progress ≤ 0（尚無
 * 進度率可外推）、progress ≥ 1（已完成）、elapsedMs < 0、或任一參數非
 * 有限數。
 */
export function estimateEtaMs(elapsedMs: number, progress: number): number | null {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(progress)) return null
  if (elapsedMs < 0) return null
  if (progress <= 0 || progress >= 1) return null
  return (elapsedMs * (1 - progress)) / progress
}

/**
 * 播報 cadence 門檻（PLAN §UI 狀態機 converting 列「每 5–10% 或每 15–30s
 * 擇低頻」——取兩區間的低頻端）。暫定值：SP-5 效能基準量測後回填定值。
 */
export const PROGRESS_ANNOUNCE_MIN_DELTA = 0.1
export const PROGRESS_ANNOUNCE_MIN_INTERVAL_MS = 30_000

/**
 * converting 期進度是否該播報：首次（lastAnnounced 為 null）必播；其後
 * 進度增量 ≥ PROGRESS_ANNOUNCE_MIN_DELTA **或** 距上次播報 ≥
 * PROGRESS_ANNOUNCE_MIN_INTERVAL_MS，任一成立即播。停滯 >60s 的「仍在
 * 處理中」心跳由 30s 時間項自然涵蓋觸發時機，文案切換屬 main.ts 職責。
 */
export function shouldAnnounceProgress(
  lastAnnounced: { progress: number; atMs: number } | null,
  current: { progress: number; atMs: number },
): boolean {
  if (lastAnnounced === null) return true
  return (
    current.progress - lastAnnounced.progress >= PROGRESS_ANNOUNCE_MIN_DELTA ||
    current.atMs - lastAnnounced.atMs >= PROGRESS_ANNOUNCE_MIN_INTERVAL_MS
  )
}

/**
 * 輸出檔名推導（PLAN §核心流程「原檔名.mp4」）：去掉最後一個副檔名後接
 * `.mp4`。
 * - 無副檔名（`video`）→ 直接補 `.mp4`。
 * - 隱藏檔式（`.mkv`——唯一的點在開頭）視為無可分離副檔名的純檔名：
 *   剝掉會剩空字串，故整名保留 → `.mkv.mp4`。
 * - 輸入已是 `.mp4`（副檔名比對不分大小寫）→ 插入 `.converted`
 *   （`x.mp4` → `x.converted.mp4`）：輸出一律 MP4，沿用原名會讓下載檔
 *   與原始檔同名並存，使用者難以分辨哪個是轉換結果（設計決策，測試釘住）。
 * - 空字串防禦 → `output.mp4`（避免產出 `.mp4` 這種隱藏檔式檔名）。
 */
export function deriveOutputName(inputName: string): string {
  if (inputName === '') return 'output.mp4'
  const dotIndex = inputName.lastIndexOf('.')
  const hasExt = dotIndex > 0 // 位於開頭的點（隱藏檔式）不視為副檔名分隔
  const base = hasExt ? inputName.slice(0, dotIndex) : inputName
  const ext = hasExt ? inputName.slice(dotIndex + 1).toLowerCase() : ''
  if (ext === 'mp4') return `${base}.converted.mp4`
  return `${base}.mp4`
}

/**
 * ETA 播報文案（PLAN §UI 狀態機 converting 列「預估剩餘約 M 分」）。
 * 規則（設計自洽、測試釘住）：
 * - < 60s → 「不到 1 分鐘」。
 * - 60s–90s（含 90s）→ 「不到 2 分鐘」：此區間說「約 1 分鐘」會低估、
 *   進位成「約 2 分鐘」又高估近一倍，上界式文案最誠實。
 * - > 90s → 「約 N 分鐘」，N＝進位（ceil）到整分鐘——寧可略高估，避免
 *   使用者等超過播報值。
 * - 負值／NaN 防禦性收斂為「不到 1 分鐘」（契約上呼叫端只會傳
 *   estimateEtaMs 的非 null 回傳值，此分支不應觸及）。
 */
export function formatEta(etaMs: number): string {
  if (!Number.isFinite(etaMs) || etaMs < 60_000) return '不到 1 分鐘'
  if (etaMs <= 90_000) return '不到 2 分鐘'
  return `約 ${Math.ceil(etaMs / 60_000)} 分鐘`
}
