# Auto Table Pages (P1/P2/P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Figma 插件自動偵測並以固定模板生成 SYMBOLS PER PLAY（P1）、PAYTABLE（P2）、SPECIAL SYMBOLS（P3）三種頁面，適用於任意符號數量的遊戲。

**Architecture:** 在 `detectTableInfo` 加入兩種新型別（`paytable_v2`、`special_symbols`），各自路由到新 builder。P1 升級為圖示 frame；P2 解析 `[sym] N-(V)` 並自動合組；P3 生成左圖右文 info cards。共用 `makeIconOrPlaceholder`（component 優先，fallback 佔位框）。

**Tech Stack:** Figma Plugin API（ES5 語法），無外部依賴；手動在 Figma 中測試輸出。

**Spec:** `docs/superpowers/specs/2026-05-26-auto-table-pages-design.md`

---

## 檔案結構

| 動作 | 路徑 | 說明 |
|------|------|------|
| 建立 | `figma-plugin/code_v4.0.js` | 主程式（從 v3.9 複製後修改）|
| 修改 | `figma-plugin/manifest.json` | `main` 指向 `code_v4.0.js` |

> **重要**：所有修改都在 `code_v4.0.js` 裡進行，不動 `code_v3.9.js`（保留備份）。

---

## Task 1: 建立 v4.0 檔案並更新 manifest

**Files:**
- 建立: `figma-plugin/code_v4.0.js`
- 修改: `figma-plugin/manifest.json`

- [ ] **Step 1: 複製 v3.9 為 v4.0**

```powershell
Copy-Item "figma-plugin\code_v3.9.js" "figma-plugin\code_v4.0.js"
```

- [ ] **Step 2: 更新 manifest.json**

讀取 `figma-plugin/manifest.json`，將 `"main"` 值改為 `"code_v4.0.js"`：

```json
{
  "name": "遊戲說明書產生器 v3",
  "id": "...",
  "api": "1.0.0",
  "main": "code_v4.0.js",
  "ui": "ui.html",
  "editorType": ["figma"]
}
```

- [ ] **Step 3: 在 code_v4.0.js 頂部更新版本注解**

把第 3 行的 `// v3.3 — 換圖：字元級 WRAP 排列` 改為：

```javascript
// v4.0 — 自動表格頁面：P1 圖示化 / P2 賠率卡片自動合組 / P3 特殊符號資訊卡
```

- [ ] **Step 4: Commit**

```powershell
cd "C:\Users\leolu\Downloads\遊戲說明書產生器_FigmaPlugin_v3"
git add figma-plugin/code_v4.0.js figma-plugin/manifest.json
git commit -m "chore: scaffold v4.0 from v3.9, update manifest"
```

---

## Task 2: 新增共用 helper — makeIconOrPlaceholder 與 makeXMark

**Files:**
- 修改: `figma-plugin/code_v4.0.js`

在 `code_v4.0.js` 找到 `// ─── 共用儲存格建立` 區塊，在它**之前**插入以下兩個函式。

- [ ] **Step 1: 插入 `makeIconOrPlaceholder`**

在 `// ─── 共用儲存格建立` 這行前面加入：

```javascript
// ─── 圖示 / 佔位框 helper ──────────────────────────────────────
// symbolName: 符號名稱字串，如 "M1"、"WW"（不含括號）
// size: 正方形邊長（px）
// font: 已載入的字型物件
function makeIconOrPlaceholder(symbolName, size, font) {
  var cleanName = (symbolName || '').replace(/[\[\]\{\}]/g, '').trim();
  // 嘗試在整個 Figma 檔案中找同名 COMPONENT
  var comp = figma.root.findOne(function(n) {
    return n.type === 'COMPONENT' && n.name === cleanName;
  });
  var node;
  if (comp) {
    var inst = comp.createInstance();
    var maxDim = Math.max(inst.width, inst.height);
    if (maxDim > 0) {
      var scale = size / maxDim;
      inst.resize(
        Math.round(inst.width * scale),
        Math.round(inst.height * scale)
      );
    }
    node = inst;
  } else {
    // fallback：灰色佔位框 + 名稱文字
    var f = figma.createFrame();
    f.resize(size, size);
    f.layoutMode = 'VERTICAL';
    f.primaryAxisSizingMode = 'FIXED';
    f.counterAxisSizingMode = 'FIXED';
    f.primaryAxisAlignItems = 'CENTER';
    f.counterAxisAlignItems = 'CENTER';
    f.fills = [{ type: 'SOLID', color: { r: 0.30, g: 0.28, b: 0.38 } }];
    f.cornerRadius = 6;
    var t = figma.createText();
    t.fontName = font;
    t.fontSize = Math.max(10, Math.floor(size * 0.20));
    t.characters = cleanName || '?';
    t.fills = [{ type: 'SOLID', color: { r: 0.80, g: 0.78, b: 0.90 } }];
    t.textAlignHorizontal = 'CENTER';
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
    f.appendChild(t);
    node = f;
  }
  node.name = 'TBL_CELL'; // 供換圖功能偵測
  return node;
}
```

