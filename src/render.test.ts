import { describe, expect, it } from 'vitest'
import { renderToolList } from './render.js'
import type { Tool } from './tools.js'

const plannedTools: Tool[] = [
  {
    slug: 'apng-to-gif',
    name: 'APNG → GIF 轉換',
    description: 'APNG 動圖轉為 GIF',
    path: './tools/apng-to-gif/',
    status: 'planned',
  },
  {
    slug: 'gif-editor',
    name: 'GIF 編輯',
    description: '編輯 GIF 頁數與停留時間',
    path: './tools/gif-editor/',
    status: 'planned',
  },
  {
    slug: 'video-converter',
    name: '影片格式轉換',
    description: '瀏覽器端影片轉檔（如 MKV → MP4）',
    path: './tools/video-converter/',
    status: 'planned',
  },
]

describe('renderToolList', () => {
  it('renders one <li> card per tool', () => {
    const html = renderToolList(plannedTools)
    const cardCount = (html.match(/<li/g) ?? []).length
    expect(cardCount).toBe(3)
  })

  it('renders the list with an explicit list role', () => {
    const html = renderToolList(plannedTools)
    expect(html).toContain('role="list"')
  })

  it('does not render an <a> for planned tools', () => {
    const html = renderToolList(plannedTools)
    expect(html).not.toContain('<a')
  })

  it('includes visible "規劃中" text on every planned card', () => {
    const html = renderToolList(plannedTools)
    const occurrences = html.split('規劃中').length - 1
    expect(occurrences).toBe(plannedTools.length)
  })

  it('renders a tool-link <a> with correct href for available tools', () => {
    const availableTool: Tool = {
      slug: 'demo-tool',
      name: '示範工具',
      description: '一個可用的示範工具',
      path: './tools/demo-tool/',
      status: 'available',
    }
    const html = renderToolList([availableTool])
    expect(html).toContain('<a class="tool-link" href="./tools/demo-tool/">')
    expect(html).toContain('可用')
  })

  it('escapes HTML-special characters in name and description', () => {
    const unsafeTool: Tool = {
      slug: 'unsafe-tool',
      name: '<b>惡意名稱</b>',
      description: '包含 "引號" 與 <script>alert(1)</script>',
      path: './tools/unsafe-tool/',
      status: 'planned',
    }
    const html = renderToolList([unsafeTool])
    expect(html).not.toContain('<b>惡意名稱</b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;b&gt;惡意名稱&lt;/b&gt;')
    expect(html).toContain('&lt;script&gt;')
  })
})
