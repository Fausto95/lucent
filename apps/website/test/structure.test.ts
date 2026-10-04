import { describe, expect, it } from "vite-plus/test";
import { checkPages } from "../../../scripts/website/pages.ts";
import { type DocSection, slugsOf } from "../src/docs/nav.ts";
import type { DocPage } from "../src/docs/types.ts";

const sections: DocSection[] = [
  {
    label: "Guides",
    dir: "guides",
    groups: [{ label: "Get started", items: ["", "guides/install"] }],
  },
  {
    label: "Architecture",
    dir: "architecture",
    groups: [
      { label: "How Lucent works", items: ["architecture"] },
      { label: "Internals", items: ["architecture/internals", "architecture/internals/compiler"] },
    ],
  },
];

const page = (slug: string, extra: Partial<DocPage> = {}): DocPage => ({
  slug,
  title: slug || "What is Lucent?",
  description: "A page.",
  kind: slug.startsWith("architecture/internals") ? "internals" : "guide",
  blocks: [],
  ...extra,
});

const pages = (overrides: Record<string, Partial<DocPage>> = {}): DocPage[] =>
  slugsOf(sections).map((slug) => page(slug, overrides[slug]));

describe("the docs pages", () => {
  it("pass when each says its kind and Next stays in its section", () => {
    expect(checkPages(pages(), sections)).toEqual([]);
  });

  it("let a section's last page go without a Next link", () => {
    expect(
      checkPages(
        pages().filter((p) => p.slug !== "architecture/internals/compiler"),
        sections,
      ),
    ).toEqual([]);
  });

  it("keep a frontmatter Next inside the page's section", () => {
    const next = { link: "/docs/architecture/", label: "architecture" };

    expect(checkPages(pages({ "guides/install": { next } }), sections)).toEqual([
      "/docs/guides/install/: next is /docs/architecture/, in Architecture: Next stays in Guides",
    ]);
  });

  it("name a page that exists, by its title, as Next", () => {
    expect(
      checkPages(pages({ "": { next: { link: "/docs/guides/gone/", label: "Gone" } } }), sections),
    ).toEqual(["/docs/: next is /docs/guides/gone/, which is not a page"]);
    expect(
      checkPages(
        pages({ "": { next: { link: "/docs/guides/install/", label: "Install" } } }),
        sections,
      ),
    ).toEqual(["/docs/: next's label should be its page's title"]);
  });

  it("say a kind the checks know", () => {
    expect(checkPages(pages({ "": { kind: "learn" as never } }), sections)).toEqual([
      "/docs/: kind is learn, not one of start, guide, explanation, example, reference, internals",
    ]);
  });

  it("are internals exactly under Architecture's Internals", () => {
    expect(
      checkPages(
        pages({
          architecture: { kind: "internals" },
          "architecture/internals/compiler": { kind: "explanation" },
        }),
        sections,
      ),
    ).toEqual([
      "/docs/architecture/: kind internals is for pages under /docs/architecture/internals/",
      "/docs/architecture/internals/compiler/: a page under /docs/architecture/internals/ is kind internals",
    ]);
  });

  it("mark pages about views as experimental in the sidebar", () => {
    expect(checkPages(pages({ "guides/install": { views: true } }), sections)).toEqual([
      '/docs/guides/install/: views are experimental: set sidebar: { badge: "Experimental" }',
    ]);
    expect(
      checkPages(
        pages({ "guides/install": { views: true, sidebar: { badge: "Experimental" } } }),
        sections,
      ),
    ).toEqual([]);
  });
});
