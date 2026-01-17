import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const USERNAME = process.env.KOFI_USERNAME || "yumykon";
const LIMIT = Math.min(parseInt(process.env.KOFI_LIMIT || "8", 10) || 8, 8);
const OUT_FILE = process.env.OUT_FILE || "data/kofi_newproducts.json";
const URL = `https://ko-fi.com/${USERNAME}/shop/newproducts`;

const nowIso = () => new Date().toISOString();

function uniqByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it?.url) continue;
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

async function main() {
  let browser;
  let active = false;
  let items = [];

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);

    const productUrls = await page.evaluate(() => {
  const anchors = Array.from(document.querySelectorAll('a[href*="ko-fi.com/s/"], a[href^="/s/"]'));

  const normUrl = (href) => {
    if (!href) return "";
    if (href.startsWith("http")) return href;
    if (href.startsWith("/")) return `https://ko-fi.com${href}`;
    return href;
  };

  const urls = anchors
    .map(a => normUrl(a.getAttribute("href")))
    .filter(u => u.includes("ko-fi.com/s/"));

  // unique preservando ordem
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
});


    const urls = productUrls.slice(0, LIMIT);

items = [];
for (const url of urls) {
  const details = await extractProductDetails(page, url);
  if (details) items.push(details);
  // pequena pausa para reduzir chance de bloqueio
  await page.waitForTimeout(350);
}

active = items.length > 0;

  } catch {
    active = false;
    items = [];
  } finally {
    if (browser) await browser.close();
  }

  const payload = { updated_at: nowIso(), active, items };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function extractProductDetails(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);

    const data = await page.evaluate(() => {
      const getMeta = (selector) => document.querySelector(selector)?.getAttribute("content")?.trim() || "";

      const ogTitle = getMeta('meta[property="og:title"]');
      const ogImage = getMeta('meta[property="og:image"]');
      const twImage = getMeta('meta[name="twitter:image"]');

      const title =
        ogTitle ||
        document.querySelector("h1,h2")?.textContent?.replace(/\s+/g, " ").trim() ||
        "Product";

      const image = ogImage || twImage || "";

      // preço: tenta achar no texto visível (heurística)
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const m = text.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
      const price = m ? `$${m[1]}` : "";

      return { title, image, price };
    });

    // limpeza extra de título (caso venha com “Ko-fi Shop” etc.)
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    let title = clean(data.title)
  .replace(/\b\d+\s*sold\b/i, "")
  .trim();

// remove exatamente o sufixo do Ko-fi Shop do seu perfil
title = title.replace(/\s*-\s*Yumykon's Ko-fi Shop\s*$/i, "").trim();

// fallback genérico caso mude o texto no futuro
title = title.replace(/\s*-\s*.*Ko-fi Shop\s*$/i, "").trim();

title = title || "Product";


    const image = clean(data.image);
    const price = clean(data.price);

    return { url, image, title, price };
  } catch {
    return null;
  }
}


main();
