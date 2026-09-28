import fs from "node:fs";
import path from "node:path";

/** Every file under `dir`. */
export function filesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesIn(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** The cached schemas of `module`, wherever the cache keeps them. */
export const schemaFiles = (cacheDir: string, module: string) =>
  filesIn(cacheDir).filter(
    (f) => f.endsWith(".json") && fs.readFileSync(f, "utf8").includes(`"module":"${module}"`),
  );
