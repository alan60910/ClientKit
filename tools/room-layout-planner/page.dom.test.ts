// @vitest-environment jsdom
/**
 * T2.1（(internal design doc) §Frontend／TASKS.md T2.1）：
 * index.html／style.css 的靜態契約——只剖析 HTML／CSS 原始文字，不 import
 * main.ts（M2.5 才建立）。skip-nav 謂詞、五圖層、label 關聯、reduce
 * motion、雙主題警示色 token 等規則見 PLAN §Frontend／§Accessibility
 * checklist／§Performance budget，湊字面契約見 sp9/REPORT.md。
 */
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allMediaBlockRanges } from '../statusline-builder/css-scan-test-utils.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const HTML_PATH = path.resolve(DIR, 'index.html')
const CSS_PATH = path.resolve(DIR, 'style.css')
const RAW_HTML = readFileSync(HTML_PATH, 'utf-8')
const CSS = readFileSync(CSS_PATH, 'utf-8')
/** T5.4：`props.css` 的規則已併回 `style.css`，該檔只剩一行註解。 */
const PROPS_CSS = readFileSync(path.resolve(DIR, 'props.css'), 'utf-8')

const HEAD_MATCH = /<head[^>]*>([\s\S]*)<\/head>/.exec(RAW_HTML)
if (HEAD_MATCH === null) throw new Error('index.html 缺少 <head>')
const HEAD_HTML = HEAD_MATCH[1]!

const BODY_MATCH = /<body[^>]*>([\s\S]*)<\/body>/.exec(RAW_HTML)
if (BODY_MATCH === null) throw new Error('index.html 缺少 <body>')
const BODY_HTML = BODY_MATCH[1]!

document.body.innerHTML = BODY_HTML

// T5.3：新增 `#props-section`（DOM 序在設定與清單之間），skip-nav 同序四條。
const SKIP_TARGETS = ['#board-section', '#settings-section', '#props-section', '#items-section']

