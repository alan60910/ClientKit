/**
 * APNG decoding: PNG magic-byte gate + apng-js metadata mapping are pure,
 * node-testable functions; `extractFrameRgba`/`decodeApng` are the thin
 * browser-only glue that turns each frame's PNG bytes into pixels — not
 * exercised by the node test suite (covered by the T4.3 manual E2E pass).
 *
 * No DOM/runtime imports at module top level beyond what's used inside the
 * browser-only functions themselves; `RGBAFrame` is a type-only import from
 * composite.ts (composite.ts stays free of decode.ts's DOM usage).
 */
import parseAPNG, { isNotAPNG, type APNG } from 'apng-js'
import { BLEND_OP_SOURCE, DISPOSE_OP_NONE, type RGBAFrame } from '../../src/lib/composite.js'

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** Delay assigned to the single frame of a non-animated PNG (no fcTL to read one from). */
export const SINGLE_FRAME_DEFAULT_DELAY_MS = 100

/** Throws with a UI-displayable message if `buffer` doesn't start with the PNG signature. */
export function assertPngMagicBytes(buffer: ArrayBuffer): void {
  const bytes = new Uint8Array(buffer)
  const isPng = bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((expected, i) => bytes[i] === expected)
  if (!isPng) {
    throw new Error('不是 PNG 檔案：缺少有效的 PNG 檔頭簽章（magic bytes）')
  }
}

/** Reads width/height straight out of the PNG's IHDR chunk (always the first chunk per spec). */
export function readPngDimensions(buffer: ArrayBuffer): { width: number; height: number } {
  const view = new DataView(buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Per-frame metadata plus that frame's own single-frame PNG bytes (pixels extracted later). */
export interface FrameMeta {
  left: number
  top: number
  width: number
  height: number
  delayMs: number
  disposeOp: number
  blendOp: number
  imageData: Blob
}

export interface ApngMeta {
  width: number
  height: number
  numPlays: number
  isAnimated: boolean
  frames: FrameMeta[]
}

/**
 * Maps apng-js's `parseAPNG` result (already past the magic-byte gate) to
 * our own semantic metadata shape. `parsed` being an Error here means
 * "valid PNG, not animated" (isNotAPNG) — `assertPngMagicBytes` already
 * ruled out "not a PNG" before `parseAPNG` was ever called, so any other
 * Error is treated as unexpected and rethrown rather than silently mapped.
 */
export function mapApngResult(parsed: APNG | Error, buffer: ArrayBuffer): ApngMeta {
  if (parsed instanceof Error) {
    if (!isNotAPNG(parsed)) throw parsed

    const { width, height } = readPngDimensions(buffer)
    return {
      width,
      height,
      numPlays: 0,
      isAnimated: false,
      frames: [
        {
          left: 0,
          top: 0,
          width,
          height,
          delayMs: SINGLE_FRAME_DEFAULT_DELAY_MS,
          disposeOp: DISPOSE_OP_NONE,
          blendOp: BLEND_OP_SOURCE,
          imageData: new Blob([buffer], { type: 'image/png' }),
        },
      ],
    }
  }

  return {
    width: parsed.width,
    height: parsed.height,
    numPlays: parsed.numPlays,
    isAnimated: true,
    frames: parsed.frames.map((frame): FrameMeta => {
      if (!frame.imageData) {
        // apng-js always populates this after a successful parse; guard
        // defensively rather than silently narrowing away `| null`.
        throw new Error('apng-js 未產生此幀的影像資料')
      }
      return {
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        delayMs: frame.delay,
        disposeOp: frame.disposeOp,
        blendOp: frame.blendOp,
        imageData: frame.imageData,
      }
    }),
  }
}

export interface DecodedFrame {
  /** This frame's own pixels — sized to the frame's width/height, not the canvas's. */
  rgba: RGBAFrame
  left: number
  top: number
  delayMs: number
  disposeOp: number
  blendOp: number
}

export interface DecodeResult {
  width: number
  height: number
  numPlays: number
  frames: DecodedFrame[]
  isAnimated: boolean
}

/**
 * PNG bytes -> RGBA pixels via `createImageBitmap` + `OffscreenCanvas`.
 * OffscreenCanvas (rather than an `HTMLCanvasElement`) needs no `document`,
 * so this same function works if this decoding step is ever moved into a
 * worker later. Browser-only — not exercised by the node test suite;
 * covered by the T4.3 manual E2E pass instead.
 */
export async function extractFrameRgba(imageData: Blob, width: number, height: number): Promise<RGBAFrame> {
  const bitmap = await createImageBitmap(imageData)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('無法取得 2D canvas context')
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, width, height)
  bitmap.close()
  return { data: Uint8ClampedArray.from(data), width, height }
}

/**
 * Full decode pipeline: magic-byte gate -> parseAPNG -> metadata mapping ->
 * per-frame PNG->RGBA extraction. The first three steps are pure and
 * covered by decode.test.ts; the last step is browser-only (see
 * `extractFrameRgba`) and covered by the T4.3 manual E2E pass.
 */
export async function decodeApng(buffer: ArrayBuffer): Promise<DecodeResult> {
  assertPngMagicBytes(buffer)
  const meta = mapApngResult(parseAPNG(buffer), buffer)

  const frames = await Promise.all(
    meta.frames.map(
      async (frame): Promise<DecodedFrame> => ({
        rgba: await extractFrameRgba(frame.imageData, frame.width, frame.height),
        left: frame.left,
        top: frame.top,
        delayMs: frame.delayMs,
        disposeOp: frame.disposeOp,
        blendOp: frame.blendOp,
      }),
    ),
  )

  return { width: meta.width, height: meta.height, numPlays: meta.numPlays, isAnimated: meta.isAnimated, frames }
}
