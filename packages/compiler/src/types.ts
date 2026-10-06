import { cpp } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import { Codes, fail } from "./diagnostics.ts";
import {
  builtinSdkModuleOf,
  coreTypesPath,
  extensionModuleOf,
  isLibFile,
  sdkModuleOf,
} from "./program.ts";
import type { Platform } from "./sdk/schema.ts";
import { elementsOf } from "./ui/roots.ts";
import { TOOLKITS, toolkitOfModule } from "./ui/toolkits.ts";

/**
 * Lucent types: the native representation of a TypeScript type. Literal
 * types widen to their base type, `T | undefined | null` becomes `opt`, and
 * other unions become `union` (a std::variant).
 */
export type LType =
  | { k: "number" }
  /** An arbitrary-precision integer (lucent::BigInt). */
  | { k: "bigint" }
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
  /**
   * `T | undefined | null`; `absent` set when TypeScript admits only one of
   * them, which the boundary checks. Not part of typeKey: the C++ type is
   * Opt<T> either way, so object types that differ only there share a
   * struct, whose field then takes both.
   */
  | { k: "opt"; inner: LType; absent?: "undefined" | "null" }
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
  /** lucent:core's NativeBuffer: a handle to bytes native code owns. */
  | { k: "buffer" }
  /** The bytes a NativeBuffer borrow lends (ByteSpan, or MutableByteSpan when writable). */
  | { k: "span"; writable: boolean }
  | { k: "tparam"; name: string }
  /** An object of a platform SDK class (lucent:ios/…, lucent:android/…). */
  | { k: "native"; platform: Platform; module: string; name: string }
  /** A handle of a native extension (lucent:ext/…): an opaque C pointer Lucent owns. */
  | { k: "handle"; extension: string; name: string }
  /** A view's own value (lucent:ui's Signal): lucent::ui::Signal<inner>. */
  | { k: "signal"; inner: LType }
  /** A component's props parameter in its setup: each prop a signal, each event a route. */
  | { k: "props"; component: string }
  /** The mount a setup runs in (lucent::ui::Content), which the functions it makes enter. */
  | { k: "mount" };

/** The error constructors Lucent makes; an error is named after its constructor. */
const ERROR_NAMES = ["Error", "TypeError", "RangeError", "SyntaxError"] as const;

export function isErrorName(name: string): name is (typeof ERROR_NAMES)[number] {
  return (ERROR_NAMES as readonly string[]).includes(name);
}

export const T = {
  number: { k: "number" } as LType,
  bigint: { k: "bigint" } as LType,
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
  buffer: { k: "buffer" } as LType,
  span: { k: "span", writable: false } as LType,
  mutableSpan: { k: "span", writable: true } as LType,
};

/** lucent:core's types that have a native representation of their own, by name. */
const CORE_TYPES: Record<string, LType> = {
  NativeBuffer: T.buffer,
  ByteSpan: T.span,
  MutableByteSpan: T.mutableSpan,
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
    case "span":
      return t.writable ? "mutableSpan" : "span";
    case "handle":
      return `H:${t.extension}.${t.name}`;
    case "signal":
      return `Signal<${typeKey(t.inner)}>`;
    case "props":
      return `Props:${t.component}`;
    default:
      return t.k;
  }
}

/** Whether `sf` is lucent:core's declarations. */
function isCoreFile(sf: ts.SourceFile): boolean {
  return path.resolve(sf.fileName) === path.resolve(coreTypesPath());
}

export function sameType(a: LType, b: LType): boolean {
  return typeKey(a) === typeKey(b);
}

/**
 * Builds `a | b | ...` in canonical form. `void` among other members is
 * what it gives as a value, undefined (`void | undefined` is undefined).
 */
