import ts from "typescript";
import type { IntKind } from "./context.ts";

/**
 * Integer inference. A `let`/`const` number whose every write produces an
 * integer can live in an integer register: `i32` for the results of `|`,
 * `&`, `^`, `<<`, `>>`, `~`, `Math.imul`, `Math.clz32`; `u32` for `>>>`; `i64`
 * when both kinds, or a loop counter, are stored. The value is exact in every
 * representation, so reads convert to double without changing any result.
 * Increments and arithmetic writes keep a local a double: `x + 1` on an int32
 * does not wrap in JavaScript.
 *
 * A `for` counter (`let i = <int>; …; i++ / i-- / i += <int>`) that nothing
 * else writes becomes an `i64`: exact for every value JavaScript can count to.
 */

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const U32_MAX = 4294967295;

/** What one write stores: an integer kind, a literal compatible with some kinds, or not an integer. */
type Write = IntKind | "small" | "negative" | "unsigned" | undefined;

export interface IntegerFacts {
  locals: Map<ts.Symbol, IntKind>;
  /** `for` counters, which are i64. */
  counters: Set<ts.Symbol>;
}

export interface InferOptions {
  checker: ts.TypeChecker;
  /** A local that may be an integer: a non-boxed number. */
  candidate: (decl: ts.VariableDeclaration, sym: ts.Symbol) => boolean;
  isBoxed: (sym: ts.Symbol) => boolean;
  /** Whether `id` is the global `Math`. */
  isMath: (id: ts.Expression) => boolean;
}

function literalWrite(v: number): Write {
  if (!Number.isInteger(v)) return undefined;
  if (v >= 0 && v <= I32_MAX) return "small";
  if (v > I32_MAX && v <= U32_MAX) return "unsigned";
  return undefined;
}

/** The integer kind an expression produces, given the kinds of integer locals. */
export function writeKind(e: ts.Expression, kinds: ReadonlyMap<ts.Symbol, IntKind | "any">, opts: Pick<InferOptions, "checker" | "isMath">): Write {
  if (ts.isParenthesizedExpression(e)) return writeKind(e.expression, kinds, opts);
  if (ts.isNumericLiteral(e)) return literalWrite(Number(e.text.replace(/_/g, "")));
  if (ts.isPrefixUnaryExpression(e)) {
    if (e.operator === ts.SyntaxKind.TildeToken) return "i32";
    // `-0` is not an integer register value: 1 / -0 is -Infinity.
    if (e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) {
      const v = -Number(e.operand.text.replace(/_/g, ""));
      return Number.isInteger(v) && v < 0 && v >= I32_MIN ? "negative" : undefined;
    }
    return undefined;
  }
  if (ts.isBinaryExpression(e)) {
    switch (e.operatorToken.kind) {
      case ts.SyntaxKind.BarToken:
      case ts.SyntaxKind.AmpersandToken:
      case ts.SyntaxKind.CaretToken:
      case ts.SyntaxKind.LessThanLessThanToken:
      case ts.SyntaxKind.GreaterThanGreaterThanToken:
        return "i32";
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
        return "u32";
    }
    return undefined;
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && opts.isMath(e.expression.expression)) {
    const name = e.expression.name.text;
    return name === "imul" || name === "clz32" ? "i32" : undefined;
  }
  if (ts.isConditionalExpression(e)) {
    const a = writeKind(e.whenTrue, kinds, opts);
    const b = writeKind(e.whenFalse, kinds, opts);
    const k = join([a, b]);
    if (k === undefined) return undefined;
    if (a === k || b === k) return k;
    // Two literals stay a literal, so they still combine with either kind.
    return a === "negative" || b === "negative" ? "negative" : a === "unsigned" || b === "unsigned" ? "unsigned" : "small";
  }
  if (ts.isIdentifier(e)) {
    const sym = opts.checker.getSymbolAtLocation(e);
    const k = sym ? kinds.get(sym) : undefined;
    return k === "any" ? "small" : k;
  }
  return undefined;
}

