/**
 * S4-T3.1：ffmpeg-client 生命週期契約測試（node、注入 fake FFmpegLike）。
 *
 * 本檔頂層 import ffmpeg-client 即是「無頂層 new FFmpeg()」的執行證明——
 * node 下 '@ffmpeg/ffmpeg' 解析到 empty.mjs，其 FFmpeg 建構子一觸即 throw
 * （PLAN 已查證事實 12），若模組頂層有 new，整個測試檔在收集期就炸。
 *
 * fetchFile 替身：@ffmpeg/util 的 fetchFile 對 File/Blob 走 FileReader
 * （node 無）——測試注入 `blob.arrayBuffer()` 替身（FfmpegClientOptions
 * 本就開注入點，生產端不注入、用真 fetchFile）。
 */

import { describe, expect, it } from 'vitest'
import { vendorAssetUrl } from './asset-url.js'
import {
  EXEC_EXCEPTION_RET,
  FfmpegCancelledError,
  FfmpegClient,
  OUTPUT_NAME,
  type FFmpegLike,
  type FFmpegLogEvent,
  type FFmpegProgressEvent,
  type WorkerFsMountOptions,
} from './ffmpeg-client.js'

const PAGE_HREF = 'https://alan60910.github.io/ClientKit/tools/video-converter/'

const VALID_PROBE_JSON = JSON.stringify({
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p' },
  ],
  format: { format_name: 'matroska,webm', duration: '3.000000' },
})

interface Call {
  method: string
  args: unknown[]
}

interface FakeBehavior {
  loadImpl?: (fake: FakeFFmpeg) => Promise<boolean>
  execImpl?: (args: string[], fake: FakeFFmpeg) => Promise<number>
  mountImpl?: (fake: FakeFFmpeg) => Promise<boolean>
  readFileImpl?: (path: string, encoding?: string) => Promise<Uint8Array | string>
  probeJson?: string
  outputBytes?: Uint8Array
}

class FakeFFmpeg implements FFmpegLike {
  readonly calls: Call[] = []
  readonly logHandlers: Array<(event: FFmpegLogEvent) => void> = []
  readonly progressHandlers: Array<(event: FFmpegProgressEvent) => void> = []

  constructor(private readonly behavior: FakeBehavior = {}) {}

  #record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args })
  }

  methodNames(): string[] {
    return this.calls.map((call) => call.method)
  }

  callsOf(method: string): Call[] {
    return this.calls.filter((call) => call.method === method)
  }

  /** 清理相關呼叫的（方法, 首參數）序列——測試以此鎖定清理順序。 */
  cleanupSequence(): Array<[string, unknown]> {
    return this.calls
      .filter((call) => ['deleteFile', 'unmount', 'deleteDir'].includes(call.method))
      .map((call) => [call.method, call.args[0]])
  }

  emitLog(message: string): void {
    for (const handler of this.logHandlers) handler({ type: 'stderr', message })
  }

  emitProgress(event: FFmpegProgressEvent): void {
    for (const handler of this.progressHandlers) handler(event)
  }

  async load(config: { coreURL: string; wasmURL: string }): Promise<boolean> {
    this.#record('load', config)
    return this.behavior.loadImpl ? this.behavior.loadImpl(this) : true
  }

  async exec(args: string[], timeout?: number): Promise<number> {
    this.#record('exec', args, timeout)
    return this.behavior.execImpl ? this.behavior.execImpl(args, this) : 0
  }

  async ffprobe(args: string[]): Promise<number> {
    this.#record('ffprobe', args)
    return -1 // wrapper 的 ffprobe ret 恆 -1（WORKS.md T2.1 實證形狀）
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<boolean> {
    this.#record('writeFile', path, data)
    return true
  }

  async readFile(path: string, encoding?: string): Promise<Uint8Array | string> {
    this.#record('readFile', path, encoding)
    if (this.behavior.readFileImpl) return this.behavior.readFileImpl(path, encoding)
    if (path === 'probe-output.json') return this.behavior.probeJson ?? '{}'
    if (path === OUTPUT_NAME) return this.behavior.outputBytes ?? new Uint8Array([0])
    throw new Error(`FakeFFmpeg.readFile: 未預期路徑 ${path}`)
  }

  async deleteFile(path: string): Promise<boolean> {
    this.#record('deleteFile', path)
    return true
  }

  async createDir(path: string): Promise<boolean> {
    this.#record('createDir', path)
    return true
  }

  async deleteDir(path: string): Promise<boolean> {
    this.#record('deleteDir', path)
    return true
  }

  async mount(fsType: string, options: WorkerFsMountOptions, mountPoint: string): Promise<boolean> {
    this.#record('mount', fsType, options, mountPoint)
    return this.behavior.mountImpl ? this.behavior.mountImpl(this) : true
  }

  async unmount(mountPoint: string): Promise<boolean> {
    this.#record('unmount', mountPoint)
    return true
  }

  terminate(): void {
    this.#record('terminate')
  }

  on(event: 'log' | 'progress', callback: unknown): void {
    this.#record('on', event)
    if (event === 'log') this.logHandlers.push(callback as (e: FFmpegLogEvent) => void)
    else this.progressHandlers.push(callback as (e: FFmpegProgressEvent) => void)
  }

  off(event: 'log' | 'progress', callback: unknown): void {
    this.#record('off', event)
    const handlers = event === 'log' ? this.logHandlers : this.progressHandlers
    const index = handlers.indexOf(callback as never)
    if (index >= 0) handlers.splice(index, 1)
  }
}

