/**
 * S5-T1.3（(internal design doc) §型別契約 config 清洗
 * 註解／§Verification 1）：defaultConfig 工廠、serialize/deserialize
 * roundtrip、drop-unknown-and-continue 全類（未知 id／variant／欄、
 * 越界色、壞 hex、桶數 8/12、separator/prefix 驗證退預設）、目錄變動
 * 對帳（舊 config×新目錄）、v1→v2 遷移（powerlineArrow 派生）、其他
 * 版本 0/3 重置、清洗冪等。
 *
 * catalog 為假目錄注入（segments.ts 於 M2 才建立——契約即為此設計）。
 */
import { describe, expect, it } from 'vitest'
import { type ColorSpec } from './color.js'
import { THRESHOLD_TEMPLATES, type ThresholdBuckets } from './threshold.js'
import {
  _migrateConfigForTest,
  CONFIG_VERSION,
  defaultConfig,
  defaultSegmentConfig,
  deserializeConfig,
  normalizeRows,
  SEPARATOR_PRESETS,
  serializeConfig,
  type BuilderConfig,
  type SegmentCatalog,
  type SegmentConfig,
} from './config.js'

const ansi = (index: number): ColorSpec => ({ kind: 'ansi256', index })

// barEligibleIds／autoEligibleIds（T3.3，(internal design doc)
// expansion/PLAN.md Rev 4 §3）：假目錄比照真目錄語意——'context-used' 為
// 百分比段（bar 適用）、'model' 掛 autoColor（auto 適用）。兩集合的實際
// 清洗消費（sanitizeSegmentColor allowAuto／bar 欄）為 T3.4，見下方
// 「SegmentColor 清洗」「bar 清洗」兩個 describe 區塊。
const CATALOG: SegmentCatalog = {
  ids: ['model', 'cwd', 'context-used', 'git-branch'],
  variantsById: { cwd: ['full', 'basename', 'tilde'] },
  barEligibleIds: new Set(['context-used']),
  autoEligibleIds: new Set(['model']),
}

/** 有效且含全部選填欄的滿配 config（覆蓋 catalog 全 id、非目錄序）。 */
function fullConfig(): BuilderConfig {
  return {
    version: 2,
    mode: 'powerline',
    separator: { kind: 'preset', value: '›' },
    lastArrowCap: false,
    powerlineArrow: true,
    segments: [
      {
        id: 'context-used',
        enabled: true,
        icon: true,
        prefix: 'CTX ',
        color: ansi(137),
        fgOverride: { kind: 'truecolor', hex: '#000000' },
        // bar（T3.4）：'context-used' ∈ CATALOG.barEligibleIds（percentage 段）。
        bar: true,
        threshold: {
          buckets: [
            ansi(46), ansi(82), ansi(118), ansi(154), ansi(190),
            { kind: 'truecolor', hex: '#ffaf00' }, { kind: 'default' },
            ansi(208), ansi(202), ansi(196),
          ] as unknown as ThresholdBuckets,
        },
      },
      {
        id: 'cwd',
        enabled: true,
        icon: false,
        color: { kind: 'truecolor', hex: '#5f87af' },
        variant: 'basename',
      },
      { id: 'git-branch', enabled: true, icon: true, color: ansi(2) },
      // color:{kind:'auto'}（T3.4）：'model' ∈ CATALOG.autoEligibleIds，全滿配
      // roundtrip 一併覆蓋 auto 態往返。
      { id: 'model', enabled: false, icon: false, color: { kind: 'auto' } },
    ],
  }
}

