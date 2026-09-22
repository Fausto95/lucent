import type { IRModule, NativePackage } from "@lucent-lang/compiler";
import type { FileTree } from "./index.ts";
/** Package adapters are trusted build inputs, emitted once across source modules. */
export function emitNativePackages(files: FileTree, modules: IRModule[], androidPackage: string): void {
  const staged = new Map(files);
  emitNativePackagesInto(staged, modules, androidPackage);
  for (const [path, source] of staged) files.set(path, source);
}
function emitNativePackagesInto(files: FileTree, modules: IRModule[], androidPackage: string): void {
  const ios = modules.flatMap((m) => (m.targets?.ios ? [m.targets.ios] : []));
  const androidTargets = modules.flatMap((m) => (m.targets?.android ? [m.targets.android] : []));
  if (ios.length)
    for (const [path, source] of files) {
      if (!path.endsWith(".podspec")) continue;
      const index = source.lastIndexOf("\nend");
      if (index < 0) throw new Error("Cannot set minimum iOS deployment target");
      const versions = ios.map((v) => `Gem::Version.new(${JSON.stringify(v)})`);
      files.set(
        path,
        source.slice(0, index) +
          `\n  s.ios.deployment_target = ([Gem::Version.new(s.deployment_target(:ios) || '0'), ${versions.join(", ")}].max).to_s\n` +
          source.slice(index),
      );
    }
  if (androidTargets.length) {
    const source = files.get("android/build.gradle");
    if (!source) throw new Error("Cannot set minimum Android deployment target");
    files.set(
      "android/build.gradle",
      source +
        `\nandroid.defaultConfig.minSdkVersion Math.max(android.defaultConfig.minSdkVersion.apiLevel, ${Math.max(...androidTargets)})\n`,
    );
  }
  const packages = new Map<string, NativePackage>();
  const pods = new Map<string, { version: string; origin: string }>();
  const androidVersions = new Map<string, { version: string; origin: string }>();
  const android = new Set<string>();
  for (const module of modules)
    for (const [id, pkg] of Object.entries(module.nativePackages ?? {})) {
      if (packages.has(id) && JSON.stringify(packages.get(id)) !== JSON.stringify(pkg))
        throw new Error(`Conflicting native package ${id}`);
      packages.set(id, pkg);
    }
  for (const [id, pkg] of packages) {
    const origin = pkg.origin ?? id;
    if (!/^[a-zA-Z0-9_]+$/.test(id)) throw new Error("Invalid native package identity");
    for (const [language, extension, directory] of [
      ["swift", "swift", "ios"],
      ["kotlin", "kt", "android/src/main/java"],
    ] as const) {
      for (const [name, source] of Object.entries(pkg[language] ?? {})) {
        if (!new RegExp(`^[A-Za-z_][A-Za-z0-9_]*\\.${extension}$`).test(name) || typeof source !== "string")
          throw new Error(`Invalid native package source ${name}`);
        files.set(`${directory}/LucentPackages/${id}/${name}`, source.replaceAll("{{androidPackage}}", androidPackage));
      }
    }
    for (const [name, version] of Object.entries(pkg.dependencies?.pods ?? {})) {
      requireAlignedVersion(pods, name, version, origin, "pod");
    }
    for (const dependency of pkg.dependencies?.android ?? []) {
      const coordinate = parseAndroidDependency(dependency);
      requireAlignedVersion(androidVersions, coordinate.name, coordinate.version, origin, "Android");
      android.add(dependency);
    }
  }
  if (pods.size)
    for (const [path, source] of files)
      if (path.endsWith(".podspec")) {
        const index = source.lastIndexOf("\nend");
        if (index < 0) throw new Error("Cannot append package pod dependencies");
        const additions = [...pods]
          .map(([name, { version }]) => `  s.dependency ${JSON.stringify(name)}, ${JSON.stringify(version)}`)
          .join("\n");
        files.set(path, source.slice(0, index) + "\n" + additions + source.slice(index));
      }
  if (android.size)
    files.set(
      "android/build.gradle",
      files.get("android/build.gradle") +
        "\ndependencies {\n" +
        [...android].map((name) => `  implementation ${JSON.stringify(name)}`).join("\n") +
        "\n}\n",
    );
}

/** Avoid silently relying on Gradle's highest-version selection across SDK adapters. */
function requireAlignedVersion(
  requirements: Map<string, { version: string; origin: string }>,
  name: string,
  version: string,
  origin: string,
  ecosystem: string,
): void {
  const previous = requirements.get(name);
  if (previous && previous.version !== version)
    throw new Error(
      `Conflicting ${ecosystem} dependency ${name}: ${previous.version} from ${previous.origin}; ${version} from ${origin}. Align adapter requirements explicitly; Lucent does not choose an SDK version.`,
    );
  requirements.set(name, { version, origin });
}
function parseAndroidDependency(dependency: string): { name: string; version: string } {
  const match = /^([^:\s@]+):([^:\s@]+):([^:\s@]+)(?::([^:\s@]+))?(?:@([^:\s@]+))?$/.exec(dependency);
  if (!match)
    throw new Error(
      `Invalid Android dependency coordinate ${JSON.stringify(dependency)}; expected group:artifact:version[:classifier][@extension].`,
    );
  // Classifiers and packaging still share the same module version in Gradle resolution.
  return { name: `${match[1]}:${match[2]}`, version: match[3]! };
}
