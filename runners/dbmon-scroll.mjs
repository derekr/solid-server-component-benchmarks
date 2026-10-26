// The windowed live tables while you scroll. The SPA window has every row
// already; the Datastar windows and the Solid server-component window ask
// the server for theirs, so this runs behind the shared network profile
// (apps.mjs), whose proxy holds every chunk for half the round trip each
// way, including the patches pushed down an open stream.
//
// usage: node dbmon-scroll.mjs [rows=2000] [rttMs=NET's] [cpuRate=4] [pxPerSec=3600]
//   rttMs sets the round trip for this run (the bandwidth stays NET's).
//
// fling: scrolls down at a steady `pxPerSec` (3,600 px/s is 60 px a frame)
//   for 3 s and checks every frame how much of the viewport has no rendered
//   row under it: `coveredPct` of frames fully covered, mean and max blank px.
// jump: 10 jumps to unseen places; ms until the rows for the new position
//   are on the page (median, max).
// flingKB, jumpsKB: what crossed the wire (compressed) during each.
//
// LAYOUT=fixed adds `table { table-layout: fixed }`, as in dbmon-client.
import { NET, setNet, start, stop, launch, page as pageUrl } from "./apps.mjs";

const [rows = "2000", rttArg, rate = "4", speed = "3600"] = process.argv.slice(2);
if (rttArg != null) setNet(`${rttArg},${NET?.mbps ?? 0}`);
const rtt = NET?.rttMs ?? 0;
const env = { DBMON_ROWS: String(+rows / 2), DBMON_MUTATIONS: "0.1", DBMON_FPS: "5", ...(process.env.DBMON_OVERSCAN ? { DBMON_OVERSCAN: process.env.DBMON_OVERSCAN } : {}) };
const ROW_HEIGHT = 37;

// Blank px of the viewport: the parts not under the rendered table.
const blankPx = () => {
  const vp = document.getElementById("viewport"), t = document.getElementById("dbmon");
  const top = parseFloat(t.style.top) || 0, bottom = top + t.querySelectorAll("tr").length * 37;
  const a = vp.scrollTop, b = a + vp.clientHeight;
  return Math.max(0, top - a) + Math.max(0, b - bottom) - Math.max(0, top - b) - Math.max(0, a - bottom);
};

async function once(name) {
  const server = await start(name, env);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: +rate });
    // Bytes on the wire (compressed), every response and stream together.
    await cdp.send("Network.enable");
    let wire = 0;
    cdp.on("Network.dataReceived", e => (wire += e.encodedDataLength));
    await page.goto(pageUrl(name), { waitUntil: "commit" });
    await page.waitForSelector("td.dbname", { timeout: 30000 });
    if (process.env.LAYOUT === "fixed") await page.addStyleTag({ content: "table { table-layout: fixed }" });
    await page.waitForTimeout(2000);
    await page.evaluate(`window.__blank = ${blankPx}`);
    const w0 = wire;
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
    const w1 = wire;
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
    const w2 = wire;
    jumps.sort((a, b) => a - b);
    return {
      app: name,
      rows: +rows,
      rttMs: rtt,
      mbps: NET?.mbps ?? null,
      cpuRate: +rate,
      flingFrames: fling.length,
      coveredPct: Math.round((100 * fling.filter(b => b === 0).length) / fling.length),
      meanBlankPx: Math.round(fling.reduce((a, b) => a + b, 0) / fling.length),
      maxBlankPx: Math.round(Math.max(...fling)),
      jumpMedianMs: Math.round(jumps[jumps.length >> 1]),
      jumpMaxMs: Math.round(jumps.at(-1)),
      // The fling's 3 s plus 1 s after, and the 10 jumps with their pauses:
      // slices, scroll posts and the live updates, all compressed.
      flingKB: +((w1 - w0) / 1024).toFixed(1),
      jumpsKB: +((w2 - w1) / 1024).toFixed(1)
    };
  } finally {
    await browser.close();
    await stop(server);
  }
}

const names = process.env.APPS
  ? process.env.APPS.split(",")
  : ["dbmon-spa-window", "dbmon-sc-window", "dbmon-hypermedia-window", "dbmon-hypermedia-window-overscan20", "dbmon-hypermedia-window-overscan", "dbmon-hypermedia-window-delta", "dbmon-hypermedia-window-get"];
for (const n of names) console.log(JSON.stringify(await once(n)));
