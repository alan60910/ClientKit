/**
 * sprint 17 D5／Verification (e)（(internal design doc)）：
 * `exec-detect-test-utils.ts` 的單元測試。`platform`／`env`／`exists`／`spawn`／
 * `mkdtemp`／`copy`／`rm` 全以假函式注入——不讀真檔、不起子行程，任何 OS 皆可跑。
 */
import { describe, expect, it } from 'vitest'
import {
  bashCandidates,
  cleanupOwnedJqDir,
  detectBash,
  detectJq,
  EXEC_DETECT_REASONS,
  JQ_TMP_PREFIX,
  WIN_JQ_BIN_NAMES,
  type BashJqExec,
  type ExecEnv,
  type ExecSpawn,
  type JqDetectDeps,
} from './exec-detect-test-utils.js'

const WIN_ENV: ExecEnv = {
  SP5_BASH: 'E:\\tools\\bash.exe',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\fixtureuser\\AppData\\Local',
  SCOOP: 'D:\\scoop',
  USERPROFILE: 'C:\\Users\\fixtureuser',
}

const PF_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const TMP_DIR = 'T:\\tmp\\sl-jq-abc123'
const JQ_SRC_DIR = 'D:\\jqsrc'

interface Calls {
  spawn: { cmd: string; args: readonly string[] }[]
  mkdtemp: string[]
  copy: { src: string; dest: string }[]
  rm: string[]
}

/** 假依賴：`files` 為「存在」的路徑集合；`spawnStatus` 為 `jq --version` 回傳碼。 */
function fakeDeps(
  platform: NodeJS.Platform,
  env: ExecEnv,
  files: readonly string[],
  spawnStatus: number | null = 0,
): { deps: JqDetectDeps; calls: Calls } {
  const calls: Calls = { spawn: [], mkdtemp: [], copy: [], rm: [] }
  const existing = new Set(files)
  const spawn: ExecSpawn = (cmd, args) => {
    calls.spawn.push({ cmd, args })
    return { status: spawnStatus }
  }
  const deps: JqDetectDeps = {
    platform,
    env,
    exists: (p) => existing.has(p),
    spawn,
    mkdtemp: (prefix) => {
      calls.mkdtemp.push(prefix)
      return TMP_DIR
    },
    copy: (src, dest) => {
      calls.copy.push({ src, dest })
    },
    rm: (dir) => {
      calls.rm.push(dir)
    },
  }
  return { deps, calls }
}

describe('bashCandidates（候選序，純函式）', () => {
  it('win32 全 env：SP5_BASH → ProgramFiles → LOCALAPPDATA → SCOOP → USERPROFILE\\scoop（字面陣列）', () => {
    expect(bashCandidates({ platform: 'win32', env: WIN_ENV })).toEqual([
      'E:\\tools\\bash.exe',
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Users\\fixtureuser\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
      'D:\\scoop\\apps\\git\\current\\bin\\bash.exe',
      'C:\\Users\\fixtureuser\\scoop\\apps\\git\\current\\bin\\bash.exe',
    ])
  })

  it('win32 env 缺 ProgramFiles／SP5_BASH／SCOOP：不產生 undefined 字首、無 System32、無裸 bash', () => {
    const cands = bashCandidates({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\fixtureuser\\AppData\\Local', USERPROFILE: 'C:\\Users\\fixtureuser' },
    })
    expect(cands).toEqual([
      'C:\\Users\\fixtureuser\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
      'C:\\Users\\fixtureuser\\scoop\\apps\\git\\current\\bin\\bash.exe',
    ])
    for (const c of cands) {
      expect(c.startsWith('undefined')).toBe(false)
      expect(c.toLowerCase()).not.toContain('system32')
      expect(c).not.toBe('bash')
    }
  })

  it('win32 空 env：無任何候選', () => {
    expect(bashCandidates({ platform: 'win32', env: {} })).toEqual([])
  })

  it('win32 空字串 env 視同未設', () => {
    expect(bashCandidates({ platform: 'win32', env: { SP5_BASH: '', ProgramFiles: '' } })).toEqual([])
  })

  it('win32 SCOOP 與 USERPROFILE\\scoop 相同時去重', () => {
    expect(
      bashCandidates({ platform: 'win32', env: { SCOOP: 'C:\\Users\\u\\scoop', USERPROFILE: 'C:\\Users\\u' } }),
    ).toEqual(['C:\\Users\\u\\scoop\\apps\\git\\current\\bin\\bash.exe'])
  })

  it('非 win32：SP5_BASH（有設時）→ /usr/bin/bash → /bin/bash；忽略 win32 專屬 env', () => {
    expect(bashCandidates({ platform: 'linux', env: {} })).toEqual(['/usr/bin/bash', '/bin/bash'])
    expect(bashCandidates({ platform: 'linux', env: { ...WIN_ENV, SP5_BASH: '/opt/bash' } })).toEqual([
      '/opt/bash',
      '/usr/bin/bash',
      '/bin/bash',
    ])
  })
})

