// =============================================
// 遊戲說明書產生器 - Figma Plugin
// v4.0 — 自動表格頁面：P1 圖示化 / P2 賠率卡片自動合組 / P3 特殊符號資訊卡
// v4.1 — 表格架構還原：透明格子 + 明確 VSep/HSep + 跨欄邏輯（修復儲存格顏色與格線）
// v4.2 — 多欄表格對齊修復 + cellText 不 trim（修復 P13/P15 欄位錯位與 DENOMINATION 位置）
//   · buildMultiColTableFromCell：三段式對齊邏輯（A首格空→跨欄 / B多元首格非空→左補空格 / C單元首格非空→留col0）
//   · cellText 移除 .trim()：保留各行前置空格，避免「  DENOMINATION」被截掉變成 col 0
//   · 換圖（handleIconsOnly）：改用 figma.root.findOne 跨頁搜尋 COMPONENT
// v4.3 — 新增⑧後處理工具：圖像一鍵建立 Component（handleCreateComponentsFromImages）
//   · 選取 FRAME，一鍵將含副檔名的直接子節點就地轉換為 COMPONENT，名稱去副檔名
// =============================================

figma.showUI(__html__, { width: 520, height: 700, title: "遊戲說明書產生器 v4" });

// 載入 Figma 現有字型清單並送給 UI
figma.listAvailableFontsAsync().then(function(fonts) {
  var seen = {};
  var families = [];
  for (var i = 0; i < fonts.length; i++) {
    var f = fonts[i].fontName.family;
    if (!seen[f]) { seen[f] = true; families.push(f); }
  }
  families.sort();
  figma.ui.postMessage({ type: 'fonts-loaded', families: families });
});

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "generate":
      await generateManual(msg);
      break;
    case "cancel":
      figma.closePlugin();
      break;
    case "saveSettings":
      await figma.clientStorage.setAsync("settings_v3", msg.data);
      break;
    case "getSettings": {
      const data = await figma.clientStorage.getAsync("settings_v3") || {};
      figma.ui.postMessage({ type: "settings", data });
      break;
    }
    case "icons-only":
      await handleIconsOnly();
      break;
    case "replace-char-font":
      await handleReplaceCharFont(msg);
      break;
    case "fix-bullet-font":
      await handleFixBulletFont();
      break;
    case "create-components":
      await handleCreateComponentsFromImages();
      break;
    case "change-text-style":
      await handleChangeTextStyle(msg);
      break;
  }
};

async function generateManual({ rows, language, frameGap, rowGap }) {
  try {
    if (!rows || !Array.isArray(rows) || rows.length < 2) {
      throw new Error("資料不足，試算表至少需要標題列和一列資料。");
    }

    const headers = rows[0].map(h => (h || "").trim());
    figma.ui.postMessage({ type: "status", text: `✅ 找到欄位：${headers.filter(Boolean).join(", ")}` });

    const colIndex = findColumns(headers);
    if (!colIndex) {
      figma.ui.postMessage({
        type: "error",
        text: `❌ 找不到必要欄位。\n\n目前欄位：${headers.filter(Boolean).join(", ")}\n\n需要欄位：標題Sch、規則Sch、標題EN、規則EN`
      });
      return;
    }

    const dataRows = rows.slice(1).filter(row => {
      const first = (row[0] || "").trim().toUpperCase();
      return first.startsWith("PAGE") && row.length > 1;
    });

    if (dataRows.length === 0) {
      figma.ui.postMessage({ type: "error", text: "❌ 找不到 PAGE 資料列，請確認第一欄有 PAGE 1, PAGE 2... 等內容。" });
      return;
    }

    // 按 PAGE 分組，讓每頁的多列資料（表格）合併為一個 Frame
    const pageGroups = groupPageRows(dataRows);

    figma.ui.postMessage({ type: "status", text: `📄 找到 ${pageGroups.size} 頁，載入字體中...` });

    const fontZH = await loadFontSafe([
      { family: "Noto Sans SC", style: "Regular" },
      { family: "Noto Sans TC", style: "Regular" },
      { family: "PingFang TC", style: "Regular" },
      { family: "Inter", style: "Regular" }
    ]);
    const fontEN = await loadFontSafe([
      { family: "Noto Sans SC", style: "Regular" },
      { family: "Noto Sans", style: "Regular" },
      { family: "Inter", style: "Regular" }
    ]);

    const FRAME_W = 1920, FRAME_H = 1080;
    const FRAMES_PER_ROW = 5;
    const H_GAP = frameGap || 40;
    const V_GAP = rowGap || 40;
    const PADDING = 60;

    const languages = [];
    if (language === "sch" || language === "both") languages.push("sch");
    if (language === "en"  || language === "both") languages.push("en");

    let totalGenerated = 0;
    let startY = 0;

    for (const lang of languages) {
      const langLabel = lang === "sch" ? "中文版" : "英文版";
      figma.ui.postMessage({ type: "status", text: `🎨 生成 ${langLabel}（${dataRows.length} 頁）...` });

      const outerFrame = figma.createFrame();
      outerFrame.name = `遊戲說明書_${langLabel}`;
      outerFrame.layoutMode = "HORIZONTAL";
      outerFrame.layoutWrap = "WRAP";
      outerFrame.primaryAxisSizingMode = "FIXED";
      outerFrame.counterAxisSizingMode = "AUTO";
      outerFrame.resize(FRAMES_PER_ROW * FRAME_W + (FRAMES_PER_ROW - 1) * H_GAP, 100);
      outerFrame.itemSpacing = H_GAP;
      outerFrame.counterAxisSpacing = V_GAP;
      outerFrame.paddingLeft = outerFrame.paddingRight = 0;
      outerFrame.paddingTop = outerFrame.paddingBottom = 0;
      outerFrame.fills = [];
      outerFrame.clipsContent = false;

      for (const [pageLabel, pageRows] of pageGroups) {
        const titleIdx = lang === "sch" ? colIndex.titleSch : colIndex.titleEN;
        const ruleIdx  = lang === "sch" ? colIndex.ruleSch  : colIndex.ruleEN;
        const firstRow = pageRows[0];
        const titleText = (firstRow[titleIdx] || "").trim();
        const ruleText  = findPrimaryRuleText(pageRows, ruleIdx);

        // pageFrame：純色背景，無 Auto Layout，讓使用者可自由覆蓋元素
        const pageFrame = figma.createFrame();
        pageFrame.name = `${pageLabel}_${langLabel}`;
        pageFrame.resize(FRAME_W, FRAME_H);
        pageFrame.fills = [{ type: "SOLID", color: { r: 0.05, g: 0.05, b: 0.12 } }];
        pageFrame.cornerRadius = 8;
        pageFrame.clipsContent = true;

        // contentFrame：維持原本 Auto Layout 縮排與佈局，供 handleIconsOnly 正常定位
        const contentFrame = figma.createFrame();
        contentFrame.name = 'content';
        contentFrame.fills = [];
        contentFrame.clipsContent = false;
        contentFrame.layoutMode = "VERTICAL";
        contentFrame.primaryAxisSizingMode = "FIXED";
        contentFrame.counterAxisSizingMode = "FIXED";
        contentFrame.resize(FRAME_W - PADDING * 2, FRAME_H - PADDING * 2);
        contentFrame.x = PADDING;
        contentFrame.y = PADDING;
        contentFrame.itemSpacing = 32;

        const titleNode = figma.createText();
        titleNode.name = "標題";
        titleNode.fontName = lang === "sch" ? fontZH : fontEN;
        titleNode.fontSize = 45;
        titleNode.textAlignHorizontal = "CENTER";
        titleNode.characters = titleText || `(${pageLabel} 標題)`;
        titleNode.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.75, b: 0.15 } }];
        titleNode.layoutAlign = "STRETCH";
        titleNode.layoutGrow = 0;
        titleNode.textAutoResize = "HEIGHT";

        let ruleChars, bulletRanges;
        if (ruleText) {
          ({ text: ruleChars, bulletRanges } = processBulletText(ruleText));
        } else {
          ruleChars = `(${pageLabel} 規則)`;
          bulletRanges = [];
        }

        const ruleNode = figma.createText();
        ruleNode.name = "規則";
        ruleNode.fontName = lang === "sch" ? fontZH : fontEN;
        ruleNode.fontSize = lang === "sch" ? 28 : 26;
        ruleNode.characters = ruleChars;
        ruleNode.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        ruleNode.layoutAlign = "STRETCH";
        ruleNode.layoutGrow = 1;
        ruleNode.textAutoResize = "NONE";
        for (const { start, end } of bulletRanges) {
          ruleNode.setRangeListOptions(start, end, { type: 'UNORDERED' });
        }

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
            contentFrame.appendChild(cardsFrame);
          }
        } else {
          // 正常流程：大標題 + 規則文字 + 可選表格
          contentFrame.appendChild(titleNode);
          contentFrame.appendChild(ruleNode);

          try {
            const tblIdx = lang === "sch" ? colIndex.tableSch : colIndex.tableEN;
            // ⚠️ 不對 cellText 做 .trim()：前置空格（如「  DENOMINATION」）是對齊指示，
            // 被 trim 掉後會喪失「空的第一欄」訊息，導致跨欄定位失敗。
            // 空行／空白行由 buildTableFromCell 內部的 rows.filter 自行過濾。
            const cellText = (tblIdx >= 0) ? (firstRow[tblIdx] || "") : "";
            var tableF = null;
            // 新型表格（paytable_v2 / bet_symbols）優先用 buildTableFrame，
            // 避免被 buildTableFromCell 搶先處理導致格式錯誤
            var isNewType = pageTableInfo && (
              pageTableInfo.type === 'paytable_v2' ||
              pageTableInfo.type === 'bet_symbols'
            );
            if (isNewType) {
              tableF = buildTableFrame(pageTableInfo, lang, fontZH, fontEN, FRAME_W - PADDING * 2);
            } else if (cellText) {
              tableF = buildTableFromCell(cellText, lang, fontZH, fontEN, FRAME_W - PADDING * 2);
            } else if (pageTableInfo) {
              tableF = buildTableFrame(pageTableInfo, lang, fontZH, fontEN, FRAME_W - PADDING * 2);
            }
            if (tableF) {
              ruleNode.layoutGrow = 0;
              ruleNode.textAutoResize = "HEIGHT";
              tableF.layoutAlign = "STRETCH";
              contentFrame.appendChild(tableF);
            }
          } catch (_) {}
        }

        pageFrame.appendChild(contentFrame);
        outerFrame.appendChild(pageFrame);
        totalGenerated++;
      }

      outerFrame.x = 0;
      outerFrame.y = startY;
      figma.currentPage.appendChild(outerFrame);
      startY += outerFrame.height + 300;
    }

    figma.viewport.scrollAndZoomIntoView(figma.currentPage.children);
    figma.ui.postMessage({
      type: "done",
      text: `🎉 完成！共生成 ${totalGenerated} 個 Frame\n（${languages.map(l => l === "sch" ? "中文版" : "英文版").join(" + ")}，每排 5 個）`
    });

  } catch (err) {
    figma.ui.postMessage({ type: "error", text: `❌ 發生錯誤：${err.message}` });
  }
}

