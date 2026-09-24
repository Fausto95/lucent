import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { compile, type Diagnostic, extractionCount, inputsKey, isUpToDate, lucentPackages, moduleNameOf, moduleNamespace, type NativeDependencies, nativeDependencies, platformOf, projectFiles, sdkAvailable, sdkModule, type Target, usesPlatforms, writeNativePackage } from "@lucent-lang/compiler";
import { backgroundPrefetch, mapLucentPaths, missingInfoPlistKeys, type Notice, projectSdk, resolveAndroidDependencies, sdkImports, writeGradleDependencies } from "./project.ts";
import type { Steps } from "./ui/steps.ts";

export type Platform = "ios" | "android";

export interface ModuleSummary {
  name: string;
  /** The platforms the module has code for, or shared. */
  platforms: (Platform | "shared")[];
}

export interface Next {
  /** Native code changed: rebuild the app. */
  rebuild: boolean;
  /** Native files were added or removed: pod install before the iOS build. */
  podInstall: boolean;
  /** Only the JavaScript proxies changed. */
  reload: boolean;
}

/** What building (or checking) the project did. */
export interface BuildOutcome {
  ok: boolean;
  /** A problem that stopped the build before any module was checked. */
  fatal?: string;
  /** Nothing changed since the last build (or passing check), so nothing ran. */
  upToDate: boolean;
  files: string[];
  modules: ModuleSummary[];
  /** Diagnostics, their files relative to the project. */
  diagnostics: Diagnostic[];
  next: Next;
  ms: number;
}

export interface BuildOptions {
  mode: "build" | "check";
  force?: boolean;
  platforms?: Target[];
  /** Where to write the native package, relative to the project (default .lucent/native). */
  out?: string;
  /** Start background SDK extractions for cold modules (a one-off build; a long session extracts as it goes). */
  prefetch?: boolean;
}

const NONE: Next = { rebuild: false, podInstall: false, reload: false };

/**
 * Builds the project at `root`: its Android dependencies, the SDK bindings
 * its modules import, the check, the C++ and the native package, reported
 * step by step. `check` stops after the check and writes nothing but its
 * record of a pass.
 */
