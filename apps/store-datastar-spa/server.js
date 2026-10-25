// The store as a Datastar SPA: every page URL gets the same static shell,
// the catalog comes from /api as JSON, and Rocket components (public/app.js)
// render it in the browser. The counterpart of ../store-spa: same routes,
// markup, CSS and catalog (no data delay, as there).
//
// Compression matches the Solid servers: static assets brotli 9 (compressed
// once), responses brotli 4. ROCKET=patched as in ../hn-datastar-spa.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { getProducts, getProduct, getReviews } from "./catalog.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3066;
const ROCKET = process.env.ROCKET === "patched" ? "datastar-rocket-patched.js" : "datastar-rocket.js";

const statics = {};
for (const [url, file] of [
  ["app.js", "public/app.js"],
  ["app.css", "public/app.css"],
  ["datastar-rocket.js", "../hn-datastar-spa/public/" + ROCKET]
]) {
  const body = readFileSync(path.resolve(root, file));
  statics["/" + url] = {
    type: url.endsWith(".css") ? "text/css" : "application/javascript",
    body,
    br: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
  };
}

async function api(p) {
  let m;
  if (p === "/api/listing") return getProducts();
  if ((m = p.match(/^\/api\/product\/(\d+)$/))) {
    const [product, reviews] = await Promise.all([getProduct(+m[1]), getReviews(+m[1])]);
    return { product: product ?? null, reviews };
  }
  return undefined;
}

const dataFor = p => {
  let m;
  if (p === "/") return "/api/listing";
  if ((m = p.match(/^\/product\/(\d+)$/))) return `/api/product/${m[1]}`;
  return null;
};

// The header and mega-menu, static in the shell (an SPA's index.html), with
// the cart badge bound to the $cart signal. Content as
// ../store-spa/src/navigation.ts.
const KINDS = ["Daypack", "Rain Shell", "Merino Crew", "Canvas Tote", "Trail Runner", "Wool Beanie", "Field Jacket", "Linen Shirt"];
const MENU = ["Women", "Men", "Kids", "Outdoor", "Home", "Accessories", "Sale", "Journal"].map((top, t) => ({
  top,
  columns: ["Featured", "Clothing", "Gear", "Collections"].map((h, c) => ({
    heading: h,
    links: Array.from({ length: 6 }, (_, k) => `${KINDS[(t + c + k) % KINDS.length]}${k % 2 ? "s" : ""}`)
  }))
}));
const chrome =
  `<header class="header"><a class="logo" href="/">Solid Supply</a><input class="search" type="search" placeholder="Search products"><button class="cart-badge" data-on:click="$cartOpen = !$cartOpen" data-text="'Cart (' + $cart.reduce((n, l) => n + l.qty, 0) + ')'">Cart (0)</button></header><mini-cart></mini-cart>` +
  `<nav class="menu">${MENU.map(m => `<div class="menu-top"><a href="/">${m.top}</a><div class="menu-panel">${m.columns.map(c => `<div><h4>${c.heading}</h4><ul>${c.links.map(l => `<li><a href="/">${l}</a></li>`).join("")}</ul></div>`).join("")}</div></div>`).join("")}</nav>`;

const shell = data => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Solid Supply</title>
<link rel="stylesheet" href="/app.css">
${data ? `<link rel="preload" as="fetch" href="${data}" crossorigin>` : ""}
<script type="module" src="/app.js"></script>
</head>
<body data-signals="{cart: [], cartOpen: false}">
${chrome}<store-app><div class="loading">Loading...</div></store-app>
</body>
</html>`;

function send(req, res, status, type, body) {
  const headers = { "Content-Type": type };
  if (/\bbr\b/.test(req.headers["accept-encoding"] || "")) {
    headers["Content-Encoding"] = "br";
    body = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
  }
  res.writeHead(status, headers);
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const s = statics[url.pathname];
  if (s) {
    const br = /\bbr\b/.test(req.headers["accept-encoding"] || "");
    res.writeHead(200, { "Content-Type": s.type, "Cache-Control": "public, max-age=3600", ...(br ? { "Content-Encoding": "br" } : {}) });
    return res.end(br ? s.br : s.body);
  }
  if (url.pathname.startsWith("/api/")) {
    const data = await api(url.pathname);
    if (data === undefined) return send(req, res, 404, "application/json", "{}");
    return send(req, res, 200, "application/json", JSON.stringify(data));
  }
  if (req.method === "HEAD") return res.writeHead(200).end();
  send(req, res, 200, "text/html; charset=utf-8", shell(dataFor(url.pathname)));
}).listen(PORT, () => console.log(`Store (Datastar SPA, ${ROCKET}) on http://localhost:${PORT}`));
