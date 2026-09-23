/**
 * S5-T2.2（(internal design doc) §產生器契約 4／契約 3／
 * 契約 5／§D2／§D3／§預覽契約）：resolve 兩趟演算法——存活判定在
 * value、composition 單源、C1 組合（{plain,powerline}×{隱藏位置}×
 * 閾值邊界×lastArrowCap 兩態）、dash-null bg 退主色、箭頭交接、
 * resets 後綴、aria-label 組裝（零 PUA＋負向 enforcement，.t17 §4 形）。
 * SP-5 三情境（a 中段隱藏＋鄰段閾值 bg／b 存活 dash-null 夾中段×cap
 * 兩態／c prefix＋icon 段 value null）在此先以 oracle byte 釘住，
 * T2.3 真跑兩 shell 對同一輸出比對。
 * T4.1（(internal design doc) Rev 4 §4）新增：now
 * 注入（ResolveInput.now 必填）、expiresAtPath 通用死值、倒數兩套階梯、
 * tokens 縮寫錨點、cache-hit 全 0 resolve 層案。
 *
 * ── T6.1（M6，TASKS.md；使用者 2026-07-14 拍板契約 C1–C4）追補 ──
 * C1 百分比 dash-null 顯 NA_TEXT（取代 DASH_TEXT，token-in/out 等
 * always 類不受影響）；C2 bar×null 恆走 4-run（撤除舊 `&& !isDash`
 * 閘門）；C3 percent-reset 後綴升級倒數形（`resetsAtSuffix` 遷入
 * resolve.ts、簽章擴為 `(v, now, kind)`，null／已過期→''）；C4 後綴含
 * `↺` 之 aria 代換。「resets 後綴」describe 全面改寫為倒數形斷言（沿用
 * 「倒數段」describe 的 `inputAt` 決定論 diff 構造慣例，取代舊版
 * `inputWith`+固定 FULL.now 的非決定論寫法）。
 */
import { describe, expect, it } from 'vitest'
import type { ColorSpec } from './color.js'
import {
  defaultConfig,
  deserializeConfig,
  type BuilderConfig,
  type SegmentConfig,
  type SeparatorConfig,
} from './config.js'
import { toAnsi } from './emit-ansi.js'
import {
  MOCK_SCENARIOS_BY_ID,
  type MockScenario,
  type MockShellChannel,
} from './mock-data.js'
import {
  BAR_CELL_COUNT,
  BAR_EMPTY_CHAR,
  BAR_FILLED_CHAR,
  containsPua,
  DASH_TEXT,
  formatTokens,
  NA_TEXT,
  POWERLINE_ARROW,
  resetsAtSuffix,
  resolve,
  toAriaLabel,
  type ResolveInput,
} from './resolve.js'
import {
  DESCRIPTORS_BY_ID,
  formatCost,
  formatResetsAt,
  segmentAriaText,
  SEGMENT_CATALOG,
  type SegmentId,
  type StatusData,
} from './segments.js'
import { autoFgBuckets, THRESHOLD_TEMPLATES, type ThresholdRule } from './threshold.js'

const FULL = MOCK_SCENARIOS_BY_ID['full']
const EARLY = MOCK_SCENARIOS_BY_ID['early-null']
const COND = MOCK_SCENARIOS_BY_ID['conditional-absent']
const WIN = MOCK_SCENARIOS_BY_ID['windows-cjk']

const A = (index: number): ColorSpec => ({ kind: 'ansi256', index })
const TC = (hex: string): ColorSpec => ({ kind: 'truecolor', hex })
const TRAFFIC = THRESHOLD_TEMPLATES.traffic
const glyph = (id: SegmentId): string => DESCRIPTORS_BY_ID[id].icon.glyph

function seg(id: string, over: Partial<SegmentConfig> = {}): SegmentConfig {
  return { id, enabled: true, icon: false, color: { kind: 'default' }, ...over }
}

function cfg(over: Partial<BuilderConfig> = {}): BuilderConfig {
  const mode = over.mode ?? 'plain'
  return {
    version: 2,
    mode,
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: true,
    powerlineArrow: mode === 'powerline',
    segments: [],
    ...over,
  }
}

/** canonical 情境為底、深拷貝改 data（mock 深凍結不可變；情境本身可整顆直傳 resolve）。 */
function inputWith(base: MockScenario, mutate: (d: StatusData) => void): ResolveInput {
  const data = JSON.parse(JSON.stringify(base.data)) as StatusData
  mutate(data)
  return { data, shell: base.shell, env: base.env, now: base.now }
}

function inputShell(base: MockScenario, shell: Partial<MockShellChannel>): ResolveInput {
  return { data: base.data, shell: { ...base.shell, ...shell }, env: base.env, now: base.now }
}

/** 自訂 now 的輸入（T4.1 倒數／過期案：now 與 resets_at 成對給定，diff 精確可算）。 */
function inputAt(base: MockScenario, now: number, mutate: (d: StatusData) => void): ResolveInput {
  const data = JSON.parse(JSON.stringify(base.data)) as StatusData
  mutate(data)
  return { data, shell: base.shell, env: base.env, now }
}

/** 本地時區構造 epoch 秒（formatResetsAt 亦走本地時分——斷言不依賴 CI 時區）。 */
const epochAt = (hours: number, minutes: number): number =>
  Math.floor(new Date(2026, 6, 8, hours, minutes).getTime() / 1000)

/** 本地時區構造完整日期 epoch 秒（T4.1 倒數 7d 的 MM/DD 斷言不依賴 CI 時區）。 */
const epochAtDate = (month: number, day: number, hours: number, minutes: number): number =>
  Math.floor(new Date(2026, month - 1, day, hours, minutes).getTime() / 1000)

// ── 段內 composition（契約 4 單源） ──

describe('段內 composition', () => {
  it('plain 單段：text＋fg（ansi256）', () => {
    const runs = resolve(cfg({ segments: [seg('model', { color: A(196) })] }), FULL)[0]
    expect(runs).toEqual([{ text: 'Fable 5', fg: { kind: 'ansi256', index: 196 } }])
  })

  it('default 色不落 run 屬性（正規形）', () => {
    const runs = resolve(cfg({ segments: [seg('model')] }), FULL)[0]
    expect(runs).toEqual([{ text: 'Fable 5' }])
    expect('fg' in runs[0]).toBe(false)
    expect('bg' in runs[0]).toBe(false)
  })

  it('composition 順序 prefix + icon-glyph + 空格 + value；aria＝glyph 機械代換', () => {
    const runs = resolve(cfg({ segments: [seg('model', { prefix: 'M:', icon: true })] }), FULL)[0]
    expect(runs).toEqual([
      { text: `M:${glyph('model')} Fable 5`, ariaText: 'M:模型 Fable 5' },
    ])
  })

  it('truecolor fg → 38;2;r;g;b bytes', () => {
    const runs = resolve(cfg({ segments: [seg('model', { color: TC('#1a2b3c') })] }), FULL)
    expect(toAnsi(runs)).toBe('\x1b[0m\x1b[38;2;26;43;60mFable 5\x1b[0m')
  })
})

// ── 存活判定在 value（契約 4／契約 3 null 三態） ──

describe('存活判定在 value', () => {
  it('prefix＋icon 段 value null → 整段剔除，無懸空前綴（SP-5 情境 c）', () => {
    const ghost = cfg({
      segments: [
        seg('model'),
        seg('session-name', { prefix: '[s]', icon: true, color: A(99) }),
        seg('cost'),
      ],
    })
    const bare = cfg({ segments: [seg('model'), seg('cost')] })
    expect(resolve(ghost, EARLY)[0].map((r) => r.text)).toEqual(['Sonnet 5', '|', '$0.0000'])
    expect(toAnsi(resolve(ghost, EARLY))).toBe(toAnsi(resolve(bare, EARLY)))
  })

  it('prefix＋icon 段 value null → 整段剔除（powerline 同構）', () => {
    const ghost = cfg({
      mode: 'powerline',
      segments: [
        seg('model', { color: A(226) }),
        seg('session-name', { prefix: '[s]', icon: true, color: A(99) }),
        seg('cost', { color: A(16) }),
      ],
    })
    const bare = cfg({
      mode: 'powerline',
      segments: [seg('model', { color: A(226) }), seg('cost', { color: A(16) })],
    })
    expect(toAnsi(resolve(ghost, EARLY))).toBe(toAnsi(resolve(bare, EARLY)))
  })

  it('hide 政策：條件段缺席 → 剔除', () => {
    const config = cfg({ segments: [seg('effort'), seg('vim-mode'), seg('agent-name')] })
    expect(resolve(config, COND)[0]).toEqual([])
    expect(resolve(config, FULL)[0].map((r) => r.text)).toEqual(['high', '|', 'NORMAL', '|', 'reviewer'])
  })

  it('empty 政策：thinking false 剔除、true → on（契約 3 刻意選擇）', () => {
    const config = cfg({ segments: [seg('thinking')] })
    expect(resolve(config, EARLY)[0]).toEqual([])
    expect(resolve(config, FULL)[0]).toEqual([{ text: 'on' }])
  })

  it('shell 通道死值：非 git（branch ""）／乾淨（dirty false）剔除；存活形＝DEV／*', () => {
    const config = cfg({ segments: [seg('git-branch'), seg('git-dirty')] })
    expect(resolve(config, COND)[0]).toEqual([])
    expect(resolve(config, FULL)[0].map((r) => r.text)).toEqual(['DEV', '|', '*'])
  })

  it('dash 政策：百分比段 null 存活顯 NA_TEXT（M6 C1）；0% 存活（0 非死值）', () => {
    const config = cfg({ segments: [seg('context-used')] })
    expect(resolve(config, EARLY)[0]).toEqual([{ text: NA_TEXT }])
    const zero = inputWith(FULL, (d) => {
      d.context_window.used_percentage = 0
    })
    expect(resolve(config, zero)[0]).toEqual([{ text: '0%' }])
  })

  it('clock：shell 通道恆活、HH:mm 零填補', () => {
    expect(resolve(cfg({ segments: [seg('clock')] }), FULL)[0]).toEqual([{ text: '09:05' }])
    expect(
      resolve(cfg({ segments: [seg('clock')] }), inputShell(FULL, { clock: { hours: 0, minutes: 0 } }))[0],
    ).toEqual([{ text: '00:00' }])
  })
})

