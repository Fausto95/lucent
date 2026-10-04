/**
 * Symbol graphs (swift-symbolgraph-extract's output) and the Swift view of
 * types in them, read into schema types: what the Objective-C and the
 * Swift extraction share.
 */
import { threadFacts } from "./facts.ts";
import { formatSchemaType, type NativeFacts, parseSchemaType, type SchemaType } from "./schema.ts";

export interface Fragment {
  kind: string;
  spelling: string;
  preciseIdentifier?: string;
}

export interface SymbolGraphSymbol {
  kind: { identifier: string };
  identifier: { precise: string };
  pathComponents: string[];
  names: { title: string };
  declarationFragments?: Fragment[];
  /** Type parameters (an Objective-C class's lightweight generics, a Swift type's or member's), and their constraints. */
  swiftGenerics?: {
    parameters?: { name: string }[];
    constraints?: { kind: string; lhs: string; rhs: string; rhsPrecise?: string }[];
  };
  /** The extension a member is declared in, and what it requires of its type's parameters. */
  swiftExtension?: {
    constraints?: { kind: string; lhs: string; rhs: string; rhsPrecise?: string }[];
  };
  functionSignature?: {
    parameters?: { name: string; internalName?: string; declarationFragments: Fragment[] }[];
    returns?: Fragment[];
  };
  availability?: {
    domain?: string;
    introduced?: { major: number; minor?: number };
    isUnconditionallyUnavailable?: boolean;
    obsoleted?: unknown;
  }[];
}

export interface SymbolGraph {
  symbols: SymbolGraphSymbol[];
  relationships: { kind: string; source: string; target: string }[];
}

// --- Swift types to schema types ---------------------------------------------------

export class Unsupported extends Error {}

const SWIFT_PRIM: Record<string, string> = {
  "s:Sb": "bool",
  "s:Sd": "double",
  "s:Sf": "float",
  "s:Si": "NSInteger",
  "s:Su": "NSUInteger",
  "s:s4Int8V": "int8",
  "s:s5UInt8V": "uint8",
  "s:s5Int16V": "int16",
  "s:s6UInt16V": "uint16",
  "s:s5Int32V": "int32",
  "s:s6UInt32V": "uint32",
  "s:s5Int64V": "int64",
  "s:s6UInt64V": "uint64",
  "s:14CoreFoundation7CGFloatV": "CGFloat",
  "s:SS": "string",
  // BOOL where Swift keeps it as the C type: `BOOL *` is UnsafeMutablePointer<ObjCBool>.
  "s:10ObjectiveC8ObjCBoolV": "bool",
  "s:s5ErrorP": "error",
  "s:10Foundation4DataV": "NSData",
  "s:10Foundation4DateV": "NSDate",
};

/**
 * Foundation classes Swift leaves unbridged in Objective-C generic arguments
 * (`NSCache<NSString, NSData>`): the values they bridge to elsewhere. NSNumber
 * stays an object, as it does everywhere.
 */
const OBJC_BRIDGED: Record<string, string> = {
  "c:objc(cs)NSString": "string",
  "c:objc(cs)NSData": "NSData",
  "c:objc(cs)NSDate": "NSDate",
};

/** CoreFoundation types, toll-free bridged to Lucent values in the glue. */
const CF_TYPES: Record<string, string> = {
  "c:@T@CFStringRef": "CFString",
  "c:@T@CFDataRef": "CFData",
  "c:@T@CFDictionaryRef": "CFDictionary",
  "c:@T@CFArrayRef": "CFArray",
  "c:@T@CFTypeRef": "CFTypeRef",
  "c:@T@CFBooleanRef": "CFBoolean",
  "c:@T@CFNumberRef": "CFNumber",
};

