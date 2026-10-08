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

describe("integer elements", () => {
  const cpp = cppOf(CASE);

  it("holds a table of uint32 values as uint32s, read without ToInt32", () => {
    const fn = body(cpp, "crc");

    expect(fn).toContain("lucent::Array<uint32_t> table = ");

    expect(fn).not.toContain("lucent::toInt32");
  });

  it("holds int32 and uint32 values alike, and bounded sums, as int64s", () => {
    expect(body(cpp, "intElements")).toContain("lucent::Array<int64_t> t = ");

    const bounded = body(cpp, "boundedElements");

    expect(bounded).toContain("lucent::Array<int64_t> xs = ");

    expect(bounded).toContain("int64_t x = ");
  });

  it("keeps doubles for an array anything but push, an index or length sees", () => {
    const file = module(`export function seen(xs: number[]): number {
  const captured: number[] = [1];
  const read = () => captured[0]!;
  const aliased: number[] = [1];
  const alias = aliased;
  const iterated: number[] = [1];
  let sum = 0;
  for (const x of iterated) sum += x;
  const shrunk: number[] = [1];
  shrunk.length = 0;
  const added: number[] = [1];
  added[0]! += 1;
  const counted: number[] = [1];
  counted[0]!++;
  const asserted: number[] = [1];
  asserted[0]! = 0.5;
  const wrapped: number[] = [1];
  [wrapped[0]!] = [0.5];
  const spread: number[] = [1];
  spread.push(...xs);
  const destructured: number[] = [1];
  [destructured[0]] = [2];
  let replaced: number[] = [1];
  replaced = [2];
  const optional: number[] = [1];
  const o = optional?.[0];
  return read() + alias.length + sum + shrunk.length + added[0]! + counted[0]! + spread.length +
    destructured[0]! + replaced[0]! + (o ?? 0) + asserted[0]! + wrapped[0]!;
}
`);
    const fn = body(cppOf(file), "seen");

    expect(fn).not.toMatch(/Array<u?int/);
  });

  it("keeps doubles for what could be -0, a fraction or past 2^53, and for an array that escapes", () => {
    const fn = body(cpp, "doubleElements");

    for (const name of ["zeros", "halves", "big", "products", "shared"])
      expect(fn).toContain(`lucent::Array<double> ${name} = `);
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

describe("string appends and template literals", () => {
  const cpp = cppOf(CASE);

  it("appends to a field and a module variable in place, from what was read first", () => {
    expect(body(cpp, "add")).toMatch(/lucent::appendTo\(this->text, std::move\(v\d+_\), /);

    expect(body(cpp, "appends")).toMatch(/lucent::appendTo\(lucent_app::m_\w+::journal, /);
  });

  it("builds a template literal with one concatenation", () => {
    const fn = body(cpp, "appends");

    expect(fn).toMatch(/lucent::concat\(LUCENT_STR\("<"\), [^;]*LUCENT_STR\(">"\)\)/);

    expect(fn).not.toContain("lucent::String(lucent::String(");
  });
});

describe("for counters", () => {
  const cpp = cppOf(CASE);

  it("keeps a counter a double where a step past 1 could take it past 2^53", () => {
    const fn = body(cpp, "pastExact");

    expect(fn).not.toContain("int64_t i = ");
  });

  it("keeps a counter stepping by 1, or toward a bound within 2^53, an int64", () => {
    expect(body(cpp, "boundedSum")).toContain("int64_t i = ");

    const file = module(`export function stepped(xs: number[]): number {
  let t = 0;
  for (let i = 0; i < 1000; i += 7) t += i;
  for (let i = 0; i < xs.length; i += 2) t += xs[i]!;
  for (let i = 100; i > 0; i -= 3) t += i;
  return t;
}
`);
    const fn = body(cppOf(file), "stepped");

    expect(fn.match(/int64_t i = /g)).toHaveLength(3);
  });
});
