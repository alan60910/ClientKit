/**
 * S5-T2.6（PLAN §產生器契約 11／§F4／§F12）：emitSettings 測試。
 *
 * 覆蓋：command 形（Windows powershell/pwsh wrapper 逐字＋forward-slash＋
 * 含空白 quote／POSIX 直呼／缺省路徑）；refreshInterval 條件（clock 有/無、
 * rate percent-reset 有/無、reset-5h／reset-7d 倒數段矩陣（T4.5，08-PLAN
 * Rev 4 §4）、percent-reset 變體正反兩向獨立釘住（M6 C6，TASKS.md T6.4）、
 * 只計啟用段、自訂值＋clamp）；hideVimModeIndicator 條件；JSON.parse
 * 回讀合法＋片段結構；附帶文案常數存在。
 */
import { describe, expect, it } from 'vitest'
import type { BuilderConfig, SegmentConfig } from './config.js'
import {
  CHMOD_HINT,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  GPO_ALLSIGNED_NOTE,
  MOTW_HINT,
  emitSettings,
} from './emit-settings.js'

// ── config 建構小工具 ──

const seg = (id: string, over: Partial<SegmentConfig> = {}): SegmentConfig => ({
  id,
  enabled: true,
  icon: false,
  color: { kind: 'default' },
  ...over,
})
const cfg = (over: Partial<BuilderConfig> = {}): BuilderConfig => {
  const mode = over.mode ?? 'plain'
  return {
    version: 2,
    mode,
    separator: { kind: 'preset', value: '|' },
    lastArrowCap: true,
    powerlineArrow: mode === 'powerline',
    segments: [],
    ...over,
  }
}

/** 產出 → 解析後的 statusLine 物件（同時斷言 JSON.parse 合法）。 */
const sl = (config: BuilderConfig, opts: Parameters<typeof emitSettings>[1]): Record<string, unknown> => {
  const obj = JSON.parse(emitSettings(config, opts)) as { statusLine: Record<string, unknown> }
  return obj.statusLine
}

// ── 1. command 形 ──

describe('command 形（契約 11／F12）', () => {
  it('Windows powershell wrapper 逐字形＋forward-slash 路徑', () => {
    const s = sl(cfg(), { target: 'windows-powershell', scriptPath: 'C:\\Users\\me\\.claude\\statusline.ps1' })
    expect(s.type).toBe('command')
    expect(s.command).toBe(
      'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/me/.claude/statusline.ps1',
    )
  })

  it('Windows pwsh 7 wrapper（首 token 換 pwsh）', () => {
    const s = sl(cfg(), { target: 'windows-pwsh', scriptPath: 'C:\\x\\statusline.ps1' })
    expect(s.command).toBe('pwsh -NoProfile -ExecutionPolicy Bypass -File C:/x/statusline.ps1')
  })

  it('POSIX 直呼路徑（無 wrapper）', () => {
    const s = sl(cfg(), { target: 'posix', scriptPath: '~/.claude/statusline.sh' })
    expect(s.command).toBe('~/.claude/statusline.sh')
  })

  it('含空白路徑 → -File 值雙引號包覆（Windows）', () => {
    const s = sl(cfg(), {
      target: 'windows-powershell',
      scriptPath: 'C:\\Users\\John Doe\\.claude\\statusline.ps1',
    })
    expect(s.command).toBe(
      'powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Users/John Doe/.claude/statusline.ps1"',
    )
  })

  it('缺省路徑：Windows → statusline.ps1、POSIX → statusline.sh', () => {
    expect(sl(cfg(), { target: 'windows-powershell' }).command).toBe(
      'powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/statusline.ps1',
    )
    expect(sl(cfg(), { target: 'posix' }).command).toBe('~/.claude/statusline.sh')
  })
})

// ── 2. refreshInterval 條件 ──

