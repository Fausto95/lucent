import { describe, expect, test } from "vite-plus/test";
import { parseModule } from "../src/parser/index.ts";
import { checkModule } from "../src/checker/index.ts";
import { typeToString } from "../src/types/native-type.ts";

function check(source: string) {
  const parsed = parseModule(source, "m.lucent.ts");
  if (parsed.diagnostics.length) throw new Error("parse: " + parsed.diagnostics[0]!.message);
  return checkModule(parsed.module);
}

const codes = (source: string): string[] => check(source).diagnostics.map((d) => d.code);

const ok = (source: string) => {
  const result = check(source);
  expect(result.diagnostics).toEqual([]);
  return result.module!;
};

describe("checkModule", () => {
  test("signatures, structs, and inferred locals", () => {
    const m = ok(`
      import type { int32 } from "@lucent-lang/types";
      export type User = { id: string; age: int32; nickname?: string };
      export function greet(u: User, times: number): string {
        let out = "";
        const name = u.nickname;
        for (let i = 0; i < times; i++) {
          out += u.id;
        }
        return out;
      }
      export async function load(id: string): Promise<User> {
        return { id: id, age: 3, nickname: null };
      }
    `);
    expect(m.structs).toEqual([
      {
        name: "User",
        exported: true,
        fields: [
          { name: "id", type: { kind: "string" } },
          { name: "age", type: { kind: "int", bits: 32, signed: true } },
          { name: "nickname", type: { kind: "optional", value: { kind: "string" } } },
        ],
      },
    ]);
    const greet = m.functions[0]!;
    expect(greet.params.map((p) => typeToString(p.type))).toEqual(["struct User", "float64"]);
    expect(typeToString(greet.returnType)).toBe("string");
    expect(greet.body[0]).toMatchObject({
      kind: "variable",
      name: "out",
      type: { kind: "string" },
    });
    expect(greet.body[1]).toMatchObject({
      kind: "variable",
      name: "name",
      type: { kind: "optional", value: { kind: "string" } },
    });
    const load = m.functions[1]!;
    expect(load.async).toBe(true);
    expect(typeToString(load.returnType)).toBe("struct User");
    expect(load.body[0]).toMatchObject({
      kind: "return",
      argument: { kind: "object", type: { kind: "struct", name: "User" } },
    });
  });

  test("numeric literals adapt to sized integer context", () => {
    const m = ok(`
      import type { int32 } from "@lucent-lang/types";
      export function f(a: int32): int32 {
        let b: int32 = 1;
        b = b + 2;
        const c = 3;
        return a + b;
      }
    `);
    const body = m.functions[0]!.body;
    expect(body[0]).toMatchObject({
      kind: "variable",
      init: { kind: "number", type: { kind: "int", bits: 32 } },
    });
    expect(body[1]).toMatchObject({
      kind: "expression",
      expression: { kind: "assign", value: { kind: "binary", type: { kind: "int", bits: 32 } } },
    });
    expect(body[2]).toMatchObject({ kind: "variable", type: { kind: "float", bits: 64 } });
  });

  test("optional narrowing inserts unwraps", () => {
    const m = ok(`
      type User = { nickname: string | null };
      export function name(u: User): string {
        const n = u.nickname;
        if (n === null) {
          return "anon";
        }
        return n;
      }
      export function other(n: string | undefined): string {
        if (n !== undefined) { return n; } else { return ""; }
      }
    `);
    expect(m.functions[0]!.body[2]).toMatchObject({
      kind: "return",
      argument: {
        kind: "unwrap",
        argument: { kind: "identifier", name: "n" },
        type: { kind: "string" },
      },
    });
    expect(m.functions[1]!.body[0]).toMatchObject({
      kind: "if",
      consequent: [{ kind: "return", argument: { kind: "unwrap" } }],
    });
  });

  test("calls, await, member access, arrays, maps, bytes", () => {
    const m = ok(`
      type Box = { items: number[]; names: Record<string, string>; data: Uint8Array };
      function helper(x: number): number { return x * 2; }
      async function fetchIt(): Promise<number> { return 1; }
      export async function run(b: Box, i: number): Promise<number> {
        const n = b.items.length + b.data.length;
        b.items.push(helper(n));
        const first = b.items[0];
        const maybe = b.names["a"];
        const s = \`\${n} \${first}\`;
        if (maybe !== null) { return s.length; }
        return await fetchIt();
      }
    `);
    const body = m.functions[2]!.body;
    expect(body[0]).toMatchObject({ kind: "variable", type: { kind: "float", bits: 64 } });
    expect(body[2]).toMatchObject({
      kind: "variable",
      name: "first",
      type: { kind: "float", bits: 64 },
    });
    expect(body[3]).toMatchObject({
      kind: "variable",
      name: "maybe",
      type: { kind: "optional", value: { kind: "string" } },
    });
    expect(body[4]).toMatchObject({ kind: "variable", name: "s", type: { kind: "string" } });
    expect(body[6]).toMatchObject({
      kind: "return",
      argument: { kind: "await", type: { kind: "float", bits: 64 } },
    });
  });

  test.each([
    ["missing param annotation", `export function f(a): number { return 1; }`, ["LUCENT1014"]],
    ["missing return annotation", `export function f(a: number) { return 1; }`, ["LUCENT1014"]],
    ["async without Promise", `export async function f(): number { return 1; }`, ["LUCENT1011"]],
    ["sync with Promise", `export function f(): Promise<number> { return 1; }`, ["LUCENT1011"]],
    ["Promise as param", `export function f(p: Promise<number>): number { return 1; }`, ["LUCENT1003"]],
    [
      "too many params",
      `export function f(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number): number { return 1; }`,
      ["LUCENT1007"],
    ],
    ["unknown identifier", `export function f(): number { return x; }`, ["LUCENT1010"]],
    ["unknown function", `export function f(): number { return g(); }`, ["LUCENT1010"]],
    [
      "arity",
      `function g(a: number): number { return a; } export function f(): number { return g(); }`,
      ["LUCENT1012"],
    ],
    [
      "argument type",
      `function g(a: number): number { return a; } export function f(): number { return g("x"); }`,
      ["LUCENT1011"],
    ],
    ["return type", `export function f(): number { return "x"; }`, ["LUCENT1011"]],
    ["assign to const", `export function f(): number { const a = 1; a = 2; return a; }`, ["LUCENT1016"]],
    ["assignment type", `export function f(): number { let a = 1; a = "x"; return a; }`, ["LUCENT1011"]],
    ["await non-promise", `export async function f(): Promise<number> { return await 1; }`, ["LUCENT1011"]],
    ["if test must be bool", `export function f(a: number): number { if (a) { return 1; } return 2; }`, ["LUCENT1011"]],
    [
      "mixed numeric types",
      `import type { int32 } from "@lucent-lang/types"; export function f(a: int32, b: number): number { return a + b; }`,
      ["LUCENT1011"],
    ],
    [
      "fractional literal into int",
      `import type { int32 } from "@lucent-lang/types"; export function f(): int32 { return 1.5; }`,
      ["LUCENT1011"],
    ],
    ["unknown field", `type U = { a: number }; export function f(u: U): number { return u.b; }`, ["LUCENT1010"]],
    [
      "dynamic access on struct",
      `type U = { a: number }; export function f(u: U, k: string): number { return u[k]; }`,
      ["LUCENT1002"],
    ],
    ["optional used without narrowing", `export function f(a: string | null): string { return a; }`, ["LUCENT1011"]],
    ["missing return", `export function f(a: number): number { if (a > 1) { return 1; } }`, ["LUCENT1015"]],
    [
      "object literal missing field",
      `type U = { a: number; b: string }; export function f(): U { return { a: 1 }; }`,
      ["LUCENT1011"],
    ],
    [
      "object literal extra field",
      `type U = { a: number }; export function f(): U { return { a: 1, c: 2 }; }`,
      ["LUCENT1011"],
    ],
    [
      "object literal without context",
      `type U = { a: number }; export function f(): number { const u = { a: 1 }; return u.a; }`,
      ["LUCENT1014"],
    ],
    ["uninitialized local", `export function f(): number { let a; a = 1; return a; }`, ["LUCENT1014"]],
    ["break outside loop", `export function f(): number { break; return 1; }`, ["LUCENT1001"]],
    [
      "for-of over non-array",
      `export function f(s: string): number { for (const c of s) {} return 1; }`,
      ["LUCENT1011"],
    ],
    ["unknown sized type without import", `export function f(a: int32): number { return 1; }`, ["LUCENT1003"]],
    [
      "duplicate function",
      `export function f(): number { return 1; } export function f(): number { return 2; }`,
      ["LUCENT1001"],
    ],
  ])("%s", (_name, source, expected) => {
    expect(codes(source)).toEqual(expected);
  });

  test("void functions need no return and reject values", () => {
    ok(`export function f(a: number): void { if (a > 0) { return; } }`);
    expect(codes(`export function f(): void { return 1; }`)).toEqual(["LUCENT1011"]);
  });

  test("throw is accepted as an exit and message must be a string", () => {
    ok(
      `export function f(a: number): number { if (a < 0) { throw new LucentError("NEG", { message: "neg" }); } return a; }`,
    );
    ok(`export function f(): number { throw new LucentError("NEVER"); }`);
    expect(codes(`export function f(): number { throw new LucentError("X", { message: 1 }); }`)).toEqual([
      "LUCENT1011",
    ]);
  });
});
