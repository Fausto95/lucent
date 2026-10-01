import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { coverage } from "../../src/ir/cpp.ts";
import { cppOf, module, withLowering } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

const SAMPLE = `async function later(n: number): Promise<number> {
  return n;
}
export class Counter {
  private count = 0;
  static made = 0;
  constructor(readonly step: number) {}
  bump(): number {
    this.count += this.step;
    return this.count;
  }
  get doubled(): number {
    return this.count * 2;
  }
  scaled(xs: number[]): number[] {
    return xs.map((x) => x * this.step);
  }
  async slow(): Promise<number> {
    return this.count + (await later(1));
  }
  static zero(): Counter {
    return new Counter(0);
  }
}
`;

/** A member's definition in `cpp`, from its signature to its closing brace. */
function member(cpp: string, name: string): string {
  const start = cpp.search(new RegExp(`C_Counter::${name}\\(.*\\) \\{$`, "m"));

  expect(start).toBeGreaterThanOrEqual(0);

  return cpp.slice(start, cpp.indexOf("\n}\n", start) + 2);
}

describe("methods in the IR", () => {
  it("lowers methods, accessors and static methods through the IR", () => {
    const before = coverage.lowered.length;
    const out = cppOf(module(SAMPLE), "ir-strict");
    const lowered = coverage.lowered.slice(before);

    for (const name of ["bump", "get_doubled", "scaled", "slow", "zero"])
      expect(lowered).toContain(`C_Counter::${name}`);

    expect(member(out, "bump")).toMatch(/double v\d+_ = this->count;/);
  });

  it("captures this as self in a closure of a method", () => {
    const scaled = member(cppOf(module(SAMPLE), "ir-strict"), "scaled");

    expect(scaled).toMatch(/\[self = v\d+_\]/);

    expect(scaled).toContain("self->step");
  });

  it("keeps an async method's object alive in its coroutine frame", () => {
    const slow = member(cppOf(module(SAMPLE), "ir-strict"), "slow");

    expect(slow).toMatch(/^C_Counter::slow\(\) \{\n {2}auto self = lucent::selfRef\(this\);/);

    expect(slow).toMatch(/double v\d+_ = co_await v\d+_;/);
  });

  it("compiles the classes, inheritance and interfaces cases through the IR alone under ir-strict", () => {
    for (const name of ["classes", "inheritance", "interfaces"]) {
      const r = withLowering("ir-strict", () => compile([path.join(CASES, `${name}.lucent.ts`)]));

      expect(r.diagnostics).toEqual([]);
    }
  });
});
