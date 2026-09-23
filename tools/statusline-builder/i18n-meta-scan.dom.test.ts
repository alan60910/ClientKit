// @vitest-environment jsdom
/**
 * T5.5（(internal design doc) §D5 D5「靜態掃描 meta 案」）：
 * 防回歸長期網——斷言 main.ts 執行期原始碼與 index.html 主文件樹靜態文案
 * **無殘留硬編中文**，全數已收進 messages.ts 字典（走 `t(currentLocale())`
 * 或 `data-i18n`／`data-i18n-attr`）。此案不驗行為、只驗「文案來源單一化」
 * 的機械不變量：任一新硬編中文樣板混入即紅。
 *
 * ── main.ts 掃描（grep 級原始碼掃描）──
 * 合理排除（文件化）：
 * 1. 註解（block `/* *​/` 含 JSDoc／line `//`）——非執行期輸出。
 * 2. `throw new Error(...)`——DOM 結構不變量的開發者面錯誤（如「缺少必要
 *    節點 #x」），永不作為 UI 呈現、使用者不可見，比照 console 排除；
 *    翻譯它對使用者零價值。
 * 3. messages.ts 字典引用（`msg().*`／`segLabel(...)`／`t(...)`）本就無中文
 *    字面，天然不觸發。
 * 偵測範圍＝CJK 統一表意文字（U+4E00–9FFF）＋CJK 符號（U+3000–303F，
 * 含「」）＋全形標點（U+FF00–FFEF，含（）＋，：）。半形符號／`—`／`↺`／
 * `→`／`–`／`≤`／`⠿` 等非中文符號不列入（它們非「文案」）。
 *
 * ── index.html 掃描（DOM 級文字節點掃描）──
 * 以 jsdom 解析 index.html，走訪主文件樹文字節點，任一含 CJK 的文字節點
 * 必須落在下列合法容器之一，否則即紅：
 * 1. 帶 `data-i18n` 的元素子樹（其初始 zh 內文＝字典值，開機 applyI18n
 *    覆寫）——合法。
 * 2. `<template>` 內文（clone 點 applyI18n 覆寫；其標記另由本工具實際
 *    渲染路徑覆蓋，非本掃描責任）。
 * 3. `<head>`（`<title>`／meta／FOUC script／style——文件 metadata，
 *    非本工具 i18n 面）。
 * 4. `<footer>`（全站共用五頁一致 chrome，維持 zh，見 T5.5-report）。
 * 5. `.theme-toggle`（可及名稱由共用 src/theme.ts 硬編 zh「深色模式切換」
 *    ——site chrome，見 T5.5-report）。
 *
 * ── index.html 屬性巡檢（T1.1，(internal design doc)）──
 * 文字節點之外，`aria-label`／`placeholder`／`title`／`alt` 四個
 * accessible-name／使用者可見屬性亦可能硬編 CJK 而漏走 i18n 面——巡檢主
 * 文件樹（`doc.querySelectorAll('*')`，`<template>` 內文不在此樹上，見
 * DOM 標準的 template content model，天然不會被掃到）每個元素的這四個
 * 屬性：值含 CJK 且該元素**未以 `data-i18n-attr` 標記涵蓋該屬性名**
 * （`'attr1:key1;attr2:key2'` 格式，見 i18n-dom.ts `applyI18n` 對
 * `data-i18n-attr` 的解析）即紅。豁免容器沿用上方文字節點掃描慣例：
 * `<template>`／`<head>`／`<footer>`／`.theme-toggle`——同一份 site-chrome
 * 豁免清單，僅換掃描目標（屬性值而非文字節點）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { t } from './messages.js'
import { applyI18n } from './i18n-dom.js'

// vitest 自 repo 根執行（cwd＝專案根）；jsdom 環境下 import.meta.url 非 file
// scheme，故以 cwd 相對路徑取檔（穩定、與環境無關）。
const DIR = resolve(process.cwd(), 'tools/statusline-builder')
const mainSrc = readFileSync(resolve(DIR, 'main.ts'), 'utf8')
const indexHtml = readFileSync(resolve(DIR, 'index.html'), 'utf8')

/** CJK 表意文字＋CJK 符號＋全形標點（＝中文「文案」偵測範圍，見檔頭）。 */
const CJK = /[　-〿一-鿿＀-￯]/

