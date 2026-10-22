// Is the page keeping up or quietly falling behind? Loads the live table,
// lets it run 10 s, stops the server, and reports how long the page keeps
// applying updates it had already received (the backlog). 0 s = keeping up.
//
// usage: node dbmon-drain.mjs <app> <rows>
import { chromium } from "playwright";
import { start, stop, url } from "./apps.mjs";
const [name, rows] = process.argv.slice(2);
const server = await start(name, { DBMON_ROWS: String(rows / 2), DBMON_MUTATIONS: "0.1", DBMON_FPS: "5" });
const browser = await chromium.launch();
let stopped = false;
try {
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(url(name) + "/", { waitUntil: "commit" });
  await page.waitForSelector("td.dbname", { timeout: 15000 });
  await page.evaluate(() => { window.__m = []; new MutationObserver(() => window.__m.push(performance.now())).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); });
  await page.waitForTimeout(10000);
  const tStop = await Promise.race([page.evaluate(() => performance.now()), new Promise(r => setTimeout(() => r(null), 5000))]);
  await stop(server); stopped = true;
  if (tStop == null) { console.log(JSON.stringify({ app: name, rows: +rows, frozen: true })); process.exit(0); }
  await page.waitForTimeout(15000);
  const m = await Promise.race([page.evaluate(() => window.__m), new Promise(r => setTimeout(() => r(null), 10000))]);
  const last = m ? Math.max(...m) : null;
  console.log(JSON.stringify({ app: name, rows: +rows, drainSec: m ? +(((last - tStop) / 1000).toFixed(1)) : "frozen", batchesAfterStop: m ? m.filter(t => t > tStop).length : null }));
} finally { await browser.close(); if (!stopped) await stop(server); }
