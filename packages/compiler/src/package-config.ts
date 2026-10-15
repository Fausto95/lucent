/**
 * A Lucent package's lucent.json: what its platform code needs from the
 * app that installs it, and those needs merged across the app's packages
 * with the package each came from.
 *
 * Merging is independent of the order packages are found in: every list
 * and record in the result is sorted, and a conflict names the two
 * packages that disagree.
 */
import fs from "node:fs";
import path from "node:path";
import { swiftFilesUnder } from "@lucent-lang/bindgen";
import {
  DIRECTORY,
  eachFile,
  type FileHashes,
  fileHashes,
  FILE_OR_DIRECTORY,
  inNativePackage,
  landsOnce,
  type Located,
  locate,
  type PackagePath,
  type PathKind,
} from "./package-files.ts";
import {
  type ExtensionDeclaration,
  type MainActivityAttributes,
  type ManifestComponent,
  type OptionValue,
  type PackageNative,
  type PlistValue,
  type QueryIntent,
  readPackageNative,
  SWIFT_PACKAGE_REQUIREMENTS,
  type SwiftPackage,
  type SwiftPackageRequirement,
} from "./package-schema.ts";
import { osJavaName } from "./os-names.ts";
import { compareVersions, gradleCompatible, podsCompatible } from "./package-versions.ts";
import type { LucentPackage } from "./packages.ts";

export type { PackagePath } from "./package-files.ts";
export {
  EXTENSION_FIELDS,
  PACKAGE_FIELDS,
  type Affinity,
  type ErrorDeclaration,
  type ExtensionDeclaration,
  type FailsWhen,
  type FunctionDeclaration,
  type HandleDeclaration,
  type ParamDeclaration,
  type IntentData,
  type IntentFilter,
  type MainActivityAttributes,
  type ManifestComponent,
  type OptionValue,
  type PackageNative,
  type PackageOption,
  type PlistValue,
  type QueryIntent,
  type ManifestQueries,
  type PrivacyManifest,
  type CollectedData,
  type SwiftPackage,
  type SwiftPackageRequirement,
} from "./package-schema.ts";

/**
 * Packages' privacy manifests, merged: tracking if any tracks, each
 * domain and reason any gives, and for each data type, linked or
 * tracking if any says so, and every purpose.
 */
export interface ResolvedPrivacy {
  tracking?: From;
  trackingDomains: Record<string, From>;
  /** Category → reason → who gave it. */
  accessedAPIs: Record<string, Record<string, From>>;
  collectedData: Record<
    string,
    { linked: boolean; tracking: boolean; purposes: Record<string, From>; from: From }
  >;
}

/** The packages that asked for something, sorted by name. */
export type From = string[];

/** A value packages agree on, and the packages that asked for it. */
export interface Agreed<T> {
  value: T;
  from: From;
}

/**
 * What all of an app's Lucent packages need, merged, with the packages each
 * need came from. Portable: no machine-specific paths.
 */
export interface ResolvedNative {
  /** Every Lucent package of the app → its version. */
  packages: Record<string, string>;
  ios: {
    /** Pod → each requirement on it (all of them go to CocoaPods) → who asked. */
    pods: Record<string, Record<string, From>>;
    /** Apple framework → who asked. */
    frameworks: Record<string, From>;
    infoPlist: Record<string, Agreed<PlistValue>>;
    nativeSources: PackagePath[];
    resources: PackagePath[];
    /** Bundle name → what it holds (from one package). */
    resourceBundles: Record<string, PackagePath[]>;
    vendoredFrameworks: PackagePath[];
    /** Package URL → its one requirement, the products any package links, who asked. */
    swiftPackages: Record<string, SwiftPackage & { from: From }>;
    entitlements: Record<string, Agreed<PlistValue>>;
    /** The highest any package needs, and the packages that need it. */
    deploymentTarget?: Agreed<string>;
    /** The privacy manifest's declarations, merged (when any package has some). */
    privacy?: ResolvedPrivacy;
  };
  android: {
    /** Gradle `group:artifact` → each version asked for (Gradle picks) → who asked. */
    dependencies: Record<string, Record<string, From>>;
    /** Permission → who asked. */
    permissions: Record<string, From>;
    nativeSources: PackagePath[];
    resources: PackagePath[];
    assets: PackagePath[];
    libraries: PackagePath[];
    nativeLibraries: PackagePath[];
    /** Component class name → the component. */
    components: Record<string, Agreed<ManifestComponent>>;
    /** What packages need on the app's main Activity: each attribute, and who asked. */
    mainActivity: {
      supportsPictureInPicture?: From;
      /** configChanges value → who asked. */
      configChanges: Record<string, From>;
      launchMode?: Agreed<NonNullable<MainActivityAttributes["launchMode"]>>;
    };
    /** The highest any package needs, and the packages that need it. */
    minSdk?: Agreed<number>;
    /** What `<queries>` lists: each package, intent and provider, and who asked (when any does). */
    queries?: {
      packages: Record<string, From>;
      intents: Agreed<QueryIntent>[];
      providers: Record<string, From>;
    };
    /** `<uses-feature>` name → whether the app requires it (if any package does), and who asked. */
    features?: Record<string, Agreed<boolean>>;
    /** The `<application>`'s `<meta-data>`: name → its one value, and who asked. */
    metaData?: Record<string, Agreed<string>>;
  };
  /** Extension name → the package declaring it, its header and its declaration. */
  extensions: Record<string, ResolvedExtension>;
  /** Module created at app launch, by name (`<package>/<path>`) → the package that lists it. */
  launch: Record<string, From>;
}

