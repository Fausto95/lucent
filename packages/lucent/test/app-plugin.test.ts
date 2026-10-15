import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const plugin = require("../app.plugin.js") as {
  (config: object): object;
  GRADLE_LINES: Record<string, string>;
  linkNativePackage: (root: string) => void;
  buildArgs: (root: string, platforms: string[]) => string[];
  prebuildPlatforms: (argv: string[]) => string[];
  withPackageEntries: (
    app: Record<string, unknown>,
    packages: Record<string, { value: unknown }>,
  ) => Record<string, unknown>;
  withMainActivity: (
    manifest: Manifest,
    needs: {
      supportsPictureInPicture?: string[];
      configChanges: Record<string, string[]>;
      launchMode?: { value: string; from: string[] };
    },
    warn?: (text: string) => void,
  ) => Manifest;
  withPodHook: (podfile: string) => string | undefined;
  withGradleClasspaths: (text: string, artifacts: string[]) => string | undefined;
  withGradlePlugins: (text: string, ids: string[], language?: string) => string | undefined;
};

/** AndroidManifest.xml as Expo's mods parse it. */
type Manifest = {
  manifest: { application: { activity: { $: Record<string, string>; [k: string]: unknown }[] }[] };
};

function app(config?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-plugin-"));
  if (config !== undefined) fs.writeFileSync(path.join(root, "react-native.config.js"), config);

  return root;
}

const read = (root: string) => fs.readFileSync(path.join(root, "react-native.config.js"), "utf8");

describe("the Expo config plugin's link to the native package", () => {
  it("writes react-native.config.js when the app has none", () => {
    const root = app();

    plugin.linkNativePackage(root);

    expect(read(root)).toContain('"lucent": require("@lucent-lang/lucent/autolink")(__dirname)');
  });

  it("makes an entry naming the root alone build it first", () => {
    const root = app(
      'module.exports = { dependencies: { "lucent": { root: require("path").join(__dirname, ".lucent", "native") } } };\n',
    );

    plugin.linkNativePackage(root);

    expect(read(root)).toBe(
      'module.exports = { dependencies: { "lucent": require("@lucent-lang/lucent/autolink")(__dirname) } };\n',
    );
  });

  it("accepts an entry whatever its key's quotes, as formatters leave it", () => {
    for (const key of ['"lucent"', "'lucent'", "lucent"]) {
      const root = app(`module.exports = { dependencies: { ${key}: { root: "x" } } };\n`);

      expect(() => plugin.linkNativePackage(root)).not.toThrow();
    }
  });

  it("asks for the entry when the config links something else only", () => {
    const root = app(`module.exports = { dependencies: { other: { root: "x" } } };\n`);

    expect(() => plugin.linkNativePackage(root)).toThrow(/Add "lucent"/);
  });
});

describe("the Expo config plugin's Info.plist entries from Lucent packages", () => {
  it("adds what the app lacks, keeps the app's own values, and joins arrays", () => {
    const app = {
      NSCameraUsageDescription: "The app's own words",
      UIBackgroundModes: ["fetch"],
    };

    const merged = plugin.withPackageEntries(app, {
      NSCameraUsageDescription: { value: "A package's words" },
      NSFaceIDUsageDescription: { value: "Unlock" },
      UIBackgroundModes: { value: ["audio", "fetch"] },
      UIFileSharingEnabled: { value: true },
    });

    expect(merged).toEqual({
      NSCameraUsageDescription: "The app's own words",
      NSFaceIDUsageDescription: "Unlock",
      UIBackgroundModes: ["fetch", "audio"],
      UIFileSharingEnabled: true,
    });
  });
});

