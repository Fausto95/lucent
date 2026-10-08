import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = path.resolve(import.meta.dirname, "..");
const json = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const internal = ["compiler", "runtime", "bindgen", "codegen"];

describe("the packages' versions", () => {
  // @lucent-lang/lucent bundles the others: a compiler that says 0.0.3 inside 0.2.0
  // (lucentVersion() reads the compiler's) misreports which Lucent a package runs on.
  it("give the internal packages the published package's version", () => {
    const { version } = json("packages/lucent/package.json");
    for (const name of internal)
      expect(json(`packages/${name}/package.json`).version, name).toBe(version);
  });

  it("keep them private and version them together with the published one", () => {
    for (const name of internal)
      expect(json(`packages/${name}/package.json`).private, name).toBe(true);
    const config = json(".changeset/config.json");
    expect(config.fixed).toEqual([
      ["@lucent-lang/lucent", ...internal.map((n) => `@lucent-lang/${n}`)],
    ]);
    // Bumped with the published package, never tagged or published themselves.
    expect(config.privatePackages).toEqual({ version: true, tag: false });
  });
});
