import fs from "node:fs/promises";
import path from "node:path";

const STORE_SLUG = process.env.ACG_STORE_SLUG || "yumykon";
const LIMIT = Math.max(1, Math.min(parseInt(process.env.ACG_LIMIT || "8", 10) || 8, 24));
const OUT_FILE = process.env.OUT_FILE || "data/store_products.json";
const URL = `https://acggoods.com/store/${STORE_SLUG}`;

const nowIso = () => new Date().toISOString();

function decodeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(input, base) {
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith("/")) return `${base}${input}`;
  return input;
}

function uniqByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const url = String(item?.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(item);
  }
  return out;
}

function extractProductsFromHtml(html) {
  const base = "https://acggoods.com";
  const anchors = html.matchAll(
    /<a[^>]*class="[^"]*\btrack-show-product\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  );

  const products = [];

  for (const match of anchors) {
    const href = match[1] || "";
    const block = match[2] || "";

    const url = absUrl(href.trim(), base);
    const image =
      decodeHtml(block.match(/<img[^>]*\bsrc="([^"]+)"/i)?.[1] || "") ||
      decodeHtml(block.match(/<img[^>]*\bsrcset="([^"]+)"/i)?.[1]?.split(",")?.[0]?.trim()?.split(" ")?.[0] || "");

    const title =
      decodeHtml(block.match(/class="acg-product-c-w__name"[^>]*>([^<]+)</i)?.[1] || "") ||
      decodeHtml(block.match(/<img[^>]*\balt="([^"]+)"/i)?.[1] || "") ||
      "Product";

    const price = decodeHtml(
      block.match(/class="acg-product-c-w__price"[^>]*>([^<]+)</i)?.[1] || ""
    );

    if (!url || !image || !title) continue;

    products.push({
      url,
      image,
      title,
      price,
      source: "acggoods",
    });
  }

  return uniqByUrl(products);
}

async function fetchStorePage(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  let items = [];

  try {
    const html = await fetchStorePage(URL);
    items = extractProductsFromHtml(html).slice(0, LIMIT);
  } catch {
    items = [];
  }

  const payload = {
    updated_at: nowIso(),
    source: "acggoods",
    store_url: URL,
    items,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

main();
