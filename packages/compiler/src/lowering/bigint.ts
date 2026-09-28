/**
 * bigint operators as the runtime's lucent::BigInt spells them, shared by
 * the legacy emitter and the IR. Each has JavaScript's semantics (see
 * runtime/cpp/lucent/bigint.h): `/` truncates, `%` takes the dividend's
 * sign, `>>` rounds toward negative infinity. `>>>` has no entry:
 * JavaScript throws for it, and TypeScript rejects it.
 */
import { cpp } from "@lucent-lang/codegen";
import type { LType } from "../types.ts";

export type BigIntOperator = (left: cpp.Expr, right: cpp.Expr) => cpp.Expr;

const operator =
  (op: cpp.BinaryOp): BigIntOperator =>
  (left, right) =>
    cpp.binary(left, op, right);

export const BIGINT_OPERATORS: Readonly<Record<string, BigIntOperator | undefined>> = {
  "+": operator("+"),
  "-": operator("-"),
  "*": operator("*"),
  "/": operator("/"),
  "%": operator("%"),
  "**": (left, right) => cpp.call("lucent::BigInt::pow", [left, right]),
  "&": operator("&"),
  "|": operator("|"),
  "^": operator("^"),
  "<<": operator("<<"),
  ">>": operator(">>"),
};

/** Relational operators, between two bigints or a bigint and a number: exact, false for NaN. */
export const BIGINT_COMPARISONS: readonly string[] = ["<", ">", "<=", ">="];

/**
 * A union of numbers and bigints (`bigint | number`): neither a number nor
 * a bigint operation fits it, so the runtime operates on the kind of value
 * it holds (lucent::compareNumeric, negateNumeric, bitNotNumeric,
 * stepNumeric), as JavaScript does.
 */
export function numericUnion(t: LType): boolean {
  if (t.k !== "union") return false;

  const all = kinds(t);

  return all.includes("bigint") && all.every((k) => k === "bigint" || k === "number");
}

/** Whether a relational comparison of an `a` and a `b` compares a numeric union (lucent::compareNumeric). */
export function comparesMixed(a: LType, b: LType): boolean {
  const numeric = (t: LType) => t.k === "number" || t.k === "bigint" || numericUnion(t);

  return (numericUnion(a) || numericUnion(b)) && numeric(a) && numeric(b);
}

/** The kinds of value a type can hold: its own, or its members'. */
function kinds(t: LType): LType["k"][] {
  if (t.k === "opt") return kinds(t.inner);

  return t.k === "union" ? t.ms.flatMap(kinds) : [t.k];
}
