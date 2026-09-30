/**
 * A Swift module written out as source (`form: "source"`): SwiftUI, whose
 * views a component's body is written in. Nothing crosses through glue:
 * the body is Swift, and Swift resolves its overloads itself. What the
 * schema says is what Lucent's call form needs to write a call (see
 * call-form.ts): each member's parameters with their labels, and whether
 * each is a value, an action or a result builder's content.
 *
 * By rules on the declarations, not a list:
 *
 * - a struct, an enum or a protocol is a type of values (classes are
 *   objects, not values a body writes); its initializers are called by
 *   its name, its enum cases and static members are its values, its
 *   instance members (a protocol extension's: View's modifiers) methods;
 * - a type parameter is what its constraint says: a protocol of the module
 *   (`S: ShapeStyle`), one type (`Label == Text`), a number (`V:
 *   BinaryFloatingPoint`), itself bound to Lucent's scalars (`V:
 *   Equatable`: a number, a string or a boolean, the same at each use), or,
 *   when it is only what the member gives back (`withAnimation`'s Result),
 *   nothing;
 * - a parameter whose attribute is a `@resultBuilder` type is a builder, a
 *   closure an action, anything else a value; a type that cannot be written
 *   (a metatype, CoreGraphics' structs…) leaves out a parameter with a
 *   default, and the member otherwise, with the reason (`skipped`).
 *
 * What the call form cannot write yet, though the schema can say it, is
 * refused by the member's plan (source-plan.ts), for coverage and for the
 * code that writes a body.
 */
import {
  canonicalSchema,
  formatSchemaType,
  parseSchemaType,
  SCHEMA_FORMAT,
  type SchemaProvenance,
  type SchemaType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
  type SwiftParamFacts,
} from "./schema.ts";
import { graphSymbol } from "./provenance.ts";
import { defaultedParameters, GLOBAL_NAMES, isSwiftUsr, swiftName } from "./swift.ts";
import {
  afterColon,
  declText,
  type Fragment,
  parseType,
  propertyType,
  type Resolver,
  since,
  splitName,
  STANDARD_PROTOCOLS,
  type SymbolGraph,
  type SymbolGraphSymbol,
  unavailable,
  Unsupported,
} from "./symbols.ts";

const TYPE_KINDS: Record<string, "struct" | "enum" | "protocol"> = {
  "swift.struct": "struct",
  "swift.enum": "enum",
  "swift.protocol": "protocol",
};

/** The members a body writes: initializers, methods, properties, enum cases and functions. */
const MEMBER_KINDS = new Set([
  "swift.init",
  "swift.method",
  "swift.type.method",
  "swift.property",
  "swift.type.property",
  "swift.enum.case",
  "swift.func",
  "swift.subscript",
]);

/**
 * Standard protocols every Lucent number, string and boolean conforms to
 * (Swift's Double, String and Bool): a type parameter constrained to them
 * takes any of those, its bound a reference to the protocol in module
 * `Swift`.
 */
const SCALAR_PROTOCOLS: Record<string, string> = {
  "s:SQ": "Equatable",
  "s:SH": "Hashable",
  "s:SL": "Comparable",
};

/**
 * Standard protocols of numbers that Swift's Double conforms to: a type
 * parameter constrained to them (a Slider's `V: BinaryFloatingPoint`, a
 * Stepper's `V: Strideable`) takes a Lucent number, a Double in Swift.
 */
const NUMBER_PROTOCOLS: Record<string, string> = {
  "s:SB": "BinaryFloatingPoint",
  "s:SF": "FloatingPoint",
  "s:Sx": "Strideable",
};

/** The associated types of such a parameter that are Double too, Double's being Double. */
const NUMBER_ASSOCIATED = new Set(["Stride", "Magnitude"]);

const DOUBLE: Fragment = { kind: "typeIdentifier", spelling: "Double", preciseIdentifier: "s:Sd" };

