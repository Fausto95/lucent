import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { body, cppOf, inOrder, module } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

describe("leaves of the IR", () => {
  it("computes a method call's operands first, in order, each in a statement of its own", () => {
    const file = module(`const log: string[] = [];
function note(s: string): string {
  log.push(s);
  return s;
}
export function run(xs: number[]): number {
  xs.push(note("a").length, note("b").length);
  return xs.length + log.length;
}
`);
    const run = body(cppOf(file), "run");

    expect(run).toMatch(
      /^ {2}lucent::String v\d+_ = lucent_app::m_sample::note\(LUCENT_STR\("a"\)\);$/m,
    );

    expect(run).toMatch(
      /^ {2}lucent::String v\d+_ = lucent_app::m_sample::note\(LUCENT_STR\("b"\)\);$/m,
    );

    expect(inOrder(run, 'note(LUCENT_STR("a"))', 'note(LUCENT_STR("b"))', ".push(")).toBe(true);
  });

  it("reads a field before the right side of a compound assignment runs", () => {
    const file = module(`interface Box {
  n: number;
}
function bump(b: Box): number {
  b.n = 50;
  return 1;
}
export function add(): number {
  const b: Box = { n: 1 };
  b.n += bump(b);
  return b.n;
}
`);
    const add = body(cppOf(file), "add");

    expect(inOrder(add, "->n;", "m_sample::bump(", "->n = ")).toBe(true);
  });

  it("gives a conditional the type it becomes, each branch converted to it", () => {
    const file = module(`class Shape {}
class Circle extends Shape {}
export function pick(round: boolean): number {
  const s: Shape | string = round ? new Circle() : "none";
  return typeof s === "string" ? 0 : 1;
}
`);
    const pick = body(cppOf(file), "pick");

    expect(pick).toContain("std::static_pointer_cast<lucent_app::C_Shape>");

    expect(pick).not.toContain("lucent::convert<");
  });

  it("keeps platform code out of a build for neither platform", () => {
    const file = module(`import { PLATFORM } from "lucent:platform";
export function name(): string {
  if (PLATFORM === "ios") {
    return "iPhone";
  }
  return PLATFORM === "android" ? "Pixel" : "other";
}
export function model(): string {
  return PLATFORM === "android" ? "Pixel" : "other";
}
`);
    const name = body(cppOf(file, "host"), "name");

    expect(name).toContain("lucent::platformOnly<void>(");

    expect(name).not.toContain("iPhone");

    expect(name).not.toContain("Pixel");

    const model = body(cppOf(file, "host"), "model");

    expect(model).toContain("lucent::platformOnly<lucent::String>(");

    expect(model).not.toContain("Pixel");
  });

  it("compiles only the branch, case and code after a guard clause the platform runs", () => {
    const file = module(`import { PLATFORM } from "lucent:platform";
export function name(): string {
  if (PLATFORM === "ios") return "iPhone";
  switch (PLATFORM) {
    case "android":
      return PLATFORM === "android" ? "Pixel" : "nothing";
  }
  return "elsewhere";
}
`);
    const name = body(cppOf(file, "android"), "name");

    expect(name).toContain("Pixel");

    expect(name).not.toContain("iPhone");

    expect(name).not.toContain("nothing");
  });

  it("compiles the bigint arithmetic case without a diagnostic", () => {
    const file = path.join(CASES, "bigint-arith.lucent.ts");
    const r = compile([file]);

    expect(r.diagnostics).toEqual([]);
  });

  it("takes a reduce's initial value, whatever it is, before the callback runs", () => {
    const file = module(`export function total(xs: number[], o: { n: number }): number {
  return xs.reduce((a, c) => a + c, o.n);
}
`);
    const total = body(cppOf(file), "total");

    // The callback is still the lambda the method's template calls directly.
    expect(inOrder(total, "p1_->n", ".reduce([](double p0_")).toBe(true);
  });

  it("lets a callback be made after operands that run code", () => {
    const file = module(`let n = 0;
function bump(): number {
  return ++n;
}
export function f(xs: number[]): number {
  return xs.reduce((a, c) => a + c + bump(), bump());
}
`);
    // The callback comes first in the source, but making it runs none of its code.
    expect(compile([file]).diagnostics).toEqual([]);
  });
});
