import { describe, expect, it } from 'vitest'
import type { GifEncodeInput } from '../../src/lib/gif-encode.js'
import { makeSolidFrame } from '../../src/lib/test-helpers.js'
import { applyEdits, createInitialEditState, setAllDelays, setFrameDelay, setFrameKept, setLoop } from './edit.js'

function makeAnim(delaysMs: number[], loop = 1): GifEncodeInput {
  const frames = delaysMs.map((_, i) => makeSolidFrame(2, 2, i * 10, i * 20, i * 30))
  return { frames, delaysMs, loop }
}

describe('createInitialEditState', () => {
  it('projects keep=all-true, delaysMs, and loop from the source animation', () => {
    const anim = makeAnim([10, 20, 30], 5)
    const state = createInitialEditState(anim)
    expect(state.keep).toEqual([true, true, true])
    expect(state.delaysMs).toEqual([10, 20, 30])
    expect(state.loop).toBe(5)
  })

  it('copies delaysMs rather than aliasing the source array', () => {
    const anim = makeAnim([10, 20, 30])
    const state = createInitialEditState(anim)
    expect(state.delaysMs).not.toBe(anim.delaysMs)
    state.delaysMs[0] = 999
    expect(anim.delaysMs).toEqual([10, 20, 30])
  })

  it('handles a single-frame animation', () => {
    const anim = makeAnim([42])
    const state = createInitialEditState(anim)
    expect(state.keep).toEqual([true])
    expect(state.delaysMs).toEqual([42])
  })
})

describe('applyEdits: non-contiguous keep alignment', () => {
  it('filters frames and delaysMs in lockstep for [true, false, true]', () => {
    const anim = makeAnim([100, 200, 300], 3)
    const initial = createInitialEditState(anim)
    const state = setFrameKept(initial, 1, false)

    const result = applyEdits(anim, state)

    expect(result.frames).toHaveLength(2)
    expect(result.frames[0]).toBe(anim.frames[0])
    expect(result.frames[1]).toBe(anim.frames[2])
    // The off-by-one trap: post-filter delaysMs[1] must be the original
    // *third* frame's delay (300), not the deleted middle frame's (200).
    expect(result.delaysMs).toEqual([100, 300])
    expect(result.loop).toBe(3)
  })

  it('reflects edited (not original) delaysMs when a kept frame was also re-delayed', () => {
    const anim = makeAnim([100, 200, 300])
    let state = createInitialEditState(anim)
    state = setFrameKept(state, 0, false)
    state = setFrameDelay(state, 2, 777)

    const result = applyEdits(anim, state)

    expect(result.frames).toEqual([anim.frames[1], anim.frames[2]])
    expect(result.delaysMs).toEqual([200, 777])
  })

  it('restore direction: deleting then re-keeping the same frame returns applyEdits output to its pre-delete state', () => {
    const anim = makeAnim([100, 200, 300], 3)
    const initial = createInitialEditState(anim)
    const deleted = setFrameKept(initial, 1, false)
    const restored = setFrameKept(deleted, 1, true)

    const result = applyEdits(anim, restored)

    expect(result.frames).toHaveLength(3)
    expect(result.frames).toEqual(anim.frames)
    expect(result.delaysMs).toEqual(anim.delaysMs)
  })
})

describe('applyEdits: single-frame boundary', () => {
  it('throws when the only frame is deleted', () => {
    const anim = makeAnim([50])
    const state = setFrameKept(createInitialEditState(anim), 0, false)
    expect(() => applyEdits(anim, state)).toThrow()
  })

  it('succeeds (identity) when the only frame is kept', () => {
    const anim = makeAnim([50])
    const state = createInitialEditState(anim)
    const result = applyEdits(anim, state)
    expect(result.frames).toEqual([anim.frames[0]])
    expect(result.delaysMs).toEqual([50])
  })
})

describe('applyEdits: delete-everything throws', () => {
  it('throws when every frame across a multi-frame animation is unkept', () => {
    const anim = makeAnim([10, 20, 30])
    let state = createInitialEditState(anim)
    state = setFrameKept(state, 0, false)
    state = setFrameKept(state, 1, false)
    state = setFrameKept(state, 2, false)
    expect(() => applyEdits(anim, state)).toThrow()
  })
})

describe('applyEdits: equal-length precondition', () => {
  it('throws when state.keep length does not match anim.frames length', () => {
    const anim = makeAnim([10, 20, 30])
    const state = createInitialEditState(anim)
    const badState = { ...state, keep: [true, true] }
    expect(() => applyEdits(anim, badState)).toThrow()
  })

  it('throws when state.delaysMs length does not match anim.frames length', () => {
    const anim = makeAnim([10, 20, 30])
    const state = createInitialEditState(anim)
    const badState = { ...state, delaysMs: [10, 20] }
    expect(() => applyEdits(anim, badState)).toThrow()
  })
})

