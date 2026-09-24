import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { compile, type Diagnostic, extractionCount, inputsKey, isUpToDate, lucentPackages, moduleNameOf, moduleNamespace, type NativeDependencies, nativeDependencies, platformOf, projectFiles, sdkAvailable, sdkModule, type Target, usesPlatforms, watchBuild, writeNativePackage } from "@lucent-lang/compiler";
import type { Flags, Invocation } from "../args.ts";
import type { Output } from "../output.ts";
import { backgroundPrefetch, mapLucentPaths, missingInfoPlistKeys, type Notice, projectSdk, resolveAndroidDependencies, sdkImports, writeGradleDependencies } from "../project.ts";
import { renderDiagnostic } from "../ui/diagnostic.ts";
import { duration, table } from "../ui/format.ts";
import { plainSteps, type Steps } from "../ui/steps.ts";
import { version } from "../version.ts";

type Platform = "ios" | "android";

/** What `lucent build --json` prints (schemas/build.schema.json). */
interface BuildReport {
  ok: boolean;
  upToDate: boolean;
  out: string;
  modules: { name: string; platforms: (Platform | "shared")[] }[];
  steps: Steps["results"];
  diagnostics: Diagnostic[];
  notices: Notice[];
  next: { rebuild: boolean; podInstall: boolean; reload: boolean };
  ms: number;
}

/** What `lucent check --json` prints (schemas/check.schema.json). */
interface CheckReport {
  ok: boolean;
  modules: string[];
  diagnostics: Diagnostic[];
  errors: number;
  ms: number;
}

