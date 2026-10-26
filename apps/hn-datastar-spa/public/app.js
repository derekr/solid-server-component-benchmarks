// The whole client: one Rocket component, <hn-app>, that fetches a page's
// JSON once and renders it with Rocket's `html` templates (the comment thread
// as one HTML string, see `comment`), the same markup ../hn-spa renders with
// Solid. Datastar is not in charge of the data here:
// the JSON stays a plain object handed to `render`, as Solid's `query` hands
// its result to the components. There are no signals at all: the comment
// toggles (TOGGLES=1) are a class flipped by one delegated click handler.
//
// There is no router. A click on a same-origin link to one of the app's
// pages is handled here: push the URL, fetch that page's JSON, render.
import { rocket } from "/datastar-rocket.js";

const TOGGLES = document.documentElement.hasAttribute("data-toggles");

const dataUrl = loc => {
  let m;
  if ((m = loc.pathname.match(/^\/stories\/(\d+)$/))) return { kind: "story", url: `/api/story/${m[1]}` };
  if ((m = loc.pathname.match(/^\/users\/([\w-]+)$/))) return { kind: "user", url: `/api/user/${m[1]}` };
  if ((m = loc.pathname.match(/^\/(top|new|show|ask|job)?$/))) {
    const page = Number(new URLSearchParams(loc.search).get("page")) || 1;
    return { kind: "stories", type: m[1] || "top", page, url: `/api/stories/${m[1] || "top"}?page=${page}` };
  }
  return null;
};

// Deleted comments have no user or content: Solid renders those as nothing,
// and Rocket refuses undefined inside an attribute, hence the `?? ""`s.
//
// Comment and user bodies are HTML from HN; Rocket's templates escape
// strings, so these go in as nodes (Solid's `innerHTML={...}`).
const raw = (tag, cls, html) => {
  const el = document.createElement(tag);
  el.className = cls;
  el.innerHTML = html;
  return el;
};

// The thread is built as one HTML string and parsed once, then handed to
// Rocket as a single node. One `html` call per comment (1,406 here) made
// Rocket scan, parse and walk each comment's markup on its own, about 2.4x
// the script of this. It's safe because no comment carries a binding: the
// toggles are one delegated click (see story). User and time are escaped;
// comment bodies are HN's HTML, as before.
const esc = v => String(v ?? "").replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

const comment = c =>
  `<li class="comment"><div class="by"><a href="/users/${esc(c.user)}">${esc(c.user)}</a> ${esc(c.time_ago)}</div><div class="text">${c.content ?? ""}</div>${
    c.comments.length ? (TOGGLES ? toggle(c) : details(c)) : ""
  }</li>`;

const details = c =>
  `<details class="toggle" open><summary><span class="open-label">[-]</span><span class="closed-label">[+] comments collapsed</span></summary><ul class="comment-children">${c.comments.map(comment).join("")}</ul></details>`;

// The toggle with no signal and no binding per comment: one data-on:click
// on the thread (see story) flips the `open` class of the toggle clicked,
// and app.css swaps the label and hides a closed toggle's replies. Its markup
// is the Solid toggle's (div.toggle.open > a), with the two labels as spans.
const toggle = c =>
  `<div class="toggle open"><a><span class="open-label">[-]</span><span class="closed-label">[+] comments collapsed</span></a></div><ul class="comment-children">${c.comments.map(comment).join("")}</ul>`;

// Every toggle in the thread, nested ones included. Harmless without
// toggles: no .toggle > a to find.
const onToggle = "evt.target.closest('.toggle > a')?.parentNode.classList.toggle('open')";

function story(html, s) {
  return html`<div class="item-view"><div class="item-view-header"><a href="${s.url}" target="_blank"><h1>${s.title}</h1></a>${
    s.domain ? html`<span class="host">(${s.domain})</span>` : null
  }<p class="meta">${s.points} points | by <a href="/users/${s.user}">${s.user}</a> ${s.time_ago}</p></div><div class="item-view-comments" data-on:click="${onToggle}"><p class="item-view-comments-header">${
    s.comments_count ? s.comments_count + " comments" : "No comments yet."
  }</p>${raw("ul", "comment-children", s.comments.map(comment).join(""))}</div></div>`;
}