function makeClient(behavior: FakeBehavior = {}) {
  const created: FakeFFmpeg[] = []
  const client = new FfmpegClient({
    pageHref: PAGE_HREF,
    createFFmpeg: () => {
      const fake = new FakeFFmpeg(behavior)
      created.push(fake)
      return fake
    },
    fetchFile: async (blob) => new Uint8Array(await blob.arrayBuffer()),
  })
  return { client, created, fake: () => created[0] }
}

function makeInputFile(name = 'movie.mkv'): File {
  return new File([new Uint8Array([1, 2, 3])], name)
}

const copyArgsBuilder = (inputPath: string, outputPath: string): string[] => [
  '-i',
  inputPath,
  '-c',
  'copy',
  outputPath,
]

describe('ffmpeg-client 模組 import 安全', () => {
  it('頂層 import 不炸（node stub 建構子即 throw——能執行到此即證明無頂層 new FFmpeg()）', () => {
    expect(typeof FfmpegClient).toBe('function')
  })
})

describe('ensureLoaded／自足性守衛', () => {
  it('load() 收到雙絕對 URL：非空、含 vendor 路徑、與 vendorAssetUrl(pageHref,…) 相等（project-page 形 pageHref）', async () => {
    const { client, fake } = makeClient()
    await client.ensureLoaded()

    const loadCalls = fake().callsOf('load')
    expect(loadCalls).toHaveLength(1)
    const config = loadCalls[0].args[0] as { coreURL: string; wasmURL: string }

    expect(typeof config.coreURL).toBe('string')
    expect(typeof config.wasmURL).toBe('string')
    expect(config.coreURL.length).toBeGreaterThan(0)
    expect(config.wasmURL.length).toBeGreaterThan(0)
    expect(config.coreURL).toContain('/vendor/ffmpeg/ffmpeg-core.js')
    expect(config.wasmURL).toContain('/vendor/ffmpeg/ffmpeg-core.wasm')
    expect(config.coreURL).toBe(vendorAssetUrl(PAGE_HREF, 'vendor/ffmpeg/ffmpeg-core.js'))
    expect(config.wasmURL).toBe(vendorAssetUrl(PAGE_HREF, 'vendor/ffmpeg/ffmpeg-core.wasm'))
    // project page 部署形：上溯落在站台根（/ClientKit/），非網域根。
    expect(config.coreURL).toBe('https://alan60910.github.io/ClientKit/vendor/ffmpeg/ffmpeg-core.js')
    expect(config.wasmURL).toBe(
      'https://alan60910.github.io/ClientKit/vendor/ffmpeg/ffmpeg-core.wasm',
    )
  })

  it('冪等：首次回 true、再呼叫回 false，load 只執行一次', async () => {
    const { client, fake } = makeClient()
    expect(await client.ensureLoaded()).toBe(true)
    expect(await client.ensureLoaded()).toBe(false)
    expect(fake().callsOf('load')).toHaveLength(1)
    expect(client.loaded).toBe(true)
  })

  it('併發呼叫共用同一 in-flight load：回 [true, false]，load 只執行一次', async () => {
    const { client, fake } = makeClient()
    const results = await Promise.all([client.ensureLoaded(), client.ensureLoaded()])
    expect(results).toEqual([true, false])
    expect(fake().callsOf('load')).toHaveLength(1)
  })
})

