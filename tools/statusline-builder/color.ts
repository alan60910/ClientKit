/**
 * S5-T1.2（(internal design doc) §D2/§D6/型別契約/§產生器
 * 契約 7）：ColorSpec 三態、ANSI256↔hex 對照表（SP-4，公式生成）、swatch
 * 命名、sRGB 相對亮度＋auto-fg 黑/白判定（WCAG）、ANSI SGR 組碼（兩層
 * API：不含 ESC 的碼段／完整序列）、hex 驗證正規化。
 *
 * 純函式、零 DOM import，node 可測。本檔為全 sprint 的 ColorSpec 型別
 * 源頭（threshold/config/resolve 皆自此 import）。
 */

import {
  autoFgIsBlack as libAutoFgIsBlack,
  contrastRatio,
  relativeLuminance as libRelativeLuminance,
} from '../../src/lib/color.js'

// ── ColorSpec 三態（PLAN 型別契約） ──

/**
 * 顏色三態：終端預設（不著色、不 emit）／ANSI 256 索引（0–255，越界
 * clamp）／truecolor hex（小寫 `#rrggbb`，經 normalizeHex 驗證）。
 * plain 模式作 fg、powerline 模式作 bg（D3：mode 切換保值不重映射）。
 */
export type ColorSpec =
  | { kind: 'default' }
  | { kind: 'ansi256'; index: number }
  | { kind: 'truecolor'; hex: string }

// ── hex 驗證／正規化（truecolor 軌） ──

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/** 是否為合法 `#rrggbb`（大小寫不拘）。不收 3 位縮寫、無 `#` 形、不 trim。 */
export function isValidHex(input: string): boolean {
  return HEX_RE.test(input)
}

/**
 * 正規化為小寫 `#rrggbb`；不合法回 null。嚴格限 6 位形（native
 * `<input type="color">` 的產出形即此），縮寫／裸 hex 一律拒收。
 */
export function normalizeHex(input: string): string | null {
  return HEX_RE.test(input) ? input.toLowerCase() : null
}

/** `#rrggbb` → RGB 分量（0–255）。不合法丟 TypeError（上游先過 normalizeHex）。 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (!HEX_RE.test(hex)) throw new TypeError(`非法 hex：${hex}`)
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

/** RGB 分量（0–255 整數）→ 小寫 `#rrggbb`。 */
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => n.toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

// ── ANSI256↔hex 對照表（SP-4：公式生成，勿手打 256 筆） ──

/**
 * 0–15 基本色採 xterm 256 色盤預設值。實際終端主題可覆寫 0–15 的呈現，
 * 預覽與 swatch 命名（D6）以此預設為準。
 */
const BASIC_16 = [
  '#000000', '#800000', '#008000', '#808000',
  '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00',
  '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
] as const

/** 6×6×6 色立方各軸階值（index = 16 + 36r + 6g + b）。 */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const

function buildAnsi256Table(): readonly string[] {
  const table: string[] = [...BASIC_16]
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        table[16 + 36 * r + 6 * g + b] = rgbToHex(
          CUBE_LEVELS[r],
          CUBE_LEVELS[g],
          CUBE_LEVELS[b],
        )
      }
    }
  }
  for (let n = 0; n < 24; n++) {
    const v = 8 + 10 * n
    table[232 + n] = rgbToHex(v, v, v)
  }
  return Object.freeze(table)
}

/** ANSI 256 索引 → 小寫 hex 對照表（長度 256，凍結）。 */
export const ANSI256_HEX: readonly string[] = buildAnsi256Table()

/** 索引收斂至 0–255 整數：trunc 後 clamp；NaN → 0（config 越界清洗同源）。 */
export function clampAnsi256Index(index: number): number {
  if (Number.isNaN(index)) return 0
  return Math.min(255, Math.max(0, Math.trunc(index)))
}

/** ANSI 256 索引 → 小寫 hex。越界先 clamp，不丟例外。 */
export function ansi256ToHex(index: number): string {
  return ANSI256_HEX[clampAnsi256Index(index)]
}

/**
 * swatch 可及名稱（D6：「ANSI 索引＋hex」，不強造中文色名），如
 * `ANSI 196 #ff0000`。索引先 clamp，名稱反映 clamp 後的實際 swatch。
 */
export function ansi256SwatchName(index: number): string {
  const i = clampAnsi256Index(index)
  return `ANSI ${i} ${ANSI256_HEX[i]}`
}

/** ColorSpec → 預覽用 hex；default → null（沿用終端底色/字色，不著色）。 */
export function colorSpecToHex(spec: ColorSpec): string | null {
  switch (spec.kind) {
    case 'default':
      return null
    case 'ansi256':
      return ansi256ToHex(spec.index)
    case 'truecolor':
      return spec.hex
  }
}

