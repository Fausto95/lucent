import ts from "typescript";
import type { IntKind } from "./context.ts";

/**
 * Integer inference. A `let`/`const` number whose every write produces an
 * integer can live in an integer register: `i32` for the results of `|`,
 * `&`, `^`, `<<`, `>>`, `~`, `Math.imul`, `Math.clz32`; `u32` for `>>>`; `i64`
 * when both kinds, or a loop counter, are stored. The value is exact in every
 * representation, so reads convert to double without changing any result.
 *
 * Arithmetic (`+`, `-`, `*`, `%`, and `+=`, `++` and the like) keeps a local
 * a double unless its range is proven (see `rangeOf`): `x + 1` on an int32
 * does not wrap in JavaScript, so it is an `i64` only when every value it can
 * take is an exact integer within ±2^53 and never -0. A local whose writes are
 * all bounded this way, such as `sum = (sum + (x >>> 0)) % 1000000007`, is an
 * `i64`, and the emitter computes those writes in int64 (ir/cpp.ts, `stored`).
 *
 * A `for` counter (`let i = <int>; …; i++ / i-- / i += <int>`) that nothing
 * else writes becomes an `i64`: exact for every value JavaScript can count to
 * by ones, and, for a larger step, when its test stops it short of 2^53.
 *
 * A local `number[]` initialized with an array literal whose every element
 * is written the same way holds integer elements (`arrays`): each element
 * it is given (by its literal, `push`, or `a[i] = v`) is an integer of the
 * kind, and nothing else sees the array (it is only pushed to, indexed and
 * measured, outside any nested function), so its elements read as the same
 * numbers. `a[i]!` is then an integer of that kind too, and its range the
 * hull of what was stored.
 */

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const U32_MAX = 4294967295;
/** Doubles are exact integers up to here; an integer register holds the same value. */
const EXACT = 2 ** 53;

/** What one write stores: an integer kind, a literal compatible with some kinds, or not an integer. */
type Write = IntKind | "small" | "negative" | "unsigned" | undefined;

/** The exact integers, never -0, a number's every value lies between. */
export interface Range {
  lo: number;
  hi: number;
}

/**
 * What the range analysis knows of a value: its range; EMPTY, no value yet
 * (a local the fixpoint has not reached, which adds nothing to a range); or
 * undefined, any double.
 */
type Interval = Range | typeof EMPTY | undefined;
const EMPTY = "empty";

const I32: Range = { lo: I32_MIN, hi: I32_MAX };
const U32: Range = { lo: 0, hi: U32_MAX };
const COUNTER: Range = { lo: -EXACT, hi: EXACT };

/** The ranges locals have: the range fixpoint's, and those of the kinds the others are known to hold. */
interface RangeContext {
  ranges: ReadonlyMap<ts.Symbol, Interval>;
  kinds: ReadonlyMap<ts.Symbol, IntKind | "any">;
  opts: KindOptions;
}

/** What reading kinds and ranges needs: the checker, `Math`, and the arrays of integer candidates. */
type KindOptions = Pick<InferOptions, "checker" | "isMath"> & {
  /** Arrays whose elements may be integers: `a[i]!` reads one, of the array's kind and range. */
  arrays?: ReadonlySet<ts.Symbol>;
};

/** The array `e` reads an element of with `!` (`a[i]!`), when it is one of `arrays`. */
function elementRead(e: ts.Expression, opts: KindOptions): ts.Symbol | undefined {
  if (!opts.arrays?.size || !ts.isNonNullExpression(e)) return undefined;

  const read = e.expression;

  if (!ts.isElementAccessExpression(read) || read.questionDotToken) return undefined;

  if (!ts.isIdentifier(read.expression)) return undefined;

  const sym = opts.checker.getSymbolAtLocation(read.expression);

  return sym && opts.arrays.has(sym) ? sym : undefined;
}