// ── C1：plain join（隱藏位置×分隔符） ──

describe('plain join', () => {
  const trio = (ids: string[]) => cfg({ segments: ids.map((id) => seg(id)) })

  it('中段隱藏：無雙分隔符（byte 級）', () => {
    const runs = resolve(trio(['model', 'session-name', 'cost']), EARLY)
    expect(toAnsi(runs)).toBe('\x1b[0mSonnet 5\x1b[0m|\x1b[0m$0.0000\x1b[0m')
  })

  it('首段隱藏：無 leading 分隔符', () => {
    const runs = resolve(trio(['session-name', 'model', 'cost']), EARLY)[0]
    expect(runs.map((r) => r.text)).toEqual(['Sonnet 5', '|', '$0.0000'])
  })

  it('末段隱藏：無 trailing 分隔符', () => {
    const runs = resolve(trio(['model', 'cost', 'session-name']), EARLY)[0]
    expect(runs.map((r) => r.text)).toEqual(['Sonnet 5', '|', '$0.0000'])
  })

  it('全隱藏 → []；toAnsi 恆出行尾 reset', () => {
    const runs = resolve(trio(['session-name', 'vim-mode', 'agent-name']), EARLY)
    expect(runs[0]).toEqual([])
    expect(toAnsi(runs)).toBe('\x1b[0m')
  })

  it('分隔符 run 形＝{text, ariaText:""}（純裝飾，不著色）', () => {
    const runs = resolve(trio(['model', 'cost']), EARLY)[0]
    expect(runs[1]).toEqual({ text: '|', ariaText: '' })
  })

  it('custom 分隔符：空字串＝直接串接（無分隔 run）；非空照 value', () => {
    const empty = cfg({
      separator: { kind: 'custom', value: '' },
      segments: [seg('model'), seg('cost')],
    })
    expect(resolve(empty, EARLY)[0].map((r) => r.text)).toEqual(['Sonnet 5', '$0.0000'])
    const custom = cfg({
      separator: { kind: 'custom', value: ' >> ' },
      segments: [seg('model'), seg('cost')],
    })
    expect(resolve(custom, EARLY)[0].map((r) => r.text)).toEqual(['Sonnet 5', ' >> ', '$0.0000'])
  })
})

// ── C1：powerline join（箭頭交接×lastArrowCap 兩態） ──

describe('powerline join', () => {
  it('三段交接：箭頭 fg=前段bg、bg=後段bg；段 fg=auto-fg；cap fg=末段bg', () => {
    const config = cfg({
      mode: 'powerline',
      segments: [
        seg('model', { color: A(226) }),
        seg('git-branch', { color: A(240) }),
        seg('cost', { color: TC('#112233') }),
      ],
    })
    expect(resolve(config, FULL)[0]).toEqual([
      { text: 'Fable 5', fg: { kind: 'ansi256', index: 16 }, bg: { kind: 'ansi256', index: 226 } },
      {
        text: POWERLINE_ARROW,
        ariaText: '',
        fg: { kind: 'ansi256', index: 226 },
        bg: { kind: 'ansi256', index: 240 },
      },
      { text: 'DEV', fg: { kind: 'ansi256', index: 231 }, bg: { kind: 'ansi256', index: 240 } },
      {
        text: POWERLINE_ARROW,
        ariaText: '',
        fg: { kind: 'ansi256', index: 240 },
        bg: { kind: 'truecolor', hex: '#112233' },
      },
      {
        text: formatCost(3.3341),
        fg: { kind: 'truecolor', hex: '#ffffff' },
        bg: { kind: 'truecolor', hex: '#112233' },
      },
      { text: POWERLINE_ARROW, ariaText: '', fg: { kind: 'truecolor', hex: '#112233' } },
    ])
  })

  it('lastArrowCap=false：無收尾箭頭', () => {
    const config = cfg({
      mode: 'powerline',
      lastArrowCap: false,
      segments: [seg('model', { color: A(226) }), seg('cost', { color: A(16) })],
    })
    const runs = resolve(config, FULL)[0]
    expect(runs).toHaveLength(3)
    expect(runs[runs.length - 1].text).toBe(formatCost(3.3341))
  })

  it('中段條件隱藏＋鄰段閾值 bg：箭頭跨接存活段（SP-5 情境 a，byte 級）', () => {
    const config = cfg({
      mode: 'powerline',
      segments: [
        seg('model', { color: A(226) }),
        seg('session-name', { color: A(99) }),
        seg('context-used', { threshold: TRAFFIC, color: A(240) }),
      ],
    })
    const input = inputWith(FULL, (d) => {
      delete d.session_name
      d.context_window.used_percentage = 100
    })
    expect(toAnsi(resolve(config, input))).toBe(
      '\x1b[0m\x1b[38;5;16m\x1b[48;5;226mFable 5' +
        `\x1b[0m\x1b[38;5;226m\x1b[48;5;196m${POWERLINE_ARROW}` +
        '\x1b[0m\x1b[38;5;16m\x1b[48;5;196m100%' +
        `\x1b[0m\x1b[38;5;196m${POWERLINE_ARROW}` +
        '\x1b[0m',
    )
  })

  it('存活 dash-null 段夾中段：bg 退 SegmentConfig.color、交接色恆有定義（SP-5 情境 b，cap 兩態）', () => {
    const segments = [
      seg('model', { color: A(226) }),
      seg('rate-5h', { color: A(240), threshold: TRAFFIC }),
      seg('cost', { color: A(16) }),
    ]
    const input = inputWith(FULL, (d) => {
      d.rate_limits!.five_hour!.used_percentage = null
      d.cost.total_cost_usd = 0.5
    })
    const capped = resolve(cfg({ mode: 'powerline', segments }), input)
    expect(capped[0]).toEqual([
      { text: 'Fable 5', fg: { kind: 'ansi256', index: 16 }, bg: { kind: 'ansi256', index: 226 } },
      {
        text: POWERLINE_ARROW,
        ariaText: '',
        fg: { kind: 'ansi256', index: 226 },
        bg: { kind: 'ansi256', index: 240 },
      },
      { text: NA_TEXT, fg: { kind: 'ansi256', index: 231 }, bg: { kind: 'ansi256', index: 240 } },
      {
        text: POWERLINE_ARROW,
        ariaText: '',
        fg: { kind: 'ansi256', index: 240 },
        bg: { kind: 'ansi256', index: 16 },
      },
      { text: '$0.5000', fg: { kind: 'ansi256', index: 231 }, bg: { kind: 'ansi256', index: 16 } },
      { text: POWERLINE_ARROW, ariaText: '', fg: { kind: 'ansi256', index: 16 } },
    ])
    expect(toAnsi(capped)).toBe(
      '\x1b[0m\x1b[38;5;16m\x1b[48;5;226mFable 5' +
        `\x1b[0m\x1b[38;5;226m\x1b[48;5;240m${POWERLINE_ARROW}` +
        `\x1b[0m\x1b[38;5;231m\x1b[48;5;240m${NA_TEXT}` +
        `\x1b[0m\x1b[38;5;240m\x1b[48;5;16m${POWERLINE_ARROW}` +
        '\x1b[0m\x1b[38;5;231m\x1b[48;5;16m$0.5000' +
        `\x1b[0m\x1b[38;5;16m${POWERLINE_ARROW}` +
        '\x1b[0m',
    )
    const uncapped = resolve(cfg({ mode: 'powerline', lastArrowCap: false, segments }), input)
    expect(uncapped[0]).toEqual(capped[0].slice(0, -1))
  })

  it('首段隱藏：無 leading 箭頭', () => {
    const config = cfg({
      mode: 'powerline',
      segments: [seg('session-name', { color: A(99) }), seg('model', { color: A(226) })],
    })
    const runs = resolve(config, EARLY)[0]
    expect(runs.map((r) => r.text)).toEqual(['Sonnet 5', POWERLINE_ARROW])
  })

  it('全隱藏（powerline）→ []＋行尾 reset', () => {
    const config = cfg({
      mode: 'powerline',
      segments: [seg('session-name'), seg('agent-name')],
    })
    expect(resolve(config, EARLY)[0]).toEqual([])
    expect(toAnsi(resolve(config, EARLY))).toBe('\x1b[0m')
  })

  it('單段存活：cap=true 收尾箭頭、cap=false 僅段 run', () => {
    const one = [seg('model', { color: A(226) })]
    expect(
      resolve(cfg({ mode: 'powerline', segments: one }), FULL)[0].map((r) => r.text),
    ).toEqual(['Fable 5', POWERLINE_ARROW])
    expect(
      resolve(cfg({ mode: 'powerline', lastArrowCap: false, segments: one }), FULL)[0].map(
        (r) => r.text,
      ),
    ).toEqual(['Fable 5'])
  })

  it('default bg 段：箭頭交接色恆有定義（default＝不著色，run 無 fg/bg 屬性）', () => {
    const config = cfg({ mode: 'powerline', segments: [seg('model'), seg('cost')] })
    const runs = resolve(config, EARLY)[0]
    expect(runs[1]).toEqual({ text: POWERLINE_ARROW, ariaText: '' })
    expect(runs[3]).toEqual({ text: POWERLINE_ARROW, ariaText: '' })
  })
})

// ── D1 gating（06a：powerlineArrow × lastArrowCap 四組合，僅 powerline） ──

