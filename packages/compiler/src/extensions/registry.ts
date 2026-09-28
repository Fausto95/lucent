/**
 * The native extensions a compile binds: set for the compile's duration,
 * as the SDK options are, and read where `lucent:ext/<name>` resolves and
 * where its handles and functions are lowered.
 */
import type { ExtensionBinding, FunctionBinding, HandleBinding } from "./bind.ts";

let bound: readonly ExtensionBinding[] = [];

/** Runs `f` with `extensions` bound (none when undefined). */
export function withExtensions<T>(
  extensions: readonly ExtensionBinding[] | undefined,
  f: () => T,
): T {
  const saved = bound;
  bound = extensions ?? [];

  try {
    return f();
  } finally {
    bound = saved;
  }
}

export function boundExtensions(): readonly ExtensionBinding[] {
  return bound;
}

export function findExtension(name: string): ExtensionBinding | undefined {
  return bound.find((e) => e.name === name);
}

/** A handle class of an extension. */
export function findHandle(extension: string, name: string): HandleBinding | undefined {
  return findExtension(extension)?.handles.find((h) => h.name === name);
}

/** A function of an extension, by its C name. */
export function findFunction(extension: string, name: string): FunctionBinding | undefined {
  return findExtension(extension)?.functions.find((f) => f.name === name);
}
