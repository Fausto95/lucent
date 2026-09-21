import { checkModule } from "./checker/index.ts";
import type { Diagnostic } from "./diagnostics/index.ts";
import type { IRModule } from "./ir/types.ts";
import { lowerModule } from "./lowering/index.ts";
import { parseModule } from "./parser/index.ts";

export type { Diagnostic, DiagnosticCode, Span } from "./diagnostics/index.ts";
export { DIAGNOSTIC_CODES, renderDiagnostic } from "./diagnostics/index.ts";
export type * from "./ir/types.ts";
export { printIR } from "./ir/print.ts";
export type { NativeType } from "./types/native-type.ts";
export { typeToString, typeEquals, isNumeric, T } from "./types/native-type.ts";

export const COMPILER_VERSION = "0.0.0";

export interface CompileOptions {
  fileName: string;
}

export interface CompileResult {
  module: IRModule | null;
  diagnostics: Diagnostic[];
}

/** Source text in, IR and diagnostics out. Stops after the first phase that reports an error. */
export function compile(source: string, options: CompileOptions): CompileResult {
  const parsed = parseModule(source, options.fileName);
  if (parsed.diagnostics.length) return { module: null, diagnostics: parsed.diagnostics };
  const checked = checkModule(parsed.module);
  if (!checked.module) return { module: null, diagnostics: checked.diagnostics };
  const lowered = lowerModule(checked.module);
  return { module: lowered.module, diagnostics: lowered.diagnostics };
}
