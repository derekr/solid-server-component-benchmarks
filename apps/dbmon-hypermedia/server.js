// Datastar DBMon: one shared simulation, rendered on the server once per tick
// and pushed to every client as Datastar SSE events. Per-connection brotli on
// the SSE stream.
//
// PATCH picks how a tick reaches the page:
//   whole    (default) the whole table as one datastar-patch-elements event,
//            morphed by id. Datastar's default: send what the region should
//            look like and let the morph work out the change.
//   rows     only the rows whose sample changed, each morphed by its id
//   replace  the changed rows with `mode replace`: swapped in, no morph
//   signals  the table binds every cell to a signal (data-text, data-attr);
//            a tick is a datastar-patch-signals event with the changed rows'
//            values, Datastar's fine-grained path
// The last three are the usual next step when measuring says the whole
// region costs too much: narrow the patch to what changed.
import http from "node:http";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { watchDatabases, currentDatabases } from "./databases.js";

// Brotli settings for the update stream, "quality,window" (default 4,22, a
// common streaming setting; 5,24 gives a 16 MB window, so each connection
// finds the table it sent last tick, at several times the CPU).
const [BROTLI_QUALITY, BROTLI_LGWIN] = (process.env.DBMON_BROTLI || "4,22").split(",").map(Number);

