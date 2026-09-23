/**
 * S1 spike (T1.3, (internal design doc) 前置 spikes): gifenc node PoC,
 * plus (T2.2) the full byte-level test suite for `gif-encode.ts`'s
 * `encodeGif` (formerly `tools/apng-to-gif/convert.ts`'s `convertToGif`,
 * relocated+renamed by (internal design doc) §3 so gif-editor can share
 * the same pipeline).
 *
 * The first `describe` block below predates `convert.ts`/`gif-encode.ts` and
 * exercises `gifenc` directly with hand-built RGBA frames and byte-level
 * readback (via ./gif-reader.js) to lock in facts this module depends on:
 * GIF89a header/trailer/frame count, the delay ms->cs contract, the
 * finite-loop mapping, and transparent flag/index round-tripping. It's kept
 * as a library-contract regression guard independent of our own code.
 *
 * The later blocks test `gif-encode.ts` itself (see PLAN.md「Verification」).
 */
import { describe, expect, it, vi } from 'vitest'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { parseGif } from './gif-reader.js'
import { makeRgbaFrame, makeSolidFrame, makeSolidRgba } from './test-helpers.js'
import {
  DEFAULT_ALPHA_THRESHOLD,
  DEFAULT_MATTE_COLOR,
  DEFAULT_MAX_COLORS,
  MIN_DELAY_MS,
  blendWithMatte,
  encodeGif,
  normalizeGifEncodeOptions,
  normalizeDelayMs,
  numPlaysToRepeat,
  quantizeFrameToIndexedBitmap,
  type GifEncodeInput,
} from './gif-encode.js'

