/** Filesystem boundary for CLI and Metro; the compiler receives source text only. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lucentImports, moduleCandidates } from "@lucent-lang/compiler";

export function loadLucentSources(fileName: string, source?: string): Record<string, string> {
  const sources: Record<string, string> = {};
  const visit = (file: string, text?: string): void => {
    if (file in sources) return;
    sources[file] = text ?? readFileSync(file, "utf8");
    for (const specifier of lucentImports(sources[file]!, file)) {
      for (const candidate of moduleCandidates(file, specifier)) {
        if (existsSync(candidate)) visit(candidate);
      }
    }
  };
  visit(resolve(fileName), source);
  return sources;
}
