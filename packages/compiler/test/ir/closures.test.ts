import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { body, cppOf, module, withLowering } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

describe("closures in the IR", () => {
  it("makes a lambda of an arrow function, capturing a copy of what it reads", () => {
    const file = module(`export function adder(n: number): (x: number) => number {
  return (x) => x + n;
}
`);
    const adder = body(cppOf(file, "ir-strict"), "adder");

    expect(adder).toContain("lucent::Fn<double(double)>([n = p0_](double p0_) mutable -> double {");
  });

  it("shares a variable closures write in a box", () => {
    const file = module(`export function counter(): number {
  let count = 0;
  const bump = (): void => {
    count++;
  };
  bump();
  bump();
  return count;
}
`);
    const counter = body(cppOf(file, "ir-strict"), "counter");

    expect(counter).toContain("lucent::Box<double> count{};");

    expect(counter).toContain("[count = count]");

    expect(counter).toContain("*count = ");
  });

  it("gives each iteration of a for loop its own copy of a let closures capture", () => {
    const file = module(`export function late(): number[] {
  const fs: (() => number)[] = [];
  for (let i = 0; i < 3; i++) fs.push(() => i);
  return fs.map((f) => f());
}
`);
    const late = body(cppOf(file, "ir-strict"), "late");

    expect(late).toContain("lucent::Box<double> i_it{};");

    expect(late).toContain("[i = i_it]");
  });

  it("hoists nested function declarations, and lets a recursive arrow call itself", () => {
    const file = module(`export function twiceFib(n: number): number {
  const fib = (k: number): number => (k < 2 ? k : fib(k - 1) + fib(k - 2));
  return twice(fib(n));
  function twice(x: number): number {
    return x * 2;
  }
}
`);
    const fn = body(cppOf(file, "ir-strict"), "twiceFib");

    expect(fn.indexOf("lucent::Box<lucent::Fn<double(double)>> twice{};")).toBeLessThan(
      fn.indexOf("fib"),
    );

    expect(fn).toContain("[fib = fib]");
  });

  it("passes a callback to a builtin as a closure", () => {
    const file = module(`export function scaled(xs: number[], k: number): number[] {
  return xs.map((x) => x * k);
}
`);
    const scaled = body(cppOf(file, "ir-strict"), "scaled");

    expect(scaled).toMatch(/\.template map<double>\(v\d+_\)/);

    expect(scaled).toContain("[k = p1_]");
  });

  it("gives a call that never returns a value no code uses", () => {
    const file = module(`function fail(why: string): never {
  throw new Error(why);
}
export function pick(ok: boolean): number {
  return ok ? 1 : fail("no");
}
`);
    const pick = body(cppOf(file, "ir-strict"), "pick");

    expect(pick).toContain("lucent::unreachable();");
  });

  it("gives a defaulted parameter its default when the argument is undefined", () => {
    const file = module(`export function seeded(seed: number = 7): number {
  return seed + 1;
}
`);
    const seeded = body(cppOf(file, "ir-strict"), "seeded");

    expect(seeded).toContain("lucent::Opt<double> p0_");

    expect(seeded).toMatch(
      /if \(v\d+_\) \{\n {4}seed = 7\.0;\n {2}\} else \{\n {4}double v\d+_ = p0_\.value\(\);/,
    );
  });

  it("gives a destructured parameter its default when the argument is undefined", () => {
    const file = module(`export function first({ a }: { a: number } = { a: 1 }): number {
  return a;
}
`);
    const first = body(cppOf(file, "ir-strict"), "first");

    expect(first).toMatch(/if \(v\d+_\) \{\n.*make_shared/);

    expect(first).toContain("p0_.value()");
  });

  it("compiles the closures case through the IR alone under ir-strict", () => {
    const file = path.join(CASES, "closures.lucent.ts");
    const r = withLowering("ir-strict", () => compile([file]));

    expect(r.diagnostics).toEqual([]);
  });
});
