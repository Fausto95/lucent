/**
 * Code on an executor (lucent:thread's `on(executor, x)`, decisions 0078,
 * 0081 and 0082): the objects that go on one, how the platform's calls of
 * their methods enter it, and what code an executor may run hands the
 * platform without `on()`, which runs in its module, beside the executor.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import {
  classMade,
  describe,
  isOnCall,
  type ProgramFacts,
  shareableType,
  type Unit,
} from "../analysis/index.ts";
import { Codes, fail } from "../diagnostics.ts";
import { factsOf } from "./compute.ts";
import type { Ctx } from "./context.ts";
import type { FnEmitter } from "./function.ts";

const code = (name: string) => `\`${name}\``;

/** The unit of the code around `node`: the function, method or module it is written in. */
function enclosingUnit(facts: ProgramFacts, node: ts.Node): Unit | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    const u = facts.unit(n);
    if (u) return u;
  }
  return undefined;
}

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

/** The first `this` in `node` that is not a member access's receiver, outside nested functions' own. */
function strayThis(node: ts.Node): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword) {
      const p = n.parent;
      const receiver =
        (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n;
      if (!receiver) found = n;
      return;
    }
    // A function declaration or expression has a `this` of its own.
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) return;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** Whether code at `node` uses `this` (an arrow function's is its enclosing method's). */
function usesThis(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword) found = true;
    else if (!ts.isFunctionDeclaration(n) && !ts.isFunctionExpression(n)) ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/**
 * Refuses a function code on an executor makes and hands the platform
 * without `on()` that shares a variable, a value or `this` with that
 * code: it runs in its module, beside the executor, when the platform
 * calls it.
 */
export function refuseSharedWithExecutor(em: FnEmitter, node: ts.Node): void {
  const f = literalOf(em, node);
  if (!f) return;

  const facts = factsOf(em.ctx);
  const unit = facts.unit(f);
  if (!unit || !onExecutor(facts, enclosingUnit(facts, f))) return;

  const made = `${code(unit.display)} is made on an executor but runs in its module when the platform calls it, beside the executor`;
  const fix = "Hand it over with on(executor, f) to run it on the executor";
  if (ts.isArrowFunction(f) && usesThis(f))
    fail(
      node,
      Codes.NotOnExecutor,
      `${made}: it uses \`this\`, which the executor's object keeps. ${fix}`,
    );

  const [v] = facts.checkCaptures(unit, "executor");
  if (v) fail(node, Codes.NotOnExecutor, `${made}: it ${describe(v.cause)}. ${fix}`);
}

/**
 * Refuses an object code on an executor hands the platform without `on()`:
 * its methods would run in its module, beside the executor.
 */
export function refuseObjectFromExecutor(em: FnEmitter, node: ts.Node, name: string): void {
  if (isOnCall(em.checker, node)) return;

  const facts = factsOf(em.ctx);
  if (!onExecutor(facts, enclosingUnit(facts, node))) return;

  fail(
    node,
    Codes.NotOnExecutor,
    `code on an executor gives the platform \`${name}\`, whose methods would run in its module, beside the executor: put it on the executor too, with on(executor, new ${name}(…))`,
  );
}

/** Whether instances of `decl` go on an executor: `on(executor, new C(…))`. */
export function executorClass(ctx: Ctx, decl: ts.ClassLikeDeclaration): boolean {
  return factsOf(ctx).executorClasses().has(decl);
}

/**
 * How the platform's calls of the methods of a class whose instances go on
 * an executor enter Lucent code, `object` being the Lucent object as the
 * glue holds it: the executor it went on, never an actor's lock. Now when
 * the platform waits for an answer (`callNowIn`, which reports a call
 * from another thread), else at once on the executor or as a turn of it
 * (`enterOrPost`). Undefined for any other class.
 */
