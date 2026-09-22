import { supportsNativeVersion, type NativeTargets } from "../native-contracts.ts";
import { diagnostic, type Diagnostic } from "../diagnostics/index.ts";
import type { NativePlatform } from "../libraries.ts";
import type { TExpr, TypedFunction } from "./typed.ts";

/** Analyze each reachable call under the platform set of its calling branch. */
export function platformSafety(functions: TypedFunction[], targets: NativeTargets = {}): Diagnostic[] {
  const byName = new Map(functions.map((f) => [f.name, f]));
  const diagnostics: Diagnostic[] = [];
  const visited = new Set<string>();
  const reported = new Set<string>();
  const narrow = (test: TExpr, platforms: NativePlatform[], truth: boolean): NativePlatform[] => {
    if (test.kind === "unary" && test.operator === "!") return narrow(test.argument, platforms, !truth);
    if (test.kind !== "binary" || !["===", "!=="].includes(test.operator)) return platforms;
    const pairs = [
      [test.left, test.right],
      [test.right, test.left],
    ] as const;
    for (const [query, value] of pairs) {
      if (
        query.kind === "call" &&
        byName.get(query.callee)?.binding?.platformQuery &&
        value.kind === "string" &&
        ["ios", "android"].includes(value.value)
      ) {
        const equal = test.operator === "===" ? truth : !truth;
        return platforms.filter((p) => (equal ? p === value.value : p !== value.value));
      }
    }
    return platforms;
  };
  const visitFunction = (fn: TypedFunction, platforms: NativePlatform[]): void => {
    const key = fn.name + ":" + platforms.join(",");
    if (visited.has(key) || !platforms.length) return;
    visited.add(key);
    visit(fn.body, platforms);
  };
  const visit = (value: unknown, platforms: NativePlatform[]): void => {
    if (!platforms.length || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, platforms);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.kind === "if") {
      visit(node.test, platforms);
      visit(node.consequent, narrow(node.test as TExpr, platforms, true));
      visit(node.alternate, narrow(node.test as TExpr, platforms, false));
      return;
    }
    if (node.kind === "logical") {
      visit(node.left, platforms);
      visit(node.right, narrow(node.left as TExpr, platforms, node.operator === "&&"));
      return;
    }
    if (
      (node.kind === "call" && typeof node.callee === "string") ||
      (node.kind === "functionRef" && typeof node.name === "string")
    ) {
      const fn = byName.get((node.callee ?? node.name) as string);
      if (fn) {
        const available = fn.binding?.platforms;
        for (const platform of platforms) {
          const minimum = fn.binding?.contract?.availability?.[platform];
          if (minimum !== undefined && !supportsNativeVersion(targets[platform], minimum)) {
            const call = value as TExpr;
            diagnostics.push(
              diagnostic(
                "LUCENT2004",
                call.span,
                `${fn.name} requires ${platform} ${minimum}; configured minimum is ${targets[platform] ?? "unspecified"}.`,
              ),
            );
          }
        }
        if (available && platforms.some((p) => !available.includes(p))) {
          const call = value as Extract<TExpr, { kind: "call" }>;
          const key = `${fn.name}:${call.span.origin?.fileName ?? ""}:${call.span.start}`;
          if (!reported.has(key)) {
            reported.add(key);
            diagnostics.push(
              diagnostic(
                "LUCENT2004",
                call.span,
                `${fn.name} is available only on ${available.join(" or ")}.`,
                'Guard this call with Platform.OS === "ios" or Platform.OS === "android".',
              ),
            );
          }
        } else visitFunction(fn, platforms);
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== "type" && key !== "span") visit(child, platforms);
  };
  for (const fn of functions) if (fn.exported) visitFunction(fn, ["ios", "android"]);
  return diagnostics;
}
