/**
 * Programs compiled against an exported schema set (lucent-sdk.schemas/):
 * iOS code typed and generated on any machine, from schemas written here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCHEMA_FORMAT, SCHEMA_SET_FORMAT } from "@lucent-lang/bindgen";
import { compile, type SdkOptions } from "../src/index.ts";
import { parseSdkType, type Platform, type SdkModuleSchema } from "../src/sdk/schema.ts";

/** A module's schema with types in their written form (`string?`, `Kit.KITThing`). */
export type WrittenSchema = { module: string; platform?: Platform } & Record<string, unknown>;

/** Types in their written form parsed, as bindgen writes them. */
export function typed(schema: WrittenSchema): SdkModuleSchema {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        (k === "type" || k === "returns") && typeof x === "string"
          ? parseSdkType(x, schema.module)
          : walk(x),
      ]),
    );
  };
  return {
    format: SCHEMA_FORMAT,
    platform: "ios",
    frameworks: [schema.module],
    ...(walk(schema) as object),
  } as SdkModuleSchema;
}

/** A schema set holding `schemas`, in a fresh directory. */
export function schemaSet(schemas: WrittenSchema[]): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-set-")), "set");
  for (const s of schemas) {
    const schema = typed(s);
    fs.mkdirSync(path.join(dir, schema.platform), { recursive: true });
    fs.writeFileSync(
      path.join(dir, schema.platform, `${schema.module}.json`),
      JSON.stringify({
        format: SCHEMA_SET_FORMAT,
        platform: schema.platform,
        module: schema.module,
        kind: "schema",
        artifacts: [`sdk:iphonesimulator26.0#${schema.module}`],
        schema,
      }),
    );
  }
  return dir;
}

/** `src` as a module's iOS side, compiled against `set` alone (no SDK is read). */
export function setProgram(src: string, set: string, sdk: SdkOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-set-program-"));
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    "m.ios.lucent.ts": src,
    "m.android.lucent.ts": 'export async function run(): Promise<string> {\n  return "";\n}\n',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const r = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    {
      platforms: ["ios"],
      sdk: {
        schemas: set,
        cacheDir: path.join(dir, "cache"),
        // No SDK here, wherever the tests run: the set is all there is.
        ios: { xcrun: path.join(dir, "no-xcrun") },
        ...sdk,
      },
    },
  );
  return {
    r,
    messages: r.diagnostics.map((d) => [d.code, d.message]),
    mm: r.files.get("ios/m_m.mm") ?? "",
    shims: r.files.get("ios/LucentShims.swift") ?? "",
    types: new Map(r.types ?? []),
  };
}
