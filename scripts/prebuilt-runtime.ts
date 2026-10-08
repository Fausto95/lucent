/**
 * Builds the prebuilt runtime for a release (packages/compiler/src/
 * prebuilt-runtime.ts says what it is and how builds use it), into
 * packages/runtime/prebuilt/, which the package build copies into
 * @lucent-lang/lucent's runtime/:
 *
 *   node scripts/prebuilt-runtime.ts host          this machine's static library (tests)
 *   node scripts/prebuilt-runtime.ts android       each ABI, with the NDK ($ANDROID_NDK_HOME,
 *                                                  or the newest under $ANDROID_HOME/ndk)
 *   node scripts/prebuilt-runtime.ts ios           LucentCore.xcframework (macOS, Xcode)
 *   node scripts/prebuilt-runtime.ts all           android and ios
 *
 * Each target is added to prebuilt/manifest.json, keyed on the runtime's
 * sources: artifacts of other sources are dropped first, so a build never
 * links a core of another runtime (it falls back to the sources).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CORE_C_FLAGS,
  CORE_FLAGS,
  type PrebuiltManifest,
  prebuiltCoreSources,
  runtimeSourcesHash,
} from "../packages/compiler/src/prebuilt-runtime.ts";

const root = path.resolve(import.meta.dirname, "..");
const runtime = path.join(root, "packages/runtime");
const cpp = path.join(runtime, "cpp");
const out = path.resolve(process.env.LUCENT_PREBUILT_OUT ?? path.join(runtime, "prebuilt"));
const project = path.join(runtime, "prebuilt-src");

/** The ABIs React Native builds for. */
const ANDROID_ABIS = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"];
/** React Native's minimum Android API (minSdkVersion). */
const ANDROID_API = 24;
/** React Native's minimum iOS version (min_ios_version_supported). */
const IOS_MIN = "15.1";

function run(cmd: string, args: string[], cwd = root): void {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status ?? r.signal})`);
}

const sourcesHash = runtimeSourcesHash(cpp);
const core = prebuiltCoreSources(cpp);
const manifestFile = path.join(out, "manifest.json");
const previous = fs.existsSync(manifestFile)
  ? (JSON.parse(fs.readFileSync(manifestFile, "utf8")) as PrebuiltManifest)
  : undefined;
// Artifacts of other sources can't be linked with this runtime.
if (previous && previous.sourcesHash !== sourcesHash) fs.rmSync(out, { recursive: true });
const manifest: PrebuiltManifest =
  previous?.sourcesHash === sourcesHash ? previous : { sourcesHash, core, targets: {} };
fs.mkdirSync(out, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-prebuilt-"));
const list = path.join(work, "core-sources.txt");
fs.writeFileSync(list, `${core.join("\n")}\n`);

/** Configures and builds the core with CMake (`extra`: the toolchain's options); returns the library. */
function cmake(name: string, extra: string[]): string {
  const build = path.join(work, name);
  run("cmake", [
    "-S",
    project,
    "-B",
    build,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    `-DLUCENT_CPP=${cpp}`,
    `-DLUCENT_CORE_SOURCES=${list}`,
    `-DLUCENT_CXX_FLAGS=${CORE_FLAGS.join(" ")}`,
    `-DLUCENT_C_FLAGS=${CORE_C_FLAGS.join(" ")}`,
    ...extra,
  ]);
  run("cmake", ["--build", build]);
  return path.join(build, "liblucentcore.a");
}

function place(target: string, from: string, artifact: string, toolchain?: string): void {
  const to = path.join(out, artifact);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  manifest.targets[target] = { artifact, ...(toolchain ? { toolchain } : {}) };
  console.log(`✓ ${target}  ${artifact}`);
}

function host(): void {
  place("host", cmake("host", []), "host/liblucentcore.a", `${os.platform()}-${os.arch()}`);
}

function ndk(): string {
  if (process.env.ANDROID_NDK_HOME) return process.env.ANDROID_NDK_HOME;
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const versions =
    sdk && fs.existsSync(path.join(sdk, "ndk")) ? fs.readdirSync(path.join(sdk, "ndk")) : [];
  const newest = versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (!sdk || !newest)
    throw new Error("no Android NDK: set ANDROID_NDK_HOME, or install one under $ANDROID_HOME/ndk");
  return path.join(sdk, "ndk", newest);
}

function android(): void {
  const at = ndk();
  for (const abi of ANDROID_ABIS)
    place(
      `android/${abi}`,
      cmake(`android-${abi}`, [
        `-DCMAKE_TOOLCHAIN_FILE=${path.join(at, "build/cmake/android.toolchain.cmake")}`,
        `-DANDROID_ABI=${abi}`,
        `-DANDROID_PLATFORM=android-${ANDROID_API}`,
        // React Native's: one shared libc++ for the app's native libraries.
        "-DANDROID_STL=c++_shared",
      ]),
      `android/${abi}/liblucentcore.a`,
      `ndk ${path.basename(at)}`,
    );
}

function ios(): void {
  if (process.platform !== "darwin") throw new Error("the iOS core builds on macOS, with Xcode");
  const slices = [
    { name: "iphoneos", sysroot: "iphoneos", archs: "arm64" },
    { name: "iphonesimulator", sysroot: "iphonesimulator", archs: "arm64;x86_64" },
  ].map(({ name, sysroot, archs }) =>
    cmake(`ios-${name}`, [
      "-DCMAKE_SYSTEM_NAME=iOS",
      `-DCMAKE_OSX_SYSROOT=${sysroot}`,
      `-DCMAKE_OSX_ARCHITECTURES=${archs}`,
      `-DCMAKE_OSX_DEPLOYMENT_TARGET=${IOS_MIN}`,
    ]),
  );
  const framework = path.join(work, "LucentCore.xcframework");
  run("xcodebuild", [
    "-create-xcframework",
    ...slices.flatMap((lib) => ["-library", lib]),
    "-output",
    framework,
  ]);
  const xcode = spawnSync("xcodebuild", ["-version"], { encoding: "utf8" }).stdout.split("\n")[0];
  place("ios", framework, "ios/LucentCore.xcframework", xcode);
}

const wanted = process.argv[2] ?? "host";
const targets: Record<string, () => void> = {
  host,
  android,
  ios,
  all: () => (android(), ios()),
};
if (!targets[wanted]) throw new Error(`unknown target ${wanted}: host, android, ios or all`);
targets[wanted]();

fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
fs.rmSync(work, { recursive: true, force: true });