/** The register kind that can hold every write, or undefined. */
function join(writes: Write[]): IntKind | undefined {
  if (writes.some((w) => w === undefined)) return undefined;
  const signed = writes.some((w) => w === "i32" || w === "negative");
  const unsigned = writes.some((w) => w === "u32" || w === "unsigned");
  if (writes.includes("i64") || (signed && unsigned)) return "i64";
  return unsigned ? "u32" : "i32";
}

const INT_COMPOUND = new Map<ts.SyntaxKind, IntKind>([
  [ts.SyntaxKind.BarEqualsToken, "i32"],
  [ts.SyntaxKind.AmpersandEqualsToken, "i32"],
  [ts.SyntaxKind.CaretEqualsToken, "i32"],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, "i32"],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, "i32"],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, "u32"],
]);

function isAssignment(k: ts.SyntaxKind): boolean {
  return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
}

/** Whether `id` is written by something other than a plain or compound assignment to it. */
function isOtherWrite(id: ts.Identifier): boolean {
  let n: ts.Node = id;
  let p = n.parent;
  if (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) {
    return p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken;
  }
  // Destructuring targets: [a, b] = …, ({ a } = …), for (a of …).
  while (ts.isParenthesizedExpression(p) || ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isSpreadElement(p)) {
    n = p;
    p = p.parent;
  }
  if (n !== id && ts.isBinaryExpression(p) && p.left === n && isAssignment(p.operatorToken.kind)) return true;
  if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === n) return true;
  return false;
}

/**
 * Symbols a destructuring pattern writes: `[a, b = 1] = …`, `({ a, b: c } = …)`,
 * `for ([a] of …)`. Defaults are reads, and shorthand names resolve to the
 * local, not the property.
 */
export function destructuredSymbols(root: ts.Node, checker: ts.TypeChecker): Set<ts.Symbol> {
  const out = new Set<ts.Symbol>();
  const target = (n: ts.Node): void => {
    if (ts.isParenthesizedExpression(n)) return target(n.expression);
    if (ts.isIdentifier(n)) {
      const sym = checker.getSymbolAtLocation(n);
      if (sym) out.add(sym);
    } else if (ts.isArrayLiteralExpression(n)) {
      for (const el of n.elements) target(ts.isSpreadElement(el) ? el.expression : el);
    } else if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        if (ts.isShorthandPropertyAssignment(p)) {
          const sym = checker.getShorthandAssignmentValueSymbol(p);
          if (sym) out.add(sym);
        } else if (ts.isPropertyAssignment(p)) target(p.initializer);
        else if (ts.isSpreadAssignment(p)) target(p.expression);
      }
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      target(n.left);
    }
  };
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && (ts.isArrayLiteralExpression(n.left) || ts.isObjectLiteralExpression(n.left))) target(n.left);
    if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) target(n.initializer);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

function isFunctionBoundary(n: ts.Node): boolean {
  return ts.isFunctionLike(n) || ts.isClassLike(n);
}

