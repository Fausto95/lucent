import { type Diagnostic, formatDiagnostic } from "./diagnostics.ts";
import { emitProgram, type EmitResult } from "./emit/index.ts";
import { conformanceErrors, declarationErrors, missingImplementations, planModules, type Target } from "./platforms.ts";
import { builtinSdkModuleOf, createLucentProgram, findLucentFiles, type LucentProgram, type ReadSource, sdkModuleOf } from "./program.ts";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { PLATFORMS, type SdkOptions, withSdkOptions } from "./sdk/schema.ts";

export { CodeDescriptions, Codes, formatDiagnostic, type Code, type Diagnostic } from "./diagnostics.ts";
export { findLucentFiles, moduleNameOf, platformOf, projectFiles, LUCENT_EXTENSION, coreTypesPath, type ReadSource } from "./program.ts";
export { withGradleDependencies } from "./native-package.ts";
export { lucentPackages, lucentVersion, nativeDependencies, satisfies, type LucentPackage, type NativeDependencies, type PackageNative } from "./packages.ts";
export type { EmitResult } from "./emit/index.ts";
export type { Target } from "./platforms.ts";
export type { SdkOptions } from "./sdk/schema.ts";
export type { Platform, SdkCallable, SdkClassSchema, SdkEnumSchema, SdkMethodSchema, SdkModuleSchema, SdkParam, SdkPropertySchema } from "./sdk/schema.ts";
export { sdkDts } from "./sdk/dts.ts";
export { inputsKey, isUpToDate, writeNativePackage, runtimeDir, type WriteResult } from "./native-package.ts";
export { watchBuild, type WatchEvent } from "./watch.ts";
export { forgetLoadedSdks, podsSearchPaths, prefetch as prefetchSdk, sdkAvailable, sdkModule, sdkModules } from "@lucent-lang/bindgen";

export interface CompileResult extends EmitResult {
  ok: boolean;
}

export interface CompileOptions {
  /**
   * Targets to generate code for when the project has platform modules
   * (`*.ios.lucent.ts`, `*.android.lucent.ts`); each gets a complete set of
   * files under `<target>/`. Default: the platforms whose SDK is installed
   * (all of them when none is, so the diagnostics say what is missing).
   */
  platforms?: Target[];
  /** Unsaved editor text, for files that differ from disk. */
  readSource?: ReadSource;
  /** Where the platform SDKs are, and the schema cache (default: the installed SDKs, ~/.cache/lucent). */
  sdk?: SdkOptions;
}

/** Compiles `*.lucent.ts` files to C++ sources and JS proxies. */
export function compile(files: string[], options: CompileOptions = {}): CompileResult {
  return withSdkOptions(options.sdk, () => compileWith(files, options));
}

function compileWith(files: string[], options: CompileOptions): CompileResult {
  const plan = planModules(files);
  if (!plan.platformModules.length && !plan.diagnostics.length) return compileOnce(createLucentProgram(files, options.readSource));

  const out: CompileResult = { files: new Map(), proxies: new Map(), diagnostics: [...plan.diagnostics], ok: false };
  const declarations = plan.platformModules.map((pm) => pm.declaration!);
  const installed = PLATFORMS.filter((p) => sdkAvailable(p, options.sdk));
  for (const target of options.platforms ?? (installed.length ? installed : PLATFORMS)) {
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
      collectTypes(lp, (out.types ??= new Map()));
    }
    out.diagnostics.push(...result.diagnostics);
    for (const [name, content] of result.files) out.files.set(`${target}/${name}`, content);
    for (const [name, proxy] of result.proxies) out.proxies.set(name, proxy);
    if (target === "ios") out.frameworks = result.frameworks;
    if (target === "android") {
      out.java = result.java;
      out.javaKeep = result.javaKeep;
      out.androidPermissions = result.androidPermissions;
    }
  }
  out.diagnostics = dedupe(out.diagnostics);
  out.ok = out.diagnostics.length === 0;
  if (!out.ok) {
    out.files.clear();
    out.proxies.clear();
  }
  return out;
}

/** The lucent:* declarations a platform program loaded (imports and what they reference). */
function collectTypes(lp: LucentProgram, into: Map<string, string>): void {
  for (const sf of lp.program.getSourceFiles()) {
    const sdk = sdkModuleOf(sf);
    if (sdk) into.set(`${sdk.platform}/${sdk.module}.d.ts`, sf.text);
    const builtin = builtinSdkModuleOf(sf);
    if (builtin) into.set(`${builtin.slice("lucent:".length)}.d.ts`, sf.text);
  }
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
