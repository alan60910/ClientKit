/**
 * (internal design doc) (T1.1–T1.4): unit tests for the pure check
 * functions extracted from `scripts/verify-dist.mjs` into
 * `scripts/verify-dist-checks.mjs`, plus regex-hardening (T1.3) guardrail
 * cases and a single CLI-shell smoke test (D3-b: at most one end-to-end
 * case, not the primary test strategy — the per-check unit tests above it
 * are).
 *
 * T1.1 PoC criterion 1 evidence: importing `verify-dist-checks.mjs` (below)
 * has zero side effects — it never scans the real `dist/` nor calls
 * `process.exit` at module-eval time. If it did, this whole file (and every
 * other vitest file after it) would never finish loading. The CLI shell
 * (`scripts/verify-dist.mjs`) is deliberately *not* imported here: it keeps
 * its pre-refactor Unix shebang (`#!/usr/bin/env node`), and Vite/Vitest's
 * esbuild-based transform throws a `SyntaxError` trying to parse a shebang
 * line on import (confirmed while building this suite — plain Node and a
 * direct `esbuild` CLI invocation both handle it fine; only Vite/Vitest's
 * transform pipeline chokes). The CLI-shell smoke test below instead spawns
 * `node scripts/verify-dist.mjs` as a real child process — which is also
 * the one "shell out to the whole script" case
 * (internal design doc)'s D3-b option explicitly allows
 * (at most one, not the primary strategy — the per-check unit tests above
 * it are).
 *
 * Cross-platform assertion rule ((internal design doc) PLAN.md W3): failure messages embed
 * OS-native relative paths (`filePath.slice(distDir.length + 1)` yields
 * backslashes on Windows) and `readdirSync`'s enumeration order is not
 * guaranteed. Every assertion below therefore uses containment
 * (`messages.some(...)`) or set/length checks — never an exact multi-message
 * sequence/array comparison.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkDanglingAnchors,
  checkEntryAnchors,
  checkEntryInlineScripts,
  checkFfmpegVendorAssets,
  checkNerdFontRegression,
  checkNoUnderscoreToolDirs,
  checkPackageJsonFontDeps,
  checkRoomLayoutPlannerBudget,
  checkStatuslineCssChunk,
  checkToolPageSkeleton,
  collectEntryAssetRefs,
  ENTRY_ALLOWED_INLINE_SCRIPTS,
  ENTRY_ANCHOR_SLUGS,
  extractInlineScripts,
  MIN_WASM_BYTES,
  normalizeScriptBody,
  readDistFile,
  ROOM_LAYOUT_PLANNER_BUDGET_BYTES,
  ROOM_LAYOUT_PLANNER_SLUG,
  runAllChecks,
} from './verify-dist-checks.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let tmpDirs: string[] = []

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tmpDirs = []
  vi.restoreAllMocks()
})

function writeFile(baseDir: string, relativePath: string, content: string): void {
  const target = join(baseDir, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

// Random bytes are (near-)incompressible, so gzip output is ~= `size`: that is
// what makes a "just over budget" asset fixture cheap and stable to build,
// without writing a multi-MB file or depending on a particular compressor
// ratio. Deliberately NOT the sparse-file trick below — a hole-backed file
// gzips down to nothing, which is the opposite of what these fixtures need.
function writeIncompressibleFile(baseDir: string, relativePath: string, size: number): void {
  const target = join(baseDir, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, randomBytes(size))
}

// Sparse-file trick (writeFileSync('') + truncateSync(size)) so a
// >MIN_WASM_BYTES fixture doesn't actually allocate/write tens of MB per
// test run — NTFS/most filesystems back a truncated-up empty file with holes.
function writeSparseFile(baseDir: string, relativePath: string, size: number): void {
  const target = join(baseDir, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, '')
  truncateSync(target, size)
}

const VALID_TOOL_HTML =
  '<!doctype html><html lang="zh-Hant"><head><meta name="description" content="d"></head><body><main>ok</main></body></html>'

/** Builds a `dist/` tree under `dir` that passes every check in one shot. */
function buildMinimalPassingDist(dir: string): void {
  for (const slug of ENTRY_ANCHOR_SLUGS) {
    writeFile(dir, `tools/${slug}/index.html`, VALID_TOOL_HTML)
  }
  const anchors = ENTRY_ANCHOR_SLUGS.map((slug) => `<a href="./tools/${slug}/">${slug}</a>`).join('\n')
  const rootHtml = `<!doctype html>
<html lang="zh-Hant">
<head></head>
<body>
<script>${ENTRY_ALLOWED_INLINE_SCRIPTS[0]}</script>
<main>${anchors}</main>
</body>
</html>`
  writeFile(dir, 'index.html', rootHtml)
  writeFile(dir, 'vendor/ffmpeg/ffmpeg-core.js', '// stub')
  writeSparseFile(dir, 'vendor/ffmpeg/ffmpeg-core.wasm', MIN_WASM_BYTES + 1024)
  writeFile(dir, 'assets/tool-statusline-builder-abc123.css', '.x{color:red}')
}

