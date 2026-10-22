// The live table from one viewer's side: how many ticks the page actually
// applies, how busy its main thread is, and what crosses the wire. Both
// stacks run the same simulation (apps/*/databases), so the offered load is
// identical.
//
// usage: node dbmon-client.mjs [rows=400] [change=0.1] [ticksPerSec=5] [cpuRate=4] [rounds=3] [secs=10]
//   rows: table rows (each cluster is a primary and a replica row)
//
// "applied/s" counts MutationObserver batches, which is approximately ticks
// applied. Both pages are server-rendered, so the table shows at once; a page
// whose main thread then stops answering for 5 s or more (patches arriving
// faster than it can apply them) is reported as "froze", with when.
import { chromium } from "playwright";
import { start, stop, url, cpuMs } from "./apps.mjs";

const [rows = "400", change = "0.1", tps = "5", rate = "4", rounds = "3", secs = "10"] = process.argv.slice(2);
const env = { DBMON_ROWS: String(+rows / 2), DBMON_MUTATIONS: change, DBMON_FPS: tps };

async function once(name) {
  const server = await start(name, env);
  const browser = await chromium.launch();
  const out = { app: name, rows: +rows, change: +change, ticksPerSec: +tps, cpuRate: +rate };
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: +rate });
    let wire = 0;
    cdp.on("Network.dataReceived", e => (wire += e.encodedDataLength));
    const tLoad = Date.now();
    await page.goto(url(name) + "/", { waitUntil: "commit" });
    // Ask the page a trivial question; a frozen main thread never answers.
    const ping = ms =>
      Promise.race([page.evaluate(() => document.querySelectorAll("td.dbname").length), new Promise(r => setTimeout(() => r(-1), ms))]);
    const froze = () => ({ ...out, froze: true, frozeAfterSec: +((Date.now() - tLoad) / 1000).toFixed(1) });
    for (let rows = 0; rows <= 0; ) {
      if (Date.now() - tLoad > 15000) return { ...out, noTable: true };
      rows = await ping(5000);
      if (rows === -1) return froze();
      if (!rows) await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1500);
    if ((await ping(5000)) === -1) return froze();
    await page.evaluate(() => {
      window.__t = 0;
      new MutationObserver(() => window.__t++).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await cdp.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    const m0 = await metrics(), c0 = cpuMs(server.pid), w0 = wire, t0 = Date.now();
    for (let i = 0; i < +secs; i++) {
      await page.waitForTimeout(1000);
      if ((await ping(5000)) === -1) return froze();
    }
    const m1 = await metrics(), c1 = cpuMs(server.pid), dt = (Date.now() - t0) / 1000;
    const ticks = await page.evaluate(() => window.__t);
    return {
      ...out,
      appliedPerSec: +(ticks / dt).toFixed(1),
      clientBusyMsPerSec: Math.round(((m1.TaskDuration - m0.TaskDuration) * 1000) / dt),
      serverCpuMsPerSec: Math.round((c1 - c0) / dt),
      wireKBPerSec: +((wire - w0) / 1024 / dt).toFixed(1)
    };
  } finally {
    await browser.close();
    await stop(server);
  }
}

// APPS=a,b limits the run to those apps.
const names = process.env.APPS ? process.env.APPS.split(",") : ["dbmon-solid", "dbmon-hypermedia", "dbmon-hypermedia-rows"];
for (let r = 1; r <= +rounds; r++)
  for (const n of names) console.log(JSON.stringify({ round: r, ...(await once(n)) }));
