import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/compiler";
import { bin, runLucent } from "./run-to-exit.ts";
import { runJar, runJavac } from "../../bindgen/test/jvm-tools.ts";

const android = sdkAvailable("android");

function lucent(root: string, ...args: string[]) {
  const r = runLucent([...args, "--root", root], { env: { ...process.env, NO_COLOR: "1" } });
  return { status: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
}

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
  fs.writeFileSync(path.join(root, "a.lucent.ts"), "export function one(): number { return 1; }\n");
  return root;
}

describe("lucent build", () => {
  it("reports each step with its time, the modules, and what to do next", () => {
    const root = project();
    const r = lucent(root, "build");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^◆ lucent \d+\.\d+\.\d+\n\n/);
    expect(r.out).toMatch(/✓ Checked 1 module +(\d+ ms|\d+\.\d s)\n/);
    expect(r.out).toMatch(/✓ Generated C\+\+ +1 changed +(\d+ ms|\d+\.\d s)\n/);
    expect(r.out).toMatch(/✓ Native package +\.lucent\/native\n/);
    expect(r.out).toMatch(/\nmodules +a +shared\n/);
    expect(r.out).toMatch(/\nnext +rebuild the app \(iOS: pod install first\)\n/);
  });

  it("skips work when nothing changed", () => {
    const root = project();
    lucent(root, "build");
    const second = lucent(root, "build");
    expect(second.status).toBe(0);
    expect(second.out).toMatch(/✓ Up to date +1 module/);
  });

  it("says when the rebuilt native package did not change", () => {
    const root = project();
    lucent(root, "build");
    // A new source, the same C++: a trailing newline moves no #line directive.
    fs.appendFileSync(path.join(root, "a.lucent.ts"), "\n");
    const r = lucent(root, "build");
    expect(r.out).toMatch(/Generated C\+\+ +0 changed, 1 cached/);
    expect(r.out).toMatch(/\nnext +nothing to do: the native package did not change\n/);
  });

  it("rebuilds when a source changes, and with --force", () => {
    const root = project();
    lucent(root, "build");
    fs.writeFileSync(
      path.join(root, "a.lucent.ts"),
      "export function one(): number { return 2; }\n",
    );
    expect(lucent(root, "build").out).toContain("Checked 1 module");
    expect(lucent(root, "build", "--force").out).toContain("Checked 1 module");
  });

  it("maps lucent:* in the app's tsconfig.json, so editors see the modules it writes", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      '{ "compilerOptions": { "strict": true } }\n',
    );
    expect(lucent(root, "build").status).toBe(0);
    expect(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")).toContain(
      '"lucent:*": ["./.lucent/native/types/*"]',
    );
  });

  it("rebuilds when the output was deleted", () => {
    const root = project();
    lucent(root, "build");
    fs.rmSync(path.join(root, ".lucent"), { recursive: true });
    expect(lucent(root, "build").out).toContain("Checked 1 module");
  });
});

describe("Lucent packages", () => {
  it("builds the app's Lucent packages into its native package", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "lucent-greet": "1.0.0" } }),
    );
    const pkg = path.join(root, "node_modules/lucent-greet");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "lucent-greet", version: "1.0.0", lucent: { sources: "src" } }),
    );
    fs.writeFileSync(
      path.join(pkg, "src/greet.lucent.ts"),
      "export function hello(name: string): string { return `hi ${name}`; }\n",
    );
    const r = lucent(root, "build");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/lucent-greet\/greet/);
    expect(fs.existsSync(path.join(root, ".lucent/native/js/lucent-greet/greet.js"))).toBe(true);
  });
});

