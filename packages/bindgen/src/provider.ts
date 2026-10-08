import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAndroid, jarIndex } from "./android.ts";
import {
  type AndroidPlatform,
  androidArtifacts,
  identity,
  iosArtifacts,
  type NativeArtifact,
} from "./artifacts.ts";
import { cacheRoot, hash, publish, publishDir, readCached, withLock } from "./cache.ts";
import { ownerOf, scanHeaders } from "./header-index.ts";
import {
  buildIosSchema,
  enumValues,
  externalUsrs,
  type IosOptions,
  iosTarget,
  namesOf,
  type NamesIndex,
  symbolGraphArgs,
} from "./ios.ts";
import {
  contentHash,
  extractorVersion,
  type IosModuleSource,
  iosProvenance,
  type LockedPod,
  lockedPods,
} from "./provenance.ts";
import type { PodFramework, SwiftPod } from "./pods.ts";
import type { SwiftPackages } from "./swift-packages.ts";
import {
  emitSwiftModule,
  importsOf,
  OWN_SWIFT_MODULE,
  type PlannedSwiftModule,
  planSwiftModules,
  type SwiftModuleContext,
} from "./swift-modules.ts";
import { cSwiftNames } from "./c-swift-names.ts";
import { buildSourceSchema } from "./swift-source.ts";
import type { SymbolGraph } from "./symbols.ts";
import type { TypeLookup } from "./binding-plan.ts";
import {
  canonicalSchema,
  hasSchemaFormat,
  type Platform,
  SCHEMA_FORMAT,
  type SdkModuleSchema,
} from "./schema.ts";

export { sourcesHash } from "./provenance.ts";
export type { NativeArtifact } from "./artifacts.ts";

/**
 * SDK modules on demand: the first program that imports `lucent:ios/X` or
 * `lucent:android/p.q` extracts it from the artifacts the app's build
 * resolved (the SDK, pods, Gradle libraries), and caches the schema per
 * machine under <cache>/sdk/<platform>/<SDK>/<module>/, with the
 * identities of the artifacts its extraction read. There is no list of
 * modules: anything those artifacts declare can be imported.
 */
export interface SdkOptions {
  /** Default: $LUCENT_CACHE_DIR, else $XDG_CACHE_HOME/lucent, else ~/.cache/lucent. */
  cacheDir?: string;
  /**
   * An exported schema set (lucent-sdk.schemas/, which `lucent sdk lock
   * --schemas` writes beside the lock): the schemas a platform's code
   * used, read where that platform's SDK is not installed (a Linux CI
   * typing iOS code). An installed SDK wins.
   */
  schemas?: string;
  android?: {
    /** The jars to bind (default: the SDK platform's android.jar). */
    jars?: string[];
    /** Where to look for the Android SDK (default: $ANDROID_HOME, $ANDROID_SDK_ROOT, the usual install locations). */
    sdkRoots?: string[];
    /**
     * platforms/<name> to use (default: $LUCENT_ANDROID_PLATFORM, else
     * the app's compileSdk's when installed, else the newest installed).
     */
    platform?: string;
    /**
     * The oldest API level the app runs on (its minSdk): APIs newer than
     * it need a check. Default: the classpath file's, else React Native's
     * minimum (24).
     */
    minSdk?: number;
    /**
     * The app's resolved compile classpath (.lucent/android-classpath.json,
     * written by the lucentClasspath Gradle task): its jars and AARs are
     * bindable too.
     */
    classpath?: string;
    /**
     * Jars and AARs Lucent packages ship (android.libraries): bindable
     * before the app's Gradle build has resolved its classpath, which
     * lists them again once it has.
     */
    libraries?: string[];
  };
  ios?: {
    /** Directories with module maps, for modules outside the SDK. */
    includePaths?: string[];
    /** Framework search paths, and module maps loaded explicitly (the app's pods: see podsSearchPaths). */
    frameworkPaths?: string[];
    moduleMaps?: string[];
    /** Pods Xcode builds as frameworks, not built yet (the app's pods: see podsSearchPaths). */
    frameworks?: PodFramework[];
    /** Preprocessor definitions the app's pods compile with (`COCOAPODS=1`). */
    defines?: string[];
    /** Podfile.lock: which pods installed the modules, their versions and dependencies. */
    lockfile?: string;
    /**
     * The iOS version the app is deployed to (its Xcode project's): what
     * declarations are read for, and the oldest iOS its code runs on.
     */
    deploymentTarget?: string;
    /** The Swift packages the app links, built for it (see swiftPackages). */
    swiftPackages?: SwiftPackages;
    /** Swift pods built as static libraries (the app's pods: see podsSearchPaths), emitted for it. */
    swiftPods?: SwiftPod[];
    /**
     * The Swift files of the app's Lucent packages' ios.nativeSources: the
     * module `lucent:ios/LucentNative`, as the native package builds them.
     */
    swiftSources?: string[];
    xcrun?: string;
  };
}

/** A module's schema, or why there is none and, when the module was not found, what to do. */
export type SdkLookup = { schema: SdkModuleSchema } | { missing: string; fix?: string };

let extractions = 0;
/** How many modules were extracted in this process (tests). */
export function extractionCount(): number {
  return extractions;
}

/** A module's cached result in this process, and what its schema read. */
interface Loaded {
  lookup: SdkLookup;
  inputs?: Inputs;
}

const loaded = new Map<string, Loaded>();
/** What each xcrun says of the simulator SDK: its path, version and build, asked once. */
const iosSdks = new Map<string, (string | undefined)[]>();
const headerIndexes = new Map<string, Record<string, string>>();

/** Forgets what this process loaded, as a new process would (tests). */
export function forgetLoadedSdks(): void {
  loaded.clear();
  served.clear();
  setEntries.clear();
  setIdentities.clear();
  iosSdks.clear();
  headerIndexes.clear();
  locatedByObject = new WeakMap();
  namesRead = new WeakMap();
}

/** A platform's artifacts as this build resolved them, and where their schemas are cached. */
interface Resolved {
  /** The cache directory of this SDK, target and extractor. */
  scope: string;
  /** What files' contents give, by their stats, for this extractor. */
  memo: string;
  artifacts: NativeArtifact[];
  /** Module (iOS) or package (Android) → the artifacts declaring it, as the build finds them. */
  providers: Map<string, NativeArtifact[]>;
  /** The SDK every schema is read against. */
  sdk?: NativeArtifact;
  /** Every artifact's identity, for this process's memos. */
  key: string;
  android?: {
    jars: string[];
    apiVersions?: string;
    annotations?: string;
    dependencies: number;
    classpath?: string;
  };
  /** modules: module name → its headers (undefined: an SDK framework, <M>/<M>.h). */
  ios?: {
    sdk: string;
    /** The SDK's version (`27.0`). */
    version: string;
    ios: IosOptions;
    frameworks: string;
    modules: Map<string, string[] | undefined>;
    umbrellas: Map<string, string>;
    /** Frameworks on the framework paths: module → the directory holding <M>.framework. */
    frameworkDirs: Map<string, string>;
    /** How each module outside the SDK reaches the build (SDK frameworks are absent). */
    sources: Map<string, IosModuleSource>;
    /** The app's Swift packages that could not be built, and why. */
    packageFailures: string[];
    /** Swift modules emitted from source on first use (Swift pods, packages' Swift), and how. */
    swiftModules: { planned: Map<string, PlannedSwiftModule>; ctx: SwiftModuleContext };
  };
}

/** What every cache key starts from: the extractor's code and the schema format it writes. */
const extractorKey = () => [extractorVersion(), `schema format ${SCHEMA_FORMAT}`];

/** Where what the extractor derives from files' contents is kept: per extractor, whose rules made it. */
const memoDir = (root: string) => path.join(root, "memo", extractorVersion());

function resolved(
  fields: Omit<Resolved, "providers" | "key" | "sdk">,
  owners: (a: NativeArtifact) => string[] = (a) => a.modules,
): Resolved {
  const providers = new Map<string, NativeArtifact[]>();
  for (const a of fields.artifacts)
    for (const m of owners(a)) providers.set(m, [...(providers.get(m) ?? []), a]);

  return {
    ...fields,
    providers,
    sdk: fields.artifacts.find((a) => a.kind === "sdk"),
    key: hash(fields.artifacts.map(identity)),
  };
}

