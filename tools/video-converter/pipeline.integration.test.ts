/**
 * S4-T3.3：node 真轉檔整合測試（(internal design doc) §測試策略）。
 *
 * 單元測試鎖的是 args 的陣列形狀；本檔把「真 ffprobe JSON → parseProbeJson
 * → planConversion → 真 exec → 真輸出 bytes → 回探」整條鏈在真 ffmpeg.wasm
 * 上跑通，鎖的是行為。可行性與墊片同源於 SP-4（scripts/spike-node-core.mjs）：
 * - @ffmpeg/ffmpeg 的 node exports 指向 empty.mjs（建構子直接 throw）→
 *   繞過 wrapper，動態 import @ffmpeg/core 的 ESM glue；`@vite-ignore`
 *   讓 vitest 留給 node 原生 import（glue 不進 vite 模組圖）。
 * - glue 的 ENVIRONMENT_IS_WORKER 是編譯期寫死 true → 需墊 `self` 與
 *   `self.location.href`；wasm 以 `wasmBinary` 直塞（node fetch 不吃
 *   file:），`mainScriptUrlOrBlob` 帶 `#`+base64({wasmURL}) 私有協議餵
 *   glue 內部 _locateFile。墊片建立者負責 afterAll 拆除（forks pool 進程
 *   可能跨測試檔重用，不留全域殘餘）。
 * - 與 @ffmpeg/ffmpeg worker.js 的 exec→ret→reset 呼叫序同形（worker.js
 *   另有 setTimeout 前置，因生產端恆傳預設 -1 而略去）：`exec(...args)`
 *   （rest params，必須展開）→ 讀 `core.ret` → `reset()`。glue 自動前置
 *   `./ffmpeg -nostdin -y`（exec）／`./ffprobe`（ffprobe）；本檔另前置
 *   `['-v','error']` ＝ ffmpeg-client 層責——argv 與生產鏈逐字等價。
 * - 成敗訊號：exec 的 ret 可信（0=成功）；ffprobe ret 恆 -1 不可信
 *   （WORKS.md T2.1）→ probe 成敗一律由 parseProbeJson 判定。案例 D 釘住
 *   「copy 失敗以 ret≠0 呈現」的偵測前提。
 * - 編碼只觸 libx264／native aac（白名單後備）——libvpx-vp9 編碼 wasm
 *   crash、libx265 hang（SP2 §7），本檔任何路徑不得觸碰。
 *
 * 耗時：各案例 console.log ms、afterAll 印含 init 的總計——本檔是否留在
 * 預設套件的隔離決策依據（T1.2 量測顯示此量級免隔離，此處實測背書）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { parseProbeJson, type ProbeResult, type StreamInfo } from './probe.js'
import { blindConversionPlan, planConversion } from './convert-plan.js'

const coreEsmDir = resolve(
  import.meta.dirname,
  '..',
  '..',
  'node_modules',
  '@ffmpeg',
  'core',
  'dist',
  'esm',
)
const coreJsPath = resolve(coreEsmDir, 'ffmpeg-core.js')
const coreWasmPath = resolve(coreEsmDir, 'ffmpeg-core.wasm')
const mediaDir = resolve(import.meta.dirname, 'fixtures', 'media')

/** wasm 初始化＋單案例最多 2 次 exec／ffprobe 的安全邊際。 */
const CASE_TIMEOUT_MS = 15000

interface CoreFS {
  writeFile(path: string, data: Uint8Array): void
  readFile(path: string, opts: { encoding: 'utf8' }): string
  readFile(path: string): Uint8Array
  unlink(path: string): void
}

/** @ffmpeg/core glue 掛在 Module 上的最小使用面（無官方型別，檔內自宣告）。 */
interface FFmpegCoreLike {
  ret: number
  exec(...args: string[]): number
  ffprobe(...args: string[]): number
  reset(): void
  setLogger(callback: (event: { type: string; message: string }) => void): void
  FS: CoreFS
}

type CreateFFmpegCore = (options: {
  wasmBinary: Uint8Array
  mainScriptUrlOrBlob: string
}) => Promise<FFmpegCoreLike>

/** 墊片視角的 globalThis（tsconfig 帶 DOM lib，繞過其 self/location 宣告）。 */
interface WorkerShims {
  self?: { location?: { href: string } }
}

const shimGlobal = globalThis as unknown as WorkerShims

let core: FFmpegCoreLike
let logs: string[] = []
let createdSelfShim = false
let createdLocationShim = false
let cleanupPaths: string[] = []
const timings: Array<{ label: string; ms: number }> = []

