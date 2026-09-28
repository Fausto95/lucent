/**
 * A Lucent package's own adapter around a native listener Lucent knows
 * nothing about: promises and subscriptions composed with fromCallback and
 * subscribe (lucent:core). The listener's names are drawn at random on every
 * run, so no table in Lucent can know them.
 *
 * fixtures/listener-adapter holds the package (wlz-pulses) and what an app
 * would install for it: a pod (ios/WLZOrb, with its implementation) and a
 * Maven artifact (android/dev/wlz/orb). "WLZ"/"wlz" is replaced by the
 * run's random prefix everywhere, file names included.
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { cFlags, hostLibs, runtimeSources } from "../../runtime/test/sources.ts";
import {
  compile,
  lucentPackages,
  moduleNameOf,
  projectFiles,
  resolveNative,
  runtimeDir,
  type SdkOptions,
} from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures/listener-adapter");

const prefix = `Z${crypto
  .randomBytes(4)
  .toString("hex")
  .replace(/\d/g, (d) => "QRSTUVWXYZ"[+d]!)
  .toUpperCase()}`;
const lower = prefix.toLowerCase();
const rename = (text: string) => text.replaceAll("WLZ", prefix).replaceAll("wlz", lower);

/** The fixture under this run's names, in a fresh directory. */
function randomized(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-listener-"));

  const copy = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const target = path.join(to, rename(entry.name));

      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        copy(source, target);
      } else {
        fs.writeFileSync(target, rename(fs.readFileSync(source, "utf8")));
      }
    }
  };

  copy(fixture, root);
  return root;
}

/** An app that depends on the package, installed in its node_modules. */
function appWith(root: string): string {
  const app = path.join(root, "app");
  const pkg = `${lower}-pulses`;

  fs.mkdirSync(path.join(app, "node_modules"), { recursive: true });
  fs.writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({ name: "app", dependencies: { [pkg]: "1.0.0" } }),
  );
  fs.symlinkSync(path.join(root, pkg), path.join(app, "node_modules", pkg), "dir");
  return app;
}

function compileFor(platform: "ios" | "android", app: string, sdk: SdkOptions) {
  const r = compile(projectFiles(app), { platforms: [platform], sdk });
  const out = path.join(app, "out");

  for (const [name, text] of r.files) {
    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    fs.writeFileSync(path.join(out, name), text);
  }

  return { r, out: path.join(out, platform) };
}

