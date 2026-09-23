/**
 * S9-T2.1（(internal design doc) §D2 預設值標示／
 * TASKS.md T2.1）：每個 segment 編輯欄位的「預設值」描述純 helper——
 * 供 T2.2（buildSegmentRow）在每欄 label 後綴「（預設：X）」時查表，
 * 及「目前值是否＝預設」判定（供 T2.2 決定該標示是否弱化樣式，D2
 * 選項 C 的視覺選修）。
 *
 * 預設值權威來源（D2 定案）：`defaultSegmentConfig(id)`（config.ts:128-130）
 * ──icon／color 兩欄的基準值即由此讀出，非本檔複製常數；row／
 * fgOverride／threshold／bar 四欄 `defaultSegmentConfig` 恆不設（缺欄），
 * 故其「預設＝缺欄語意」（列位缺欄→第 1 列、fg 覆寫缺欄→不覆寫、閾值
 * 缺欄→10 桶皆終端預設色、bar 缺欄→關閉）直接取缺欄本身表達，不另編
 * 常數值。**descriptor 後備**（`defaultSegmentConfig` 不知目錄成員資格，
 * 需 descriptor 補完）：variant 預設＝`descriptor.variants[0]`
 * （main.ts:1204 同語意）、variant／threshold／bar 三欄的**是否適用**
 * 判定──variant 適用＝`descriptor.variants !== undefined`；
 * threshold／bar 適用＝`descriptor.category === 'percentage'`（與
 * segments.ts `barEligibleIds` 導出依據同一判準，見該檔「T3.3」節，
 * 故不需注入 catalog、僅讀 descriptor 本身即可）。
 *
 * **輸入面設計**：`computeSegmentFieldDefaults`／`isSegmentFieldAtDefault`
 * 皆吃「呼叫端已備妥的 `descriptor`」而非自行 import segments.ts 查表
 * ——T2.2 的 `buildSegmentRow(seg, descriptor)` 本就同時持有兩者，直接
 * 傳遞零額外查表成本；本模組因此不依賴 segments.ts 目錄（僅型別引用
 * `SegmentDescriptor`），與 config.ts「不依賴 segments.ts」的既有慣例
 * 同構（該檔檔頭「segment 目錄以 SegmentCatalog 注入」節）。
 *
 * ── T5.6 結構化改造（(internal design doc) §D5 D5
 * 收口；team-lead 併授權，收 T5.5-report「default-hint 混語形」已知
 * 限制）──
 * `SegmentFieldDefaultInfo.defaultLabel: string`（zh-only 字面）改為
 * **`descriptor: SegmentFieldDefaultDescriptor | null`**（i18n key／參數
 * 形結構化描述；不適用欄位為 `null`，同原 `applicable` 判定慣例——呼叫端
 * 仍須先判 `applicable`）。本模組**零 messages.ts import**——刻意維持
 * 「純描述子、不含任何語言字面決策」定位，實際文案解讀交給呼叫端（T5.6
 * main.ts `defaultDescriptorLabel`，以 `t(currentLocale())` 查表）：多數
 * kind 直接複用既有字典既有域，避免重複——`firstRow`→
 * `messages.rowGroup.heading(1)`、`variant`→`messages.variantLabel[value]`、
 * `colorDefault`/`colorAuto`→`messages.colorPicker.modeDefault`/`modeAuto`；
 * 僅 `iconState`／`emptyPrefix`／`noFgOverride`／`noThreshold`／`barState`
 * 五類無既有域可複用，新增 `messages.ts` 的 `defaultDescriptor` 域承載。
 * `literalPrefix`／`colorLiteral`（ansi256 swatch 名／truecolor hex）為
 * locale-invariant 原值，兩語言字典皆原樣顯示，不需查表。
 *
 * 原 main.ts 本地 `VARIANT_LABELS` 常數表隨此改造移除
 * ——variant 欄不再自行查表組字串，只回傳原值供呼叫端經
 * `messages.variantLabel` 解讀，消除雙寫（`messages.ts` 為單一事實來源）。
 *
 * `colorDisplayLabel`（zh-only 字面版，供 T2.2 顯示「現值」與獨立測試）
 * 保留不動——`computeSegmentFieldDefaults` 改呼叫新增的
 * `colorDefaultDescriptor`（同 switch 結構，回傳結構化描述而非 zh 字面），
 * 兩函式並存、互不依賴。
 *
 * 顯示字串常數集中於檔案頂部（僅 `colorDisplayLabel` 尚需的兩個 zh-only
 * 字面常數留存，其餘随結構化改造移除）。
 *
 * 純函式、零 DOM import、零 messages.ts import，node 可測。
 */