- [ ] **Step 2: 插入 `makeXMark`**

緊接在 `makeIconOrPlaceholder` 之後加入：

```javascript
// 建立橘紅色 ✕ 標記 frame（P1 移除符號用）
function makeXMark(size, font) {
  var f = figma.createFrame();
  f.resize(size, size);
  f.layoutMode = 'VERTICAL';
  f.primaryAxisSizingMode = 'FIXED';
  f.counterAxisSizingMode = 'FIXED';
  f.primaryAxisAlignItems = 'CENTER';
  f.counterAxisAlignItems = 'CENTER';
  f.fills = [{ type: 'SOLID', color: { r: 0.65, g: 0.12, b: 0.08 } }];
  f.cornerRadius = 4;
  var t = figma.createText();
  t.fontName = font;
  t.fontSize = Math.floor(size * 0.55);
  t.characters = '✕'; // ✕
  t.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  t.textAlignHorizontal = 'CENTER';
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  f.appendChild(t);
  f.name = 'TBL_CELL';
  return f;
}
```

- [ ] **Step 3: 確認插入位置正確**

搜尋 `code_v4.0.js`，確認：
- `makeIconOrPlaceholder` 定義在 `makeTblRow` **之前**
- `makeXMark` 定義在 `makeTblRow` **之前**
- 兩個函式都在 `// ─── 共用儲存格建立` 區塊**上方**

- [ ] **Step 4: Commit**

```powershell
git add figma-plugin/code_v4.0.js
git commit -m "feat(v4): add makeIconOrPlaceholder and makeXMark helpers"
```

---

## Task 3: 更新 detectTableInfo（加入 paytable_v2 / special_symbols）

**Files:**
- 修改: `figma-plugin/code_v4.0.js`（`detectTableInfo` 函式）

- [ ] **Step 1: 完整替換 `detectTableInfo`**

找到現有的 `function detectTableInfo(pageRows, lang) {` 整個函式，**完整替換**為：

```javascript
function detectTableInfo(pageRows, lang) {
  var COL_CONTENT = 4;
  var COL_IMAGE   = 3;
  var COL_TABLE_EN = 10;
  var ruleIdx = lang === "sch" ? 5 : 8;

  // Priority 1: PAYTABLE V2 — 表格EN 欄含 [sym] N-(V) 格式
  var firstTableCell = ((pageRows[0] && pageRows[0][COL_TABLE_EN]) || "").trim();
  if (firstTableCell && /\[[^\]]+\]\s*\(?\d+\)?\s*-\s*\(\d+\)/.test(firstTableCell)) {
    return { type: 'paytable_v2', rows: pageRows, ruleIdx: ruleIdx };
  }

  // Priority 2: SYMBOLS PER PLAY — 示意圖Sch 全部為 <數字>
  var betRows = pageRows.filter(function(r) {
    return /^<\d+>$/.test((r[COL_IMAGE] || "").trim());
  });
  if (betRows.length > 0) {
    return { type: 'bet_symbols', rows: betRows, allRows: pageRows, ruleIdx: ruleIdx };
  }

  // Priority 3: SPECIAL SYMBOLS — 示意圖Sch 為 [符號名稱] 格式
  var specialRows = pageRows.filter(function(r) {
    return /^\[[^\]]+\]$/.test((r[COL_IMAGE] || "").trim());
  });
  if (specialRows.length > 0) {
    return { type: 'special_symbols', rows: specialRows, ruleIdx: ruleIdx };
  }

  // 既有：赔率表（内容Sch = "赔率表"）
  var paytableRows = pageRows.filter(function(r) {
    return (r[COL_CONTENT] || "").trim() === '赔率表';
  });
  if (paytableRows.length > 0) {
    return { type: 'paytable', rows: paytableRows, ruleIdx: ruleIdx };
  }

  // 既有：資料範圍表（規則含 數字~數字）
  var rangeRows = pageRows.filter(function(r) {
    return /\d+\s*[~～]\s*\d+/.test(r[ruleIdx] || "");
  });
  if (rangeRows.length > 1) {
    return { type: 'data_table', rows: rangeRows, ruleIdx: ruleIdx };
  }

  return null;
}
```

- [ ] **Step 2: 確認修改範圍正確**

搜尋 `code_v4.0.js`，確認 `detectTableInfo` 只有一個定義，且包含 `paytable_v2`、`bet_symbols`、`special_symbols` 三種型別。

- [ ] **Step 3: Commit**

```powershell
git add figma-plugin/code_v4.0.js
git commit -m "feat(v4): update detectTableInfo with paytable_v2 and special_symbols detection"
```

