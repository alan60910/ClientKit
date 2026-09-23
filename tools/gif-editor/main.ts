// T4.2（(internal design doc) §D4）：主題模組於任何渲染前
// import——<head> 的 inline script 已在解析階段套用 data-theme（防 FOUC），
// 這裡只需接上 toggle 鈕的 wiring 與 aria-pressed 同步，故在檔案最上方、
// 其餘功能邏輯之前完成。
import { initThemeSync, initThemeToggle } from '../../src/theme.js'

import '../../src/style.css'
import './style.css'

import { assertGifMagicBytes, decodeGif, estimateDecodedByteSize, type DecodedGif } from './decode.js'
import type { RGBAFrame } from '../../src/lib/composite.js'
import {
  applyEdits,
  createInitialEditState,
  setAllDelays,
  setFrameDelay,
  setFrameKept,
  setLoop,
  type EditState,
} from './edit.js'
import { encodeGif, normalizeDelayMs, type GifEncodeInput } from '../../src/lib/gif-encode.js'
import type { WorkerRequest, WorkerResponse } from './encode.worker.js'

// 幀清單分頁大小（(internal design doc) §5「幀清單（大量幀設計）」，SP-8 驗證）。
const PAGE_SIZE = 50
// 記憶體警示閘閾值：沿用 tools/apng-to-gif/main.ts 的 1 GiB 閾值精神。
const MEMORY_WARNING_THRESHOLD_BYTES = 1024 ** 3
const THUMBNAIL_MAX_EDGE = 96

// 主題切換鈕 wiring：本頁沒有其他「渲染」步驟先於此執行（見上方 import 註解）。
initThemeToggle(document.querySelector('.theme-toggle') as HTMLButtonElement)
// (internal design doc) 里程碑 2：OS 偏好變更／其他分頁 storage 事件即時同步 toggle 鈕。
initThemeSync(document.querySelector('.theme-toggle') as HTMLButtonElement)

// ---- DOM references (main.ts is the last element in <body>, so every
// referenced id is already parsed by the time this module runs) ----
const fileDropEl = document.getElementById('file-drop') as HTMLDivElement
const fileInputEl = document.getElementById('file-input') as HTMLInputElement
const selectedFilenameEl = document.getElementById('selected-filename') as HTMLParagraphElement

const memoryWarningEl = document.getElementById('memory-warning') as HTMLDivElement
const memoryWarningTextEl = document.getElementById('memory-warning-text') as HTMLParagraphElement
const memoryWarningContinueButtonEl = document.getElementById('memory-warning-continue-button') as HTMLButtonElement

const statusMessageEl = document.getElementById('status-message') as HTMLDivElement
const statusTextEl = document.getElementById('status-text') as HTMLParagraphElement

const errorMessageEl = document.getElementById('error-message') as HTMLDivElement

const originalPreviewSectionEl = document.getElementById('original-preview-section') as HTMLElement
const originalPreviewEl = document.getElementById('original-preview') as HTMLImageElement
const originalPosterEl = document.getElementById('original-poster') as HTMLCanvasElement
const pauseButtonEl = document.getElementById('pause-button') as HTMLButtonElement

const frameListSectionEl = document.getElementById('frame-list-section') as HTMLElement
const prevPageButtonEl = document.getElementById('prev-page-button') as HTMLButtonElement
const nextPageButtonEl = document.getElementById('next-page-button') as HTMLButtonElement
const pagePositionStatusEl = document.getElementById('page-position-status') as HTMLParagraphElement
const frameListEl = document.getElementById('frame-list') as HTMLOListElement

const applyAllDelayInputEl = document.getElementById('apply-all-delay-input') as HTMLInputElement
const applyAllDelayButtonEl = document.getElementById('apply-all-delay-button') as HTMLButtonElement
const loopInfiniteCheckboxEl = document.getElementById('loop-infinite-checkbox') as HTMLInputElement
const loopCountInputEl = document.getElementById('loop-count-input') as HTMLInputElement
const convertButtonEl = document.getElementById('convert-button') as HTMLButtonElement

