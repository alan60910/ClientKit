/**
 * S5-T2.4（(internal design doc) §產生器契約 1–12／§格式化
 * 對等規則／§D2；join 兩趟藍本定案經過見 (internal design doc)
 * WORKS.md「T2.3 DONE」節）：emit-bash 產生器——吃
 * BuilderConfig＋descriptor catalog，吐**自足** bash 腳本字串。產出腳本
 * 執行後 stdout 與 `emit-ansi.toAnsi(resolve(config, scenario))` byte-exact
 * （SP-5 已證此可行；本檔的 join 演算法照 sp5/join.sh 同語意展開）。
 *
 * ── 契約落點對照 ──
 * 1  讀入：`input=$(cat)`。
 * 2  jq 缺件：`command -v jq` 失敗 → 提示字串＋`exit 0`。**僅在有 jq
 *    消費段（非 shell-out）啟用時 emit 此守衛**（契約 10 最小化精神；
 *    純 shell-out／空 config 不需 jq，不應誤判空白）。
 * 3  null 三態 idiom（依 descriptor.nullPolicy）：
 *    - dash（百分比類，`category==='percentage'`；M6 C1 修正）：jq
 *      `// "(n/a)"`（NA_TEXT）＋number 分支顯示 `⌊p⌋%`；桶索引另一 jq，
 *      `-1` 哨值由 bash 分流（bash 零數學）。dash 但非百分比類
 *      （token-in／out，`category==='always'`）維持 `// "--"`（DASH_TEXT，
 *      見 `emitSegment` 尾段 nullPolicy 分支）——閘門走 category，零 id
 *      特判。
 *    - hide／empty：jq `// empty`＋bash `[ -n "$v" ]` 剔段（false 亦被
 *      jq `//` 剔除——thinking 同構）。
 * 4  執行期兩趟 join（平行陣列 texts/fgs/bgs 或 texts/fgs/segstart）：
 *    第一趟依啟用段序 push 存活者；第二趟逐 run 拼
 *    `ESC[0m + fg + bg + text`（stateless、fg 先 bg）、powerline 箭頭
 *    fg=前段bg/bg=後段bg＋cap 兩態、plain 分隔符、行尾無條件 reset。
 * 5  閾值：桶索引 jq floor＋clamp；powerline 成對 auto-fg 陣列 emit 期
 *    預算、執行期只索引（bash 零亮度數學）。
 * 6  escaping：使用者文字（prefix／custom separator）以 bash 單引號
 *    context 嵌入，`'`→`'\''`；jq 程式與使用者文字皆不進 `printf` 格式
 *    位（輸出 `printf '%s' "$out"`，$out 在引數位）。
 * 7  ESC=$'\033'；ansi256 `38;5;n`／`48;5;n`、truecolor `38;2;r;g;b`。
 * 9  exit-0 不變量：禁 `set -e`；每個 shell-out `… 2>/dev/null || true`；
 *    結尾顯式 `exit 0`。
 * 10 shell-out 最小化：僅啟用段 emit 對應呼叫；jq 守衛條件 emit（見 2）。
 * 12 時間（resets_at 倒數；M6 C3 升級；(internal design doc) CI hotfix 修正）：
 *    percent-reset variant 段於主值後 emit resets 後綴——
 *    `jqResetSuffix5h`／`jqResetSuffix7d` 全 jq pipeline（kind 由
 *    `descriptor.resetsAt.countdown` 驅動，零 id 特判），時間格式化改走
 *    `localtime | strftime(fmt)`（jq 1.6+ 通用 idiom，`strflocaltime` 本即此
 *    二步的 builtin 別名、輸出恆等；不再宣稱僅 1.8.1 可用），`$now`／`$r`
 *    綁定式外層加括號（`((A // B)) as $now`）——jq 1.7.x 對 `//` 與 `as`
 *    綁定的運算子優先序判定與 1.8.x 不同（`A // B as $x | BODY` 於 1.7.x
 *    誤解析為 `A // (B as $x | BODY)`，令 LHS truthy 時整段 BODY 連同死值
 *    判定被短路跳過、直接吐出 LHS 之 `$now` 原始值），外層括號消弭此歧義、
 *    兩版本輸出一致（(internal design doc) 單步定位）。
 *    死值（非 number／已過期）→ `''`（鏡像 resolve.ts resetsAtSuffix／
 *    emit-ps1 Format-ResetsAt；三後端同機同 TZ 一致）。後綴附於 value 部、
 *    與主值 dash 正交（`(n/a) ↺ 2h (16:00)`），閾值分裂時隨值色。
 *
 * ── D1 gating（S6-T2.3：`config.powerlineArrow`，僅 powerline 模式）──
 * `powerlineArrow=false`（v2 預設）：不 emit `ARROW=` 變數、join 迴圈不插
 * 段間箭頭、`lastArrowCap` 全面無效（cap 區塊恆不 emit）；改為每段 value
 * 尾綴一格右側空白（`"$v "` 等，併入該段既有雙引號 value 運算式——與
 * resolve.ts `head + value + suffix + ' '` 同一 composition）。
 * `powerlineArrow=true`（v1 遷移沿襲）：語意不變（箭頭＋`lastArrowCap`
 * 依其值＋無 padding）。plain 模式完全不受本欄影響（pad 恆為空字串）。
 *
 * 純函式、零 DOM import，node 可測。與 emit-ps1（T2.5）為平行後端、互不
 * 依賴；兩者共用 color.ts 的 SGR 建構規則與 resolve/segments/threshold
 * 的取值語意單一來源。
 *
 * ── 多列（T3.1，(internal design doc) §shell 端
 * 執行期展開語意）──
 * emit 期依 `seg.row ?? 0` 對全部已啟用段分組（升冪壓縮，與 resolve()
 * 對存活段分組後的渲染列序同構——見 groupByRow）。分組結果只有一列
 * （含 0 段空鏈）時，走與改動前逐位元組相同的扁平結構（陣列變數
 * `texts`/`fgs`/`bgs`/`segstart`、單一 `out`；suffix=''）——此為 M3
 * milestone 硬性驗收：既有單列 golden bytes 不變。分組結果 ≥2 列時，
 * 走四步執行期展開：
 *   1 逐列緩衝——各列獨立累加陣列（`texts_N`/`fgs_N`/`bgs_N` 或
 *     `segstart_N`，N＝壓縮後列序 0-index），列內箭頭／分隔符／cap 只
 *     作用於該列緩衝（joinPowerline/joinPlain 以 suffix 隔離變數名）；
 *   2 runtime 空列過濾——某列存活計數 `n_N` 為 0（該列的段在本次執行
 *     全數死亡）即不併入 `outs`，不吐空行；
 *   3 存活列以 LF 串接——`outs` 逐元素相接，LF 只夾在存活列之間（各列
 *     `out_N` 本身已含尾端無條件 SGR reset，故 reset 恆在 LF 之前）；
 *   4 零存活列退化——`outs` 為空 → `out` 直接賦值單一 SGR reset
 *     （`${ESC}[0m`，對齊 oracle `toAnsi([[]])`）。
 * 兩路徑皆維持 `printf '%s' "$out"`（契約 6/9 不受列數影響）。
 *
 * ── T4.3（(internal design doc) Rev 4 §3/§4）──
 * 承接 T3.2 追補的 5 新段（token-in／token-out／cache-hit／reset-5h／
 * reset-7d）與 T4.2 的 bar／auto 契約，本檔補齊 bash 端真實作：
 * - **bar**（`seg.bar===true`，percentage 類）：`emitBarSegment`——plain
 *   逐 run push 4 元素（`joinPlain` 零改動）；powerline 併單一累加器
 *   元素（run1 進 fgs/bgs 欄位、run2–4 各自完整烘焗，sp4/REPORT.md 精確
 *   配方，勿 4-run 全烘）。
 * - **auto 配色**（`seg.color.kind==='auto'`，僅 model／effort，與
 *   bar／shell-out／percentage 互斥）：`emitAutoBinding`——emit 期預算
 *   各色票分支的 fg／bg 尾／autoFg 對比 fg 三值，執行期以 bash `case`
 *   一次分派（大小寫敏感前綴／精確字面比對）；`generalSegmentColor` 為
 *   always／conditional 分支的唯一 auto 落點，非 auto 段沿既有靜態公式
 *   byte-exact 不變。
 * - **tokens 縮寫**（token-in／token-out，`nullPolicy:'dash'`）：
 *   `emitOther` 概念（本檔 `emitSegment` 尾段）改由 `nullPolicy` 驅動
 *   （非 category）分派 dash 分支，jq `TOKENS_JQ_FORMAT` 鏡像
 *   resolve.ts `formatTokens`。
 * - **倒數段**（reset-5h／reset-7d，`expiresAtPath`＋兩套階梯格式）：
 *   `jqResetCountdown5h`／`jqResetCountdown7d` 全 jq pipeline——`$now`
 *   採 sp2/REPORT.md §3 S2 idiom（`STATUSLINE_NOW_EPOCH` 合法整數優先，
 *   否則 `now|floor`，非數字靜默 fallback，`nowAndR` 外層括號見 `nowAndR`
 *   檔頭註解——jq 1.7.x／1.8.x 對 `// ... as $x` 運算子優先序判定不同，
 *   缺括號會令 1.7.x 短路吐出 `$now` 原始值、通用死值規則與格式化全數
 *   被跳過）；通用死值規則（非 number 或 `now>=resets_at` → `empty`）與
 *   格式化皆鏡像 resolve.ts `formatResetCountdown5h`/`7d`；HH:MM／MM:DD 用
 *   jq `localtime | strftime(fmt)`（`strflocaltime` builtin 別名之展開，
 *   同機同 TZ，jq 1.6+ 通用、不釘 CI 時區）。
 *
 * ── M6 T6.2（(internal design doc)；使用者
 * 2026-07-14 拍板契約 C1–C3，見 resolve.ts 檔頭「T6.1」節與 WORKS.md 同日
 * 條目）：oracle（resolve.ts）真機回饋修正的 bash 端同構落地 ──
 * **C1 百分比無資料標記**：見上方契約 3 節；`emitSegment` 百分比分支
 * （非 bar）與 `emitBarSegment` 的 dash 分派皆改吐 NA_TEXT（`'(n/a)'`，
 * 從 resolve.ts import）取代舊 `'--'`；token-in/out 的獨立 dashProg
 * （`emitSegment` 尾段 nullPolicy 分支）不受影響。
 * **C2 bar×null 不再退單 run**：`emitBarSegment` 撤除舊「`[ -z "$v" ]` →
 * 整段退單 run」分支，改為不論死活恆走 4-run（`bn`／`bval` 為死活兩態
 * 唯一差異點，filled／empty／bfg／run4 組裝與 push 皆共用同一路徑）；
 * bucket 退段主色的判定改以執行期 `[ -n "$v" ]` 同構複刻 oracle
 * 「isDash 時 threshold 恆 null」規則。
 * **C3 percent-reset 後綴升級倒數形**：`jqResetSuffix5h`／
 * `jqResetSuffix7d`（`jqResetCountdown5h`/`7d` 姊妹版，見該二函式檔頭
 * 差異註解）取代舊 `strflocaltime("%H:%M")` 靜態後綴；kind 由
 * `descriptor.resetsAt.countdown` 驅動（零 id 特判）；死值（非
 * number／已過期）→ `''`（只剔後綴，rate 段本體仍存活，非
 * `jqResetCountdown5h/7d` 之 `empty`——那版供獨立 reset-5h/7d 段整段
 * 死值判定，語意不同不可混用）。`emitBarSegment` 與 `emitSegment` 百分比
 * 分支的後綴計算皆改走此二函式。
 */
