/**
 * S5-T1.3（(internal design doc) §D2／§Verification 1
 * 閾值矩陣）：bucketIndex 上下界 clamp＋小數＋NaN／型別外滲入矩陣、
 * 桶覆蓋區間 [i*10,(i+1)*10)、模板預填陣列釘值＋與 color.ts 公式
 * 一致性（ansi256ToHex 對照）、auto-fg 成對陣列（派生律＋釘值＋
 * fgOverride 全桶）。
 *
 * 08-statusline-catalog-expansion T3.5（PLAN.md Rev 4 §3）：新增
 * limit-gradient／remaining-gradient 雙模板登記案（尾插、既有 4 套
 * 不變、互為逆序）。
 */
import { describe, expect, it } from 'vitest'
import { ansi256ToHex, autoFg, type ColorSpec } from './color.js'
import {
  autoFgBuckets,
  bucketIndex,
  THRESHOLD_BUCKET_COUNT,
  THRESHOLD_TEMPLATE_IDS,
  THRESHOLD_TEMPLATES,
  type ThresholdBuckets,
  type ThresholdRule,
} from './threshold.js'

const ansi = (index: number): ColorSpec => ({ kind: 'ansi256', index })

describe('bucketIndex（idx = max(0, min(floor(p/10), 9))）', () => {
  it.each([
    [-5, 0],
    [0, 0],
    [9.9, 0],
    [9.99, 0],
    [10.0, 1],
    [55, 5],
    [99, 9],
    [100, 9],
    [105, 9],
  ])('p=%s → %i', (p, expected) => {
    expect(bucketIndex(p)).toBe(expected)
  })

  it('NaN → 0（防禦性定義，與 clampAnsi256Index 同源）', () => {
    expect(bucketIndex(Number.NaN)).toBe(0)
  })

  it('±Infinity 隨公式收邊：+∞ → 9、-∞ → 0', () => {
    expect(bucketIndex(Number.POSITIVE_INFINITY)).toBe(9)
    expect(bucketIndex(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('-0 → 0（正零）', () => {
    expect(Object.is(bucketIndex(-0), 0)).toBe(true)
  })

  it('型別外滲入亦有定義：null → 0（上游 dash 政策應擋，此為保底）', () => {
    expect(bucketIndex(null as unknown as number)).toBe(0)
  })

  it('桶 i 覆蓋 [i*10, (i+1)*10)：下緣含、上緣不含', () => {
    for (let i = 0; i < THRESHOLD_BUCKET_COUNT; i++) {
      expect(bucketIndex(i * 10), `下緣 ${i * 10}`).toBe(i)
      expect(bucketIndex(i * 10 + 9.999), `上緣內 ${i * 10 + 9.999}`).toBe(i)
      expect(bucketIndex((i + 1) * 10), `上緣外 ${(i + 1) * 10}`).toBe(Math.min(i + 1, 9))
    }
  })
})

describe('模板（6 套預填 10-tuple，ansi256 軌；08 T3.5 新增 limit-gradient／remaining-gradient 尾插）', () => {
  it('id 一覽恰 6 套、既有 4 套原順序不動、新兩套尾插，與 record 鍵一致', () => {
    expect(THRESHOLD_TEMPLATE_IDS).toEqual([
      'traffic',
      'traffic-inv',
      'cool-warm',
      'mono-fade',
      'limit-gradient',
      'remaining-gradient',
    ])
    expect(Object.keys(THRESHOLD_TEMPLATES).sort()).toEqual([...THRESHOLD_TEMPLATE_IDS].sort())
  })

  it('每套恰 10 桶、全為 ansi256、索引為 0–255 整數', () => {
    for (const id of THRESHOLD_TEMPLATE_IDS) {
      const { buckets } = THRESHOLD_TEMPLATES[id]
      expect(buckets, id).toHaveLength(THRESHOLD_BUCKET_COUNT)
      for (const bucket of buckets) {
        expect(bucket.kind, id).toBe('ansi256')
        if (bucket.kind === 'ansi256') {
          expect(Number.isInteger(bucket.index), id).toBe(true)
          expect(bucket.index, id).toBeGreaterThanOrEqual(0)
          expect(bucket.index, id).toBeLessThanOrEqual(255)
        }
      }
    }
  })

  it.each([
    ['traffic', [46, 82, 118, 154, 190, 226, 220, 214, 208, 196]],
    ['traffic-inv', [196, 208, 214, 220, 226, 190, 154, 118, 82, 46]],
    ['cool-warm', [21, 57, 93, 129, 165, 200, 199, 198, 197, 196]],
    ['mono-fade', [232, 235, 237, 240, 242, 245, 247, 250, 252, 255]],
    ['limit-gradient', [244, 246, 247, 249, 250, 34, 34, 34, 220, 196]],
    ['remaining-gradient', [196, 220, 34, 34, 34, 250, 249, 247, 246, 244]],
  ] as const)('%s 釘值', (id, indices) => {
    expect(THRESHOLD_TEMPLATES[id].buckets).toEqual(indices.map(ansi))
  })

  it('traffic-inv ＝ traffic 逆序', () => {
    expect(THRESHOLD_TEMPLATES['traffic-inv'].buckets).toEqual(
      [...THRESHOLD_TEMPLATES.traffic.buckets].reverse(),
    )
  })

  it('remaining-gradient ＝ limit-gradient 逆序（08 T3.5：閾值輸入一律＝該段原始值，不做隱式反轉）', () => {
    expect(THRESHOLD_TEMPLATES['remaining-gradient'].buckets).toEqual(
      [...THRESHOLD_TEMPLATES['limit-gradient'].buckets].reverse(),
    )
  })

  it('取色與 color.ts 公式一致（端點／中點 hex 對照）', () => {
    const hexAt = (id: keyof typeof THRESHOLD_TEMPLATES, i: number): string => {
      const bucket = THRESHOLD_TEMPLATES[id].buckets[i]!
      return bucket.kind === 'ansi256' ? ansi256ToHex(bucket.index) : 'not-ansi256'
    }
    expect(hexAt('traffic', 0)).toBe('#00ff00') // 綠端
    expect(hexAt('traffic', 5)).toBe('#ffff00') // 黃中
    expect(hexAt('traffic', 9)).toBe('#ff0000') // 紅端
    expect(hexAt('cool-warm', 0)).toBe('#0000ff') // 冷端
    expect(hexAt('cool-warm', 9)).toBe('#ff0000') // 暖端
    expect(hexAt('mono-fade', 0)).toBe('#080808') // 灰階 232
    expect(hexAt('mono-fade', 9)).toBe('#eeeeee') // 灰階 255
    expect(hexAt('limit-gradient', 0)).toBe('#808080') // 灰階 244 起點
    expect(hexAt('limit-gradient', 4)).toBe('#bcbcbc') // 灰階 250（0–49% 段末）
    expect(hexAt('limit-gradient', 5)).toBe('#00af00') // 綠三桶起（色立方 34）
    expect(hexAt('limit-gradient', 8)).toBe('#ffd700') // 黃（色立方 220）
    expect(hexAt('limit-gradient', 9)).toBe('#ff0000') // 紅端（色立方 196）
    expect(hexAt('remaining-gradient', 0)).toBe('#ff0000') // 逆序：紅端在前
    expect(hexAt('remaining-gradient', 9)).toBe('#808080') // 逆序：灰階在末
  })

  it('模板深凍結（record／rule／tuple／各桶）——UI 套用須複製', () => {
    expect(Object.isFrozen(THRESHOLD_TEMPLATES)).toBe(true)
    for (const id of THRESHOLD_TEMPLATE_IDS) {
      const rule = THRESHOLD_TEMPLATES[id]
      expect(Object.isFrozen(rule), id).toBe(true)
      expect(Object.isFrozen(rule.buckets), id).toBe(true)
      for (const bucket of rule.buckets) expect(Object.isFrozen(bucket), id).toBe(true)
    }
  })
})

describe('autoFgBuckets（D2：emit 期預算成對陣列，執行期只索引）', () => {
  it('派生律：逐桶 == autoFg(bucket)（全模板）', () => {
    for (const id of THRESHOLD_TEMPLATE_IDS) {
      const rule = THRESHOLD_TEMPLATES[id]
      expect(autoFgBuckets(rule), id).toEqual(rule.buckets.map((b) => autoFg(b)))
    }
  })

  it('traffic 全桶黑字（綠/黃/橙/紅底皆判黑，含 #ff0000 反直覺案）', () => {
    expect(autoFgBuckets(THRESHOLD_TEMPLATES.traffic)).toEqual(Array(10).fill(ansi(16)))
  })

  it('mono-fade 前 5 桶白字、後 5 桶黑字（分界 #757575/#767676 之兩側）', () => {
    expect(autoFgBuckets(THRESHOLD_TEMPLATES['mono-fade'])).toEqual([
      ...Array(5).fill(ansi(231)),
      ...Array(5).fill(ansi(16)),
    ])
  })

  it('cool-warm 端點：藍底 → 白 231、紅底 → 黑 16', () => {
    const fgs = autoFgBuckets(THRESHOLD_TEMPLATES['cool-warm'])
    expect(fgs[0]).toEqual(ansi(231))
    expect(fgs[9]).toEqual(ansi(16))
  })

  it('自訂 rule：truecolor 桶走 truecolor 黑/白、default 桶 → default（色軌一致）', () => {
    const rule: ThresholdRule = {
      buckets: [
        { kind: 'truecolor', hex: '#ffffff' },
        { kind: 'truecolor', hex: '#000000' },
        { kind: 'default' },
        ...Array(7).fill(ansi(196)),
      ] as unknown as ThresholdBuckets,
    }
    const fgs = autoFgBuckets(rule)
    expect(fgs[0]).toEqual({ kind: 'truecolor', hex: '#000000' })
    expect(fgs[1]).toEqual({ kind: 'truecolor', hex: '#ffffff' })
    expect(fgs[2]).toEqual({ kind: 'default' })
    expect(fgs[3]).toEqual(ansi(16))
  })

  it('fgOverride 存在時全桶用之（不經亮度判定，default 桶亦覆蓋）', () => {
    const override: ColorSpec = { kind: 'truecolor', hex: '#123456' }
    const fgs = autoFgBuckets(THRESHOLD_TEMPLATES['cool-warm'], override)
    expect(fgs).toHaveLength(10)
    for (const fg of fgs) expect(fg).toEqual(override)

    const ruleWithDefault: ThresholdRule = {
      buckets: Array(10).fill({ kind: 'default' }) as unknown as ThresholdBuckets,
    }
    expect(autoFgBuckets(ruleWithDefault, ansi(0))).toEqual(Array(10).fill(ansi(0)))
  })

  it('回傳新 tuple（非 rule.buckets 別名），長度恆 10', () => {
    const rule = THRESHOLD_TEMPLATES.traffic
    const fgs = autoFgBuckets(rule)
    expect(fgs).not.toBe(rule.buckets)
    expect(fgs).toHaveLength(THRESHOLD_BUCKET_COUNT)
  })
})
