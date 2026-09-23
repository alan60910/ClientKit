/**
 * S5-T2.5（(internal design doc) §產生器契約 1–12＋§格式化
 * 對等規則 ps1 面；join 虛擬碼＋ps1 實測要點定案經過見 (internal design doc)-
 * statusline-builder/WORKS.md「T2.3 DONE」節＋sp5/join.ps1 藍本）：
 * emitPs1——BuilderConfig → 自足 `.ps1` 腳本文字。
 *
 * 產生器分工（emit 期 vs 執行期）：色值／autoFg／閾值桶陣列／glyph 碼位／
 * 前綴 escaping 全在 **emit 期以 TS 單源預算**（與 resolve.ts／emit-ansi
 * oracle 同一 color.ts 建構規則）；產出腳本執行期只做——取值、null 政策
 * 分流、數值格式化（帶 `[double]` 轉型）、閾值桶索引查表、二趟 join。
 * 目標：`emitPs1(config)` 產出的 `.ps1` 之 stdout 與
 * `emit-ansi.toAnsi(resolve(config, data))` **byte-exact**（SP-5 已證兩
 * shell 同構可實作；本檔為其產生器化）。
 *
 * ── PS 5.1 底線（契約 7／8／9；.t15＋.t23 §7 實證）──
 * - 檔頭三行：`[Console]::InputEncoding`／`OutputEncoding` 皆
 *   `UTF8Encoding($false)`（無 BOM 輸出＋stdin CJK 無損）＋`$e=[char]27`。
 * - 讀入：`[Console]::In.ReadToEnd() | ConvertFrom-Json`（契約 1）。
 * - 禁 `?:`／`??`／`?.`；**不得 Set-StrictMode**（缺席屬性鏈須靜默 $null）；
 *   null 判定一律顯式 `$null -eq/-ne`（0% 不可被 truthiness 誤殺）。
 * - 數值取值 `[double]` 轉型**於 `$null` 判定之後**（PS 5.1
 *   ConvertFrom-Json 小數回 Decimal，`0.0029×10⁴` Decimal floor=29≠
 *   double=28；`[double]$null=0` 會誤殺 null——.t23 §7）。
 * - 結尾顯式 `exit 0`（覆蓋 git 原生 `$LASTEXITCODE` 洩漏；try/catch 僅
 *   管 cmdlet／解析例外面）。
 * - 輸出 `[Console]::Out.Write($out)`（無換行、無 BOM）。
 *
 * ── escaping（契約 6）──
 * 使用者文字（前綴、分隔符）走**單引號 context**：`'`→`''`；`$()`／
 * backtick 於單引號內不插值（emit-ps1.test.ts 以 `$(...)` 對抗案實證
 * 走單引號非雙引號）。前綴以 UTF-8 字面嵌入（檔案 BOM 保 parser 正確
 * 解讀——契約 8；CJK／非 ASCII 前綴走此路徑，未跳脫）。**分隔符例外**
 * （MAGI code review Important #7 修復）：`separatorExpr` 逐字元判
 * ASCII——連續 ASCII 段落仍走 `psSingleQuote`（同上單引號 escaping、
 * 產出與修復前逐位元組相同）、非 ASCII 字元逐 codepoint 跳脫（下節
 * `iconGlyphExpr` 同機制）。preset 分隔符 '›'（U+203A）／'·'（U+00B7）
 * 藉此變純 ASCII、不再依賴 BOM 供 parser 正確解讀無 BOM `.ps1`；
 * `separatorExpr` 泛用（對任何非 ASCII 字元一視同仁），故使用者自訂
 * 分隔符同步免費獲益——惟前綴（`headExpr`）刻意不動、續留契約 8 現狀
 * （該通道為 DRIFT backlog）。逐 codepoint escape 只改「原始碼」bytes，
 * 執行期字串值不變（`[char]0xHEX`／`ConvertFromUtf32` 解出之 runtime
 * 字元與原始字面等價）→ 與既有黃金／oracle runtime 輸出保持
 * byte-exact（emit-ps1.test.ts「分隔符跳脫」群組之真執行驗證）。
 *
 * ── icon glyph 編碼策略（S1 spike／T1.2 裁決；sp1/REPORT.md）──
 * segment icon（`descriptor.icon.glyph`，06a 起皆 emoji）**不**以 UTF-8
 * 字面嵌入產出腳本——PS 5.1 對無 BOM `.ps1` 讀取走系統 ANSI code page，
 * 複製貼上流程 BOM 亦不可控（S1 實測坐實）。改為逐 codepoint
 * `[char]::ConvertFromUtf32(0x1F4C1)`（astral，＞U+FFFF）／`[char]0x2328`
 * （BMP，跟隨既有 `$ARROW = [string][char]0xE0B0` idiom）碼位跳脫，原始碼
 * 純 ASCII、不依賴 BOM／系統 codepage／PS 版本。多 codepoint glyph
 * （⌨️＝U+2328+U+FE0F）逐一跳脫後以 `+` 相接。見 `iconGlyphExpr`。head
 * 運算式＝prefix 單引號字面 + icon escape 運算式（`concatExpr` 相接），
 * 兩者責任分離：prefix 走使用者文字 escaping（上段）、icon 走碼位跳脫。
 *
 * ── D1 gating（S6-T2.3：`config.powerlineArrow`，僅 powerline 模式）──
 * `powerlineArrow=false`（v2 預設）：不 emit `$ARROW`、join 迴圈不插段間
 * 箭頭、`lastArrowCap` 全面無效（收尾箭頭區塊恆不 emit）；改為每段 value
 * 顯示運算式尾綴一個空白字面 `' '`（`concatExpr` 併入，與 resolve.ts
 * `head + value + suffix + ' '` 同一 composition）。`powerlineArrow=true`
 * （v1 遷移沿襲）：語意不變（箭頭＋`lastArrowCap` 依其值＋無 padding）。
 * plain 模式完全不受本欄影響。
 *
 * 純函式、零 DOM import，node 可測。
 */
import { autoFg, colorSgrParams, type ColorSpec } from './color.js'
import { segmentColorPlaceholder, type BuilderConfig, type SegmentConfig } from './config.js'
// M6 C1（2026-07-14 拍板；(internal design doc)
// T6.3）：NA_TEXT 單一事實來源沿 emit-bash.ts 既有「自 resolve.ts 匯入
// oracle 常數」先例（該檔已匯入 BAR_CELL_COUNT／BAR_EMPTY_CHAR／
// BAR_FILLED_CHAR／POWERLINE_ARROW），避免 emitter 端另掛一份 '(n/a)' 字面。
import { NA_TEXT } from './resolve.js'
import type { FormatKind, SegmentDescriptor } from './segments.js'
import { autoFgBuckets, type ThresholdRule } from './threshold.js'

/** emitPs1 的目錄注入面＝descriptor by id（resolve 用的 DESCRIPTORS_BY_ID 直接可餵）。 */
export type SegmentDescriptorCatalog = Readonly<Record<string, SegmentDescriptor>>

// ── ps1 片段小工具（emit 期字串建構） ──

/** 使用者文字 → ps1 單引號字面（契約 6：`'`→`''`；`$()`／backtick 不插值）。 */
function psSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * ColorSpec → SGR「尾」（`5;226`／`2;r;g;b`；default→''）——箭頭交接以
 * `38;<尾>`／`48;<尾>` 派生（.t23 §5 儲存形約定）。
 */
function bgTail(spec: ColorSpec): string {
  const params = colorSgrParams(spec, 'bg')
  return params === null ? '' : params.slice(3) // 去 '48;'
}

/** 已知 SGR 參數 → ps1 雙引號內片段 `$e[<params>m`（"$e[…" 插值安全，.t23 §7）。 */
function sgrLit(params: string | null): string {
  return params === null ? '' : `$e[${params}m`
}

/**
 * reset＋fg＋bg 常數前綴的 ps1 雙引號字面 `"$e[0m…"`（fg 先 bg、default
 * 不 emit——emit-ansi 規則 1／2／4 的產生器面）。fg/bg 為 null 時該層略過。
 */
function styledPrefix(fg: ColorSpec | null, bg: ColorSpec | null): string {
  const fgParams = fg !== null ? colorSgrParams(fg, 'fg') : null
  const bgParams = bg !== null ? colorSgrParams(bg, 'bg') : null
  return `"$e[0m${sgrLit(fgParams)}${sgrLit(bgParams)}"`
}

/** ps1 運算式串接（去空片段，以 ` + ` 連）；全空 → 空字串字面。 */
function concatExpr(parts: readonly string[]): string {
  const nonEmpty = parts.filter((p) => p !== '')
  return nonEmpty.length === 0 ? "''" : nonEmpty.join(' + ')
}