// --- checkToolPageSkeleton ---------------------------------------------------

describe('checkToolPageSkeleton', () => {
  it('fails once when dist/tools/ does not exist at all', () => {
    const distDir = makeTmpDir('vd-skel-notools-')
    const messages = checkToolPageSkeleton(distDir)
    expect(messages).toEqual(['missing dist/tools/ (did you run "npm run build" first?)'])
  })

  it('flags a tool page missing <main>', () => {
    const distDir = makeTmpDir('vd-skel-nomain-')
    writeFile(
      distDir,
      'tools/foo/index.html',
      '<!doctype html><html lang="zh-Hant"><head><meta name="description" content="d"></head><body><div>no main here</div></body></html>',
    )
    const messages = checkToolPageSkeleton(distDir)
    expect(messages.some((m) => m.includes('tools/foo/index.html has no <main> element'))).toBe(true)
  })

  it('flags a tool page missing <meta name="description">', () => {
    const distDir = makeTmpDir('vd-skel-nodesc-')
    writeFile(distDir, 'tools/foo/index.html', '<!doctype html><html lang="zh-Hant"><body><main>ok</main></body></html>')
    const messages = checkToolPageSkeleton(distDir)
    expect(messages.some((m) => m.includes('tools/foo/index.html has no <meta name="description">'))).toBe(true)
  })

  it('flags a tool page missing lang="zh-Hant"', () => {
    const distDir = makeTmpDir('vd-skel-nolang-')
    writeFile(
      distDir,
      'tools/foo/index.html',
      '<!doctype html><html><head><meta name="description" content="d"></head><body><main>ok</main></body></html>',
    )
    const messages = checkToolPageSkeleton(distDir)
    expect(messages.some((m) => m.includes('tools/foo/index.html is missing lang="zh-Hant"'))).toBe(true)
  })

  it('passes a fully-formed tool page with no failures', () => {
    const distDir = makeTmpDir('vd-skel-ok-')
    writeFile(distDir, 'tools/foo/index.html', VALID_TOOL_HTML)
    expect(checkToolPageSkeleton(distDir)).toEqual([])
  })
})

// --- checkNoUnderscoreToolDirs (sprint 12 T3.2) ------------------------------

describe('checkNoUnderscoreToolDirs', () => {
  it('returns [] when dist/tools/ does not exist at all', () => {
    const distDir = makeTmpDir('vd-underscore-notools-')
    expect(checkNoUnderscoreToolDirs(distDir)).toEqual([])
  })

  it('flags an underscore-prefixed tool directory (e.g. a leaked _probe/)', () => {
    const distDir = makeTmpDir('vd-underscore-leak-')
    writeFile(distDir, 'tools/_x/index.html', VALID_TOOL_HTML)
    const messages = checkNoUnderscoreToolDirs(distDir)
    expect(messages.some((m) => m.includes('dist/tools/_x/') && m.includes('must never ship'))).toBe(true)
  })

  it('passes when dist/tools/ only has ordinary (non-underscore) slugs', () => {
    const distDir = makeTmpDir('vd-underscore-ok-')
    writeFile(distDir, 'tools/apng-to-gif/index.html', VALID_TOOL_HTML)
    expect(checkNoUnderscoreToolDirs(distDir)).toEqual([])
  })

  // Sprint 12 review pin (工作項 6): an underscore-prefixed *file* (not a
  // directory) directly under dist/tools/ must NOT be flagged — this pins
  // down the `entry.isDirectory()` guard in the implementation above, which
  // only checks directory entries and deliberately ignores stray files.
  it('does NOT flag an underscore-prefixed *file* (not a directory) directly under dist/tools/', () => {
    const distDir = makeTmpDir('vd-underscore-file-')
    writeFile(distDir, 'tools/_x', 'not a directory')
    expect(checkNoUnderscoreToolDirs(distDir)).toEqual([])
  })
})

