/**
 * S3-T3.1 ((internal design doc) §4a/§4b, Verification「decode」).
 *
 * `gifDisposalToComposite`/`normalizeGifuctFrameDelayMs` are pinned first as
 * pure table tests with no fixture dependency at all, since they're the
 * correctness-critical (and easy to silently break) numeric mappings; the
 * rest of this file drives `decodeGif` end to end through hand-built GIFs
 * from `./fixtures/generate.ts`'s `buildGif`.
 */
import { describe, expect, it } from 'vitest'
import { DISPOSE_OP_BACKGROUND, DISPOSE_OP_NONE, DISPOSE_OP_PREVIOUS } from '../../src/lib/composite.js'
import { buildGif, buildSampleEditGif, type RgbColor } from './fixtures/generate.js'
import {
  decodeGif,
  estimateDecodedByteSize,
  gifDisposalToComposite,
  normalizeGifuctFrameDelayMs,
  NO_GCE_DEFAULT_DELAY_MS,
} from './decode.js'

type Pixel = [number, number, number, number]

/** Flattens a row-major grid of expected RGBA pixels into the flat form `DecodedGif.frames[i].data` uses. */
function flatten(rows: Pixel[][]): Uint8ClampedArray {
  const height = rows.length
  const width = rows[0].length
  const data = new Uint8ClampedArray(width * height * 4)
  rows.forEach((row, y) => {
    row.forEach((px, x) => {
      const off = (y * width + x) * 4
      data[off] = px[0]
      data[off + 1] = px[1]
      data[off + 2] = px[2]
      data[off + 3] = px[3]
    })
  })
  return data
}

function opaque(color: RgbColor): Pixel {
  return [color[0], color[1], color[2], 255]
}

const TRANSPARENT: Pixel = [0, 0, 0, 0]

describe('gifDisposalToComposite (table test, no fixture dependency)', () => {
  it.each([
    [0, false, DISPOSE_OP_NONE],
    [1, false, DISPOSE_OP_NONE],
    [undefined, false, DISPOSE_OP_NONE],
    [4, false, DISPOSE_OP_NONE], // reserved
    [5, false, DISPOSE_OP_NONE], // reserved
    [6, false, DISPOSE_OP_NONE], // reserved
    [7, false, DISPOSE_OP_NONE], // reserved
    [2, false, DISPOSE_OP_BACKGROUND],
    [2, true, DISPOSE_OP_BACKGROUND], // BACKGROUND has no first-frame special case
    [3, false, DISPOSE_OP_PREVIOUS],
  ] as const)('gifDisposal=%s, isFirstFrame=%s -> %s', (gifDisposal, isFirstFrame, expected) => {
    expect(gifDisposalToComposite(gifDisposal, isFirstFrame)).toBe(expected)
  })

  it('downgrades disposal 3 (PREVIOUS) to BACKGROUND on the first frame (undefined-by-spec otherwise; mirrors composite.ts/APNG rule)', () => {
    expect(gifDisposalToComposite(3, true)).toBe(DISPOSE_OP_BACKGROUND)
  })

  it('does not downgrade disposal 3 on any later frame', () => {
    expect(gifDisposalToComposite(3, false)).toBe(DISPOSE_OP_PREVIOUS)
  })
})

describe('normalizeGifuctFrameDelayMs (pure, no fixture)', () => {
  it('undefined (no GCE on the frame) maps to the 100ms default', () => {
    expect(normalizeGifuctFrameDelayMs(undefined)).toBe(NO_GCE_DEFAULT_DELAY_MS)
    expect(NO_GCE_DEFAULT_DELAY_MS).toBe(100)
  })

  it('a defined delay (including a literal 0, which gifuct-js itself never actually produces) passes through unchanged', () => {
    expect(normalizeGifuctFrameDelayMs(150)).toBe(150)
    expect(normalizeGifuctFrameDelayMs(0)).toBe(0)
  })
})

describe('decodeGif: magic bytes gate', () => {
  it('rejects non-GIF bytes', () => {
    expect(() => decodeGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/GIF/)
  })

  it('rejects a PNG signature', () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    expect(() => decodeGif(png)).toThrow(/GIF/)
  })

  it('rejects input shorter than the signature', () => {
    expect(() => decodeGif(Uint8Array.of(0x47, 0x49, 0x46))).toThrow(/GIF/)
  })

  it('both GIF87a and GIF89a pass the gate (gifuct-js is lenient about a bare signature with nothing else -- it decodes to zero frames rather than throwing, node-verified; see the dedicated corrupted-file describe block below for where a genuinely malformed body actually throws)', () => {
    const gif87a = Uint8Array.from('GIF87a', (ch) => ch.charCodeAt(0))
    const gif89a = Uint8Array.from('GIF89a', (ch) => ch.charCodeAt(0))
    expect(decodeGif(gif87a).frames).toEqual([])
    expect(decodeGif(gif89a).frames).toEqual([])
  })
})

