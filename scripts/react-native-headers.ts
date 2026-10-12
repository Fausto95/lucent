/**
 * A React Native release's C++ headers, assembled on Linux, so Lucent's
 * React Native C++ (the generated Fabric sources, the TurboModule and the
 * Android view host) compiles against every release Lucent supports
 * without a platform SDK: the release's ReactCommon and Android JNI
 * sources from npm, and the libraries its headers include (folly, fmt,
 * glog, double-conversion, fast_float, some of Boost, fbjni) from
 * GitHub, at the versions its gradle/libs.versions.toml names.
 *
 *   node scripts/react-native-headers.ts 0.86 0.87 next
 *   node scripts/react-native-headers.ts --window
 *
 * A release is a version, the newest of a minor (`0.86`) or of a range, or
 * a dist-tag (`next`); `--window` names the releases Lucent supports (its
 * window, and the newest candidate on its prerelease lane), as
 * lucent doctor checks them. Each goes to ~/.cache/lucent/react-native-headers/<version>
 * (or $LUCENT_RN_HEADERS/<version>), with a toolchain.json that
 * packages/compiler/test/ui/react-native-headers.ts reads: its host
 * compiles stand in for iOS's (React Native's cxx platform headers) and
 * Android's (the headers as react-android's prefab lays them out, the
 * JDK's JNI headers, and the three NDK headers they include, declared
 * here). They only check: nothing is linked.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REQUIREMENTS } from "../packages/lucent/src/cli/doctor.ts";

/** Where assembled releases go: one directory per version. */
export const headersCache = (): string =>
  process.env.LUCENT_RN_HEADERS ?? path.join(os.homedir(), ".cache/lucent/react-native-headers");

/** What toolchain.json says of a release: absolute paths. */
export interface AssembledRelease {
  version: string;
  /** The react-native package's ReactCommon, ReactAndroid/src/main/jni and build files. */
  reactNative: string;
  /** The third-party libraries' headers. */
  include: string;
  /** The JDK's jni.h and its platform header; none without a JDK. */
  jni?: string;
  /** Declarations of the NDK headers React Native's and Lucent's Android headers include. */
  ndk: string;
  /** The directories react-android's prefab puts on the include path. */
  prefab: string[];
}

function sh(cmd: string, args: string[], cwd?: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 << 20,
  });
}

/** The version a release names: npm's newest match for a minor or a dist-tag. */
function resolve(spec: string): string {
  const found = JSON.parse(sh("npm", ["view", `react-native@${spec}`, "version", "--json"])) as
    | string
    | string[];
  const version = Array.isArray(found) ? found.at(-1) : found;
  if (!version) throw new Error(`no react-native release matches ${spec}`);

  return version;
}

