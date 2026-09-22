import { describe, expect, test } from "vite-plus/test";
import { run } from "../src/cli.ts";
import { TOOLKIT_CONFIG, TOOLKIT_LIBRARY, TOOLKIT_SOURCE, fakeIO, project, wiredExpoProject } from "./helpers.ts";

const TOOLS = { swiftc: "Apple Swift version 6.2", kotlinc: "info: kotlinc-jvm 2.2.0", xcodebuild: "Xcode 26.0" };

describe("lucent doctor", () => {
  test("passes on a wired Expo project with the toolchain present", async () => {
    const io = fakeIO(wiredExpoProject(), { tools: TOOLS });
    expect(await run(["doctor"], io)).toBe(0);
    expect(io.out()).toContain("✅ swiftc");
    expect(io.out()).toContain("Apple Swift version 6.2");
    expect(io.out()).toContain("✅ kotlinc");
    expect(io.out()).toContain("expo");
    expect(io.out()).toContain("2 Lucent files");
    expect(io.out()).toContain("adb");
  });

  test("fails when a required tool is missing and says how to get it", async () => {
    const io = fakeIO(wiredExpoProject(), { tools: { swiftc: TOOLS.swiftc } });
    expect(await run(["doctor"], io)).toBe(1);
    expect(io.out()).toContain("❌ kotlinc");
    expect(io.out()).toContain("brew install kotlin");
  });

  test("finds project wiring problems", async () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { expo: "*" } }),
      "app.json": JSON.stringify({ expo: { plugins: [] } }),
      "metro.config.js": "module.exports = {};\n",
      "toolkit.library.json": TOOLKIT_LIBRARY,
      "lucent.config.json": TOOLKIT_CONFIG([]),
      "src/fingerprint.lucent.ts": TOOLKIT_SOURCE,
    });
    const io = fakeIO(root, { tools: TOOLS });
    expect(await run(["doctor"], io)).toBe(1);
    expect(io.out()).toContain("@lucent-lang/core");
    expect(io.out()).toContain("withLucent");
    expect(io.out()).toContain("expo plugin");
    expect(io.out()).toContain("crypto");
  });

  test("checks Nitro-specific wiring", async () => {
    const root = project({
      "package.json": JSON.stringify({
        dependencies: { "react-native-nitro-modules": "*", "@lucent-lang/core": "*" },
        devDependencies: { "@lucent-lang/cli": "*" },
      }),
      "metro.config.js": 'require("@lucent-lang/core/metro").withLucent',
      "src/math.lucent.ts": "export function f(): number { return 1; }\n",
    });
    const io = fakeIO(root, { tools: TOOLS });
    expect(await run(["doctor"], io)).toBe(1);
    expect(io.out()).toContain("nitrogen");
    expect(io.out()).toContain("react-native.config.js");
  });

  test("--json reports every check", async () => {
    const io = fakeIO(wiredExpoProject(), { tools: { swiftc: TOOLS.swiftc } });
    expect(await run(["doctor", "--json"], io)).toBe(1);
    const report = JSON.parse(io.out()) as {
      ok: boolean;
      toolchain: { name: string; status: string; detail: string }[];
      project: { name: string; status: string }[];
    };
    expect(report.ok).toBe(false);
    expect(report.toolchain.find((t) => t.name === "kotlinc")).toMatchObject({ status: "fail" });
    expect(report.toolchain.find((t) => t.name === "swiftc")).toMatchObject({ status: "ok", detail: TOOLS.swiftc });
    expect(report.project.every((c) => c.status === "ok")).toBe(true);
  });
});
