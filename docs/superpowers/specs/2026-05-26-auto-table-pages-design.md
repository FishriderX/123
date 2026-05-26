# 自動表格頁面生成設計

**日期**: 2026-05-26  
**版本**: v1.0  
**目標版本**: code_v4.0.js  

---

## 1. 概述

本次設計目標：讓插件能**自動偵測** P1（SYMBOLS PER PLAY）、P2（PAYTABLE）、P3（SPECIAL SYMBOLS）三種頁面類型，並以**固定模板**生成視覺正確的 Figma Frame，適用於任意遊戲（符號數量、投注級別、特殊符號種類皆可變動）。

現行問題：
- P1 已有 `buildBetSymbolsFrame` 但符號全用純文字，沒有圖示佔位
- P2 的 `[sym] N-(V)` tab 分隔格式未被解析；無自動合組邏輯
- P3 無對應模板，目前僅輸出規則文字

---

## 2. 頁面類型偵測邏輯

`detectTableInfo` 在判斷 `bet_symbols` 與 `paytable` 之前，先加入以下偵測優先順序：

```
對每個 PAGE 的所有列（pageRows）：

優先順序 1 → PAYTABLE
  條件：表格EN 欄（index 10）存在，且包含 [sym] N-(V) 格式
  → type: 'paytable_v2'

優先順序 2 → SYMBOLS_PER_PLAY  
  條件：示意圖Sch（index 3）全部符合 /^<\d+>$/ 格式
  → type: 'bet_symbols'（已有，升級實作）

優先順序 3 → SPECIAL_SYMBOLS
  條件：示意圖Sch（index 3）符合 /^\[[^\]]+\]$/ 格式（方括號符號名稱，非數字）
  → type: 'special_symbols'

優先順序 4 → 現有其他偵測（data_table 等）
```

---

## 3. P1 — SYMBOLS PER PLAY 模板

### 3.1 資料來源（Google Sheets）

| 欄位 | index | 內容 |
|------|-------|------|
| 示意圖Sch | 3 | `<BET_AMOUNT>`（如 `<100>`, `<88>`, `<58>`）|
| 內容Sch | 4 | 第一列填入完整符號清單（空格分隔，如 `WW M4 C1 M5 M1 A M2 K M3 Q`）|
| 規則Sch/EN | 5/8 | 該投注級別**移除**的符號（空格分隔，如 `J 10 9`）|

### 3.2 視覺模板

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SYMBOLS PER PLAY（黃色標題）                      │
│                    · 小字說明文（規則文字）                           │
│  BET  │  [icon][icon][icon] ... [✕][✕][✕]                           │
│  100  │                                                              │
│   88  │  [icon][icon][icon] ... [✕][✕][✕]                           │
│   58  │  [icon][icon][A_icon] ... [✕][✕]                            │
│   38  │  [icon][icon][K_icon][J_icon][10_icon] ... [✕]              │
│   28  │  [icon][icon][Q_icon][J_icon][10_icon][9_icon]              │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 實作規則

- **BET 欄寬**：130px fixed
- **SYMBOLS 欄**：`layoutGrow=1`，horizontal WRAP，`itemSpacing=8`
- **Active 符號**：`allSyms`（第一列 內容Sch）中，排除 `removed` 的部分
- **符號圖示**：呼叫 `makeIconOrPlaceholder(name, 64)` → 64×64
- **移除符號**：呼叫 `makeXMark(64)` → 64×64 橘紅 ✕ frame
- **行數**：幾個 `<BET>` 列就幾行，不限制

### 3.4 升級點（vs 現有 buildBetSymbolsFrame）

- 現有：符號合併為文字字串 → **改為**：每個符號獨立 icon frame
- 現有：移除符號用 `✕` 文字 → **改為**：獨立樣式化 ✕ frame
- 邏輯核心保持不變（allSyms - removed = active）

---

## 4. P2 — PAYTABLE 模板

### 4.1 資料來源（Google Sheets）

| 欄位 | index | 內容 |
|------|-------|------|
| 標題EN | 2 | `PAYTABLE` |
| 規則EN | 8 | 副標題說明（如 `ALL WINS FROM PER BET MULTIPLIED 12`）|
| 表格EN | 10 | 多行 tab 分隔的賠率資料（見下方格式）|

**表格EN 格式：**
```
[M1] 5-(750)	[M2] 5-(250)	[M3] 5-(250)
[M1] 4-(150)	[M2] 4-(60)	[M3] 4-(60)
[M1] 3-(75)	[M2] 3-(30)	[M3] 3-(30)
[M4] 5-(150)	[M5] 5-(150)	[A] (5)-(100)
...
```

### 4.2 解析邏輯

