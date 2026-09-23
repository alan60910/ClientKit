// @vitest-environment jsdom
/**
 * T1.4（(internal design doc) §前置加固／§D-d）：
 * `renderRuns`（及其相依的 DOM 組裝，見 render-preview.ts buildRunSpan）
 * spec→DOM 回歸網。D-d 裁決：既有「browser-only DOM 模組不強制 node
 * 測試」政策修訂為「以 per-file `// @vitest-environment jsdom` 局部補
 * 測」；本檔與既有 `render-preview.test.ts`（node、純函式接縫——
 * runInlineColors／runRenderSpec／buildPreviewSpec／themeModifierClass）
 * 互補分工：該檔測「規格怎麼算」，本檔測「規格怎麼落地成 DOM」。
 *
 * 06c（M4/M5）將對 bar／倒數／auto 大改 renderRuns 消費的 run 形，本檔
 * 先鋪好結構／className／aria 斷言，供後續改動回歸比對。
 */
import { describe, expect, it } from 'vitest'
import { colorSpecToHex, hexToRgb } from './color.js'
import type { BuilderConfig } from './config.js'
import { MOCK_SCENARIOS_BY_ID } from './mock-data.js'
import {
  BAR_CELL_COUNT,
  BAR_EMPTY_CHAR,
  BAR_FILLED_CHAR,
  NA_TEXT,
  POWERLINE_ARROW,
  resolve,
  toAriaLabel,
  type StyledRun,
} from './resolve.js'
import { formatResetsAt } from './segments.js'
import { THRESHOLD_TEMPLATES } from './threshold.js'
import {
  EMPTY_PREVIEW_LABEL,
  PREVIEW_ARROW_CLASS,
  PREVIEW_GROUP_LABEL,
  renderRuns,
} from './render-preview.js'

/**
 * jsdom 的 CSSStyleDeclaration 會把 `style.color = '#rrggbb'` 正規化為
 * `rgb(r, g, b)` 字串（實測見 (internal design doc) T1.4 dispatch），故斷言 inline
 * color/backgroundColor 時需經同一正規化，不能直接比對 hex 字面。CSS
 * 自訂屬性（`--arrow-fg`）則不受此正規化影響，原樣保留 hex。
 */
