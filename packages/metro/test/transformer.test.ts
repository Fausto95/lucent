import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("Metro transformer", () => {
  it("swaps a package's Lucent module for its proxy, named <package>/<module>", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-metro-"));
    const upstream = path.join(root, "upstream.cjs");
    fs.writeFileSync(upstream, "module.exports = { transform: (a) => a.src };\n");
    process.env.LUCENT_UPSTREAM_TRANSFORMER = upstream;
    const pkg = path.join(root, "node_modules/lucent-a");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "lucent-a", lucent: { sources: "src" } }));
    fs.mkdirSync(path.join(root, ".lucent/native/js/lucent-a"), { recursive: true });
    fs.writeFileSync(path.join(root, ".lucent/native/js/lucent-a/storage.js"), "// the proxy of lucent-a/storage\n");
    fs.mkdirSync(path.join(root, ".lucent/native/js"), { recursive: true });
    fs.writeFileSync(path.join(root, ".lucent/native/js/storage.js"), "// the app's storage\n");
    const t = require("../src/transformer.cjs") as { transform(a: { filename: string; src: string; options: { projectRoot: string } }): string };
    expect(t.transform({ filename: path.join(pkg, "src/storage.lucent.ts"), src: "", options: { projectRoot: root } })).toBe("// the proxy of lucent-a/storage\n");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    expect(t.transform({ filename: path.join(root, "src/storage.lucent.ts"), src: "", options: { projectRoot: root } })).toBe("// the app's storage\n");
  });
});