export function unionOf(members: LType[]): LType {
  if (members.length > 0 && members.every((m) => m.k === "void")) return T.void;

  let [hasNull, hasUndefined] = [false, false];
  const flat: LType[] = [];
  const add = (m: LType) => {
    if (m.k === "undefined" || m.k === "void") hasUndefined = true;
    else if (m.k === "null") hasNull = true;
    else if (m.k === "opt") {
      hasNull ||= m.absent !== "undefined";
      hasUndefined ||= m.absent !== "null";
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
    // `null | undefined`: an optional that never holds a value.
    if (hasNull && hasUndefined) return { k: "opt", inner: T.undefined };
    return hasNull ? T.null : hasUndefined ? T.undefined : T.never;
  } else if (ms.length === 1) core = ms[0]!;
  else core = { k: "union", ms };
  if (hasNull && hasUndefined) return { k: "opt", inner: core };
  if (hasNull || hasUndefined)
    return { k: "opt", inner: core, absent: hasNull ? "null" : "undefined" };
  return core;
}

/** Types an optional absorbs rather than holds: `T | undefined` with T one of them is not Opt<T>. */
const MERGES_INTO_OPTIONAL: readonly LType["k"][] = ["opt", "undefined", "null", "void", "never"];

/** Types a union absorbs rather than holds as one member: its members flatten into the union. */
const MERGES_INTO_UNION: readonly LType["k"][] = [...MERGES_INTO_OPTIONAL, "union"];

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
    case "opt": {
      const inner = substitute(t.inner, map);

      return MERGES_INTO_OPTIONAL.includes(inner.k)
        ? unionOf([inner, t.absent === "null" ? T.null : T.undefined])
        : { ...t, inner };
    }
    case "union": {
      // In the order of the generic's declaration, which its C++ template
      // keeps, when the members stay distinct members (unionShapeBreak).
      const ms = t.ms.map((m) => substitute(m, map));
      const distinct = new Set(ms.map(typeKey)).size === ms.length;

      return distinct && !ms.some((m) => MERGES_INTO_UNION.includes(m.k))
        ? { k: "union", ms }
        : unionOf(ms);
    }
    case "tuple":
      return { k: "tuple", es: t.es.map((e) => substitute(e, map)) };
    case "promise":
      return { k: "promise", inner: substitute(t.inner, map) };
    case "fn":
      return {
        k: "fn",
        params: t.params.map((p) => substitute(p, map)),
        ret: substitute(t.ret, map),
      };
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

/**
 * The first union or optional in `t` holding a type parameter that
 * substituting `args` would reshape. A generic compiles once, as a C++
 * template in which `A | B` is std::variant<A, B> and `T | undefined` is
 * Opt<T>, so it can only be instantiated with types that keep those
 * shapes: not a union, an optional, null or undefined as a member, nor a
 * member the union already has. Undefined when every union keeps its shape.
 */
export function unionShapeBreak(
  t: LType,
  args: Map<string, LType>,
): { param: string; arg: LType } | undefined {
  const param = (u: LType) => (u.k === "tparam" && args.has(u.name) ? u.name : undefined);
  const mentioned = (u: LType): string | undefined =>
    param(u) ??
    typeParts(u)
      .map(mentioned)
      .find((name) => name !== undefined);

  if (t.k === "opt") {
    const name = param(t.inner);
    const arg = name ? args.get(name)! : undefined;

    if (name && arg && MERGES_INTO_OPTIONAL.includes(arg.k)) return { param: name, arg };
  }

  if (t.k === "union") {
    const subs = t.ms.map((m) => substitute(m, args));
    const keys = subs.map(typeKey);

    for (const [i, m] of t.ms.entries()) {
      const name = param(m);
      const first = keys.indexOf(keys[i]!);
      const clash = first !== i ? (mentioned(m) ?? mentioned(t.ms[first]!)) : undefined;

      if (name && MERGES_INTO_UNION.includes(subs[i]!.k)) return { param: name, arg: subs[i]! };
      if (clash) return { param: clash, arg: subs[i]! };
    }
  }

  for (const part of typeParts(t)) {
    const found = unionShapeBreak(part, args);

    if (found) return found;
  }

  return undefined;
}

/** The types a type is made of, one level down. */
function typeParts(t: LType): readonly LType[] {
  switch (t.k) {
    case "array":
    case "set":
    case "iter":
    case "iterResult":
      return [t.e];
    case "map":
      return [t.key, t.val];
    case "dict":
      return [t.val];
    case "opt":
    case "promise":
      return [t.inner];
    case "union":
      return t.ms;
    case "tuple":
      return t.es;
    case "fn":
      return [...t.params, t.ret];
    case "class":
    case "iface":
      return t.args;
    default:
      return [];
  }
}

export function stripOpt(t: LType): LType {
  return t.k === "opt" ? t.inner : t;
}

export function isVoidish(t: LType): boolean {
  return t.k === "void" || t.k === "undefined" || t.k === "never";
}

/**
 * Whether comparing a value of type `t` compares a function: a function,
 * or an optional, union or tuple (compared element by element) that can
 * hold one. Arrays, maps and other objects compare by reference instead.
 */
export function holdsFunction(t: LType): boolean {
  if (t.k === "fn") return true;

  const parts = t.k === "opt" ? [t.inner] : t.k === "union" ? t.ms : t.k === "tuple" ? t.es : [];

  return parts.some(holdsFunction);
}

/**
 * The diagnostic for comparing functions, which Lucent refuses: `detail`
 * says where the comparison is (", so `indexOf` cannot search them").
 */
export function functionsNotCompared(detail: string): string {
  return `functions cannot be compared${detail}: Lucent does not keep a function value's identity (a named function is a new value at each use)`;
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
  /**
   * The SDK class this one extends: a generated Java (Android) or
   * Objective-C (iOS) subclass stands for its instances.
   */
  sdkBase?: LType & { k: "native" };
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
    "xor_eq final override assert errno NULL EOF stdin stdout stderr main std lucent jsi facebook self " +
    // Objective-C's types, macros and method names, and JNI's environment and macros, which platform glue uses.
    "id Class SEL IMP BOOL YES NO nil Nil _cmd super env JNI_TRUE JNI_FALSE"
  ).split(" "),
);

