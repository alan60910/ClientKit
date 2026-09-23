/**
 * GIF decoding for tools/gif-editor ((internal design doc) §4a/§4b):
 * gifuct-js wraps pixel decoding, `./netscape-loop.js` (T2.2) extracts the
 * NETSCAPE2.0 loop count, and `../../src/lib/composite.js` (shared with
 * apng-to-gif) performs full-frame compositing so downstream editing
 * (edit.ts) never has to reason about GIF disposal semantics at all -- every
 * frame `decodeGif` returns is already a complete, independently-editable
 * canvas snapshot.
 *
 * No DOM/runtime imports: gifuct-js is pure JS, so this whole module (unlike
 * apng-to-gif/decode.ts's browser-only pixel extraction) is node-testable.
 */
import { parseGIF, decompressFrames } from 'gifuct-js'
import type { ParsedFrame, ParsedGif } from 'gifuct-js'
import {
  BLEND_OP_OVER,
  DISPOSE_OP_BACKGROUND,
  DISPOSE_OP_NONE,
  DISPOSE_OP_PREVIOUS,
  composite,
  createTransparentCanvas,
  type RGBAFrame,
} from '../../src/lib/composite.js'
import { extractLoopCount } from './netscape-loop.js'

const GIF87A_SIGNATURE = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) // "GIF87a"
const GIF89A_SIGNATURE = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61) // "GIF89a"

function matchesSignature(bytes: Uint8Array, signature: Uint8Array): boolean {
  return bytes.length >= signature.length && signature.every((expected, i) => bytes[i] === expected)
}

/** Throws with a UI-displayable message if `bytes` doesn't start with a GIF87a/GIF89a signature. */
export function assertGifMagicBytes(bytes: Uint8Array): void {
  if (!matchesSignature(bytes, GIF87A_SIGNATURE) && !matchesSignature(bytes, GIF89A_SIGNATURE)) {
    throw new Error('不是 GIF 檔案：缺少有效的 GIF 檔頭簽章（magic bytes）')
  }
}

/**
 * GIF disposalType (the raw 3-bit GCE field, 0-7; gifuct-js passes it through
 * undisturbed, `undefined` when a frame has no GCE at all) -> composite.ts's
 * DisposeOp. **Deliberately not a passthrough** (PLAN.md §「全幀合成」): GIF's
 * own disposal value 2 ("restore to background") numerically collides with
 * composite.ts's `DISPOSE_OP_PREVIOUS` (also 2, an APNG-derived enum with no
 * relation to GIF's numbering) -- and GIF's disposal 3 ("restore to
 * previous") has no matching value in composite's domain at all. Feeding raw
 * GIF disposal numbers straight into `composite()`'s `disposeOp` would
 * silently misinterpret 2 as "restore previous" and leave 3 unrecognized
 * (falling through to "no action").
 *
 * GIF89a's disposal 2 is documented as "restore to background color", but
 * mainstream browsers uniformly clear that rect to *transparent* instead of
 * literally repainting a background color -- composite's BACKGROUND
 * (clear-to-transparent) deliberately matches that browser behavior, not the
 * spec's literal wording.
 *
 * disposal 4-7 are reserved/undefined by the GIF89a spec; treated the same as
 * "no disposal specified" (0/1/undefined) -- DISPOSE_OP_NONE.
 */
export function gifDisposalToComposite(gifDisposal: number | undefined, isFirstFrame: boolean): number {
  if (gifDisposal === 2) return DISPOSE_OP_BACKGROUND
  if (gifDisposal === 3) return isFirstFrame ? DISPOSE_OP_BACKGROUND : DISPOSE_OP_PREVIOUS
  return DISPOSE_OP_NONE
}

/** Delay (ms) assigned to a frame gifuct-js reports with no GCE at all (`delay` is `undefined`, not `0`). */
export const NO_GCE_DEFAULT_DELAY_MS = 100

/**
 * gifuct-js already normalizes a literal 0-centisecond delay to 100ms
 * internally (`(gce.delay || 10) * 10`, PLAN.md「已查證事實」) -- this only
 * covers the separate no-GCE case, where `frame.delay` itself is `undefined`.
 * Uses `??` (not `||`) so a genuine `0` would pass through unchanged rather
 * than being reinterpreted as "missing" (defensive: gifuct-js's own formula
 * never actually produces a numeric `0`, only `undefined` or values >= 10).
 */
