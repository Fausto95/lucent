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
      'import {Badge} from "@lucent-lang/widgets"; import type {NativeView} from "@lucent-lang/ui"; export function Demo():NativeView{return <Badge/>;}',
      { fileName: "demo.lucent.tsx", libraries: { "@lucent-lang/widgets": library } },
    );
    expect(result.diagnostics).toEqual([]);
    const files = host.emitPackage([result.module!], { packageName: "lucent" });
    expect([...files].some(([path, body]) => path.endsWith("Badge.swift") && body.includes("PackageBadge"))).toBe(true);
    expect([...files].find(([path]) => path.endsWith("Badge.kt"))?.[1]).not.toContain("{{androidPackage}}");
    expect([...files].find(([path]) => path.endsWith(".podspec"))?.[1]).toContain("WidgetSDK");
    expect(files.get("android/build.gradle")).toContain("dev.widgets:ui:1.0.0");
  });
