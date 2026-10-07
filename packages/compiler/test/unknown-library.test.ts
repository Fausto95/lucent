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
import { androidJars, sdkAvailable } from "@lucent-lang/bindgen";
import { classpathFile } from "../../bindgen/test/java-fixtures.ts";
import { compileKotlin, kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { android } from "./android-harness.ts";
import { compile, type SdkOptions } from "../src/index.ts";
import { glueErrors, jdk, jvmRun } from "./jni-harness.ts";
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

  /** What to do about a member Lucent does not bind: call it through code of the app's own. */
  const wrap =
    "wrap it in Swift of your own whose types Lucent binds, in a local pod the app depends on";

  /** The library called from a run() whose body is `body`. */
  const calling = (body: string) =>
    `import { ${prefix}Gauge } from "lucent:ios/${prefix}Kit";

export async function run(): Promise<string> {
  const gauge = new ${prefix}Gauge("g", 1);
  ${body}
  return "";
}
`;

  it("names a member it does not bind, why, and the way around it", () => {
    const skipped = iosProgram(calling(`gauge.${lower}Range(1);`), modules);
    expect(skipped.r.diagnostics).toEqual([
      expect.objectContaining({
        code: "LUCENT9001",
        message: expect.stringContaining(
          `${prefix}Gauge.${lower}Range(_:) is in swift-module:${prefix}Kit, but Lucent does not bind it: Swift: CustomStringConvertible.`,
        ),
        fix: wrap,
      }),
    ]);

    const refused = iosProgram(calling(`gauge.${lower}Watcher();`), modules);
    expect(refused.r.diagnostics).toEqual([
      expect.objectContaining({
        code: "LUCENT2002",
        message: expect.stringMatching(
          new RegExp(
            `^${prefix}Gauge\\.${lower}Watcher: .* \\(swift:\\S+ in swift-module:${prefix}Kit\\)$`,
          ),
        ),
        fix: wrap,
      }),
    ]);
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
  // Each up to its function's end: what follows the last one (a proxy class) is no shim, and
  // which shim is last depends on the names, drawn at random.
  const shims = (p: { shims: string }) =>
    new Set(
      p.shims
        .split(/(?=@_cdecl)/)
        .slice(1)
        .map((s) => s.slice(0, s.indexOf("\n}\n") + 3)),
    );

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

/** The library's view, a component of the app's: a dial whose turns become events. */
const dial = Object.fromEntries(
  ["dial.lucent.ts", "dial.ios.lucent.tsx", "dial.android.lucent.tsx"].map((f) => [
    f,
    fs.readFileSync(path.join(root, "dial", f), "utf8"),
  ]),
);

/** The dial again, written as JSX (T48): its attributes and construction by rule. */
const dialJsx = Object.fromEntries(
  ["dial-jsx.lucent.ts", "dial-jsx.ios.lucent.tsx", "dial-jsx.android.lucent.tsx"].map((f) => [
    f,
    fs.readFileSync(path.join(root, "dial-jsx", f), "utf8"),
  ]),
);

/** A component's files compiled for `platform`, in a fresh app. */
function compiledViews(
  files: Record<string, string>,
  platform: "ios" | "android",
  sdk: SdkOptions,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-unknown-views-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);

  try {
    const r = compile(
      Object.keys(files).map((f) => path.join(dir, f)),
      { platforms: [platform], sdk, ...(platform === "ios" ? { deferred: ["android"] } : {}) },
    );
    return { r, dir };
  } finally {
  }
}

/** Where the iOS dial's module is: its header and module map. */
const dials = path.join(root, "ios", `${prefix}Dials`);

/** The Kotlin toolchain, with the coroutines the library's suspend function uses. */
const kotlin = kotlinToolchain();
const coroutines = kotlin && path.join(kotlin.lib, "kotlinx-coroutines-core-jvm.jar");
const jvm =
  !!kotlin && !!jdk && !!coroutines && fs.existsSync(coroutines) && sdkAvailable("android");

describe.skipIf(!jvm)("an unknown library on Android", () => {
  /** The app's classpath: the Kotlin runtime, the library, and its dependency in a jar of its own. */
  let jars: string[] = [];

  /** The library's view, in a jar of its own: built against android.jar. */
  let viewJar = "";

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

    viewJar = await compileKotlin(kotlin!, sources(`${lower}dials`), path.join(dir, "dials.jar"), {
      classpath: androidJars()![0]!,
    });
  }, 300_000);

  it("binds the same shapes by rule, and runs them on a JVM through the JNI glue", () => {
    const classpath = classpathFile(path.join(root, "jars/android-classpath.json"), jars);
    const p = android(fs.readFileSync(path.join(root, "android/use.android.lucent.ts"), "utf8"), {
      android: { classpath },
    });

    expect(p.r.diagnostics).toEqual([]);
    expect(jvmRun(p.r, p.dir, jars, kotlin!)).toEqual({
      status: 0,
      stdout: `gauge g at 3.5 | 3 3.5 | 3.5 box | 7.0 ${lower} | Error | 3 -3 3.5 -3.5 | 4.5 7\n`,
      stderr: "",
    });
  }, 600_000);

  // Mounting a view needs Android itself: the component is bound by rule, and its glue compiles.
  it("binds its view subclass as a component, whose glue compiles", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-unknown-dial-"));
    const classpath = classpathFile(path.join(dir, "android-classpath.json"), [
      path.join(kotlin!.lib, "kotlin-stdlib.jar"),
      viewJar,
    ]);

    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
    for (const [f, text] of Object.entries(dial)) fs.writeFileSync(path.join(dir, f), text);

    try {
      const r = compile(
        Object.keys(dial).map((f) => path.join(dir, f)),
        { platforms: ["android"], sdk: { ios: { includePaths: [dials] }, android: { classpath } } },
      );

      expect(r.diagnostics).toEqual([]);
      expect(r.components).toEqual([expect.objectContaining({ export: "Dial" })]);
      expect(glueErrors(r, dir, "android/m_dial.cpp")).toBe("");
    } finally {
    }
  }, 600_000);

  it("binds its view as JSX: Kotlin properties, functions among them, a listener event by convention", () => {
    const classpath = classpathFile(path.join(root, "jars/views-classpath.json"), [
      path.join(kotlin!.lib, "kotlin-stdlib.jar"),
      viewJar,
    ]);
    const { r, dir } = compiledViews(dialJsx, "android", {
      ios: { includePaths: [dials] },
      android: { classpath },
    });
    const glue = r.files.get("android/m_dial_u2d_jsx.cpp") ?? "";

    expect(r.diagnostics).toEqual([]);
    expect(glue).toContain(`"setOn${prefix}TurnListener"`);
    expect(glue).toContain(`"set${lower[0]!.toUpperCase()}${lower.slice(1)}OnSpin"`);
    expect(glueErrors(r, dir, "android/m_dial_u2d_jsx.cpp")).toBe("");
  }, 600_000);
});

