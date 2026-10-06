import { describe, expect, it } from "vite-plus/test";
import { checkOutsideLinks } from "../../../scripts/website/links.ts";
import type { CheckedPage } from "../../../scripts/website/pages.ts";

const pages: CheckedPage[] = [
  {
    href: "/docs/",
    kind: "start",
    title: "What is Lucent?",
    description: "",
    blocks: [],
  },
  {
    href: "/docs/api/diagnostics/",
    kind: "reference",
    title: "Diagnostics",
    description: "",
    blocks: [
      { kind: "h2", text: "Language" },
      { kind: "h3", text: "LUCENT1001" },
    ],
  },
];

const check = (name: string, text: string) => checkOutsideLinks([{ name, text }], pages);

describe("links into the docs from outside the site's pages", () => {
  it("resolve when they name a page and one of its headings", () => {
    expect(
      check(
        "README.md",
        [
          "[Docs](https://lucent-lang.dev/docs/)",
          "[LUCENT1001](https://www.lucent-lang.dev/docs/api/diagnostics/#lucent1001)",
          '<a href="/docs/api/diagnostics/#language">',
          "[Posts](/blog/) and [the feed](/blog/rss.xml)",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("name the file and line of a link to a page that doesn't exist", () => {
    expect(check("src/pages/index.astro", '<p>\n  <a href="/docs/tutorial/">Tutorial</a>')).toEqual(
      ["src/pages/index.astro:2: link to /docs/tutorial/, which is not a page"],
    );
  });

  it("report an anchor that no heading has", () => {
    expect(
      check("ROADMAP.md", "See https://lucent-lang.dev/docs/api/diagnostics/#lucent9999."),
    ).toEqual(["ROADMAP.md:1: link to /docs/api/diagnostics/#lucent9999, which has no heading"]);
  });

  it("don't read a path inside the repository as a link", () => {
    expect(check("AGENTS.md", "Pages live in apps/website/src/content/docs/docs/.")).toEqual([]);
  });
});
