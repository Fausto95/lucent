import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const bin = path.resolve(import.meta.dirname, "../bin/lucent.cjs");

function lucent(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", ...env } });
  return { status: r.status, out: r.stdout + r.stderr };
}

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cmd-"));

describe("lucent explain", () => {
  it("explains a code: why, the fix, a wrong and a right example, and where it is on the web", () => {
    const r = lucent(["explain", "LUCENT3006"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^LUCENT3006  Main-thread API off the main thread\n/);
    expect(r.out).toMatch(/Lucent code runs on its own thread/);
    expect(r.out).toMatch(/fix +wrap the call in main\(\(\) => …\) from lucent:thread/);
    expect(r.out).toMatch(/✗ wrong  example\.lucent\.ts[\s\S]*return UIDevice\.current\.model;[\s\S]*✓ right  example\.lucent\.ts[\s\S]*main\(\(\) => UIDevice\.current\.model\)/);
    expect(r.out).toMatch(/https:\/\/lucent-lang\.dev\/docs\/language\/diagnostics\/#lucent3006/);
  });

  it("takes the number alone, in any case", () => {
    expect(lucent(["explain", "3006"]).out).toMatch(/^LUCENT3006/);
    expect(lucent(["explain", "lucent1001"]).out).toMatch(/^LUCENT1001/);
  });

  it("says when a code does not exist, and lists them without one", () => {
    const r = lucent(["explain", "LUCENT9999"]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no LUCENT9999/);
    const all = lucent(["explain"]);
    expect(all.status).toBe(0);
    expect(all.out).toMatch(/LUCENT1001 +Syntax outside the subset/);
    expect(all.out).toMatch(/LUCENT9001 +TypeScript error/);
  });
});

describe("lucent new module", () => {
  it("scaffolds a shared module that compiles", () => {
    const root = project();
    const r = lucent(["new", "module", "geo", "--root", root]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(root, "src/geo.lucent.ts"))).toBe(true);
    expect(lucent(["check", "--root", root]).status).toBe(0);
  });

  it("scaffolds a declaration and an implementation per platform with --ios --android", () => {
    const root = project();
    const r = lucent(["new", "module", "haptics", "--ios", "--android", "--root", root]);
    expect(r.status).toBe(0);
    for (const f of ["haptics.lucent.ts", "haptics.ios.lucent.ts", "haptics.android.lucent.ts"]) expect(fs.existsSync(path.join(root, "src", f)), f).toBe(true);
    expect(fs.readFileSync(path.join(root, "src/haptics.lucent.ts"), "utf8")).toMatch(/export declare function/);
    expect(r.out).toMatch(/src\/haptics\.ios\.lucent\.ts/);
  });

  it("never overwrites, and wants a module name", () => {
    const root = project();
    lucent(["new", "module", "geo", "--root", root]);
    fs.writeFileSync(path.join(root, "src/geo.lucent.ts"), "// mine\n");
    const again = lucent(["new", "module", "geo", "--root", root]);
    expect(again.status).toBe(1);
    expect(again.out).toMatch(/src\/geo\.lucent\.ts exists/);
    expect(fs.readFileSync(path.join(root, "src/geo.lucent.ts"), "utf8")).toBe("// mine\n");
    expect(lucent(["new", "module", "--root", root]).status).toBe(2);
    expect(lucent(["new", "module", "not-valid!", "--root", root]).status).toBe(2);
  });
});

describe("lucent clean", () => {
  it("removes the generated package and says how much it freed; --cache clears the SDK cache too", () => {
    const root = project();
    fs.mkdirSync(path.join(root, ".lucent/native/cpp"), { recursive: true });
    fs.writeFileSync(path.join(root, ".lucent/native/cpp/big.cpp"), "x".repeat(2_000_000));
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cache-"));
    fs.mkdirSync(path.join(cache, "sdk/ios/key"), { recursive: true });
    fs.writeFileSync(path.join(cache, "sdk/ios/key/UIKit.json"), "{}");

    const r = lucent(["clean", "--root", root], { LUCENT_CACHE_DIR: cache });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/removed \.lucent +2(\.0)? MB/);
    expect(fs.existsSync(path.join(root, ".lucent"))).toBe(false);
    expect(fs.existsSync(path.join(cache, "sdk"))).toBe(true);

    const withCache = lucent(["clean", "--cache", "--root", root], { LUCENT_CACHE_DIR: cache });
    expect(withCache.out).toMatch(/nothing to remove in the project/);
    expect(withCache.out).toMatch(/removed the SDK cache/);
    expect(fs.existsSync(path.join(cache, "sdk"))).toBe(false);
  });
});

describe("lucent --version", () => {
  it("names the SDKs it sees", () => {
    const r = lucent(["--version"], { ANDROID_HOME: path.join(os.tmpdir(), "no-android-sdk"), ANDROID_SDK_ROOT: "" });
    expect(r.out).toMatch(/^lucent \d+\.\d+\.\d+\n/);
    expect(r.out).toMatch(/Android SDK +not found/);
    if (process.platform === "darwin") expect(r.out).toMatch(/iOS SDK +(\d+\.\d+|not found)/);
  });
});