/** ps1 陣列字面 `@('a', 'b', …)`（元素為 SGR 參數，無特殊字元）。 */
function psArray(items: readonly string[]): string {
  return `@(${items.map((s) => `'${s}'`).join(', ')})`
}

// ── 段內 emit-time 素材 ──

/**
 * icon glyph → 純 ASCII 逐 codepoint escape 運算式（檔頭「icon glyph 編碼
 * 策略」節；T1.2 裁決）。BMP（≤U+FFFF）用 `[char]0xHEX`（既有 `$ARROW`
 * idiom）；astral（＞U+FFFF）用 `[char]::ConvertFromUtf32(0xHEX)`（`[char]`
 * cast 對 astral 碼位會擲例外，必須用 ConvertFromUtf32）。多 codepoint
 * glyph（⌨️＝U+2328+U+FE0F）逐一跳脫後以 `+` 相接，回傳單一運算式片段
 * （由呼叫端經 concatExpr 併入 head）。
 */
function iconGlyphExpr(glyph: string): string {
  const parts: string[] = []
  for (const ch of glyph) {
    const cp = ch.codePointAt(0)!
    const hex = cp.toString(16).toUpperCase()
    parts.push(cp > 0xffff ? `[char]::ConvertFromUtf32(0x${hex})` : `[char]0x${hex}`)
  }
  return parts.join(' + ')
}

/**
 * 段 head 運算式（prefix 單引號字面 ＋ icon escape 運算式 ＋ 尾隨空格字面，
 * concatExpr 相接；空 head→''，濾除）。prefix 走使用者文字 escaping
 * （`psSingleQuote`）、icon 走碼位跳脫（`iconGlyphExpr`）——兩者責任分離、
 * 產出腳本對 icon 部分零非 ASCII（T1.2 契約）。
 */
function headExpr(seg: SegmentConfig, descriptor: SegmentDescriptor): string {
  const prefix = seg.prefix ?? ''
  const prefixLit = prefix === '' ? '' : psSingleQuote(prefix)
  if (!seg.icon) return prefixLit
  const iconLit = concatExpr([iconGlyphExpr(descriptor.icon.glyph), "' '"])
  return concatExpr([prefixLit, iconLit])
}

/**
 * powerline 段主色（bg）；plain 不設 bg。**呼叫端保證非 auto**：`emitOther`
 * 經 `colorExprFor` 分流（auto 段走執行期查表，見該函式），本函式僅由
 * `emitShellOut`／`emitPercentage`（非 bar）直接呼叫——兩者對應段皆非
 * `catalog.autoEligibleIds`（shell-out／percentage 類目前無 autoColor
 * 描述子），`segmentColorPlaceholder` 對 auto 之 default 退化在此為
 * 防禦性佔位（T4.4；不預期實際觸發）。
 */
function segBg(mode: BuilderConfig['mode'], seg: SegmentConfig): ColorSpec | null {
  return mode === 'powerline' ? segmentColorPlaceholder(seg.color) : null
}

/** powerline 非閾值段的 fg：fgOverride ?? autoFg(段主色)；plain fg＝段主色。 */
function segFg(mode: BuilderConfig['mode'], seg: SegmentConfig): ColorSpec | null {
  if (mode === 'powerline') return seg.fgOverride ?? autoFg(segmentColorPlaceholder(seg.color))
  return segmentColorPlaceholder(seg.color)
}

// ── 產生器狀態 ──

interface EmitState {
  mode: BuilderConfig['mode']
  /** D1 gating：powerline 模式下 `config.powerlineArrow` 之值；plain 模式忽略。 */
  powerlineArrow: boolean
  /** 已用之 helper 函式名（emit 期收斂，只印用到的）。 */
  helpers: Set<string>
  /** 閾值段常數陣列宣告（依 emit 序）。 */
  thresholdDecls: string[]
  /** 下一個閾值段的陣列名索引。 */
  thresholdCount: number
  /**
   * T4.4：本次 emit 是否用到 `$Now`（倒數段格式化／`expiresAtPath` 存活
   * 判定；S2 idiom 注入，見 `nowInjectionLines`）——由 `valueEmit`／
   * `emitOther` 於處理到 reset-countdown-*／`expiresAtPath` 段時置真；
   * 主流程據此決定是否 emit `$Now` 計算區塊（零使用時不印，維持既有
   * 無倒數段 config 的 golden bytes 不變）。
   */
  needsNow: boolean
  /** T4.4：下一個 auto 配色段的變數名索引（`$Ac<k>...`，段內獨立、跨列共用計數器同 thresholdCount）。 */
  autoCount: number
  /**
   * T3.2 多列：目前正在 emit 的列所用累加器變數名（不含 `$`）。單列
   * config（emit 期分組結果只有一列）恆為 `{ segs: 'Segs', bgt: 'BgT' }`
   * ——與改動前硬寫變數名逐位元組相同（M3 acceptance）；多列 config
   * 逐列切換為 `Segs<k>`／`BgT<k>`（呼叫端於各列段 emit 前寫入）。
   */
  rowVars: { segs: string; bgt: string }
}

/** D1 padding：powerline 模式且 `powerlineArrow=false` → 每段 value 尾綴一格空白字面；否則 ''（concatExpr 濾除）。 */
function padLit(state: EmitState): string {
  return state.mode === 'powerline' && !state.powerlineArrow ? "' '" : ''
}

/** 閾值段 → 常數陣列名＋宣告（plain＝桶 fg 陣列；powerline＝桶 bg 尾＋成對 auto-fg fg）。 */
function declareThreshold(state: EmitState, rule: ThresholdRule, fgOverride: ColorSpec | undefined): {
  fgVar: string
  bgVar: string | null
} {
  const k = state.thresholdCount++
  const fgVar = `$Th${k}Fg`
  if (state.mode === 'powerline') {
    const bgVar = `$Th${k}Bg`
    const bgTails = rule.buckets.map((b) => bgTail(b))
    const fgParams = autoFgBuckets(rule, fgOverride).map((f) => colorSgrParams(f, 'fg') ?? '')
    state.thresholdDecls.push(`${bgVar} = ${psArray(bgTails)}`)
    state.thresholdDecls.push(`${fgVar} = ${psArray(fgParams)}`)
    return { fgVar, bgVar }
  }
  // plain：桶色作 fg
  const fgParams = rule.buckets.map((b) => colorSgrParams(b, 'fg') ?? '')
  state.thresholdDecls.push(`${fgVar} = ${psArray(fgParams)}`)
  return { fgVar, bgVar: null }
}

/**
 * bar 專用桶陣列（T4.4；PLAN §4／sp4/REPORT.md 案 10/11）：filled／value
 * run 的 fg＝桶色本身（非 auto 轉換，與 threshold 一般路徑的 powerline
 * 成對 auto-fg 不同）；plain／powerline 共用同一色列（bg 於 bar 全段
 * 均一＝segColor，不逐桶變化，呼叫端另以常數提供）。
 */
function declareBarThreshold(state: EmitState, rule: ThresholdRule): { fgVar: string } {
  const k = state.thresholdCount++
  const fgVar = `$Th${k}Fg`
  const fgParams = rule.buckets.map((b) => colorSgrParams(b, 'fg') ?? '')
  state.thresholdDecls.push(`${fgVar} = ${psArray(fgParams)}`)
  return { fgVar }
}

// ── auto 配色（T4.4；PLAN Rev 4 §3／§4；resolve.ts modelPaletteIndex／
// effortPaletteIndex 之 ps1 鏡像）──
//
// model／effort 色票為**固定小型列舉**（4／6 分支），故不比照 threshold
// 走「10-桶執行期索引陣列」；改為 emit 期展開一組 if/elseif 查表——每
// 分支的 tail／fg（色本身）／autoFg（成對對比 fg）三值皆於 emit 期呼叫
// production `autoFg`／`colorSgrParams` 預算為 ps1 字面常數，執行期只
// 判斷字串比對擇一分支（`-clike`／`-ceq`，禁 `-match`——大小寫敏感）。

/** model 色票（palette 查表；resolve.ts modelPaletteIndex 同值）。`pattern:null`＝收尾 else 分支。 */
const MODEL_PALETTE: ReadonlyArray<{ pattern: string | null; index: number }> = [
  { pattern: 'claude-fable-*', index: 214 },
  { pattern: 'claude-opus-*', index: 135 },
  { pattern: 'claude-haiku-*', index: 2 },
  { pattern: null, index: 6 },
]

/** effort 色票（resolve.ts effortPaletteIndex 同值）；大小寫敏感精確比對（`-ceq`）。 */
const EFFORT_PALETTE: ReadonlyArray<{ pattern: string | null; index: number }> = [
  { pattern: 'low', index: 3 },
  { pattern: 'medium', index: 2 },
  { pattern: 'high', index: 4 },
  { pattern: 'xhigh', index: 5 },
  { pattern: 'max', index: 15 },
  { pattern: null, index: 9 },
]

