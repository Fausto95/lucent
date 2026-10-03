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
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runtimeDir } from "../../src/index.ts";
import { ndkClang } from "../android-harness.ts";
import { runAll } from "../parallel-build.ts";

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
function common(platform: { view: string; graphics: string }): string[] {
  const system = [
    REACT_COMMON,
    path.join(REACT_COMMON, "react/renderer/components/view/platform", platform.view),
    path.join(REACT_COMMON, "react/renderer/graphics/platform", platform.graphics),
    path.join(REACT_COMMON, "jsi"),
    path.join(REACT_COMMON, "yoga"),
    path.join(REACT_COMMON, "callinvoker"),
    path.join(REACT_COMMON, "runtimeexecutor"),
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
 * A compiler and linker for programs that run on this Mac against React
 * Native's prebuilt frameworks (their Mac Catalyst slices) and Hermes,
 * when the Pods hold them. The frameworks are release builds: NDEBUG.
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
      "-DNDEBUG",
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