const progressSectionEl = document.getElementById('progress-section') as HTMLElement
const progressBarEl = document.getElementById('progress-bar') as HTMLProgressElement
const progressStatusEl = document.getElementById('progress-status') as HTMLParagraphElement

const resultSectionEl = document.getElementById('result-section') as HTMLElement
const resultPreviewEl = document.getElementById('result-preview') as HTMLImageElement
const resultPosterEl = document.getElementById('result-poster') as HTMLCanvasElement
const downloadLinkEl = document.getElementById('download-link') as HTMLAnchorElement
const sizeComparisonEl = document.getElementById('size-comparison') as HTMLParagraphElement

// ---- Module state for the currently loaded file / in-flight conversion ----
let cachedFile: File | null = null
let decoded: DecodedGif | null = null
let editState: EditState | null = null
let currentPageIndex = 0
let worker: Worker | null | undefined // undefined = not attempted yet, null = construction failed once already

let originalObjectUrl: string | null = null
let resultObjectUrl: string | null = null

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
let isPaused = reducedMotionQuery.matches

reducedMotionQuery.addEventListener('change', (event) => {
  isPaused = event.matches
  updatePreviewPlaybackState()
})

// ---- File selection: click-to-open comes free from the native <label for>
// wired in index.html; only drag-and-drop and the input's change event need
// wiring here. ----
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

/**
 * Best-effort yield so the "解碼中…" status text has a chance to actually
 * paint (and a screen reader a chance to notice the live-region change)
 * before the single synchronous `decodeGif` call freezes the main thread
 * (PLAN §5). Double rAF: the first callback fires just before the *next*
 * paint, so waiting for a second one ensures a paint has already happened by
 * then. This is inherently best-effort -- neither browser paint timing nor a
 * screen reader's announcement timing is something a page can guarantee.
 */
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** Large-file gate: resolves immediately when under threshold or on estimate failure (decodeGif itself will surface a real parse error). */
function confirmMemoryIfNeeded(bytes: Uint8Array): Promise<void> {
  let estimatedBytes: number
  try {
    estimatedBytes = estimateDecodedByteSize(bytes)
  } catch {
    return Promise.resolve()
  }
  if (estimatedBytes <= MEMORY_WARNING_THRESHOLD_BYTES) return Promise.resolve()

  const mib = Math.round(estimatedBytes / (1024 * 1024))
  memoryWarningContinueButtonEl.hidden = false
  memoryWarningEl.classList.remove('is-empty')
  memoryWarningTextEl.textContent = `此 GIF 解碼後預估記憶體用量約 ${mib} MiB，處理可能導致瀏覽器變慢或沒有回應。仍要繼續嗎？`
  memoryWarningContinueButtonEl.focus()

  return new Promise((resolve) => {
    const handleClick = (): void => {
      memoryWarningContinueButtonEl.removeEventListener('click', handleClick)
      memoryWarningEl.classList.add('is-empty')
      memoryWarningTextEl.textContent = ''
      memoryWarningContinueButtonEl.hidden = true
      resolve()
    }
    memoryWarningContinueButtonEl.addEventListener('click', handleClick)
  })
}

// Re-entrancy guard: the memory-gate `await` below suspends this function
// while `#memory-warning-continue-button` waits for a click, but nothing
// disables the file input/drop zone *during* that wait (unlike apng-to-gif's
// equivalent gate, which runs after `setBusy(true)` already has). Without
// this guard, selecting a second file before confirming the first would run
// a second `handleFileSelected` concurrently -- both suspended on the same
// button's click listeners -- and whichever decode finished last would
// silently clobber the other's already-rendered UI. `fileInputEl.disabled`
// alone would not be enough since it doesn't stop the drag-and-drop path.
let isProcessingFile = false

/**
 * Mount-timing invariant (PLAN §5): magic bytes -> memory gate -> "解碼中…"
 * announcement -> yield -> synchronous decodeGif -> poster -> *only then*
 * unhide the original preview section. Never mounts the preview early and
 * patches the poster in after the fact.
 */
