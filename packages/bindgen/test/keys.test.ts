/**
 * What invalidates a cached schema: the contents of the artifacts its
 * extraction read, the SDK and the extractor, never where the files are,
 * when they were written, or artifacts it did not read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { podsSearchPaths } from "../src/pods.ts";
import {
  extractionCount,
  forgetLoadedSdks,
  sdkAvailable,
  sdkModule,
  type SdkOptions,
} from "../src/provider.ts";
import type { SdkModuleSchema } from "../src/schema.ts";
import { classpathFile, fakeAndroidSdk, gradleCached, javac, javaJar } from "./java-fixtures.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const xcode = sdkAvailable("ios");

const made: string[] = [];
const tmp = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
};
afterAll(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const BUILD = (level: number, extra = "") => ({
  "android/os/Build.java": `package android.os;
public class Build {
  public static final int LEVEL = ${level};
  ${extra}
}`,
});

const CLOCK = (extra = "") => ({
  "dev/orbit/core/Clock.java": `package dev.orbit.core;
public class Clock {
  public Clock() {}
  public long now() { return 0; }
  ${extra}
}`,
});

const TRACKER = (pkg = "dev.orbit.tracking", cls = "Tracker") => ({
  [`${pkg.replace(/\./g, "/")}/${cls}.java`]: `package ${pkg};
import dev.orbit.core.Clock;
public class ${cls} {
  public ${cls}() {}
  public int count() { return 0; }
  public Clock clock() { return null; }
}`,
});

const OTHER = {
  "dev/orbit/unrelated/Other.java": `package dev.orbit.unrelated;
public class Other { public Other() {} }`,
};

/**
 * An app's Android build: an SDK platform, and a Gradle cache with the
 * core and tracking libraries, the tracker using the core's Clock.
 */
function androidApp() {
  const root = tmp("lucent-app-");
  const sdkRoot = fakeAndroidSdk(path.join(root, "sdk"), "android-35", BUILD(35));
  const gradle = path.join(root, "gradle");
  const core = javaJar(gradleCached(gradle, "dev.orbit", "core", "1.0.0"), CLOCK());
  const tracking = javaJar(gradleCached(gradle, "dev.orbit", "tracking", "1.0.0"), TRACKER(), [
    core,
  ]);
  const classpath = classpathFile(path.join(root, "app/.lucent/android-classpath.json"), [
    tracking,
    core,
  ]);
  const opts: SdkOptions = {
    cacheDir: tmp("lucent-cache-"),
    android: { sdkRoots: [sdkRoot], classpath },
  };

  return { root, sdkRoot, gradle, core, tracking, classpath, opts };
}

/** Looks `module` up as a new process would; returns the schema and how many modules it extracted. */
function lookup(opts: SdkOptions, platform: "ios" | "android", module: string) {
  forgetLoadedSdks();
  const before = extractionCount();
  const r = sdkModule(platform, module, opts);

  return { schema: "schema" in r ? r.schema : undefined, extracted: extractionCount() - before };
}

const members = (schema: SdkModuleSchema | undefined, type: string) => {
  const t = schema?.types.find((c) => c.name === type);
  return t?.kind === "class" ? (t.methods ?? []).map((m) => m.name).sort() : [];
};

