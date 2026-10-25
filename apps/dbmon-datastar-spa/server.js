// DBMon as a Datastar SPA: the counterpart of dbmon-solid's /spa. The page
// arrives as an empty shell; a Rocket component (<db-mon>) renders the table
// in the browser with <template data-for> from `$dbs`, and the server streams
// `$dbs` as datastar-patch-signals events: every row on connect, then only
// the rows that changed, merged into the array by index. The same simulation
// (../dbmon-hypermedia/databases.js) and the same per-connection brotli as
// the other DBMon servers.
import http from "node:http";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { watchDatabases, currentDatabases } from "../dbmon-hypermedia/databases.js";

const [BROTLI_QUALITY, BROTLI_LGWIN] = (process.env.DBMON_BROTLI || "4,22").split(",").map(Number);
const PORT = Number(process.env.PORT || 3064);
const dir = new URL(".", import.meta.url).pathname;
const css = readFileSync(dir + "../dbmon-hypermedia/app.css", "utf8");
// ROCKET=patched: the Rocket build with two performance changes (see README).
const ROCKET = process.env.ROCKET === "patched" ? "datastar-rocket-patched.js" : "datastar-rocket.js";
const rocketJs = readFileSync(dir + "../hn-datastar-spa/public/" + ROCKET);
const rocketBr = zlib.brotliCompressSync(rocketJs, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
const appJs = readFileSync(dir + "app.js");

// What a client renders, as dbmon-solid's `Row`: no raw `elapsed`. Cached per
// database object, so an unchanged row is the same object next tick.
const rows = new WeakMap();
const rowOf = db => {
  let row = rows.get(db);
  if (!row) {
    const { id, name, count, countClass, top5 } = db;
    row = { id, name, count, countClass, top5: top5.map(({ formatted, className, text }) => ({ formatted, className, text })) };
    rows.set(db, row);
  }
  return row;
};

const signalsEvent = obj => "event: datastar-patch-signals\ndata: signals " + JSON.stringify(obj) + "\n\n";
const everything = dbs => Buffer.from(signalsEvent({ dbs: dbs.map(rowOf) }));

// ---- shared broadcaster: one patch per tick for every client ----
const clients = new Set();
let loop = null;

function startLoop() {
  const ac = new AbortController();
  loop = ac;
  (async () => {
    let prev;
    for await (const dbs of watchDatabases(ac.signal)) {
      let event;
      if (!prev) event = everything(dbs);
      else {
        // A JSON merge patch keyed by index: Datastar merges an object into
        // an array signal element by element.
        const changed = {};
        dbs.forEach((db, i) => db !== prev[i] && (changed[i] = rowOf(db)));
        event = Buffer.from(signalsEvent({ dbs: changed }));
      }
      prev = dbs;
      for (const send of clients) send(event);
    }
  })();
}

function subscribe(send) {
  clients.add(send);
  if (!loop) startLoop();
  else send(everything(currentDatabases()));
  return () => {
    clients.delete(send);
    if (!clients.size && loop) {
      loop.abort();
      loop = null;
    }
  };
}

const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DBMon (Datastar SPA)</title>
<style>${css}</style>
<script type="module" src="/app.js"></script>
</head>
<body>
<db-mon></db-mon>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(page());
  }
  if (url.pathname === "/datastar-rocket.js") {
    const br = /\bbr\b/.test(req.headers["accept-encoding"] || "");
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=3600", ...(br ? { "content-encoding": "br" } : {}) });
    return res.end(br ? rocketBr : rocketJs);
  }
  if (url.pathname === "/app.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=3600" });
    return res.end(appJs);
  }
  if (url.pathname === "/updates") {
    const br = /\bbr\b/.test(req.headers["accept-encoding"] || "");
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...(br ? { "content-encoding": "br", vary: "accept-encoding" } : {})
    });
    res.flushHeaders();
    let out = res;
    if (br) {
      out = zlib.createBrotliCompress({
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [zlib.constants.BROTLI_PARAM_LGWIN]: BROTLI_LGWIN
        }
      });
      out.pipe(res);
    }
    const send = buf => {
      out.write(buf);
      if (br) out.flush(zlib.constants.BROTLI_OPERATION_FLUSH);
    };
    const unsubscribe = subscribe(send);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (br) out.destroy();
      res.destroy();
    };
    res.on("close", close);
    res.on("error", close);
    return;
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () => console.log(`datastar dbmon spa (${ROCKET}) on http://localhost:${PORT}`));