describe('defaultConfig 工廠', () => {
  it('version 2／plain／preset "|"／lastArrowCap true／powerlineArrow false／目錄序全列全停用', () => {
    expect(defaultConfig(CATALOG)).toEqual({
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [
        { id: 'model', enabled: false, icon: true, color: { kind: 'default' } },
        { id: 'cwd', enabled: false, icon: true, color: { kind: 'default' } },
        { id: 'context-used', enabled: false, icon: true, color: { kind: 'default' } },
        { id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' } },
      ],
    })
  })

  it('預設列選填欄位確實缺席（非 undefined 值）', () => {
    const seg = defaultSegmentConfig('model')
    expect('prefix' in seg).toBe(false)
    expect('fgOverride' in seg).toBe(false)
    expect('threshold' in seg).toBe(false)
    expect('variant' in seg).toBe(false)
  })

  it('每次呼叫回傳新物件（非共享參照）', () => {
    const a = defaultConfig(CATALOG)
    const b = defaultConfig(CATALOG)
    expect(a).not.toBe(b)
    expect(a.segments[0]).not.toBe(b.segments[0])
  })

  it('CONFIG_VERSION＝2；SEPARATOR_PRESETS 正面表列', () => {
    expect(CONFIG_VERSION).toBe(2)
    expect(SEPARATOR_PRESETS).toEqual(['|', '›', '·', ' '])
  })
})

describe('serialize／deserialize roundtrip', () => {
  it('滿配 config 完整往返（含 threshold／fgOverride／variant／prefix／排序）', () => {
    const config = fullConfig()
    expect(deserializeConfig(serializeConfig(config), CATALOG)).toEqual(config)
  })

  it('custom separator（plain）往返；空字串 custom 亦合法保留', () => {
    const config: BuilderConfig = {
      ...defaultConfig(CATALOG),
      separator: { kind: 'custom', value: '→' },
    }
    expect(deserializeConfig(serializeConfig(config), CATALOG)).toEqual(config)

    const empty: BuilderConfig = {
      ...defaultConfig(CATALOG),
      separator: { kind: 'custom', value: '' },
    }
    expect(deserializeConfig(serializeConfig(empty), CATALOG)).toEqual(empty)
  })

  it('全 preset 值逐一往返', () => {
    for (const value of SEPARATOR_PRESETS) {
      const config: BuilderConfig = {
        ...defaultConfig(CATALOG),
        separator: { kind: 'preset', value },
      }
      expect(deserializeConfig(serializeConfig(config), CATALOG).separator).toEqual({
        kind: 'preset',
        value,
      })
    }
  })

  it('清洗冪等：dirty 輸入清洗一次後，再 serialize→deserialize 不再變形', () => {
    const dirty = JSON.stringify({
      version: 1,
      mode: 'powerline',
      separator: { kind: 'custom', value: 'x'.repeat(9) },
      segments: [
        { id: 'ghost', enabled: true },
        { id: 'cwd', enabled: true, variant: 'nope', color: { kind: 'ansi256', index: 999 } },
      ],
      bogusTop: true,
    })
    const once = deserializeConfig(dirty, CATALOG)
    const twice = deserializeConfig(serializeConfig(once), CATALOG)
    expect(twice).toEqual(once)
  })
})

describe('整份層級的保底（絕不丟例外）', () => {
  it.each([
    ['壞 JSON', 'not json{'],
    ['空字串', ''],
    ['JSON null', 'null'],
    ['頂層陣列', '[]'],
    ['頂層字串', '"config"'],
    ['頂層數字', '42'],
  ])('%s → 預設 config', (_name, json) => {
    expect(deserializeConfig(json, CATALOG)).toEqual(defaultConfig(CATALOG))
  })

  it('version∉{1,2}（v1 專用遷移之外的其他版本）→ 重置：0／3／"2" 字串／缺欄', () => {
    for (const version of [0, 3, '2', undefined]) {
      const json = JSON.stringify({ version, mode: 'powerline', segments: [] })
      expect(deserializeConfig(json, CATALOG), `version=${String(version)}`).toEqual(
        defaultConfig(CATALOG),
      )
    }
  })

  it('version=1 但其餘全壞 → 逐欄退預設＋powerlineArrow false，等同預設 config（不整份拒收）', () => {
    const json = JSON.stringify({ version: 1, mode: 9, separator: null, segments: 'nope' })
    const result = deserializeConfig(json, CATALOG)
    expect(result).toEqual(defaultConfig(CATALOG))
    expect(result.powerlineArrow).toBe(false)
  })
})

describe('v2 遷移（migrateConfig：v1→v2 powerlineArrow 派生／其他版本重置）', () => {
  it('v1 mode:"powerline" → powerlineArrow true（保留既有箭頭觀感）', () => {
    const json = JSON.stringify({ version: 1, mode: 'powerline', segments: [] })
    const result = deserializeConfig(json, CATALOG)
    expect(result.version).toBe(2)
    expect(result.mode).toBe('powerline')
    expect(result.powerlineArrow).toBe(true)
  })

  it('v1 mode:"plain" → powerlineArrow false', () => {
    const json = JSON.stringify({ version: 1, mode: 'plain', segments: [] })
    const result = deserializeConfig(json, CATALOG)
    expect(result.mode).toBe('plain')
    expect(result.powerlineArrow).toBe(false)
  })

  it('v1 缺 mode 欄 → 退 plain／powerlineArrow false', () => {
    const json = JSON.stringify({ version: 1, segments: [] })
    const result = deserializeConfig(json, CATALOG)
    expect(result.mode).toBe('plain')
    expect(result.powerlineArrow).toBe(false)
  })

  it('v1 損壞存檔（mode 非法值／segments 壞形）→ 各欄退預設＋powerlineArrow false（不整份拒收）', () => {
    const json = JSON.stringify({
      version: 1,
      mode: { nested: true },
      separator: 42,
      segments: [{ id: 'ghost' }, 42, null],
    })
    const result = deserializeConfig(json, CATALOG)
    expect(result.mode).toBe('plain')
    expect(result.powerlineArrow).toBe(false)
    expect(result.separator).toEqual({ kind: 'preset', value: '|' })
    expect(result.segments.map((s) => s.id).sort()).toEqual([...CATALOG.ids].sort())
  })

  it('version 0／3／"1" 字串／缺欄 → 完整重置（無前代 schema 可依，非 v1 專用遷移）', () => {
    for (const version of [0, 3, '1', undefined]) {
      const json = JSON.stringify({ version, mode: 'powerline', powerlineArrow: true, segments: [] })
      expect(deserializeConfig(json, CATALOG), `version=${String(version)}`).toEqual(
        defaultConfig(CATALOG),
      )
    }
  })

  it('v2 sanitize 冪等：dirty v2 存檔清洗一次後，再 serialize→deserialize 不再變形', () => {
    const dirty = JSON.stringify({
      version: 2,
      mode: 'powerline',
      separator: { kind: 'custom', value: 'x'.repeat(9) },
      powerlineArrow: 'yes', // 非布林 → false
      segments: [{ id: 'ghost', enabled: true }],
      bogusTop: true,
    })
    const once = deserializeConfig(dirty, CATALOG)
    expect(once.powerlineArrow).toBe(false)
    const twice = deserializeConfig(serializeConfig(once), CATALOG)
    expect(twice).toEqual(once)
  })

  it('v2 powerlineArrow 非布林（字串／數字／缺欄）→ false；true 保留', () => {
    for (const powerlineArrow of ['yes', 1, undefined]) {
      const json = JSON.stringify({ version: 2, mode: 'plain', powerlineArrow, segments: [] })
      expect(deserializeConfig(json, CATALOG).powerlineArrow, String(powerlineArrow)).toBe(false)
    }
    const json = JSON.stringify({ version: 2, mode: 'powerline', powerlineArrow: true, segments: [] })
    expect(deserializeConfig(json, CATALOG).powerlineArrow).toBe(true)
  })
})

/**
 * T3.1（(internal design doc) §Milestone 3；凍結測試
 * 先行——寫在 MIGRATION_STEPS 階梯重構之前，先對現行單步 if 版
 * `migrateConfig` 跑過確認即綠，重構後須繼續原樣綠）：v1→v2
 * `powerlineArrow` 派生是**無條件覆寫**（依 `mode` 算出的值直接取代），
 * **不是** fill-if-missing（僅在欄位缺席時才補值）——即使 v1 raw 湊巧
 * 夾帶一個與 `mode` 矛盾的顯式 `powerlineArrow`，該值仍被無視、整個
 * 覆寫為派生值。正反兩案鎖死此語意，任何把邏輯誤改成「僅缺欄才派生」
 * 的重構都會在此變紅。
 */
describe('T3.1 凍結：v1→v2 powerlineArrow 派生為無條件覆寫（非 fill-if-missing）', () => {
  it('v1 raw 夾帶顯式 powerlineArrow:false + mode:"powerline" → 仍派生覆寫為 true（忽略夾帶值）', () => {
    const json = JSON.stringify({
      version: 1,
      mode: 'powerline',
      powerlineArrow: false,
      segments: [],
    })
    const result = deserializeConfig(json, CATALOG)
    expect(result.powerlineArrow).toBe(true)
  })

  it('v1 raw 夾帶顯式 powerlineArrow:true + mode:"plain" → 仍派生覆寫為 false（忽略夾帶值）', () => {
    const json = JSON.stringify({
      version: 1,
      mode: 'plain',
      powerlineArrow: true,
      segments: [],
    })
    const result = deserializeConfig(json, CATALOG)
    expect(result.powerlineArrow).toBe(false)
  })
})

/**
 * T3.2（(internal design doc) §Milestone 3）：
 * `MIGRATION_STEPS` 階梯重構的核心防禦——缺步進函式（`raw.version` 非
 * `number`，或雖為 `number` 但查無對應步進，如未來版本忘寫遷移步進時
 * 的中繼態、或手動注入的非整數版本 `1.5`）一律視同未知版本、回傳
 * `defaultConfig(catalog)`，**不得**對 `undefined` 求值拋出 TypeError
 * （即不得寫成 `MIGRATION_STEPS[version](raw)` 而未先檢查
 * `MIGRATION_STEPS[version]` 是否存在）。
 */
describe('T3.2 凍結：migrate 階梯缺步進中繼版本防禦', () => {
  it('刻意呼叫缺步進中繼版本（人工注入 version:1.5）→ 不 throw、回傳預設 config', () => {
    const json = JSON.stringify({
      version: 1.5,
      mode: 'powerline',
      powerlineArrow: true,
      segments: [],
    })
    expect(() => deserializeConfig(json, CATALOG)).not.toThrow()
    // toStrictEqual（非 toEqual，(internal design doc) Minority 4 採納）：見
    // T3.3(b) canary 區塊註解，同一「整份 deepEqual」粒度收斂理由。
    expect(deserializeConfig(json, CATALOG)).toStrictEqual(defaultConfig(CATALOG))
  })
})

/**
 * 多步遷移串接（(internal design doc)「🟡 `migrateConfig` 多步串接（while
 * ≥2 次迭代）零自動化覆蓋」採納項；(internal design doc)
 * (internal design doc)）：真實 `MIGRATION_STEPS` 現僅鍵 `1`（v1→v2），所有
 * 既有測試只走「單步」或「零步（缺步進退預設）」——「連續步進 ≥2 次」的
 * 接力路徑（G2 存在的核心意義：新版本只加新鍵、不動舊步進）在 v3 首次
 * bump 前無任何測試真的走過。本 describe 以 `_migrateConfigForTest` 注入
 * 兩筆假步進，直接斷言：(1) 版本每步 +1、欄位經兩步後正確落地、迴圈
 * 正常終止；(2) 兩步鏈中途缺第二步 → 卡在中繼版本、回 `defaultConfig`
 * 不 throw（T3.2 缺步進防禦在多步情境下同樣成立，非僅零步／單步）。
 *
 * 假步進表刻意模擬真實 v1→v2 遷移的形狀（欄位搬遷＋依欄位無條件派生），
 * 而非純標記欄位（如 `{ mark: true }`）——後者無法證明「前一步產出的欄位
 * 確實能被下一步讀取並據以派生」，只能證明物件有被複製；用真實形狀的
 * 假步進才貼近生產 `MIGRATION_STEPS` 未來新增鍵時的實際樣態。
 */
describe('多步遷移串接（migrateConfig while ≥2 次迭代，_migrateConfigForTest 注入假步進）', () => {
  const FAKE_TWO_STEPS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
    // 假 v0→v1：欄位搬遷（legacyMode → mode），模擬真實遷移常見形狀。
    0: (raw) => {
      const { legacyMode, ...rest } = raw
      return { ...rest, mode: legacyMode === 'pl' ? 'powerline' : 'plain' }
    },
    // 假 v1→v2：依上一步產出的 mode 無條件派生 powerlineArrow（鏡射真實
    // MIGRATION_STEPS[1] 的派生語意），證明第二步確實讀得到第一步的欄位。
    1: (raw) => ({ ...raw, powerlineArrow: raw.mode === 'powerline' }),
  }

  it('v0→v1→v2 兩步接力成功：版本每步 +1、欄位經兩步後正確落地、迴圈終止', () => {
    const raw = { version: 0, legacyMode: 'pl', segments: [] }
    const result = _migrateConfigForTest(raw, CATALOG, FAKE_TWO_STEPS)
    // 終止於 CONFIG_VERSION（非卡在中繼版本 1）。
    expect(result.version).toBe(CONFIG_VERSION)
    // 第一步落地：legacyMode:'pl' → mode:'powerline'。
    expect(result.mode).toBe('powerline')
    // 第二步落地：讀到第一步產出的 mode，派生 powerlineArrow true。
    expect(result.powerlineArrow).toBe(true)
  })

  it('v0→v1→v2 兩步接力（legacyMode 非 "pl"）：mode 退 plain、powerlineArrow false', () => {
    const raw = { version: 0, legacyMode: 'other', segments: [] }
    const result = _migrateConfigForTest(raw, CATALOG, FAKE_TWO_STEPS)
    expect(result.version).toBe(CONFIG_VERSION)
    expect(result.mode).toBe('plain')
    expect(result.powerlineArrow).toBe(false)
  })

  it('兩步中途缺第二步（steps 只給鍵 0）→ 卡在中繼版本 1、不 throw、回傳 defaultConfig', () => {
    const partialSteps: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
      0: FAKE_TWO_STEPS[0]!,
      // 鍵 1 故意缺席——模擬「未來版本忘寫遷移步進」的中繼態。
    }
    const raw = { version: 0, legacyMode: 'pl', segments: [] }
    expect(() => _migrateConfigForTest(raw, CATALOG, partialSteps)).not.toThrow()
    expect(_migrateConfigForTest(raw, CATALOG, partialSteps)).toEqual(defaultConfig(CATALOG))
  })
})

