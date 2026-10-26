// The real-world navigation (NAV=real in navigation.mjs) with prerendering
// allowed. Chrome turns prerendering off whenever DevTools is attached
// (`PrerenderingDisabledByDevTools`), so Playwright can't see it. This runner
// drives a headed Chrome with no DevTools on Xvfb, moves a real X pointer
// (XTEST) onto a feed link, rests it HOVER_MS (default 300), presses it 80 ms,
// and lets the pages report their own times to the runner.
//
// The app sits behind a small proxy that adds the timing script to each page
// and can rewrite the speculation rules, so the app itself is unchanged:
//   served    the rules as the app serves them
//   moderate  the prerender rule at moderate eagerness
//   prefetch  the prerender rule taken out, prefetch only
// The Solid apps route on the client and preload on hover as they do; they
// run once, as served. Timed from pointerdown until the thread (1,000+
// comments) is on screen. The rewriting proxy sits behind the NET profile's
// shaping proxy (apps.mjs), and re-compresses the pages it rewrites (brotli
// 4, flushed per chunk, as the apps stream), so the link carries what the
// app would send.
//
// usage: node prerender.mjs [runs=9] [apps=hn-sc,hn-spa,hn-datastar,hn-datastar-cv,hn-datastar-toggles] [modes=prefetch,moderate,served]
// needs Xvfb and libXtst (Linux).
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import zlib from "node:zlib";
import { start, stop, direct as url, NET, shapingProxy, netLabel } from "./apps.mjs";

const RUNS = Number(process.argv[2] || 9);
const NAMES = (process.argv[3] || "hn-sc,hn-spa,hn-datastar,hn-datastar-cv,hn-datastar-toggles").split(",");
const MODES = (process.argv[4] || "prefetch,moderate,served").split(",");
const HOVER_MS = Number(process.env.HOVER_MS || 300);
const STORY = "/stories/30186326";
const PROXY = 3998;
const DISPLAY = ":99";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A real pointer, through XTEST.
const XTEST = `
import ctypes, sys
x11 = ctypes.cdll.LoadLibrary("libX11.so.6"); xt = ctypes.cdll.LoadLibrary("libXtst.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
d = ctypes.c_void_p(x11.XOpenDisplay(None))
if sys.argv[1] == "move": xt.XTestFakeMotionEvent(d, -1, int(sys.argv[2]), int(sys.argv[3]), 0)
else: xt.XTestFakeButtonEvent(d, 1, 1 if sys.argv[1] == "down" else 0, 0)
x11.XFlush(d); x11.XCloseDisplay(d)`;
const mouse = (...a) => execFileSync("python3", ["-c", XTEST, ...a.map(String)], { env: { ...process.env, DISPLAY } });

// On the feed: a feed link covering the lower part of the window (so it
// matches the rules' `.news-list a`), and the press time. On the story: the
// time from the press until the thread is on screen, after activation when
// the page was prerendered.
const TIMING = `<script>
(() => {
  const STORY = ${JSON.stringify(STORY)};
  const report = o => navigator.sendBeacon("/__bench", JSON.stringify(o));
  const onScreen = () => {
    const tick = () => {
      if (document.querySelectorAll(".comment").length <= 1000) return requestAnimationFrame(tick);
      const n = performance.getEntriesByType("navigation")[0];
      report({ ms: Math.round(performance.timeOrigin + performance.now() - Number(localStorage.t0)), prerendered: n.activationStart > 0 });
    };
    requestAnimationFrame(tick);
  };
  if (location.pathname !== STORY) {
    addEventListener("load", () => {
      const list = document.querySelector(".news-list") || document.body.appendChild(Object.assign(document.createElement("main"), { className: "news-list" }));
      const a = Object.assign(document.createElement("a"), { href: STORY, textContent: "story" });
      a.style.cssText = "position:fixed;left:0;right:0;top:300px;bottom:0;z-index:99999;background:#eee";
      list.appendChild(a);
      // A client-routed app renders the story into this document.
      addEventListener("pointerdown", () => ((localStorage.t0 = performance.timeOrigin + performance.now()), onScreen()), { capture: true, once: true });
      setTimeout(() => report({ ready: true }), 1000);
    });
    return;
  }
  if (document.prerendering) document.addEventListener("prerenderingchange", onScreen, { once: true });
  else onScreen();
})();
</script>`;

