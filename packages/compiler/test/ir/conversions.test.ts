import { describe, expect, it } from "vite-plus/test";
import { conversionStep, type Representations } from "../../src/lowering/conversions.ts";
import { type LType, sameType, T } from "../../src/types.ts";

const opt = (inner: LType): LType => ({ k: "opt", inner });

const union = (...ms: LType[]): LType => ({ k: "union", ms });

/** Representations as the IR knows them: a type is only its own. */
const exact: Representations = { same: sameType, fits: sameType };

describe("conversion planning", () => {
  it("keeps a value whose representation does not change", () => {
    expect(conversionStep(T.number, T.number, exact)).toEqual({ kind: "same" });

    expect(conversionStep(T.never, T.string, exact)).toEqual({ kind: "same" });

    expect(conversionStep(T.string, T.void, exact)).toEqual({ kind: "same" });

    expect(conversionStep(T.void, T.undefined, exact)).toEqual({ kind: "undefined" });
  });

  it("wraps values into optionals, absent or present", () => {
    expect(conversionStep(T.undefined, opt(T.number), exact)).toEqual({
      kind: "absent",
      value: "undefined",
    });

    expect(conversionStep(T.null, opt(T.number), exact)).toEqual({ kind: "absent", value: "null" });

    expect(conversionStep(T.number, opt(T.number), exact)).toEqual({
      kind: "wrap",
      inner: T.number,
    });

    expect(conversionStep(opt(T.number), opt(union(T.number, T.string)), exact)).toEqual({
      kind: "reshape",
    });
  });

  it("unwraps optionals the checker narrowed, then converts what they hold", () => {
    expect(conversionStep(opt(T.number), T.number, exact)).toEqual({
      kind: "unwrap",
      inner: T.number,
    });

    expect(conversionStep(opt(union(T.number, T.string)), T.string, exact)).toEqual({
      kind: "unwrap",
      inner: union(T.number, T.string),
    });
  });

  it("moves values into and out of unions", () => {
    const u = union(T.number, T.string);

    expect(conversionStep(T.string, u, exact)).toEqual({ kind: "member", member: T.string });

    expect(conversionStep(u, T.string, exact)).toEqual({ kind: "narrow" });

    expect(conversionStep(u, union(T.boolean, T.number, T.string), exact)).toEqual({
      kind: "reshape",
    });

    // A type no member is: each member's conversion is planned, and one that does not exist fails.
    expect(conversionStep(u, T.boolean, exact)).toEqual({
      kind: "members",
      members: [T.number, T.string],
    });

    expect(conversionStep(T.boolean, u, exact)).toBeUndefined();
  });

  it("finds a union member by representation when no member is the same type", () => {
    const shared: Representations = { same: sameType, fits: (a, b) => a.k === b.k };
    const base: LType = { k: "class", id: "Base", args: [] };
    const derived: LType = { k: "class", id: "Derived", args: [] };

    expect(conversionStep(derived, union(base, T.string), shared)).toEqual({
      kind: "member",
      member: base,
    });
  });

  it("leaves other conversions to the caller", () => {
    expect(conversionStep(T.number, T.string, exact)).toBeUndefined();

    expect(conversionStep(T.boolean, T.number, exact)).toBeUndefined();
  });
});