describe('refreshInterval 條件（契約 11／F4）', () => {
  it('clock 啟用 → 附 refreshInterval（缺省 60）', () => {
    expect(sl(cfg({ segments: [seg('clock')] }), { target: 'posix' }).refreshInterval).toBe(
      DEFAULT_REFRESH_INTERVAL_SECONDS,
    )
  })

  it('無時間段 → 省略 refreshInterval', () => {
    expect(sl(cfg({ segments: [seg('model')] }), { target: 'posix' })).not.toHaveProperty(
      'refreshInterval',
    )
  })

  it('rate 段 percent-reset variant → 附 refreshInterval', () => {
    expect(
      sl(cfg({ segments: [seg('rate-5h', { variant: 'percent-reset' })] }), { target: 'posix' })
        .refreshInterval,
    ).toBe(60)
    expect(
      sl(cfg({ segments: [seg('rate-7d', { variant: 'percent-reset' })] }), { target: 'posix' })
        .refreshInterval,
    ).toBe(60)
  })

  it('rate 段 percent variant（無 resets 倒數）→ 省略', () => {
    expect(
      sl(cfg({ segments: [seg('rate-5h', { variant: 'percent' })] }), { target: 'posix' }),
    ).not.toHaveProperty('refreshInterval')
  })

  // M6 C6（(internal design doc) T6.4；使用者
  // 2026-07-14 拍板契約）：percent-reset 後綴自 C3 起升級為倒數形（隨
  // now 變動），單獨存在（無 clock、無 reset-5h／reset-7d 獨立倒數段）
  // 亦須 refreshInterval——正反兩向明確釘住，與上方「rate 段 percent-reset
  // variant → 附 refreshInterval」互為佐證（hasResetsCountdown 條件本身
  // 只判 variant、不判 clock／reset-5h／reset-7d 是否存在）。
  it('C6 正向：percent-reset 變體單獨存在（無 clock／reset-5h／reset-7d）→ 仍需 refreshInterval', () => {
    expect(
      sl(cfg({ segments: [seg('model'), seg('rate-5h', { variant: 'percent-reset' })] }), {
        target: 'posix',
      }).refreshInterval,
    ).toBe(60)
  })

  it('C6 反向：無 percent-reset 變體、無 clock、無 reset-5h／reset-7d → 省略 refreshInterval', () => {
    expect(
      sl(
        cfg({
          segments: [seg('model'), seg('rate-5h', { variant: 'percent' }), seg('rate-7d')],
        }),
        { target: 'posix' },
      ),
    ).not.toHaveProperty('refreshInterval')
  })

  // T4.5（(internal design doc) Rev 4 §4）：reset-5h
  // ／reset-7d 獨立倒數段——輸出隨時間變動，各自啟用即需 refreshInterval。
  it('reset-5h 啟用 → 附 refreshInterval（倒數段，08-PLAN Rev 4 §4）', () => {
    expect(
      sl(cfg({ segments: [seg('reset-5h')] }), { target: 'posix' }).refreshInterval,
    ).toBe(60)
  })

  it('reset-7d 啟用 → 附 refreshInterval（倒數段，08-PLAN Rev 4 §4）', () => {
    expect(
      sl(cfg({ segments: [seg('reset-7d')] }), { target: 'posix' }).refreshInterval,
    ).toBe(60)
  })

  it('reset-5h／reset-7d 皆停用 → 省略（只計啟用段）', () => {
    expect(
      sl(
        cfg({
          segments: [seg('reset-5h', { enabled: false }), seg('reset-7d', { enabled: false })],
        }),
        { target: 'posix' },
      ),
    ).not.toHaveProperty('refreshInterval')
  })

  it('只計啟用段：clock 停用 → 省略', () => {
    expect(
      sl(cfg({ segments: [seg('clock', { enabled: false })] }), { target: 'posix' }),
    ).not.toHaveProperty('refreshInterval')
  })

  it('自訂 refreshInterval 值', () => {
    expect(
      sl(cfg({ segments: [seg('clock')] }), { target: 'posix', refreshInterval: 30 }).refreshInterval,
    ).toBe(30)
  })

  it('refreshInterval clamp 至 ≥1 整數（F4 最小 1 秒）', () => {
    expect(
      sl(cfg({ segments: [seg('clock')] }), { target: 'posix', refreshInterval: 0 }).refreshInterval,
    ).toBe(1)
    expect(
      sl(cfg({ segments: [seg('clock')] }), { target: 'posix', refreshInterval: 5.9 }).refreshInterval,
    ).toBe(5)
  })
})

// ── 3. hideVimModeIndicator 條件 ──

describe('hideVimModeIndicator 條件（契約 11）', () => {
  it('vim-mode 啟用 → hideVimModeIndicator: true', () => {
    expect(sl(cfg({ segments: [seg('vim-mode')] }), { target: 'posix' }).hideVimModeIndicator).toBe(
      true,
    )
  })

  it('無 vim-mode → 省略', () => {
    expect(sl(cfg({ segments: [seg('model')] }), { target: 'posix' })).not.toHaveProperty(
      'hideVimModeIndicator',
    )
  })

  it('只計啟用段：vim-mode 停用 → 省略', () => {
    expect(
      sl(cfg({ segments: [seg('vim-mode', { enabled: false })] }), { target: 'posix' }),
    ).not.toHaveProperty('hideVimModeIndicator')
  })
})

// ── 4. JSON 合法性＋片段結構 ──

describe('JSON 合法性＋片段結構', () => {
  it('產出可 JSON.parse、頂層含 statusLine（完整可合併物件）', () => {
    const out = emitSettings(cfg({ segments: [seg('clock'), seg('vim-mode')] }), {
      target: 'windows-powershell',
    })
    const obj = JSON.parse(out) as { statusLine: Record<string, unknown> }
    expect(obj).toHaveProperty('statusLine')
    expect(obj.statusLine.type).toBe('command')
    expect(obj.statusLine.refreshInterval).toBe(60)
    expect(obj.statusLine.hideVimModeIndicator).toBe(true)
  })

  it('全條件觸發時 key 序＝type→command→refreshInterval→hideVimModeIndicator', () => {
    const out = emitSettings(cfg({ segments: [seg('clock'), seg('vim-mode')] }), { target: 'posix' })
    const keys = Object.keys(
      (JSON.parse(out) as { statusLine: Record<string, unknown> }).statusLine,
    )
    expect(keys).toEqual(['type', 'command', 'refreshInterval', 'hideVimModeIndicator'])
  })

  it('最小 config（無段）→ 僅 type＋command', () => {
    const keys = Object.keys(sl(cfg(), { target: 'posix' }))
    expect(keys).toEqual(['type', 'command'])
  })
})

// ── 5. 附帶文案常數 ──

describe('附帶文案常數（契約 11／F12）', () => {
  it('MOTW／Unblock-File 提示存在', () => {
    expect(MOTW_HINT).toContain('Unblock-File')
    expect(MOTW_HINT).toContain('Mark-of-the-Web')
  })

  it('GPO 強制 AllSigned wrapper 無效註記存在', () => {
    expect(GPO_ALLSIGNED_NOTE).toContain('AllSigned')
    expect(GPO_ALLSIGNED_NOTE).toContain('GPO')
  })

  it('POSIX chmod +x 提示存在', () => {
    expect(CHMOD_HINT).toContain('chmod +x')
  })
})
