import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { runLucent } from "./run-to-exit.ts";

function lucent(args: string[], env: Record<string, string> = {}) {
  const r = runLucent(args, { env: { ...process.env, NO_COLOR: "1", ...env } });
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
    expect(r.out).toMatch(
      /✗ wrong  example\.lucent\.ts[\s\S]*return UIDevice\.current\.model;[\s\S]*✓ right  example\.lucent\.ts[\s\S]*main\(\(\) => UIDevice\.current\.model\)/,
    );
    expect(r.out).toMatch(/https:\/\/lucent-lang\.dev\/docs\/reference\/diagnostics\/#lucent3006/);
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

  it("scaffolds one module that branches on PLATFORM with --ios --android, and it compiles", () => {
    const root = project();
    const r = lucent(["new", "module", "haptics", "--ios", "--android", "--root", root]);
    expect(r.status).toBe(0);
    expect(fs.readdirSync(path.join(root, "src"))).toEqual(["haptics.lucent.ts"]);
    const text = fs.readFileSync(path.join(root, "src/haptics.lucent.ts"), "utf8");
    expect(text).toMatch(/import \{ PLATFORM \} from "lucent:platform"/);
    expect(text).toMatch(
      /if \(PLATFORM === "ios"\) \{[\s\S]*UIDevice\.current\.systemName[\s\S]*\} else \{[\s\S]*Build_VERSION\.RELEASE/,
    );
    expect(text).not.toMatch(/declare/);
    expect(r.out).toMatch(/src\/haptics\.lucent\.ts/);
    expect(lucent(["check", "--root", root]).status).toBe(0);
  });

  it("with one platform flag, still writes one module, whose other branch throws", () => {
    const root = project();
    const r = lucent(["new", "module", "haptics", "--android", "--root", root]);
    expect(r.status).toBe(0);
    expect(fs.readdirSync(path.join(root, "src"))).toEqual(["haptics.lucent.ts"]);
    const text = fs.readFileSync(path.join(root, "src/haptics.lucent.ts"), "utf8");
    expect(text).toMatch(/Build_VERSION\.RELEASE/);
    expect(text).not.toMatch(/lucent:ios/);
    expect(text).toMatch(
      /if \(PLATFORM === "ios"\) \{\s*throw error\("ERR_UNIMPLEMENTED", "hello is not implemented on iOS yet"\);/,
    );
    expect(r.out).toMatch(/iOS branch throws/);
    expect(lucent(["check", "--root", root]).status).toBe(0);
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

describe("lucent new view", () => {
  const views = { LUCENT_VIEWS: "fabric" };

  it.skipIf(!sdkAvailable("ios") || !sdkAvailable("android"))(
    "scaffolds a component of each platform's views in a Flex, which compiles",
    () => {
      // An app: its package names the component's registration.
      const root = project();
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
      const r = lucent(["new", "view", "Badge", "--root", root], views);

      expect(r.status).toBe(0);
      expect(fs.readdirSync(path.join(root, "src")).sort()).toEqual([
        "badge.android.lucent.tsx",
        "badge.ios.lucent.tsx",
        "badge.lucent.ts",
      ]);
      const declared = fs.readFileSync(path.join(root, "src/badge.lucent.ts"), "utf8");
      expect(declared).toMatch(/export declare function Badge\(props: Props\): UIView \| View;/);
      expect(fs.readFileSync(path.join(root, "src/badge.ios.lucent.tsx"), "utf8")).toMatch(
        /<Flex[\s\S]*<UILabel text=\{props\.title\}/,
      );
      expect(fs.readFileSync(path.join(root, "src/badge.android.lucent.tsx"), "utf8")).toMatch(
        /<Flex[\s\S]*<TextView text=\{props\.title\}/,
      );
      expect(r.out).toMatch(/import \{ Badge \} from "\.\/src\/badge\.lucent";/);
      expect(lucent(["check", "--root", root], views)).toMatchObject({ status: 0 });
    },
    600_000,
  );

  it("says views are internal without the switch, and writes nothing", () => {
    const root = project();
    const r = lucent(["new", "view", "Badge", "--root", root]);

    expect(r.status).toBe(1);
    expect(r.out).toMatch(/views are internal: set LUCENT_VIEWS=fabric/);
    expect(fs.existsSync(path.join(root, "src"))).toBe(false);
  });

  it("wants a component name, and never overwrites", () => {
    const root = project();

    expect(lucent(["new", "view", "--root", root], views).status).toBe(2);
    expect(lucent(["new", "view", "badge", "--root", root], views).status).toBe(2);

    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/badge.lucent.ts"), "// mine\n");
    const again = lucent(["new", "view", "Badge", "--root", root], views);
    expect(again.status).toBe(1);
    expect(again.out).toMatch(/src\/badge\.lucent\.ts exists/);
    expect(fs.readdirSync(path.join(root, "src"))).toEqual(["badge.lucent.ts"]);
  });

  it("is left out of the help while views are internal", () => {
    expect(lucent(["--help"]).out).not.toMatch(/new view/);
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
    const r = lucent(["--version"], {
      ANDROID_HOME: path.join(os.tmpdir(), "no-android-sdk"),
      ANDROID_SDK_ROOT: "",
    });
    expect(r.out).toMatch(/^lucent \d+\.\d+\.\d+\n/);
    expect(r.out).toMatch(/Android SDK +not found/);
    // oxlint-disable-next-line vitest/no-conditional-expect -- only macOS reports an iOS SDK
    if (process.platform === "darwin") expect(r.out).toMatch(/iOS SDK +(\d+\.\d+|not found)/);
  });
});
