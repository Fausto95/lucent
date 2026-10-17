/**
 * Running a component's compiled setup on this Mac: its Lucent modules
 * compiled for iOS, built with a driver that mounts it as a platform host
 * does (Mac Catalyst's UIKit, React Native's prebuilt renderer and
 * Hermes), and run. The driver names the component's namespace
 * REGISTRATION; what it prints is the run's output.
 */
import {
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
  spawnSync,
} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vite-plus/test";
import { compile, runtimeDir, sdkAvailable } from "../../src/index.ts";
import type { Platform } from "../../src/sdk/schema.ts";
import { catalystToolchain } from "./react-native-headers.ts";
import { compileAll, compileOnly } from "../parallel-build.ts";

const toolchain = catalystToolchain();

/** Whether this machine runs mounted setups: arm64 macOS with the iOS SDK and the prebuilt renderer. */
export const canRunMounted = !!toolchain && process.platform === "darwin" && sdkAvailable("ios");

export const macosSdk = () =>
  spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" }).stdout.trim();

/** What the runtime's sources include: a change to any of them rebuilds its objects. */
function runtimeHeaders(): string[] {
  const cpp = path.join(runtimeDir(), "cpp");
  const walk = (d: string): string[] =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? walk(path.join(d, e.name))
          : e.name.endsWith(".h")
            ? [path.join(d, e.name)]
            : [],
      );

  return walk(cpp).sort();
}

/**
 * Objects of `sources` for Mac Catalyst, compiled side by side with `args`.
 * The runtime's (not React Native's glue) are built once per test run and shared by the runs that
 * build them with the same arguments (keyed by their contents, the
 * runtime's headers and the arguments; published by rename); `program`'s
 * own sources, with `include` (its generated headers) too, into `dir`.
 */
export function catalystObjects(
  dir: string,
  args: string[],
  sources: string[],
  include: string | string[],
): string[] {
  // The runtime itself; React Native's glue (rn/) depends on the program's generated headers.
  const shareable = ["lucent", "third_party"].map(
    (d) => path.join(runtimeDir(), "cpp", d) + path.sep,
  );
  const headers = crypto.createHash("sha256");

  for (const h of runtimeHeaders()) headers.update(h).update(fs.readFileSync(h));
  headers.update(JSON.stringify(args));

  const shared = path.join(os.tmpdir(), "lucent-catalyst-objects");
  const key = headers.digest("hex");
  const jobs: { cmd: string; args: string[]; object: string; published?: string }[] = [];

  fs.mkdirSync(shared, { recursive: true });

  const objects = sources.map((source, i) => {
    const own = !shareable.some((d) => source.startsWith(d));
    // The regular expression engine is C, as the podspec builds it.
    const compile = source.endsWith(".c")
      ? {
          cmd: "xcrun",
          args: ["clang", "-target", "arm64-apple-ios15.1-macabi", "-isysroot", macosSdk()].concat(
            "-std=c11",
            "-O2",
            "-w",
            "-c",
            source,
          ),
        }
      : {
          cmd: toolchain!.command,
          args: [
            ...compileOnly(toolchain!.args),
            ...args,
            ...(own ? [include].flat().map((d) => `-I${d}`) : []),
          ]
            // A library's Objective-C (.m), as its pod builds it: no C++ standard.
            .filter((a) => !(source.endsWith(".m") && a.startsWith("-std=")))
            .concat(["-c", source]),
        };

    if (own) {
      const object = path.join(dir, `${i}_${path.basename(source)}.o`);

      jobs.push({ ...compile, object });
      return object;
    }

    const hash = crypto
      .createHash("sha256")
      .update(key)
      .update(source)
      .update(fs.readFileSync(source));
    const published = path.join(shared, `${hash.digest("hex").slice(0, 20)}.o`);

    if (!fs.existsSync(published))
      jobs.push({ ...compile, object: `${published}.${process.pid}.${i}`, published });

    return published;
  });

  expect(compileAll(jobs)).toBe("");

  for (const j of jobs) if (j.published) fs.renameSync(j.object, j.published);

  return objects;
}

/** The C sources of the runtime's regular expression engine, for Mac Catalyst. */
export function quickjsSources(): string[] {
  const c = path.join(runtimeDir(), "cpp/third_party/quickjs");

  return fs
    .readdirSync(c)
    .filter((f) => f.endsWith(".c"))
    .map((f) => path.join(c, f));
}

/**
 * A native library the modules use: where its headers are, and its sources
 * to build in; and the platforms whose libraries only their own build
 * resolves (`deferred`: their code is untyped here, as in a build for iOS
 * alone).
 */
export interface MountedLibrary {
  includePaths: string[];
  sources: string[];
  deferred?: Platform[];
}

/**
 * Compiles `files` (the modules of package `@acme/app`), builds them with `driver` (a file next to this one,
 * or a path) and `library`, and runs the result: its output's lines.
 */