describe("the Expo config plugin's main Activity attributes from Lucent packages", () => {
  const manifest = (attributes: Record<string, string>): Manifest => ({
    manifest: {
      application: [
        {
          activity: [
            { $: { "android:name": ".Other" } },
            {
              $: { "android:name": ".MainActivity", ...attributes },
              "intent-filter": [
                {
                  action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
                  category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }],
                },
              ],
            },
          ],
        },
      ],
    },
  });

  it("adds picture in picture and the configChanges the app lacks, and keeps its launchMode", () => {
    const warnings: string[] = [];
    const out = plugin.withMainActivity(
      manifest({
        "android:configChanges": "orientation|screenSize",
        "android:launchMode": "singleTask",
      }),
      {
        supportsPictureInPicture: ["lucent-video"],
        configChanges: { screenSize: ["lucent-video"], smallestScreenSize: ["lucent-video"] },
        launchMode: { value: "singleTop", from: ["lucent-video"] },
      },
      (w) => warnings.push(w),
    );

    expect(out.manifest.application[0]!.activity[1]!.$).toEqual({
      "android:name": ".MainActivity",
      "android:configChanges": "orientation|screenSize|smallestScreenSize",
      "android:launchMode": "singleTask",
      "android:supportsPictureInPicture": "true",
    });
    expect(out.manifest.application[0]!.activity[0]!.$).toEqual({ "android:name": ".Other" });
    expect(warnings).toEqual([
      'lucent-video need android:launchMode="singleTop" on the main Activity, which says singleTask: the app\'s stands',
    ]);
  });

  it("sets a launchMode the app doesn't, and changes nothing when no package asks", () => {
    expect(
      plugin.withMainActivity(manifest({}), {
        configChanges: {},
        launchMode: { value: "singleTop", from: ["lucent-video"] },
      }).manifest.application[0]!.activity[1]!.$["android:launchMode"],
    ).toBe("singleTop");
    expect(plugin.withMainActivity(manifest({}), { configChanges: {} })).toEqual(manifest({}));
  });
});

