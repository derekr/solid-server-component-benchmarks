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

Everything uses published packages: `next` 16.4.2 and `react` 19.3.1 for the Next app; `solid-js` and `@solidjs/web` 2.0.0-rc.17, `@solidjs/router` 2.0.0-next.41, `@solidjs/vite-plugin` 3.0.0-next.51, Vite 8.3.5. Server components are a preview in these versions.

## The apps

| App | What it is | Port |
| --- | --- | ---: |
| `apps/hn-sc` | Hacker News with server components. The story page is all server markup; comment collapse is a native `<details>`. | 3004 |
| `apps/hn-spa` | The same app as a server-rendered, hydrating SPA. | 3005 |
| `apps/hn-sc-toggles` | `hn-sc` with a client `Toggle` component in a slot on every comment that has replies (652 on the test story). | 3006 |
| `apps/hn-spa-toggles` | `hn-spa` with the same toggle as a client signal per comment. | 3007 |
| `apps/hn-next-rsc` | The toggles app on Next.js 16 with React Server Components (`Toggle` is a `"use client"` component), from Ryan's 2024 [next-rsc-hackernews](https://github.com/ryansolid/next-rsc-hackernews). | 3008 |
| `apps/store-sc` | A small storefront with server components: listing (48 tiles, quick add on each) and product page (gallery, buy box, 12 reviews). Only the cart, quick add and buy box hydrate. | 3013 |
| `apps/store-spa` | The same store as a server-rendered, hydrating SPA. | 3014 |
| `apps/dbmon-solid` | DBMon as a live server component (`broadcast()`): rendered on the server, changed rows streamed to every tab. | 3020 |
| `apps/dbmon-hypermedia` | The same table on [Datastar](https://data-star.dev) 1.0.4, rendered once per tick on the server and pushed to every client as an SSE patch, morphed by id. Two styles: the whole table every tick (port 3021), or only the changed rows (`PATCH=rows`, port 3022). A hand-written port in Datastar's style, not one of Datastar's own demos; improvements welcome. | 3021, 3022 |

Notes on fairness:
- **Same data, same latency.** The HN apps serve one cached story (30186326, about 1,500 comments) after a fixed `HN_DELAY_MS=150` delay, so neither side gets instant data. The feed and user pages call the live HN API. The store's catalog is in memory with no delay, on both sides.
- **Same simulation.** Both DBMon apps run the same `databases` module (rows, change rate and tick rate set by `DBMON_ROWS`, `DBMON_MUTATIONS`, `DBMON_FPS`), and both compress per connection with brotli quality 5.
- **Same language.** Both DBMon servers are Node. A Go or Rust server would cut the hypermedia stack's server cost; it would not change the client side.

## Rerunning the article's numbers

`runners/all.sh` reruns everything below (about an hour) and writes to `results/`. The "rerun" column is from that script on 2026-10-22, on rc.17, in a 4-core Linux cloud container. The "article" column is what the article quotes, measured during development (2026-10-14 to 10-21) on unreleased builds and sometimes a slower machine. The two disagree in size but not in direction. The live-table results are new: they compare against two styles of the Datastar port, which the article's first draft did not.

### Bundle size: the fixed cost

```sh
pnpm sizes
```

The same small app (a signal, a memo, `Show`, `For`, `Loading`, `Errored`, a lazy route) built four ways, eager JS only, brotli:

| Built as | Article | Rerun |
| --- | ---: | ---: |
| Client-rendered SPA | 13.1 KB | 13.3 KB |
| Server-rendered, hydrating SPA | 18.2 KB | 18.4 KB |
| Hydrating SPA calling server functions | 22.0 KB | 22.2 KB |
| Server components page | 33.1 KB | 33.3 KB |

### Hacker News thread, 652 client toggles

```sh
cd runners && node lighthouse.mjs hn 15
```

Lighthouse 12 mobile preset, 15 interleaved rounds, medians. The rerun includes `hn-next-rsc`, the same app on Next.js 16 with React Server Components and the same client toggle (see its README for what was changed to measure it like for like):

| | Article SC / SPA | Rerun SC / SPA / Next RSC |
| --- | --- | --- |
| Score | 91 / 79 | 96 / 91 / 78 |
| Total Blocking Time | 212 / 568 ms | 24 / 168 / 357 ms |
| LCP | | 2.25 / 2.56 / 3.76 s |
| Transferred | 267 / 342 kB | 263 / 340 / 470 kB |
| HTML document | | 212 / 300 / 303 kB |
| JavaScript | | 47 / 38 / 131 kB |

### Hacker News thread with `<details>` (no client components)

```sh
cd runners && node lighthouse.mjs hn-details 15
cd runners && node script-time.mjs 4 cold 7 hn-sc,hn-spa
```

Lighthouse (rerun only; the article quotes script time for this page): SC 97 vs SPA 91, TBT 0 vs 160 ms, 241 vs 338 kB transferred.

Main-thread script time on a cold load at 4x CPU, from a real trace, median (min-max): article SC 126–174 ms vs SPA 350–590 ms; rerun SC 103 (96–137) vs SPA 246 (222–283) ms. Lighthouse's own main-thread breakdown agrees (script evaluation 103 vs 233 ms). With 652 client toggles (`hn-sc-toggles,hn-spa-toggles`) the SC page runs more script than the SPA (325 vs 258 ms), yet its TBT is still lower (see below for why).

### Client navigation to the thread

```sh
cd runners && node navigation.mjs 5
```

Data fetched on navigation, brotli: with no client slots SC 191 vs SPA 199 kB; with 652 toggles SC 248 vs SPA 199 kB (article: 248 vs 199). The SC side also lazy-loads 3–5 kB of code on its first navigation.

### Storefront

```sh
cd runners && node lighthouse.mjs store 15
```

| Page | Article SC / SPA | Rerun SC / SPA |
| --- | --- | --- |
| Listing score, TBT | 100 / 99–100, 33 / 66 ms | 100 / 100, 3 / 41 ms |
| Product score, TBT | 100 / 99–100, 6 / 10 ms | 100 / 100, 2 / 9 ms |
| JS transferred | 50.4 / 38.9 kB | 48.7 / 38.7 kB |

A tie on speed; the SPA ships about 10 kB less JavaScript.

### Live table, one viewer

```sh
cd runners && node dbmon-client.mjs 400 0.1 5 4 3
cd runners && node dbmon-client.mjs 1000 0.1 5 4 3
```

The Datastar port runs in two styles: the whole table re-sent every tick and morphed (`dbmon-hypermedia`), and only the changed rows, each morphed by its id (`dbmon-hypermedia-rows`, the same server with `PATCH=rows`). The changed-rows server finds what changed by comparing each tick's rows to the last; the Solid component just renders the table.

10% of rows change per tick, 5 ticks/s, 4x CPU, one browser tab, 3 rounds (ranges):

| | Solid (`broadcast()`) | Datastar, whole table | Datastar, changed rows |
| --- | ---: | ---: | ---: |
| 400 rows, client busy | 469–542 ms/s | 769–811 ms/s | 587–619 ms/s |
| 400 rows, wire (brotli) | 5.2–5.3 kB/s | 6.5–7.0 kB/s | 5.0–5.1 kB/s |
| 1,000 rows, ticks applied (of 5/s) | 5.1–5.3 | froze after 28–35 s (3 of 3) | 3.8–4.6 |
| 1,000 rows, client busy | 965–988 ms/s | (frozen) | 962–998 ms/s |

Both pages are server-rendered, so the table shows at once. "Froze" means the page stopped answering for 5 s or more: patches arrived faster than it could morph them.

### Live table, how big before it falls behind

```sh
cd runners && for r in 600 800 1500 2000; do node dbmon-client.mjs $r 0.1 5 4 3; done
cd runners && node dbmon-drain.mjs dbmon-solid 2000
```

Ticks applied per second (of 5), one tab at 4x CPU, 10% change, 3 rounds:

| Rows | Solid (`broadcast()`) | Datastar, changed rows | Datastar, whole table |
| ---: | ---: | ---: | ---: |
| 400 | 5 | 4.9–5.1 | 5–5.1 |
| 600 | 5 | 5 | 4.7–5 |
| 800 | 5–5.1 | 4.6–4.7 | froze (3 of 3) |
| 1,000 | 5.1–5.3 | 3.8–4.6 | froze (3 of 3) |
| 1,500 | 5.1–5.2 | froze (3 of 3) | froze (3 of 3) |
| 2,000 | 4.9–5.3 | froze (3 of 3) | froze (3 of 3) |

"Applied" counts update batches, so `dbmon-drain.mjs` checks for a hidden backlog: it stops the server mid-run and times how long the page keeps updating. Solid drains in 0 s at 1,000 rows, 0.1 s at 1,500 and 0.8 s at 2,000: still keeping up, just. In every column the browser is the bottleneck, not the server (see below: the server CPU at 400 rows stays far under a core even at 100 viewers).

### Live table, many viewers

```sh
cd runners && node dbmon-viewers.mjs 1,10,25,50,100 3
```

Server CPU ms/s, 400 rows (the single-tab table above), 10% change, 5 ticks/s; viewers are HTTP readers that keep the stream compressed:

| Viewers | Solid (`broadcast()`) | Datastar, whole table | Datastar, changed rows |
| ---: | ---: | ---: | ---: |
| 1 | 29–35 | 21–22 | 7–12 |
| 10 | 53–54 | 73–81 | 31 |
| 25 | 83–85 | 147–159 | 56–58 |
| 50 | 125–134 | 320–376 | 95–101 |
| 100 | 201–217 | 1,069–1,286 | 182–196 |

Every server compresses each connection separately. What differs is how much each compresses per tick: Solid sends row operations and the changed-rows port sends changed rows (both small), while the whole-table port sends the whole table to every viewer.

## How to read the numbers

- Lighthouse runs vary 15–20% from run to run on the same machine. A tie needs 15 or more interleaved rounds before you can call it; one run is an anecdote. The Lighthouse runner interleaves the apps within each round so a slow stretch of the machine hits all of them.
- Lighthouse and INP judge first load and main-thread blocking. They don't see network waits after an interaction, which is where server-driven approaches pay.
- Script time and TBT are different measurements. Script time is all JavaScript in a real trace slowed to 4x. TBT counts only the part of each task beyond 50 ms, between first paint and interactive, and Lighthouse simulates it from an unthrottled trace. On the HN thread the biggest task is about 700 ms of layout for 1,500 comments, on both sides. Lighthouse's simulated first paint lands after that task, so its TBT sees only the hydration tasks that follow. The SPA hydrates in 100–150 ms tasks; the SC page has none over 50 ms. A real trace where first paint is the shell (`script-time.mjs` with blocking time added) counts the layout task too, and both sides go to 650–950 ms, SC still lower (`<details>` 724 vs 930, toggles 656 vs 868).
- Brotli erases most cleverness on the wire. Sending only the changed rows compresses to about the same size as re-sending the table.

## License

MIT for everything here except `apps/dbmon-hypermedia/datastar.js`, which is Datastar's own bundle under its license (`apps/dbmon-hypermedia/DATASTAR-LICENSE.md`).
