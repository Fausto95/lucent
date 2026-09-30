/**
 * The binding schema format: what a platform SDK module contains, as data.
 * Extractors (android.ts, ios.ts) produce it; the compiler types
 * `lucent:ios/<module>` and `lucent:android/<package>` imports from it and
 * lowers calls to glue.
 */

export type Platform = "ios" | "android";
export const PLATFORMS: readonly Platform[] = ["ios", "android"];

/**
 * The version of this format. Extractors write it into every schema; a
 * cached schema of another version is extracted again, and one from
 * anywhere else goes through loadSchema, which refuses it. A change to
 * these types that older schemas would be read wrongly under bumps it.
 */
export const SCHEMA_FORMAT = 1;

/**
 * A declaration's native identity, whatever Lucent names it: `swift:<USR>`,
 * `objc:<USR>` or `c:<USR>` from a symbol graph (Swift USRs start `s:`,
 * clang ones `c:`), `jvm:<internal/Name>` for a JVM class and
 * `jvm:<internal/Name>#<name><descriptor>` (`<init>` for constructors,
 * `<name>:<descriptor>` for fields) for its members. Two artifacts can
 * declare the same symbol: a declaration is its artifact and its symbol.
 */
export type SymbolId = string;

/** Where a schema's declarations come from. No machine paths: it is an identity. */
export interface SchemaProvenance {
  /**
   * The artifact's build-system identity, not a display name:
   * `sdk:iphonesimulator27.0`, `pod:OrbitKit@1.2.0`,
   * `maven:dev.orbit:tracking:1.0.0`, `android-sdk:35`, `clang-module:M`.
   */
  artifact: string;
  kind: "sdk" | "framework" | "clang-module" | "swift-module" | "jar" | "aar" | "sources";
  /** A hash of the artifact's declaration inputs' contents, when known. */
  contentHash?: string;
  /** What the declarations were read for: `arm64-apple-ios15.1-simulator`, `android-35`. */
  target: string;
  /** The extractor's identity (its code's hash), as cache keys use it. */
  extractor: string;
}

/** A fact, or `unknown`: what metadata does not prove stays unknown. */
export type Known<T extends string> = T | "unknown";

/**
 * What native metadata proves about a declaration, each fact on its own:
 * a thread annotation says where code runs, not whether it blocks or who
 * owns what it returns. Absent facts are all unknown, never "safe".
 */
export interface NativeFacts {
  affinity: Known<"main" | "worker" | "any">;
  blocking: Known<"yes" | "no">;
  /** Only meaningful on function-typed parameters and properties. */
  callbackTiming?: Known<"during-call" | "escaping">;
  ownership: Known<"borrowed" | "retained" | "transferred">;
  evidence: FactEvidence[];
}

export interface FactEvidence {
  fact: "affinity" | "blocking" | "callbackTiming" | "ownership";
  /** Where the fact came from; a `convention` names a general rule, never a library. */
  source: "annotation" | "attribute" | "metadata" | "abi" | "convention";
  /** The annotation or attribute (`@WorkerThread`, `@MainActor`), or the rule's name. */
  detail: string;
}

export interface SdkModuleSchema {
  /** SCHEMA_FORMAT, as the extractor that wrote the schema knew it. */
  format: number;
  platform: Platform;
  provenance?: SchemaProvenance;
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
  /**
   * `source`: the module is written out as source in a body, not called
   * through glue: Swift (SwiftUI's views, modifiers and values), whose
   * initializers are called by the type's name and whose parameters say
   * how a call writes them (`SdkParam.swift`); or Kotlin (Compose's
   * content), declared as Kotlin declares it, a function's parameters as
   * its source ones (`SdkParam.kotlin`).
   */
  form?: "source";
}