/**
 * 剝除 block／line 註解，逐字元掃描並把字串字面量（`'`／`"`／`` ` ``）視為
 * 不透明區塊整段跳過——避免字串內容裡的 `//`／`/*` 被誤判為註解起點而連帶
 * 吃掉字串本身的合法 CJK（T1.2 盲點 a：如 URL 字面量 `'https://example.com/
 * 中文'`，naive 逐行 `line.replace(/\/\/.*$/, '')` 會把 `//` 之後全部剝掉，
 * 使該中文假陰性漏掃）。block／line 註解本身跨行移除／剝到行尾會壓縮行號，
 * 故上層回報以「行內容」為準，非行號（沿用既有慣例）。
 *
 * T1.3（(internal design doc) 🟡-1-1）加固：單／雙引號字串模式
 * 遇裸換行（`\n`）強制結束——本掃描器不理解 regex 字面量語法（見下方
 * `stripNonRuntime` JSDoc「已知限制」），main.ts 若含形如 `/'/`／`/"/` 的
 * regex（引號字元落在 regex 字面量內），逐字元掃描會誤判其為字串起點而
 * 「假性開字串」；由於合法 TS 單／雙引號字串本就不含裸換行（跨行字串須用
 * template literal），加此終止條件使爆炸半徑從「一路吃到下個同款引號（可
 * 能跨行甚至跨到檔尾）」壓縮到「至多吃到當前行尾」——template
 * literal（反引號）語法上合法跨行，故不受此終止條件約束，維持可跨行。
 */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const two = src.slice(i, i + 2)
    const ch = src[i]

    if (two === '/*') {
      // block／JSDoc 註解：跳到對應 */（找不到則到檔尾，容錯未閉合輸入）。
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }

    if (two === '//') {
      // line 註解：跳到行尾（保留換行本身，不吃掉，維持行結構）。
      const end = src.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      // 字串字面量：整段原樣保留、不解讀其內的 // 或 /*，並跳過反斜線跳脫
      // 字元防止誤判提前收尾（如 `'it\\'s 中文'`）。單／雙引號另遇裸換行
      // 強制結束字串模式（見上方函式文件 T1.3 加固）；template literal
      // （反引號）不受此限，維持可跨行。
      const quote = ch
      const isTemplateLiteral = quote === '`'
      out += ch
      i++
      while (i < n && src[i] !== quote) {
        if (!isTemplateLiteral && src[i] === '\n') break
        if (src[i] === '\\' && i + 1 < n) {
          out += src[i] + src[i + 1]
          i += 2
          continue
        }
        out += src[i]
        i++
      }
      if (i < n && src[i] === quote) {
        out += src[i] // 閉合引號
        i++
      }
      continue
    }

    out += ch
    i++
  }
  return out
}

/**
 * 剝除 `throw new Error(...)` 呼叫式本身（開發者不變量錯誤，見檔頭排除
 * 2）——僅移除該呼叫式（含配對括號內全部內容），而非原先「整行清空」
 * （T1.2 盲點 b：整行清空會誤剝同一行內、與 throw 無關的其餘程式碼，如
 * `if (x) throw new Error('開發錯誤'); logger.log('使用者可見中文')`
 * 一行內共存時，後半段真正的硬編 CJK 會隨整行一起被清空、假陰性漏掃）。
 * 括號配對計算會跳過呼叫式參數內字串字面量裡的括號，避免誤判提前收尾；
 * 副作用是橫跨多行的 throw 呼叫式亦會被完整剝除（跨行移除會壓縮行號，
 * 與 block 註解同一取捨，見上方函式文件）。
 *
 * T1.3（🟡-1-2）加固：marker（`throw new Error(`）比對改字串感知——複用
 * `stripComments` 同款引號跳過邏輯，先判斷當前字元是否開啟字串字面量
 * （原樣保留整段內容到 `out`，不解讀其內容），只在**字串字面量之外**才
 * 檢查是否命中 marker。修復前的 naive `src.startsWith(marker, i)` 逐字元
 * 掃描不分是否身處字串內，若某字串字面量的內容恰好含 `throw new Error(`
 * 這串文字（非真實呼叫式，只是字面內容），會被誤判為 marker 命中，觸發
 * 括號配對剝除邏輯──其內建的引號跳過子邏輯會把該字串實際的收尾引號誤讀
 * 為另一個字串的起點，導致配對失準、越界吃掉後續本應存活的合法程式碼與
 * CJK（見下方回歸案 T1.3-b）。單／雙引號字串同 `stripComments` 遇裸換行
 * 提前結束；template literal 維持可跨行。
 */