describe('detectBash（注入 exists）', () => {
  it('回傳第一個存在的候選（SP5_BASH 覆寫優先）', () => {
    const exists = (p: string): boolean => p === PF_BASH || p === 'E:\\tools\\bash.exe'
    expect(detectBash({ platform: 'win32', env: WIN_ENV, exists })).toBe('E:\\tools\\bash.exe')
  })

  it('SP5_BASH 不存在時落到下一個存在者', () => {
    const exists = (p: string): boolean => p === PF_BASH
    expect(detectBash({ platform: 'win32', env: WIN_ENV, exists })).toBe(PF_BASH)
  })

  it('皆不存在 → undefined', () => {
    expect(detectBash({ platform: 'win32', env: WIN_ENV, exists: () => false })).toBeUndefined()
  })
})

describe('detectJq（win32：只認 SP5_JQ_DIR、一律複製到 mkdtemp）', () => {
  const winEnvWithJq: ExecEnv = { ProgramFiles: 'C:\\Program Files', SP5_JQ_DIR: JQ_SRC_DIR }

  it('bash 缺席 → ok:false、reason 為 bashMissing（不建暫存）', () => {
    const { deps, calls } = fakeDeps('win32', winEnvWithJq, [`${JQ_SRC_DIR}\\jq.exe`])
    const r = detectJq(deps)
    expect(r).toEqual({ ok: false, reason: EXEC_DETECT_REASONS.bashMissing })
    expect(calls.mkdtemp).toEqual([])
    expect(calls.copy).toEqual([])
  })

  it('SP5_JQ_DIR 未設 → ok:false 且 reason 為字面「SP5_JQ_DIR 未設」', () => {
    const { deps, calls } = fakeDeps('win32', { ProgramFiles: 'C:\\Program Files' }, [PF_BASH])
    const r = detectJq(deps)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('SP5_JQ_DIR 未設')
    expect(calls.mkdtemp).toEqual([])
    expect(calls.copy).toEqual([])
    expect(calls.spawn).toEqual([])
  })

  it('SP5_JQ_DIR 空字串視同未設', () => {
    const { deps } = fakeDeps('win32', { ProgramFiles: 'C:\\Program Files', SP5_JQ_DIR: '' }, [PF_BASH])
    expect(detectJq(deps)).toEqual({ ok: false, reason: 'SP5_JQ_DIR 未設' })
  })

  it('SP5_JQ_DIR 目錄無 jq → ok:false 且 reason 為字面 jqDirNoJq', () => {
    const { deps, calls } = fakeDeps('win32', winEnvWithJq, [PF_BASH])
    expect(detectJq(deps)).toEqual({ ok: false, reason: 'SP5_JQ_DIR 指定目錄無 jq.exe／jq-windows-amd64.exe' })
    expect(calls.mkdtemp).toEqual([])
    expect(calls.copy).toEqual([])
  })

  it.each(WIN_JQ_BIN_NAMES.map((n) => [n] as const))('接受檔名 %s：複製為 mkdtemp 下的 jq.exe、owned:true', (name) => {
    const { deps, calls } = fakeDeps('win32', winEnvWithJq, [PF_BASH, `${JQ_SRC_DIR}\\${name}`])
    const r = detectJq(deps)
    expect(r).toEqual({ ok: true, bash: PF_BASH, jqDir: TMP_DIR, owned: true })
    expect(calls.mkdtemp).toEqual([JQ_TMP_PREFIX])
    expect(calls.copy).toEqual([{ src: `${JQ_SRC_DIR}\\${name}`, dest: `${TMP_DIR}\\jq.exe` }])
    expect(calls.spawn).toEqual([])
  })

  it('SP5_JQ_DIR 僅有 jq-windows-amd64.exe：copy 被呼叫、目標為 mkdtemp 路徑下的 jq.exe', () => {
    const { deps, calls } = fakeDeps('win32', winEnvWithJq, [PF_BASH, `${JQ_SRC_DIR}\\jq-windows-amd64.exe`])
    detectJq(deps)
    expect(calls.copy).toHaveLength(1)
    expect(calls.copy[0]?.dest).toBe(`${TMP_DIR}\\jq.exe`)
  })

  it('兩檔名並存時優先 jq.exe', () => {
    const { deps, calls } = fakeDeps('win32', winEnvWithJq, [
      PF_BASH,
      `${JQ_SRC_DIR}\\jq.exe`,
      `${JQ_SRC_DIR}\\jq-windows-amd64.exe`,
    ])
    detectJq(deps)
    expect(calls.copy).toEqual([{ src: `${JQ_SRC_DIR}\\jq.exe`, dest: `${TMP_DIR}\\jq.exe` }])
  })

  it('owned:true 且 jqDir !== SP5_JQ_DIR；cleanup 只刪暫存目錄、不碰來源', () => {
    const { deps } = fakeDeps('win32', winEnvWithJq, [PF_BASH, `${JQ_SRC_DIR}\\jq.exe`])
    const r = detectJq(deps)
    expect(r.ok && r.owned).toBe(true)
    expect(r.ok ? r.jqDir : undefined).not.toBe(JQ_SRC_DIR)
    const removed: string[] = []
    cleanupOwnedJqDir(r, (dir) => removed.push(dir))
    expect(removed).toEqual([TMP_DIR])
    expect(removed).not.toContain(JQ_SRC_DIR)
  })

  it('minority「jq 暫存清理」：copy 於 mkdtemp 成功後拋錯 → 呼叫注入的 rm 清掉 mkdtemp 目錄、不碰來源目錄，並重新拋出原錯誤', () => {
    const { deps, calls } = fakeDeps('win32', winEnvWithJq, [PF_BASH, `${JQ_SRC_DIR}\\jq.exe`])
    const boom = new Error('copy failed: EBUSY')
    const throwingDeps: JqDetectDeps = {
      ...deps,
      copy: (src, dest) => {
        calls.copy.push({ src, dest })
        throw boom
      },
    }
    expect(() => detectJq(throwingDeps)).toThrow(boom)
    expect(calls.mkdtemp).toEqual([JQ_TMP_PREFIX])
    expect(calls.copy).toEqual([{ src: `${JQ_SRC_DIR}\\jq.exe`, dest: `${TMP_DIR}\\jq.exe` }])
    expect(calls.rm).toEqual([TMP_DIR])
    expect(calls.rm).not.toContain(JQ_SRC_DIR)
  })
})

