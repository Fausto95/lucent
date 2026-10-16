/**
 * An iOS app extension's native build (decision 0124): the program of the
 * modules its code reaches through its imports, compiled again for iOS
 * into ios-extensions/<name>/ without the JSI units, and a subspec of
 * LucentExtensions.podspec building it with the runtime's JSI-free core,
 * under LUCENT_APP_EXTENSION. Compiled against a schema set, on any
 * machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, resolveNative, writeNativePackage } from "../src/index.ts";
import { schemaSet } from "./schema-set.ts";

const KIT = {
  module: "Kit",
  header: "Kit/Kit.h",
  types: [
    {
      kind: "class",
      name: "KITService",
      native: "KITService",
      constructors: [{ params: [], selector: "init" }],
    },
  ],
};
const set = schemaSet([KIT]);

/** lucent-push, whose notification service extension's class imports another module. */
function build(principal = "export class Rich extends KITService {}", native: object = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ext-build-"));
  const files: Record<string, string> = {
    "package.json": '{ "name": "lucent-push", "version": "1.0.0", "lucent": {} }\n',
    "lucent.json": JSON.stringify({
      ios: {
        appExtensions: [{ kind: "notificationService", name: "RichPush", class: "push#Rich" }],
        ...native,
      },
    }),
    "push.lucent.ts": "export declare function badge(): string;\n",
    "push.ios.lucent.ts": `import { KITService } from "lucent:ios/Kit";
import { title } from "./shared.lucent";

${principal}

export function badge(): string {
  return title();
}
`,
    "push.android.lucent.ts": 'export function badge(): string {\n  return "";\n}\n',
    "shared.lucent.ts": 'export function title(): string {\n  return "t";\n}\n',
    // The app's alone: no extension's code imports it.
    "app.lucent.ts": 'export function hello(): string {\n  return "hi";\n}\n',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const result = compile(
    Object.keys(files)
      .filter((f) => f.endsWith(".lucent.ts"))
      .map((f) => path.join(dir, f)),
    {
      platforms: ["ios"],
      sdk: {
        schemas: set,
        cacheDir: path.join(dir, "cache"),
        ios: { xcrun: path.join(dir, "no-xcrun") },
      },
    },
  );
  return { dir, result };
}

describe("an app extension's build", () => {
  it("compiles the modules its code reaches, and no JSI unit", () => {
    const { result } = build();
    expect(result.diagnostics).toEqual([]);

    const files = [...result.files.keys()];
    const own = files.filter((f) => f.startsWith("ios-extensions/RichPush/"));
    expect(own.map((f) => f.slice("ios-extensions/RichPush/".length)).sort()).toEqual(
      [
        "LucentExports.swift",
        "lucent_app.h",
        "lucent_app_C_Rich.h",
        "lucent_entries.cpp",
        "lucent_entries.h",
        "m_lucent_u2d_push_u2f_push.h",
        "m_lucent_u2d_push_u2f_push.mm",
        "m_lucent_u2d_push_u2f_shared.cpp",
        "m_lucent_u2d_push_u2f_shared.h",
      ].sort(),
    );
    // The app's own build has every module and the JSI units.
    expect(files).toContain("ios/m_lucent_u2d_push_u2f_app.cpp");
    expect(files).toContain("ios/lucent_bindings.cpp");

    // Its module state is the modules it reaches', in import order.
    const entries = result.files.get("ios-extensions/RichPush/lucent_entries.cpp")!;
    expect(entries).toMatch(
      /void initModules\(\) \{[^}]*?lucent_app::m_lucent_u2d_push_u2f_shared::init\(\);\s*lucent_app::m_lucent_u2d_push_u2f_push::init\(\);\s*\}\s*\}/,
    );
    expect(entries).not.toContain("m_lucent_u2d_push_u2f_app");
    // Its principal class is one the OS makes.
    expect(result.files.get("ios-extensions/RichPush/m_lucent_u2d_push_u2f_push.mm")).toContain(
      "- (instancetype)init {",
    );
    // The frameworks its code uses: the subspec links them.
    expect(result.appExtensions).toEqual({ RichPush: { frameworks: ["Kit"] } });
  });

  it("is a subspec of LucentExtensions.podspec, which LucentNative's sources leave out", () => {
    const { dir, result } = build();
    const out = path.join(dir, ".lucent/native");
    writeNativePackage(result, out, { root: dir });

    const podspec = fs.readFileSync(path.join(out, "LucentExtensions.podspec"), "utf8");
    expect(podspec).toContain('s.name         = "LucentExtensions"');
    expect(podspec).toContain("s.default_subspecs = :none");
    expect(podspec).toContain('s.subspec "RichPush" do |e|');
    expect(podspec).toContain('"APPLICATION_EXTENSION_API_ONLY" => "YES"');
    expect(podspec).toContain(
      '"GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) LUCENT_APP_EXTENSION=1"',
    );
    expect(podspec).toContain("-ffp-contract=off");
    expect(podspec).toContain('"cpp/generated/ios-extensions/RichPush/**/*.{h,cpp,mm,swift}"');
    expect(podspec).toContain('s.swift_version = "5.9"');
    expect(podspec).toContain('e.frameworks = ["CoreFoundation", "Kit"]');
    // The runtime's JSI-free core and its iOS files, but none that reaches JSI, React Native or Yoga.
    const sources = /e\.source_files = (\[.*\])/.exec(podspec)![1]!;
    expect(sources).toContain('"cpp/lucent/platform/ios.mm"');
    expect(sources).toContain('"cpp/lucent/platform/ios_ui.mm"');
    expect(sources).not.toMatch(/ios_layout\.mm|cpp\/rn\/|lucent\/jsi\//);
    const listed = (JSON.parse(sources) as string[]).filter((f) => !f.includes("*"));
    expect(listed.filter((f) => !fs.existsSync(path.join(out, f)))).toEqual([]);
    // The project's directory is mapped to ".", as LucentNative's is.
    expect(podspec).toMatch(/lucent_root = File\.expand_path\("\.\.\/\.\.", __dir__\)/);

    const native = fs.readFileSync(path.join(out, "LucentNative.podspec"), "utf8");
    expect(native).toContain('"cpp/generated/ios-extensions/**"');
    expect(
      fs.existsSync(path.join(out, "cpp/generated/ios-extensions/RichPush/lucent_entries.cpp")),
    ).toBe(true);
  });

  it("is none without an app extension", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-no-ext-"));
    fs.writeFileSync(
      path.join(dir, "a.lucent.ts"),
      "export function f(): number {\n  return 1;\n}\n",
    );
    const result = compile([path.join(dir, "a.lucent.ts")]);
    const out = path.join(dir, "native");
    writeNativePackage(result, out, { root: dir });

    expect(result.appExtensions).toBeUndefined();
    expect(fs.existsSync(path.join(out, "LucentExtensions.podspec"))).toBe(false);
  });
});

