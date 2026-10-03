/**
 * A native library Lucent has never seen, bound and run by rule (T28): its
 * module, class, callback, generic and async names are drawn at random on
 * every run, so nothing in Lucent can know them.
 *
 * fixtures/unknown-library holds the library and the app code using it.
 * "QXN"/"qxn" is replaced by the run's random prefix everywhere, file and
 * directory names included.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { classpathFile } from "../../bindgen/test/java-fixtures.ts";
import { compileKotlin, kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { android } from "./android-harness.ts";
import { jdk, jvmRun } from "./jni-harness.ts";
import {
  compileErrors,
  compiles,
  hostRun,
  iosProgram,
  moduleDir,
  prepareSwiftModules,
  type SwiftFixture,
  xcode,
} from "./swift-harness.ts";
import { canRunMounted, runMounted } from "./ui/mount-harness.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures/unknown-library");

/** A prefix nothing in Lucent can name: a letter, then four random bytes as letters. */
const prefix = `Z${crypto
  .randomBytes(4)
  .toString("hex")
  .replace(/\d/g, (d) => "QRSTUVWXYZ"[+d]!)
  .toUpperCase()}`;
const lower = prefix.toLowerCase();
const rename = (text: string) => text.replaceAll("QXN", prefix).replaceAll("qxn", lower);

