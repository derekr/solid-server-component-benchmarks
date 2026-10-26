// Hacker News on Datastar: the same routes, markup and data as the Solid
// apps, rendered on the server as plain HTML and navigated as a multi-page
// app (every link is a document load, the way Datastar apps are usually
// built). No build step; the page loads Datastar 1.0.4 and nothing else.
//
// Four variants from one server, like dbmon-hypermedia's PATCH=rows:
// - default: the whole thread in the first load, and comment collapse is a
//   native <details>, as in hn-sc and hn-spa. No Datastar attribute on the
//   page does anything, so Datastar's cost here is the fixed one: download,
//   parse, and one scan of the DOM.
// - CV=1: the same page with content-visibility (below).
// - TOGGLES=signals: the whole thread, with a toggle on every comment that
//   has replies, the counterpart of hn-sc-toggles' client Toggle (652 on the
//   test story). The state is one signal, the list of collapsed comment ids,
//   updated by one delegated handler on the thread on pointerdown, and one
//   <style> turns it into CSS that hides the replies and swaps the label.
//   No Datastar attribute per comment.
// - TOGGLES=window: the thread the way a hypermedia app would ship it, not
//   like for like with the others: the page has only the comments around
//   the viewport (HN_VIEW, default 10, plus HN_OVERSCAN, default 20, each
//   side) and asks the server for the rest as it scrolls. Collapsing is a
//   signal and CSS, instant; the server keeps no state and never sends a
//   collapsed comment's replies. See "the windowed thread" below.
//
// CV=1, with the default <details> page: every top-level comment (with its
// replies) gets content-visibility: auto, so the browser skips laying out
// and painting threads off screen, the platform's answer to a long page.
// contain-intrinsic-size holds a skipped thread's place at 400px until it
// has rendered once, then at its last size.
//
// Responses are compressed the way the other apps' servers do it: pages are
// streamed through brotli quality 4 and flushed per chunk, so the shell
// (head, nav) leaves before the data is ready; static assets are compressed
// once at quality 9 and cached.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { brotliCompressSync, createBrotliCompress, createGzip, constants } from "node:zlib";

const PORT = Number(process.env.PORT || 3011);
const TOGGLES = process.env.TOGGLES; // undefined, "signals" or "window"
const VIEW = Number(process.env.HN_VIEW || 10); // TOGGLES=window: comments for the screen
const OVERSCAN = Number(process.env.HN_OVERSCAN || 20); // and more on each side
const DELAY = Number(process.env.HN_DELAY_MS || 0);
const CV = process.env.CV === "1";
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

// HN_FEED=snapshot: the feeds from the Solid apps' fixed snapshot (four pages
// of each), after the same HN_DELAY_MS, so the feed pages and their paging
// can be measured without the live API.
const feedsSnapshot = process.env.HN_FEED === "snapshot" ? JSON.parse(readFileSync(dir + "../hn-sc/src/server/feeds-snapshot.json", "utf8")) : null;

async function getStories(type, page) {
  if (!mapStories[type]) return [];
  if (!feedsSnapshot) return fetchAPI(`${mapStories[type]}?page=${page}`);
  if (DELAY) await new Promise(r => setTimeout(r, DELAY));
  return feedsSnapshot[`${mapStories[type]}?page=${page}`] ?? [];
}

async function getStory(id) {
  let story;
  if (id === CACHED_STORY_ID) {
    if (DELAY) await new Promise(r => setTimeout(r, DELAY));
    story = cachedStory;
  } else story = await fetchAPI(`item/${id}`);
  if (!story?.error) fetched.set(id, { story, at: Date.now() });
  return story;
}

// The windowed thread's posts read the story its page was just rendered
// from, as a real server would keep it (every response here is cacheable for
// a minute), so a scroll doesn't wait on the HN API again. A page load
// always fetches.
const fetched = new Map();
async function getFetchedStory(id) {
  const hit = fetched.get(id);
  return hit && Date.now() - hit.at < 60_000 ? hit.story : getStory(id);
}

const getUser = id => fetchAPI(`user/${id}`);

// ---- markup: the same as the Solid apps' components ----

