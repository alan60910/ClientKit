/**
 * UI 狀態機與 a11y 契約（(internal design doc) §UI 狀態機 r2.1）。
 *
 * 狀態流：idle → gate（warn-continue）→ loading-core（首次）→ probing →
 * ready → converting → done（/preview-failure 子態）／error／cancelled。
 * beforeunload 攔截不實作（PLAN open question，T4.3 後議）。
 *
 * 播報映射表（§UI 為逐列契約；所有播報經常駐 live region 的 textContent
 * 覆寫，節點分工見 index.html 註解）：
 * - loading-core：URL 方案 (a) 直傳絕對 URL 下載發生在 worker 內 import／
 *   Emscripten、無 byte 事件——三分支中只有「時間驅動心跳」分支可達
 *   （百分比／bytes 心跳兩分支對應方案 (b) toBlobURL，T4.3 若改採再補）。
 * - probing：「分析檔案中…」單則。
 * - ready：策略三變體＋全部條件式 notices 一次播齊（見 NOTICE_TEXT）。
 * - converting：「已完成 N%，預估剩餘…」，cadence＝limits.shouldAnnounceProgress
 *   （每 10% 或每 30s 擇低頻）；ETA null 時只播百分比；停滯 >60s 補
 *   「仍在處理中」心跳。
 * - done：先播「轉換完成」再（rAF×2 延一拍）focus 結果容器。
 * - preview-failure（done 子態）：video onerror →「轉換完成」之後同節點
 *   覆寫「此格式無法在本瀏覽器預覽，檔案仍可下載」。
 * - error：role=alert 常駐節點（core 下載失敗／探測皆失敗／轉碼失敗含
 *   OOM 全收斂），logTail 末幾行附於可展開 details。
 * - cancelled：「已取消」＋focus 回「開始轉換」鈕（或選檔區若尚無計畫）。
 */

// T4.2（(internal design doc) §D4）：主題模組於任何渲染前
// import——<head> 的 inline script 已在解析階段套用 data-theme（防 FOUC），
// 這裡只需接上 toggle 鈕的 wiring 與 aria-pressed 同步，故在檔案最上方、
// 其餘功能邏輯之前完成。
import { initThemeSync, initThemeToggle } from '../../src/theme.js'

import '../../src/style.css'
import './style.css'

import {
  EXEC_EXCEPTION_RET,
  FfmpegCancelledError,
  FfmpegClient,
  type ConversionOutcome,
} from './ffmpeg-client.js'
import {
  blindConversionPlan,
  planConversion,
  type ConversionPlan,
  type NoticeKey,
} from './convert-plan.js'
import type { StreamInfo } from './probe.js'
import {
  MEMORY_GATE_BYTES,
  clampProgress,
  deriveOutputName,
  estimateEtaMs,
  exceedsMemoryGate,
  formatEta,
  shouldAnnounceProgress,
} from './limits.js'

const CORE_LOADING_MESSAGE = '核心元件下載中（首次載入約 32 MB，請稍候）'
const CORE_LOADING_HEARTBEAT_MS = 10_000
// 停滯心跳：進度值連續 60s 無變化（也無 cadence 播報）時補播，之後每 60s 重複。
const STALL_HEARTBEAT_MS = 60_000
const STALL_CHECK_INTERVAL_MS = 10_000
const ERROR_LOG_TAIL_LINES = 10

// ready 態先以佔位名建 plan（只取 mode／notices／copy 與否）；實際 exec 的
// args 由 argsBuilder 以真實 input／output 路徑重建（planConversion 純函式
// 重算，同一 StreamInfo 必得同一決策）。
const PLAN_PLACEHOLDER_INPUT = 'input'
const PLAN_PLACEHOLDER_OUTPUT = 'output.mp4'

