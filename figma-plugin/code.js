// =============================================
// 遊戲說明書產生器 v3 - Figma Plugin
// v3.3 — 換圖：字元級 WRAP 排列
// =============================================

figma.showUI(__html__, { width: 520, height: 700, title: "遊戲說明書產生器 v3" });

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
    case "fix-bullet-font":
      await handleFixBulletFont();
      break;
    case "replace-char-font":
      await handleReplaceCharFont(msg);
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

        const pageFrame = figma.createFrame();
        pageFrame.name = `${pageLabel}_${langLabel}`;
        pageFrame.resize(FRAME_W, FRAME_H);
        pageFrame.layoutMode = "VERTICAL";
        pageFrame.primaryAxisSizingMode = "FIXED";
        pageFrame.counterAxisSizingMode = "FIXED";
        pageFrame.itemSpacing = 32;
        pageFrame.paddingLeft = pageFrame.paddingRight = PADDING;
        pageFrame.paddingTop = pageFrame.paddingBottom = PADDING;
        pageFrame.fills = [{ type: "SOLID", color: { r: 0.05, g: 0.05, b: 0.12 } }];
        pageFrame.cornerRadius = 8;

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
        // 設定 bullet 縮排（Figma unordered list 提供自動 hanging indent）
        for (const { start, end } of bulletRanges) {
          ruleNode.setRangeListOptions(start, end, { type: 'UNORDERED' });
        }

        pageFrame.appendChild(titleNode);
        pageFrame.appendChild(ruleNode);

        // 表格生成：優先使用專屬 Table 欄，無則偵測多行格式
        try {
          const tblIdx = lang === "sch" ? colIndex.tableSch : colIndex.tableEN;
          const cellText = (tblIdx >= 0) ? (firstRow[tblIdx] || "").replace(/\s+$/, '') : "";
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

        // 所有 children 加完後再設，避免 Figma 在 append 時自動恢復 true
        pageFrame.clipsContent = false;
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

// =============================================
// 後處理工具：修正圓點字型 → Noto Sans TC
// =============================================

async function handleFixBulletFont() {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'bullet-error', text: '⚠️ 請先選取至少一個節點' });
    return;
  }

  const fontTC = { family: "Noto Sans TC", style: "Regular" };
  try {
    await figma.loadFontAsync(fontTC);
  } catch (e) {
    figma.ui.postMessage({ type: 'bullet-error', text: '⚠️ 無法載入 Noto Sans TC，請確認字型已安裝' });
    return;
  }

  // 涵蓋各種常見圓點/bullet unicode 字元
  const BULLET_RE = /[·•‧・･∙▪◦]/;

  const textNodes = [];
  for (const node of selection) {
    if (node.type === 'TEXT') textNodes.push(node);
    if ('findAll' in node) textNodes.push(...node.findAll(n => n.type === 'TEXT'));
  }

  let fixCount = 0;
  for (const tn of textNodes) {
    const chars = tn.characters;
    // 先載入該節點所有用到的字型
    try {
      const fonts = tn.getStyledTextSegments(['fontName']).map(s => s.fontName);
      for (const f of fonts) { try { await figma.loadFontAsync(f); } catch (_) {} }
    } catch (_) {}

    for (let i = 0; i < chars.length; i++) {
      if (BULLET_RE.test(chars[i])) {
        try {
          tn.setRangeFontName(i, i + 1, fontTC);
          fixCount++;
        } catch (_) {}
      }
    }
  }

  figma.ui.postMessage({ type: 'bullet-done', text: `✅ 完成！共修正 ${fixCount} 個圓點符號 → Noto Sans TC` });
}

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
  let skippedCount = 0;
  for (const textNode of textNodes) {
    let anc = textNode.parent;
    while (anc && anc.type !== 'INSTANCE') anc = anc.parent;
    if (anc) {
      skippedCount++;
      continue;
    }

    await ensureFont(textNode.fontName);
    const container   = textNode.parent;
    const originalIdx = container.children.indexOf(textNode);
    const nodeWidth   = textNode.width;

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

    // 偵測哪些行是 bullet list item（用 listOptions，與 setRangeListOptions 對應）
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

    const indentWidth = 24; // 懸掛縮排的透明間距寬度（px）
    const ITEM_GAP = 10;   // token 之間的間距

    // 預先載入 Noto Sans TC（供換圖時 · 符號使用，有則用，無則用原字型）
    const fontTC = { family: "Noto Sans TC", style: "Regular" };
    let tcLoaded = false;
    try { await figma.loadFontAsync(fontTC); tcLoaded = true; } catch (_) {}

    for (let i = 0; i < lines.length; i++) {
      const isBullet = bulletLineSet.has(i);

      // ── Step 1：建立這行所有 token 節點並記錄寬度 ──────────────
      const items = [];

      if (isBullet) {
        const bt = await makeTextNode(textNode, '· ', false);
        if (tcLoaded) bt.fontName = fontTC;
        items.push({ node: bt, width: bt.width });
      }

      const lineContent = lines[i];
      const parts = lineContent.match(/(\[[^\]]+\]|\{[^\}]+\}|[^\[\]\{\}]+)/g) || [lineContent];

      for (const part of parts) {
        const tagMatch = /^\[([^\]]+)\]$/.exec(part);
        if (tagMatch) {
          const comp = figma.root.findOne(n => n.type === 'COMPONENT' && n.name === tagMatch[1]);
          if (comp) {
            const inst = comp.createInstance();
            inst.name = 'icon_' + tagMatch[1];
            items.push({ node: inst, width: inst.width });
            iconCount++;
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
        const maxW = (isBullet && rowIdx > 0)
          ? nodeWidth - indentWidth - ITEM_GAP
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

        // 第 2 行以後（bullet 行）：透明縮排 spacer
        if (r > 0 && isBullet) {
          const indent = figma.createFrame();
          indent.name = 'indent';
          indent.fills = [];
          indent.layoutAlign = 'STRETCH';
          indent.resize(indentWidth, 1);
          indent.primaryAxisSizingMode = 'FIXED';
          indent.counterAxisSizingMode = 'AUTO';
          rowFrame.appendChild(indent);
        }

        for (const item of rows[r]) {
          rowFrame.appendChild(item.node);
        }

        lineChunk.appendChild(rowFrame);
      }

      wrapper.appendChild(lineChunk);
    }

    // 如果文字在表格格子（TBL_CELL）內，縮放 icon 到適合表格的高度
    if (container.name === 'TBL_CELL') {
      const TARGET_H = 32; // 表格 icon 目標高度（px）
      function scaleIconsInNode(node) {
        if (node.type === 'INSTANCE' && node.height > TARGET_H) {
          node.rescale(TARGET_H / node.height);
        } else if ('children' in node) {
          for (var ci = 0; ci < node.children.length; ci++) {
            scaleIconsInNode(node.children[ci]);
          }
        }
      }
      scaleIconsInNode(wrapper);
    }

    container.insertChild(originalIdx, wrapper);
    textNode.remove();
  }
  let doneText = `🎯 完成！共插入 ${iconCount} 個圖示`;
  if (skippedCount > 0) doneText += `\n⚠️ ${skippedCount} 個節點在元件實例內已跳過（請先 Detach Instance）`;
  figma.ui.postMessage({ type: 'icon-done', text: doneText });
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
  const COL_CONTENT = 4;
  const COL_IMAGE   = 3;
  const ruleIdx = lang === "sch" ? 5 : 8;

  // 賠率表：内容Sch = "赔率表"
  const paytableRows = pageRows.filter(r => (r[COL_CONTENT] || "").trim() === '赔率表');
  if (paytableRows.length > 0) return { type: 'paytable', rows: paytableRows, ruleIdx };

  // 投注符號表：示意图Sch = <數字>
  const betRows = pageRows.filter(r => /^<\d+>$/.test((r[COL_IMAGE] || "").trim()));
  if (betRows.length > 0) return { type: 'bet_symbols', rows: betRows, allRows: pageRows, ruleIdx };

  // 資料表：规则Sch 含有「數字 ~ 數字」格式，且多行
  const rangeRows = pageRows.filter(r => /\d+\s*[~～]\s*\d+/.test(r[ruleIdx] || ""));
  if (rangeRows.length > 1) return { type: 'data_table', rows: rangeRows, ruleIdx };

  return null;
}

