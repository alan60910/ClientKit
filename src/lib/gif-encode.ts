/**
 * Shared GIF encoding pipeline ((internal design doc) §3: "重新編碼——
 * 抽取邊界"): turns a decoded, already-composited animation (frames +
 * per-frame delay + loop count) into GIF bytes via `gifenc`. Originally
 * `tools/apng-to-gif/convert.ts` ((internal design doc)); promoted to
 * `src/lib/` so gif-editor can reuse the exact same write-frame loop and
 * transparency handling instead of re-deriving this correctness-sensitive
 * skeleton a second time. `tools/apng-to-gif/convert.ts` is now a thin
 * re-export layer over this module.
 *
 * Pure and DOM/Node-free at the top level (only imports `gifenc`), so this
 * runs unchanged in node (vitest), a Web Worker, or the main thread.
 *
 * Transparency path: T1.4 spike S2 decided **Path A** (manual alpha
 * threshold + matte compositing, with a *reserved* transparent palette index
 * assigned by direct override rather than nearest-neighbor guessing) over
 * gifenc's built-in `oneBitAlpha`/`clearAlphaColor` (Path B), which was
 * empirically shown to misroute a fully-transparent pixel to a visually
 * similar *opaque* palette entry when the two colors are close in combined
 * alpha+RGB euclidean distance. See (internal design doc) and
 * gif-reader.ts's `loopCount` doc comment for the full spike write-ups.
 */
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import type { GifencColor, GifencPalette, WriteFrameOptions } from 'gifenc'
import type { RGBAFrame } from './composite.js'

export type { RGBAFrame }

export interface GifEncodeInput {
  frames: RGBAFrame[]
  delaysMs: number[]
  /** numPlays semantics: 0 = infinite, n (n>=1) = play n times total. */
  loop: number
}

export interface GifEncodeOptions {
  /** Alpha (0-255) below this value becomes fully transparent. Default 128. */
  alphaThreshold?: number
  /** Background used to matte pixels at/above the threshold. Default white. */
  matteColor?: [number, number, number]
  /** Max palette colors per frame, 2-256. Default 256. */
  maxColors?: number
  /**
   * Called synchronously right after each frame has been written to the GIF
   * stream, with `index` (0-based position of the frame just finished, i.e.
   * strictly increasing 0, 1, 2, ...) and `total` (== input.frames.length,
   * constant across all calls). Pure/DOM-free -- gif-encode.ts never touches
   * progress UI itself; callers (encode.worker.ts, or the main-thread
   * fallback) translate this into whatever "n/N" or percentage display they
   * need.
   */
  onFrameEncoded?: (index: number, total: number) => void
}

export interface NormalizedGifEncodeOptions {
  alphaThreshold: number
  matteColor: [number, number, number]
  maxColors: number
}

export const DEFAULT_ALPHA_THRESHOLD = 128
export const DEFAULT_MATTE_COLOR: [number, number, number] = [255, 255, 255]
export const DEFAULT_MAX_COLORS = 256
/** GIF delay is 1/100s; viewers commonly treat <2cs (<20ms) as 10cs, so floor at 20ms (PLAN.md). */
export const MIN_DELAY_MS = 20
/** Lower bound kept at 2 so a reserved transparent slot (T1.4 decision) always fits alongside >=1 real color. */
const MIN_MAX_COLORS = 2
const MAX_MAX_COLORS = 256

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max)
}

/**
 * Option normalization: any missing/non-finite/out-of-range input falls back
 * to its default (scalars) or is clamped into range (ranged values), so
 * `encodeGif` never has to special-case invalid caller input downstream.
 */
