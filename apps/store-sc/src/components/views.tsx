import { For, Show } from "solid-js";
import { FOOTER, MENU } from "~/navigation";
import type { Product, Review } from "~/types";

// The store's markup, identical in both twins. Here, in the server-components
// twin, only server components render it, so none of it reaches the client
// bundle; in the SPA twin the same file is client components.
export const money = (cents: number) => "$" + (cents / 100).toFixed(2);
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

export function MegaMenu() {
  return (
    <nav class="menu">
      <For each={MENU}>
        {m => (
          <div class="menu-top">
            <a href="/">{m.top}</a>
            <div class="menu-panel">
              <For each={m.columns}>
                {c => (
                  <div>
                    <h4>{c.heading}</h4>
                    <ul>
                      <For each={c.links}>
                        {l => (
                          <li>
                            <a href="/">{l}</a>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </nav>
  );
}

export function Footer() {
  return (
    <footer class="footer">
      <For each={FOOTER}>
        {f => (
          <div>
            <h4>{f.heading}</h4>
            <ul>
              <For each={f.links}>
                {l => (
                  <li>
                    <a href="/">{l}</a>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
      <p class="legal">© 2026 Solid Supply Co. Prices include VAT. Free returns within 60 days.</p>
    </footer>
  );
}

export function Filters() {
  return (
    <aside class="filters">
      <h2>Category</h2>
      <For each={["Daypacks", "Shells", "Knitwear", "Bags", "Footwear", "Hats"]}>
        {f => (
          <label>
            <input type="checkbox" name="cat" value={f} /> {f}
          </label>
        )}
      </For>
      <h2>Price</h2>
      <For each={["Under $50", "$50 – $100", "$100 – $150", "Over $150"]}>
        {f => (
          <label>
            <input type="radio" name="price" value={f} /> {f}
          </label>
        )}
      </For>
    </aside>
  );
}

function Price(props: { p: Product; big?: boolean }) {
  return (
    <div class={props.big ? "price big" : "price"}>
      {money(props.p.price)}{" "}
      <Show when={props.p.compareAt}>{c => <s>{money(c())}</s>}</Show>
    </div>
  );
}

/** A listing tile. `children` is where the tile's quick add goes. */
export function ProductTile(props: { p: Product; children: any }) {
  return (
    <li class="product">
      <a href={`/product/${props.p.id}`} class="tile-link">
        <div class="thumb" style={{ background: props.p.colors[0] }}>
          {props.p.name[0]}
        </div>
        <Show when={props.p.badges.length}>
          <div class="badges">
            <For each={props.p.badges}>{b => <span class="badge">{b}</span>}</For>
          </div>
        </Show>
        <p class="brand">{props.p.brand}</p>
        <h3>{props.p.name}</h3>
        <Price p={props.p} />
        <div class="rating">
          {stars(props.p.rating)} <span>({props.p.reviewCount})</span>
        </div>
      </a>
      {props.children}
    </li>
  );
}

export function Gallery(props: { p: Product }) {
  return (
    <div class="gallery">
      <For each={props.p.colors}>
        {c => (
          <div class="shot" style={{ background: c }}>
            {props.p.name[0]}
          </div>
        )}
      </For>
    </div>
  );
}

export function ProductInfo(props: { p: Product }) {
  return (
    <div class="info">
      <nav class="crumbs">
        <a href="/">Home</a> / <a href="/">{props.p.category}</a> / {props.p.name}
      </nav>
      <p class="brand">{props.p.brand}</p>
      <h1>{props.p.name}</h1>
      <div class="rating">
        {stars(props.p.rating)} <span>{props.p.reviewCount} reviews</span>
      </div>
      <Price p={props.p} big />
      <p class="desc">{props.p.description}</p>
    </div>
  );
}

export function ProductDetails(props: { p: Product; reviews: Review[] }) {
  return (
    <section class="details">
      <h2>Details</h2>
      <ul>
        <For each={props.p.details}>{d => <li>{d}</li>}</For>
      </ul>
      <h2>Reviews</h2>
      <For each={props.reviews}>
        {r => (
          <article class="review">
            <div class="rating">{stars(r.rating)}</div>
            <h3>{r.title}</h3>
            <p>{r.body}</p>
            <p class="by">
              {r.author} · {r.date}
            </p>
          </article>
        )}
      </For>
    </section>
  );
}
