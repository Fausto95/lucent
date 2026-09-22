import { validNativeTargets, type NativeTargets } from "./native-contracts.ts";
import { diagnostic } from "./diagnostics/index.ts";
import { platformSafety } from "./checker/platform.ts";
import { threadSafety } from "./checker/safety.ts";
import type { LibraryModule } from "./libraries.ts";
import { checkModule } from "./checker/index.ts";
import type { Diagnostic } from "./diagnostics/index.ts";
import type { IRModule } from "./ir/types.ts";
import { lowerModule } from "./lowering/index.ts";
import { linkModule } from "./linker.ts";

export type { Diagnostic, DiagnosticCode, Span } from "./diagnostics/index.ts";
export { DIAGNOSTIC_CODES, renderDiagnostic } from "./diagnostics/index.ts";
export type * from "./ir/types.ts";
export { printIR } from "./ir/print.ts";
export type { NativeType } from "./types/native-type.ts";
export { typeToString, typeEquals, isNumeric, T } from "./types/native-type.ts";

export const COMPILER_VERSION = "0.6.5";

export interface CompileOptions {
  targets?: NativeTargets;
  fileName: string;
  /** Dependency source texts, resolved by the caller; the compiler never reads files. */
  sources?: Readonly<Record<string, string>>;
  libraries?: Readonly<Record<string, LibraryModule>>;
}

export interface CompileResult {
  module: IRModule | null;
  diagnostics: Diagnostic[];
}

/** Source text in, IR and diagnostics out. Stops after the first phase that reports an error. */
export function compile(source: string, options: CompileOptions): CompileResult {
  if (options.targets !== undefined && !validNativeTargets(options.targets))
    return {
      module: null,
      diagnostics: [diagnostic("LUCENT1006", { start: 0, end: 0 }, "Invalid minimum SDK targets.")],
    };
  const parsed = linkModule(source, options.fileName, options.sources ?? {}, options.libraries);
  if (parsed.diagnostics.length) return { module: null, diagnostics: parsed.diagnostics };
  const checked = checkModule(parsed.module);
  if (!checked.module) return { module: null, diagnostics: checked.diagnostics };
  const platformDiagnostics = platformSafety(checked.module.functions, options.targets);
  if (platformDiagnostics.length) return { module: null, diagnostics: platformDiagnostics };
  const lowered = lowerModule(checked.module);
  if (lowered.module && options.targets) lowered.module.targets = { ...options.targets };
  return { module: lowered.module, diagnostics: [...lowered.diagnostics, ...threadSafety(checked.module.functions)] };
}

export { moduleCandidates } from "./linker.ts";
export { lucentImports } from "./parser/index.ts";

export type {
  NativePackage,
  NativeBinding,
  NativeEnumBinding,
  NativeEnumTarget,
  NativeViewBinding,
  NativeReferenceBinding,
  LibraryModule,
  ThreadContext,
} from "./libraries.ts";
export { STANDARD_LIBRARIES } from "./libraries.ts";
export { parseNativeConfig } from "./parser/config.ts";

export { validateLibrary } from "./library-validation.ts";

export { runtimeKind } from "./checker/boundaries.ts";

export { nativeSymbolId, validNativeTargets } from "./native-contracts.ts";
export type * from "./native-contracts.ts";
