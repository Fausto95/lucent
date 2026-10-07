/**
 * The Swift packages an app's project references, built for Lucent to
 * read (TA32): each is checked out at the revision Package.resolved pins
 * into the cache, and its library products (its manifest's) are built for
 * the simulator at the app's deployment target, with the app's pins for
 * their dependencies. LucentNative links them where the code imports
 * their modules: the app target itself does not. Their Swift modules are then read as any other, and keyed
 * by the package's resolved version: a build runs once per revision,
 * target and Xcode.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cacheRoot, hash, publish, readCached, withLock } from "./cache.ts";
import { type SwiftPackagePin, type XcodeApp, pinsOf } from "./xcode.ts";

/**
 * A Swift module a package's build gave: the directory with its
 * `.swiftmodule`, or with its framework (a dynamic library product), and
 * the package's `identity@version`.
 */
export interface SwiftPackageModule {
  module: string;
  dir: string;
  framework?: true;
  package: string;
}

/** A package as LucentNative links it: its pin, and its library products. */
export interface BuiltSwiftPackage extends SwiftPackagePin {
  products: string[];
}

export interface SwiftPackages {
  modules: SwiftPackageModule[];
  packages: BuiltSwiftPackage[];
  /** Package.resolved, which says which versions these are. */
  resolved?: string;
  /** What could not be built, and why: said where a module is missing. */
  failures: string[];
}

/** The deployment target a build uses where the project sets none: React Native's minimum. */
export const DEFAULT_DEPLOYMENT_TARGET = "15.1";

/** `identity@version` (the revision where a branch or a commit is pinned). */
export const pinName = (p: Pick<SwiftPackagePin, "identity" | "version" | "revision">) =>
  `${p.identity}@${p.version ?? p.revision.slice(0, 12)}`;

/** The app's Swift packages, built (or found built) in the cache. */
export function swiftPackages(app: XcodeApp, opts: { cacheDir?: string } = {}): SwiftPackages {
  const target = app.deploymentTarget ?? DEFAULT_DEPLOYMENT_TARGET;
  const pins = app.resolved ? pinsOf(app.resolved) : [];
  const xcode = run("xcodebuild", ["-version"], process.cwd());
  const out: SwiftPackages = {
    modules: [],
    packages: [],
    ...(app.resolved ? { resolved: app.resolved } : {}),
    failures: [],
  };
  if (!app.packages.length) return out;
  if (!xcode.ok) {
    out.failures.push(`xcodebuild did not run: ${xcode.output}`);
    return out;
  }

  for (const pin of app.packages) {
    const key = hash([pin.identity, pin.revision, target, xcode.output]);
    const dir = path.join(cacheRoot(opts.cacheDir), "spm", `${pin.identity}-${key}`);
    const done = path.join(dir, "modules.json");

    try {
      // One build per package and key, whoever asks (lucent dev, Metro, a terminal's build): the
      // others wait for it. It builds in place (xcodebuild's products name their own paths), and
      // modules.json, published whole and last, says it is done.
      if (!fs.existsSync(done))
        withLock(
          `${dir}.build`,
          () => fs.existsSync(done),
          () => build(pin, dir, target, app.resolved),
        );
      const built = readCached(done) as
        | { products: string[]; modules: SwiftPackageModule[] }
        | undefined;
      if (!built) throw new Error("its build recorded no modules");
      out.packages.push({ ...pin, products: built.products });
      out.modules.push(...built.modules);
    } catch (e) {
      out.failures.push(`${pinName(pin)}: ${(e as Error).message}`);
    }
  }

  // A dependency's modules are its own package's, at the version the app pins.
  for (const m of out.modules) {
    const owner = pins.find((p) => p.identity === m.package.slice(0, m.package.lastIndexOf("@")));
    if (owner) m.package = pinName(owner);
    else if (m.package.endsWith("@")) m.package += "unpinned";
  }

  return out;
}

/** Checks `pin` out into `dir`, builds its products, and records the modules they gave. */
function build(pin: SwiftPackagePin, dir: string, target: string, resolved?: string): void {
  const src = path.join(dir, "src");
  const derived = path.join(dir, "build");

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const clone = run("git", ["clone", "--quiet", pin.location, src], dir);
  if (!clone.ok) throw new Error(`git clone ${pin.location} failed: ${clone.output}`);
  const checkout = run(
    "git",
    ["-c", "advice.detachedHead=false", "checkout", "--quiet", pin.revision],
    src,
  );
  if (!checkout.ok) throw new Error(`git checkout ${pin.revision} failed: ${checkout.output}`);

  // Its dependencies at the versions the app resolved: SwiftPM keeps a pin it can use.
  if (resolved) fs.copyFileSync(resolved, path.join(src, "Package.resolved"));

  // Its library products, as its manifest declares them.
  const manifest = run("swift", ["package", "dump-package"], src);
  if (!manifest.ok) throw new Error(`swift package dump-package failed: ${manifest.output}`);
  const products = (
    JSON.parse(manifest.stdout) as {
      products: { name: string; type: Record<string, unknown> }[];
    }
  ).products
    .filter((p) => "library" in p.type)
    .map((p) => p.name);
  if (!products.length) throw new Error("its manifest declares no library product");

  for (const product of products) {
    const r = run(
      "xcodebuild",
      [
        "build",
        "-quiet",
        "-scheme",
        product,
        "-destination",
        "generic/platform=iOS Simulator",
        "-derivedDataPath",
        derived,
        "-skipPackagePluginValidation",
        `IPHONEOS_DEPLOYMENT_TARGET=${target}`,
      ],
      src,
    );
    if (!r.ok)
      throw new Error(
        `xcodebuild of ${product} failed: ${r.output.split("\n").slice(-20).join("\n")}`,
      );
  }

  // Each module is the package's whose sources declare it; else this one's.
  const built = path.join(derived, "Build/Products/Debug-iphonesimulator");
  const checkouts = path.join(derived, "SourcePackages/checkouts");
  const ownerOf = (module: string) => {
    for (const id of fs.existsSync(checkouts) ? fs.readdirSync(checkouts) : [])
      if (fs.existsSync(path.join(checkouts, id, "Sources", module))) return id.toLowerCase();
    return pin.identity;
  };

  const modules: SwiftPackageModule[] = fs.readdirSync(built).flatMap((f) => {
    const [, module, kind] = /^(.+)\.(swiftmodule|framework)$/.exec(f) ?? [];
    if (!module) return [];
    // A framework of a Swift module: one a dynamic library product gave.
    const framework = kind === "framework";
    if (framework && !fs.existsSync(path.join(built, f, "Modules", `${module}.swiftmodule`)))
      return [];

    const owner = ownerOf(module);
    return [
      {
        module,
        dir: built,
        ...(framework ? { framework: true as const } : {}),
        package: owner === pin.identity ? pinName(pin) : `${owner}@`,
      },
    ];
  });

  publish(path.join(dir, "modules.json"), { products, modules });
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
): { ok: boolean; stdout: string; output: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 26 });
  const stdout = r.stdout ?? "";
  return {
    ok: r.status === 0,
    stdout,
    output: `${stdout}${r.stderr ?? r.error?.message ?? ""}`.trim(),
  };
}