/**
 * Standard types a body writes in a form of Lucent's (lucent:ui's
 * `range(from, to)` is a ClosedRange), by USR, as references to module
 * `Swift`.
 */
const STANDARD_VALUES: Record<string, string> = {
  "s:SN": "Swift.ClosedRange",
};

const EXPRESSIBLE_BY_STRING_LITERAL = "s:s26ExpressibleByStringLiteralP";

/** A reference to a scalar protocol (a type parameter's bound): the Lucent values that conform to it. */
export const isScalarProtocol = (t: SchemaType) =>
  t.k === "ref" && t.module === "Swift" && Object.values(SCALAR_PROTOCOLS).includes(t.name);

/** What `Unsupported` says about a type the call form cannot write, as a reason. */
const unwritable = (what: string) => `no value of ${what} can be written in a body yet`;

interface Graph {
  symbols: Map<string, SymbolGraphSymbol>;
  relationships: SymbolGraph["relationships"];
}

/** The module's graphs (its own, its extensions', and those of the modules it is made of) as one. */
function merged(graphs: readonly SymbolGraph[]): Graph {
  const symbols = new Map<string, SymbolGraphSymbol>();
  const relationships: SymbolGraph["relationships"] = [];
  const seen = new Set<string>();

  for (const g of graphs) {
    for (const s of g.symbols)
      if (!s.identifier.precise.includes("::SYNTHESIZED::")) symbols.set(s.identifier.precise, s);

    for (const r of g.relationships) {
      const key = `${r.kind} ${r.source} ${r.target}`;
      if (seen.has(key) || r.source.includes("::SYNTHESIZED::")) continue;

      seen.add(key);
      relationships.push(r);
    }
  }

  return { symbols, relationships };
}

/** The type a typealias stands for: its fragments after `=`. */
function aliased(s: SymbolGraphSymbol): Fragment[] | undefined {
  const frags = s.declarationFragments ?? [];
  const eq = frags.findIndex((f) => f.kind === "text" && f.spelling.includes("="));
  if (eq < 0 || s.swiftGenerics?.parameters?.length) return undefined;

  const rest = frags[eq]!.spelling.slice(frags[eq]!.spelling.indexOf("=") + 1);
  return [...(rest.trim() ? [{ kind: "text", spelling: rest }] : []), ...frags.slice(eq + 1)];
}

/**
 * The schema of `module` written as source, from the symbol graphs of it
 * and of the modules it is made of (SwiftUI and SwiftUICore), synthesized
 * members left out.
 */
