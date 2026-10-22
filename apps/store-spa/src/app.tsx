// The SPA twin's client entry: the same router, routes and shell as
// ../store/src/app.tsx. Here the mega-menu and footer are ordinary client
// components, so their markup and links ship in the bundle and hydrate.
import { createRouter, defineRoute, intentPreload } from "@solidjs/router";
import { Loading } from "solid-js";
import { StoreShell } from "~/components/client";
import { Footer, MegaMenu } from "~/components/views";
import Listing, { preload as preloadListing } from "~/routes/listing";
import Product, { preload as preloadProduct } from "~/routes/product";
import "./app.css";

const Router = createRouter({
  preloadLinks: intentPreload(),
  routes: [
    defineRoute({ path: "/", component: Listing, preload: preloadListing }),
    defineRoute({ path: "/product/:id", component: Product, preload: preloadProduct })
  ]
});

export default function App() {
  return (
    <Router>
      {props => (
        <StoreShell>
          <MegaMenu />
          <Loading fallback={<div class="loading">Loading...</div>}>{props.children}</Loading>
          <Footer />
        </StoreShell>
      )}
    </Router>
  );
}
