# 遊戲說明書產生器 v4.2 — Figma Plugin

從 Google Sheets 讀取資料，自動在 Figma 生成 1920×1080 遊戲說明書 Frame。支援中文版、英文版或同時生成兩種版本，並可自動識別多種表格類型。

---

## 安裝方式

> 適用於分享原始碼給他人自行載入（開發模式）。

### Figma Desktop（Windows / Mac）

1. Clone 或下載此倉庫
2. 開啟 Figma 桌面版
3. 左上角選單 → **Plugins** → **Development** → **Import plugin from manifest...**
4. 選取 `figma-plugin/manifest.json`
5. 開啟任意 Figma 檔案 → Plugins → Development → **遊戲說明書產生器 v4**

### Figma Web（瀏覽器）

1. Clone 或下載此倉庫
2. 開啟 [figma.com](https://www.figma.com) 並進入任意檔案
3. 左上角選單 → **Plugins** → **Development** → **Import plugin from manifest...**
4. 選取 `figma-plugin/manifest.json`

---

## 使用教學

### 步驟一：準備 Google Sheet

試算表必須符合以下格式才能正確生成：

**必要欄位（欄標題名稱）：**

| 欄位名稱 | 必要性 | 說明 |
|----------|--------|------|
| 第一欄（A欄） | 必要 | 每列填入 `PAGE 1`、`PAGE 2`... 格式（不分大小寫），相同 PAGE 的多列資料會合併為一頁 |
| 標題Sch | 中文版必要 | 中文版頁面標題 |
| 規則Sch | 中文版必要 | 中文版規則文字 |
| 標題EN | 英文版必要 | 英文版頁面標題 |
| 規則EN | 英文版必要 | 英文版規則文字 |
| 表格Sch | 選填 | 中文版表格內容（多欄用 Tab 或兩個以上空格分隔） |
| 表格EN | 選填 | 英文版表格內容 |

**Sheet 公開設定（必做）：**
1. Google Sheet 右上角「共用」
2. 一般存取 → 改為「**知道連結的任何人**」
3. 角色設為「**檢視者**」

### 步驟二：取得 Google API Key

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) → 左側選單「**API 和服務**」→「**憑證**」
2. 點「**建立憑證**」→「**API 金鑰**」
3. 建議點「限制金鑰」→ API 限制選「**Google Sheets API**」（提高安全性）
4. 複製金鑰（格式：`AIzaSy...`）

### 步驟三：在 Figma 中使用外掛

1. 在 Figma 開啟外掛後，展開「① 首次設定：Google API Key」
2. 貼上 API Key，點「**儲存**」
3. 在「② Google Sheet 網址」欄位貼入試算表的完整網址
4. 若試算表有多個分頁，在「工作表名稱」填入分頁名稱（留空則讀第一張）
5. 選擇生成語言：**中文版** / **英文版** / **兩種都生成**
6. 調整 Frame 水平間距與行垂直間距（預設 40px）
7. 點「**🚀 開始生成說明書**」

生成完成後，Figma 畫布會自動捲動至生成結果。

---

## 表格功能

外掛可自動偵測表格類型並套用對應版型，只需在 `表格EN` 欄填入符合格式的內容。

### 自動偵測的表格類型

| 類型 | 辨識規則 | 範例 |
|------|----------|------|
| 賠率表 V2（P2） | 內容含 `[符號] 數字-(數字)` 格式 | `[WW] 5-(500)` |
| 投注符號表（P1） | `示意圖Sch` 欄為 `<數字>` 格式 | `<100>` |
| 特殊符號資訊卡（P3） | `示意圖Sch` 欄為 `[名稱]` 格式 | `[WW]` |
| 標準賠率表 | 內容含 `[符號] {數字}-{數字}` 格式 | `[M1] {3}-{10}` |
| 資料範圍表 | 含 `數字~數字` 範圍格式 | `1~500` |

### 表格欄位填寫規則

- 每一列資料佔一行，行尾空格自動忽略
- **欄位分隔**：使用 `Tab` 或兩個以上空格
- **第一欄留空**：在行首加一個 Tab 或兩個空格
- **跨欄 Header**：若該列欄位數比其他列少，最後一個值自動延展填滿剩餘欄位

```
範例（多欄表格）：
BET       COL1   COL2   COL3
100       A      B      C
[Tab]DENOMINATION          ← 前置 Tab = 第一欄空，DENOMINATION 跨欄延展
```

---

## 後處理工具

生成完成後，可使用以下工具進一步處理畫布上的節點。

### ⑤ 文換圖

將文字中的 `[元件名稱]` 標記替換為 Figma Component 實例。

**使用方式：**
1. 確認 Figma 檔案中有對應名稱的 Component（名稱需完全相符）
2. 在畫布上選取包含 `[tag]` 標記的 Frame 或文字節點
3. 展開「⑤ 後處理工具：文換圖」
4. 點「**換圖**」

> Component 可在同一 Figma 檔案的任意頁面中，外掛會自動跨頁搜尋。外部 Library 的 Component 不支援。

### ⑥ 指定字元換字型

將選取範圍內特定字元的字型改為指定字型（字元級別，不影響其他文字）。

**使用方式：**
1. 選取目標 Frame 或文字節點
2. 填入「要替換的字元」（可輸入多個，例如 `·•`）
3. 填入目標字型 Family 及字重 Style
4. 點「**套用到選取範圍**」

### ⑦ 修正圓點字型

將選取範圍內所有 `·`、`•` 圓點符號的字型統一改為 **Noto Sans TC**，不影響其他文字。

**使用方式：**
1. 選取目標 Frame 或文字節點
2. 點「**修正圓點字型 → Noto Sans TC**」

---

## 檔案結構

```
figma-plugin/
  manifest.json   — Plugin 宣告
  code.js         — 主執行緒：接收訊息、繪製 Frame、表格生成、後處理邏輯
  ui.html         — Plugin UI：API Key 設定、Sheets fetch、語言選擇、後處理工具
```

---

## 技術說明

**為何在 ui.html 做 fetch？**
Figma plugin 的 `code.js` 主執行緒受 `networkAccess` 限制。將 Google Sheets API 的 fetch 移至 `ui.html` iframe 執行，可繞過此限制，不需在 manifest 設定 networkAccess。

**設定如何儲存？**
使用 `figma.clientStorage`（Figma 官方 API）儲存，資料存於使用者本機、各裝置獨立，不需額外帳號。

**字型 Fallback 順序：**
- 中文：Noto Sans SC → Noto Sans TC → PingFang TC → Inter
- 英文：Noto Sans SC → Noto Sans → Inter

---

## 版本歷史

| 版本 | 日期 | 說明 |
|------|------|------|
| v1 | 2026-05 以前 | Apps Script + code.js fetch（CORS 失敗） |
| v2 | 2026-05 以前 | OAuth Token flow（設定過於複雜） |
| v3 | 2026-05 以前 | 改用 API Key，fetch 移至 ui.html iframe |
| v3.9 | 2026-05 | 工作基礎版本 |
| v4.0 | 2026-05-26 | 自動表格頁面偵測：P1 圖示化 / P2 賠率卡 / P3 資訊卡 |
| v4.1 | 2026-05-27 | 表格架構還原：透明格子 + 實體格線 + 45% 透明黑色 fill |
| v4.2 | 2026-05-27 | 多欄表格欄位對齊修復；cellText 不 trim；換圖跨頁搜尋 |
| v4.2.1 | 2026-06-02 | 相容性修復：manifest main 路徑、功能⑥⑦ handler、optional chaining |
