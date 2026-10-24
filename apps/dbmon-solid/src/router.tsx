// The dashboard, rendered on the server (`/`, and `/sc-window` rendering only
// a slice of it for a scrolling viewport) and, for comparison, in the browser
// from streamed data (`/spa`, `/spa-store` reconciling it into a store, and
// `/spa-window` rendering only the rows in a scrolling viewport).
import { createRouter, defineRoute } from "@solidjs/router";
import Dashboard from "~/routes/dashboard";
import Spa from "~/routes/spa";
import SpaStore from "~/routes/spa-store";
import SpaWindow from "~/routes/spa-window";
import ScWindow from "~/routes/sc-window";

export const Router = createRouter({
  routes: [
    defineRoute({ path: "/", component: Dashboard }),
    defineRoute({ path: "/spa", component: Spa }),
    defineRoute({ path: "/spa-store", component: SpaStore }),
    defineRoute({ path: "/spa-window", component: SpaWindow }),
    defineRoute({ path: "/sc-window", component: ScWindow })
  ]
});
