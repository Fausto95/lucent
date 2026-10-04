/**
 * The docs sidebar: groups of pages, in reading order. A page's slug is its
 * path under /docs/ ("" is the index), and its file is
 * src/content/docs/docs/<slug>.mdx (index.mdx for ""). Each page's "Next"
 * link is the following page here, unless its frontmatter sets `next`.
 */
export interface DocGroup {
  label: string;
  slugs: string[];
}

export const docsGroups: DocGroup[] = [
  {
    label: "Start",
    slugs: ["", "install", "first-module"],
  },
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
    label: "Reference",
    slugs: [
      "reference/language",
      "reference/built-ins",
      "reference/boundary-types",
      "reference/platform-types",
      "reference/modules",
      "reference/cli",
      "reference/lucent-json",
      "reference/metro-and-expo",
      "reference/diagnostics",
      "reference/compatibility",
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
  {
    label: "More",
    slugs: ["comparison", "faq", "roadmap"],
  },
];

/** Every docs page's slug, in reading order. */
export const docsSlugs: string[] = docsGroups.flatMap((g) => g.slugs);
