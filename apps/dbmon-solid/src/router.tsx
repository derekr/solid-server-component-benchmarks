// The dashboard, rendered on the server (`/`) and, for comparison, in the
// browser from streamed data (`/spa`, and `/spa-store` reconciling it into a
// store).
import { createRouter, defineRoute } from "@solidjs/router";
import Dashboard from "~/routes/dashboard";
import Spa from "~/routes/spa";
import SpaStore from "~/routes/spa-store";

export const Router = createRouter({
  routes: [
    defineRoute({ path: "/", component: Dashboard }),
    defineRoute({ path: "/spa", component: Spa }),
    defineRoute({ path: "/spa-store", component: SpaStore })
  ]
});
