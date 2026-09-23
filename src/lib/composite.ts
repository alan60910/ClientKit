/**
 * Pure canvas compositing for APNG frame sequences.
 *
 * Implements the APNG dispose/blend semantics (PLAN.md「合成語意契約」) as a
 * single pure step function: given the canvas state carried over from the
 * previous frame and the next decoded frame, produce (a) the frame as it
 * should be displayed/encoded and (b) the canvas state to carry into the
 * following call. Node-testable: no DOM/runtime imports at module top level.
 */

/** A flat RGBA raster: `data.length === width * height * 4`, row-major. */
export interface RGBAFrame {
  data: Uint8ClampedArray
  width: number
  height: number
}

// Numeric values match the APNG spec (and apng-js's parsed `Frame` fields).
// Plain constants, not `enum`, to stay type-stripping friendly.
export const DISPOSE_OP_NONE = 0
export const DISPOSE_OP_BACKGROUND = 1
export const DISPOSE_OP_PREVIOUS = 2

export const BLEND_OP_SOURCE = 0
export const BLEND_OP_OVER = 1

export interface FrameOptions {
  /** x offset of `frame` within the canvas, pixels. */
  left: number
  /** y offset of `frame` within the canvas, pixels. */
  top: number
  disposeOp: number
  blendOp: number
  /**
   * True for the animation's first frame. A PREVIOUS disposeOp on the first
   * frame is undefined by spec and downgraded to BACKGROUND. Default false.
   */
  isFirstFrame?: boolean
}

export interface CompositeStep {
  /** Full-canvas snapshot as shown on screen for this frame — encode this. */
  displayed: RGBAFrame
  /** Full-canvas state to pass as `canvasState` on the next call. */
  next: RGBAFrame
}

/** A canvas of the given size, fully transparent — the animation's initial state. */
export function createTransparentCanvas(width: number, height: number): RGBAFrame {
  return { data: new Uint8ClampedArray(width * height * 4), width, height }
}

/**
 * Advance the canvas by one frame.
 *
 * Per frame: (1) if disposing to PREVIOUS, snapshot the frame's rect before
 * touching it; (2) blend the frame into the canvas per blendOp; (3) the
 * blended canvas is the displayed output; (4) prepare the next canvas per
 * disposeOp (NONE keeps it, BACKGROUND clears the rect, PREVIOUS restores
 * the step-1 snapshot).
 */
export function composite(canvasState: RGBAFrame, frame: RGBAFrame, options: FrameOptions): CompositeStep {
  const disposeOp =
    options.isFirstFrame && options.disposeOp === DISPOSE_OP_PREVIOUS ? DISPOSE_OP_BACKGROUND : options.disposeOp
  const { left, top } = options

  const snapshot =
    disposeOp === DISPOSE_OP_PREVIOUS ? captureRect(canvasState, left, top, frame.width, frame.height) : null

  const displayed = cloneFrame(canvasState)
  blendInto(displayed, frame, left, top, options.blendOp)

  const next = cloneFrame(displayed)
  if (disposeOp === DISPOSE_OP_BACKGROUND) {
    clearRect(next, left, top, frame.width, frame.height)
  } else if (disposeOp === DISPOSE_OP_PREVIOUS && snapshot) {
    writeRect(next, snapshot, left, top)
  }

  return { displayed, next }
}

function pixelOffset(rasterWidth: number, x: number, y: number): number {
  return (y * rasterWidth + x) * 4
}

/**
 * Malformed/adversarial APNGs can declare a frame rect that hangs off the
 * canvas edge (decode.ts has no way to validate this ahead of time). Without
 * this check, a canvas-space (x,y) past the right edge silently indexes into
 * the *next row* (the raster is one flat array), and one past the bottom
 * edge reads/writes past the array entirely — both corrupt unrelated pixels
 * or coerce through NaN instead of failing loudly. Every canvas read/write
 * keyed by (left+x, top+y) below must go through this guard.
 */
function isWithinCanvas(canvas: RGBAFrame, x: number, y: number): boolean {
  return x >= 0 && x < canvas.width && y >= 0 && y < canvas.height
}

