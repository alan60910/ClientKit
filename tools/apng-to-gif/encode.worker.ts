/**
 * Thin worker delegate around convert.ts's `convertToGif` (PLAN.md「Worker」
 * 契約：worker 僅 import + 轉發，不重複編碼邏輯 -- if main.ts's worker
 * construction fails, main.ts calls `convertToGif` directly on the main
 * thread instead; there is exactly one copy of the encoding logic).
 *
 * Typing note: this file runs in a Worker's global scope (`self` is a
 * `DedicatedWorkerGlobalScope`, not a `Window`), but tsconfig.json's `lib`
 * already includes "DOM" for the rest of the project (main.ts uses
 * `document`, `HTMLImageElement`, etc.), and TypeScript does not support
 * loading both the "DOM" and "WebWorker" lib.*.d.ts files in the same
 * program -- they redeclare globals like `self`/`postMessage` with
 * incompatible types, so `/// <reference lib="webworker" />` here would
 * conflict with the project-wide "DOM" lib rather than fix anything. Instead
 * of forking tsconfig for this one file, this module declares the minimal
 * worker-scope shape it actually uses and performs a single explicit cast of
 * the ambient `self` (which lib.dom.d.ts types as `Window`, wrong here but
 * never used as a `Window`) to that shape. `MessageEvent`, `ErrorEvent`, and
 * `Transferable` are all already provided by the "DOM" lib for unrelated
 * reasons, so no additional lib is needed at all.
 */
import { convertToGif, type ConvertOptions, type DecodedAnimation } from './convert.js'
import type { RGBAFrame } from '../../src/lib/composite.js'

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

const worker = self as unknown as WorkerScope

/** One transferable frame: `buffer` is the raw bytes behind a Uint8ClampedArray. */
export interface WorkerFramePayload {
  buffer: ArrayBuffer
  width: number
  height: number
}

export interface WorkerRequest {
  frames: WorkerFramePayload[]
  delaysMs: number[]
  loop: number
  options?: ConvertOptions
}

export type WorkerResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; gif: ArrayBuffer }
  | { type: 'error'; message: string }

worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { frames, delaysMs, loop, options } = event.data

  try {
    const rgbaFrames: RGBAFrame[] = frames.map((frame) => ({
      data: new Uint8ClampedArray(frame.buffer),
      width: frame.width,
      height: frame.height,
    }))
    const anim: DecodedAnimation = { frames: rgbaFrames, delaysMs, loop }
    const total = rgbaFrames.length

    const gif = convertToGif(anim, {
      ...options,
      onFrameEncoded: (index) => {
        const progress: WorkerResponse = { type: 'progress', done: index + 1, total }
        worker.postMessage(progress)
      },
    })

    // `Uint8Array.buffer` is typed `ArrayBufferLike` (ArrayBuffer |
    // SharedArrayBuffer) even though it's always a plain ArrayBuffer here --
    // this project never uses SharedArrayBuffer (PLAN.md hard constraint:
    // GitHub Pages can't set the COOP/COEP headers SAB requires).
    const buffer = gif.buffer as ArrayBuffer
    const done: WorkerResponse = { type: 'done', gif: buffer }
    worker.postMessage(done, [buffer])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const response: WorkerResponse = { type: 'error', message }
    worker.postMessage(response)
  }
}

worker.onerror = (event: ErrorEvent) => {
  const response: WorkerResponse = { type: 'error', message: event.message || 'worker 發生未知錯誤' }
  worker.postMessage(response)
}
