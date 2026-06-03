# 遊戲說明書產生器 v4.2 — Figma Plugin

## 專案概述
從 Google Sheets 讀取資料，自動在 Figma 生成 1920×1080 遊戲說明書 Frame。

## 架構
- `figma-plugin/code.js` — 主邏輯：接收 UI 訊息、繪製 Frame、表格生成、換圖
- `figma-plugin/ui.html` — Plugin UI：API Key 設定、Sheets fetch、語言選擇
- `figma-plugin/manifest.json` — Plugin 宣告（main 指向 code_v4.0.js，備份不 commit）
- GitHub: https://github.com/FishriderX/123.git

## 版本歷史

| 版本 | 日期 | 說明 |
|------|------|------|
| v3.9_pre | 2026-05 以前 | 工作基礎版本（備份，不在 git） |
| v4.0 | 2026-05-26 | 自動表格頁面：P1 圖示化 / P2 賠率卡 / P3 資訊卡；isNewType 修復 |
| v4.1 | 2026-05-27 | 表格架構還原：透明格子 + 明確 VSep/HSep + 45% 透明黑色 fill |
| v4.2 | 2026-05-27 | 多欄表格欄位對齊修復；cellText 不 trim；換圖跨頁搜尋 |
| v4.3 | 2026-06-03 | ⑧後處理工具：圖像一鍵建立 Component（handleCreateComponentsFromImages） |

## 開發規範

### 版本控制
- 每次開發完由使用者說「幫我 commit 並 push」，Claude 負責執行
- 備份檔（code_v*.js）已在 .gitignore，不要 commit
- 主程式為 `code.js`（git 追蹤），開發在 `code_v4.0.js` 做完後 copy 過去

### 程式碼風格
- code.js 以現代 JS（ES6+）撰寫，但避免使用 optional chaining `?.`（Figma sandbox 不支援）
- 改用 `&&` 或 `if` 做 null 判斷
- 表格相關函式都在 code.js 的「表格 Frame 建立」區塊

## 重要技術細節

### Google Sheets 讀取
- fetch 在 ui.html iframe 執行（繞過 code.js 的 networkAccess 限制）
- 支援指定工作表名稱；欄位分隔支援 tab 或 2+ 空格

### 表格生成架構（v4.1 起）
- **透明列 + 明確格線**：`makeTblRow()` 透明 fill，格線由 `makeVSep()`/`makeHSep()` 實體 frame 提供
- `TBL_CELL_FILL = opacity:0.45, 純黑`（45% 透明黑）
- `TBL_ORANGE` = 橘色常數
- `makeTblContainer(width)`：透明 fill + 橘色 2px OUTSIDE stroke + clipsContent=true（圓角裁切）
- `makeTblCell` / `makeTblCellGrow`：`cell.name = 'TBL_CELL'`（換圖偵測用）、一律白色文字、`clipsContent=false`
- `pageFrame.clipsContent = false` 必須在所有 children append 後才設

### 多欄表格對齊邏輯（v4.2，buildMultiColTableFromCell）
列長度不足 `maxCols` 時，三段式對齊：

| 情況 | 條件 | 行為 | 範例 |
|------|------|------|------|
| **Case A** | 首格為空 | 跨欄 grow 到右側 | `["", "DENOMINATION"]` → 空BET格 + 右跨欄 |
| **Case B** | 首格非空 + 多元素 | 左補空格，右對齊 | `["[車廂1]","[紅包]"]` → `["","[車廂1]","[紅包]"]` |
| 單元素 | 首格非空 + 1元素 | 留在 col 0 | `["[MINI]"]` → BET欄 |

### ⚠️ cellText 不可 .trim()（v4.2 核心修復）
```js
// ✅ 正確（v4.2）
const cellText = (tblIdx >= 0) ? (firstRow[tblIdx] || "") : "";

// ❌ 錯誤（v4.1 及以前）
const cellText = (tblIdx >= 0) ? (firstRow[tblIdx] || "").trim() : "";
```
`.trim()` 會把第一行的前置空格全部刪掉。試算表用空格對齊的表格（如 P15 的 `  DENOMINATION`）前置空格代表「空的第一欄」，被 trim 後變成單一元素，無法跨欄。

