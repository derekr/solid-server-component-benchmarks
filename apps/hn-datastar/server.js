// Hacker News on Datastar: the same routes, markup and data as the Solid
// apps, rendered on the server as plain HTML and navigated as a multi-page
// app (every link is a document load, the way Datastar apps are usually
// built). No build step; the page loads Datastar 1.0.4 and nothing else.
//
// Three variants from one server, like dbmon-hypermedia's PATCH=rows:
// - default: comment collapse is a native <details>, as in hn-sc and hn-spa.
//   No Datastar attribute on the page does anything, so Datastar's cost here
//   is the fixed one: download, parse, and one scan of the DOM.
// - TOGGLES=signals: every comment with replies gets a Datastar toggle, a
//   local signal per comment bound to its label, class and visibility, the
//   counterpart of hn-sc-toggles' client Toggle (652 on the test story).
// - TOGGLES=handler: the same toggle as one click handler per comment that
//   flips a class, with CSS hiding the replies: no signals, one attribute.
//
// Responses are compressed the way the other apps' servers do it: pages are
// streamed through brotli quality 4 and flushed per chunk, so the shell
// (head, nav) leaves before the data is ready; static assets are compressed
// once at quality 9 and cached.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { brotliCompressSync, createBrotliCompress, createGzip, constants } from "node:zlib";

const PORT = Number(process.env.PORT || 3011);
const TOGGLES = process.env.TOGGLES; // undefined, "signals" or "handler"
const DELAY = Number(process.env.HN_DELAY_MS || 0);
const dir = new URL(".", import.meta.url).pathname;

// The same capture the Solid apps serve (30186326, 1,406 comments), read from
// hn-sc rather than copied a fifth time; the Datastar bundle is the one
// dbmon-hypermedia vendors.
const cachedStory = JSON.parse(readFileSync(dir + "../hn-sc/src/server/story-30186326.json", "utf8"));
const CACHED_STORY_ID = String(cachedStory.id);

const STATIC = {
  "/app.css": { file: dir + "app.css", type: "text/css" },
  "/datastar.js": { file: dir + "../dbmon-hypermedia/datastar.js", type: "text/javascript" }
};
const staticBrotli = new Map();

// ---- data: the same source as hn-sc/src/server/hn.ts ----

const mapStories = { top: "news", new: "newest", show: "show", ask: "ask", job: "jobs" };

async function fetchAPI(path) {
  const url = path.startsWith("user")
    ? `https://hacker-news.firebaseio.com/v0/${path}.json`
    : `https://node-hnapi.herokuapp.com/${path}`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": "chrome" } });
    return JSON.parse(await response.text());
  } catch (e) {
    console.error(`HN API: ${e.message}`);
    return { error: e };
  }
}

const getStories = async (type, page) => (mapStories[type] ? fetchAPI(`${mapStories[type]}?page=${page}`) : []);

async function getStory(id) {
  if (id === CACHED_STORY_ID) {
    if (DELAY) await new Promise(r => setTimeout(r, DELAY));
    return cachedStory;
  }
  return fetchAPI(`item/${id}`);
}

const getUser = id => fetchAPI(`user/${id}`);

// ---- markup: the same as the Solid apps' components ----

const esc = s =>
  String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The router marks the current feed's link with data-active; here the server
// knows the route, so it marks it.
function nav(active) {
  const link = (href, label) =>
    `<a href="${href}"${href === active ? " data-active" : ""}><strong>${label}</strong></a>`;
  return `<header class="header"><nav class="inner">${link("/", "HN")}${link("/new", "New")}${link("/show", "Show")}${link("/ask", "Ask")}${link("/job", "Jobs")}<a class="github" href="http://github.com/solidjs/solid" target="_blank" rel="noreferrer">Built with Solid</a></nav></header>`;
}

