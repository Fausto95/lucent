import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pkg = path.resolve(import.meta.dirname, "..");
const bindgen = path.resolve(pkg, "../bindgen/src");

describe("the published build", () => {
  it("keys SDK caches on bindgen's code, not on the whole bundle, so upgrades keep them unless the extractor changed", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", path.join(pkg, "scripts/build.mts")], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    // The hash the workspace computes from bindgen's sources.
    const h = crypto.createHash("sha256");
    for (const f of fs.readdirSync(bindgen).sort()) if (/\.(ts|js)$/.test(f)) h.update(fs.readFileSync(path.join(bindgen, f)));
    const expected = h.digest("hex").slice(0, 8);
    const dist = fs.readdirSync(path.join(pkg, "dist")).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(pkg, "dist", f), "utf8")).join("\n");
    expect(dist).toContain(`"${expected}"`);
    expect(dist).not.toMatch(/__LUCENT_EXTRACTOR__/);
  }, 120_000);
});
