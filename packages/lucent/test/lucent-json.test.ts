import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { EXTENSION_FIELDS, type PackageNative } from "../../compiler/src/package-config.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const schemaFile = path.resolve(here, "../schemas/lucent.schema.json");

type Schema = { properties: Record<string, { properties: Record<string, unknown> }> };
const schema = (): Schema => JSON.parse(fs.readFileSync(schemaFile, "utf8")) as Schema;

async function validate(value: unknown): Promise<string[]> {
  const { default: Ajv } = (await import("ajv")) as unknown as {
    default: new (o: object) => {
      compile(
        s: object,
      ): ((v: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] };
    };
  };
  const check = new Ajv({ allErrors: true }).compile(schema());
  return check(value) ? [] : (check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

/** Every field the build reads from a package's lucent.json (packages.ts), per platform. */
const read = {
  ios: [
    "pods",
    "frameworks",
    "infoPlist",
    "nativeSources",
    "resources",
    "resourceBundles",
    "vendoredFrameworks",
    "swiftPackages",
    "entitlements",
    "deploymentTarget",
  ],
  android: [
    "dependencies",
    "permissions",
    "nativeSources",
    "resources",
    "assets",
    "libraries",
    "nativeLibraries",
    "components",
    "minSdk",
  ],
} as const satisfies {
  [P in "ios" | "android"]: readonly (keyof NonNullable<PackageNative[P]>)[];
};

describe("lucent.json schema", () => {
  it("names exactly the fields the build reads", () => {
    const properties = schema().properties;
    expect(Object.keys(properties).sort()).toEqual([...Object.keys(read), "extensions"].sort());
    for (const [platform, fields] of Object.entries(read)) {
      expect(Object.keys(properties[platform]!.properties).sort()).toEqual([...fields].sort());
    }

    // An extension's fields, as the build checks them.
    const extension = (
      properties.extensions as unknown as {
        additionalProperties: { properties: Record<string, unknown> };
      }
    ).additionalProperties;
    expect(Object.keys(extension.properties).sort()).toEqual(Object.keys(EXTENSION_FIELDS).sort());
  });

  it("accepts the fixture extension's declaration, and rejects wrong shapes", async () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(root, "packages/compiler/test/fixtures/orbit-filter/lucent.json"),
        "utf8",
      ),
    );

    expect(await validate(fixture)).toEqual([]);
    expect(await validate({ extensions: { orbit: {} } })).not.toEqual([]);
    expect(
      await validate({
        extensions: {
          orbit: { header: "o.h", functions: { f: { params: { p: { bytes: "peek" } } } } },
        },
      }),
    ).not.toEqual([]);
    expect(await validate({ extensions: { "2d": { header: "o.h" } } })).not.toEqual([]);
  });

  it("accepts the example packages' lucent.json and every field", async () => {
    const orbit = JSON.parse(
      fs.readFileSync(path.join(root, "examples/lucent-orbit/lucent.json"), "utf8"),
    );
    const full = {
      ios: {
        pods: { LucentAuthKit: "~> 1.0" },
        frameworks: ["LocalAuthentication"],
        infoPlist: {
          NSFaceIDUsageDescription: "Unlock with Face ID",
          UIBackgroundModes: ["audio"],
          UIFileSharingEnabled: true,
        },
        nativeSources: ["native/ios"],
        resources: ["assets/ios/beep.caf"],
        resourceBundles: { OrbitAssets: ["assets/ios/images"] },
        vendoredFrameworks: ["vendor/Orbit.xcframework"],
        swiftPackages: {
          "https://github.com/orbit/orbit-swift": {
            requirement: { kind: "upToNextMajorVersion", minimumVersion: "1.2.0" },
            products: ["Orbit"],
          },
        },
        entitlements: {
          "com.apple.developer.healthkit": true,
          "com.apple.security.application-groups": ["group.dev.orbit"],
        },
        deploymentTarget: "15.1",
      },
      android: {
        dependencies: { "androidx.biometric:biometric": "1.1.0" },
        permissions: ["android.permission.USE_BIOMETRIC"],
        nativeSources: ["native/android"],
        resources: ["res"],
        assets: ["assets/android"],
        libraries: ["libs/orbit.aar"],
        nativeLibraries: ["jniLibs"],
        components: [
          {
            kind: "receiver",
            name: "dev.orbit.BootReceiver",
            exported: true,
            intentFilters: [
              {
                actions: ["android.intent.action.VIEW"],
                categories: ["android.intent.category.BROWSABLE"],
                data: [{ scheme: "orbit", host: "open" }],
              },
            ],
            metaData: { "dev.orbit.mode": "boot" },
          },
          { kind: "provider", name: "dev.orbit.Files", authorities: "dev.orbit.files" },
        ],
        minSdk: 26,
      },
    };
    expect(await validate(orbit)).toEqual([]);
    expect(await validate(full)).toEqual([]);
  });

  it("rejects unknown fields and wrong shapes", async () => {
    expect(await validate({ ios: { pod: { A: "1" } } })).not.toEqual([]);
    expect(await validate({ android: { permissions: "android.permission.CAMERA" } })).not.toEqual(
      [],
    );
    expect(await validate({ web: {} })).not.toEqual([]);
    expect(await validate({ ios: { infoPlist: { UIBackgroundModes: [1] } } })).not.toEqual([]);
    expect(await validate({ ios: { frameworks: "UIKit" } })).not.toEqual([]);
    expect(await validate({ android: { libraries: "libs/orbit.aar" } })).not.toEqual([]);
    expect(await validate({ ios: { resourceBundles: { Orbit: "assets" } } })).not.toEqual([]);
    expect(await validate({ android: { minSdk: "26" } })).not.toEqual([]);
    expect(
      await validate({ android: { components: [{ kind: "widget", name: "dev.orbit.W" }] } }),
    ).not.toEqual([]);
    expect(
      await validate({ android: { components: [{ kind: "provider", name: "dev.orbit.F" }] } }),
    ).not.toEqual([]);
    expect(
      await validate({
        ios: { swiftPackages: { u: { requirement: { kind: "from" }, products: [] } } },
      }),
    ).not.toEqual([]);
  });
});
