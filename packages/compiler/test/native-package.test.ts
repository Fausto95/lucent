import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compile, runtimeDir, writeNativePackage } from "../src/index.ts";

function files(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
}

describe("native package", () => {
  it("ships every runtime source file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    for (const sub of ["cpp/lucent", "cpp/rn", "cpp/third_party"]) {
      expect(files(path.join(out, sub)).sort()).toEqual(files(path.join(runtimeDir(), sub)).sort());
    }
  });
});
