import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  bindExtensions,
  checkRecord,
  compile,
  deferredLibraryGradle,
  type Diagnostic,
  type ExtensionBinding,
  extractionCount,
  foundFile,
  inNativePackage,
  inputsKey,
  lucentPackages,
  moduleNameOf,
  moduleNamespace,
  type NativeInputs,
  platformOf,
  projectFiles,
  resolveNative,
  type ResolvedNative,
  sdkModule,
  type Target,
  upToDate,
  usesPlatforms,
  writeNativePackage,
} from "@lucent-lang/compiler";
import { type SdkUsage, sdkModuleArtifacts } from "@lucent-lang/bindgen";
import {
  backgroundPrefetch,
  mapLucentPaths,
  missingAppEntries,
  type Notice,
  hasAndroidProject,
  pendingAndroidModules,
  podsToInstall,
  projectHashes,
  projectSdk,
  resolveAndroidDependencies,
  sdkImports,
  staleAutolinking,
  writeLinkedPackage,
} from "./project.ts";
import {
  type Artifact,
  BuildGraph,
  type BuildRecord,
  contentHash,
  fileArtifact,
  type PendingAction,
  projectPath,
  requiredAction,
  writeBuildRecord,
} from "./build-graph.ts";
import { classifyChanges, needsPodInstall } from "./changes.ts";
import {
  frozenFailure,
  LOCK_FILE,
  lockProblems,
  readUsage,
  sdkUnavailable,
  sdkUsage,
  USAGE_FILE,
  usageReadable,
  usedModules,
  writeUsage,
} from "./sdk-usage.ts";
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
  /** iOS relinks (files came or went, the podspec or its pods changed): pod install before its build. */
  podInstall: boolean;
  /** Only the JavaScript proxies changed. */
  reload: boolean;
}

/** What building (or checking) the project did. */
export interface BuildOutcome {
  ok: boolean;
  /** A problem that stopped the build: before any module was checked, or a frozen build's SDKs. */
  fatal?: string;
  /** Nothing changed since the last build (or passing check), so nothing ran. */
  upToDate: boolean;
  files: string[];
  modules: ModuleSummary[];
  /** Diagnostics, their files relative to the project. */
  diagnostics: Diagnostic[];
  /** Warnings (they do not fail the build), their files relative to the project. */
  warnings: Diagnostic[];
  next: Next;
  /** Every action the build's changes need (none when nothing changed). */
  actions: PendingAction[];
  /** A newer change made this build's analysis stale: it published nothing. */
  superseded?: boolean;
  /** Every Lucent package file the build read, absolute: lucent.json files and listed native paths. */
  nativeInputs: string[];
  /**
   * Every path the check read, absolute (none when it did not get to check):
   * the files (CompileResult.read) and the paths it resolved links from.
   */
  read: string[];
  /** The build's nodes and required action, as written to .lucent/build-record.json. */
  record: BuildRecord;
  /** What the checked code uses of the SDKs, as written to .lucent/sdk-usage.json. */
  usage?: SdkUsage;
  /** The targets the project has platform code for that this build left out, and why. */
  skipped: { platform: Platform; reason: string }[];
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
  /** Aborted when a newer change makes this build stale: it stops before publishing anything. */
  signal?: AbortSignal;
  /**
   * Go on only with the SDKs and SDK symbols the SDK lock records: every
   * target it lists (of `platforms`, when given) must have its SDK, and
   * nothing is taken from the caches of earlier builds.
   */
  frozen?: boolean;
}

const NONE: Next = { rebuild: false, podInstall: false, reload: false };

/**
 * Builds the project at `root`: its Android dependencies, the SDK bindings
 * its modules import, the check, the C++ and the native package, reported
 * step by step. `check` stops after the check and writes nothing but its
 * record of a pass.
 */