---

## Task 4: 更新 buildTableFrame 路由

**Files:**
- 修改: `figma-plugin/code_v4.0.js`（`buildTableFrame` 函式）

- [ ] **Step 1: 完整替換 `buildTableFrame`**

找到現有的 `function buildTableFrame(tableInfo, lang, fontZH, fontEN, contentWidth) {`，**完整替換**為：

```javascript
function buildTableFrame(tableInfo, lang, fontZH, fontEN, contentWidth) {
  var font = lang === "sch" ? fontZH : fontEN;
  if (tableInfo.type === 'paytable_v2')     return buildPaytableV2Frame(tableInfo.rows, tableInfo.ruleIdx, font, contentWidth);
  if (tableInfo.type === 'paytable')         return buildPaytableFrame(tableInfo.rows, tableInfo.ruleIdx, font, contentWidth);
  if (tableInfo.type === 'bet_symbols')      return buildBetSymbolsFrameV2(tableInfo.rows, tableInfo.allRows, tableInfo.ruleIdx, lang, font, contentWidth);
  if (tableInfo.type === 'special_symbols')  return buildSpecialSymbolsFrame(tableInfo.rows, tableInfo.ruleIdx, lang, font, contentWidth);
  if (tableInfo.type === 'data_table')       return buildDataTableFrame(tableInfo.rows, tableInfo.ruleIdx, font, contentWidth);
  return null;
}
```

- [ ] **Step 2: Commit**

```powershell
git add figma-plugin/code_v4.0.js
git commit -m "feat(v4): update buildTableFrame routing for new page types"
```

---

## Task 5: 升級 P1 — buildBetSymbolsFrameV2（圖示化）

**Files:**
- 修改: `figma-plugin/code_v4.0.js`

P1 升級：符號由文字字串改為獨立 icon frame，移除符號改為 ✕ frame。

- [ ] **Step 1: 在 `buildBetSymbolsFrame` 前插入新函式**

在 `// ─── 投注符號表（TYPE B）` 區塊找到 `function buildBetSymbolsFrame(`，在它**上方**插入：

```javascript
// ─── P1：SYMBOLS PER PLAY（圖示版）──────────────────────────────
function buildBetSymbolsFrameV2(betRows, allRows, ruleIdx, lang, font, contentWidth) {
  var COL_CONTENT = 4;
  var COL_IMAGE   = 3;
  var ICON_SIZE   = 56;

  // 第一列（最高投注）的內容Sch = 完整符號清單
  var topRow = null;
  for (var ti = 0; ti < betRows.length; ti++) {
    if ((betRows[ti][COL_CONTENT] || "").trim() !== "") { topRow = betRows[ti]; break; }
  }
  if (!topRow) topRow = betRows[0];
  var allSyms = (topRow[COL_CONTENT] || "").trim().split(/\s+/).filter(Boolean);

  // 外框
  var tf = figma.createFrame();
  tf.layoutMode = 'VERTICAL';
  tf.resize(contentWidth, 1);
  tf.primaryAxisSizingMode = 'AUTO';
  tf.counterAxisSizingMode = 'FIXED';
  tf.itemSpacing = 1;
  tf.paddingTop = tf.paddingBottom = 0;
  tf.fills = [{ type: 'SOLID', color: { r: 0.90, g: 0.58, b: 0.08 } }];
  tf.strokes = [{ type: 'SOLID', color: { r: 0.90, g: 0.58, b: 0.08 } }];
  tf.strokeWeight = 2;
  tf.strokeAlign = 'OUTSIDE';
  tf.cornerRadius = 8;

  var BET_W  = 130;
  var hLabel = lang === "sch" ? "投注" : "BET";
  var sLabel = lang === "sch" ? "标志" : "SYMBOLS";

  // 標題列
  var header = makeTblRow(true);
  header.resize(contentWidth, 1);
  header.primaryAxisSizingMode = 'FIXED';
  header.counterAxisSizingMode = 'AUTO';
  header.appendChild(makeTblCell(BET_W, hLabel, font, 20, true, 'CENTER'));
  header.appendChild(makeTblCellGrow(sLabel, font, 20, true));
  tf.appendChild(header);

  // 資料列
  for (var i = 0; i < betRows.length; i++) {
    var row     = betRows[i];
    var betAmt  = ((row[COL_IMAGE] || "").match(/<(\d+)>/) || [])[1] || "?";
    var removed = (row[ruleIdx] || "").trim().split(/\s+/).filter(Boolean);
    var active  = allSyms.filter(function(s) { return removed.indexOf(s) === -1; });

    var dataRow = makeTblRow(false);
    dataRow.resize(contentWidth, 1);
    dataRow.primaryAxisSizingMode = 'FIXED';
    dataRow.counterAxisSizingMode = 'AUTO';

    // BET 格（文字）
    dataRow.appendChild(makeTblCell(BET_W, betAmt, font, 22, false, 'CENTER'));

    // SYMBOLS 格（icon frames + ✕ frames，HORIZONTAL WRAP）
    var symCell = figma.createFrame();
    symCell.layoutMode = 'VERTICAL';
    symCell.primaryAxisSizingMode = 'AUTO';
    symCell.counterAxisSizingMode = 'AUTO';
    symCell.layoutGrow = 1;
    symCell.layoutAlign = 'STRETCH';
    symCell.primaryAxisAlignItems = 'CENTER';
    symCell.counterAxisAlignItems = 'MIN';
    symCell.paddingLeft = symCell.paddingRight = 12;
    symCell.paddingTop = symCell.paddingBottom = 10;
    symCell.fills = [{ type: 'SOLID', color: { r: 0.18, g: 0.15, b: 0.28 } }];

    var iconRow = figma.createFrame();
    iconRow.layoutMode = 'HORIZONTAL';
    iconRow.layoutWrap = 'WRAP';
    iconRow.primaryAxisSizingMode = 'AUTO';
    iconRow.counterAxisSizingMode = 'AUTO';
    iconRow.primaryAxisAlignItems = 'MIN';
    iconRow.counterAxisAlignItems = 'CENTER';
    iconRow.itemSpacing = 8;
    iconRow.counterAxisSpacing = 8;
    iconRow.fills = [];
    iconRow.layoutAlign = 'STRETCH';

    for (var j = 0; j < active.length; j++) {
      iconRow.appendChild(makeIconOrPlaceholder(active[j], ICON_SIZE, font));
    }
    for (var k = 0; k < removed.length; k++) {
      iconRow.appendChild(makeXMark(ICON_SIZE, font));
    }

    symCell.appendChild(iconRow);
    dataRow.appendChild(symCell);
    tf.appendChild(dataRow);
  }

  return tf;
}
```

