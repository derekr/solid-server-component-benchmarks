# Hacker News on Qwik City 1.20 (resumable)

Ryan's 2024 Qwik City Hacker News app ([ryansolid/qwik-hn-spa](https://github.com/ryansolid/qwik-hn-spa)), updated to Qwik 1.20.2, for the same Lighthouse and navigation comparison as the Solid apps. It has client routing (Qwik City), and `Toggle` is a component with its own state on every comment with replies, like `hn-sc-toggles`.

Changes from the 2024 app, all for a like-for-like measurement:
- **Same data.** `src/api.ts` serves the test thread (30186326) from the same capture as the Solid apps, after the same `HN_DELAY_MS`, through a `server$` call, so a client navigation to it goes through the server as the Solid apps' do. The feed shows an empty list when the live HN API is unreachable (it served a 500 page).
- **No trailing slash** (`qwikCity({ trailingSlash: false })`), so `/stories/30186326` serves without a redirect.
- **Node server.** The Cloudflare Pages adapter is replaced by Qwik City's node middleware, and `server.js` puts the same brotli front on it as the other apps (quality 4 streamed, 9 for static assets).
- **A link for the navigation runner.** Qwik City routes only its own `<Link>`s on the client, so the nav carries an invisible one to the story.

```sh
pnpm build && HN_DELAY_MS=150 node server.js   # http://localhost:3010
```
