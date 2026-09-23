/**
 * Test-only fixture builders shared across `src/lib/*.test.ts` (currently
 * `gif-encode.test.ts`). Not imported by any production module.
 */
import type { RGBAFrame } from './composite.js'

export function makeSolidRgba(width: number, height: number, r: number, g: number, b: number, a = 255): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  }
  return data
}

export function makeRgbaFrame(
  width: number,
  height: number,
  pixels: ReadonlyArray<readonly [number, number, number, number]>,
): RGBAFrame {
  const data = new Uint8ClampedArray(width * height * 4)
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  })
  return { data, width, height }
}

export function makeSolidFrame(width: number, height: number, r: number, g: number, b: number, a = 255): RGBAFrame {
  const pixelCount = width * height
  return makeRgbaFrame(width, height, Array.from({ length: pixelCount }, () => [r, g, b, a] as const))
}