describe('detectJq（非 win32：PATH jq 探測）', () => {
  it('{platform:linux}：走 spawn jq --version、jqDir undefined、owned:false、不建暫存', () => {
    const { deps, calls } = fakeDeps('linux', { SP5_JQ_DIR: '/ignored' }, ['/usr/bin/bash'])
    const r = detectJq(deps)
    expect(r).toEqual({ ok: true, bash: '/usr/bin/bash', jqDir: undefined, owned: false })
    expect(calls.spawn).toEqual([{ cmd: 'jq', args: ['--version'] }])
    expect(calls.mkdtemp).toEqual([])
    expect(calls.copy).toEqual([])
  })

  it('{platform:linux} jq 不在 PATH → ok:false、reason 為 posixJqMissing', () => {
    const { deps } = fakeDeps('linux', {}, ['/bin/bash'], 1)
    expect(detectJq(deps)).toEqual({ ok: false, reason: EXEC_DETECT_REASONS.posixJqMissing })
  })

  it('{platform:linux} bash 缺席 → bashMissing（不探 jq）', () => {
    const { deps, calls } = fakeDeps('linux', {}, [])
    expect(detectJq(deps)).toEqual({ ok: false, reason: EXEC_DETECT_REASONS.bashMissing })
    expect(calls.spawn).toEqual([])
  })
})

describe('cleanupOwnedJqDir', () => {
  it('owned:false（PATH jq）與 ok:false 皆不呼叫 rm', () => {
    const removed: string[] = []
    const rm = (dir: string): void => {
      removed.push(dir)
    }
    const pathJq: BashJqExec = { ok: true, bash: '/usr/bin/bash', jqDir: undefined, owned: false }
    const skipped: BashJqExec = { ok: false, reason: EXEC_DETECT_REASONS.jqDirUnset }
    cleanupOwnedJqDir(pathJq, rm)
    cleanupOwnedJqDir(skipped, rm)
    expect(removed).toEqual([])
  })
})

describe('reason 字串全集（CI 拓撲鎖 regex 相容）', () => {
  it('jqDirUnset 符合三檔拓撲鎖 /^SP5_JQ_DIR 未設/，其餘 reason 皆不符', () => {
    const lock = /^SP5_JQ_DIR 未設/
    expect(EXEC_DETECT_REASONS.jqDirUnset).toMatch(lock)
    expect(EXEC_DETECT_REASONS.jqDirNoJq).not.toMatch(lock)
    expect(EXEC_DETECT_REASONS.bashMissing).not.toMatch(lock)
    expect(EXEC_DETECT_REASONS.posixJqMissing).not.toMatch(lock)
  })
})