/**
 * T3.3(b)（(internal design doc) §Milestone 3；canary
 * 回歸案之一——合成最小 v2 fixture）：涵蓋 v2 特徵欄（auto 配色、bar、
 * 多列 row、rowSeparators）於單一最小 config 內，期望輸出凍結為字面值、
 * 整份 deepEqual（非僅關鍵欄存活斷言——粗粒度漏得住部分欄位損失）。與
 * `fixtures.test.ts` 內以 `reference-7row.json` 為本的 canary(a) 互補：
 * (a) 走真實 30 段目錄、(b) 走本檔既有假 4 段目錄，兩者共同覆蓋「未來
 * 版本忘寫遷移步進」的回歸偵測面。
 */
describe('T3.3(b) canary：合成最小 v2 fixture（auto／bar／多列 row／rowSeparators）', () => {
  it('deserializeConfig 輸出與凍結期望整份 deepEqual', () => {
    const fixture = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      rowSeparators: [null, { kind: 'preset', value: '·' }],
      segments: [
        { id: 'model', enabled: true, icon: true, color: { kind: 'auto' }, row: 0 },
        { id: 'context-used', enabled: true, icon: true, color: { kind: 'default' }, bar: true, row: 1 },
      ],
    }
    const expected: BuilderConfig = {
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      rowSeparators: [null, { kind: 'preset', value: '·' }],
      segments: [
        { id: 'model', enabled: true, icon: true, color: { kind: 'auto' }, row: 0 },
        { id: 'context-used', enabled: true, icon: true, color: { kind: 'default' }, bar: true, row: 1 },
        { id: 'cwd', enabled: false, icon: true, color: { kind: 'default' } },
        { id: 'git-branch', enabled: false, icon: true, color: { kind: 'default' } },
      ],
    }
    // toStrictEqual（非 toEqual，(internal design doc) Minority 4 採納）：
    // 「整份 deepEqual」的 PLAN 宣稱粒度須含「欄位留成 undefined」型部分
    // 損失——toEqual 對此盲視（undefined 值視同欄位缺席），一字補滿粒度。
    expect(deserializeConfig(JSON.stringify(fixture), CATALOG)).toStrictEqual(expected)
  })
})

