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
| `apps/dbmon-solid` at `/spa` | The same table rendered in the browser as an SPA: the server streams the rows as data through a `broadcast()` data source and a keyed `For` swaps each changed row (`/spa-store` reconciles into a store instead). | 3023, 3024 |
| `apps/dbmon-hypermedia` | The same table on [Datastar](https://data-star.dev) 1.0.4, rendered once per tick on the server and pushed to every client as an SSE patch, morphed by id. Two styles: the whole table every tick (port 3021), or only the changed rows (`PATCH=rows`, port 3022). A hand-written port in Datastar's style, not one of Datastar's own demos; improvements welcome. | 3021, 3022 |

Notes on fairness:
- **Same data, same latency.** The HN apps serve one cached story (30186326, about 1,500 comments) after a fixed `HN_DELAY_MS=150` delay, so neither side gets instant data. The feed and user pages call the live HN API. The store's catalog is in memory with no delay, on both sides.
- **Same simulation.** Both DBMon apps run the same `databases` module (rows, change rate and tick rate set by `DBMON_ROWS`, `DBMON_MUTATIONS`, `DBMON_FPS`), and both compress each connection with brotli quality 4 and a 4 MB window, a common streaming setting (`DBMON_BROTLI=quality,window` overrides it for both).
- **Same language.** Both DBMon servers are Node. A Go or Rust server would cut the hypermedia stack's server cost; it would not change the client side.

## Rerunning the article's numbers

`runners/all.sh` reruns everything below (about an hour) and writes to `results/`. The "rerun" column is from that script on 2026-10-22, on rc.17, in a 4-core Linux cloud container. The "article" column is what the article quotes, measured during development (2026-10-14 to 10-21) on unreleased builds and sometimes a slower machine. The two disagree in size but not in direction. The live-table results are new: they compare against an SPA and two styles of the Datastar port, which the article's first draft did not. They were measured on Solid's `next` branch at f5ad0650, which shares a `broadcast()` data source across viewers (solidjs/solid#4230); rc.17 does not, so on rc.17 the SPA's server column comes out several times higher from 10 viewers up. Client runs use 4x CPU throttling, Lighthouse's mobile default.

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
cd runners && node dbmon-client.mjs 400 0.1 5 4 15
```

The SPA is the same Solid app rendered in the browser from streamed rows (`dbmon-spa`). The Datastar port runs in two styles: the whole table re-sent every tick and morphed (`dbmon-hypermedia`), and only the changed rows, each morphed by its id (`dbmon-hypermedia-rows`, the same server with `PATCH=rows`). The changed-rows server finds what changed by comparing each tick's rows to the last; the Solid component just renders the table.

400 rows, 10% of rows change per tick, 5 ticks/s, one browser tab, 15 interleaved rounds. Every app applied every tick and none froze:

| | Solid SPA | Solid (`broadcast()`) | Datastar, changed rows | Datastar, whole table |
| --- | ---: | ---: | ---: | ---: |
| Client busy, median (p25–p75) | 462 (446–517) ms/s | 562 (512–607) ms/s | 580 (571–631) ms/s | 822 (790–838) ms/s |
| Wire (brotli) | 14.1 kB/s | 7.2 kB/s | 6.5 kB/s | 9.8 kB/s |

All four pages are server-rendered, so the table shows at once. The SPA does the least client work; it also sends twice the bytes, as rows of data instead of row operations.

### Live table, how big before it falls behind

```sh
cd runners && for r in 600 800 1000 1500 2000; do node dbmon-client.mjs $r 0.1 5 4 3; done
cd runners && node dbmon-drain.mjs dbmon-solid 2000 && node dbmon-drain.mjs dbmon-spa 2000
```

Ticks applied per second (of 5), one tab, 10% change, 3 rounds (400 rows is the 15-round run above). "Stops keeping up" means the page fell far enough behind that it stopped answering for 5 s or more:

| Rows | Solid SPA | Solid (`broadcast()`) | Datastar, changed rows | Datastar, whole table |
| ---: | ---: | ---: | ---: | ---: |
| 400 | 4.9–5 | 4.9–5.1 | 4.9–5.1 | 5–5.1 |
| 600 | 5–5.1 | 5 | 5 | stops keeping up (2 of 3 runs) |
| 800 | 4.8–5 | 5–5.1 | 4.4–5 | stops keeping up |
| 1,000 | 5–5.2 | 5–5.2 | 3.6–4.1 | stops keeping up |

The changed-rows port stops keeping up from 1,500 rows; the SPA and Solid both carried on to 2,000 (5.2–5.4 ticks). At 1,000 rows the three that keep up are all near a full core: client busy SPA 894–943, Solid 952–988, changed rows 972–996 ms/s. "Applied" counts update batches, so `dbmon-drain.mjs` checks for a hidden backlog: it stops the server mid-run and times how long the page keeps updating. At 2,000 rows the SPA drains in 0.2 s and Solid in 0.7 s. In every column the browser is the bottleneck, not the server (below: at 400 rows no server comes near a core even at 100 viewers).

### Live table, many viewers

```sh
cd runners && node dbmon-viewers.mjs 1,10,25,50,100 3
```

Server CPU ms/s, 400 rows, 10% change, 5 ticks/s, 3 rounds; viewers are HTTP readers that keep the stream compressed:

| Viewers | Solid SPA | Solid (`broadcast()`) | Datastar, changed rows | Datastar, whole table |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 26–30 | 28–30 | 10–12 | 19–20 |
| 10 | 48–51 | 45–47 | 23–26 | 48–51 |
| 25 | 80–85 | 62–66 | 41–44 | 90–98 |
| 50 | 130–137 | 93–99 | 67–76 | 161–168 |
| 100 | 226–237 | 148–167 | 120–126 | 309–321 |
| Wire per viewer | 13.6–14.8 kB/s | 6.8–7.3 kB/s | 6.3–6.8 kB/s | 9.5–9.9 kB/s |

Every server does its tick's work once for all viewers and compresses each connection separately, so what grows with viewers is compression, and its order here follows how much each stream hands brotli before compressing: the changed rows, Solid's row operations, the SPA's rows as data, the whole table. For the SPA this was checked directly in an earlier batch at brotli quality 5 with a 16 MB window: with compression off, its server cost at 50 viewers fell from 430 to 50 ms/s. Compression settings move these numbers a lot: at that setting the whole-table port's server cost 4–5x more from 50 viewers up, and its wire was about a third smaller.

## How to read the numbers

- Lighthouse runs vary 15–20% from run to run on the same machine. A tie needs 15 or more interleaved rounds before you can call it; one run is an anecdote. The Lighthouse runner interleaves the apps within each round so a slow stretch of the machine hits all of them.
- Lighthouse and INP judge first load and main-thread blocking. They don't see network waits after an interaction, which is where server-driven approaches pay.
- Script time and TBT are different measurements. Script time is all JavaScript in a real trace slowed to 4x. TBT counts only the part of each task beyond 50 ms, between first paint and interactive, and Lighthouse simulates it from an unthrottled trace. On the HN thread the biggest task is about 700 ms of layout for 1,500 comments, on both sides. Lighthouse's simulated first paint lands after that task, so its TBT sees only the hydration tasks that follow. The SPA hydrates in 100–150 ms tasks; the SC page has none over 50 ms. A real trace where first paint is the shell (`script-time.mjs` with blocking time added) counts the layout task too, and both sides go to 650–950 ms, SC still lower (`<details>` 724 vs 930, toggles 656 vs 868).
- Brotli erases much of the cleverness on the wire: re-sending the whole table compresses to about 1.5x the size of sending only the changed rows.

## License

MIT for everything here except `apps/dbmon-hypermedia/datastar.js`, which is Datastar's own bundle under its license (`apps/dbmon-hypermedia/DATASTAR-LICENSE.md`).