import { ansi256SwatchName, type ColorSpec } from './color.js'
import { defaultSegmentConfig, type SegmentColor, type SegmentConfig } from './config.js'
import type { SegmentDescriptor } from './segments.js'

// ── 顯示字串常數（僅 colorDisplayLabel 仍需的 zh-only 字面） ──

/** 終端預設色顯示名（與 index.html:852「終端預設」radio 可及名稱一致）。 */
const DEFAULT_COLOR_LABEL = '終端預設'
/** 自動配色顯示名（SegmentColor 第四態；目前 `defaultSegmentConfig` 恆不產出此態，僅供 colorDisplayLabel 窮盡處理）。 */
const AUTO_COLOR_LABEL = '自動配色'

// ── 結構化預設值描述（T5.6；render 層以 t() 解讀，見檔頭說明） ──

/**
 * 「（預設：X）」的 X 部分──結構化、locale-agnostic。`literalPrefix`／
 * `colorLiteral` 攜帶的 `value` 為使用者可見原值本身（非翻譯鍵，兩語言
 * 字典皆原樣顯示）；其餘 kind 由呼叫端查 `messages.ts` 對應域取字面。
 */
export type SegmentFieldDefaultDescriptor =
  | { kind: 'firstRow' }
  | { kind: 'iconState'; on: boolean }
  | { kind: 'emptyPrefix' }
  | { kind: 'literalPrefix'; value: string }
  | { kind: 'variant'; value: string }
  | { kind: 'colorDefault' }
  | { kind: 'colorAuto' }
  | { kind: 'colorLiteral'; value: string }
  | { kind: 'noFgOverride' }
  | { kind: 'noThreshold' }
  | { kind: 'barState'; on: boolean }

// ── 型別 ──

/** 八個可標示預設值的 segment 編輯欄位鍵（PLAN D2 列舉）。 */
export type SegmentFieldKey =
  | 'row'
  | 'icon'
  | 'prefix'
  | 'variant'
  | 'color'
  | 'fgOverride'
  | 'threshold'
  | 'bar'

export interface SegmentFieldDefaultInfo {
  /** 該欄位對此段是否存在（無 variants 之段的 variant 欄、非 percentage 段的 threshold／bar 欄 → false）。 */
  applicable: boolean
  /**
   * 「（預設：X）」的 X 部分之結構化描述（T5.6，見檔頭）。`applicable`
   * 為 false 時本欄為 `null`——呼叫端（T2.2／T5.6）須先判 `applicable`，
   * false 時不渲染整組欄位（比照 main.ts buildSegmentRow 現行
   * variant/threshold/bar 三欄「不適用即整組 remove()」慣例），此時
   * `descriptor` 不會被讀取。
   */
  descriptor: SegmentFieldDefaultDescriptor | null
}

/** `computeSegmentFieldDefaults` 輸出形：八欄位鍵 → 其預設值描述。 */
export type SegmentFieldDefaults = Readonly<Record<SegmentFieldKey, SegmentFieldDefaultInfo>>

// ── 顯示名輔助 ──

/**
 * `SegmentColor`（含 `auto` 第四態）→ 可讀顯示名。窮盡 switch：目前
 * `defaultSegmentConfig` 恆回 `{kind:'default'}`，故實際只會走 'default'
 * 分支；其餘分支供 `isSegmentFieldAtDefault` 之外的潛在重用與測試覆蓋
 * （T2.2 顯示「目前值」時亦可能需要，先备好）。
 */
export function colorDisplayLabel(spec: SegmentColor): string {
  switch (spec.kind) {
    case 'default':
      return DEFAULT_COLOR_LABEL
    case 'auto':
      return AUTO_COLOR_LABEL
    case 'ansi256':
      return ansi256SwatchName(spec.index)
    case 'truecolor':
      return spec.hex
  }
}

/**
 * T5.6：`colorDisplayLabel` 的結構化版本——同一 switch 骨架，回傳
 * `SegmentFieldDefaultDescriptor` 而非已固定 zh 字面的字串，供
 * `computeSegmentFieldDefaults` 的 `color` 欄使用。`colorDisplayLabel`
 * 本身保留不動（供 T2.2 顯示「現值」與其自身既有測試）；ansi256／
 * truecolor 兩態的顯示值（swatch 名／hex）locale-invariant，故直接沿用
 * `colorDisplayLabel` 的字面作為 `colorLiteral.value`，不重算。
 */
