/**
 * S5-T1.3（(internal design doc) §D2 閾值機制／§型別契約）：
 * ThresholdRule 10-tuple（型別級恆長）、bucketIndex 上下界皆 clamp、
 * 4 套模板預填陣列（ansi256，取色與 color.ts 色立方／灰階公式一致）、
 * powerline 成對 auto-fg 陣列預算（D2：emit 期以 TS 亮度函式預算、
 * 執行期只索引零亮度數學，三後端亮度判定不可能分岔）。
 *
 * floor 取整落點分工（D2）：TS 端 Math.floor（本檔）、bash 端由 jq
 * 完成、ps1 [math]::Floor——公式同形 `max(0, min(floor(p/10), 9))`。
 *
 * 純函式、零 DOM import，node 可測。
 */
import { autoFg, type ColorSpec } from './color.js'

/** 閾值分桶數（恆 10；config.ts 桶數校正同源）。buckets[i] 覆蓋 [i*10,(i+1)*10)。 */
export const THRESHOLD_BUCKET_COUNT = 10

/** ColorSpec 10-tuple：型別級恆長保證（PLAN 型別契約）。 */
export type ThresholdBuckets = readonly [
  ColorSpec, ColorSpec, ColorSpec, ColorSpec, ColorSpec,
  ColorSpec, ColorSpec, ColorSpec, ColorSpec, ColorSpec,
]

export interface ThresholdRule {
  buckets: ThresholdBuckets
}

/**
 * 百分比 → 桶索引：`max(0, min(floor(p/10), 9))`——上下界皆 clamp
 * （p<0→0、p≥100→9，100 恰落 floor(10)→clamp 9）；小數不四捨五入
 * （9.99→0、10.0→1）。
 */
export function bucketIndex(p: number): number {
  const raw = Math.min(Math.floor(p / 10), THRESHOLD_BUCKET_COUNT - 1)
  // max(0, raw) 以比較式實作（>0 才取 raw：-0 歸正零、與 Math.max 同），
  // 順帶定義 NaN → 0（NaN 對 > 恆假）：null 百分比上游由 dash 政策擋下
  // （產生器契約 3，不套閾值色），此為型別外滲入時的防禦性定義，與
  // clampAnsi256Index 的 NaN→0 同源語意。
  return raw > 0 ? raw : 0
}

// ── 4 套模板（預填 10-tuple；ansi256 軌） ──
//
// 取色與 color.ts 公式一致：色立方 index = 16+36r+6g+b（levels
// 0/95/135/175/215/255）、灰階 232+n → 8+10n。各模板沿色立方走等距
// 路徑；11–12 點的完整路徑砍至 10 點時捨去點已註明。

/** 模板 id 聯合型別。 */
export type ThresholdTemplateId =
  | 'traffic'
  | 'traffic-inv'
  | 'cool-warm'
  | 'mono-fade'
  | 'limit-gradient'
  | 'remaining-gradient'

/** 模板 id 一覽（UI select 選項序；08 T3.5：新兩套尾插，既有 4 套順序不動）。 */
export const THRESHOLD_TEMPLATE_IDS: readonly ThresholdTemplateId[] = Object.freeze([
  'traffic',
  'traffic-inv',
  'cool-warm',
  'mono-fade',
  'limit-gradient',
  'remaining-gradient',
])

/** 恰 10 個 ansi256 索引（型別級長度檢查）。 */
type BucketIndices10 = readonly [
  number, number, number, number, number,
  number, number, number, number, number,
]

/**
 * traffic（低好高壞，context-used 類）：綠→黃→紅。
 * 走法：g=5 下 r 0→5（46/82/118/154/190/226），再 r=5 下 g 4→2
 * （220/214/208），收 196；完整 11 點捨 202（#ff5f00）湊 10。
 * hex：#00ff00 #5fff00 #87ff00 #afff00 #d7ff00 #ffff00 #ffd700
 *      #ffaf00 #ff8700 #ff0000
 */
const TRAFFIC: BucketIndices10 = [46, 82, 118, 154, 190, 226, 220, 214, 208, 196]

/** traffic-inv（低壞高好，context-remaining 類）＝traffic 逆序。 */
const TRAFFIC_INV: BucketIndices10 = [196, 208, 214, 220, 226, 190, 154, 118, 82, 46]

