import { describe, expect, it } from "vite-plus/test";
import {
  type DocSection,
  docsSections,
  docsSlugs,
  locate,
  sidebarsOf,
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

describe("sidebarsOf", () => {
  it("makes one Docusaurus sidebar per section, of collapsed categories", () => {
    expect(sidebarsOf(sections)).toEqual({
      guides: [
        {
          type: "category",
          label: "Get started",
          collapsed: true,
          items: ["index", "guides/install"],
        },
        {
          type: "category",
          label: "Native APIs",
          collapsed: true,
          items: [
            "guides/native",
            {
              type: "category",
              label: "iOS",
              collapsed: true,
              items: ["guides/call-ios", "guides/present"],
            },
          ],
        },
      ],
      api: [{ type: "category", label: "Modules", collapsed: true, items: ["api", "api/core"] }],
    });
  });

  it("names the docs home index, as Docusaurus does", () => {
    expect(JSON.stringify(sidebarsOf(sections))).not.toContain('""');
  });
});
