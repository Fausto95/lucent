import fs from "node:fs";
import path from "node:path";
import { lockedPods } from "./provenance.ts";
import { frameworkSearchPath } from "./vendored.ts";

/** Where the app's pods put the modules they define, as the Pods xcconfig tells Xcode. */
export interface PodsSearchPaths {
  includePaths: string[];
  frameworkPaths: string[];
  moduleMaps: string[];
  /** Pods built as frameworks (use_frameworks!), before Xcode has built them. */
  frameworks: PodFramework[];
  /** Preprocessor definitions the pods compile with (GCC_PREPROCESSOR_DEFINITIONS). */
  defines: string[];
  /** Swift pods (no public Objective-C headers): their modules are a build's products, made from their Swift. */
  swiftPods: SwiftPod[];
  /** Pods' XCFrameworks, whose simulator slices are on frameworkPaths. */
  xcframeworks: PodXcframework[];
  /** Podfile.lock: which pods these are, their versions and dependencies. */
  lockfile?: string;
}

/** A Swift pod, whose module is among a build's products. */
export interface SwiftPod {
  /** The pod Podfile.lock names. */
  pod: string;
  /** Its target in the Pods project. */
  target: string;
  module: string;
  /** Its Swift sources (what its module is made of: the build's cache key). */
  sources: string[];
}

/** An XCFramework a pod ships, which CocoaPods copies into the build directory. */
export interface PodXcframework {
  pod: string;
  xcframework: string;
  /** Its simulator slice: the directory holding <M>.framework. */
  searchPath: string;
}

/** A pod's framework as Xcode will build it: its module, module map, umbrella and public headers. */
export interface PodFramework {
  module: string;
  moduleMap: string;
  umbrella: string;
  headers: string[];
}

/** An xcconfig's settings, as written (`$(inherited)` and variables unexpanded). */
function readXcconfig(file: string): Map<string, string> {
  const settings = new Map<string, string>();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (m) settings.set(m[1]!, m[2]!);
  }

  return settings;
}

/** `s` with its variables replaced from `vars`; undefined when one is not there (a build directory). */
function expand(s: string, vars: Record<string, string>): string | undefined {
  let unresolved = false;
  const out = s.replace(/\$\{(\w+)\}|\$\((\w+)\)/g, (_, a, b) => {
    const v = vars[(a ?? b) as string];
    if (v === undefined) unresolved = true;
    return v ?? "";
  });

  return unresolved ? undefined : path.normalize(out);
}

/** A setting's words, quoted ones whole, without `$(inherited)`. */
const words = (settings: Map<string, string>, key: string) =>
  [...(settings.get(key) ?? "").matchAll(/"([^"]*)"|(\S+)/g)]
    .map((m) => m[1] ?? m[2]!)
    .filter((w) => w !== "$(inherited)");

/**
 * Reads the app target's Pods xcconfig (ios/Pods/Target Support Files/
 * Pods-<App>/Pods-<App>.debug.xcconfig): header and framework search paths,
 * the module maps passed with -fmodule-map-file, and preprocessor
 * definitions. Paths under build directories (not there before a build)
 * are left out; the pods Xcode builds as frameworks there are found from
 * their own Target Support Files (see podFrameworks).
 */