describe.skipIf(!javac)("cache keys: Android", () => {
  it("extracts a package again only when an artifact it read changes", () => {
    const app = androidApp();
    expect(lookup(app.opts, "android", "dev.orbit.tracking").extracted).toBe(1);

    // Another dependency: the tracker never reads it.
    const other = javaJar(gradleCached(app.gradle, "dev.orbit", "unrelated", "1.0.0"), OTHER);
    classpathFile(app.classpath, [app.tracking, app.core, other]);
    expect(lookup(app.opts, "android", "dev.orbit.tracking").extracted).toBe(0);
    expect(lookup(app.opts, "android", "dev.orbit.unrelated").extracted).toBe(1);

    // Installed again: the same bytes, written later.
    fs.copyFileSync(app.tracking, `${app.tracking}.copy`);
    fs.renameSync(`${app.tracking}.copy`, app.tracking);
    fs.utimesSync(app.core, new Date(), new Date(Date.now() + 60_000));
    expect(lookup(app.opts, "android", "dev.orbit.tracking").extracted).toBe(0);

    // A dependency whose class the tracker uses changes: the tracker is read again, the rest not.
    javaJar(app.core, CLOCK("public long zone() { return 0; }"));
    expect(lookup(app.opts, "android", "dev.orbit.tracking").extracted).toBe(1);
    expect(lookup(app.opts, "android", "dev.orbit.unrelated").extracted).toBe(0);
  });

  it("keeps schemas when the checkout and the Gradle cache move", () => {
    const app = androidApp();
    lookup(app.opts, "android", "dev.orbit.tracking");

    // Another machine: the same SDK and libraries under other paths.
    const moved = tmp("lucent-moved-");
    fs.cpSync(app.root, moved, { recursive: true });
    const at = (f: string) => path.join(moved, path.relative(app.root, f));
    const classpath = classpathFile(at(app.classpath), [at(app.tracking), at(app.core)]);
    const opts = {
      cacheDir: app.opts.cacheDir,
      android: { sdkRoots: [at(app.sdkRoot)], classpath },
    };

    expect(lookup(opts, "android", "dev.orbit.tracking").extracted).toBe(0);
  });

  it("types a referenced class once the library declaring it is linked", () => {
    const app = androidApp();
    classpathFile(app.classpath, [app.tracking]);

    const alone = lookup(app.opts, "android", "dev.orbit.tracking");
    expect(members(alone.schema, "Tracker")).toEqual(["count"]);

    classpathFile(app.classpath, [app.tracking, app.core]);
    const linked = lookup(app.opts, "android", "dev.orbit.tracking");

    expect(linked.extracted).toBe(1);
    expect(members(linked.schema, "Tracker")).toEqual(["clock", "count"]);
  });

  it("keeps other packages' schemas when a library and its declarations are renamed", () => {
    const app = androidApp();
    lookup(app.opts, "android", "dev.orbit.core");
    lookup(app.opts, "android", "dev.orbit.tracking");

    const renamed = javaJar(
      gradleCached(app.gradle, "dev.comet", "telemetry", "1.0.0"),
      TRACKER("dev.comet.telemetry", "Telemetry"),
      [app.core],
    );
    classpathFile(app.classpath, [renamed, app.core]);

    expect(lookup(app.opts, "android", "dev.orbit.core").extracted).toBe(0);
    const telemetry = lookup(app.opts, "android", "dev.comet.telemetry");
    expect(telemetry.extracted).toBe(1);
    expect(members(telemetry.schema, "Telemetry")).toEqual(["clock", "count"]);
    expect(telemetry.schema?.provenance?.artifact).toBe("maven:dev.comet:telemetry:1.0.0");
    expect(sdkModule("android", "dev.orbit.tracking", app.opts)).toEqual({
      missing: expect.stringMatching(/dev\.orbit\.tracking was not found/),
    });
  });

  it("extracts per SDK version, and keeps each version's schemas", () => {
    const app = androidApp();
    fakeAndroidSdk(
      app.sdkRoot,
      "android-36",
      BUILD(36, 'public static final String CODENAME = "";'),
    );
    const on = (platform: string) => ({
      ...app.opts,
      android: { ...app.opts.android, platform },
    });

    const v35 = lookup(on("android-35"), "android", "android.os");
    const v36 = lookup(on("android-36"), "android", "android.os");
    const again = lookup(on("android-35"), "android", "android.os");

    expect([v35.extracted, v36.extracted, again.extracted]).toEqual([1, 1, 0]);
    expect(v35.schema?.provenance?.artifact).toBe("android-sdk:35");
    expect(v36.schema?.provenance?.artifact).toBe("android-sdk:36");
    expect(again.schema).toEqual(v35.schema);
  });
});

