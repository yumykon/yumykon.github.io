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

    const raw = await page.evaluate(() => {
  const anchors = Array.from(
    document.querySelectorAll('a[href*="ko-fi.com/s/"], a[href^="/s/"]')
  );

  const normUrl = (href) => {
    if (!href) return "";
    if (href.startsWith("http")) return href;
    if (href.startsWith("/")) return `https://ko-fi.com${href}`;
    return href;
  };

  const guessPrice = (txt) => {
    const m =
      txt.match(/(\$)\s?(\d+(?:\.\d{1,2})?)/) ||
      txt.match(/\bUSD\s?(\d+(?:\.\d{1,2})?)\b/i);
    if (!m) return "";
    if (m[1] === "$" && m[2]) return `$${m[2]}`;
    if (m[1] && !m[2]) return `$${m[1]}`;
    return "";
  };

  const out = [];
  for (const a of anchors) {
    const url = normUrl(a.getAttribute("href"));
    const card =
      a.closest("article, li, [role='listitem'], .shop-item, .kfds-card, div") || a;

    // tenta pegar a imagem correta do produto
    const imgs = Array.from(card.querySelectorAll("img"));
    const bestImg =
      imgs.find(im => (im.getAttribute("src") || "").includes("storage.ko-fi.com")) ||
      imgs.find(im => (im.getAttribute("data-src") || "").includes("storage.ko-fi.com")) ||
      imgs[0];

    const image =
      bestImg?.getAttribute("src") ||
      bestImg?.getAttribute("data-src") ||
      "";

    // tenta achar um título limpo
    const heading =
      card.querySelector("h1,h2,h3,h4,[data-testid*='title'],[class*='title']");

    const rawTitle = (
      heading?.textContent ||
      bestImg?.getAttribute("alt") ||
      a.textContent ||
      ""
    ).replace(/\s+/g, " ").trim();

    const nearText = (card.innerText || "").replace(/\s+/g, " ").trim();
    const price = guessPrice(nearText);

    out.push({ url, image, title: rawTitle, price });
  }

  return out;
});

    items = uniqByUrl(raw)
      .filter((p) => p.url && p.url.includes("ko-fi.com/s/"))
      .slice(0, LIMIT);

    const cleanTitle = (t, price) => {
  let s = (t || "").replace(/\s+/g, " ").trim();

  // remove preço no começo
  s = s.replace(/^\$?\d+(?:\.\d{1,2})?\s*/i, "");

  // remove "X sold"
  s = s.replace(/\b\d+\s*sold\b/i, "").trim();

  // remove preço no fim
  if (price) {
    const p = price.replace(/\$/g, "\\$");
    s = s.replace(new RegExp(`\\s*${p}\\s*$`), "").trim();
  }

  // corta descrição longa
  s = s.split(" - ")[0].trim();

  return s || "Product";
};

items = items.map(p => ({
  ...p,
  title: cleanTitle(p.title, p.price),
}));


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

main();
