import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { Codes, compile, docsUrl, Explanations, sdkAvailable } from "../src/index.ts";

function compileExample(files: Record<string, string>, views = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-explain-"));
  const paths = Object.entries(files).map(([name, source]) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    return file;
  });
  if (views) process.env.LUCENT_VIEWS = "fabric";

  try {
    return compile(paths.filter((f) => /\.lucent\.tsx?$/.test(f)));
  } finally {
    if (views) delete process.env.LUCENT_VIEWS;
  }
}

describe("explanations", () => {
  it("explain every code", () => {
    for (const code of Object.values(Codes)) {
      const e = Explanations[code];
      expect(e, code).toBeDefined();
      for (const field of ["title", "summary", "details", "fix"] as const)
        expect(e[field].trim(), `${code} ${field}`).not.toBe("");
      expect(Object.keys(e.wrong).length, `${code} wrong`).toBeGreaterThan(0);
      expect(Object.keys(e.right).length, `${code} right`).toBeGreaterThan(0);
    }
  });

  describe.each(Object.entries(Explanations))("%s", (code, e) => {
    const missing = e.sdk && !sdkAvailable(e.sdk);
    it.skipIf(missing)("its wrong example reports it", () => {
      const r = compileExample(e.wrong, e.views);
      const reported = e.severity === "warning" ? (r.warnings ?? []) : r.diagnostics;
      expect(reported.map((d) => d.code)).toContain(code);
    });
    it.skipIf(missing)("its right example compiles", () => {
      const r = compileExample(e.right, e.views);
      expect(r.diagnostics).toEqual([]);
      expect(r.warnings ?? []).toEqual([]);
    });
  });
});

describe("diagnostics", () => {
  it("carry the fix and where the code is explained", () => {
    const [d] = compileExample({
      "a.lucent.ts": "export function f(): number {\n  var x = 1;\n  return x;\n}\n",
    }).diagnostics;
    expect(d).toMatchObject({
      code: "LUCENT1001",
      fix: Explanations.LUCENT1001.fix,
      docs: docsUrl("LUCENT1001"),
    });
    expect(docsUrl("LUCENT1001")).toBe("https://lucent-lang.dev/docs/api/diagnostics/#lucent1001");
  });
});