interface AutoBinding {
  /** 段內唯一索引（`$Ac<index>...`，供呼叫端組合額外變數名如 `$Ac<index>Px`）。 */
  index: number
  /** 執行期 fg SGR 參數運算式（色本身；plain fg 用）。 */
  fgVar: string
  /** 執行期 bg tail 運算式（powerline bg／箭頭交接尾用）。 */
  tailVar: string
  /** 執行期 autoFg(色本身) SGR 參數運算式（powerline 無 fgOverride 時之 fg 用）。 */
  autoFgVar: string
  /** 段區塊最前需接的查表陳述式（讀 `$d`，故不可如 threshold 陣列般提前印於檔首）。 */
  setupLines: string[]
}

/**
 * `seg.color.kind==='auto'` 段的執行期查表區塊（T4.4）：比對來源＝
 * `descriptor.autoColor.key`（缺省用主值 `descriptor.ps1Path` 本身，
 * 沿 resolve.ts `expandSegmentColor` 同一 fallback 規則）。未帶
 * `autoColor` 的 descriptor 呼叫本函式＝programmer error（config 應先
 * 經 deserializeConfig 清洗），比照 resolve.ts 同語意拋 TypeError。
 */
function emitAutoBinding(state: EmitState, descriptor: SegmentDescriptor): AutoBinding {
  const autoColor = descriptor.autoColor
  if (autoColor === undefined) {
    throw new TypeError(
      `segment ${descriptor.id} 無 autoColor 通道卻收到 auto 色（config 應先經 deserializeConfig 清洗）`,
    )
  }
  const k = state.autoCount++
  const idVar = `$Ac${k}Id`
  const fgVar = `$Ac${k}Fg`
  const tailVar = `$Ac${k}Tail`
  const autoFgVar = `$Ac${k}AutoFg`
  const keyExpr = autoColor.key !== undefined ? autoColor.key.ps1Path : descriptor.ps1Path
  const branches = autoColor.palette === 'model' ? MODEL_PALETTE : EFFORT_PALETTE
  const cmp = autoColor.palette === 'model' ? '-clike' : '-ceq'

  const lines: string[] = []
  lines.push(`${idVar} = ${keyExpr}`)
  lines.push(`if ($null -eq ${idVar}) { ${idVar} = '' }`)
  branches.forEach((b, i) => {
    const spec: ColorSpec = { kind: 'ansi256', index: b.index }
    const tailLit = psSingleQuote(bgTail(spec))
    const fgLit = psSingleQuote(colorSgrParams(spec, 'fg') ?? '')
    const autoFgLit = psSingleQuote(colorSgrParams(autoFg(spec), 'fg') ?? '')
    const assign = `${tailVar} = ${tailLit}; ${fgVar} = ${fgLit}; ${autoFgVar} = ${autoFgLit}`
    if (b.pattern === null) {
      lines.push(`else { ${assign} }`)
    } else {
      const kw = i === 0 ? 'if' : 'elseif'
      lines.push(`${kw} (${idVar} ${cmp} ${psSingleQuote(b.pattern)}) { ${assign} }`)
    }
  })

  return { index: k, fgVar, tailVar, autoFgVar, setupLines: lines }
}

// ── helper 函式庫（只印用到的；契約沉默處：與 segments.ts 格式器同語意） ──

const HELPER_BODIES: Readonly<Record<string, string>> = {
  // cost：單次浮點乘 floor＋clamp0，其後全整數＋「+10⁴→切片」補尾零。
  // [double] 轉型恢復「同一 JSON number→同一 double」同構（.t23 §7）。
  'Format-Cost': [
    'function Format-Cost($c) {',
    '  $s = [long][math]::Floor([double]$c * 10000)',
    '  if ($s -lt 0) { $s = 0 }',
    '  $w = [long][math]::Floor($s / 10000)',
    "  $f = ([string]($s % 10000 + 10000)).Substring(1)",
    "  return '$' + $w + '.' + $f",
    '}',
  ].join('\n'),
  // duration：整數除法 h/m/s 三階（[double] 轉型避 Decimal 分岔）。
  'Format-Duration': [
    'function Format-Duration($ms) {',
    '  $x = [double]$ms',
    '  $h = [long][math]::Floor($x / 3600000)',
    '  $m = [long][math]::Floor($x / 60000) % 60',
    '  $s = [long][math]::Floor($x / 1000) % 60',
    "  if ($h -gt 0) { return [string]$h + 'h' + [string]$m + 'm' }",
    "  if ($m -gt 0) { return [string]$m + 'm' + [string]$s + 's' }",
    "  return [string]$s + 's'",
    '}',
  ].join('\n'),
  // context-size：in+out 總和 → ≥10⁶ M else k。
  'Format-ContextSize': [
    'function Format-ContextSize($node) {',
    '  $n = [double]$node.total_input_tokens + [double]$node.total_output_tokens',
    "  if ($n -ge 1000000) { return ([string][long][math]::Floor($n / 1000000)) + 'M' }",
    "  return ([string][long][math]::Floor($n / 1000)) + 'k'",
    '}',
  ].join('\n'),
  // lines-changed：+A/-R 原整數。
  'Format-Lines': [
    'function Format-Lines($node) {',
    "  return '+' + [string]$node.total_lines_added + '/-' + [string]$node.total_lines_removed",
    '}',
  ].join('\n'),
  // pr：#<number>。
  'Format-Pr': [
    'function Format-Pr($node) {',
    "  return '#' + [string]$node.number",
    '}',
  ].join('\n'),
  // repo：<owner>/<name>。
  'Format-Repo': [
    'function Format-Repo($node) {',
    "  return [string]$node.owner + '/' + [string]$node.name",
    '}',
  ].join('\n'),
  // tokens 縮寫（FormatKind 'tokens'；T4.4，鏡像 resolve.ts formatTokens）：
  // n<1000 原整數字串；否則 floor(n/100) 插小數點取一位＋'k'（僅 k 檔）。
  // [double] 轉型於 $null 判定之後（emitOther dash 分支已先行判過 null，
  // 本函式只接存活值）。
  'Format-Tokens': [
    'function Format-Tokens($v) {',
    '  $n = [double]$v',
    '  if ($n -lt 1000) { return [string][long][math]::Floor($n) }',
    '  $scaled = [long][math]::Floor($n / 100)',
    '  $w = [long][math]::Floor($scaled / 10)',
    '  $f = $scaled % 10',
    "  return ([string]$w) + '.' + ([string]$f) + 'k'",
    '}',
  ].join('\n'),
  // reset-5h 倒數（FormatKind 'reset-countdown-5h'；T4.4，鏡像 resolve.ts
  // formatResetCountdown5h）：diff=epoch-now（秒）；≥3600→"↺ Xh (HH:mm)"、
  // 否則"↺ Xm (HH:mm)"；HH:mm 為 epoch 本地時刻同機現算（同 Format-
  // ResetsAt idiom，InvariantCulture）。`↺`＝[char]0x21BA（sp7 gate 已證
  // 純 ASCII 跳脫形與 UTF-8 字面 byte-identical）。全 floor。
  'Format-Reset5h': [
    'function Format-Reset5h($epoch, $now) {',
    '  $diff = [double]$epoch - [double]$now',
    '  $t = [DateTimeOffset]::FromUnixTimeSeconds([long]$epoch).ToLocalTime()',
    "  $clock = $t.ToString('HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)",
    '  if ($diff -ge 3600) {',
    "    return [char]0x21BA + ' ' + ([string][long][math]::Floor($diff / 3600)) + 'h (' + $clock + ')'",
    '  }',
    "  return [char]0x21BA + ' ' + ([string][long][math]::Floor($diff / 60)) + 'm (' + $clock + ')'",
    '}',
  ].join('\n'),
  // reset-7d 倒數（FormatKind 'reset-countdown-7d'；T4.4，鏡像 resolve.ts
  // formatResetCountdown7d）：diff≥86400→"↺ Xd (MM/dd HH:mm)"、否則
  // "↺ XhYm (MM/dd HH:mm)"；MM/dd 零填、本地同機現算＋InvariantCulture。
  'Format-Reset7d': [
    'function Format-Reset7d($epoch, $now) {',
    '  $diff = [double]$epoch - [double]$now',
    '  $t = [DateTimeOffset]::FromUnixTimeSeconds([long]$epoch).ToLocalTime()',
    "  $stamp = $t.ToString('MM/dd HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)",
    '  if ($diff -ge 86400) {',
    "    return [char]0x21BA + ' ' + ([string][long][math]::Floor($diff / 86400)) + 'd (' + $stamp + ')'",
    '  }',
    '  $h = [long][math]::Floor($diff / 3600)',
    '  $m = [long][math]::Floor(($diff % 3600) / 60)',
    "  return [char]0x21BA + ' ' + ([string]$h) + 'h' + ([string]$m) + 'm (' + $stamp + ')'",
    '}',
  ].join('\n'),
}