describe("a Lucent package's own pod", () => {
  const ios = sdkAvailable("ios");

  /**
   * A bare app (a Podfile, and the react-native.config.js lucent init writes, which links the
   * native package) whose Lucent package's iOS code imports a pod its lucent.json declares.
   */
  function appWithPackagePod(): string {
    const root = project();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "lucent-auth": "1.0.0" } }),
    );
    fs.writeFileSync(
      path.join(root, "react-native.config.js"),
      'module.exports = {\n  dependencies: {\n    "lucent": { root: require("path").join(__dirname, ".lucent", "native") },\n  },\n};\n',
    );
    fs.mkdirSync(path.join(root, "ios"));
    fs.writeFileSync(path.join(root, "ios/Podfile"), "target 'App' do\nend\n");

    const pkg = path.join(root, "node_modules/lucent-auth");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "lucent-auth", version: "1.0.0", lucent: { sources: "src" } }),
    );
    fs.writeFileSync(
      path.join(pkg, "lucent.json"),
      JSON.stringify({ ios: { pods: { LucentAuthKit: "~> 1.0" } } }),
    );
    fs.writeFileSync(
      path.join(pkg, "src/auth.lucent.ts"),
      'import { PLATFORM } from "lucent:platform";\nimport { LAKAuthenticator } from "lucent:ios/LucentAuthKit";\n\nexport function ready(): boolean {\n  if (PLATFORM === "ios") return LAKAuthenticator.isAvailable;\n  return false;\n}\n',
    );

    return root;
  }

  it.skipIf(!ios)(
    "is in the podspec after the first build, which names it for pod install before it binds it",
    () => {
      const root = appWithPackagePod();

      const r = lucent(root, "build", "--platforms", "ios");

      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/LUCENT3004[\s\S]*lucent:ios\/LucentAuthKit/);
      expect(r.out).toContain(
        "lucent-auth's pod LucentAuthKit is not installed: .lucent/native/LucentNative.podspec depends on it; run pod install in ios/, then lucent build\n",
      );
      expect(r.out).not.toContain("nothing was written");
      expect(
        fs.readFileSync(path.join(root, ".lucent/native/LucentNative.podspec"), "utf8"),
      ).toContain('s.dependency "LucentAuthKit", "~> 1.0"');
    },
    600_000,
  );

  it.skipIf(!ios)(
    "is named by lucent check, which writes nothing, and in lucent build --json's notices",
    () => {
      const root = appWithPackagePod();

      const check = lucent(root, "check");

      expect(check.status).not.toBe(0);
      expect(check.out).toContain(
        "lucent-auth's pod LucentAuthKit is not installed: run lucent build, which adds it to .lucent/native/LucentNative.podspec, then pod install in ios/\n",
      );
      expect(fs.existsSync(path.join(root, ".lucent/native"))).toBe(false);

      const build = JSON.parse(lucent(root, "build", "--platforms", "ios", "--json").stdout);

      expect(build.notices).toContainEqual({
        level: "warn",
        text: expect.stringContaining("lucent-auth's pod LucentAuthKit is not installed"),
      });
    },
    600_000,
  );

  it.skipIf(!ios)(
    "is not named once pod install has installed it",
    () => {
      const root = appWithPackagePod();
      // What pod install leaves: the app target's Pods xcconfig, and Podfile.lock listing the pod.
      const support = path.join(root, "ios/Pods/Target Support Files/Pods-App");
      fs.mkdirSync(support, { recursive: true });
      fs.writeFileSync(
        path.join(support, "Pods-App.debug.xcconfig"),
        "HEADER_SEARCH_PATHS = $(inherited)\n",
      );
      fs.writeFileSync(path.join(root, "ios/Podfile.lock"), "PODS:\n  - LucentAuthKit (1.0.3)\n");

      // The pod defines no module here: the check still fails, for that alone.
      const r = lucent(root, "build", "--platforms", "ios");

      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/LUCENT3004[\s\S]*lucent:ios\/LucentAuthKit/);
      expect(r.out).not.toContain("is not installed");
    },
    600_000,
  );

  it.skipIf(!ios)(
    "is not named in an Expo app's prebuild, where pod install does not install it",
    () => {
      const root = appWithPackagePod();
      // As the config plugin builds in expo prebuild: the template's Podfile is there, and
      // react-native.config.js links the native package only once a build succeeds.
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "app", dependencies: { expo: "55.0.0", "lucent-auth": "1.0.0" } }),
      );
      fs.writeFileSync(
        path.join(root, "app.json"),
        JSON.stringify({ expo: { name: "app", plugins: ["@lucent-lang/lucent"] } }),
      );
      fs.rmSync(path.join(root, "react-native.config.js"));

      const r = lucent(root, "build", "--platforms", "ios");

      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/LUCENT3004[\s\S]*lucent:ios\/LucentAuthKit/);
      expect(r.out).not.toContain("is not installed");
    },
    600_000,
  );
});

describe("Lucent packages' native needs", () => {
  it("writes them into the native package, and names Info.plist keys the app lacks", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "lucent-auth": "1.0.0" } }),
    );
    const pkg = path.join(root, "node_modules/lucent-auth");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "lucent-auth", version: "1.0.0", lucent: { sources: "src" } }),
    );
    fs.writeFileSync(
      path.join(pkg, "lucent.json"),
      JSON.stringify({
        ios: {
          pods: { LucentAuthKit: "~> 1.0" },
          infoPlist: { NSFaceIDUsageDescription: "Unlock", UIBackgroundModes: ["audio", "fetch"] },
          entitlements: {
            "com.apple.developer.healthkit": true,
            "keychain-access-groups": ["$(AppIdentifierPrefix)dev.orbit"],
          },
        },
        android: { dependencies: { "androidx.biometric:biometric": "1.1.0" } },
      }),
    );
    fs.writeFileSync(
      path.join(pkg, "src/auth.lucent.ts"),
      "export function ok(): boolean { return true; }\n",
    );
    fs.mkdirSync(path.join(root, "ios/App"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "ios/App/Info.plist"),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>App</string><key>UIBackgroundModes</key><array><string>fetch</string></array></dict></plist>\n',
    );
    fs.writeFileSync(
      path.join(root, "ios/App/App.entitlements"),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.developer.healthkit</key><true/></dict></plist>\n',
    );
    const r = lucent(root, "build");
    expect(r.status).toBe(0);
    expect(
      fs.readFileSync(path.join(root, ".lucent/native/LucentNative.podspec"), "utf8"),
    ).toContain('s.dependency "LucentAuthKit", "~> 1.0"');
    // Entitlements too, in the app's entitlements file.
    expect(r.out).toMatch(
      /lucent-auth needs keychain-access-groups in ios\/App\/App\.entitlements/,
    );
    expect(r.out).not.toMatch(/healthkit in ios/);
    expect(
      fs.readFileSync(path.join(root, ".lucent/native/android/build.gradle"), "utf8"),
    ).toContain('api("androidx.biometric:biometric:1.1.0")');
    // The app's files are not edited: the build says what to add.
    expect(r.out).toMatch(/lucent-auth needs NSFaceIDUsageDescription in ios\/App\/Info\.plist/);
    // An array names the values it lacks.
    expect(r.out).toMatch(
      /lucent-auth needs "audio" in UIBackgroundModes in ios\/App\/Info\.plist/,
    );
    expect(r.out).not.toMatch(/"fetch" in UIBackgroundModes/);
    // What the packages contribute, and from which package, is recorded.
    const resolved = JSON.parse(
      fs.readFileSync(path.join(root, ".lucent/native/resolved.json"), "utf8"),
    );
    expect(resolved.ios.pods).toEqual({ LucentAuthKit: { "~> 1.0": ["lucent-auth"] } });
    // lucent.json changes rebuild.
    fs.writeFileSync(
      path.join(pkg, "lucent.json"),
      JSON.stringify({ android: { dependencies: { "androidx.biometric:biometric": "1.2.0" } } }),
    );
    expect(lucent(root, "build").out).not.toMatch(/up to date/i);
    expect(
      fs.readFileSync(path.join(root, ".lucent/native/android/build.gradle"), "utf8"),
    ).toContain('api("androidx.biometric:biometric:1.2.0")');
  });
});