export async function buildProject(
  root: string,
  options: BuildOptions,
  steps: Steps,
  notify: (n: Notice) => void,
): Promise<BuildOutcome> {
  const t0 = Date.now();
  const build = options.mode === "build";
  let files: string[] = [];
  let native: NativeInputs;
  let nativeInputs: string[] = [];
  let read: string[] = [];

  // Every return goes through outcome(), which records the build.
  const graph = new BuildGraph(options.mode);
  let targets: string[] = [];
  let changedUnits: string[] = [];
  const skipped: { platform: Platform; reason: string }[] = [];

  const outcome = (o: Partial<BuildOutcome>): BuildOutcome => {
    const next = o.next ?? NONE;
    const actions = o.actions ?? [];
    const record = graph.toRecord(requiredAction(next, targets, changedUnits, actions), actions);
    writeBuildRecord(path.join(root, ".lucent/build-record.json"), record);

    return {
      ok: false,
      upToDate: false,
      files,
      modules: moduleSummary(files, undefined),
      diagnostics: [],
      warnings: [],
      next,
      actions,
      nativeInputs,
      read,
      record,
      skipped,
      ms: Date.now() - t0,
      ...o,
    };
  };

  const tResolve = Date.now();
  try {
    files = projectFiles(root);
    // Package files are hashed once while their size and times hold (large frameworks, libraries).
    const hashes = projectHashes(root);
    native = resolveNative(lucentPackages(root), { hashes });
    hashes.save();
    nativeInputs = native.read;
  } catch (e) {
    graph.record("resolve", "resolve", "failed", {
      detail: (e as Error).message,
      ms: Date.now() - tResolve,
    });
    return outcome({ fatal: (e as Error).message });
  }

  // Stopped here or before publishing: a newer change supersedes this build.
  const superseded = (step: string) => {
    graph.record(step, step === "generate" ? "generate" : "check", "skipped", {
      detail: "superseded by a newer change",
    });

    return outcome({ superseded: true });
  };

  graph.record("resolve", "resolve", "ok", {
    inputs: [
      { key: "native-dependencies", hash: contentHash(JSON.stringify(native.manifest)) },
      ...packageInputs(native),
    ],
    ms: Date.now() - tResolve,
  });
  if (options.signal?.aborted) return superseded("check");

  // Native extensions: each package's declaration checked against its header.
  let extensions: ExtensionBinding[] = [];
  if (native.extensions.length) {
    const t = Date.now();
    const inputs = native.extensions.map((e) => ({ key: `ext/${e.name}`, hash: e.hash }));

    try {
      extensions = bindExtensions(native.extensions);
    } catch (e) {
      graph.record("extract:extensions", "extract", "failed", {
        inputs,
        detail: (e as Error).message,
        ms: Date.now() - t,
      });
      return outcome({ fatal: (e as Error).message });
    }

    graph.record("extract:extensions", "extract", "ok", { inputs, ms: Date.now() - t });
  }

  const sdk = projectSdk(root, native);
  const outDir = path.resolve(root, options.out ?? ".lucent/native");

  let lock: SdkUsage | undefined;
  const lockProblem = (detail: string) => {
    graph.record("resolve:lock", "resolve", "failed", { detail });
    return outcome({ fatal: detail });
  };

  if (options.frozen) {
    try {
      lock = readUsage(path.join(root, LOCK_FILE));
    } catch (e) {
      return lockProblem((e as Error).message);
    }
    if (!lock) return lockProblem(`--frozen needs ${LOCK_FILE}: run lucent sdk lock and commit it`);

    // A required target is built, never skipped nor typed as an untyped stub.
    for (const p of lock.targets) {
      if (options.platforms && !options.platforms.includes(p)) continue;

      const why = sdkUnavailable(p, sdk);
      if (why) return lockProblem(`the SDK lock requires ${p}, whose SDK is unavailable: ${why}`);
    }
  }

  // The library's build file as the Gradle build running this one (if any) configured it.
  const libraryGradle = path.join(outDir, "android/build.gradle");
  const configured = fs.existsSync(libraryGradle)
    ? fs.readFileSync(libraryGradle, "utf8")
    : undefined;
  let platforms = options.platforms;
  let deferAndroid = false;
  let deferReason = "its dependencies are resolved by the Gradle build";

  // The package exists before any Gradle run or pod install reads the app's
  // autolinking config, so it is linked there and in every build after it;
  // and it declares the packages' native dependencies: the classpath Lucent
  // binds from has their Gradle artifacts, and pod install installs their
  // pods even when this build's check fails for want of them. A host build
  // has the platform modules' stubs: no native dependencies.
  const ios = build && (!platforms || platforms.includes("ios"));
  const android = build && (!platforms || platforms.includes("android"));
  const created =
    ios || android ? writeLinkedPackage(root, outDir, native, { ios, android }) : false;

  if (android) {
    // The Gradle build running this one (its lucentBuild task) read that config before.
    if (created && process.env.LUCENT_GRADLE_CLASSPATH) {
      const detail = `this Gradle build read the app's autolinking config before ${path.relative(root, outDir)} existed, so the app would not link Lucent: build again`;

      graph.record("resolve:android", "resolve", "failed", { detail });
      return outcome({ fatal: detail });
    }

    steps.start("android-dependencies", "Android dependencies");
    await steps.flush();
    const t = Date.now();
    const deps = resolveAndroidDependencies(root, files, sdk, native.manifest, !!options.force);
    const label = "Android dependencies";

    graph.record(
      "resolve:android",
      "resolve",
      deps.status === "resolved"
        ? "ok"
        : deps.status === "deferred"
          ? "skipped"
          : deps.status === "failed"
            ? "failed"
            : "cached",
      { ...(deps.status === "failed" ? { detail: deps.detail } : {}), ms: Date.now() - t },
    );

    if (deps.status === "resolved")
      steps.finish({
        name: "android-dependencies",
        label,
        status: "ok",
        detail: "resolved with Gradle",
        ms: Date.now() - t,
      });
    else if (deps.status === "cached")
      steps.finish({ name: "android-dependencies", label, status: "cached" });
    else if (deps.status === "failed")
      steps.finish({ name: "android-dependencies", label, status: "failed", detail: deps.detail });
    else if (deps.status === "deferred") {
      deferAndroid = true;
      steps.finish({
        name: "android-dependencies",
        label,
        status: "skipped",
        detail: "resolved by the Gradle build",
      });
      notify({
        level: "warn",
        text: "the app's Android dependencies are not resolved yet: skipped Android here; the Gradle build compiles it (its lucentBuild task)",
      });
    }
  }

  // Android left to the Gradle build in a build asked for it (the config plugin's, prebuilding
  // Android alone): the other platforms asked for are built, or the deferred build below.
  if (deferAndroid && platforms?.includes("android")) {
    platforms = platforms.filter((p) => p !== "android");
    skipped.push({ platform: "android", reason: deferReason });
  }

  // Nothing resolves the modules the app's dependencies declare when it has no Android project
  // yet (Expo before prebuild), or when this build leaves Android out (--platforms ios): Android
  // waits for the project, or for the Android build.
  if (!deferAndroid && !platforms?.includes("android")) {
    const leftOut = !!platforms;
    const pending = pendingAndroidModules(root, files, sdk, leftOut).map(
      (m) => `lucent:android/${m}`,
    );
    const subject = `${pending.join(", ")} ${pending.length === 1 ? "is" : "are"} untyped`;
    const them = pending.length === 1 ? "it" : "them";

    if (pending.length && leftOut && hasAndroidProject(root)) {
      deferAndroid = true;
      deferReason = "its dependencies are resolved by the Android build";
      notify({
        level: "warn",
        text: `${subject}: this build leaves Android out, and the Android build (lucent build --platforms android, or the app's Gradle build) resolves ${them}`,
      });
    } else if (pending.length) {
      deferAndroid = true;
      deferReason = "the app has no Android project yet";
      notify({
        level: "warn",
        text: `${subject}: the app has no Android project to resolve ${them} yet. Checked after expo prebuild, or once android/ exists${platforms ? "" : "; skipped Android here"}`,
      });
    }
  }

  // Platform code: split platform files, or modules branching on PLATFORM.
  if (!platforms && files.some((f) => platformOf(f) || usesPlatforms(f))) {
    // Build what this machine can: an Android-only Linux host, a Mac without the Android SDK.
    for (const p of ["ios", "android"] as const) {
      const why = sdkUnavailable(p, sdk);

      if (why) {
        skipped.push({ platform: p, reason: why });
        notify({
          level: "warn",
          text: `${why}; skipped ${p === "ios" ? "iOS" : "Android"} (build it with --platforms ${p} once the SDK is installed)`,
        });
      } else if (p === "android" && deferAndroid)
        skipped.push({ platform: p, reason: deferReason });
    }

    const installed = (["ios", "android"] as const).filter(
      (p) => !skipped.some((s) => s.platform === p),
    );
    if (installed.length) {
      platforms = installed;
      if (build && options.prefetch) backgroundPrefetch(root, files, installed);
    } else if (deferAndroid || !build) {
      // Android waiting for its project (or Gradle) is no missing SDK: what can be built here is
      // (the shared code, checked, and the native package for the Gradle build), and a check
      // still reports the shared code's problems, with the platforms' SDK imports untyped.
      platforms = ["host"];
      notify({
        level: "warn",
        text: deferAndroid
          ? "no platform is built here: checked the shared code and wrote the native package, whose Android code the Gradle build compiles"
          : "no platform SDK is installed: checked with the platforms' SDK imports untyped (as --platforms host does)",
      });
    } else {
      const detail = "no platform SDK is installed";

      graph.record("resolve:platforms", "resolve", "failed", { detail });
      return outcome({ fatal: detail });
    }
  }

  // Every platform asked for is left to a later build: the shared code is checked (host).
  if (platforms && !platforms.length) platforms = ["host"];

  for (const { platform, reason } of skipped)
    if (lock?.targets.includes(platform))
      return lockProblem(`the SDK lock requires ${platform}, which this build skips: ${reason}`);

  // The mapping points at the default output.
  if (build && outDir === path.join(root, ".lucent/native")) {
    const mapped = mapLucentPaths(root);
    if (mapped) notify(mapped);
  }

  const modules = moduleSummary(files, platforms);
  const moduleCount = modules.length;
  targets = [...(platforms ?? ["ios", "android"])];
  // The platforms the check compiles platform code for (none: the project has none).
  const built = (platforms ?? []).filter((p): p is Platform => p !== "host");

  // What the check reads: the sources, the targets they are compiled for, and each other
  // file it read (the files imports resolve to, package.json files; see readInputs).
  const checkInputs = (read: ReadonlyMap<string, string>): Artifact[] => {
    const sources = files.map((f) => fileArtifact(root, f));
    const keys = new Set(sources.map((a) => a.key));

    return [
      ...sources,
      { key: "targets", hash: contentHash(targets.join(",")) },
      ...readInputs(root, read).filter((a) => !keys.has(a.key)),
    ];
  };

  const key =
    inputsKey(files, outDir, sdk) +
    (platforms ? `:${platforms.join(",")}` : "") +
    `:${createHash("sha256").update(JSON.stringify(native.manifest)).digest("hex").slice(0, 12)}`;
  // A check given the same inputs passed before, every file it read is as it found it, and
  // every link resolution followed leads where it did: its record says (a build's, its
  // native package's manifest).
  // Its usage report is one of its outputs: lost or unreadable, it runs again.
  const checked = path.join(root, ".lucent/check.json");
  const cacheable = !options.force && !lock && usageReadable(path.join(root, USAGE_FILE));
  const held = cacheable
    ? upToDate(build ? path.join(outDir, "manifest.json") : checked, key)
    : undefined;
  if (held) {
    read = [...new Set([...held.read.keys(), ...held.realpaths.keys()])];
    graph.record("check", "check", "cached", { inputs: checkInputs(held.read) });
    if (!build) return outcome({ ok: true, upToDate: true, modules });

    graph.record("generate", "generate", "cached", { outputs: packageArtifacts(root, outDir) });

    steps.finish({
      name: "up-to-date",
      label: "Up to date",
      status: "ok",
      detail: `${plural(moduleCount, "module")}, nothing to build`,
      ms: Date.now() - t0,
    });
    return outcome({ ok: true, upToDate: true, modules });
  }

  // SDK bindings: extracted on first use, then cached per SDK.
  const imports = sdkImports(files);
  const wanted = (["ios", "android"] as const).flatMap((p) =>
    (platforms ?? []).includes(p) ? imports[p].map((m) => [p, m] as const) : [],
  );
  if (wanted.length) {
    // The first few modules; an app can import dozens.
    const names = wanted.map(([, m]) => m);
    const listed =
      names.length > 3
        ? `${names.slice(0, 3).join(" · ")} +${names.length - 3} more`
        : names.join(" · ");
    steps.start("sdk", `SDK bindings  ${listed}`);
    await steps.flush();
    const t = Date.now();
    const before = extractionCount();
    const unbound = wanted.filter(([p, m]) => "missing" in sdkModule(p, m, sdk)).map(([, m]) => m);
    const extracted = extractionCount() - before;
    // The check says why a module has no bindings.
    const status = unbound.length ? "failed" : extracted ? "ok" : "cached";

    // Each module, keyed on the artifacts its schema was read from, and those artifacts.
    const read = wanted.map(([p, m]) => ({
      key: `${p}/${m}`,
      artifacts: sdkModuleArtifacts(p, m, sdk),
    }));
    const artifacts = new Map(read.flatMap((r) => r.artifacts).map((a) => [a.id, a]));
    const identity = (a: { id: string; contentHash: string }) => `${a.id}#${a.contentHash}`;

    graph.record("extract", "extract", status, {
      inputs: [
        ...read.map((r) => ({
          key: r.key,
          hash: contentHash(r.artifacts.map(identity).join("\n")),
        })),
        ...[...artifacts.values()].map((a) => ({ key: a.id, hash: a.contentHash })),
      ],
      detail: listed,
      ms: Date.now() - t,
    });

    steps.finish({
      name: "sdk",
      label: "SDK bindings",
      status,
      detail: unbound.length ? `no bindings for ${unbound.join(" · ")}` : listed,
      ms: status === "ok" ? Date.now() - t : undefined,
    });
  }

  // The lock's modules too: a member may come from a module the code does not import.
  if (lock) {
    const locked = Object.keys(lock.modules).filter((k) =>
      built.includes(k.split("/")[0] as Platform),
    );
    const problems = lockProblems(
      lock,
      usedModules([...wanted.map(([p, m]) => `${p}/${m}`), ...locked], sdk),
    );

    if (problems.length) {
      graph.record("extract:lock", "extract", "failed", { detail: problems.join("\n") });
      return outcome({ fatal: frozenFailure(problems) });
    }
  }

  steps.start("check", `Checking ${plural(moduleCount, "module")}`);
  await steps.flush();
  const tCheck = Date.now();
  // Until the Gradle build resolves them, Android's imports are untyped in the iOS program.
  const deferred: Platform[] = deferAndroid && !platforms?.includes("android") ? ["android"] : [];
  const result = compile(files, { platforms, sdk, extensions, deferred });
  read = [...new Set([...result.read.keys(), ...result.realpaths.keys()])];
  const relative = (d: Diagnostic) => ({ ...d, file: d.file && path.relative(root, d.file) });
  const diagnostics = result.diagnostics.map(relative);
  const warnings = (result.warnings ?? []).map(relative);
  if (!result.ok) {
    // The packages' pods the app lacks: what the iOS code may have failed to import.
    const pods =
      built.includes("ios") &&
      podsToInstall(
        root,
        native.manifest,
        sdk,
        path.join(path.relative(root, outDir), "LucentNative.podspec"),
        build,
      );
    if (pods) notify(pods);

    graph.record("check", "check", "failed", {
      inputs: checkInputs(result.read),
      detail: plural(diagnostics.length, "error"),
      ms: Date.now() - tCheck,
    });

    steps.finish({
      name: "check",
      label: `Checked ${plural(moduleCount, "module")}`,
      status: "failed",
      detail: plural(diagnostics.length, "error"),
      ms: Date.now() - tCheck,
    });
    return outcome({ modules, diagnostics, warnings });
  }
  const names = [...result.proxies.keys()];
  const usage = sdkUsage(
    result.sdkUses ?? [],
    built,
    wanted.map(([p, m]) => `${p}/${m}`),
    sdk,
  );
  writeUsage(path.join(root, USAGE_FILE), usage);

  const unlocked = lock ? lockProblems(lock, usage.modules, usage.symbols) : [];
  if (unlocked.length) {
    graph.record("check", "check", "failed", {
      inputs: checkInputs(result.read),
      detail: unlocked.join("\n"),
      ms: Date.now() - tCheck,
    });

    steps.finish({
      name: "check",
      label: `Checked ${plural(moduleCount, "module")}`,
      status: "failed",
      detail: `not the SDK symbols ${LOCK_FILE} records`,
      ms: Date.now() - tCheck,
    });
    return outcome({ modules, warnings, usage, fatal: frozenFailure(unlocked) });
  }

  graph.record("check", "check", "ok", {
    inputs: checkInputs(result.read),
    ms: Date.now() - tCheck,
  });

  steps.finish({
    name: "check",
    label: `Checked ${plural(names.length, "module")}`,
    status: "ok",
    ms: Date.now() - tCheck,
  });
  const check = checkRecord(key, result);
  if (!build) {
    fs.mkdirSync(path.dirname(checked), { recursive: true });
    fs.writeFileSync(checked, `${JSON.stringify(check)}\n`);
    return outcome({ ok: true, modules, warnings, usage });
  }

  if (options.signal?.aborted) return superseded("generate");

  // What the last build resolved, to tell what this one changes in the app's configuration.
  const resolvedFile = path.join(outDir, "resolved.json");
  const previous = fs.existsSync(resolvedFile)
    ? (JSON.parse(fs.readFileSync(resolvedFile, "utf8")) as ResolvedNative)
    : undefined;

  const tWrite = Date.now();
  const w = writeNativePackage(result, outDir, {
    check,
    native,
    androidDeferred: deferred.includes("android"),
    app: {
      ...(sdk.ios?.deploymentTarget ? { deploymentTarget: sdk.ios.deploymentTarget } : {}),
      swiftPackages: sdk.ios?.swiftPackages?.packages ?? [],
    },
  });
  const inPackage = (f: string) => path.relative(outDir, f).split(path.sep).join("/");
  const written = new Set(w.written.map(inPackage));

  // What autolinking reads changed (components' descriptors): Gradle reads it again.
  if (written.has("react-native.config.js")) staleAutolinking(root);

  // The Gradle build running this one configured the library with its old build file,
  // unless that was the one a deferred build writes, which builds any of them.
  if (
    process.env.LUCENT_GRADLE_CLASSPATH &&
    configured !== undefined &&
    fs.readFileSync(libraryGradle, "utf8") !== configured &&
    configured !== deferredLibraryGradle(native, !!result.components?.length)
  ) {
    const detail = `this Gradle build configured the Lucent Android library before its build.gradle changed (${path.relative(root, libraryGradle)}: Kotlin shims, packages' Android needs), so it would build it as it was: build again`;

    graph.record("generate", "generate", "failed", { detail, ms: Date.now() - tWrite });
    return outcome({ fatal: detail });
  }

  graph.record("generate", "generate", "ok", {
    outputs: packageArtifacts(root, outDir),
    detail: `${written.size} written, ${w.removed.length} removed`,
    ms: Date.now() - tWrite,
  });
  changedUnits = [...written].filter((f) => f.startsWith("cpp/"));

  const changed = names.filter((n) =>
    [...written].some(
      (f) =>
        f.startsWith("cpp/generated/") && path.basename(f).startsWith(`${moduleNamespace(n)}.`),
    ),
  ).length;
  steps.finish({
    name: "generate",
    label: "Generated C++",
    status: "ok",
    detail:
      changed === names.length
        ? `${changed} changed`
        : `${changed} changed, ${names.length - changed} cached`,
    ms: Date.now() - tWrite,
  });
  steps.finish({
    name: "package",
    label: "Native package",
    status: "ok",
    detail: path.relative(root, outDir) || ".",
  });
  for (const n of missingAppEntries(root, native.manifest)) notify(n);
  const nativeChanged =
    w.removed.length > 0 || [...written].some((f) => !f.startsWith("js/") && f !== "manifest.json");
  const actions = classifyChanges({
    written: [...written],
    added: w.added.map(inPackage),
    removed: w.removed.map(inPackage),
    manifest: native.manifest,
    previous,
    targets,
  });

  return outcome({
    ok: true,
    modules,
    warnings,
    usage,
    actions,
    next: {
      rebuild: nativeChanged,
      podInstall: needsPodInstall(actions),
      reload: !nativeChanged && [...written].some((f) => f.startsWith("js/")),
    },
  });
}

