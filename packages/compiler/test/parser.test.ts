import { describe, expect, test } from "vite-plus/test";
import { parseModule } from "../src/parser/index.ts";

const parse = (source: string) => parseModule(source, "math.lucent.ts");

describe("parseModule", () => {
  test("exported function with annotated params and body", () => {
    const { module, diagnostics } = parse(`
      export function add(a: number, b: number): number {
        return a + b;
      }
    `);
    expect(diagnostics).toEqual([]);
    expect(module.functions).toHaveLength(1);
    const fn = module.functions[0]!;
    expect(fn.name).toBe("add");
    expect(fn.exported).toBe(true);
    expect(fn.async).toBe(false);
    expect(fn.params.map((p) => p.name)).toEqual(["a", "b"]);
    expect(fn.params[0]!.type).toEqual({
      kind: "keyword",
      name: "number",
      span: expect.anything(),
    });
    expect(fn.returnType).toEqual({ kind: "keyword", name: "number", span: expect.anything() });
    expect(fn.body).toHaveLength(1);
    expect(fn.body[0]).toMatchObject({
      kind: "return",
      argument: {
        kind: "binary",
        operator: "+",
        left: { kind: "identifier", name: "a" },
        right: { kind: "identifier", name: "b" },
      },
    });
  });

  test("async function, Promise return, await, for-of, let", () => {
    const { module, diagnostics } = parse(`
      export async function total(values: number[]): Promise<number> {
        let sum = 0;
        for (const v of values) {
          sum += v;
        }
        return await helper(sum);
      }
      async function helper(x: number): Promise<number> { return x; }
    `);
    expect(diagnostics).toEqual([]);
    const fn = module.functions[0]!;
    expect(fn.async).toBe(true);
    expect(fn.params[0]!.type).toMatchObject({
      kind: "array",
      element: { kind: "keyword", name: "number" },
    });
    expect(fn.returnType).toMatchObject({
      kind: "reference",
      name: "Promise",
      args: [{ kind: "keyword", name: "number" }],
    });
    expect(fn.body[0]).toMatchObject({
      kind: "variable",
      declaration: "let",
      name: "sum",
      init: { kind: "number", value: 0 },
    });
    expect(fn.body[1]).toMatchObject({
      kind: "forOf",
      variable: "v",
      iterable: { kind: "identifier", name: "values" },
    });
    expect(fn.body[2]).toMatchObject({
      kind: "return",
      argument: { kind: "await", argument: { kind: "call", callee: "helper" } },
    });
    expect(module.functions[1]!.exported).toBe(false);
  });

  test("type alias with optional field and type-only import", () => {
    const { module, diagnostics } = parse(`
      import type { int32 } from "@lucent-lang/types";
      export type User = { id: string; age: int32; nickname?: string; tags: string[] | null };
    `);
    expect(diagnostics).toEqual([]);
    expect(module.imports).toEqual([
      { source: "@lucent-lang/types", names: ["int32"], typeOnly: true, span: expect.anything() },
    ]);
    const alias = module.typeAliases[0]!;
    expect(alias.name).toBe("User");
    expect(alias.exported).toBe(true);
    expect(alias.type).toMatchObject({
      kind: "object",
      fields: [
        { name: "id", optional: false, type: { kind: "keyword", name: "string" } },
        { name: "age", optional: false, type: { kind: "reference", name: "int32", args: [] } },
        { name: "nickname", optional: true, type: { kind: "keyword", name: "string" } },
        {
          name: "tags",
          optional: false,
          type: { kind: "union", members: [{ kind: "array" }, { kind: "keyword", name: "null" }] },
        },
      ],
    });
  });

  test("control flow, throw LucentError, member/index/method access, template literal", () => {
    const { module, diagnostics } = parse(`
      type User = { name: string; scores: number[] };
      export function describe(u: User, i: number): string {
        if (i < 0) {
          throw new LucentError("BAD_INDEX", { message: "negative" });
        } else if (i >= u.scores.length) {
          return "";
        }
        while (i > 0) { i--; }
        u.scores.push(1);
        return \`\${u.name}: \${u.scores[i]}\`;
      }
    `);
    expect(diagnostics).toEqual([]);
    const body = module.functions[0]!.body;
    expect(body[0]).toMatchObject({
      kind: "if",
      test: { kind: "binary", operator: "<" },
      consequent: [{ kind: "throw", code: "BAD_INDEX", message: { kind: "string", value: "negative" } }],
      alternate: [
        {
          kind: "if",
          test: {
            kind: "binary",
            operator: ">=",
            right: {
              kind: "member",
              property: "length",
              object: { kind: "member", property: "scores" },
            },
          },
        },
      ],
    });
    expect(body[1]).toMatchObject({
      kind: "while",
      body: [
        {
          kind: "expression",
          expression: { kind: "update", operator: "--", target: { kind: "identifier", name: "i" } },
        },
      ],
    });
    expect(body[2]).toMatchObject({
      kind: "expression",
      expression: { kind: "methodCall", method: "push", args: [{ kind: "number", value: 1 }] },
    });
    expect(body[3]).toMatchObject({
      kind: "return",
      argument: {
        kind: "template",
        quasis: ["", ": ", ""],
        expressions: [{ kind: "member", property: "name" }, { kind: "index" }],
      },
    });
  });

  test("syntax errors become LUCENT1000 with a span", () => {
    const { diagnostics } = parse(`export function (a: number) {}`);
    expect(diagnostics[0]).toMatchObject({
      code: "LUCENT1000",
      span: { start: expect.any(Number), end: expect.any(Number) },
    });
  });

  test("unsupported syntax is reported as LUCENT1001 and does not abort parsing", () => {
    const { module, diagnostics } = parse(`
      export function f(a: number): number {
        switch (a) { default: return 1; }
      }
      export function g(): number { return 2; }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "LUCENT1001" });
    expect(diagnostics[0]!.message).toContain("switch");
    expect(module.functions.map((f) => f.name)).toEqual(["f", "g"]);
  });

  test("loose equality, var, class inheritance, and non-lucent imports are rejected", () => {
    const { diagnostics } = parse(`
      import { x } from "./other";
      class Foo extends Base {}
      export function f(a: number): boolean { var b = a; return b == 1; }
    `);
    expect(diagnostics.map((d) => d.code).toSorted()).toEqual(["LUCENT1001", "LUCENT1001", "LUCENT1001", "LUCENT1006"]);
  });
});
