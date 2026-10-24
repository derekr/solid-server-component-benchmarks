// Where a page's main-thread time goes, from a Chrome trace: self time per
// event, bucketed so a framework's own work (script, HTML parsing, GC) is
// separate from the browser's work on the result (style, layout, paint),
// which every stack pays for the same table.
//
// traceWindow(cdp, page, ms) records `ms` of the page and returns ms per
// second in each bucket, plus `framework` (script + parse + gc) and
// `browser` (style + layout + paint).

const BUCKETS = [
  ["gc", /GC|Scavenge|MarkCompact|Sweep|Finalize/i],
  ["parse", /^(ParseHTML|HTMLDocumentParser|ParseAuthorStyleSheet)/],
  ["style", /^(UpdateLayoutTree|RecalcStyle|ScheduleStyleRecalculation)/],
  ["layout", /^(Layout|UpdateLayout|LayoutShift)/],
  ["paint", /^(Paint|PrePaint|Layerize|Commit|UpdateLayer|CompositeLayers|PaintImage|RasterTask)/]
];
// Everything else on the main thread is script: FunctionCall, microtasks,
// and the RunTask self time that streamed-response callbacks show up as.

function summarize(events) {
  const marks = events.filter(e => e.name === "dbmon-trace-start" || e.name === "dbmon-trace-end").sort((a, b) => a.ts - b.ts);
  const start = marks.find(e => e.name === "dbmon-trace-start"), end = marks.find(e => e.name === "dbmon-trace-end");
  if (!start || !end) throw new Error("trace marks missing");
  const { pid, tid } = start;
  const [ws, we] = [start.ts, end.ts];
  const xs = events.filter(e => e.pid === pid && e.tid === tid && e.ph === "X" && e.dur != null).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const clip = (s, e) => Math.max(0, Math.min(e, we) - Math.max(s, ws));
  const totals = Object.fromEntries([...BUCKETS.map(([k]) => [k, 0]), ["script", 0]]);
  const stack = [];
  const self = new Map();
  let busy = 0;
  for (const e of xs) {
    const end = e.ts + e.dur;
    while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
    const c = clip(e.ts, end);
    if (!c && !stack.length) continue;
    self.set(e, (self.get(e) || 0) + c);
    if (stack.length) self.set(stack[stack.length - 1].e, self.get(stack[stack.length - 1].e) - c);
    else busy += c;
    stack.push({ e, end });
  }
  for (const [e, s] of self) totals[BUCKETS.find(([, re]) => re.test(e.name))?.[0] ?? "script"] += s;
  const perSec = us => Math.round(us / ((we - ws) / 1e6) / 1000);
  const out = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, perSec(v)]));
  out.busy = perSec(busy);
  out.framework = out.script + out.parse + out.gc;
  out.browser = out.style + out.layout + out.paint;
  return out;
}

export async function traceWindow(cdp, page, ms) {
  const events = [];
  const onData = d => events.push(...d.value);
  cdp.on("Tracing.dataCollected", onData);
  const done = new Promise(r => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", {
    traceConfig: { includedCategories: ["devtools.timeline", "blink.user_timing", "v8", "disabled-by-default-devtools.timeline"] },
    transferMode: "ReportEvents"
  });
  await page.evaluate(() => performance.mark("dbmon-trace-start"));
  await page.waitForTimeout(ms);
  await page.evaluate(() => performance.mark("dbmon-trace-end"));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", onData);
  return summarize(events);
}
