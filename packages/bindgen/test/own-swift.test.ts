/**
 * Swift that is not in a module before a build: Swift pods built as
 * static libraries, pods' XCFrameworks, and the Swift a Lucent package
 * lists in ios.nativeSources (the module LucentNative). Run against a
 * stand-in for Xcode (fake-xcode.ts), on any machine: what the provider
 * does with Xcode's outputs, not what Xcode makes of the Swift.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { podsSearchPaths } from "../src/pods.ts";
import { forgetLoadedSdks, sdkModule } from "../src/provider.ts";
import { fakeXcode } from "./fake-xcode.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const made: string[] = [];
const tmp = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
};
afterAll(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
beforeEach(() => forgetLoadedSdks());

/** The app (fixtures/pods-static), a fake Xcode and a cache of its own. */
function app() {
  const dir = tmp("lucent-own-swift-");
  fs.cpSync(path.join(fixtures, "pods-static"), dir, { recursive: true });
  const xcode = fakeXcode(path.join(dir, "xcode"));
  const pods = podsSearchPaths(path.join(dir, "ios"))!;

  return { dir, xcode, pods, cacheDir: path.join(dir, "cache") };
}

const typeNames = (r: ReturnType<typeof sdkModule>) =>
  "schema" in r ? r.schema.types.map((t) => t.name) : r;

describe("Swift outside modules, made into modules", () => {
  it("binds a Swift pod built as a static library, from its sources, once", () => {
    const { xcode, pods, cacheDir } = app();
    const opts = { cacheDir, ios: { ...pods, xcrun: xcode.xcrun } };

    const r = sdkModule("ios", "DialKit", opts);
    expect(typeNames(r)).toEqual(["Gauge"]);
    expect("schema" in r && r.schema.provenance).toMatchObject({
      artifact: "pod:dial-kit@1.0.0",
      kind: "swift-module",
    });
    // Nothing to import or link: the shims import the module, and the pod links itself.
    expect("schema" in r && { header: r.schema.header, frameworks: r.schema.frameworks }).toEqual({
      header: undefined,
      frameworks: [],
    });

    // Emitted from its sources, then read from the include path the emitted module is in.
    const [emit, extract] = xcode.calls();
    expect(emit).toMatch(/^swiftc -emit-module .*-module-name DialKit .*\/Dial\.swift$/);
    const dir = /-emit-module-path (\S+)\/DialKit\.swiftmodule/.exec(emit!)?.[1];
    expect(extract).toContain(`-module-name DialKit`);
    expect(extract).toContain(`-I ${path.dirname(dir!)}`);

    // A new process emits nothing: the module is in the cache.
    forgetLoadedSdks();
    fs.rmSync(path.join(cacheDir, "sdk"), { recursive: true });
    sdkModule("ios", "DialKit", opts);
    expect(xcode.calls().filter((c) => c.startsWith("swiftc"))).toHaveLength(1);
  });

  it("emits a Swift pod again when its sources change", () => {
    const { dir, xcode, pods, cacheDir } = app();
    const opts = () => ({ cacheDir, ios: { ...podsSearchPaths(path.join(dir, "ios"))!, xcrun: xcode.xcrun } });

    sdkModule("ios", "DialKit", opts());
    fs.appendFileSync(path.join(dir, "dial-kit/ios/Dial.swift"), "\npublic func zero() -> Double { 0 }\n");
    forgetLoadedSdks();
    sdkModule("ios", "DialKit", opts());

    expect(xcode.calls().filter((c) => c.startsWith("swiftc"))).toHaveLength(2);
    expect(pods.swiftPods).toHaveLength(1);
  });

  it("binds a pod's XCFramework through its simulator slice", () => {
    const { xcode, pods, cacheDir } = app();

    const r = sdkModule("ios", "OrbitSDK", { cacheDir, ios: { ...pods, xcrun: xcode.xcrun } });
    expect(typeNames(r)).toEqual(["Gauge"]);
    expect("schema" in r && r.schema.provenance).toMatchObject({
      artifact: "pod:OrbitSDK@3.1.0",
      kind: "framework",
    });
    const extract = xcode.calls().find((c) => c.includes("-module-name OrbitSDK"));
    expect(extract).toContain("OrbitSDK.xcframework/ios-arm64_x86_64-simulator");
  });

  it("binds a Lucent package's Swift as lucent:ios/LucentNative", () => {
    const { dir, xcode, cacheDir } = app();
    const sources = path.join(dir, "package/native/ios");
    fs.mkdirSync(sources, { recursive: true });
    fs.writeFileSync(
      path.join(sources, "Wrap.swift"),
      "import Foundation\n\npublic class Gauge {\n  public init(value: Double) {}\n}\n",
    );

    const r = sdkModule("ios", "LucentNative", {
      cacheDir,
      ios: { xcrun: xcode.xcrun, swiftSources: [path.join(sources, "Wrap.swift")] },
    });
    expect(typeNames(r)).toEqual(["Gauge"]);
    // Its own module: nothing to import, link or depend on.
    expect("schema" in r && r.schema.provenance).toMatchObject({
      artifact: "swift-module:LucentNative",
      kind: "swift-module",
    });
  });

  it("says why a Swift pod could not be made into a module", () => {
    const { dir, xcode, cacheDir } = app();
    const support = path.join(dir, "ios/Pods/Target Support Files/dial-kit/dial-kit.debug.xcconfig");
    fs.writeFileSync(
      support,
      fs.readFileSync(support, "utf8").replace("PRODUCT_MODULE_NAME = DialKit", "PRODUCT_MODULE_NAME = BrokenKit"),
    );
    const pods = podsSearchPaths(path.join(dir, "ios"))!;

    const r = sdkModule("ios", "BrokenKit", { cacheDir, ios: { ...pods, xcrun: xcode.xcrun } });
    expect(r).toEqual({
      missing: expect.stringMatching(
        /lucent:ios\/BrokenKit: its Swift could not be made into a module: swiftc could not emit its module: error: cannot compile BrokenKit/,
      ),
    });
  });
});