/** A C++-safe identifier for a TypeScript name. */
/** The C++ namespace of a module, which also names its generated files (m_<name>.cpp). */
export function moduleNamespace(name: string): string {
  // Behind `m_`, no name spells a glue temporary: file names stay as they were.
  return `m_${safeIdent(name)}`;
}

/**
 * C++ names of the symbol-keyed members Lucent supports, by the name
 * memberName gives them. No identifier escapes to these, nor to the glue's
 * temporaries (which end in `_`): a name that would end in `_` gets a `u_`
 * prefix; reserved words and names with `__` get a `_` appended, and then
 * an `r_` prefix unless they have one.
 */
const SYMBOL_MEMBERS = new Map([["[Symbol.dispose]", "symbol_dispose_"]]);

export function cppIdent(name: string): string {
  const symbol = SYMBOL_MEMBERS.get(name);
  if (symbol) return symbol;

  // A reserved word made safe (`id_`) is spelled like a temporary too: a prefix of its own.
  const out = safeIdent(name);
  return out.endsWith("_") && !out.startsWith("u_") ? `r_${out}` : out;
}

/** A C++-safe identifier: characters escaped, reserved words and `__` given a trailing `_`. */
function safeIdent(name: string): string {
  let out = name.replace(/[^A-Za-z0-9_]/g, (c) => `_u${c.codePointAt(0)!.toString(16)}_`);
  if (/^[0-9]/.test(out)) out = `_${out}`;
  // The glue's temporaries end in `_` (v_, r_, o_): Lucent names that do get a prefix of their own.
  if (out.endsWith("_")) out = `u_${out}`;
  // Lucent's own macros (LUCENT_STR) stay defined where generated code undefines the program's names.
  if (RESERVED.has(out) || out.includes("__") || /^_[A-Z]/.test(out) || out.startsWith("LUCENT_"))
    out = `${out}_`;
  return out;
}

/** Registry of every struct and class the program uses. */
export class TypeRegistry {
  readonly structs = new Map<string, StructInfo>();
  readonly classes = new Map<string, ClassInfo>();
  readonly ifaces = new Map<string, IfaceInfo>();
  /** Components' props structs (emit/views.ts), by component id: their C++ names. */
  readonly componentStructs = new Map<string, string>();
  private readonly structNames = new Set<string>();
  private readonly byTsType = new Map<ts.Type, LType>();
  private readonly inProgress = new Map<ts.Type, string>();
  private anon = 0;
  readonly checker: ts.TypeChecker;
  readonly isLucentFile: (sf: ts.SourceFile) => boolean;
  /** The platform of the program lowered: a shared file's JSX element is its toolkit's there. */
  platform?: Platform;

  constructor(checker: ts.TypeChecker, isLucentFile: (sf: ts.SourceFile) => boolean) {
    this.checker = checker;
    this.isLucentFile = isLucentFile;
  }

