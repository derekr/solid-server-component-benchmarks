// Lighthouse 12, performance category, default mobile preset (simulated slow
// 4G, 4x CPU). One fresh headless Chromium per run, and every page in a set
// runs once per round, so slow stretches of the machine hit all of them.
// Lighthouse loads each app directly: its simulated network is the network
// here, so the NET proxy (apps.mjs) would count the latency twice.
//
// usage: node lighthouse.mjs <set> [rounds=15] [outDir=results/<set>]
//   sets: hn (story page, toggles; Solid SC, Solid SPA, Next RSC, Qwik City, Datastar), hn-details (story page, <details>), store (listing + product),
//         dbmon (the live table at 400 rows: Solid SC, Solid SPA, Datastar changed rows and signals)
//         spa-hn (story page; Solid SPA and Datastar SPA, <details> and toggles), spa-store (the store, Solid SPA and Datastar SPA)
//
// Prints one JSON line per run and a median table at the end; the raw
// Lighthouse reports land in outDir.
import fs from "node:fs";
import lighthouse from "lighthouse";
import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import { APPS, start, stop, direct } from "./apps.mjs";

const SETS = {
  hn: {
    apps: ["hn-sc-toggles", "hn-spa-toggles", "hn-next-rsc", "hn-qwik", "hn-datastar-toggles", "hn-datastar-window"],
    pages: { story: "/stories/30186326" }
  },
  "hn-details": {
    apps: ["hn-sc", "hn-spa", "hn-datastar", "hn-datastar-cv"],
    pages: { story: "/stories/30186326" }
  },
  // The Solid SPAs beside their Datastar + Rocket counterparts.
  "spa-hn": {
    apps: [
      "hn-spa", "hn-datastar-spa",
      "hn-spa-toggles", "hn-datastar-spa-toggles"
    ],
    pages: { story: "/stories/30186326" }
  },
  "spa-store": {
    apps: ["store-spa", "store-datastar-spa"],
    pages: { listing: "/", product: "/product/1" }
  },
  store: {
    apps: ["store-sc", "store-spa", "store-datastar"],
    pages: { listing: "/", product: "/product/1" }
  },
  // The live table's first load, at 400 rows. A page path of null is each
  // app's own page (the SPA lives at /spa). No row changes
  // (DBMON_MUTATIONS=0): with the table ticking, Lighthouse's trace runs
  // until its load timeout and its TBT counts seconds of live updates, not
  // the load. dbmon-load.mjs times the load with the table live.
  dbmon: {
    apps: ["dbmon-solid", "dbmon-spa", "dbmon-hypermedia-rows", "dbmon-hypermedia-signals"],
    pages: { table: null },
    env: { DBMON_ROWS: "200", DBMON_MUTATIONS: "0", DBMON_FPS: "5" }
  }
};

const [setName = "hn", roundsArg = "15", outArg] = process.argv.slice(2);
const set = SETS[setName];
if (!set) throw new Error(`unknown set ${setName}; one of ${Object.keys(SETS)}`);
const out = outArg ?? new URL(`../results/${setName}`, import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });

const servers = [];
for (const app of set.apps) servers.push(await start(app, set.env));

async function once(target, file) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    headless: true,
    args: ["--no-sandbox"]
  });
  try {
    const page = await browser.newPage();
    const result = await lighthouse(
      target,
      { onlyCategories: ["performance"], output: "json", logLevel: "error" },
      undefined,
      page
    );
    fs.writeFileSync(file, result.report);
    const a = result.lhr.audits;
    const n = k => Math.round(a[k].numericValue);
    const items = a["network-requests"].details.items;
    const kb = type => Math.round(items.filter(x => x.resourceType === type).reduce((s, x) => s + x.transferSize, 0) / 100) / 10;
    return {
      score: Math.round(result.lhr.categories.performance.score * 100),
      fcp: n("first-contentful-paint"),
      lcp: n("largest-contentful-paint"),
      tbt: n("total-blocking-time"),
      cls: +a["cumulative-layout-shift"].numericValue.toFixed(3),
      totalKB: Math.round(a["total-byte-weight"].numericValue / 1000),
      docKB: kb("Document"),
      jsKB: kb("Script")
    };
  } finally {
    await browser.close();
  }
}

const runs = [];
try {
  for (let round = 1; round <= +roundsArg; round++)
    for (const [page, path] of Object.entries(set.pages))
      for (const app of set.apps) {
        const r = await once(direct(app) + (path ?? APPS[app].path ?? "/"), `${out}/${app}-${page}-${round}.json`);
        const row = { round, app, page, ...r };
        runs.push(row);
        console.log(JSON.stringify(row));
        fs.appendFileSync(`${out}/runs.jsonl`, JSON.stringify(row) + "\n");
      }
} finally {
  for (const s of servers) await stop(s);
}

const med = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
console.log("\n| page | app | runs | score | TBT ms | FCP ms | LCP ms | CLS | total kB | doc kB | JS kB |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const page of Object.keys(set.pages))
  for (const app of set.apps) {
    const rs = runs.filter(r => r.app === app && r.page === page);
    const m = k => med(rs.map(r => r[k]));
    console.log(`| ${page} | ${app} | ${rs.length} | ${m("score")} | ${m("tbt")} | ${m("fcp")} | ${m("lcp")} | ${m("cls")} | ${m("totalKB")} | ${m("docKB")} | ${m("jsKB")} |`);
  }