export function buildSourceSchema(
  module: string,
  graphs: readonly SymbolGraph[],
  provenance?: SchemaProvenance,
): SdkModuleSchema {
  const g = merged(graphs);
  const skipped: string[] = [];
  const skip = (owner: string, s: SymbolGraphSymbol, reason: string) =>
    skipped.push(`${owner}.${s.names.title}: ${reason}`);

  // The types values are made of, by USR: `Edge.Set` is Edge_Set.
  const types = new Map<string, { s: SymbolGraphSymbol; name: string }>();
  for (const s of g.symbols.values()) {
    if (!TYPE_KINDS[s.kind.identifier] || !isSwiftUsr(s.identifier.precise) || unavailable(s))
      continue;
    if (s.pathComponents.length === 1 && GLOBAL_NAMES.has(s.pathComponents[0]!)) continue;

    types.set(s.identifier.precise, { s, name: s.pathComponents.join("_") });
  }

  const aliases = new Map<string, Fragment[]>();
  for (const s of g.symbols.values()) {
    const frags = s.kind.identifier === "swift.typealias" ? aliased(s) : undefined;
    if (frags) aliases.set(s.identifier.precise, frags);
  }

  // A type declared with an attribute (`@resultBuilder`), through typealiases (ContentBuilder).
  const declared = (usr: string | undefined, attribute: string): boolean => {
    for (let at = usr, depth = 0; at && depth < 8; depth++) {
      const s = g.symbols.get(at);
      if (!s) return false;
      if (s.kind.identifier !== "swift.typealias") return declText(s).includes(attribute);

      at = aliases.get(at)?.find((f) => f.kind === "typeIdentifier")?.preciseIdentifier;
    }
    return false;
  };

  // A type a string literal makes (LocalizedStringKey) takes a string.
  const stringLiterals = new Set(
    g.relationships
      .filter((r) => r.kind === "conformsTo" && r.target === EXPRESSIBLE_BY_STRING_LITERAL)
      .map((r) => r.source),
  );
  const ref = (usr: string) => {
    if (stringLiterals.has(usr)) return "string";
    if (STANDARD_VALUES[usr]) return STANDARD_VALUES[usr];

    const t = types.get(usr);
    return t && `${module}.${t.name}`;
  };

  const memberOf = new Map<string, SymbolGraphSymbol[]>();
  const requirements = new Set<string>();
  const conformances = new Map<string, string[]>();
  for (const r of g.relationships) {
    const s = g.symbols.get(r.source);
    if (!s) continue;

    if (r.kind === "requirementOf" || r.kind === "optionalRequirementOf")
      requirements.add(r.source);
    if (
      (r.kind === "memberOf" || r.kind === "requirementOf") &&
      MEMBER_KINDS.has(s.kind.identifier)
    )
      memberOf.set(r.target, [...(memberOf.get(r.target) ?? []), s]);
    if (
      (r.kind === "conformsTo" || r.kind === "inheritsFrom") &&
      ref(r.target) &&
      types.has(r.source)
    )
      conformances.set(r.source, [
        ...new Set([...(conformances.get(r.source) ?? []), ref(r.target)!]),
      ]);
  }

  const reader: MemberReader = {
    module,
    ref,
    aliases,
    builder: (usr) => declared(usr, "@resultBuilder"),
    types,
  };

  const out: SdkClassSchema[] = [];
  for (const [usr, { s, name }] of types) {
    const kind = TYPE_KINDS[s.kind.identifier]!;
    const cls: SdkClassSchema = {
      kind: "class",
      name,
      symbol: graphSymbol(usr),
      native: swiftName(module, s),
      swift: { kind },
    };

    if (kind === "protocol") cls.interface = true;
    if (declText(s).includes("@propertyWrapper")) cls.swift!.propertyWrapper = true;

    const implemented = conformances.get(usr)?.sort();
    if (implemented?.length) cls.implements = implemented;

    const v = since(s);
    if (v) cls.since = v;

    const owner: Owner = {
      name,
      self: `${module}.${name}`,
      protocol: kind === "protocol",
      generics: s.swiftGenerics,
      since: v,
    };
    const members = (memberOf.get(usr) ?? []).sort(bySymbol);

    for (const m of members) {
      if (unavailable(m) || !isSwiftUsr(m.identifier.precise)) continue;
      // Operators have no name a call is written with.
      if (/^[^a-zA-Z_]/.test(m.names.title)) continue;

      if (requirements.has(m.identifier.precise) && owner.protocol) {
        skip(name, m, "a protocol requirement: its types implement it, a body does not call it");
        continue;
      }

      try {
        addMember(cls, readMember(m, owner, reader));
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        skip(name, m, e.message);
      }
    }

    out.push(cls);
  }

  namesOnce(module, out, (owner, m, reason) => skipped.push(`${owner}.${m}: ${reason}`));

  const functions: SdkMethodSchema[] = [];
  for (const s of [...g.symbols.values()].sort(bySymbol)) {
    if (s.kind.identifier !== "swift.func" || s.pathComponents.length !== 1) continue;
    if (unavailable(s) || !isSwiftUsr(s.identifier.precise) || /^[^a-zA-Z_]/.test(s.names.title))
      continue;

    try {
      const f = readMember(s, { name: module, protocol: false }, reader);
      if ("returns" in f.member) functions.push(f.member);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      skip(module, s, e.message);
    }
  }

  return canonicalSchema({
    format: SCHEMA_FORMAT,
    platform: "ios",
    ...(provenance ? { provenance } : {}),
    module,
    form: "source",
    types: out,
    ...(functions.length ? { functions } : {}),
    skipped: skipped.sort(),
  });
}

