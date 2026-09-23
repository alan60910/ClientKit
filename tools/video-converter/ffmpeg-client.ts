/**
 * ffmpeg.wasm 生命週期包裝（(internal design doc) §ffmpeg-client
 * 生命週期契約；運行時地雷事實依據 WORKS.md T2.1）。
 *
 * 生命週期契約（實作必守，逐條出處）：
 * - **延後建構**：`@ffmpeg/ffmpeg` 的 node exports 指向 empty.mjs，其
 *   `FFmpeg` 建構子直接 throw（PLAN 已查證事實 12）——`import { FFmpeg }`
 *   本身安全，但 `new FFmpeg()` 只能發生在方法內（預設 factory），模組
 *   頂層與建構子皆不得觸碰。
 * - **URL 方案 (a) 直傳絕對 URL**（WORKS.md coordinator ruling 2026-07-04
 *   暫裁；T4.3 人工 gate 若實測推翻再修）：coreURL／wasmURL 以
 *   `vendorAssetUrl(pageHref, …)` 頁面相對上溯構絕對 URL、**兩者顯式傳入
 *   load()**——不傳會靜默 fallback unpkg CDN（已查證事實 3/4），自足性由
 *   單元測試在呼叫端釘住（dist-grep unpkg 必假陽性，不可作防迴歸）。
 *   pageHref 由呼叫端（main.ts 傳 `location.href`）注入，本模組不讀
 *   `location`——保 node 可 import 可測。
 * - **loglevel 殘留**：loglevel 是 process-global 且跨呼叫殘留（reset()
 *   不還原，WORKS.md T2.1）→ 每次 exec／ffprobe 的 args 一律由本層前置
 *   `['-v', 'error']`；convert-plan 的 args 刻意不含 -v，層責在此。
 * - **ffprobe ret 不可信**：wrapper 的 ffprobe ret 恆 -1、失敗時 -o 仍寫
 *   空物件 `{}`（WORKS.md T2.1）→ probe 成敗＝讀回 JSON 交 `parseProbeJson`
 *   判定，不看 ret。exec 的 ret 可靠（0=成功）。
 * - **取消三態**：loading-core 期＝中止載入；probing／converting 期＝
 *   `terminate()`＋下次使用時重建實例（真取消只有 terminate——AbortSignal
 *   只 reject 不停 wasm，且 core.setTimeout 攔不住 x265 類 hang，WORKS.md
 *   T2.1）。任何進行中 Promise 以 `FfmpegCancelledError` 收斂：內部以
 *   cancellation signal race，即使底層 Promise 永不 settle（hang 類）也
 *   收斂得了。
 * - **core bytes 快取**：方案 (a) 下下載發生在 worker 內 import／
 *   Emscripten，bytes 不經過本層——快取交給 HTTP cache＋瀏覽器 wasm code
 *   cache（重載成本 SP-7 於 T4.3 量測）；本層僅把兩個 URL 於建構期算定
 *   一次、terminate 後重建沿用。若 T4.3 改採方案 (b) toBlobURL，blob URL
 *   快取加在這裡。
 * - **輸入路徑**：WORKERFS mount 優先（`createDir(dir)` →
 *   `mount('WORKERFS', {files:[file]}, dir)`，輸入路徑＝`dir + '/' + name`，
 *   免整檔複製進 MEMFS）；**fallback 條件＝createDir 或 mount 任一 throw**
 *   （SP-3 已驗 mount 可行，此為防禦路徑）→ `fetchFile(file)` →
 *   `writeFile`。無 name 的 Blob 或 name 經消毒後與原名不符者走 WORKERFS
 *   的 blobs 條目（等效掛載，名字可控）。輸出固定內部名 `output.mp4`，
 *   下載檔名由 UI 層用 limits.deriveOutputName 另定。
 * - **job 間清理**（best-effort try/catch，防連續轉檔累積吃滿 wasm heap）：
 *   deleteFile 輸出與 probe json → unmount＋deleteDir 掛載目錄／（fallback
 *   路徑）deleteFile 輸入。取消時跳過——terminate 已把整個 worker 連同 FS
 *   一起銷毀。
 * - **失敗收斂**：exec ret≠0 與 exec throw（含 wasm OOM abort）一律收斂為
 *   `{ok:false, ret, logTail}`——logTail 為最近 ~50 行 log ring buffer 快照
 *   （每 job 起點清空，供 UI 錯誤顯示與 copy 失敗歸因「Could not write
 *   header」等特徵行）。
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { vendorAssetUrl } from './asset-url.js'
import { parseProbeJson, type ProbeResult } from './probe.js'

export interface FFmpegLogEvent {
  type: string
  message: string
}

export interface FFmpegProgressEvent {
  progress: number
  time: number
}

/** WORKERFS mount 選項（@ffmpeg/ffmpeg types.d.ts WorkerFSMountData 結構相容）。 */
export interface WorkerFsMountOptions {
  files?: Array<File | (Blob & { name: string })>
  blobs?: Array<{ name: string; data: Blob }>
}

