/**
 * The binding schema format: what a platform SDK module contains, as data.
 * Extractors (android.ts, ios.ts) produce it; the compiler types
 * `lucent:ios/<module>` and `lucent:android/<package>` imports from it and
 * lowers calls to glue.
 */

export type Platform = "ios" | "android";
export const PLATFORMS: readonly Platform[] = ["ios", "android"];

export interface SdkModuleSchema {
  platform: Platform;
  /** Clang/Swift module (iOS) or Java package (Android). */
  module: string;
  /** Frameworks to link (iOS): the SDK framework; none for a pod, which links itself. */
  frameworks?: string[];
  /** The header to import for the module (iOS): `M/M.h`, or the umbrella its module map names. */
  header?: string;
  types: (SdkClassSchema | SdkEnumSchema | SdkStructSchema)[];
  /** C functions (iOS). */
  functions?: SdkMethodSchema[];
  /** C global constants (iOS): `kSecClass`, `NSFileCreationDate`… */
  constants?: SdkPropertySchema[];
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

/** A C struct passed by value (iOS): numbers, booleans and structs, in field order. */
export interface SdkStructSchema {
  kind: "struct";
  name: string;
  /** The C type name. */
  native: string;
  fields: SdkParam[];
}

export interface SdkParam {
  name: string;
  type: SchemaType;
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
  returns: SchemaType;
  static?: boolean;
  typeParams?: string[];
  mainActor?: boolean;
  /** The Java method name, when `name` was changed to tell overloads apart. */
  java?: string;
  /** Reports failure through a trailing NSError** (Swift `throws`). */
  throws?: boolean;
  /**
   * The last parameter is a completion block that Swift also imports as
   * `async` (iOS): the method can be called without it, for a promise of
   * `returns`, rejected with the block's error when `throws`; under `name`
   * when Swift names the async form differently.
   */
  async?: { returns: SchemaType; throws?: boolean; name?: string };
  /** An optional protocol requirement (iOS): implementations may leave it out. */
  optional?: boolean;
  /** Abstract (Java): implementations and subclasses must provide it. */
  abstract?: boolean;
  /** Android permissions the method requires (@RequiresPermission: value, anyOf, allOf). */
  permissions?: string[];
}

export interface SdkPropertySchema {
  name: string;
  type: SchemaType;
  static?: boolean;
  readonly?: boolean;
  /** Objective-C getter selector, when it differs from `name` (iOS). */
  selector?: string;
  /** Objective-C setter selector, for writable properties (iOS). */
  setter?: string;
  /** A weak reference (iOS): setting it does not keep the value alive. */
  weak?: boolean;
  /** Getter method, for Kotlin-style properties (Android); fields otherwise. */
  getter?: string;
  /** A C global holding the value (iOS typed string keys: `NSFileCreationDate`). */
  global?: string;
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
  /** A Java interface, or an Objective-C protocol. */
  interface?: boolean;
  /** Objective-C: declares no initializers but inherits its superclass's. */
  inheritsInit?: boolean;
  abstract?: boolean;
  /** A Java interface with one abstract method, named here: functions implement it. */
  functional?: string;
  /** Isolated to the main thread (`@MainActor`, `@UiThread`). */
  mainActor?: boolean;
  /** An opaque CoreFoundation-style handle (`CGImageRef`): `native` is its C type. */
  cf?: boolean;
  since?: number | string;
  constructors?: SdkCallable[];
  methods?: SdkMethodSchema[];
  properties?: SdkPropertySchema[];
}

// --- types ---------------------------------------------------------------------------

/** A parsed schema type: `int`, `string?`, `long[]`, `Class<T>`, `android.os.Vibrator`, `UIDevice`. */
export type SchemaType =
  | { k: "prim"; name: PrimName; nullable: boolean }
  /** Java's String, or CharSequence (`charSequence`: results are read through toString()). */
  | { k: "string"; nullable: boolean; charSequence?: boolean; cf?: boolean }
  | { k: "array"; of: SchemaType; nullable: boolean; cf?: boolean }
  /** NSSet (Swift's Set): a Lucent Set. */
  | { k: "set"; of: SchemaType; nullable: boolean }
  /** NSData / CFData: Uint8Array. */
  | { k: "bytes"; nullable: boolean; cf?: boolean }
  /** NSDate: Date. */
  | { k: "date"; nullable: boolean }
  /** Objective-C `Any` (id) / CFTypeRef. */
  | { k: "id"; nullable: boolean; cf?: boolean }
  /** [String: T] / CFDictionary: Record<string, T>. */
  | { k: "record"; of: SchemaType; nullable: boolean; cf?: boolean }
  /** A C out-parameter (`CFTypeRef *`). */
  | { k: "out"; of: SchemaType; nullable: boolean }
  | { k: "classOf"; param: string; nullable: boolean }
  /** A block (iOS): `escaping` when it outlives the call, `main` when it runs on the main thread. */
  | { k: "fn"; params: SchemaType[]; ret: SchemaType; escaping: boolean; main: boolean; nullable: boolean }
  /** Swift's Error (an NSError): a Lucent Error. */
  | { k: "error"; nullable: boolean }
  | { k: "tparam"; name: string; nullable: boolean }
  | { k: "ref"; module: string; name: string; nullable: boolean };

export const PRIMS = ["void", "boolean", "bool", "byte", "char", "short", "int", "long", "float", "double", "CGFloat", "NSInteger", "NSUInteger", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64"] as const;
export type PrimName = (typeof PRIMS)[number];

/** Parses a schema type; bare names refer to `module`. */
export function parseSchemaType(s: string, module = "", typeParams: readonly string[] = []): SchemaType {
  const toks = s.match(/@\w+|=>|[()[\]<>?,]|[\w.$]+/g) ?? [];
  let p = 0;
  const expect = (t: string) => {
    if (toks[p++] !== t) throw new Error(`schema type ${s}: expected ${t}`);
  };
  const type = (): SchemaType => {
    let t = primary();
    for (;;) {
      if (toks[p] === "?") {
        p++;
        // An optional block is stored, so it escapes.
        t = t.k === "fn" ? { ...t, escaping: true, nullable: true } : { ...t, nullable: true };
      } else if (toks[p] === "[" && toks[p + 1] === "]") {
        p += 2;
        t = { k: "array", of: t, nullable: false };
      } else return t;
    }
  };
  const primary = (): SchemaType => {
    const attrs: string[] = [];
    while (toks[p]?.startsWith("@")) attrs.push(toks[p++]!);
    if (toks[p] === "(") {
      p++;
      const items: SchemaType[] = [];
      while (toks[p] !== ")") {
        items.push(type());
        if (toks[p] === ",") p++;
        else break;
      }
      expect(")");
      if (toks[p] === "=>") {
        p++;
        return { k: "fn", params: items, ret: type(), escaping: attrs.includes("@escaping"), main: attrs.includes("@main"), nullable: false };
      }
      if (items.length !== 1 || attrs.length) throw new Error(`schema type ${s}: expected =>`);
      return items[0]!;
    }
    const name = toks[p++];
    if (!name || !/^[\w.$]+$/.test(name)) throw new Error(`schema type ${s}: unexpected ${name ?? "end"}`);
    if (toks[p] === "<") {
      p++;
      if (name === "Class") {
        const param = toks[p++]!;
        expect(">");
        return { k: "classOf", param, nullable: false };
      }
      const of = type();
      expect(">");
      if (name === "Record") return { k: "record", of, nullable: false };
      if (name === "Out") return { k: "out", of, nullable: false };
      if (name === "Set") return { k: "set", of, nullable: false };
      throw new Error(`schema type ${s}: unknown generic ${name}`);
    }
    return named(name, module, typeParams);
  };
  const t = type();
  if (p !== toks.length) throw new Error(`schema type ${s}: unexpected ${toks[p]}`);
  return t;
}

function named(s: string, module: string, typeParams: readonly string[]): SchemaType {
  switch (s) {
    case "NSData":
      return { k: "bytes", nullable: false };
    case "CFData":
      return { k: "bytes", nullable: false, cf: true };
    case "NSDate":
      return { k: "date", nullable: false };
    case "id":
      return { k: "id", nullable: false };
    case "error":
      return { k: "error", nullable: false };
    case "CFTypeRef":
    case "CFNumber":
      return { k: "id", nullable: false, cf: true };
    case "CFString":
      return { k: "string", nullable: false, cf: true };
    case "CFDictionary":
      return { k: "record", of: { k: "id", nullable: false }, nullable: false, cf: true };
    case "CFArray":
      return { k: "array", of: { k: "id", nullable: false }, nullable: false, cf: true };
    case "CFBoolean":
      return { k: "prim", name: "bool", nullable: false };
  }
  if (s === "string") return { k: "string", nullable: false };
  if (s === "CharSequence") return { k: "string", nullable: false, charSequence: true };
  if ((PRIMS as readonly string[]).includes(s)) return { k: "prim", name: s as PrimName, nullable: false };
  if (typeParams.includes(s)) return { k: "tparam", name: s, nullable: false };
  const dot = s.lastIndexOf(".");
  return dot < 0 ? { k: "ref", module, name: s, nullable: false } : { k: "ref", module: s.slice(0, dot), name: s.slice(dot + 1), nullable: false };
}

/** The written form of a schema type (`(@main (bool) => void)?`), as parseSchemaType reads it: for names and messages. */
export function formatSchemaType(t: SchemaType): string {
  const q = t.nullable ? "?" : "";
  switch (t.k) {
    case "prim":
      return `${t.name}${q}`;
    case "string":
      return `${t.cf ? "CFString" : t.charSequence ? "CharSequence" : "string"}${q}`;
    case "bytes":
      return `${t.cf ? "CFData" : "NSData"}${q}`;
    case "date":
      return `NSDate${q}`;
    case "id":
      return `${t.cf ? "CFTypeRef" : "id"}${q}`;
    case "error":
      return `error${q}`;
    case "array": {
      if (t.cf) return `CFArray${q}`;
      const of = formatSchemaType(t.of);
      return `${t.of.k === "fn" && !t.of.nullable ? `(${of})` : of}[]${q}`;
    }
    case "record":
      return t.cf ? `CFDictionary${q}` : `Record<${formatSchemaType(t.of)}>${q}`;
    case "set":
      return `Set<${formatSchemaType(t.of)}>${q}`;
    case "out":
      return `Out<${formatSchemaType(t.of)}>${q}`;
    case "classOf":
      return `Class<${t.param}>${q}`;
    case "tparam":
      return `${t.name}${q}`;
    case "ref":
      return `${t.module ? `${t.module}.` : ""}${t.name}${q}`;
    case "fn": {
      const flags = `${t.escaping && !t.nullable ? "@escaping " : ""}${t.main ? "@main " : ""}`;
      const fn = `${flags}(${t.params.map(formatSchemaType).join(", ")}) => ${formatSchemaType(t.ret)}`;
      return t.nullable ? `(${fn})?` : fn;
    }
  }
}

