/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { injectToolList, TOOL_LIST_PLACEHOLDER } from './inject.js'

describe('injectToolList', () => {
  it('replaces the placeholder with the given list html', () => {
    const html = `<main>${TOOL_LIST_PLACEHOLDER}</main>`
    const listHtml = '<ul class="tool-list" role="list"></ul>'
    const result = injectToolList(html, listHtml)
    expect(result).toContain('class="tool-list"')
    expect(result).not.toContain(TOOL_LIST_PLACEHOLDER)
  })

  it('throws when the placeholder is missing', () => {
    const html = '<main>no placeholder here</main>'
    expect(() => injectToolList(html, '<ul></ul>')).toThrow()
  })

  it('preserves special replacement patterns like $& literally', () => {
    const html = `<main>${TOOL_LIST_PLACEHOLDER}</main>`
    const listHtml = '<p>$& $` $\' $$ $1</p>'
    const result = injectToolList(html, listHtml)
    expect(result).toBe(`<main>${listHtml}</main>`)
  })

  it('root index.html contains the tool-list placeholder', () => {
    const indexPath = resolve(import.meta.dirname, '..', 'index.html')
    const html = readFileSync(indexPath, 'utf-8')
    expect(html).toContain(TOOL_LIST_PLACEHOLDER)
  })
})
