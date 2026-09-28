/** Where generated code says its source is. */
import fs from "node:fs";
import path from "node:path";

const sourcePaths = new Map<string, string>();

/** The canonical absolute path of a source file, as debuggers resolve it. */
export function sourcePath(fileName: string): string {
  let p = sourcePaths.get(fileName);

  if (p === undefined) {
    const abs = path.resolve(fileName);

    p = (fs.existsSync(abs) ? fs.realpathSync(abs) : abs).replace(/\\/g, "/");
    sourcePaths.set(fileName, p);
  }
  return p;
}
