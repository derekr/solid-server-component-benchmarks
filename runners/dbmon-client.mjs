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
// "Answering" is a click: once a second the runner presses and releases the
// mouse on the page and times how long the page takes to handle it, as a user
// would feel it (inputMs: median and max over the window). A trivial
// page.evaluate is not a fair check on a saturated page: on the Datastar SPA
// at 2,000 rows it waited 8-30 s while clicks were handled in under 2 s.
//
// After the measured window, a 4 s trace splits the main thread into the
// stack's own work (`framework`: script, HTML parsing, GC) and the browser's
// work on the table (`browser`: style, layout, paint), in ms/s. Then the
// simulation is paused and every row on the page is checked against the
// server's (`wrongRows`, of `checkedRows`).
//
// loadMs is the same run's load (navigation start to the table and to the
// first live change), loaded through the NET profile (apps.mjs); the
// measured window comes after it and is steady state.
//
// heapMB is the page's live JS heap after a forced GC at the end of the
// measured window, and heapGrowthMB how much that grew over the window (a
// page holding on to every update grows; one that lets them go stays flat).
//
// LAYOUT=fixed adds `table { table-layout: fixed }` to every page, to show
// how much of each column is the table's own layout.
import { start, stop, page as pageUrl, cpuMs, launch, checkRows, liveTimer, netLabel } from "./apps.mjs";
import { traceWindow } from "./trace.mjs";

const [rows = "400", change = "0.1", tps = "5", rate = "4", rounds = "3", secs = "10"] = process.argv.slice(2);
const env = { DBMON_ROWS: String(+rows / 2), DBMON_MUTATIONS: change, DBMON_FPS: tps };

async function once(name) {
  const server = await start(name, env);
  const browser = await launch();
  const out = { app: name, rows: +rows, change: +change, ticksPerSec: +tps, cpuRate: +rate, net: netLabel(), ...(process.env.LAYOUT ? { layout: process.env.LAYOUT } : {}) };
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: +rate });
    let wire = 0;
    cdp.on("Network.dataReceived", e => (wire += e.encodedDataLength));
    await page.addInitScript(liveTimer);
    const tLoad = Date.now();
    await page.goto(pageUrl(name), { waitUntil: "commit" });
    // Ask the page a trivial question; a frozen main thread never answers.
    const ping = ms =>
      Promise.race([page.evaluate(() => document.querySelectorAll("td.dbname").length), new Promise(r => setTimeout(() => r(-1), ms))]);
    const froze = () => ({ ...out, froze: true, frozeAfterSec: +((Date.now() - tLoad) / 1000).toFixed(1) });
    // A click in the page's top-left corner, timed until the page has handled
    // it; -1 if that takes `ms` or more.
    const click = async ms => {
      const t = Date.now();
      const press = (async () => {
        for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x: 2, y: 2, button: "left", clickCount: 1 });
      })();
      const done = await Promise.race([press.then(() => true), new Promise(r => setTimeout(() => r(false), ms))]);
      return done ? Date.now() - t : -1;
    };
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
    if ((await click(5000)) === -1) return froze();
    await page.evaluate(() => {
      window.__t = 0;
      new MutationObserver(() => window.__t++).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    // The load, from the same run (the measured window below is steady
    // state, after it): ms from navigation start to the table, and to live.
    const load = await page.evaluate(() => ({ table: window.__table, live: window.__live }));
    out.loadMs = { table: Math.round(load.table), live: load.live == null ? null : Math.round(load.live) };
    await cdp.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    const heap = async () => (await cdp.send("HeapProfiler.collectGarbage"), (await metrics()).JSHeapUsedSize);
    const h0 = await heap();
    const m0 = await metrics(), c0 = cpuMs(server.pid), w0 = wire, t0 = Date.now();
    const input = [];
    for (let i = 0; i < +secs; i++) {
      await page.waitForTimeout(1000);
      const ms = await click(5000);
      if (ms === -1) return froze();
      input.push(ms);
    }
    input.sort((a, b) => a - b);
    const m1 = await metrics(), c1 = cpuMs(server.pid), dt = (Date.now() - t0) / 1000;
    // A page that's still busy with a backlog may not answer the page.evaluate
    // and DevTools calls below for a long time, so they get 60 s, and the run
    // reports what it has if they don't answer (`stuck`).
    const within = (p, ms = 60000) => Promise.race([p, new Promise(r => setTimeout(() => r(within.late), ms))]);
    within.late = Symbol("late");
    const ticks = await within(page.evaluate(() => window.__t));
    const h1 = ticks === within.late ? within.late : await within(heap());
    const late = (partial) => ({ ...partial, stuck: true });
    if (ticks === within.late || h1 === within.late)
      return late({ ...out, clientBusyMsPerSec: Math.round(((m1.TaskDuration - m0.TaskDuration) * 1000) / dt), inputMs: { median: input[input.length >> 1], max: input.at(-1) } });
    const result = {
      ...out,
      appliedPerSec: +(ticks / dt).toFixed(1),
      clientBusyMsPerSec: Math.round(((m1.TaskDuration - m0.TaskDuration) * 1000) / dt),
      serverCpuMsPerSec: Math.round((c1 - c0) / dt),
      wireKBPerSec: +((wire - w0) / 1024 / dt).toFixed(1),
      inputMs: { median: input[input.length >> 1], max: input.at(-1) },
      heapMB: +(h1 / 2 ** 20).toFixed(1),
      heapGrowthMB: +((h1 - h0) / 2 ** 20).toFixed(1)
    };
    // On a saturated page the trace can come back without its marks; the run
    // then reports what it has (`traceFailed`).
    const t = await within(traceWindow(cdp, page, 4000).catch(() => null));
    if (t === within.late) return late(result);
    if (!t) return { ...result, traceFailed: true };
    // The settle gives a page at 2,000 rows and 4x time to apply what it has.
    const checked = await within(checkRows(name, page, 10000), 90000);
    if (checked === within.late) return late(result);
    const { rows: checkedRows, wrong: wrongRows } = checked;
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
