/**
 * Validates the hand-written GIF LZW fixture builder (`generate.ts`) by
 * decoding its output with gifuct-js -- the same library `decode.ts` will
 * use in production -- and cross-checking wire-level fields against the
 * independent `src/lib/gif-reader.ts` parser. This is the SP-4 blocking
 * PoC gate (PLAN.md「Open questions」): 2 frames, frame 1 at a non-zero
 * (left,top), disposalType=3, decoded back correctly by gifuct proves the
 * "uncompressed LZW + periodic clear code" approach works and no external
 * tool / hand-verified sample fallback is needed.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGIF, decompressFrames } from 'gifuct-js'
import { parseGif } from '../../../src/lib/gif-reader.js'
import {
  buildGif,
  buildSampleEditGif,
  SAMPLE_FRAME0,
  SAMPLE_FRAME1,
  SAMPLE_GCT,
  SAMPLE_LOOP,
  type BuildGifOptions,
  type RgbColor,
} from './generate.js'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // `Uint8Array.buffer` is typed `ArrayBufferLike` (ArrayBuffer | SharedArrayBuffer);
  // buildGif always backs its output with a plain ArrayBuffer (see encode.worker.ts's
  // top comment for the same narrowing elsewhere in this repo).
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function decode(bytes: Uint8Array) {
  return decompressFrames(parseGIF(toArrayBuffer(bytes)), true)
}

const sampleFixturePath = resolve(import.meta.dirname, 'sample-edit.gif')

describe('sample-edit.gif — SP-4 blocking PoC (2 frames, frame 1 non-zero left/top, disposalType=3)', () => {
  it('gifuct decodes both frames with correct dims/disposalType/pixels', () => {
    const frames = decode(buildSampleEditGif())

    expect(frames).toHaveLength(2)

    expect(frames[0].dims).toEqual({ left: 0, top: 0, width: 4, height: 4 })
    expect(frames[0].disposalType).toBe(0)
    expect(frames[0].pixels).toEqual(SAMPLE_FRAME0.pixels)

    expect(frames[1].dims).toEqual({ left: 1, top: 2, width: 2, height: 1 })
    expect(frames[1].disposalType).toBe(3)
    expect(frames[1].pixels).toEqual(SAMPLE_FRAME1.pixels)
  })

  it('patch pixels resolve through the GCT to the expected opaque RGBA colors', () => {
    const frames = decode(buildSampleEditGif())

    const [r0, g0, b0] = SAMPLE_GCT[SAMPLE_FRAME0.pixels[0]]
    expect(Array.from(frames[0].patch.slice(0, 4))).toEqual([r0, g0, b0, 255])

    const [r1, g1, b1] = SAMPLE_GCT[SAMPLE_FRAME1.pixels[0]]
    expect(Array.from(frames[1].patch.slice(0, 4))).toEqual([r1, g1, b1, 255])
  })

  it('cross-validated against src/lib/gif-reader.ts: frame count and per-frame GCE fields', () => {
    const parsed = parseGif(buildSampleEditGif())

    expect(parsed.header).toBe('GIF89a')
    expect(parsed.width).toBe(4)
    expect(parsed.height).toBe(4)
    expect(parsed.frameCount).toBe(2)
    expect(parsed.hasValidTrailer).toBe(true)
    expect(parsed.loopCount).toBe(SAMPLE_LOOP)

    expect(parsed.graphicControlExtensions).toEqual([
      { disposalMethod: 0, transparentColorFlag: false, delayCentiseconds: 15, transparentColorIndex: 0 },
      { disposalMethod: 3, transparentColorFlag: false, delayCentiseconds: 37, transparentColorIndex: 0 },
    ])
  })
})

describe('sample-edit.gif — signed-in file is byte-stable', () => {
  it('matches a fresh buildSampleEditGif() call byte-for-byte', () => {
    const onDisk = readFileSync(sampleFixturePath)
    const fresh = buildSampleEditGif()
    expect(Buffer.from(fresh).equals(onDisk)).toBe(true)
  })
})

describe('fixture set: transparency', () => {
  it('gifuct reports the transparent index and writes alpha=0 only for that pixel', () => {
    const bytes = buildGif({
      width: 2,
      height: 1,
      gct: [
        [10, 20, 30],
        [40, 50, 60],
      ],
      loop: null,
      frames: [{ left: 0, top: 0, width: 2, height: 1, delayCs: 10, disposal: 0, transparentIndex: 1, pixels: [0, 1] }],
    })
    const [frame] = decode(bytes)

    expect(frame.transparentIndex).toBe(1)
    expect([frame.patch[0], frame.patch[1], frame.patch[2], frame.patch[3]]).toEqual([10, 20, 30, 255])
    expect(frame.patch[7]).toBe(0) // pixel 1 (the transparent index): alpha must be 0
  })
})

describe('fixture set: disposal method 2', () => {
  it('gifuct reports disposalType 2 for the frame using it', () => {
    const bytes = buildGif({
      width: 2,
      height: 2,
      gct: [
        [0, 0, 0],
        [255, 255, 255],
        [255, 0, 0],
        [0, 255, 0],
      ],
      loop: null,
      frames: [
        { left: 0, top: 0, width: 2, height: 2, delayCs: 5, disposal: 1, pixels: [0, 1, 2, 3] },
        { left: 0, top: 0, width: 2, height: 2, delayCs: 5, disposal: 2, pixels: [3, 2, 1, 0] },
      ],
    })
    const frames = decode(bytes)

    expect(frames[0].disposalType).toBe(1)
    expect(frames[1].disposalType).toBe(2)
    expect(frames[1].pixels).toEqual([3, 2, 1, 0])
  })
})

function singleFrameOptions(loop: number | null): BuildGifOptions {
  return {
    width: 1,
    height: 1,
    gct: [
      [1, 2, 3],
      [4, 5, 6],
    ],
    loop,
    frames: [{ left: 0, top: 0, width: 1, height: 1, delayCs: 10, disposal: 0, pixels: [0] }],
  }
}

describe('fixture set: NETSCAPE loop extension', () => {
  it('loop: null omits the extension entirely (no NETSCAPE ext present)', () => {
    expect(parseGif(buildGif(singleFrameOptions(null))).loopCount).toBeUndefined()
  })

  it('loop: 0 writes loop count 0 (infinite)', () => {
    expect(parseGif(buildGif(singleFrameOptions(0))).loopCount).toBe(0)
  })

  it('loop: n (n>0) writes the count verbatim', () => {
    expect(parseGif(buildGif(singleFrameOptions(7))).loopCount).toBe(7)
  })
})

describe('fixture set: minCodeSize=3 generalization (>=5-color GCT forces a wider code size than the sample fixture)', () => {
  it('gifuct decodes every pixel identically for a 5-color GCT frame spanning multiple Clear Code periods', () => {
    // colorTableSizeField(5) = 2 -> minCodeSize = max(2, 2+1) = 3 (see buildGif),
    // unlike every other fixture in this file which uses a 2-4 color GCT and
    // only ever exercises encodeUncompressedLzw's minCodeSize=2 path.
    const gct: RgbColor[] = [
      [10, 10, 10],
      [50, 50, 50],
      [90, 90, 90],
      [130, 130, 130],
      [170, 170, 170],
    ]
    // 16 pixels, indices cycling 0..4 -- more than maxCodesPerClear (2^3-2=6
    // for minCodeSize=3), so the encoder must re-emit its Clear Code multiple
    // times within this single frame.
    const pixels = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0]
    const bytes = buildGif({
      width: 4,
      height: 4,
      gct,
      loop: null,
      frames: [{ left: 0, top: 0, width: 4, height: 4, delayCs: 10, disposal: 0, pixels }],
    })
    const [frame] = decode(bytes)

    expect(frame.pixels).toEqual(pixels)
    const expectedRgba = pixels.flatMap((i) => [...gct[i], 255])
    expect(Array.from(frame.patch)).toEqual(expectedRgba)
  })
})

describe('fixture set: local color table override', () => {
  it("gifuct reads pixel colors from the frame's local color table, not the global one", () => {
    const bytes = buildGif({
      width: 1,
      height: 1,
      gct: [
        [255, 0, 0],
        [0, 255, 0],
      ],
      loop: null,
      frames: [
        {
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          delayCs: 10,
          disposal: 0,
          pixels: [1],
          lct: [
            [9, 9, 9],
            [80, 90, 100],
          ],
        },
      ],
    })
    const [frame] = decode(bytes)

    // gifuct returns each colorTable entry as a Uint8Array at runtime (despite
    // the shipped .d.ts typing it as a plain [number,number,number] tuple).
    expect(frame.colorTable.map((color) => Array.from(color))).toEqual([
      [9, 9, 9],
      [80, 90, 100],
    ])
    expect(Array.from(frame.patch.slice(0, 4))).toEqual([80, 90, 100, 255])
  })
})
