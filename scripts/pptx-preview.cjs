/**
 * pptx-preview.cjs — renders PPTX slides as SVG/HTML using only jszip
 * Usage: node scripts/pptx-preview.cjs [path] [start] [count]
 */
const JsZip = require("jszip");
const fs = require("fs");
const path = require("path");

const SLIDE_W_EMU = 9144000;
const SLIDE_H_EMU = 5143500;
const SVG_W = 760;
const SVG_H = Math.round((SVG_W * SLIDE_H_EMU) / SLIDE_W_EMU);

function emu(v, axis) {
  const n = parseInt(v) || 0;
  return axis === "w" || axis === "x" ? (n / SLIDE_W_EMU) * SVG_W : (n / SLIDE_H_EMU) * SVG_H;
}

function srgbClr(xml) {
  const m = xml.match(/(?:a:srgbClr|srgbClr)[^>]*\s*val="([0-9a-fA-F]{6})"/i);
  return m ? `#${m[1].toUpperCase()}` : null;
}

function getFill(xml) {
  if (/<a:noFill[\s\/>]/.test(xml)) return "none";
  const solidM = xml.match(/<a:solidFill[^>]*>([\s\S]*?)<\/a:solidFill>/i);
  if (solidM) return srgbClr(solidM[1]) || null;
  const gradM = xml.match(/<a:gradFill[^>]*>([\s\S]*?)<\/a:gradFill>/i);
  if (gradM) {
    const stop = gradM[1].match(/<a:gs[^>]*>([\s\S]*?)<\/a:gs>/i);
    if (stop) return srgbClr(stop[1]) || null;
  }
  return null;
}

function getStroke(xml) {
  const lnM = xml.match(/<a:ln[^>]*>([\s\S]*?)<\/a:ln>/i);
  if (!lnM) return null;
  const solidM = lnM[1].match(/<a:solidFill[^>]*>([\s\S]*?)<\/a:solidFill>/i);
  if (solidM) return srgbClr(solidM[1]);
  return null;
}

function getTransp(xml) {
  const m = xml.match(/<a:alpha[^>]*\s*val="(\d+)"/i);
  return m ? Math.min(1, Math.max(0, 1 - parseInt(m[1]) / 100000)).toFixed(2) : "1.00";
}

function getXfrm(xml) {
  const xfrmM = xml.match(/<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/i);
  if (!xfrmM) return null;
  const xf = xfrmM[1];
  const ox = (xf.match(/a:off[^>]*\sx="(-?\d+)"/) || [])[1];
  const oy = (xf.match(/a:off[^>]*\sy="(-?\d+)"/) || [])[1];
  const cx = (xf.match(/a:ext[^>]*\scx="(\d+)"/) || [])[1];
  const cy = (xf.match(/a:ext[^>]*\scy="(\d+)"/) || [])[1];
  if (!ox || !cx) return null;
  return { x: emu(ox,"x"), y: emu(oy,"y"), w: emu(cx,"w"), h: emu(cy,"h") };
}

function getGeom(xml) {
  const m = xml.match(/a:prstGeom[^>]*\sprst="([^"]+)"/i);
  return m ? m[1] : "rect";
}

function getAllRuns(xml) {
  const runs = [];
  const rRe = /<a:r(?:\s[^>]*)?>[\s\S]*?<\/a:r>/gi;
  let m;
  while ((m = rRe.exec(xml)) !== null) {
    const r = m[0];
    const tM = r.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/i);
    if (!tM) continue;
    const text = tM[1]
      .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
      .replace(/&quot;/g,'"').replace(/&apos;/g,"'");
    const rPrM = r.match(/<a:rPr([^>]*)>/i);
    const sz = rPrM ? (rPrM[1].match(/\ssz="(\d+)"/) || [])[1] : null;
    const bold = rPrM ? /\sb="1"/.test(rPrM[1]) : false;
    const solidM = r.match(/<a:solidFill[^>]*>([\s\S]*?)<\/a:solidFill>/i);
    const color = solidM ? srgbClr(solidM[1]) : null;
    runs.push({ text, sz: sz ? parseInt(sz)/100 : null, bold, color });
  }
  return runs;
}

function getLines(txBody) {
  const paraRe = /<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/gi;
  const lines = [];
  let m;
  while ((m = paraRe.exec(txBody)) !== null) {
    const runs = getAllRuns(m[0]);
    const line = runs.map(r => r.text).join("").trim();
    if (line) lines.push({ text: line, runs });
  }
  return lines;
}

function getAnchor(txBody) {
  const m = txBody.match(/a:bodyPr[^>]*\sanchor="([^"]+)"/i);
  return m ? m[1] : "ctr";
}

function getAlgn(txBody) {
  const m = txBody.match(/a:pPr[^>]*\salgn="([^"]+)"/i);
  return m ? m[1] : null;
}

function contrastText(hex) {
  if (!hex || hex === "none") return "#FFFFFF";
  const r = parseInt(hex.slice(1,3)||"88",16);
  const g = parseInt(hex.slice(3,5)||"88",16);
  const b = parseInt(hex.slice(5,7)||"88",16);
  return (0.299*r + 0.587*g + 0.114*b)/255 > 0.54 ? "#111827" : "#FFFFFF";
}

function escXml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function getSpBlocks(xml, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const blocks = []; let m;
  while ((m = re.exec(xml)) !== null) blocks.push(m[0]);
  return blocks;
}

