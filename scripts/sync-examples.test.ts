// The example apps' generated files (App.tsx, App.web.tsx, src/) match what
// scripts/sync-examples.ts makes of their sources: the shared app, each
// app's overlay, and the end-to-end cases with their reference lines.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const script = path.join(import.meta.dirname, "sync-examples.ts");

describe("the example apps", () => {
  it("are what node scripts/sync-examples.ts makes of their sources", () => {
    const r = spawnSync(process.execPath, [script, "--check"], {
      encoding: "utf8",
      timeout: 300_000,
    });

    // The check's own message names each file that differs.
    expect(r.status === 0 ? "" : r.stderr.slice(r.stderr.indexOf("✗"))).toBe("");
    expect(r.stdout).toMatch(/✓ both example apps match their sources/);
  }, 300_000);
});
