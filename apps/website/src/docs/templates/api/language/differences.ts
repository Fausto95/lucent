/**
 * API › Language › Differences: where Lucent deliberately differs from
 * JavaScript, and the known gaps. The rows come from src/docs/language.ts,
 * which scripts/website/language.ts checks: each case exists, each
 * refusal fails with its code, and each known gap names a case.
 */
import type { Block, DocFrontmatter } from "../../../types";
import { differences, knownGaps, type Difference } from "../../../language";

export const frontmatter: DocFrontmatter = {
  title: "Where does Lucent differ from JavaScript?",
  sidebar_label: "Differences from JavaScript",
  description:
    "Code that type-checks and uses the supported subset behaves as in JavaScript, except in the cases listed here, each with its reason.",
  kind: "reference",
};

const head = ["JavaScript", "Lucent", "Why", "e2e case"];
const row = (d: Difference): string[] => [
  d.js,
  d.lucent,
  d.why,
  d.cases.length ? d.cases.map((c) => `\`${c}\``).join(", ") : "None",
];

export const blocks: Block[] = [
  {
    kind: "p",
    text: "A module that type-checks, and uses only what the Language pages list, behaves as the same code does in JavaScript. Each difference in the sections below is deliberate, and its row says why. The [known gaps](/docs/api/language/differences/#known-gaps) at the end aren't: Lucent should refuse that code or match JavaScript.",
  },
  {
    kind: "p",
    text: "Each e2e case is a module in `packages/compiler/test/e2e/cases/`, run natively and as JavaScript, whose outputs must match. A case therefore tests the behavior around a difference, never the difference itself.",
  },
  ...differences.flatMap((s): Block[] => [
    { kind: "h2", text: s.title },
    { kind: "table", head, rows: s.rows.map(row) },
  ]),
  { kind: "h2", text: "Known gaps" },
  {
    kind: "p",
    text: "This code compiles, but doesn't do what JavaScript does. Lucent should refuse it or match JavaScript; until it does, avoid it ([roadmap](/docs/releases/roadmap/#known-limitations)). Each gap names the e2e cases that test the code around it.",
  },
  { kind: "table", head, rows: knownGaps.map(row) },
];
