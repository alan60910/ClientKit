// @vitest-environment jsdom
/**
 * T4.3（(internal design doc) §D4 A-3；TASKS.md
 * T4.3）：skip-nav 改造回歸測試。T2.1（(internal design doc)
 * PLAN.md §D2；TASKS.md T2.1）追加更新：三欄終形落地後「跳至預覽」的
 * 行為描述隨條件式捲動停點判定調整（見下方該 describe 區塊）。
 *
 * 「跳至產出腳本」原 `href="#output-section"`，該 id 隨 T4.2 dialog 化
 * 消失、連結淪為 no-op（T4.2 report 交接明載）。本 task 改為 main.ts
 * 顯式 click handler（`wireSkipToOutput`）：`preventDefault()` 後聚焦
 * 「產出腳本」鈕（`#output-dialog-open`）本身，**不**自動開啟 dialog——
 * skip 的目的是「到達控制項」，非「觸發」。href 改指該鈕 id 僅作無 JS
 * 環境的語意化備援。T2.1 未改此節。
 *
 * 「跳至預覽」href 本身未改（`#preview-section`，T4.3／T2.1 皆未動）；
 * 但 T2.1 起 `#preview-section` 依「捲動停點條件式」判定移除了
 * tabindex="0"（見 index.html `#preview-section` 節點自身註解的完整
 * 論證：40dvh 高度預算已遷入 `#preview-terminal` 自身，外層不再自身
 * 捲動）——原生錨點跳轉的行為隨之從「捲動並聚焦」變為「僅捲動、不
 * 奪取焦點」（同「跳至已選擇」既有慣例），此檔下方對應斷言已同步改寫。
 *
 * 回歸網比照既有 preview-band.dom.test.ts／output-dialog.dom.test.ts 的
 * 「先以 jsdom 剖析真實 index.html 取得 <body>、動態 import main.ts
 * 觸發其 init()」全頁面整合測試形（見該二檔檔頭說明，不重複抄錄）。
 *
 * sprint 15 T3.2（(internal design doc) §D4「skip-nav
 * 重置與補全」）：3 條 → 5 條——新增「跳至設定」（排第一）／「跳至目錄」，
 * 下方各 describe 區塊同步擴充；本檔下方另加一組讀 style.css 原始文字的
 * `scroll-margin-top` 補償契約案（比照 layout-columns.dom.test.ts 既有
 * 「CSS 面讀原始文字比對、不靠 getComputedStyle」慣例，jsdom 無真實
 * layout 引擎無法驗證幾何效果，此案只鎖字面契約）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { allMediaBlockRanges } from './css-scan-test-utils.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const HTML_PATH = path.resolve(DIR, 'index.html')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>，無法取得測試骨架')
const BODY_HTML = BODY_MATCH[1]

const STYLE_CSS = readFileSync(path.resolve(DIR, 'style.css'), 'utf-8')

/** 清空 localStorage＋重灌乾淨 DOM＋重置模組快取後啟動 main.ts（同既有 dom.test 慣例）。 */
async function boot(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = BODY_HTML
  vi.resetModules()
  await import('./main.js')
}

function skipToOutputLink(): HTMLAnchorElement {
  return document.querySelector('[data-testid="skip-to-output"]') as HTMLAnchorElement
}

function outputOpenBtn(): HTMLButtonElement {
  return document.getElementById('output-dialog-open') as HTMLButtonElement
}

function outputDialogEl(): HTMLDialogElement {
  return document.getElementById('output-dialog') as HTMLDialogElement
}

describe('T4.3 skip-nav：「跳至產出腳本」聚焦鈕本身（不觸發開啟）', () => {
  beforeEach(async () => {
    await boot()
  })

  it('href 指向產出鈕 id（無 JS 環境語意化備援），非已消失的 #output-section', () => {
    expect(skipToOutputLink().getAttribute('href')).toBe('#output-dialog-open')
  })

  it('click → document.activeElement 為「產出腳本」鈕本身', () => {
    outputOpenBtn().blur() // 確保還原斷言不是「焦點本來就沒動過」的偽陽性
    skipToOutputLink().click()
    expect(document.activeElement).toBe(outputOpenBtn())
  })

  it('click → dialog 未開啟（skip 目的是到達控制項，非觸發）', () => {
    skipToOutputLink().click()
    expect(outputDialogEl().hasAttribute('open')).toBe(false)
  })

  it('click 事件被 preventDefault：不留下 location.hash 副作用（原生錨點跳轉未發生）', () => {
    const before = window.location.hash
    skipToOutputLink().click()
    expect(window.location.hash).toBe(before)
  })
})

