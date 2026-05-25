# Bug Fix Design：插件跨專案穩定性修正

**日期**：2026-05-25  
**版本**：v3.9 → v3.10  
**範圍**：只修 Bug，不改任何現有功能邏輯  
**目標**：插件在任何 Figma 專案、任何試算表格式下都不會 crash 或靜默失敗

---

## Bug ① — CSS class 名稱錯誤（`ui.html`）

**影響**：「指定字元換字型」和「修正圓點字型」兩個工具的成功/失敗訊息框永遠不會正確顯示。

**根因**：CSS 定義 `.status-box.done` / `.status-box.error`，但 JS 設的是 `status-done` / `status-error`（多了 `status-` 前綴），className 對不上，`display: block` 無法觸發。

**修法**：
- `showStyleStatus` 函式：`'status-box status-' + type` → `'status-box ' + type`
- `bullet-done` handler：`'status-box status-done'` → `'status-box done'`
- `bullet-error` handler：`'status-box status-error'` → `'status-box error'`

**修改檔案**：`figma-plugin/ui.html`（3 處字串）

---

## Bug ② — `handleIconsOnly` 遇到 Instance 全體中斷（`code.js`）

**影響**：選取範圍內只要有任何一個文字在元件實例內，整個換圖就終止，其他正常節點也無法處理。

**根因**：偵測到 Instance 時呼叫 `return`，應改為 `continue`。

**修法**：
1. 在迴圈外宣告 `var skippedCount = 0`
2. `if (anc) { return; }` → `if (anc) { skippedCount++; continue; }`
3. 在 `icon-done` 訊息後面附加跳過統計（若 > 0 則加 `⚠️ X 個節點在元件實例內已跳過`）

**修改檔案**：`figma-plugin/code.js`（`handleIconsOnly` 函式，約第 384–390 行）

---

## Bug ③ — 混合字型 textNode 未防護（`code.js`）

**影響**：選取的文字節點若含混合字型，`textNode.fontName` 回傳 `figma.mixed`（Symbol），直接傳給 `loadFontAsync` 會 crash 並中斷整個換圖流程。

**根因**：沒有在 `ensureFont(textNode.fontName)` 前判斷是否為 Symbol。

**修法**：在 `handleIconsOnly` 呼叫 `ensureFont(textNode.fontName)` 前，加上：
```js
if (typeof textNode.fontName === 'symbol') {
  // 混合字型：改用 getStyledTextSegments 逐段載入
  try {
    var segs = textNode.getStyledTextSegments(['fontName']);
    for (var si = 0; si < segs.length; si++) {
      if (typeof segs[si].fontName !== 'symbol') await ensureFont(segs[si].fontName);
    }
  } catch (_) {}
} else {
  await ensureFont(textNode.fontName);
}
```

**修改檔案**：`figma-plugin/code.js`（`handleIconsOnly` 函式，約第 392 行）

---

## Bug ④ — 表格偵測用硬編碼欄位索引（`code.js`）

**影響**：`detectTableInfo` 和 `findPrimaryRuleText` 寫死 `COL_CONTENT = 4`、`COL_IMAGE = 3`。欄位順序不同的試算表會偵測錯欄位或 crash。

**根因**：這兩個函式沒有使用 `findColumns()` 回傳的動態 `colIndex`。

**修法**：
1. 在 `findColumns()` 裡增加偵測「内容/content」和「示意图/image/圖示」欄位，回傳 `colIndex.contentSch` 和 `colIndex.imageSch`（找不到時為 -1）。
2. 把 `colIndex` 傳入 `detectTableInfo(pageRows, lang, colIndex)` 和 `findPrimaryRuleText(pageRows, ruleIdx, colIndex)`。
3. 函式內改用 `colIndex.contentSch`（同時保留 `!== -1` 的 guard），找不到時 fallback 回傳 `null`（而不是繼續用錯誤索引執行）。

**修改檔案**：`figma-plugin/code.js`（`findColumns`、`detectTableInfo`、`findPrimaryRuleText`、呼叫這兩個函式的地方）

---

## Bug ⑤ — 表格生成錯誤被靜默吞掉（`code.js`）

**影響**：表格生成失敗時使用者看到空白頁面，完全不知道哪裡出問題。

**根因**：`catch (_) {}` 吞掉所有 exception。

**修法**：把 catch 改為發送 status 訊息：
```js
} catch (tableErr) {
  figma.ui.postMessage({
    type: 'status',
    text: '⚠️ ' + pageLabel + ' 表格跳過：' + tableErr.message
  });
}
```

**修改檔案**：`figma-plugin/code.js`（`generateManual` 函式，約第 197 行）

---

## 不改的範圍

- 所有現有功能邏輯（生成、表格格式、換圖演算法等）
- ES5 語法規範（新增程式碼繼續用 `var`、`for` 迴圈）
- UI 設計與版面
- 版本號顯示（ui.html 內的 `v3.1` 僅供參考，不在本次範圍）

---

## 驗收條件

- [ ] ① 「套用到選取範圍」成功後，狀態框顯示綠色「✅ 完成！」
- [ ] ① 「修正圓點字型」成功後，狀態框顯示綠色「✅ 完成！」
- [ ] ② 選取含有 Instance 的節點執行換圖，正常節點仍會被處理，最後顯示跳過統計
- [ ] ③ 選取混合字型的文字節點執行換圖，不 crash
- [ ] ④ 欄位順序不同的試算表，表格偵測不會偵測錯行
- [ ] ⑤ 表格格式錯誤時，狀態欄顯示 ⚠️ 警告而非靜默略過
