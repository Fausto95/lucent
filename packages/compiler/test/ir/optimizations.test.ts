import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { body, cppOf, module } from "./compile.ts";

// T54's optimizations, case by case: code each applies to and similar code it must leave alone.
// e2e/cases/optimizations.lucent.ts runs the same functions against JavaScript.
const CASE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../e2e/cases/optimizations.lucent.ts",
);

describe("proven integer arithmetic", () => {
  const cpp = cppOf(CASE);

  it("keeps a bounded remainder in an int64, computing its writes in int64", () => {
    const fn = body(cpp, "boundedSum");

    expect(fn).toContain("int64_t sum = ");

    expect(fn).toMatch(
      /sum = \(static_cast<int64_t>\(sum\) \+ static_cast<int64_t>\(.*\)\) % static_cast<int64_t>\(1000000007\);/,
    );

    expect(fn).not.toContain("lucent::jsMod");
  });

  it("proves products of non-negative bounded values, and a compound remainder", () => {
    const fn = body(cpp, "compound");

    expect(fn).toContain("int64_t p = ");

    expect(fn).toContain("int64_t m = ");
  });

  it("keeps a double where statement order would be needed to bound it", () => {
    const fn = body(cpp, "compound");

    expect(fn).toContain("double acc = ");

    expect(fn).toContain("double grows = ");
  });

  it("keeps a double where a remainder or a product could be -0, or NaN", () => {
    expect(body(cpp, "negativeRemainder")).toContain("double r = ");

    const signed = body(cpp, "signedProducts");

    expect(signed).toContain("double a = ");

    expect(signed).toContain("double b = ");
  });

  it("keeps a double that grows without bound, or past 2^53", () => {
    const fn = body(cpp, "unbounded");

    expect(fn).toContain("double big = ");

    expect(fn).toContain("double c = ");

    expect(fn).toContain("double near = ");
  });

  it("keeps a double that is sometimes fractional", () => {
    expect(body(cpp, "sometimesFractional")).toContain("double t = ");
  });

  it("widens a range that keeps growing rather than looping", () => {
    const file = module(`export function count(n: number): number {
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    a = b + 1;
    b = a + 1;
  }
  return a + b;
}
`);
    const fn = body(cppOf(file), "count");

    expect(fn).toContain("double a = ");

    expect(fn).toContain("double b = ");
  });
});

describe("devirtualized callbacks", () => {
  const cpp = cppOf(CASE);

  it("passes an arrow function straight to a runtime method as its lambda", () => {
    const fn = body(cpp, "directCallbacks");

    for (const method of ["sort", "template map<double>", "filter", "forEach", "find", "some"])
      expect(fn).toContain(`.${method}([`);

    expect(fn).not.toContain("lucent::Fn<");
  });

  it("keeps a function value that is stored and used again", () => {
    const fn = body(cpp, "keptCallbacks");

    expect(fn).toMatch(/lucent::Fn<double\(double, double\)> byValue = /);

    expect(fn).toContain(".sort(byValue)");
  });

  it("keeps a function value for a coroutine, and for a callback a plan does not pass straight", () => {
    const file = module(`export function later(xs: number[]): Promise<number>[] {
  return xs.map(async (x) => x + 1);
}
export function picked(xs: number[]): number[] {
  return xs.filter((x) => x);
}
`);
    const cpp = cppOf(file);

    expect(body(cpp, "later")).toContain("lucent::Fn<");

    // filter's callback returns a number: a lambda testing it for truthiness wraps it.
    expect(body(cpp, "picked")).toContain("lucent::Fn<");
  });
});
