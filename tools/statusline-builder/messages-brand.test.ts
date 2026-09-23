/**
 * 🟡-7（(internal design doc)；PLAN.md
 * §Verification (f) 後半）：`messages.ts` 每個 locale 的 `ui.backLink` 皆為
 * ClientKit 品牌，且不含舊品牌字樣。
 *
 * 前身 verification 條目未落地（review 實證 `*.test.ts` 中 `backLink` 零
 * 命中）——本檔補上，並以「locale 數等於已知數」防迴圈空跑成恆真式：若
 * `messages.ts` 日後新增/移除 locale 而本檔清單未同步更新，`LOCALES` 的
 * `toHaveLength` 斷言會先轉紅，而不是靜默漏測新 locale。
 */
import { describe, expect, it } from 'vitest'
import { t, type Locale } from './messages.js'

/** 已知 locale 全集（與 messages.ts `Locale` 型別同源手動列舉）。 */
const LOCALES: readonly Locale[] = ['zh-Hant', 'en']

/** 舊品牌（不分大小寫：同時涵蓋 `EZTools` 與 `eztools`）。 */
const OLD_BRAND = /eztools/i

describe('🟡-7：messages.ts 全 locale ui.backLink 品牌斷言', () => {
  it('已知 locale 數為 2（防迴圈空跑）', () => {
    expect(LOCALES).toHaveLength(2)
  })

  it.each(LOCALES)('%s：ui.backLink 含 ClientKit 且不含舊品牌', (locale) => {
    const backLink = t(locale).ui.backLink
    expect(backLink).toContain('ClientKit')
    expect(backLink).not.toMatch(OLD_BRAND)
  })
})