/** NoticeKey → zh-TW 播報文案（PLAN §UI ready 列；順序由 plan.notices 承載）。 */
const NOTICE_TEXT: Record<NoticeKey, string> = {
  'subtitles-dropped': '字幕將被丟棄',
  'hevc-compat': 'HEVC 部分瀏覽器無法播放',
  'multi-video-track': '僅保留第一視訊軌',
  'multi-audio-track': '僅保留第一音訊軌',
  'audio-only': '來源為純音訊，將輸出音訊 MP4',
  'unsupported-codec': '來源格式（如 AV1）可能不受支援，轉換可能失敗',
}

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
const memoryWarningReselectButtonEl = document.getElementById('memory-warning-reselect-button') as HTMLButtonElement

const statusMessageEl = document.getElementById('status-message') as HTMLDivElement
const statusTextEl = document.getElementById('status-text') as HTMLParagraphElement

const errorMessageEl = document.getElementById('error-message') as HTMLDivElement
const errorExtrasEl = document.getElementById('error-extras') as HTMLDivElement
const errorLogDetailsEl = document.getElementById('error-log-details') as HTMLDetailsElement
const errorLogTailEl = document.getElementById('error-log-tail') as HTMLPreElement
const errorResetButtonEl = document.getElementById('error-reset-button') as HTMLButtonElement

const readySectionEl = document.getElementById('ready-section') as HTMLElement
const probeSummaryEl = document.getElementById('probe-summary') as HTMLParagraphElement
const strategyTextEl = document.getElementById('strategy-text') as HTMLParagraphElement
const noticeListEl = document.getElementById('notice-list') as HTMLUListElement
const convertButtonEl = document.getElementById('convert-button') as HTMLButtonElement

const progressSectionEl = document.getElementById('progress-section') as HTMLElement
const progressBarEl = document.getElementById('progress-bar') as HTMLProgressElement
const progressStatusEl = document.getElementById('progress-status') as HTMLParagraphElement
const cancelButtonEl = document.getElementById('cancel-button') as HTMLButtonElement

const resultSectionEl = document.getElementById('result-section') as HTMLElement
const resultVideoEl = document.getElementById('result-video') as HTMLVideoElement
const downloadLinkEl = document.getElementById('download-link') as HTMLAnchorElement
const convertAnotherButtonEl = document.getElementById('convert-another-button') as HTMLButtonElement

// ---- Module state ----
type UiState = 'idle' | 'gate' | 'loading-core' | 'probing' | 'ready' | 'converting' | 'done' | 'error'
let uiState: UiState = 'idle'

let currentFile: File | null = null
/** null＝blind-transcode 降級（probe 失敗）或尚未探測。 */
let probeInfo: StreamInfo | null = null
/** 佔位路徑版 plan（mode／notices／copy 判定用）；非 null 即代表 ready 過。 */
let currentPlan: ConversionPlan | null = null
let outputName = ''
let resultObjectUrl: string | null = null

// Re-entrancy guard（沿 gif-editor 模式，與 ffmpeg-client 的 busy 旗標構成
// 雙層防護）：gate 的 await 期間、pipeline／轉換進行中，file input 的
// change 與拖放路徑一律擋掉第二個併發流程。
let isProcessingFile = false

// 唯一讀 location 之處（ffmpeg-client 本身不讀，保 node 可測）。
const client = new FfmpegClient({ pageHref: location.href })

let loadingHeartbeatTimer: number | null = null
let stallTimer: number | null = null
/** elapsed 計時起點＝exec 啟動（enterConvertingState 時刻；core 已載、mount 輕量）。 */
let execStartAt = 0
let lastAnnounced: { progress: number; atMs: number } | null = null
let lastProgressValue = -1
/** 最近一次「進度值變化或播報」時刻——停滯心跳的判定基準。 */
let lastActivityAt = 0