/** The fixture under this run's names, in a fresh directory. */
function randomized(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-unknown-"));

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

const root = randomized();

/** The library's Swift modules, its dependency first. */
const modules: SwiftFixture[] = ["Core", "Kit"].map((m) => ({
  name: `${prefix}${m}`,
  source: path.join(root, "ios", `${prefix}${m}`, `${prefix}${m}.swift`),
}));

const use = fs.readFileSync(path.join(root, "ios/use.ios.lucent.ts"), "utf8");

describe.skipIf(!xcode)("an unknown library on iOS", () => {
  beforeAll(() => prepareSwiftModules(modules), 300_000);

  it("binds its classes, callback, generic and async method by rule, and runs them", () => {
    const p = iosProgram(use, modules);

    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({
      status: 0,
      stdout: `gauge g at 3.5 | 3 3.5 | 3.5 box | 7.0 ${lower} | Error\n`,
    });
  }, 600_000);

  it("says to import the module of a type only named in the library's signatures", () => {
    const unimported = use
      .replace(/^import type .*Core";\n/m, "")
      .replace(`const unit: ${prefix}Unit =`, "const unit =");
    const p = iosProgram(unimported, modules);

    expect(p.r.diagnostics).toEqual([
      expect.objectContaining({
        code: "LUCENT9001",
        message: expect.stringContaining(
          `${prefix}Unit is lucent:ios/${prefix}Core's, which no file imports: only its name is known`,
        ),
        fix: `import from lucent:ios/${prefix}Core (a type import is enough) to use ${prefix}Unit's members`,
      }),
    ]);
  }, 600_000);
});

/** The library's next version, from the same place the first was installed: a pod update. */
const next: SwiftFixture = {
  name: `${prefix}Kit`,
  source: path.join(root, "ios", `${prefix}Kit-v2`, `${prefix}Kit.swift`),
};

/** Where the app's build finds the library: one directory, whichever version is in it. */
const installed = path.join(root, "installed");

function install(version: SwiftFixture): string[] {
  const all = [modules[0]!, version];

  fs.rmSync(installed, { recursive: true, force: true });
  fs.cpSync(moduleDir(version, all), installed, { recursive: true });
  return [moduleDir(modules[0]!, all), installed];
}

describe.skipIf(!xcode)("an unknown library's next version on iOS", () => {
  beforeAll(() => {
    prepareSwiftModules(modules);
    prepareSwiftModules([modules[0]!, next]);
  }, 300_000);

  /** Each shim the glue calls, by its symbol: named after what it binds, not after the build. */
  const shims = (p: { shims: string }) => new Set(p.shims.split(/(?=@_cdecl)/).slice(1));

  /** The app's code, updated for the next version: it moves the gauge where it bumped it. */
  const moved = use.replaceAll(`${lower}Bump(`, `${lower}Move(`);

  it("binds the version installed now, in the same process, as lucent dev rebuilds", () => {
    const first = iosProgram(use, modules, install(modules[1]!));
    expect(first.r.diagnostics).toEqual([]);

    const p = iosProgram(moved, [modules[0]!, next], install(next));
    expect(p.r.diagnostics).toEqual([]);

    // Only the changed member's shim changed: the rest keep their names and bodies.
    const before = shims(first);
    const after = shims(p);
    expect([...before].filter((s) => !after.has(s))).toEqual([
      expect.stringContaining(`.${lower}Bump(`),
    ]);
    expect([...after].filter((s) => !before.has(s))).toEqual([
      expect.stringContaining(`.${lower}Move(by:`),
    ]);

    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({
      status: 0,
      stdout: `gauge g at 3.5 | 3 3.5 | 3.5 box | 7.0 ${lower} | Error\n`,
    });
  }, 600_000);

  it("says which library and version a missing member's type is from", () => {
    const p = iosProgram(use, [modules[0]!, next], install(next));

    // One for each call of the method the new version renamed.
    expect(p.r.diagnostics).toEqual(
      Array.from({ length: 2 }, () =>
        expect.objectContaining({
          code: "LUCENT9001",
          message: expect.stringContaining(
            `${prefix}Gauge is lucent:ios/${prefix}Kit's, from swift-module:${prefix}Kit as installed`,
          ),
          fix: `use what ${prefix}Gauge declares in this version of ${prefix}Kit, or install a version that has ${lower}Bump`,
        }),
      ),
    );
  }, 600_000);
});

/** The Kotlin toolchain, with the coroutines the library's suspend function uses. */
const kotlin = kotlinToolchain();
const coroutines = kotlin && path.join(kotlin.lib, "kotlinx-coroutines-core-jvm.jar");
const jvm =
  !!kotlin && !!jdk && !!coroutines && fs.existsSync(coroutines) && sdkAvailable("android");

describe.skipIf(!jvm)("an unknown library on Android", () => {
  /** The app's classpath: the Kotlin runtime, the library, and its dependency in a jar of its own. */
  let jars: string[] = [];

  beforeAll(async () => {
    const dir = path.join(root, "jars");
    const stdlib = path.join(kotlin!.lib, "kotlin-stdlib.jar");
    const sources = (m: string) =>
      fs.readdirSync(path.join(root, "android", m)).map((f) => path.join(root, "android", m, f));

    fs.mkdirSync(dir);
    const core = await compileKotlin(kotlin!, sources(`${lower}core`), path.join(dir, "core.jar"));
    const kit = await compileKotlin(kotlin!, sources(`${lower}kit`), path.join(dir, "kit.jar"), {
      classpath: [core, coroutines!].join(":"),
    });

    jars = [stdlib, coroutines!, core, kit];
  }, 300_000);

  it("binds the same shapes by rule, and runs them on a JVM through the JNI glue", () => {
    const classpath = classpathFile(path.join(root, "jars/android-classpath.json"), jars);
    const p = android(fs.readFileSync(path.join(root, "android/use.android.lucent.ts"), "utf8"), {
      android: { classpath },
    });

    expect(p.r.diagnostics).toEqual([]);
    expect(jvmRun(p.r, p.dir, jars, kotlin!)).toEqual({
      status: 0,
      stdout: `gauge g at 3.5 | 3 3.5 | 3.5 box | 7.0 ${lower} | Error\n`,
      stderr: "",
    });
  }, 600_000);
});

/** The library's view, a component of the app's: a dial whose turns become events. */
const dial = Object.fromEntries(
  ["dial.lucent.ts", "dial.ios.lucent.tsx", "dial.android.lucent.tsx"].map((f) => [
    f,
    fs.readFileSync(path.join(root, "ios", f), "utf8"),
  ]),
);

describe("an unknown library's view on iOS", () => {
  it.skipIf(!canRunMounted)(
    "mounts as a component: props, events and commands by rule, released with its mount",
    () => {
      const dials = path.join(root, "ios", `${prefix}Dials`);

      expect(
        runMounted(dial, path.join(root, "ios/dial_run.mm"), {
          includePaths: [dials],
          sources: [path.join(dials, `${prefix}Dials.m`)],
        }),
      ).toEqual([
        "mounted: level 2",
        "committed: level 5",
        "turned: level 6, sent 6",
        "command: answer 3 = 6",
        "disposed: block gone",
        "released: native references all released, dial gone",
      ]);
    },
    600_000,
  );
});
