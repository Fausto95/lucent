/**
 * iOS app extensions' targets in the app (decision 0124), from the native
 * package's ios-extensions.json: a target of the Xcode project (here the
 * bare template's, through the xcode package Expo's config plugins use),
 * its files, and a target of the Podfile naming its subspec.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const ext = require("../ios-extensions.js") as {
  plistXml(value: unknown): string;
  extensionFiles(manifest: Manifest): [string, string][];
  readExtensionTargets(root: string): Manifest | undefined;
  withExtensionPods(podfile: string, manifest: Manifest, podPath: string): string | undefined;
  withExtensionTargets(
    project: XcodeProject,
    manifest: Manifest,
    app: { bundleIdentifier?: string; version?: string; buildNumber?: string; target?: string },
  ): boolean;
  writeExtensionFiles(iosDir: string, manifest: Manifest): void;
};
const plugin = require("../app.plugin.js") as (config: object) => {
  mods?: { ios?: Record<string, unknown> };
};

type Manifest = {
  format: number;
  nativePackage: string;
  extensions: {
    name: string;
    kind: string;
    pod: string;
    infoPlist: Record<string, unknown>;
    entitlements: Record<string, unknown>;
    sources: Record<string, string>;
  }[];
};
type Settings = Record<string, string>;
type XcodeProject = {
  parseSync(): XcodeProject;
  writeSync(): string;
  hash: { project: { objects: Record<string, Record<string, unknown>> } };
  pbxNativeTargetSection(): Record<string, unknown>;
  pbxXCBuildConfigurationSection(): Record<string, { name: string; buildSettings: Settings }>;
  pbxXCConfigurationList(): Record<string, { buildConfigurations: { value: string }[] }>;
};

const template = path.resolve(__dirname, "../templates/bare/ios");

const manifest: Manifest = {
  format: 1,
  nativePackage: ".lucent/native",
  extensions: [
    {
      name: "RichPush",
      kind: "notificationService",
      pod: "LucentExtensions/RichPush",
      infoPlist: {
        CFBundleDisplayName: "RichPush",
        NSExtension: {
          NSExtensionPointIdentifier: "com.apple.usernotifications.service",
          NSExtensionPrincipalClass: "LucentApp_lucent_push_push_Rich",
        },
      },
      entitlements: { "com.apple.security.application-groups": ["group.dev.lucent.push"] },
      sources: { "LucentExtension.m": "// links\n" },
    },
  ],
};

/** The bare template's Xcode project, parsed. */
function project(): { project: XcodeProject; file: string } {
  const { project: open } = require("xcode") as { project(file: string): XcodeProject };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-xcode-"));
  const file = path.join(dir, "project.pbxproj");
  fs.copyFileSync(path.join(template, "HelloWorld.xcodeproj/project.pbxproj"), file);
  return { project: open(file).parseSync(), file };
}

const unquote = (s: unknown) => (typeof s === "string" ? s.replace(/^"(.*)"$/, "$1") : s);
const named = (p: XcodeProject, name: string) =>
  Object.entries(p.pbxNativeTargetSection()).find(
    ([, t]) => typeof t === "object" && unquote((t as { name: string }).name) === name,
  ) as [string, Record<string, unknown>] | undefined;

