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
//   window   a scrolling viewport that shows DBMON_WINDOW rows (default 40)
//            of the table, rendered with DBMON_OVERSCAN rows (default 0)
//            above and below it: the client posts its scroll offset, the
//            server pushes the rendered slice down the one open stream and
//            then the changed rows within it. DBMON_SCROLL_PATCH=delta sends
//            a scroll as only the rows that entered and left the slice
//            (prepend, append, remove) instead of morphing the whole slice.
//            DBMON_WINDOW_FETCH=get fetches slices instead (see "window
//            mode, GET slices" below)
// rows, replace and signals are the usual next step when measuring says the
// whole region costs too much: narrow the patch to what changed. window is
// how a hypermedia app would show a big live table at all.
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
if (!["whole", "rows", "replace", "signals", "window"].includes(MODE)) throw new Error(`unknown PATCH=${MODE}`);
const WINDOW = Number(process.env.DBMON_WINDOW || 40);
const OVERSCAN = Number(process.env.DBMON_OVERSCAN || 0);
const SCROLL_PATCH = process.env.DBMON_SCROLL_PATCH || "morph";
const FETCH = process.env.DBMON_WINDOW_FETCH || "stream"; // window mode: "stream" or "get"
if (!["stream", "get"].includes(FETCH)) throw new Error(`unknown DBMON_WINDOW_FETCH=${FETCH}`);
const GET = MODE === "window" && FETCH === "get";
const STEP = Number(process.env.DBMON_STEP || 20); // GET slices: rows per grid cell
const ROW_HEIGHT = 37; // px; window mode pins each row to it so offsets are exact
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

