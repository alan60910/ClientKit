/**
 * Hand-written GIF89a fixture builder for tools/gif-editor.
 *
 * PLAN.md SP-4 (blocking, decode.ts prerequisite) context: gifenc's
 * `writeFrame` always writes a full-canvas frame at (0,0) (source-verified,
 * see PLAN.md「已查證事實」), so it cannot produce fixtures with non-zero
 * frame offsets or per-frame disposal methods other than what convert.ts
 * hard-codes. Those fixtures -- required to test decode.ts's
 * `gifDisposalToComposite` mapping and frame-region compositing -- must be
 * hand-built at the byte level, which means hand-rolling GIF's LZW image
 * data (Node has no built-in LZW codec, unlike the DEFLATE `node:zlib` the
 * APNG fixture builder gets to reuse).
 *
 * Approach: an "uncompressed LZW" variant -- every emitted code is a
 * literal root/palette-index code (single pixel, never a multi-pixel
 * dictionary match), and a Clear Code is re-emitted just before the
 * decoder's *implicit* dictionary would need a wider code than the fixed
 * `minCodeSize + 1` bits this encoder always writes at. This produces a
 * spec-compliant GIF LZW byte stream without implementing an actual LZW
 * compressor. See `encodeUncompressedLzw` below for the periodic-clear
 * derivation. Validated by decoding every fixture back with gifuct-js
 * (`generate.test.ts`) and cross-checking wire-level fields (frame count,
 * GCE, NETSCAPE loop) with `src/lib/gif-reader.ts`.
 *
 * `buildGif` itself is a pure function (bytes in, bytes out, no Node
 * imports) so it is usable from any test environment. Only the "write
 * sample-edit.gif to disk" step at the bottom of this file uses `node:fs`,
 * and only runs when this file is executed directly -- not when
 * `generate.test.ts` imports `buildGif`/`buildSampleEditGif` from it.
 *
 * Regenerate with (Node >=22, runs via built-in TS type-stripping):
 *   node tools/gif-editor/fixtures/generate.ts
 *
 * `buildSampleEditGif()` is deterministic (no timestamps/randomness) --
 * re-running it must produce a byte-identical file (pinned by
 * generate.test.ts's byte-stability check against the checked-in file).
 *
 * sample-edit.gif ground truth (must match hard-coded expectations in
 * generate.test.ts):
 *   canvas: 4x4, 4-color GCT, loop (raw NETSCAPE wire value): 3
 *   frame 0: left=0, top=0, width=4, height=4, delay 15cs, disposal 0
 *   frame 1: left=1, top=2, width=2, height=1, delay 37cs, disposal 3
 * Deliberately discriminating choices (so a swapped-field bug can't hide):
 *   - frame 1's left(1) != top(2), and width(2) != height(1) -- a bug that
 *     swaps left/top or width/height can't coincidentally read back correct.
 *   - frame 0's disposal(0) != frame 1's disposal(3) -- a bug that applies
 *     one frame's disposal to the other frame can't hide behind equal values.
 *   - delays (15cs, 37cs) are distinct from each other and from every other
 *     numeric field in this fixture.
 *   - the GCT has exactly 4 colors (minCodeSize 2, the GIF-mandated floor),
 *     which forces `encodeUncompressedLzw`'s periodic Clear Code path to
 *     fire repeatedly within a single 16-pixel frame (clear every 2 codes,
 *     see derivation below) -- this is the actual multi-clear-per-frame
 *     case, not just a single-clear toy example.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// ---- byte helpers (pure) ----

function u16le(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff)
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

// ---- LZW bit packing (GIF packs codes LSB-first into bytes) ----

class LzwBitWriter {
  private bytes: number[] = []
  private bitBuffer = 0
  private bitCount = 0

  writeCode(code: number, size: number): void {
    this.bitBuffer |= code << this.bitCount
    this.bitCount += size
    while (this.bitCount >= 8) {
      this.bytes.push(this.bitBuffer & 0xff)
      this.bitBuffer >>= 8
      this.bitCount -= 8
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer & 0xff)
    }
    return Uint8Array.from(this.bytes)
  }
}

/**
 * Encodes pixel palette indices as a GIF LZW data stream using the
 * "uncompressed" variant described in the file header: every code is a
 * literal root code, and Clear Codes are re-emitted periodically so the
 * code width never needs to grow past `minCodeSize + 1` bits.
 *
 * Periodic-clear derivation: a standards-compliant GIF LZW decoder builds
 * an implicit dictionary even when every code it receives is a root code --
 * each code after the first following a Clear adds one 2-symbol dictionary
 * entry (since our encoder never emits a code equal to the decoder's
 * `nextCode`, the decoder always takes its "code < nextCode" branch, so
 * this holds exactly). So after k codes since the last Clear (k>=1),
 * nextCode = clearCode + 1 + k. Requiring nextCode <= 2^codeSize - 1 for
 * codeSize = minCodeSize+1 (so the code width never grows) gives:
 *   k <= 2^codeSize - 2 - clearCode = 2*clearCode - 2 - clearCode
 *      = clearCode - 2 = 2^minCodeSize - 2
 * So a Clear Code must be re-emitted at least every `2^minCodeSize - 2`
 * literal codes. This is always >= 1 because GIF mandates minCodeSize >= 2.
 */