// --- checkEntryInlineScripts / extractInlineScripts (T1.3 regex hardening) --

describe('checkEntryInlineScripts / extractInlineScripts', () => {
  it('passes the exact whitelisted script body', () => {
    const html = `<html><body><script>${ENTRY_ALLOWED_INLINE_SCRIPTS[0]}</script></body></html>`
    expect(checkEntryInlineScripts(html)).toEqual([])
  })

  it('flags a non-whitelisted inline script', () => {
    const html = '<html><body><script>alert(1)</script></body></html>'
    const messages = checkEntryInlineScripts(html)
    expect(messages.some((m) => m.includes('not on the ENTRY_ALLOWED_INLINE_SCRIPTS whitelist'))).toBe(true)
  })

  it('flags an attributed <script> tag (e.g. src=)', () => {
    const html = '<html><head><script src="/evil.js"></script></head></html>'
    const messages = checkEntryInlineScripts(html)
    expect(messages.some((m) => m.includes('tag with attributes'))).toBe(true)
  })

  it('still catches an uppercase <SCRIPT> tag (case-insensitive collateral tightening)', () => {
    const html = '<HTML><BODY><SCRIPT>alert(1)</SCRIPT></BODY></HTML>'
    const messages = checkEntryInlineScripts(html)
    expect(messages.some((m) => m.includes('not on the ENTRY_ALLOWED_INLINE_SCRIPTS whitelist'))).toBe(true)
  })

  it('does NOT flag a <script> that lives inside an HTML comment (deliberate Non-Goal-ii exemption)', () => {
    // (internal design doc) PLAN.md Non-Goal (ii): a <script> inside a comment never
    // executes in a browser, so it is intentionally not policed. This is a
    // behavior *change* vs. the pre-refactor script (which had no
    // comment-awareness and would have flagged this) — explicitly approved,
    // not a bug.
    const html = '<html><body><!-- <script>alert(1)</script> --></body></html>'
    expect(checkEntryInlineScripts(html)).toEqual([])
  })

  it('extractInlineScripts finds nothing when every <script> is commented out', () => {
    const html = '<html><body><!-- <script>alert(1)</script> --></body></html>'
    expect(extractInlineScripts(html)).toEqual([])
  })

  it('guardrail: a script body containing a literal "</script>" truncates early and still fails as non-whitelisted', () => {
    // Known regex-based-HTML-parsing limitation (documented at
    // SCRIPT_TAG_PATTERN's definition in verify-dist-checks.mjs): the
    // non-greedy match stops at the *first* literal "</script" it finds,
    // regardless of quoting context — this mirrors how a real browser's
    // HTML tokenizer treats <script> content as raw text (it too ends at
    // the first literal "</script" substring), so it is not a divergence
    // from real parsing, just a sharp edge worth pinning down. The upshot:
    // this body is never whitelist-matchable (it gets truncated before the
    // whitelist's real content), so the check correctly still turns red.
    const html = '<html><body><script>var s = "</script>"; more();</script></body></html>'
    const messages = checkEntryInlineScripts(html)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every((m) => m.includes('not on the ENTRY_ALLOWED_INLINE_SCRIPTS whitelist'))).toBe(true)
  })

  it('guardrail: "nested" HTML comment markers collapse to the first closing "-->", swallowing both apparent comments', () => {
    // HTML comments don't nest — a real browser also stops at the first
    // literal "-->", not at some balanced/nested close. HTML_COMMENT_PATTERN
    // mirrors that (non-greedy, first match wins), so a naive reader
    // expecting the inner "<!--" to need its own "-->" would be surprised:
    // both ALPHA and BETA below are swallowed by the single stripped region
    // ending at the *first* "-->", and only GAMMA (genuinely outside any
    // comment) is left to be scanned — and it fails since it's unlisted.
    const html =
      '<html><body><!-- <script>ALPHA()</script> <!-- <script>BETA()</script> --> <script>GAMMA()</script></body></html>'
    const messages = checkEntryInlineScripts(html)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('not on the ENTRY_ALLOWED_INLINE_SCRIPTS whitelist')
  })

  it('guardrail ((internal design doc) Minority item 1, fable): a literal "<!--" inside a real <script>\'s own body — whose matching "-->" lands past that script\'s closing tag — must fail red, not slip through as a swallowed-then-reassembled residual', () => {
    // Constructed exactly per (internal design doc)'s repro: script1's raw body
    // is `W1<!--`, followed by a second, genuinely-executing <script>evil()
    // </script>, then the "-->" that (mis)closes script1's stray comment
    // marker, then trailing "W2". Once extractInlineScripts strips comments
    // *before* matching script tags, the whole `<!--</script><script>evil()
    // </script>-->` span collapses away, reassembling into a single
    // innocuous-looking `<script>W1W2</script>` — evil() never appears in
    // the post-strip extraction at all. The new raw-scan guardrail catches
    // this at the source: script1's *own*, un-stripped body containing "<!--"
    // is exactly the signature of a boundary-crossing strip, so it must fail
    // regardless of what the (compromised) stripped extraction later sees.
    const html = '<script>W1<!--</script><script>evil()</script>-->W2</script>'
    const messages = checkEntryInlineScripts(html)
    expect(messages.some((m) => m.includes('contains "<!--"'))).toBe(true)
  })
})