function renderTable(dbs, { offset } = {}) {
  const row = MODE === "signals" ? renderSignalRow : renderRow;
  // Window mode positions the slice with the `_top` signal, so a delta
  // scroll can move it without re-sending the table.
  const style =
    offset != null
      ? ` style="position:absolute;top:${offset * ROW_HEIGHT}px" data-attr:style="'position:absolute;top:' + $_top + 'px'"`
      : "";
  let h = `<table id="dbmon" class="table table-striped latest-data"${style}><tbody>`;
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

// ---- window mode ----
// The rows a window-mode client has rendered: what's on screen plus overscan.
//
// On jumps (a scroll to a place the client has no rows for): the window pays
// one round trip, the post and the slice coming back, because the rows live
// on the server. Overscan and the 32 ms scroll posts below hide it for a
// continuous scroll, since the slice arrives before the viewport gets there.
// A jump is a different case and depends on how much warning the UI gives:
//   - a link, search result, "go to row" button or tree item: hover comes a
//     few hundred ms before the click and pointerdown 80-120 ms before it,
//     so posting the target offset on either (as derekr/largediff prewarms
//     on hover) hides most of a 70-150 ms round trip;
//   - a scrollbar drag, the End key, a scroll set in code (what
//     dbmon-scroll.mjs does): no warning. The usual answers are coarse rows
//     streamed while the drag is in progress, or a cheap index on the
//     client (names only) so the jump shows a skeleton at once and fills in
//     a round trip later.
// None of this is Datastar-specific: any server-windowed view pays the same
// round trip and takes the same fixes, the Solid server-component window
// (dbmon-solid /sc-window) included. Only a client that already holds every
// row (the Solid SPA window) skips it, and pays for holding them instead.
const rangeOf = (offset, n) => [Math.max(0, offset - OVERSCAN), Math.min(n, offset + WINDOW + OVERSCAN)];
const windowEvent = (dbs, offset) => {
  const [from, to] = rangeOf(offset, dbs.length);
  return signalEvent({ _top: from * ROW_HEIGHT }) + patchEvent(renderTable(dbs.slice(from, to), { offset: from }));
};
// A scroll from one offset to another, as the rows that left and entered
// the slice. Falls back to the whole slice when the two don't overlap.
function scrollEvent(dbs, before, after) {
  const [a0, a1] = rangeOf(before, dbs.length), [b0, b1] = rangeOf(after, dbs.length);
  if (SCROLL_PATCH !== "delta" || b0 >= a1 || b1 <= a0) return windowEvent(dbs, after);
  const ids = (from, to) => dbs.slice(from, to).map(db => `#db${db.id}`);
  const gone = [...ids(a0, Math.min(b0, a1)), ...ids(Math.max(b1, a0), a1)];
  const rows = (from, to) => dbs.slice(from, to).map(renderRow).join("");
  let event = signalEvent({ _top: b0 * ROW_HEIGHT });
  if (gone.length) event += `event: datastar-patch-elements\ndata: mode remove\ndata: selector ${gone.join(", ")}\n\n`;
  if (b0 < a0) event += `event: datastar-patch-elements\ndata: mode prepend\ndata: selector #dbmon > tbody\ndata: elements ${rows(b0, a0)}\n\n`;
  if (b1 > a1) event += `event: datastar-patch-elements\ndata: mode append\ndata: selector #dbmon > tbody\ndata: elements ${rows(a1, b1)}\n\n`;
  return event;
}

// ---- window mode, GET slices (DBMON_WINDOW_FETCH=get) ----
// The same window with its rows fetched, not pushed: a scroll into a new
// grid cell (STEP rows) GETs that cell's slice, plain HTML that Datastar
// morphs in, and every slice patches in a <link rel="preload"> for each of
// the next DBMON_AHEAD cells (default 2) in the direction the page is
// scrolling (the `_dir` signal picks between the cells above and below), so
// a scroll that keeps going finds the next slice already fetched. A slice URL is the same for every client (no signals in
// it), which is what lets a preload stand in for the fetch. The cost is what
// the stream saves: each slice is its own request and its own brotli
// context, where a push down the stream reuses the context's window.
//
// The stream stays open for the live updates. A slice carries the tick it
// was rendered at; once it is on the page it posts its cell and that tick
// to /view, and the server sends the rows of the cell that changed since
// (a preloaded slice can be a few ticks old), then each tick's changes.
let tickNo = 0;
const history = []; // the last 64 ticks: { tick, changedAt }
const cellOf = offset => Math.floor(offset / STEP) * STEP;
// The rows a cell's slice holds, as the Solid server-component window cuts
// them: OVERSCAN rows above the cell, and the viewport plus STEP rows below
// its first row, so a scroll within the cell never uncovers a row.
const cellRange = (cell, n) => [Math.max(0, cell - OVERSCAN), Math.min(n, cell + WINDOW + STEP)];
const sliceUrl = cell => `/slice?cell=${cell}&datastar=%7B%7D`; // as Datastar's @get sends it, with an empty payload
const AHEAD = Number(process.env.DBMON_AHEAD || 2); // GET slices: cells preloaded ahead
const preloadLink = (cell, n) => {
  const url = c => (c >= 0 && c < n ? `'${sliceUrl(c)}'` : "null");
  let h = "";
  for (let k = 1; k <= AHEAD; k++)
    h += `<link id="slice-ahead-${k}" rel="preload" as="fetch" crossorigin data-attr:href="$_dir < 0 ? ${url(cell - k * STEP)} : ${url(cell + k * STEP)}">`;
  return h;
};
function slice(dbs, cell) {
  const [from, to] = cellRange(cell, dbs.length);
  return (
    renderTable(dbs.slice(from, to), { offset: from }).replace(/ data-attr:style="[^"]*"/, "") +
    `<div id="slice-meta" data-init="$cell = ${cell}; $tick = ${tickNo}; @post('/view', {requestCancellation: 'disabled'})"></div>` +
    preloadLink(cell, dbs.length)
  );
}
// The rows of a client's cell that changed after `since`, or all of them if
// that tick is no longer in the history.
function catchUp(dbs, client, since) {
  const [from, to] = cellRange(client.cell, dbs.length);
  const known = history.length && since >= history[0].tick - 1;
  const at = new Set();
  if (known) for (const h of history) if (h.tick > since) for (const i of h.changedAt) i >= from && i < to && at.add(i);
  const rows = known ? [...at].sort((a, b) => a - b).map(i => renderRow(dbs[i])) : dbs.slice(from, to).map(renderRow);
  return rows.length ? patchEvent(rows.join("")) : null;
}

// What a client that just connected gets: everything it shows, as of now
// (the page it loaded may be a tick or two old).
const snapshot = (dbs, client) =>
  MODE === "signals" ? signalEvent(signalsOf(dbs))
  : GET ? catchUp(dbs, client, client.tick)
  : MODE === "window" ? windowEvent(dbs, client.offset)
  : patchEvent(renderTable(dbs));

// What a tick sends, given the indexes of the rows that changed. null =
// nothing to send.
function tickEvent(dbs, changedAt, client) {
  const changed = changedAt.map(i => dbs[i]);
  if (MODE === "whole") return patchEvent(renderTable(dbs));
  if (MODE === "window") {
    const [from, to] = GET ? cellRange(client.cell, dbs.length) : rangeOf(client.offset, dbs.length);
    const shown = changedAt.filter(i => i >= from && i < to);
    return shown.length ? patchEvent(shown.map(i => renderRow(dbs[i])).join("")) : null;
  }
  if (!changed.length) return null;
  if (MODE === "signals") return signalEvent(signalsOf(changed));
  return patchEvent(changed.map(renderRow).join(""), MODE === "replace" ? "replace" : undefined);
}

// ---- shared broadcaster: render once per tick, fan out to all clients ----
// (window mode renders per client: each one shows its own slice.)
const clients = new Set();
const byId = new Map(); // window mode: client id -> client, for /view
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
      history.push({ tick: ++tickNo, changedAt });
      if (history.length > 64) history.shift();
      if (MODE === "window") {
        for (const client of clients) {
          const event = tickEvent(dbs, changedAt, client);
          if (event) client.send(Buffer.from(event));
        }
        continue;
      }
      const event = tickEvent(dbs, changedAt);
      if (!event) continue;
      const buf = Buffer.from(event);
      for (const client of clients) client.send(buf);
    }
  })();
}

