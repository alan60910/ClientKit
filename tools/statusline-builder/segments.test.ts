/**
 * S5-T2.1（(internal design doc) §Segment 目錄／§型別契約
 * SegmentDescriptor／§格式化對等規則／§Verification 1）：目錄結構不變量
 * （25 段、順序、icon、nullPolicy 對應、tri-path idiom）、tsPath 各情境
 * spot-check、TS 參考格式器對抗值（補尾零／float 乘積下緣／整數除法
 * 三階／10⁶ 門檻——跨後端行為相等歸 §3 真執行，本層不做跨後端斷言）、
 * catalog×config.deserializeConfig integration（真目錄餵清洗）。
 *
 * ── 06a T2.2（(internal design doc) §D1）追補 ──
 * icon.glyph 由 Nerd Font PUA 碼位改 emoji 字面（06a 核可對照表）；原
 * 「凍結 PUA 碼位」不變量測試改為目錄級結構斷言＋非 PUA 斷言＋對照表
 * 逐段比對，見下方 icon describe 區塊。
 *
 * ── T1.5.2（(internal design doc)）追補 ──
 * 真機實測：Claude Code statusline 不接受 emoji，25 段 icon.glyph 改為
 * 英文短 token＋冒號前綴（如 'cwd:'）；推翻 06a emoji 對照表定案。下方
 * icon describe 區塊的對照表斷言隨之改為前綴字面（非 PUA 斷言不受影響）。
 *
 * ── T3.2（(internal design doc) Rev4 §3；
 * TASKS.md T3.2）追補 ──
 * 目錄 25→30 段：新增 token-in／token-out／cache-hit／reset-5h／
 * reset-7d（前綴表核可見 prefix-table.md「06c 新 5 段增列」節）。目錄級
 * 斷言（段數／category 分佈／nullPolicy 對應／icon 對照表）隨之更新；
 * 新增 cache-hit 公式 partial-null 矩陣（tsPath 層直測）、token-in/out
 * null 穿透、autoColor／expiresAtPath 新通道欄位形狀斷言，見下方對應
 * describe 區塊。
 */
import { describe, expect, it } from 'vitest'
import { defaultConfig, deserializeConfig, serializeConfig } from './config.js'
import { DEFAULT_LOCALE, t } from './messages.js'
import { containsPua } from './resolve.js'
import {
  CWD_VARIANTS,
  DESCRIPTORS_BY_ID,
  defaultVariant,
  formatClockHM,
  formatContextSize,
  formatCost,
  formatDuration,
  formatLinesChanged,
  formatPath,
  formatPercentage,
  formatResetsAt,
  formatValue,
  isValueDead,
  RATE_VARIANTS,
  segmentAriaText,
  segmentLabel,
  SEGMENT_CATALOG,
  SEGMENT_DESCRIPTORS,
  SEGMENT_IDS,
  type CurrentUsage,
  type SegmentId,
  type StatusData,
} from './segments.js'

/** 永在欄齊備的最小 StatusData（current_dir 刻意 ≠ cwd——證 cwd 段取 top-level）。 */
function makeStatusData(overrides: Partial<StatusData> = {}): StatusData {
  return {
    cwd: '/home/u/proj',
    session_id: 'sess-1',
    transcript_path: '/home/u/.claude/t.jsonl',
    version: '2.1.196',
    model: { id: 'claude-fable-5', display_name: 'Fable 5' },
    workspace: {
      current_dir: '/home/u/proj/sub',
      project_dir: '/home/u/proj',
      added_dirs: [],
    },
    output_style: { name: 'default' },
    cost: {
      total_cost_usd: 1.5,
      total_duration_ms: 61000,
      total_api_duration_ms: 30000,
      total_lines_added: 3,
      total_lines_removed: 1,
    },
    context_window: {
      total_input_tokens: 1200,
      total_output_tokens: 300,
      context_window_size: 200000,
      used_percentage: 42.5,
      remaining_percentage: 57.5,
      current_usage: null,
    },
    exceeds_200k_tokens: false,
    thinking: { enabled: true },
    ...overrides,
  }
}

const tsValue = (id: SegmentId, d: StatusData): unknown => DESCRIPTORS_BY_ID[id].tsPath(d)

// ── 目錄結構不變量 ──

