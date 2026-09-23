/**
 * vendor 資產絕對 URL 構造（(internal design doc) §Vite；已查證事實
 * 14）：工具頁固定位於 `tools/<slug>/` 兩層深（SPEC.md「工具頁骨架」慣例），
 * 故從頁面自身 URL 上溯兩層即可構出站台根目錄，再接上 vendor 相對路徑。
 *
 * 刻意不用 `import.meta.env.BASE_URL`：在本專案的 `base: './'` 設定下，
 * Vite 把它編譯為字面字串 `"./"`，不編入頁面深度資訊——用它構 URL 在
 * dev／build 皆可過，只有 `vite preview`／正式部署（頁面實際位於兩層深的
 * `tools/<slug>/` 之下）才會 404（PLAN 已查證事實 14，round 2 以 Vite
 * 8.1.3 隔離 build 實證）。頁面相對上溯不受此影響，是唯一驗證過可行的
 * 構法（另一候選 `toBlobURL` 走的是不同層面的下載，不影響此函式）。
 *
 * 純函式、零 DOM import：呼叫端傳入 `location.href`，node 測試傳入任意字串。
 */
export function vendorAssetUrl(pageHref: string, assetPath: string): string {
  if (assetPath.startsWith('/')) {
    throw new Error(`vendorAssetUrl: assetPath 不得以 "/" 開頭（收到 "${assetPath}"）`)
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(assetPath)) {
    throw new Error(`vendorAssetUrl: assetPath 不得帶協定（收到 "${assetPath}"）`)
  }

  // 無尾斜線目錄形（如 server 未 redirect 的 .../tools/video-converter）：
  // URL 解析會把最後一段當檔名、上溯少一層——最後一段非檔名形（不含 "."）
  // 時補 "/" 正規化；直接操作 pathname，query/hash 不影響解析基準。
  const page = new URL(pageHref)
  const lastSegment = page.pathname.slice(page.pathname.lastIndexOf('/') + 1)
  if (lastSegment !== '' && !lastSegment.includes('.')) {
    page.pathname += '/'
  }
  return new URL(`../../${assetPath}`, page).href
}
