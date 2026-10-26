// Where each app lives, which port it serves on, and the environment it is
// measured with. `start(name)` runs the app's built server and resolves once
// it answers; the returned child's pid is what the server-CPU runners read
// (a Go app runs its built binary, so the pid is the server itself).
import { spawn } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../apps/", import.meta.url));

// HN_DELAY_MS: the cached story (30186326) is served after a fixed delay so
// both HN apps stream behind the same data latency.
const HN = { HN_DELAY_MS: "150" };

export const APPS = {
  "hn-sc": { port: 3004, env: HN },
  "hn-spa": { port: 3005, env: HN },
  "hn-sc-toggles": { port: 3006, env: HN },
  "hn-spa-toggles": { port: 3007, env: HN },
  "hn-next-rsc": { port: 3008, env: HN },
  "hn-qwik": { port: 3010, env: HN },
  // Datastar, one server: the whole thread with <details> (as hn-sc), the
  // same with content-visibility, a toggle per comment (as hn-sc-toggles)
  // from one signal and one delegated handler, or a window onto the thread.
  "hn-datastar": { port: 3011, env: HN },
  "hn-datastar-toggles": { dir: "hn-datastar", port: 3012, env: { ...HN, TOGGLES: "signals" } },
  // The <details> page with content-visibility: auto on every top-level
  // thread, so the browser skips rendering the ones off screen.
  "hn-datastar-cv": { dir: "hn-datastar", port: 3009, env: { ...HN, CV: "1" } },
  // The thread as a hypermedia app would ship it: only the comments around
  // the viewport, windowed on the server as it scrolls, collapse instant in
  // CSS. Not like for like with the apps above, which render the whole thread.
  "hn-datastar-window": { dir: "hn-datastar", port: 3019, env: { ...HN, TOGGLES: "window" } },
  "store-sc": { port: 3013 },
  "store-spa": { port: 3014 },
  "store-datastar": { port: 3015 },
  // The store as a Datastar SPA (Rocket).
  "store-datastar-spa": { port: 3066 },
  // The SPAs on Datastar + Rocket: a static shell, JSON from /api, every page
  // rendered in the browser by a Rocket component. TOGGLES=1 is the
  // counterpart of hn-spa-toggles (one delegated click flips a class per toggle).
  "hn-datastar-spa": { port: 3060, env: HN },
  "hn-datastar-spa-toggles": { dir: "hn-datastar-spa", port: 3061, env: { ...HN, TOGGLES: "1" } },
  "dbmon-solid": { port: 3020, stream: "/_server/live/getDatabases-9c9967e7" },
  // The Datastar port in its two styles: the whole table re-sent and morphed
  // every tick, or only the changed rows, each morphed by id (PATCH=rows).
  "dbmon-hypermedia": { port: 3021, stream: "/updates" },
  "dbmon-hypermedia-rows": { dir: "dbmon-hypermedia", port: 3022, stream: "/updates", env: { PATCH: "rows" } },
  // Datastar's other update styles: the changed rows swapped in without a
  // morph (`mode replace`), and the table bound to signals and patched with
  // values (datastar-patch-signals).
  "dbmon-hypermedia-replace": { dir: "dbmon-hypermedia", port: 3025, stream: "/updates", env: { PATCH: "replace" } },
  "dbmon-hypermedia-signals": { dir: "dbmon-hypermedia", port: 3026, stream: "/updates", env: { PATCH: "signals" } },
  // A scrolling viewport that shows 40 rows of the table, the way a
  // hypermedia app would show a big one: the server renders only those.
  "dbmon-hypermedia-window": { dir: "dbmon-hypermedia", port: 3027, stream: "/updates", env: { PATCH: "window" } },
  // The window with latency mitigation from derekr/largediff: 40 rows (about
  // two viewports) rendered above and below what's on screen.
  "dbmon-hypermedia-window-overscan": { dir: "dbmon-hypermedia", port: 3029, stream: "/updates", env: { PATCH: "window", DBMON_OVERSCAN: "40" } },
  // The window with 20 rows above and below, the overscan the Solid
  // server-component window renders, for a like-for-like scroll.
  "dbmon-hypermedia-window-overscan20": { dir: "dbmon-hypermedia", port: 3018, stream: "/updates", env: { PATCH: "window", DBMON_OVERSCAN: "20" } },
  // The same, a scroll sent as only the rows that entered and left.
  "dbmon-hypermedia-window-delta": { dir: "dbmon-hypermedia", port: 3030, stream: "/updates", env: { PATCH: "window", DBMON_OVERSCAN: "40", DBMON_SCROLL_PATCH: "delta" } },
  // The Solid app rendered in the browser from streamed JSON: rows swapped
  // per object (`/spa`) or reconciled into a store by id (`/spa-store`).
  "dbmon-spa": { dir: "dbmon-solid", port: 3023, path: "/spa", stream: "/_server/live/getDatabaseData-84a14cde" },
  // The table as a Datastar SPA (Rocket): signal patches over SSE, rendered
  // in the browser by one data-on-signal-patch on the table.
  "dbmon-datastar-spa": { port: 3064, stream: "/updates" },
  "dbmon-spa-store": { dir: "dbmon-solid", port: 3024, path: "/spa-store", stream: "/_server/live/getDatabaseData-cc45404a" },
  // The SPA as a virtualized list (TanStack Virtual): every row streamed as
  // data, only the rows in the scrolling viewport rendered.
  "dbmon-spa-window": { dir: "dbmon-solid", port: 3028, path: "/spa-window", stream: "/_server/live/getDatabaseData-355d952c" },
  // The live server component windowed on the server, like the Datastar
  // window: a slice per 20-row grid cell, one live connection per cell. The
  // stream here is the first cell's, which every viewer at the top shares.
  "dbmon-sc-window": { dir: "dbmon-solid", port: 3017, path: "/sc-window", stream: "/_server/live/getSlice-bfc5e4b9?args=%5B0%2C0%5D" },
  // The Datastar port again in Go, on the Datastar Go SDK (apps/dbmon-go,
  // `go build -o dbmon-go .`): the same page, events and styles, so each
  // dbmon-go* app is the twin of the dbmon-hypermedia* app with the same
  // suffix. Brotli is the SDK's own (pure-Go andybalholm/brotli); the
  // -cbrotli twins use the C library Node's zlib uses, to separate the
  // language from the compressor.
  ...goApps({
    "": { port: 3031 },
    "-rows": { port: 3032, env: { PATCH: "rows" } },
    "-replace": { port: 3035, env: { PATCH: "replace" } },
    "-signals": { port: 3036, env: { PATCH: "signals" } },
    "-window": { port: 3037, env: { PATCH: "window" } },
    "-window-overscan": { port: 3039, env: { PATCH: "window", DBMON_OVERSCAN: "40" } },
    "-window-delta": { port: 3040, env: { PATCH: "window", DBMON_OVERSCAN: "40", DBMON_SCROLL_PATCH: "delta" } },
    "-cbrotli": { port: 3041, env: { DBMON_BROTLI_IMPL: "cbrotli" } },
    "-rows-cbrotli": { port: 3042, env: { PATCH: "rows", DBMON_BROTLI_IMPL: "cbrotli" } },
    "-signals-cbrotli": { port: 3046, env: { PATCH: "signals", DBMON_BROTLI_IMPL: "cbrotli" } },
    "-window-cbrotli": { port: 3047, env: { PATCH: "window", DBMON_BROTLI_IMPL: "cbrotli" } },
    "-window-overscan-cbrotli": { port: 3049, env: { PATCH: "window", DBMON_OVERSCAN: "40", DBMON_BROTLI_IMPL: "cbrotli" } }
  })
};