describe('decodeGif: corrupted-but-past-magic-bytes error path', () => {
  /**
   * js-binary-schema-parser (gifuct-js's parser backbone) is surprisingly
   * lenient about truncation -- a bare 6-byte signature, or one followed by
   * random garbage, decodes "successfully" with null/nonsense fields and
   * zero frames rather than throwing (node-verified while writing this
   * test). To exercise `decodeGif`'s actual corrupted-file error path, this
   * builds a GIF that is well-formed just up through its Global Color Table
   * and then hits an Image Descriptor block (0x2c) with none of its required
   * bytes present -- `decompressFrames` reliably throws "Invalid array
   * length" reading that (node-verified), which is exactly the kind of
   * genuinely-corrupt input `decodeGifuctFrames` must turn into a
   * UI-displayable error instead of leaking a raw parser exception.
   */
  function buildImageDescriptorTruncatedGif(): Uint8Array {
    const signature = Array.from('GIF89a', (ch) => ch.charCodeAt(0))
    return Uint8Array.from([
      ...signature,
      2, 0, // logical screen width = 2 (u16le)
      2, 0, // logical screen height = 2 (u16le)
      0x80, // packed: GCT present, 2-color table
      0, // background color index
      0, // pixel aspect ratio
      0, 0, 0, 255, 255, 255, // 2-entry GCT
      0x2c, // image separator -- descriptor bytes truncated away entirely
    ])
  }

  it('throws a readable, UI-displayable error instead of leaking the raw gifuct-js/js-binary-schema-parser exception', () => {
    const bytes = buildImageDescriptorTruncatedGif()
    expect(() => decodeGif(bytes)).toThrow(/GIF 檔案已損壞或格式不受支援/)
  })
})

