import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

const PRELUDE = `
function pick<A, B>(first: boolean, a: A, b: B): A | B {
  return first ? a : b;
}

function orNull<T>(x: T | null): string {
  return x === null ? "null" : String(x);
}

function num(v?: number): number | undefined {
  return v;
}
`;

function diagnostics(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-union-generics-"));
  const file = path.join(dir, "sample.lucent.ts");

  fs.writeFileSync(file, `${PRELUDE}\n${body}`);

  return compile([file]).diagnostics.map((d) => ({ code: d.code, message: d.message }));
}

const refused = [{ code: "LUCENT2002", message: expect.stringContaining("in a union") }];

// A generic compiles once, as a C++ template: a union holding its type
// parameter must stay that union once instantiated. A type argument that
// would merge into it (a union, an optional, null or undefined, or a type
// the union already holds) is refused.
describe("type parameters in unions", () => {
  it("refuses a type argument that merges into the union", () => {
    expect(
      diagnostics(
        "export function f(): string { return String(pick<number | undefined, string>(true, num(), 'a')); }",
      ),
    ).toEqual(refused);

    expect(
      diagnostics(
        "export function f(): string { return String(pick<number | string, boolean>(true, 1, false)); }",
      ),
    ).toEqual(refused);

    expect(
      diagnostics(
        "export function f(): string { return String(pick<number, number>(true, 1, 2)); }",
      ),
    ).toEqual(refused);

    expect(
      diagnostics("export function f(): string { return orNull<number | undefined>(num()); }"),
    ).toEqual(refused);
  });

  it("accepts type arguments that keep the union", () => {
    expect(
      diagnostics(
        "export function f(): string { return [pick<string, number>(true, 'a', 1), orNull<number | string>(1), orNull<number[]>(null)].join(); }",
      ),
    ).toEqual([]);
  });
});
