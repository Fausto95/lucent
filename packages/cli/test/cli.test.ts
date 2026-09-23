import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/lucent.cjs");

function lucent(root: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [bin, ...args, "--root", root], { encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
  fs.writeFileSync(path.join(root, "a.lucent.ts"), "export function one(): number { return 1; }\n");
  return root;
}

describe("lucent build", () => {
  it("skips work when nothing changed", () => {
    const root = project();
    expect(lucent(root, "build").out).toContain("Compiled 1 module");
    const second = lucent(root, "build");
    expect(second.status).toBe(0);
    expect(second.out).toContain("up to date");
  });

  it("rebuilds when a source changes, and with --force", () => {
    const root = project();
    lucent(root, "build");
    fs.writeFileSync(path.join(root, "a.lucent.ts"), "export function one(): number { return 2; }\n");
    expect(lucent(root, "build").out).toContain("Compiled 1 module");
    expect(lucent(root, "build", "--force").out).toContain("Compiled 1 module");
  });

  it("rebuilds when the output was deleted", () => {
    const root = project();
    lucent(root, "build");
    fs.rmSync(path.join(root, ".lucent"), { recursive: true });
    expect(lucent(root, "build").out).toContain("Compiled 1 module");
  });
});

describe("lucent init", () => {
  it("links the native package as the `lucent` dependency", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-init-"));
    expect(lucent(root, "init").status).toBe(0);
    const config = fs.readFileSync(path.join(root, "react-native.config.js"), "utf8");
    expect(config).toContain('"lucent": { root: require("path").join(__dirname, ".lucent", "native") }');
    expect(config).not.toContain("lucent-native");
  });

  it("renames an existing `lucent-native` entry", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-init-"));
    fs.writeFileSync(path.join(root, "react-native.config.js"), 'module.exports = { dependencies: { "lucent-native": { root: ".lucent/native" } } };\n');
    expect(lucent(root, "init").status).toBe(0);
    expect(fs.readFileSync(path.join(root, "react-native.config.js"), "utf8")).toBe('module.exports = { dependencies: { "lucent": { root: ".lucent/native" } } };\n');
  });
});
