/**
 * ffprobe JSON 輸出 → `StreamInfo` 純解析（(internal design doc)
 * §型別契約；SP2-INVENTORY.md §2 成敗判定契約）。
 *
 * ffprobe wrapper（@ffmpeg/core 0.12.10）的 ret 恆為 -1、不可作成敗訊號，
 * 且探測失敗時仍會寫出空物件 `{}`（fixtures/probe/j-corrupted-mkv.json 即此
 * 形狀）——成敗只能由解析結果判定：streams 非空＝成功。本模組因此不 throw，
 * 把「非 JSON／非物件／streams 缺失或空」收斂為可辨識的 ProbeResult 失敗值，
 * 由 UI 層決定降級（blind-transcode）。
 *
 * 防禦原則（下游決策矩陣「欄位缺失或未知 → 轉碼」的配套）：
 * - 個別欄位缺失或型別不符 → 該欄位 undefined，不丟棄整條 stream；
 *   codec_name 缺失以 'unknown' 佔位——保留 stream 存在性，讓白名單判定
 *   自然落空走轉碼，而不是誤判成「無此軌」。
 * - codec_type 未知或缺失的 stream 整條忽略（不入任何桶、不炸）。
 * - ffprobe 慣例把數值放在字串裡（bits_per_raw_sample、format.duration）
 *   → 一律防禦轉換，非有限數值／空字串 → undefined。
 * - rotation 承載於 stream 的 side_data_list 中帶 `rotation` 欄位的條目
 *   （Display Matrix；fixtures/probe/i-rotation-mp4.json 值 -90），取第一個
 *   有值者。
 * - external-bbb-av1 實證 video stream 可整個缺 pix_fmt 欄位。
 * - durationSec：format.duration 優先；缺失或不可解析時退第一個帶可解析
 *   duration 的 stream（MKV 常只有 format 層，MP4 個別 stream 也有）。
 *
 * 純函式、零 DOM／零 @ffmpeg import：node 直接可測（測試以 SP-2 簽入之
 * fixtures/probe/*.json 為事實基準）。
 */

export interface VideoStreamInfo {
  index: number
  codecName: string
  profile?: string
  pixFmt?: string
  bitsPerRawSample?: number
  width?: number
  height?: number
  /** side_data Display Matrix 的 rotation（度，可為負）。 */
  rotation?: number
}

export interface AudioStreamInfo {
  index: number
  codecName: string
}

export interface StreamInfo {
  video: VideoStreamInfo[]
  audio: AudioStreamInfo[]
  subtitleCount: number
  durationSec?: number
  formatName?: string
}

export type ProbeResult =
  | { ok: true; info: StreamInfo }
  | { ok: false; reason: 'invalid-json' | 'no-streams' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * ffprobe 數值欄位防禦轉換：number 直收、字串走 Number()。空白字串要擋
 * （Number('') === 0 的陷阱），NaN／Infinity → undefined。
 */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function extractRotation(stream: Record<string, unknown>): number | undefined {
  const sideDataList = stream['side_data_list']
  if (!Array.isArray(sideDataList)) return undefined
  for (const entry of sideDataList) {
    if (!isRecord(entry)) continue
    const rotation = toFiniteNumber(entry['rotation'])
    if (rotation !== undefined) return rotation
  }
  return undefined
}

export function parseProbeJson(jsonText: string): ProbeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'invalid-json' }
  }

  const rawStreams = parsed['streams']
  const streams = Array.isArray(rawStreams) ? rawStreams.filter(isRecord) : []
  if (streams.length === 0) {
    return { ok: false, reason: 'no-streams' }
  }

  const video: VideoStreamInfo[] = []
  const audio: AudioStreamInfo[] = []
  let subtitleCount = 0
  let streamDurationSec: number | undefined

  streams.forEach((stream, position) => {
    if (streamDurationSec === undefined) {
      streamDurationSec = toFiniteNumber(stream['duration'])
    }
    const index = toFiniteNumber(stream['index']) ?? position
    const codecName = asString(stream['codec_name']) ?? 'unknown'

    switch (stream['codec_type']) {
      case 'video':
        video.push({
          index,
          codecName,
          profile: asString(stream['profile']),
          pixFmt: asString(stream['pix_fmt']),
          bitsPerRawSample: toFiniteNumber(stream['bits_per_raw_sample']),
          width: toFiniteNumber(stream['width']),
          height: toFiniteNumber(stream['height']),
          rotation: extractRotation(stream),
        })
        break
      case 'audio':
        audio.push({ index, codecName })
        break
      case 'subtitle':
        subtitleCount += 1
        break
      default:
        break
    }
  })

  const format = isRecord(parsed['format']) ? parsed['format'] : undefined
  const durationSec = toFiniteNumber(format?.['duration']) ?? streamDurationSec
  const formatName = format === undefined ? undefined : asString(format['format_name'])

  return {
    ok: true,
    info: { video, audio, subtitleCount, durationSec, formatName },
  }
}
