import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

function compileSource(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-bigint-"));
  const file = path.join(dir, "sample.lucent.ts");

  fs.writeFileSync(file, source);
  return compile([file]);
}

/** The module's generated C++, without #line directives. */
function cppOf(source: string): string {
  const r = compileSource(source);

  expect(r.diagnostics).toEqual([]);

  const [, text] = [...r.files].find(([n]) => n.startsWith("m_") && n.endsWith(".cpp"))!;

  return text.replace(/^#line .*\n/gm, "");
}

function diagnostics(source: string) {
  return compileSource(source).diagnostics.map((d) => ({ code: d.code, message: d.message }));
}

describe("bigint", () => {
  it("spells literals within int64 inline and larger ones parsed once", () => {
    const out = cppOf(
      "export function f(): bigint[] { return [0n, 9223372036854775807n, 9223372036854775808n, 0xffn, 1_000n]; }",
    );

    expect(out).toContain("lucent::BigInt::fromInt64(0)");

    expect(out).toContain("lucent::BigInt::fromInt64(9223372036854775807)");

    expect(out).toContain('LUCENT_BIGINT("9223372036854775808")');

    expect(out).toContain("lucent::BigInt::fromInt64(255)");

    expect(out).toContain("lucent::BigInt::fromInt64(1000)");
  });

  it("uses the runtime's operators, pow for ** and exact comparisons with numbers", () => {
    const out = cppOf(
      "export function f(a: bigint, b: bigint, n: number): boolean { return a * b + a ** b > n && a === b; }",
    );

    expect(out).toMatch(/lucent::BigInt::pow\(a, b\)/);

    expect(out).toMatch(/a \* b \+ lucent::BigInt::pow\(a, b\) > n/);

    expect(out).toMatch(/a == b/);
  });

  it("prints bigints in console output with their n suffix, as JavaScript consoles do", () => {
    const out = cppOf('export function f(a: bigint): void { console.log("a", a, `${a}`); }');

    expect(out).toContain('lucent::toJsString(a) + LUCENT_STR("n")');
  });

  it("rejects loose equality that would convert between a bigint and a number or string", () => {
    expect(
      diagnostics("export function f(a: bigint, b: bigint | number): boolean { return a == b; }"),
    ).toEqual([
      {
        code: "LUCENT1002",
        message: expect.stringContaining("loose equality between a bigint and"),
      },
    ]);

    expect(
      diagnostics(
        "export function f(a: bigint, b: bigint | undefined): boolean { return a == b; }",
      ),
    ).toEqual([]);
  });

  it("rejects JSON.parse into bigints, which JSON cannot hold", () => {
    expect(
      diagnostics("export function f(s: string): bigint { return JSON.parse(s) as bigint; }").map(
        (d) => d.code,
      ),
    ).toEqual(["LUCENT1003"]);
  });

  it("rejects bigint methods it does not implement", () => {
    expect(
      diagnostics("export function f(a: bigint): string { return a.toLocaleString(); }"),
    ).toEqual([{ code: "LUCENT1003", message: expect.stringContaining("bigint.toLocaleString") }]);
  });
});
