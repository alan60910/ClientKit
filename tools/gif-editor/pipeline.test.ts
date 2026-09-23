/**
 * S3-T3.3 ((internal design doc), Verification「端到端」): drives the
 * whole gif-editor pipeline -- `decodeGif` -> `edit.ts` (`createInitialEditState`
 * / `setFrameKept` / `setFrameDelay` / `setLoop` / `applyEdits`) ->
 * `encodeGif` -- and reads the result back with `src/lib/gif-reader.ts`'s
 * independent byte-level parser (never gifuct-js/`decodeGif` itself), so a
 * bug that round-trips cleanly through this project's own decode/encode pair
 * but produces a spec-incorrect GIF on the wire cannot hide.
 *
 * SP-7 library-boundary proof: every internal import below resolves to
 * either `../../src/lib/*` (the shared encode/read primitives) or `./`
 * (gif-editor's own decode/edit/fixture modules) -- see the import list at
 * the top of this file, which is exhaustive. Nothing here reaches into
 * another tool's folder (e.g. `tools/apng-to-gif`) or re-implements what
 * `src/lib` already provides.
 *
 * `buildMainFixtureGif` ground truth (2x2 canvas, 4-color GCT so
 * minCodeSize=2 -- the GIF-mandated floor, same discriminating choice
 * `fixtures/generate.ts`'s own `sample-edit.gif` makes):
 *   frame 0: full 2x2, disposal 0, delay  5cs (50ms),  opaque bg
 *   frame 1: full 2x2, disposal 2, delay  8cs (80ms),  opaque c1 (deleted below)
 *   frame 2: 1x1 @ (0,0), disposal 0, delay 13cs (130ms), transparentIndex ->
 *            frame 1's disposal=2 clears the *entire* 2x2 canvas to
 *            transparent right after it's shown, so frame 2's own transparent
 *            pixel -- and the 3 cells it doesn't even touch, already cleared
 *            by frame 1's disposal -- composite to a fully-transparent
 *            displayed frame (the "含透明幀" case).
 *   frame 3: full 2x2, disposal 0, delay 21cs (210ms), opaque c3
 *   NETSCAPE loop (raw wire value) 3 -> decodeGif().loop === 4 (numPlays)
 *
 * Edit applied by `runMainPipeline`: delete frame 1, a middle frame
 * ("刪一幀"); redelay frame 3 to 550ms ("改 delay" -- chosen as a multiple of
 * 10ms so the ms<->cs round trip through gifenc's `Math.round(delay/10)` is
 * exact, and deliberately on the frame *after* the deletion point so the test
 * actually exercises delaysMs/keep filter alignment past a deletion); set
 * loop to 5 ("改 loop").
 */
import { describe, expect, it } from 'vitest'
import { encodeGif } from '../../src/lib/gif-encode.js'
import { parseGif } from '../../src/lib/gif-reader.js'
import { decodeGif, type DecodedGif } from './decode.js'
import { applyEdits, createInitialEditState, setFrameDelay, setFrameKept, setLoop } from './edit.js'
import { buildGif, type RgbColor } from './fixtures/generate.js'

const BG: RgbColor = [10, 20, 30]
const C1: RgbColor = [200, 50, 50]
const TRANSPARENT_SLOT: RgbColor = [0, 0, 0] // color is irrelevant -- this index is only ever used transparently
const C3: RgbColor = [50, 60, 200]

function buildMainFixtureGif(): Uint8Array {
  return buildGif({
    width: 2,
    height: 2,
    gct: [BG, C1, TRANSPARENT_SLOT, C3],
    loop: 3,
    frames: [
      { left: 0, top: 0, width: 2, height: 2, delayCs: 5, disposal: 0, pixels: [0, 0, 0, 0] },
      { left: 0, top: 0, width: 2, height: 2, delayCs: 8, disposal: 2, pixels: [1, 1, 1, 1] },
      { left: 0, top: 0, width: 1, height: 1, delayCs: 13, disposal: 0, transparentIndex: 2, pixels: [2] },
      { left: 0, top: 0, width: 2, height: 2, delayCs: 21, disposal: 0, pixels: [3, 3, 3, 3] },
    ],
  })
}

/** decode -> delete frame 1 -> redelay frame 3 to 550ms -> loop 5 -> encode. Shared by the main-line and re-decode-closed-loop tests below. */
function runMainPipeline(): { decoded: DecodedGif; encodedBytes: Uint8Array } {
  const decoded = decodeGif(buildMainFixtureGif())
  let state = createInitialEditState(decoded)
  state = setFrameKept(state, 1, false)
  state = setFrameDelay(state, 3, 550)
  state = setLoop(state, 5)
  const encodedBytes = encodeGif(applyEdits(decoded, state))
  return { decoded, encodedBytes }
}