describe('T4.3／T2.1 skip-nav：「跳至預覽」語意落點確認（href 未改，行為隨 T2.1 條件式停點判定調整）', () => {
  beforeEach(async () => {
    await boot()
  })

  it('href 仍指向 #preview-section', () => {
    const link = document.querySelector('nav.skip-nav a[href="#preview-section"]')
    expect(link).not.toBeNull()
  })

  it('#preview-section 為中欄預覽本身，role="region"（T2.1 起 tabindex 依條件式判定移除——原生錨點跳轉僅捲動、不再奪取焦點，同「跳至已選擇」既有慣例）', () => {
    const target = document.getElementById('preview-section')
    expect(target).not.toBeNull()
    expect(target!.getAttribute('role')).toBe('region')
    expect(target!.hasAttribute('tabindex')).toBe(false)
  })
})

describe('T4.3／T3.2 skip-nav：結構完整性（五連結皆存在、「跳至已選擇」未變動；sprint 15 T3.2 計數斷言 3→5，見 (internal design doc) §D4）', () => {
  beforeEach(async () => {
    await boot()
  })

  it('nav.skip-nav 內恰有 5 個 .skip-link', () => {
    const nav = document.querySelector('nav.skip-nav')
    expect(nav).not.toBeNull()
    expect(nav!.querySelectorAll('.skip-link').length).toBe(5)
  })

  it('「跳至已選擇」連結未變動（href 仍指 #selected-section）', () => {
    const link = document.querySelector('nav.skip-nav a[href="#selected-section"]')
    expect(link).not.toBeNull()
  })
})

describe('T3.2 skip-nav：五條落點（(internal design doc) §D4）', () => {
  beforeEach(async () => {
    await boot()
  })

  it('五連結序＝設定 → 目錄 → 已選擇 → 預覽 → 產出腳本（PLAN §D4 表；「跳至設定」排第一以降低鍵擊數）', () => {
    const hrefs = Array.from(document.querySelectorAll('nav.skip-nav .skip-link')).map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs).toEqual([
      '#global-section',
      '#catalog-section',
      '#selected-section',
      '#preview-section',
      '#output-dialog-open',
    ])
  })

  it('「跳至設定」連結存在、落點為 #global-section，且對應 i18n key（新增）', () => {
    const link = document.querySelector('nav.skip-nav a[href="#global-section"]')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('data-i18n')).toBe('ui.skipToSettings')
    expect(document.getElementById('global-section')).not.toBeNull()
  })

  it('「跳至目錄」連結存在、落點為 #catalog-section（目錄欄外層容器，不掛 <summary>），且對應 i18n key（新增）', () => {
    const link = document.querySelector('nav.skip-nav a[href="#catalog-section"]')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('data-i18n')).toBe('ui.skipToCatalog')
    const target = document.getElementById('catalog-section')
    expect(target).not.toBeNull()
    expect(target!.tagName).not.toBe('SUMMARY')
  })

  it('五個落點錨定元素皆存在於文件內（快照謂詞：每個 skip 連結的 href 皆可解析到真實節點）', () => {
    for (const href of [
      '#global-section',
      '#catalog-section',
      '#selected-section',
      '#preview-section',
      '#output-dialog-open',
    ]) {
      expect(document.querySelector(href), `${href} 應存在於文件內`).not.toBeNull()
    }
  })
})

