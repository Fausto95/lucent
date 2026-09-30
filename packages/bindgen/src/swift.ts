/**
 * Swift-only declarations (USRs starting `s:`): the types and members Lucent
 * calls through generated `@_cdecl` shims, read into the schema with what a
 * shim needs to call them (docs/design/swift-shims.md).
 */
import {
  parseSchemaType,
  type SchemaType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkEnumSchema,
  type SdkMethodSchema,
  type NativeFacts,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
  type SwiftMember,
  type SwiftType,
} from "./schema.ts";
import {
  afterColon,
  declText,
  type Fragment,
  parseType,
  propertyType,
  type Resolver,
  since,
  STANDARD_PROTOCOLS,
  splitName,
  type SymbolGraph,
  type SymbolGraphSymbol,
  mainActorFacts,
  unavailable,
  Unsupported,
} from "./symbols.ts";
import { classThreadFlags, memberFacts, memberThreadFlags } from "./facts.ts";
import { graphSymbol } from "./provenance.ts";

const TYPE_KINDS: Record<string, SwiftType["kind"]> = {
  "swift.struct": "struct",
  "swift.class": "class",
  "swift.enum": "enum",
  "swift.protocol": "protocol",
};

/** Symbol kinds of members a program calls or reads (not types, cases or operators). */
const MEMBER_KINDS = new Set([
  "swift.func",
  "swift.method",
  "swift.type.method",
  "swift.init",
  "swift.property",
  "swift.type.property",
  "swift.var",
  "swift.subscript",
]);

/**
 * Names the declarations cannot give a type: a class `Date` in a module's
 * declarations would hide JavaScript's in every signature there.
 */
export const GLOBAL_NAMES = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "PromiseLike",
  "Record",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "Uint8Array",
]);

const CONTIGUOUS_BYTES = "s:10Foundation15ContiguousBytesP";

/** A Swift declaration Lucent calls through shims, not a C or Objective-C one. */
export const isSwiftUsr = (usr: string) => usr.startsWith("s:") && !usr.includes("::SYNTHESIZED::");

/**
 * A member an extension of one of the module's own protocols gives a Swift
 * type that conforms to it (`SHA256.hash(data:)`, from HashFunction). The
 * standard library's (Sequence, Equatable…) are left out: they are Swift's
 * collection and comparison machinery, not the module's API.
 */
function isSynthesized(usr: string, module: string): boolean {
  const [origin, type] = usr.split("::SYNTHESIZED::");
  // The conforming type: a Swift type, or an Objective-C class (AVAsset).
  if (!type?.startsWith("s:") && !type?.startsWith("c:")) return false;
  return extensionModule(origin!) === module;
}

/**
 * The module an extension member's USR says declares it: a Swift
 * protocol's (`s:9CryptoKit12HashFunctionPAAE…`), or, for an Objective-C
 * protocol's extension, the module after it (`s:So29AVAsynchronousKey…P12AVFoundationE…`).
 */
function extensionModule(usr: string): string | undefined {
  const read = (at: number): [string, number] | undefined => {
    const n = /^\d+/.exec(usr.slice(at))?.[0];
    return n
      ? [usr.slice(at + n.length, at + n.length + Number(n)), at + n.length + Number(n)]
      : undefined;
  };
  if (!usr.startsWith("s:So")) return read(2)?.[0];
  const protocol = read(4);
  return protocol && usr[protocol[1]] === "P" ? read(protocol[1] + 1)?.[0] : undefined;
}

/**
 * The Swift types of a module that get schema types, with their kind in the
 * names index: structs and classes cross as objects, enums without payloads
 * as numbers. Value types that bridge (URL, Date) are left out: they cross
 * as their Objective-C classes or as Lucent values.
 */
