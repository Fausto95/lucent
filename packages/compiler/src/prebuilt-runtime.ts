/**
 * The prebuilt runtime: the part of Lucent's C++ runtime that depends on
 * neither JSI nor React Native (the "core": lucent/*.cpp but the files that
 * reach a JSI or fbjni header, and the vendored regular expression engine),
 * compiled once per release for each target instead of in every app.
 *
 * scripts/prebuilt-runtime.ts writes it to packages/runtime/prebuilt/:
 *
 *   manifest.json        { sourcesHash, core: [...], targets: { "android/arm64-v8a": {...}, ... } }
 *   core-sources.txt     the core's sources, relative to the native package, one per line
 *   android/<abi>/liblucentcore.a
 *   ios/LucentCore.xcframework
 *   host/liblucentcore.a
 *
 * A build copies it into the native package (prebuilt/) only when it was
 * built from this runtime's sources (sourcesHash): the podspec and CMake
 * then link it and leave the core's sources out, and build them from
 * source without it. LUCENT_RUNTIME_FROM_SOURCE=1 always builds from source.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** What the prebuilt runtime was built from, and what it holds. */
export interface PrebuiltManifest {
  /** runtimeSourcesHash of the runtime the artifacts were built from. */
  sourcesHash: string;
  /** The core's sources, relative to the runtime's cpp/ (as core-sources.txt has them under cpp/). */
  core: string[];
  /** Each target built: its artifact, relative to prebuilt/, and the toolchain it was built with. */
  targets: Record<string, { artifact: string; toolchain?: string }>;
}

/** Includes the core may not reach: what the app's React Native version decides the ABI of. */
const APP_HEADERS = /#include\s*<(jsi\/|fbjni\/|jni\.h|react\/|ReactCommon\/|yoga\/|folly\/)/;
const INCLUDE = /#include\s*[<"]([^>"]+)[>"]/g;

function walk(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    .sort();
}

/**
 * The runtime's sources that make up the core (relative to `cppDir`):
 * those whose includes, followed through the runtime's headers, reach no
 * JSI, React Native or fbjni header.
 */
export function prebuiltCoreSources(cppDir: string): string[] {
  const reaches = new Map<string, boolean>();
  const resolve = (from: string, name: string) =>
    [path.join(path.dirname(from), name), path.join(cppDir, name)].find((f) => fs.existsSync(f));
  const appHeaders = (file: string, seen: Set<string>): boolean => {
    const known = reaches.get(file);
    if (known !== undefined) return known;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    let found = APP_HEADERS.test(text);
    for (const m of text.matchAll(INCLUDE)) {
      if (found) break;
      const next = resolve(file, m[1]!);
      if (next && !seen.has(next)) found = appHeaders(next, seen);
    }
    reaches.set(file, found);
    return found;
  };
  const candidates = [
    ...fs
      .readdirSync(path.join(cppDir, "lucent"))
      .filter((f) => f.endsWith(".cpp"))
      .map((f) => path.join(cppDir, "lucent", f)),
    ...fs
      .readdirSync(path.join(cppDir, "third_party/quickjs"))
      .filter((f) => f.endsWith(".c"))
      .map((f) => path.join(cppDir, "third_party/quickjs", f)),
  ];
  return candidates
    .filter((f) => !appHeaders(f, new Set()))
    .map((f) => path.relative(cppDir, f).split(path.sep).join("/"))
    .sort();
}

/**
 * A hash of everything the core is compiled from: every file under the
 * runtime's cpp/lucent and cpp/third_party (headers included), by path
 * and content, and the flags it is compiled with.
 */
export function runtimeSourcesHash(cppDir: string, flags: readonly string[] = CORE_FLAGS): string {
  const h = createHash("sha256");
  for (const dir of ["lucent", "third_party"])
    for (const f of walk(path.join(cppDir, dir)))
      h.update(`${path.relative(cppDir, f).split(path.sep).join("/")}\0`).update(
        fs.readFileSync(f),
      );
  h.update(flags.join(" "));
  return h.digest("hex").slice(0, 16);
}

/**
 * The flags the core is compiled with: the ones LucentNative.podspec and
 * android/CMakeLists.txt give the runtime, so code compiled from source
 * and the prebuilt core agree (-ffp-contract=off above all: JavaScript
 * rounds twice).
 */
export const CORE_FLAGS = [
  "-std=c++20",
  "-O2",
  "-ffp-contract=off",
  "-fexceptions",
  "-frtti",
  "-fPIC",
  "-fvisibility=hidden",
  "-fvisibility-inlines-hidden",
];

/** The flags the core's C sources (the regular expression engine) are compiled with. */
export const CORE_C_FLAGS = ["-std=c11", "-O2", "-w", "-fPIC", "-fvisibility=hidden"];

/**
 * The prebuilt runtime's files for the native package, by path under
 * prebuilt/ (with core-sources.txt naming the core's sources in the
 * package), or none when there is none for this runtime: missing, built
 * from other sources, or LUCENT_RUNTIME_FROM_SOURCE=1.
 */
export function prebuiltRuntimeFiles(
  runtime: string,
  env: NodeJS.ProcessEnv = process.env,
): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const dir = path.join(runtime, "prebuilt");
  const manifestFile = path.join(dir, "manifest.json");
  if (env.LUCENT_RUNTIME_FROM_SOURCE === "1" || !fs.existsSync(manifestFile)) return out;

  let manifest: PrebuiltManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as PrebuiltManifest;
  } catch {
    return out;
  }
  const cpp = path.join(runtime, "cpp");
  if (manifest.sourcesHash !== runtimeSourcesHash(cpp)) return out;
  if (manifest.core.join("\n") !== prebuiltCoreSources(cpp).join("\n")) return out;

  for (const f of walk(dir))
    out.set(path.relative(dir, f).split(path.sep).join("/"), fs.readFileSync(f));
  out.set("core-sources.txt", Buffer.from(manifest.core.map((f) => `cpp/${f}\n`).join("")));
  return out;
}
