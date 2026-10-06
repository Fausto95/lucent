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
import type { PodFramework } from "./pods.ts";
import { buildSourceSchema } from "./swift-source.ts";
import type { SymbolGraph } from "./symbols.ts";
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
  android?: {
    /** The jars to bind (default: the SDK platform's android.jar). */
    jars?: string[];
    /** Where to look for the Android SDK (default: $ANDROID_HOME, $ANDROID_SDK_ROOT, the usual install locations). */
    sdkRoots?: string[];
    /** platforms/<name> to use (default: $LUCENT_ANDROID_PLATFORM, else the newest installed). */
    platform?: string;
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
    const name = wanted ?? platforms.sort((a, b) => version(b) - version(a))[0];
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
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
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
  const sdkFrameworks = (fs.existsSync(frameworks) ? fs.readdirSync(frameworks) : [])
    .filter((f) => f.endsWith(".framework"))
    .map((f) => f.slice(0, -".framework".length));
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

  for (const dir of frameworkPaths) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (!f.endsWith(".framework")) continue;
      const name = f.slice(0, -".framework".length);
      const framework = path.join(dir, f);
      modules.set(name, filesUnder(path.join(framework, "Headers"), /\.h$/));
      sources.set(name, {
        kind: "framework",
        files: ["Headers", "Modules"].map((d) => path.join(framework, d)),
      });
      frameworkDirs.set(name, dir);
    }
  }

  // A pod's framework is its pod's files (Target Support Files/<pod>/ says which pod).
  for (const f of opts.ios?.frameworks ?? [])
    sources.set(f.module, { kind: "framework", files: [f.moduleMap, f.umbrella, ...f.headers] });

  // A module whose files are in Pods/ is its pod's, at the version Podfile.lock installed.
  const lockfile = opts.ios?.lockfile;
  const pods = lockfile ? lockedPods(lockfile) : new Map<string, LockedPod>();
  if (lockfile) {
    const podsDir = path.join(path.dirname(lockfile), "Pods");
    for (const source of sources.values()) {
      const pod = podOf(source.files, podsDir, pods);
      if (pod) source.pod = `${pod}@${pods.get(pod)!.version}`;
    }
  }

  const ios: IosOptions = { modules: [], includePaths, frameworkPaths, moduleMaps, defines, xcrun };
  const targetTriple = iosTarget(ios);

  const artifacts = iosArtifacts(memo, {
    sdk: { path: sdk, version, build, frameworks: sdkFrameworks },
    sources,
    lockfile,
    pods,
    includePaths,
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
      ios: { sdk, version, ios, frameworks, modules, umbrellas, frameworkDirs, sources },
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
function graphs(r: Resolved, modules: string[]): Map<string, SymbolGraph> {
  const out = new Map<string, SymbolGraph>();
  if (!modules.length) return out;
  const { ios, sdk: sdkPath } = r.ios!;
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
  return {
    missing: `lucent:ios/${module} was not found in the SDK or the app's dependencies (${where})`,
    fix: "check the module's name, and that the app installs the pod or framework that defines it",
  };
}

function extractIosModule(r: Resolved, module: string): Extracted {
  const { modules, sdk: sdkPath, ios } = r.ios!;
  const g = graphs(r, [module]).get(module);
  if (!g)
    return {
      missing: `lucent:ios/${module}: swift-symbolgraph-extract produced no symbol graph:\n${graphErrors.get(module) ?? ""}`,
    };
  extractions++;
  const own = namesOf(module, g);
  publishEntry(path.join(r.scope, module), "names", { inputs: inputsOf(r, [module]), names: own });
  // Types of other modules keep their Swift names: those modules' graphs supply them.
  const owners = headerIndex(r);
  const referenced = new Set(
    [...externalUsrs(g)].map((u) => ownerOf(u, owners)).filter((m): m is string => !!m),
  );
  referenced.delete(module);
  const deps = [...referenced].filter((m) => modules.has(m));
  const names = [own, ...namesFor(r, deps)];
  const headers = modules.get(module) ?? [`${module}/${module}.h`];
  const schema = buildIosSchema(module, g, names, (enums) =>
    enumValues(enums, headers, ios, sdkPath),
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
  if ("missing" in r) return r;
  if (!r.providers.has(module)) return iosNotFound(r, module);

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
  return found;
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
  if ("missing" in r) return r;

  const memo = `${platform}|${r.scope}|${r.key}|${module}`;
  let hit = loaded.get(memo);
  if (!hit) {
    hit = load(platform, r, module);
    loaded.set(memo, hit);
  }

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
  if ("missing" in r || "missing" in sdkModule(platform, module, opts)) return [];

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
  return !("missing" in locate(platform, opts));
}

/**
 * What identifies the SDKs and artifacts a build uses (for build caches):
 * stable while their contents are, wherever they are.
 */
export function sdkIdentity(opts: SdkOptions = {}): string {
  return (["ios", "android"] as const)
    .map((p) => {
      const r = locate(p, opts);
      return "missing" in r ? "none" : hash([path.basename(r.scope), r.key]);
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
  if ("missing" in r) return undefined;

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
  if ("missing" in r) return r;

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
  if ("missing" in r) return r;
  if (platform === "android")
    return [...jarIndex(r.android!.jars, r.android!.apiVersions).packages].sort();
  return [...r.ios!.modules.keys()].sort();
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
  if (platform === "android" || "missing" in r) {
    const found = sdkModule(platform, module, opts);
    if ("missing" in found) return found;
    const types: NamesIndex["types"] = {};
    for (const t of found.schema.types)
      types[t.name] =
        t.kind === "class"
          ? { kind: t.interface ? "protocol" : "class", native: t.native }
          : { kind: t.kind, native: t.native };
    return { names: { module, refs: {}, aliases: {}, types } };
  }
  if (!r.ios!.modules.has(module))
    return { missing: `lucent:ios/${module} was not found in the SDK or the app's dependencies` };
  const [names] = namesFor(r, [module]);
  return names
    ? { names }
    : { missing: `lucent:ios/${module}: swift-symbolgraph-extract produced no symbol graph` };
}
