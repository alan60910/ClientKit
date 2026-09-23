/**
 * Generates `sample-2frame.apng` — a minimal, hand-built APNG fixture used
 * by `decode.test.ts` to verify `apng-js`'s `parseAPNG` against known truth.
 *
 * Regenerate with (Node >=22, runs via built-in TS type-stripping):
 *   node tools/apng-to-gif/fixtures/generate.ts
 *
 * The script is deterministic (no timestamps/randomness) — re-running it
 * must produce a byte-identical file.
 *
 * Chunk layout: PNG signature -> IHDR -> acTL -> fcTL(frame 0) -> IDAT ->
 * fcTL(frame 1) -> fdAT -> IEND. Frame 0's image data lives in IDAT (the
 * first `fcTL` precedes it, so per the APNG spec it is both the default
 * image and animation frame 0, not a separate non-animated default image).
 *
 * Ground truth (must match the hard-coded expectations in decode.test.ts):
 *   canvas: 4x4, numPlays: 5
 *   frame 0: delayNum/delayDen 15/100 -> delay 150ms, disposeOp NONE(0), blendOp SOURCE(0)
 *   frame 1: delay 250ms, disposeOp PREVIOUS(2), blendOp OVER(1)
 * Both frames' pixel data include fully-opaque, semi-transparent, and
 * fully-transparent (alpha 0) pixels.
 *
 * Deliberately discriminating choices (post-review, so a mutated/broken
 * implementation can't slip through by accident):
 *   - frame 0 uses delayNum=15, delayDen=100 (not delayDen=1000, which would
 *     make delayNum numerically equal the millisecond result and hide a bug
 *     that forgets the 1000*delayNum/delayDen conversion entirely).
 *   - frame 1's disposeOp(2) != blendOp(1), so a bug that swaps which field
 *     feeds which output can't hide behind both fields sharing one value.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const WIDTH = 4
const HEIGHT = 4
const BIT_DEPTH = 8
const COLOR_TYPE_RGBA = 6

const NUM_PLAYS = 5

const DISPOSE_OP_NONE = 0
const DISPOSE_OP_PREVIOUS = 2
const BLEND_OP_SOURCE = 0
const BLEND_OP_OVER = 1

// delayNum != delayDen*ms/1000 in any way that would coincide with a
// forgotten-conversion bug — see the discriminating-choices note above.
const FRAME0 = { delayNum: 15, delayDen: 100, disposeOp: DISPOSE_OP_NONE, blendOp: BLEND_OP_SOURCE }
const FRAME1 = { delayNum: 250, delayDen: 1000, disposeOp: DISPOSE_OP_PREVIOUS, blendOp: BLEND_OP_OVER }

type Pixel = [number, number, number, number]

// Row-major 4x4 RGBA grids. Each includes opaque (a=255), semi-transparent
// (0<a<255), and fully-transparent (a=0) pixels.
const FRAME0_ROWS: Pixel[][] = [
  [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]],
  [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 128], [255, 255, 255, 128]],
  [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [255, 255, 255, 0]],
  [[128, 128, 128, 255], [64, 64, 64, 200], [32, 32, 32, 50], [0, 0, 0, 0]],
]

const FRAME1_ROWS: Pixel[][] = [
  [[0, 0, 0, 255], [255, 255, 255, 255], [0, 255, 255, 255], [255, 0, 255, 255]],
  [[0, 0, 0, 128], [255, 255, 255, 128], [0, 255, 255, 128], [255, 0, 255, 128]],
  [[0, 0, 0, 0], [255, 255, 255, 0], [0, 255, 255, 0], [255, 0, 255, 0]],
  [[10, 20, 30, 255], [40, 50, 60, 180], [70, 80, 90, 90], [0, 0, 0, 0]],
]

// ---- CRC32 (PNG uses the same polynomial/reflection as zlib) ----

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = makeCrcTable()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// ---- byte helpers ----

function u32be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
}

function u16be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 8) & 0xff, n & 0xff)
}

function u8(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff)
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (ch) => ch.charCodeAt(0))
  const body = concatBytes([typeBytes, data])
  const crc = crc32(body)
  return concatBytes([u32be(data.length), body, u32be(crc)])
}

function encodeFrameRGBA(rows: Pixel[][]): Uint8Array {
  const stride = 1 + WIDTH * 4
  const raw = new Uint8Array(stride * HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    const base = y * stride
    raw[base] = 0 // filter type 0: None
    const row = rows[y]
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b, a] = row[x]
      const off = base + 1 + x * 4
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
      raw[off + 3] = a
    }
  }
  return deflateSync(raw)
}

function makeFcTLData(opts: {
  sequenceNumber: number
  width: number
  height: number
  xOffset: number
  yOffset: number
  delayNum: number
  delayDen: number
  disposeOp: number
  blendOp: number
}): Uint8Array {
  return concatBytes([
    u32be(opts.sequenceNumber),
    u32be(opts.width),
    u32be(opts.height),
    u32be(opts.xOffset),
    u32be(opts.yOffset),
    u16be(opts.delayNum),
    u16be(opts.delayDen),
    u8(opts.disposeOp),
    u8(opts.blendOp),
  ])
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

const ihdrData = concatBytes([
  u32be(WIDTH),
  u32be(HEIGHT),
  u8(BIT_DEPTH),
  u8(COLOR_TYPE_RGBA),
  u8(0), // compression method
  u8(0), // filter method
  u8(0), // interlace method
])

const actlData = concatBytes([u32be(2), u32be(NUM_PLAYS)])

const fcTL0Data = makeFcTLData({ sequenceNumber: 0, width: WIDTH, height: HEIGHT, xOffset: 0, yOffset: 0, ...FRAME0 })
const fcTL1Data = makeFcTLData({ sequenceNumber: 1, width: WIDTH, height: HEIGHT, xOffset: 0, yOffset: 0, ...FRAME1 })

const frame0ImageData = encodeFrameRGBA(FRAME0_ROWS)
const frame1ImageData = encodeFrameRGBA(FRAME1_ROWS)
const fdATData = concatBytes([u32be(2), frame1ImageData])

const png = concatBytes([
  PNG_SIGNATURE,
  makeChunk('IHDR', ihdrData),
  makeChunk('acTL', actlData),
  makeChunk('fcTL', fcTL0Data),
  makeChunk('IDAT', frame0ImageData),
  makeChunk('fcTL', fcTL1Data),
  makeChunk('fdAT', fdATData),
  makeChunk('IEND', new Uint8Array(0)),
])

const outPath = resolve(import.meta.dirname, 'sample-2frame.apng')
writeFileSync(outPath, png)
console.log(`wrote ${png.length} bytes to ${outPath}`)