// =============================================
// 工具函式
// =============================================

async function loadFontSafe(candidates) {
  for (const font of candidates) {
    try { await figma.loadFontAsync(font); return font; } catch (e) {}
  }
  return { family: "Inter", style: "Regular" };
}

function findColumns(headers) {
  const n = s => (s || "").replace(/\s/g, "").toLowerCase();
  const find = keys => headers.findIndex(h => keys.some(k => n(h).includes(n(k))));
  const idx = {
    titleSch: find(["標題sch", "标题sch"]),
    ruleSch:  find(["規則sch", "规则sch"]),
    titleEN:  find(["標題en", "标题en", "titleen"]),
    ruleEN:   find(["規則en", "规则en", "ruleen"]),
    tableSch: find(["表格sch", "tablesch", "table sch"]),
    tableEN:  find(["表格en",  "tableen",  "table en"]),
  };
  if (idx.titleSch === -1) idx.titleSch = idx.titleEN;
  if (idx.ruleSch  === -1) idx.ruleSch  = idx.ruleEN;
  if (idx.titleEN  === -1) idx.titleEN  = idx.titleSch;
  if (idx.ruleEN   === -1) idx.ruleEN   = idx.ruleSch;
  if (idx.titleSch === -1 && idx.titleEN === -1) return null;
  return idx;
}

function chunkArray(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

function processBulletText(text) {
  const lines = text.split('\n');
  const processedLines = [];
  const bulletRanges = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBullet = /^[·•]\s?/.test(line.trimStart());
    const clean = isBullet ? line.trimStart().replace(/^[·•]\s?/, '') : line;
    if (isBullet) bulletRanges.push({ start: pos, end: pos + clean.length });
    processedLines.push(clean);
    pos += clean.length + (i < lines.length - 1 ? 1 : 0);
  }
  return { text: processedLines.join('\n'), bulletRanges };
}

// =============================================
// 後處理工具：僅換圖
// =============================================

function isInComponent(node) {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'INSTANCE' ||
      current.type === 'COMPONENT' ||
      current.type === 'COMPONENT_SET'
    ) return true;
    current = current.parent;
  }
  return false;
}