export function swiftTypeKinds(
  g: SymbolGraph,
  bridged: (usr: string) => boolean,
): Map<SymbolGraphSymbol, "class" | "protocol" | "enum"> {
  const cases = new Map<string, SymbolGraphSymbol[]>();
  const byUsr = new Map(g.symbols.map((s) => [s.identifier.precise, s]));
  for (const r of g.relationships) {
    const c = byUsr.get(r.source);
    if (r.kind === "memberOf" && c?.kind.identifier === "swift.enum.case")
      cases.set(r.target, [...(cases.get(r.target) ?? []), c]);
  }
  const out = new Map<SymbolGraphSymbol, "class" | "protocol" | "enum">();
  for (const s of g.symbols) {
    const usr = s.identifier.precise;
    const kind = TYPE_KINDS[s.kind.identifier];
    if (!kind || !isSwiftUsr(usr) || unavailable(s) || bridged(usr)) continue;
    if (/\beach\s/.test(declText(s))) continue;
    if (s.pathComponents.length === 1 && GLOBAL_NAMES.has(s.pathComponents[0]!)) continue;
    const own = cases.get(usr) ?? [];
    out.set(
      s,
      kind === "protocol"
        ? "protocol"
        : kind === "enum" && own.length && !own.some(hasPayload)
          ? "enum"
          : "class",
    );
  }
  return out;
}

/** `Self` in a protocol's requirement: the conforming type, a type parameter of the requirement's own. */
export const SELF: SchemaType = { k: "tparam", name: "Self", nullable: false };

/** The primary associated types a protocol's declaration names: `Item` in `protocol Store<Item>`. */
function primaryAssociatedTypes(text: string): string[] {
  const list = /\bprotocol\s+\w+\s*<([^>]*)>/.exec(text)?.[1];
  return list ? list.split(",").map((a) => a.trim()) : [];
}

/** Each protocol's associated types, by the protocol's USR: its type parameters in Lucent. */
export function associatedTypesOf(g: SymbolGraph): Map<string, string[]> {
  const byUsr = new Map(g.symbols.map((s) => [s.identifier.precise, s]));
  const out = new Map<string, string[]>();
  for (const r of g.relationships) {
    const a = byUsr.get(r.source);
    const owned = r.kind === "memberOf" || r.kind === "requirementOf";
    if (!owned || a?.kind.identifier !== "swift.associatedtype") continue;
    if (out.get(r.target)?.includes(a.pathComponents.at(-1)!)) continue;

    out.set(r.target, [...(out.get(r.target) ?? []), a.pathComponents.at(-1)!]);
  }

  return out;
}