/** C typedefs from modules outside the extraction (MacTypes, CoreFoundation). */
const C_TYPEDEFS: Record<string, string> = {
  "c:@T@OSStatus": "int32",
  "c:@T@OSType": "uint32",
  "c:@T@CFIndex": "int64",
  "c:@T@CFTimeInterval": "double",
  "c:@T@CFAbsoluteTime": "double",
  "c:@T@NSTimeInterval": "double",
  "c:@T@Boolean": "bool",
  "c:@T@UInt32": "uint32",
  // An OS object (dispatch_queue_t is NSObject<OS_dispatch_queue> *): any Objective-C object.
  "c:@T@dispatch_queue_t": "id",
  "c:@T@SInt32": "int32",
};

/**
 * Swift's spelling of Objective-C's error convention: an NSError** a method
 * writes (NSErrorPointer, where Swift does not import it as throws).
 */
const ERROR_POINTERS = new Set(["s:10Foundation14NSErrorPointera"]);

/**
 * Types of the Swift and Objective-C ABI with no Lucent value, by USR, and
 * why: what each is, so a skipped member says it.
 */
const NO_VALUE: Record<string, string> = {
  "s:10ObjectiveC8SelectorV": "Objective-C selectors (Selector) have no Lucent value yet",
  "s:s8AnyClassa": "class objects (AnyClass) have no Lucent value yet",
  "s:SV": "raw pointers (UnsafeRawPointer) have no Lucent value: nothing says what they point to",
  "s:Sv":
    "raw pointers (UnsafeMutableRawPointer) have no Lucent value: nothing says what they point to",
  "s:s13OpaquePointerV":
    "opaque pointers (OpaquePointer) have no Lucent value: nothing says what they point to",
  "s:SP":
    "pointers to read (UnsafePointer) have no Lucent value yet: nothing ties them to their length",
  "s:SW": "buffer pointers (UnsafeRawBufferPointer) have no Lucent value yet",
  "s:Sw": "buffer pointers (UnsafeMutableRawBufferPointer) have no Lucent value yet",
  "s:SR": "buffer pointers (UnsafeBufferPointer) have no Lucent value yet",
  "s:Sr": "buffer pointers (UnsafeMutableBufferPointer) have no Lucent value yet",
  "s:10ObjectiveC6NSZoneV": "memory zones (NSZone) have no Lucent value",
};

/** Objective-C's NSObject protocol, which every Objective-C object conforms to. */
const NSOBJECT_PROTOCOL = "c:objc(pl)NSObject";

/** Swift value types that bridge to Foundation classes, typed as those classes. */
/** Swift's AnyHashable: an Objective-C object (id), as untyped NSDictionary keys and NSSet elements are. */
const ANY_HASHABLE = "s:s11AnyHashableV";

/** The protocol of Swift value types that bridge to an Objective-C class, its `ReferenceType`. */
export const REFERENCE_CONVERTIBLE = "s:10Foundation20ReferenceConvertibleP";

export interface Resolver {
  /** A class/protocol/enum USR to its schema reference (`Module.Name`), if extracted. */
  ref(usr: string): string | undefined;
  /** Typealiases and typed string enums: USR to the fragments they stand for. */
  alias(usr: string): Fragment[] | undefined;
  /** A C typedef's USR from its name, for references Swift leaves without one (NSRange). */
  typedef(name: string): string | undefined;
  self?: string;
  /** What `Self` is where it is not `self` (a protocol's requirements: the conforming type). */
  selfType?: SchemaType;
  /** The member is main-actor: its blocks that are not @Sendable run on the main thread. */
  mainActor?: boolean;
  /** Its class's type parameters, which its types name without a USR. */
  typeParams?: readonly string[];
  /** Type parameters a constraint fixes to one Lucent type (`<D: DataProtocol>`: bytes). */
  typeArgs?: ReadonlyMap<string, SchemaType>;
  /** `Self.Digest`: the type the owner gives an associated type (its typealias). */
  associated?: (name: string) => SchemaType | undefined;
}

/**
 * Standard protocols a Lucent value conforms to, by USR, and that value's
 * type: what `some P` (or a type parameter constrained to P) takes. A rule
 * per standard protocol, not per API.
 */
