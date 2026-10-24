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
| `apps/hn-datastar` | The HN app on [Datastar](https://data-star.dev) 1.0.4: the same routes, markup and data, rendered on the server as plain HTML and navigated as a multi-page app (no build step). Comment collapse is a native `<details>`, as in `hn-sc`. A hand-written port in Datastar's style, not one of Datastar's own demos; improvements welcome. | 3011 |
| `apps/hn-datastar` with `TOGGLES` | The toggles app on Datastar: every comment with replies gets a toggle, either a local signal bound to its label, class and visibility (`TOGGLES=signals`, port 3012) or one click handler on the thread that flips the clicked toggle's class (`TOGGLES=delegated`, port 3016). | 3012, 3016 |
| `apps/store-sc` | A small storefront with server components: listing (48 tiles, quick add on each) and product page (gallery, buy box, 12 reviews). Only the cart, quick add and buy box hydrate. | 3013 |
| `apps/store-spa` | The same store as a server-rendered, hydrating SPA. | 3014 |
| `apps/store-datastar` | The store on Datastar, rendered on the server as plain HTML. The cart is server state: quick add and add to cart POST, and the server answers with patches for the header's count, the mini-cart and the button. Until the answer lands, an add button says "Adding…". The listing's quick adds and wishlist hearts share one delegated click handler on the grid; the mini-cart's open state and the buy box's colour, size and quantity are signals on the page. | 3015 |
| `apps/dbmon-solid` | DBMon as a live server component (`broadcast()`): rendered on the server, changed rows streamed to every tab. | 3020 |
| `apps/dbmon-solid` at `/spa` | The same table rendered in the browser as an SPA: the server streams the rows as data through a `broadcast()` data source and a keyed `For` swaps each changed row (`/spa-store` reconciles into a store instead). | 3023, 3024 |
| `apps/dbmon-hypermedia` | The same table on [Datastar](https://data-star.dev) 1.0.4, rendered once per tick on the server and pushed to every client as an SSE patch, morphed by id. Two styles: the whole table every tick (port 3021), or only the changed rows (`PATCH=rows`, port 3022). A hand-written port in Datastar's style, not one of Datastar's own demos; improvements welcome. | 3021, 3022 |
| `apps/dbmon-hypermedia` with `PATCH=replace`, `PATCH=signals` | Datastar's other update styles: the changed rows swapped in without a morph, or the table bound to signals and patched with values (`datastar-patch-signals`). | 3025, 3026 |
| `apps/dbmon-hypermedia` with `PATCH=window` | A scrolling window onto the table: the server renders the 40 rows in view and patches them as you scroll (`-overscan` renders 40 more each side, `-delta` sends a scroll as the rows that entered and left). | 3027, 3029, 3030 |
| `apps/dbmon-solid` at `/spa-window` | The SPA as a virtualized list (TanStack Virtual): every row streamed as data, only the rows in view rendered. | 3028 |
| `apps/dbmon-solid` at `/sc-window` | The live server component windowed on the server: a `liveQuery` slice per 20-row grid cell. | 3017 |
| `apps/dbmon-go` | The Datastar table again in Go, on the Datastar Go SDK: the same page, events and styles (`dbmon-go-rows` is the twin of `dbmon-hypermedia-rows`, and so on), with the SDK's pure-Go brotli or Google's C brotli (`-cbrotli`). | 3031–3049 |

Notes on fairness:
- **Same data, same latency.** The HN apps serve one cached story (30186326, about 1,500 comments) after a fixed `HN_DELAY_MS=150` delay, so neither side gets instant data. The feed and user pages call the live HN API. The store's catalog is in memory with no delay, on both sides.
- **Same simulation.** Both DBMon apps run the same `databases` module (rows, change rate and tick rate set by `DBMON_ROWS`, `DBMON_MUTATIONS`, `DBMON_FPS`), and both compress each connection with brotli quality 4 and a 4 MB window, a common streaming setting (`DBMON_BROTLI=quality,window` overrides it for both).
- **Same language, except where it's the point.** The DBMon servers are Node, except `apps/dbmon-go`, which "Why your backend matters" below compares on purpose.
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

## Datastar on the first-load pages

```sh
cd runners && node lighthouse.mjs hn 15 && node lighthouse.mjs hn-details 15 && node lighthouse.mjs store 15
cd runners && node script-time.mjs 4 cold 7 hn-sc,hn-spa,hn-datastar
cd runners && node script-time.mjs 4 cold 7 hn-sc-toggles,hn-spa-toggles,hn-datastar-toggles,hn-datastar-delegated
cd runners && node navigation.mjs 5
cd runners && node store-add.mjs 7
```

The HN and store pages ported to Datastar (`hn-datastar`, `store-datastar`), measured with the same runners. The point is not a winner: it is what a server-rendered, multi-page hypermedia app costs on the same pages, and where its costs sit. Every app in a set was rerun in the same 15 interleaved rounds, on 2026-10-24 on the machine in `results/dbmon/machine.txt`, so compare within these tables, not with the rerun column above. Raw output is in `results/datastar/`.

What the ports do the same way: same markup and CSS, same data and `HN_DELAY_MS`, same brotli front (pages streamed at quality 4 with the shell flushed first, static files at quality 9). What they do differently, because that is how Datastar apps are built: there is no client router and no build step. Every link is a document load, and the page loads one script, Datastar's 1.0.4 bundle, 12.2 KB brotli (33.6 KB minified; the `pnpm sizes` method). It is the whole library, the same on every page, so it is a fixed cost like the first row of the bundle-size table, not one that grows with the app.

**Hacker News thread, 652 toggles.** Two Datastar versions of the toggle: a local signal per comment bound to the label, class and visibility (`hn-datastar-toggles`, the closest to a Solid component with a signal), and one click handler on the whole thread that flips the class of the toggle that was clicked, with CSS swapping the label and hiding the replies (`hn-datastar-delegated`). The second is how a Datastar app would bind a list this size: no attribute per comment.

| | Solid SC | Solid SPA | Next RSC | Qwik City | Datastar, signals | Datastar, delegated |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Score | 93 | 85 | 70 | 80 | 71 | 91 |
| Total Blocking Time | 188 ms | 364 ms | 680 ms | 158 ms | 1,578 ms | 332 ms |
| FCP | 2.26 s | 2.56 s | 2.27 s | 3.62 s | 1.96 s | 1.81 s |
| LCP | 2.30 s | 2.60 s | 3.65 s | 3.66 s | 2.03 s | 1.93 s |
| Transferred | 263 kB | 340 kB | 470 kB | 529 kB | 221 kB | 205 kB |
| HTML document | 213 kB | 300 kB | 303 kB | 481 kB | 206 kB | 190 kB |
| JavaScript | 47 kB | 38 kB | 131 kB | 43 kB | 13 kB | 13 kB |

The signals version runs about as much script as the SC page (real trace at 4x: 547 vs 541 ms), but runs it as one task: Datastar binds all 2,608 attributes (652 signals, each with a class, text, show and click binding) when it starts, and that task is 1.30–1.74 s in Lighthouse's simulation (median 1.42 s), where Solid's largest script task has a median of 100 ms. TBT counts nearly all of it. The delegated version has no attribute and no signal per comment, only one on the thread: script falls to 157 ms and TBT to 332 ms, the same as the page with no toggles at all (below). So on Datastar the cost is per binding, and a big list wants one delegated handler rather than a binding per row.

**Hacker News thread with `<details>`.**

| | Solid SC | Solid SPA | Datastar |
| --- | ---: | ---: | ---: |
| Score | 96 | 81 | 90 |
| Total Blocking Time | 120 ms | 468 ms | 366 ms |
| FCP / LCP | 2.11 / 2.13 s | 2.60 / 2.64 s | 1.84 / 1.85 s |
| Transferred | 241 kB | 338 kB | 205 kB |
| Script on a cold load, 4x CPU (real trace) | 151 (131–161) ms | 357 (343–394) ms | 168 (156–228) ms |

Datastar's script time is close to the SC page's, and its TBT is still three times higher. Most of it is the browser, not Datastar: the Datastar page is one streamed document, which the browser parses and lays out in several tasks and paints between them, so first paint comes earlier and the parse and layout tasks after it (150–250 ms each in Lighthouse's simulation) count toward TBT. On the SC page the thread arrives as one chunk that is laid out in a single task before first paint (see "How to read the numbers" below), so TBT sees only the small tasks after it. Datastar's own start-up here (scanning the DOM for attributes) is one task, median 155 ms.

**Client navigation to the thread**, from the click until the thread is on screen (no throttling, 5 runs, medians): Datastar 393 ms (`<details>`), 423 ms (signals), 427 ms (delegated), against SC 273, SPA 287, SC with toggles 537 and Qwik City 854 ms. It fetches the same data as the others (190 kB document, 206 kB with signals), but as a new document: the browser parses it as it streams in, while the Solid apps insert their response in one go. The runner disables the HTTP cache, so each Datastar navigation also fetches `datastar.js` and `app.css` again (14.8 kB, counted as code); in real use both are cached after the first page (they're served with `max-age=3600`), and with the cache on the `<details>` page landed 60–90 ms sooner in a quick check. The runner keeps the cache off for every app so the numbers stay comparable with the article's. Datastar also offers its own in-page navigation (patching the page from a `@get`), which is not measured here. None of the usual mitigations for multi-page navigation are on here either. Speculation rules or a prefetch on hover or `pointerdown` would have the next document loading before the click lands, and the browser cache keeps the script and stylesheet. The Solid apps could prefetch their route data the same way, so this measures the bare navigation on every side. A fresh document per page is also deliberate in a hypermedia app: no client state is carried from route to route, so nothing accumulates in memory across a session, and each page starts from a clean profile.

**Storefront.**

| Page | Solid SC | Solid SPA | Datastar |
| --- | --- | --- | --- |
| Listing: score, TBT, FCP | 100, 50 ms, 1.21 s | 100, 88 ms, 1.10 s | 100, 0 ms, 0.95 s |
| Product: score, TBT, FCP | 100, 50 ms, 1.25 s | 100, 64 ms, 1.06 s | 100, 0 ms, 0.90 s |
| Transferred (listing) | 59 kB | 51 kB | 18 kB |
| JavaScript | 48.7 kB | 38.7 kB | 13.2 kB |

All three score 100. Datastar paints first, with the smallest page and no hydration data. Its listing has no bindings per tile: every quick add and wishlist heart goes through one click handler on the grid, so start-up has 48 tiles' worth less to bind, and the listing's TBT went from 79 to 0 ms when the tiles' own handlers and signals were removed.

**Adding to the cart**, from the click (`cd runners && node store-add.mjs 7`): a quick add on a listing tile at 4x CPU, 7 rounds, medians, timed to the first frame that shows each change:

| | Solid SC | Solid SPA | Datastar |
| --- | ---: | ---: | ---: |
| The button shows the click | 20 ms | 19 ms | 25 ms ("Adding…") |
| The cart count changes | 20 ms | 19 ms | 54 ms |
| The cart count changes, 150 ms round trip | 19 ms | 19 ms | 189 ms |

The two apps do different things here, so the second and third rows aren't a race. The Solid twins keep the cart in a client signal and never tell the server, so the count changes in the click's frame, and the cart is gone on reload. Datastar's cart is server state: the add is a POST, and the count changes when the server has it, a round trip later. What the user needs at once is a sign that the click landed, without being told the item is in the cart before it is. Datastar's button says "Adding…" in the click's frame and the server's answer turns it into "Added ✓". Before that change, the button too waited for the round trip (190–200 ms at 150 ms). A Solid store that saved its cart would have the same choice to make: a count that may have to roll back, or a pending state until the server answers.

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
- **On the server**, the changed-rows style costs less than Solid at 100 viewers (168 vs 194 ms/s), because there is less to compress. The backend section below takes this further.

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

The whole-table and replace styles load like the changed rows (table at 100 and 79 ms), since their first page is the same. The server-rendered pages show the table almost at once, and the SPA waits for its rows to arrive as data. Most of the difference in bytes is JavaScript: 64 kB for Solid with its router and server-components runtime, 13 kB for the Datastar bundle. The signals page is the outlier. Its HTML carries every value twice, as markup and as a signal, plus a binding attribute for each, and Datastar binds them all in one long task when it starts, which Lighthouse counts as 3.7 s of blocking time. The HN page with a signal per comment shows the same thing (see "Datastar on the first-load pages" above). On a page this size the fix is to bind less, not to bind more slowly: the changed-rows style updates the same table with no bindings on it at all.

### Windowed tables

```sh
runners/explorations.sh window
```

A real app with a big live table doesn't put every row in the DOM. It shows a scrolling window onto the table. There are three windowed versions here, each written the way its stack would usually do it:

- **Solid SPA window** (`/spa-window`): the SPA with TanStack Virtual. It uses `@tanstack/virtual-core` through a small adapter (`src/lib/virtual.ts`), because `@tanstack/solid-virtual` targets Solid 1. Every row still streams to the browser as data, and only the rows on screen render, plus 5 more above and below.
- **Solid server-component window** (`/sc-window`): the server renders only a slice. Slices are cut on a 20-row grid so that viewers looking at the same place share one `broadcast()` slice. Each slice is a `liveQuery` keyed by its grid cell, so scrolling past a grid line opens a new live connection. A slice renders 80 rows: 20 above the grid line, the 40-row window, and 20 below.
- **Datastar window** (`PATCH=window`): one SSE stream per tab. A scroll POSTs the new offset (throttled to 32 ms), the server patches the 40 rows now in view, and then it sends that window's changed rows on each tick. `-overscan` renders 40 more rows above and below, the latency mitigation from derekr/largediff. `-delta` sends a scroll as only the rows that entered and left.

One viewer, 10% change, 5 ticks/s, 4x CPU (7 rounds at 400 rows, 3 at 2,000 and 10,000). Each cell is client busy (ms/s), wire (kB/s) and server (ms/s):

| Rows | Solid SPA window | Solid SC window | Datastar window |
| ---: | --- | --- | --- |
| 400 | 96 / 14 / 34 | 140 / 1.4 / 25 | 118 / 0.9 / 8 |
| 2,000 | 165 / 70.9 / 130 | 141 / 1.3 / 28 | 111 / 0.8 / 18 |
| 10,000 | 484 / 374 / 607 | 146 / 1.3 / 51 | 118 / 0.9 / 29 |
| Heap at 10,000 rows (growth over the run) | 52 MB (+33) | 1.7 MB (+0.1) | 1.1 MB (+0.1) |
| First load at 10,000 rows: table on screen | 1,737 ms (1,084 kB of rows) | 106 ms | 60 ms |
| Server at 100 viewers, 400 rows | 282 ms/s | 76 ms/s | 72 ms/s |

Scrolling, 2,000 rows, behind a round trip added by a local proxy (3 rounds). A *fling* scrolls at 60 px a frame for 3 s; "covered" is the share of frames with no blank rows on screen. A *jump* goes somewhere unseen; the time is until its rows are on the page:

| 4x CPU | Solid SPA window | Solid SC window | Datastar window | Datastar, overscan | Datastar, delta |
| --- | --- | --- | --- | --- | --- |
| 70 ms RTT: covered, jump | 99%, 29 ms | 100%, 162 ms | 90%, 125 ms | 100%, 209 ms | 100%, 216 ms |
| 150 ms RTT: covered, jump | 100%, 27 ms | 58%, 247 ms | 40%, 200 ms | 100%, 297 ms | 100%, 312 ms |

At 1x CPU every app covers 100% of the fling even at 150 ms, and a jump takes 6 ms on the SPA window against 167–187 ms on the server-rendered ones: a round trip plus a little.

What it shows, and why each one does what it does:

- **The SPA window's cost follows the table, not the window.** It renders about 35 rows, but it receives and decodes all of them: at 10,000 rows that is 374 kB/s, 475 ms/s of framework time and a heap that grows 33 MB over the run, and its first load waits for a megabyte of rows. In return, scrolling never waits on the network, so jumps stay local at any latency. That is the right design when the data comfortably fits on the client, and it stops being right somewhere between 2,000 and 10,000 live rows.
- **The two server-rendered windows cost about the same at rest.** Both send only what is on screen, and their cost barely moves from 400 to 10,000 rows. The SC window's browser time is higher (135 against 78 ms/s), partly because it renders 80 rows to Datastar's 40.
- **The SC window's jumps cost a new connection.** Crossing a grid line closes one live query and opens another, and the server renders the new slice from scratch. With one viewer that is fine (100% covered at 70 ms). At 150 ms with a throttled CPU the connection set-up falls behind a fling (58%). It is also its weak spot under load (see the backend section). That isn't a fault of server components as such: a `liveQuery` whose arguments can change on an open connection would remove most of it, and it seems worth suggesting upstream.
- **Datastar's window falls behind a fling on a slow CPU, and overscan fixes it at a price.** The plain 40-row window drops to 90% and 40% covered at 70 and 150 ms on a 4x CPU. With 40 rows of overscan on each side every frame is covered, but each scroll patch now morphs 120 rows on a throttled CPU, so the page paints fewer frames during the fling (47 against 105) and jumps take longer. The delta style doesn't help here: sending fewer rows saves bytes, while the cost is in the patch.
- **Jump gaps need more than overscan, on every stack.** Overscan covers a fling but not a jump. The comments in `apps/dbmon-hypermedia/server.js` and `src/routes/sc-window.tsx` list the mitigations that apply to both: warm the slice on hover or `pointerdown` before the jump; and for scrollbar drags and the End key, which give no warning, use coarse rows or a client-side index with skeleton rows until the real ones arrive.
- **Two rc.18 issues**, worked around in `sc-window.tsx` and described there: a reactive `style` value on the spacer rendered live-hole markers inside the attribute, so its height is set once; and scrolling back to the slice the page was served with reopened its key at the position hydration stamped on it (`LIVE_RESUME_FROM`), so the slice never came back. Once the viewer has scrolled away, a flag in the key gives every slice a key hydration never saw.
- **On simplicity, lightly.** The Datastar window is a range check on the server and a scroll POST. The Solid windows needed an adapter for the virtualizer, and the two workarounds above for the SC window. I wouldn't weigh this much, but it is part of the picture.

### Why your backend matters

```sh
runners/explorations.sh backend
```

Solid's server components need a JavaScript server, and today that means Node or something close to it. Datastar is a protocol over SSE with SDKs in many languages, so a Datastar app runs on whatever backend the team already has. For an app with live, multiplayer state, that backend is where the work is: every viewer's stream is rendered, compressed and pushed by the server. This part ports the Datastar table to Go (`apps/dbmon-go`, on the Datastar Go SDK 1.2.2) and asks whether the backend changes what viewers see.

The Go port serves the same page, bundle and events as the Node one, so every runner measures it unchanged. What differs:

- **Brotli.** The SDK compresses with andybalholm/brotli, a pure-Go port. Node's zlib uses Google's C library. The `-cbrotli` variants use that C library through cgo, so the language and the compressor can be told apart.
- **Threads.** Go renders once per tick and gives the result to a goroutine per connection, which writes and compresses it, so per-connection work spreads over every core. Node runs the render and the writes on one event loop (zlib's compression can run on its thread pool).
- **Flushes.** The SDK flushes after every event, so a window scroll (a signal and a patch) is two brotli flushes where the Node server writes one.
- **What Solid sends.** Solid on rc.18 sends a changed row as in-place edits, Datastar as row markup, so the two compress different streams to begin with.

The load runs pin the server to 2 cores (`SERVER_CPUS=2,3`), with the browser, the runner and the background viewers on the other 2.

**Many viewers, server CPU** (400 rows, 10% change, 5 ticks/s, 2 rounds, ms/s):

| Viewers | Solid | Solid SPA | Solid SPA window | Solid SC window | Datastar rows, Node | rows, Go | rows, Go + C brotli | signals, Go | signals, Go + C brotli | window, Node | window, Go | window, Go + C brotli |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 43 | 32 | 32 | 22 | 13 | 8 | 6 | 7 | 7 | 15 | 4 | 4 |
| 25 | 90 | 106 | 106 | 40 | 53 | 72 | 47 | 54 | 38 | 30 | 19 | 17 |
| 100 | 174 | 324 | 288 | 77 | 160 | 263 | 163 | 173 | 115 | 72 | 62 | 44 |
| 250 | 367 | 753 | 693 | 153 | 370 | 712 | 403 | 431 | 300 | 143 | 147 | 109 |

At one viewer Go costs less than Node (8 against 13 ms/s for the changed rows, 4 against 15 for the window). From there the cost is compression, and the pure-Go brotli costs more than Node's C brotli (712 against 370 ms/s for the changed rows at 250 viewers). With the same C library the two are close (403 against 370). So Go doesn't make this server cheap by itself. What does is sending less: the signals style and the window cost the least on every backend, and the Solid SC window, which also sends only what is on screen, is next.

**Does it reach the viewer?** One measured viewer while N background viewers load the same server. For the live tables, how long after the tick each update arrives (p50 / p99, ms):

| Viewers | Solid | Solid SPA | Datastar rows, Node | rows, Go | rows, Go + C brotli | signals, Go + C brotli |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | 9 / 32–53 | 7 / 225 | 2–3 / 5 | 2 / 11–13 | 2 / 7–18 | 2 / 3–6 |
| 100 | 22–24 / 35–45 | 30–33 / 150–165 | 18–19 / 52–84 | 11–17 / 31–39 | 9–10 / 21–24 | 8–9 / 17–19 |
| 250 | 37–38 / 66–85 | 71–72 / 283–289 | 38–39 / 53–68 | 34–37 / 122–153 | 20–23 / 49–55 | 13 / 36–57 |
| 500 | 64–67 / 98–159 | 128–152 / 359–543 | 76–77 / 128–135 | 111–136 / 953–1,289 | 45 / 121–126 | 26–31 / 63 |

At 500 viewers Solid delivered 94–100% of ticks and the SPA 85–93%; the rest delivered all of them. With a slow tick (2,000 rows, 100 viewers, 1 round), where rendering is a real share of the server's work, the tail is where Node shows: Solid 71 / 513 ms and the SPA 125 / 1,018 ms, against Datastar's changed rows 63 / 79 ms on Node and 39 / 102 ms on Go with C brotli, at about the same CPU (500–540 ms/s, the SPA 1,124).

For the windows, the measured viewer is a browser jumping to unseen rows (1x CPU, no added latency), while each background viewer scrolls to a random place 4 times a second. Jump p50, ms:

| Viewers | Solid SPA window | Solid SC window | Datastar overscan, Node | overscan, Go | overscan, Go + C brotli |
| ---: | --- | --- | --- | --- | --- |
| 1 | 7 | 32–35 | 39 | 33–34 | 33–34 |
| 50 | 7–8 | 672–865 | 37–42 | 37–40 | 34–36 |
| 100 | 7–9 | 2,617–2,650 | 35–36 | 36–38 | 34–38 |
| 200 | 7–8 | 2,716–3,553 | 52–65 | 63–113 | 40–41 |
| 300 | 8 | 2,507–2,664 | the page timed out | 224–698 | 51–67 |

What it shows:

- **The SPA window never asks the server when it scrolls,** so its jumps stay at 7–9 ms under any load. Its server pays for streaming every row to every viewer instead (950 ms/s at 300 viewers).
- **The SC window saturates its server at 50 scrolling viewers** (about 1,520 ms/s, both cores), because every grid line crossed is a new live connection and a fresh render. This is the reconnect cost from the windows section, multiplied by viewers, and the clearest place where an API change upstream (changing a live query's arguments on an open connection) would pay off.
- **The Datastar window on Node holds up to 200 viewers and then the event loop runs out:** at 300 the page timed out. On Go the same app spreads the scroll renders over both cores. With the SDK's brotli it degrades at 300 (224–698 ms); with C brotli it stays at 51–67 ms.
- **So the backend matters, and in specific ways.** For realtime work with many viewers, what you can tune on the server decides what viewers feel: how work spreads over cores, which compressor you use, and how much you send. On Solid the server is Node: you tune what you send and how you compress it, and scale out with more processes. On Datastar a team can also pick the runtime, and run it in the language it already uses.

One viewer in the browser doesn't see the backend at all. Client busy is the same within noise (Go rows 702 ms/s against 742 for Node rows in the method run, Go window 124 against 118), and so is first load (Go rows: table on screen at 88 ms and live at 193 ms, against 85 and 198 on Node).

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
