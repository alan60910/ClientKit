/**
 * S5-T2.4 canonical 黃金 config 集——**單一事實來源**，同時供：
 *   - 黃金重生腳本 `scripts/golden-statusline.mjs`（emit → __golden__/*.sh）
 *   - `emit-bash.test.ts` 的黃金比對＋端到端 byte-exact 測試
 * 兩處 import 同一份，零漂移（threshold 直接引真模板、scenario 由真
 * mock-data 派生——不 inline、不重打）。
 *
 * `scenario` 存在＝該 case 可端到端 byte-exact（純 jq、無 shell-out）：
 * `emitBash(config)` 產出的腳本真跑（bash＋jq）→ stdout 須與
 * `toAnsi(resolve(config, scenario))` byte-exact。缺 `scenario`＝
 * golden-only（含 shell-out，真 git/date 非決定論、只作腳本文字人審）。
 *
 * 此檔為 .ts：vite（vitest）直接載入；node 重生腳本以 registerHooks
 * shim 載入（見 golden-statusline.mjs）。
 */
import type { BuilderConfig, SegmentConfig } from '../tools/statusline-builder/config.js'
import type { ColorSpec } from '../tools/statusline-builder/color.js'
import { MOCK_SCENARIOS_BY_ID } from '../tools/statusline-builder/mock-data.js'
import type { MockShellChannel } from '../tools/statusline-builder/mock-data.js'
import type { StatusData } from '../tools/statusline-builder/segments.js'
import { THRESHOLD_TEMPLATES } from '../tools/statusline-builder/threshold.js'

export interface ByteExactScenario {
  data: StatusData
  shell: MockShellChannel
  env: { home: string }
  /** 決定論「現在」（epoch 秒；T4.1 ResolveInput.now 必填——由派生來源 mock 情境沿用）。 */
  now: number
}

export interface GoldenCase {
  /** 黃金檔名（不含副檔名）＋測試 case 名。 */
  name: string
  config: BuilderConfig
  /** 存在＝可端到端 byte-exact（純 jq）；缺＝golden-only（shell-out）。 */
  scenario?: ByteExactScenario
}

const A = (index: number): ColorSpec => ({ kind: 'ansi256', index })
const TC = (hex: string): ColorSpec => ({ kind: 'truecolor', hex })

const TRAFFIC = THRESHOLD_TEMPLATES.traffic
const TRAFFIC_INV = THRESHOLD_TEMPLATES['traffic-inv']
const LIMIT_GRADIENT = THRESHOLD_TEMPLATES['limit-gradient']
const REMAINING_GRADIENT = THRESHOLD_TEMPLATES['remaining-gradient']

const FULL = MOCK_SCENARIOS_BY_ID.full
const EARLY = MOCK_SCENARIOS_BY_ID['early-null']

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function seg(id: string, over: Partial<SegmentConfig> = {}): SegmentConfig {
  return { id, enabled: true, icon: false, color: { kind: 'default' }, ...over }
}

function cfg(mode: BuilderConfig['mode'], over: Partial<BuilderConfig>): BuilderConfig {
  return {
    version: 2,
    mode,
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: true,
    powerlineArrow: mode === 'powerline', // v1 語意保值：既有 golden 全走 emitter 忽略之欄，僅供型別完整
    segments: [],
    ...over,
  }
}

/** FULL 派生 scenario（clone 後突變；shell/env 沿用 FULL）。 */
function fullWith(mutate: (d: StatusData) => void = () => {}): ByteExactScenario {
  const data = clone(FULL.data)
  mutate(data)
  return { data, shell: FULL.shell, env: FULL.env, now: FULL.now }
}

