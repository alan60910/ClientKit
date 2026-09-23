/**
 * S5-T2.4 黃金重生腳本（**手動工序、禁在 CI 執行**——CI 不得自癒黃金；
 * 黃金失敗須人審 diff、勿盲目重生）。對 statusline-golden-configs.ts 的
 * 每個 GoldenCase 呼叫 emitBash，寫入 `tools/statusline-builder/__golden__/
 * <name>.sh`（UTF-8、LF、尾隨換行）。
 *
 * 執行：node scripts/golden-statusline.mjs
 * （或 npm run golden:update。禁 toMatchSnapshot／vitest --update。）
 *
 * 機制同 sp5/expected.mjs：node 24 原生 TS type-stripping＋registerHooks
 * 把 TS 源碼間的 `./x.js` 相對 import 改寫至實存的 `./x.ts`——僅限此類
 * 工序腳本、產品碼不用。
 */
import { registerHooks } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith('.') &&
      specifier.endsWith('.js') &&
      context.parentURL !== undefined &&
      context.parentURL.startsWith('file:')
    ) {
      const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
})

const { emitBash } = await import(
  new URL('../tools/statusline-builder/emit-bash.ts', import.meta.url).href
)
const { DESCRIPTORS_BY_ID } = await import(
  new URL('../tools/statusline-builder/segments.ts', import.meta.url).href
)
const { GOLDEN_CASES } = await import(new URL('./statusline-golden-configs.ts', import.meta.url).href)
const { MULTIROW_GOLDEN_CASES } = await import(
  new URL('../tools/statusline-builder/multirow-golden-configs.ts', import.meta.url).href
)

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'tools', 'statusline-builder', '__golden__')
mkdirSync(outDir, { recursive: true })

for (const { name, config } of GOLDEN_CASES) {
  const script = emitBash(config, DESCRIPTORS_BY_ID)
  const path = join(outDir, `${name}.sh`)
  writeFileSync(path, script, 'utf8')
  console.log(`WROTE  __golden__/${name}.sh (${Buffer.byteLength(script, 'utf8')} bytes)`)
}

// ── 多列代表 case（T3.3；(internal design doc) §golden
//    全量重生／Verification 1）── config 單一來源已收攏至
//    tools/statusline-builder/multirow-golden-configs.ts（MAGI code review
//    2026-07-11 Important #2／Fix 2：與 golden-statusline-ps1.mjs 共用同一
//    份 config，消弭先前兩處 inline 字面重複的漂移風險）。**不**併入
//    statusline-golden-configs.ts 的 `GOLDEN_CASES`（該檔為
//    emit-bash.test.ts 既有黃金比對＋端到端 byte-exact 測試的單一事實來源，
//    非本任務範圍，維持零耦合）。三列（row 0/1/2）、列內兩段（驗分隔符／
//    箭頭不跨列）：plain 與 powerline（含 arrow gating true）各一。
for (const { name, config } of MULTIROW_GOLDEN_CASES) {
  const script = emitBash(config, DESCRIPTORS_BY_ID)
  const path = join(outDir, `${name}.sh`)
  writeFileSync(path, script, 'utf8')
  console.log(`WROTE  __golden__/${name}.sh (${Buffer.byteLength(script, 'utf8')} bytes)`)
}

console.log(`DONE  ${GOLDEN_CASES.length + MULTIROW_GOLDEN_CASES.length} golden scripts`)
