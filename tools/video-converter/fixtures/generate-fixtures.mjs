#!/usr/bin/env node
/**
 * SP-2 fixtures 產生器：以 @ffmpeg/core 0.12.10（node 直跑）自產樣本媒體，
 * 並擷取各樣本的 ffprobe JSON 簽入為 probe.ts 測試基準。
 *
 * 重生指令：node tools/video-converter/fixtures/generate-fixtures.mjs
 *
 * - plain node ESM，不進 typecheck/build 鏈。
 * - 全部樣本帶 `-bitexact -fflags +bitexact` 求輸出確定性：重跑本檔應得
 *   byte-identical 產物（簽入之 a/b 媒體 hash 不變；結尾印出 sha256 供比對）。
 * - 墊片模式複製自 scripts/spike-node-core.mjs（SP-4 已驗證）：
 *   `globalThis.self`＋`self.location.href` 必需；實際載入機制是
 *   `wasmBinary` + `mainScriptUrlOrBlob = '<url>#' + base64(JSON({wasmURL}))`
 *   （plain `locateFile` 會被 glue 覆寫、無效）；`exec`/`ffprobe` 皆為
 *   rest params 必須展開；每次呼叫後 `reset()`。
 *
 * 產物（相對本檔）：
 *   probe/<id>.json          — 各樣本 ffprobe JSON（簽入；probe.ts 測試基準）
 *   media/a-h264-aac.mkv     — 媒體本體僅 a/b 簽入（T3.3 整合測試用）
 *   media/b-vp8-vorbis.webm
 *   其餘樣本媒體僅存於 MEMFS，不落地。
 *
 * probe/external-*.json 不是本檔產物：那是 SP-2 時以同一 core ffprobe 對
 * 外部真實檔一次性擷取（來源 URL 見 (internal design doc)），
 * 重跑本檔不會重生它們。
 *
 * 本 core build 的編碼器地雷（SP-2 實測，詳見 SP2-INVENTORY.md）：
 * - libvpx-vp9 編碼＝wasm crash（RuntimeError: memory access out of bounds，
 *   fresh instance／任何參數／任何尺寸皆重現；解碼正常）→ 樣本 b 原規劃
 *   vp9+opus，改產 vp8+vorbis（同樣白名單外、觸發同一條全轉碼路徑）；
 *   vp9 probe JSON 證據由 probe/external-bbb-vp9-webm.json 提供。
 * - libx265 編碼＝無限迴圈 hang（64x64 與 128x128 皆重現，CPU 空轉不返回，
 *   core.setTimeout 攔不住）→ hevc 樣本不自產；hevc probe JSON 證據由
 *   probe/external-bbb-h265-mp4.json 提供。本檔絕不可呼叫 libx265。
 * - core 0.12.10 的 ffprobe wrapper 從不設定 Module["ret"]——成功與失敗
 *   一律回 -1，且失敗時 -o 仍寫出空物件 `{}`。成敗判定只能看 JSON 內容
 *   （streams 非空），不能看 ret。
 * - loglevel 是 process-global 且跨 exec/ffprobe 呼叫殘留（reset() 不還原）；
 *   本檔產出不受影響（每輪執行序列固定），但改動呼叫順序前要意識到這點。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fixturesDir = import.meta.dirname
const repoRoot = resolve(fixturesDir, '..', '..', '..')
const coreEsmDir = resolve(repoRoot, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm')
const coreJsPath = resolve(coreEsmDir, 'ffmpeg-core.js')
const coreWasmPath = resolve(coreEsmDir, 'ffmpeg-core.wasm')
const probeDir = join(fixturesDir, 'probe')
const mediaDir = join(fixturesDir, 'media')

if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis
}
if (typeof globalThis.self.location === 'undefined') {
  globalThis.self.location = { href: pathToFileURL(coreJsPath).href }
}

const mod = await import(pathToFileURL(coreJsPath).href)
const createFFmpegCore = mod.default
const wasmURL = pathToFileURL(coreWasmPath).href
const core = await createFFmpegCore({
  wasmBinary: readFileSync(coreWasmPath),
  mainScriptUrlOrBlob: `${pathToFileURL(coreJsPath).href}#${Buffer.from(JSON.stringify({ wasmURL })).toString('base64')}`,
})

let currentLogs = []
core.setLogger(({ type, message }) => {
  currentLogs.push(`[${type}] ${message}`)
})

/** 跑一次 exec 或 ffprobe，回收 ret 與該次呼叫的完整 log。 */
function run(kind, args) {
  currentLogs = []
  const ret = kind === 'ffprobe' ? core.ffprobe(...args) : core.exec(...args)
  const logs = currentLogs
  currentLogs = []
  core.reset()
  return { ret, logs }
}