export interface ResolvedExtension {
  package: string;
  header: PackagePath;
  declaration: ExtensionDeclaration;
}

/** What reading an extension's header needs, on this machine. */
export interface ExtensionInput {
  name: string;
  package: string;
  /** The header, absolute. */
  header: string;
  /** The package's native source directories holding it, absolute: what it may include. */
  includePaths: string[];
  /** How generated code includes it: relative to the deepest of those directories, which both builds search. */
  include: string;
  declaration: ExtensionDeclaration;
  /** Of the header and every file of those directories: what reading it depends on. */
  hash: string;
}

/** The resolved needs, and the files the native package copies from the packages. */
export interface NativeInputs {
  manifest: ResolvedNative;
  /** Path in the native package → the package file it copies. */
  files: ReadonlyMap<string, string>;
  /** Every package file the resolution read, absolute: each lucent.json and listed path (what a watch follows). */
  read: string[];
  /** The prebuilt frameworks (iOS) and jars and AARs (Android) packages ship, absolute: bindings read them. */
  binaries: { ios: string[]; android: string[] };
  /** The Swift files of the packages' ios.nativeSources, absolute: `lucent:ios/LucentNative` binds them. */
  swiftSources: string[];
  /** The packages' native extensions, by name. */
  extensions: ExtensionInput[];
}

/** One package's lucent.json, as merging reads it. */
interface Declared {
  pkg: LucentPackage;
  name: string;
  native: PackageNative;
  /** How its modules are named: `<package>/`, or nothing for the app's own. */
  modules: string;
}

const byKey = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0);

const sorted = <T>(entries: Iterable<[string, T]>): Record<string, T> =>
  Object.fromEntries([...entries].sort(byKey));

/** Each name any package lists, and who listed it. */
function union(declared: Declared[], read: (n: PackageNative) => string[] | undefined) {
  const out = new Map<string, From>();

  for (const d of declared)
    for (const name of new Set(read(d.native) ?? []))
      out.set(name, [...(out.get(name) ?? []), d.name]);

  return sorted(out);
}

/**
 * Each dependency's requirements, and who asked for each. All of them go to
 * the platform's resolver; `compatible` rejects pairs it can prove no
 * version meets, naming both packages.
 */
function requirements(
  declared: Declared[],
  read: (n: PackageNative) => Record<string, string> | undefined,
  what: string,
  compatible: (a: string, b: string) => boolean,
) {
  const out = new Map<string, Map<string, From>>();

  for (const d of declared)
    for (const [dependency, requirement] of Object.entries(read(d.native) ?? {})) {
      const asked = out.get(dependency) ?? new Map<string, From>();
      asked.set(requirement, [...(asked.get(requirement) ?? []), d.name]);
      out.set(dependency, asked);
    }

  for (const [dependency, asked] of out) {
    const conflict = firstConflict([...asked], compatible);

    if (conflict) {
      const [[a, fromA], [b, fromB]] = conflict;
      throw new Error(`${what} ${dependency}: ${fromA[0]} wants ${a}, ${fromB[0]} wants ${b}`);
    }
  }

  return sorted([...out].map(([dependency, asked]) => [dependency, sorted(asked)]));
}

