/** Compiling sample modules, for the IR's tests. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vite-plus/test";
import { compile, type CompileOptions } from "../../src/index.ts";

/** A module `sample.lucent.ts` with `source`, in a directory of its own. */
export function module(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ir-"));
  const file = path.join(dir, "sample.lucent.ts");

  fs.writeFileSync(file, source);
  return file;
}

/** The generated C++ of a one-module program (for `platform`, when one is given). */
export function cppOf(file: string, platform?: "host" | "android"): string {
  const options: CompileOptions = platform ? { platforms: [platform] } : {};
  const r = compile([file], options);

  expect(r.diagnostics).toEqual([]);

  const prefix = platform ? `${platform}/m_` : "m_";
  const [, text] = [...r.files].find(([n]) => n.endsWith(".cpp") && n.startsWith(prefix))!;

  return text.replace(/^#line .*\n/gm, "");
}

/** The body of `fn` in `cpp`, from its signature to its closing brace. */
export function body(cpp: string, fn: string): string {
  const start = cpp.search(new RegExp(`::${fn}\\(.*\\) \\{$`, "m"));

  expect(start).toBeGreaterThanOrEqual(0);

  return cpp.slice(start, cpp.indexOf("\n}\n", start) + 2);
}

/** Whether `parts` appear in `text` in this order. */
export function inOrder(text: string, ...parts: string[]): boolean {
  let at = -1;

  for (const p of parts) {
    at = text.indexOf(p, at + 1);

    if (at < 0) return false;
  }
  return true;
}
