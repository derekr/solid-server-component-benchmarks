// The live server component, windowed on the server: the Solid counterpart
// of the Datastar port's `PATCH=window`. The server renders only a slice of
// the table and keeps it live; the browser owns the scrolling viewport and
// asks for a new slice as it scrolls.
//
// The slice is a `liveQuery` over a `broadcast` with the slice's first row
// as its argument. One live connection per argument, shared by every viewer
// looking at the same slice, so slices are cut on a STEP-row grid: viewers
// near each other share one render, and a scroll only reconnects when it
// crosses a grid line. Each slice reaches OVERSCAN rows above its grid line
// and covers the viewport plus STEP rows below, so a scroll within a cell
// never uncovers a row.
//
// Like Datastar's window, a jump costs a round trip (here, a new live
// connection and its first render), because the rows live on the server.
// The same mitigations apply, and Solid has primitives for some of them:
//   - warm the slice before it is needed. liveQuery warms a channel when it
//     is called under preload intent, so hovering a "go to row" link, or
//     reading the scroll direction and calling the next grid cell early,
//     would have the stream open before the jump;
//   - more overscan, biased toward the scroll direction;
//   - a cheap index on the client (names only), so a jump with no warning
//     (a scrollbar drag) shows a skeleton at once.
// None of these are in this benchmark, as none are in Datastar's window
// beyond overscan; see dbmon-hypermedia/server.js for the trade-offs.
//
// One difference from Datastar's window: Datastar keeps one stream per
// viewer and posts the scroll offset to it, while this opens a new live
// connection per grid cell. That reconnect is where its jump time goes.
import { For, Loading, createMemo, createSignal, onCleanup } from "solid-js";
import { dynamicComponent } from "@solidjs/web";
import { broadcast } from "@solidjs/web/server-functions";
import { liveQuery } from "@solidjs/router";
import { watchDatabases, rowCount } from "~/server/databases";

const ROW_HEIGHT = 37; // px, pinned so the offset is exact
const VIEWPORT = 40; // rows, the Datastar window's DBMON_WINDOW
const STEP = 20; // slice grid, rows
const OVERSCAN = 20; // rows above the grid line

const getSlice = liveQuery(
  // `_away` only changes the key; see ScWindow.
  broadcast(async (from: number, _away: 0 | 1) => {
    "use server";
    return () => {
      const gone = new AbortController();
      onCleanup(() => gone.abort());
      const databases = createMemo(() => watchDatabases(gone.signal));
      const start = Math.max(0, from - OVERSCAN);
      const slice = createMemo(() => databases().slice(start, from + VIEWPORT + STEP));
      // The spacer's height is read once (the row count never changes): a
      // reactive value inside a style here came out with the live stream's
      // markers inside the attribute on rc.18, which breaks the style.
      const height = rowCount() * ROW_HEIGHT;
      return (
        <div style={{ position: "relative", height: `${height}px` }}>
          <table id="dbmon" class="table table-striped latest-data" style={{ position: "absolute", top: `${start * ROW_HEIGHT}px` }}>
            <tbody>
              <For each={slice()}>
                {db => (
                  <tr id={"db" + db.id}>
                    <td class="dbname">{db.name}</td>
                    <td class="query-count">
                      <span class={db.countClass}>{db.count}</span>
                    </td>
                    <For each={db.top5}>
                      {query => (
                        <td class={"Query " + query.className}>
                          {query.formatted}
                          <div class="popover left">
                            <div class="popover-content">{query.text}</div>
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
      );
    };
  }),
  "slice"
);

export default function ScWindow() {
  const [from, setFrom] = createSignal(0);
  // Workaround (rc.18): scrolling back to the slice the page was served with
  // reopens its key with the position hydration stamped on it
  // (LIVE_RESUME_FROM), so the server finds nothing new to send and the
  // slice never comes back. Once the viewer has scrolled away, `_away` = 1
  // gives every slice a key hydration never saw.
  const [away, setAway] = createSignal<0 | 1>(0);
  const Slice = dynamicComponent(() => getSlice(from(), away()));
  const onScroll = (e: Event) => {
    const row = Math.floor((e.currentTarget as HTMLElement).scrollTop / ROW_HEIGHT);
    const cell = Math.floor(row / STEP) * STEP;
    if (cell === from()) return;
    setAway(1);
    setFrom(cell);
  };
  return (
    <>
      <style>{`#dbmon tr{height:${ROW_HEIGHT}px}#dbmon td{white-space:nowrap}`}</style>
      <div id="viewport" style={{ height: "100vh", "overflow-y": "auto" }} onScroll={onScroll}>
        <Loading fallback={<p>Loading…</p>}>
          <Slice />
        </Loading>
      </div>
    </>
  );
}
