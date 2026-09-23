// T4.2（(internal design doc) §D4）：主題模組於任何渲染前
// import——<head> 的 inline script 已在解析階段套用 data-theme（防 FOUC），
// 這裡只需接上 toggle 鈕的 wiring 與 aria-pressed 同步，故在檔案最上方、
// 其餘功能邏輯之前完成。
import { initThemeSync, initThemeToggle } from '../../src/theme.js'

import '../../src/style.css'
import './style.css'

import parseAPNG from 'apng-js'
import { assertPngMagicBytes, mapApngResult, extractFrameRgba, type ApngMeta } from './decode.js'
import { composite, createTransparentCanvas, type RGBAFrame } from '../../src/lib/composite.js'
import { convertToGif, type ConvertOptions, type DecodedAnimation } from './convert.js'
import type { WorkerRequest, WorkerResponse } from './encode.worker.js'

const ONE_GIB = 1024 ** 3

// 主題切換鈕 wiring：本頁沒有其他「渲染」步驟先於此執行（見上方 import 註解）。
initThemeToggle(document.querySelector('.theme-toggle') as HTMLButtonElement)
// (internal design doc) 里程碑 2：OS 偏好變更／其他分頁 storage 事件即時同步 toggle 鈕。
initThemeSync(document.querySelector('.theme-toggle') as HTMLButtonElement)

// ---- DOM references (main.ts is the last element in <body>, so every
// referenced id is already parsed by the time this module runs) ----
const fileDropEl = document.getElementById('file-drop') as HTMLDivElement
const fileInputEl = document.getElementById('file-input') as HTMLInputElement
const selectedFilenameEl = document.getElementById('selected-filename') as HTMLParagraphElement
const alphaThresholdEl = document.getElementById('alpha-threshold') as HTMLInputElement
const matteColorEl = document.getElementById('matte-color') as HTMLInputElement
const convertButtonEl = document.getElementById('convert-button') as HTMLButtonElement
const progressSectionEl = document.getElementById('progress-section') as HTMLElement
const progressBarEl = document.getElementById('progress-bar') as HTMLProgressElement
const progressStatusEl = document.getElementById('progress-status') as HTMLParagraphElement
const errorMessageEl = document.getElementById('error-message') as HTMLDivElement
const warningMessageEl = document.getElementById('warning-message') as HTMLDivElement
const warningTextEl = document.getElementById('warning-text') as HTMLParagraphElement
const warningContinueButtonEl = document.getElementById('warning-continue-button') as HTMLButtonElement
const originalPreviewEl = document.getElementById('original-preview') as HTMLImageElement
const resultPreviewEl = document.getElementById('result-preview') as HTMLImageElement
const resultSectionEl = document.getElementById('result-section') as HTMLElement
const playPauseButtonEl = document.getElementById('play-pause-button') as HTMLButtonElement
const downloadLinkEl = document.getElementById('download-link') as HTMLAnchorElement

// ---- Module state for the currently loaded file / in-flight conversion ----
let cachedFile: File | null = null
let cachedMeta: ApngMeta | null = null
let worker: Worker | null | undefined // undefined = not attempted yet, null = construction failed once already

let originalObjectUrl: string | null = null
let resultObjectUrl: string | null = null
let posterObjectUrl: string | null = null

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
let isPaused = reducedMotionQuery.matches

reducedMotionQuery.addEventListener('change', (event) => {
  isPaused = event.matches
  updatePreviewPlaybackState()
})

// ---- File selection: click-to-open comes free from the native <label for>
// wired in index.html; only drag-and-drop and the input's change event need
// wiring here (PLAN.md「拖放的鍵盤等效＝原生選檔器」). ----
fileInputEl.addEventListener('change', () => {
  const file = fileInputEl.files?.[0]
  if (file) void handleFileSelected(file)
})

fileDropEl.addEventListener('dragover', (event) => {
  event.preventDefault()
  fileDropEl.classList.add('is-dragover')
})

fileDropEl.addEventListener('dragleave', () => {
  fileDropEl.classList.remove('is-dragover')
})

fileDropEl.addEventListener('drop', (event) => {
  event.preventDefault()
  fileDropEl.classList.remove('is-dragover')
  const file = event.dataTransfer?.files[0]
  if (file) void handleFileSelected(file)
})