describe("an app extension's target", () => {
  it("is an app extension of the app's bundle identifier, embedded in the app, which builds it", () => {
    const { project: p, file } = project();
    const app = { bundleIdentifier: "dev.lucent.hello", version: "2.3.0", buildNumber: "7" };
    expect(ext.withExtensionTargets(p, manifest, app)).toBe(true);
    fs.writeFileSync(file, p.writeSync());

    // Read back from what was written, as Xcode would.
    const { project: open } = require("xcode") as { project(file: string): XcodeProject };
    const written = open(file).parseSync();
    const [uuid, rich] = named(written, "RichPush")!;
    expect(unquote(rich.productType)).toBe("com.apple.product-type.app-extension");

    const configs = written.pbxXCBuildConfigurationSection();
    const list = written.pbxXCConfigurationList()[rich.buildConfigurationList as string]!;
    const settings = list.buildConfigurations.map((r) => configs[r.value]!.buildSettings);
    expect(settings).toHaveLength(2);
    for (const s of settings) {
      expect(unquote(s.PRODUCT_BUNDLE_IDENTIFIER)).toBe("dev.lucent.hello.RichPush");
      expect(unquote(s.INFOPLIST_FILE)).toBe("RichPush/Info.plist");
      expect(unquote(s.CODE_SIGN_ENTITLEMENTS)).toBe("RichPush/RichPush.entitlements");
      expect(s.APPLICATION_EXTENSION_API_ONLY).toBe("YES");
      // The template's target has a version of its own; it is the extension's too.
      expect(String(unquote(s.MARKETING_VERSION))).toBe("1.0");
      expect(String(unquote(s.CURRENT_PROJECT_VERSION))).toBe("1");
      expect(unquote(s.IPHONEOS_DEPLOYMENT_TARGET)).toBeDefined();
    }

    // Its source is compiled, and the app embeds it and builds it first.
    const text = fs.readFileSync(file, "utf8");
    expect(text).toMatch(/LucentExtension\.m in Sources/);
    expect(text).toMatch(/RichPush\.appex in Copy Files/);
    expect(text).toMatch(/dstSubfolderSpec = 13;/);
    const [, hello] = named(written, "HelloWorld")!;
    const deps = hello.dependencies as { value: string }[];
    const targetDeps = written.hash.project.objects.PBXTargetDependency!;
    expect(deps.map((d) => (targetDeps[d.value] as { target: string }).target)).toContain(uuid);

    // Once there, it is left as it is.
    expect(ext.withExtensionTargets(written, manifest, app)).toBe(false);
  });

  it("compiles a widget's entry point, in Swift", () => {
    const { project: p } = project();
    const widget: Manifest = {
      ...manifest,
      extensions: [
        {
          name: "Weather",
          kind: "widget",
          pod: "LucentExtensions/Weather",
          infoPlist: {
            NSExtension: { NSExtensionPointIdentifier: "com.apple.widgetkit-extension" },
          },
          entitlements: {},
          sources: { "LucentWidget.swift": "@main\nstruct LucentWidgetBundle {}\n" },
        },
      ],
    };
    expect(ext.withExtensionTargets(p, widget, { bundleIdentifier: "dev.lucent.hello" })).toBe(
      true,
    );

    const [, weather] = named(p, "Weather")!;
    const configs = p.pbxXCBuildConfigurationSection();
    const list = p.pbxXCConfigurationList()[weather.buildConfigurationList as string]!;
    for (const r of list.buildConfigurations)
      expect(configs[r.value]!.buildSettings.SWIFT_VERSION).toBe("5.0");
    expect(p.writeSync()).toMatch(/LucentWidget\.swift in Sources/);
    // The notification service's target compiles no Swift.
    const { project: q } = project();
    ext.withExtensionTargets(q, manifest, { bundleIdentifier: "dev.lucent.hello" });
    const [, rich] = named(q, "RichPush")!;
    const richConfigs = q.pbxXCBuildConfigurationSection();
    for (const r of q.pbxXCConfigurationList()[rich.buildConfigurationList as string]!
      .buildConfigurations)
      expect(richConfigs[r.value]!.buildSettings.SWIFT_VERSION).toBeUndefined();
  });

  it("takes the app's version from the app when its target has none", () => {
    const { project: p } = project();
    // An Expo app's target has no MARKETING_VERSION: app.json gives it.
    for (const c of Object.values(p.pbxXCBuildConfigurationSection()))
      if (typeof c === "object") {
        delete c.buildSettings.MARKETING_VERSION;
        delete c.buildSettings.CURRENT_PROJECT_VERSION;
      }
    ext.withExtensionTargets(p, manifest, {
      bundleIdentifier: "dev.lucent.hello",
      version: "2.3.0",
      buildNumber: "7",
    });
    const [, rich] = named(p, "RichPush")!;
    const configs = p.pbxXCBuildConfigurationSection();
    const list = p.pbxXCConfigurationList()[rich.buildConfigurationList as string]!;
    for (const r of list.buildConfigurations) {
      expect(unquote(configs[r.value]!.buildSettings.MARKETING_VERSION)).toBe("2.3.0");
      expect(unquote(configs[r.value]!.buildSettings.CURRENT_PROJECT_VERSION)).toBe("7");
    }
  });

  it("takes a bare app's bundle identifier from its target, and needs one", () => {
    const { project: p } = project();
    ext.withExtensionTargets(p, manifest, {});
    const [, rich] = named(p, "RichPush")!;
    const configs = p.pbxXCBuildConfigurationSection();
    const list = p.pbxXCConfigurationList()[rich.buildConfigurationList as string]!;
    // The template's is under $(PRODUCT_NAME:rfc1034identifier), the app's product name.
    expect(
      unquote(configs[list.buildConfigurations[0]!.value]!.buildSettings.PRODUCT_BUNDLE_IDENTIFIER),
    ).toBe("org.reactjs.native.example.HelloWorld.RichPush");

    const { project: none } = project();
    for (const c of Object.values(none.pbxXCBuildConfigurationSection()))
      if (typeof c === "object") delete c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER;
    expect(() => ext.withExtensionTargets(none, manifest, {})).toThrow(
      "the app's bundle identifier is needed",
    );
  });

  it("has its Info.plist, entitlements and source in a directory of its own", () => {
    const ios = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ios-"));
    ext.writeExtensionFiles(ios, manifest);

    const plist = require("@expo/plist") as { default: { parse(xml: string): unknown } };
    const parse = (xml: string) => plist.default.parse(xml);
    expect(parse(fs.readFileSync(path.join(ios, "RichPush/Info.plist"), "utf8"))).toEqual(
      manifest.extensions[0]!.infoPlist,
    );
    expect(
      parse(fs.readFileSync(path.join(ios, "RichPush/RichPush.entitlements"), "utf8")),
    ).toEqual(manifest.extensions[0]!.entitlements);
    expect(fs.readFileSync(path.join(ios, "RichPush/LucentExtension.m"), "utf8")).toBe(
      "// links\n",
    );
    expect(ext.plistXml({ a: "<&>", b: true, c: [] })).toContain("<string>&lt;&amp;&gt;</string>");
  });
});