async function handleFileSelected(file: File): Promise<void> {
  if (isProcessingFile) return
  isProcessingFile = true
  fileInputEl.disabled = true

  try {
    resetForNewFile()
    resetMessages()

    selectedFilenameEl.textContent = file.name
    selectedFilenameEl.hidden = false

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
      assertGifMagicBytes(bytes)
    } catch (error) {
      showError(error)
      return
    }

    await confirmMemoryIfNeeded(bytes)

    announceStatus('解碼中…')
    await yieldToRenderer()

    let result: DecodedGif
    try {
      result = decodeGif(bytes)
    } catch (error) {
      clearStatus()
      showError(error)
      return
    }

    // 0 幀守門（coordinator 裁決，PLAN §5）：不進編輯流程。
    if (result.frames.length === 0) {
      clearStatus()
      showError(new Error('這個 GIF 沒有可用的影格'))
      return
    }

    cachedFile = file
    decoded = result
    editState = createInitialEditState(result)
    currentPageIndex = 0

    renderPosterCanvas(originalPosterEl, result.frames[0], '原始 GIF 預覽（靜態畫面）')
    originalObjectUrl = URL.createObjectURL(file)
    originalPreviewEl.src = originalObjectUrl
    originalPreviewEl.alt = '原始 GIF 預覽'
    originalPreviewSectionEl.hidden = false
    pauseButtonEl.hidden = false
    updatePreviewPlaybackState()

    populateLoopControls(result.loop)
    frameListSectionEl.hidden = false
    renderFrameList(false)
    updateConvertButtonState()

    announceStatus(`解碼完成，共 ${result.frames.length} 幀`)
  } finally {
    fileInputEl.disabled = false
    isProcessingFile = false
  }
}

function populateLoopControls(loop: number): void {
  const infinite = loop === 0
  loopInfiniteCheckboxEl.checked = infinite
  loopCountInputEl.disabled = infinite
  loopCountInputEl.value = String(infinite ? 1 : loop)
}

/**
 * A brand-new file invalidates everything tied to the previous one --
 * including UI state a prior file's edits left behind (coordinator-decided
 * reset semantics, (internal design doc) "resetForNewFile 不重置 loop
 * 控制項與 isPaused"): loop controls go back to their default, playback
 * un-pauses (a freshly-selected file should start playing, with the pause
 * button immediately available), and the frame list is hidden again until
 * the next decode succeeds.
 */
function resetForNewFile(): void {
  if (originalObjectUrl) URL.revokeObjectURL(originalObjectUrl)
  originalObjectUrl = null

  cachedFile = null
  decoded = null
  editState = null
  currentPageIndex = 0

  originalPreviewSectionEl.hidden = true
  originalPreviewEl.hidden = true
  originalPreviewEl.removeAttribute('src')
  originalPosterEl.hidden = true
  pauseButtonEl.hidden = true

  frameListSectionEl.hidden = true
  frameListEl.textContent = ''
  pagePositionStatusEl.textContent = ''
  prevPageButtonEl.disabled = true
  nextPageButtonEl.disabled = true

  populateLoopControls(1)

  // Mirrors the module-level initial computation (not a hardcoded `false`):
  // a fresh file should autoplay for most users while still honoring an
  // active prefers-reduced-motion preference, exactly like the very first
  // file did.
  isPaused = reducedMotionQuery.matches
  updatePreviewPlaybackState()

  hidePreviousResult()
  resetProgress()
  convertButtonEl.disabled = true
}

// ---- Poster canvases (frame-0 / result-first-kept-frame RGBA drawn straight
// into a <canvas> -- distinct elements, distinct data sources; see index.html
// and showResult()'s doc comment for why they must never share a source).
// `label` gives the canvas an accessible name (role=img + aria-label): the
// pause/reduced-motion contract swaps the animated <img> (which has its own
// alt) for this canvas, and a nameless <canvas> would otherwise be invisible
// to screen readers whenever it's the one actually shown. ----
function renderPosterCanvas(canvasEl: HTMLCanvasElement, frame: RGBAFrame, label: string): void {
  canvasEl.width = frame.width
  canvasEl.height = frame.height
  canvasEl.setAttribute('role', 'img')
  canvasEl.setAttribute('aria-label', label)
  const ctx = canvasEl.getContext('2d')
  if (!ctx) return
  // `Uint8ClampedArray.buffer` is typed `ArrayBufferLike` even though it's
  // always a plain ArrayBuffer here (this project never uses
  // SharedArrayBuffer) -- same narrowing as tools/apng-to-gif/main.ts.
  const clamped = frame.data as Uint8ClampedArray<ArrayBuffer>
  ctx.putImageData(new ImageData(clamped, frame.width, frame.height), 0, 0)
}