async function handleIconsOnly() {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'icon-error', text: '⚠️ 請先選取至少一個節點' });
    return;
  }

  const textNodes = [];
  for (const node of selection) {
    if (node.type === 'TEXT') textNodes.push(node);
    if ('findAll' in node) textNodes.push(...node.findAll(n => n.type === 'TEXT' && !isInComponent(n)));
  }
  if (textNodes.length === 0) {
    figma.ui.postMessage({ type: 'icon-error', text: '⚠️ 選取範圍內找不到文字節點' });
    return;
  }

  const fontCache = new Set();
  async function ensureFont(fontName) {
    const key = fontName.family + '-' + fontName.style;
    if (!fontCache.has(key)) { await figma.loadFontAsync(fontName); fontCache.add(key); }
  }

  // 建立帶樣式的文字節點 helper
  async function makeTextNode(src, chars, yellowFill) {
    const t = figma.createText();
    await ensureFont(src.fontName);
    t.fontName      = src.fontName;
    t.fontSize      = src.fontSize;
    t.lineHeight    = src.lineHeight;
    t.letterSpacing = src.letterSpacing;
    t.fills  = yellowFill
      ? [{ type: 'SOLID', color: { r: 1, g: 0.85, b: 0 } }]
      : JSON.parse(JSON.stringify(src.fills));
    t.strokes      = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    t.strokeWeight = 2;
    t.strokeAlign  = 'OUTSIDE';
    t.textAlignHorizontal = src.textAlignHorizontal;
    t.characters   = chars;
    return t;
  }

  let iconCount = 0;
  for (const textNode of textNodes) {
    let anc = textNode.parent;
    while (anc && anc.type !== 'INSTANCE') anc = anc.parent;
    if (anc) {
      figma.ui.postMessage({ type: 'icon-error', text: '⚠️ 偵測到文字在元件實例內，請先 Detach Instance' });
      return;
    }

    await ensureFont(textNode.fontName);
    const container   = textNode.parent;
    const originalIdx = container.children.indexOf(textNode);
    const nodeWidth   = textNode.width;
    const textX       = textNode.x;
    const textY       = textNode.y;

    const hAlignMap = { LEFT: 'MIN', CENTER: 'CENTER', RIGHT: 'MAX' };
    const hAlign = hAlignMap[textNode.textAlignHorizontal] || 'MIN';

    // wrapper：VERTICAL，堆疊每行的 chunk
    const wrapper = figma.createFrame();
    wrapper.name   = textNode.name + '_content';
    wrapper.fills  = [];
    wrapper.layoutMode = 'VERTICAL';
    wrapper.primaryAxisSizingMode = wrapper.counterAxisSizingMode = 'AUTO';
    wrapper.primaryAxisAlignItems = 'MIN';
    wrapper.counterAxisAlignItems = hAlign;
    wrapper.itemSpacing = 8;
    if ('layoutAlign' in textNode) wrapper.layoutAlign = textNode.layoutAlign;
    if ('layoutGrow'  in textNode) wrapper.layoutGrow  = textNode.layoutGrow;

    const lines = textNode.characters.split('\n');

    // 偵測哪些行是 bullet list item
    const bulletLineSet = new Set();
    try {
      const segs = textNode.getStyledTextSegments(['listOptions']);
      let p = 0;
      lines.forEach((line, li) => {
        if (segs.some(s => s.listOptions && s.listOptions.type === 'UNORDERED' && s.start < p + line.length && s.end > p)) {
          bulletLineSet.add(li);
        }
        p += line.length + 1;
      });
    } catch (_) {}

    const ITEM_GAP = 10;   // token 之間的間距
    // 載入 bullet 專用字型（Noto Sans TC），確保 · 符號正確顯示
    const bulletFont = await loadFontSafe([
      { family: 'Noto Sans TC', style: 'Regular' },
      { family: 'Noto Sans SC', style: 'Regular' },
      { family: 'Noto Sans',    style: 'Regular' },
      { family: 'Inter',        style: 'Regular' }
    ]);
    // 量一次 bullet 符號寬度，作為所有行 row2+ 的通用縮排單位
    const _btRef = figma.createText();
    _btRef.fontName = bulletFont;
    _btRef.fontSize = textNode.fontSize;
    _btRef.lineHeight = textNode.lineHeight;
    _btRef.letterSpacing = textNode.letterSpacing;
    _btRef.characters = '· ';
    const bulletWidth = _btRef.width;
    _btRef.remove();

    for (let i = 0; i < lines.length; i++) {
      const isBullet = bulletLineSet.has(i);

      // ── Step 1：建立這行所有 token 節點並記錄寬度 ──────────────
      const items = [];

      if (isBullet) {
        // 用 Noto Sans TC 建立 bullet，字號與原文字相同
        const bt = figma.createText();
        bt.fontName = bulletFont;
        bt.fontSize = textNode.fontSize;
        bt.lineHeight = textNode.lineHeight;
        bt.letterSpacing = textNode.letterSpacing;
        bt.fills = JSON.parse(JSON.stringify(textNode.fills));
        bt.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
        bt.strokeWeight = 2;
        bt.strokeAlign = 'OUTSIDE';
        bt.textAlignHorizontal = textNode.textAlignHorizontal;
        bt.characters = '· ';
        items.push({ node: bt, width: bt.width });
      }

      const lineContent = lines[i];
      const parts = lineContent.match(/(\[[^\]]+\]|\{[^\}]+\}|[^\[\]\{\}]+)/g) || [lineContent];

      for (const part of parts) {
        const tagMatch = /^\[([^\]]+)\]$/.exec(part);
        if (tagMatch) {
          // 先搜全檔案（跨頁），找不到再回到當前頁保底（相容舊行為）
          const comp = figma.root.findOne(function(n) { return n.type === 'COMPONENT' && n.name === tagMatch[1]; })
                    || figma.currentPage.findOne(function(n) { return n.type === 'COMPONENT' && n.name === tagMatch[1]; });
          if (comp) {
            const inst = comp.createInstance();
            inst.name = 'icon_' + tagMatch[1];
            items.push({ node: inst, width: inst.width });
            iconCount++;
          } else {
            // 找不到 component：保留原始標籤文字，讓使用者知道哪個 component 缺失
            const t = await makeTextNode(textNode, '[' + tagMatch[1] + ']', false);
            items.push({ node: t, width: t.width });
            figma.ui.postMessage({ type: 'icon-error', text: '⚠️ 找不到 Component：[' + tagMatch[1] + ']（請確認 component 存在於同一個 Figma 檔案中，且名稱完全相符）' });
          }
          continue;
        }
        if (part.startsWith('{') && part.endsWith('}')) {
          const t = await makeTextNode(textNode, part.slice(1, -1), true);
          items.push({ node: t, width: t.width });
          continue;
        }
        for (const token of tokenizeText(part)) {
          if (!token.trim()) continue;
          const t = await makeTextNode(textNode, token, false);
          items.push({ node: t, width: t.width });
        }
      }

      if (items.length === 0) continue;

      // ── Step 2：貪婪排列，決定每個 row 放哪些 token ────────────
      const rows = [];
      let curRow = [], curW = 0, rowIdx = 0;

      for (const item of items) {
        const maxW = rowIdx > 0
          ? nodeWidth - bulletWidth - ITEM_GAP
          : nodeWidth;
        const gap = curRow.length > 0 ? ITEM_GAP : 0;
        if (curW + gap + item.width > maxW && curRow.length > 0) {
          rows.push(curRow);
          rowIdx++;
          curRow = [item];
          curW = item.width;
        } else {
          curRow.push(item);
          curW += gap + item.width;
        }
      }
      if (curRow.length > 0) rows.push(curRow);

      // ── Step 3：建立每個 row 的 frame，第 2 行以後加透明縮排 ───
      const lineChunk = figma.createFrame();
      lineChunk.name = 'line' + (i + 1);
      lineChunk.fills = [];
      lineChunk.layoutMode = 'VERTICAL';
      lineChunk.primaryAxisSizingMode = 'AUTO';
      lineChunk.counterAxisSizingMode = 'AUTO';
      lineChunk.primaryAxisAlignItems = 'MIN';
      lineChunk.counterAxisAlignItems = hAlign;
      lineChunk.itemSpacing = 4;

      for (let r = 0; r < rows.length; r++) {
        const rowFrame = figma.createFrame();
        rowFrame.name = 'row' + (r + 1);
        rowFrame.fills = [];
        rowFrame.layoutMode = 'HORIZONTAL';
        rowFrame.layoutWrap = 'NO_WRAP';
        rowFrame.primaryAxisSizingMode = 'AUTO';
        rowFrame.counterAxisSizingMode = 'AUTO';
        rowFrame.primaryAxisAlignItems = hAlign;
        rowFrame.counterAxisAlignItems = 'CENTER';
        rowFrame.itemSpacing = ITEM_GAP;

        // 第 2 行以後（所有行）：透明縮排 spacer，寬度對齊 bullet 符號單位
        if (r > 0) {
          const indent = figma.createFrame();
          indent.name = 'indent';
          indent.fills = [];
          indent.resize(bulletWidth || 24, 1);
          indent.primaryAxisSizingMode = 'FIXED';
          indent.counterAxisSizingMode = 'FIXED';
          rowFrame.appendChild(indent);
        }

        for (const item of rows[r]) {
          rowFrame.appendChild(item.node);
        }

        lineChunk.appendChild(rowFrame);
      }

      wrapper.appendChild(lineChunk);
    }

    container.insertChild(originalIdx, wrapper);
    // 若容器非 Auto Layout（pageFrame 已 strip），wrapper 沒有自動位置，
    // 需手動補回原 textNode 的座標與寬度，避免跑到 (0,0)
    if (container.layoutMode === 'NONE') {
      wrapper.counterAxisSizingMode = 'FIXED';
      wrapper.resize(nodeWidth, wrapper.height);
      wrapper.x = textX;
      wrapper.y = textY;
    }
    textNode.remove();
  }
  figma.ui.postMessage({ type: 'icon-done', text: `🎯 完成！共插入 ${iconCount} 個圖示` });
}