/** The parts of the react-native package a compile reads. */
function fetchReactNative(version: string, into: string): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-rn-"));

  try {
    const tarball = sh("npm", ["pack", `react-native@${version}`, "--silent"], tmp)
      .trim()
      .split("\n")
      .pop()!;
    fs.mkdirSync(into, { recursive: true });
    sh("tar", [
      "-xzf",
      path.join(tmp, tarball),
      "-C",
      into,
      "--strip-components=1",
      "package/package.json",
      "package/ReactCommon",
      "package/ReactAndroid/build.gradle.kts",
      "package/ReactAndroid/src/main/jni",
      "package/gradle/libs.versions.toml",
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** gradle/libs.versions.toml's [versions]. */
function libraryVersions(reactNative: string): Record<string, string> {
  const toml = fs.readFileSync(path.join(reactNative, "gradle/libs.versions.toml"), "utf8");
  const section = /^\[versions\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml)?.[1] ?? "";

  return Object.fromEntries(
    [...section.matchAll(/^(\w+)\s*=\s*"([^"]+)"/gm)].map((m) => [m[1]!, m[2]!]),
  );
}

/** glog 0.3's configured headers: its autoconf answers for a Linux or Android build. */
const GLOG_CONFIG: Record<string, string> = {
  ac_cv_have_unistd_h: "1",
  ac_cv_have_stdint_h: "1",
  ac_cv_have_systypes_h: "1",
  ac_cv_have_inttypes_h: "1",
  ac_cv_have_libgflags: "0",
  ac_cv_have_uint16_t: "1",
  ac_cv_have_u_int16_t: "1",
  ac_cv_have___uint16: "0",
  ac_cv_have___builtin_expect: "1",
  ac_cv_cxx_using_operator: "1",
  ac_google_start_namespace: "namespace google {",
  ac_google_end_namespace: "}",
  ac_google_namespace: "google",
  ac_cv___attribute___noreturn: "__attribute__((noreturn))",
  ac_cv___attribute___noinline: "__attribute__((noinline))",
  ac_cv___attribute___printf_4_5: "__attribute__((__format__(__printf__, 4, 5)))",
};

interface Library {
  /** Its key in libs.versions.toml. */
  key: string;
  repo: string;
  tag(version: string): string;
  /** Its directories of headers, and where they go in the include directory. */
  headers?: [from: string, to: string][];
  /** The files of those directories to take, when not all of them. */
  only?: RegExp;
  configure?(source: string, include: string): void;
}

const LIBRARIES: Library[] = [
  { key: "folly", repo: "facebook/folly", tag: (v) => `v${v}`, headers: [["folly", "folly"]] },
  { key: "fmt", repo: "fmtlib/fmt", tag: (v) => v, headers: [["include/fmt", "fmt"]] },
  // Its headers are among its sources.
  {
    key: "doubleconversion",
    repo: "google/double-conversion",
    tag: (v) => `v${v}`,
    headers: [["src", "double-conversion"]],
    only: /\.h$/,
  },
  {
    key: "fastFloat",
    repo: "fastfloat/fast_float",
    tag: (v) => `v${v}`,
    headers: [["include/fast_float", "fast_float"]],
  },
  {
    key: "glog",
    repo: "google/glog",
    tag: (v) => `v${v}`,
    configure(source, include) {
      const from = path.join(source, "src/glog");
      const to = path.join(include, "glog");
      fs.mkdirSync(to, { recursive: true });

      for (const file of fs.readdirSync(from)) {
        const text = fs.readFileSync(path.join(from, file), "utf8");
        if (file.endsWith(".h")) fs.writeFileSync(path.join(to, file), text);
        else if (file.endsWith(".h.in"))
          fs.writeFileSync(
            path.join(to, file.slice(0, -3)),
            text.replace(/@(\w+)@/g, (all, name: string) => GLOG_CONFIG[name] ?? all),
          );
      }

      const left = fs
        .readdirSync(to)
        .filter((f) => /@\w+@/.test(fs.readFileSync(path.join(to, f), "utf8")));
      if (left.length) throw new Error(`glog's ${left.join(", ")} keep autoconf placeholders`);
    },
  },
  // The Boost libraries the headers include (Folly's: its preprocessor, and
  // the intrusive list the Android color parser's cache uses), with theirs.
  ...[
    "assert",
    "config",
    "core",
    "detail",
    "intrusive",
    "iterator",
    "move",
    "mpl",
    "preprocessor",
    "static_assert",
    "type_traits",
  ].map((name): Library => ({
    key: "boost",
    repo: `boostorg/${name}`,
    tag: (v) => `boost-${v.replaceAll("_", ".")}`,
    headers: [["include/boost", "boost"]],
  })),
  {
    key: "fbjni",
    repo: "facebookincubator/fbjni",
    tag: (v) => `v${v}`,
    headers: [
      ["cxx/fbjni", "fbjni"],
      ["cxx/lyra", "lyra"],
    ],
  },
];

function fetchLibraries(versions: Record<string, string>, include: string): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-rn-deps-"));

  try {
    for (const library of LIBRARIES) {
      const version = versions[library.key];
      if (!version) throw new Error(`gradle/libs.versions.toml names no ${library.key} version`);

      const source = path.join(tmp, library.repo.replace("/", "-"));
      sh("git", [
        "-c",
        "advice.detachedHead=false",
        "clone",
        "--quiet",
        "--depth",
        "1",
        "--branch",
        library.tag(version),
        `https://github.com/${library.repo}`,
        source,
      ]);

      for (const [from, to] of library.headers ?? [])
        fs.cpSync(path.join(source, from), path.join(include, to), {
          recursive: true,
          filter: (f) => !library.only || fs.statSync(f).isDirectory() || library.only.test(f),
        });
      library.configure?.(source, include);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** What the NDK's headers declare that React Native's and Lucent's headers use. */
const NDK: Record<string, string> = {
  "android/api-level.h": "#ifndef __ANDROID_API__\n#define __ANDROID_API__ 24\n#endif\n",
  "android/log.h": `typedef enum android_LogPriority {
  ANDROID_LOG_UNKNOWN = 0, ANDROID_LOG_DEFAULT, ANDROID_LOG_VERBOSE, ANDROID_LOG_DEBUG,
  ANDROID_LOG_INFO, ANDROID_LOG_WARN, ANDROID_LOG_ERROR, ANDROID_LOG_FATAL, ANDROID_LOG_SILENT
} android_LogPriority;
#ifdef __cplusplus
extern "C" {
#endif
int __android_log_write(int prio, const char* tag, const char* text);
int __android_log_print(int prio, const char* tag, const char* fmt, ...)
    __attribute__((__format__(printf, 3, 4)));
void __android_log_assert(const char* cond, const char* tag, const char* fmt, ...)
    __attribute__((__noreturn__));
#ifdef __cplusplus
}
#endif
`,
  "sys/system_properties.h": `#define PROP_VALUE_MAX 92
#ifdef __cplusplus
extern "C" {
#endif
int __system_property_get(const char* name, char* value);
#ifdef __cplusplus
}
#endif
`,
};

function writeNdk(into: string): void {
  for (const [file, body] of Object.entries(NDK)) {
    fs.mkdirSync(path.dirname(path.join(into, file)), { recursive: true });
    fs.writeFileSync(
      path.join(into, file),
      `// Declared by scripts/react-native-headers.ts.\n#pragma once\n${body}`,
    );
  }
}

/** The JDK's JNI headers, from JAVA_HOME or the system's JDKs. */
function copyJni(into: string): boolean {
  const homes = [
    process.env.JAVA_HOME,
    ...(fs.existsSync("/usr/lib/jvm")
      ? fs.readdirSync("/usr/lib/jvm").map((d) => path.join("/usr/lib/jvm", d))
      : []),
  ].filter((h): h is string => !!h);
  const home = homes.find((h) => fs.existsSync(path.join(h, "include/jni.h")));
  if (!home) return false;

  fs.cpSync(path.join(home, "include"), into, { recursive: true });
  return true;
}

/**
 * react-android's prefab headers: ReactAndroid/build.gradle.kts maps
 * source directories to include paths (`Pair("src/main/jni/react/jni",
 * "react/jni/")`). A mapped one is linked at its path; one mapped to the
 * root is a directory of its own on the include path.
 */
function prefabLayout(reactNative: string, into: string): string[] {
  const gradle = fs.readFileSync(path.join(reactNative, "ReactAndroid/build.gradle.kts"), "utf8");
  const roots = [into];

  fs.mkdirSync(into, { recursive: true });
  for (const [, from, to] of gradle.matchAll(/Pair\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,?\s*\)/g)) {
    const source = path.resolve(reactNative, "ReactAndroid", from!);
    if (!fs.existsSync(source)) continue;

    if (!to) {
      if (!roots.includes(source)) roots.push(source);
      continue;
    }

    const target = path.join(into, to.replace(/\/$/, ""));
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(source, target);
  }

  return roots;
}

/** Assembles `spec`'s release into the cache, once: its toolchain.json's path. */
export function assemble(spec: string): string {
  const version = resolve(spec);
  const dir = path.join(headersCache(), version);
  const manifest = path.join(dir, "toolchain.json");
  if (fs.existsSync(manifest)) return manifest;

  // Into a fresh directory first: a run that fails leaves no release behind.
  const work = `${dir}.partial`;
  fs.rmSync(work, { recursive: true, force: true });

  const reactNative = path.join(work, "react-native");
  fetchReactNative(version, reactNative);
  fetchLibraries(libraryVersions(reactNative), path.join(work, "include"));
  writeNdk(path.join(work, "ndk"));
  const jni = copyJni(path.join(work, "jni"));
  // Linked from where the release ends up.
  const at = (p: string) => path.join(dir, path.relative(work, p));
  const prefab = prefabLayout(path.join(work, "react-native"), path.join(work, "prefab"));

  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(work, dir);
  // The prefab links point into the directory they were made in.
  relink(path.join(dir, "prefab"), work, dir);

  const release: AssembledRelease = {
    version,
    reactNative: at(reactNative),
    include: at(path.join(work, "include")),
    ...(jni && { jni: at(path.join(work, "jni")) }),
    ndk: at(path.join(work, "ndk")),
    prefab: prefab.map(at),
  };
  fs.writeFileSync(manifest, `${JSON.stringify(release, null, 2)}\n`);

  return manifest;
}

/** Points the links under `dir` that start with `from` at `to` instead. */
function relink(dir: string, from: string, to: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(p);
      if (!target.startsWith(from)) continue;
      fs.unlinkSync(p);
      fs.symlinkSync(to + target.slice(from.length), p);
    } else if (entry.isDirectory()) relink(p, from, to);
  }
}

/** The releases Lucent supports: the window's, and the newest on the prerelease lane. */
export function windowReleases(): string[] {
  const { window, prerelease } = REQUIREMENTS.reactNative;
  return [...window, `~${prerelease}.0-0`];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const specs = args.flatMap((a) => (a === "--window" ? windowReleases() : [a]));
  if (!specs.length) {
    console.error(
      "usage: node scripts/react-native-headers.ts --window | <version|minor|range|dist-tag>…",
    );
    process.exit(2);
  }

  for (const spec of specs) {
    const manifest = assemble(spec);
    const release = JSON.parse(fs.readFileSync(manifest, "utf8")) as AssembledRelease;
    console.log(
      `• React Native ${release.version}: ${path.dirname(manifest)}${release.jni ? "" : " (no JDK: no Android compiles)"}`,
    );
  }
}