async function handleFileSelected(file: File): Promise<void> {
  resetMessages()
  resetForNewFile()
  resetProgress()
  convertButtonEl.disabled = true

  selectedFilenameEl.textContent = file.name
  selectedFilenameEl.hidden = false

  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
    assertPngMagicBytes(buffer)
  } catch (error) {
    showError(error)
    return
  }

  let meta: ApngMeta
  try {
    meta = mapApngResult(parseAPNG(buffer), buffer)
  } catch (error) {
    showError(error)
    return
  }

  cachedFile = file
  cachedMeta = meta

  originalObjectUrl = URL.createObjectURL(file)
  originalPreviewEl.alt = '原始 APNG 動畫預覽'

  try {
    // Cheap (single frame) -- generated eagerly right after parsing so the
    // pause control and the prefers-reduced-motion poster are both correct
    // from the moment the original preview appears, not only after a full
    // conversion completes (code review Fix 2 / DRIFT A-1).
    await preparePosterFromFirstFrame(meta)
  } catch {
    // Poster generation failing shouldn't block the preview or conversion --
    // the real per-frame decode in runConversion will surface a proper,
    // user-visible error if this file is actually undecodable. Without a
    // poster, updatePreviewPlaybackState() simply falls back to the live
    // animated source regardless of paused/reduced-motion state.
  }

  originalPreviewEl.hidden = false
  playPauseButtonEl.hidden = false
  updatePreviewPlaybackState()

  if (!meta.isAnimated) {
    showInfoNotice('來源為非動畫 PNG，將轉為單幀 GIF。')
  }

  convertButtonEl.disabled = false
}

/**
 * Decode + composite just frame 0 (cheap: one frame) to produce the poster
 * source. For a non-animated PNG, decode.ts's single-frame fallback already
 * uses the whole original file as that one frame's image data with
 * disposeOp NONE / blendOp SOURCE, so this naturally reproduces the original
 * image itself as the poster -- no separate branch needed for that case.
 */
async function preparePosterFromFirstFrame(meta: ApngMeta): Promise<void> {
  const frameMeta = meta.frames[0]
  const rgba = await extractFrameRgba(frameMeta.imageData, frameMeta.width, frameMeta.height)
  const step = composite(createTransparentCanvas(meta.width, meta.height), rgba, {
    left: frameMeta.left,
    top: frameMeta.top,
    disposeOp: frameMeta.disposeOp,
    blendOp: frameMeta.blendOp,
    isFirstFrame: true,
  })
  await preparePoster(step.displayed)
}

/** A brand-new file invalidates everything tied to the previous one. */
function resetForNewFile(): void {
  if (originalObjectUrl) URL.revokeObjectURL(originalObjectUrl)
  originalObjectUrl = null
  if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl)
  posterObjectUrl = null
  if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl)
  resultObjectUrl = null

  originalPreviewEl.hidden = true
  resultPreviewEl.hidden = true
  playPauseButtonEl.hidden = true
  downloadLinkEl.hidden = true
}

// ---- Conversion: decode -> composite -> encode (worker, with main-thread
// fallback), triggered by the convert button so option fields (threshold /
// matte) are read at click time, not at file-select time. ----
convertButtonEl.addEventListener('click', () => {
  void runConversion()
})

