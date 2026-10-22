import cachedStory from "./story-30186326.json";

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
  const url = path.startsWith("user") ? user(path) : story(path);
  const headers = { "User-Agent": "chrome" };

  return fetch(url, { headers, cache: 'no-store' }).then((r) => r.json());
}
