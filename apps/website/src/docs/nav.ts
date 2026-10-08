/**
 * The docs' sections, their sidebar groups and pages, in reading order. A
 * section is a tab in the navbar with its own Docusaurus sidebar
 * (sidebarsOf, docusaurus.config.ts), so Previous and Next never leave it.
 * A group holds pages and sub-groups, and a sub-group holds pages only. A
 * page's slug is its path under /docs/ ("" is the index), and its file is
 * src/content/docs/docs/<slug>.mdx (index.mdx for "").
 */
export interface DocSubgroup {
  label: string;
  slugs: string[];
}

export interface DocGroup {
  label: string;
  /** Pages, by slug, and sub-groups, in reading order. */
  items: (string | DocSubgroup)[];
}

export interface DocSection {
  label: string;
  /** Every page of the section lives under this directory, except the docs home "". */
  dir: "guides" | "packages" | "api" | "architecture" | "releases";
  groups: DocGroup[];
}

export const docsSections: DocSection[] = [
  {
    label: "Guides",
    dir: "guides",
    groups: [
      {
        label: "The Basics",
        items: [
          "",
          "guides/create-a-project",
          "guides/install",
          "guides/first-module",
          "guides/platform-code",
        ],
      },
      {
        label: "Workflow",
        items: [
          "guides/apply-a-change",
          "guides/iterate-in-javascript",
          "guides/use-a-lucent-package",
          "guides/use-a-third-party-sdk",
          "guides/upgrade-lucent",
          "guides/pin-sdks",
          "guides/type-ios-code-without-xcode",
          "guides/build-in-ci-and-eas",
          "guides/remove-lucent",
        ],
      },
      {
        label: "Modules and JavaScript",
        items: [
          "guides/share-data-with-javascript",
          "guides/throw-and-handle-errors",
          "guides/accept-a-js-callback",
          "guides/send-events-to-javascript",
          "guides/share-code-between-platforms",
        ],
      },
      {
        label: "Threads and resources",
        items: [
          "guides/run-work-off-the-js-thread",
          "guides/cancel-work",
          "guides/run-in-parallel",
          "guides/pass-large-buffers",
          "guides/release-native-resources",
        ],
      },
      {
        label: "Native APIs",
        items: [
          "guides/call-an-ios-api",
          "guides/call-an-android-api",
          "guides/find-an-sdk-class",
          "guides/check-the-os-version",
          "guides/run-on-the-main-thread",
          "guides/await-a-callback-api",
          "guides/implement-a-delegate",
          "guides/subclass-an-sdk-class",
          {
            label: "Swift and Kotlin",
            slugs: [
              "guides/call-a-swift-only-api",
              "guides/implement-a-swift-protocol",
              "guides/call-a-kotlin-library",
              "guides/collect-a-kotlin-flow",
            ],
          },
          {
            label: "Screens, permissions and lifecycle",
            slugs: [
              "guides/present-a-view-controller",
              "guides/start-an-activity",
              "guides/ask-for-a-permission",
              "guides/add-permissions-and-config",
              "guides/respond-to-app-lifecycle",
            ],
          },
        ],
      },
      {
        label: "Views (experimental)",
        items: [
          "guides/views",
          "guides/views/platform-views",
          "guides/views/swiftui-and-compose",
          "guides/views/state-and-events",
          "guides/views/commands",
          "guides/views/children",
        ],
      },
      {
        label: "Debugging",
        items: [
          "guides/fix-a-compile-error",
          "guides/read-errors-and-logs",
          "guides/symbolicate-a-native-crash",
          "guides/troubleshooting",
          "guides/faq",
        ],
      },
      { label: "Testing", items: ["guides/test-a-module"] },
      { label: "Performance", items: ["guides/measure-performance", "guides/trace-a-slow-call"] },
      {
        label: "Coming from other tools",
        items: [
          "guides/comparison",
          "guides/coming-from-swift-or-kotlin",
          "guides/port-an-expo-module",
          "guides/port-a-turbomodule",
        ],
      },
      {
        label: "Example ports",
        items: [
          "guides/examples/clipboard",
          "guides/examples/location",
          "guides/examples/netinfo",
          "guides/examples/local-authentication",
        ],
      },
    ],
  },
  {
    label: "Packages",
    dir: "packages",
    groups: [
      {
        label: "Lucent packages",
        items: [
          "packages",
          "packages/create-a-package",
          "packages/develop-a-package-locally",
          "packages/publish-a-package",
        ],
      },
      {
        label: "Native needs",
        items: [
          "packages/add-native-dependencies",
          "packages/declare-permissions-and-entitlements",
          "packages/declare-android-components",
        ],
      },
      {
        label: "Native code",
        items: [
          "packages/ship-a-prebuilt-library",
          "packages/ship-native-sources",
          "packages/wrap-a-c-library",
        ],
      },
      {
        label: "Reference",
        items: ["packages/package-json", "packages/lucent-json", "packages/native-extensions"],
      },
      {
        label: "Example packages",
        items: [
          "packages/examples/haptics",
          "packages/examples/secure-store",
          "packages/examples/orbit",
        ],
      },
    ],
  },
  {
    label: "API",
    dir: "api",
    groups: [
      { label: "API reference", items: ["api"] },
      {
        label: "Modules",
        items: [
          "api/lucent-core",
          "api/lucent-platform",
          "api/lucent-thread",
          "api/globals",
          { label: "iOS", slugs: ["api/lucent-ios", "api/ios-sdk"] },
          { label: "Android", slugs: ["api/lucent-android", "api/android-sdk"] },
        ],
      },
      {
        label: "Language",
        items: [
          "api/language",
          "api/language/modules",
          "api/language/platform-code",
          "api/language/types",
          "api/language/statements",
          "api/language/built-ins",
          "api/language/boundary",
          "api/language/concurrency",
          "api/language/memory",
          "api/language/differences",
        ],
      },
      {
        label: "Tools",
        items: [
          "api/cli",
          "api/json-formats",
          "api/integrations",
          "api/environment-variables",
          "api/lucent-directory",
        ],
      },
      {
        label: "Errors and versions",
        items: ["api/diagnostics", "api/runtime-errors", "api/trace-events", "api/compatibility"],
      },
      {
        label: "Views (experimental)",
        items: [
          "api/views/lucent-ui",
          "api/views/lucent-compose",
          "api/views/components",
          "api/views/swiftui-and-compose",
          "api/views/platform-views",
        ],
      },
    ],
  },
  {
    label: "Architecture",
    dir: "architecture",
    groups: [
      {
        label: "How Lucent works",
        items: [
          "architecture",
          "architecture/boundary",
          "architecture/threads",
          "architecture/memory",
          "architecture/sdk-bindings",
          "architecture/builds",
          "architecture/packages",
          "architecture/views",
          "architecture/api-design",
          "architecture/glossary",
        ],
      },
      {
        label: "Internals (for contributors)",
        items: [
          "architecture/internals",
          "architecture/internals/compiler",
          "architecture/internals/views",
          "architecture/internals/runtime",
          "architecture/internals/react-native",
          "architecture/internals/bindings",
          "architecture/internals/tooling",
        ],
      },
    ],
  },
  {
    label: "Releases",
    dir: "releases",
    groups: [{ label: "Releases", items: ["releases/roadmap", "releases/changelog"] }],
  },
];