### 試算表欄位前置空格慣例
- 若某列要跨欄到右側（如 DENOMINATION），在試算表欄位值前加 **2+ 個空格**
- 解析邏輯：`split(/  +/)` 把 2+ 空格視為欄位分隔符，前置空格 → 空的 col 0 → Case A 跨欄
- 例：`  DENOMINATION` → `["", "DENOMINATION"]` → DENOMINATION grow 到右側

### 自動頁面類型偵測（v4.0）
- `paytable_v2`：表格EN 含 `[sym] N-(V)` → `buildPaytableV2Frame`（自動合組同賠率符號）
- `bet_symbols`：示意圖Sch = `<數字>` → `buildBetSymbolsFrameV2`（圖示化，含 makeXMark）
- `special_symbols`：示意圖Sch = `[名稱]` → `buildSpecialSymbolsFrame`（P3 info cards，跳過預設標題）
- `makeIconOrPlaceholder(name, size, font)`：先找同名 COMPONENT，找不到 → 灰色佔位框，`node.name='TBL_CELL'`
- `makeXMark(size, font)`：橘紅色 ✕ 標記，`frame.name='TBL_CELL'`

### ⚠️ 重要 Bug 修復紀錄

#### v4.0（2026-05-26）— isNewType 修復
**問題**：P2（paytable_v2）的資料存放在「表格EN」欄，generate 流程中 `buildTableFromCell` 會優先搶先處理，導致 `buildPaytableV2Frame` 從未被呼叫。
**修復**：在 `generateManual` 的表格建立區段加入 `isNewType` 判斷。
```js
var isNewType = pageTableInfo && (
  pageTableInfo.type === 'paytable_v2' ||
  pageTableInfo.type === 'bet_symbols'
);
if (isNewType) {
  tableF = buildTableFrame(pageTableInfo, ...);
} else if (cellText) {
  tableF = buildTableFromCell(cellText, ...);
} else if (pageTableInfo) {
  tableF = buildTableFrame(pageTableInfo, ...);
}
```

#### v4.1（2026-05-27）— 表格架構還原
**問題**：v4.0 改用「橘色 fill 列 + itemSpacing=1 gap」假格線，格子為不透明深紫色，與 45% 透明設計不符。
**修復**：還原為「透明列 + 實體 VSep/HSep frame + TBL_CELL_FILL（45%透明黑）」架構。

#### v4.1（2026-05-27）— buildTableFromCell 欄位分隔修復
**問題**：v4.0 把欄位分隔從「Tab 或 2+空格」改成「只支援 Tab」，P13 以空格對齊的資料全部合併成一格。
**修復**：還原 `normalized = l.replace(/\t/g, '  '); cells = normalized.split(/  +/)` 邏輯。

#### v4.2（2026-05-27）— 多欄表格欄位對齊
**問題**：P13 表頭列（無 BET 欄標題）跑到 col 0，P15 DENOMINATION 無法跨欄到右側。
**Root Cause**：
1. `cellText.trim()` 把第一行前置空格清掉（P15 的 `  DENOMINATION` 變成 `DENOMINATION`）
2. `buildMultiColTableFromCell` 缺少智慧對齊邏輯
**修復**：移除 `cellText` 的 `.trim()`；加入三段式對齊邏輯（Case A/B + 單元素留 col 0）。

#### v4.2（2026-05-27）— 換圖跨頁搜尋
**問題**：`handleIconsOnly` 用 `figma.currentPage.findOne`，只搜尋當前頁面，component 在其他頁找不到。
**修復**：改為 `figma.root.findOne` 搜尋整個檔案，找不到時保留原始 `[tag]` 文字並顯示錯誤訊息。

### 換圖功能
- `figma.root.findOne`（搜尋全檔案所有頁面）
- 在 TBL_CELL 內的 icon 自動縮放到 32px
- ⚠️ 限制：只能搜尋同一 Figma 檔案內的 COMPONENT，共享 Library 的 component 無法搜尋

## 使用者偏好
- 使用繁體中文溝通
- 每次重大改動前先備份（code_vX.X.js）
- 版本必須控制好，不要動到之前寫好的東西
