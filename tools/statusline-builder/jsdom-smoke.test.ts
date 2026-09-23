// @vitest-environment jsdom
/**
 * T1.1（(internal design doc) §D-d）：jsdom 共存
 * canary。以 per-file `// @vitest-environment jsdom` pragma 局部啟用
 * jsdom，驗證與專案其餘 node-environment 測試池共存無洩漏（不影響其他
 * 檔案的 document/window 全域、不拖慢整體測試時間超過 +10% 門檻）。若此
 * smoke 未通過既定客觀門檻，D-d 裁決回退選項 B（純函式接縫），本檔連同
 * jsdom devDependency 一併移除。
 */
import { describe, expect, it } from 'vitest'

describe('jsdom 共存 smoke', () => {
  it('document.createElement 產生真實 HTMLElement，className 可寫可讀', () => {
    const div = document.createElement('div')
    expect(div instanceof HTMLElement).toBe(true)

    div.className = 'foo bar'
    expect(div.className).toBe('foo bar')
  })
})
