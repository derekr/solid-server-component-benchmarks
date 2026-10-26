// Client navigation from the feed to the HN story: bytes fetched after the
// click until the thread is on screen (compressed, as transferred; the data
// request and any lazily loaded code chunks apart), and that time.
// The server-component apps fetch a frame (markup + slot records); the SPAs
// fetch JSON and render it on the client.
//
// The Datastar apps are multi-page: the click loads a new document, so the
// click time is kept in sessionStorage and read back from the new page.
//
// Pages load through the NET profile (apps.mjs, default 70 ms RTT and
// 10 Mbit/s), so the time includes fetching the data and any code.
//
// NAV=real measures the navigation as a person makes it, with the platform's
// help: the HTTP cache is on (the feed page's script and stylesheet are
// reused), and the pointer rests on the link for HOVER_MS (default 300) before
// pressing, then holds the press 80 ms, as a hand does. That gives each app
// its own hover-intent mitigation: the Datastar pages prerender the link from
// speculation rules, and the Solid router and Qwik City preload on hover as
// they do. Timed from pointerdown either way.
//
// usage: node navigation.mjs [runs=5] [apps=hn-sc,hn-spa,hn-sc-toggles,hn-spa-toggles,hn-qwik,hn-datastar,hn-datastar-cv,hn-datastar-toggles,hn-datastar-window] [cpuRate=1]
//
// The feed page reads the live HN API; if that is unreachable the feed shows
// its error state, but the app is still running and the story itself comes
// from the cached snapshot, so the navigation measured is the same.
import { start, stop, url, launch, netLabel } from "./apps.mjs";

const RUNS = Number(process.argv[2] || 5);
const NAMES = (process.argv[3] || "hn-sc,hn-spa,hn-sc-toggles,hn-spa-toggles,hn-qwik,hn-datastar,hn-datastar-cv,hn-datastar-toggles,hn-datastar-window").split(",");
const RATE = Number(process.argv[4] || 1);
const REAL = process.env.NAV === "real";
const HOVER_MS = Number(process.env.HOVER_MS || 300);
const STORY = "/stories/30186326";
// Code and styles, as opposed to the data the navigation fetched. A
// multi-page app's new document fetches its script and stylesheet again
// here, because the runner disables the HTTP cache.
const CODE = /\/(assets|build|_next\/static)\/|\/(datastar\.js|app\.css)$/;

async function once(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (!REAL) await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForTimeout(1000);
  let counting = false;
  const reqs = {};
  cdp.on("Network.requestWillBeSent", e => counting && (reqs[e.requestId] = { url: e.request.url, kb: 0 }));
  // A document served from a speculation-rules prefetch shows up as a second
  // request for the same bytes; only the prefetch is counted.
  cdp.on("Network.requestWillBeSent", e => reqs[e.requestId] && /prefetch/.test(e.request.headers["Sec-Purpose"] || "") && (reqs[e.requestId].prefetch = true));
  cdp.on("Network.responseReceived", e => reqs[e.requestId] && e.response.fromPrefetchCache && !reqs[e.requestId].prefetch && (reqs[e.requestId].prefetched = true));
  cdp.on("Network.loadingFinished", e => reqs[e.requestId] && (reqs[e.requestId].kb = reqs[e.requestId].prefetched ? 0 : e.encodedDataLength / 1000));
  counting = true;
  // A real mouse click (move, then press), as a user's: Qwik City's links
  // route on the client only after the pointer has been over them. Timed
  // from pointerdown. Qwik City routes only its own <Link>s, so its app
  // carries an invisible one to the story; the Solid apps route any
  // same-origin anchor, so one is added.
  // The bare navigation has none of the platform's help, so a page's
  // speculation rules are taken out before the click.
  if (!REAL) await page.evaluate(() => document.querySelectorAll('script[type="speculationrules"]').forEach(s => s.remove()));
  await page.evaluate(story => {
    let a = document.querySelector("a[data-bench-story]");
    if (!a) {
      a = document.createElement("a");
      a.href = story;
      a.dataset.benchStory = "";
      a.textContent = "story";
      a.style.cssText = "position:fixed;right:0;bottom:0;opacity:0";
      (document.querySelector(".news-list") ?? document.body).appendChild(a);
    }
    addEventListener("pointerdown", () => (sessionStorage.__t0 = performance.timeOrigin + performance.now()), {
      capture: true,
      once: true
    });
  }, STORY);
  if (REAL) {
    const box = await page.locator("a[data-bench-story]").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(HOVER_MS);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
  } else await page.click("a[data-bench-story]");
  const painted = await (
    await page.waitForFunction(
      () =>
        // The whole thread, or hn-datastar-window's first window (its gap
        // below the rows comes after them).
        (document.querySelectorAll(".comment").length > 1000 || document.querySelector("#comments > #below")) &&
        performance.timeOrigin + performance.now() - Number(sessionStorage.__t0),
      null,
      { polling: "raf", timeout: 60000 }
    )
  ).jsonValue();
  // Only what the navigation itself fetched: requests issued after the thread
  // is on screen (prefetches of links in it, for one) are not counted.
  counting = false;
  await page.waitForTimeout(1500);
  await ctx.close();
  const list = Object.values(reqs);
  return {
    paintedMs: Math.round(painted),
    dataKB: +list.filter(r => !CODE.test(r.url)).reduce((s, r) => s + r.kb, 0).toFixed(1),
    codeKB: +list.filter(r => CODE.test(r.url)).reduce((s, r) => s + r.kb, 0).toFixed(1),
    requests: list.map(r => r.url.replace(base, "").slice(0, 60))
  };
}

const servers = [];
for (const n of NAMES) servers.push(await start(n));
const browser = await launch();
const runs = Object.fromEntries(NAMES.map(n => [n, []]));
try {
  for (const n of NAMES) await once(browser, url(n)); // warm-up
  for (let i = 0; i < RUNS; i++) for (const n of NAMES) runs[n].push(await once(browser, url(n)));
} finally {
  await browser.close();
  for (const s of servers) await stop(s);
}
const med = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
console.log(`client navigation to the story, cpu ${RATE}x, ${netLabel()}, ${RUNS} runs, medians` + (REAL ? `, cache on, ${HOVER_MS} ms hover and an 80 ms press` : ", cache off, scripted click"));
for (const n of NAMES)
  console.log(
    n.padEnd(16),
    `data ${med(runs[n].map(r => r.dataKB))} kB + lazy code ${med(runs[n].map(r => r.codeKB))} kB, on screen ${med(runs[n].map(r => r.paintedMs))} ms,`,
    `requests: ${runs[n][0].requests.join(" ")}`
  );