export function encodeUncompressedLzw(pixelIndices: readonly number[], minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  const codeSize = minCodeSize + 1
  const maxCodesPerClear = (1 << minCodeSize) - 2

  const writer = new LzwBitWriter()
  writer.writeCode(clearCode, codeSize)
  let codesSinceClear = 0
  for (const index of pixelIndices) {
    if (codesSinceClear >= maxCodesPerClear) {
      writer.writeCode(clearCode, codeSize)
      codesSinceClear = 0
    }
    writer.writeCode(index, codeSize)
    codesSinceClear++
  }
  writer.writeCode(endCode, codeSize)
  return writer.finish()
}

const SUBBLOCK_MAX = 255

/** Splits an LZW byte stream into GIF's size-prefixed sub-blocks, terminated by a zero-length block. */
function toSubBlocks(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []
  for (let offset = 0; offset < data.length; offset += SUBBLOCK_MAX) {
    const chunk = data.subarray(offset, Math.min(offset + SUBBLOCK_MAX, data.length))
    parts.push(Uint8Array.of(chunk.length), chunk)
  }
  parts.push(Uint8Array.of(0x00))
  return concatBytes(parts)
}

// ---- color tables ----

export type RgbColor = readonly [number, number, number]

/** GIF color table "size field" N such that the table's actual entry count is 2^(N+1) >= entries. */
function colorTableSizeField(entries: number): number {
  let n = 0
  while (2 << n < entries) n++
  return n
}

function encodeColorTable(colors: readonly RgbColor[], sizeField: number): Uint8Array {
  const size = 2 << sizeField
  const out = new Uint8Array(size * 3)
  for (let i = 0; i < size; i++) {
    const [r, g, b] = colors[i] ?? [0, 0, 0]
    out[i * 3] = r
    out[i * 3 + 1] = g
    out[i * 3 + 2] = b
  }
  return out
}

// ---- blocks ----

function makeGraphicControlExtension(disposal: number, delayCs: number, transparentIndex: number | undefined): Uint8Array {
  const hasTransparency = transparentIndex !== undefined
  const packed = ((disposal & 0x07) << 2) | (hasTransparency ? 0x01 : 0)
  return concatBytes([
    Uint8Array.of(0x21, 0xf9, 0x04, packed),
    u16le(delayCs),
    Uint8Array.of(hasTransparency ? transparentIndex : 0),
    Uint8Array.of(0x00),
  ])
}

function makeImageDescriptor(left: number, top: number, width: number, height: number, lctSizeField: number | undefined): Uint8Array {
  const hasLct = lctSizeField !== undefined
  const packed = (hasLct ? 0x80 : 0) | (hasLct ? lctSizeField : 0)
  return concatBytes([Uint8Array.of(0x2c), u16le(left), u16le(top), u16le(width), u16le(height), Uint8Array.of(packed)])
}

function makeNetscapeLoopExtension(loopCount: number): Uint8Array {
  return concatBytes([
    Uint8Array.of(0x21, 0xff, 0x0b),
    Uint8Array.from('NETSCAPE2.0', (ch) => ch.charCodeAt(0)),
    Uint8Array.of(0x03, 0x01),
    u16le(loopCount),
    Uint8Array.of(0x00),
  ])
}

// ---- public builder API ----

