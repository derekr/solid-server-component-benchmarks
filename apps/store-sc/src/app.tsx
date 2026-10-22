// The client side of the server-components twin. Compare with
// ../store-spa/src/app.tsx: same router, same routes, same shell. What is
// missing is the store's markup: the mega-menu, the footer, the listing and
// the product page are server components, so all that ships is the router,
// the shell with its cart, and the small widgets the server places into
// slots (each tile's quick add, the product page's buy box).
import { createRouter, defineRoute, intentPreload } from "@solidjs/router";
import { Loading } from "solid-js";
import { dynamicComponent } from "@solidjs/web";
import { StoreShell } from "~/components/client";
import { Footer, MegaMenu } from "~/components/views";
import Listing from "~/routes/listing";
import Product from "~/routes/product";
import "./app.css";

// The mega-menu and footer are static chrome: about 250 links that never
// change on the client. As server components they arrive as HTML once, the
// client adopts them, and navigation leaves them alone.
async function getMenu() {
  "use server";
  return () => <MegaMenu />;
}

async function getFooter() {
  "use server";
  return () => <Footer />;
}

const Router = createRouter({
  preloadLinks: intentPreload(),
  routes: [
    defineRoute({ path: "/", component: Listing }),
    defineRoute({ path: "/product/:id", component: Product })
  ]
});

export default function App() {
  const Menu = dynamicComponent(() => getMenu());
  const FooterLinks = dynamicComponent(() => getFooter());
  return (
    <Router>
      {props => (
        <StoreShell>
          <Menu />
          <Loading fallback={<div class="loading">Loading...</div>}>{props.children}</Loading>
          <FooterLinks />
        </StoreShell>
      )}
    </Router>
  );
}