export function podsSearchPaths(iosDir: string, config = "debug"): PodsSearchPaths | undefined {
  const support = path.join(iosDir, "Pods/Target Support Files");
  if (!fs.existsSync(support)) return undefined;
  const target = fs
    .readdirSync(support)
    .filter(
      (d) =>
        d.startsWith("Pods-") && fs.existsSync(path.join(support, d, `${d}.${config}.xcconfig`)),
    )
    .sort((a, b) => Number(/Tests?$/.test(a)) - Number(/Tests?$/.test(b)))[0];
  if (!target) return undefined;

  const settings = readXcconfig(path.join(support, target, `${target}.${config}.xcconfig`));
  const vars: Record<string, string> = {
    PODS_ROOT: path.join(iosDir, "Pods"),
    SRCROOT: iosDir,
    PODS_TARGET_SRCROOT: iosDir,
  };
  const paths = (key: string) =>
    words(settings, key)
      .map((w) => expand(w, vars))
      .filter((p): p is string => !!p && fs.existsSync(p));

  const maps = new Set<string>();
  for (const key of ["OTHER_CFLAGS", "OTHER_SWIFT_FLAGS"]) {
    for (const w of words(settings, key)) {
      const m = /-fmodule-map-file=(.+)$/.exec(w.replace(/"/g, ""));
      const p = m ? expand(m[1]!, vars) : undefined;
      if (p && fs.existsSync(p)) maps.add(p);
    }
  }

  const lockfile = path.join(iosDir, "Podfile.lock");
  const locked = [...lockedPods(lockfile).keys()];
  const xcframeworks = podXcframeworks(iosDir, words(settings, "FRAMEWORK_SEARCH_PATHS"));
  // A Swift pod's module, static library or framework (use_frameworks!), is a build's product.
  const swiftPods = staticSwiftPods(
    iosDir,
    ["LIBRARY_SEARCH_PATHS", "SWIFT_INCLUDE_PATHS", "FRAMEWORK_SEARCH_PATHS"].flatMap((k) =>
      words(settings, k),
    ),
    config,
    locked,
  );
  // A framework whose umbrella imports no headers is all Swift: bound from its Swift.
  const frameworks = podFrameworks(
    iosDir,
    words(settings, "FRAMEWORK_SEARCH_PATHS"),
    config,
  ).filter((f) => f.headers.length || !swiftPods.some((p) => p.module === f.module));

  return {
    includePaths: paths("HEADER_SEARCH_PATHS"),
    frameworkPaths: [...paths("FRAMEWORK_SEARCH_PATHS"), ...xcframeworks.map((x) => x.searchPath)],
    moduleMaps: [...maps],
    frameworks,
    defines: words(settings, "GCC_PREPROCESSOR_DEFINITIONS").filter((d) => !d.includes("$")),
    // A mixed pod's framework keeps its Objective-C; its Swift is not read.
    swiftPods: swiftPods.filter((p) => !frameworks.some((f) => f.module === p.module)),
    xcframeworks,
    ...(fs.existsSync(lockfile) ? { lockfile } : {}),
  };
}

/** The pod a Pods target builds: the one Podfile.lock names, else the target's own name. */
function podOfTarget(target: string, locked: string[]): string {
  return (
    locked.find((p) => p === target) ??
    locked.filter((p) => target.startsWith(`${p}-`)).sort((a, b) => b.length - a.length)[0] ??
    target
  );
}

/**
 * Swift pods: the app's library, Swift include and framework search paths
 * name each pod target's products directory,
 * `${PODS_CONFIGURATION_BUILD_DIR}/<target>`, where Xcode writes its
 * `.swiftmodule` (a static library, React Native's default) or its
 * framework (use_frameworks!); empty until a build. The target's
 * xcconfig names its module (PRODUCT_MODULE_NAME) and sources
 * (PODS_TARGET_SRCROOT); a target without Swift sources is an
 * Objective-C library, bound through its headers instead.
 */
function staticSwiftPods(
  iosDir: string,
  searchPaths: string[],
  config: string,
  locked: string[],
): SwiftPod[] {
  const pods = path.join(iosDir, "Pods");
  const support = path.join(pods, "Target Support Files");
  const out: SwiftPod[] = [];
  const seen = new Set<string>();

  for (const w of searchPaths) {
    const target = /^\$[{(]PODS_CONFIGURATION_BUILD_DIR[})]\/([^/]+)$/.exec(w)?.[1];
    if (!target || seen.has(target)) continue;
    seen.add(target);

    const xcconfig = path.join(support, target, `${target}.${config}.xcconfig`);
    if (!fs.existsSync(xcconfig)) continue;

    const settings = readXcconfig(xcconfig);
    const module = settings.get("PRODUCT_MODULE_NAME")?.trim() || target.replace(/\W/g, "_");
    const srcroot = expand(settings.get("PODS_TARGET_SRCROOT") ?? "", {
      PODS_ROOT: pods,
      SRCROOT: pods,
    });
    const sources = srcroot ? filesByExtension(srcroot, ".swift") : [];
    if (!sources.length) continue;

    out.push({ pod: podOfTarget(target, locked), target, module, sources });
  }

  return out.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
}

/**
 * The XCFrameworks pods ship: CocoaPods lists each pod's in Target Support
 * Files/<pod>/<pod>-xcframeworks-input-files.xcfilelist and copies them to
 * `${PODS_XCFRAMEWORKS_BUILD_DIR}/<pod>`, which the app's framework search
 * paths name. Before a build, each is read from Pods/ through the slice
 * its Info.plist names for the simulator.
 */
function podXcframeworks(iosDir: string, searchPaths: string[]): PodXcframework[] {
  const pods = path.join(iosDir, "Pods");
  const support = path.join(pods, "Target Support Files");
  const wanted = new Set(
    searchPaths
      .map((w) => /^\$[{(]PODS_XCFRAMEWORKS_BUILD_DIR[})]\/([^/]+)/.exec(w)?.[1])
      .filter((p): p is string => !!p),
  );
  const out: PodXcframework[] = [];

  for (const pod of [...wanted].sort()) {
    const list = path.join(support, pod, `${pod}-xcframeworks-input-files.xcfilelist`);
    if (!fs.existsSync(list)) continue;

    for (const line of fs.readFileSync(list, "utf8").split("\n")) {
      const file = expand(line.trim(), { PODS_ROOT: pods, SRCROOT: iosDir });
      if (!file?.endsWith(".xcframework") || !fs.existsSync(file)) continue;

      const searchPath = frameworkSearchPath(file);
      if (searchPath) out.push({ pod, xcframework: file, searchPath });
    }
  }

  return out;
}

/** The files under `root` ending in `ext`, sorted; dependencies (node_modules) and hidden directories aside. */
function filesByExtension(root: string, ext: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(ext)) out.push(full);
    }
  };
  walk(root);

  return out.sort();
}

