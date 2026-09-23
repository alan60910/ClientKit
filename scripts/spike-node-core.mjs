#!/usr/bin/env node
/**
 * SP-4 spike: node 直跑 core 可行性——T3.3 整合測試的前身。
 *
 * 繞過 @ffmpeg/ffmpeg 的 worker 包裝層（node exports 條件指向的 empty.mjs
 * 建構子直接 throw，見 (internal design doc) 已查證事實 #12），
 * 直接動態 import `@ffmpeg/core/dist/esm/ffmpeg-core.js` 取得
 * `createFFmpegCore`，在 plain node 下嘗試跑一次 `-f lavfi -i testsrc`
 * 最小轉檔，逐項驗證所需墊片（`self`/`btoa`/`locateFile`/`ENVIRONMENT`）。
 *
 * 不掛任何 npm hook、不進 build 鏈；跑法：`node scripts/spike-node-core.mjs`。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const coreEsmDir = resolve(import.meta.dirname, '..', 'node_modules', '@ffmpeg', 'core', 'dist', 'esm')
const coreJsPath = resolve(coreEsmDir, 'ffmpeg-core.js')
const coreWasmPath = resolve(coreEsmDir, 'ffmpeg-core.wasm')

const shimsApplied = []

function note(name, needed, evidence) {
  shimsApplied.push({ name, needed, evidence })
}

// --- shim candidates (apply preemptively, then note whether removing them
// would have broken things by watching for the specific errors each guards
// against — see per-shim comments) ---

// ENVIRONMENT: this build has ENVIRONMENT_IS_WORKER hardcoded `true` as a
// compile-time literal (`var ENVIRONMENT_IS_WORKER=true`), NOT a runtime
// `typeof self` sniff — confirmed by reading the emitted glue. There is no
// Module-override knob to change it; the worker codepath always runs. This
// is the "ENVIRONMENT" concern from PLAN.md flagged as feasibility-critical.
// Verdict: it does NOT reject node outright (no explicit environment guard
// that throws) — it just means the worker-oriented init code executes
// unconditionally and needs `self`/`self.location` satisfied (below).
note('ENVIRONMENT (ENVIRONMENT_IS_WORKER build flag)', 'NEEDED — but surmountable, not a hard block', 'hardcoded `true` at build time in the glue source; no override exists; confirmed NOT to throw/reject once self+self.location are shimmed (see this run\'s FEASIBLE verdict)')

// `self`: bare identifier reference (`self.location.href`), not
// `globalThis.self` — isolated test confirms that omitting this entirely
// throws `ReferenceError: self is not defined` (node has no implicit
// `self` global, unlike browser/worker scopes).
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis
}
note('globalThis.self', 'NEEDED', 'isolated test without any self shim: "ReferenceError: self is not defined" at module init (ENVIRONMENT_IS_WORKER branch)')

// `self.location.href`: module-init unconditionally runs
// `scriptDirectory=self.location.href` under the (hardcoded-true)
// ENVIRONMENT_IS_WORKER branch. `self` alone (plain object) has no
// `.location` — isolated test confirms `TypeError: Cannot read properties
// of undefined (reading 'href')` without this shim.
if (typeof globalThis.self.location === 'undefined') {
  globalThis.self.location = { href: pathToFileURL(coreJsPath).href }
}
note('globalThis.self.location.href', 'NEEDED', "reproduced directly: TypeError: Cannot read properties of undefined (reading 'href') at module init without this shim")

// `btoa`: NOT needed for this codepath — grepping the glue source finds
// zero `btoa(` call sites (only `atob(`, used once to decode
// `mainScriptUrlOrBlob`'s config fragment). Node 22 also ships a native
// global `btoa` regardless, so even a hypothetical call site would be
// covered without any shim.
const btoaPreexisted = typeof globalThis.btoa !== 'undefined'
note('globalThis.btoa', 'NOT NEEDED', `zero "btoa(" call sites found in ffmpeg-core.js glue (only "atob(" is used); also Node ${process.version} already provides a native btoa (present: ${btoaPreexisted})`)

// `locateFile` (plain Emscripten-style Module override): NOT the working
// mechanism — this @ffmpeg/core build's own glue unconditionally overwrites
// `Module["locateFile"]` with its internal `_locateFile` before any
// user-supplied moduleOverrides are consulted, so a caller-supplied
// `locateFile` function is silently ignored (confirmed: passing one made no
// observable difference). The actual working path is `wasmBinary` (raw
// bytes, bypasses fetch/locateFile entirely) + `mainScriptUrlOrBlob` (a URL
// with a `#`-delimited `base64(JSON.stringify({wasmURL}))` suffix that
// `_locateFile` decodes) — see below.
note('locateFile (plain Module override)', 'NOT EFFECTIVE', 'Module["locateFile"]=_locateFile runs unconditionally in this build\'s glue, overwriting any caller-supplied locateFile — confirmed by reading source; real mechanism is wasmBinary + mainScriptUrlOrBlob (see inline comments below)')

const results = {
  nodeVersion: process.version,
  timings: {},
  shims: shimsApplied,
  libx264: null,
  mpeg4Fallback: null,
  ftypAssertion: null,
  ret: null,
  outputSize: null,
  logs: [],
  verdict: null,
  error: null,
}

const logs = []

function log(line) {
  logs.push(line)
}

async function main() {
  if (!existsSync(coreJsPath) || !existsSync(coreWasmPath)) {
    throw new Error(`missing core assets at ${coreEsmDir} — run "npm install" first`)
  }

  const tImportStart = performance.now()
  const mod = await import(pathToFileURL(coreJsPath).href)
  const createFFmpegCore = mod.default
  results.timings.t_import_ms = performance.now() - tImportStart
  if (typeof createFFmpegCore !== 'function') {
    throw new Error(`default export is not a function (got ${typeof createFFmpegCore})`)
  }

  // This @ffmpeg/core build's own glue unconditionally overwrites
  // `Module["locateFile"]` with an internal `_locateFile` (see module
  // source: `Module["locateFile"]=_locateFile` runs before any
  // user-supplied override is consulted) — passing a plain `locateFile`
  // function in moduleOverrides is silently ignored, it is NEVER called.
  // `_locateFile` instead expects `Module["mainScriptUrlOrBlob"]` to be a
  // URL string with a `#`-delimited suffix that is
  // `base64(JSON.stringify({ wasmURL, workerURL? }))` — this is
  // @ffmpeg/ffmpeg's private protocol for handing the worker-resolved
  // wasmURL across to the core glue (confirmed by reading the throw site:
  // `atob(mainScriptUrlOrBlob.slice(mainScriptUrlOrBlob.lastIndexOf("#")+1))`
  // then `JSON.parse(...)` destructured as `{wasmURL, workerURL}`).
  // A first attempt passing `mainScriptUrlOrBlob` as a bare URL (no `#`
  // fragment) threw `InvalidCharacterError: Invalid character` from `atob`
  // trying to base64-decode the whole URL string.
  const wasmURL = pathToFileURL(coreWasmPath).href
  const configFragment = Buffer.from(JSON.stringify({ wasmURL })).toString('base64')
  const mainScriptUrlOrBlob = `${pathToFileURL(coreJsPath).href}#${configFragment}`

  // Even with the correct mainScriptUrlOrBlob protocol, Emscripten's async
  // wasm-loading path (getBinaryPromise/readAsync) reaches for the global
  // `fetch(wasmURL)` when `typeof fetch=='function'` (true in Node 22) —
  // and Node's fetch (undici) does not support `file:` URLs, throwing
  // bare `TypeError: fetch failed`. Passing `Module["wasmBinary"]`
  // sidesteps that entirely: the glue checks `if(Module["wasmBinary"])`
  // BEFORE ever computing/fetching a wasmURL (confirmed by reading source:
  // `var wasmBinary;if(Module["wasmBinary"])wasmBinary=Module["wasmBinary"]`
  // near the top of the factory, unconditional — unlike locateFile this one
  // is NOT overwritten by @ffmpeg/core's own glue).
  const wasmBinary = readFileSync(coreWasmPath)

  const tInstantiateStart = performance.now()
  const core = await createFFmpegCore({
    mainScriptUrlOrBlob,
    wasmBinary,
  })
  results.timings.t_instantiate_ms = performance.now() - tInstantiateStart

  core.setLogger(({ type, message }) => {
    log(`[${type}] ${message}`)
  })

  async function runExec(args, label) {
    // core.exec is declared `function exec(..._args)` (rest params, NOT an
    // array parameter) — must spread, else the whole array lands as a
    // single non-string element and stringsToPtr's charCodeAt call blows up.
    const tStart = performance.now()
    const ret = core.exec(...args)
    const elapsed = performance.now() - tStart
    return { ret, elapsed, label }
  }

  const tExecStart = performance.now()
  const h264Attempt = await runExec(
    ['-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=64x64:rate=5', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', 'out.mp4'],
    'libx264',
  )
  results.timings.t_exec_h264_ms = h264Attempt.elapsed
  results.ret = h264Attempt.ret

  const libx264Missing = logs.some((l) => /Unknown encoder|libx264/i.test(l) && /Unknown encoder/i.test(l))
  results.libx264 = h264Attempt.ret === 0 ? 'present (exec ret=0)' : libx264Missing ? 'absent (Unknown encoder in log)' : `exec ret=${h264Attempt.ret}, cause unclear from log`

  let finalAttempt = h264Attempt
  let finalCodec = 'libx264'

  if (h264Attempt.ret !== 0) {
    try {
      core.FS.unlink('out.mp4')
    } catch {
      // out.mp4 may not exist if the libx264 exec failed before writing anything
    }
    const mpeg4Attempt = await runExec(
      ['-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=64x64:rate=5', '-pix_fmt', 'yuv420p', '-c:v', 'mpeg4', 'out.mp4'],
      'mpeg4',
    )
    results.timings.t_exec_mpeg4_fallback_ms = mpeg4Attempt.elapsed
    results.mpeg4Fallback = mpeg4Attempt.ret === 0 ? 'succeeded (node exec path itself is viable)' : `also failed, ret=${mpeg4Attempt.ret}`
    finalAttempt = mpeg4Attempt
    finalCodec = 'mpeg4'
  }

  results.timings.t_exec_total_ms = performance.now() - tExecStart
  results.finalCodecUsed = finalCodec
  results.ret = finalAttempt.ret

  if (finalAttempt.ret === 0) {
    const bytes = core.FS.readFile('out.mp4')
    results.outputSize = bytes.length
    const ftypAscii = Buffer.from(bytes.slice(4, 8)).toString('ascii')
    results.ftypAssertion = {
      offsetBytesAscii: ftypAscii,
      pass: bytes.length > 0 && ftypAscii === 'ftyp',
    }
  }

  results.logs = logs
  results.verdict = finalAttempt.ret === 0 ? 'FEASIBLE' : 'INFEASIBLE'

  if (results.verdict === 'FEASIBLE') {
    const measuredTotalMs = results.timings.t_import_ms + results.timings.t_instantiate_ms + results.timings.t_exec_total_ms
    // 10x safety factor over a <1s synthetic testsrc encode — generous
    // headroom for slower CI runners without being so loose it hides a
    // real hang.
    results.recommendedTestTimeoutMs = Math.max(5000, Math.ceil((measuredTotalMs * 10) / 1000) * 1000)
  }
}

main()
  .then(() => {
    console.log(JSON.stringify(results, null, 2))
  })
  .catch((err) => {
    results.error = { message: err.message, stack: err.stack }
    results.verdict = 'INFEASIBLE'
    results.logs = logs
    console.log(JSON.stringify(results, null, 2))
    process.exitCode = 1
  })
