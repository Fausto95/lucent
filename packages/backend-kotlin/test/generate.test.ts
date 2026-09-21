import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compile } from "@lucent-lang/compiler";
import { generateKotlin, kotlinType } from "../src/index.ts";
import { FIXTURES, expectGolden, fixtureNames, readFixture } from "../../compiler/test/golden.ts";

describe("kotlin backend (golden)", () => {
  for (const name of fixtureNames()) {
    test(name, () => {
      const { source, fileName } = readFixture(name);
      const result = compile(source, { fileName });
      expect(result.module).not.toBeNull();
      const unit = generateKotlin(result.module!);
      expectGolden(unit.code, join(FIXTURES, `${name}.kt`));
    });
  }
});

describe("kotlin types", () => {
  test.each([
    [{ kind: "float", bits: 64 }, "Double"],
    [{ kind: "float", bits: 32 }, "Float"],
    [{ kind: "int", bits: 32, signed: true }, "Int"],
    [{ kind: "int", bits: 64, signed: true }, "Long"],
    [{ kind: "int", bits: 8, signed: false }, "UByte"],
    [{ kind: "string" }, "String"],
    [{ kind: "bool" }, "Boolean"],
    [{ kind: "void" }, "Unit"],
    [{ kind: "bytes" }, "ArrayBuffer"],
    [{ kind: "array", element: { kind: "string" } }, "MutableList<String>"],
    [{ kind: "optional", value: { kind: "struct", name: "User" } }, "User?"],
    [{ kind: "map", value: { kind: "float", bits: 64 } }, "Map<String, Double>"],
  ] as const)("%j → %s", (type, expected) => {
    expect(kotlinType(type as never)).toBe(expected);
  });
});