describe('gifenc PoC: byte-level readback (S1)', () => {
  const width = 4
  const height = 4

  it('produces a well-formed multi-frame GIF89a stream', () => {
    const frame1 = makeSolidRgba(width, height, 255, 0, 0)
    const frame2 = makeSolidRgba(width, height, 0, 0, 255)

    const palette1 = quantize(frame1, 256)
    const index1 = applyPalette(frame1, palette1)
    const palette2 = quantize(frame2, 256)
    const index2 = applyPalette(frame2, palette2)

    const gif = GIFEncoder()
    gif.writeFrame(index1, width, height, { palette: palette1, delay: 120, repeat: 0 })
    gif.writeFrame(index2, width, height, { palette: palette2, delay: 120 })
    gif.finish()

    const parsed = parseGif(gif.bytes())

    expect(parsed.header).toBe('GIF89a')
    expect(parsed.width).toBe(width)
    expect(parsed.height).toBe(height)
    expect(parsed.frameCount).toBe(2)
    expect(parsed.hasValidTrailer).toBe(true)
  })

  it('writes delay in centiseconds when given milliseconds (delay/10 contract)', () => {
    const frame = makeSolidRgba(width, height, 10, 20, 30)
    const palette = quantize(frame, 256)
    const index = applyPalette(frame, palette)

    const gif = GIFEncoder()
    // 120ms in -> gifenc does Math.round(120/10) -> 12 centiseconds on the wire.
    gif.writeFrame(index, width, height, { palette, delay: 120 })
    gif.finish()

    const parsed = parseGif(gif.bytes())
    expect(parsed.graphicControlExtensions).toHaveLength(1)
    expect(parsed.graphicControlExtensions[0].delayCentiseconds).toBe(12)
  })

  it('rounds non-exact millisecond delays the same way gifenc does internally (Math.round(delay/10))', () => {
    const frame = makeSolidRgba(width, height, 10, 20, 30)
    const palette = quantize(frame, 256)
    const index = applyPalette(frame, palette)

    const gif = GIFEncoder()
    // 25ms -> Math.round(25/10) = Math.round(2.5) = 3 (round-half-up, per JS Math.round).
    gif.writeFrame(index, width, height, { palette, delay: 25 })
    gif.finish()

    const parsed = parseGif(gif.bytes())
    expect(parsed.graphicControlExtensions[0].delayCentiseconds).toBe(3)
  })

  describe('finite-loop mapping decision (numPlays -> gifenc repeat)', () => {
    // Decision + reasoning documented in full at ./gif-reader.ts (ParsedGif.loopCount).
    // Summary: numPlays 0 -> repeat 0; numPlays 1 -> repeat -1 (omit ext);
    // numPlays n>1 -> repeat n-1 (NETSCAPE2.0's documented "+1" convention).

    it('numPlays 0 (infinite) -> repeat 0 -> NETSCAPE loop count 0', () => {
      const frame = makeSolidRgba(width, height, 5, 5, 5)
      const palette = quantize(frame, 256)
      const index = applyPalette(frame, palette)

      const gif = GIFEncoder()
      gif.writeFrame(index, width, height, { palette, delay: 100, repeat: 0 })
      gif.finish()

      expect(parseGif(gif.bytes()).loopCount).toBe(0)
    })

    it('numPlays 1 (play once, no looping) -> repeat -1 -> no NETSCAPE extension at all', () => {
      const frame = makeSolidRgba(width, height, 5, 5, 5)
      const palette = quantize(frame, 256)
      const index = applyPalette(frame, palette)

      const gif = GIFEncoder()
      gif.writeFrame(index, width, height, { palette, delay: 100, repeat: -1 })
      gif.finish()

      // No extension written -> viewers fall back to their default of a
      // single playthrough, which is exactly numPlays=1's semantics. Had we
      // instead written loop count 0, viewers would loop forever (wrong).
      expect(parseGif(gif.bytes()).loopCount).toBeUndefined()
    })

    it('numPlays 3 (play exactly 3 times total) -> repeat 2 -> NETSCAPE loop count 2', () => {
      const frame = makeSolidRgba(width, height, 5, 5, 5)
      const palette = quantize(frame, 256)
      const index = applyPalette(frame, palette)

      const gif = GIFEncoder()
      // numPlays - 1 = 2: mainstream viewers read a loop count of n (n>=1) as
      // "play once, then loop n more times" = n+1 total plays, so 2 -> 3 total.
      gif.writeFrame(index, width, height, { palette, delay: 100, repeat: 2 })
      gif.finish()

      expect(parseGif(gif.bytes()).loopCount).toBe(2)
    })
  })

  it('round-trips the transparent flag and transparentIndex through the GCE', () => {
    const frame = makeSolidRgba(width, height, 0, 255, 0)
    const palette = quantize(frame, 256)
    const index = applyPalette(frame, palette)

    const gif = GIFEncoder()
    gif.writeFrame(index, width, height, {
      palette,
      delay: 100,
      transparent: true,
      transparentIndex: 0,
    })
    gif.finish()

    const gce = parseGif(gif.bytes()).graphicControlExtensions[0]
    expect(gce.transparentColorFlag).toBe(true)
    expect(gce.transparentColorIndex).toBe(0)
  })

  it('reads back transparentColorFlag=false when transparency is not requested', () => {
    const frame = makeSolidRgba(width, height, 0, 255, 0)
    const palette = quantize(frame, 256)
    const index = applyPalette(frame, palette)

    const gif = GIFEncoder()
    gif.writeFrame(index, width, height, { palette, delay: 100 })
    gif.finish()

    const gce = parseGif(gif.bytes()).graphicControlExtensions[0]
    expect(gce.transparentColorFlag).toBe(false)
  })
})

describe('normalizeGifEncodeOptions (T2.2)', () => {
  it('falls back to defaults for undefined options', () => {
    expect(normalizeGifEncodeOptions(undefined)).toEqual({
      alphaThreshold: DEFAULT_ALPHA_THRESHOLD,
      matteColor: DEFAULT_MATTE_COLOR,
      maxColors: DEFAULT_MAX_COLORS,
    })
  })

  it('clamps out-of-range scalar options into their valid ranges', () => {
    expect(normalizeGifEncodeOptions({ alphaThreshold: -50 }).alphaThreshold).toBe(0)
    expect(normalizeGifEncodeOptions({ alphaThreshold: 999 }).alphaThreshold).toBe(255)
    expect(normalizeGifEncodeOptions({ maxColors: 0 }).maxColors).toBe(2)
    expect(normalizeGifEncodeOptions({ maxColors: 5000 }).maxColors).toBe(256)
  })

  it('rounds fractional scalar options', () => {
    expect(normalizeGifEncodeOptions({ alphaThreshold: 127.6 }).alphaThreshold).toBe(128)
  })

  it('falls back to the default matte color when any channel is invalid (NaN)', () => {
    expect(normalizeGifEncodeOptions({ matteColor: [Number.NaN, 10, 10] }).matteColor).toEqual(DEFAULT_MATTE_COLOR)
  })

  it('clamps a valid but out-of-range matte color channel-wise', () => {
    expect(normalizeGifEncodeOptions({ matteColor: [-10, 300, 128] }).matteColor).toEqual([0, 255, 128])
  })
})

