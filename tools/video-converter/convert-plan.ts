/**
 * 決策矩陣純函式：`StreamInfo` → `ConversionPlan`（(internal design doc)
 * PLAN.md §決策矩陣 r2.1 定稿版；事實依據 SP2-INVENTORY.md）。
 *
 * 白名單哲學：copy 只留給「瀏覽器一定播得出」的組合，超出一律轉碼——防
 * 「mux 成功但播不出」的靜默破檔（ret==0 安全網抓不到；SP2 §6 vorbis→mp4
 * copy 竟成功即實證，audio 白名單因此嚴格 aac/mp3 不得放寬）。
 * encoder 後備固定 video=libx264、audio=native aac（SP2 §7 實證：
 * libvpx-vp9 編碼 wasm crash、libx265 編碼 hang——兩者不得作任何路徑）。
 * av1 特例：本 core 解碼實質不可用（SP2 §0：decoder hwaccel-only、真跑
 * ret=1 乾淨失敗）→ 事前發 'unsupported-codec' notice，mode 定為
 * 'full-transcode'（預期管理：不是輕量轉碼；執行期會以 ret≠0 收斂錯誤態，
 * 不會 crash UI）——args 仍照白名單各自決定（av1＋aac 時 audio 照 copy）。
 *
 * args 契約（與 ffmpeg-client 層的分工，SP2 §7）：
 * - wrapper exec 自動前置 -nostdin -y —— args 不含。
 * - loglevel 殘留是 process-global，由 ffmpeg-client 每呼叫顯式帶 -v ——
 *   args 不含 -v。
 * - rotation：不加任何 rotation 旗標。SP2 §5 實證 copy 保留 Display Matrix
 *   、轉碼 autorotate 燒入，兩路徑對播放器呈現一致；尤其**永不加
 *   -noautorotate**（加了會關掉轉碼側燒入、產出躺平影片），測試釘住。
 * - -map 省略決策（兩案擇一）：probe 成功時軌道組成已知——無音軌省略
 *   `-map 0:a:0?` 與 audio codec 段、無影軌（audio-only）省略 `-map 0:v:0?`
 *   與 video codec 段。省略讓 args 誠實反映計畫、測試斷言更精確；保留於
 *   present 軌 map 上的 `?` 則防 probe 與 demux 極端不一致時 ffmpeg 直接
 *   報錯（belt-and-suspenders）。blindConversionPlan 因組成未知，兩個
 *   `?` map 全留。
 *
 * notices 發射順序固定（測試以陣列鎖定）：codec 判定衍生
 * （'unsupported-codec'／'hevc-compat'）→ 'multi-video-track' →
 * 'multi-audio-track' → 'subtitles-dropped' → 'audio-only'。
 *
 * 純函式、零 DOM／零 @ffmpeg import：node 直接可測（測試以 SP-2 簽入之
 * fixtures/probe/*.json 為事實基準）。
 */

import type { StreamInfo, VideoStreamInfo } from './probe.js'

export type NoticeKey =
  | 'subtitles-dropped'
  | 'hevc-compat'
  | 'multi-video-track'
  | 'multi-audio-track'
  | 'audio-only'
  | 'unsupported-codec'

export type ConversionMode =
  | 'remux'
  | 'transcode-video'
  | 'transcode-audio'
  | 'full-transcode'
  | 'audio-only'
  | 'blind-transcode'

export interface ConversionPlan {
  mode: ConversionMode
  args: string[]
  notices: NoticeKey[]
}

export type PlanResult =
  | { ok: true; plan: ConversionPlan }
  | { ok: false; reason: 'no-media-streams' }

/** h264 copy 白名單 profile（8-bit 4:2:0 前提下瀏覽器面安全集合）。 */
const H264_COPY_PROFILES: ReadonlySet<string> = new Set([
  'Constrained Baseline',
  'Baseline',
  'Main',
  'High',
])

const VIDEO_TRANSCODE_ARGS = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'] as const
const AUDIO_TRANSCODE_ARGS = ['-c:a', 'aac'] as const

