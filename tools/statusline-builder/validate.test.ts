/**
 * S5-T1.4（(internal design doc) §產生器契約 6、
 * §Verification 1「validate property 測試」）：拒收集 R 全類釘住＋
 * emitter 對抗字元放行斷言＋手寫 property 生成器（固定 seed；repo 無
 * fast-check、不新增依賴）。
 *
 * 計數口徑釘死（契約沉默處的本 task 選擇）：長度以 code point 計——
 * ZWJ 家族序列按組成 code point 計（家族＝7、拇指+膚色＝2、心+VS16＝2），
 * 非 grapheme（家族＝1）亦非 UTF-16 unit（家族＝11）。
 *
 * 慣例：R 內字元一律以 \uXXXX escape 寫出，不嵌原始控制／bidi 字元——
 * 原始 bidi 字元會觸發 GitHub 原始碼警示，且無法目視審查。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_CUSTOM_TEXT_CODE_POINTS,
  validateCustomText,
  type CustomTextRejectReason,
} from './validate.js'

/** ZWJ 家族（男+女+女孩+男孩）：7 code point、11 UTF-16 unit、1 grapheme。 */
const ZWJ_FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}'
/** 拇指＋中膚色修飾：2 code point。 */
const THUMBS_SKIN = '\u{1F44D}\u{1F3FD}'
/** 紅心＋VS16（emoji 呈現變體選擇器）：2 code point。 */
const HEART_VS16 = '\u{2764}\u{FE0F}'

const countCodePoints = (s: string): number => [...s].length

describe('Q2 拍板常數', () => {
  it('長度上限＝8 code point', () => {
    expect(MAX_CUSTOM_TEXT_CODE_POINTS).toBe(8)
  })
})

describe('拒收集 R：換行類（F3 只取第一行＝靜默截斷）', () => {
  it.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['CRLF', '\r\n'],
    ['U+2028 LINE SEPARATOR', '\u2028'],
    ['U+2029 PARAGRAPH SEPARATOR', '\u2029'],
  ])('%s → newline', (_name, s) => {
    expect(validateCustomText(s)).toEqual({ ok: false, reason: 'newline' })
  })

  it('夾在合法字元中間亦拒', () => {
    expect(validateCustomText('a\nb')).toEqual({ ok: false, reason: 'newline' })
  })
})

describe('拒收集 R：C0/C1 控制字元（Cc 全集＝C0＋DEL＋C1）', () => {
  it.each([
    ['NUL U+0000', '\u0000'],
    ['SOH U+0001', '\u0001'],
    ['BEL U+0007', '\u0007'],
    ['tab U+0009（契約明點：tab 屬 R）', '\t'],
    ['VT U+000B', '\u000B'],
    ['ESC U+001B（ANSI 注入向量）', '\u001B'],
    ['US U+001F（C0 上界）', '\u001F'],
    ['DEL U+007F', '\u007F'],
    ['PAD U+0080（C1 下界）', '\u0080'],
    ['NEL U+0085', '\u0085'],
    ['CSI U+009B（單字元 ANSI 導入）', '\u009B'],
    ['APC U+009F（C1 上界）', '\u009F'],
  ])('%s → control', (_name, s) => {
    expect(validateCustomText(s)).toEqual({ ok: false, reason: 'control' })
  })

  it('邊界外放行：U+0020 空格／U+007E ~／U+00A0 NBSP', () => {
    expect(validateCustomText(' ')).toEqual({ ok: true })
    expect(validateCustomText('~')).toEqual({ ok: true })
    expect(validateCustomText('\u00A0')).toEqual({ ok: true })
  })
})

describe('拒收集 R：bidi／格式控制（Bidi_Control 全集 12 個）', () => {
  const bidiControls = [
    0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
    0x2067, 0x2068, 0x2069,
  ]

  it.each(bidiControls.map((cp) => [`U+${cp.toString(16).toUpperCase()}`, cp] as const))(
    '%s → bidi-format',
    (_name, cp) => {
      expect(validateCustomText(String.fromCodePoint(cp))).toEqual({
        ok: false,
        reason: 'bidi-format',
      })
    },
  )

  it('RLO 視覺重排欺騙組合（a + U+202E + b）亦拒', () => {
    expect(validateCustomText('a\u202Eb')).toEqual({ ok: false, reason: 'bidi-format' })
  })
})

