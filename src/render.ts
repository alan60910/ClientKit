import type { Tool } from './tools.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderToolCard(tool: Tool): string {
  const name = escapeHtml(tool.name)
  const description = escapeHtml(tool.description)

  if (tool.status === 'available') {
    return `<li class="tool-card">
  <h2 class="tool-name"><a class="tool-link" href="${escapeHtml(tool.path)}">${name}</a></h2>
  <p class="tool-desc">${description}</p>
  <span class="tool-status tool-status--available">可用</span>
</li>`
  }

  return `<li class="tool-card is-planned">
  <h2 class="tool-name">${name}</h2>
  <p class="tool-desc">${description}</p>
  <span class="tool-status">規劃中</span>
</li>`
}

export function renderToolList(tools: Tool[]): string {
  const items = tools.map(renderToolCard).join('\n')
  return `<ul class="tool-list" role="list">\n${items}\n</ul>`
}
