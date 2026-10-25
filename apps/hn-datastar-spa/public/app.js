// The whole client: one Rocket component, <hn-app>, that fetches a page's
// JSON once and renders it with Rocket's `html` templates, the same markup
// ../hn-spa renders with Solid. Datastar is not in charge of the data here:
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

function comment(html, c) {
  return html`<li class="comment"><div class="by"><a href="/users/${c.user ?? ""}">${c.user}</a> ${c.time_ago}</div>${raw("div", "text", c.content ?? "")}${
    c.comments.length ? (TOGGLES ? toggle(html, c) : details(html, c)) : null
  }</li>`;
}

const details = (html, c) =>
  html`<details class="toggle" open><summary><span class="open-label">[-]</span><span class="closed-label">[+] comments collapsed</span></summary><ul class="comment-children">${c.comments.map(k => comment(html, k))}</ul></details>`;

// The toggle with no signal and no binding per comment: one data-on:click
// on the thread (see story) flips the `open` class of the toggle clicked,
// and app.css swaps the label and hides a closed toggle's replies. Its markup
// is the Solid toggle's (div.toggle.open > a), with the two labels as spans.
const toggle = (html, c) =>
  html`<div class="toggle open"><a><span class="open-label">[-]</span><span class="closed-label">[+] comments collapsed</span></a></div><ul class="comment-children">${c.comments.map(k => comment(html, k))}</ul>`;

// Every toggle in the thread, nested ones included. Harmless without
// toggles: no .toggle > a to find.
const onToggle = "evt.target.closest('.toggle > a')?.parentNode.classList.toggle('open')";

function story(html, s) {
  return html`<div class="item-view"><div class="item-view-header"><a href="${s.url}" target="_blank"><h1>${s.title}</h1></a>${
    s.domain ? html`<span class="host">(${s.domain})</span>` : null
  }<p class="meta">${s.points} points | by <a href="/users/${s.user}">${s.user}</a> ${s.time_ago}</p></div><div class="item-view-comments" data-on:click="${onToggle}"><p class="item-view-comments-header">${
    s.comments_count ? s.comments_count + " comments" : "No comments yet."
  }</p><ul class="comment-children">${s.comments.map(c => comment(html, c))}</ul></div></div>`;
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
    async function load() {
      const route = dataUrl(location);
      if (!route) return render({}, { kind: "missing" });
      const n = ++current;
      const data = await (await fetch(route.url)).json();
      if (n !== current) return;
      render({}, { ...route, data });
      if (route.kind === "story") scrollTo(0, 0);
    }
    const onClick = e => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]");
      if (!a || a.target || a.origin !== location.origin || !dataUrl(a)) return;
      e.preventDefault();
      history.pushState(null, "", a.href);
      load();
    };
    document.addEventListener("click", onClick);
    addEventListener("popstate", load);
    cleanup(() => {
      document.removeEventListener("click", onClick);
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
