import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { BuildRecord } from "../src/cli/build-graph.ts";
import { runLucent } from "./run-to-exit.ts";

/** A host build: no platform SDK or Gradle needed, the same native package files. */
function build(root: string, env: NodeJS.ProcessEnv = {}) {
  const r = runLucent(["build", "--platforms", "host", "--root", root], {
    env: { ...process.env, NO_COLOR: "1", ...env },
  });

  return { status: r.status, out: r.stdout + r.stderr };
}

function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}

/** Installs a source Lucent package into the app's node_modules. */
function install(root: string, name: string, native: object, files: Record<string, string>): void {
  const dir = `node_modules/${name}`;

  write(root, {
    [`${dir}/package.json`]: JSON.stringify({
      name,
      version: "1.0.0",
      lucent: { sources: "src" },
    }),
    [`${dir}/lucent.json`]: JSON.stringify(native),
    [`${dir}/src/${name.replace(/^lucent-/, "")}.lucent.ts`]:
      "export function ready(): boolean { return true; }\n",
    ...Object.fromEntries(Object.entries(files).map(([rel, c]) => [`${dir}/${rel}`, c])),
  });
}

/**
 * An app with two installed source packages, each contributing native
 * dependencies, sources and resources.
 */
function app(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inputs-"));

  write(root, {
    "package.json": JSON.stringify({
      name: "app",
      dependencies: { "lucent-maps": "1.0.0", "lucent-sound": "1.0.0" },
    }),
    "src/app.lucent.ts": "export function one(): number { return 1; }\n",
  });

  install(
    root,
    "lucent-maps",
    {
      ios: { pods: { OrbitMaps: "~> 2.1" }, nativeSources: ["native/ios"] },
      android: {
        dependencies: { "dev.orbit:maps": "2.1.0" },
        nativeSources: ["native/android"],
        resources: ["res"],
      },
    },
    {
      "native/ios/maps_adapter.mm": "// maps\n",
      "native/android/maps_adapter.cpp": "// maps\n",
      "res/drawable/pin.png": "pin",
    },
  );

  install(
    root,
    "lucent-sound",
    {
      ios: { pods: { OrbitMaps: ">= 2.2" }, resources: ["assets/chime.caf"] },
      android: { dependencies: { "dev.orbit:audio": "1.0.0" }, assets: ["assets/android"] },
    },
    { "assets/chime.caf": "caf", "assets/android/chime.ogg": "ogg" },
  );

  return root;
}

/** Every file of the native package with its content, but the build cache key's manifest. */
function snapshot(root: string): Record<string, string> {
  const out = path.join(root, ".lucent/native");

  return Object.fromEntries(
    fs
      .readdirSync(out, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.relative(out, path.join(e.parentPath, e.name)))
      .filter((f) => f !== "manifest.json")
      .sort()
      .map((f) => [f, fs.readFileSync(path.join(out, f), "base64")]),
  );
}

function record(root: string): BuildRecord {
  return JSON.parse(fs.readFileSync(path.join(root, ".lucent/build-record.json"), "utf8"));
}

/** The record's nodes without their details (how many files a step wrote), which differ between clean and incremental builds. */
function work(root: string) {
  return record(root).nodes.map(({ id, kind, status, inputs, outputs, hash }) => ({
    id,
    kind,
    status,
    inputs,
    outputs,
    hash,
  }));
}

