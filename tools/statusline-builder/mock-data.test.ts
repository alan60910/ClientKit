/**
 * S5-T2.1（(internal design doc) §D1 欄位多樣性要求／
 * §預覽契約 mock 情境）：
 * - mirror roundtrip：data 可 1:1 JSON.stringify 餵 stdin（嚴格等值，
 *   條件缺席＝鍵不存在、無 undefined 佔位）。
 * - 欄位多樣性不變量（機械，遍歷 catalog×情境）：每 descriptor 來源
 *   欄位至少兩相異值且至少一情境非 null——§3 真執行對每條路徑可觀測，
 *   打錯 jqPath/ps1Path 不得靜默通過。
 * - 情境角色釘死：滿血全段存活／early-null dash 段全 null／
 *   conditional-absent 條件段全剔＋非 git／worktree fallback 兩路徑
 *   皆有情境覆蓋。
 * - T4.5（(internal design doc) Rev 4 §3）：cache-hit
 *   情境點（full 存活／四欄全 0 除零／partial-null 矩陣 test-only 資料）
 *   ＋情境固定 `now` 欄不變量（resets_at 一律 now 相對式且絕對值保持）。
 */
import { describe, expect, it } from 'vitest'
import {
  MOCK_SCENARIOS,
  MOCK_SCENARIOS_BY_ID,
  scenarioStdinJson,
  type MockScenario,
  type MockShellChannel,
} from './mock-data.js'
import {
  DESCRIPTORS_BY_ID,
  isValueDead,
  SEGMENT_DESCRIPTORS,
  type SegmentDescriptor,
  type StatusData,
} from './segments.js'

/** descriptor 的來源值（shell-out 走 shell 通道，其餘走 tsPath）。 */
function sourceValues(descriptor: SegmentDescriptor): unknown[] {
  if (descriptor.category === 'shell-out') {
    return MOCK_SCENARIOS.map((s) => s.shell[descriptor.id as keyof MockShellChannel])
  }
  return MOCK_SCENARIOS.map((s) => descriptor.tsPath(s.data))
}

/** undefined 可辨識的等值編碼（JSON.stringify(undefined)＝undefined，需特判）。 */
const encode = (v: unknown): string => (v === undefined ? '<undefined>' : JSON.stringify(v))

const scenarioCases = MOCK_SCENARIOS.map((s) => [s.id, s] as [string, MockScenario])
// T4.5（08-PLAN Rev 4 §3）：mock-data.ts 補齊 cache 兩欄後，cache-hit 於
// full（45）／conditional-absent（0）有存活值——T3.2 時期的 D1 排除已移除，
// 全目錄一體適用。
const descriptorCases = SEGMENT_DESCRIPTORS.map((d) => [d.id, d] as [string, SegmentDescriptor])

// ── 情境集形狀 ──

describe('canonical 情境集', () => {
  it('恰為 PLAN 預覽契約四情境、順序固定（SP-0 對帳重建時更新此釘）', () => {
    expect(MOCK_SCENARIOS.map((s) => s.id)).toEqual([
      'full',
      'early-null',
      'conditional-absent',
      'windows-cjk',
    ])
  })

  it('provisional 體制：全情境 provisional=true', () => {
    expect(MOCK_SCENARIOS.every((s) => s.provisional === true)).toBe(true)
  })

  it('label／note 非空（radiogroup accessible label 素材）', () => {
    for (const s of MOCK_SCENARIOS) {
      expect(s.label.length, s.id).toBeGreaterThan(0)
      expect(s.note.length, s.id).toBeGreaterThan(0)
    }
  })

  it('shell 通道鍵覆蓋全部 shell-out 段（目錄同步機械釘）', () => {
    const shellOutIds = SEGMENT_DESCRIPTORS.filter((d) => d.category === 'shell-out').map(
      (d) => d.id,
    )
    for (const s of MOCK_SCENARIOS) {
      for (const id of shellOutIds) {
        expect(Object.prototype.hasOwnProperty.call(s.shell, id), `${s.id}/${id}`).toBe(true)
      }
    }
  })

  it('情境集深凍結', () => {
    expect(Object.isFrozen(MOCK_SCENARIOS)).toBe(true)
    for (const s of MOCK_SCENARIOS) {
      expect(Object.isFrozen(s), s.id).toBe(true)
      expect(Object.isFrozen(s.data), s.id).toBe(true)
      expect(Object.isFrozen(s.shell), s.id).toBe(true)
    }
  })
})

// ── mirror roundtrip（1:1 餵 stdin 契約） ──