describe('decodeGif: non-zero frame offset placement', () => {
  it('places a frame rect at a non-zero (left,top) correctly within the composited canvas', () => {
    const bg: RgbColor = [10, 20, 30]
    const colorX: RgbColor = [200, 50, 50]
    const bytes = buildGif({
      width: 3,
      height: 3,
      gct: [bg, colorX, [0, 0, 0], [0, 0, 0]],
      loop: null,
      frames: [
        { left: 0, top: 0, width: 3, height: 3, delayCs: 5, disposal: 0, pixels: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
        // Bottom-right 2x2 rect at (1,1): left != top would not distinguish here
        // (they're equal), but width/height both 2 keeps this focused purely on
        // offset placement, cross-checked by the dedicated disposal fixtures below.
        { left: 1, top: 1, width: 2, height: 2, delayCs: 5, disposal: 0, pixels: [1, 1, 1, 1] },
      ],
    })

    const decoded = decodeGif(bytes)
    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(3)
    expect(decoded.frames).toHaveLength(2)

    const expected = flatten([
      [opaque(bg), opaque(bg), opaque(bg)],
      [opaque(bg), opaque(colorX), opaque(colorX)],
      [opaque(bg), opaque(colorX), opaque(colorX)],
    ])
    expect(decoded.frames[1].data).toEqual(expected)
  })
})

describe('decodeGif: disposal semantics end-to-end (GIF disposal 2 vs 3 must not collide with composite enum values)', () => {
  const bg: RgbColor = [10, 20, 30]
  const colorX: RgbColor = [200, 50, 50]
  const probe: RgbColor = [50, 200, 50]

  it('disposal 2 (BACKGROUND): the dispose rect clears to transparent, revealed by a following transparent probe frame', () => {
    const bytes = buildGif({
      width: 2,
      height: 2,
      gct: [bg, colorX, probe, [0, 0, 0]],
      loop: null,
      frames: [
        { left: 0, top: 0, width: 2, height: 2, delayCs: 5, disposal: 0, pixels: [0, 0, 0, 0] },
        { left: 0, top: 0, width: 1, height: 1, delayCs: 6, disposal: 2, pixels: [1] },
        // A fully-transparent 1x1 probe: whatever this frame *displays* at (0,0)
        // is exactly whatever disposal 2 left behind after frame 1 (since the
        // probe pixel itself contributes nothing under OVER).
        { left: 0, top: 0, width: 1, height: 1, delayCs: 7, disposal: 0, transparentIndex: 2, pixels: [2] },
      ],
    })

    const decoded = decodeGif(bytes)
    expect(decoded.frames).toHaveLength(3)

    expect(decoded.frames[0].data).toEqual(flatten([[opaque(bg), opaque(bg)], [opaque(bg), opaque(bg)]]))
    expect(decoded.frames[1].data).toEqual(flatten([[opaque(colorX), opaque(bg)], [opaque(bg), opaque(bg)]]))
    // Correctly cleared to transparent -- a numeric-collision bug (GIF 2 misread
    // as composite's PREVIOUS=2) would instead *restore* bg here.
    expect(decoded.frames[2].data).toEqual(flatten([[TRANSPARENT, opaque(bg)], [opaque(bg), opaque(bg)]]))
  })

  it('disposal 3 (PREVIOUS): the dispose rect restores its pre-blend snapshot, revealed by a following transparent probe frame', () => {
    const bytes = buildGif({
      width: 2,
      height: 2,
      gct: [bg, colorX, probe, [0, 0, 0]],
      loop: null,
      frames: [
        { left: 0, top: 0, width: 2, height: 2, delayCs: 5, disposal: 0, pixels: [0, 0, 0, 0] },
        { left: 0, top: 0, width: 1, height: 1, delayCs: 6, disposal: 3, pixels: [1] },
        { left: 0, top: 0, width: 1, height: 1, delayCs: 7, disposal: 0, transparentIndex: 2, pixels: [2] },
      ],
    })

    const decoded = decodeGif(bytes)
    expect(decoded.frames).toHaveLength(3)

    expect(decoded.frames[0].data).toEqual(flatten([[opaque(bg), opaque(bg)], [opaque(bg), opaque(bg)]]))
    expect(decoded.frames[1].data).toEqual(flatten([[opaque(colorX), opaque(bg)], [opaque(bg), opaque(bg)]]))
    // Correctly restored to the pre-blend value (bg) -- an unmapped-passthrough
    // bug (GIF 3 falls outside composite's domain, silently behaves like NONE)
    // would instead leave colorX here.
    expect(decoded.frames[2].data).toEqual(flatten([[opaque(bg), opaque(bg)], [opaque(bg), opaque(bg)]]))
  })

  it('first-frame disposal 3 (reserved by spec) downgrades safely instead of crashing or misbehaving', () => {
    const colorY: RgbColor = [8, 8, 8]
    const bytes = buildGif({
      width: 2,
      height: 2,
      gct: [colorY, [0, 0, 0], [0, 0, 0], [0, 0, 0]],
      loop: null,
      frames: [{ left: 0, top: 0, width: 1, height: 1, delayCs: 5, disposal: 3, pixels: [0] }],
    })

    const decoded = decodeGif(bytes)
    expect(decoded.frames).toHaveLength(1)
    // Rect itself renders normally; downgrading disposal only affects the
    // (unobservable past the last frame) canvas state carried forward.
    expect(decoded.frames[0].data).toEqual(flatten([[opaque(colorY), TRANSPARENT], [TRANSPARENT, TRANSPARENT]]))
  })
})

describe('decodeGif: transparent pixels', () => {
  it('a transparentIndex pixel decodes to alpha 0; other pixels stay opaque with their GCT color', () => {
    const bg: RgbColor = [10, 20, 30]
    const colorX: RgbColor = [200, 50, 50]
    const bytes = buildGif({
      width: 2,
      height: 1,
      gct: [bg, colorX],
      loop: null,
      frames: [{ left: 0, top: 0, width: 2, height: 1, delayCs: 10, disposal: 0, transparentIndex: 0, pixels: [0, 1] }],
    })

    const decoded = decodeGif(bytes)
    expect(decoded.frames[0].data).toEqual(flatten([[TRANSPARENT, opaque(colorX)]]))
  })
})

describe('decodeGif: delaysMs (cs >= 2, avoiding gifuct-js\'s 0cs->100ms fallback branch)', () => {
  it('maps each frame\'s delayCs*10 to delaysMs', () => {
    const bytes = buildGif({
      width: 1,
      height: 1,
      gct: [[1, 2, 3], [4, 5, 6]],
      loop: null,
      frames: [
        { left: 0, top: 0, width: 1, height: 1, delayCs: 23, disposal: 0, pixels: [0] },
        { left: 0, top: 0, width: 1, height: 1, delayCs: 41, disposal: 0, pixels: [1] },
      ],
    })

    const decoded = decodeGif(bytes)
    expect(decoded.delaysMs).toEqual([230, 410])
  })
})

describe('decodeGif: loop extraction (0 / no extension / n)', () => {
  function singleFrameGif(loop: number | null): Uint8Array {
    return buildGif({
      width: 1,
      height: 1,
      gct: [[1, 2, 3], [4, 5, 6]],
      loop,
      frames: [{ left: 0, top: 0, width: 1, height: 1, delayCs: 10, disposal: 0, pixels: [0] }],
    })
  }

  it('NETSCAPE loop count 0 -> loop 0 (infinite)', () => {
    expect(decodeGif(singleFrameGif(0)).loop).toBe(0)
  })

  it('no NETSCAPE extension -> loop 1 (single play)', () => {
    expect(decodeGif(singleFrameGif(null)).loop).toBe(1)
  })

  it('NETSCAPE loop count n (n>0) -> loop n+1', () => {
    expect(decodeGif(singleFrameGif(7)).loop).toBe(8)
  })
})

describe('decodeGif: T2.1 signed-in fixture (sample-edit.gif / buildSampleEditGif)', () => {
  it('decodes width/height, frame count, delaysMs, and loop as documented in generate.ts\'s ground truth', () => {
    const decoded = decodeGif(buildSampleEditGif())

    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(4)
    expect(decoded.frames).toHaveLength(2)
    // ground truth (generate.ts header): frame0 delay 15cs, frame1 delay 37cs
    expect(decoded.delaysMs).toEqual([150, 370])
    // ground truth: NETSCAPE wire loopCount 3 -> numPlays 3+1
    expect(decoded.loop).toBe(4)
  })

  it('frame 0 (full 4x4, disposal 0) decodes to the exact GCT-resolved opaque RGBA grid', () => {
    const decoded = decodeGif(buildSampleEditGif())
    const gct: RgbColor[] = [
      [200, 30, 30],
      [30, 200, 30],
      [30, 30, 200],
      [220, 220, 40],
    ]
    const indices = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2]
    const rows: Pixel[][] = []
    for (let y = 0; y < 4; y++) {
      rows.push(indices.slice(y * 4, y * 4 + 4).map((i) => opaque(gct[i])))
    }
    expect(decoded.frames[0].data).toEqual(flatten(rows))
  })
})

