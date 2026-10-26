import { readFileSync } from "node:fs";
import path from "node:path";
import cachedStory from "./story-30186326.json";

// HN_FEED=snapshot: the feeds from the same fixed snapshot as the Solid apps
// (hn-sc's copy, read at run time from the app's directory), after the same
// HN_DELAY_MS, so the feed pages can be measured without the live API.
let feedsSnapshot: Record<string, unknown> | undefined;
const snapshotFeed = (p: string) =>
  (feedsSnapshot ??= JSON.parse(readFileSync(path.join(process.cwd(), "../hn-sc/src/server/feeds-snapshot.json"), "utf8")))[p];

const story = (path: string) => `https://node-hnapi.herokuapp.com/${path}`;
const user = (path: string) =>
  `https://hacker-news.firebaseio.com/v0/${path}.json`;

// Benchmark: the test thread (30186326) is served from the same capture as
// the Solid apps, after the same fixed HN_DELAY_MS, so every app sees
// identical data and latency.
export default async function fetchAPI(path: string) {
  if (path === `item/${cachedStory.id}`) {
    const delay = Number(process.env.HN_DELAY_MS || 0);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return cachedStory;
  }
  if (process.env.HN_FEED === "snapshot" && /^(news|newest|show|ask|jobs)\?page=\d+$/.test(path)) {
    const delay = Number(process.env.HN_DELAY_MS || 0);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return snapshotFeed(path) ?? [];
  }
  const url = path.startsWith("user") ? user(path) : story(path);
  const headers = { "User-Agent": "chrome" };

  return fetch(url, { headers, cache: 'no-store' }).then((r) => r.json());
}