interface VideoDecision {
  copy: boolean
  args: string[]
  notices: NoticeKey[]
}

/**
 * video copy 白名單。欄位 undefined（如 av1 缺 pix_fmt、probe 端 codec_name
 * 缺失佔位 'unknown'）自然落空 → 轉碼，毋需另判。
 */
function decideVideo(stream: VideoStreamInfo): VideoDecision {
  if (
    stream.codecName === 'h264' &&
    stream.pixFmt === 'yuv420p' &&
    stream.profile !== undefined &&
    H264_COPY_PROFILES.has(stream.profile)
  ) {
    return { copy: true, args: ['-c:v', 'copy'], notices: [] }
  }
  if (stream.codecName === 'hevc' && stream.pixFmt === 'yuv420p' && stream.profile === 'Main') {
    return {
      copy: true,
      args: ['-c:v', 'copy', '-tag:v', 'hvc1'],
      notices: ['hevc-compat'],
    }
  }
  return {
    copy: false,
    args: [...VIDEO_TRANSCODE_ARGS],
    notices: stream.codecName === 'av1' ? ['unsupported-codec'] : [],
  }
}

function decideAudio(codecName: string): { copy: boolean; args: string[] } {
  if (codecName === 'aac' || codecName === 'mp3') {
    return { copy: true, args: ['-c:a', 'copy'] }
  }
  return { copy: false, args: [...AUDIO_TRANSCODE_ARGS] }
}

export function planConversion(
  info: StreamInfo,
  inputName: string,
  outputName: string,
): PlanResult {
  const hasVideo = info.video.length > 0
  const hasAudio = info.audio.length > 0
  if (!hasVideo && !hasAudio) {
    return { ok: false, reason: 'no-media-streams' }
  }

  const args: string[] = ['-i', inputName]
  if (hasVideo) args.push('-map', '0:v:0?')
  if (hasAudio) args.push('-map', '0:a:0?')

  const notices: NoticeKey[] = []
  let videoCopy = true
  if (hasVideo) {
    const decision = decideVideo(info.video[0])
    videoCopy = decision.copy
    args.push(...decision.args)
    notices.push(...decision.notices)
  }
  let audioCopy = true
  if (hasAudio) {
    const decision = decideAudio(info.audio[0].codecName)
    audioCopy = decision.copy
    args.push(...decision.args)
  }
  args.push('-sn', '-movflags', '+faststart', outputName)

  if (info.video.length > 1) notices.push('multi-video-track')
  if (info.audio.length > 1) notices.push('multi-audio-track')
  if (info.subtitleCount > 0) notices.push('subtitles-dropped')

  let mode: ConversionMode
  if (!hasVideo) {
    mode = 'audio-only'
    notices.push('audio-only')
  } else if (info.video[0].codecName === 'av1') {
    mode = 'full-transcode'
  } else if (videoCopy && audioCopy) {
    mode = 'remux'
  } else if (!videoCopy && audioCopy) {
    mode = 'transcode-video'
  } else if (videoCopy && !audioCopy) {
    mode = 'transcode-audio'
  } else {
    mode = 'full-transcode'
  }

  return { ok: true, plan: { mode, args, notices } }
}

/**
 * probe 失敗時的降級計畫（PLAN §探測與降級鏈）：組成未知 → 兩個 `?` map
 * 全留、影音一律轉碼。無 notices——ready 播報由 blind-transcode 變體文案
 * 承擔（「無法預判格式，將完整轉碼（較慢）」）。
 */
export function blindConversionPlan(inputName: string, outputName: string): ConversionPlan {
  return {
    mode: 'blind-transcode',
    args: [
      '-i',
      inputName,
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      ...VIDEO_TRANSCODE_ARGS,
      ...AUDIO_TRANSCODE_ARGS,
      '-sn',
      '-movflags',
      '+faststart',
      outputName,
    ],
    notices: [],
  }
}
