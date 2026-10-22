# Hacker News on Next.js 16 (React Server Components)

Ryan's 2024 Next.js App Router Hacker News app ([ryansolid/next-rsc-hackernews](https://github.com/ryansolid/next-rsc-hackernews)), updated to Next 16.4.2 and React 19.3.1, for the same Lighthouse comparison as the Solid apps. `Toggle` is a client component on every comment with replies, like `hn-sc-toggles`.

Changes from the 2024 app, all for a like-for-like measurement:
- **Same data.** `api.ts` serves the test thread (30186326) from the same capture as the Solid apps, after the same `HN_DELAY_MS`.
- **Next 16.** Async `params`/`searchParams`, `metadata` instead of `head.tsx`.
- **Streaming.** `app/stories/[id]/loading.tsx` streams the shell while the story loads, like the Solid apps' `<Loading>`.
- **Same compression.** Next's built-in compression is gzip only, so it is off and `server.js` puts the same brotli front on it (quality 4 streamed, 9 for static assets).

```sh
pnpm build && HN_DELAY_MS=150 node server.js   # http://localhost:3008
```
