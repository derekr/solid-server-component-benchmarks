// Where each app lives, which port it serves on, and the environment it is
// measured with. `start(name)` runs the app's built server and resolves once
// it answers; the returned child's pid is what the server-CPU runners read.
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
  "store-sc": { port: 3013 },
  "store-spa": { port: 3014 },
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
  // The Solid app rendered in the browser from streamed JSON: rows swapped
  // per object (`/spa`) or reconciled into a store by id (`/spa-store`).
  "dbmon-spa": { dir: "dbmon-solid", port: 3023, path: "/spa", stream: "/_server/live/getDatabaseData-84a14cde" },
  "dbmon-spa-store": { dir: "dbmon-solid", port: 3024, path: "/spa-store", stream: "/_server/live/getDatabaseData-cc45404a" },
};

export const url = name => `http://localhost:${APPS[name].port}`;
// The page an app is measured on.
export const page = name => url(name) + (APPS[name].path ?? "/");

export async function start(name, env = {}) {
  const app = APPS[name];
  if (!app) throw new Error(`unknown app ${name}`);
  const child = spawn("node", ["server.js"], {
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
