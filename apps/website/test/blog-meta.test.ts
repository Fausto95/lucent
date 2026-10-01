import { describe, expect, it } from "vite-plus/test";
import { postHead } from "../src/blog/meta.ts";

const post = {
  slug: "native-views",
  title: 'Views & "JSX"',
  date: "2026-09-30",
  summary: "SwiftUI and Compose <from> one file.",
  image: "/blog/native-views/og.png",
  imageAlt: "A like button.",
};

const content = (head: ReturnType<typeof postHead>, key: string) =>
  head.find((e) => e.attrs.name === key || e.attrs.property === key)?.attrs.content;

describe("a post's link-preview tags", () => {
  it("make it an article, published on its day", () => {
    const head = postHead(post);

    expect(content(head, "og:type")).toBe("article");
    expect(content(head, "article:published_time")).toBe("2026-09-30");
    expect(content(head, "twitter:title")).toBe('Views & "JSX"');
    expect(content(head, "twitter:description")).toBe("SwiftUI and Compose <from> one file.");
  });

  it("give its image as an absolute address, and its address as canonical", () => {
    const head = postHead(post);

    expect(content(head, "og:image")).toBe("https://www.lucent-lang.dev/blog/native-views/og.png");
    expect(content(head, "twitter:image")).toBe(
      "https://www.lucent-lang.dev/blog/native-views/og.png",
    );
    expect(content(head, "og:image:alt")).toBe("A like button.");
    expect(head).toContainEqual({
      tag: "link",
      attrs: { rel: "canonical", href: "https://www.lucent-lang.dev/blog/native-views/" },
    });
  });

  it("keep the site's image for a post without one", () => {
    const { image: _image, imageAlt: _alt, ...plain } = post;
    const head = postHead(plain);

    expect(content(head, "og:image")).toBeUndefined();
    expect(content(head, "og:image:alt")).toBeUndefined();
  });
});
