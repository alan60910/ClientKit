/**
 * Pure, DOM-free / Node-free byte-level GIF89a reader.
 *
 * Scoped to what this project's tests need to assert (PLAN.md「Verification」
 * 段 byte 級讀回斷言): header signature, per-frame Graphic Control Extension
 * (delay/transparency/disposal), the NETSCAPE2.0 looping Application
 * Extension, frame count, and the trailer byte. This is NOT a general-purpose
 * GIF decoder -- it does not decode LZW pixel data or interpret Comment /
 * Plain Text extension payloads (it only skips past their sub-blocks so the
 * walk can continue).
 *
 * Takes a plain `Uint8Array` and has no Node-specific or DOM-specific API
 * surface, but that is incidental, not a usage invitation: this module is
 * test-only (a byte-level oracle for this project's own vitest suites,
 * cross-checking gifuct-js/gifenc output) and must not be imported from any
 * production or worker code path -- decode.ts's NETSCAPE loop extraction
 * deliberately uses `./netscape-loop.js` (walking gifuct-js's own parse tree)
 * instead, precisely to avoid taking this file on as a runtime dependency.
 */

export interface GraphicControlExtension {
  /** Disposal method, 0-7 (GIF89a spec §23, packed field bits 4-6). */
  disposalMethod: number
  /** Transparent color flag (packed field bit 0). */
  transparentColorFlag: boolean
  /** Delay time exactly as stored on the wire, in 1/100 sec -- NOT ms. */
  delayCentiseconds: number
  /** Transparent color index. Only meaningful when transparentColorFlag is true. */
  transparentColorIndex: number
}

export interface ParsedGif {
  /** The 6-byte signature+version block, e.g. "GIF89a". */
  header: string
  width: number
  height: number
  /**
   * NETSCAPE2.0 Application Extension loop count, or `undefined` if no such
   * extension is present in the stream.
   *
   * Loop-count semantics decision (T1.3 spike S1, gifenc@1.0.3 source-verified
   * at node_modules/gifenc/src/index.js writeFrame/encodeNetscapeExt):
   * gifenc's `writeFrame({ repeat })` only calls `encodeNetscapeExt` when
   * `repeat >= 0`, and writes `repeat` verbatim as the 2-byte loop count.
   * So: repeat === -1 -> extension omitted entirely (this field reads back as
   * `undefined`); repeat === 0 -> loop count 0 (infinite, universally
   * implemented that way); repeat === n > 0 -> loop count n written as-is.
   *
   * The NETSCAPE2.0 loop-count field has a well-documented "off by one" vs.
   * "total plays": a written loop count of n (n >= 1) is interpreted by all
   * mainstream engines (Chromium, Firefox, WebKit; also e.g. ImageMagick's
   * `-loop` flag) as "play once, then loop n more times" = n+1 total plays.
   * A count of 0 is the documented exception meaning infinite, not "play
   * once". See node_modules/gifenc/src/index.js:56 `// -1=once, 0=forever,
   * >0=count` and gifenc's own d.ts comment (tools/apng-to-gif/gifenc.d.ts).
   *
   * Therefore the APNG `numPlays` (n = desired TOTAL play count, 0 = infinite)
   * -> gifenc `repeat` mapping this project adopts (for T2.2 convert.ts) is:
   *   numPlays === 0  -> repeat = 0   (infinite; unaffected by the off-by-one)
   *   numPlays === 1  -> repeat = -1  (omit NETSCAPE ext -> single play; a
   *                                     written loop count of 0 would mean
   *                                     "infinite", not "once", so it cannot
   *                                     be used here)
   *   numPlays === n  (n > 1) -> repeat = n - 1 (n-1 additional loops + the
   *                                     first play = n total plays)
   * Real-browser playback confirmation of this mapping is out of scope here
   * (deferred to T4.3 manual E2E); this decision rests on gifenc's own
   * source/docs plus the widely-documented NETSCAPE2.0 convention.
   */
  loopCount: number | undefined
  /** One entry per Graphic Control Extension encountered, in file order. */
  graphicControlExtensions: GraphicControlExtension[]
  /** Number of Image Descriptor (frame) blocks encountered. */
  frameCount: number
  /** True iff a GIF trailer (0x3B) was reached while walking the stream. */
  hasValidTrailer: boolean
}