/** `red` for `Palette.red`, `circle` for `circle(center:radius:)`. */
const caseName = (c: SymbolGraphSymbol) => c.pathComponents.at(-1)!.replace(/\(.*$/, "");

const hasPayload = (c: SymbolGraphSymbol) =>
  (c.declarationFragments ?? []).some((f) => f.kind === "text" && f.spelling.includes("("));

/** A Swift type's name in Swift: `CryptoKit.AES.GCM.SealedBox`. */
export const swiftName = (module: string, s: SymbolGraphSymbol) =>
  [module, ...s.pathComponents].join(".");

export interface SwiftContext {
  module: string;
  g: SymbolGraph;
  mod: SdkModuleSchema;
  /** Members of a type (and requirements of a protocol), by the type's USR. */
  members: Map<string, SymbolGraphSymbol[]>;
  kinds: Map<SymbolGraphSymbol, "class" | "protocol" | "enum">;
  /** A resolver for a member's types, with `self` and type parameters. */
  resolver: (
    opts: Pick<
      Resolver,
      "self" | "selfType" | "mainActor" | "typeParams" | "typeArgs" | "associated"
    >,
  ) => Resolver;
  /** Objective-C classes of the module, by USR: their Swift members join them. */
  objcClasses: Map<string, SdkClassSchema>;
}

/** Adds a module's Swift types and members to its schema; what it cannot bind is skipped with the reason. */
export function addSwiftDeclarations(ctx: SwiftContext): void {
  const { module, g, mod } = ctx;
  const handled = new Set<string>();
  const skip = (s: SymbolGraphSymbol, reason: string) => {
    handled.add(s.identifier.precise);
    const owner = s.pathComponents.slice(0, -1).join("_") || module;
    mod.skipped!.push(`${owner}.${s.names.title}: ${reason}`);
  };
  const requirements = new Set(
    g.relationships
      .filter((r) => r.kind === "requirementOf" || r.kind === "optionalRequirementOf")
      .map((r) => r.source),
  );
  const conforms = (usr: string, protocol: string) =>
    g.relationships.some(
      (r) => r.kind === "conformsTo" && r.source === usr && r.target === protocol,
    );
  const refOf = (usr: string) => ctx.resolver({}).ref(usr);
  const associatedByProtocol = associatedTypesOf(g);

  for (const [s, kind] of ctx.kinds) {
    const usr = s.identifier.precise;
    const name = s.pathComponents.join("_");
    const self = `${module}.${name}`;
    const typeParams = (s.swiftGenerics?.parameters ?? []).map((p) => p.name);
    const members = (ctx.members.get(usr) ?? []).filter(
      (m) =>
        isSwiftUsr(m.identifier.precise) ||
        (kind !== "protocol" && isSynthesized(m.identifier.precise, module)),
    );
    const swift = TYPE_KINDS[s.kind.identifier]!;
    if (kind === "enum") {
      const e: SdkEnumSchema = {
        kind: "enum",
        name,
        native: swiftName(module, s),
        symbol: graphSymbol(usr),
        swift: { kind: "enum" },
        cases: members
          .filter((m) => m.kind.identifier === "swift.enum.case")
          .map((c, i) => ({ name: caseName(c), native: caseName(c), value: i })),
      };
      mod.types.push(e);
      for (const m of members)
        if (MEMBER_KINDS.has(m.kind.identifier)) skip(m, "member of an enum without payloads");
      continue;
    }
    const cls: SdkClassSchema = {
      kind: "class",
      name,
      native: swiftName(module, s),
      symbol: graphSymbol(usr),
      swift: { kind: swift },
    };
    // A protocol's associated types are its type parameters, the ones `P<A>` names first.
    const associatedTypes = kind === "protocol" ? (associatedByProtocol.get(usr) ?? []) : [];
    const primary = primaryAssociatedTypes(declText(s)).filter((a) => associatedTypes.includes(a));
    if (kind === "protocol") {
      cls.interface = true;
      if (
        associatedTypes.length ||
        members.some((m) => requirements.has(m.identifier.precise) && /\bSelf\b/.test(declText(m)))
      )
        cls.swift!.associatedTypes = true;
      if (primary.length) cls.swift!.primaryAssociatedTypes = primary;
      typeParams.push(...primary, ...associatedTypes.filter((a) => !primary.includes(a)));
    }
    if (typeParams.length) cls.typeParams = typeParams;
    const classFacts = mainActorFacts(declText(s));
    if (classFacts) cls.facts = classFacts;
    Object.assign(cls, classThreadFlags(cls.facts));
    const v = since(s);
    if (v) cls.since = v;
    const superUsr = g.relationships.find(
      (r) => r.kind === "inheritsFrom" && r.source === usr,
    )?.target;
    const superRef = superUsr ? refOf(superUsr) : undefined;
    if (superRef) cls.extends = superRef;
    if (swift === "enum") {
      try {
        const cases = members
          .filter((m) => m.kind.identifier === "swift.enum.case")
          .map((c) => ({
            name: caseName(c),
            params: payload(c, ctx.resolver({ self, typeParams })),
          }));
        if (cases.length) cls.swift!.cases = cases;
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        mod.skipped!.push(`${module}.${name}: ${e.message}`);
        continue;
      }
      // A union of object types in Lucent: values, without members.
      if (cls.swift!.cases) {
        for (const m of members)
          if (MEMBER_KINDS.has(m.kind.identifier))
            skip(m, "Swift: member of an enum with payloads");
        mod.types.push(cls);
        continue;
      }
    }
    // Its typealiases, which fix the associated types of its protocols (`Self.Digest`).
    const aliases = new Map(
      members
        .filter((m) => m.kind.identifier === "swift.typealias")
        .map((m) => [m.pathComponents.at(-1)!, m]),
    );
    const associated = (name: string): SchemaType | undefined => {
      if (associatedTypes.includes(name)) return { k: "tparam", name, nullable: false };
      const frags = aliases.get(name)?.declarationFragments ?? [];
      const eq = frags.findIndex((f) => f.kind === "text" && f.spelling.includes("="));
      if (eq < 0) return undefined;
      const rest = frags[eq]!.spelling.slice(frags[eq]!.spelling.indexOf("=") + 1);
      return parseType(
        [...(rest.trim() ? [{ kind: "text", spelling: rest }] : []), ...frags.slice(eq + 1)],
        ctx.resolver({ self, typeParams }),
      );
    };
    const bound = memberSchemas(
      members.filter((m) => kind !== "protocol" || requirements.has(m.identifier.precise)),
      {
        self,
        typeParams,
        facts: cls.facts,
        since: cls.since,
        associated,
        // In a requirement, `Self` is the type that conforms.
        ...(kind === "protocol" ? { selfType: SELF } : {}),
      },
      ctx,
      skip,
      handled,
    );
    if (conforms(usr, CONTIGUOUS_BYTES) && !bound.props.some((p) => p.name === "bytes"))
      bound.props.push({
        name: "bytes",
        type: parseSchemaType("NSData"),
        readonly: true,
        swift: { name: "bytes", bytes: true },
      });
    if (bound.ctors.length) cls.constructors = bound.ctors;
    if (bound.methods.length) cls.methods = bound.methods;
    if (bound.props.length) cls.properties = bound.props;
    mod.types.push(cls);
  }

  // Swift members of Objective-C classes (the Swift overlays' extensions).
  for (const [usr, cls] of ctx.objcClasses) {
    const members = (ctx.members.get(usr) ?? []).filter(
      (m) => isSwiftUsr(m.identifier.precise) || isSynthesized(m.identifier.precise, module),
    );
    if (!members.length) continue;
    const bound = memberSchemas(
      members,
      {
        self: `${module}.${cls.name}`,
        typeParams: cls.typeParams ?? [],
        facts: cls.facts,
        since: cls.since,
      },
      ctx,
      skip,
      handled,
    );
    // An Objective-C member of the same name wins: the shim is for what Objective-C cannot call.
    const has = (list: { name: string }[] | undefined, n: string) =>
      !!list?.some((x) => x.name === n);
    const methods = withoutPropertyNames(bound.methods, cls.properties ?? [], bound.symbols, skip);
    for (const m of methods) if (!has(cls.methods, m.name)) (cls.methods ??= []).push(m);
    for (const p of bound.props) if (!has(cls.properties, p.name)) (cls.properties ??= []).push(p);
    if (bound.ctors.length && !cls.constructors?.length) cls.constructors = bound.ctors;
  }

  // Top-level functions and variables.
  for (const s of g.symbols) {
    const usr = s.identifier.precise;
    if (!isSwiftUsr(usr) || unavailable(s) || s.pathComponents.length !== 1) continue;
    if (s.kind.identifier !== "swift.func" && s.kind.identifier !== "swift.var") continue;
    const bound = memberSchemas([s], { typeParams: [] }, ctx, skip, handled);
    for (const f of bound.methods) (mod.functions ??= []).push(f);
    for (const c of bound.props) (mod.constants ??= []).push(c);
  }

  // What is left: members of types Lucent does not bind, counted as skipped.
  for (const s of g.symbols) {
    const usr = s.identifier.precise;
    if (!isSwiftUsr(usr) || unavailable(s) || handled.has(usr)) continue;
    if (!MEMBER_KINDS.has(s.kind.identifier)) continue;
    if (s.kind.identifier === "swift.func" && s.names.title.match(/^[^a-zA-Z_]/)) continue;
    skip(
      s,
      `Swift: member of ${s.pathComponents.slice(0, -1).join(".") || "a type Lucent does not bind"}`,
    );
  }
}

/**
 * A member's parameters. Default arguments at the end are optional (a
 * required one after them makes them required); those whose type Lucent
 * has no value for are omitted from every call.
 */
function parameters(m: SymbolGraphSymbol, r: Resolver): SdkParam[] {
  const defaults = defaultedParameters(declText(m));
  const params = (m.functionSignature?.parameters ?? []).map((pp, i): SdkParam => {
    const name = pp.internalName ?? pp.name;
    try {
      const type = parseType(afterColon(pp.declarationFragments), r);
      return defaults[i] ? { name, type, defaulted: "optional" } : { name, type };
    } catch (e) {
      if (!(e instanceof Unsupported) || !defaults[i]) throw e;
      return { name, type: parseSchemaType("id"), defaulted: "omitted" };
    }
  });
  let required = false;
  for (const p of params.toReversed()) {
    if (p.defaulted === "omitted") continue;
    if (!p.defaulted) required = true;
    else if (required) delete p.defaulted;
  }
  return params;
}

/** Which of a declaration's parameters have a default (`= []`), by position. */
export function defaultedParameters(text: string): boolean[] {
  // After the name: attributes before it have parentheses too (`@backDeployed(before: …)`).
  const open = text.indexOf("(", Math.max(0, text.search(/\b(func|init)\b/)));
  if (open < 0) return [];
  const out: boolean[] = [];
  let depth = 0;
  let has = false;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]!;
    if ("([<{".includes(c)) depth++;
    else if (")]>}".includes(c) && text[i - 1] !== "-") {
      if (depth === 0) {
        if (i > open + 1) out.push(has);
        break;
      }
      depth--;
    } else if (depth === 0 && c === ",") {
      out.push(has);
      has = false;
    } else if (depth === 0 && c === "=" && text[i + 1] !== "=" && text[i - 1] !== "=") has = true;
  }
  return out;
}

