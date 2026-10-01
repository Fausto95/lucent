import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

/** Each e2e case's modules, but for the one that needs its native extension's package. */
const cases = fs
  .readdirSync(CASES)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => f.replace(/\.test\.js$/, ""))
  .filter((name) => !fs.existsSync(path.join(CASES, name, "extensions.json")))
  .map((name) => {
    const dir = path.join(CASES, name);
    const files = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".lucent.ts"))
          .map((f) => path.join(dir, f))
      : [`${dir}.lucent.ts`];

    return { name, files };
  });

describe("the e2e corpus", () => {
  it.each(cases)("compiles $name without a diagnostic", ({ files }) => {
    const r = compile(files);

    expect(r.diagnostics).toEqual([]);
  });
});