export function normalizeGifEncodeOptions(opts: GifEncodeOptions | undefined): NormalizedGifEncodeOptions {
  const rawThreshold = opts?.alphaThreshold
  const alphaThreshold = Number.isFinite(rawThreshold)
    ? clampInt(rawThreshold as number, 0, 255)
    : DEFAULT_ALPHA_THRESHOLD

  const rawMatte = opts?.matteColor
  const matteColor: [number, number, number] =
    rawMatte && rawMatte.length === 3 && rawMatte.every((channel) => Number.isFinite(channel))
      ? [clampInt(rawMatte[0], 0, 255), clampInt(rawMatte[1], 0, 255), clampInt(rawMatte[2], 0, 255)]
      : DEFAULT_MATTE_COLOR

  const rawMaxColors = opts?.maxColors
  const maxColors = Number.isFinite(rawMaxColors)
    ? clampInt(rawMaxColors as number, MIN_MAX_COLORS, MAX_MAX_COLORS)
    : DEFAULT_MAX_COLORS

  return { alphaThreshold, matteColor, maxColors }
}

/**
 * Clamp a per-frame delay to gifenc's millisecond input contract. Any
 * non-finite (undefined/NaN/Infinity) or sub-floor value collapses to the
 * 20ms floor -- there is no meaningful "faster than 20ms" GIF frame, so
 * invalid input is treated the same as "too fast" rather than rejected.
 */
export function normalizeDelayMs(delayMs: number | undefined): number {
  if (!Number.isFinite(delayMs)) return MIN_DELAY_MS
  return Math.max(delayMs as number, MIN_DELAY_MS)
}

/**
 * APNG `numPlays` (n = desired TOTAL play count, 0 = infinite) -> gifenc
 * `writeFrame({ repeat })` mapping. Decision + evidence: T1.3 spike S1,
 * documented in full at ./gif-reader.ts (`ParsedGif.loopCount`).
 *   numPlays 0       -> repeat  0  (infinite)
 *   numPlays 1       -> repeat -1  (omit NETSCAPE ext entirely -> single play;
 *                                    repeat 0 would mean infinite, not once)
 *   numPlays n (n>1) -> repeat n-1 (NETSCAPE2.0's documented "+1" convention)
 * Non-finite or negative input (should not happen from a well-formed
 * GifEncodeInput, but decode.ts is a parallel lane) is treated as 0
 * (infinite) -- the same safe default APNG itself uses for an absent/invalid
 * numPlays, rather than producing a malformed loop count.
 */
export function numPlaysToRepeat(numPlays: number): number {
  const normalized = Number.isFinite(numPlays) && numPlays >= 0 ? Math.round(numPlays) : 0
  if (normalized === 0) return 0
  if (normalized === 1) return -1
  return normalized - 1
}

/** Alpha-weighted composite of one pixel against an opaque matte color. */
export function blendWithMatte(
  r: number,
  g: number,
  b: number,
  a: number,
  matte: [number, number, number],
): [number, number, number] {
  const t = a / 255
  return [
    Math.round(r * t + matte[0] * (1 - t)),
    Math.round(g * t + matte[1] * (1 - t)),
    Math.round(b * t + matte[2] * (1 - t)),
  ]
}

/**
 * Search for an RGB triple absent from `palette`. Palette has at most 255
 * entries here (one slot is always reserved before calling this) against a
 * 256^3 color space, so a free triple is always found; the loop below is a
 * plain brute-force scan since T1.4's own PoC found no need to optimize it
 * ("未用 RGB 掃描不需優化，除非實測必要").
 */
function findUnusedColor(palette: GifencPalette): GifencColor {
  const used = new Set(palette.map((color) => `${color[0]},${color[1]},${color[2]}`))
  for (let r = 0; r < 256; r++) {
    for (let g = 0; g < 256; g++) {
      for (let b = 0; b < 256; b++) {
        const key = `${r},${g},${b}`
        if (!used.has(key)) return [r, g, b]
      }
    }
  }
  /* c8 ignore next */
  throw new Error('encodeGif: no unused RGB triple available to reserve for transparency (palette is full)')
}

export interface QuantizedFrame {
  index: Uint8Array
  palette: GifencPalette
  hasTransparent: boolean
  /** Palette index reserved for transparency; -1 when hasTransparent is false. */
  reservedIndex: number
}