/**
 * The type arguments a member's extension fixes its type's parameters to
 * (`where Root: AVAsset`, `where Root == AVAsset`), when it fixes them all.
 */
function ownerArgs(
  m: SymbolGraphSymbol,
  typeParams: readonly string[],
  r: Resolver,
): SchemaType[] | undefined {
  if (!typeParams.length) return undefined;
  const constraints = m.swiftExtension?.constraints ?? [];
  const args = typeParams.map((p) => {
    const c = constraints.find(
      (x) => x.lhs === p && (x.kind === "superclass" || x.kind === "sameType") && x.rhsPrecise,
    );
    return c ? elementType(c, r)[0] : undefined;
  });
  return args.every((a) => a) ? (args as SchemaType[]) : undefined;
}

/** The type a `X.Element == T` constraint names, if Lucent has one for it. */
function elementType(c: { rhs: string; rhsPrecise?: string }, r: Resolver): SchemaType[] {
  const frag: Fragment = {
    kind: "typeIdentifier",
    spelling: c.rhs,
    preciseIdentifier: c.rhsPrecise,
  };
  try {
    return [parseType([frag], r)];
  } catch (e) {
    if (e instanceof Unsupported) return [];
    throw e;
  }
}

/** A member's `async`, `throws` and `mutating`, from its declaration's own keywords (not its closures'). */
export function effects(frags: Fragment[]): { async: boolean; throws: boolean; mutating: boolean } {
  let depth = 0;
  const out = { async: false, throws: false, mutating: false };
  for (const f of frags) {
    if (f.kind === "text") for (const c of f.spelling) depth += c === "(" ? 1 : c === ")" ? -1 : 0;
    if (f.kind !== "keyword" || depth !== 0) continue;
    if (f.spelling === "async") out.async = true;
    if (f.spelling === "throws" || f.spelling === "rethrows") out.throws = true;
    if (f.spelling === "mutating") out.mutating = true;
  }
  return out;
}

