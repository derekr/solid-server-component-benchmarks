// The monitored databases. They live here, on the server, the way a real
// monitoring backend's would: one simulation for every open tab, ticking
// only while someone is watching.
//
// Knobs (environment):
//   DBMON_ROWS       clusters; each is a primary and a replica row (default 50)
//   DBMON_MUTATIONS  share of rows that get a new sample per tick, 0-1 (default 0.5)
//   DBMON_FPS        ticks per second (default 5)
//
// A row that didn't change keeps its object, so a renderer can tell what
// changed by reference.

export interface Query {
  elapsed: number;
  formatted: string;
  className: string;
  text: string;
}

export interface Database {
  id: number;
  name: string;
  count: number;
  countClass: string;
  top5: Query[];
}

const ROWS = Number(process.env.DBMON_ROWS || 50);
const MUTATIONS = Number(process.env.DBMON_MUTATIONS ?? 0.5);
const FPS = Number(process.env.DBMON_FPS || 5);

const QUERIES = [
  "SELECT blah FROM something",
  "<IDLE> in transaction",
  "vacuum",
  "<IDLE>",
  "UPDATE accounts SET balance = balance - 1"
];

function formatElapsed(value: number) {
  let str = value.toFixed(2);
  if (value > 60) {
    const minutes = Math.floor(value / 60);
    const comps = (value % 60).toFixed(2).split(".");
    str = minutes + ":" + comps[0].padStart(2, "0") + "." + comps[1];
  }
  return str;
}

function sample(id: number, name: string): Database {
  const count = Math.floor(Math.random() * 10 + 1) + (Math.random() > 0.9 ? 15 : 0);
  const queries: Query[] = [];
  for (let i = 0; i < count; i++) {
    const elapsed = Math.random() * 15;
    queries.push({
      elapsed,
      formatted: formatElapsed(elapsed),
      className:
        elapsed >= 10 ? "elapsed warn_long" : elapsed >= 1 ? "elapsed warn" : "elapsed short",
      text: QUERIES[Math.floor(Math.random() * QUERIES.length)]
    });
  }
  queries.sort((a, b) => b.elapsed - a.elapsed);
  const top5 = queries.slice(0, 5);
  while (top5.length < 5) top5.push({ elapsed: 0, formatted: "", className: "", text: "" });
  return {
    id,
    name,
    count,
    countClass:
      count >= 20
        ? "label label-important"
        : count >= 10
          ? "label label-warning"
          : "label label-success",
    top5
  };
}

let databases: Database[] = [];
for (let i = 0; i < ROWS; i++) {
  databases.push(sample(i * 2, `cluster${i + 1}`), sample(i * 2 + 1, `cluster${i + 1}slave`));
}

const watchers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

let paused = false;

function tick() {
  if (paused) return;
  databases = databases.map(db => (Math.random() < MUTATIONS ? sample(db.id, db.name) : db));
  for (const notify of watchers) notify();
}

// For the runners: stop the simulation where it is and read back what each
// row should show (its text, as the page's <tr> textContent), so a run can
// check that the page ended on the server's state. Servers expose these as
// /__dbmon/pause and /__dbmon/rows; globalThis because the Solid server's
// route lives outside the bundle that owns this module.
const rowText = (db: Database) => db.name + db.count + db.top5.map(q => q.formatted + q.text).join("");
(globalThis as any).__dbmon = {
  pause: () => void (paused = true),
  rows: () => databases.map(db => ({ id: db.id, text: rowText(db) }))
};

/** How many rows the table has (fixed for the server's life). */
export const rowCount = () => databases.length;

/** The databases now, then again after every tick, until `signal` aborts. */
export async function* watchDatabases(signal?: AbortSignal): AsyncGenerator<Database[]> {
  let wake: (() => void) | undefined;
  let dirty = false;
  const notify = () => {
    dirty = true;
    wake?.();
  };
  watchers.add(notify);
  timer ??= setInterval(tick, 1000 / FPS);
  const stop = () => {
    watchers.delete(notify);
    if (!watchers.size && timer) (clearInterval(timer), (timer = undefined));
    wake?.();
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    yield databases;
    while (!signal?.aborted) {
      if (!dirty) await new Promise<void>(r => (wake = r));
      wake = undefined;
      if (signal?.aborted) return;
      dirty = false;
      yield databases;
    }
  } finally {
    stop();
  }
}

/** A row as the client-rendered dashboards show it: no raw `elapsed`. */
export interface Row {
  id: number;
  name: string;
  count: number;
  countClass: string;
  top5: { formatted: string; className: string; text: string }[];
}

// Cached per row object, so a row that didn't change keeps its identity and
// the wire sends it as a reference.
const rows = new WeakMap<Database, Row>();
function rowOf(db: Database): Row {
  let row = rows.get(db);
  if (!row) {
    const { id, name, count, countClass, top5 } = db;
    row = { id, name, count, countClass, top5: top5.map(({ formatted, className, text }) => ({ formatted, className, text })) };
    rows.set(db, row);
  }
  return row;
}

/** `watchDatabases`, carrying only what a client renders. */
export async function* watchRows(signal?: AbortSignal): AsyncGenerator<Row[]> {
  for await (const databases of watchDatabases(signal)) yield databases.map(rowOf);
}