function stripThrowErrorCalls(src: string): string {
  const marker = 'throw new Error('
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]

    if (ch === "'" || ch === '"' || ch === '`') {
      // 字串字面量：整段原樣保留、不在其內容裡檢查 marker（見上方函式
      // 文件）——與 stripComments 同款引號跳過＋換行終止邏輯。
      const quote = ch
      const isTemplateLiteral = quote === '`'
      out += ch
      i++
      while (i < n && src[i] !== quote) {
        if (!isTemplateLiteral && src[i] === '\n') break
        if (src[i] === '\\' && i + 1 < n) {
          out += src[i] + src[i + 1]
          i += 2
          continue
        }
        out += src[i]
        i++
      }
      if (i < n && src[i] === quote) {
        out += src[i] // 閉合引號
        i++
      }
      continue
    }

    if (src.startsWith(marker, i)) {
      let depth = 1
      let j = i + marker.length
      while (j < n && depth > 0) {
        const c = src[j]
        if (c === "'" || c === '"' || c === '`') {
          const quote = c
          j++
          while (j < n && src[j] !== quote) {
            if (src[j] === '\\' && j + 1 < n) j += 2
            else j++
          }
          j++ // 閉合引號
          continue
        }
        if (c === '(') depth++
        else if (c === ')') depth--
        j++
      }
      i = j // 跳過整個 throw new Error(...) 呼叫式（不寫入 out）
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * main.ts 的非執行期文字剝除總管線：先剝註解（字串安全），再剝 throw-Error
 * 呼叫式（括號安全）。
 *
 * **已知限制（T1.3，🟡-1-3，明文記載，非本掃描器待辦）**：本掃描器不解析
 * regex 字面量語法（JS/TS 的 `/…/` 語法上與除號同形，需完整語境判斷才能
 * 區分，逐字元 naive 掃描器不做此判斷）。main.ts 若日後引入含下列內容的
 * regex 字面量，本掃描器可能誤判（已由 T1.3 加固把爆炸半徑壓到單行，但不
 * 保證零假陰性／假陽性，引入前應先擴充掃描器本身）：
 * - regex 內含 `//`（會被誤判為 line 註解起點，regex 其餘部分連同同行後
 *   續程式碼皆遭剝除）；
 * - regex 內含單引號／雙引號字元（會被誤判為字串起點，直到同行下一個同款
 *   引號或行尾提前結束，見 `stripComments` T1.3 加固）；
 * - regex 內含未配對括號（不影響 `stripComments`，但若該 regex 恰好緊鄰
 *   `throw new Error(` 呼叫式的參數內，`stripThrowErrorCalls` 的括號配對
 *   計數會被打亂，導致呼叫式邊界誤判／desync，見 `stripThrowErrorCalls`
 *   文件）。
 */
function stripNonRuntime(src: string): string {
  return stripThrowErrorCalls(stripComments(src))
}

describe('T5.5 靜態掃描：main.ts 執行期無殘留硬編中文', () => {
  it('剝除註解／throw-Error 後的原始碼不含任何 CJK 文案', () => {
    const offenders = stripNonRuntime(mainSrc)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => CJK.test(line))
    expect(offenders).toEqual([])
  })
})

/**
 * T1.2（(internal design doc)）：`stripNonRuntime` 兩個既有盲點
 * 的回歸案——修復前為紅（假陰性：本該被抓到的硬編 CJK 卻因剝除邏輯過度
 * 而消失），修復後為綠（假陰性消失、CJK 正確存活以供上層掃描抓到；同時
 * 確認正常情境未被誤傷）。直接呼叫 `stripNonRuntime`／`CJK`，不經完整
 * main.ts 掃描，聚焦盲點本身。
 *
 * 排查記錄（先讀現行實作才落紅案，見 TICKET 要求）：brief 原例「(b) 同行
 * throw（如 `if (!x) throw new Error('中文訊息')`）若以『行首 throw』判定
 * 會漏」——實測舊版 `/throw new Error\(/.test(line)` **未**加 `^` 錨定，
 * 對純粹「if (...) throw new Error(...)」單行本就會 match（子字串比對，
 * 非行首比對），故此例本身不重現盲點（不硬造假紅案）。實測到的真實盲點是
 * 同一機制的另一面：整行清空是以「行是否含 throw new Error(」為準，若該行
 * 除了 throw 呼叫外還有其他陳述式共存（同一行以 `;` 分隔），整行會被一併
 * 清空，導致與 throw 無關的合法硬編 CJK 一起假陰性漏掃——下方案例即打在
 * 此真實形態上。
 */
