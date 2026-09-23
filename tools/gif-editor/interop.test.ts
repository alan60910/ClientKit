/**
 * SP-2 + SP-3 ((internal design doc)「Open questions」) sunk as permanent
 * regression tests, per S3-T2.2:
 *
 *  - SP-2: on the *same* gifenc-produced bytes, cross-check `gif-reader.ts`'s
 *    wire-level reading (raw centiseconds, raw NETSCAPE loop count, frame
 *    count, GCE disposal) against `gifuct-js`'s frame decode (delay in ms,
 *    disposalType, patch alpha) against the values we asked `encodeGif` to
 *    write, to catch "both libraries agree on the wrong thing" false-greens
 *    that a single-library test can't see.
 *  - SP-3: compare the two candidate loop-count extraction methods described
 *    in ./netscape-loop.ts's doc comment, including on deliberately unusual
 *    (but spec-valid) byte layouts, and pin the resulting `extractLoopCount`
 *    contract as a permanent regression test.
 *
 * All fixtures here are produced with `encodeGif`/`gifenc`'s `GIFEncoder`
 * directly -- none of this reads from tools/gif-editor/fixtures/ (owned by
 * the parallel T2.1 lane).
 */
import { describe, expect, it } from 'vitest'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { parseGIF as gifuctParseGIF, decompressFrames } from 'gifuct-js'
import { parseGif } from '../../src/lib/gif-reader.js'
import { encodeGif, numPlaysToRepeat, type GifEncodeInput } from '../../src/lib/gif-encode.js'
import { makeRgbaFrame, makeSolidFrame } from '../../src/lib/test-helpers.js'
import { extractLoopCount } from './netscape-loop.js'

/**
 * gifuct-js's shipped type for `parseGIF` demands an `ArrayBuffer`. Copying
 * into a freshly-sized one (rather than handing over a `Uint8Array`'s own
 * `.buffer`) sidesteps both the type mismatch and any risk of an
 * over/under-sized view leaking through.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function concatBytes(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((part) => (part instanceof Uint8Array ? part : Uint8Array.from(part)))
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const arr of arrays) {
    out.set(arr, offset)
    offset += arr.length
  }
  return out
}

/** `[0x21, 0xFE, <sub-blocks>]` -- a Comment Extension carrying `text`. */
function commentExtensionBytes(text: string): number[] {
  const payload = Array.from(text, (c) => c.charCodeAt(0))
  return [0x21, 0xfe, ...(payload.length > 0 ? [payload.length, ...payload] : []), 0x00]
}

/** `[0x21, 0x01, 12, <12-byte preData>, <sub-blocks>]` -- a Plain Text Extension. */
function plainTextExtensionBytes(text: string): number[] {
  const preData = new Array(12).fill(0)
  const payload = Array.from(text, (c) => c.charCodeAt(0))
  return [0x21, 0x01, 12, ...preData, ...(payload.length > 0 ? [payload.length, ...payload] : []), 0x00]
}

/**
 * `[0x21, 0xFF, 11, <11-char id>, <sub-blocks>]` -- an Application Extension
 * with an arbitrary (non-NETSCAPE2.0) 11-character id, so it exercises the
 * exact same wire shape as the real NETSCAPE2.0 extension without being one.
 */
function privateApplicationExtensionBytes(id11: string, subBlockPayload: number[]): number[] {
  if (id11.length !== 11) throw new Error('privateApplicationExtensionBytes: id must be exactly 11 characters')
  const idBytes = Array.from(id11, (c) => c.charCodeAt(0))
  return [
    0x21,
    0xff,
    11,
    ...idBytes,
    ...(subBlockPayload.length > 0 ? [subBlockPayload.length, ...subBlockPayload] : []),
    0x00,
  ]
}

