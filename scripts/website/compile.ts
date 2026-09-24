import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compile, type Diagnostic } from "../../packages/compiler/src/index.ts";

export type Sample = { filename: string; code: string; expect?: string; cpp?: true };

// Samples stay in memory, but TypeScript resolves imports only in directories that exist.
const samplesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-website-"));
process.on("exit", () => fs.rmSync(samplesRoot, { recursive: true, force: true }));

/** Compiles in-memory sources as if they were an app's src/ folder. */
export function compileSamples(app: string, samples: Sample[]): { diagnostics: Diagnostic[]; files: Map<string, string> } {
  const dir = path.join(samplesRoot, app, "src");
  fs.mkdirSync(dir, { recursive: true });
  const sources = new Map(samples.map((s) => [path.join(dir, s.filename), s.code]));
  const result = compile([...sources.keys()], { readSource: (f) => sources.get(f) });
  // #line directives name the sample by its file name, as the page does, not by the temporary path.
  const files = new Map([...result.files].map(([name, code]) => [name, code.split(`${dir}${path.sep}`).join("")]));
  return { diagnostics: result.diagnostics.map((d) => ({ ...d, file: d.file && path.relative(dir, d.file) })), files };
}
