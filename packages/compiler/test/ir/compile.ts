/** Compiling sample modules under a chosen lowering, for the IR's tests. */
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

/** Runs `f` with LUCENT_LOWERING set to `mode` (unset when undefined). */
export function withLowering<R>(mode: string | undefined, f: () => R): R {
  const saved = process.env.LUCENT_LOWERING;

  if (mode === undefined) delete process.env.LUCENT_LOWERING;
  else process.env.LUCENT_LOWERING = mode;

  try {
    return f();
  } finally {
    if (saved === undefined) delete process.env.LUCENT_LOWERING;
    else process.env.LUCENT_LOWERING = saved;
  }
}

/** The generated C++ of a one-module program (for `platform`, when one is given). */
export function cppOf(file: string, mode?: string, platform?: "host" | "android"): string {
  const options: CompileOptions = platform ? { platforms: [platform] } : {};
  const r = withLowering(mode, () => compile([file], options));

  expect(r.diagnostics).toEqual([]);

  const prefix = platform ? `${platform}/m_` : "m_";
  const [, text] = [...r.files].find(([n]) => n.endsWith(".cpp") && n.startsWith(prefix))!;

  return text.replace(/^#line .*\n/gm, "");
}
