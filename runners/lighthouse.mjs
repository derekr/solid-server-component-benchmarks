// Lighthouse 12, performance category, default mobile preset (simulated slow
// 4G, 4x CPU). One fresh headless Chromium per run, and every page in a set
// runs once per round, so slow stretches of the machine hit all of them.
//
// usage: node lighthouse.mjs <set> [rounds=15] [outDir=results/<set>]
//   sets: hn (story page, toggles), hn-details (story page, <details>), store (listing + product)
//
// Prints one JSON line per run and a median table at the end; the raw
// Lighthouse reports land in outDir.
import fs from "node:fs";
import lighthouse from "lighthouse";
import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import { start, stop, url } from "./apps.mjs";

const SETS = {
  hn: {
    apps: ["hn-sc-toggles", "hn-spa-toggles"],
    pages: { story: "/stories/30186326" }
  },
  "hn-details": {
    apps: ["hn-sc", "hn-spa"],
    pages: { story: "/stories/30186326" }
  },
  store: {
    apps: ["store-sc", "store-spa"],
    pages: { listing: "/", product: "/product/1" }
  }
};

const [setName = "hn", roundsArg = "15", outArg] = process.argv.slice(2);
const set = SETS[setName];
if (!set) throw new Error(`unknown set ${setName}; one of ${Object.keys(SETS)}`);
const out = outArg ?? new URL(`../results/${setName}`, import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });

const servers = [];
for (const app of set.apps) servers.push(await start(app));

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
        const r = await once(url(app) + path, `${out}/${app}-${page}-${round}.json`);
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