// ---- Pause: one global toggle covers both previews (WCAG 2.2.2) by swapping
// which element is hidden -- the animated <img> or its poster <canvas> --
// since a GIF <img> has no native pause and this tool renders posters as real
// canvases (not a second poster <img> URL swap like apng-to-gif). ----
pauseButtonEl.addEventListener('click', () => {
  isPaused = !isPaused
  updatePreviewPlaybackState()
})

function updatePreviewPlaybackState(): void {
  pauseButtonEl.setAttribute('aria-pressed', String(isPaused))
  pauseButtonEl.textContent = isPaused ? '播放' : '暫停'

  if (originalObjectUrl) {
    originalPreviewEl.hidden = isPaused
    originalPosterEl.hidden = !isPaused
  }
  if (resultObjectUrl) {
    resultPreviewEl.hidden = isPaused
    resultPosterEl.hidden = !isPaused
  }
}

// ---- Frame list (paginated; PLAN §5「幀清單（大量幀設計）」) ----
function totalPages(frameCount: number): number {
  return Math.max(1, Math.ceil(frameCount / PAGE_SIZE))
}

/**
 * Rebuilds the current page's rows from scratch. Safe to call after any edit
 * that changes which page is showing (page nav) or the *set* of visible rows
 * -- per-row in-place mutations (keep toggle, delay edit) intentionally do
 * NOT call this, since a full rebuild would discard the focus that must stay
 * put (PLAN §5「非破壞性刪除（焦點不遷移）」).
 */
function renderFrameList(moveFocus: boolean): void {
  if (!decoded || !editState) return
  const dec = decoded
  const state = editState

  const frameCount = dec.frames.length
  const pages = totalPages(frameCount)
  currentPageIndex = Math.min(Math.max(currentPageIndex, 0), pages - 1)
  const startIndex = currentPageIndex * PAGE_SIZE
  const endIndex = Math.min(startIndex + PAGE_SIZE, frameCount)

  frameListEl.textContent = ''
  for (let i = startIndex; i < endIndex; i++) {
    frameListEl.appendChild(createFrameRow(i, dec, state))
  }

  prevPageButtonEl.disabled = currentPageIndex === 0
  nextPageButtonEl.disabled = currentPageIndex >= pages - 1
  // #page-position-status is a permanently-mounted role=status node
  // (index.html) -- writing textContent here both updates the visible page
  // indicator and announces the page change (PLAN §5「換頁契約」).
  pagePositionStatusEl.textContent = `第 ${currentPageIndex + 1} 頁，共 ${pages} 頁，顯示幀 ${startIndex + 1}–${endIndex}`

  if (moveFocus) {
    frameListEl.querySelector<HTMLInputElement>('.frame-row__keep')?.focus()
  }
}