export function normalizeGifuctFrameDelayMs(delay: number | undefined): number {
  return delay ?? NO_GCE_DEFAULT_DELAY_MS
}

export interface DecodedGif {
  width: number
  height: number
  /** Already fully composited: each entry is a standalone, independently-editable canvas snapshot. */
  frames: RGBAFrame[]
  delaysMs: number[]
  /** numPlays semantics (0 = infinite, n = play n times total); see ./netscape-loop.ts. */
  loop: number
}

/**
 * gifuct-js's shipped type for `parseGIF` demands an `ArrayBuffer`;
 * `decodeGif`'s callers naturally hold a `Uint8Array`. Copies into a
 * freshly-sized `ArrayBuffer` rather than handing over `bytes.buffer` as-is,
 * since that is unsafe when `bytes` is a view that doesn't start at byte 0 or
 * span the whole underlying buffer.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

/**
 * Memory gate estimate (PLAN.md §5「記憶體警示閘」), used by main.ts before
 * committing to the costly synchronous `decodeGif` call: parses only GIF
 * metadata (LSD dimensions + a frame count) via gifuct-js's `parseGIF`,
 * deliberately never calling the expensive `decompressFrames` -- this must
 * stay cheap even for huge files, since it runs *before* the user has
 * confirmed they want to proceed. Frames are counted by the presence of an
 * `image` block: gifuct-js's raw parse tree also lists non-image "frames" for
 * extension blocks (e.g. NETSCAPE2.0), which `decodeGif`'s real frame count
 * -- and thus its real memory cost -- never includes.
 */
export function estimateDecodedByteSize(bytes: Uint8Array): number {
  const parsed = parseGIF(toArrayBuffer(bytes))
  const frameCount = parsed.frames.filter((frame) => 'image' in frame).length
  return parsed.lsd.width * parsed.lsd.height * 4 * frameCount
}

/**
 * gifuct-js's `parseGIF`/`decompressFrames` can throw on malformed input --
 * and, per a known upstream limitation (see ./netscape-loop.ts's doc
 * comment), even on certain spec-valid GIFs containing a Plain Text
 * Extension. Wrapped here into a single UI-displayable error so `decodeGif`
 * never surfaces a raw js-binary-schema-parser exception to callers.
 */
function decodeGifuctFrames(bytes: Uint8Array): { parsedGif: ParsedGif; frames: ParsedFrame[] } {
  try {
    const parsedGif = parseGIF(toArrayBuffer(bytes))
    const frames = decompressFrames(parsedGif, true)
    return { parsedGif, frames }
  } catch (cause) {
    throw new Error('GIF 檔案已損壞或格式不受支援，無法解析', { cause })
  }
}

/**
 * Full decode pipeline: magic-byte gate -> gifuct-js parse/decompress ->
 * per-frame full-canvas compositing (§4a/§4b) -> NETSCAPE loop extraction.
 * Node-testable end to end (no DOM/runtime imports).
 */
export function decodeGif(bytes: Uint8Array): DecodedGif {
  assertGifMagicBytes(bytes)

  const { parsedGif, frames: gifuctFrames } = decodeGifuctFrames(bytes)
  const width = parsedGif.lsd.width
  const height = parsedGif.lsd.height

  let canvasState = createTransparentCanvas(width, height)
  const frames: RGBAFrame[] = []
  const delaysMs: number[] = []

  gifuctFrames.forEach((frame, index) => {
    const isFirstFrame = index === 0
    // gifuct's patch is already the per-pixel binary-alpha (0/255) RGBA
    // raster for just this frame's own rect (not the full canvas) -- BLEND_OP_OVER
    // reduces to a plain overwrite wherever it's opaque and a no-op wherever
    // it's transparent, which is exactly GIF's compositing rule.
    const patch: RGBAFrame = { data: frame.patch, width: frame.dims.width, height: frame.dims.height }
    const { displayed, next } = composite(canvasState, patch, {
      left: frame.dims.left,
      top: frame.dims.top,
      disposeOp: gifDisposalToComposite(frame.disposalType, isFirstFrame),
      blendOp: BLEND_OP_OVER,
      isFirstFrame,
    })
    frames.push(displayed)
    delaysMs.push(normalizeGifuctFrameDelayMs(frame.delay))
    canvasState = next
  })

  return { width, height, frames, delaysMs, loop: extractLoopCount(bytes) }
}
