/**
 * lucent:thread's `on(executor, x)`, which hands `x` to the platform to
 * run on an executor: a function, or an object made there with `new`,
 * whose class's methods then run on executors wherever the platform calls
 * them (decisions 0078, 0081).
 */
import ts from "typescript";
import { builtinSdkModuleOf } from "../program.ts";

/** Whether `node` is a call of lucent:thread's `on`. */
export function isOnCall(checker: ts.TypeChecker, node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;

  let symbol = checker.getSymbolAtLocation(node.expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const decl = symbol?.declarations?.[0];

  return (
    symbol?.name === "on" && !!decl && builtinSdkModuleOf(decl.getSourceFile()) === "lucent:thread"
  );
}

/**
 * A function or object on an executor kept in a `const` in a function's
 * body, `const listener = on(executor, (e) => …)` or `on(executor, new
 * C(…))`: its declaration, executor and function literal or `new`, for
 * `node` naming it, or the declaration itself. Its uses each hand it to
 * the platform, where it is one object.
 */
export function keptOn(
  checker: ts.TypeChecker,
  node: ts.Node,
):
  | {
      decl: ts.VariableDeclaration & { name: ts.Identifier };
      executor: ts.Expression;
      f: ts.Expression;
    }
  | undefined {
  let decl: ts.Node | undefined = node;
  if (ts.isIdentifier(node)) {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    decl = symbol?.valueDeclaration;
  }
  if (!decl || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) return undefined;

  const list = decl.parent;
  const call = decl.initializer;
  if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) return undefined;
  // In a function: a module's top level holds no executor code.
  if (ts.isSourceFile(list.parent.parent)) return undefined;
  if (!call || !isOnCall(checker, call) || call.arguments.length !== 2) return undefined;

  const [executor, f] = call.arguments as unknown as [ts.Expression, ts.Expression];
  if (!(ts.isArrowFunction(f) || ts.isFunctionExpression(f) || ts.isNewExpression(f)))
    return undefined;
  return { decl: decl as ts.VariableDeclaration & { name: ts.Identifier }, executor, f };
}

/** The Lucent class a `new` makes, when the compiler can name it. */
export function classMade(
  checker: ts.TypeChecker,
  e: ts.NewExpression,
): ts.ClassLikeDeclaration | undefined {
  let symbol = checker.getSymbolAtLocation(e.expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const decl = symbol?.valueDeclaration;

  return decl && ts.isClassLike(decl) && !decl.getSourceFile().isDeclarationFile ? decl : undefined;
}

/**
 * Whether code at `node` is written on an executor: in a function handed
 * over with `on()`, or in a method or accessor of a class whose objects
 * go on one (a constructor and field initializers run in their maker),
 * or in a closure inside them. An `emit` there posts to its emitter's
 * module instead of running the listeners.
 */
export function inExecutorCode(
  checker: ts.TypeChecker,
  node: ts.Node,
  classes: ReadonlyMap<ts.ClassLikeDeclaration, unknown>,
): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const p = n.parent;
    if (!p) break;
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && isOnCall(checker, p))
      return p.arguments[1] === n;
    if ((ts.isMethodDeclaration(n) || ts.isAccessor(n)) && ts.isClassLike(p)) return classes.has(p);
  }
  return false;
}

/**
 * The classes whose instances go on an executor (`on(executor, new C(…))`
 * in `files`), each with the `on()` calls that make them.
 */
export function executorClasses(
  checker: ts.TypeChecker,
  files: Iterable<ts.SourceFile>,
): Map<ts.ClassLikeDeclaration, ts.CallExpression[]> {
  const out = new Map<ts.ClassLikeDeclaration, ts.CallExpression[]>();
  const visit = (node: ts.Node): void => {
    const made = isOnCall(checker, node) ? node.arguments[1] : undefined;
    const cls = made && ts.isNewExpression(made) ? classMade(checker, made) : undefined;

    if (cls) {
      const calls = out.get(cls);
      if (calls) calls.push(node as ts.CallExpression);
      else out.set(cls, [node as ts.CallExpression]);
    }
    ts.forEachChild(node, visit);
  };

  for (const f of new Set(files)) visit(f);
  return out;
}