describe.skipIf(!xcode)("cache keys: iOS", () => {
  const module = (dir: string, name: string, body: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "module.modulemap"), `module ${name} { header "${name}.h" }\n`);
    fs.writeFileSync(
      path.join(dir, `${name}.h`),
      `#import <Foundation/Foundation.h>\n@interface ${name}Thing : NSObject\n${body}\n@end\n`,
    );
  };

  it("extracts a module again only when its own headers change", () => {
    const root = tmp("lucent-modules-");
    module(path.join(root, "gizmos"), "Gizmos", "- (void)spin;");
    module(path.join(root, "sprockets"), "Sprockets", "- (void)turn;");
    const opts = {
      cacheDir: tmp("lucent-cache-"),
      ios: { includePaths: [path.join(root, "gizmos"), path.join(root, "sprockets")] },
    };
    expect(lookup(opts, "ios", "Gizmos").extracted).toBe(1);

    module(path.join(root, "sprockets"), "Sprockets", "- (void)turn;\n- (void)stop;");
    expect(lookup(opts, "ios", "Gizmos").extracted).toBe(0);

    const header = path.join(root, "gizmos/Gizmos.h");
    fs.utimesSync(header, new Date(), new Date(Date.now() + 60_000));
    expect(lookup(opts, "ios", "Gizmos").extracted).toBe(0);

    module(path.join(root, "gizmos"), "Gizmos", "- (void)spin;\n- (void)stop;");
    const edited = lookup(opts, "ios", "Gizmos");
    expect(edited.extracted).toBe(1);
    expect(members(edited.schema, "GizmosThing")).toEqual(["spin", "stop"]);
  });

  it("keeps pods' schemas across installs of the same pods", () => {
    const dir = tmp("lucent-pods-");
    fs.cpSync(path.join(fixtures, "pods"), dir, { recursive: true });
    const opts = { cacheDir: tmp("lucent-cache-"), ios: podsSearchPaths(dir)! };
    expect(lookup(opts, "ios", "WidgetsPod").extracted).toBe(1);

    // pod install rewrote the lockfile and the headers, with the same pods.
    fs.appendFileSync(path.join(dir, "Podfile.lock"), "\n# installed again\n");
    const header = path.join(dir, "Pods/Headers/Public/WidgetsPod/WPGauge.h");
    fs.copyFileSync(header, `${header}.copy`);
    fs.renameSync(`${header}.copy`, header);

    expect(lookup(opts, "ios", "WidgetsPod").extracted).toBe(0);
  });

  it("extracts per SDK, and keeps each SDK's schemas", () => {
    const root = tmp("lucent-modules-");
    module(path.join(root, "gizmos"), "Gizmos", "- (void)spin;");
    // Another Xcode: xcrun reports another SDK version and build.
    const xcrun = path.join(root, "xcrun");
    fs.writeFileSync(
      xcrun,
      `#!/bin/sh
case "$*" in
  *--show-sdk-version*) echo 26.9 ;;
  *--show-sdk-build-version*) echo 26Z999 ;;
  *) exec xcrun "$@" ;;
esac
`,
      { mode: 0o755 },
    );
    const opts = (other: boolean) => ({
      cacheDir: path.join(root, "cache"),
      ios: { includePaths: [path.join(root, "gizmos")], ...(other ? { xcrun } : {}) },
    });

    const first = lookup(opts(false), "ios", "Gizmos").extracted;
    const other = lookup(opts(true), "ios", "Gizmos").extracted;
    const again = lookup(opts(false), "ios", "Gizmos").extracted;

    expect([first, other, again]).toEqual([1, 1, 0]);
    const scopes = fs.readdirSync(path.join(root, "cache/sdk/ios"));
    expect(scopes).toHaveLength(2);
    expect(scopes.filter((s) => s.startsWith("iphonesimulator26.9-26Z999-"))).toHaveLength(1);
  });
});