describe('skip-nav：四條落點', () => {
  it('nav.skip-nav 內恰有 4 條連結，href 依序為畫布／設定／屬性／清單', () => {
    const links = Array.from(document.querySelectorAll('nav.skip-nav a'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SKIP_TARGETS)
  })

  it.each(SKIP_TARGETS)('%s 落點存在且 tabindex="-1"', (href) => {
    const target = document.querySelector(href)
    expect(target, `${href} 應存在`).not.toBeNull()
    expect(target!.getAttribute('tabindex')).toBe('-1')
  })

  it('四條連結皆帶對應 data-testid', () => {
    const testids = Array.from(document.querySelectorAll('nav.skip-nav a')).map((a) =>
      a.getAttribute('data-testid'),
    )
    expect(testids).toEqual(['skip-to-board', 'skip-to-settings', 'skip-to-props', 'skip-to-list'])
  })
})

describe('live region：#status／#error', () => {
  it('#status role=status、aria-live=polite', () => {
    const el = document.getElementById('status')
    expect(el).not.toBeNull()
    expect(el!.getAttribute('role')).toBe('status')
    expect(el!.getAttribute('aria-live')).toBe('polite')
  })

  it('#error role=alert', () => {
    const el = document.getElementById('error')
    expect(el).not.toBeNull()
    expect(el!.getAttribute('role')).toBe('alert')
  })
})

describe('標題結構：單一 h1、四個頂層 section > h2（順序：畫布／設定／屬性／清單）', () => {
  it('文件內恰有一個 h1', () => {
    expect(document.querySelectorAll('h1').length).toBe(1)
  })

  it('main 的直接子 section 各帶一個 h2，依序為 board/settings/props/items-heading', () => {
    const ids = Array.from(document.querySelectorAll('main > section > h2')).map((h) => h.id)
    expect(ids).toEqual(['board-heading', 'settings-heading', 'props-heading', 'items-heading'])
  })
})

describe('#board-svg：a11y 與五圖層', () => {
  function svg(): SVGElement {
    return document.getElementById('board-svg') as unknown as SVGElement
  }

  it('role=group、aria-label、preserveAspectRatio、aria-describedby 指向 #board-hint', () => {
    const el = svg()
    expect(el.getAttribute('role')).toBe('group')
    expect(el.getAttribute('aria-label')).toBe('房間平面圖')
    expect(el.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(el.getAttribute('aria-describedby')).toBe('board-hint')
    expect(document.getElementById('board-hint')).not.toBeNull()
  })

  it('五個圖層 id 依序：layer-floor/layer-walls/layer-items/layer-doors/layer-overlay', () => {
    const ids = Array.from(svg().children).map((child) => child.id)
    expect(ids).toEqual(['layer-floor', 'layer-walls', 'layer-items', 'layer-doors', 'layer-overlay'])
  })

  it('layer-overlay 內巢 overlay-static／overlay-dynamic', () => {
    const overlay = document.getElementById('layer-overlay')!
    expect(Array.from(overlay.children).map((c) => c.id)).toEqual(['overlay-static', 'overlay-dynamic'])
  })
})

describe('表單控件：每個 <input>/<select> 於 .sr-only 之外皆有 label[for] 對應唯一 id', () => {
  it('label[for] 全數指向存在、唯一的控件 id', () => {
    const controls = Array.from(document.querySelectorAll('input, select')).filter(
      (el) => !el.classList.contains('sr-only'),
    )
    expect(controls.length).toBeGreaterThan(0)

    const seenIds = new Set<string>()
    for (const el of controls) {
      const id = el.id
      expect(id, `控件 ${el.outerHTML.slice(0, 60)} 缺少 id`).not.toBe('')
      expect(seenIds.has(id), `id="${id}" 重複`).toBe(false)
      seenIds.add(id)

      const label = document.querySelector(`label[for="${id}"]`)
      expect(label, `id="${id}" 找不到對應 label[for]`).not.toBeNull()
    }
  })
})

describe('#props-section：三份表單預設隱藏、提示句與錯誤元素就位（T5.3）', () => {
  it.each(['props-item', 'props-block', 'props-door'])('%s 為 form 且預設 hidden', (id) => {
    const form = document.getElementById(id)
    expect(form).not.toBeNull()
    expect(form!.tagName).toBe('FORM')
    expect(form!.hasAttribute('hidden')).toBe(true)
  })

  it('#props-empty 提示句非空；#props-error 為 aria-live polite 的空元素', () => {
    expect((document.getElementById('props-empty')?.textContent ?? '').length).toBeGreaterThan(0)
    const error = document.getElementById('props-error')
    expect(error).not.toBeNull()
    expect(error!.getAttribute('aria-live')).toBe('polite')
    expect(error!.textContent).toBe('')
  })

  it('門的「牆」與方塊的「種類」為唯讀文字：該區內沒有 wall／kind 輸入控件（D6）', () => {
    for (const id of ['props-door-wall', 'props-block-kind']) {
      const el = document.getElementById(id)
      expect(el).not.toBeNull()
      expect(el!.tagName).toBe('SPAN')
    }
  })

  it('四面需留欄位齊備且各有 label[for]', () => {
    for (const side of ['n', 'e', 's', 'w']) {
      const id = `props-item-need-${side}`
      expect(document.getElementById(id), `${id} 應存在`).not.toBeNull()
      expect(document.querySelector(`label[for="${id}"]`), `${id} 應有 label`).not.toBeNull()
    }
  })

  it('#props-swatches 帶 8 顆快選色，色碼與 #color-swatches 同一組', () => {
    const colorsOf = (selector: string): string[] =>
      Array.from(document.querySelectorAll(`${selector} button.swatch`)).map(
        (b) => b.getAttribute('data-color') ?? '',
      )
    const props = colorsOf('#props-swatches')
    expect(props).toHaveLength(8)
    expect(props).toEqual(colorsOf('#color-swatches'))
  })
})

describe('三個分析 switch：button[aria-pressed]', () => {
  it.each(['sw-distance', 'sw-warnings', 'sw-swing'])('%s 帶 aria-pressed', (id) => {
    const el = document.getElementById(id)
    expect(el).not.toBeNull()
    expect(el!.hasAttribute('aria-pressed')).toBe(true)
  })

  it.each(['sw-distance', 'sw-warnings', 'sw-swing'])('%s 帶 .btn 與 pill 形 .switch（T5.4）', (id) => {
    const el = document.getElementById(id)!
    expect(el.classList.contains('btn')).toBe(true)
    expect(el.classList.contains('switch')).toBe(true)
  })
})

describe('按鈕系統：.btn 與變體（T5.4，M5 回饋 4）', () => {
  it('#btn-add 為主鈕（btn btn--primary）', () => {
    const el = document.getElementById('btn-add')!
    expect(el.classList.contains('btn')).toBe(true)
    expect(el.classList.contains('btn--primary')).toBe(true)
  })

  it.each(['btn-clear', 'btn-purge'])('%s 為危險鈕（btn btn--danger）', (id) => {
    const el = document.getElementById(id)!
    expect(el.classList.contains('btn')).toBe(true)
    expect(el.classList.contains('btn--danger')).toBe(true)
  })

  it.each(['#io-panel', '.board-toolbar', '.pager'])('%s 內每個 <button> 都有 .btn', (scope) => {
    const containers = Array.from(document.querySelectorAll(scope))
    expect(containers.length).toBeGreaterThan(0)
    for (const container of containers) {
      const buttons = Array.from(container.querySelectorAll('button'))
      expect(buttons.length).toBeGreaterThan(0)
      for (const button of buttons) {
        expect(button.classList.contains('btn'), `${scope} 內的「${button.textContent}」缺少 .btn`).toBe(
          true,
        )
      }
    }
  })
})

describe('#report-summary 常駐於畫布分區（T5.4，M5 回饋 8）', () => {
  it('是 #board-section 的後裔，且在 #board 之前', () => {
    const summary = document.getElementById('report-summary')!
    const boardSection = document.getElementById('board-section')!
    const board = document.getElementById('board')!
    expect(boardSection.contains(summary)).toBe(true)
    expect(summary.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(
      0,
    )
  })

  it('#report-list 仍留在畫布下方的 #report-section', () => {
    const list = document.getElementById('report-list')!
    expect(list.closest('#report-section')).not.toBeNull()
  })
})

describe('props.css：規則已併回 style.css（T5.4）', () => {
  it('檔內沒有任何規則區塊（`{` 出現 0 次）', () => {
    expect((PROPS_CSS.match(/\{/g) ?? []).length).toBe(0)
  })
})

describe('其他固定契約節點', () => {
  it('#import-file 帶 class sr-only', () => {
    const el = document.getElementById('import-file')
    expect(el).not.toBeNull()
    expect(el!.classList.contains('sr-only')).toBe(true)
  })

  it('#btn-save-shared 帶 hidden', () => {
    const el = document.getElementById('btn-save-shared')
    expect(el).not.toBeNull()
    expect(el!.hasAttribute('hidden')).toBe(true)
  })

  it('主題切換鈕存在', () => {
    expect(document.querySelector('.theme-toggle')).not.toBeNull()
  })
})

describe('每個帶 id 的元素皆有同值 data-testid（DOM 契約：ids are load-bearing）', () => {
  it('全文件掃描：id → data-testid 一一對應', () => {
    const withId = Array.from(document.querySelectorAll('[id]'))
    expect(withId.length).toBeGreaterThan(0)
    for (const el of withId) {
      expect(el.getAttribute('data-testid'), `#${el.id} 缺少對應 data-testid`).toBe(el.id)
    }
  })
})

describe('<head>：<title> 與 meta description（讀原始文字）', () => {
  it('<title> 為「房間家具擺放規劃器 - ClientKit」', () => {
    expect(/<title>([^<]*)<\/title>/.exec(HEAD_HTML)?.[1]).toBe('房間家具擺放規劃器 - ClientKit')
  })

  it('meta description 存在且為一句 zh-Hant 摘要', () => {
    const match = /<meta\s+name="description"\s+content="([^"]*)"/.exec(HEAD_HTML)
    expect(match).not.toBeNull()
    expect(match![1]!.length).toBeGreaterThan(0)
  })
})

describe('index.html 不寫長註解（HTML 註解逐條 ≤200 字元）', () => {
  it('全文件掃描：無 HTML 註解超過 200 字元', () => {
    const comments = RAW_HTML.match(/<!--[\s\S]*?-->/g) ?? []
    expect(comments.length).toBeGreaterThan(0)
    for (const c of comments) {
      expect(c.length, `過長註解：${c.slice(0, 40)}...`).toBeLessThanOrEqual(200)
    }
  })
})

describe('style.css：#board-svg 規則內含 touch-action: none', () => {
  it('定位 #board-svg 規則區塊並比對內文', () => {
    const ranges = allMediaBlockRanges(CSS, /#board-svg\s*\{/)
    expect(ranges.length).toBe(1)
    const block = CSS.slice(ranges[0]!.start, ranges[0]!.end)
    expect(block).toMatch(/touch-action:\s*none/)
  })
})

describe('style.css：prefers-reduced-motion 唯一區塊，內含 transition', () => {
  it('@media (prefers-reduced-motion: reduce) 恰一個區塊，內含 transition', () => {
    const ranges = allMediaBlockRanges(CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    expect(ranges.length).toBe(1)
    const block = CSS.slice(ranges[0]!.start, ranges[0]!.end)
    expect(block).toMatch(/transition/)
  })
})

describe('style.css：@media (min-width: 1100px) 內含 grid-template-areas 三列', () => {
  it('區塊內文含 "settings board"、"props board"（T5.4 併檔）與 "items board"', () => {
    const ranges = allMediaBlockRanges(CSS, /@media\s*\(min-width:\s*1100px\)/)
    expect(ranges.length).toBeGreaterThan(0)
    const block = CSS.slice(ranges[0]!.start, ranges[0]!.end)
    expect(block).toMatch(/grid-template-areas/)
    expect(block).toContain('settings board')
    expect(block).toContain('props board')
    expect(block).toContain('items board')
    // 併檔後 `#props-section` 的 grid-area 也必須落在同一個區塊內。
    expect(block).toMatch(/#props-section\s*\{[^}]*grid-area:\s*props/)
  })
})

describe('style.css：#report-list 高度上限 30dvh（T5.4，M5 回饋 8）', () => {
  it('定位 #report-list 規則區塊並比對內文', () => {
    const ranges = allMediaBlockRanges(CSS, /#report-list\s*\{/)
    expect(ranges.length).toBe(1)
    const block = CSS.slice(ranges[0]!.start, ranges[0]!.end)
    expect(block).toMatch(/max-height:\s*30dvh/)
    expect(block).toMatch(/overflow:\s*auto/)
  })
})

describe('style.css：雙主題警示色 token', () => {
  const TOKEN_RE = /(--rlp-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/g

  function extractTokens(block: string): Array<[string, string]> {
    const out: Array<[string, string]> = []
    let m: RegExpExecArray | null
    const re = new RegExp(TOKEN_RE.source, 'g')
    while ((m = re.exec(block)) !== null) out.push([m[1]!, m[2]!.toLowerCase()])
    return out.sort((a, b) => a[0].localeCompare(b[0]))
  }

  it('淺色 :root 宣告 --rlp-warn／--rlp-tight／--rlp-collide 皆為 6 碼 hex', () => {
    const ranges = allMediaBlockRanges(CSS, /:root\s*\{/)
    expect(ranges.length).toBe(1)
    const block = CSS.slice(ranges[0]!.start, ranges[0]!.end)
    for (const name of ['--rlp-warn', '--rlp-tight', '--rlp-collide']) {
      const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(block)
      expect(m, `${name} 應在淺色 :root 內宣告 6 碼 hex`).not.toBeNull()
    }
  })

  it('dark(media) 與 dark(attr) 兩區塊宣告的 --rlp-* token 鍵值集合相同', () => {
    const mediaRanges = allMediaBlockRanges(CSS, /@media\s*\(prefers-color-scheme:\s*dark\)/)
    expect(mediaRanges.length).toBe(1)
    const mediaBlock = CSS.slice(mediaRanges[0]!.start, mediaRanges[0]!.end)

    const attrRanges = allMediaBlockRanges(CSS, /:root\[data-theme=['"]dark['"]\]\s*\{/)
    expect(attrRanges.length).toBe(1)
    const attrBlock = CSS.slice(attrRanges[0]!.start, attrRanges[0]!.end)

    const mediaTokens = extractTokens(mediaBlock)
    const attrTokens = extractTokens(attrBlock)
    expect(mediaTokens.length).toBeGreaterThan(0)
    expect(mediaTokens).toEqual(attrTokens)
  })
})

describe('體積預算：gzip level 9', () => {
  it('index.html ≤ 12000 bytes（gzip level 9）', () => {
    expect(gzipSync(RAW_HTML, { level: 9 }).length).toBeLessThanOrEqual(12000)
  })

  it('style.css ≤ 8000 bytes（gzip level 9）', () => {
    expect(gzipSync(CSS, { level: 9 }).length).toBeLessThanOrEqual(8000)
  })
})
