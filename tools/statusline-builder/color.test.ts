/**
 * S5-T1.2（(internal design doc) §D2/§D6/型別契約/§產生器
 * 契約 7）：hex 正規化、ANSI256 對照表 spot-check（公式生成 vs 已知
 * xterm 值）、swatch 命名、WCAG 亮度／auto-fg 邊界（近黑/近白/中灰/
 * 分界兩側）、SGR 兩層組碼與共同建構規則（SP-5 byte-exact 前提）。
 */
import { describe, expect, it } from 'vitest'
import {
  ANSI256_HEX,
  ansi256SwatchName,
  ansi256ToHex,
  autoFg,
  autoFgIsBlack,
  clampAnsi256Index,
  colorSequence,
  colorSgrParams,
  colorSpecToHex,
  contrastRatio,
  ESC,
  hexToRgb,
  isValidHex,
  normalizeHex,
  relativeLuminance,
  RESET_PARAMS,
  resetSequence,
  rgbToHex,
  sgrBody,
  sgrSequence,
  type ColorSpec,
} from './color.js'

describe('hex 驗證／正規化', () => {
  it('合法小寫 #rrggbb 原樣通過', () => {
    expect(normalizeHex('#ff0000')).toBe('#ff0000')
    expect(normalizeHex('#af875f')).toBe('#af875f')
  })

  it('大寫／混寫正規化為小寫', () => {
    expect(normalizeHex('#FF00AB')).toBe('#ff00ab')
    expect(normalizeHex('#AbCdEf')).toBe('#abcdef')
  })

  it('不合法形一律 null：無 #、3 位縮寫、8 位、非 hex 字元、空字串、含空白', () => {
    expect(normalizeHex('ff0000')).toBeNull()
    expect(normalizeHex('#f00')).toBeNull()
    expect(normalizeHex('#ff0000ff')).toBeNull()
    expect(normalizeHex('#gg0000')).toBeNull()
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex(' #ff0000')).toBeNull()
    expect(normalizeHex('#ff0000 ')).toBeNull()
  })

  it('isValidHex 與 normalizeHex 判定一致', () => {
    expect(isValidHex('#ff0000')).toBe(true)
    expect(isValidHex('#FF0000')).toBe(true)
    expect(isValidHex('#f00')).toBe(false)
    expect(isValidHex('ff0000')).toBe(false)
  })

  it('hexToRgb 拆分量（大小寫皆收）；不合法丟 TypeError', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(hexToRgb('#FF8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(() => hexToRgb('#f00')).toThrow(TypeError)
    expect(() => hexToRgb('nope')).toThrow(TypeError)
  })

  it('rgbToHex 產小寫並補零；與 hexToRgb 互逆', () => {
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000')
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
    expect(rgbToHex(10, 11, 12)).toBe('#0a0b0c')
    const { r, g, b } = hexToRgb('#5f87af')
    expect(rgbToHex(r, g, b)).toBe('#5f87af')
  })
})

