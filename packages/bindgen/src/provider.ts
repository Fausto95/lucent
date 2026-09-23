import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { extractAndroid, jarIndex } from "./android.ts";
import { buildIosSchema, enumValues, externalUsrs, type IosOptions, namesOf, type NamesIndex, type SymbolGraph, symbolGraphArgs } from "./ios.ts";
import type { Platform, SdkModuleSchema } from "./schema.ts";

/**
 * SDK modules on demand: the first program that imports `lucent:ios/X` or
 * `lucent:android/p.q` extracts it from the installed SDK; the schema is
 * cached per machine under <cache>/sdk/<platform>/<SDK key>/<module>.json,
 * the key naming the SDK, so a new Xcode or SDK platform extracts again.
 * There is no list of modules: anything the SDK has can be imported.
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
  };
  ios?: {
    /** Directories with module maps, for modules outside the SDK. */
    includePaths?: string[];
    /** Framework search paths, and module maps loaded explicitly (the app's pods: see podsSearchPaths). */
    frameworkPaths?: string[];
    moduleMaps?: string[];
    xcrun?: string;
  };
  /** Fall back to @lucent-lang/sdk-<platform> prebuilt caches when there is no local SDK (default true). */
  prebuilt?: boolean;
}

export type SdkLookup = { schema: SdkModuleSchema } | { missing: string };

let extractions = 0;
/** How many modules were extracted in this process (tests). */
export function extractionCount(): number {
  return extractions;
}

const loaded = new Map<string, SdkLookup>();
const located = new Map<string, Located | { missing: string }>();
/** Forgets what this process loaded, as a new process would (tests). */
export function forgetLoadedSdks(): void {
  loaded.clear();
  located.clear();
}

function cacheRoot(opts: SdkOptions): string {
  if (opts.cacheDir) return opts.cacheDir;
  if (process.env.LUCENT_CACHE_DIR) return process.env.LUCENT_CACHE_DIR;
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "lucent");
}

interface Located {
  /** Cache directory for this SDK. */
  dir: string;
  /** What the SDK is, for messages. */
  describe: string;
  android?: { jars: string[]; apiVersions?: string; dependencies: number; classpath?: string };
  /** modules: module name → its headers (undefined: an SDK framework, <M>/<M>.h). */
  ios?: { sdk: string; ios: IosOptions; frameworks: string; modules: Map<string, string[] | undefined>; umbrellas: Map<string, string> };
}

const hash = (parts: string[]) => crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);

let extractorHash: string | undefined;
/** The extractor's own code: a change to it re-extracts, so caches never hold stale schemas. */
function extractorVersion(): string {
  if (extractorHash) return extractorHash;
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const h = crypto.createHash("sha256");
  for (const f of fs.readdirSync(dir).sort()) if (/\.(ts|js)$/.test(f)) h.update(fs.readFileSync(path.join(dir, f)));
  extractorHash = h.digest("hex").slice(0, 8);
  return extractorHash;
}

function fileIdentity(files: string[]): string[] {
  return files.map((f) => {
    const st = fs.statSync(f);
    return `${f}:${st.size}:${st.mtimeMs}`;
  });
}

// --- Android -------------------------------------------------------------------------

function androidRoots(opts: SdkOptions): string[] {
  if (opts.android?.sdkRoots) return opts.android.sdkRoots;
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), "Library/Android/sdk"), path.join(os.homedir(), "Android/Sdk")].filter((r): r is string => !!r);
}

