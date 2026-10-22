import { query } from "@solidjs/router";
import { For, createMemo } from "solid-js";
import { QuickAdd } from "~/components/client";
import { Filters, ProductTile } from "~/components/views";
import { getProducts } from "~/server/catalog";

// The same listing as the server-components twin, rendered by client
// components from JSON. Every product the tiles show ships as hydration data.
const getListing = query(async () => {
  "use server";
  return getProducts();
}, "listing");

export const preload = () => void getListing();

export default function Listing() {
  const products = createMemo(() => getListing());
  return (
    <div class="store">
      <Filters />
      <main>
        <h1>All products</h1>
        <p class="count">{products().length} items</p>
        <ul class="grid">
          <For each={products()}>
            {p => (
              <ProductTile p={p}>
                <QuickAdd id={p.id} name={p.name} price={p.price} />
              </ProductTile>
            )}
          </For>
        </ul>
      </main>
    </div>
  );
}