export async function buildProject(root: string, options: BuildOptions, steps: Steps, notify: (n: Notice) => void): Promise<BuildOutcome> {
  const t0 = Date.now();
  const build = options.mode === "build";
  let files: string[] = [];
  let native: NativeDependencies;
  const outcome = (o: Partial<BuildOutcome>): BuildOutcome => ({ ok: false, upToDate: false, files, modules: moduleSummary(files, undefined), diagnostics: [], next: NONE, ms: Date.now() - t0, ...o });
  try {
    files = projectFiles(root);
    native = nativeDependencies(lucentPackages(root));
  } catch (e) {
    return outcome({ fatal: (e as Error).message });
  }
  const sdk = projectSdk(root);
  const outDir = path.resolve(root, options.out ?? ".lucent/native");
  let platforms = options.platforms;
  let deferAndroid = false;

  // A host build has the platform modules' stubs: no Android dependencies to resolve.
  if (build && (!platforms || platforms.includes("android"))) {
    // Packages' Gradle artifacts are on the classpath Lucent binds from: the
    // library declares them before Gradle resolves it.
    writeGradleDependencies(outDir, native);
    steps.start("android-dependencies", "Android dependencies");
    await steps.flush();
    const t = Date.now();
    const deps = resolveAndroidDependencies(root, files, sdk, native, !!options.force);
    const label = "Android dependencies";
    if (deps.status === "resolved") steps.finish({ name: "android-dependencies", label, status: "ok", detail: "resolved with Gradle", ms: Date.now() - t });
    else if (deps.status === "cached") steps.finish({ name: "android-dependencies", label, status: "cached" });
    else if (deps.status === "failed") steps.finish({ name: "android-dependencies", label, status: "failed", detail: deps.detail });
    else if (deps.status === "deferred") {
      deferAndroid = true;
      steps.finish({ name: "android-dependencies", label, status: "skipped", detail: "resolved by the Gradle build" });
      notify({ level: "warn", text: "the app's Android dependencies are not resolved yet: skipped Android here; the Gradle build compiles it (its lucentBuild task)" });
    }
  }

  // Platform code: split platform files, or modules branching on PLATFORM.
  if (!platforms && files.some((f) => platformOf(f) || usesPlatforms(f))) {
    // Build what this machine can: an Android-only Linux host, a Mac without the Android SDK.
    const installed = (["ios", "android"] as const).filter((p) => sdkAvailable(p, sdk) && !(p === "android" && deferAndroid));
    for (const p of ["ios", "android"] as const) {
      if (installed.includes(p) || (p === "android" && deferAndroid)) continue;
      const why = sdkModule(p, p === "ios" ? "Foundation" : "android.os", sdk);
      notify({ level: "warn", text: `${"missing" in why ? why.missing : `no ${p} SDK`}; skipped ${p === "ios" ? "iOS" : "Android"} (build it with --platforms ${p} once the SDK is installed)` });
    }
    if (!installed.length) return outcome({ fatal: "no platform SDK is installed" });
    platforms = installed;
    if (build && options.prefetch) backgroundPrefetch(root, files);
  }

  // The mapping points at the default output.
  if (build && outDir === path.join(root, ".lucent/native")) {
    const mapped = mapLucentPaths(root);
    if (mapped) notify(mapped);
  }

  const modules = moduleSummary(files, platforms);
  const moduleCount = modules.length;
  const key = inputsKey(files, outDir) + (platforms ? `:${platforms.join(",")}` : "") + `:${createHash("sha256").update(JSON.stringify(native)).digest("hex").slice(0, 12)}`;
  // A check of the same inputs passed before: every input is in the key.
  const checked = path.join(root, ".lucent/check.json");
  if (!build && !options.force) {
    const last = fs.existsSync(checked) ? (JSON.parse(fs.readFileSync(checked, "utf8")) as { inputs?: string }) : {};
    if (last.inputs === key) return outcome({ ok: true, upToDate: true, modules });
  }
  if (build && !options.force && isUpToDate(outDir, key)) {
    steps.finish({ name: "up-to-date", label: "Up to date", status: "ok", detail: `${plural(moduleCount, "module")}, nothing to build`, ms: Date.now() - t0 });
    return outcome({ ok: true, upToDate: true, modules });
  }

  // SDK bindings: extracted on first use, then cached per SDK.
  const imports = sdkImports(files);
  const wanted = (["ios", "android"] as const).flatMap((p) => ((platforms ?? []).includes(p) ? imports[p].map((m) => [p, m] as const) : []));
  if (wanted.length) {
    // The first few modules; an app can import dozens.
    const names = wanted.map(([, m]) => m);
    const listed = names.length > 3 ? `${names.slice(0, 3).join(" · ")} +${names.length - 3} more` : names.join(" · ");
    steps.start("sdk", `SDK bindings  ${listed}`);
    await steps.flush();
    const t = Date.now();
    const before = extractionCount();
    for (const [p, m] of wanted) sdkModule(p, m, sdk);
    const extracted = extractionCount() - before;
    steps.finish({ name: "sdk", label: "SDK bindings", status: extracted ? "ok" : "cached", detail: listed, ms: extracted ? Date.now() - t : undefined });
  }

  steps.start("check", `Checking ${plural(moduleCount, "module")}`);
  await steps.flush();
  const tCheck = Date.now();
  const result = compile(files, { platforms, sdk });
  const diagnostics = result.diagnostics.map((d) => ({ ...d, file: d.file && path.relative(root, d.file) }));
  if (!result.ok) {
    steps.finish({ name: "check", label: `Checked ${plural(moduleCount, "module")}`, status: "failed", detail: plural(diagnostics.length, "error"), ms: Date.now() - tCheck });
    return outcome({ modules, diagnostics });
  }
  const names = [...result.proxies.keys()];
  steps.finish({ name: "check", label: `Checked ${plural(names.length, "module")}`, status: "ok", ms: Date.now() - tCheck });
  if (!build) {
    fs.mkdirSync(path.dirname(checked), { recursive: true });
    fs.writeFileSync(checked, `${JSON.stringify({ inputs: key })}\n`);
    return outcome({ ok: true, modules });
  }

  const tWrite = Date.now();
  const w = writeNativePackage(result, outDir, { inputsKey: key, native });
  const written = new Set(w.written.map((f) => path.relative(outDir, f)));
  const changed = names.filter((n) => [...written].some((f) => f.startsWith("cpp/generated/") && path.basename(f).startsWith(`${moduleNamespace(n)}.`))).length;
  steps.finish({ name: "generate", label: "Generated C++", status: "ok", detail: changed === names.length ? `${changed} changed` : `${changed} changed, ${names.length - changed} cached`, ms: Date.now() - tWrite });
  steps.finish({ name: "package", label: "Native package", status: "ok", detail: path.relative(root, outDir) || "." });
  for (const n of missingInfoPlistKeys(root, native)) notify(n);
  const nativeChanged = w.removed.length > 0 || [...written].some((f) => !f.startsWith("js/") && f !== "manifest.json");
  return outcome({ ok: true, modules, next: { rebuild: nativeChanged, podInstall: w.structureChanged, reload: !nativeChanged && [...written].some((f) => f.startsWith("js/")) } });
}

/** Each module with the platforms it has code for: its platform files, both for a PLATFORM branch, or shared. */
export function moduleSummary(files: string[], platforms: Target[] | undefined): ModuleSummary[] {
  const built = (platforms ?? ["ios", "android"]).filter((p): p is Platform => p !== "host");
  const byModule = new Map<string, Set<Platform | "shared">>();
  for (const f of files) {
    const set = byModule.get(moduleNameOf(f)) ?? new Set();
    const p = platformOf(f);
    if (p) set.add(p);
    else if (usesPlatforms(f)) for (const b of built) set.add(b);
    byModule.set(moduleNameOf(f), set);
  }
  return [...byModule].map(([name, set]) => ({ name, platforms: set.size ? (["ios", "android"] as const).filter((p) => set.has(p)) : ["shared"] }));
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What the app needs after a build, in words. */
export function nextText(next: Next): string {
  return next.rebuild ? `rebuild the app${next.podInstall ? " (iOS: pod install first)" : ""}` : next.reload ? "reload the app" : "nothing to do: the native package did not change";
}