describe('loglevel 殘留鎖定：args 前置 -v error', () => {
  it('ffprobe 的 args 前兩元素為 ["-v","error"]', async () => {
    const { client, fake } = makeClient({ probeJson: VALID_PROBE_JSON })
    await client.probeFile(makeInputFile())
    const [call] = fake().callsOf('ffprobe')
    expect((call.args[0] as string[]).slice(0, 2)).toEqual(['-v', 'error'])
  })

  it('exec 的 args＝["-v","error"] 前置＋argsBuilder 原樣接續（builder 收到 mount 輸入路徑與固定輸出名）', async () => {
    const { client, fake } = makeClient({ probeJson: VALID_PROBE_JSON })
    await client.runConversion(makeInputFile(), copyArgsBuilder)
    const [call] = fake().callsOf('exec')
    expect(call.args[0]).toEqual([
      '-v',
      'error',
      '-i',
      '/input/movie.mkv',
      '-c',
      'copy',
      'output.mp4',
    ])
  })
})

describe('probeFile', () => {
  it('ffprobe ret=-1＋readFile 回有效 JSON → ok:true（成敗不看 ret 的證明）', async () => {
    const { client } = makeClient({ probeJson: VALID_PROBE_JSON })
    const result = await client.probeFile(makeInputFile())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.info.video[0].codecName).toBe('h264')
      expect(result.info.durationSec).toBe(3)
    }
  })

  it('readFile 回空物件 {}（失敗時 wrapper 仍寫檔的實證形狀）→ ok:false no-streams', async () => {
    const { client } = makeClient({ probeJson: '{}' })
    const result = await client.probeFile(makeInputFile())
    expect(result).toEqual({ ok: false, reason: 'no-streams' })
  })

  it('probe 輸出檔讀不回（readFile throw）→ 收斂 ok:false invalid-json，不 throw', async () => {
    const { client } = makeClient({
      readFileImpl: async () => {
        throw new Error('FS error: no such file')
      },
    })
    const result = await client.probeFile(makeInputFile())
    expect(result).toEqual({ ok: false, reason: 'invalid-json' })
  })

  it('WORKERFS mount 序：createDir 先於 mount，mountPoint=/input，File 走 files 條目', async () => {
    const { client, fake } = makeClient({ probeJson: VALID_PROBE_JSON })
    const file = makeInputFile()
    await client.probeFile(file)

    const names = fake().methodNames()
    expect(names.indexOf('createDir')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('createDir')).toBeLessThan(names.indexOf('mount'))
    const [mountCall] = fake().callsOf('mount')
    expect(mountCall.args[0]).toBe('WORKERFS')
    expect(mountCall.args[1]).toEqual({ files: [file] })
    expect(mountCall.args[2]).toBe('/input')
  })

  it('job 間清理：deleteFile(probe json) → unmount → deleteDir', async () => {
    const { client, fake } = makeClient({ probeJson: VALID_PROBE_JSON })
    await client.probeFile(makeInputFile())
    expect(fake().cleanupSequence()).toEqual([
      ['deleteFile', 'probe-output.json'],
      ['unmount', '/input'],
      ['deleteDir', '/input'],
    ])
  })
})

