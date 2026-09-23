/**
 * Pure, immutable edit-state functions for the GIF editor
 * ((internal design doc) §4b). Every function returns a *new* object;
 * neither the `EditState` passed in nor the `GifEncodeInput` passed to
 * `applyEdits` is ever mutated.
 *
 * Only depends on `GifEncodeInput` (not tools/gif-editor/decode.ts's
 * `DecodedGif`) so this module has zero coupling with the parallel decode.ts
 * lane -- `DecodedGif` is structurally assignable to `GifEncodeInput` (same
 * `frames`/`delaysMs`/`loop` shape), so decode.ts's output can be passed
 * straight into `createInitialEditState`/`applyEdits` without adaptation.
 */
import { type GifEncodeInput, normalizeDelayMs } from '../../src/lib/gif-encode.js'

export interface EditState {
  keep: boolean[]
  delaysMs: number[]
  /** numPlays semantics, same as GifEncodeInput.loop: 0 = infinite, n = play n times total. */
  loop: number
}

/**
 * Invalid-input contract for every setter below (out-of-range frame index;
 * negative, NaN, or non-integer loop count): **throw**, rather than silently
 * returning the original state unchanged. A well-behaved UI never produces
 * these -- frame indices are bounded by the rendered frame list, and loop
 * count comes from a non-negative integer control -- so they only arise from
 * a caller bug, and failing loudly surfaces that immediately instead of
 * masking it as a silent no-op. This matches `applyEdits`' own precondition
 * assertions elsewhere in this module. Delay values are the deliberate
 * exception: `setFrameDelay`/`setAllDelays` normalize (floor to
 * `MIN_DELAY_MS` via `normalizeDelayMs`) rather than reject, because
 * "too fast" already has a well-defined meaning for a GIF delay.
 */
function assertValidIndex(length: number, index: number, fnName: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error(`${fnName}: index ${index} is out of range for ${length} frame(s)`)
  }
}

/** Projects a decoded/encodable animation into an initial EditState with every frame kept. */
export function createInitialEditState(anim: GifEncodeInput): EditState {
  return {
    keep: anim.frames.map(() => true),
    delaysMs: anim.delaysMs.slice(),
    loop: anim.loop,
  }
}

export function setFrameKept(state: EditState, index: number, kept: boolean): EditState {
  assertValidIndex(state.keep.length, index, 'setFrameKept')
  const keep = state.keep.slice()
  keep[index] = kept
  return { ...state, keep }
}

export function setFrameDelay(state: EditState, index: number, ms: number): EditState {
  assertValidIndex(state.delaysMs.length, index, 'setFrameDelay')
  const delaysMs = state.delaysMs.slice()
  delaysMs[index] = normalizeDelayMs(ms)
  return { ...state, delaysMs }
}

export function setAllDelays(state: EditState, ms: number): EditState {
  const normalized = normalizeDelayMs(ms)
  return { ...state, delaysMs: state.delaysMs.map(() => normalized) }
}

export function setLoop(state: EditState, n: number): EditState {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`setLoop: loop count must be a non-negative integer, got ${n}`)
  }
  return { ...state, loop: n }
}

/**
 * Apply an EditState to its source animation, producing a GifEncodeInput
 * ready for `encodeGif`.
 *
 * Preconditions (thrown, not silently coerced):
 * - `state.keep` and `state.delaysMs` must both have the same length as
 *   `anim.frames` -- a mismatch only happens if `state` was built from a
 *   *different* animation than the one passed here, which is a caller bug
 *   worth surfacing immediately rather than guessing at an alignment.
 * - At least one frame must survive the keep filter -- deleting every frame
 *   would produce an empty (invalid) GIF. The UI is expected to prevent this
 *   at the source (e.g. disable delete on the last remaining frame) rather
 *   than relying on this throw as its primary guard.
 *
 * Filtering keeps `anim.frames` and `state.delaysMs` in lockstep: frame i is
 * kept (and its post-edit delay is `state.delaysMs[i]`) iff `state.keep[i]`
 * is true, so non-contiguous deletions still line up correctly.
 *
 * **Shared buffers warning**: every returned `frames[i]` is the *same* frame
 * object (and therefore the same underlying pixel buffer) as `anim.frames`'s
 * corresponding entry -- this function only filters the array, it never
 * copies pixel data. Safe today because nothing downstream mutates pixels in
 * place; any future code that does must copy a frame's buffer first.
 */
export function applyEdits(anim: GifEncodeInput, state: EditState): GifEncodeInput {
  const frameCount = anim.frames.length
  if (state.keep.length !== frameCount || state.delaysMs.length !== frameCount) {
    throw new Error(
      `applyEdits: length mismatch (frames=${frameCount}, keep=${state.keep.length}, delaysMs=${state.delaysMs.length})`,
    )
  }

  const frames = anim.frames.filter((_, i) => state.keep[i])
  const delaysMs = state.delaysMs.filter((_, i) => state.keep[i])

  if (frames.length === 0) {
    throw new Error('applyEdits: cannot apply edits that remove every frame')
  }

  return { frames, delaysMs, loop: state.loop }
}