/** Architecture's contributor pages: only these are kind "internals", and .vale.ini lets them name the compiler's parts. */
export const INTERNALS = "architecture/internals";

/** The pages of some sections, by slug, in reading order. */
export const slugsOf = (sections: DocSection[]): string[] =>
  sections.flatMap((s) =>
    s.groups.flatMap((g) => g.items.flatMap((i) => (typeof i === "string" ? [i] : i.slugs))),
  );

/** Every docs page's slug, in reading order. */
export const docsSlugs: string[] = slugsOf(docsSections);

/** Where a page is listed: its section, the section's place, its group and sub-group. */
export interface Location {
  section: DocSection;
  sectionIndex: number;
  group: DocGroup;
  subgroup?: DocSubgroup;
}

/** The section, group and sub-group that list a page; undefined when none does. */
export function locate(slug: string, sections: DocSection[] = docsSections): Location | undefined {
  for (const [sectionIndex, section] of sections.entries())
    for (const group of section.groups)
      for (const item of group.items) {
        if (item === slug) return { section, sectionIndex, group };
        if (typeof item !== "string" && item.slugs.includes(slug))
          return { section, sectionIndex, group, subgroup: item };
      }
  return undefined;
}

/** A sidebar category, as Docusaurus reads it: doc ids and nested categories. */
export interface SidebarCategory {
  type: "category";
  label: string;
  collapsed: true;
  items: (string | SidebarCategory)[];
}

/** A page's Docusaurus doc id: its slug, and "index" for the docs home. */
export const docId = (slug: string): string => slug || "index";

/**
 * One Docusaurus sidebar per section, by its directory: groups and sub-groups
 * as categories, collapsed until they hold the current page (as React
 * Native's docs show theirs).
 */
export function sidebarsOf(
  sections: DocSection[] = docsSections,
): Record<string, SidebarCategory[]> {
  const category = (label: string, items: (string | SidebarCategory)[]): SidebarCategory => ({
    type: "category",
    label,
    collapsed: true,
    items,
  });
  return Object.fromEntries(
    sections.map((s) => [
      s.dir,
      s.groups.map((g) =>
        category(
          g.label,
          g.items.map((i) =>
            typeof i === "string" ? docId(i) : category(i.label, i.slugs.map(docId)),
          ),
        ),
      ),
    ]),
  );
}