describe('runConversion', () => {
  it('ret=0 → ok:true 回傳輸出 bytes＋清理序 deleteFile(輸出) → unmount → deleteDir', async () => {
    const outputBytes = new Uint8Array([9, 8, 7])
    const { client, fake } = makeClient({ outputBytes })
    const result = await client.runConversion(makeInputFile(), copyArgsBuilder)

    expect(result).toEqual({ ok: true, data: outputBytes })
    expect(fake().cleanupSequence()).toEqual([
      ['deleteFile', 'output.mp4'],
      ['unmount', '/input'],
      ['deleteDir', '/input'],
    ])
    // 清理發生在 readFile 取回輸出之後。
    const names = fake().methodNames()
    expect(names.indexOf('readFile')).toBeLessThan(names.indexOf('deleteFile'))
  })

  it('ret=1 → ok:false 含 ret 與 logTail（copy 失敗歸因特徵行可得），且輸入仍被清理', async () => {
    const { client, fake } = makeClient({
      execImpl: async (_args, self) => {
        self.emitLog('Could not find tag for codec vp8 in stream #0')
        self.emitLog('Could not write header for output file #0')
        return 1
      },
    })
    const result = await client.runConversion(makeInputFile(), copyArgsBuilder)
    expect(result).toEqual({
      ok: false,
      ret: 1,
      logTail: [
        'Could not find tag for codec vp8 in stream #0',
        'Could not write header for output file #0',
      ],
    })
    expect(fake().cleanupSequence()).toEqual([
      ['deleteFile', 'output.mp4'],
      ['unmount', '/input'],
      ['deleteDir', '/input'],
    ])
  })

  it('exec throw（模擬 wasm OOM abort）→ 同樣收斂 ok:false（ret 哨兵）＋例外訊息入 logTail，不 throw', async () => {
    const { client } = makeClient({
      execImpl: async () => {
        throw new Error('abort(OOM). Build with -sASSERTIONS for more info.')
      },
    })
    const result = await client.runConversion(makeInputFile(), copyArgsBuilder)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.ret).toBe(EXEC_EXCEPTION_RET)
      expect(result.logTail.join('\n')).toContain('abort(OOM)')
    }
  })

  it('logTail 為最近 ~50 行 ring buffer（超量丟最舊），且每 job 起點歸零', async () => {
    const { client } = makeClient({
      execImpl: async (_args, self) => {
        for (let i = 1; i <= 60; i++) self.emitLog(`line-${i}`)
        return 1
      },
    })
    const result = await client.runConversion(makeInputFile(), copyArgsBuilder)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.logTail).toHaveLength(50)
      expect(result.logTail[0]).toBe('line-11')
      expect(result.logTail[49]).toBe('line-60')
    }
  })
})

describe('WORKERFS fallback', () => {
  it('mount throw → fetchFile 替身讀 bytes → writeFile；清理改 deleteFile(輸入)、無 unmount', async () => {
    const { client, fake } = makeClient({
      outputBytes: new Uint8Array([5]),
      mountImpl: async () => {
        throw new Error('WORKERFS mount failed')
      },
    })
    const result = await client.runConversion(makeInputFile(), copyArgsBuilder)
    expect(result.ok).toBe(true)

    const [writeCall] = fake().callsOf('writeFile')
    expect(writeCall.args[0]).toBe('movie.mkv')
    expect(writeCall.args[1]).toEqual(new Uint8Array([1, 2, 3]))
    // 輸入路徑改用 MEMFS 檔名（非 /input/ 前綴）。
    const [execCall] = fake().callsOf('exec')
    expect((execCall.args[0] as string[])).toContain('movie.mkv')
    expect((execCall.args[0] as string[])).not.toContain('/input/movie.mkv')
    // 清理：先清掉 mount 失敗殘留的空目錄，job 尾清輸出與輸入；無 unmount。
    expect(fake().cleanupSequence()).toEqual([
      ['deleteDir', '/input'],
      ['deleteFile', 'output.mp4'],
      ['deleteFile', 'movie.mkv'],
    ])
    expect(fake().methodNames()).not.toContain('unmount')
  })

  it('fallback 輸入名撞保留輸出名（output.mp4）→ 前綴 in- 避開', async () => {
    const { client, fake } = makeClient({
      mountImpl: async () => {
        throw new Error('WORKERFS mount failed')
      },
    })
    await client.runConversion(makeInputFile('output.mp4'), copyArgsBuilder)
    const [writeCall] = fake().callsOf('writeFile')
    expect(writeCall.args[0]).toBe('in-output.mp4')
  })

  it('無 name 的 Blob → WORKERFS blobs 條目以補位名掛載（不落 fallback）', async () => {
    const { client, fake } = makeClient({ probeJson: VALID_PROBE_JSON })
    const blob = new Blob([new Uint8Array([1, 2, 3])])
    await client.probeFile(blob)
    const [mountCall] = fake().callsOf('mount')
    expect(mountCall.args[1]).toEqual({ blobs: [{ name: 'input', data: blob }] })
    const [probeCall] = fake().callsOf('ffprobe')
    expect(probeCall.args[0] as string[]).toContain('/input/input')
  })
})

