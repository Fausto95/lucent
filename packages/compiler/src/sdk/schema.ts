
/**
 * The compiler's side of binding schemas (the format is @lucent-lang/bindgen's):
 * the type grammar, JNI descriptors, and module lookup.
 */

import { type Platform, PLATFORMS, type SdkClassSchema, type SdkEnumSchema, type SdkStructSchema, type NamesIndex, type SdkLookup, type SdkModuleSchema, sdkIdentity, sdkModule, sdkNames, type SdkOptions } from "@lucent-lang/bindgen";

export { PLATFORMS };
export type { SdkOptions } from "@lucent-lang/bindgen";
export type { Platform, SdkCallable, SdkClassSchema, SdkEnumSchema, SdkMethodSchema, SdkModuleSchema, SdkParam, SdkPropertySchema, SdkStructSchema } from "@lucent-lang/bindgen";

/** A parsed schema type: `int`, `string?`, `long[]`, `Class<T>`, `android.os.Vibrator`, `UIDevice`. */
export type SdkType =
  | { k: "prim"; name: PrimName; nullable: boolean }
  /** Java's String, or CharSequence (`charSequence`: results are read through toString()). */
  | { k: "string"; nullable: boolean; charSequence?: boolean; cf?: boolean }
  | { k: "array"; of: SdkType; nullable: boolean; cf?: boolean }
  /** NSData / CFData: Uint8Array. */
  | { k: "bytes"; nullable: boolean; cf?: boolean }
  /** NSDate: Date. */
  | { k: "date"; nullable: boolean }
  /** Objective-C `Any` (id) / CFTypeRef. */
  | { k: "id"; nullable: boolean; cf?: boolean }
  /** [String: T] / CFDictionary: Record<string, T>. */
  | { k: "record"; of: SdkType; nullable: boolean; cf?: boolean }
  /** A C out-parameter (`CFTypeRef *`). */
  | { k: "out"; of: SdkType; nullable: boolean }
  | { k: "classOf"; param: string; nullable: boolean }
  /** A block (iOS): `escaping` when it outlives the call, `main` when it runs on the main thread. */
  | { k: "fn"; params: SdkType[]; ret: SdkType; escaping: boolean; main: boolean; nullable: boolean }
  /** Swift's Error (an NSError): a Lucent Error. */
  | { k: "error"; nullable: boolean }
  | { k: "tparam"; name: string; nullable: boolean }
  | { k: "ref"; module: string; name: string; nullable: boolean };

const PRIMS = ["void", "boolean", "bool", "byte", "char", "short", "int", "long", "float", "double", "CGFloat", "NSInteger", "NSUInteger", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64"] as const;
export type PrimName = (typeof PRIMS)[number];

const JNI_PRIM: Record<string, string> = { void: "V", boolean: "Z", bool: "Z", byte: "B", char: "C", short: "S", int: "I", long: "J", float: "F", double: "D" };

/** Parses a schema type; bare names refer to `module`. */
export function parseSdkType(s: string, module = "", typeParams: readonly string[] = []): SdkType {
  const toks = s.match(/@\w+|=>|[()[\]<>?,]|[\w.$]+/g) ?? [];
  let p = 0;
  const expect = (t: string) => {
    if (toks[p++] !== t) throw new Error(`schema type ${s}: expected ${t}`);
  };
  const type = (): SdkType => {
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
  const primary = (): SdkType => {
    const attrs: string[] = [];
    while (toks[p]?.startsWith("@")) attrs.push(toks[p++]!);
    if (toks[p] === "(") {
      p++;
      const items: SdkType[] = [];
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
      throw new Error(`schema type ${s}: unknown generic ${name}`);
    }
    return named(name, module, typeParams);
  };
  const t = type();
  if (p !== toks.length) throw new Error(`schema type ${s}: unexpected ${toks[p]}`);
  return t;
}

function named(s: string, module: string, typeParams: readonly string[]): SdkType {
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
export function sdkTypeInfo(platform: Platform, module: string, name: string): { kind: "class" | "protocol" | "enum" | "struct"; native: string } | undefined {
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
export function jniDescriptor(params: string[], returns: string, typeParams: readonly string[] = []): string {
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