/** Plist entries: one value per key, except arrays, which join. */
function plist(
  declared: Declared[],
  read: (n: PackageNative) => Record<string, PlistValue> | undefined,
  what: string,
) {
  const out = new Map<string, [PlistValue, From][]>();

  for (const d of declared)
    for (const [key, value] of Object.entries(read(d.native) ?? {}))
      out.set(key, [...(out.get(key) ?? []), [value, [d.name]]]);

  const agree = (a: PlistValue, b: PlistValue) =>
    Array.isArray(a) ? Array.isArray(b) : !Array.isArray(b) && a === b;

  return sorted(
    [...out].map(([key, values]): [string, Agreed<PlistValue>] => {
      const conflict = firstConflict(values, agree);

      if (conflict) {
        const [[a, fromA], [b, fromB]] = conflict;
        throw new Error(
          `${what} ${key}: ${fromA[0]} wants ${JSON.stringify(a)}, ${fromB[0]} wants ${JSON.stringify(b)}`,
        );
      }

      const first = values[0]![0];
      const value = Array.isArray(first)
        ? [...new Set(values.flatMap(([v]) => v as string[]))].sort()
        : first;

      return [key, { value, from: values.flatMap(([, from]) => from) }];
    }),
  );
}

/** The first two entries that cannot both hold, in the order of the packages that declared them. */
function firstConflict<T>(
  entries: [T, From][],
  compatible: (a: T, b: T) => boolean,
): [[T, From], [T, From]] | undefined {
  const ordered = [...entries].sort(([, a], [, b]) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));

  for (let i = 0; i < ordered.length; i++)
    for (let j = i + 1; j < ordered.length; j++)
      if (!compatible(ordered[i]![0], ordered[j]![0])) return [ordered[i]!, ordered[j]!];

  return undefined;
}

/**
 * The native needs of `packages`, read from their lucent.json and merged.
 * Throws for an invalid lucent.json, naming the package, and for needs two
 * packages disagree on, naming both.
 */