function colorDefaultDescriptor(spec: SegmentColor): SegmentFieldDefaultDescriptor {
  switch (spec.kind) {
    case 'default':
      return { kind: 'colorDefault' }
    case 'auto':
      return { kind: 'colorAuto' }
    case 'ansi256':
    case 'truecolor':
      return { kind: 'colorLiteral', value: colorDisplayLabel(spec) }
  }
}

/**
 * `SegmentColor`（或 `ColorSpec`，結構相容）相等判定——`ColorSpec` 為
 * `SegmentColor` 的子集（`SegmentColor = ColorSpec | {kind:'auto'}`），
 * 故一份判定可服務 `color`（`SegmentColor`）與 `fgOverride`
 * （`ColorSpec | undefined`）兩欄。`undefined` 視為獨立態（fgOverride
 * 缺欄≠ `{kind:'default'}`，見 main.ts:1238 兩者顯示雖同、儲存語意不同）。
 */
function segmentColorEqual(
  a: SegmentColor | undefined,
  b: SegmentColor | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'ansi256' && b.kind === 'ansi256') return a.index === b.index
  if (a.kind === 'truecolor' && b.kind === 'truecolor') return a.hex === b.hex
  return true // 'default'／'auto'：kind 相同即相等（無其他欄位）。
}

// ── computeSegmentFieldDefaults ──

/**
 * 對比 `defaultSegmentConfig(id)` ＋ descriptor 後備，產出八欄位的預設值
 * 描述（見檔頭權威來源說明）。純函式，`id`／`descriptor` 應為同一段
 * （呼叫端負責一致性，本函式不驗證 `descriptor.id === id`——與
 * buildSegmentRow 呼叫慣例一致，不重複防禦）。
 */
export function computeSegmentFieldDefaults(
  id: string,
  descriptor: SegmentDescriptor,
): SegmentFieldDefaults {
  const base = defaultSegmentConfig(id)
  const firstVariant = descriptor.variants?.[0]
  const hasVariants = firstVariant !== undefined
  const isPercentage = descriptor.category === 'percentage'

  return {
    row: { applicable: true, descriptor: { kind: 'firstRow' } },
    icon: { applicable: true, descriptor: { kind: 'iconState', on: base.icon } },
    prefix: {
      applicable: true,
      descriptor:
        base.prefix === undefined || base.prefix === ''
          ? { kind: 'emptyPrefix' }
          : { kind: 'literalPrefix', value: base.prefix },
    },
    variant: {
      applicable: hasVariants,
      descriptor: hasVariants ? { kind: 'variant', value: firstVariant } : null,
    },
    color: { applicable: true, descriptor: colorDefaultDescriptor(base.color) },
    fgOverride: { applicable: true, descriptor: { kind: 'noFgOverride' } },
    threshold: { applicable: isPercentage, descriptor: isPercentage ? { kind: 'noThreshold' } : null },
    bar: {
      applicable: isPercentage,
      descriptor: isPercentage ? { kind: 'barState', on: base.bar ?? false } : null,
    },
  }
}

// ── isSegmentFieldAtDefault（T2.2 用：現值是否＝預設） ──

/**
 * 現值是否＝預設（供 T2.2 決定標示是否弱化樣式，D2 選項 C）。與
 * `computeSegmentFieldDefaults` 同一權威來源（`defaultSegmentConfig`＋
 * descriptor 後備）比對，避免兩份定義漂移。欄位不適用（如無 variants
 * 之段的 `variant`）時回傳 `true`——語意上「沒有可偏離預設的欄位」即
 * 視同仍在預設態，呼叫端仍應先判 `applicable` 決定是否渲染整組欄位。
 */
export function isSegmentFieldAtDefault(
  seg: SegmentConfig,
  descriptor: SegmentDescriptor,
  key: SegmentFieldKey,
): boolean {
  const base = defaultSegmentConfig(seg.id)
  switch (key) {
    case 'row':
      return (seg.row ?? 0) === (base.row ?? 0)
    case 'icon':
      return seg.icon === base.icon
    case 'prefix':
      return (seg.prefix ?? '') === (base.prefix ?? '')
    case 'variant': {
      const firstVariant = descriptor.variants?.[0]
      if (firstVariant === undefined) return true
      return (seg.variant ?? firstVariant) === (base.variant ?? firstVariant)
    }
    case 'color':
      return segmentColorEqual(seg.color, base.color)
    case 'fgOverride':
      return segmentColorEqual(seg.fgOverride, base.fgOverride)
    case 'threshold':
      return seg.threshold === base.threshold
    case 'bar':
      return (seg.bar ?? false) === (base.bar ?? false)
  }
}