function useHelper(state: EmitState, name: string): void {
  state.helpers.add(name)
}

// ── 存活判定 idiom（isValueDead 同語意；型別敏感——0 為費用/百分比合法值） ──

/**
 * hide/empty 政策段的存活條件（isValueDead 三後端同構）：字串段 null/''
 * 死；boolean flag 段僅 true 存活；其餘（number/node）僅 null 死（0 存活）。
 * PS `0 -eq $false` 為真——故不可用單一 `-ne $false` 濾 number（會誤殺 0）。
 */
function aliveGuard(format: FormatKind): string {
  switch (format) {
    case 'text':
    case 'path':
      return "$null -ne $v -and $v -ne ''"
    case 'flag':
      return '$v -eq $true'
    default:
      return '$null -ne $v'
  }
}

// ── 值格式化運算式（$v 已持有存活主值；回傳顯示字串運算式或多行前置） ──

interface ValueEmit {
  /** 設定 $disp 前需要的前置行（如 path basename 拆解）；已含縮排相對段內。 */
  pre: string[]
  /** 顯示值運算式（不含 head／suffix）。 */
  expr: string
}

/** 非百分比段的值格式化（契約沉默處：path variant emit 期特化）。 */
function valueEmit(state: EmitState, seg: SegmentConfig, descriptor: SegmentDescriptor): ValueEmit {
  switch (descriptor.format) {
    case 'text':
      return { pre: [], expr: '$v' }
    case 'cost':
      useHelper(state, 'Format-Cost')
      return { pre: [], expr: '(Format-Cost $v)' }
    case 'duration':
      useHelper(state, 'Format-Duration')
      return { pre: [], expr: '(Format-Duration $v)' }
    case 'context-size':
      useHelper(state, 'Format-ContextSize')
      return { pre: [], expr: '(Format-ContextSize $v)' }
    case 'lines-changed':
      useHelper(state, 'Format-Lines')
      return { pre: [], expr: '(Format-Lines $v)' }
    case 'pr':
      useHelper(state, 'Format-Pr')
      return { pre: [], expr: '(Format-Pr $v)' }
    case 'repo':
      useHelper(state, 'Format-Repo')
      return { pre: [], expr: '(Format-Repo $v)' }
    case 'flag':
      return { pre: [], expr: "'on'" }
    case 'path':
      return pathEmit(seg)
    case 'reset-countdown-5h':
      // 需 $Now（S2 idiom 注入；T4.4）——expiresAtPath 存活守衛已於
      // emitOther 一併置 needsNow 真，此處只負責格式化運算式本身。
      useHelper(state, 'Format-Reset5h')
      state.needsNow = true
      return { pre: [], expr: '(Format-Reset5h $v $Now)' }
    case 'reset-countdown-7d':
      useHelper(state, 'Format-Reset7d')
      state.needsNow = true
      return { pre: [], expr: '(Format-Reset7d $v $Now)' }
    default:
      // clock/dirty/percentage 不走此路徑（各有專屬 emit）；tokens 走
      // emitOther 的 dash 分派（nullPolicy 驅動，見該函式），不經
      // valueEmit——本 case 純防禦，現行 catalog 不會觸發。
      throw new TypeError(`valueEmit 不支援 format：${descriptor.format}`)
  }
}

/**
 * cwd path variant（full 原樣／basename 末節／tilde 縮 home＝$env:USERPROFILE）。
 * pre 行以段內基準縮排（呼叫端統一加段層縮排；巢狀相對再縮 2）。
 */
function pathEmit(seg: SegmentConfig): ValueEmit {
  const variant = seg.variant ?? 'full'
  if (variant === 'basename') {
    return {
      pre: [
        "$parts = @($v -split '[\\\\/]+' | Where-Object { $_ -ne '' })",
        '$pv = $v',
        'if ($parts.Count -gt 0) { $pv = $parts[$parts.Count - 1] }',
      ],
      expr: '$pv',
    }
  }
  if (variant === 'tilde') {
    return {
      pre: [
        '$hm = $env:USERPROFILE',
        '$pv = $v',
        "if ($hm -ne '') {",
        "  if ($v -eq $hm) { $pv = '~' }",
        "  elseif ($v.StartsWith($hm + '/') -or $v.StartsWith($hm + '\\')) { $pv = '~' + $v.Substring($hm.Length) }",
        '}',
      ],
      expr: '$pv',
    }
  }
  return { pre: [], expr: '$v' }
}

// ── 段 emit（第一趟：存活評估＋累加器 push） ──

/**
 * T1.2（06a WORKS 死資料清理）：`$BgT`／`$BgT<k>` 累加僅在
 * `powerlineArrow=true` 時才有意義——見 `joinPowerline` 的
 * `if (powerlineArrow)` 區塊，只在該旗標為真時才索引 `$BgT`（段間箭頭交接／
 * `lastArrowCap` 收尾）；arrow=false 的 powerline 腳本不需要背著一份從未被
 * 讀的死陣列，故此處與宣告面（見 `emitPs1` 單列／多列各自的 `$BgT` 宣告處
 * 註解）同步加上 `powerlineArrow` 門檻。`$Segs` 累加不受影響（plain／
 * powerline 皆需要）。
 */
function pushLines(
  state: EmitState,
  segExpr: string,
  bgTailExpr: string,
  indent: string,
): string[] {
  const out = [`${indent}$${state.rowVars.segs} += ${segExpr}`]
  if (state.mode === 'powerline' && state.powerlineArrow) {
    out.push(`${indent}$${state.rowVars.bgt} += ${bgTailExpr}`)
  }
  return out
}

/** shell-out 段（git-branch／git-dirty／clock）；命令防禦包裹＋exit-0 安全（契約 9／10）。 */
function emitShellOut(state: EmitState, seg: SegmentConfig, descriptor: SegmentDescriptor): string[] {
  const head = headExpr(seg, descriptor)
  const prefix = styledPrefix(segFg(state.mode, seg), segBg(state.mode, seg))
  // shell-out 段（git-branch／git-dirty／clock）非 catalog.autoEligibleIds
  // 成員（無 autoColor 描述子）——恆走既有靜態色路徑，不需 colorExprFor。
  const tail = `'${bgTail(segmentColorPlaceholder(seg.color))}'`
  const lines: string[] = [`# ${descriptor.id} — shell-out/${descriptor.nullPolicy}`]

  const pad = padLit(state)

  if (descriptor.id === 'clock') {
    // 恆存活（empty 政策、值恆非空）。
    lines.push("$ck = (Get-Date -Format 'HH:mm')")
    lines.push(`$disp = ${concatExpr([head, '$ck', pad])}`)
    lines.push(...pushLines(state, `${prefix} + $disp`, tail, ''))
    return lines
  }

  const cmd = descriptor.shellOut!.ps1
  const isDirty = descriptor.format === 'dirty'
  const valueExpr = isDirty ? "'*'" : '$so'
  lines.push('$so = \'\'')
  lines.push(`try { $so = [string](& ${cmd} 2>$null | Select-Object -First 1) } catch { }`)
  // 存活守衛須顯式排 $null：命令無 stdout（乾淨 repo 的 git status／detached
  // ／unborn 的 git branch）時 pipeline 產生 AutomationNull，`[string]` 於此
  // 回 $null 非 ''（`[string]$null` 才是 ''）；而 PS `$null -ne ''` 為 $true，
  // 單用 `-ne ''` 會令空輸出誤存活（乾淨 repo 誤顯 '*'／detached 誤留空段）。
  // 與 emit-bash `[ -n "$v" ]`／oracle isValueDead('') 對齊（T2.7 真執行實證）。
  lines.push("if ($null -ne $so -and $so -ne '') {")
  lines.push(`  $disp = ${concatExpr([head, valueExpr, pad])}`)
  lines.push(...pushLines(state, `${prefix} + $disp`, tail, '  '))
  lines.push('}')
  return lines
}

/**
 * 段 prefix／tail 運算式（T4.4：`seg.color.kind==='auto'` 走執行期查表
 * ＋動態組裝；否則沿既有 emit 期靜態字面，逐位元組不變）。回傳運算式
 * 可直接用於 `${prefixExpr} + $disp` 串接／`pushLines` 之 tail 參數。
 */