describe("lucent sdk coverage", () => {
  it.skipIf(!android)(
    "reports idiomatic, raw and unrepresentable members per module, and fails when coverage drops",
    () => {
      const root = project();
      const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-"));
      const run = (...args: string[]) =>
        runLucent(["sdk", "coverage", ...args, "--root", root], {
          env: { ...process.env, LUCENT_CACHE_DIR: cache },
        });
      const r = run("--android", "android.os", "--json");
      expect(r.status).toBe(0);
      const [os_] = JSON.parse(r.stdout) as {
        module: string;
        idiomatic: number;
        raw: number;
        unrepresentable: number;
        total: number;
      }[];
      expect(os_).toMatchObject({ module: "android.os" });
      expect(os_!.idiomatic + os_!.raw + os_!.unrepresentable).toBe(os_!.total);
      expect(os_!.total).toBeGreaterThan(1000);
      // A baseline with a smaller unrepresentable share than now: coverage dropped.
      // Shares, not counts, so CI's SDK version need not be this machine's.
      const baseline = path.join(root, "coverage.json");
      fs.writeFileSync(baseline, JSON.stringify([{ ...os_, unrepresentable: 0 }]));
      const check = run("--android", "android.os", "--check", baseline);
      expect(check.status).toBe(1);
      expect(check.stderr).toMatch(/android\.os: .*% unrepresentable, .*% in the baseline/);
      fs.writeFileSync(
        baseline,
        JSON.stringify([
          { ...os_, unrepresentable: os_!.unrepresentable * 2, total: os_!.total * 2 },
        ]),
      );
      expect(run("--android", "android.os", "--check", baseline).status).toBe(0);
      // Every package with a prefix.
      const all = JSON.parse(run("--android", "android.os.*", "--json").stdout) as {
        module: string;
      }[];
      expect(all.length).toBeGreaterThan(3);
      expect(all.every((c) => c.module.startsWith("android.os."))).toBe(true);
    },
  );

  it.skipIf(!android)("appends a summary of the reasons members are left out", () => {
    const root = project();
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-"));
    const summary = path.join(root, "summary.md");
    fs.writeFileSync(summary, "earlier step\n");

    const r = runLucent(
      ["sdk", "coverage", "--android", "android.os", "--summary", summary, "--root", root],
      { env: { ...process.env, LUCENT_CACHE_DIR: cache } },
    );

    expect(r.status).toBe(0);
    const text = fs.readFileSync(summary, "utf8");
    expect(text.startsWith("earlier step\n")).toBe(true);
    expect(text).toContain("## SDK coverage");
    expect(text).toMatch(/1 module: \d+ members, \d+ representable/);
    expect(text).toMatch(/\| \d+ \| .+ \|/);
  });
});

describe("lucent sdk coverage of views", () => {
  it.skipIf(!android)(
    "lists each view class's JSX attributes, events, children and construction, with their rules, when views are on",
    () => {
      const root = project();
      const run = (views: boolean) => {
        const env = { ...process.env };
        delete env.LUCENT_VIEWS;
        if (views) env.LUCENT_VIEWS = "fabric";

        const r = runLucent(
          ["sdk", "coverage", "--android", "android.widget", "--views", "--json", "--root", root],
          { env },
        );
        expect(r.status, r.stderr).toBe(0);

        return JSON.parse(r.stdout) as {
          views?: {
            view: string;
            made: string;
            events: { name: string; explanation: string }[];
            leftOut: { name: string; reason: string }[];
          }[];
        }[];
      };

      const [widget] = run(true);
      const view = (name: string) => widget!.views?.find((v) => v.view === name);

      expect(view("CompoundButton")).toMatchObject({
        made: "context",
        events: [
          {
            name: "onCheckedChange",
            explanation: expect.stringContaining("CompoundButton.setOnCheckedChangeListener"),
          },
        ],
      });
      expect(view("AutoCompleteTextView")?.leftOut).toContainEqual({
        name: "adapter",
        reason: expect.stringMatching(/generic/),
      });
      // Views are internal: without the switch, no view in the report.
      expect(run(false)[0]!.views).toBeUndefined();
    },
  );
});