describe('拒收集 R：不成對代理項（無法忠實 UTF-8 編碼）', () => {
  it('孤高代理 U+D83D → lone-surrogate', () => {
    expect(validateCustomText('\ud83d')).toEqual({ ok: false, reason: 'lone-surrogate' })
  })

  it('孤低代理 U+DC4D → lone-surrogate', () => {
    expect(validateCustomText('\udc4d')).toEqual({ ok: false, reason: 'lone-surrogate' })
  })

  it('合法字串尾掛孤高代理亦拒', () => {
    expect(validateCustomText('ab\ud83d')).toEqual({ ok: false, reason: 'lone-surrogate' })
  })

  it('成對代理（完整 emoji）放行', () => {
    expect(validateCustomText('\u{1F44D}')).toEqual({ ok: true })
  })
})

describe('拒收集 R：私用區 PUA（Nerd Font glyph／powerline 箭頭同區——防污染 aria-label enforcement）', () => {
  it.each([
    ['BMP PUA 下界 U+E000', '\u{E000}'],
    ['powerline 箭頭 U+E0B0', '\u{E0B0}'],
    ['BMP PUA 上界 U+F8FF', '\u{F8FF}'],
    ['補充私用區 A 下界 U+F0000', '\u{F0000}'],
    ['補充私用區 A 上界 U+FFFFD', '\u{FFFFD}'],
    ['補充私用區 B 下界 U+100000', '\u{100000}'],
    ['補充私用區 B 上界 U+10FFFD', '\u{10FFFD}'],
  ])('%s → pua', (_name, s) => {
    expect(validateCustomText(s)).toEqual({ ok: false, reason: 'pua' })
  })

  it('夾在合法前綴後（M + glyph）亦拒', () => {
    expect(validateCustomText('M\u{E0B0}')).toEqual({ ok: false, reason: 'pua' })
  })

  it('邊界外放行：U+F8FF 後一碼 U+F900（CJK 相容）／Plane 14 U+EFFFF／noncharacter U+FFFFE', () => {
    expect(validateCustomText('\u{F900}')).toEqual({ ok: true })
    expect(validateCustomText('\u{EFFFF}')).toEqual({ ok: true })
    expect(validateCustomText('\u{FFFFE}')).toEqual({ ok: true })
  })
})

describe('長度上限：以 code point 計（口徑釘死）', () => {
  it('8 個 ASCII → ok；9 個 → too-long', () => {
    expect(validateCustomText('abcdefgh')).toEqual({ ok: true })
    expect(validateCustomText('abcdefghi')).toEqual({ ok: false, reason: 'too-long' })
  })

  it('8 個 astral emoji（16 UTF-16 unit）→ ok——證明非 UTF-16 計數', () => {
    const s = '\u{1F600}'.repeat(8)
    expect(s.length).toBe(16)
    expect(validateCustomText(s)).toEqual({ ok: true })
  })

  it('ZWJ 家族＝7 code point（1 grapheme、11 unit）→ ok', () => {
    expect(countCodePoints(ZWJ_FAMILY)).toBe(7)
    expect(ZWJ_FAMILY.length).toBe(11)
    expect(validateCustomText(ZWJ_FAMILY)).toEqual({ ok: true })
  })

  it('ZWJ 家族＋2 字元＝9 code point → too-long——grapheme 計數（1＋2）會誤放，口徑鎖 code point', () => {
    expect(validateCustomText(`${ZWJ_FAMILY}ab`)).toEqual({ ok: false, reason: 'too-long' })
  })

  it('膚色修飾按組成計：拇指+膚色＝2 code point；×4＝8 → ok；×5＝10 → too-long', () => {
    expect(countCodePoints(THUMBS_SKIN)).toBe(2)
    expect(validateCustomText(THUMBS_SKIN.repeat(4))).toEqual({ ok: true })
    expect(validateCustomText(THUMBS_SKIN.repeat(5))).toEqual({ ok: false, reason: 'too-long' })
  })

  it('VS16 序列按組成計：心+VS16＝2 code point → ok', () => {
    expect(countCodePoints(HEART_VS16)).toBe(2)
    expect(validateCustomText(HEART_VS16)).toEqual({ ok: true })
  })

  it('CJK 每字 1 code point：8 字 → ok；9 字 → too-long', () => {
    expect(validateCustomText('中文測試日本語文')).toEqual({ ok: true })
    expect(validateCustomText('中文測試日本語文字')).toEqual({ ok: false, reason: 'too-long' })
  })

  it('空字串放行（前綴選填、空分隔符＝直接串接；無 R 成員即過）', () => {
    expect(validateCustomText('')).toEqual({ ok: true })
  })
})

