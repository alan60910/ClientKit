/**
 * S5-T2.2（(internal design doc) §D1 一致性斷言鏈／
 * §Verification 3）：StyledRun[][] → ANSI 字串 oracle（item-3 比對基準）。
 * T2.3（SP-5）與 T2.7 以兩 shell 真執行 stdout 對本函式輸出做 byte
 * 比對。**獨立於 emitter 的碼產生**——不 import emit-bash/emit-ps1，
 * 只共用 color.ts 的 SGR 建構規則（sgrSequence 家族＝byte-exact 的
 * 共同地基）＋真 ESC。
 *
 * ── SGR emission 規則（SP-5 鎖死面；T2.3/T2.4/T2.5 依此實作）──
 * 1. **逐 run 無條件 reset 前綴（stateless）**：每 run 輸出
 *    `ESC[0m`＋fg 序列＋bg 序列＋text。捨「色變化才 emit」的 stateful
 *    形——兩 shell 的 join 累加器無須追蹤跨 run 色狀態，逐元素固定
 *    輸出 `reset+fg+bg+text` 即 byte-exact（最利 bash/ps1 重現）；每
 *    run 色彩自足（powerline 箭頭 fg/bg 皆顯式），前置 reset 不影響
 *    視覺，且保證無色 run（plain 分隔符、default 色段）不繼承前段色。
 * 2. **fg 先於 bg**（順序鎖死）。
 * 3. **行尾無條件 reset**：含空 runs——`toAnsi([[]]) === '\x1b[0m'`
 *    （全段隱藏時腳本輸出恆為單一 reset，非空字串；resolve 全隱藏回傳
 *    `[[]]`——單列、列內容為空陣列）。
 * 4. **default／缺席色不 emit**（colorSequence 對 default 回 ''；
 *    resolve 正規形本就不落 default 於 run 屬性）。
 *
 * ── T2.2 原子翻轉（簽章升維，join 語意暫不變）──
 * `rows: StyledRun[][]` → `rows.map(joinRow).join('\n')`：每列各自跑上述
 * emission 規則（含列尾 reset）、列間以 `\n` 相接、整體無尾隨換行。本任務
 * 呼叫端恆傳單列（`resolve()` 尾端 `[runs]` 包裹），故 `join('\n')` 對單
 * 元素陣列不產生分隔符、bytes 與翻轉前逐字相同；多列的行尾 SGR reset 在
 * LF 之前語意屬未來列渲染任務，本任務不新增可觀察行為。
 *
 * 純函式、零 DOM import，node 可測。
 */
import { colorSequence, resetSequence } from './color.js'
import type { StyledRun } from './resolve.js'

/** 單列 StyledRun[] → 帶真 ESC 的 ANSI 字串（emission 規則見檔頭，SP-5 鎖死）。 */
function joinRow(runs: readonly StyledRun[]): string {
  let out = ''
  for (const run of runs) {
    out += resetSequence()
    if (run.fg !== undefined) out += colorSequence(run.fg, 'fg')
    if (run.bg !== undefined) out += colorSequence(run.bg, 'bg')
    out += run.text
  }
  return out + resetSequence()
}

/** StyledRun[][] → 帶真 ESC 的 ANSI 字串：逐列 joinRow，列間以 LF 相接、無尾隨換行。 */
export function toAnsi(rows: readonly (readonly StyledRun[])[]): string {
  return rows.map(joinRow).join('\n')
}
