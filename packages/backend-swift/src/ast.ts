import { block, indent, render, type Doc } from "@lucent-lang/codegen";

/**
 * A Swift expression and statement tree, printed rather than concatenated.
 *
 * Two things this buys over building text directly. Effects are computed by an
 * exhaustive walk, so a call nested in any expression shape still gets its
 * `try` — the text emitter skipped conditionals and produced Swift that did
 * not compile. And parentheses come from precedence, so `a + b * c` no longer
 * has to be written `(a + (b * c))` to be safe.
 */
export type SwiftExpr =
  | { readonly k: "raw"; readonly text: string }
  | { readonly k: "lit"; readonly text: string }
  | { readonly k: "ref"; readonly name: string }
  | { readonly k: "member"; readonly target: SwiftExpr; readonly name: string }
  | { readonly k: "call"; readonly callee: SwiftExpr; readonly args: readonly SwiftArg[]; readonly effect?: Effect }
  | { readonly k: "subscript"; readonly target: SwiftExpr; readonly index: SwiftExpr }
  | { readonly k: "binary"; readonly op: BinaryOp; readonly left: SwiftExpr; readonly right: SwiftExpr }
  | { readonly k: "unary"; readonly op: "!" | "-"; readonly value: SwiftExpr }
  | { readonly k: "force"; readonly value: SwiftExpr }
  | { readonly k: "ternary"; readonly cond: SwiftExpr; readonly consequent: SwiftExpr; readonly alternate: SwiftExpr }
  | { readonly k: "closure"; readonly closure: SwiftClosure }
  | { readonly k: "array"; readonly elements: readonly SwiftExpr[] }
  | { readonly k: "dict"; readonly entries: readonly (readonly [SwiftExpr, SwiftExpr])[] };

export interface SwiftArg {
  readonly label?: string;
  readonly value: SwiftExpr;
}

export interface SwiftClosure {
  readonly captures: readonly string[];
  readonly params: readonly { readonly name: string; readonly type: string }[];
  readonly result?: string;
  readonly throws: boolean;
  readonly body: readonly SwiftStmt[] | SwiftExpr;
}

export type SwiftStmt =
  | { readonly k: "raw"; readonly lines: readonly string[] }
  | {
      readonly k: "let";
      readonly mutable: boolean;
      readonly name: string;
      readonly type?: string;
      readonly value: SwiftExpr;
    }
  | { readonly k: "assign"; readonly target: SwiftExpr; readonly value: SwiftExpr }
  | {
      readonly k: "if";
      readonly cond: SwiftExpr;
      readonly consequent: readonly SwiftStmt[];
      readonly alternate: readonly SwiftStmt[];
    }
  | { readonly k: "while"; readonly cond: SwiftExpr; readonly body: readonly SwiftStmt[] }
  | { readonly k: "forIn"; readonly name: string; readonly seq: SwiftExpr; readonly body: readonly SwiftStmt[] }
  | { readonly k: "return"; readonly value?: SwiftExpr }
  | { readonly k: "throwError"; readonly args: readonly SwiftArg[] }
  | { readonly k: "discard"; readonly value: SwiftExpr }
  | { readonly k: "expr"; readonly value: SwiftExpr }
  | { readonly k: "break" }
  | { readonly k: "continue" };

export type BinaryOp =
  | "+"
  | "&+"
  | "-"
  | "&-"
  | "*"
  | "&*"
  | "/"
  | "%"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||";

/** Nothing, a throwing call, or a throwing call that also suspends. */
export type Effect = "none" | "throws" | "async";

const STRONGER: Record<Effect, number> = { none: 0, throws: 1, async: 2 };
const strongest = (effects: readonly Effect[]): Effect =>
  effects.reduce((a, b) => (STRONGER[b] > STRONGER[a] ? b : a), "none" as Effect);

/** Swift's own precedence groups; a higher number binds tighter. */
const PRECEDENCE: Record<BinaryOp, number> = {
  "||": 110,
  "&&": 120,
  "==": 130,
  "!=": 130,
  "<": 130,
  "<=": 130,
  ">": 130,
  ">=": 130,
  "+": 140,
  "&+": 140,
  "-": 140,
  "&-": 140,
  "*": 150,
  "&*": 150,
  "/": 150,
  "%": 150,
};

const TERNARY = 100;
const ATOM = 1000;

/** Comparison is the one non-associative group; everything else here associates left. */
const NON_ASSOCIATIVE = new Set<BinaryOp>(["==", "!=", "<", "<=", ">", ">="]);

/**
 * Whether evaluating this expression can throw or suspend.
 *
 * The switch is exhaustive by construction: a new node kind fails to compile
 * here rather than silently returning "none" and losing its `try`.
 */