export function inferIntegers(body: ts.Node, opts: InferOptions): IntegerFacts {
  const { checker } = opts;
  const decls = new Map<ts.Symbol, ts.VariableDeclaration>();
  const counters = new Set<ts.Symbol>();
  const destructured = destructuredSymbols(body, checker);
  const collect = (n: ts.Node): void => {
    if (ts.isForStatement(n)) {
      const c = loopCounter(n, checker, (sym) => opts.isBoxed(sym) || destructured.has(sym));
      if (c) counters.add(c);
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const list = n.parent;
      const inForOf = ts.isForOfStatement(list.parent) || ts.isForInStatement(list.parent);
      const sym = checker.getSymbolAtLocation(n.name);
      if (sym && !counters.has(sym) && !destructured.has(sym) && !inForOf && ts.isVariableDeclarationList(list) && list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const) && opts.candidate(n, sym)) decls.set(sym, n);
    }
    if (n !== body && isFunctionBoundary(n)) return;
    ts.forEachChild(n, collect);
  };
  collect(body);

  // Every write, including those in nested functions (a local written there
  // is boxed and was never a candidate, but reads through closures are fine).
  const writes = new Map<ts.Symbol, (ts.Expression | IntKind | "other")[]>();
  for (const [sym, d] of decls) writes.set(sym, [d.initializer!]);
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const sym = checker.getSymbolAtLocation(n);
      const list = sym ? writes.get(sym) : undefined;
      if (list) {
        const p = n.parent;
        if (ts.isBinaryExpression(p) && p.left === n && isAssignment(p.operatorToken.kind)) {
          if (p.operatorToken.kind === ts.SyntaxKind.EqualsToken) list.push(p.right);
          else list.push(INT_COMPOUND.get(p.operatorToken.kind) ?? "other");
        } else if (isOtherWrite(n)) list.push("other");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);

  const kinds = new Map<ts.Symbol, IntKind | "any">([...decls.keys()].map((s) => [s, "any"]));
  const withCounters = () => new Map<ts.Symbol, IntKind | "any">([...kinds, ...[...counters].map((c): [ts.Symbol, IntKind] => [c, "i64"])]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [sym, list] of writes) {
      if (!kinds.has(sym)) continue;
      const known = withCounters();
      const ws = list.map((w): Write => (w === "other" ? undefined : typeof w === "string" ? w : writeKind(w, known, opts)));
      const k = join(ws);
      if (k === undefined) {
        kinds.delete(sym);
        changed = true;
      } else if (kinds.get(sym) !== k) {
        kinds.set(sym, k);
        changed = true;
      }
    }
  }
  const locals = new Map<ts.Symbol, IntKind>();
  for (const [sym, k] of kinds) if (k !== "any") locals.set(sym, k);
  return { locals, counters };
}

/**
 * The counter of `for (let i = <int>; …; i++)` when it can be an i64: an
 * integer start, a step of ±1 or an integer literal, and no other writes.
 */
export function loopCounter(s: ts.ForStatement, checker: ts.TypeChecker, isBoxed: (sym: ts.Symbol) => boolean): ts.Symbol | undefined {
  const init = s.initializer;
  if (!init || !ts.isVariableDeclarationList(init) || !(init.flags & ts.NodeFlags.Let) || init.declarations.length !== 1) return undefined;
  const d = init.declarations[0]!;
  if (!ts.isIdentifier(d.name) || !d.initializer) return undefined;
  const start = writeKind(d.initializer, new Map(), { checker, isMath: () => false });
  if (start !== "small" && start !== "negative") return undefined;
  const sym = checker.getSymbolAtLocation(d.name);
  if (!sym || isBoxed(sym)) return undefined;
  const inc = s.incrementor;
  const isCounter = (e: ts.Expression) => ts.isIdentifier(e) && checker.getSymbolAtLocation(e) === sym;
  let stepOk = false;
  if (inc && (ts.isPrefixUnaryExpression(inc) || ts.isPostfixUnaryExpression(inc))) {
    stepOk = (inc.operator === ts.SyntaxKind.PlusPlusToken || inc.operator === ts.SyntaxKind.MinusMinusToken) && isCounter(inc.operand);
  } else if (inc && ts.isBinaryExpression(inc) && (inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken || inc.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken)) {
    stepOk = isCounter(inc.left) && ts.isNumericLiteral(inc.right) && literalWrite(Number(inc.right.text.replace(/_/g, ""))) === "small";
  }
  if (!stepOk) return undefined;
  let written = false;
  const scan = (n: ts.Node): void => {
    if (written) return;
    if (ts.isIdentifier(n) && checker.getSymbolAtLocation(n) === sym) {
      const p = n.parent;
      if ((ts.isBinaryExpression(p) && p.left === n && isAssignment(p.operatorToken.kind)) || isOtherWrite(n)) written = true;
    }
    ts.forEachChild(n, scan);
  };
  if (s.condition) scan(s.condition);
  scan(s.statement);
  return written ? undefined : sym;
}