const head = title => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/app.css">
<script type="module" src="/datastar.js"></script>
</head>
<body>`;

function stories(type, page, list) {
  if (!Array.isArray(list)) list = [];
  const prev =
    page > 1
      ? `<a class="page-link" href="/${type}?page=${page - 1}" aria-label="Previous Page">&lt; prev</a>`
      : `<span class="page-link disabled" aria-disabled="true">&lt; prev</span>`;
  const more =
    list.length >= 29
      ? `<a class="page-link" href="/${type}?page=${page + 1}" aria-label="Next Page">more &gt;</a>`
      : `<span class="page-link disabled" aria-disabled="true">more &gt;</span>`;
  let h = `<div class="news-view"><div class="news-list-nav">${prev}<span>page ${page}</span>${more}</div><main class="news-list">`;
  for (const s of list) {
    h += `<li class="news-item"><span class="score">${esc(s.points)}</span><span class="title">`;
    h += s.url
      ? `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title)}</a><span class="host"> (${esc(s.domain)})</span>`
      : `<a href="/stories/${s.id}">${esc(s.title)}</a>`;
    h += `</span><br><span class="meta">`;
    h +=
      s.type !== "job"
        ? `by <a href="/users/${esc(s.user)}">${esc(s.user)}</a> ${esc(s.time_ago)} | <a href="/stories/${s.id}">${s.comments_count ? `${s.comments_count} comments` : "discuss"}</a>`
        : `<a href="/stories/${s.id}">${esc(s.time_ago)}</a>`;
    h += `</span>${s.type !== "link" ? ` <span class="label">${esc(s.type)}</span>` : ""}</li>`;
  }
  return h + "</main></div>";
}

// The replies' collapse. With TOGGLES=signals each comment gets a local
// signal (`_` prefix: never sent to the server) named after its id; with
// TOGGLES=handler the click flips the `open` class and sets the label, and
// app.css hides the replies of a closed toggle. The server renders the open
// state, so nothing changes when Datastar binds it.
function replies(c) {
  const children = c.comments.map(comment).join("");
  if (!TOGGLES)
    return `<details class="toggle" open><summary><span class="open-label">[-]</span><span class="closed-label">[+] comments collapsed</span></summary><ul class="comment-children">${children}</ul></details>`;
  if (TOGGLES === "handler")
    return (
      `<div class="toggle open"><a data-on:click="el.textContent = el.parentElement.classList.toggle('open') ? '[-]' : '[+] comments collapsed'">[-]</a></div>` +
      `<ul class="comment-children">${children}</ul>`
    );
  const s = `$_open${c.id}`;
  return (
    `<div class="toggle open" data-signals:_open${c.id}="true" data-class:open="${s}">` +
    `<a data-on:click="${s} = !${s}" data-text="${s} ? '[-]' : '[+] comments collapsed'">[-]</a></div>` +
    `<ul class="comment-children" data-show="${s}">${children}</ul>`
  );
}

function comment(c) {
  return `<li class="comment"><div class="by"><a href="/users/${esc(c.user)}">${esc(c.user)}</a> ${esc(c.time_ago)}</div><div class="text">${c.content ?? ""}</div>${c.comments.length ? replies(c) : ""}</li>`;
}

function story(s) {
  return `<div class="item-view"><div class="item-view-header"><a href="${esc(s.url)}" target="_blank"><h1>${esc(s.title)}</h1></a>${s.domain ? `<span class="host">(${esc(s.domain)})</span>` : ""}<p class="meta">${esc(s.points)} points | by <a href="/users/${esc(s.user)}">${esc(s.user)}</a> ${esc(s.time_ago)}</p></div><div class="item-view-comments"><p class="item-view-comments-header">${s.comments_count ? s.comments_count + " comments" : "No comments yet."}</p><ul class="comment-children">${(s.comments ?? []).map(comment).join("")}</ul></div></div>`;
}

function user(u) {
  return `<div class="user-view"><h1>User : ${esc(u.id)}</h1><ul class="meta"><li><span class="label">Created:</span> ${esc(u.created)}</li><li><span class="label">Karma:</span> ${esc(u.karma)}</li>${u.about ? `<li class="about">${u.about}</li>` : ""}</ul><p class="links"><a href="https://news.ycombinator.com/submitted?id=${esc(u.id)}">submissions</a> | <a href="https://news.ycombinator.com/threads?id=${esc(u.id)}">comments</a></p></div>`;
}

// ---- routes ----

function route(pathname, search) {
  let m;
  if ((m = pathname.match(/^\/(top|new|show|ask|job)?$/))) {
    const type = m[1] || "top";
    const page = Number(search.get("page")) || 1;
    return { title: "Hacker News", active: m[1] ? pathname : "/", body: async () => stories(type, page, await getStories(type, page)) };
  }
  if ((m = pathname.match(/^\/stories\/(\d+)$/)))
    return { title: "Hacker News", body: async () => story(await getStory(m[1])) };
  if ((m = pathname.match(/^\/users\/([^/]+)$/)))
    return { title: "Hacker News", body: async () => user(await getUser(decodeURIComponent(m[1]))) };
}

/** Negotiated streaming compressor piped into `res`, or `res` for identity. */
function encoder(req, res) {
  const accepts = req.headers["accept-encoding"] || "";
  let stream;
  if (/\bbr\b/.test(accepts)) {
    res.setHeader("Content-Encoding", "br");
    stream = createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
  } else if (/\bgzip\b/.test(accepts)) {
    res.setHeader("Content-Encoding", "gzip");
    stream = createGzip();
  } else return res;
  stream.pipe(res);
  return stream;
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");

  const asset = STATIC[url.pathname];
  if (asset) {
    const headers = { "Content-Type": asset.type, "Cache-Control": "public, max-age=3600", Vary: "accept-encoding" };
    const content = readFileSync(asset.file);
    if (/\bbr\b/.test(req.headers["accept-encoding"] || "")) {
      let compressed = staticBrotli.get(url.pathname);
      if (!compressed) {
        compressed = brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
        staticBrotli.set(url.pathname, compressed);
      }
      res.writeHead(200, { ...headers, "Content-Encoding": "br" });
      return res.end(compressed);
    }
    res.writeHead(200, headers);
    return res.end(content);
  }

  const r = route(url.pathname, url.searchParams);
  if (!r) return res.writeHead(404).end("not found");
  // Cacheable for a minute, like the Solid apps' responses (src/server/cache.ts).
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.setHeader("Vary", "accept-encoding");
  if (req.method === "HEAD") return res.end();
  const out = encoder(req, res);
  const write = s => {
    out.write(s);
    if (out !== res) out.flush();
  };
  try {
    write(head(r.title) + nav(r.active) + '<div class="page">');
    write((await r.body()) + "</div></body></html>");
  } catch (e) {
    console.error(e);
    write(`<p>${esc(e.message)}</p></div></body></html>`);
  }
  out.end();
}).listen(PORT, () => {
  console.log(`HackerNews (Datastar${TOGGLES ? `, ${TOGGLES} toggles` : ""}) on http://localhost:${PORT}`);
});