// =============================================
// 表格輔助：PAGE 分組
// =============================================

function groupPageRows(dataRows) {
  const groups = new Map();
  for (const row of dataRows) {
    const key = (row[0] || "").trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

// 從同一 PAGE 的多行中，找出主要規則文字行（排除表格資料行）
function findPrimaryRuleText(pageRows, ruleIdx) {
  const COL_CONTENT = 4;
  const COL_IMAGE   = 3;
  // 優先：内容Sch = "规则" 的行
  const ruleRow = pageRows.find(r => {
    const c = (r[COL_CONTENT] || "").trim();
    return c === '规则' || c === '規則';
  });
  if (ruleRow) return (ruleRow[ruleIdx] || "").trim();
  // 次選：内容Sch 為空 且 示意图Sch 不是 <bet> 格式
  const mainRow = pageRows.find(r => {
    const c   = (r[COL_CONTENT] || "").trim();
    const img = (r[COL_IMAGE]   || "").trim();
    return c === '' && !/^<\d+>$/.test(img);
  });
  return ((mainRow || pageRows[0])[ruleIdx] || "").trim();
}

// =============================================
// 表格偵測
// =============================================

function detectTableInfo(pageRows, lang) {
  var COL_CONTENT  = 4;
  var COL_IMAGE    = 3;
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

// =============================================
// 表格 Frame 建立（統一入口）
// =============================================

function buildTableFrame(tableInfo, lang, fontZH, fontEN, contentWidth) {
  var font = lang === "sch" ? fontZH : fontEN;
  if (tableInfo.type === 'paytable_v2')     return buildPaytableV2Frame(tableInfo.rows, tableInfo.ruleIdx, font, contentWidth);
  if (tableInfo.type === 'paytable')         return buildPaytableFrame(tableInfo.rows, tableInfo.ruleIdx, font, contentWidth);
  if (tableInfo.type === 'bet_symbols')      return buildBetSymbolsFrameV2(tableInfo.rows, tableInfo.allRows, tableInfo.ruleIdx, lang, font, contentWidth);
  if (tableInfo.type === 'special_symbols')  return buildSpecialSymbolsFrame(tableInfo.rows, tableInfo.ruleIdx, lang, font, contentWidth);
  if (tableInfo.type === 'data_table')       return buildDataTableFrame(tableInfo.rows, tableInfo.ruleIdx, font, contentWidth);
  return null;
}

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

// ─── 共用儲存格建立 ───────────────────────────────────────────

var TBL_ORANGE = { r: 0.90, g: 0.58, b: 0.08 };
var TBL_CELL_FILL = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.45 }];

// 列容器：純透明，格線由真實 separator frame 提供
function makeTblRow() {
  var row = figma.createFrame();
  row.layoutMode = 'HORIZONTAL';
  row.primaryAxisSizingMode = 'AUTO';
  row.counterAxisSizingMode = 'AUTO';
  row.primaryAxisAlignItems = 'MIN';
  row.counterAxisAlignItems = 'MIN';
  row.itemSpacing = 0;
  row.paddingTop = row.paddingBottom = 0;
  row.fills = [];
  row.strokes = [];
  row.clipsContent = false;
  return row;
}

// 格子：45% 透明黑色 fill，padding 在格子上
function makeTblCell(width, text, font, fontSize, isHeader, align) {
  var cell = figma.createFrame();
  cell.name = 'TBL_CELL';
  cell.layoutMode = 'VERTICAL';
  cell.resize(width, 1);
  cell.primaryAxisSizingMode = 'AUTO';
  cell.counterAxisSizingMode = 'FIXED';
  cell.layoutAlign = 'STRETCH';
  cell.primaryAxisAlignItems = 'CENTER';
  cell.counterAxisAlignItems = 'CENTER';
  cell.paddingLeft = cell.paddingRight = 12;
  cell.paddingTop = cell.paddingBottom = 10;
  cell.fills = TBL_CELL_FILL;
  cell.strokes = [];
  cell.clipsContent = false;
  var t = figma.createText();
  t.fontName = font;
  t.fontSize = fontSize;
  t.characters = (text && text.trim()) ? text : " ";
  t.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  t.textAlignHorizontal = 'CENTER';
  t.textAutoResize = 'HEIGHT';
  t.layoutAlign = 'STRETCH';
  cell.appendChild(t);
  return cell;
}

// 最後一欄（grow 格子）
function makeTblCellGrow(text, font, fontSize, isHeader) {
  var cell = figma.createFrame();
  cell.name = 'TBL_CELL';
  cell.layoutMode = 'VERTICAL';
  cell.primaryAxisSizingMode = 'AUTO';
  cell.counterAxisSizingMode = 'AUTO';
  cell.layoutGrow = 1;
  cell.layoutAlign = 'STRETCH';
  cell.primaryAxisAlignItems = 'CENTER';
  cell.counterAxisAlignItems = 'CENTER';
  cell.paddingLeft = cell.paddingRight = 12;
  cell.paddingTop = cell.paddingBottom = 10;
  cell.fills = TBL_CELL_FILL;
  cell.strokes = [];
  cell.clipsContent = false;
  var t = figma.createText();
  t.fontName = font;
  t.fontSize = fontSize;
  t.characters = (text && text.trim()) ? text : " ";
  t.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  t.textAlignHorizontal = 'CENTER';
  t.textAutoResize = 'HEIGHT';
  t.layoutAlign = 'STRETCH';
  cell.appendChild(t);
  return cell;
}

// 垂直格線（1px 寬，撐滿列高）
function makeVSep() {
  var sep = figma.createFrame();
  sep.resize(1, 1);
  sep.layoutAlign = 'STRETCH';
  sep.fills = [{ type: 'SOLID', color: TBL_ORANGE }];
  return sep;
}

// 水平格線（撐滿容器寬，1px 高）
function makeHSep() {
  var sep = figma.createFrame();
  sep.resize(1, 1);
  sep.layoutAlign = 'STRETCH';
  sep.fills = [{ type: 'SOLID', color: TBL_ORANGE }];
  return sep;
}

// 表格容器共用設定：透明 fill + 橘色 OUTSIDE stroke
function makeTblContainer(width) {
  var tf = figma.createFrame();
  tf.layoutMode = 'VERTICAL';
  tf.resize(width, 1);
  tf.primaryAxisSizingMode = 'AUTO';
  tf.counterAxisSizingMode = 'FIXED';
  tf.itemSpacing = 0;
  tf.fills = [];
  tf.strokes = [{ type: 'SOLID', color: TBL_ORANGE }];
  tf.strokeWeight = 2;
  tf.strokeAlign = 'OUTSIDE';
  tf.cornerRadius = 8;
  return tf;
}

// ─── 從 Table 欄位儲存格建立表格（主入口）──────────────────────

function stripBraces(s) {
  return (s || "").replace(/\{([^}]+)\}/g, '$1');
}