describe('D1 gating（powerlineArrow × lastArrowCap）', () => {
  const two = (over: Partial<BuilderConfig>) =>
    cfg({
      mode: 'powerline',
      segments: [seg('model', { color: A(226) }), seg('cost', { color: A(16) })],
      ...over,
    })

  it.each([true, false])(
    'powerlineArrow=false（lastArrowCap=%s 無效）：無段間箭頭、無 cap、每段 value 後補一格',
    (lastArrowCap) => {
      const runs = resolve(two({ powerlineArrow: false, lastArrowCap }), FULL)[0]
      expect(runs.map((r) => r.text)).toEqual([`Fable 5 `, `${formatCost(3.3341)} `])
      expect(runs.some((r) => r.text === POWERLINE_ARROW)).toBe(false)
    },
  )

  it('powerlineArrow=true：完整 v1 語意（箭頭生效、無 padding）；lastArrowCap 依其值決定 cap', () => {
    const capped = resolve(two({ powerlineArrow: true, lastArrowCap: true }), FULL)[0]
    expect(capped.map((r) => r.text)).toEqual([
      'Fable 5',
      POWERLINE_ARROW,
      formatCost(3.3341),
      POWERLINE_ARROW,
    ])
    const uncapped = resolve(two({ powerlineArrow: true, lastArrowCap: false }), FULL)[0]
    expect(uncapped.map((r) => r.text)).toEqual(['Fable 5', POWERLINE_ARROW, formatCost(3.3341)])
  })

  it('padding 併入著色 run（fg/bg 不變）、不新增裝飾 run（沉默處選擇 7）', () => {
    const runs = resolve(two({ powerlineArrow: false, lastArrowCap: true }), FULL)[0]
    expect(runs).toEqual([
      { text: 'Fable 5 ', fg: { kind: 'ansi256', index: 16 }, bg: { kind: 'ansi256', index: 226 } },
      { text: `${formatCost(3.3341)} `, fg: { kind: 'ansi256', index: 231 }, bg: { kind: 'ansi256', index: 16 } },
    ])
  })

  it('padding 不進 ariaText（toAriaLabel 逐 chunk trim，省略較不誤導）', () => {
    const runs = resolve(
      two({ powerlineArrow: false, segments: [seg('model', { icon: true, color: A(226) })] }),
      FULL,
    )[0]
    expect(runs[0].ariaText).toBe('模型 Fable 5')
    expect(toAriaLabel(runs)).toBe('模型 Fable 5')
  })
})

// ── 閾值（契約 5＋D2 成對 auto-fg） ──

describe('閾值', () => {
  it.each([
    [0, 46],
    [9.9, 46],
    [10, 82],
    [42.5, 190],
    [100, 196],
    [105, 196],
  ])('plain：p=%f → 桶色 ansi256 %i 作用於 fg', (p, colorIndex) => {
    const config = cfg({ segments: [seg('context-used', { threshold: TRAFFIC, color: A(240) })] })
    const input = inputWith(FULL, (d) => {
      d.context_window.used_percentage = p
    })
    expect(resolve(config, input)[0]).toEqual([
      { text: `${Math.floor(p)}%`, fg: { kind: 'ansi256', index: colorIndex } },
    ])
  })

  it('dash-null（百分比段顯 NA_TEXT，M6 C1）：不套閾值色——plain fg 退主色／powerline bg 退主色＋auto-fg', () => {
    const segments = [seg('context-used', { threshold: TRAFFIC, color: A(240) })]
    expect(resolve(cfg({ segments }), EARLY)[0]).toEqual([
      { text: NA_TEXT, fg: { kind: 'ansi256', index: 240 } },
    ])
    expect(resolve(cfg({ mode: 'powerline', lastArrowCap: false, segments }), EARLY)[0]).toEqual([
      { text: NA_TEXT, fg: { kind: 'ansi256', index: 231 }, bg: { kind: 'ansi256', index: 240 } },
    ])
  })

  it('plain 閾值＋head 非空 → 兩 run：head 隨段主色、value 隨桶色', () => {
    const config = cfg({
      segments: [
        seg('context-used', { prefix: 'ctx ', icon: true, threshold: TRAFFIC, color: A(45) }),
      ],
    })
    expect(resolve(config, FULL)[0]).toEqual([
      {
        text: `ctx ${glyph('context-used')} `,
        ariaText: 'ctx 上下文已用',
        fg: { kind: 'ansi256', index: 45 },
      },
      { text: '42%', fg: { kind: 'ansi256', index: 190 } },
    ])
  })

  it('powerline 閾值：bg=桶色、fg=成對 auto-fg（執行期零亮度數學）', () => {
    const config = cfg({
      mode: 'powerline',
      lastArrowCap: false,
      segments: [seg('context-used', { threshold: TRAFFIC, color: A(240) })],
    })
    const at = (p: number) =>
      resolve(
        config,
        inputWith(FULL, (d) => {
          d.context_window.used_percentage = p
        }),
      )[0]
    expect(at(100)).toEqual([
      { text: '100%', fg: { kind: 'ansi256', index: 16 }, bg: { kind: 'ansi256', index: 196 } },
    ])
    expect(at(5)).toEqual([
      { text: '5%', fg: { kind: 'ansi256', index: 16 }, bg: { kind: 'ansi256', index: 46 } },
    ])
  })

  it('powerline fgOverride：全桶用 override（autoFgBuckets 同構）', () => {
    const config = cfg({
      mode: 'powerline',
      lastArrowCap: false,
      segments: [seg('context-used', { threshold: TRAFFIC, fgOverride: A(201), color: A(240) })],
    })
    const input = inputWith(FULL, (d) => {
      d.context_window.used_percentage = 100
    })
    expect(resolve(config, input)[0]).toEqual([
      { text: '100%', fg: { kind: 'ansi256', index: 201 }, bg: { kind: 'ansi256', index: 196 } },
    ])
    expect(autoFgBuckets(TRAFFIC, A(201))[9]).toEqual({ kind: 'ansi256', index: 201 })
  })

  it('非 percentage 段掛 threshold → 忽略（不分裂、不套桶色）', () => {
    const config = cfg({
      segments: [seg('model', { icon: true, threshold: TRAFFIC, color: A(27) })],
    })
    const runs = resolve(config, FULL)[0]
    expect(runs).toHaveLength(1)
    expect(runs[0].fg).toEqual({ kind: 'ansi256', index: 27 })
  })
})

// ── M6 C1（2026-07-14 拍板）：五個百分比段 dash-null 一律顯 NA_TEXT ──

describe('M6 C1：百分比段 dash-null 顯 NA_TEXT（bar 關，5 段參數化）', () => {
  it.each([
    ['context-used', (d: StatusData) => { d.context_window.used_percentage = null }],
    ['context-remaining', (d: StatusData) => { d.context_window.remaining_percentage = null }],
    [
      'rate-5h',
      (d: StatusData) => {
        d.rate_limits = { five_hour: { used_percentage: null, resets_at: null } }
      },
    ],
    [
      'rate-7d',
      (d: StatusData) => {
        d.rate_limits = { seven_day: { used_percentage: null, resets_at: null } }
      },
    ],
    ['cache-hit', (d: StatusData) => { d.context_window.current_usage = null }],
  ] as const)('%s：主值 null → 單 run NA_TEXT（threshold 設亦不套閾值色，退段主色）', (id, mutate) => {
    const config = cfg({ segments: [seg(id, { threshold: TRAFFIC, color: A(240) })] })
    const input = inputWith(FULL, mutate)
    expect(resolve(config, input)[0]).toEqual([{ text: NA_TEXT, fg: { kind: 'ansi256', index: 240 } }])
  })
})

// ── resets 後綴（rate 段 variant；M6 C3 起升級為倒數形，2026-07-14 拍板）──
//
// `inputAt` 給定 now（沿「倒數段」describe 的決定論 diff 構造慣例，取代
// 舊版 `inputWith`+固定 FULL.now 的非決定論寫法——舊寫法下 diff 隨
// epochAt() 與 FULL_NOW 的時區相依差值飄動，升級倒數形後不再可接受）。