async function runConversion(): Promise<void> {
  const meta = cachedMeta
  const file = cachedFile
  if (!meta || !file) return

  resetMessages()
  hidePreviousResult()
  setBusy(true)

  try {
    // The non-animated notice was already shown once in handleFileSelected
    // (right when we learned isAnimated, before the user even saw the
    // convert button) -- resetMessages() above cleared it, but there's no
    // need to re-announce the same fact again here.
    const estimatedBytes = meta.width * meta.height * 4 * meta.frames.length
    if (estimatedBytes > ONE_GIB) {
      await confirmLargeFile(estimatedBytes)
    }

    showProgress()
    const progressThrottle = createProgressThrottle()
    const totalSteps = meta.frames.length * 2 // decode phase + encode phase

    let canvasState = createTransparentCanvas(meta.width, meta.height)
    const displayed: RGBAFrame[] = []
    for (let i = 0; i < meta.frames.length; i++) {
      const frameMeta = meta.frames[i]
      const rgba = await extractFrameRgba(frameMeta.imageData, frameMeta.width, frameMeta.height)
      const step = composite(canvasState, rgba, {
        left: frameMeta.left,
        top: frameMeta.top,
        disposeOp: frameMeta.disposeOp,
        blendOp: frameMeta.blendOp,
        isFirstFrame: i === 0,
      })
      displayed.push(step.displayed)
      canvasState = step.next

      const percent = Math.round(((i + 1) / totalSteps) * 100)
      if (progressThrottle(percent)) {
        updateProgress(`解碼中 ${i + 1}/${meta.frames.length} 幀`, percent)
      }
    }

    // Poster already exists from handleFileSelected (frame 0's pixels don't
    // depend on alphaThreshold/matteColor/maxColors, so it stays valid
    // across a re-conversion of the same source file) -- nothing to
    // regenerate here before the transfer-list postMessage below.
    const delaysMs = meta.frames.map((frameMeta) => frameMeta.delayMs)
    const options: ConvertOptions = {
      alphaThreshold: alphaThresholdEl.valueAsNumber,
      matteColor: hexToRgb(matteColorEl.value),
    }

    const onEncodeProgress = (done: number, total: number): void => {
      const percent = Math.round(((meta.frames.length + done) / totalSteps) * 100)
      if (progressThrottle(percent)) {
        updateProgress(`編碼中 ${done}/${total} 幀`, percent)
      }
    }

    let gifBytes: Uint8Array
    if (worker === undefined) worker = createEncodeWorker()
    if (worker) {
      const request: WorkerRequest = {
        // .buffer is typed ArrayBufferLike (ArrayBuffer | SharedArrayBuffer);
        // this project never uses SharedArrayBuffer (see encode.worker.ts's
        // top comment for the full rationale), so this narrowing is safe.
        frames: displayed.map((frame) => ({
          buffer: frame.data.buffer as ArrayBuffer,
          width: frame.width,
          height: frame.height,
        })),
        delaysMs,
        loop: meta.numPlays,
        options,
      }
      gifBytes = await runEncodeInWorker(worker, request, onEncodeProgress)
    } else {
      const anim: DecodedAnimation = { frames: displayed, delaysMs, loop: meta.numPlays }
      gifBytes = convertToGif(anim, {
        ...options,
        onFrameEncoded: (index, total) => onEncodeProgress(index + 1, total),
      })
    }

    updateProgress('轉換完成', 100)
    showResult(gifBytes, file.name)
  } catch (error) {
    showError(error)
  } finally {
    setBusy(false)
  }
}

function createEncodeWorker(): Worker | null {
  try {
    // The `new URL(...)` must stay inline (not through a variable) for
    // Vite's static worker-bundling analysis to pick it up.
    const instance = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' })
    return instance
  } catch {
    return null
  }
}

function runEncodeInWorker(
  activeWorker: Worker,
  request: WorkerRequest,
  onProgress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent<WorkerResponse>): void => {
      const data = event.data
      if (data.type === 'progress') {
        onProgress(data.done, data.total)
      } else if (data.type === 'done') {
        cleanup()
        resolve(new Uint8Array(data.gif))
      } else if (data.type === 'error') {
        cleanup()
        reject(new Error(data.message))
      }
    }
    const handleError = (event: ErrorEvent): void => {
      cleanup()
      reject(new Error(event.message || 'worker 發生未知錯誤'))
    }
    function cleanup(): void {
      activeWorker.removeEventListener('message', handleMessage)
      activeWorker.removeEventListener('error', handleError)
    }

    activeWorker.addEventListener('message', handleMessage)
    activeWorker.addEventListener('error', handleError)

    const transfer = request.frames.map((frame) => frame.buffer)
    activeWorker.postMessage(request, transfer)
  })
}

// ---- Large-file gate: width*height*4*frameCount is computable straight
// from metadata, before spending time decoding any pixels. ----
function confirmLargeFile(estimatedBytes: number): Promise<void> {
  const mib = Math.round(estimatedBytes / (1024 * 1024))
  warningContinueButtonEl.hidden = false
  warningMessageEl.classList.remove('is-empty')
  warningTextEl.textContent = `此動畫預估解碼記憶體用量約 ${mib} MiB，轉換可能導致瀏覽器變慢或沒有回應。仍要繼續嗎？`
  warningContinueButtonEl.focus()

  return new Promise((resolve) => {
    const handleClick = (): void => {
      warningContinueButtonEl.removeEventListener('click', handleClick)
      warningMessageEl.classList.add('is-empty')
      warningTextEl.textContent = ''
      warningContinueButtonEl.hidden = true
      resolve()
    }
    warningContinueButtonEl.addEventListener('click', handleClick)
  })
}

// ---- Progress: <progress> + aria-live=polite status text, throttled to at
// most one DOM update per 10 percentage points or 500ms (PLAN.md). ----
function createProgressThrottle(): (percent: number) => boolean {
  let lastPercent = -100
  let lastTime = 0
  return (percent: number): boolean => {
    const now = performance.now()
    if (percent >= 100 || percent - lastPercent >= 10 || now - lastTime >= 500) {
      lastPercent = percent
      lastTime = now
      return true
    }
    return false
  }
}

