// The live table from one viewer's side: how many ticks the page actually
// applies, how busy its main thread is, and what crosses the wire. Both
// stacks run the same simulation (apps/*/databases), so the offered load is
// identical.
//
// usage: node dbmon-client.mjs [rows=400] [change=0.1] [ticksPerSec=5] [cpuRate=4] [rounds=3] [secs=10]
//   rows: table rows (each cluster is a primary and a replica row)
//
// "applied/s" counts MutationObserver batches, which is approximately ticks
// applied. A page that does not show the table within 15 s is reported as
// "never usable".
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
    await page.goto(url(name) + "/", { waitUntil: "load" });
    try {
      await page.waitForSelector("td.dbname", { timeout: 15000 });
    } catch {
      return { ...out, neverUsable: true };
    }
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__t = 0;
      new MutationObserver(() => window.__t++).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await cdp.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    const m0 = await metrics(), c0 = cpuMs(server.pid), w0 = wire, t0 = Date.now();
    await page.waitForTimeout(+secs * 1000);
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

const names = ["dbmon-solid", "dbmon-hypermedia"];
for (let r = 1; r <= +rounds; r++)
  for (const n of names) console.log(JSON.stringify({ round: r, ...(await once(n)) }));
