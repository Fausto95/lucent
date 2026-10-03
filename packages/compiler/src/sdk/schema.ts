/**
 * The compiler's side of binding schemas (the format is @lucent-lang/bindgen's):
 * the type grammar, JNI descriptors, and module lookup.
 */

import {
  formatSchemaType,
  parseSchemaType,
  type Platform,
  PLATFORMS,
  type PrimName,
  type SchemaType,
  type SdkClassSchema,
  type SdkEnumSchema,
  type SdkMethodSchema,
  type SdkStructSchema,
  type NamesIndex,
  type SdkLookup,
  type SdkModuleSchema,
  sdkAvailable,
  sdkIdentity,
  sdkModule,
  sdkNames,
  type SdkOptions,
  sdkSourceModule,
} from "@lucent-lang/bindgen";

export { formatSchemaType, PLATFORMS };

/** The oldest OS the app runs on (React Native's minimum). */
export const MIN_ANDROID_API = 24;
export const MIN_IOS = "15.1";

export type { PrimName };
export type { SdkOptions } from "@lucent-lang/bindgen";
export type {
  FactEvidence,
  NativeFacts,
  Platform,
  SchemaProvenance,
  SdkCallable,
  SdkClassSchema,
  SdkEnumSchema,
  SdkMethodSchema,
  SdkModuleSchema,
  SdkParam,
  SdkPropertySchema,
  SdkStructSchema,
  SwiftMember,
  SymbolId,
} from "@lucent-lang/bindgen";

/** A schema type: `int`, `string?`, `long[]`, `Class<T>`, `android.os.Vibrator` (bindgen's format). */
export type SdkType = SchemaType;

const JNI_PRIM: Record<string, string> = {
  void: "V",
  boolean: "Z",
  bool: "Z",
  byte: "B",
  char: "C",
  short: "S",
  int: "I",
  long: "J",
  float: "F",
  double: "D",
};

/** A schema type, as is, or from its written form (hand-written schemas); bare names refer to `module`. */
export function parseSdkType(
  s: string | SchemaType,
  module = "",
  typeParams: readonly string[] = [],
): SdkType {
  return typeof s === "string" ? parseSchemaType(s, module, typeParams) : s;
}

let sdkOptions: SdkOptions = {};
let deferredPlatforms: readonly Platform[] = [];

/**
 * Runs `f` with the SDK locations a compile uses (compile options, else the
 * defaults), and the platforms whose SDK imports resolve only later. Each
 * compile gets its own options object: its artifacts are resolved anew,
 * as installed now.
 */
export function withSdkOptions<T>(
  opts: SdkOptions | undefined,
  f: () => T,
  deferred: readonly Platform[] = [],
): T {
  const saved = [sdkOptions, deferredPlatforms] as const;
  sdkOptions = { ...opts };
  deferredPlatforms = deferred;
  try {
    return f();
  } finally {
    [sdkOptions, deferredPlatforms] = saved;
  }
}

/**
 * Whether programs that do not target a platform type its SDK modules: its
 * SDK is installed, and its imports are not deferred. Where they are not,
 * that platform's code is untyped there (the target's program types it).
 */
export function platformSdkTyped(platform: Platform): boolean {
  return !deferredPlatforms.includes(platform) && sdkAvailable(platform, sdkOptions);
}

/** `lucent:<platform>/<module>`: its schema (extracted on first use), or why there is none. */

export function sdkLookup(platform: Platform, module: string): SdkLookup {
  return sdkModule(platform, module, sdkOptions);
}

/** A module written as source (a toolkit's: SwiftUI), extracted on first use, or why there is none. */
export function sourceModuleLookup(platform: Platform, module: string): SdkLookup {
  return sdkSourceModule(platform, module, sdkOptions);
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
export function sdkTypeInfo(
  platform: Platform,
  module: string,
  name: string,
): NamesIndex["types"][string] | undefined {
  const n = sdkNames(platform, module, sdkOptions);
  return "names" in n ? n.names.types[name] : undefined;
}

/** A module's type names, for typing other modules' signatures (iOS). */
export function sdkNamesOf(platform: Platform, module: string): NamesIndex | undefined {
  const n = sdkNames(platform, module, sdkOptions);
  return "names" in n ? n.names : undefined;
}

/** Where the SDK cache is, for the caches kept beside it. */
export function sdkCacheDir(): string | undefined {
  return sdkOptions.cacheDir;
}

/** What identifies the SDKs in use, for build caches. */
export function currentSdkIdentity(): string {
  return sdkIdentity(sdkOptions);
}

export function findSdkType(
  platform: Platform,
  module: string,
  name: string,
): SdkClassSchema | SdkEnumSchema | SdkStructSchema | undefined {
  return findSdkModule(platform, module)?.types.find((t) => t.name === name);
}

/**
 * The fields of a Swift enum case's payload in Lucent: their labels;
 * `value` for a lone unlabeled one, `_0`, `_1`… for several.
 */
export function payloadFields(params: { label?: string }[]): string[] {
  return params.map((p, i) => p.label ?? (params.length === 1 ? "value" : `_${i}`));
}

/**
 * Whether a method with a completion handler is also declared as returning
 * a promise. Not in protocols: a Lucent class implements the handler form,
 * and would have to implement the promise form too.
 */
export function declaresPromise(cls: SdkClassSchema, m: SdkMethodSchema): boolean {
  if (!m.async || cls.interface) return false;

  // Sugar never hides a member: a property of the promise form's name stays,
  // and the completion-handler method remains callable.
  const name = m.async.name ?? m.name;
  return !cls.properties?.some((p) => p.name === name && !!p.static === !!m.static);
}

/** The Java interface whose implementations `using` declarations close. */
export const AUTO_CLOSEABLE = "java/lang/AutoCloseable";

/** Whether an SDK class is the class or interface `native` (`java/lang/AutoCloseable`), or extends or implements it. */
export function sdkClassIs(
  platform: Platform,
  module: string,
  name: string,
  native: string,
): boolean {
  const seen = new Set<string>();
  const visit = (module: string, name: string): boolean => {
    if (seen.has(`${module}:${name}`)) return false;
    seen.add(`${module}:${name}`);
    const cls = findSdkType(platform, module, name);
    if (cls?.kind !== "class") return false;
    if (cls.native === native) return true;
    return [...(cls.extends ? [cls.extends] : []), ...(cls.implements ?? [])].some((s) => {
      const t = parseSdkType(s, module);
      return t.k === "ref" && visit(t.module, t.name);
    });
  };
  return visit(module, name);
}

/** The JNI descriptor of a method with these schema parameter and return types. */
export function jniDescriptor(
  params: (string | SchemaType)[],
  returns: string | SchemaType,
  typeParams: readonly string[] = [],
): string {
  const one = (t: SdkType): string => {
    switch (t.k) {
      case "prim":
        return JNI_PRIM[t.name] ?? fail(`${t.name} is not a Java type`);
      case "string":
        return t.charSequence ? "Ljava/lang/CharSequence;" : "Ljava/lang/String;";
      case "array":
        return t.list ? "Ljava/util/List;" : `[${one(t.of)}`;
      case "classOf":
        return "Ljava/lang/Class;";
      case "tparam":
        return "Ljava/lang/Object;";
      case "bytes":
      case "date":
      case "id":
      case "record":
      case "set":
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