function memberSchemas(
  members: SymbolGraphSymbol[],
  owner: {
    self?: string;
    typeParams: readonly string[];
    /** The owner's facts, for members without their own. */
    facts?: NativeFacts;
    associated?: Resolver["associated"];
    selfType?: SchemaType;
    /** The iOS version the owner is available from: members record theirs when it differs. */
    since?: string | number;
  },
  ctx: SwiftContext,
  skip: (s: SymbolGraphSymbol, reason: string) => void,
  handled: Set<string>,
): {
  ctors: SdkCallable[];
  methods: SdkMethodSchema[];
  props: SdkPropertySchema[];
  symbols: Map<SdkMethodSchema, SymbolGraphSymbol>;
} {
  const symbols = new Map<SdkMethodSchema, SymbolGraphSymbol>();
  const ctors: SdkCallable[] = [];
  const methods: SdkMethodSchema[] = [];
  const props: SdkPropertySchema[] = [];
  for (const m of members) {
    const k = m.kind.identifier;
    if (!MEMBER_KINDS.has(k) || unavailable(m)) continue;
    handled.add(m.identifier.precise);
    // Operators have no name a call can be written with.
    if (/^[^a-zA-Z_]/.test(m.names.title)) continue;
    if (k === "swift.subscript") {
      skip(m, "Swift: subscripts");
      continue;
    }
    const text = declText(m);
    const head = text.slice(0, Math.max(0, text.search(/\b(func|init|var|let)\b/)));
    if (/\beach\s/.test(text)) {
      skip(m, "Swift: parameter packs");
      continue;
    }
    // A TypeScript static cannot use its class's type parameters, and a shim
    // needs them fixed: by the extension it is declared in, or not at all.
    const isStatic = k === "swift.type.method" || k === "swift.type.property";
    const fixedByExtension = isStatic
      ? ownerArgs(m, owner.typeParams, ctx.resolver({ self: owner.self }))
      : undefined;
    if (owner.typeParams.length && isStatic && !fixedByExtension) {
      skip(m, "Swift: static member of a generic type");
      continue;
    }
    const facts = mainActorFacts(head);
    const mainActor = memberFacts(owner, { facts }).affinity === "main";
    // Its own attribute's facts, and the flags that follow from them and its owner's.
    const thread = { ...(facts ? { facts } : {}), ...memberThreadFlags(owner.facts, facts) };
    // The member's own type parameters; those a standard protocol constrains are fixed.
    const typeArgs = new Map<string, SchemaType>(
      (fixedByExtension ?? []).map((t, i) => [owner.typeParams[i]!, t]),
    );
    const constraints = m.swiftGenerics?.constraints ?? [];
    for (const c of constraints) {
      const standard =
        c.kind === "conformance" && c.rhsPrecise ? STANDARD_PROTOCOLS[c.rhsPrecise] : undefined;
      // `Names.Element == String`: the element a collection's constraint fixes.
      const element = constraints.find(
        (x) => x.kind === "sameType" && x.lhs === `${c.lhs}.Element` && x.rhsPrecise,
      );
      const args = element ? elementType(element, ctx.resolver({ self: owner.self })) : [];
      const t = standard?.(args);
      if (t && /^\w+$/.test(c.lhs)) typeArgs.set(c.lhs, t);
    }
    const own = (m.swiftGenerics?.parameters ?? [])
      .map((p) => p.name)
      .filter((p) => !owner.typeParams.includes(p) && !typeArgs.has(p));
    const r = ctx.resolver({
      self: owner.self,
      mainActor,
      typeParams: [...owner.typeParams, ...own],
      typeArgs,
      ...(owner.associated ? { associated: owner.associated } : {}),
      ...(owner.selfType ? { selfType: owner.selfType } : {}),
    });
    const symbol = graphSymbol(m.identifier.precise);
    const introduced = since(m);
    const available = introduced && introduced !== owner.since ? { since: introduced } : {};

    try {
      if (k === "swift.property" || k === "swift.type.property" || k === "swift.var") {
        const p: SdkPropertySchema = {
          name: m.names.title,
          type: parseType(propertyType(m.declarationFragments ?? []), r),
          symbol,
          ...available,
        };
        if (k === "swift.type.property") p.static = true;
        if (/\{\s*get(\s+(async|throws))*\s*\}/.test(text) || /(^|\s)let\s/.test(text))
          p.readonly = true;
        // Getters may be async or throw (`{ get async throws }`).
        const e = effects(m.declarationFragments ?? []);
        p.swift = { name: m.names.title };
        if (fixedByExtension) p.swift.ownerArgs = fixedByExtension;
        if (e.async) p.swift.async = true;
        if (e.throws) p.swift.throws = true;
        Object.assign(p, thread);

        // One property per name: several protocol extensions can give the
        // same one, and the type's own declaration wins over theirs.
        const same = props.findIndex((x) => x.name === p.name && !!x.static === !!p.static);
        if (same < 0) props.push(p);
        else if (
          props[same]!.symbol?.includes("::SYNTHESIZED::") &&
          !symbol?.includes("::SYNTHESIZED::")
        )
          props[same] = p;

        continue;
      }
      if (k === "swift.init" && /\binit[?!]/.test(text))
        throw new Unsupported("Swift: failable initializer");
      // A TypeScript constructor cannot declare type parameters.
      if (k === "swift.init" && own.length) throw new Unsupported("Swift: generic initializer");
      const e = effects(m.declarationFragments ?? []);
      const swift: SwiftMember = { name: m.names.title };
      if (fixedByExtension) swift.ownerArgs = fixedByExtension;
      if (e.async) swift.async = true;
      if (e.throws) swift.throws = true;
      if (e.mutating) swift.mutating = true;
      const params = parameters(m, r);
      if (k === "swift.init") {
        ctors.push({ params, swift, symbol, ...available, ...(facts ? { facts } : {}) });
        continue;
      }
      const sig = m.functionSignature;
      const method: SdkMethodSchema = {
        name: splitName(m.names.title).base,
        params,
        returns: sig?.returns?.length ? parseType(sig.returns, r) : parseSchemaType("void"),
        symbol,
        ...available,
      };
      if (k === "swift.type.method") method.static = true;
      if (own.length) method.typeParams = own;
      Object.assign(method, thread);
      method.swift = swift;
      methods.push(method);
      symbols.set(method, m);
    } catch (err) {
      if (!(err instanceof Unsupported)) throw err;
      skip(m, err.message.startsWith("Swift:") ? err.message : `Swift: ${err.message}`);
    }
  }
  return { ctors, methods: withoutPropertyNames(methods, props, symbols, skip), props, symbols };
}