/**
 * `FFmpeg` 實例的最小可測面（依賴注入介面）。真實 `FFmpeg` 類必須結構相容
 * ——預設 factory `() => new FFmpeg()` 不帶 cast，typecheck 本身就是漂移
 * tripwire。方法皆以 method 語法宣告（參數雙變比對），fsType 放寬為
 * string：真實面是 FFFSType enum，字串字面量與 string enum 互不可指派，
 * 收窄會弄斷結構相容。
 */
export interface FFmpegLike {
  load(config: { coreURL: string; wasmURL: string }): Promise<boolean>
  exec(args: string[], timeout?: number): Promise<number>
  ffprobe(args: string[]): Promise<number>
  writeFile(path: string, data: Uint8Array | string): Promise<boolean>
  readFile(path: string, encoding?: string): Promise<Uint8Array | string>
  deleteFile(path: string): Promise<boolean>
  createDir(path: string): Promise<boolean>
  deleteDir(path: string): Promise<boolean>
  mount(fsType: string, options: WorkerFsMountOptions, mountPoint: string): Promise<boolean>
  unmount(mountPoint: string): Promise<boolean>
  terminate(): void
  on(event: 'log', callback: (event: FFmpegLogEvent) => void): void
  on(event: 'progress', callback: (event: FFmpegProgressEvent) => void): void
  off(event: 'log', callback: (event: FFmpegLogEvent) => void): void
  off(event: 'progress', callback: (event: FFmpegProgressEvent) => void): void
}

/** 輸入檔：File 或帶（可選）name 的 Blob。 */
export type InputFile = Blob & { readonly name?: string }

export type ConversionOutcome =
  | { ok: true; data: Uint8Array }
  | { ok: false; ret: number; logTail: string[] }

/** cancel() 收斂進行中 Promise 的可辨識錯誤（UI 據此走 cancelled 態而非 error 態）。 */
export class FfmpegCancelledError extends Error {
  constructor() {
    super('ffmpeg-client: 已取消')
    this.name = 'FfmpegCancelledError'
  }
}

/** 轉換輸出的固定內部檔名（下載檔名由 UI 層 limits.deriveOutputName 推導）。 */
export const OUTPUT_NAME = 'output.mp4'
/** exec throw（wasm OOM abort 等）收斂用的 ret 哨兵值——真實 exec ret 恆 ≥ 0。 */
export const EXEC_EXCEPTION_RET = -1

const PROBE_OUTPUT_NAME = 'probe-output.json'
const INPUT_MOUNT_DIR = '/input'
const LOG_TAIL_CAPACITY = 50

export interface FfmpegClientOptions {
  /** 頁面自身 URL（瀏覽器端傳 `location.href`）；構 vendor 絕對 URL 用。 */
  pageHref: string
  /** 測試注入點；預設在首次需要時 `new FFmpeg()`（延後至瀏覽器執行期）。 */
  createFFmpeg?: () => FFmpegLike
  /**
   * WORKERFS fallback 路徑的檔案讀取；預設 @ffmpeg/util 的 fetchFile
   * （File/Blob 走 FileReader，node 無——node 測試注入 arrayBuffer 替身）。
   */
  fetchFile?: (file: Blob) => Promise<Uint8Array>
}

interface PreparedInput {
  inputPath: string
  mounted: boolean
}

interface CancellationSignal {
  promise: Promise<never>
  cancel: () => void
}

