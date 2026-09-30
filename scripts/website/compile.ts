import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compile, type Diagnostic } from "../../packages/compiler/src/index.ts";

export type Sample = { filename: string; code: string; expect?: string; cpp?: true };

// Samples stay in memory, but TypeScript resolves imports only in directories that exist.
const samplesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-website-"));
process.on("exit", () => fs.rmSync(samplesRoot, { recursive: true, force: true }));

/**
 * Compiles in-memory sources as if they were an app's src/ folder; with
 * `views`, as an app whose components' views Lucent generates (their
 * SwiftUI and Compose bodies).
 */
export function compileSamples(
  app: string,
  samples: Sample[],
  options: { views?: boolean } = {},
): { diagnostics: Diagnostic[]; files: Map<string, string>; proxies: Map<string, string> } {
  const dir = path.join(samplesRoot, app, "src");
  fs.mkdirSync(dir, { recursive: true });
  const sources = new Map(samples.map((s) => [path.join(dir, s.filename), s.code]));
  // A component is identified by its package: the app's.
  if (options.views)
    fs.writeFileSync(path.join(samplesRoot, app, "package.json"), '{ "name": "example-app" }\n');
  const views = process.env.LUCENT_VIEWS;
  if (options.views) process.env.LUCENT_VIEWS = "fabric";
  let result: ReturnType<typeof compile>;
  try {
    result = compile([...sources.keys()], { readSource: (f) => sources.get(f) });
  } finally {
    if (views === undefined) delete process.env.LUCENT_VIEWS;
    else process.env.LUCENT_VIEWS = views;
  }
  // #line directives name the sample by its file name, as the page does, not by the temporary path.
  const files = new Map(
    [...result.files].map(([name, code]) => [name, code.split(`${dir}${path.sep}`).join("")]),
  );
  return {
    diagnostics: result.diagnostics.map((d) => ({
      ...d,
      file: d.file && path.relative(dir, d.file),
    })),
    files,
    proxies: result.proxies,
  };
}
