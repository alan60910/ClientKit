import { describe, expect, it } from 'vitest'
import { vendorAssetUrl } from './asset-url.js'

describe('vendorAssetUrl', () => {
  it('root 部署（站台位於網域根目錄）：上溯兩層抵達根目錄', () => {
    expect(vendorAssetUrl('https://x/tools/video-converter/', 'vendor/ffmpeg/ffmpeg-core.js')).toBe(
      'https://x/vendor/ffmpeg/ffmpeg-core.js',
    )
  })

  it('project page 部署（站台位於子路徑，如 GitHub Pages /ClientKit/）：上溯兩層落在站台根目錄，非網域根目錄', () => {
    expect(vendorAssetUrl('https://x/ClientKit/tools/video-converter/', 'vendor/ffmpeg/ffmpeg-core.js')).toBe(
      'https://x/ClientKit/vendor/ffmpeg/ffmpeg-core.js',
    )
  })

  it('頁面 URL 帶 index.html 結尾：與目錄形式（結尾 "/"）結果相同', () => {
    expect(
      vendorAssetUrl('https://x/ClientKit/tools/video-converter/index.html', 'vendor/ffmpeg/ffmpeg-core.js'),
    ).toBe('https://x/ClientKit/vendor/ffmpeg/ffmpeg-core.js')
  })

  it('頁面 URL 帶 query/hash：不影響路徑上溯結果', () => {
    expect(
      vendorAssetUrl('https://x/ClientKit/tools/video-converter/?foo=bar#section', 'vendor/ffmpeg/ffmpeg-core.js'),
    ).toBe('https://x/ClientKit/vendor/ffmpeg/ffmpeg-core.js')
  })

  it('無尾斜線 project page 形：正規化補 "/" 後仍解到站台根 vendor 路徑', () => {
    expect(vendorAssetUrl('https://x/ClientKit/tools/video-converter', 'vendor/ffmpeg/ffmpeg-core.js')).toBe(
      'https://x/ClientKit/vendor/ffmpeg/ffmpeg-core.js',
    )
  })

  it('無尾斜線 root 部署形：與尾斜線形結果相同', () => {
    expect(vendorAssetUrl('https://x/tools/video-converter', 'vendor/ffmpeg/ffmpeg-core.js')).toBe(
      'https://x/vendor/ffmpeg/ffmpeg-core.js',
    )
  })

  it('無尾斜線＋query 形：query 不影響正規化與上溯', () => {
    expect(
      vendorAssetUrl('https://x/ClientKit/tools/video-converter?foo=bar', 'vendor/ffmpeg/ffmpeg-core.js'),
    ).toBe('https://x/ClientKit/vendor/ffmpeg/ffmpeg-core.js')
  })

  it('localhost dev（vite dev server，無子路徑）', () => {
    expect(vendorAssetUrl('http://localhost:5173/tools/video-converter/', 'vendor/ffmpeg/ffmpeg-core.wasm')).toBe(
      'http://localhost:5173/vendor/ffmpeg/ffmpeg-core.wasm',
    )
  })

  it('防禦：assetPath 以 "/" 開頭時 throw（防止誤傳絕對路徑蓋掉上溯邏輯）', () => {
    expect(() => vendorAssetUrl('https://x/tools/video-converter/', '/vendor/ffmpeg/ffmpeg-core.js')).toThrow()
  })

  it('防禦：assetPath 帶協定時 throw（防止誤傳完整 URL，如意外繞開站台）', () => {
    expect(() =>
      vendorAssetUrl('https://x/tools/video-converter/', 'https://evil.example/ffmpeg-core.js'),
    ).toThrow()
  })
})
