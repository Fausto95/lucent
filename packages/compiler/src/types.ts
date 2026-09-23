import ts from "typescript";
import { Codes, fail } from "./diagnostics.ts";
import { isLibFile, sdkModuleOf } from "./program.ts";
import type { Platform } from "./sdk/schema.ts";

/**
 * Lucent types: the native representation of a TypeScript type. Literal
 * types widen to their base type, `T | undefined | null` becomes `opt`, and
 * other unions become `union` (a std::variant).
 */
export type LType =
  | { k: "number" }
  | { k: "boolean" }
  | { k: "string" }
  | { k: "void" }
  | { k: "undefined" }
  | { k: "null" }
  | { k: "never" }
  | { k: "array"; e: LType }
  | { k: "tuple"; es: LType[] }
  | { k: "map"; key: LType; val: LType }
  | { k: "set"; e: LType }
  | { k: "dict"; val: LType }
  | { k: "struct"; id: string }
  | { k: "class"; id: string; args: LType[] }
  | { k: "iface"; id: string; args: LType[] }
  | { k: "opt"; inner: LType }
  | { k: "union"; ms: LType[] }
  | { k: "fn"; params: LType[]; ret: LType }
  | { k: "promise"; inner: LType }
  | { k: "bytes" }
  | { k: "error" }
  | { k: "date" }
  | { k: "regexp" }
  | { k: "regexMatch" }
  | { k: "iter"; e: LType }
  | { k: "iterResult"; e: LType }
  | { k: "abortSignal" }
  | { k: "abortController" }
  | { k: "tparam"; name: string }
  /** An object of a platform SDK class (lucent:ios/…, lucent:android/…). */
  | { k: "native"; platform: Platform; module: string; name: string };

export const T = {
  number: { k: "number" } as LType,
  boolean: { k: "boolean" } as LType,
  string: { k: "string" } as LType,
  void: { k: "void" } as LType,
  undefined: { k: "undefined" } as LType,
  null: { k: "null" } as LType,
  never: { k: "never" } as LType,
  error: { k: "error" } as LType,
  bytes: { k: "bytes" } as LType,
  date: { k: "date" } as LType,
  regexp: { k: "regexp" } as LType,
  regexMatch: { k: "regexMatch" } as LType,
  abortSignal: { k: "abortSignal" } as LType,
  abortController: { k: "abortController" } as LType,
};

export function typeKey(t: LType): string {
  switch (t.k) {
    case "array":
      return `${typeKey(t.e)}[]`;
    case "tuple":
      return `[${t.es.map(typeKey).join(",")}]`;
    case "map":
      return `Map<${typeKey(t.key)},${typeKey(t.val)}>`;
    case "set":
      return `Set<${typeKey(t.e)}>`;
    case "dict":
      return `Dict<${typeKey(t.val)}>`;
    case "struct":
      return `S:${t.id}`;
    case "class":
      return t.args.length ? `C:${t.id}<${t.args.map(typeKey).join(",")}>` : `C:${t.id}`;
    case "iface":
      return t.args.length ? `I:${t.id}<${t.args.map(typeKey).join(",")}>` : `I:${t.id}`;
    case "iter":
      return `Iter<${typeKey(t.e)}>`;
    case "iterResult":
      return `IterResult<${typeKey(t.e)}>`;
    case "opt":
      return `${typeKey(t.inner)}?`;
    case "union":
      return `(${t.ms.map(typeKey).join("|")})`;
    case "fn":
      return `(${t.params.map(typeKey).join(",")})=>${typeKey(t.ret)}`;
    case "promise":
      return `Promise<${typeKey(t.inner)}>`;
    case "tparam":
      return `T:${t.name}`;
    case "native":
      return `N:${t.platform}:${t.module}.${t.name}`;
    default:
      return t.k;
  }
}

export function sameType(a: LType, b: LType): boolean {
  return typeKey(a) === typeKey(b);
}

