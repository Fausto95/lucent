import { watch } from "node:fs";
import { SKIP_DIRS } from "./index.ts";

const WATCHED: readonly RegExp[] = [/\.lucent\.tsx?$/, /^lucent\.config\.(ts|json)$/, /\.library\.json$/];

/** Root-relative paths whose change should trigger a rebuild. */
export function isWatchedPath(path: string): boolean {
  const directories = path.split(/[\\/]/).slice(0, -1);
  if (directories.some((dir) => SKIP_DIRS.has(dir) || dir.startsWith("."))) return false;
  return WATCHED.some((pattern) => pattern.test(path));
}

export function createDebouncer(fn: () => void, delayMs: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, delayMs);
  };
}

/** Recursive watch on the project root; `onChange` receives the changed root-relative paths, coalesced. */
export function watchProject(root: string, onChange: (paths: string[]) => void, delayMs = 150): { close(): void } {
  const pending = new Set<string>();
  const flush = createDebouncer(() => {
    const paths = [...pending].toSorted();
    pending.clear();
    onChange(paths);
  }, delayMs);
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const path = filename === null ? "" : String(filename);
    if (!isWatchedPath(path)) return;
    pending.add(path);
    flush();
  });
  return { close: () => watcher.close() };
}