describe('normalizeDelayMs (T2.2)', () => {
  it('passes through a valid delay unchanged', () => {
    expect(normalizeDelayMs(120)).toBe(120)
  })

  it('floors below-minimum and invalid values to MIN_DELAY_MS', () => {
    expect(normalizeDelayMs(5)).toBe(MIN_DELAY_MS)
    expect(normalizeDelayMs(-100)).toBe(MIN_DELAY_MS)
    expect(normalizeDelayMs(Number.NaN)).toBe(MIN_DELAY_MS)
    expect(normalizeDelayMs(undefined)).toBe(MIN_DELAY_MS)
    expect(normalizeDelayMs(Number.POSITIVE_INFINITY)).toBe(MIN_DELAY_MS)
  })
})

describe('numPlaysToRepeat (T2.2)', () => {
  it.each([
    [0, 0],
    [1, -1],
    [2, 1],
    [3, 2],
    [10, 9],
  ])('numPlays %i -> repeat %i', (numPlays, expected) => {
    expect(numPlaysToRepeat(numPlays)).toBe(expected)
  })

  it('treats invalid input (negative/non-finite) as infinite (repeat 0), same as numPlays 0', () => {
    expect(numPlaysToRepeat(-5)).toBe(0)
    expect(numPlaysToRepeat(Number.NaN)).toBe(0)
  })

  it('rounds a fractional numPlays before mapping', () => {
    expect(numPlaysToRepeat(2.4)).toBe(1) // rounds to 2 -> repeat 1
  })
})

describe('blendWithMatte (T2.2)', () => {
  it('returns the raw color unchanged at full opacity', () => {
    expect(blendWithMatte(200, 50, 50, 255, [255, 255, 255])).toEqual([200, 50, 50])
  })

  it('returns the matte color unchanged at zero opacity', () => {
    expect(blendWithMatte(200, 50, 50, 0, [255, 255, 255])).toEqual([255, 255, 255])
  })

  it('matches the T1.4 spike hand-computed blend for alpha=140 over a white matte', () => {
    expect(blendWithMatte(200, 50, 50, 140, [255, 255, 255])).toEqual([225, 142, 142])
  })
})

describe('quantizeFrameToIndexedBitmap (T2.2, Path A adversarial fixture)', () => {
  // Same adversarial 2x2 fixture as the T1.4 spike PoC (see WORKS.md): a
  // fully transparent "white" pixel sits next to a visually similar opaque
  // pixel, to prove the reserved-index *override* -- not applyPalette's
  // nearest-neighbor search -- is what decides transparency.
  const adversarialFrame = makeRgbaFrame(2, 2, [
    [255, 255, 255, 0], // P0: fully transparent, "white"
    [250, 250, 250, 255], // P1: opaque, near-white neighbor
    [200, 50, 50, 140], // P2: semi-transparent, above threshold 128
    [0, 150, 0, 255], // P3: opaque green
  ])

  it('assigns the reserved index only to the transparent pixel, leaving its opaque neighbor untouched', () => {
    const { index, hasTransparent, reservedIndex } = quantizeFrameToIndexedBitmap(
      adversarialFrame,
      128,
      [255, 255, 255],
      256,
    )

    expect(hasTransparent).toBe(true)
    expect(index[0]).toBe(reservedIndex)
    expect(index[1]).not.toBe(reservedIndex)
    expect(index[1]).not.toBe(index[0])
  })

  it('matte-blends the above-threshold semi-transparent pixel instead of keeping its raw color', () => {
    const { index, palette } = quantizeFrameToIndexedBitmap(adversarialFrame, 128, [255, 255, 255], 256)
    expect(palette[index[2]]).not.toEqual([200, 50, 50])
    expect(palette[index[2]]).toEqual([225, 142, 142])
  })

  it('does not reserve a slot when no pixel in the frame is below threshold', () => {
    const opaqueFrame = makeSolidFrame(2, 2, 10, 20, 30, 255)
    const { hasTransparent, reservedIndex, palette } = quantizeFrameToIndexedBitmap(
      opaqueFrame,
      128,
      [255, 255, 255],
      256,
    )
    expect(hasTransparent).toBe(false)
    expect(reservedIndex).toBe(-1)
    expect(palette).toHaveLength(1) // single solid color, no slot spent on transparency
  })
})

