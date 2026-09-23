export type ToolStatus = 'planned' | 'available'

export interface Tool {
  slug: string
  name: string
  description: string
  path: string
  status: ToolStatus
}

export const tools: Tool[] = [
  {
    slug: 'apng-to-gif',
    name: 'APNG → GIF 轉換',
    description: '將 APNG 動圖轉換為 GIF 格式',
    path: './tools/apng-to-gif/',
    status: 'available',
  },
  {
    slug: 'gif-editor',
    name: 'GIF 編輯',
    description: '編輯 GIF 的頁數、每頁停留時間與循環次數',
    path: './tools/gif-editor/',
    status: 'available',
  },
  {
    slug: 'video-converter',
    name: '影片格式轉換',
    description: '於瀏覽器端轉換影片格式（如 MKV → MP4）',
    path: './tools/video-converter/',
    status: 'available',
  },
  {
    slug: 'statusline-builder',
    name: 'Claude Code Statusline 產生器',
    description: '視覺化設定 Claude Code statusline，產出 bash／ps1／settings 腳本',
    path: './tools/statusline-builder/',
    status: 'available',
  },
  {
    slug: 'room-layout-planner',
    name: '房間家具擺放規劃器',
    description: '自訂房間與家具尺寸、拖移擺放、通道寬度警示與擺放建議',
    path: './tools/room-layout-planner/',
    status: 'available',
  },
]