const esc = s =>
  String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The router marks the current feed's link with data-active; here the server
// knows the route, so it marks it.
// The page's own navigation is plain links, made fast the way a multi-page
// app does it: speculation rules (in the head) prerender a header or feed
// link as soon as the pointer rests on it (eager), and prefetch it after
// about 200 ms of hover (moderate). A moderate prerender starts too late to
// finish the thread before the click (runners/prerender.mjs). The header's
// links, a nav bar, go on pointerdown instead of waiting for the click.
const NAV_ON_DOWN = ` data-on:pointerdown="const a = evt.target.closest('a'); if (a && a.origin === location.origin && evt.button === 0 && !(evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey)) location.href = a.href"`;

function nav(active) {
  const link = (href, label) =>
    `<a href="${href}"${href === active ? " data-active" : ""}><strong>${label}</strong></a>`;
  return `<header class="header"><nav class="inner"${NAV_ON_DOWN}>${link("/", "HN")}${link("/new", "New")}${link("/show", "Show")}${link("/ask", "Ask")}${link("/job", "Jobs")}<a class="github" href="https://github.com/starfederation/datastar" target="_blank" rel="noreferrer">Built with Datastar</a></nav></header>`;
}

const head = title => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/app.css">
${CV ? "<style>.item-view-comments > .comment-children > .comment { content-visibility: auto; contain-intrinsic-size: auto 400px; }</style>\n" : ""}<script type="module" src="/datastar.js"></script>
<script type="speculationrules">{"prefetch": [{"where": {"and": [{"href_matches": "/*"}, {"selector_matches": ".header a, .news-list a"}]}, "eagerness": "moderate"}], "prerender": [{"where": {"and": [{"href_matches": "/*"}, {"selector_matches": ".header a, .news-list a"}]}, "eagerness": "eager"}]}</script>
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

// The replies' collapse is the browser's, a <details> open as rendered, or
// with TOGGLES=signals a toggle the page's one handler and <style> drive
// (below). The server renders everything open either way.
const replies = c =>
  TOGGLES === "signals"
    ? `<div class="toggle open" id="t${c.id}" data-id="${c.id}"><a><span class="open-label">[-]</span><span class="closed-label">[+] comments collapsed</span></a></div><ul class="comment-children">${c.comments.map(comment).join("")}</ul>`
    : `<details class="toggle" open><summary><span class="open-label">[-]</span><span class="closed-label">[+] comments collapsed</span></summary><ul class="comment-children">${c.comments.map(comment).join("")}</ul></details>`;

// TOGGLES=signals: a press on a toggle adds or removes its id in $_closed
// (`_`: never sent to the server). It acts on pointerdown, not click, so the
// replies hide or show as the press lands. The <style> hides those replies
// and shows their "collapsed" label.
const COLLAPSE =
  ` data-on:pointerdown="const id = evt.target.closest('.toggle')?.dataset.id; if (id) $_closed = $_closed.includes(id) ? $_closed.filter(x => x !== id) : [...$_closed, id]"`;
// The collapsed toggle's highlight, the <details> pages' closed summary.
const CLOSED_LOOK = "background-color: #fffbf2; padding: 0.3em 0.5em; margin-bottom: 1em";
const COLLAPSE_STYLE = `<style data-text="$_closed.map(id => '#t' + id + ' + .comment-children, #t' + id + ' .open-label { display: none } #t' + id + ' .closed-label { display: inline } #t' + id + ' > a { ${CLOSED_LOOK} }').join(' ')"></style>`;

function comment(c) {
  return `<li class="comment"><div class="by"><a href="/users/${esc(c.user)}">${esc(c.user)}</a> ${esc(c.time_ago)}</div><div class="text">${c.content ?? ""}</div>${c.comments.length ? replies(c) : ""}</li>`;
}

