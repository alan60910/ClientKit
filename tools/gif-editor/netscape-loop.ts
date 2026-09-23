/**
 * NETSCAPE2.0 loop-count extraction ((internal design doc) §4a "loop
 * （播放次數）抽取"; decided by SP-2/SP-3, evidence in interop.test.ts).
 *
 * gifuct-js's `decompressFrames` only returns *image* frames and never
 * surfaces the NETSCAPE2.0 Application Extension's loop count (PLAN.md「已查
 * 證事實」) -- it has to be pulled out of `parseGIF()`'s raw frame list
 * separately. Two candidate methods were compared on the same gifenc-produced
 * bytes (see interop.test.ts's "two-method agreement" describe block):
 *
 *   (a) Walk `parseGIF(bytes).frames` for an element with
 *       `application.id === 'NETSCAPE2.0'` and read its raw sub-block bytes
 *       (`[0x01, lo, hi]`) directly.
 *   (b) `src/lib/gif-reader.ts`'s `parseGif(bytes).loopCount`, which already
 *       walks the same bytes at the wire level for the byte-readback tests.
 *
 * Both agree on every gifenc-produced fixture, including ones with a comment
 * extension, a plain-text extension, a private (non-NETSCAPE) application
 * extension, and trailing garbage bytes spliced in around the real data
 * (interop.test.ts's robustness describe block) -- js-binary-schema-parser
 * (gifuct-js's parser backbone) walks the stream generically by peeking the
 * next block's introducer/label and only consumes bytes for whichever schema
 * actually matches, so unrecognized-but-well-formed blocks are skipped
 * without throwing, and the frame-loop itself stops (instead of erroring) the
 * moment it sees a byte that isn't an extension introducer (0x21) or image
 * separator (0x2c) -- e.g. the trailer -- so trailing bytes past that point
 * are never even visited.
 *
 * (a) was picked: gif-editor's decode.ts already has to call gifuct-js's
 * `parseGIF`/`decompressFrames` for the actual pixel data, so extracting loop
 * count from that same parse tree means loop extraction shares its one
 * parser/error model with frame decoding instead of introducing
 * `gif-reader.ts` (a second, independently-written byte walker) as a runtime
 * dependency of the production decode path. `gif-reader.ts` remains in
 * `src/lib/` purely as this project's own test-side byte-level oracle.
 *
 * Loop is secondary metadata, not essential frame data, so extraction must
 * never throw: any parse failure (malformed input, a future gifuct-js
 * behavior change, etc.) degrades safely to `1` (single play) -- the same
 * value used when no NETSCAPE extension is present at all.
 *
 * numPlays semantics (0 = infinite, n = play n times total), mirroring
 * `numPlaysToRepeat`'s inverse (src/lib/gif-encode.ts):
 *   NETSCAPE loopCount 0       -> loop 0   (infinite)
 *   NETSCAPE loopCount n (n>0) -> loop n+1 (NETSCAPE2.0's documented "+1" convention)
 *   no NETSCAPE extension      -> loop 1   (played once; mapping this to 0
 *                                            would turn a single playthrough
 *                                            into an infinite loop)
 *   parse failure of any kind  -> loop 1   (safe degrade, see above)
 */
import { parseGIF } from 'gifuct-js'
import type { ParsedGif } from 'gifuct-js'

const NETSCAPE_APPLICATION_ID = 'NETSCAPE2.0'
const NETSCAPE_LOOP_SUBBLOCK_ID = 0x01

/**
 * Copy a `Uint8Array` view into a freshly-allocated, exactly-sized
 * `ArrayBuffer`. gifuct-js's shipped type for `parseGIF` demands an
 * `ArrayBuffer`, but callers of `extractLoopCount` (decode.ts, this file's
 * tests) naturally hold a `Uint8Array`; a `Uint8Array`'s own `.buffer` is
 * unsafe to hand over as-is when the view doesn't start at byte 0 or cover
 * the whole underlying buffer (a `subarray`, for instance), so this copies
 * instead of just returning `bytes.buffer`.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

/**
 * Method (a): scan `parsed.frames` for the NETSCAPE2.0 application extension
 * and read its loop count straight out of the raw sub-block bytes. Returns
 * `undefined` when no such extension is present (including when the stream
 * has non-NETSCAPE application extensions, which is why `id` is checked
 * before touching `blocks`).
 */
function readNetscapeLoopCount(parsed: ParsedGif): number | undefined {
  for (const frame of parsed.frames) {
    if (!('application' in frame)) continue
    if (frame.application.id !== NETSCAPE_APPLICATION_ID) continue
    const blocks = frame.application.blocks
    if (blocks.length >= 3 && blocks[0] === NETSCAPE_LOOP_SUBBLOCK_ID) {
      return blocks[1] | (blocks[2] << 8)
    }
  }
  return undefined
}

/**
 * Extract the `GifEncodeInput.loop` (numPlays semantics) encoded in a GIF's
 * NETSCAPE2.0 Application Extension. Never throws -- see module doc comment.
 */
export function extractLoopCount(bytes: Uint8Array): number {
  try {
    const parsed = parseGIF(toArrayBuffer(bytes))
    const loopCount = readNetscapeLoopCount(parsed)
    if (loopCount === undefined) return 1
    return loopCount === 0 ? 0 : loopCount + 1
  } catch {
    return 1
  }
}