/** Builds `a | b | ...` in canonical form. */
export function unionOf(members: LType[]): LType {
  let optional = false;
  const flat: LType[] = [];
  const add = (m: LType) => {
    if (m.k === "undefined" || m.k === "null") optional = true;
    else if (m.k === "opt") {
      optional = true;
      add(m.inner);
    } else if (m.k === "union") m.ms.forEach(add);
    else if (m.k === "never") return;
    else flat.push(m);
  };
  members.forEach(add);
  const seen = new Map<string, LType>();
  for (const m of flat) seen.set(typeKey(m), m);
  const ms = [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, m]) => m);
  let core: LType;
  if (ms.length === 0) {
    if (!optional) return T.never;
    // `undefined` alone: represented as an always-absent optional.
    return members.some((m) => m.k === "null") && !members.some((m) => m.k === "undefined") ? T.null : T.undefined;
  } else if (ms.length === 1) core = ms[0]!;
  else core = { k: "union", ms };
  return optional ? { k: "opt", inner: core } : core;
}

/** Replaces type parameters by name. */
export function substitute(t: LType, map: Map<string, LType>): LType {
  switch (t.k) {
    case "tparam":
      return map.get(t.name) ?? t;
    case "array":
      return { k: "array", e: substitute(t.e, map) };
    case "set":
      return { k: "set", e: substitute(t.e, map) };
    case "dict":
      return { k: "dict", val: substitute(t.val, map) };
    case "map":
      return { k: "map", key: substitute(t.key, map), val: substitute(t.val, map) };
    case "opt":
      return unionOf([substitute(t.inner, map), T.undefined]);
    case "union":
      return unionOf(t.ms.map((m) => substitute(m, map)));
    case "tuple":
      return { k: "tuple", es: t.es.map((e) => substitute(e, map)) };
    case "promise":
      return { k: "promise", inner: substitute(t.inner, map) };
    case "fn":
      return { k: "fn", params: t.params.map((p) => substitute(p, map)), ret: substitute(t.ret, map) };
    case "class":
      return { k: "class", id: t.id, args: t.args.map((a) => substitute(a, map)) };
    case "iface":
      return { k: "iface", id: t.id, args: t.args.map((a) => substitute(a, map)) };
    case "iter":
      return { k: "iter", e: substitute(t.e, map) };
    case "iterResult":
      return { k: "iterResult", e: substitute(t.e, map) };
    default:
      return t;
  }
}

export function stripOpt(t: LType): LType {
  return t.k === "opt" ? t.inner : t;
}

export function isVoidish(t: LType): boolean {
  return t.k === "void" || t.k === "undefined" || t.k === "never";
}

export interface StructField {
  name: string;
  type: LType;
  optional: boolean;
  /** Set when every source type had this field as one string literal. */
  literal?: string;
  readonly: boolean;
}

export interface StructInfo {
  id: string;
  cppName: string;
  fields: StructField[];
  /** Whether conversions to/from JS are needed. */
  boundary: boolean;
}

export interface ClassInfo {
  id: string;
  cppName: string;
  decl: ts.ClassDeclaration;
  module: string;
  exported: boolean;
  typeParams: string[];
  boundary: boolean;
  isError: boolean;
  abstract: boolean;
  /** The Lucent class this one extends, with type arguments in terms of this class's parameters. */
  base?: { id: string; args: LType[] };
}

/** A class type and its ancestors, nearest first, with type arguments substituted. */
export type ClassChain = { info: ClassInfo; t: LType & { k: "class" } }[];

/**
 * An interface that classes implement: an abstract C++ base with virtual
 * methods and property accessors. Every implementer is known at compile time.
 */
export interface IfaceInfo {
  id: string;
  cppName: string;
  decl: ts.InterfaceDeclaration;
  typeParams: string[];
  /** Classes that declare `implements`, with this interface's type arguments in the class's terms. */
  implementers: Map<string, LType[]>;
}

export type IfaceT = LType & { k: "iface" };

const RESERVED = new Set(
  (
    "alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const " +
    "consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum " +
    "explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or " +
    "or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct " +
    "switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor " +
    "xor_eq final override assert errno NULL EOF stdin stdout stderr main std lucent jsi facebook self"
  ).split(" "),
);

/** A C++-safe identifier for a TypeScript name. */
export function cppIdent(name: string): string {
  let out = name.replace(/[^A-Za-z0-9_]/g, (c) => `_u${c.codePointAt(0)!.toString(16)}_`);
  if (/^[0-9]/.test(out)) out = `_${out}`;
  if (RESERVED.has(out) || out.includes("__") || /^_[A-Z]/.test(out)) out = `${out}_`;
  return out;
}