const PORT = Number(process.env.PORT || 3021);
const MODE = process.env.PATCH || "whole";
if (!["whole", "rows", "replace", "signals"].includes(MODE)) throw new Error(`unknown PATCH=${MODE}`);
const dir = new URL(".", import.meta.url).pathname;
const css = readFileSync(dir + "app.css", "utf8");
const datastarJs = readFileSync(dir + "datastar.js");
// Compressed once at startup, as the Solid server's build precompresses its
// static assets (brotli 9).
const datastarJsBr = zlib.brotliCompressSync(datastarJs, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
const acceptsBr = req => /\bbr\b/.test(req.headers["accept-encoding"] || "");

const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Same markup as examples/server-dbmon/src/routes/dashboard.tsx, plus id="db…".
function renderRow(db) {
  let h = `<tr id="db${db.id}"><td class="dbname">${esc(db.name)}</td><td class="query-count"><span class="${db.countClass}">${db.count}</span></td>`;
  for (const q of db.top5)
    h += `<td class="Query ${q.className}">${esc(q.formatted)}<div class="popover left"><div class="popover-content">${esc(q.text)}</div><div class="arrow"></div></div></td>`;
  return h + "</tr>";
}

// PATCH=signals: the same row with every value bound to a signal. data-text
// replaces an element's children, so a cell's elapsed time gets a <span>.
// Signals start with `_` so Datastar keeps them out of requests.
function renderSignalRow(db) {
  const $ = `$_d${db.id}`;
  let h = `<tr id="db${db.id}"><td class="dbname">${esc(db.name)}</td><td class="query-count"><span class="${db.countClass}" data-attr:class="${$}.cc" data-text="${$}.n">${db.count}</span></td>`;
  db.top5.forEach((q, k) => {
    h += `<td class="Query ${q.className}" data-attr:class="'Query ' + ${$}.q${k}.c"><span data-text="${$}.q${k}.f">${esc(q.formatted)}</span><div class="popover left"><div class="popover-content" data-text="${$}.q${k}.t">${esc(q.text)}</div><div class="arrow"></div></div></td>`;
  });
  return h + "</tr>";
}
const signalsOf = dbs =>
  Object.fromEntries(
    dbs.map(db => {
      const row = { n: db.count, cc: db.countClass };
      db.top5.forEach((q, k) => (row["q" + k] = { c: q.className, f: q.formatted, t: q.text }));
      return ["_d" + db.id, row];
    })
  );

function renderTable(dbs) {
  const row = MODE === "signals" ? renderSignalRow : renderRow;
  let h = '<table id="dbmon" class="table table-striped latest-data"><tbody>';
  for (const db of dbs) h += row(db);
  return h + "</tbody></table>";
}

// Datastar SSE events (sdk/ADR.md): one `data: elements` line per HTML line.
const patchEvent = (html, mode) =>
  "event: datastar-patch-elements\n" +
  (mode ? `data: mode ${mode}\n` : "") +
  html.split("\n").map(l => `data: elements ${l}\n`).join("") +
  "\n";
const signalEvent = signals => `event: datastar-patch-signals\ndata: signals ${JSON.stringify(signals)}\n\n`;

// What a client that just connected gets: everything it shows, as of now
// (the page it loaded may be a tick or two old).
const snapshot = dbs => (MODE === "signals" ? signalEvent(signalsOf(dbs)) : patchEvent(renderTable(dbs)));

// What a tick sends, given the indexes of the rows that changed.
function tickEvent(dbs, changedAt) {
  const changed = changedAt.map(i => dbs[i]);
  if (MODE === "whole") return patchEvent(renderTable(dbs));
  if (MODE === "signals") return signalEvent(signalsOf(changed));
  return patchEvent(changed.map(renderRow).join(""), MODE === "replace" ? "replace" : undefined);
}

// ---- shared broadcaster: render once per tick, fan out to all clients ----
const clients = new Set();
let loop = null; // AbortController while the simulation is watched

function startLoop() {
  const ac = new AbortController();
  loop = ac;
  console.log("simulation: start");
  (async () => {
    let prev;
    for await (const dbs of watchDatabases(ac.signal)) {
      if (!prev) {
        prev = dbs;
        continue; // each client already got the table on connect
      }
      // Changed rows by reference: the simulation keeps the object of a row
      // that didn't change, the same information Solid's reactivity gets.
      const changedAt = [];
      dbs.forEach((db, i) => db !== prev[i] && changedAt.push(i));
      prev = dbs;
      const event = Buffer.from(tickEvent(dbs, changedAt));
      for (const send of clients) send(event);
    }
  })();
}

function subscribe(send) {
  clients.add(send);
  console.log("clients:", clients.size);
  send(Buffer.from(snapshot(currentDatabases())));
  if (!loop) startLoop();
  return () => {
    clients.delete(send);
    if (!clients.size && loop) {
      loop.abort();
      console.log("simulation: stop");
      loop = null;
    }
  };
}

function page() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DBMon (Datastar)</title>
<style>${css}</style>
<script type="module" src="/datastar.js"></script>
</head>
<body>
<div${MODE === "signals" ? ` data-signals='${esc(JSON.stringify(signalsOf(currentDatabases())))}'` : ""} data-init="@get('/updates')">
${renderTable(currentDatabases())}
</div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") {
    // The page carries the whole table, so it is compressed like the Solid
    // server's streamed document (at the update stream's settings). It used
    // to go out uncompressed: 348 kB at 400 rows instead of about 15.
    const br = acceptsBr(req);
    const html = page();
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      vary: "accept-encoding",
      ...(br ? { "content-encoding": "br" } : {})
    });
    return res.end(
      br
        ? zlib.brotliCompressSync(html, {
            params: {
              [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
              [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
              [zlib.constants.BROTLI_PARAM_LGWIN]: BROTLI_LGWIN
            }
          })
        : html
    );
  }
  if (url.pathname === "/datastar.js") {
    // 33 kB raw, 13 kB brotli: what a Datastar app ships.
    const br = acceptsBr(req);
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "max-age=3600",
      vary: "accept-encoding",
      ...(br ? { "content-encoding": "br" } : {})
    });
    return res.end(br ? datastarJsBr : datastarJs);
  }
  // Runner hooks (see databases.js).
  if (url.pathname === "/__dbmon/pause") {
    globalThis.__dbmon.pause();
    return res.writeHead(204).end();
  }
  if (url.pathname === "/__dbmon/rows") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(globalThis.__dbmon.rows()));
  }
  if (url.pathname === "/updates") {
    const br = acceptsBr(req);
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

server.listen(PORT, () => console.log(`datastar dbmon (${MODE}) on http://localhost:${PORT}`));