import { autoFg, colorSgrParams, type ColorSpec } from './color.js'
import { segmentColorPlaceholder, type BuilderConfig, type SegmentConfig } from './config.js'
import {
  BAR_CELL_COUNT,
  BAR_EMPTY_CHAR,
  BAR_FILLED_CHAR,
  NA_TEXT,
  POWERLINE_ARROW,
} from './resolve.js'
import { defaultVariant, type FormatKind, type SegmentDescriptor } from './segments.js'
import { autoFgBuckets, type ThresholdRule } from './threshold.js'

/** emitBash 的 descriptor 注入面（呼叫端傳 segments.ts 的 DESCRIPTORS_BY_ID）。 */
export type SegmentDescriptorCatalog = Readonly<Record<string, SegmentDescriptor>>

/** jq 缺件時的單行提示（ASCII，任何終端可讀；contract 2）。 */
export const JQ_MISSING_HINT = 'statusline: jq not found - install jq: https://jqlang.github.io/jq/'

// ── escaping／SGR 字面 helper ──

/** bash 單引號 context 逸出（契約 6）：`'`→`'\''`，其餘（含 `$`/`` ` ``/`!`/`\`/`%`/`"`）字面。 */
function bashSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** SGR 參數段（`38;5;16` 等）→ bash 單引號字面；空字串（default）→ `''`。 */
function sgrLit(params: string): string {
  return `'${params}'`
}

/**
 * JS 字串 → jq 字串字面（M6 T6.2；jq 字串語法為 JSON 相容子集，直接借用
 * `JSON.stringify`）：`NA_TEXT`（`'(n/a)'`）等無特殊字元的字面亦可用一般
 * 手寫 `"..."`，此處求單一事實來源（避免常數與 jq 程式文字兩處手打漂移）。
 */
function jqStrLit(s: string): string {
  return JSON.stringify(s)
}

/** ColorSpec → fg SGR 參數段（`38;5;n`／`38;2;r;g;b`）；default → ''（不 emit）。 */
function fgParams(spec: ColorSpec): string {
  return colorSgrParams(spec, 'fg') ?? ''
}

/**
 * ColorSpec → bg／箭頭參數「尾」（`5;n`／`2;r;g;b`）：同一尾可派生段 bg
 * `48;<尾>`、箭頭 fg `38;<尾>`（前段）與 bg `48;<尾>`（後段）。default → ''。
 */
function sgrTail(spec: ColorSpec): string {
  const params = colorSgrParams(spec, 'bg')
  return params === null ? '' : params.slice(params.indexOf(';') + 1)
}

/** powerline 段主色的 fg：fgOverride 優先、否則 auto-fg（D2；default → ''）。 */
function powerlineMainFg(seg: SegmentConfig): string {
  // M3 邊界（08-PLAN Rev 4 §3）：auto 色票展開屬 M4 T4.3，此處以
  // segmentColorPlaceholder 佔位（auto → default）滿足 typecheck。
  return fgParams(seg.fgOverride ?? autoFg(segmentColorPlaceholder(seg.color)))
}

/** bash 陣列字面 `name=('a' 'b' …)`（元素單引號；SGR 參數不含 `'`）。 */
function bashArray(name: string, elems: readonly string[]): string {
  return `${name}=(${elems.map((e) => `'${e}'`).join(' ')})`
}

// ── 格式化 jq 尾段（§格式化對等規則；bash 零數學、全 jq 產出最終字串） ──

/**
 * FormatKind → 接在 `<jqPath> // empty` 之後的 jq 尾段（含前導 ` | `；
 * 'text'／path-full 為空字串）。percentage／dirty／clock 不走此函式
 * （dash 政策／shell-out 另處理）。variant 僅 path 需要。
 *
 * 補尾零 cost idiom（`+10⁴→tostring→切片`）、duration 整數除法三階、
 * context-size M/k 門檻、lines-changed、pr/repo 皆為 §格式化對等規則
 * 的 jq 端鏡像；SP-5 §6 實測 cost idiom byte-exact。
 */