export function resolveNative(
  packages: LucentPackage[],
  options: { hashes?: FileHashes } = {},
): NativeInputs {
  const hashes = options.hashes ?? fileHashes();

  const found = new Map<string, LucentPackage>();

  for (const p of packages) {
    const other = found.get(p.name);

    if (other && other.dir !== p.dir)
      throw new Error(
        `${p.name} is installed twice (${[other.version, p.version].sort().join(" and ")}): the app can build one copy of a Lucent package`,
      );

    found.set(p.name, p);
  }

  const declare = (p: LucentPackage): Declared => ({
    pkg: p,
    name: p.name,
    native: readPackageNative(p) ?? {},
    modules: p.app ? "" : `${p.name}/`,
  });
  const app = [...found.values()].find((p) => p.app);
  const own = app && declare(app);
  // The options packages declare, given the values the app sets.
  for (const p of found.values()) {
    const n = (p === app ? own!.native : readPackageNative(p)) ?? {};
    if (p.app && n.options)
      throw new Error(
        `${p.name}/lucent.json: options: a package declares options, which the app sets`,
      );
    if (!p.app && n.packages)
      throw new Error(
        `${p.name}/lucent.json: packages: the app's lucent.json sets packages' options`,
      );
  }
  const set = own?.native.packages ?? {};
  for (const name of Object.keys(set))
    if (![...found.values()].some((p) => !p.app && p.name === name))
      throw new Error(
        `${own!.name}/lucent.json: packages.${name} sets options of ${name}, which the app doesn't depend on`,
      );
  // What the app declares wins over a package's: its value of a key, or its declaration of a
  // component, replaces theirs.
  const declared: Declared[] = [...found.values()]
    .filter((p) => !p.app)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((p) => {
      const d = withOptions(declare(p), set[p.name] ?? {}, own?.name);
      return own ? { ...d, native: withoutOverridden(d.native, own.native) } : d;
    });
  if (own) declared.push(own);

  const listed = (
    field: string,
    read: (n: PackageNative) => string[] | undefined,
    kind: PathKind,
  ) => located(declared, field, read, kind, hashes);

  const ios = {
    nativeSources: listed("ios.nativeSources", (n) => n.ios?.nativeSources, DIRECTORY),
    resources: listed("ios.resources", (n) => n.ios?.resources, FILE_OR_DIRECTORY),
    vendoredFrameworks: listed("ios.vendoredFrameworks", (n) => n.ios?.vendoredFrameworks, {
      directory: true,
      suffixes: [".framework", ".xcframework"],
      describe: "a .framework or .xcframework directory",
    }),
  };

  const resourceBundles = bundles(declared, hashes);

  const android = {
    nativeSources: listed("android.nativeSources", (n) => n.android?.nativeSources, DIRECTORY),
    resources: listed("android.resources", (n) => n.android?.resources, DIRECTORY),
    assets: listed("android.assets", (n) => n.android?.assets, DIRECTORY),
    libraries: listed("android.libraries", (n) => n.android?.libraries, {
      directory: false,
      suffixes: [".aar", ".jar"],
      describe: "an .aar or .jar file",
    }),
    nativeLibraries: listed(
      "android.nativeLibraries",
      (n) => n.android?.nativeLibraries,
      DIRECTORY,
    ),
  };

  // Where each kind of file lands in the app: two files may not land in one place.
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);

  landsOnce(
    "iOS resource",
    ios.resources,
    (l) => [[name(l.path), l.path]],
    " (both land at the app bundle's root: namespace one with ios.resourceBundles)",
  );
  landsOnce("iOS framework", ios.vendoredFrameworks, (l) => [
    [name(l.path).replace(/\.(xc)?framework$/, ""), l.path],
  ]);
  landsOnce("Android resource", android.resources, (l) =>
    // Value resources merge by name: Android's resource merger reports duplicates.
    eachFile(l, (rel) => !rel.startsWith("values")),
  );
  landsOnce("Android asset", android.assets, (l) => eachFile(l));
  landsOnce("Android library", android.libraries, (l) => [[name(l.path), l.path]]);
  landsOnce("Android native library", android.nativeLibraries, (l) => eachFile(l));
  landsOnce("Android source", android.nativeSources, (l) =>
    eachFile(l, (rel) => /\.(java|kt)$/.test(rel)),
  );

  const all = [
    ...Object.values(ios),
    ...Object.values(resourceBundles),
    ...Object.values(android),
  ].flat();

  const files = new Map<string, string>();
  for (const l of all) for (const f of l.files) files.set(inNativePackage(l, f.rel), f.abs);

  const extensions = resolveExtensions(declared, hashes, ios.nativeSources);

  const manifest: ResolvedNative = {
    packages: sorted([...found.values()].map((p) => [p.name, p.version])),
    ios: {
      pods: requirements(declared, (n) => n.ios?.pods, "pod", podsCompatible),
      frameworks: union(declared, (n) => n.ios?.frameworks),
      infoPlist: plist(declared, (n) => n.ios?.infoPlist, "Info.plist"),
      nativeSources: portable(ios.nativeSources),
      resources: portable(ios.resources),
      resourceBundles: sorted(
        Object.entries(resourceBundles).map(([bundle, paths]) => [bundle, portable(paths)]),
      ),
      vendoredFrameworks: portable(ios.vendoredFrameworks),
      swiftPackages: swiftPackages(declared),
      entitlements: plist(declared, (n) => n.ios?.entitlements, "entitlement"),
      ...highest(declared, "deploymentTarget", (n) => n.ios?.deploymentTarget, compareVersions),
      ...privacy(declared),
    },
    android: {
      dependencies: requirements(
        declared,
        (n) => n.android?.dependencies,
        "Gradle",
        gradleCompatible,
      ),
      permissions: union(declared, (n) => n.android?.permissions),
      nativeSources: portable(android.nativeSources),
      resources: portable(android.resources),
      assets: portable(android.assets),
      libraries: portable(android.libraries),
      nativeLibraries: portable(android.nativeLibraries),
      components: components(declared),
      mainActivity: mainActivity(declared),
      ...nonEmpty("queries", queries(declared)),
      ...nonEmpty(
        "features",
        sorted(
          [...new Set(declared.flatMap((d) => Object.keys(d.native.android?.features ?? {})))].map(
            (name): [string, Agreed<boolean>] => {
              const asked = declared.filter(
                (d) => d.native.android?.features?.[name] !== undefined,
              );
              return [
                name,
                {
                  value: asked.some((d) => d.native.android!.features![name]),
                  from: asked.map((d) => d.name),
                },
              ];
            },
          ),
        ),
      ),
      ...nonEmpty(
        "metaData",
        plist(declared, (n) => n.android?.metaData, "Android meta-data") as Record<
          string,
          Agreed<string>
        >,
      ),
      ...highest(
        declared,
        "minSdk",
        (n) => n.android?.minSdk,
        (a, b) => a - b,
      ),
    },
    launch: sorted(
      declared.flatMap((d) =>
        [...new Set(d.native.launch ?? [])].map((m): [string, From] => [
          `${d.modules}${m}`,
          [d.name],
        ]),
      ),
    ),
    extensions: sorted(
      extensions.map(({ name, pkg, header, declaration }) => [
        name,
        { package: pkg, header: portable([header])[0]!, declaration },
      ]),
    ),
  };

  const dirOf = new Map([...found.values()].map((p) => [p.name, p.dir]));
  const read = [
    ...[...found.values()]
      .map((p) => path.join(p.dir, "lucent.json"))
      .filter((f) => fs.existsSync(f)),
    ...all.map((l) => path.join(dirOf.get(l.package)!, l.path)),
    ...extensions.map((e) => e.header.files[0]!.abs),
  ];

  const at = (paths: Located[]) => paths.map((l) => path.join(dirOf.get(l.package)!, l.path));

  return {
    manifest,
    files: new Map([...files].sort(byKey)),
    read: [...new Set(read)].sort(),
    binaries: { ios: at(ios.vendoredFrameworks), android: at(android.libraries) },
    swiftSources: swiftFilesUnder(at(ios.nativeSources)),
    extensions: extensions.map(
      ({ name, pkg, header, include, includePaths, declaration, hash }) => ({
        name,
        package: pkg,
        header: header.files[0]!.abs,
        includePaths,
        include,
        declaration,
        hash,
      }),
    ),
  };
}