const BITEXACT = ['-bitexact', '-fflags', '+bitexact']
const VSRC = 'testsrc=duration=0.5:size=64x64:rate=5'
const VSRC_WIDE = 'testsrc=duration=0.5:size=64x32:rate=5' // 非正方形——rotation 燒入時寬高交換才觀察得到
const SINE_440 = 'sine=frequency=440:duration=0.5'
const SINE_880 = 'sine=frequency=880:duration=0.5'
const SINE_48K = 'sine=frequency=440:duration=0.5:sample_rate=48000'
const X264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']

const summary = { coreVersion: '0.12.10', node: process.version, samples: [], hashes: {} }

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 在 MEMFS 產一顆樣本；失敗即中止（fixtures 不可默默缺片）。 */
function generate(id, args) {
  console.error(`[gen] ${id}: ${args.join(' ')}`)
  const { ret, logs } = run('exec', args)
  if (ret !== 0) {
    console.error(logs.join('\n'))
    throw new Error(`sample ${id}: exec ret=${ret} (args: ${args.join(' ')})`)
  }
  return { ret, logs }
}

/** ffprobe 一顆 MEMFS 檔 → JSON 寫入 probe/<id>.json（成敗判定見檔頭註記）。 */
function probe(id, inputFile, { expectFailure = false } = {}) {
  console.error(`[probe] ${id}`)
  const outName = `${id}.probe.json`
  const { ret, logs } = run('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', '-o', outName, inputFile,
  ])
  let jsonBytes = null
  try {
    jsonBytes = core.FS.readFile(outName)
  } catch {
    // 理論上 -o 一定會寫檔（失敗也寫空物件）；防禦保留
  }
  let parsed = null
  if (jsonBytes !== null && jsonBytes.length > 0) {
    parsed = JSON.parse(Buffer.from(jsonBytes).toString('utf8')) // 驗證是合法 JSON 才簽入
    writeFileSync(join(probeDir, `${id}.json`), Buffer.from(jsonBytes))
  }
  const gotStreams = Array.isArray(parsed?.streams) && parsed.streams.length > 0
  if (!expectFailure && !gotStreams) {
    console.error(logs.join('\n'))
    throw new Error(`probe ${id}: JSON 無 streams（ret=${ret}，ret 不可靠見檔頭）`)
  }
  summary.samples.push({
    id,
    probeRet: ret,
    probeStderr: expectFailure ? logs : undefined,
    streams: parsed ? (parsed.streams ?? []).map((s) => `${s.codec_type}:${s.codec_name}`) : null,
    jsonSha256: jsonBytes ? sha256(jsonBytes) : null,
  })
  return { ret, logs, parsed }
}

/**
 * 對 MP4 bytes 就地寫入 90° 顯示矩陣（tkhd matrix 欄位）。
 *
 * ffmpeg 5.1.4 無法從 CLI 寫 rotation：`-metadata:s:v:0 rotate=90` 被
 * 靜默丟棄（movenc 讀 rotate tag 的路徑已移除），`-display_rotation`
 * 是之後版本才有的選項（實測 Unrecognized option）。唯一可行替代＝
 * 直接 patch tkhd 的 36-byte matrix。2x2 部分 {a=0,b=1,c=-1,d=0}
 * （16.16 定點）→ av_display_rotation_get() = -90，與手機直拍檔
 * （rotate=90）的 ffprobe 表徵一致。確定性：純 byte 操作。
 */
function patchTkhdRotation(bytes) {
  let idx = -1
  for (let k = 0; k + 3 < bytes.length; k++) {
    if (bytes[k] === 0x74 && bytes[k + 1] === 0x6b && bytes[k + 2] === 0x68 && bytes[k + 3] === 0x64) {
      idx = k
      break
    }
  }
  if (idx < 0) throw new Error('tkhd not found')
  const payload = idx + 4
  if (bytes[payload] !== 0) throw new Error('tkhd version != 0')
  // v0 layout: ver/flags 4 + ctime 4 + mtime 4 + track_id 4 + reserved 4 +
  // duration 4 + reserved 8 + layer 2 + alt_group 2 + volume 2 + reserved 2
  const matrixOff = payload + 40
  const dv = new DataView(bytes.buffer, bytes.byteOffset)
  const M = [0, 0x00010000, 0, -0x00010000, 0, 0, 0, 0, 0x40000000]
  M.forEach((v, k) => dv.setInt32(matrixOff + 4 * k, v, false))
  return bytes
}

mkdirSync(probeDir, { recursive: true })
mkdirSync(mediaDir, { recursive: true })

// --- a. h264+aac 進 MKV（主場景；媒體本體簽入） ---
generate('a', ['-f', 'lavfi', '-i', VSRC, '-f', 'lavfi', '-i', SINE_440,
  ...X264, '-c:a', 'aac', ...BITEXACT, 'a.mkv'])
probe('a-h264-aac-mkv', 'a.mkv')

