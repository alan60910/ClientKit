/**
 * Thin worker delegate around `../../src/lib/gif-encode.ts`'s `encodeGif`
 * ((internal design doc) §6「Worker」契約: worker only imports +
 * forwards, never re-derives encoding logic -- if main.ts's worker
 * construction fails, main.ts calls `encodeGif` directly on the main thread
 * instead; there is exactly one copy of the encoding logic, same as
 * tools/apng-to-gif/encode.worker.ts's relationship with convert.ts).
 *
 * Typing note: copied from tools/apng-to-gif/encode.worker.ts's identical
 * situation -- this file runs in a Worker's global scope (`self` is a
 * `DedicatedWorkerGlobalScope`, not a `Window`), but tsconfig.json's `lib`
 * already includes "DOM" for the rest of the project and TypeScript does not
 * support loading both "DOM" and "WebWorker" lib.*.d.ts files in the same
 * program. Instead of forking tsconfig for this one file, this module
 * declares the minimal worker-scope shape it actually uses and performs a
 * single explicit cast of the ambient `self` to that shape. `MessageEvent`,
 * `ErrorEvent`, and `Transferable` are all already provided by the "DOM" lib
 * for unrelated reasons, so no additional lib is needed at all.
 */
import { encodeGif, type GifEncodeInput } from '../../src/lib/gif-encode.js'
import type { RGBAFrame } from '../../src/lib/composite.js'

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

const worker = self as unknown as WorkerScope

/**
 * One transferable frame: `buffer` is the raw bytes behind a
 * Uint8ClampedArray. main.ts always sends a *copy* of each frame's buffer
 * (never `decoded.frames[i].data.buffer` directly) -- transferring detaches
 * the buffer on the sending side, and `decoded` must stay valid across
 * repeated conversions of the same file (see main.ts's `runConversion` doc
 * comment).
 */
export interface WorkerFramePayload {
  buffer: ArrayBuffer
  width: number
  height: number
}

export interface WorkerRequest {
  frames: WorkerFramePayload[]
  delaysMs: number[]
  loop: number
}

export type WorkerResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; gif: ArrayBuffer }
  | { type: 'error'; message: string }

worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { frames, delaysMs, loop } = event.data

  try {
    const rgbaFrames: RGBAFrame[] = frames.map((frame) => ({
      data: new Uint8ClampedArray(frame.buffer),
      width: frame.width,
      height: frame.height,
    }))
    const input: GifEncodeInput = { frames: rgbaFrames, delaysMs, loop }
    const total = rgbaFrames.length

    const gif = encodeGif(input, {
      onFrameEncoded: (index) => {
        const progress: WorkerResponse = { type: 'progress', done: index + 1, total }
        worker.postMessage(progress)
      },
    })

    // `Uint8Array.buffer` is typed `ArrayBufferLike` (ArrayBuffer |
    // SharedArrayBuffer) even though it's always a plain ArrayBuffer here --
    // this project never uses SharedArrayBuffer (GitHub Pages can't set the
    // COOP/COEP headers SAB requires).
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
