import { explanations } from "../../../generated/diagnostics";
import type { Block, DocFrontmatter } from "../../types";

/** Example files as tabs; their names end in "(wrong)" or "(right)", so they are shown, not compiled again here. */
const tabs = (label: "wrong" | "right", files: Record<string, string>) =>
  Object.entries(files).map(([filename, code]) => ({
    label: `${label === "wrong" ? "✗" : "✓"} ${filename}`,
    filename: `${filename} (${label})`,
    code: code.trimEnd(),
  }));

type Explanation = (typeof explanations)[number];

/** The codes by family: the first digit says what they are about; views' codes are experimental. */
const family = (digit: string, title: string) => ({
  title,
  codes: explanations.filter((e: Explanation) => e.code[6] === digit && !e.views),
});
const families = [
  family("1", "Syntax and built-ins (1xxx)"),
  family("2", "Types and the boundary (2xxx)"),
  family("3", "Modules, platform code and threads (3xxx)"),
  { title: "Views, experimental (3xxx)", codes: explanations.filter((e) => e.views) },
  family("9", "TypeScript (9xxx)"),
];

export const frontmatter: DocFrontmatter = {
  title: "Diagnostics",
  description: "Every `LUCENT` code, with its reason, its fix, and a wrong and a right example.",
  kind: "reference",
};

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "terminal",
    copy: false,
    code: `  error LUCENT2001  \`any\` has no native representation; give this value a
                    concrete type

    src/greet.lucent.ts:1:23
    1 │ export function greet(name: any): string {
      │                       ^^^^^^^^^

  fix  use a concrete type, a union, or a generic parameter
  docs lucent explain LUCENT2001`,
  },
  {
    kind: "p",
    text: "`lucent build`, `lucent check`, `lucent dev` and the [editor plugin](/docs/api/integrations/#editor-plugin) report the same diagnostics. A build with one writes nothing. `lucent explain <code>` prints the explanation this page shows.",
  },
  {
    kind: "p",
    text: "Codes are stable, and grouped by what they are about. A warning still compiles; every other diagnostic stops the build.",
  },
  {
    kind: "table",
    head: ["Code", "Meaning"],
    rows: explanations.map(({ code, summary, warning }) => [
      `[\`${code}\`](#${code.toLowerCase()})${warning ? " (warning)" : ""}`,
      summary,
    ]),
  },
  ...families.flatMap(({ title, codes }): Block[] =>
    codes.length
      ? [
          { kind: "h2", text: title },
          ...codes.flatMap(({ code, title, details, fix, wrong, right, warning }): Block[] => [
            { kind: "h3", text: code },
            { kind: "p", text: `**${title}**${warning ? " (a warning)" : ""}` },
            { kind: "p", text: details },
            { kind: "p", text: `**Fix:** ${fix}.` },
            { kind: "tabs", tabs: [...tabs("wrong", wrong), ...tabs("right", right)] },
          ]),
        ]
      : [],
  ),
];