/** The paths Lucent packages list, each once, by where the native package has them and their content. */
function packageInputs(native: NativeInputs): Artifact[] {
  const { ios, android } = native.manifest;
  const listed = [
    ...ios.nativeSources,
    ...ios.resources,
    ...Object.values(ios.resourceBundles).flat(),
    ...ios.vendoredFrameworks,
    ...android.nativeSources,
    ...android.resources,
    ...android.assets,
    ...android.libraries,
    ...android.nativeLibraries,
  ];

  return [...new Map(listed.map((p) => [inNativePackage(p), p.hash])).entries()].map(
    ([key, hash]) => ({ key, hash }),
  );
}

/**
 * The files a check read (CompileResult.read), as inputs: each in the project
 * by its path there and what the check found, and those outside it (the
 * compiler's own, a linked package's) together by what they hold, so the
 * record is the same wherever the project, the compiler and its caller are.
 */
function readInputs(root: string, read: ReadonlyMap<string, string>): Artifact[] {
  // TypeScript reads the files imports resolve to at their real paths.
  const roots = [root, fs.realpathSync(root)];
  const inProject = (key: string) =>
    key !== ".." && !key.startsWith("../") && !path.isAbsolute(key);
  const inside = new Map<string, string>();
  const outside: string[] = [];

  for (const [file, found] of read) {
    const key = roots.map((r) => projectPath(r, file)).find(inProject);
    if (key !== undefined) inside.set(key, found);
    // Paths looked for outside and not found: how many depends on how deep the project is.
    else if (foundFile(found)) outside.push(found);
  }

  return [
    ...[...inside].map(([key, hash]) => ({ key, hash })),
    ...(outside.length
      ? [{ key: "outside-project", hash: contentHash(outside.sort().join("\n")) }]
      : []),
  ];
}

/**
 * The native package's files, for the record. The manifest is left out: it
 * holds the build cache's key, which names machine-specific paths.
 */
function packageArtifacts(root: string, outDir: string): Artifact[] {
  const out: Artifact[] = [];

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (full !== path.join(outDir, "manifest.json")) out.push(fileArtifact(root, full));
    }
  };

  if (fs.existsSync(outDir)) walk(outDir);
  return out;
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
  return [...byModule].map(([name, set]) => ({
    name,
    platforms: set.size ? (["ios", "android"] as const).filter((p) => set.has(p)) : ["shared"],
  }));
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What the app needs after a build, in words. */
export function nextText(next: Next): string {
  return next.rebuild
    ? `rebuild the app${next.podInstall ? " (iOS: pod install first)" : ""}`
    : next.reload
      ? "reload the app"
      : "nothing to do: the native package did not change";
}