/** Builds one `<li class="frame-row">` per index.html's row contract. Frame numbers are 1-based and global (span pages). */
function createFrameRow(index: number, dec: DecodedGif, state: EditState): HTMLLIElement {
  const frame = dec.frames[index]
  const frameNumber = index + 1

  const li = document.createElement('li')
  li.className = 'frame-row'
  if (!state.keep[index]) li.classList.add('frame-row--excluded')

  const thumb = document.createElement('canvas')
  thumb.className = 'frame-row__thumb'
  thumb.setAttribute('aria-hidden', 'true')
  renderThumbnail(thumb, frame)

  const keepLabel = document.createElement('label')
  keepLabel.className = 'frame-row__keep-label'
  const keepInput = document.createElement('input')
  keepInput.type = 'checkbox'
  keepInput.className = 'frame-row__keep'
  keepInput.checked = state.keep[index]
  keepInput.addEventListener('change', () => handleKeepToggle(index, keepInput.checked, li))
  keepLabel.append(keepInput, document.createTextNode(`保留幀 ${frameNumber}`))

  // label[for] + a standalone input (not a wrapping <label>): a wrap-label's
  // accessible name is computed from its content, which for a spinbutton
  // includes the *current numeric value* -- name would read "幀 3 停留時間
  // （毫秒）100" and drift as the value changes. label[for] keeps the name
  // fixed to the label text alone, matching every other control on this page.
  const delayInputId = `frame-delay-${frameNumber}`
  const delayWrap = document.createElement('div')
  delayWrap.className = 'frame-row__delay-label'
  const delayLabel = document.createElement('label')
  delayLabel.setAttribute('for', delayInputId)
  delayLabel.textContent = `幀 ${frameNumber} 停留時間（毫秒）`
  const delayInput = document.createElement('input')
  delayInput.type = 'number'
  delayInput.id = delayInputId
  delayInput.className = 'frame-row__delay'
  delayInput.min = '20'
  delayInput.step = '10'
  delayInput.value = String(state.delaysMs[index])
  // `change` (commit on blur/Enter), not `input` -- per-keystroke edits must
  // not announce (PLAN §5), and normalization only makes sense once the user
  // has finished typing a value.
  delayInput.addEventListener('change', () => handleDelayChange(index, delayInput))
  delayWrap.append(delayLabel, delayInput)

  li.append(thumb, keepLabel, delayWrap)
  return li
}

/** Downscales `frame` (longest edge -> ~96px) into the decorative thumbnail canvas. */
function renderThumbnail(canvasEl: HTMLCanvasElement, frame: RGBAFrame): void {
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(frame.width, frame.height))
  const thumbWidth = Math.max(1, Math.round(frame.width * scale))
  const thumbHeight = Math.max(1, Math.round(frame.height * scale))

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = frame.width
  sourceCanvas.height = frame.height
  const sourceCtx = sourceCanvas.getContext('2d')
  if (!sourceCtx) return
  const clamped = frame.data as Uint8ClampedArray<ArrayBuffer>
  sourceCtx.putImageData(new ImageData(clamped, frame.width, frame.height), 0, 0)

  canvasEl.width = thumbWidth
  canvasEl.height = thumbHeight
  canvasEl.getContext('2d')?.drawImage(sourceCanvas, 0, 0, thumbWidth, thumbHeight)
}

// ---- Editing: EditState (edit.ts) is the sole source of truth; the rendered
// page is only a projection of it (PLAN §5). ----

/** Non-destructive toggle: the row stays mounted, focus never moves, the delay input stays operable either way. */
function handleKeepToggle(index: number, kept: boolean, rowEl: HTMLLIElement): void {
  if (!editState) return
  editState = setFrameKept(editState, index, kept)
  rowEl.classList.toggle('frame-row--excluded', !kept)

  const anyKept = editState.keep.some(Boolean)
  const baseMessage = `幀 ${index + 1} 已標記${kept ? '還原' : '刪除'}`
  announceStatus(anyKept ? baseMessage : `${baseMessage}；已刪除全部幀，請至少保留一幀才能轉換`)
  updateConvertButtonState()
}

function handleDelayChange(index: number, inputEl: HTMLInputElement): void {
  if (!editState) return
  editState = setFrameDelay(editState, index, inputEl.valueAsNumber)
  // Reflects normalization (floor 20ms) back into the input (PLAN §5).
  inputEl.value = String(editState.delaysMs[index])
}

function updateConvertButtonState(): void {
  convertButtonEl.disabled = !editState || !editState.keep.some(Boolean)
}

applyAllDelayButtonEl.addEventListener('click', () => {
  if (!editState) return
  const normalized = normalizeDelayMs(applyAllDelayInputEl.valueAsNumber)
  editState = setAllDelays(editState, applyAllDelayInputEl.valueAsNumber)
  applyAllDelayInputEl.value = String(normalized)
  refreshVisibleDelayInputs()
  announceStatus(`已將全部 ${editState.delaysMs.length} 幀停留時間設為 ${normalized} ms`)
})

