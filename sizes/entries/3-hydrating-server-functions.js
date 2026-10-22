// The hydrating app plus the server-function client: what an SSR'd SPA that
// calls "use server" functions ships. The difference from 2-hydrating.js is
// the server-function transport; 4-server-components.js adds the frames
// client and dynamicComponent on top of this.
import { hydrate, Show, For, Loading, Errored } from "@solidjs/web";
import { createSignal, createMemo, lazy } from "solid-js";
import { createServerReference } from "@solidjs/web/server-functions/client";

const getStory = createServerReference("story", "getStory");
const [n, setN] = createSignal(0);
const Page = lazy(() => import("./lazy-page.js"));
hydrate(() => {
  const d = createMemo(() => n() + 1);
  setN(1);
  return [d(), Show, For, Loading, Errored, Page, getStory];
}, document.body);
