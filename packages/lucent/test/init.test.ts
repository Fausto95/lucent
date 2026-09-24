import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { addExpoPlugin, applyGradleTask, GRADLE_LINE, wrapMetro } from "../src/cli/init/patch.ts";
import { withLucentTsconfig } from "../src/cli/tsconfig.ts";

const bin = path.resolve(import.meta.dirname, "../bin/lucent.cjs");

function lucent(root: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [bin, "init", ...args, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

function write(root: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

/** Every file of the project, for comparing runs. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else out[path.relative(root, f)] = fs.readFileSync(f, "utf8");
    }
  };
  walk(root);
  return out;
}

/** What `npx @react-native-community/cli init` makes, as far as Lucent is concerned. */
function bareApp(): string {
  return write(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-init-bare-")), {
    "package.json": JSON.stringify(
      { name: "Bare", dependencies: { react: "19.3.0", "react-native": "0.88.0" } },
      null,
      2,
    ),
    "package-lock.json": "{}\n",
    "metro.config.js":
      "const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');\n\n/**\n * Metro configuration\n */\nconst config = {};\n\nmodule.exports = mergeConfig(getDefaultConfig(__dirname), config);\n",
    "tsconfig.json": '{\n  "extends": "@react-native/typescript-config"\n}\n',
    "android/app/build.gradle":
      'apply plugin: "com.android.application"\napply plugin: "org.jetbrains.kotlin.android"\napply plugin: "com.facebook.react"\n\nreact {\n  autolinkLibrariesWithApp()\n}\n',
    "ios/Podfile": "platform :ios, min_ios_version_supported\n",
    ".gitignore": "node_modules/\n",
  });
}

/** What `npx create-expo-app` makes, as far as Lucent is concerned. */
function expoApp(): string {
  return write(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-init-expo-")), {
    "package.json": JSON.stringify(
      {
        name: "expo-app",
        main: "expo-router/entry",
        dependencies: { expo: "~58.0.0", react: "19.3.0", "react-native": "0.88.0" },
      },
      null,
      2,
    ),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "app.json":
      '{\n  "expo": {\n    "name": "expo-app",\n    "plugins": [\n      "expo-router"\n    ]\n  }\n}\n',
    "tsconfig.json":
      '{\n  "extends": "expo/tsconfig.base",\n  "compilerOptions": {\n    "strict": true\n  }\n}\n',
    ".gitignore": "node_modules/\n.expo/\n",
  });
}

describe("init patches", () => {
  it("wraps the bare template's Metro config, once", () => {
    const text =
      "const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');\nconst config = {};\nmodule.exports = mergeConfig(getDefaultConfig(__dirname), config);\n";
    const wrapped = wrapMetro(text);
    expect(wrapped).toBe(
      "const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');\nconst { withLucent } = require(\"@lucent-lang/lucent/metro\");\nconst config = {};\nmodule.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), config));\n",
    );
    expect(wrapMetro(wrapped as string)).toBeUndefined();
  });

  it("asks for a hand edit when the Metro config has no module.exports to wrap", () => {
    expect(wrapMetro("export default { resolver: {} };\n")).toBe("manual");
  });

  it("adds the Expo plugin to app.json, keeping the others and the layout", () => {
    const text =
      '{\n  "expo": {\n    "name": "a",\n    "plugins": [\n      "expo-router"\n    ]\n  }\n}\n';
    expect(addExpoPlugin(text)).toBe(
      '{\n  "expo": {\n    "name": "a",\n    "plugins": [\n      "expo-router",\n      "@lucent-lang/lucent"\n    ]\n  }\n}\n',
    );
    expect(addExpoPlugin(addExpoPlugin(text)!)).toBeUndefined();
    expect(addExpoPlugin('{ "expo": { "name": "a" } }')).toBe(
      '{\n  "expo": {\n    "name": "a",\n    "plugins": [\n      "@lucent-lang/lucent"\n    ]\n  }\n}\n',
    );
  });

  it("applies the Gradle task after React Native's plugin, once", () => {
    const text =
      'apply plugin: "com.android.application"\napply plugin: "com.facebook.react"\n\nreact {}\n';
    const applied = applyGradleTask(text);
    expect(applied).toBe(
      `apply plugin: "com.android.application"\napply plugin: "com.facebook.react"\n${GRADLE_LINE}\n\nreact {}\n`,
    );
    expect(applyGradleTask(applied as string)).toBeUndefined();
  });

  it("maps lucent:* and turns on noUncheckedIndexedAccess in tsconfig.json", () => {
    const next = withLucentTsconfig(
      '{\n  "extends": "expo/tsconfig.base",\n  "compilerOptions": {\n    "strict": true\n  }\n}\n',
    );
    expect(JSON.parse(next!)).toEqual({
      extends: "expo/tsconfig.base",
      compilerOptions: {
        strict: true,
        noUncheckedIndexedAccess: true,
        paths: { "lucent:*": ["./.lucent/native/types/*"] },
      },
    });
    expect(withLucentTsconfig(next!)).toBeUndefined();
  });
});

describe("lucent init --yes", () => {
  it("sets up a bare app, scaffolds a module and says what to run next", () => {
    const root = bareApp();
    const r = lucent(root, "--yes");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/bare React Native app.*npm/);
    expect(fs.readFileSync(path.join(root, "metro.config.js"), "utf8")).toContain(
      "module.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), config));",
    );
    expect(fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8")).toContain(
      GRADLE_LINE,
    );
    expect(fs.readFileSync(path.join(root, "react-native.config.js"), "utf8")).toContain(
      '"lucent": { root:',
    );
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toContain(".lucent/");
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")).compilerOptions.paths,
    ).toEqual({ "lucent:*": ["./.lucent/native/types/*"] });
    expect(fs.readFileSync(path.join(root, "src/hello.lucent.ts"), "utf8")).toContain(
      "export function hello(",
    );
    expect(r.out.trimEnd().split("\n").at(-1)).toMatch(
      /^next +npx lucent build && npx react-native run-ios$/,
    );
  });

  it("sets up an Expo app: the config plugin instead of Gradle", () => {
    const root = expoApp();
    const r = lucent(root, "--yes");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Expo app.*pnpm/);
    expect(JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo.plugins).toEqual([
      "expo-router",
      "@lucent-lang/lucent",
    ]);
    expect(fs.readFileSync(path.join(root, "metro.config.js"), "utf8")).toBe(
      'const { getDefaultConfig } = require("expo/metro-config");\nconst { withLucent } = require("@lucent-lang/lucent/metro");\n\nmodule.exports = withLucent(getDefaultConfig(__dirname));\n',
    );
    expect(fs.existsSync(path.join(root, "android"))).toBe(false);
    expect(r.out.trimEnd().split("\n").at(-1)).toMatch(/^next +pnpm exec expo run:ios$/);
  });

  for (const [kind, make] of [
    ["bare", bareApp],
    ["Expo", expoApp],
  ] as const) {
    it(`changes nothing when run again (${kind})`, () => {
      const root = make();
      lucent(root, "--yes");
      const before = snapshot(root);
      const again = lucent(root, "--yes");
      expect(again.status).toBe(0);
      expect(again.out).toMatch(/already set up/);
      expect(snapshot(root)).toEqual(before);
    });
  }

  it("leaves an app.config.js alone and says what to add", () => {
    const root = expoApp();
    fs.rmSync(path.join(root, "app.json"));
    write(root, { "app.config.js": "export default { name: 'a' };\n" });
    const r = lucent(root, "--yes");
    expect(fs.readFileSync(path.join(root, "app.config.js"), "utf8")).toBe(
      "export default { name: 'a' };\n",
    );
    expect(r.out).toMatch(/app\.config\.js.*"@lucent-lang\/lucent"/s);
  });
});