function locateAndroid(opts: SdkOptions): Located | { missing: string } {
  let jars = opts.android?.jars ?? (process.env.LUCENT_ANDROID_JARS ? process.env.LUCENT_ANDROID_JARS.split(path.delimiter) : undefined);
  let apiVersions: string | undefined;
  let describe: string;
  if (!jars) {
    const roots = androidRoots(opts);
    const root = roots.find((r) => fs.existsSync(path.join(r, "platforms")));
    const platforms = root ? fs.readdirSync(path.join(root, "platforms")).filter((p) => fs.existsSync(path.join(root, "platforms", p, "android.jar"))) : [];
    const wanted = opts.android?.platform ?? process.env.LUCENT_ANDROID_PLATFORM;
    const version = (p: string) => Number(/(\d+(\.\d+)?)/.exec(p)?.[1] ?? 0);
    const platform = wanted ?? platforms.sort((a, b) => version(b) - version(a))[0];
    if (!root || !platform || !platforms.includes(platform)) {
      return { missing: `the Android SDK${wanted ? ` platform ${wanted}` : ""} was not found (looked in ${roots.join(", ") || "no locations"}). Install it with Android Studio, or set ANDROID_HOME to its location.` };
    }
    jars = [path.join(root, "platforms", platform, "android.jar")];
    const xml = path.join(root, "platforms", platform, "data/api-versions.xml");
    if (fs.existsSync(xml)) apiVersions = xml;
    describe = `${path.basename(platform)} (${root})`;
  } else {
    describe = jars.join(", ");
  }
  const missingJar = jars.find((j) => !fs.existsSync(j));
  if (missingJar) return { missing: `the Android SDK jar ${missingJar} was not found` };
  // The app's dependencies, after the platform: the platform's classes win.
  const classpath = opts.android?.classpath;
  let dependencies: string[] = [];
  if (classpath && fs.existsSync(classpath)) {
    const cp = JSON.parse(fs.readFileSync(classpath, "utf8")) as { jars?: string[]; aars?: string[] };
    dependencies = [...(cp.jars ?? []), ...(cp.aars ?? [])].filter((f) => fs.existsSync(f));
  }
  const all = [...jars, ...dependencies];
  const key = `${path.basename(path.dirname(jars[0]!))}-${hash([extractorVersion(), ...fileIdentity([...all, ...(apiVersions ? [apiVersions] : [])])])}`;
  return { dir: path.join(cacheRoot(opts), "sdk/android", key), describe, android: { jars: all, apiVersions, dependencies: dependencies.length, classpath } };
}

function extractAndroidModule(sdk: Located, module: string): SdkLookup {
  const { jars, apiVersions, dependencies, classpath } = sdk.android!;
  const index = jarIndex(jars, apiVersions);
  if (!index.packages.has(module)) {
    const platformJars = jars.slice(0, jars.length - dependencies);
    let where = `looked in ${platformJars.join(", ")}`;
    if (dependencies) where += ` and ${dependencies} dependency jar${dependencies === 1 ? "" : "s"} from ${classpath}`;
    else if (classpath) where += `; the app's dependencies are not resolved yet: run ./gradlew :app:lucentClasspath in android/ (lucent build runs it when an import is not in the SDK)`;
    return { missing: `lucent:android/${module} was not found in the SDK or the app's dependencies (${where})` };
  }
  extractions++;
  return { schema: extractAndroid({ jars, apiVersions, packages: [module] })[0]! };
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

function locateIos(opts: SdkOptions): Located | { missing: string } {
  const xcrun = opts.ios?.xcrun ?? process.env.LUCENT_XCRUN ?? "xcrun";
  const sdk = run(xcrun, ["--sdk", "iphonesimulator", "--show-sdk-path"]);
  const version = run(xcrun, ["--sdk", "iphonesimulator", "--show-sdk-version"]);
  const build = run(xcrun, ["--sdk", "iphonesimulator", "--show-sdk-build-version"]);
  if (!sdk || !version || !build) {
    return { missing: `the iOS SDK was not found (${xcrun} --sdk iphonesimulator failed). Install Xcode and select it: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` };
  }
  const includePaths = opts.ios?.includePaths ?? [];
  const frameworkPaths = opts.ios?.frameworkPaths ?? [];
  const moduleMaps = opts.ios?.moduleMaps ?? [];
  // Modules: the SDK's frameworks, frameworks on the framework paths, and
  // the module maps on the include paths or loaded explicitly (pods).
  const frameworks = path.join(sdk, "System/Library/Frameworks");
  const modules = new Map<string, string[] | undefined>();
  const umbrellas = new Map<string, string>();
  for (const f of fs.existsSync(frameworks) ? fs.readdirSync(frameworks) : []) if (f.endsWith(".framework")) modules.set(f.slice(0, -".framework".length), undefined);
  const readMap = (map: string) => {
    const text = fs.readFileSync(map, "utf8");
    const headers = [...text.matchAll(/(?:umbrella\s+)?header\s+"([^"]+)"/g)].map((h) => path.resolve(path.dirname(map), h[1]!));
    for (const m of text.matchAll(/^\s*(?:framework\s+)?module\s+([\w.]+)/gm)) {
      modules.set(m[1]!, headers.length ? headers : filesUnder(path.dirname(map), /\.h$/));
      if (headers.length) umbrellas.set(m[1]!, headers[0]!);
    }
  };
  const keyFiles: string[] = [...moduleMaps];
  for (const inc of includePaths) {
    for (const map of filesUnder(inc, /^module\.modulemap$/)) {
      readMap(map);
      keyFiles.push(map);
    }
  }
  for (const map of moduleMaps) readMap(map);
  for (const dir of frameworkPaths) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (!f.endsWith(".framework")) continue;
      const name = f.slice(0, -".framework".length);
      modules.set(name, filesUnder(path.join(dir, f, "Headers"), /\.h$/));
      keyFiles.push(path.join(dir, f));
    }
  }
  for (const headers of modules.values()) keyFiles.push(...(headers ?? []));
  const key = `iphonesimulator${version}-${build}-${hash([extractorVersion(), ...includePaths, ...frameworkPaths, ...fileIdentity(keyFiles.filter((f) => fs.existsSync(f)))])}`;
  return { dir: path.join(cacheRoot(opts), "sdk/ios", key), describe: `iOS ${version} SDK (${build})`, ios: { sdk, ios: { modules: [], includePaths, frameworkPaths, moduleMaps, xcrun }, frameworks, modules, umbrellas } };
}

