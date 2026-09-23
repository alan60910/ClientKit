// T4.2（(internal design doc) §D4）：主題模組於任何渲染前
// import——<head> 的 inline script 已在解析階段套用 data-theme（防 FOUC），
// 這裡只需接上 toggle 鈕的 wiring 與 aria-pressed 同步，故在檔案最上方、
// 其餘功能邏輯之前完成。
import { initThemeSync, initThemeToggle } from '../../src/theme.js'

import '../../src/style.css';
import './style.css';

// 主題切換鈕 wiring：本頁沒有其他「渲染」步驟先於此執行（見上方 import 註解）。
initThemeToggle(document.querySelector('.theme-toggle') as HTMLButtonElement)
// (internal design doc) 里程碑 2：OS 偏好變更／其他分頁 storage 事件即時同步 toggle 鈕。
initThemeSync(document.querySelector('.theme-toggle') as HTMLButtonElement)

const output = document.createElement('p');
output.textContent = 'probe ok';
document.body.appendChild(output);