function colorExprFor(
  state: EmitState,
  seg: SegmentConfig,
  descriptor: SegmentDescriptor,
): { prefixExpr: string; tailExpr: string; setupLines: string[] } {
  if (seg.color.kind !== 'auto') {
    return {
      prefixExpr: styledPrefix(segFg(state.mode, seg), segBg(state.mode, seg)),
      tailExpr: `'${bgTail(segmentColorPlaceholder(seg.color))}'`,
      setupLines: [],
    }
  }
  const auto = emitAutoBinding(state, descriptor)
  const bgExpr = state.mode === 'powerline' ? auto.tailVar : null
  const fgExpr =
    state.mode === 'powerline'
      ? seg.fgOverride !== undefined
        ? psSingleQuote(colorSgrParams(seg.fgOverride, 'fg') ?? '')
        : auto.autoFgVar
      : auto.fgVar
  const pxVar = `$Ac${auto.index}Px`
  const lines = [...auto.setupLines, `${pxVar} = "$e[0m"`, `if (${fgExpr} -ne '') { ${pxVar} += "$e[" + ${fgExpr} + 'm' }`]
  if (bgExpr !== null) lines.push(`if (${bgExpr} -ne '') { ${pxVar} += "$e[48;" + ${bgExpr} + 'm' }`)
  return { prefixExpr: pxVar, tailExpr: auto.tailVar, setupLines: lines }
}

/**
 * 一般段（category `always`／`conditional`；text/path/cost/duration/
 * context-size/lines/pr/repo/flag/tokens/reset-countdown-*）。
 *
 * T4.4 dash 分派（PLAN Rev 4 §4；零 id 特判）：`descriptor.nullPolicy`
 * 驅動——`'dash'`（現行僅 token-in／token-out：非 percentage 段亦可拿
 * `'--'`）獨立分支，null→'--'、否則走 Format-Tokens；`'hide'`／`'empty'`
 * 沿既有 aliveGuard 路徑，並疊加 `expiresAtPath` 通用死值規則（存在時
 * 追加 `$Now` 存活條件，isValueDead 判定之後——現行僅 reset-5h／reset-7d）。
 */
function emitOther(state: EmitState, seg: SegmentConfig, descriptor: SegmentDescriptor): string[] {
  const head = headExpr(seg, descriptor)
  const pad = padLit(state)
  const lines: string[] = [`# ${descriptor.id} — ${descriptor.category}/${descriptor.nullPolicy}`]

  const { prefixExpr, tailExpr, setupLines } = colorExprFor(state, seg, descriptor)
  lines.push(...setupLines)

  if (descriptor.nullPolicy === 'dash') {
    useHelper(state, 'Format-Tokens')
    lines.push(`$v = ${descriptor.ps1Path}`)
    lines.push('if ($null -eq $v) {')
    lines.push(`  $vt = '--'`)
    lines.push('} else {')
    lines.push('  $vt = (Format-Tokens $v)')
    lines.push('}')
    lines.push(`$disp = ${concatExpr([head, '$vt', pad])}`)
    lines.push(...pushLines(state, `${prefixExpr} + $disp`, tailExpr, ''))
    return lines
  }

  const { pre, expr } = valueEmit(state, seg, descriptor)
  let guard = aliveGuard(descriptor.format)
  if (descriptor.expiresAtPath !== undefined) {
    state.needsNow = true
    guard = `${guard} -and $Now -lt $v`
  }
  lines.push(`$v = ${descriptor.ps1Path}`)
  lines.push(`if (${guard}) {`)
  for (const p of pre) lines.push(`  ${p}`)
  lines.push(`  $disp = ${concatExpr([head, expr, pad])}`)
  lines.push(...pushLines(state, `${prefixExpr} + $disp`, tailExpr, '  '))
  lines.push('}')
  return lines
}

/**
 * percent-reset 後綴（M6 C3，2026-07-14 拍板；(internal design doc)
 * expansion/TASKS.md T6.3；鏡像 resolve.ts `resetsAtSuffix`）：kind 由
 * `descriptor.resetsAt.countdown` 目錄驅動（零 id 特判）——rate-5h／rate-7d
 * 分派 `Format-Reset5h`／`Format-Reset7d`（需 `$Now`；`state.needsNow` 隨
 * 呼叫置真，天然落實 C5 `$Now` 注入閘門擴充「有倒數段 或 有 percent-reset
 * 變體的 rate 段」，零額外分支）。死值規則（`resets_at` null／undefined 或
 * 已過期 `$Now >= 該值`）→ `$sfx` 維持空字串——**只剔後綴，rate 段本體仍
 * 存活**（與倒數段 `expiresAtPath` 整段剔除的死值規則語意分開，不共用
 * 該分支／該 guard）。非 percent-reset variant 或 descriptor 無 `resetsAt`
 * 通道 → 空 `pre`、`sfxRef=''`（沿既有行為，零 helper／`$Now` 開銷）。
 */
function resetSuffixEmit(
  state: EmitState,
  seg: SegmentConfig,
  descriptor: SegmentDescriptor,
): { pre: string[]; sfxRef: string } {
  if (descriptor.resetsAt === undefined || seg.variant !== 'percent-reset') {
    return { pre: [], sfxRef: '' }
  }
  const helperName = descriptor.resetsAt.countdown === 'reset-countdown-5h' ? 'Format-Reset5h' : 'Format-Reset7d'
  useHelper(state, helperName)
  state.needsNow = true
  const pre = [
    `$rst = ${descriptor.resetsAt.ps1Path}`,
    `$sfx = ''`,
    `if ($null -ne $rst -and $Now -lt $rst) {`,
    `  $sfx = ' ' + (${helperName} $rst $Now)`,
    `}`,
  ]
  return { pre, sfxRef: '$sfx' }
}

/**
 * bar 段（T4.4；PLAN §4／sp4/REPORT.md 41-案 recipe；**M6 C1／C2 改版**，
 * 2026-07-14 拍板）：恆 4-run（head／filled／empty／value）併單一累加器
 * 元素——plain 沿既有閾值分裂先例（單一 `$s` 逐 run 烘 reset+fg+text）、
 * powerline 同構烘 reset+fg+bg+text（run1 亦全烘，非「bare＋join 迴圈補烘」
 * ——ps1 `joinPowerline` 之 `$Segs[i]` 元素恆已預烘完整，join 迴圈本身不再
 * 補 fg/bg，見該函式）；填格＝`max(0,min(20,floor(pct/5)))`；
 * `threshold===undefined` 退段主色。**M6 C2：撤除舊「主值 null → 整段退單
 * run」路徑**——null（`$v` 為 `$null`）時改與存活值共用同一 4-run 組裝
 * （`$bn`／`$bucketFg`／`$vt` 於 if/else 兩分支各自賦值、`$filled`／`$empty`
 * 移至 if/else 之後共用計算），null 時 `$bn=0`（filled 空、empty 滿 20
 * 格）、`$bucketFg` 恆退段主色（`threshold` 不查表——鏡像 resolve.ts
 * 「isDash 時 threshold 為 null」）、`$vt` 為 **M6 C1 `NA_TEXT`**（bar 恆
 * 百分比類，閘門走 category、零 id 特判——由 `emitSegment` 路由至本函式時
 * 已隱含）。fgOverride 停用規則（headRun 恆用 autoFg，不論 null／存活）不變。
 * bar 與 auto 互斥（`barEligibleIds`／`autoEligibleIds` 不相交，config
 * 清洗保證），本函式不處理 auto。
 */