describe('T1.2 迴歸：stripNonRuntime 兩個盲點修復', () => {
  it('盲點 a：字串字面量內的 // 不得被誤判為行註解起點（URL 字面量內的 CJK 仍須存活）', () => {
    const fixture = "const s = 'https://example.com/中文段落'"
    const stripped = stripNonRuntime(fixture)
    // 字串本身非註解，其內容（含 CJK）須完整存活，供上層掃描抓到。
    expect(stripped).toContain('中文段落')
    expect(CJK.test(stripped)).toBe(true)

    // 反向：正常的 line 註解仍須正確剝除（防修復盲點 a 誤傷既有行為）。
    const commentFixture = 'const x = 1 // 中文註解'
    expect(CJK.test(stripNonRuntime(commentFixture))).toBe(false)
  })

  it('盲點 b：throw new Error(...) 呼叫式只剝呼叫式本身，不得連坐清空同行其餘硬編 CJK', () => {
    const fixture = "if (x) throw new Error('開發錯誤'); logger.log('使用者可見中文')"
    const stripped = stripNonRuntime(fixture)
    // throw 呼叫式本身（開發者不變量錯誤）正確剝除。
    expect(stripped).not.toContain('開發錯誤')
    // 同行但與 throw 無關的合法硬編 CJK 須存活，供上層掃描抓到。
    expect(stripped).toContain('使用者可見中文')
    expect(CJK.test(stripped)).toBe(true)

    // 反向：單行純 throw（brief 原例，見上方排查記錄）本就正確剝除，維持行為不變。
    expect(CJK.test(stripNonRuntime("if (!x) throw new Error('中文訊息')"))).toBe(false)
  })
})

/**
 * T1.3（(internal design doc) 🟡-1）迴歸：加固 stripComments／
 * stripThrowErrorCalls 的字串感知（換行終止＋marker 字串外比對）的三個回歸
 * 案。紅證程序：暫將本檔 `stripComments`／`stripThrowErrorCalls` 換回 T1.3
 * 修復前版本（移除換行終止分支、移除 stripThrowErrorCalls 頂層引號跳過
 * 分支）重跑本 describe，(a)(b) 兩案斷言失敗（紅）；(c) 因不含真實換行、
 * 修復前後行為一致（純邊界防呆，恆綠）。驗畢還原，見回報 diff --stat。
 */
describe('T1.3 迴歸：字串模式換行終止＋throw-Error marker 字串感知', () => {
  it('(a) regex 誤開字串模式：爆炸半徑壓到單行，不殃及次行敘述（如迫使次行 // 註解失效並外洩 CJK）', () => {
    // main.ts 本身不含 regex 字面量（JSDoc 已知限制載明），此處以最小合成
    // fixture 直接打在 stripComments 加固點本身：`/'/g` 是本掃描器不理解的
    // regex 字面量（比對單一 `'` 字元），其內的 `'` 字元修復前會被誤判為
    // 字串起點；brief 原例 `/\/\//`（regex 比對字面 `//`）經實測其結尾
    // `//` 觸發的是 JSDoc 已知限制清單另一類（regex 含 `//` 誤判為行註解
    // 起點），非本修復（換行終止）標的，故改用此處的含引號等價形態如實
    // 驗證「換行終止」本身的效果（見上方紅證程序）。
    const fixture = "const re = /'/g\n// 這是註解 中文\nconst legit = 1"
    const stripped = stripNonRuntime(fixture)
    // 修復後：字串模式在 /'/g 那一行結尾即終止（未找到配對引號），次行
    // 從頭以正常模式掃描，// 註解仍被正確辨識並剝除——爆炸半徑鎖死單行。
    expect(stripped).toContain('const re = /\'/g')
    expect(stripped).toContain('const legit = 1')
    expect(CJK.test(stripped)).toBe(false)
  })

  it('(b) 字串字面量內容恰含 "throw new Error(" 字面文字：不觸發呼叫式剝除，後續 CJK 不被吞', () => {
    // 修復前：頂層逐字元掃描不分是否身處字串內，會在字串內容裡命中
    // marker，觸發括號配對剝除；其引號跳過子邏輯把該字串真正的收尾引號
    // 誤讀為另一字串起點，配對失準、一路吃到檔尾，實測結果＝'中文' 整段
    // 消失（見上方紅證程序）。修復後：頂層先判斷字串字面量（整段原樣
    // 保留、不解讀內容），marker 檢查只在字串外進行，字面文字不誤觸發。
    const fixture = "const s = 'oops throw new Error(' + '中文'"
    const stripped = stripNonRuntime(fixture)
    expect(stripped).toBe(fixture) // 全數原樣保留，非真實 throw 呼叫式不剝除任何內容。
    expect(stripped).toContain('中文')
    expect(CJK.test(stripped)).toBe(true)
  })

  it('(c) 邊界防呆：escaped quote 不受換行終止新分支誤傷（it\\\'s 中文 仍完整存活）', () => {
    // 不含真實裸換行，純驗證：換行終止檢查（`src[i] === '\\n'`）與既有
    // 反斜線跳脫分支的檢查順序不衝突——escaped quote 仍正確視為字串內容
    // 的一部分，不提前收尾字串模式。
    const fixture = "const s = 'it\\'s 中文'"
    const stripped = stripNonRuntime(fixture)
    expect(stripped).toBe(fixture)
    expect(stripped).toContain("it\\'s 中文")
    expect(CJK.test(stripped)).toBe(true)
  })
})

