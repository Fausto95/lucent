import { diagnostic, type Diagnostic } from "../diagnostics/index.ts";
import type { TypedFunction } from "./typed.ts";
/** Conservative, transitive effect analysis. Explicit worker hops end main-thread propagation. */
export function threadSafety(functions: TypedFunction[]): Diagnostic[] {
  const byName = new Map(functions.map((f) => [f.name, f]));
  const expensive = (fn: TypedFunction, seen: Set<string>): boolean => {
    if (fn.thread === "worker") return false;
    if (fn.binding?.cost) return true;
    if (seen.has(fn.name)) return true; // recursion may be unbounded
    const next = new Set(seen).add(fn.name);
    const visit = (node: unknown): boolean => {
      if (!node || typeof node !== "object") return false;
      if (Array.isArray(node)) return node.some(visit);
      const n = node as Record<string, unknown>;
      if (["while", "for", "forOf"].includes(String(n.kind))) return true;
      if (
        (n.kind === "call" && typeof n.callee === "string") ||
        (n.kind === "functionRef" && typeof n.name === "string")
      ) {
        const callee = byName.get((n.callee ?? n.name) as string);
        if (callee && expensive(callee, next)) return true;
      }
      return Object.entries(n).some(([key, value]) => key !== "type" && key !== "span" && visit(value));
    };
    return visit(fn.body);
  };
  return functions
    .filter((f) => f.thread === "main" && expensive(f, new Set()))
    .map((f) =>
      Object.assign(
        diagnostic(
          "LC3002",
          f.span,
          `Potentially expensive operation executed on MainThread in ${f.name}.`,
          "Move loops, recursive helpers, or CPU-intensive work into an @Background async function.",
        ),
        { severity: "warning" as const },
      ),
    );
}
