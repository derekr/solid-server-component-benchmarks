// The storefront on Datastar: the same listing and product page, markup and
// catalog as store-sc and store-spa, rendered on the server as plain HTML and
// navigated as a multi-page app. No build step; the page loads Datastar 1.0.4
// and nothing else.
//
// The interactive parts are split the way a Datastar app usually splits them:
// - The cart is server state (in memory, per cookie). Quick add and the buy
//   box's add to cart POST to the server, which answers with SSE patches for
//   the header's count, the mini-cart's lines and the tile's button. In the
//   Solid twins the cart is a client signal in the shell.
// - Purely local UI state is a Datastar signal on the page: the mini-cart's
//   open state, each tile's wishlist heart (`_` prefixed, so never sent), and
//   the buy box's colour, size and quantity, which the add request sends.
//
// Compressed like the other apps' servers: pages through streamed brotli
// quality 4, static assets once at quality 9.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { brotliCompressSync, createBrotliCompress, createGzip, constants } from "node:zlib";
import { getProduct, getProducts, getReviews } from "./catalog.js";

const PORT = Number(process.env.PORT || 3015);
const dir = new URL(".", import.meta.url).pathname;

const STATIC = {
  "/app.css": { file: dir + "app.css", type: "text/css" },
  "/datastar.js": { file: dir + "../dbmon-hypermedia/datastar.js", type: "text/javascript" }
};
const staticBrotli = new Map();

// ---- markup: the same as store-sc/src/components/views.tsx ----

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = cents => "$" + (cents / 100).toFixed(2);
const stars = n => "★".repeat(n) + "☆".repeat(5 - n);

const KINDS = ["Daypack", "Rain Shell", "Merino Crew", "Canvas Tote", "Trail Runner", "Wool Beanie", "Field Jacket", "Linen Shirt"];
const MENU = ["Women", "Men", "Kids", "Outdoor", "Home", "Accessories", "Sale", "Journal"].map((top, t) => ({
  top,
  columns: ["Featured", "Clothing", "Gear", "Collections"].map((h, c) => ({
    heading: h,
    links: Array.from({ length: 6 }, (_, k) => `${KINDS[(t + c + k) % KINDS.length]}${k % 2 ? "s" : ""}`)
  }))
}));
const FOOTER = ["Shop", "Help", "About", "Stores", "Follow"].map((h, i) => ({
  heading: h,
  links: Array.from({ length: 7 }, (_, k) => ["Gift cards", "Shipping", "Returns", "Repairs", "Careers", "Press", "Sustainability", "Store locator", "Contact"][(i * 2 + k) % 9])
}));

const links = ls => `<ul>${ls.map(l => `<li><a href="/">${l}</a></li>`).join("")}</ul>`;

const megaMenu = () =>
  `<nav class="menu">${MENU.map(m => `<div class="menu-top"><a href="/">${m.top}</a><div class="menu-panel">${m.columns.map(c => `<div><h4>${c.heading}</h4>${links(c.links)}</div>`).join("")}</div></div>`).join("")}</nav>`;

const footer = () =>
  `<footer class="footer">${FOOTER.map(f => `<div><h4>${f.heading}</h4>${links(f.links)}</div>`).join("")}<p class="legal">© 2026 Solid Supply Co. Prices include VAT. Free returns within 60 days.</p></footer>`;

const filters = () =>
  `<aside class="filters"><h2>Category</h2>${["Daypacks", "Shells", "Knitwear", "Bags", "Footwear", "Hats"].map(f => `<label><input type="checkbox" name="cat" value="${f}"> ${f}</label>`).join("")}<h2>Price</h2>${["Under $50", "$50 – $100", "$100 – $150", "Over $150"].map(f => `<label><input type="radio" name="price" value="${f}"> ${f}</label>`).join("")}</aside>`;

const price = (p, big) =>
  `<div class="${big ? "price big" : "price"}">${money(p.price)} ${p.compareAt ? `<s>${money(p.compareAt)}</s>` : ""}</div>`;

// ---- the interactive parts: store-sc/src/components/client.tsx ----

const carts = new Map(); // cookie id -> lines

const cartCount = lines => lines.reduce((n, l) => n + l.qty, 0);
const cartBadge = lines =>
  `<button id="cart-badge" class="cart-badge" data-on:click="$_cart = !$_cart">Cart (${cartCount(lines)})</button>`;