describe('mirror roundtrip', () => {
  it.each(scenarioCases)('%s：JSON.stringify→parse 嚴格等值（無 undefined 佔位）', (_id, s) => {
    expect(JSON.parse(JSON.stringify(s.data))).toStrictEqual(s.data)
    expect(JSON.parse(scenarioStdinJson(s))).toStrictEqual(s.data)
  })
})

// ── 欄位多樣性不變量（D1，機械遍歷 catalog×情境） ──

describe('欄位多樣性不變量（D1）', () => {
  it.each(descriptorCases)('%s：至少兩相異值且至少一情境非 null', (_id, d) => {
    const values = sourceValues(d)
    expect(new Set(values.map(encode)).size).toBeGreaterThanOrEqual(2)
    expect(values.some((v) => v !== null && v !== undefined)).toBe(true)
  })

  it.each(
    SEGMENT_DESCRIPTORS.filter((d) => d.resetsAt !== undefined).map(
      (d) => [d.id, d] as [string, SegmentDescriptor],
    ),
  )('%s resetsAt 路徑：至少兩相異值且至少一情境非 null', (_id, d) => {
    const values = MOCK_SCENARIOS.map((s) => d.resetsAt!.tsPath(s.data))
    expect(new Set(values.map(encode)).size).toBeGreaterThanOrEqual(2)
    expect(values.some((v) => v !== null && v !== undefined)).toBe(true)
  })
})

// ── 情境角色釘死 ──

describe('情境角色', () => {
  it('full：全 30 段來源值存活（resolve 滿血預覽的前提；T4.5 補 cache 兩欄後含 cache-hit）', () => {
    const full = MOCK_SCENARIOS_BY_ID['full']
    for (const d of SEGMENT_DESCRIPTORS) {
      const v =
        d.category === 'shell-out'
          ? full.shell[d.id as keyof MockShellChannel]
          : d.tsPath(full.data)
      expect(isValueDead(v), d.id).toBe(false)
    }
  })

  it('early-null：dash 七段來源值全 nullish（"--" 顯示情境）', () => {
    const early = MOCK_SCENARIOS_BY_ID['early-null']
    for (const d of SEGMENT_DESCRIPTORS.filter((x) => x.nullPolicy === 'dash')) {
      expect(d.tsPath(early.data) == null, d.id).toBe(true)
    }
    expect(early.data.context_window.current_usage).toBeNull()
  })

  it('conditional-absent：條件 7 段全 undefined＋非 git（shell 兩段死值）', () => {
    const cond = MOCK_SCENARIOS_BY_ID['conditional-absent']
    for (const d of SEGMENT_DESCRIPTORS.filter((x) => x.category === 'conditional')) {
      expect(d.tsPath(cond.data), d.id).toBeUndefined()
    }
    expect(isValueDead(cond.shell['git-branch'])).toBe(true)
    expect(isValueDead(cond.shell['git-dirty'])).toBe(true)
  })

  it('worktree 名稱段 fallback＋worktree-branch 兩路徑皆有情境覆蓋', () => {
    const worktree = SEGMENT_DESCRIPTORS.find((d) => d.id === 'worktree')!
    const branch = SEGMENT_DESCRIPTORS.find((d) => d.id === 'worktree-branch')!
    const full = MOCK_SCENARIOS_BY_ID['full']
    const win = MOCK_SCENARIOS_BY_ID['windows-cjk']
    // full：SP-0 L22 雙表述並存——git_worktree 與 top-level worktree 同時在，
    // 名稱段走 git_worktree 優先路徑；branch 取 worktree.branch。
    expect(full.data.workspace.git_worktree).toBe('feature-statusline')
    expect(full.data.worktree?.name).toBe('feature-statusline')
    expect(worktree.tsPath(full.data)).toBe('feature-statusline')
    expect(branch.tsPath(full.data)).toBe('wt-feature-statusline')
    // windows-cjk：無 git_worktree → 名稱段走 top-level worktree.name fallback；
    // worktree-branch 取 worktree.branch（CJK）。
    expect(win.data.workspace.git_worktree).toBeUndefined()
    expect(worktree.tsPath(win.data)).toBe('hotfix-字型')
    expect(branch.tsPath(win.data)).toBe('分支-字型修正')
  })

  it('windows-cjk：反斜線路徑＋CJK 值（escaping／預覽對抗素材）', () => {
    const win = MOCK_SCENARIOS_BY_ID['windows-cjk']
    expect(win.data.cwd).toContain('\\')
    expect(win.data.cwd).toMatch(/[一-鿿]/)
    expect(win.env.home).toContain('\\')
    expect(win.shell['git-branch']).toMatch(/[一-鿿]/)
    expect(win.data.exceeds_200k_tokens).toBe(true)
    // seven_day.resets_at null＝「視窗在、resets_at null」的後綴剔除情境
    expect(win.data.rate_limits?.seven_day?.resets_at).toBeNull()
  })
})