// ---- the windowed thread (TOGGLES=window) ----
// The tree flattened in reading order, each comment with its depth, its
// ancestors' ids and the index just past its replies, so a collapsed comment
// skips them in one step. The rows are a flat list indented by depth, so a
// window of them can be cut anywhere in the tree. A row's index here never
// changes; collapsing only changes which rows are visible.
const flat = new WeakMap();
function rowsOf(s) {
  let rows = flat.get(s);
  if (rows) return rows;
  rows = [];
  const walk = (list, path) => {
    for (const c of list) {
      const row = { c, path, end: 0 };
      rows.push(row);
      walk(c.comments, [...path, c.id]);
      row.end = rows.length;
    }
  };
  walk(s.comments ?? [], []);
  flat.set(s, rows);
  return rows;
}

// Each row carries a class per ancestor (`u` and its id), so the page can
// hide a collapsed comment's loaded replies with one CSS rule.
function row(rows, i) {
  const { c, path } = rows[i];
  const toggle = c.comments.length
    ? `<div class="toggle open" data-id="${c.id}"><a><span class="open-label">[-]</span><span class="closed-label">[+] comments collapsed</span></a></div>`
    : "";
  return `<li class="comment${path.map(id => ` u${id}`).join("")}" id="c${c.id}" data-i="${i}"${path.length ? ` style="margin-left:${path.length * 1.5}em"` : ""}><div class="by"><a href="/users/${esc(c.user)}">${esc(c.user)}</a> ${esc(c.time_ago)}</div><div class="text">${c.content ?? ""}</div>${toggle}</li>`;
}

// The rows to have loaded: the comment at the top of the viewport, VIEW
// more for the screen and OVERSCAN on each side (fewer at the ends of the
// thread), counting only rows outside collapsed replies. The window is
// counted in comments, not pixels: a comment's height depends on its text
// and the screen, and the server doesn't need it. When rows above the
// viewport are added or removed, the browser's scroll anchoring
// (overflow-anchor, on by default) keeps the comment being read where it
// is. The cost is the scrollbar: it spans the loaded rows, not the whole
// thread. A true-length one would need spacers above and below sized from an
// estimate of each comment's height (from its text length, say), corrected
// as rows load.
function wanted(rows, collapsed, top) {
  const vis = [];
  for (let i = 0; i < rows.length; ) {
    vis.push(i);
    i = collapsed.has(rows[i].c.id) ? rows[i].end : i + 1;
  }
  // The top comment's place among the visible rows; if it is hidden (a
  // collapse above it), the comment that hides it.
  let at = 0;
  while (at + 1 < vis.length && vis[at + 1] <= top) at++;
  const from = Math.max(0, at - OVERSCAN), to = at + VIEW + OVERSCAN;
  return { want: vis.slice(from, to), at: vis[at], above: from > 0, below: to < vis.length };
}

// A screen's height of empty space above and below the loaded rows while
// there are more comments that way. It is not a size estimate: it keeps the
// page from sitting at the very top or bottom while rows are on their way,
// where there is no further scroll to report the move and, at the top, no
// scroll anchoring to hold the view while rows are added above.
const gap = (id, more) => `<li id="${id}" class="gap"${more ? ' style="height:100vh"' : ""}></li>`;