function emitBar(state: EmitState, seg: SegmentConfig, descriptor: SegmentDescriptor): string[] {
  const head = headExpr(seg, descriptor)
  const hasThreshold = seg.threshold !== undefined
  const pad = padLit(state)
  const lines: string[] = [`# ${descriptor.id} — percentage/dash＋bar${hasThreshold ? '＋threshold' : ''}`]
  lines.push(`$v = ${descriptor.ps1Path}`)
  const { pre: sfxPre, sfxRef } = resetSuffixEmit(state, seg, descriptor)
  lines.push(...sfxPre)

  // 段主色（bar 不支援 auto，見上方文件；M3 placeholder 同既有非 bar 路徑）。
  const segColorSpec = segmentColorPlaceholder(seg.color)
  const mainTailLit = psSingleQuote(bgTail(segColorSpec))
  const mainFgLit = psSingleQuote(colorSgrParams(segColorSpec, 'fg') ?? '')
  const autoFgLit = psSingleQuote(colorSgrParams(autoFg(segColorSpec), 'fg') ?? '')

  // M6 C2：null／存活兩分支各自求 $bn／$bucketFg／$vt——null 時填格恆 0、
  // 桶色恆退段主色（threshold 不查表）、值文字＝NA_TEXT；存活時填格＝
  // max(0,min(20,floor(pct/5)))（`$bn`，非 `$n`——避與 join 之
  // `$n = $Segs.Count` 混淆），桶色依 hasThreshold 查表或退段主色。
  lines.push('if ($null -eq $v) {')
  lines.push('  $bn = 0')
  lines.push(`  $bucketFg = ${mainFgLit}`)
  lines.push(`  $vt = ${psSingleQuote(NA_TEXT)}`)
  lines.push('} else {')
  lines.push('  $p = [double]$v')
  lines.push('  $bn = [long][math]::Floor($p / 5)')
  lines.push('  if ($bn -gt 20) { $bn = 20 }')
  lines.push('  if ($bn -lt 0) { $bn = 0 }')
  lines.push("  $vt = ([string][long][math]::Floor($p)) + '%'")
  if (hasThreshold) {
    const { fgVar } = declareBarThreshold(state, seg.threshold!)
    lines.push('  $idx = [long][math]::Floor($p / 10)')
    lines.push('  if ($idx -gt 9) { $idx = 9 }')
    lines.push('  if ($idx -lt 0) { $idx = 0 }')
    lines.push(`  $bucketFg = ${fgVar}[$idx]`)
  } else {
    lines.push(`  $bucketFg = ${mainFgLit}`)
  }
  lines.push('}')
  // $bn 兩分支皆已定形（0 或 clamp 後值）——filled／empty 字元重複移出
  // if/else、兩分支共用同一運算式（4-run 恆定形，零重複組裝碼）。
  lines.push('$filled = ([string][char]0x2588) * [int]$bn')
  lines.push('$empty = ([string][char]0x2591) * [int](20 - $bn)')

  const headTextExpr = head === '' ? "''" : head
  const bucketFgExpr = '$bucketFg'
  if (state.mode === 'powerline') {
    // run1 head：fg=autoFg(segColor)（fgOverride 停用，null／存活皆同）、bg=segColor。
    lines.push('$s = "$e[0m"')
    lines.push(`if (${autoFgLit} -ne '') { $s += "$e[" + ${autoFgLit} + 'm' }`)
    lines.push(`if (${mainTailLit} -ne '') { $s += "$e[48;" + ${mainTailLit} + 'm' }`)
    lines.push(`$s += ${headTextExpr}`)
    // run2 filled：fg=桶色、bg=segColor。
    lines.push('$s += "$e[0m"')
    lines.push(`if (${bucketFgExpr} -ne '') { $s += "$e[" + ${bucketFgExpr} + 'm' }`)
    lines.push(`if (${mainTailLit} -ne '') { $s += "$e[48;" + ${mainTailLit} + 'm' }`)
    lines.push('$s += $filled')
    // run3 empty：無 fg（default）、bg=segColor。
    lines.push('$s += "$e[0m"')
    lines.push(`if (${mainTailLit} -ne '') { $s += "$e[48;" + ${mainTailLit} + 'm' }`)
    lines.push('$s += $empty')
    // run4 value：fg=桶色、bg=segColor。
    lines.push('$s += "$e[0m"')
    lines.push(`if (${bucketFgExpr} -ne '') { $s += "$e[" + ${bucketFgExpr} + 'm' }`)
    lines.push(`if (${mainTailLit} -ne '') { $s += "$e[48;" + ${mainTailLit} + 'm' }`)
    lines.push(`$s += ${concatExpr(["' '", '$vt', sfxRef, pad])}`)
    lines.push(...pushLines(state, '$s', mainTailLit, ''))
  } else {
    // plain：run1 head fg=segColor／run2 filled fg=桶色／run3 empty 無 fg／run4 value fg=桶色（皆無 bg）。
    lines.push('$s = "$e[0m"')
    lines.push(`if (${mainFgLit} -ne '') { $s += "$e[" + ${mainFgLit} + 'm' }`)
    lines.push(`$s += ${headTextExpr}`)
    lines.push('$s += "$e[0m"')
    lines.push(`if (${bucketFgExpr} -ne '') { $s += "$e[" + ${bucketFgExpr} + 'm' }`)
    lines.push('$s += $filled')
    lines.push('$s += "$e[0m"')
    lines.push('$s += $empty')
    lines.push('$s += "$e[0m"')
    lines.push(`if (${bucketFgExpr} -ne '') { $s += "$e[" + ${bucketFgExpr} + 'm' }`)
    lines.push(`$s += ${concatExpr(["' '", '$vt', sfxRef, pad])}`)
    lines.push(...pushLines(state, '$s', '', ''))
  }

  return lines
}

/** 百分比段（dash 政策；可掛閾值＋resets 後綴＋bar）。 */
function emitPercentage(state: EmitState, seg: SegmentConfig, descriptor: SegmentDescriptor): string[] {
  if (seg.bar === true) return emitBar(state, seg, descriptor)
  const head = headExpr(seg, descriptor)
  // percentage 段非 catalog.autoEligibleIds 成員（無 autoColor 描述子）
  // ——恆走既有靜態色路徑，同上 emitShellOut 理由。
  const tail = `'${bgTail(segmentColorPlaceholder(seg.color))}'`
  const hasThreshold = seg.threshold !== undefined
  const pad = padLit(state)
  const lines: string[] = [`# ${descriptor.id} — percentage/dash${hasThreshold ? '＋threshold' : ''}`]
  lines.push(`$v = ${descriptor.ps1Path}`)
  const { pre: sfxPre, sfxRef } = resetSuffixEmit(state, seg, descriptor)
  lines.push(...sfxPre)

  if (!hasThreshold) {
    // 無閾值：dash 與數值同段主色。M6 C1：dash-null 顯 NA_TEXT（percentage
    // 類恆走此顯示形，閘門走 category——emitSegment 路由至本函式時已隱含）。
    const prefix = styledPrefix(segFg(state.mode, seg), segBg(state.mode, seg))
    lines.push('if ($null -eq $v) {')
    lines.push(`  $vt = ${psSingleQuote(NA_TEXT)}`)
    lines.push('} else {')
    lines.push("  $vt = ([string][long][math]::Floor([double]$v)) + '%'")
    lines.push('}')
    lines.push(`$disp = ${concatExpr([head, '$vt', sfxRef, pad])}`)
    lines.push(...pushLines(state, `${prefix} + $disp`, tail, ''))
    return lines
  }

  // 有閾值：dash → 段主色（不套閾值色）；數值 → 桶索引查表。M6 C1：dash-null
  // 顯 NA_TEXT（同上，percentage 類）。
  const { fgVar, bgVar } = declareThreshold(state, seg.threshold!, seg.fgOverride)
  const dashPrefix = styledPrefix(segFg(state.mode, seg), segBg(state.mode, seg))
  lines.push('if ($null -eq $v) {')
  lines.push(`  $disp = ${concatExpr([head, psSingleQuote(NA_TEXT), sfxRef, pad])}`)
  lines.push(...pushLines(state, `${dashPrefix} + $disp`, tail, '  '))
  lines.push('} else {')
  lines.push('  $p = [double]$v')
  lines.push("  $vt = ([string][long][math]::Floor($p)) + '%'")
  lines.push('  $idx = [long][math]::Floor($p / 10)')
  lines.push('  if ($idx -gt 9) { $idx = 9 }')
  lines.push('  if ($idx -lt 0) { $idx = 0 }')

  if (state.mode === 'powerline') {
    lines.push(`  $fg = ${fgVar}[$idx]`)
    lines.push(`  $bg = ${bgVar}[$idx]`)
    lines.push('  $s = "$e[0m"')
    lines.push("  if ($fg -ne '') { $s += \"$e[\" + $fg + 'm' }")
    lines.push("  if ($bg -ne '') { $s += \"$e[48;\" + $bg + 'm' }")
    lines.push(`  $s += ${concatExpr([head, '$vt', sfxRef, pad])}`)
    lines.push(...pushLines(state, '$s', '$bg', '  '))
  } else {
    // plain 閾值：head 非空 → 兩 run（head 隨段主色 + reset、value 隨桶色）；
    // head 空 → 單 run（僅 value run 的前置 reset），與 oracle（見 resolve.ts
    // 的 plain 單 run 組裝分支）＋bash（見 emit-bash.ts 的 pushLine
    // reset='1' 處）同構。
    // 第二個 reset 收進 head!=='' 分支——head 空時勿補、否則多吐 ESC[0m 破
    // byte-exact（CR2 覆蓋盲區 #2）。percentage 段非 auto-eligible，同上。
    const headPrefix = styledPrefix(segmentColorPlaceholder(seg.color), null)
    lines.push(`  $fg = ${fgVar}[$idx]`)
    if (head !== '') {
      lines.push(`  $s = ${headPrefix} + ${head}`)
      lines.push('  $s += "$e[0m"')
    } else {
      lines.push('  $s = "$e[0m"')
    }
    lines.push("  if ($fg -ne '') { $s += \"$e[\" + $fg + 'm' }")
    lines.push(`  $s += ${concatExpr(['$vt', sfxRef])}`)
    lines.push(...pushLines(state, '$s', '', '  '))
  }
  lines.push('}')
  return lines
}