function goApps(variants) {
  return Object.fromEntries(
    Object.entries(variants).map(([suffix, app]) => ["dbmon-go" + suffix, { dir: "dbmon-go", cmd: ["./dbmon-go"], stream: "/updates", ...app }])
  );
}

// ---- the network between the browser and the app ----
// Every browser-driven runner loads its pages through a shaping proxy, so a
// measurement includes loading what the page needs: the document, its code
// and styles, data fetches and the update streams. NET=rtt,mbps sets it
// (default 70 ms round trip, 10 Mbit/s each way, shared by every connection
// to the app, as one link is); NET=none loads straight from loopback, as the
// numbers before 2026-10-26 were measured.
//
// The proxy is TCP, under HTTP: it holds each chunk for its time on the link
// and then half the round trip, in both directions, so a patch pushed down an
// already-open stream pays the latency too. (Chrome's own emulation delays
// only responses, which skips everything sent down an open stream.)
export let NET = parseNet(process.env.NET ?? "70,10");
// A runner that sweeps the round trip itself (dbmon-scroll) sets it here.
export const setNet = spec => (NET = parseNet(spec));
function parseNet(spec) {
  if (spec === "none" || spec === "0") return null;
  const [rtt, mbps] = spec.split(",").map(Number);
  return { rttMs: rtt || 0, mbps: mbps || 0 };
}
export const netLabel = () => (NET ? `${NET.rttMs} ms RTT, ${NET.mbps || "unlimited"} Mbit/s` : "loopback");
const PROXY_OFFSET = 1000;