describe('resets 後綴（percent-reset variant，倒數形）', () => {
  const rateAt = (
    id: 'rate-5h' | 'rate-7d',
    over: Partial<SegmentConfig>,
    now: number,
    mutate: (d: StatusData) => void,
  ) => resolve(cfg({ segments: [seg(id, over)] }), inputAt(FULL, now, mutate))[0]

  it('rate-5h percent-reset：後綴＝formatResetCountdown5h（" ↺ Xh (HH:MM)"），跨 1h 界線走 Xm 分支', () => {
    const resetsAt = epochAt(14, 30)
    const hourBranch = rateAt('rate-5h', { variant: 'percent-reset' }, resetsAt - 2 * 3600, (d) => {
      d.rate_limits!.five_hour!.used_percentage = 63.2
      d.rate_limits!.five_hour!.resets_at = resetsAt
    })
    expect(hourBranch).toEqual([{ text: '63% ↺ 2h (14:30)', ariaText: '63% 重置 2h (14:30)' }])
    const minuteBranch = rateAt('rate-5h', { variant: 'percent-reset' }, resetsAt - 59, (d) => {
      d.rate_limits!.five_hour!.used_percentage = 63.2
      d.rate_limits!.five_hour!.resets_at = resetsAt
    })
    expect(minuteBranch).toEqual([{ text: '63% ↺ 0m (14:30)', ariaText: '63% 重置 0m (14:30)' }])
  })

  it('rate-7d percent-reset：後綴＝formatResetCountdown7d（" ↺ Xd (MM/DD HH:MM)"），跨 1 日界線走 XhYm 分支', () => {
    const resetsAt = epochAtDate(7, 8, 8, 5)
    const dayBranch = rateAt('rate-7d', { variant: 'percent-reset' }, resetsAt - 4 * 86400, (d) => {
      d.rate_limits!.seven_day!.used_percentage = 21
      d.rate_limits!.seven_day!.resets_at = resetsAt
    })
    expect(dayBranch).toEqual([{ text: '21% ↺ 4d (07/08 08:05)', ariaText: '21% 重置 4d (07/08 08:05)' }])
    const hourMinuteBranch = rateAt('rate-7d', { variant: 'percent-reset' }, resetsAt - 3661, (d) => {
      d.rate_limits!.seven_day!.used_percentage = 21
      d.rate_limits!.seven_day!.resets_at = resetsAt
    })
    expect(hourMinuteBranch).toEqual([
      { text: '21% ↺ 1h1m (07/08 08:05)', ariaText: '21% 重置 1h1m (07/08 08:05)' },
    ])
  })

  it('variant 缺省＝percent：不附後綴（resets_at 在亦不附）', () => {
    expect(resolve(cfg({ segments: [seg('rate-5h')] }), FULL)[0]).toEqual([{ text: '63%' }])
  })

  it('percent-reset＋resets_at null → 後綴剔除', () => {
    expect(resolve(cfg({ segments: [seg('rate-7d', { variant: 'percent-reset' })] }), WIN)[0]).toEqual([
      { text: '88%' },
    ])
  })

  it('percent-reset＋已過期（now ≥ resets_at）→ 後綴剔除（僅影響後綴，rate 段本體仍存活；M6 C3 死值規則）', () => {
    const resetsAt = epochAt(14, 30)
    const atExpiry = rateAt('rate-5h', { variant: 'percent-reset' }, resetsAt, (d) => {
      d.rate_limits!.five_hour!.used_percentage = 63.2
      d.rate_limits!.five_hour!.resets_at = resetsAt
    })
    expect(atExpiry).toEqual([{ text: '63%' }])
    const pastExpiry = rateAt('rate-5h', { variant: 'percent-reset' }, resetsAt + 1, (d) => {
      d.rate_limits!.five_hour!.used_percentage = 63.2
      d.rate_limits!.five_hour!.resets_at = resetsAt
    })
    expect(pastExpiry).toEqual([{ text: '63%' }])
  })

  it('NA_TEXT＋後綴共存："(n/a) ↺ Xh (HH:MM)"（後綴獨立於主值，沉默處選擇 3；M6 C1 主值形改 NA_TEXT）', () => {
    const resetsAt = epochAt(9, 5)
    const runs = rateAt('rate-5h', { variant: 'percent-reset' }, resetsAt - 3600, (d) => {
      d.rate_limits!.five_hour!.used_percentage = null
      d.rate_limits!.five_hour!.resets_at = resetsAt
    })
    expect(runs).toEqual([{ text: '(n/a) ↺ 1h (09:05)', ariaText: '(n/a) 重置 1h (09:05)' }])
  })

  it('閾值分裂時後綴隨值色（value run 一體）；suffix aria 代換 ↺→重置（M6 C4）', () => {
    const resetsAt = epochAt(14, 30)
    const runs = resolve(
      cfg({
        segments: [
          seg('rate-5h', {
            icon: true,
            variant: 'percent-reset',
            threshold: TRAFFIC,
            color: A(240),
          }),
        ],
      }),
      inputAt(FULL, resetsAt - 2 * 3600, (d) => {
        d.rate_limits!.five_hour!.used_percentage = 63.2
        d.rate_limits!.five_hour!.resets_at = resetsAt
      }),
    )[0]
    expect(runs).toEqual([
      {
        text: `${glyph('rate-5h')} `,
        ariaText: '5 小時限額',
        fg: { kind: 'ansi256', index: 240 },
      },
      {
        text: '63% ↺ 2h (14:30)',
        ariaText: '63% 重置 2h (14:30)',
        fg: { kind: 'ansi256', index: 220 },
      },
    ])
  })
})

// ── resetsAtSuffix（M6 C3；遷自 segments.ts，直測邊界，見 resolve.ts 檔頭「T6.1」節） ──

describe('resetsAtSuffix（v, now, kind）', () => {
  it('null/undefined → 無後綴（不論 now／kind）', () => {
    expect(resetsAtSuffix(null, 0, 'reset-countdown-5h')).toBe('')
    expect(resetsAtSuffix(undefined, 0, 'reset-countdown-7d')).toBe('')
  })

  it('已過期（now ≥ v）→ 無後綴（恰等亦視為過期）', () => {
    expect(resetsAtSuffix(1000, 1000, 'reset-countdown-5h')).toBe('')
    expect(resetsAtSuffix(1000, 1001, 'reset-countdown-5h')).toBe('')
  })

  it('kind=reset-countdown-5h：未過期 → " ↺ Xh/Xm (HH:MM)"（複用 formatResetCountdown5h）', () => {
    const resetsAt = epochAt(14, 30)
    expect(resetsAtSuffix(resetsAt, resetsAt - 3600, 'reset-countdown-5h')).toBe(' ↺ 1h (14:30)')
    expect(resetsAtSuffix(resetsAt, resetsAt - 59, 'reset-countdown-5h')).toBe(' ↺ 0m (14:30)')
  })

  it('kind=reset-countdown-7d：未過期 → " ↺ Xd/XhYm (MM/DD HH:MM)"（複用 formatResetCountdown7d）', () => {
    const resetsAt = epochAtDate(7, 8, 8, 5)
    expect(resetsAtSuffix(resetsAt, resetsAt - 4 * 86400, 'reset-countdown-7d')).toBe(
      ' ↺ 4d (07/08 08:05)',
    )
    expect(resetsAtSuffix(resetsAt, resetsAt - 3661, 'reset-countdown-7d')).toBe(
      ' ↺ 1h1m (07/08 08:05)',
    )
  })

  it('非 number 非 null＝epoch 假設破產→TypeError（SP-0 對帳點，沿舊版邊界哲學）', () => {
    expect(() => resetsAtSuffix('soon', 0, 'reset-countdown-5h')).toThrow(TypeError)
    expect(() => resetsAtSuffix(Number.NaN, 0, 'reset-countdown-5h')).toThrow(TypeError)
  })
})

// ── 倒數段（T4.1；08-PLAN Rev 4 §4 兩套階梯＋expiresAtPath 通用死值） ──

describe('倒數段（reset-5h／reset-7d）', () => {
  // now＝resets_at−diff 成對構造：diff 精確可算、HH:MM／MM/DD 以本地時區
  // epoch 構造（斷言不依賴 CI 時區；沿 epochAt 先例）。
  const at5h = (diff: number) => {
    const resetsAt = epochAt(14, 30)
    return resolve(
      cfg({ segments: [seg('reset-5h')] }),
      inputAt(FULL, resetsAt - diff, (d) => {
        d.rate_limits!.five_hour!.resets_at = resetsAt
      }),
    )[0]
  }
  const at7d = (diff: number) => {
    const resetsAt = epochAtDate(7, 8, 8, 5)
    return resolve(
      cfg({ segments: [seg('reset-7d')] }),
      inputAt(FULL, resetsAt - diff, (d) => {
        d.rate_limits!.seven_day!.resets_at = resetsAt
      }),
    )[0]
  }

  // T4.2（08-PLAN Rev 4 §4）：倒數段 value run 的 ariaText 顯式代換 `↺`→
  // 「重置」（引擎自產 glyph 非 PUA、機械 enforcement 不攔，沿 icon
  // glyph→ariaText 代換慣例）——期望 run 形自 T4.1 起附 ariaText。
  it('5h 階梯 ≥1h："↺ Xh (HH:MM)"（X=floor(diff/3600)；跨界 3600 恰落 1h）', () => {
    expect(at5h(3600)).toEqual([{ text: '↺ 1h (14:30)', ariaText: '重置 1h (14:30)' }])
    expect(at5h(2 * 3600 + 59 * 60 + 59)).toEqual([
      { text: '↺ 2h (14:30)', ariaText: '重置 2h (14:30)' }, // 全 floor 非 round
    ])
  })

  it('5h 階梯 <1h："↺ Xm (HH:MM)"（X=floor(diff/60)；跨界 3599 落分鐘檔）', () => {
    expect(at5h(3599)).toEqual([{ text: '↺ 59m (14:30)', ariaText: '重置 59m (14:30)' }])
    expect(at5h(59)).toEqual([{ text: '↺ 0m (14:30)', ariaText: '重置 0m (14:30)' }])
  })

  it('7d 階梯 ≥1d："↺ Xd (MM/DD HH:MM)"（X=floor(diff/86400)；MM/DD 零填）', () => {
    expect(at7d(86400)).toEqual([
      { text: '↺ 1d (07/08 08:05)', ariaText: '重置 1d (07/08 08:05)' },
    ])
    expect(at7d(4 * 86400 + 18 * 3600)).toEqual([
      { text: '↺ 4d (07/08 08:05)', ariaText: '重置 4d (07/08 08:05)' },
    ])
  })

  it('7d 階梯 <1d："↺ XhYm (MM/DD HH:MM)"（跨界 86399 落 23h59m；X/Y 全 floor）', () => {
    expect(at7d(86399)).toEqual([
      { text: '↺ 23h59m (07/08 08:05)', ariaText: '重置 23h59m (07/08 08:05)' },
    ])
    expect(at7d(3661)).toEqual([
      { text: '↺ 1h1m (07/08 08:05)', ariaText: '重置 1h1m (07/08 08:05)' },
    ])
  })

  it('過期 hide（expiresAtPath 通用死值規則）：now ≥ resets_at → 整段剔除（diff 0／負值皆同）', () => {
    expect(at5h(0)).toEqual([])
    expect(at5h(-1)).toEqual([])
    expect(at7d(0)).toEqual([])
  })

  it('null hide：resets_at null（WIN seven_day）／視窗缺席（EARLY）→ 整段剔除', () => {
    expect(resolve(cfg({ segments: [seg('reset-7d')] }), WIN)[0]).toEqual([])
    expect(resolve(cfg({ segments: [seg('reset-5h')] }), EARLY)[0]).toEqual([])
  })

  it('mock 情境 now 消費：FULL 整顆直傳（結構子集含 now）→ diff 恆 2h、決定論存活', () => {
    const clock = formatResetsAt(FULL.data.rate_limits!.five_hour!.resets_at!)
    expect(resolve(cfg({ segments: [seg('reset-5h')] }), FULL)[0]).toEqual([
      { text: `↺ 2h (${clock})`, ariaText: `重置 2h (${clock})` },
    ])
  })

  it('存活形沿段內 composition（icon 頭部照常、aria 機械代換——含 value 部 ↺→重置，T4.2）', () => {
    const resetsAt = epochAt(14, 30)
    const runs = resolve(
      cfg({ segments: [seg('reset-5h', { icon: true })] }),
      inputAt(FULL, resetsAt - 7200, (d) => {
        d.rate_limits!.five_hour!.resets_at = resetsAt
      }),
    )[0]
    expect(runs).toEqual([
      { text: `${glyph('reset-5h')} ↺ 2h (14:30)`, ariaText: '5 小時限額重置倒數 重置 2h (14:30)' },
    ])
  })

  it('aria 代換範圍（T4.2）：label 零 ↺；使用者 prefix 通道字面保留不代換', () => {
    const resetsAt = epochAt(14, 30)
    const input = inputAt(FULL, resetsAt - 7200, (d) => {
      d.rate_limits!.five_hour!.resets_at = resetsAt
    })
    const bare = resolve(cfg({ segments: [seg('reset-5h')] }), input)[0]
    expect(toAriaLabel(bare)).toBe('重置 2h (14:30)')
    expect(toAriaLabel(bare)).not.toContain('↺')
    // prefix 為使用者通道：字面進 text 也字面進 aria（不代換）。
    const prefixed = resolve(cfg({ segments: [seg('reset-5h', { prefix: 'R:' })] }), input)[0]
    expect(prefixed).toEqual([{ text: 'R:↺ 2h (14:30)', ariaText: 'R:重置 2h (14:30)' }])
  })
})