describe('segment 目錄結構', () => {
  it('30 段、順序＝PLAN 目錄表序（永在 12→百分比 5→條件 10→shell-out 3）', () => {
    expect(SEGMENT_IDS).toEqual([
      'model', 'cwd', 'project-dir', 'output-style', 'version',
      'cost', 'duration', 'lines-changed', 'context-size', 'thinking',
      'token-in', 'token-out',
      'context-used', 'context-remaining', 'rate-5h', 'rate-7d', 'cache-hit',
      'session-name', 'effort', 'vim-mode', 'agent-name', 'pr', 'repo',
      'worktree', 'worktree-branch', 'reset-5h', 'reset-7d',
      'git-branch', 'git-dirty', 'clock',
    ])
  })

  it('category 分佈：always×12／percentage×5／conditional×10／shell-out×3，且同類連續', () => {
    const categories = SEGMENT_DESCRIPTORS.map((d) => d.category)
    expect(categories).toEqual([
      ...Array<string>(12).fill('always'),
      ...Array<string>(5).fill('percentage'),
      ...Array<string>(10).fill('conditional'),
      ...Array<string>(3).fill('shell-out'),
    ])
  })

  it('id 唯一且 DESCRIPTORS_BY_ID 與清單一致', () => {
    expect(new Set(SEGMENT_IDS).size).toBe(30)
    for (const descriptor of SEGMENT_DESCRIPTORS) {
      expect(DESCRIPTORS_BY_ID[descriptor.id]).toBe(descriptor)
    }
  })

  it('provisional 體制（SP-0 對帳後）：僅 vim-mode／pr 維持 provisional', () => {
    const stillProvisional = SEGMENT_DESCRIPTORS.filter((d) => d.provisional).map((d) => d.id)
    expect(stillProvisional).toEqual(['vim-mode', 'pr'])
    // provisional 段附待驗 note；拆標段不留 stale note
    for (const d of SEGMENT_DESCRIPTORS) {
      if (d.provisional) expect(d.provisionalNote, d.id).toBeTruthy()
      else expect(d.provisionalNote, d.id).toBeUndefined()
    }
  })

  it('label／icon.ariaText 全非空（accessible name 素材）', () => {
    for (const d of SEGMENT_DESCRIPTORS) {
      expect(d.label.length, d.id).toBeGreaterThan(0)
      expect(d.icon.ariaText.length, d.id).toBeGreaterThan(0)
    }
  })

  it('目錄深凍結（descriptor／icon／variants／衍生 export 皆不可變）', () => {
    expect(Object.isFrozen(SEGMENT_DESCRIPTORS)).toBe(true)
    for (const d of SEGMENT_DESCRIPTORS) {
      expect(Object.isFrozen(d), d.id).toBe(true)
      expect(Object.isFrozen(d.icon), d.id).toBe(true)
      if (d.variants !== undefined) expect(Object.isFrozen(d.variants), d.id).toBe(true)
    }
    expect(Object.isFrozen(SEGMENT_IDS)).toBe(true)
    expect(Object.isFrozen(DESCRIPTORS_BY_ID)).toBe(true)
    expect(Object.isFrozen(SEGMENT_CATALOG)).toBe(true)
    expect(Object.isFrozen(SEGMENT_CATALOG.variantsById)).toBe(true)
  })
})

describe('icon（T1.5.2 ASCII 前綴化；(internal design doc)）', () => {
  // T2.2：icon.glyph 由 Nerd Font PUA 碼位改為 emoji 字面（06a 核可對照表）；
  // T1.5.2：emoji 字面推翻改為 ASCII 前綴字面（真機實測 statusline 不接受
  // emoji，見 prefix-table.md）。舊「凍結 PUA 碼位」不變量測試已隨之廢除，
  // 改為下列三項斷言。

  it('目錄級結構斷言：icon.glyph 非空 ⇒ icon.ariaText 非空（D1 Round 2 aria enforcement 補位——' +
    '真正要防的是 descriptor 作者漏填，非 PUA_RE 擴充）', () => {
    for (const d of SEGMENT_DESCRIPTORS) {
      if (d.icon.glyph.length > 0) expect(d.icon.ariaText.length, d.id).toBeGreaterThan(0)
    }
  })

  it('30 段 glyph 皆非 PUA（Nerd Font 碼位已全數移除，containsPua 全 false）', () => {
    for (const d of SEGMENT_DESCRIPTORS) {
      expect(containsPua(d.icon.glyph), d.id).toBe(false)
    }
  })

  it('30 段逐一對應 T1.5.2／T3.2 核可前綴對照表（prefix-table.md，字面照抄）', () => {
    const expected: Record<SegmentId, string> = {
      model: 'model:',
      cwd: 'cwd:',
      'project-dir': 'proj:',
      'output-style': 'style:',
      version: 'ver:',
      cost: 'cost:',
      duration: 'dur:',
      'lines-changed': 'diff:',
      'context-size': 'ctx:',
      thinking: 'think:',
      'token-in': 'in:',
      'token-out': 'out:',
      'context-used': 'used:',
      'context-remaining': 'left:',
      'rate-5h': '5h:',
      'rate-7d': '7d:',
      'cache-hit': 'cache:',
      'session-name': 'sess:',
      effort: 'eff:',
      'vim-mode': 'vim:',
      'agent-name': 'agent:',
      pr: 'pr:',
      repo: 'repo:',
      worktree: 'wt:',
      'worktree-branch': 'wtbr:',
      'reset-5h': 'r5h:',
      'reset-7d': 'r7d:',
      'git-branch': 'git:',
      'git-dirty': 'dirty:',
      clock: 'time:',
    }
    const actual = Object.fromEntries(SEGMENT_DESCRIPTORS.map((d) => [d.id, d.icon.glyph]))
    expect(actual).toEqual(expected)
  })

  it('30 前綴彼此唯一（prefix-table.md「唯一性檢查」節機械化）', () => {
    const glyphs = SEGMENT_DESCRIPTORS.map((d) => d.icon.glyph)
    expect(new Set(glyphs).size).toBe(glyphs.length)
    expect(glyphs.length).toBe(30)
  })
})

// ── locale 感知 accessor（T5.3；segmentLabel／segmentAriaText） ──

describe('locale accessor（segmentLabel／segmentAriaText，T5.3）', () => {
  it('缺省 locale＝DEFAULT_LOCALE（zh-Hant）：與 descriptor 現行欄位逐段一致', () => {
    for (const d of SEGMENT_DESCRIPTORS) {
      expect(segmentLabel(d.id), d.id).toBe(d.label)
      expect(segmentAriaText(d.id), d.id).toBe(d.icon.ariaText)
    }
  })

  it('兩語言 accessor 輸出與 messages.t(locale) 字典逐段一致（30 段全覆蓋）', () => {
    for (const locale of ['zh-Hant', 'en'] as const) {
      for (const id of SEGMENT_IDS) {
        expect(segmentLabel(id, locale), `${locale}/${id}`).toBe(t(locale).segments[id].label)
        expect(segmentAriaText(id, locale), `${locale}/${id}`).toBe(t(locale).segments[id].ariaText)
      }
    }
  })

  it('en 輸出確實不同於 zh-Hant（非退化為恆等函式，抽樣 model／cwd）', () => {
    expect(segmentLabel('model', 'en')).toBe('Model')
    expect(segmentLabel('model', 'en')).not.toBe(segmentLabel('model', 'zh-Hant'))
    expect(segmentAriaText('cwd', 'en')).toBe('Current dir')
    expect(segmentAriaText('cwd', 'en')).not.toBe(segmentAriaText('cwd', 'zh-Hant'))
  })
})

