#!/bin/bash
# The DBMon explorations: everything README's "Live table: explorations"
# section reports, written to results/dbmon/. Build first:
#   pnpm install && pnpm --filter dbmon-solid build
#   (cd apps/dbmon-go && go build -o dbmon-go .)   # Go 1.24+, libbrotli-dev
# Run one part with `./explorations.sh method` (or load, window, backend);
# no argument runs all of them, about 5 hours on a 4-core machine.
set -e
cd "$(dirname "$0")"
OUT=../results/dbmon
mkdir -p $OUT
PARTS=${1:-method load window backend}
machine() {
  { echo "date: $(date -u +%F)"; echo "cpu: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs) x $(nproc)";
    echo "memory: $(free -g | awk '/Mem:/ {print $2}') GB"; echo "node: $(node -v)"; command -v go >/dev/null && echo "go: $(go version | cut -d' ' -f3)";
    echo "chromium: $(node -e "import('playwright').then(async ({chromium}) => { const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}); console.log(b.version()); await b.close() })")"; } > $OUT/machine.txt
}
machine

for part in $PARTS; do case $part in
method)
  # Ryan's 400-row comparison with the framework / browser split, Datastar's
  # other styles, the final-DOM check and the heap.
  node dbmon-client.mjs 400 0.1 5 4 7 > $OUT/client.jsonl
  LAYOUT=fixed node dbmon-client.mjs 400 0.1 5 4 3 > $OUT/client-fixed-layout.jsonl
  # More rounds near the scaling cliff (the article's sweep used 3).
  for r in 600 800 1000 1500 2000; do APPS=dbmon-solid,dbmon-spa,dbmon-hypermedia-rows,dbmon-hypermedia-signals node dbmon-client.mjs $r 0.1 5 4 5; done > $OUT/client-sweep.jsonl
  node dbmon-viewers.mjs 1,25,100 2 > $OUT/viewers.jsonl
  ;;
load)
  # First load of the live table, which the article doesn't measure for
  # DBMon: bytes, time to table, time to live; then Lighthouse's mobile
  # preset on the same pages, as the article scores its HN and store pages.
  node dbmon-load.mjs 400 4 7 > $OUT/load.jsonl
  node lighthouse.mjs dbmon 15 $OUT/lighthouse > $OUT/lighthouse.txt
  ;;
window)
  # Windowed tables, the way a real app shows a big live one: the Solid SPA
  # window (every row as data, TanStack Virtual), the Solid server-component
  # window and the Datastar window (the server renders the slice).
  W=dbmon-spa-window,dbmon-sc-window,dbmon-hypermedia-window
  APPS=$W node dbmon-client.mjs 400 0.1 5 4 7 > $OUT/window-client.jsonl
  for r in 2000 10000; do APPS=$W node dbmon-client.mjs $r 0.1 5 4 3; done >> $OUT/window-client.jsonl
  APPS=$W node dbmon-load.mjs 400 4 5 > $OUT/window-load.jsonl
  APPS=$W node dbmon-load.mjs 10000 4 3 >> $OUT/window-load.jsonl
  APPS=$W node dbmon-viewers.mjs 1,25,100 2 > $OUT/window-viewers.jsonl
  # Scrolling behind a round trip, with Datastar's latency mitigations.
  for round in 1 2 3; do for rtt in 0 70 150; do for cpu in 4 1; do
    node dbmon-scroll.mjs 2000 $rtt $cpu | sed "s/^{/{\"round\":$round,/"
  done; done; done > $OUT/window-scroll.jsonl
  ;;
backend)
  # Solid on Node against the Datastar port on Go, and the same Datastar
  # port on Node, so the language and the compressor can be told apart.
  SOLID=dbmon-solid,dbmon-spa,dbmon-spa-window,dbmon-sc-window
  GO=dbmon-go-rows,dbmon-go-rows-cbrotli,dbmon-go-signals,dbmon-go-signals-cbrotli,dbmon-go-window,dbmon-go-window-cbrotli
  APPS=$SOLID,$GO,dbmon-hypermedia-rows,dbmon-hypermedia-window node dbmon-viewers.mjs 1,10,25,50,100,250 2 > $OUT/backend-viewers.jsonl
  # One viewer in the browser: does the backend show up there at all?
  APPS=$SOLID,dbmon-go-rows,dbmon-go-signals,dbmon-go-window node dbmon-client.mjs 400 0.1 5 4 3 > $OUT/backend-client.jsonl
  APPS=$SOLID,dbmon-go-rows,dbmon-go-signals,dbmon-go-window node dbmon-load.mjs 400 4 5 > $OUT/backend-load.jsonl
  # Under load: server on cores 2-3; browser, runner and background viewers on 0-1.
  export SERVER_CPUS=2,3
  T="taskset -c 0,1"
  $T node dbmon-busy.mjs dbmon-solid,dbmon-spa,dbmon-hypermedia-rows,dbmon-go-rows,dbmon-go-rows-cbrotli,dbmon-go-signals-cbrotli 1,50,100,250,500 400 0 2 > $OUT/backend-busy-ticks.jsonl
  $T node dbmon-busy.mjs dbmon-spa-window,dbmon-sc-window,dbmon-hypermedia-window-overscan,dbmon-go-window-overscan,dbmon-go-window-overscan-cbrotli 1,50,100,200,300 400 4 2 > $OUT/backend-busy-scroll.jsonl
  # A slow tick: a big table, where rendering is a real share of the server's work.
  $T node dbmon-busy.mjs dbmon-solid,dbmon-spa,dbmon-hypermedia-rows,dbmon-go-rows-cbrotli 1,100 2000 0 1 > $OUT/backend-busy-big.jsonl
  unset SERVER_CPUS
  ;;
esac; done
echo done