// --- what a schema read ----------------------------------------------------------------

/** Each module or package a schema read → the identities of the artifacts declaring it ("" for none). */
type Inputs = Record<string, string>;

const provided = (r: Resolved, name: string) =>
  (r.providers.get(name) ?? []).map(identity).join(" ");

function inputsOf(r: Resolved, names: Iterable<string>): Inputs {
  const out: Inputs = {};
  for (const n of [...new Set(names)].sort()) out[n] = provided(r, n);

  return out;
}

/**
 * The entry of `kind` in `dir` whose inputs resolve as they did when it
 * was extracted: a cache hit. Entries of other builds (another classpath,
 * other pods) sit beside it, each under the hash of its inputs.
 */
function findEntry<T extends { inputs: Inputs }>(
  r: Resolved,
  dir: string,
  kind: "schema" | "names",
): T | undefined {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return undefined;
  }

  for (const f of files) {
    if (entryKind(f) !== kind) continue;

    const entry = readCached(path.join(dir, f)) as Partial<Record<string, unknown>> | undefined;
    if (!entry || typeof entry.inputs !== "object" || !entry.inputs) continue;
    if (kind === "schema" ? !hasSchemaFormat(entry.schema) : !entry.names) continue;

    const inputs = entry.inputs as Inputs;
    if (Object.entries(inputs).every(([n, v]) => provided(r, n) === v)) return entry as T;
  }

  return undefined;
}

function publishEntry(
  dir: string,
  kind: "schema" | "names",
  entry: SchemaEntry | NamesEntry,
): void {
  const key = entryKey(entry.inputs);
  publish(path.join(dir, kind === "names" ? `${key}.names.json` : `${key}.json`), entry);
}

/** The name of a module's cache entry for these inputs. */
const entryKey = (inputs: Inputs) => hash(Object.entries(inputs).map(([n, v]) => `${n}=${v}`));

/** Which entry a module's cache file is: `<key>.json` a schema, `<key>.names.json` names. */
const entryKind = (file: string) =>
  file.endsWith(".names.json") ? "names" : file.endsWith(".json") ? "schema" : undefined;

type SchemaEntry = { inputs: Inputs; schema: SdkModuleSchema };
type NamesEntry = { inputs: Inputs; names: NamesIndex };

/** A module's extraction, and the modules or packages it read. */
type Extracted =
  | { schema: SdkModuleSchema; read: Iterable<string> }
  | { missing: string; fix?: string };

// --- Android -------------------------------------------------------------------------

function androidRoots(opts: SdkOptions): string[] {
  if (opts.android?.sdkRoots) return opts.android.sdkRoots;
  return [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), "Library/Android/sdk"),
    path.join(os.homedir(), "Android/Sdk"),
  ].filter((r): r is string => !!r);
}

function locateAndroid(opts: SdkOptions): Resolved | { missing: string } {
  const jars =
    opts.android?.jars ??
    (process.env.LUCENT_ANDROID_JARS
      ? process.env.LUCENT_ANDROID_JARS.split(path.delimiter)
      : undefined);
  let platform: AndroidPlatform | undefined;
  if (!jars) {
    const roots = androidRoots(opts);
    const root = roots.find((r) => fs.existsSync(path.join(r, "platforms")));
    const platforms = root
      ? fs
          .readdirSync(path.join(root, "platforms"))
          .filter((p) => fs.existsSync(path.join(root, "platforms", p, "android.jar")))
      : [];
    const wanted = opts.android?.platform ?? process.env.LUCENT_ANDROID_PLATFORM;
    const version = (p: string) => Number(/(\d+(\.\d+)?)/.exec(p)?.[1] ?? 0);
    // The platform the app compiles against, as its Gradle build says; else the newest.
    const compileSdk = androidLevels(opts).compileSdk;
    const compiled = compileSdk
      ? (platforms.find((p) => p === `android-${compileSdk}`) ??
        platforms.find((p) => Math.floor(version(p)) === compileSdk))
      : undefined;
    const name = wanted ?? compiled ?? platforms.sort((a, b) => version(b) - version(a))[0];
    if (!root || !name || !platforms.includes(name)) {
      return {
        missing: `the Android SDK${wanted ? ` platform ${wanted}` : ""} was not found (looked in ${roots.join(", ") || "no locations"}). Install it with Android Studio, or set ANDROID_HOME to its location.`,
      };
    }
    const dir = path.join(root, "platforms", name);
    const data = (f: string) => (fs.existsSync(path.join(dir, f)) ? path.join(dir, f) : undefined);
    platform = {
      jar: path.join(dir, "android.jar"),
      apiVersions: data("data/api-versions.xml"),
      annotations: data("data/annotations.zip"),
    };
  }
  const missingJar = jars?.find((j) => !fs.existsSync(j));
  if (missingJar) return { missing: `the Android SDK jar ${missingJar} was not found` };

  // The app's dependencies, after the platform: the platform's classes win.
  // Packages' libraries first: Gradle's copies of them on the classpath are the same artifacts.
  const classpath = opts.android?.classpath;
  const cp = classpath
    ? (readCached(classpath) as { jars?: string[]; aars?: string[] })
    : undefined;
  const found = [
    ...(opts.android?.libraries ?? []),
    ...(cp?.jars ?? []),
    ...(cp?.aars ?? []),
  ].filter((f) => fs.existsSync(f));

  const root = cacheRoot(opts.cacheDir);
  const memo = memoDir(root);
  const artifacts = unique(
    androidArtifacts(memo, platform, [...(jars ?? []), ...found], classpath),
  );
  const dependencies = artifacts.filter((a) => found.includes(a.declarationInputs[0]!)).length;
  const sdk = artifacts.find((a) => a.kind === "sdk");
  const label = sdk?.targetTriple ?? "jars";

  return resolved({
    scope: path.join(
      root,
      "sdk/android",
      `${label}-${hash([...extractorKey(), sdk ? identity(sdk) : ""])}`,
    ),
    memo,
    artifacts,
    android: {
      jars: artifacts.map((a) => a.declarationInputs[0]!),
      apiVersions: platform?.apiVersions,
      annotations: platform?.annotations,
      dependencies,
      classpath,
    },
  });
}

/** The app's SDK levels: the options', else what its Gradle build wrote with the classpath. */
export function androidLevels(opts: SdkOptions = {}): { minSdk?: number; compileSdk?: number } {
  const file = opts.android?.classpath;
  const cp = file
    ? (readCached(file) as { minSdk?: unknown; compileSdk?: unknown } | undefined)
    : undefined;
  const level = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
  const minSdk = level(opts.android?.minSdk) ?? level(cp?.minSdk);
  const compileSdk = level(cp?.compileSdk);
  return { ...(minSdk ? { minSdk } : {}), ...(compileSdk ? { compileSdk } : {}) };
}

/** Each artifact once: the first of those with the same classes (a library and Gradle's copy of it). */
function unique(artifacts: NativeArtifact[]): NativeArtifact[] {
  const seen = new Set<string>();

  return artifacts.filter((a) => {
    if (seen.has(a.contentHash)) return false;

    seen.add(a.contentHash);
    return true;
  });
}

function androidNotFound(r: Resolved, module: string): { missing: string; fix: string } {
  const { jars, dependencies, classpath } = r.android!;
  const platformJars = jars.slice(0, jars.length - dependencies);
  let where = `looked in ${platformJars.join(", ")}`;
  if (dependencies)
    where += ` and ${dependencies} dependency jar${dependencies === 1 ? "" : "s"}${classpath ? ` from ${classpath}` : ""}`;
  else if (classpath)
    where += `; the app's dependencies are not resolved yet: run ./gradlew :app:lucentClasspath in android/ (lucent build runs it when an import is not in the SDK)`;

  return {
    missing: `lucent:android/${module} was not found in the SDK or the app's dependencies (${where})`,
    fix: "check the package's name, and that the app depends on the library that has it",
  };
}