// ── 單一事實來源反轉（T5.3）：descriptor.label／icon.ariaText 現由 ──
// messages.ts zh-Hant 字典於模組初始化取得（見 segments.ts 檔內 `M` 常數）；
// 本測試因反轉而由「兩處手抄需同步」轉為結構性恆真（messages 為源、
// segments 為消費者，保留無妨——見 messages.test.ts 同名「零漂移」案）。
describe('單一事實來源反轉：descriptor.label／icon.ariaText 與 messages zh-Hant 字典結構性恆等', () => {
  it('30 段逐一比對', () => {
    const zh = t(DEFAULT_LOCALE)
    for (const d of SEGMENT_DESCRIPTORS) {
      expect(d.label, d.id).toBe(zh.segments[d.id].label)
      expect(d.icon.ariaText, d.id).toBe(zh.segments[d.id].ariaText)
    }
  })
})

describe('tri-path idiom 不變量', () => {
  it('shell-out 段：jqPath/ps1Path 空字串＋shellOut 齊備；其餘段相反', () => {
    for (const d of SEGMENT_DESCRIPTORS) {
      if (d.category === 'shell-out') {
        expect(d.jqPath, d.id).toBe('')
        expect(d.ps1Path, d.id).toBe('')
        expect(d.shellOut, d.id).toBeDefined()
      } else {
        expect(d.jqPath.startsWith('.'), d.id).toBe(true)
        expect(d.ps1Path.length, d.id).toBeGreaterThan(0)
        expect(d.shellOut, d.id).toBeUndefined()
      }
    }
  })

  it('worktree／cache-hit 以外的 stdin 段：ps1Path === "$d" + jqPath（機械同構）', () => {
    // cache-hit 例外（T3.2）：公式在取值層完成（CACHE_HIT_JQ_PATH／
    // CACHE_HIT_PS1_PATH），非單純屬性鏈，形狀不套用本機械同構規則，
    // 同 worktree 的 fallback 鏈例外（下方獨立測試釘死其字面）。
    for (const d of SEGMENT_DESCRIPTORS) {
      if (d.category === 'shell-out' || d.id === 'worktree' || d.id === 'cache-hit') continue
      expect(d.ps1Path, d.id).toBe(`$d${d.jqPath}`)
      if (d.resetsAt !== undefined) {
        expect(d.resetsAt.ps1Path, `${d.id} resetsAt`).toBe(`$d${d.resetsAt.jqPath}`)
      }
      if (d.expiresAtPath !== undefined) {
        expect(d.expiresAtPath.ps1Path, `${d.id} expiresAtPath`).toBe(`$d${d.expiresAtPath.jqPath}`)
      }
    }
  })

  it('worktree 雙表述併一：fallback 鏈字面釘死（下游 emitter 逐字抄）', () => {
    const d = DESCRIPTORS_BY_ID['worktree']
    expect(d.jqPath).toBe('.workspace.git_worktree // .worktree.name')
    expect(d.ps1Path).toBe(
      '$(if ($null -ne $d.workspace.git_worktree) { $d.workspace.git_worktree } else { $d.worktree.name })',
    )
  })

  it('shellOut 核心命令字面釘死（防禦包裹歸 emitter 契約 9）', () => {
    expect(DESCRIPTORS_BY_ID['git-branch'].shellOut).toEqual({
      bash: 'git branch --show-current',
      ps1: 'git branch --show-current',
    })
    expect(DESCRIPTORS_BY_ID['git-dirty'].shellOut).toEqual({
      bash: 'git status --porcelain',
      ps1: 'git status --porcelain',
    })
    expect(DESCRIPTORS_BY_ID['clock'].shellOut).toEqual({
      bash: 'date +%H:%M',
      ps1: 'Get-Date -Format HH:mm',
    })
  })

  it('resetsAt 僅 rate 兩段有；countdown 欄目錄驅動（M6 C3，零 id 特判）', () => {
    const withResetsAt = SEGMENT_DESCRIPTORS.filter((d) => d.resetsAt !== undefined).map((d) => d.id)
    expect(withResetsAt).toEqual(['rate-5h', 'rate-7d'])
    expect(DESCRIPTORS_BY_ID['rate-5h'].resetsAt?.countdown).toBe('reset-countdown-5h')
    expect(DESCRIPTORS_BY_ID['rate-7d'].resetsAt?.countdown).toBe('reset-countdown-7d')
  })

  it('T3.2：expiresAtPath 僅 reset 兩段有，三式非空', () => {
    const withExpiresAt = SEGMENT_DESCRIPTORS.filter((d) => d.expiresAtPath !== undefined).map(
      (d) => d.id,
    )
    expect(withExpiresAt).toEqual(['reset-5h', 'reset-7d'])
    for (const id of ['reset-5h', 'reset-7d'] as const) {
      const { expiresAtPath } = DESCRIPTORS_BY_ID[id]
      expect(expiresAtPath, id).toBeDefined()
      expect(expiresAtPath!.jqPath.length, id).toBeGreaterThan(0)
      expect(expiresAtPath!.ps1Path.length, id).toBeGreaterThan(0)
      expect(typeof expiresAtPath!.tsPath, id).toBe('function')
    }
  })

  it('T3.2：autoColor 僅 model／effort 兩段有，形狀正確（model 帶 key、effort 免 key）', () => {
    const withAutoColor = SEGMENT_DESCRIPTORS.filter((d) => d.autoColor !== undefined).map((d) => d.id)
    expect(withAutoColor).toEqual(['model', 'effort'])

    const model = DESCRIPTORS_BY_ID['model'].autoColor
    expect(model?.palette).toBe('model')
    expect(model?.key?.jqPath).toBe('.model.id')
    expect(model?.key?.ps1Path).toBe('$d.model.id')
    expect(model?.key?.tsPath(makeStatusData())).toBe('claude-fable-5')

    const effort = DESCRIPTORS_BY_ID['effort'].autoColor
    expect(effort?.palette).toBe('effort')
    expect(effort?.key).toBeUndefined()
  })
})

