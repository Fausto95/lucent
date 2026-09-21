import { describe, expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { declarations, jsType, moduleIdentifier } from "../src/index.ts";

const ir = (src: string, fileName = "sample.lucent.ts") => {
  const r = compile(src, { fileName });
  if (!r.module) throw new Error(r.diagnostics.map((d) => d.message).join("\n"));
  return r.module;
};

describe("host-core", () => {
  test("jsType maps native types back to TypeScript", () => {
    expect(jsType({ kind: "float", bits: 64 })).toBe("number");
    expect(jsType({ kind: "int", bits: 32, signed: true })).toBe("number");
    expect(jsType({ kind: "bytes" })).toBe("Uint8Array");
    expect(jsType({ kind: "optional", value: { kind: "string" } })).toBe("string | null");
    expect(jsType({ kind: "array", element: { kind: "struct", name: "User" } })).toBe("User[]");
    expect(jsType({ kind: "map", value: { kind: "bool" } })).toBe("Record<string, boolean>");
    expect(jsType({ kind: "promise", value: { kind: "void" } })).toBe("Promise<void>");
  });

  test("declarations export structs and exported functions only", () => {
    const m = ir(`
      import type { int32 } from "@lucent-lang/types";
      export type User = { id: string; age: int32; nickname?: string };
      type Hidden = { x: number };
      function helper(h: Hidden): number { return h.x; }
      export function greet(u: User, loud: boolean): string { return u.id; }
      export async function load(id: string): Promise<User[]> { return []; }
    `);
    expect(declarations(m)).toBe(`export type User = {
  id: string;
  age: number;
  nickname: string | null;
};

export declare function greet(u: User, loud: boolean): string;
export declare function load(id: string): Promise<User[]>;
`);
  });

  test("moduleIdentifier makes a safe pascal-case name", () => {
    expect(moduleIdentifier("async-sum")).toBe("AsyncSum");
    expect(moduleIdentifier("struct_roundtrip")).toBe("StructRoundtrip");
    expect(moduleIdentifier("math")).toBe("Math");
  });
});
