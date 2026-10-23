// Where each app lives, which port it serves on, and the environment it is
// measured with. `start(name)` runs the app's built server and resolves once
// it answers; the returned child's pid is what the server-CPU runners read.
import { spawn } from "node:child_process";
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
    stdio: "ignore"
  });
  for (let i = 0; i < 100; i++) {
    try {
      // HEAD on the page is enough to know the server is up; dbmon's live
      // stream is never touched here.
      await fetch(url(name) + "/", { method: "HEAD" });
      return child;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  child.kill();
  throw new Error(`${name} did not start on ${app.port}`);
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
