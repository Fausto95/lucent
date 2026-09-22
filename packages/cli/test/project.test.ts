import { describe, expect, test } from "vite-plus/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHost, detectPackageManager, PACKAGE_MANAGERS } from "../src/project.ts";

describe("detectHost", () => {
  test("nitro when react-native-nitro-modules is installed", () => {
    expect(detectHost({ dependencies: { "react-native-nitro-modules": "*", expo: "*" } })).toBe("nitro");
  });
  test("expo when expo is installed", () => {
    expect(detectHost({ dependencies: { expo: "~58.0.0" } })).toBe("expo");
    expect(detectHost({ devDependencies: { expo: "~58.0.0" } })).toBe("expo");
  });
  test("unknown otherwise", () => {
    expect(detectHost({ dependencies: { "react-native": "*" } })).toBeNull();
    expect(detectHost(null)).toBeNull();
  });
});

const root = (files: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "lucent-pm-"));
  for (const f of files) writeFileSync(join(dir, f), "");
  return dir;
};

describe("detectPackageManager", () => {
  test("reads the lockfile", () => {
    expect(detectPackageManager({ root: root(["pnpm-lock.yaml"]), env: {} })).toBe("pnpm");
    expect(detectPackageManager({ root: root(["yarn.lock"]), env: {} })).toBe("yarn");
    expect(detectPackageManager({ root: root(["bun.lock"]), env: {} })).toBe("bun");
    expect(detectPackageManager({ root: root(["bun.lockb"]), env: {} })).toBe("bun");
    expect(detectPackageManager({ root: root(["package-lock.json"]), env: {} })).toBe("npm");
  });
  test("falls back to the invoking package manager, then npm", () => {
    expect(detectPackageManager({ root: root([]), env: { npm_config_user_agent: "yarn/4.0.0 npm/? node/v24" } })).toBe(
      "yarn",
    );
    expect(detectPackageManager({ root: root([]), env: {} })).toBe("npm");
  });
});

test("package managers render install commands", () => {
  expect(PACKAGE_MANAGERS.pnpm.add(["a", "b"], true)).toBe("pnpm add -D a b");
  expect(PACKAGE_MANAGERS.npm.add(["a"], false)).toBe("npm install a");
  expect(PACKAGE_MANAGERS.yarn.add(["a"], true)).toBe("yarn add -D a");
  expect(PACKAGE_MANAGERS.bun.install).toBe("bun install");
  expect(PACKAGE_MANAGERS.pnpm.exec).toBe("pnpm exec");
  expect(PACKAGE_MANAGERS.npm.exec).toBe("npx");
});
