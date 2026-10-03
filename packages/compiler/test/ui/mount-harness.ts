/**
 * Running a component's compiled setup on this Mac: its Lucent modules
 * compiled for iOS, built with a driver that mounts it as a platform host
 * does (Mac Catalyst's UIKit, React Native's prebuilt renderer and
 * Hermes), and run. The driver names the component's namespace
 * REGISTRATION; what it prints is the run's output.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vite-plus/test";
import { compile, runtimeDir, sdkAvailable } from "../../src/index.ts";
import { catalystToolchain } from "./react-native-headers.ts";

const toolchain = catalystToolchain();

/** Whether this machine runs mounted setups: arm64 macOS with the iOS SDK and the prebuilt renderer. */
export const canRunMounted = !!toolchain && process.platform === "darwin" && sdkAvailable("ios");

export const macosSdk = () =>
  spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" }).stdout.trim();

/**
 * Compiles each of `jobs` (a compiler and its arguments, writing `object`)
 * side by side, one per core: what they printed, together.
 */
function compileAll(jobs: { cmd: string; args: string[]; object: string }[]): string {
  if (!jobs.length) return "";

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-catalyst-build-"));
  const q = (a: string) => `'${a.replace(/'/g, "'\\''")}'`;
  const cores = os.availableParallelism();
  const lines = jobs.map(
    (j, i) =>
      `(${[j.cmd, ...j.args, "-o", j.object].map(q).join(" ")}) >${q(path.join(dir, `${i}.log`))} 2>&1 &${(i + 1) % cores === 0 ? "\nwait" : ""}`,
  );

  fs.writeFileSync(path.join(dir, "build.sh"), `${lines.join("\n")}\nwait\n`);
  spawnSync("sh", [path.join(dir, "build.sh")]);

  const printed = jobs.map((_, i) => fs.readFileSync(path.join(dir, `${i}.log`), "utf8")).join("");

  fs.rmSync(dir, { recursive: true, force: true });
  return printed;
}

/** `args` without what only linking reads (-Wl, -framework): unused, they warn when compiling. */
function compileOnly(args: readonly string[]): string[] {
  return args.filter(
    (a, i) => !a.startsWith("-Wl,") && a !== "-framework" && args[i - 1] !== "-framework",
  );
}

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
  include: string,
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
          args: [...compileOnly(toolchain!.args), ...args, ...(own ? [`-I${include}`] : [])].concat(
            ["-c", source],
          ),
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
 * Compiles `files` (the modules of package `@acme/app`) under
 * LUCENT_VIEWS=fabric, builds them with `driver` (a file next to this one)
 * and runs the result: its output's lines.
 */
export function runMounted(files: Record<string, string>, driver: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-mount-run-"));
  const previous = process.env.LUCENT_VIEWS;

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  process.env.LUCENT_VIEWS = "fabric";

  const result = (() => {
    try {
      return compile(
        Object.keys(files).map((f) => path.join(dir, f)),
        { platforms: ["ios"] },
      );
    } finally {
      if (previous === undefined) delete process.env.LUCENT_VIEWS;
      else process.env.LUCENT_VIEWS = previous;
    }
  })();

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
      .readFileSync(path.join(import.meta.dirname, driver), "utf8")
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
    [main, ...generated, ...runtime, ...quickjsSources()],
    path.join(out, "ios"),
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

  const run = spawnSync(binary, [], { encoding: "utf8", timeout: 60_000 });

  if (run.status !== 0)
    throw new Error(`the mount run exited with ${run.status}:\n${run.stdout}${run.stderr}`);

  fs.rmSync(dir, { recursive: true, force: true });

  return run.stdout.trim().split("\n");
}
