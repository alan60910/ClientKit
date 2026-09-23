/**
 * S4-T2.4（(internal design doc) §決策矩陣 r2.1／§測試策略
 * 「決策矩陣全分支＋args builder 陣列鎖定」）。
 *
 * 三方交叉風格：真實 fixture 走 parseProbeJson → planConversion 全鏈斷言
 * （fixtures 為 SP-2 以真實 @ffmpeg/core 0.12.10 ffprobe 擷取簽入，先簽入
 * 後寫測試——PLAN 時序 gate）；合成 StreamInfo 補白名單邊界。全部 args
 * 斷言以 toEqual 整陣列鎖定。
 *
 * rotation 常設回歸（SP2 §5）：copy 保留 Display Matrix／轉碼 autorotate
 * 燒入，兩路徑呈現一致——args 永不得含 '-noautorotate'（加了會關掉轉碼側
 * 燒入、產出躺平影片）。-v／-nostdin／-y 屬 ffmpeg-client/wrapper 層職責
 * （SP2 §7），一併掃描釘住不得混入 args。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  blindConversionPlan,
  planConversion,
  type ConversionPlan,
  type PlanResult,
} from './convert-plan.js'
import { parseProbeJson, type StreamInfo, type VideoStreamInfo } from './probe.js'

const probeFixturesDir = resolve(import.meta.dirname, 'fixtures', 'probe')

function loadFixture(name: string): string {
  return readFileSync(resolve(probeFixturesDir, name), 'utf8')
}

function expectPlan(result: PlanResult): ConversionPlan {
  if (!result.ok) {
    throw new Error(`expected ok:true, got ok:false reason=${result.reason}`)
  }
  return result.plan
}

/** fixture → parseProbeJson → planConversion 全鏈（探測失敗即測試失敗）。 */
function planFixture(fixtureName: string, inputName: string): ConversionPlan {
  const probe = parseProbeJson(loadFixture(fixtureName))
  if (!probe.ok) {
    throw new Error(`fixture ${fixtureName} 探測失敗：${probe.reason}`)
  }
  return expectPlan(planConversion(probe.info, inputName, 'output.mp4'))
}

function makeInfo(partial: Partial<StreamInfo>): StreamInfo {
  return { video: [], audio: [], subtitleCount: 0, ...partial }
}

function videoStream(overrides: Partial<VideoStreamInfo> = {}): VideoStreamInfo {
  return { index: 0, codecName: 'h264', profile: 'Main', pixFmt: 'yuv420p', ...overrides }
}