/**
 * Each package's extensions, their headers located: in a native source
 * directory both platforms list, so both build the extension and copy the
 * header. An extension's name belongs to one package.
 */
function resolveExtensions(declared: Declared[], hashes: FileHashes, sources: Located[]) {
  const out = new Map<
    string,
    {
      name: string;
      pkg: string;
      header: Located;
      include: string;
      includePaths: string[];
      declaration: ExtensionDeclaration;
      hash: string;
    }
  >();

  for (const d of declared)
    for (const [name, declaration] of Object.entries(d.native.extensions ?? {})) {
      const field = `extensions.${name}.header`;
      const header = locate(
        d.pkg,
        field,
        declaration.header,
        {
          directory: false,
          suffixes: [".h"],
          describe: "a .h file",
        },
        hashes,
      );

      const listed = (dirs: string[] | undefined) =>
        (dirs ?? []).map((dir) => path.posix.normalize(dir.replace(/\\/g, "/")).replace(/\/$/, ""));
      const ios = listed(d.native.ios?.nativeSources);
      const both = listed(d.native.android?.nativeSources).filter(
        (dir) => ios.includes(dir) && header.path.startsWith(`${dir}/`),
      );

      if (!both.length)
        throw new Error(
          `${d.name}/lucent.json: ${field} ${JSON.stringify(declaration.header)} must be in a directory both ios.nativeSources and android.nativeSources list, so both platforms build the extension`,
        );

      const other = out.get(name);
      if (other) throw new Error(`extension ${name}: ${other.pkg} and ${d.name} both declare it`);

      // Each directory is a header search path of both builds: generated code includes the header from the deepest.
      const deepest = both.reduce((a, b) => (b.length > a.length ? b : a));

      out.set(name, {
        name,
        pkg: d.name,
        header,
        include: header.path.slice(deepest.length + 1),
        includePaths: both.map((dir) => path.join(d.pkg.dir, dir)),
        declaration,
        hash: [
          header.hash,
          ...sources
            .filter((l) => l.package === d.name && both.includes(l.path))
            .map((l) => l.hash),
        ].join(":"),
      });
    }

  return [...out.values()];
}

/** The highest of a lower bound packages need (none asked: no field), and the packages that need it. */
function highest<K extends string, T>(
  declared: Declared[],
  key: K,
  read: (n: PackageNative) => T | undefined,
  compare: (a: T, b: T) => number,
): { [k in K]?: Agreed<T> } {
  const asked = declared.flatMap((d) => {
    const value = read(d.native);
    return value === undefined ? [] : [{ value, from: d.name }];
  });

  if (!asked.length) return {};

  const top = asked.reduce((a, b) => (compare(b.value, a.value) > 0 ? b : a));
  const from = asked.filter((a) => compare(a.value, top.value) === 0).map((a) => a.from);

  return { [key]: { value: top.value, from } } as { [k in K]?: Agreed<T> };
}

/** A JSON text of `v` whatever the order of its objects' keys: equal values, equal texts. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;

  if (typeof v === "object" && v !== null)
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;

  return JSON.stringify(v);
}

/** `upToNextMajorVersion 1.2.0`. */
const describeRequirement = (r: SwiftPackageRequirement) =>
  [r.kind, ...SWIFT_PACKAGE_REQUIREMENTS[r.kind].map((f) => (r as Record<string, string>)[f])].join(
    " ",
  );

