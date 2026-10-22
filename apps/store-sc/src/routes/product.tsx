import type { RouteProps } from "@solidjs/router";
import { dynamicComponent } from "@solidjs/web";
import type { Slot } from "@solidjs/web/frames";
import { BuyBox } from "~/components/client";
import { Gallery, ProductDetails, ProductInfo } from "~/components/views";
import { getProduct, getReviews } from "~/server/catalog";
import type { Variant } from "~/types";

type BuyBoxArgs = { id: number; name: string; price: number; colors: string[]; sizes: Variant[] };

// The product page is a server component: gallery, copy, details and the
// twelve reviews are server markup. The buy box (colour, size, quantity, add
// to cart) is the one client component, placed in the `buyBox` slot.
async function getProductPage(id: string) {
  "use server";
  const [p, reviews] = await Promise.all([getProduct(+id), getReviews(+id)]);
  if (!p) return () => <p class="missing">No such product.</p>;
  return (props: { buyBox: Slot<BuyBoxArgs> }) => (
    <>
      <div class="pdp">
        <Gallery p={p} />
        <div>
          <ProductInfo p={p} />
          <props.buyBox id={p.id} name={p.name} price={p.price} colors={p.colors} sizes={p.sizes} />
        </div>
      </div>
      <ProductDetails p={p} reviews={reviews} />
    </>
  );
}

export default function Product(props: RouteProps<"/product/:id">) {
  const View = dynamicComponent(() => getProductPage(props.params.id));
  return <View buyBox={(args: BuyBoxArgs) => <BuyBox {...args} />} />;
}