- [ ] **Step 2: 驗證 P1 在 Figma 中輸出正確**

  1. 在 Figma 開啟插件（manifest 已指向 code_v4.0.js）
  2. 連接試算表，選語言「英文」，按「生成」
  3. 找到 PAGE 1 的 Frame，確認：
     - BET 欄顯示 100 / 88 / 58 / 38 / 28
     - SYMBOLS 欄每格顯示灰色佔位框（或 component instances）
     - 每格尾端有橘紅色 ✕ frames（移除的符號）
     - ✕ frames 數量隨 BET 降低而減少

- [ ] **Step 3: Commit**

```powershell
git add figma-plugin/code_v4.0.js
git commit -m "feat(v4): add buildBetSymbolsFrameV2 - icon frames for P1 symbols"
```

---

## Task 6: 新增 P2 — buildPaytableV2Frame（賠率卡片自動合組）

**Files:**
- 修改: `figma-plugin/code_v4.0.js`

- [ ] **Step 1: 在 `// ─── 賠率表（TYPE C）` 前插入新函式**

找到 `// ─── 賠率表（TYPE C）────` 這行，在它**上方**插入：

```javascript
// ─── P2：PAYTABLE V2（解析 [sym] N-(V) 格式，自動合組）────────
function buildPaytableV2Frame(pageRows, ruleIdx, font, contentWidth) {
  var COL_TABLE_EN = 10;

  // 找 表格EN 欄內容
  var tableCell = '';
  for (var ri = 0; ri < pageRows.length; ri++) {
    var c = ((pageRows[ri] && pageRows[ri][COL_TABLE_EN]) || "").trim();
    if (c) { tableCell = c; break; }
  }
  if (!tableCell) return null;

  // ── Step 1：解析所有 [sym] count-(value) 條目 ──
  var payouts = {};   // sym → [{count, val}, ...]
  var symOrder = [];
  var re = /\[([^\]]+)\]\s*\(?(\d+)\)?\s*-\s*\((\d+)\)/g;
  var lines = tableCell.split('\n');
  for (var li = 0; li < lines.length; li++) {
    var cols = lines[li].split('\t');
    for (var ci = 0; ci < cols.length; ci++) {
      re.lastIndex = 0;
      var cellStr = (cols[ci] || "").trim();
      var m;
      while ((m = re.exec(cellStr)) !== null) {
        var sym = m[1];
        if (!payouts[sym]) { payouts[sym] = []; symOrder.push(sym); }
        payouts[sym].push({ count: parseInt(m[2], 10), val: parseInt(m[3], 10) });
      }
    }
  }
  if (symOrder.length === 0) return null;

  // 每個符號的賠率按 count 由大到小排序
  for (var s in payouts) {
    payouts[s].sort(function(a, b) { return b.count - a.count; });
  }

  // ── Step 2：建立賠率指紋並分組 ──
  function fingerprint(sym) {
    return payouts[sym].map(function(p) { return p.count + ':' + p.val; }).join('|');
  }
  var groups = {};      // fingerprint → [sym, ...]
  var groupOrder = [];
  for (var si = 0; si < symOrder.length; si++) {
    var fp = fingerprint(symOrder[si]);
    if (!groups[fp]) { groups[fp] = []; groupOrder.push(fp); }
    groups[fp].push(symOrder[si]);
  }

  // 排序：個別符號（size=1）優先，再按最高賠率值降序
  groupOrder.sort(function(a, b) {
    var aLen = groups[a].length, bLen = groups[b].length;
    if (aLen !== bLen) return aLen - bLen;
    return payouts[groups[b][0]][0].val - payouts[groups[a][0]][0].val;
  });

  var individualFPs = groupOrder.filter(function(fp) { return groups[fp].length === 1; });
  var groupFPs      = groupOrder.filter(function(fp) { return groups[fp].length > 1;  });

  var GAP           = 16;
  var ICON_SIZE_IND = 80;
  var ICON_SIZE_GRP = 64;

  // ── Step 3：製作單張賠率卡 ──
  function makePayCard(syms, pouts, cardW, iconSize) {
    var card = figma.createFrame();
    card.layoutMode = 'VERTICAL';
    card.resize(cardW, 1);
    card.primaryAxisSizingMode = 'AUTO';
    card.counterAxisSizingMode = 'FIXED';
    card.primaryAxisAlignItems = 'CENTER';
    card.counterAxisAlignItems = 'CENTER';
    card.itemSpacing = 8;
    card.paddingTop = card.paddingBottom = 14;
    card.paddingLeft = card.paddingRight = 10;
    card.fills  = [{ type: 'SOLID', color: { r: 0.18, g: 0.15, b: 0.28 } }];
    card.strokes = [{ type: 'SOLID', color: { r: 0.90, g: 0.58, b: 0.08 } }];
    card.strokeWeight = 1;
    card.strokeAlign  = 'INSIDE';
    card.cornerRadius = 8;

    // 圖示列
    var iconRow = figma.createFrame();
    iconRow.layoutMode = 'HORIZONTAL';
    iconRow.primaryAxisSizingMode = 'AUTO';
    iconRow.counterAxisSizingMode = 'AUTO';
    iconRow.primaryAxisAlignItems = 'CENTER';
    iconRow.counterAxisAlignItems = 'CENTER';
    iconRow.itemSpacing = 8;
    iconRow.fills = [];
    for (var xi = 0; xi < syms.length; xi++) {
      iconRow.appendChild(makeIconOrPlaceholder(syms[xi], iconSize, font));
    }
    card.appendChild(iconRow);

    // 橘色分隔線
    var div = figma.createFrame();
    div.resize(Math.max(40, cardW - 20), 1);
    div.primaryAxisSizingMode = 'FIXED';
    div.counterAxisSizingMode = 'FIXED';
    div.fills = [{ type: 'SOLID', color: { r: 0.90, g: 0.58, b: 0.08 } }];
    card.appendChild(div);

    // 賠率文字（格式：count : val）
    var payLines = pouts.map(function(p) { return p.count + ' : ' + p.val; }).join('\n');
    var payText = figma.createText();
    payText.fontName = font;
    payText.fontSize = 17;
    payText.characters = payLines;
    payText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    payText.textAlignHorizontal = 'CENTER';
    payText.textAutoResize = 'HEIGHT';
    payText.layoutAlign = 'STRETCH';
    card.appendChild(payText);

    return card;
  }

  // ── Step 4：建立整體容器 ──
  var container = figma.createFrame();
  container.layoutMode = 'VERTICAL';
  container.primaryAxisSizingMode = 'AUTO';
  container.counterAxisSizingMode = 'FIXED';
  container.resize(contentWidth, 1);
  container.itemSpacing = GAP;
  container.fills = [];

  // 個別符號行（每行最多 5 張）
  if (individualFPs.length > 0) {
    var indChunks = chunkArray(individualFPs, 5);
    for (var ic = 0; ic < indChunks.length; ic++) {
      var chunk = indChunks[ic];
      var n = chunk.length;
      var cardW = Math.floor((contentWidth - GAP * (n - 1)) / n);
      var rowF = figma.createFrame();
      rowF.layoutMode = 'HORIZONTAL';
      rowF.primaryAxisSizingMode = 'AUTO';
      rowF.counterAxisSizingMode = 'AUTO';
      rowF.itemSpacing = GAP;
      rowF.fills = [];
      for (var ci2 = 0; ci2 < chunk.length; ci2++) {
        var fp2 = chunk[ci2];
        rowF.appendChild(makePayCard(groups[fp2], payouts[groups[fp2][0]], cardW, ICON_SIZE_IND));
      }
      container.appendChild(rowF);
    }
  }

  // 合組符號行（每行最多 3 組）
  if (groupFPs.length > 0) {
    var grpChunks = chunkArray(groupFPs, 3);
    for (var gc = 0; gc < grpChunks.length; gc++) {
      var gChunk = grpChunks[gc];
      var gn = gChunk.length;
      var gCardW = Math.floor((contentWidth - GAP * (gn - 1)) / gn);
      var gRowF = figma.createFrame();
      gRowF.layoutMode = 'HORIZONTAL';
      gRowF.primaryAxisSizingMode = 'AUTO';
      gRowF.counterAxisSizingMode = 'AUTO';
      gRowF.itemSpacing = GAP;
      gRowF.fills = [];
      for (var gci = 0; gci < gChunk.length; gci++) {
        var gfp = gChunk[gci];
        gRowF.appendChild(makePayCard(groups[gfp], payouts[groups[gfp][0]], gCardW, ICON_SIZE_GRP));
      }
      container.appendChild(gRowF);
    }
  }

  return container;
}
```