/** 指定 mock 情境派生（原樣、無突變）。 */
function fromMock(base: (typeof MOCK_SCENARIOS_BY_ID)[keyof typeof MOCK_SCENARIOS_BY_ID]): ByteExactScenario {
  return { data: clone(base.data), shell: base.shell, env: base.env, now: base.now }
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  // ── SP-5 三情境（byte-exact 已由 sp5/harness.mjs 對手寫 join 證實；此處
  //    改由 emitBash 產出、cap=true 一態簽黃金；cap 兩態於測試另跑） ──
  {
    name: 'sp5-a-powerline',
    config: cfg('powerline', {
      segments: [
        seg('model', { color: A(226) }),
        seg('session-name', { color: A(99) }),
        seg('context-used', { color: A(240), threshold: TRAFFIC }),
      ],
    }),
    // 中段條件隱藏（刪 session_name）＋鄰段閾值 bg（used=100→桶9）。
    scenario: fullWith((d) => {
      delete d.session_name
      d.context_window.used_percentage = 100
    }),
  },
  {
    name: 'sp5-b-powerline',
    config: cfg('powerline', {
      segments: [
        seg('model', { color: A(226) }),
        seg('rate-5h', { color: A(240), threshold: TRAFFIC }),
        seg('cost', { color: A(16) }),
      ],
    }),
    // 存活 dash-null 段夾中段（five_hour=null→'--' 退主色）＋cost=0.5。
    scenario: fullWith((d) => {
      d.rate_limits!.five_hour!.used_percentage = null
      d.cost.total_cost_usd = 0.5
    }),
  },
  {
    name: 'sp5-c-plain',
    config: cfg('plain', {
      segments: [
        seg('model'),
        seg('session-name', { prefix: '[s]', icon: true, color: A(99) }),
        seg('cost'),
      ],
    }),
    // prefix＋icon 段 value null（EARLY 無 session_name）→ 整段剔除無懸空前綴。
    scenario: fromMock(EARLY),
  },

  // ── plain 滿配（canonical）：涵蓋所有 jq 格式化 FormatKind＋閾值分裂 ──
  {
    name: 'plain-rich',
    config: cfg('plain', {
      separator: { kind: 'preset', value: '·' },
      segments: [
        seg('cwd', { variant: 'tilde', color: A(250) }),
        seg('version', {}),
        seg('cost', { color: A(82) }),
        seg('duration', { color: A(118) }),
        seg('context-size', { color: A(154) }),
        seg('lines-changed', { color: A(190) }),
        seg('pr', { color: TC('#ff8800') }),
        seg('repo', { color: A(45) }),
        seg('thinking', { color: A(220), icon: true }),
        // prefix＋icon＋閾值 → plain 分裂兩 run（head 主色、value 桶色）。
        seg('context-remaining', { prefix: 'R', icon: true, color: A(214), threshold: TRAFFIC_INV }),
      ],
    }),
    scenario: fullWith(),
  },

  // ── powerline＋閾值（canonical）：箭頭交接＋auto-fg＋fgOverride＋dash ──
  {
    name: 'powerline-rich',
    config: cfg('powerline', {
      segments: [
        seg('model', { color: A(226), icon: true }),
        seg('cwd', { variant: 'basename', color: A(24) }),
        seg('cost', { color: A(16) }),
        seg('context-used', { color: A(240), threshold: TRAFFIC, fgOverride: A(15) }),
        seg('rate-7d', { color: A(99) }),
        seg('repo', { color: TC('#334455') }),
      ],
    }),
    scenario: fullWith(),
  },

  // ── escaping（契約 6）：使用者前綴／自訂分隔符含 `'`／`$(…)`／`!` ──
  {
    name: 'escaping',
    config: cfg('plain', {
      separator: { kind: 'custom', value: "'" },
      segments: [
        seg('model', { prefix: "'$(x)", color: A(226) }),
        seg('version', { prefix: 'a!b' }),
      ],
    }),
    scenario: fullWith(),
  },

  // ── shell-out（golden-only）：git-branch／git-dirty／clock 的防禦包裹 ──
  {
    name: 'shellout',
    config: cfg('plain', {
      segments: [
        seg('model', { color: A(226) }),
        seg('git-branch', { color: A(46), icon: true }),
        seg('git-dirty', { color: A(196), icon: true }),
        seg('clock', { color: A(33), icon: true }),
      ],
    }),
    // 無 scenario：真 git/date 非決定論，只作腳本文字人審。
  },

  // ── powerline＋powerlineArrow:false（golden-only）：MAGI code review
  //    Important #8 修復——D1 gating 的 v2 預設模式（新使用者最常見輸出）
  //    先前僅有結構性子字串斷言，本案補一組完整黃金 byte 覆蓋。
  //    lastArrowCap:true 但 powerlineArrow:false → cap 全面無效（收尾
  //    箭頭區塊恆不 emit，見 emit-bash.ts/emit-ps1.ts D1 gating 節）；
  //    本案同時證「cap 值本身不影響輸出」。段組合：
  //    - context-used（threshold: TRAFFIC）＝閾值桶陣列／bg 交接段。
  //    - rate-5h（無 threshold）＝dash 政策段（null 時顯 '--'，不套桶色）。
  //    - session-name（icon＋prefix）／git-branch（icon＋shell-out）
  //      ＝2 個 icon-enabled 段，涵蓋 pad（每段 value 尾綴空白，D1）＋
  //      emoji glyph 逐 codepoint 跳脫（ps1 面）同時共存於無箭頭輸出。
  //    無 scenario：含 shell-out 段，真 git 非決定論，只作腳本文字人審
  //    （同 shellout 案）；真執行 byte-exact 覆蓋見
  //    pipeline.integration.test.ts 的 D1 gating 真執行覆蓋區塊。
  {
    name: 'powerline-noarrow',
    config: cfg('powerline', {
      powerlineArrow: false,
      lastArrowCap: true,
      segments: [
        seg('model', { icon: true, color: A(226) }),
        seg('session-name', { icon: true, prefix: '[s]', color: A(99) }),
        seg('context-used', { threshold: TRAFFIC, color: A(240) }),
        seg('rate-5h', { color: A(99) }),
        seg('git-branch', { icon: true, color: A(46) }),
      ],
    }),
  },

  // ── T4.6（08-PLAN Rev 4 §5；TASKS.md T4.6）golden 擴案：新 5 段／bar／
  //    auto／雙模板結構覆蓋（golden 為「產出腳本文字」，config 結構決定
  //    輸出——不需 scenario／real-exec 亦可覆蓋新程式碼路徑，故本節新案
  //    刻意不掛 scenario，維持 golden-only、CI 時間零額外負擔）。

  // 全 30 段單列（plain）：涵蓋新 5 段（token-in／token-out／cache-hit／
  // reset-5h／reset-7d）jq 產生路徑，與 golden-statusline-ps1.mjs 的
  // 'plain-full'（本次同步升級 25→30 段）equivalent 覆蓋、非逐字同名
  // （bash／ps1 兩份 canonical 各自獨立事實來源，見兩檔檔頭）。
  {
    name: 'full-30-plain',
    config: cfg('plain', {
      segments: [
        seg('model', { icon: true, color: A(75) }),
        seg('cwd', { icon: true, variant: 'tilde', prefix: '@' }),
        seg('project-dir', { icon: true }),
        seg('output-style', { icon: true }),
        seg('version', { icon: true, prefix: 'v' }),
        seg('cost', { icon: true, color: A(220) }),
        seg('duration', { icon: true }),
        seg('lines-changed', { icon: true }),
        seg('context-size', { icon: true }),
        seg('thinking', { icon: true }),
        seg('token-in', { icon: true, color: A(80) }),
        seg('token-out', { icon: true, color: A(81) }),
        seg('context-used', { icon: true, threshold: TRAFFIC, prefix: "it's " }),
        seg('context-remaining', { icon: true }),
        seg('cache-hit', { icon: true, color: A(214) }),
        seg('rate-5h', { icon: true, variant: 'percent-reset' }),
        seg('rate-7d', { icon: true, variant: 'percent-reset' }),
        seg('reset-5h', { icon: true, color: A(99) }),
        seg('reset-7d', { icon: true, color: A(99) }),
        seg('session-name', { icon: true, prefix: '$(x)' }),
        seg('effort', { icon: true }),
        seg('vim-mode', { icon: true }),
        seg('agent-name', { icon: true }),
        seg('pr', { icon: true }),
        seg('repo', { icon: true }),
        seg('worktree', { icon: true }),
        seg('worktree-branch', { icon: true }),
        seg('git-branch', { icon: true }),
        seg('git-dirty', { icon: true }),
        seg('clock', { icon: true }),
      ],
    }),
  },

  // bar 結構覆蓋（plain）：雙模板（limit-gradient／remaining-gradient）＋
  // traffic＋percent-reset 併 bar＋無閾值 bar（threshold===undefined →
  // filled／pct 退段主色，emitBarSegment 的 `else bfg=mainFgLit` 分支，
  // 與有閾值分支的 jq `tf` array／idx 計算為結構性不同程式碼路徑）。
  {
    name: 'bar-templates-plain',
    config: cfg('plain', {
      segments: [
        seg('context-used', { bar: true, threshold: LIMIT_GRADIENT, color: A(240) }),
        seg('context-remaining', { bar: true, threshold: REMAINING_GRADIENT, color: A(45) }),
        seg('rate-5h', { bar: true, variant: 'percent-reset', threshold: TRAFFIC, color: A(88) }),
        seg('cache-hit', { bar: true, color: A(200) }),
      ],
    }),
  },

  // bar＋auto＋倒數同列（powerline arrow=true, cap=true）：auto(model) 展開
  // 色參與箭頭交接／autoFg 對比＋bar 併元素累加器＋countdown 段三者同列
  // 共存（sp4/verify.mjs 案 10 配方；T4.6 §Verification 錨點）。
  {
    name: 'bar-auto-powerline-arrow',
    config: cfg('powerline', {
      lastArrowCap: true,
      segments: [
        seg('model', { color: { kind: 'auto' } }),
        seg('context-used', { bar: true, threshold: TRAFFIC, color: A(240) }),
        seg('reset-5h', { color: A(99) }),
      ],
    }),
  },

  // bar（無閾值）＋auto(effort)＋倒數同列（powerline powerlineArrow=false／
  // noarrow）：D1 gating 右 padding 與 auto／bar 併元素三者共存（sp4/
  // verify.mjs 案 11 配方）。
  {
    name: 'bar-auto-powerline-noarrow',
    config: cfg('powerline', {
      powerlineArrow: false,
      lastArrowCap: true,
      segments: [
        seg('effort', { color: { kind: 'auto' } }),
        seg('rate-7d', { bar: true, color: A(88) }),
        seg('reset-7d', { color: A(99) }),
      ],
    }),
  },

  // ── T1.6（(internal design doc) §D1 golden 策略）：
  // rowSeparators golden 契約落地——單列來源涵蓋「單列＋列 0 覆寫」與
  // 「custom 覆寫值含須逸出字元」兩案；多列對應案（「某列覆寫＋某列
  // null 顯式繼承」）見 tools/statusline-builder/multirow-golden-configs.ts
  // （兩來源零耦合、各自獨立事實來源，同既有 T4.6 擴案慣例）。皆 plain
  // 模式（rowSeparators 僅 plain 生效，PLAN §D1 golden 策略明訂範圍）。

  // 單列＋列 0（唯一啟用位）覆寫：全域 '|'、rowSeparators[0] 覆寫為 preset
  // '·'——單列 config 下 emitBash／emitPs1 皆恆呼叫 rowSeparatorValue(config,
  // 0)（無需 hasRowSepOverride 分流，見 emit-bash.ts「單列路徑 SEP 綁列 0
  // 覆寫」註解），join 分隔符須採覆寫值、非全域。
  {
    name: 'rowsep-single-override',
    config: cfg('plain', {
      rowSeparators: [{ kind: 'preset', value: '·' }],
      segments: [
        seg('model', { color: A(226) }),
        seg('cost', { color: A(220) }),
        seg('duration', { color: A(118) }),
      ],
    }),
    scenario: fullWith(),
  },

  // 單列覆寫值為 custom 且含須逸出字元（單引號）：驗 bashSingleQuote 對
  // `SEP` 宣告本身的逸出（比照既有 `escaping` 案分隔符逸出精神，惟該案
  // 逸出全域 separator、本案逸出 rowSeparators 覆寫值）。
  {
    name: 'rowsep-custom-escape',
    config: cfg('plain', {
      rowSeparators: [{ kind: 'custom', value: "'" }],
      segments: [seg('model', { prefix: "'$(x)", color: A(226) }), seg('version', {})],
    }),
    scenario: fullWith(),
  },
]