describe('舊 config × 目錄變動（drop-unknown＋缺段補列）', () => {
  it('未知 id 丟棄、目錄新增段依目錄序補於末、存檔排序保留', () => {
    const old = JSON.stringify({
      version: 1,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      segments: [
        { id: 'legacy-gone', enabled: true, icon: false, color: { kind: 'default' } },
        { id: 'git-branch', enabled: true, icon: false, color: { kind: 'default' } },
        { id: 'model', enabled: true, icon: false, color: { kind: 'default' } },
      ],
    })
    const result = deserializeConfig(old, CATALOG)
    expect(result.segments.map((s) => s.id)).toEqual([
      'git-branch', 'model', // 存檔序保留（legacy-gone 已丟）
      'cwd', 'context-used', // 缺段依目錄序補列於末
    ])
    expect(result.segments[0]!.enabled).toBe(true)
    expect(result.segments[2]).toEqual(defaultSegmentConfig('cwd'))
  })

  it('重複 id 取首見', () => {
    const json = JSON.stringify({
      version: 1,
      segments: [
        { id: 'model', enabled: true },
        { id: 'model', enabled: false, prefix: 'dup' },
      ],
    })
    const segments = deserializeConfig(json, CATALOG).segments
    expect(segments.filter((s) => s.id === 'model')).toHaveLength(1)
    expect(segments[0]!.enabled).toBe(true)
    expect('prefix' in segments[0]!).toBe(false)
  })

  it('segments 缺欄／非陣列 → 目錄全列預設', () => {
    const json = JSON.stringify({ version: 1 })
    expect(deserializeConfig(json, CATALOG).segments).toEqual(
      CATALOG.ids.map((id) => defaultSegmentConfig(id)),
    )
  })

  it('產出恆為 catalog.ids 的排列（不多不少）', () => {
    const json = JSON.stringify({
      version: 1,
      segments: [{ id: 'ghost-a' }, { id: 'cwd' }, 42, null, { noId: true }],
    })
    const ids = deserializeConfig(json, CATALOG).segments.map((s) => s.id)
    expect([...ids].sort()).toEqual([...CATALOG.ids].sort())
    expect(ids[0]).toBe('cwd')
  })
})

describe('threshold 桶數校正（恰 10；不足補、超長截、壞桶逐桶退）', () => {
  const segWithBuckets = (buckets: unknown): string =>
    JSON.stringify({
      version: 1,
      segments: [{ id: 'context-used', enabled: true, threshold: { buckets } }],
    })

  it('8 桶 → 補 2 桶 default 至恰 10', () => {
    const eight = Array(8).fill(ansi(196))
    const th = deserializeConfig(segWithBuckets(eight), CATALOG).segments[0]!.threshold
    expect(th!.buckets).toHaveLength(10)
    expect(th!.buckets.slice(0, 8)).toEqual(eight)
    expect(th!.buckets[8]).toEqual({ kind: 'default' })
    expect(th!.buckets[9]).toEqual({ kind: 'default' })
  })

  it('12 桶 → 截斷取前 10', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ansi(i))
    const th = deserializeConfig(segWithBuckets(twelve), CATALOG).segments[0]!.threshold
    expect(th!.buckets).toHaveLength(10)
    expect(th!.buckets).toEqual(Array.from({ length: 10 }, (_, i) => ansi(i)))
  })

  it('模板陣列原樣往返（恰 10 不動）', () => {
    const th = deserializeConfig(
      segWithBuckets([...THRESHOLD_TEMPLATES.traffic.buckets]),
      CATALOG,
    ).segments[0]!.threshold
    expect(th!.buckets).toEqual(THRESHOLD_TEMPLATES.traffic.buckets)
  })

  it('壞桶逐桶退 default（未知 kind／非物件／壞 hex），好桶保留', () => {
    const mixed = [ansi(46), { kind: 'nope' }, 42, { kind: 'truecolor', hex: '#f00' }, ansi(196)]
    const th = deserializeConfig(segWithBuckets(mixed), CATALOG).segments[0]!.threshold
    expect(th!.buckets[0]).toEqual(ansi(46))
    expect(th!.buckets[1]).toEqual({ kind: 'default' })
    expect(th!.buckets[2]).toEqual({ kind: 'default' })
    expect(th!.buckets[3]).toEqual({ kind: 'default' })
    expect(th!.buckets[4]).toEqual(ansi(196))
    expect(th!.buckets).toHaveLength(10)
  })

  it('threshold 非物件／buckets 非陣列 → 整欄丟（退「無閾值」）', () => {
    for (const threshold of ['red-to-green', { buckets: 'nope' }, { template: 'traffic' }, 42]) {
      const json = JSON.stringify({
        version: 1,
        segments: [{ id: 'context-used', threshold }],
      })
      const seg = deserializeConfig(json, CATALOG).segments[0]!
      expect('threshold' in seg, JSON.stringify(threshold)).toBe(false)
    }
  })
})