describe('nullPolicy 對應（產生器契約 3）', () => {
  it('全 30 段逐一釘死：percentage/token 兩段=dash、conditional=hide、thinking/clock=empty、git 兩段=hide', () => {
    const actual = Object.fromEntries(SEGMENT_DESCRIPTORS.map((d) => [d.id, d.nullPolicy]))
    expect(actual).toEqual({
      model: 'empty',
      cwd: 'empty',
      'project-dir': 'empty',
      'output-style': 'empty',
      version: 'empty',
      cost: 'empty',
      duration: 'empty',
      'lines-changed': 'empty',
      'context-size': 'empty',
      thinking: 'empty',
      'token-in': 'dash',
      'token-out': 'dash',
      'context-used': 'dash',
      'context-remaining': 'dash',
      'rate-5h': 'dash',
      'rate-7d': 'dash',
      'cache-hit': 'dash',
      'session-name': 'hide',
      effort: 'hide',
      'vim-mode': 'hide',
      'agent-name': 'hide',
      pr: 'hide',
      repo: 'hide',
      worktree: 'hide',
      'worktree-branch': 'hide',
      'reset-5h': 'hide',
      'reset-7d': 'hide',
      'git-branch': 'hide',
      'git-dirty': 'hide',
      clock: 'empty',
    })
  })
})

describe('variants', () => {
  it('僅 cwd／rate-5h／rate-7d 有 variants，內容＝表列常數', () => {
    const withVariants = SEGMENT_DESCRIPTORS.filter((d) => d.variants !== undefined).map((d) => d.id)
    expect(withVariants).toEqual(['cwd', 'rate-5h', 'rate-7d'])
    expect(DESCRIPTORS_BY_ID['cwd'].variants).toEqual(['full', 'basename', 'tilde'])
    expect(DESCRIPTORS_BY_ID['rate-5h'].variants).toEqual(['percent', 'percent-reset'])
    expect(DESCRIPTORS_BY_ID['rate-7d'].variants).toEqual(['percent', 'percent-reset'])
  })

  it('defaultVariant＝表列第一項；無 variants 段回 undefined', () => {
    expect(defaultVariant(DESCRIPTORS_BY_ID['cwd'])).toBe('full')
    expect(defaultVariant(DESCRIPTORS_BY_ID['rate-5h'])).toBe(RATE_VARIANTS[0])
    expect(defaultVariant(DESCRIPTORS_BY_ID['model'])).toBeUndefined()
  })
})

// ── tsPath spot-check ──

describe('tsPath spot-check', () => {
  const d = makeStatusData()

  it('永在段取值（cwd 取 top-level .cwd、非 workspace.current_dir）', () => {
    expect(tsValue('model', d)).toBe('Fable 5')
    expect(tsValue('cwd', d)).toBe('/home/u/proj')
    expect(tsValue('project-dir', d)).toBe('/home/u/proj')
    expect(tsValue('output-style', d)).toBe('default')
    expect(tsValue('version', d)).toBe('2.1.196')
    expect(tsValue('cost', d)).toBe(1.5)
    expect(tsValue('duration', d)).toBe(61000)
    expect(tsValue('lines-changed', d)).toBe(d.cost)
    expect(tsValue('context-size', d)).toBe(d.context_window)
    expect(tsValue('thinking', d)).toBe(true)
    expect(tsValue('thinking', makeStatusData({ thinking: { enabled: false } }))).toBe(false)
  })

  it('百分比段：值原樣、null 原樣穿透（dash 顯示歸 resolve 層）', () => {
    expect(tsValue('context-used', d)).toBe(42.5)
    expect(tsValue('context-remaining', d)).toBe(57.5)
    const early = makeStatusData({
      context_window: { ...d.context_window, used_percentage: null, remaining_percentage: null },
    })
    expect(tsValue('context-used', early)).toBeNull()
    expect(tsValue('context-remaining', early)).toBeNull()
  })

  it('rate 段：整包缺席→undefined、視窗缺席→undefined、值 null→null、齊備→值', () => {
    expect(tsValue('rate-5h', d)).toBeUndefined()
    expect(tsValue('rate-7d', d)).toBeUndefined()
    const partial = makeStatusData({
      rate_limits: { five_hour: { used_percentage: null, resets_at: null } },
    })
    expect(tsValue('rate-5h', partial)).toBeNull()
    expect(tsValue('rate-7d', partial)).toBeUndefined()
    const rated = makeStatusData({
      rate_limits: {
        five_hour: { used_percentage: 63.2, resets_at: 1783497600 },
        seven_day: { used_percentage: 21, resets_at: null },
      },
    })
    expect(tsValue('rate-5h', rated)).toBe(63.2)
    expect(tsValue('rate-7d', rated)).toBe(21)
  })

  it('resetsAt tri-path：缺席→undefined、null→null、齊備→epoch', () => {
    const rate5h = DESCRIPTORS_BY_ID['rate-5h']
    const rate7d = DESCRIPTORS_BY_ID['rate-7d']
    expect(rate5h.resetsAt!.tsPath(d)).toBeUndefined()
    const rated = makeStatusData({
      rate_limits: {
        five_hour: { used_percentage: 63.2, resets_at: 1783497600 },
        seven_day: { used_percentage: 21, resets_at: null },
      },
    })
    expect(rate5h.resetsAt!.tsPath(rated)).toBe(1783497600)
    expect(rate7d.resetsAt!.tsPath(rated)).toBeNull()
  })

  it('條件段：缺席一律 undefined（hide 剔段素材）', () => {
    const conditionalIds = SEGMENT_DESCRIPTORS.filter((s) => s.category === 'conditional').map(
      (s) => s.id,
    )
    for (const id of conditionalIds) {
      expect(tsValue(id, d), id).toBeUndefined()
    }
  })

  it('條件段：在席取值', () => {
    const present = makeStatusData({
      session_name: 'sprint-05',
      effort: { level: 'high' },
      vim: { mode: 'INSERT' },
      agent: { name: 'reviewer' },
      pr: { number: 42, url: 'https://example.com/pr/42', review_state: 'APPROVED' },
      workspace: { ...d.workspace, repo: { host: 'github.com', owner: 'alanwu', name: 'eztools' } },
    })
    expect(tsValue('session-name', present)).toBe('sprint-05')
    expect(tsValue('effort', present)).toBe('high')
    expect(tsValue('vim-mode', present)).toBe('INSERT')
    expect(tsValue('agent-name', present)).toBe('reviewer')
    expect(tsValue('pr', present)).toBe(present.pr)
    expect(tsValue('repo', present)).toBe(present.workspace.repo)
  })

  it('worktree fallback 鏈：git_worktree 優先→worktree.name→undefined', () => {
    const both = makeStatusData({
      workspace: { ...d.workspace, git_worktree: 'primary' },
      worktree: { name: 'secondary' },
    })
    expect(tsValue('worktree', both)).toBe('primary')
    const onlyTop = makeStatusData({ worktree: { name: 'secondary' } })
    expect(tsValue('worktree', onlyTop)).toBe('secondary')
    const onlyWs = makeStatusData({ workspace: { ...d.workspace, git_worktree: 'primary' } })
    expect(tsValue('worktree', onlyWs)).toBe('primary')
    expect(tsValue('worktree', d)).toBeUndefined()
    expect(tsValue('worktree', makeStatusData({ worktree: {} }))).toBeUndefined()
  })

  it('shell-out 段：tsPath 恆 undefined（值走 mock shell 通道）', () => {
    for (const id of ['git-branch', 'git-dirty', 'clock'] as const) {
      expect(tsValue(id, d), id).toBeUndefined()
    }
  })
})