function extractAndroidModule(r: Resolved, module: string): Extracted {
  const { jars, apiVersions, annotations } = r.android!;
  const index = jarIndex(jars, apiVersions);
  if (!index.packages.has(module)) return androidNotFound(r, module);

  extractions++;
  const read = new Set<string>();
  const [schema] = extractAndroid({
    jars,
    apiVersions,
    annotations,
    packages: [module],
    consulted: read,
  });

  return { schema: schema!, read };
}

// --- iOS -----------------------------------------------------------------------------

function run(cmd: string, args: string[]): string | undefined {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function filesUnder(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  // In a fixed order, whatever the file system's: the header index keeps the first module found.
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(full, pattern));
    else if (pattern.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * The pod that installed `files`: the first directory of their paths
 * inside Pods/ that Podfile.lock names (`Headers/Public/<Pod>/…`,
 * `Target Support Files/<Pod>/…`, `<Pod>/…`), as written, else as
 * symbolic links resolve.
 */
function podOf(files: string[], podsDir: string, pods: Map<string, unknown>): string | undefined {
  const inPods = (f: string) => {
    const rel = path.relative(podsDir, f);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;

    return rel.split(path.sep).find((d) => pods.has(d));
  };

  for (const f of files) {
    const pod = inPods(f);
    if (pod) return pod;
  }

  for (const f of files) {
    const pod = fs.existsSync(f) ? inPods(fs.realpathSync(f)) : undefined;
    if (pod) return pod;
  }

  return undefined;
}

function locateIos(opts: SdkOptions): Resolved | { missing: string } {
  const xcrun = opts.ios?.xcrun ?? process.env.LUCENT_XCRUN ?? "xcrun";
  let answers = iosSdks.get(xcrun);
  if (!answers) {
    answers = ["--show-sdk-path", "--show-sdk-version", "--show-sdk-build-version"].map((q) =>
      run(xcrun, ["--sdk", "iphonesimulator", q]),
    );
    iosSdks.set(xcrun, answers);
  }
  const [sdk, version, build] = answers;
  if (!sdk || !version || !build) {
    return {
      missing: `the iOS SDK was not found (${xcrun} --sdk iphonesimulator failed). Install Xcode and select it: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`,
    };
  }
  const includePaths = opts.ios?.includePaths ?? [];
  const root = cacheRoot(opts.cacheDir);
  const memo = memoDir(root);
  // Pods' frameworks Xcode has not built yet: laid out as the build will, to be read as frameworks.
  const frameworkPaths = [
    ...(opts.ios?.frameworkPaths ?? []),
    ...(opts.ios?.frameworks ?? []).map((f) => podFramework(memo, f)),
    ...new Set(
      (opts.ios?.swiftPackages?.modules ?? []).filter((m) => m.framework).map((m) => m.dir),
    ),
  ];
  const moduleMaps = opts.ios?.moduleMaps ?? [];
  const defines = opts.ios?.defines ?? [];

  // Modules: the SDK's frameworks, frameworks on the framework paths, and
  // the module maps on the include paths or loaded explicitly (pods).
  const frameworks = path.join(sdk, "System/Library/Frameworks");
  const modules = new Map<string, string[] | undefined>();
  const umbrellas = new Map<string, string>();
  const frameworkDirs = new Map<string, string>();
  const sources = new Map<string, IosModuleSource>();
  // Sorted: which module a type shared by two headers' scans is indexed under must not depend
  // on the order the file system lists them in.
  const sdkFrameworks = (fs.existsSync(frameworks) ? fs.readdirSync(frameworks) : [])
    .filter((f) => f.endsWith(".framework"))
    .map((f) => f.slice(0, -".framework".length))
    .sort();
  for (const f of sdkFrameworks) modules.set(f, undefined);

  const readMap = (map: string) => {
    const text = fs.readFileSync(map, "utf8");
    const headers = [...text.matchAll(/(?:umbrella\s+)?header\s+"([^"]+)"/g)].map((h) =>
      path.resolve(path.dirname(map), h[1]!),
    );
    for (const m of text.matchAll(/^\s*(?:framework\s+)?module\s+([\w.]+)/gm)) {
      const files = headers.length ? headers : filesUnder(path.dirname(map), /\.h$/);
      modules.set(m[1]!, files);
      // Its declarations: the headers it names, and the ones they include next to them.
      const dirs = new Set(files.map((h) => path.dirname(h)));
      const declared = [...files, ...[...dirs].flatMap((d) => filesUnder(d, /\.h$/))];
      sources.set(m[1]!, { kind: "clang-module", files: [...new Set([map, ...declared])] });
      if (headers.length) umbrellas.set(m[1]!, headers[0]!);
    }
  };
  for (const inc of includePaths) {
    for (const map of filesUnder(inc, /^module\.modulemap$/)) readMap(map);
    // Swift modules: no headers, the shims import them.
    for (const f of fs.existsSync(inc) ? fs.readdirSync(inc) : []) {
      if (!f.endsWith(".swiftmodule")) continue;
      modules.set(f.slice(0, -".swiftmodule".length), []);
      sources.set(f.slice(0, -".swiftmodule".length), {
        kind: "swift-module",
        files: [path.join(inc, f)],
      });
    }
  }
  for (const map of moduleMaps) readMap(map);

  // The app's Swift packages: each Swift module from its package's build (a framework's is on
  // the framework paths).
  const packages = opts.ios?.swiftPackages;
  for (const m of packages?.modules ?? []) {
    if (m.framework) continue;
    modules.set(m.module, []);
    sources.set(m.module, {
      kind: "swift-module",
      files: [path.join(m.dir, `${m.module}.swiftmodule`)],
      spm: m.package,
    });
  }
  const packageDirs = [
    ...new Set((packages?.modules ?? []).filter((m) => !m.framework).map((m) => m.dir)),
  ];

  for (const dir of frameworkPaths) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (!f.endsWith(".framework")) continue;
      const name = f.slice(0, -".framework".length);
      const framework = path.join(dir, f);
      modules.set(name, filesUnder(path.join(framework, "Headers"), /\.h$/));
      // A Swift-only framework has no Headers.
      sources.set(name, {
        kind: "framework",
        files: ["Headers", "Modules"]
          .map((d) => path.join(framework, d))
          .filter((d) => fs.existsSync(d)),
      });
      frameworkDirs.set(name, dir);
    }
  }

  // A Swift package's framework is its package's.
  for (const m of packages?.modules ?? []) {
    const source = m.framework ? sources.get(m.module) : undefined;
    if (source) source.spm = m.package;
  }

  // A pod's framework is its pod's files (Target Support Files/<pod>/ says which pod).
  for (const f of opts.ios?.frameworks ?? [])
    sources.set(f.module, { kind: "framework", files: [f.moduleMap, f.umbrella, ...f.headers] });

  // A module whose files are in Pods/ is its pod's, at the version Podfile.lock installed.
  const lockfile = opts.ios?.lockfile;
  const pods = lockfile ? lockedPods(lockfile) : new Map<string, LockedPod>();

  // Swift made into modules on first use: Swift pods built as static libraries (their module is a
  // build's product), and the app's Lucent packages' Swift, which LucentNative builds.
  const deployment = opts.ios?.deploymentTarget;
  const targetTriple = iosTarget(
    deployment ? { target: `arm64-apple-ios${deployment}-simulator` } : {},
  );
  const swiftPods = (opts.ios?.swiftPods ?? []).filter((p) => !modules.has(p.module));
  const swiftSources = opts.ios?.swiftSources ?? [];
  const ownModules = [
    ...swiftPods.map((p) => ({
      module: p.module,
      sources: p.sources,
      ...(pods.has(p.pod) ? { pod: `${p.pod}@${pods.get(p.pod)!.version}` } : {}),
      dependencies: importsOf(p.sources),
    })),
    ...(swiftSources.length
      ? [{ module: OWN_SWIFT_MODULE, sources: swiftSources, dependencies: importsOf(swiftSources) }]
      : []),
  ];
  const swiftModules = {
    ctx: {
      ...(opts.cacheDir ? { cacheDir: opts.cacheDir } : {}),
      xcrun,
      sdk: { path: sdk, version, build },
      target: targetTriple,
      includePaths: [...includePaths, ...packageDirs],
      frameworkPaths,
      moduleMaps,
      defines,
    },
    planned: new Map<string, PlannedSwiftModule>(),
  };
  const planned = planSwiftModules(ownModules, swiftModules.ctx);
  swiftModules.planned = planned.planned;
  const swiftFailures = [...planned.failures].map(([m, why]) => `${m}: ${why}`);
  for (const m of planned.planned.values()) {
    modules.set(m.module, []);
    sources.set(m.module, {
      kind: "swift-module",
      files: m.sources,
      ...(m.pod ? { pod: m.pod } : {}),
    });
  }
  const ownDirs = [...planned.planned.values()].map((m) => m.dir);

  if (lockfile) {
    const podsDir = path.join(path.dirname(lockfile), "Pods");
    for (const source of sources.values()) {
      const pod = podOf(source.files, podsDir, pods);
      if (pod) source.pod = `${pod}@${pods.get(pod)!.version}`;
    }
  }

  const ios: IosOptions = {
    modules: [],
    includePaths: [...includePaths, ...packageDirs, ...ownDirs],
    frameworkPaths,
    moduleMaps,
    defines,
    xcrun,
    ...(deployment ? { target: `arm64-apple-ios${deployment}-simulator` } : {}),
  };

  const artifacts = iosArtifacts(memo, {
    sdk: { path: sdk, version, build, frameworks: sdkFrameworks },
    sources,
    lockfile,
    pods,
    ...(packages?.resolved ? { resolved: packages.resolved } : {}),
    includePaths: ios.includePaths ?? [],
    compilerArguments: defines.map((d) => `-D${d}`),
    targetTriple,
  });
  // Each module is its source's artifact's, else the SDK's (a pod may shadow an SDK framework).
  const byModule = new Map(
    [...modules.keys()].map((m) => [
      m,
      sources.has(m)
        ? artifacts.find((a) => a.kind !== "sdk" && a.modules.includes(m))!
        : artifacts[0]!,
    ]),
  );

  const key = hash([...extractorKey(), targetTriple, ...defines]);
  return resolved(
    {
      scope: path.join(root, "sdk/ios", `iphonesimulator${version}-${build}-${key}`),
      memo,
      artifacts,
      ios: {
        sdk,
        version,
        ios,
        frameworks,
        modules,
        umbrellas,
        frameworkDirs,
        sources,
        packageFailures: [...(packages?.failures ?? []), ...swiftFailures],
        swiftModules,
      },
    },
    (a) => a.modules.filter((m) => byModule.get(m) === a),
  );
}

