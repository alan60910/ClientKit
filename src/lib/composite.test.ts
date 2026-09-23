import { describe, expect, it } from 'vitest'
import {
  BLEND_OP_OVER,
  BLEND_OP_SOURCE,
  DISPOSE_OP_BACKGROUND,
  DISPOSE_OP_NONE,
  DISPOSE_OP_PREVIOUS,
  composite,
  createTransparentCanvas,
  type RGBAFrame,
} from './composite.js'

type Pixel = [number, number, number, number]

function makeFrame(rows: Pixel[][]): RGBAFrame {
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
  return { data, width, height }
}

function fillFrame(width: number, height: number, pixel: Pixel): RGBAFrame {
  return makeFrame(Array.from({ length: height }, () => Array.from({ length: width }, (): Pixel => pixel)))
}

// Square canvas where every cell has a distinct color, so tests can tell
// which cells a rect operation touched: (x,y) -> [10+x*10, 20+y*10, 30, 255].
function makeGradientCanvas(size: number): RGBAFrame {
  const rows: Pixel[][] = []
  for (let y = 0; y < size; y++) {
    const row: Pixel[] = []
    for (let x = 0; x < size; x++) row.push([10 + x * 10, 20 + y * 10, 30, 255])
    rows.push(row)
  }
  return makeFrame(rows)
}

