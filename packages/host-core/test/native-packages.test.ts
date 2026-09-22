import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../../compiler/src/index.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";
const library: LibraryModule = {
  source: "",
  native: {
    swift: { "Badge.swift": 'import SwiftUI\nstruct PackageBadge:View { var body: some View { Text("native") } }' },
    kotlin: { "Badge.kt": "package {{androidPackage}}\n@androidx.compose.runtime.Composable fun PackageBadge() {}" },
    dependencies: { pods: { WidgetSDK: "~> 1.0" }, android: ["dev.widgets:ui:1.0.0"] },
  },
  views: {
    Badge: {
      props: {},
      children: "none",
      swift: { template: "PackageBadge()" },
      kotlin: { template: "PackageBadge()" },
    },
  },
};
for (const [name, host] of [
  ["expo", expoHost],
  ["nitro", nitroHost],
] as const)
  test(`${name} includes native package sources and dependencies`, () => {
    const result = compile(
      'import {Badge} from "@lucent-lang/widgets"; import type {NativeView} from "@lucent-lang/core/ui"; export function Demo():NativeView{return <Badge/>;}',
      { fileName: "demo.lucent.tsx", libraries: { "@lucent-lang/widgets": library } },
    );
    expect(result.diagnostics).toEqual([]);
    const files = host.emitPackage([result.module!], { packageName: "lucent" });
    expect([...files].some(([path, body]) => path.endsWith("Badge.swift") && body.includes("PackageBadge"))).toBe(true);
    expect([...files].find(([path]) => path.endsWith("Badge.kt"))?.[1]).not.toContain("{{androidPackage}}");
    expect([...files].find(([path]) => path.endsWith(".podspec"))?.[1]).toContain("WidgetSDK");
    expect(files.get("android/build.gradle")).toContain("dev.widgets:ui:1.0.0");
  });

for (const [name, host] of [
  ["expo", expoHost],
  ["nitro", nitroHost],
] as const)
  test(`${name} propagates minimum native targets to build files`, () => {
    const result = compile("export function value():number{return 1;}", {
      fileName: "target.lucent.ts",
      targets: { ios: "17.0", android: 30 },
    });
    const files = host.emitPackage([result.module!], { packageName: "lucent" });
    expect([...files].find(([path]) => path.endsWith(".podspec"))?.[1]).toContain('Gem::Version.new("17.0")');
    expect(files.get("android/build.gradle")).toContain("Math.max(android.defaultConfig.minSdkVersion.apiLevel, 30)");
  });

const moduleWith = (
  specifier: string,
  dependencies: NonNullable<NonNullable<LibraryModule["native"]>["dependencies"]>,
) => {
  const result = compile(`import { ping } from "${specifier}"; export function value():number{return ping();}`, {
    fileName: `${specifier.split("/").at(-1)}.lucent.ts`,
    libraries: {
      [specifier]: {
        source: "export declare function ping():number;",
        bindings: { ping: { swift: ["return 1"], kotlin: ["return 1.0"] } },
        native: { dependencies },
      },
    },
  });
  expect(result.diagnostics).toEqual([]);
  return result.module!;
};

for (const [name, host] of [
  ["expo", expoHost],
  ["nitro", nitroHost],
] as const) {
  test(`${name} rejects competing Android versions with package provenance`, () => {
    const modules = [
      moduleWith("@sdk/camera", { android: ["dev.sdk:core:1.0"] }),
      moduleWith("@sdk/player", { android: ["dev.sdk:core:2.0"] }),
    ];
    expect(() => host.emitPackage(modules, { packageName: "lucent" })).toThrow(
      /dev.sdk:core.*1.0.*@sdk\/camera.*2.0.*@sdk\/player/s,
    );
  });
  test(`${name} rejects competing pod requirements with package provenance`, () => {
    const modules = [
      moduleWith("@sdk/camera", { pods: { SDK: "~> 1.0" } }),
      moduleWith("@sdk/player", { pods: { SDK: "~> 2.0" } }),
    ];
    expect(() => host.emitPackage(modules, { packageName: "lucent" })).toThrow(
      /SDK.*~> 1.0.*@sdk\/camera.*~> 2.0.*@sdk\/player/s,
    );
  });
  test(`${name} deduplicates compatible identical requirements`, () => {
    const dependencies = { pods: { SDK: "~> 1.0" }, android: ["dev.sdk:core:1.0"] };
    const files = host.emitPackage([moduleWith("@sdk/camera", dependencies), moduleWith("@sdk/player", dependencies)], {
      packageName: "lucent",
    });
    expect(files.get("android/build.gradle")!.match(/implementation "dev.sdk:core:1.0"/g)).toHaveLength(1);
    expect([...files].find(([p]) => p.endsWith(".podspec"))![1].match(/s.dependency "SDK"/g)).toHaveLength(1);
  });
}

test("a dependency conflict leaves the output tree unchanged", async () => {
  const { emitNativePackages } = await import("../src/native-packages.ts");
  const files = new Map([["android/build.gradle", "original"]]);
  const original = [...files];
  const module = compile("export function value():number{return 1;}", { fileName: "atomic.lucent.ts" }).module!;
  module.nativePackages = {
    camera: {
      origin: "@sdk/camera",
      kotlin: { "Camera.kt": "new source" },
      dependencies: { android: ["dev.sdk:core:1.0"] },
    },
    player: { origin: "@sdk/player", dependencies: { android: ["dev.sdk:core:2.0:debug@aar"] } },
  };
  expect(() => emitNativePackages(files, [module], "test.native")).toThrow("Conflicting Android dependency");
  expect([...files]).toEqual(original);
});

test("malformed Android coordinates fail with an actionable error", async () => {
  const { emitNativePackages } = await import("../src/native-packages.ts");
  const module = compile("export function value():number{return 1;}", { fileName: "bad.lucent.ts" }).module!;
  module.nativePackages = { camera: { dependencies: { android: ["dev.sdk:core"] } } };
  expect(() => emitNativePackages(new Map(), [module], "test.native")).toThrow("expected group:artifact:version");
});