describe('three-way cross validation (SP-2): gif-reader wire bytes x gifuct decode x written intent', () => {
  const width = 2
  const height = 2
  // cs >= 2 throughout (PLAN.md SP-2) so no delay here lands on gifuct's
  // `(gce.delay || 10) * 10` zero-centisecond fallback branch -- that branch
  // gets its own dedicated pin below.
  const delaysMs = [50, 80, 30] // -> 5cs, 8cs, 3cs
  const loop = 3 // -> numPlaysToRepeat(3) = 2 -> NETSCAPE loop count 2

  const frameOpaqueRed = makeSolidFrame(width, height, 255, 0, 0)
  // Pixel 0 fully transparent, the other three opaque green -- exercises the
  // transparentIndex -> alpha0 path (Path A full-frame transparent coverage).
  const frameWithTransparency = makeRgbaFrame(width, height, [
    [0, 0, 0, 0],
    [0, 255, 0, 255],
    [0, 255, 0, 255],
    [0, 255, 0, 255],
  ])
  const frameOpaqueBlue = makeSolidFrame(width, height, 0, 0, 255)

  const input: GifEncodeInput = {
    frames: [frameOpaqueRed, frameWithTransparency, frameOpaqueBlue],
    delaysMs,
    loop,
  }
  const bytes = encodeGif(input)

  const wire = parseGif(bytes)
  const gifuctFrames = decompressFrames(gifuctParseGIF(toArrayBuffer(bytes)), true)

  it('gif-reader (wire): frame count, raw NETSCAPE loop count, and trailer match what was written', () => {
    expect(wire.header).toBe('GIF89a')
    expect(wire.frameCount).toBe(3)
    expect(wire.hasValidTrailer).toBe(true)
    expect(wire.loopCount).toBe(numPlaysToRepeat(loop)) // 2
  })

  it('gif-reader (wire): every GCE has disposal=2 and the raw centisecond delay matches delaysMs/10', () => {
    expect(wire.graphicControlExtensions).toHaveLength(3)
    wire.graphicControlExtensions.forEach((gce, i) => {
      expect(gce.disposalMethod).toBe(2)
      expect(gce.delayCentiseconds).toBe(delaysMs[i] / 10)
    })
    expect(wire.graphicControlExtensions[0].transparentColorFlag).toBe(false)
    expect(wire.graphicControlExtensions[1].transparentColorFlag).toBe(true)
    expect(wire.graphicControlExtensions[2].transparentColorFlag).toBe(false)
  })

  it('gifuct: delay (ms) matches delaysMs and disposalType is forced to 2 on every frame', () => {
    expect(gifuctFrames).toHaveLength(3)
    gifuctFrames.forEach((frame, i) => {
      expect(frame.delay).toBe(delaysMs[i])
      expect(frame.disposalType).toBe(2)
    })
  })

  it('gifuct: patch alpha is 0 exactly at the transparent pixel and 255 elsewhere', () => {
    const patch = gifuctFrames[1].patch
    // pixel 0 -> alpha byte at index 3
    expect(patch[3]).toBe(0)
    // pixels 1-3 -> alpha bytes at indices 7, 11, 15
    expect(patch[7]).toBe(255)
    expect(patch[11]).toBe(255)
    expect(patch[15]).toBe(255)
  })

  it('cross-library agreement: gif-reader transparentColorIndex === gifuct transparentIndex (same GCE bytes, two independent readers)', () => {
    expect(wire.graphicControlExtensions[1].transparentColorIndex).toBe(gifuctFrames[1].transparentIndex)
  })
})

describe('0cs pin (SP-2): gifuct rewrites a literal 0-centisecond delay to 100ms', () => {
  // encodeGif always floors delaysMs to MIN_DELAY_MS=20 (2cs) before handing
  // off to gifenc, so a *written* 0cs GIF can only be produced by calling
  // gifenc's GIFEncoder directly (bypassing encodeGif's own normalization) --
  // this pins gifuct's own fallback behavior, not anything this project's
  // code does.
  function encodeSingleFrame(delayMs: number): Uint8Array {
    const rgba = makeSolidFrame(2, 2, 10, 20, 30).data
    const palette = quantize(rgba, 256)
    const index = applyPalette(rgba, palette)
    const gif = GIFEncoder()
    gif.writeFrame(index, 2, 2, { palette, delay: delayMs })
    gif.finish()
    return gif.bytes()
  }

  it('0ms in (0cs on the wire) decodes as 100ms, not 0ms', () => {
    const bytes = encodeSingleFrame(0)
    expect(parseGif(bytes).graphicControlExtensions[0].delayCentiseconds).toBe(0)
    const frame = decompressFrames(gifuctParseGIF(toArrayBuffer(bytes)), true)[0]
    expect(frame.delay).toBe(100) // (gce.delay=0 || 10) * 10
  })

  it('side note: 1cs is NOT rewritten -- decodes as exactly 10ms (contrast with the 0cs case above; browsers may separately clamp very low delays in playback, which is out of scope here)', () => {
    const bytes = encodeSingleFrame(10) // Math.round(10/10) = 1cs
    expect(parseGif(bytes).graphicControlExtensions[0].delayCentiseconds).toBe(1)
    const frame = decompressFrames(gifuctParseGIF(toArrayBuffer(bytes)), true)[0]
    expect(frame.delay).toBe(10) // (gce.delay=1 || 10) * 10 -- 1 is truthy, so no rewrite
  })
})