// ── sRGB 相對亮度＋auto-fg 黑/白判定（WCAG；D2：亮度數學只存在於此） ──
//
// S16-T1.1（(internal design doc) §Recommended approach）：
// 亮度／對比數學已搬至 `src/lib/color.ts`（唯一實作、room-layout-planner
// 共用），本檔只保留驗證＋委派——維持呼叫端既有「不合法 hex 丟
// TypeError」契約（src/lib 版本改為非拋出、回安全值 0，供不先驗證的
// 呼叫端使用）。`contrastRatio` 無 hex 入參可驗，直接 re-export。

export { contrastRatio }

/** `#rrggbb` → WCAG 相對亮度 L ∈ [0,1]。不合法丟 TypeError（同 hexToRgb）。 */
export function relativeLuminance(hex: string): number {
  if (!HEX_RE.test(hex)) throw new TypeError(`非法 hex：${hex}`)
  return libRelativeLuminance(hex)
}

/**
 * powerline auto-fg 黑/白判定：對 bg 分別算黑、白前景的對比率取高者，
 * 平手取黑。分界落在 L≈0.1791（#757575 → 白、#767676 → 黑）。不合法
 * hex 丟 TypeError（同 relativeLuminance）。
 */
export function autoFgIsBlack(bgHex: string): boolean {
  if (!HEX_RE.test(bgHex)) throw new TypeError(`非法 hex：${bgHex}`)
  return libAutoFgIsBlack(bgHex)
}

/**
 * bg ColorSpec → auto-fg ColorSpec（D2：emit 期預算用，執行期零亮度數學）。
 * 色彩軌保持一致：ansi256 bg 給 ansi256 fg——黑/白取色立方端點
 * 16=#000000／231=#ffffff（0/15 可被終端主題覆寫，不採）；truecolor bg
 * 給 truecolor 黑/白。default bg 無已知色可對比 → 回 default（不著色）。
 * fgOverride 存在時呼叫端不經此函式。
 */
export function autoFg(bg: ColorSpec): ColorSpec {
  switch (bg.kind) {
    case 'default':
      return { kind: 'default' }
    case 'ansi256':
      return autoFgIsBlack(ansi256ToHex(bg.index))
        ? { kind: 'ansi256', index: 16 }
        : { kind: 'ansi256', index: 231 }
    case 'truecolor':
      return autoFgIsBlack(bg.hex)
        ? { kind: 'truecolor', hex: '#000000' }
        : { kind: 'truecolor', hex: '#ffffff' }
  }
}

// ── ANSI SGR 組碼（§產生器契約 7；SP-5 byte-exact 前提） ──
//
// 兩層 API，三處（emit-ansi oracle／emit-bash／emit-ps1）共用同一建構
// 規則：
//   colorSgrParams／RESET_PARAMS → 參數段（`38;5;196`、`0`）
//   sgrBody(params)              → 不含 ESC 字元本體的碼段 `[38;5;196m`
//                                  （bash 接在 `${ESC}` 後、ps1 接在 `$e` 後）
//   sgrSequence(params, esc)     → esc + sgrBody(params) 完整序列
//                                  （oracle 用真 ESC；emitter 注入字面形）

/** 真 ESC 字元（U+001B）。emit-ansi oracle 與預覽解析用。 */
export const ESC = '\x1b'

/** SGR reset 參數段（行尾必 reset：`[0m`）。 */
export const RESET_PARAMS = '0'

/**
 * ColorSpec → SGR 參數段：truecolor `38;2;r;g;b`／`48;2;…`、ansi256
 * `38;5;n`／`48;5;n`（越界 clamp）；default → null（不 emit，呼叫端跳過）。
 */
export function colorSgrParams(spec: ColorSpec, layer: 'fg' | 'bg'): string | null {
  const lead = layer === 'fg' ? '38' : '48'
  switch (spec.kind) {
    case 'default':
      return null
    case 'ansi256':
      return `${lead};5;${clampAnsi256Index(spec.index)}`
    case 'truecolor': {
      const { r, g, b } = hexToRgb(spec.hex)
      return `${lead};2;${r};${g};${b}`
    }
  }
}

/** 參數段 → 不含 ESC 本體的碼段，如 `[38;5;196m`。 */
export function sgrBody(params: string): string {
  return `[${params}m`
}

/** 參數段 → 完整 SGR 序列 esc + sgrBody(params)；esc 可注入（預設真 ESC）。 */
export function sgrSequence(params: string, esc: string = ESC): string {
  return esc + sgrBody(params)
}

/** ColorSpec → 完整著色序列；default → 空字串（不 emit）。 */
export function colorSequence(spec: ColorSpec, layer: 'fg' | 'bg', esc: string = ESC): string {
  const params = colorSgrParams(spec, layer)
  return params === null ? '' : sgrSequence(params, esc)
}

/** 完整 reset 序列 `ESC[0m`；esc 可注入。 */
export function resetSequence(esc: string = ESC): string {
  return sgrSequence(RESET_PARAMS, esc)
}