/**
 * A pod's framework laid out as Xcode will build it, before it has: the
 * module map in Modules/, the umbrella and public headers in Headers/.
 * Kept in the cache under a hash of their contents; the directory
 * holding <Module>.framework, for the framework search paths.
 */
function podFramework(memo: string, f: PodFramework): string {
  const files = [f.moduleMap, f.umbrella, ...f.headers];
  const key = hash([
    f.module,
    ...files.map((file) => `${path.basename(file)} ${contentHash([file])}`),
  ]);
  const dir = path.join(memo, "frameworks", key);

  publishDir(dir, (tmp) => {
    const framework = path.join(tmp, `${f.module}.framework`);
    fs.mkdirSync(path.join(framework, "Headers"), { recursive: true });
    fs.mkdirSync(path.join(framework, "Modules"));

    fs.copyFileSync(f.moduleMap, path.join(framework, "Modules/module.modulemap"));
    for (const h of [f.umbrella, ...f.headers])
      fs.copyFileSync(h, path.join(framework, "Headers", path.basename(h)));
  });

  return dir;
}

/**
 * The umbrella header a framework's module map names (not always `<M>.h`),
 * relative to its Headers; none for Swift-only frameworks.
 */
function frameworkUmbrella(frameworks: string, module: string): string | undefined {
  const dir = path.join(frameworks, `${module}.framework`);
  if (!fs.existsSync(path.join(dir, "Headers"))) return undefined;
  const map = path.join(dir, "Modules/module.modulemap");
  const text = fs.existsSync(map) ? fs.readFileSync(map, "utf8") : "";
  return /umbrella\s+header\s+"([^"]+)"/.exec(text)?.[1] ?? `${module}.h`;
}

/** `header` as `#import <…>` names it: relative to the outermost include path that holds it. */
function includeOf(header: string, includePaths: string[]): string {
  const rel = includePaths
    .map((p) => path.relative(p, header))
    .filter((r) => !r.startsWith("..") && !path.isAbsolute(r));
  return rel.sort((a, b) => b.length - a.length)[0] ?? header;
}

/**
 * Which module declares each Objective-C type: the SDK's frameworks
 * scanned once per SDK, each other artifact once per contents.
 */
function headerIndex(r: Resolved): Record<string, string> {
  const memo = headerIndexes.get(r.key);
  if (memo) return memo;

  const { modules, frameworks } = r.ios!;
  const index: Record<string, string> = {};
  const merge = (part: Record<string, string>) => {
    for (const [name, module] of Object.entries(part)) index[name] ??= module;
  };

  const sdkFile = path.join(r.scope, "headers.json");
  let sdkPart = readCached(sdkFile) as Record<string, string> | undefined;
  if (!sdkPart) {
    sdkPart = {};
    for (const [module, headers] of modules)
      if (!headers)
        scanHeaders(
          sdkPart,
          module,
          filesUnder(path.join(frameworks, `${module}.framework/Headers`), /\.h$/),
        );
    publish(sdkFile, sdkPart);
  }
  merge(sdkPart);

  for (const a of r.artifacts) {
    if (a.kind === "sdk") continue;

    const file = path.join(r.memo, `ios-headers-${a.contentHash}.json`);
    let part = readCached(file) as Record<string, string> | undefined;
    if (!part) {
      part = {};
      // A module's own headers, and the ones its umbrella header includes next to it.
      for (const module of a.modules) {
        const headers = modules.get(module) ?? [];
        const dirs = new Set(headers.map((h) => path.dirname(h)));
        const files = [
          ...new Set([...headers, ...[...dirs].flatMap((d) => filesUnder(d, /\.h$/))]),
        ];
        scanHeaders(part, module, files);
      }
      publish(file, part);
    }
    merge(part);
  }

  headerIndexes.set(r.key, index);
  return index;
}

function readGraph(dir: string, module: string): SymbolGraph | undefined {
  return readCached(path.join(dir, `${module}.symbols.json`)) as SymbolGraph | undefined;
}

const graphErrors = new Map<string, string>();