describe('setter invalid-input contract', () => {
  it('setFrameKept throws on a negative index', () => {
    const anim = makeAnim([10, 20, 30])
    const state = createInitialEditState(anim)
    expect(() => setFrameKept(state, -1, true)).toThrow()
  })

  it('setFrameKept throws on an index past the end', () => {
    const anim = makeAnim([10, 20, 30])
    const state = createInitialEditState(anim)
    expect(() => setFrameKept(state, 3, true)).toThrow()
  })

  it('setFrameDelay throws on an out-of-range index', () => {
    const anim = makeAnim([10, 20, 30])
    const state = createInitialEditState(anim)
    expect(() => setFrameDelay(state, -1, 100)).toThrow()
    expect(() => setFrameDelay(state, 3, 100)).toThrow()
  })

  it('setFrameDelay normalizes (does not throw on) a negative or NaN delay', () => {
    const anim = makeAnim([10, 20, 30])
    const state = createInitialEditState(anim)
    expect(setFrameDelay(state, 0, -5).delaysMs[0]).toBe(20)
    expect(setFrameDelay(state, 0, NaN).delaysMs[0]).toBe(20)
  })

  it('setLoop throws on a negative loop count', () => {
    const anim = makeAnim([10])
    const state = createInitialEditState(anim)
    expect(() => setLoop(state, -1)).toThrow()
  })

  it('setLoop throws on NaN', () => {
    const anim = makeAnim([10])
    const state = createInitialEditState(anim)
    expect(() => setLoop(state, NaN)).toThrow()
  })

  it('setLoop throws on a non-integer loop count', () => {
    const anim = makeAnim([10])
    const state = createInitialEditState(anim)
    expect(() => setLoop(state, 1.5)).toThrow()
  })
})

describe('delay floor at 20ms', () => {
  it('setFrameDelay floors a sub-floor value and leaves an above-floor value alone', () => {
    const anim = makeAnim([10, 20, 30])
    const state = createInitialEditState(anim)
    expect(setFrameDelay(state, 0, 15).delaysMs[0]).toBe(20)
    expect(setFrameDelay(state, 0, 25).delaysMs[0]).toBe(25)
  })

  it('setAllDelays floors every entry to the same normalized value', () => {
    const anim = makeAnim([10, 20, 30])
    const state = createInitialEditState(anim)
    expect(setAllDelays(state, 5).delaysMs).toEqual([20, 20, 20])
    expect(setAllDelays(state, 100).delaysMs).toEqual([100, 100, 100])
  })
})

describe('loop boundaries', () => {
  it('accepts 0 (infinite), 1 (once), and n (>1)', () => {
    const anim = makeAnim([10])
    const state = createInitialEditState(anim)
    expect(setLoop(state, 0).loop).toBe(0)
    expect(setLoop(state, 1).loop).toBe(1)
    expect(setLoop(state, 7).loop).toBe(7)
  })
})

describe('immutability', () => {
  it('never mutates the source anim or any prior EditState across a chain of edits', () => {
    const anim = makeAnim([100, 200, 300], 3)
    const originalFramesRef = anim.frames
    const originalDelaysRef = anim.delaysMs

    const state0 = createInitialEditState(anim)
    const state1 = setFrameKept(state0, 0, false)
    const state2 = setFrameDelay(state1, 1, 500)
    const state3 = setAllDelays(state2, 40)
    const state4 = setLoop(state3, 9)
    const result = applyEdits(anim, state4)

    // anim itself: same array references, same content.
    expect(anim.frames).toBe(originalFramesRef)
    expect(anim.delaysMs).toBe(originalDelaysRef)
    expect(anim.delaysMs).toEqual([100, 200, 300])
    expect(anim.loop).toBe(3)

    // Each intermediate state is frozen in time -- later calls must not
    // reach back and mutate an earlier state's arrays.
    expect(state0.keep).toEqual([true, true, true])
    expect(state0.delaysMs).toEqual([100, 200, 300])
    expect(state0.loop).toBe(3)

    expect(state1.keep).toEqual([false, true, true])
    expect(state1.delaysMs).toEqual([100, 200, 300])

    expect(state2.delaysMs).toEqual([100, 500, 300])
    expect(state2.keep).toEqual([false, true, true])

    expect(state3.delaysMs).toEqual([40, 40, 40])
    expect(state3.loop).toBe(3)

    expect(state4.loop).toBe(9)
    expect(state4.delaysMs).toEqual([40, 40, 40])

    // Final result is a distinct object built from state4, not aliasing it.
    expect(result.delaysMs).not.toBe(state4.delaysMs)
  })

  it('setFrameKept returns a new keep array, not a mutated alias of the input', () => {
    const anim = makeAnim([10, 20])
    const state = createInitialEditState(anim)
    const next = setFrameKept(state, 0, false)
    expect(next.keep).not.toBe(state.keep)
    expect(state.keep).toEqual([true, true])
    expect(next.keep).toEqual([false, true])
  })

  it('setFrameDelay returns a new delaysMs array, not a mutated alias of the input', () => {
    const anim = makeAnim([10, 20])
    const state = createInitialEditState(anim)
    const next = setFrameDelay(state, 0, 999)
    expect(next.delaysMs).not.toBe(state.delaysMs)
    expect(state.delaysMs).toEqual([10, 20])
    expect(next.delaysMs).toEqual([999, 20])
  })
})
