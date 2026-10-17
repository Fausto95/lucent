/**
 * Compiling generated Fabric sources against React Native's renderer
 * headers: the example app's ReactCommon, and the headers of the libraries
 * it includes (folly, glog, boost…), which only a platform build fetches.
 *
 * iOS: the example app's Pods (after `pod install`), or LUCENT_RN_DEPS_IOS.
 * Android: the NDK, with the react-android and fbjni prefab headers Gradle
 * unpacked for the app's React Native version, or LUCENT_RN_DEPS_ANDROID
 * and LUCENT_FBJNI_INCLUDE.
 *
 * Running them: React Native's prebuilt frameworks the Pods hold (or
 * LUCENT_RN_PODS) have a Mac Catalyst slice, which runs on this Mac.
 *
 * Any machine: the releases scripts/react-native-headers.ts assembled,
 * compiled with this machine's clang (hostToolchains).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type AssembledRelease, headersCache } from "../../../../scripts/react-native-headers.ts";
import { runtimeDir } from "../../src/index.ts";
import { ndkClang } from "../android-harness.ts";
import { runAll } from "../parallel-build.ts";

export type { AssembledRelease };

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const REACT_NATIVE = path.join(ROOT, "apps/bare-example/node_modules/react-native");
const REACT_COMMON = path.join(REACT_NATIVE, "ReactCommon");

/** React Native's C++ sources: the example app's. */
export const reactCommon = () => REACT_COMMON;

export interface Toolchain {
  readonly command: string;
  readonly args: readonly string[];
}

/** React Native's own flags for folly on Android (folly-flags.cmake). */
const FOLLY_ANDROID = [
  "-DFOLLY_NO_CONFIG=1",
  "-DFOLLY_HAVE_CLOCK_GETTIME=1",
  "-DFOLLY_USE_LIBCPP=1",
  "-DFOLLY_CFG_NO_COROUTINES=1",
  "-DFOLLY_MOBILE=1",
  "-DFOLLY_HAVE_PTHREAD=1",
];

/** Lucent's flags, warnings as errors, and the headers every platform shares. */
function common(
  platform: { view: string; graphics: string },
  reactCommon: string = REACT_COMMON,
): string[] {
  const system = [
    reactCommon,
    path.join(reactCommon, "react/renderer/components/view/platform", platform.view),
    path.join(reactCommon, "react/renderer/graphics/platform", platform.graphics),
    path.join(reactCommon, "jsi"),
    path.join(reactCommon, "yoga"),
    path.join(reactCommon, "callinvoker"),
    path.join(reactCommon, "runtimeexecutor"),
  ];

  return [
    "-std=c++20",
    "-fsyntax-only",
    "-ffp-contract=off",
    "-fexceptions",
    "-frtti",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-Wno-unused-parameter",
    `-I${path.join(runtimeDir(), "cpp")}`,
    `-I${path.join(runtimeDir(), "cpp/rn")}`,
    ...system.flatMap((dir) => ["-isystem", dir]),
  ];
}

const PODS = process.env.LUCENT_RN_PODS ?? path.join(ROOT, "apps/bare-example/ios/Pods");

const sdkPath = (sdk: string) =>
  spawnSync("xcrun", ["--sdk", sdk, "--show-sdk-path"], { encoding: "utf8" }).stdout?.trim();

/** The iOS simulator's compiler and headers, when the libraries' headers are there. */
export function iosToolchain(): Toolchain | undefined {
  if (process.platform !== "darwin") return undefined;

  const deps = process.env.LUCENT_RN_DEPS_IOS ?? path.join(PODS, "ReactNativeDependencies/Headers");
  const sdk = sdkPath("iphonesimulator");

  if (!fs.existsSync(path.join(deps, "folly/dynamic.h")) || !sdk) return undefined;

  return {
    command: "xcrun",
    args: [
      "clang++",
      "-target",
      "arm64-apple-ios15.1-simulator",
      "-isysroot",
      sdk,
      ...common({ view: "cxx", graphics: "ios" }),
      "-isystem",
      deps,
    ],
  };
}

/**
 * The iOS simulator's compiler for a platform host's Objective-C++: the
 * headers iosToolchain() has, with React Native's own iOS headers (its
 * prebuilt React.framework, as the Pods hold it) and the TurboModule's.
 */