describe('色值清洗（color.ts 同源）', () => {
  const segWithColor = (color: unknown, field = 'color'): string =>
    JSON.stringify({ version: 1, segments: [{ id: 'model', [field]: color }] })

  it('ansi256 越界 clamp：300→255、-5→0、小數 trunc 3.7→3', () => {
    for (const [input, expected] of [
      [300, 255],
      [-5, 0],
      [3.7, 3],
    ] as const) {
      const seg = deserializeConfig(segWithColor({ kind: 'ansi256', index: input }), CATALOG)
        .segments[0]!
      expect(seg.color).toEqual(ansi(expected))
    }
  })

  it('ansi256 index 非數字（字串／缺欄）→ 整色退 default', () => {
    for (const color of [{ kind: 'ansi256', index: '42' }, { kind: 'ansi256' }]) {
      const seg = deserializeConfig(segWithColor(color), CATALOG).segments[0]!
      expect(seg.color).toEqual({ kind: 'default' })
    }
  })

  it('壞 hex 退 default：#f00／red／#GGGGGG／裸 hex／非字串', () => {
    for (const hex of ['#f00', 'red', '#GGGGGG', 'ff0000', 42]) {
      const seg = deserializeConfig(segWithColor({ kind: 'truecolor', hex }), CATALOG)
        .segments[0]!
      expect(seg.color, String(hex)).toEqual({ kind: 'default' })
    }
  })

  it('大寫 hex 正規化為小寫保留（非拒收）', () => {
    const seg = deserializeConfig(segWithColor({ kind: 'truecolor', hex: '#AB12CD' }), CATALOG)
      .segments[0]!
    expect(seg.color).toEqual({ kind: 'truecolor', hex: '#ab12cd' })
  })

  it('未知 kind → default', () => {
    const seg = deserializeConfig(segWithColor({ kind: 'rgb', r: 1, g: 2, b: 3 }), CATALOG)
      .segments[0]!
    expect(seg.color).toEqual({ kind: 'default' })
  })

  it('fgOverride 有效保留（含 {kind:"default"} 顯式值）；無效整欄丟', () => {
    const valid = deserializeConfig(segWithColor({ kind: 'default' }, 'fgOverride'), CATALOG)
      .segments[0]!
    expect(valid.fgOverride).toEqual({ kind: 'default' })

    const invalid = deserializeConfig(
      segWithColor({ kind: 'truecolor', hex: 'bad' }, 'fgOverride'),
      CATALOG,
    ).segments[0]!
    expect('fgOverride' in invalid).toBe(false)
  })
})

describe('SegmentColor 清洗（.color 走 sanitizeSegmentColor(raw, allowAuto)；T3.4，' +
  '(internal design doc) Rev 4 §3）', () => {
  // 擴充目錄：'effort' 亦掛為 auto 合格段（鏡射真 segments.ts model／
  // effort 皆有 autoColor 欄，見 PLAN §3 auto 色票節）；'cwd' 維持非 auto
  // 合格，供段別限定案使用。僅本 describe 區塊內使用，不影響其餘測試
  // 依賴的全域 CATALOG 序與 id 集。
  const AUTO_CATALOG: SegmentCatalog = {
    ...CATALOG,
    ids: [...CATALOG.ids, 'effort'],
    autoEligibleIds: new Set(['model', 'effort']),
  }
  const segWithColor = (id: string, color: unknown): string =>
    JSON.stringify({ version: 1, segments: [{ id, color }] })
  const findSeg = (config: BuilderConfig, id: string): SegmentConfig =>
    config.segments.find((s) => s.id === id)!

  it('auto 放行：id ∈ autoEligibleIds（model／effort）→ 保留 {kind:"auto"}', () => {
    for (const id of ['model', 'effort']) {
      const seg = findSeg(deserializeConfig(segWithColor(id, { kind: 'auto' }), AUTO_CATALOG), id)
      expect(seg.color, id).toEqual({ kind: 'auto' })
    }
  })

  it('auto 段別限定：id ∉ autoEligibleIds（cwd）→ 退 {kind:"default"}', () => {
    const seg = findSeg(deserializeConfig(segWithColor('cwd', { kind: 'auto' }), AUTO_CATALOG), 'cwd')
    expect(seg.color).toEqual({ kind: 'default' })
  })

  it('清洗順序釘死：先判 auto 不受非 auto 分支（default case）截胡——同一 raw.kind="auto" 值依段別各自定案', () => {
    const allowed = findSeg(deserializeConfig(segWithColor('model', { kind: 'auto' }), AUTO_CATALOG), 'model')
    const denied = findSeg(deserializeConfig(segWithColor('cwd', { kind: 'auto' }), AUTO_CATALOG), 'cwd')
    expect(allowed.color).toEqual({ kind: 'auto' })
    expect(denied.color).toEqual({ kind: 'default' })
  })

  it('非 auto 色值委派既有 sanitizeColorSpec（越界 clamp 不回歸，auto 合格段亦然）', () => {
    const seg = findSeg(
      deserializeConfig(segWithColor('model', { kind: 'ansi256', index: 300 }), AUTO_CATALOG),
      'model',
    )
    expect(seg.color).toEqual(ansi(255))
  })

  it('fgOverride 防注入：{kind:"auto"} 一律不收（維持三態封閉 sanitizeColorSpec）——整欄丟，非退 default 值', () => {
    const json = JSON.stringify({
      version: 1,
      segments: [{ id: 'model', fgOverride: { kind: 'auto' } }],
    })
    const seg = findSeg(deserializeConfig(json, AUTO_CATALOG), 'model')
    expect('fgOverride' in seg).toBe(false)
  })

  it('清洗冪等：auto 色值清洗一次後，再 serialize→deserialize 不再變形', () => {
    const once = deserializeConfig(segWithColor('model', { kind: 'auto' }), AUTO_CATALOG)
    const twice = deserializeConfig(serializeConfig(once), AUTO_CATALOG)
    expect(twice).toEqual(once)
  })
})

describe('bar 清洗（SegmentConfig.bar?: boolean，限 barEligibleIds；T3.4，' +
  '(internal design doc) Rev 4 §3）', () => {
  const segWithBar = (id: string, bar: unknown): string =>
    JSON.stringify({ version: 1, segments: [{ id, enabled: true, bar }] })
  const findSeg = (config: BuilderConfig, id: string): SegmentConfig =>
    config.segments.find((s) => s.id === id)!

  it('百分比段（context-used ∈ barEligibleIds）＋ raw true → true', () => {
    const seg = findSeg(deserializeConfig(segWithBar('context-used', true), CATALOG), 'context-used')
    expect(seg.bar).toBe(true)
  })

  it('非百分比段（cwd ∉ barEligibleIds）＋ raw true → 欄位缺席（不搬運、不清 false）', () => {
    const seg = findSeg(deserializeConfig(segWithBar('cwd', true), CATALOG), 'cwd')
    expect('bar' in seg).toBe(false)
  })

  it('raw false → 欄位缺席（比照既有選填欄「不搬運非法/預設值」慣例，非寫入 false）', () => {
    const seg = findSeg(deserializeConfig(segWithBar('context-used', false), CATALOG), 'context-used')
    expect('bar' in seg).toBe(false)
  })

  it('非 boolean（字串／數字／null／物件）→ 欄位缺席', () => {
    for (const bar of ['yes', 1, null, {}]) {
      const seg = findSeg(deserializeConfig(segWithBar('context-used', bar), CATALOG), 'context-used')
      expect('bar' in seg, JSON.stringify(bar)).toBe(false)
    }
  })

  it('缺席（鍵不存在）→ 欄位缺省（非補 false）', () => {
    const json = JSON.stringify({ version: 1, segments: [{ id: 'context-used', enabled: true }] })
    const seg = findSeg(deserializeConfig(json, CATALOG), 'context-used')
    expect('bar' in seg).toBe(false)
  })

  it('清洗冪等：bar:true 清洗一次後，再 serialize→deserialize 不再變形', () => {
    const once = deserializeConfig(segWithBar('context-used', true), CATALOG)
    const twice = deserializeConfig(serializeConfig(once), CATALOG)
    expect(twice).toEqual(once)
  })
})

