import { describe, expect, it } from "vite-plus/test";
import {
  type DocSection,
  docsSections,
  docsSlugs,
  headerLinks,
  locate,
  slugOfId,
} from "../src/docs/nav.ts";

const sections: DocSection[] = [
  {
    label: "Guides",
    dir: "guides",
    groups: [
      { label: "Get started", slugs: ["", "guides/install"] },
      { label: "Errors", slugs: ["guides/throw"] },
    ],
  },
  { label: "API", dir: "api", groups: [{ label: "Modules", slugs: ["api", "api/core"] }] },
];

describe("the docs sections", () => {
  it("list every page in reading order: sections, then groups, then pages", () => {
    expect(docsSlugs).toEqual(docsSections.flatMap((s) => s.groups.flatMap((g) => g.slugs)));
  });

  it("start with the docs home", () => {
    expect(docsSlugs[0]).toBe("");
  });

  it("are tabs in the header, each opening its first page, with the blog last", () => {
    expect(headerLinks).toEqual([
      ...docsSections.map((s) => ({
        label: s.label,
        link: s.groups[0]!.slugs[0] ? `/docs/${s.groups[0]!.slugs[0]}/` : "/docs/",
      })),
      { label: "Blog", link: "/blog/" },
    ]);
    expect(headerLinks[0]!.link).toBe("/docs/");
  });
});

describe("slugOfId", () => {
  it("reads a docs page's slug from its route id", () => {
    expect(slugOfId("docs")).toBe("");
    expect(slugOfId("docs/api/cli")).toBe("api/cli");
  });

  it("is undefined outside the docs", () => {
    expect(slugOfId("blog/native-views")).toBeUndefined();
    expect(slugOfId("404")).toBeUndefined();
  });
});

describe("locate", () => {
  it("finds a page's section, the section's index and its group", () => {
    expect(locate("guides/throw", sections)).toEqual({
      section: sections[0],
      sectionIndex: 0,
      group: sections[0]!.groups[1],
    });
    expect(locate("api/core", sections)?.sectionIndex).toBe(1);
  });

  it("is undefined for a page the sidebar doesn't list", () => {
    expect(locate("guides/missing", sections)).toBeUndefined();
  });
});