```
Step 1：按行拆分（`\n`），每行按 Tab 拆分欄
Step 2：每個 cell 用 regex 解析：
        /^\[([^\]]+)\]\s*\(?(\d+)\)?\s*-\s*\((\d+)\)/
        → { sym: "M1", count: 5, value: 750 }
Step 3：以 sym 為 key，累積所有 {count, value} pairs
        payouts["M1"] = [{count:5,val:750},{count:4,val:150},{count:3,val:75}]
Step 4：建立「賠率指紋」per symbol：
        fingerprint("M1") = "5:750|4:150|3:75"
Step 5：相同指紋的符號合為一組
        group["5:100|4:15|3:5"] = ["A", "K"]
Step 6：排序：以最高賠率值降序排列；同賠率群組排在個別符號後方
```

### 4.3 卡片排列規則

```
個別符號（group size = 1）：
  ≤5 張 → 單行，每張等寬 = (contentW - gaps) / N
  >5 張 → 每行最多5張，自動換行

合組符號（group size ≥ 2）：
  1 個群組 → 全寬
  2 個群組 → 各半寬
  3 個群組 → 各三分之一寬
  >3 個群組 → 同個別符號換行邏輯

卡片之間 gap = 16px
```

### 4.4 卡片內部結構

```
┌───────────────────────┐
│  [icon] [icon] ...    │  ← 群組卡：多個 icon 水平排列
│  （個別卡：1 個 icon） │     icon 尺寸：80×80（個別）/ 64×64（群組）
│  ─────────────────    │  ← 橘色分隔線 1px
│  5 : 750              │
│  4 : 150              │  ← 白色賠率文字，字號 18
│  3 :  75              │
└───────────────────────┘
  邊框：橘色 1px INSIDE，圓角 8px
  背景：深色 rgb(0.18, 0.15, 0.28)
```

### 4.5 整頁 Layout

- 標題（黃色居中）
- 副標題（小字，規則EN）
- 個別卡片行（HORIZONTAL WRAP auto-layout）
- 合組卡片行（HORIZONTAL WRAP auto-layout）
- 兩行之間 gap = 24px

---

## 5. P3 — SPECIAL SYMBOLS 模板

### 5.1 資料來源（Google Sheets）

| 欄位 | index | 內容 |
|------|-------|------|
| 示意圖Sch | 3 | `[SymbolName]`（如 `[WW]`, `[C1]`）|
| 標題EN | 2 | 卡片標題（如 `WILD`, `SCATTER`）|
| 規則EN | 8 | 說明文（bullet point 格式，`·` 開頭）|

### 5.2 視覺模板（每列資料 = 一張卡）

```
┌─────────────────────────────────────────────────────────────────────┐
│  ┌─────┐   WILD                                                     │
│  │icon │   · Substitutes for all symbols, except [C1]               │
│  │ 120 │   · Appears on reels 2, 3 and 4 only during the base game. │
│  └─────┘                                                            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  ┌─────┐   SCATTER                                                  │
│  │icon │   · If the selected bet option is 28, 38, 58 or 88...      │
│  │ 120 │   · If the selected bet option is 100...                   │
│  └─────┘                                                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 實作規則

- **卡片 Layout**：HORIZONTAL auto-layout，全寬（layoutAlign=STRETCH）
- **Icon 區**：120×120，`makeIconOrPlaceholder(name, 120)`
- **文字區**：VERTICAL auto-layout，layoutGrow=1
  - 標題：字號 32，黃色，`font-weight Bold` 
  - 說明文：字號 22，白色，bullet list（沿用現有 `processBulletText`）
- **卡片間距**：32px
- **卡片背景**：`rgb(0.15, 0.13, 0.25)`，圓角 12px，padding 32px
- **P3 無整頁標題**：直接以卡片堆疊為主體內容

---

## 6. 共用工具：圖示處理

### 6.1 `makeIconOrPlaceholder(symbolName, size)`

```
參數：
  symbolName: string（如 "M1", "WW", "WW M4"）
  size: number（目標尺寸，正方形）

邏輯：
  1. 清理名稱：stripBraces(symbolName).trim()
  2. figma.root.findOne(n => n.type==='COMPONENT' && n.name===cleanName)
  3. 找到 → inst = comp.createInstance()
             按比例縮放至 size×size
             return inst
  4. 找不到 → frame = figma.createFrame()
              frame.resize(size, size)
              frame.fills = [{ type:'SOLID', color:{r:0.3,g:0.28,b:0.38} }]
              frame.cornerRadius = 6
              label = figma.createText() → cleanName，白色，字號=size*0.22
              居中放入 frame
              return frame
  5. frame.name = 'TBL_CELL'（供換圖功能偵測）