function storyItem(html, s) {
  const title = s.url
    ? html`<a href="${s.url}" target="_blank" rel="noreferrer">${s.title}</a><span class="host"> (${s.domain})</span>`
    : html`<a href="/stories/${s.id}">${s.title}</a>`;
  const meta =
    s.type !== "job"
      ? html`by <a href="/users/${s.user}">${s.user}</a> ${s.time_ago} | <a href="/stories/${s.id}">${s.comments_count ? `${s.comments_count} comments` : "discuss"}</a>`
      : html`<a href="/stories/${s.id}">${s.time_ago}</a>`;
  return html`<li class="news-item"><span class="score">${s.points}</span><span class="title">${title}</span><br><span class="meta">${meta}</span>${
    s.type !== "link" ? html` <span class="label">${s.type}</span>` : null
  }</li>`;
}

function stories(html, { type, page, data }) {
  const list = Array.isArray(data) ? data : [];
  return html`<div class="news-view"><div class="news-list-nav">${
    page > 1
      ? html`<a class="page-link" href="/${type}?page=${page - 1}" aria-label="Previous Page">&lt; prev</a>`
      : html`<span class="page-link disabled" aria-disabled="true">&lt; prev</span>`
  }<span>page ${page}</span>${
    list.length >= 29
      ? html`<a class="page-link" href="/${type}?page=${page + 1}" aria-label="Next Page">more &gt;</a>`
      : html`<span class="page-link disabled" aria-disabled="true">more &gt;</span>`
  }</div><main class="news-list">${list.map(s => storyItem(html, s))}</main></div>`;
}

const user = (html, u) =>
  html`<div class="user-view"><h1>User : ${u.id}</h1><ul class="meta"><li><span class="label">Created:</span> ${u.created}</li><li><span class="label">Karma:</span> ${u.karma}</li>${
    u.about ? raw("li", "about", u.about) : null
  }</ul><p class="links"><a href="https://news.ycombinator.com/submitted?id=${u.id}">submissions</a> | <a href="https://news.ycombinator.com/threads?id=${u.id}">comments</a></p></div>`;

const VIEWS = { story, stories, user };

rocket("hn-app", {
  mode: "light",
  setup({ render, cleanup }) {
    let current = 0;
    // A <link rel="preload"> for a page's JSON, once per URL: the next fetch
    // of it is served from the preload. (rel="prefetch" goes to the HTTP
    // cache, which the uncacheable JSON doesn't stay in, so the click fetched
    // it again.)
    const prefetched = new Set();
    const hint = url => {
      if (prefetched.has(url)) return;
      prefetched.add(url);
      document.head.append(Object.assign(document.createElement("link"), { rel: "preload", as: "fetch", href: url, crossOrigin: "" }));
    };
    async function load() {
      const route = dataUrl(location);
      if (!route) return render({}, { kind: "missing" });
      const n = ++current;
      const data = await (await fetch(route.url)).json();
      if (n !== current) return;
      render({}, { ...route, data });
      if (route.kind === "story") scrollTo(0, 0);
      // A feed page patches in the hint for the page after it, so "more >"
      // reads its JSON from the preload.
      const next = route.kind === "stories" && document.querySelector('a[aria-label="Next Page"]');
      if (next) hint(dataUrl(next).url);
    }
    const onClick = e => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]");
      if (!a || a.target || a.origin !== location.origin || !dataUrl(a)) return;
      e.preventDefault();
      history.pushState(null, "", a.href);
      load();
    };
    // The next page's data, fetched on intent with the platform's hint, as the
    // multi-page port prerenders from speculation rules: as soon as the
    // pointer is over a link to one of the app's pages, a preload fetches
    // that page's JSON, and the click's fetch is served from it, as the
    // shell's preload is on first load.
    const onOver = e => {
      const a = e.target.closest?.("a[href]");
      const route = a && !a.target && a.origin === location.origin && dataUrl(a);
      if (route) hint(route.url);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("pointerover", onOver);
    addEventListener("popstate", load);
    cleanup(() => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerover", onOver);
      removeEventListener("popstate", load);
    });
    load();
  },
  render({ html }, view) {
    if (!view) return html`<div class="news-list-nav">Loading...</div>`;
    if (view.kind === "missing") return html`<div class="news-list-nav">Not found</div>`;
    return VIEWS[view.kind](html, view.kind === "stories" ? view : view.data);
  }
});
