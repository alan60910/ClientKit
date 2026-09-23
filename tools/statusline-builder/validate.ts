/**
 * S5-T1.4（(internal design doc) §產生器契約 6「escaping／
 * 輸入驗證職責表」、Q2 拍板 ≤8）：自訂分隔符與每-segment 前綴共用的
 * 輸入驗證。
 *
 * 白名單哲學＝正面表列「可列印」：僅拒收集 R、其餘一律放行——emitter
 * 對抗字元（`'`、`"`、`$`、backtick、`\`、`!`、`%`、CJK、emoji 含 ZWJ
 * 序列與膚色修飾、空格）屬 escaping 層職責（emit-bash／emit-ps1 的
 * 單引號 context），不得在本層被擋。拒收理由（契約 6）：`\n` 在單引號
 * context 是合法字面、escape 擋不住，而 F3 只取 stdout 第一行＝靜默
 * 截斷；控制／bidi 字元同屬「不可列印或視覺欺騙」類。
 *
 * 純函式、零 DOM import，node 可測。
 */

/** Q2 拍板：自訂分隔符／前綴長度上限，以 Unicode code point 計。 */
export const MAX_CUSTOM_TEXT_CODE_POINTS = 8

/**
 * 機器可判拒收原因（UI 層據此映射 role=alert 文案）：
 * - `newline`：LF／CR＋Unicode 行終結符 U+2028/U+2029（「換行」的
 *   完整語意——F3 靜默截斷風險）。
 * - `control`：其餘 Unicode Cc 全集＝C0（含 NUL、tab）＋DEL＋C1。
 * - `bidi-format`：Unicode Bidi_Control 全集（12 個 code point；涵蓋
 *   契約「至少」集 U+202A–202E／U+2066–2069／U+200E/200F，另含
 *   U+061C ALM）——防產出腳本與預覽被視覺重排欺騙。
 * - `lone-surrogate`：不成對代理項——非合法 Unicode 純量值，無法走
 *   escaping 層「UTF-8 字面嵌入」忠實編碼。
 * - `pua`：Unicode 私用區（BMP U+E000–U+F8FF＋補充私用區 Plane 15／16）。
 *   Nerd Font glyph／powerline 箭頭皆落此區——使用者前綴／分隔符夾帶 PUA
 *   會污染預覽 aria-label enforcement（resolve.toAriaLabel 對 PUA run 拋
 *   TypeError）並在持久化路徑觸發 init 崩潰，故併入拒收集 R 的單一咽喉
 *   （config 清洗／UI 驗證自動同時受惠；resolve.containsPua 退為第二道）。
 * - `too-long`：code point 數 > MAX_CUSTOM_TEXT_CODE_POINTS。
 */
export type CustomTextRejectReason =
  | 'newline'
  | 'control'
  | 'bidi-format'
  | 'lone-surrogate'
  | 'pua'
  | 'too-long'

export type CustomTextValidation =
  | { ok: true }
  | { ok: false; reason: CustomTextRejectReason }

/**
 * Unicode Bidi_Control 全集。ZWJ（U+200D）／變體選擇器（U+FE0F）／
 * 膚色修飾雖同為格式類字元，但為 emoji 序列必需、明確不在 R 內。
 */
const BIDI_FORMAT_CONTROL_CODE_POINTS: ReadonlySet<number> = new Set([
  0x061c, // ALM
  0x200e, // LRM
  0x200f, // RLM
  0x202a, // LRE
  0x202b, // RLE
  0x202c, // PDF
  0x202d, // LRO
  0x202e, // RLO
  0x2066, // LRI
  0x2067, // RLI
  0x2068, // FSI
  0x2069, // PDI
])

/**
 * Unicode 私用區（PUA）：BMP U+E000–U+F8FF＋補充私用區 Plane 15
 * （U+F0000–U+FFFFD）／Plane 16（U+100000–U+10FFFD）。以顯式 `\u{...}`
 * 轉義寫出、不嵌字面不可見字元——T1.4 裁定：raw 不可見字元易被編輯器誤刪
 * ／正規化致 enforcement 靜默失效（與 resolve.ts PUA_RE 同一定義同一慣例）。
 */
const PUA_RE = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u

/** 單一 code point 是否屬拒收集 R（長度除外）；非 R → null＝放行。 */
function rejectReasonFor(cp: number): Exclude<CustomTextRejectReason, 'too-long'> | null {
  if (cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029) return 'newline'
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return 'control'
  if (BIDI_FORMAT_CONTROL_CODE_POINTS.has(cp)) return 'bidi-format'
  if (cp >= 0xd800 && cp <= 0xdfff) return 'lone-surrogate'
  if (PUA_RE.test(String.fromCodePoint(cp))) return 'pua'
  return null
}

/**
 * 驗證自訂分隔符／每-segment 前綴（兩者共用同一規則）。
 *
 * 計數口徑＝code point（`for...of` 迭代單位）：UTF-16 unit 會不公平
 * 懲罰 astral emoji（8 個 emoji＝16 unit）、grapheme cluster 隨
 * Unicode 版本與實作浮動；code point 是三後端（TS／jq／PowerShell）
 * 皆可穩定重現的單位。ZWJ 家族序列按組成計：👨‍👩‍👧‍👦＝7 code point
 * （1 個 grapheme），恰可放行；口徑由測試釘死。
 *
 * 掃描語意：單趟依序檢查每個 code point，第一個 R 成員決定 reason；
 * 全部合法才檢查長度（字元類違規優先於 `too-long`）。空字串放行
 * （無 R 成員、0 ≤ 8；前綴為選填、空分隔符＝直接串接，無危害）。
 */
export function validateCustomText(s: string): CustomTextValidation {
  let codePoints = 0
  for (const ch of s) {
    codePoints += 1
    const reason = rejectReasonFor(ch.codePointAt(0)!)
    if (reason !== null) return { ok: false, reason }
  }
  if (codePoints > MAX_CUSTOM_TEXT_CODE_POINTS) return { ok: false, reason: 'too-long' }
  return { ok: true }
}
