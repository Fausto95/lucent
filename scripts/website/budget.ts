import type { Block, DocKind, DocPage } from "../../apps/website/src/docs/types.ts";
import { where } from "./context.ts";
import { proseOf } from "./prose.ts";

/** Words of prose and lines of code a page may have (CONTRIBUTING-DOCS.md); reference pages have no budget. */
const budgets: Record<DocKind, { words: number; code: number } | undefined> = {
  start: { words: 400, code: 60 },
  guide: { words: 400, code: 60 },
  learn: { words: 800, code: 120 },
  other: { words: 800, code: 120 },
  // A whole module is the point of an example page.
  example: { words: 400, code: Infinity },
  reference: undefined,
};

const lines = (code: string): number => code.split("\n").length;

/** Lines of code a reader sees: every sample, but only one tab or panel of a set at a time. */
function codeLines(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.kind === "code") return sum + lines(b.code);
    if (b.kind === "tabs") return sum + Math.max(...b.tabs.map((t) => lines(t.code)));
    if (b.kind === "steps") return sum + b.steps.reduce((n, s) => n + codeLines(s.blocks), 0);
    if (b.kind === "panels") return sum + Math.max(...b.panels.map((p) => codeLines(p.blocks)));
    return sum;
  }, 0);
}

/** Words the reader reads: one panel of a set, links and markup counted as their text. */
function words(blocks: Block[]): number {
  const text = blocks
    .flatMap((b) => (b.kind === "panels" ? [] : proseOf([b])))
    .join(" ")
    .replace(/\]\([^)]*\)/g, "")
    .replace(/[`*#>|[\]-]/g, " ");
  const own = text.split(/\s+/).filter(Boolean).length;
  const panels = blocks.reduce((n, b) => n + (b.kind === "panels" ? Math.max(...b.panels.map((p) => words(p.blocks))) : 0), 0);
  return own + panels;
}

/** A page over its budget should be split. Legacy pages are exempt: they are being replaced. */
export function checkBudgets(pages: DocPage[]): string[] {
  return pages.flatMap((page) => {
    const budget = budgets[page.kind];
    if (!budget || page.legacy) return [];
    const w = words(page.blocks);
    const c = codeLines(page.blocks);
    const over = [
      ...(w > budget.words ? [`${w} words (budget ${budget.words})`] : []),
      ...(c > budget.code ? [`${c} lines of code (budget ${budget.code})`] : []),
    ];
    return over.length ? [`${where(page.slug)} has ${over.join(" and ")}: split it`] : [];
  });
}