describe('優先序：字元類違規先於 too-long（單趟、首個 R 成員定 reason）', () => {
  it('超長＋含 LF → newline（非 too-long）', () => {
    expect(validateCustomText('aaaaaaaaaa\n')).toEqual({ ok: false, reason: 'newline' })
  })

  it('同串多類 R：依序首個中的類別勝出（tab 在 RLO 前 → control）', () => {
    expect(validateCustomText('a\t\u202E')).toEqual({ ok: false, reason: 'control' })
  })
})

describe('emitter 對抗字元放行（escaping 層職責——契約 6，驗證層不得擋）', () => {
  it.each([
    ['單引號', "'"],
    ['雙引號', '"'],
    ['dollar', '$'],
    ['backtick', '`'],
    ['反斜線', '\\'],
    ['驚嘆號（histexpand 對抗）', '!'],
    ['百分號（printf 格式位對抗）', '%'],
    ['空格', ' '],
    ['CJK', '中文測試'],
    ['單 code point emoji', '\u{1F600}'],
    ['ZWJ 家族序列', ZWJ_FAMILY],
    ['膚色修飾序列', THUMBS_SKIN],
    ["bash 嵌套引號 idiom '\\''", "'\\''"],
    ['ps1 subexpression 形 $(x)', '$(x)'],
    ['混合 8 字元 \'"$`\\!%＋空格', '\'"$`\\!% '],
  ])('%s → ok', (_name, s) => {
    expect(validateCustomText(s)).toEqual({ ok: true })
  })

  it('ZWJ（U+200D）本身不在 R（emoji 序列必需，不得誤入格式控制拒收）', () => {
    expect(validateCustomText('\u200D')).toEqual({ ok: true })
  })
})

// ─── property 式測試：手寫生成器（固定 seed，無 fast-check）───

/** mulberry32：確定性 PRNG，回傳 [0,1)。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 20260707
const ITERATIONS = 500

/** 合法字母表：涵蓋 emitter 對抗字元＋CJK＋單/多 code point emoji。 */
const LEGAL_UNITS: readonly string[] = [
  'a', 'Z', '0', '9', '.', '-', '_', ' ',
  "'", '"', '$', '`', '\\', '!', '%',
  '中', '文', '測', '試', '日', '本',
  '\u{1F600}', '\u{1F389}', '⚡',
  HEART_VS16, THUMBS_SKIN, ZWJ_FAMILY,
]

/**
 * R 抽樣字母表（隨機插入用）：C0/C1 抽樣＋Bidi_Control 全集＋Unicode
 * 行終結符＋PUA 抽樣（BMP 上下界＋powerline 箭頭＋補充私用區 Plane 15/16）。
 * 刻意不含孤代理——兩個隨機插入的孤高＋孤低相鄰會湊成合法代理對而洗白，
 * 孤代理由上方單元案專測。
 */
