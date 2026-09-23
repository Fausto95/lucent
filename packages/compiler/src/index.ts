import { type Diagnostic, formatDiagnostic } from "./diagnostics.ts";
import { emitProgram, type EmitResult } from "./emit/index.ts";
import { conformanceErrors, declarationErrors, missingImplementations, planModules, type Target } from "./platforms.ts";
import { createLucentProgram, findLucentFiles, type ReadSource } from "./program.ts";
import { PLATFORMS } from "./sdk/schema.ts";

export { Codes, formatDiagnostic, type Diagnostic } from "./diagnostics.ts";
export { findLucentFiles, moduleNameOf, platformOf, LUCENT_EXTENSION, coreTypesPath, type ReadSource } from "./program.ts";
export type { EmitResult } from "./emit/index.ts";
export type { Target } from "./platforms.ts";
export type { Platform } from "./sdk/schema.ts";
export { inputsKey, isUpToDate, writeNativePackage, runtimeDir, type WriteResult } from "./native-package.ts";
export { watchBuild, type WatchEvent } from "./watch.ts";

export interface CompileResult extends EmitResult {
  ok: boolean;
}

export interface CompileOptions {
  /**
   * Targets to generate code for when the project has platform modules
   * (`*.ios.lucent.ts`, `*.android.lucent.ts`); each gets a complete set of
   * files under `<target>/`. Default: ios and android.
   */
  platforms?: Target[];
  /** Unsaved editor text, for files that differ from disk. */
  readSource?: ReadSource;
}

/** Compiles `*.lucent.ts` files to C++ sources and JS proxies. */
export function compile(files: string[], options: CompileOptions = {}): CompileResult {
  const plan = planModules(files);
  if (!plan.platformModules.length && !plan.diagnostics.length) return compileOnce(createLucentProgram(files, options.readSource));

  const out: CompileResult = { files: new Map(), proxies: new Map(), diagnostics: [...plan.diagnostics], ok: false };
  const declarations = plan.platformModules.map((pm) => pm.declaration!);
  for (const target of options.platforms ?? PLATFORMS) {
    let result: CompileResult;
    if (target === "host") {
      result = compileOnce(createLucentProgram([...plan.shared, ...declarations], options.readSource, undefined, { stubs: declarations }), declarations);
    } else {
      const missing = missingImplementations(plan, target);
      if (missing.length) {
        out.diagnostics.push(...missing);
        continue;
      }
      const impls = plan.platformModules.map((pm) => pm.implementations[target]!);
      const lp = createLucentProgram([...plan.shared, ...impls], options.readSource, target, { references: declarations });
      result = compileOnce(lp, declarations);
    }
    out.diagnostics.push(...result.diagnostics);
    for (const [name, content] of result.files) out.files.set(`${target}/${name}`, content);
    for (const [name, proxy] of result.proxies) out.proxies.set(name, proxy);
    if (target === "ios") out.frameworks = result.frameworks;
  }
  out.diagnostics = dedupe(out.diagnostics);
  out.ok = out.diagnostics.length === 0;
  if (!out.ok) {
    out.files.clear();
    out.proxies.clear();
  }
  return out;
}

function compileOnce(lp: ReturnType<typeof createLucentProgram>, declarations: string[] = []): CompileResult {
  const checks = [...lp.diagnostics, ...declarations.flatMap((d) => declarationErrors(lp, d))];
  // Stop at TypeScript errors: the checker's types are unreliable past them.
  if (checks.length) return { files: new Map(), proxies: new Map(), diagnostics: checks, ok: false };
  const conformance = conformanceErrors(lp);
  if (conformance.length) return { files: new Map(), proxies: new Map(), diagnostics: conformance, ok: false };
  const result = emitProgram(lp);
  return { ...result, ok: result.diagnostics.length === 0 };
}

/** The same problem, reported by the program of each target, once. */
function dedupe(ds: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return ds.filter((d) => {
    const key = `${d.code}|${d.file}|${d.line}|${d.column}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Diagnostics for editors: checks `files` (the project's `*.lucent.ts`
 * modules) as `compile` does, reading unsaved text through `readSource`.
 */
export function checkSources(files: string[], readSource?: ReadSource): Diagnostic[] {
  return compile(files, { readSource }).diagnostics;
}

export function compileDirectory(root: string): CompileResult {
  return compile(findLucentFiles(root));
}

export function report(diagnostics: Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join("\n");
}
