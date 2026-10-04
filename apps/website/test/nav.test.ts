import { describe, expect, it } from "vite-plus/test";
import {
  type DocSection,
  docsSections,
  docsSlugs,
  headerLinks,
  locate,
  slugOfId,
  slugsOf,
} from "../src/docs/nav.ts";

const sections: DocSection[] = [
  {
    label: "Guides",
    dir: "guides",
    groups: [
      { label: "Get started", items: ["", "guides/install"] },
      {
        label: "Native APIs",
        items: ["guides/native", { label: "iOS", slugs: ["guides/call-ios", "guides/present"] }],
      },
    ],
  },
  { label: "API", dir: "api", groups: [{ label: "Modules", items: ["api", "api/core"] }] },
];

describe("the docs sections", () => {
  it("list every page in reading order: sections, groups, sub-groups, then pages", () => {
    expect(slugsOf(sections)).toEqual([
      "",
      "guides/install",
      "guides/native",
      "guides/call-ios",
      "guides/present",
      "api",
      "api/core",
    ]);
    expect(docsSlugs).toEqual(slugsOf(docsSections));
  });

  it("start with the docs home", () => {
    expect(docsSlugs[0]).toBe("");
  });

  it("are tabs in the header, each opening its first page, with the blog last", () => {
    expect(headerLinks).toEqual([
      ...docsSections.map((s) => ({
        label: s.label,
        link: slugsOf([s])[0] ? `/docs/${slugsOf([s])[0]}/` : "/docs/",
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
  it("finds a page's section, the section's index, its group and its sub-group", () => {
    expect(locate("guides/native", sections)).toEqual({
      section: sections[0],
      sectionIndex: 0,
      group: sections[0]!.groups[1],
    });
    expect(locate("guides/present", sections)).toEqual({
      section: sections[0],
      sectionIndex: 0,
      group: sections[0]!.groups[1],
      subgroup: { label: "iOS", slugs: ["guides/call-ios", "guides/present"] },
    });
    expect(locate("api/core", sections)?.sectionIndex).toBe(1);
  });

  it("is undefined for a page the sidebar doesn't list", () => {
    expect(locate("guides/missing", sections)).toBeUndefined();
  });
});