/** Registry of every struct and class the program uses. */
export class TypeRegistry {
  readonly structs = new Map<string, StructInfo>();
  readonly classes = new Map<string, ClassInfo>();
  readonly ifaces = new Map<string, IfaceInfo>();
  private readonly structNames = new Set<string>();
  private readonly byTsType = new Map<ts.Type, LType>();
  private readonly inProgress = new Map<ts.Type, string>();
  private anon = 0;

  constructor(
    readonly checker: ts.TypeChecker,
    readonly isLucentFile: (sf: ts.SourceFile) => boolean,
  ) {}

  registerClass(decl: ts.ClassDeclaration, module: string, exported: boolean): ClassInfo {
    const name = decl.name!.text;
    const id = `${module}.${name}`;
    const existing = this.classes.get(id);
    if (existing) return existing;
    let cppName = `C_${cppIdent(name)}`;
    let n = 2;
    while (this.structNames.has(cppName)) cppName = `C_${cppIdent(name)}_${n++}`;
    this.structNames.add(cppName);
    const heritage = decl.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
    const isError = !!heritage && heritage.types.some((t) => t.expression.getText() === "Error");
    const info: ClassInfo = {
      id,
      cppName,
      decl,
      module,
      exported,
      typeParams: decl.typeParameters?.map((p) => p.name.text) ?? [],
      boundary: false,
      isError,
      abstract: !!ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword),
    };
    this.classes.set(id, info);
    return info;
  }

  /** Records the Lucent interfaces a class names in its `implements` clause. */
  registerImplements(info: ClassInfo): void {
    for (const h of info.decl.heritageClauses ?? []) {
      if (h.token !== ts.SyntaxKind.ImplementsKeyword) continue;
      for (const t of h.types) {
        const type = this.checker.getTypeAtLocation(t);
        const decl = this.lucentInterface(type.getSymbol());
        if (!decl) continue;
        const iface = this.registerInterface(decl);
        const args = (type as ts.TypeReference).target ? this.checker.getTypeArguments(type as ts.TypeReference).slice(0, iface.typeParams.length) : [];
        // Lowered lazily: argument types may name classes not registered yet.
        this.pendingImplements.push(() => iface.implementers.set(info.id, args.map((a) => this.lower(a, t))));
      }
    }
  }

  private lucentInterface(sym: ts.Symbol | undefined): ts.InterfaceDeclaration | undefined {
    if (!sym || !(sym.flags & ts.SymbolFlags.Interface)) return undefined;
    const decls = (sym.declarations ?? []).filter(ts.isInterfaceDeclaration);
    const decl = decls[0];
    if (!decl || !this.isLucentFile(decl.getSourceFile())) return undefined;
    return decl;
  }

  private registerInterface(decl: ts.InterfaceDeclaration): IfaceInfo {
    const name = decl.name.text;
    const id = `${decl.getSourceFile().fileName}#${name}`;
    const existing = this.ifaces.get(id);
    if (existing) return existing;
    let cppName = `I_${cppIdent(name)}`;
    let n = 2;
    while (this.structNames.has(cppName)) cppName = `I_${cppIdent(name)}_${n++}`;
    this.structNames.add(cppName);
    const info: IfaceInfo = { id, cppName, decl, typeParams: decl.typeParameters?.map((p) => p.name.text) ?? [], implementers: new Map() };
    this.ifaces.set(id, info);
    // Base interfaces dispatch virtually too, even without methods of their own.
    for (const h of decl.heritageClauses ?? []) {
      for (const t of h.types) {
        const base = this.lucentInterface(this.checker.getTypeAtLocation(t).getSymbol());
        if (!base) fail(t, Codes.InterfaceMismatch, `interface ${name} can only extend other Lucent interfaces`);
        this.registerInterface(base);
      }
    }
    return info;
  }

  private readonly pendingImplements: (() => void)[] = [];

  /** Lowers the type arguments of every `implements` clause (after all classes are registered). */
  resolveImplements(): void {
    for (const f of this.pendingImplements.splice(0)) f();
  }

  /** Whether an interface declares methods, itself or through the interfaces it extends. */
  private hasMethods(decl: ts.InterfaceDeclaration): boolean {
    if (decl.members.some(ts.isMethodSignature)) return true;
    return (decl.heritageClauses ?? []).some((h) =>
      h.types.some((t) => {
        const base = this.lucentInterface(this.checker.getTypeAtLocation(t).getSymbol());
        return !!base && this.hasMethods(base);
      }),
    );
  }

  /** The interfaces `t` extends, with type arguments substituted. */
  ifaceBases(t: IfaceT): IfaceT[] {
    const info = this.iface(t.id);
    const map = new Map(info.typeParams.map((p, i) => [p, t.args[i] ?? ({ k: "tparam", name: p } as LType)] as [string, LType]));
    const out: IfaceT[] = [];
    for (const h of info.decl.heritageClauses ?? []) {
      for (const ht of h.types) {
        const b = this.lower(this.checker.getTypeAtLocation(ht), ht);
        if (b.k === "iface") out.push(substitute(b, map) as IfaceT);
      }
    }
    return out;
  }

  /** `t` and every interface it extends, transitively. */
  ifaceChain(t: IfaceT): IfaceT[] {
    const out = new Map<string, IfaceT>();
    const add = (x: IfaceT) => {
      if (out.has(typeKey(x))) return;
      out.set(typeKey(x), x);
      this.ifaceBases(x).forEach(add);
    };
    add(t);
    return [...out.values()];
  }

  /** The interface instantiations a class declares with `implements`, in its own terms. */
  declaredIfaces(info: ClassInfo): IfaceT[] {
    return [...this.ifaces.values()].filter((i) => i.implementers.has(info.id)).map((i) => ({ k: "iface", id: i.id, args: i.implementers.get(info.id)! }));
  }

  /** Whether class type `c` (or an ancestor) implements `target` or an interface extending it. */
  implementsIface(c: LType & { k: "class" }, target: IfaceT): boolean {
    const want = typeKey(target);
    for (const link of this.chain(c)) {
      const map = new Map(link.info.typeParams.map((p, i) => [p, link.t.args[i] ?? ({ k: "tparam", name: p } as LType)] as [string, LType]));
      for (const i of this.declaredIfaces(link.info)) {
        if (this.ifaceChain(substitute(i, map) as IfaceT).some((x) => typeKey(x) === want)) return true;
      }
    }
    return false;
  }

  /** Non-generic classes whose instances are `target`s, deepest first. */
  implementations(target: IfaceT): ClassInfo[] {
    const all = [...this.classes.values()].filter((c) => !c.typeParams.length && this.implementsIface({ k: "class", id: c.id, args: [] }, target));
    return all.sort((a, b) => this.ancestors(b).length - this.ancestors(a).length);
  }

  /** Resolves `extends` once every class is registered. */
  resolveBase(info: ClassInfo): void {
    const h = info.decl.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword);
    const expr = h?.types[0];
    if (!expr || expr.expression.getText() === "Error") return;
    const t = this.lower(this.checker.getTypeAtLocation(expr), expr);
    if (t.k !== "class") fail(expr, Codes.UnsupportedClassFeature, "classes can only extend Lucent classes and Error");
    info.base = { id: t.id, args: t.args };
  }

  /** Marks subclasses of Error classes as errors (after resolveBase). */
  propagateErrors(): void {
    for (const c of this.classes.values()) if (this.ancestors(c).some((a) => a.isError)) c.isError = true;
  }

  /** Base classes, nearest first. */
  ancestors(info: ClassInfo): ClassInfo[] {
    const out: ClassInfo[] = [];
    for (let b = info.base; b; b = this.cls(b.id).base) out.push(this.cls(b.id));
    return out;
  }

  /** `t` and its ancestors, with type arguments substituted along the chain. */
  chain(t: LType & { k: "class" }): ClassChain {
    const out: ClassChain = [];
    let cur: (LType & { k: "class" }) | undefined = t;
    while (cur) {
      const info = this.cls(cur.id);
      out.push({ info, t: cur });
      const map = new Map(info.typeParams.map((p, i) => [p, cur!.args[i] ?? { k: "tparam", name: p }] as [string, LType]));
      cur = info.base ? { k: "class", id: info.base.id, args: info.base.args.map((a) => substitute(a, map)) } : undefined;
    }
    return out;
  }

  /** Every class that extends `id`, directly or not, deepest first. */
  descendants(id: string): ClassInfo[] {
    const out = [...this.classes.values()].filter((c) => this.ancestors(c).some((a) => a.id === id));
    return out.sort((a, b) => this.ancestors(b).length - this.ancestors(a).length);
  }

  /** Whether `sub` is `sup` or extends it. */
  derives(sub: string, sup: string): boolean {
    return sub === sup || this.ancestors(this.cls(sub)).some((a) => a.id === sup);
  }

  classForDecl(decl: ts.ClassDeclaration): ClassInfo | undefined {
    for (const c of this.classes.values()) if (c.decl === decl) return c;
    return undefined;
  }

  /** Lowers a TypeScript type at `node` (used for error locations). */
  lower(type: ts.Type, node: ts.Node): LType {
    const cached = this.byTsType.get(type);
    if (cached) return cached;
    const result = this.lowerUncached(type, node);
    // Struct results are cached by registerStruct itself.
    if (result.k !== "struct" && this.inProgress.size === 0) this.byTsType.set(type, result);
    return result;
  }

  private lowerUncached(type: ts.Type, node: ts.Node): LType {
    const c = this.checker;
    const f = type.flags;
    if (f & ts.TypeFlags.Any) fail(node, Codes.AnyType, "`any` has no native representation; give this value a concrete type");
    if (f & ts.TypeFlags.Unknown) fail(node, Codes.AnyType, "`unknown` has no native representation; narrow it or give it a concrete type");
    if (f & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return T.number;
    if (f & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping)) return T.string;
    if (f & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return T.boolean;
    if (f & ts.TypeFlags.Void) return T.void;
    if (f & ts.TypeFlags.Undefined) return T.undefined;
    if (f & ts.TypeFlags.Null) return T.null;
    if (f & ts.TypeFlags.Never) return T.never;
    if (f & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) fail(node, Codes.UnsupportedType, "bigint is not supported yet");
    if (f & ts.TypeFlags.ESSymbolLike) fail(node, Codes.UnsupportedType, "symbols are not supported");
    if (f & ts.TypeFlags.TypeParameter) {
      if ((type as { isThisType?: boolean }).isThisType) {
        // The polymorphic `this` type of a class: its instance type.
        const constraint = type.getConstraint() ?? c.getBaseConstraintOfType(type);
        if (constraint) return this.lower(constraint, node);
      }
      const sym = type.getSymbol();
      return { k: "tparam", name: sym ? sym.name : "T" };
    }
    if (f & ts.TypeFlags.EnumLike && f & ts.TypeFlags.Union) {
      return unionOf((type as ts.UnionType).types.map((t) => this.lower(t, node)));
    }
    // IteratorResult<T, TReturn> is a lib alias for a union whose return half
    // carries TReturn (often any); only the yielded type matters here.
    if (type.aliasSymbol?.name === "IteratorResult" && type.aliasTypeArguments?.[0] && this.libName(type)) {
      return { k: "iterResult", e: this.lower(type.aliasTypeArguments[0], node) };
    }
    if (type.isUnion()) {
      return unionOf(type.types.map((t) => this.lower(t, node)));
    }
    if (type.isIntersection()) fail(node, Codes.UnsupportedType, `intersection types are not supported: ${c.typeToString(type)}`);
    if (f & ts.TypeFlags.Object) return this.lowerObject(type as ts.ObjectType, node);
    if (f & ts.TypeFlags.NonPrimitive) fail(node, Codes.UnsupportedType, "`object` has no native representation; use a concrete object type");
    fail(node, Codes.UnsupportedType, `type ${c.typeToString(type)} is not supported`);
  }

  private libName(type: ts.Type): string | undefined {
    const sym = type.getSymbol() ?? type.aliasSymbol;
    if (!sym) return undefined;
    const decl = sym.declarations?.[0];
    if (!decl) return undefined;
    const sf = decl.getSourceFile();
    if (!isLibFile(sf)) return undefined;
    return sym.name;
  }

  private lowerObject(type: ts.ObjectType, node: ts.Node): LType {
    const c = this.checker;
    const sdkSym = type.getSymbol();
    const decl = sdkSym?.declarations?.[0];
    const sdk = decl && ts.isClassDeclaration(decl) ? sdkModuleOf(decl.getSourceFile()) : undefined;
    if (sdk && sdkSym) {
      if (type.getConstructSignatures().length || c.getTypeOfSymbolAtLocation(sdkSym, decl!) === type) {
        fail(node, Codes.UnsupportedSyntax, `the class ${sdkSym.name} can only be used with new, static members, or as a Class<T> argument`);
      }
      return { k: "native", platform: sdk.platform, module: sdk.module, name: sdkSym.name };
    }
    if (c.isTupleType(type)) {
      return { k: "tuple", es: c.getTypeArguments(type as ts.TypeReference).map((t) => this.lower(t, node)) };
    }
    if (c.isArrayType(type)) {
      const [e] = c.getTypeArguments(type as ts.TypeReference);
      return { k: "array", e: this.lower(e!, node) };
    }
    const lib = this.libName(type);
    if (lib) {
      const args = c.getTypeArguments(type as ts.TypeReference);
      switch (lib) {
        case "Map":
        case "ReadonlyMap":
          return { k: "map", key: this.lower(args[0]!, node), val: this.lower(args[1]!, node) };
        case "Set":
        case "ReadonlySet":
          return { k: "set", e: this.lower(args[0]!, node) };
        case "Promise":
        case "PromiseLike":
          return { k: "promise", inner: this.lower(args[0]!, node) };
        case "Uint8Array":
          return T.bytes;
        case "Error":
        case "TypeError":
        case "RangeError":
          return T.error;
        case "Date":
          return T.date;
        case "RegExp":
          return T.regexp;
        case "RegExpMatchArray":
        case "RegExpExecArray":
          return T.regexMatch;
        // Iterables: generators, built-in iterators and Iterable<T> parameters.
        case "Generator":
        case "Iterable":
        case "IterableIterator":
        case "Iterator":
        case "IteratorObject":
        case "ArrayIterator":
        case "MapIterator":
        case "SetIterator":
        case "StringIterator":
        case "RegExpStringIterator":
          return { k: "iter", e: this.lower(args[0]!, node) };
        case "IteratorResult":
        case "IteratorYieldResult":
        case "IteratorReturnResult":
          return { k: "iterResult", e: this.lower(args[0]!, node) };
        case "AbortSignal":
          return T.abortSignal;
        case "AbortController":
          return T.abortController;
        case "Array":
        case "ReadonlyArray":
          return { k: "array", e: this.lower(args[0]!, node) };
        default:
          break;
      }
    }
    const sym = type.getSymbol();
    if (sym && sym.flags & ts.SymbolFlags.Class) {
      const decl = sym.declarations?.find(ts.isClassDeclaration);
      if (decl && this.isLucentFile(decl.getSourceFile())) {
        const info = this.classForDecl(decl);
        if (info) {
          // Class references also carry the polymorphic `this` type as a last argument.
          const args = (type as ts.TypeReference).target ? c.getTypeArguments(type as ts.TypeReference).slice(0, info.typeParams.length) : [];
          return { k: "class", id: info.id, args: args.map((a) => this.lower(a, node)) };
        }
      }
    }
    // Interfaces with methods, or implemented by a class, dispatch virtually.
    const iface = this.lucentInterface(sym);
    if (iface) {
      const id = `${iface.getSourceFile().fileName}#${iface.name.text}`;
      if (this.ifaces.has(id) || this.hasMethods(iface)) {
        const info = this.registerInterface(iface);
        const args = (type as ts.TypeReference).target ? c.getTypeArguments(type as ts.TypeReference).slice(0, info.typeParams.length) : [];
        return { k: "iface", id: info.id, args: args.map((a) => this.lower(a, node)) };
      }
    }
    const calls = type.getCallSignatures();
    const props = c.getPropertiesOfType(type);
    if (calls.length > 0) {
      if (calls.length > 1) fail(node, Codes.UnsupportedType, "overloaded function types are not supported");
      if (props.length > 0) fail(node, Codes.UnsupportedType, "functions with properties are not supported");
      return this.lowerSignature(calls[0]!, node);
    }
    if (type.getConstructSignatures().length > 0) fail(node, Codes.UnsupportedType, "constructor types are not supported");
    const indexInfos = c.getIndexInfosOfType(type);
    if (indexInfos.length > 0) {
      if (props.length > 0) fail(node, Codes.UnsupportedType, "objects with both an index signature and properties are not supported");
      const info = indexInfos[0]!;
      if (!(info.keyType.flags & ts.TypeFlags.String)) fail(node, Codes.UnsupportedType, "only string-keyed records are supported");
      return { k: "dict", val: this.lower(info.type, node) };
    }
    if (lib && !["Object"].includes(lib)) fail(node, Codes.UnsupportedType, `${lib} is not supported`);
    return this.registerStruct(type, props, node);
  }

  lowerSignature(sig: ts.Signature, node: ts.Node): LType {
    const c = this.checker;
    const params = sig.getParameters().map((p) => {
      const decl = p.valueDeclaration;
      let t = this.lower(c.getTypeOfSymbolAtLocation(p, decl ?? node), decl ?? node);
      if (decl && ts.isParameter(decl) && (decl.questionToken || decl.initializer) && t.k !== "opt") t = { k: "opt", inner: t };
      if (decl && ts.isParameter(decl) && decl.dotDotDotToken) fail(decl, Codes.UnsupportedType, "rest parameters in function types are not supported");
      return t;
    });
    return { k: "fn", params, ret: this.lower(c.getReturnTypeOfSignature(sig), node) };
  }

  private registerStruct(type: ts.Type, props: ts.Symbol[], node: ts.Node): LType {
    const c = this.checker;
    const pending = this.inProgress.get(type);
    if (pending) return { k: "struct", id: pending };
    // Provisional id so recursive references resolve.
    const provisional = `pending${this.anon++}`;
    this.inProgress.set(type, provisional);
    const fields: StructField[] = [];
    for (const p of props) {
      if (p.flags & ts.SymbolFlags.Method) fail(node, Codes.UnsupportedType, `object types with methods are not supported (${p.name}); use a class or a function-valued property`);
      if (p.flags & ts.SymbolFlags.GetAccessor) fail(node, Codes.UnsupportedType, `getters in object types are not supported (${p.name})`);
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      const pt = c.getTypeOfSymbolAtLocation(p, decl ?? node);
      const optional = !!(p.flags & ts.SymbolFlags.Optional);
      let lt = this.lower(optional ? c.getNonNullableType(pt) : pt, decl ?? node);
      if (optional) lt = unionOf([lt, T.undefined]);
      let literal: string | undefined;
      if (pt.flags & ts.TypeFlags.StringLiteral) literal = (pt as ts.StringLiteralType).value;
      const readonly = !!decl && ts.canHaveModifiers(decl) && !!ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
      fields.push({ name: p.name, type: lt, optional, literal, readonly });
    }
    const key = fields
      .map((f) => `${f.name}${f.optional ? "?" : ""}:${f.type.k === "struct" && f.type.id.startsWith("pending") ? "self" : typeKey(f.type)}`)
      .sort()
      .join(";");
    let info = this.structs.get(key);
    if (!info) {
      const hint = type.aliasSymbol?.name ?? (type.getSymbol()?.name && !type.getSymbol()!.name.startsWith("__") ? type.getSymbol()!.name : undefined);
      let base = hint ? `S_${cppIdent(hint)}` : `S_Object${this.structs.size + 1}`;
      let cppName = base;
      let n = 2;
      while (this.structNames.has(cppName)) cppName = `${base}_${n++}`;
      this.structNames.add(cppName);
      info = { id: key, cppName, fields, boundary: false };
      this.structs.set(key, info);
    } else {
      // Same shape from another source type: keep literals only when they agree.
      for (const f of info.fields) {
        const other = fields.find((g) => g.name === f.name);
        if (f.literal !== other?.literal) f.literal = undefined;
      }
    }
    // Patch provisional self references.
    const fix = (t: LType): LType => {
      switch (t.k) {
        case "struct":
          return t.id === provisional ? { k: "struct", id: key } : t;
        case "array":
          return { k: "array", e: fix(t.e) };
        case "set":
          return { k: "set", e: fix(t.e) };
        case "dict":
          return { k: "dict", val: fix(t.val) };
        case "map":
          return { k: "map", key: fix(t.key), val: fix(t.val) };
        case "opt":
          return { k: "opt", inner: fix(t.inner) };
        case "union":
          return { k: "union", ms: t.ms.map(fix) };
        case "tuple":
          return { k: "tuple", es: t.es.map(fix) };
        case "promise":
          return { k: "promise", inner: fix(t.inner) };
        case "fn":
          return { k: "fn", params: t.params.map(fix), ret: fix(t.ret) };
        default:
          return t;
      }
    };
    for (const s of this.structs.values()) for (const f of s.fields) f.type = fix(f.type);
    this.inProgress.delete(type);
    const result: LType = { k: "struct", id: key };
    this.byTsType.set(type, result);
    return result;
  }

  struct(id: string): StructInfo {
    const s = this.structs.get(id);
    if (!s) throw new Error(`unknown struct ${id}`);
    return s;
  }

  iface(id: string): IfaceInfo {
    const s = this.ifaces.get(id);
    if (!s) throw new Error(`unknown interface ${id}`);
    return s;
  }

  cls(id: string): ClassInfo {
    const s = this.classes.get(id);
    if (!s) throw new Error(`unknown class ${id}`);
    return s;
  }

  /** The C++ spelling of a Lucent type. */
  cpp(t: LType): string {
    switch (t.k) {
      case "number":
        return "double";
      case "boolean":
        return "bool";
      case "string":
        return "lucent::String";
      case "void":
        return "void";
      case "undefined":
        return "lucent::Undefined";
      case "null":
        return "lucent::Null";
      case "never":
        return "lucent::Undefined";
      case "array":
        return `lucent::Array<${this.cpp(t.e)}>`;
      case "tuple":
        return `std::tuple<${t.es.map((e) => this.cpp(e)).join(", ")}>`;
      case "map":
        return `lucent::Map<${this.cpp(t.key)}, ${this.cpp(t.val)}>`;
      case "set":
        return `lucent::Set<${this.cpp(t.e)}>`;
      case "dict":
        return `lucent::Dict<${this.cpp(t.val)}>`;
      case "struct":
        return `lucent::Ref<lucent_app::${this.struct(t.id).cppName}>`;
      case "class": {
        const info = this.cls(t.id);
        const args = t.args.length ? `<${t.args.map((a) => this.cpp(a)).join(", ")}>` : "";
        return `lucent::Ref<lucent_app::${info.cppName}${args}>`;
      }
      case "iface":
        return `lucent::Ref<${this.cppIface(t)}>`;
      case "opt":
        return `lucent::Opt<${this.cpp(t.inner)}>`;
      case "union":
        return `std::variant<${t.ms.map((m) => this.cpp(m)).join(", ")}>`;
      case "fn":
        return `lucent::Fn<${this.cppRet(t.ret)}(${t.params.map((p) => this.cpp(p)).join(", ")})>`;
      case "promise":
        return `lucent::Promise<${this.cppRet(t.inner)}>`;
      case "bytes":
        return "lucent::Bytes";
      case "error":
        return "lucent::Error";
      case "date":
        return "lucent::Date";
      case "regexp":
        return "lucent::RegExp";
      case "regexMatch":
        return "lucent::RegExpMatch";
      case "iter":
        return `lucent::Iter<${this.cpp(t.e)}>`;
      case "iterResult":
        return `lucent::IterResult<${this.cpp(t.e)}>`;
      case "abortSignal":
        return "lucent::AbortSignal";
      case "abortController":
        return "lucent::AbortController";
      case "tparam":
        return cppIdent(t.name);
      case "native":
        return "lucent::NativeRef";
    }
  }

  /** Return-position spelling: void stays void. */
  cppRet(t: LType): string {
    if (t.k === "void" || t.k === "undefined" || t.k === "never") return "void";
    return this.cpp(t);
  }

  /** The interface name without Ref<>. */
  cppIface(t: IfaceT): string {
    const args = t.args.length ? `<${t.args.map((a) => this.cpp(a)).join(", ")}>` : "";
    return `lucent_app::${this.iface(t.id).cppName}${args}`;
  }

  /** The class name without Ref<>, for `make_shared` and member access. */
  cppClass(t: LType & { k: "class" }): string {
    const info = this.cls(t.id);
    const args = t.args.length ? `<${t.args.map((a) => this.cpp(a)).join(", ")}>` : "";
    return `lucent_app::${info.cppName}${args}`;
  }
}