function createCancellationSignal(): CancellationSignal {
  let cancel!: () => void
  const promise = new Promise<never>((_, reject) => {
    cancel = () => reject(new FfmpegCancelledError())
  })
  // 從未被 race 消費就取消（或永不取消被 GC）時不得變成 unhandled rejection。
  promise.catch(() => {})
  return { promise, cancel }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 檔名消毒：路徑分隔符換底線（瀏覽器選檔不會出現，純防禦）；空名補位。 */
function inputFileName(file: InputFile): string {
  const raw = typeof file.name === 'string' ? file.name : ''
  const sanitized = raw.replace(/[\\/]/g, '_')
  return sanitized === '' ? 'input' : sanitized
}

/** fallback 寫進 MEMFS 的輸入路徑：撞到保留的輸出檔名時前綴避開。 */
function fallbackInputPath(name: string): string {
  return name === OUTPUT_NAME || name === PROBE_OUTPUT_NAME ? `in-${name}` : name
}

function workerFsMountOptions(file: InputFile, name: string): WorkerFsMountOptions {
  // WORKERFS 的 files 條目以 File 自身的 name 為節點名——只有名字未經
  // 消毒改寫的 File 能直用；其餘（無名 Blob、名字被消毒）走 blobs 條目
  // 顯式給名（File 也是 Blob，可作 data）。
  if (typeof File !== 'undefined' && file instanceof File && file.name === name) {
    return { files: [file] }
  }
  return { blobs: [{ name, data: file }] }
}

export class FfmpegClient {
  readonly #coreURL: string
  readonly #wasmURL: string
  readonly #createFFmpeg: () => FFmpegLike
  readonly #fetchFile: (file: Blob) => Promise<Uint8Array>

  #instance: FFmpegLike | null = null
  #loaded = false
  #loadPromise: Promise<void> | null = null
  /** 每次 cancel() 遞增；進行中流程逐步比對，發現過期即收斂 cancelled。 */
  #generation = 0
  #cancellation = createCancellationSignal()
  /** 一實例一次一工作（PLAN 已查證事實 6；併發防護沿用 gif-editor 模式）。 */
  #busy = false

  #logTail: string[] = []
  readonly #logSubscribers = new Set<(event: FFmpegLogEvent) => void>()
  readonly #progressSubscribers = new Set<(event: FFmpegProgressEvent) => void>()

  readonly #handleLog = (event: FFmpegLogEvent): void => {
    this.#logTail.push(event.message)
    if (this.#logTail.length > LOG_TAIL_CAPACITY) this.#logTail.shift()
    for (const callback of this.#logSubscribers) callback(event)
  }

  readonly #handleProgress = (event: FFmpegProgressEvent): void => {
    // 原始值直轉發、不 clamp——收斂責任在 UI 層（limits.clampProgress）。
    for (const callback of this.#progressSubscribers) callback(event)
  }

  constructor(opts: FfmpegClientOptions) {
    this.#coreURL = vendorAssetUrl(opts.pageHref, 'vendor/ffmpeg/ffmpeg-core.js')
    this.#wasmURL = vendorAssetUrl(opts.pageHref, 'vendor/ffmpeg/ffmpeg-core.wasm')
    this.#createFFmpeg = opts.createFFmpeg ?? (() => new FFmpeg())
    this.#fetchFile = opts.fetchFile ?? fetchFile
  }

  get loaded(): boolean {
    return this.#loaded
  }

  /** log 訂閱（原始事件轉發）；回傳退訂函式。跨 terminate 重建持續有效。 */
  onLog(callback: (event: FFmpegLogEvent) => void): () => void {
    this.#logSubscribers.add(callback)
    return () => {
      this.#logSubscribers.delete(callback)
    }
  }

  /** progress 訂閱（原始事件轉發、不 clamp）；回傳退訂函式。 */
  onProgress(callback: (event: FFmpegProgressEvent) => void): () => void {
    this.#progressSubscribers.add(callback)
    return () => {
      this.#progressSubscribers.delete(callback)
    }
  }

  /**
   * 冪等載入。回傳「本次呼叫是否實際執行了 load」——已載入回 false、
   * 載入中則等同一個 in-flight Promise 後回 false；cancel 後重建再呼叫
   * 會重新載入、回 true。
   */
  async ensureLoaded(): Promise<boolean> {
    if (this.#loaded) return false
    if (this.#loadPromise !== null) {
      await this.#loadPromise
      return false
    }
    const gen = this.#generation
    const instance = this.#ensureInstance()
    const loadPromise = (async () => {
      await this.#guarded(gen, instance.load({ coreURL: this.#coreURL, wasmURL: this.#wasmURL }))
      this.#loaded = true
    })()
    this.#loadPromise = loadPromise
    try {
      await loadPromise
    } finally {
      // 取消路徑由 cancel() 清；成功／一般失敗（可重試）在此清。
      if (this.#generation === gen) this.#loadPromise = null
    }
    return true
  }

  /**
   * 探測輸入檔：mount → ffprobe → 讀回 JSON → parseProbeJson → 清理。
   * ret 恆 -1 不可信（WORKS.md T2.1）——成敗完全由 parseProbeJson 判定；
   * 讀不回輸出檔也收斂為 ok:false，不 throw（cancelled 除外）。
   */
  async probeFile(file: InputFile): Promise<ProbeResult> {
    return this.#runJob(async (gen, instance) => {
      let prepared: PreparedInput | null = null
      try {
        prepared = await this.#prepareInput(gen, instance, file)
        const args = [
          '-v',
          'error',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          prepared.inputPath,
          '-o',
          PROBE_OUTPUT_NAME,
        ]
        await this.#guarded(gen, instance.ffprobe(args))
        let jsonText = ''
        try {
          const data = await this.#guarded(gen, instance.readFile(PROBE_OUTPUT_NAME, 'utf8'))
          jsonText = typeof data === 'string' ? data : new TextDecoder().decode(data)
        } catch (error) {
          if (error instanceof FfmpegCancelledError) throw error
          // 輸出檔不存在＝probe 失敗；空字串交 parseProbeJson 收斂 invalid-json。
        }
        return parseProbeJson(jsonText)
      } finally {
        await this.#cleanupJob(gen, instance, prepared, [PROBE_OUTPUT_NAME])
      }
    })
  }

  /**
   * 執行轉換：mount → exec（前置 -v error）→ ret 判定 → readFile → 清理。
   * argsBuilder 收（inputPath, outputPath）回完整 ffmpeg args（convert-plan
   * 的 plan.args 即此形；不含 -v/-nostdin/-y）。ret≠0 與 exec throw（wasm
   * OOM abort）皆收斂 `{ok:false, ret, logTail}`，不 throw（cancelled 除外）。
   */
  async runConversion(
    file: InputFile,
    argsBuilder: (inputPath: string, outputPath: string) => string[],
  ): Promise<ConversionOutcome> {
    return this.#runJob(async (gen, instance) => {
      let prepared: PreparedInput | null = null
      try {
        prepared = await this.#prepareInput(gen, instance, file)
        const args = ['-v', 'error', ...argsBuilder(prepared.inputPath, OUTPUT_NAME)]
        let ret: number
        try {
          ret = await this.#guarded(gen, instance.exec(args))
        } catch (error) {
          if (error instanceof FfmpegCancelledError) throw error
          return {
            ok: false,
            ret: EXEC_EXCEPTION_RET,
            logTail: [...this.#logTail, `exec 例外：${describeError(error)}`],
          }
        }
        if (ret !== 0) {
          return { ok: false, ret, logTail: [...this.#logTail] }
        }
        try {
          const raw = await this.#guarded(gen, instance.readFile(OUTPUT_NAME))
          const data = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw
          return { ok: true, data }
        } catch (error) {
          if (error instanceof FfmpegCancelledError) throw error
          // ret=0 但輸出讀不回：不應發生的內部矛盾，仍收斂而非炸 UI。
          return {
            ok: false,
            ret: EXEC_EXCEPTION_RET,
            logTail: [...this.#logTail, `readFile 例外：${describeError(error)}`],
          }
        }
      } finally {
        await this.#cleanupJob(gen, instance, prepared, [OUTPUT_NAME])
      }
    })
  }

  /**
   * 取消（三態統一收斂）：terminate() 殺 worker（loading-core＝中止載入；
   * probing/converting＝停掉 wasm——唯一能停 x265 類 hang 的手段）＋重置
   * 內部狀態；下次使用時由 factory 重建實例。進行中 Promise 以
   * FfmpegCancelledError 收斂。閒置時呼叫無害。
   */
  cancel(): void {
    const instance = this.#instance
    const cancellation = this.#cancellation
    this.#generation += 1
    this.#instance = null
    this.#loaded = false
    this.#loadPromise = null
    this.#busy = false
    this.#cancellation = createCancellationSignal()
    cancellation.cancel()
    if (instance !== null) {
      try {
        instance.terminate()
      } catch {
        // best-effort：實例已死也無妨，狀態已重置。
      }
    }
  }

  #ensureInstance(): FFmpegLike {
    if (this.#instance !== null) return this.#instance
    const instance = this.#createFFmpeg()
    instance.on('log', this.#handleLog)
    instance.on('progress', this.#handleProgress)
    this.#instance = instance
    return instance
  }

  /**
   * 對底層 Promise 加取消收斂：race cancellation signal（即使底層 hang 也
   * 收斂得了），且 settle 後仍複驗世代——terminate 造成的底層 reject 一律
   * 折為 FfmpegCancelledError，不讓 ERROR_TERMINATED 洩漏成一般錯誤。
   */
  async #guarded<T>(gen: number, promise: Promise<T>): Promise<T> {
    let value: T
    try {
      value = await Promise.race([promise, this.#cancellation.promise])
    } catch (error) {
      if (this.#generation !== gen) throw new FfmpegCancelledError()
      throw error
    }
    if (this.#generation !== gen) throw new FfmpegCancelledError()
    return value
  }

  async #runJob<T>(job: (gen: number, instance: FFmpegLike) => Promise<T>): Promise<T> {
    if (this.#busy) {
      throw new Error('ffmpeg-client: 已有工作進行中（單實例一次一工作）')
    }
    this.#busy = true
    const gen = this.#generation
    try {
      await this.ensureLoaded()
      if (this.#generation !== gen) throw new FfmpegCancelledError()
      const instance = this.#instance
      if (instance === null || !this.#loaded) {
        throw new Error('ffmpeg-client: 內部不變量破損（載入完成但無實例）')
      }
      // logTail 歸因單一 job：起點清空，失敗快照只含本 job 的 log。
      this.#logTail = []
      return await job(gen, instance)
    } finally {
      // 取消路徑由 cancel() 清 busy；世代已翻時不得誤清新 job 的旗標。
      if (this.#generation === gen) this.#busy = false
    }
  }

  async #prepareInput(
    gen: number,
    instance: FFmpegLike,
    file: InputFile,
  ): Promise<PreparedInput> {
    const name = inputFileName(file)
    try {
      await this.#guarded(gen, instance.createDir(INPUT_MOUNT_DIR))
      await this.#guarded(
        gen,
        instance.mount('WORKERFS', workerFsMountOptions(file, name), INPUT_MOUNT_DIR),
      )
      return { inputPath: `${INPUT_MOUNT_DIR}/${name}`, mounted: true }
    } catch (error) {
      if (error instanceof FfmpegCancelledError) throw error
      // fallback：整檔複製進 MEMFS。先清掉可能建成的空掛載目錄，否則下個
      // job 的 createDir 會因 EEXIST 永遠掉進 fallback。
      try {
        await instance.deleteDir(INPUT_MOUNT_DIR)
      } catch {
        // best-effort
      }
      const bytes = await this.#guarded(gen, this.#fetchFile(file))
      const inputPath = fallbackInputPath(name)
      // writeFile 的 buffer 以 Transferable 轉移（已查證事實 5）——bytes
      // 在此之後不得再用。
      await this.#guarded(gen, instance.writeFile(inputPath, bytes))
      return { inputPath, mounted: false }
    }
  }

  /** job 間清理（best-effort）：取消時跳過——worker 已 terminate，FS 隨之銷毀。 */
  async #cleanupJob(
    gen: number,
    instance: FFmpegLike,
    prepared: PreparedInput | null,
    outputPaths: string[],
  ): Promise<void> {
    if (this.#generation !== gen) return
    for (const path of outputPaths) {
      try {
        await instance.deleteFile(path)
      } catch {
        // best-effort：輸出可能根本沒產生（exec 失敗）。
      }
    }
    if (prepared === null) return
    if (prepared.mounted) {
      try {
        await instance.unmount(INPUT_MOUNT_DIR)
      } catch {
        // best-effort
      }
      try {
        await instance.deleteDir(INPUT_MOUNT_DIR)
      } catch {
        // best-effort
      }
    } else {
      try {
        await instance.deleteFile(prepared.inputPath)
      } catch {
        // best-effort
      }
    }
  }
}