export function iosHostToolchain(): Toolchain | undefined {
  const base = iosToolchain();
  const react = path.join(PODS, "React-Core-prebuilt/React.xcframework/ios-arm64_x86_64-simulator");

  if (!base || !fs.existsSync(path.join(react, "React.framework"))) return undefined;

  const system = [
    path.join(react, "React.framework/Headers"),
    path.join(REACT_COMMON, "react/utils/platform/ios"),
    path.join(REACT_COMMON, "react/nativemodule/core"),
    path.join(REACT_COMMON, "react/nativemodule/core/platform/ios"),
  ];

  return {
    command: base.command,
    args: [
      base.args[0]!,
      "-x",
      "objective-c++",
      "-fobjc-arc",
      ...base.args.slice(1),
      "-iframework",
      react,
      ...system.flatMap((dir) => ["-isystem", dir]),
    ],
  };
}

/**
 * The configuration of React Native's prebuilt core in the Pods: Debug, as
 * `pod install` leaves it, until an app's Release build swaps the Release
 * one in (React Native's replace-rncore-version.js records which). Its
 * classes' layout follows it: a Debug core's DebugStringConvertible has
 * virtual members (RN_DEBUG_STRING_CONVERTIBLE) a Release one lacks.
 */
export function prebuiltConfiguration(): "Debug" | "Release" {
  const marker = path.join(PODS, "React-Core-prebuilt/.last_build_configuration");
  try {
    return fs.readFileSync(marker, "utf8").trim() === "Release" ? "Release" : "Debug";
  } catch {
    return "Debug";
  }
}

/**
 * A compiler and linker for programs that run on this Mac against React
 * Native's prebuilt frameworks (their Mac Catalyst slices) and Hermes,
 * when the Pods hold them, built as the frameworks were: DEBUG=1 against a
 * Debug core, NDEBUG against a Release one.
 */
export function catalystToolchain(): Toolchain | undefined {
  if (process.platform !== "darwin" || process.arch !== "arm64") return undefined;

  const slice = "ios-arm64_x86_64-maccatalyst";
  const frameworks = [
    path.join(PODS, "React-Core-prebuilt/React.xcframework", slice),
    path.join(
      PODS,
      "ReactNativeDependencies/framework/packages/react-native/ReactNativeDependencies.xcframework",
      slice,
    ),
    path.join(
      PODS,
      "hermes-engine/destroot/Library/Frameworks/universal/hermesvm.xcframework",
      slice,
    ),
  ];
  const deps = path.join(PODS, "ReactNativeDependencies/Headers");
  const hermes = path.join(PODS, "hermes-engine/destroot/include");
  const sdk = sdkPath("macosx");

  if (!frameworks.every((f) => fs.existsSync(f)) || !fs.existsSync(hermes) || !sdk)
    return undefined;

  return {
    command: "xcrun",
    args: [
      "clang++",
      "-target",
      "arm64-apple-ios15.1-macabi",
      "-isysroot",
      sdk,
      ...common({ view: "cxx", graphics: "ios" }).filter((f) => f !== "-fsyntax-only"),
      prebuiltConfiguration() === "Release" ? "-DNDEBUG" : "-DDEBUG=1",
      "-isystem",
      deps,
      "-isystem",
      hermes,
      ...frameworks.flatMap((f) => [`-F${f}`, `-Wl,-rpath,${f}`]),
      "-framework",
      "React",
      "-framework",
      "ReactNativeDependencies",
      "-framework",
      "hermesvm",
    ],
  };
}

/** The NDK's compiler and headers, when Gradle unpacked them for the app's React Native. */
export function androidToolchain(): Toolchain | undefined {
  const clang = ndkClang();
  const deps =
    process.env.LUCENT_RN_DEPS_ANDROID ??
    prefab(`react-android-${reactNativeVersion()}-debug`, "reactnative");
  const fbjni = process.env.LUCENT_FBJNI_INCLUDE ?? prefab("fbjni-", "fbjni");

  if (!clang || !deps || !fbjni) return undefined;

  return {
    command: clang,
    args: [
      "--target=aarch64-linux-android24",
      ...common({ view: "android", graphics: "android" }),
      // React Native's Android builds serialize props for the Java side.
      "-DRN_SERIALIZABLE_STATE=1",
      ...FOLLY_ANDROID,
      "-isystem",
      deps,
      "-isystem",
      fbjni,
    ],
  };
}