function buildTableFromCell(cellText, lang, fontZH, fontEN, contentWidth) {
  const font = lang === "sch" ? fontZH : fontEN;
  // 解析：\n 分隔行
  // 欄位分隔：支援 \t 或 2+ 個空格（相容試算表以空格對齊的視覺格式）
  // 做法：把 \t 統一轉成 2 個空格，再用「2+ 空格」切欄位
  const rawRows = cellText.split('\n').map(function(l) {
    var normalized = l.replace(/\t/g, '  ');
    var cells = normalized.split(/  +/).map(function(c) { return (c || "").trim(); });
    var last = cells.length - 1;
    while (last > 0 && !cells[last]) last--;
    return cells.slice(0, last + 1);
  });
  const rows = rawRows.filter(function(r) { return r.some(function(c) { return c.length > 0; }); });
  if (rows.length === 0) return null;

  // 偵測類型
  const allText = rows.map(function(r) { return r.join(' '); }).join(' ');
  if (/\[[^\]]+\]\s*\{?\d+\}?\s*-\s*\{\d+\}/.test(allText)) {
    return buildPaytableFromCell(rows, font, contentWidth);
  }
  const maxCols = Math.max.apply(null, rows.map(function(r) {
    return r.filter(function(c) { return c.length > 0; }).length;
  }));
  if (maxCols >= 3) return buildMultiColTableFromCell(rows, font, contentWidth);
  return buildTwoColTableFromCell(rows, font, contentWidth);
}

// ─── 賠率表（Tab 欄位版）────────────────────────────────────

function buildPaytableFromCell(rows, font, contentWidth) {
  const payoutsMap = new Map();
  const symbolOrder = [];
  const re = /\[([^\]]+)\]\s*\{?(\d+)\}?\s*-\s*\{(\d+)\}/g;
  for (var ri = 0; ri < rows.length; ri++) {
    for (var ci = 0; ci < rows[ri].length; ci++) {
      var cell = rows[ri][ci];
      if (!cell) continue;
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(cell)) !== null) {
        var sym = m[1];
        if (!payoutsMap.has(sym)) { payoutsMap.set(sym, []); symbolOrder.push(sym); }
        payoutsMap.get(sym).push({ count: m[2], val: m[3] });
      }
    }
  }
  if (symbolOrder.length === 0) return null;

  const GAP = 12;
  const numCards = symbolOrder.length;
  const cardW = Math.max(140, Math.floor((contentWidth - GAP * (numCards + 1)) / numCards));

  const tf = figma.createFrame();
  tf.layoutMode = 'HORIZONTAL';
  tf.layoutWrap = 'WRAP';
  tf.resize(contentWidth, 1);
  tf.primaryAxisSizingMode = 'FIXED';
  tf.counterAxisSizingMode = 'AUTO';
  tf.itemSpacing = GAP;
  tf.counterAxisSpacing = GAP;
  tf.paddingLeft = tf.paddingRight = tf.paddingTop = tf.paddingBottom = GAP;
  tf.fills = [{ type: 'SOLID', color: { r: 0.10, g: 0.08, b: 0.18 } }];
  tf.strokes = [];
  tf.cornerRadius = 8;

  for (var i = 0; i < symbolOrder.length; i++) {
    var sym = symbolOrder[i];
    var payouts = payoutsMap.get(sym);
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
    card.fills = [{ type: 'SOLID', color: { r: 0.18, g: 0.15, b: 0.28 } }];
    card.strokes = [{ type: 'SOLID', color: { r: 0.90, g: 0.58, b: 0.08 } }];
    card.strokeWeight = 1;
    card.strokeAlign = 'INSIDE';
    card.cornerRadius = 6;

    var symLabel = figma.createText();
    symLabel.fontName = font;
    symLabel.fontSize = 20;
    symLabel.characters = '[' + sym + ']';
    symLabel.fills = [{ type: 'SOLID', color: { r: 0.94, g: 0.75, b: 0.15 } }];
    symLabel.textAlignHorizontal = 'CENTER';
    symLabel.layoutAlign = 'STRETCH';
    card.appendChild(symLabel);

    var divider = figma.createFrame();
    divider.resize(cardW - 20, 1);
    divider.primaryAxisSizingMode = 'FIXED';
    divider.counterAxisSizingMode = 'FIXED';
    divider.fills = [{ type: 'SOLID', color: { r: 0.90, g: 0.58, b: 0.08 } }];
    divider.layoutAlign = 'STRETCH';
    card.appendChild(divider);

    var payoutLines = payouts.map(function(p) { return p.count + '  -  ' + p.val; }).join('\n');
    var payText = figma.createText();
    payText.fontName = font;
    payText.fontSize = 17;
    payText.characters = payoutLines;
    payText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    payText.textAlignHorizontal = 'CENTER';
    payText.textAutoResize = 'HEIGHT';
    payText.layoutAlign = 'STRETCH';
    card.appendChild(payText);
    tf.appendChild(card);
  }
  return tf;
}

// ─── 兩欄表格：單一子表格 ────────────────────────────────────

function buildTwoColSingleTable(rows, font, width) {
  var tf = makeTblContainer(width);
  var BET_W = Math.floor(width * 0.38);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var col0 = stripBraces(row[0] || "");
    var col1 = stripBraces(row[1] || "");
    var isHeader = i === 0;
    var dataRow = makeTblRow();
    dataRow.resize(width, 1);
    dataRow.primaryAxisSizingMode = 'FIXED';
    dataRow.counterAxisSizingMode = 'AUTO';
    dataRow.appendChild(makeTblCell(BET_W, col0, font, 18, isHeader, 'CENTER'));
    dataRow.appendChild(makeVSep());
    dataRow.appendChild(makeTblCellGrow(col1, font, 18, isHeader));
    tf.appendChild(dataRow);
    if (i < rows.length - 1) tf.appendChild(makeHSep());
  }
  return tf;
}

// ─── 兩欄表格（行數多時自動左右分欄）────────────────────────

