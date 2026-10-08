/**
 * Objects on the stack. An object literal a local holds is a heap object
 * (`std::make_shared`) that the local, and anything given it, references.
 * When nothing but the local's own field reads and writes ever sees it, no
 * second reference can exist: nothing can compare it (`===`), capture it,
 * keep it or outlive the function with it, so the object can be the local
 * itself, a C++ value, and each `o.f` its field.
 *
 * A candidate is a `let` or `const` initialized with an object literal of
 * an object type, which no closure shares, and which the program analysis
 * finds does not escape (analysis/index.ts `escapes`). Every use must be
 * `o.f` (read, assigned, counted, compound-assigned or a destructuring
 * target), outside any nested function, and never called (`o.f()` would
 * pass `o` as `this`). Anything else (passing it, even to a function that
 * does not keep it, which would need a reference with no owner count;
 * returning it; spreading it; comparing it) keeps it on the heap.
 */
import ts from "typescript";

export interface StackOptions {
  checker: ts.TypeChecker;
  /** A local of an object type, which no closure shares, initialized here. */
  candidate: (decl: ts.VariableDeclaration, sym: ts.Symbol) => boolean;
  /** Whether the program analysis finds a way the local's value outlives the function. */
  escapes: (sym: ts.Symbol) => boolean;
}

/** The locals of `body` (not of the functions in it) whose objects can live on the stack. */
export function stackObjects(body: ts.Node, opts: StackOptions): Set<ts.Symbol> {
  const { checker } = opts;
  const decls = new Map<ts.Symbol, ts.VariableDeclaration>();

  const collect = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const list = n.parent;
      const sym = checker.getSymbolAtLocation(n.name);

      if (
        sym &&
        ts.isVariableDeclarationList(list) &&
        !ts.isForOfStatement(list.parent) &&
        !ts.isForInStatement(list.parent) &&
        list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const) &&
        ts.isObjectLiteralExpression(n.initializer) &&
        opts.candidate(n, sym)
      )
        decls.set(sym, n);
    }

    if (n !== body && (ts.isFunctionLike(n) || ts.isClassLike(n))) return;

    ts.forEachChild(n, collect);
  };
  collect(body);

  if (!decls.size) return new Set();

  const seen = new Set<ts.Symbol>();
  const visit = (n: ts.Node, nested: boolean): void => {
    if (ts.isIdentifier(n)) {
      const sym = checker.getSymbolAtLocation(n);

      if (sym && decls.has(sym) && decls.get(sym)!.name !== n && (nested || !fieldUse(n)))
        seen.add(sym);

      return;
    }

    ts.forEachChild(n, (c) => visit(c, nested || ts.isFunctionLike(c) || ts.isClassLike(c)));
  };
  visit(body, false);

  return new Set([...decls.keys()].filter((s) => !seen.has(s) && !opts.escapes(s)));
}

/** Whether `id` is the object of a field access `id.f` that is not called or deleted. */
function fieldUse(id: ts.Identifier): boolean {
  const access = id.parent;

  if (!ts.isPropertyAccessExpression(access) || access.expression !== id) return false;

  if (access.questionDotToken) return false;

  let outer: ts.Node = access;

  while (ts.isParenthesizedExpression(outer.parent) || ts.isNonNullExpression(outer.parent))
    outer = outer.parent;

  const p = outer.parent;

  if (ts.isDeleteExpression(p)) return false;

  // `o.f()`, `o.f\`…\`` and `new o.f()` call the field with `o` as `this`.
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === outer) return false;

  if (ts.isTaggedTemplateExpression(p) && p.tag === outer) return false;

  return true;
}