/** `lucent build` and `lucent check`: check always, write the native package for build. */
export async function buildOrCheck(command: "build" | "check", { root, flags, out }: Invocation): Promise<number> {
  if (command === "build" && flags.watch) return watch(root, flags);
  const t0 = Date.now();
  const theme = out.theme;
  const notices: Notice[] = [];
  const notify = (n: Notice | undefined) => {
    if (!n) return;
    notices.push(n);
    out.print(`${n.level === "ok" ? theme.success(theme.symbols.ok) : theme.warn(theme.symbols.warn)} ${n.text}`);
  };

  let files: string[];
  let native: NativeDependencies;
  try {
    files = projectFiles(root);
    native = nativeDependencies(lucentPackages(root));
  } catch (e) {
    return failed(out, (e as Error).message);
  }

  if (command === "build") out.print(`${theme.brand(theme.symbols.brand)} ${theme.bold("lucent")} ${theme.dim(version())}\n`);
  // check prints its problems only; --json prints one document.
  const quiet = command === "check" || out.json;
  const steps: Steps = quiet ? plainSteps(() => {}, theme) : out.terminal.interactive ? (await import("../ui/live-steps.tsx")).liveSteps(theme) : plainSteps((l) => out.print(l), theme);
  try {
    return await run();
  } finally {
    await steps.close();
  }

  async function run(): Promise<number> {
    const sdk = projectSdk(root);
    const outDir = path.resolve(root, typeof flags.out === "string" ? flags.out : ".lucent/native");
    let platforms = typeof flags.platforms === "string" && flags.platforms ? (flags.platforms.split(",") as Target[]) : undefined;

    // A host build has the platform modules' stubs: no Android dependencies to resolve.
    if (command === "build" && (!platforms || platforms.includes("android"))) {
      // Packages' Gradle artifacts are on the classpath Lucent binds from: the
      // library declares them before Gradle resolves it.
      writeGradleDependencies(outDir, native);
      steps.start("android-dependencies", "Android dependencies");
      await steps.flush();
      const t = Date.now();
      const deps = resolveAndroidDependencies(root, files, sdk, native, !!flags.force);
      if (deps.status === "resolved") steps.finish({ name: "android-dependencies", label: "Android dependencies", status: "ok", detail: "resolved with Gradle", ms: Date.now() - t });
      else if (deps.status === "cached") steps.finish({ name: "android-dependencies", label: "Android dependencies", status: "cached" });
      else if (deps.status === "failed") steps.finish({ name: "android-dependencies", label: "Android dependencies", status: "failed", detail: deps.detail });
    }

    // Platform code: split platform files, or modules branching on PLATFORM.
    const platformCode = files.some((f) => platformOf(f) || usesPlatforms(f));
    if (!platforms && platformCode) {
      // Build what this machine can: an Android-only Linux host, a Mac without the Android SDK.
      const installed = (["ios", "android"] as const).filter((p) => sdkAvailable(p, sdk));
      for (const p of ["ios", "android"] as const) {
        if (installed.includes(p)) continue;
        const why = sdkModule(p, p === "ios" ? "Foundation" : "android.os", sdk);
        notify({ level: "warn", text: `${"missing" in why ? why.missing : `no ${p} SDK`}; skipped ${p === "ios" ? "iOS" : "Android"} (build it with --platforms ${p} once the SDK is installed)` });
      }
      if (!installed.length) return failed(out, "no platform SDK is installed");
      platforms = installed;
      if (command === "build") backgroundPrefetch(root, files);
    }

    // The mapping points at the default output.
    if (command === "build" && outDir === path.join(root, ".lucent/native")) notify(mapLucentPaths(root));

    const moduleNames = [...new Set(files.map(moduleNameOf))];
    const key = inputsKey(files, outDir) + (platforms ? `:${platforms.join(",")}` : "") + `:${createHash("sha256").update(JSON.stringify(native)).digest("hex").slice(0, 12)}`;
    // A check of the same inputs passed before: every input is in the key.
    const checked = path.join(root, ".lucent/check.json");
    if (command === "check") {
      const last = fs.existsSync(checked) ? (JSON.parse(fs.readFileSync(checked, "utf8")) as { inputs?: string; modules?: string[] }) : {};
      if (last.inputs === key && last.modules) {
        if (out.json) out.data(checkReport(true, last.modules, []));
        else out.print(`${theme.success(theme.symbols.ok)} ${plural(last.modules.length, "module")}, no problems  ${theme.dim(`${duration(Date.now() - t0)} (unchanged since the last check)`)}`);
        return 0;
      }
    }
    if (command === "build" && !flags.force && isUpToDate(outDir, key)) {
      steps.finish({ name: "up-to-date", label: "Up to date", status: "ok", detail: `${plural(moduleNames.length, "module")}, nothing to build`, ms: Date.now() - t0 });
      await steps.close();
      if (out.json) out.data(buildReport(true, true, [], { rebuild: false, podInstall: false, reload: false }));
      return 0;
    }

    // SDK bindings: extracted on first use, then cached per SDK.
    const imports = sdkImports(files);
    const wanted = (["ios", "android"] as const).flatMap((p) => ((platforms ?? []).includes(p) ? imports[p].map((m) => [p, m] as const) : []));
    if (wanted.length) {
      steps.start("sdk", `SDK bindings  ${wanted.map(([, m]) => m).join(" · ")}`);
      await steps.flush();
      const t = Date.now();
      const before = extractionCount();
      for (const [p, m] of wanted) sdkModule(p, m, sdk);
      const extracted = extractionCount() - before;
      steps.finish({ name: "sdk", label: "SDK bindings", status: extracted ? "ok" : "cached", detail: wanted.map(([, m]) => m).join(" · "), ms: extracted ? Date.now() - t : undefined });
    }

    steps.start("check", `Checking ${plural(moduleNames.length, "module")}`);
    await steps.flush();
    const tCheck = Date.now();
    const result = compile(files, { platforms, sdk });
    const diagnostics = result.diagnostics.map((d) => ({ ...d, file: d.file && path.relative(root, d.file) }));
    if (!result.ok) {
      steps.finish({ name: "check", label: `Checked ${plural(moduleNames.length, "module")}`, status: "failed", detail: plural(diagnostics.length, "error"), ms: Date.now() - tCheck });
      await steps.close();
      if (out.json) out.data(command === "check" ? checkReport(false, moduleNames, diagnostics) : buildReport(false, false, diagnostics, { rebuild: false, podInstall: false, reload: false }));
      else problems(diagnostics, moduleNames.length, command === "build");
      return 1;
    }
    const names = [...result.proxies.keys()];
    if (command === "check") {
      fs.mkdirSync(path.dirname(checked), { recursive: true });
      fs.writeFileSync(checked, `${JSON.stringify({ inputs: key, modules: names })}\n`);
      if (out.json) out.data(checkReport(true, names, []));
      else out.print(`${theme.success(theme.symbols.ok)} ${plural(names.length, "module")}, no problems  ${theme.dim(duration(Date.now() - t0))}`);
      return 0;
    }
    steps.finish({ name: "check", label: `Checked ${plural(names.length, "module")}`, status: "ok", ms: Date.now() - tCheck });

    const tWrite = Date.now();
    const w = writeNativePackage(result, outDir, { inputsKey: key, native });
    const written = new Set(w.written.map((f) => path.relative(outDir, f)));
    const changed = names.filter((n) => [...written].some((f) => f.startsWith("cpp/generated/") && path.basename(f).startsWith(`${moduleNamespace(n)}.`))).length;
    steps.finish({ name: "generate", label: "Generated C++", status: "ok", detail: changed === names.length ? `${changed} changed` : `${changed} changed, ${names.length - changed} cached`, ms: Date.now() - tWrite });
    steps.finish({ name: "package", label: "Native package", status: "ok", detail: path.relative(root, outDir) || "." });
    await steps.close();
    for (const n of missingInfoPlistKeys(root, native)) notify(n);

    const nativeChanged = w.removed.length > 0 || [...written].some((f) => !f.startsWith("js/") && f !== "manifest.json");
    const next = { rebuild: nativeChanged, podInstall: w.structureChanged, reload: !nativeChanged && [...written].some((f) => f.startsWith("js/")) };
    if (out.json) {
      out.data(buildReport(true, false, [], next));
      return 0;
    }
    const modules = moduleSummary(files, platforms);
    out.print("");
    for (const line of table(modules.map((m, i) => [i ? "" : theme.dim("modules"), m.name, m.platforms.join(" ")]))) out.print(line);
    const nextText = next.rebuild ? `rebuild the app${next.podInstall ? " (iOS: pod install first)" : ""}` : next.reload ? "reload the app" : "nothing to do: the native package did not change";
    out.print(`${theme.dim("next")}     ${nextText}`);
    return 0;
  }

  function buildReport(ok: boolean, upToDate: boolean, diagnostics: Diagnostic[], next: BuildReport["next"]): BuildReport {
    return { ok, upToDate, out: path.resolve(root, typeof flags.out === "string" ? flags.out : ".lucent/native"), modules: moduleSummary(files, undefined), steps: steps.results, diagnostics, notices, next, ms: Date.now() - t0 };
  }

  function checkReport(ok: boolean, modules: string[], diagnostics: Diagnostic[]): CheckReport {
    return { ok, modules, diagnostics, errors: diagnostics.length, ms: Date.now() - t0 };
  }

  function problems(diagnostics: Diagnostic[], modules: number, build: boolean): void {
    const sources = new Map<string, string | undefined>();
    const source = (file: string) => {
      if (!sources.has(file)) {
        const abs = path.resolve(root, file);
        sources.set(file, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined);
      }
      return sources.get(file);
    };
    out.error("");
    for (const d of diagnostics) out.error(`${renderDiagnostic(d, d.file ? source(d.file) : undefined, theme)}\n`);
    const summary = `${plural(diagnostics.length, "error")} ${theme.dim("·")} ${plural(modules, "module")} ${theme.dim("·")} ${duration(Date.now() - t0)}`;
    out.error(`  ${theme.error(summary)}${build ? theme.dim("  nothing was written") : ""}`);
  }
}

