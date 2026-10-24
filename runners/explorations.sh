#!/bin/bash
# The DBMon explorations: everything README's "Live table: explorations"
# section reports, written to results/dbmon/. Build first:
#   pnpm install && pnpm --filter dbmon-solid build
# Run one part with `./explorations.sh method` (or load, window, backend);
# no argument runs all of them, about 6 hours on a 4-core machine.
set -e
cd "$(dirname "$0")"
OUT=../results/dbmon
mkdir -p $OUT
PARTS=${1:-method load}
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
  for r in 600 800 1000 1500 2000; do APPS=dbmon-solid,dbmon-spa,dbmon-hypermedia-rows,dbmon-hypermedia-signals node dbmon-client.mjs $r 0.1 5 4 7; done > $OUT/client-sweep.jsonl
  node dbmon-viewers.mjs 1,25,100 2 > $OUT/viewers.jsonl
  ;;
load)
  # First load of the live table, which the article doesn't measure for
  # DBMon: bytes, time to table, time to live; then Lighthouse's mobile
  # preset on the same pages, as the article scores its HN and store pages.
  node dbmon-load.mjs 400 4 7 > $OUT/load.jsonl
  node lighthouse.mjs dbmon 15 $OUT/lighthouse > $OUT/lighthouse.txt
  ;;
esac; done
echo done
