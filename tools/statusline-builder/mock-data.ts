/**
 * S5-T2.1（(internal design doc) §預覽契約 mock 情境／§D1
 * 欄位多樣性要求）：canonical mock 情境集——滿血／session 早期 null／
 * 條件欄位缺席／Windows 長路徑＋CJK。
 *
 * ── provisional 體制（SP-0 對帳後，2026-07-09）──
 * SP-0 真機 fixture（fixtures/stdin-dump.jsonl，73 筆）已對帳：本檔情境
 * 所依 schema 全數命中真檔。情境仍為**手工構造**的 canonical 對抗集
 * （刻意保留 CJK／邊界百分比等真檔未必涵蓋的多樣性，較原始擷取更利
 * 測試），故 `provisional: true` 續留（語意＝合成非擷取派生，仍為真）；
 * worktree 拆段（名稱＋分支）已反映。逐欄證據見 WORKS 2026-07-09。
 *
 * ── 三通道契約（resolve（T2.2）／真執行 harness（T2.7）消費面）──
 * - `data`：StatusData＝真 stdin JSON 的 1:1 形——`JSON.stringify(data)`
 *   直餵產出腳本 stdin（mirror roundtrip 由 mock-data.test.ts 釘住；
 *   條件欄缺席＝鍵不存在，絕不以 undefined 值佔位）。
 * - `shell`：shell-out 段（tsPath 恆回 undefined）的預覽值通道；「死值」
 *   同 segments.ts isValueDead（git-branch ''＝非 git／detached → 剔段、
 *   git-dirty false＝乾淨 → 剔段）。真執行 harness 不用此通道（真跑
 *   shell 命令），僅預覽／resolve 單元測試消費。
 * - `env`：格式化環境通道（tilde 縮寫的 home——bash `$HOME`／ps1
 *   `$env:USERPROFILE` 的 mock 對應）。
 *
 * ── T4.5（(internal design doc) Rev 4 §3）──
 * 情境增固定 `now` 欄（決定論 mock 時鐘；消費屬 T4.1），`resets_at`
 * 改以 now 相對式表述（絕對值維持不變，見下方 *_NOW 註解）；
 * `current_usage` 各情境補 cache 兩欄——full 四欄齊備（cache-hit 存活）、
 * conditional-absent 四欄全 0（除零 → 0）、windows-cjk cache_read null
 * （partial-null 代表點 → null）、early-null 整包 null 如故。
 *
 * ── 欄位多樣性不變量（D1）──
 * 每個 descriptor 的來源欄位在本情境集中：值至少兩相異、且至少一情境
 * 非 null——使 §3 真執行對每條 jqPath/ps1Path 可觀測（打錯 path 不得
 * 靜默通過）。機械斷言在 mock-data.test.ts（遍歷 catalog×情境）。
 *
 * 註：PLAN 預覽契約另列 {plain,powerline}×{隱藏位置}×閾值邊界之 C1
 * 組合情境——那是 **config 側**變因（同一 StatusData 配不同 config），
 * 歸 T2.2/T2.3；本檔只承載 StatusData 側情境。
 *
 * 純函式資料模組、零 DOM import，node 可測。
 */
import type { ClockParts, StatusData } from './segments.js'

// ── 型別 ──

export type MockScenarioId = 'full' | 'early-null' | 'conditional-absent' | 'windows-cjk'

/** shell-out 段預覽值通道（鍵＝shell-out segment id，目錄同步由測試釘住）。 */
export interface MockShellChannel {
  /** `git branch --show-current` 首行；''＝非 git 目錄／detached（剔段）。 */
  'git-branch': string
  /** `git status --porcelain` 非空與否；false＝乾淨（剔段）。 */
  'git-dirty': boolean
  /** 預覽時鐘的決定論輸入（真腳本用系統時鐘）。 */
  clock: ClockParts
}