// ── tokens 縮寫（T4.1；FormatKind 'tokens' 錨點） ──

describe('tokens 縮寫', () => {
  const tokenIn = (n: number) =>
    resolve(
      cfg({ segments: [seg('token-in')] }),
      inputWith(FULL, (d) => {
        d.context_window.current_usage!.input_tokens = n
      }),
    )[0]

  it('錨點：1234 → "1.2k"、999 → "999"、1500000 → "1500.0k"（僅 k 檔、全 floor）', () => {
    expect(tokenIn(1234)).toEqual([{ text: '1.2k' }])
    expect(tokenIn(999)).toEqual([{ text: '999' }])
    expect(tokenIn(1500000)).toEqual([{ text: '1500.0k' }])
  })

  it('formatTokens 邊界：1000 → "1.0k"、1099 → "1.0k"（floor 非 round）、0 → "0"', () => {
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(1099)).toBe('1.0k')
    expect(formatTokens(0)).toBe('0')
  })

  it('token-out 同 kind；null 走 dash 既有路徑（"--"）', () => {
    expect(
      resolve(
        cfg({ segments: [seg('token-out')] }),
        inputWith(FULL, (d) => {
          d.context_window.current_usage!.output_tokens = 8123
        }),
      )[0],
    ).toEqual([{ text: '8.1k' }])
    expect(resolve(cfg({ segments: [seg('token-in')] }), EARLY)[0]).toEqual([{ text: DASH_TEXT }])
  })
})

// ── cache-hit（T4.1；resolve 層斷言、inline 構造非 mock 情境依賴） ──

describe('cache-hit（resolve 層）', () => {
  it('全 0 → "0%"（公式分母 0 守門回 0；0 非死值、dash 政策下存活）', () => {
    const runs = resolve(
      cfg({ segments: [seg('cache-hit')] }),
      inputWith(FULL, (d) => {
        d.context_window.current_usage = {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        }
      }),
    )[0]
    expect(runs).toEqual([{ text: '0%' }])
  })
})

// ── bar 4-run（T4.2；08-PLAN Rev 4 §4——bytes＝S4 手寫目標值） ──
//
// 手寫 byte 常數逐案引自 sp4/verify.mjs（41/41 PASS 的 oracle 目標值；
// 該 spike 的 rows 為手構，本節以真 resolve 產出同形 rows 對拍）。桶色
// 票沿 spike 自訂形：buckets[i]＝ansi256(100+i)——bucketIndex(pct) 取桶
// 後恰等於 spike 的 bucketColor(pct)=100+⌊pct/10⌋（clamp [0,9]）。

const S4_BUCKETS: ThresholdRule = {
  buckets: [A(100), A(101), A(102), A(103), A(104), A(105), A(106), A(107), A(108), A(109)],
}
/** sp4 SEG_MAIN＝ansi256 244（灰階 #808080；autoFg 走黑端點 16）。 */
const SEG_MAIN = A(244)
const FILLED = (n: number) => BAR_FILLED_CHAR.repeat(n)
const EMPTY = (n: number) => BAR_EMPTY_CHAR.repeat(n)

