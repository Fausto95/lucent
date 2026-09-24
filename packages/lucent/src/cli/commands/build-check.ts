import { createHash } from "node:crypto";
import path from "node:path";
import { compile, formatDiagnostic, inputsKey, isUpToDate, lucentPackages, type NativeDependencies, nativeDependencies, platformOf, projectFiles, sdkAvailable, sdkModule, type Target, usesPlatforms, watchBuild, writeNativePackage } from "@lucent-lang/compiler";
import type { Flags, Invocation } from "../args.ts";
import { backgroundPrefetch, mapLucentPaths, projectSdk, resolveAndroidDependencies, warnInfoPlist, writeGradleDependencies } from "../project.ts";

/** `lucent build` and `lucent check`: check always, write the native package for build. */
export function buildOrCheck(command: "build" | "check", { root, flags }: Invocation): number {
  if (command === "build" && flags.watch) return watch(root, flags);
  let files: string[];
  let native: NativeDependencies;
  try {
    files = projectFiles(root);
    native = nativeDependencies(lucentPackages(root));
  } catch (e) {
    process.stderr.write(`✗ ${(e as Error).message}\n`);
    return 1;
  }
  if (files.length === 0) {
    process.stdout.write(`No *.lucent.ts files under ${root}\n`);
  }
  const t0 = Date.now();
  const sdk = projectSdk(root);
  const out = path.resolve(root, typeof flags.out === "string" ? flags.out : ".lucent/native");
  const platformsArg = typeof flags.platforms === "string" ? flags.platforms : "";
  let platforms = platformsArg ? (platformsArg.split(",") as Target[]) : undefined;
  // A host build has the platform modules' stubs: no Android dependencies to resolve.
  if (command === "build" && (!platforms || platforms.includes("android"))) {
    // Packages' Gradle artifacts are on the classpath Lucent binds from: the
    // library declares them before Gradle resolves it.
    writeGradleDependencies(out, native);
    resolveAndroidDependencies(root, files, sdk, native, !!flags.force);
  }
  // Platform code: split platform files, or modules branching on PLATFORM.
  if (!platforms && files.some((f) => platformOf(f) || usesPlatforms(f))) {
    // Build what this machine can: an Android-only Linux host, a Mac without the Android SDK.
    const installed = (["ios", "android"] as const).filter((p) => sdkAvailable(p, sdk));
    for (const p of ["ios", "android"] as const) {
      if (installed.includes(p)) continue;
      const why = sdkModule(p, p === "ios" ? "Foundation" : "android.os", sdk);
      process.stderr.write(`! ${"missing" in why ? why.missing : `no ${p} SDK`}; skipped ${p === "ios" ? "iOS" : "Android"} (build it with --platforms ${p} once the SDK is installed).\n`);
    }
    if (!installed.length) {
      process.stderr.write("✗ no platform SDK is installed.\n");
      return 1;
    }
    platforms = installed;
    if (command === "build") backgroundPrefetch(root, files);
  }
  // The mapping points at the default output.
  if (command === "build" && out === path.join(root, ".lucent/native")) mapLucentPaths(root);
  const key = inputsKey(files, out) + (platforms ? `:${platforms.join(",")}` : "") + `:${createHash("sha256").update(JSON.stringify(native)).digest("hex").slice(0, 12)}`;
  if (command === "build" && !flags.force && isUpToDate(out, key)) {
    process.stdout.write(`✓ ${path.relative(root, out)} is up to date (${files.length} module(s), ${Date.now() - t0} ms)\n`);
    return 0;
  }
  const result = compile(files, { platforms, sdk });
  for (const d of result.diagnostics) process.stderr.write(formatDiagnostic({ ...d, file: d.file && path.relative(root, d.file) }) + "\n");
  if (!result.ok) {
    process.stderr.write(`\n✗ ${result.diagnostics.length} problem(s); nothing was written.\n`);
    return 1;
  }
  const names = [...result.proxies.keys()];
  if (command === "check") {
    process.stdout.write(`✓ ${names.length} module(s) OK: ${names.join(", ")} (${Date.now() - t0} ms)\n`);
    return 0;
  }
  const w = writeNativePackage(result, out, { inputsKey: key, native });
  warnInfoPlist(root, native);
  process.stdout.write(`✓ Compiled ${names.length} module(s): ${names.join(", ")} (${Date.now() - t0} ms)\n`);
  process.stdout.write(`  ${path.relative(root, out)}: ${w.written.length} written, ${w.unchanged} unchanged, ${w.removed.length} removed\n`);
  if (w.structureChanged) {
    process.stdout.write(`  Native files were added or removed: run \`pod install\` (iOS) before the next build.\n`);
  }
  return 0;
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
      resolveAndroidDependencies(root, files, projectSdk(root), native, false);
    },
  });
  return -1;
}
