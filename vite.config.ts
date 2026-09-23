import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
// defineConfig 改自 'vitest/config' 匯入（而非 'vite'）：vitest 4 官方做法——
// 'vitest/config' 匯出的 defineConfig 型別是 Vite UserConfig 與 Vitest UserConfig
// 的合併型，讓下方 `test` 欄位有型別檢查；純 'vite' 的 defineConfig 不認得 `test`。
import { configDefaults, defineConfig } from 'vitest/config';
import { tools } from './src/tools.js';
import { renderToolList } from './src/render.js';
import { injectToolList } from './src/inject.js';

const toolsDir = resolve(import.meta.dirname, 'tools');
const rootIndexPath = resolve(import.meta.dirname, 'index.html');

function discoverToolEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  if (!existsSync(toolsDir)) return entries;

  for (const dirent of readdirSync(toolsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    // 底線前綴＝repo 內範本／探針頁（如 tools/_probe/），僅供起手複製、
    // 不部署——2026-07-18 sprint 12 裁決。僅 build 輸入排除；`npm run dev`
    // 仍可瀏覽 `/tools/_probe/`（活範本預覽）。
    if (dirent.name.startsWith('_')) continue;
    const slug = dirent.name;
    const entryPath = resolve(toolsDir, slug, 'index.html');
    if (existsSync(entryPath)) {
      // Prefixed so a tool directory named "main" (or any other reserved
      // key) can never silently overwrite the root index.html entry below.
      entries[`tool-${slug}`] = entryPath;
    }
  }

  return entries;
}

function assertAvailableToolsHaveEntries(entries: Record<string, string>): void {
  const missing = tools
    .filter((tool) => tool.status === 'available')
    .filter((tool) => !(`tool-${tool.slug}` in entries));

  if (missing.length > 0) {
    const slugs = missing.map((tool) => tool.slug).join(', ');
    throw new Error(
      `src/tools.ts marks ${slugs} as "available", but no matching tools/<slug>/index.html was found. ` +
        'Add the tool page or set its status back to "planned".',
    );
  }
}

function injectToolListPlugin(): Plugin {
  // Vite runs transformIndexHtml for every HTML entry (root + each
  // tools/<slug>/index.html), so only inject into the root page — tool
  // pages never carry the placeholder and must not be touched.
  const normalize = (path: string) => path.replace(/\\/g, '/');

  return {
    name: 'inject-tool-list',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => {
        if (normalize(ctx.filename) !== normalize(rootIndexPath)) return html;
        return injectToolList(html, renderToolList(tools));
      },
    },
  };
}

const toolEntries = discoverToolEntries();
assertAvailableToolsHaveEntries(toolEntries);

export default defineConfig({
  base: './',
  plugins: [injectToolListPlugin()],
  optimizeDeps: {
    // Dev pre-bundling breaks @ffmpeg/ffmpeg's internal worker's
    // import.meta.url resolution — known community issue.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        ...toolEntries,
      },
    },
  },
  test: {
    // 防 scripts/publish-public.mjs 匯出暫存（.publish-tmp/）被 `npm test`／
    // `test:watch` 誤收為測試檔。
    exclude: [...configDefaults.exclude, '.publish-tmp/**'],
  },
});