/**
 * The pods Xcode builds as frameworks (use_frameworks!): the app's
 * framework search paths name each one's products directory,
 * `${PODS_CONFIGURATION_BUILD_DIR}/<target>`, empty until a build. Before
 * one, the framework is what CocoaPods wrote for it: Target Support
 * Files/<target>/<target>.modulemap and the umbrella header it names,
 * whose imports are the pod's public headers, found by name in the pod's
 * sources (its xcconfig's PODS_TARGET_SRCROOT) as the build copies them.
 */
function podFrameworks(iosDir: string, searchPaths: string[], config: string): PodFramework[] {
  const pods = path.join(iosDir, "Pods");
  const support = path.join(pods, "Target Support Files");
  const out: PodFramework[] = [];

  for (const w of searchPaths) {
    const target = /^\$[{(]PODS_CONFIGURATION_BUILD_DIR[})]\/([^/]+)$/.exec(w)?.[1];
    if (!target) continue;

    const dir = path.join(support, target);
    const moduleMap = path.join(dir, `${target}.modulemap`);
    if (!fs.existsSync(moduleMap)) continue;

    const map = fs.readFileSync(moduleMap, "utf8");
    const module = /^\s*framework\s+module\s+([\w.]+)/m.exec(map)?.[1];
    const umbrellaName = /umbrella\s+header\s+"([^"]+)"/.exec(map)?.[1];
    const umbrella = umbrellaName && path.join(dir, umbrellaName);
    if (!module || !umbrella || !fs.existsSync(umbrella)) continue;

    // The pod's own xcconfig: its sources, relative to the Pods project (SRCROOT there).
    const xcconfig = path.join(dir, `${target}.${config}.xcconfig`);
    const srcroot = fs.existsSync(xcconfig)
      ? expand(readXcconfig(xcconfig).get("PODS_TARGET_SRCROOT") ?? "", {
          PODS_ROOT: pods,
          SRCROOT: pods,
        })
      : undefined;
    const found = srcroot ? headersByName(srcroot) : new Map<string, string>();

    const imports = new RegExp(
      `^\\s*#\\s*(?:import|include)\\s+(?:"([^"]+)"|<${module}/([^>]+)>)`,
      "gm",
    );
    const imported = [...fs.readFileSync(umbrella, "utf8").matchAll(imports)].map((m) =>
      path.basename(m[1] ?? m[2]!),
    );
    const headers = [...new Set(imported)]
      .map((name) => found.get(name))
      .filter((h): h is string => !!h)
      .sort();

    out.push({ module, moduleMap, umbrella, headers });
  }

  return out;
}

/**
 * The headers under `root` by file name, the nearest to it where names
 * repeat. Dependencies (node_modules) and hidden directories are not the
 * pod's sources.
 */
function headersByName(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const depth = (f: string) => path.relative(root, f).split(path.sep).length;

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;

      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".h")) {
        const seen = found.get(e.name);
        const nearer =
          !seen || depth(full) < depth(seen) || (depth(full) === depth(seen) && full < seen);
        if (nearer) found.set(e.name, full);
      }
    }
  };
  walk(root);

  return found;
}