/** Swift packages: one requirement per URL (Xcode records one), the products any package links. */
function swiftPackages(declared: Declared[]): ResolvedNative["ios"]["swiftPackages"] {
  const out = new Map<string, [SwiftPackage, From][]>();

  for (const d of declared)
    for (const [url, pkg] of Object.entries(d.native.ios?.swiftPackages ?? {}))
      out.set(url, [...(out.get(url) ?? []), [pkg, [d.name]]]);

  return sorted(
    [...out].map(([url, asked]): [string, SwiftPackage & { from: From }] => {
      const conflict = firstConflict(
        asked,
        (a, b) => canonical(a.requirement) === canonical(b.requirement),
      );

      if (conflict) {
        const [[a, fromA], [b, fromB]] = conflict;
        throw new Error(
          `Swift package ${url}: ${fromA[0]} wants ${describeRequirement(a.requirement)}, ${fromB[0]} wants ${describeRequirement(b.requirement)}`,
        );
      }

      const requirement = asked[0]![0].requirement;

      return [
        url,
        {
          // Xcode's field order, whatever the lucent.json's.
          requirement: Object.fromEntries([
            ["kind", requirement.kind],
            ...SWIFT_PACKAGE_REQUIREMENTS[requirement.kind].map((f) => [
              f,
              (requirement as Record<string, string>)[f],
            ]),
          ]) as SwiftPackageRequirement,
          products: [...new Set(asked.flatMap(([p]) => p.products))].sort(),
          from: asked.flatMap(([, from]) => from),
        },
      ];
    }),
  );
}

/** `{{name}}`: an option's value. */
const OPTION_REFERENCE = /\{\{([^{}]*)\}\}/g;

/**
 * A package's needs with its options' values in them: the app's, or the
 * option's default. `{{name}}` in an Info.plist value, an entitlement or a
 * manifest component's field is the value; a whole `{{name}}` of a boolean
 * is the boolean. An option the app doesn't set and that has no default
 * fails, saying how to set it, and so does one the app sets that the
 * package doesn't declare.
 */
function withOptions(d: Declared, given: Record<string, OptionValue>, app?: string): Declared {
  const declared = d.native.options ?? {};
  const unknown = Object.keys(given).find((name) => !(name in declared));
  if (unknown)
    throw new Error(
      `${app}/lucent.json: packages.${d.name}.${unknown}: ${d.name} has no option ${unknown}${
        Object.keys(declared).length ? ` (its options: ${Object.keys(declared).join(", ")})` : ""
      }`,
    );

  const value = (name: string, at: string): OptionValue => {
    const option = declared[name];
    if (!option)
      throw new Error(
        `${d.name}/lucent.json: ${at} uses {{${name}}}, which options doesn't declare`,
      );
    const v = given[name] ?? option.default;
    if (v === undefined)
      throw new Error(
        `${d.name} needs the option ${name} (${option.description}): set it in the app's lucent.json, as "packages": { "${d.name}": { "${name}": … } }`,
      );
    return v;
  };

  const fill = (v: unknown, at: string): unknown => {
    if (typeof v === "string") {
      const whole = /^\{\{([^{}]*)\}\}$/.exec(v);
      if (whole) return value(whole[1]!, at);
      return v.replace(OPTION_REFERENCE, (_, name: string) => String(value(name, at)));
    }
    if (Array.isArray(v)) return v.map((x, i) => fill(x, `${at}.${i}`));
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, `${at}.${k}`)]));
    return v;
  };

  const n = d.native;
  const native: PackageNative = {
    ...n,
    ...(n.ios && {
      ios: {
        ...n.ios,
        ...(n.ios.infoPlist && {
          infoPlist: fill(n.ios.infoPlist, "ios.infoPlist") as Record<string, PlistValue>,
        }),
        ...(n.ios.entitlements && {
          entitlements: fill(n.ios.entitlements, "ios.entitlements") as Record<string, PlistValue>,
        }),
      },
    }),
    ...(n.android && {
      android: {
        ...n.android,
        ...(n.android.components && {
          components: fill(n.android.components, "android.components") as ManifestComponent[],
        }),
        ...(n.android.metaData && {
          metaData: fill(n.android.metaData, "android.metaData") as Record<string, string>,
        }),
      },
    }),
  };

  return { ...d, native };
}

/**
 * A package's needs without what the app's own lucent.json gives a value of
 * its own: Info.plist keys and entitlements (an array's values still join),
 * pods, Gradle artifacts and Swift packages, manifest components, and the
 * main Activity's launch mode.
 */