// --- checkEntryAnchors --------------------------------------------------------

describe('checkEntryAnchors', () => {
  it('returns [] for null rootHtml (dist/index.html missing — handled upstream)', () => {
    expect(checkEntryAnchors(null)).toEqual([])
  })

  it('flags a missing ENTRY_ANCHOR_SLUGS link', () => {
    const missingSlug = ENTRY_ANCHOR_SLUGS[1]
    const anchors = ENTRY_ANCHOR_SLUGS.filter((slug) => slug !== missingSlug)
      .map((slug) => `<a href="./tools/${slug}/">${slug}</a>`)
      .join('')
    const html = `<html><body><main>${anchors}</main></body></html>`
    const messages = checkEntryAnchors(html)
    expect(messages.some((m) => m.includes(`<a href="./tools/${missingSlug}/">`))).toBe(true)
  })

  it('passes when every ENTRY_ANCHOR_SLUGS link is present', () => {
    const anchors = ENTRY_ANCHOR_SLUGS.map((slug) => `<a href="./tools/${slug}/">${slug}</a>`).join('')
    expect(checkEntryAnchors(`<html><body><main>${anchors}</main></body></html>`)).toEqual([])
  })
})

// --- checkDanglingAnchors -----------------------------------------------------

describe('checkDanglingAnchors', () => {
  it('returns [] for null rootHtml', () => {
    expect(checkDanglingAnchors(null, makeTmpDir('vd-dangling-null-'))).toEqual([])
  })

  it('flags an anchor pointing at a slug that was never built', () => {
    const distDir = makeTmpDir('vd-dangling-')
    const html = '<html><body><a href="./tools/nonexistent-slug/">gone</a></body></html>'
    const messages = checkDanglingAnchors(html, distDir)
    expect(messages.some((m) => m.includes('nonexistent-slug') && m.includes('does not exist'))).toBe(true)
  })

  it('passes when every linked slug was actually built', () => {
    const distDir = makeTmpDir('vd-dangling-ok-')
    writeFile(distDir, 'tools/real-slug/index.html', VALID_TOOL_HTML)
    const html = '<html><body><a href="./tools/real-slug/">here</a></body></html>'
    expect(checkDanglingAnchors(html, distDir)).toEqual([])
  })
})

// --- checkFfmpegVendorAssets ---------------------------------------------------

