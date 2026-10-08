import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { body, cppOf, inOrder, module } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

describe("exceptions in the IR", () => {
  it("catches what the block throws as an Error, letting a generator's return through", () => {
    const file = module(`function risky(n: number): number {
  if (n < 0) throw new RangeError("negative");
  return n;
}
export function safe(n: number): string {
  try {
    return String(risky(n));
  } catch (e) {
    return (e as Error).message;
  }
}
`);
    const safe = body(cppOf(file), "safe");

    expect(safe).toContain("catch (const lucent::GeneratorReturn&) {");

    expect(safe).toMatch(/lucent::Error v\d+_ = lucent::currentError\(ex\d+_\);/);
  });

  it("runs a finally before a return, break or continue past it, then does what left", () => {
    const file = module(`const log: string[] = [];
export function walk(xs: number[]): number {
  for (const x of xs) {
    try {
      if (x < 0) continue;
      if (x === 0) break;
      if (x > 9) return x;
    } finally {
      log.push(String(x));
    }
  }
  return -1;
}
`);
    const walk = body(cppOf(file), "walk");

    expect(walk).toContain("double ret_{};");

    expect(walk).toContain("goto fin0_;");

    expect(inOrder(walk, "fin0_:", "std::rethrow_exception(fc0ex_);", "if (fc0_ == 1) {")).toBe(
      true,
    );
  });

  it("throws an object of an Error subclass as itself", () => {
    const file = module(`class Invalid extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}
export function check(field: string): string {
  try {
    throw new Invalid(field);
  } catch (e) {
    return e instanceof Invalid ? e.field : "other";
  }
}
`);
    const check = body(cppOf(file), "check");

    expect(check).toMatch(
      /lucent::Ref<lucent_app::C_Invalid> (v\d+_) = lucent_app::C_Invalid::create\(p0_\);\n\s*lucent::throwError\(\1\);/,
    );

    expect(check).toContain("lucent::downcast<lucent_app::C_Invalid>(");
  });

  it("disposes using declarations in reverse, suppressing an error a pending one causes", () => {
    const file = module(`class Resource {
  constructor(readonly name: string) {}
  [Symbol.dispose](): void {}
}
export function scoped(): string {
  using a = new Resource("a");
  using b = new Resource("b");
  return a.name + b.name;
}
`);
    const scoped = body(cppOf(file), "scoped");

    expect(scoped).toContain("lucent::suppressedError(std::current_exception(), fc1ex_)");

    expect(inOrder(scoped, "fin1_:", "fin0_:")).toBe(true);
  });

  it("compiles the errors, control and absent-results cases without a diagnostic", () => {
    for (const name of ["errors", "control", "absent-results"]) {
      const r = compile([path.join(CASES, `${name}.lucent.ts`)]);

      expect(r.diagnostics).toEqual([]);
    }
  });
});