/** Each module with the platforms it has code for: its platform files, both for a PLATFORM branch, or shared. */
function moduleSummary(files: string[], platforms: Target[] | undefined): { name: string; platforms: (Platform | "shared")[] }[] {
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

function failed(out: Output, message: string): number {
  if (out.json) out.data({ ok: false, error: message });
  else out.error(`${out.theme.error(out.theme.symbols.fail)} ${message}`);
  return 1;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function watch(root: string, flags: Flags): number {
  const out = path.resolve(root, typeof flags.out === "string" ? flags.out : ".lucent/native");
  process.stdout.write(`Lucent: watching ${root} for *.lucent.ts changes\n`);
  watchBuild(root, out, (e) => {
    const time = new Date().toLocaleTimeString();
    if (!e.ok) {
      process.stderr.write(`[${time}] ✗ Lucent build failed:\n${e.messages.map((m) => `  ${m}`).join("\n")}\n`);
      return;
    }
    process.stdout.write(`[${time}] ✓ Lucent: ${e.messages.join("; ")}\n`);
    if (e.nativeChanged) process.stdout.write("  Native code changed: rebuild the app (Xcode / Gradle) to run it.\n");
  }, { sdk: projectSdk(root) }, {
    native: () => nativeDependencies(lucentPackages(root)),
    beforeBuild: (files) => {
      const native = nativeDependencies(lucentPackages(root));
      writeGradleDependencies(out, native);
      const deps = resolveAndroidDependencies(root, files, projectSdk(root), native, false);
      if (deps.status === "failed") process.stderr.write(`! ${deps.detail}\n`);
    },
  });
  return -1;
}