// ── cache-hit 公式（tsPath 層直測；partial-null 矩陣，T3.2，08-PLAN Rev4 §3） ──

describe('cache-hit 公式（partial-null 矩陣）', () => {
  const base = makeStatusData()
  const withUsage = (usage: CurrentUsage | null): StatusData =>
    makeStatusData({ context_window: { ...base.context_window, current_usage: usage } })
  /** 三輸入欄齊備的基準值（read=500, in=300, creation=200）；覆寫個別欄位驗證矩陣。 */
  const usage = (overrides: Partial<CurrentUsage> = {}): CurrentUsage => ({
    input_tokens: 300,
    output_tokens: 100,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 500,
    ...overrides,
  })

  it('current_usage 整包 null → null', () => {
    expect(tsValue('cache-hit', withUsage(null))).toBeNull()
  })

  it('current_usage 整包缺席（key 不存在，非顯式 null；真 stdin 省略此 key 時的實況）→ null（不 throw）', () => {
    // 型別上 current_usage 為必填 `CurrentUsage | null`，此處故意繞過型別
    // 檢查構造「key 缺席」的 StatusData，模擬真 stdin context_window 省略
    // current_usage 的情境（見檔頭 T3.2 節）。回歸案：頂層守衛須用 `== null`
    // （涵蓋 undefined），否則會在下方解構賦值處 TypeError。
    const { current_usage: _omit, ...contextWindowWithoutCurrentUsage } = base.context_window
    const withoutCurrentUsage = {
      ...base,
      context_window: contextWindowWithoutCurrentUsage,
    } as unknown as StatusData
    expect(() => tsValue('cache-hit', withoutCurrentUsage)).not.toThrow()
    expect(tsValue('cache-hit', withoutCurrentUsage)).toBeNull()
  })

  it('任一輸入欄 null → null：(null,*,*)／(*,null,*)／(*,*,null)／(null,null,null) 四案', () => {
    expect(tsValue('cache-hit', withUsage(usage({ input_tokens: null })))).toBeNull()
    expect(tsValue('cache-hit', withUsage(usage({ cache_creation_input_tokens: null })))).toBeNull()
    expect(tsValue('cache-hit', withUsage(usage({ cache_read_input_tokens: null })))).toBeNull()
    expect(
      tsValue(
        'cache-hit',
        withUsage(
          usage({ input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null }),
        ),
      ),
    ).toBeNull()
  })

  it('輸入欄選填缺席（非顯式 null，對齊 mock-data.ts 現形）亦視為 null', () => {
    const partial: CurrentUsage = { input_tokens: 300, output_tokens: 100 }
    expect(tsValue('cache-hit', withUsage(partial))).toBeNull()
  })

  it('分母 0（三輸入欄全 0）→ 0', () => {
    expect(
      tsValue(
        'cache-hit',
        withUsage(usage({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })),
      ),
    ).toBe(0)
  })

  it('正常值案：read=500, in=300, creation=200 → floor(500×100/1000)=50', () => {
    expect(tsValue('cache-hit', withUsage(usage()))).toBe(50)
  })
})

// ── token-in／token-out（T3.2）：null 穿透、正常值直通 ──

describe('token-in／token-out', () => {
  const base = makeStatusData()

  it('current_usage null → tsPath undefined（isValueDead 視同死值，dash 顯示層一致）', () => {
    expect(tsValue('token-in', base)).toBeUndefined()
    expect(tsValue('token-out', base)).toBeUndefined()
  })

  it('current_usage 在、欄位顯式 null → null', () => {
    const withNulls = makeStatusData({
      context_window: {
        ...base.context_window,
        current_usage: { input_tokens: null, output_tokens: null },
      },
    })
    expect(tsValue('token-in', withNulls)).toBeNull()
    expect(tsValue('token-out', withNulls)).toBeNull()
  })

  it('正常值直通', () => {
    const withValues = makeStatusData({
      context_window: {
        ...base.context_window,
        current_usage: { input_tokens: 52341, output_tokens: 8123 },
      },
    })
    expect(tsValue('token-in', withValues)).toBe(52341)
    expect(tsValue('token-out', withValues)).toBe(8123)
  })
})