const bySymbol = (a: SymbolGraphSymbol, b: SymbolGraphSymbol) =>
  a.identifier.precise < b.identifier.precise
    ? -1
    : a.identifier.precise > b.identifier.precise
      ? 1
      : 0;

interface MemberReader {
  module: string;
  ref: (usr: string) => string | undefined;
  aliases: Map<string, Fragment[]>;
  /** Whether an attribute's type is a result builder. */
  builder: (usr: string | undefined) => boolean;
  types: Map<string, { s: SymbolGraphSymbol; name: string }>;
}

interface Owner {
  name: string;
  /** `SwiftUI.Color`: what `Self` is. */
  self?: string;
  protocol: boolean;
  generics?: SymbolGraphSymbol["swiftGenerics"];
  since?: string;
}

type ReadMember =
  | { k: "init"; member: SdkCallable }
  | { k: "method"; member: SdkMethodSchema }
  | { k: "property"; member: SdkPropertySchema };

function addMember(cls: SdkClassSchema, m: ReadMember): void {
  if (m.k === "init") (cls.constructors ??= []).push(m.member);
  else if (m.k === "method") (cls.methods ??= []).push(m.member);
  else (cls.properties ??= []).push(m.member);
}

/**
 * One name is a property or a method (TypeScript has no both), in a type
 * and the protocols it conforms to: a property named like a method is
 * left out (Animation's `spring`, and `spring(response:…)`; Shape's
 * `layoutDirectionBehavior`, and View's modifier), the call being what
 * takes arguments.
 */
function namesOnce(
  module: string,
  types: SdkClassSchema[],
  skip: (owner: string, member: string, reason: string) => void,
): void {
  const byName = new Map(types.map((t) => [t.name, t]));
  const methodsOf = (cls: SdkClassSchema, seen = new Set<string>()): Map<string, string> => {
    const out = new Map<string, string>();

    for (const m of cls.methods ?? []) out.set(`${!!m.static}:${m.name}`, cls.name);
    for (const ref of cls.implements ?? []) {
      const parent = ref.startsWith(`${module}.`)
        ? byName.get(ref.slice(module.length + 1))
        : undefined;
      if (!parent || seen.has(parent.name)) continue;

      seen.add(parent.name);
      for (const [k, owner] of methodsOf(parent, seen))
        if (k.startsWith("false:") && !out.has(k)) out.set(k, owner);
    }

    return out;
  };

  for (const cls of types) {
    const methods = methodsOf(cls);

    cls.properties = cls.properties?.filter((p) => {
      const owner = methods.get(`${!!p.static}:${p.name}`);
      if (!owner) return true;

      skip(
        cls.name,
        p.name,
        `named like ${owner === cls.name ? "its type's" : `${owner}'s`} method ${p.name}(…), which takes arguments`,
      );
      return false;
    });
    if (!cls.properties?.length) delete cls.properties;
  }
}

/** The type a type parameter stands for, by its constraints; undefined when none says. */
function constrained(
  param: string,
  constraints: Constraint[],
  r: MemberReader,
): SchemaType | undefined {
  const own = constraints.filter(
    (c, i) =>
      c.lhs === param &&
      constraints.findIndex((x) => x.lhs === c.lhs && x.kind === c.kind && x.rhs === c.rhs) === i,
  );
  if (!own.length) return undefined;

  const same = own.find((c) => c.kind === "sameType" && c.rhsPrecise);
  if (same) {
    const t = r.ref(same.rhsPrecise!);
    if (t) return parseSchemaType(t);
  }

  const protocols = own.filter((c) => c.kind === "conformance" && c.rhsPrecise);
  const lucent = protocols.filter((c) => !SCALAR_PROTOCOLS[c.rhsPrecise!]);
  if (
    own.length === protocols.length &&
    lucent.length &&
    lucent.every((c) => NUMBER_PROTOCOLS[c.rhsPrecise!])
  )
    return parseSchemaType("double");
  if (own.length === protocols.length && lucent.length === 1) {
    const only = lucent[0]!;
    const standard = STANDARD_PROTOCOLS[only.rhsPrecise!]?.([]);
    const t = standard ?? (r.ref(only.rhsPrecise!) && parseSchemaType(r.ref(only.rhsPrecise!)!));
    if (t) return t;
  }
  if (own.length === protocols.length && !lucent.length)
    return {
      k: "tparam",
      name: param,
      nullable: false,
      bound: {
        k: "ref",
        module: "Swift",
        name: SCALAR_PROTOCOLS[protocols[0]!.rhsPrecise!]!,
        nullable: false,
      },
    };

  throw new Unsupported(`generic constraints the call form cannot write yet (${written(own)})`);
}