export function effect(e: SwiftExpr): Effect {
  switch (e.k) {
    case "raw":
    case "lit":
    case "ref":
      return "none";
    // A closure's own effects belong to its call site, not to building it.
    case "closure":
      return "none";
    case "call":
      return strongest([e.effect ?? "none", effect(e.callee), ...e.args.map((a) => effect(a.value))]);
    case "member":
      return effect(e.target);
    case "subscript":
      return strongest([effect(e.target), effect(e.index)]);
    case "binary":
      return strongest([effect(e.left), effect(e.right)]);
    case "unary":
    case "force":
      return effect(e.value);
    case "ternary":
      return strongest([effect(e.cond), effect(e.consequent), effect(e.alternate)]);
    case "array":
      return strongest(e.elements.map(effect));
    case "dict":
      return strongest(e.entries.flatMap(([key, value]) => [effect(key), effect(value)]));
  }
}

/** `try ` / `try await ` for a whole expression; Swift rejects `try` inside an operator. */
export const effectPrefix = (e: SwiftExpr): string => ({ none: "", throws: "try ", async: "try await " })[effect(e)];

/** An expression with its effect keyword, as a statement's right-hand side. */
export const topLevel = (e: SwiftExpr): string => effectPrefix(e) + printExpr(e);

export function printExpr(e: SwiftExpr, context = 0): string {
  switch (e.k) {
    case "raw":
    case "lit":
      return e.text;
    case "ref":
      return e.name;
    case "member":
      return `${printExpr(e.target, ATOM)}.${e.name}`;
    case "call":
      return `${printExpr(e.callee, ATOM)}(${e.args.map((a) => (a.label ? `${a.label}: ` : "") + printExpr(a.value)).join(", ")})`;
    case "subscript":
      return `${printExpr(e.target, ATOM)}[${printExpr(e.index)}]`;
    case "force":
      return `${printExpr(e.value, ATOM)}!`;
    case "unary":
      return `${e.op}${printExpr(e.value, ATOM)}`;
    case "array":
      return `[${e.elements.map((x) => printExpr(x)).join(", ")}]`;
    case "dict":
      return `[${e.entries.map(([key, value]) => `${printExpr(key)}: ${printExpr(value)}`).join(", ")}]`;
    case "binary": {
      const level = PRECEDENCE[e.op];
      /**
       * Left-associative: the left operand may share this precedence, the right
       * may not. `total / (columns * rows)` re-associates into
       * `(total / columns) * rows` if the right operand loses its parentheses —
       * still valid Swift, and a different number.
       */
      const left = printExpr(e.left, NON_ASSOCIATIVE.has(e.op) ? level + 1 : level);
      const text = `${left} ${e.op} ${printExpr(e.right, level + 1)}`;
      return level < context ? `(${text})` : text;
    }
    case "ternary": {
      const text = `${printExpr(e.cond, TERNARY + 1)} ? ${printExpr(e.consequent)} : ${printExpr(e.alternate)}`;
      return TERNARY < context ? `(${text})` : text;
    }
    case "closure":
      return printClosure(e.closure);
  }
}

function printClosure(c: SwiftClosure): string {
  const captures = c.captures.length ? `[${c.captures.join(", ")}] ` : "";
  const params = c.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const head = `{ ${captures}(${params})${c.throws ? " throws" : ""}${c.result ? ` -> ${c.result}` : ""} in`;
  if (!Array.isArray(c.body)) return `${head} ${topLevel(c.body as SwiftExpr)} }`;
  // The renderer re-anchors the whole fragment wherever it lands.
  return render(block(head, printStmts(c.body as readonly SwiftStmt[]))).trimEnd();
}

export const printStmts = (stmts: readonly SwiftStmt[]): Doc => stmts.map(printStmt);

export function printStmt(s: SwiftStmt): Doc {
  switch (s.k) {
    case "raw":
      return [...s.lines];
    case "let":
      return `${s.mutable ? "var" : "let"} ${s.name}${s.type ? `: ${s.type}` : ""} = ${topLevel(s.value)}`;
    case "assign":
      return `${printExpr(s.target)} = ${topLevel(s.value)}`;
    case "if":
      return s.alternate.length
        ? [
            block(`if ${condition(s.cond)} {`, printStmts(s.consequent), "} else {"),
            indent(printStmts(s.alternate)),
            "}",
          ]
        : block(`if ${condition(s.cond)} {`, printStmts(s.consequent));
    case "while":
      return block(`while ${condition(s.cond)} {`, printStmts(s.body));
    case "forIn":
      return block(`for ${s.name} in ${topLevel(s.seq)} {`, printStmts(s.body));
    case "return":
      return s.value ? `return ${topLevel(s.value)}` : "return";
    case "throwError":
      return `throw LucentError(${s.args.map((a) => (a.label ? `${a.label}: ` : "") + effectPrefix(a.value) + printExpr(a.value)).join(", ")})`;
    case "discard":
      return `_ = ${topLevel(s.value)}`;
    case "expr":
      return topLevel(s.value);
    case "break":
    case "continue":
      return s.k;
  }
}

/** A condition needs no outer parentheses: `if` already delimits it. */
const condition = (e: SwiftExpr): string => effectPrefix(e) + printExpr(e);
