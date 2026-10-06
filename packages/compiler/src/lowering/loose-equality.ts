/**
 * Loose `==` in JavaScript converts before comparing: a boolean to a
 * number, a string to a number or a bigint, an object to a primitive (so
 * `1 == "1"`, `true == 1` and `[1] == 1` are true). Lucent's `==` compares
 * like `===`, but for null and undefined, so operands whose values it
 * would convert are refused, shared by the legacy emitter and the IR.
 */
import type { LType } from "../types.ts";

/** How loose equality treats a value of a kind: which primitive it is, or an object, or absent. */
type Loose = "number" | "string" | "boolean" | "bigint" | "object" | "absent" | "unknown";

const LOOSE: Record<Exclude<LType["k"], "opt" | "union">, Loose> = {
  number: "number",
  string: "string",
  boolean: "boolean",
  bigint: "bigint",
  void: "absent",
  undefined: "absent",
  null: "absent",
  never: "unknown",
  // Known once a generic is instantiated (emit/instantiations.ts checks it then).
  tparam: "unknown",
  array: "object",
  tuple: "object",
  map: "object",
  set: "object",
  dict: "object",
  struct: "object",
  class: "object",
  iface: "object",
  fn: "object",
  promise: "object",
  bytes: "object",
  arrayBuffer: "object",
  error: "object",
  date: "object",
  regexp: "object",
  regexMatch: "object",
  iter: "object",
  iterResult: "object",
  abortSignal: "object",
  abortController: "object",
  native: "object",
  buffer: "object",
  span: "object",
  handle: "object",
  signal: "object",
  props: "object",
  mount: "object",
};

/** The kinds `==` converts between, in the order the diagnostic names them. */
const CONVERTED: readonly Loose[] = ["bigint", "number", "string", "boolean", "object"];

function kinds(t: LType): Loose[] {
  if (t.k === "opt") return kinds(t.inner);

  return t.k === "union" ? t.ms.flatMap(kinds) : [LOOSE[t.k]];
}

/**
 * The two kinds `a == b` would convert between in JavaScript, first as
 * CONVERTED orders them, or undefined when it converts nothing: operands
 * of one kind, two objects, or null and undefined against anything.
 */
export function looseConversion(a: LType, b: LType): readonly [Loose, Loose] | undefined {
  for (const x of kinds(a))
    for (const y of kinds(b))
      if (x !== y && CONVERTED.includes(x) && CONVERTED.includes(y))
        return CONVERTED.indexOf(x) < CONVERTED.indexOf(y) ? [x, y] : [y, x];

  return undefined;
}

export function looseEqualityConverts(a: LType, b: LType): boolean {
  return looseConversion(a, b) !== undefined;
}

/** The diagnostic for a loose `==` that converts. */
export function looseConversionMessage([x, y]: readonly [Loose, Loose]): string {
  const article = (k: Loose) => (k === "object" ? "an" : "a");

  return `loose equality between ${article(x)} ${x} and ${article(y)} ${y} converts one to the other in JavaScript; convert explicitly and use ===`;
}
