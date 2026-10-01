import type { APIRoute } from "astro";
import { rssFeed } from "../../blog/feed";
import { loadPosts } from "../../blog/load";

export const GET: APIRoute = async () =>
  new Response(rssFeed(await loadPosts()), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
