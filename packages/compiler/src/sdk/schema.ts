
/**
 * The compiler's side of binding schemas (the format is @lucent-lang/bindgen's):
 * the type grammar, JNI descriptors, and module lookup.
 */

import { formatSchemaType, parseSchemaType, type Platform, PLATFORMS, type PrimName, type SchemaType, type SdkClassSchema, type SdkEnumSchema, type SdkStructSchema, type NamesIndex, type SdkLookup, type SdkModuleSchema, sdkIdentity, sdkModule, sdkNames, type SdkOptions } from "@lucent-lang/bindgen";

export { formatSchemaType, PLATFORMS };
export type { PrimName };
export type { SdkOptions } from "@lucent-lang/bindgen";
export type { Platform, SdkCallable, SdkClassSchema, SdkEnumSchema, SdkMethodSchema, SdkModuleSchema, SdkParam, SdkPropertySchema, SdkStructSchema } from "@lucent-lang/bindgen";

/** A schema type: `int`, `string?`, `long[]`, `Class<T>`, `android.os.Vibrator` (bindgen's format). */
export type SdkType = SchemaType;

const JNI_PRIM: Record<string, string> = { void: "V", boolean: "Z", bool: "Z", byte: "B", char: "C", short: "S", int: "I", long: "J", float: "F", double: "D" };

/** A schema type, as is, or from its written form (hand-written schemas); bare names refer to `module`. */
export function parseSdkType(s: string | SchemaType, module = "", typeParams: readonly string[] = []): SdkType {
  return typeof s === "string" ? parseSchemaType(s, module, typeParams) : s;
}

let sdkOptions: SdkOptions = {};

/** Runs `f` with the SDK locations a compile uses (compile options, else the defaults). */
export function withSdkOptions<T>(opts: SdkOptions | undefined, f: () => T): T {
  const saved = sdkOptions;
  sdkOptions = opts ?? {};
  try {
    return f();
  } finally {
    sdkOptions = saved;
  }
}

/** `lucent:<platform>/<module>`: its schema (extracted on first use), or why there is none. */
export function sdkLookup(platform: Platform, module: string): SdkLookup {
  return sdkModule(platform, module, sdkOptions);
}

/** The schema of `lucent:<platform>/<module>`, or undefined when there is none. */
export function findSdkModule(platform: Platform, module: string): SdkModuleSchema | undefined {
  const r = sdkLookup(platform, module);
  return "schema" in r ? r.schema : undefined;
}

export function loadSdkModule(platform: Platform, module: string): SdkModuleSchema {
  const r = sdkLookup(platform, module);
  if ("missing" in r) throw new Error(r.missing);
  return r.schema;
}

/** A type's kind and native name, from the module's names (no schema needed). */
export function sdkTypeInfo(platform: Platform, module: string, name: string): NamesIndex["types"][string] | undefined {
  const n = sdkNames(platform, module, sdkOptions);
  return "names" in n ? n.names.types[name] : undefined;
}

/** A module's type names, for typing other modules' signatures (iOS). */
export function sdkNamesOf(platform: Platform, module: string): NamesIndex | undefined {
  const n = sdkNames(platform, module, sdkOptions);
  return "names" in n ? n.names : undefined;
}

/** What identifies the SDKs in use, for build caches. */
export function currentSdkIdentity(): string {
  return sdkIdentity(sdkOptions);
}

export function findSdkType(platform: Platform, module: string, name: string): SdkClassSchema | SdkEnumSchema | SdkStructSchema | undefined {
  return findSdkModule(platform, module)?.types.find((t) => t.name === name);
}

/** The JNI descriptor of a method with these schema parameter and return types. */
export function jniDescriptor(params: (string | SchemaType)[], returns: string | SchemaType, typeParams: readonly string[] = []): string {
  const one = (t: SdkType): string => {
    switch (t.k) {
      case "prim":
        return JNI_PRIM[t.name] ?? fail(`${t.name} is not a Java type`);
      case "string":
        return t.charSequence ? "Ljava/lang/CharSequence;" : "Ljava/lang/String;";
      case "array":
        return `[${one(t.of)}`;
      case "classOf":
        return "Ljava/lang/Class;";
      case "tparam":
        return "Ljava/lang/Object;";
      case "bytes":
      case "date":
      case "id":
      case "record":
      case "out":
      case "fn":
      case "error":
        return fail(`${t.k} is not a Java type`);
      case "ref": {
        if (t.module === "java.lang") return `Ljava/lang/${t.name};`;
        const cls = findSdkType("android", t.module, t.name);
        if (cls?.kind !== "class") fail(`unknown Java class ${t.module}.${t.name}`);
        return `L${cls.native};`;
      }
    }
  };
  return `(${params.map((p) => one(parseSdkType(p, "", typeParams))).join("")})${one(parseSdkType(returns, "", typeParams))}`;
}

function fail(message: string): never {
  throw new Error(message);
}