/** ensureCoreLoaded 的失敗標記：讓 pipeline catch 能把成因歸為 core 下載失敗。 */
class CoreLoadError extends Error {
  constructor(cause: unknown) {
    super(`核心元件下載失敗，請檢查網路連線後重試（${describeError(cause)}）。`)
    this.name = 'CoreLoadError'
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Double rAF：第一個 callback 於下次 paint 前觸發，等到第二個時必已完成
 * 一次 paint——讓「轉換完成」播報先於焦點移轉被 SR 注意到（done 列競態
 * 契約；同 gif-editor 的 yieldToRenderer，本質 best-effort）。
 */
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

// ---- 播報與訊息區（常駐節點只寫 textContent，切 .is-empty 不切 hidden） ----
function announceStatus(text: string): void {
  statusMessageEl.classList.remove('is-empty')
  statusTextEl.textContent = text
}

function announceProgress(text: string): void {
  progressStatusEl.textContent = text
}

function clearMemoryWarning(): void {
  memoryWarningEl.classList.add('is-empty')
  memoryWarningTextEl.textContent = ''
  memoryWarningContinueButtonEl.hidden = true
  memoryWarningReselectButtonEl.hidden = true
}

function resetMessages(): void {
  errorMessageEl.classList.add('is-empty')
  errorMessageEl.textContent = ''
  errorExtrasEl.hidden = true
  errorLogDetailsEl.open = false
  errorLogTailEl.textContent = ''
  statusMessageEl.classList.add('is-empty')
  statusTextEl.textContent = ''
  clearMemoryWarning()
}

// ---- 進度 region（含取消鈕；section 永不 hidden，僅 is-empty 收合視覺） ----
function showProgressRegion(kind: 'indeterminate' | 'determinate'): void {
  progressSectionEl.classList.remove('is-empty')
  progressBarEl.hidden = false
  if (kind === 'indeterminate') {
    progressBarEl.removeAttribute('value') // 無 value 屬性＝不定型進度
  } else {
    progressBarEl.value = 0
  }
  cancelButtonEl.hidden = false
}

function resetProgressRegion(): void {
  progressSectionEl.classList.add('is-empty')
  progressBarEl.hidden = true
  progressBarEl.value = 0
  progressStatusEl.textContent = ''
  cancelButtonEl.hidden = true
}

// ---- 計時器 ----
function stopLoadingHeartbeat(): void {
  if (loadingHeartbeatTimer !== null) {
    clearInterval(loadingHeartbeatTimer)
    loadingHeartbeatTimer = null
  }
}

function startStallTimer(): void {
  stopStallTimer()
  stallTimer = window.setInterval(() => {
    if (uiState !== 'converting') return
    const now = performance.now()
    if (now - lastActivityAt >= STALL_HEARTBEAT_MS) {
      announceProgress('仍在處理中')
      lastActivityAt = now
    }
  }, STALL_CHECK_INTERVAL_MS)
}

function stopStallTimer(): void {
  if (stallTimer !== null) {
    clearInterval(stallTimer)
    stallTimer = null
  }
}

// ---- 重置 ----
function hideResult(): void {
  resultSectionEl.hidden = true
  resultVideoEl.hidden = true
  resultVideoEl.removeAttribute('src')
  // 卸掉媒體資源後才 revoke，避免 video 仍握著 blob；無 src 的 load() 不會
  // 觸發 error 事件（資源選取演算法直接以 NETWORK_EMPTY 中止）。
  resultVideoEl.load()
  downloadLinkEl.hidden = true
  downloadLinkEl.removeAttribute('href')
  downloadLinkEl.textContent = ''
  if (resultObjectUrl !== null) {
    URL.revokeObjectURL(resultObjectUrl)
    resultObjectUrl = null
  }
}

/** 新流程起點的統一清場（前一檔案／結果／訊息全部作廢）。 */
function resetForNewFile(): void {
  uiState = 'idle'
  currentFile = null
  probeInfo = null
  currentPlan = null
  outputName = ''
  hideResult()
  readySectionEl.hidden = true
  convertButtonEl.disabled = true
  resetProgressRegion()
  resetMessages()
}

function resetToIdle(): void {
  resetForNewFile()
  selectedFilenameEl.hidden = true
  selectedFilenameEl.textContent = ''
  // 清空 value：同一檔案重選也要能再次觸發 change。
  fileInputEl.value = ''
  fileInputEl.disabled = false
}

// ---- gate（warn-continue，沿 gif-editor 模式＋「重新選擇」回 idle） ----
function waitForMemoryGate(file: File): Promise<'continue' | 'reselect'> {
  const fileMib = Math.round(file.size / (1024 * 1024))
  const gateMib = Math.round(MEMORY_GATE_BYTES / (1024 * 1024))
  memoryWarningEl.classList.remove('is-empty')
  memoryWarningTextEl.textContent = `此檔案約 ${fileMib} MiB，超過建議上限 ${gateMib} MiB：瀏覽器內轉換可能因記憶體不足而失敗，或變得非常緩慢。仍要繼續嗎？`
  memoryWarningContinueButtonEl.hidden = false
  memoryWarningReselectButtonEl.hidden = false
  memoryWarningContinueButtonEl.focus()

  return new Promise((resolve) => {
    const settle = (choice: 'continue' | 'reselect'): void => {
      memoryWarningContinueButtonEl.removeEventListener('click', handleContinue)
      memoryWarningReselectButtonEl.removeEventListener('click', handleReselect)
      clearMemoryWarning()
      resolve(choice)
    }
    const handleContinue = (): void => settle('continue')
    const handleReselect = (): void => settle('reselect')
    memoryWarningContinueButtonEl.addEventListener('click', handleContinue)
    memoryWarningReselectButtonEl.addEventListener('click', handleReselect)
  })
}

// ---- loading-core ----
async function ensureCoreLoaded(): Promise<void> {
  if (client.loaded) return
  uiState = 'loading-core'
  showProgressRegion('indeterminate') // 取消鈕 loading 期也可用（取消三態契約）
  announceStatus(CORE_LOADING_MESSAGE)
  // textContent 重寫即使同字串也會替換文字節點（DOM mutation）→ SR 重播。
  loadingHeartbeatTimer = window.setInterval(
    () => announceStatus(CORE_LOADING_MESSAGE),
    CORE_LOADING_HEARTBEAT_MS,
  )
  try {
    await client.ensureLoaded()
  } catch (error) {
    if (error instanceof FfmpegCancelledError) throw error
    throw new CoreLoadError(error) // fetch／import 失敗 → error 態成因：core 下載失敗
  } finally {
    stopLoadingHeartbeat()
  }
}

// ---- ready ----
function strategyText(plan: ConversionPlan): string {
  if (plan.mode === 'remux') return '可直接快速 remux'
  if (plan.mode === 'blind-transcode') return '無法預判格式，將完整轉碼（較慢）'
  if (plan.mode === 'audio-only') {
    // aac/mp3 來源走 -c:a copy（decideAudio 白名單）＝快速輸出，不套「較慢」。
    return plan.args.includes('copy') ? '可快速輸出音訊' : '需轉碼音訊（較慢）'
  }
  return '需轉碼，預估較慢'
}

function formatDurationSec(durationSec: number): string {
  const total = Math.round(durationSec)
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return seconds === 0 ? `${minutes} 分鐘` : `${minutes} 分 ${seconds} 秒`
}

function describeProbeSummary(info: StreamInfo): string {
  const parts: string[] = []
  if (info.formatName !== undefined) parts.push(`容器 ${info.formatName}`)
  if (info.video.length > 0) {
    const video = info.video[0]
    const size =
      video.width !== undefined && video.height !== undefined
        ? ` ${video.width}×${video.height}`
        : ''
    parts.push(`視訊 ${video.codecName}${size}`)
  }
  if (info.audio.length > 0) parts.push(`音訊 ${info.audio[0].codecName}`)
  if (info.subtitleCount > 0) parts.push(`字幕 ${info.subtitleCount} 軌`)
  if (info.durationSec !== undefined) parts.push(`時長約 ${formatDurationSec(info.durationSec)}`)
  return `來源：${parts.join('，')}`
}

function enterReadyState(plan: ConversionPlan): void {
  uiState = 'ready'
  resetProgressRegion()

  if (probeInfo !== null) {
    probeSummaryEl.textContent = describeProbeSummary(probeInfo)
    probeSummaryEl.hidden = false
  } else {
    probeSummaryEl.hidden = true
    probeSummaryEl.textContent = ''
  }
  strategyTextEl.textContent = strategyText(plan)
  noticeListEl.textContent = ''
  for (const key of plan.notices) {
    const li = document.createElement('li')
    li.textContent = NOTICE_TEXT[key]
    noticeListEl.appendChild(li)
  }
  noticeListEl.hidden = plan.notices.length === 0
  convertButtonEl.disabled = false
  readySectionEl.hidden = false

  // 一次播齊：策略＋全部 notices（不得只做視覺文字）。
  const parts = [strategyText(plan), ...plan.notices.map((key) => NOTICE_TEXT[key])]
  announceStatus(`分析完成：${parts.join('；')}。`)
}

// ---- 選檔 pipeline：gate → loading-core → probing → ready ----
async function handleFileSelected(file: File): Promise<void> {
  if (isProcessingFile) return
  isProcessingFile = true
  fileInputEl.disabled = true

  try {
    resetForNewFile()
    selectedFilenameEl.textContent = file.name
    selectedFilenameEl.hidden = false

    if (exceedsMemoryGate(file.size)) {
      uiState = 'gate'
      const choice = await waitForMemoryGate(file)
      if (choice === 'reselect') {
        resetToIdle()
        fileInputEl.focus()
        return
      }
    }

    currentFile = file
    outputName = deriveOutputName(file.name)

    await ensureCoreLoaded()

    uiState = 'probing'
    showProgressRegion('indeterminate')
    announceStatus('分析檔案中…')
    const probe = await client.probeFile(file)

    let plan: ConversionPlan
    if (probe.ok) {
      const planned = planConversion(probe.info, PLAN_PLACEHOLDER_INPUT, PLAN_PLACEHOLDER_OUTPUT)
      if (!planned.ok) {
        // 影音皆無（PLAN 決策矩陣）：不進 ready，直接錯誤態。
        showErrorState('無法轉換：來源檔不含任何影音軌。', null)
        return
      }
      probeInfo = probe.info
      plan = planned.plan
    } else {
      // 探測失敗 → blind-transcode 降級（不報錯）：ready 第三變體承擔告知。
      probeInfo = null
      plan = blindConversionPlan(PLAN_PLACEHOLDER_INPUT, PLAN_PLACEHOLDER_OUTPUT)
    }
    currentPlan = plan
    enterReadyState(plan)
  } catch (error) {
    if (error instanceof FfmpegCancelledError) {
      handleCancelled()
      return
    }
    if (error instanceof CoreLoadError) {
      showErrorState(error.message, null)
      return
    }
    showErrorState(`發生未預期的錯誤：${describeError(error)}`, null)
  } finally {
    isProcessingFile = false
    fileInputEl.disabled = false
  }
}

// ---- converting ----
function buildPlanArgs(inputPath: string, outputPath: string): string[] {
  if (probeInfo !== null) {
    const planned = planConversion(probeInfo, inputPath, outputPath)
    if (planned.ok) return planned.plan.args
    // 不可達：enterReadyState 前已擋 no-media-streams；防禦性退 blind。
  }
  return blindConversionPlan(inputPath, outputPath).args
}

function enterConvertingState(): void {
  uiState = 'converting'
  showProgressRegion('determinate')
  lastAnnounced = null
  lastProgressValue = -1
  execStartAt = performance.now()
  lastActivityAt = execStartAt
  startStallTimer()
  // 轉碼啟動時 focus 移至取消鈕（契約；取消鈕已隨 showProgressRegion unhide）。
  cancelButtonEl.focus()
}

async function executeConversion(
  file: File,
  argsBuilder: (inputPath: string, outputPath: string) => string[],
): Promise<ConversionOutcome> {
  // cancel 後 core 已被 terminate——每次 exec 前都可能需要重載（含播報）。
  await ensureCoreLoaded()
  enterConvertingState()
  try {
    return await client.runConversion(file, argsBuilder)
  } finally {
    stopStallTimer()
  }
}

/**
 * exec 例外（wasm OOM abort 類）後 worker 執行環境不可信：terminate 丟棄，
 * 後續重試（copy fallback 或使用者重來）會自動重載核心。ret≠0 的一般失敗
 * 不需要——worker 仍健康，保留已載入的核心。
 */
function discardWorkerIfAborted(ret: number): void {
  if (ret === EXEC_EXCEPTION_RET) client.cancel()
}

function conversionFailureMessage(ret: number, context: 'plain' | 'blind' | 'copy-fallback'): string {
  const cause =
    ret === EXEC_EXCEPTION_RET
      ? '處理過程發生例外，可能為記憶體不足'
      : `ffmpeg 結束碼 ${ret}`
  switch (context) {
    case 'blind':
      return `轉換失敗：格式探測與完整轉碼皆失敗，來源可能不是有效的影音檔（${cause}）。`
    case 'copy-fallback':
      return `轉換失敗：直接封裝與完整轉碼重試皆失敗（${cause}）。`
    default:
      return `轉換失敗（${cause}）。`
  }
}

async function runConvertFlow(): Promise<void> {
  const file = currentFile
  const plan = currentPlan
  if (file === null || plan === null) return
  if (isProcessingFile) return
  isProcessingFile = true
  fileInputEl.disabled = true
  convertButtonEl.disabled = true

  try {
    const outcome = await executeConversion(file, buildPlanArgs)
    if (outcome.ok) {
      await showDone(outcome.data)
      return
    }
    discardWorkerIfAborted(outcome.ret)

    // copy 失敗 fallback：args 含 'copy' token 即適用（remux／transcode-video
    // ／transcode-audio，以及 audio-only 的 audio copy 變體——比列舉 mode
    // 更誠實），改用 blind 全轉碼重試一次。
    if (plan.args.includes('copy')) {
      announceStatus('直接封裝失敗，改用完整轉碼重試…')
      const retry = await executeConversion(file, (i, o) => blindConversionPlan(i, o).args)
      if (retry.ok) {
        await showDone(retry.data)
        return
      }
      discardWorkerIfAborted(retry.ret)
      showErrorState(conversionFailureMessage(retry.ret, 'copy-fallback'), retry.logTail)
      return
    }

    // blind plan 本身失敗＝探測、轉碼皆失敗（probe fail 後 blind 也敗）。
    const context = plan.mode === 'blind-transcode' ? 'blind' : 'plain'
    showErrorState(conversionFailureMessage(outcome.ret, context), outcome.logTail)
  } catch (error) {
    if (error instanceof FfmpegCancelledError) {
      handleCancelled()
      return
    }
    if (error instanceof CoreLoadError) {
      showErrorState(error.message, null)
      return
    }
    showErrorState(`發生未預期的錯誤：${describeError(error)}`, null)
  } finally {
    isProcessingFile = false
    fileInputEl.disabled = false
  }
}

// converting 進度播報（訂閱一次，僅 converting 態動作；clamp → cadence → ETA）。
client.onProgress((event) => {
  if (uiState !== 'converting') return
  const progress = clampProgress(event.progress)
  const now = performance.now()
  const percent = Math.round(progress * 100)
  progressBarEl.value = percent // 視覺進度條每事件都更新，播報才走 cadence
  if (progress !== lastProgressValue) {
    lastProgressValue = progress
    lastActivityAt = now
  }
  const sample = { progress, atMs: now }
  if (!shouldAnnounceProgress(lastAnnounced, sample)) return
  lastAnnounced = sample
  lastActivityAt = now
  // percent<1 時 elapsed/progress 外插發散，ETA 誇張失真——首播只報百分比。
  const eta = percent < 1 ? null : estimateEtaMs(now - execStartAt, progress)
  announceProgress(eta === null ? `已完成 ${percent}%` : `已完成 ${percent}%，預估剩餘${formatEta(eta)}`)
})

// ---- done（/preview-failure 子態） ----
async function showDone(data: Uint8Array): Promise<void> {
  resetProgressRegion()
  readySectionEl.hidden = true
  uiState = 'done' // 先翻態：video onerror 的子態守衛以此判定

  const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
  resultObjectUrl = URL.createObjectURL(blob)

  const isAudioOnly = currentPlan?.mode === 'audio-only'
  resultVideoEl.setAttribute(
    'aria-label',
    `${isAudioOnly ? '轉換後音訊預覽' : '轉換後影片預覽'}：${outputName}`,
  )
  resultVideoEl.src = resultObjectUrl
  resultVideoEl.hidden = false

  // 下載連結 href＋download＋文字原子設定完才 unhide（契約）。
  downloadLinkEl.href = resultObjectUrl
  downloadLinkEl.download = outputName
  downloadLinkEl.textContent = `下載 ${outputName}`
  downloadLinkEl.hidden = false

  resultSectionEl.hidden = false
  // 先播「轉換完成」，延一拍再 focus 結果容器（非 video 本身）——讓完成
  // 播報不被焦點移轉觸發的朗讀蓋掉（done 列競態契約）。
  announceStatus('轉換完成')
  await yieldToRenderer()
  resultSectionEl.focus()
}

// preview-failure 子態：轉出的 MP4 本瀏覽器不能播（如 HEVC copy 於
// Chrome/Firefox）→ 隱藏 video、保留下載；播報在「轉換完成」之後發生
// （error 事件必然晚於 showDone 的同步播報），同 status 節點覆寫。
resultVideoEl.addEventListener('error', () => {
  if (uiState !== 'done') return
  resultVideoEl.hidden = true
  announceStatus('此格式無法在本瀏覽器預覽，檔案仍可下載')
})

// ---- cancelled ----
function handleCancelled(): void {
  stopLoadingHeartbeat()
  stopStallTimer()
  if (currentFile !== null && currentPlan !== null) {
    // converting 期取消：探測結果仍有效 → 回 ready，focus 回「開始轉換」。
    resetProgressRegion()
    uiState = 'ready'
    announceStatus('已取消')
    convertButtonEl.disabled = false
    readySectionEl.hidden = false
    convertButtonEl.focus()
  } else {
    // loading-core／probing 期取消：尚無轉換計畫 → 回 idle，focus 選檔區。
    resetToIdle()
    announceStatus('已取消')
    fileInputEl.focus()
  }
}

cancelButtonEl.addEventListener('click', () => {
  if (uiState !== 'loading-core' && uiState !== 'probing' && uiState !== 'converting') return
  // terminate＋世代翻新；進行中的 await 以 FfmpegCancelledError 收斂，
  // cancelled 轉場由對應 pipeline 的 catch（handleCancelled）完成。
  client.cancel()
})

// ---- error ----
function showErrorState(message: string, logTail: string[] | null): void {
  stopLoadingHeartbeat()
  stopStallTimer()
  resetProgressRegion()
  readySectionEl.hidden = true
  uiState = 'error'
  errorMessageEl.classList.remove('is-empty')
  errorMessageEl.textContent = message // role=alert 常駐節點，保持純文字
  if (logTail !== null && logTail.length > 0) {
    errorLogTailEl.textContent = logTail.slice(-ERROR_LOG_TAIL_LINES).join('\n')
    errorLogDetailsEl.hidden = false
  } else {
    errorLogDetailsEl.hidden = true
    errorLogTailEl.textContent = ''
  }
  errorExtrasEl.hidden = false
}

errorResetButtonEl.addEventListener('click', () => {
  resetToIdle()
  fileInputEl.focus()
})

convertAnotherButtonEl.addEventListener('click', () => {
  resetToIdle() // 釋放 objectURL（hideResult 內 revoke）
  fileInputEl.focus()
})

// ---- 事件綁定：選檔（click-to-open 由原生 label for 免費取得）＋拖放 ----
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
  if (file) void handleFileSelected(file) // 併發防護在 handleFileSelected 內
})

convertButtonEl.addEventListener('click', () => {
  void runConvertFlow()
})
