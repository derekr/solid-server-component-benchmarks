// The windowed live tables while you scroll. The SPA window has every row
// already; the Datastar windows and the Solid server-component window ask
// the server for theirs, so this runs behind a
// round trip: a local TCP proxy holds every chunk for half of `rttMs` each
// way. (Chrome's own latency emulation only delays responses, which a
// request answered down an already-open stream skips.)
//
// usage: node dbmon-scroll.mjs [rows=2000] [rttMs=70] [cpuRate=4] [pxPerSec=3600]
//
// fling: scrolls down at a steady `pxPerSec` (3,600 px/s is 60 px a frame)
//   for 3 s and checks every frame how much of the viewport has no rendered
//   row under it: `coveredPct` of frames fully covered, mean and max blank px.
// jump: 10 jumps to unseen places; ms until the rows for the new position
//   are on the page (median, max).
//
// LAYOUT=fixed adds `table { table-layout: fixed }`, as in dbmon-client.
import net from "node:net";
import { APPS, start, stop, launch } from "./apps.mjs";

const [rows = "2000", rtt = "70", rate = "4", speed = "3600"] = process.argv.slice(2);
const env = { DBMON_ROWS: String(+rows / 2), DBMON_MUTATIONS: "0.1", DBMON_FPS: "5", ...(process.env.DBMON_OVERSCAN ? { DBMON_OVERSCAN: process.env.DBMON_OVERSCAN } : {}) };
const ROW_HEIGHT = 37;

function delayProxy(port, target, oneWayMs) {
  const server = net.createServer(client => {
    const upstream = net.connect(target, "localhost");
    const pipe = (from, to) => from.on("data", d => setTimeout(() => to.writable && to.write(d), oneWayMs));
    pipe(client, upstream);
    pipe(upstream, client);
    // A side that closes closes the other after the same delay, so bytes
    // already on their way (an aborted request that was sent) still arrive.
    const later = other => () => setTimeout(() => other.destroy(), oneWayMs);
    client.on("close", later(upstream)).on("error", later(upstream));
    upstream.on("close", later(client)).on("error", later(client));
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

// Blank px of the viewport: the parts not under the rendered table.
const blankPx = () => {
  const vp = document.getElementById("viewport"), t = document.getElementById("dbmon");
  const top = parseFloat(t.style.top) || 0, bottom = top + t.querySelectorAll("tr").length * 37;
  const a = vp.scrollTop, b = a + vp.clientHeight;
  return Math.max(0, top - a) + Math.max(0, b - bottom) - Math.max(0, top - b) - Math.max(0, a - bottom);
};

async function once(name) {
  const server = await start(name, env);
  const proxyPort = APPS[name].port + 1000;
  const proxy = await delayProxy(proxyPort, APPS[name].port, +rtt / 2);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: +rate });
    await page.goto(`http://localhost:${proxyPort}${APPS[name].path ?? "/"}`, { waitUntil: "commit" });
    await page.waitForSelector("td.dbname", { timeout: 30000 });
    if (process.env.LAYOUT === "fixed") await page.addStyleTag({ content: "table { table-layout: fixed }" });
    await page.waitForTimeout(2000);
    await page.evaluate(`window.__blank = ${blankPx}`);
    const fling = await page.evaluate(
      ([speed, ms]) =>
        new Promise(resolve => {
          const vp = document.getElementById("viewport"), blanks = [];
          const t0 = performance.now(), y0 = vp.scrollTop;
          const frame = now => {
            vp.scrollTop = y0 + ((now - t0) * speed) / 1000;
            blanks.push(window.__blank());
            if (now - t0 < ms) requestAnimationFrame(frame);
            else resolve(blanks);
          };
          requestAnimationFrame(frame);
        }),
      [+speed, 3000]
    );
    await page.waitForTimeout(1000);
    const jumps = [];
    for (let i = 1; i <= 10; i++) {
      const to = Math.floor(((i * 0.37) % 1) * (+rows - 40));
      jumps.push(
        await page.evaluate(
          to =>
            new Promise(resolve => {
              const t0 = performance.now();
              document.getElementById("viewport").scrollTop = to * 37;
              const check = () => (window.__blank() === 0 ? resolve(performance.now() - t0) : requestAnimationFrame(check));
              requestAnimationFrame(check);
            }),
          to
        )
      );
      await page.waitForTimeout(500);
    }
    jumps.sort((a, b) => a - b);
    return {
      app: name,
      rows: +rows,
      rttMs: +rtt,
      cpuRate: +rate,
      flingFrames: fling.length,
      coveredPct: Math.round((100 * fling.filter(b => b === 0).length) / fling.length),
      meanBlankPx: Math.round(fling.reduce((a, b) => a + b, 0) / fling.length),
      maxBlankPx: Math.round(Math.max(...fling)),
      jumpMedianMs: Math.round(jumps[jumps.length >> 1]),
      jumpMaxMs: Math.round(jumps.at(-1))
    };
  } finally {
    await browser.close();
    proxy.close();
    await stop(server);
  }
}

const names = process.env.APPS
  ? process.env.APPS.split(",")
  : ["dbmon-spa-window", "dbmon-sc-window", "dbmon-hypermedia-window", "dbmon-hypermedia-window-overscan", "dbmon-hypermedia-window-delta"];
for (const n of names) console.log(JSON.stringify(await once(n)));