describe("lucent sdk coverage of SwiftUI", () => {
  const ios = process.platform === "darwin" && sdkAvailable("ios");

  it.skipIf(!ios)(
    "reports lucent:swiftui, written as source, beside the SwiftUI module when views are on",
    () => {
      const root = project();
      const run = (views: boolean) => {
        const env = { ...process.env };
        delete env.LUCENT_VIEWS;
        if (views) env.LUCENT_VIEWS = "fabric";

        // Extracting SwiftUI's declarations takes minutes on a cold cache.
        const r = runLucent(["sdk", "coverage", "--ios", "SwiftUI", "--json", "--root", root], {
          env,
          timeout: 600_000,
        });
        expect(r.status, r.stderr).toBe(0);

        return JSON.parse(r.stdout) as { module: string; reasons: Record<string, number> }[];
      };

      const on = run(true);
      expect(on.map((c) => c.module)).toEqual(["SwiftUI", "lucent:swiftui"]);
      // A refused constraint is named after the reason.
      expect(Object.keys(on[1]!.reasons)).toContainEqual(
        expect.stringMatching(/^generic constraints the call form cannot write yet \(/),
      );

      // lucent:swiftui is internal: without the switch, only the SDK module.
      expect(run(false).map((c) => c.module)).toEqual(["SwiftUI"]);
    },
    600_000,
  );
});

describe("lucent sdk and Compose's bindings", () => {
  const sdk = (root: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
    runLucent(["sdk", ...args, "--root", root], {
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "LUCENT_VIEWS")),
        ...env,
      },
    });

  it.skipIf(!android)(
    "report and show Compose's modules, which Lucent ships, when views are on",
    () => {
      const root = project();
      const views = { LUCENT_VIEWS: "fabric" };

      const r = sdk(root, views, "coverage", "--android", "androidx.compose.*", "--json");
      expect(r.status).toBe(0);

      const reports = JSON.parse(r.stdout) as {
        module: string;
        raw: number;
        total: number;
        reasons: Record<string, number>;
      }[];
      const layout = reports.find((c) => c.module === "androidx.compose.foundation.layout");
      expect(layout?.raw).toBeGreaterThan(50);
      // Scope members are written through their lambda's receiver: none is refused for its scope.
      expect(Object.keys(layout!.reasons)).not.toContainEqual(
        expect.stringMatching(/^it runs in (Row|Column|Box)Scope, the receiver of a lambda/),
      );
      expect(reports.every((c) => c.module.startsWith("androidx.compose."))).toBe(true);

      // Declared as lucent:compose declares them.
      const box = sdk(root, views, "show", "androidx.compose.foundation.layout.Box");
      expect(box.status).toBe(0);
      expect(box.stdout).toContain("// lucent:compose");
      expect(box.stdout).toContain("export declare function Box(props: {");

      // Without views, Compose is no SDK module of Lucent's.
      const off = sdk(root, {}, "coverage", "--android", "androidx.compose.*", "--json");
      expect(JSON.parse(off.stdout)).toEqual([]);
    },
  );
});

describe("lucent init", () => {
  it("links the native package as the `lucent` dependency", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-init-"));
    expect(lucent(root, "init", "--yes").status).toBe(0);
    const config = fs.readFileSync(path.join(root, "react-native.config.js"), "utf8");
    expect(config).toContain(
      '"lucent": { root: require("path").join(__dirname, ".lucent", "native") }',
    );
    expect(config).not.toContain("lucent-native");
  });

  it("maps lucent:* in tsconfig.json to the generated declarations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-init-"));
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n',
    );
    expect(lucent(root, "init", "--yes").status).toBe(0);
    const paths = (
      JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")) as {
        compilerOptions: { paths: Record<string, string[]> };
      }
    ).compilerOptions.paths;
    expect(paths["lucent:*"]).toEqual(["./.lucent/native/types/*"]);
  });

  it("renames an existing `lucent-native` entry", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-init-"));
    fs.writeFileSync(
      path.join(root, "react-native.config.js"),
      'module.exports = { dependencies: { "lucent-native": { root: ".lucent/native" } } };\n',
    );
    expect(lucent(root, "init", "--yes").status).toBe(0);
    expect(fs.readFileSync(path.join(root, "react-native.config.js"), "utf8")).toBe(
      'module.exports = { dependencies: { "lucent": { root: ".lucent/native" } } };\n',
    );
  });
});

describe.skipIf(!android)("lucent sdk prefetch", () => {
  const run = (root: string, env: Record<string, string>, ...args: string[]) => {
    const r = runLucent([...args, "--root", root], { env: { ...process.env, ...env } });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  it("extracts the modules it is given into the cache", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-"));
    const r = run(
      project(),
      { LUCENT_CACHE_DIR: cache },
      "sdk",
      "prefetch",
      "--android",
      "android.os",
    );
    expect(r.out).toMatch(/android\.os/);
    expect(r.status).toBe(0);
    // The package's schema, under the SDK's directory and its own.
    const [key] = fs.readdirSync(path.join(cache, "sdk/android"));
    const entries = fs.readdirSync(path.join(cache, "sdk/android", key!, "android.os"));
    expect(entries.filter((f) => /^[0-9a-f]+\.json$/.test(f))).toHaveLength(1);
  });

  it("reports each module, extracted with its time or cached, then a summary", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-"));
    const first = run(
      project(),
      { LUCENT_CACHE_DIR: cache, NO_COLOR: "1" },
      "sdk",
      "prefetch",
      "--android",
      "android.util",
    );
    expect(first.out).toMatch(/✓ lucent:android\/android\.util +\d+(\.\d)? m?s/);
    expect(first.out).toMatch(/1 module: 1 extracted/);
    const again = run(
      project(),
      { LUCENT_CACHE_DIR: cache, NO_COLOR: "1" },
      "sdk",
      "prefetch",
      "--android",
      "android.util",
    );
    expect(again.out).toMatch(/✓ lucent:android\/android\.util +cached/);
    expect(again.out).toMatch(/1 module: 1 cached/);
  });

  it("fails for modules the SDK does not have, saying where it looked", () => {
    const r = run(
      project(),
      { LUCENT_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-")) },
      "sdk",
      "prefetch",
      "--android",
      "com.nope",
    );
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/com\.nope.*not found/s);
  });

  it("builds the platforms whose SDK is installed, and says which it skipped", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
    fs.writeFileSync(
      path.join(root, "m.lucent.ts"),
      "export declare function f(): Promise<string>;\n",
    );
    fs.writeFileSync(
      path.join(root, "m.ios.lucent.ts"),
      'import { UIDevice } from "lucent:ios/UIKit";\nimport { main } from "lucent:thread";\nexport function f(): Promise<string> { return main(() => UIDevice.current.model); }\n',
    );
    fs.writeFileSync(
      path.join(root, "m.android.lucent.ts"),
      'import { Build } from "lucent:android/android.os";\nexport async function f(): Promise<string> { return Build.MODEL ?? ""; }\n',
    );
    const r = run(
      root,
      {
        LUCENT_XCRUN: path.join(os.tmpdir(), "no-such-xcrun"),
      },
      "build",
    );
    expect(r.out).toMatch(/iOS SDK was not found.*skipped iOS/s);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(root, ".lucent/native/cpp/generated/android/m_m.cpp"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, ".lucent/native/cpp/generated/ios"))).toBe(false);
  });

  it("says which platforms it skipped for a module that branches on PLATFORM too", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
    fs.writeFileSync(
      path.join(root, "m.lucent.ts"),
      'import { PLATFORM } from "lucent:platform";\nimport { UIDevice } from "lucent:ios/UIKit";\nimport { Build } from "lucent:android/android.os";\nimport { main } from "lucent:thread";\nexport async function f(): Promise<string> {\n  if (PLATFORM === "ios") return main(() => UIDevice.current.model);\n  else return Build.MODEL ?? "";\n}\n',
    );
    const r = run(
      root,
      {
        LUCENT_XCRUN: path.join(os.tmpdir(), "no-such-xcrun"),
      },
      "build",
    );
    expect(r.out).toMatch(/iOS SDK was not found.*skipped iOS/s);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(root, ".lucent/native/cpp/generated/android/m_m.cpp"))).toBe(
      true,
    );
  });
});