/** A Swift-only type (a struct, class, enum or protocol), called through generated shims. */
export interface SwiftType {
  kind: "struct" | "class" | "enum" | "protocol";
  /**
   * A protocol with associated types or `Self` requirements: its values
   * cross only as arguments (Swift opens them), its members are not called
   * on them. Its associated types are its type parameters (a Lucent class
   * implementing it fixes them), `Self` in a requirement the implementing
   * class.
   */
  associatedTypes?: boolean;
  /** The associated types `P<A>` names (Swift's primary associated types), first among the type parameters. */
  primaryAssociatedTypes?: string[];
  /** An enum's cases, with their payloads (an enum without payloads is an SdkEnumSchema). */
  cases?: { name: string; params: { label?: string; type: SchemaType }[] }[];
  /** A property wrapper (`@propertyWrapper`: Binding, State): a value that is someone else's state. */
  propertyWrapper?: true;
}

/** A Swift-only member, called through a generated shim. */
export interface SwiftMember {
  /** How Swift names it (`distance(to:)`, `init(x:y:)`, `x`): the call is written from it. */
  name: string;
  async?: boolean;
  throws?: boolean;
  mutating?: boolean;
  /** `bytes` of a ContiguousBytes type: its bytes, copied out. */
  bytes?: boolean;
  /**
   * A static member of a generic type, on the type arguments its extension
   * fixes (`extension AVPartialAsyncProperty where Root: AVAsset`).
   */
  ownerArgs?: SchemaType[];
}

/**
 * What Kotlin metadata says of a class (Android) that its class file does
 * not: how Kotlin declares it.
 */
export interface KotlinClassFacts {
  /** A class, or the facade holding a file's top-level declarations as statics. */
  kind:
    | "class"
    | "interface"
    | "enum"
    | "annotation"
    | "object"
    | "companion"
    | "file-facade"
    | "multi-file-facade";
  data?: true;
  /** A `fun interface`: a lambda implements its one abstract function. */
  fun?: true;
  /** A sealed class or interface: its direct subclasses Lucent declares, as type references. */
  sealed?: string[];
  /** A value class: the property holding its underlying value, and that value's type. */
  value?: { property: string; type: SchemaType };
  bounds?: TypeParamBounds;
  /**
   * The receiver of a lambda parameter of the API (`BoxScope`): its members
   * are called in such a lambda, which gives them their receiver.
   */
  scope?: true;
  /** Its name is a value of its own type: its companion object is one (`Modifier`). */
  companionValue?: true;
}

/**
 * The type parameters Kotlin bounds, by name: `non-null` (`T : Any`) or
 * `other` (`T : Comparable<T>`). Unlisted ones take any value (`Any?`).
 */
export type TypeParamBounds = Record<string, "non-null" | "other">;

/**
 * What Kotlin metadata says of a member (Android) that its JVM method does
 * not. The member keeps the exact JVM method (`descriptor`, `symbol`); a
 * Kotlin shim calls what JNI cannot.
 */
export interface KotlinMemberFacts {
  /**
   * A suspend function: `params` leave out the Continuation `descriptor`
   * ends with, and `returns` is what it completes with.
   */
  suspend?: true;
  /** An extension function or property accessor: `params[0]` is its receiver. */
  extension?: true;
  /** Takes or gives a value class, typed so, that the JVM passes as its underlying value. */
  unboxed?: true;
  /** Its own type parameters' bounds. */
  bounds?: TypeParamBounds;
  /** An extension property, read from its receiver (`params[0]`): `20.dp`. */
  property?: true;
  /** Compose's `@Composable`: it runs while a composition composes, and only then. */
  composable?: true;
  /**
   * What a composable emits its nodes into (`@ComposableTarget`'s applier,
   * or the one `@ComposableInferredTarget` gives it):
   * `androidx.compose.ui.UiComposable` for UI; `*` for its caller's (an
   * applier variable: it composes what its content lambdas do); none for
   * composables that emit nothing (effects, `remember`).
   */
  applier?: string;
  inline?: true;
  /** Its reified type parameters: Kotlin's caller must know their types. */
  reified?: string[];
  /** The opt-in markers (Kotlin class names) of an experimental API: its callers opt in. */
  optIn?: string[];
  /** `@RestrictTo`: for its own library group only. */
  restricted?: true;
  /** Left empty, its vararg would call another overload (Kotlin refuses LaunchedEffect's keyless one). */
  varargShadowed?: true;
  /**
   * Defaulted parameters `params` leave out, of types content cannot
   * write: Kotlin gives their defaults (a call names its arguments, and
   * gives none as a trailing lambda then).
   */
  omits?: string[];
  /**
   * The receiver scope it runs in (`androidx.compose.foundation.layout.ColumnScope`):
   * an extension of a lambda's receiver, which only that lambda gives it.
   */
  scope?: string;
}

