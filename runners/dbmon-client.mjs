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
//
// After the measured window, a 4 s trace splits the main thread into the
// stack's own work (`framework`: script, HTML parsing, GC) and the browser's
// work on the table (`browser`: style, layout, paint), in ms/s. Then the
// simulation is paused and every row on the page is checked against the
// server's (`wrongRows`, of `checkedRows`).
//
// heapMB is the page's live JS heap after a forced GC at the end of the
// measured window, and heapGrowthMB how much that grew over the window (a
// page holding on to every update grows; one that lets them go stays flat).
//
// LAYOUT=fixed adds `table { table-layout: fixed }` to every page, to show
// how much of each column is the table's own layout.
import { start, stop, page as pageUrl, cpuMs, launch, checkRows } from "./apps.mjs";
import { traceWindow } from "./trace.mjs";

const [rows = "400", change = "0.1", tps = "5", rate = "4", rounds = "3", secs = "10"] = process.argv.slice(2);
const env = { DBMON_ROWS: String(+rows / 2), DBMON_MUTATIONS: change, DBMON_FPS: tps };

async function once(name) {
  const server = await start(name, env);
  const browser = await launch();
  const out = { app: name, rows: +rows, change: +change, ticksPerSec: +tps, cpuRate: +rate, ...(process.env.LAYOUT ? { layout: process.env.LAYOUT } : {}) };
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: +rate });
    let wire = 0;
    cdp.on("Network.dataReceived", e => (wire += e.encodedDataLength));
    const tLoad = Date.now();
    await page.goto(pageUrl(name), { waitUntil: "commit" });
    // Ask the page a trivial question; a frozen main thread never answers.
    const ping = ms =>
      Promise.race([page.evaluate(() => document.querySelectorAll("td.dbname").length), new Promise(r => setTimeout(() => r(-1), ms))]);
    const froze = () => ({ ...out, froze: true, frozeAfterSec: +((Date.now() - tLoad) / 1000).toFixed(1) });
    // The first table may take a while on a client-rendered page (a
    // Datastar SPA renders the whole table in one task), so the wait for it
    // allows 30 s; firstTableSec says when it showed.
    for (let rows = 0; rows <= 0; ) {
      if (Date.now() - tLoad > 30000) return { ...out, noTable: true };
      rows = await ping(30000);
      if (rows === -1) return froze();
      if (!rows) await page.waitForTimeout(200);
    }
    if (process.env.LAYOUT === "fixed") await page.addStyleTag({ content: "table { table-layout: fixed }" });
    out.firstTableSec = +((Date.now() - tLoad) / 1000).toFixed(1);
    await page.waitForTimeout(1500);
    if ((await ping(5000)) === -1) return froze();
    await page.evaluate(() => {
      window.__t = 0;
      new MutationObserver(() => window.__t++).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await cdp.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    const heap = async () => (await cdp.send("HeapProfiler.collectGarbage"), (await metrics()).JSHeapUsedSize);
    const h0 = await heap();
    const m0 = await metrics(), c0 = cpuMs(server.pid), w0 = wire, t0 = Date.now();
    for (let i = 0; i < +secs; i++) {
      await page.waitForTimeout(1000);
      if ((await ping(5000)) === -1) return froze();
    }
    const m1 = await metrics(), c1 = cpuMs(server.pid), dt = (Date.now() - t0) / 1000;
    const ticks = await page.evaluate(() => window.__t);
    const h1 = await heap();
    const result = {
      ...out,
      appliedPerSec: +(ticks / dt).toFixed(1),
      clientBusyMsPerSec: Math.round(((m1.TaskDuration - m0.TaskDuration) * 1000) / dt),
      serverCpuMsPerSec: Math.round((c1 - c0) / dt),
      wireKBPerSec: +((wire - w0) / 1024 / dt).toFixed(1),
      heapMB: +(h1 / 2 ** 20).toFixed(1),
      heapGrowthMB: +((h1 - h0) / 2 ** 20).toFixed(1)
    };
    const t = await traceWindow(cdp, page, 4000);
    const { rows: checkedRows, wrong: wrongRows } = await checkRows(name, page);
    return {
      ...result,
      frameworkMsPerSec: t.framework,
      browserMsPerSec: t.browser,
      trace: { script: t.script, parse: t.parse, gc: t.gc, style: t.style, layout: t.layout, paint: t.paint },
      checkedRows,
      wrongRows
    };
  } finally {
    await browser.close();
    await stop(server);
  }
}

// APPS=a,b limits the run to those apps.
const names = process.env.APPS
  ? process.env.APPS.split(",")
  : ["dbmon-solid", "dbmon-spa", "dbmon-hypermedia", "dbmon-hypermedia-rows", "dbmon-hypermedia-replace", "dbmon-hypermedia-signals"];
for (let r = 1; r <= +rounds; r++)
  for (const n of names) console.log(JSON.stringify({ round: r, ...(await once(n)) }));
