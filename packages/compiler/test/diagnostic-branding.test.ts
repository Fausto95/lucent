import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { DIAGNOSTIC_CODES, renderDiagnostic } from "../src/diagnostics/index.ts";

test("all compiler diagnostics use the Lucent public namespace", () => {
  expect(Object.keys(DIAGNOSTIC_CODES).every((code) => /^LUCENT\d{4}$/.test(code))).toBe(true);
  const source = "export function value(): number { return missing; }";
  const { diagnostics } = compile(source, { fileName: "bad.lucent.ts" });
  expect(diagnostics.some((d) => d.code === "LUCENT1010")).toBe(true);
  for (const diagnostic of diagnostics)
    expect(renderDiagnostic(diagnostic, source, "bad.lucent.ts")).toContain(`error ${diagnostic.code}:`);
});
