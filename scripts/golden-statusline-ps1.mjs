/**
 * S5-T2.5 黃金重生腳本（ps1 專屬）——emitPs1(canonicalConfig) → 簽入黃金
 * `tools/statusline-builder/__golden__/*.ps1`（**含檔案 UTF-8 BOM**——契約 8）。
 *
 * 用法：node scripts/golden-statusline-ps1.mjs
 * （node 24 原生 TS type-stripping；registerHooks 把 emit-ps1.ts 內
 * `./x.js` 相對 import 改寫至實存 `./x.ts`——與 sp5/expected.mjs 同招，
 * 僅限工具腳本，產品碼不用。）
 *
 * **禁在 CI 執行**（CI 不得自癒；黃金 diff 必經人審——PLAN §時序閘）。
 * canonical config 與 emit-ps1.test.ts 內同名 config **必須逐字一致**
 * （golden 測試以 emitPs1(testConfig) toEqual 黃金檔為漂移守門：兩處
 * config 若不同步，測試即紅——見 emit-ps1.test.ts 檔頭）。
 *
 * 待與 T2.4（emit-bash）統一：T2.4 lane 尚未落盤 emit-bash.ts，本腳本
 * 為 ps1 專屬；bash 黃金重生併入時可抽共用 canonical config 模組。
 */
import { registerHooks } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── canonical config（純資料；emit-ps1.test.ts 內須逐字同步） ──

const A = (index) => ({ kind: 'ansi256', index })
/** traffic 模板（threshold.ts THRESHOLD_TEMPLATES.traffic 之值；黃金固定參照）。 */
const TRAFFIC = { buckets: [46, 82, 118, 154, 190, 226, 220, 214, 208, 196].map(A) }
/** T4.6（08-PLAN Rev 4 §3 round 2）雙模板：limit-gradient／remaining-gradient
 *（threshold.ts 之值；黃金固定參照，同 TRAFFIC 手抄慣例）。 */
const LIMIT_GRADIENT = { buckets: [244, 246, 247, 249, 250, 34, 34, 34, 220, 196].map(A) }
const REMAINING_GRADIENT = { buckets: [196, 220, 34, 34, 34, 250, 249, 247, 246, 244].map(A) }
const seg = (id, over = {}) => ({ id, enabled: true, icon: true, color: { kind: 'default' }, ...over })
const cfg = (over) => {
  const mode = over.mode ?? 'plain'
  return {
    version: 2,
    mode,
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: true,
    powerlineArrow: mode === 'powerline', // v2 新欄；emitPs1 忽略之，僅供 runtime 形狀一致
    segments: [],
    ...over,
  }
}