const cartLines = lines =>
  `<div id="cart-lines">${lines.map(l => `<p>${l.qty} × ${esc(l.name)} (${l.size}) ${money(l.price * l.qty)}</p>`).join("")}<p>Total ${money(lines.reduce((n, l) => n + l.price * l.qty, 0))}</p></div>`;

const shell = lines =>
  `<header class="header" data-signals:_cart="false"><a class="logo" href="/">Solid Supply</a><input class="search" type="search" placeholder="Search products">${cartBadge(lines)}</header>` +
  `<div class="mini-cart" style="display: none" data-show="$_cart">${cartLines(lines)}</div>`;

const quickAddButton = (id, added) =>
  `<button id="add-${id}" class="add" data-on:click="@post('/cart/${id}')">${added ? "Added ✓" : "Quick add"}</button>`;

// Each tile's heart is a local signal named after the product.
const quickAdd = p =>
  `<div class="quick" data-signals:_fav${p.id}="false">${quickAddButton(p.id, false)}` +
  `<button class="fav" aria-pressed="false" data-class:on="$_fav${p.id}" data-attr:aria-pressed="String($_fav${p.id})" data-on:click="$_fav${p.id} = !$_fav${p.id}">♥</button></div>`;

// The buy box's state is three signals (`color`, `size`, `qty`); the add
// request sends them. Stock per size is rendered into a computed signal.
function buyBox(p) {
  const stock = JSON.stringify(Object.fromEntries(p.sizes.map(s => [s.size, s.stock])));
  return (
    `<div class="buybox" data-signals="{color: 0, size: '', qty: 1}" data-computed:_stock="${esc(stock)}[$size] ?? 0">` +
    `<div class="swatches">${p.colors.map((c, i) => `<button class="${i === 0 ? "swatch on" : "swatch"}" style="background: ${c}" aria-label="colour ${i + 1}" data-class:on="$color === ${i}" data-on:click="$color = ${i}"></button>`).join("")}</div>` +
    `<div class="sizes">${p.sizes.map(s => `<button class="size"${s.stock ? "" : " disabled"} data-class:on="$size === '${s.size}'" data-on:click="$size = '${s.size}'">${s.size}</button>`).join("")}</div>` +
    `<p class="stock" data-text="$size ? ($_stock < 3 ? 'Only ' + $_stock + ' left' : 'In stock') : 'Choose a size'">Choose a size</p>` +
    `<div class="qty"><button class="dec" data-on:click="$qty = Math.max(1, $qty - 1)">−</button><span data-text="$qty">1</span><button class="inc" data-on:click="$qty = $qty + 1">+</button></div>` +
    `<button class="add" disabled data-attr:disabled="!$size" data-on:click="@post('/cart/${p.id}')" data-text="'Add to cart · $' + ($qty * ${p.price} / 100).toFixed(2)">Add to cart · ${money(p.price)}</button>` +
    `</div>`
  );
}

// ---- pages ----

const tile = p =>
  `<li class="product"><a href="/product/${p.id}" class="tile-link"><div class="thumb" style="background: ${p.colors[0]}">${esc(p.name[0])}</div>` +
  (p.badges.length ? `<div class="badges">${p.badges.map(b => `<span class="badge">${b}</span>`).join("")}</div>` : "") +
  `<p class="brand">${esc(p.brand)}</p><h3>${esc(p.name)}</h3>${price(p)}<div class="rating">${stars(p.rating)} <span>(${p.reviewCount})</span></div></a>${quickAdd(p)}</li>`;

async function listing() {
  const products = await getProducts();
  return `<div class="store">${filters()}<main><h1>All products</h1><p class="count">${products.length} items</p><ul class="grid">${products.map(tile).join("")}</ul></main></div>`;
}