describe('T3.2 skip-nav：scroll-margin-top 補償（style.css 原始文字檢核；PLAN §D4「為硬需求」）', () => {
  /** 五個落點的集中多選擇器規則區塊內文（見 style.css「D4 skip-nav 落點補償」節）。 */
  function scrollMarginRuleBlock(): string {
    const match =
      /#catalog-section,\s*\n#selected-section,\s*\n#global-section,\s*\n#preview-section,\s*\n#output-dialog-open\s*\{([^}]*)\}/.exec(
        STYLE_CSS,
      )
    if (match === null) throw new Error('style.css 找不到五個落點的集中 scroll-margin-top 規則')
    return match[1]!
  }

  it('五個落點錨定元素（#catalog-section／#selected-section／#global-section／#preview-section／#output-dialog-open）集中一條規則帶 scroll-margin-top: var(--band-h, 192px)', () => {
    expect(scrollMarginRuleBlock()).toMatch(/scroll-margin-top:\s*var\(--band-h,\s*192px\)/)
  })

  it('scroll-margin-top 規則不落在**任何** @media (min-width: 1100px) 區塊內（頂帶為全斷點 sticky——D1 A2；補償與兩欄僅 ≥1100px 生效的 sticky 無關，不分斷點）', () => {
    // MAGI code review 🟡-4 修法：本案原手刻一份**未強化**的括號深度計數
    // （繞過同批 T2.5「掃描前剝除 CSS 註解」的治本），且只認**第一個**
    // 同條件區塊——而 style.css 自 sprint 15 起同條件區塊實有兩個
    // （三欄版面節／D8 目錄收合節）。整段改呼叫共用 helper：註解剝除
    // 隨模組升級自動生效，且改以「不落在**任何**同條件區塊內」比對，
    // 與本案名稱所宣稱的語意一致（原寫法只比對第一個區塊，規則若被搬進
    // 第二個區塊會靜默漏抓）。同條件區塊的個數契約由
    // layout-columns.dom.test.ts 的顯式計數案把關。
    const mediaRanges = allMediaBlockRanges(STYLE_CSS, /@media \(min-width:\s*1100px\)\s*\{/)
    // 防恆真：區塊一個都沒抓到時，下方「不落在任何區塊內」會恆綠。
    expect(mediaRanges.length).toBeGreaterThan(0)

    const ruleIndex = STYLE_CSS.indexOf('scroll-margin-top: var(--band-h')
    expect(ruleIndex).toBeGreaterThan(-1)

    const enclosing = mediaRanges.filter(
      (range) => ruleIndex >= range.start && ruleIndex < range.end,
    )
    expect(enclosing).toEqual([])
  })
})

/**
 * MAGI code review 🟡-9 修法：SPEC.md Conventions「skip 落點快照謂詞」
 * （`<main>` 內每個頂層分區於 skip-nav 須有對應落點）的**機械守門人**。
 *
 * 立案理由：該規約改寫成快照謂詞的唯一理由就是「可對單一版本快照直接
 * 機械驗證」，但先前只有反向斷言（每個 skip 連結的 href 可解析到節點，
 * 見上方 T3.2 該案）——正向（每個分區都有落點）無人驗，日後新增一個
 * 沒有落點的分區不會紅。
 *
 * 「頂層分區」口徑（與 SPEC 該句括號內釘死的口徑同語意，兩處須同步）：
 *   分區（unit）＝ `<section>` 或 `[role="region"]`，**且**帶 accessible
 *   name（`aria-label`／`aria-labelledby`）——見 `SECTION_UNIT_SELECTOR`。
 *   頂層 ＝ 自 `<main>` 的**直接子節點**出發：
 *     (1) 純版面 wrapper（`TRANSPARENT_LAYOUT_WRAPPERS`，現行僅三欄
 *         grid `.builder-columns`）視為**透明**，以其直接子節點代入
 *         ——wrapper 本身不是分區，它的三欄才是；
 *     (2) 扣除不在 a11y tree 的節點（`[hidden]`／`[aria-hidden="true"]`，
 *         如 `#segment-hidden-pool`）與 `<dialog>` 覆蓋層（關閉態即
 *         `display:none`、開啟態為模態層，其可達性由開啟控件
 *         `#output-dialog-open` 自身的 skip 落點承擔）；
 *     (3) 保留「自身是分區，或其後代至少含一個分區」者——skip-nav 自身、
 *         `#output-status`／`#error-message` 播報通道等非內容區塊因此
 *         **天然**不入列，無須逐個硬編排除（口徑靠性質、不靠名單）。
 *   覆蓋 ＝ 該分區存在至少一條 skip 連結，其 href 解析到分區自身或其
 *   後代（例：「跳至已選擇」落 `#selected-section`，被列區欄
 *   `#list-column` 包含 → 列區欄已覆蓋）。
 */
const SECTION_UNIT_SELECTOR =
  'section[aria-label], section[aria-labelledby], [role="region"][aria-label], [role="region"][aria-labelledby]'
const TRANSPARENT_LAYOUT_WRAPPERS = ['.builder-columns'] as const
const NOT_A_TOP_LEVEL_SECTION_SELECTOR = '[hidden], [aria-hidden="true"], dialog'