/** Symbol graphs of `modules`, extracted six at a time. */
function graphs(r: Resolved, wanted: string[]): Map<string, SymbolGraph> {
  let modules = wanted;
  const out = new Map<string, SymbolGraph>();
  if (!modules.length) return out;
  const { ios, sdk: sdkPath, swiftModules } = r.ios!;
  // Swift made into modules on first use: emitted (once, into the cache) before it is read.
  const emitted = new Map<string, string>();
  modules = modules.filter((m) => {
    const why = swiftModules.planned.has(m)
      ? emitSwiftModule(swiftModules.planned, m, swiftModules.ctx, emitted)
      : undefined;
    if (why) graphErrors.set(m, why);
    return !why;
  });
  if (!modules.length) return out;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-graphs-"));
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const lines = modules.map(
    (m, i) =>
      `${[ios.xcrun ?? "xcrun", ...symbolGraphArgs(m, ios, sdkPath, tmp)].map(q).join(" ")} >${q(path.join(tmp, `${m}.log`))} 2>&1 &${(i + 1) % 6 === 0 ? "\nwait" : ""}`,
  );
  fs.writeFileSync(path.join(tmp, "run.sh"), `${lines.join("\n")}\nwait\n`);
  spawnSync("sh", [path.join(tmp, "run.sh")]);
  for (const m of modules) {
    const g = readGraph(tmp, m);
    if (g) out.set(m, g);
    else
      graphErrors.set(
        m,
        fs.existsSync(path.join(tmp, `${m}.log`))
          ? fs
              .readFileSync(path.join(tmp, `${m}.log`), "utf8")
              .trim()
              .split("\n")
              .slice(-5)
              .join("\n")
          : "no output",
      );
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

/** The names each build (each resolved SDK) has read from the cache, by module. */
let namesRead = new WeakMap<Resolved, Map<string, NamesIndex>>();

/** The names of `modules`' types, each cached on its own artifact. */
function namesFor(r: Resolved, modules: string[]): NamesIndex[] {
  const known = namesRead.get(r) ?? new Map<string, NamesIndex>();
  namesRead.set(r, known);
  const read = (m: string) => {
    const names = known.get(m) ?? findEntry<NamesEntry>(r, path.join(r.scope, m), "names")?.names;
    if (names) known.set(m, names);

    return names;
  };
  const missing = modules.filter((m) => !read(m));
  for (const [m, g] of graphs(r, missing))
    publishEntry(path.join(r.scope, m), "names", {
      inputs: inputsOf(r, [m]),
      names: namesOf(m, g),
    });
  return modules.map(read).filter((n): n is NamesIndex => !!n);
}

function iosNotFound(r: Resolved, module: string): { missing: string; fix: string } {
  const { ios } = r.ios!;
  const extra = [
    ios.includePaths?.length
      ? `${ios.includePaths.length} header path${ios.includePaths.length === 1 ? "" : "s"}`
      : "",
    ios.moduleMaps?.length
      ? `${ios.moduleMaps.length} module map${ios.moduleMaps.length === 1 ? "" : "s"}`
      : "",
    ios.frameworkPaths?.length
      ? `${ios.frameworkPaths.length} framework path${ios.frameworkPaths.length === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  const pods = extra.length
    ? ` and the app's pods (${extra.join(", ")}); run pod install after adding a pod`
    : "; no pods were read: when it comes from a pod, run pod install first";
  const where = `looked in ${r.ios!.frameworks}${pods}`;
  const failed = r.ios!.packageFailures;
  const packages = failed.length
    ? `; the app's Swift packages could not all be built: ${failed.join("; ")}`
    : "";
  return {
    missing: `lucent:ios/${module} was not found in the SDK or the app's dependencies (${where})${packages}`,
    fix: "check the module's name, and that the app installs the pod or framework that defines it",
  };
}

function extractIosModule(r: Resolved, module: string): Extracted {
  const { modules, sdk: sdkPath, ios } = r.ios!;
  const g = graphs(r, [module]).get(module);
  if (!g)
    return {
      missing: r.ios!.swiftModules.planned.has(module)
        ? `lucent:ios/${module}: its Swift could not be made into a module: ${graphErrors.get(module) ?? ""}`
        : `lucent:ios/${module}: swift-symbolgraph-extract produced no symbol graph:\n${graphErrors.get(module) ?? ""}`,
    };
  extractions++;
  const own = namesOf(module, g);
  publishEntry(path.join(r.scope, module), "names", { inputs: inputsOf(r, [module]), names: own });
  // Types of other modules keep their Swift names: those modules' graphs supply them.
  const owners = headerIndex(r);
  // The modules whose graphs this build has read say what they declare; the headers' scan the rest.
  const declaredBy: Record<string, string> = {};
  for (const n of namesRead.get(r)?.values() ?? [])
    for (const usr of Object.keys(n.refs)) declaredBy[usr] ??= n.module;
  const referenced = new Set(
    [...externalUsrs(g)].map((u) => ownerOf(u, owners, declaredBy)).filter((m): m is string => !!m),
  );
  referenced.delete(module);
  const deps = [...referenced].filter((m) => modules.has(m));
  const names = [own, ...namesFor(r, deps)];
  const headers = modules.get(module) ?? [`${module}/${module}.h`];
  // Where its headers are: the C functions Swift imports as members are named there.
  const headerDirs = modules.get(module)
    ? [...new Set(headers.map((h) => path.dirname(h)))]
    : [
        path.join(
          r.ios!.frameworkDirs.get(module) ?? r.ios!.frameworks,
          `${module}.framework/Headers`,
        ),
      ];
  const schema = buildIosSchema(
    module,
    g,
    names,
    (enums) => enumValues(enums, headers, ios, sdkPath),
    cSwiftNames(headerDirs),
  );
  // SDK frameworks are linked; the app's dependencies link themselves.
  // Module maps and frameworks name their umbrella header.
  const umbrella = r.ios!.umbrellas.get(module);
  const framework =
    r.ios!.frameworkDirs.get(module) ?? (modules.get(module) ? undefined : r.ios!.frameworks);
  const inFramework = framework && frameworkUmbrella(framework, module);
  const header = umbrella
    ? includeOf(umbrella, ios.includePaths ?? [])
    : inFramework && `${module}/${inFramework}`;
  const source = r.ios!.sources.get(module) ?? { kind: "sdk", files: [] };

  return {
    schema: {
      ...schema,
      ...(header ? { header } : {}),
      frameworks: modules.get(module) ? [] : [module],
      provenance: iosProvenance(module, source, r.ios!.version, iosTarget(ios)),
    },
    read: [module, ...referenced],
  };
}

// --- modules written as source --------------------------------------------------------

/**
 * The modules `module` is made of: those its Swift interface re-exports
 * (`@_exported import SwiftUICore`) and whose own interface names it as
 * their public module (`-public-module-name SwiftUI`).
 */
function sourceParts(r: Resolved, module: string): string[] {
  const iface = (m: string) => {
    const dir = path.join(r.ios!.frameworks, `${m}.framework/Modules/${m}.swiftmodule`);
    const file = fs.existsSync(dir)
      ? fs.readdirSync(dir).find((f) => f.endsWith(".swiftinterface"))
      : undefined;

    return file ? fs.readFileSync(path.join(dir, file), "utf8") : "";
  };
  const exported = [...iface(module).matchAll(/^@_exported import (\w+)$/gm)].map((m) => m[1]!);

  return exported.filter(
    (m) =>
      m !== module && new RegExp(`-public-module-name ${module}\\b`).test(iface(m).slice(0, 4096)),
  );
}

/** The symbol graphs of `modules` (their extensions' too), synthesized members left out. */
function sourceGraphs(r: Resolved, modules: string[]): SymbolGraph[] {
  const { ios, sdk } = r.ios!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-source-graphs-"));

  try {
    for (const m of modules) {
      const args = [...symbolGraphArgs(m, ios, sdk, tmp), "-skip-synthesized-members"];
      const run = spawnSync(ios.xcrun ?? "xcrun", args, { encoding: "utf8", maxBuffer: 64 << 20 });
      if (run.status !== 0) throw new Error(`swift-symbolgraph-extract ${m}: ${run.stderr}`);
    }

    return fs
      .readdirSync(tmp)
      .filter((f) => modules.some((m) => f === `${m}.symbols.json` || f.startsWith(`${m}@`)))
      .sort()
      .map((f) => readCached(path.join(tmp, f)) as SymbolGraph);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function extractSourceModule(r: Resolved, module: string): Extracted {
  const parts = sourceParts(r, module);
  const source = r.ios!.sources.get(module) ?? { kind: "sdk", files: [] };
  const provenance = iosProvenance(module, source, r.ios!.version, iosTarget(r.ios!.ios));

  extractions++;
  return {
    schema: buildSourceSchema(module, sourceGraphs(r, [module, ...parts]), provenance),
    read: [module, ...parts],
  };
}

/**
 * A Swift module written out as source (`lucent:swiftui`: SwiftUI, in a
 * component's body), extracted and cached as `sdkModule` does the modules
 * called through glue, under the module's `source/` entries.
 */
export function sdkSourceModule(
  platform: Platform,
  module: string,
  opts: SdkOptions = {},
): SdkLookup {
  if (platform !== "ios") return { missing: `${module}: only iOS modules are written as source` };
  if (!/^\w+$/.test(module)) return { missing: `${module} is not a module name` };

  const r = locate(platform, opts);
  if ("missing" in r) return fromSet(platform, module, "source", opts, r.missing);
  if (!r.providers.has(module)) return iosNotFound(r, module);

  serve(platform, module, "source");
  const memo = `${platform}|source|${r.scope}|${r.key}|${module}`;
  const hit = loaded.get(memo);
  if (hit) return hit.lookup;

  const dir = path.join(r.scope, module, "source");
  const cached = () => findEntry<SchemaEntry>(r, dir, "schema");
  const entry =
    cached() ??
    withLock(
      path.join(dir, "schema"),
      () => cached() !== undefined,
      (): SchemaEntry => {
        const x = extractSourceModule(r, module);
        if ("missing" in x) throw new Error(x.missing);

        const extracted = { inputs: inputsOf(r, x.read), schema: canonicalSchema(x.schema) };
        publishEntry(dir, "schema", extracted);
        return extracted;
      },
    ) ??
    cached();

  const lookup: SdkLookup = entry
    ? { schema: entry.schema }
    : { missing: `${module} could not be extracted as source` };
  loaded.set(memo, { lookup, ...(entry ? { inputs: entry.inputs } : {}) });

  return lookup;
}

// --- lookups -------------------------------------------------------------------------

/**
 * A platform's artifacts, resolved once per options object: a build's.
 * Another build resolves them again (a millisecond: their contents are
 * hashed by their files' stats), and sees a library updated in between.
 */
let locatedByObject = new WeakMap<SdkOptions, Map<Platform, Resolved | { missing: string }>>();

function locate(platform: Platform, opts: SdkOptions): Resolved | { missing: string } {
  const byObject = locatedByObject.get(opts)?.get(platform);
  if (byObject) return byObject;
  const found = platform === "android" ? locateAndroid(opts) : locateIos(opts);
  locatedByObject.set(opts, (locatedByObject.get(opts) ?? new Map()).set(platform, found));
  if (!("missing" in found)) {
    markUsed(found.scope);
    markUsed(found.memo);
    autoPrune(cacheRoot(opts.cacheDir));
  }
  return found;
}

// --- pruning -------------------------------------------------------------------------

/** The file in each extractor-versioned directory saying which extractor wrote it, and when it was last used. */
const MARK = ".extractor";

const marked = new Set<string>();

/** Records that this extractor uses `dir` now (once per process): pruning keeps it. */
function markUsed(dir: string): void {
  if (marked.has(dir)) return;
  marked.add(dir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, MARK), `${extractorVersion()}\n`);
  } catch {
    // A read-only cache is used as it is.
  }
}

/** A directory the cache keeps per extractor: each SDK scope, and each memo directory. */
function versionedDirs(root: string): string[] {
  const children = (dir: string) => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name));
    } catch {
      return [];
    }
  };
  return [
    ...children(path.join(root, "sdk/ios")),
    ...children(path.join(root, "sdk/android")),
    ...children(path.join(root, "memo")),
  ];
}