export function objectEntry(
  ctx: Ctx,
  decl: ts.ClassLikeDeclaration,
  object: cpp.Expr,
): { now: (f: cpp.Expr) => cpp.Expr; later: (f: cpp.Expr) => cpp.Expr } | undefined {
  if (!executorClass(ctx, decl)) return undefined;

  const executor = () => cpp.deref(cpp.arrow(object, "lucentExecutor_"));
  return {
    now: (f) => cpp.call("lucent::callNowIn", [executor(), f]),
    later: (f) => cpp.call("lucent::enterOrPost", [executor(), f]),
  };
}

const checkedClasses = new WeakMap<Ctx, Set<ts.ClassLikeDeclaration>>();

/**
 * Refuses `on(executor, new C(…))` where `C`'s instances can't go on an
 * executor. Its objects are made only there and keep `this` to themselves,
 * so no other code reaches them; its methods are checked as executor code;
 * and what it is given is shared with its maker, so it takes only
 * constants, channels and executors (decision 0082).
 */
export function requireExecutorObject(em: FnEmitter, made: ts.NewExpression): void {
  const checker = em.checker;
  const decl = classMade(checker, made);
  if (!decl || !ts.isClassDeclaration(decl))
    fail(
      made,
      Codes.UnsupportedCall,
      "on() takes a function literal, or a new object of a Lucent class: on(executor, new Frames(…))",
    );
  const name = decl.name?.text ?? "class";

  // What it is given, which its maker keeps.
  for (const arg of made.arguments ?? [])
    if (!shareableType(checker.getTypeAtLocation(arg)))
      fail(
        arg,
        Codes.NotOnExecutor,
        `\`new ${name}(…)\` goes on an executor, beside the code that makes it, so it takes only numbers, strings, booleans, bigints, channels and executors: \`${arg.getText()}\` is a value that code could change`,
      );

  let checked = checkedClasses.get(em.ctx);
  if (!checked) checkedClasses.set(em.ctx, (checked = new Set()));
  if (checked.has(decl)) return;
  checked.add(decl);

  const facts = factsOf(em.ctx);
  const at = decl.name ?? decl;
  if (ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    fail(
      at,
      Codes.NotOnExecutor,
      `\`${name}\` goes on an executor, so only the platform calls it: don't export it, or JavaScript would call it from the module's thread`,
    );
  if (decl.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword))
    fail(
      at,
      Codes.NotOnExecutor,
      `\`${name}\` extends a class: a class that extends another can't go on an executor yet`,
    );

  const files = new Set(facts.units.map((u) => u.node.getSourceFile()));
  const stray = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && classMade(checker, node) === decl) {
      const p = node.parent;
      if (!(isOnCall(checker, p) && p.arguments[1] === node))
        fail(
          node,
          Codes.NotOnExecutor,
          `\`${name}\` goes on an executor, so it is made only where it does, as on(executor, new ${name}(…)): no other code may hold one`,
        );
    }
    if (ts.isClassLike(node))
      for (const h of node.heritageClauses ?? [])
        for (const t of h.types)
          if (h.token === ts.SyntaxKind.ExtendsKeyword) {
            const base = checker.getSymbolAtLocation(t.expression);
            const target =
              base && base.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(base) : base;
            if (target?.valueDeclaration === decl)
              fail(
                t,
                Codes.NotOnExecutor,
                `\`${name}\` goes on an executor, so no class may extend it`,
              );
          }
    ts.forEachChild(node, stray);
  };
  for (const f of files) stray(f);

  for (const member of decl.members) {
    const leaving = strayThis(member);
    if (leaving)
      fail(
        leaving,
        Codes.NotOnExecutor,
        `\`this\` leaves \`${name}\` here, which goes on an executor: its object keeps to itself, so \`this\` may only read and write its members`,
      );

    if (!(ts.isMethodDeclaration(member) || ts.isAccessor(member))) continue;
    const unit = facts.unit(member);
    const [v] = unit ? facts.check(unit, "executor") : [];
    if (v) fail(member.name, Codes.NotOnExecutor, v.message);
  }
}
