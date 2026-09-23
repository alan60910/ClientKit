/**
 * S4-T2.3（(internal design doc) §UI 狀態機播報映射表、
 * §Recommended approach「limits.ts」）：gate 邊界、clamp、進度率式 ETA、
 * 播報 cadence、輸出檔名推導、ETA 文案——全函式全分支釘住。
 */
import { describe, expect, it } from 'vitest'
import {
  clampProgress,
  deriveOutputName,
  estimateEtaMs,
  exceedsMemoryGate,
  formatEta,
  MEMORY_GATE_BYTES,
  PROGRESS_ANNOUNCE_MIN_DELTA,
  PROGRESS_ANNOUNCE_MIN_INTERVAL_MS,
  shouldAnnounceProgress,
} from './limits.js'

describe('exceedsMemoryGate（暫定 512 MB，SP-3 於 T4.3 量測後回填）', () => {
  it('門檻值為 512 MB', () => {
    expect(MEMORY_GATE_BYTES).toBe(512 * 1024 * 1024)
  })

  it('恰等於門檻：不警示（嚴格大於才觸發）', () => {
    expect(exceedsMemoryGate(MEMORY_GATE_BYTES)).toBe(false)
  })

  it('門檻 +1 byte：警示', () => {
    expect(exceedsMemoryGate(MEMORY_GATE_BYTES + 1)).toBe(true)
  })

  it('門檻 -1 byte：不警示', () => {
    expect(exceedsMemoryGate(MEMORY_GATE_BYTES - 1)).toBe(false)
  })
})