/**
 * cool-warm（冷→暖）：藍→紫→洋紅→紅。
 * 走法：b=5 下 r 0→4（21/57/93/129/165），再 r=5 下 b 4→0
 * （200/199/198/197/196）；完整 11 點捨 201（#ff00ff 純洋紅峰）湊 10。
 * hex：#0000ff #5f00ff #8700ff #af00ff #d700ff #ff00d7 #ff00af
 *      #ff0087 #ff005f #ff0000
 */
const COOL_WARM: BucketIndices10 = [21, 57, 93, 129, 165, 200, 199, 198, 197, 196]

/**
 * mono-fade（單色漸亮）：灰階 232–255（24 階）等距取 10 點
 * `232 + round(23·i/9)`。
 * hex：#080808 #262626 #3a3a3a #585858 #6c6c6c #8a8a8a #9e9e9e
 *      #bcbcbc #d0d0d0 #eeeeee
 */
const MONO_FADE: BucketIndices10 = [232, 235, 237, 240, 242, 245, 247, 250, 252, 255]

// ── 08-statusline-catalog-expansion T3.5：limit-gradient／remaining-gradient
// （出處 (internal design doc) Rev 4 §3 round 2 修訂）──

/**
 * limit-gradient（低好高壞，用量類段如 context-used；PLAN Rev 4 §3）：
 * 走法：0–49% 灰階等距取樣 244→250（5 桶：244/246/247/249/250），
 * 50–79% 綠三桶同色（34），80–89% 黃（220），90–100% 紅（196）；
 * 綠黃紅取色立方（round 2 修訂），對齊既有 4 套模板「只用色立方／
 * 灰階、避開可被主題覆寫的 0–15」值域慣例。
 * hex：#808080 #949494 #9e9e9e #b2b2b2 #bcbcbc #00af00 #00af00
 *      #00af00 #ffd700 #ff0000
 */
const LIMIT_GRADIENT: BucketIndices10 = [244, 246, 247, 249, 250, 34, 34, 34, 220, 196]

/** remaining-gradient（低壞高好，剩餘類段如 context-remaining）＝limit-gradient 逆序。 */
const REMAINING_GRADIENT: BucketIndices10 = [196, 220, 34, 34, 34, 250, 249, 247, 246, 244]

function frozenAnsiBuckets(indices: BucketIndices10): ThresholdBuckets {
  const buckets = indices.map((index) => Object.freeze({ kind: 'ansi256', index } as const))
  return Object.freeze(buckets) as unknown as ThresholdBuckets
}

/**
 * 模板＝預填陣列。深凍結（tuple＋各 ColorSpec）：UI 套用到 config 時
 * 須複製新 tuple（「套用後逐段改→顯示自訂」需可變桶）。
 */
export const THRESHOLD_TEMPLATES: Readonly<Record<ThresholdTemplateId, ThresholdRule>> =
  Object.freeze({
    traffic: Object.freeze({ buckets: frozenAnsiBuckets(TRAFFIC) }),
    'traffic-inv': Object.freeze({ buckets: frozenAnsiBuckets(TRAFFIC_INV) }),
    'cool-warm': Object.freeze({ buckets: frozenAnsiBuckets(COOL_WARM) }),
    'mono-fade': Object.freeze({ buckets: frozenAnsiBuckets(MONO_FADE) }),
    'limit-gradient': Object.freeze({ buckets: frozenAnsiBuckets(LIMIT_GRADIENT) }),
    'remaining-gradient': Object.freeze({ buckets: frozenAnsiBuckets(REMAINING_GRADIENT) }),
  })

/**
 * powerline 閾值成對 auto-fg 陣列（D2）：對 rule.buckets 逐桶以
 * color.ts autoFg 預算黑/白（色軌一致；default 桶→default），回傳
 * 平行 10-tuple。fgOverride 存在時全桶用之（不經亮度判定）。emit 期
 * 呼叫一次，執行期只索引。每次回傳新 tuple（不凍結，呼叫端可持有）。
 */
export function autoFgBuckets(rule: ThresholdRule, fgOverride?: ColorSpec): ThresholdBuckets {
  const fgs = rule.buckets.map(
    (bucket): ColorSpec => (fgOverride !== undefined ? { ...fgOverride } : autoFg(bucket)),
  )
  return fgs as unknown as ThresholdBuckets
}
