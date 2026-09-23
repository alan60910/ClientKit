/**
 * T5.1（(internal design doc) §D5 A-1／A-2；PLAN Spike 5）：
 * i18n 純核心——typed message key、zh-Hant／en 兩字典、`t(locale)` 取字典。
 *
 * **純度硬約束**：零 DOM、零 localStorage——不 import 任何 DOM-facing 模組、
 * 不讀 `localStorage`/`document`/`window`；node 可測（見 messages.test.ts）。
 * 純函式模組（row-groups.ts／row-select.ts／resolve.ts／segments.ts 等）
 * 經呼叫端以 `locale`／`Messages` 注入取得文案，不反向 import 本檔以外的
 * DOM 模組。
 *
 * ── 定案簽章（本檔存取形式）──
 * 兩語言字典 `zhHant`／`en` 皆顯式標型 `Messages`——這是 arity／
 * placeholder parity 的 typecheck 罩門核心：任一字典漏一個函式鍵、或
 * 函式鍵簽章（參數數量／型別）與介面不符，`npm run typecheck` 即紅。
 * 取字典用 `t(locale): Messages`（回整包字典，非逐 key 查表）——呼叫端
 * `t(locale).announce.move(...)` 或先 `const m = t(locale)` 再連續取用
 * 皆可；插值訊息一律建模為函式鍵（如 `announce.move`），避免樣板字串
 * 動態插槽逃過 typecheck。
 *
 * ── T5.5 全量遷移（(internal design doc) §D5 D5；
 * TASKS.md T5.5）追補 ──
 * 本階段把 index.html 靜態文案、main.ts 常數表（`VARIANT_LABELS`／
 * `REJECT_MESSAGES`）與動態組句（announce＊／showError／aria-label／
 * textContent）全數收進字典，並補齊 en 全量。新域分五類：
 * 1. `variantLabel`／`validation`／`defaultHint`／`output`：原 main.ts 常數
 *    表與驗證訊息（`validation.fieldReject` 以函式承載「欄位名＋原因」
 *    的組句——zh 直接相接、en 空格相接，避免逐語言硬拼；不同語言語序
 *    差異由函式內部吸收，呼叫端只給 `(field, reason)` 兩參數）。
 * 2. `announce` 域擴充：閾值展開／模板套用／長條圖切換／fgOverride 停用／
 *    重複倒數提示／模式切換／空列移除等動態播報句（皆函式鍵，插值 arity
 *    由 TS 簽章鎖死；`「」` 角括號由本函式包住 label，呼叫端傳裸 label）。
 * 3. `segmentControl`：段控件的 accessible name 組句（上／下移／移除
 *    aria、色選 legend、閾值 legend、control-name-context 前綴）。
 * 4. `rowGroup`：列群組／暫存列的動態標題與刪除鈕文案（「第 N 列」／
 *    「刪除第 N 列」／確認提示等）＋列群組 template 靜態文案。
 * 5. `ui`／`separatorPreset`／`segmentRow`／`catalog`／`colorPicker`／
 *    `threshold`：index.html 全部靜態可見文案（供 `data-i18n`／
 *    `data-i18n-attr` 取值）。**zh 值與 index.html 現行字面 byte 一致**
 *    （既有 dom.test 的 zh 斷言是鎖）。site 共用 chrome（`<footer>`／
 *    `.theme-toggle`／`<head>` 之 `<title>`／meta）不在本工具 i18n 範圍，
 *    維持 zh（見 T5.5-report）。
 *
 * ── T5.3／T5.4 既有域（見各域文件） ──
 * segments（30 段 label／ariaText，`Record<SegmentId, …>`，segments.ts 反轉
 * 為消費者）、resetAriaWord（resolve.ts 倒數後綴代換詞）、rowSelect／
 * announce.move（row-groups.ts／row-select.ts locale 注入消費）、
 * thresholdTemplateLabel／colorPicker／langToggle（i18n-dom.ts 示範面）。
 */
import type { SegmentId } from './segments.js'
import type { ThresholdTemplateId } from './threshold.js'
import type { CustomTextRejectReason } from './validate.js'

export type Locale = 'zh-Hant' | 'en'

export const DEFAULT_LOCALE: Locale = 'zh-Hant'

/** 單一 segment 的可 i18n 文案（UI 顯示 label＋icon 的 SR aria 文字等價）。 */
export interface SegmentText {
  /** 段身分文字：UI 清單顯示＋控件 accessible name（segments.ts `label`）。 */
  label: string
  /** icon 開啟時的 SR 文字等價（segments.ts `icon.ariaText`）。 */
  ariaText: string
}

/**
 * 兩語言字典皆須 implement 的介面——字串鍵＋函式鍵（插值）混合。函式鍵
 * 簽章即該訊息的插值 arity／placeholder 契約，`npm run typecheck` 對兩
 * 字典的具體實作逐一核對，取代手寫 placeholder 一致性測試。
 */
