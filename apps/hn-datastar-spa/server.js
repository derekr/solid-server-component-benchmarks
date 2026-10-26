// Hacker News as a Datastar SPA. The server never renders a story: every
// page URL gets the same static shell, and the data comes from /api as JSON,
// which a Rocket component (public/app.js) renders in the browser. It is the
// client-rendered counterpart of ../hn-spa: same routes, markup, CSS and data
// (the cached story behind the same HN_DELAY_MS), with Datastar 1.0.4 + Rocket
// beta.3 in place of Solid.
//
// TOGGLES=1 is the counterpart of ../hn-spa-toggles: each comment with replies
// gets a [-] link instead of a native <details>, handled by one delegated
// click on the thread that flips the toggle's class (CSS does the rest).
//
// Compression matches the Solid servers: static assets brotli 9 (compressed
// once), responses brotli 4.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3060;
const TOGGLES = process.env.TOGGLES === "1";
const DELAY = Number(process.env.HN_DELAY_MS || 0);

// The same capture the Solid apps serve (30186326, 1,406 comments).
const cachedStory = readFileSync(path.resolve(root, "../hn-spa/src/server/story-30186326.json"), "utf8");
const CACHED_ID = String(JSON.parse(cachedStory).id);

const MIME = { ".js": "application/javascript", ".css": "text/css" };
const statics = {};
for (const [url, file] of [["app.js", "app.js"], ["app.css", "app.css"], ["datastar-rocket.js", "datastar-rocket.js"]]) {
  const body = readFileSync(path.resolve(root, "public", file));
  statics["/" + url] = {
    type: MIME[path.extname(file)],
    body,
    br: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
  };
}

const feeds = { top: "news", new: "newest", show: "show", ask: "ask", job: "jobs" };
// HN_FEED=snapshot: the feeds from the Solid apps' fixed snapshot, after the
// same HN_DELAY_MS, so the feed pages can be measured without the live API.
const feedsSnapshot = process.env.HN_FEED === "snapshot" ? JSON.parse(readFileSync(path.resolve(root, "../hn-sc/src/server/feeds-snapshot.json"), "utf8")) : null;

async function hnApi(p) {
  const url = p.startsWith("user/")
    ? `https://hacker-news.firebaseio.com/v0/${p}.json`
    : `https://node-hnapi.herokuapp.com/${p}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "chrome" } });
    return await r.text();
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}

/** The JSON for an /api path, or null. */
async function api(p, query) {
  let m;
  if ((m = p.match(/^\/api\/story\/(\d+)$/))) {
    if (m[1] === CACHED_ID) {
      if (DELAY) await new Promise(r => setTimeout(r, DELAY));
      return cachedStory;
    }
    return hnApi(`item/${m[1]}`);
  }
  if ((m = p.match(/^\/api\/stories\/(\w+)$/)) && feeds[m[1]]) {
    const feed = `${feeds[m[1]]}?page=${Number(query.get("page")) || 1}`;
    if (!feedsSnapshot) return hnApi(feed);
    if (DELAY) await new Promise(r => setTimeout(r, DELAY));
    return JSON.stringify(feedsSnapshot[feed] ?? []);
  }
  if ((m = p.match(/^\/api\/user\/([\w-]+)$/))) return hnApi(`user/${m[1]}`);
  return null;
}

// The data URL a page needs first, so the shell can start fetching it while
// the script loads (an SPA that knows its routes can do this with no
// server rendering).
const dataFor = (p, query) => {
  let m;
  if ((m = p.match(/^\/stories\/(\d+)$/))) return `/api/story/${m[1]}`;
  if ((m = p.match(/^\/users\/([\w-]+)$/))) return `/api/user/${m[1]}`;
  if ((m = p.match(/^\/(top|new|show|ask|job)?$/))) return `/api/stories/${m[1] || "top"}?page=${Number(query.get("page")) || 1}`;
  return null;
};

const shell = data => `<!DOCTYPE html>
<html lang="en"${TOGGLES ? " data-toggles" : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hacker News</title>
<link rel="stylesheet" href="/app.css">
${data ? `<link rel="preload" as="fetch" href="${data}" crossorigin>` : ""}
<link rel="modulepreload" href="/datastar-rocket.js">
<script type="module" src="/app.js"></script>
</head>
<body>
<header class="header"><nav class="inner"><a href="/"><strong>HN</strong></a><a href="/new"><strong>New</strong></a><a href="/show"><strong>Show</strong></a><a href="/ask"><strong>Ask</strong></a><a href="/job"><strong>Jobs</strong></a><a class="github" href="https://github.com/starfederation/datastar" target="_blank" rel="noreferrer">Built with Datastar</a></nav></header>
<div class="page"><hn-app><div class="news-list-nav">Loading...</div></hn-app></div>
</body>
</html>`;

function send(req, res, status, type, body, quality = 4) {
  const headers = { "Content-Type": type };
  if (/\bbr\b/.test(req.headers["accept-encoding"] || "")) {
    headers["Content-Encoding"] = "br";
    body = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: quality } });
  }
  res.writeHead(status, headers);
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const s = statics[url.pathname];
  if (s) {
    const br = /\bbr\b/.test(req.headers["accept-encoding"] || "");
    res.writeHead(200, {
      "Content-Type": s.type,
      "Cache-Control": "public, max-age=3600",
      ...(br ? { "Content-Encoding": "br" } : {})
    });
    return res.end(br ? s.br : s.body);
  }
  if (url.pathname.startsWith("/api/")) {
    const json = await api(url.pathname, url.searchParams);
    if (json == null) return send(req, res, 404, "application/json", "{}");
    return send(req, res, 200, "application/json", json);
  }
  if (req.method === "HEAD") return res.writeHead(200).end();
  send(req, res, 200, "text/html; charset=utf-8", shell(dataFor(url.pathname, url.searchParams)));
}).listen(PORT, () => {
  console.log(`HackerNews (Datastar SPA${TOGGLES ? ", toggles" : ""}) on http://localhost:${PORT}`);
});