describe('checkFfmpegVendorAssets', () => {
  it('flags a missing ffmpeg-core.js', () => {
    const distDir = makeTmpDir('vd-ffmpeg-nojs-')
    writeSparseFile(distDir, 'vendor/ffmpeg/ffmpeg-core.wasm', MIN_WASM_BYTES + 1024)
    const messages = checkFfmpegVendorAssets(distDir)
    expect(messages.some((m) => m.includes('ffmpeg-core.js'))).toBe(true)
  })

  it('flags a missing ffmpeg-core.wasm', () => {
    const distDir = makeTmpDir('vd-ffmpeg-nowasm-')
    writeFile(distDir, 'vendor/ffmpeg/ffmpeg-core.js', '// stub')
    const messages = checkFfmpegVendorAssets(distDir)
    expect(messages.some((m) => m.includes('missing dist/vendor/ffmpeg/ffmpeg-core.wasm'))).toBe(true)
  })

  it('flags a truncated (too-small) ffmpeg-core.wasm', () => {
    const distDir = makeTmpDir('vd-ffmpeg-smallwasm-')
    writeFile(distDir, 'vendor/ffmpeg/ffmpeg-core.js', '// stub')
    writeFile(distDir, 'vendor/ffmpeg/ffmpeg-core.wasm', 'tiny')
    const messages = checkFfmpegVendorAssets(distDir)
    expect(messages.some((m) => m.includes('truncated or wrong file?'))).toBe(true)
  })

  it('passes when both assets exist and the wasm is large enough', () => {
    const distDir = makeTmpDir('vd-ffmpeg-ok-')
    writeFile(distDir, 'vendor/ffmpeg/ffmpeg-core.js', '// stub')
    writeSparseFile(distDir, 'vendor/ffmpeg/ffmpeg-core.wasm', MIN_WASM_BYTES + 1024)
    expect(checkFfmpegVendorAssets(distDir)).toEqual([])
  })
})

// --- checkStatuslineCssChunk --------------------------------------------------

describe('checkStatuslineCssChunk', () => {
  it('flags a missing dist/assets/ entirely', () => {
    const distDir = makeTmpDir('vd-css-noassets-')
    const messages = checkStatuslineCssChunk(distDir)
    expect(messages).toEqual(['missing dist/assets/ (did you run "npm run build" first?)'])
  })

  it('flags dist/assets/ with no matching statusline-builder CSS chunk', () => {
    const distDir = makeTmpDir('vd-css-nomatch-')
    writeFile(distDir, 'assets/unrelated-abc.css', '.y{}')
    const messages = checkStatuslineCssChunk(distDir)
    expect(messages.some((m) => m.includes('statusline-builder CSS chunk missing'))).toBe(true)
  })

  it('passes when a matching chunk exists', () => {
    const distDir = makeTmpDir('vd-css-ok-')
    writeFile(distDir, 'assets/tool-statusline-builder-XYZ.css', '.z{}')
    expect(checkStatuslineCssChunk(distDir)).toEqual([])
  })
})

// --- collectEntryAssetRefs / checkRoomLayoutPlannerBudget (sprint 16 T4.4) ---

const ROOM_ENTRY_RELATIVE_PATH = `tools/${ROOM_LAYOUT_PLANNER_SLUG}/index.html`

/** Writes a built-looking room-layout-planner entry page carrying `headMarkup`. */
function writeRoomEntry(distDir: string, headMarkup: string): void {
  writeFile(
    distDir,
    ROOM_ENTRY_RELATIVE_PATH,
    `<!doctype html><html lang="zh-Hant"><head><meta name="description" content="d">${headMarkup}</head><body><main>ok</main></body></html>`,
  )
}

describe('collectEntryAssetRefs', () => {
  it('splits script src / modulepreload into JS and rel=stylesheet into CSS, ignoring other links', () => {
    const html = `<html><head>
<link rel="icon" href="../../favicon.svg">
<link rel="stylesheet" crossorigin href="../../assets/tool-room-layout-planner-aaa.css">
<link rel="modulepreload" crossorigin href="../../assets/shared-bbb.js">
</head><body>
<script type="module" crossorigin src="../../assets/tool-room-layout-planner-ccc.js"></script>
<script>var inline = 1</script>
</body></html>`

    expect(collectEntryAssetRefs(html)).toEqual({
      js: ['../../assets/tool-room-layout-planner-ccc.js', '../../assets/shared-bbb.js'],
      css: ['../../assets/tool-room-layout-planner-aaa.css'],
    })
  })

  it('weighs a chunk that is both modulepreloaded and script-src-ed exactly once', () => {
    const html = `<link rel="modulepreload" href="../../assets/x.js"><script src="../../assets/x.js"></script>`
    expect(collectEntryAssetRefs(html)).toEqual({ js: ['../../assets/x.js'], css: [] })
  })
})

