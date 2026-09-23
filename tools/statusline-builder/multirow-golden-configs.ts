/**
 * T3.3 補件（MAGI code review 2026-07-11 Important #2／Fix 2 採納）：
 * multirow golden config 的**單一事實來源**——同時供：
 *   - `scripts/golden-statusline.mjs`（MULTIROW_CASES → emitBash → 簽入
 *     `__golden__/multirow-{plain,powerline}.sh`）
 *   - `scripts/golden-statusline-ps1.mjs`（CANONICAL_CONFIGS 內 multirow
 *     兩案 → emitPs1 → 簽入 `__golden__/multirow-{plain,powerline}.ps1`）
 *   - `emit-bash.test.ts`／`emit-ps1.test.ts` 的黃金比對常駐迴圈（本次
 *     新增；先前僅由 T3.3 人審產出，未被 `npm test` 覆蓋——見 PLAN
 *     §Verification 1／MAGI review Important #2）
 *
 * 收攏原因：先前 bash／ps1 兩個 .mjs harness 各自 inline 定義同名
 * multirow config（欄位逐字相同，僅 icon 預設值寫法不同——bash helper
 * 預設 `icon:false`、ps1 helper 逐段顯式覆寫 `icon:false`，效果等價），
 * 屬字面重複、有漂移風險。改由本檔案輸出純資料（`BuilderConfig`，
 * `icon:false` 為顯式欄位，兩後端消費同一物件），emit-bash／emit-ps1 兩
 * 產生器各自依 mode／backend 特性序列化，config 本身不含後端特定資訊。
 *
 * **與 `scripts/statusline-golden-configs.ts`（單列 GOLDEN_CASES 單一
 * 事實來源）刻意分離、零耦合**——後者為 emit-bash.test.ts 既有黃金比對
 * ＋端到端 byte-exact 測試的事實來源，非本次任務範圍（PLAN 註記「本兩案
 * 為本任務新增，非本任務範圍禁改該檔」）；`emit-ps1.test.ts` 的
 * `GOLDENS`（PLAIN_FULL／POWERLINE_THRESHOLD／POWERLINE_NOARROW）亦不受
 * 本檔影響，維持原「與 golden-statusline-ps1.mjs 逐字同步」慣例。
 *
 * **golden 檔本身為禁區**（不得重生／手改）：本檔僅重整 config 來源，
 * 兩個 __golden__/multirow-*.{sh,ps1} 之 bytes 不變——sha1sum 前後一致
 * 已於本次修復驗證（見 code review 回報）。
 */
import type { BuilderConfig, SegmentConfig } from './config.js'
import type { ColorSpec } from './color.js'
import { THRESHOLD_TEMPLATES } from './threshold.js'

const A = (index: number): ColorSpec => ({ kind: 'ansi256', index })
const TRAFFIC = THRESHOLD_TEMPLATES.traffic

const seg = (id: string, over: Partial<SegmentConfig> = {}): SegmentConfig => ({
  id,
  enabled: true,
  icon: false,
  color: { kind: 'default' },
  ...over,
})

const cfg = (mode: BuilderConfig['mode'], over: Partial<Omit<BuilderConfig, 'mode'>> = {}): BuilderConfig => ({
  version: 2,
  mode,
  separator: { kind: 'preset', value: '|' },
  lastArrowCap: true,
  powerlineArrow: mode === 'powerline',
  segments: [],
  ...over,
})

export interface MultirowGoldenCase {
  /** 黃金檔名 stem（`.sh`／`.ps1` 兩後端共用同一 name）。 */
  name: string
  config: BuilderConfig
}

/**
 * 三列（row 0/1/2）、列內兩段（驗分隔符／箭頭不跨列）：plain 與
 * powerline（含 arrow gating true）各一——與原 `MULTIROW_CASES`（bash）
 * ／`CANONICAL_CONFIGS` multirow 兩案（ps1）逐欄比對後確認等價，逐字
 * 移植於此。
 *
 * 第三案 `multirow-powerline-noarrow`（(internal design doc)
 * T1.3；PLAN §前置加固補位）：多列 × powerline mode × `powerlineArrow:
 * false`（v2 預設）組合——先前僅單列（powerline-noarrow，
 * scripts/statusline-golden-configs.ts）有此 gating 真執行覆蓋，多列版本
 * 缺席，見該案自身註解之驗證重點列舉。
 */
