/**
 * Where a component's ref commands come from: one call of lucent:ui's
 * `expose` at the top level of its setup, given an object literal. The
 * commands run on the main thread later, so the functions the literal
 * names (not only those it creates) are checked with the setup.
 */
import ts from "typescript";
import type { Located } from "./describe.ts";
import type { FunctionLike } from "./roots.ts";

/** The calls of a lucent:ui helper (expose, slot) in `files`, in source order. */
export function helperCalls(
  files: readonly ts.SourceFile[],
  isHelper: (callee: ts.Expression) => boolean,
): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && isHelper(n.expression)) out.push(n);

    ts.forEachChild(n, visit);
  };

  files.forEach(visit);

  return out;
}

export interface SetupExpose {
  /** The object the setup exposes, if it exposes one it may. */
  readonly commands?: ts.ObjectLiteralExpression;
  readonly problems: Located[];
}

/** The object component `name`'s setup `fn` exposes, among `calls`. */
export function setupExpose(
  name: string,
  fn: FunctionLike,
  calls: readonly ts.CallExpression[],
): SetupExpose {
  const problems: Located[] = [];
  const top: ts.CallExpression[] = [];

  for (const call of calls) {
    const owner = enclosingFunction(call);

    if (!within(call, fn)) continue;

    if (owner !== fn)
      problems.push({
        message: `\`${name}\` calls expose in a nested function: a component exposes its commands once, while it sets up`,
        node: call,
      });
    else if (!ts.isExpressionStatement(call.parent) || call.parent.parent !== fn.body)
      problems.push({
        message: `\`${name}\` calls expose inside a statement: call it once, at the top level of its setup`,
        node: call,
      });
    else top.push(call);
  }

  if (top.length > 1) {
    problems.push({
      message: `\`${name}\` calls expose more than once: expose every command in one object`,
      node: top[1]!,
    });

    return { problems };
  }

  const given = top[0]?.arguments[0];
  const literal = given && skipParentheses(given);

  if (literal && !ts.isObjectLiteralExpression(literal)) {
    problems.push({
      message: `\`${name}\` gives expose \`${literal.getText()}\`: give it an object literal, so its commands are known`,
      node: literal,
    });

    return { problems };
  }

  return literal ? { commands: literal, problems } : { problems };
}

/** Calls of `helper` (expose, slot) outside the top-level declarations `components` (component exports). */
export function strayCalls(
  helper: string,
  calls: readonly ts.CallExpression[],
  components: ReadonlySet<ts.Node>,
): Located[] {
  const out: Located[] = [];

  for (const call of calls) {
    const statement = topLevelStatement(call);

    if (statement && components.has(statement)) continue;

    const owner = outermostFunction(call);
    const name = owner && functionName(owner);

    out.push({
      message: `${helper} is for components, and ${name ? `\`${name}\`` : "this code"} is not one: a component is an exported function returning a view`,
      node: call,
    });
  }

  return out;
}

/**
 * The functions declared elsewhere that an exposed object's members name
 * (`{ reset }`, `{ reset: resetAll }`): function declarations, and
 * variables holding a function expression.
 */
export function namedFunctions(
  checker: ts.TypeChecker,
  commands: ts.ObjectLiteralExpression,
): ts.Node[] {
  const out: ts.Node[] = [];

  for (const p of commands.properties) {
    const found = ts.isShorthandPropertyAssignment(p)
      ? checker.getShorthandAssignmentValueSymbol(p)
      : ts.isPropertyAssignment(p) && ts.isIdentifier(skipParentheses(p.initializer))
        ? checker.getSymbolAtLocation(skipParentheses(p.initializer))
        : undefined;
    const symbol =
      found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
    const decl = symbol?.valueDeclaration;

    if (decl && ts.isFunctionDeclaration(decl)) out.push(decl);

    const init = decl && ts.isVariableDeclaration(decl) && decl.initializer;
    const value = init && skipParentheses(init);

    if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) out.push(value);
  }

  return out;
}

export function within(node: ts.Node, ancestor: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) if (n === ancestor) return true;

  return false;
}

export function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent)
    if (ts.isFunctionLike(n)) return n;

  return undefined;
}

function outermostFunction(node: ts.Node): ts.Node | undefined {
  let out: ts.Node | undefined;

  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) if (ts.isFunctionLike(n)) out = n;

  return out;
}

function topLevelStatement(node: ts.Node): ts.Node | undefined {
  for (let n: ts.Node = node; n.parent; n = n.parent) if (ts.isSourceFile(n.parent)) return n;

  return undefined;
}

/** A function's name, or the variable's it initializes. */
function functionName(fn: ts.Node): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;

  const parent = fn.parent;

  return parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined;
}

export function skipParentheses(e: ts.Expression): ts.Expression {
  let out = e;

  while (ts.isParenthesizedExpression(out) || ts.isNonNullExpression(out)) out = out.expression;

  return out;
}