describe("an app extension's target", () => {
  it("is recorded for the Expo plugin and lucent init: its Info.plist, entitlements and source", () => {
    const { dir, result } = build(undefined, {
      appGroups: ["group.dev.lucent.push"],
      appExtensions: [
        {
          kind: "notificationService",
          name: "RichPush",
          class: "push#Rich",
          displayName: undefined,
          infoPlist: { NSExtensionOptions: "x", LSMinimumSystemVersion: "16.0" },
          entitlements: { "keychain-access-groups": ["$(AppIdentifierPrefix)dev.lucent"] },
        },
      ],
    });
    expect(result.diagnostics).toEqual([]);
    const out = path.join(dir, ".lucent/native");
    const native = resolveNative([{ name: "lucent-push", version: "1.0.0", dir, sources: dir }]);
    writeNativePackage(result, out, { root: dir, native });

    const manifest = JSON.parse(fs.readFileSync(path.join(out, "ios-extensions.json"), "utf8"));
    expect(manifest.format).toBe(1);
    expect(manifest.nativePackage).toBe(".lucent/native");
    expect(manifest.extensions).toHaveLength(1);
    const [rich] = manifest.extensions;
    expect(rich).toMatchObject({
      name: "RichPush",
      kind: "notificationService",
      pod: "LucentExtensions/RichPush",
      entitlements: {
        "com.apple.security.application-groups": ["group.dev.lucent.push"],
        "keychain-access-groups": ["$(AppIdentifierPrefix)dev.lucent"],
      },
    });
    expect(rich.infoPlist).toMatchObject({
      CFBundleDisplayName: "RichPush",
      CFBundleShortVersionString: "$(MARKETING_VERSION)",
      CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
      LSMinimumSystemVersion: "16.0",
      NSExtension: {
        NSExtensionPointIdentifier: "com.apple.usernotifications.service",
        NSExtensionPrincipalClass: "LucentApp_lucent_push_push_Rich",
        NSExtensionAttributes: { NSExtensionOptions: "x" },
      },
    });
    expect(rich.sources["LucentExtension.m"]).toContain(
      "return [LucentApp_lucent_push_push_Rich class];",
    );
    // The principal class the manifest names is the one the extension's build compiles.
    expect(result.files.get("ios-extensions/RichPush/m_lucent_u2d_push_u2f_push.mm")).toContain(
      "@interface LucentApp_lucent_push_push_Rich : KITService",
    );
  });

  it("names a principal class the OS makes with init, or the build fails", () => {
    const code = (principal: string) =>
      build(principal).result.diagnostics.map((d) => `${d.code} ${d.message}`);
    const why = "LUCENT3019 the app extension RichPush's principal class is one the OS makes:";

    expect(code("export class Other extends KITService {}")).toEqual([
      `${why} lucent-push/push has no class Rich`,
    ]);
    expect(code("class Rich extends KITService {}")).toEqual([`${why} Rich isn't exported`]);
    expect(
      code(
        "export class Rich extends KITService {\n  constructor(readonly n: number) {\n    super();\n  }\n}",
      ),
    ).toEqual([
      `${why} the OS makes Rich with init, so its constructor and its super(…) take nothing`,
    ]);
  });
});