describe('cancel（三態收斂）', () => {
  it('converting 期取消：terminate 被呼叫、進行中 Promise 以 FfmpegCancelledError 收斂（即使底層 exec hang）', async () => {
    let execStarted!: () => void
    const started = new Promise<void>((resolve) => {
      execStarted = resolve
    })
    const { client, fake } = makeClient({
      execImpl: () => {
        execStarted()
        return new Promise<number>(() => {}) // 永不 settle：x265 hang 類
      },
    })
    const pending = client.runConversion(makeInputFile(), copyArgsBuilder)
    await started
    client.cancel()
    expect(fake().methodNames()).toContain('terminate')
    await expect(pending).rejects.toBeInstanceOf(FfmpegCancelledError)
  })

  it('loading-core 期取消：load 中止、ensureLoaded 以 FfmpegCancelledError 收斂', async () => {
    let loadStarted!: () => void
    const started = new Promise<void>((resolve) => {
      loadStarted = resolve
    })
    const { client, fake } = makeClient({
      loadImpl: () => {
        loadStarted()
        return new Promise<boolean>(() => {})
      },
    })
    const pending = client.ensureLoaded()
    await started
    client.cancel()
    expect(fake().methodNames()).toContain('terminate')
    await expect(pending).rejects.toBeInstanceOf(FfmpegCancelledError)
    expect(client.loaded).toBe(false)
  })

  it('取消後再 ensureLoaded：factory 被呼叫第二次（重建證明）、新實例重新 load、回 true', async () => {
    const { client, created } = makeClient({
      execImpl: () => new Promise<number>(() => {}),
    })
    const pending = client.runConversion(makeInputFile(), copyArgsBuilder)
    await new Promise((resolve) => setTimeout(resolve, 0)) // 讓 job 走到 exec
    client.cancel()
    await expect(pending).rejects.toBeInstanceOf(FfmpegCancelledError)

    expect(await client.ensureLoaded()).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[1].callsOf('load')).toHaveLength(1)
  })
})

describe('onProgress／onLog 訂閱轉發', () => {
  it('progress 原始值直轉發（>1 不 clamp——收斂責任在 UI 層 limits），退訂即停', async () => {
    const { client, fake } = makeClient()
    const events: FFmpegProgressEvent[] = []
    const unsubscribe = client.onProgress((event) => events.push(event))
    await client.ensureLoaded()

    fake().emitProgress({ progress: 1.5, time: 42 })
    expect(events).toEqual([{ progress: 1.5, time: 42 }])

    unsubscribe()
    fake().emitProgress({ progress: 0.5, time: 43 })
    expect(events).toHaveLength(1)
  })

  it('log 原始事件直轉發，退訂即停', async () => {
    const { client, fake } = makeClient()
    const messages: string[] = []
    const unsubscribe = client.onLog((event) => messages.push(event.message))
    await client.ensureLoaded()

    fake().emitLog('frame=1')
    expect(messages).toEqual(['frame=1'])

    unsubscribe()
    fake().emitLog('frame=2')
    expect(messages).toHaveLength(1)
  })
})

describe('併發防護（單實例一次一工作）', () => {
  it('job 進行中再開 job → 立即 throw，原 job 不受影響', async () => {
    let resolveExec!: (ret: number) => void
    let execStarted!: () => void
    const started = new Promise<void>((resolve) => {
      execStarted = resolve
    })
    const { client } = makeClient({
      execImpl: () => {
        execStarted()
        return new Promise<number>((resolve) => {
          resolveExec = resolve
        })
      },
    })
    const first = client.runConversion(makeInputFile(), copyArgsBuilder)
    await expect(client.probeFile(makeInputFile())).rejects.toThrow('已有工作進行中')
    await started
    resolveExec(0)
    const result = await first
    expect(result.ok).toBe(true)
  })

  it('job 完成後 busy 釋放：同一 client 依序 probeFile → runConversion 皆成功（生產鏈 probe→convert 復用）', async () => {
    const outputBytes = new Uint8Array([7])
    const { client } = makeClient({ probeJson: VALID_PROBE_JSON, outputBytes })
    const probe = await client.probeFile(makeInputFile())
    expect(probe.ok).toBe(true)
    const result = await client.runConversion(makeInputFile(), copyArgsBuilder)
    expect(result).toEqual({ ok: true, data: outputBytes })
  })
})
