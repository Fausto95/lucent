import { type Diagnostic, formatDiagnostic } from "./diagnostics.ts";
import { emitProgram, type EmitResult } from "./emit/index.ts";
import { createLucentProgram, findLucentFiles, type ReadSource } from "./program.ts";

export { Codes, formatDiagnostic, type Diagnostic } from "./diagnostics.ts";
export { findLucentFiles, moduleNameOf, LUCENT_EXTENSION, coreTypesPath, type ReadSource } from "./program.ts";
export type { EmitResult } from "./emit/index.ts";
export { inputsKey, isUpToDate, writeNativePackage, runtimeDir, type WriteResult } from "./native-package.ts";
export { watchBuild, type WatchEvent } from "./watch.ts";

export interface CompileResult extends EmitResult {
  ok: boolean;
}

/** Compiles `*.lucent.ts` files to C++ sources and JS proxies. */
export function compile(files: string[]): CompileResult {
  const program = createLucentProgram(files);
  // Stop at TypeScript errors: the checker's types are unreliable past them.
  if (program.diagnostics.length) {
    return { files: new Map(), proxies: new Map(), diagnostics: program.diagnostics, ok: false };
  }
  const result = emitProgram(program);
  return { ...result, ok: result.diagnostics.length === 0 };
}

/**
 * Diagnostics for editors: checks `files` (the project's `*.lucent.ts`
 * modules) as `compile` does, reading unsaved text through `readSource`.
 */
export function checkSources(files: string[], readSource?: ReadSource): Diagnostic[] {
  const program = createLucentProgram(files, readSource);
  if (program.diagnostics.length) return program.diagnostics;
  return emitProgram(program).diagnostics;
}

export function compileDirectory(root: string): CompileResult {
  return compile(findLucentFiles(root));
}

export function report(diagnostics: Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join("\n");
}