function emitSegment(state: EmitState, seg: SegmentConfig, descriptor: SegmentDescriptor): string[] {
  if (descriptor.category === 'shell-out') return emitShellOut(state, seg, descriptor)
  if (descriptor.category === 'percentage') return emitPercentage(state, seg, descriptor)
  return emitOther(state, seg, descriptor)
}

// ── 第二趟：join（.t23 §5 機械展開；powerline 箭頭交接／cap／plain 分隔符） ──

/**
 * D1 gating：`powerlineArrow=false` → 不 emit 段間箭頭迴圈區塊、
 * `lastArrowCap` 全面無效（收尾箭頭區塊恆不 emit）；段本身的 padding
 * 已在各 emit* 函式併入累加器元素，本函式無需另處理。
 *
 * T3.2 多列：`segsVar`／`bgtVar`／`outVar`（不含 `$`）由呼叫端決定——單列
 * config 呼叫端固定傳 `('Segs', 'BgT', 'out')`，逐行輸出與改動前硬寫變數名
 * 逐位元組相同（M3 acceptance）；多列 config 逐列傳入 `Segs<k>`／`BgT<k>`／
 * `RowOut<k>`，本函式邏輯不變（純變數名參數化，join 演算法同構）。
 */
function joinPowerline(
  lastArrowCap: boolean,
  powerlineArrow: boolean,
  segsVar: string,
  bgtVar: string,
  outVar: string,
): string[] {
  const lines = [`$${outVar} = ''`, `$n = $${segsVar}.Count`, 'for ($i = 0; $i -lt $n; $i++) {']
  if (powerlineArrow) {
    lines.push(
      '  if ($i -gt 0) {',
      `    $${outVar} += "$e[0m"`,
      `    if ($${bgtVar}[$i - 1] -ne '') { $${outVar} += "$e[38;" + $${bgtVar}[$i - 1] + 'm' }`,
      `    if ($${bgtVar}[$i] -ne '') { $${outVar} += "$e[48;" + $${bgtVar}[$i] + 'm' }`,
      `    $${outVar} += $ARROW`,
      '  }',
    )
  }
  lines.push(`  $${outVar} += $${segsVar}[$i]`, '}')
  if (powerlineArrow && lastArrowCap) {
    lines.push(
      'if ($n -gt 0) {',
      `  $${outVar} += "$e[0m"`,
      `  if ($${bgtVar}[$n - 1] -ne '') { $${outVar} += "$e[38;" + $${bgtVar}[$n - 1] + 'm' }`,
      `  $${outVar} += $ARROW`,
      '}',
    )
  }
  lines.push(`$${outVar} += "$e[0m"`)
  return lines
}

/** codepoint < U+0080＝ASCII（separatorExpr 的 ASCII／非 ASCII 分流判定）。 */
function isAsciiCodePoint(cp: number): boolean {
  return cp < 0x80
}

/**
 * 分隔符 → ps1 運算式（Important #7 修復；檔頭「escaping」節分隔符例外）：
 * 逐字元（`for…of` 已按 code point 迭代，正確處理 astral surrogate pair）
 * 分流——連續 ASCII 段落合併為單一 `psSingleQuote` 字面（與修復前
 * `psSingleQuote(separator)` 逐位元組相同）、非 ASCII 字元逐一交給
 * `iconGlyphExpr` 碼位跳脫（BMP 用 `[char]0xHEX`、astral 用
 * `ConvertFromUtf32`），各段以 `concatExpr` 相接。純 ASCII 輸入（preset
 * `|`／空格、常見自訂分隔符）退化為單一 `psSingleQuote` 呼叫——行為與
 * 修復前零差異；含非 ASCII 字元時（preset '›'／'·'，或使用者自訂分隔
 * 符）產出腳本對該分隔符零非 ASCII bytes。
 */
function separatorExpr(s: string): string {
  const parts: string[] = []
  let asciiRun = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (isAsciiCodePoint(cp)) {
      asciiRun += ch
      continue
    }
    if (asciiRun !== '') {
      parts.push(psSingleQuote(asciiRun))
      asciiRun = ''
    }
    parts.push(iconGlyphExpr(ch))
  }
  if (asciiRun !== '') parts.push(psSingleQuote(asciiRun))
  return concatExpr(parts)
}

/**
 * T3.2 多列：`segsVar`／`outVar`（不含 `$`）由呼叫端決定——參數化理由同
 * `joinPowerline`（plain 無 bg 交接，無需 `bgtVar`）。
 */
function joinPlain(separator: string, segsVar: string, outVar: string): string[] {
  const lines = [`$${outVar} = ''`, `$n = $${segsVar}.Count`, 'for ($i = 0; $i -lt $n; $i++) {']
  if (separator !== '') {
    lines.push(`  if ($i -gt 0) { $${outVar} += "$e[0m" + ${separatorExpr(separator)} }`)
  }
  lines.push(`  $${outVar} += $${segsVar}[$i]`, '}', `$${outVar} += "$e[0m"`)
  return lines
}

// ── 多列分組（emit 期；T3.2，PLAN §多列輸出／resolve.ts 分組鍵同構） ──

/** 單一渲染列的 emit 期分組結果：`key`＝原始 `seg.row ?? 0`（供除錯註解用）。 */
interface RowGroup {
  key: number
  segments: SegmentConfig[]
}

/**
 * 依 `seg.row ?? 0` 分組（emit 期寫死；與 resolve.ts `resolve()` 同一分組
 * 鍵、同一升冪排序、同一列內順序＝`config.segments` 陣列既有序）。僅收
 * **啟用**段（`seg.enabled`）；只作為 emit 期靜態分組——執行期某列全部
 * 段死亡（hide/empty null）時的「空列剔除」屬執行期第 2 步，不在此函式
 * 處理（見 `emitPs1` 多列分支的 `$Rows` 過濾）。
 */
function groupSegmentsByRow(config: BuilderConfig): RowGroup[] {
  const groups = new Map<number, SegmentConfig[]>()
  for (const seg of config.segments) {
    if (!seg.enabled) continue
    const row = seg.row ?? 0
    const bucket = groups.get(row)
    if (bucket === undefined) groups.set(row, [seg])
    else bucket.push(seg)
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => a - b)
  return sortedKeys.map((key) => ({ key, segments: groups.get(key)! }))
}

/**
 * T1.5（09-PLAN §D1 A-4）：第 `rowIndex`（啟用列位，即 `groupSegmentsByRow`
 * 分組序——與 `rowSeparators` 索引基準 A-1 同一口徑，呼叫端 `rowGroups`
 * 之陣列 index 本就是此值，免額外映射）列之有效 plain 分隔符值——
 * `config.rowSeparators?.[rowIndex]` 存在（非 `null`／越界）則用其值，
 * 否則退全域 `config.separator`。**no-override fast path**：
 * `rowSeparators` 全 `null`／缺席（含整欄缺席）時，`?.[rowIndex]` 恆
 * 回 `undefined`，`?? config.separator` 落回既有全域值——與改動前
 * 逐 byte 相同。僅 plain 模式呼叫端（`joinPlain` 兩呼叫點）使用；
 * powerline 走 `joinPowerline`，零觸碰此欄。
 */
function rowSeparatorValue(config: BuilderConfig, rowIndex: number): string {
  return (config.rowSeparators?.[rowIndex] ?? config.separator).value
}

// ── now 注入（T4.4；sp2/REPORT.md §2.3 釘死 idiom，逐字抄） ──

/**
 * `$Now`（epoch 秒）計算區塊：`STATUSLINE_NOW_EPOCH` 環境變數存在且可
 * 解析為合法整數時採其值（決定論注入，供測試／使用者覆寫）；未設、
 * 空字串、或非數字字串一律靜默回落真系統時鐘（`DateTimeOffset.Now`），
 * 不中止腳本（exit 0 不變量）。`[string]::IsNullOrEmpty` 閘先行（避開
 * `[long]''` 靜默＝0 的陷阱——sp2 §2.1 實證，try/catch 形不可靠）、
 * `[long]::TryParse` 閘次之（非數字不擲例外，語意精確對齊「不中止」）。
 * 僅在 `state.needsNow` 時 emit（倒數段／`expiresAtPath` 用到；零使用
 * 時不印，既有無倒數段 config 之 golden bytes 不受影響）。
 */
