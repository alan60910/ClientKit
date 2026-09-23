/**
 * Smoke tests for the thin re-export layer in `convert.ts` ((internal design doc)
 * /PLAN.md §3). The actual pipeline logic and its full test suite live at
 * `src/lib/gif-encode.ts` / `src/lib/gif-encode.test.ts` — this file only
 * guards that the re-export itself stays wired correctly.
 */
import { describe, expect, it } from 'vitest'
import { encodeGif, type GifEncodeInput } from '../../src/lib/gif-encode.js'
import { parseGif } from '../../src/lib/gif-reader.js'
import { makeSolidFrame } from '../../src/lib/test-helpers.js'
import { convertToGif, type DecodedAnimation } from './convert.js'

describe('convert.ts re-export layer (S3-T1.3)', () => {
  it('convertToGif is the same function object as encodeGif (identity, not a wrapper)', () => {
    expect(convertToGif).toBe(encodeGif)
  })

  it('convertToGif encodes a single-frame animation into a well-formed, one-frame GIF89a stream', () => {
    const anim: DecodedAnimation = {
      frames: [makeSolidFrame(2, 2, 1, 2, 3)],
      delaysMs: [100],
      loop: 0,
    }
    const alsoViaEncodeGif: GifEncodeInput = anim // structural compatibility check

    const parsed = parseGif(convertToGif(anim))
    expect(parsed.header).toBe('GIF89a')
    expect(parsed.frameCount).toBe(1)
    expect(parsed.hasValidTrailer).toBe(true)
    expect(alsoViaEncodeGif).toBe(anim)
  })
})
