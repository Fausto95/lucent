/**
 * The docs' sections, their sidebar groups and pages, in reading order. A
 * section is a tab in the header with its own sidebar; Previous and Next
 * never leave it (sections.ts). A page's slug is its path under /docs/ (""
 * is the index), and its file is src/content/docs/docs/<slug>.mdx
 * (index.mdx for ""). Keep it two levels deep, section > group > page: the
 * theme's mobile drawer shows only a group's direct links.
 */
import { docsHref } from "./types.ts";

export interface DocGroup {
  label: string;
  slugs: string[];
}

export interface DocSection {
  label: string;
  /** Every page of the section lives under this directory, except the docs home "". */
  dir: "guides" | "packages" | "api" | "architecture";
  groups: DocGroup[];
}

export const docsSections: DocSection[] = [
  {
    label: "Guides",
    dir: "guides",
    groups: [
      { label: "Start", slugs: ["", "install", "first-module"] },
      {
        label: "Guides",
        slugs: [
          "guides/call-an-ios-api",
          "guides/call-an-android-api",
          "guides/find-an-sdk-class",
          "guides/implement-a-delegate",
          "guides/send-events-to-javascript",
          "guides/accept-a-js-callback",
          "guides/run-work-off-the-js-thread",
          "guides/cancel-work",
          "guides/run-on-the-main-thread",
          "guides/present-a-view-controller",
          "guides/throw-and-handle-errors",
          "guides/check-the-os-version",
          "guides/share-code-between-platforms",
          "guides/add-permissions-and-config",
          "guides/use-a-third-party-sdk",
          "guides/use-a-library",
          "guides/port-an-expo-module",
          "guides/port-a-turbomodule",
          "guides/test-a-module",
          "guides/debug-a-crash",
          "guides/measure-performance",
          "guides/upgrade",
        ],
      },
      {
        label: "Examples",
        slugs: [
          "examples",
          "examples/clipboard",
          "examples/location",
          "examples/netinfo",
          "examples/local-authentication",
          "examples/secure-store",
          "examples/haptics",
        ],
      },
    ],
  },
  {
    label: "Packages",
    dir: "packages",
    groups: [{ label: "Package reference", slugs: ["reference/lucent-json"] }],
  },
  {
    label: "API",
    dir: "api",
    groups: [
      {
        label: "Modules and globals",
        slugs: [
          "api/lucent-core",
          "api/lucent-platform",
          "api/lucent-thread",
          "api/lucent-ios",
          "api/lucent-android",
          "api/globals",
        ],
      },
      {
        label: "Reference",
        slugs: [
          "reference/language",
          "reference/built-ins",
          "reference/boundary-types",
          "reference/platform-types",
          "reference/cli",
          "api/json-formats",
          "reference/metro-and-expo",
          "reference/diagnostics",
          "reference/compatibility",
        ],
      },
      {
        label: "Views reference",
        slugs: ["api/views/lucent-ui", "api/views/lucent-compose"],
      },
    ],
  },
  {
    label: "Architecture",
    dir: "architecture",
    groups: [
      {
        label: "How Lucent works",
        slugs: ["how-it-works", "how-it-works/calls", "how-it-works/platform-calls"],
      },
      {
        label: "Thinking in Lucent",
        slugs: [
          "thinking/three-places",
          "thinking/boundary-first",
          "thinking/shared-first",
          "thinking/threads",
          "thinking/memory",
          "thinking/typescript",
          "coming-from-native",
        ],
      },
      { label: "More", slugs: ["comparison", "faq", "roadmap"] },
    ],
  },
];

/** Architecture's contributor pages: only these are kind "internals", and .vale.ini lets them name the compiler's parts. */
export const INTERNALS = "architecture/internals";

/** Every docs page's slug, in reading order. */
export const docsSlugs: string[] = docsSections.flatMap((s) => s.groups.flatMap((g) => g.slugs));

/** A Starlight route id's docs slug; undefined outside the docs (a blog post, the 404 page). */
export const slugOfId = (id: string): string | undefined =>
  id === "docs" ? "" : id.startsWith("docs/") ? id.slice("docs/".length) : undefined;

/** The section and group that list a page; undefined when none does. */
export function locate(
  slug: string,
  sections: DocSection[] = docsSections,
): { section: DocSection; sectionIndex: number; group: DocGroup } | undefined {
  for (const [sectionIndex, section] of sections.entries())
    for (const group of section.groups)
      if (group.slugs.includes(slug)) return { section, sectionIndex, group };
  return undefined;
}

/** The header's tabs, also the mobile drawer's links: each section's first page, then the blog. */
export const headerLinks: { label: string; link: string }[] = [
  ...docsSections.map((s) => ({ label: s.label, link: docsHref(s.groups[0]!.slugs[0]!) })),
  { label: "Blog", link: "/blog/" },
];
