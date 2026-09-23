/**
 * T5.4（(internal design doc) §D5 A-1／A-3／A-4；
 * TASKS.md T5.4）：i18n **DOM-facing** 套用器——`messages.ts`（純核心）
 * 的唯一合法 DOM 消費端。四純模組（row-groups.ts／row-select.ts／
 * resolve.ts／segments.ts）走 locale／`t()` 注入取得文案、不 import 本
 * 檔（見 messages.ts 檔頭「純度硬約束」）；本檔反過來只管 DOM 讀寫與
 * localStorage，不含任何文案內容本身（單一事實來源恆在 messages.ts）。
 *
 * ── 三個職責 ──
 * 1. `currentLocale`／`setLocale`：localStorage 持久化＋`<html lang>`
 *    同步。key＝`clientkit-statusline-builder-lang`（06a／09-PLAN §D5 A-1
 *    慣例：`<brand>-<scope>-<name>`，品牌前綴 sprint 17 M1 改為
 *    `clientkit`）——與本工具既有設定存檔 key
 *    `clientkit:statusline-builder:config`（`config-storage-key.ts`
 *    `STORAGE_KEY`，冒號式）並存：後者為 06a 前既有 key，依 SPEC Conventions 明文
 *    grandfathered、不追溯改名，兩種命名式同時存在於本工具頁屬 SPEC
 *    允許範圍。存取比照 `src/theme.ts` 慣例：全部惰性存取（函式內部才
 *    碰 `localStorage`/`document`），best-effort try/catch（讀寫失敗——
 *    無痕模式／配額——一律靜默降級，不阻斷語言判斷或切換本身）。
 * 2. `applyI18n(root, locale)`：掃描 `root`（含自身，若為 Element）與其
 *    子樹的 `[data-i18n]`／`[data-i18n-attr]`，以 `t(locale)` 的對應值
 *    寫回。
 *    - `data-i18n="a.b.c"`：點分路徑，逐層走訪 `t(locale)` 物件，終值須
 *      為字串（非字串——如函式鍵／中途物件——視為不合法，不改動節點、
 *      console.warn 提示鍵路徑，避免無聲侵蝕算做預期行為）才寫入
 *      `textContent`。要求目標元素本身除文字節點外不應另有子元素（清空
 *      重寫 textContent 會連帶清掉裝飾用子節點）——本任務示範面選用的
 *      節點皆為純文字葉節點，見 index.html 各處標注。
 *    - `data-i18n-attr="attr1:key1;attr2:key2"`：分號分隔的
 *      `屬性名:訊息鍵路徑` 配對表（本檔定案格式；鍵路徑本身可含點號，
 *      不與配對分隔的分號/冒號衝突）。逐一 `setAttribute`，不動節點文字
 *      與子樹，故可安全用於容器元素（如 `aria-label`）。
 * 3. `initLangToggle(button)`：語言切換鈕 wiring——顯示「目標語言」短碼
 *    與可及名稱皆由 `messages.ts` 的 `langToggle` 域以 `data-i18n`／
 *    `data-i18n-attr` 承載（button 節點本身不在 clone 範圍內，屬主文件
 *    樹，開機與切換時皆由 `applyI18n(document, locale)` 一併翻轉，不需
 *    另立同步函式）；click → 取反 locale → `setLocale` → 對 `document`
 *    重跑一次 `applyI18n`。
 *
 * ── A-3 template clone 時序（本任務核心契約）──
 * 7 個 `<template>` 的內文不在主文件樹，開機期的 `applyI18n(document,
 * locale)` 掃不到（`<template>.content` 是獨立 DocumentFragment，不掛
 * 在主文件樹下）。定案：**每個 clone 點（main.ts 的
 * `buildSegmentRow`／`createColorPickerCore`／`buildThresholdEditor`／
 * `createRowGroupContainer`）於 `instantiateTemplate` 之後、其餘欄位
 * 賦值之前，立即對 clone 出的根節點呼叫 `applyI18n(clonedRoot,
 * currentLocale())`**——本任務僅讓「閾值 6 模板選項名」與「色選器一兩條
 * 靜態文案（ANSI 索引 label／索引加減鈕 aria-label）」實際掛
 * `data-i18n`／`data-i18n-attr` 走過這條管線（證機制可行），其餘
 * template 內文（segment-row-template／segment-row-group-template 等
 * 尚未標記的靜態文案）留給 T5.5 全量遷移時掛標記——四個 clone 點已無條件
 * 呼叫 `applyI18n`，屆時新增標記即自動生效，不需再動 main.ts 的 clone
 * 點本身。
 *
 * ── A-4 切換時的「中間態」邊界（本任務最簡生效策略，非五步序全量）──
 * `setLocale` 本身**只**管持久化＋`<html lang>`，不觸發任何重繪（T5.6
 * 五步序才是完整重繪責任）。本任務的切換生效＝呼叫端（main.ts 語言鈕
 * click handler）自行組合 `setLocale(next)` ＋ `applyI18n(document,
 * next)` 兩步：
 * - `applyI18n(document, next)` 對**整個目前文件樹**做一次全量
 *   `querySelectorAll('[data-i18n], [data-i18n-attr]')`——由於所有已
 *   clone 並掛載的 template 實例（segment rows／threshold editors／
 *   color pickers／row groups）皆已是 `document` 的子孫節點，這一次全量
 *   掃描**同時**覆蓋「主文件樹本就存在的 data-i18n 節點」與「先前 clone
 *   時序已套用過、現掛在文件樹上的既有實例」——不需要另外「重跑各 clone
 *   點的追蹤集合」逐一 re-apply，一次 `applyI18n(document, locale)` 即為
 *   兩者的共同上界。
 * - **不含**在此範圍內、故切換當下不會翻轉的：(a) 未走 `data-i18n`／
 *   `data-i18n-attr` 標記、而是由 main.ts 以 `textContent =`／
 *   `setAttribute(...)` 直接寫死值的既有動態組句（如「第 N 列」標題、
 *   `announceGlobal`/`announceMove` 已寫入 live region 的文字、
 *   `THRESHOLD_TEMPLATE_LABELS` 曾經硬編碼之處—— 本任務起改走
 *   `t(currentLocale()).thresholdTemplateLabel`，即時求值故新產生的文字
 *   自然跟隨當下語言，但**先前已寫入 DOM 的舊語言文字不會被追溯翻
 *   轉**）；(b) row-select `<option>` 文字（`rowSelectOptionsForSlots`
 *   走注入而非 data-i18n，需重跑一次 option 同步才會翻轉）；(c) 預覽區
 *   `resolve()` 產出的逐列 aria-label（需重新 resolve 一次）。上述三類
 *   即 PLAN A-4「動態 imperative 文案的翻轉」，明確留給 T5.6 的五步序
 *   重繪處理，本任務不越界處理。
 *
 * ── T5.6 追補：五步序 hook（`initLangToggle` 第二參數）＋
 * `persistLocale`／`syncHtmlLang` 拆分 ──
 * 上述「中間態邊界」三類，加上左欄目錄項名（`.catalog-item__name` 為
 * textContent 直寫，非 data-i18n），即 T5.6 五步序要補的「動態 imperative
 * 文案翻轉」。本檔為此新增：
 * 1. `persistLocale`（私有）／`syncHtmlLang`（匯出）——`setLocale` 原子
 *    組合的兩個構件拆開，供 `initLangToggle` 依五步序時序個別呼叫（見
 *    `setLocale`／`initLangToggle` 各自文件的時序理由）。
 * 2. `initLangToggle(button, onLocaleChanged?)`——第二參數為選填 hook，
 *    click 時序＝`persistLocale(next)` → `applyI18n(document, next)`
 *    （步驟 1）→ `onLocaleChanged?.(next)`（main.ts 接續步驟 2-5：rebuild
 *    中欄／`preview.setLocale`／`syncHtmlLang`／`announceGlobal`，見
 *    main.ts 該接線處文件）。本檔依賴方向不變（仍不 import main.ts）——
 *    callback 型別僅 `(locale: Locale) => void`，由 main.ts 提供實作。
 */
