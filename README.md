# ClientKit

ClientKit 是純靜態網頁工具合集入口頁面，所有處理皆在瀏覽器端完成，由 GitHub Pages 直接託管。

## Tools

| 工具 | 狀態 |
|------|------|
| APNG → GIF 轉換（`tools/apng-to-gif/`） | ✅ 可用 |
| GIF 編輯：刪幀、停留時間、播放次數（`tools/gif-editor/`） | ✅ 可用 |
| 影片格式轉換：MKV/MOV/AVI/WebM → MP4（`tools/video-converter/`） | ✅ 可用 |
| Claude Code statusline 產生器（`tools/statusline-builder/`） | ✅ 可用 |
| 房間家具擺放規劃器：房間／家具尺寸、拖移擺放、通道寬度警示與擺放建議（`tools/room-layout-planner/`） | ✅ 可用 |

## Installation
需求：Node.js >= 22。

```bash
npm install
```

## Usage
```bash
# 啟動開發伺服器
npm run dev

# 建置正式版（輸出至 dist/）
npm run build

# 本機預覽 build 結果
npm run preview

# 執行測試（vitest 一次性執行）
npm test

# 驗證 build 產物（入口頁零框架 JS（主題 inline script 白名單）、工具頁骨架等不變量；需先 npm run build）
npm run verify:dist

# CDP 整合案（本機限定，需 Edge/Chromium，不進 CI）
npm run test:e2e

```

本機 bash＋jq 真執行：設 `SP5_BASH`（Git Bash 路徑）與 `SP5_JQ_DIR`（含
`jq.exe` 或 `jq-windows-amd64.exe` 的目錄）後跑 `npm test`。

## statusline-builder 注意事項

statusline-builder 於瀏覽器端產生 Claude Code 自訂 statusline 的設定腳本
（`.sh`／`.ps1`）與 `settings.json` 片段，所有處理皆在前端完成。介面支援
正體中文／英文切換（header 語言鈕，偏好存於瀏覽器本機；產出腳本內容不受
語言切換影響）。

- **Segment schema 基準版**：segment 目錄依 Claude Code stdin JSON schema
  **v2.1.196**（官方文件宣稱版本）建立；changelog 實際複核至 **v2.1.169**，
  兩者間的 patch 差異未逐一複核。**Claude Code 大版更新時，請人工重核
  segment 目錄**（欄位增刪、nullability 時序、enum 集、如 v2.1.132 token
  欄位語意 breaking change 之語意變更）——schema 追版未自動化。
- **Windows 執行下載腳本（Mark-of-the-Web）**：由瀏覽器下載的 `.ps1` 會帶
  Zone.Identifier（MOTW），在預設 ExecutionPolicy（Restricted／
  RemoteSigned）下，未簽名的網際網路腳本會被拒絕執行，導致 statusline
  靜默空白。產出的 `settings.json` 片段預設採 `-ExecutionPolicy Bypass`
  wrapper 形規避；若仍被擋，可對下載的腳本執行 `Unblock-File <路徑>`
  解除封鎖。受管環境若以群組原則（GPO）強制 `AllSigned`，wrapper 亦無效，
  需另行簽署腳本（不在目前保證範圍內）。
- **powerline 關箭頭模式的尾隨空格**：`powerlineArrow: false`（色塊直接
  相接＋每段右側 padding）時，產出腳本的最後一段末尾帶尾隨空格，
  bash／ps1／settings.json 片段三後端一致，屬契約行為而非缺陷；部分
  statusline 消費端（終端機／殼層）顯示時會將行尾空白右修剪，實際觀感
  可能無感。

## Documentation
- [SPEC.md](SPEC.md) — architecture and feature spec

## Contributing

公開鏡像 ClientKit 為唯讀快照，PR 會搬回上游私有 repo 再回流。

## Credits

以 Claude Code 協作開發。

## License

本專案自身之授權：[MIT License](LICENSE)。

### 第三方元件

影片格式轉換工具以 self-host 方式散布 ffmpeg.wasm 的 `@ffmpeg/core`
wasm 二進位（版本 0.12.10，未經修改），其授權為 **GPL-2.0-or-later**
（內含 x264 等 GPL 元件）。原始碼與完整授權條款見
[ffmpeg.wasm 專案](https://github.com/ffmpegwasm/ffmpeg.wasm)與
[FFmpeg 官方](https://ffmpeg.org/legal.html)。

statusline-builder 工具的模型／effort 自動配色已於 06c 交付（`main.ts` 判定
`mode === 'auto'` 回傳 `{ kind: 'auto' }`，`resolve.ts` 消費
`color.kind === 'auto'`）。落地時僅取用
[howar31/claude-statusline](https://github.com/howar31/claude-statusline)
的配色構想（色票重新編碼為 256 色索引），不會複製其程式碼。
