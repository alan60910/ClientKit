/**
 * T3.2（(internal design doc) §D2′；TASKS.md T3.2）：
 * sample-values.ts 單元測試——lazy／per-locale 快取命中／reset hook／
 * 單段合成正確性（抽樣對照 S2-RESULT.md 已實測值）／逐段空值 fallback／
 * 整批擲錯 fallback（皆以 `resolveFn` 注入替身構造 S2 在 FULL mock 下不可
 * 達的空值／擲錯情境，見 sample-values.ts 檔頭「測試注入面」）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { resolve } from './resolve.js'
import { SEGMENT_IDS } from './segments.js'
import {
  getSampleValue,
  getSampleValues,
  resetSampleValueCacheForTests,
  type ResolveFn,
} from './sample-values.js'

beforeEach(() => {
  resetSampleValueCacheForTests()
})

describe('lazy：resolveFn 於首次呼叫前不觸發，首次呼叫才整批合成', () => {
  it('未呼叫 getSampleValues／getSampleValue 前，注入的 resolveFn 呼叫次數為 0', () => {
    let calls = 0
    const counting: ResolveFn = (cfg, input) => {
      calls++
      return resolve(cfg, input)
    }
    expect(calls).toBe(0)
    getSampleValues('zh-Hant', counting)
    expect(calls).toBe(SEGMENT_IDS.length) // 首次呼叫才逐段（30 段）合成。
  })

  it('getSampleValue（單段 accessor）同樣延後至首次呼叫才觸發整批合成', () => {
    let calls = 0
    const counting: ResolveFn = (cfg, input) => {
      calls++
      return resolve(cfg, input)
    }
    expect(calls).toBe(0)
    getSampleValue('model', 'zh-Hant', counting)
    expect(calls).toBe(SEGMENT_IDS.length)
  })
})

describe('per-locale 快取命中', () => {
  it('同 locale 重複呼叫回同一快取物件（引用相等）且不重新觸發 resolveFn', () => {
    let calls = 0
    const counting: ResolveFn = (cfg, input) => {
      calls++
      return resolve(cfg, input)
    }
    const first = getSampleValues('zh-Hant', counting)
    expect(calls).toBe(SEGMENT_IDS.length)
    const second = getSampleValues('zh-Hant', counting)
    expect(second).toBe(first) // 快取命中：同一物件參照。
    expect(calls).toBe(SEGMENT_IDS.length) // 未新增呼叫。
  })

  it('不同 locale 各自獨立快取（互不覆蓋、各自觸發一次合成）', () => {
    let calls = 0
    const counting: ResolveFn = (cfg, input) => {
      calls++
      return resolve(cfg, input)
    }
    const zh = getSampleValues('zh-Hant', counting)
    const en = getSampleValues('en', counting)
    expect(zh).not.toBe(en)
    expect(calls).toBe(SEGMENT_IDS.length * 2)
  })
})

describe('reset hook：resetSampleValueCacheForTests 清空全部 locale 快取', () => {
  it('reset 後同 locale 重新呼叫會再次整批合成（非沿用舊快取物件）', () => {
    let calls = 0
    const counting: ResolveFn = (cfg, input) => {
      calls++
      return resolve(cfg, input)
    }
    const before = getSampleValues('zh-Hant', counting)
    expect(calls).toBe(SEGMENT_IDS.length)
    resetSampleValueCacheForTests()
    const after = getSampleValues('zh-Hant', counting)
    expect(calls).toBe(SEGMENT_IDS.length * 2)
    expect(after).not.toBe(before) // 新物件，非同一快取參照殘留。
    expect(after).toEqual(before) // 但合成內容不變（同 locale、同 FULL mock）。
  })
})

describe('單段合成正確性（抽樣對照 S2-RESULT.md 已實測值，真 resolve、零注入）', () => {
  it('model／cwd／context-used／git-branch 四段樣例文字與 S2 dump 逐字一致', () => {
    const zh = getSampleValues('zh-Hant')
    expect(zh.model).toBe('model: Fable 5')
    expect(zh.cwd).toBe('cwd: /home/user/projects/ClientKit')
    expect(zh['context-used']).toBe('used: 42%')
    expect(zh['git-branch']).toBe('git: DEV')
  })

  it('30 段皆有樣例（SEGMENT_IDS 全覆蓋，鍵集合相等）', () => {
    const zh = getSampleValues('zh-Hant')
    expect(Object.keys(zh).sort()).toEqual([...SEGMENT_IDS].sort())
  })

  it('FULL mock 下 S2 已證 30/30 段非空——真 resolve 合成結果不含 fallback 文案', () => {
    const zh = getSampleValues('zh-Hant')
    for (const id of SEGMENT_IDS) {
      expect(zh[id]).not.toBe('（無樣例）')
      expect(zh[id]).not.toBe('')
    }
  })
})

describe('fallback（1）逐段空值：resolveFn 回傳空 runs → 該段改顯 locale 相依 fallback 文案', () => {
  it('注入替身令 model 段回傳 [[]]（S2 實測 FULL 下不可達，此處合成情境獨立驗證）', () => {
    const stub: ResolveFn = (cfg, input) => {
      const targetId = cfg.segments.find((seg) => seg.enabled)?.id
      if (targetId === 'model') return [[]]
      return resolve(cfg, input)
    }
    const zh = getSampleValues('zh-Hant', stub)
    expect(zh.model).toBe('（無樣例）')
    // 其餘段不受影響、仍為真合成值（僅 model 這一段被替身攔截）。
    expect(zh.cwd).toBe('cwd: /home/user/projects/ClientKit')
  })

  it('en locale 下同一空值情境改顯英文 fallback 文案', () => {
    const stub: ResolveFn = (cfg, input) => {
      const targetId = cfg.segments.find((seg) => seg.enabled)?.id
      if (targetId === 'model') return [[]]
      return resolve(cfg, input)
    }
    const en = getSampleValues('en', stub)
    expect(en.model).toBe('(no sample)')
  })
})

describe('fallback（2）整批擲錯：resolveFn 對任一段擲錯 → 整批 fallback、不阻斷（零 throw 外洩）', () => {
  it('注入替身令 duration 段擲錯 → 全部 30 段（含未擲錯的其餘段）皆 fallback', () => {
    const throwing: ResolveFn = (cfg) => {
      const targetId = cfg.segments.find((seg) => seg.enabled)?.id
      if (targetId === 'duration') throw new Error('模擬 resolve 擲錯')
      throw new Error('unreachable：本案僅驗證擲錯即整批 fallback，其餘段呼叫與否不影響結論')
    }
    expect(() => getSampleValues('zh-Hant', throwing)).not.toThrow()
    const zh = getSampleValues('zh-Hant', throwing)
    for (const id of SEGMENT_IDS) expect(zh[id]).toBe('（無樣例）')
  })

  it('getSampleValue（單段 accessor）同樣不因整批擲錯而拋出', () => {
    const throwing: ResolveFn = () => {
      throw new Error('模擬 resolve 擲錯')
    }
    expect(() => getSampleValue('model', 'en', throwing)).not.toThrow()
    expect(getSampleValue('model', 'en', throwing)).toBe('(no sample)')
  })
})

describe('getSampleValue：查無對應 id 時防禦性退 fallback（理論上不應發生，config 恆對齊真 catalog）', () => {
  it('傳入不存在的 id → 回傳 fallback 文案而非 undefined／拋錯', () => {
    expect(getSampleValue('not-a-real-segment-id', 'zh-Hant')).toBe('（無樣例）')
  })
})