export const STANDARD_PROTOCOLS: Record<string, (args: SchemaType[]) => SchemaType | undefined> = {
  // DataProtocol and ContiguousBytes: a Uint8Array, passed as Data.
  "s:10Foundation12DataProtocolP": () => parseSchemaType("NSData"),
  "s:10Foundation15ContiguousBytesP": () => parseSchemaType("NSData"),
  // StringProtocol: a string.
  "s:Sy": () => parseSchemaType("string"),
  // Collection<E> and Sequence<E>: an array of E.
  "s:Sl": ([e]) => (e ? { k: "array", of: e, nullable: false } : undefined),
  "s:ST": ([e]) => (e ? { k: "array", of: e, nullable: false } : undefined),
};

/** Tokens of a type written in declaration fragments. */
function tokens(frags: Fragment[]): (Fragment | string)[] {
  const out: (Fragment | string)[] = [];
  for (const f of frags) {
    if (f.kind === "typeIdentifier") out.push(f);
    else if (
      f.kind === "keyword" &&
      (f.spelling === "Any" || f.spelling === "AnyObject" || f.spelling === "Self")
    )
      out.push(f.spelling);
    else if (f.spelling.trim() === "()") out.push("()");
    else {
      for (const t of f.spelling.split(/(\?|!|\[|\]|:|<|>|,|\(|\)|->|@\w+|any |some |inout |\.)/)) {
        const s = t.trim();
        if (s) out.push(s);
      }
    }
  }
  return out;
}