- [ ] **Step 2: 驗證 P2 在 Figma 中輸出正確**

  1. 重新載入插件，生成
  2. 找到 PAGE 2 的 Frame，確認：
     - 上方顯示 "PAYTABLE" 標題 + 副標題文字
     - 第一行：5 張個別符號卡（M1~M5），等寬排列
     - 第二行：2 張合組卡（AK 合一張、QJ10 9 合一張），各半寬
     - 每張卡：灰色 icon 佔位框（或 component）+ 橘色分隔線 + 賠率文字
     - 若有 11 個個別符號 → 自動排成 2 行（5+6 或 5+5+1）

- [ ] **Step 3: Commit**

```powershell
git add figma-plugin/code_v4.0.js
git commit -m "feat(v4): add buildPaytableV2Frame - parse [sym] N-(V), auto-group same payouts"
```

---

## Task 7: 新增 P3 — buildSpecialSymbolsFrame（WILD/SCATTER info cards）

**Files:**
- 修改: `figma-plugin/code_v4.0.js`

- [ ] **Step 1: 在 `// ─── 資料範圍表` 前插入新函式**

找到 `// ─── 資料範圍表（TYPE D/E）` 這行，在它**上方**插入：

```javascript
// ─── P3：SPECIAL SYMBOLS（WILD / SCATTER info cards）────────────
// 每列資料 = 一張資訊卡（左圖右文）
function buildSpecialSymbolsFrame(specialRows, ruleIdx, lang, font, contentWidth) {
  var COL_IMAGE     = 3;   // 示意圖Sch → [SymName]
  var COL_TITLE_EN  = 2;   // 標題EN
  var COL_TITLE_SCH = 1;   // 標題Sch
  var ICON_SIZE     = 120;

  var container = figma.createFrame();
  container.layoutMode = 'VERTICAL';
  container.primaryAxisSizingMode = 'AUTO';
  container.counterAxisSizingMode = 'FIXED';
  container.resize(contentWidth, 1);
  container.itemSpacing = 32;
  container.fills = [];

  for (var ri = 0; ri < specialRows.length; ri++) {
    var row      = specialRows[ri];
    var symRef   = (row[COL_IMAGE] || "").trim();           // e.g. "[WW]"
    var symName  = symRef.replace(/[\[\]]/g, '').trim();   // e.g. "WW"
    var cardTitle = (lang === 'sch'
      ? (row[COL_TITLE_SCH] || row[COL_TITLE_EN] || symName)
      : (row[COL_TITLE_EN]  || symName)
    ).trim();
    var ruleText = (row[ruleIdx] || "").trim();

    // 卡片外框（HORIZONTAL）
    var card = figma.createFrame();
    card.layoutMode = 'HORIZONTAL';
    card.primaryAxisSizingMode = 'AUTO';
    card.counterAxisSizingMode = 'FIXED';
    card.resize(contentWidth, 1);
    card.primaryAxisAlignItems = 'MIN';
    card.counterAxisAlignItems = 'CENTER';
    card.itemSpacing = 24;
    card.paddingLeft = card.paddingRight = 32;
    card.paddingTop  = card.paddingBottom = 32;
    card.fills = [{ type: 'SOLID', color: { r: 0.15, g: 0.13, b: 0.25 } }];
    card.cornerRadius = 12;

    // 左側：icon
    card.appendChild(makeIconOrPlaceholder(symName, ICON_SIZE, font));

    // 右側：標題 + 規則文字
    var textCol = figma.createFrame();
    textCol.layoutMode = 'VERTICAL';
    textCol.primaryAxisSizingMode = 'AUTO';
    textCol.counterAxisSizingMode = 'AUTO';
    textCol.layoutGrow = 1;
    textCol.layoutAlign = 'STRETCH';
    textCol.primaryAxisAlignItems = 'MIN';
    textCol.counterAxisAlignItems = 'MIN';
    textCol.itemSpacing = 12;
    textCol.fills = [];

    // 卡片標題（黃色）
    var titleT = figma.createText();
    titleT.fontName = font;
    titleT.fontSize = 32;
    titleT.characters = cardTitle || symName;
    titleT.fills = [{ type: 'SOLID', color: { r: 0.94, g: 0.75, b: 0.15 } }];
    titleT.textAutoResize = 'WIDTH_AND_HEIGHT';
    textCol.appendChild(titleT);

    // 規則文字（白色，支援 bullet）
    if (ruleText) {
      var processed = processBulletText(ruleText);
      var ruleT = figma.createText();
      ruleT.fontName = font;
      ruleT.fontSize = 22;
      ruleT.characters = processed.text;
      ruleT.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      ruleT.textAutoResize = 'HEIGHT';
      ruleT.layoutAlign = 'STRETCH';
      for (var bi = 0; bi < processed.bulletRanges.length; bi++) {
        ruleT.setRangeListOptions(
          processed.bulletRanges[bi].start,
          processed.bulletRanges[bi].end,
          { type: 'UNORDERED' }
        );
      }
      textCol.appendChild(ruleT);
    }

    card.appendChild(textCol);
    container.appendChild(card);
  }

  return container;
}
```