/** Bytes under `p`. */
function bytesUnder(p: string): number {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(p).reduce((n, e) => n + bytesUnder(path.join(p, e)), 0);
  } catch {
    return 0;
  }
}

/** A cache directory pruning removed, and the bytes it freed. */
export interface PrunedEntry {
  path: string;
  bytes: number;
}

/**
 * Removes what another extractor (an older or newer Lucent) wrote to the
 * cache: SDK scopes and memo directories this one never reads, their
 * keys holding the extractor's version. `unusedFor` keeps those another
 * Lucent on this machine used more recently than that (in ms): a project
 * pinning another version reads its own. Entries without a mark predate
 * marking: another extractor's.
 */
export function pruneStaleCache(
  opts: { cacheDir?: string; unusedFor?: number } = {},
): PrunedEntry[] {
  const root = cacheRoot(opts.cacheDir);
  const current = extractorVersion();
  const now = Date.now();
  const out: PrunedEntry[] = [];

  for (const dir of versionedDirs(root)) {
    const mark = path.join(dir, MARK);
    let version: string | undefined;
    let used = 0;
    try {
      version = fs.readFileSync(mark, "utf8").trim();
      used = fs.statSync(mark).mtimeMs;
    } catch {
      used = (() => {
        try {
          return fs.statSync(dir).mtimeMs;
        } catch {
          return now;
        }
      })();
    }
    if (version === current || path.basename(dir) === current) continue;
    if (opts.unusedFor !== undefined && now - used < opts.unusedFor) continue;

    const bytes = bytesUnder(dir);
    // Renamed away first: a reader sees the whole directory or none of it.
    const doomed = `${dir}.${process.pid}.pruned`;
    try {
      fs.renameSync(dir, doomed);
    } catch {
      continue;
    }
    fs.rmSync(doomed, { recursive: true, force: true });
    out.push({ path: dir, bytes });
  }

  return out;
}

/** How long another extractor's entries stay unused before builds prune them on their own. */
const AUTO_PRUNE_AFTER = 14 * 24 * 3600 * 1000;

/** Prunes, at most once a day per cache, entries other extractors have not used for two weeks. */
function autoPrune(root: string): void {
  if (process.env.LUCENT_NO_CACHE_PRUNE) return;
  const stamp = path.join(root, "pruned");
  try {
    if (Date.now() - fs.statSync(stamp).mtimeMs < 24 * 3600 * 1000) return;
  } catch {
    // Never pruned.
  }
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(stamp, "");
    pruneStaleCache({ cacheDir: root, unusedFor: AUTO_PRUNE_AFTER });
  } catch {
    // Pruning is housekeeping: a build goes on without it.
  }
}

/** A module's schema from the cache, else extracted once (whoever holds its lock) and published. */
function load(platform: Platform, r: Resolved, module: string): Loaded {
  if (!r.providers.has(module))
    return { lookup: platform === "android" ? androidNotFound(r, module) : iosNotFound(r, module) };

  const dir = path.join(r.scope, module);
  const cached = () => findEntry<SchemaEntry>(r, dir, "schema");

  const entry =
    cached() ??
    withLock(
      path.join(dir, "schema"),
      () => cached() !== undefined,
      (): SchemaEntry | { missing: string; fix?: string } => {
        const x =
          platform === "android" ? extractAndroidModule(r, module) : extractIosModule(r, module);
        if ("missing" in x) return x;

        // Canonical order: identical inputs publish identical schemas.
        const extracted = { inputs: inputsOf(r, x.read), schema: canonicalSchema(x.schema) };
        publishEntry(dir, "schema", extracted);
        return extracted;
      },
    ) ??
    cached();

  if (!entry) return { lookup: { missing: `lucent:${platform}/${module} could not be extracted` } };
  if ("missing" in entry) return { lookup: entry };

  return { lookup: { schema: entry.schema }, inputs: entry.inputs };
}

/** The schema of `lucent:<platform>/<module>`, extracting and caching it on first use. */
export function sdkModule(platform: Platform, module: string, opts: SdkOptions = {}): SdkLookup {
  if (!/^[\w.]+$/.test(module))
    return { missing: `lucent:${platform}/${module} is not a module name` };

  const r = locate(platform, opts);
  if ("missing" in r) return fromSet(platform, module, "schema", opts, r.missing);

  const memo = `${platform}|${r.scope}|${r.key}|${module}`;
  let hit = loaded.get(memo);
  if (!hit) {
    hit = load(platform, r, module);
    loaded.set(memo, hit);
  }
  if ("schema" in hit.lookup) serve(platform, module, "schema");

  return hit.lookup;
}

/**
 * The artifacts `lucent:<platform>/<module>`'s schema was read from: the
 * SDK, and those declaring what it read (none when there is no schema).
 */
