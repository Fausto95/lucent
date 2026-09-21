import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compile } from "@lucent-lang/compiler";
import { generateSwift, swiftType } from "../src/index.ts";
import { FIXTURES, expectGolden, fixtureNames, readFixture } from "../../compiler/test/golden.ts";

describe("swift backend (golden)", () => {
  for (const name of fixtureNames()) {
    test(name, () => {
      const { source, fileName } = readFixture(name);
      const result = compile(source, { fileName });
      expect(result.module).not.toBeNull();
      const unit = generateSwift(result.module!);
      expectGolden(unit.code, join(FIXTURES, `${name}.swift`));
    });
  }
});

describe("swift types", () => {
  test.each([
    [{ kind: "float", bits: 64 }, "Double"],
    [{ kind: "float", bits: 32 }, "Float"],
    [{ kind: "int", bits: 32, signed: true }, "Int32"],
    [{ kind: "int", bits: 8, signed: false }, "UInt8"],
    [{ kind: "string" }, "String"],
    [{ kind: "bool" }, "Bool"],
    [{ kind: "void" }, "Void"],
    [{ kind: "bytes" }, "ArrayBuffer"],
    [{ kind: "array", element: { kind: "string" } }, "[String]"],
    [{ kind: "optional", value: { kind: "struct", name: "User" } }, "User?"],
    [{ kind: "map", value: { kind: "float", bits: 64 } }, "[String: Double]"],
  ] as const)("%j → %s", (type, expected) => {
    expect(swiftType(type as never)).toBe(expected);
  });
});
