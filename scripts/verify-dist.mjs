#!/usr/bin/env node
/**
 * Post-build guard, run after `npm run build` (see package.json's
 * `verify:dist` script and .github/workflows/deploy.yml — the same workflow
 * file lives in both repos but only runs in the public ClientKit repo).
 *
 * This file is the thin CLI shell: it resolves `distDir`/`rootDir`,
 * delegates to `runAllChecks` (scripts/verify-dist-checks.mjs) for the
 * actual checks, prints each failure message with the `verify:dist FAIL - `
 * prefix, and exits 1 if anything failed (0 otherwise). See
 * verify-dist-checks.mjs's file header for the full list of what is
 * checked.
 *
 * `main()` is exported (rather than calling `process.exit` unconditionally
 * at module scope) so it *could* be imported and called in-process. In
 * practice this file also carries a Unix shebang (`#!/usr/bin/env node`,
 * preserved from the pre-refactor script so `./scripts/verify-dist.mjs` stays
 * directly executable), and Vite/Vitest's esbuild-based transform does not
 * parse that shebang line the same way plain Node/tsc do — importing this
 * file from a vitest test file throws a `SyntaxError` at transform time
 * (verified while building this test suite). The CLI-shell smoke test
 * therefore runs this file as a real child process (`node
 * scripts/verify-dist.mjs [rootDir] [distDir]`, see
 * scripts/verify-dist-checks.test.ts) rather than importing `main`
 * in-process — this doubles as the one "shell out to the whole script"
 * smoke case (internal design doc)'s D3-b option allows.
 * `main()` stays exported regardless: it's the natural unit boundary and
 * costs nothing to expose.
 *
 * The two optional CLI positional args (`process.argv[2]`/`[3]`) below exist
 * solely so that child-process smoke test can point this script at a
 * synthetic fixture; `npm run verify:dist`'s normal zero-arg invocation is
 * untouched (`main(undefined, undefined)` falls through to the same
 * `resolve(import.meta.dirname, '..')`/`<rootDir>/dist` defaults as before).
 *
 * The `process.argv[1] !== undefined && import.meta.url ===
 * pathToFileURL(process.argv[1]).href` guard is what runs `main()` only when
 * this file is executed as `node scripts/verify-dist.mjs`, not merely
 * imported. A naive `import.meta.url === process.argv[1]` guard is always
 * false on Windows — `import.meta.url` is a `file:///E:/...` URL while
 * `process.argv[1]` is a bare `E:\...` path — so `pathToFileURL` is required
 * for the guard to ever match there ((internal design doc) T1.1 PoC
 * finding). The `process.argv[1] !== undefined` short-circuit ((internal design doc)
 * Minority 12, fable) guards `pathToFileURL(undefined)` itself throwing —
 * `process.argv[1]` is `undefined` when this module is evaluated via a
 * dynamic `import()` with no script file on the command line (e.g. a REPL),
 * a case this file's own header comment claims to support ("could be
 * imported and called in-process") but the un-guarded version would have
 * crashed at module-eval time before `main()` ever got a chance to run.
 *
 * `main()`'s result is assigned to `process.exitCode` (not passed to
 * `process.exit()`, (internal design doc) Minority 12, fable) so the process exits
 * naturally once the event loop drains — `process.exit()` terminates
 * immediately and can truncate not-yet-flushed stdout, an edge case observed
 * on Windows piped output; `process.exitCode` carries the same exit-code
 * contract with no such truncation risk.
 *
 * Plain node, no dependencies. Exits 1 with a clear message per failure.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runAllChecks } from './verify-dist-checks.mjs'

/**
 * @param {string} [rootDir] repo root; defaults to this script's parent dir
 * @param {string} [distDir] build output dir; defaults to `<rootDir>/dist`
 *   (declared after `rootDir` so its default can derive from it)
 * @returns {number} process exit code (0 = all checks passed, 1 = failure)
 */
export function main(
  rootDir = resolve(import.meta.dirname, '..'),
  distDir = resolve(rootDir, 'dist'),
) {
  const messages = runAllChecks(distDir, rootDir)

  for (const message of messages) {
    console.error(`verify:dist FAIL - ${message}`)
  }

  if (messages.length > 0) {
    console.error('verify:dist: one or more checks failed (see above)')
    return 1
  }

  console.log('verify:dist: all checks passed')
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv[2], process.argv[3])
}
