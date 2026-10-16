/**
 * A Lucent package's own Kotlin and Java (decision 0132): compiled into a jar on the
 * first import of a package they declare, against the platform's
 * android.jar and the app's classpath (an AAR's classes too), and bound
 * from it as a library is; cached under the sources' key; and, when they
 * don't compile, missing with the compiler's errors.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { jvmCompilers, packageOf, planJvmSources } from "../src/jvm-sources.ts";
import {
  androidSourcesJar,
  extractionCount,
  forgetLoadedSdks,
  nativeArtifacts,
  type SdkOptions,
  sdkModule,
  sdkModules,
} from "../src/provider.ts";
import type { SdkClassSchema, SdkModuleSchema } from "../src/schema.ts";
import { classpathFile, fakeAndroidSdk, javac, javaJar } from "./java-fixtures.ts";
import { runJar } from "./jvm-tools.ts";
import { kotlinToolchain } from "./kotlin-toolchain.ts";

const tc = kotlinToolchain();

describe("the package a Kotlin or Java file declares", () => {
  it("comes after comments and file annotations, and is none in the default package", () => {
    expect(
      packageOf(
        '/* The greeter. */\n// A line.\n@file:JvmName("Greetings")\n@file:Suppress("unused")\n\npackage dev.example.greet\n\nclass Greeter\n',
      ),
    ).toBe("dev.example.greet");
    expect(packageOf("package dev.example.`in`.java;\n\npublic class Polite {}\n")).toBe(
      "dev.example.in.java",
    );
    expect(packageOf("/** package not.this */\nclass Loose\n")).toBeUndefined();
  });
});

/** The app's Kotlin and Java: a class, a property, top-level functions, and Java and Kotlin calling each other. */
const SOURCES: Record<string, string> = {
  "greet/Greeter.kt": `@file:JvmName("Greetings")

package dev.example.greet

import android.content.Context
import dev.example.lib.Shouter
import dev.example.greet.java.Polite

class Greeter(private val name: String) {
  fun greet(context: Context): String = "hello $name from \${context.packageName()}"

  fun loud(): String = Shouter().shout(name)

  val length get() = name.length
}

fun greeting(of: String = "you") = "hi $of"

fun polite(greeter: Greeter): String = Polite.greet(greeter)
`,
  "greet/java/Polite.java": `package dev.example.greet.java;

import dev.example.greet.Greeter;

public final class Polite {
  public static String greet(Greeter greeter) {
    return "please, " + greeter.loud();
  }
}
`,
};

const write = (dir: string, files: Record<string, string>) =>
  Object.entries(files).map(([rel, text]) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  });

/**
 * An app: a fake SDK with android.content.Context, a library in an AAR
 * (dev.example.lib.Shouter) on its classpath with Kotlin's standard
 * library, and the package's sources.
 */
function app(files = SOURCES, record: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-jvm-sources-"));
  const sdk = fakeAndroidSdk(path.join(root, "sdk"), "android-35", {
    "android/content/Context.java":
      'package android.content;\npublic class Context {\n  public String packageName() { return "app"; }\n}\n',
  });

  // An AAR as Gradle's cache keeps it: its classes in classes.jar.
  const lib = javaJar(path.join(root, "lib/classes.jar"), {
    "dev/example/lib/Shouter.java":
      "package dev.example.lib;\npublic class Shouter {\n  public String shout(String s) { return s.toUpperCase(); }\n}\n",
  });
  const aar = path.join(root, "gradle/files-2.1/dev.example/lib/1.0/a1b2/lib-1.0.aar");
  fs.mkdirSync(path.dirname(aar), { recursive: true });
  runJar(["cf", aar, "-C", path.dirname(lib), "classes.jar"]);

  const classpath = path.join(root, ".lucent/android-classpath.json");
  classpathFile(classpath, [path.join(tc!.lib, "kotlin-stdlib.jar")], [aar]);
  if (Object.keys(record).length)
    fs.writeFileSync(
      classpath,
      JSON.stringify({ ...JSON.parse(fs.readFileSync(classpath, "utf8")), ...record }),
    );

  const opts: SdkOptions = {
    cacheDir: path.join(root, "cache"),
    android: {
      sdkRoots: [sdk],
      classpath,
      sources: write(path.join(root, "package/android"), files).sort(),
    },
  };
  return { root, opts };
}

const schemaOf = (module: string, opts: SdkOptions): SdkModuleSchema => {
  const found = sdkModule("android", module, opts);
  if ("missing" in found) throw new Error(found.missing);
  return found.schema;
};

const classes = (s: SdkModuleSchema) =>
  s.types.filter((t): t is SdkClassSchema => t.kind === "class");

const members = (c: SdkClassSchema) => [
  ...(c.methods ?? []).map((m) => m.name),
  ...(c.properties ?? []).map((p) => p.name),
];

