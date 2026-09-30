/**
 * Compose's binding schemas, which Lucent ships: the Compose release the
 * generated Android library builds with is Lucent's (its BOM), not the
 * app's, so its bindings are the same for every app. They are made from
 * that release's Kotlin metadata by scripts/compose-bindings.ts and read
 * from lib/sdk/compose.schemas.json.gz, without Gradle or the Android SDK:
 * a first build, before the Gradle build that downloads Compose, types
 * lucent:compose as well as any other.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { loadSchema, type SdkModuleSchema } from "@lucent-lang/bindgen";
import { sdkLibFile } from "../lib-files.ts";

/** The file's contents. */
export interface ComposeSchemaFile {
  /** The Compose BOM the schemas are of. */
  bom: string;
  /** The artifacts of Compose's own libraries (`maven:androidx.compose.ui:ui-android:1.10.5`). */
  libraries: string[];
  /** Their Kotlin packages' schemas, then those declaring the classes they name from their dependencies. */
  modules: SdkModuleSchema[];
}

export const COMPOSE_SCHEMAS = "compose.schemas.json.gz";

let loaded: { file: ComposeSchemaFile; byName: Map<string, SdkModuleSchema> } | undefined;

function load() {
  if (!loaded) {
    const text = zlib.gunzipSync(fs.readFileSync(sdkLibFile(COMPOSE_SCHEMAS))).toString("utf8");
    const file = JSON.parse(text) as ComposeSchemaFile;
    const modules = file.modules.map(loadSchema);

    loaded = { file: { ...file, modules }, byName: new Map(modules.map((m) => [m.module, m])) };
  }

  return loaded;
}

/** Every schema of the file, Compose's and its dependencies'. */
export function composeSchemas(): ComposeSchemaFile {
  return load().file;
}

/** A module Compose declares (`androidx.compose.foundation.layout`), which `lucent sdk` shows as others. */
export function composeModule(module: string): SdkModuleSchema | undefined {
  const { file, byName } = load();
  const m = byName.get(module);

  return m && file.libraries.includes(m.provenance?.artifact ?? "") ? m : undefined;
}

/** The names of the modules Compose declares. */
export function composeModuleNames(): string[] {
  const { file } = load();

  return file.modules
    .filter((m) => file.libraries.includes(m.provenance?.artifact ?? ""))
    .map((m) => m.module);
}
