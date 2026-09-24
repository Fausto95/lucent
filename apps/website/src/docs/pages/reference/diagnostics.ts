import { explanations } from "../../../generated/diagnostics";
import type { Block } from "../../types";

/** Example files as tabs; their names end in "(wrong)" or "(right)", so they are shown, not compiled again here. */
const tabs = (label: "wrong" | "right", files: Record<string, string>) =>
  Object.entries(files).map(([filename, code]) => ({
    label: `${label === "wrong" ? "✗" : "✓"} ${filename}`,
    filename: `${filename} (${label})`,
    code: code.trimEnd(),
  }));

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
    text: "`lucent build`, `lucent check`, `lucent dev` and the [editor plugin](/docs/reference/metro-and-expo/#editor-plugin) report the same diagnostics. A build with one writes nothing. `lucent explain <code>` prints the explanation this page shows.",
  },
  {
    kind: "p",
    text: "Codes are stable. `1xxx` are syntax and built-ins, `2xxx` types without a native form, `3xxx` modules and platform code. `9001` is a TypeScript error: Lucent compiles only programs that type-check.",
  },
  {
    kind: "table",
    head: ["Code", "Meaning"],
    rows: explanations.map(({ code, summary }) => [
      `[\`${code}\`](#${code.toLowerCase()})`,
      summary,
    ]),
  },
  ...explanations.flatMap(({ code, title, details, fix, wrong, right }): Block[] => [
    { kind: "h2", text: code },
    { kind: "p", text: `**${title}**` },
    { kind: "p", text: details },
    { kind: "p", text: `**Fix:** ${fix}.` },
    { kind: "tabs", tabs: [...tabs("wrong", wrong), ...tabs("right", right)] },
  ]),
];