describe.skipIf(!tc || !javac)("a package's Kotlin and Java", () => {
  it("bind as their Java packages, from the jar their first import compiles", () => {
    const { opts } = app();
    expect(sdkModules("android", opts)).toEqual(
      expect.arrayContaining(["dev.example.greet", "dev.example.greet.java"]),
    );

    const greet = schemaOf("dev.example.greet", opts);
    expect(greet.provenance).toMatchObject({
      artifact: "sources:android.nativeSources",
      kind: "sources",
    });
    const byName = new Map(classes(greet).map((c) => [c.name, c]));
    expect(members(byName.get("Greeter")!)).toEqual(
      expect.arrayContaining(["greet", "loud", "length"]),
    );
    // Top-level functions, on the file's facade as @file:JvmName names it.
    expect(members(byName.get("Greetings")!)).toEqual(
      expect.arrayContaining(["greeting", "polite"]),
    );

    const polite = classes(schemaOf("dev.example.greet.java", opts));
    expect(polite.map((c) => c.name)).toEqual(["Polite"]);
    expect(members(polite[0]!)).toEqual(["greet"]);

    // Built once: another process reads the jar and the schemas from the cache.
    const built = androidSourcesJar(opts);
    expect(built).toMatchObject({ jar: expect.stringContaining("jvm-sources") });
    const jar = (built as { jar: string }).jar;
    const mtime = fs.statSync(jar).mtimeMs;
    forgetLoadedSdks();
    const before = extractionCount();
    schemaOf("dev.example.greet", opts);
    expect(extractionCount()).toBe(before);
    expect(fs.statSync(jar).mtimeMs).toBe(mtime);
  }, 120_000);

  it("are one artifact on any machine, whose jar each machine's classpath and compilers key", () => {
    const { opts } = app();
    const files = opts.android!.sources!;
    const here = planJvmSources(files, [], { classpathKey: "here" });
    const there = planJvmSources(files, [], { classpathKey: "there" });
    expect(there.contentHash).toBe(here.contentHash);
    expect(there.key).not.toBe(here.key);
    expect(path.basename(there.jar)).toBe(`sources-${here.contentHash}.jar`);

    expect(nativeArtifacts("android", opts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sources:android.nativeSources",
          kind: "sources",
          contentHash: here.contentHash,
          modules: ["dev.example.greet", "dev.example.greet.java"],
        }),
      ]),
    );
  });

  it("compile again, to another jar, when a source changes", () => {
    const { opts } = app();
    schemaOf("dev.example.greet", opts);
    const first = (androidSourcesJar(opts) as { jar: string }).jar;

    const greeter = opts.android!.sources!.find((f) => f.endsWith("Greeter.kt"))!;
    fs.appendFileSync(greeter, "\nclass Waver {\n  fun wave() = Unit\n}\n");
    const changed = { ...opts, android: { ...opts.android } };
    forgetLoadedSdks();
    expect(classes(schemaOf("dev.example.greet", changed)).map((c) => c.name)).toContain("Waver");
    expect((androidSourcesJar(changed) as { jar: string }).jar).not.toBe(first);
  }, 120_000);

  it("are missing, with the compiler's errors, when they don't compile", () => {
    const { opts } = app({
      ...SOURCES,
      "greet/Broken.kt": 'package dev.example.greet\n\nfun broken(): Int = "text"\n',
    });
    for (const module of ["dev.example.greet", "dev.example.greet.java"]) {
      const found = sdkModule("android", module, opts);
      expect(found).toMatchObject({
        missing: expect.stringContaining(
          `lucent:android/${module} is declared by the Lucent packages' Kotlin and Java (android.nativeSources), which don't compile here: kotlinc: `,
        ),
      });
      expect((found as { missing: string }).missing).toMatch(/Broken\.kt:3:\d+: error: /);
    }
  }, 120_000);

  it("compile with the Kotlin compiler the app's Gradle build resolved", () => {
    const compiler = [
      "kotlin-compiler.jar",
      "kotlin-stdlib.jar",
      "kotlin-reflect.jar",
      "kotlin-script-runtime.jar",
      "annotations-13.0.jar",
      "kotlinx-coroutines-core-jvm.jar",
    ]
      .map((j) => path.join(tc!.lib, j))
      .filter((j) => fs.existsSync(j));
    const kotlinc = process.env.KOTLINC;
    delete process.env.KOTLINC;
    try {
      expect(jvmCompilers(compiler).kotlinc?.command).toEqual([
        expect.stringMatching(/java$/),
        "-cp",
        compiler.join(path.delimiter),
        "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
      ]);

      const { opts } = app(SOURCES, { kotlinCompiler: compiler });
      expect(classes(schemaOf("dev.example.greet", opts)).map((c) => c.name)).toContain("Greeter");
    } finally {
      if (kotlinc !== undefined) process.env.KOTLINC = kotlinc;
    }
  }, 120_000);

  it("say what to install when no Kotlin compiler is found", () => {
    const saved = { PATH: process.env.PATH, KOTLINC: process.env.KOTLINC };
    // javac and jar from JAVA_HOME: a PATH with no kotlinc.
    const home = path.dirname(path.dirname(fs.realpathSync(whichJavac()!)));
    process.env.JAVA_HOME = process.env.JAVA_HOME ?? home;
    process.env.PATH = path.join(home, "bin");
    delete process.env.KOTLINC;
    try {
      const { opts } = app();
      expect(sdkModule("android", "dev.example.greet", opts)).toMatchObject({
        missing: expect.stringContaining(
          "they are Kotlin, and no Kotlin compiler was found: set KOTLINC to kotlinc",
        ),
      });
    } finally {
      process.env.PATH = saved.PATH;
      if (saved.KOTLINC !== undefined) process.env.KOTLINC = saved.KOTLINC;
    }
  });
});

function whichJavac(): string | undefined {
  const r = spawnSync("sh", ["-c", "command -v javac"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}