describe('planConversion — 簽入 fixtures 全鏈（SP-2 事實基準）', () => {
  it('a-h264-aac-mkv：雙白名單內 → remux，args 全陣列鎖定', () => {
    const plan = planFixture('a-h264-aac-mkv.json', 'a-h264-aac.mkv')
    expect(plan).toEqual({
      mode: 'remux',
      args: [
        '-i', 'a-h264-aac.mkv',
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: [],
    })
  })

  it('b-vp8-vorbis-webm：雙白名單外 → full-transcode', () => {
    const plan = planFixture('b-vp8-vorbis-webm.json', 'b-vp8-vorbis.webm')
    expect(plan).toEqual({
      mode: 'full-transcode',
      args: [
        '-i', 'b-vp8-vorbis.webm',
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: [],
    })
  })

  it('d-h264-10bit-mp4：High 10／yuv420p10le 白名單外、無音軌 → transcode-video', () => {
    const plan = planFixture('d-h264-10bit-mp4.json', 'd-h264-10bit.mp4')
    expect(plan).toEqual({
      mode: 'transcode-video',
      args: [
        '-i', 'd-h264-10bit.mp4',
        '-map', '0:v:0?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: [],
    })
  })

  it('e-video-only-mkv：白名單內無音軌 → remux，省略 -map 0:a:0? 與 audio 段', () => {
    const plan = planFixture('e-video-only-mkv.json', 'e-video-only.mkv')
    expect(plan).toEqual({
      mode: 'remux',
      args: [
        '-i', 'e-video-only.mkv',
        '-map', '0:v:0?',
        '-c:v', 'copy',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: [],
    })
  })

  it('f-audio-only-mp3：mp3 白名單內 → audio-only copy＋notice', () => {
    const plan = planFixture('f-audio-only-mp3.json', 'f-audio-only.mp3')
    expect(plan).toEqual({
      mode: 'audio-only',
      args: [
        '-i', 'f-audio-only.mp3',
        '-map', '0:a:0?',
        '-c:a', 'copy',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: ['audio-only'],
    })
  })

  it('k-opus-audio-webm：opus 白名單外 → audio-only 轉 aac＋notice', () => {
    const plan = planFixture('k-opus-audio-webm.json', 'k-opus-audio.webm')
    expect(plan).toEqual({
      mode: 'audio-only',
      args: [
        '-i', 'k-opus-audio.webm',
        '-map', '0:a:0?',
        '-c:a', 'aac',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: ['audio-only'],
    })
  })

  it('g-multi-audio-mkv：aac×2 → remux＋multi-audio-track notice（僅取第一軌）', () => {
    const plan = planFixture('g-multi-audio-mkv.json', 'g-multi-audio.mkv')
    expect(plan).toEqual({
      mode: 'remux',
      args: [
        '-i', 'g-multi-audio.mkv',
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: ['multi-audio-track'],
    })
  })

  it('h-subtitles-mkv：subrip → subtitles-dropped notice（-sn 恆在）', () => {
    const plan = planFixture('h-subtitles-mkv.json', 'h-subtitles.mkv')
    expect(plan).toEqual({
      mode: 'remux',
      args: [
        '-i', 'h-subtitles.mkv',
        '-map', '0:v:0?',
        '-c:v', 'copy',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: ['subtitles-dropped'],
    })
  })

  it('i-rotation-mp4：rotation -90 白名單內 → copy 保留 Display Matrix，args 無任何 rotation 旗標', () => {
    const plan = planFixture('i-rotation-mp4.json', 'i-rotation.mp4')
    expect(plan).toEqual({
      mode: 'remux',
      args: [
        '-i', 'i-rotation.mp4',
        '-map', '0:v:0?',
        '-c:v', 'copy',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: [],
    })
    expect(plan.args).not.toContain('-noautorotate')
  })

  it('external-bbb-h265-mp4：hevc Main／yuv420p 白名單內 → copy＋hvc1 tag＋hevc-compat notice', () => {
    const plan = planFixture('external-bbb-h265-mp4.json', 'bbb-h265.mp4')
    expect(plan).toEqual({
      mode: 'remux',
      args: [
        '-i', 'bbb-h265.mp4',
        '-map', '0:v:0?',
        '-c:v', 'copy',
        '-tag:v', 'hvc1',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: ['hevc-compat'],
    })
  })

  it('external-bbb-av1-mp4：av1（解碼實質不可用）→ full-transcode＋unsupported-codec notice', () => {
    const plan = planFixture('external-bbb-av1-mp4.json', 'bbb-av1.mp4')
    expect(plan).toEqual({
      mode: 'full-transcode',
      args: [
        '-i', 'bbb-av1.mp4',
        '-map', '0:v:0?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: ['unsupported-codec'],
    })
  })

  it('external-bbb-vp9-webm：vp9 白名單外、無音軌 → transcode-video', () => {
    const plan = planFixture('external-bbb-vp9-webm.json', 'bbb-vp9.webm')
    expect(plan).toEqual({
      mode: 'transcode-video',
      args: [
        '-i', 'bbb-vp9.webm',
        '-map', '0:v:0?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-sn',
        '-movflags', '+faststart',
        'output.mp4',
      ],
      notices: [],
    })
  })

  it('external-flower-webm：vp8＋vorbis 真實檔 → full-transcode（與樣本 b 交叉）', () => {
    const plan = planFixture('external-flower-webm.json', 'flower.webm')
    expect(plan.mode).toBe('full-transcode')
    expect(plan.args).toEqual([
      '-i', 'flower.webm',
      '-map', '0:v:0?',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-sn',
      '-movflags', '+faststart',
      'output.mp4',
    ])
  })

  it('全 fixture 掃描：args 永不含 -noautorotate／-v／-nostdin／-y（層責分工釘住）', () => {
    const okFixtures = [
      'a-h264-aac-mkv.json',
      'b-vp8-vorbis-webm.json',
      'd-h264-10bit-mp4.json',
      'e-video-only-mkv.json',
      'f-audio-only-mp3.json',
      'g-multi-audio-mkv.json',
      'h-subtitles-mkv.json',
      'i-rotation-mp4.json',
      'k-opus-audio-webm.json',
      'external-bbb-vp9-webm.json',
      'external-flower-webm.json',
      'external-bbb-h265-mp4.json',
      'external-bbb-av1-mp4.json',
    ]
    const forbidden = ['-noautorotate', '-v', '-nostdin', '-y']
    for (const fixture of okFixtures) {
      const plan = planFixture(fixture, 'input.bin')
      for (const flag of forbidden) {
        expect(plan.args, `${fixture} 不得含 ${flag}`).not.toContain(flag)
      }
    }
    const blind = blindConversionPlan('input.bin', 'output.mp4')
    for (const flag of forbidden) {
      expect(blind.args, `blind plan 不得含 ${flag}`).not.toContain(flag)
    }
  })
})

describe('planConversion — 合成 StreamInfo 白名單邊界', () => {
  it.each(['Constrained Baseline', 'Baseline', 'Main', 'High'])(
    'h264 %s／yuv420p → copy（remux）',
    (profile) => {
      const plan = expectPlan(
        planConversion(
          makeInfo({ video: [videoStream({ profile })] }),
          'in.mkv',
          'out.mp4',
        ),
      )
      expect(plan.mode).toBe('remux')
      expect(plan.args).toEqual([
        '-i', 'in.mkv',
        '-map', '0:v:0?',
        '-c:v', 'copy',
        '-sn',
        '-movflags', '+faststart',
        'out.mp4',
      ])
    },
  )

  it.each([
    ['hevc Main 10（10-bit profile）', videoStream({ codecName: 'hevc', profile: 'Main 10' })],
    ['hevc Main 但 pixFmt yuv420p10le', videoStream({ codecName: 'hevc', pixFmt: 'yuv420p10le' })],
    ['hevc Main 但 pixFmt undefined', videoStream({ codecName: 'hevc', pixFmt: undefined })],
    ['h264 High 10', videoStream({ profile: 'High 10', pixFmt: 'yuv420p10le' })],
    ['h264 High 4:4:4 Predictive／yuv444p', videoStream({ profile: 'High 4:4:4 Predictive', pixFmt: 'yuv444p' })],
    ['h264 profile undefined', videoStream({ profile: undefined })],
    ['h264 pixFmt undefined', videoStream({ pixFmt: undefined })],
    ['codecName unknown（probe 端缺失佔位）', videoStream({ codecName: 'unknown', profile: undefined, pixFmt: undefined })],
  ])('%s → 白名單落空走轉碼（transcode-video）', (_label, stream) => {
    const plan = expectPlan(
      planConversion(makeInfo({ video: [stream] }), 'in.mkv', 'out.mp4'),
    )
    expect(plan.mode).toBe('transcode-video')
    expect(plan.args).toEqual([
      '-i', 'in.mkv',
      '-map', '0:v:0?',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-sn',
      '-movflags', '+faststart',
      'out.mp4',
    ])
    expect(plan.notices).toEqual([])
  })

  it('hevc 白名單外不發 hevc-compat notice（notice 僅屬 copy 路徑）', () => {
    const plan = expectPlan(
      planConversion(
        makeInfo({ video: [videoStream({ codecName: 'hevc', profile: 'Main 10' })] }),
        'in.mkv',
        'out.mp4',
      ),
    )
    expect(plan.notices).toEqual([])
  })

  it('h264 copy＋opus → transcode-audio', () => {
    const plan = expectPlan(
      planConversion(
        makeInfo({
          video: [videoStream()],
          audio: [{ index: 1, codecName: 'opus' }],
        }),
        'in.mkv',
        'out.mp4',
      ),
    )
    expect(plan).toEqual({
      mode: 'transcode-audio',
      args: [
        '-i', 'in.mkv',
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-sn',
        '-movflags', '+faststart',
        'out.mp4',
      ],
      notices: [],
    })
  })

  it('av1＋aac：mode 強制 full-transcode（事前預期管理），audio 仍照白名單 copy', () => {
    const plan = expectPlan(
      planConversion(
        makeInfo({
          video: [videoStream({ codecName: 'av1', pixFmt: undefined })],
          audio: [{ index: 1, codecName: 'aac' }],
        }),
        'in.mp4',
        'out.mp4',
      ),
    )
    expect(plan).toEqual({
      mode: 'full-transcode',
      args: [
        '-i', 'in.mp4',
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
        '-sn',
        '-movflags', '+faststart',
        'out.mp4',
      ],
      notices: ['unsupported-codec'],
    })
  })

  it('多視訊軌：取第一軌判定＋multi-video-track notice', () => {
    const plan = expectPlan(
      planConversion(
        makeInfo({
          video: [videoStream(), videoStream({ index: 1, codecName: 'vp8' })],
          audio: [{ index: 2, codecName: 'aac' }],
        }),
        'in.mkv',
        'out.mp4',
      ),
    )
    expect(plan.mode).toBe('remux')
    expect(plan.notices).toEqual(['multi-video-track'])
  })

  it('notices 發射順序鎖定：hevc-compat → multi-audio-track → subtitles-dropped', () => {
    const plan = expectPlan(
      planConversion(
        makeInfo({
          video: [videoStream({ codecName: 'hevc' })],
          audio: [
            { index: 1, codecName: 'vorbis' },
            { index: 2, codecName: 'aac' },
          ],
          subtitleCount: 2,
        }),
        'in.mkv',
        'out.mp4',
      ),
    )
    expect(plan.mode).toBe('transcode-audio')
    expect(plan.notices).toEqual(['hevc-compat', 'multi-audio-track', 'subtitles-dropped'])
  })

  it('video＋audio 皆空（如純字幕 MKV）→ no-media-streams', () => {
    expect(planConversion(makeInfo({ subtitleCount: 1 }), 'in.mkv', 'out.mp4')).toEqual({
      ok: false,
      reason: 'no-media-streams',
    })
    expect(planConversion(makeInfo({}), 'in.mkv', 'out.mp4')).toEqual({
      ok: false,
      reason: 'no-media-streams',
    })
  })
})

describe('blindConversionPlan', () => {
  it('args 全陣列鎖定：組成未知 → 雙 `?` map 全留＋影音一律轉碼、無 notices', () => {
    expect(blindConversionPlan('mystery.bin', 'mystery.mp4')).toEqual({
      mode: 'blind-transcode',
      args: [
        '-i', 'mystery.bin',
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-sn',
        '-movflags', '+faststart',
        'mystery.mp4',
      ],
      notices: [],
    })
  })
})