- [ ] **Step 2: 驗證 P3 在 Figma 中輸出正確**

  1. 重新載入插件，生成
  2. 找到 PAGE 3 的 Frame，確認：
     - Frame 中只有 info cards，**無整頁大標題**（P3 的標題在每張卡裡）
     - 每張卡：左側灰色 icon 佔位框 120×120（或 component）+ 右側黃色標題 + 白色 bullet 文字
     - WILD 和 SCATTER 各一張卡，垂直堆疊

- [ ] **Step 3: Commit**

```powershell
git add figma-plugin/code_v4.0.js
git commit -m "feat(v4): add buildSpecialSymbolsFrame - P3 info cards (left icon, right text)"
```

---

## Task 8: 更新 generateManual — P3 特殊分支

**Files:**
- 修改: `figma-plugin/code_v4.0.js`（`generateManual` 函式內的頁面生成迴圈）

P3 頁面不使用預設的「大標題 + 規則文字 + 表格」結構，整頁由 info cards 組成。

- [ ] **Step 1: 找到 generateManual 頁面迴圈中的表格生成段落**

在 `generateManual` 裡找到以下區塊（約第 176~193 行附近）：

```javascript
        pageFrame.appendChild(titleNode);
        pageFrame.appendChild(ruleNode);

        // 表格生成：優先使用專屬 Table 欄，無則偵測多行格式
        try {
          const tblIdx = lang === "sch" ? colIndex.tableSch : colIndex.tableEN;
          const cellText = (tblIdx >= 0) ? (firstRow[tblIdx] || "").trim() : "";
          let tableF = null;
          if (cellText) {
            tableF = buildTableFromCell(cellText, lang, fontZH, fontEN, FRAME_W - PADDING * 2);
          } else {
            const tableInfo = detectTableInfo(pageRows, lang);
            if (tableInfo) tableF = buildTableFrame(tableInfo, lang, fontZH, fontEN, FRAME_W - PADDING * 2);
          }
          if (tableF) {
            ruleNode.layoutGrow = 0;
            ruleNode.textAutoResize = "HEIGHT";
            tableF.layoutAlign = "STRETCH";
            // 不設 layoutGrow，讓表格高度自動適應內容
            pageFrame.appendChild(tableF);
          }
        } catch (_) {}
```