// ── reset-5h／reset-7d（T3.2）：缺席→undefined、null→null、齊備→epoch ──

describe('reset-5h／reset-7d', () => {
  const base = makeStatusData()

  it('rate_limits 整包缺席 → undefined', () => {
    expect(tsValue('reset-5h', base)).toBeUndefined()
    expect(tsValue('reset-7d', base)).toBeUndefined()
  })

  it('視窗在、resets_at null → null', () => {
    const partial = makeStatusData({
      rate_limits: { five_hour: { used_percentage: 10, resets_at: null } },
    })
    expect(tsValue('reset-5h', partial)).toBeNull()
    expect(tsValue('reset-7d', partial)).toBeUndefined()
  })

  it('齊備 → epoch 值；expiresAtPath 與主值讀同一底層欄位', () => {
    const rated = makeStatusData({
      rate_limits: {
        five_hour: { used_percentage: 63.2, resets_at: 1783497600 },
        seven_day: { used_percentage: 21, resets_at: 1783900800 },
      },
    })
    expect(tsValue('reset-5h', rated)).toBe(1783497600)
    expect(tsValue('reset-7d', rated)).toBe(1783900800)
    expect(DESCRIPTORS_BY_ID['reset-5h'].expiresAtPath!.tsPath(rated)).toBe(1783497600)
    expect(DESCRIPTORS_BY_ID['reset-7d'].expiresAtPath!.tsPath(rated)).toBe(1783900800)
  })
})

// ── 存活語意 ──

describe('isValueDead', () => {
  it('null／undefined／""／false＝死；0／"0"／true／物件＝活（0% 合法）', () => {
    expect(isValueDead(null)).toBe(true)
    expect(isValueDead(undefined)).toBe(true)
    expect(isValueDead('')).toBe(true)
    expect(isValueDead(false)).toBe(true)
    expect(isValueDead(0)).toBe(false)
    expect(isValueDead('0')).toBe(false)
    expect(isValueDead(true)).toBe(false)
    expect(isValueDead({})).toBe(false)
  })
})

// ── 格式化純函式（對抗值） ──

describe('formatCost（單次浮點乘 floor＋4 位補尾零）', () => {
  it('補尾零案：1.0→$1.0000、0.5→$0.5000、0.005→$0.0050', () => {
    expect(formatCost(1.0)).toBe('$1.0000')
    expect(formatCost(0.5)).toBe('$0.5000')
    expect(formatCost(0.005)).toBe('$0.0050')
  })

  it('截尾非捨入：0.01235→$0.0123（捨入半值不進位）', () => {
    expect(formatCost(0.01235)).toBe('$0.0123')
  })

  it('float 乘積下緣一致偏：0.0029→$0.0028（28.999…floor；三後端同 double 同偏）', () => {
    expect(formatCost(0.0029)).toBe('$0.0028')
  })

  it('零／整數位進位／大額', () => {
    expect(formatCost(0)).toBe('$0.0000')
    expect(formatCost(3.3341)).toBe('$3.3341')
    expect(formatCost(12.34567)).toBe('$12.3456')
    expect(formatCost(123.4)).toBe('$123.4000')
  })

  it('負值 clamp 0（cost 恆 ≥0 假設）', () => {
    expect(formatCost(-0.5)).toBe('$0.0000')
  })
})

describe('formatDuration（整數除法三階）', () => {
  it('秒階：0→0s、999→0s、1000→1s、59999→59s', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(999)).toBe('0s')
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(59999)).toBe('59s')
  })

  it('分階：60000→1m0s、61000→1m1s、3599999→59m59s', () => {
    expect(formatDuration(60000)).toBe('1m0s')
    expect(formatDuration(61000)).toBe('1m1s')
    expect(formatDuration(3599999)).toBe('59m59s')
  })

  it('時階：3600000→1h0m、3661000→1h1m、86399999→23h59m、90000000→25h0m（不折日）', () => {
    expect(formatDuration(3600000)).toBe('1h0m')
    expect(formatDuration(3661000)).toBe('1h1m')
    expect(formatDuration(86399999)).toBe('23h59m')
    expect(formatDuration(90000000)).toBe('25h0m')
  })
})

describe('formatPercentage（⌊p⌋%）', () => {
  it('floor 邊界：0／9.99→9％界／10.0／55／99.9／100／105（顯示層不 clamp）', () => {
    expect(formatPercentage(0)).toBe('0%')
    expect(formatPercentage(9.99)).toBe('9%')
    expect(formatPercentage(10.0)).toBe('10%')
    expect(formatPercentage(55)).toBe('55%')
    expect(formatPercentage(99.9)).toBe('99%')
    expect(formatPercentage(100)).toBe('100%')
    expect(formatPercentage(105)).toBe('105%')
  })
})

describe('formatContextSize（10⁶ 門檻 M-k）', () => {
  it('k 域：0→0k、999→0k、1000→1k、999999→999k', () => {
    expect(formatContextSize(0)).toBe('0k')
    expect(formatContextSize(999)).toBe('0k')
    expect(formatContextSize(1000)).toBe('1k')
    expect(formatContextSize(999999)).toBe('999k')
  })

  it('M 域：1000000→1M、1999999→1M、12345678→12M', () => {
    expect(formatContextSize(1_000_000)).toBe('1M')
    expect(formatContextSize(1_999_999)).toBe('1M')
    expect(formatContextSize(12_345_678)).toBe('12M')
  })
})

