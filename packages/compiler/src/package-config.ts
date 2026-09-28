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
  type ManifestComponent,
  type PackageNative,
  type PlistValue,
  readPackageNative,
  SWIFT_PACKAGE_REQUIREMENTS,
  type SwiftPackage,
  type SwiftPackageRequirement,
} from "./package-schema.ts";
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
  type ManifestComponent,
  type PackageNative,
  type PlistValue,
  type SwiftPackage,
  type SwiftPackageRequirement,
} from "./package-schema.ts";

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
    /** The highest any package needs, and the packages that need it. */
    minSdk?: Agreed<number>;
  };
  /** Extension name → the package declaring it, its header and its declaration. */
  extensions: Record<string, ResolvedExtension>;
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
  /** The packages' native extensions, by name. */
  extensions: ExtensionInput[];
}

/** One package's lucent.json, as merging reads it. */
interface Declared {
  pkg: LucentPackage;
  name: string;
  native: PackageNative;
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

  const declared: Declared[] = [...found.values()]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((p) => ({ pkg: p, name: p.name, native: readPackageNative(p) ?? {} }));

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
      ...highest(
        declared,
        "minSdk",
        (n) => n.android?.minSdk,
        (a, b) => a - b,
      ),
    },
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

/** Manifest components: each class declared once, the same way by every package that declares it. */
function components(declared: Declared[]): ResolvedNative["android"]["components"] {
  const out = new Map<string, [ManifestComponent, From][]>();

  for (const d of declared)
    for (const c of d.native.android?.components ?? [])
      out.set(c.name, [...(out.get(c.name) ?? []), [c, [d.name]]]);

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