describe('decodeGif: frame with no Graphic Control Extension at all (GifFrameSpec delayCs/disposal both omitted)', () => {
  it('delaysMs falls back to the 100ms default and disposal behaves as NONE (a later frame sees nothing cleared)', () => {
    const bg: RgbColor = [10, 20, 30]
    const probe: RgbColor = [50, 200, 50]
    const bytes = buildGif({
      width: 1,
      height: 1,
      gct: [bg, probe],
      loop: null,
      frames: [
        { left: 0, top: 0, width: 1, height: 1, pixels: [0] }, // no delayCs/disposal -> no GCE at all
        { left: 0, top: 0, width: 1, height: 1, delayCs: 5, disposal: 0, transparentIndex: 1, pixels: [1] },
      ],
    })

    const decoded = decodeGif(bytes)
    expect(decoded.frames).toHaveLength(2)
    expect(decoded.delaysMs[0]).toBe(NO_GCE_DEFAULT_DELAY_MS)
    // The second frame is a fully-transparent probe, so whatever it *displays*
    // is exactly whatever the no-GCE first frame left behind. NONE leaves bg
    // in place; a wrongly-defaulted disposal (e.g. BACKGROUND) would instead
    // clear it to transparent here.
    expect(decoded.frames[1].data).toEqual(flatten([[opaque(bg)]]))
  })
})

describe('estimateDecodedByteSize (memory gate estimate, PLAN §5)', () => {
  it('computes width*height*4*frameCount for a known fixture', () => {
    const bytes = buildGif({
      width: 4,
      height: 4,
      gct: [[1, 2, 3], [4, 5, 6]],
      loop: null,
      frames: [
        { left: 0, top: 0, width: 4, height: 4, delayCs: 5, disposal: 0, pixels: new Array(16).fill(0) },
        { left: 0, top: 0, width: 4, height: 4, delayCs: 5, disposal: 0, pixels: new Array(16).fill(1) },
      ],
    })
    // 4 * 4 * 4 bytes/pixel * 2 frames
    expect(estimateDecodedByteSize(bytes)).toBe(4 * 4 * 4 * 2)
  })

  it('filters out non-image "frames" (e.g. the NETSCAPE application extension) from the frame count', () => {
    const bytes = buildGif({
      width: 2,
      height: 2,
      gct: [[1, 2, 3], [4, 5, 6]],
      loop: 5, // writes a NETSCAPE2.0 application extension, which parseGIF also lists as a "frame"
      frames: [
        { left: 0, top: 0, width: 2, height: 2, delayCs: 5, disposal: 0, pixels: [0, 0, 0, 0] },
        { left: 0, top: 0, width: 2, height: 2, delayCs: 5, disposal: 0, pixels: [1, 1, 1, 1] },
      ],
    })
    // Would be 2*2*4*3 = 48 if the application-extension "frame" were miscounted as image data.
    expect(estimateDecodedByteSize(bytes)).toBe(2 * 2 * 4 * 2)
  })

  it('returns 0 for a GIF with zero image frames', () => {
    const bytes = buildGif({ width: 5, height: 5, gct: [[1, 2, 3], [4, 5, 6]], loop: null, frames: [] })
    expect(estimateDecodedByteSize(bytes)).toBe(0)
  })
})
