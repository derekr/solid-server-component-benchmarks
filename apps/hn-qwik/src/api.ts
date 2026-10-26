import { server$ } from "@builder.io/qwik-city";
import cachedStory from "../story-30186326.json";

const mapStories = {
  top: "news",
  new: "newest",
  show: "show",
  ask: "ask",
  job: "jobs",
};

// Benchmark: the test thread (30186326) is served from the same capture as
// the Solid apps, after the same fixed HN_DELAY_MS, so every app sees
// identical data and latency. It is read on the server, so a client
// navigation to it goes through the server too, as the Solid apps' do.
const getCachedStory = server$(async () => {
  const delay = Number(process.env.HN_DELAY_MS || 0);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  return cachedStory;
});

export function getStory(id: number) {
  if (id === cachedStory.id) return getCachedStory();
  return get(`https://node-hnapi.herokuapp.com/item/${id}`);
}
export function getUser(id: number) {
  return get(`https://hacker-news.firebaseio.com/v0/user/${id}.json`);
}
// The feeds are read on the server, as the cached story is (and as the
// Solid apps' getStories server function is), so a client navigation to a
// feed page goes through the server too. HN_FEED=snapshot serves them from
// the same fixed snapshot as the Solid apps (hn-sc's copy, read at run time
// from the app's directory), after the same HN_DELAY_MS, so the feed pages
// can be measured without the live API.
let feedsSnapshot: Record<string, unknown> | undefined;
const getFeed = server$(async (p: string) => {
  if (process.env.HN_FEED !== "snapshot")
    // Benchmark: an unreachable live API shows an empty feed instead of a
    // 500 page, so the navigation runner can start from it.
    return get(`https://node-hnapi.herokuapp.com/${p}`).catch(() => []);
  const delay = Number(process.env.HN_DELAY_MS || 0);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  if (!feedsSnapshot) {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    feedsSnapshot = JSON.parse(readFileSync(join(process.cwd(), "../hn-sc/src/server/feeds-snapshot.json"), "utf8"));
  }
  return (feedsSnapshot![p] ?? []) as any[];
});

export function getStories(type: keyof(typeof mapStories), page: number) {
  const l = mapStories[type];
  return l ? getFeed(`${l}?page=${page}`) : [];
}

async function get(href: string) {
  const res = await fetch(href, {
    headers: { "User-Agent": "chrome" },
  });

  return res.json();
}
