import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { compile, runtimeDir, writeNativePackage } from "../src/index.ts";
import { createLucentProgram } from "../src/program.ts";
import { androidJars, sdkAvailable } from "@lucent-lang/bindgen";
import { jniDescriptor, loadSdkModule } from "../src/sdk/schema.ts";

function project(sources: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-platforms-"));
  return Object.entries(sources).map(([name, src]) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, src);
    return f;
  });
}

/** TypeScript diagnostics of one platform program, as "TS<code>" per line (1-based). */
function tsErrors(platform: "ios" | "android", source: string): string[] {
  const [file] = project({ [`probe.${platform}.lucent.ts`]: source });
  return createLucentProgram([file!], undefined, platform).diagnostics.map((d) => `${d.line}: ${d.message.split(":")[0]}`);
}

const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map((d) => d.code);

// Most of these compile both platforms: they need an iOS SDK (Xcode, or the
// prebuilt @lucent-lang/sdk-ios); hosts without one run the Android suites.
const ios = sdkAvailable("ios");
const android = sdkAvailable("android");

const haptics = {
  "haptics.lucent.ts": "export declare function impact(): Promise<void>;\nexport declare function model(): Promise<string>;\n",
  "haptics.ios.lucent.ts": `import { UIDevice, UIImpactFeedbackGenerator, UIImpactFeedbackGenerator_FeedbackStyle as Style } from "lucent:ios/UIKit";
import { main } from "lucent:thread";

export function impact(): Promise<void> {
  return main(() => {
    const generator = new UIImpactFeedbackGenerator(Style.medium);
    generator.prepare();
    generator.impactOccurred();
    generator.impactOccurred(0.5);
  });
}

export function model(): Promise<string> {
  return main(() => (UIDevice.current === UIDevice.current ? UIDevice.current.model : ""));
}
`,
  "haptics.android.lucent.ts": `import { Build, Build_VERSION, Looper, VibrationEffect, Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";

export async function impact(): Promise<void> {
  const context = appContext();
  const vibrator = available("android", 31) ? context.getSystemService(VibratorManager)?.defaultVibrator : context.getSystemService(Vibrator);
  if (!vibrator) return;
  if (Build_VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform([0, 43], [0, 50], -1));
  else vibrator.vibrate([0, 43], -1);
}

export async function model(): Promise<string> {
  return Looper.myLooper() === Looper.getMainLooper() ? "main" : (Build.MODEL ?? "unknown");
}
`,
};

