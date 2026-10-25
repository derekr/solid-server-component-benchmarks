// The whole client, on Datastar + Rocket. The header and mega-menu are
// static markup in the shell (server.js); <store-app> fetches a page's JSON
// once and renders the page and footer with Rocket's `html` templates, the
// same markup ../store-spa renders with Solid. The cart is a global signal
// ($cart), so the header, the mini cart and every widget share it as Solid's
// context does. The buy box is a Rocket component with local signals, as it
// is a Solid component with local signals there. Quick add, on every tile, is
// not: it has no signal and no binding per tile. One delegated data-on:click
// on the grid handles every tile's buttons, adding to $cart (the state other
// elements read) and setting the clicked button's class and label directly.
//
// There is no router: a click on a link to one of the two pages pushes the
// URL, fetches that page's JSON and renders it.
import { rocket } from "/datastar-rocket.js";

// The footer content, as ../store-spa/src/navigation.ts.
const KINDS = ["Daypack", "Rain Shell", "Merino Crew", "Canvas Tote", "Trail Runner", "Wool Beanie", "Field Jacket", "Linen Shirt"];
const FOOTER = ["Shop", "Help", "About", "Stores", "Follow"].map((h, i) => ({
  heading: h,
  links: Array.from({ length: 7 }, (_, k) => `${["Gift cards", "Shipping", "Returns", "Repairs", "Careers", "Press", "Sustainability", "Store locator", "Contact"][(i * 2 + k) % 9]}`)
}));

const money = cents => "$" + (cents / 100).toFixed(2);
const stars = n => "★".repeat(n) + "☆".repeat(5 - n);
// The same formatting inside Datastar expressions.
const moneyExpr = cents => `'$' + ((${cents}) / 100).toFixed(2)`;

const route = loc => {
  let m;
  if (loc.pathname === "/") return { kind: "listing", url: "/api/listing" };
  if ((m = loc.pathname.match(/^\/product\/(\d+)$/))) return { kind: "product", url: `/api/product/${m[1]}` };
  return null;
};

const footer = html =>
  html`<footer class="footer">${FOOTER.map(
    f => html`<div><h4>${f.heading}</h4><ul>${f.links.map(l => html`<li><a href="/">${l}</a></li>`)}</ul></div>`
  )}<p class="legal">© 2026 Solid Supply Co. Prices include VAT. Free returns within 60 days.</p></footer>`;

const filters = html =>
  html`<aside class="filters"><h2>Category</h2>${["Daypacks", "Shells", "Knitwear", "Bags", "Footwear", "Hats"].map(
    f => html`<label><input type="checkbox" name="cat" value="${f}"> ${f}</label>`
  )}<h2>Price</h2>${["Under $50", "$50 – $100", "$100 – $150", "Over $150"].map(
    f => html`<label><input type="radio" name="price" value="${f}"> ${f}</label>`
  )}</aside>`;

const price = (html, p, big) =>
  html`<div class="${big ? "price big" : "price"}">${money(p.price)} ${p.compareAt ? html`<s>${money(p.compareAt)}</s>` : null}</div>`;

const tile = (html, p) =>
  html`<li class="product"><a href="/product/${p.id}" class="tile-link"><div class="thumb" style="background: ${p.colors[0]}">${p.name[0]}</div>${
    p.badges.length ? html`<div class="badges">${p.badges.map(b => html`<span class="badge">${b}</span>`)}</div>` : null
  }<p class="brand">${p.brand}</p><h3>${p.name}</h3>${price(html, p)}<div class="rating">${stars(p.rating)} <span>(${p.reviewCount})</span></div></a><div class="quick" data-pid="${p.id}" data-name="${p.name}" data-price="${p.price}"><button class="add">Quick add</button><button class="fav" aria-pressed="false">♥</button></div></li>`;

// Every tile's quick add and favourite buttons, from one listener on the grid.
const onQuick =
  "const b = evt.target.closest('.quick button'); if (b) { const d = b.parentNode.dataset; " +
  "if (b.classList.contains('fav')) b.setAttribute('aria-pressed', String(b.classList.toggle('on'))); " +
  "else { $cart = [...$cart, { id: +d.pid, name: d.name, price: +d.price, size: 'M', qty: 1 }]; b.textContent = 'Added ✓' } }";

const listing = (html, products) =>
  html`<div class="store">${filters(html)}<main><h1>All products</h1><p class="count">${products.length} items</p><ul class="grid" data-on:click="${onQuick}">${products.map(p => tile(html, p))}</ul></main></div>`;