describe("an app extension's target in the Podfile", () => {
  const podfile = fs.readFileSync(path.join(template, "Podfile"), "utf8");

  it("names its subspec, from the native package, once", () => {
    const text = ext.withExtensionPods(podfile, manifest, "../.lucent/native")!;
    expect(text).toBe(
      `${podfile}\n# Lucent's app extensions (decision 0124): a target each.\ntarget 'RichPush' do\n  pod 'LucentExtensions/RichPush', :path => '../.lucent/native'\nend\n`,
    );
    expect(ext.withExtensionPods(text, manifest, "../.lucent/native")).toBeUndefined();
  });
});

describe("the native package's ios-extensions.json", () => {
  it("is read when it is of this format, and refused when it is another", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-app-"));
    expect(ext.readExtensionTargets(root)).toBeUndefined();
    fs.mkdirSync(path.join(root, ".lucent/native"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".lucent/native/ios-extensions.json"),
      JSON.stringify(manifest),
    );
    expect(ext.readExtensionTargets(root)).toEqual(manifest);
    fs.writeFileSync(
      path.join(root, ".lucent/native/ios-extensions.json"),
      JSON.stringify({ ...manifest, format: 2 }),
    );
    expect(() => ext.readExtensionTargets(root)).toThrow("of format 2");
  });

  it("is what the Expo config plugin's Xcode project mod adds", () => {
    expect(plugin({ name: "app", slug: "app", ios: {} }).mods?.ios?.xcodeproj).toBeDefined();
  });
});
