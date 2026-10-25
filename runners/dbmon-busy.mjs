// Does a faster server reach the browser? The live table under load: N
// background viewers on one server, and one measured viewer.
//
// usage: node dbmon-busy.mjs <app,app,...> [viewers=1,50,100,250,500] [rows=400] [scrollsPerSec=4] [rounds=1]
//
// Background viewers run in a separate process: plain HTTP stream readers
// (brotli, not decoded). On a server-windowed app each one also scrolls,
// `scrollsPerSec` times a second to a random place, so the server renders
// slices for them the way it would for people using it: a POST /view on
// the Datastar windows, a new live connection for the slice's grid cell on
// the Solid server-component window. The SPA window's viewers only read,
// since its scrolling never reaches the server.
//
// The measured viewer:
//   live tables (Datastar's whole, rows, replace, signals; Solid and the
//     SPA): a probe reader decodes its own stream and
//     notes when each tick's event arrives; tickMs is arrival minus when the
//     server's simulation ticked (/__dbmon/ticks), p50/p95/p99/max. Same
//     machine, same clock.
//   window apps (the Datastar windows, the SPA and server-component
//     windows): a browser (1x CPU, no added latency) jumps 20 times to
//     unseen rows; jumpMs is from setting scrollTop until the new rows are
//     on the page, p50/p95/max. That is the server's /view handling, the
//     slice render and the push, plus the client's patch.
// Server CPU over the same 10 s. SERVER_CPUS=2,3 pins the server to cores.
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { APPS, start, stop, cpuMs, launch } from "./apps.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- background viewers (child process): node dbmon-busy.mjs --viewers port n scrollsPerSec rows stream ----
if (process.argv[2] === "--viewers") {
  const [port, n, sps, rows] = process.argv.slice(3, 7).map(Number);
  const stream = process.argv[7];
  const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
  // A Solid server-component slice: its stream URL carries the cell.
  const slice = stream.includes("?args=");
  const open = path => {
    const req = http.get({ host: "localhost", port, path, headers: { "accept-encoding": "br" } }, res => res.resume());
    req.on("error", () => {});
    return req;
  };
  for (let i = 0; i < n; i++) {
    const cid = "bg" + i;
    const q = encodeURIComponent(JSON.stringify({ cid, offset: 0 }));
    let current = open(stream === "/updates" ? `/updates?datastar=${q}` : stream);
    if (sps > 0 && slice)
      setTimeout(
        () =>
          setInterval(() => {
            current.destroy();
            const cell = Math.floor(Math.random() * ((rows - 40) / 20)) * 20;
            current = open(stream.replace(/\?args=.*/, "?args=" + encodeURIComponent(JSON.stringify([cell, 1]))));
          }, 1000 / sps),
        Math.random() * (1000 / sps)
      );
    else if (sps > 0)
      setTimeout(
        () =>
          setInterval(() => {
            const body = JSON.stringify({ cid, offset: Math.floor(Math.random() * (rows - 40)) });
            const req = http.request({ host: "localhost", port, path: "/view", method: "POST", agent, headers: { "content-type": "application/json" } }, res => res.resume());
            req.on("error", () => {});
            req.end(body);
          }, 1000 / sps),
        Math.random() * (1000 / sps)
      );
  }
  process.stdout.write("ready\n");
  setInterval(() => {}, 1e6);
} else {
  const [list, viewersArg = "1,50,100,250,500", rows = "400", sps = "4", rounds = "1"] = process.argv.slice(2);
  const env = { DBMON_ROWS: String(+rows / 2), DBMON_MUTATIONS: "0.1", DBMON_FPS: "5" };
  const pct = (xs, p) => Math.round(xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]);

  // Reads one stream, decoded, and notes the arrival time of every event
  // (Datastar's `event:` blocks; Solid's `data:` blocks, but not the
  // server-component stream's opening `start`).
  function probe(port, path) {
    const arrivals = [];
    const req = http.get({ host: "localhost", port, path, headers: { "accept-encoding": "br" } }, res => {
      const dec = res.headers["content-encoding"] === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
      let buf = "";
      dec.on("data", d => {
        const now = Date.now();
        buf += d;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          // (the Go SDK ends an event with a third newline)
          const ev = buf.slice(0, i).replace(/^\n+/, "");
          if (/^(event|data): /m.test(ev) && !ev.startsWith('data: {"type":"start"')) arrivals.push(now);
          buf = buf.slice(i + 2);
        }
      });
      dec.on("error", () => {});
    });
    req.on("error", () => {});
    return { arrivals, close: () => req.destroy() };
  }

  const blankPx = () => {
    const vp = document.getElementById("viewport"), t = document.getElementById("dbmon");
    const top = parseFloat(t.style.top) || 0, bottom = top + t.querySelectorAll("tr").length * 37;
    const a = vp.scrollTop, b = a + vp.clientHeight;
    return Math.max(0, top - a) + Math.max(0, b - bottom) - Math.max(0, top - b) - Math.max(0, a - bottom);
  };

  async function jumps(port, path) {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}${path}`, { waitUntil: "commit" });
      await page.waitForSelector("td.dbname", { timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.evaluate(`window.__blank = ${blankPx}`);
      const out = [];
      for (let i = 1; i <= 20; i++) {
        const to = Math.floor(((i * 0.37) % 1) * (+rows - 40));
        out.push(
          await page.evaluate(
            to =>
              new Promise(resolve => {
                const t0 = performance.now();
                document.getElementById("viewport").scrollTop = to * 37;
                // Rows that haven't come after 10 s count as 10 s.
                const check = () => (window.__blank() === 0 || performance.now() - t0 > 10000 ? resolve(performance.now() - t0) : requestAnimationFrame(check));
                requestAnimationFrame(check);
              }),
            to
          )
        );
        await page.waitForTimeout(250);
      }
      return out.sort((a, b) => a - b);
    } finally {
      await browser.close();
    }
  }

  async function once(name, n) {
    const app = APPS[name];
    const isWindow = app.env?.PATCH === "window" || app.path === "/spa-window" || app.path === "/sc-window";
    // The SPA window never asks the server for rows when it scrolls.
    const scrolls = app.env?.PATCH === "window" || app.path === "/sc-window" ? sps : 0;
    const server = await start(name, env);
    const bg = spawn(process.execPath, [fileURLToPath(import.meta.url), "--viewers", app.port, n, scrolls, rows, app.stream], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise(r => bg.stdout.once("data", r));
    try {
      await sleep(3000);
      const out = { app: name, viewers: n, rows: +rows, ...(isWindow ? { scrollsPerSec: scrolls } : {}) };
      const c0 = cpuMs(server.pid), t0 = Date.now();
      if (isWindow) {
        // A server too busy to serve the page in 30 s is a result, not a crash.
        const j = await jumps(app.port, app.path ?? "/").catch(e => (e.name === "TimeoutError" ? null : Promise.reject(e)));
        if (j) out.jumpMs = { p50: pct(j, 0.5), p95: pct(j, 0.95), max: Math.round(j.at(-1)) };
        else out.pageTimedOut = true;
      } else {
        const tProbe = Date.now();
        const p = probe(app.port, app.stream);
        await sleep(10000);
        await fetch(`http://localhost:${app.port}/__dbmon/pause`);
        // Let what the server still owes arrive: until nothing new for 1 s (at most 20 s).
        for (let last = -1, i = 0; last !== p.arrivals.length && i < 20; i++) (last = p.arrivals.length), await sleep(1000);
        p.close();
        const ticks = await (await fetch(`http://localhost:${app.port}/__dbmon/ticks`)).json();
        // The first event is the snapshot; each after it is one tick, so the
        // last K events are the last K ticks.
        const ev = p.arrivals.slice(1), k = Math.min(ev.length, ticks.length);
        const lat = ev.slice(-k).map((t, i) => t - ticks[ticks.length - k + i]).sort((a, b) => a - b);
        out.ticks = k;
        // Ticks the probe should have had vs events it got: under 1, the
        // server merged or dropped ticks to catch up (saturated), and the
        // latencies below no longer line up with their ticks.
        out.delivered = +(ev.length / ticks.filter(t => t > tProbe + 50).length).toFixed(2);
        out.tickMs = { p50: pct(lat, 0.5), p95: pct(lat, 0.95), p99: pct(lat, 0.99), max: lat.at(-1) };
      }
      out.serverCpuMsPerSec = Math.round((cpuMs(server.pid) - c0) / ((Date.now() - t0) / 1000));
      return out;
    } finally {
      bg.kill();
      await stop(server);
      await sleep(500);
    }
  }

  for (let r = 1; r <= +rounds; r++)
    for (const n of viewersArg.split(",").map(Number))
      for (const name of list.split(",")) console.log(JSON.stringify({ round: r, ...(await once(name, n)) }));
}