describe("SDK bindings: types", () => {
  it.skipIf(!ios)("types iOS classes nominally, with Swift names, enums and class properties", () => {
    const src = `import { UIApplicationDelegate, UIDevice, UIFeedbackGenerator, UIImpactFeedbackGenerator, UIImpactFeedbackGenerator_FeedbackStyle as Style, UISelectionFeedbackGenerator } from "lucent:ios/UIKit";
export function f(): string {
  const g = new UIImpactFeedbackGenerator(Style.heavy);
  const base: UIFeedbackGenerator = g;
  void base;
  const wrong: UIImpactFeedbackGenerator = new UISelectionFeedbackGenerator();
  void wrong;
  new UIApplicationDelegate();
  return UIDevice.current.systemName;
}
`;
    // Protocols cannot be constructed; classes inherit NSObject's init as in Swift.
    expect(tsErrors("ios", src)).toEqual(["6: TS2739", "8: TS2511"]);
  });

  it.skipIf(!android)("types Java classes: nullability, primitive arrays, Class<T> and getter properties", () => {
    const src = `import { Build, VibrationEffect, Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext } from "lucent:android";
export function f(): number {
  const model: string = Build.MODEL;
  const v: Vibrator | null = appContext().getSystemService(Vibrator);
  const d: Vibrator | undefined = appContext().getSystemService(VibratorManager)?.defaultVibrator;
  const e = VibrationEffect.createWaveform([0, 40], [0, 50], -1);
  void model; void v; void d; void e;
  return VibrationEffect.EFFECT_CLICK;
}
`;
    expect(tsErrors("android", src)).toEqual(["4: TS2322"]);
  });

  it("derives JNI descriptors that exist in android.jar", () => {
    // The jar the schemas are extracted from.
    const jar = androidJars()?.[0];
    const javap = spawnSync("javap", ["-version"]).status === 0;
    if (!jar || !javap) return;
    for (const mod of ["android.os", "android.content"]) {
      const schema = loadSdkModule("android", mod);
      const classes = schema.types.filter((t) => t.kind === "class");
      // One javap for the package: each class's dump starts with "Compiled from".
      const all = spawnSync("javap", ["-s", "-cp", jar, ...classes.map((c) => c.native.replace(/\//g, "."))], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).stdout;
      const dumps = all.split(/^(?=Compiled from )/m).filter((d) => d.startsWith("Compiled from"));
      expect(dumps).toHaveLength(classes.length);
      for (const [i, cls] of classes.entries()) {
        if (cls.kind !== "class") continue;
        const dump = dumps[i]!;
        for (const m of [...(cls.methods ?? []), ...(cls.constructors ?? []).map((c) => ({ ...c, name: "<init>", returns: "void", typeParams: [] }))]) {
          expect(dump, `${cls.name}.${m.name}`).toContain(`descriptor: ${m.descriptor ?? jniDescriptor(m.params.map((p) => p.type), m.returns, m.typeParams)}`);
        }
        for (const p of cls.properties ?? []) {
          const d = p.getter ? jniDescriptor([], p.type) : jniDescriptor([], p.type).slice(2);
          expect(dump, `${cls.name}.${p.name}`).toContain(`descriptor: ${d}`);
        }
      }
    }
  });
});

describe.skipIf(!ios)("platform modules", () => {
  it("compiles each platform's implementation against the shared declaration", () => {
    const r = compile(project(haptics));
    expect(r.diagnostics).toEqual([]);
    const keys = [...r.files.keys()];
    expect(keys).toEqual(expect.arrayContaining(["ios/lucent_app.h", "ios/m_haptics.h", "ios/m_haptics.mm", "ios/lucent_bindings.cpp", "android/m_haptics.cpp", "android/lucent_bindings.cpp"]));
    expect(keys.filter((k) => !k.startsWith("ios/") && !k.startsWith("android/"))).toEqual([]);
    expect([...r.proxies.keys()]).toEqual(["haptics"]);
    expect(r.proxies.get("haptics")).toContain("impact");
  });

  it("writes the SDK declarations it imports, so editors and tsc resolve lucent:*", () => {
    const files = project(haptics);
    const r = compile(files);
    expect([...r.types!.keys()].sort()).toEqual(expect.arrayContaining(["android.d.ts", "android/android.content.d.ts", "android/android.os.d.ts", "ios.d.ts", "ios/UIKit.d.ts", "thread.d.ts"]));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-types-"));
    writeNativePackage(r, out);
    // An app's own TypeScript program: both platforms at once, lucent:* mapped to the written files.
    const program = ts.createProgram(files, {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      // As in React Native's and Expo's tsconfig bases.
      skipLibCheck: true,
      paths: { "lucent:*": [path.join(out, "types/*")] },
    });
    expect(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
  });

  it("types other frameworks in signatures by name, without extracting them", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cache-"));
    const r = compile(project(haptics), { platforms: ["ios"], sdk: { cacheDir } });
    expect(r.diagnostics).toEqual([]);
    const [key] = fs.readdirSync(path.join(cacheDir, "sdk/ios"));
    const schemas = fs.readdirSync(path.join(cacheDir, "sdk/ios", key!)).filter((f) => f.endsWith(".json") && !f.endsWith(".names.json") && f !== "headers.json");
    // Only what the program imports gets a full schema.
    expect(schemas).toEqual(["UIKit.json"]);
    expect(r.types!.get("ios/Foundation.d.ts")).toMatch(/Names only: import lucent:ios\/Foundation/);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }, 600_000);

  it("keeps the single layout for projects without platform files", () => {
    const r = compile(project({ "plain.lucent.ts": "export function one(): number { return 1; }\n" }));
    expect([...r.files.keys()].sort()).toEqual(["lucent_app.h", "lucent_bindings.cpp", "m_plain.cpp", "m_plain.h"]);
  });

  it("compiles platform modules to stubs that throw for the host target", () => {
    const r = compile(project(haptics), { platforms: ["host"] });
    expect(r.diagnostics).toEqual([]);
    const stub = r.files.get("host/m_haptics.cpp")!;
    expect(stub).toContain("is not available on this platform");
    expect([...r.files.keys()].some((k) => k.startsWith("ios/"))).toBe(false);
  });

  it("reports a missing SDK with the fix", () => {
    const r = compile(project(haptics), { platforms: ["android"], sdk: { android: { sdkRoots: [path.join(os.tmpdir(), "no-such-android-sdk")] }, prebuilt: false } });
    expect(r.diagnostics.map((d) => d.code)).toContain("LUCENT3004");
    expect(r.diagnostics.find((d) => d.code === "LUCENT3004")!.message).toMatch(/Android SDK.*not found.*ANDROID_HOME/s);
  });

  it("rejects SDK imports from the other platform and unknown SDK modules", () => {
    const r = compile(
      project({
        "m.lucent.ts": "export declare function f(): number;\n",
        "m.ios.lucent.ts": 'import { Build } from "lucent:android/android.os";\nexport function f(): number { return 1; }\n',
        "m.android.lucent.ts": 'import { Nope } from "lucent:android/android.nope";\nexport function f(): number { return 1; }\n',
      }),
    );
    expect(r.diagnostics.map((d) => [d.code, path.basename(d.file ?? "")])).toEqual(
      expect.arrayContaining([
        ["LUCENT3004", "m.ios.lucent.ts"],
        ["LUCENT3004", "m.android.lucent.ts"],
      ]),
    );
    expect(r.diagnostics.find((d) => d.file?.endsWith("m.ios.lucent.ts"))!.message).toMatch(/lucent:android\/android\.os.*\.android\.lucent\.ts/);
  });

  it("requires every platform to implement the declared exports with assignable types", () => {
    const missing = compile(project({ ...haptics, "haptics.android.lucent.ts": "export async function impact(): Promise<void> {}\n" }));
    expect(codes(missing)).toEqual(["LUCENT3005"]);
    expect(missing.diagnostics[0]!.message).toMatch(/haptics\.android\.lucent\.ts does not export model/);

    const mismatch = compile(project({ ...haptics, "haptics.android.lucent.ts": haptics["haptics.android.lucent.ts"].replace("async function model(): Promise<string>", "async function model(): Promise<number>").replace('"main" : (Build.MODEL ?? "unknown")', "1 : 0") }));
    expect(codes(mismatch)).toEqual(["LUCENT3005"]);
    expect(mismatch.diagnostics[0]!.message).toMatch(/model/);

    const { "haptics.android.lucent.ts": _android, ...iosOnly } = haptics;
    void _android;
    expect(codes(compile(project(iosOnly)))).toEqual(["LUCENT3005"]);
  });

  it("allows only declarations in a platform module's shared file", () => {
    const r = compile(project({ ...haptics, "haptics.lucent.ts": `${haptics["haptics.lucent.ts"]}export function extra(): number { return 1; }\n` }));
    expect(codes(r)).toContain("LUCENT3005");
  });
});

const device = {
  "device.lucent.ts": `import { PLATFORM } from "lucent:platform";
import { UIDevice } from "lucent:ios/UIKit";
import { Build } from "lucent:android/android.os";
import { main } from "lucent:thread";

export async function model(): Promise<string> {
  if (PLATFORM === "ios") {
    return main(() => UIDevice.current.model);
  } else {
    return Build.MODEL ?? "unknown";
  }
}

export function vendor(): string {
  return PLATFORM !== "ios" ? Build.MANUFACTURER ?? "" : "Apple";
}

export function which(): string {
  return PLATFORM;
}
`,
};

describe("platform branches in one module", () => {
  it.skipIf(!ios || !android)("compiles each target's branch only", () => {
    const r = compile(project(device));
    expect(r.diagnostics).toEqual([]);
    const mm = r.files.get("ios/m_device.mm")!;
    expect(mm).toContain("UIDevice");
    expect(mm).not.toContain("android/os/Build");
    expect(mm).toContain('LUCENT_STR("ios")');
    const cpp = r.files.get("android/m_device.cpp")!;
    expect(cpp).toContain("android/os/Build");
    expect(cpp).not.toContain("UIDevice");
    expect(cpp).toContain('LUCENT_STR("android")');
    expect([...r.proxies.keys()]).toEqual(["device"]);
  });

  it.skipIf(!ios)("type-checks the other platform's branch as untyped when its SDK is missing", () => {
    const r = compile(project(device), { platforms: ["ios"], sdk: { android: { sdkRoots: [path.join(os.tmpdir(), "no-such-android-sdk")] }, prebuilt: false } });
    expect(r.diagnostics).toEqual([]);
    expect(r.files.get("ios/m_device.mm")).toContain("UIDevice");
  });

  it("throws in platform branches on the host target", () => {
    const r = compile(project(device), { platforms: ["host"] });
    expect(r.diagnostics).toEqual([]);
    const cpp = r.files.get("host/m_device.cpp")!;
    expect(cpp).toContain("runs only on iOS and Android");
    expect(cpp).not.toContain("UIDevice");
  });

  it.skipIf(!ios || !android || process.platform !== "darwin")("generates code each target compiles: iOS, Android (NDK) and the host", () => {
    const r = compile(project(device), { platforms: ["ios", "android", "host"] });
    expect(r.diagnostics).toEqual([]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-branch-glue-"));
    for (const [k, v] of r.files) {
      fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true });
      fs.writeFileSync(path.join(dir, k), v);
    }
    const flags = ["-std=c++20", "-fsyntax-only", "-Werror", "-Wno-gnu-statement-expression", "-Wno-unused-label", "-Wno-parentheses-equality", "-Wno-comma", `-I${path.join(runtimeDir(), "cpp")}`];
    const ndkRoot = path.join(process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk"), "ndk");
    const ndk = fs.existsSync(ndkRoot) ? fs.readdirSync(ndkRoot).sort().pop() : undefined;
    const runs: [string, string[]][] = [
      ["xcrun", ["--sdk", "iphonesimulator", "clang++", ...flags, "-fobjc-arc", "-target", "arm64-apple-ios15.1-simulator", `-I${path.join(dir, "ios")}`, "-x", "objective-c++", path.join(dir, "ios/m_device.mm")]],
      ["clang++", [...flags, `-I${path.join(dir, "host")}`, path.join(dir, "host/m_device.cpp")]],
    ];
    if (ndk) {
      const bin = fs.readdirSync(path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt")).map((h) => path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt", h, "bin/clang++"))[0]!;
      runs.push([bin, ["--target=aarch64-linux-android24", ...flags, `-I${path.join(dir, "android")}`, path.join(dir, "android/m_device.cpp")]]);
    }
    for (const [cmd, args] of runs) expect(spawnSync(cmd, args, { encoding: "utf8" }).stderr).toBe("");
  }, 600_000);

  it("requires a platform's SDK to be used inside its branch", () => {
    const r = compile(
      project({
        "m.lucent.ts": `import { PLATFORM } from "lucent:platform";
import { UIDevice } from "lucent:ios/UIKit";
export function f(): string {
  if (PLATFORM === "android") return UIDevice.current.name;
  return "";
}
`,
      }),
      { platforms: ["host"] },
    );
    expect(codes(r)).toEqual(["LUCENT3004"]);
    expect(r.diagnostics[0]!.message).toMatch(/UIDevice.*lucent:ios.*PLATFORM === "ios"/);
    expect(r.diagnostics[0]!.line).toBe(4);
  });
});

describe.skipIf(!ios)("platform glue", () => {
  it("sends Objective-C messages with the SDK's own names and checks enum values", () => {
    const mm = compile(project(haptics)).files.get("ios/m_haptics.mm")!;
    expect(mm).toContain("[[UIImpactFeedbackGenerator alloc] initWithStyle:");
    expect(mm).toContain("impactOccurredWithIntensity:");
    expect(mm).toContain("[UIDevice currentDevice]");
    expect(mm).toContain("static_assert(UIImpactFeedbackStyleMedium == 1");
    expect(mm).toContain("lucent::runOnMain");
  });

  it("calls Java through JNI with derived descriptors", () => {
    const cpp = compile(project(haptics)).files.get("android/m_haptics.cpp")!;
    expect(cpp).toContain('"createWaveform", "([J[II)Landroid/os/VibrationEffect;"');
    expect(cpp).toContain('"getDefaultVibrator", "()Landroid/os/Vibrator;"');
    expect(cpp).toContain('"android/os/Build$VERSION"');
  });

  it("rejects main-only APIs outside main()", () => {
    const src = haptics["haptics.ios.lucent.ts"].replace('return main(() => (UIDevice.current === UIDevice.current ? UIDevice.current.model : ""));', "const m = UIDevice.current.model;\n  return main(() => m);");
    const r = compile(project({ ...haptics, "haptics.ios.lucent.ts": src }));
    expect(codes(r)).toEqual(["LUCENT3006"]);
    expect(r.diagnostics[0]!.message).toMatch(/UIDevice.*main thread.*main\(\(\) =>/);
  });

  it("generates Objective-C++ that compiles against the iOS SDK", () => {
    const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], { encoding: "utf8" });
    if (process.platform !== "darwin" || sdk.status !== 0) return;
    const r = compile(project(haptics));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ios-glue-"));
    for (const [k, v] of r.files) {
      fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true });
      fs.writeFileSync(path.join(dir, k), v);
    }
    const cc = spawnSync(
      "xcrun",
      ["--sdk", "iphonesimulator", "clang++", "-std=c++20", "-fobjc-arc", "-fsyntax-only", "-target", "arm64-apple-ios15.1-simulator", "-Werror", "-Wno-gnu-statement-expression", "-Wno-unused-label", "-Wno-parentheses-equality", "-Wno-comma", `-I${path.join(runtimeDir(), "cpp")}`, `-I${path.join(dir, "ios")}`, "-x", "objective-c++", path.join(dir, "ios/m_haptics.mm")],
      { encoding: "utf8" },
    );
    expect(cc.stderr).toBe("");
    expect(cc.status).toBe(0);
  });

  it("generates JNI C++ that compiles with the NDK", () => {
    const ndkRoot = path.join(process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk"), "ndk");
    const ndk = fs.existsSync(ndkRoot) ? fs.readdirSync(ndkRoot).sort().pop() : undefined;
    if (!ndk) return;
    const bin = fs.readdirSync(path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt")).map((h) => path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt", h, "bin/clang++"))[0]!;
    const r = compile(project(haptics));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-android-glue-"));
    for (const [k, v] of r.files) {
      fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true });
      fs.writeFileSync(path.join(dir, k), v);
    }
    const cc = spawnSync(
      bin,
      ["--target=aarch64-linux-android24", "-std=c++20", "-fsyntax-only", "-Werror", "-Wno-gnu-statement-expression", "-Wno-unused-label", "-Wno-parentheses-equality", "-Wno-comma", `-I${path.join(runtimeDir(), "cpp")}`, `-I${path.join(dir, "android")}`, path.join(dir, "android/m_haptics.cpp")],
      { encoding: "utf8" },
    );
    expect(cc.stderr).toBe("");
    expect(cc.status).toBe(0);
  });
});
