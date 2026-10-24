// The client-rendered dashboard as a virtualized list: the server streams
// the whole table as data after every tick (as in `spa.tsx`), and the browser
// renders only the rows in a scrolling viewport, picked by TanStack Virtual
// (`~/lib/virtual`). The Solid counterpart of the Datastar port's
// `PATCH=window`, with the same viewport and row height.
//
// Overscan is TanStack's: OVERSCAN rows above and below the viewport
// (`?overscan=N` overrides it). The rows are already here, so it only has to
// cover what a scroll uncovers before the next frame renders; Datastar's
// window needs far more (DBMON_OVERSCAN=40) because its rows are a round
// trip away.
//
// What this design buys and what it costs:
//   - Jumps are local. Every row is already in memory, so a jump anywhere
//     renders in about a frame, whatever the latency to the server.
//   - Its cost follows the table, not the screen. Every tick sends, decodes
//     and holds the whole table, so the wire, the client's decode and the
//     server's encode grow with the row count: at 10,000 rows it is several
//     times the server-windowed versions (Datastar's PATCH=window and
//     `sc-window.tsx`), and the first table waits for all of it.
// A live table this big would usually page or window on the server instead;
// `sc-window.tsx` is that shape in Solid.
import { For, Loading, Show, createMemo, createSignal, onSettled } from "solid-js";
import { broadcast } from "@solidjs/web/server-functions";
import { watchRows, type Row } from "~/server/databases";
import { createVirtualRange } from "~/lib/virtual";

const ROW_HEIGHT = 37; // px, pinned so the offset is exact
const OVERSCAN = 5;

const getDatabaseData = broadcast(async function* (): AsyncGenerator<Row[]> {
  "use server";
  yield* watchRows();
});

export default function SpaWindow() {
  const [running, setRunning] = createSignal(false);
  onSettled(() => {
    setRunning(true);
  });
  return (
    <Show when={running()}>
      <Table />
    </Show>
  );
}

function Table() {
  const databases = createMemo(() => getDatabaseData());
  const overscan = Number(new URLSearchParams(location.search).get("overscan") ?? OVERSCAN);
  const [range, viewport] = createVirtualRange({ count: () => databases().length, rowHeight: ROW_HEIGHT, overscan });
  const visible = createMemo(() => databases().slice(range()[0], range()[1]));
  return (
    <Loading fallback={<p>Loading…</p>}>
      <style>{`#dbmon tr{height:${ROW_HEIGHT}px}#dbmon td{white-space:nowrap}`}</style>
      <div id="viewport" ref={viewport} style={{ height: "100vh", "overflow-y": "auto" }}>
        <div style={{ position: "relative", height: `${databases().length * ROW_HEIGHT}px` }}>
          <table
            id="dbmon"
            class="table table-striped latest-data"
            style={{ position: "absolute", top: `${range()[0] * ROW_HEIGHT}px` }}
          >
            <tbody>
              <For each={visible()} keyed={(db: Row) => db.id}>
                {row => (
                  <tr id={"db" + row().id}>
                    <td class="dbname">{row().name}</td>
                    <td class="query-count">
                      <span class={row().countClass}>{row().count}</span>
                    </td>
                    <For each={row().top5} keyed={false}>
                      {query => (
                        <td class={"Query " + query().className}>
                          {query().formatted}
                          <div class="popover left">
                            <div class="popover-content">{query().text}</div>
                            <div class="arrow" />
                          </div>
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </Loading>
  );
}
