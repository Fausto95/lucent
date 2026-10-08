/**
 * Every example package under examples/ compiles: its modules type-check
 * and their C++ is written, as `lucent build --platforms host` builds them
 * on a machine without either SDK (CI's unit tests, Linux). Each has a
 * README saying what it shows. A package whose components need a
 * platform's SDK (examples/lucent-rating) is checked where that SDK is,
 * and its shared modules here.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = path.resolve(import.meta.dirname, "../../..");
const examples = path.join(root, "examples");
const cli = path.join(root, "packages/lucent/bin/lucent.cjs");

/** Packages whose components need a platform's SDK: their shared modules, by file, are checked alone. */
const VIEWS: Record<string, string[]> = { "lucent-rating": ["src/stars.lucent.ts"] };

function build(dir: string): { status: number | null; output: string } {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-example-"));
  const r = spawnSync(
    process.execPath,
    [cli, "build", "--platforms", "host", "--root", dir, "--out", out],
    { encoding: "utf8", env: { ...process.env, LUCENT_NO_GRADLE: "1" } },
  );
  fs.rmSync(out, { recursive: true, force: true });
  // The build's records (.lucent/, which git ignores) stay out of the examples.
  if (dir.startsWith(examples))
    fs.rmSync(path.join(dir, ".lucent"), { recursive: true, force: true });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

/** A copy of a package with only `files` as its sources, in a directory of its own. */
function only(name: string, files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lucent-example-${name}-`));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, private: true, lucent: { sources: "src" } }),
  );
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(examples, name, f), path.join(dir, f));
  }
  return dir;
}

const packages = fs
  .readdirSync(examples, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(examples, e.name, "package.json")))
  .map((e) => e.name)
  .sort();

describe("the example packages", () => {
  it("are the ones listed here", () => {
    expect(packages).toEqual([
      "lucent-camera",
      "lucent-haptics",
      "lucent-http",
      "lucent-kv-storage",
      "lucent-orbit",
      "lucent-rating",
      "lucent-secure-store",
      "lucent-sensors",
    ]);
  });

  for (const name of packages) {
    it(`${name} has a README`, () => {
      expect(fs.existsSync(path.join(examples, name, "README.md"))).toBe(true);
    });

    it(`${name} compiles for the host`, () => {
      const dir = VIEWS[name] ? only(name, VIEWS[name]) : path.join(examples, name);
      const { status, output } = build(dir);
      expect(output).not.toMatch(/error LUCENT/);
      expect(status).toBe(0);
    }, 120_000);
  }
});