function recordTiming(label: string, ms: number): void {
  timings.push({ label, ms })
  console.log(`[pipeline.integration] ${label}: ${ms.toFixed(0)}ms`)
}

function timeCase<T>(label: string, run: () => T): T {
  const start = performance.now()
  const value = run()
  recordTiming(label, performance.now() - start)
  return value
}

/** exec→ret→reset 呼叫序與 worker.js 同形（setTimeout 因生產端恆傳預設 -1 而略去）。 */
function runExec(args: string[]): number {
  logs = []
  core.exec(...args)
  const ret = core.ret
  core.reset()
  return ret
}

/** ffmpeg-client.probeFile 同形 args；ret 不看，成敗交 parseProbeJson。 */
function runProbe(inputPath: string, jsonName: string): ProbeResult {
  logs = []
  core.ffprobe(
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    inputPath,
    '-o',
    jsonName,
  )
  core.reset()
  const jsonText = core.FS.readFile(jsonName, { encoding: 'utf8' })
  core.FS.unlink(jsonName)
  return parseProbeJson(jsonText)
}

function expectOk(result: ProbeResult): StreamInfo {
  if (!result.ok) {
    throw new Error(`expected ok:true, got ok:false reason=${result.reason}`)
  }
  return result.info
}

function logTail(): string {
  return logs.slice(-15).join('\n')
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function indexOfAscii(bytes: Uint8Array, token: string): number {
  outer: for (let i = 0; i + token.length <= bytes.length; i += 1) {
    for (let j = 0; j < token.length; j += 1) {
      if (bytes[i + j] !== token.charCodeAt(j)) continue outer
    }
    return i
  }
  return -1
}

describe('video-converter 整合管線（真 @ffmpeg/core node 直跑）', () => {
  beforeAll(async () => {
    const start = performance.now()
    if (!existsSync(coreJsPath) || !existsSync(coreWasmPath)) {
      throw new Error(`缺 @ffmpeg/core dist 資產（${coreEsmDir}）——先跑 npm install`)
    }
    const coreJsUrl = pathToFileURL(coreJsPath).href

    if (shimGlobal.self === undefined) {
      shimGlobal.self = globalThis as unknown as NonNullable<WorkerShims['self']>
      createdSelfShim = true
    }
    if (shimGlobal.self.location === undefined) {
      shimGlobal.self.location = { href: coreJsUrl }
      createdLocationShim = true
    }

    const coreModule = (await import(/* @vite-ignore */ coreJsUrl)) as {
      default: CreateFFmpegCore
    }
    const wasmURL = pathToFileURL(coreWasmPath).href
    const configFragment = Buffer.from(JSON.stringify({ wasmURL })).toString('base64')
    core = await coreModule.default({
      wasmBinary: readFileSync(coreWasmPath),
      mainScriptUrlOrBlob: `${coreJsUrl}#${configFragment}`,
    })
    core.setLogger(({ type, message }) => {
      logs.push(`[${type}] ${message}`)
    })

    core.FS.writeFile('a.mkv', readFileSync(resolve(mediaDir, 'a-h264-aac.mkv')))
    core.FS.writeFile('b.webm', readFileSync(resolve(mediaDir, 'b-vp8-vorbis.webm')))
    recordTiming('init（import＋instantiate＋fixtures 寫入）', performance.now() - start)
  }, CASE_TIMEOUT_MS)

  afterEach(() => {
    for (const path of cleanupPaths) {
      try {
        core.FS.unlink(path)
      } catch {
        // best-effort：exec 失敗時輸出可能根本沒產生。
      }
    }
    cleanupPaths = []
  })

  afterAll(() => {
    if (createdLocationShim && shimGlobal.self !== undefined) {
      delete shimGlobal.self.location
    }
    if (createdSelfShim) {
      delete shimGlobal.self
    }
    const totalMs = timings.reduce((sum, entry) => sum + entry.ms, 0)
    console.log(`[pipeline.integration] 檔案總耗時（含 init）: ${totalMs.toFixed(0)}ms`)
  })

  it(
    '案例 A：remux 全鏈——真 probe → plan(remux) → 真 exec → ftyp＋faststart＋回探 h264/aac/mp4',
    { timeout: CASE_TIMEOUT_MS },
    () => {
      timeCase('案例 A（remux 全鏈）', () => {
        cleanupPaths.push('out-a.mp4')
        const info = expectOk(runProbe('a.mkv', 'probe-a.json'))
        expect(info.video[0].codecName).toBe('h264')
        expect(info.audio[0].codecName).toBe('aac')

        const planned = planConversion(info, 'a.mkv', 'out-a.mp4')
        if (!planned.ok) {
          throw new Error(`planConversion 意外失敗：${planned.reason}`)
        }
        expect(planned.plan.mode).toBe('remux')

        const ret = runExec(['-v', 'error', ...planned.plan.args])
        expect(ret, `remux exec ret=${ret}，log 尾段：\n${logTail()}`).toBe(0)

        const out = core.FS.readFile('out-a.mp4')
        expect(out.length).toBeGreaterThan(0)
        expect(ascii(out, 4, 8)).toBe('ftyp')

        // -movflags +faststart 的行為面證據：moov box 先於 mdat。
        const moovAt = indexOfAscii(out, 'moov')
        const mdatAt = indexOfAscii(out, 'mdat')
        expect(moovAt).toBeGreaterThanOrEqual(0)
        expect(mdatAt).toBeGreaterThanOrEqual(0)
        expect(moovAt).toBeLessThan(mdatAt)

        const outInfo = expectOk(runProbe('out-a.mp4', 'probe-out-a.json'))
        expect(outInfo.video[0].codecName).toBe('h264')
        expect(outInfo.audio[0].codecName).toBe('aac')
        expect(outInfo.formatName).toContain('mp4')
      })
    },
  )

  it(
    '案例 B：全轉碼全鏈——vp8+vorbis → plan(full-transcode) → 真 exec → 回探 h264/aac/yuv420p',
    { timeout: CASE_TIMEOUT_MS },
    () => {
      timeCase('案例 B（全轉碼全鏈）', () => {
        cleanupPaths.push('out-b.mp4')
        const info = expectOk(runProbe('b.webm', 'probe-b.json'))
        expect(info.video[0].codecName).toBe('vp8')
        expect(info.audio[0].codecName).toBe('vorbis')

        const planned = planConversion(info, 'b.webm', 'out-b.mp4')
        if (!planned.ok) {
          throw new Error(`planConversion 意外失敗：${planned.reason}`)
        }
        expect(planned.plan.mode).toBe('full-transcode')

        const ret = runExec(['-v', 'error', ...planned.plan.args])
        expect(ret, `full-transcode exec ret=${ret}，log 尾段：\n${logTail()}`).toBe(0)

        const outInfo = expectOk(runProbe('out-b.mp4', 'probe-out-b.json'))
        expect(outInfo.video[0].codecName).toBe('h264')
        expect(outInfo.video[0].pixFmt).toBe('yuv420p')
        expect(outInfo.audio[0].codecName).toBe('aac')
        expect(outInfo.formatName).toContain('mp4')
      })
    },
  )

  it(
    '案例 C：blind plan 降級路徑——跳過 probe 直接 exec → ftyp＋回探 h264/aac',
    { timeout: CASE_TIMEOUT_MS },
    () => {
      timeCase('案例 C（blind plan）', () => {
        cleanupPaths.push('out-c.mp4')
        const plan = blindConversionPlan('a.mkv', 'out-c.mp4')
        expect(plan.mode).toBe('blind-transcode')

        const ret = runExec(['-v', 'error', ...plan.args])
        expect(ret, `blind-transcode exec ret=${ret}，log 尾段：\n${logTail()}`).toBe(0)

        const out = core.FS.readFile('out-c.mp4')
        expect(out.length).toBeGreaterThan(0)
        expect(ascii(out, 4, 8)).toBe('ftyp')

        const outInfo = expectOk(runProbe('out-c.mp4', 'probe-out-c.json'))
        expect(outInfo.video[0].codecName).toBe('h264')
        expect(outInfo.audio[0].codecName).toBe('aac')
      })
    },
  )

  it(
    '案例 D：copy 失敗樣態迴歸——vp8→mp4 硬 copy 必以 ret≠0 收場（T2.1 實證）',
    { timeout: CASE_TIMEOUT_MS },
    () => {
      timeCase('案例 D（copy 失敗迴歸）', () => {
        cleanupPaths.push('out-d.mp4')
        const ret = runExec(['-v', 'error', '-i', 'b.webm', '-c', 'copy', 'out-d.mp4'])
        expect(
          ret,
          'vp8→mp4 copy 竟回 ret=0——「ret 為主訊號」的失敗偵測前提被推翻，須重審 T2.1',
        ).not.toBe(0)
      })
    },
  )
})