describe("the app's Android dependencies", () => {
  it.skipIf(!android)(
    "lucent build resolves them with Gradle when an import is not in the SDK",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
      fs.writeFileSync(
        path.join(root, "m.lucent.ts"),
        "export declare function f(): Promise<string>;\n",
      );
      fs.writeFileSync(
        path.join(root, "m.android.lucent.ts"),
        'import { Widget } from "lucent:android/com.example.widgets";\nexport async function f(): Promise<string> { return new Widget().getName(); }\n',
      );
      fs.writeFileSync(
        path.join(root, "m.ios.lucent.ts"),
        'export async function f(): Promise<string> { return ""; }\n',
      );
      // A stand-in gradlew: records the call and writes the classpath with a fixture jar.
      const jar = path.join(root, "widgets.jar");
      const classes = path.join(root, "classes");
      const sources = spawnSync(
        "find",
        [path.join(path.dirname(bin), "../../bindgen/test/fixtures/java"), "-name", "*.java"],
        { encoding: "utf8" },
      )
        .stdout.trim()
        .split("\n");
      runJavac(["--release", "11", "-d", classes, ...sources]);
      runJar(["cf", jar, "-C", classes, "."]);
      fs.mkdirSync(path.join(root, "android"));
      fs.writeFileSync(
        path.join(root, "android/gradlew"),
        `#!/bin/sh\necho "$@" > ${path.join(root, "gradle-args")}\nmkdir -p ${path.join(root, ".lucent")}\necho '{"jars":["${jar}"],"aars":[]}' > ${path.join(root, ".lucent/android-classpath.json")}\n`,
        { mode: 0o755 },
      );
      const r = runLucent(["build", "--platforms", "android", "--root", root], {
        env: {
          ...process.env,
          LUCENT_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-")),
        },
      });
      expect(r.stdout + r.stderr).toMatch(/✓ Android dependencies +resolved with Gradle/);
      // The task comes from an init script Lucent ships: nothing in the app applies it.
      const args = fs.readFileSync(path.join(root, "gradle-args"), "utf8").trim().split(/\s+/);
      const script = args[args.indexOf("--init-script") + 1]!;
      expect(fs.readFileSync(script, "utf8")).toMatch(/lucentClasspath/);
      expect(args).toContain(":app:lucentClasspath");
      expect(fs.existsSync(path.join(root, ".lucent/native/android/lucent.gradle"))).toBe(false);
      expect(r.status).toBe(0);
    },
  );

  /**
   * An app with an Android import no dependency has, and a gradlew that
   * counts its runs. Like React Native's settings plugin, each run reads
   * the app's autolinking config, and caches it until the lockfile
   * changes: it links the native package when autolinking can resolve it.
   */
  function gradleApp(exitCode = 0) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
    fs.writeFileSync(
      path.join(root, "m.lucent.ts"),
      "export declare function f(): Promise<string>;\n",
    );
    fs.writeFileSync(
      path.join(root, "m.android.lucent.ts"),
      'import { Nope } from "lucent:android/com.example.nope";\nexport async function f(): Promise<string> { return `${Nope}`; }\n',
    );
    fs.writeFileSync(
      path.join(root, "m.ios.lucent.ts"),
      'export async function f(): Promise<string> { return ""; }\n',
    );
    fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n");
    fs.mkdirSync(path.join(root, "android/app"), { recursive: true });
    fs.mkdirSync(path.join(root, "android/gradle"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "android/app/build.gradle"),
      'apply plugin: "com.android.application"\n',
    );
    fs.writeFileSync(path.join(root, "android/gradle/libs.versions.toml"), "[versions]\n");
    const runs = path.join(root, "gradle-runs");
    const links = path.join(root, "android/build/generated/autolinking");
    const pkg = path.join(root, ".lucent/native");
    // What React Native's CLI reads to resolve the package's Android side.
    const resolvable = [
      "react-native.config.js",
      "package.json",
      "android/build.gradle",
      "android/src/main/java/dev/lucent/LucentPackage.java",
    ]
      .map((f) => `[ -f ${path.join(pkg, f)} ]`)
      .join(" && ");
    fs.writeFileSync(
      path.join(root, "android/gradlew"),
      [
        "#!/bin/sh",
        `echo run >> ${runs}`,
        `mkdir -p ${links}`,
        `sum=$(cksum < ${path.join(root, "package-lock.json")})`,
        `if [ ! -s ${links}/autolinking.json ] || [ "$(cat ${links}/package-lock.json.sha 2>/dev/null)" != "$sum" ]; then`,
        `  if ${resolvable}; then echo '{"dependencies":{"lucent":{}}}'; else echo '{"dependencies":{}}'; fi > ${links}/autolinking.json`,
        `  echo "$sum" > ${links}/package-lock.json.sha`,
        "fi",
        `mkdir -p ${path.join(root, ".lucent")}`,
        `echo '{"jars":[],"aars":[]}' > ${path.join(root, ".lucent/android-classpath.json")}`,
        `exit ${exitCode}`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-"));
    const build = (env: Record<string, string> = {}) =>
      runLucent(["build", "--platforms", "android", "--root", root], {
        env: { ...process.env, LUCENT_CACHE_DIR: cache, NO_COLOR: "1", ...env },
      });
    const count = () =>
      fs.existsSync(runs) ? fs.readFileSync(runs, "utf8").trim().split("\n").length : 0;
    // The app's own Gradle build (./gradlew assembleRelease, an IDE sync).
    const gradle = () =>
      spawnSync(path.join(root, "android/gradlew"), [], { cwd: path.join(root, "android") });
    const linked = () =>
      "lucent" in
      (
        JSON.parse(fs.readFileSync(path.join(links, "autolinking.json"), "utf8")) as {
          dependencies: Record<string, unknown>;
        }
      ).dependencies;
    return { root, build, count, cache, gradle, linked };
  }

  it.skipIf(!android)(
    "links the native package in the first Gradle build of a fresh checkout",
    () => {
      const app = gradleApp();

      // lucent build resolves the classpath with Gradle, then the app is built.
      app.build();
      app.gradle();

      expect(app.linked()).toBe(true);
    },
  );

  it.skipIf(!android)(
    "has Gradle read the autolinking config again once the native package exists",
    () => {
      const app = gradleApp();

      // A Gradle run before the first lucent build (an IDE sync) caches the config without it.
      app.gradle();
      expect(app.linked()).toBe(false);

      app.build();
      app.gradle();

      expect(app.linked()).toBe(true);
    },
  );

  it.skipIf(!android)(
    "has Gradle read the autolinking config again when a build rewrites the package's",
    () => {
      const app = gradleApp();
      const config = path.join(app.root, ".lucent/native/react-native.config.js");
      const links = path.join(app.root, "android/build/generated/autolinking");

      // A module that compiles, so the build writes the whole package.
      fs.writeFileSync(
        path.join(app.root, "m.android.lucent.ts"),
        'export async function f(): Promise<string> {\n  return "";\n}\n',
      );
      app.build();
      // As an older build wrote it (components registered through autolinking change it).
      fs.writeFileSync(config, `${fs.readFileSync(config, "utf8")}// older\n`);
      app.gradle();
      expect(fs.readdirSync(links).some((f) => f.endsWith(".sha"))).toBe(true);

      runLucent(["build", "--force", "--platforms", "android", "--root", app.root], {
        env: { ...process.env, LUCENT_CACHE_DIR: app.cache, NO_COLOR: "1" },
      });

      expect(fs.readFileSync(config, "utf8")).not.toMatch(/older/);
      expect(fs.readdirSync(links).some((f) => f.endsWith(".sha"))).toBe(false);
    },
  );

  it.skipIf(!android)(
    "fails the Gradle build that read the autolinking config before the native package existed",
    () => {
      const app = gradleApp();

      // The app's first build runs lucent build (its lucentBuild task) after reading the config.
      app.gradle();
      const first = app.build({ LUCENT_GRADLE_CLASSPATH: "1" });

      expect(first.status).toBe(1);
      expect(first.stdout + first.stderr).toMatch(/build again/);

      // The next build links it, and builds it.
      app.gradle();
      const next = app.build({ LUCENT_GRADLE_CLASSPATH: "1" });

      expect(app.linked()).toBe(true);
      expect(next.stdout + next.stderr).not.toMatch(/build again/);
    },
  );

  it.skipIf(!android)(
    "does not run Gradle again when Gradle runs the build (the app's lucentBuild task)",
    () => {
      const app = gradleApp();
      fs.mkdirSync(path.join(app.root, ".lucent"), { recursive: true });
      fs.writeFileSync(
        path.join(app.root, ".lucent/android-classpath.json"),
        '{"jars":[],"aars":[]}\n',
      );
      const r = runLucent(["build", "--platforms", "android", "--root", app.root], {
        env: {
          ...process.env,
          LUCENT_CACHE_DIR: app.cache,
          LUCENT_GRADLE_CLASSPATH: "1",
          NO_COLOR: "1",
        },
      });
      expect(app.count()).toBe(0);
      expect(r.stdout + r.stderr).not.toMatch(/resolved with Gradle/);
    },
  );

  it.skipIf(!android || !sdkAvailable("ios"))(
    "does not run Gradle during expo prebuild, and leaves Android to the Gradle build until the classpath exists",
    () => {
      const app = gradleApp();
      const r = runLucent(["build", "--root", app.root], {
        env: { ...process.env, LUCENT_CACHE_DIR: app.cache, LUCENT_NO_GRADLE: "1", NO_COLOR: "1" },
      });
      expect(app.count()).toBe(0);
      expect(r.stdout + r.stderr).toMatch(/skipped Android.*lucentBuild/);
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(app.root, ".lucent/native/cpp/generated/ios/m_m.mm"))).toBe(
        true,
      );
    },
  );

  it.skipIf(!android || !sdkAvailable("ios"))(
    "builds iOS during expo prebuild when a shared module's Android branch needs the app's dependencies",
    () => {
      const app = gradleApp();

      // One module for both platforms: its Android branch imports a library of the app's.
      fs.rmSync(path.join(app.root, "m.android.lucent.ts"));
      fs.rmSync(path.join(app.root, "m.ios.lucent.ts"));
      fs.writeFileSync(
        path.join(app.root, "m.lucent.ts"),
        [
          'import { PLATFORM } from "lucent:platform";',
          'import { Nope } from "lucent:android/com.example.nope";',
          "export async function f(): Promise<string> {",
          '  if (PLATFORM === "android") return `${Nope.hello()}`;',
          '  return "ios";',
          "}",
          "",
        ].join("\n"),
      );
      const build = (env: Record<string, string>) =>
        runLucent(["build", "--root", app.root], {
          env: { ...process.env, LUCENT_CACHE_DIR: app.cache, NO_COLOR: "1", ...env },
        });

      // expo prebuild: the classpath is resolved later, by the Gradle build.
      const prebuild = build({ LUCENT_NO_GRADLE: "1" });

      expect(prebuild.stdout + prebuild.stderr).not.toMatch(/LUCENT3004/);
      expect(prebuild.stdout + prebuild.stderr).toMatch(/skipped Android.*lucentBuild/);
      expect(prebuild.status).toBe(0);
      expect(app.count()).toBe(0);
      expect(fs.existsSync(path.join(app.root, ".lucent/native/cpp/generated/ios/m_m.cpp"))).toBe(
        true,
      );

      // The Gradle build's lucentBuild, with the classpath resolved: the import is missing
      // from it, and that is an error, not a skipped platform.
      app.gradle();
      const gradle = build({ LUCENT_GRADLE_CLASSPATH: "1" });

      expect(gradle.status).toBe(1);
      expect(gradle.stdout + gradle.stderr).toMatch(
        /LUCENT3004[\s\S]*lucent:android\/com\.example\.nope was not found/,
      );
    },
  );

  it.skipIf(!android || !sdkAvailable("ios"))(
    "configures the Android library after expo prebuild so the first Gradle build builds it",
    () => {
      const app = gradleApp();
      fs.writeFileSync(
        path.join(app.root, "m.android.lucent.ts"),
        'import { Build } from "lucent:android/android.os";\nexport async function f(): Promise<string> { return Build.MODEL ?? ""; }\n',
      );
      const libraryGradle = path.join(app.root, ".lucent/native/android/build.gradle");
      const build = (env: Record<string, string>) =>
        runLucent(["build", "--root", app.root], {
          env: { ...process.env, LUCENT_CACHE_DIR: app.cache, NO_COLOR: "1", ...env },
        });

      // Before Android is built, whether it needs Kotlin shims is unknown: the library is
      // configured for them.
      expect(build({ LUCENT_NO_GRADLE: "1" }).status).toBe(0);
      expect(fs.readFileSync(libraryGradle, "utf8")).toMatch(/org\.jetbrains\.kotlin\.android/);

      // The Gradle build configured it so: its lucentBuild builds Android without asking for
      // another build, and leaves the library as Android needs it for the next one.
      app.gradle();
      const first = build({ LUCENT_GRADLE_CLASSPATH: "1" });

      expect(first.stdout + first.stderr).not.toMatch(/build again/);
      expect(first.status).toBe(0);
      expect(
        fs.existsSync(path.join(app.root, ".lucent/native/cpp/generated/android/m_m.cpp")),
      ).toBe(true);
      expect(fs.readFileSync(libraryGradle, "utf8")).not.toMatch(/kotlin/);
    },
  );

  it.skipIf(!android)(
    "runs Gradle once per change of the build's inputs, not once per build",
    () => {
      const app = gradleApp();
      app.build();
      app.build();
      expect(app.count()).toBe(1);
      // The JS lockfile: autolinked packages add Android dependencies.
      fs.writeFileSync(path.join(app.root, "package-lock.json"), '{"lockfileVersion":3}\n');
      app.build();
      app.build();
      expect(app.count()).toBe(2);
      fs.writeFileSync(
        path.join(app.root, "android/gradle/libs.versions.toml"),
        '[versions]\nbiometric = "1.1.0"\n',
      );
      app.build();
      expect(app.count()).toBe(3);
    },
  );

  it("does not run Gradle for a host build, which needs no SDK", () => {
    const app = gradleApp();
    const r = runLucent(["build", "--platforms", "host", "--root", app.root], {
      env: {
        ...process.env,
        LUCENT_CACHE_DIR: app.cache,
        LUCENT_ANDROID_PLATFORM: "nope",
        LUCENT_XCRUN: "/nonexistent",
      },
    });
    expect(r.stdout + r.stderr).not.toMatch(/resolved with Gradle/);
    expect(app.count()).toBe(0);
    expect(r.status).toBe(0);
  });

  it.skipIf(!android)("does not retry a failed resolution until the inputs change", () => {
    const app = gradleApp(1);
    const failed = app.build();
    expect(failed.stdout + failed.stderr).toMatch(
      /✗ Android dependencies +Gradle could not resolve/,
    );
    app.build();
    expect(app.count()).toBe(1);
    fs.writeFileSync(
      path.join(app.root, "android/app/build.gradle"),
      'apply plugin: "com.android.application"\n// fixed\n',
    );
    app.build();
    expect(app.count()).toBe(2);
    // A failure that was not the build files' (a stopped daemon, the network): --force retries.
    const again = app.build();
    expect(again.stdout + again.stderr).toMatch(/--force/);
    runLucent(["build", "--force", "--platforms", "android", "--root", app.root], {
      env: { ...process.env, LUCENT_CACHE_DIR: app.cache },
    });
    expect(app.count()).toBe(3);
  });

  it.skipIf(!android)(
    "resolves once in a watch session that rebuilds",
    async () => {
      const app = gradleApp();
      const child = spawn(process.execPath, [bin, "dev", "--compact", "--root", app.root], {
        env: { ...process.env, LUCENT_CACHE_DIR: app.cache, NO_COLOR: "1" },
      });
      let output = "";
      child.stdout.on("data", (d) => (output += String(d)));
      child.stderr.on("data", (d) => (output += String(d)));
      // One line per build in compact mode: ✓ when it passed, ✗ when it did not.
      const builds = () => (output.match(/^\[[\d:]+\] [✓✗]/gm) ?? []).length;
      const until = async (n: number) => {
        for (let i = 0; i < 300 && builds() < n; i++) await new Promise((r) => setTimeout(r, 100));
      };
      await until(1);
      fs.appendFileSync(path.join(app.root, "m.android.lucent.ts"), "// edited\n");
      await until(2);
      child.kill();
      expect(builds()).toBeGreaterThanOrEqual(2);
      expect(app.count()).toBe(1);
    },
    60_000,
  );
});