/**
 * Path A (T1.4 decision) applied to a single frame: matte-composite every
 * pixel, quantize the now-fully-opaque result, then -- for pixels whose
 * original alpha was below `alphaThreshold` -- directly overwrite their
 * index with a reserved, provably-unused palette slot. Exported (beyond what
 * `encodeGif` strictly needs) so this step can be unit-tested in isolation
 * against adversarial fixtures without needing a GIF/LZW pixel decoder
 * (PLAN.md「純邏輯...可在 node 測試」).
 */
export function quantizeFrameToIndexedBitmap(
  frame: RGBAFrame,
  alphaThreshold: number,
  matteColor: [number, number, number],
  maxColors: number,
): QuantizedFrame {
  const pixelCount = frame.width * frame.height
  const mask = new Uint8Array(pixelCount)
  const composite = new Uint8Array(pixelCount * 4)

  for (let i = 0; i < pixelCount; i++) {
    const r = frame.data[i * 4]
    const g = frame.data[i * 4 + 1]
    const b = frame.data[i * 4 + 2]
    const a = frame.data[i * 4 + 3]
    if (a < alphaThreshold) mask[i] = 1
    const [br, bg, bb] = blendWithMatte(r, g, b, a, matteColor)
    composite[i * 4] = br
    composite[i * 4 + 1] = bg
    composite[i * 4 + 2] = bb
    composite[i * 4 + 3] = 255
  }

  const hasTransparent = mask.includes(1)
  // Reserve one palette slot only when this frame actually needs it, so
  // frames without transparency keep the full color budget (T1.4 self-note).
  const quantizeBudget = hasTransparent ? Math.max(1, maxColors - 1) : maxColors
  const palette = quantize(composite, quantizeBudget)
  const index = applyPalette(composite, palette)

  let reservedIndex = -1
  if (hasTransparent) {
    reservedIndex = palette.length
    palette.push(findUnusedColor(palette))
    for (let i = 0; i < pixelCount; i++) {
      if (mask[i]) index[i] = reservedIndex
    }
  }

  return { index, palette, hasTransparent, reservedIndex }
}

/**
 * Encode a decoded, composited animation as GIF bytes.
 *
 * Every frame is written as a full-canvas snapshot (no partial-rect delta
 * encoding in v1) with GCE disposal forced to 2 (restore to background) on
 * every frame. Rationale: a GIF's transparent pixels are literal holes that
 * reveal whatever the *preceding* frame's disposal left behind, not a fresh
 * background -- with disposal 0/1 ("no action"/"do not dispose"), a later
 * frame's transparent regions would show the previous full-canvas frame's
 * opaque content bleeding through ("ghosting"). Since every frame here is a
 * complete redraw, forcing disposal 2 uniformly guarantees each frame's own
 * transparent holes render as a clean background instead of stale pixels
 * from whatever frame came before it, regardless of which frames do or don't
 * contain transparency.
 */
export function encodeGif(input: GifEncodeInput, opts?: GifEncodeOptions): Uint8Array {
  if (input.frames.length === 0) {
    throw new Error('encodeGif: animation must contain at least one frame')
  }

  const { alphaThreshold, matteColor, maxColors } = normalizeGifEncodeOptions(opts)
  const repeat = numPlaysToRepeat(input.loop)
  const gif = GIFEncoder()

  input.frames.forEach((frame, frameIndex) => {
    const { index, palette, hasTransparent, reservedIndex } = quantizeFrameToIndexedBitmap(
      frame,
      alphaThreshold,
      matteColor,
      maxColors,
    )
    const delay = normalizeDelayMs(input.delaysMs[frameIndex])

    const writeOptions: WriteFrameOptions = {
      palette,
      delay,
      dispose: 2,
      transparent: hasTransparent,
    }
    if (hasTransparent) writeOptions.transparentIndex = reservedIndex
    // gifenc only consults `repeat` while writing the first frame (it drives
    // the once-per-stream NETSCAPE extension) -- passing it on later frames
    // would be silently ignored, so it is only included here.
    if (frameIndex === 0) writeOptions.repeat = repeat

    gif.writeFrame(index, frame.width, frame.height, writeOptions)
    opts?.onFrameEncoded?.(frameIndex, input.frames.length)
  })

  gif.finish()
  return gif.bytes()
}