describe("an unknown library's view on iOS", () => {
  it.skipIf(!canRunMounted)(
    "mounts as a component: props, events and commands by rule, released with its mount",
    () => {
      expect(
        runMounted(dial, path.join(root, "ios/dial_run.mm"), {
          includePaths: [dials],
          sources: [path.join(dials, `${prefix}Dials.m`)],
          // As in a build for iOS alone: the Android dial's library is the Android build's.
          deferred: ["android"],
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

  it.skipIf(!canRunMounted)(
    "mounts as JSX: made by rule, its props kept, its block sending events, released with its mount",
    () => {
      expect(
        runMounted(dialJsx, path.join(root, "ios/dial_jsx_run.mm"), {
          includePaths: [dials],
          sources: [path.join(dials, `${prefix}Dials.m`)],
          deferred: ["android"],
        }),
      ).toEqual([
        "mounted: level 2",
        "committed: level 5",
        "turned: level 6, sent 6",
        "released: native references all released, dial gone",
      ]);
    },
    600_000,
  );

  it.skipIf(!xcode)(
    "says to import the module of the superclass whose initializers its view inherits",
    () => {
      const unimported = {
        ...dial,
        "dial.ios.lucent.tsx": dial["dial.ios.lucent.tsx"]!.replace(
          /^\/\/ The superclass's module[^]*?import "lucent:ios\/UIKit";\n/m,
          "",
        ),
      };
      const { r } = compiledViews(unimported, "ios", { ios: { includePaths: [dials] } });

      // Among the errors after it: the dial `new` fails to make is untyped.
      expect(r.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "LUCENT9001",
          message: expect.stringContaining(
            `${prefix}Dial's initializers are UIView's, inherited from lucent:ios/UIKit, which no file imports: only its name is known.`,
          ),
          fix: `import "lucent:ios/UIKit" (a bare import is enough) to make a ${prefix}Dial with UIView's initializers`,
          quickFix: {
            title: 'Add import "lucent:ios/UIKit"',
            edits: [{ start: expect.any(Number), length: 0, text: '\nimport "lucent:ios/UIKit";' }],
          },
        }),
      );

      // After the file's last import.
      const d = r.diagnostics.find((x) => x.quickFix?.title === 'Add import "lucent:ios/UIKit"')!;
      const source = unimported["dial.ios.lucent.tsx"]!;
      const lastImport = source.lastIndexOf("import ");
      expect(d.quickFix!.edits[0]!.start).toBe(source.indexOf("\n", lastImport));
    },
    600_000,
  );

  it.skipIf(!xcode)(
    "explains each attribute its JSX takes by the rule and artifact giving it",
    () => {
      const { r } = compiledViews(dialJsx, "ios", { ios: { includePaths: [dials] } });
      const declarations = new Map(r.types ?? []).get(`ios/${prefix}Dials.d.ts`) ?? "";
      const attributes = declarations.slice(declarations.indexOf("interface __jsx_"));
      const named = (text: string) =>
        text
          .replaceAll(prefix, "QXN")
          .replaceAll(lower[0]!.toUpperCase() + lower.slice(1), "Qxn")
          .replaceAll(lower, "qxn");

      expect(r.diagnostics).toEqual([]);
      expect(named(attributes)).toBe(`interface __jsx_QXNDial<Self> {
  /** QXNDial.qxnLevel: a writable property (setQxnLevel:), in clang-module:QXNDials */
  qxnLevel?: number;
  /** QXNDial.qxnOnTurn: a writable property (setQxnOnTurn:), in clang-module:QXNDials */
  qxnOnTurn?: ((arg0: number) => void) | null;
}
`);
    },
    600_000,
  );
});
