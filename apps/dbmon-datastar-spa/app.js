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
// The markup is the same as the other DBMon pages. A query cell's first child
// is its text, ahead of the popover.
import { rocket } from "/datastar-rocket.js";

const QUERIES = 5;
const rowTemplate = document.createElement("template");
rowTemplate.innerHTML =
  `<tr><td class="dbname"></td><td class="query-count"><span></span></td>` +
  `<td class="Query"> <div class="popover left"><div class="popover-content"></div><div class="arrow"></div></div></td>`.repeat(QUERIES) +
  `</tr>`;

// Rewrite the rows a patch touched. `patch` holds only the changed paths;
// the row's values come from `$dbs`.
window.dbmonPatch = (tbody, patch, dbs) => {
  for (const key of Object.keys(patch.dbs ?? {})) {
    const i = +key;
    const db = dbs[i];
    let tr = tbody.rows[i];
    while (!tr) tbody.append(rowTemplate.content.firstChild.cloneNode(true)), (tr = tbody.rows[i]);
    const cells = tr.cells;
    cells[0].textContent = db.name;
    const count = cells[1].firstChild;
    count.className = db.countClass;
    count.textContent = db.count;
    for (let j = 0; j < QUERIES; j++) {
      const q = db.top5[j], td = cells[j + 2];
      td.className = "Query " + q.className;
      td.firstChild.data = q.formatted;
      td.lastChild.firstChild.textContent = q.text;
    }
  }
};

rocket("db-mon", {
  mode: "light",
  render: ({ html }) =>
    html`<table class="table table-striped latest-data" data-init="@get('/updates')"><tbody data-on-signal-patch="dbmonPatch(el, patch, $dbs)"></tbody></table>`
});