function showProgress(): void {
  progressSectionEl.hidden = false
  progressBarEl.value = 0
}

function resetProgress(): void {
  progressSectionEl.hidden = true
  progressBarEl.value = 0
  progressStatusEl.textContent = ''
}

function updateProgress(text: string, percent: number): void {
  progressBarEl.value = percent
  progressStatusEl.textContent = text
}

// ---- Error / info / warning messaging ----
// #error-message/#warning-message are permanently mounted (see index.html)
// so a screen reader's live-region watcher is always attached to them --
// these functions only ever write textContent and toggle the purely-visual
// `is-empty` class (see style.css), never `hidden`/display/visibility, on
// the message containers themselves.
function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  errorMessageEl.classList.remove('is-empty')
  errorMessageEl.textContent = message
}

function showInfoNotice(text: string): void {
  warningContinueButtonEl.hidden = true
  warningMessageEl.classList.remove('is-empty')
  warningTextEl.textContent = text
}

function resetMessages(): void {
  errorMessageEl.classList.add('is-empty')
  errorMessageEl.textContent = ''
  warningMessageEl.classList.add('is-empty')
  warningTextEl.textContent = ''
  warningContinueButtonEl.hidden = true
}

function setBusy(busy: boolean): void {
  convertButtonEl.disabled = busy
  fileInputEl.disabled = busy
}

// ---- Poster (frame 0, rendered from our own decode+composite pipeline) --
// used as the paused/reduced-motion still image for BOTH previews. Not
// pixel-identical to the encoded GIF's own frame 0 (that's threshold/matte/
// palette-reduced by convert.ts), but visually representative and avoids a
// second decode path just for a poster. ----
async function preparePoster(frame: RGBAFrame): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Same ArrayBufferLike/ArrayBuffer narrowing as encode.worker.ts's top comment.
  const clamped = frame.data as Uint8ClampedArray<ArrayBuffer>
  ctx.putImageData(new ImageData(clamped, frame.width, frame.height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return

  if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl)
  posterObjectUrl = URL.createObjectURL(blob)
}

// ---- Play/pause: one global toggle covers both previews (WCAG 2.2.2) by
// swapping each <img>'s src between its live animated source and the shared
// frame-0 poster -- there is no native way to pause an animated GIF/APNG
// inside an <img>. ----
playPauseButtonEl.addEventListener('click', () => {
  isPaused = !isPaused
  updatePreviewPlaybackState()
})

function updatePreviewPlaybackState(): void {
  playPauseButtonEl.setAttribute('aria-pressed', String(isPaused))
  playPauseButtonEl.textContent = isPaused ? '播放' : '暫停'

  if (originalObjectUrl) {
    originalPreviewEl.src = isPaused && posterObjectUrl ? posterObjectUrl : originalObjectUrl
  }
  if (resultObjectUrl) {
    resultPreviewEl.src = isPaused && posterObjectUrl ? posterObjectUrl : resultObjectUrl
  }
}

// ---- Result: GIF blob -> preview + download link, then focus-management +
// status announcement for completion (WCAG 4.1.3). ----
// Note: the play/pause button's visibility is owned by handleFileSelected /
// resetForNewFile (it controls the original preview from the moment a file
// loads, independent of whether a result exists yet), not by this function.
function hidePreviousResult(): void {
  resultPreviewEl.hidden = true
  downloadLinkEl.hidden = true
  if (resultObjectUrl) {
    URL.revokeObjectURL(resultObjectUrl)
    resultObjectUrl = null
  }
}

function showResult(gifBytes: Uint8Array, originalFileName: string): void {
  // Same ArrayBufferLike/ArrayBuffer narrowing as encode.worker.ts's top comment.
  const blob = new Blob([gifBytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' })
  resultObjectUrl = URL.createObjectURL(blob)

  const downloadName = `${originalFileName.replace(/\.a?png$/i, '')}.gif`
  resultPreviewEl.alt = `轉換後 GIF 預覽：${downloadName}`
  resultPreviewEl.hidden = false
  downloadLinkEl.href = resultObjectUrl
  downloadLinkEl.download = downloadName
  downloadLinkEl.hidden = false

  updatePreviewPlaybackState()
  resultSectionEl.focus()
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) return [255, 255, 255]
  return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)]
}