/** What Kotlin metadata says of a parameter (Android). */
export interface KotlinParamFacts {
  /** Declares a default: a Kotlin shim may leave it out; JNI passes every argument. */
  default?: true;
  /** A suspend function, typed as the function Kotlin declares rather than its lowered JVM form. */
  suspendFunction?: true;
  /**
   * A function-typed parameter (a Kotlin source call's lambda): a
   * `@Composable` one is `content`, which composes; any other a `callback`.
   * Absent for values.
   */
  role?: "content" | "callback";
  /** A lambda with a receiver (`RowScope.() -> Unit`): the receiver's type, which `type` leaves out. */
  receiver?: SchemaType;
  /** `vararg`: `type` is an element's. */
  vararg?: true;
  /**
   * A lambda with a receiver whose result only the receiver makes: the
   * receiver's member that makes it from a function (`onDispose`), which
   * the lambda ends by calling with the function a Lucent lambda returns.
   */
  returnsThrough?: string;
  /**
   * A value whose changes the callback parameter of this name reports
   * (`value` and `onValueChange`): a bound signal gives both.
   */
  changedBy?: string;
}

export interface SdkEnumSchema {
  kind: "enum";
  /** Name in Lucent: Swift name, nested types joined with `_`. */
  name: string;
  symbol?: SymbolId;
  /** The C enum type (iOS), or the annotation type holding the constants (Android). */
  native: string;
  cases: { name: string; native: string; value: number | string }[];
  /** A Swift enum: `native` is its Swift name, and a case crosses as its index. */
  swift?: { kind: "enum" };
  /** An option set (NS_OPTIONS): its cases combine, and 0 is the empty set. */
  options?: true;
}

/** A C struct passed by value (iOS): numbers, booleans and structs, in field order. */
export interface SdkStructSchema {
  kind: "struct";
  name: string;
  symbol?: SymbolId;
  /** The C type name. */
  native: string;
  fields: SdkParam[];
}

export interface SdkParam {
  name: string;
  type: SchemaType;
  /**
   * The constants it takes (Android @IntDef, @StringDef), as
   * `package.Class.FIELD`: one of them, not any value of its type.
   */
  oneOf?: string[];
  /**
   * A Swift default argument: "optional" when the call may leave it out (the
   * shim does); "omitted" when Lucent never gives it (no Lucent value for
   * its type: `isolation: isolated (any Actor)? = #isolation`), so its type
   * is not used.
   */
  defaulted?: "optional" | "omitted";
  kotlin?: KotlinParamFacts;
  /** How a call written as Swift source gives it (a `source` module's members). */
  swift?: SwiftParamFacts;
}

/**
 * How Swift source passes an argument: its label, and what it is. Its
 * place is the parameter's. A call written in Lucent's call form gives the
 * unlabeled ones in order, the labeled ones as one object, and a closure
 * last as the trailing one (callForms in call-form.ts).
 */
export interface SwiftParamFacts {
  /** Swift's argument label; none for an unlabeled (`_`) parameter. */
  label?: string;
  /**
   * `value`: an expression. `action`: a closure the native code calls
   * back. `builder`: a result builder's closure (`@ViewBuilder`), whose
   * statements are the values it builds.
   */
  kind: "value" | "action" | "builder";
}

