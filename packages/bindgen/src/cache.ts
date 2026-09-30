/**
 * The extraction cache's files: entries published whole or not at all,
 * read back as a miss when they are not whole, and one writer per entry,
 * whose lock outlives it only until another process sees it died.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Default: $LUCENT_CACHE_DIR, else $XDG_CACHE_HOME/lucent, else ~/.cache/lucent. */
export function cacheRoot(dir?: string): string {
  if (dir) return dir;
  if (process.env.LUCENT_CACHE_DIR) return process.env.LUCENT_CACHE_DIR;

  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "lucent");
}

/** A short hash of `parts`, for file names and keys. */
export const hash = (parts: string[]) =>
  crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);

const tmpName = (file: string) => `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;

/** Writes `data` as JSON: readers see the previous file or the whole new one, never a part. */
export function publish(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = tmpName(file);
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** A cache file's JSON, or undefined when it is missing or not whole: a miss, never an error. */
export function readCached(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A lock nobody will release: its writer died on this host, or it is older than any extraction. */
function stale(lock: string): boolean {
  let text: string;
  let age: number;
  try {
    text = fs.readFileSync(lock, "utf8");
    age = Date.now() - fs.statSync(lock).mtimeMs;
  } catch {
    // Released meanwhile: not stale, taken again next round.
    return false;
  }

  if (age > 600_000) return true;

  const [host, pid] = text.split("\n");
  if (host !== os.hostname() || !Number(pid)) return false;

  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Creates `lock` holding this process's host and pid, all at once; false when it exists. */
function acquire(lock: string): boolean {
  const tmp = tmpName(lock);
  fs.writeFileSync(tmp, `${os.hostname()}\n${process.pid}\n`);

  try {
    fs.linkSync(tmp, lock);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Runs `f` holding `<file>.lock`, so concurrent builds and prefetches
 * extract an entry once; undefined when another process did it (`done`,
 * checked again once the lock is ours). A dead writer's lock is taken
 * over at once. Two waiters that
 * both see it dead may both extract: publishing is atomic, so the entry
 * stays whole either way.
 */
export function withLock<T>(file: string, done: () => boolean, f: () => T): T | undefined {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });

  while (!acquire(lock)) {
    if (done()) return undefined;

    if (stale(lock)) fs.rmSync(lock, { force: true });
    else sleep(100);
  }

  try {
    // The writer before us may have just published it.
    return done() ? undefined : f();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/**
 * `compute()` for `files`, remembered in `dir` by their paths, sizes, times
 * and inodes: a memo in front of what their contents give (a content hash,
 * an index of names), never itself a key. `what` names the value.
 */
export function memoByStat<T>(dir: string, what: string, files: string[], compute: () => T): T {
  const stats = files.map((f) => {
    const st = fs.statSync(f);
    return `${f}\0${st.size}\0${st.mtimeMs}\0${st.ctimeMs}\0${st.ino}`;
  });
  const file = path.join(dir, `${what}-${hash(stats)}.json`);

  const hit = readCached(file) as { value: T } | undefined;
  if (hit) return hit.value;

  const value = compute();
  publish(file, { value });

  return value;
}

/**
 * Creates `dir` whole, if it is not there yet: `fill` writes a temporary
 * sibling, renamed into place. A process that published the same `dir`
 * first wins; its contents are the same, `dir` being named after them.
 */
export function publishDir(dir: string, fill: (tmp: string) => void): void {
  if (fs.existsSync(dir)) return;

  const tmp = tmpName(dir);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    fill(tmp);
    fs.renameSync(tmp, dir);
  } catch (e) {
    if (!fs.existsSync(dir)) throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
