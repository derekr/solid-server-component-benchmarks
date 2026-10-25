// The table, rendered in the browser. `$dbs` is a global signal the server
// patches over SSE (every row on connect, then only the rows that changed,
// merged by index): the one piece of state, read by one binding.
//
// There is no binding per row or cell. One data-on-signal-patch on the table
// runs on every patch to `$dbs` and rewrites only the rows the patch touched,
// from `$dbs`, creating the rows on the first patch. A binding per cell (a
// data-for row with data-text, data-attr and data-effect on each cell) is
// some 12,000 bindings at 1,000 rows, and Datastar pays for each binding.
//
// Two things keep the per-tick cost down at 2,000 rows:
// - Every text is an existing text node whose `data` is set. Datastar and
//   Rocket each watch the whole document for added nodes and attributes (to
//   find data-* attributes and Rocket hosts), and setting `textContent`
//   replaces the text node, a childList record both observers walk: some
//   3,600 a tick at 2,000 rows. Changing a text node's data is characterData,
//   which neither watches. Classes are only set when they change.
// - A patch only marks rows dirty; the rows are written once per frame. When
//   the page falls behind, the ticks that land between two frames cost one
//   write per row instead of one per tick.
//
// The markup is the same as the other DBMon pages. A query cell's first child
// is its text, ahead of the popover.
import { rocket } from "/datastar-rocket.js";

const QUERIES = 5;
const rowTemplate = document.createElement("template");
rowTemplate.innerHTML =
  `<tr><td class="dbname"></td><td class="query-count"><span></span></td>` +
  `<td class="Query"> <div class="popover left"><div class="popover-content"></div><div class="arrow"></div></div></td>`.repeat(QUERIES) +
  `</tr>`;
// An empty text node in each empty text slot, so every write is to `data`.
for (const el of rowTemplate.content.querySelectorAll(".dbname, .query-count span, .popover-content")) el.append("");

const setText = (node, value) => node.data !== value && (node.data = value);
const setClass = (el, value) => el.className !== value && (el.className = value);

const writeRow = (tr, db) => {
  const cells = tr.cells;
  setText(cells[0].firstChild, db.name);
  const count = cells[1].firstChild;
  setClass(count, db.countClass);
  setText(count.firstChild, String(db.count));
  for (let j = 0; j < QUERIES; j++) {
    const q = db.top5[j], td = cells[j + 2];
    setClass(td, "Query " + q.className);
    setText(td.firstChild, q.formatted);
    setText(td.lastChild.firstChild.firstChild, q.text);
  }
};

// Mark the rows a patch touched (`patch` holds only the changed paths) and
// write them on the next frame from `$dbs`.
const dirty = new Set();
let frame = 0;
window.dbmonPatch = (tbody, patch, dbs) => {
  for (const key of Object.keys(patch.dbs ?? {})) dirty.add(+key);
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    for (const i of dirty) {
      while (!tbody.rows[i]) tbody.append(rowTemplate.content.firstChild.cloneNode(true));
      writeRow(tbody.rows[i], dbs[i]);
    }
    dirty.clear();
  });
};

rocket("db-mon", {
  mode: "light",
  render: ({ html }) =>
    html`<table class="table table-striped latest-data" data-init="@get('/updates')"><tbody data-on-signal-patch="dbmonPatch(el, patch, $dbs)"></tbody></table>`
});