/** Constraints as Swift writes them, by what they constrain: `S: ShapeStyle & View`. */
function written(constraints: Constraint[]): string {
  const byLhs = new Map<string, Constraint[]>();
  for (const c of constraints) byLhs.set(c.lhs, [...(byLhs.get(c.lhs) ?? []), c]);

  return [...byLhs]
    .flatMap(([lhs, cs]) => {
      const same = cs.filter((c) => c.kind === "sameType").map((c) => `${lhs} == ${c.rhs}`);
      const conforms = cs.filter((c) => c.kind !== "sameType").map((c) => c.rhs);

      return [...same, ...(conforms.length ? [`${lhs}: ${conforms.join(" & ")}`] : [])];
    })
    .join(", ");
}

/** A member as the call form writes it, or Unsupported with the reason it cannot. */
function readMember(m: SymbolGraphSymbol, owner: Owner, r: MemberReader): ReadMember {
  const k = m.kind.identifier;
  const text = declText(m);

  if (k === "swift.subscript") throw new Unsupported("subscripts are not written in a body");
  if (/\beach\s/.test(text)) throw new Unsupported("parameter packs");
  if (keyword(m, "async")) throw new Unsupported("async members are not written in a body");
  if (keyword(m, "throws")) throw new Unsupported("members that throw are not written in a body");
  if (k === "swift.init" && /\binit[?!]/.test(text))
    throw new Unsupported("failable initializers are not written in a body yet");

  // `extension View where Self: Equatable`: only some of its types have it.
  const extension = m.swiftExtension?.constraints ?? [];
  const onSelf = extension.find((c) => c.lhs === "Self");
  if (onSelf)
    throw new Unsupported(
      `only for some of ${owner.name}'s types (where Self${onSelf.kind === "sameType" ? " == " : ": "}${onSelf.rhs})`,
    );

  const constraints = [
    ...(owner.generics?.constraints ?? []),
    ...extension,
    ...(m.swiftGenerics?.constraints ?? []),
    ...whereClause(m.declarationFragments ?? []),
  ];
  const typeArgs = new Map<string, SchemaType>();
  const params = [
    ...(owner.generics?.parameters ?? []),
    ...(m.swiftGenerics?.parameters ?? []),
  ].map((p) => p.name);
  const returns = m.functionSignature?.returns ?? [];

  for (const p of new Set(params)) {
    const t = constrained(p, constraints, r);
    if (t) typeArgs.set(p, t);
    // Only what the member gives back (a body's result): nothing to write.
    else if (returns.length === 1 && returns[0]!.spelling === p)
      typeArgs.set(p, parseSchemaType("void"));
  }

  const resolver: Resolver = {
    ref: r.ref,
    alias: (usr) => r.aliases.get(usr),
    typedef: () => undefined,
    typeArgs,
    typeParams: params,
    ...(owner.self ? { self: owner.self } : {}),
  };
  const symbol = graphSymbol(m.identifier.precise);
  const introduced = since(m);
  const available = {
    ...(introduced && introduced !== owner.since ? { since: introduced } : {}),
    ...(deprecated(m) ? { deprecated: true } : {}),
  };
  const isStatic =
    k === "swift.type.property" || k === "swift.type.method" || k === "swift.enum.case";

  if (k === "swift.property" || k === "swift.type.property" || k === "swift.enum.case") {
    if (k === "swift.enum.case" && text.includes("("))
      throw new Unsupported("enum cases with values are not written in a body yet");

    const type =
      k === "swift.enum.case"
        ? parseSchemaType(owner.self!)
        : writable(parseType(propertyType(m.declarationFragments ?? []), resolver));
    const name = k === "swift.enum.case" ? m.pathComponents.at(-1)! : m.names.title;
    const p: SdkPropertySchema = {
      name,
      type,
      symbol,
      readonly: true,
      swift: { name },
      ...available,
    };
    if (isStatic) p.static = true;

    return { k: "property", member: p };
  }

  const labels = splitName(m.names.title).labels;
  const defaults = defaultedParameters(text);
  const sig = m.functionSignature?.parameters ?? [];
  const call: SdkCallable = {
    params: sig.map((pp, i) => parameter(pp, labels[i], !!defaults[i], resolver, r)),
    symbol,
    swift: { name: m.names.title },
    ...available,
  };

  if (k === "swift.init") return { k: "init", member: call };

  const method: SdkMethodSchema = {
    ...call,
    name: splitName(m.names.title).base,
    returns: returns.length ? writable(parseType(returns, resolver)) : parseSchemaType("void"),
  };
  if (isStatic) method.static = true;

  return { k: "method", member: method };
}

