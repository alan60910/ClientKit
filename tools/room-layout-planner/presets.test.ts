/**
 * T1.3（(internal design doc) §D5；§Verification presets
 * bullet）：預設庫資料形巡檢——key 格式與唯一性、尺寸正整數、
 * `clearances` 值域（key ∈ Side、值正整數）、名稱長度 ≤30 code point、
 * 茶几／沙發特例、筆數鎖定、`findPreset` 往返。
 */
import { describe, expect, it } from 'vitest'
import { findPreset, GENERAL_TIPS, PRESETS } from './presets.js'

const SIDES = ['N', 'E', 'S', 'W']

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0
}

describe('PRESETS：整體形狀', () => {
  it('恰有 13 筆（D5 表）', () => {
    expect(PRESETS.length).toBe(13)
  })

  it('key 唯一', () => {
    const keys = PRESETS.map((preset) => preset.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe.each(PRESETS.map((preset) => [preset.key, preset] as const))('PRESETS：%s', (_key, preset) => {
  it('key 符合 kebab-case ascii', () => {
    expect(preset.key).toMatch(/^[a-z0-9-]+$/)
  })

  it('width／depth 為正整數', () => {
    expect(isPositiveInteger(preset.width)).toBe(true)
    expect(isPositiveInteger(preset.depth)).toBe(true)
  })

  it('clearances（若有）每面 key ∈ Side、值為正整數', () => {
    if (preset.clearances === undefined) return
    for (const [side, value] of Object.entries(preset.clearances)) {
      expect(SIDES).toContain(side)
      expect(isPositiveInteger(value as number)).toBe(true)
    }
  })

  it('名稱長度 ≤30 code point', () => {
    expect(Array.from(preset.name).length).toBeLessThanOrEqual(30)
  })
})

describe('PRESETS：特例', () => {
  it('茶几 passable:false 且無 clearances', () => {
    const coffeeTable = findPreset('coffee-table')
    expect(coffeeTable?.passable).toBe(false)
    expect(coffeeTable?.clearances).toBeUndefined()
  })

  it('三人沙發 passable:true', () => {
    expect(findPreset('sofa-3')?.passable).toBe(true)
  })

  it('除茶几外皆 passable:true', () => {
    for (const preset of PRESETS) {
      if (preset.key === 'coffee-table') continue
      expect(preset.passable).toBe(true)
    }
  })
})

describe('GENERAL_TIPS', () => {
  it('五句，皆非空字串', () => {
    expect(GENERAL_TIPS.length).toBe(5)
    for (const tip of GENERAL_TIPS) {
      expect(tip.length).toBeGreaterThan(0)
    }
  })
})

describe('findPreset', () => {
  it('round-trip：每筆 key 皆能取回同一筆內容', () => {
    for (const preset of PRESETS) {
      expect(findPreset(preset.key)).toEqual(preset)
    }
  })

  it('未知 key 回傳 undefined', () => {
    expect(findPreset('not-a-real-preset-key')).toBeUndefined()
  })

  it('空字串回傳 undefined', () => {
    expect(findPreset('')).toBeUndefined()
  })
})
