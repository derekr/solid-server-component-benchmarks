import { query, type RouteParams, type RoutePreloadFuncArgs, type RouteProps } from "@solidjs/router";
import { Show, createMemo } from "solid-js";
import { BuyBox } from "~/components/client";
import { Gallery, ProductDetails, ProductInfo } from "~/components/views";
import { getProduct, getReviews } from "~/server/catalog";

type Path = "/product/:id";

// The same product page as the server-components twin, rendered by client
// components from JSON: the product and its twelve reviews ship as hydration
// data.
const getProductPage = query(async (id: string) => {
  "use server";
  const [product, reviews] = await Promise.all([getProduct(+id), getReviews(+id)]);
  return { product, reviews };
}, "product");

export const preload = ({ params }: RoutePreloadFuncArgs<RouteParams<Path>>) => {
  void getProductPage(params.id);
};

export default function Product(props: RouteProps<Path>) {
  const page = createMemo(() => getProductPage(props.params.id));
  return (
    <Show when={page().product} fallback={<p class="missing">No such product.</p>}>
      {p => (
        <>
          <div class="pdp">
            <Gallery p={p()} />
            <div>
              <ProductInfo p={p()} />
              <BuyBox id={p().id} name={p().name} price={p().price} colors={p().colors} sizes={p().sizes} />
            </div>
          </div>
          <ProductDetails p={p()} reviews={page().reviews} />
        </>
      )}
    </Show>
  );
}