const product = (html, { product: p, reviews }) =>
  !p
    ? html`<p class="missing">No such product.</p>`
    : html`<div class="pdp"><div class="gallery">${p.colors.map(c => html`<div class="shot" style="background: ${c}">${p.name[0]}</div>`)}</div><div><div class="info"><nav class="crumbs"><a href="/">Home</a> / <a href="/">${p.category}</a> / ${p.name}</nav><p class="brand">${p.brand}</p><h1>${p.name}</h1><div class="rating">${stars(p.rating)} <span>${p.reviewCount} reviews</span></div>${price(html, p, true)}<p class="desc">${p.description}</p></div><buy-box pid="${p.id}" name="${p.name}" price="${p.price}" colors="${JSON.stringify(p.colors)}" sizes="${JSON.stringify(p.sizes)}"></buy-box></div></div><section class="details"><h2>Details</h2><ul>${p.details.map(
        d => html`<li>${d}</li>`
      )}</ul><h2>Reviews</h2>${reviews.map(
        r => html`<article class="review"><div class="rating">${stars(r.rating)}</div><h3>${r.title}</h3><p>${r.body}</p><p class="by">${r.author} · ${r.date}</p></article>`
      )}</section>`;

const VIEWS = { listing, product };

// The line a widget adds to the cart, as a Datastar expression.
const addLine = (props, size, qty) =>
  `$cart = [...$cart, { id: ${props.pid}, name: ${JSON.stringify(props.name)}, price: ${props.price}, size: ${size}, qty: ${qty} }]`;

rocket("buy-box", {
  mode: "light",
  props: ({ number, string, json }) => ({ pid: number, name: string, price: number, colors: json.default(() => []), sizes: json.default(() => []) }),
  setup({ $$ }) {
    $$.color = 0;
    $$.size = "";
    $$.qty = 1;
  },
  render: ({ html, props }) => {
    const stock = JSON.stringify(Object.fromEntries(props.sizes.map(s => [s.size, s.stock])));
    return html`<div class="buybox"><div class="swatches">${props.colors.map(
      (c, i) => html`<button class="${i ? "swatch" : "swatch on"}" style="background: ${c}" aria-label="colour ${i + 1}" data-class:on="$$color === ${i}" data-on:click="$$color = ${i}"></button>`
    )}</div><div class="sizes">${props.sizes.map(
      s => html`<button class="size" data-class:on="$$size === '${s.size}'" disabled="${!s.stock}" data-on:click="$$size = '${s.size}'">${s.size}</button>`
    )}</div><p class="stock" data-text="$$size ? (${stock}[$$size] < 3 ? 'Only ' + ${stock}[$$size] + ' left' : 'In stock') : 'Choose a size'">Choose a size</p><div class="qty"><button class="dec" data-on:click="$$qty = Math.max(1, $$qty - 1)">−</button><span data-text="$$qty">1</span><button class="inc" data-on:click="$$qty = $$qty + 1">+</button></div><button class="add" disabled data-attr:disabled="!$$size" data-on:click="${addLine(props, "$$size", "$$qty")}" data-text="'Add to cart · ' + ${moneyExpr(`${props.price} * $$qty`)}">Add to cart · ${money(props.price)}</button></div>`;
  }
});

// Rendered only while open, as Solid's <Show>.
rocket("mini-cart", {
  mode: "light",
  render: ({ html }) =>
    html`<template data-if="$cartOpen"><div class="mini-cart"><template data-for="l in $cart"><p data-text="l.qty + ' × ' + l.name + ' (' + l.size + ') ' + ${moneyExpr("l.price * l.qty")}"></p></template><p data-text="'Total ' + ${moneyExpr("$cart.reduce((n, l) => n + l.price * l.qty, 0)")}"></p></div></template>`
});

rocket("store-app", {
  mode: "light",
  setup({ render, cleanup }) {
    let current = 0;
    async function load() {
      const r = route(location);
      if (!r) return render({}, { kind: "missing" });
      const n = ++current;
      const data = await (await fetch(r.url)).json();
      if (n !== current) return;
      render({}, { ...r, data });
    }
    const onClick = e => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]");
      if (!a || a.target || a.origin !== location.origin || !route(a)) return;
      e.preventDefault();
      history.pushState(null, "", a.href);
      load().then(() => scrollTo(0, 0));
    };
    document.addEventListener("click", onClick);
    addEventListener("popstate", load);
    cleanup(() => {
      document.removeEventListener("click", onClick);
      removeEventListener("popstate", load);
    });
    load();
  },
  render({ html }, view) {
    const page = !view
      ? html`<div class="loading">Loading...</div>`
      : view.kind === "missing"
        ? html`<p class="missing">No such page.</p>`
        : VIEWS[view.kind](html, view.data);
    // The footer comes with the page, not before it: shown under the
    // loading line it would be pushed down when the page arrives.
    return view ? html`${page}${footer(html)}` : page;
  }
});