import { DEFAULT_LOCALE, t, type Locale } from './messages.js'

/**
 * localStorage 鍵（09-PLAN §D5 A-1；06a `<brand>-<scope>-<name>` 慣例，
 * 品牌前綴 sprint 17 M1 改為 `clientkit`；字面釘值集中於
 * `src/storage-keys-pin.test.ts`）。與 `config-storage-key.ts`
 * `STORAGE_KEY`（`clientkit:statusline-builder:config`，冒號式舊命名形狀）
 * 並存——後者依 SPEC Conventions 明文 grandfathered，兩式同時存在於本工具
 * 頁屬 SPEC 允許範圍，非本任務遺留的不一致。
 */
export const LANG_STORAGE_KEY = 'clientkit-statusline-builder-lang'

/**
 * 讀使用者手動切換過的語言。值非 `'zh-Hant'`/`'en'`（含未設定、損壞值）
 * 一律退 `DEFAULT_LOCALE`；讀取本身拋錯（如無痕模式封鎖 storage）同樣
 * 吞下退回 `DEFAULT_LOCALE`，不讓壞掉的 storage 打斷語言判斷（比照
 * `src/theme.ts` `getStoredTheme` 慣例）。
 */
export function currentLocale(): Locale {
  try {
    const value = localStorage.getItem(LANG_STORAGE_KEY)
    return value === 'zh-Hant' || value === 'en' ? value : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

/**
 * T5.6（09-PLAN §D5 A-4 五步序）：`setLocale` 的持久化半——**只**寫
 * localStorage（best-effort try/catch），不碰 `<html lang>`。抽出的原因：
 * 五步序要求 `<html lang>` 翻轉排在第 (4) 步（rebuild／preview 重 resolve
 * 之後），但 `currentLocale()`（`msg()`／`segLabel()`／`buildSegmentRows`
 * 等重繪路徑的語言判斷來源）讀的是 localStorage，故持久化本身必須先於
 * 第 (1)-(3) 步——兩個關注點時序不同，遂拆為獨立函式；`setLocale`
 * （見下）組合兩者維持原子契約，供既有直接呼叫測試沿用。
 */
function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, locale)
  } catch {
    // best-effort 持久化，見上方函式註解。
  }
}

