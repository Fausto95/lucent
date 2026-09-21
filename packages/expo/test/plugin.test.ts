import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import withLucent from "../src/plugin.ts";

type Mod = (config: Record<string, unknown>) => Promise<Record<string, unknown>>;

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "lucent-expo-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", version: "1.0.0" }));
  writeFileSync(
    join(root, "src", "math.lucent.ts"),
    "export function add(a: number, b: number): number { return a + b; }\n",
  );
  return root;
}

describe("@lucent-lang/expo config plugin", () => {
  test("registers dangerous mods for ios and android that run lucent build", async () => {
    const root = project();
    const config = withLucent({ name: "app", slug: "app" } as never, { host: "expo" }) as unknown as {
      mods: { ios: { dangerous: Mod }; android: { dangerous: Mod } };
    };
    expect(typeof config.mods.ios.dangerous).toBe("function");
    expect(typeof config.mods.android.dangerous).toBe("function");
    const modRequest = {
      projectRoot: root,
      platformProjectRoot: join(root, "ios"),
      platform: "ios",
      modName: "dangerous",
      introspect: false,
    };
    await config.mods.ios.dangerous({ name: "app", slug: "app", modRequest, modResults: null, modRawConfig: {} });
    expect(existsSync(join(root, "modules", "lucent", "ios", "LucentMathModule.swift"))).toBe(true);
  });

  test("does nothing when introspecting", async () => {
    const root = project();
    const config = withLucent({ name: "app", slug: "app" } as never, {}) as unknown as {
      mods: { android: { dangerous: Mod } };
    };
    const modRequest = {
      projectRoot: root,
      platformProjectRoot: join(root, "android"),
      platform: "android",
      modName: "dangerous",
      introspect: true,
    };
    await config.mods.android.dangerous({ name: "app", slug: "app", modRequest, modResults: null, modRawConfig: {} });
    expect(existsSync(join(root, "modules"))).toBe(false);
  });
});
