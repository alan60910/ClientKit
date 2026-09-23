/**
 * S4-T2.2（(internal design doc) §測試策略「probe 解析（含畸形
 * 輸入）」）。
 *
 * 事實基準＝SP-2 簽入的 14 顆 fixtures（./fixtures/probe/*.json），由真實
 * @ffmpeg/core 0.12.10 ffprobe 擷取（SP2-INVENTORY.md §3/§4）——fixtures
 * 先簽入、本測試後寫（PLAN 時序 gate）。畸形輸入手工案對齊 SP2 §2 的失敗
 * 形狀契約（失敗時 ffprobe 仍寫出空物件 `{}`）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseProbeJson, type ProbeResult, type StreamInfo } from './probe.js'

const probeFixturesDir = resolve(import.meta.dirname, 'fixtures', 'probe')

function loadFixture(name: string): string {
  return readFileSync(resolve(probeFixturesDir, name), 'utf8')
}

function expectOk(result: ProbeResult): StreamInfo {
  if (!result.ok) {
    throw new Error(`expected ok:true, got ok:false reason=${result.reason}`)
  }
  return result.info
}

describe('parseProbeJson — 簽入 fixtures（SP-2 事實基準）', () => {
  it('a-h264-aac-mkv：主場景，全欄位精確斷言', () => {
    const result = parseProbeJson(loadFixture('a-h264-aac-mkv.json'))
    expect(result).toEqual({
      ok: true,
      info: {
        video: [
          {
            index: 0,
            codecName: 'h264',
            profile: 'Constrained Baseline',
            pixFmt: 'yuv420p',
            bitsPerRawSample: 8,
            width: 64,
            height: 64,
            rotation: undefined,
          },
        ],
        audio: [{ index: 1, codecName: 'aac' }],
        subtitleCount: 0,
        durationSec: 0.623,
        formatName: 'matroska,webm',
      },
    })
  })

  it('b-vp8-vorbis-webm：雙白名單外組合', () => {
    const info = expectOk(parseProbeJson(loadFixture('b-vp8-vorbis-webm.json')))
    expect(info.video).toHaveLength(1)
    expect(info.video[0]).toMatchObject({
      index: 0,
      codecName: 'vp8',
      profile: '0',
      pixFmt: 'yuv420p',
      width: 64,
      height: 64,
    })
    expect(info.video[0].bitsPerRawSample).toBeUndefined()
    expect(info.audio).toEqual([{ index: 1, codecName: 'vorbis' }])
    expect(info.subtitleCount).toBe(0)
    expect(info.durationSec).toBe(0.603)
    expect(info.formatName).toBe('matroska,webm')
  })

  it('d-h264-10bit-mp4：High 10／yuv420p10le／bits_per_raw_sample 字串 "10" → number 10', () => {
    const info = expectOk(parseProbeJson(loadFixture('d-h264-10bit-mp4.json')))
    expect(info.video).toHaveLength(1)
    expect(info.video[0].profile).toBe('High 10')
    expect(info.video[0].pixFmt).toBe('yuv420p10le')
    expect(info.video[0].bitsPerRawSample).toBe(10)
    expect(info.audio).toEqual([])
    expect(info.formatName).toBe('mov,mp4,m4a,3gp,3g2,mj2')
  })

  it('e-video-only-mkv：無音軌', () => {
    const info = expectOk(parseProbeJson(loadFixture('e-video-only-mkv.json')))
    expect(info.video).toHaveLength(1)
    expect(info.video[0].codecName).toBe('h264')
    expect(info.audio).toEqual([])
    expect(info.subtitleCount).toBe(0)
    expect(info.durationSec).toBe(0.6)
  })

  it('f-audio-only-mp3：無影軌', () => {
    const info = expectOk(parseProbeJson(loadFixture('f-audio-only-mp3.json')))
    expect(info.video).toEqual([])
    expect(info.audio).toEqual([{ index: 0, codecName: 'mp3' }])
    expect(info.durationSec).toBe(0.548571)
    expect(info.formatName).toBe('mp3')
  })

  it('g-multi-audio-mkv：雙音軌，index 保留原始 stream index', () => {
    const info = expectOk(parseProbeJson(loadFixture('g-multi-audio-mkv.json')))
    expect(info.video).toHaveLength(1)
    expect(info.audio).toHaveLength(2)
    expect(info.audio).toEqual([
      { index: 1, codecName: 'aac' },
      { index: 2, codecName: 'aac' },
    ])
  })

  it('h-subtitles-mkv：subrip 計入 subtitleCount', () => {
    const info = expectOk(parseProbeJson(loadFixture('h-subtitles-mkv.json')))
    expect(info.video).toHaveLength(1)
    expect(info.audio).toEqual([])
    expect(info.subtitleCount).toBe(1)
  })

  it('i-rotation-mp4：side_data Display Matrix 的 rotation -90', () => {
    const info = expectOk(parseProbeJson(loadFixture('i-rotation-mp4.json')))
    expect(info.video).toHaveLength(1)
    expect(info.video[0].rotation).toBe(-90)
    expect(info.video[0].width).toBe(64)
    expect(info.video[0].height).toBe(32)
  })

  it('j-corrupted-mkv：ffprobe 失敗仍寫出的空物件 → ok:false no-streams', () => {
    expect(parseProbeJson(loadFixture('j-corrupted-mkv.json'))).toEqual({
      ok: false,
      reason: 'no-streams',
    })
  })

  it('k-opus-audio-webm：opus audio-only', () => {
    const info = expectOk(parseProbeJson(loadFixture('k-opus-audio-webm.json')))
    expect(info.video).toEqual([])
    expect(info.audio).toEqual([{ index: 0, codecName: 'opus' }])
    expect(info.durationSec).toBe(0.508)
  })

  it('external-bbb-vp9-webm：vp9 Profile 0、無音軌、真實檔', () => {
    const info = expectOk(parseProbeJson(loadFixture('external-bbb-vp9-webm.json')))
    expect(info.video).toHaveLength(1)
    expect(info.video[0]).toMatchObject({
      codecName: 'vp9',
      profile: 'Profile 0',
      pixFmt: 'yuv420p',
      width: 640,
      height: 360,
    })
    expect(info.audio).toEqual([])
    expect(info.durationSec).toBe(10)
  })

  it('external-flower-webm：vp8＋vorbis 真實檔（與樣本 b 交叉）', () => {
    const info = expectOk(parseProbeJson(loadFixture('external-flower-webm.json')))
    expect(info.video).toHaveLength(1)
    expect(info.video[0]).toMatchObject({ codecName: 'vp8', width: 960, height: 540 })
    expect(info.audio).toEqual([{ index: 1, codecName: 'vorbis' }])
    expect(info.durationSec).toBe(5.059)
  })

  it('external-bbb-h265-mp4：hevc Main／yuv420p（白名單 hevc-copy 分支證據）', () => {
    const info = expectOk(parseProbeJson(loadFixture('external-bbb-h265-mp4.json')))
    expect(info.video).toHaveLength(1)
    expect(info.video[0]).toMatchObject({
      codecName: 'hevc',
      profile: 'Main',
      pixFmt: 'yuv420p',
    })
    expect(info.audio).toEqual([])
  })

  it('external-bbb-av1-mp4：video stream 整個缺 pix_fmt 欄位 → pixFmt undefined', () => {
    const info = expectOk(parseProbeJson(loadFixture('external-bbb-av1-mp4.json')))
    expect(info.video).toHaveLength(1)
    expect(info.video[0].codecName).toBe('av1')
    expect(info.video[0].profile).toBe('Main')
    expect(info.video[0].pixFmt).toBeUndefined()
    expect(info.video[0].bitsPerRawSample).toBeUndefined()
    expect(info.video[0].width).toBe(640)
    expect(info.durationSec).toBe(10)
  })
})

describe('parseProbeJson — 畸形輸入（手工案）', () => {
  it.each([
    ['空字串', ''],
    ['非 JSON 文字', 'not json'],
    ['JSON 字串（非物件）', '"just a string"'],
    ['JSON null', 'null'],
    ['JSON 布林', 'true'],
    ['JSON 數字', '42'],
    ['JSON 陣列（頂層非物件）', '[{"streams":[]}]'],
  ])('%s → invalid-json', (_label, jsonText) => {
    expect(parseProbeJson(jsonText)).toEqual({ ok: false, reason: 'invalid-json' })
  })

  it.each([
    ['空物件（j fixture 形狀）', '{}'],
    ['streams 為空陣列', '{"streams":[]}'],
    ['streams 非陣列（字串）', '{"streams":"nope"}'],
    ['streams 非陣列（物件）', '{"streams":{}}'],
    ['streams 內全非物件條目', '{"streams":[null,"x",42]}'],
  ])('%s → no-streams', (_label, jsonText) => {
    expect(parseProbeJson(jsonText)).toEqual({ ok: false, reason: 'no-streams' })
  })

  it('stream 缺 codec_type：整條忽略、不炸、不計入 subtitleCount', () => {
    const info = expectOk(
      parseProbeJson('{"streams":[{"index":0,"codec_name":"h264"}]}'),
    )
    expect(info.video).toEqual([])
    expect(info.audio).toEqual([])
    expect(info.subtitleCount).toBe(0)
  })

  it('codec_type 未知（data/attachment）：忽略且不誤計入 subtitleCount', () => {
    const info = expectOk(
      parseProbeJson(
        JSON.stringify({
          streams: [
            { index: 0, codec_type: 'video', codec_name: 'h264' },
            { index: 1, codec_type: 'data' },
            { index: 2, codec_type: 'attachment', codec_name: 'ttf' },
          ],
        }),
      ),
    )
    expect(info.video).toHaveLength(1)
    expect(info.audio).toEqual([])
    expect(info.subtitleCount).toBe(0)
  })

  it('video stream 缺 codec_name → codecName "unknown"（stream 不丟棄，白名單自然落空）', () => {
    const info = expectOk(parseProbeJson('{"streams":[{"index":0,"codec_type":"video"}]}'))
    expect(info.video).toEqual([
      {
        index: 0,
        codecName: 'unknown',
        profile: undefined,
        pixFmt: undefined,
        bitsPerRawSample: undefined,
        width: undefined,
        height: undefined,
        rotation: undefined,
      },
    ])
  })

  it('codec_name 非字串（數字）→ codecName "unknown"', () => {
    const info = expectOk(
      parseProbeJson('{"streams":[{"index":0,"codec_type":"audio","codec_name":123}]}'),
    )
    expect(info.audio).toEqual([{ index: 0, codecName: 'unknown' }])
  })

  it('bits_per_raw_sample 非數字字串（"N/A"）→ undefined', () => {
    const info = expectOk(
      parseProbeJson(
        '{"streams":[{"index":0,"codec_type":"video","codec_name":"h264","bits_per_raw_sample":"N/A"}]}',
      ),
    )
    expect(info.video[0].bitsPerRawSample).toBeUndefined()
  })

  it('bits_per_raw_sample 空字串 → undefined（Number("") === 0 陷阱）', () => {
    const info = expectOk(
      parseProbeJson(
        '{"streams":[{"index":0,"codec_type":"video","codec_name":"h264","bits_per_raw_sample":""}]}',
      ),
    )
    expect(info.video[0].bitsPerRawSample).toBeUndefined()
  })

  it('index 缺失或非數字 → 以 streams 陣列位置遞補', () => {
    const info = expectOk(
      parseProbeJson(
        JSON.stringify({
          streams: [
            { codec_type: 'video', codec_name: 'h264' },
            { index: 'x', codec_type: 'audio', codec_name: 'aac' },
          ],
        }),
      ),
    )
    expect(info.video[0].index).toBe(0)
    expect(info.audio[0].index).toBe(1)
  })

  it('format.duration 不可解析（"N/A"）→ 退 stream 層 duration', () => {
    const info = expectOk(
      parseProbeJson(
        JSON.stringify({
          streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', duration: '1.500000' }],
          format: { duration: 'N/A' },
        }),
      ),
    )
    expect(info.durationSec).toBe(1.5)
  })

  it('format 整段缺失 → 退 stream 層 duration；formatName undefined', () => {
    const info = expectOk(
      parseProbeJson(
        '{"streams":[{"index":0,"codec_type":"video","codec_name":"h264","duration":"2.5"}]}',
      ),
    )
    expect(info.durationSec).toBe(2.5)
    expect(info.formatName).toBeUndefined()
  })

  it('duration 兩層皆不可解析 → durationSec undefined', () => {
    const info = expectOk(
      parseProbeJson(
        JSON.stringify({
          streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', duration: 'N/A' }],
          format: {},
        }),
      ),
    )
    expect(info.durationSec).toBeUndefined()
  })

  it('format 非物件（數字）→ 不炸；formatName/durationSec undefined', () => {
    const info = expectOk(
      parseProbeJson('{"streams":[{"index":0,"codec_type":"video","codec_name":"h264"}],"format":5}'),
    )
    expect(info.formatName).toBeUndefined()
    expect(info.durationSec).toBeUndefined()
  })

  it('side_data_list 存在但無 rotation 欄位 → rotation undefined', () => {
    const info = expectOk(
      parseProbeJson(
        JSON.stringify({
          streams: [
            {
              index: 0,
              codec_type: 'video',
              codec_name: 'h264',
              side_data_list: [{ side_data_type: 'Something Else' }],
            },
          ],
        }),
      ),
    )
    expect(info.video[0].rotation).toBeUndefined()
  })

  it('side_data_list 多條目：取第一個帶 rotation 者', () => {
    const info = expectOk(
      parseProbeJson(
        JSON.stringify({
          streams: [
            {
              index: 0,
              codec_type: 'video',
              codec_name: 'h264',
              side_data_list: [
                { side_data_type: 'Other' },
                { side_data_type: 'Display Matrix', rotation: -90 },
                { side_data_type: 'Display Matrix', rotation: 180 },
              ],
            },
          ],
        }),
      ),
    )
    expect(info.video[0].rotation).toBe(-90)
  })

  it('side_data_list 非陣列 → 不炸、rotation undefined', () => {
    const info = expectOk(
      parseProbeJson(
        '{"streams":[{"index":0,"codec_type":"video","codec_name":"h264","side_data_list":"bogus"}]}',
      ),
    )
    expect(info.video[0].rotation).toBeUndefined()
  })

  it('數值欄位以字串承載（ffprobe 慣例）→ 防禦轉換為 number', () => {
    const info = expectOk(
      parseProbeJson(
        JSON.stringify({
          streams: [
            {
              index: 0,
              codec_type: 'video',
              codec_name: 'h264',
              width: '640',
              height: '360',
              side_data_list: [{ rotation: '-90' }],
            },
          ],
        }),
      ),
    )
    expect(info.video[0].width).toBe(640)
    expect(info.video[0].height).toBe(360)
    expect(info.video[0].rotation).toBe(-90)
  })

  it('streams 混雜非物件條目：物件條目照收、其餘忽略', () => {
    const info = expectOk(
      parseProbeJson(
        JSON.stringify({
          streams: [null, { index: 0, codec_type: 'audio', codec_name: 'aac' }, 'junk'],
        }),
      ),
    )
    expect(info.audio).toEqual([{ index: 0, codecName: 'aac' }])
    expect(info.video).toEqual([])
  })
})