function jqFormatSuffix(format: FormatKind, variant: string | undefined): string {
  switch (format) {
    case 'text':
      return ''
    case 'path':
      if (variant === 'basename') {
        // JS `p.split(/[\\/]+/).filter(x=>x!=='')` 的 jq 鏡像；全分隔 → 原值。
        // 分隔 regex 需四層跳脫：JS `\\\\\\\\`（8）→ .sh 字面 `\\\\`（4）→ jq
        // 字串解為 `\\`（2）→ oniguruma char-class `[/\\]` 收兩字元（`/`／`\`）。
        // 三層（.sh `\\`）會被 jq 解成 `[/\]`，`]` 遭跳脫 → char-class 不收口
        // （"premature end of char-class"）→ jq 出錯、段死。
        return ' | . as $p | ($p | split("[/\\\\\\\\]+"; "")) | map(select(. != "")) | if length > 0 then .[-1] else $p end'
      }
      if (variant === 'tilde') {
        // home 為空 → 原值；相等 → "~"；前綴（/ 或 \）→ "~"+尾段（jq slice 以
        // codepoint 計，ASCII home 與 JS UTF-16 一致；astral home 為已知邊界）。
        return ' | . as $p | (if $home == "" then $p elif $p == $home then "~" elif ($p | startswith($home + "/")) or ($p | startswith($home + "\\\\")) then "~" + $p[($home | length):] else $p end)'
      }
      return '' // full：原值
    case 'cost':
      // $⌊usd×10⁴⌋ 插點、4 位補尾零、負值 clamp 0（§格式化對等規則；SP-5 §6）。
      return ' | (. * 10000 | floor) | (if . < 0 then 0 else . end) | ("$" + (. / 10000 | floor | tostring) + "." + ((. % 10000 + 10000) | tostring | .[1:]))'
    case 'duration':
      return ' | (. / 3600000 | floor) as $h | ((. / 60000 | floor) % 60) as $m | ((. / 1000 | floor) % 60) as $s | if $h > 0 then "\\($h)h\\($m)m" elif $m > 0 then "\\($m)m\\($s)s" else "\\($s)s" end'
    case 'context-size':
      return ' | (.total_input_tokens + .total_output_tokens) | if . >= 1000000 then ((. / 1000000 | floor | tostring) + "M") else ((. / 1000 | floor | tostring) + "k") end'
    case 'lines-changed':
      return ' | ("+" + (.total_lines_added | tostring) + "/-" + (.total_lines_removed | tostring))'
    case 'flag':
      // `// empty` 已剔 false/null；存活者恆 true → "on"（thinking）。
      return ' | "on"'
    case 'pr':
      return ' | ("#" + (.number | tostring))'
    case 'repo':
      return ' | (.owner + "/" + .name)'
    case 'percentage':
    case 'dirty':
    case 'clock':
    case 'tokens':
    case 'reset-countdown-5h':
    case 'reset-countdown-7d':
      // tokens／reset-countdown-*（T4.3）比照 percentage／dirty／clock 的既有
      // 先例：不走 `// empty${suffix}` 的 hide/empty 組合——tokens 為 dash
      // 政策（emitOther dash 分支，見 emitSegment 尾段）、reset-countdown-*
      // 需通用 expiresAtPath 死值規則＋S2 now idiom＋localtime|strftime（時間
      // 格式化 idiom 見 nowAndR 檔頭）的專屬全 jq pipeline
      // （jqResetCountdown5h／jqResetCountdown7d），皆在 emitSegment 攔截、
      // 不呼叫本函式。
      throw new TypeError(
        `jqFormatSuffix 不處理 ${format}（dash／shell-out／reset-countdown 另處理）`,
      )
  }
}

/**
 * tokens 縮寫 jq 鏡像（T4.3；resolve.ts formatTokens 同構，全 floor，禁
 * Math.round）：`.`＝已知存活主值（呼叫端先過 `// "--"` 分流 null）。
 * n<1000 原樣 tostring；否則 ⌊n/100⌋ 插小數點取一位＋'k'（僅 k 檔，不升
 * M——與 formatTokens 同語意）。
 */
const TOKENS_JQ_FORMAT =
  'if . < 1000 then tostring else ' +
  '((. / 100 | floor) as $s | (($s / 10 | floor | tostring) + "." + (($s % 10) | tostring) + "k")) end'

/**
 * reset-5h 倒數全 jq pipeline（FormatKind 'reset-countdown-5h'；T4.3，
 * 契約 12＋sp2/REPORT.md §3 idiom＋sp6/REPORT.md 同機 oracle 定案；
 * (internal design doc) 修正 nowAndR 括號與時間格式化 idiom）：
 * `$now`＝S2 idiom（`STATUSLINE_NOW_EPOCH` 合法整數優先，否則 jq
 * `now|floor`；非數字靜默 fallback，不硬錯，exit-0 不變量）。通用
 * expiresAtPath 死值規則（resolve.ts resolveSegment 同構、零 id
 * 特判）：resets_at 非 number 或 `now>=resets_at` → `empty`（整段剔除，
 * 沿既有 `[ -n "$v" ]` 判定）；否則依 resolve.ts formatResetCountdown5h
 * 兩階梯格式化（全 floor）。HH:MM 用 jq `localtime | strftime("%H:%M")`
 * （同機同 TZ，見 nowAndR 檔頭 idiom 依據）。`↺`＝U+21BA UTF-8 字面（sp7
 * 真機驗證可用）。
 */
// M6 T6.2：`$now`／`$r` 綁定前綴＋通用死值判定抽為共用骨架——
// jqResetCountdown5h/7d（整段死值＝`empty`）與下方 jqResetSuffix5h/7d
// （後綴死值＝`''`，C3 新增）共用同一骨架，僅死活分支的產出相異（見
// jqResetSuffix5h/7d 檔頭差異註解）。純字串組裝、抽出後兩既有函式輸出
// byte-identical（emit-bash.test.ts『倒數段』結構斷言沿用不動）。
//
// (internal design doc)（2026-07-18）單步定位修正：`$now` 綁定式
// 外層加一層括號——`((A // B)) as $now`，A＝`env.STATUSLINE_NOW_EPOCH //
// empty | tonumber?`、B＝`now | floor`。根因（取代 HOTFIX.md 原「strflocaltime
// 拒收 number」假說，該假說已由本機 jq 1.7.1 逐段隔離測試證偽——
// `strflocaltime`／`localtime | strftime` 兩者在 1.7.1、1.8.1 對 number
// 輸入行為一致，並非本 bug 根因）：jq 1.7.x 對「`A // B as $x | BODY`」
// 的運算子優先序判定與 jq 1.8.x 不同——1.8.x 綁 `(A // B) as $x | BODY`，
// 1.7.x 誤綁 `A // (B as $x | BODY)`（`as...|...` 被併入 `//` 右運算元）。
// 本 idiom 恆有 `STATUSLINE_NOW_EPOCH`（byte-exact 測試／部分正式呼叫端）
// 設定時，A 產出單一 truthy number，1.7.x 因此讓 `//` 短路直接輸出 A 本身
// （即 `$now` 之值），B 連同其後整條 `as $r | if RESET_DEAD_COND then …
// else …` 死值判定與格式化管線**完全未被求值**——此即 CI 紅／黃金檔全數
// 退化為原始 epoch 整數字串的確切機制（多案例最終落地 raw 值恰為
// `$now`，肉眼易與 `resets_at` 混淆，故 HOTFIX.md 原敘述以「resets_at
// epoch」概括）。外層括號令兩版本皆綁 `(A // B) as $now`，消弭歧義、
// 兩版輸出 byte-identical（含 null／expired 死值分支——一旦不再被短路，
// 既有 `RESET_DEAD_COND` 判定即在兩版皆正確產出 `empty`／`''`，死值分支
// 本身結構無需另外改動）。
function nowAndR(jqPath: string): string {
  return (
    '((env.STATUSLINE_NOW_EPOCH // empty | tonumber?) // (now | floor)) as $now | ' +
    `(${jqPath}) as $r | `
  )
}

/** resets_at 通用死值判定（非 number 或已過期）；四函式共用同一判定式。 */
const RESET_DEAD_COND = '(($r | type) != "number") or ($now >= $r)'

function jqResetCountdown5h(jqPath: string): string {
  return (
    nowAndR(jqPath) +
    `if ${RESET_DEAD_COND} then empty else ` +
    '($r - $now) as $diff | ($r | localtime | strftime("%H:%M")) as $clock | ' +
    'if $diff >= 3600 then "↺ " + (($diff / 3600 | floor) | tostring) + "h (" + $clock + ")" ' +
    'else "↺ " + (($diff / 60 | floor) | tostring) + "m (" + $clock + ")" end end'
  )
}

/**
 * reset-7d 倒數全 jq pipeline（FormatKind 'reset-countdown-7d'；T4.3；
 * 同上規則，resolve.ts formatResetCountdown7d 兩階梯：`diff≥86400→"↺ Xd
 * (…)"`、否則`"↺ XhYm (…)"`；`MM/DD HH:MM` 由 `localtime | strftime("%m/%d
 * %H:%M")` 零填直出（jq 1.6+ 通用 idiom，見 nowAndR 檔頭修正說明）。
 */
function jqResetCountdown7d(jqPath: string): string {
  return (
    nowAndR(jqPath) +
    `if ${RESET_DEAD_COND} then empty else ` +
    '($r - $now) as $diff | ($r | localtime | strftime("%m/%d %H:%M")) as $stamp | ' +
    'if $diff >= 86400 then "↺ " + (($diff / 86400 | floor) | tostring) + "d (" + $stamp + ")" ' +
    'else "↺ " + (($diff / 3600 | floor) | tostring) + "h" + ' +
    '((($diff % 3600) / 60 | floor) | tostring) + "m (" + $stamp + ")" end end'
  )
}

/**
 * rate-X `percent-reset` 變體後綴倒數 pipeline（M6 C3，2026-07-14 拍板；
 * `jqResetCountdown5h` 姊妹版）——**差異**：死值（非 number／已過期）→
 * 空字串 `''`（不用 `empty`——`empty` 屬 jqResetCountdown5h/7d 的整段死值
 * 語意，若誤用會令呼叫端 `sfx=$(jq ...)` 之外層若恰好是唯一輸出時連帶
 * 消失一整行輸出；此處 `sfx` 為獨立變數，語意上更精確地表達「只剔後綴、
 * rate 段主值 `$v` 仍存活」，避免與整段死值 pipeline 混淆複用）。存活分支
 * 較 `jqResetCountdown5h` 多一枚前導空格（比照 resolve.ts `resetsAtSuffix`
 * 的 `' ' + countdown`），供呼叫端 `"$v$sfx"` 直接串接、不需另補空格判斷。
 */