/**
 * Methods whose Lucent name is a property's (`frame(in:)` and `frame`): a
 * TypeScript class cannot have both, and the property stays.
 */
function withoutPropertyNames(
  methods: SdkMethodSchema[],
  props: { name: string; static?: boolean }[],
  symbols: Map<SdkMethodSchema, SymbolGraphSymbol>,
  skip: (s: SymbolGraphSymbol, reason: string) => void,
): SdkMethodSchema[] {
  const names = new Set(props.map((p) => `${!!p.static}:${p.name}`));
  return methods.filter((m) => {
    if (!names.has(`${!!m.static}:${m.name}`)) return true;
    skip(symbols.get(m)!, "Swift: named like a property");
    return false;
  });
}

/** An enum case's payload: `circle(center: Point, radius: Double)`. */
function payload(c: SymbolGraphSymbol, r: Resolver): { label?: string; type: SchemaType }[] {
  const frags = c.declarationFragments ?? [];
  const open = frags.findIndex((f) => f.kind === "text" && f.spelling.includes("("));
  if (open < 0) return [];
  // The fragments between the parentheses, split at top-level commas.
  const parts: Fragment[][] = [[]];
  let depth = 0;
  const rest: Fragment[] = [
    { kind: "text", spelling: frags[open]!.spelling.slice(frags[open]!.spelling.indexOf("(") + 1) },
    ...frags.slice(open + 1),
  ];
  for (const f of rest) {
    if (f.kind !== "text") {
      parts.at(-1)!.push(f);
      continue;
    }
    let chunk = "";
    for (const ch of f.spelling) {
      if (ch === "(" || ch === "<" || ch === "[") depth++;
      if (ch === ")" || ch === ">" || ch === "]") depth--;
      if (depth < 0) break;
      if (ch === "," && depth === 0) {
        if (chunk.trim()) parts.at(-1)!.push({ kind: "text", spelling: chunk });
        parts.push([]);
        chunk = "";
        continue;
      }
      chunk += ch;
    }
    if (chunk.trim()) parts.at(-1)!.push({ kind: "text", spelling: chunk });
    if (depth < 0) break;
  }
  return parts
    .filter((p) => p.length)
    .map((p) => {
      const label = p[0]!.kind === "externalParam" ? p[0]!.spelling : undefined;
      const type = parseType(label ? afterColon(p.slice(1)) : p, r);
      return label ? { label, type } : { type };
    });
}