describe('checkRoomLayoutPlannerBudget', () => {
  it('reports the standard missing-file message when the entry page was never built', () => {
    const distDir = makeTmpDir('vd-rlp-missing-')
    expect(checkRoomLayoutPlannerBudget(distDir)).toEqual([
      `missing dist/${ROOM_ENTRY_RELATIVE_PATH} (did you run "npm run build" first?)`,
    ])
  })

  it('passes when both referenced assets are comfortably inside their budgets', () => {
    const distDir = makeTmpDir('vd-rlp-ok-')
    writeRoomEntry(
      distDir,
      '<link rel="stylesheet" href="../../assets/rlp.css"><script type="module" src="../../assets/rlp.js"></script>',
    )
    writeIncompressibleFile(distDir, 'assets/rlp.js', 4_000)
    writeIncompressibleFile(distDir, 'assets/rlp.css', 1_000)

    expect(checkRoomLayoutPlannerBudget(distDir)).toEqual([])
  })

  it('flags the JS bucket when the entry chunk plus its shared chunk exceed 45 KB, listing every asset and its gzip size', () => {
    // Neither chunk breaks the budget on its own — the point of the bucket is
    // that a shared chunk reached from the entry HTML counts too (PLAN: "JS
    // 自家＋共享 chunk ≤45 KB").
    const distDir = makeTmpDir('vd-rlp-js-over-')
    writeRoomEntry(
      distDir,
      '<link rel="modulepreload" href="../../assets/shared.js"><script type="module" src="../../assets/rlp.js"></script>',
    )
    writeIncompressibleFile(distDir, 'assets/rlp.js', 30_000)
    writeIncompressibleFile(distDir, 'assets/shared.js', 30_000)

    const messages = checkRoomLayoutPlannerBudget(distDir)
    expect(messages).toHaveLength(1)
    const message = messages[0]
    expect(message).toContain('JS gzip total is')
    expect(message).toContain(`over the ${ROOM_LAYOUT_PLANNER_BUDGET_BYTES.js}-byte budget`)
    expect(message).toContain('assets/rlp.js')
    expect(message).toContain('assets/shared.js')
    // Every listed asset carries its own gzip size, and the message says out
    // loud that gzip only stands in for the brotli GitHub Pages actually serves.
    expect(/assets[/\\]rlp\.js \d+ bytes/.test(message)).toBe(true)
    expect(/assets[/\\]shared\.js \d+ bytes/.test(message)).toBe(true)
    expect(message).toContain('gzip（level 9）為 brotli 的代理指標')
  })

  it('flags the CSS bucket on its own (JS stays green)', () => {
    const distDir = makeTmpDir('vd-rlp-css-over-')
    writeRoomEntry(
      distDir,
      '<link rel="stylesheet" href="../../assets/rlp.css"><script type="module" src="../../assets/rlp.js"></script>',
    )
    writeIncompressibleFile(distDir, 'assets/rlp.js', 1_000)
    writeIncompressibleFile(distDir, 'assets/rlp.css', ROOM_LAYOUT_PLANNER_BUDGET_BYTES.css + 2_000)

    const messages = checkRoomLayoutPlannerBudget(distDir)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('CSS gzip total is')
    expect(messages[0]).toContain('gzip（level 9）為 brotli 的代理指標')
  })

  it('flags the HTML bucket when the entry page itself is too big', () => {
    const distDir = makeTmpDir('vd-rlp-html-over-')
    // Hex of random bytes: text-safe inside HTML, and gzip only halves it, so
    // 20 KB of entropy lands ~20 KB gzipped — well past the 12 KB budget.
    writeRoomEntry(distDir, `<!-- ${randomBytes(20_000).toString('hex')} -->`)

    const messages = checkRoomLayoutPlannerBudget(distDir)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('HTML gzip total is')
    expect(messages[0]).toContain(`over the ${ROOM_LAYOUT_PLANNER_BUDGET_BYTES.html}-byte budget`)
    expect(messages[0]).toContain('gzip（level 9）為 brotli 的代理指標')
  })

  it('flags a dangling asset reference instead of silently weighing nothing', () => {
    const distDir = makeTmpDir('vd-rlp-dangling-')
    writeRoomEntry(distDir, '<script type="module" src="../../assets/gone.js"></script>')

    const messages = checkRoomLayoutPlannerBudget(distDir)
    expect(messages.some((m) => m.includes('assets/gone.js') && m.includes('does not exist'))).toBe(true)
  })

  it('ignores externally hosted references (nothing local to weigh)', () => {
    const distDir = makeTmpDir('vd-rlp-external-')
    writeRoomEntry(distDir, '<script src="https://cdn.example.com/x.js"></script>')
    expect(checkRoomLayoutPlannerBudget(distDir)).toEqual([])
  })
})