/** The umbrella header an SDK framework's module map names (not always `<M>.h`). */
function frameworkUmbrella(frameworks: string, module: string): string {
  const map = path.join(frameworks, `${module}.framework/Modules/module.modulemap`);
  const text = fs.existsSync(map) ? fs.readFileSync(map, "utf8") : "";
  return /umbrella\s+header\s+"([^"]+)"/.exec(text)?.[1] ?? `${module}.h`;
}

/** `header` as `#import <…>` names it: relative to the outermost include path that holds it. */
function includeOf(header: string, includePaths: string[]): string {
  const rel = includePaths.map((p) => path.relative(p, header)).filter((r) => !r.startsWith("..") && !path.isAbsolute(r));
  return rel.sort((a, b) => b.length - a.length)[0] ?? header;
}

/** Which module declares each Objective-C type, from a scan of the headers (cheap, once per SDK). */
function headerIndex(sdk: Located): Record<string, string> {
  const file = path.join(sdk.dir, "headers.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
  const index: Record<string, string> = {};
  const scan = (module: string, headers: string[]) => {
    for (const h of headers) {
      const text = fs.readFileSync(h, "utf8");
      const patterns = [
        /@interface\s+(\w+)/g,
        /@protocol\s+(\w+)\s*[<\n]/g,
        /NS_(?:ENUM|OPTIONS|CLOSED_ENUM|ERROR_ENUM)\s*\(\s*[\w\s]+,\s*(\w+)\s*\)/g,
        /typedef\s+[\w\s*]+?\b(\w+)\s+(?:NS_TYPED_ENUM|NS_TYPED_EXTENSIBLE_ENUM|NS_STRING_ENUM|NS_EXTENSIBLE_STRING_ENUM)/g,
        /typedef\s+(?:struct|union|enum)\s+\w*\s*(?:\{[^}]*\})?\s*(\w+)\s*;/g,
        /typedef\s+(?:const\s+)?struct\s+__\w+\s*\*\s*(\w+)/g,
      ];
      for (const re of patterns) for (const m of text.matchAll(re)) index[m[1]!] ??= module;
    }
  };
  for (const [module, headers] of sdk.ios!.modules) {
    // A module's own headers, and the ones its umbrella header includes next to it.
    const files = headers ? [...new Set(headers.flatMap((h) => [h, ...filesUnder(path.dirname(h), /\.h$/)]))] : filesUnder(path.join(sdk.ios!.frameworks, `${module}.framework/Headers`), /\.h$/);
    scan(module, files);
  }
  write(file, index);
  return index;
}

/** The module a clang USR's declaration comes from. */
function ownerOf(usr: string, headers: Record<string, string>): string | undefined {
  const name = /^c:(?:objc\((?:cs|pl)\)|.*@[ETS]@)(\w+)$/.exec(usr)?.[1];
  return name ? headers[name] : undefined;
}