describe('separator／prefix（validate.ts 驗證失敗即退預設）', () => {
  const withSeparator = (separator: unknown): string =>
    JSON.stringify({ version: 1, separator, segments: [] })

  it('preset 未知值 → 退預設 "|"', () => {
    expect(deserializeConfig(withSeparator({ kind: 'preset', value: '#' }), CATALOG).separator)
      .toEqual({ kind: 'preset', value: '|' })
  })

  it('custom 過 R（含換行／控制字元）或超長 → 退預設', () => {
    for (const value of ['a\nb', '\t', 'x'.repeat(9)]) {
      expect(
        deserializeConfig(withSeparator({ kind: 'custom', value }), CATALOG).separator,
        JSON.stringify(value),
      ).toEqual({ kind: 'preset', value: '|' })
    }
  })

  it('custom 合法（≤8 code point，含 emoji）→ 保留', () => {
    expect(deserializeConfig(withSeparator({ kind: 'custom', value: ' ⚡ ' }), CATALOG).separator)
      .toEqual({ kind: 'custom', value: ' ⚡ ' })
  })

  it('custom 帶 PUA（powerline 箭頭 U+E0B0）→ 退預設 "|"（不整份拒收）', () => {
    expect(deserializeConfig(withSeparator({ kind: 'custom', value: '\u{E0B0}' }), CATALOG).separator)
      .toEqual({ kind: 'preset', value: '|' })
  })

  it('separator 形狀不可辨（缺 value／未知 kind／非物件）→ 退預設', () => {
    for (const separator of [{ kind: 'preset' }, { kind: 'fancy', value: '|' }, '|', null]) {
      expect(deserializeConfig(withSeparator(separator), CATALOG).separator).toEqual({
        kind: 'preset',
        value: '|',
      })
    }
  })

  const withPrefix = (prefix: unknown): string =>
    JSON.stringify({ version: 1, segments: [{ id: 'model', prefix }] })

  it('prefix 合法保留；過 R（含 PUA）／超長／非字串 → 整欄丟', () => {
    expect(deserializeConfig(withPrefix('⚡M '), CATALOG).segments[0]!.prefix).toBe('⚡M ')
    // '‮evil'＝RLO bidi；'M\u{E0B0}'＝夾帶 powerline 箭頭 PUA（Important 1）。
    for (const prefix of ['a\nb', 'x'.repeat(9), 42, '‮evil', 'M\u{E0B0}']) {
      const seg = deserializeConfig(withPrefix(prefix), CATALOG).segments[0]!
      expect('prefix' in seg, JSON.stringify(prefix)).toBe(false)
    }
  })

  it('舊 config 帶 PUA 前綴 → 剔前綴、不整份拒收（重整不丟；Important 1）', () => {
    // 手改／舊版殘留／他分頁寫入的持久化 config 帶 PUA 前綴（Nerd Font glyph
    // U+E0B0）——清洗須剔除前綴（退「無前綴」）而非整份拒收，且不得讓 PUA
    // 前綴達 resolve（否則 init→toAriaLabel 擲 TypeError、整頁不可用）。
    const json = JSON.stringify({
      version: 1,
      mode: 'powerline',
      separator: { kind: 'preset', value: '›' },
      lastArrowCap: false,
      segments: [
        { id: 'model', enabled: true, icon: true, color: { kind: 'ansi256', index: 75 }, prefix: 'M\u{E0B0}' },
        { id: 'cwd', enabled: true, icon: false, color: { kind: 'default' } },
      ],
    })
    const result = deserializeConfig(json, CATALOG)
    // 整份存活：mode／separator／lastArrowCap 不因單一壞前綴被拒。
    expect(result.mode).toBe('powerline')
    expect(result.separator).toEqual({ kind: 'preset', value: '›' })
    expect(result.lastArrowCap).toBe(false)
    const model = result.segments.find((s) => s.id === 'model')!
    // segment 保留（enabled／icon／color 完好）、僅 PUA 前綴被剔。
    expect(model.enabled).toBe(true)
    expect(model.icon).toBe(true)
    expect(model.color).toEqual(ansi(75))
    expect('prefix' in model).toBe(false)
    // 產出恆為 catalog.ids 排列（重整不丟）。
    expect([...result.segments.map((s) => s.id)].sort()).toEqual([...CATALOG.ids].sort())
  })
})

describe('其餘欄位清洗', () => {
  it('mode 非法值 → plain；powerline 保留', () => {
    for (const [mode, expected] of [
      ['powerline', 'powerline'],
      ['plain', 'plain'],
      ['PLAIN', 'plain'],
      [42, 'plain'],
    ] as const) {
      const json = JSON.stringify({ version: 1, mode, segments: [] })
      expect(deserializeConfig(json, CATALOG).mode).toBe(expected)
    }
  })

  it('lastArrowCap 非布林 → true（Q1 預設收）；false 保留', () => {
    for (const [input, expected] of [
      [false, false],
      [true, true],
      ['yes', true],
      [undefined, true],
    ] as const) {
      const json = JSON.stringify({ version: 1, lastArrowCap: input, segments: [] })
      expect(deserializeConfig(json, CATALOG).lastArrowCap, String(input)).toBe(expected)
    }
  })

  it('enabled/icon 非布林 → false', () => {
    const json = JSON.stringify({
      version: 1,
      segments: [{ id: 'model', enabled: 'yes', icon: 1 }],
    })
    const seg = deserializeConfig(json, CATALOG).segments[0]!
    expect(seg.enabled).toBe(false)
    expect(seg.icon).toBe(false)
  })

  it('variant ∈ 目錄允許集保留；未知值／無 variants 之段 → 整欄丟', () => {
    const json = JSON.stringify({
      version: 1,
      segments: [
        { id: 'cwd', variant: 'basename' },
        { id: 'model', variant: 'basename' }, // model 無 variants 鍵
      ],
    })
    const [cwd, model] = deserializeConfig(json, CATALOG).segments
    expect(cwd!.variant).toBe('basename')
    expect('variant' in model!).toBe(false)

    const bad = JSON.stringify({ version: 1, segments: [{ id: 'cwd', variant: 'nope' }] })
    expect('variant' in deserializeConfig(bad, CATALOG).segments[0]!).toBe(false)
  })

  it('未知欄忽略（頂層與 segment 層皆不搬運）', () => {
    const json = JSON.stringify({
      version: 1,
      futureTopLevel: { x: 1 },
      segments: [{ id: 'model', futureField: 'x', autoFg: [1, 2, 3] }],
    })
    const result = deserializeConfig(json, CATALOG)
    expect('futureTopLevel' in result).toBe(false)
    expect('futureField' in result.segments[0]!).toBe(false)
    expect('autoFg' in result.segments[0]!).toBe(false)
  })
})

