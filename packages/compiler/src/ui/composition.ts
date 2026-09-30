/**
 * A Compose component's composition statements (LUCENT_VIEWS=fabric): the
 * statements of its own code that compose, which the compiler lifts into
 * the generated @Composable content, before what the returned JSX shows.
 *
 * A statement composes when it calls a composable or reads a composable
 * property outside the functions it makes (`animateDpAsState(…)`,
 * `remember(…)`, `LaunchedEffect(…)`, `isSystemInDarkTheme()`,
 * `LocalDensity.current`), by Compose's bindings (`kotlin.composable`).
 * Everything else in the component is setup code, compiled to C++. The
 * rules follow from when each runs: the setup runs once, before the
 * content first composes; composition statements run, in their order,
 * each time it composes.
 *
 * - A composition statement stands in the component's own code: not in an
 *   `if`, a loop or a block (Compose calls composables the same way at
 *   every composition), and not in a function of the setup.
 * - It may read the setup's values (each a slot the setup keeps set, as
 *   the JSX's reads are) and the values of the composition statements
 *   before it.
 * - Setup code never reads a composition value: it has none when it runs.
 *
 * What breaks a rule fails with LUCENT3024.
 */
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { platformOf } from "../program.ts";
import { bindingOf, isComposeDeclaration } from "./compose-api.ts";
import { isElement } from "./compose-dts.ts";
import type { FunctionLike } from "./roots.ts";
import { toolkitOfPlatform } from "./toolkits.ts";

/** The declaration a call, a property read or a name `n` reads, when it is one. */
function declarationOf(checker: ts.TypeChecker, n: ts.Node): ts.Declaration | undefined {
  if (ts.isCallExpression(n)) return checker.getResolvedSignature(n)?.declaration;

  const name = ts.isPropertyAccessExpression(n)
    ? n.name
    : ts.isIdentifier(n) && !isName(n)
      ? n
      : undefined;
  const found = name && checker.getSymbolAtLocation(name);
  const symbol =
    found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;

  return symbol?.declarations?.[0];
}

/** Whether `n` itself is a composable call, or a read of a composable property. */
function composable(checker: ts.TypeChecker, n: ts.Node): boolean {
  return (
    (ts.isCallExpression(n) || ts.isPropertyAccessExpression(n)) &&
    !!bindingOf(declarationOf(checker, n))?.member.kotlin?.composable
  );
}

/** Whether a node composes: it calls or reads a composable outside the functions it makes. */
function composes(checker: ts.TypeChecker, node: ts.Node): boolean {
  let found = false;

  const visit = (n: ts.Node): void => {
    if (found || ts.isFunctionLike(n)) return;

    found = composable(checker, n);

    if (!found) ts.forEachChild(n, visit);
  };

  visit(node);

  return found;
}

/** Whether a function is a Compose component's setup: in an Android file, returning JSX. */
function composeSetup(fn: FunctionLike): fn is FunctionLike & { body: ts.Block } {
  if (toolkitOfPlatform(platformOf(fn.getSourceFile().fileName)) !== "compose") return false;

  const last = fn.body && ts.isBlock(fn.body) ? fn.body.statements.at(-1) : undefined;
  let e = last && ts.isReturnStatement(last) ? last.expression : undefined;

  while (e && ts.isParenthesizedExpression(e)) e = e.expression;

  return !!e && (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e));
}

const found = new WeakMap<FunctionLike, readonly ts.Statement[]>();

/** A Compose component's composition statements, in order; none for any other function. */
export function compositionStatements(
  checker: ts.TypeChecker,
  fn: FunctionLike,
): readonly ts.Statement[] {
  let out = found.get(fn);

  if (!out) {
    out = composeSetup(fn)
      ? fn.body.statements.filter(
          (s) => (ts.isVariableStatement(s) || ts.isExpressionStatement(s)) && composes(checker, s),
        )
      : [];
    found.set(fn, out);
  }

  return out;
}

/** Whether `node` is in a composition statement (or is one). */
export function inComposition(checker: ts.TypeChecker, node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const fn = n.parent && ts.isBlock(n.parent) ? n.parent.parent : undefined;

    if (
      fn &&
      (ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      compositionStatements(checker, fn).includes(n as ts.Statement)
    )
      return true;
  }

  return false;
}

/**
 * Checks a Compose component's setup code (all but its composition
 * statements and its JSX) against its composition: it uses no composable,
 * and reads no composition value.
 */
export function checkComposition(checker: ts.TypeChecker, fn: FunctionLike): void {
  const lifted = new Set(compositionStatements(checker, fn));
  const values = new Set(
    [...lifted].flatMap((s) =>
      ts.isVariableStatement(s)
        ? s.declarationList.declarations.flatMap((d) => {
            const symbol = ts.isIdentifier(d.name)
              ? checker.getSymbolAtLocation(d.name)
              : undefined;

            return symbol ? [symbol] : [];
          })
        : [],
    ),
  );

  const visit = (n: ts.Node, nested: boolean): void => {
    // The composition's own code, JSX (the body, or refused where it is not), and types.
    if (
      lifted.has(n as ts.Statement) ||
      ts.isTypeNode(n) ||
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    )
      return;

    if (isComposeDeclaration(declarationOf(checker, n))) refuseUse(checker, n, nested);

    if (ts.isIdentifier(n) && !isName(n)) {
      const symbol = checker.getSymbolAtLocation(n);

      if (symbol && values.has(symbol))
        fail(
          n,
          Codes.ToolkitBody,
          `\`${n.text}\` is a value of the composition: setup code, which runs before the content composes, cannot read it. Use it in the returned JSX, or in another composition statement`,
        );
    }

    ts.forEachChild(n, (c) => visit(c, nested || (ts.isFunctionLike(n) && n !== fn)));
  };

  if (fn.body) visit(fn.body, false);
}

/**
 * Refused: Compose used in setup code, where no composition runs: a
 * composable, or a value only the content has.
 */
function refuseUse(checker: ts.TypeChecker, n: ts.Node, nested: boolean): never {
  const name = ts.isCallExpression(n) ? n.expression.getText() : n.getText();
  const binding = bindingOf(declarationOf(checker, n));

  if (!composable(checker, n))
    fail(
      n,
      Codes.ToolkitBody,
      `\`${ts.isCallExpression(n) ? `${name}()` : name}\` is Compose's: make it in the JSX the component returns, or in a composition statement`,
    );

  if (binding && isElement(binding.member, binding.owner))
    fail(
      n,
      Codes.ToolkitBody,
      `\`${name}\` shows content: write it as an element, \`<${name} …/>\`, in the JSX the component returns`,
    );

  fail(
    n,
    Codes.ToolkitBody,
    nested
      ? `\`${name}\` composes: use it in a statement of the component's own code, which is lifted into the content, not in a function of the setup`
      : `\`${name}\` composes: a composition statement stands in the component's own code, not in an if, a loop or a block, as Compose calls it the same way at every composition`,
  );
}

/** Whether an identifier names something rather than reads it: a member's, a declaration's. */
function isName(id: ts.Identifier): boolean {
  const p = id.parent;

  return (
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isPropertyAssignment(p) && p.name === id) ||
    (ts.isVariableDeclaration(p) && p.name === id) ||
    (ts.isParameter(p) && p.name === id) ||
    (ts.isFunctionDeclaration(p) && p.name === id)
  );
}