/** A parameter, its Swift label and kind; a default whose type cannot be written is left out. */
function parameter(
  pp: { name: string; internalName?: string; declarationFragments: Fragment[] },
  label: string | undefined,
  defaulted: boolean,
  resolver: Resolver,
  r: MemberReader,
): SdkParam {
  const name = pp.internalName ?? pp.name;
  const attribute = pp.declarationFragments.find(
    (f) => f.kind === "attribute" && f.preciseIdentifier,
  );
  const facts: SwiftParamFacts = {
    ...(label && label !== "_" ? { label } : {}),
    kind: r.builder(attribute?.preciseIdentifier) ? "builder" : "value",
  };

  // A closure the body gives does not throw: one that may is given one that does not.
  const frags = globalActors(pp.declarationFragments).filter(
    (f) => !(f.kind === "keyword" && (f.spelling === "throws" || f.spelling === "rethrows")),
  );

  try {
    if (frags.some((f) => f.kind === "keyword" && f.spelling === "async"))
      throw new Unsupported("async closures are not written in a body yet");

    const type = writable(parseType(numberMembers(afterColon(frags), resolver), resolver));
    if (facts.kind === "value" && type.k === "fn") facts.kind = "action";
    if (facts.kind === "action" && type.k === "fn" && !isVoid(type.ret))
      throw new Unsupported(
        `\`${facts.label ?? name}\` returns a value (${formatSchemaType(type.ret)}) to SwiftUI: a body's callbacks call the setup, which returns them nothing`,
      );
    if (isVoid(type)) throw new Unsupported("generic values of any type are not written in a body");

    return { name, type, ...(defaulted ? { defaulted: "optional" } : {}), swift: facts };
  } catch (e) {
    if (!(e instanceof Unsupported) || !defaulted) throw e;

    return { name, type: parseSchemaType("id"), defaulted: "omitted", swift: facts };
  }
}

/**
 * `V.Stride` where V is a Lucent number (a Slider's step): a Double too,
 * which a type parameter's associated type is when the parameter is.
 */
