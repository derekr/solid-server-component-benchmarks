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

Everything uses published packages: `solid-js` and `@solidjs/web` 2.0.0-rc.17, `@solidjs/router` 2.0.0-next.41, `@solidjs/vite-plugin` 3.0.0-next.51, Vite 8.3.5. Server components are a preview in these versions.

## The apps

| App | What it is | Port |
| --- | --- | ---: |
| `apps/hn-sc` | Hacker News with server components. The story page is all server markup; comment collapse is a native `<details>`. | 3004 |
| `apps/hn-spa` | The same app as a server-rendered, hydrating SPA. | 3005 |
| `apps/hn-sc-toggles` | `hn-sc` with a client `Toggle` component in a slot on every comment that has replies (652 on the test story). | 3006 |
| `apps/hn-spa-toggles` | `hn-spa` with the same toggle as a client signal per comment. | 3007 |
| `apps/store-sc` | A small storefront with server components: listing (48 tiles, quick add on each) and product page (gallery, buy box, 12 reviews). Only the cart, quick add and buy box hydrate. | 3013 |
| `apps/store-spa` | The same store as a server-rendered, hydrating SPA. | 3014 |
| `apps/dbmon-solid` | DBMon as a live server component (`broadcast()`): rendered on the server, changed rows streamed to every tab. | 3020 |
| `apps/dbmon-hypermedia` | The same table on [Datastar](https://data-star.dev) 1.0.4: the whole table rendered once per tick and pushed to every client as an SSE patch, morphed by id. This is a hand-written port in Datastar's style, not one of Datastar's own demos. | 3021 |

Notes on fairness:
- **Same data, same latency.** The HN apps serve one cached story (30186326, about 1,500 comments) after a fixed `HN_DELAY_MS=150` delay, so neither side gets instant data. The feed and user pages call the live HN API. The store's catalog is in memory with no delay, on both sides.
- **Same simulation.** Both DBMon apps run the same `databases` module (rows, change rate and tick rate set by `DBMON_ROWS`, `DBMON_MUTATIONS`, `DBMON_FPS`), and both compress per connection with brotli quality 5.
- **Same language.** Both DBMon servers are Node. A Go or Rust server would cut the hypermedia stack's server cost; it would not change the client side.

## Rerunning the article's numbers

`runners/all.sh` reruns everything below (about an hour) and writes to `results/`. The "rerun" column is from that script on 2026-10-22, on rc.17, in a 4-core Linux cloud container. The "article" column is what the article quotes, measured during development (2026-10-14 to 10-21) on unreleased builds and sometimes a slower machine. The two disagree in size but not in direction, which is the point of publishing both.

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

Lighthouse 12 mobile preset, 15 interleaved rounds, medians, `hn-sc-toggles` vs `hn-spa-toggles`:

| | Article SC / SPA | Rerun SC / SPA |
| --- | --- | --- |
| Score | 91 / 79 | 96 / 92 |
| Total Blocking Time | 212 / 568 ms | 18 / 141 ms |
| Transferred | 267 / 342 kB | 263 / 340 kB |

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

10% of rows change per tick, 5 ticks/s, 4x CPU, one browser tab, 3 rounds (ranges):

| | Solid | Datastar port |
| --- | --- | --- |
| 400 rows, client busy | article 508–615, rerun 445–466 ms/s | article 584–830, rerun 597–622 ms/s |
| 400 rows, wire (brotli) | 5.2–5.4 kB/s | 6.4–6.6 kB/s |
| 400 rows, server CPU | 27–28 ms/s | 17–18 ms/s |
| 1,000 rows | renders and keeps updating (784–898 ms/s busy) | table never shown within 15 s (3 of 3 runs; article 6 of 6) |

### Live table, many viewers

```sh
cd runners && node dbmon-viewers.mjs 1,10,25,50,100 3
```

Server CPU ms/s, 400 rows, 10% change, 5 ticks/s; viewers are HTTP readers that keep the stream compressed:

| Viewers | Solid (`broadcast()`) | Datastar port |
| ---: | ---: | ---: |
| 1 | 28–34 | 18 |
| 10 | 46–50 | 65–67 |
| 25 | 71–76 | 131–142 |
| 50 | 114–117 | 365–398 |
| 100 | 190–211 | 1,034–1,242 |

The Datastar port is cheaper with one viewer; from 10 viewers up, Solid is. The article quotes the 10-21 run (100 viewers: under 300 vs about 1,400 ms/s).

## How to read the numbers

- Lighthouse runs vary 15–20% from run to run on the same machine. A tie needs 15 or more interleaved rounds before you can call it; one run is an anecdote. The Lighthouse runner interleaves the apps within each round so a slow stretch of the machine hits all of them.
- Lighthouse and INP judge first load and main-thread blocking. They don't see network waits after an interaction, which is where server-driven approaches pay.
- Script time and TBT are different measurements. Script time is all JavaScript in a real trace slowed to 4x. TBT counts only the part of each task beyond 50 ms, between first paint and interactive, and Lighthouse simulates it from an unthrottled trace. On the HN thread the biggest task is about 700 ms of layout for 1,500 comments, on both sides. Lighthouse's simulated first paint lands after that task, so its TBT sees only the hydration tasks that follow. The SPA hydrates in 100–150 ms tasks; the SC page has none over 50 ms. A real trace where first paint is the shell (`script-time.mjs` with blocking time added) counts the layout task too, and both sides go to 650–950 ms, SC still lower (`<details>` 724 vs 930, toggles 656 vs 868).
- Brotli erases most cleverness on the wire. Sending only the changed rows compresses to about the same size as re-sending the table.

## License

MIT for everything here except `apps/dbmon-hypermedia/datastar.js`, which is Datastar's own bundle under its license (`apps/dbmon-hypermedia/DATASTAR-LICENSE.md`).
