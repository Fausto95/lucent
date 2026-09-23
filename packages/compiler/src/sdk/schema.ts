import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Binding schemas: what a platform SDK module contains, as data. The
 * compiler types `lucent:ios/<module>` and `lucent:android/<package>`
 * imports from them (see dts.ts) and lowers calls to glue (emit/native.ts).
 * For the M2.0 spike they are written by hand in @lucent-lang/sdk-ios and
 * @lucent-lang/sdk-android; extractors produce the same format later.
 */

export type Platform = "ios" | "android";
export const PLATFORMS: readonly Platform[] = ["ios", "android"];

export interface SdkModuleSchema {
  platform: Platform;
  /** Clang/Swift module (iOS) or Java package (Android). */
  module: string;
  /** Frameworks to link (iOS). */
  frameworks?: string[];
  types: (SdkClassSchema | SdkEnumSchema)[];
  /** Members an extractor could not type yet (`Class.member: reason`). */
  skipped?: string[];
}

export interface SdkEnumSchema {
  kind: "enum";
  /** Name in Lucent: Swift name, nested types joined with `_`. */
  name: string;
  /** The C enum type. */
  native: string;
  cases: { name: string; native: string; value: number }[];
}

export interface SdkParam {
  name: string;
  type: string;
}

export interface SdkCallable {
  params: SdkParam[];
  /** Objective-C selector (iOS). */
  selector?: string;
  /** API level (Android) or OS version (iOS) that introduced it. */
  since?: number | string;
  /** Exact JNI descriptor (Android), when the types alone do not give it (generic erasure). */
  descriptor?: string;
  deprecated?: boolean;
}

export interface SdkMethodSchema extends SdkCallable {
  name: string;
  returns: string;
  static?: boolean;
  typeParams?: string[];
  mainActor?: boolean;
  /** The Java method name, when `name` was changed to tell overloads apart. */
  java?: string;
}

export interface SdkPropertySchema {
  name: string;
  type: string;
  static?: boolean;
  readonly?: boolean;
  /** Objective-C getter selector, when it differs from `name` (iOS). */
  selector?: string;
  /** Getter method, for Kotlin-style properties (Android); fields otherwise. */
  getter?: string;
  /** A compile-time constant (`static final` primitives and strings). */
  value?: number | string | boolean;
  since?: number | string;
  deprecated?: boolean;
}

export interface SdkClassSchema {
  kind: "class";
  name: string;
  /** Objective-C class (iOS) or JNI class name, `android/os/Build$VERSION` (Android). */
  native: string;
  /** Superclass, as a type reference. */
  extends?: string;
  /** Implemented interfaces (Java), as type references. */
  implements?: string[];
  /** A Java interface. */
  interface?: boolean;
  abstract?: boolean;
  /** Isolated to the main thread (`@MainActor`, `@UiThread`). */
  mainActor?: boolean;
  since?: number | string;
  constructors?: SdkCallable[];
  methods?: SdkMethodSchema[];
  properties?: SdkPropertySchema[];
}

/** A parsed schema type: `int`, `string?`, `long[]`, `Class<T>`, `android.os.Vibrator`, `UIDevice`. */
export type SdkType =
  | { k: "prim"; name: PrimName; nullable: boolean }
  | { k: "string"; nullable: boolean }
  | { k: "array"; of: SdkType; nullable: boolean }
  | { k: "classOf"; param: string; nullable: boolean }
  | { k: "tparam"; name: string; nullable: boolean }
  | { k: "ref"; module: string; name: string; nullable: boolean };

const PRIMS = ["void", "boolean", "bool", "byte", "char", "short", "int", "long", "float", "double", "CGFloat", "NSInteger", "NSUInteger"] as const;
export type PrimName = (typeof PRIMS)[number];

const JNI_PRIM: Record<string, string> = { void: "V", boolean: "Z", bool: "Z", byte: "B", char: "C", short: "S", int: "I", long: "J", float: "F", double: "D" };

/** Parses a schema type; bare names refer to `module`. */
export function parseSdkType(s: string, module = "", typeParams: readonly string[] = []): SdkType {
  if (s.endsWith("?")) return { ...parseSdkType(s.slice(0, -1), module, typeParams), nullable: true };
  if (s.endsWith("[]")) return { k: "array", of: parseSdkType(s.slice(0, -2), module, typeParams), nullable: false };
  const classOf = /^Class<(\w+)>$/.exec(s);
  if (classOf) return { k: "classOf", param: classOf[1]!, nullable: false };
  if (s === "string") return { k: "string", nullable: false };
  if ((PRIMS as readonly string[]).includes(s)) return { k: "prim", name: s as PrimName, nullable: false };
  if (typeParams.includes(s)) return { k: "tparam", name: s, nullable: false };
  const dot = s.lastIndexOf(".");
  return dot < 0 ? { k: "ref", module, name: s, nullable: false } : { k: "ref", module: s.slice(0, dot), name: s.slice(dot + 1), nullable: false };
}

const packageDirs: Record<Platform, string> = {} as never;
function schemaDir(platform: Platform): string {
  packageDirs[platform] ??= path.dirname(createRequire(import.meta.url).resolve(`@lucent-lang/sdk-${platform}/package.json`));
  return packageDirs[platform];
}

const cache = new Map<string, SdkModuleSchema | null>();

/** The schema of `lucent:<platform>/<module>`, or undefined when there is none. */
export function findSdkModule(platform: Platform, module: string): SdkModuleSchema | undefined {
  const key = `${platform}:${module}`;
  if (!cache.has(key)) {
    const file = path.join(schemaDir(platform), `${module}.json`);
    cache.set(key, /^[\w.]+$/.test(module) && fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as SdkModuleSchema) : null);
  }
  return cache.get(key) ?? undefined;
}

export function loadSdkModule(platform: Platform, module: string): SdkModuleSchema {
  const m = findSdkModule(platform, module);
  if (!m) throw new Error(`no binding schema for lucent:${platform}/${module}`);
  return m;
}

/** Every schema a platform ships (for inputs hashing). */
export function sdkSchemaFiles(): string[] {
  return (["ios", "android"] as const).flatMap((p) => {
    const dir = schemaDir(p);
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "package.json").map((f) => path.join(dir, f));
  });
}

export function findSdkType(platform: Platform, module: string, name: string): SdkClassSchema | SdkEnumSchema | undefined {
  return findSdkModule(platform, module)?.types.find((t) => t.name === name);
}

/** The JNI descriptor of a method with these schema parameter and return types. */
export function jniDescriptor(params: string[], returns: string, typeParams: readonly string[] = []): string {
  const one = (t: SdkType): string => {
    switch (t.k) {
      case "prim":
        return JNI_PRIM[t.name] ?? fail(`${t.name} is not a Java type`);
      case "string":
        return "Ljava/lang/String;";
      case "array":
        return `[${one(t.of)}`;
      case "classOf":
        return "Ljava/lang/Class;";
      case "tparam":
        return "Ljava/lang/Object;";
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