- [ ] **Step 2: 替換為含 P3 分支的新版本**

**完整替換**上述段落為：

```javascript
        // ── P3 特殊分支：special_symbols 整頁為 info cards，跳過預設標題/規則 ──
        var pageTableInfo = detectTableInfo(pageRows, lang);
        if (pageTableInfo && pageTableInfo.type === 'special_symbols') {
          var cardsFrame = buildSpecialSymbolsFrame(
            pageTableInfo.rows, pageTableInfo.ruleIdx, lang,
            lang === "sch" ? fontZH : fontEN,
            FRAME_W - PADDING * 2
          );
          if (cardsFrame) {
            cardsFrame.layoutAlign = 'STRETCH';
            cardsFrame.layoutGrow = 1;
            pageFrame.appendChild(cardsFrame);
          }
        } else {
          // 正常流程：大標題 + 規則文字 + 可選表格
          pageFrame.appendChild(titleNode);
          pageFrame.appendChild(ruleNode);

          try {
            const tblIdx = lang === "sch" ? colIndex.tableSch : colIndex.tableEN;
            const cellText = (tblIdx >= 0) ? (firstRow[tblIdx] || "").trim() : "";
            var tableF = null;
            if (cellText) {
              tableF = buildTableFromCell(cellText, lang, fontZH, fontEN, FRAME_W - PADDING * 2);
            } else if (pageTableInfo) {
              tableF = buildTableFrame(pageTableInfo, lang, fontZH, fontEN, FRAME_W - PADDING * 2);
            }
            if (tableF) {
              ruleNode.layoutGrow = 0;
              ruleNode.textAutoResize = "HEIGHT";
              tableF.layoutAlign = "STRETCH";
              pageFrame.appendChild(tableF);
            }
          } catch (_) {}
        }
```

