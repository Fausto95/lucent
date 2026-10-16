/**
 * lucent build and a module's web twin (decision 0133): the twin isn't compiled for the
 * native platforms, but is checked against the module's exports, failing
 * the build at the twin when they differ.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runLucent } from "./run-to-exit.ts";

function app(twin: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-web-twin-app-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.writeFileSync(
    path.join(root, "store.lucent.ts"),
    "const values = new Map<string, string>();\nexport function save(key: string, value: string): void {\n  values.set(key, value);\n}\n",
  );
  fs.writeFileSync(path.join(root, "store.web.lucent.ts"), twin);
  return root;
}

const build = (root: string) =>
  runLucent(["build", "--platforms", "host", "--root", root], {
    env: { ...process.env, NO_COLOR: "1" },
  });

describe("lucent build with a module's web twin", () => {
  it("checks the twin, which isn't one of the native build's modules", () => {
    const root = app(
      "export function save(key: string, value: string): void {\n  localStorage.setItem(key, value);\n}\n",
    );
    const r = build(root);
    expect(r.stdout + r.stderr).not.toMatch(/error|✗/i);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(root, ".lucent/native/js/store.js"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".lucent/native/js/store.web.js"))).toBe(false);
  });

  it("fails at a twin that doesn't export what the module does", () => {
    const r = build(app("export function save(key: number): void {}\n"));
    expect(r.status).not.toBe(0);
    // As one line: the report wraps what it says to the terminal's width.
    const out = (r.stdout + r.stderr).replace(/\s+/g, " ");
    expect(out).toContain("LUCENT3005");
    expect(out).toContain(
      "store.web.lucent.ts is store.lucent.ts's web twin, but doesn't export what store.lucent.ts exports, with its types",
    );
  });
});