// The top comment is the first loaded one whose bottom is below the top of
// the viewport (rows hidden by a collapse don't count). A scroll that
// outruns the rows ends up in a gap with no comment on screen: then it's the
// comment just past the loaded ones (or just before them, scrolling up), and
// the post is a jump. With nothing on screen for scroll anchoring to hold,
// the rows coming and going would move the page under the reader, so a
// jump's answer ends by scrolling to that comment: where the reader got to.
//
// Collapse state is the page's alone: one signal, the collapsed ids, turned
// into CSS by one <style>, so a toggle shows at once.
// The server keeps nothing. Each scroll that changes the top comment
// (throttled to 32 ms like dbmon's window, plus a last one on scrollend) and
// each toggle posts the signals: the collapsed ids, the top comment's index
// and the indexes of the rows the page has. The answer is patches: rows
// leaving the window removed, rows entering it put in place. A collapse
// fills the window back up below; an expand loads the replies it hasn't got.
//
// One handler of each kind on the thread, delegated: no attribute per
// comment. Expanding a comment whose replies the page hasn't got posts on
// pointerdown, 80-120 ms before the click, with `flip` naming it so the
// server answers as if it were already open (replies that arrive before the
// click wait hidden by the CSS). The click then only flips the signal; it
// posts itself for everything else (a collapse's fill, an expand whose
// replies are loaded, a click with no press before it).
//
// At most one post is in flight, and none is cancelled: Datastar's default
// aborts a post when the next one to the same URL starts, and during a
// steady scroll that left almost no answer to land until the scroll paused.
// While a post is out ($_busy), a scroll only records the new top comment
// and a click marks a post pending ($_pending); a press waits for its click.
// When the answer has landed, one more post goes if the top has moved since
// ($_sent) or one is pending. Answers so apply in order and never overlap,
// which the `have`-based patches rely on.
const HAVE = `$have = [...document.querySelectorAll('#comments > .comment')].map(c => Number(c.dataset.i))`;
const POST = `$_busy = true; $_pending = false; $_sent = $top; ${HAVE}; @post(location.pathname, {requestCancellation: 'disabled'})`;
const TOP = `const rows = [...document.querySelectorAll('#comments > .comment')].filter(c => c.offsetHeight); const first = rows.find(c => c.getBoundingClientRect().bottom > 0); let top, jump = true; if (!first) top = Number(rows.at(-1).dataset.i) + 1; else if (first.getBoundingClientRect().top >= innerHeight) top = Number(first.dataset.i) - 1; else { top = Number(first.dataset.i); jump = false } if (top !== $top) { $top = top; $jump = jump; if (!$_busy) { $flip = 0; ${POST} } }`;
const TOGGLE = `const id = Number(evt.target.closest('.toggle')?.dataset.id); if (id) { $collapsed = $collapsed.includes(id) ? $collapsed.filter(x => x !== id) : [...$collapsed, id]; if ($_pressed !== id) { if ($_busy) $_pending = true; else { $flip = 0; ${POST} } } $_pressed = 0 }`;
const PRESS = `const id = Number(evt.target.closest('.toggle')?.dataset.id); if (id && !$_busy && $collapsed.includes(id) && !document.querySelector('#comments > .u' + id)) { $_pressed = id; $flip = id; ${POST} }`;
const FINISHED = `if (evt.detail.el === el && evt.detail.type === 'finished') { $_busy = false; if ($_pending || $top !== $_sent) { $flip = 0; ${POST} } }`;
const COLLAPSED_STYLE = `<style data-text="$collapsed.map(id => '.u' + id + ' { display: none } #c' + id + ' > .toggle > a > .open-label { display: none } #c' + id + ' > .toggle > a > .closed-label { display: inline } #c' + id + ' > .toggle > a { ${CLOSED_LOOK} }').join(' ')"></style>`;

function windowThread(s) {
  const rows = rowsOf(s);
  const start = wanted(rows, new Set(), 0);
  return (
    `<div class="item-view-comments" data-signals="{collapsed: [], top: 0, jump: false, flip: 0, have: [], _pressed: 0, _busy: false, _pending: false, _sent: 0}" data-on:scroll__window__throttle.32ms="${TOP}" data-on:scrollend__window="${TOP}" data-on:pointerdown="${PRESS}" data-on:click="${TOGGLE}" data-on:datastar-fetch__document="${FINISHED}">` +
    `<p class="item-view-comments-header">${s.comments_count ? s.comments_count + " comments" : "No comments yet."}</p>${COLLAPSED_STYLE}` +
    `<ul class="comment-children" id="comments">${gap("above", start.above)}${start.want.map(i => row(rows, i)).join("")}${gap("below", start.below)}</ul></div>`
  );
}

const patch = (mode, selector, elements) =>
  `event: datastar-patch-elements\ndata: mode ${mode}\ndata: selector ${selector}\n` +
  (elements ? elements.split("\n").map(l => `data: elements ${l}\n`).join("") : "") +
  "\n";

