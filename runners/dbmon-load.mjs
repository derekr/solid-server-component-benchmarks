// The live table's first load: what each app ships and how soon the table is
// on screen and live. Cold browser each round, 4x CPU by default.
//
// usage: node dbmon-load.mjs [rows=400] [cpuRate=4] [rounds=5]
//
// "table" is the first animation frame with a row on the page; "live" is the
// first change to a row after that (the update stream connected and applied).
// "busy" is main-thread task time from navigation to live. Bytes are what
// crossed the wire (brotli), by resource type. heapMB is the live JS heap
// once the table is live, after a forced GC.
import { start, stop, page as pageUrl, launch } from "./apps.mjs";

const [rows = "400", rate = "4", rounds = "5"] = process.argv.slice(2);
const env = { DBMON_ROWS: String(+rows / 2), DBMON_MUTATIONS: "0.1", DBMON_FPS: "5" };

async function once(name) {
  const server = await start(name, env);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: +rate });
    // Bytes per request: the finished length when it finishes, else (a
    // stream still open) what has arrived so far.
    const reqs = new Map();
    const req = id => reqs.get(id) ?? reqs.set(id, { type: "other", got: 0, done: 0 }).get(id);
    cdp.on("Network.responseReceived", e => (req(e.requestId).type = e.type.toLowerCase()));
    cdp.on("Network.dataReceived", e => (req(e.requestId).got += e.encodedDataLength));
    cdp.on("Network.loadingFinished", e => (req(e.requestId).done = e.encodedDataLength));
    await page.addInitScript(() => {
      const t0 = performance.timeOrigin;
      const frame = () => {
        if (document.querySelector("td.dbname")) {
          window.__table = performance.now();
          new MutationObserver((records, mo) => {
            if (records.some(r => (r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest("tr"))) {
              window.__live = performance.now();
              mo.disconnect();
            }
          }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
        } else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await page.goto(pageUrl(name), { waitUntil: "commit" });
    await page.waitForFunction(() => window.__live, null, { timeout: 30000, polling: 100 });
    const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(x => [x.name, x.value]));
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = (await cdp.send("Performance.getMetrics")).metrics.find(x => x.name === "JSHeapUsedSize").value;
    const { table, live } = await page.evaluate(() => ({ table: window.__table, live: window.__live }));
    const kb = {};
    for (const { type, got, done } of reqs.values()) kb[type] = (kb[type] || 0) + Math.max(got, done) / 1024;
    const r = v => Math.round(v * 10) / 10;
    return {
      app: name,
      rows: +rows,
      cpuRate: +rate,
      tableMs: Math.round(table),
      liveMs: Math.round(live),
      busyMs: Math.round(m.TaskDuration * 1000),
      heapMB: r(heap / 2 ** 20),
      htmlKB: r(kb.document || 0),
      jsKB: r(kb.script || 0),
      otherKB: r(Object.entries(kb).reduce((a, [k, v]) => a + (k === "document" || k === "script" ? 0 : v), 0))
    };
  } finally {
    await browser.close();
    await stop(server);
  }
}

const names = process.env.APPS
  ? process.env.APPS.split(",")
  : ["dbmon-solid", "dbmon-spa", "dbmon-hypermedia", "dbmon-hypermedia-rows", "dbmon-hypermedia-replace", "dbmon-hypermedia-signals"];
for (let r = 1; r <= +rounds; r++)
  for (const n of names) console.log(JSON.stringify({ round: r, ...(await once(n)) }));