/**
 * T5.6：`<html lang>` 同步——五步序第 (4) 步的封裝，亦供 `setLocale`／
 * main.ts 開機同步共用（單一事實來源，避免兩處各自
 * `document.documentElement.setAttribute('lang', ...)`）。
 */
export function syncHtmlLang(locale: Locale): void {
  document.documentElement.setAttribute('lang', locale)
}

/**
 * 持久化語言選擇＋同步 `<html lang>`——`persistLocale`＋`syncHtmlLang` 的
 * 原子組合，供直接呼叫端（測試／非五步序場景）沿用同一次呼叫兩件事都做
 * 完的既有契約。語言切換鈕的五步序改呼叫兩個子函式分開時序（見
 * `initLangToggle`），不再經本函式。
 */
export function setLocale(locale: Locale): void {
  persistLocale(locale)
  syncHtmlLang(locale)
}

/** `root` 本身（若為 Element 且符合 selector）＋其子樹符合 selector 的元素。 */
function selfAndDescendants(root: ParentNode, selector: string): HTMLElement[] {
  const out: HTMLElement[] = []
  if (root instanceof Element && root.matches(selector)) out.push(root as HTMLElement)
  out.push(...Array.from(root.querySelectorAll<HTMLElement>(selector)))
  return out
}

/**
 * 依點分路徑（如 `'thresholdTemplateLabel.traffic'`）走訪 `dict`
 * （`t(locale)` 的回傳物件），終值非字串（函式鍵／中途物件／路徑不存在）
 * 一律回傳 `undefined`——呼叫端據此跳過寫入＋console.warn，不讓打錯字的
 * `data-i18n` 鍵靜默侵蝕成一個「看起來正常但其實沒套用」的空操作。
 */