/** Runs a command off the test's thread; rejects with its output if it fails. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";

    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}):\n${err}${out}`)),
    );
  });
}

const xcode = process.platform === "darwin" && sdkAvailable("ios");
const javac = spawnSync("javac", ["-version"]).status === 0;

describe("a package's adapter around a native listener", () => {
  it("is an ordinary Lucent package, named after itself, whose lucent.json asks for the listener", () => {
    const root = randomized();
    const app = appWith(root);
    const packages = lucentPackages(app);
    const module = projectFiles(app).find((f) => f.endsWith("pulses.lucent.ts"))!;

    expect(packages.map((p) => p.name)).toEqual([`${lower}-pulses`]);
    expect(moduleNameOf(module)).toBe(`${lower}-pulses/pulses`);

    const native = resolveNative(packages);
    expect(JSON.stringify(native)).toContain(`${prefix}Orb`);
    expect(JSON.stringify(native)).toContain(`dev.${lower}:orb`);
  });

  it("names nothing of the fixture in Lucent's own sources", () => {
    const sources = [
      path.join(here, "../src"),
      path.join(here, "../lib"),
      path.join(here, "../../bindgen/src"),
      path.join(runtimeDir(), "cpp"),
    ];
    const names = ["WLZ", "wlz", "PulseListener", "attachPulse", "emitPulses"];
    const found: string[] = [];

    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);

        if (entry.isDirectory()) scan(file);
        else if (names.some((n) => fs.readFileSync(file, "latin1").includes(n))) found.push(file);
      }
    };
    sources.forEach(scan);

    expect(found).toEqual([]);
  });

  // Compiled for the macOS host with the runtime: one clang run per source,
  // in parallel and off the test's thread.
  it.skipIf(!xcode)(
    "settles and cleans up once on iOS, whichever queue the listener reports on",
    async () => {
      const root = randomized();
      const app = appWith(root);
      const pod = path.join(root, "ios", `${prefix}Orb`);
      const { r, out } = compileFor("ios", app, { ios: { includePaths: [pod] } });

      expect(r.diagnostics).toEqual([]);

      const cpp = path.join(runtimeDir(), "cpp");
      const build = path.join(root, "build");
      fs.mkdirSync(build);

      const flags = ["-std=c++20", "-ffp-contract=off", "-g", "-O1", "-Wall", `-I${cpp}`];
      const unit = path.basename([...r.files.keys()].find((f) => f.endsWith(".mm"))!);
      const objc = [path.join(out, unit), path.join(root, "ios/host.mm")];
      const { cxx, c } = runtimeSources(cpp);
      const jobs = [
        ...objc.map((src) => [
          "clang++",
          [...flags, "-fobjc-arc", `-I${out}`, `-I${pod}`, "-x", "objective-c++", "-c", src],
        ]),
        ...cxx
          .filter((src) => !src.includes(`${path.sep}jsi${path.sep}`))
          .map((src) => ["clang++", [...flags, "-c", src]]),
        ...c.map((src) => ["clang", [...cFlags, "-c", src]]),
        ["clang", ["-fobjc-arc", "-Wall", "-c", path.join(pod, `${prefix}Orb.m`)]],
      ] as [string, string[]][];

      const objects = await Promise.all(
        jobs.map(async ([cmd, args], i) => {
          const obj = path.join(build, `${i}.o`);
          await run(cmd, [...args, "-o", obj]);
          return obj;
        }),
      );
      const host = path.join(build, "host");
      await run("clang++", [
        ...objects,
        ...hostLibs,
        "-framework",
        "Foundation",
        "-lpthread",
        "-o",
        host,
      ]);

      expect((await run(host, [])).trim().split("\n")).toEqual([
        // The first pulse; the two after it reach a listener already settled.
        "resolved 1",
        // Every pulse, then the failure; the listener is detached.
        "resolved 1 2 3 4; the orb broke; attached 0",
        // Aborted from the value handler: nothing after, detached.
        "resolved 1 2 3; AbortError; attached 0",
        // Already aborted: the listener is never attached.
        "rejected AbortError: signal is aborted without reason",
      ]);
    },
    600_000,
  );

  it.skipIf(!javac || !sdkAvailable("android"))(
    "compiles for Android against the listener's jar",
    () => {
      const root = randomized();
      const app = appWith(root);
      const java = path.join(root, "android");
      const classes = path.join(root, "classes");
      const sources = fs
        .readdirSync(path.join(java, "dev", lower, "orb"))
        .map((f) => path.join(java, "dev", lower, "orb", f));
      const cc = spawnSync("javac", ["--release", "11", "-d", classes, ...sources], {
        encoding: "utf8",
      });
      expect(cc.stderr).toBe("");

      const jar = path.join(root, "orb.jar");
      spawnSync("jar", ["cf", jar, "-C", classes, "dev"]);
      const classpath = path.join(root, "android-classpath.json");
      fs.writeFileSync(classpath, JSON.stringify({ jars: [jar] }));

      const { r, out } = compileFor("android", app, { android: { classpath } });
      expect(r.diagnostics).toEqual([]);

      // With -Werror, as the NDK build of the app compiles it.
      const ndkRoot = path.join(
        process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk"),
        "ndk",
      );
      const ndk = fs.existsSync(ndkRoot) ? fs.readdirSync(ndkRoot).sort().pop() : undefined;
      if (!ndk) return;

      const prebuilt = path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt");
      const clang = path.join(prebuilt, fs.readdirSync(prebuilt)[0]!, "bin/clang++");
      const unit = [...r.files.keys()].find(
        (f) => f.startsWith("android/m_") && f.endsWith(".cpp"),
      )!;
      const check = spawnSync(
        clang,
        [
          "--target=aarch64-linux-android24",
          "-std=c++20",
          "-fsyntax-only",
          "-Werror",
          "-Wno-gnu-statement-expression",
          "-Wno-unused-label",
          "-Wno-parentheses-equality",
          "-Wno-comma",
          `-I${path.join(runtimeDir(), "cpp")}`,
          `-I${out}`,
          path.join(out, path.basename(unit)),
        ],
        { encoding: "utf8" },
      );
      expect(check.stderr).toBe("");
    },
    180_000,
  );
});