export interface SdkCallable {
  params: SdkParam[];
  /** The native declaration it calls (inherited members: the one that declares them). */
  symbol?: SymbolId;
  /** What its own metadata proves; without, its class's facts hold. */
  facts?: NativeFacts;
  /** Objective-C selector (iOS). */
  selector?: string;
  /** API level (Android) or OS version (iOS) that introduced it. */
  since?: number | string;
  /** Exact JNI descriptor (Android), when the types alone do not give it (generic erasure). */
  descriptor?: string;
  deprecated?: boolean;
  /** A protected Java constructor: only a subclass calls it. */
  protected?: boolean;
  /** Swift-only: called through a shim. */
  swift?: SwiftMember;
  kotlin?: KotlinMemberFacts;
}

export interface SdkMethodSchema extends SdkCallable {
  name: string;
  returns: SchemaType;
  static?: boolean;
  typeParams?: string[];
  /** Main-only (`@MainActor`, `@MainThread`), or (false) not though its class is (`@AnyThread`). */
  mainActor?: boolean;
  /** Blocking work (Android `@WorkerThread`): calling it on the main thread warns. */
  worker?: boolean;
  /**
   * The JVM method name, when it is not `name`: renamed to tell overloads
   * apart, or (Kotlin) `@JvmName` and value-class mangling (`load-X6dG1pw`).
   */
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
  /** The constants it returns (Android @IntDef, @StringDef), as SdkParam's oneOf. */
  returnsOneOf?: string[];
}

export interface SdkPropertySchema {
  name: string;
  type: SchemaType;
  /** The native declaration: the field, the property, the C global, or (Android) the getter. */
  symbol?: SymbolId;
  /** What its own metadata proves; without, its class's facts hold. */
  facts?: NativeFacts;
  static?: boolean;
  readonly?: boolean;
  /** Objective-C getter selector, when it differs from `name` (iOS). */
  selector?: string;
  /** Objective-C setter selector (iOS), or setter method (Android, Kotlin), for writable properties. */
  setter?: string;
  /** A weak reference (iOS): setting it does not keep the value alive. */
  weak?: boolean;
  /** Getter method, for Kotlin-style properties (Android); fields otherwise. */
  getter?: string;
  /** A C global holding the value (iOS typed string keys: `NSFileCreationDate`). */
  global?: string;
  /**
   * A compile-time constant (`static final` primitives and strings); a
   * long's (a 64-bit integer's) as its decimal digits, exactly.
   */
  value?: number | string | boolean;
  /** The constants it holds (Android @IntDef, @StringDef on its getter), as SdkParam's oneOf. */
  oneOf?: string[];
  /** As its getter's (Android): main-only, or (false) not though its class is. */
  mainActor?: boolean;
  /** As its getter's (Android): see SdkMethodSchema.worker. */
  worker?: boolean;
  /** Swift-only: read (and written) through shims. */
  swift?: SwiftMember;
  kotlin?: KotlinMemberFacts;
  since?: number | string;
  deprecated?: boolean;
}

export interface SdkClassSchema {
  kind: "class";
  name: string;
  symbol?: SymbolId;
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
  /** Generic type parameters (Java): members' `tparam` types name them. */
  typeParams?: string[];
  /** A Java interface with one abstract method, named here: functions implement it. */
  functional?: string;
  /** Isolated to the main thread (`@MainActor`, `@UiThread`). */
  mainActor?: boolean;
  /** What its metadata proves, for the members without facts of their own. */
  facts?: NativeFacts;
  /** An opaque CoreFoundation-style handle (`CGImageRef`): `native` is its C type. */
  cf?: boolean;
  /** A Swift-only type: `native` is its Swift name (`CryptoKit.AES.GCM.SealedBox`). */
  swift?: SwiftType;
  /** Declared in Kotlin, as its metadata says. */
  kotlin?: KotlinClassFacts;
  since?: number | string;
  constructors?: SdkCallable[];
  methods?: SdkMethodSchema[];
  properties?: SdkPropertySchema[];
}

/** Whether `value` is a schema in the format this Lucent reads. */
export function hasSchemaFormat(value: unknown): value is SdkModuleSchema {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { format?: unknown }).format === SCHEMA_FORMAT
  );
}

