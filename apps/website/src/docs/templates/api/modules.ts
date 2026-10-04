import type { Block, DocFrontmatter, DocTemplate } from "../../types";
import type { Declaration } from "../../api";
import { apiModules } from "../../../generated/api";

/**
 * One page per lucent:* module, and one for the globals: each export's
 * signature, its doc comment (the editor shows the same on hover), its
 * examples and its members, generated from the declarations the compiler
 * serves. What each page says first is written here.
 */
interface ModulePage {
  module: string;
  slug: string;
  frontmatter: DocFrontmatter;
  intro: Block[];
}

const modulePages: ModulePage[] = [
  {
    module: "core",
    slug: "api/lucent-core",
    frontmatter: {
      title: "lucent:core",
      description:
        "Helpers every module can import: delays, errors with codes, UTF-8, a clock, promises over callback APIs, work on other threads, and native buffers.",
      kind: "reference",
    },
    intro: [
      {
        kind: "p",
        text: "Each helper has a native implementation, and a JavaScript one in `@lucent-lang/lucent/core` that tests run modules with ([Test a module](/docs/guides/test-a-module/)). This page documents both.",
      },
    ],
  },
  {
    module: "platform",
    slug: "api/lucent-platform",
    frontmatter: {
      title: "lucent:platform",
      description: "Which platform the code runs on, for platform branches.",
      kind: "reference",
    },
    intro: [],
  },
  {
    module: "thread",
    slug: "api/lucent-thread",
    frontmatter: {
      title: "lucent:thread",
      description: "Run code on the platform's main thread.",
      kind: "reference",
    },
    intro: [],
  },
  {
    module: "ios",
    slug: "api/lucent-ios",
    frontmatter: {
      title: "lucent:ios",
      description:
        "iOS helpers for platform code: version checks, Objective-C values, out parameters, app and scene events, presenting a view controller.",
      kind: "reference",
    },
    intro: [
      {
        kind: "p",
        text: "The iOS SDK itself is imported from `lucent:ios/<Framework>`, typed from the installed Xcode: see [Find an SDK class](/docs/guides/find-an-sdk-class/).",
      },
    ],
  },
  {
    module: "android",
    slug: "api/lucent-android",
    frontmatter: {
      title: "lucent:android",
      description:
        "Android helpers for platform code: the app's Context, version checks, the Activity in front, activity results, permissions and Activity events.",
      kind: "reference",
    },
    intro: [
      {
        kind: "p",
        text: "The Android SDK itself is imported from `lucent:android/<package>`, typed from the installed SDK and the app's Gradle libraries: see [Find an SDK class](/docs/guides/find-an-sdk-class/).",
      },
    ],
  },
  {
    module: "globals",
    slug: "api/globals",
    frontmatter: {
      title: "Globals",
      description:
        "What modules use without importing: `console`, `AbortController` and `AbortSignal`, beside the JavaScript built-ins.",
      kind: "reference",
    },
    intro: [
      {
        kind: "p",
        text: "The global variables `console`, `AbortController` and `AbortSignal` have these types. The JavaScript built-ins a module can use are on [Built-ins](/docs/reference/built-ins/).",
      },
    ],
  },
  {
    module: "ui",
    slug: "api/views/lucent-ui",
    frontmatter: {
      title: "lucent:ui",
      description: "The helpers a component's setup uses: signals, effects, commands, children.",
      kind: "reference",
    },
    intro: [],
  },
  {
    module: "compose",
    slug: "api/views/lucent-compose",
    frontmatter: {
      title: "lucent:compose",
      description:
        "Jetpack Compose for a component's content on Android: Lucent's own types, then Compose's API.",
      kind: "reference",
    },
    intro: [
      {
        kind: "p",
        text: "After these declarations, `lucent:compose` exports Compose's and Material 3's API under their own names, generated from the Compose release Lucent builds with. `lucent sdk show` prints any of them.",
      },
    ],
  },
];

/** An export: its signature, then its doc paragraphs, its examples and its members. */
function blocksOf(module: string, d: Declaration): Block[] {
  return [
    { kind: "h2", text: d.name },
    { kind: "code", filename: `${module}.d.ts`, code: d.signature },
    ...d.doc.map((text): Block => ({ kind: "p", text })),
    ...d.examples.map((code, i): Block => ({
      kind: "code",
      filename: `${d.name.charAt(0).toLowerCase()}${d.name.slice(1)}${i ? i + 1 : ""}.lucent.ts`,
      code,
    })),
    ...(d.members.some((m) => m.doc)
      ? [
          {
            kind: "table" as const,
            head: ["Member", "What it does"],
            rows: d.members.map((m) => [`\`${m.signature}\``, m.doc]),
          },
        ]
      : []),
  ];
}

export const pages: Record<string, DocTemplate> = Object.fromEntries(
  modulePages.map(({ module, slug, frontmatter, intro }) => {
    const api = apiModules[module];
    if (!api) throw new Error(`no declarations for ${module}`);
    const experimental: Block[] = api.experimental
      ? [
          {
            kind: "note",
            tone: "warn",
            text: "Experimental: this module resolves only when `LUCENT_VIEWS=fabric`, and changes without notice until Lucent's views are public.",
          },
        ]
      : [];
    return [
      slug,
      {
        frontmatter: api.experimental
          ? { ...frontmatter, views: true, sidebar: { badge: "Experimental" } }
          : frontmatter,
        blocks: [
          ...experimental,
          ...intro,
          ...api.declarations.flatMap((d) => blocksOf(module, d)),
        ],
      },
    ];
  }),
);