async function product(id) {
  const [p, reviews] = await Promise.all([getProduct(id), getReviews(id)]);
  if (!p) return `<p class="missing">No such product.</p>`;
  return (
    `<div class="pdp"><div class="gallery">${p.colors.map(c => `<div class="shot" style="background: ${c}">${esc(p.name[0])}</div>`).join("")}</div>` +
    `<div><div class="info"><nav class="crumbs"><a href="/">Home</a> / <a href="/">${esc(p.category)}</a> / ${esc(p.name)}</nav><p class="brand">${esc(p.brand)}</p><h1>${esc(p.name)}</h1><div class="rating">${stars(p.rating)} <span>${p.reviewCount} reviews</span></div>${price(p, true)}<p class="desc">${esc(p.description)}</p></div>${buyBox(p)}</div></div>` +
    `<section class="details"><h2>Details</h2><ul>${p.details.map(d => `<li>${esc(d)}</li>`).join("")}</ul><h2>Reviews</h2>${reviews.map(r => `<article class="review"><div class="rating">${stars(r.rating)}</div><h3>${esc(r.title)}</h3><p>${esc(r.body)}</p><p class="by">${esc(r.author)} · ${r.date}</p></article>`).join("")}</section>`
  );
}

const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Solid Supply</title>
<link rel="stylesheet" href="/app.css">
<script type="module" src="/datastar.js"></script>
</head>
<body>`;

// Datastar SSE event (sdk/ADR.md): one `data: elements` line per HTML line,
// morphed into the element with the same id.
const patchEvent = html =>
  "event: datastar-patch-elements\n" + html.split("\n").map(l => `data: elements ${l}\n`).join("") + "\n";

const cookieId = req => /(?:^|;\s*)cart=([\w-]+)/.exec(req.headers.cookie || "")?.[1];

async function readJSON(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

/** Negotiated streaming compressor piped into `res`, or `res` for identity. */
function encoder(req, res) {
  const accepts = req.headers["accept-encoding"] || "";
  let stream;
  if (/\bbr\b/.test(accepts)) {
    res.setHeader("Content-Encoding", "br");
    stream = createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
  } else if (/\bgzip\b/.test(accepts)) {
    res.setHeader("Content-Encoding", "gzip");
    stream = createGzip();
  } else return res;
  stream.pipe(res);
  return stream;
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");

  const asset = STATIC[url.pathname];
  if (asset) {
    const headers = { "Content-Type": asset.type, "Cache-Control": "public, max-age=3600", Vary: "accept-encoding" };
    const content = readFileSync(asset.file);
    if (/\bbr\b/.test(req.headers["accept-encoding"] || "")) {
      let compressed = staticBrotli.get(url.pathname);
      if (!compressed) {
        compressed = brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
        staticBrotli.set(url.pathname, compressed);
      }
      res.writeHead(200, { ...headers, "Content-Encoding": "br" });
      return res.end(compressed);
    }
    res.writeHead(200, headers);
    return res.end(content);
  }

  // Add to cart: from a tile's quick add (size M, one) or the buy box (its
  // signals). The answer patches the badge, the mini-cart and, for a tile,
  // its button.
  let m;
  if (req.method === "POST" && (m = url.pathname.match(/^\/cart\/(\d+)$/))) {
    const p = await getProduct(+m[1]);
    if (!p) return res.writeHead(404).end();
    const signals = await readJSON(req);
    let id = cookieId(req);
    if (!id || !carts.has(id)) {
      id = randomUUID();
      carts.set(id, []);
      res.setHeader("Set-Cookie", `cart=${id}; Path=/; HttpOnly; SameSite=Lax`);
    }
    const lines = carts.get(id);
    const fromBuyBox = typeof signals.size === "string";
    if (fromBuyBox && !signals.size) return res.writeHead(204).end();
    lines.push({ id: p.id, name: p.name, price: p.price, size: fromBuyBox ? signals.size : "M", qty: fromBuyBox ? Math.max(1, +signals.qty || 1) : 1 });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    return res.end(
      patchEvent(cartBadge(lines)) + patchEvent(cartLines(lines)) + (fromBuyBox ? "" : patchEvent(quickAddButton(p.id, true)))
    );
  }

  const body =
    url.pathname === "/" ? listing : (m = url.pathname.match(/^\/product\/(\d+)$/)) ? () => product(+m[1]) : null;
  if (!body || req.method !== "GET") return res.writeHead(404).end("not found");
  // The page carries this visitor's cart, so it is not shared-cacheable.
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("Vary", "accept-encoding");
  const out = encoder(req, res);
  const write = s => {
    out.write(s);
    if (out !== res) out.flush();
  };
  const lines = carts.get(cookieId(req)) ?? [];
  write(head + shell(lines) + megaMenu());
  write((await body()) + footer() + "</body></html>");
  out.end();
}).listen(PORT, () => {
  console.log(`Store (Datastar) on http://localhost:${PORT}`);
});
