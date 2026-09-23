/**
 * S9-T2.1（(internal design doc) T2.1）：
 * `computeSegmentFieldDefaults`（八欄位預設值描述，「helper 單元案
 * （八欄位型各一）」——本檔逐欄位各覆蓋 applicable=true／false 兩態）、
 * `isSegmentFieldAtDefault`（現值是否＝預設，供 T2.2）、`colorDisplayLabel`
 * 窮盡四態。
 *
 * T5.6（09-PLAN §D5 D5 收口；default-hint 結構化改造）：本檔斷言隨
 * `defaultLabel: string` → `descriptor: SegmentFieldDefaultDescriptor |
 * null` 介面改動同步調整——原本比對 zh 字面字串，現比對結構化 kind／
 * 參數（不適用欄位由 `defaultLabel: ''` 改 `descriptor: null`）。render
 * 後的實際 DOM 文字（main.ts `defaultDescriptorLabel` 解讀後）byte-lock
 * 於 `default-hint.dom.test.ts`（該檔測的是渲染結果、不依賴本檔介面
 * 形狀，故未隨本次改動而動）。
 *
 * 假 descriptor 由本檔 `fakeDescriptor` 工廠建構（比照 config.test.ts
 * 假 CATALOG 慣例——本模組不依賴 segments.ts 真目錄，見 segment-
 * defaults.ts 檔頭「輸入面設計」節）。
 */
import { describe, expect, it } from 'vitest'
import type { ColorSpec } from './color.js'
import type { SegmentConfig } from './config.js'
import type { SegmentDescriptor } from './segments.js'
import type { ThresholdRule } from './threshold.js'
import {
  colorDisplayLabel,
  computeSegmentFieldDefaults,
  isSegmentFieldAtDefault,
  type SegmentFieldKey,
} from './segment-defaults.js'

const ansi = (index: number): ColorSpec => ({ kind: 'ansi256', index })

/** 最小合法 SegmentDescriptor（tsPath/jqPath/ps1Path 皆為佔位，本模組不讀）。 */
function fakeDescriptor(overrides: Partial<SegmentDescriptor> & { id: string }): SegmentDescriptor {
  return {
    label: overrides.id,
    category: 'always',
    tsPath: () => undefined,
    jqPath: '.placeholder',
    ps1Path: '$d.placeholder',
    format: 'text',
    icon: { glyph: `${overrides.id}:`, ariaText: overrides.id },
    nullPolicy: 'empty',
    provisional: false,
    ...overrides,
  }
}

/** 最小合法 SegmentConfig（enabled=false／icon=true／color=default，同 defaultSegmentConfig 產出）。 */
function fakeSeg(id: string, overrides: Partial<SegmentConfig> = {}): SegmentConfig {
  return { id, enabled: false, icon: true, color: { kind: 'default' }, ...overrides }
}

describe('computeSegmentFieldDefaults（八欄位型各一）', () => {
  it('row：恆適用，預設 descriptor {kind:firstRow}', () => {
    const d = fakeDescriptor({ id: 'cost', category: 'always' })
    expect(computeSegmentFieldDefaults('cost', d).row).toEqual({
      applicable: true,
      descriptor: { kind: 'firstRow' },
    })
  })

  it('icon：恆適用，預設 descriptor {kind:iconState,on:true}（defaultSegmentConfig().icon===true）', () => {
    const d = fakeDescriptor({ id: 'cost', category: 'always' })
    expect(computeSegmentFieldDefaults('cost', d).icon).toEqual({
      applicable: true,
      descriptor: { kind: 'iconState', on: true },
    })
  })

  it('prefix：恆適用，預設 descriptor {kind:emptyPrefix}', () => {
    const d = fakeDescriptor({ id: 'cost', category: 'always' })
    expect(computeSegmentFieldDefaults('cost', d).prefix).toEqual({
      applicable: true,
      descriptor: { kind: 'emptyPrefix' },
    })
  })

  it('variant：有 variants 之段 → 適用，descriptor 攜帶 variants[0] 原值（不在此查表組字串）', () => {
    const d = fakeDescriptor({ id: 'cwd', category: 'always', variants: ['full', 'basename', 'tilde'] })
    expect(computeSegmentFieldDefaults('cwd', d).variant).toEqual({
      applicable: true,
      descriptor: { kind: 'variant', value: 'full' },
    })
  })

  it('variant：無 variants 之段 → 不適用，descriptor 為 null', () => {
    const d = fakeDescriptor({ id: 'cost', category: 'always' })
    expect(computeSegmentFieldDefaults('cost', d).variant).toEqual({
      applicable: false,
      descriptor: null,
    })
  })

  it('variant：對照表查無時原值原樣攜帶（查表與缺表 fallback 移交呼叫端，本檔僅傳遞原值）', () => {
    const d = fakeDescriptor({ id: 'cwd', category: 'always', variants: ['未登錄值'] })
    expect(computeSegmentFieldDefaults('cwd', d).variant).toEqual({
      applicable: true,
      descriptor: { kind: 'variant', value: '未登錄值' },
    })
  })

  it('color：恆適用，預設 descriptor {kind:colorDefault}（defaultSegmentConfig().color）', () => {
    const d = fakeDescriptor({ id: 'cost', category: 'always' })
    expect(computeSegmentFieldDefaults('cost', d).color).toEqual({
      applicable: true,
      descriptor: { kind: 'colorDefault' },
    })
  })

  it('fgOverride：恆適用，預設 descriptor {kind:noFgOverride}', () => {
    const d = fakeDescriptor({ id: 'cost', category: 'always' })
    expect(computeSegmentFieldDefaults('cost', d).fgOverride).toEqual({
      applicable: true,
      descriptor: { kind: 'noFgOverride' },
    })
  })

  it('threshold：percentage 段 → 適用，預設 descriptor {kind:noThreshold}', () => {
    const d = fakeDescriptor({ id: 'context-used', category: 'percentage' })
    expect(computeSegmentFieldDefaults('context-used', d).threshold).toEqual({
      applicable: true,
      descriptor: { kind: 'noThreshold' },
    })
  })

  it('threshold：非 percentage 段 → 不適用，descriptor 為 null', () => {
    const d = fakeDescriptor({ id: 'cost', category: 'always' })
    expect(computeSegmentFieldDefaults('cost', d).threshold).toEqual({
      applicable: false,
      descriptor: null,
    })
  })

  it('bar：percentage 段 → 適用，預設 descriptor {kind:barState,on:false}', () => {
    const d = fakeDescriptor({ id: 'context-used', category: 'percentage' })
    expect(computeSegmentFieldDefaults('context-used', d).bar).toEqual({
      applicable: true,
      descriptor: { kind: 'barState', on: false },
    })
  })

  it('bar：非 percentage 段 → 不適用，descriptor 為 null', () => {
    const d = fakeDescriptor({ id: 'git-branch', category: 'shell-out' })
    expect(computeSegmentFieldDefaults('git-branch', d).bar).toEqual({
      applicable: false,
      descriptor: null,
    })
  })

  it('rate-5h 型（percentage＋variants 並存）：variant／threshold／bar 三欄皆適用', () => {
    const d = fakeDescriptor({ id: 'rate-5h', category: 'percentage', variants: ['percent', 'percent-reset'] })
    const result = computeSegmentFieldDefaults('rate-5h', d)
    expect(result.variant).toEqual({ applicable: true, descriptor: { kind: 'variant', value: 'percent' } })
    expect(result.threshold.applicable).toBe(true)
    expect(result.bar.applicable).toBe(true)
  })
})