```

### 6.2 `makeXMark(size)`

```
建立橘紅色 ✕ 標記 frame（用於 P1 移除符號）：
  frame: size×size，圓角 4px
  背景：rgb(0.65, 0.12, 0.08)（深紅）
  文字：'✕'，字號 size*0.55，白色，居中
  name: 'TBL_CELL'
```

---

## 7. 與現有程式碼整合

### 7.1 修改點（code.js）

| 函式 | 修改類型 | 說明 |
|------|---------|------|
| `detectTableInfo` | 修改 | 加入 `paytable_v2` 和 `special_symbols` 偵測 |
| `buildTableFrame` | 修改 | 加入 `paytable_v2` 和 `special_symbols` 路由 |
| `generateManual` | **小幅修改** | P3 特殊分支：跳過預設標題/規則節點（見 7.3）|
| `buildBetSymbolsFrame` | 升級 | 符號改為 icon frames（保留現有邏輯骨架）|
| `buildPaytableV2Frame` | **新增** | 解析新格式，auto-group，card layout |
| `buildSpecialSymbolsFrame` | **新增** | P3 info card 堆疊 |
| `makeIconOrPlaceholder` | **新增** | 共用 icon/佔位 helper |
| `makeXMark` | **新增** | P1 移除符號標記 |

### 7.2 不改動

- `handleIconsOnly`（換圖功能）- 仍可正常替換 TBL_CELL 內的圖示
- `buildTableFromCell`（現有 tab 格式表格）
- UI (`ui.html`)

### 7.3 generateManual 修改：P3 分支

P3 頁面（`special_symbols`）不使用預設的「大標題 + 規則文字 + 表格」結構，
而是整頁由 info cards 組成。在 `generateManual` 的頁面生成迴圈中加入提前偵測：

```javascript
// 在 titleNode / ruleNode append 前先偵測
const earlyTableInfo = detectTableInfo(pageRows, lang);

if (earlyTableInfo && earlyTableInfo.type === 'special_symbols') {
  // P3：整頁由 info cards 組成，不加預設標題/規則
  const cardsFrame = buildSpecialSymbolsFrame(
    earlyTableInfo, lang, fontZH, fontEN, FRAME_W - PADDING * 2
  );
  if (cardsFrame) {
    cardsFrame.layoutAlign = 'STRETCH';
    cardsFrame.layoutGrow = 1;
    pageFrame.appendChild(cardsFrame);
  }
} else {
  // 其他頁面：正常流程（標題 + 規則 + 可選表格）
  pageFrame.appendChild(titleNode);
  pageFrame.appendChild(ruleNode);
  // ... 現有表格偵測 & append 邏輯
}
```

### 7.4 偵測細節補充

- `paytable_v2` 偵測：檢查 `firstRow[10]`（表格EN 欄），對其值做 regex 測試
  - 正規式：`/\[[^\]]+\]\s*\(?\d+\)?\s*-\s*\(\d+\)/`
- `special_symbols` 偵測：`pageRows` 中**至少一列**的 `row[3]` 符合 `/^\[[^\]]+\]$/`
- P2 副標題（副標題說明文）：沿用 `findPrimaryRuleText(pageRows, ruleIdx)`，
  從非表格資料列中取得（如 `ALL WINS FROM PER BET MULTIPLIED 12`）

### 7.3 版本備份

開始實作前先備份：`code_v3.9.js` → `code_v3.9_pre.js`（已存在）
新版本輸出為：`code_v4.0.js`

---

## 8. 資料格式總結（試算表填寫規範）

| 頁面類型 | 偵測觸發條件 | 示意圖Sch (col3) | 內容Sch (col4) | 規則Sch/EN (col5/8) | 表格EN (col10) |
|---------|------------|-----------------|--------------|---------------------|----------------|
| SYMBOLS_PER_PLAY | col3 = `<數字>` | `<100>` | 第一列填所有符號 | 該級移除符號 | 空 |
| PAYTABLE | col10 含 `[sym] N-(V)` | 空 | 空/`赔率表` | 副標題 | 多行 tab 格式 |
| SPECIAL_SYMBOLS | col3 = `[名稱]` | `[WW]` | 空 | 說明文 | 空 |

---

## 9. 成功標準

- [ ] P1：任意投注級別數量，符號正確顯示為 icon（或佔位框），移除符號顯示為 ✕
- [ ] P2：任意符號數量，同賠率自動合組，卡片整齊排列填滿寬度
- [ ] P3：任意特殊符號數量，每張 info card 左圖右文正確顯示
- [ ] 換圖功能（handleIconsOnly）仍可正常替換三種頁面中的 TBL_CELL
- [ ] 其他現有頁面（文字說明、一般表格）不受影響
