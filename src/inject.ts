export const TOOL_LIST_PLACEHOLDER = '<!--tool-list-->'

export function injectToolList(html: string, listHtml: string): string {
  if (!html.includes(TOOL_LIST_PLACEHOLDER)) {
    throw new Error(
      `injectToolList: placeholder "${TOOL_LIST_PLACEHOLDER}" not found in html`,
    )
  }
  return html.split(TOOL_LIST_PLACEHOLDER).join(listHtml)
}
