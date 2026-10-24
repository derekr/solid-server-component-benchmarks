// Where each app lives, which port it serves on, and the environment it is
// measured with. `start(name)` runs the app's built server and resolves once
// it answers; the returned child's pid is what the server-CPU runners read
// (a Go app runs its built binary, so the pid is the server itself).
import { spawn } from "node:child_process";
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
  // Datastar, one server: <details> (as hn-sc), or a toggle per comment (as
  // hn-sc-toggles) built from signals or as one click handler on the thread.
  "hn-datastar": { port: 3011, env: HN },
  "hn-datastar-toggles": { dir: "hn-datastar", port: 3012, env: { ...HN, TOGGLES: "signals" } },
  "hn-datastar-delegated": { dir: "hn-datastar", port: 3016, env: { ...HN, TOGGLES: "delegated" } },
  "store-sc": { port: 3013 },
  "store-spa": { port: 3014 },
  "store-datastar": { port: 3015 },
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
  // The same, a scroll sent as only the rows that entered and left.
  "dbmon-hypermedia-window-delta": { dir: "dbmon-hypermedia", port: 3030, stream: "/updates", env: { PATCH: "window", DBMON_OVERSCAN: "40", DBMON_SCROLL_PATCH: "delta" } },
  // The Solid app rendered in the browser from streamed JSON: rows swapped
  // per object (`/spa`) or reconciled into a store by id (`/spa-store`).
  "dbmon-spa": { dir: "dbmon-solid", port: 3023, path: "/spa", stream: "/_server/live/getDatabaseData-84a14cde" },
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

export const url = name => `http://localhost:${APPS[name].port}`;
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
      await fetch(url(name) + "/", { method: "HEAD" });
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
    return child;
  }
  child.kill();
  throw new Error(`${name} did not start on ${app.port}`);
}

// The live stream must answer 200: the Solid stream URLs carry a build hash,
// and a stale one would 404 and pass for a very cheap server.
async function checkStream(name, child) {
  const ac = new AbortController();
  const res = await fetch(url(name) + APPS[name].stream, { signal: ac.signal, headers: { "accept-encoding": "br" } });
  ac.abort();
  if (res.status !== 200) {
    child.kill();
    throw new Error(`${name}: stream ${APPS[name].stream} answered ${res.status} (rebuilt? update its hash in apps.mjs)`);
  }
}

export async function stop(child) {
  child.kill();
  await new Promise(r => (child.exitCode !== null ? r() : child.once("exit", r)));
}

// The server process's own CPU time (user + system) in ms, from /proc. Linux only.
import { readFileSync } from "node:fs";
export const cpuMs = pid => {
  const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
  return (+f[11] + +f[12]) * 10;
};

// Chromium for the playwright runners: CHROME_PATH, else playwright's own.
export const launch = () => chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

// Did the page end on the server's state? Pauses the simulation, gives the
// page `settleMs` to apply what is in flight, then compares every <tr> on
// the page with the row the server holds (by id="db…" when rows carry one,
// else by position). Returns { rows, wrong }.
export async function checkRows(name, page, settleMs = 3000) {
  await fetch(url(name) + "/__dbmon/pause");
  await page.waitForTimeout(settleMs);
  const want = await (await fetch(url(name) + "/__dbmon/rows")).json();
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
