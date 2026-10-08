/** Where generated code says its source is. */
import fs from "node:fs";
import path from "node:path";

let root: string | undefined;
const sourcePaths = new Map<string, string>();

const canonical = (p: string) => {
  const abs = path.resolve(p);

  return fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
};

/** Runs `f` with sources named relative to the project at `dir` (default: the working directory). */
export function withSourceRoot<T>(dir: string | undefined, f: () => T): T {
  const saved = root;
  root = canonical(dir ?? process.cwd());
  sourcePaths.clear();

  try {
    return f();
  } finally {
    root = saved;
    sourcePaths.clear();
  }
}

/**
 * A source file's path as `#line`, error sites and trace sites name it:
 * relative to the project, with `/`, so no machine's directories reach
 * the binary (builds set the debug compilation directory to the project,
 * where debuggers find it). A file outside the project keeps its
 * canonical absolute path.
 */
export function sourcePath(fileName: string): string {
  let p = sourcePaths.get(fileName);

  if (p === undefined) {
    const abs = canonical(fileName);
    const base = root ?? canonical(process.cwd());
    const rel = path.relative(base, abs);

    p = (rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : abs).replace(/\\/g, "/");
    sourcePaths.set(fileName, p);
  }
  return p;
}
