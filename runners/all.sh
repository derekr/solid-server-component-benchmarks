#!/bin/bash
# Reruns every benchmark the article quotes and writes the output to results/.
# Takes about an hour.
set -e
cd "$(dirname "$0")"
OUT=../results
(cd .. && pnpm sizes) > $OUT/sizes.md
node script-time.mjs 4 cold 7 hn-sc,hn-spa > $OUT/hn-script-time.txt
node script-time.mjs 4 cold 7 hn-sc-toggles,hn-spa-toggles >> $OUT/hn-script-time.txt
node navigation.mjs 5 > $OUT/hn-navigation.txt
node lighthouse.mjs hn 15 $OUT/lighthouse-hn > $OUT/lighthouse-hn.txt
node lighthouse.mjs store 15 $OUT/lighthouse-store > $OUT/lighthouse-store.txt
node dbmon-client.mjs 400 0.1 5 4 3 > $OUT/dbmon-client.jsonl
node dbmon-client.mjs 1000 0.1 5 4 3 >> $OUT/dbmon-client.jsonl
node dbmon-viewers.mjs 1,10,25,50,100 3 > $OUT/dbmon-viewers.jsonl
echo done