function jqResetSuffix5h(jqPath: string): string {
  return (
    nowAndR(jqPath) +
    `if ${RESET_DEAD_COND} then "" else ` +
    '($r - $now) as $diff | ($r | localtime | strftime("%H:%M")) as $clock | ' +
    'if $diff >= 3600 then " ↺ " + (($diff / 3600 | floor) | tostring) + "h (" + $clock + ")" ' +
    'else " ↺ " + (($diff / 60 | floor) | tostring) + "m (" + $clock + ")" end end'
  )
}

/** 同上（rate-7d 版；`jqResetCountdown7d` 姊妹版，差異同 jqResetSuffix5h 檔頭）。 */
function jqResetSuffix7d(jqPath: string): string {
  return (
    nowAndR(jqPath) +
    `if ${RESET_DEAD_COND} then "" else ` +
    '($r - $now) as $diff | ($r | localtime | strftime("%m/%d %H:%M")) as $stamp | ' +
    'if $diff >= 86400 then " ↺ " + (($diff / 86400 | floor) | tostring) + "d (" + $stamp + ")" ' +
    'else " ↺ " + (($diff / 3600 | floor) | tostring) + "h" + ' +
    '((($diff % 3600) / 60 | floor) | tostring) + "m (" + $stamp + ")" end end'
  )
}

// ── 桶陣列預算（emit 期；執行期只索引，D2） ──

/** powerline 閾值：bg 尾陣列＋成對 auto-fg 參數陣列（fgOverride 存在時全桶用之）。 */
function powerlineBuckets(rule: ThresholdRule, fgOverride: ColorSpec | undefined): {
  bg: string[]
  fg: string[]
} {
  return {
    bg: rule.buckets.map(sgrTail),
    fg: autoFgBuckets(rule, fgOverride).map(fgParams),
  }
}

/** plain 閾值：桶色作 fg 參數陣列（plain 閾值套 fg，不套 bg）。 */
function plainBucketFg(rule: ThresholdRule): string[] {
  return rule.buckets.map(fgParams)
}

// ── auto 配色執行期查表（T4.3；PLAN Rev4 §3／§4；resolve.ts
// expandSegmentColor 之 bash 鏡像；emit-ps1.ts MODEL_PALETTE／EFFORT_PALETTE
// 同值同構複本——resolve.ts modelPaletteIndex／effortPaletteIndex 未
// export，兩 emitter 各自持一份，三後端數值以此契約段落為單一事實來源） ──

/** model 色票：`pattern:null`＝收尾預設分支（bash case `*`，大小寫敏感前綴 glob）。 */
const MODEL_PALETTE: ReadonlyArray<{ pattern: string | null; index: number }> = [
  { pattern: 'claude-fable-*', index: 214 },
  { pattern: 'claude-opus-*', index: 135 },
  { pattern: 'claude-haiku-*', index: 2 },
  { pattern: null, index: 6 },
]

/** effort 色票：bash case 對字面精確比對（無 glob 字元，天然大小寫敏感）。 */
const EFFORT_PALETTE: ReadonlyArray<{ pattern: string | null; index: number }> = [
  { pattern: 'low', index: 3 },
  { pattern: 'medium', index: 2 },
  { pattern: 'high', index: 4 },
  { pattern: 'xhigh', index: 5 },
  { pattern: 'max', index: 15 },
  { pattern: null, index: 9 },
]

interface AutoBinding {
  /** bash 變數名（不含 `$`）：段主色本身 fg SGR 參數。 */
  fgVar: string
  /** bash 變數名：段主色 bg 尾（powerline bg／箭頭交接用）。 */
  tailVar: string
  /** bash 變數名：autoFg(段主色) 的 fg SGR 參數（powerline 無 fgOverride 時用）。 */
  autoFgVar: string
  /** 段區塊最前需接的查表陳述式（讀 `$input`，故不可如 threshold 陣列般提前印於檔首）。 */
  setupLines: string[]
}

/**
 * `seg.color.kind==='auto'` 段的執行期查表區塊（T4.3）：比對來源＝
 * `descriptor.autoColor.key`（缺省用主值 jqPath 本身，沿 resolve.ts
 * `expandSegmentColor` 同一 fallback 規則）。bash `case` glob 前綴天然
 * 大小寫敏感（model palette）；effort 為精確字面比對，同構。emit 期為
 * 每個色票分支預算三值（本身 fg／bg 尾／autoFg 對比 fg，皆呼叫
 * production color.ts 函式），執行期只做一次 case 分派（零亮度數學，
 * D2 同構）。未帶 `autoColor` 的 descriptor 呼叫本函式＝programmer
 * error（config 應先經 deserializeConfig 清洗），比照 resolve.ts 同語意
 * 拋 TypeError。
 */
