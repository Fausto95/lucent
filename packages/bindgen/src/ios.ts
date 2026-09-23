import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SdkCallable, SdkClassSchema, SdkEnumSchema, SdkMethodSchema, SdkModuleSchema, SdkPropertySchema } from "@lucent-lang/compiler";

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
}

interface Fragment {
  kind: string;
  spelling: string;
  preciseIdentifier?: string;
}

interface SymbolGraphSymbol {
  kind: { identifier: string };
  identifier: { precise: string };
  pathComponents: string[];
  names: { title: string };
  declarationFragments?: Fragment[];
  functionSignature?: { parameters?: { name: string; internalName?: string; declarationFragments: Fragment[] }[]; returns?: Fragment[] };
  availability?: { domain?: string; introduced?: { major: number; minor?: number }; isUnconditionallyUnavailable?: boolean; obsoleted?: unknown }[];
}

interface SymbolGraph {
  symbols: SymbolGraphSymbol[];
  relationships: { kind: string; source: string; target: string }[];
}

const DEFAULT_TARGET = "arm64-apple-ios15.1-simulator";

function sdkPath(): string {
  const r = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("xcrun: no iphonesimulator SDK");
  return r.stdout.trim();
}

function symbolGraph(module: string, opts: IosOptions, sdk: string): SymbolGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-symbolgraph-"));
  const args = ["swift-symbolgraph-extract", "-module-name", module, "-target", opts.target ?? DEFAULT_TARGET, "-sdk", sdk, "-output-dir", dir, "-minimum-access-level", "public"];
  for (const i of opts.includePaths ?? []) args.push("-I", i);
  const r = spawnSync("xcrun", args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`swift-symbolgraph-extract ${module}: ${r.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(dir, `${module}.symbols.json`), "utf8")) as SymbolGraph;
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
function enumValues(enums: string[], headers: string[], opts: IosOptions, sdk: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (!enums.length) return out;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-enums-"));
  const source = path.join(dir, "enums.m");
  fs.writeFileSync(source, headers.map((h) => `#import <${h}>\n`).join(""));
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const clang = ["xcrun", "clang", "-x", "objective-c", "-target", opts.target ?? DEFAULT_TARGET, "-isysroot", sdk, ...(opts.includePaths ?? []).map((i) => `-I${i}`), "-fsyntax-only", "-Xclang", "-ast-dump=json", "-Xclang", "-ast-dump-filter", "-Xclang"].map(q).join(" ");
  // One clang run per enum, eight at a time.
  const lines = enums.map((e, i) => `${clang} ${q(e)} ${q(source)} > ${q(path.join(dir, `${e}.json`))} 2>/dev/null &${(i + 1) % 8 === 0 ? "\nwait" : ""}`);
  fs.writeFileSync(path.join(dir, "run.sh"), `${lines.join("\n")}\nwait\n`);
  spawnSync("sh", [path.join(dir, "run.sh")], { encoding: "utf8" });
  for (const name of enums) {
    const file = path.join(dir, `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const decls = jsonObjects(fs.readFileSync(file, "utf8")) as ClangNode[];
    const decl = decls.find((d) => d.kind === "EnumDecl" && d.name === name && d.inner?.some((c) => c.kind === "EnumConstantDecl"));
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
  return out;
}

// --- Swift types to schema types ---------------------------------------------------

class Unsupported extends Error {}

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
  "s:10Foundation4DataV": "NSData",
  "s:10Foundation4DateV": "NSDate",
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
  "c:@T@SInt32": "int32",
};

/** Swift value types that bridge to Foundation classes, typed as those classes. */
const BRIDGED_CLASS: Record<string, string> = {
  "s:10Foundation3URLV": "NSURL",
  "s:10Foundation4UUIDV": "NSUUID",
  "s:10Foundation6LocaleV": "NSLocale",
  "s:10Foundation8TimeZoneV": "NSTimeZone",
};

interface Resolver {
  /** A class/protocol/enum USR to its schema reference (`Module.Name`), if extracted. */
  ref(usr: string): string | undefined;
  /** Typealiases and typed string enums: USR to the fragments they stand for. */
  alias(usr: string): Fragment[] | undefined;
  self?: string;
}

/** Tokens of a type written in declaration fragments. */
function tokens(frags: Fragment[]): (Fragment | string)[] {
  const out: (Fragment | string)[] = [];
  for (const f of frags) {
    if (f.kind === "typeIdentifier") out.push(f);
    else if (f.kind === "keyword" && (f.spelling === "Any" || f.spelling === "AnyObject" || f.spelling === "Self")) out.push(f.spelling);
    else if (f.spelling.trim() === "()") out.push("()");
    else {
      for (const t of f.spelling.split(/(\?|!|\[|\]|:|<|>|,|\(|\)|->|@escaping|any |some |inout |\.)/)) {
        const s = t.trim();
        if (s) out.push(s);
      }
    }
  }
  return out;
}

function parseType(frags: Fragment[], r: Resolver): string {
  // `UIControl.State`: a reference to the nested type is its last identifier.
  const toks = tokens(frags).filter((t, i, all) => !(typeof t !== "string" && all[i + 1] === "." && typeof all[i + 2] !== "string")).filter((t) => t !== ".");
  let p = 0;
  const type = (): string => {
    let t = primary();
    while (toks[p] === "?" || toks[p] === "!") {
      p++;
      if (!t.endsWith("?")) t = `${t}?`;
    }
    return t;
  };
  const primary = (): string => {
    const tok = toks[p++];
    if (tok === undefined) throw new Unsupported("empty type");
    if (tok === "any" || tok === "some") return primary();
    if (tok === "(" || tok === "->" || tok === "@escaping" || tok === "inout") throw new Unsupported("closures and tuples");
    if (tok === "[") {
      const key = type();
      if (toks[p] === ":") {
        p++;
        const value = type();
        if (toks[p++] !== "]") throw new Unsupported("dictionary");
        if (key !== "string") throw new Unsupported(`dictionary keyed by ${key}`);
        return `Record<${value}>`;
      }
      if (toks[p++] !== "]") throw new Unsupported("array");
      return `${key}[]`;
    }
    if (tok === "Any" || tok === "AnyObject") return "id";
    if (tok === "()") return "void";
    if (tok === "Self") {
      if (!r.self) throw new Unsupported("Self");
      return r.self;
    }
    if (typeof tok === "string") throw new Unsupported(`type syntax ${tok}`);
    const usr = tok.preciseIdentifier ?? "";
    // `UnsafeMutablePointer<CFTypeRef?>`: an out-parameter for a reference.
    if (usr === "s:Sp" && toks[p] === "<") {
      p++;
      const inner = type();
      if (toks[p++] !== ">") throw new Unsupported("pointer");
      if (!inner.endsWith("?") || !/^(CF\w+|id|\w+\.\w+)\?$/.test(inner)) throw new Unsupported(`pointer to ${inner}`);
      return `Out<${inner.slice(0, -1)}>`;
    }
    // Unmanaged<X>: ownership follows CoreFoundation's Create/Copy rule in the glue.
    if (usr === "s:s9UnmanagedV" && toks[p] === "<") {
      p++;
      const inner = type();
      if (toks[p++] !== ">") throw new Unsupported("Unmanaged");
      return inner;
    }
    if (toks[p] === "<") throw new Unsupported(`generic ${tok.spelling}`);
    if (usr in CF_TYPES) return CF_TYPES[usr]!;
    if (usr in C_TYPEDEFS) return C_TYPEDEFS[usr]!;
    if (usr === "s:s4Voida") return "void";
    if (tok.spelling === "Self" && !usr) {
      if (!r.self) throw new Unsupported("Self");
      return r.self;
    }
    if (usr in SWIFT_PRIM) return SWIFT_PRIM[usr]!;
    if (usr in BRIDGED_CLASS) {
      const ref = r.ref(`c:objc(cs)${BRIDGED_CLASS[usr]}`);
      if (!ref) throw new Unsupported(tok.spelling);
      return ref;
    }
    const aliased = r.alias(usr);
    if (aliased) return parseType(aliased, r);
    const ref = r.ref(usr);
    if (ref) return ref;
    throw new Unsupported(tok.spelling);
  };
  const t = type();
  if (p < toks.length) throw new Unsupported(`type ${frags.map((f) => f.spelling).join("")}`);
  return t;
}

/** The type part of `name: Type` fragments (the colon can share a fragment with `[`). */
function afterColon(frags: Fragment[]): Fragment[] {
  const i = frags.findIndex((f) => f.kind === "text" && f.spelling.includes(":"));
  if (i < 0) return frags;
  const rest = frags[i]!.spelling.slice(frags[i]!.spelling.indexOf(":") + 1);
  return [...(rest.trim() ? [{ kind: "text", spelling: rest }] : []), ...frags.slice(i + 1)];
}

/** A property's type: between the colon and `{ get }`. */
function propertyType(frags: Fragment[]): Fragment[] {
  const t = afterColon(frags);
  const end = t.findIndex((f) => f.spelling.includes("{"));
  if (end < 0) return t;
  const head = t[end]!.spelling.split("{")[0]!;
  return [...t.slice(0, end), ...(head.trim() ? [{ kind: "text", spelling: head }] : [])];
}

// --- extraction ----------------------------------------------------------------------

const objcClass = (usr: string) => /^c:objc\((cs|pl)\)([^(]+)$/.exec(usr);
const objcMember = (usr: string) => /^c:objc\((cs|pl)\)([^(]+)\((im|cm|py|cpy)\)(.+)$/.exec(usr);
const declText = (s: SymbolGraphSymbol) => (s.declarationFragments ?? []).map((f) => f.spelling).join("");

function since(s: SymbolGraphSymbol): string | undefined {
  const ios = s.availability?.find((a) => a.domain === "iOS");
  if (!ios?.introduced) return undefined;
  return `${ios.introduced.major}.${ios.introduced.minor ?? 0}`;
}

function unavailable(s: SymbolGraphSymbol): boolean {
  return !!s.availability?.some((a) => (a.domain === "iOS" || a.domain === "*" || a.domain === undefined) && (a.isUnconditionallyUnavailable || a.obsoleted));
}

/** `impact(intensity:)` → base `impact`, labels `["intensity"]`. */
function splitName(title: string): { base: string; labels: string[] } {
  const m = /^([^(]+)\((.*)\)$/.exec(title);
  if (!m) return { base: title, labels: [] };
  return { base: m[1]!, labels: m[2]!.split(":").filter((l) => l !== "") };
}

export function extractIos(opts: IosOptions): SdkModuleSchema[] {
  const sdk = sdkPath();
  const graphs = new Map(opts.modules.map((m) => [m, symbolGraph(m, opts, sdk)]));
  return buildIosSchemas(graphs, (enums) =>
    enumValues(
      enums,
      opts.modules.map((m) => `${m}/${m}.h`),
      opts,
      sdk,
    ),
  );
}

/** The schemas for symbol graphs; `values` looks up enum values by C enum name. */
export function buildIosSchemas(graphs: Map<string, SymbolGraph>, values: (enums: string[]) => Map<string, Map<string, number>>): SdkModuleSchema[] {
  // Every Objective-C type of every module, for references across modules.
  const refs = new Map<string, string>();
  const aliases = new Map<string, Fragment[]>();
  for (const [module, g] of graphs) {
    for (const s of g.symbols) {
      const usr = s.identifier.precise;
      const k = s.kind.identifier;
      if ((k === "swift.class" || k === "swift.protocol") && objcClass(usr)) refs.set(usr, `${module}.${s.pathComponents.join("_")}`);
      if ((k === "swift.enum" || k === "swift.struct") && usr.startsWith("c:@E@")) refs.set(usr, `${module}.${s.pathComponents.join("_")}`);
      if (k === "swift.typealias") {
        const eq = (s.declarationFragments ?? []).findIndex((f) => f.spelling.includes("="));
        if (eq >= 0) aliases.set(usr, [{ kind: "text", spelling: (s.declarationFragments![eq]!.spelling.split("=")[1] ?? "").trim() }, ...s.declarationFragments!.slice(eq + 1)]);
      }
      // Typed string enums (NS_TYPED_ENUM): strings at the boundary.
      if (k === "swift.struct" && /^c:.*@T@/.test(usr)) aliases.set(usr, [{ kind: "typeIdentifier", spelling: "String", preciseIdentifier: "s:SS" }]);
    }
  }

  const out: SdkModuleSchema[] = [];
  for (const [module, g] of graphs) {
    const mod: SdkModuleSchema = { platform: "ios", module, frameworks: [module], types: [], skipped: [] };
    const members = new Map<string, SymbolGraphSymbol[]>();
    for (const rel of g.relationships) {
      if (rel.kind !== "memberOf" && rel.kind !== "requirementOf" && rel.kind !== "optionalRequirementOf") continue;
      const sym = g.symbols.find((s) => s.identifier.precise === rel.source);
      if (!sym) continue;
      const list = members.get(rel.target) ?? [];
      if (!list.includes(sym)) list.push(sym);
      members.set(rel.target, list);
    }
    const byUsr = new Map(g.symbols.map((s) => [s.identifier.precise, s]));
    const resolver = (self?: string): Resolver => ({ ref: (u) => refs.get(u), alias: (u) => aliases.get(u), self });
    const skip = (owner: string, s: SymbolGraphSymbol, reason: string) => mod.skipped!.push(`${owner}.${s.names.title}: ${reason}`);

    // Enums and options.
    const enumSyms = g.symbols.filter((s) => (s.kind.identifier === "swift.enum" || s.kind.identifier === "swift.struct") && s.identifier.precise.startsWith("c:@E@"));
    const cNames = enumSyms.map((s) => s.identifier.precise.slice("c:@E@".length));
    const enumValueMap = values(cNames);
    for (const s of enumSyms) {
      const cName = s.identifier.precise.slice("c:@E@".length);
      const cases = (members.get(s.identifier.precise) ?? [])
        .filter((m) => m.identifier.precise.startsWith(`${s.identifier.precise}@`) && !unavailable(m))
        .map((m) => {
          const native = m.identifier.precise.slice(s.identifier.precise.length + 1);
          return { name: m.pathComponents[m.pathComponents.length - 1]!, native, value: enumValueMap.get(cName)?.get(native) };
        });
      if (cases.some((c) => c.value === undefined)) {
        mod.skipped!.push(`${s.pathComponents.join(".")}: enum values unknown`);
        continue;
      }
      const e: SdkEnumSchema = { kind: "enum", name: s.pathComponents.join("_"), native: cName, cases: cases as SdkEnumSchema["cases"] };
      mod.types.push(e);
    }

    // Classes and protocols.
    for (const s of g.symbols) {
      const k = s.kind.identifier;
      const m = objcClass(s.identifier.precise);
      if (!m || (k !== "swift.class" && k !== "swift.protocol") || unavailable(s)) continue;
      const name = s.pathComponents.join("_");
      const self = `${module}.${name}`;
      const cls: SdkClassSchema = { kind: "class", name, native: m[2]! };
      if (k === "swift.protocol") cls.interface = true;
      if (declText(s).includes("@MainActor")) cls.mainActor = true;
      const v = since(s);
      if (v) cls.since = v;
      const superUsr = g.relationships.find((r) => r.kind === "inheritsFrom" && r.source === s.identifier.precise)?.target;
      if (superUsr && refs.has(superUsr)) cls.extends = refs.get(superUsr);
      const conforms = [...new Set(g.relationships.filter((r) => r.kind === "conformsTo" && r.source === s.identifier.precise && r.target.startsWith("c:objc(pl)") && refs.has(r.target)).map((r) => refs.get(r.target)!))];
      if (conforms.length) cls.implements = conforms;

      const ctors: SdkCallable[] = [];
      const methods: SdkMethodSchema[] = [];
      const props: SdkPropertySchema[] = [];
      const seenUsr = new Set<string>();
      let initUnavailable = false;
      for (const mem of members.get(s.identifier.precise) ?? []) {
        const mm = objcMember(mem.identifier.precise);
        if (mm && unavailable(mem) && mem.kind.identifier === "swift.init") initUnavailable = true;
        if (!mm || unavailable(mem)) continue;
        const text = declText(mem);
        // A completion-handler method is imported twice: keep the handler form.
        if (/\basync\b/.test(text)) continue;
        if (seenUsr.has(mem.identifier.precise)) continue;
        seenUsr.add(mem.identifier.precise);
        const kind = mm[3]!;
        const selector = mm[4]!;
        const r = resolver(self);
        const memberSince = since(mem);
        try {
          if (kind === "py" || kind === "cpy") {
            const p: SdkPropertySchema = { name: mem.names.title, type: parseType(propertyType(mem.declarationFragments ?? []), r) };
            if (kind === "cpy") p.static = true;
            const readonly = !/\bset\b/.test(text);
            if (readonly) p.readonly = true;
            if (mem.names.title !== selector) p.selector = selector === mem.names.title ? undefined : getterSelector(mem.names.title, selector);
            if (p.selector === undefined) delete p.selector;
            if (!readonly) p.setter = `set${selector.charAt(0).toUpperCase()}${selector.slice(1)}:`;
            if (memberSince && memberSince !== cls.since) p.since = memberSince;
            if (declText(mem).includes("@MainActor") && !cls.mainActor) (p as SdkPropertySchema & { mainActor?: boolean }).mainActor = true;
            props.push(p);
            continue;
          }
          const sig = mem.functionSignature;
          const params = (sig?.parameters ?? []).map((pp) => ({ name: pp.internalName ?? pp.name, type: parseType(afterColon(pp.declarationFragments), r) }));
          if (mem.kind.identifier === "swift.init") {
            if (kind === "cm") continue;
            const c: SdkCallable = { params, selector };
            if (memberSince && memberSince !== cls.since) c.since = memberSince;
            ctors.push(c);
            continue;
          }
          const returns = sig?.returns?.length ? parseType(sig.returns, r) : "void";
          const { base } = splitName(mem.names.title);
          const method: SdkMethodSchema = { name: base, selector, params, returns };
          if (kind === "cm") method.static = true;
          if (/\bthrows\b/.test(text)) method.throws = true;
          if (memberSince && memberSince !== cls.since) method.since = memberSince;
          if (text.includes("@MainActor") && !cls.mainActor) method.mainActor = true;
          (method as SdkMethodSchema & { swiftName?: string }).swiftName = mem.names.title;
          methods.push(method);
        } catch (e) {
          if (e instanceof Unsupported) skip(name, mem, e.message);
          else throw e;
        }
      }
      disambiguate(methods);
      for (const x of methods) delete (x as SdkMethodSchema & { swiftName?: string }).swiftName;
      // Objective-C initializers are inherited (NSObject's init at the root)
      // unless the class makes init unavailable.
      if (!ctors.length && !initUnavailable && k === "swift.class") {
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
          const params = (sig?.parameters ?? []).map((pp) => ({ name: pp.internalName ?? pp.name, type: parseType(afterColon(pp.declarationFragments), resolver()) }));
          const f: SdkMethodSchema = { name: s.names.title.replace(/\(.*$/, ""), params, returns: sig?.returns?.length ? parseType(sig.returns, resolver()) : "void" };
          const v = since(s);
          if (v) f.since = v;
          (mod.functions ??= []).push(f);
        } else if (s.kind.identifier === "swift.var" && /^c:@[^@]+$/.test(usr)) {
          const c: SdkPropertySchema = { name: s.names.title, type: parseType(afterColon(s.declarationFragments ?? []), resolver()) };
          (mod.constants ??= []).push(c);
        }
      } catch (e) {
        if (e instanceof Unsupported) skip(module, s, e.message);
        else throw e;
      }
    }
    void byUsr;
    out.push(mod);
  }
  return out;
}

/** The getter selector of a property whose Swift name differs from its Objective-C name (`isEnabled`). */
function getterSelector(swiftName: string, property: string): string {
  return swiftName.toLowerCase().includes(property.toLowerCase()) ? swiftName : property;
}

/**
 * Swift labels are dropped. When overloads become identical, the later ones
 * get their labels appended (`resize(height:)` → `resizeHeight`).
 */
function disambiguate(methods: SdkMethodSchema[]): void {
  const key = (m: SdkMethodSchema) => `${m.static ? "static " : ""}${m.name}(${m.params.map((p) => tsKind(p.type)).join(",")})`;
  const seen = new Set<string>();
  for (const m of methods) {
    if (!seen.has(key(m))) {
      seen.add(key(m));
      continue;
    }
    const { labels } = splitName((m as SdkMethodSchema & { swiftName?: string }).swiftName ?? m.name);
    m.name = m.name + labels.filter((l) => l !== "_").map((l) => l.charAt(0).toUpperCase() + l.slice(1)).join("");
    seen.add(key(m));
  }
}

function tsKind(t: string): string {
  const base = t.replace(/\?$/, "");
  if (["bool"].includes(base)) return "boolean";
  if (/^(double|float|CGFloat|NSInteger|NSUInteger|u?int(8|16|32|64))$/.test(base)) return "number";
  return base;
}
