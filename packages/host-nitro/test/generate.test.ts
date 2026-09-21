import { describe, expect, test } from "vite-plus/test";
import { join } from "node:path";
import { compile, type IRModule } from "@lucent-lang/compiler";
import { nitroHost } from "../src/index.ts";
import { FIXTURES, expectGolden, fixtureNames, readFixture } from "../../compiler/test/golden.ts";

const modules: IRModule[] = fixtureNames().map((name) => {
  const { source, fileName } = readFixture(name);
  const r = compile(source, { fileName });
  if (!r.module) throw new Error(name);
  return r.module;
});

describe("nitro host (golden)", () => {
  const files = nitroHost.emitPackage(modules, { packageName: "lucent" });

  test("emits one library package for all modules", () => {
    const paths = [...files.keys()].toSorted();
    expect(paths).toContain("package.json");
    expect(paths).toContain("nitro.json");
    expect(paths).toContain("NitroLucent.podspec");
    expect(paths).toContain("react-native.config.js");
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/specs/Add.nitro.ts");
    expect(paths).toContain("ios/LucentRuntime.swift");
    expect(paths).toContain("ios/HybridAdd.swift");
    expect(paths).toContain("android/build.gradle");
    expect(paths).toContain("android/CMakeLists.txt");
    expect(paths).toContain("android/src/main/AndroidManifest.xml");
    expect(paths).toContain("android/src/main/cpp/cpp-adapter.cpp");
    expect(paths).toContain("android/src/main/java/com/margelo/nitro/lucent/LucentPackage.kt");
    expect(paths).toContain("android/src/main/java/com/margelo/nitro/lucent/LucentRuntime.kt");
    expect(paths).toContain("android/src/main/java/com/margelo/nitro/lucent/HybridAdd.kt");
  });

  for (const [path, contents] of files) {
    test(path, () => {
      expectGolden(contents, join(FIXTURES, "nitro", path.replace(/\//g, "__")));
    });
  }

  test("nitro.json registers every hybrid object in the current schema", () => {
    const config = JSON.parse(files.get("nitro.json")!);
    expect(config.ios.iosModuleName).toBe("NitroLucent");
    expect(config.android.androidCxxLibName).toBe("NitroLucent");
    expect(config.autolinking.Fibonacci).toEqual({
      ios: { language: "swift", implementationClassName: "HybridFibonacci" },
      android: { language: "kotlin", implementationClassName: "HybridFibonacci" },
    });
  });

  test("specs declare structs as interfaces and optionals with undefined", () => {
    const spec = files.get("src/specs/StructRoundtrip.nitro.ts")!;
    expect(spec).toContain("export interface StructRoundtripUser {");
    expect(spec).toContain("nickname?: string;");
    expect(spec).toContain("extends HybridObject<{ ios: 'swift'; android: 'kotlin' }>");
    expect(spec).toContain("birthday(user: StructRoundtripUser): StructRoundtripUser;");
  });
});

describe("nitro host proxies", () => {
  for (const m of modules) {
    test(`${m.name} proxy`, () => {
      const { js, dts } = nitroHost.emitProxy(m);
      expectGolden(js, join(FIXTURES, "nitro", `proxy__${m.name}.js`));
      expectGolden(dts, join(FIXTURES, "nitro", `proxy__${m.name}.d.ts`));
    });
  }

  test("proxy creates the hybrid object and maps null to undefined for optionals", () => {
    const m = modules.find((x) => x.name === "struct-roundtrip")!;
    const { js } = nitroHost.emitProxy(m);
    expect(js).toContain('createHybridObject("StructRoundtrip")');
    expect(js).toContain("? undefined :");
    expect(js).toContain("? null :");
  });
});
