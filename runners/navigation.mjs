// Client navigation from the feed to the HN story: bytes fetched after the
// click (compressed, as transferred; the data request and any lazily loaded
// code chunks apart) and time until the thread is on screen.
// The server-component apps fetch a frame (markup + slot records); the SPAs
// fetch JSON and render it on the client.
//
// usage: node navigation.mjs [runs=5] [apps=hn-sc,hn-spa,hn-sc-toggles,hn-spa-toggles] [cpuRate=1]
//
// The feed page reads the live HN API; if that is unreachable the feed shows
// its error state, but the app is still running and the story itself comes
// from the cached snapshot, so the navigation measured is the same.
import { chromium } from "playwright";
import { start, stop, url } from "./apps.mjs";

const RUNS = Number(process.argv[2] || 5);
const NAMES = (process.argv[3] || "hn-sc,hn-spa,hn-sc-toggles,hn-spa-toggles").split(",");
const RATE = Number(process.argv[4] || 1);
const STORY = "/stories/30186326";

async function once(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForTimeout(1000);
  let counting = false;
  const reqs = {};
  cdp.on("Network.requestWillBeSent", e => counting && (reqs[e.requestId] = { url: e.request.url, kb: 0 }));
  cdp.on("Network.loadingFinished", e => reqs[e.requestId] && (reqs[e.requestId].kb = e.encodedDataLength / 1000));
  counting = true;
  const painted = await page.evaluate(async story => {
    const a = document.createElement("a");
    a.href = story;
    document.body.appendChild(a);
    const t0 = performance.now();
    a.click();
    await new Promise(res => {
      (function poll() {
        if (document.querySelectorAll(".comment").length > 1000) res();
        else requestAnimationFrame(poll);
      })();
    });
    return performance.now() - t0;
  }, STORY);
  await page.waitForTimeout(1500);
  await ctx.close();
  const list = Object.values(reqs);
  return {
    paintedMs: Math.round(painted),
    dataKB: +list.filter(r => !/\/assets\//.test(r.url)).reduce((s, r) => s + r.kb, 0).toFixed(1),
    codeKB: +list.filter(r => /\/assets\//.test(r.url)).reduce((s, r) => s + r.kb, 0).toFixed(1),
    requests: list.map(r => r.url.replace(base, "").slice(0, 60))
  };
}

const servers = [];
for (const n of NAMES) servers.push(await start(n));
const browser = await chromium.launch();
const runs = Object.fromEntries(NAMES.map(n => [n, []]));
try {
  for (const n of NAMES) await once(browser, url(n)); // warm-up
  for (let i = 0; i < RUNS; i++) for (const n of NAMES) runs[n].push(await once(browser, url(n)));
} finally {
  await browser.close();
  for (const s of servers) await stop(s);
}
const med = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
console.log(`client navigation to the story, cpu ${RATE}x, ${RUNS} runs, medians`);
for (const n of NAMES)
  console.log(
    n.padEnd(16),
    `data ${med(runs[n].map(r => r.dataKB))} kB + lazy code ${med(runs[n].map(r => r.codeKB))} kB, on screen ${med(runs[n].map(r => r.paintedMs))} ms,`,
    `requests: ${runs[n][0].requests.join(" ")}`
  );