function readGraph(dir: string, module: string): SymbolGraph | undefined {
  const file = path.join(dir, `${module}.symbols.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as SymbolGraph) : undefined;
}

const graphErrors = new Map<string, string>();

/** Symbol graphs of `modules`, extracted six at a time. */
function graphs(sdk: Located, modules: string[]): Map<string, SymbolGraph> {
  const out = new Map<string, SymbolGraph>();
  if (!modules.length) return out;
  const { ios, sdk: sdkPath } = sdk.ios!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-graphs-"));
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const lines = modules.map((m, i) => `${[ios.xcrun ?? "xcrun", ...symbolGraphArgs(m, ios, sdkPath, tmp)].map(q).join(" ")} >${q(path.join(tmp, `${m}.log`))} 2>&1 &${(i + 1) % 6 === 0 ? "\nwait" : ""}`);
  fs.writeFileSync(path.join(tmp, "run.sh"), `${lines.join("\n")}\nwait\n`);
  spawnSync("sh", [path.join(tmp, "run.sh")]);
  for (const m of modules) {
    const g = readGraph(tmp, m);
    if (g) out.set(m, g);
    else graphErrors.set(m, fs.existsSync(path.join(tmp, `${m}.log`)) ? fs.readFileSync(path.join(tmp, `${m}.log`), "utf8").trim().split("\n").slice(-5).join("\n") : "no output");
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

function namesFor(sdk: Located, modules: string[]): NamesIndex[] {
  const file = (m: string) => path.join(sdk.dir, `${m}.names.json`);
  const missing = modules.filter((m) => !fs.existsSync(file(m)));
  for (const [m, g] of graphs(sdk, missing)) write(file(m), namesOf(m, g));
  return modules.filter((m) => fs.existsSync(file(m))).map((m) => JSON.parse(fs.readFileSync(file(m), "utf8")) as NamesIndex);
}

function extractIosModule(sdk: Located, module: string): SdkLookup {
  const { modules, sdk: sdkPath, ios } = sdk.ios!;
  if (!modules.has(module)) {
    const extra = [
      ios.includePaths?.length ? `${ios.includePaths.length} header path${ios.includePaths.length === 1 ? "" : "s"}` : "",
      ios.moduleMaps?.length ? `${ios.moduleMaps.length} module map${ios.moduleMaps.length === 1 ? "" : "s"}` : "",
      ios.frameworkPaths?.length ? `${ios.frameworkPaths.length} framework path${ios.frameworkPaths.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    const where = `looked in ${sdk.ios!.frameworks}${extra.length ? ` and the app's pods (${extra.join(", ")}); run pod install after adding a pod` : ""}`;
    return { missing: `lucent:ios/${module} was not found in the SDK or the app's dependencies (${where})` };
  }
  const g = graphs(sdk, [module]).get(module);
  if (!g) return { missing: `lucent:ios/${module}: swift-symbolgraph-extract produced no symbol graph:\n${graphErrors.get(module) ?? ""}` };
  extractions++;
  const own = namesOf(module, g);
  write(path.join(sdk.dir, `${module}.names.json`), own);
  // Types of other modules keep their Swift names: those modules' graphs supply them.
  const owners = headerIndex(sdk);
  const deps = [...new Set([...externalUsrs(g)].map((u) => ownerOf(u, owners)).filter((m): m is string => !!m && m !== module && modules.has(m)))];
  const names = [own, ...namesFor(sdk, deps)];
  const headers = modules.get(module) ?? [`${module}/${module}.h`];
  const schema = buildIosSchema(module, g, names, (enums) => enumValues(enums, headers, ios, sdkPath));
  // SDK frameworks are linked; the app's dependencies link themselves.
  // Module maps name their umbrella header; frameworks have <M/M.h>.
  const umbrella = sdk.ios!.umbrellas.get(module);
  return { schema: { ...schema, header: umbrella ? includeOf(umbrella, ios.includePaths ?? []) : `${module}/${frameworkUmbrella(sdk.ios!.frameworks, module)}`, frameworks: modules.get(module) ? [] : [module] } };
}

// --- cache and locks -----------------------------------------------------------------

function write(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `f` holding `<file>.lock`, so concurrent builds and prefetches extract a module once. */
function withLock<T>(file: string, done: () => boolean, f: () => T): T | undefined {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch {
      if (done()) return undefined;
      // Another process is extracting; a lock older than 10 minutes is stale.
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 600_000) fs.rmSync(lock, { force: true });
      } catch {}
      sleep(200);
    }
  }
  try {
    return f();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

function locate(platform: Platform, opts: SdkOptions): Located | { missing: string } {
  const k = `${platform}|${JSON.stringify(opts)}`;
  let l = located.get(k);
  if (!l) {
    l = platform === "android" ? locateAndroid(opts) : locateIos(opts);
    located.set(k, l);
  }
  return l;
}

function prebuilt(platform: Platform, module: string): SdkModuleSchema | undefined {
  try {
    const dir = path.dirname(createRequire(import.meta.url).resolve(`@lucent-lang/sdk-${platform}/package.json`));
    const file = path.join(dir, `${module}.json`);
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as SdkModuleSchema) : undefined;
  } catch {
    return undefined;
  }
}