function buildTwoColTableFromCell(rows, font, contentWidth) {
  var MAX_PER_COL = 13; // 超過 13 行時自動分成左右兩個子表格
  if (rows.length > MAX_PER_COL) {
    var mid = Math.ceil(rows.length / 2);
    var colW = Math.floor((contentWidth - 24) / 2);

    var container = figma.createFrame();
    container.layoutMode = 'HORIZONTAL';
    container.primaryAxisSizingMode = 'AUTO';
    container.counterAxisSizingMode = 'AUTO';
    container.primaryAxisAlignItems = 'MIN';
    container.counterAxisAlignItems = 'MIN';
    container.itemSpacing = 24;
    container.fills = [];

    container.appendChild(buildTwoColSingleTable(rows.slice(0, mid), font, colW));
    container.appendChild(buildTwoColSingleTable(rows.slice(mid), font, colW));
    return container;
  }
  return buildTwoColSingleTable(rows, font, contentWidth);
}

// ─── 多欄表格（BET | 欄1 | 欄2 ...）────────────────────────

function buildMultiColTableFromCell(rows, font, contentWidth) {
  var tf = makeTblContainer(contentWidth);

  // 計算欄數（依各列實際長度，trailing empty 已在 buildTableFromCell 截掉）
  var maxCols = Math.max.apply(null, rows.map(function(r) { return r.length; }));
  var BET_W = 160;
  var restW = contentWidth - BET_W;
  var colW = Math.floor(restW / Math.max(1, maxCols - 1));

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var dataRow = makeTblRow();
    dataRow.resize(contentWidth, 1);
    dataRow.primaryAxisSizingMode = 'FIXED';
    dataRow.counterAxisSizingMode = 'AUTO';

    // ── 處理列長度不足 maxCols 的兩種情況 ──
    // A. 首格為空 ["", "TITLE"]     → 跨欄：空 BET 格 + 右側 grow（如 \tDENOMINATION）
    // B. 首格非空 + 多元素 ["A","B"] → 左補空格，右對齊（欄位標題不含 BET 欄，如 P13）
    // ※ 首格非空 + 單一元素 ["VAL"] → 不調整，直接放 col 0（如 [MINI]、[MINOR]）
    var processRow = row.slice();
    var spanFromIdx = -1;

    if (processRow.length < maxCols) {
      if (!processRow[0]) {
        // Case A：首格為空 → 找最後非空欄，從那裡 grow
        var lastNEIdx = -1;
        for (var k = 0; k < processRow.length; k++) {
          if (processRow[k]) lastNEIdx = k;
        }
        if (lastNEIdx > 0) spanFromIdx = lastNEIdx;
      } else if (processRow.length > 1) {
        // Case B：多元素且首格非空 → 左補空格，內容推到右側各欄
        while (processRow.length < maxCols) {
          processRow.unshift('');
        }
      }
      // 單一元素且首格非空：不動，保留在 col 0（BET 欄）
    }

    for (var j = 0; j < maxCols; j++) {
      var cellText = stripBraces(processRow[j] || "");
      var isLast = (j === maxCols - 1);
      var w = (j === 0) ? BET_W : (isLast ? 0 : colW);

      if (spanFromIdx >= 0 && j === spanFromIdx) {
        // 跨欄 grow cell：延展到最右側
        dataRow.appendChild(makeTblCellGrow(cellText, font, 16, false));
        break;
      } else if (w === 0) {
        dataRow.appendChild(makeTblCellGrow(cellText, font, 16, false));
      } else {
        dataRow.appendChild(makeTblCell(w, cellText, font, 16, false, 'CENTER'));
        dataRow.appendChild(makeVSep());
      }
    }
    tf.appendChild(dataRow);
    if (i < rows.length - 1) tf.appendChild(makeHSep());
  }
  return tf;
}

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

    // 賠率文字
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

// ─── 賠率表（TYPE C）────────────────────────────────────────