export function runMounted(
  files: Record<string, string>,
  driver: string,
  library?: MountedLibrary,
): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-mount-run-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const result = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    {
      platforms: ["ios"],
      ...(library ? { sdk: { ios: { includePaths: library.includePaths } } } : {}),
      ...(library?.deferred ? { deferred: library.deferred } : {}),
    },
  );

  expect(result.diagnostics).toEqual([]);

  const out = path.join(dir, "out");
  for (const [f, text] of result.files) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), text);
  }

  const registration = result.components![0]!.registration;
  const main = path.join(out, "ios/driver.mm");

  fs.writeFileSync(
    main,
    fs
      .readFileSync(path.resolve(import.meta.dirname, driver), "utf8")
      .replaceAll("REGISTRATION", registration),
  );

  // The runtime (its regular expressions' C engine compiled apart), the module, its views.
  const cpp = path.join(runtimeDir(), "cpp");
  const runtime = [
    ...fs
      .readdirSync(path.join(cpp, "lucent"))
      .filter((f) => f.endsWith(".cpp"))
      .map((f) => path.join(cpp, "lucent", f)),
    path.join(cpp, "lucent/platform/ios.mm"),
    path.join(cpp, "lucent/platform/ios_ui.mm"),
    path.join(cpp, "lucent/platform/ios_layout.mm"),
    path.join(cpp, "lucent/platform/ios_debug.mm"),
  ];
  const generated = [...result.files.keys()]
    .filter((f) => /\.(cpp|mm)$/.test(f))
    .filter((f) => !/lucent_(bindings|identity)\.cpp$/.test(f))
    // The driver is the host here: not React Native's view class.
    .filter((f) => !f.endsWith("ComponentView.mm"))
    .map((f) => path.join(out, f));

  // Mac Catalyst's UIKit lives in the macOS SDK's iOS support.
  const support = path.join(macosSdk(), "System/iOSSupport");

  const binary = path.join(dir, "mount_run");
  const args = [
    "-fobjc-arc",
    "-iframework",
    path.join(support, "System/Library/Frameworks"),
    `-F${path.join(support, "System/Library/Frameworks")}`,
    "-isystem",
    path.join(support, "usr/include"),
    // The app builds Lucent's modules without -Werror.
    "-Wno-unused-variable",
  ];
  const objects = catalystObjects(
    dir,
    args,
    [main, ...generated, ...(library?.sources ?? []), ...runtime, ...quickjsSources()],
    [path.join(out, "ios"), ...(library?.includePaths ?? [])],
  );
  const build = spawnSync(
    toolchain!.command,
    [
      ...toolchain!.args,
      ...args,
      ...objects,
      "-framework",
      "UIKit",
      "-framework",
      "Foundation",
      "-framework",
      "CoreFoundation",
      "-framework",
      "CoreGraphics",
      "-o",
      binary,
    ],
    { encoding: "utf8" },
  );

  expect(build.stderr).toBe("");

  const run = runProgram(binary);

  if (run.status !== 0) throw new Error(`the mount run failed: ${run.failure}`);

  fs.rmSync(dir, { recursive: true, force: true });

  return run.stdout.trim().split("\n");
}

/** A run of a program, and what its failure says ("" when it exited with 0). */
export type ProgramRun = SpawnSyncReturns<string> & { failure: string };

/**
 * Runs a program a run test built (60 s at most): what it printed, and
 * what its failure says, for the test's message: its status, or the signal
 * that ended it and the faulting thread of the crash report macOS wrote.
 */
export function runProgram(
  binary: string,
  args: string[] = [],
  opts: Partial<SpawnSyncOptionsWithStringEncoding> = {},
): ProgramRun {
  const started = Date.now();
  const run = spawnSync(binary, args, { timeout: 60_000, ...opts, encoding: "utf8" });
  if (run.status === 0) return { ...run, failure: "" };

  const how = run.error
    ? `${run.error.message}${run.signal ? ` (${run.signal})` : ""}`
    : run.signal
      ? `ended by ${run.signal}`
      : `exited with ${run.status}`;
  const report = run.signal && !run.error ? crashReport(path.basename(binary), started) : undefined;

  return {
    ...run,
    failure: [`${how}`, report, `stdout:\n${run.stdout}`, `stderr:\n${run.stderr}`]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * The faulting thread of the crash report macOS wrote for `name` since
 * `since`, waiting a few seconds for ReportCrash; none when it wrote none.
 */
function crashReport(name: string, since: number): string | undefined {
  const dir = path.join(os.homedir(), "Library/Logs/DiagnosticReports");
  const wait = new Int32Array(new SharedArrayBuffer(4));

  for (let tries = 0; tries < 20; tries++) {
    const found = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.startsWith(`${name}-`) && f.endsWith(".ips"))
          .map((f) => path.join(dir, f))
          .filter((f) => fs.statSync(f).mtimeMs >= since - 1000)
      : [];

    if (found.length) {
      try {
        // An .ips report is a line of JSON, its header, then the report's JSON.
        const text = fs.readFileSync(found.sort().at(-1)!, "utf8");
        const report = JSON.parse(text.slice(text.indexOf("\n") + 1)) as {
          exception?: { type?: string; signal?: string };
          faultingThread?: number;
          threads?: { frames?: { imageIndex?: number; imageOffset?: number; symbol?: string }[] }[];
          usedImages?: { name?: string }[];
        };
        const frames = report.threads?.[report.faultingThread ?? 0]?.frames ?? [];

        return [
          `crash report: ${report.exception?.type ?? "?"} (${report.exception?.signal ?? "?"}), the faulting thread:`,
          ...frames
            .slice(0, 24)
            .map(
              (f) =>
                `  ${report.usedImages?.[f.imageIndex ?? -1]?.name ?? "?"} ${f.symbol ?? `+0x${(f.imageOffset ?? 0).toString(16)}`}`,
            ),
        ].join("\n");
      } catch (e) {
        return `crash report ${found.at(-1)}: unreadable (${(e as Error).message})`;
      }
    }
    Atomics.wait(wait, 0, 0, 500);
  }

  return undefined;
}