describe('loop extraction (SP-3 (internal design doc) §4a): three-branch semantics', () => {
  function encodeLoopOnly(loop: number): Uint8Array {
    const rgba = makeSolidFrame(2, 2, 1, 2, 3).data
    const palette = quantize(rgba, 256)
    const index = applyPalette(rgba, palette)
    const gif = GIFEncoder()
    gif.writeFrame(index, 2, 2, { palette, delay: 100, repeat: numPlaysToRepeat(loop) })
    gif.finish()
    return gif.bytes()
  }

  it('NETSCAPE loop count 0 -> loop 0 (infinite)', () => {
    const bytes = encodeLoopOnly(0)
    expect(parseGif(bytes).loopCount).toBe(0)
    expect(extractLoopCount(bytes)).toBe(0)
  })

  it('no NETSCAPE extension (numPlays 1) -> loop 1 (single play)', () => {
    const bytes = encodeLoopOnly(1)
    expect(parseGif(bytes).loopCount).toBeUndefined()
    expect(extractLoopCount(bytes)).toBe(1)
  })

  it('NETSCAPE loop count n (n>0) -> loop n+1', () => {
    const bytes = encodeLoopOnly(5)
    expect(parseGif(bytes).loopCount).toBe(4)
    expect(extractLoopCount(bytes)).toBe(5)
  })

  it('roundtrip symmetry: extractLoopCount(encodeGif({ loop: n })) === n for representative n', () => {
    for (const n of [0, 1, 2, 5, 100]) {
      const input: GifEncodeInput = { frames: [makeSolidFrame(1, 1, 9, 9, 9)], delaysMs: [100], loop: n }
      expect(extractLoopCount(encodeGif(input))).toBe(n)
    }
  })
})

describe('loop extraction method comparison (SP-3): gifuct application-ext walk vs gif-reader agree on gifenc output', () => {
  // Method (a), inlined here for comparison only (production code lives in
  // ./netscape-loop.ts and uses gifuct-js exclusively -- see its doc comment
  // for the full decision writeup). Method (b) piggybacks on gif-reader.ts's
  // already-verified NETSCAPE parsing.
  function viaGifReader(bytes: Uint8Array): number {
    try {
      const loopCount = parseGif(bytes).loopCount
      if (loopCount === undefined) return 1
      return loopCount === 0 ? 0 : loopCount + 1
    } catch {
      return 1
    }
  }

  it('both methods agree for loop 0, 1 (omitted), and n on gifenc-produced bytes', () => {
    for (const n of [0, 1, 2, 5, 100]) {
      const input: GifEncodeInput = { frames: [makeSolidFrame(1, 1, 4, 5, 6)], delaysMs: [100], loop: n }
      const bytes = encodeGif(input)
      expect(extractLoopCount(bytes)).toBe(viaGifReader(bytes))
      expect(extractLoopCount(bytes)).toBe(n)
    }
  })
})

