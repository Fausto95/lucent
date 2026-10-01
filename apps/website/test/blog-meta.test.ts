import { describe, expect, it } from "vite-plus/test";
import { withPostMeta } from "../src/blog/meta.ts";

const shell = `<!doctype html><html><head>
<meta name="description" content="Site." />
<title>Lucent</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="Lucent" />
<meta property="og:description" content="Site." />
<meta property="og:image" content="https://www.lucent-lang.dev/og.png" />
<meta property="og:image:alt" content="Lucent." />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Lucent" />
<meta name="twitter:description" content="Site." />
<meta name="twitter:image" content="https://www.lucent-lang.dev/og.png" />
</head><body><div id="root"></div></body></html>`;

const post = {
  slug: "native-views",
  title: 'Views & "JSX"',
  date: "2026-09-30",
  summary: "SwiftUI and Compose <from> one file.",
  image: "/blog/native-views/og.png",
  imageAlt: "A like button.",
};

const content = (html: string, key: string) =>
  html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`))?.[1];

describe("a post's page for link previews", () => {
  it("names the post, its summary and its image, escaped", () => {
    const html = withPostMeta(shell, post);

    expect(html).toContain("<title>Views &amp; &quot;JSX&quot; — Lucent blog</title>");
    expect(content(html, "og:title")).toBe("Views &amp; &quot;JSX&quot;");
    expect(content(html, "description")).toBe("SwiftUI and Compose &lt;from&gt; one file.");
    expect(content(html, "og:description")).toBe("SwiftUI and Compose &lt;from&gt; one file.");
    expect(content(html, "twitter:title")).toBe("Views &amp; &quot;JSX&quot;");
    expect(content(html, "twitter:description")).toBe("SwiftUI and Compose &lt;from&gt; one file.");
  });

  it("is an article at its own address, with an absolute image", () => {
    const html = withPostMeta(shell, post);

    expect(content(html, "og:type")).toBe("article");
    expect(content(html, "og:url")).toBe("https://www.lucent-lang.dev/blog/native-views/");
    expect(content(html, "article:published_time")).toBe("2026-09-30");
    expect(content(html, "og:image")).toBe("https://www.lucent-lang.dev/blog/native-views/og.png");
    expect(content(html, "og:image:alt")).toBe("A like button.");
    expect(content(html, "twitter:image")).toBe("https://www.lucent-lang.dev/blog/native-views/og.png");
    expect(html).toContain(
      '<link rel="canonical" href="https://www.lucent-lang.dev/blog/native-views/" />',
    );
  });

  it("keeps the site's image for a post without one", () => {
    const { image: _image, imageAlt: _alt, ...plain } = post;
    const html = withPostMeta(shell, plain);

    expect(content(html, "og:image")).toBe("https://www.lucent-lang.dev/og.png");
    expect(content(html, "og:image:alt")).toBe("Lucent.");
  });

  it("changes nothing else in the page", () => {
    const html = withPostMeta(shell, post);

    expect(html).toContain('<div id="root"></div>');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
  });
});