export function sdkModuleArtifacts(
  platform: Platform,
  module: string,
  opts: SdkOptions = {},
): NativeArtifact[] {
  const r = locate(platform, opts);
  if ("missing" in r) {
    const entry = setEntry(platform, module, "schema", opts);
    return (entry?.artifacts ?? []).map(lockedArtifact(platform));
  }
  if ("missing" in sdkModule(platform, module, opts)) return [];

  const inputs = loaded.get(`${platform}|${r.scope}|${r.key}|${module}`)?.inputs ?? {};
  const read = [r.sdk, ...Object.keys(inputs).flatMap((n) => r.providers.get(n) ?? [])];
  const byId = new Map(read.filter((a) => !!a).map((a) => [a.id, a]));

  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The artifacts a platform's bindings come from, as the app's build resolved them. */
export function nativeArtifacts(
  platform: Platform,
  opts: SdkOptions = {},
): NativeArtifact[] | { missing: string } {
  const r = locate(platform, opts);
  return "missing" in r ? r : r.artifacts;
}

/** Whether a platform's SDK is installed. */
export function sdkAvailable(platform: Platform, opts: SdkOptions = {}): boolean {
  return !("missing" in locate(platform, opts)) || setModules(platform, opts).length > 0;
}

/** Whether a platform's bindings come from the exported schema set: its SDK is not installed. */
export function sdkFromSchemaSet(platform: Platform, opts: SdkOptions = {}): boolean {
  return "missing" in locate(platform, opts) && setModules(platform, opts).length > 0;
}

/**
 * What identifies the SDKs and artifacts a build uses (for build caches):
 * stable while their contents are, wherever they are.
 */
export function sdkIdentity(opts: SdkOptions = {}): string {
  return (["ios", "android"] as const)
    .map((p) => {
      const r = locate(p, opts);
      // The app's minSdk decides which uses need a check: builds of another one differ.
      const levels = p === "android" ? [`minSdk ${androidLevels(opts).minSdk ?? ""}`] : [];
      if (!("missing" in r)) return hash([path.basename(r.scope), r.key, ...levels]);
      return setModules(p, opts).length ? `set-${setIdentity(p, opts)}` : "none";
    })
    .join("|");
}

/**
 * Where the cache keeps the schema of `lucent:<platform>/<module>` this
 * build read (after sdkModule): `<scope>/<entry>`, which names no machine
 * path, for cachedSchema to read it back after the SDK changes.
 */
export function sdkSchemaEntry(
  platform: Platform,
  module: string,
  opts: SdkOptions = {},
): string | undefined {
  const r = locate(platform, opts);
  if ("missing" in r) return setEntry(platform, module, "schema", opts)?.entry;

  const inputs = loaded.get(`${platform}|${r.scope}|${r.key}|${module}`)?.inputs;
  return inputs ? `${path.basename(r.scope)}/${entryKey(inputs)}` : undefined;
}

/**
 * The schema the cache holds under an entry sdkSchemaEntry gave, whether
 * or not the SDK and artifacts it was read from are still installed:
 * undefined when this machine's cache does not have it.
 */
export function cachedSchema(
  platform: Platform,
  module: string,
  entry: string,
  opts: SdkOptions = {},
): SdkModuleSchema | undefined {
  const [scope, key, ...rest] = entry.split("/");
  if (!scope || !key || rest.length || !/^[\w-][\w.-]*$/.test(scope) || !/^\w+$/.test(key))
    return undefined;
  if (!/^[\w.]+$/.test(module)) return undefined;

  const file = path.join(cacheRoot(opts.cacheDir), "sdk", platform, scope, module, `${key}.json`);
  const cached = readCached(file) as Partial<SchemaEntry> | undefined;

  return cached && hasSchemaFormat(cached.schema) ? cached.schema : undefined;
}

/** Extracts `modules` ahead of use (lucent sdk prefetch). */
export function prefetch(
  platform: Platform,
  modules: string[],
  opts: SdkOptions = {},
): SdkLookup[] {
  return modules.map((m) => sdkModule(platform, m, opts));
}

/**
 * The modules of this SDK whose bindings are in the cache, without
 * extracting any: full schemas, and (iOS) the ones known by name only.
 */
export function cachedModules(
  platform: Platform,
  opts: SdkOptions = {},
): { schemas: string[]; names: string[] } | { missing: string } {
  const r = locate(platform, opts);
  if ("missing" in r) {
    const set = setModules(platform, opts);
    return set.length
      ? {
          schemas: set.filter((m) => setEntry(platform, m, "schema", opts)),
          names: set.filter((m) => !setEntry(platform, m, "schema", opts)),
        }
      : r;
  }

  // Only entries this build would read: another build's pods or classpath may differ.
  const dirs = fs.existsSync(r.scope)
    ? fs.readdirSync(r.scope, { withFileTypes: true }).filter((e) => e.isDirectory())
    : [];
  const has = (module: string, kind: "schema" | "names") =>
    findEntry(r, path.join(r.scope, module), kind) !== undefined;

  const schemas = dirs.map((d) => d.name).filter((m) => has(m, "schema"));
  const names = dirs.map((d) => d.name).filter((m) => !schemas.includes(m) && has(m, "names"));

  return { schemas: schemas.sort(), names: names.sort() };
}

/** Every module a platform's SDK has (no list: the SDK's own contents). */
export function sdkModules(
  platform: Platform,
  opts: SdkOptions = {},
): string[] | { missing: string } {
  const r = locate(platform, opts);
  if ("missing" in r) {
    const set = setModules(platform, opts).filter((m) => setEntry(platform, m, "schema", opts));
    return set.length ? set : r;
  }
  if (platform === "android")
    return [...jarIndex(r.android!.jars, r.android!.apiVersions).packages].sort();
  return [...r.ios!.modules.keys()].sort();
}

/**
 * The facts of the types a platform's members name, from the modules
 * declaring them (their names on iOS, which cost a symbol graph, their
 * schemas on Android), for judging members as a build would (coverage):
 * a module there is no reading of is taken as declaring its types, of
 * unknown kind, as plans without lookups do.
 */
export function sdkTypeLookup(platform: Platform, opts: SdkOptions = {}): TypeLookup {
  const names = new Map<string, NamesIndex | undefined>();
  return (module, name) => {
    if (!names.has(module)) {
      const n = sdkNames(platform, module, opts);
      names.set(module, "names" in n ? n.names : undefined);
    }
    const index = names.get(module);
    if (!index) return {};
    const t = index.types[name];
    if (!t) return undefined;
    return {
      kind: t.kind,
      ...(t.cf ? { cf: true } : {}),
      ...(t.typeParams ? { typeParams: t.typeParams } : {}),
      ...(t.swift ? { swift: true as const } : {}),
    };
  };
}

/** A schema's type names, as a names index gives them: what glue reads of a type it does not import. */
export function namesOfSchema(schema: SdkModuleSchema): NamesIndex {
  const types: NamesIndex["types"] = {};
  for (const t of schema.types) {
    if (t.kind === "class")
      types[t.name] = {
        kind: t.interface ? "protocol" : "class",
        native: t.native,
        ...(t.cf ? { cf: true } : {}),
        ...(t.swift ? { swift: true } : {}),
        ...(t.typeParams?.length ? { typeParams: t.typeParams.length } : {}),
      };
    else if (t.kind === "enum")
      types[t.name] = {
        kind: "enum",
        native: t.native,
        ...(t.swift ? { swift: true } : {}),
        ...(t.options ? { options: true } : {}),
      };
    else types[t.name] = { kind: "struct", native: t.native, fields: t.fields };
  }
  return { module: schema.module, refs: {}, aliases: {}, types };
}

/** The jars Android bindings come from (tests and tools). */
export function androidJars(opts: SdkOptions = {}): string[] | undefined {
  const r = locate("android", opts);
  return "missing" in r ? undefined : r.android!.jars;
}

export type SdkNamesLookup = { names: NamesIndex } | { missing: string };

/**
 * The names of a module's types (kind and native name), without its schema:
 * enough to type another module's signatures that mention them. On iOS it
 * costs a symbol graph, not the schema's clang work or its dependencies.
 */
export function sdkNames(
  platform: Platform,
  module: string,
  opts: SdkOptions = {},
): SdkNamesLookup {
  const r = locate(platform, opts);
  if ("missing" in r) {
    const names = setEntry(platform, module, "names", opts)?.names;
    if (names) return { names };
  }
  if (platform === "android" || "missing" in r) {
    const found = sdkModule(platform, module, opts);
    if ("missing" in found) return found;
    return { names: namesOfSchema(found.schema) };
  }
  if (!r.ios!.modules.has(module))
    return { missing: `lucent:ios/${module} was not found in the SDK or the app's dependencies` };
  const [names] = namesFor(r, [module]);
  if (names) serve(platform, module, "names");
  return names
    ? { names }
    : { missing: `lucent:ios/${module}: swift-symbolgraph-extract produced no symbol graph` };
}

// --- the exported schema set -----------------------------------------------------------

/**
 * The schema set's format: what each of its files holds. A file of
 * another format, or holding a schema of another SCHEMA_FORMAT, is not
 * read: `lucent sdk lock --schemas` writes the set again.
 */
export const SCHEMA_SET_FORMAT = 1;

type SetKind = "schema" | "source" | "names";

/** One module in the set: `<set>/<platform>/<module>.json` (`.source.json`, `.names.json`). */
export interface SchemaSetEntry {
  format: number;
  platform: Platform;
  module: string;
  kind: SetKind;
  /** The artifacts it was read from (`id#contentHash`), as the lock records them. */
  artifacts: string[];
  /** Where the exporting machine's cache keeps it (the lock's `schema`). */
  entry?: string;
  schema?: SdkModuleSchema;
  names?: NamesIndex;
}

/** What this process served from an installed SDK: what an export writes. */
const served = new Map<string, { platform: Platform; module: string; kind: SetKind }>();
const setEntries = new Map<string, SchemaSetEntry | null>();
const setIdentities = new Map<string, string>();

function serve(platform: Platform, module: string, kind: SetKind): void {
  served.set(`${platform}|${kind}|${module}`, { platform, module, kind });
}

const setSuffix = (kind: SetKind) =>
  kind === "schema" ? ".json" : kind === "source" ? ".source.json" : ".names.json";

function setFile(dir: string, platform: Platform, module: string, kind: SetKind): string {
  return path.join(dir, platform, `${module}${setSuffix(kind)}`);
}

/** A module's entry in the set, when it has one of this format. */
function setEntry(
  platform: Platform,
  module: string,
  kind: SetKind,
  opts: SdkOptions,
): SchemaSetEntry | undefined {
  if (!opts.schemas || !/^[\w.]+$/.test(module)) return undefined;

  const file = setFile(opts.schemas, platform, module, kind);
  let entry = setEntries.get(file);
  if (entry === undefined) {
    const value = readCached(file) as Partial<SchemaSetEntry> | undefined;
    const whole =
      value?.format === SCHEMA_SET_FORMAT &&
      value.platform === platform &&
      value.module === module &&
      (kind === "names" ? !!value.names : hasSchemaFormat(value.schema));
    entry = whole ? (value as SchemaSetEntry) : null;
    setEntries.set(file, entry);
  }

  return entry ?? undefined;
}

/** The modules the set has for a platform, whatever their kind. */
function setModules(platform: Platform, opts: SdkOptions): string[] {
  if (!opts.schemas) return [];

  let files: string[];
  try {
    files = fs.readdirSync(path.join(opts.schemas, platform));
  } catch {
    return [];
  }

  const modules = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/(\.source|\.names)?\.json$/, ""));
  return [...new Set(modules)].sort();
}

