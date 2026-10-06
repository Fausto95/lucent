import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

/** Runs a module's JS proxy against `native`, standing in for the TurboModule's exports. */
function loadProxy(source: string, native: Record<string, unknown>): Record<string, unknown> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-proxy-"));
  const file = path.join(dir, "sample.lucent.ts");
  fs.writeFileSync(file, source);

  const result = compile([file]);
  expect(result.diagnostics).toEqual([]);

  const loader = { loadModule: () => native, lucentClass: (c: unknown) => c };
  const require = (spec: string) => (spec === "react-native" ? {} : loader);
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", result.proxies.get("sample")!)(require, exports);

  return exports;
}

describe("JS proxy", () => {
  it("reads an exported let live and copies an exported const once", () => {
    const native = { count: 0, limit: 3 };
    const exports = loadProxy("export let count = 0;\nexport const limit = 3;", native);

    native.count = 1;
    native.limit = 4;

    expect(exports.count).toBe(1);
    expect(exports.limit).toBe(3);
    expect(Object.keys(exports)).toEqual(expect.arrayContaining(["count", "limit"]));
  });
});
