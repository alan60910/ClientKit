/**
 * sRGB 相對亮度／WCAG 對比率／auto-fg 黑白判定（純函式、零 DOM、零
 * import）。
 *
 * 自 `tools/statusline-builder/color.ts` 抽出（(internal design doc)
 * PLAN.md §Recommended approach「`src/lib/color.ts`」、§Milestone「M1 純
 * 邏輯核心」），讓 room-layout-planner 的近似色前景判定（名稱前景色自動
 * 取黑／白）可共用 WCAG 數學，而不需 import statusline 的模組。
 * statusline 端改為對本檔案的薄 wrapper（見 `tools/statusline-builder/
 * color.ts`）。
 *
 * 與 statusline 原實作的行為差異：原 `relativeLuminance` 對不合法 hex
 * 經 `hexToRgb` 丟 `TypeError`；本檔案的版本**不丟例外**，非法 hex 一律
 * 回安全值 `0`（上游呼叫端——例如 room-layout-planner 的 parsePlan——已
 * 先清洗過顏色值，這裡的非拋出契約只是防禦性下限）。
 */

/** 合法 `#rrggbb` 形式（大小寫不拘）。 */
export const HEX6_RE = /^#[0-9a-fA-F]{6}$/

/** `#rrggbb` → RGB 分量（0–255）。不合法回 null（不丟例外）。 */
function hexToRgbSafe(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX6_RE.test(hex)) return null
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

/**
 * sRGB 通道線性化（WCAG 2.x 公式）。門檻採 WCAG 明文的 0.03928（sRGB
 * 標準為 0.04045——8-bit 值域下兩者無任何整數通道值落於其間，結果相同）。
 */
function linearize(channel8: number): number {
  const s = channel8 / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/**
 * `#rrggbb` → WCAG 相對亮度 L ∈ [0,1]。非法 hex 回 0，不 throw；上游
 * parsePlan 已先清洗。
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgbSafe(hex)
  if (!rgb) return 0
  const { r, g, b } = rgb
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** WCAG 對比率 (L較亮+0.05)/(L較暗+0.05) ∈ [1,21]；引數順序無關。 */
export function contrastRatio(lumA: number, lumB: number): number {
  const [lo, hi] = lumA < lumB ? [lumA, lumB] : [lumB, lumA]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * auto-fg 黑/白判定：對 bg 分別算黑、白前景的對比率取高者，平手取黑。
 * 分界落在 L≈0.1791（#757575 → 白、#767676 → 黑）。非法 hex 視同
 * `relativeLuminance` 的安全值 0（近黑），不丟例外。
 */
export function autoFgIsBlack(bgHex: string): boolean {
  const l = relativeLuminance(bgHex)
  return contrastRatio(l, 0) >= contrastRatio(l, 1)
}