export function parseType(frags: Fragment[], r: Resolver): SchemaType {
  // `UIControl.State`: a reference to the nested type is its last identifier.
  const toks = tokens(frags)
    .filter(
      (t, i, all) =>
        !(typeof t !== "string" && all[i + 1] === "." && typeof all[i + 2] !== "string"),
    )
    .filter((t) => t !== ".");
  let p = 0;
  const named = (name: string) => parseSchemaType(name);
  const type = (): SchemaType => {
    let t = composition();
    // `X.Type` (the nested-type rule dropped the dot): the type's metatype.
    if (toks[p] === "Type" || toks[p] === "Protocol") {
      const of = frags.find((f) => f.kind === "typeIdentifier")?.spelling ?? "a type";
      throw new Unsupported(`metatypes (${of}.${toks[p]}) have no Lucent value yet`);
    }
    while (toks[p] === "?" || toks[p] === "!") {
      p++;
      // An optional block is stored, so it escapes.
      t = t.k === "fn" ? { ...t, nullable: true, escaping: true } : { ...t, nullable: true };
    }
    return t;
  };
  /**
   * A block: `escaping` when it outlives the call, `main` when it runs on
   * the main thread (Swift's isolation: an explicit @MainActor, or not
   * @Sendable in a main-actor member).
   */
  const closure = (params: SchemaType[], attrs: string[]): SchemaType => {
    const ret = type();
    const main = attrs.includes("@MainActor") || (!attrs.includes("@Sendable") && !!r.mainActor);
    return { k: "fn", params, ret, escaping: attrs.includes("@escaping"), main, nullable: false };
  };
  /**
   * `A & B`: a value of both. NSObjectProtocol adds nothing (every
   * Objective-C object conforms), so it composed with one type is that
   * type; other compositions have no Lucent type.
   */
  const composition = (): SchemaType => {
    const parts: SchemaType[] = [];
    const names: string[] = [];

    for (;;) {
      let q = p;
      while (toks[q] === "any" || toks[q] === "some") q++;
      const tok = toks[q];
      names.push(typeof tok === "string" ? tok : (tok?.spelling ?? ""));

      const conformance =
        typeof tok !== "string" &&
        tok?.preciseIdentifier === NSOBJECT_PROTOCOL &&
        (toks[q + 1] === "&" || toks[p - 1] === "&");
      if (conformance) p = q + 1;
      else parts.push(primary());

      if (toks[p] !== "&") break;
      p++;
    }

    if (parts.length === 1) return parts[0]!;
    throw new Unsupported(
      `values of several types at once (${names.join(" & ")}) have no Lucent type yet`,
    );
  };
  const primary = (): SchemaType => {
    const attrs: string[] = [];
    while (typeof toks[p] === "string" && (toks[p] as string).startsWith("@"))
      attrs.push(toks[p++] as string);
    const tok = toks[p++];
    if (tok === undefined) throw new Unsupported("empty type");
    if (tok === "any" || tok === "some") {
      const proto = toks[p];
      const standard =
        typeof proto !== "string" && proto?.preciseIdentifier
          ? STANDARD_PROTOCOLS[proto.preciseIdentifier]
          : undefined;
      if (!standard) return primary();
      p++;
      const args: SchemaType[] = [];
      if (toks[p] === "<") {
        p++;
        while (toks[p] !== ">") {
          args.push(type());
          if (toks[p] === ",") p++;
          else if (toks[p] !== ">") throw new Unsupported(`type syntax ${tok}`);
        }
        p++;
      }
      const t = standard(args);
      if (!t)
        throw new Unsupported(`${tok} ${proto && typeof proto !== "string" ? proto.spelling : ""}`);
      return t;
    }
    if (tok === "inout") throw new Unsupported("inout");
    if (tok === "()" && toks[p] === "->") {
      p++;
      return closure([], attrs);
    }
    if (tok === "(") {
      const items: SchemaType[] = [];
      const labels: string[] = [];
      while (toks[p] !== ")") {
        // A tuple element's label (`min: Int`).
        const label = toks[p];
        if (typeof label === "string" && /^\w+$/.test(label) && toks[p + 1] === ":") {
          labels.push(label);
          p += 2;
        }
        items.push(type());
        if (toks[p] === ",") p++;
        else break;
      }
      if (toks[p++] !== ")") throw new Unsupported("closures and tuples");
      if (toks[p] === "->") {
        if (labels.length) throw new Unsupported("closures with labeled parameters");
        p++;
        return closure(items, attrs);
      }
      if (items.length === 1 && !attrs.length && !labels.length) return items[0]!;
      if (attrs.length) throw new Unsupported(`type syntax ${attrs.join(" ")}`);
      // A tuple: a TypeScript tuple, its labels the elements' names.
      return {
        k: "tuple",
        of: items,
        ...(labels.length === items.length ? { labels } : {}),
        nullable: false,
      };
    }
    if (tok === "->") throw new Unsupported("closures and tuples");
    if (attrs.length) throw new Unsupported(`type syntax ${attrs.join(" ")}`);
    if (tok === "[") {
      const key = type();
      if (toks[p] === ":") {
        p++;
        const value = type();
        if (toks[p++] !== "]") throw new Unsupported("dictionary");
        // Keys of any type (AnyHashable) as well: those that are not strings are left out when read.
        if ((key.k !== "string" && key.k !== "id") || key.nullable)
          throw new Unsupported(`dictionary keyed by ${formatSchemaType(key)}`);
        return { k: "record", of: value, nullable: false };
      }
      if (toks[p++] !== "]") throw new Unsupported("array");
      return { k: "array", of: key, nullable: false };
    }
    if (tok === "Any" || tok === "AnyObject") return named("id");
    if (typeof tok !== "string" && tok.preciseIdentifier === ANY_HASHABLE) return named("id");
    if (tok === "()") return named("void");
    if (tok === "Self") {
      if (r.selfType) return r.selfType;
      if (!r.self) throw new Unsupported("Self");
      return named(r.self);
    }
    if (typeof tok === "string") throw new Unsupported(`type syntax ${tok}`);
    const usr = tok.preciseIdentifier ?? "";
    if (ERROR_POINTERS.has(usr)) return { k: "out", of: named("error"), nullable: true };
    // `AutoreleasingUnsafeMutablePointer<NSError?>`, spelled out.
    const next = toks[p + 1];
    if (
      (usr === "s:SA" || usr === "s:Sp") &&
      toks[p] === "<" &&
      typeof next !== "string" &&
      next?.preciseIdentifier === "c:objc(cs)NSError" &&
      toks[p + 2] === "?" &&
      toks[p + 3] === ">"
    ) {
      p += 4;
      return { k: "out", of: named("error"), nullable: false };
    }
    // `UnsafeMutablePointer<CFTypeRef?>`, `UnsafeMutablePointer<CGFloat>`: an
    // out-parameter for a reference, or an inout one for a number, an enum or
    // a struct (`NSRange *`).
    if (usr === "s:Sp" && toks[p] === "<") {
      p++;
      const inner = type();
      if (toks[p++] !== ">") throw new Unsupported("pointer");
      const reference = inner.k === "id" || inner.k === "ref" || ("cf" in inner && !!inner.cf);
      const value = (inner.k === "prim" && inner.name !== "void") || inner.k === "ref";
      if (inner.nullable ? !reference : !value)
        throw new Unsupported(`pointer to ${formatSchemaType(inner)}`);
      return { k: "out", of: { ...inner, nullable: false }, nullable: false };
    }
    // `AutoreleasingUnsafeMutablePointer<NSString?>`: an out-parameter for an object.
    if (usr === "s:SA" && toks[p] === "<") {
      p++;
      const inner = type();
      if (toks[p++] !== ">") throw new Unsupported("pointer");
      const object = ["id", "ref", "string", "bytes", "date", "error"].includes(inner.k);
      if (!inner.nullable || !object)
        throw new Unsupported(`pointer to ${formatSchemaType(inner)}`);
      return { k: "out", of: { ...inner, nullable: false }, nullable: false };
    }
    // Unmanaged<X>: ownership follows CoreFoundation's Create/Copy rule in the glue.
    if (usr === "s:s9UnmanagedV" && toks[p] === "<") {
      p++;
      const inner = type();
      if (toks[p++] !== ">") throw new Unsupported("Unmanaged");
      return inner;
    }
    // Swift's Set (NSSet): a Lucent set.
    if (usr === "s:Sh" && toks[p] === "<") {
      p++;
      const of = type();
      if (toks[p++] !== ">") throw new Unsupported("generic Set");
      return { k: "set", of, nullable: false };
    }
    // `Self.Digest` (the nested-type rule kept its last part): an associated type, as the owner fixes it.
    if (usr.endsWith("Qa")) {
      const t = r.associated?.(tok.spelling);
      if (!t) throw new Unsupported(`Self.${tok.spelling}`);
      return t;
    }
    const fixed = usr ? undefined : r.typeArgs?.get(tok.spelling);
    if (fixed) return fixed;
    if (!usr && r.typeParams?.includes(tok.spelling))
      return { k: "tparam", name: tok.spelling, nullable: false };
    // A generic class with its type arguments: `NSCache<NSString, NSData>`.
    if (toks[p] === "<") {
      const ref = r.ref(usr);
      if (!ref) throw new Unsupported(NO_VALUE[usr] ?? `generic ${tok.spelling}`);
      p++;
      const args: SchemaType[] = [];
      while (toks[p] !== ">") {
        args.push(type());
        if (toks[p] === ",") p++;
        else if (toks[p] !== ">") throw new Unsupported(`generic ${tok.spelling}`);
      }
      p++;
      // `VerificationResult<T>.VerificationError`: the nested type (its own, not generic).
      if (toks[p] !== undefined && typeof toks[p] !== "string") return primary();
      const t = named(ref);
      return t.k === "ref" ? { ...t, args } : t;
    }
    if (usr in CF_TYPES) return named(CF_TYPES[usr]!);
    if (usr in C_TYPEDEFS) return named(C_TYPEDEFS[usr]!);
    if (usr === "s:s4Voida") return named("void");
    if (tok.spelling === "Self" && !usr) {
      if (r.selfType) return r.selfType;
      if (!r.self) throw new Unsupported("Self");
      return named(r.self);
    }
    if (usr in SWIFT_PRIM) return named(SWIFT_PRIM[usr]!);
    if (usr in OBJC_BRIDGED) return named(OBJC_BRIDGED[usr]!);
    const key = usr || (r.typedef(tok.spelling) ?? "");
    const aliased = r.alias(key);
    if (aliased) return parseType(aliased, r);
    const ref = r.ref(key);
    if (ref) return named(ref);
    throw new Unsupported(NO_VALUE[usr] ?? tok.spelling);
  };
  const t = type();
  if (p < toks.length) throw new Unsupported(`type ${frags.map((f) => f.spelling).join("")}`);
  return t;
}

