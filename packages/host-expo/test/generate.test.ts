import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compile, type IRModule } from "@lucent/compiler";
import { expoHost } from "../src/index.ts";
import { FIXTURES, expectGolden, fixtureNames, readFixture } from "../../compiler/test/golden.ts";

const modules: IRModule[] = fixtureNames().map((name) => {
  const { source, fileName } = readFixture(name);
  const r = compile(source, { fileName });
  if (!r.module) throw new Error(name);
  return r.module;
});

describe("expo host (golden)", () => {
  const files = expoHost.emitPackage(modules, { packageName: "lucent" });

  test("emits one file tree for all modules", () => {
    const paths = [...files.keys()].sort();
    expect(paths).toContain("expo-module.config.json");
    expect(paths).toContain("package.json");
    expect(paths).toContain("ios/Lucent.podspec");
    expect(paths).toContain("ios/LucentRuntime.swift");
    expect(paths).toContain("ios/LucentAddModule.swift");
    expect(paths).toContain("android/build.gradle");
    expect(paths).toContain("android/src/main/AndroidManifest.xml");
    expect(paths).toContain("android/src/main/java/expo/modules/lucent/LucentRuntime.kt");
    expect(paths).toContain("android/src/main/java/expo/modules/lucent/LucentAddModule.kt");
    expect(paths).toContain(".gitignore");
  });

  for (const [path, contents] of files) {
    test(path, () => {
      expectGolden(contents, join(FIXTURES, "expo", path.replace(/\//g, "__")));
    });
  }

  test("module config lists every module class on both platforms", () => {
    const config = JSON.parse(files.get("expo-module.config.json")!);
    expect(config.platforms).toEqual(["apple", "android"]);
    expect(config.apple.modules).toContain("LucentFibonacciModule");
    expect(config.android.modules).toContain("expo.modules.lucent.LucentFibonacciModule");
  });
});

describe("expo host proxies", () => {
  for (const m of modules) {
    test(`${m.name} proxy`, () => {
      const { js, dts } = expoHost.emitProxy(m);
      expectGolden(js, join(FIXTURES, "expo", `proxy__${m.name}.js`));
      expectGolden(dts, join(FIXTURES, "expo", `proxy__${m.name}.d.ts`));
    });
  }

  test("proxy converts bytes and wraps errors", () => {
    const bytes = modules.find((m) => m.name === "bytes")!;
    const { js } = expoHost.emitProxy(bytes);
    expect(js).toContain("requireNativeModule");
    expect(js).toContain("Lucent_bytes");
    expect(js).toContain(".buffer");
  });
});
