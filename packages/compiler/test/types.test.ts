import { describe, expect, test } from "bun:test";
import { resolveType, type TypeScope } from "../src/types/resolve.ts";
import { typeToString } from "../src/types/native-type.ts";
import { parseModule } from "../src/parser/index.ts";

const scope: TypeScope = { structs: new Set(["User"]), sized: new Set(["int32", "float32"]) };

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
    ["any", "NT1004"],
    ["unknown", "NT1004"],
    ["string | number", "NT1003"],
    ["Foo", "NT1003"],
    ["Promise<any>", "NT1004"],
    ["Record<number, string>", "NT1003"],
    ["Map<string, number>", "NT1003"],
    ["never", "NT1003"],
    ["() => void", "NT1005"],
    ["[number, string]", "NT1003"],
  ])("%s → %s", (ts, code) => {
    const result = typeOf(ts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.code).toBe(code);
  });

  test("optional of optional collapses", () => {
    const result = typeOf("string | null | undefined");
    expect(result.ok && typeToString(result.type)).toBe("optional<string>");
  });
});