  componentProps(id: string): string {
    const name = this.componentStructs.get(id);
    if (!name) throw new Error(`no props struct for the component ${id}`);
    return name;
  }

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
        const args = (type as ts.TypeReference).target
          ? this.checker
              .getTypeArguments(type as ts.TypeReference)
              .slice(0, iface.typeParams.length)
          : [];
        // Lowered lazily: argument types may name classes not registered yet.
        this.pendingImplements.push(() =>
          iface.implementers.set(
            info.id,
            args.map((a) => this.lower(a, t)),
          ),
        );
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
    const info: IfaceInfo = {
      id,
      cppName,
      decl,
      typeParams: decl.typeParameters?.map((p) => p.name.text) ?? [],
      implementers: new Map(),
    };
    this.ifaces.set(id, info);
    // Base interfaces dispatch virtually too, even without methods of their own.
    for (const h of decl.heritageClauses ?? []) {
      for (const t of h.types) {
        const base = this.lucentInterface(this.checker.getTypeAtLocation(t).getSymbol());
        if (!base)
          fail(
            t,
            Codes.InterfaceMismatch,
            `interface ${name} can only extend other Lucent interfaces`,
          );
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
    const map = new Map(
      info.typeParams.map(
        (p, i) => [p, t.args[i] ?? ({ k: "tparam", name: p } as LType)] as [string, LType],
      ),
    );
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
    return [...this.ifaces.values()]
      .filter((i) => i.implementers.has(info.id))
      .map((i) => ({ k: "iface", id: i.id, args: i.implementers.get(info.id)! }));
  }

  /** Whether class type `c` (or an ancestor) implements `target` or an interface extending it. */
  implementsIface(c: LType & { k: "class" }, target: IfaceT): boolean {
    const want = typeKey(target);
    for (const link of this.chain(c)) {
      const map = new Map(
        link.info.typeParams.map(
          (p, i) => [p, link.t.args[i] ?? ({ k: "tparam", name: p } as LType)] as [string, LType],
        ),
      );
      for (const i of this.declaredIfaces(link.info)) {
        if (this.ifaceChain(substitute(i, map) as IfaceT).some((x) => typeKey(x) === want))
          return true;
      }
    }
    return false;
  }

  /** Non-generic classes whose instances are `target`s, deepest first. */
  implementations(target: IfaceT): ClassInfo[] {
    const all = [...this.classes.values()].filter(
      (c) =>
        !c.typeParams.length && this.implementsIface({ k: "class", id: c.id, args: [] }, target),
    );
    return all.sort((a, b) => this.ancestors(b).length - this.ancestors(a).length);
  }

  /** Resolves `extends` once every class is registered. */
  resolveBase(info: ClassInfo): void {
    const h = info.decl.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword);
    const expr = h?.types[0];
    if (!expr || expr.expression.getText() === "Error") return;
    const t = this.lower(this.checker.getTypeAtLocation(expr), expr);
    if (t.k === "native") {
      info.sdkBase = t;
      return;
    }
    if (t.k !== "class")
      fail(
        expr,
        Codes.UnsupportedClassFeature,
        "classes can only extend Lucent classes, Error and SDK classes",
      );
    info.base = { id: t.id, args: t.args };
  }

