import type { Theme } from "./theme.ts";

/** Lines of a line diff: kept, removed, added. */
export type DiffLine = { kind: " " | "-" | "+"; text: string };

/** The shortest line diff (LCS); files init edits are small. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ kind: " ", text: a[i++]! }), j++;
    // Removals first, as diffs read.
    else if (i < a.length && (j >= b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push({ kind: "-", text: a[i++]! });
    else out.push({ kind: "+", text: b[j++]! });
  }
  return out;
}

/** A diff with two lines of context around each change, cut lines marked. */
export function renderDiff(before: string, after: string, theme: Theme): string {
  const lines = diffLines(before, after);
  const near = (k: number) => lines.slice(Math.max(0, k - 2), k + 3).some((l) => l.kind !== " ");
  const out: string[] = [];
  let skipped = false;
  lines.forEach((l, k) => {
    if (l.kind === " " && !near(k)) {
      if (!skipped) out.push(theme.dim(`    ${theme.symbols.ellipsis}`));
      skipped = true;
      return;
    }
    skipped = false;
    const text = `    ${l.kind} ${l.text}`;
    out.push(l.kind === "+" ? theme.success(text) : l.kind === "-" ? theme.error(text) : theme.dim(text));
  });
  return out.join("\n");
}
