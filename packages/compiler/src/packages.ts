/**
 * Lucent packages: npm packages that ship Lucent modules as sources. A
 * package declares them in package.json:
 *
 *   "lucent": { "sources": "src", "compatible": ">=0.0.3" }
 *
 * The app's build compiles every Lucent package it depends on (transitively,
 * found as Node resolves them) into its one native package, and names a
 * package's module `<package>/<module>`, so packages never clash.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface LucentPackage {
  name: string;
  version: string;
  /** The package's directory. */
  dir: string;
  /** Where its Lucent modules are. */
  sources: string;
  /** Lucent versions it supports (an npm range). */
  compatible?: string;
  /** Its lucent.json: what its platform code needs from the app. */
  native?: PackageNative;
}

/** A package's lucent.json. */
export interface PackageNative {
  ios?: { pods?: Record<string, string>; infoPlist?: Record<string, string> };
  android?: { dependencies?: Record<string, string>; permissions?: string[] };
}

/** What all of an app's Lucent packages need, merged. */
export interface NativeDependencies {
  /** Pod name → version requirement. */
  pods: Record<string, string>;
  /** Gradle `group:artifact` → version. */
  gradle: Record<string, string>;
  permissions: string[];
  /** Info.plist key → value, and the package that wants it. */
  infoPlist: Record<string, { value: string; from: string }>;
}

/**
 * The native needs of `packages`, merged: one version of each pod and
 * artifact, one value for each Info.plist key. Two packages that disagree
 * are an error naming both.
 */
export function nativeDependencies(packages: LucentPackage[]): NativeDependencies {
  const out: NativeDependencies = { pods: {}, gradle: {}, permissions: [], infoPlist: {} };
  const owners = new Map<string, string>();
  const merge = (kind: string, into: Record<string, string>, key: string, value: string, from: string) => {
    const id = `${kind} ${key}`;
    if (into[key] !== undefined && into[key] !== value) throw new Error(`${kind}${key}: ${owners.get(id)} wants ${into[key]}, ${from} wants ${value}`);
    into[key] = value;
    if (!owners.has(id)) owners.set(id, from);
  };
  for (const p of packages) {
    for (const [pod, version] of Object.entries(p.native?.ios?.pods ?? {})) merge("pod ", out.pods, pod, version, p.name);
    for (const [artifact, version] of Object.entries(p.native?.android?.dependencies ?? {})) merge("", out.gradle, artifact, version, p.name);
    for (const perm of p.native?.android?.permissions ?? []) if (!out.permissions.includes(perm)) out.permissions.push(perm);
    for (const [key, value] of Object.entries(p.native?.ios?.infoPlist ?? {})) {
      const values = Object.fromEntries(Object.entries(out.infoPlist).map(([k, v]) => [k, v.value]));
      merge("Info.plist ", values, key, value, p.name);
      out.infoPlist[key] ??= { value, from: p.name };
    }
  }
  out.permissions.sort();
  return out;
}

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  lucent?: { sources?: string; compatible?: string };
}

const read = (file: string): PackageJson | undefined => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
};

/** The Lucent package a file belongs to: the nearest package.json, if it has a `lucent` field. */
export function lucentPackageOf(file: string): LucentPackage | undefined {
  for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) {
    const pkg = read(path.join(dir, "package.json"));
    if (pkg) {
      if (!pkg.lucent || !pkg.name) return undefined;
      const native = fs.existsSync(path.join(dir, "lucent.json")) ? (JSON.parse(fs.readFileSync(path.join(dir, "lucent.json"), "utf8")) as PackageNative) : undefined;
      return { name: pkg.name, version: pkg.version ?? "0.0.0", dir, sources: path.join(dir, pkg.lucent.sources ?? "."), compatible: pkg.lucent.compatible, ...(native ? { native } : {}) };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * The Lucent packages `root` (the app) depends on, transitively, each once,
 * sorted by name. Throws for one whose `compatible` range excludes this
 * Lucent, naming it.
 */
export function lucentPackages(root: string): LucentPackage[] {
  const found = new Map<string, LucentPackage>();
  const visit = (from: string, deps: Record<string, string>) => {
    for (const name of Object.keys(deps)) {
      const dir = resolvePackage(from, name);
      if (!dir || found.has(dir)) continue;
      const pkg = lucentPackageOf(path.join(dir, "package.json"));
      if (!pkg || pkg.dir !== dir) continue;
      if (pkg.compatible && !satisfies(lucentVersion(), pkg.compatible)) {
        throw new Error(`${pkg.name}@${pkg.version} supports Lucent ${pkg.compatible}, not ${lucentVersion()}: update one of them`);
      }
      found.set(dir, pkg);
      visit(dir, read(path.join(dir, "package.json"))?.dependencies ?? {});
    }
  };
  visit(root, read(path.join(root, "package.json"))?.dependencies ?? {});
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A dependency's directory as Node finds it from `from`: node_modules up the tree (links followed). */
function resolvePackage(from: string, name: string): string | undefined {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
    if (path.dirname(dir) === dir) return undefined;
  }
}

let version: string | undefined;
/** This Lucent's version (the compiler's). */
export function lucentVersion(): string {
  version ??= (read(path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json"))?.version ?? "0.0.0");
  return version;
}

/**
 * Whether `version` is in npm range `range`: `^`, `~`, `>=`, `>`, `<=`, `<`,
 * `=`, x-ranges, space for all of, `||` for any of. Prerelease tags are
 * ignored: 0.1.0-cpp is 0.1.0.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  return range.split("||").some((alt) => alt.trim().split(/\s+/).filter(Boolean).every((c) => comparator(v, c)));
}

type Triple = [number, number, number];

function parse(v: string): Triple {
  const [a = 0, b = 0, c = 0] = v.replace(/^v/, "").split("-")[0]!.split(".").map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
  return [a, b, c];
}

function cmp(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

function comparator(v: Triple, c: string): boolean {
  const m = /^(\^|~|>=|<=|>|<|=)?v?([\dxX*]+)(?:\.([\dxX*]+))?(?:\.([\dxX*]+))?/.exec(c);
  if (!m) return false;
  const op = m[1] ?? "";
  const parts = [m[2], m[3], m[4]];
  const wild = parts.findIndex((p) => p === undefined || /[xX*]/.test(p));
  const nums = parts.map((p) => (p === undefined || /[xX*]/.test(p) ? 0 : Number(p))) as Triple;
  if (op === "" || op === "=") {
    if (wild === -1) return cmp(v, nums) === 0;
    return nums.slice(0, wild).every((n, i) => v[i] === n);
  }
  if (op === "^") {
    // The leftmost non-zero part stays.
    const upper: Triple = nums[0] > 0 || wild === 1 ? [nums[0] + 1, 0, 0] : nums[1] > 0 || wild === 2 ? [0, nums[1] + 1, 0] : [0, 0, nums[2] + 1];
    return cmp(v, nums) >= 0 && cmp(v, upper) < 0;
  }
  if (op === "~") {
    const upper: Triple = wild === 1 ? [nums[0] + 1, 0, 0] : [nums[0], nums[1] + 1, 0];
    return cmp(v, nums) >= 0 && cmp(v, upper) < 0;
  }
  const d = cmp(v, nums);
  return op === ">=" ? d >= 0 : op === ">" ? d > 0 : op === "<=" ? d <= 0 : d < 0;
}