describe("lucent init without a terminal", () => {
  it("shows the changes as diffs and applies nothing without --yes", () => {
    const root = bareApp();
    const before = snapshot(root);
    const r = lucent(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(
      /metro\.config\.js[\s\S]*- module\.exports = mergeConfig\(getDefaultConfig\(__dirname\), config\);\n[\s\S]*\+ module\.exports = withLucent\(/,
    );
    expect(r.out).toMatch(/lucent init --yes/);
    expect(snapshot(root)).toEqual(before);
  });
});

describe("lucent init in a terminal", () => {
  it("shows each change as a diff and applies the ones confirmed", async () => {
    const { render } = await import("ink-testing-library");
    const { createElement } = await import("react");
    const { Confirm } = await import("../src/cli/init/confirm.tsx");
    const { createTheme } = await import("../src/cli/ui/theme.ts");
    const theme = createTheme({
      color: false,
      interactive: true,
      unicode: true,
      links: false,
      width: 80,
    });
    const changes = [
      {
        file: "metro.config.js",
        why: "bundle *.lucent.ts as native proxies",
        before: "module.exports = config;\n",
        after: "module.exports = withLucent(config);\n",
      },
      {
        file: ".gitignore",
        why: "ignore the generated native package",
        before: "node_modules/\n",
        after: "node_modules/\n.lucent/\n",
      },
    ];
    let answers: boolean[] | undefined;
    const ui = render(
      createElement(Confirm, { changes, theme, onDone: (a: boolean[]) => (answers = a) }),
    );
    const tick = () => new Promise((r) => setTimeout(r, 30));
    await tick();
    expect(ui.lastFrame()).toMatch(
      /metro\.config\.js[\s\S]*- module\.exports = config;[\s\S]*\+ module\.exports = withLucent\(config\);[\s\S]*Apply\?/,
    );
    ui.stdin.write("y");
    await tick();
    expect(ui.lastFrame()).toMatch(/\.gitignore[\s\S]*\+ \.lucent\//);
    ui.stdin.write("n");
    await tick();
    expect(answers).toEqual([true, false]);
  });
});