describe('bar 4-run（T4.2；bytes＝S4 目標值）', () => {
  const barSeg = (over: Partial<SegmentConfig> = {}) =>
    seg('context-used', { bar: true, prefix: 'ctx:', color: SEG_MAIN, threshold: S4_BUCKETS, ...over })
  const usedAt = (p: number | null) =>
    inputWith(FULL, (d) => {
      d.context_window.used_percentage = p
    })

  it('S4 案1：bar 60% plain（2 段＋分隔符）——bytes 對拍手寫值', () => {
    const config = cfg({ segments: [seg('model', { color: A(15) }), barSeg()] })
    const input = inputWith(FULL, (d) => {
      d.model.display_name = 'M '
      d.context_window.used_percentage = 60
    })
    expect(toAnsi(resolve(config, input))).toBe(
      '\x1b[0m\x1b[38;5;15mM ' +
        '\x1b[0m|' +
        '\x1b[0m\x1b[38;5;244mctx:' +
        `\x1b[0m\x1b[38;5;106m${FILLED(12)}` +
        `\x1b[0m${EMPTY(8)}` +
        '\x1b[0m\x1b[38;5;106m 60%' +
        '\x1b[0m',
    )
  })

  it('S4 案2：bar 60% powerline arrow=true（2 段＋cap）；4-run 路徑停用 fgOverride', () => {
    const config = cfg({
      mode: 'powerline',
      segments: [
        seg('model', { color: A(33), fgOverride: A(15) }),
        // fgOverride 對 bar 段停用（PLAN §4 釘死）→ bytes 與無 override 全同
        // （head fg 恆 autoFg(244)=16、非 201）。
        barSeg({ fgOverride: A(201) }),
      ],
    })
    const input = inputWith(FULL, (d) => {
      d.model.display_name = 'M '
      d.context_window.used_percentage = 60
    })
    expect(toAnsi(resolve(config, input))).toBe(
      '\x1b[0m\x1b[38;5;15m\x1b[48;5;33mM ' +
        `\x1b[0m\x1b[38;5;33m\x1b[48;5;244m${POWERLINE_ARROW}` +
        '\x1b[0m\x1b[38;5;16m\x1b[48;5;244mctx:' +
        `\x1b[0m\x1b[38;5;106m\x1b[48;5;244m${FILLED(12)}` +
        `\x1b[0m\x1b[48;5;244m${EMPTY(8)}` +
        '\x1b[0m\x1b[38;5;106m\x1b[48;5;244m 60%' +
        `\x1b[0m\x1b[38;5;244m${POWERLINE_ARROW}` +
        '\x1b[0m',
    )
  })

  it('S4 案3：bar 60% powerline-noarrow（pad 併入 run4、無箭頭無 cap）', () => {
    const config = cfg({
      mode: 'powerline',
      powerlineArrow: false,
      segments: [seg('model', { color: A(33), fgOverride: A(15) }), barSeg()],
    })
    const input = inputWith(FULL, (d) => {
      d.model.display_name = 'M '
      d.context_window.used_percentage = 60
    })
    expect(toAnsi(resolve(config, input))).toBe(
      '\x1b[0m\x1b[38;5;15m\x1b[48;5;33mM  ' +
        '\x1b[0m\x1b[38;5;16m\x1b[48;5;244mctx:' +
        `\x1b[0m\x1b[38;5;106m\x1b[48;5;244m${FILLED(12)}` +
        `\x1b[0m\x1b[48;5;244m${EMPTY(8)}` +
        '\x1b[0m\x1b[38;5;106m\x1b[48;5;244m 60% ' +
        '\x1b[0m',
    )
  })

  it('S4 案4：bar 0% plain（head 空 → run1 空文字佔位；sp4 逐字手打 LITERAL）', () => {
    const rows = resolve(cfg({ segments: [barSeg({ prefix: undefined })] }), usedAt(0))
    expect(rows[0]).toHaveLength(4)
    expect(rows[0][0].text).toBe('') // 空佔位 run，維持 4-run 恆定形
    expect(toAnsi(rows)).toBe(
      '\x1b[0m\x1b[38;5;244m' +
        '\x1b[0m\x1b[38;5;100m' +
        '\x1b[0m' +
        EMPTY(20) +
        '\x1b[0m\x1b[38;5;100m 0%' +
        '\x1b[0m',
    )
  })

  it.each([
    [49, 9, 104],
    [50, 10, 105],
    [100, 20, 109],
  ])('S4 案5-7：bar %i%% plain——填格 %i、桶色 %i（數字錨點）', (pct, fill, bucket) => {
    const rows = resolve(cfg({ segments: [barSeg()] }), usedAt(pct))
    expect(rows[0][1].text).toBe(FILLED(fill))
    expect(toAnsi(rows)).toBe(
      '\x1b[0m\x1b[38;5;244mctx:' +
        `\x1b[0m\x1b[38;5;${bucket}m${FILLED(fill)}` +
        `\x1b[0m${EMPTY(BAR_CELL_COUNT - fill)}` +
        `\x1b[0m\x1b[38;5;${bucket}m ${pct}%` +
        '\x1b[0m',
    )
  })

  it('負值 → 0 格（填格 max(0,…) 下界 clamp；PLAN 數字錨點）', () => {
    const runs = resolve(cfg({ segments: [barSeg()] }), usedAt(-5))[0]
    expect(runs).toHaveLength(4)
    expect(runs[1].text).toBe('')
    expect(runs[2].text).toBe(EMPTY(20))
    expect(runs[3].text).toBe(' -5%')
  })

  it('M6 C2（撤 S4 案8a 舊定案）：bar null → 4-run（filled=0、empty=20、value=NA_TEXT，bucket 退段主色）', () => {
    const rows = resolve(cfg({ segments: [barSeg()] }), usedAt(null))
    expect(rows[0]).toEqual([
      { text: 'ctx:', fg: { kind: 'ansi256', index: 244 } },
      { text: '', ariaText: '', fg: { kind: 'ansi256', index: 244 } },
      { text: EMPTY(20), ariaText: '' },
      { text: ` ${NA_TEXT}`, fg: { kind: 'ansi256', index: 244 } },
    ])
    expect(toAnsi(rows)).toBe(
      '\x1b[0m\x1b[38;5;244mctx:' +
        '\x1b[0m\x1b[38;5;244m' +
        `\x1b[0m${EMPTY(20)}` +
        `\x1b[0m\x1b[38;5;244m ${NA_TEXT}` +
        '\x1b[0m',
    )
  })

  it('M6 C2（撤 S4 案8b 舊定案）：bar null powerline（單段＋cap）；4-run 路徑仍停用 fgOverride（S4 保守解讀定案不變）', () => {
    const config = cfg({ mode: 'powerline', segments: [barSeg({ fgOverride: A(201) })] })
    expect(toAnsi(resolve(config, usedAt(null)))).toBe(
      '\x1b[0m\x1b[38;5;16m\x1b[48;5;244mctx:' +
        '\x1b[0m\x1b[38;5;244m\x1b[48;5;244m' +
        `\x1b[0m\x1b[48;5;244m${EMPTY(20)}` +
        `\x1b[0m\x1b[38;5;244m\x1b[48;5;244m ${NA_TEXT}` +
        `\x1b[0m\x1b[38;5;244m${POWERLINE_ARROW}` +
        '\x1b[0m',
    )
  })

  it('M6 C2 a11y：bar×null 4-run label＝head aria + NA_TEXT（filled/empty 空 ariaText 不進 label）', () => {
    const runs = resolve(
      cfg({ segments: [barSeg({ icon: true, prefix: undefined })] }),
      usedAt(null),
    )[0]
    expect(runs).toHaveLength(4)
    expect(runs[1]).toEqual({ text: '', ariaText: '', fg: { kind: 'ansi256', index: 244 } })
    expect(runs[2]).toEqual({ text: EMPTY(20), ariaText: '' })
    expect(toAriaLabel(runs)).toBe(`上下文已用 ${NA_TEXT}`)
    expect(toAriaLabel(runs)).not.toMatch(/[█░]/)
  })

  it('M6 C3＋S4 案9：percent-reset × bar——run4＝" 60% ↺ 2h (14:30)" 單一運算式（倒數後綴併入 run4）', () => {
    const config = cfg({
      segments: [
        seg('rate-5h', {
          bar: true,
          variant: 'percent-reset',
          prefix: 'ctx:',
          color: SEG_MAIN,
          threshold: S4_BUCKETS,
        }),
      ],
    })
    const resetsAt = epochAt(14, 30)
    const input = inputAt(FULL, resetsAt - 2 * 3600, (d) => {
      d.rate_limits!.five_hour!.used_percentage = 60
      d.rate_limits!.five_hour!.resets_at = resetsAt
    })
    const rows = resolve(config, input)
    expect(rows[0][3]).toEqual({
      text: ' 60% ↺ 2h (14:30)',
      ariaText: ' 60% 重置 2h (14:30)',
      fg: { kind: 'ansi256', index: 106 },
    })
    expect(toAnsi(rows)).toBe(
      '\x1b[0m\x1b[38;5;244mctx:' +
        `\x1b[0m\x1b[38;5;106m${FILLED(12)}` +
        `\x1b[0m${EMPTY(8)}` +
        '\x1b[0m\x1b[38;5;106m 60% ↺ 2h (14:30)' +
        '\x1b[0m',
    )
  })

  it('threshold undefined × bar（手改存檔可達）：filled／pct 退段主色、run3 仍無 fg、結構仍 4-run（S4 REPORT 縫隙 2 釘死）', () => {
    const rows = resolve(cfg({ segments: [barSeg({ threshold: undefined })] }), usedAt(60))
    expect(rows[0]).toEqual([
      { text: 'ctx:', fg: { kind: 'ansi256', index: 244 } },
      { text: FILLED(12), ariaText: '', fg: { kind: 'ansi256', index: 244 } },
      { text: EMPTY(8), ariaText: '' },
      { text: ' 60%', fg: { kind: 'ansi256', index: 244 } },
    ])
  })

  it('a11y：filled／empty 顯式 ariaText=""；label 由 head aria＋run4 數值承載、零方塊字', () => {
    const runs = resolve(
      cfg({ segments: [barSeg({ icon: true, prefix: undefined })] }),
      usedAt(60),
    )[0]
    expect(runs).toEqual([
      { text: `${glyph('context-used')} `, ariaText: '上下文已用', fg: { kind: 'ansi256', index: 244 } },
      { text: FILLED(12), ariaText: '', fg: { kind: 'ansi256', index: 106 } },
      { text: EMPTY(8), ariaText: '' },
      { text: ' 60%', fg: { kind: 'ansi256', index: 106 } },
    ])
    expect(toAriaLabel(runs)).toBe('上下文已用 60%')
    expect(toAriaLabel(runs)).not.toMatch(/[█░]/)
  })

  it('run 形（powerline）：bg 全段均一＝段主色（非桶色）、run3 無 fg（default 即便 bg 有值）、箭頭交接取段主色', () => {
    const config = cfg({
      mode: 'powerline',
      segments: [seg('model', { color: A(33) }), barSeg()],
    })
    const runs = resolve(config, usedAt(60))[0]
    // [model, 箭頭, head, filled, empty, value, cap]＝7 run
    expect(runs).toHaveLength(7)
    expect(runs[1]).toEqual({
      text: POWERLINE_ARROW,
      ariaText: '',
      fg: { kind: 'ansi256', index: 33 },
      bg: { kind: 'ansi256', index: 244 },
    })
    expect(runs.slice(2, 6).map((r) => r.bg)).toEqual([
      { kind: 'ansi256', index: 244 },
      { kind: 'ansi256', index: 244 },
      { kind: 'ansi256', index: 244 },
      { kind: 'ansi256', index: 244 },
    ])
    expect(runs[4].fg).toBeUndefined()
    expect(runs[6]).toEqual({ text: POWERLINE_ARROW, ariaText: '', fg: { kind: 'ansi256', index: 244 } })
  })

  it('非 percentage 段 bar → 忽略（沿閾值慣例——config 清洗本就限 barEligibleIds）', () => {
    expect(resolve(cfg({ segments: [seg('model', { bar: true })] }), FULL)[0]).toEqual([
      { text: 'Fable 5' },
    ])
  })
})

// ── auto 配色展開（T4.2；08-PLAN Rev 4 §3 palette 查表） ──

describe('auto 配色展開', () => {
  const AUTO = { kind: 'auto' } as const

  it.each([
    ['claude-fable-5', 214],
    ['claude-opus-4-8', 135],
    ['claude-haiku-4-5-20251001', 2],
    ['claude-sonnet-5', 6],
    ['mystery-model-x', 6], // 未知 fallback＝Sonnet 同值 6
    ['CLAUDE-OPUS-4', 6], // 大小寫敏感 startsWith——大寫不匹配、落 fallback
  ])('model palette：id=%s → ansi256 %i（plain 作 fg）', (id, index) => {
    const rows = resolve(
      cfg({ segments: [seg('model', { color: AUTO })] }),
      inputWith(FULL, (d) => {
        d.model.id = id
      }),
    )
    expect(rows[0][0].fg).toEqual({ kind: 'ansi256', index })
  })

  it.each([
    ['low', 3],
    ['medium', 2],
    ['high', 4],
    ['xhigh', 5],
    ['max', 15],
    ['extreme', 9], // unknown 值 → 9（亮紅）
  ])('effort palette：level=%s → ansi256 %i（key 缺省＝主值本身）', (level, index) => {
    const rows = resolve(
      cfg({ segments: [seg('effort', { color: AUTO })] }),
      inputWith(FULL, (d) => {
        d.effort = { level }
      }),
    )
    expect(rows[0][0].fg).toEqual({ kind: 'ansi256', index })
  })

  it('effort 欄位缺席 → 整段 hide（nullPolicy 既有路徑；無「無欄位→灰」分支）', () => {
    expect(resolve(cfg({ segments: [seg('effort', { color: AUTO })] }), COND)[0]).toEqual([])
  })

  it('S4 案10 對應：auto(opus→135) × powerline arrow＋cap——autoFg 對展開後 index（autoFg(135)=16）', () => {
    const config = cfg({ mode: 'powerline', segments: [seg('model', { color: AUTO })] })
    const rows = resolve(config, WIN) // WIN model.id='claude-opus-4-8' → 135
    expect(rows[0]).toEqual([
      { text: 'Opus 4.8', fg: { kind: 'ansi256', index: 16 }, bg: { kind: 'ansi256', index: 135 } },
      { text: POWERLINE_ARROW, ariaText: '', fg: { kind: 'ansi256', index: 135 } },
    ])
    expect(toAnsi(rows)).toBe(
      '\x1b[0m\x1b[38;5;16m\x1b[48;5;135mOpus 4.8' +
        `\x1b[0m\x1b[38;5;135m${POWERLINE_ARROW}` +
        '\x1b[0m',
    )
  })

  it('S4 案11 對應：auto(opus→135) × powerline-noarrow——pad 併入段 run、無箭頭無 cap', () => {
    const config = cfg({
      mode: 'powerline',
      powerlineArrow: false,
      segments: [seg('model', { color: AUTO })],
    })
    expect(toAnsi(resolve(config, WIN))).toBe('\x1b[0m\x1b[38;5;16m\x1b[48;5;135mOpus 4.8 \x1b[0m')
  })

  it('auto 落在無 autoColor 通道之段 → TypeError（config 應先經 deserializeConfig 清洗）', () => {
    expect(() => resolve(cfg({ segments: [seg('cost', { color: AUTO })] }), FULL)).toThrow(TypeError)
  })
})