function buildPaytableFrame(rows, ruleIdx, font, contentWidth) {
  // 解析所有條目，按符號名稱聚合賠率
  const payoutsMap = new Map();
  const symbolOrder = [];
  for (const row of rows) {
    const text = (row[ruleIdx] || "").trim();
    const re = /\[([^\]]+)\]\s*\{?(\d+)\}?\s*-\s*\{(\d+)\}/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      const sym = m[1];
      if (!payoutsMap.has(sym)) { payoutsMap.set(sym, []); symbolOrder.push(sym); }
      payoutsMap.get(sym).push({ count: m[2], val: m[3] });
    }
  }
  if (symbolOrder.length === 0) return null;

  const GAP = 12;
  const numCards = symbolOrder.length;
  const cardW = Math.max(140, Math.floor((contentWidth - GAP * (numCards + 1)) / numCards));

  const tf = figma.createFrame();
  tf.layoutMode = 'HORIZONTAL';
  tf.layoutWrap = 'WRAP';
  tf.resize(contentWidth, 1);
  tf.primaryAxisSizingMode = 'FIXED';
  tf.counterAxisSizingMode = 'AUTO';
  tf.itemSpacing = GAP;
  tf.counterAxisSpacing = GAP;
  tf.paddingLeft = tf.paddingRight = tf.paddingTop = tf.paddingBottom = GAP;
  tf.fills = [{ type: 'SOLID', color: { r: 0.10, g: 0.08, b: 0.18 } }];
  tf.strokes = [];
  tf.cornerRadius = 8;

  for (var i = 0; i < symbolOrder.length; i++) {
    const sym = symbolOrder[i];
    const payouts = payoutsMap.get(sym);
    const card = figma.createFrame();
    card.layoutMode = 'VERTICAL';
    card.resize(cardW, 1);
    card.primaryAxisSizingMode = 'AUTO';   // 高度自動
    card.counterAxisSizingMode = 'FIXED';  // 寬度固定於 cardW
    card.primaryAxisAlignItems = 'CENTER';
    card.counterAxisAlignItems = 'CENTER';
    card.itemSpacing = 8;
    card.paddingTop = card.paddingBottom = 14;
    card.paddingLeft = card.paddingRight = 10;
    card.fills = [{ type: 'SOLID', color: { r: 0.18, g: 0.15, b: 0.28 } }];
    card.strokes = [{ type: 'SOLID', color: { r: 0.90, g: 0.58, b: 0.08 } }];
    card.strokeWeight = 1;
    card.strokeAlign = 'INSIDE';
    card.cornerRadius = 6;

    const symLabel = figma.createText();
    symLabel.fontName = font;
    symLabel.fontSize = 20;
    symLabel.characters = '[' + sym + ']';
    symLabel.fills = [{ type: 'SOLID', color: { r: 0.94, g: 0.75, b: 0.15 } }];
    symLabel.textAlignHorizontal = 'CENTER';
    symLabel.layoutAlign = 'STRETCH';
    card.appendChild(symLabel);

    const divider = figma.createFrame();
    divider.resize(cardW - 20, 1);
    divider.primaryAxisSizingMode = 'FIXED';
    divider.counterAxisSizingMode = 'FIXED';
    divider.fills = [{ type: 'SOLID', color: { r: 0.90, g: 0.58, b: 0.08 } }];
    divider.layoutAlign = 'STRETCH';
    card.appendChild(divider);

    const payoutLines = payouts.map(function(p) { return p.count + '  -  ' + p.val; }).join('\n');
    const payText = figma.createText();
    payText.fontName = font;
    payText.fontSize = 17;
    payText.characters = payoutLines;
    payText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    payText.textAlignHorizontal = 'CENTER';
    payText.textAutoResize = 'HEIGHT';
    payText.layoutAlign = 'STRETCH';
    card.appendChild(payText);

    tf.appendChild(card);
  }
  return tf;
}

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
  var tf = makeTblContainer(contentWidth);

  var BET_W  = 130;
  var hLabel = lang === "sch" ? "投注" : "BET";
  var sLabel = lang === "sch" ? "标志" : "SYMBOLS";

  // 標題列
  var header = makeTblRow();
  header.resize(contentWidth, 1);
  header.primaryAxisSizingMode = 'FIXED';
  header.counterAxisSizingMode = 'AUTO';
  header.appendChild(makeTblCell(BET_W, hLabel, font, 20, false, 'CENTER'));
  header.appendChild(makeVSep());
  header.appendChild(makeTblCellGrow(sLabel, font, 20, false));
  tf.appendChild(header);

  // 資料列
  for (var i = 0; i < betRows.length; i++) {
    var row     = betRows[i];
    var betAmt  = ((row[COL_IMAGE] || "").match(/<(\d+)>/) || [])[1] || "?";
    var removed = (row[ruleIdx] || "").trim().split(/\s+/).filter(Boolean);
    var active  = allSyms.filter(function(s) { return removed.indexOf(s) === -1; });

    tf.appendChild(makeHSep());
    var dataRow = makeTblRow();
    dataRow.resize(contentWidth, 1);
    dataRow.primaryAxisSizingMode = 'FIXED';
    dataRow.counterAxisSizingMode = 'AUTO';

    // BET 格（文字）
    dataRow.appendChild(makeTblCell(BET_W, betAmt, font, 22, false, 'CENTER'));
    dataRow.appendChild(makeVSep());

    // SYMBOLS 格（icon frames + ✕ frames，HORIZONTAL WRAP）
    var symCell = figma.createFrame();
    symCell.name = 'TBL_CELL';
    symCell.layoutMode = 'VERTICAL';
    symCell.primaryAxisSizingMode = 'AUTO';
    symCell.counterAxisSizingMode = 'AUTO';
    symCell.layoutGrow = 1;
    symCell.layoutAlign = 'STRETCH';
    symCell.primaryAxisAlignItems = 'CENTER';
    symCell.counterAxisAlignItems = 'MIN';
    symCell.paddingLeft = symCell.paddingRight = 12;
    symCell.paddingTop = symCell.paddingBottom = 10;
    symCell.fills = TBL_CELL_FILL;
    symCell.clipsContent = false;

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

// ─── 投注符號表（TYPE B）────────────────────────────────────

function buildBetSymbolsFrame(betRows, allRows, ruleIdx, lang, font, contentWidth) {
  var COL_CONTENT = 4;
  var COL_IMAGE   = 3;

  // 第一行（最高投注）包含完整符號清單
  var topRow = betRows.find(function(r) { return (r[COL_CONTENT] || "").trim() !== ""; }) || betRows[0];
  var allSyms = (topRow[COL_CONTENT] || "").trim().split(/\s+/).filter(Boolean);

  var tf = makeTblContainer(contentWidth);

  var BET_W = 130;
  var hLabel = lang === "sch" ? "投注" : "BET";
  var sLabel = lang === "sch" ? "标志" : "SYMBOLS";

  // 標題行
  var header = makeTblRow();
  header.resize(contentWidth, 1);
  header.primaryAxisSizingMode = 'FIXED';
  header.counterAxisSizingMode = 'AUTO';
  header.appendChild(makeTblCell(BET_W, hLabel, font, 20, false, 'CENTER'));
  header.appendChild(makeVSep());
  header.appendChild(makeTblCellGrow(sLabel, font, 20, false));
  tf.appendChild(header);

  // 資料行
  for (var i = 0; i < betRows.length; i++) {
    var row = betRows[i];
    var betAmt = ((row[COL_IMAGE] || "").match(/<(\d+)>/) || [])[1] || "?";
    var removed = (row[ruleIdx] || "").trim().split(/\s+/).filter(Boolean);
    var active  = allSyms.filter(function(s) { return removed.indexOf(s) === -1; });
    var activeTxt  = active.join("   ");
    var removedTxt = removed.length > 0 ? ("  ✕  " + removed.join("  ✕  ")) : "";

    tf.appendChild(makeHSep());
    var dataRow = makeTblRow();
    dataRow.resize(contentWidth, 1);
    dataRow.primaryAxisSizingMode = 'FIXED';
    dataRow.counterAxisSizingMode = 'AUTO';
    dataRow.appendChild(makeTblCell(BET_W, betAmt, font, 20, false, 'CENTER'));
    dataRow.appendChild(makeVSep());
    dataRow.appendChild(makeTblCellGrow(activeTxt + removedTxt, font, 18, false));
    tf.appendChild(dataRow);
  }
  return tf;
}

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

// ─── 資料範圍表（TYPE D/E）──────────────────────────────────

function buildDataTableFrame(rangeRows, ruleIdx, font, contentWidth) {
  var tf = makeTblContainer(contentWidth);
  var BET_W = 180;
  for (var i = 0; i < rangeRows.length; i++) {
    var text = (rangeRows[i][ruleIdx] || "").trim();
    var parts = text.split(/\s*[|｜]\s*/);
    var isHeader = i === 0;
    if (i > 0) tf.appendChild(makeHSep());
    var dataRow = makeTblRow();
    dataRow.resize(contentWidth, 1);
    dataRow.primaryAxisSizingMode = 'FIXED';
    dataRow.counterAxisSizingMode = 'AUTO';
    if (parts.length >= 2) {
      dataRow.appendChild(makeTblCell(BET_W, parts[0].trim(), font, 18, isHeader, 'CENTER'));
      dataRow.appendChild(makeVSep());
      dataRow.appendChild(makeTblCellGrow(parts.slice(1).join(' | ').trim(), font, 18, isHeader));
    } else {
      dataRow.appendChild(makeTblCellGrow(text, font, 18, isHeader));
    }
    tf.appendChild(dataRow);
  }
  return tf;
}

// 判斷是否為 CJK 字元
function isCJK(code) {
  return (code >= 0x4E00 && code <= 0x9FFF)   // CJK 統一表意文字
      || (code >= 0x3400 && code <= 0x4DBF)   // 擴充 A
      || (code >= 0xF900 && code <= 0xFAFF)   // 相容表意文字
      || (code >= 0x3000 && code <= 0x303F)   // CJK 符號與標點（。、「」…）
      || (code >= 0xFF01 && code <= 0xFF60)   // 全形符號（！？：）
      || (code >= 0x30A0 && code <= 0x30FF)   // 片假名
      || (code >= 0x3040 && code <= 0x309F);  // 平假名
}

// 將文字拆成「每個中文字」或「每個英文詞（含尾隨空格）」的 token 陣列
function tokenizeText(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const code = text.codePointAt(i);
    const chLen = code > 0xFFFF ? 2 : 1;
    if (isCJK(code)) {
      tokens.push(text.slice(i, i + chLen));
      i += chLen;
    } else {
      // 收集非 CJK 連續段落，再拆成「詞 + 尾隨空白」
      let start = i;
      while (i < text.length && !isCJK(text.codePointAt(i))) i++;
      const run = text.slice(start, i);
      // 每個詞保留尾隨空格（讓詞與詞之間有自然間距）
      const words = run.match(/\S+\s*|\s+/g);
      if (words) tokens.push(...words);
      else if (run) tokens.push(run);
    }
  }
  return tokens.filter(function(t) { return t.length > 0; });
}