const TRAILER = 0x3b
const EXTENSION_INTRODUCER = 0x21
const IMAGE_SEPARATOR = 0x2c
const GRAPHIC_CONTROL_LABEL = 0xf9
const APPLICATION_LABEL = 0xff
const PLAIN_TEXT_LABEL = 0x01

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(bytes[offset + i])
  }
  return out
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

/** Byte length of a (global or local) color table for a given packed size field (bits 0-2). */
function colorTableByteLength(packedSizeBits: number): number {
  return (2 << packedSizeBits) * 3
}

/** Advance past a sequence of GIF sub-blocks (size-prefixed), returning the offset just past the 0x00 terminator. */
function skipSubBlocks(bytes: Uint8Array, offset: number): number {
  let cursor = offset
  while (bytes[cursor] !== 0x00) {
    const subBlockSize = bytes[cursor]
    cursor += 1 + subBlockSize
  }
  return cursor + 1
}

export function parseGif(bytes: Uint8Array): ParsedGif {
  if (bytes.length < 13) {
    throw new Error(`parseGif: input too short to contain a GIF header+LSD (${bytes.length} bytes)`)
  }

  const header = readAscii(bytes, 0, 6)
  const width = readUint16LE(bytes, 6)
  const height = readUint16LE(bytes, 8)
  const lsdPacked = bytes[10]

  let offset = 13
  if (lsdPacked & 0x80) {
    offset += colorTableByteLength(lsdPacked & 0x07)
  }

  let loopCount: number | undefined
  const graphicControlExtensions: GraphicControlExtension[] = []
  let frameCount = 0
  let hasValidTrailer = false

  while (offset < bytes.length) {
    const blockType = bytes[offset]

    if (blockType === EXTENSION_INTRODUCER) {
      const label = bytes[offset + 1]
      offset += 2

      if (label === GRAPHIC_CONTROL_LABEL) {
        const blockSize = bytes[offset] // spec: always 4
        const packed = bytes[offset + 1]
        const delayCentiseconds = readUint16LE(bytes, offset + 2)
        const transparentColorIndex = bytes[offset + 4]
        offset += 1 + blockSize // block size byte + its 4 data bytes
        offset += 1 // block terminator (0x00)

        graphicControlExtensions.push({
          disposalMethod: (packed >> 2) & 0x07,
          transparentColorFlag: (packed & 0x01) !== 0,
          delayCentiseconds,
          transparentColorIndex,
        })
      } else if (label === APPLICATION_LABEL) {
        const blockSize = bytes[offset] // spec: always 11
        const appIdentifier = readAscii(bytes, offset + 1, 8)
        const appAuthCode = readAscii(bytes, offset + 9, 3)
        offset += 1 + blockSize

        const isNetscapeLoopExt = appIdentifier === 'NETSCAPE' && appAuthCode === '2.0'
        while (bytes[offset] !== 0x00) {
          const subBlockSize = bytes[offset]
          if (isNetscapeLoopExt && subBlockSize === 3 && bytes[offset + 1] === 1) {
            loopCount = readUint16LE(bytes, offset + 2)
          }
          offset += 1 + subBlockSize
        }
        offset += 1 // terminator
      } else {
        // Comment (0xFE) or Plain Text (0x01) extension: skip past whatever
        // we don't need to interpret. Plain Text has a fixed 12-byte block
        // before its sub-blocks; Comment goes straight into sub-blocks.
        if (label === PLAIN_TEXT_LABEL) {
          const blockSize = bytes[offset] // spec: always 12
          offset += 1 + blockSize
        }
        offset = skipSubBlocks(bytes, offset)
      }
    } else if (blockType === IMAGE_SEPARATOR) {
      const packed = bytes[offset + 9]
      offset += 10 // separator + left/top/width/height (2 bytes each) + packed
      if (packed & 0x80) {
        offset += colorTableByteLength(packed & 0x07)
      }
      offset += 1 // LZW minimum code size
      offset = skipSubBlocks(bytes, offset)
      frameCount += 1
    } else if (blockType === TRAILER) {
      hasValidTrailer = true
      break
    } else {
      throw new Error(`parseGif: unexpected byte 0x${blockType.toString(16)} at offset ${offset}`)
    }
  }

  return {
    header,
    width,
    height,
    loopCount,
    graphicControlExtensions,
    frameCount,
    hasValidTrailer,
  }
}