const R_UNITS: readonly string[] = [
  '\n', '\r', '\u0000', '\t', '\u0001', '\u0007', '\u000B',
  '\u001B', '\u007F', '\u0085', '\u009B',
  '\u061C', '\u200E', '\u200F',
  '\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
  '\u2066', '\u2067', '\u2068', '\u2069',
  '\u2028', '\u2029',
  '\u{E000}', '\u{E0B0}', '\u{F8FF}', '\u{F0000}', '\u{100000}',
]

const NON_LENGTH_REASONS: ReadonlySet<CustomTextRejectReason> = new Set([
  'newline', 'control', 'bidi-format', 'lone-surrogate', 'pua',
])

const pick = <T,>(rand: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)]!

/** 產生 ≤ maxCodePoints 的全合法字串（單位按實際 code point 數扣預算）。 */
function genLegal(rand: () => number, maxCodePoints: number): string {
  const target = Math.floor(rand() * (maxCodePoints + 1))
  let out = ''
  let budget = target
  while (budget > 0) {
    const candidates = LEGAL_UNITS.filter((u) => countCodePoints(u) <= budget)
    if (candidates.length === 0) break
    const unit = pick(rand, candidates)
    out += unit
    budget -= countCodePoints(unit)
  }
  return out
}

/** 於隨機 code point 邊界插入（spread 切分保證不劈開代理對）。 */
function insertAtRandomBoundary(rand: () => number, base: string, inserted: string): string {
  const cps = [...base]
  const at = Math.floor(rand() * (cps.length + 1))
  return [...cps.slice(0, at), inserted, ...cps.slice(at)].join('')
}

describe('property：固定 seed 手寫生成器', () => {
  it('生成器字母表自檢：LEGAL_UNITS 逐一放行、R_UNITS 逐一拒收', () => {
    for (const u of LEGAL_UNITS) {
      expect(validateCustomText(u), `LEGAL unit ${JSON.stringify(u)}`).toEqual({ ok: true })
    }
    for (const u of R_UNITS) {
      const result = validateCustomText(u)
      expect(result.ok, `R unit U+${u.codePointAt(0)!.toString(16)}`).toBe(false)
    }
  })

  it(`全合法 ≤8 code point 者必過（×${ITERATIONS}）`, () => {
    const rand = mulberry32(SEED)
    for (let i = 0; i < ITERATIONS; i++) {
      const s = genLegal(rand, MAX_CUSTOM_TEXT_CODE_POINTS)
      const cps = [...s].map((c) => c.codePointAt(0)!.toString(16)).join(' ')
      expect(validateCustomText(s), `iter ${i} cp=[${cps}]`).toEqual({ ok: true })
    }
  })

  it(`合法基底 ≤7 cp＋插入 1 個 R 字元 → 必拒且非 too-long（×${ITERATIONS}）`, () => {
    const rand = mulberry32(SEED + 1)
    for (let i = 0; i < ITERATIONS; i++) {
      const base = genLegal(rand, MAX_CUSTOM_TEXT_CODE_POINTS - 1)
      const s = insertAtRandomBoundary(rand, base, pick(rand, R_UNITS))
      const result = validateCustomText(s)
      const cps = [...s].map((c) => c.codePointAt(0)!.toString(16)).join(' ')
      expect(result.ok, `iter ${i} cp=[${cps}]`).toBe(false)
      if (!result.ok) {
        expect(NON_LENGTH_REASONS.has(result.reason), `iter ${i} reason=${result.reason}`).toBe(true)
      }
    }
  })

  it(`合法基底 ≤8 cp＋插入 1–3 個 R 字元（總長不限）→ 必拒（×${ITERATIONS}）`, () => {
    const rand = mulberry32(SEED + 2)
    for (let i = 0; i < ITERATIONS; i++) {
      let s = genLegal(rand, MAX_CUSTOM_TEXT_CODE_POINTS)
      const injections = 1 + Math.floor(rand() * 3)
      for (let k = 0; k < injections; k++) {
        s = insertAtRandomBoundary(rand, s, pick(rand, R_UNITS))
      }
      expect(validateCustomText(s).ok, `iter ${i}`).toBe(false)
    }
  })
})
