/**
 * Building components whose bodies are SwiftUI or Compose, and checking
 * what they generate with the real compilers: the Swift type-checks
 * against the iOS SDK, the Kotlin compiles with the Compose compiler
 * plugin against Compose's libraries, and the C++ glue compiles with the
 * runtime. Each check answers what its compiler said: empty when all
 * compiled, undefined when this machine lacks the compiler.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kotlinToolchain } from "../../../bindgen/test/kotlin-toolchain.ts";
import { compile, type CompileResult, runtimeDir, sdkAvailable } from "../../src/index.ts";
import { composeArtifacts, kotlinClasspath } from "./compose-artifacts.ts";
import { androidToolchain, compileErrors } from "./react-native-headers.ts";
import { runKotlinc } from "../../../bindgen/test/jvm-tools.ts";

export const ios = process.platform === "darwin" && sdkAvailable("ios");

export const android = sdkAvailable("android");

/**
 * Whether kotlinErrors and androidGlueErrors can check Compose content
 * here: kotlinc, Compose's libraries in Gradle's cache (an app build with
 * Compose content downloads them), and the NDK with React Native's
 * headers Gradle unpacked.
 */
export const composeCompiles = (): boolean =>
  android && !!kotlinToolchain() && !!composeClasspath() && !!androidToolchain();

export interface Built {
  readonly dir: string;
  readonly result: CompileResult;
}

/** `files` in a package `@acme/app`, compiled for `platform` with views on. */
export function build(files: Record<string, string>, platform: "ios" | "android"): Built {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lucent-${platform}-content-`));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const result = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: [platform] },
  );

  // LUCENT_TEST_DUMP=<dir>: what each build generated, to read by hand.
  const dump = process.env.LUCENT_TEST_DUMP;

  if (dump) writeOut({ dir: path.join(dump, path.basename(dir)), result });

  return { dir, result };
}

/** Each diagnostic as `CODE message`. */
export const diagnostics = (r: CompileResult) => r.diagnostics.map((d) => `${d.code} ${d.message}`);

/** The generated file whose name `pattern` matches, or "". */
export function generated(r: CompileResult, pattern: RegExp): string {
  const all = [...r.files, ...(r.kotlin ?? [])];

  return all.find(([name]) => pattern.test(name))?.[1] ?? "";
}

function writeOut(built: Built): string {
  const out = path.join(built.dir, "out");

  for (const [f, text] of [...built.result.files, ...(built.result.kotlin ?? [])]) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), text);
  }

  return out;
}

/**
 * The Swift type-checked for the iOS simulator (warnings as errors, from
 * iOS 15.1), then the module glue compiled with the runtime.
 */
export function swiftErrors(built: Built): string | undefined {
  if (!ios) return undefined;

  const out = writeOut(built);
  const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
    encoding: "utf8",
  }).stdout.trim();
  const target = "arm64-apple-ios15.1-simulator";
  const files = [...built.result.files.keys()];
  const swift = files.filter((f) => f.endsWith(".swift")).map((f) => path.join(out, f));
  const swiftc = spawnSync(
    "xcrun",
    [
      "swiftc",
      "-typecheck",
      "-parse-as-library",
      "-warnings-as-errors",
      "-swift-version",
      "5",
      "-target",
      target,
      "-sdk",
      sdk,
      ...swift,
    ],
    { encoding: "utf8" },
  );

  if (swiftc.status !== 0) return `swiftc:\n${swiftc.stderr}`;

  const glue = files.filter((f) => /^ios\/m_[^/]+\.mm$/.test(f)).map((f) => path.join(out, f));

  return glue
    .map((file) => {
      const clang = spawnSync(
        "xcrun",
        [
          "--sdk",
          "iphonesimulator",
          "clang++",
          "-std=c++20",
          "-ffp-contract=off",
          "-fobjc-arc",
          "-Werror",
          "-Wno-gnu-statement-expression",
          "-Wno-unused-label",
          "-Wno-parentheses-equality",
          "-Wno-comma",
          "-fsyntax-only",
          "-target",
          target,
          `-I${path.join(runtimeDir(), "cpp")}`,
          `-I${path.join(out, "ios")}`,
          "-x",
          "objective-c++",
          file,
        ],
        { encoding: "utf8" },
      );

      return clang.status === 0 ? "" : `${file}:\n${clang.stderr}`;
    })
    .join("");
}

/** The generated Kotlin compiled with the Compose compiler plugin, warnings as errors. */
export function kotlinErrors(built: Built): string | undefined {
  const kotlin = kotlinToolchain();
  const jars = kotlin && composeClasspath();

  if (!kotlin || !jars) return undefined;

  const out = writeOut(built);
  // With the runtime's host of Compose content, which the generated host object calls.
  const host = path.join(runtimeDir(), "native/android/src/compose/java");
  const runtime = fs
    .readdirSync(host, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".kt"))
    .map((f) => path.join(host, f));
  const sources = [
    ...[...(built.result.kotlin?.keys() ?? [])]
      .filter((f) => f.startsWith("dev/lucent/compose/"))
      .map((f) => path.join(out, f)),
    ...runtime,
  ];
  const kotlinc = runKotlinc(kotlin, [
    "-jvm-target",
    "11",
    "-Werror",
    `-Xplugin=${path.join(kotlin.lib, "compose-compiler-plugin.jar")}`,
    "-cp",
    jars.join(path.delimiter),
    ...sources,
    "-d",
    path.join(built.dir, "content.jar"),
  ]);

  return kotlinc.status === 0 && !kotlinc.stderr ? "" : `kotlinc:\n${kotlinc.stderr}`;
}

/** The Android glue compiled with the NDK against React Native's headers. */
export function androidGlueErrors(built: Built): string | undefined {
  const toolchain = androidToolchain();

  if (!toolchain) return undefined;

  const out = writeOut(built);
  const sources = [...built.result.files.keys()]
    .filter((f) => f.startsWith("android/") && f.endsWith(".cpp"))
    .filter((f) => !f.endsWith("lucent_identity.cpp"))
    .map((f) => path.join(out, f));

  return compileErrors(
    {
      command: toolchain.command,
      args: [
        ...toolchain.args,
        "-Wno-unused-variable",
        `-I${path.join(out, "android")}`,
        `-I${path.join(runtimeDir(), "native/android/include")}`,
      ],
    },
    path.join(out, "android"),
    sources,
  );
}

let classpath: string[] | undefined | null = null;

/**
 * The classpath Compose content compiles against, from Gradle's cache on
 * this machine (an app build downloads it): android.jar, the Compose
 * release's libraries and what they need. Undefined when any is missing.
 * Made once per test file.
 */
export function composeClasspath(): string[] | undefined {
  if (classpath !== null) return classpath;

  const artifacts = composeArtifacts();

  classpath =
    "missing" in artifacts
      ? undefined
      : kotlinClasspath(
          artifacts,
          fs.mkdtempSync(path.join(os.tmpdir(), "lucent-compose-classpath-")),
        );

  return classpath;
}
