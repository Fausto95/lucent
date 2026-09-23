import { type Diagnostic, formatDiagnostic } from "./diagnostics.ts";
import { emitProgram, type EmitResult } from "./emit/index.ts";
import { createLucentProgram, findLucentFiles } from "./program.ts";

export { Codes, formatDiagnostic, type Diagnostic } from "./diagnostics.ts";
export { findLucentFiles, moduleNameOf, LUCENT_EXTENSION, coreTypesPath } from "./program.ts";
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

export function compileDirectory(root: string): CompileResult {
  return compile(findLucentFiles(root));
}

export function report(diagnostics: Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join("\n");
}
