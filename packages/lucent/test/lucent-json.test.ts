import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PackageNative } from "../../compiler/src/packages.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const schemaFile = path.resolve(here, "../schemas/lucent.schema.json");

type Schema = { properties: Record<string, { properties: Record<string, unknown> }> };
const schema = (): Schema => JSON.parse(fs.readFileSync(schemaFile, "utf8")) as Schema;

async function validate(value: unknown): Promise<string[]> {
  const { default: Ajv } = (await import("ajv")) as unknown as { default: new (o: object) => { compile(s: object): ((v: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] } } };
  const check = new Ajv({ allErrors: true }).compile(schema());
  return check(value) ? [] : (check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

/** Every field the build reads from a package's lucent.json (packages.ts), per platform. */
const read = {
  ios: ["pods", "infoPlist"],
  android: ["dependencies", "permissions"],
} as const satisfies { [P in keyof Required<PackageNative>]: readonly (keyof NonNullable<PackageNative[P]>)[] };

describe("lucent.json schema", () => {
  it("names exactly the fields the build reads", () => {
    const properties = schema().properties;
    expect(Object.keys(properties).sort()).toEqual(Object.keys(read).sort());
    for (const [platform, fields] of Object.entries(read)) {
      expect(Object.keys(properties[platform]!.properties).sort()).toEqual([...fields].sort());
    }
  });

  it("accepts the lucent.json files the docs show", async () => {
    const tutorial = JSON.parse(fs.readFileSync(path.join(root, "apps/tutorial/steps/8-publish/trip-tracker/lucent.json"), "utf8"));
    const full = {
      ios: { pods: { LucentAuthKit: "~> 1.0" }, infoPlist: { NSFaceIDUsageDescription: "Unlock with Face ID" } },
      android: { dependencies: { "androidx.biometric:biometric": "1.1.0" }, permissions: ["android.permission.USE_BIOMETRIC"] },
    };
    expect(await validate(tutorial)).toEqual([]);
    expect(await validate(full)).toEqual([]);
  });

  it("rejects unknown fields and wrong shapes", async () => {
    expect(await validate({ ios: { pod: { A: "1" } } })).not.toEqual([]);
    expect(await validate({ android: { permissions: "android.permission.CAMERA" } })).not.toEqual([]);
    expect(await validate({ web: {} })).not.toEqual([]);
  });
});