describe('T5.5 靜態掃描：index.html 主文件樹靜態文案皆 data-i18n 化', () => {
  const doc = new DOMParser().parseFromString(indexHtml, 'text/html')

  /** 該文字節點是否落在合法（免掃描）容器：data-i18n 子樹／template／head／footer／theme-toggle。 */
  function inAllowedContainer(node: Node): boolean {
    let el: Element | null = node.parentElement
    while (el !== null) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'template' || tag === 'head' || tag === 'footer') return true
      if (el.hasAttribute('data-i18n')) return true
      if (el.classList.contains('theme-toggle')) return true
      el = el.parentElement
    }
    return false
  }

  it('body 內每個含 CJK 的文字節點皆在 data-i18n／template／footer／head／theme-toggle 之下', () => {
    const walker = doc.createTreeWalker(doc.documentElement, 4 /* SHOW_TEXT */)
    const offenders: string[] = []
    let node = walker.nextNode()
    while (node !== null) {
      const text = node.textContent ?? ''
      if (CJK.test(text) && !inAllowedContainer(node)) {
        offenders.push(text.trim().slice(0, 60))
      }
      node = walker.nextNode()
    }
    expect(offenders).toEqual([])
  })
})

/**
 * T3.6（(internal design doc) §D5；TASKS.md T3.6）：en
 * 文字節點重掃案——比照 T1.4 🟡-2-7「en 重掃」（屬性面）的姊妹案，補
 * 文字節點面的等價巡檢。上方「T5.5 靜態掃描」案只驗證「已掛
 * `data-i18n`」，不驗證「掛的 key 確實可解析為字串終值」——key 打錯字
 * 或指向非字串終值時 `applyI18n` 內部 `console.warn` 靜默跳過（不改
 * `textContent`），原始 zh 字面因此原封不動殘留；若殘留字面又恰好落在
 * 帶 `data-i18n` 的容器子樹內，沿用原 `inAllowedContainer` 判準會誤判為
 * 「合法」而漏抓——故本案的判準刻意排除 `data-i18n` 豁免，只保留
 * template／head／footer／theme-toggle 四個真正與本工具 i18n 無關的
 * 容器（同判準亦見上方「T5.5 en 重掃」屬性案文件之姊妹說明）。
 *
 * 額外發現（本案落實時實測揭露，非 tutorial 相關）：`.lang-toggle` 鈕
 * `data-i18n="langToggle.shortLabel"` 的 en 字典值即為 `'中'`
 * （messages.ts `en.langToggle.shortLabel`，T5.4 既有設計）——此鍵刻意
 * 顯示「切至目標語言」的助憶短碼（en 生效中顯示「中」代表可切到中文，
 * 對稱 zh-Hant 生效中顯示「EN」），非漏解析的殘留 zh 原文；`i18n-dom.
 * dom.test.ts:274`／`lang-switch.dom.test.ts` 已對此值有專用鎖定斷言。
 * 故本案判準額外排除 `.lang-toggle` 容器（非新增豁免類別，而是既有
 * 「zh 字典鍵有意產出 CJK 值」個案的收斂，理由與 `theme-toggle` 之於
 * 屬性面「site chrome、非本工具翻譯範圍」不同——此為「已翻譯，但譯文
 * 本身含 CJK」，兩者結論相同：不算掛標／字典缺陷）。
 */