export const MULTIROW_GOLDEN_CASES: readonly MultirowGoldenCase[] = [
  {
    name: 'multirow-plain',
    // plain 三列：row 0＝model+cwd（tilde）、row 1＝cost+duration、row 2＝
    // context-used（threshold 桶色）+rate-5h（無 threshold，dash 政策）。
    // 列內以 SEP='|' 相接、列間單一換行（bash：LF；ps1：`` `n ``）；驗
    // 分隔符不跨列（row 0 末段與 row 1 首段之間無 '|'，各列各自的 SEP
    // 迴圈獨立求值）。
    config: cfg('plain', {
      segments: [
        seg('model', { color: A(75), row: 0 }),
        seg('cwd', { variant: 'tilde', prefix: '@', color: A(45), row: 0 }),
        seg('cost', { color: A(220), row: 1 }),
        seg('duration', { color: A(118), row: 1 }),
        seg('context-used', { threshold: TRAFFIC, color: A(240), row: 2 }),
        seg('rate-5h', { color: A(99), row: 2 }),
      ],
    }),
  },
  {
    name: 'multirow-powerline',
    // powerline 三列、arrow gating true（powerlineArrow:true）：驗段間箭頭
    // 交接與 lastArrowCap 收尾皆列內獨立（row 0/1/2 各自收尾箭頭，不跨列
    // 串接、不與下一列首段交接）。
    config: cfg('powerline', {
      powerlineArrow: true,
      lastArrowCap: true,
      segments: [
        seg('model', { color: A(226), row: 0 }),
        seg('cwd', { variant: 'basename', color: A(24), row: 0 }),
        seg('cost', { color: A(16), row: 1 }),
        seg('duration', { color: A(46), row: 1 }),
        seg('context-used', { threshold: TRAFFIC, color: A(240), row: 2 }),
        seg('rate-5h', { color: A(99), row: 2 }),
      ],
    }),
  },
  {
    name: 'multirow-powerline-noarrow',
    // 多列 × powerline mode × powerlineArrow:false（v2 預設模式；(internal design doc)
    // PLAN §前置加固；契約出處同 06 傘狀 PLAN §D1 gating 條件表——本案為
    // 該表「多列」列的補位，先前僅單列有 powerline-noarrow 真執行覆蓋，見
    // scripts/statusline-golden-configs.ts 與 pipeline.integration.test.ts
    // 既有「D1 gating 真執行覆蓋」單列案）。cfg('powerline') helper 預設
    // `powerlineArrow: mode==='powerline'`＝true，此處**顯式 override 為
    // false**（不可省略，否則退化為與 multirow-powerline 案同義）。驗證
    // 重點（四項，皆列內獨立，row 0/1/2 各自成立）：
    //   1. 無箭頭——powerlineArrow:false 時段間交接不 emit ARROW（bash 側
    //      甚至不宣告 ARROW 變數；ps1 側恆不寫箭頭字面），對照
    //      multirow-powerline 案逐段皆有交接箭頭。
    //   2. lastArrowCap 無效——lastArrowCap:true 顯式設但 powerlineArrow:
    //      false 時收尾箭頭區塊恆不 emit（cap 值本身不影響輸出，證兩欄
    //      正交、cap 非獨立生效條件）。
    //   3. 右 padding——每段 value 後補一空格（`head + value + ' '`），非
    //      交接箭頭產生的視覺留白；bash/ps1 兩後端 texts 陣列元素皆帶尾隨
    //      空格。
    //   4. 跨列獨立——row 0/1/2 各自套用上述語意，互不影響（分隔符與
    //      padding 不跨列）。
    // 段選擇比照 multirow-powerline 案（model/cwd/cost/duration/
    // context-used(threshold)/rate-5h），配色微調以資區辨（非既有案的複製
    // 貼上巧合）。
    config: cfg('powerline', {
      powerlineArrow: false,
      lastArrowCap: true,
      segments: [
        seg('model', { color: A(93), row: 0 }),
        seg('cwd', { variant: 'basename', color: A(20), row: 0 }),
        seg('cost', { color: A(202), row: 1 }),
        seg('duration', { color: A(82), row: 1 }),
        seg('context-used', { threshold: TRAFFIC, color: A(240), row: 2 }),
        seg('rate-5h', { color: A(129), row: 2 }),
      ],
    }),
  },
  {
    name: 'multirow-plain-rowseps',
    // T1.6（(internal design doc) §D1 golden 策略）：「某
    // 列覆寫＋某列 null 顯式繼承」多列 golden 契約——段組合／row 分佈逐欄
    // 沿用 `multirow-plain` 案（僅新增 rowSeparators，兩案對照即最小 diff）。
    // 三列：row 0（啟用位 0）`rowSeparators[0]=null`→全域 '|'；row 1（啟用
    // 位 1）覆寫 preset '·'；row 2（啟用位 2，亦陣列末位）
    // `rowSeparators[2]=null`→全域 '|'——**顯式尾端 null**（非陣列過短之
    // 越界 undefined；本檔為 raw BuilderConfig 直餵 emitBash／emitPs1，不
    // 經 sanitizeConfig 修剪尾端 null），機械覆蓋 rowSeparatorValue 對「顯式
    // null」與「缺項」同歸全域值的兩種來源路徑。
    config: cfg('plain', {
      rowSeparators: [null, { kind: 'preset', value: '·' }, null],
      segments: [
        seg('model', { color: A(75), row: 0 }),
        seg('cwd', { variant: 'tilde', prefix: '@', color: A(45), row: 0 }),
        seg('cost', { color: A(220), row: 1 }),
        seg('duration', { color: A(118), row: 1 }),
        seg('context-used', { threshold: TRAFFIC, color: A(240), row: 2 }),
        seg('rate-5h', { color: A(99), row: 2 }),
      ],
    }),
  },
]
