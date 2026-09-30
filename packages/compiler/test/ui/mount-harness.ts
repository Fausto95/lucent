/**
 * Running a component's compiled setup on this Mac: its Lucent modules
 * compiled for iOS, built with a driver that mounts it as a platform host
 * does (Mac Catalyst's UIKit, React Native's prebuilt renderer and
 * Hermes), and run. The driver names the component's namespace
 * REGISTRATION; what it prints is the run's output.
 */
import { spawnSync } from "node:child_process";
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

/** The C sources of the runtime's regular expression engine, compiled apart into `dir` for Mac Catalyst. */
export function quickjsObjects(dir: string): string[] {
  const c = path.join(runtimeDir(), "cpp/third_party/quickjs");

  return fs
    .readdirSync(c)
    .filter((f) => f.endsWith(".c"))
    .map((f) => {
      const object = path.join(dir, `${f}.o`);
      const r = spawnSync(
        "xcrun",
        [
          "clang",
          "-target",
          "arm64-apple-ios15.1-macabi",
          "-isysroot",
          macosSdk(),
          "-std=c11",
          "-O2",
          "-w",
          "-c",
          path.join(c, f),
          "-o",
          object,
        ],
        { encoding: "utf8" },
      );

      expect(r.stderr).toBe("");
      return object;
    });
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
  const objects = quickjsObjects(dir);
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
  const build = spawnSync(
    toolchain!.command,
    [
      ...toolchain!.args,
      "-fobjc-arc",
      "-iframework",
      path.join(support, "System/Library/Frameworks"),
      `-F${path.join(support, "System/Library/Frameworks")}`,
      "-isystem",
      path.join(support, "usr/include"),
      // The app builds Lucent's modules without -Werror.
      "-Wno-unused-variable",
      `-I${path.join(out, "ios")}`,
      main,
      ...generated,
      ...runtime,
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