// ── path variants／env 通道 ──

describe('path／env 通道', () => {
  it('tilde 用 env.home 縮寫', () => {
    expect(resolve(cfg({ segments: [seg('cwd', { variant: 'tilde' })] }), FULL)[0]).toEqual([
      { text: '~/projects/ClientKit' },
    ])
  })

  it('basename：反斜線＋CJK 路徑', () => {
    expect(resolve(cfg({ segments: [seg('cwd', { variant: 'basename' })] }), WIN)[0]).toEqual([
      { text: 'ClientKit 工作區' },
    ])
  })
})

// ── aria-label（§預覽契約；.t17 §4 形） ──

describe('toAriaLabel', () => {
  it('icons 全開＋powerline：零 PUA、箭頭不進 label、.t17 形', () => {
    const config = cfg({
      mode: 'powerline',
      segments: [
        seg('model', { icon: true, color: A(27) }),
        seg('cwd', { icon: true, variant: 'tilde', color: A(33) }),
        seg('git-branch', { icon: true, color: A(99) }),
        seg('context-used', { icon: true, threshold: TRAFFIC, color: A(240) }),
        seg('cost', { color: A(226) }),
      ],
    })
    const runs = resolve(config, FULL)[0]
    const label = toAriaLabel(runs)
    expect(label).toBe(
      `模型 Fable 5 目前目錄 ~/projects/ClientKit 分支 DEV 上下文已用 42% ${formatCost(3.3341)}`,
    )
    expect(containsPua(label)).toBe(false)
    expect(label).not.toContain(POWERLINE_ARROW)
    expect(runs[0].ariaText).toBe('模型 Fable 5')
  })

  it('plain：分隔符（ariaText=""）不進 label；純文字 run fallback text', () => {
    const runs = resolve(cfg({ segments: [seg('model'), seg('cost')] }), EARLY)[0]
    expect(toAriaLabel(runs)).toBe('Sonnet 5 $0.0000')
  })

  it('NA_TEXT 值以字面 "(n/a)" 進 label（值的文字等價；M6 C1 百分比段 dash-null 顯示形）', () => {
    const runs = resolve(cfg({ segments: [seg('context-used', { icon: true })] }), EARLY)[0]
    expect(toAriaLabel(runs)).toBe(`上下文已用 ${NA_TEXT}`)
  })

  it('空 runs → ""；全空白 fallback chunk 剔除', () => {
    expect(toAriaLabel([])).toBe('')
    expect(toAriaLabel([{ text: '   ' }])).toBe('')
  })

  it('負向：PUA run 省略 ariaText → TypeError（fallback 僅限純文字 run；PUA_RE 行為未變——M1.5 icon' +
    ' 前綴化後 segment glyph 為純 ASCII、不再是 PUA，改用 POWERLINE_ARROW 驗證 PUA_RE 本身，見 PLAN D1 Round 2）', () => {
    expect(() => toAriaLabel([{ text: `${POWERLINE_ARROW} DEV` }])).toThrow(TypeError)
  })

  it('負向：顯式 ariaText 夾帶 PUA → TypeError（結果零 PUA 機械斷言）', () => {
    expect(() => toAriaLabel([{ text: 'x', ariaText: POWERLINE_ARROW }])).toThrow(TypeError)
  })

  it('正向：非 PUA 高碼位（astral，非 icon glyph 來源）放行——不觸發 PUA enforcement（validate.ts' +
    ' 明文放行政策不變；MAGI code review 2026-07-11 R1 修訂：M1.5 icon.glyph 已全數改純 ASCII' +
    ' 前綴，`glyph()` helper 不再能覆蓋此案，改以顯式 astral 字元恢復原始覆蓋意圖）', () => {
    // U+1F331（🌱，surrogate pair）：一般 emoji 平面，非 PUA_RE 涵蓋的 BMP／補充私用平面
    // 區段（U+E000–F8FF／U+F0000–FFFFD／U+100000–10FFFD）——驗證 /u regex 對 astral
    // 碼位（非 BMP、以 surrogate pair 表示）判定正確、不誤傷。
    const astral = '\u{1F331}'
    // icon run 形：顯式 ariaText（resolve 實際產生形）——不拋。
    const iconRun = { text: `${astral} DEV`, ariaText: '分支 DEV' }
    expect(() => toAriaLabel([iconRun])).not.toThrow()
    expect(toAriaLabel([iconRun])).toBe('分支 DEV')
    // 純文字 run：省略 ariaText、text 含該高碼位——containsPua 對其恆 false，走 fallback
    // text，不拋。
    const plainRun = { text: `${astral} 待辦事項` }
    expect(() => toAriaLabel([plainRun])).not.toThrow()
    expect(toAriaLabel([plainRun])).toBe(`${astral} 待辦事項`)
  })
})

// ── 多列語意（T2.3；PLAN §D2／§多列輸出的引擎契約） ──

describe('多列語意', () => {
  it('亂序 row（5,2,9）→ 渲染列序升冪壓縮（3 列、內容對應 2→5→9）', () => {
    const config = cfg({
      segments: [
        seg('model', { row: 9 }),
        seg('cost', { row: 2 }),
        seg('git-branch', { row: 5 }),
      ],
    })
    const rows = resolve(config, FULL)
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.map((r) => r.text))).toEqual([
      [formatCost(3.3341)],
      ['DEV'],
      ['Fable 5'],
    ])
  })

  it('中間列全滅壓縮：三列 config、中列段全部 hide → 回傳 2 列、無空列', () => {
    const config = cfg({
      segments: [
        seg('model', { row: 0 }),
        seg('session-name', { row: 1 }),
        seg('vim-mode', { row: 1 }),
        seg('cost', { row: 2 }),
      ],
    })
    const rows = resolve(config, EARLY)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.map((r) => r.text))).toEqual([['Sonnet 5'], ['$0.0000']])
  })

  it('全滅 [[]]：全段 hide（分佈於相異列）→ resolve 回傳 [[]]，toAnsi 單一 reset 不變量保留', () => {
    const config = cfg({
      segments: [
        seg('session-name', { row: 0 }),
        seg('vim-mode', { row: 1 }),
        seg('agent-name', { row: 2 }),
      ],
    })
    const rows = resolve(config, EARLY)
    expect(rows).toEqual([[]])
    expect(toAnsi(rows)).toBe('\x1b[0m')
  })

  it('default config（無 row）與清洗後 config（row 全為 0）列分佈一致', () => {
    const base = defaultConfig(SEGMENT_CATALOG)
    const withoutRow: BuilderConfig = {
      ...base,
      segments: base.segments.map((s) =>
        s.id === 'model' || s.id === 'cost' ? { ...s, enabled: true } : s,
      ),
    }
    expect(withoutRow.segments.find((s) => s.id === 'model')?.row).toBeUndefined()
    expect(withoutRow.segments.find((s) => s.id === 'cost')?.row).toBeUndefined()

    // 模擬「顯式 row:0」存檔經 deserializeConfig 清洗後的形——sanitizeRow(0,…)
    // 保留顯式 0（非缺席），驗證分組鍵 `seg.row ?? 0` 使兩形列分佈等價。
    const dirty = {
      ...withoutRow,
      segments: withoutRow.segments.map((s) => (s.enabled ? { ...s, row: 0 } : s)),
    }
    const cleaned = deserializeConfig(JSON.stringify(dirty), SEGMENT_CATALOG)
    expect(cleaned.segments.find((s) => s.id === 'model')?.row).toBe(0)
    expect(cleaned.segments.find((s) => s.id === 'cost')?.row).toBe(0)

    expect(resolve(withoutRow, FULL)).toEqual(resolve(cleaned, FULL))
  })

  it('cap×gating×多列組合：powerlineArrow=true 每列各自 lastArrowCap；false 時無 cap、每列末段右 padding 不變', () => {
    const config = cfg({
      mode: 'powerline',
      lastArrowCap: true,
      powerlineArrow: true,
      segments: [
        seg('model', { color: A(226), row: 0 }),
        seg('git-branch', { color: A(240), row: 0 }),
        seg('cost', { color: A(16), row: 1 }),
        seg('context-used', { color: A(45), row: 1 }),
      ],
    })
    const capped = resolve(config, FULL)
    expect(capped).toHaveLength(2)
    expect(capped[0].map((r) => r.text)).toEqual(['Fable 5', POWERLINE_ARROW, 'DEV', POWERLINE_ARROW])
    expect(capped[1].map((r) => r.text)).toEqual([
      formatCost(3.3341),
      POWERLINE_ARROW,
      '42%',
      POWERLINE_ARROW,
    ])

    const noArrow: BuilderConfig = { ...config, powerlineArrow: false }
    const rows = resolve(noArrow, FULL)
    expect(rows).toHaveLength(2)
    expect(rows[0].map((r) => r.text)).toEqual(['Fable 5 ', 'DEV '])
    expect(rows[1].map((r) => r.text)).toEqual([`${formatCost(3.3341)} `, '42% '])
    expect(rows.flat().some((r) => r.text === POWERLINE_ARROW)).toBe(false)
  })

  it('多列 aria：逐列呼叫 toAriaLabel 各列 label 正確（無前綴）', () => {
    const config = cfg({
      segments: [seg('model', { icon: true, row: 0 }), seg('cost', { row: 1 })],
    })
    const rows = resolve(config, EARLY)
    expect(rows).toHaveLength(2)
    expect(toAriaLabel(rows[0])).toBe(`${DESCRIPTORS_BY_ID.model.icon.ariaText} Sonnet 5`)
    expect(toAriaLabel(rows[1])).toBe('$0.0000')
  })

  it('resolve() 回傳長度恆 ≥1（永不 []）——含全滅與多列存活情境', () => {
    const allDead = cfg({
      segments: [
        seg('session-name', { row: 0 }),
        seg('vim-mode', { row: 1 }),
        seg('agent-name', { row: 2 }),
      ],
    })
    const dead = resolve(allDead, EARLY)
    expect(dead.length).toBeGreaterThanOrEqual(1)
    expect(dead).toEqual([[]])

    const alive = cfg({ segments: [seg('model', { row: 0 }), seg('cost', { row: 5 })] })
    const rows = resolve(alive, FULL)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows).toHaveLength(2)
  })
})