describe("Lucent packages' native inputs in an app", () => {
  it("builds two packages' dependencies, sources and resources into the app's one runtime", () => {
    const root = app();

    const r = build(root);
    expect(r.out).toContain("lucent-maps/maps");
    expect(r.status).toBe(0);

    const native = path.join(root, ".lucent/native");
    const read = (f: string) => fs.readFileSync(path.join(native, f), "utf8");

    // One pod and one Android library for the whole app.
    expect(fs.readdirSync(native).filter((f) => f.endsWith(".podspec"))).toEqual([
      "LucentNative.podspec",
    ]);

    const podspec = read("LucentNative.podspec");
    expect(podspec).toContain('s.dependency "OrbitMaps", ">= 2.2", "~> 2.1"');
    expect(podspec).toContain('"packages/lucent-maps/native/ios/**/*.{h,hpp,m,mm,c,cc,cpp,swift}"');
    expect(podspec).toContain('s.resources = ["packages/lucent-sound/assets/chime.caf"]');

    const gradle = read("android/build.gradle");
    expect(gradle).toContain('api("dev.orbit:maps:2.1.0")');
    expect(gradle).toContain('api("dev.orbit:audio:1.0.0")');
    expect(gradle).toContain('res.srcDirs += ["../packages/lucent-maps/res"]');
    expect(gradle).toContain('assets.srcDirs += ["../packages/lucent-sound/assets/android"]');
    expect(read("android/packages.cmake")).toContain(
      "packages/lucent-maps/native/android/maps_adapter.cpp",
    );

    // Where each need came from.
    const resolved = JSON.parse(read("resolved.json"));
    expect(resolved.ios.pods.OrbitMaps).toEqual({
      ">= 2.2": ["lucent-sound"],
      "~> 2.1": ["lucent-maps"],
    });
    expect(resolved.ios.resources).toEqual([
      { package: "lucent-sound", path: "assets/chime.caf", hash: expect.any(String) },
    ]);

    // The record's resolve step names each package input, by content.
    const resolve = record(root).nodes.find((n) => n.id === "resolve")!;
    expect(resolve.inputs.map((i) => i.key)).toEqual([
      "native-dependencies",
      "packages/lucent-maps/native/android",
      "packages/lucent-maps/native/ios",
      "packages/lucent-maps/res",
      "packages/lucent-sound/assets/android",
      "packages/lucent-sound/assets/chime.caf",
    ]);
  });

  it("writes the same native package incrementally as from a clean build", () => {
    const root = app();
    const sound = path.join(root, "node_modules/lucent-sound");

    expect(build(root).status).toBe(0);
    const clean = snapshot(root);
    const cleanNodes = work(root);

    // Change a resource and add an input, build, then undo both.
    const lucentJson = fs.readFileSync(path.join(sound, "lucent.json"), "utf8");
    fs.writeFileSync(path.join(sound, "assets/chime.caf"), "louder");
    write(sound, {
      "assets/extra.caf": "extra",
      "lucent.json": JSON.stringify({
        ...JSON.parse(lucentJson),
        ios: { ...JSON.parse(lucentJson).ios, resources: ["assets/chime.caf", "assets/extra.caf"] },
      }),
    });

    expect(build(root).status).toBe(0);
    const changed = snapshot(root);
    expect(changed["packages/lucent-sound/assets/chime.caf"]).toBe(
      Buffer.from("louder").toString("base64"),
    );
    expect(changed["packages/lucent-sound/assets/extra.caf"]).toBeDefined();

    fs.writeFileSync(path.join(sound, "assets/chime.caf"), "caf");
    fs.writeFileSync(path.join(sound, "lucent.json"), lucentJson);

    expect(build(root).status).toBe(0);
    const incremental = snapshot(root);
    const incrementalNodes = work(root);

    fs.rmSync(path.join(root, ".lucent"), { recursive: true });
    expect(build(root).status).toBe(0);

    expect(incremental).toEqual(clean);
    expect(incrementalNodes).toEqual(cleanNodes);
    expect(snapshot(root)).toEqual(clean);
    expect(work(root)).toEqual(cleanNodes);
  });

  it("asks the Gradle build it runs in to build again when the Android library's build file changed", () => {
    const root = app();
    expect(build(root).status).toBe(0);

    install(
      root,
      "lucent-sound",
      { android: { dependencies: { "dev.orbit:audio": "2.0.0" } } },
      {},
    );
    const inGradle = build(root, { LUCENT_GRADLE_CLASSPATH: "1" });

    // That build configured the library with the old file: the new one is in place for the next.
    expect(inGradle.status).not.toBe(0);
    expect(inGradle.out).toContain(
      "this Gradle build configured the Lucent Android library before its build.gradle changed",
    );
    expect(
      fs.readFileSync(path.join(root, ".lucent/native/android/build.gradle"), "utf8"),
    ).toContain('api("dev.orbit:audio:2.0.0")');
    expect(build(root, { LUCENT_GRADLE_CLASSPATH: "1" }).status).toBe(0);
  });

  it("fails naming both packages when their resources would collide", () => {
    const root = app();
    install(
      root,
      "lucent-sound",
      { ios: { resources: ["assets/pin.png"] } },
      { "assets/pin.png": "sound's pin" },
    );
    install(
      root,
      "lucent-maps",
      { ios: { resources: ["images/pin.png"] } },
      { "images/pin.png": "maps' pin" },
    );

    const r = build(root);

    expect(r.status).not.toBe(0);
    expect(r.out).toContain(
      "iOS resource pin.png: lucent-maps has images/pin.png, lucent-sound has assets/pin.png",
    );
  });
});