describe("the Expo config plugin's Gradle task", () => {
  it("applies the Gradle task and packages' Gradle plugins to Kotlin build scripts during prebuild", async () => {
    const { compileModsAsync } = require("expo/config-plugins") as {
      compileModsAsync(
        config: object,
        options: { projectRoot: string; platforms: string[] },
      ): Promise<object>;
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-plugin-"));
    const script = 'plugins {\n  id("com.android.application")\n  id("com.facebook.react")\n}\n';
    fs.mkdirSync(path.join(root, "android/app"), { recursive: true });
    fs.writeFileSync(path.join(root, "android/app/build.gradle.kts"), script);
    fs.writeFileSync(path.join(root, "android/settings.gradle.kts"), 'include(":app")\n');
    const project =
      'buildscript {\n  dependencies {\n    classpath("com.android.tools.build:gradle")\n  }\n}\n';
    fs.writeFileSync(path.join(root, "android/build.gradle.kts"), project);
    // The app's own lucent.json asks for a Gradle plugin, as a package's would.
    fs.writeFileSync(
      path.join(root, "lucent.json"),
      JSON.stringify({
        android: {
          gradlePlugins: {
            "com.google.gms.google-services": "com.google.gms:google-services:4.4.2",
          },
        },
      }),
    );
    // What the main Activity's attributes go into.
    fs.mkdirSync(path.join(root, "android/app/src/main"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "android/app/src/main/AndroidManifest.xml"),
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>\n',
    );
    fs.writeFileSync(path.join(root, "package.json"), '{ "name": "app" }\n');
    fs.writeFileSync(
      path.join(root, "a.lucent.ts"),
      "export function one(): number { return 1; }\n",
    );

    await compileModsAsync(plugin({ name: "app", slug: "app" }), {
      projectRoot: root,
      platforms: ["android"],
    });

    const patched = fs.readFileSync(path.join(root, "android/app/build.gradle.kts"), "utf8");
    expect(patched).not.toBe(script);
    expect(patched).toBe(
      `${script}${plugin.GRADLE_LINES.kt}\napply(plugin = "com.google.gms.google-services")\n`,
    );
    expect(fs.readFileSync(path.join(root, "android/build.gradle.kts"), "utf8")).toBe(
      project.replace(
        "  dependencies {\n",
        '  dependencies {\n        classpath("com.google.gms:google-services:4.4.2")\n',
      ),
    );
  }, 120_000);
});

describe("the Expo config plugin's Gradle plugins from Lucent packages", () => {
  const project = `buildscript {
    ext { minSdkVersion = 24 }
    dependencies {
        classpath("com.android.tools.build:gradle")
    }
}
`;
  const services = "com.google.gms:google-services:4.4.2";

  it("puts the artifact on the buildscript classpath, unless the project has it at any version", () => {
    expect(plugin.withGradleClasspaths(project, [services])).toBe(
      project.replace(
        "    dependencies {\n",
        `    dependencies {\n        classpath("${services}")\n`,
      ),
    );
    const own = project.replace(
      'gradle")',
      'gradle")\n        classpath("com.google.gms:google-services:4.3.0")',
    );
    expect(plugin.withGradleClasspaths(own, [services])).toBeUndefined();
    expect(plugin.withGradleClasspaths("allprojects {}\n", [services])).toBeUndefined();
  });

  it("applies the plugin at the end of the app's build, unless it does already", () => {
    const groovy = 'apply plugin: "com.android.application"\n';
    expect(plugin.withGradlePlugins(groovy, ["com.google.gms.google-services"])).toBe(
      `${groovy}apply plugin: "com.google.gms.google-services"\n`,
    );
    const kotlin = 'plugins {\n  id("com.android.application")\n}\n';
    expect(plugin.withGradlePlugins(kotlin, ["com.google.gms.google-services"], "kt")).toBe(
      `${kotlin}apply(plugin = "com.google.gms.google-services")\n`,
    );
    for (const applied of [
      "apply plugin: 'com.google.gms.google-services'",
      'plugins {\n  id("com.google.gms.google-services")\n}',
      "plugins {\n  id 'com.google.gms.google-services'\n}",
    ])
      expect(plugin.withGradlePlugins(applied, ["com.google.gms.google-services"])).toBeUndefined();
    // A dot in the id is a dot.
    expect(
      plugin.withGradlePlugins('apply plugin: "comXgoogle.gms"\n', ["com.google.gms"]),
    ).toContain('apply plugin: "com.google.gms"');
  });
});

describe("the Expo config plugin's build", () => {
  it("builds the platforms expo prebuild writes", () => {
    expect(plugin.prebuildPlatforms(["node", "expo", "prebuild"])).toEqual(["ios", "android"]);
    expect(plugin.prebuildPlatforms(["node", "expo", "prebuild", "--platform", "android"])).toEqual(
      ["android"],
    );
    expect(plugin.prebuildPlatforms(["node", "expo", "prebuild", "-p", "ios"])).toEqual(["ios"]);
    expect(plugin.prebuildPlatforms(["node", "expo", "prebuild", "--platform=all"])).toEqual([
      "ios",
      "android",
    ]);

    expect(plugin.buildArgs("/app", ["android"])).toEqual([
      "build",
      "--root",
      "/app",
      "--platforms",
      "android",
    ]);
    // Both: what this machine can build (no --platforms), Android deferred to Gradle when it must be.
    expect(plugin.buildArgs("/app", ["ios", "android"])).toEqual(["build", "--root", "/app"]);
  });

  it("builds nothing while expo config introspects the mods", async () => {
    const { compileModsAsync } = require("expo/config-plugins") as {
      compileModsAsync(
        config: object,
        options: { projectRoot: string; platforms: string[]; introspect: boolean },
      ): Promise<object>;
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-plugin-"));
    fs.writeFileSync(path.join(root, "package.json"), '{ "name": "app" }\n');
    // A build would write .lucent/.
    fs.writeFileSync(
      path.join(root, "a.lucent.ts"),
      "export function one(): number { return 1; }\n",
    );

    // A fresh copy: the plugin builds once per process.
    delete require.cache[require.resolve("../app.plugin.js")];
    const fresh = require("../app.plugin.js") as typeof plugin;

    await compileModsAsync(fresh({ name: "app", slug: "app", ios: {} }), {
      projectRoot: root,
      platforms: ["ios", "android"],
      introspect: true,
    });

    expect(fs.existsSync(path.join(root, ".lucent"))).toBe(false);
  }, 120_000);
});

describe("the Podfile", () => {
  // As Expo's template writes it.
  const podfile = [
    'require File.join(File.dirname(`node --print "require.resolve(\'expo/package.json\')"`), "scripts/autolinking")',
    "require 'json'",
    "",
    "target 'App' do",
    "  use_expo_modules!",
    "",
    "  post_install do |installer|",
    "    react_native_post_install(installer)",
    "  end",
    "end",
    "",
  ].join("\n");

  it("loads Lucent's CocoaPods hook, and calls it first after pod install", () => {
    const out = plugin.withPodHook(podfile)!;
    const lines = out.split("\n");

    expect(lines[2]).toBe(
      'require File.join(File.dirname(`node --print "require.resolve(\'@lucent-lang/lucent/package.json\')"`), "cocoapods/lucent")',
    );
    expect(out).toContain(
      "  post_install do |installer|\n    lucent_post_install(installer)\n    react_native_post_install(installer)\n",
    );
    // Once.
    expect(plugin.withPodHook(out)).toBeUndefined();
    // The hook file is where the line finds it.
    expect(fs.existsSync(path.join(__dirname, "../cocoapods/lucent.rb"))).toBe(true);
  });

  it("adds a post_install to a Podfile without one", () => {
    const out = plugin.withPodHook("target 'App' do\nend\n")!;

    expect(
      out.endsWith("\npost_install do |installer|\n  lucent_post_install(installer)\nend\n"),
    ).toBe(true);
  });
});