function cloneFrame(source: RGBAFrame): RGBAFrame {
  return { data: Uint8ClampedArray.from(source.data), width: source.width, height: source.height }
}

function captureRect(canvas: RGBAFrame, left: number, top: number, width: number, height: number): RGBAFrame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isWithinCanvas(canvas, left + x, top + y)) continue // off-canvas: leave this snapshot pixel transparent
      const srcOff = pixelOffset(canvas.width, left + x, top + y)
      const dstOff = pixelOffset(width, x, y)
      data[dstOff] = canvas.data[srcOff]
      data[dstOff + 1] = canvas.data[srcOff + 1]
      data[dstOff + 2] = canvas.data[srcOff + 2]
      data[dstOff + 3] = canvas.data[srcOff + 3]
    }
  }
  return { data, width, height }
}

function writeRect(canvas: RGBAFrame, rect: RGBAFrame, left: number, top: number): void {
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      if (!isWithinCanvas(canvas, left + x, top + y)) continue // off-canvas: nothing to restore there
      const srcOff = pixelOffset(rect.width, x, y)
      const dstOff = pixelOffset(canvas.width, left + x, top + y)
      canvas.data[dstOff] = rect.data[srcOff]
      canvas.data[dstOff + 1] = rect.data[srcOff + 1]
      canvas.data[dstOff + 2] = rect.data[srcOff + 2]
      canvas.data[dstOff + 3] = rect.data[srcOff + 3]
    }
  }
}

function clearRect(canvas: RGBAFrame, left: number, top: number, width: number, height: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isWithinCanvas(canvas, left + x, top + y)) continue // off-canvas: nothing to clear there
      const off = pixelOffset(canvas.width, left + x, top + y)
      canvas.data[off] = 0
      canvas.data[off + 1] = 0
      canvas.data[off + 2] = 0
      canvas.data[off + 3] = 0
    }
  }
}

function blendInto(canvas: RGBAFrame, frame: RGBAFrame, left: number, top: number, blendOp: number): void {
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (!isWithinCanvas(canvas, left + x, top + y)) continue // off-canvas: this frame pixel is clipped away
      const srcOff = pixelOffset(frame.width, x, y)
      const dstOff = pixelOffset(canvas.width, left + x, top + y)
      const sr = frame.data[srcOff]
      const sg = frame.data[srcOff + 1]
      const sb = frame.data[srcOff + 2]
      const sa = frame.data[srcOff + 3]

      if (blendOp === BLEND_OP_SOURCE) {
        canvas.data[dstOff] = sr
        canvas.data[dstOff + 1] = sg
        canvas.data[dstOff + 2] = sb
        canvas.data[dstOff + 3] = sa
        continue
      }

      const dr = canvas.data[dstOff]
      const dg = canvas.data[dstOff + 1]
      const db = canvas.data[dstOff + 2]
      const da = canvas.data[dstOff + 3]
      const [outR, outG, outB, outA] = blendOverPixel(sr, sg, sb, sa, dr, dg, db, da)
      canvas.data[dstOff] = outR
      canvas.data[dstOff + 1] = outG
      canvas.data[dstOff + 2] = outB
      canvas.data[dstOff + 3] = outA
    }
  }
}

/**
 * Non-premultiplied "over" compositing, per PLAN.md:
 *   outA = sA + dA*(1 - sA/255)
 *   outC = round((sC*sA + dC*dA*(1 - sA/255)) / outA), outA==0 -> 0
 */
function blendOverPixel(
  sr: number,
  sg: number,
  sb: number,
  sa: number,
  dr: number,
  dg: number,
  db: number,
  da: number,
): [number, number, number, number] {
  const inv = 1 - sa / 255
  const outA = sa + da * inv
  if (outA === 0) return [0, 0, 0, 0]
  return [
    Math.round((sr * sa + dr * da * inv) / outA),
    Math.round((sg * sa + dg * da * inv) / outA),
    Math.round((sb * sa + db * da * inv) / outA),
    Math.round(outA),
  ]
}
