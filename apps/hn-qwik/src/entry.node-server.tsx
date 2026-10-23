/*
 * The production entry: Qwik City's node middleware, fronted by server.js.
 */
import { createQwikCity } from "@builder.io/qwik-city/middleware/node";
import qwikCityPlan from "@qwik-city-plan";
import { manifest } from "@qwik-client-manifest";
import render from "./entry.ssr";

const { router, notFound, staticFile } = createQwikCity({ render, qwikCityPlan, manifest });

export { router, notFound, staticFile };