export interface MockScenario {
  id: MockScenarioId
  /**
   * UI 顯示名（mock 情境 radiogroup 的 accessible label）——**非渲染
   * 副本**：實際渲染權威來源為 index.html 情境 radio 的靜態 label 字面
   * （main.ts 不讀本欄位填 DOM），故不列入 i18n 面（09-PLAN §D5 A-3，
   * T5.4）。此欄僅供本模組自身文件/測試可讀性參照。
   */
  label: string
  /** 情境角色（何以入 canonical 集）。 */
  note: string
  /** provisional 體制：F1 轉述 schema 派生、未經真機 fixture 驗證。 */
  provisional: true
  /**
   * T4.5（(internal design doc) Rev 4 §3）：情境
   * 固定「現在」（epoch 秒）——預覽倒數／過期判定的決定論 mock 時鐘
   * （resolve／expiresAtPath 消費屬 T4.1，本欄先落資料層）。情境內
   * `resets_at` 一律以本欄相對值表述（now+Δ）→ 相對倒數決定論、永不過期。
   */
  now: number
  /** 真 stdin JSON 的 1:1 形（JSON.stringify 直餵腳本 stdin）。 */
  data: StatusData
  shell: MockShellChannel
  env: { home: string }
}

// ── 情境集 ──

function deepFreeze<T>(v: T): T {
  if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
    for (const key of Object.getOwnPropertyNames(v)) {
      deepFreeze((v as Record<string, unknown>)[key])
    }
    Object.freeze(v)
  }
  return v
}

// ── 情境固定 now（T4.5，08-PLAN Rev 4 §3） ──
// 各情境自帶決定論 epoch「現在」；resets_at 改以 now 相對式表述（now+Δ）。
// 值的挑選：full／windows-cjk 的 five_hour.resets_at 維持原絕對字面
// （1783497600／1783501200＝各自 now+2h）不變——消費端註解
// （pipeline.integration.test.ts、emit-bash.test.ts）引用該字面值，且
// oracle 同機現算下值保持可免既有 byte-exact 案任何位移。
const FULL_NOW = 1783490400 // 2026-07-08T06:00:00Z
const EARLY_NOW = 1783468800 // 2026-07-08T00:00:00Z
const COND_NOW = 1783512000 // 2026-07-08T12:00:00Z
const WIN_NOW = 1783494000 // 2026-07-08T07:00:00Z

