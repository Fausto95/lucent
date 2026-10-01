import { escape, SITE } from "./meta";
import type { PostEntry } from "./types";

/** A post's day (YYYY-MM-DD) as RSS dates it: RFC 822, at midnight UTC. */
const rfc822 = (date: string): string => new Date(`${date}T00:00:00Z`).toUTCString();

/**
 * The blog as RSS 2.0, newest first, the way posts.ts lists the posts:
 * the build writes it to /blog/rss.xml (vite.config.js).
 */
export function rssFeed(posts: Pick<PostEntry, "slug" | "title" | "date" | "summary">[]): string {
  const blog = `${SITE}/blog/`;
  const items = posts.map((post) => {
    const url = `${blog}${post.slug}/`;

    return [
      "    <item>",
      `      <title>${escape(post.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${rfc822(post.date)}</pubDate>`,
      `      <description>${escape(post.summary)}</description>`,
      "    </item>",
    ].join("\n");
  });
  const updated = posts[0] ? [`    <lastBuildDate>${rfc822(posts[0].date)}</lastBuildDate>`] : [];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>Lucent blog</title>",
    `    <link>${blog}</link>`,
    "    <description>What's new in Lucent, and how it works.</description>",
    "    <language>en</language>",
    `    <atom:link href="${blog}rss.xml" rel="self" type="application/rss+xml" />`,
    ...updated,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
