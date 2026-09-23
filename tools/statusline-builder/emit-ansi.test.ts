/**
 * S5-T2.2（(internal design doc) §Verification 1／3）：
 * emit-ansi oracle 的 SGR emission 規則釘測——逐 run 無條件 reset 前綴
 * （stateless）、fg 先於 bg、行尾無條件 reset（含空 runs）、default 不
 * emit——＋與 color.ts sgrSequence／colorSequence 共用建構規則的一致性
 * spot-check（SP-5 byte-exact 前提）。
 */
import { describe, expect, it } from 'vitest'
import {
  colorSequence,
  resetSequence,
  sgrSequence,
  type ColorSpec,
} from './color.js'
import { toAnsi } from './emit-ansi.js'

const A = (index: number): ColorSpec => ({ kind: 'ansi256', index })
const TC = (hex: string): ColorSpec => ({ kind: 'truecolor', hex })

describe('emission 規則', () => {
  it('空 runs → 單一行尾 reset（規則 3；單列包裹 [[]]——T2.2 簽章升維）', () => {
    expect(toAnsi([[]])).toBe('\x1b[0m')
  })

  it('toAnsi([]) 零列（resolve 契約外輸入）→ 空字串；非空不變量歸屬 resolve 恆 [[]]，非 toAnsi 自身保證（(internal design doc) PLAN §前置加固）', () => {
    // 「全隱藏輸出恆為單一 reset、非空字串」的不變量由 resolve()（全隱藏
    // 時恆回傳 [[]]，≥1 列）維繫，toAnsi 本身對零列輸入無防禦：
    // [].map(joinRow).join('\n') === ''。resolve 不會產出 []（其退化案
    // 恆為 [[]]），故此案屬 resolve 契約外輸入，此測試僅記錄 oracle 對
    // 越界輸入的實際行為，不代表 toAnsi 承諾非空。
    expect(toAnsi([])).toBe('')
  })

  it('單 run fg：reset 前綴＋38;5;n＋text＋行尾 reset', () => {
    expect(toAnsi([[{ text: 'x', fg: A(196) }]])).toBe('\x1b[0m\x1b[38;5;196mx\x1b[0m')
  })

  it('fg 先於 bg（規則 2，順序鎖死）', () => {
    expect(toAnsi([[{ text: 't', fg: A(16), bg: A(196) }]])).toBe(
      '\x1b[0m\x1b[38;5;16m\x1b[48;5;196mt\x1b[0m',
    )
  })

  it('逐 run 無條件 reset 前綴：無色 run 不繼承前段色（規則 1，stateless）', () => {
    expect(toAnsi([[{ text: 'a', fg: A(196) }, { text: 'b' }]])).toBe(
      '\x1b[0m\x1b[38;5;196ma\x1b[0mb\x1b[0m',
    )
  })

  it('default 色不 emit（規則 4；resolve 正規形外的防禦面）', () => {
    expect(toAnsi([[{ text: 'x', fg: { kind: 'default' }, bg: { kind: 'default' } }]])).toBe(
      '\x1b[0mx\x1b[0m',
    )
  })

  it('truecolor bg → 48;2;r;g;b', () => {
    expect(toAnsi([[{ text: 'x', bg: TC('#0a141e') }]])).toBe('\x1b[0m\x1b[48;2;10;20;30mx\x1b[0m')
  })

  it('ansi256 越界經 color.ts clamp（38;5;255）', () => {
    expect(toAnsi([[{ text: 'x', fg: A(300) }]])).toBe('\x1b[0m\x1b[38;5;255mx\x1b[0m')
  })
})

describe('多列 join（T2.3；resolve() 分組後的 rows 消費面）', () => {
  it('兩列以單一 LF 相接、無尾隨換行；每列行尾 reset 在 LF 之前', () => {
    expect(toAnsi([[{ text: 'a' }], [{ text: 'b', fg: A(1) }]])).toBe(
      `\x1b[0ma\x1b[0m\n\x1b[0m\x1b[38;5;1mb\x1b[0m`,
    )
  })

  it('三列（含中間空列）：join 不特別過濾——toAnsi 對每個陣列元素各自 joinRow（空列仍出行尾 reset）', () => {
    expect(toAnsi([[{ text: 'a' }], [], [{ text: 'c' }]])).toBe(
      `\x1b[0ma\x1b[0m\n\x1b[0m\n\x1b[0mc\x1b[0m`,
    )
  })
})

describe('color.ts 建構規則一致性（SP-5 byte-exact 前提）', () => {
  it('sgrSequence spot-check：toAnsi 輸出可由共用規則重組', () => {
    expect(toAnsi([[{ text: 'x', fg: A(196) }]])).toBe(
      `${resetSequence()}${sgrSequence('38;5;196')}x${resetSequence()}`,
    )
  })

  it.each<[string, ColorSpec | undefined, ColorSpec | undefined]>([
    ['ansi256 fg+bg', A(5), A(230)],
    ['truecolor fg+bg', TC('#ff00d7'), TC('#101010')],
    ['僅 bg', undefined, A(27)],
    ['混軌 fg ansi256＋bg truecolor', A(231), TC('#005fff')],
  ])('合成律（%s）：reset＋colorSequence(fg)＋colorSequence(bg)＋text＋reset', (_name, fg, bg) => {
    const run = { text: 't', ...(fg !== undefined ? { fg } : {}), ...(bg !== undefined ? { bg } : {}) }
    const expected =
      resetSequence() +
      (fg !== undefined ? colorSequence(fg, 'fg') : '') +
      (bg !== undefined ? colorSequence(bg, 'bg') : '') +
      't' +
      resetSequence()
    expect(toAnsi([[run]])).toBe(expected)
  })
})