async function renderSlide(slideXml) {
  const els = [];

  // Detect dark/light background from known bg colors in the XML
  const hasDarkBg = /0[aA]0[eE]1[aA]|070[cC]1[cC]|1[aA]1[aA]2[eE]|0[dD]1117|0[fF]172[aA]/.test(slideXml);
  const bgFillM = slideXml.match(/<p:bgPr[^>]*>([\s\S]*?)<\/p:bgPr>/i);
  const bgFill = bgFillM ? getFill(bgFillM[0]) : null;
  const bg = bgFill && bgFill !== "none" ? bgFill : (hasDarkBg ? "#0A0E1A" : "#F8FAFC");
  els.push(`<rect width="${SVG_W}" height="${SVG_H}" fill="${bg}"/>`);

  const shapes = getSpBlocks(slideXml, "p:sp");

  for (const sp of shapes) {
    const spPrM = sp.match(/<p:spPr[^>]*>([\s\S]*?)<\/p:spPr>/i);
    if (!spPrM) continue;
    const spPr = spPrM[0];

    const xfrm = getXfrm(spPr);
    if (!xfrm) continue;
    const { x, y, w, h } = xfrm;
    if (w <= 0 || h <= 0) continue;

    const fill = getFill(spPr);
    const stroke = getStroke(spPr);
    const transp = getTransp(spPr);
    const geom = getGeom(spPr);
    const isEllipse = geom === "ellipse";
    const rx = geom === "roundRect" ? Math.min(8, Math.min(w,h)/2).toFixed(1) : "0";

    if (fill !== "none" || stroke) {
      const fillAttr = fill && fill !== "none" ? `fill="${fill}"` : `fill="none"`;
      const strokeAttr = stroke ? `stroke="${stroke}" stroke-width="0.7"` : `stroke="none"`;
      if (isEllipse) {
        els.push(`<ellipse cx="${(x+w/2).toFixed(1)}" cy="${(y+h/2).toFixed(1)}" rx="${(w/2).toFixed(1)}" ry="${(h/2).toFixed(1)}" ${fillAttr} ${strokeAttr} opacity="${transp}"/>`);
      } else {
        els.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${fillAttr} ${strokeAttr} opacity="${transp}"/>`);
      }
    }

    const txBodyM = sp.match(/<p:txBody[^>]*>([\s\S]*?)<\/p:txBody>/i);
    if (txBodyM) {
      const txBody = txBodyM[0];
      const lines = getLines(txBody);
      if (!lines.length) continue;

      const firstRun = lines[0].runs.find(r => r.sz);
      const rawSz = firstRun?.sz;
      const fontSize = rawSz
        ? Math.min(30, Math.max(6, rawSz * (SVG_W / 1440)))
        : Math.min(24, Math.max(7, h * 0.38));

      const firstColor = lines[0].runs.find(r => r.color)?.color;
      const textFill = fill && fill !== "none" ? contrastText(fill) : (hasDarkBg ? "#e2e8f0" : "#1e293b");
      const txColor = firstColor || textFill;
      const bold = lines[0].runs.some(r => r.bold) ? "bold" : "normal";

      const algn = getAlgn(txBody);
      const anchor = getAnchor(txBody);
      const svgAnchor = algn === "ctr" ? "middle" : algn === "r" ? "end" : "start";
      const textX = algn === "ctr" ? x + w/2 : algn === "r" ? x + w - 3 : x + 3;

      const lineH = fontSize * 1.28;
      const maxLines = Math.max(1, Math.floor(h / lineH) + 1);
      const visLines = lines.slice(0, maxLines);

      let baseY = anchor === "t" ? y + fontSize + 1
        : anchor === "b" ? y + h - lineH * (visLines.length - 1) - 3
        : y + h/2 - (lineH * visLines.length)/2 + fontSize;

      for (let i = 0; i < visLines.length; i++) {
        const line = visLines[i].text;
        const truncated = line.length > 85 ? line.slice(0, 85) + "…" : line;
        els.push(
          `<text x="${textX.toFixed(1)}" y="${(baseY + i*lineH).toFixed(1)}" ` +
          `font-size="${fontSize.toFixed(1)}" font-weight="${bold}" ` +
          `fill="${txColor}" text-anchor="${svgAnchor}" ` +
          `style="font-family:'Segoe UI',Arial,sans-serif">${escXml(truncated)}</text>`
        );
      }
    }
  }
  return els.join("\n    ");
}

async function main() {
  const pptxPath = process.argv[2] || "attached_assets/Introdução_à_Programação_em_Python_-_PPTX_-_2026-05-02_1777757795777.pptx";
  const startSlide = parseInt(process.argv[3] || "1");
  const count = parseInt(process.argv[4] || "15");

  const data = fs.readFileSync(pptxPath);
  const zip = await JsZip.loadAsync(data);

  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

  const total = slideFiles.length;
  const selected = slideFiles.slice(startSlide - 1, startSlide - 1 + count);

  const slides = [];
  for (let i = 0; i < selected.length; i++) {
    const xml = await zip.files[selected[i]].async("text");
    const content = await renderSlide(xml);
    slides.push({ num: startSlide + i, content });
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>PPTX Preview</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#060d1f;font-family:system-ui,sans-serif;padding:20px}
h1{font-size:12px;color:#475569;margin-bottom:16px;letter-spacing:.04em}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.wrap{display:flex;flex-direction:column;gap:5px}
.n{font-size:10px;color:#334155}
svg{width:100%;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.7);display:block}
</style></head>
<body>
<h1>PPTX Preview — ${escXml(path.basename(pptxPath))} · Slides ${startSlide}–${startSlide+slides.length-1} / ${total}</h1>
<div class="grid">
${slides.map(s=>`<div class="wrap"><span class="n">Slide ${s.num}</span>
<svg viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg">
    ${s.content}
</svg></div>`).join("\n")}
</div></body></html>`;

  const outPath = "/tmp/pptx_preview.html";
  fs.writeFileSync(outPath, html);
  console.log("DONE:" + outPath + ":" + total);
}

main().catch(e => { console.error(e.message); process.exit(1); });
