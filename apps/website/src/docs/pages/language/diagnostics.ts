import { explanations } from "../../../generated/diagnostics";
import type { Block } from "../../types";

/** Example files as tabs; their names end in "(wrong)" or "(right)", so they are shown, not compiled again here. */
const tabs = (label: "wrong" | "right", files: Record<string, string>) =>
  Object.entries(files).map(([filename, code]) => ({ label: `${label === "wrong" ? "✗" : "✓"} ${filename}`, filename: `${filename} (${label})`, code: code.trimEnd() }));

export const blocks: Block[] = [
    {
      kind: "p",
      text: "Code outside the subset fails the build with a diagnostic that points at the source and says how to fix it. Nothing is written until every diagnostic is fixed. `lucent build`, `lucent check`, Metro and the [editor plugin](/docs/reference/core/) all report the same diagnostics, and `lucent explain <code>` prints the explanations on this page.",
    },
    {
      kind: "code",
      filename: "terminal",
      code: "src/geo.lucent.ts:2:3: LUCENT1001: use `let` or `const` instead of `var`\n\n✗ 1 problem(s); nothing was written.",
    },
    {
      kind: "p",
      text: "Codes are stable. The first digit groups them: `1xxx` for syntax and built-ins, `2xxx` for types without a native representation, `3xxx` for module structure, and `9001` for TypeScript errors, because Lucent compiles only programs that type-check.",
    },
    { kind: "h2", text: "All codes" },
    {
      kind: "table",
      head: ["Code", "Meaning"],
      rows: explanations.map(({ code, summary }) => [`[\`${code}\`](#${code.toLowerCase()})`, summary]),
    },
    ...explanations.flatMap(({ code, title, details, fix, wrong, right }): Block[] => [
      { kind: "h3", text: code },
      { kind: "p", text: `**${title}.** ${details}` },
      { kind: "p", text: `**Fix:** ${fix}.` },
      { kind: "tabs", tabs: [...tabs("wrong", wrong), ...tabs("right", right)] },
    ]),
];