describe("lucent check", () => {
  function broken(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
    fs.writeFileSync(
      path.join(root, "geo.lucent.ts"),
      "export function total(xs: number[]): number {\n  var sum = 0;\n  for (const x of xs) sum += x;\n  return sum;\n}\n",
    );
    return root;
  }
  const stable = (out: string) => out.replace(/\d+(\.\d+)? (ms|s)\b/g, "<time>");

  it("shows each problem with a code frame, its fix and where it is explained, then a summary", () => {
    const r = lucent(broken(), "check");
    expect(r.status).toBe(1);
    expect(stable(r.out)).toMatchSnapshot();
  });

  it("prints the same plain output with NO_COLOR, in CI, and on a dumb terminal", () => {
    const root = broken();
    const outs = [{ NO_COLOR: "1" }, { CI: "1" }, { TERM: "dumb", NO_COLOR: "" }].map((env) => {
      const r = runLucent(["check", "--root", root], { env: { ...process.env, ...env } });
      return stable(r.stdout + r.stderr);
    });
    expect(outs[1]).toBe(outs[0]);
    // A dumb terminal gets ASCII: the code frame's gutter.
    expect(outs[2]).toMatch(/\n +2 \| {3}var sum = 0;\n/);
  });

  it("passes a clean project", () => {
    const r = lucent(project(), "check");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/✓ 1 module, no problems +(\d+ ms|\d+\.\d s)/);
  });

  it("answers from the last check while nothing changed, and checks again after an edit", () => {
    const root = project();
    expect(lucent(root, "check").out).not.toMatch(/unchanged/);
    expect(lucent(root, "check").out).toMatch(
      /✓ 1 module, no problems +\d+ ms \(unchanged since the last check\)/,
    );
    fs.writeFileSync(
      path.join(root, "a.lucent.ts"),
      "export function one(): number { var x = 1; return x; }\n",
    );
    const r = lucent(root, "check");
    expect(r.status).toBe(1);
    expect(r.out).toContain("LUCENT1001");
  });
});

