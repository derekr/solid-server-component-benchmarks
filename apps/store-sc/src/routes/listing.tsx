import { dynamicComponent } from "@solidjs/web";
import type { Slot } from "@solidjs/web/frames";
import { QuickAdd } from "~/components/client";
import { Filters, ProductTile } from "~/components/views";
import { getProducts } from "~/server/catalog";

type QuickAddArgs = { id: number; name: string; price: number };

// The listing is a server component: filters, tiles, prices and ratings are
// server markup. Each tile places one small client component in the `quickAdd`
// slot, and the slot's arguments are all it receives: three plain values per
// tile, not the product.
async function getListing() {
  "use server";
  const products = await getProducts();
  return (props: { quickAdd: Slot<QuickAddArgs> }) => (
    <div class="store">
      <Filters />
      <main>
        <h1>All products</h1>
        <p class="count">{products.length} items</p>
        <ul class="grid">
          {products.map(p => (
            <ProductTile p={p}>
              <props.quickAdd id={p.id} name={p.name} price={p.price} />
            </ProductTile>
          ))}
        </ul>
      </main>
    </div>
  );
}

export default function Listing() {
  const View = dynamicComponent(() => getListing());
  return <View quickAdd={(args: QuickAddArgs) => <QuickAdd {...args} />} />;
}
