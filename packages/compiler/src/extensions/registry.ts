/**
 * The native extensions a compile binds: its context's (compile-context.ts),
 * read where `lucent:ext/<name>` resolves and where its handles and
 * functions are lowered.
 */
import { currentCompile } from "../compile-context.ts";
import type { ExtensionBinding, FunctionBinding, HandleBinding } from "./bind.ts";

/** The extensions the compile running binds (none outside a compile). */
export function boundExtensions(): readonly ExtensionBinding[] {
  return currentCompile()?.extensions ?? [];
}

export function findExtension(name: string): ExtensionBinding | undefined {
  return boundExtensions().find((e) => e.name === name);
}

/** A handle class of an extension. */
export function findHandle(extension: string, name: string): HandleBinding | undefined {
  return findExtension(extension)?.handles.find((h) => h.name === name);
}

/** A function of an extension, by its C name. */
export function findFunction(extension: string, name: string): FunctionBinding | undefined {
  return findExtension(extension)?.functions.find((f) => f.name === name);
}
