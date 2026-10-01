import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

const PRELUDE = `
function numOrStr(v: number | string): number | string {
  return v;
}

function numOrBool(v: number | boolean): number | boolean {
  return v;
}

function listOrNum(v: number[] | number): number[] | number {
  return v;
}

function num(v?: number): number | undefined {
  return v;
}

function eq<T>(a: T, b: T): boolean {
  return a == b;
}

function isOne<T>(x: T): boolean {
  return x != 1;
}
`;

function diagnostics(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-loose-"));
  const file = path.join(dir, "sample.lucent.ts");

  fs.writeFileSync(file, `${PRELUDE}\n${body}`);

  return compile([file]).diagnostics.map((d) => ({ code: d.code, message: d.message }));
}

const refused = (between: string) => [
  { code: "LUCENT1002", message: expect.stringContaining(`loose equality between ${between}`) },
];

// JavaScript's == converts between numbers, strings, booleans and bigints,
// and an object to a primitive; Lucent compares like === there, so it
// refuses those operands rather than give another answer.
describe("converting loose equality", () => {
  it("refuses == and != between primitives JavaScript converts", () => {
    expect(
      diagnostics('export function f(): boolean { return numOrStr(1) == numOrStr("1"); }'),
    ).toEqual(refused("a number and a string"));

    expect(diagnostics("export function f(): boolean { return numOrBool(true) != 1; }")).toEqual(
      refused("a number and a boolean"),
    );
  });

  it("refuses == between an object and a primitive", () => {
    expect(diagnostics("export function f(): boolean { return listOrNum([1]) == 1; }")).toEqual(
      refused("a number and an object"),
    );
  });

  it("keeps loose equality that converts nothing", () => {
    expect(
      diagnostics(
        "export function f(a: number[], b: number[]): string { return [a.length == b.length, String(a) == String(b), a == b, num() == null, num(1) == 1, num() == undefined].join(); }",
      ),
    ).toEqual([]);
  });

  it("refuses a generic whose loose equality converts once instantiated", () => {
    expect(
      diagnostics('export function f(): boolean { return eq(numOrStr(1), numOrStr("1")); }'),
    ).toEqual(refused("a number and a string"));

    expect(diagnostics("export function f(): boolean { return isOne([1]); }")).toEqual(
      refused("a number and an object"),
    );
  });

  it("keeps generics whose loose equality converts nothing", () => {
    expect(
      diagnostics(
        'export function f(): string { return [eq(1, 2), eq("a", "a"), isOne(1), isOne(num())].join(); }',
      ),
    ).toEqual([]);
  });
});
