import fs from "node:fs";
import path from "node:path";
import { type Code, Codes, docsUrl, Explanations } from "./codes.ts";
import { CompileError, type Diagnostic, formatDiagnostic, toDiagnostic } from "./diagnostics.ts";
import { emitProgram, type EmitResult } from "./emit/index.ts";
import {
  conformanceErrors,
  declarationErrors,
  inUntypedPlatformCode,
  missingImplementations,
  planModules,
  platformScopes,
  type Target,
} from "./platforms.ts";
import {
  builtinSdkModuleOf,
  createLucentProgram,
  findLucentFiles,
  type LucentProgram,
  moduleNameOf,
  platformOf,
  projectFiles,
  type ReadSource,
  sdkModuleOf,
  usesPlatforms,
} from "./program.ts";
import { sdkAvailable, type UsedSymbol } from "@lucent-lang/bindgen";
import {
  type Platform,
  PLATFORMS,
  platformSdkTyped,
  type SdkOptions,
  withSdkOptions,
} from "./sdk/schema.ts";
import type { ExtensionBinding } from "./extensions/bind.ts";
import { bindExtensions } from "./extensions/bind.ts";
import { extensionDts } from "./extensions/dts.ts";
import { withExtensions } from "./extensions/registry.ts";
import { resolveNative } from "./package-config.ts";
import { fileHashes } from "./package-files.ts";
import { ignoreCompatible, incompatibility, lucentPackageOf, lucentPackages } from "./packages.ts";
import { recordReads } from "./reads.ts";
import { recordSdkUses } from "./sdk/usage.ts";
import { analyzeViews, hasComponentModules } from "./ui/analyze.ts";
import { ts as js } from "@lucent-lang/codegen";
import type { ComponentDescription } from "./ui/contract.ts";
import { componentDeclarations } from "./ui/proxy.ts";
import { mergeComponents, type TargetComponents } from "./ui/merge.ts";

export {
  Codes,
  docsUrl,
  Explanations,
  type Code,
  type Example,
  type Explanation,
} from "./codes.ts";
export { formatDiagnostic, type Diagnostic } from "./diagnostics.ts";
export { type BuildIdentity, identityScript, RUNTIME_ABI } from "./emit/identity.ts";
export { moduleNamespace } from "./types.ts";
export {
  findLucentFiles,
  moduleNameOf,
  platformOf,
  projectFiles,
  usesPlatforms,
  coreJsPath,
  coreTypesPath,
  type ReadSource,
} from "./program.ts";
export { closesPodspec, libraryBuildGradle, withPodDependencies } from "./native-build-files.ts";
export { fileHashes, type FileHashes, inNativePackage } from "./package-files.ts";
export { coverage as sdkCoverage, type Coverage as SdkCoverage } from "@lucent-lang/bindgen";
export {
  jsxToolkits,
  toolkitModules,
  toolkitModuleText,
  toolkitsFrom,
} from "./ui/toolkit-modules.ts";
export { viewCoverage, type ViewCoverage } from "./ui/view-coverage.ts";
export {
  LUCENT_EXTENSION,
  lucentPackages,
  ignoreCompatible,
  incompatibility,
  lucentVersion,
  satisfies,
  type LucentPackage,
} from "./packages.ts";
export { currentReads, currentRealpaths, foundFile, readsKey } from "./reads.ts";
export {
  EXTENSION_FIELDS,
  PACKAGE_FIELDS,
  resolveNative,
  type ExtensionDeclaration,
  type ExtensionInput,
  type ResolvedExtension,
  type Agreed,
  type From,
  type PackagePath,
  type NativeInputs,
  type PackageNative,
  type PlistValue,
  type ResolvedNative,
} from "./package-config.ts";
export type { EmitResult } from "./emit/index.ts";
export {
  VIEW_CONTRACT_VERSION,
  type CommandDescription,
  type CommandResult,
  type ComponentDescription,
  type EventDelivery,
  type EventDescription,
  type PlatformBinding,
  type ViewField,
  type ViewType,
} from "./ui/contract.ts";
export type { Target } from "./platforms.ts";
export type { SdkOptions } from "./sdk/schema.ts";
export type {
  Platform,
  SdkCallable,
  SdkClassSchema,
  SdkEnumSchema,
  SdkMethodSchema,
  SdkModuleSchema,
  SdkParam,
  SdkPropertySchema,
} from "./sdk/schema.ts";
export { sdkDts } from "./sdk/dts.ts";
export {
  bindExtensions,
  forgetExtensionHeaders,
  type ExtensionBinding,
  type FunctionBinding,
  type HandleBinding,
} from "./extensions/bind.ts";
export { extensionDts } from "./extensions/dts.ts";
export {
  checkRecord,
  type CheckRecord,
  deferredLibraryGradle,
  inputsKey,
  packagePods,
  upToDate,
  writeNativePackage,
  writeWhole,
  runtimeDir,
  type WriteResult,
} from "./native-package.ts";
export {
  cachedModules,
  extractionCount,
  forgetLoadedSdks,
  sdkNames,
  podsSearchPaths,
  prefetch as prefetchSdk,
  sdkAvailable,
} from "@lucent-lang/bindgen";
export { sdkDeclarations, sdkModule, sdkModules } from "./sdk/modules.ts";