const rewrite = (html, mode) =>
  html.replace(/<script type="speculationrules">(.*?)<\/script>/s, (all, json) => {
    if (mode === "served") return all;
    const rules = JSON.parse(json);
    if (mode === "prefetch") delete rules.prerender;
    else for (const r of rules.prerender ?? []) r.eagerness = "moderate";
    return `<script type="speculationrules">${JSON.stringify(rules)}</script>`;
  });

let target, mode, waiting;
const proxy = http
  .createServer((req, res) => {
    if (req.url === "/__bench") {
      let body = "";
      req.on("data", c => (body += c)).on("end", () => (res.end(), waiting?.(JSON.parse(body))));
      return;
    }
    const headers = { ...req.headers, host: new URL(target).host };
    const up = http.request(target + req.url, { method: req.method, headers }, upRes => {
      const html = /text\/html/.test(upRes.headers["content-type"] || "");
      const h = { ...upRes.headers };
      if (html) delete h["content-length"];
      res.writeHead(upRes.statusCode, h);
      if (!html) return upRes.pipe(res);
      // Decode, rewrite the head, and encode again as it came.
      const br = upRes.headers["content-encoding"] === "br";
      const src = br ? upRes.pipe(zlib.createBrotliDecompress()) : upRes;
      const enc = br ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }) : null;
      if (enc) enc.pipe(res);
      const out = enc ?? res;
      const write = c => (out.write(c), enc?.flush());
      // Stream it through; the head is in the first chunks.
      let head = "";
      src.setEncoding("utf8");
      src.on("data", c => {
        if (head === null) return write(c);
        head += c;
        const i = head.indexOf("</head>");
        if (i < 0) return;
        write(rewrite(head.slice(0, i), mode) + TIMING + head.slice(i));
        head = null;
      });
      src.on("end", () => out.end(head ?? ""));
    });
    req.pipe(up);
  })
  .listen(NET ? PROXY + 1 : PROXY);
const shaper = NET ? await shapingProxy(PROXY, PROXY + 1) : null;

const next = ms => Promise.race([new Promise(r => (waiting = r)), sleep(ms).then(() => ({ timeout: true }))]);
const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x900x24"], { stdio: "ignore" });
await sleep(1000);

async function once() {
  const dir = mkdtempSync(tmpdir() + "/prerender-");
  mouse("move", 640, 50);
  const chrome = spawn(
    process.env.CHROME_PATH || chromium.executablePath(),
    ["--no-first-run", "--no-default-browser-check", "--no-sandbox", "--disable-gpu", `--user-data-dir=${dir}`, "--window-position=0,0", "--window-size=1280,900", `--app=http://localhost:${PROXY}/`],
    { env: { ...process.env, DISPLAY }, stdio: "ignore" }
  );
  let r = await next(30000);
  if (r.ready) {
    mouse("move", 640, 600);
    await sleep(HOVER_MS);
    mouse("down");
    await sleep(80);
    mouse("up");
    r = await next(30000);
  }
  chrome.kill("SIGKILL");
  await sleep(500);
  rmSync(dir, { recursive: true, force: true });
  return r;
}

const runs = {};
try {
  for (const name of NAMES) {
    const server = await start(name);
    target = url(name);
    try {
      // The rewrites only mean something on pages with speculation rules.
      for (const m of name.includes("datastar") ? MODES : ["served"]) {
        mode = m;
        await once(); // warm-up
        runs[name + " " + m] = [];
        for (let i = 0; i < RUNS; i++) runs[name + " " + m].push(await once());
      }
    } finally {
      await stop(server);
    }
  }
} finally {
  proxy.close();
  shaper?.close();
  xvfb.kill();
}
const med = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
console.log(`navigation to the story without DevTools, cpu 1x, ${netLabel()}, ${RUNS} runs, medians, cache on, ${HOVER_MS} ms hover and an 80 ms press`);
for (const [k, rs] of Object.entries(runs))
  console.log(k.padEnd(28), `on screen ${med(rs.map(r => r.ms ?? Infinity))} ms, prerendered ${rs.filter(r => r.prerendered).length}/${rs.length}, runs: ${rs.map(r => r.ms ?? "timeout").join(" ")}`);