describe('row 清洗（多列佈局 T2.1；deserialize 路徑）', () => {
  // 30 段假目錄（鏡射真 segments.ts 現役 30 段——T3.2 已 +5 段擴至 30），
  // 用於驗證 clamp 上界確為 29——與 PLAN／brief 明列的具體數字對齊
  // （現役 30 段 → clamp 29）。
  const ROW_CATALOG: SegmentCatalog = {
    ids: Array.from({ length: 30 }, (_, i) => `seg-${i}`),
    variantsById: {},
    barEligibleIds: new Set(),
    autoEligibleIds: new Set(),
  }
  const withRow = (row: unknown, catalog: SegmentCatalog = ROW_CATALOG): string =>
    JSON.stringify({ version: 1, segments: [{ id: catalog.ids[0], enabled: true, row }] })

  it('缺欄（row 鍵不存在）→ row 鍵維持缺席（非補 0）——與 defaultSegmentConfig 不帶 row 天然一致', () => {
    const json = JSON.stringify({ version: 1, segments: [{ id: 'seg-0', enabled: true }] })
    const seg = deserializeConfig(json, ROW_CATALOG).segments[0]!
    expect('row' in seg).toBe(false)
  })

  it('float（非整數）→ 0（不四捨五入）', () => {
    for (const row of [2.5, 0.1, -3.9]) {
      const seg = deserializeConfig(withRow(row), ROW_CATALOG).segments[0]!
      expect(seg.row, String(row)).toBe(0)
    }
  })

  it('負整數 → 0', () => {
    const seg = deserializeConfig(withRow(-5), ROW_CATALOG).segments[0]!
    expect(seg.row).toBe(0)
  })

  it('非數字型別（字串／null／布林）→ 0（「存在但非法」，非「缺欄」）', () => {
    for (const row of ['3', null, true]) {
      const seg = deserializeConfig(withRow(row), ROW_CATALOG).segments[0]!
      expect(seg.row, JSON.stringify(row)).toBe(0)
    }
  })

  it('合法整數（0..29）原樣保留', () => {
    for (const row of [0, 5, 24, 29]) {
      const seg = deserializeConfig(withRow(row), ROW_CATALOG).segments[0]!
      expect(seg.row).toBe(row)
    }
  })

  it('row:999999999 → clamp 至 29（30 段目錄，段數−1；防手改存檔凍死列選單）', () => {
    const seg = deserializeConfig(withRow(999999999), ROW_CATALOG).segments[0]!
    expect(seg.row).toBe(29)
  })

  it('clamp 上界以現役目錄段數計，不寫死 25（4 段假目錄 → clamp 3）', () => {
    const seg = deserializeConfig(withRow(999999999, CATALOG), CATALOG).segments[0]!
    expect(seg.row).toBe(3)
  })

  it('清洗冪等：row 越界值清洗一次後，再 serialize→deserialize 不再變形', () => {
    const once = deserializeConfig(withRow(999999999), ROW_CATALOG)
    const twice = deserializeConfig(serializeConfig(once), ROW_CATALOG)
    expect(twice).toEqual(once)
  })
})

