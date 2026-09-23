#!/usr/bin/env node
/**
 * predev/prebuild hook (see package.json's `predev`/`prebuild` scripts).
 *
 * Copies the self-hosted ffmpeg.wasm core assets out of
 * `node_modules/@ffmpeg/core/dist/esm/` into `public/vendor/ffmpeg/` so Vite
 * can serve them same-origin (no CDN fallback — see SPEC.md Conventions).
 * `public/vendor/` is .gitignore'd; this script is what regenerates it.
 *
 * Guards:
 *  - asserts the installed `@ffmpeg/core` version matches the pin below
 *    before copying anything, so the vendored assets can never silently
 *    drift from the version the rest of the app was built/tested against.
 *  - idempotent: skips the (slow, ~32MB) copy if a `.version` marker already
 *    matches the pinned version and both target files exist.
 *
 * Plain node, no dependencies (mirrors verify-dist.mjs style).
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const PINNED_CORE_VERSION = '0.12.10'

const coreDir = resolve(import.meta.dirname, '..', 'node_modules', '@ffmpeg', 'core')
const coreEsmDir = resolve(coreDir, 'dist', 'esm')
const vendorDir = resolve(import.meta.dirname, '..', 'public', 'vendor', 'ffmpeg')
const versionMarkerPath = resolve(vendorDir, '.version')

const ASSETS = ['ffmpeg-core.js', 'ffmpeg-core.wasm']

function fail(message) {
  console.error(`vendor-ffmpeg FAIL - ${message}`)
  process.exit(1)
}

const corePackageJsonPath = resolve(coreDir, 'package.json')
if (!existsSync(corePackageJsonPath)) {
  fail(`missing ${corePackageJsonPath} (did you run "npm install" first?)`)
}

const corePackageJson = JSON.parse(readFileSync(corePackageJsonPath, 'utf-8'))
if (corePackageJson.version !== PINNED_CORE_VERSION) {
  fail(
    `installed @ffmpeg/core version "${corePackageJson.version}" does not match ` +
      `pinned version "${PINNED_CORE_VERSION}" (scripts/vendor-ffmpeg.mjs). ` +
      'Update the pin here and in package.json together, or reinstall the pinned version.',
  )
}

const targetsExist = ASSETS.every((name) => existsSync(resolve(vendorDir, name)))
const markerVersion = existsSync(versionMarkerPath) ? readFileSync(versionMarkerPath, 'utf-8').trim() : null

if (targetsExist && markerVersion === PINNED_CORE_VERSION) {
  console.log(`vendor-ffmpeg: public/vendor/ffmpeg/ already at core ${PINNED_CORE_VERSION}, skipping copy`)
  process.exit(0)
}

mkdirSync(vendorDir, { recursive: true })

for (const name of ASSETS) {
  const src = resolve(coreEsmDir, name)
  if (!existsSync(src)) {
    fail(`missing ${src} — @ffmpeg/core layout may have changed`)
  }
  copyFileSync(src, resolve(vendorDir, name))
}

writeFileSync(versionMarkerPath, PINNED_CORE_VERSION)

const sizes = ASSETS.map((name) => `${name} (${statSync(resolve(vendorDir, name)).size} bytes)`).join(', ')
console.log(`vendor-ffmpeg: copied core ${PINNED_CORE_VERSION} assets to public/vendor/ffmpeg/ — ${sizes}`)