describe('T3.6 靜態掃描：applyI18n(doc, en) 後主文件樹文字節點零殘留 CJK（data-i18n 鍵必可解析）', () => {
  /**
   * 同上方文字節點 inAllowedContainer，但排除 data-i18n 豁免（見本案
   * 文件）；另加 `.lang-toggle` 排除（見本案文件「額外發現」段落）。
   */
  function inAllowedContainerExceptI18n(node: Node): boolean {
    let el: Element | null = node.parentElement
    while (el !== null) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'template' || tag === 'head' || tag === 'footer') return true
      if (el.classList.contains('theme-toggle') || el.classList.contains('lang-toggle')) return true
      el = el.parentElement
    }
    return false
  }

  it('applyI18n(doc, en) 後，豁免容器外的文字節點皆不含 CJK', () => {
    const doc = new DOMParser().parseFromString(indexHtml, 'text/html')
    applyI18n(doc, 'en')
    const walker = doc.createTreeWalker(doc.documentElement, 4 /* SHOW_TEXT */)
    const offenders: string[] = []
    let node = walker.nextNode()
    while (node !== null) {
      const text = node.textContent ?? ''
      if (CJK.test(text) && !inAllowedContainerExceptI18n(node)) {
        offenders.push(text.trim().slice(0, 60))
      }
      node = walker.nextNode()
    }
    expect(offenders).toEqual([])
  })
})

/**
 * T3.6：零 `console.warn` 案——鎖死「所有掛標的 `data-i18n`／
 * `data-i18n-attr` 鍵皆確實存在於兩語言字典」這個不變量。`applyI18n`
 * 對無法解析的鍵僅 `console.warn` 靜默跳過（見 i18n-dom.ts），不會讓
 * 上面幾個「零殘留 CJK」案本身變紅（例如該節點原文剛好不含 CJK、或指向
 * 非字串終值而原文為空），故另立此案正面斷言零呼叫，堵死此類假陰性。
 */