export interface Messages {
  /** 30 段 label／ariaText；`Record<SegmentId, …>` 迫使兩字典覆蓋現行全目錄。 */
  segments: Record<SegmentId, SegmentText>
  /** resolve.ts 倒數後綴 aria 版代換詞（取代 `↺` 符號的可讀字詞）。 */
  resetAriaWord: string
  rowSelect: {
    /** row-select.ts 真實列 option 文字（1-index 顯示列號）。 */
    rowOption: (rowNumber: number) => string
    /** row-select.ts 暫存空列 option 文字（1-index 顯示列號）。 */
    rowOptionPending: (rowNumber: number) => string
  }
  announce: {
    /** row-groups.ts formatMoveAnnouncement 句形（同列/跨列移動共用）。 */
    move: (label: string, row: number, position: number, rowSize: number) => string
    /** main.ts announceSegmentLanded 'catalog-add' 分支句形（目錄拖入／勾選啟用）。 */
    catalogAdd: (label: string, row: number, position: number, rowSize: number) => string
    /** main.ts removeSegment 句形。 */
    removed: (label: string) => string
    /** main.ts performRowDeletion 句形（整列刪除）。 */
    rowDeleted: (row: number, count: number) => string
    /** T5.5：buildThresholdEditor disclosure 展開／收合播報。 */
    thresholdToggle: (label: string, expanded: boolean) => string
    /** T5.5：閾值模板批次套用播報（label＝模板可讀名）。 */
    thresholdApplied: (templateLabel: string) => string
    /** T5.5：setSegmentBar 切開＋套用預設模板播報（label 裸傳，本函式包 `「」`）。 */
    barOnWithTemplate: (label: string, templateLabel: string) => string
    /** T5.5：setSegmentBar 切開＋保留既有自訂閾值播報。 */
    barOnKeepCustom: (label: string) => string
    /** T5.5：powerline 下 bar 段 fgOverride 停用提示（單段名版本）。 */
    fgOverrideDisabled: (label: string) => string
    /** T5.5：percent-reset variant × reset 段同列並開的重複提示（內含 variant 樣式名）。 */
    duplicateResetHint: (rateLabel: string, resetLabel: string) => string
    /** T5.5：mode 切換的「顏色語意翻轉」播報（plain／powerline 兩態）。 */
    modeSwitch: (mode: 'plain' | 'powerline') => string
    /** T5.5：暫存空列移除播報。 */
    emptyRowRemoved: string
    /** T5.5：一次多句播報的接合（zh 全形分號、en 分號空格）——mode／bar／重複提示共用。 */
    join: (parts: readonly string[]) => string
  }
  /** T5.5：欄位「（預設：X）」提示的外殼（X 由 segment-defaults.ts 供給，見 T5.5-report）。 */
  defaultHint: (label: string) => string
  /** T5.5：cwd／rate 段 variant 值 → 可讀顯示名（原 main.ts VARIANT_LABELS）。 */
  variantLabel: Record<string, string>
  validation: {
    /** T5.5：欄位輸入拒收訊息＝欄位名（前綴／分隔符）＋原因（原 main.ts REJECT_MESSAGES）。 */
    fieldReject: (field: 'prefix' | 'separator', reason: CustomTextRejectReason) => string
    /** T5.5：resolve／emit 產出意外錯誤（防禦性顯示）。 */
    unexpectedOutputError: (detail: string) => string
  }
  output: {
    /** T5.5：複製回饋用的三產物別名（供 copied／copyFailed 代入）。 */
    bashLabel: string
    ps1Label: string
    settingsLabel: string
    /** T5.5：複製成功／失敗播報。 */
    copied: (label: string) => string
    copyFailed: (label: string) => string
  }
  /** T5.5：段控件 accessible name／legend／context 前綴組句（label 裸傳）。 */
  segmentControl: {
    /** 上／下移鈕 aria-label（`${label} — 上移`／`— 下移`）。 */
    moveUp: (label: string) => string
    moveDown: (label: string) => string
    /** 移除鈕 aria-label（`${label} — 從清單移除`）。 */
    remove: (label: string) => string
    /** control-name-context sr-only 前綴（`${label} — `，供 row／icon／prefix／variant／bar 欄共用）。 */
    namePrefix: (label: string) => string
    /** base／fg 色選 legend（`${label} — 顏色`／`— 前景色`）。 */
    colorName: (label: string) => string
    fgColorName: (label: string) => string
    /** 閾值 disclosure／template context 前綴（`${label} 閾值 `，尾帶空格）。 */
    thresholdContext: (label: string) => string
    /** 閾值桶色選 legend（`${label} 閾值 ${range}`，range＝`0–9%` 等）。 */
    thresholdBucketName: (label: string, range: string) => string
  }
  rowGroup: {
    /** 列群組／暫存列標題（`第 N 列`）。 */
    heading: (n: number) => string
    /** 「刪除第 N 列」鈕文字（真實列 trigger＋暫存列刪除鈕共用）。 */
    deleteRow: (n: number) => string
    /** 確認／取消刪除鈕的 aria-label（含列號）。 */
    deleteConfirmAria: (n: number) => string
    deleteCancelAria: (n: number) => string
    /** 兩段式確認的 live region 提示句。 */
    deleteConfirmPrompt: (n: number) => string
    /** segment-row-group-template 靜態文案（clone 點 applyI18n 覆寫）。 */
    separatorFieldLabel: string
    customSeparatorLabel: string
    deleteConfirmText: string
    deleteCancelText: string
    /** segment-pending-row-template 空列提示。 */
    pendingRowHint: string
  }
  /**
   * T5.4：閾值模板 id → 可讀顯示名——單一事實來源，取代 index.html
   * threshold-editor-template 6 個 `<option>` 文字與 main.ts 原
   * `THRESHOLD_TEMPLATE_LABELS` 常數表的雙寫（見檔頭「T5.4 追補」）。
   */
  thresholdTemplateLabel: Record<ThresholdTemplateId, string>
  /** T5.4／T5.5：color-picker-template 靜態文案（mode radio／panel label／aria）。 */
  colorPicker: {
    /** T5.4：ANSI 256 色 spinbutton 的欄位 label（`__PID__-index-label`）。 */
    ansiIndexLabel: string
    /** T5.4：索引減 1 步進鈕 aria-label。 */
    indexDecrement: string
    /** T5.4：索引加 1 步進鈕 aria-label。 */
    indexIncrement: string
    /** T5.5：三態＋auto 第四態 mode radio 可見文字。 */
    modeDefault: string
    modeAnsi256: string
    modeTruecolor: string
    modeAuto: string
    /** T5.5：truecolor 面板 hex label。 */
    hexLabel: string
    /** T5.5：16 基本色 swatch 容器 aria-label。 */
    swatchGroupLabel: string
  }
  /** T5.5：threshold-editor-template 靜態文案。 */
  threshold: {
    /** disclosure 觸發鈕可見文字。 */
    toggleLabel: string
    /** 「套用模板」select 的 label。 */
    templateFieldLabel: string
    /** 空值「（自訂）」option。 */
    customOption: string
  }
  /** T5.5：分隔符 preset select 的 option 文字（全域＋逐列共用；inherit 僅逐列）。 */
  separatorPreset: {
    /** 逐列「（全域）」還原繼承 option（全域 select 無此項）。 */
    inherit: string
    bar: string
    arrow: string
    middot: string
    space: string
    custom: string
  }
  /** T5.5：segment-row-template 各欄位的靜態可見文字（clone 點 applyI18n 覆寫）。 */
  segmentRow: {
    rowFieldLabel: string
    iconFieldLabel: string
    prefixFieldLabel: string
    variantFieldLabel: string
    barFieldLabel: string
  }
  /** T5.5：catalog-item-template 靜態文案。 */
  catalog: {
    addedBadge: string
    /**
     * T3.2（(internal design doc) §D2′；TASKS.md T3.2）：
     * 目錄列樣例值 fallback 文案——sample-values.ts 逐段合成擲空／整批
     * 擲錯時皆改顯此文案（locale 相依）。
     */
    sampleUnavailable: string
  }
  /**
   * T3.6（(internal design doc) §D5；TASKS.md T3.6）：拖曳
   * 教學帶（tutorial-band）靜態文案——index.html `data-i18n="tutorial.
   * dragHint"`／`data-i18n="tutorial.dismiss"` 掛標對應鍵，`applyI18n`
   * 開機與切換語言時寫回。dismiss 鈕定案沿用「可見文字即可及名稱」慣例
   * （同 `#output-dialog-close`），不另掛 `aria-label`／`data-i18n-attr`
   * （T2.6 留白至此定案，見 index.html 該處註解）。
   */
  tutorial: {
    /** 教學帶主文案：一句話說明拖曳段名可排序與移列。 */
    dragHint: string
    /** dismiss 鈕可見文字（同時作為其可及名稱）。 */
    dismiss: string
  }
  /**
   * T5.4：header 語言切換鈕文案——皆以「目前生效語言」為準記錄「切至
   * 另一語言」的文字（見檔頭「T5.4 追補」，`zhHant.langToggle` 之值＝
   * zh-Hant 生效中看到的目標語言 en 短碼／敘述，`en.langToggle` 反之）。
   */
  langToggle: {
    /** 按鈕可見文字：目標語言短碼（如「EN」／「中」）。 */
    shortLabel: string
    /** 按鈕可及名稱：完整敘述「切換為 X 介面語言」。 */
    ariaLabel: string
    /**
     * T5.6（09-PLAN §D5 A-4 步驟 5；2026-07-17 拍板「以切換後語言播報」）：
     * 切換完成後 `#global-live-status` 播報句——**自我指涉**（描述當下
     * 已生效的語言本身，故無插值參數）：`zhHant.langToggle.switchedAnnounce`
     * ＝切至 zh-Hant 生效時的中文播報句、`en` 反之為切至 en 生效時的
     * 英文播報句（與 `shortLabel`／`ariaLabel`「描述目標語言」的既有語意
     * 方向相反，故獨立文件於此避免誤讀）。
     */
    switchedAnnounce: string
  }
  /**
   * T5.6（09-PLAN §D5 D5 收口；default-hint 結構化改造授權）：欄位
   * 「（預設：X）」提示的 X 部分中，非直接複用其他既有域（`rowGroup.
   * heading`／`variantLabel`／`colorPicker.modeDefault`／`modeAuto`）的
   * 剩餘字詞——segment-defaults.ts 回傳結構化描述子（zero messages.ts
   * import），main.ts `defaultDescriptorLabel` 以此域＋上述既有域解讀。
   */
  defaultDescriptor: {
    /** icon 欄兩態（「顯示」／「隱藏」）。 */
    iconOn: string
    iconOff: string
    /** prefix 欄預設＝空字串時的顯示形。 */
    emptyPrefix: string
    /** fgOverride 欄預設＝未覆寫。 */
    noFgOverride: string
    /** threshold 欄預設＝未材料化（10 桶皆終端預設色）。 */
    noThreshold: string
    /** bar 欄兩態（「開啟」／「關閉」）。 */
    barOn: string
    barOff: string
  }
  /**
   * T5.6（09-PLAN §D5 A-4「強制 preview 重 resolve」）：render-preview.ts
   * 逐列／外層容器 aria-label 組裝——取代原本硬編 zh 字面
   * （`PREVIEW_GROUP_LABEL`／`EMPTY_PREVIEW_LABEL`／`第 N 列：` 前綴）。
   */
  previewAria: {
    /** 外層 role=group 固定 aria-label。 */
    groupLabel: string
    /** 全隱藏（`[[]]` 退化）時的單一子容器 aria-label。 */
    emptyLabel: string
    /** 逐列 role=img 子容器 aria-label 前綴（含尾端分隔，後接 toAriaLabel 結果）。 */
    rowPrefix: (n: number) => string
  }
  /** T5.5：index.html 其餘靜態可見文案（header／預覽／全域設定／skip-nav／目錄／已選擇／產出 dialog）。 */
  ui: {
    // header
    backLink: string
    title: string
    headerDesc: string
    // 即時預覽頂帶
    previewHeading: string
    previewBgLegend: string
    bgDark: string
    bgLight: string
    previewScenarioLegend: string
    scenarioFullShort: string
    scenarioFullFull: string
    scenarioEarlyShort: string
    scenarioEarlyFull: string
    scenarioCondShort: string
    scenarioCondFull: string
    scenarioWinShort: string
    scenarioWinFull: string
    outputOpen: string
    mockClockHint: string
    // 全域設定
    globalHeading: string
    modeLegend: string
    modePlain: string
    modePowerline: string
    separatorLabel: string
    separatorCustomLabel: string
    powerlineArrowLabel: string
    powerlineArrowHint: string
    lastArrowCapLabel: string
    settingsPathLabel: string
    noBoundaryHint: string
    // skip-nav
    skipNavLabel: string
    skipToSettings: string
    skipToCatalog: string
    skipToSelected: string
    skipToPreview: string
    skipToOutput: string
    // 目錄
    // sprint 15 T3.3（(internal design doc) §D8「行動版
    // 目錄收合」）：<summary> 的可見文字＝可及名稱單一來源（同
    // #tutorial-dismiss 慣例，不另掛 aria-label）；展開/收合狀態本身由
    // <details> 原生語意播報（aria-expanded 等效），文案不重複「顯示/隱藏」
    // 字樣，見 index.html #catalog-collapse-summary 節點自身註解。
    catalogCollapseSummary: string
    catalogHint: string
    catalogAlwaysHeading: string
    catalogAlwaysDesc: string
    catalogPercentageHeading: string
    catalogPercentageDesc: string
    catalogConditionalHeading: string
    catalogConditionalDesc: string
    catalogShelloutHeading: string
    catalogShelloutDesc: string
    // 已選擇（中欄）
    selectedSectionLabel: string
    sortHint: string
    addPendingRow: string
    addPendingRowAria: string
    // 產出 dialog
    outputHeading: string
    outputBashHeading: string
    copyBash: string
    downloadBash: string
    outputPs1Heading: string
    copyPs1: string
    downloadPs1: string
    outputSettingsHeading: string
    copySettings: string
    downloadSettings: string
    close: string
  }
}