// --- checkNerdFontRegression --------------------------------------------------

describe('checkNerdFontRegression', () => {
  it('flags the standalone word "nerd" in a built .css file', () => {
    const distDir = makeTmpDir('vd-nerd-')
    writeFile(distDir, 'assets/some.css', '/* nerd font subset */')
    const messages = checkNerdFontRegression(distDir)
    expect(messages.some((m) => m.includes('mentions the word "nerd"'))).toBe(true)
  })

  it('flags the standalone word "woff2" in a built .js file', () => {
    const distDir = makeTmpDir('vd-woff2-')
    writeFile(distDir, 'assets/some.js', 'var f = "font.woff2";')
    const messages = checkNerdFontRegression(distDir)
    expect(messages.some((m) => m.includes('mentions the word "woff2"'))).toBe(true)
  })

  it('does NOT false-positive on camelCase identifiers containing "nerd" mid-word (\\b boundary)', () => {
    const distDir = makeTmpDir('vd-nerd-camel-')
    writeFile(distDir, 'assets/some.js', 'el.ownerDocument.body.appendChild(el);')
    expect(checkNerdFontRegression(distDir)).toEqual([])
  })

  it('does not scan binary assets (e.g. .wasm) even if they happen to contain "nerd" bytes', () => {
    const distDir = makeTmpDir('vd-nerd-wasm-')
    writeFile(distDir, 'vendor/ffmpeg/ffmpeg-core.wasm', 'nerd')
    expect(checkNerdFontRegression(distDir)).toEqual([])
  })
})

// --- checkPackageJsonFontDeps -------------------------------------------------

describe('checkPackageJsonFontDeps', () => {
  it('flags "subset-font" in package.json', () => {
    const rootDir = makeTmpDir('vd-pkg-subsetfont-')
    writeFile(rootDir, 'package.json', JSON.stringify({ devDependencies: { 'subset-font': '1.0.0' } }))
    const messages = checkPackageJsonFontDeps(rootDir)
    expect(messages.some((m) => m.includes('"subset-font"'))).toBe(true)
  })

  it('flags "fontkit" in package.json', () => {
    const rootDir = makeTmpDir('vd-pkg-fontkit-')
    writeFile(rootDir, 'package.json', JSON.stringify({ devDependencies: { fontkit: '1.0.0' } }))
    const messages = checkPackageJsonFontDeps(rootDir)
    expect(messages.some((m) => m.includes('"fontkit"'))).toBe(true)
  })

  it('passes a clean package.json', () => {
    const rootDir = makeTmpDir('vd-pkg-clean-')
    writeFile(rootDir, 'package.json', JSON.stringify({ devDependencies: {} }))
    expect(checkPackageJsonFontDeps(rootDir)).toEqual([])
  })
})

// --- readDistFile --------------------------------------------------------------

describe('readDistFile', () => {
  it('reports the "did you run npm run build first" message verbatim for a missing file', () => {
    const distDir = makeTmpDir('vd-readdist-missing-')
    const { content, missingMessage } = readDistFile(distDir, 'index.html')
    expect(content).toBeNull()
    expect(missingMessage).toBe('missing dist/index.html (did you run "npm run build" first?)')
  })

  it('returns file content when present', () => {
    const distDir = makeTmpDir('vd-readdist-present-')
    writeFile(distDir, 'index.html', '<html></html>')
    const { content, missingMessage } = readDistFile(distDir, 'index.html')
    expect(missingMessage).toBeNull()
    expect(content).toBe('<html></html>')
  })
})

