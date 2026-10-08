/**
 * The last build's problems by module file, for Metro's transformer
 * (metro/transformer.cjs): a module whose last build failed is bundled as
 * a transform error with the diagnostics' code frames, so the problem
 * shows in the app's RedBox, not only in the terminal running the build.
 *
 * `.lucent/problems.json`: { "files": { "<absolute path>": { hash, text } } },
 * hash being the file's content's when the build checked it (sha256, the
 * first 16 hex digits), text the diagnostics as `lucent build` prints them,
 * without colour.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "@lucent-lang/compiler";
import { renderDiagnostic } from "./ui/diagnostic.ts";
import { createTheme } from "./ui/theme.ts";

export const PROBLEMS_FILE = ".lucent/problems.json";

const plain = createTheme({
  color: false,
  interactive: false,
  unicode: true,
  links: false,
  width: 100,
});

/** Records `diagnostics` (files relative to `root`) by module file; none clears the record. */
export function writeProblems(root: string, diagnostics: readonly Diagnostic[]): void {
  const files: Record<string, { hash: string; text: string }> = {};

  for (const d of diagnostics) {
    if (!d.file || !/\.lucent\.tsx?$/.test(d.file)) continue;

    const file = path.resolve(root, d.file);
    let source: string;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const entry = (files[file] ??= {
      hash: createHash("sha256").update(source).digest("hex").slice(0, 16),
      text: "",
    });
    entry.text += `${entry.text ? "\n\n" : ""}${renderDiagnostic(d, source, plain)}`;
  }

  const out = path.join(root, PROBLEMS_FILE);
  if (!Object.keys(files).length && !fs.existsSync(out)) return;

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ files }, null, 2)}\n`);
  fs.renameSync(tmp, out);
}