/** A schema from outside the cache (a file, a test), refused unless it is in this format. */
export function loadSchema(value: unknown): SdkModuleSchema {
  if (hasSchemaFormat(value)) return value;

  const { module, format } = (value ?? {}) as { module?: unknown; format?: unknown };
  const name = typeof module === "string" ? module : "<unknown module>";
  throw new Error(
    `${name}: unsupported binding schema format ${String(format ?? "none")}; this Lucent reads format ${SCHEMA_FORMAT}`,
  );
}

/**
 * A schema in canonical order: types, members, functions and constants by
 * name, then by native symbol. Extraction order varies between runs (symbol
 * graphs); declarations and overload indexes must not. Order that carries
 * meaning stays: enum cases, struct fields, parameters.
 */
export function canonicalSchema(schema: SdkModuleSchema): SdkModuleSchema {
  const key = (x: { name: string; symbol?: string; selector?: string; descriptor?: string }) =>
    `${x.name}\u0000${x.symbol ?? x.selector ?? x.descriptor ?? ""}`;
  const byKey = <T extends { name: string }>(xs: T[] | undefined) =>
    xs && [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const ctorKey = (c: SdkCallable) => c.symbol ?? c.selector ?? c.descriptor ?? "";

  const types = [...schema.types]
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    .map((t) => {
      if (t.kind !== "class") return t;

      return {
        ...t,
        ...(t.methods ? { methods: byKey(t.methods) } : {}),
        ...(t.properties ? { properties: byKey(t.properties) } : {}),
        ...(t.constructors
          ? {
              constructors: [...t.constructors].sort((a, b) =>
                ctorKey(a) < ctorKey(b) ? -1 : ctorKey(a) > ctorKey(b) ? 1 : 0,
              ),
            }
          : {}),
      };
    });

  return {
    ...schema,
    types,
    ...(schema.functions ? { functions: byKey(schema.functions) } : {}),
    ...(schema.constants ? { constants: byKey(schema.constants) } : {}),
  };
}

// --- types ---------------------------------------------------------------------------

/** A parsed schema type: `int`, `string?`, `long[]`, `Class<T>`, `android.os.Vibrator`, `UIDevice`. */
export type SchemaType =
  /**
   * `group`: an integer of a constant group (Android @IntDef, @LongDef):
   * a number, as the group's constants are, even at 64 bits.
   */
  | { k: "prim"; name: PrimName; nullable: boolean; group?: true }
  /** Java's String, or CharSequence (`charSequence`: results are read through toString()). */
  | { k: "string"; nullable: boolean; charSequence?: boolean; cf?: boolean }
  /**
   * A copied collection: a Java array, NSArray, CFArray (`cf`), or Kotlin's
   * read-only `List<E>` (`list`: a java.util.List, written `List<E>`).
   */
  | { k: "array"; of: SchemaType; nullable: boolean; cf?: boolean; list?: true }
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
  | {
      k: "fn";
      params: SchemaType[];
      ret: SchemaType;
      escaping: boolean;
      main: boolean;
      nullable: boolean;
    }
  /** Swift's Error (an NSError): a Lucent Error. */
  | { k: "error"; nullable: boolean }
  /**
   * A type parameter. `bound`: the Lucent values it takes, for one a body
   * written as Swift source gives (`V: Equatable`, any of Lucent's
   * scalars: a reference to the protocol in module `Swift`).
   */
  | { k: "tparam"; name: string; nullable: boolean; bound?: SchemaType }
  /** A class or protocol; `args` are a generic class's type arguments (none: raw). */
  | { k: "ref"; module: string; name: string; nullable: boolean; args?: SchemaType[] };

export const PRIMS = [
  "void",
  "boolean",
  "bool",
  "byte",
  "char",
  "short",
  "int",
  "long",
  "float",
  "double",
  "CGFloat",
  "NSInteger",
  "NSUInteger",
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
] as const;
export type PrimName = (typeof PRIMS)[number];

/** Parses a schema type; bare names refer to `module`. */
export function parseSchemaType(
  s: string,
  module = "",
  typeParams: readonly string[] = [],
): SchemaType {
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
        return {
          k: "fn",
          params: items,
          ret: type(),
          escaping: attrs.includes("@escaping"),
          main: attrs.includes("@main"),
          nullable: false,
        };
      }
      if (items.length !== 1 || attrs.length) throw new Error(`schema type ${s}: expected =>`);
      return items[0]!;
    }
    const name = toks[p++];
    if (!name || !/^[\w.$]+$/.test(name))
      throw new Error(`schema type ${s}: unexpected ${name ?? "end"}`);
    if (toks[p] === "<") {
      p++;
      if (name === "Class") {
        const param = toks[p++]!;
        expect(">");
        return { k: "classOf", param, nullable: false };
      }
      const args = [type()];
      while (toks[p] === ",") {
        p++;
        args.push(type());
      }
      expect(">");
      const of = args[0]!;
      if (name === "Record") return { k: "record", of, nullable: false };
      if (name === "Out") return { k: "out", of, nullable: false };
      if (name === "Set") return { k: "set", of, nullable: false };
      if (name === "List") return { k: "array", of, nullable: false, list: true };
      const t = named(name, module, typeParams);
      if (t.k !== "ref") throw new Error(`schema type ${s}: ${name} takes no type arguments`);
      return { ...t, args };
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
  if ((PRIMS as readonly string[]).includes(s))
    return { k: "prim", name: s as PrimName, nullable: false };
  if (typeParams.includes(s)) return { k: "tparam", name: s, nullable: false };
  const dot = s.lastIndexOf(".");
  return dot < 0
    ? { k: "ref", module, name: s, nullable: false }
    : { k: "ref", module: s.slice(0, dot), name: s.slice(dot + 1), nullable: false };
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
      if (t.list) return `List<${formatSchemaType(t.of)}>${q}`;
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
    case "ref": {
      const args = t.args?.length ? `<${t.args.map(formatSchemaType).join(", ")}>` : "";
      return `${t.module ? `${t.module}.` : ""}${t.name}${args}${q}`;
    }
    case "fn": {
      const flags = `${t.escaping && !t.nullable ? "@escaping " : ""}${t.main ? "@main " : ""}`;
      const fn = `${flags}(${t.params.map(formatSchemaType).join(", ")}) => ${formatSchemaType(t.ret)}`;
      return t.nullable ? `(${fn})?` : fn;
    }
  }
}