/** "全部套用" edits every frame in EditState (cross-page), but only the currently-rendered page's inputs need a DOM refresh. */
function refreshVisibleDelayInputs(): void {
  if (!editState) return
  const state = editState
  const startIndex = currentPageIndex * PAGE_SIZE
  frameListEl.querySelectorAll<HTMLInputElement>('.frame-row__delay').forEach((input, i) => {
    input.value = String(state.delaysMs[startIndex + i])
  })
}

loopInfiniteCheckboxEl.addEventListener('change', () => {
  loopCountInputEl.disabled = loopInfiniteCheckboxEl.checked
  handleLoopChange()
})
loopCountInputEl.addEventListener('change', () => {
  handleLoopChange()
})

function handleLoopChange(): void {
  if (!editState) return
  if (loopInfiniteCheckboxEl.checked) {
    editState = setLoop(editState, 0)
    announceStatus('播放次數已設為 ∞')
    return
  }
  // Falls back to 1 for NaN/0/negative input (mirrors the input's own min="1").
  const n = Math.max(1, Math.round(loopCountInputEl.valueAsNumber) || 1)
  loopCountInputEl.value = String(n)
  editState = setLoop(editState, n)
  announceStatus(`播放次數已設為 ${n} 次`)
}

// ---- Pagination (nav sits before the list in index.html; PLAN §5「換頁契約」) ----
prevPageButtonEl.addEventListener('click', () => {
  if (currentPageIndex <= 0) return
  currentPageIndex -= 1
  renderFrameList(true)
})

nextPageButtonEl.addEventListener('click', () => {
  if (!decoded) return
  if (currentPageIndex >= totalPages(decoded.frames.length) - 1) return
  currentPageIndex += 1
  renderFrameList(true)
})

// ---- Conversion: applyEdits -> encodeGif (worker, with main-thread fallback) ----
convertButtonEl.addEventListener('click', () => {
  void runConversion()
})

/**
 * Encode-only progress (PLAN §5): unlike apng-to-gif, gif-editor's decode is
 * one synchronous gifuct-js call with no incremental progress of its own (see
 * handleFileSelected's "解碼中…" status instead) -- so this progress section
 * only ever tracks the worker/main-thread encode phase, throttled to at most
 * one DOM update per 10 percentage points or 500ms.
 */
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
  progressSectionEl.classList.remove('is-empty')
  progressBarEl.hidden = false
  progressBarEl.value = 0
}

function resetProgress(): void {
  progressSectionEl.classList.add('is-empty')
  progressBarEl.hidden = true
  progressBarEl.value = 0
  progressStatusEl.textContent = ''
}

function updateProgress(text: string, percent: number): void {
  progressBarEl.value = percent
  progressStatusEl.textContent = text
}

