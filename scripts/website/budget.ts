import { type Block, DOC_KINDS } from "../../apps/website/src/docs/types.ts";
import type { CheckedPage } from "./pages.ts";
import { proseOf } from "./prose.ts";

/** Words of prose and lines of code a page may have (CONTRIBUTING-DOCS.md); undefined is unbounded. */
const budgets: Record<CheckedPage["kind"], { words: number; code: number } | undefined> = {
  ...DOC_KINDS,
  // A post is dated and read once, not kept up to date: it says what it needs to.
  post: undefined,
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
  const panels = blocks.reduce(
    (n, b) => n + (b.kind === "panels" ? Math.max(...b.panels.map((p) => words(p.blocks))) : 0),
    0,
  );
  return own + panels;
}

/** A page over its budget should be split. */
export function checkBudgets(pages: CheckedPage[]): string[] {
  return pages.flatMap((page) => {
    const budget = budgets[page.kind];
    if (!budget) return [];
    const w = words(page.blocks);
    const c = codeLines(page.blocks);
    const over = [
      ...(w > budget.words ? [`${w} words (budget ${budget.words})`] : []),
      ...(c > budget.code ? [`${c} lines of code (budget ${budget.code})`] : []),
    ];
    return over.length ? [`${page.href} has ${over.join(" and ")}: split it`] : [];
  });
}
