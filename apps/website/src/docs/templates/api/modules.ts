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
  /** A whole module using the module's main exports, compiled with the page: React Native's pages open with one too. */
  example?: { filename: string; code: string };
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
    example: {
      filename: "measure.lucent.ts",
      code: `import { delay, error, errorCode, now } from "lucent:core";

export async function measure(task: string, signal?: AbortSignal): Promise<number> {
  if (task.length === 0) throw error("E_EMPTY", "Name the task to measure.");
  const start = now();
  await delay(10, signal);
  return now() - start;
}

export function codeOf(e: Error): string {
  return errorCode(e) ?? "unknown";
}`,
    },
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
    example: {
      filename: "greeting.lucent.ts",
      code: `import { PLATFORM } from "lucent:platform";

export function greeting(): string {
  return PLATFORM === "ios" ? "Hello from iOS" : "Hello from Android";
}`,
    },
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
    example: {
      filename: "screen.lucent.ts",
      code: `import { PLATFORM } from "lucent:platform";
import { UIApplication } from "lucent:ios/UIKit";
import { main } from "lucent:thread";

export async function keepAwake(on: boolean): Promise<void> {
  if (PLATFORM === "ios") {
    await main(() => {
      UIApplication.shared.isIdleTimerDisabled = on;
    });
  }
}`,
    },
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
        text: "The iOS SDK itself is imported from `lucent:ios/<Framework>`, typed from the installed Xcode. [iOS SDK bindings](/docs/api/ios-sdk/) gives the rules, and [Find an SDK class](/docs/guides/find-an-sdk-class/) looks one up.",
      },
    ],
    example: {
      filename: "haptic.lucent.ts",
      code: `import { PLATFORM } from "lucent:platform";
import { UIImpactFeedbackGenerator, UIImpactFeedbackGenerator_FeedbackStyle as Style } from "lucent:ios/UIKit";
import { available } from "lucent:ios";
import { main } from "lucent:thread";

export async function tap(): Promise<void> {
  if (PLATFORM === "ios") {
    await main(() => {
      const style = available("ios", 13) ? Style.soft : Style.light;
      new UIImpactFeedbackGenerator(style).impactOccurred();
    });
  }
}`,
    },
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
        text: "The Android SDK itself is imported from `lucent:android/<package>`, typed from the installed SDK and the app's Gradle libraries. [Android SDK bindings](/docs/api/android-sdk/) gives the rules, and [Find an SDK class](/docs/guides/find-an-sdk-class/) looks one up.",
      },
    ],
    example: {
      filename: "vibrate.lucent.ts",
      code: `import { PLATFORM } from "lucent:platform";
import { Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";

export function vibrate(): void {
  if (PLATFORM === "android") {
    const context = appContext();
    const vibrator = available("android", 31)
      ? context.getSystemService(VibratorManager)?.defaultVibrator
      : context.getSystemService(Vibrator);
    vibrator?.vibrate(20n);
  }
}`,
    },
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
        text: "The global variables `console`, `AbortController` and `AbortSignal` have these types. The JavaScript built-ins a module can use are on [Built-ins](/docs/api/language/built-ins/).",
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
        text: "After these declarations, `lucent:compose` exports Compose's and Material 3's API under their own names, generated from the Compose release Lucent builds with. `lucent sdk show` prints any of them when `LUCENT_VIEWS=fabric` is set.",
      },
    ],
  },
];

const camel = (name: string) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`;

/** An export, as React Native's API pages show one: its signature, what it does, its parameters, examples and members. */
function blocksOf(module: string, d: Declaration): Block[] {
  return [
    { kind: "h3", text: d.kind === "function" ? `${d.name}()` : d.name },
    { kind: "code", filename: `${module}.d.ts`, code: d.signature },
    ...d.doc.map((text): Block => ({ kind: "p", text })),
    ...(d.params.length
      ? [
          {
            kind: "table" as const,
            head: ["Parameter", "Type", "Required", "Description"],
            rows: d.params.map((p) => [
              `\`${p.name}\``,
              `\`${p.type}\``,
              p.optional ? "no" : "yes",
              p.doc,
            ]),
          },
        ]
      : []),
    ...d.examples.map((code, i): Block => ({
      kind: "code",
      filename: `${camel(d.name)}${i ? i + 1 : ""}.lucent.ts`,
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

/** The reference's sections, in order, by the kinds of declaration each holds. */
const GROUPS: { title: string; kinds: Declaration["kind"][] }[] = [
  { title: "Functions", kinds: ["function"] },
  { title: "Constants", kinds: ["const"] },
  { title: "Classes", kinds: ["class"] },
  { title: "Types", kinds: ["interface", "type", "enum", "namespace"] },
];

export const pages: Record<string, DocTemplate> = Object.fromEntries(
  modulePages.map(({ module, slug, frontmatter, intro, example }) => {
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
          ? { ...frontmatter, views: true, sidebar_class_name: "experimental" }
          : frontmatter,
        blocks: [
          ...experimental,
          ...intro,
          ...(example
            ? [
                { kind: "h2" as const, text: "Example" },
                { kind: "code" as const, ...example },
              ]
            : []),
          ...GROUPS.flatMap(({ title, kinds }) => {
            const shown = api.declarations.filter((d) => kinds.includes(d.kind));
            return shown.length
              ? [{ kind: "h2" as const, text: title }, ...shown.flatMap((d) => blocksOf(module, d))]
              : [];
          }),
        ],
      },
    ];
  }),
);
