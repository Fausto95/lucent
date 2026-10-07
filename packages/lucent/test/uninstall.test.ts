import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { runLucent } from "./run-to-exit.ts";

function lucent(root: string, ...args: string[]) {
  const r = runLucent([...args, "--root", root], { env: { ...process.env, NO_COLOR: "1" } });
  return { status: r.status, out: r.stdout + r.stderr };
}

/** Every file under `root` but node_modules, by path. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.name === "node_modules") continue;
      if (e.isDirectory()) walk(full);
      else out[path.relative(root, full)] = fs.readFileSync(full, "utf8");
    }
  };
  walk(root);
  return out;
}

function write(root: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lucent-uninstall-"));

/** Apps as they are before lucent init, with a module of their own (which uninstall keeps). */
const APPS = {
  bare: () =>
    write(tmp(), {
      "package.json": JSON.stringify({ name: "app", dependencies: { "react-native": "0.88.0" } }),
      "package-lock.json": "{}\n",
      "metro.config.js":
        'const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");\n\nconst config = {};\n\nmodule.exports = mergeConfig(getDefaultConfig(__dirname), config);\n',
      "android/app/build.gradle":
        'apply plugin: "com.android.application"\napply plugin: "com.facebook.react"\n\nandroid {\n}\n',
      "tsconfig.json": '{\n  "extends": "@react-native/typescript-config"\n}\n',
      ".gitignore": "node_modules/\n",
      "src/mine.lucent.ts": "export function mine(): number { return 1; }\n",
    }),
  Expo: () =>
    write(tmp(), {
      "package.json": JSON.stringify({ name: "app", dependencies: { expo: "58.0.0" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "app.json": '{\n  "expo": {\n    "name": "app",\n    "plugins": ["expo-router"]\n  }\n}\n',
      "tsconfig.json":
        '{\n  "extends": "expo/tsconfig.base",\n  "compilerOptions": {\n    "strict": true,\n    "paths": { "@/*": ["./*"] }\n  }\n}\n',
      "src/mine.lucent.ts": "export function mine(): number { return 1; }\n",
    }),
};

describe("lucent uninstall", () => {
  for (const [kind, make] of Object.entries(APPS))
    it(`reverts what lucent init changed (${kind}), keeping the app's modules`, () => {
      const root = make();
      const before = snapshot(root);
      expect(lucent(root, "init", "--yes").status).toBe(0);
      expect(snapshot(root)).not.toEqual(before);

      const r = lucent(root, "uninstall", "--yes");
      expect(r.status, r.out).toBe(0);
      const after = snapshot(root);
      // noUncheckedIndexedAccess is an ordinary TypeScript option: it stays, as the app may rely on it.
      const json = (text: string) => {
        const { config } = ts.parseConfigFileTextToJson("tsconfig.json", text) as {
          config: { compilerOptions?: Record<string, unknown> };
        };
        delete config.compilerOptions?.noUncheckedIndexedAccess;
        if (config.compilerOptions && !Object.keys(config.compilerOptions).length)
          delete config.compilerOptions;
        return config;
      };
      expect(json(after["tsconfig.json"]!)).toEqual(json(before["tsconfig.json"]!));
      // app.json is rewritten as JSON, as init writes it.
      if (before["app.json"])
        expect(JSON.parse(after["app.json"]!)).toEqual(JSON.parse(before["app.json"]));
      const rest = (s: Record<string, string>) =>
        Object.fromEntries(
          Object.entries(s).filter(([f]) => f !== "tsconfig.json" && f !== "app.json"),
        );
      expect(rest(after)).toEqual(rest(before));
      expect(r.out).toMatch(/next +.*lucent clean && .*@lucent-lang\/lucent/);

      const again = lucent(root, "uninstall", "--yes");
      expect(again.out).toMatch(/nothing of Lucent's to remove/);
    });

  it("removes the old react-native.config.js entry too, and the app's own entries stay", () => {
    const root = write(tmp(), {
      "package.json": JSON.stringify({ name: "app" }),
      "react-native.config.js":
        'module.exports = {\n  dependencies: {\n    "lucent": { root: require("path").join(__dirname, ".lucent", "native") },\n    other: { root: "x" },\n  },\n};\n',
    });
    expect(lucent(root, "uninstall", "--yes").status).toBe(0);
    expect(fs.readFileSync(path.join(root, "react-native.config.js"), "utf8")).toBe(
      'module.exports = {\n  dependencies: {\n    other: { root: "x" },\n  },\n};\n',
    );
  });

  it("changes nothing without --yes outside a terminal, and says what it would", () => {
    const root = APPS.bare();
    lucent(root, "init", "--yes");
    const before = snapshot(root);
    const r = lucent(root, "uninstall");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/metro\.config\.js/);
    expect(r.out).toMatch(/nothing was changed: run lucent uninstall --yes/);
    expect(snapshot(root)).toEqual(before);
  });
});