// ── 共用查表（兩字典的函式鍵與 Record 欄共用單一來源，避免逐處手抄） ──

const VARIANT_LABELS_ZH: Readonly<Record<string, string>> = {
  full: '完整路徑',
  basename: '僅目錄名',
  tilde: '以 ~ 縮寫家目錄',
  percent: '僅百分比',
  'percent-reset': '百分比＋重置時間',
}

const VARIANT_LABELS_EN: Readonly<Record<string, string>> = {
  full: 'Full path',
  basename: 'Basename only',
  tilde: 'Abbreviate home as ~',
  percent: 'Percentage only',
  'percent-reset': 'Percentage + reset time',
}

/** 拒收原因後半句（欄位名前綴由 fieldReject 組合；zh 直接相接、en 以空格相接）。 */
const REJECT_REASON_ZH: Readonly<Record<CustomTextRejectReason, string>> = {
  newline: '不可包含換行字元',
  control: '不可包含控制字元',
  'bidi-format': '不可包含雙向文字格式控制字元',
  'lone-surrogate': '不可包含不成對的代理字元（無效的 Unicode）',
  pua: '不可包含私用區（PUA）字元',
  'too-long': '長度不可超過 8 個字元',
}

const REJECT_REASON_EN: Readonly<Record<CustomTextRejectReason, string>> = {
  newline: 'must not contain newline characters',
  control: 'must not contain control characters',
  'bidi-format': 'must not contain bidirectional formatting control characters',
  'lone-surrogate': 'must not contain unpaired surrogate characters (invalid Unicode)',
  pua: 'must not contain Private Use Area (PUA) characters',
  'too-long': 'must not exceed 8 characters',
}

