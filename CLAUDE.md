# 遊戲說明書產生器 v3 — Figma Plugin

## 專案概述
從 Google Sheets 讀取資料，自動在 Figma 生成 1920×1080 遊戲說明書 Frame。

## 架構
- `figma-plugin/code.js` — 主邏輯：接收 UI 訊息、繪製 Frame、表格生成、換圖
- `figma-plugin/ui.html` — Plugin UI：API Key 設定、Sheets fetch、語言選擇
- `figma-plugin/manifest.json` — Plugin 宣告
- GitHub: https://github.com/FishriderX/123.git

## 開發規範

### 版本控制
- 每次開發完由使用者說「幫我 commit 並 push」，Claude 負責執行
- 備份檔（code_v*.js）已在 .gitignore，不要 commit

### 程式碼風格
- code.js 使用 ES5 相容語法（Figma plugin sandbox 限制，不支援 `?.` 等新語法）
- 不使用 optional chaining `?.`，改用 `&&` 判斷
- 表格相關函式都在 code.js 的「表格 Frame 建立」區塊

## 重要技術細節

### Google Sheets 讀取
- fetch 在 ui.html iframe 執行（繞過 code.js 的 networkAccess 限制）
- 支援指定工作表名稱；欄位分隔支援 tab 或 2+ 空格

### 表格生成
- `makeTblContainer`：橘色 2px OUTSIDE stroke，保留 clipsContent=true（讓圓角裁切格線）
- `makeTblCell` / `makeTblCellGrow`：cell.name = 'TBL_CELL'（換圖偵測用）
- `pageFrame.clipsContent = false` 必須在所有 children append 後才設

### 自動頁面類型偵測（v4.0）
- `paytable_v2`：表格EN 含 `[sym] N-(V)` → `buildPaytableV2Frame`（自動合組同賠率符號）
- `bet_symbols`：示意圖Sch = `<數字>` → `buildBetSymbolsFrameV2`（圖示化，含 makeXMark）
- `special_symbols`：示意圖Sch = `[名稱]` → `buildSpecialSymbolsFrame`（P3 info cards，跳過預設標題）
- `makeIconOrPlaceholder(name, size, font)`：先找同名 COMPONENT，找不到 → 灰色佔位框，`node.name='TBL_CELL'`
- `makeXMark(size, font)`：橘紅色 ✕ 標記，`frame.name='TBL_CELL'`

### 換圖功能
- `figma.root.findOne`（搜尋全檔案，支援跨頁面）
- 在 TBL_CELL 內的 icon 自動縮放到 32px

## 使用者偏好
- 使用繁體中文溝通
- 每次重大改動前先備份（code_vX.X.js）
- 版本必須控制好，不要動到之前寫好的東西
