import fs from "node:fs";
import path from "node:path";

/** Where the app's pods put the modules they define, as the Pods xcconfig tells Xcode. */
export interface PodsSearchPaths {
  includePaths: string[];
  frameworkPaths: string[];
  moduleMaps: string[];
}

/**
 * Reads the app target's Pods xcconfig (ios/Pods/Target Support Files/
 * Pods-<App>/Pods-<App>.debug.xcconfig): header and framework search paths,
 * and the module maps passed with -fmodule-map-file. Paths under build
 * directories (not there before a build) are left out.
 */
export function podsSearchPaths(iosDir: string, config = "debug"): PodsSearchPaths | undefined {
  const support = path.join(iosDir, "Pods/Target Support Files");
  if (!fs.existsSync(support)) return undefined;
  const target = fs
    .readdirSync(support)
    .filter((d) => d.startsWith("Pods-") && fs.existsSync(path.join(support, d, `${d}.${config}.xcconfig`)))
    .sort((a, b) => Number(/Tests?$/.test(a)) - Number(/Tests?$/.test(b)))[0];
  if (!target) return undefined;
  const settings = new Map<string, string>();
  for (const line of fs.readFileSync(path.join(support, target, `${target}.${config}.xcconfig`), "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (m) settings.set(m[1]!, m[2]!);
  }
  const vars: Record<string, string> = { PODS_ROOT: path.join(iosDir, "Pods"), SRCROOT: iosDir, PODS_TARGET_SRCROOT: iosDir };
  const expand = (s: string): string | undefined => {
    let unresolved = false;
    const out = s.replace(/\$\{(\w+)\}|\$\((\w+)\)/g, (_, a, b) => {
      const v = vars[(a ?? b) as string];
      if (v === undefined) unresolved = true;
      return v ?? "";
    });
    return unresolved ? undefined : path.normalize(out);
  };
  const words = (key: string) => [...(settings.get(key) ?? "").matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!).filter((w) => w !== "$(inherited)");
  const paths = (key: string) => words(key).map(expand).filter((p): p is string => !!p && fs.existsSync(p));
  const maps = new Set<string>();
  for (const key of ["OTHER_CFLAGS", "OTHER_SWIFT_FLAGS"]) {
    for (const w of words(key)) {
      const m = /-fmodule-map-file=(.+)$/.exec(w.replace(/"/g, ""));
      const p = m ? expand(m[1]!) : undefined;
      if (p && fs.existsSync(p)) maps.add(p);
    }
  }
  return { includePaths: paths("HEADER_SEARCH_PATHS"), frameworkPaths: paths("FRAMEWORK_SEARCH_PATHS"), moduleMaps: [...maps] };
}