describe('colorDisplayLabel（窮盡四態）', () => {
  it('default → 終端預設', () => {
    expect(colorDisplayLabel({ kind: 'default' })).toBe('終端預設')
  })
  it('auto → 自動配色', () => {
    expect(colorDisplayLabel({ kind: 'auto' })).toBe('自動配色')
  })
  it('ansi256 → ansi256SwatchName 鏡像', () => {
    expect(colorDisplayLabel(ansi(196))).toBe('ANSI 196 #ff0000')
  })
  it('truecolor → hex 原樣', () => {
    expect(colorDisplayLabel({ kind: 'truecolor', hex: '#abcdef' })).toBe('#abcdef')
  })
})

describe('isSegmentFieldAtDefault（供 T2.2：現值是否＝預設）', () => {
  const always = fakeDescriptor({ id: 'cost', category: 'always' })
  const withVariants = fakeDescriptor({ id: 'cwd', category: 'always', variants: ['full', 'basename', 'tilde'] })
  const percentage = fakeDescriptor({ id: 'context-used', category: 'percentage' })

  const cases: Array<{
    key: SegmentFieldKey
    descriptor: SegmentDescriptor
    atDefault: SegmentConfig
    notAtDefault: SegmentConfig
  }> = [
    { key: 'row', descriptor: always, atDefault: fakeSeg('cost'), notAtDefault: fakeSeg('cost', { row: 2 }) },
    {
      key: 'icon',
      descriptor: always,
      atDefault: fakeSeg('cost', { icon: true }),
      notAtDefault: fakeSeg('cost', { icon: false }),
    },
    {
      key: 'prefix',
      descriptor: always,
      atDefault: fakeSeg('cost'),
      notAtDefault: fakeSeg('cost', { prefix: 'C:' }),
    },
    {
      key: 'variant',
      descriptor: withVariants,
      atDefault: fakeSeg('cwd', { variant: 'full' }),
      notAtDefault: fakeSeg('cwd', { variant: 'basename' }),
    },
    {
      key: 'color',
      descriptor: always,
      atDefault: fakeSeg('cost'),
      notAtDefault: fakeSeg('cost', { color: ansi(46) }),
    },
    {
      key: 'fgOverride',
      descriptor: always,
      atDefault: fakeSeg('cost'),
      notAtDefault: fakeSeg('cost', { fgOverride: { kind: 'truecolor', hex: '#000000' } }),
    },
    {
      key: 'threshold',
      descriptor: percentage,
      atDefault: fakeSeg('context-used'),
      notAtDefault: fakeSeg('context-used', {
        threshold: {
          buckets: Array(10).fill({ kind: 'default' }) as unknown as ThresholdRule['buckets'],
        },
      }),
    },
    {
      key: 'bar',
      descriptor: percentage,
      atDefault: fakeSeg('context-used'),
      notAtDefault: fakeSeg('context-used', { bar: true }),
    },
  ]

  for (const { key, descriptor, atDefault, notAtDefault } of cases) {
    it(`${key}：未改動視為預設`, () => {
      expect(isSegmentFieldAtDefault(atDefault, descriptor, key)).toBe(true)
    })
    it(`${key}：已改動判定非預設`, () => {
      expect(isSegmentFieldAtDefault(notAtDefault, descriptor, key)).toBe(false)
    })
  }

  it('variant：無 variants 之段恆視為預設（缺欄可比較，不因段無此欄而誤判）', () => {
    expect(isSegmentFieldAtDefault(fakeSeg('cost'), always, 'variant')).toBe(true)
  })

  it('缺欄與明示預設值同義（row 缺欄 ≡ row:0；bar 缺欄 ≡ bar:false）', () => {
    expect(isSegmentFieldAtDefault(fakeSeg('cost', { row: 0 }), always, 'row')).toBe(true)
    expect(isSegmentFieldAtDefault(fakeSeg('context-used', { bar: false }), percentage, 'bar')).toBe(true)
  })
})
