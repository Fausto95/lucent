/**
 * Caches of facts about syntax that depend on a program's checker too.
 * A source file outlives its program when the next one reuses it (an
 * incremental check, program.ts), so facts are kept per checker: a later
 * program's checker computes them again.
 */
import type ts from "typescript";

/** The cache of `checker`'s program in `caches`, made when first asked for. */
export function cacheOf<K extends object, V>(
  caches: WeakMap<ts.TypeChecker, WeakMap<K, V>>,
  checker: ts.TypeChecker,
): WeakMap<K, V> {
  let cache = caches.get(checker);

  if (!cache) {
    cache = new WeakMap();
    caches.set(checker, cache);
  }
  return cache;
}