function numberMembers(frags: Fragment[], r: Resolver): Fragment[] {
  const number = (f: Fragment | undefined) => {
    const t =
      f?.kind === "typeIdentifier" && !f.preciseIdentifier
        ? r.typeArgs?.get(f.spelling)
        : undefined;

    return t?.k === "prim" && t.name === "double";
  };

  const out: Fragment[] = [];

  for (let i = 0; i < frags.length; i++) {
    const [f, dot, member] = [frags[i]!, frags[i + 1], frags[i + 2]];

    if (
      number(f) &&
      dot?.kind === "text" &&
      dot.spelling === "." &&
      member?.kind === "typeIdentifier" &&
      NUMBER_ASSOCIATED.has(member.spelling)
    ) {
      out.push(DOUBLE);
      i += 2;
      continue;
    }

    out.push(f);
  }

  return out;
}

const isVoid = (t: SchemaType) => t.k === "prim" && t.name === "void";

/** `@MainActor` in a closure's type, which the graph writes as `@` and the actor's type: one attribute. */
function globalActors(frags: Fragment[]): Fragment[] {
  return frags.flatMap((f, i): Fragment[] => {
    const next = frags[i + 1];
    const prev = frags[i - 1];

    if (f.kind === "text" && f.spelling.endsWith("@") && next?.kind === "typeIdentifier")
      return [{ kind: "text", spelling: `${f.spelling}${next.spelling}` }];
    if (f.kind === "typeIdentifier" && prev?.kind === "text" && prev.spelling.endsWith("@"))
      return [];

    return [f];
  });
}

/** `t`, when a body can write a value of it: numbers, strings, booleans, the module's types, closures, arrays of them. */
function writable(t: SchemaType): SchemaType {
  switch (t.k) {
    case "prim":
    case "string":
    case "ref":
      return t;
    case "array":
      writable(t.of);
      return t;
    case "fn":
      t.params.forEach(writable);
      writable(t.ret);
      return t;
    case "tparam":
      if (t.bound) return t;

      throw new Unsupported("generic values of any type are not written in a body");
    default:
      throw new Unsupported(unwritable(formatSchemaType(t)));
  }
}

type Constraint = { kind: string; lhs: string; rhs: string; rhsPrecise?: string };

/**
 * The constraints a declaration's `where` clause writes (`where V : View`),
 * which its graph does not always list among its generics'.
 */
function whereClause(frags: Fragment[]): Constraint[] {
  const at = frags.findIndex((f) => f.kind === "keyword" && f.spelling === "where");
  if (at < 0) return [];

  const out: Constraint[] = [];
  let clause: Fragment[] = [];
  const end = () => {
    const text = clause.map((f) => f.spelling).join("");
    const op = /==|:/.exec(text);
    let at = 0;
    const rhs = clause.find((f) => {
      at += f.spelling.length;
      return f.kind === "typeIdentifier" && !!op && at > op.index;
    });

    if (op && rhs)
      out.push({
        kind: op[0] === "==" ? "sameType" : "conformance",
        lhs: text.slice(0, op.index).trim(),
        rhs: rhs.spelling,
        ...(rhs.preciseIdentifier ? { rhsPrecise: rhs.preciseIdentifier } : {}),
      });
    clause = [];
  };

  for (const f of frags.slice(at + 1)) {
    if (f.kind === "text" && f.spelling.includes(",")) {
      end();
      continue;
    }
    clause.push(f);
  }
  end();

  return out;
}

/** Whether the member's own declaration (not its closures') says `keyword`. */
function keyword(m: SymbolGraphSymbol, word: "async" | "throws"): boolean {
  let depth = 0;

  for (const f of m.declarationFragments ?? []) {
    if (f.kind === "text") for (const c of f.spelling) depth += c === "(" ? 1 : c === ")" ? -1 : 0;
    if (f.kind === "keyword" && depth === 0 && f.spelling === word) return true;
  }

  return false;
}

/** Deprecated on iOS now (not only announced for a future version). */
function deprecated(m: SymbolGraphSymbol): boolean {
  return !!m.availability?.some((a) => {
    const d = (a as { deprecated?: { major: number } }).deprecated;
    const always = (a as { isUnconditionallyDeprecated?: boolean }).isUnconditionallyDeprecated;

    return (a.domain === "iOS" && !!d && d.major < 100000) || (a.domain === "*" && !!always);
  });
}
