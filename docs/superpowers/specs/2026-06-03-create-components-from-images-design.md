# 設計文件：圖像一鍵建立 Component（⑧ 後處理工具）

**日期：** 2026-06-03  
**版本：** v1.0  
**範疇：** 在現有 Figma 插件（遊戲說明書產生器）中新增一個後處理工具

---

## 背景

使用者在 Figma 中匯入遊戲素材圖像後，這些圖像通常以原始檔名命名的節點（如 `coin.png`、`star.png`）散落在一個 FRAME 內。目前需要手動逐一將每張圖轉成 COMPONENT，才能在文件中重複使用。本功能提供一鍵批次轉換。

---

## 功能規格

### 觸發方式

使用者在 Figma 畫布中**選取一個 FRAME**，然後在插件 UI 的 Section ⑧ 點擊「一鍵建立 Component」按鈕。

### 節點篩選規則

掃描**選取 FRAME 的直接子節點**（不深入巢狀），符合以下條件的節點會被轉換：

- 節點名稱符合正規表達式：`/\.(png|jpg|jpeg|gif|webp|svg)$/i`

不符合的節點（例如文字、形狀、已是 COMPONENT 等）一律略過。

### 轉換邏輯（就地包裝）

對每個符合節點，依序執行：

1. 記錄原節點的 `parent`、在 parent 中的索引位置 `idx`、`x`、`y`、`width`、`height`、`name`
2. 以 `figma.createComponent()` 建立新 COMPONENT：
   - 命名為原節點名稱**去掉副檔名**（例如 `coin.png` → `coin`）
   - `resize(width, height)`
   - `x = 節點 x`、`y = 節點 y`
3. `parent.insertChild(idx, component)` — 在原位置插入 COMPONENT
4. `component.appendChild(原節點)` — 把原節點移入 COMPONENT
5. 原節點 `x = 0`、`y = 0` — 對齊 COMPONENT 原點

轉換後 FRAME 結構：原節點消失，COMPONENT 出現在同樣位置，COMPONENT 的唯一子節點是原節點。

### 錯誤處理

| 狀況 | 提示訊息 |
|------|---------|
| 沒有選取任何節點 | ⚠️ 請先選取一個 Frame |
| 選取的不是 FRAME | ⚠️ 請選取一個 Frame（目前選取的是 `{type}`） |
| 直接子節點中找不到符合圖檔名的節點 | ⚠️ Frame 內找不到圖像節點（需含副檔名如 .png、.jpg） |
| 個別節點轉換時拋出例外 | 靜默跳過，計入 `skipped` 計數 |

成功時顯示：`✅ 已建立 N 個 Component，均以原始節點名稱命名`  
部分失敗：`✅ 已建立 N 個 Component（M 個略過）`

---

## UI 變更（ui.html）

新增 Section ⑧，緊接在 Section ⑦「修正圓點字型」之後，樣式與其他後處理 section 一致：

```
⑧ 後處理工具：圖像一鍵建立 Component
[可折疊]
說明：選取含有圖像子層（如 coin.png、star.png）的 Frame，
一鍵將所有圖像層就地轉換為 Component，以節點名稱（去副檔名）命名。
[按鈕：一鍵建立 Component]
[狀態框]
```

postMessage 類型：`create-components`（無附加參數）  
回應類型：`comp-done`（成功）、`comp-error`（錯誤）

---

## code.js 變更

### 1. message handler（switch 新增 case）

```js
case "create-components":
  await handleCreateComponentsFromImages();
  break;
```

### 2. 新增函式 `handleCreateComponentsFromImages()`

位置：`handleFixBulletFont` 函式之後

```js
async function handleCreateComponentsFromImages() {
  var sel = figma.currentPage.selection;
  if (!sel || sel.length === 0) {
    figma.ui.postMessage({ type: 'comp-error', text: '⚠️ 請先選取一個 Frame' });
    return;
  }
  var frame = sel[0];
  if (frame.type !== 'FRAME') {
    figma.ui.postMessage({ type: 'comp-error', text: '⚠️ 請選取一個 Frame（目前選取的是 ' + frame.type + '）' });
    return;
  }

  var EXT_RE = /\.(png|jpg|jpeg|gif|webp|svg)$/i;
  var targets = [];
  for (var i = 0; i < frame.children.length; i++) {
    if (EXT_RE.test(frame.children[i].name)) targets.push(frame.children[i]);
  }

  if (targets.length === 0) {
    figma.ui.postMessage({ type: 'comp-error', text: '⚠️ Frame 內找不到圖像節點（需含副檔名如 .png、.jpg）' });
    return;
  }

  var created = 0, skipped = 0;
  for (var k = targets.length - 1; k >= 0; k--) {
    var node = targets[k];
    try {
      var parent = node.parent;
      var idx = parent.children.indexOf(node);
      var compName = node.name.replace(EXT_RE, '');
      var comp = figma.createComponent();
      comp.name = compName;
      comp.resize(node.width, node.height);
      comp.x = node.x;
      comp.y = node.y;
      parent.insertChild(idx, comp);
      comp.appendChild(node);
      node.x = 0;
      node.y = 0;
      created++;
    } catch (e) {
      skipped++;
    }
  }

  var msg = skipped > 0
    ? '✅ 已建立 ' + created + ' 個 Component（' + skipped + ' 個略過）'
    : '✅ 已建立 ' + created + ' 個 Component，均以原始節點名稱命名';
  figma.ui.postMessage({ type: 'comp-done', text: msg });
}
```

---

## 不在本次範圍內

- 搜尋巢狀節點（只處理直接子節點）
- 依 image fill 偵測（只依名稱）
- 可自訂副檔名清單
- 轉換後自動建立 Instance