// The answer to a post: remove the loaded rows outside the window's span (a
// collapsed comment's loaded replies inside it stay, hidden, so expanding
// it again shows them at once), put each run of missing rows before the
// loaded row that follows it (or the gap at the end), and size the gaps. The
// page's rows are in reading order, so the ones it keeps already are.
function windowEvents(s, { collapsed, top, jump, flip, have }) {
  const rows = rowsOf(s);
  collapsed = new Set((collapsed ?? []).map(Number));
  // A pressed toggle: the window as it will be once the click flips it.
  if ((flip = Number(flip))) collapsed.has(flip) ? collapsed.delete(flip) : collapsed.add(flip);
  const { want, at, above, below } = wanted(rows, collapsed, Math.max(0, Number(top) || 0));
  if (!want.length) return "";
  const lo = want[0], hi = want.at(-1);
  have = (have ?? []).map(Number).filter(i => i >= 0 && i < rows.length);
  const gone = have.filter(i => i < lo || i > hi);
  const kept = have.filter(i => i >= lo && i <= hi).sort((a, b) => a - b);
  const loaded = new Set(kept);
  let event = gone.length ? patch("remove", gone.map(i => `#c${rows[i].c.id}`).join(", ")) : "";
  let run = "", before, k = 0;
  const flush = () => {
    if (run) event += patch("before", before === undefined ? "#below" : `#c${rows[before].c.id}`, run);
    run = "";
  };
  for (const i of want) {
    if (loaded.has(i)) continue;
    while (k < kept.length && kept[k] < i) k++;
    if (kept[k] !== before) flush();
    before = kept[k];
    run += row(rows, i);
  }
  flush();
  event += patch("outer", "#above", gap("above", above)) + patch("outer", "#below", gap("below", below));
  // Below the fixed header (55px), and only if the reader hasn't moved on
  // since the post went: posts aren't cancelled, so an answer can be stale.
  if (jump)
    event += patch("append", "body", `<div data-effect="el.remove(); if ($top === ${Number(top)}) scrollTo(0, document.getElementById('c${rows[at].c.id}').getBoundingClientRect().top + scrollY - 55)"></div>`);
  return event;
}

// The page's signals: Datastar sends them as JSON in a POST's body.
function signalsOf(json) {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}

function story(s) {
  if (TOGGLES === "window")
    return `<div class="item-view"><div class="item-view-header"><a href="${esc(s.url)}" target="_blank"><h1>${esc(s.title)}</h1></a>${s.domain ? `<span class="host">(${esc(s.domain)})</span>` : ""}<p class="meta">${esc(s.points)} points | by <a href="/users/${esc(s.user)}">${esc(s.user)}</a> ${esc(s.time_ago)}</p></div>${windowThread(s)}</div>`;
  return `<div class="item-view"><div class="item-view-header"><a href="${esc(s.url)}" target="_blank"><h1>${esc(s.title)}</h1></a>${s.domain ? `<span class="host">(${esc(s.domain)})</span>` : ""}<p class="meta">${esc(s.points)} points | by <a href="/users/${esc(s.user)}">${esc(s.user)}</a> ${esc(s.time_ago)}</p></div><div class="item-view-comments"${TOGGLES === "signals" ? ' data-signals:_closed="[]"' : ""}><p class="item-view-comments-header">${s.comments_count ? s.comments_count + " comments" : "No comments yet."}</p>${TOGGLES === "signals" ? COLLAPSE_STYLE : ""}<ul class="comment-children"${TOGGLES === "signals" ? COLLAPSE : ""}>${(s.comments ?? []).map(comment).join("")}</ul></div></div>`;
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

  // The windowed thread's posts: the story's page posts its signals to its
  // own URL and gets Datastar patches back, compressed like the pages.
  const w = TOGGLES === "window" && req.method === "POST" && url.pathname.match(/^\/stories\/(\d+)$/);
  if (w) {
    let body = "";
    for await (const chunk of req) body += chunk;
    const events = windowEvents(await getFetchedStory(w[1]), signalsOf(body));
    if (!events) return res.writeHead(204).end();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Vary", "accept-encoding");
    encoder(req, res).end(events);
    return;
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
  console.log(`HackerNews (Datastar${TOGGLES ? `, ${TOGGLES} toggles` : ""}${CV ? ", content-visibility" : ""}) on http://localhost:${PORT}`);
});