/** 黃金 config 集（名稱＝檔名 stem）。 */
export const CANONICAL_CONFIGS = [
  {
    name: 'plain-full',
    // plain 滿配：全 25 段啟用、icon 全開、涵蓋每個 FormatKind／null 政策；
    // 前綴 escaping 對抗案（`it's `→`''`、`$(x)`→單引號不插值）；cwd tilde；
    // rate percent-reset；context-used 掛 traffic 閾值（plain 分裂）。
    // **注意（T4.6）**：本 config 亦被 emit-ps1.test.ts 多處結構斷言重用
    // （「無倒數段」不變量、`fullBehaviorCases()` 真執行等）——刻意不塞新
    // 5 段以免打破既有假設；「全 30 段單列」golden 覆蓋見下方獨立新案
    // `full-30-plain`（不與本 config 共用、零耦合）。
    config: cfg({
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      segments: [
        seg('model', { color: A(75) }),
        seg('cwd', { variant: 'tilde', prefix: '@' }),
        seg('project-dir'),
        seg('output-style'),
        seg('version', { prefix: 'v' }),
        seg('cost', { color: A(220) }),
        seg('duration'),
        seg('lines-changed'),
        seg('context-size'),
        seg('thinking'),
        seg('context-used', { threshold: TRAFFIC, prefix: "it's " }),
        seg('context-remaining'),
        seg('rate-5h', { variant: 'percent-reset' }),
        seg('rate-7d', { variant: 'percent-reset' }),
        seg('session-name', { prefix: '$(x)' }),
        seg('effort'),
        seg('vim-mode'),
        seg('agent-name'),
        seg('pr'),
        seg('repo'),
        seg('worktree'),
        seg('worktree-branch'),
        seg('git-branch'),
        seg('git-dirty'),
        seg('clock'),
      ],
    }),
  },
  {
    name: 'full-30-plain',
    // T4.6（08-PLAN Rev 4 §5；TASKS.md T4.6）：全 30 段單列（plain）——
    // 涵蓋新 5 段（token-in／token-out／cache-hit／reset-5h／reset-7d）
    // ps1 產生路徑；獨立新案、不與 'plain-full' 共用 config（該 config
    // 被多處既有結構斷言依賴其「無倒數段」形狀，見上方註解）；與
    // scripts/statusline-golden-configs.ts 的 'full-30-plain'（bash）段序
    // equivalent，非逐字同名事實來源。
    config: cfg({
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      segments: [
        seg('model', { color: A(75) }),
        seg('cwd', { variant: 'tilde', prefix: '@' }),
        seg('project-dir'),
        seg('output-style'),
        seg('version', { prefix: 'v' }),
        seg('cost', { color: A(220) }),
        seg('duration'),
        seg('lines-changed'),
        seg('context-size'),
        seg('thinking'),
        seg('token-in', { color: A(80) }),
        seg('token-out', { color: A(81) }),
        seg('context-used', { threshold: TRAFFIC, prefix: "it's " }),
        seg('context-remaining'),
        seg('cache-hit', { color: A(214) }),
        seg('rate-5h', { variant: 'percent-reset' }),
        seg('rate-7d', { variant: 'percent-reset' }),
        seg('reset-5h', { color: A(99) }),
        seg('reset-7d', { color: A(99) }),
        seg('session-name', { prefix: '$(x)' }),
        seg('effort'),
        seg('vim-mode'),
        seg('agent-name'),
        seg('pr'),
        seg('repo'),
        seg('worktree'),
        seg('worktree-branch'),
        seg('git-branch'),
        seg('git-dirty'),
        seg('clock'),
      ],
    }),
  },
  {
    name: 'powerline-threshold',
    // powerline＋閾值＋C1：SP-5 情境 a 對應 config（中段條件隱藏＋鄰段閾值
    // bg＋cap）；powerline 箭頭交接／dash 退主色／成對 auto-fg 索引。
    config: cfg({
      mode: 'powerline',
      lastArrowCap: true,
      segments: [
        seg('model', { color: A(226) }),
        seg('session-name', { prefix: '[s]', color: A(99) }),
        seg('context-used', { threshold: TRAFFIC, color: A(240) }),
        seg('cost', { color: A(16) }),
      ],
    }),
  },
  {
    name: 'powerline-noarrow',
    // powerline＋powerlineArrow:false（MAGI code review Important #8 修復；
    // 與 scripts/statusline-golden-configs.ts 內同名 case 邏輯同構）：v2
    // 預設模式的完整黃金 byte 覆蓋——lastArrowCap:true 但 powerlineArrow:
    // false → cap 全面無效（收尾箭頭區塊恆不 emit，證 cap 值本身不影響
    // 輸出）。段組合：context-used（threshold）＝閾值桶陣列段；rate-5h
    // （無 threshold）＝dash 政策段；session-name／git-branch＝2 個
    // icon-enabled 段（pad＋emoji codepoint 跳脫＋無箭頭三者共存）。
    config: cfg({
      mode: 'powerline',
      powerlineArrow: false,
      lastArrowCap: true,
      segments: [
        seg('model', { color: A(226) }),
        seg('session-name', { prefix: '[s]', color: A(99) }),
        seg('context-used', { icon: false, threshold: TRAFFIC, color: A(240) }),
        seg('rate-5h', { icon: false, color: A(99) }),
        seg('git-branch', { color: A(46) }),
      ],
    }),
  },

  // ── T4.6（08-PLAN Rev 4 §5；TASKS.md T4.6）golden 擴案：與
  //    scripts/statusline-golden-configs.ts 內同名 bash 案結構 equivalent
  //    （non-literal，兩份 canonical 各自獨立事實來源）；golden 為「產出
  //    腳本文字」，config 結構決定輸出——本節新案不掛 scenario（ps1 側本
  //    無此欄，emit-ps1.test.ts 之真執行案另走專屬 combo 函式）。 ──

  {
    name: 'bar-templates',
    // bar 結構覆蓋（plain）：雙模板（limit-gradient／remaining-gradient）＋
    // traffic＋percent-reset 併 bar＋無閾值 bar（threshold===undefined →
    // filled／pct 退段主色，與有閾值分支為結構性不同 ps1 程式碼路徑）。
    config: cfg({
      mode: 'plain',
      segments: [
        seg('context-used', { icon: false, bar: true, threshold: LIMIT_GRADIENT, color: A(240) }),
        seg('context-remaining', { icon: false, bar: true, threshold: REMAINING_GRADIENT, color: A(45) }),
        seg('rate-5h', { icon: false, bar: true, variant: 'percent-reset', threshold: TRAFFIC, color: A(88) }),
        seg('cache-hit', { icon: false, bar: true, color: A(200) }),
      ],
    }),
  },
  {
    name: 'bar-auto-powerline-arrow',
    // bar＋auto＋倒數同列（powerline arrow=true, cap=true）：auto(model)
    // 展開色參與箭頭交接／autoFg 對比＋bar 併元素累加器＋countdown 段三者
    // 同列共存（sp4/verify.mjs 案 10 配方；T4.6 §Verification 錨點）。
    config: cfg({
      mode: 'powerline',
      lastArrowCap: true,
      segments: [
        seg('model', { color: { kind: 'auto' } }),
        seg('context-used', { icon: false, bar: true, threshold: TRAFFIC, color: A(240) }),
        seg('reset-5h', { icon: false, color: A(99) }),
      ],
    }),
  },
  {
    name: 'bar-auto-powerline-noarrow',
    // bar（無閾值）＋auto(effort)＋倒數同列（powerline powerlineArrow:
    // false／noarrow）：D1 gating 右 padding 與 auto／bar 併元素三者共存
    // （sp4/verify.mjs 案 11 配方）。
    config: cfg({
      mode: 'powerline',
      powerlineArrow: false,
      lastArrowCap: true,
      segments: [
        seg('effort', { color: { kind: 'auto' } }),
        seg('rate-7d', { icon: false, bar: true, color: A(88) }),
        seg('reset-7d', { icon: false, color: A(99) }),
      ],
    }),
  },

  // ── T1.6（(internal design doc) §D1 golden 策略）
  //    golden 擴案：與 scripts/statusline-golden-configs.ts 內同名 bash
  //    案結構 equivalent（non-literal，兩份 canonical 各自獨立事實來源，
  //    同上方 T4.6 擴案慣例）。與 emit-ps1.test.ts 內同名 config 逐字
  //    同步（golden 測試為漂移守門）。 ──

  {
    name: 'rowsep-single-override',
    // 單列＋列 0（唯一啟用位）覆寫：全域 '|'、rowSeparators[0] 覆寫為
    // preset '·'。
    config: cfg({
      mode: 'plain',
      rowSeparators: [{ kind: 'preset', value: '·' }],
      segments: [
        seg('model', { color: A(226) }),
        seg('cost', { color: A(220) }),
        seg('duration', { color: A(118) }),
      ],
    }),
  },
  {
    name: 'rowsep-custom-escape',
    // 單列覆寫值為 custom 且含須逸出字元（單引號）：驗 psSingleQuote 對
    // 覆寫值本身的逸出。
    config: cfg({
      mode: 'plain',
      rowSeparators: [{ kind: 'custom', value: "'" }],
      segments: [seg('model', { prefix: "'$(x)", color: A(226) }), seg('version', {})],
    }),
  },
]

