// The store's quick add, from the click: how soon the button shows that
// something is happening ("feedback": its label changes, to "Adding…" while
// a request is in flight or "Added ✓"), and how soon the header's cart count
// changes ("cart"). Times are to the first animation frame where each is on
// the page, from pointerdown.
//
// The Solid twins keep the cart in a client signal and never call the
// server, so both land in the click's frame. The Datastar store POSTs the
// add, shows "Adding…" from a local signal meanwhile, and changes the count
// when the server's patch arrives, so its cart time includes a round trip.
//
// usage: node store-add.mjs [rounds=7] [rttMs=0,150] [cpuRate=4] [apps=store-sc,store-spa,store-datastar]
import { start, stop, url, launch } from "./apps.mjs";

const ROUNDS = Number(process.argv[2] || 7);
const RTTS = (process.argv[3] || "0,150").split(",").map(Number);
const RATE = Number(process.argv[4] || 4);
const NAMES = (process.argv[5] || "store-sc,store-spa,store-datastar").split(",");
const TILE = ".grid .product:nth-child(5) .add";

async function once(browser, name, rtt) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: rtt, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  await page.goto(url(name) + "/", { waitUntil: "load" });
  await page.waitForTimeout(2000); // hydrated, and Datastar started
  await page.evaluate(sel => {
    const button = document.querySelector(sel);
    const badge = () => document.querySelector(".cart-badge").textContent;
    const label = button.textContent;
    const count = badge();
    window.__add = new Promise(resolve => {
      addEventListener(
        "pointerdown",
        () => {
          const t0 = performance.now();
          const out = {};
          const frame = () => {
            const now = performance.now() - t0;
            if (out.feedbackMs == null && document.querySelector(sel).textContent !== label) out.feedbackMs = Math.round(now);
            if (out.cartMs == null && badge() !== count) out.cartMs = Math.round(now);
            if (out.feedbackMs != null && out.cartMs != null) resolve(out);
            else if (now > 10000) resolve(out);
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        },
        { capture: true, once: true }
      );
    });
  }, TILE);
  await page.click(TILE);
  const result = await page.evaluate(() => window.__add);
  await ctx.close();
  return result;
}

for (let round = 1; round <= ROUNDS; round++) {
  for (const name of NAMES) {
    const server = await start(name);
    const browser = await launch();
    try {
      for (const rtt of RTTS) console.log(JSON.stringify({ round, app: name, rttMs: rtt, cpuRate: RATE, ...(await once(browser, name, rtt)) }));
    } finally {
      await browser.close();
      await stop(server);
    }
  }
}