// =============================================
// 表格 Frame 建立（統一入口）
// =============================================

function buildTableFrame(tableInfo, lang, fontZH, fontEN, contentWidth) {
  const font = lang === "sch" ? fontZH : fontEN;
  if (tableInfo.type === 'paytable')    return buildPaytableFrame(tableInfo.rows, tableInfo.ruleIdx, font, contentWidth);
  if (tableInfo.type === 'bet_symbols') return buildBetSymbolsFrame(tableInfo.rows, tableInfo.allRows, tableInfo.ruleIdx, lang, font, contentWidth);
  if (tableInfo.type === 'data_table')  return buildDataTableFrame(tableInfo.rows, tableInfo.ruleIdx, font, contentWidth);
  return null;
}

// ─── 共用儲存格建立 ───────────────────────────────────────────

var TBL_ORANGE = { r: 0.90, g: 0.58, b: 0.08 };
var TBL_CELL_FILL = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.45 }];

// 列容器：純透明，格線由真實 separator frame 提供
function makeTblRow() {
  const row = figma.createFrame();
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
  const cell = figma.createFrame();
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
  const t = figma.createText();
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
  const cell = figma.createFrame();
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
  const t = figma.createText();
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

// 表格容器共用設定
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
    // 截尾端空白欄
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
    var isHeader = i === 0;
    var dataRow = makeTblRow();
    dataRow.resize(contentWidth, 1);
    dataRow.primaryAxisSizingMode = 'FIXED';
    dataRow.counterAxisSizingMode = 'AUTO';

    // 找出此列最後一個非空格的欄位索引
    var lastNonEmptyIdx = -1;
    for (var k = 0; k < row.length; k++) {
      if (row[k]) lastNonEmptyIdx = k;
    }
    // 跨欄條件：列的長度 < maxCols，且最後非空欄不在第一格（表示需要延展）
    var spanFromIdx = (row.length < maxCols && lastNonEmptyIdx > 0) ? lastNonEmptyIdx : -1;

    for (var j = 0; j < maxCols; j++) {
      var cellText = stripBraces(row[j] || "");
      var isLast = (j === maxCols - 1);
      var w = (j === 0) ? BET_W : (isLast ? 0 : colW);

      if (spanFromIdx >= 0 && j === spanFromIdx) {
        // 跨欄 grow cell：延展到最右側（多欄表格一律白色文字）
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

// ─── 投注符號表（TYPE B）────────────────────────────────────

function buildBetSymbolsFrame(betRows, allRows, ruleIdx, lang, font, contentWidth) {
  const COL_CONTENT = 4;
  const COL_IMAGE   = 3;

  // 第一行（最高投注）包含完整符號清單
  const topRow = betRows.find(function(r) { return (r[COL_CONTENT] || "").trim() !== ""; }) || betRows[0];
  const allSyms = (topRow[COL_CONTENT] || "").trim().split(/\s+/).filter(Boolean);

  const tf = makeTblContainer(contentWidth);
  const BET_W = 130;
  const hLabel = lang === "sch" ? "投注" : "BET";
  const sLabel = lang === "sch" ? "标志" : "SYMBOLS";

  // 標題行
  const header = makeTblRow();
  header.resize(contentWidth, 1);
  header.primaryAxisSizingMode = 'FIXED';
  header.counterAxisSizingMode = 'AUTO';
  header.appendChild(makeTblCell(BET_W, hLabel, font, 20, false, 'CENTER'));
  header.appendChild(makeVSep());
  header.appendChild(makeTblCellGrow(sLabel, font, 20, false));
  tf.appendChild(header);

  // 資料行
  for (var i = 0; i < betRows.length; i++) {
    const row = betRows[i];
    const betAmt = ((row[COL_IMAGE] || "").match(/<(\d+)>/) || [])[1] || "?";
    const removed = (row[ruleIdx] || "").trim().split(/\s+/).filter(Boolean);
    const active  = allSyms.filter(function(s) { return removed.indexOf(s) === -1; });
    const activeTxt  = active.join("   ");
    const removedTxt = removed.length > 0 ? ("  ✕  " + removed.join("  ✕  ")) : "";

    tf.appendChild(makeHSep());
    const dataRow = makeTblRow();
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

// ─── 資料範圍表（TYPE D/E）──────────────────────────────────

function buildDataTableFrame(rangeRows, ruleIdx, font, contentWidth) {
  const tf = makeTblContainer(contentWidth);
  const BET_W = 180;
  for (var i = 0; i < rangeRows.length; i++) {
    const text = (rangeRows[i][ruleIdx] || "").trim();
    const parts = text.split(/\s*[|｜]\s*/);
    const isHeader = i === 0;
    if (i > 0) tf.appendChild(makeHSep());
    const dataRow = makeTblRow();
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
// 後處理工具：指定字元換字型
// =============================================

// 取得文字節點內所有使用到的字型（逐字元讀取，確保不遺漏）
function getUniqueFontNames(textNode) {
  var seen = new Set();
  var result = [];
  var text = textNode.characters;
  for (var i = 0; i < text.length; i++) {
    var font = textNode.getRangeFontName(i, i + 1);
    if (typeof font !== 'symbol') {
      var key = font.family + '||' + font.style;
      if (!seen.has(key)) { seen.add(key); result.push(font); }
    }
  }
  return result;
}

async function handleReplaceCharFont(msg) {
  var characters = msg.characters || '';
  var fontFamily = msg.fontFamily || '';
  var fontStyle  = msg.fontStyle  || 'Regular';

  if (!characters) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 請輸入要替換的字元' });
    return;
  }
  if (!fontFamily) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 請輸入目標字型' });
    return;
  }

  var selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 請先選取至少一個節點' });
    return;
  }

  var targetFont = { family: fontFamily, style: fontStyle };
  try {
    await figma.loadFontAsync(targetFont);
  } catch (e) {
    figma.ui.postMessage({ type: 'style-error', text: '⚠️ 無法載入字型：' + fontFamily + ' ' + fontStyle });
    return;
  }

  var targetChars = characters.split('');
  var textNodes = [];
  for (var ni = 0; ni < selection.length; ni++) {
    var n = selection[ni];
    if (n.type === 'TEXT') textNodes.push(n);
    if ('findAll' in n) textNodes.push.apply(textNodes, n.findAll(function(c) { return c.type === 'TEXT'; }));
  }

  var totalFixed = 0;
  for (var ti = 0; ti < textNodes.length; ti++) {
    var tn = textNodes[ti];
    var text = tn.characters;
    if (!targetChars.some(function(ch) { return text.includes(ch); })) continue;

    // 載入節點內所有現有字型（參考工具的核心做法）
    var existingFonts = getUniqueFontNames(tn);
    for (var fi = 0; fi < existingFonts.length; fi++) {
      try { await figma.loadFontAsync(existingFonts[fi]); } catch (_) {}
    }

    for (var ci = 0; ci < text.length; ci++) {
      if (targetChars.indexOf(text[ci]) >= 0) {
        try {
          tn.setRangeFontName(ci, ci + 1, targetFont);
          totalFixed++;
        } catch (_) {}
      }
    }
  }

  figma.ui.postMessage({
    type: 'style-done',
    text: totalFixed > 0
      ? ('✅ 完成！共更換 ' + totalFixed + ' 個字元的字型')
      : '⚠️ 未找到目標字元，或字型設定失敗'
  });
}