/** The smallest interval holding both. */
function hull(a: Interval, b: Interval): Interval {
  if (a === undefined || b === undefined) return undefined;
  if (a === EMPTY) return b;
  if (b === EMPTY) return a;
  return { lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
}

/**
 * `a op b` on exact integers, when every result is an exact integer within
 * ±2^53 and never -0: a sum or difference of integers that are never -0 is
 * +0 when it is zero; a product of non-negative integers too (`0 * -1` is
 * -0); and a remainder of a non-negative dividend by a divisor of at least 1
 * (`-4 % 2` is -0, `x % 0` NaN).
 */
function arithmetic(op: ts.SyntaxKind, a: Interval, b: Interval): Interval {
  if (a === undefined || b === undefined) return undefined;
  if (a === EMPTY || b === EMPTY) return EMPTY;
  let r: Range;
  switch (op) {
    case ts.SyntaxKind.PlusToken:
      r = { lo: a.lo + b.lo, hi: a.hi + b.hi };
      break;
    case ts.SyntaxKind.MinusToken:
      r = { lo: a.lo - b.hi, hi: a.hi - b.lo };
      break;
    case ts.SyntaxKind.AsteriskToken:
      if (a.lo < 0 || b.lo < 0) return undefined;
      r = { lo: a.lo * b.lo, hi: a.hi * b.hi };
      break;
    case ts.SyntaxKind.PercentToken:
      if (a.lo < 0 || b.lo < 1) return undefined;
      r = { lo: 0, hi: Math.min(a.hi, b.hi - 1) };
      break;
    default:
      return undefined;
  }
  return r.lo >= -EXACT && r.hi <= EXACT ? r : undefined;
}

const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.PercentToken,
]);

/** The arithmetic operator of a compound assignment (`+=` is `+`). */
const COMPOUND_ARITHMETIC = new Map<ts.SyntaxKind, ts.SyntaxKind>([
  [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.PlusToken],
  [ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.MinusToken],
  [ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskToken],
  [ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.PercentToken],
]);

/** The range of the number `e` gives, from the ranges of the locals it reads. */
export function rangeOf(e: ts.Expression, cx: RangeContext): Interval {
  if (ts.isParenthesizedExpression(e)) return rangeOf(e.expression, cx);
  const array = elementRead(e, cx.opts);
  if (array) {
    if (cx.ranges.has(array)) return cx.ranges.get(array);
    const k = cx.kinds.get(array);
    return k === "i32" ? I32 : k === "u32" ? U32 : k === "i64" ? COUNTER : undefined;
  }
  if (ts.isNumericLiteral(e)) {
    const v = Number(e.text.replace(/_/g, ""));
    return Number.isInteger(v) && Math.abs(v) <= EXACT ? { lo: v, hi: v } : undefined;
  }
  if (ts.isPrefixUnaryExpression(e)) {
    if (e.operator === ts.SyntaxKind.TildeToken) return I32;
    if (e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) {
      const v = -Number(e.operand.text.replace(/_/g, ""));
      // `-0` is not an integer register value.
      return Number.isInteger(v) && v < 0 && v >= -EXACT ? { lo: v, hi: v } : undefined;
    }
    return undefined;
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (ARITHMETIC.has(op)) return arithmetic(op, rangeOf(e.left, cx), rangeOf(e.right, cx));
    switch (op) {
      case ts.SyntaxKind.AmpersandToken: {
        // A mask: `x & 0xff` is 0 to 255.
        const mask = [e.left, e.right]
          .map((x) => rangeOf(x, cx))
          .find(
            (r): r is Range =>
              typeof r === "object" && r.lo === r.hi && r.lo >= 0 && r.lo <= I32_MAX,
          );
        return mask ? { lo: 0, hi: mask.hi } : I32;
      }
      case ts.SyntaxKind.BarToken:
      case ts.SyntaxKind.CaretToken:
      case ts.SyntaxKind.LessThanLessThanToken:
      case ts.SyntaxKind.GreaterThanGreaterThanToken:
        return I32;
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
        return U32;
    }
    return undefined;
  }
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    cx.opts.isMath(e.expression.expression)
  ) {
    const name = e.expression.name.text;
    return name === "imul" ? I32 : name === "clz32" ? { lo: 0, hi: 32 } : undefined;
  }
  if (ts.isConditionalExpression(e)) return hull(rangeOf(e.whenTrue, cx), rangeOf(e.whenFalse, cx));
  if (ts.isIdentifier(e)) {
    const sym = cx.opts.checker.getSymbolAtLocation(e);
    if (!sym || cx.opts.arrays?.has(sym)) return undefined;
    if (cx.ranges.has(sym)) return cx.ranges.get(sym);
    const k = cx.kinds.get(sym);
    return k === "i32" ? I32 : k === "u32" ? U32 : k === "i64" ? COUNTER : undefined;
  }
  return undefined;
}

export interface IntegerFacts {
  locals: Map<ts.Symbol, IntKind>;
  /** `for` counters, which are i64. */
  counters: Set<ts.Symbol>;
  /** Local arrays of numbers whose elements are integers of the kind. */
  arrays: Map<ts.Symbol, IntKind>;
}