const FIELD_LABEL_ZH: Readonly<Record<'prefix' | 'separator', string>> = {
  prefix: '前綴',
  separator: '分隔符',
}

const FIELD_LABEL_EN: Readonly<Record<'prefix' | 'separator', string>> = {
  prefix: 'Prefix',
  separator: 'Separator',
}

const zhHant: Messages = {
  segments: {
    model: { label: '模型', ariaText: '模型' },
    cwd: { label: '目前目錄', ariaText: '目前目錄' },
    'project-dir': { label: '專案目錄', ariaText: '專案目錄' },
    'output-style': { label: '輸出風格', ariaText: '輸出風格' },
    version: { label: '版本', ariaText: '版本' },
    cost: { label: '費用', ariaText: '費用' },
    duration: { label: '工作時長', ariaText: '工作時長' },
    'lines-changed': { label: '行數增減', ariaText: '行數增減' },
    'context-size': { label: '上下文大小', ariaText: '上下文大小' },
    thinking: { label: '思考模式', ariaText: '思考模式' },
    'token-in': { label: 'Tokens 輸入', ariaText: 'Tokens 輸入' },
    'token-out': { label: 'Tokens 輸出', ariaText: 'Tokens 輸出' },
    'context-used': { label: '上下文已用', ariaText: '上下文已用' },
    'context-remaining': { label: '上下文剩餘', ariaText: '上下文剩餘' },
    'rate-5h': { label: '5 小時限額', ariaText: '5 小時限額' },
    'rate-7d': { label: '7 日限額', ariaText: '7 日限額' },
    'cache-hit': { label: 'Cache 命中率', ariaText: 'Cache 命中率' },
    'session-name': { label: '工作階段名稱', ariaText: '工作階段名稱' },
    effort: { label: '推理強度', ariaText: '推理強度' },
    'vim-mode': { label: 'Vim 模式', ariaText: 'Vim 模式' },
    'agent-name': { label: '代理名稱', ariaText: '代理名稱' },
    pr: { label: 'PR', ariaText: '拉取請求' },
    repo: { label: '儲存庫', ariaText: '儲存庫' },
    worktree: { label: 'Git 工作樹', ariaText: 'Git 工作樹' },
    'worktree-branch': { label: 'Git 工作樹分支', ariaText: 'Git 工作樹分支' },
    'reset-5h': { label: '5 小時限額重置倒數', ariaText: '5 小時限額重置倒數' },
    'reset-7d': { label: '7 日限額重置倒數', ariaText: '7 日限額重置倒數' },
    'git-branch': { label: 'Git 分支', ariaText: '分支' },
    'git-dirty': { label: 'Git 髒標記', ariaText: '未提交變更' },
    clock: { label: '時鐘', ariaText: '時鐘' },
  },
  resetAriaWord: '重置',
  rowSelect: {
    rowOption: (rowNumber) => `第 ${rowNumber} 列`,
    rowOptionPending: (rowNumber) => `第 ${rowNumber} 列（新列）`,
  },
  announce: {
    move: (label, row, position, rowSize) => `${label} 移至第 ${row} 列第 ${position} 位（共 ${rowSize}）`,
    catalogAdd: (label, row, position, rowSize) =>
      `${label} 已加入第 ${row} 列第 ${position} 位（共 ${rowSize}）`,
    removed: (label) => `${label} 已從清單移除`,
    rowDeleted: (row, count) => `第 ${row} 列已刪除，${count} 個段已回到目錄`,
    thresholdToggle: (label, expanded) => `${label} 閾值設定已${expanded ? '展開' : '收合'}`,
    thresholdApplied: (templateLabel) => `已套用${templateLabel}，10 段顏色已更新`,
    barOnWithTemplate: (label, templateLabel) =>
      `「${label}」已開啟長條圖，套用預設閾值模板「${templateLabel}」`,
    barOnKeepCustom: (label) => `「${label}」已開啟長條圖，既有自訂閾值顏色已保留`,
    fgOverrideDisabled: (label) => `「${label}」的前景覆寫色因長條圖已停用，改由主色自動決定`,
    duplicateResetHint: (rateLabel, resetLabel) =>
      `「${rateLabel}」已選「${VARIANT_LABELS_ZH['percent-reset']}」樣式，與「${resetLabel}」同列並開，` +
      '重置時間將重複顯示：前者僅於百分比後方附註時刻（如 (14:30)），' +
      '後者為獨立完整倒數（如 ↺2h (14:30)）',
    modeSwitch: (mode) =>
      mode === 'powerline'
        ? '已切換至 Powerline 模式；顏色語意已翻轉（原前景色現作為背景色），自訂分隔符已停用，請檢視預覽。'
        : '已切換至純文字模式；顏色語意已翻轉（原背景色現作為前景色），請檢視預覽。',
    emptyRowRemoved: '空列已移除',
    join: (parts) => parts.join('；'),
  },
  defaultHint: (label) => `（預設：${label}）`,
  variantLabel: VARIANT_LABELS_ZH,
  validation: {
    fieldReject: (field, reason) => `${FIELD_LABEL_ZH[field]}${REJECT_REASON_ZH[reason]}`,
    unexpectedOutputError: (detail) => `產生輸出時發生非預期錯誤：${detail}`,
  },
  output: {
    bashLabel: 'bash 腳本',
    ps1Label: 'PowerShell 腳本',
    settingsLabel: 'settings 片段',
    copied: (label) => `已複製 ${label}`,
    copyFailed: (label) => `複製失敗，請手動選取${label}內容後複製`,
  },
  segmentControl: {
    moveUp: (label) => `${label} — 上移`,
    moveDown: (label) => `${label} — 下移`,
    remove: (label) => `${label} — 從清單移除`,
    namePrefix: (label) => `${label} — `,
    colorName: (label) => `${label} — 顏色`,
    fgColorName: (label) => `${label} — 前景色`,
    thresholdContext: (label) => `${label} 閾值 `,
    thresholdBucketName: (label, range) => `${label} 閾值 ${range}`,
  },
  rowGroup: {
    heading: (n) => `第 ${n} 列`,
    deleteRow: (n) => `刪除第 ${n} 列`,
    deleteConfirmAria: (n) => `確認刪除第 ${n} 列`,
    deleteCancelAria: (n) => `取消刪除第 ${n} 列`,
    deleteConfirmPrompt: (n) => `確定要刪除第 ${n} 列？該列全部段將回到目錄。`,
    separatorFieldLabel: '本列分隔符',
    customSeparatorLabel: '自訂分隔符（≤8 字元）',
    deleteConfirmText: '確認刪除',
    deleteCancelText: '取消',
    pendingRowHint: '空列——用各段「顯示於第 N 列」選單放入段。',
  },
  thresholdTemplateLabel: {
    traffic: '交通號誌（綠→黃→紅）',
    'traffic-inv': '反向交通號誌（紅→綠）',
    'cool-warm': '冷暖（藍→紅）',
    'mono-fade': '單色漸亮',
    'limit-gradient': '限額漸層（按用量）',
    'remaining-gradient': '剩餘漸層（逆序）',
  },
  colorPicker: {
    ansiIndexLabel: 'ANSI 索引（0–255）',
    indexDecrement: '索引減 1',
    indexIncrement: '索引加 1',
    modeDefault: '終端預設',
    modeAnsi256: 'ANSI 256 色',
    modeTruecolor: '自訂顏色',
    modeAuto: '自動配色',
    hexLabel: '自訂顏色（十六進位）',
    swatchGroupLabel: '基本 16 色',
  },
  threshold: {
    toggleLabel: '閾值變色設定',
    templateFieldLabel: '套用模板',
    customOption: '（自訂）',
  },
  separatorPreset: {
    inherit: '（全域）',
    bar: '豎線 |',
    arrow: '箭頭 ›',
    middot: '中點 ·',
    space: '空格',
    custom: '自訂…',
  },
  segmentRow: {
    rowFieldLabel: '顯示於第 N 列',
    iconFieldLabel: '顯示文字',
    prefixFieldLabel: '前綴',
    variantFieldLabel: '顯示樣式',
    barFieldLabel: '顯示長條圖',
  },
  catalog: {
    addedBadge: '已加入',
    sampleUnavailable: '（無樣例）',
  },
  tutorial: {
    dragHint: '拖曳段名可排序與移列',
    dismiss: '知道了',
  },
  langToggle: {
    shortLabel: 'EN',
    ariaLabel: '切換為英文介面',
    switchedAnnounce: '已切換為中文介面',
  },
  defaultDescriptor: {
    iconOn: '顯示',
    iconOff: '隱藏',
    emptyPrefix: '（空）',
    noFgOverride: '無（未覆寫）',
    noThreshold: '無（10 桶皆為終端預設色）',
    barOn: '開啟',
    barOff: '關閉',
  },
  previewAria: {
    groupLabel: '狀態列預覽',
    emptyLabel: '狀態列預覽：未啟用任何區段',
    rowPrefix: (n) => `第 ${n} 列：`,
  },
  ui: {
    backLink: '← 返回 ClientKit',
    title: 'Claude Code Statusline 產生器',
    headerDesc:
      '設計 Claude Code 的自訂狀態列：勾選要顯示的 segment、拖曳或用上下鈕排序、選顏色與百分比閾值變色，即時預覽，一鍵產出 bash（.sh）與 PowerShell（.ps1）腳本，以及 settings.json 片段。所有處理都在瀏覽器端完成，不會上傳任何資料。',
    previewHeading: '即時預覽',
    previewBgLegend: '預覽底色',
    bgDark: '深色',
    bgLight: '淺色',
    previewScenarioLegend: '預覽情境',
    scenarioFullShort: '滿血',
    scenarioFullFull: '滿血（全欄位齊備）',
    scenarioEarlyShort: '早期',
    scenarioEarlyFull: '早期 session（可 null 欄全 null）',
    scenarioCondShort: '條件',
    scenarioCondFull: '條件欄位全缺席',
    scenarioWinShort: 'Windows',
    scenarioWinFull: 'Windows 長路徑＋CJK',
    outputOpen: '產出腳本',
    mockClockHint: '預覽為固定示範時鐘，產出腳本執行時為真時鐘。',
    globalHeading: '全域設定',
    modeLegend: '呈現模式',
    modePlain: '純文字（plain）',
    modePowerline: 'Powerline（色塊＋箭頭）',
    separatorLabel: '分隔符',
    separatorCustomLabel: '自訂分隔符（≤8 字元，僅 plain 模式）',
    powerlineArrowLabel: 'Powerline 箭頭',
    powerlineArrowHint: '需終端安裝支援此符號的特殊字型，否則箭頭會顯示為方塊或亂碼。',
    lastArrowCapLabel: 'Powerline 末段補收尾箭頭',
    settingsPathLabel: 'settings.json 內的腳本路徑',
    noBoundaryHint:
      '目前所有已啟用的 segment 皆使用終端預設色、且未開啟 Powerline 箭頭：相鄰色塊將無法區分邊界，建議開啟箭頭或為部分 segment 指定顏色。',
    skipNavLabel: '區塊快速跳轉',
    skipToSettings: '跳至設定',
    skipToCatalog: '跳至目錄',
    skipToSelected: '跳至已選擇',
    skipToPreview: '跳至預覽',
    skipToOutput: '跳至產出腳本',
    catalogCollapseSummary: 'Segment 目錄清單',
    catalogHint:
      '勾選以啟用 segment：勾選後本項原位灰化標記「已加入」，其完整控件列會出現在中間「已選擇」欄的對應列群組，可於該處排序、配色、指派顯示列等；再點一次取消勾選即可移除。',
    catalogAlwaysHeading: '永在 segment',
    catalogAlwaysDesc: 'stdin JSON 恆有的欄位，隨時可顯示。',
    catalogPercentageHeading: '百分比 segment',
    catalogPercentageDesc: '可掛百分比閾值變色；值為 null 時顯示 --、不套閾值色。',
    catalogConditionalHeading: '條件性 segment',
    catalogConditionalDesc: '狀態不成立時該欄缺席，整段自動剔除。',
    catalogShelloutHeading: 'Shell-out segment',
    catalogShelloutDesc: '值來自執行外部指令（git／時鐘），非 stdin JSON。',
    selectedSectionLabel: '已選擇（依列分組）',
    sortHint:
      '排序方式：滑鼠可按住段卡（⠿ 把手或頂部）拖曳到任意位置或其他列；鍵盤可用每段的 ↑/↓ 鈕在同列相鄰交換，或在「顯示於第 N 列」下拉直接按方向鍵切換所在列。',
    addPendingRow: '＋ 新增一列',
    addPendingRowAria: '新增一列',
    outputHeading: '產出腳本',
    outputBashHeading: 'bash 腳本（statusline.sh）',
    copyBash: '複製 bash 腳本',
    downloadBash: '下載 bash 腳本',
    outputPs1Heading: 'PowerShell 腳本（statusline.ps1）',
    copyPs1: '複製 PowerShell 腳本',
    downloadPs1: '下載 PowerShell 腳本',
    outputSettingsHeading: 'settings.json 片段',
    copySettings: '複製 settings 片段',
    downloadSettings: '下載 settings 片段',
    close: '關閉',
  },
}

