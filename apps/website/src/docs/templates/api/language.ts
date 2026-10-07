/**
 * API › Language: what TypeScript a module may use. The tables come from
 * src/docs/language.ts, which scripts/website/language.ts checks against the
 * compiler (each refusal's code, each case), and the diagnostics' titles
 * from packages/compiler/src/codes.ts.
 */
import type { Block, DocFrontmatter } from "../../types";
import { features, leftOut, type Refusal } from "../../language";
import { explanations } from "../../../generated/diagnostics";

export const frontmatter: DocFrontmatter = {
  title: "What TypeScript does Lucent accept?",
  sidebar_label: "Language",
  description:
    "A subset of strict TypeScript whose code behaves as it does in JavaScript, or fails to compile with a `LUCENT` diagnostic.",
  kind: "reference",
};

const title = (code: string): string =>
  explanations.find((e: { code: string }) => e.code === code)?.title ?? code;

/** The codes a row's refusals fail with, each linked to its explanation. */
export const failsWith = (refused: Refusal[] = []): string =>
  [...new Set(refused.map((r) => r.code))]
    .map((code) => `[${code}](/docs/api/diagnostics/#${code.toLowerCase()}): ${title(code)}`)
    .join("; ") || "None";

const intro: Block[] = [
  {
    kind: "p",
    text: "A module is a `*.lucent.ts` file. Lucent compiles it ahead of time to C++, so every value needs a type that is known when the app builds. These pages give the exact rules of the TypeScript a module can use.",
  },
  {
    kind: "h2",
    text: "Example",
  },
  {
    kind: "tabs",
    tabs: [
      {
        label: "module",
        filename: "tally.lucent.ts",
        code: "export type Tally = { word: string; count: number };\n\nexport class Counter {\n  private counts = new Map<string, number>();\n\n  add(text: string): void {\n    for (const word of text.toLowerCase().split(/\\W+/)) {\n      if (word) this.counts.set(word, (this.counts.get(word) ?? 0) + 1);\n    }\n  }\n\n  top(n: number): Tally[] {\n    return [...this.counts]\n      .map(([word, count]) => ({ word, count }))\n      .sort((a, b) => b.count - a.count)\n      .slice(0, n);\n  }\n}",
      },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: 'import { Counter } from "./tally.lucent";\n\nconst counter = new Counter();\ncounter.add("the cat and the hat");\ncounter.top(1); // [{ word: "the", count: 2 }]',
      },
    ],
  },
  {
    kind: "p",
    text: "The module is ordinary TypeScript: a class, a `Map`, a regular expression, destructuring and spread. Each of its values has a native type, so it compiles to C++ and runs without a JavaScript engine.",
  },
  {
    kind: "h2",
    text: "The contract",
  },
  {
    kind: "list",
    items: [
      "Code that type-checks and stays inside the subset behaves as the same code does in JavaScript, except for the cases in [Differences](/docs/api/language/differences/).",
      "Code outside the subset fails to compile with a `LUCENT` diagnostic that points at the source, never with invalid C++. [Diagnostics](/docs/api/diagnostics/) lists every code.",
      "Where Lucent can't match JavaScript, it throws or refuses the code. The [known gaps](/docs/api/language/differences/#known-gaps) are the few exceptions that compile and differ, each tested around by an e2e case.",
    ],
  },
  {
    kind: "p",
    text: "End-to-end cases test the supported behavior: each module runs as native code and as JavaScript, and the two outputs must match line for line. Where a rule has a case, these pages name it, from [packages/compiler/test/e2e/cases](https://github.com/Fausto95/lucent/tree/main/packages/compiler/test/e2e/cases).",
  },
  {
    kind: "h2",
    text: "How modules are type-checked",
  },
  {
    kind: "p",
    text: "Lucent compiles only code that type-checks: a TypeScript error is [LUCENT9001](/docs/api/diagnostics/#lucent9001). It checks with its own settings, whatever the app's `tsconfig.json` says:",
  },
  {
    kind: "table",
    head: ["Setting", "Value"],
    rows: [
      ["`strict`", "On."],
      [
        "`noUncheckedIndexedAccess`",
        "On: reading an array element or a record entry gives `T | undefined`.",
      ],
      ["`target`", "`ES2022`."],
      ["`lib`", "`es2022` and `esnext.disposable`: no ES2023 methods and no DOM."],
      [
        "TypeScript",
        "The version `@lucent-lang/lucent` brings, in [Compatibility](/docs/api/compatibility/).",
      ],
    ],
  },
  {
    kind: "p",
    text: "Your editor and `tsc` read the app's `tsconfig.json` instead. `lucent init` turns on `noUncheckedIndexedAccess` there, so both agree. A `using` declaration needs one more `lib` entry, given in [using declarations](/docs/api/language/statements/#using-declarations).",
  },
];

export const blocks: Block[] = [
  ...intro,
  { kind: "h2", text: "Why a subset" },
  {
    kind: "p",
    text: "No JavaScript engine runs in native code. Lucent gives each value a native layout, fixed at build time. A feature that decides a layout at run time has no native form.",
  },
  {
    kind: "table",
    head: ["Left out", "Why", "Write instead", "Fails with"],
    rows: leftOut.map((r) => [r.feature, r.why, r.instead, failsWith(r.refused)]),
  },
  { kind: "h2", text: "At a glance" },
  {
    kind: "table",
    head: ["Feature", "In Lucent", "Rules"],
    rows: features.map((f) => [f.feature, f.status, `[${f.page.title}](${f.page.href})`]),
  },
];