describe('ANSI256↔hex 對照表（SP-4 公式生成 spot-check）', () => {
  it('長度恰 256，全項為小寫 #rrggbb', () => {
    expect(ANSI256_HEX).toHaveLength(256)
    for (const hex of ANSI256_HEX) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('表凍結不可變', () => {
    expect(Object.isFrozen(ANSI256_HEX)).toBe(true)
  })

  it('16 基本色＝xterm 預設值 spot-check', () => {
    expect(ANSI256_HEX[0]).toBe('#000000')
    expect(ANSI256_HEX[1]).toBe('#800000')
    expect(ANSI256_HEX[7]).toBe('#c0c0c0')
    expect(ANSI256_HEX[8]).toBe('#808080')
    expect(ANSI256_HEX[9]).toBe('#ff0000')
    expect(ANSI256_HEX[12]).toBe('#0000ff')
    expect(ANSI256_HEX[15]).toBe('#ffffff')
  })

  it('色立方 16+36r+6g+b（levels 0/95/135/175/215/255）知名索引', () => {
    expect(ANSI256_HEX[16]).toBe('#000000') // r=g=b=0
    expect(ANSI256_HEX[21]).toBe('#0000ff') // b=5
    expect(ANSI256_HEX[46]).toBe('#00ff00') // g=5
    expect(ANSI256_HEX[52]).toBe('#5f0000') // r=1 → level 95
    expect(ANSI256_HEX[59]).toBe('#5f5f5f') // r=g=b=1
    expect(ANSI256_HEX[196]).toBe('#ff0000') // r=5
    expect(ANSI256_HEX[201]).toBe('#ff00ff')
    expect(ANSI256_HEX[226]).toBe('#ffff00')
    expect(ANSI256_HEX[231]).toBe('#ffffff') // r=g=b=5
  })

  it('灰階 232+n → 8+10n', () => {
    expect(ANSI256_HEX[232]).toBe('#080808') // n=0
    expect(ANSI256_HEX[244]).toBe('#808080') // n=12，灰階中值
    expect(ANSI256_HEX[255]).toBe('#eeeeee') // n=23 → 238
  })

  it('ansi256ToHex 越界 clamp：-1/256/NaN 不丟例外', () => {
    expect(ansi256ToHex(-1)).toBe('#000000')
    expect(ansi256ToHex(256)).toBe('#eeeeee')
    expect(ansi256ToHex(Number.NaN)).toBe('#000000')
  })
})

describe('clampAnsi256Index', () => {
  it('區間內原值通過（含兩端）', () => {
    expect(clampAnsi256Index(0)).toBe(0)
    expect(clampAnsi256Index(137)).toBe(137)
    expect(clampAnsi256Index(255)).toBe(255)
  })

  it('越界收邊：-1→0、256→255、±Infinity 隨 clamp 收邊', () => {
    expect(clampAnsi256Index(-1)).toBe(0)
    expect(clampAnsi256Index(256)).toBe(255)
    expect(clampAnsi256Index(Number.POSITIVE_INFINITY)).toBe(255)
    expect(clampAnsi256Index(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('非整數 trunc、NaN → 0', () => {
    expect(clampAnsi256Index(3.9)).toBe(3)
    expect(clampAnsi256Index(-0.5)).toBe(0)
    expect(clampAnsi256Index(Number.NaN)).toBe(0)
  })
})

describe('ansi256SwatchName（D6：「ANSI 索引＋hex」）', () => {
  it('知名索引命名形', () => {
    expect(ansi256SwatchName(196)).toBe('ANSI 196 #ff0000')
    expect(ansi256SwatchName(21)).toBe('ANSI 21 #0000ff')
    expect(ansi256SwatchName(244)).toBe('ANSI 244 #808080')
  })

  it('公式為權威：137=#af875f（PLAN D6 例示 #af8787 實為 138）', () => {
    expect(ansi256SwatchName(137)).toBe('ANSI 137 #af875f')
    expect(ansi256SwatchName(138)).toBe('ANSI 138 #af8787')
  })

  it('越界索引先 clamp，名稱反映實際 swatch', () => {
    expect(ansi256SwatchName(300)).toBe('ANSI 255 #eeeeee')
  })
})

describe('colorSpecToHex（預覽用）', () => {
  it('default → null（不著色）；ansi256 過表；truecolor 原樣', () => {
    expect(colorSpecToHex({ kind: 'default' })).toBeNull()
    expect(colorSpecToHex({ kind: 'ansi256', index: 196 })).toBe('#ff0000')
    expect(colorSpecToHex({ kind: 'truecolor', hex: '#5f87af' })).toBe('#5f87af')
  })
})

describe('relativeLuminance（WCAG sRGB 線性化）', () => {
  it('端點：黑=0、白=1', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
  })

  it('三原色＝各自係數（0.2126/0.7152/0.0722）', () => {
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 10)
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 10)
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 10)
  })

  it('低通道走線性段（s ≤ 0.03928 → /12.92）', () => {
    // 10/255 ≈ 0.0392157 ≤ 0.03928 → 線性段
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 10)
    // 11/255 走冪次段，仍須單調
    expect(relativeLuminance('#0b0b0b')).toBeGreaterThan(relativeLuminance('#0a0a0a'))
  })

  it('不合法 hex 丟 TypeError', () => {
    expect(() => relativeLuminance('gray')).toThrow(TypeError)
  })
})

describe('contrastRatio', () => {
  it('黑白對比 = 21；同色 = 1；順序無關', () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 10)
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 10)
    expect(contrastRatio(0.5, 0.5)).toBe(1)
  })
})

