import type { StarlightRouteData } from "@astrojs/starlight/route-data";
import { describe, expect, it } from "vite-plus/test";
import type { DocSection } from "../src/docs/nav.ts";
import { sectionRoute } from "../src/docs/sections.ts";

type Entry = StarlightRouteData["sidebar"][number];

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

const href = (slug: string) => (slug ? `/docs/${slug}/` : "/docs/");

const link = (slug: string, current: string): Extract<Entry, { type: "link" }> => ({
  type: "link",
  label: slug || "home",
  href: href(slug),
  isCurrent: slug === current,
  badge: undefined,
  attrs: {},
});

/** Starlight's sidebar for the page at `current`: every section, as nested groups. */
function sidebar(current: string): Entry[] {
  return sections.map((s) => ({
    type: "group",
    label: s.label,
    collapsed: false,
    badge: undefined,
    entries: s.groups.map((g) => ({
      type: "group",
      label: g.label,
      collapsed: false,
      badge: undefined,
      entries: g.slugs.map((slug) => link(slug, current)),
    })),
  }));
}

/** A route as Starlight computes it: pagination over the whole sidebar, crossing sections. */
function route(current: string, data: { prev?: unknown; next?: unknown } = {}) {
  const all = sections.flatMap((s) => s.groups.flatMap((g) => g.slugs));
  const at = all.indexOf(current);
  return {
    id: current ? `docs/${current}` : "docs",
    sidebar: sidebar(current),
    pagination: {
      prev: at > 0 ? link(all[at - 1]!, current) : undefined,
      next: at < all.length - 1 ? link(all[at + 1]!, current) : undefined,
    },
    entry: { data },
  };
}

describe("sectionRoute", () => {
  it("keeps only the groups of the page's section", () => {
    const { sidebar } = sectionRoute(route("guides/install"), sections);

    expect(sidebar?.map((g) => g.label)).toEqual(["Get started", "Errors"]);
  });

  it("links Previous and Next to the neighbours inside the section", () => {
    const { pagination } = sectionRoute(route("guides/install"), sections);

    expect(pagination?.prev?.href).toBe("/docs/");
    expect(pagination?.next?.href).toBe("/docs/guides/throw/");
  });

  it("gives a section's last page no Next, and its first page no Previous", () => {
    expect(sectionRoute(route("guides/throw"), sections).pagination?.next).toBeUndefined();
    expect(sectionRoute(route("api"), sections).pagination?.prev).toBeUndefined();
  });

  it("keeps the link a page's frontmatter sets", () => {
    const set = route("guides/throw", { next: { link: "/docs/", label: "home" } });
    set.pagination.next = link("", "guides/throw");

    expect(sectionRoute(set, sections).pagination?.next?.href).toBe("/docs/");
  });

  it("leaves pages outside the docs alone", () => {
    expect(sectionRoute({ ...route("api"), id: "blog/native-views" }, sections)).toEqual({});
    expect(sectionRoute({ ...route("api"), id: "404" }, sections)).toEqual({});
  });

  it("fails on a docs page the sidebar doesn't list", () => {
    expect(() => sectionRoute({ ...route("api"), id: "docs/api/missing" }, sections)).toThrow(
      "/docs/api/missing/ is not in the sidebar",
    );
  });

  it("fails when Starlight's sidebar doesn't match the sections", () => {
    const shuffled = route("api");
    shuffled.sidebar.reverse();

    expect(() => sectionRoute(shuffled, sections)).toThrow("API");
  });
});
