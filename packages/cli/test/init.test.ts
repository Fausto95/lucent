import { describe, expect, test } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadLucentConfig } from "@lucent-lang/host-core";
import { run } from "../src/cli.ts";
import { fakeIO, project } from "./helpers.ts";

const read = (root: string, file: string): string => readFileSync(join(root, file), "utf8");
const pkg = (root: string): { dependencies: Record<string, string>; devDependencies: Record<string, string> } =>
  JSON.parse(read(root, "package.json")) as never;

describe("lucent init", () => {
  test("wires an Expo app end to end", async () => {
    const root = project({
      "package.json": JSON.stringify({ name: "app", dependencies: { expo: "~58.0.0" } }),
      "app.json": JSON.stringify({ expo: { name: "app", plugins: ["expo-font"] } }),
    });
    const io = fakeIO(root);
    expect(await run(["init", "--yes"], io)).toBe(0);

    expect(pkg(root).dependencies["@lucent-lang/core"]).toBeDefined();
    for (const dep of ["@lucent-lang/cli"]) expect(pkg(root).devDependencies[dep], dep).toBeDefined();
    expect(read(root, "src/math.lucent.ts")).toContain("export function add");
    expect(() => loadLucentConfig(root)).not.toThrow();
    expect(read(root, "lucent.config.ts")).toContain("defineNativeConfig");
    const app = JSON.parse(read(root, "app.json")) as { expo: { plugins: unknown[] } };
    expect(app.expo.plugins).toEqual(["expo-font", ["@lucent-lang/core/expo", { host: "expo" }]]);
    expect(read(root, "metro.config.js")).toContain("withLucent");
    expect(read(root, "metro.config.js")).toContain("expo/metro-config");
    expect(io.out()).toContain("npm install");
    expect(io.out()).toContain("expo prebuild");
  });

  test("wires a bare React Native app for Nitro", async () => {
    const root = project({ "package.json": JSON.stringify({ dependencies: { "react-native": "0.88.0" } }) });
    const io = fakeIO(root);
    expect(await run(["init", "--host", "nitro", "--yes"], io)).toBe(0);
    expect(pkg(root).dependencies["react-native-nitro-modules"]).toBeDefined();
    expect(pkg(root).dependencies["lucent-native"]).toBe("file:./.lucent/nitro");
    for (const dep of ["nitrogen", "@lucent-lang/cli"]) expect(pkg(root).devDependencies[dep], dep).toBeDefined();
    expect(read(root, "react-native.config.js")).toContain("lucent-native");
    expect(read(root, "metro.config.js")).toContain("@react-native/metro-config");
    expect(read(root, "metro.config.js")).toContain('host: "nitro"');
    expect(io.out()).toContain("lucent build --host nitro");
  });

  test("is idempotent", async () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { expo: "*" } }),
      "app.json": JSON.stringify({ expo: { plugins: [] } }),
    });
    await run(["init", "--yes"], fakeIO(root));
    const snapshot = ["package.json", "app.json", "metro.config.js", "lucent.config.ts", "src/math.lucent.ts"].map(
      (f) => read(root, f),
    );
    const io = fakeIO(root);
    expect(await run(["init", "--yes"], io)).toBe(0);
    expect(io.out()).toContain("already");
    expect(
      ["package.json", "app.json", "metro.config.js", "lucent.config.ts", "src/math.lucent.ts"].map((f) =>
        read(root, f),
      ),
    ).toEqual(snapshot);
  });

  test("leaves an existing metro config alone and explains what to add", async () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { expo: "*" } }),
      "metro.config.js": "module.exports = {};\n",
    });
    const io = fakeIO(root);
    await run(["init", "--yes"], io);
    expect(read(root, "metro.config.js")).toBe("module.exports = {};\n");
    expect(io.out()).toContain("withLucent");
  });

  test("does not add a starter when Lucent files already exist", async () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { expo: "*" } }),
      "src/geo.lucent.ts": "export function f(): number { return 1; }\n",
    });
    await run(["init", "--yes"], fakeIO(root));
    expect(existsSync(join(root, "src/math.lucent.ts"))).toBe(false);
  });

  test("refuses without a package.json", async () => {
    const io = fakeIO(project({}));
    expect(await run(["init", "--yes"], io)).toBe(1);
    expect(io.err()).toContain("package.json");
  });

  test("asks for --host when it cannot detect one and cannot prompt", async () => {
    const io = fakeIO(project({ "package.json": "{}" }));
    expect(await run(["init"], io)).toBe(1);
    expect(io.err()).toContain("--host");
    const yes = fakeIO(project({ "package.json": "{}" }));
    expect(await run(["init", "--yes"], yes)).toBe(0);
    expect(yes.out()).toContain("expo");
  });
});