describe('formatLinesChanged／formatClockHM', () => {
  it('lines-changed：+A/-R 原整數（含全零）', () => {
    expect(formatLinesChanged(120, 45)).toBe('+120/-45')
    expect(formatLinesChanged(0, 0)).toBe('+0/-0')
  })

  it('HH:mm 兩欄皆零填補', () => {
    expect(formatClockHM(9, 5)).toBe('09:05')
    expect(formatClockHM(0, 0)).toBe('00:00')
    expect(formatClockHM(23, 58)).toBe('23:58')
  })
})

// resetsAtSuffix（rate 段 percent-reset 後綴格式化）已於 M6 T6.1 遷至
// resolve.ts（升級為倒數形需 now；直測見 resolve.test.ts「resetsAtSuffix」
// describe）——本檔僅保留 formatResetsAt（HH:mm 渲染，clock／resets_at 共用）。
describe('formatResetsAt', () => {
  /** 以本地時間建 epoch（測試不依賴時區）。 */
  const epochAtLocal = (h: number, m: number): number =>
    new Date(2026, 6, 8, h, m, 0, 0).getTime() / 1000

  it('epoch 秒→本地 HH:mm（零填補）', () => {
    expect(formatResetsAt(epochAtLocal(14, 30))).toBe('14:30')
    expect(formatResetsAt(epochAtLocal(0, 5))).toBe('00:05')
  })
})

describe('formatPath（cwd variants）', () => {
  it('full：原樣', () => {
    expect(formatPath('/home/u/proj', 'full', '/home/u')).toBe('/home/u/proj')
  })

  it('basename：斜線／反斜線／混用皆為分隔、尾分隔忽略、根路徑原樣', () => {
    expect(formatPath('/a/b/c', 'basename', '')).toBe('c')
    expect(formatPath('C:\\Users\\alan', 'basename', '')).toBe('alan')
    expect(formatPath('D:\\x/y', 'basename', '')).toBe('y')
    expect(formatPath('/a/b/', 'basename', '')).toBe('b')
    expect(formatPath('/', 'basename', '')).toBe('/')
    expect(formatPath('D:\\個人檔案\\工具箱', 'basename', '')).toBe('工具箱')
  })

  it('tilde：home 前綴嚴格逐字比對（含大小寫）、雙分隔符風格', () => {
    expect(formatPath('/home/alan', 'tilde', '/home/alan')).toBe('~')
    expect(formatPath('/home/alan/x', 'tilde', '/home/alan')).toBe('~/x')
    expect(formatPath('C:\\Users\\阿藍\\專案', 'tilde', 'C:\\Users\\阿藍')).toBe('~\\專案')
    // 假前綴（/home/alanb 非 /home/alan 子路徑）不縮
    expect(formatPath('/home/alanb/x', 'tilde', '/home/alan')).toBe('/home/alanb/x')
    // 大小寫不合不縮（Windows 寬鬆比對刻意不做）
    expect(formatPath('c:\\users\\阿藍\\x', 'tilde', 'C:\\Users\\阿藍')).toBe('c:\\users\\阿藍\\x')
    // home 空字串：原樣
    expect(formatPath('/home/alan/x', 'tilde', '')).toBe('/home/alan/x')
  })
})

describe('formatValue（FormatKind 派發）', () => {
  it('text／path（含 ctx.variant 預設 full）', () => {
    expect(formatValue('text', 'Fable 5')).toBe('Fable 5')
    expect(formatValue('path', '/a/b/c')).toBe('/a/b/c')
    expect(formatValue('path', '/a/b/c', { variant: 'basename' })).toBe('c')
    expect(formatValue('path', '/home/u/x', { variant: 'tilde', home: '/home/u' })).toBe('~/x')
  })

  it('cost／duration／percentage', () => {
    expect(formatValue('cost', 0.5)).toBe('$0.5000')
    expect(formatValue('duration', 60000)).toBe('1m0s')
    expect(formatValue('percentage', 9.99)).toBe('9%')
  })

  it('context-size：節點 in+out 總和過門檻', () => {
    const node = makeStatusData().context_window
    expect(formatValue('context-size', node)).toBe('1k') // 1200+300=1500
    expect(
      formatValue('context-size', { ...node, total_input_tokens: 998000, total_output_tokens: 152000 }),
    ).toBe('1M')
  })

  it('lines-changed：cost 節點雙欄', () => {
    expect(formatValue('lines-changed', makeStatusData().cost)).toBe('+3/-1')
  })

  it('flag／dirty：只對 true 呼叫（false 屬剔段路徑→TypeError）', () => {
    expect(formatValue('flag', true)).toBe('on')
    expect(formatValue('dirty', true)).toBe('*')
    expect(() => formatValue('flag', false)).toThrow(TypeError)
    expect(() => formatValue('dirty', null)).toThrow(TypeError)
  })

  it('pr／repo／clock', () => {
    expect(formatValue('pr', { number: 42, url: 'u', review_state: 'APPROVED' })).toBe('#42')
    expect(formatValue('repo', { host: 'github.com', owner: 'alanwu', name: 'eztools' })).toBe(
      'alanwu/eztools',
    )
    expect(formatValue('clock', { hours: 7, minutes: 3 })).toBe('07:03')
  })

  it('形狀不符＝programmer error→TypeError（驗證閘在上游）', () => {
    expect(() => formatValue('text', 42)).toThrow(TypeError)
    expect(() => formatValue('cost', '1.5')).toThrow(TypeError)
    expect(() => formatValue('percentage', Number.NaN)).toThrow(TypeError)
    expect(() => formatValue('context-size', 1500)).toThrow(TypeError)
    expect(() => formatValue('pr', { url: 'u' })).toThrow(TypeError)
    expect(() => formatValue('path', '/a', { variant: 'bogus' })).toThrow(TypeError)
  })
})

// ── catalog × config integration（真目錄餵清洗） ──

