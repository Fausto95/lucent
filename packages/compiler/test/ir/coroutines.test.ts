import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { body, cppOf, inOrder, module } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

const SAMPLE = `async function later(n: number): Promise<number> {
  return n;
}
export async function both(): Promise<number> {
  const a = await later(1);
  const b = await later(2);
  return a + b;
}
export async function forwarded(): Promise<number> {
  return later(3);
}
export async function fails(): Promise<number> {
  throw new Error("no");
}
export function adder(n: number): () => Promise<number> {
  return async () => n + (await later(1));
}
function* count(): Generator<number> {
  yield 1;
  yield* [2, 3];
}
export function counted(): number {
  let total = 0;
  for (const x of count()) total += x;
  return total;
}
`;

describe("coroutines in the IR", () => {
  it("awaits each promise as a suspension point of its own, in order", () => {
    const out = cppOf(module(SAMPLE));
    const both = body(out, "both");

    expect(out).toContain("lucent::Promise<double> m_sample::both() {");

    expect(both).toMatch(/double v\d+_ = co_await v\d+_;/);

    expect(inOrder(both, "later(1.0)", "co_await", "later(2.0)", "co_await", "co_return")).toBe(
      true,
    );
  });

  it("returns what a returned promise fulfils with", () => {
    const forwarded = body(cppOf(module(SAMPLE)), "forwarded");

    expect(inOrder(forwarded, "later(3.0)", "co_await", "co_return")).toBe(true);
  });

  it("stays a coroutine when it only throws, so the throw rejects its promise", () => {
    const fails = body(cppOf(module(SAMPLE)), "fails");

    expect(inOrder(fails, "lucent::throwError(", "co_return []() -> double {")).toBe(true);
  });

  it("passes an async closure's captures to its coroutine as parameters", () => {
    const adder = body(cppOf(module(SAMPLE)), "adder");

    expect(adder).toContain("[n = p0_]() -> lucent::Promise<double> {");

    expect(adder).toContain("return [](auto n) -> lucent::Promise<double> {");
  });

  it("yields each element, and each of another iterable with yield*", () => {
    const out = cppOf(module(SAMPLE));
    const header = compile([module(SAMPLE)]).files.get("m_sample.h")!;

    expect(header).toContain("lucent::Iter<double> count();");

    expect(inOrder(body(out, "count"), "co_yield 1.0;", "for (size_t", "co_yield v")).toBe(true);
  });

  it("compiles the async, async-throws, generators and using cases without a diagnostic", () => {
    for (const name of ["async", "async-throws", "generators", "using"]) {
      const r = compile([path.join(CASES, `${name}.lucent.ts`)]);

      expect(r.diagnostics).toEqual([]);
    }
  });
});
