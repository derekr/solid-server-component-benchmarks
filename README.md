# Solid Server Components benchmarks

The apps and scripts behind "Server Components without the Hype". Every number in the article comes from one of the commands below, so you can rerun it, change the apps, and check whether the conclusions hold on your machine.

Each comparison is a pair of twins: the same routes, markup and data, built once with Solid server components and once as a server-rendered, hydrating Solid SPA (or, for the live table, against a hypermedia stack). Both sides of every pair stream, and both see the same data latency.

## Setup

Requires Node 22+, pnpm 10, and Linux for the server-CPU numbers (they read `/proc`).

```sh
pnpm install
pnpm build                      # builds all apps in apps/
npx playwright install chromium # or set CHROME_PATH to an existing Chromium
```

Everything uses published packages: `next` 16.4.2 and `react` 19.3.1 for the Next app; `solid-js` and `@solidjs/web` 2.0.0-rc.18, `@solidjs/router` 2.0.0-next.42, `@solidjs/vite-plugin` 3.0.0-next.51, Vite 8.3.5. Server components are a preview in these versions.

## The apps

| App | What it is | Port |
| --- | --- | ---: |
| `apps/hn-sc` | Hacker News with server components. The story page is all server markup; comment collapse is a native `<details>`. | 3004 |
| `apps/hn-spa` | The same app as a server-rendered, hydrating SPA. | 3005 |
| `apps/hn-sc-toggles` | `hn-sc` with a client `Toggle` component in a slot on every comment that has replies (652 on the test story). | 3006 |
| `apps/hn-spa-toggles` | `hn-spa` with the same toggle as a client signal per comment. | 3007 |
| `apps/hn-next-rsc` | The toggles app on Next.js 16 with React Server Components (`Toggle` is a `"use client"` component), from Ryan's 2024 [next-rsc-hackernews](https://github.com/ryansolid/next-rsc-hackernews). | 3008 |
| `apps/hn-qwik` | The toggles app on Qwik City 1.20 (resumable: no hydration, handlers load on first use), from Ryan's 2024 [qwik-hn-spa](https://github.com/ryansolid/qwik-hn-spa), with client routing and a `Toggle` component per comment. | 3010 |
| `apps/store-sc` | A small storefront with server components: listing (48 tiles, quick add on each) and product page (gallery, buy box, 12 reviews). Only the cart, quick add and buy box hydrate. | 3013 |
| `apps/store-spa` | The same store as a server-rendered, hydrating SPA. | 3014 |
| `apps/dbmon-solid` | DBMon as a live server component (`broadcast()`): rendered on the server, changed rows streamed to every tab. | 3020 |
| `apps/dbmon-solid` at `/spa` | The same table rendered in the browser as an SPA: the server streams the rows as data through a `broadcast()` data source and a keyed `For` swaps each changed row (`/spa-store` reconciles into a store instead). | 3023, 3024 |
| `apps/dbmon-hypermedia` | The same table on [Datastar](https://data-star.dev) 1.0.4, rendered once per tick on the server and pushed to every client as an SSE patch, morphed by id. Two styles: the whole table every tick (port 3021), or only the changed rows (`PATCH=rows`, port 3022). A hand-written port in Datastar's style, not one of Datastar's own demos; improvements welcome. | 3021, 3022 |
| `apps/dbmon-hypermedia` with `PATCH=replace`, `PATCH=signals` | Datastar's other update styles: the changed rows swapped in without a morph, or the table bound to signals and patched with values (`datastar-patch-signals`). | 3025, 3026 |

Notes on fairness:
- **Same data, same latency.** The HN apps serve one cached story (30186326, about 1,500 comments) after a fixed `HN_DELAY_MS=150` delay, so neither side gets instant data. The feed and user pages call the live HN API. The store's catalog is in memory with no delay, on both sides.
- **Same simulation.** Both DBMon apps run the same `databases` module (rows, change rate and tick rate set by `DBMON_ROWS`, `DBMON_MUTATIONS`, `DBMON_FPS`), and both compress each connection with brotli quality 4 and a 4 MB window, a common streaming setting (`DBMON_BROTLI=quality,window` overrides it for both).
- **Same language.** Both DBMon servers are Node. A Go or Rust server would cut the hypermedia stack's server cost; it would not change the client side.
- **Same first-load compression.** The Datastar page and `datastar.js` are brotli-compressed, as the Solid server compresses its document and assets. They used to go out uncompressed (about 348 kB of page and 33 kB of script at 400 rows, instead of 15 kB and 13 kB). None of the live-table runners below measure first load, so this changes none of their numbers.

## Rerunning the article's numbers

`runners/all.sh` reruns everything below (about an hour) and writes to `results/`. The "rerun" column is from that script on 2026-10-23, on rc.18, in a 4-core Linux cloud container. The "article" column is what the article quotes, measured during development (2026-10-14 to 10-21) on unreleased builds and sometimes a slower machine. The two disagree in size but not in direction. The live-table results are new: they compare against an SPA and two styles of the Datastar port, which the article's first draft did not. rc.18 shares a `broadcast()` data source across viewers (solidjs/solid#4230), which the SPA's server column depends on, and sends a live table's changed rows as in-place edits instead of row markup (solidjs/solid#4239). Client runs use 4x CPU throttling, Lighthouse's mobile default.

### Bundle size: the fixed cost

```sh
pnpm sizes
```

The same small app (a signal, a memo, `Show`, `For`, `Loading`, `Errored`, a lazy route) built four ways, eager JS only, brotli:

| Built as | Article | Rerun |
| --- | ---: | ---: |
| Client-rendered SPA | 13.1 KB | 13.4 KB |
| Server-rendered, hydrating SPA | 18.2 KB | 18.4 KB |
| Hydrating SPA calling server functions | 22.0 KB | 22.2 KB |
| Server components page | 33.1 KB | 33.3 KB |

### Hacker News thread, 652 client toggles

```sh
cd runners && node lighthouse.mjs hn 15
```

Lighthouse 12 mobile preset, 15 interleaved rounds, medians. The rerun includes `hn-next-rsc`, the same app on Next.js 16 with React Server Components and the same client toggle, and `hn-qwik`, the same app on Qwik City (see their READMEs for what was changed to measure them like for like).:

| | Article SC / SPA | Rerun SC / SPA / Next RSC / Qwik City |
| --- | --- | --- |
| Score | 91 / 79 | 96 / 91 / 78 / 82 |
| Total Blocking Time | 212 / 568 ms | 19 / 168 / 355 / 36 ms |
| LCP | | 2.25 / 2.56 / 3.77 / 3.61 s |
| Transferred | 267 / 342 kB | 263 / 340 / 469 / 529 kB |
| HTML document | | 213 / 300 / 303 / 481 kB |
| JavaScript | | 47 / 38 / 131 / 43 kB |

Qwik blocks the main thread least after ours: it resumes instead of hydrating. It paints later, and its document is more than twice ours (481 vs 213 kB): it carries the story twice, as HTML and as serialized state for resuming. Its JavaScript loads at idle (Qwik's preloader), not on interaction.

### Hacker News thread with `<details>` (no client components)

```sh
cd runners && node lighthouse.mjs hn-details 15
cd runners && node script-time.mjs 4 cold 7 hn-sc,hn-spa
```

Lighthouse (rerun only; the article quotes script time for this page): SC 97 vs SPA 91, TBT 1 vs 156 ms, 241 vs 338 kB transferred.

Main-thread script time on a cold load at 4x CPU, from a real trace, median (min-max): article SC 126–174 ms vs SPA 350–590 ms; rerun SC 121 (115–130) vs SPA 263 (254–270) ms. Lighthouse's own main-thread breakdown agrees (script evaluation 113 vs 236 ms). With 652 client toggles (`hn-sc-toggles,hn-spa-toggles`) the SC page runs more script than the SPA (354 vs 273 ms), yet its TBT is still lower (see below for why).

### Client navigation to the thread

```sh
cd runners && node navigation.mjs 5
```

Fetched from the click until the thread is on screen, brotli, 5 runs, medians, no CPU throttling:

| | SC | SPA | SC, 652 toggles | SPA, 652 toggles | Qwik City |
| --- | ---: | ---: | ---: | ---: | ---: |
| Data | 191 kB | 199 kB | 248 kB | 199 kB | 222 kB |
| Code loaded on first navigation | 3.9 kB | 0 | 5.2 kB | 0 | 1.2 kB |
| On screen | 241 ms | 261 ms | 476 ms | 258 ms | 666 ms |

The article quotes 248 vs 199 kB. The runner clicks with a real mouse: Qwik City routes its links on the client only once the pointer has been over them (a scripted `click()` reloads the page), and it routes only its own `<Link>`s, so `hn-qwik` carries an invisible one to the story. Qwik's data is the story through a `server$` call; the small `q-data.json` requests are its route prefetches. Next's navigation is not measured: it too routes only its own links, and the RSC app has none to the story.

### Storefront

```sh
cd runners && node lighthouse.mjs store 15
```

| Page | Article SC / SPA | Rerun SC / SPA |
| --- | --- | --- |
| Listing score, TBT | 100 / 99–100, 33 / 66 ms | 100 / 100, 5 / 45 ms |
| Product score, TBT | 100 / 99–100, 6 / 10 ms | 100 / 100, 5 / 13 ms |
| JS transferred | 50.4 / 38.9 kB | 48.7 / 38.7 kB |

A tie on speed; the SPA ships about 10 kB less JavaScript.

### Live table, one viewer

```sh
cd runners && node dbmon-client.mjs 400 0.1 5 4 15
```

The SPA is the same Solid app rendered in the browser from streamed rows (`dbmon-spa`). The Datastar port runs in two styles: the whole table re-sent every tick and morphed (`dbmon-hypermedia`), and only the changed rows, each morphed by its id (`dbmon-hypermedia-rows`, the same server with `PATCH=rows`). The changed-rows server finds what changed by comparing each tick's rows to the last; the Solid component just renders the table.

400 rows, 10% of rows change per tick, 5 ticks/s, one browser tab, 15 interleaved rounds. Every app applied every tick and none froze:

| | Solid SPA | Solid (`broadcast()`) | Datastar, changed rows | Datastar, whole table |
| --- | ---: | ---: | ---: | ---: |
| Client busy, median (p25–p75) | 444 (428–472) ms/s | 427 (399–472) ms/s | 529 (512–555) ms/s | 761 (725–782) ms/s |
| Wire (brotli) | 14.3 kB/s | 7.3 kB/s | 6.5 kB/s | 9.7 kB/s |

All four pages are server-rendered, so the table shows at once. The SPA and Solid tie on client work (their middle halves overlap); the SPA sends twice the bytes, as rows of data instead of row edits.

### Live table, how big before it falls behind

```sh
cd runners && for r in 600 800 1000 1500 2000; do node dbmon-client.mjs $r 0.1 5 4 3; done
cd runners && node dbmon-drain.mjs dbmon-solid 2000 && node dbmon-drain.mjs dbmon-spa 2000
```

Ticks applied per second (of 5), one tab, 10% change, 3 rounds (400 rows is the 15-round run above). "Stops keeping up" means the page fell far enough behind that it stopped answering for 5 s or more:

| Rows | Solid SPA | Solid (`broadcast()`) | Datastar, changed rows | Datastar, whole table |
| ---: | ---: | ---: | ---: | ---: |
| 400 | 4.9–5 | 4.9–5 | 4.9–5.1 | 4.9–5.1 |
| 600 | 5–5.1 | 5–5.1 | 5 | 4.1–5.2 |
| 800 | 5–5.1 | 5 | 5–5.1 | stops keeping up |
| 1,000 | 5–5.1 | 5–5.2 | 3.9–4.7 | stops keeping up |

The changed-rows port stops keeping up from 1,500 rows; the SPA and Solid both carried on to 2,000 (SPA 5.1–5.3, Solid 5.3–5.5 ticks). At 1,000 rows the three that keep up are all near a full core: client busy SPA 804–938, Solid 817–929, changed rows 936–964 ms/s. "Applied" counts update batches, so `dbmon-drain.mjs` checks for a hidden backlog: it stops the server mid-run and times how long the page keeps updating. At 2,000 rows the SPA drains in 0.2 s and Solid in 0.1 s. In every column the browser is the bottleneck, not the server (below: at 400 rows no server comes near a core even at 100 viewers).

### Live table, many viewers

```sh
cd runners && node dbmon-viewers.mjs 1,10,25,50,100 3
```

Server CPU ms/s, 400 rows, 10% change, 5 ticks/s, 3 rounds; viewers are HTTP readers that keep the stream compressed:

| Viewers | Solid SPA | Solid (`broadcast()`) | Datastar, changed rows | Datastar, whole table |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 24–27 | 31–34 | 12 | 19–20 |
| 10 | 49–52 | 46–49 | 25–28 | 54–58 |
| 25 | 81–85 | 64–66 | 43 | 96–100 |
| 50 | 133–143 | 88–90 | 70–72 | 169–178 |
| 100 | 235–254 | 144–145 | 122–141 | 317–327 |
| Wire per viewer | 13.5–14.6 kB/s | 7.1–7.7 kB/s | 6.4–6.8 kB/s | 9.3–10.1 kB/s |

Every server does its tick's work once for all viewers and compresses each connection separately, so what grows with viewers is compression, and its order here follows how much each stream hands brotli before compressing: the changed rows, Solid's row edits, the SPA's rows as data, the whole table. For the SPA this was checked directly in an earlier batch at brotli quality 5 with a 16 MB window: with compression off, its server cost at 50 viewers fell from 430 to 50 ms/s. Compression settings move these numbers a lot: at that setting the whole-table port's server cost 4–5x more from 50 viewers up, and its wire was about a third smaller.

## Live table: explorations

```sh
runners/explorations.sh          # all of it, about 5 hours; or one part: method, load, window, backend
```

This section widens the live-table comparison above. It isn't meant to crown a winner. It asks what the table measures and what it leaves out, and what changes when the table looks more like a real app's: a first load, a window onto a big table, many viewers on one server. Every number here comes from `explorations.sh` on one machine on 2026-10-24: a 4-core Intel Xeon at 2.10 GHz with 15 GB, Node 22.22.0, Go 1.24.7, Chromium 153 (`results/dbmon/machine.txt`). Compare numbers within this section, not with the tables above, which were measured on a different day. Raw results are in `results/dbmon/`.

### The method, and what it shows

```sh
runners/explorations.sh method
```

Ryan's Datastar port of the table is a fair one, written the way Datastar's docs suggest, and the comparison above holds up when rerun. What changed is how much the runner can see:

- **Framework and browser time, apart.** "Client busy" counts every main-thread task, and most of that is the browser doing style, layout and paint, which every app pays for the same DOM. `dbmon-client.mjs` now splits a trace into *framework* time (script, HTML parsing and GC, the library's own work) and *browser* time (style, layout and paint). The two don't add up to client busy exactly, because not every task falls into one of them.
- **A fixed-layout run.** `LAYOUT=fixed` adds `table-layout: fixed`, the usual fix for a big live table, to show how much of the cost is layout.
- **The final DOM is checked.** At the end of each run the runner pauses the simulation, asks the server for its rows, and compares them with what is on screen. Every run in this section ended with no wrong rows.
- **Datastar's other styles.** Besides the whole table and the changed rows: the changed rows swapped in without a morph (`PATCH=replace`), and the table bound to signals and patched with values (`PATCH=signals`). Each is an ordinary way to write this in Datastar.
- **Memory.** The JS heap after a forced GC at the end of the run, and how much it grew during the run.
- **No stale servers.** The runner refuses to start when something already holds the app's port. One earlier run had measured a leftover server instead of the app.
- **More rounds near the cliff:** 5 instead of 3.

400 rows, 10% change, 5 ticks/s, 4x CPU, 7 rounds, medians:

| | Solid (`broadcast()`) | Solid SPA | Datastar, whole table | Datastar, changed rows | Datastar, replace | Datastar, signals |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Client busy, ms/s | 561 | 599 | 946 | 742 | 779 | 765 |
| Framework, ms/s | 126 | 138 | 571 | 265 | 186 | 193 |
| Browser, ms/s | 433 | 461 | 394 | 486 | 583 | 586 |
| Fixed layout: client busy / framework | 300 / 102 | 318 / 124 | 731 / 568 | 410 / 225 | 555 / 170 | 397 / 188 |
| Wire, kB/s | 7.4 | 14.8 | 10.6 | 6.9 | 6.9 | 6.4 |
| Heap at the end (growth), MB | 2.3 (+0.3) | 7.8 (+1.6) | 1.7 (+0.4) | 1.4 (+0.3) | 1.4 (+0.4) | 11.3 (+0.4) |
| Server at 100 viewers, ms/s | 194 | 315 | 530 | 168 | 165 | 125 |

What it shows:

- **Most of the client's time is the browser's.** With a fixed layout the browser's share drops to about 205–240 ms/s for every app except replace, and client busy roughly halves. What is left between the apps is the framework's own work.
- **There, Solid does about half the work of a morph, and that is the honest reason it wins this table.** Solid's compiled updates know which text node changed and write to it (100–125 ms/s). A morph has to find out: Datastar parses each changed row's new markup and compares it with the row on the page (225–265 ms/s for the changed rows). Re-sending the whole table makes the morph walk every row (570 ms/s). This is the case fine-grained reactivity is built for, a few cells changing in a big, stable DOM.
- **Datastar's other styles move the cost around.** Replace skips the morph (framework 186), but every swapped-in row is a new element, so the browser restyles it (style 133 ms/s in the trace, against about 5 for the others). Signals patch values instead of markup (193), but the page holds a signal for every value on it (11.3 MB of heap), and binding them on load is one long task (see first load below).
- **Where each one stops keeping up.** At 800 rows the Datastar changed-rows and signals styles apply 3.7 and 3.5 ticks/s of 5. From 1,000 rows the changed rows froze in 5 of 5 rounds; signals froze in 3 of 5 at 1,000 and 5 of 5 from 1,500. Solid and the SPA kept up to 2,000. That is about 2x the rows, the same ratio as the framework time.
- **Memory doesn't creep.** No app's heap grew more than 1.6 MB over a run (the SPA, which keeps the rows as data).
- **On the server**, the changed-rows style costs less than Solid at 100 viewers (168 vs 194 ms/s), because there is less to compress.

### First load of the live table

```sh
runners/explorations.sh load
```

The article measures first load on the HN and store pages but not on the table. `dbmon-load.mjs` loads each page in a cold browser at 4x CPU (400 rows, 7 rounds) and times when the table is on screen and when the first live update lands. Lighthouse's mobile preset then scores the same pages (15 interleaved rounds). For Lighthouse the table doesn't tick, because a live table keeps Lighthouse's trace from settling and every update would count as blocking time.

| | Solid (`broadcast()`) | Solid SPA | Datastar, changed rows | Datastar, signals |
| --- | ---: | ---: | ---: | ---: |
| Table on screen | 163 ms | 601 ms | 85 ms | 199 ms |
| First live update | 251 ms | 836 ms | 198 ms | 272 ms |
| Main thread busy until live | 488 ms | 891 ms | 492 ms | 429 ms |
| HTML / JS, brotli | 15.7 / 64.3 kB | 0.8 / 71.9 kB (+32 kB of rows) | 15.1 / 12.9 kB | 46.8 / 12.9 kB |
| Lighthouse score | 99 | 97 | 99 | 70 |
| Total Blocking Time | 75 ms | 170 ms | 98 ms | 3,707 ms |
| FCP / LCP | 1.42 / 1.42 s | 1.25 / 2.10 s | 0.95 / 1.24 s | 1.13 / 1.14 s |
| Transferred | 98 kB | 105 kB | 43 kB | 73 kB |

The whole-table and replace styles load like the changed rows (table at 100 and 79 ms), since their first page is the same. The server-rendered pages show the table almost at once, and the SPA waits for its rows to arrive as data. Most of the difference in bytes is JavaScript: 64 kB for Solid with its router and server-components runtime, 13 kB for the Datastar bundle. The signals page is the outlier. Its HTML carries every value twice, as markup and as a signal, plus a binding attribute for each, and Datastar binds them all in one long task when it starts, which Lighthouse counts as 3.7 s of blocking time. Binding in chunks that yield to the browser, the way Solid spreads out hydration, would be the fix on Datastar's side.

### Notes that aren't benchmarks

- **Datastar's morph is pluggable.** The morph is how Datastar applies a patch by default, not a fixed part of it. A faster morph that costs a few more kB is a legitimate trade, and nothing here explores it.
- **Morphing a whole region is a default, not a rule.** Datastar sends a whole region and morphs it by default because that is simple to reason about: the server renders what the page should look like, and there is no client state to tear. When a region turns out to be hot, you measure and narrow the patch to the parts that change. The changed-rows, replace and signals styles above are that step.
- **None of these benchmarks are what Datastar is aiming at.** Its claim is to be fast enough for most real workloads, not to win a table re-rendered five times a second in full. The sections above try workloads closer to real ones.

## How to read the numbers

- Lighthouse runs vary 15–20% from run to run on the same machine. A tie needs 15 or more interleaved rounds before you can call it; one run is an anecdote. The Lighthouse runner interleaves the apps within each round so a slow stretch of the machine hits all of them.
- Lighthouse and INP judge first load and main-thread blocking. They don't see network waits after an interaction, which is where server-driven approaches pay.
- Script time and TBT are different measurements. Script time is all JavaScript in a real trace slowed to 4x. TBT counts only the part of each task beyond 50 ms, between first paint and interactive, and Lighthouse simulates it from an unthrottled trace. On the HN thread the biggest task is about 700 ms of layout for 1,500 comments, on both sides. Lighthouse's simulated first paint lands after that task, so its TBT sees only the hydration tasks that follow. The SPA hydrates in 100–150 ms tasks; the SC page has none over 50 ms. A real trace where first paint is the shell (`script-time.mjs` with blocking time added) counts the layout task too, and both sides go to 650–950 ms, SC still lower (`<details>` 724 vs 930, toggles 656 vs 868).
- Brotli erases much of the cleverness on the wire: re-sending the whole table compresses to about 1.5x the size of sending only the changed rows.

## License

MIT for everything here except `apps/dbmon-hypermedia/datastar.js`, which is Datastar's own bundle under its license (`apps/dbmon-hypermedia/DATASTAR-LICENSE.md`).
