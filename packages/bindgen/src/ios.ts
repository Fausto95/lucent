import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatSchemaType,
  parseSchemaType,
  SCHEMA_FORMAT,
  type SchemaType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkEnumSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
} from "./schema.ts";
import {
  afterColon,
  bridgedSwiftType,
  declText,
  escapingParams,
  type Fragment,
  mainActorFacts,
  objcClass,
  objcMember,
  parseType,
  propertyType,
  REFERENCE_CONVERTIBLE,
  type Resolver,
  since,
  splitName,
  type SymbolGraph,
  type SymbolGraphSymbol,
  unavailable,
  Unsupported,
  withEscaping,
} from "./symbols.ts";
import { undeclaredReason, undeclaredType } from "./binding-plan.ts";
import { swiftMemberOf } from "./c-swift-names.ts";
import { classThreadFlags, memberFacts, memberThreadFlags } from "./facts.ts";
import { graphSymbol, type IosModuleSource, iosProvenance } from "./provenance.ts";
import { addSwiftDeclarations, associatedTypesOf, swiftName, swiftTypeKinds } from "./swift.ts";

/**
 * Binding schemas for Clang modules (Apple frameworks, and Objective-C pods
 * later), from the Swift view of each module that `swift-symbolgraph-extract`
 * produces: Swift names, optionals, `throws`, `@MainActor`, availability, and
 * clang USRs that carry the Objective-C selectors. Enum values come from
 * clang, which symbol graphs do not include. Swift-only declarations (Swift
 * shims, M2.3) and closures (M2.2/M2.3) are listed as skipped.
 */
export interface IosOptions {
  modules: string[];
  /** Directories with module maps (for modules outside the SDK). */
  includePaths?: string[];
  /** Deployment target (the design's availability baseline). */
  target?: string;
  /** The xcrun to run (default: xcrun on PATH). */
  xcrun?: string;
  /** Framework search paths (-F), for frameworks outside the SDK. */
  frameworkPaths?: string[];
  /** Module maps to load (-fmodule-map-file), as pods declare their modules. */
  moduleMaps?: string[];
  /** Preprocessor definitions (-D), as the app's pods compile with. */
  defines?: string[];
}

const DEFAULT_TARGET = "arm64-apple-ios15.1-simulator";

/** The target triple declarations are read for. */
export const iosTarget = (opts: Pick<IosOptions, "target">) => opts.target ?? DEFAULT_TARGET;