describe('loop extraction robustness (SP-3): comment / plain-text / private application ext + trailing garbage', () => {
  const width = 1
  const height = 1
  const loop = 7 // -> repeat 6 -> NETSCAPE loop count 6

  /**
   * Builds a real 2-frame gifenc GIF, then splices extra extension blocks in
   * between frame 0 and frame 1, plus trailing garbage after the trailer.
   *
   * The splice point is obtained by snapshotting the encoder's own output
   * right after frame 0 is written (before frame 1), rather than scanning
   * the finished byte stream for a separator byte -- LZW-compressed pixel
   * data can legitimately contain any byte value, including ones that look
   * like block introducers, so scanning would be unsound.
   */
  function buildUnusualButValidGif(extraBlocks: number[][]): Uint8Array {
    const rgba0 = makeSolidFrame(width, height, 10, 10, 10).data
    const rgba1 = makeSolidFrame(width, height, 20, 20, 20).data
    const palette0 = quantize(rgba0, 256)
    const palette1 = quantize(rgba1, 256)
    const index0 = applyPalette(rgba0, palette0)
    const index1 = applyPalette(rgba1, palette1)

    const gif = GIFEncoder()
    gif.writeFrame(index0, width, height, { palette: palette0, delay: 50, dispose: 2, repeat: numPlaysToRepeat(loop) })
    // Safe snapshot (bytes() copies) of everything up to and not including
    // frame 1: header + LSD + GCT + NETSCAPE ext + frame 0's GCE + image.
    const prefix = gif.bytes()

    gif.writeFrame(index1, width, height, { palette: palette1, delay: 50, dispose: 2 })
    gif.finish()
    const full = gif.bytes()
    const frame1PlusTrailer = full.slice(prefix.length)

    const trailingGarbage = [0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]

    return concatBytes(prefix, ...extraBlocks, frame1PlusTrailer, trailingGarbage)
  }

  // Shaped like NETSCAPE's own `[subBlockId, lo, hi]` loop sub-block, but
  // under the wrong application id -- proves the id check actually gates it
  // rather than matching on sub-block shape alone.
  const decoyLoopLookingPayload = [0x01, 0xab, 0xcd]

  it('comment ext + private application ext (decoy loop-shaped payload) + trailing garbage: does not throw, extracts the correct loop count', () => {
    const bytes = buildUnusualButValidGif([
      commentExtensionBytes('hello'),
      privateApplicationExtensionBytes('PRIVATEAPP1', decoyLoopLookingPayload),
    ])
    expect(() => extractLoopCount(bytes)).not.toThrow()
    expect(extractLoopCount(bytes)).toBe(loop)

    // Corroborates gifuct-js itself: it doesn't throw on these interposed
    // blocks either, and still decodes both real frames -- the decoys are
    // neither GCE nor image blocks so they don't disturb frame decoding.
    const frames = decompressFrames(gifuctParseGIF(toArrayBuffer(bytes)), true)
    expect(frames).toHaveLength(2)
  })

  it('plain text ext additionally spliced in: gifuct-js itself throws (upstream parser bug), so extractLoopCount safely degrades to loop=1 instead of throwing', () => {
    const bytes = buildUnusualButValidGif([
      commentExtensionBytes('hello'),
      plainTextExtensionBytes('x'),
      privateApplicationExtensionBytes('PRIVATEAPP1', decoyLoopLookingPayload),
    ])

    // js-binary-schema-parser's bundled GIF schema (gifuct-js's parser
    // backbone) has a genuine bug in its Plain Text Extension branch --
    // `textSchema`'s `preData` reader does `parent.text.blockSize` where
    // `parent` is *already* the `text` sub-object (every other block type in
    // the same schema file correctly uses `parent.blockSize`), so
    // `parent.text` is `undefined` and reading `.blockSize` off it throws.
    // Real-world encoders essentially never emit Plain Text extensions
    // (a vestigial, unused GIF89a feature), which is presumably why this has
    // gone unnoticed, but it means gifuct-js's `parseGIF` is NOT
    // unconditionally throw-free on spec-valid input.
    expect(() => gifuctParseGIF(toArrayBuffer(bytes))).toThrow(/blockSize/)

    // This is exactly why netscape-loop.ts's extractLoopCount wraps its
    // parseGIF call in try/catch: the safe-degrade contract (PLAN.md §4a)
    // isn't just defensive boilerplate, it's load-bearing for this real
    // upstream bug. Note also that decode.ts's *pixel* decoding is equally
    // dependent on gifuct-js's parseGIF/decompressFrames regardless of which
    // method loop-extraction uses -- a file that trips this bug would fail
    // frame decoding too, so extractLoopCount sharing gifuct-js's parser
    // does not introduce any fragility beyond what decode.ts already has.
    expect(() => extractLoopCount(bytes)).not.toThrow()
    expect(extractLoopCount(bytes)).toBe(1)
  })
})

describe('loop extraction safe degrade (SP-3 required branch): parse failure never throws, always falls back to loop=1', () => {
  it('empty input', () => {
    expect(() => extractLoopCount(new Uint8Array(0))).not.toThrow()
    expect(extractLoopCount(new Uint8Array(0))).toBe(1)
  })

  it('too-short/truncated input', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46]) // "GIF", nothing else
    expect(() => extractLoopCount(bytes)).not.toThrow()
    expect(extractLoopCount(bytes)).toBe(1)
  })

  it('non-GIF random bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(() => extractLoopCount(bytes)).not.toThrow()
    expect(extractLoopCount(bytes)).toBe(1)
  })

  it('a completely invalid runtime value (defensive: proves the try/catch itself, not just gifuct-js leniency, engages)', () => {
    const notBytes = null as unknown as Uint8Array
    expect(() => extractLoopCount(notBytes)).not.toThrow()
    expect(extractLoopCount(notBytes)).toBe(1)
  })
})