// ── cache-hit 情境點＋partial-null 矩陣（T4.5，08-PLAN Rev 4 §3） ──

describe('cache-hit 情境點（T4.5）', () => {
  const cacheHit = DESCRIPTORS_BY_ID['cache-hit']

  it('full：四欄齊備 → 45（floor(45000*100/100000)，存活值）', () => {
    expect(cacheHit.tsPath(MOCK_SCENARIOS_BY_ID['full'].data)).toBe(45)
  })

  it('conditional-absent：四欄全 0 → 0（除零守門，非 null）', () => {
    const cond = MOCK_SCENARIOS_BY_ID['conditional-absent']
    expect(cond.data.context_window.current_usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    })
    expect(cacheHit.tsPath(cond.data)).toBe(0)
  })

  it('windows-cjk：cache_read null（partial-null 代表點）→ null', () => {
    const win = MOCK_SCENARIOS_BY_ID['windows-cjk']
    expect(win.data.context_window.current_usage?.cache_read_input_tokens).toBeNull()
    expect(cacheHit.tsPath(win.data)).toBeNull()
  })

  it('early-null：current_usage 整包 null → null', () => {
    expect(cacheHit.tsPath(MOCK_SCENARIOS_BY_ID['early-null'].data)).toBeNull()
  })

  // partial-null 矩陣（test-only 資料——08-PLAN Rev 4 §3「欄位組合而非新
  // scenario id」）：以 full 為基底，公式三輸入欄各自 null → 恆 null；
  // 選填 cache 兩欄另驗「鍵缺席」形（CurrentUsage 收窄後合法缺席態）。
  const cloneFull = (): StatusData =>
    JSON.parse(JSON.stringify(MOCK_SCENARIOS_BY_ID['full'].data)) as StatusData

  it.each([
    ['input_tokens'],
    ['cache_creation_input_tokens'],
    ['cache_read_input_tokens'],
  ] as const)('partial-null 矩陣：%s=null → null', (field) => {
    const data = cloneFull()
    data.context_window.current_usage![field] = null
    expect(cacheHit.tsPath(data)).toBeNull()
  })

  it.each([['cache_creation_input_tokens'], ['cache_read_input_tokens']] as const)(
    'partial-null 矩陣：%s 鍵缺席 → null',
    (field) => {
      const data = cloneFull()
      delete data.context_window.current_usage![field]
      expect(cacheHit.tsPath(data)).toBeNull()
    },
  )

  it('矩陣對照：output_tokens=null 不參與公式 → 仍 45', () => {
    const data = cloneFull()
    data.context_window.current_usage!.output_tokens = null
    expect(cacheHit.tsPath(data)).toBe(45)
  })
})

// ── 情境固定 now（T4.5，08-PLAN Rev 4 §3） ──

describe('情境固定 now（T4.5）', () => {
  it.each(scenarioCases)('%s：now 為正整數 epoch 秒', (_id, s) => {
    expect(Number.isInteger(s.now)).toBe(true)
    expect(s.now).toBeGreaterThan(0)
  })

  it('now 值四情境互異（決定論 mock 時鐘多樣性）', () => {
    expect(new Set(MOCK_SCENARIOS.map((s) => s.now)).size).toBe(MOCK_SCENARIOS.length)
  })

  it.each(scenarioCases)('%s：非 null resets_at 恆 > now（now 相對式 → 倒數永不過期）', (_id, s) => {
    const windows = [s.data.rate_limits?.five_hour, s.data.rate_limits?.seven_day]
    for (const w of windows) {
      if (w?.resets_at != null) expect(w.resets_at).toBeGreaterThan(s.now)
    }
  })

  it('resets_at 絕對值維持既有字面（消費端註解／WORKS 紀錄引用不失效）', () => {
    const full = MOCK_SCENARIOS_BY_ID['full']
    const win = MOCK_SCENARIOS_BY_ID['windows-cjk']
    // full：five_hour＝now+2h、seven_day＝now+4d18h（原 1783497600／1783900800）。
    expect(full.data.rate_limits?.five_hour?.resets_at).toBe(1783497600)
    expect(full.data.rate_limits?.five_hour?.resets_at).toBe(full.now + 2 * 3600)
    expect(full.data.rate_limits?.seven_day?.resets_at).toBe(1783900800)
    // windows-cjk：five_hour＝now+2h（原 1783501200）。
    expect(win.data.rate_limits?.five_hour?.resets_at).toBe(1783501200)
    expect(win.data.rate_limits?.five_hour?.resets_at).toBe(win.now + 2 * 3600)
  })
})