// --- runAllChecks: positive minimal-dist integration case (T1.4) -------------

describe('runAllChecks — positive minimal dist fixture', () => {
  it('passes with zero failure messages against a fully-formed synthetic dist/', () => {
    const rootDir = makeTmpDir('vd-full-pass-')
    const distDir = join(rootDir, 'dist')
    buildMinimalPassingDist(distDir)
    writeFile(rootDir, 'package.json', JSON.stringify({ name: 'fixture' }))
    expect(runAllChecks(distDir, rootDir)).toEqual([])
  })
})

// --- Whitelist-drift guard: repo-root index.html vs ENTRY_ALLOWED_INLINE_SCRIPTS

describe('repo-root index.html inline scripts vs ENTRY_ALLOWED_INLINE_SCRIPTS (T1.4 whitelist-drift catch)', () => {
  it('every inline <script> body in the real repo-root index.html is on the whitelist', () => {
    // Reads the *source* index.html (Vite's entry point, not a built dist/),
    // so this catches ENTRY_ALLOWED_INLINE_SCRIPTS drift at unit-test time —
    // no `npm run build` required first.
    const rootHtmlPath = resolve(repoRoot, 'index.html')
    const html = readFileSync(rootHtmlPath, 'utf-8')
    const scripts = extractInlineScripts(html)
    // Non-vacuous guard: the entry page is known to carry exactly one inline
    // script (the theme-bootstrap snippet) — if extraction ever finds zero,
    // that's itself a signal something's wrong (e.g. the regex broke), not a
    // silent pass.
    expect(scripts.length).toBeGreaterThan(0)
    for (const { attrs, body } of scripts) {
      expect(attrs.trim()).toBe('')
      const normalizedBody = normalizeScriptBody(body)
      const isAllowed = ENTRY_ALLOWED_INLINE_SCRIPTS.some((allowed) => normalizeScriptBody(allowed) === normalizedBody)
      expect(isAllowed).toBe(true)
    }
  })
})

// --- CLI shell smoke test (D3-b: at most one end-to-end case) ----------------
// `verify-dist.mjs` isn't imported (see file-header comment above for why);
// instead these two cases spawn it as a real child process, pointed at a
// synthetic rootDir/distDir via its two optional positional CLI args.

const verifyDistScriptPath = resolve(repoRoot, 'scripts', 'verify-dist.mjs')

function runVerifyDistCli(rootDir: string, distDir: string) {
  return spawnSync(process.execPath, [verifyDistScriptPath, rootDir, distDir], { encoding: 'utf-8' })
}

describe('verify-dist.mjs — CLI shell smoke test (spawned child process)', () => {
  it('exits 0 and prints the success line for a fully-valid synthetic dist/rootDir', () => {
    const rootDir = makeTmpDir('vd-main-pass-')
    const distDir = join(rootDir, 'dist')
    buildMinimalPassingDist(distDir)
    writeFile(rootDir, 'package.json', JSON.stringify({ name: 'fixture' }))

    const result = runVerifyDistCli(rootDir, distDir)

    expect(result.status).toBe(0)
    expect(result.stderr.trim()).toBe('')
    expect(result.stdout.trim()).toBe('verify:dist: all checks passed')
  })

  it('exits 1 and prefixes every failure line with "verify:dist FAIL - " for an empty dist/', () => {
    const rootDir = makeTmpDir('vd-main-fail-')
    const distDir = join(rootDir, 'dist') // deliberately never populated
    writeFile(rootDir, 'package.json', JSON.stringify({ name: 'fixture' }))

    const result = runVerifyDistCli(rootDir, distDir)

    expect(result.status).toBe(1)
    expect(result.stdout.trim()).toBe('')
    const errorLines = result.stderr.trim().split(/\r?\n/)
    expect(errorLines.length).toBeGreaterThan(1)
    for (const line of errorLines.slice(0, -1)) {
      expect(line.startsWith('verify:dist FAIL - ')).toBe(true)
    }
    expect(errorLines.at(-1)).toBe('verify:dist: one or more checks failed (see above)')
  })
})