function withoutOverridden(pkg: PackageNative, app: PackageNative): PackageNative {
  const without = <T>(
    of: Record<string, T> | undefined,
    by: Record<string, unknown> | undefined,
  ) => (of && by ? Object.fromEntries(Object.entries(of).filter(([k]) => !(k in by))) : of);
  // A plist array joins the app's; another value is the app's alone.
  const plistWithout = (
    of: Record<string, PlistValue> | undefined,
    by: Record<string, PlistValue> | undefined,
  ) =>
    of && by
      ? Object.fromEntries(
          Object.entries(of).filter(
            ([k, v]) => by[k] === undefined || (Array.isArray(v) && Array.isArray(by[k])),
          ),
        )
      : of;
  const ios = pkg.ios && {
    ...pkg.ios,
    infoPlist: plistWithout(pkg.ios.infoPlist, app.ios?.infoPlist),
    entitlements: plistWithout(pkg.ios.entitlements, app.ios?.entitlements),
    pods: without(pkg.ios.pods, app.ios?.pods),
    swiftPackages: without(pkg.ios.swiftPackages, app.ios?.swiftPackages),
  };
  const appComponents = new Set((app.android?.components ?? []).map((c) => c.name));
  const android = pkg.android && {
    ...pkg.android,
    dependencies: without(pkg.android.dependencies, app.android?.dependencies),
    features: without(pkg.android.features, app.android?.features),
    metaData: without(pkg.android.metaData, app.android?.metaData),
    components: pkg.android.components?.filter((c) => !appComponents.has(c.name)),
    mainActivity: pkg.android.mainActivity && {
      ...pkg.android.mainActivity,
      ...(app.android?.mainActivity?.launchMode ? { launchMode: undefined } : {}),
    },
  };
  return { ...pkg, ...(ios ? { ios } : {}), ...(android ? { android } : {}) };
}