// --- b. WebM 全轉碼觸發樣本 vp8+vorbis（媒體本體簽入；vp9 不可產見檔頭） ---
generate('b', ['-f', 'lavfi', '-i', VSRC, '-f', 'lavfi', '-i', SINE_440,
  '-c:v', 'libvpx', '-b:v', '50k', '-c:a', 'libvorbis', ...BITEXACT, 'b.webm'])
probe('b-vp8-vorbis-webm', 'b.webm')

// --- k. 純音訊 opus 進 WebM（probe JSON only）：決策矩陣「opus → aac
//     轉碼」分支的第一手 stream JSON 證據；同時證明 libopus 編碼器可用
//     （vp9/x265 教訓：列在 -encoders ≠ 跑得動）。 ---
generate('k', ['-f', 'lavfi', '-i', SINE_48K, '-c:a', 'libopus', ...BITEXACT, 'k.webm'])
probe('k-opus-audio-webm', 'k.webm')

// （c. hevc 樣本不自產——libx265 hang，見檔頭；證據走 external JSON）

// --- d. h264 10-bit 進 MP4（白名單排除分支；本 build 的 libx264 實測
//     支援 10-bit 輸出） ---
generate('d', ['-f', 'lavfi', '-i', VSRC,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', ...BITEXACT, 'd.mp4'])
probe('d-h264-10bit-mp4', 'd.mp4')

// --- e. 純影片無音軌 MKV ---
generate('e', ['-f', 'lavfi', '-i', VSRC, ...X264, '-an', ...BITEXACT, 'e.mkv'])
probe('e-video-only-mkv', 'e.mkv')

// --- f. 純音訊 mp3（audio-only 分支） ---
generate('f', ['-f', 'lavfi', '-i', SINE_440, '-c:a', 'libmp3lame', '-b:a', '32k', ...BITEXACT, 'f.mp3'])
probe('f-audio-only-mp3', 'f.mp3')

// --- g. 多音軌 MKV（兩條 sine，各 -map 一次） ---
generate('g', ['-f', 'lavfi', '-i', VSRC, '-f', 'lavfi', '-i', SINE_440, '-f', 'lavfi', '-i', SINE_880,
  '-map', '0:v', '-map', '1:a', '-map', '2:a', ...X264, '-c:a', 'aac', ...BITEXACT, 'g.mkv'])
probe('g-multi-audio-mkv', 'g.mkv')

// --- h. 含字幕軌 MKV（MEMFS 寫 3 行 srt 後 mux 進去） ---
core.FS.writeFile('subs.srt', [
  '1', '00:00:00,000 --> 00:00:00,200', 'first line', '',
  '2', '00:00:00,200 --> 00:00:00,400', 'second line', '',
  '3', '00:00:00,400 --> 00:00:00,500', 'third line', '',
].join('\n'))
generate('h', ['-f', 'lavfi', '-i', VSRC, '-i', 'subs.srt',
  '-map', '0:v', '-map', '1:s', ...X264, '-c:s', 'srt', ...BITEXACT, 'h.mkv'])
probe('h-subtitles-mkv', 'h.mkv')

// --- i. rotation：h264 MP4＋tkhd 顯示矩陣 patch（非正方形源；媒體不簽入） ---
generate('i', ['-f', 'lavfi', '-i', VSRC_WIDE, ...X264, ...BITEXACT, 'i-base.mp4'])
core.FS.writeFile('i.mp4', patchTkhdRotation(core.FS.readFile('i-base.mp4')))
{
  const { parsed } = probe('i-rotation-mp4', 'i.mp4')
  const v = parsed?.streams?.find((s) => s.codec_type === 'video')
  const rot = v?.side_data_list?.some((d) => 'rotation' in d)
  if (!rot) {
    throw new Error('i-rotation: patched tkhd 未在 ffprobe side_data 顯現 rotation')
  }
}

// --- j. 損壞檔：取樣本 a 前 200 bytes，記錄 ffprobe 失敗樣態
//     （實測：ret 仍 -1、-o 寫出空物件 {}、stderr「I/O error」——空 streams
//     JSON 正是 probe.ts 必須辨識的失敗形狀，簽入） ---
core.FS.writeFile('j.mkv', core.FS.readFile('a.mkv').slice(0, 200))
probe('j-corrupted-mkv', 'j.mkv', { expectFailure: true })

// --- 媒體本體落地：僅 a、b 簽入 ---
for (const [memfsName, repoName] of [
  ['a.mkv', 'a-h264-aac.mkv'],
  ['b.webm', 'b-vp8-vorbis.webm'],
]) {
  const bytes = core.FS.readFile(memfsName)
  writeFileSync(join(mediaDir, repoName), Buffer.from(bytes))
  summary.hashes[repoName] = { sha256: sha256(bytes), size: bytes.length }
}

console.log(JSON.stringify(summary, null, 2))
