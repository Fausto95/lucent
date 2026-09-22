import { expect, test } from "vite-plus/test";
import { validateLucentPackage } from "../src/package.ts";

test("accepts a complete target manifest", () => {
  expect(
    validateLucentPackage({
      schemaVersion: 1,
      name: "@lucent-lang/camera",
      platforms: ["ios", "android"],
      minVersions: { ios: "16.0", android: 26 },
      nativeDependencies: {
        ios: { AVFoundation: "*" },
        android: { "androidx.camera:camera-camera2": ">=1.5.0" },
      },
      sdkRequirements: { ios: ["AVFoundation"], android: ["CameraX"] },
      compiler: ">=0.0.1",
      hosts: ["expo", "nitro"],
      permissions: { camera: { reason: "Scan" } },
      capabilities: { camera: true },
    }),
  ).toEqual([]);
});

test("reports invalid known fields", () => {
  const messages = validateLucentPackage({
    schemaVersion: "1",
    platforms: ["web"],
    hosts: ["metro"],
    minVersions: { ios: 16 },
  });
  expect(messages.some((m) => m.includes("schemaVersion"))).toBe(true);
  expect(messages.some((m) => m.includes("platforms"))).toBe(true);
  expect(messages.some((m) => m.includes("hosts"))).toBe(true);
  expect(messages.some((m) => m.includes("minVersions.ios"))).toBe(true);
});

test("warns on unknown top-level fields", () => {
  const messages = validateLucentPackage({ schemaVersion: 1, experimentalFlag: true });
  expect(messages).toContain('warning: unknown field "experimentalFlag"');
});

test("rejects non-objects", () => {
  expect(validateLucentPackage([])).toEqual(["lucent.package.json must be a JSON object"]);
});
