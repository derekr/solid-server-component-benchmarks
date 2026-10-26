#!/bin/bash
# Preloads on vs off, same machine, alternating.
R=/home/claude/solid-server-component-benchmarks
cd $R/runners
export CHROME_PATH=/opt/pw-browsers/chromium
OUT=/tmp/claude-0/ab
off() {
  sed -i 's/^const preloadLink = pathname =>$/const preloadLink = pathname => "" \&\&/' $R/apps/hn-sc-toggles/server.js $R/apps/dbmon-solid/server.js
  sed -i '/<link rel="modulepreload" href="\/datastar-rocket.js">/d' $R/apps/hn-datastar-spa/server.js $R/apps/dbmon-datastar-spa/server.js $R/apps/store-datastar-spa/server.js
}
on() { git -C $R checkout -- apps/hn-sc-toggles/server.js apps/dbmon-solid/server.js apps/hn-datastar-spa/server.js apps/dbmon-datastar-spa/server.js apps/store-datastar-spa/server.js; }
trap on EXIT
for pass in 1 2; do for v in off on; do
  $v
  echo "== $pass $v $(date +%T)"
  git -C $R diff --stat
  node script-time.mjs 4 cold 5 hn-sc-toggles,hn-datastar-spa > $OUT/st-$v-$pass.txt
  APPS=dbmon-solid,dbmon-spa,dbmon-spa-window,dbmon-sc-window,dbmon-datastar-spa node dbmon-load.mjs 400 4 3 | sed "s/^{/{\"preload\":\"$v\",\"pass\":$pass,/" >> $OUT/load.jsonl
done; done
echo "== DONE $(date +%T)"