export interface CompileResult extends EmitResult {
  ok: boolean;
  /** The SDK symbols the code uses, sorted by key; absent when the compile failed. */
  sdkUses?: UsedSymbol[];
  /** Every file the compile read from disk, with what it found there (see currentReads). */
  read: ReadonlyMap<string, string>;
  /** Every path resolution followed links from, with where it led (see currentRealpaths). */
  realpaths: ReadonlyMap<string, string>;
}

/** What a program, or each target's, compiles to: compile() adds the files they read. */
type Compiled = Omit<CompileResult, "read" | "realpaths">;

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
  /** The native extensions `lucent:ext/<name>` imports, bound (bindExtensions). */
  extensions?: readonly ExtensionBinding[];
  /**
   * Platforms whose SDK imports resolve only later (Android's, from the
   * app's dependencies, which its Gradle build resolves). They are not
   * targets (asking for one throws), and the other targets' programs leave
   * their code untyped, as for a platform whose SDK is not installed: their
   * own build checks it.
   */
  deferred?: Platform[];
}

/** Compiles `*.lucent.ts` files to C++ sources and JS proxies. */
export function compile(files: string[], options: CompileOptions = {}): CompileResult {
  const deferred = options.deferred ?? [];
  const targeted = deferred.filter((p) => options.platforms?.includes(p));
  if (targeted.length)
    throw new Error(`deferred platforms cannot be targets: ${targeted.join(", ")}`);

  const {
    value: { value: result, uses },
    read,
    realpaths,
  } = recordReads(() =>
    recordSdkUses(() =>
      withExtensions(options.extensions, () =>
        withSdkOptions(options.sdk, () => compileWith(files, options), deferred),
      ),
    ),
  );

  // The Lucent packages of the files whose `compatible` range leaves this Lucent out.
  const incompatible = packageProblems(files);
  const ignored = ignoreCompatible();
  if (incompatible.length && !ignored) {
    result.ok = false;
    result.diagnostics.push(...incompatible);
  } else if (incompatible.length)
    (result.warnings ??= []).push(
      ...incompatible.map((d) => ({ ...d, severity: "warning" as const })),
    );

  // Every extension's declarations, for editors and tsc: what an import resolves to.
  const types = new Map(result.types ?? []);
  for (const ext of options.extensions ?? []) types.set(`ext/${ext.name}.d.ts`, extensionDts(ext));

  return {
    ...result,
    ...(types.size ? { types } : {}),
    ...(result.ok ? { sdkUses: uses } : {}),
    diagnostics: result.diagnostics.map(explained),
    warnings: (result.warnings ?? []).map(explained),
    read,
    realpaths,
  };
}

/** LUCENT3013 for each Lucent package of `files` this Lucent is outside the range of, at its package.json. */
function packageProblems(files: readonly string[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];

  for (const f of files) {
    const pkg = lucentPackageOf(f);
    if (!pkg || seen.has(pkg.dir)) continue;
    seen.add(pkg.dir);

    const why = incompatibility(pkg);
    if (why)
      out.push({
        code: Codes.IncompatiblePackage,
        message: why,
        file: path.join(pkg.dir, "package.json"),
      });
  }

  return out;
}

/** A diagnostic with its code's usual fix, unless it names its own, and where the code is explained. */
function explained(d: Diagnostic): Diagnostic {
  const e = Explanations[d.code as Code] as (typeof Explanations)[Code] | undefined;
  return e ? { ...d, fix: d.fix ?? e.fix, docs: docsUrl(d.code) } : d;
}