describe('SEGMENT_CATALOG × config.deserializeConfig', () => {
  it('catalog 注入面形狀：ids＝目錄序全 30、variantsById 僅三鍵', () => {
    expect(SEGMENT_CATALOG.ids).toEqual(SEGMENT_IDS)
    expect(Object.keys(SEGMENT_CATALOG.variantsById).sort()).toEqual(['cwd', 'rate-5h', 'rate-7d'])
    expect(SEGMENT_CATALOG.variantsById['cwd']).toEqual(CWD_VARIANTS)
    expect(SEGMENT_CATALOG.variantsById['rate-5h']).toEqual(RATE_VARIANTS)
  })

  // T3.3（(internal design doc) Rev 4 §3；round 2
  // 補閉）：barEligibleIds＝category==='percentage' 之段、autoEligibleIds＝
  // 有 autoColor 欄之段（T3.2 已為 model／effort 掛 autoColor）。清洗消費
  // （sanitizeSegment 據此執行 bar／auto 限段）屬 T3.4，本測試只驗導出。
  it('barEligibleIds 恰含 5 個百分比段', () => {
    expect(new Set(SEGMENT_CATALOG.barEligibleIds)).toEqual(
      new Set(['context-used', 'context-remaining', 'rate-5h', 'rate-7d', 'cache-hit']),
    )
  })

  it('autoEligibleIds 恰含 model／effort（有 autoColor 欄之段）', () => {
    expect(new Set(SEGMENT_CATALOG.autoEligibleIds)).toEqual(new Set(['model', 'effort']))
  })

  it('defaultConfig(真 catalog)：30 列目錄序全停用；serialize→deserialize 冪等', () => {
    const config = defaultConfig(SEGMENT_CATALOG)
    expect(config.segments.map((s) => s.id)).toEqual([...SEGMENT_IDS])
    expect(config.segments.every((s) => !s.enabled)).toBe(true)
    expect(deserializeConfig(serializeConfig(config), SEGMENT_CATALOG)).toEqual(config)
  })

  it('未知舊 id（git-worktree）丟棄；worktree／worktree-branch 拆段後皆合法保留', () => {
    const legacy = JSON.stringify({
      version: 1,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      segments: [
        // git-worktree＝從未出貨的假想舊 id → 非 catalog.ids → 清洗丟棄
        { id: 'git-worktree', enabled: true, icon: true, color: { kind: 'ansi256', index: 2 } },
        // SP-0 拆段後 worktree-branch／worktree 皆為合法目錄 id → 保留（含設定）
        { id: 'worktree-branch', enabled: true, icon: true, color: { kind: 'ansi256', index: 3 } },
        { id: 'worktree', enabled: true, icon: false, color: { kind: 'default' } },
        { id: 'model', enabled: true, icon: false, color: { kind: 'default' } },
      ],
    })
    const cleaned = deserializeConfig(legacy, SEGMENT_CATALOG)
    const ids = cleaned.segments.map((s) => s.id)
    expect(ids).not.toContain('git-worktree') // 未知 → 丟
    expect(ids).toContain('worktree-branch') // 合法 → 留
    expect(ids).toContain('worktree')
    // 丟 git-worktree 後存檔序保留（首三列＝worktree-branch, worktree, model）、
    // 缺段依目錄序補於末→產出為 catalog.ids 排列
    expect(ids.slice(0, 3)).toEqual(['worktree-branch', 'worktree', 'model'])
    expect([...ids].sort()).toEqual([...SEGMENT_IDS].sort())
    // worktree-branch 保留使用者設定（enabled/icon/color）
    expect(cleaned.segments.find((s) => s.id === 'worktree-branch')).toEqual({
      id: 'worktree-branch',
      enabled: true,
      icon: true,
      color: { kind: 'ansi256', index: 3 },
    })
  })

  it('variant 清洗走真 variants 表：合法保留、未知丟、無 variants 段丟', () => {
    const json = JSON.stringify({
      version: 1,
      mode: 'plain',
      separator: { kind: 'preset', value: '|' },
      lastArrowCap: true,
      segments: [
        { id: 'cwd', enabled: true, icon: false, color: { kind: 'default' }, variant: 'basename' },
        { id: 'rate-5h', enabled: true, icon: false, color: { kind: 'default' }, variant: 'percent-reset' },
        { id: 'rate-7d', enabled: true, icon: false, color: { kind: 'default' }, variant: 'hourly' },
        { id: 'model', enabled: true, icon: false, color: { kind: 'default' }, variant: 'full' },
      ],
    })
    const cleaned = deserializeConfig(json, SEGMENT_CATALOG)
    const byId = new Map(cleaned.segments.map((s) => [s.id, s]))
    expect(byId.get('cwd')?.variant).toBe('basename')
    expect(byId.get('rate-5h')?.variant).toBe('percent-reset')
    expect(byId.get('rate-7d')?.variant).toBeUndefined()
    expect(byId.get('model')?.variant).toBeUndefined()
  })

  it('使用者拖曳序保留＋缺段依目錄序補於末', () => {
    const json = JSON.stringify({
      version: 1,
      mode: 'powerline',
      separator: { kind: 'preset', value: '›' },
      lastArrowCap: false,
      segments: [
        { id: 'clock', enabled: true, icon: true, color: { kind: 'ansi256', index: 39 } },
        { id: 'git-branch', enabled: true, icon: true, color: { kind: 'ansi256', index: 2 } },
        { id: 'model', enabled: true, icon: false, color: { kind: 'default' } },
      ],
    })
    const cleaned = deserializeConfig(json, SEGMENT_CATALOG)
    const ids = cleaned.segments.map((s) => s.id)
    expect(ids.slice(0, 3)).toEqual(['clock', 'git-branch', 'model'])
    expect(ids.slice(3)).toEqual(SEGMENT_IDS.filter((id) => !['clock', 'git-branch', 'model'].includes(id)))
  })
})
