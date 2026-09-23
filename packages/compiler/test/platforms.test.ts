import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compile, runtimeDir } from "../src/index.ts";
import { createLucentProgram } from "../src/program.ts";
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
  it("types iOS classes nominally, with Swift names, enums and class properties", () => {
    const src = `import { UIDevice, UIFeedbackGenerator, UIImpactFeedbackGenerator, UIImpactFeedbackGenerator_FeedbackStyle as Style, UISelectionFeedbackGenerator } from "lucent:ios/UIKit";
export function f(): string {
  const g = new UIImpactFeedbackGenerator(Style.heavy);
  const base: UIFeedbackGenerator = g;
  void base;
  const wrong: UIImpactFeedbackGenerator = new UISelectionFeedbackGenerator();
  void wrong;
  new UIDevice();
  return UIDevice.current.systemName;
}
`;
    expect(tsErrors("ios", src)).toEqual(["6: TS2739", "8: TS2673"]);
  });

  it("types Java classes: nullability, primitive arrays, Class<T> and getter properties", () => {
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
    const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk");
    const jar = fs.existsSync(path.join(sdk, "platforms")) ? fs.readdirSync(path.join(sdk, "platforms")).map((p) => path.join(sdk, "platforms", p, "android.jar")).find((j) => fs.existsSync(j)) : undefined;
    const javap = spawnSync("javap", ["-version"]).status === 0;
    if (!jar || !javap) return;
    for (const mod of ["android.os", "android.content"]) {
      const schema = loadSdkModule("android", mod);
      for (const cls of schema.types) {
        if (cls.kind !== "class") continue;
        const dump = spawnSync("javap", ["-s", "-cp", jar, cls.native.replace(/\//g, ".")], { encoding: "utf8" }).stdout;
        for (const m of [...(cls.methods ?? []), ...(cls.constructors ?? []).map((c) => ({ ...c, name: "<init>", returns: "void", typeParams: [] }))]) {
          expect(dump, `${cls.name}.${m.name}`).toContain(`descriptor: ${jniDescriptor(m.params.map((p) => p.type), m.returns, m.typeParams)}`);
        }
        for (const p of cls.properties ?? []) {
          const d = p.getter ? jniDescriptor([], p.type) : jniDescriptor([], p.type).slice(2);
          expect(dump, `${cls.name}.${p.name}`).toContain(`descriptor: ${d}`);
        }
      }
    }
  });
});

describe("platform modules", () => {
  it("compiles each platform's implementation against the shared declaration", () => {
    const r = compile(project(haptics));
    expect(r.diagnostics).toEqual([]);
    const keys = [...r.files.keys()];
    expect(keys).toEqual(expect.arrayContaining(["ios/lucent_app.h", "ios/m_haptics.h", "ios/m_haptics.mm", "ios/lucent_bindings.cpp", "android/m_haptics.cpp", "android/lucent_bindings.cpp"]));
    expect(keys.filter((k) => !k.startsWith("ios/") && !k.startsWith("android/"))).toEqual([]);
    expect([...r.proxies.keys()]).toEqual(["haptics"]);
    expect(r.proxies.get("haptics")).toContain("impact");
  });

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

describe("platform glue", () => {
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