const MOCK_SCENARIO_LIST: MockScenario[] = [
  {
    id: 'full',
    label: '滿血（全欄位齊備）',
    note: '全 30 段存活：條件欄全在、百分比非 null、rate_limits 雙視窗、current_usage 四欄齊備（cache-hit 有值）、git 髒。worktree 名稱段走 git_worktree 優先（top-level worktree 物件並存，供 worktree-branch）。',
    provisional: true,
    now: FULL_NOW,
    data: {
      cwd: '/home/user/projects/ClientKit',
      session_id: 'sess-full-0001',
      transcript_path: '/home/user/.claude/projects/ClientKit/transcript-full.jsonl',
      version: '2.1.196',
      model: { id: 'claude-fable-5', display_name: 'Fable 5' },
      workspace: {
        current_dir: '/home/user/projects/ClientKit',
        project_dir: '/home/user/projects/ClientKit',
        added_dirs: ['/home/user/projects/shared-lib'],
        git_worktree: 'feature-statusline',
        repo: { host: 'github.com', owner: 'user', name: 'ClientKit' },
      },
      output_style: { name: 'default' },
      cost: {
        total_cost_usd: 3.3341,
        total_duration_ms: 5025000,
        total_api_duration_ms: 1200500,
        total_lines_added: 120,
        total_lines_removed: 45,
      },
      context_window: {
        total_input_tokens: 52341,
        total_output_tokens: 8123,
        context_window_size: 200000,
        used_percentage: 42.5,
        remaining_percentage: 57.5,
        // T4.5（08-PLAN Rev 4 §3）：cache 兩欄補齊——四欄皆非 null，
        // cache-hit 存活：floor(45000*100/(52341+2659+45000))＝45。
        current_usage: {
          input_tokens: 52341,
          output_tokens: 8123,
          cache_creation_input_tokens: 2659,
          cache_read_input_tokens: 45000,
        },
      },
      exceeds_200k_tokens: false,
      thinking: { enabled: true },
      session_name: 'sprint-05-statusline',
      prompt_id: 'prompt-abc123',
      effort: { level: 'high' },
      vim: { mode: 'NORMAL' },
      agent: { name: 'reviewer' },
      pr: {
        number: 42,
        url: 'https://github.com/user/ClientKit/pull/42',
        review_state: 'APPROVED',
      },
      rate_limits: {
        // T4.5：resets_at＝now 相對式；絕對值不變（five_hour＝1783497600、
        // seven_day＝1783900800，見上方 FULL_NOW 註解）。
        five_hour: { used_percentage: 63.2, resets_at: FULL_NOW + 2 * 3600 },
        seven_day: { used_percentage: 21, resets_at: FULL_NOW + (4 * 24 + 18) * 3600 },
      },
      // SP-0 L22：worktree 物件與 workspace.git_worktree 並存（名稱同值；
      // 此段另供 branch）；名稱段仍走 git_worktree 優先路徑。
      worktree: {
        name: 'feature-statusline',
        path: '/home/user/.worktrees/feature-statusline',
        branch: 'wt-feature-statusline',
        original_cwd: '/home/user/projects/ClientKit',
        original_branch: 'DEV',
      },
    },
    shell: { 'git-branch': 'DEV', 'git-dirty': true, clock: { hours: 9, minutes: 5 } },
    env: { home: '/home/user' },
  },
  {
    id: 'early-null',
    label: '早期 session（可 null 欄全 null）',
    note: '首次 API 回應前：used/remaining/current_usage 為 null（dash 段顯 "--"）、rate_limits 未出現、條件欄全缺、cost 全零。',
    provisional: true,
    now: EARLY_NOW,
    data: {
      cwd: '/home/user',
      session_id: 'sess-early-0002',
      transcript_path: '/home/user/.claude/projects/home/transcript-early.jsonl',
      version: '2.1.169',
      model: { id: 'claude-sonnet-5', display_name: 'Sonnet 5' },
      workspace: {
        current_dir: '/home/user',
        project_dir: '/home/user',
        added_dirs: [],
      },
      output_style: { name: 'Explanatory' },
      cost: {
        total_cost_usd: 0,
        total_duration_ms: 0,
        total_api_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
      },
      context_window: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        context_window_size: 200000,
        used_percentage: null,
        remaining_percentage: null,
        current_usage: null,
      },
      exceeds_200k_tokens: false,
      thinking: { enabled: false },
    },
    shell: { 'git-branch': 'main', 'git-dirty': false, clock: { hours: 23, minutes: 58 } },
    env: { home: '/home/user' },
  },
  {
    id: 'conditional-absent',
    label: '條件欄位全缺席',
    note: '條件段全剔（鍵缺席）＋非 git 目錄（git-branch ""／git-dirty false）；百分比取 9.99/90.01 邊界值；current_usage 四欄全 0（cache-hit 除零守門 → 0）；current_dir 刻意 ≠ cwd。',
    provisional: true,
    now: COND_NOW,
    data: {
      cwd: '/tmp/demo-project',
      session_id: 'sess-cond-0003',
      transcript_path: '/tmp/demo-project/.claude/transcript-cond.jsonl',
      version: '2.1.153',
      model: { id: 'claude-haiku-4-5-20251001', display_name: 'Haiku 4.5' },
      workspace: {
        current_dir: '/tmp/demo-project/src',
        project_dir: '/tmp/demo-project',
        added_dirs: [],
      },
      output_style: { name: 'Concise' },
      cost: {
        total_cost_usd: 0.5,
        total_duration_ms: 59999,
        total_api_duration_ms: 31000,
        total_lines_added: 7,
        total_lines_removed: 0,
      },
      context_window: {
        total_input_tokens: 19980,
        total_output_tokens: 20,
        context_window_size: 200000,
        used_percentage: 9.99,
        remaining_percentage: 90.01,
        // T4.5（08-PLAN Rev 4 §3）：「四欄全 0」除零情境資料點——cache-hit
        // 公式分母 0 → 0（非 null）；token-in/out 顯 0（dash 政策下存活）。
        current_usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      exceeds_200k_tokens: false,
      thinking: { enabled: false },
    },
    shell: { 'git-branch': '', 'git-dirty': false, clock: { hours: 0, minutes: 0 } },
    env: { home: '/root' },
  },
  {
    id: 'windows-cjk',
    label: 'Windows 長路徑＋CJK',
    note: '反斜線長路徑＋CJK 值（路徑／repo／agent／worktree 名稱＋分支）；worktree 名稱段走 top-level worktree.name fallback、worktree-branch 取 worktree.branch（CJK）；seven_day.resets_at null；cache_read null（partial-null 代表點 → cache-hit "--"）；exceeds_200k true。',
    provisional: true,
    now: WIN_NOW,
    data: {
      cwd: 'D:\\個人檔案\\專案\\極長路徑測試\\由多層目錄組成用來檢驗預覽與 basename 邏輯\\ClientKit 工作區',
      session_id: 'sess-win-0004',
      transcript_path: 'C:\\Users\\user\\.claude\\projects\\ClientKit\\transcript-win.jsonl',
      version: '2.2.0',
      model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8' },
      workspace: {
        current_dir:
          'D:\\個人檔案\\專案\\極長路徑測試\\由多層目錄組成用來檢驗預覽與 basename 邏輯\\ClientKit 工作區',
        project_dir: 'D:\\個人檔案\\專案',
        added_dirs: ['D:\\個人檔案\\素材庫', 'E:\\備份'],
        repo: { host: 'gitlab.example.com', owner: '藍隊', name: '工具箱' },
      },
      output_style: { name: '學習模式' },
      cost: {
        total_cost_usd: 12.0058,
        total_duration_ms: 3661000,
        total_api_duration_ms: 2400000,
        total_lines_added: 3210,
        total_lines_removed: 1987,
      },
      context_window: {
        total_input_tokens: 998000,
        total_output_tokens: 152000,
        context_window_size: 1000000,
        used_percentage: 87.3,
        remaining_percentage: 12.7,
        // T4.5（08-PLAN Rev 4 §3）：partial-null 代表點——cache_read 為
        // null（欄位在、值 null）→ cache-hit 公式回 null（dash '--'）；
        // 矩陣其餘 null／缺席組合為 test-only 資料（mock-data.test.ts）。
        current_usage: {
          input_tokens: 998000,
          output_tokens: 152000,
          cache_creation_input_tokens: 240000,
          cache_read_input_tokens: null,
        },
      },
      exceeds_200k_tokens: true,
      thinking: { enabled: true },
      session_name: '狀態列建置測試',
      prompt_id: 'prompt-win-0777',
      effort: { level: 'medium' },
      vim: { mode: 'INSERT' },
      agent: { name: '開發代理' },
      pr: {
        number: 1387,
        url: 'https://gitlab.example.com/藍隊/工具箱/-/merge_requests/1387',
        review_state: 'CHANGES_REQUESTED',
      },
      rate_limits: {
        // T4.5：five_hour resets_at＝now+2h（絕對值 1783501200 不變）；
        // seven_day 維持「視窗在、resets_at null」的後綴剔除情境。
        five_hour: { used_percentage: 12.07, resets_at: WIN_NOW + 2 * 3600 },
        seven_day: { used_percentage: 88.8, resets_at: null },
      },
      worktree: { name: 'hotfix-字型', branch: '分支-字型修正' },
    },
    shell: {
      'git-branch': 'feature/字型-subset',
      'git-dirty': true,
      clock: { hours: 14, minutes: 30 },
    },
    env: { home: 'C:\\Users\\user' },
  },
]

/** canonical 情境集（凍結；SP-0 對帳後由真檔聯集重建）。 */
export const MOCK_SCENARIOS: readonly MockScenario[] = deepFreeze(MOCK_SCENARIO_LIST)

export const MOCK_SCENARIOS_BY_ID: Readonly<Record<MockScenarioId, MockScenario>> = Object.freeze(
  Object.fromEntries(MOCK_SCENARIOS.map((scenario) => [scenario.id, scenario])) as Record<
    MockScenarioId,
    MockScenario
  >,
)

/** 情境 → 腳本 stdin 餵入形（1:1 mirror——契約由 mock-data.test.ts 釘住）。 */
export function scenarioStdinJson(scenario: MockScenario): string {
  return JSON.stringify(scenario.data)
}