describe('S3-T3.3 端到端管線: decodeGif -> edit.ts -> encodeGif -> gif-reader', () => {
  it('decodes the raw fixture with the documented ground truth (sanity check before editing)', () => {
    const decoded = decodeGif(buildMainFixtureGif())
    expect(decoded.frames).toHaveLength(4)
    expect(decoded.delaysMs).toEqual([50, 80, 130, 210])
    expect(decoded.loop).toBe(4) // NETSCAPE wire loopCount 3 -> numPlays 3+1
  })

  it('frame count equals the kept count, disposal is forced to 2 on every frame, delays match edited intent with correct keep-filter alignment across the deletion, the transparent frame keeps its flag, and the trailer is present', () => {
    const { encodedBytes } = runMainPipeline()
    const parsed = parseGif(encodedBytes)

    expect(parsed.header).toBe('GIF89a')
    expect(parsed.hasValidTrailer).toBe(true)
    // 4 raw frames, 1 deleted -> 3 kept.
    expect(parsed.frameCount).toBe(3)
    // loop=5 -> numPlaysToRepeat(5) = 5-1 = 4 (src/lib/gif-encode.ts's documented mapping).
    expect(parsed.loopCount).toBe(4)

    const gces = parsed.graphicControlExtensions
    expect(gces).toHaveLength(3)
    // encodeGif forces disposal 2 on every frame regardless of source disposal/transparency.
    expect(gces.map((g) => g.disposalMethod)).toEqual([2, 2, 2])
    // [original frame 0 unchanged, original frame 2 unchanged, original frame 3 redelayed
    // 210ms->550ms (21cs->55cs)] -- frame 3's new delay landing at output index 2 (not
    // index 3) proves delaysMs/keep stayed aligned past the deleted frame 1.
    expect(gces.map((g) => g.delayCentiseconds)).toEqual([5, 13, 55])
    // Only the middle output frame (original frame 2, the disposal-2-revealed
    // fully-transparent frame) carries the transparent flag.
    expect(gces.map((g) => g.transparentColorFlag)).toEqual([false, true, false])
  })
})

describe('S3-T3.3 NETSCAPE loop 三分支 (透過完整管線, 不只 encodeGif 單元)', () => {
  const decoded = decodeGif(buildMainFixtureGif())

  function encodeWithLoop(n: number): Uint8Array {
    const state = setLoop(createInitialEditState(decoded), n)
    return encodeGif(applyEdits(decoded, state))
  }

  it('setLoop(0) (infinite) -> NETSCAPE loop count 0', () => {
    expect(parseGif(encodeWithLoop(0)).loopCount).toBe(0)
  })

  it('setLoop(1) (play once) -> NETSCAPE extension omitted entirely (loopCount reads back undefined)', () => {
    expect(parseGif(encodeWithLoop(1)).loopCount).toBeUndefined()
  })

  it('setLoop(n), n>1 -> NETSCAPE loop count n-1', () => {
    expect(parseGif(encodeWithLoop(6)).loopCount).toBe(5)
  })
})

describe('S3-T3.3 再解碼閉環: encodeGif 輸出經 decodeGif 讀回, 與編輯意圖一致', () => {
  it('frame count, delaysMs, and loop all match the edited intent after a full decode -> edit -> encode -> decode round trip', () => {
    const { encodedBytes } = runMainPipeline()
    const redecoded = decodeGif(encodedBytes)

    expect(redecoded.frames).toHaveLength(3)
    expect(redecoded.delaysMs).toEqual([50, 130, 550])
    // encodeGif wrote NETSCAPE loop count 4 (from loop=5 edited above) -> decodeGif reads
    // it back as numPlays 4+1=5, matching the edit intent exactly.
    expect(redecoded.loop).toBe(5)
  })

  it('the transparent frame round-trips as fully transparent (alpha 0 in every pixel) after re-decoding', () => {
    const { encodedBytes } = runMainPipeline()
    const redecoded = decodeGif(encodedBytes)
    const alphaChannel = redecoded.frames[1].data.filter((_, i) => i % 4 === 3)
    expect(Array.from(alphaChannel)).toEqual([0, 0, 0, 0])
  })
})

describe('S3-T3.3 0 幀輸入: decodeGif 靜默回空, 但完整編輯管線在 applyEdits 明確拋錯', () => {
  /**
   * A spec-valid GIF with a header, LSD, GCT, and trailer but zero Image
   * Descriptor blocks -- the fuller cousin of decode.test.ts's bare-signature
   * case, built through the same `buildGif` fixture path used everywhere
   * else in this file rather than the bare 6-byte signature decode.test.ts
   * already covers.
   */
  function buildHeaderPlusTrailerOnlyGif(): Uint8Array {
    return buildGif({
      width: 1,
      height: 1,
      gct: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      loop: null,
      frames: [],
    })
  }

  it('decodeGif does not throw on a 0-Image-Descriptor GIF -- it silently returns an empty (0-frame) DecodedGif (gifuct-js tolerance; observed, decode.ts left unchanged)', () => {
    const decoded = decodeGif(buildHeaderPlusTrailerOnlyGif())
    expect(decoded.frames).toEqual([])
    expect(decoded.delaysMs).toEqual([])
  })

  it('...but createInitialEditState -> applyEdits on that empty DecodedGif throws explicitly, so the pipeline as a whole never reaches encodeGif with a silent empty animation', () => {
    const decoded = decodeGif(buildHeaderPlusTrailerOnlyGif())
    const state = createInitialEditState(decoded)
    expect(() => applyEdits(decoded, state)).toThrow(/cannot apply edits that remove every frame/)
  })
})