export function shapingProxy(port, target, { rttMs, mbps } = NET ?? {}) {
  // Read when the proxy starts, so a setNet() before start() applies.
  const oneWay = (rttMs || 0) / 2;
  const bytesPerMs = mbps ? (mbps * 1e6) / 8 / 1000 : Infinity;
  // One queue per direction for the whole link: a chunk leaves once the
  // chunks before it (on any connection) have.
  const link = () => {
    let free = 0;
    return (len, send) => {
      const now = performance.now();
      free = Math.max(now, free) + len / bytesPerMs;
      setTimeout(send, free + oneWay - now);
    };
  };
  const down = link(), up = link();
  const sockets = new Set();
  const server = net.createServer(client => {
    const upstream = net.connect(target, "localhost");
    for (const s of [client, upstream]) sockets.add(s), s.on("close", () => sockets.delete(s));
    const pipe = (from, to, dir) => from.on("data", d => dir(d.length, () => to.writable && to.write(d)));
    pipe(client, upstream, up);
    pipe(upstream, client, down);
    // A side that closes closes the other after the same delay, so bytes
    // already on their way (an aborted request that was sent) still arrive.
    const later = (other, dir) => () => dir(0, () => other.destroy());
    client.on("close", later(upstream, up)).on("error", later(upstream, up));
    upstream.on("close", later(client, down)).on("error", later(client, down));
  });
  // close() also drops the connections still open (live streams).
  const close = server.close.bind(server);
  server.close = () => (sockets.forEach(s => s.destroy()), close());
  return new Promise(r => server.listen(port, () => r(server)));
}

// Where the browser loads an app from: through the proxy unless NET=none.
export const url = name => `http://localhost:${APPS[name].port + (NET ? PROXY_OFFSET : 0)}`;
// The app itself, for the runner's own requests (control endpoints, the
// stream readers, Lighthouse, which simulates its own network).
export const direct = name => `http://localhost:${APPS[name].port}`;
// The page an app is measured on.
export const page = name => url(name) + (APPS[name].path ?? "/");

export async function start(name, env = {}) {
  const app = APPS[name];
  if (!app) throw new Error(`unknown app ${name}`);
  // SERVER_CPUS=2,3 pins the server to those cores (taskset execs, so the
  // pid is still the server's), to keep it apart from the browser and runner.
  const [cmd, ...args] = [...(process.env.SERVER_CPUS ? ["taskset", "-c", process.env.SERVER_CPUS] : []), ...(app.cmd ?? ["node", "server.js"])];
  const child = spawn(cmd, args, {
    cwd: root + (app.dir ?? name),
    env: { ...process.env, ...app.env, ...env, PORT: String(app.port) },
    stdio: process.env.SERVER_LOG ? "inherit" : "ignore"
  });
  for (let i = 0; i < 100; i++) {
    let up = false;
    try {
      // HEAD on the page is enough to know the server is up; dbmon's live
      // stream is never touched here.
      await fetch(direct(name) + "/", { method: "HEAD" });
      up = true;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
    if (!up) continue;
    // Answered, but this child has exited: a server left over from an
    // earlier run holds the port, and would be measured instead.
    await new Promise(r => setTimeout(r, 50));
    if (child.exitCode !== null) throw new Error(`${name}: port ${app.port} is held by another process`);
    if (app.stream) await checkStream(name, child);
    if (NET) child.proxy = await shapingProxy(app.port + PROXY_OFFSET, app.port);
    return child;
  }
  child.kill();
  throw new Error(`${name} did not start on ${app.port}`);
}

// The live stream must answer 200: the Solid stream URLs carry a build hash,
// and a stale one would 404 and pass for a very cheap server.
async function checkStream(name, child) {
  const ac = new AbortController();
  const res = await fetch(direct(name) + APPS[name].stream, { signal: ac.signal, headers: { "accept-encoding": "br" } });
  ac.abort();
  if (res.status !== 200) {
    child.kill();
    throw new Error(`${name}: stream ${APPS[name].stream} answered ${res.status} (rebuilt? update its hash in apps.mjs)`);
  }
}

export async function stop(child) {
  child.proxy?.close();
  child.kill();
  await new Promise(r => (child.exitCode !== null ? r() : child.once("exit", r)));
}

// The server process's own CPU time (user + system) in ms, from /proc. Linux only.
import { readFileSync } from "node:fs";
export const cpuMs = pid => {
  const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
  return (+f[11] + +f[12]) * 10;
};

// An init script that notes when the live table is first on the page
// (window.__table, the first animation frame with a row) and first changes
// after that (window.__live: the update stream connected and applied), in
// ms from navigation start.
export function liveTimer() {
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
}

// Chromium for the playwright runners: CHROME_PATH, else playwright's own.
export const launch = () => chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

// Did the page end on the server's state? Pauses the simulation, gives the
// page `settleMs` to apply what is in flight, then compares every <tr> on
// the page with the row the server holds (by id="db…" when rows carry one,
// else by position). Returns { rows, wrong }.
export async function checkRows(name, page, settleMs = 3000) {
  await fetch(direct(name) + "/__dbmon/pause");
  await page.waitForTimeout(settleMs);
  const want = await (await fetch(direct(name) + "/__dbmon/rows")).json();
  const byId = new Map(want.map((r, i) => [r.id, r.text]));
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll("tr")].filter(tr => tr.querySelector("td.dbname")).map(tr => [tr.id, tr.textContent])
  );
  let wrong = 0;
  shown.forEach(([id, text], i) => {
    const expected = id ? byId.get(Number(id.slice(2))) : want[i]?.text;
    if (text !== expected) wrong++;
  });
  return { rows: shown.length, wrong };
}