describe('encodeGif (T2.2)', () => {
  it('rejects an animation with no frames', () => {
    const input: GifEncodeInput = { frames: [], delaysMs: [], loop: 0 }
    expect(() => encodeGif(input)).toThrow()
  })

  it('produces a well-formed GIF89a stream with the correct frame count and trailer', () => {
    const input: GifEncodeInput = {
      frames: [makeSolidFrame(4, 4, 255, 0, 0), makeSolidFrame(4, 4, 0, 0, 255)],
      delaysMs: [100, 250],
      loop: 0,
    }
    const parsed = parseGif(encodeGif(input))
    expect(parsed.header).toBe('GIF89a')
    expect(parsed.frameCount).toBe(2)
    expect(parsed.hasValidTrailer).toBe(true)
  })

  it("writes each frame's own delay in centiseconds (ms/10 contract) for distinct values", () => {
    const input: GifEncodeInput = {
      frames: [makeSolidFrame(2, 2, 255, 0, 0), makeSolidFrame(2, 2, 0, 255, 0)],
      delaysMs: [100, 250],
      loop: 0,
    }
    const gces = parseGif(encodeGif(input)).graphicControlExtensions
    expect(gces[0].delayCentiseconds).toBe(10)
    expect(gces[1].delayCentiseconds).toBe(25)
  })

  it('clamps a below-floor delay to the 20ms floor (2cs) end-to-end', () => {
    const input: GifEncodeInput = {
      frames: [makeSolidFrame(2, 2, 10, 10, 10)],
      delaysMs: [5],
      loop: 0,
    }
    const gce = parseGif(encodeGif(input)).graphicControlExtensions[0]
    expect(gce.delayCentiseconds).toBe(2)
  })

  describe('loop mapping end-to-end', () => {
    it.each([
      [0, 0],
      [1, undefined],
      [3, 2],
    ])('loop=%i -> NETSCAPE loop count %s', (loop, expectedLoopCount) => {
      const input: GifEncodeInput = { frames: [makeSolidFrame(2, 2, 1, 2, 3)], delaysMs: [100], loop }
      expect(parseGif(encodeGif(input)).loopCount).toBe(expectedLoopCount)
    })
  })

  it('sets the transparent flag/index only on frames that actually contain transparency', () => {
    const input: GifEncodeInput = {
      frames: [
        makeRgbaFrame(2, 2, [
          [255, 255, 255, 0],
          [250, 250, 250, 255],
          [200, 50, 50, 140],
          [0, 150, 0, 255],
        ]),
        makeSolidFrame(2, 2, 10, 20, 30, 255),
      ],
      delaysMs: [100, 100],
      loop: 0,
    }
    const gces = parseGif(encodeGif(input)).graphicControlExtensions
    expect(gces[0].transparentColorFlag).toBe(true)
    expect(gces[1].transparentColorFlag).toBe(false)
  })

  it('forces GCE disposal to 2 (restore to background) on every frame', () => {
    const input: GifEncodeInput = {
      frames: [makeSolidFrame(2, 2, 1, 2, 3), makeSolidFrame(2, 2, 4, 5, 6)],
      delaysMs: [100, 100],
      loop: 0,
    }
    const gces = parseGif(encodeGif(input)).graphicControlExtensions
    expect(gces[0].disposalMethod).toBe(2)
    expect(gces[1].disposalMethod).toBe(2)
  })

  it('normalizes invalid options instead of throwing', () => {
    const input: GifEncodeInput = { frames: [makeSolidFrame(2, 2, 1, 2, 3)], delaysMs: [100], loop: 0 }
    expect(() =>
      encodeGif(input, { alphaThreshold: Number.NaN, matteColor: [Number.NaN, Number.NaN, Number.NaN], maxColors: -5 }),
    ).not.toThrow()
  })

  it('calls onFrameEncoded once per frame with a strictly increasing 0-based index and a constant total (T3.3)', () => {
    const input: GifEncodeInput = {
      frames: [makeSolidFrame(2, 2, 1, 2, 3), makeSolidFrame(2, 2, 4, 5, 6), makeSolidFrame(2, 2, 7, 8, 9)],
      delaysMs: [100, 100, 100],
      loop: 0,
    }
    const onFrameEncoded = vi.fn()

    encodeGif(input, { onFrameEncoded })

    expect(onFrameEncoded).toHaveBeenCalledTimes(3)
    expect(onFrameEncoded.mock.calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ])
  })
})