function nowInjectionLines(): string[] {
  return [
    '$__nowEnv = $env:STATUSLINE_NOW_EPOCH',
    'if ([string]::IsNullOrEmpty($__nowEnv)) {',
    '  $Now = [DateTimeOffset]::Now.ToUnixTimeSeconds()',
    '} else {',
    '  $__nowParsed = 0L',
    '  if ([long]::TryParse($__nowEnv, [ref]$__nowParsed)) {',
    '    $Now = $__nowParsed',
    '  } else {',
    '    $Now = [DateTimeOffset]::Now.ToUnixTimeSeconds()',
    '  }',
    '}',
  ]
}

// ── 主入口 ──

/**
 * BuilderConfig → 自足 `.ps1` 腳本文字（**不含** 檔案 BOM——BOM 屬檔案
 * 下載／簽入層職責，契約 8；本函式回傳純腳本內容，LF 換行）。未知
 * segment id＝programmer error（config 應先經 deserializeConfig 對真
 * catalog 清洗）→ TypeError（對齊 resolve）。
 *
 * ── T3.2 多列（PLAN §多列輸出；resolve.ts 分組語意的 shell 端執行期展開）──
 * emit 期分組結果只有一列（含零啟用段）時走**既有扁平結構**（`$Segs`／
 * `$BgT`／單次 join → `$out`）——與改動前逐位元組相同（M3 acceptance：
 * 全部既有 golden config 皆單列，golden 比對即單列 bytes 未變的證明）。
 * 分組結果 >1 列時走四步展開（與 emit-bash 同構）：
 * 1. 逐列緩衝——各列獨立累加器 `$Segs<k>`／`$BgT<k>`（`k`＝渲染列序
 *    0..N-1，非原始 `row` 值；分隔符／箭頭／cap 皆列內獨立求值 `$RowOut<k>`）；
 * 2. 執行期空列過濾——`$Segs<k>.Count -gt 0` 時才收進 `$Rows`（全死列
 *    不吐空行）；
 * 3. 存活列以 LF（`` `n ``，非 CRLF）串接——`[string]::Join("`n", $Rows)`，
 *    LF 只夾在存活列之間，每列尾端 SGR reset 已在各列 join 內、於 LF 之前；
 * 4. 零存活列退化——`$Rows` 為空 → 單一 `"$e[0m"`（與 oracle
 *    `toAnsi([[]])` 對齊）。
 */
export function emitPs1(config: BuilderConfig, catalog: SegmentDescriptorCatalog): string {
  const state: EmitState = {
    mode: config.mode,
    powerlineArrow: config.powerlineArrow,
    helpers: new Set(),
    thresholdDecls: [],
    thresholdCount: 0,
    needsNow: false,
    autoCount: 0,
    rowVars: { segs: 'Segs', bgt: 'BgT' },
  }

  const resolveDescriptor = (seg: SegmentConfig): SegmentDescriptor => {
    const descriptor = catalog[seg.id]
    if (descriptor === undefined) {
      throw new TypeError(`未知 segment id：${seg.id}（config 應先經 deserializeConfig 清洗）`)
    }
    return descriptor
  }

  const rowGroups = groupSegmentsByRow(config)
  const multiRow = rowGroups.length > 1

  const out: string[] = []
  out.push('# Claude Code statusline — 由 ClientKit statusline-builder 產生')
  out.push('# PowerShell 5.1+ / 7；請以 UTF-8（含 BOM）儲存。')
  out.push('[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)')
  out.push('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)')
  out.push('$e = [char]27')
  // D1 gating：`$ARROW` 只在 powerline＋powerlineArrow=true 時 emit（false 時
  // 無段間箭頭、也無收尾 cap，變數本身無用武之地）。
  if (state.mode === 'powerline' && state.powerlineArrow) out.push('$ARROW = [string][char]0xE0B0')

  if (!multiRow) {
    // 單列（既有扁平結構；分組結果 0 列＝零啟用段，同走此分支、行為不變）。
    const segs = rowGroups.length === 1 ? rowGroups[0].segments : []
    const segmentBlocks: string[] = []
    for (const seg of segs) {
      segmentBlocks.push(emitSegment(state, seg, resolveDescriptor(seg)).join('\n'))
    }

    // 閾值段常數陣列（emit 期預算、執行期只索引）。
    for (const decl of state.thresholdDecls) out.push(decl)

    // helper 函式（只印用到的；印序固定＝HELPER_BODIES 宣告序）。
    for (const name of Object.keys(HELPER_BODIES)) {
      if (state.helpers.has(name)) out.push('', HELPER_BODIES[name])
    }

    out.push('')
    out.push('$raw = [Console]::In.ReadToEnd()')
    out.push('$d = $null')
    out.push('try { $d = $raw | ConvertFrom-Json -ErrorAction Stop } catch { }')
    if (state.needsNow) {
      out.push('')
      out.push(...nowInjectionLines())
    }
    out.push('')
    out.push('$Segs = @()')
    // T1.2：`$BgT` 只在 arrow=true 時被 `joinPowerline` 的
    // `if (powerlineArrow)` 區塊讀取，arrow=false 時不宣告，與累加面
    // （pushLines）同門檻。
    if (state.mode === 'powerline' && state.powerlineArrow) out.push('$BgT = @()')

    for (const block of segmentBlocks) {
      out.push('')
      out.push(block)
    }

    out.push('')
    const join =
      state.mode === 'powerline'
        ? joinPowerline(config.lastArrowCap, config.powerlineArrow, 'Segs', 'BgT', 'out')
        : joinPlain(rowSeparatorValue(config, 0), 'Segs', 'out')
    out.push(...join)
  } else {
    // 多列（四步展開；與 emit-bash 同構，見上方函式頭註解）。
    const segmentBlocksByRow: string[][] = rowGroups.map((group, k) => {
      state.rowVars = { segs: `Segs${k}`, bgt: `BgT${k}` }
      return group.segments.map((seg) => emitSegment(state, seg, resolveDescriptor(seg)).join('\n'))
    })

    // 閾值段常數陣列（emit 期預算、跨列共用同一組宣告；執行期只索引）。
    for (const decl of state.thresholdDecls) out.push(decl)

    // helper 函式（只印用到的；印序固定＝HELPER_BODIES 宣告序）。
    for (const name of Object.keys(HELPER_BODIES)) {
      if (state.helpers.has(name)) out.push('', HELPER_BODIES[name])
    }

    out.push('')
    out.push('$raw = [Console]::In.ReadToEnd()')
    out.push('$d = $null')
    out.push('try { $d = $raw | ConvertFrom-Json -ErrorAction Stop } catch { }')
    if (state.needsNow) {
      out.push('')
      out.push(...nowInjectionLines())
    }

    // 步驟 1：逐列緩衝（宣告＋段 emit；列內累加器獨立）。
    for (let k = 0; k < rowGroups.length; k++) {
      out.push('')
      out.push(`# ── row ${k}（row=${rowGroups[k].key}） ──`)
      out.push(`$Segs${k} = @()`)
      // T1.2：同單列（上方 `$BgT` 宣告處註解）——arrow=false 不宣告。
      if (state.mode === 'powerline' && state.powerlineArrow) out.push(`$BgT${k} = @()`)
      for (const block of segmentBlocksByRow[k]) {
        out.push('')
        out.push(block)
      }
    }

    // 步驟 1（續）：逐列 join——分隔符／箭頭／cap 僅作用該列緩衝，各列
    // 尾端皆含 SGR reset（joinPowerline／joinPlain 恆尾綴 `"$e[0m"`）。
    for (let k = 0; k < rowGroups.length; k++) {
      out.push('')
      out.push(`# ── row ${k} join ──`)
      const rowJoin =
        state.mode === 'powerline'
          ? joinPowerline(config.lastArrowCap, config.powerlineArrow, `Segs${k}`, `BgT${k}`, `RowOut${k}`)
          : joinPlain(rowSeparatorValue(config, k), `Segs${k}`, `RowOut${k}`)
      out.push(...rowJoin)
    }

    // 步驟 2：執行期空列過濾（該列累加器空＝全部段執行期死亡 → 剔除，不
    // 吐空行）。步驟 3：存活列以 LF（`` `n ``，非 CRLF）串接，reset 在 LF
    // 之前（各列 join 尾端已含）。步驟 4：零存活列退化為單一 reset（與
    // oracle `toAnsi([[]])` 對齊）。
    out.push('')
    out.push('# ── 存活列過濾＋LF 串接（步驟 2–4） ──')
    out.push('$Rows = @()')
    for (let k = 0; k < rowGroups.length; k++) {
      out.push(`if ($Segs${k}.Count -gt 0) { $Rows += $RowOut${k} }`)
    }
    out.push('if ($Rows.Count -gt 0) {')
    out.push('  $out = [string]::Join("`n", $Rows)')
    out.push('} else {')
    out.push('  $out = "$e[0m"')
    out.push('}')
  }

  out.push('')
  out.push('[Console]::Out.Write($out)')
  out.push('exit 0')

  return out.join('\n') + '\n'
}