/** The type part of `name: Type` fragments (the colon can share a fragment with `[`). */
export function afterColon(frags: Fragment[]): Fragment[] {
  const i = frags.findIndex((f) => f.kind === "text" && f.spelling.includes(":"));
  if (i < 0) return frags;
  const rest = frags[i]!.spelling.slice(frags[i]!.spelling.indexOf(":") + 1);
  return [...(rest.trim() ? [{ kind: "text", spelling: rest }] : []), ...frags.slice(i + 1)];
}

/** A property's type: between the colon and `{ get }`. */
export function propertyType(frags: Fragment[]): Fragment[] {
  const t = afterColon(frags);
  const end = t.findIndex((f) => f.spelling.includes("{"));
  if (end < 0) return t;
  const head = t[end]!.spelling.split("{")[0]!;
  return [...t.slice(0, end), ...(head.trim() ? [{ kind: "text", spelling: head }] : [])];
}

export const objcClass = (usr: string) => /^c:objc\((cs|pl)\)([^(]+)$/.exec(usr);
export const objcMember = (usr: string) =>
  /^c:objc\((cs|pl)\)([^(]+)\((im|cm|py|cpy)\)(.+)$/.exec(usr);
export const declText = (s: SymbolGraphSymbol) =>
  (s.declarationFragments ?? []).map((f) => f.spelling).join("");

/** What Swift's `@MainActor` among a declaration's attributes proves: main-thread affinity. */
export function mainActorFacts(attributes: string): NativeFacts | undefined {
  if (!attributes.includes("@MainActor")) return undefined;

  return threadFacts({ affinity: "main", source: "attribute", detail: "@MainActor" });
}

export function since(s: SymbolGraphSymbol): string | undefined {
  const ios = s.availability?.find((a) => a.domain === "iOS");
  if (!ios?.introduced) return undefined;
  return `${ios.introduced.major}.${ios.introduced.minor ?? 0}`;
}

export function unavailable(s: SymbolGraphSymbol): boolean {
  return !!s.availability?.some(
    (a) =>
      (a.domain === "iOS" || a.domain === "*" || a.domain === undefined) &&
      (a.isUnconditionallyUnavailable || a.obsoleted),
  );
}

/** `impact(intensity:)` → base `impact`, labels `["intensity"]`. */
export function splitName(title: string): { base: string; labels: string[] } {
  const m = /^([^(]+)\((.*)\)$/.exec(title);
  if (!m) return { base: title, labels: [] };
  return { base: m[1]!, labels: m[2]!.split(":").filter((l) => l !== "") };
}

/** Which parameters are `@escaping`: the declaration says so, the parameters' own fragments do not. */
export function escapingParams(s: SymbolGraphSymbol): boolean[] {
  const out: boolean[] = [];
  for (const f of s.declarationFragments ?? []) {
    if (f.kind === "externalParam") out.push(false);
    else if (out.length && f.spelling.includes("@escaping")) out[out.length - 1] = true;
  }
  return out;
}

export function withEscaping(type: SchemaType, escaping: boolean | undefined): SchemaType {
  return escaping && type.k === "fn" && !type.nullable ? { ...type, escaping: true } : type;
}

/** The getter selector of a property whose Swift name differs from its Objective-C name (`isEnabled`). */

/** Swift types that cross as a Lucent value or bridged class, whatever module declares them (Data, Date). */
export const bridgedSwiftType = (usr: string) => usr in SWIFT_PRIM || usr in OBJC_BRIDGED;
