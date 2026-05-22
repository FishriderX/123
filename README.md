# 遊戲說明書產生器 v3 — Figma Plugin

從 Google Sheets 讀取資料，自動在 Figma 生成 1920×1080 遊戲說明書 Frame。

---

## 檔案結構

```
figma-plugin/
  manifest.json   — Plugin 宣告（name、api version、entry points）
  code.js         — Figma 主執行緒：接收 UI 訊息、繪製 Frame
  ui.html         — Plugin UI：設定輸入、fetch Sheets API、送資料給 code.js
```

---

## 架構說明（v3.1）

```
[使用者] → 輸入 API Key + Sheet 網址
    ↓
[ui.html iframe] → fetch sheets.googleapis.com/v4/spreadsheets/{id}/values/A:Z
    ↓ postMessage(rows)
[code.js] → 解析欄位、建立 Frame、appned 到 Figma currentPage
```

**為何在 ui.html 做 fetch？**  
Figma plugin 的 `code.js` 主執行緒受 `manifest.json` 的 `networkAccess.allowedDomains` 限制，且 Apps Script exec URL 會 302 redirect 到未列出的網域（`script.googleusercontent.com`）導致 CORS 失敗。改用 ui.html iframe 做 fetch 則不受此限制。

**為何用 API Key 而非 OAuth？**  
API Key 不需要 OAuth 同意流程，設定步驟少。代價是 Google Sheet 必須設為「知道連結的任何人可檢視」（公開讀取）。

---

## 已完成功能

### UI（ui.html）
- [x] 深色遊戲主題 UI（金色標題、深藍背景）
- [x] API Key 輸入 + 儲存，設定後自動折疊說明區塊
- [x] Google Sheet 網址輸入（自動解析 Sheet ID）
- [x] 語言選擇：中文版（Sch）/ 英文版（EN）/ 兩種都生成
- [x] Frame 水平間距、行垂直間距（px）設定
- [x] Indeterminate 進度條動畫
- [x] 狀態訊息（info / error / done）三種樣式
- [x] 錯誤訊息細分：400（Key 無效）、403（未公開）、404（找不到試算表）

### 設定持久化（code.js ↔ clientStorage）
- [x] 啟動時自動載入上次設定（API Key、Sheet 網址、語言、間距）
- [x] 每次生成前自動儲存設定

### Frame 生成（code.js）
- [x] 解析欄位：自動找 `標題Sch`、`規則Sch`、`標題EN`、`規則EN`（不分大小寫、忽略空白）
- [x] 只處理第一欄以 `PAGE` 開頭的資料列（PAGE 1, PAGE 2...）
- [x] 每排 5 個 Frame，超過自動換行
- [x] Frame 尺寸：1920 × 1080，深藍背景（`#0d0d1e`），圓角 8px
- [x] 標題文字：金色（`#f0c040`），中文 28px / 英文 26px
- [x] 規則文字：白色，佔滿剩餘空間（`layoutGrow: 1`）
- [x] 字型 fallback：Noto Sans TC → PingFang TC → Inter（中文）；Noto Sans → Inter（英文）
- [x] 生成多語言時，第二個語言 Frame 自動排在第一個下方（垂直偏移 + 300px）
- [x] 生成完成後自動 scrollAndZoomIntoView

---

## 待解決的問題

### 1. Manifest ID 不正確
`manifest.json` 的 `"id": "game-manual-generator"` 是字串，Figma 要求 plugin ID 必須是數字字串（從 Figma 開發者後台取得）。  
**影響**：在 Figma 正式安裝時可能無法識別。開發模式（Import from manifest）不受影響。  
**解法**：到 [Figma Plugin 開發者頁面](https://www.figma.com/developers/apps) 建立 plugin 取得數字 ID，更新 manifest.json。

### 2. 字型在 Figma 雲端可能不存在
若使用者使用 Figma Web（非桌面版），`Noto Sans TC` / `PingFang TC` 可能未安裝，fallback 到 `Inter` 後中文字無法正常顯示。  
**解法**：改用 Figma 雲端內建字型（如 `Source Han Sans`），或在 UI 提示使用者需安裝桌面版。

### 3. 欄位名稱對應依賴固定格式
`findColumns()` 依賴欄位名稱包含 `標題Sch`、`規則Sch`、`標題EN`、`規則EN` 等關鍵字。Sheet 格式若有變化（如改為英文 `Title_ZH`）則找不到欄位。  
**解法**：UI 加入欄位名稱手動對應選項，或在 UI 顯示偵測到的欄位讓使用者確認。

### 4. 只讀取 A:Z 範圍，且固定讀第一個 Sheet
超過 26 欄（Z 欄）的資料會被截斷；若試算表有多個分頁（tab），永遠讀第一個。  
**解法**：UI 加入「Sheet 分頁名稱」輸入欄，range 改為 `SheetName!A:ZZ`。

### 5. API Key 以明文存在 clientStorage
`figma.clientStorage` 存在使用者本機，非共用，但若 Plugin 程式碼被 inspect 仍可見。  
**影響**：低風險，但 Key 若未設限制（建議限制只允許 Sheets API）有外洩疑慮。  
**解法**：UI 說明建議使用者限制 API Key 的 API 範圍，並設 referrer 或 IP 限制（Figma 環境下 referrer 限制效果有限）。

### 6. 多語言時第二個 Frame 的 Y 位置可能不準確
`startY += outerFrame.height + 300` 在 `figma.currentPage.appendChild(outerFrame)` 之後執行。Auto-layout frame 的高度在 append 到 page 後才確定，理論上應正確，但若第一個 outerFrame height 為 0（極少數情況），第二個 Frame 會疊在上方。  
**解法**：加入 `await new Promise(r => setTimeout(r, 0))` 讓 layout 計算完成，或改用固定公式計算 y。

### 7. 未處理 Sheet 資料完全為空的邊界情況
`json.values` 存在但所有列都不是 PAGE 開頭時，會顯示「找不到 PAGE 資料列」錯誤訊息，但若 `json.values` 只有一列（標題列）不會顯示友好提示。  
**影響**：使用者可能不清楚原因。**解法**：目前已有檢查 `rows.length < 2`，訊息尚可接受。

---

## Google Sheets 格式要求

| 欄位名稱   | 必要 | 說明 |
|----------|------|------|
| 第一欄     | 是   | `PAGE 1`, `PAGE 2`... 開頭（不分大小寫） |
| 標題Sch   | 擇一 | 中文版標題 |
| 規則Sch   | 擇一 | 中文版規則文字 |
| 標題EN    | 擇一 | 英文版標題 |
| 規則EN    | 擇一 | 英文版規則文字 |

- Sheet 必須設為「知道連結的任何人可檢視」
- 只需中文或只需英文版時，可只提供對應欄位

---

## 安裝與使用（開發模式）

1. 在 Figma 桌面版：Plugins → Development → Import plugin from manifest
2. 選取 `figma-plugin/manifest.json`
3. 開啟任意 Figma 檔案 → Plugins → Development → 遊戲說明書產生器 v3
4. 首次設定：輸入 Google API Key 並儲存
5. 貼入 Google Sheet 網址，選擇語言，按「開始生成說明書」

---

## 開發紀錄

| 版本 | 說明 |
|------|------|
| v1   | Apps Script + code.js fetch（CORS 失敗） |
| v2   | OAuth Token flow（設定複雜） |
| v3   | 改用 API Key，fetch 移至 ui.html iframe |
| v3.1 | 欄位 fallback、錯誤訊息細化、設定持久化、UI 折疊區塊 |