function hexToRgbCss(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgb(${r}, ${g}, ${b})`
}

describe('renderRuns — 一般文字 run（PLAN §前置加固 a）', () => {
  it('建立 <span>，textContent＝run.text，fg/bg 依 runInlineColors 掛 inline color/backgroundColor（ansi256→hex）', () => {
    const container = document.createElement('div')
    const run: StyledRun = {
      text: 'Sonnet 5',
      fg: { kind: 'ansi256', index: 196 },
      bg: { kind: 'truecolor', hex: '#123456' },
    }
    renderRuns(container, [[run]])

    const span = container.querySelector('span')
    expect(span).not.toBeNull()
    expect(span!.tagName).toBe('SPAN')
    expect(span!.textContent).toBe('Sonnet 5')
    expect(span!.className).toBe('')
    expect(span!.getAttribute('aria-hidden')).toBe('true')
    expect(span!.style.color).toBe(hexToRgbCss(colorSpecToHex(run.fg!)!))
    expect(span!.style.backgroundColor).toBe(hexToRgbCss(colorSpecToHex(run.bg!)!))
  })

  it('fg/bg 缺席或 default → 不落 color/backgroundColor 屬性（沿用終端框基底）', () => {
    const bare = document.createElement('div')
    renderRuns(bare, [[{ text: 'plain' }]])
    const bareSpan = bare.querySelector('span')!
    expect(bareSpan.style.color).toBe('')
    expect(bareSpan.style.backgroundColor).toBe('')

    const explicit = document.createElement('div')
    renderRuns(explicit, [[{ text: 'x', fg: { kind: 'default' }, bg: { kind: 'default' } }]])
    const explicitSpan = explicit.querySelector('span')!
    expect(explicitSpan.style.color).toBe('')
    expect(explicitSpan.style.backgroundColor).toBe('')
  })
})

describe('renderRuns — powerline 箭頭 run（PLAN §前置加固 b）', () => {
  it('text===POWERLINE_ARROW → 不落文字節點、帶 PREVIEW_ARROW_CLASS、aria-hidden，--arrow-fg CSS 變數＝fg 對應 hex', () => {
    const container = document.createElement('div')
    const run: StyledRun = {
      text: POWERLINE_ARROW,
      ariaText: '',
      fg: { kind: 'truecolor', hex: '#112233' },
      bg: { kind: 'truecolor', hex: '#445566' },
    }
    renderRuns(container, [[run]])

    const span = container.querySelector('span')!
    expect(span.childNodes).toHaveLength(0)
    expect(span.textContent).toBe('')
    expect(span.className).toBe(PREVIEW_ARROW_CLASS)
    expect(span.getAttribute('aria-hidden')).toBe('true')
    expect(span.style.getPropertyValue('--arrow-fg')).toBe('#112233')
    expect(span.style.backgroundColor).toBe(hexToRgbCss('#445566'))
  })

  it('fg 缺席 → 不設 --arrow-fg CSS 變數（style.css fallback 讀 currentColor）', () => {
    const container = document.createElement('div')
    const run: StyledRun = { text: POWERLINE_ARROW, ariaText: '' }
    renderRuns(container, [[run]])

    const span = container.querySelector('span')!
    expect(span.className).toBe(PREVIEW_ARROW_CLASS)
    expect(span.style.getPropertyValue('--arrow-fg')).toBe('')
    expect(span.style.backgroundColor).toBe('')
  })

  it('cap 箭頭（無 bg）→ 不落 backgroundColor（透明，退回終端底色）', () => {
    const container = document.createElement('div')
    const run: StyledRun = { text: POWERLINE_ARROW, ariaText: '', fg: { kind: 'ansi256', index: 16 } }
    renderRuns(container, [[run]])

    const span = container.querySelector('span')!
    expect(span.style.backgroundColor).toBe('')
    expect(span.style.getPropertyValue('--arrow-fg')).toBe(colorSpecToHex(run.fg!)!)
  })
})

describe('renderRuns — 逐列容器結構＋a11y（PLAN §前置加固 c，buildPreviewSpec 消費端）', () => {
  it('外層 container 帶 role=group＋PREVIEW_GROUP_LABEL；每列子容器 role=img＋aria-label="第 N 列：…"', () => {
    const container = document.createElement('div')
    const rowA: StyledRun[] = [{ text: 'a', ariaText: 'Row A' }]
    const rowB: StyledRun[] = [{ text: 'b', ariaText: 'Row B' }]
    renderRuns(container, [rowA, rowB])

    expect(container.getAttribute('role')).toBe('group')
    expect(container.getAttribute('aria-label')).toBe(PREVIEW_GROUP_LABEL)

    const rowEls = container.children
    expect(rowEls).toHaveLength(2)
    expect(rowEls[0]!.getAttribute('role')).toBe('img')
    expect(rowEls[0]!.getAttribute('aria-label')).toBe(`第 1 列：${toAriaLabel(rowA)}`)
    expect(rowEls[1]!.getAttribute('role')).toBe('img')
    expect(rowEls[1]!.getAttribute('aria-label')).toBe(`第 2 列：${toAriaLabel(rowB)}`)

    // 列內 run 各自渲染為裝飾 span，不重複承載 aria-label（由父容器承載）。
    expect(rowEls[0]!.querySelectorAll('span')).toHaveLength(1)
    expect(rowEls[1]!.querySelectorAll('span')).toHaveLength(1)
  })

  it('`[[]]`（resolve 全隱藏退化）→ 單一子容器承載 EMPTY_PREVIEW_LABEL（不加「第 N 列」前綴）', () => {
    const container = document.createElement('div')
    renderRuns(container, [[]])

    expect(container.getAttribute('role')).toBe('group')
    expect(container.getAttribute('aria-label')).toBe(PREVIEW_GROUP_LABEL)

    const rowEls = container.children
    expect(rowEls).toHaveLength(1)
    const rowEl = rowEls[0]!
    expect(rowEl.getAttribute('role')).toBe('img')
    expect(rowEl.getAttribute('aria-label')).toBe(EMPTY_PREVIEW_LABEL)
    expect(rowEl.getAttribute('aria-label')).not.toMatch(/^第 \d+ 列/)
    expect(rowEl.children).toHaveLength(0)
  })

  it('第二次 renderRuns 呼叫 replaceChildren 舊列（不殘留前次渲染節點）', () => {
    const container = document.createElement('div')
    renderRuns(container, [[{ text: 'first' }], [{ text: 'second' }]])
    expect(container.children).toHaveLength(2)

    renderRuns(container, [[{ text: 'only' }]])
    expect(container.children).toHaveLength(1)
    expect(container.querySelector('span')!.textContent).toBe('only')
  })
})

// T1.4 的 TODO 錨點於 M4 T4.2 補實（(internal design doc) PLAN §4 a11y）：bar 4-run 已於
// resolve.ts 落地（run2 filled／run3 empty 顯式 ariaText=''），此處斷言
// renderRuns 落 DOM 後方塊字不洩漏至 AT——run span 恆 aria-hidden、列
// aria-label（toAriaLabel 消費 ariaText）零 █░、數值語意由 run4 承載。
describe('renderRuns — bar run 的 ariaText（M4 T4.2 補實）', () => {
  it('bar filled/empty run 的 ariaText 為空字串：DOM span aria-hidden、列 aria-label 不洩漏方塊字', () => {
    // 真 resolve 產出 bar 4-run（非手構 run）——與 resolve.test.ts 的 S4
    // bytes 案同源展開。FULL used_percentage=42.5 → 填格 floor(42.5/5)=8。
    const FULL = MOCK_SCENARIOS_BY_ID['full']
    const config: BuilderConfig = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [
        {
          id: 'context-used',
          enabled: true,
          icon: true,
          color: { kind: 'default' },
          threshold: THRESHOLD_TEMPLATES.traffic,
          bar: true,
        },
      ],
    }
    const rows = resolve(config, FULL)
    const runs = rows[0]
    expect(runs).toHaveLength(4)
    expect(runs[1].text).toBe(BAR_FILLED_CHAR.repeat(8))
    expect(runs[2].text).toBe(BAR_EMPTY_CHAR.repeat(12))
    // 寬度 20 格（filled+empty 合計，BAR_CELL_COUNT）——與 resolve.ts bar 4-run
    // 契約同源，不在 render-preview 側另行計格。
    expect(runs[1].text.length + runs[2].text.length).toBe(BAR_CELL_COUNT)
    expect(runs[1].ariaText).toBe('')
    expect(runs[2].ariaText).toBe('')

    const container = document.createElement('div')
    renderRuns(container, rows)
    const rowEl = container.children[0]!
    const spans = rowEl.querySelectorAll('span')
    expect(spans).toHaveLength(4)
    for (const span of spans) {
      expect(span.getAttribute('aria-hidden')).toBe('true')
    }
    // 列 aria-label：head icon aria＋run4 數值（' 42%' fallback 經 trim），
    // filled/empty 的 ariaText='' 使 20 格方塊字全數缺席。
    expect(rowEl.getAttribute('aria-label')).toBe(`第 1 列：${toAriaLabel(runs)}`)
    expect(rowEl.getAttribute('aria-label')).toBe('第 1 列：上下文已用 42%')
    expect(rowEl.getAttribute('aria-label')).not.toMatch(/[█░]/)
  })
})

// M5 T5.3（(internal design doc) §D-d）：預覽與產出
// 腳本同源展開——render-preview 不自算色/格/時間，一律吃 resolve() 真輸出。
// 以下三組（倒數／auto／bar null 退單 run）延續上方 bar 4-run 案手法：真
// resolve(config, scenario) 產出餵 renderRuns，斷言 DOM 落地與 aria 播報。

describe('renderRuns — 倒數段（M5 T5.3：情境 now 同源展開＋↺→重置 aria 代換）', () => {
  // S6 結局 (b) 同機 oracle：HH:MM 由 formatResetsAt(resetsAt) 同機現算
  // （非固定字面），故時鐘部分以此函式動態算出、不猜字面時區位移；diff＝
  // 固定 2h 才是本案決定論核心（resets_at＝mock now+2h，各情境 now 皆固定）。
  it('FULL 情境固定 now（five_hour.resets_at=now+2h）→ resolve 確定性輸出 "↺ 2h (HH:MM)"；DOM 視覺 span 保留 ↺（裝飾、aria-hidden），列 aria-label 代換為「重置」且零 ↺', () => {
    const FULL = MOCK_SCENARIOS_BY_ID['full']
    const config: BuilderConfig = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [{ id: 'reset-5h', enabled: true, icon: false, color: { kind: 'default' } }],
    }
    // 情境 now 消費：resolve 呼叫直傳 FULL（含 now），非 Date.now()——與
    // main.ts createPreview 的 render() 接線同源（見 render-preview.ts
    // renderPreview→resolve(config, input)）。
    const rows = resolve(config, FULL)
    const runs = rows[0]
    const clock = formatResetsAt(FULL.data.rate_limits!.five_hour!.resets_at!)
    expect(runs).toHaveLength(1)
    expect(runs[0].text).toBe(`↺ 2h (${clock})`)
    expect(runs[0].ariaText).toBe(`重置 2h (${clock})`)

    const container = document.createElement('div')
    renderRuns(container, rows)
    const rowEl = container.children[0]!
    const span = rowEl.querySelector('span')!
    // 視覺文字節點（裝飾、aria-hidden）仍照字面顯示 ↺——只有 aria 播報代換。
    expect(span.textContent).toBe(`↺ 2h (${clock})`)
    expect(span.getAttribute('aria-hidden')).toBe('true')
    expect(rowEl.getAttribute('aria-label')).toBe(`第 1 列：${toAriaLabel(runs)}`)
    expect(rowEl.getAttribute('aria-label')).toBe(`第 1 列：重置 2h (${clock})`)
    expect(rowEl.getAttribute('aria-label')).not.toContain('↺')
  })

  it('不同情境不同固定 now → 確定性隨情境切換而變（windows-cjk：five_hour.resets_at=now+2h，diff 仍恆 2h）', () => {
    const WIN = MOCK_SCENARIOS_BY_ID['windows-cjk']
    const config: BuilderConfig = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [{ id: 'reset-5h', enabled: true, icon: false, color: { kind: 'default' } }],
    }
    const rows = resolve(config, WIN)
    const clock = formatResetsAt(WIN.data.rate_limits!.five_hour!.resets_at!)
    expect(rows[0]).toEqual([{ text: `↺ 2h (${clock})`, ariaText: `重置 2h (${clock})` }])
  })
})

describe('renderRuns — auto 配色（M5 T5.3：resolve 已展開為具體色，render-preview 純消費不重算）', () => {
  it('model 段 color=auto、FULL 情境 model.id=claude-fable-5 → resolve 展開 ansi256(214)；DOM span inline color 依展開後色', () => {
    const FULL = MOCK_SCENARIOS_BY_ID['full']
    const config: BuilderConfig = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [{ id: 'model', enabled: true, icon: false, color: { kind: 'auto' } }],
    }
    const rows = resolve(config, FULL)
    const runs = rows[0]
    expect(runs).toEqual([{ text: 'Fable 5', fg: { kind: 'ansi256', index: 214 } }])

    const container = document.createElement('div')
    renderRuns(container, rows)
    const span = container.querySelector('span')!
    expect(span.textContent).toBe('Fable 5')
    expect(span.style.color).toBe(hexToRgbCss(colorSpecToHex(runs[0].fg!)!))
    // bg 未設（auto 只展開 fg）→ 不落 backgroundColor。
    expect(span.style.backgroundColor).toBe('')
  })

  it('不同情境 model.id 不同 → 展開後 index 隨情境改變（windows-cjk：claude-opus-4-8 → 135）', () => {
    const WIN = MOCK_SCENARIOS_BY_ID['windows-cjk']
    const config: BuilderConfig = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [{ id: 'model', enabled: true, icon: false, color: { kind: 'auto' } }],
    }
    const rows = resolve(config, WIN)
    expect(rows[0]).toEqual([{ text: 'Opus 4.8', fg: { kind: 'ansi256', index: 135 } }])

    const container = document.createElement('div')
    renderRuns(container, rows)
    const span = container.querySelector('span')!
    expect(span.style.color).toBe(hexToRgbCss(colorSpecToHex(rows[0][0].fg!)!))
  })
})

// M6 C2（2026-07-14 使用者拍板；(internal design doc)
// TASKS.md T6.1）：resolve.ts 撤除舊「bar×null 退單 run」閘門
// （`&& !isDash`），bar×null 恆走 4-run、值部顯 NA_TEXT——本 describe
// 標題與斷言隨之翻新（舊 T5.3 標題「bar null 退單 run」已非現況）。
describe('renderRuns — bar×null 4-run（M6 C2：主值 null 時 resolve 仍產 4-run，同源展開驗證）', () => {
  it('early-null 情境 used_percentage=null → resolve 4-run（run2 空字串、run3=░×20、run4=NA_TEXT）；DOM 4 個裝飾 span、列 aria-label 零方塊字', () => {
    const EARLY = MOCK_SCENARIOS_BY_ID['early-null']
    const config: BuilderConfig = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [
        {
          id: 'context-used',
          enabled: true,
          icon: true,
          color: { kind: 'default' },
          threshold: THRESHOLD_TEMPLATES.traffic,
          bar: true,
        },
      ],
    }
    const rows = resolve(config, EARLY)
    const runs = rows[0]
    expect(runs).toHaveLength(4) // M6 C2：bar×null 恆 4-run。
    expect(runs[0]).toEqual({ text: 'used: ', ariaText: '上下文已用' })
    expect(runs[1]).toEqual({ text: '', ariaText: '' })
    expect(runs[2]).toEqual({ text: BAR_EMPTY_CHAR.repeat(BAR_CELL_COUNT), ariaText: '' })
    expect(runs[3]).toEqual({ text: ` ${NA_TEXT}` })

    const container = document.createElement('div')
    renderRuns(container, rows)
    const rowEl = container.children[0]!
    const spans = rowEl.querySelectorAll('span')
    expect(spans).toHaveLength(4)
    for (const span of spans) {
      expect(span.getAttribute('aria-hidden')).toBe('true')
    }
    expect(spans[0]!.textContent).toBe('used: ')
    expect(spans[1]!.textContent).toBe('')
    expect(spans[2]!.textContent).toBe(BAR_EMPTY_CHAR.repeat(BAR_CELL_COUNT))
    expect(spans[3]!.textContent).toBe(` ${NA_TEXT}`)
    expect(rowEl.getAttribute('aria-label')).toBe(`第 1 列：${toAriaLabel(runs)}`)
    expect(rowEl.getAttribute('aria-label')).toBe(`第 1 列：上下文已用 ${NA_TEXT}`)
    expect(rowEl.getAttribute('aria-label')).not.toMatch(/[█░]/)
  })
})