function emitAutoBinding(descriptor: SegmentDescriptor): AutoBinding {
  const autoColor = descriptor.autoColor
  if (autoColor === undefined) {
    throw new TypeError(
      `segment ${descriptor.id} 無 autoColor 通道卻收到 auto 色（config 應先經 deserializeConfig 清洗）`,
    )
  }
  const keyJqPath = autoColor.key !== undefined ? autoColor.key.jqPath : descriptor.jqPath
  const branches = autoColor.palette === 'model' ? MODEL_PALETTE : EFFORT_PALETTE
  const lines: string[] = []
  lines.push(`ackey=$(jq -r ${bashSingleQuote(`${keyJqPath} // empty`)} <<<"$input")`)
  lines.push('case "$ackey" in')
  for (const b of branches) {
    const spec: ColorSpec = { kind: 'ansi256', index: b.index }
    const pattern = b.pattern === null ? '*' : b.pattern
    lines.push(
      `  ${pattern}) acfg=${sgrLit(fgParams(spec))}; actail=${sgrLit(sgrTail(spec))}; ` +
        `acautofg=${sgrLit(fgParams(autoFg(spec)))} ;;`,
    )
  }
  lines.push('esac')
  return { fgVar: 'acfg', tailVar: 'actail', autoFgVar: 'acautofg', setupLines: lines }
}

/**
 * always／conditional 分支專用段色解析（T4.3；auto 真展開落點——bar／
 * shell-out／percentage 皆與 auto 互斥（`autoEligibleIds` 僅 model／
 * effort，二者皆 always／conditional 類），故此為 auto 唯一可達分支）：
 * `seg.color.kind==='auto'` → 執行期 case 查表（`emitAutoBinding`）覆寫
 * fg／bg 尾（bash 變數引用取代 emit 期靜態字面）；否則沿既有 emit 期
 * 靜態公式（與頂層 `mainFg`／`mainTail` 同源，非 auto 段 byte-exact
 * 不變）。
 */
function generalSegmentColor(
  seg: SegmentConfig,
  descriptor: SegmentDescriptor,
  em: Emitter,
): { setupLines: string[]; fg: string; tail: string } {
  if (seg.color.kind !== 'auto') {
    const fg = em.mode === 'powerline' ? powerlineMainFg(seg) : fgParams(seg.color)
    const tail = em.mode === 'powerline' ? sgrLit(sgrTail(seg.color)) : '1'
    return { setupLines: [], fg: sgrLit(fg), tail }
  }
  const binding = emitAutoBinding(descriptor)
  const fg =
    em.mode === 'powerline'
      ? seg.fgOverride !== undefined
        ? sgrLit(fgParams(seg.fgOverride))
        : `"$${binding.autoFgVar}"`
      : `"$${binding.fgVar}"`
  const tail = em.mode === 'powerline' ? `"$${binding.tailVar}"` : '1'
  return { setupLines: binding.setupLines, fg, tail }
}

// ── 段內 head（prefix＋icon glyph；resolve composition 同源） ──

function segmentHead(seg: SegmentConfig, descriptor: SegmentDescriptor): string {
  const prefix = seg.prefix ?? ''
  const glyph = seg.icon ? `${descriptor.icon.glyph} ` : ''
  return prefix + glyph
}

// ── 單段 emission ──

interface Emitter {
  mode: BuilderConfig['mode']
  /** D1 gating：powerline 模式下 `config.powerlineArrow` 之值；plain 模式忽略。 */
  powerlineArrow: boolean
}

/** D1 padding：powerline 模式且 `powerlineArrow=false` → 每段 value 尾綴一格空白；否則 ''。 */
function valuePad(em: Emitter): string {
  return em.mode === 'powerline' && !em.powerlineArrow ? ' ' : ''
}

/**
 * 存活 push 一列（依 mode 決定平行陣列）。dynamic：value 在 `$v`；靜態則
 * 直接給 textExpr。`suffix`＝多列陣列變數隔離（T3.1；單列 `''` 與改動前
 * 變數名逐位元組相同，多列 `_N` 對應 groupByRow 壓縮後的列序）。
 */
function pushLine(
  em: Emitter,
  textExpr: string,
  fg: string,
  bgOrSegstart: string,
  rowSuffix: string,
): string {
  return em.mode === 'powerline'
    ? `texts${rowSuffix}+=(${textExpr}); fgs${rowSuffix}+=(${fg}); bgs${rowSuffix}+=(${bgOrSegstart})`
    : `texts${rowSuffix}+=(${textExpr}); fgs${rowSuffix}+=(${fg}); segstart${rowSuffix}+=(${bgOrSegstart})`
}

/**
 * head 非空 → `'<head>'<valueRef>`；head 空 → `<valueRef>`。valueRef 呼叫端
 * 給定（D1：powerline 模式且 `powerlineArrow=false` 時已內含尾綴 pad）。
 */
function textDynamic(headLit: string, valueRef: string): string {
  return headLit === '' ? valueRef : `${headLit}${valueRef}`
}

/**
 * bar 段（percentage 類，`seg.bar===true`；T4.3；sp4/REPORT.md 41-案
 * byte-verified recipe；M6 T6.2 C2 修正）：**不論主值死活恆 4-run**
 * （run1=head、run2=filled 桶色、run3=empty default 色、run4=
 * `' '+bval+suffix+pad` 桶色；`threshold===undefined` → filled／value
 * 退段主色）。`bn`（填格數）／`bval`（value 文字部）為死活兩態唯一差異
 * 點：主值存活→`pct%`＋依 threshold 查桶（`$v` 非空時）；主值 null（dash）
 * →`bn=0`、`bval=NA_TEXT`（M6 C1）、bucket 退段主色（isDash 時 oracle
 * threshold 恆為 null，此處以 `[ -n "$v" ]` 執行期判定同構複刻，零額外
 * TS 分支）。bash-plain＝4 元素逐一 push（segstart 1/0/0/0，既有
 * `joinPlain` 迴圈零改動）。bash-powerline＝併單一累加器元素：run1 的
 * fg/bg 進 `fgs[i]`/`bgs[i]`（供箭頭交接、裸文字不烘色碼，**停用
 * fgOverride**——恆用 autoFg／segColor，不論死活）；run2–4 各自完整烘
 * `reset+fg+bg+text` 追加進 text 尾——sp4 精確配方（run1 若也全烘會與
 * join 迴圈自己補的 `reset+fg1+bg1` 重複，多出位元組，破壞 byte-exact）。
 * resets 後綴（percent-reset variant，M6 C3 升級倒數形）與主值死活正交，
 * 恆附於 run4 尾（`jqResetSuffix5h/7d`，kind 由 `descriptor.resetsAt.
 * countdown` 驅動，零 id 特判）。bar 與 auto 互斥（`barEligibleIds`／
 * `autoEligibleIds` 不相交，config 清洗保證），故本函式不處理 auto
 * （`segmentColorPlaceholder` 恆 passthrough）。
 */
function emitBarSegment(
  seg: SegmentConfig,
  descriptor: SegmentDescriptor,
  em: Emitter,
  rowSuffix: string,
  headLit: string,
  pad: string,
): string[] {
  const lines: string[] = []
  const segColorSpec = segmentColorPlaceholder(seg.color)
  const mainFgLit = sgrLit(fgParams(segColorSpec))
  const mainTailLit = sgrLit(sgrTail(segColorSpec))
  const mainTailRaw = sgrTail(segColorSpec)
  const autoFgLit = sgrLit(fgParams(autoFg(segColorSpec)))
  const headTextExpr = headLit === '' ? "''" : headLit

  const hasResets = descriptor.resetsAt !== undefined && seg.variant === 'percent-reset'
  lines.push(`v=$(jq -r ${bashSingleQuote(`${descriptor.jqPath} // empty`)} <<<"$input")`)
  let sfxRef = ''
  if (hasResets) {
    const kind = descriptor.resetsAt!.countdown
    const sfxProg =
      kind === 'reset-countdown-5h'
        ? jqResetSuffix5h(descriptor.resetsAt!.jqPath)
        : jqResetSuffix7d(descriptor.resetsAt!.jqPath)
    lines.push(`sfx=$(jq -r ${bashSingleQuote(sfxProg)} <<<"$input")`)
    sfxRef = '$sfx'
  }

  // M6 C2（2026-07-14 拍板；撤除舊「isDash → 整段退單 run」分支）：`bn`
  // （填格數）／`bval`（value 文字部）為死活兩態僅有差異點，下方 filled／
  // empty／bfg／run4 組裝與 push 皆不論死活共用同一路徑（零重複結構）。
  lines.push(`if [ -z "$v" ]; then`)
  lines.push(`  bn=0`)
  lines.push(`  bval=${bashSingleQuote(NA_TEXT)}`) // M6 C1：百分比 dash → NA_TEXT。
  lines.push(`else`)
  lines.push(`  pct=$(jq -r ${bashSingleQuote(`${descriptor.jqPath} | floor | tostring`)} <<<"$input")`)
  const fillProg = `${descriptor.jqPath} | (. / 5 | floor) | if . > ${BAR_CELL_COUNT} then ${BAR_CELL_COUNT} elif . < 0 then 0 else . end`
  lines.push(`  bn=$(jq -r ${bashSingleQuote(fillProg)} <<<"$input")`)
  lines.push(`  bval="$pct%"`)
  lines.push(`fi`)

  lines.push(`filled=''`)
  lines.push(`for ((bi = 0; bi < bn; bi++)); do filled+='${BAR_FILLED_CHAR}'; done`)
  lines.push(`empty=''`)
  lines.push(`for ((bi = bn; bi < ${BAR_CELL_COUNT}; bi++)); do empty+='${BAR_EMPTY_CHAR}'; done`)

  // 桶色（filled／value run 之 fg）：主值存活（"$v" 非空）且 threshold 定義
  // → 查桶（`bfg` 執行期 array 索引）；否則（含 null——M6 C2：isDash 時
  // oracle threshold 恆為 null，此處以 `[ -n "$v" ]` 同構複刻，零額外 TS
  // 分支）退段主色（emit 期靜態字面，仍指派進 `bfg` 統一下游引用）。
  if (seg.threshold !== undefined) {
    lines.push(bashArray('tf', plainBucketFg(seg.threshold)))
    const idxProg = `${descriptor.jqPath} | (. / 10 | floor) | if . > 9 then 9 elif . < 0 then 0 else . end`
    lines.push(`if [ -n "$v" ]; then`)
    lines.push(`  idx=$(jq -r ${bashSingleQuote(idxProg)} <<<"$input")`)
    lines.push(`  bfg="\${tf[$idx]}"`)
    lines.push(`else`)
    lines.push(`  bfg=${mainFgLit}`)
    lines.push(`fi`)
  } else {
    lines.push(`bfg=${mainFgLit}`)
  }

  // run4＝' '+bval(pct%／NA_TEXT)+後綴+pad 單一運算式（M6 C1/C2/C3 合流；
  // percent-reset 後綴與 powerline-noarrow 右 padding 一律併入，沿既有
  // 「後綴附於 value 部」規則）。
  const run4Text = `" $bval${sfxRef}${pad}"`

  if (em.mode === 'powerline') {
    // run1 head → fgs[i]/bgs[i]（裸文字）；run2-4 各自完整烘 reset+fg+bg+text。
    lines.push(`btext=${headTextExpr}`)
    lines.push(`btext+="\${ESC}[0m"`)
    lines.push(`if [ -n "$bfg" ]; then btext+="\${ESC}[\${bfg}m"; fi`)
    if (mainTailRaw !== '') lines.push(`btext+="\${ESC}[48;${mainTailRaw}m"`)
    lines.push(`btext+="$filled"`)
    lines.push(`btext+="\${ESC}[0m"`)
    if (mainTailRaw !== '') lines.push(`btext+="\${ESC}[48;${mainTailRaw}m"`)
    lines.push(`btext+="$empty"`)
    lines.push(`btext+="\${ESC}[0m"`)
    lines.push(`if [ -n "$bfg" ]; then btext+="\${ESC}[\${bfg}m"; fi`)
    if (mainTailRaw !== '') lines.push(`btext+="\${ESC}[48;${mainTailRaw}m"`)
    lines.push(`btext+=${run4Text}`)
    lines.push(pushLine(em, '"$btext"', autoFgLit, mainTailLit, rowSuffix))
  } else {
    // plain：4 元素逐一 push（segstart 1/0/0/0）；run3 恆無 fg（default 色）。
    lines.push(pushLine(em, headTextExpr, mainFgLit, '1', rowSuffix))
    lines.push(pushLine(em, '"$filled"', '"$bfg"', '0', rowSuffix))
    lines.push(pushLine(em, '"$empty"', sgrLit(''), '0', rowSuffix))
    lines.push(pushLine(em, run4Text, '"$bfg"', '0', rowSuffix))
  }

  return lines
}

/**
 * `rowSuffix`＝多列陣列變數隔離（T3.1；見 pushLine）。命名避開既有區域
 * 變數 `suffix`（jqFormatSuffix 之 jq 尾段，見下方 always／conditional
 * 分支）——兩者語意無關，同名會遮蔽（shadow）本參數。
 */
function emitSegment(
  seg: SegmentConfig,
  descriptor: SegmentDescriptor,
  em: Emitter,
  rowSuffix: string,
): string[] {
  const lines: string[] = []
  const head = segmentHead(seg, descriptor)
  const headLit = head === '' ? '' : bashSingleQuote(head)
  // M3 邊界（08-PLAN Rev 4 §3）：同上，auto 色票展開屬 M4 T4.3。
  const mainFg = em.mode === 'powerline' ? powerlineMainFg(seg) : fgParams(segmentColorPlaceholder(seg.color))
  const mainBg = sgrTail(segmentColorPlaceholder(seg.color))
  // 段主色的 push 尾參（powerline：bg 尾；plain：segstart）。
  const mainTail = em.mode === 'powerline' ? sgrLit(mainBg) : '1'
  // D1 padding：powerline＋powerlineArrow=false → 每段 value 尾綴一格空白。
  const pad = valuePad(em)

  lines.push(`# ${descriptor.id}`)

  if (descriptor.category === 'shell-out') {
    if (descriptor.shellOut === undefined) {
      throw new TypeError(`shell-out 段缺 shellOut：${descriptor.id}`)
    }
    // 防禦包裹（契約 9）：非 git 目錄／date 失敗皆不傳播。
    lines.push(`v=$(${descriptor.shellOut.bash} 2>/dev/null || true)`)
    lines.push(`if [ -n "$v" ]; then`)
    // dirty＝存活即 '*'（$v 僅作非空判定）；其餘＝head+值。
    const textExpr =
      descriptor.format === 'dirty'
        ? bashSingleQuote(head + '*' + pad)
        : textDynamic(headLit, `"$v${pad}"`)
    lines.push(`  ${pushLine(em, textExpr, sgrLit(mainFg), mainTail, rowSuffix)}`)
    lines.push(`fi`)
    return lines
  }

  if (descriptor.category === 'percentage') {
    if (seg.bar === true) {
      lines.push(...emitBarSegment(seg, descriptor, em, rowSuffix, headLit, pad))
      return lines
    }
    // dash 政策（M6 C1，2026-07-14 拍板：百分比類 null → NA_TEXT '(n/a)'
    // 取代 DASH_TEXT——本分支已限定 `category === 'percentage'`，閘門走
    // category、零 id 特判；token-in/out（category='always'）走下方
    // always/conditional 分支的獨立 dashProg，DASH_TEXT 不受影響）。不套
    // 閾值色（沿契約 3）。
    const dashProg = `${descriptor.jqPath} // ${jqStrLit(NA_TEXT)} | if type == "number" then (floor | tostring) + "%" else . end`
    lines.push(`v=$(jq -r ${bashSingleQuote(dashProg)} <<<"$input")`)

    // resets 後綴（M6 C3，2026-07-14 拍板；契約 12 升級版）：`variant
    // 'percent-reset'` 附倒數字串，kind 由 `descriptor.resetsAt.countdown`
    // 目錄驅動（零 id 特判，rate-5h/rate-7d 各掛對應 kind）。附於 value 部、
    // 與主值 dash 正交（`(n/a) ↺ 2h (16:00)` 亦合法），閾值分裂時隨值色。
    // `jqResetSuffix5h/7d` 死值（非 number／已過期）→ `''`（只剔後綴，非
    // `jqResetCountdown5h/7d` 的 `empty`——那版供獨立 reset-5h/7d 段整段
    // 死值判定，語意不同，見該二函式檔頭差異註解）。與 emit-ps1 的
    // Format-ResetsAt 對照同構。
    const hasResets = descriptor.resetsAt !== undefined && seg.variant === 'percent-reset'
    // D1 padding 併入 valueRef（見上）：pad 恆位於 value（＋後綴）尾端。
    let valueRef = `"$v${pad}"`
    if (hasResets) {
      const kind = descriptor.resetsAt!.countdown
      const sfxProg =
        kind === 'reset-countdown-5h'
          ? jqResetSuffix5h(descriptor.resetsAt!.jqPath)
          : jqResetSuffix7d(descriptor.resetsAt!.jqPath)
      lines.push(`sfx=$(jq -r ${bashSingleQuote(sfxProg)} <<<"$input")`)
      valueRef = `"$v$sfx${pad}"`
    }

    if (seg.threshold === undefined) {
      // 無閾值：單 run 主色（dash 與數值同色）。
      lines.push(pushLine(em, textDynamic(headLit, valueRef), sgrLit(mainFg), mainTail, rowSuffix))
      return lines
    }

    // 有閾值：桶索引 jq（-1＝dash 哨值，bash 分流零數學）。
    const idxProg = `${descriptor.jqPath} | if type == "number" then ((. / 10 | floor) | (if . > 9 then 9 elif . < 0 then 0 else . end)) else -1 end`
    lines.push(`idx=$(jq -r ${bashSingleQuote(idxProg)} <<<"$input")`)

    if (em.mode === 'powerline') {
      const { bg, fg } = powerlineBuckets(seg.threshold, seg.fgOverride)
      lines.push(bashArray('tb', bg))
      lines.push(bashArray('tf', fg))
      lines.push(`if [ "$idx" = "-1" ]; then`)
      lines.push(`  ${pushLine(em, textDynamic(headLit, valueRef), sgrLit(mainFg), sgrLit(mainBg), rowSuffix)}`)
      lines.push(`else`)
      lines.push(
        `  ${pushLine(em, textDynamic(headLit, valueRef), '"${tf[$idx]}"', '"${tb[$idx]}"', rowSuffix)}`,
      )
      lines.push(`fi`)
      return lines
    }

    // plain：桶色套 fg。head 非空且數值 → 分裂兩 run（head 主色、value 桶色）。
    lines.push(bashArray('tf', plainBucketFg(seg.threshold)))
    if (head !== '') {
      lines.push(`if [ "$idx" = "-1" ]; then`)
      lines.push(`  ${pushLine(em, textDynamic(headLit, valueRef), sgrLit(mainFg), '1', rowSuffix)}`)
      lines.push(`else`)
      lines.push(`  ${pushLine(em, headLit, sgrLit(mainFg), '1', rowSuffix)}`)
      lines.push(`  ${pushLine(em, valueRef, '"${tf[$idx]}"', '0', rowSuffix)}`)
      lines.push(`fi`)
      return lines
    }
    lines.push(`if [ "$idx" = "-1" ]; then`)
    lines.push(`  ${pushLine(em, valueRef, sgrLit(mainFg), '1', rowSuffix)}`)
    lines.push(`else`)
    lines.push(`  ${pushLine(em, valueRef, '"${tf[$idx]}"', '1', rowSuffix)}`)
    lines.push(`fi`)
    return lines
  }

  // always／conditional（emitOther 概念：nullPolicy 驅動 dash／hide／
  // empty；T4.3）。auto 真展開落點：seg.color.kind==='auto' 唯一可達此
  // 分支（bar／shell-out／percentage 與 auto 互斥），故色彩改由
  // `generalSegmentColor` 統一解析（非 auto 段沿頂層 mainFg／mainTail
  // 同一公式，byte-exact 不變）。
  const colorPlan = generalSegmentColor(seg, descriptor, em)
  lines.push(...colorPlan.setupLines)

  if (descriptor.nullPolicy === 'dash') {
    // dash 分支（現行僅 token-in／token-out）：null → '--'（存活、無格式，
    // 不套色—— dash 段本無閾值概念）；否則 tokens 縮寫 jq 鏡像（全 floor）。
    const dashProg = `${descriptor.jqPath} // "--" | if type == "number" then (${TOKENS_JQ_FORMAT}) else . end`
    lines.push(`v=$(jq -r ${bashSingleQuote(dashProg)} <<<"$input")`)
    lines.push(
      pushLine(em, textDynamic(headLit, `"$v${pad}"`), colorPlan.fg, colorPlan.tail, rowSuffix),
    )
    return lines
  }

  // hide／empty：jq `// empty`＋格式尾＋剔空。reset-countdown-* 走專屬全
  // jq pipeline（含通用 expiresAtPath 死值規則、S2 now idiom、
  // localtime|strftime（時間格式化 idiom 見 nowAndR 檔頭）；契約 12），
  // 其餘沿既有 jqFormatSuffix 鏈。
  const variant = seg.variant ?? defaultVariant(descriptor)
  const prog =
    descriptor.format === 'reset-countdown-5h'
      ? jqResetCountdown5h(descriptor.jqPath)
      : descriptor.format === 'reset-countdown-7d'
        ? jqResetCountdown7d(descriptor.jqPath)
        : `${descriptor.jqPath} // empty${jqFormatSuffix(descriptor.format, variant)}`
  const needsHome = descriptor.format === 'path' && variant === 'tilde'
  const argHome = needsHome ? '--arg home "$HOME" ' : ''
  lines.push(`v=$(jq -r ${argHome}${bashSingleQuote(prog)} <<<"$input")`)
  lines.push(`if [ -n "$v" ]; then`)
  lines.push(
    `  ${pushLine(em, textDynamic(headLit, `"$v${pad}"`), colorPlan.fg, colorPlan.tail, rowSuffix)}`,
  )
  lines.push(`fi`)
  return lines
}

// ── join 段（第二趟；oracle emission 規則的機械展開，.t23 §5） ──

/**
 * D1 gating：`powerlineArrow=false` → 不 emit 段間箭頭迴圈區塊、
 * `lastArrowCap` 全面無效（cap 區塊恆不 emit，與其值無關）；段本身的
 * padding 已在 emitSegment 併入 texts 陣列元素，本函式無需另處理。
 *
 * `rowSuffix`＝多列陣列變數隔離（T3.1）：所有讀寫的陣列／計數／輸出變數
 * （`texts`/`fgs`/`bgs`/`n`/`out`）皆綴上 `rowSuffix`；迴圈索引 `i` 維持
 * 不綴（純迴圈暫存，各列區塊各自循序執行、互不重疊，無需隔離）。
 * `rowSuffix=''` 產出逐位元組等同改動前寫法（M3 硬性驗收：單列 golden
 * bytes 不變）。
 */
function joinPowerline(lastArrowCap: boolean, powerlineArrow: boolean, rowSuffix: string): string[] {
  const textsVar = `texts${rowSuffix}`
  const fgsVar = `fgs${rowSuffix}`
  const bgsVar = `bgs${rowSuffix}`
  const outVar = `out${rowSuffix}`
  const nVar = `n${rowSuffix}`
  const lines = [`${outVar}=""`, `${nVar}=\${#${textsVar}[@]}`, `for ((i = 0; i < ${nVar}; i++)); do`]
  if (powerlineArrow) {
    lines.push(
      '  if [ "$i" -gt 0 ]; then',
      `    ${outVar}+="\${ESC}[0m"`,
      `    if [ -n "\${${bgsVar}[$((i - 1))]}" ]; then ${outVar}+="\${ESC}[38;\${${bgsVar}[$((i - 1))]}m"; fi`,
      `    if [ -n "\${${bgsVar}[$i]}" ]; then ${outVar}+="\${ESC}[48;\${${bgsVar}[$i]}m"; fi`,
      `    ${outVar}+="$ARROW"`,
      '  fi',
    )
  }
  lines.push(
    `  ${outVar}+="\${ESC}[0m"`,
    `  if [ -n "\${${fgsVar}[$i]}" ]; then ${outVar}+="\${ESC}[\${${fgsVar}[$i]}m"; fi`,
    `  if [ -n "\${${bgsVar}[$i]}" ]; then ${outVar}+="\${ESC}[48;\${${bgsVar}[$i]}m"; fi`,
    `  ${outVar}+="\${${textsVar}[$i]}"`,
    'done',
  )
  if (powerlineArrow && lastArrowCap) {
    // 收尾箭頭：fg=末段bg、bg 缺席＝對終端底色（Q1）。
    lines.push(
      `if [ "$${nVar}" -gt 0 ]; then`,
      `  ${outVar}+="\${ESC}[0m"`,
      `  if [ -n "\${${bgsVar}[$((${nVar} - 1))]}" ]; then ${outVar}+="\${ESC}[38;\${${bgsVar}[$((${nVar} - 1))]}m"; fi`,
      `  ${outVar}+="$ARROW"`,
      'fi',
    )
  }
  lines.push(`${outVar}+="\${ESC}[0m"`)
  return lines
}

/**
 * `rowSuffix`＝多列陣列變數隔離（T3.1；語意同 joinPowerline 之文件）。
 * `sepVar`＝分隔符變數名字面（T1.4，09-PLAN §D1 A-4；不含 `$`／`{}`）：
 * 呼叫端依「rowGroups 範圍內是否存在任一列覆寫」決定——無覆寫時三列皆
 * 傳 `'SEP'`（全域單一宣告，byte-exact fast path）；有覆寫時傳該列專屬
 * `` `SEP${rowSuffix}` ``（即令該列本身無覆寫，emitBash 主體仍會以退
 * 全域值宣告對應 `SEP_k`，見 rowSeparatorValue／hasAnyRowSeparatorOverride）。
 * 本函式僅消費變數名字面組字串，不判斷覆寫語意（單一事實來源在呼叫端）。
 */
function joinPlain(rowSuffix: string, sepVar: string): string[] {
  const textsVar = `texts${rowSuffix}`
  const fgsVar = `fgs${rowSuffix}`
  const segstartVar = `segstart${rowSuffix}`
  const outVar = `out${rowSuffix}`
  const nVar = `n${rowSuffix}`
  // 分隔符插於段首 run（segstart==1）之前、i>0、SEP 非空（無 leading/trailing/雙分隔）。
  return [
    `${outVar}=""`,
    `${nVar}=\${#${textsVar}[@]}`,
    `for ((i = 0; i < ${nVar}; i++)); do`,
    `  if [ "$i" -gt 0 ] && [ "\${${segstartVar}[$i]}" = "1" ] && [ -n "$${sepVar}" ]; then`,
    `    ${outVar}+="\${ESC}[0m\${${sepVar}}"`,
    '  fi',
    `  ${outVar}+="\${ESC}[0m"`,
    `  if [ -n "\${${fgsVar}[$i]}" ]; then ${outVar}+="\${ESC}[\${${fgsVar}[$i]}m"; fi`,
    `  ${outVar}+="\${${textsVar}[$i]}"`,
    'done',
    `${outVar}+="\${ESC}[0m"`,
  ]
}

// ── 多列分組（T3.1；emit 期，與 resolve() 對存活段分組後的渲染列序同構） ──

interface ResolvedSeg {
  seg: SegmentConfig
  descriptor: SegmentDescriptor
}

/**
 * 依分組鍵 `seg.row ?? 0` 對**全部已啟用段**分組（不論 runtime 存活與
 * 否——存活判定屬 runtime，emit 期只依 config 決定「有幾列、每列含哪些
 * 段」；runtime 空列過濾見 emitBash 多列分支）。分組鍵升冪排序後即列序
 * （與 resolve() 對存活段分組、`[...groups.keys()].sort()` 取渲染列序
 * 同一演算法，僅分組對象由「存活段」換成「emit 期已啟用段」）。列內維持
 * `resolved`（即 `config.segments` 篩已啟用）陣列既有序。回傳陣列長度
 * 0（無啟用段）或 1（全段同列，含未設 row 之預設 0）時，emitBash 走與
 * 改動前完全同構的扁平單列路徑。
 */
function groupByRow(resolved: readonly ResolvedSeg[]): ResolvedSeg[][] {
  const groups = new Map<number, ResolvedSeg[]>()
  for (const item of resolved) {
    const row = item.seg.row ?? 0
    const bucket = groups.get(row)
    if (bucket === undefined) groups.set(row, [item])
    else bucket.push(item)
  }
  const order = [...groups.keys()].sort((a, b) => a - b)
  return order.map((row) => groups.get(row)!)
}

// ── 逐列分隔符解析（T1.4，09-PLAN §D1 A-1／A-4：僅 plain 模式消費；
// powerline 零觸碰）──

/**
 * `rowSeparators[rowIndex]` 非 `null`／未定義 → 覆寫值；否則退全域
 * `config.separator`。索引基準＝**啟用列位**——即 `groupByRow` 的分組序
 * （呼叫端直接傳入該序的迴圈變數 `r`），與 config 契約文件（config.ts
 * `rowSeparators` 欄位註解）同一基準，**不需**額外映射（與 resolve 的
 * 「存活列→啟用位」映射不同，那是 T1.3 的事——emit 期只關心「有幾列、
 * 每列覆寫什麼」，不判定 runtime 存活）。
 */
function rowSeparatorValue(config: BuilderConfig, rowIndex: number): string {
  const override = config.rowSeparators?.[rowIndex]
  return (override ?? config.separator).value
}

/**
 * `rowGroups` 範圍內是否存在任一列覆寫（`rowSeparators` 全 `null`／
 * 缺席／越界 → `false`）。**no-override fast path 的唯一判準**：`false`
 * 時 SEP 宣告與 `joinPlain` 呼叫皆沿用改動前寫法（單一 `SEP=`、bare
 * `$SEP`），確保無覆寫 config 產出與現行逐位元組相同（golden 凍結
 * 前提）；`true` 時才觸發逐列 `SEP_k` 展開。
 */
function hasAnyRowSeparatorOverride(config: BuilderConfig, rowCount: number): boolean {
  if (config.rowSeparators === undefined) return false
  for (let k = 0; k < rowCount; k++) {
    if (config.rowSeparators[k] !== null && config.rowSeparators[k] !== undefined) return true
  }
  return false
}

// ── 產生器主體 ──

/**
 * BuilderConfig＋descriptor catalog → 自足 bash 腳本字串（UTF-8、LF、
 * 尾隨換行）。未知 segment id＝programmer error（config 應先經
 * deserializeConfig 對真 catalog 清洗）→ TypeError（對齊 resolve）。
 *
 * 多列（T3.1）：分組結果（groupByRow）≤1 列 → 扁平單列路徑（與改動前
 * 逐位元組相同）；≥2 列 → 四步執行期展開（逐列緩衝→runtime 空列過濾→
 * 存活列 LF 串接→零存活退單一 SGR reset，見檔頭文件）。
 */
export function emitBash(config: BuilderConfig, catalog: SegmentDescriptorCatalog): string {
  const enabled = config.segments.filter((seg) => seg.enabled)
  const resolved: ResolvedSeg[] = enabled.map((seg) => {
    const descriptor = catalog[seg.id]
    if (descriptor === undefined) {
      throw new TypeError(`未知 segment id：${seg.id}（config 應先經 deserializeConfig 清洗）`)
    }
    return { seg, descriptor }
  })
  const needsJq = resolved.some(({ descriptor }) => descriptor.category !== 'shell-out')
  const em: Emitter = { mode: config.mode, powerlineArrow: config.powerlineArrow }
  const rowGroups = groupByRow(resolved)
  // T1.4：有覆寫時逐列 SEP_k 展開（見下方宣告區塊與 joinPlain 呼叫點）；
  // 無覆寫時全程沿用改動前單一 SEP 寫法（fast path）。
  const hasRowSepOverride =
    config.mode === 'plain' && hasAnyRowSeparatorOverride(config, rowGroups.length)

  const out: string[] = []
  out.push('#!/usr/bin/env bash')
  out.push(`# Claude Code statusline（${config.mode} 模式）— 由 ClientKit statusline-builder 產生。`)
  out.push('# 讀取 stdin 的 session JSON、輸出單行狀態列；自足腳本，可置於')
  out.push('# ~/.claude/ 並於 settings.json 的 statusLine.command 指向之。')
  if (needsJq) out.push('# 需要 jq（https://jqlang.github.io/jq/）。')
  out.push('')
  // 契約 1：讀入。
  out.push('input=$(cat)')
  // 契約 2：jq 缺件守衛（僅在有 jq 消費段時 emit）。
  if (needsJq) {
    out.push('if ! command -v jq >/dev/null 2>&1; then')
    out.push(`  printf '%s' ${bashSingleQuote(JQ_MISSING_HINT)}`)
    out.push('  exit 0')
    out.push('fi')
  }
  out.push('')
  // 契約 7：ANSI 組碼常數。
  out.push("ESC=$'\\033'")
  // D1 gating：`ARROW=` 只在 powerline＋powerlineArrow=true 時 emit（false 時
  // 無段間箭頭、也無收尾 cap，變數本身無用武之地）。
  if (config.mode === 'powerline' && config.powerlineArrow) {
    out.push(`ARROW=${bashSingleQuote(POWERLINE_ARROW)}`)
  }
  if (config.mode === 'plain') {
    if (rowGroups.length <= 1) {
      // 單列（含 0 段空鏈）：沿用單一 `SEP`，值改綁列 0 覆寫（A-4「單列
      // 路徑 SEP 綁列 0 覆寫」）；無覆寫時即 `config.separator`，與改動
      // 前逐位元組相同（fast path）。
      out.push(`SEP=${bashSingleQuote(rowSeparatorValue(config, 0))}`)
    } else if (!hasRowSepOverride) {
      // 多列＋無覆寫：沿用改動前單一 SEP 宣告（fast path，byte-exact）。
      out.push(`SEP=${bashSingleQuote(config.separator.value)}`)
    } else {
      // 多列＋有覆寫：拆逐列 `SEP_k`（k＝啟用列位，與 rowSuffix `_${r}`
      // 同一數值，無需映射）；未覆寫的列亦宣告、退全域值，供 joinPlain
      // 統一以 `SEP${rowSuffix}` 引用。
      for (let r = 0; r < rowGroups.length; r++) {
        out.push(`SEP_${r}=${bashSingleQuote(rowSeparatorValue(config, r))}`)
      }
    }
  }
  out.push('')

  if (rowGroups.length <= 1) {
    // 單列（含 0 段空鏈）：與改動前完全同構的扁平結構（suffix=''）——M3
    // 硬性驗收：既有單列 golden bytes 不變，此分支逐字沿用改動前寫法。
    out.push('texts=()')
    out.push('fgs=()')
    if (config.mode === 'powerline') out.push('bgs=()')
    if (config.mode === 'plain') out.push('segstart=()')
    out.push('')
    out.push('# ── 段求值（第一趟：存活段 push） ──')
    for (const { seg, descriptor } of resolved) {
      out.push(...emitSegment(seg, descriptor, em, ''))
    }
    out.push('')
    out.push('# ── join（第二趟：逐 run 拼接） ──')
    out.push(
      ...(config.mode === 'powerline'
        ? joinPowerline(config.lastArrowCap, config.powerlineArrow, '')
        : joinPlain('', 'SEP')),
    )
  } else {
    // 多列：四步執行期展開。
    out.push('# ── 段求值（第一趟：逐列緩衝，emit 期依 row 分組） ──')
    for (let r = 0; r < rowGroups.length; r++) {
      const rowSuffix = `_${r}`
      out.push(`# -- row ${r} 緩衝 --`)
      out.push(`texts${rowSuffix}=()`)
      out.push(`fgs${rowSuffix}=()`)
      if (config.mode === 'powerline') out.push(`bgs${rowSuffix}=()`)
      if (config.mode === 'plain') out.push(`segstart${rowSuffix}=()`)
      for (const { seg, descriptor } of rowGroups[r]) {
        out.push(...emitSegment(seg, descriptor, em, rowSuffix))
      }
      out.push('')
    }
    out.push('# ── join（第二趟：逐列獨立 join，reset 恆在列尾） ──')
    for (let r = 0; r < rowGroups.length; r++) {
      const rowSuffix = `_${r}`
      out.push(`# -- row ${r} join --`)
      out.push(
        ...(config.mode === 'powerline'
          ? joinPowerline(config.lastArrowCap, config.powerlineArrow, rowSuffix)
          : joinPlain(rowSuffix, hasRowSepOverride ? `SEP${rowSuffix}` : 'SEP')),
      )
      out.push('')
    }
    out.push('# ── runtime 空列過濾＋存活列 LF 串接（零存活退單一 SGR reset） ──')
    out.push('outs=()')
    for (let r = 0; r < rowGroups.length; r++) {
      const rowSuffix = `_${r}`
      out.push(`if [ "$n${rowSuffix}" -gt 0 ]; then outs+=("$out${rowSuffix}"); fi`)
    }
    out.push('out=""')
    out.push('if [ "${#outs[@]}" -eq 0 ]; then')
    out.push('  out="${ESC}[0m"')
    out.push('else')
    out.push('  rn=${#outs[@]}')
    out.push('  for ((i = 0; i < rn; i++)); do')
    out.push(`    if [ "$i" -gt 0 ]; then out+=$'\\n'; fi`)
    out.push('    out+="${outs[$i]}"')
    out.push('  done')
    out.push('fi')
  }

  out.push('')
  // 契約 6：使用者文字不進格式位——$out 在引數位。契約 9：結尾顯式 exit 0。
  out.push(`printf '%s' "$out"`)
  out.push('exit 0')

  return `${out.join('\n')}\n`
}