describe('autoFgIsBlack／autoFg（powerline 對比判定）', () => {
  it('近黑底 → 白字；近白底 → 黑字', () => {
    expect(autoFgIsBlack('#000000')).toBe(false)
    expect(autoFgIsBlack('#0a0a0a')).toBe(false)
    expect(autoFgIsBlack('#ffffff')).toBe(true)
    expect(autoFgIsBlack('#f5f5f5')).toBe(true)
  })

  it('中灰 #808080（L≈0.216）在分界之上 → 黑字', () => {
    expect(autoFgIsBlack('#808080')).toBe(true)
  })

  it('分界兩側（L≈0.1791）：#757575 → 白、#767676 → 黑', () => {
    expect(autoFgIsBlack('#757575')).toBe(false)
    expect(autoFgIsBlack('#767676')).toBe(true)
  })

  it('純紅底 → 黑字（黑 5.25 > 白 4.00，WCAG 反直覺案）；純藍底 → 白字', () => {
    expect(autoFgIsBlack('#ff0000')).toBe(true)
    expect(autoFgIsBlack('#0000ff')).toBe(false)
  })

  it('autoFg 色軌一致：truecolor bg → truecolor 黑/白', () => {
    expect(autoFg({ kind: 'truecolor', hex: '#ff0000' })).toEqual({
      kind: 'truecolor',
      hex: '#000000',
    })
    expect(autoFg({ kind: 'truecolor', hex: '#0000ff' })).toEqual({
      kind: 'truecolor',
      hex: '#ffffff',
    })
  })

  it('autoFg 色軌一致：ansi256 bg → 色立方端點 16/231（非主題可覆寫的 0/15）', () => {
    expect(autoFg({ kind: 'ansi256', index: 196 })).toEqual({ kind: 'ansi256', index: 16 })
    expect(autoFg({ kind: 'ansi256', index: 21 })).toEqual({ kind: 'ansi256', index: 231 })
  })

  it('default bg 無已知色可對比 → default（不著色）', () => {
    expect(autoFg({ kind: 'default' })).toEqual({ kind: 'default' })
  })
})

describe('SGR 組碼（§產生器契約 7：兩層 API＋共同建構規則）', () => {
  it('truecolor 參數段：fg 38;2;r;g;b／bg 48;2;r;g;b', () => {
    const spec: ColorSpec = { kind: 'truecolor', hex: '#ff8000' }
    expect(colorSgrParams(spec, 'fg')).toBe('38;2;255;128;0')
    expect(colorSgrParams(spec, 'bg')).toBe('48;2;255;128;0')
  })

  it('ansi256 參數段：fg 38;5;n／bg 48;5;n（全 256 索引逐一）', () => {
    for (let i = 0; i < 256; i++) {
      expect(colorSgrParams({ kind: 'ansi256', index: i }, 'fg')).toBe(`38;5;${i}`)
      expect(colorSgrParams({ kind: 'ansi256', index: i }, 'bg')).toBe(`48;5;${i}`)
    }
  })

  it('ansi256 越界索引 clamp 後組碼', () => {
    expect(colorSgrParams({ kind: 'ansi256', index: 999 }, 'fg')).toBe('38;5;255')
    expect(colorSgrParams({ kind: 'ansi256', index: -3 }, 'bg')).toBe('48;5;0')
  })

  it('default 不 emit：參數段 null、完整序列空字串', () => {
    expect(colorSgrParams({ kind: 'default' }, 'fg')).toBeNull()
    expect(colorSgrParams({ kind: 'default' }, 'bg')).toBeNull()
    expect(colorSequence({ kind: 'default' }, 'fg')).toBe('')
  })

  it('sgrBody 碼段不含 ESC 字元本體', () => {
    expect(sgrBody('38;5;196')).toBe('[38;5;196m')
    expect(sgrBody(RESET_PARAMS)).toBe('[0m')
    expect(sgrBody('38;2;255;0;0')).not.toContain('\x1b')
  })

  it('sgrSequence＝esc + sgrBody（byte-exact 共同建構規則）', () => {
    const params = '48;5;196'
    expect(sgrSequence(params)).toBe(`\x1b${sgrBody(params)}`)
    // emitter 注入字面 escape 形時走同一規則
    expect(sgrSequence(params, '${ESC}')).toBe('${ESC}[48;5;196m')
    expect(sgrSequence(params, '$e')).toBe('$e[48;5;196m')
  })

  it('colorSequence 完整序列（預設真 ESC／注入形）', () => {
    const spec: ColorSpec = { kind: 'truecolor', hex: '#ff0000' }
    expect(colorSequence(spec, 'fg')).toBe('\x1b[38;2;255;0;0m')
    expect(colorSequence({ kind: 'ansi256', index: 196 }, 'bg', '$e')).toBe('$e[48;5;196m')
  })

  it('reset：RESET_PARAMS="0"、resetSequence 尾碼 [0m', () => {
    expect(RESET_PARAMS).toBe('0')
    expect(resetSequence()).toBe('\x1b[0m')
    expect(resetSequence('$e')).toBe('$e[0m')
  })

  it('ESC 常數＝單一 U+001B 字元', () => {
    expect(ESC).toHaveLength(1)
    expect(ESC.charCodeAt(0)).toBe(27)
  })
})
