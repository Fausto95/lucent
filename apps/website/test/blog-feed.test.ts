import { describe, expect, it } from "vite-plus/test";
import { rssFeed } from "../src/blog/feed.ts";

const posts = [
  {
    slug: "native-views",
    title: 'Views & "JSX" <now>',
    date: "2026-09-30",
    summary: "SwiftUI & Compose from one file.",
  },
  { slug: "modules", title: "Modules", date: "2026-09-01", summary: "Native modules." },
];

describe("the blog's RSS feed", () => {
  it("is RSS 2.0 about the blog, linking to itself", () => {
    const xml = rssFeed(posts);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')).toBe(true);
    expect(xml).toContain("<title>Lucent blog</title>");
    expect(xml).toContain("<link>https://www.lucent-lang.dev/blog/</link>");
    expect(xml).toContain(
      '<atom:link href="https://www.lucent-lang.dev/blog/rss.xml" rel="self" type="application/rss+xml" />',
    );
    expect(xml).toContain("<language>en</language>");
  });

  it("has an item per post, newest first, escaped", () => {
    const xml = rssFeed(posts);
    const items = xml.split("<item>").slice(1);

    expect(items).toHaveLength(2);
    expect(items[0]).toContain("<title>Views &amp; &quot;JSX&quot; &lt;now&gt;</title>");
    expect(items[0]).toContain("<link>https://www.lucent-lang.dev/blog/native-views/</link>");
    expect(items[0]).toContain(
      '<guid isPermaLink="true">https://www.lucent-lang.dev/blog/native-views/</guid>',
    );
    expect(items[0]).toContain("<description>SwiftUI &amp; Compose from one file.</description>");
    expect(items[1]).toContain("<link>https://www.lucent-lang.dev/blog/modules/</link>");
  });

  it("dates posts and the feed in RFC 822, at midnight UTC", () => {
    const xml = rssFeed(posts);

    expect(xml).toContain("<pubDate>Wed, 30 Sep 2026 00:00:00 GMT</pubDate>");
    expect(xml).toContain("<pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate>");
    expect(xml).toContain("<lastBuildDate>Wed, 30 Sep 2026 00:00:00 GMT</lastBuildDate>");
  });
});
