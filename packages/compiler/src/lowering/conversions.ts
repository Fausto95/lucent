/**
 * How a value becomes one of another type the checker proved compatible,
 * for the representations the legacy emitter and the IR share: optionals
 * (`Opt<T>`, absent as undefined or null), unions (`std::variant`) and the
 * absent values themselves. A step names what to do next; `wrap`,
 * `unwrap` and `member` continue with another conversion, which the
 * caller plans the same way (or, for the emitter, through its own rules
 * for classes, interfaces and functions).
 */
import { type LType, sameType } from "../types.ts";

export type ConversionStep =
  /** One representation: the value itself. */
  | { kind: "same" }
  /** `void` to `undefined`: the constant. */
  | { kind: "undefined" }
  /** An optional without a value. */
  | { kind: "absent"; value: "undefined" | "null" }
  /** An optional holding the value, converted to `inner` first. */
  | { kind: "wrap"; inner: LType }
  /** What an optional holds (checked: an absent one throws a TypeError), then converted on. */
  | { kind: "unwrap"; inner: LType }
  /** A union holding the value as `member`, converted to it first. */
  | { kind: "member"; member: LType }
  /** The member a union holds (checked). */
  | { kind: "narrow" }
  /**
   * Whichever member a union holds, converted on to a type that is none of
   * them (subclasses to their base): each member's conversion is planned,
   * so one that does not exist is rejected when compiling.
   */
  | { kind: "members"; members: LType[] }
  /** Another union or optional representation, converted member by member at runtime (checked). */
  | { kind: "reshape" };

/** What the caller knows about representations. */
export interface Representations {
  /** Whether two types have one C++ representation. */
  same(a: LType, b: LType): boolean;
  /** Whether a value of `from` can be held as union member `to`. */
  fits(from: LType, to: LType): boolean;
}

const SAME: ConversionStep = { kind: "same" };

const RESHAPE: ConversionStep = { kind: "reshape" };

/** The next step converting a `from` to a `to`, or undefined when this family does not cover it. */
export function conversionStep(
  from: LType,
  to: LType,
  reps: Representations,
): ConversionStep | undefined {
  if (sameType(from, to)) return SAME;

  if (from.k !== "union" && to.k !== "union" && reps.same(from, to)) return SAME;

  if (from.k === "never" || to.k === "void" || to.k === "never") return SAME;

  if (to.k === "undefined" && (from.k === "void" || from.k === "undefined"))
    return { kind: "undefined" };

  if (to.k === "opt") return intoOptional(from, to);

  if (from.k === "opt") return { kind: "unwrap", inner: from.inner };

  if (to.k === "union") {
    if (from.k === "union") return RESHAPE;

    const member = to.ms.find((m) => sameType(m, from)) ?? to.ms.find((m) => reps.fits(from, m));

    return member && { kind: "member", member };
  }

  if (from.k === "union")
    return from.ms.some((m) => sameType(m, to) || reps.same(m, to))
      ? { kind: "narrow" }
      : { kind: "members", members: from.ms };

  return undefined;
}

function intoOptional(from: LType, to: LType & { k: "opt" }): ConversionStep {
  if (from.k === "undefined" || from.k === "void") return { kind: "absent", value: "undefined" };

  if (from.k === "null") return { kind: "absent", value: "null" };

  if (from.k === "opt") return sameType(from.inner, to.inner) ? SAME : RESHAPE;

  return { kind: "wrap", inner: to.inner };
}
