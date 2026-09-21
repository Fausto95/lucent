import { expect, test } from "vite-plus/test";
import { extractSwiftInterface, extractJavaSignatures, generateBindingLibrary } from "../src/index.ts";
test("extracts labeled Swift functions and emits type declarations and native bindings", () => {
  const schema = extractSwiftInterface(
    "public func distance(from start: Swift.Double, to end: Swift.Double) throws -> Swift.Double",
    "Geometry",
  );
  expect(schema.functions).toHaveLength(1);
  const output = generateBindingLibrary(schema);
  expect(output.library.source).toContain("distance(start: number, end: number): number");
  expect(output.library.bindings?.distance?.swift.join("\n")).toContain("Geometry.distance(from: start, to: end)");
  expect(output.library.bindings?.distance?.platforms).toEqual(["ios"]);
});
test("extracts Java static methods with primitive conversions", () => {
  const schema = extractJavaSignatures(
    "public final class java.lang.Math {\n public static double hypot(double, double);\n public static int abs(int);\n public java.lang.String toString();\n}",
  );
  const output = generateBindingLibrary(schema);
  expect(output.library.source).toContain("hypot(arg0: number, arg1: number): number");
  expect(output.library.bindings?.hypot?.kotlin.join("\n")).toContain("java.lang.Math.hypot(arg0, arg1)");
  expect(output.library.source).toContain("abs(arg0: int32): int32");
  expect(schema.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining("instance")]));
});
test("reports unsupported SDK signatures instead of emitting misleading declarations", () => {
  const schema = extractSwiftInterface(
    "public func open(_ callback: @escaping () -> Void)\npublic func read() -> Foundation.URL",
    "Foundation",
  );
  expect(generateBindingLibrary(schema).library.source).not.toContain("read(");
  expect(schema.diagnostics.length).toBeGreaterThan(0);
});
test("does not silently choose an overload", () => {
  const schema = extractJavaSignatures(
    "public final class java.lang.Math {\npublic static int abs(int);\npublic static double abs(double);\n}",
  );
  expect(generateBindingLibrary(schema).library.source).not.toContain("function abs(");
  expect(schema.diagnostics.some((d) => d.includes("overload"))).toBe(true);
});