function compileWith(files: string[], options: CompileOptions): Compiled {
  const plan = planModules(files);
  // Shared modules that branch on the platform are compiled per target too.
  const branching = plan.shared.some((f) => usesPlatforms(f, options.readSource));
  if (!plan.platformModules.length && !plan.diagnostics.length && !branching)
    return compileOnce(createLucentProgram(files, options.readSource));

  const out: Compiled = {
    files: new Map(),
    proxies: new Map(),
    diagnostics: [...plan.diagnostics],
    ok: false,
  };
  const declarations = plan.platformModules.map((pm) => pm.declaration!);
  const installed = PLATFORMS.filter(
    (p) => sdkAvailable(p, options.sdk) && !options.deferred?.includes(p),
  );
  const components: TargetComponents[] = [];
  for (const target of options.platforms ?? (installed.length ? installed : PLATFORMS)) {
    let result: Compiled;
    if (target === "host") {
      result = compileOnce(
        createLucentProgram([...plan.shared, ...declarations], options.readSource, undefined, {
          stubs: declarations,
        }),
        declarations,
        target,
      );
    } else {
      const missing = missingImplementations(plan, target);
      if (missing.length) {
        out.diagnostics.push(...missing);
        continue;
      }
      const impls = plan.platformModules.map((pm) => pm.implementations[target]!);
      const lp = createLucentProgram([...plan.shared, ...impls], options.readSource, target, {
        references: declarations,
      });
      result = compileOnce(lp, declarations);
      collectTypes(lp, (out.types ??= new Map()));
    }
    out.diagnostics.push(...result.diagnostics);
    (out.warnings ??= []).push(...(result.warnings ?? []));
    if (result.ok) components.push({ target, components: result.components ?? [] });
    for (const [name, content] of result.files) out.files.set(`${target}/${name}`, content);
    for (const [name, proxy] of result.proxies) out.proxies.set(name, proxy);
    if (result.identity) {
      const identity = (out.identity ??= { ...result.identity, programs: {}, apis: {} });

      Object.assign(identity.programs, result.identity.programs);
      Object.assign(identity.apis, result.identity.apis);
    }
    if (target === "ios") {
      out.frameworks = result.frameworks;
      out.pods = result.pods;
      out.swiftPackages = result.swiftPackages;
    }
    if (target === "android") {
      out.java = result.java;
      out.javaKeep = result.javaKeep;
      out.kotlin = result.kotlin;
      out.compose = result.compose;
      out.androidPermissions = result.androidPermissions;
    }
  }
  // Targets that failed have no descriptions to compare.
  if (!out.diagnostics.length) {
    const merged = mergeComponents(components);

    out.diagnostics.push(...merged.diagnostics);
    if (merged.components.length) out.components = merged.components;
    if (merged.components.length) {
      out.componentTypes = componentTypeFiles(merged.components);
      out.componentModules = componentModuleFiles(merged.components, [
        ...plan.shared,
        ...declarations,
      ]);
    }
  }
  out.diagnostics = dedupe(out.diagnostics);
  out.warnings = dedupe(out.warnings ?? []);
  out.ok = out.diagnostics.length === 0;
  if (!out.ok) {
    out.files.clear();
    out.proxies.clear();
    delete out.identity;
  }
  return out;
}

/** The lucent:* declarations a platform program loaded (imports and what they reference). */
function collectTypes(lp: LucentProgram, into: Map<string, string>): void {
  // Another target's program may hold a module by its names only (its JSX runtime names
  // UIView): a full declaration, from a program that imports the module, wins.
  const namesOnly = (text: string | undefined) => text?.startsWith("// Names only:") ?? true;

  for (const sf of lp.program.getSourceFiles()) {
    const sdk = sdkModuleOf(sf);
    const file = sdk && `${sdk.platform}/${sdk.module}.d.ts`;
    if (file && (namesOnly(into.get(file)) || !namesOnly(sf.text))) into.set(file, sf.text);
    const builtin = builtinSdkModuleOf(sf);
    if (builtin) into.set(`${builtin.slice("lucent:".length)}.d.ts`, sf.text);
  }
}