// ── rowSeparators 啟用位映射（T1.3，09-PLAN §D1 A-1；resolve 消費點） ──
//
// 索引基準＝「config 正規化後的啟用列位」：全部 enabled 段（不論本次
// resolve 存活與否）的相異 row 值升冪去重位置，與 renderRowOrder（執行期
// 存活列緊縮序）分開計算——見 resolve.ts 檔頭「rowSeparators 啟用位映射」
// 節。以下對位案專測兩基準分岔時（整列執行期死亡）不得混淆。

describe('rowSeparators 啟用位映射', () => {
  const sepPreset = (value: '|' | '›' | '·' | ' '): SeparatorConfig => ({ kind: 'preset', value })

  it('多列 plain＋第 2 列覆寫「›」：該列以覆寫 join、其他列用全域「|」', () => {
    const config = cfg({
      rowSeparators: [null, sepPreset('›')],
      segments: [
        seg('model', { row: 0 }),
        seg('cost', { row: 0 }),
        seg('git-branch', { row: 1 }),
        seg('clock', { row: 1 }),
      ],
    })
    const rows = resolve(config, FULL)
    expect(rows).toHaveLength(2)
    expect(rows[0].map((r) => r.text)).toEqual(['Fable 5', '|', formatCost(3.3341)])
    expect(rows[1].map((r) => r.text)).toEqual(['DEV', '›', '09:05'])
  })

  it(
    '整列執行期死亡對位案：3 啟用列，第 1 列（啟用位 0）全段死亡、第 3 列' +
      '（啟用位 2）有覆寫——存活輸出的最後一列須用啟用位 2 的覆寫，非存活位 1',
    () => {
      const config = cfg({
        rowSeparators: [sepPreset('·'), null, sepPreset('›')],
        segments: [
          // 啟用位 0：hide 政策段，於 EARLY 全滅（比照既有「全滅」多列案）。
          seg('session-name', { row: 0 }),
          seg('vim-mode', { row: 0 }),
          // 啟用位 1：dash 政策段恆存活（顯 NA_TEXT），rowSeparators[1]=null。
          seg('context-used', { row: 1 }),
          seg('context-remaining', { row: 1 }),
          // 啟用位 2：shell／cost 段於 EARLY 存活，rowSeparators[2]='›' 覆寫。
          seg('git-branch', { row: 2 }),
          seg('cost', { row: 2 }),
        ],
      })
      const rows = resolve(config, EARLY)
      // 第 1 列（啟用位 0）整列死亡，渲染列僅剩 2 列（原啟用位 1／2）。
      expect(rows).toHaveLength(2)
      // 存活第 1 列＝原啟用位 1（rowSeparators[1]=null → 全域 '|'）。
      expect(rows[0].map((r) => r.text)).toEqual([NA_TEXT, '|', NA_TEXT])
      // 存活第 2 列（最後一列）＝原啟用位 2（rowSeparators[2]='›' 覆寫）——
      // 若誤用存活位 1（如直接 .map 迭代 index）會退回 rowSeparators[1]=null
      // ＝全域 '|'，本斷言即失敗。
      expect(rows[1].map((r) => r.text)).toEqual(['main', '›', '$0.0000'])
    },
  )

  it('缺項／null／無此欄 → 全域分隔符', () => {
    const twoRows = (over: Partial<BuilderConfig> = {}) =>
      cfg({
        segments: [
          seg('model', { row: 0 }),
          seg('cost', { row: 0 }),
          seg('git-branch', { row: 1 }),
          seg('clock', { row: 1 }),
        ],
        ...over,
      })
    // 無此欄。
    expect(resolve(twoRows(), FULL)[0].map((r) => r.text)).toEqual(['Fable 5', '|', formatCost(3.3341)])
    // 全 null。
    expect(resolve(twoRows({ rowSeparators: [null, null] }), FULL)[1].map((r) => r.text)).toEqual([
      'DEV',
      '|',
      '09:05',
    ])
    // 陣列過短（越界索引 → undefined）。
    expect(resolve(twoRows({ rowSeparators: [sepPreset('·')] }), FULL)[1].map((r) => r.text)).toEqual([
      'DEV',
      '|',
      '09:05',
    ])
  })

  it('powerline 模式：rowSeparators 存在時輸出與無此欄完全相同（分支零觸碰，天然忽略）', () => {
    const segments = [
      seg('model', { color: A(226), row: 0 }),
      seg('cost', { color: A(16), row: 0 }),
      seg('git-branch', { color: A(240), row: 1 }),
    ]
    const without = cfg({ mode: 'powerline', powerlineArrow: true, segments })
    const withOverride = cfg({
      mode: 'powerline',
      powerlineArrow: true,
      rowSeparators: [sepPreset('›'), sepPreset('·')],
      segments,
    })
    expect(resolve(withOverride, FULL)).toEqual(resolve(without, FULL))
  })
})

// ── locale 注入（T5.3；ResolveInput.locale，選填、預設 zh-Hant） ──

describe('locale 注入（ResolveInput.locale）', () => {
  it('缺省 locale＝顯式 zh-Hant 等價（DEFAULT_LOCALE 相容錨點，byte 級）', () => {
    const config = cfg({ segments: [seg('reset-5h', { icon: true })] })
    const resetsAt = epochAt(14, 30)
    const base = inputAt(FULL, resetsAt - 7200, (d) => {
      d.rate_limits!.five_hour!.resets_at = resetsAt
    })
    expect(resolve(config, base)).toEqual(resolve(config, { ...base, locale: 'zh-Hant' }))
  })

  it('en：icon run ariaText 走 segmentAriaText(id, "en")（非 zh-Hant 固定字面）', () => {
    const runs = resolve(cfg({ segments: [seg('model', { icon: true })] }), { ...FULL, locale: 'en' })[0]
    expect(runs[0].ariaText).toBe(`${segmentAriaText('model', 'en')} Fable 5`)
    expect(runs[0].ariaText).toBe('Model Fable 5')
  })

  it('en：倒數段（reset-5h）value ariaText 代換詞＝t("en").resetAriaWord="reset"（非「重置」）', () => {
    const resetsAt = epochAt(14, 30)
    const runs = resolve(
      cfg({ segments: [seg('reset-5h')] }),
      {
        ...inputAt(FULL, resetsAt - 7200, (d) => {
          d.rate_limits!.five_hour!.resets_at = resetsAt
        }),
        locale: 'en',
      },
    )[0]
    expect(runs).toEqual([{ text: '↺ 2h (14:30)', ariaText: 'reset 2h (14:30)' }])
  })

  it('en：percent-reset 後綴（rate-5h）aria 代換詞同為 "reset"（M6 C4 locale 感知）', () => {
    const resetsAt = epochAt(14, 30)
    const runs = resolve(
      cfg({ segments: [seg('rate-5h', { variant: 'percent-reset' })] }),
      {
        ...inputAt(FULL, resetsAt - 2 * 3600, (d) => {
          d.rate_limits!.five_hour!.used_percentage = 63.2
          d.rate_limits!.five_hour!.resets_at = resetsAt
        }),
        locale: 'en',
      },
    )[0]
    expect(runs).toEqual([{ text: '63% ↺ 2h (14:30)', ariaText: '63% reset 2h (14:30)' }])
  })

  it('en：text 主文字通道不受 locale 影響（僅 aria-label 組裝分岔，主值格式化與腳本輸出無關）', () => {
    const zh = resolve(cfg({ segments: [seg('model'), seg('cost')] }), FULL)[0]
    const en = resolve(cfg({ segments: [seg('model'), seg('cost')] }), { ...FULL, locale: 'en' })[0]
    expect(en.map((r) => r.text)).toEqual(zh.map((r) => r.text))
  })
})

// ── 防禦邊界 ──

describe('防禦邊界', () => {
  it('未知 segment id → TypeError（config 應先經清洗）', () => {
    expect(() => resolve(cfg({ segments: [seg('nope')] }), FULL)).toThrow(TypeError)
  })

  it('停用段不參與', () => {
    expect(resolve(cfg({ segments: [seg('model', { enabled: false })] }), FULL)[0]).toEqual([])
  })

  it('深凍結 mock 情境可整顆直傳；重複呼叫等值（純函式）', () => {
    const config = cfg({
      segments: [seg('model'), seg('context-used', { threshold: TRAFFIC, color: A(240) })],
    })
    expect(resolve(config, FULL)).toEqual(resolve(config, FULL))
  })
})