describe('T3.6 靜態掃描：applyI18n 對整份 index.html 零 console.warn（兩語言）', () => {
  it('zh-Hant／en 兩次 applyI18n 皆零 console.warn 呼叫', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const zhDoc = new DOMParser().parseFromString(indexHtml, 'text/html')
      applyI18n(zhDoc, 'zh-Hant')
      expect(warnSpy).not.toHaveBeenCalled()

      const enDoc = new DOMParser().parseFromString(indexHtml, 'text/html')
      applyI18n(enDoc, 'en')
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

/**
 * T1.1（(internal design doc)）：index.html 主文件樹屬性巡檢，
 * 見檔頭「index.html 屬性巡檢」段落之判準與豁免清單。核心掃描邏輯抽為
 * `findAttrOffenders`，供下方兩處共用：
 * (1) 針對真實 index.html 的常駐防回歸案；
 * (2) 針對最小合成 fixture 的紅綠雙證（不依賴／不改動 index.html 即可
 *     獨立證明掃描器本身正確——插入違規元素必紅、補上 data-i18n-attr 後
 *     轉綠）。
 */
describe('T1.1 靜態掃描：index.html 主文件樹屬性文案皆 data-i18n-attr 化', () => {
  /** 本巡檢覆蓋的屬性清單（見檔頭）。 */
  const SCANNED_ATTRS = ['aria-label', 'placeholder', 'title', 'alt'] as const

  /** 元素是否落在豁免容器：template／head／footer／theme-toggle（含自身）。 */
  function inAllowedContainer(el: Element): boolean {
    let cur: Element | null = el
    while (cur !== null) {
      const tag = cur.tagName.toLowerCase()
      if (tag === 'template' || tag === 'head' || tag === 'footer') return true
      if (cur.classList.contains('theme-toggle')) return true
      cur = cur.parentElement
    }
    return false
  }

  /**
   * attrName 是否已被該元素的 data-i18n-attr 規格涵蓋（見 i18n-dom.ts
   * applyI18n 格式定案：`'attr1:key1;attr2:key2'`）。
   *
   * T1.4（(internal design doc) 🟡-2-5）收緊：要求配對「含冒號
   * 且 key 非空」才算涵蓋——修復前 `pair.trim().split(':')[0]` 只取冒號前
   * 半段比對屬性名，即使配對根本沒冒號（如純 `"aria-label"`，`split(':')`
   * 退化成單元素陣列，`[0]` 仍等於整串 `"aria-label"`，誤判為涵蓋）或冒號
   * 後 key 是空字串（如 `"aria-label:"`），都會被當作「已涵蓋」而放行——
   * 但這兩種格式 `i18n-dom.ts applyI18n` 實際解析時前者因缺冒號
   * `console.warn` 跳過整個配對（不 setAttribute）、後者因 key 為空字串
   * `resolveMessageValue` 找不到值同樣 `console.warn` 跳過，兩者實際上都
   * **不會**翻轉該屬性——本巡檢卻誤判為已受掩護，形成背書漏洞。
   */
  function coveredByI18nAttr(el: Element, attrName: string): boolean {
    const spec = el.getAttribute('data-i18n-attr')
    if (spec === null) return false
    return spec.split(';').some((pair) => {
      const trimmed = pair.trim()
      const colonAt = trimmed.indexOf(':')
      if (colonAt === -1) return false
      const attr = trimmed.slice(0, colonAt).trim()
      const key = trimmed.slice(colonAt + 1).trim()
      return attr === attrName && key !== ''
    })
  }

  /**
   * 巡檢 `root`（`Document` 或任一 `ParentNode`，見 T1.4 🟡-2-6：供
   * `<template>.content` 子樹複用同一判準）子樹，回傳 offender 清單
   * （`<selector> [attr]` 可讀格式；`sourcePrefix` 非空時前綴標記來源，
   * 供診斷區分主文件樹／哪個 template 子樹命中）。
   */
  function findAttrOffenders(root: ParentNode, sourcePrefix = ''): string[] {
    const offenders: string[] = []
    const prefix = sourcePrefix ? `${sourcePrefix} > ` : ''
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (inAllowedContainer(el)) continue
      for (const attr of SCANNED_ATTRS) {
        const value = el.getAttribute(attr)
        if (value === null || !CJK.test(value)) continue
        if (coveredByI18nAttr(el, attr)) continue
        const idPart = el.id ? `#${el.id}` : ''
        const classPart = el.className ? `.${String(el.className).trim().replace(/\s+/g, '.')}` : ''
        offenders.push(`${prefix}${el.tagName.toLowerCase()}${idPart}${classPart} [${attr}]`)
      }
    }
    return offenders
  }

  it('body 內每個含 CJK 的 aria-label／placeholder／title／alt 皆已掛對應 data-i18n-attr（含各 template.content 子樹，T1.4 🟡-2-6）', () => {
    const doc = new DOMParser().parseFromString(indexHtml, 'text/html')
    const offenders = [...findAttrOffenders(doc)]
    // 主文件樹的 querySelectorAll('*') 天然不會走進 <template>.content
    // （DOM 標準 template content model，見檔頭「index.html 屬性巡檢」段
    // 落），故獨立對每個 <template> 的 .content 子樹另跑一輪同一判準，
    // offender 併入同一斷言清單（selector 前綴標記 template 來源）。
    for (const tpl of Array.from(doc.querySelectorAll('template'))) {
      const marker = tpl.id ? `template#${tpl.id}` : 'template'
      offenders.push(...findAttrOffenders((tpl as HTMLTemplateElement).content, marker))
    }
    expect(offenders).toEqual([])
  })

  it('紅綠雙證（合成 fixture，不依賴 index.html）：違規元素必紅，補上 data-i18n-attr 後轉綠；畸形 spec（缺冒號／空 key）不算涵蓋，仍紅', () => {
    const violating = `<!doctype html><html><head><title>t</title></head><body>
      <button id="probe" aria-label="測試用中文標籤">X</button>
    </body></html>`
    const redDoc = new DOMParser().parseFromString(violating, 'text/html')
    const redOffenders = findAttrOffenders(redDoc)
    expect(redOffenders).toEqual(['button#probe [aria-label]'])

    const fixed = `<!doctype html><html><head><title>t</title></head><body>
      <button id="probe" aria-label="測試用中文標籤" data-i18n-attr="aria-label:ui.probe">X</button>
    </body></html>`
    const greenDoc = new DOMParser().parseFromString(fixed, 'text/html')
    expect(findAttrOffenders(greenDoc)).toEqual([])

    // T1.4（🟡-2-5）：畸形 spec——缺冒號（"aria-label"）與空 key
    // （"aria-label:"）均不得被當作已涵蓋，兩者皆須維持紅（見上方
    // coveredByI18nAttr 文件的修復前誤判分析）。
    const noColon = `<!doctype html><html><head><title>t</title></head><body>
      <button id="probe" aria-label="測試用中文標籤" data-i18n-attr="aria-label">X</button>
    </body></html>`
    expect(findAttrOffenders(new DOMParser().parseFromString(noColon, 'text/html'))).toEqual([
      'button#probe [aria-label]',
    ])

    const emptyKey = `<!doctype html><html><head><title>t</title></head><body>
      <button id="probe" aria-label="測試用中文標籤" data-i18n-attr="aria-label:">X</button>
    </body></html>`
    expect(findAttrOffenders(new DOMParser().parseFromString(emptyKey, 'text/html'))).toEqual([
      'button#probe [aria-label]',
    ])
  })

  /**
   * T1.4（🟡-2-7）en 重掃案：上兩案（掛標必要性／spec 格式）只驗證「有掛
   * `data-i18n-attr` 且格式合法」，不驗證掛的 **key 本身確實可解析**——
   * key 打錯字（如 `ui.probeTyp0`）或指向非字串終值，`applyI18n` 內部會
   * `console.warn` 靜默跳過（不 setAttribute，見 i18n-dom.ts
   * `resolveMessageValue`／`applyI18n` 文件），該屬性的原始 zh 字面因此
   * 原封不動殘留——這種「掛標了但沒真的接上字典」的假掩護，主文件樹單獨
   * 巡檢／紅綠雙證都測不出來，只有實際跑一次 `applyI18n(doc, 'en')` 再重
   * 掃才能揭露：任何殘留 CJK＝該元素的 key 解析失敗或 spec 畸形。
   */
  it('en 重掃：applyI18n(doc, en) 後四屬性豁免區外零殘留 CJK（一舉封 key 錯字／畸形 spec）', () => {
    const doc = new DOMParser().parseFromString(indexHtml, 'text/html')
    applyI18n(doc, 'en')
    const offenders: string[] = []
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      if (inAllowedContainer(el)) continue
      for (const attr of SCANNED_ATTRS) {
        const value = el.getAttribute(attr)
        if (value === null || !CJK.test(value)) continue
        const idPart = el.id ? `#${el.id}` : ''
        offenders.push(`${el.tagName.toLowerCase()}${idPart} [${attr}]＝「${value}」`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * T5.5 en 面向抽查（非 T5.6 三面向全量翻轉）：驗「切 en 後關鍵位確實翻轉」
 * ——(1) index.html 主文件樹靜態文案經 applyI18n(doc,'en') 翻為 en；
 * (2) 常數表遷移後的字典函式（variantLabel／validation.fieldReject）en 輸出
 * 正確。完整三面向（靜態＋動態組句＋預覽 aria）翻轉屬 T5.6。
 */
describe('T5.5 en 抽查：關鍵位切 en 翻轉', () => {
  it('index.html 靜態標題／控件文案經 applyI18n(doc, en) 翻為 en', () => {
    const doc = new DOMParser().parseFromString(indexHtml, 'text/html')
    applyI18n(doc, 'en')
    expect(doc.querySelector('#global-heading')?.textContent).toBe('Global settings')
    expect(doc.querySelector('#preview-heading')?.textContent).toBe('Live preview')
    // data-i18n-attr（aria-label）亦翻轉。
    expect(doc.querySelector('.lang-toggle')?.getAttribute('aria-label')).toBe('Switch to Chinese interface')
    expect(doc.querySelector('h1')?.textContent).toBe('Claude Code Statusline Generator')
    expect(CJK.test(doc.querySelector('#global-heading')?.textContent ?? '')).toBe(false)
    // T3.6：教學帶兩鍵 en 翻轉（tutorial.dragHint／tutorial.dismiss）。
    expect(doc.querySelector('.tutorial-band__text')?.textContent).toBe(
      'Drag a segment name to reorder or move it to another row',
    )
    expect(doc.querySelector('#tutorial-dismiss')?.textContent).toBe('Got it')
  })

  it('常數表遷移後的字典函式 en 輸出正確（variantLabel／fieldReject／announce）', () => {
    const en = t('en')
    expect(en.variantLabel.full).toBe('Full path')
    expect(en.variantLabel['percent-reset']).toBe('Percentage + reset time')
    expect(en.validation.fieldReject('prefix', 'newline')).toBe('Prefix must not contain newline characters')
    expect(en.validation.fieldReject('separator', 'too-long')).toBe('Separator must not exceed 8 characters')
    expect(en.announce.barOnKeepCustom('Context used')).toBe(
      '"Context used" bar chart enabled; existing custom threshold colors kept',
    )
    expect(en.rowGroup.heading(3)).toBe('Row 3')
    expect(en.defaultHint('Full path')).toBe('(default: Full path)')
  })
})