/** Manifest components: each class declared once, the same way by every package that declares it. */
function components(declared: Declared[]): ResolvedNative["android"]["components"] {
  const out = new Map<string, [ManifestComponent, From][]>();

  for (const d of declared)
    for (const declaredAs of d.native.android?.components ?? []) {
      // A Lucent class the OS makes: its Java class (decision 0097).
      const [module, cls] = declaredAs.class?.split("#") ?? [];
      const c =
        module !== undefined && cls !== undefined
          ? { ...declaredAs, name: osJavaName(`${d.modules}${module}`, cls).replace(/\//g, ".") }
          : declaredAs;
      out.set(c.name, [...(out.get(c.name) ?? []), [c, [d.name]]]);
    }

  return sorted(
    [...out].map(([name, declaredAs]): [string, Agreed<ManifestComponent>] => {
      const conflict = firstConflict(declaredAs, (a, b) => canonical(a) === canonical(b));

      if (conflict) {
        const [[, fromA], [, fromB]] = conflict;
        throw new Error(
          `Android component ${name}: ${fromA[0]} and ${fromB[0]} declare it differently`,
        );
      }

      return [name, { value: declaredAs[0]![0], from: declaredAs.flatMap(([, from]) => from) }];
    }),
  );
}

/** The packages' privacy manifests, merged; nothing when none has one. */
function privacy(declared: Declared[]): { privacy?: ResolvedPrivacy } {
  const with_ = declared.filter((d) => d.native.ios?.privacy);
  if (!with_.length) return {};
  const tracking = with_.filter((d) => d.native.ios!.privacy!.tracking).map((d) => d.name);
  const accessedAPIs = new Map<string, Map<string, From>>();
  const collected = new Map<
    string,
    { linked: boolean; tracking: boolean; purposes: Map<string, From>; from: From }
  >();
  for (const d of with_) {
    const p = d.native.ios!.privacy!;
    for (const [category, reasons] of Object.entries(p.accessedAPIs ?? {})) {
      const known = accessedAPIs.get(category) ?? new Map<string, From>();
      for (const r of new Set(reasons)) known.set(r, [...(known.get(r) ?? []), d.name]);
      accessedAPIs.set(category, known);
    }
    for (const [type, use] of Object.entries(p.collectedData ?? {})) {
      const known = collected.get(type) ?? {
        linked: false,
        tracking: false,
        purposes: new Map<string, From>(),
        from: [],
      };
      for (const purpose of new Set(use.purposes))
        known.purposes.set(purpose, [...(known.purposes.get(purpose) ?? []), d.name]);
      collected.set(type, {
        linked: known.linked || use.linked,
        tracking: known.tracking || use.tracking,
        purposes: known.purposes,
        from: [...known.from, d.name],
      });
    }
  }
  return {
    privacy: {
      ...(tracking.length ? { tracking } : {}),
      trackingDomains: union(with_, (n) => n.ios?.privacy?.trackingDomains),
      accessedAPIs: sorted([...accessedAPIs].map(([c, reasons]) => [c, sorted(reasons)])),
      collectedData: sorted(
        [...collected].map(([type, u]) => [type, { ...u, purposes: sorted(u.purposes) }]),
      ),
    },
  };
}

/** `{ [key]: value }` when `value` holds something, so a manifest without it stays as it was. */
function nonEmpty<K extends string, V extends object>(key: K, value: V): { [P in K]?: V } {
  const empty = Object.values(value).every((v) =>
    Array.isArray(v) ? !v.length : typeof v === "object" ? !Object.keys(v ?? {}).length : false,
  );
  return (Object.keys(value).length && !empty ? { [key]: value } : {}) as { [P in K]?: V };
}

/** `<queries>`: the packages and providers any package looks for, and each intent once. */
function queries(declared: Declared[]): NonNullable<ResolvedNative["android"]["queries"]> {
  const intents = new Map<string, Agreed<QueryIntent>>();
  for (const d of declared)
    for (const intent of d.native.android?.queries?.intents ?? []) {
      const key = canonical(intent);
      const known = intents.get(key);
      intents.set(key, { value: intent, from: [...(known?.from ?? []), d.name] });
    }
  return {
    packages: union(declared, (n) => n.android?.queries?.packages),
    intents: [...intents].sort(byKey).map(([, i]) => i),
    providers: union(declared, (n) => n.android?.queries?.providers),
  };
}

/**
 * The main Activity's attributes packages need: picture in picture if any
 * asks for it, every configChanges value any asks for, and one launch
 * mode, which packages that ask for different ones fail on.
 */
function mainActivity(declared: Declared[]): ResolvedNative["android"]["mainActivity"] {
  const pip = declared.filter((d) => d.native.android?.mainActivity?.supportsPictureInPicture);
  const modes = declared.flatMap((d): [string, From][] => {
    const mode = d.native.android?.mainActivity?.launchMode;
    return mode ? [[mode, [d.name]]] : [];
  });

  const conflict = firstConflict(modes, (a, b) => a === b);
  if (conflict) {
    const [[a, fromA], [b, fromB]] = conflict;
    throw new Error(
      `the main Activity's launchMode: ${fromA[0]} wants ${a}, ${fromB[0]} wants ${b}`,
    );
  }

  const launchMode = modes[0]?.[0] as MainActivityAttributes["launchMode"];
  return {
    ...(pip.length ? { supportsPictureInPicture: pip.map((d) => d.name) } : {}),
    configChanges: union(declared, (n) => n.android?.mainActivity?.configChanges),
    ...(launchMode ? { launchMode: { value: launchMode, from: modes.flatMap(([, f]) => f) } } : {}),
  };
}

/** Every path each package lists in `field`, located in its package, in package then path order. */
function located(
  declared: Declared[],
  field: string,
  read: (n: PackageNative) => string[] | undefined,
  kind: PathKind,
  hashes: FileHashes,
): Located[] {
  return declared.flatMap((d) =>
    [...new Set(read(d.native) ?? [])]
      .map((listed) => locate(d.pkg, field, listed, kind, hashes))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  );
}

/** Resource bundles: one package each, holding files that land in it once. */
function bundles(declared: Declared[], hashes: FileHashes): Record<string, Located[]> {
  const out = new Map<string, Located[]>();

  for (const d of declared)
    for (const [bundle, paths] of Object.entries(d.native.ios?.resourceBundles ?? {})) {
      const inBundle = located(
        [d],
        `ios.resourceBundles.${bundle}`,
        () => paths,
        FILE_OR_DIRECTORY,
        hashes,
      );
      const other = out.get(bundle);

      if (other)
        throw new Error(
          `iOS resource bundle ${bundle}: ${other[0]!.package} has ${other[0]!.path}, ${d.name} has ${inBundle[0]?.path ?? "none"}`,
        );

      landsOnce("iOS resource", inBundle, (l) => [
        [`${bundle}.bundle/${l.path.slice(l.path.lastIndexOf("/") + 1)}`, l.path],
      ]);
      out.set(bundle, inBundle);
    }

  return sorted(out);
}

/** The listed paths as the manifest records them: without their files' locations. */
const portable = (paths: Located[]): PackagePath[] =>
  paths.map(({ package: p, path: at, hash }) => ({ package: p, path: at, hash }));