describe('rowSeparators 清洗（T1.1，(internal design doc) §D1 A-2；' +
  '陣列級清洗＋sanitizeRowSeparator 元素清洗）', () => {
  // 30 段假目錄（鏡射真 segments.ts 現役 30 段，同「row 清洗」describe 的
  // ROW_CATALOG 慣例——各 describe 區塊獨立作用域各自宣告）：用於驗證陣列
  // 長度 clamp 上界確為目錄段數 30，與具體數字對齊。
  const THIRTY_SEG_CATALOG: SegmentCatalog = {
    ids: Array.from({ length: 30 }, (_, i) => `seg-${i}`),
    variantsById: {},
    barEligibleIds: new Set(),
    autoEligibleIds: new Set(),
  }
  const withRowSeparators = (rowSeparators: unknown): string =>
    JSON.stringify({
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [],
      rowSeparators,
    })

  it('非陣列（物件／字串／數字／null）→ 欄位缺席', () => {
    for (const rowSeparators of [{}, 'nope', 42, null]) {
      const result = deserializeConfig(withRowSeparators(rowSeparators), CATALOG)
      expect('rowSeparators' in result, JSON.stringify(rowSeparators)).toBe(false)
    }
  })

  it('鍵缺席 → 欄位缺席（v2 舊存檔無此欄讀取存活，不因缺欄而炸）', () => {
    const json = JSON.stringify({
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [],
    })
    const result = deserializeConfig(json, CATALOG)
    expect('rowSeparators' in result).toBe(false)
  })

  it('畸形元素退 null（未知 preset 值／custom 過長／未知 kind／顯式 null），好元素保留原位', () => {
    // 用 30 段目錄（clamp 上界 30）——CATALOG 僅 4 段會讓 6 元素陣列先被
    // 長度 clamp 截斷，與本案「元素級清洗」意圖混淆，故另用足量目錄。
    const mixed = [
      { kind: 'preset', value: '›' }, // 合法保留
      { kind: 'preset', value: '#' }, // 未知 preset → null
      { kind: 'custom', value: 'x'.repeat(9) }, // 過 R（too-long）→ null
      null, // 顯式 null → null（繼承全域，與畸形同一出口）
      { kind: 'fancy', value: '|' }, // 未知 kind → null
      { kind: 'custom', value: '→' }, // 合法保留
    ]
    const json = JSON.stringify({
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [],
      rowSeparators: mixed,
    })
    const result = deserializeConfig(json, THIRTY_SEG_CATALOG)
    expect(result.rowSeparators).toEqual([
      { kind: 'preset', value: '›' },
      null,
      null,
      null,
      null,
      { kind: 'custom', value: '→' },
    ])
  })

  it('尾端 null 修剪：末尾連續 null 去除，中段 null（非全 null 尾巴）保留', () => {
    const raw = [{ kind: 'preset', value: '|' }, null, { kind: 'preset', value: '·' }, null, null]
    const json = JSON.stringify({
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [],
      rowSeparators: raw,
    })
    const result = deserializeConfig(json, THIRTY_SEG_CATALOG)
    expect(result.rowSeparators).toEqual([
      { kind: 'preset', value: '|' },
      null,
      { kind: 'preset', value: '·' },
    ])
  })

  it('修剪後全 null／空陣列 → 省略欄位（回「全繼承」正規形，不留冗餘陣列）', () => {
    for (const raw of [[null, null, null], [{ kind: 'fancy' }, { kind: 'preset', value: '#' }], []]) {
      const result = deserializeConfig(withRowSeparators(raw), CATALOG)
      expect('rowSeparators' in result, JSON.stringify(raw)).toBe(false)
    }
  })

  it('長度 clamp 上界＝目錄段數：超長陣列截斷（30 段目錄 → clamp 30）', () => {
    const oversized = Array.from({ length: 40 }, () => ({ kind: 'preset', value: '|' }))
    const json = JSON.stringify({
      version: 2,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      powerlineArrow: false,
      segments: [],
      rowSeparators: oversized,
    })
    const result = deserializeConfig(json, THIRTY_SEG_CATALOG)
    expect(result.rowSeparators).toHaveLength(30)
  })

  it('clamp 上界以現役目錄段數計，不寫死 30（4 段假目錄 → clamp 4）', () => {
    const oversized = Array.from({ length: 10 }, () => ({ kind: 'preset', value: '|' }))
    const result = deserializeConfig(withRowSeparators(oversized), CATALOG)
    expect(result.rowSeparators).toHaveLength(CATALOG.ids.length)
  })

  it('v1→v2 遷移：migrateConfig 分支不得產生此欄，即使 raw 湊巧夾帶合法 rowSeparators', () => {
    const json = JSON.stringify({
      version: 1,
      mode: 'plain',
      segments: [],
      rowSeparators: [{ kind: 'preset', value: '|' }],
    })
    const result = deserializeConfig(json, CATALOG)
    expect('rowSeparators' in result).toBe(false)
  })

  it('mode 為 powerline 時欄位保值不清除（惰性存續，比照既有 separator 慣例）', () => {
    // 首位 null（非尾端）＋末位合法值，確保不與「尾端 null 修剪」規則相撞
    // ——本案只驗證 mode 不觸發清除，非驗證修剪。
    const config: BuilderConfig = {
      ...defaultConfig(CATALOG),
      mode: 'powerline',
      rowSeparators: [null, { kind: 'preset', value: '·' }],
    }
    const result = deserializeConfig(serializeConfig(config), CATALOG)
    expect(result.rowSeparators).toEqual([null, { kind: 'preset', value: '·' }])
  })

  it('清洗冪等：dirty rowSeparators 清洗一次後，再 serialize→deserialize 不再變形', () => {
    const raw = [
      { kind: 'preset', value: '|' },
      { kind: 'fancy' },
      { kind: 'preset', value: '·' },
      { kind: 'custom', value: 'x'.repeat(9) },
    ]
    const once = deserializeConfig(withRowSeparators(raw), CATALOG)
    expect(once.rowSeparators).toEqual([{ kind: 'preset', value: '|' }, null, { kind: 'preset', value: '·' }])
    const twice = deserializeConfig(serializeConfig(once), CATALOG)
    expect(twice).toEqual(once)
  })

  it('序列化正規形往返：滿配 rowSeparators（preset／custom／null 繼承混合）完整往返', () => {
    const config: BuilderConfig = {
      ...defaultConfig(CATALOG),
      rowSeparators: [{ kind: 'preset', value: '›' }, null, { kind: 'custom', value: '⚡' }],
    }
    expect(deserializeConfig(serializeConfig(config), CATALOG)).toEqual(config)
  })
})

describe('normalizeRows（純函式；正規化啟用段 row 為 0..N−1，停用段凍結）', () => {
  const seg = (id: string, enabled: boolean, row?: number): SegmentConfig => {
    const base: SegmentConfig = { id, enabled, icon: false, color: { kind: 'default' } }
    return row === undefined ? base : { ...base, row }
  }

  it('亂序輸入（row 值 5,2,9）→ 依升冪壓縮為 0,1,2', () => {
    const input = [seg('a', true, 5), seg('b', true, 2), seg('c', true, 9)]
    const out = normalizeRows(input)
    expect(out.map((s) => s.row)).toEqual([1, 0, 2]) // 2→0, 5→1, 9→2（升冪排名）
  })

  it('同 row 之啟用段相對順序不變（陣列本身不重排，僅重寫 row 標籤）', () => {
    const input = [seg('a', true, 3), seg('b', true, 1), seg('c', true, 3)]
    const out = normalizeRows(input)
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c']) // 陣列順序不變
    expect(out.map((s) => s.row)).toEqual([1, 0, 1]) // 1→0、3→1（去重壓縮）
  })

  it('缺 row（undefined）之啟用段視同 row 0（分組鍵 seg.row ?? 0）', () => {
    const input = [seg('a', true, 5), seg('b', true)] // b 無 row 欄
    const out = normalizeRows(input)
    expect(out.find((s) => s.id === 'b')!.row).toBe(0)
    expect(out.find((s) => s.id === 'a')!.row).toBe(1)
  })

  it('停用段 row 原值凍結（含 undefined 維持 undefined，不參與分組計算）', () => {
    const input = [seg('a', true, 2), seg('b', false, 999), seg('c', false)]
    const out = normalizeRows(input)
    expect(out.find((s) => s.id === 'a')!.row).toBe(0) // 唯一啟用段 → row 2 壓縮為 0
    expect(out.find((s) => s.id === 'b')!.row).toBe(999) // 停用段原值凍結（不 clamp、不重寫）
    expect('row' in out.find((s) => s.id === 'c')!).toBe(false) // undefined 維持缺席
  })

  it('冪等：normalizeRows(normalizeRows(x)) 等於 normalizeRows(x)', () => {
    const input = [seg('a', true, 5), seg('b', true, 2), seg('c', true, 2), seg('d', false, 7)]
    const once = normalizeRows(input)
    const twice = normalizeRows(once)
    expect(twice).toEqual(once)
  })

  it('純函式：不 mutate 輸入陣列或其元素', () => {
    const input = [seg('a', true, 5), seg('b', false, 3)]
    const snapshot = JSON.parse(JSON.stringify(input))
    normalizeRows(input)
    expect(input).toEqual(snapshot)
  })

  it('全部停用 → 全部原值凍結（含缺 row）、輸出與輸入結構相等', () => {
    const input = [seg('a', false, 5), seg('b', false)]
    const out = normalizeRows(input)
    expect(out).toEqual(input)
  })

  it('空陣列 → 空陣列', () => {
    expect(normalizeRows([])).toEqual([])
  })
})
