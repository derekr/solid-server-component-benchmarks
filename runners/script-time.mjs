// Main-thread time by category for a cold load (or a client navigation) of
// the HN story page, from a Chromium trace. "script" is the number the
// article quotes for the <details> variant.
//
// usage: node script-time.mjs [cpuRate=4] [cold|nav] [runs=7] [apps=hn-sc,hn-spa]
// Apps run interleaved, one fresh context per run; prints median and range.
import { chromium } from "playwright";
import { start, stop, url } from "./apps.mjs";

const RATE = Number(process.argv[2] || 4);
const NAV = process.argv[3] === "nav";
const RUNS = Number(process.argv[4] || 7);
const NAMES = (process.argv[5] || "hn-sc,hn-spa").split(",");
const STORY = "/stories/30186326";

const BUCKET = name => {
  if (/^ParseHTML$/.test(name)) return "parseHTML";
  if (/^(v8\.compile|v8\.compileModule|V8\.CompileCode|v8\.parseOnBackground)/i.test(name)) return "compile";
  if (/^(EvaluateScript|v8\.evaluateModule|FunctionCall|v8\.run|V8\.Execute|RunMicrotasks|TimerFire|EventDispatch|FireAnimationFrame|v8\.callFunction|ResourceReceivedData)$/.test(name)) return "script";
  if (/^(MinorGC|MajorGC|V8\.GC.*|BlinkGC.*)$/.test(name)) return "gc";
  if (/^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet)$/.test(name)) return "style";
  if (/^(Layout|UpdateLayerTree|PrePaint|Layerize)$/.test(name)) return "layout";
  if (/^(Paint|PaintImage|CompositeLayers|Commit|RasterTask)$/.test(name)) return "paint";
  return null;
};

async function one(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  if (NAV) { await page.goto(base + "/", { waitUntil: "load" }); await page.waitForTimeout(800); }
  const events = [];
  cdp.on("Tracing.dataCollected", e => events.push(...e.value));
  const done = new Promise(r => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,v8,v8.execute,disabled-by-default-devtools.timeline,blink.user_timing,loading",
    transferMode: "ReportEvents"
  });
  if (NAV) {
    await page.evaluate(s => { const a = document.createElement("a"); a.href = s; document.body.append(a); a.click(); }, STORY);
    // The whole thread, or hn-datastar-window's first window.
    await page.waitForFunction(() => document.querySelectorAll(".comment").length > 1000 || document.querySelector("#comments > #below"), null, { timeout: 60000 });
  } else {
    await page.goto(base + STORY, { waitUntil: "load" });
    // A client-rendered page (hn-datastar-spa) fetches and renders the
    // thread after load; server-rendered pages already have it.
    await page.waitForFunction(() => document.querySelectorAll(".comment").length > 1000 || document.querySelector("#comments > #below"), null, { timeout: 60000 });
  }
  await page.waitForTimeout(2500);
  await cdp.send("Tracing.end");
  await done;
  await ctx.close();
  // find renderer main thread of the page
  const tn = events.filter(e => e.name === "thread_name" && e.args?.name === "CrRendererMain");
  const counts = {};
  for (const t of tn) counts[`${t.pid}:${t.tid}`] = events.filter(e => e.pid === t.pid && e.tid === t.tid && e.ph === "X").length;
  const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const xs = events.filter(e => `${e.pid}:${e.tid}` === main && e.ph === "X" && e.dur != null).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  // self time by bucket: attribute each microsecond to the innermost bucketed event
  const out = {};
  const stack = [];
  for (const e of xs) {
    while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
    const b = BUCKET(e.name);
    const frame = { end: e.ts + e.dur, b, dur: e.dur, child: 0 };
    if (b) {
      // subtract from nearest bucketed ancestor
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].b) { stack[i].child += e.dur; break; }
    }
    stack.push(frame);
    frame.ref = e;
    if (b) (out._frames ||= []).push(frame);
  }
  const res = {};
  for (const f of out._frames || []) res[f.b] = (res[f.b] || 0) + (f.dur - f.child) / 1000;
  const tasks = xs.filter(e => e.name === "RunTask");
  res.taskTotal = tasks.reduce((a, e) => a + e.dur, 0) / 1000;
  for (const k in res) res[k] = +res[k].toFixed(0);
  return res;
}

const servers = [];
for (const n of NAMES) servers.push(await start(n));
const browser = await chromium.launch();
const runs = Object.fromEntries(NAMES.map(n => [n, []]));
try {
  for (const n of NAMES) await one(browser, url(n)); // warm-up
  for (let i = 0; i < RUNS; i++) for (const n of NAMES) runs[n].push(await one(browser, url(n)));
} finally {
  await browser.close();
  for (const s of servers) await stop(s);
}
console.log(`cpu ${RATE}x ${NAV ? "nav" : "cold"}, ${RUNS} runs, median (min-max) ms`);
for (const n of NAMES) {
  const keys = [...new Set(runs[n].flatMap(Object.keys))];
  const row = keys.map(k => {
    const s = runs[n].map(r => r[k] || 0).sort((a, b) => a - b);
    return `${k} ${s[s.length >> 1]} (${s[0]}-${s[s.length - 1]})`;
  });
  console.log(n.padEnd(16), row.join(", "));
}