// =============================================
// 後處理工具：字元級字型替換
// =============================================

async function handleReplaceCharFont(opts) {
  var selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 請先選取至少一個節點' });
    return;
  }
  var targetChars = opts.characters || '';
  if (!targetChars) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 請輸入要替換的字元' });
    return;
  }
  var targetFont = { family: opts.fontFamily, style: opts.fontStyle || 'Regular' };
  try {
    await figma.loadFontAsync(targetFont);
  } catch (e) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 字型載入失敗：' + targetFont.family + ' ' + targetFont.style });
    return;
  }

  var textNodes = [];
  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    if (node.type === 'TEXT') textNodes.push(node);
    if ('findAll' in node) { var found = node.findAll(function(n) { return n.type === 'TEXT'; }); textNodes.push.apply(textNodes, found); }
  }
  if (textNodes.length === 0) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 選取範圍內找不到文字節點' });
    return;
  }

  var targetSet = {};
  for (var ci = 0; ci < targetChars.length; ci++) targetSet[targetChars[ci]] = true;

  var succeeded = 0, failed = 0;
  for (var ni = 0; ni < textNodes.length; ni++) {
    try {
      var segs = textNodes[ni].getStyledTextSegments(['fontName']);
      var fontCache = {};
      for (var si = 0; si < segs.length; si++) {
        var fk = segs[si].fontName.family + '-' + segs[si].fontName.style;
        if (!fontCache[fk]) { try { await figma.loadFontAsync(segs[si].fontName); } catch (e) {} fontCache[fk] = true; }
      }
      var text = textNodes[ni].characters;
      for (var ki = 0; ki < text.length; ki++) {
        if (targetSet[text[ki]]) {
          textNodes[ni].setRangeFontName(ki, ki + 1, targetFont);
        }
      }
      succeeded++;
    } catch (e) { failed++; }
  }
  var resultMsg = failed > 0
    ? '⚠️ 已更新 ' + succeeded + ' 個，' + failed + ' 個失敗（字型或節點限制）'
    : '✅ 已更新 ' + succeeded + ' 個文字節點';
  figma.ui.postMessage({ type: 'style-done', text: resultMsg });
}

async function handleFixBulletFont() {
  var selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'bullet-error', text: '⚠️ 請先選取至少一個節點' });
    return;
  }
  var bulletFont = await loadFontSafe([
    { family: 'Noto Sans TC', style: 'Regular' },
    { family: 'Noto Sans SC', style: 'Regular' },
    { family: 'Noto Sans',    style: 'Regular' },
    { family: 'Inter',        style: 'Regular' }
  ]);

  var textNodes = [];
  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    if (node.type === 'TEXT') textNodes.push(node);
    if ('findAll' in node) { var found = node.findAll(function(n) { return n.type === 'TEXT'; }); textNodes.push.apply(textNodes, found); }
  }
  if (textNodes.length === 0) {
    figma.ui.postMessage({ type: 'bullet-error', text: '⚠️ 選取範圍內找不到文字節點' });
    return;
  }

  var BULLET_SET = { '·': true, '•': true };
  var succeeded = 0, failed = 0;
  for (var ni = 0; ni < textNodes.length; ni++) {
    try {
      var segs = textNodes[ni].getStyledTextSegments(['fontName']);
      var fontCache = {};
      for (var si = 0; si < segs.length; si++) {
        var fk = segs[si].fontName.family + '-' + segs[si].fontName.style;
        if (!fontCache[fk]) { try { await figma.loadFontAsync(segs[si].fontName); } catch (e) {} fontCache[fk] = true; }
      }
      var text = textNodes[ni].characters;
      var changed = false;
      for (var ki = 0; ki < text.length; ki++) {
        if (BULLET_SET[text[ki]]) {
          textNodes[ni].setRangeFontName(ki, ki + 1, bulletFont);
          changed = true;
        }
      }
      if (changed) succeeded++;
    } catch (e) { failed++; }
  }
  var resultMsg = failed > 0
    ? '⚠️ 已處理 ' + succeeded + ' 個節點，' + failed + ' 個失敗'
    : '✅ 已修正 ' + succeeded + ' 個文字節點的圓點字型（→ ' + bulletFont.family + '）';
  figma.ui.postMessage({ type: 'bullet-done', text: resultMsg });
}

// =============================================
// 後處理工具：圖像一鍵建立 Component
// =============================================

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
    var child = frame.children[i];
    var hasImageFill = child.fills && Array.isArray(child.fills) &&
      child.fills.some(function(f) { return f.type === 'IMAGE'; });
    if (hasImageFill) targets.push(child);
  }

  if (targets.length === 0) {
    figma.ui.postMessage({ type: 'comp-error', text: '⚠️ Frame 內找不到含圖像填充的節點' });
    return;
  }

  var created = 0, skipped = 0;
  for (var k = targets.length - 1; k >= 0; k--) {
    var node = targets[k];
    try {
      var parent = node.parent;
      var idx = parent.children.indexOf(node);
      var compName = node.name.replace(/\s+\d+$/, '').replace(EXT_RE, '');
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

// =============================================
// 後處理工具：批次文字樣式
// =============================================

async function handleChangeTextStyle(opts) {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 請先選取至少一個節點' });
    return;
  }

  const textNodes = [];
  for (const node of selection) {
    if (node.type === 'TEXT') textNodes.push(node);
    if ('findAll' in node) textNodes.push(...node.findAll(function(n) { return n.type === 'TEXT'; }));
  }
  if (textNodes.length === 0) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 選取範圍內找不到文字節點' });
    return;
  }

  const fontCache = new Set();
  var succeeded = 0, failed = 0;

  for (var i = 0; i < textNodes.length; i++) {
    var node = textNodes[i];
    try {
      if (opts.fontFamily || opts.fontStyle) {
        var currentFont = node.fontName === figma.mixed
          ? node.getStyledTextSegments(['fontName'])[0].fontName
          : node.fontName;
        var isBullet = node.characters && node.characters.charAt(0) === '·';
        var newFont = {
          family: (isBullet || !opts.fontFamily) ? currentFont.family : opts.fontFamily,
          style:  opts.fontStyle || currentFont.style,
        };
        var cacheKey = newFont.family + '-' + newFont.style;
        if (!fontCache.has(cacheKey)) {
          await figma.loadFontAsync(newFont);
          fontCache.add(cacheKey);
        }
        node.fontName = newFont;
      }

      if (opts.fontSize !== null) node.fontSize = opts.fontSize;

      if (opts.lineHeight !== null) {
        node.lineHeight = (opts.lineHeight === 'AUTO')
          ? { unit: 'AUTO' }
          : { unit: opts.lineHeightUnit, value: opts.lineHeight };
      }

      if (opts.letterSpacing !== null) {
        node.letterSpacing = { unit: 'PERCENT', value: opts.letterSpacing };
      }

      succeeded++;
    } catch (e) {
      failed++;
    }
  }

  var resultText = failed > 0
    ? ('⚠️ 已更新 ' + succeeded + ' 個，' + failed + ' 個失敗（字型或樣式可能不存在）')
    : ('✅ 已更新 ' + succeeded + ' 個文字節點');
  figma.ui.postMessage({ type: 'style-done', text: resultText });
}