describe('clampProgress（收斂至 [0,1]）', () => {
  it('非 number（字串）→ 0', () => {
    expect(clampProgress('x')).toBe(0)
  })

  it('非 number（undefined／null）→ 0', () => {
    expect(clampProgress(undefined)).toBe(0)
    expect(clampProgress(null)).toBe(0)
  })

  it('NaN → 0', () => {
    expect(clampProgress(Number.NaN)).toBe(0)
  })

  it('負值 → 0', () => {
    expect(clampProgress(-1)).toBe(0)
    expect(clampProgress(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('0 → 0（下邊界原值通過）', () => {
    expect(clampProgress(0)).toBe(0)
  })

  it('0.5 → 0.5（區間內原值通過）', () => {
    expect(clampProgress(0.5)).toBe(0.5)
  })

  it('1 → 1（上邊界原值通過）', () => {
    expect(clampProgress(1)).toBe(1)
  })

  it('>1 → 1', () => {
    expect(clampProgress(1.5)).toBe(1)
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe('estimateEtaMs（進度率式：elapsed × (1−progress) / progress）', () => {
  it('progress = 0 → null（無進度率可外推，無 ETA 分支）', () => {
    expect(estimateEtaMs(60_000, 0)).toBeNull()
  })

  it('progress 0.5、elapsed 60000 → 60000（走了一半，剩下同樣久）', () => {
    expect(estimateEtaMs(60_000, 0.5)).toBe(60_000)
  })

  it('progress 0.99、elapsed 99000 → 1000（接近完成時 ETA 趨近 0）', () => {
    expect(estimateEtaMs(99_000, 0.99)).toBeCloseTo(1_000, 6)
  })

  it('progress = 1 → null（已完成，無剩餘可估）', () => {
    expect(estimateEtaMs(60_000, 1)).toBeNull()
  })

  it('progress > 1 → null', () => {
    expect(estimateEtaMs(60_000, 1.5)).toBeNull()
  })

  it('progress 負值 → null', () => {
    expect(estimateEtaMs(60_000, -0.5)).toBeNull()
  })

  it('elapsed 負值 → null', () => {
    expect(estimateEtaMs(-1, 0.5)).toBeNull()
  })

  it('非有限數（Infinity／NaN，任一參數）→ null', () => {
    expect(estimateEtaMs(Number.POSITIVE_INFINITY, 0.5)).toBeNull()
    expect(estimateEtaMs(60_000, Number.POSITIVE_INFINITY)).toBeNull()
    expect(estimateEtaMs(Number.NaN, 0.5)).toBeNull()
    expect(estimateEtaMs(60_000, Number.NaN)).toBeNull()
  })

  it('elapsed = 0（progress 有效）→ 0，非 null（瞬時完成的極端合法值）', () => {
    expect(estimateEtaMs(0, 0.5)).toBe(0)
  })
})

describe('shouldAnnounceProgress（cadence：Δ≥10% 或 ≥30s，暫定值 SP-5 回填）', () => {
  it('暫定門檻值：10%／30s', () => {
    expect(PROGRESS_ANNOUNCE_MIN_DELTA).toBe(0.1)
    expect(PROGRESS_ANNOUNCE_MIN_INTERVAL_MS).toBe(30_000)
  })

  it('首次（lastAnnounced 為 null）→ 播', () => {
    expect(shouldAnnounceProgress(null, { progress: 0.01, atMs: 0 })).toBe(true)
  })

  it('進度 +9%、時間 <30s → 不播（兩條件皆未達）', () => {
    expect(
      shouldAnnounceProgress({ progress: 0.1, atMs: 0 }, { progress: 0.19, atMs: 10_000 }),
    ).toBe(false)
  })

  it('進度 +10%（恰達門檻）、時間 <30s → 播', () => {
    expect(
      shouldAnnounceProgress({ progress: 0.1, atMs: 0 }, { progress: 0.2, atMs: 10_000 }),
    ).toBe(true)
  })

  it('進度未達、經過 29s → 不播', () => {
    expect(
      shouldAnnounceProgress({ progress: 0.1, atMs: 0 }, { progress: 0.11, atMs: 29_000 }),
    ).toBe(false)
  })

  it('進度未達、經過 30s（恰達門檻）→ 播（停滯下時間項獨立成立）', () => {
    expect(
      shouldAnnounceProgress({ progress: 0.1, atMs: 0 }, { progress: 0.1, atMs: 30_000 }),
    ).toBe(true)
  })

  it('兩條件同時滿足 → 播', () => {
    expect(
      shouldAnnounceProgress({ progress: 0.1, atMs: 0 }, { progress: 0.5, atMs: 60_000 }),
    ).toBe(true)
  })
})

describe('deriveOutputName（原檔名.mp4）', () => {
  it('多段副檔名只去最後一段：video.final.mkv → video.final.mp4', () => {
    expect(deriveOutputName('video.final.mkv')).toBe('video.final.mp4')
  })

  it('一般案：clip.webm → clip.mp4', () => {
    expect(deriveOutputName('clip.webm')).toBe('clip.mp4')
  })

  it('無副檔名：video → video.mp4', () => {
    expect(deriveOutputName('video')).toBe('video.mp4')
  })

  it('隱藏檔式（唯一的點在開頭）：.mkv → .mkv.mp4（整名視為無副檔名的純檔名）', () => {
    expect(deriveOutputName('.mkv')).toBe('.mkv.mp4')
  })

  it('隱藏檔式且「副檔名」是 mp4：.mp4 → .mp4.mp4（開頭的點不視為分隔，不走 .converted 分支）', () => {
    expect(deriveOutputName('.mp4')).toBe('.mp4.mp4')
  })

  it('輸入已是 .mp4 → 插入 .converted（避免與原始檔同名混淆——設計決策）', () => {
    expect(deriveOutputName('x.mp4')).toBe('x.converted.mp4')
  })

  it('.mp4 比對不分大小寫：CLIP.MP4 → CLIP.converted.mp4', () => {
    expect(deriveOutputName('CLIP.MP4')).toBe('CLIP.converted.mp4')
  })

  it('結尾帶點（空副檔名）：video. → video.mp4', () => {
    expect(deriveOutputName('video.')).toBe('video.mp4')
  })

  it('空字串防禦 → output.mp4（避免產出隱藏檔式的 .mp4）', () => {
    expect(deriveOutputName('')).toBe('output.mp4')
  })
})

describe('formatEta（>90s 進位到分鐘；60–90s「不到 2 分鐘」；<60s「不到 1 分鐘」）', () => {
  it('0 → 不到 1 分鐘', () => {
    expect(formatEta(0)).toBe('不到 1 分鐘')
  })

  it('59999（<60s 上邊界）→ 不到 1 分鐘', () => {
    expect(formatEta(59_999)).toBe('不到 1 分鐘')
  })

  it('恰 60s → 不到 2 分鐘', () => {
    expect(formatEta(60_000)).toBe('不到 2 分鐘')
  })

  it('恰 90s（區間上界，含）→ 不到 2 分鐘', () => {
    expect(formatEta(90_000)).toBe('不到 2 分鐘')
  })

  it('90s +1ms → 約 2 分鐘（進位）', () => {
    expect(formatEta(90_001)).toBe('約 2 分鐘')
  })

  it('恰 120s → 約 2 分鐘（整分不再進位）', () => {
    expect(formatEta(120_000)).toBe('約 2 分鐘')
  })

  it('120s +1ms → 約 3 分鐘（進位）', () => {
    expect(formatEta(120_001)).toBe('約 3 分鐘')
  })

  it('60 分鐘量級：3600000 → 約 60 分鐘', () => {
    expect(formatEta(3_600_000)).toBe('約 60 分鐘')
  })

  it('防禦：負值／NaN → 不到 1 分鐘（契約上不應觸及）', () => {
    expect(formatEta(-5)).toBe('不到 1 分鐘')
    expect(formatEta(Number.NaN)).toBe('不到 1 分鐘')
  })
})