function compileOnce(
  lp: ReturnType<typeof createLucentProgram>,
  declarations: string[] = [],
  target?: Target,
): Compiled {
  let result: Compiled;
  try {
    result = compileChecked(lp, declarations, target);
  } catch (e) {
    // Lowering outside a guarded unit: still a diagnostic, never a crash.
    if (!(e instanceof CompileError)) throw e;
    result = { files: new Map(), proxies: new Map(), diagnostics: [toDiagnostic(e)], ok: false };
  }
  if (result.ok) return result;
  // Several passes may lower the same failing node; a failed compile has no output.
  return {
    ...result,
    files: new Map(),
    proxies: new Map(),
    diagnostics: dedupe(result.diagnostics),
  };
}

function compileChecked(
  lp: ReturnType<typeof createLucentProgram>,
  declarations: string[],
  target: Target | undefined,
): Compiled {
  const untyped = PLATFORMS.filter((p) => p !== lp.platform && !platformSdkTyped(p));
  const checks = [
    ...lp.diagnostics.filter((d) => !inUntypedPlatformCode(lp, d, untyped)),
    ...declarations.flatMap((d) => declarationErrors(lp, d)),
    ...lp.modules
      .filter((m) => !platformOf(m.file))
      .flatMap((m) => platformScopes(lp.checker, m.sourceFile).errors),
  ];
  // Stop at TypeScript errors: the checker's types are unreliable past them.
  if (checks.length)
    return { files: new Map(), proxies: new Map(), diagnostics: checks, ok: false };
  const conformance = conformanceErrors(lp);
  if (conformance.length)
    return { files: new Map(), proxies: new Map(), diagnostics: conformance, ok: false };
  // Components are described, not emitted as module functions.
  const views = hasComponentModules(lp) ? analyzeViews(lp) : undefined;
  if (views?.diagnostics.length)
    return { files: new Map(), proxies: new Map(), diagnostics: views.diagnostics, ok: false };

  const fabric = views?.components.length ? views.components : undefined;
  const { identity, ...result } = emitProgram(
    lp,
    target,
    views?.declarations,
    fabric,
    fabric ? views?.setups : undefined,
    views?.mainState,
  );
  const ok = result.diagnostics.length === 0;
  const components = views?.components.length ? { components: views.components } : {};

  return { ...result, ...components, ...(ok ? { identity } : {}), ok };
}

/** Each module's components' React-facing declarations. */
function componentTypeFiles(components: readonly ComponentDescription[]): Map<string, string> {
  const out = new Map<string, string>();

  for (const name of [...new Set(components.map((c) => c.jsModule))].sort())
    out.set(
      name,
      js.printUnit(componentDeclarations(components.filter((c) => c.jsModule === name))),
    );

  return out;
}

/** The file JavaScript imports for each module with components, among the non-platform `files`. */
function componentModuleFiles(
  components: readonly ComponentDescription[],
  files: readonly string[],
): Map<string, string> {
  const modules = new Set(components.map((c) => c.jsModule));

  return new Map(
    files
      .map((file) => [moduleNameOf(file), path.resolve(file)] as const)
      .filter(([name]) => modules.has(name)),
  );
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
export function checkSources(
  files: string[],
  readSource?: ReadSource,
  options: { extensions?: readonly ExtensionBinding[] } = {},
): Diagnostic[] {
  const r = compile(files, { readSource, ...options });
  return [...r.diagnostics, ...(r.warnings ?? [])];
}

/**
 * The native extensions of the Lucent packages `root` depends on, bound;
 * none when they cannot be (the build reports why): for editors, whose
 * checks should not fail on what the build explains.
 */
export function projectExtensions(root: string): ExtensionBinding[] {
  // The build's file hashes, by their stats: a check re-reads only what changed.
  const hashes = fileHashes(path.join(root, ".lucent/file-hashes.json"));

  try {
    const bound = bindExtensions(resolveNative(lucentPackages(root), { hashes }).extensions);
    hashes.save();
    return bound;
  } catch {
    return [];
  }
}

/**
 * The files of `files` (an editor's project) that `lucent build` compiles
 * in `root`: not those of a Lucent package inside the app that the app
 * does not depend on. All of them when root's packages cannot be resolved
 * (the build reports why).
 */
export function filesInBuild(root: string, files: readonly string[]): string[] {
  let built: Set<string>;
  try {
    built = new Set(projectFiles(root).map((f) => fs.realpathSync(f)));
  } catch {
    return [...files];
  }

  return files.filter((f) => fs.existsSync(f) && built.has(fs.realpathSync(f)));
}

export function compileDirectory(root: string): CompileResult {
  return compile(findLucentFiles(root));
}

export function report(diagnostics: Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join("\n");
}