describe('composite', () => {
  it('SOURCE overwrites the rect verbatim, including semi-transparent alpha, without mixing with the canvas', () => {
    const canvas = fillFrame(2, 2, [99, 99, 99, 255])
    const frame = makeFrame([
      [
        [10, 20, 30, 100],
        [0, 0, 0, 0],
      ],
      [
        [255, 255, 255, 255],
        [50, 60, 70, 200],
      ],
    ])

    const { displayed, next } = composite(canvas, frame, {
      left: 0,
      top: 0,
      disposeOp: DISPOSE_OP_NONE,
      blendOp: BLEND_OP_SOURCE,
      isFirstFrame: true,
    })

    expect(displayed.data).toEqual(frame.data)
    expect(next.data).toEqual(displayed.data)
  })

  it('OVER follows the documented alpha formula: opaque/transparent/semi-transparent sources and the outA==0 case', () => {
    const canvas = makeFrame([
      [
        [255, 255, 255, 255], // opaque white dest
        [10, 20, 30, 255], // opaque dest
      ],
      [
        [0, 0, 0, 0], // transparent dest
        [0, 0, 0, 0], // transparent dest
      ],
    ])
    const frame = makeFrame([
      [
        [0, 0, 0, 128], // semi-transparent black source
        [0, 0, 0, 0], // fully transparent source
      ],
      [
        [200, 150, 100, 255], // fully opaque source
        [50, 60, 70, 0], // fully transparent source over transparent dest
      ],
    ])

    const { displayed, next } = composite(canvas, frame, {
      left: 0,
      top: 0,
      disposeOp: DISPOSE_OP_NONE,
      blendOp: BLEND_OP_OVER,
      isFirstFrame: false,
    })

    // Expected values computed from PLAN's formula:
    //   outA = sA + dA*(1-sA/255); outC = round((sC*sA + dC*dA*(1-sA/255))/outA)
    expect(displayed.data).toEqual(
      makeFrame([
        [
          [127, 127, 127, 255], // semi-transparent black over opaque white -> mid gray, still opaque
          [10, 20, 30, 255], // fully transparent source leaves dest unchanged
        ],
        [
          [200, 150, 100, 255], // fully opaque source over transparent dest -> source verbatim
          [0, 0, 0, 0], // both fully transparent -> outA==0 -> all zero
        ],
      ]).data,
    )
    expect(next.data).toEqual(displayed.data)
  })

  it('NONE carries the canvas forward unchanged (as an independent copy, not aliased)', () => {
    const canvas = fillFrame(2, 2, [5, 6, 7, 255])
    const frame = fillFrame(2, 2, [9, 9, 9, 9])

    const { displayed, next } = composite(canvas, frame, {
      left: 0,
      top: 0,
      disposeOp: DISPOSE_OP_NONE,
      blendOp: BLEND_OP_SOURCE,
      isFirstFrame: false,
    })

    expect(next.data).toEqual(displayed.data)
    expect(next.data).not.toBe(displayed.data)
  })

  it('BACKGROUND clears only the frame rect (non-zero left/top), leaving the rest of a larger canvas untouched', () => {
    const canvas = makeGradientCanvas(3)
    const frame = fillFrame(2, 2, [200, 200, 200, 255])

    const { displayed, next } = composite(canvas, frame, {
      left: 1,
      top: 1,
      disposeOp: DISPOSE_OP_BACKGROUND,
      blendOp: BLEND_OP_SOURCE,
      isFirstFrame: false,
    })

    expect(displayed.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
        ],
        [
          [10, 30, 30, 255],
          [200, 200, 200, 255],
          [200, 200, 200, 255],
        ],
        [
          [10, 40, 30, 255],
          [200, 200, 200, 255],
          [200, 200, 200, 255],
        ],
      ]).data,
    )
    expect(next.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
        ],
        [
          [10, 30, 30, 255],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        [
          [10, 40, 30, 255],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
      ]).data,
    )
    // The input canvas must not be mutated (composite is pure).
    expect(canvas.data).toEqual(makeGradientCanvas(3).data)
  })

  it('PREVIOUS restores the frame rect to its pre-blend snapshot, leaving the rest of the canvas untouched', () => {
    const canvas = makeGradientCanvas(3)
    const frame = fillFrame(2, 2, [77, 88, 99, 255])

    const { displayed, next } = composite(canvas, frame, {
      left: 1,
      top: 1,
      disposeOp: DISPOSE_OP_PREVIOUS,
      blendOp: BLEND_OP_SOURCE,
      isFirstFrame: false,
    })

    expect(displayed.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
        ],
        [
          [10, 30, 30, 255],
          [77, 88, 99, 255],
          [77, 88, 99, 255],
        ],
        [
          [10, 40, 30, 255],
          [77, 88, 99, 255],
          [77, 88, 99, 255],
        ],
      ]).data,
    )
    // PREVIOUS restores exactly what was there before this frame blended in.
    expect(next.data).toEqual(canvas.data)
    expect(next.data).not.toBe(canvas.data)
  })

  it('downgrades a first-frame PREVIOUS disposeOp to BACKGROUND (spec: undefined otherwise)', () => {
    const canvas = makeGradientCanvas(3)
    const frame = fillFrame(2, 2, [77, 88, 99, 255])

    const { displayed, next } = composite(canvas, frame, {
      left: 1,
      top: 1,
      disposeOp: DISPOSE_OP_PREVIOUS,
      blendOp: BLEND_OP_SOURCE,
      isFirstFrame: true,
    })

    // Blending itself is unaffected by the downgrade.
    expect(displayed.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
        ],
        [
          [10, 30, 30, 255],
          [77, 88, 99, 255],
          [77, 88, 99, 255],
        ],
        [
          [10, 40, 30, 255],
          [77, 88, 99, 255],
          [77, 88, 99, 255],
        ],
      ]).data,
    )
    // Next canvas is cleared (BACKGROUND behavior), not restored (PREVIOUS behavior).
    expect(next.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
        ],
        [
          [10, 30, 30, 255],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        [
          [10, 40, 30, 255],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
      ]).data,
    )
  })

  it('BACKGROUND x OVER: blends per the alpha formula at a non-zero offset, then clears only that rect', () => {
    const canvas = makeGradientCanvas(3)
    const frame = fillFrame(2, 2, [100, 150, 200, 90])

    const { displayed, next } = composite(canvas, frame, {
      left: 1,
      top: 1,
      disposeOp: DISPOSE_OP_BACKGROUND,
      blendOp: BLEND_OP_OVER,
      isFirstFrame: false,
    })

    // OVER outputs independently computed via `node -e` against the
    // documented formula, blending [100,150,200,90] onto each gradient cell:
    // (1,1)->[48,72,90,255] (2,1)->[55,72,90,255] (1,2)->[48,79,90,255] (2,2)->[55,79,90,255]
    expect(displayed.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
        ],
        [
          [10, 30, 30, 255],
          [48, 72, 90, 255],
          [55, 72, 90, 255],
        ],
        [
          [10, 40, 30, 255],
          [48, 79, 90, 255],
          [55, 79, 90, 255],
        ],
      ]).data,
    )
    expect(next.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
        ],
        [
          [10, 30, 30, 255],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        [
          [10, 40, 30, 255],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
      ]).data,
    )
  })

  it('PREVIOUS x OVER: blends per the alpha formula at a non-zero offset, then restores the pre-blend snapshot', () => {
    const canvas = makeGradientCanvas(3)
    const frame = fillFrame(2, 2, [100, 150, 200, 90])

    const { displayed, next } = composite(canvas, frame, {
      left: 1,
      top: 1,
      disposeOp: DISPOSE_OP_PREVIOUS,
      blendOp: BLEND_OP_OVER,
      isFirstFrame: false,
    })

    // Same OVER outputs as the BACKGROUND x OVER case above (identical canvas/frame/rect).
    expect(displayed.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
        ],
        [
          [10, 30, 30, 255],
          [48, 72, 90, 255],
          [55, 72, 90, 255],
        ],
        [
          [10, 40, 30, 255],
          [48, 79, 90, 255],
          [55, 79, 90, 255],
        ],
      ]).data,
    )
    // PREVIOUS restores exactly what was there before, regardless of blendOp.
    expect(next.data).toEqual(canvas.data)
  })

  it('clips a frame rect that overflows the canvas right edge, without leaking into the next row', () => {
    const canvas = makeGradientCanvas(4)
    const frame = fillFrame(2, 2, [222, 111, 44, 255])

    // Frame is 2 wide at left=3 on a 4-wide canvas: only its first column
    // (canvas x=3) is on-canvas; its second column (canvas x=4) doesn't
    // exist. Without a bounds guard, that second column's writes land on
    // canvas x=0 of the *next* row (a flat-array wraparound), corrupting it.
    const { displayed } = composite(canvas, frame, {
      left: 3,
      top: 0,
      disposeOp: DISPOSE_OP_NONE,
      blendOp: BLEND_OP_SOURCE,
      isFirstFrame: false,
    })

    expect(displayed.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
          [222, 111, 44, 255],
        ],
        [
          [10, 30, 30, 255], // would have been corrupted by the old wraparound bug
          [20, 30, 30, 255],
          [30, 30, 30, 255],
          [222, 111, 44, 255],
        ],
        [
          [10, 40, 30, 255], // would have been corrupted by the old wraparound bug
          [20, 40, 30, 255],
          [30, 40, 30, 255],
          [40, 40, 30, 255],
        ],
        [
          [10, 50, 30, 255],
          [20, 50, 30, 255],
          [30, 50, 30, 255],
          [40, 50, 30, 255],
        ],
      ]).data,
    )
  })

  it('clips a frame rect that overflows the canvas bottom edge; PREVIOUS restores it cleanly', () => {
    const canvas = makeGradientCanvas(4)
    const frame = fillFrame(2, 2, [222, 111, 44, 255])

    // Frame is 2 tall at top=3 on a 4-tall canvas: only its first row
    // (canvas y=3) is on-canvas; its second row (canvas y=4) doesn't exist.
    const { displayed, next } = composite(canvas, frame, {
      left: 0,
      top: 3,
      disposeOp: DISPOSE_OP_PREVIOUS,
      blendOp: BLEND_OP_SOURCE,
      isFirstFrame: false,
    })

    expect(displayed.data).toEqual(
      makeFrame([
        [
          [10, 20, 30, 255],
          [20, 20, 30, 255],
          [30, 20, 30, 255],
          [40, 20, 30, 255],
        ],
        [
          [10, 30, 30, 255],
          [20, 30, 30, 255],
          [30, 30, 30, 255],
          [40, 30, 30, 255],
        ],
        [
          [10, 40, 30, 255],
          [20, 40, 30, 255],
          [30, 40, 30, 255],
          [40, 40, 30, 255],
        ],
        [
          [222, 111, 44, 255],
          [222, 111, 44, 255],
          [30, 50, 30, 255],
          [40, 50, 30, 255],
        ],
      ]).data,
    )
    // The off-canvas row never existed to snapshot or restore; the
    // on-canvas row's pre-blend values come back exactly (no NaN-derived 0).
    expect(next.data).toEqual(makeGradientCanvas(4).data)
  })

  it('clips a frame rect that overflows both edges at once, under BACKGROUND dispose', () => {
    const canvas = makeGradientCanvas(4)
    const frame = fillFrame(2, 2, [222, 111, 44, 255])

    // Frame is 2x2 at left=3,top=3 on a 4x4 canvas: only its top-left pixel
    // (canvas x=3,y=3) is on-canvas; the other three cells are off-canvas.
    const { displayed, next } = composite(canvas, frame, {
      left: 3,
      top: 3,
      disposeOp: DISPOSE_OP_BACKGROUND,
      blendOp: BLEND_OP_SOURCE,
      isFirstFrame: false,
    })

    const expectedDisplayed = makeFrame([
      [
        [10, 20, 30, 255],
        [20, 20, 30, 255],
        [30, 20, 30, 255],
        [40, 20, 30, 255],
      ],
      [
        [10, 30, 30, 255],
        [20, 30, 30, 255],
        [30, 30, 30, 255],
        [40, 30, 30, 255],
      ],
      [
        [10, 40, 30, 255],
        [20, 40, 30, 255],
        [30, 40, 30, 255],
        [40, 40, 30, 255],
      ],
      [
        [10, 50, 30, 255],
        [20, 50, 30, 255],
        [30, 50, 30, 255],
        [222, 111, 44, 255],
      ],
    ])
    expect(displayed.data).toEqual(expectedDisplayed.data)

    const expectedNext = makeFrame([
      [
        [10, 20, 30, 255],
        [20, 20, 30, 255],
        [30, 20, 30, 255],
        [40, 20, 30, 255],
      ],
      [
        [10, 30, 30, 255],
        [20, 30, 30, 255],
        [30, 30, 30, 255],
        [40, 30, 30, 255],
      ],
      [
        [10, 40, 30, 255],
        [20, 40, 30, 255],
        [30, 40, 30, 255],
        [40, 40, 30, 255],
      ],
      [
        [10, 50, 30, 255],
        [20, 50, 30, 255],
        [30, 50, 30, 255],
        [0, 0, 0, 0],
      ],
    ])
    expect(next.data).toEqual(expectedNext.data)
  })

  it('createTransparentCanvas returns an all-zero RGBA raster of the given size', () => {
    const canvas = createTransparentCanvas(3, 2)
    expect(canvas.width).toBe(3)
    expect(canvas.height).toBe(2)
    expect(canvas.data).toHaveLength(3 * 2 * 4)
    expect(canvas.data.every((byte) => byte === 0)).toBe(true)
  })
})