/**
 * Marks a module's integers of constant groups (see the prim type's
 * `group`): the parameters, results and properties a group types, and the
 * constants a group of the module names. A group stays what it was before
 * 64-bit integers became bigints: numbers, the long constants of an
 * @LongDef included (their values within 2^53; a constant beyond stays a
 * bigint). A group of another module naming a constant does not mark it.
 */
export function markGroupIntegers(module: SdkModuleSchema): void {
  const named = new Set<string>();
  const grouped = (t: SchemaType, oneOf: string[] | undefined): SchemaType => {
    if (!oneOf) return t;

    for (const ref of oneOf) named.add(ref);
    if (t.k === "array") return { ...t, of: grouped(t.of, oneOf) };

    return t.k === "prim" ? { ...t, group: true } : t;
  };

  const classes = module.types.filter((t): t is SdkClassSchema => t.kind === "class");
  for (const cls of classes) {
    for (const c of [...(cls.constructors ?? []), ...(cls.methods ?? [])])
      c.params = c.params.map((p) => ({ ...p, type: grouped(p.type, p.oneOf) }));
    for (const m of cls.methods ?? []) m.returns = grouped(m.returns, m.returnsOneOf);
    for (const p of cls.properties ?? []) p.type = grouped(p.type, p.oneOf);
  }

  for (const cls of classes)
    for (const p of cls.properties ?? []) {
      const value = typeof p.value === "string" ? Number(p.value) : undefined;
      const exact = value !== undefined && Number.isSafeInteger(value);
      if (p.type.k !== "prim" || !exact || !named.has(`${module.module}.${cls.name}.${p.name}`))
        continue;

      p.type = { ...p.type, group: true };
      p.value = value;
    }
}
