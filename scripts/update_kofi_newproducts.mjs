import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const USERNAME = process.env.KOFI_USERNAME || "yumykon";
const LIMIT = Math.min(parseInt(process.env.KOFI_LIMIT || "8", 10) || 8, 8);
const OUT_FILE = process.env.OUT_FILE || "data/kofi_newproducts.json";

const URL = `https://ko-fi.com/${USERNAME}/shop/newproducts`;

function nowIso() {
  return new Date().toISOString();
}

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
    // tenta esperar conteúdo “real”
    await page.waitForTimeout(2500);

    // Estratégia: encontrar links de produto ko-fi (/s/xxxxx)
    const raw = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="ko-fi.com/s/"], a[href^="/s/"]'));

      const normUrl = (href) => {
        if (!href) return "";
        if (href.startsWith("http")) return href;
        if (href.startsWith("/")) return `https://ko-fi.com${href}`;
        return href;
      };

      const getTextNear = (el) => {
        // tenta pegar texto mais “perto” do card
        const card = el.closest("article, li, div") || el;
        const txt = (card.innerText || "").trim();
        return txt.replace(/\s+/g, " ");
      };

      const guessPrice = (txt) => {
        // tenta achar algo como $3.59, USD 3.59, etc
        const m = txt.match(/(\$)\s?(\d+(?:\.\d{1,2})?)/) || txt.match(/\bUSD\s?(\d+(?:\.\d{1,2})?)\b/i);
        if (!m) return "";
        if (m[1] && m[2]) return `${m[1]}${m[2]}`;
        if (m[1] && !m[2]) return `$${m[1]}`;
        return "";
      };

      const out = [];
      for (const a of anchors) {
        const url = normUrl(a.getAttribute("href"));
        const card = a.closest("article, li, div") || a;

        const img = card.querySelector("img");
        const image = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
        const title = (img?.getAttribute("alt") || "").trim() || (a.innerText || "").trim() || "Product";

        const nearText = getTextNear(a);
        const price = guessPrice(nearText);

        out.push({ url, image, title, price });
      }
      return out;
    });

    items = uniqByUrl(raw)
      .filter((p) => p.url && p.url.includes("ko-fi.com/s/"))
      .slice(0, LIMIT);

    active = items.length > 0;
  } catch {
    active = false;
    items = [];
  } finally {
    if (browser) await browser.close();
  }

  const payload = {
    updated_at: nowIso(),
    active,
    items,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

main();