/** The releases scripts/react-native-headers.ts assembled, oldest first. */
export function assembledReleases(): AssembledRelease[] {
  const cache = headersCache();
  const releases = (fs.existsSync(cache) ? fs.readdirSync(cache) : [])
    .map((dir) => path.join(cache, dir, "toolchain.json"))
    .filter((manifest) => fs.existsSync(manifest))
    .map((manifest) => JSON.parse(fs.readFileSync(manifest, "utf8")) as AssembledRelease);
  const order = (v: string) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));

  return releases.sort((a, b) => {
    const [x, y] = [order(a.version), order(b.version)];

    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      // A prerelease (0.88.0-rc.4) comes before its release (0.88.0).
      if (x[i] === undefined) return 1;
      if (y[i] === undefined) return -1;
      return x[i]! < y[i]! ? -1 : 1;
    }

    return 0;
  });
}

/** Folly's configuration where no folly-config.h is generated: React Native's for Android, less libc++. */
const FOLLY_HOST = FOLLY_ANDROID.filter((f) => f !== "-DFOLLY_USE_LIBCPP=1");

/**
 * This machine's compiler against an assembled release's headers: `cxx`
 * as an iOS build has them (React Native's cxx platform headers), and
 * `android` as an Android build does (react-android's prefab layout, JNI
 * and fbjni), when the release has the JDK's JNI headers. Both only check
 * syntax: nothing they compile is linked.
 */
export function hostToolchains(release: AssembledRelease): {
  cxx: Toolchain;
  android?: Toolchain;
} {
  const reactCommon = path.join(release.reactNative, "ReactCommon");
  const cxx: Toolchain = {
    command: "clang++",
    args: [
      ...common({ view: "cxx", graphics: "cxx" }, reactCommon),
      ...FOLLY_HOST,
      "-isystem",
      path.join(reactCommon, "react/nativemodule/core"),
      "-isystem",
      release.include,
    ],
  };

  if (!release.jni) return { cxx };

  const android: Toolchain = {
    command: "clang++",
    args: [
      ...common({ view: "android", graphics: "android" }, reactCommon),
      // The Android headers' code paths, on this machine's compiler.
      "-D__ANDROID__=1",
      // The NDK's libc++ brings <format> in with other headers, and React
      // Native's Android graphics conversions count on that.
      "-include",
      "format",
      "-DRN_SERIALIZABLE_STATE=1",
      ...FOLLY_ANDROID,
      ...[release.ndk, release.jni, path.join(release.jni, "linux"), ...release.prefab].flatMap(
        (dir) => ["-isystem", dir],
      ),
      "-isystem",
      release.include,
    ],
  };

  return { cxx, android };
}

function reactNativeVersion(): string {
  const manifest = JSON.parse(fs.readFileSync(path.join(REACT_NATIVE, "package.json"), "utf8"));

  return (manifest as { version: string }).version;
}

/** The include directory of a prefab module in an AAR Gradle unpacked whose name starts with `aar`. */
function prefab(aar: string, module: string): string | undefined {
  const caches = path.join(os.homedir(), ".gradle/caches");
  const list = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

  for (const version of list(caches).toReversed()) {
    const transforms = path.join(caches, version, "transforms");

    for (const transform of list(transforms)) {
      const transformed = path.join(transforms, transform, "transformed");

      for (const name of list(transformed)) {
        const include = path.join(transformed, name, "prefab/modules", module, "include");

        if (name.startsWith(aar) && fs.existsSync(include)) return include;
      }
    }
  }

  return undefined;
}

/** What the compiler says of each file, warnings as errors: empty when all compile. */
export function compileErrors(toolchain: Toolchain, dir: string, files: readonly string[]): string {
  // Side by side, one per core: each is seconds of React Native's headers.
  const results = runAll(
    files.map((file) => ({
      cmd: toolchain.command,
      args: [...toolchain.args, `-I${dir}`, file],
      cwd: dir,
    })),
  );

  return files
    .map((file, i) => (results[i]!.status === 0 ? "" : `${file}:\n${results[i]!.output}`))
    .join("");
}
