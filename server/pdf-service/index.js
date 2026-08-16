import express from "express";
import cors from "cors";
import puppeteer from "puppeteer-core";
import { buildCourseHtml } from "./template.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browserPromise;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/generate-pdf", async (req, res) => {
  const { course, modules } = req.body || {};

  if (!course || !course.title) {
    return res.status(400).json({ error: "Missing 'course' with a title" });
  }
  if (!Array.isArray(modules) || modules.length === 0) {
    return res.status(400).json({ error: "Missing 'modules' array" });
  }

  let page;
  try {
    const html = buildCourseHtml({ course, modules });

    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(course.title || "curso").replace(/[^a-z0-9-_ ]/gi, "").trim() || "curso"}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[pdf-service] generation failed:", err);
    res.status(500).json({ error: "PDF generation failed", detail: String(err?.message || err) });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

const PORT = process.env.PDF_SERVICE_PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[pdf-service] listening on port ${PORT}`);
});
