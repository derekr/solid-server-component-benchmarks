// Datastar DBMon: one shared simulation, the whole table rendered once per
// tick on the server and pushed to every client as a datastar-patch-elements
// SSE event (morphed by id). Per-connection brotli on the SSE stream.
import http from "node:http";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { watchDatabases, currentDatabases } from "./databases.js";

// Brotli settings for the update stream, "quality,window" (default 4,22, a
// common streaming setting; 5,24 gives a 16 MB window, so each connection
// finds the table it sent last tick, at several times the CPU).
const [BROTLI_QUALITY, BROTLI_LGWIN] = (process.env.DBMON_BROTLI || "4,22").split(",").map(Number);

const PORT = Number(process.env.PORT || 3021);
const ROWS_ONLY = process.env.PATCH === "rows";
const dir = new URL(".", import.meta.url).pathname;
const css = readFileSync(dir + "app.css", "utf8");
const datastarJs = readFileSync(dir + "datastar.js");
// Compressed once at startup, as the Solid server's build precompresses its
// static assets (brotli 9).
const datastarJsBr = zlib.brotliCompressSync(datastarJs, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
const acceptsBr = req => /\bbr\b/.test(req.headers["accept-encoding"] || "");

const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Same markup as examples/server-dbmon/src/routes/dashboard.tsx, plus id="dbmon".
function renderRow(db) {
  let h = `<tr id="db${db.id}"><td class="dbname">${esc(db.name)}</td><td class="query-count"><span class="${db.countClass}">${db.count}</span></td>`;
  for (const q of db.top5)
    h += `<td class="Query ${q.className}">${esc(q.formatted)}<div class="popover left"><div class="popover-content">${esc(q.text)}</div><div class="arrow"></div></div></td>`;
  return h + "</tr>";
}

function renderTable(dbs) {
  let h = '<table id="dbmon" class="table table-striped latest-data"><tbody>';
  for (const db of dbs) h += renderRow(db);
  return h + "</tbody></table>";
}

// Datastar SSE event (sdk/ADR.md): one `data: elements` line per HTML line.
const patchEvent = html =>
  "event: datastar-patch-elements\n" +
  html.split("\n").map(l => `data: elements ${l}\n`).join("") +
  "\n";

// ---- shared broadcaster: render once per tick, fan out to all clients ----
const clients = new Set();
let latest = null; // Buffer of the latest event
let loop = null; // AbortController while the simulation is watched

function startLoop() {
  const ac = new AbortController();
  loop = ac;
  console.log('simulation: start');
  (async () => {
    let prev;
    for await (const dbs of watchDatabases(ac.signal)) {
      // PATCH=rows: send only the rows whose sample changed, each morphed by
      // its id; new clients get the whole table on connect.
      const event = ROWS_ONLY && prev
        ? Buffer.from(patchEvent(dbs.filter((db, i) => db !== prev[i]).map(renderRow).join("")))
        : Buffer.from(patchEvent(renderTable(dbs)));
      prev = dbs;
      latest = ROWS_ONLY ? null : event;
      for (const send of clients) send(event);
    }
  })();
}

function subscribe(send) {
  clients.add(send);
  console.log('clients:', clients.size);
  if (!loop) startLoop();
  else send(latest ?? Buffer.from(patchEvent(renderTable(currentDatabases()))));
  return () => {
    clients.delete(send);
    if (!clients.size && loop) {
      loop.abort();
      console.log('simulation: stop');
      loop = null;
      latest = null;
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
<div data-init="@get('/updates')">
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

server.listen(PORT, () => console.log(`datastar dbmon on http://localhost:${PORT}`));
