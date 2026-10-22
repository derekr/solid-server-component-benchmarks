// Server CPU as viewers are added to the live table. Viewers are plain HTTP
// stream readers that keep the bytes compressed (no browser), so all that is
// measured is what the server spends per viewer: rendering, diffing and
// per-connection brotli.
//
// usage: node dbmon-viewers.mjs [viewers=1,10,25,50,100] [rounds=3] [rows=400] [change=0.1] [ticksPerSec=5]
//
// Reads the server process's user+system CPU from /proc over 10 s after a
// 4 s warm-up (Linux only).
import http from "node:http";
import { APPS, start, stop, cpuMs } from "./apps.mjs";

const [list = "1,10,25,50,100", rounds = "3", rows = "400", change = "0.1", tps = "5"] = process.argv.slice(2);
const env = { DBMON_ROWS: String(+rows / 2), DBMON_MUTATIONS: change, DBMON_FPS: tps };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function once(name, n) {
  const app = APPS[name];
  const server = await start(name, env);
  let bytes = 0;
  const reqs = [];
  for (let i = 0; i < n; i++)
    reqs.push(
      http.get({ host: "localhost", port: app.port, path: app.stream, headers: { "accept-encoding": "br" } }, res =>
        res.on("data", c => (bytes += c.length))
      )
    );
  try {
    await sleep(4000);
    const c0 = cpuMs(server.pid), b0 = bytes, t0 = Date.now();
    await sleep(10000);
    const dt = (Date.now() - t0) / 1000;
    const ms = (cpuMs(server.pid) - c0) / dt;
    return {
      app: name,
      viewers: n,
      serverCpuMsPerSec: Math.round(ms),
      wireKBPerSecPerViewer: +((bytes - b0) / 1024 / dt / n).toFixed(1)
    };
  } finally {
    reqs.forEach(r => r.destroy());
    await stop(server);
    await sleep(500);
  }
}

for (let r = 1; r <= +rounds; r++)
  for (const n of list.split(",").map(Number))
    for (const name of process.env.APPS ? process.env.APPS.split(",") : ["dbmon-solid", "dbmon-spa", "dbmon-hypermedia", "dbmon-hypermedia-rows"]) console.log(JSON.stringify({ round: r, ...(await once(name, n)) }));