// ── 多列代表 case（T3.3；(internal design doc) §golden
//    全量重生／Verification 1）── config 單一來源已收攏至
//    tools/statusline-builder/multirow-golden-configs.ts（MAGI code review
//    2026-07-11 Important #2／Fix 2：與 golden-statusline.mjs 共用同一份
//    config，消弭先前兩處 inline 字面重複的漂移風險；三列 row 0/1/2、
//    列內兩段，驗分隔符／箭頭不跨列，plain 與 powerline 各一）。**不**
//    要求與 emit-ps1.test.ts 內 GOLDENS 逐字同步（該常數僅追蹤 PLAIN_FULL
//    ／POWERLINE_THRESHOLD／POWERLINE_NOARROW 三個既有 canonical config，
//    見檔頭「canonical config…逐字同步」註記；multirow 兩案改由
//    emit-ps1.test.ts 另一個獨立 it.each 迴圈直接 import
//    multirow-golden-configs.ts 比對，見該檔案「多列 golden 常駐比對」節）。
//    本檔僅於 main()（見下）動態 import 併入 CANONICAL_CONFIGS 供重生
//    .ps1——**不**於檔案頂層 static import：multirow-golden-configs.ts 內部
//    以 `./config.js` 等相對 import 指向實存 `./config.ts`，須待下方
//    registerHooks() 註冊後才能解析（頂層 import 先於 registerHooks 執行
//    會直接拋 ERR_MODULE_NOT_FOUND，已實測驗證——見本次修復回報）。

// ── 主流程（只在直接執行時跑；被 import 時無副作用） ──

async function main() {
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

  const toolDir = new URL('../tools/statusline-builder/', import.meta.url)
  const { emitPs1 } = await import(new URL('emit-ps1.ts', toolDir).href)
  const { DESCRIPTORS_BY_ID } = await import(new URL('segments.ts', toolDir).href)
  const { MULTIROW_GOLDEN_CASES } = await import(new URL('multirow-golden-configs.ts', toolDir).href)

  const here = dirname(fileURLToPath(import.meta.url))
  const outDir = join(here, '..', 'tools', 'statusline-builder', '__golden__')
  mkdirSync(outDir, { recursive: true })

  const BOM = Buffer.from([0xef, 0xbb, 0xbf])
  for (const { name, config } of [...CANONICAL_CONFIGS, ...MULTIROW_GOLDEN_CASES]) {
    const script = emitPs1(config, DESCRIPTORS_BY_ID)
    const bytes = Buffer.concat([BOM, Buffer.from(script, 'utf8')])
    writeFileSync(join(outDir, `${name}.ps1`), bytes)
    console.log(`WROTE  __golden__/${name}.ps1 (${bytes.length} bytes, incl 3-byte BOM)`)
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