/**
 * 現行版本的頂層分區快照（「快照謂詞」的快照面；識別子＝id，無 id 者取
 * 第一個 class）。四個分區由五條 skip 落點完整覆蓋——第五條
 * （`#output-dialog-open`）指向頂帶內的開啟控件，對應被口徑 (2) 排除的
 * `<dialog>`。增刪頂層分區時本常數須連同 SPEC 該句一併重新檢視。
 */
const TOP_LEVEL_SECTION_SNAPSHOT = [
  '#preview-section',
  '#catalog-section',
  '#list-column',
  '.builder-columns__settings',
]

/** 分區識別子（僅供斷言訊息與快照比對可讀性，非行為依據）。 */
function describeUnit(el: Element): string {
  if (el.id.length > 0) return `#${el.id}`
  const [firstClass] = el.className.split(/\s+/).filter((token) => token.length > 0)
  return firstClass === undefined ? el.tagName.toLowerCase() : `.${firstClass}`
}

/** 依上方口徑機械枚舉 `<main>` 內的頂層分區（依 DOM 序）。 */
function enumerateTopLevelSections(): Element[] {
  const main = document.querySelector('main')
  if (main === null) throw new Error('缺少 <main>')

  const candidates: Element[] = []
  for (const child of Array.from(main.children)) {
    if (TRANSPARENT_LAYOUT_WRAPPERS.some((selector) => child.matches(selector))) {
      candidates.push(...Array.from(child.children))
    } else {
      candidates.push(child)
    }
  }

  return candidates.filter((el) => {
    if (el.matches(NOT_A_TOP_LEVEL_SECTION_SELECTOR)) return false
    return el.matches(SECTION_UNIT_SELECTOR) || el.querySelector(SECTION_UNIT_SELECTOR) !== null
  })
}

/** skip-nav 五條連結的 href 各自解析到的節點（解析不到者為上方反向斷言的職責，此處略過）。 */
function skipLinkTargets(): Element[] {
  return Array.from(document.querySelectorAll('nav.skip-nav .skip-link'))
    .map((link) => link.getAttribute('href'))
    .filter((href): href is string => href !== null && href.startsWith('#') && href.length > 1)
    .map((href) => document.querySelector(href))
    .filter((el): el is Element => el !== null)
}

/** 沒有任何 skip 落點覆蓋的頂層分區（謂詞本體；空陣列＝規約成立）。 */
function uncoveredTopLevelSections(): Element[] {
  const targets = skipLinkTargets()
  return enumerateTopLevelSections().filter(
    (unit) => !targets.some((target) => unit === target || unit.contains(target)),
  )
}

describe('T3.2／🟡-9 skip 落點快照謂詞：正向守門（<main> 內每個頂層分區皆有對應 skip 落點；口徑見上方常數與註解、與 SPEC.md Conventions 同語意）', () => {
  beforeEach(async () => {
    await boot()
  })

  it('現行快照＝四個頂層分區（頂帶／目錄欄／列區欄／設定欄），且逐一被五條 skip 落點覆蓋', () => {
    const units = enumerateTopLevelSections()
    // 防恆真：枚舉為空時「逐一覆蓋」會恆綠。
    expect(units.length).toBeGreaterThan(0)
    expect(units.map(describeUnit)).toEqual(TOP_LEVEL_SECTION_SNAPSHOT)
    expect(uncoveredTopLevelSections().map(describeUnit)).toEqual([])
  })

  it.each([
    ['<main> 直接子節點（新分區）', 'main'],
    ['三欄 wrapper 內（新增第四欄；驗 wrapper 透明規則）', '.builder-columns'],
  ])(
    '謂詞敏感度（負向控制）：於 %s 注入一個無對應 skip 落點的分區 → 謂詞必紅',
    (_label, parentSelector) => {
      const parent = document.querySelector(parentSelector)
      expect(parent, `${parentSelector} 應存在`).not.toBeNull()

      const injected = document.createElement('section')
      injected.id = 'injected-section-without-skip-target'
      injected.setAttribute('aria-label', '負向控制用的新分區（刻意無 skip 落點）')
      parent!.append(injected)

      try {
        expect(enumerateTopLevelSections()).toContain(injected)
        expect(uncoveredTopLevelSections().map(describeUnit)).toEqual([
          '#injected-section-without-skip-target',
        ])
      } finally {
        injected.remove()
      }
    },
  )
})
