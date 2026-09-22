import { describe, expect, test } from "vite-plus/test";
import { resolveType, type TypeScope } from "../src/types/resolve.ts";
import { typeToString } from "../src/types/native-type.ts";
import { parseModule } from "../src/parser/index.ts";

const scope: TypeScope = {
  enums: new Map(),
  enumAliases: new Map(),
  structs: new Set(["User"]),
  sized: new Set(["int32", "float32"]),
};

function typeOf(annotation: string) {
  const { module, diagnostics } = parseModule(`function f(x: ${annotation}): void {}`, "t.lucent.ts");
  if (diagnostics.length) throw new Error(diagnostics[0]!.message);
  return resolveType(module.functions[0]!.params[0]!.type!, scope);
}

describe("resolveType", () => {
  test.each([
    ["number", "float64"],
    ["string", "string"],
    ["boolean", "bool"],
    ["void", "void"],
    ["number[]", "array<float64>"],
    ["Array<string>", "array<string>"],
    ["string | null", "optional<string>"],
    ["string | undefined", "optional<string>"],
    ["null | User", "optional<struct User>"],
    ["Record<string, number>", "map<float64>"],
    ["Uint8Array", "bytes"],
    ["Promise<User[]>", "promise<array<struct User>>"],
    ["int32", "int32"],
    ["float32", "float32"],
    ["User", "struct User"],
    ["(number | null)[]", "array<optional<float64>>"],
  ])("%s → %s", (ts, expected) => {
    const result = typeOf(ts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeToString(result.type)).toBe(expected);
  });

  test.each([
    ["any", "LUCENT1004"],
    ["unknown", "LUCENT1004"],
    ["string | number", "LUCENT1003"],
    ["Foo", "LUCENT1003"],
    ["Promise<any>", "LUCENT1004"],
    ["Record<number, string>", "LUCENT1003"],
    ["Map<string, number>", "LUCENT1003"],
    ["never", "LUCENT1003"],
    ["() => void", "LUCENT1005"],
    ["[number, string]", "LUCENT1003"],
  ])("%s → %s", (ts, code) => {
    const result = typeOf(ts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect<string>(result.diagnostic.code).toBe(code);
  });

  test("optional of optional collapses", () => {
    const result = typeOf("string | null | undefined");
    expect(result.ok && typeToString(result.type)).toBe("optional<string>");
  });
});