function resolveMessageValue(dict: unknown, path: string): string | undefined {
  let node: unknown = dict
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * 套用翻譯：`[data-i18n]` 節點 textContent 改寫、`[data-i18n-attr]` 節點
 * 依 `'attr1:key1;attr2:key2'` 格式逐一 setAttribute（見檔頭格式定案）。
 * `root` 可為 `Document`（開機／切換時對整個文件樹）或任一 clone 出的
 * 元素（四個 clone 點：見檔頭「A-3 template clone 時序」）。
 */
export function applyI18n(root: ParentNode, locale: Locale): void {
  const dict = t(locale)

  for (const el of selfAndDescendants(root, '[data-i18n]')) {
    const key = el.dataset.i18n
    if (key === undefined || key === '') continue
    const value = resolveMessageValue(dict, key)
    if (value === undefined) {
      console.warn(`i18n-dom: data-i18n 鍵路徑無法解析或非字串終值：「${key}」`)
      continue
    }
    el.textContent = value
  }

  for (const el of selfAndDescendants(root, '[data-i18n-attr]')) {
    const spec = el.dataset.i18nAttr
    if (spec === undefined || spec === '') continue
    for (const pair of spec.split(';')) {
      const trimmed = pair.trim()
      if (trimmed === '') continue
      const colonAt = trimmed.indexOf(':')
      if (colonAt === -1) {
        console.warn(`i18n-dom: data-i18n-attr 配對格式不合法（缺冒號）：「${trimmed}」`)
        continue
      }
      const attrName = trimmed.slice(0, colonAt).trim()
      const key = trimmed.slice(colonAt + 1).trim()
      const value = resolveMessageValue(dict, key)
      if (value === undefined) {
        console.warn(`i18n-dom: data-i18n-attr 鍵路徑無法解析或非字串終值：「${key}」（屬性 ${attrName}）`)
        continue
      }
      el.setAttribute(attrName, value)
    }
  }
}

/**
 * 語言切換鈕 wiring（T5.6 擴充，見檔頭「A-4」原始說明與下方新段落）：
 * click → 取反目前語言 → 持久化 → 對 `document` 重跑一次 `applyI18n`
 * （五步序第 (1) 步）→ 呼叫 `onLocaleChanged`（選填 hook，供 main.ts 接
 * 續五步序第 (2)-(5) 步：rebuild 中欄／強制 preview 重 resolve／
 * `syncHtmlLang`／播報——依賴方向見下）。按鈕本身可見文字／可及名稱走
 * `data-i18n`／`data-i18n-attr`（`messages.ts` 的 `langToggle` 域），
 * 不在本函式內另行 setAttribute／textContent 賦值——第 (1) 步的
 * `applyI18n(document, next)` 已涵蓋按鈕自身（它是主文件樹節點）。
 *
 * ── T5.6：五步序落點與 hook 設計（09-PLAN §D5 A-4）──
 * 本檔（i18n-dom.ts）不得 import main.ts（依賴方向鎖死，見檔頭）——中欄
 * segment rows／preview controller／`announceGlobal` 皆為 main.ts 內部
 * 狀態與函式，本檔無從得知。故本函式只完成「持久化＋第 (1) 步」這段
 * 不依賴 main.ts 的部分，其餘四步交給 `onLocaleChanged?.(next)` callback
 * ——main.ts 接線時傳入一個執行「rebuild／preview.setLocale／
 * syncHtmlLang／announceGlobal」四步的函式（見 main.ts 該接線處文件）。
 * `persistLocale` 必須先於 `applyI18n`／callback 執行——`currentLocale()`
 * 讀 localStorage，而 `msg()`／`segLabel()`／`buildSegmentRows` 等 main.ts
 * 內部重繪路徑皆經 `currentLocale()` 取得目前語言，若不先持久化，rebuild
 * 讀到的仍是切換前的語言。`<html lang>` 翻轉（第 (4) 步）刻意**不**在此
 * 函式內完成——PLAN 明訂其序在 rebuild／preview 重 resolve 之後，故隨
 * `onLocaleChanged` callback 一併交給 main.ts（呼叫 `syncHtmlLang`，見其
 * 匯出）；本檔僅提供 `syncHtmlLang` 這個建構塊，不在此處呼叫它。
 */
export function initLangToggle(button: HTMLButtonElement, onLocaleChanged?: (locale: Locale) => void): void {
  button.addEventListener('click', () => {
    const next: Locale = currentLocale() === 'en' ? 'zh-Hant' : 'en'
    persistLocale(next)
    applyI18n(document, next)
    onLocaleChanged?.(next)
  })
}