  /** Marks subclasses of Error classes as errors (after resolveBase). */
  propagateErrors(): void {
    for (const c of this.classes.values())
      if (this.ancestors(c).some((a) => a.isError)) c.isError = true;
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
      const map = new Map(
        info.typeParams.map(
          (p, i) => [p, cur!.args[i] ?? { k: "tparam", name: p }] as [string, LType],
        ),
      );
      cur = info.base
        ? { k: "class", id: info.base.id, args: info.base.args.map((a) => substitute(a, map)) }
        : undefined;
    }
    return out;
  }

  /** Every class that extends `id`, directly or not, deepest first. */
  descendants(id: string): ClassInfo[] {
    const out = [...this.classes.values()].filter((c) =>
      this.ancestors(c).some((a) => a.id === id),
    );
    return out.sort((a, b) => this.ancestors(b).length - this.ancestors(a).length);
  }

  /** Whether `sub` is `sup` or extends it. */
  derives(sub: string, sup: string): boolean {
    return sub === sup || this.ancestors(this.cls(sub)).some((a) => a.id === sup);
  }

  /** Whether `sub`, with its type arguments, is `sup` or extends it: one instantiation is not another. */
  extendsType(sub: LType & { k: "class" }, sup: LType & { k: "class" }): boolean {
    return this.chain(sub).some((c) => sameType(c.t, sup));
  }

  /**
   * Class `id` instantiated so that it is or extends `target` (`Sub<T> extends
   * Box<T>` as a `Box<number | undefined>` is a `Sub<number | undefined>`);
   * undefined when its type arguments do not follow from target's.
   */
  instantiatedAs(id: string, target: LType & { k: "class" }): (LType & { k: "class" }) | undefined {
    const info = this.cls(id);
    const generic: LType & { k: "class" } = {
      k: "class",
      id,
      args: info.typeParams.map((name) => ({ k: "tparam", name })),
    };
    const at = this.chain(generic).find((c) => c.info.id === target.id);

    if (!at) return undefined;

    const map = new Map<string, LType>();

    for (const [i, arg] of at.t.args.entries()) {
      const wanted = target.args[i];

      if (!wanted) return undefined;

      if (arg.k !== "tparam") {
        if (!sameType(arg, wanted)) return undefined;
        continue;
      }

      const bound = map.get(arg.name);

      if (bound && !sameType(bound, wanted)) return undefined;

      map.set(arg.name, wanted);
    }

    if (info.typeParams.some((p) => !map.has(p))) return undefined;

    return { k: "class", id, args: info.typeParams.map((p) => map.get(p)!) };
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
    if (f & ts.TypeFlags.Any)
      fail(
        node,
        Codes.AnyType,
        "`any` has no native representation; give this value a concrete type",
      );
    if (f & ts.TypeFlags.Unknown)
      fail(
        node,
        Codes.AnyType,
        "`unknown` has no native representation; narrow it or give it a concrete type",
      );
    if (f & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return T.number;
    if (
      f &
      (ts.TypeFlags.String |
        ts.TypeFlags.StringLiteral |
        ts.TypeFlags.TemplateLiteral |
        ts.TypeFlags.StringMapping)
    )
      return T.string;
    if (f & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return T.boolean;
    if (f & ts.TypeFlags.Void) return T.void;
    if (f & ts.TypeFlags.Undefined) return T.undefined;
    if (f & ts.TypeFlags.Null) return T.null;
    if (f & ts.TypeFlags.Never) return T.never;
    if (f & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) return T.bigint;
    if (f & ts.TypeFlags.ESSymbolLike)
      fail(node, Codes.UnsupportedType, "symbols are not supported");
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
    // An enum without members (another SDK module's, declared by name only): numbers.
    if (f & ts.TypeFlags.Enum) return T.number;
    // IteratorResult<T, TReturn> is a lib alias for a union whose return half
    // carries TReturn (often any); only the yielded type matters here.
    if (
      type.aliasSymbol?.name === "IteratorResult" &&
      type.aliasTypeArguments?.[0] &&
      this.libName(type)
    ) {
      return { k: "iterResult", e: this.lower(type.aliasTypeArguments[0], node) };
    }
    if (type.isUnion()) {
      return unionOf(type.types.map((t) => this.lower(t, node)));
    }
    // A shared file's JSX element (`View & Composed`): the target platform's toolkit's.
    const elements = type.isIntersection() ? elementsOf(type) : undefined;
    if (elements) {
      const own = elements.find((t) => {
        const decl = t.getSymbol()?.declarations?.[0];
        const module = decl && builtinSdkModuleOf(decl.getSourceFile());
        return !!module && toolkitPlatform(module) === this.platform;
      });
      return this.lower(own ?? elements[0]!, node);
    }
    if (type.isIntersection())
      fail(
        node,
        Codes.UnsupportedType,
        `intersection types are not supported: ${c.typeToString(type)}`,
      );
    if (f & ts.TypeFlags.Object) return this.lowerObject(type as ts.ObjectType, node);
    if (f & ts.TypeFlags.NonPrimitive)
      fail(
        node,
        Codes.UnsupportedType,
        "`object` has no native representation; use a concrete object type",
      );
    fail(node, Codes.UnsupportedType, `type ${c.typeToString(type)} is not supported`);
  }

  /** A Map key or Set element: compared on every lookup, so never a function. */
  private key(type: ts.Type, node: ts.Node): LType {
    const t = this.lower(type, node);

    if (holdsFunction(t))
      fail(
        node,
        Codes.UnsupportedType,
        functionsNotCompared(", so they cannot be Map keys or Set elements"),
      );

    return t;
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
    const core =
      sdkSym &&
      decl &&
      isCoreFile(decl.getSourceFile()) &&
      c.getDeclaredTypeOfSymbol(sdkSym) === type
        ? CORE_TYPES[sdkSym.name]
        : undefined;
    if (core) return core;
    // lucent:ios's NSObject and Out are platform objects too, and so are a
    // toolkit's values (SwiftUI's types are interfaces).
    const declaredIn = decl && builtinSdkModuleOf(decl.getSourceFile());
    const toolkitValue = !!decl && ts.isInterfaceDeclaration(decl) && !!toolkitOfModule(declaredIn);
    const builtin = decl && (ts.isClassDeclaration(decl) || toolkitValue) ? declaredIn : undefined;
    if (builtin && sdkSym)
      return {
        k: "native",
        // A toolkit's classes (Compose's ComposeView) are its platform's.
        platform: toolkitPlatform(builtin) ?? (builtin === "lucent:android" ? "android" : "ios"),
        module: builtin,
        name: sdkSym.name,
      };
    const extension =
      decl && ts.isClassDeclaration(decl) ? extensionModuleOf(decl.getSourceFile()) : undefined;
    if (extension && sdkSym) {
      if (
        type.getConstructSignatures().length ||
        c.getTypeOfSymbolAtLocation(sdkSym, decl!) === type
      )
        fail(node, Codes.UnsupportedSyntax, `the class ${sdkSym.name} can only be used with new`);

      return { k: "handle", extension, name: sdkSym.name };
    }
    const sdk = decl && ts.isClassDeclaration(decl) ? sdkModuleOf(decl.getSourceFile()) : undefined;
    if (sdk && sdkSym) {
      if (
        type.getConstructSignatures().length ||
        c.getTypeOfSymbolAtLocation(sdkSym, decl!) === type
      ) {
        fail(
          node,
          Codes.UnsupportedSyntax,
          `the class ${sdkSym.name} can only be used with new, static members, or as a Class<T> argument`,
        );
      }
      return { k: "native", platform: sdk.platform, module: sdk.module, name: sdkSym.name };
    }
    if (c.isTupleType(type)) {
      return {
        k: "tuple",
        es: c.getTypeArguments(type as ts.TypeReference).map((t) => this.lower(t, node)),
      };
    }
    if (c.isArrayType(type)) {
      const [e] = c.getTypeArguments(type as ts.TypeReference);
      return { k: "array", e: this.lower(e!, node) };
    }
    // lucent:ui's Signal<T>, a view's own tracked value.
    if (
      decl &&
      ts.isInterfaceDeclaration(decl) &&
      decl.name.text === "Signal" &&
      builtinSdkModuleOf(decl.getSourceFile()) === "lucent:ui"
    ) {
      const [inner] = c.getTypeArguments(type as ts.TypeReference);
      return { k: "signal", inner: this.lower(inner!, node) };
    }
    const lib = this.libName(type);
    if (lib && isErrorName(lib)) return T.error;
    if (lib) {
      const args = c.getTypeArguments(type as ts.TypeReference);
      switch (lib) {
        case "Map":
        case "ReadonlyMap":
          return { k: "map", key: this.key(args[0]!, node), val: this.lower(args[1]!, node) };
        case "Set":
        case "ReadonlySet":
          return { k: "set", e: this.key(args[0]!, node) };
        case "Promise":
        case "PromiseLike":
          return { k: "promise", inner: this.lower(args[0]!, node) };
        case "Uint8Array":
          return T.bytes;
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
          const args = (type as ts.TypeReference).target
            ? c.getTypeArguments(type as ts.TypeReference).slice(0, info.typeParams.length)
            : [];
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
        const args = (type as ts.TypeReference).target
          ? c.getTypeArguments(type as ts.TypeReference).slice(0, info.typeParams.length)
          : [];
        return { k: "iface", id: info.id, args: args.map((a) => this.lower(a, node)) };
      }
    }
    const calls = type.getCallSignatures();
    const props = c.getPropertiesOfType(type);
    if (calls.length > 0) {
      if (calls.length > 1)
        fail(node, Codes.UnsupportedType, "overloaded function types are not supported");
      if (props.length > 0)
        fail(node, Codes.UnsupportedType, "functions with properties are not supported");
      return this.lowerSignature(calls[0]!, node);
    }
    if (type.getConstructSignatures().length > 0)
      fail(node, Codes.UnsupportedType, "constructor types are not supported");
    const indexInfos = c.getIndexInfosOfType(type);
    if (indexInfos.length > 0) {
      if (props.length > 0)
        fail(
          node,
          Codes.UnsupportedType,
          "objects with both an index signature and properties are not supported",
        );
      const info = indexInfos[0]!;
      if (!(info.keyType.flags & ts.TypeFlags.String))
        fail(node, Codes.UnsupportedType, "only string-keyed records are supported");
      return { k: "dict", val: this.lower(info.type, node) };
    }
    if (lib && !["Object"].includes(lib))
      fail(node, Codes.UnsupportedType, `${lib} is not supported`);
    return this.registerStruct(type, props, node);
  }

  lowerSignature(sig: ts.Signature, node: ts.Node): LType {
    const c = this.checker;
    const params = sig.getParameters().map((p) => {
      const decl = p.valueDeclaration;
      let t = this.lower(c.getTypeOfSymbolAtLocation(p, decl ?? node), decl ?? node);
      if (decl && ts.isParameter(decl) && (decl.questionToken || decl.initializer) && t.k !== "opt")
        t = { k: "opt", inner: t, absent: "undefined" };
      if (decl && ts.isParameter(decl) && decl.dotDotDotToken)
        fail(
          decl,
          Codes.UnsupportedType,
          "rest parameters in function types are not supported",
          "take the arguments as one array parameter",
        );
      return t;
    });
    return { k: "fn", params, ret: this.lower(c.getReturnTypeOfSignature(sig), node) };
  }

  private structField(p: ts.Symbol, node: ts.Node): StructField {
    const c = this.checker;
    const accessor = p.declarations?.find(
      (d) => ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d),
    );
    if (accessor && ts.isObjectLiteralExpression(accessor.parent))
      fail(
        accessor,
        Codes.UnsupportedSyntax,
        `getters and setters in object literals are not supported (${p.name}); use a property or a class`,
      );
    if (p.flags & ts.SymbolFlags.Method)
      fail(
        node,
        Codes.UnsupportedType,
        `object types with methods are not supported (${p.name}); use a class or a function-valued property`,
      );
    if (p.flags & ts.SymbolFlags.GetAccessor)
      fail(node, Codes.UnsupportedType, `getters in object types are not supported (${p.name})`);
    const decl = p.valueDeclaration ?? p.declarations?.[0];
    const pt = c.getTypeOfSymbolAtLocation(p, decl ?? node);
    const optional = !!(p.flags & ts.SymbolFlags.Optional);
    let lt = this.lower(optional ? c.getNonNullableType(pt) : pt, decl ?? node);
    if (optional) lt = unionOf([lt, T.undefined]);
    let literal: string | undefined;
    if (pt.flags & ts.TypeFlags.StringLiteral) literal = (pt as ts.StringLiteralType).value;
    const readonly =
      !!decl &&
      ts.canHaveModifiers(decl) &&
      !!ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
    return { name: p.name, type: lt, optional, literal, readonly };
  }

  private registerStruct(type: ts.Type, props: ts.Symbol[], node: ts.Node): LType {
    const pending = this.inProgress.get(type);
    if (pending) return { k: "struct", id: pending };
    // Provisional id so recursive references resolve.
    const provisional = `pending${this.anon++}`;
    this.inProgress.set(type, provisional);
    let fields: StructField[];
    try {
      fields = props.map((p) => this.structField(p, node));
    } catch (e) {
      // Leave no provisional id behind: a later lowering of this type would resolve to it.
      this.inProgress.delete(type);
      throw e;
    }
    const key = fields
      .map(
        (f) =>
          `${f.name}${f.optional ? "?" : ""}:${f.type.k === "struct" && f.type.id.startsWith("pending") ? "self" : typeKey(f.type)}`,
      )
      .sort()
      .join(";");
    let info = this.structs.get(key);
    if (!info) {
      const hint =
        type.aliasSymbol?.name ??
        (type.getSymbol()?.name && !type.getSymbol()!.name.startsWith("__")
          ? type.getSymbol()!.name
          : undefined);
      let base = hint ? `S_${cppIdent(hint)}` : `S_Object${this.structs.size + 1}`;
      let cppName = base;
      let n = 2;
      while (this.structNames.has(cppName)) cppName = `${base}_${n++}`;
      this.structNames.add(cppName);
      info = { id: key, cppName, fields, boundary: false };
      this.structs.set(key, info);
    } else {
      // Same shape from another source type: keep literals, and the one absent
      // value a field admits, only when they agree.
      for (const f of info.fields) {
        const other = fields.find((g) => g.name === f.name);
        if (f.literal !== other?.literal) f.literal = undefined;
        if (f.type.k === "opt" && other?.type.k === "opt" && f.type.absent !== other.type.absent)
          f.type = { k: "opt", inner: f.type.inner };
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
          return { ...t, inner: fix(t.inner) };
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
  /** The C++ type of a Lucent value. */
  cppType(t: LType): cpp.Type {
    const lucent = (name: string, ...args: cpp.TemplateArg[]) =>
      cpp.type(`lucent::${name}`, ...args);
    switch (t.k) {
      case "number":
        return cpp.type("double");
      case "bigint":
        return lucent("BigInt");
      case "boolean":
        return cpp.type("bool");
      case "string":
        return lucent("String");
      case "void":
        return cpp.voidType;
      case "undefined":
      case "never":
        return lucent("Undefined");
      case "null":
        return lucent("Null");
      case "array":
        return lucent("Array", this.cppType(t.e));
      case "tuple":
        return cpp.type("std::tuple", ...t.es.map((e) => this.cppType(e)));
      case "map":
        return lucent("Map", this.cppType(t.key), this.cppType(t.val));
      case "set":
        return lucent("Set", this.cppType(t.e));
      case "dict":
        return lucent("Dict", this.cppType(t.val));
      case "struct":
        return lucent("Ref", cpp.type(`lucent_app::${this.struct(t.id).cppName}`));
      case "class":
        return lucent("Ref", this.cppClassType(t));
      case "iface":
        return lucent("Ref", this.cppIfaceType(t));
      case "opt":
        return lucent("Opt", this.cppType(t.inner));
      case "union":
        return cpp.type("std::variant", ...t.ms.map((m) => this.cppType(m)));
      case "fn":
        return lucent(
          "Fn",
          cpp.fnType(
            this.cppRetType(t.ret),
            t.params.map((p) => this.cppType(p)),
          ),
        );
      case "promise":
        return lucent("Promise", this.cppRetType(t.inner));
      case "bytes":
        return lucent("Bytes");
      case "error":
        return lucent("Error");
      case "date":
        return lucent("Date");
      case "regexp":
        return lucent("RegExp");
      case "regexMatch":
        return lucent("RegExpMatch");
      case "iter":
        return lucent("Iter", this.cppType(t.e));
      case "iterResult":
        return lucent("IterResult", this.cppType(t.e));
      case "abortSignal":
        return lucent("AbortSignal");
      case "abortController":
        return lucent("AbortController");
      case "buffer":
        return lucent("NativeBuffer");
      case "span":
        return lucent(t.writable ? "MutableByteSpan" : "ByteSpan");
      case "tparam":
        return cpp.type(cppIdent(t.name));
      case "native":
        return lucent("NativeRef");
      case "handle":
        return lucent("Handle");
      case "signal":
        return cpp.type("lucent::ui::Signal", this.cppType(t.inner));
      case "props":
        return cpp.type(this.componentProps(t.component));
      case "mount":
        return cpp.type("std::weak_ptr", cpp.type("lucent::ui::Content"));
    }
  }

  /** Return-position type: void stays void. */
  cppRetType(t: LType): cpp.Type {
    if (t.k === "void" || t.k === "undefined" || t.k === "never") return cpp.voidType;
    return this.cppType(t);
  }

  /** The interface type without Ref<>. */
  cppIfaceType(t: IfaceT): cpp.Type {
    return cpp.type(
      `lucent_app::${this.iface(t.id).cppName}`,
      ...t.args.map((a) => this.cppType(a)),
    );
  }

  /** The class type without Ref<>, for `make_shared` and member access. */
  cppClassType(t: LType & { k: "class" }): cpp.Type {
    return cpp.type(`lucent_app::${this.cls(t.id).cppName}`, ...t.args.map((a) => this.cppType(a)));
  }

  /** The C++ spelling of a Lucent value's type (printed cppType). */
  cpp(t: LType): string {
    return cpp.printType(this.cppType(t));
  }

  /** Return-position spelling: void stays void. */
  cppRet(t: LType): string {
    return cpp.printType(this.cppRetType(t));
  }

  /** The interface name without Ref<>. */
  cppIface(t: IfaceT): string {
    return cpp.printType(this.cppIfaceType(t));
  }

  /** The class name without Ref<>, for `make_shared` and member access. */
  cppClass(t: LType & { k: "class" }): string {
    return cpp.printType(this.cppClassType(t));
  }
}

/** The platform of a toolkit's module (`lucent:compose`: Android), if it is one. */
function toolkitPlatform(module: string): Platform | undefined {
  const toolkit = toolkitOfModule(module);

  return toolkit && TOOLKITS[toolkit].platform;
}
