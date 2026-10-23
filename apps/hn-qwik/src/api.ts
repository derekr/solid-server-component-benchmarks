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
export function getStories(type: keyof(typeof mapStories), page: number) {
  const l = mapStories[type];
  // Benchmark: an unreachable live API shows an empty feed instead of a 500
  // page, so the navigation runner can start from it (the story is cached).
  return l ? get(`https://node-hnapi.herokuapp.com/${l}?page=${page}`).catch(() => []) : [];
}

async function get(href: string) {
  const res = await fetch(href, {
    headers: { "User-Agent": "chrome" },
  });

  return res.json();
}