describe("--json", () => {
  const schema = (name: string) =>
    JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(bin), `../schemas/${name}.schema.json`), "utf8"),
    ) as object;
  async function validate(name: string, value: unknown): Promise<string[]> {
    const { default: Ajv } = (await import("ajv")) as unknown as {
      default: new (o: object) => {
        compile(
          s: object,
        ): ((v: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] };
      };
    };
    const check = new Ajv({ allErrors: true }).compile(schema(name));
    return check(value) ? [] : (check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
  }

  it("lucent check --json matches its schema, with or without problems", async () => {
    for (const root of [
      project(),
      (() => {
        const r = project();
        fs.writeFileSync(
          path.join(r, "a.lucent.ts"),
          "export function f(x: any): number { return 1; }\n",
        );
        return r;
      })(),
    ]) {
      const r = lucent(root, "check", "--json");
      const value = JSON.parse(r.stdout) as { ok: boolean };
      expect(await validate("check", value)).toEqual([]);
      expect(r.status).toBe(value.ok ? 0 : 1);
    }
  });

  it("lucent doctor --json matches its schema", async () => {
    const r = lucent(project(), "doctor", "--json");
    const value = JSON.parse(r.stdout) as { ok: boolean };
    expect(await validate("doctor", value)).toEqual([]);
    expect(r.status).toBe(value.ok ? 0 : 1);
  });

  it("lucent build --json matches its schema", async () => {
    const root = project();
    const r = lucent(root, "build", "--json");
    expect(r.status).toBe(0);
    const value = JSON.parse(r.stdout) as { ok: boolean; modules: { name: string }[] };
    expect(await validate("build", value)).toEqual([]);
    expect(value.modules.map((m) => m.name)).toEqual(["a"]);
    expect(await validate("build", JSON.parse(lucent(root, "build", "--json").stdout))).toEqual([]);
  });
});