/** The simulator SDK's path or version, from xcrun (extractIos only; the provider locates the SDK itself). */
function sdkInfo(what: "path" | "version"): string {
  const r = spawnSync("xcrun", ["--sdk", "iphonesimulator", `--show-sdk-${what}`], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error("xcrun: no iphonesimulator SDK");

  return r.stdout.trim();
}

/** Arguments of xcrun that write `module`'s symbol graph into `dir`. */
export function symbolGraphArgs(
  module: string,
  opts: IosOptions,
  sdk: string,
  dir: string,
): string[] {
  const args = [
    "swift-symbolgraph-extract",
    "-module-name",
    module,
    "-target",
    iosTarget(opts),
    "-sdk",
    sdk,
    "-output-dir",
    dir,
    "-minimum-access-level",
    "public",
  ];
  for (const i of opts.includePaths ?? []) args.push("-I", i);
  for (const f of opts.frameworkPaths ?? []) args.push("-F", f);
  for (const m of opts.moduleMaps ?? []) args.push("-Xcc", `-fmodule-map-file=${m}`);
  for (const d of opts.defines ?? []) args.push("-Xcc", `-D${d}`);
  return args;
}

export function symbolGraph(module: string, opts: IosOptions, sdk: string): SymbolGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-symbolgraph-"));
  const args = symbolGraphArgs(module, opts, sdk, dir);
  try {
    const r = spawnSync(opts.xcrun ?? "xcrun", args, { encoding: "utf8", maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new Error(`swift-symbolgraph-extract ${module}: ${r.stderr}`);
    return JSON.parse(
      fs.readFileSync(path.join(dir, `${module}.symbols.json`), "utf8"),
    ) as SymbolGraph;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- enum values from clang --------------------------------------------------------

/** Top-level JSON objects of clang's `-ast-dump=json -ast-dump-filter` output. */
function jsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}" && --depth === 0) out.push(JSON.parse(text.slice(start, i + 1)));
  }
  return out;
}

interface ClangNode {
  kind?: string;
  name?: string;
  value?: string;
  inner?: ClangNode[];
}

function constantValue(n: ClangNode): number | undefined {
  if (n.kind === "ConstantExpr" && n.value !== undefined) return Number(n.value);
  for (const c of n.inner ?? []) {
    const v = constantValue(c);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Values of the enumerators of each C enum, following C's rule for implicit ones. */
export function enumValues(
  enums: string[],
  headers: string[],
  opts: IosOptions,
  sdk: string,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (!enums.length) return out;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-enums-"));
  const source = path.join(dir, "enums.m");
  fs.writeFileSync(
    source,
    headers.map((h) => (path.isAbsolute(h) ? `#import "${h}"\n` : `#import <${h}>\n`)).join(""),
  );
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const clang = [
    opts.xcrun ?? "xcrun",
    "clang",
    "-x",
    "objective-c",
    "-target",
    iosTarget(opts),
    "-isysroot",
    sdk,
    ...(opts.includePaths ?? []).map((i) => `-I${i}`),
    ...(opts.frameworkPaths ?? []).map((f) => `-F${f}`),
    ...(opts.moduleMaps ?? []).map((m) => `-fmodule-map-file=${m}`),
    ...(opts.defines ?? []).map((d) => `-D${d}`),
    "-fsyntax-only",
    "-Xclang",
    "-ast-dump=json",
    "-Xclang",
    "-ast-dump-filter",
    "-Xclang",
  ]
    .map(q)
    .join(" ");
  // One clang run per enum, eight at a time.
  const lines = enums.map(
    (e, i) =>
      `${clang} ${q(e)} ${q(source)} > ${q(path.join(dir, `${e}.json`))} 2>/dev/null &${(i + 1) % 8 === 0 ? "\nwait" : ""}`,
  );
  fs.writeFileSync(path.join(dir, "run.sh"), `${lines.join("\n")}\nwait\n`);
  spawnSync("sh", [path.join(dir, "run.sh")], { encoding: "utf8" });
  for (const name of enums) {
    const file = path.join(dir, `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const decls = jsonObjects(fs.readFileSync(file, "utf8")) as ClangNode[];
    const hasCases = (d: ClangNode) =>
      d.kind === "EnumDecl" && !!d.inner?.some((c) => c.kind === "EnumConstantDecl");
    // A typedef of an anonymous enum dumps the enum without a name.
    const decl =
      decls.find((d) => hasCases(d) && d.name === name) ??
      decls.find((d) => hasCases(d) && !d.name);
    if (!decl) continue;
    const values = new Map<string, number>();
    let next = 0;
    for (const c of decl.inner ?? []) {
      if (c.kind !== "EnumConstantDecl" || !c.name) continue;
      const v = constantValue(c) ?? next;
      values.set(c.name, v);
      next = v + 1;
    }
    out.set(name, values);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

// --- extraction ----------------------------------------------------------------------

/** A C typedef's name from its USR: `c:@T@NSRange`, or `c:Measures.h@T@MSRRange` outside system headers. */
const typedefName = (usr: string) => /^c:[^@]*@T@(\w+)$/.exec(usr)?.[1];

/** Typedef name → USR, among these USRs. */
const typedefsAmong = (usrs: Iterable<string>) =>
  new Map(
    [...usrs].flatMap((u): [string, string][] => (typedefName(u) ? [[typedefName(u)!, u]] : [])),
  );

/** A C struct's fields, among its members: numbers, enums and structs. */
function structFields(
  members: SymbolGraphSymbol[],
  r: Resolver,
  kinds: Map<string, string>,
): SdkParam[] {
  const fields = members
    .filter((m) => m.kind.identifier === "swift.property" && structField(m.identifier.precise))
    .map((m) => {
      const type = parseType(propertyType(m.declarationFragments ?? []), r);
      const written = formatSchemaType(type);
      const nested = kinds.get(written) === "struct" || kinds.get(written) === "enum";
      if (
        !nested &&
        !/^(double|float|CGFloat|NSInteger|NSUInteger|u?int(8|16|32|64)|bool)$/.test(written)
      )
        throw new Unsupported(`struct field ${written}`);
      return { name: m.pathComponents[m.pathComponents.length - 1]!, type };
    });
  if (!fields.length) throw new Unsupported("struct without fields");
  return fields;
}

/** A C struct field's USR, synthesized onto the typedef (group 2) when Swift hides the struct's tag. */
const structField = (usr: string) => /^c:@SA?@\w+@FI@(\w+)(?:::SYNTHESIZED::(.+))?$/.exec(usr);

/**
 * The C structs a graph declares, by USR: `typedef struct {…} X` and
 * `struct X`, and typedefs of a struct whose tag Swift hides (NSRange's
 * `_NSRange`), which take the struct's fields as members.
 */
function cStructs(g: SymbolGraph): Map<string, { symbol: SymbolGraphSymbol; native: string }> {
  const byUsr = new Map(g.symbols.map((s) => [s.identifier.precise, s]));
  const out = new Map<string, { symbol: SymbolGraphSymbol; native: string }>();
  for (const s of g.symbols) {
    const usr = s.identifier.precise;
    const record = s.kind.identifier === "swift.struct" ? /^c:@SA?@(\w+)$/.exec(usr) : null;
    if (record) out.set(usr, { symbol: s, native: record[1]! });
    const typedef = structField(usr)?.[2];
    const symbol = typedef ? byUsr.get(typedef) : undefined;
    const native = typedef ? typedefName(typedef) : undefined;
    if (symbol && native) out.set(typedef!, { symbol, native });
  }
  return out;
}

export function extractIos(opts: IosOptions): SdkModuleSchema[] {
  const sdk = sdkInfo("path");
  const version = sdkInfo("version");
  const graphs = new Map(opts.modules.map((m) => [m, symbolGraph(m, opts, sdk)]));
  const schemas = buildIosSchemas(graphs, (enums) =>
    enumValues(
      enums,
      opts.modules.map((m) => `${m}/${m}.h`),
      opts,
      sdk,
    ),
  );

  // Where each module is: the SDK's, a Swift module or else a module map on the include paths.
  const sourceOf = (module: string): IosModuleSource => {
    if (fs.existsSync(path.join(sdk, "System/Library/Frameworks", `${module}.framework`)))
      return { kind: "sdk", files: [] };

    const swiftmodule = (opts.includePaths ?? [])
      .map((i) => path.join(i, `${module}.swiftmodule`))
      .find((f) => fs.existsSync(f));
    return swiftmodule
      ? { kind: "swift-module", files: [swiftmodule] }
      : { kind: "clang-module", files: [] };
  };

  return schemas.map((s) => ({
    ...s,
    provenance: iosProvenance(s.module, sourceOf(s.module), version, iosTarget(opts)),
  }));
}

/** What other modules need from a module's graph: its types' names, typealiases, typed string keys. */
export interface NamesIndex {
  module: string;
  /** Objective-C class/protocol/enum USR → schema reference (`Module.Name`). */
  refs: Record<string, string>;
  /** Typealias and typed-string-enum USR → the fragments they stand for. */
  aliases: Record<string, Fragment[]>;
  /**
   * Schema name → what the glue needs to use a type without its schema;
   * structs' fields too, when they are this module's types or numbers.
   */
  types: Record<
    string,
    {
      kind: "class" | "protocol" | "enum" | "struct";
      native: string;
      fields?: SdkParam[];
      cf?: boolean;
      /** A Swift-only type, called through shims: `native` is its Swift name. */
      swift?: boolean;
      /** How many type parameters it declares. */
      typeParams?: number;
      /** An enum that is an option set: 0 is its empty value. */
      options?: boolean;
      /** An Objective-C class's superclass, by USR. */
      inherits?: string;
      /** The Objective-C protocols a class conforms to, by USR, its superclasses' included. */
      conforms?: string[];
      /**
       * An Objective-C protocol's requirements, by Lucent name: `m:name` a
       * method, `p:name` a nullable and `pn:name` a non-null property, `s`
       * before a static one.
       */
      requires?: string[];
    }
  >;
}

const OPTION_SET = "s:s9OptionSetP";
const optionSetMemo = new WeakMap<SymbolGraph, Set<string>>();

/** The C enums Swift imports as option sets (NS_OPTIONS): they conform to OptionSet. */
function optionSets(g: SymbolGraph): Set<string> {
  let found = optionSetMemo.get(g);
  if (!found) {
    found = new Set(
      g.relationships
        .filter((r) => r.kind === "conformsTo" && r.target === OPTION_SET)
        .map((r) => r.source),
    );
    optionSetMemo.set(g, found);
  }

  return found;
}

export function namesOf(module: string, g: SymbolGraph): NamesIndex {
  const refs: Record<string, string> = {};
  const aliases: Record<string, Fragment[]> = {};
  const types: NamesIndex["types"] = {};
  const structs = cStructs(g);
  const lineage = classLineage(g);
  const requirements = protocolRequirements(g);
  // Structs with at least one field (`c:@SA@Name@FI@field`), by the record's
  // USR and by the typedef a synthesized field names.
  const hasFields = new Set<string>();
  for (const m of g.symbols) {
    const f = m.kind.identifier === "swift.property" ? structField(m.identifier.precise) : null;
    if (!f) continue;

    hasFields.add(m.identifier.precise.slice(0, m.identifier.precise.indexOf("@FI@")));
    if (f[2]) hasFields.add(f[2]);
  }

  for (const s of g.symbols) {
    const usr = s.identifier.precise;
    const k = s.kind.identifier;
    const name = s.pathComponents.join("_");
    const cls = objcClass(usr);
    if ((k === "swift.class" || k === "swift.protocol") && cls) {
      refs[usr] = `${module}.${name}`;
      types[name] = { kind: k === "swift.class" ? "class" : "protocol", native: cls[2]! };
      const n = s.swiftGenerics?.parameters?.length;
      if (n) types[name]!.typeParams = n;

      const reqs = k === "swift.protocol" ? requirements.get(usr) : undefined;
      if (reqs?.length) types[name]!.requires = reqs;

      const line = k === "swift.class" ? lineage.get(usr) : undefined;
      if (line?.inherits) types[name]!.inherits = line.inherits;
      if (line?.conforms.length) types[name]!.conforms = line.conforms;
    }
    // Opaque CoreFoundation-style handles: typedefs of pointers to bridged structs.
    const handle = k === "swift.class" ? typedefName(usr) : undefined;
    if (handle) {
      refs[usr] = `${module}.${name}`;
      types[name] = { kind: "class", native: handle, cf: true };
    }
    // C enums, named (c:@E@) or typedefs of anonymous ones (c:@EA@).
    const cEnum = k === "swift.enum" || k === "swift.struct" ? /^c:@EA?@(\w+)$/.exec(usr) : null;
    if (cEnum) {
      refs[usr] = `${module}.${name}`;
      types[name] = {
        kind: "enum",
        native: cEnum[1]!,
        ...(optionSets(g).has(usr) ? { options: true } : {}),
      };
    }
    // A struct without fields is never declared (buildIosSchema skips it).
    const record = structs.get(usr);
    if (record && hasFields.has(usr)) {
      refs[usr] = `${module}.${name}`;
      types[name] = { kind: "struct", native: record.native };
    }
    if (k === "swift.typealias" && !record) {
      const eq = (s.declarationFragments ?? []).findIndex((f) => f.spelling.includes("="));
      if (eq >= 0)
        aliases[usr] = [
          {
            kind: "text",
            spelling: (s.declarationFragments![eq]!.spelling.split("=")[1] ?? "").trim(),
          },
          ...s.declarationFragments!.slice(eq + 1),
        ];
    }
    // Typed string enums (NS_TYPED_ENUM): strings at the boundary.
    if (k === "swift.struct" && /^c:.*@T@/.test(usr))
      aliases[usr] = [{ kind: "typeIdentifier", spelling: "String", preciseIdentifier: "s:SS" }];
  }
  // Swift types (structs, classes, enums, protocols), called through shims;
  // a protocol's associated types are its type parameters.
  const associated = associatedTypesOf(g);
  for (const [s, kind] of swiftTypeKinds(g, (usr) => bridgedSwiftType(usr) || usr in aliases)) {
    const name = s.pathComponents.join("_");
    refs[s.identifier.precise] = `${module}.${name}`;
    types[name] = { kind, native: swiftName(module, s), swift: true };
    const n =
      kind === "protocol"
        ? associated.get(s.identifier.precise)?.length
        : s.swiftGenerics?.parameters?.length;
    if (n) types[name]!.typeParams = n;
  }
  // Swift value types that bridge to Objective-C classes (IndexPath): the class their ReferenceType names.
  const bridged = new Set(
    g.relationships
      .filter((r) => r.kind === "conformsTo" && r.target === REFERENCE_CONVERTIBLE)
      .map((r) => r.source),
  );
  const byUsr = new Map(g.symbols.map((s) => [s.identifier.precise, s]));
  for (const r of g.relationships) {
    const member = byUsr.get(r.source);
    if (
      r.kind !== "memberOf" ||
      !bridged.has(r.target) ||
      member?.kind.identifier !== "swift.typealias" ||
      member.pathComponents.at(-1) !== "ReferenceType"
    )
      continue;
    const cls = member.declarationFragments?.find(
      (f) => f.kind === "typeIdentifier" && objcClass(f.preciseIdentifier ?? ""),
    );
    if (cls) aliases[r.target] = [cls];
  }
  const members = new Map<string, SymbolGraphSymbol[]>();
  for (const r of g.relationships)
    if (r.kind === "memberOf" && byUsr.has(r.source))
      members.set(r.target, [...(members.get(r.target) ?? []), byUsr.get(r.source)!]);
  const kinds = new Map(
    Object.entries(types).map(([name, t]): [string, string] => [`${module}.${name}`, t.kind]),
  );
  const typedefs = typedefsAmong([...Object.keys(refs), ...Object.keys(aliases)]);
  const own: Resolver = {
    ref: (u) => refs[u],
    alias: (u) => aliases[u],
    typedef: (n) => typedefs.get(n),
  };
  for (const [usr, { symbol }] of structs) {
    try {
      types[symbol.pathComponents.join("_")]!.fields = structFields(
        members.get(usr) ?? [],
        own,
        kinds,
      );
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
    }
  }
  return { module, refs, aliases, types };
}

/** USRs a graph refers to but does not declare: types of other modules. */
export function externalUsrs(g: SymbolGraph): Set<string> {
  const declared = new Set(g.symbols.map((s) => s.identifier.precise));
  const out = new Set<string>();
  const visit = (frags: Fragment[] | undefined) => {
    for (const f of frags ?? []) {
      // Swift leaves the USR off some references to C typedefs (NSRange); the owner is found by name.
      const usr =
        f.preciseIdentifier ?? (f.kind === "typeIdentifier" ? `c:@T@${f.spelling}` : undefined);
      if (!usr) continue;
      if (/^[cs]:/.test(usr) && !declared.has(usr)) out.add(usr);
    }
  };
  for (const s of g.symbols) {
    visit(s.declarationFragments);
    for (const p of s.functionSignature?.parameters ?? []) visit(p.declarationFragments);
    visit(s.functionSignature?.returns);
  }
  for (const r of g.relationships)
    if (r.target.startsWith("c:") && !declared.has(r.target)) out.add(r.target);
  return out;
}

/** The schemas for symbol graphs; `values` looks up enum values by C enum name. */
export function buildIosSchemas(
  graphs: Map<string, SymbolGraph>,
  values: (enums: string[]) => Map<string, Map<string, number>>,
): SdkModuleSchema[] {
  const names = [...graphs].map(([m, g]) => namesOf(m, g));
  return [...graphs].map(([m, g]) => buildIosSchema(m, g, names, values));
}

/**
 * A class with factory initializers that inherits its others: TypeScript
 * hides a superclass's constructors once a class declares any, so the
 * ones it inherits are declared on it too, as Swift keeps them
 * (`UICollectionViewLayout`'s beside a factory's): its superclasses' in
 * this module. A root class gets NSObject's init where it is built;
 * superclasses of other modules' stay hidden. A superclass is settled
 * before its subclasses read it, so a class gets what its superclass
 * inherits too, whichever order the symbol graph gives them in.
 */
export function withInheritedInitializers(mod: SdkModuleSchema): void {
  const classes = new Map(
    mod.types.filter((t): t is SdkClassSchema => t.kind === "class").map((c) => [c.name, c]),
  );
  const settled = new Set<SdkClassSchema>();

  const settle = (cls: SdkClassSchema): void => {
    if (settled.has(cls)) return;
    settled.add(cls);

    if (!cls.inheritsInit || !cls.constructors?.length) return;

    let inherited: SdkCallable[] | undefined;
    for (let at = cls.extends, depth = 0; at && depth < 64 && !inherited; depth++) {
      const [owner, ...rest] = at.split(".");
      const sup = owner === mod.module ? classes.get(rest.join(".")) : undefined;
      if (!sup) break;

      settle(sup);

      const own = (sup.constructors ?? []).filter((c) => !c.factory);
      if (own.length) inherited = own;
      else if (!sup.inheritsInit) break;
      at = sup.extends;
    }

    if (inherited) {
      cls.constructors.push(...inherited.map((c) => ({ ...c })));
      delete cls.inheritsInit;
    }
  };

  for (const cls of classes.values()) settle(cls);
}

/**
 * A property a subclass redeclares without a nullability contract of its own
 * (`T!`: unaudited or null_resettable) keeps its superclass's non-null one:
 * reading it never gives nil. Superclasses in the same module only.
 */
function keepInheritedNonNull(mod: SdkModuleSchema, unaudited: Set<SdkPropertySchema>): void {
  const classes = new Map(
    mod.types.filter((t): t is SdkClassSchema => t.kind === "class").map((c) => [c.name, c]),
  );

  const inheritedNonNull = (cls: SdkClassSchema, p: SdkPropertySchema): boolean => {
    for (let at = cls.extends, depth = 0; at && depth < 64; depth++) {
      const [owner, ...rest] = at.split(".");
      if (owner !== mod.module) return false;

      const sup = classes.get(rest.join("."));
      const same = sup?.properties?.find((x) => x.name === p.name && !!x.static === !!p.static);
      if (same) return !same.type.nullable;

      at = sup?.extends;
    }

    return false;
  };

  for (const cls of classes.values())
    for (const p of cls.properties ?? [])
      if (unaudited.has(p) && p.type.nullable && inheritedNonNull(cls, p))
        p.type = { ...p.type, nullable: false };
}

/**
 * One name is a property or a method throughout a type hierarchy (as the
 * rule within one class already says: a method named like a property is left
 * out). A method named like a superclass's property is left out; a protocol
 * whose requirement the class declares as the other kind, or with another
 * type, is not declared as a conformance (its members stay callable).
 * Superclasses and protocols in the same module only.
 */
function resolveMemberKinds(mod: SdkModuleSchema, names: NamesIndex[]): void {
  const classes = new Map(
    mod.types.filter((t): t is SdkClassSchema => t.kind === "class").map((c) => [c.name, c]),
  );
  const local = (ref: string | undefined) => {
    const [owner, ...rest] = (ref ?? "").split(".");
    return owner === mod.module ? classes.get(rest.join(".")) : undefined;
  };

  // A class's properties, its own and its superclasses', by static-ness and name.
  const properties = (cls: SdkClassSchema) => {
    const out = new Map<string, SdkPropertySchema>();
    for (let c: SdkClassSchema | undefined = cls, depth = 0; c && depth < 64; depth++) {
      for (const p of c.properties ?? []) {
        const key = `${!!p.static}:${p.name}`;
        if (!out.has(key)) out.set(key, p);
      }
      c = local(c.extends);
    }
    return out;
  };

  const methodNames = (cls: SdkClassSchema) => {
    const out = new Set<string>();
    for (let c: SdkClassSchema | undefined = cls, depth = 0; c && depth < 64; depth++) {
      for (const m of c.methods ?? []) out.add(`${!!m.static}:${m.name}`);
      c = local(c.extends);
    }
    return out;
  };

  // Another module's protocol, known by its names index's requirements.
  const foreignClash = (
    ref: string,
    props: Map<string, SdkPropertySchema>,
    methods: Set<string>,
    cls: SdkClassSchema,
  ): boolean => {
    const dot = ref.lastIndexOf(".");
    const requires = names.find((n) => n.module === ref.slice(0, dot))?.types[ref.slice(dot + 1)]
      ?.requires;

    const clash = requires?.find((r) => {
      const [kind, name] = r.split(":") as [string, string];
      const isStatic = kind.startsWith("s");
      const key = `${isStatic}:${name}`;
      const own = props.get(key);

      if (kind.endsWith("m")) return !!own;
      return methods.has(key) || (kind.endsWith("pn") && !!own?.type.nullable);
    });
    if (!clash) return false;

    mod.skipped!.push(
      `${cls.name}: conforms to ${ref.slice(dot + 1)}, whose ${clash.split(":")[1]} it declares differently: not declared as ${ref.slice(dot + 1)}`,
    );
    return true;
  };

  for (const cls of classes.values()) {
    if (cls.interface) continue;

    // Methods named like a superclass's property take their labels, as beside
    // the class's own (count(for:) → countFor); one without labels is left out.
    const inherited = local(cls.extends) ? properties(local(cls.extends)!) : new Map();
    const kept = (cls.methods ?? []).filter((m) => {
      const p = inherited.get(`${!!m.static}:${m.name}`);
      if (!p) return true;

      const labeled = withLabels(m);
      if (labeled !== m.name) {
        m.name = labeled;
        return true;
      }

      const owner = [...classes.values()].find((c) => c.properties?.includes(p));
      mod.skipped!.push(
        `${cls.name}.${m.name}: named like ${owner?.name ?? "a superclass"}.${p.name}, a property`,
      );
      return false;
    });
    if (cls.methods) {
      cls.methods = kept;
      disambiguate(cls.methods);
    }

    // Protocols whose requirements it declares as the other kind, or with another type.
    if (!cls.implements?.length) continue;

    const props = properties(cls);
    const methods = methodNames(cls);
    cls.implements = cls.implements.filter((ref) => {
      const protocol = local(ref);
      if (!protocol) return !foreignClash(ref, props, methods, cls);

      const clash =
        (protocol.methods ?? []).find((m) => props.has(`${!!m.static}:${m.name}`))?.name ??
        (protocol.properties ?? []).find((p) => {
          const own = props.get(`${!!p.static}:${p.name}`);
          // Nullable where the requirement is not: the one type difference
          // TypeScript cannot accept (a narrower type is fine).
          const nullableForNonNull =
            !!own &&
            own.type.nullable &&
            !p.type.nullable &&
            formatSchemaType({ ...own.type, nullable: false }) ===
              formatSchemaType({ ...p.type, nullable: false });

          return methods.has(`${!!p.static}:${p.name}`) || nullableForNonNull;
        })?.name;
      if (!clash) return true;

      mod.skipped!.push(
        `${cls.name}: conforms to ${protocol.name}, whose ${clash} it declares differently: not declared as ${protocol.name}`,
      );
      return false;
    });
    if (!cls.implements.length) delete cls.implements;
  }
}

/** Each Objective-C class's superclass and the protocols it conforms to, by USR, from the graph's relationships. */
function classLineage(g: SymbolGraph): Map<string, { inherits?: string; conforms: string[] }> {
  const out = new Map<string, { inherits?: string; conforms: string[] }>();
  const of = (usr: string) => {
    let e = out.get(usr);
    if (!e) out.set(usr, (e = { conforms: [] }));
    return e;
  };

  for (const r of g.relationships) {
    if (!r.source.startsWith("c:objc(cs)")) continue;

    if (r.kind === "inheritsFrom") of(r.source).inherits = r.target;
    else if (r.kind === "conformsTo" && r.target.startsWith("c:objc(pl)")) {
      const e = of(r.source);
      if (!e.conforms.includes(r.target)) e.conforms.push(r.target);
    }
  }

  // In no stable order in the graph.
  for (const e of out.values()) e.conforms.sort();

  return out;
}

/** Each Objective-C protocol's requirements, encoded as NamesIndex `requires` says. */
function protocolRequirements(g: SymbolGraph): Map<string, string[]> {
  const byUsr = new Map(g.symbols.map((x) => [x.identifier.precise, x]));
  const out = new Map<string, string[]>();

  for (const r of g.relationships) {
    if (r.kind !== "requirementOf" && r.kind !== "optionalRequirementOf") continue;
    if (!r.target.startsWith("c:objc(pl)")) continue;

    const m = byUsr.get(r.source);
    if (!m) continue;

    const k = m.kind.identifier;
    const isStatic = k === "swift.type.property" || k === "swift.type.method" ? "s" : "";
    let entry: string | undefined;

    if (k === "swift.property" || k === "swift.type.property") {
      const text = propertyType(m.declarationFragments ?? [])
        .map((f) => f.spelling)
        .join("");
      entry = `${isStatic}${/[?!]\s*$/.test(text) ? "p" : "pn"}:${m.names.title}`;
    } else if (k === "swift.method" || k === "swift.type.method") {
      // Named as Lucent names protocol requirements: base and labels.
      const { base, labels } = splitName(m.names.title);
      entry = `${isStatic}m:${[base, ...labels.filter((l) => l !== "_")].join("_")}`;
    }

    if (!entry) continue;
    const list = out.get(r.target) ?? [];
    if (!list.includes(entry)) list.push(entry);
    out.set(r.target, list);
  }

  return out;
}

/**
 * The protocols (by USR) a class's superclasses conform to, from the names of
 * every module the schema refers to: what a class inherits, so its schema
 * lists only the protocols it adopts itself.
 */
function inheritedConformances(
  classUsr: string,
  lineage: Map<string, { inherits?: string; conforms?: string[] }>,
): Set<string> {
  const out = new Set<string>();

  for (let usr = lineage.get(classUsr)?.inherits, seen = 0; usr && seen < 64; seen++) {
    const line = lineage.get(usr);
    for (const p of line?.conforms ?? []) out.add(p);
    usr = line?.inherits;
  }

  return out;
}

/**
 * One module's schema from its graph and the names of every module it
 * refers to (its own included).
 */
export function buildIosSchema(
  module: string,
  g: SymbolGraph,
  names: NamesIndex[],
  values: (enums: string[]) => Map<string, Map<string, number>>,
  /** C function name → the Swift name it is imported under (see cSwiftNames). */
  importedNames: ReadonlyMap<string, string> = new Map(),
): SdkModuleSchema {
  const refs = new Map<string, string>(names.flatMap((n) => Object.entries(n.refs)));
  const aliases = new Map<string, Fragment[]>(names.flatMap((n) => Object.entries(n.aliases)));

  // Properties Swift imports as `T!`, which may keep a superclass's non-null contract.
  const unaudited = new Set<SdkPropertySchema>();

  // Every known class's superclass and conformances, this module's and those it refers to.
  const lineage = new Map<string, { inherits?: string; conforms?: string[] }>();
  for (const n of names)
    for (const [usr, ref] of Object.entries(n.refs)) {
      const t = n.types[ref.slice(ref.lastIndexOf(".") + 1)];
      if (t?.kind === "class" && (t.inherits || t.conforms)) lineage.set(usr, t);
    }
  for (const [usr, line] of classLineage(g)) if (!lineage.has(usr)) lineage.set(usr, line);

  const kinds = new Map<string, string>(
    names.flatMap((n) =>
      Object.entries(n.types).map(([name, t]): [string, string] => [`${n.module}.${name}`, t.kind]),
    ),
  );
  {
    const mod: SdkModuleSchema = {
      format: SCHEMA_FORMAT,
      platform: "ios",
      module,
      frameworks: [module],
      types: [],
      skipped: [],
    };
    const members = new Map<string, SymbolGraphSymbol[]>();
    // Several symbols can share a USR: a completion-handler method and its async form.
    const symbolsOf = new Map<string, SymbolGraphSymbol[]>();
    for (const s of g.symbols)
      symbolsOf.set(s.identifier.precise, [...(symbolsOf.get(s.identifier.precise) ?? []), s]);
    for (const rel of g.relationships) {
      if (
        rel.kind !== "memberOf" &&
        rel.kind !== "requirementOf" &&
        rel.kind !== "optionalRequirementOf"
      )
        continue;
      const list = members.get(rel.target) ?? [];
      for (const sym of symbolsOf.get(rel.source) ?? []) if (!list.includes(sym)) list.push(sym);
      members.set(rel.target, list);
    }
    const byUsr = new Map(g.symbols.map((s) => [s.identifier.precise, s]));
    const typedefs = typedefsAmong([...refs.keys(), ...aliases.keys()]);
    const resolver = (
      self?: string,
      mainActor?: boolean,
      typeParams?: readonly string[],
    ): Resolver => ({
      ref: (u) => refs.get(u),
      alias: (u) => aliases.get(u),
      typedef: (n) => typedefs.get(n),
      self,
      mainActor,
      typeParams,
    });
    const skip = (owner: string, s: SymbolGraphSymbol, reason: string) =>
      mod.skipped!.push(`${owner}.${s.names.title}: ${reason}`);

    // Enums and options.
    const cEnumName = (s: SymbolGraphSymbol) =>
      s.kind.identifier === "swift.enum" || s.kind.identifier === "swift.struct"
        ? /^c:@EA?@(\w+)$/.exec(s.identifier.precise)?.[1]
        : undefined;
    const enumSyms = g.symbols.filter((s) => cEnumName(s) !== undefined);
    const cNames = enumSyms.map((s) => cEnumName(s)!);
    const enumValueMap = values(cNames);
    for (const s of enumSyms) {
      const cName = cEnumName(s)!;
      // A named enum's cases are its members; an anonymous one's are global values under its USR.
      const anonymous = s.identifier.precise.startsWith("c:@EA@");
      const candidates = anonymous
        ? g.symbols.filter((m) => m.kind.identifier === "swift.var")
        : (members.get(s.identifier.precise) ?? []);
      const cases = candidates
        .filter(
          (m) => m.identifier.precise.startsWith(`${s.identifier.precise}@`) && !unavailable(m),
        )
        .map((m) => {
          const native = m.identifier.precise.slice(s.identifier.precise.length + 1);
          return {
            name: m.pathComponents[m.pathComponents.length - 1]!,
            native,
            value: enumValueMap.get(cName)?.get(native),
          };
        });
      if (cases.some((c) => c.value === undefined)) {
        mod.skipped!.push(`${s.pathComponents.join(".")}: enum values unknown`);
        continue;
      }
      // Global values come in the graph's order: an anonymous enum's cases go by value.
      if (anonymous) cases.sort((a, b) => a.value! - b.value!);
      const e: SdkEnumSchema = {
        kind: "enum",
        name: s.pathComponents.join("_"),
        native: cName,
        symbol: graphSymbol(s.identifier.precise),
        cases: cases as SdkEnumSchema["cases"],
        ...(optionSets(g).has(s.identifier.precise) ? { options: true as const } : {}),
      };
      mod.types.push(e);
    }

    // C structs: their fields, numbers, enums and structs.
    for (const [usr, { symbol: s, native }] of cStructs(g)) {
      if (unavailable(s)) continue;
      const name = s.pathComponents.join("_");
      try {
        mod.types.push({
          kind: "struct",
          name,
          native,
          symbol: graphSymbol(usr),
          fields: structFields(members.get(usr) ?? [], resolver(), kinds),
        });
      } catch (e) {
        if (e instanceof Unsupported) mod.skipped!.push(`${name}: ${e.message}`);
        else throw e;
      }
    }

    // Typed string keys (NS_TYPED_ENUM): string constants read from their C globals.
    for (const s of g.symbols) {
      if (
        s.kind.identifier !== "swift.struct" ||
        !/^c:.*@T@/.test(s.identifier.precise) ||
        unavailable(s)
      )
        continue;
      const props: SdkPropertySchema[] = [];
      for (const mem of members.get(s.identifier.precise) ?? []) {
        const global = /^c:@([A-Za-z_]\w*)$/.exec(mem.identifier.precise)?.[1];
        if (!global || mem.kind.identifier !== "swift.type.property" || unavailable(mem)) continue;
        props.push({
          name: mem.pathComponents[mem.pathComponents.length - 1]!,
          static: true,
          readonly: true,
          type: parseSchemaType("string"),
          global,
          symbol: graphSymbol(mem.identifier.precise),
        });
      }
      if (props.length)
        mod.types.push({
          kind: "class",
          name: s.pathComponents.join("_"),
          native: s.identifier.precise.replace(/^.*@T@/, ""),
          symbol: graphSymbol(s.identifier.precise),
          properties: props,
        });
    }

    /**
     * The C functions Swift imports as members of handle `cls`, read from
     * its Swift members whose USR is a C function's: properties (their
     * getter, and setter where one is named), methods taking the object
     * where their Swift name says, initializers. A failable initializer, or
     * a function whose Swift name is not known, is left out, said why.
     */
    const cfMembers = (
      cls: SdkClassSchema,
      list: SymbolGraphSymbol[],
      setters: ReadonlyMap<string, string>,
    ) => {
      const r = resolver();
      for (const mem of list) {
        const fn = /^c:@F@(\w+)$/.exec(mem.identifier.precise)?.[1];
        if (!fn || unavailable(mem)) continue;

        const imported = importedNames.get(fn);
        const member = imported ? swiftMemberOf(imported) : undefined;
        const symbol = graphSymbol(mem.identifier.precise);
        const v = since(mem);
        try {
          if (!member)
            throw new Unsupported(`${fn}'s Swift name is in no API notes or header Lucent reads`);
          const k = mem.kind.identifier;
          if (k === "swift.property" || k === "swift.type.property") {
            if (member.kind !== "getter") continue;
            const setter = setters.get(`${member.type}.${member.name}`);
            const p: SdkPropertySchema = {
              name: mem.names.title,
              type: parseType(propertyType(mem.declarationFragments ?? []), r),
              cFunctions: { getter: fn, ...(setter ? { setter } : {}) },
              symbol,
            };
            if (!setter) p.readonly = true;
            if (member.self === undefined) p.static = true;
            if (v && v !== cls.since) p.since = v;
            (cls.properties ??= []).push(p);
            continue;
          }

          const sig = mem.functionSignature;
          const params = (sig?.parameters ?? []).map((pp) => ({
            name: pp.internalName ?? pp.name,
            type: parseType(afterColon(pp.declarationFragments), r),
          }));
          if (k === "swift.init") {
            if (/\binit\?/.test(declText(mem))) throw new Unsupported("a failable initializer");
            const c: SdkCallable = { params, cFunction: { name: fn }, symbol };
            if (v && v !== cls.since) c.since = v;
            (cls.constructors ??= []).push(c);
            continue;
          }
          if (k !== "swift.method" && k !== "swift.type.method") continue;

          const m: SdkMethodSchema = {
            name: splitName(mem.names.title).base,
            params,
            returns: sig?.returns?.length ? parseType(sig.returns, r) : parseSchemaType("void"),
            cFunction: { name: fn, ...(member.self !== undefined ? { self: member.self } : {}) },
            symbol,
          };
          if (member.self === undefined) m.static = true;
          if (v && v !== cls.since) m.since = v;
          (cls.methods ??= []).push(m);
        } catch (e) {
          if (e instanceof Unsupported) skip(cls.name, mem, e.message);
          else throw e;
        }
      }
      if (cls.methods) disambiguate(cls.methods);
    };

    // Opaque CoreFoundation-style handles, passed through as they are, with the C functions
    // Swift imports as their members (`CGImageGetWidth` as `CGImage.width`).
    const setters = new Map<string, string>();
    for (const [fn, imported] of importedNames) {
      const member = swiftMemberOf(imported);
      if (member?.kind === "setter") setters.set(`${member.type}.${member.name}`, fn);
    }
    for (const s of g.symbols) {
      const handle =
        s.kind.identifier === "swift.class" ? typedefName(s.identifier.precise) : undefined;
      if (!handle || unavailable(s)) continue;

      const name = s.pathComponents.join("_");
      const cls: SdkClassSchema = {
        kind: "class",
        name,
        native: handle,
        cf: true,
        symbol: graphSymbol(s.identifier.precise),
      };
      cfMembers(cls, members.get(s.identifier.precise) ?? [], setters);
      mod.types.push(cls);
    }

    // Classes and protocols.
    const objcClasses = new Map<string, SdkClassSchema>();
    for (const s of g.symbols) {
      const k = s.kind.identifier;
      const m = objcClass(s.identifier.precise);
      if (!m || (k !== "swift.class" && k !== "swift.protocol") || unavailable(s)) continue;
      const name = s.pathComponents.join("_");
      const self = `${module}.${name}`;
      const cls: SdkClassSchema = {
        kind: "class",
        name,
        native: m[2]!,
        symbol: graphSymbol(s.identifier.precise),
      };
      objcClasses.set(s.identifier.precise, cls);
      if (k === "swift.protocol") cls.interface = true;
      const classFacts = mainActorFacts(declText(s));
      if (classFacts) cls.facts = classFacts;
      Object.assign(cls, classThreadFlags(cls.facts));
      const typeParams = s.swiftGenerics?.parameters?.map((x) => x.name) ?? [];
      if (typeParams.length) cls.typeParams = typeParams;
      const v = since(s);
      if (v) cls.since = v;
      const superUsr = g.relationships.find(
        (r) => r.kind === "inheritsFrom" && r.source === s.identifier.precise,
      )?.target;
      if (superUsr && refs.has(superUsr)) cls.extends = refs.get(superUsr);
      // Only the protocols it adopts itself: its superclasses' come with `extends`.
      // Sorted: swift-symbolgraph-extract writes them in no stable order.
      const inherited = inheritedConformances(s.identifier.precise, lineage);
      const conforms = [
        ...new Set(
          g.relationships
            .filter(
              (r) =>
                r.kind === "conformsTo" &&
                r.source === s.identifier.precise &&
                r.target.startsWith("c:objc(pl)") &&
                !inherited.has(r.target) &&
                refs.has(r.target),
            )
            .map((r) => refs.get(r.target)!),
        ),
      ].sort();
      if (conforms.length) cls.implements = conforms;

      const ctors: SdkCallable[] = [];
      const methods: SdkMethodSchema[] = [];
      const props: SdkPropertySchema[] = [];
      const seenUsr = new Set<string>();
      let initUnavailable = false;
      // Optional protocol requirements.
      const optionalUsrs = new Set(
        g.relationships
          .filter(
            (rel) => rel.kind === "optionalRequirementOf" && rel.target === s.identifier.precise,
          )
          .map((rel) => rel.source),
      );
      // Completion-handler methods Swift imports a second time as async.
      const asyncTwins = new Map(
        (members.get(s.identifier.precise) ?? [])
          .filter((mem) => /\basync\b/.test(declText(mem)))
          .map((mem) => [mem.identifier.precise, mem]),
      );
      for (const mem of members.get(s.identifier.precise) ?? []) {
        const mm = objcMember(mem.identifier.precise);
        if (mm && unavailable(mem) && mem.kind.identifier === "swift.init") initUnavailable = true;
        // Synthesized from a protocol the class conforms to (initWithCoder: from
        // NSCoding): the protocol has the requirement, and the USR is no selector.
        if (!mm || unavailable(mem) || mem.identifier.precise.includes("::SYNTHESIZED::")) continue;
        const text = declText(mem);
        // The async form of a completion-handler method: read with the handler form.
        if (/\basync\b/.test(text)) continue;
        // Attributes of the member itself, not of its parameters' blocks.
        const head = text.slice(0, Math.max(0, text.search(/\b(func|init|var|subscript)\b/)));
        if (seenUsr.has(mem.identifier.precise)) continue;
        seenUsr.add(mem.identifier.precise);
        const kind = mm[3]!;
        const selector = mm[4]!;
        const facts = mainActorFacts(head);
        const main = memberFacts(cls, { facts }).affinity === "main";
        const r = resolver(self, main, typeParams);
        const memberSince = since(mem);
        const symbol = graphSymbol(mem.identifier.precise);
        // Its own attribute's facts, and the flags that follow from them and its class's.
        const thread = { ...(facts ? { facts } : {}), ...memberThreadFlags(cls.facts, facts) };

        try {
          if (kind === "py" || kind === "cpy") {
            const typeFrags = propertyType(mem.declarationFragments ?? []);
            const p: SdkPropertySchema = {
              name: mem.names.title,
              type: parseType(typeFrags, r),
              symbol,
            };

            // `T!`: unaudited or null_resettable, not an explicit optional.
            if (/!\s*$/.test(typeFrags.map((f) => f.spelling).join(""))) unaudited.add(p);

            if (kind === "cpy") p.static = true;
            const readonly = !/\bset\b/.test(text);
            if (readonly) p.readonly = true;
            if (mem.names.title !== selector)
              p.selector =
                selector === mem.names.title
                  ? undefined
                  : getterSelector(mem.names.title, selector);
            if (p.selector === undefined) delete p.selector;
            if (!readonly) p.setter = `set${selector.charAt(0).toUpperCase()}${selector.slice(1)}:`;
            if (/\bweak\b/.test(head)) p.weak = true;
            if (memberSince && memberSince !== cls.since) p.since = memberSince;
            Object.assign(p, thread);
            props.push(p);
            continue;
          }
          const sig = mem.functionSignature;
          const escaping = escapingParams(mem);
          const params = (sig?.parameters ?? []).map((pp, i) => ({
            name: pp.internalName ?? pp.name,
            type: withEscaping(parseType(afterColon(pp.declarationFragments), r), escaping[i]),
          }));
          if (mem.kind.identifier === "swift.init") {
            // A class method Swift imports as an initializer: sent to the class.
            const c: SdkCallable = {
              params,
              selector,
              ...(kind === "cm" ? { factory: true as const } : {}),
              symbol,
            };
            if (facts) c.facts = facts;
            if (memberSince && memberSince !== cls.since) c.since = memberSince;
            ctors.push(c);
            continue;
          }
          const returns = sig?.returns?.length
            ? parseType(sig.returns, r)
            : parseSchemaType("void");
          const { base, labels } = splitName(mem.names.title);
          // Protocol requirements, which Lucent classes implement, are named
          // from their own Swift name: base and labels, as in the selector.
          const name = cls.interface ? [base, ...labels.filter((l) => l !== "_")].join("_") : base;
          const method: SdkMethodSchema = { name, selector, params, returns, symbol };
          if (optionalUsrs.has(mem.identifier.precise)) method.optional = true;
          if (kind === "cm") method.static = true;
          if (/\bthrows\b/.test(text)) method.throws = true;
          if (memberSince && memberSince !== cls.since) method.since = memberSince;
          Object.assign(method, thread);
          const twin = asyncTwins.get(mem.identifier.precise);
          if (twin) {
            try {
              const tr = twin.functionSignature?.returns;
              const settled = tr?.length ? parseType(tr, r) : parseSchemaType("void");
              // Several results (a tuple): a completion handler's arguments, not one value.
              if (settled.k === "tuple") throw new Unsupported("tuples");
              method.async = { returns: settled };
              if (/\bthrows\b/.test(declText(twin))) method.async.throws = true;
              const asyncName = splitName(twin.names.title).base;
              if (asyncName !== base) method.async.name = asyncName;
            } catch (e) {
              // Several results (a tuple): the block form only.
              if (!(e instanceof Unsupported)) throw e;
            }
          }
          (method as SdkMethodSchema & { swiftName?: string }).swiftName = mem.names.title;
          methods.push(method);
        } catch (e) {
          if (e instanceof Unsupported) skip(name, mem, e.message);
          else throw e;
        }
      }
      if (cls.interface) {
        // Names from the requirement alone: a clash is skipped, never renamed.
        const seen = new Set<string>();
        // oxlint-disable-next-line unicorn/no-useless-spread -- the loop splices methods
        for (const x of [...methods]) {
          if (!seen.has(`${!!x.static}:${x.name}`)) seen.add(`${!!x.static}:${x.name}`);
          else {
            mod.skipped!.push(`${name}.${x.name}: another requirement has this name`);
            methods.splice(methods.indexOf(x), 1);
          }
        }
      } else {
        // A method named as one of the class's properties keeps its labels; the
        // property keeps the name (UIView's frame, frameForAlignmentRect).
        const taken = new Set(props.map((x) => `${!!x.static}:${x.name}`));
        for (const x of methods) if (taken.has(`${!!x.static}:${x.name}`)) x.name = withLabels(x);
        disambiguate(methods);
      }
      // Kept for the module-wide pass, which may label a method again.
      for (const x of methods) {
        const swiftName = (x as SdkMethodSchema & { swiftName?: string }).swiftName;
        if (swiftName) swiftNames.set(x, swiftName);
        delete (x as SdkMethodSchema & { swiftName?: string }).swiftName;
      }
      // Objective-C initializers are inherited (NSObject's init at the root)
      // unless the class makes init unavailable; factory initializers aside.
      if (!ctors.some((c) => !c.factory) && !initUnavailable && k === "swift.class") {
        if (cls.extends) cls.inheritsInit = true;
        else ctors.push({ params: [], selector: "init" });
      }
      if (ctors.length) cls.constructors = ctors;
      if (methods.length) cls.methods = methods;
      if (props.length) cls.properties = props;
      mod.types.push(cls);
    }

    // C functions and constants.
    for (const s of g.symbols) {
      const usr = s.identifier.precise;
      if (unavailable(s)) continue;
      try {
        if (s.kind.identifier === "swift.func" && usr.startsWith("c:@F@")) {
          const sig = s.functionSignature;
          const escaping = escapingParams(s);
          const params = (sig?.parameters ?? []).map((pp, i) => ({
            name: pp.internalName ?? pp.name,
            type: withEscaping(
              parseType(afterColon(pp.declarationFragments), resolver()),
              escaping[i],
            ),
          }));
          const f: SdkMethodSchema = {
            name: s.names.title.replace(/\(.*$/, ""),
            params,
            returns: sig?.returns?.length
              ? parseType(sig.returns, resolver())
              : parseSchemaType("void"),
            symbol: graphSymbol(usr),
          };
          const v = since(s);
          if (v) f.since = v;
          (mod.functions ??= []).push(f);
        } else if (s.kind.identifier === "swift.var" && /^c:@[^@]+$/.test(usr)) {
          const c: SdkPropertySchema = {
            name: s.names.title,
            type: parseType(afterColon(s.declarationFragments ?? []), resolver()),
            symbol: graphSymbol(usr),
          };
          (mod.constants ??= []).push(c);
        }
      } catch (e) {
        if (e instanceof Unsupported) skip(module, s, e.message);
        else throw e;
      }
    }
    // Swift-only types and members: called through shims.
    addSwiftDeclarations({
      module,
      g,
      mod,
      members,
      kinds: swiftTypeKinds(g, (usr) => bridgedSwiftType(usr) || aliases.has(usr)),
      resolver: (o) => ({
        ...resolver(o.self, o.mainActor, o.typeParams),
        typeArgs: o.typeArgs,
        associated: o.associated,
        selfType: o.selfType,
      }),
      objcClasses,
    });
    dropUndeclared(mod, (ref, arity) => {
      const [owner, ...rest] = ref.split(".");
      const name = rest.join(".");
      if (owner === module) {
        const t = mod.types.find((x) => x.name === name);
        return !!t && ((t.kind === "class" && t.typeParams?.length) || 0) === arity;
      }
      const t = names.find((n) => n.module === owner)?.types[name];
      return !!t && (t.typeParams ?? 0) === arity;
    });
    keepInheritedNonNull(mod, unaudited);
    withInheritedInitializers(mod);
    resolveMemberKinds(mod, names);

    void byUsr;
    return mod;
  }
}

function getterSelector(swiftName: string, property: string): string {
  // Swift lowercases acronyms (CGImage → cgImage); a longer name is a custom getter (isHidden).
  const [swift, objc] = [swiftName.toLowerCase(), property.toLowerCase()];
  return swift !== objc && swift.includes(objc) ? swiftName : property;
}

/**
 * Swift labels are dropped. When overloads become identical, the later ones
 * get their labels appended (`resize(height:)` → `resizeHeight`).
 */
function disambiguate(methods: SdkMethodSchema[]): void {
  const key = (m: SdkMethodSchema) =>
    `${m.static ? "static " : ""}${m.name}(${m.params.map((p) => tsKind(formatSchemaType(p.type))).join(",")})`;
  const seen = new Set<string>();
  for (const m of methods) {
    if (!seen.has(key(m))) {
      seen.add(key(m));
      continue;
    }
    m.name = withLabels(m);
    seen.add(key(m));
  }
}

/** Objective-C methods' Swift names (`count(for:)`), for labeling them again. */
const swiftNames = new WeakMap<SdkMethodSchema, string>();

/** A method's name with its Swift labels appended (`resize(height:)` → `resizeHeight`). */
function withLabels(m: SdkMethodSchema): string {
  const { labels } = splitName(
    (m as SdkMethodSchema & { swiftName?: string }).swiftName ?? swiftNames.get(m) ?? m.name,
  );
  return (
    m.name +
    labels
      .filter((l) => l !== "_")
      .map((l) => l.charAt(0).toUpperCase() + l.slice(1))
      .join("")
  );
}

function tsKind(t: string): string {
  const base = t.replace(/\?$/, "");
  if (["bool"].includes(base)) return "boolean";
  if (/^(double|float|CGFloat|NSInteger|NSUInteger|u?int(8|16|32|64))$/.test(base)) return "number";
  return base;
}

/**
 * Leaves out the members naming a type the declarations will not have (a
 * type skipped, or a reference with the wrong number of type arguments): a
 * member is bound only when every type it names is declared.
 */
function dropUndeclared(
  mod: SdkModuleSchema,
  declared: (ref: string, arity: number) => boolean,
): void {
  const missing = (t: SchemaType) => undeclaredType(t, declared);
  const typesOf = (m: { params?: SdkParam[]; returns?: SchemaType; type?: SchemaType }) => [
    ...(m.params ?? []).map((p) => p.type),
    ...(m.returns ? [m.returns] : []),
    ...(m.type ? [m.type] : []),
  ];
  const keep = <T extends { params?: SdkParam[]; returns?: SchemaType; type?: SchemaType }>(
    owner: string,
    list: T[] | undefined,
    title: (m: T) => string,
  ): T[] | undefined => {
    if (!list) return list;
    const out = list.filter((m) => {
      const name = typesOf(m).map(missing).find(Boolean);
      if (name) mod.skipped!.push(`${owner}.${title(m)}: ${undeclaredReason(name)}`);
      return !name;
    });
    return out.length ? out : undefined;
  };
  const named = (m: { name?: string; swift?: { name: string }; selector?: string }) =>
    m.swift?.name ?? m.name ?? m.selector ?? "init";
  for (const t of mod.types) {
    if (t.kind !== "class") continue;
    const set = <K extends "constructors" | "methods" | "properties">(
      k: K,
      v: SdkClassSchema[K],
    ) => {
      if (v) t[k] = v;
      else delete t[k];
    };
    set("constructors", keep(t.name, t.constructors, named));
    set("methods", keep(t.name, t.methods, named));
    set("properties", keep(t.name, t.properties, named));
  }
  const functions = keep(mod.module, mod.functions, named);
  if (functions) mod.functions = functions;
  else delete mod.functions;
  const constants = keep(mod.module, mod.constants, named);
  if (constants) mod.constants = constants;
  else delete mod.constants;
}
