/**
 * What code an executor may run (lucent:thread's `on(executor, f)`, and
 * what it calls) hands the platform without `on()`: a callback or an
 * object whose methods run in its module when the platform calls them,
 * beside the executor, so they may share nothing with it (decision 0081).
 */
import ts from "typescript";
import { describe, type ProgramFacts, type Unit } from "../analysis/index.ts";
import { Codes, fail } from "../diagnostics.ts";
import { factsOf } from "./compute.ts";
import type { FnEmitter } from "./function.ts";

/** The unit of the code around `node`: the function, method or module it is written in. */
function enclosingUnit(facts: ProgramFacts, node: ts.Node): Unit | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    const u = facts.unit(n);
    if (u) return u;
  }
  return undefined;
}

const code = (name: string) => `\`${name}\``;

const onExecutor = (facts: ProgramFacts, u: Unit | undefined): boolean =>
  !!u && facts.owners(u).has("executor");

/** The function literal `node` is, or names as a `const`: what the compiler checks of it. */
function literalOf(em: FnEmitter, node: ts.Node): ts.Node | undefined {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
  if (!ts.isIdentifier(node)) return undefined;

  const decl = em.checker.getSymbolAtLocation(node)?.valueDeclaration;
  const init = decl && ts.isVariableDeclaration(decl) ? decl.initializer : undefined;
  return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined;
}

/**
 * Refuses a function code on an executor makes and hands the platform
 * without `on()` that shares a variable or a value with that code: it runs
 * in its module, beside the executor, when the platform calls it.
 */
export function refuseSharedWithExecutor(em: FnEmitter, node: ts.Node): void {
  const f = literalOf(em, node);
  if (!f) return;

  const facts = factsOf(em.ctx);
  const unit = facts.unit(f);
  if (!unit || !onExecutor(facts, enclosingUnit(facts, f))) return;

  const [v] = facts.checkCaptures(unit, "executor");
  if (v)
    fail(
      node,
      Codes.NotOnExecutor,
      `${code(unit.display)} is made on an executor but runs in its module when the platform calls it, beside the executor: it ${describe(v.cause)}. Hand it over with on(executor, f) to run it on the executor`,
    );
}

/**
 * Refuses an object code on an executor hands the platform: its methods
 * would run in its module, beside the executor, and objects can't go on an
 * executor yet.
 */
export function refuseObjectFromExecutor(em: FnEmitter, node: ts.Node, name: string): void {
  const facts = factsOf(em.ctx);
  if (!onExecutor(facts, enclosingUnit(facts, node))) return;

  fail(
    node,
    Codes.NotOnExecutor,
    `code on an executor gives the platform \`${name}\`, whose methods would run in its module, beside the executor: objects can't go on an executor yet, so give the platform a function with on(executor, f)`,
  );
}