/** What identifies the set's files for a platform, for build caches: their contents. */
function setIdentity(platform: Platform, opts: SdkOptions): string {
  const dir = path.join(opts.schemas!, platform);
  let id = setIdentities.get(dir);
  if (id === undefined) {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    id = hash(files.map((f) => `${f} ${contentHash([path.join(dir, f)])}`));
    setIdentities.set(dir, id);
  }

  return id;
}

/** A lookup from the set, where the platform's SDK is `missing`. */
function fromSet(
  platform: Platform,
  module: string,
  kind: "schema" | "source",
  opts: SdkOptions,
  missing: string,
): SdkLookup {
  if (!setModules(platform, opts).length) return { missing };

  const entry = setEntry(platform, module, kind, opts);
  if (entry?.schema) return { schema: entry.schema };

  const other = fs.existsSync(setFile(opts.schemas!, platform, module, kind));
  return {
    missing: other
      ? `lucent:${platform}/${module} in ${opts.schemas} was exported by another Lucent (schema format ${SCHEMA_FORMAT} here)`
      : `lucent:${platform}/${module} is not in the exported schemas (${opts.schemas}), and ${missing}`,
    fix: "run lucent sdk lock --schemas where the SDK is installed, and commit lucent-sdk.schemas/",
  };
}

/** An artifact as the set records it: its identity alone. */
const lockedArtifact =
  (platform: Platform) =>
  (identityText: string): NativeArtifact => {
    const at = identityText.lastIndexOf("#");
    return {
      id: identityText.slice(0, at),
      target: platform,
      kind: "sdk",
      contentHash: identityText.slice(at + 1),
      targetTriple: "",
      dependencies: [],
      modules: [],
      declarationInputs: [],
      includePaths: [],
      compilerArguments: [],
      origin: { package: "", version: "", buildFile: "" },
    };
  };

/** The modules a schema names types of, besides its own. */
function referencedModules(schema: SdkModuleSchema): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (o.k === "ref" && typeof o.module === "string") out.add(o.module);
    for (const [k, x] of Object.entries(o)) {
      if ((k === "extends" || k === "implements") && x) {
        for (const ref of [x].flat())
          if (typeof ref === "string" && ref.includes("."))
            out.add(ref.slice(0, ref.lastIndexOf(".")));
      } else visit(x);
    }
  };
  visit(schema.types);
  visit(schema.functions);
  visit(schema.constants);
  out.delete(schema.module);
  return out;
}

/**
 * Writes what this process read from installed SDKs (a check's schemas,
 * source modules and names) as the schema set in `dir`, for `platforms`,
 * with the modules those schemas name types of: their names on iOS,
 * their schemas on Android (whose declarations read other modules'
 * types). Each platform's directory is replaced whole. The files it wrote.
 */
export function exportSchemaSet(
  dir: string,
  platforms: readonly Platform[],
  opts: SdkOptions = {},
): string[] {
  const written: string[] = [];

  for (const platform of platforms) {
    if ("missing" in locate(platform, opts)) {
      // No SDK here: the set this check read stays as it is.
      if (opts.schemas && path.resolve(opts.schemas) === path.resolve(dir)) continue;
      throw new Error(`the ${platform} SDK is not installed: its schemas cannot be exported`);
    }

    const wanted = new Map<string, { module: string; kind: SetKind }>();
    for (const s of served.values())
      if (s.platform === platform) wanted.set(`${s.kind}|${s.module}`, s);

    // The modules served schemas name: what declarations and glue look up beside them.
    for (const s of [...wanted.values()]) {
      if (s.kind === "names") continue;
      const found =
        s.kind === "schema"
          ? sdkModule(platform, s.module, opts)
          : sdkSourceModule(platform, s.module, opts);
      if (!("schema" in found)) continue;
      for (const m of referencedModules(found.schema)) {
        const kind: SetKind = platform === "ios" ? "names" : "schema";
        if (!wanted.has(`schema|${m}`)) wanted.set(`${kind}|${m}`, { module: m, kind });
      }
    }

    const entries: SchemaSetEntry[] = [];
    for (const { module, kind } of [...wanted.values()].sort((a, b) =>
      `${a.module} ${a.kind}` < `${b.module} ${b.kind}` ? -1 : 1,
    )) {
      if (kind === "names" && wanted.has(`schema|${module}`)) continue;
      const artifacts = sdkModuleArtifacts(platform, module, opts).map(identity).sort();
      const base = { format: SCHEMA_SET_FORMAT, platform, module, kind, artifacts };
      if (kind === "names") {
        const n = sdkNames(platform, module, opts);
        if ("names" in n) entries.push({ ...base, names: n.names });
        continue;
      }
      const found =
        kind === "schema"
          ? sdkModule(platform, module, opts)
          : sdkSourceModule(platform, module, opts);
      if (!("schema" in found)) continue;
      const entry = kind === "schema" ? sdkSchemaEntry(platform, module, opts) : undefined;
      entries.push({ ...base, ...(entry ? { entry } : {}), schema: found.schema });
      // Its names too (iOS): what the symbol graph says that the schema does not (aliases, refs).
      if (platform === "ios" && kind === "schema") {
        const n = sdkNames(platform, module, opts);
        if ("names" in n) entries.push({ ...base, kind: "names", names: n.names });
      }
    }

    const target = path.join(dir, platform);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const e of entries) {
      const file = setFile(dir, platform, e.module, e.kind);
      fs.writeFileSync(path.join(tmp, path.basename(file)), `${JSON.stringify(e, null, 1)}\n`);
      written.push(file);
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
    setIdentities.delete(target);
    for (const f of setEntries.keys()) if (f.startsWith(target + path.sep)) setEntries.delete(f);
  }

  return written;
}