> **注意**：此替換去掉了 `const tableInfo = detectTableInfo(...)` 的重複呼叫（改用已計算的 `pageTableInfo`），邏輯等效但效率更好。

- [ ] **Step 3: 驗證整體生成流程**

  1. 重新載入插件，全量生成（語言選「英文版」）
  2. 確認：
     - PAGE 1：BET × SYMBOLS 表，符號為圖示佔位框，移除符號為 ✕
     - PAGE 2：PAYTABLE 標題 + 副標題 + 卡片排列（個別 + 合組）
     - PAGE 3：只有 info cards，無整頁大標題
     - 其他頁面（PAGE 4 以後）：輸出與 v3.9 相同，無迴歸

- [ ] **Step 4: Commit**

```powershell
git add figma-plugin/code_v4.0.js
git commit -m "feat(v4): update generateManual - P3 special_symbols branch skips default title/rule"
```

---

## Task 9: 整合驗證與最終 commit

**Files:**
- 修改: `figma-plugin/code_v4.0.js`（視需要修正）

- [ ] **Step 1: 完整端對端測試**

  按以下清單逐一驗證（在 Figma 中實際執行）：

  | # | 測試情境 | 預期結果 |
  |---|---------|---------|
  | 1 | 生成英文版，PAGE 1 | BET×SYMBOLS 表，符號 icon 佔位框，✕ 標記移除符號 |
  | 2 | 生成英文版，PAGE 2 | 個別卡片（M1~M5）一行，合組卡（AK / QJ109）一行 |
  | 3 | 生成英文版，PAGE 3 | WILD + SCATTER info cards，左圖右文，無整頁標題 |
  | 4 | 生成中文版，PAGE 1-3 | 同上，標題/標籤顯示中文 |
  | 5 | 其他頁面（PAGE 4+）| 與 v3.9 輸出視覺相同，無錯誤 |
  | 6 | 換圖功能（icons only）| 選取含 TBL_CELL 的 Frame，換圖正常替換 P1/P2/P3 |

- [ ] **Step 2: 若有 bug，修正後補充 commit**

  常見問題排查：
  - `figma.root.findOne` 找不到 component → 確認 Figma 檔案中 component 名稱與符號名稱完全一致
  - P2 卡片寬度計算跑版 → 確認 `chunkArray` 函式存在且正確（`code_v4.0.js` 應已繼承 v3.9 的 `chunkArray`）
  - P3 rule text 不顯示 bullet → 確認 `processBulletText` 呼叫語法（傳回 `{text, bulletRanges}`）

- [ ] **Step 3: Push 到 GitHub**

```powershell
git push origin main
```

- [ ] **Step 4: 更新 CLAUDE.md（若架構有變動）**

  如果有新函式名稱或新偵測邏輯值得記錄，在 `CLAUDE.md` 的「表格生成」段落加入：

  ```markdown
  ### 自動頁面類型偵測（v4.0）
  - `paytable_v2`：表格EN 含 `[sym] N-(V)` → `buildPaytableV2Frame`
  - `bet_symbols`：示意圖Sch = `<數字>` → `buildBetSymbolsFrameV2`（圖示版）
  - `special_symbols`：示意圖Sch = `[名稱]` → `buildSpecialSymbolsFrame`（info cards）
  - `makeIconOrPlaceholder(name, size, font)`：component 優先，fallback 灰色佔位框，`name='TBL_CELL'`
  ```

---

## 自我檢查清單

- [x] spec 章節 2（偵測邏輯）→ Task 3 覆蓋
- [x] spec 章節 3（P1 模板）→ Task 5 覆蓋
- [x] spec 章節 4（P2 模板）→ Task 6 覆蓋
- [x] spec 章節 5（P3 模板）→ Task 7 覆蓋
- [x] spec 章節 6（makeIconOrPlaceholder / makeXMark）→ Task 2 覆蓋
- [x] spec 章節 7.3（generateManual P3 分支）→ Task 8 覆蓋
- [x] 換圖功能相容（TBL_CELL 命名）→ Task 2 / Task 5 / Task 7 都設定 `node.name = 'TBL_CELL'`
- [x] 不動 ui.html → 無 UI 相關任務
- [x] 不動 code_v3.9.js → Task 1 複製，所有改動在 v4.0
