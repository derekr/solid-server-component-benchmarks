// The bundle-size table in the article: the same small app (a signal, a memo,
// Show/For/Loading/Errored and a lazy route) built four ways. Each entry is
// bundled with Rolldown (the bundler Vite ships), minified, and the eager
// graph (entry plus statically imported chunks) brotli-compressed at quality
// 11. Lazy chunks (the route, the serialization codec) are reported apart and
// not counted, the way solidjs/solid's own size checks count them.
import { readdirSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
import { rolldown } from "rolldown";

const br = s => brotliCompressSync(s, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const kb = b => (b / 1000).toFixed(1) + " KB";
const entries = readdirSync(new URL("./entries", import.meta.url)).filter(f => /^\d/.test(f)).sort();

const rows = [];
for (const file of entries) {
  const b = await rolldown({
    input: new URL("./entries/" + file, import.meta.url).pathname,
    platform: "browser",
    treeshake: true,
    logLevel: "silent"
  });
  const { output } = await b.generate({ format: "es", minify: true });
  await b.close();
  const chunks = output.filter(o => o.type === "chunk");
  const eager = [chunks.find(c => c.isEntry)];
  for (const c of eager)
    for (const name of c.imports) {
      const dep = chunks.find(d => d.fileName === name);
      if (dep && !eager.includes(dep)) eager.push(dep);
    }
  const lazy = chunks.filter(c => !eager.includes(c));
  rows.push({
    entry: file.replace(/\.js$/, ""),
    minified: eager.reduce((n, c) => n + c.code.length, 0),
    brotli: eager.reduce((n, c) => n + br(c.code), 0),
    lazyBrotli: lazy.reduce((n, c) => n + br(c.code), 0)
  });
}
console.log("| Entry | Eager JS (brotli) | Minified | Lazy, not counted (brotli) |");
console.log("| --- | ---: | ---: | ---: |");
for (const r of rows) console.log(`| ${r.entry} | ${kb(r.brotli)} | ${kb(r.minified)} | ${kb(r.lazyBrotli)} |`);
