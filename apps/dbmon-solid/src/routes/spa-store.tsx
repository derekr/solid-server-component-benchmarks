// The client-rendered dashboard with the data reconciled into a store: the
// server streams the whole table as data after every tick, and the store
// diffs it by row id, so only the cells whose values changed update.
// Compare `spa.tsx`, which swaps each row's object and lets the row's
// bindings re-check their values.
import { For, Loading, Show, createSignal, createStore, onSettled } from "solid-js";
import { broadcast } from "@solidjs/web/server-functions";
import { watchRows, type Row } from "~/server/databases";

const getDatabaseData = broadcast(async function* (): AsyncGenerator<Row[]> {
  "use server";
  yield* watchRows();
});

export default function SpaStore() {
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
  const [databases] = createStore(() => getDatabaseData(), [] as Row[], { key: "id" });
  return (
    <Loading fallback={<p>Loading…</p>}>
      <table class="table table-striped latest-data">
        <tbody>
          <For each={databases}>
            {db => (
              <tr>
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
    </Loading>
  );
}