/** The schema of `lucent:<platform>/<module>`, extracting and caching it on first use. */
export function sdkModule(platform: Platform, module: string, opts: SdkOptions = {}): SdkLookup {
  if (!/^[\w.]+$/.test(module)) return { missing: `lucent:${platform}/${module} is not a module name` };
  const sdk = locate(platform, opts);
  const memo = `${platform}|${"dir" in sdk ? sdk.dir : "none"}|${module}`;
  const hit = loaded.get(memo);
  if (hit) return hit;
  let result: SdkLookup;
  if (!("dir" in sdk)) {
    const p = opts.prebuilt !== false ? prebuilt(platform, module) : undefined;
    result = p ? { schema: p } : sdk;
  } else {
    const file = path.join(sdk.dir, `${module}.json`);
    const read = (): SdkLookup | undefined => (fs.existsSync(file) ? { schema: JSON.parse(fs.readFileSync(file, "utf8")) as SdkModuleSchema } : undefined);
    result =
      read() ??
      withLock(file, () => fs.existsSync(file), () => {
        const r = platform === "android" ? extractAndroidModule(sdk, module) : extractIosModule(sdk, module);
        if ("schema" in r) write(file, r.schema);
        return r;
      }) ??
      read() ??
      { missing: `lucent:${platform}/${module} could not be extracted` };
  }
  loaded.set(memo, result);
  return result;
}

/** Whether a platform's SDK is available (locally or prebuilt). */
export function sdkAvailable(platform: Platform, opts: SdkOptions = {}): boolean {
  return "dir" in locate(platform, opts) || (opts.prebuilt !== false && prebuilt(platform, platform === "ios" ? "Foundation" : "android.os") !== undefined);
}

/** What identifies the SDKs a build uses (for build caches): stable while the SDKs are. */
export function sdkIdentity(opts: SdkOptions = {}): string {
  return (["ios", "android"] as const).map((p) => {
    const l = locate(p, opts);
    return "dir" in l ? l.dir : "none";
  }).join("|");
}

/** Extracts `modules` ahead of use (lucent sdk prefetch). */
export function prefetch(platform: Platform, modules: string[], opts: SdkOptions = {}): SdkLookup[] {
  return modules.map((m) => sdkModule(platform, m, opts));
}

/** Every module a platform's SDK has (no list: the SDK's own contents). */
export function sdkModules(platform: Platform, opts: SdkOptions = {}): string[] | { missing: string } {
  const sdk = locate(platform, opts);
  if (!("dir" in sdk)) return sdk;
  if (platform === "android") return [...jarIndex(sdk.android!.jars, sdk.android!.apiVersions).packages].sort();
  return [...sdk.ios!.modules.keys()].sort();
}

/** The jars Android bindings come from (tests and tools). */
export function androidJars(opts: SdkOptions = {}): string[] | undefined {
  const sdk = locate("android", opts);
  return "dir" in sdk ? sdk.android!.jars : undefined;
}

export type SdkNamesLookup = { names: NamesIndex } | { missing: string };

/**
 * The names of a module's types (kind and native name), without its schema:
 * enough to type another module's signatures that mention them. On iOS it
 * costs a symbol graph, not the schema's clang work or its dependencies.
 */
export function sdkNames(platform: Platform, module: string, opts: SdkOptions = {}): SdkNamesLookup {
  const sdk = locate(platform, opts);
  if (platform === "android" || !("dir" in sdk)) {
    const r = sdkModule(platform, module, opts);
    if ("missing" in r) return r;
    const types: NamesIndex["types"] = {};
    for (const t of r.schema.types) types[t.name] = t.kind === "class" ? { kind: t.interface ? "protocol" : "class", native: t.native } : { kind: t.kind, native: t.native };
    return { names: { module, refs: {}, aliases: {}, types } };
  }
  if (!sdk.ios!.modules.has(module)) return { missing: `lucent:ios/${module} was not found in the SDK or the app's dependencies` };
  const [names] = namesFor(sdk, [module]);
  return names ? { names } : { missing: `lucent:ios/${module}: swift-symbolgraph-extract produced no symbol graph` };
}
