/// <reference types="node" />
import { crc32, deflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import parseAPNG, { APNG } from 'apng-js'
import { assertPngMagicBytes, mapApngResult, readPngDimensions, SINGLE_FRAME_DEFAULT_DELAY_MS } from './decode.js'
import { BLEND_OP_SOURCE, DISPOSE_OP_NONE } from '../../src/lib/composite.js'

// Ground truth values below must match tools/apng-to-gif/fixtures/generate.ts.

const fixturePath = resolve(import.meta.dirname, 'fixtures', 'sample-2frame.apng')

function loadFixtureArrayBuffer(): ArrayBuffer {
  const buf = readFileSync(fixturePath)
  // A node Buffer is a view over a possibly-larger, possibly-shared pooled
  // ArrayBuffer, so `buf.buffer` alone can include unrelated bytes. Slice by
  // byteOffset/byteLength to get exactly this file's bytes.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// ---- inline minimal non-animated PNG builder (test-only; generate.ts is untouched) ----

function u32be(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value)
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (ch) => ch.charCodeAt(0))
  const body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes, 0)
  body.set(data, typeBytes.length)
  const out = new Uint8Array(8 + body.length)
  const view = new DataView(out.buffer)
  u32be(view, 0, data.length)
  out.set(body, 4)
  u32be(view, 4 + body.length, crc32(body))
  return out
}

/** Builds a minimal valid, non-animated (no acTL/fcTL) RGBA PNG: signature -> IHDR -> IDAT -> IEND. */
function buildMinimalPng(width: number, height: number): ArrayBuffer {
  const stride = 1 + width * 4
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const base = y * stride
    raw[base] = 0 // filter type 0: None
    for (let x = 0; x < width; x++) {
      const off = base + 1 + x * 4
      raw[off] = 12
      raw[off + 1] = 34
      raw[off + 2] = 56
      raw[off + 3] = 255
    }
  }

  const ihdrData = new Uint8Array(13)
  const ihdrView = new DataView(ihdrData.buffer)
  u32be(ihdrView, 0, width)
  u32be(ihdrView, 4, height)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 6 // color type: RGBA
  ihdrData[10] = 0 // compression method
  ihdrData[11] = 0 // filter method
  ihdrData[12] = 0 // interlace method

  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  const parts = [signature, makeChunk('IHDR', ihdrData), makeChunk('IDAT', deflateSync(raw)), makeChunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out.buffer
}

describe('parseAPNG metadata (S3 fixture)', () => {
  it('reports canvas size and numPlays from the fixture', () => {
    const result = parseAPNG(loadFixtureArrayBuffer())
    if (result instanceof Error) throw result

    expect(result.width).toBe(4)
    expect(result.height).toBe(4)
    expect(result.numPlays).toBe(5)
    expect(result.frames).toHaveLength(2)
  })

  it('reports per-frame delay/disposeOp/blendOp truthfully', () => {
    const result = parseAPNG(loadFixtureArrayBuffer())
    if (result instanceof Error) throw result

    const [frame0, frame1] = result.frames as [APNG['frames'][number], APNG['frames'][number]]

    expect(frame0.delay).toBe(150)
    expect(frame0.disposeOp).toBe(0) // NONE
    expect(frame0.blendOp).toBe(0) // SOURCE

    expect(frame1.delay).toBe(250)
    expect(frame1.disposeOp).toBe(2) // PREVIOUS
    expect(frame1.blendOp).toBe(1) // OVER
  })
})

describe('assertPngMagicBytes', () => {
  it('accepts a real PNG (the S3 fixture)', () => {
    expect(() => assertPngMagicBytes(loadFixtureArrayBuffer())).not.toThrow()
  })

  it('rejects bytes without the PNG signature, with a clear error', () => {
    const bytes = Uint8Array.from('this is not a png file', (ch) => ch.charCodeAt(0))
    expect(() => assertPngMagicBytes(bytes.buffer)).toThrow(/PNG/)
  })

  it('rejects a buffer shorter than the signature itself', () => {
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e)
    expect(() => assertPngMagicBytes(bytes.buffer)).toThrow(/PNG/)
  })
})

describe('mapApngResult (animated path, S3 fixture)', () => {
  it('maps parseAPNG output to DecodedFrame-ready metadata for both frames', () => {
    const buffer = loadFixtureArrayBuffer()
    const meta = mapApngResult(parseAPNG(buffer), buffer)

    expect(meta.isAnimated).toBe(true)
    expect(meta.width).toBe(4)
    expect(meta.height).toBe(4)
    expect(meta.numPlays).toBe(5)
    expect(meta.frames).toHaveLength(2)

    const [frame0, frame1] = meta.frames

    expect(frame0.left).toBe(0)
    expect(frame0.top).toBe(0)
    expect(frame0.width).toBe(4)
    expect(frame0.height).toBe(4)
    expect(frame0.delayMs).toBe(150)
    expect(frame0.disposeOp).toBe(0)
    expect(frame0.blendOp).toBe(0)
    expect(frame0.imageData).toBeInstanceOf(Blob)

    expect(frame1.left).toBe(0)
    expect(frame1.top).toBe(0)
    expect(frame1.delayMs).toBe(250)
    expect(frame1.disposeOp).toBe(2)
    expect(frame1.blendOp).toBe(1)
    expect(frame1.imageData).toBeInstanceOf(Blob)
  })
})

describe('mapApngResult (non-animated fallback, inline minimal PNG)', () => {
  it('treats a valid non-animated PNG as a single NONE/SOURCE frame covering the whole canvas', () => {
    const buffer = buildMinimalPng(3, 2)
    const parsed = parseAPNG(buffer)
    expect(parsed).toBeInstanceOf(Error) // apng-js: valid PNG, but not animated

    const meta = mapApngResult(parsed, buffer)

    expect(meta.isAnimated).toBe(false)
    expect(meta.width).toBe(3)
    expect(meta.height).toBe(2)
    expect(meta.numPlays).toBe(0)
    expect(meta.frames).toHaveLength(1)

    const [frame] = meta.frames
    expect(frame.left).toBe(0)
    expect(frame.top).toBe(0)
    expect(frame.width).toBe(3)
    expect(frame.height).toBe(2)
    expect(frame.delayMs).toBe(SINGLE_FRAME_DEFAULT_DELAY_MS)
    expect(frame.disposeOp).toBe(DISPOSE_OP_NONE)
    expect(frame.blendOp).toBe(BLEND_OP_SOURCE)
    expect(frame.imageData).toBeInstanceOf(Blob)
  })

  it('rethrows a genuinely-not-PNG parseAPNG error rather than misreporting it as non-animated', () => {
    // assertPngMagicBytes would normally catch this before mapApngResult is
    // ever reached; this pins mapApngResult's own defensive branch.
    const notPngBytes = Uint8Array.from('definitely not a png', (ch) => ch.charCodeAt(0))
    const parsed = parseAPNG(notPngBytes.buffer)
    expect(parsed).toBeInstanceOf(Error)
    expect(() => mapApngResult(parsed, notPngBytes.buffer)).toThrow()
  })
})

describe('readPngDimensions', () => {
  it('reads width/height straight from the IHDR chunk', () => {
    expect(readPngDimensions(buildMinimalPng(5, 7))).toEqual({ width: 5, height: 7 })
    expect(readPngDimensions(loadFixtureArrayBuffer())).toEqual({ width: 4, height: 4 })
  })
})
