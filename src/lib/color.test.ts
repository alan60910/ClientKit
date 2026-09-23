/**
 * (internal design doc) §Recommended approach、§Milestone
 * 「M1 純邏輯核心」：`src/lib/color.ts` 搬遷案——WCAG 相對亮度／對比率／
 * auto-fg 黑白邊界，以及非法 hex 的非拋出安全值契約。
 *
 * 搬自 `tools/statusline-builder/color.test.ts` 對應案例；與該檔的差異
 * 僅在「不合法 hex」一組——本檔案的 `relativeLuminance`／`autoFgIsBlack`
 * 對非法輸入回安全值而非 throw，故此處驗證的是新的非拋出契約。
 */
import { describe, expect, it } from 'vitest'
import { autoFgIsBlack, contrastRatio, HEX6_RE, relativeLuminance } from './color.js'

describe('HEX6_RE', () => {
  it('合法 #rrggbb（大小寫不拘）通過；縮寫／裸 hex／空字串不通過', () => {
    expect(HEX6_RE.test('#ff0000')).toBe(true)
    expect(HEX6_RE.test('#FF00AB')).toBe(true)
    expect(HEX6_RE.test('#fff')).toBe(false)
    expect(HEX6_RE.test('ff0000')).toBe(false)
    expect(HEX6_RE.test('')).toBe(false)
  })
})

describe('relativeLuminance（WCAG sRGB 線性化）', () => {
  it('端點：黑=0、白=1', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
  })

  it('中灰 #808080 落於端點之間', () => {
    const l = relativeLuminance('#808080')
    expect(l).toBeGreaterThan(0)
    expect(l).toBeLessThan(1)
    expect(l).toBeCloseTo(0.21586, 4)
  })

  it('三原色＝各自係數（0.2126/0.7152/0.0722）', () => {
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 10)
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 10)
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 10)
  })

  it('不合法 hex 一律回 0，不丟例外', () => {
    expect(relativeLuminance('')).toBe(0)
    expect(relativeLuminance('#fff')).toBe(0)
    expect(relativeLuminance('ff0000')).toBe(0)
    expect(relativeLuminance('#gg0000')).toBe(0)
  })
})

describe('contrastRatio', () => {
  it('對稱：引數順序無關', () => {
    expect(contrastRatio(0, 1)).toBe(contrastRatio(1, 0))
    expect(contrastRatio(0.3, 0.7)).toBe(contrastRatio(0.7, 0.3))
  })

  it('值域 [1,21]：同色下限 1、黑白上限 21', () => {
    expect(contrastRatio(0.5, 0.5)).toBe(1)
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 10)
  })
})

describe('autoFgIsBlack（powerline 對比判定）', () => {
  it('分界兩側（L≈0.1791）：#757575 → 白、#767676 → 黑', () => {
    expect(autoFgIsBlack('#757575')).toBe(false)
    expect(autoFgIsBlack('#767676')).toBe(true)
  })

  it('近黑底 → 白字；近白底 → 黑字', () => {
    expect(autoFgIsBlack('#000000')).toBe(false)
    expect(autoFgIsBlack('#ffffff')).toBe(true)
  })

  it('平手取黑：精確平手點（黑白對比率相等處）的 >= 比較方向為真', () => {
    // contrastRatio(L,0) = contrastRatio(L,1) 之解析解：L = sqrt(0.05*1.05) - 0.05
    // （即 #757575/#767676 之間、doc comment 標註的 L≈0.1791 分界）。
    const lTie = Math.sqrt(0.05 * 1.05) - 0.05
    expect(contrastRatio(lTie, 0)).toBeCloseTo(contrastRatio(lTie, 1), 10)
    expect(contrastRatio(lTie, 0) >= contrastRatio(lTie, 1)).toBe(true)
  })

  it('不合法 hex 不丟例外，回傳布林值（視同亮度 0 的安全值）', () => {
    expect(() => autoFgIsBlack('')).not.toThrow()
    expect(() => autoFgIsBlack('#gg0000')).not.toThrow()
    expect(typeof autoFgIsBlack('')).toBe('boolean')
    expect(typeof autoFgIsBlack('#gg0000')).toBe('boolean')
    // 非法輸入視同 relativeLuminance 的安全值 0（近黑）→ 白字。
    expect(autoFgIsBlack('')).toBe(false)
    expect(autoFgIsBlack('#gg0000')).toBe(false)
  })
})
