---
name: figma-plugin-game-manual
description: 遊戲說明書產生器 Figma Plugin v3 — 架構、技術決策與開發現狀
metadata: 
  node_type: memory
  type: project
  originSessionId: 92b214a2-7da4-490a-9b45-c627015a10bc
---

Plugin 從 Google Sheets 讀取資料並生成 Figma frames（1920×1080，每排5個，支援中/英文版）。

**Why:** 解決從 code.js 直接 fetch 被 CORS 擋住的問題，改在 ui.html iframe 做 fetch。

**架構（v3.9）**：
- `ui.html`：fetch Sheets API v4，postMessage rows 給 code.js
- `code.js`：接收資料、繪製 frames、表格生成、換圖功能
- `manifest.json`：無 networkAccess 限制（fetch 在 iframe）
- GitHub：https://github.com/FishriderX/123.git

**Google Sheets 設定**：
- API Key 認證（不用 OAuth），試算表需設為公開可檢視或可編輯
- 支援指定工作表名稱（留空讀第一張）
- 欄位分隔：tab 或 2+ 個空格（相容視覺對齊格式）

**表格生成（buildTableFromCell）**：
- 欄位用 2+ 空格或 tab 分隔，行用換行分隔
- 自動辨別類型：多欄（≥3欄）、兩欄、賠率卡片
- 跨欄 header：列長 < maxCols 且最後非空格不在第一欄 → 自動 grow
- 格子：45% 透明黑色 fill，橘色 2px 外框，1px 格線用真實 separator frame
- 所有格子文字白色（不用金色 header 區分）
- cell.name = 'TBL_CELL'（換圖時偵測用）

**換圖功能（handleIconsOnly）**：
- 搜尋範圍：figma.root.findOne（全檔案，含跨頁面）
- 在 TBL_CELL 內：icon 自動縮放到 32px 高
- component 需在同一個 Figma 檔案內（不支援外部 Library）

**重要設定細節**：
- clipsContent = false 要在所有 children append 後才設（否則 Figma 會覆蓋）
- makeTblContainer 保留 clipsContent = true（讓圓角裁切格線）
- outerFrame.clipsContent = false
- pageFrame.clipsContent = false（children 加完後設）

**路徑**：`C:\Users\leolu\Downloads\遊戲說明書產生器_FigmaPlugin_v3\figma-plugin\`