export interface InferOptions {
  checker: ts.TypeChecker;
  /** A local that may be an integer: a non-boxed number. */
  candidate: (decl: ts.VariableDeclaration, sym: ts.Symbol) => boolean;
  /** A local that may hold integer elements: a non-boxed array of numbers. */
  arrayCandidate?: (decl: ts.VariableDeclaration, sym: ts.Symbol) => boolean;
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

/**
 * The integer kind an expression produces, given the kinds of integer locals
 * (and, for arithmetic, the ranges the range analysis proved).
 */
export function writeKind(
  e: ts.Expression,
  kinds: ReadonlyMap<ts.Symbol, IntKind | "any">,
  opts: KindOptions,
  ranges: ReadonlyMap<ts.Symbol, Interval> = new Map(),
): Write {
  if (ts.isParenthesizedExpression(e)) return writeKind(e.expression, kinds, opts, ranges);
  const array = elementRead(e, opts);
  if (array) {
    const k = kinds.get(array);
    return k === "any" ? "small" : k;
  }
  if (ts.isBinaryExpression(e) && ARITHMETIC.has(e.operatorToken.kind)) {
    const r = rangeOf(e, { ranges, kinds, opts });
    return typeof r === "object" ? "i64" : undefined;
  }
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
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    opts.isMath(e.expression.expression)
  ) {
    const name = e.expression.name.text;
    return name === "imul" || name === "clz32" ? "i32" : undefined;
  }
  if (ts.isConditionalExpression(e)) {
    const a = writeKind(e.whenTrue, kinds, opts, ranges);
    const b = writeKind(e.whenFalse, kinds, opts, ranges);
    const k = join([a, b]);
    if (k === undefined) return undefined;
    if (a === k || b === k) return k;
    // Two literals stay a literal, so they still combine with either kind.
    return a === "negative" || b === "negative"
      ? "negative"
      : a === "unsigned" || b === "unsigned"
        ? "unsigned"
        : "small";
  }
  if (ts.isIdentifier(e)) {
    const sym = opts.checker.getSymbolAtLocation(e);
    const k = sym && !opts.arrays?.has(sym) ? kinds.get(sym) : undefined;
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
function isOtherWrite(id: ts.Expression): boolean {
  let n: ts.Node = id;
  let p = n.parent;
  if (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) {
    return (
      p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  // Destructuring targets: [a, b] = …, ({ a } = …), for (a of …).
  while (
    ts.isParenthesizedExpression(p) ||
    ts.isArrayLiteralExpression(p) ||
    ts.isObjectLiteralExpression(p) ||
    ts.isPropertyAssignment(p) ||
    ts.isShorthandPropertyAssignment(p) ||
    ts.isSpreadElement(p)
  ) {
    n = p;
    p = p.parent;
  }
  if (n !== id && ts.isBinaryExpression(p) && p.left === n && isAssignment(p.operatorToken.kind))
    return true;
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
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isArrayLiteralExpression(n.left) || ts.isObjectLiteralExpression(n.left))
    )
      target(n.left);
    if (
      (ts.isForOfStatement(n) || ts.isForInStatement(n)) &&
      !ts.isVariableDeclarationList(n.initializer)
    )
      target(n.initializer);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

function isFunctionBoundary(n: ts.Node): boolean {
  return ts.isFunctionLike(n) || ts.isClassLike(n);
}

/**
 * One write of a local: an expression it stores; an arithmetic compound
 * assignment or increment (`x += e` is `+` of `e`, `x++` of 1); the kind an
 * int32 compound assignment gives (`x |= e`); or anything else.
 */
type WriteOf = ts.Expression | { op: ts.SyntaxKind; right: ts.Expression | 1 } | IntKind | "other";

/** Rounds after which a range still growing (`x = x + 1`) is taken to be any double. */
const WIDEN_AFTER = 8;

/**
 * The range of each local, a fixpoint over its writes: each starts with no
 * value (EMPTY) and grows to hold what its writes can store, given the
 * others' ranges. One still growing after WIDEN_AFTER rounds is any double,
 * so the fixpoint ends (a range only grows, and any double is final).
 */
function inferRanges(
  writes: ReadonlyMap<ts.Symbol, WriteOf[]>,
  kinds: ReadonlyMap<ts.Symbol, IntKind>,
  opts: KindOptions,
): Map<ts.Symbol, Interval> {
  const ranges = new Map<ts.Symbol, Interval>([...writes.keys()].map((s) => [s, EMPTY]));
  const cx: RangeContext = { ranges, kinds, opts };
  const rangeOfWrite = (sym: ts.Symbol, w: WriteOf): Interval => {
    if (w === "other") return undefined;
    if (w === "i32") return I32;
    if (w === "u32") return U32;
    if (w === "i64") return undefined;
    if ("op" in w) {
      const right = w.right === 1 ? { lo: 1, hi: 1 } : rangeOf(w.right, cx);
      return arithmetic(w.op, ranges.get(sym), right);
    }
    return rangeOf(w, cx);
  };
  for (let round = 0, changed = true; changed; round++) {
    changed = false;
    for (const [sym, list] of writes) {
      const old = ranges.get(sym);
      if (old === undefined) continue;
      const next = list.reduce<Interval>((r, w) => hull(r, rangeOfWrite(sym, w)), EMPTY);
      const same =
        next === old ||
        (typeof next === "object" &&
          typeof old === "object" &&
          next.lo === old.lo &&
          next.hi === old.hi);
      if (!same) {
        ranges.set(sym, round < WIDEN_AFTER ? next : undefined);
        changed = true;
      }
    }
  }
  return ranges;
}

export function inferIntegers(body: ts.Node, opts: InferOptions): IntegerFacts {
  const { checker } = opts;
  const decls = new Map<ts.Symbol, ts.VariableDeclaration>();
  const arrayDecls = new Map<ts.Symbol, ts.VariableDeclaration>();
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
      if (
        sym &&
        !counters.has(sym) &&
        !destructured.has(sym) &&
        !inForOf &&
        ts.isVariableDeclarationList(list) &&
        list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const) &&
        opts.candidate(n, sym)
      )
        decls.set(sym, n);
      else if (
        sym &&
        !destructured.has(sym) &&
        !inForOf &&
        ts.isVariableDeclarationList(list) &&
        list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const) &&
        ts.isArrayLiteralExpression(n.initializer) &&
        n.initializer.elements.every((e) => !ts.isSpreadElement(e) && !ts.isOmittedExpression(e)) &&
        opts.arrayCandidate?.(n, sym)
      )
        arrayDecls.set(sym, n);
    }
    if (n !== body && isFunctionBoundary(n)) return;
    ts.forEachChild(n, collect);
  };
  collect(body);

  // Every write, including those in nested functions (a local written there
  // is boxed and was never a candidate, but reads through closures are fine).
  const writes = new Map<ts.Symbol, WriteOf[]>();
  for (const [sym, d] of decls) writes.set(sym, [d.initializer!]);
  const arrays = arrayWrites(body, arrayDecls, checker);
  for (const [sym, list] of arrays) writes.set(sym, list);
  const kindOpts: KindOptions = { checker, isMath: opts.isMath, arrays: new Set(arrays.keys()) };
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const sym = checker.getSymbolAtLocation(n);
      const list = sym && !arrays.has(sym) ? writes.get(sym) : undefined;
      if (list) {
        const p = n.parent;
        if (ts.isBinaryExpression(p) && p.left === n && isAssignment(p.operatorToken.kind)) {
          const op = p.operatorToken.kind;
          const arithmetic = COMPOUND_ARITHMETIC.get(op);
          if (op === ts.SyntaxKind.EqualsToken) list.push(p.right);
          else if (arithmetic) list.push({ op: arithmetic, right: p.right });
          else list.push(INT_COMPOUND.get(op) ?? "other");
        } else if (
          (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
          (p.operator === ts.SyntaxKind.PlusPlusToken ||
            p.operator === ts.SyntaxKind.MinusMinusToken)
        ) {
          const op =
            p.operator === ts.SyntaxKind.PlusPlusToken
              ? ts.SyntaxKind.PlusToken
              : ts.SyntaxKind.MinusToken;
          list.push({ op, right: 1 });
        } else if (isOtherWrite(n)) list.push("other");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);

  const counterKinds = new Map<ts.Symbol, IntKind>([...counters].map((c) => [c, "i64"]));
  const ranges = inferRanges(writes, counterKinds, kindOpts);

  const kinds = new Map<ts.Symbol, IntKind | "any">(
    [...decls.keys(), ...arrays.keys()].map((s) => [s, "any"]),
  );
  const withCounters = () => new Map<ts.Symbol, IntKind | "any">([...kinds, ...counterKinds]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [sym, list] of writes) {
      if (!kinds.has(sym)) continue;
      const known = withCounters();
      const ws = list.map((w): Write => {
        if (w === "other") return undefined;
        if (typeof w === "string") return w;
        if ("op" in w) return typeof ranges.get(sym) === "object" ? "i64" : undefined;
        return writeKind(w, known, kindOpts, ranges);
      });
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
  const elements = new Map<ts.Symbol, IntKind>();
  for (const [sym, k] of kinds) if (k !== "any") (arrays.has(sym) ? elements : locals).set(sym, k);
  return { locals, counters, arrays: elements };
}

/**
 * What each of `decls`, local arrays of numbers, is given: its literal's
 * elements, what it is pushed, what is assigned to an element. Only the
 * arrays nothing else sees: every other use of one (passing, returning or
 * capturing it, another method, a compound write, a write of its
 * `length`) leaves it out.
 */
function arrayWrites(
  body: ts.Node,
  decls: ReadonlyMap<ts.Symbol, ts.VariableDeclaration>,
  checker: ts.TypeChecker,
): Map<ts.Symbol, WriteOf[]> {
  const writes = new Map<ts.Symbol, WriteOf[]>();
  if (!decls.size) return writes;

  for (const [sym, d] of decls)
    writes.set(sym, [...(d.initializer as ts.ArrayLiteralExpression).elements]);
  const escaped = new Set<ts.Symbol>();

  const use = (id: ts.Identifier, sym: ts.Symbol, nested: boolean): void => {
    const list = writes.get(sym)!;
    const p = id.parent;
    if (nested) return void escaped.add(sym);
    if (ts.isPropertyAccessExpression(p) && p.expression === id && !p.questionDotToken) {
      const call = p.parent;
      if (p.name.text === "length" && !isWritten(p)) return;
      if (
        p.name.text === "push" &&
        ts.isCallExpression(call) &&
        call.expression === p &&
        !call.questionDotToken &&
        call.arguments.every((a) => !ts.isSpreadElement(a))
      ) {
        list.push(...call.arguments);
        return;
      }
    }
    if (ts.isElementAccessExpression(p) && p.expression === id && !p.questionDotToken) {
      const parent = p.parent;
      if (
        ts.isBinaryExpression(parent) &&
        parent.left === p &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        list.push(parent.right);
        return;
      }
      if (!isWritten(p)) return;
    }
    escaped.add(sym);
  };

  const visit = (n: ts.Node, nested: boolean): void => {
    if (ts.isIdentifier(n)) {
      const sym = checker.getSymbolAtLocation(n);
      if (sym && writes.has(sym) && decls.get(sym)!.name !== n) use(n, sym, nested);
      return;
    }
    ts.forEachChild(n, (c) => visit(c, nested || (c !== body && isFunctionBoundary(c))));
  };
  visit(body, false);

  for (const sym of escaped) writes.delete(sym);
  return writes;
}

/** Whether `e` is written: assigned (also by a compound operator or destructuring), counted, or deleted. */
function isWritten(e: ts.Expression): boolean {
  // `(a[i])`, `a[i]!` and `a[i] as number` are the same place.
  let n: ts.Expression = e;
  while (
    ts.isParenthesizedExpression(n.parent) ||
    ts.isNonNullExpression(n.parent) ||
    ts.isAsExpression(n.parent) ||
    ts.isTypeAssertionExpression(n.parent) ||
    ts.isSatisfiesExpression(n.parent)
  )
    n = n.parent;
  const p = n.parent;
  if (ts.isBinaryExpression(p) && p.left === n && isAssignment(p.operatorToken.kind)) return true;
  if (ts.isDeleteExpression(p)) return true;
  if (
    (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
    (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)
  )
    return true;
  return isOtherWrite(n);
}

/**
 * Whether `cond`, a `for`'s test, ends a counter stepping by `step` before
 * it passes ±2^53: `i < b` or `i <= b` (`b > i`, `b >= i`) going up, the
 * reverse going down, `b` a literal or a `length` (`size`) within bounds.
 * Each value the counter takes is then an exact integer, as the double's.
 */
function boundedBy(
  cond: ts.Expression | undefined,
  isCounter: (e: ts.Expression) => boolean,
  step: number,
  checker: ts.TypeChecker,
): boolean {
  if (!cond) return false;
  if (ts.isParenthesizedExpression(cond))
    return boundedBy(cond.expression, isCounter, step, checker);
  if (!ts.isBinaryExpression(cond)) return false;
  const op = cond.operatorToken.kind;
  const below = op === ts.SyntaxKind.LessThanToken || op === ts.SyntaxKind.LessThanEqualsToken;
  const above =
    op === ts.SyntaxKind.GreaterThanToken || op === ts.SyntaxKind.GreaterThanEqualsToken;
  if (!below && !above) return false;
  const [counter, bound, upward] = isCounter(cond.left)
    ? [cond.left, cond.right, below]
    : [cond.right, cond.left, above];
  if (!isCounter(counter) || isCounter(bound) || upward !== step > 0) return false;
  const r = boundRange(bound, checker);
  return r !== undefined && r.lo - Math.abs(step) >= -EXACT && r.hi + Math.abs(step) <= EXACT;
}

/** The range of a `for` bound: a literal's, or a string's, an array's, a map's or a set's size. */
function boundRange(e: ts.Expression, checker: ts.TypeChecker): Range | undefined {
  if (ts.isParenthesizedExpression(e)) return boundRange(e.expression, checker);
  if (ts.isPropertyAccessExpression(e) && ["length", "size"].includes(e.name.text)) {
    const t = checker.getTypeAtLocation(e.expression);
    const sized =
      t.flags & ts.TypeFlags.StringLike ||
      checker.isArrayType(t) ||
      ["Map", "Set", "ReadonlyMap", "ReadonlySet", "Uint8Array"].includes(t.symbol?.name ?? "");
    return sized ? { lo: 0, hi: U32_MAX } : undefined;
  }
  const r = rangeOf(e, {
    ranges: new Map(),
    kinds: new Map(),
    opts: { checker, isMath: () => false },
  });
  return typeof r === "object" ? r : undefined;
}

/**
 * The counter of `for (let i = <int>; …; i++)` when it can be an i64: an
 * integer start, a step of ±1 or an integer literal (toward a bound within
 * 2^53, see `boundedBy`), and no other writes.
 */
export function loopCounter(
  s: ts.ForStatement,
  checker: ts.TypeChecker,
  isBoxed: (sym: ts.Symbol) => boolean,
): ts.Symbol | undefined {
  const init = s.initializer;
  if (
    !init ||
    !ts.isVariableDeclarationList(init) ||
    !(init.flags & ts.NodeFlags.Let) ||
    init.declarations.length !== 1
  )
    return undefined;
  const d = init.declarations[0]!;
  if (!ts.isIdentifier(d.name) || !d.initializer) return undefined;
  const start = writeKind(d.initializer, new Map(), { checker, isMath: () => false });
  if (start !== "small" && start !== "negative") return undefined;
  const sym = checker.getSymbolAtLocation(d.name);
  if (!sym || isBoxed(sym)) return undefined;
  const inc = s.incrementor;
  const isCounter = (e: ts.Expression) =>
    ts.isIdentifier(e) && checker.getSymbolAtLocation(e) === sym;
  let stepOk = false;
  if (inc && (ts.isPrefixUnaryExpression(inc) || ts.isPostfixUnaryExpression(inc))) {
    stepOk =
      (inc.operator === ts.SyntaxKind.PlusPlusToken ||
        inc.operator === ts.SyntaxKind.MinusMinusToken) &&
      isCounter(inc.operand);
  } else if (
    inc &&
    ts.isBinaryExpression(inc) &&
    (inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ||
      inc.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken)
  ) {
    const step = ts.isNumericLiteral(inc.right) ? Number(inc.right.text.replace(/_/g, "")) : NaN;
    const up = inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken;
    // A step past 1 skips over 2^53, where doubles round its sums: only toward a bound short of that.
    stepOk =
      isCounter(inc.left) &&
      literalWrite(step) === "small" &&
      (step <= 1 || boundedBy(s.condition, isCounter, up ? step : -step, checker));
  }
  if (!stepOk) return undefined;
  let written = false;
  const scan = (n: ts.Node): void => {
    if (written) return;
    if (ts.isIdentifier(n) && checker.getSymbolAtLocation(n) === sym) {
      const p = n.parent;
      if (
        (ts.isBinaryExpression(p) && p.left === n && isAssignment(p.operatorToken.kind)) ||
        isOtherWrite(n)
      )
        written = true;
    }
    ts.forEachChild(n, scan);
  };
  if (s.condition) scan(s.condition);
  scan(s.statement);
  return written ? undefined : sym;
}