function subscribe(client) {
  clients.add(client);
  if (client.id) byId.set(client.id, client);
  console.log("clients:", clients.size);
  const first = snapshot(currentDatabases(), client);
  if (first) client.send(Buffer.from(first));
  if (!loop) startLoop();
  return () => {
    clients.delete(client);
    if (byId.get(client.id) === client) byId.delete(client.id);
    if (!clients.size && loop) {
      loop.abort();
      console.log("simulation: stop");
      loop = null;
    }
  };
}

function page() {
  const dbs = currentDatabases();
  let body, head = "";
  if (GET) {
    // The window with slices fetched by cell (see "window mode, GET slices").
    // A scroll into a new cell GETs its slice; the slice's own markup posts
    // its cell and tick to /view (slice-meta) and refreshes the preloads
    // for the cells either side.
    const id = Math.random().toString(36).slice(2);
    const cell = `Math.floor(el.scrollTop / ${ROW_HEIGHT * STEP}) * ${STEP}`;
    const view = `$_want !== ${cell} && ($_dir = ${cell} > $_want ? 1 : -1, $_want = ${cell}, @get('/slice?cell=' + $_want, {payload: {}}))`;
    const [from, to] = cellRange(0, dbs.length);
    head = preloadLink(0, dbs.length) + "\n";
    body = `<style>#dbmon tr{height:${ROW_HEIGHT}px}#dbmon td{white-space:nowrap}</style>
<div id="viewport" style="height:100vh;overflow-y:auto" data-signals:cid="'${id}'" data-signals:cell="0" data-signals:tick="${tickNo}" data-signals:_want="0" data-signals:_dir="1"
  data-on:scroll__throttle.32ms="${view}" data-on:scrollend="${view}">
<div style="position:relative;height:${dbs.length * ROW_HEIGHT}px" data-init="@get('/updates')">
${renderTable(dbs.slice(from, to), { offset: from }).replace(/ data-attr:style="[^"]*"/, "")}
</div>
</div>
<div id="slice-meta"></div>`;
  } else if (MODE === "window") {
    // A viewport over the whole table: a spacer as tall as every row, the
    // rendered slice positioned in it. One stream stays open; scrolling posts
    // the offset (throttled to 32 ms, plus a last one on scrollend) and the
    // server pushes the new slice down the stream, the transport of
    // derekr/largediff. The id ties the posts to the stream.
    const id = Math.random().toString(36).slice(2);
    const [from, to] = rangeOf(0, dbs.length);
    const view = `$offset = Math.floor(el.scrollTop / ${ROW_HEIGHT}); @post('/view')`;
    body = `<style>#dbmon tr{height:${ROW_HEIGHT}px}#dbmon td{white-space:nowrap}</style>
<div id="viewport" style="height:100vh;overflow-y:auto" data-signals:offset="0" data-signals:_top="0" data-signals:cid="'${id}'"
  data-on:scroll__throttle.32ms="${view}" data-on:scrollend="${view}">
<div style="position:relative;height:${dbs.length * ROW_HEIGHT}px" data-init="@get('/updates')">
${renderTable(dbs.slice(from, to), { offset: from })}
</div>
</div>`;
  } else {
    const signals = MODE === "signals" ? ` data-signals='${esc(JSON.stringify(signalsOf(dbs)))}'` : "";
    body = `<div${signals} data-init="@get('/updates')">
${renderTable(dbs)}
</div>`;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DBMon (Datastar)</title>
<style>${css}</style>
${head}<script type="module" src="/datastar.js"></script>
</head>
<body>
${body}
</body>
</html>`;
}

// A window-mode client's signals: Datastar sends them as the `datastar`
// query parameter on a GET and as the JSON body of a POST.
function viewOf(json) {
  const clamp = v => Math.max(0, Math.min(Math.floor(Number(v) || 0), currentDatabases().length - 1));
  try {
    const { cid, offset, cell, tick } = JSON.parse(json || "{}");
    return { id: String(cid ?? ""), offset: clamp(offset), cell: cellOf(clamp(cell)), tick: Number(tick) || 0 };
  } catch {
    return { id: "", offset: 0, cell: 0, tick: 0 };
  }
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
  if (url.pathname === "/__dbmon/ticks") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(globalThis.__dbmon.ticks()));
  }
  if (url.pathname === "/view" && req.method === "POST") {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const { id, offset, cell, tick } = viewOf(body);
      const client = byId.get(id);
      if (GET) {
        // A slice is on the page: this client's ticks now cover its cell,
        // starting with what changed since the slice was rendered.
        if (client) {
          client.cell = cell;
          const event = catchUp(currentDatabases(), client, tick);
          if (event) client.send(Buffer.from(event));
        }
      } else if (client && client.offset !== offset) {
        client.send(Buffer.from(scrollEvent(currentDatabases(), client.offset, offset)));
        client.offset = offset;
      }
      res.writeHead(204).end();
    });
    return;
  }
  if (GET && url.pathname === "/slice") {
    // A cell's slice, as HTML for Datastar to morph in, compressed on its own
    // at the update stream's settings.
    const html = slice(currentDatabases(), cellOf(Math.max(0, Number(url.searchParams.get("cell")) || 0)));
    const br = acceptsBr(req);
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
    const unsubscribe = subscribe({ send, ...viewOf(url.searchParams.get("datastar")) });
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
