import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const plugin = require("../app.plugin.js") as {
  linkNativePackage: (root: string) => void;
  withPackageEntries: (
    app: Record<string, unknown>,
    packages: Record<string, { value: unknown }>,
  ) => Record<string, unknown>;
};

function app(config?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-plugin-"));
  if (config !== undefined) fs.writeFileSync(path.join(root, "react-native.config.js"), config);

  return root;
}

const read = (root: string) => fs.readFileSync(path.join(root, "react-native.config.js"), "utf8");

describe("the Expo config plugin's link to the native package", () => {
  it("writes react-native.config.js when the app has none", () => {
    const root = app();

    plugin.linkNativePackage(root);

    expect(read(root)).toMatch(/"lucent": \{ root: /);
  });

  it("accepts an entry whatever its key's quotes, as formatters leave it", () => {
    for (const key of ['"lucent"', "'lucent'", "lucent"]) {
      const root = app(`module.exports = { dependencies: { ${key}: { root: "x" } } };\n`);

      expect(() => plugin.linkNativePackage(root)).not.toThrow();
    }
  });

  it("asks for the entry when the config links something else only", () => {
    const root = app(`module.exports = { dependencies: { other: { root: "x" } } };\n`);

    expect(() => plugin.linkNativePackage(root)).toThrow(/Add "lucent"/);
  });
});

describe("the Expo config plugin's Info.plist entries from Lucent packages", () => {
  it("adds what the app lacks, keeps the app's own values, and joins arrays", () => {
    const app = {
      NSCameraUsageDescription: "The app's own words",
      UIBackgroundModes: ["fetch"],
    };

    const merged = plugin.withPackageEntries(app, {
      NSCameraUsageDescription: { value: "A package's words" },
      NSFaceIDUsageDescription: { value: "Unlock" },
      UIBackgroundModes: { value: ["audio", "fetch"] },
      UIFileSharingEnabled: { value: true },
    });

    expect(merged).toEqual({
      NSCameraUsageDescription: "The app's own words",
      NSFaceIDUsageDescription: "Unlock",
      UIBackgroundModes: ["fetch", "audio"],
      UIFileSharingEnabled: true,
    });
  });
});
