import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Codes, compile, docsUrl, Explanations, sdkAvailable } from "../src/index.ts";

function compileExample(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-explain-"));
  const paths = Object.entries(files).map(([name, source]) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, source);
    return file;
  });
  return compile(paths.filter((f) => f.endsWith(".lucent.ts")));
}

describe("explanations", () => {
  it("explain every code", () => {
    for (const code of Object.values(Codes)) {
      const e = Explanations[code];
      expect(e, code).toBeDefined();
      for (const field of ["title", "summary", "details", "fix"] as const) expect(e[field].trim(), `${code} ${field}`).not.toBe("");
      expect(Object.keys(e.wrong).length, `${code} wrong`).toBeGreaterThan(0);
      expect(Object.keys(e.right).length, `${code} right`).toBeGreaterThan(0);
    }
  });

  describe.each(Object.entries(Explanations))("%s", (code, e) => {
    const missing = e.sdk && !sdkAvailable(e.sdk);
    it.skipIf(missing)("its wrong example reports it", () => {
      expect(compileExample(e.wrong).diagnostics.map((d) => d.code)).toContain(code);
    });
    it.skipIf(missing)("its right example compiles", () => {
      expect(compileExample(e.right).diagnostics).toEqual([]);
    });
  });
});

describe("diagnostics", () => {
  it("carry the fix and where the code is explained", () => {
    const [d] = compileExample({ "a.lucent.ts": "export function f(): number {\n  var x = 1;\n  return x;\n}\n" }).diagnostics;
    expect(d).toMatchObject({ code: "LUCENT1001", fix: Explanations.LUCENT1001.fix, docs: docsUrl("LUCENT1001") });
    expect(docsUrl("LUCENT1001")).toBe("https://lucent-lang.dev/docs/language/diagnostics/#lucent1001");
  });
});