export interface GifFrameSpec {
  left: number
  top: number
  width: number
  height: number
  /**
   * Delay (centiseconds) and disposal method for this frame's Graphic
   * Control Extension. Omit **both** to skip writing a GCE for this frame
   * entirely -- used to build a fixture exercising decode.ts's no-GCE
   * default-delay path (`normalizeGifuctFrameDelayMs(undefined)`), since
   * gifuct-js reports `delay`/`disposalType`/`transparentIndex` as
   * `undefined` for a frame with no GCE at all. Providing only one of the two
   * still writes a GCE, defaulting the other to 0.
   */
  delayCs?: number
  disposal?: number
  transparentIndex?: number
  /** Palette indices, row-major, length must equal width*height. */
  pixels: readonly number[]
  /** Per-frame local color table; when present, indices in `pixels` are looked up here instead of the GCT. */
  lct?: readonly RgbColor[]
}

export interface BuildGifOptions {
  width: number
  height: number
  gct: readonly RgbColor[]
  /** NETSCAPE2.0 loop count as written on the wire, or `null`/`undefined` to omit the extension entirely. */
  loop?: number | null
  frames: readonly GifFrameSpec[]
}

/** Builds a complete GIF89a file from frame specs. Pure: no I/O, no Node dependency. */
export function buildGif(opts: BuildGifOptions): Uint8Array {
  const gctSizeField = colorTableSizeField(opts.gct.length)
  const lsdPacked = 0x80 | ((gctSizeField & 0x07) << 4) | (gctSizeField & 0x07)

  const parts: Uint8Array[] = [
    Uint8Array.from('GIF89a', (ch) => ch.charCodeAt(0)),
    u16le(opts.width),
    u16le(opts.height),
    Uint8Array.of(lsdPacked),
    Uint8Array.of(0), // background color index
    Uint8Array.of(0), // pixel aspect ratio
    encodeColorTable(opts.gct, gctSizeField),
  ]

  if (opts.loop !== null && opts.loop !== undefined) {
    parts.push(makeNetscapeLoopExtension(opts.loop))
  }

  for (const frame of opts.frames) {
    const hasGce = frame.delayCs !== undefined || frame.disposal !== undefined
    if (hasGce) {
      parts.push(makeGraphicControlExtension(frame.disposal ?? 0, frame.delayCs ?? 0, frame.transparentIndex))
    }

    const lctSizeField = frame.lct ? colorTableSizeField(frame.lct.length) : undefined
    parts.push(makeImageDescriptor(frame.left, frame.top, frame.width, frame.height, lctSizeField))
    if (frame.lct && lctSizeField !== undefined) {
      parts.push(encodeColorTable(frame.lct, lctSizeField))
    }

    const applicableSizeField = frame.lct ? colorTableSizeField(frame.lct.length) : gctSizeField
    const minCodeSize = Math.max(2, applicableSizeField + 1)
    parts.push(Uint8Array.of(minCodeSize))
    parts.push(toSubBlocks(encodeUncompressedLzw(frame.pixels, minCodeSize)))
  }

  parts.push(Uint8Array.of(0x3b)) // trailer

  return concatBytes(parts)
}

// ---- sample-edit.gif (signed-in fixture; see ground truth in file header) ----

export const SAMPLE_GCT: readonly RgbColor[] = [
  [200, 30, 30],
  [30, 200, 30],
  [30, 30, 200],
  [220, 220, 40],
]

export const SAMPLE_LOOP = 3

export const SAMPLE_FRAME0: GifFrameSpec = {
  left: 0,
  top: 0,
  width: 4,
  height: 4,
  delayCs: 15,
  disposal: 0,
  pixels: [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2],
}

export const SAMPLE_FRAME1: GifFrameSpec = {
  left: 1,
  top: 2,
  width: 2,
  height: 1,
  delayCs: 37,
  disposal: 3,
  pixels: [3, 0],
}

export function buildSampleEditGif(): Uint8Array {
  return buildGif({
    width: 4,
    height: 4,
    gct: SAMPLE_GCT,
    loop: SAMPLE_LOOP,
    frames: [SAMPLE_FRAME0, SAMPLE_FRAME1],
  })
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

// Gated so importing `buildGif`/`buildSampleEditGif` from generate.test.ts never
// has the side effect of rewriting the checked-in fixture -- only running this
// file directly (`node tools/gif-editor/fixtures/generate.ts`) does.
if (isMainModule()) {
  const bytes = buildSampleEditGif()
  const outPath = resolve(import.meta.dirname, 'sample-edit.gif')
  writeFileSync(outPath, bytes)
  console.log(`wrote ${bytes.length} bytes to ${outPath}`)
}