async function runConversion(): Promise<void> {
  if (!decoded || !editState) return
  const dec = decoded
  const state = editState

  let encodeInput: GifEncodeInput
  try {
    encodeInput = applyEdits(dec, state)
  } catch (error) {
    showError(error)
    return
  }

  resetMessages()
  hidePreviousResult()
  setBusy(true)
  showProgress()

  const progressThrottle = createProgressThrottle()
  const onEncodeProgress = (done: number, total: number): void => {
    const percent = Math.round((done / total) * 100)
    if (progressThrottle(percent)) {
      updateProgress(`編碼中 ${done}/${total} 幀`, percent)
    }
  }

  try {
    let gifBytes: Uint8Array
    if (worker === undefined) worker = createEncodeWorker()
    if (worker) {
      const request: WorkerRequest = {
        // `.slice()` copies each frame's underlying buffer *before* transfer
        // -- transferring `dec`'s own buffers directly would detach them,
        // corrupting `decoded` (and this very `encodeInput`, needed below for
        // the result poster) for any subsequent re-render or re-conversion.
        frames: encodeInput.frames.map((frame) => {
          const copy = frame.data.slice()
          return { buffer: copy.buffer as ArrayBuffer, width: frame.width, height: frame.height }
        }),
        delaysMs: encodeInput.delaysMs,
        loop: encodeInput.loop,
      }
      gifBytes = await runEncodeInWorker(worker, request, onEncodeProgress)
    } else {
      gifBytes = encodeGif(encodeInput, {
        onFrameEncoded: (index, total) => onEncodeProgress(index + 1, total),
      })
    }

    updateProgress('轉換完成', 100)
    showResult(gifBytes, encodeInput.frames[0])
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

function setBusy(busy: boolean): void {
  fileInputEl.disabled = busy
  convertButtonEl.disabled = busy || !editState || !editState.keep.some(Boolean)
}

// ---- Error / status messaging ----
// #error-message/#status-message/#memory-warning are permanently mounted
// (see index.html) so a screen reader's live-region watcher is always
// attached to them -- these functions only ever write textContent and toggle
// the purely-visual `is-empty` class (see style.css), never hidden/display,
// on the message containers themselves.
function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  errorMessageEl.classList.remove('is-empty')
  errorMessageEl.textContent = message
}

function announceStatus(text: string): void {
  statusMessageEl.classList.remove('is-empty')
  statusTextEl.textContent = text
}

function clearStatus(): void {
  statusMessageEl.classList.add('is-empty')
  statusTextEl.textContent = ''
}

function resetMessages(): void {
  errorMessageEl.classList.add('is-empty')
  errorMessageEl.textContent = ''
  clearStatus()
  memoryWarningEl.classList.add('is-empty')
  memoryWarningTextEl.textContent = ''
  memoryWarningContinueButtonEl.hidden = true
}

// ---- Result: GIF blob -> preview + poster + download link + size
// comparison, then focus-management + status announcement (WCAG 4.1.3). ----
function hidePreviousResult(): void {
  resultPreviewEl.hidden = true
  resultPreviewEl.removeAttribute('src')
  resultPosterEl.hidden = true
  downloadLinkEl.hidden = true
  downloadLinkEl.removeAttribute('href')
  sizeComparisonEl.hidden = true
  sizeComparisonEl.textContent = ''
  if (resultObjectUrl) {
    URL.revokeObjectURL(resultObjectUrl)
    resultObjectUrl = null
  }
}

function formatKb(bytes: number): string {
  return (bytes / 1024).toFixed(1)
}

/**
 * `firstKeptFrame` is `applyEdits`'s own output frame 0 -- deliberately never
 * `decoded.frames[0]` or `originalPosterEl`'s source. If the very first
 * source frame was deleted, the result poster must still show what's
 * actually first in the *output*, not a frame absent from it (PLAN §5
 * 「結果 poster 獨立」).
 */
function showResult(gifBytes: Uint8Array, firstKeptFrame: RGBAFrame): void {
  const blob = new Blob([gifBytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' })
  resultObjectUrl = URL.createObjectURL(blob)

  renderPosterCanvas(resultPosterEl, firstKeptFrame, '轉換後 GIF 預覽（靜態畫面）')

  const baseName = cachedFile ? cachedFile.name.replace(/\.gif$/i, '') : 'edited'
  const downloadName = `${baseName}-edited.gif`

  resultPreviewEl.alt = `轉換後 GIF 預覽：${downloadName}`
  resultPreviewEl.src = resultObjectUrl
  resultPreviewEl.hidden = false
  resultPosterEl.hidden = false
  downloadLinkEl.href = resultObjectUrl
  downloadLinkEl.download = downloadName
  downloadLinkEl.hidden = false

  const originalSize = cachedFile?.size ?? 0
  const resultSize = gifBytes.byteLength
  const deltaPercent = originalSize > 0 ? Math.round(((resultSize - originalSize) / originalSize) * 100) : 0
  const changeLabel = deltaPercent <= 0 ? `縮小 ${Math.abs(deltaPercent)}%` : `增加 ${deltaPercent}%`
  sizeComparisonEl.textContent = `原始 ${formatKb(originalSize)} KB → 結果 ${formatKb(resultSize)} KB（${changeLabel}）`
  sizeComparisonEl.hidden = false

  updatePreviewPlaybackState()
  announceStatus('轉換完成')
  resultSectionEl.focus()
}