/**
 * en 全量（T5.5 打磨定案，取代 T5.1 初稿的待打磨清單）：segment label／
 * ariaText 依團隊給定範例慣例直譯；動態組句與靜態 UI 皆為道地英文文案
 * （非機械直譯，如 announce 語序改為英文慣用、rowDeleted 保留機械複數
 * `segment(s)` 惟改以斜線標記 arity 不變）。`git-dirty` 的 ariaText 沿
 * zh-Hant「未提交變更」語意譯 `Uncommitted changes`；`pr` label／ariaText
 * 不同形（`PR`／`Pull request`）沿 zh-Hant「PR」／「拉取請求」慣例。
 */
const en: Messages = {
  segments: {
    model: { label: 'Model', ariaText: 'Model' },
    cwd: { label: 'Current dir', ariaText: 'Current dir' },
    'project-dir': { label: 'Project dir', ariaText: 'Project dir' },
    'output-style': { label: 'Output style', ariaText: 'Output style' },
    version: { label: 'Version', ariaText: 'Version' },
    cost: { label: 'Cost', ariaText: 'Cost' },
    duration: { label: 'Duration', ariaText: 'Duration' },
    'lines-changed': { label: 'Lines changed', ariaText: 'Lines changed' },
    'context-size': { label: 'Context size', ariaText: 'Context size' },
    thinking: { label: 'Thinking mode', ariaText: 'Thinking mode' },
    'token-in': { label: 'Tokens in', ariaText: 'Tokens in' },
    'token-out': { label: 'Tokens out', ariaText: 'Tokens out' },
    'context-used': { label: 'Context used', ariaText: 'Context used' },
    'context-remaining': { label: 'Context remaining', ariaText: 'Context remaining' },
    'rate-5h': { label: '5-hour limit', ariaText: '5-hour limit' },
    'rate-7d': { label: '7-day limit', ariaText: '7-day limit' },
    'cache-hit': { label: 'Cache hit rate', ariaText: 'Cache hit rate' },
    'session-name': { label: 'Session name', ariaText: 'Session name' },
    effort: { label: 'Reasoning effort', ariaText: 'Reasoning effort' },
    'vim-mode': { label: 'Vim mode', ariaText: 'Vim mode' },
    'agent-name': { label: 'Agent name', ariaText: 'Agent name' },
    pr: { label: 'PR', ariaText: 'Pull request' },
    repo: { label: 'Repository', ariaText: 'Repository' },
    worktree: { label: 'Git worktree', ariaText: 'Git worktree' },
    'worktree-branch': { label: 'Git worktree branch', ariaText: 'Git worktree branch' },
    'reset-5h': { label: '5-hour limit reset countdown', ariaText: '5-hour limit reset countdown' },
    'reset-7d': { label: '7-day limit reset countdown', ariaText: '7-day limit reset countdown' },
    'git-branch': { label: 'Git branch', ariaText: 'Branch' },
    'git-dirty': { label: 'Git dirty flag', ariaText: 'Uncommitted changes' },
    clock: { label: 'Clock', ariaText: 'Clock' },
  },
  resetAriaWord: 'reset',
  rowSelect: {
    rowOption: (rowNumber) => `Row ${rowNumber}`,
    rowOptionPending: (rowNumber) => `Row ${rowNumber} (new)`,
  },
  announce: {
    move: (label, row, position, rowSize) => `${label} moved to row ${row} position ${position} (of ${rowSize})`,
    catalogAdd: (label, row, position, rowSize) =>
      `${label} added to row ${row} position ${position} (of ${rowSize})`,
    removed: (label) => `${label} removed from list`,
    rowDeleted: (row, count) => `Row ${row} deleted, ${count} segment(s) returned to catalog`,
    thresholdToggle: (label, expanded) => `${label} threshold settings ${expanded ? 'expanded' : 'collapsed'}`,
    thresholdApplied: (templateLabel) => `Applied ${templateLabel}; all 10 colors updated`,
    barOnWithTemplate: (label, templateLabel) =>
      `"${label}" bar chart enabled; applied default threshold template "${templateLabel}"`,
    barOnKeepCustom: (label) => `"${label}" bar chart enabled; existing custom threshold colors kept`,
    fgOverrideDisabled: (label) =>
      `Foreground override for "${label}" is disabled by the bar chart; the base color decides it automatically`,
    duplicateResetHint: (rateLabel, resetLabel) =>
      `"${rateLabel}" uses the "${VARIANT_LABELS_EN['percent-reset']}" style and shares a row with "${resetLabel}", ` +
      'so the reset time is shown twice: the former only annotates the time after the percentage (e.g. (14:30)), ' +
      'the latter is a standalone full countdown (e.g. ↺2h (14:30))',
    modeSwitch: (mode) =>
      mode === 'powerline'
        ? 'Switched to Powerline mode; color semantics flipped (the former foreground color is now the background), custom separator disabled. Please review the preview.'
        : 'Switched to plain-text mode; color semantics flipped (the former background color is now the foreground). Please review the preview.',
    emptyRowRemoved: 'Empty row removed',
    join: (parts) => parts.join('; '),
  },
  defaultHint: (label) => `(default: ${label})`,
  variantLabel: VARIANT_LABELS_EN,
  validation: {
    fieldReject: (field, reason) => `${FIELD_LABEL_EN[field]} ${REJECT_REASON_EN[reason]}`,
    unexpectedOutputError: (detail) => `Unexpected error while generating output: ${detail}`,
  },
  output: {
    bashLabel: 'bash script',
    ps1Label: 'PowerShell script',
    settingsLabel: 'settings snippet',
    copied: (label) => `Copied ${label}`,
    copyFailed: (label) => `Copy failed; please select the ${label} content manually and copy`,
  },
  segmentControl: {
    moveUp: (label) => `${label} — move up`,
    moveDown: (label) => `${label} — move down`,
    remove: (label) => `${label} — remove from list`,
    namePrefix: (label) => `${label} — `,
    colorName: (label) => `${label} — color`,
    fgColorName: (label) => `${label} — foreground color`,
    thresholdContext: (label) => `${label} threshold `,
    thresholdBucketName: (label, range) => `${label} threshold ${range}`,
  },
  rowGroup: {
    heading: (n) => `Row ${n}`,
    deleteRow: (n) => `Delete row ${n}`,
    deleteConfirmAria: (n) => `Confirm delete row ${n}`,
    deleteCancelAria: (n) => `Cancel delete row ${n}`,
    deleteConfirmPrompt: (n) => `Delete row ${n}? All segments in this row will return to the catalog.`,
    separatorFieldLabel: 'Row separator',
    customSeparatorLabel: 'Custom separator (≤8 chars)',
    deleteConfirmText: 'Confirm delete',
    deleteCancelText: 'Cancel',
    pendingRowHint: 'Empty row — use each segment’s “Show in row N” menu to place segments here.',
  },
  thresholdTemplateLabel: {
    traffic: 'Traffic light (green→yellow→red)',
    'traffic-inv': 'Reverse traffic light (red→green)',
    'cool-warm': 'Cool–warm (blue→red)',
    'mono-fade': 'Monochrome fade',
    'limit-gradient': 'Limit gradient (by usage)',
    'remaining-gradient': 'Remaining gradient (reverse)',
  },
  colorPicker: {
    ansiIndexLabel: 'ANSI index (0–255)',
    indexDecrement: 'Decrease index by 1',
    indexIncrement: 'Increase index by 1',
    modeDefault: 'Terminal default',
    modeAnsi256: 'ANSI 256 color',
    modeTruecolor: 'Custom color',
    modeAuto: 'Auto color',
    hexLabel: 'Custom color (hex)',
    swatchGroupLabel: 'Basic 16 colors',
  },
  threshold: {
    toggleLabel: 'Threshold coloring',
    templateFieldLabel: 'Apply template',
    customOption: '(Custom)',
  },
  separatorPreset: {
    inherit: '(Global)',
    bar: 'Bar |',
    arrow: 'Arrow ›',
    middot: 'Middot ·',
    space: 'Space',
    custom: 'Custom…',
  },
  segmentRow: {
    rowFieldLabel: 'Show in row N',
    iconFieldLabel: 'Show text',
    prefixFieldLabel: 'Prefix',
    variantFieldLabel: 'Display style',
    barFieldLabel: 'Show bar chart',
  },
  catalog: {
    addedBadge: 'Added',
    sampleUnavailable: '(no sample)',
  },
  tutorial: {
    dragHint: 'Drag a segment name to reorder or move it to another row',
    dismiss: 'Got it',
  },
  langToggle: {
    shortLabel: '中',
    ariaLabel: 'Switch to Chinese interface',
    switchedAnnounce: 'Switched to English interface',
  },
  defaultDescriptor: {
    iconOn: 'Shown',
    iconOff: 'Hidden',
    emptyPrefix: '(empty)',
    noFgOverride: 'None (not overridden)',
    noThreshold: 'None (all 10 buckets use the terminal default color)',
    barOn: 'On',
    barOff: 'Off',
  },
  previewAria: {
    groupLabel: 'Statusline preview',
    emptyLabel: 'Statusline preview: no segments enabled',
    rowPrefix: (n) => `Row ${n}: `,
  },
  ui: {
    backLink: '← Back to ClientKit',
    title: 'Claude Code Statusline Generator',
    headerDesc:
      'Design a custom Claude Code statusline: pick the segments to show, reorder them by dragging or the up/down buttons, choose colors and percentage threshold coloring, preview live, and generate bash (.sh) and PowerShell (.ps1) scripts plus a settings.json snippet in one click. Everything runs in your browser; nothing is uploaded.',
    previewHeading: 'Live preview',
    previewBgLegend: 'Preview background',
    bgDark: 'Dark',
    bgLight: 'Light',
    previewScenarioLegend: 'Preview scenario',
    scenarioFullShort: 'Full',
    scenarioFullFull: 'Full (all fields present)',
    scenarioEarlyShort: 'Early',
    scenarioEarlyFull: 'Early session (all nullable fields null)',
    scenarioCondShort: 'Cond.',
    scenarioCondFull: 'Cond. — all conditional fields absent',
    scenarioWinShort: 'Windows',
    scenarioWinFull: 'Windows long path + CJK',
    outputOpen: 'Generate scripts',
    mockClockHint: 'The preview uses a fixed demo clock; the generated script uses the real clock at runtime.',
    globalHeading: 'Global settings',
    modeLegend: 'Display mode',
    modePlain: 'Plain text (plain)',
    modePowerline: 'Powerline (color blocks + arrows)',
    separatorLabel: 'Separator',
    separatorCustomLabel: 'Custom separator (≤8 chars, plain mode only)',
    powerlineArrowLabel: 'Powerline arrow',
    powerlineArrowHint:
      'Requires a special font in your terminal that supports this glyph; otherwise the arrow shows as a box or garbled text.',
    lastArrowCapLabel: 'Cap the last Powerline segment with a closing arrow',
    settingsPathLabel: 'Script path in settings.json',
    noBoundaryHint:
      'All enabled segments use the terminal default color and the Powerline arrow is off: adjacent blocks will have no distinguishable boundary. Consider enabling the arrow or giving some segments a color.',
    skipNavLabel: 'Quick section jump',
    skipToSettings: 'Skip to settings',
    skipToCatalog: 'Skip to catalog',
    skipToSelected: 'Skip to selected',
    skipToPreview: 'Skip to preview',
    skipToOutput: 'Skip to generated scripts',
    catalogCollapseSummary: 'Segment catalog list',
    catalogHint:
      'Check a segment to enable it: once checked, the item is greyed in place and marked “Added”, and its full control row appears in the matching row group of the middle “Selected” column, where you can reorder, color, assign a display row, and so on; uncheck it to remove.',
    catalogAlwaysHeading: 'Always-present segments',
    catalogAlwaysDesc: 'Fields always present in the stdin JSON; can be shown anytime.',
    catalogPercentageHeading: 'Percentage segments',
    catalogPercentageDesc: 'Can carry percentage threshold coloring; when the value is null it shows -- with no threshold color.',
    catalogConditionalHeading: 'Conditional segments',
    catalogConditionalDesc: 'When the condition does not hold the field is absent and the whole segment is dropped.',
    catalogShelloutHeading: 'Shell-out segments',
    catalogShelloutDesc: 'Values come from running external commands (git / clock), not the stdin JSON.',
    selectedSectionLabel: 'Selected (grouped by row)',
    sortHint:
      'How to reorder: with the mouse, grab a segment card (the ⠿ handle or its top) and drag it anywhere or to another row; with the keyboard, use each segment’s ↑/↓ buttons to swap adjacent items within a row, or press the arrow keys in the “Show in row N” dropdown to change its row.',
    addPendingRow: '+ Add a row',
    addPendingRowAria: 'Add a row',
    outputHeading: 'Generate scripts',
    outputBashHeading: 'bash script (statusline.sh)',
    copyBash: 'Copy bash script',
    downloadBash: 'Download bash script',
    outputPs1Heading: 'PowerShell script (statusline.ps1)',
    copyPs1: 'Copy PowerShell script',
    downloadPs1: 'Download PowerShell script',
    outputSettingsHeading: 'settings.json snippet',
    copySettings: 'Copy settings snippet',
    downloadSettings: 'Download settings snippet',
    close: 'Close',
  },
}

/** locale → 完整字典（純函式；呼叫端注入取用，不逐 key 查表）。 */
export function t(locale: Locale): Messages {
  return locale === 'en' ? en : zhHant
}
