import { block, indent, render, type Doc } from "@lucent-lang/codegen";

/**
 * A Kotlin expression and statement tree, printed rather than concatenated.
 *
 * Deliberately not shared with the Swift tree. Kotlin has no `try` to place,
 * ranks equality below comparison where Swift puts both in one non-associative
 * group, and returns out of a lambda through a label — a common node set would
 * have to model all of that as exceptions to itself.
 */
export type KotlinExpr =
  | { readonly k: "raw"; readonly text: string }
  | { readonly k: "lit"; readonly text: string }
  | { readonly k: "ref"; readonly name: string }
  | { readonly k: "member"; readonly target: KotlinExpr; readonly name: string }
  | { readonly k: "call"; readonly callee: KotlinExpr; readonly args: readonly KotlinArg[] }
  | { readonly k: "index"; readonly target: KotlinExpr; readonly key: KotlinExpr }
  | { readonly k: "binary"; readonly op: BinaryOp; readonly left: KotlinExpr; readonly right: KotlinExpr }
  | { readonly k: "unary"; readonly op: "!" | "-"; readonly value: KotlinExpr }
  | { readonly k: "notNull"; readonly value: KotlinExpr }
  | {
      readonly k: "ifExpr";
      readonly cond: KotlinExpr;
      readonly consequent: KotlinExpr;
      readonly alternate: KotlinExpr;
    }
  | { readonly k: "lambda"; readonly lambda: KotlinLambda }
  | { readonly k: "anonFun"; readonly fn: KotlinAnonFun }
  | { readonly k: "run"; readonly body: readonly KotlinStmt[] };

export interface KotlinArg {
  readonly name?: string;
  readonly value: KotlinExpr;
}

export interface KotlinLambda {
  readonly params: readonly string[];
  readonly body: KotlinExpr;
}

export interface KotlinAnonFun {
  readonly params: readonly { readonly name: string; readonly type: string }[];
  readonly result: string;
  readonly body: readonly KotlinStmt[];
}

export type KotlinStmt =
  | { readonly k: "raw"; readonly lines: readonly string[] }
  | {
      readonly k: "let";
      readonly mutable: boolean;
      readonly name: string;
      readonly type?: string;
      readonly value: KotlinExpr;
    }
  | { readonly k: "assign"; readonly target: KotlinExpr; readonly value: KotlinExpr }
  | {
      readonly k: "if";
      readonly cond: KotlinExpr;
      readonly consequent: readonly KotlinStmt[];
      readonly alternate: readonly KotlinStmt[];
    }
  | { readonly k: "while"; readonly cond: KotlinExpr; readonly body: readonly KotlinStmt[] }
  | { readonly k: "forIn"; readonly name: string; readonly seq: KotlinExpr; readonly body: readonly KotlinStmt[] }
  /** `label` carries the `@withContext` a thread hop needs to return past its lambda. */
  | { readonly k: "return"; readonly value?: KotlinExpr; readonly label?: string }
  | { readonly k: "throwError"; readonly args: readonly KotlinArg[] }
  | { readonly k: "expr"; readonly value: KotlinExpr }
  | { readonly k: "break" }
  | { readonly k: "continue" };

export type BinaryOp = "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&&" | "||";

/**
 * Kotlin's grammar precedence, high binds tighter. Unlike Swift, comparison
 * sits above equality and both associate left.
 */
const PRECEDENCE: Record<BinaryOp, number> = {
  "||": 10,
  "&&": 20,
  "==": 30,
  "!=": 30,
  "<": 40,
  "<=": 40,
  ">": 40,
  ">=": 40,
  "+": 60,
  "-": 60,
  "*": 70,
  "/": 70,
  "%": 70,
};

/** An `if`/`else` used as a value binds loosest of all. */
const IF_EXPR = 5;
/** Prefix `-` and `!`, which a postfix `.member` or `[...]` would otherwise steal from. */
const PREFIX = 100;
const ATOM = 1000;

/**
 * A literal that already carries a sign binds like the prefix operator it
 * contains: `-128.toByte()` is `-(128.toByte())`, which is not what `(-128)`
 * as a Byte means.
 */
const levelOf = (e: KotlinExpr): number => (e.k === "lit" && e.text.startsWith("-") ? PREFIX : ATOM);

export function printExpr(e: KotlinExpr, context = 0): string {
  switch (e.k) {
    case "raw":
      return e.text;
    case "lit":
      return levelOf(e) < context ? `(${e.text})` : e.text;
    case "ref":
      return e.name;
    case "member":
      return `${printExpr(e.target, ATOM)}.${e.name}`;
    case "call":
      return `${printExpr(e.callee, ATOM)}(${e.args.map((a) => (a.name ? `${a.name} = ` : "") + printExpr(a.value)).join(", ")})`;
    case "index":
      return `${printExpr(e.target, ATOM)}[${printExpr(e.key)}]`;
    case "notNull":
      return `${printExpr(e.value, ATOM)}!!`;
    case "unary": {
      const text = `${e.op}${printExpr(e.value, PREFIX)}`;
      return PREFIX < context ? `(${text})` : text;
    }
    case "binary": {
      const level = PRECEDENCE[e.op];
      // Every binary operator here associates left, so only the right operand
      // needs parentheses at equal precedence.
      const text = `${printExpr(e.left, level)} ${e.op} ${printExpr(e.right, level + 1)}`;
      return level < context ? `(${text})` : text;
    }
    case "ifExpr": {
      const text = `if (${printExpr(e.cond)}) ${printExpr(e.consequent, IF_EXPR + 1)} else ${printExpr(e.alternate, IF_EXPR + 1)}`;
      return IF_EXPR < context ? `(${text})` : text;
    }
    case "lambda":
      return `{ ${e.lambda.params.length ? `${e.lambda.params.join(", ")} -> ` : ""}${printExpr(e.lambda.body)} }`;
    case "anonFun":
      return render(
        block(
          `fun(${e.fn.params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${e.fn.result} {`,
          printStmts(e.fn.body),
        ),
      ).trimEnd();
    case "run":
      return render(block("run {", printStmts(e.body))).trimEnd();
  }
}

export const printStmts = (stmts: readonly KotlinStmt[]): Doc => stmts.map(printStmt);

export function printStmt(s: KotlinStmt): Doc {
  switch (s.k) {
    case "raw":
      return [...s.lines];
    case "let":
      return `${s.mutable ? "var" : "val"} ${s.name}${s.type ? `: ${s.type}` : ""} = ${printExpr(s.value)}`;
    case "assign":
      return `${printExpr(s.target)} = ${printExpr(s.value)}`;
    case "if":
      return s.alternate.length
        ? [
            block(`if (${printExpr(s.cond)}) {`, printStmts(s.consequent), "} else {"),
            indent(printStmts(s.alternate)),
            "}",
          ]
        : block(`if (${printExpr(s.cond)}) {`, printStmts(s.consequent));
    case "while":
      return block(`while (${printExpr(s.cond)}) {`, printStmts(s.body));
    case "forIn":
      return block(`for (${s.name} in ${printExpr(s.seq)}) {`, printStmts(s.body));
    case "return": {
      const keyword = `return${s.label ?? ""}`;
      return s.value ? `${keyword} ${printExpr(s.value)}` : keyword;
    }
    case "throwError":
      return `throw LucentError(${s.args.map((a) => (a.name ? `${a.name} = ` : "") + printExpr(a.value)).join(", ")})`;
    case "expr":
      return printExpr(s.value);
    case "break":
    case "continue":
      return s.k;
  }
}
