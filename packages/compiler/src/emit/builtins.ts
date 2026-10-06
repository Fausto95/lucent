import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { literalConstant } from "../analysis/index.ts";
import { Codes, fail } from "../diagnostics.ts";
import { isLibFile } from "../program.ts";
import {
  type ClassInfo,
  cppIdent,
  functionsNotCompared,
  holdsFunction,
  isErrorName,
  isVoidish,
  type LType,
  stripOpt,
  T,
  typeKey,
  unionOf,
} from "../types.ts";
import { AUTO_CLOSEABLE, sdkClassIs } from "../sdk/schema.ts";
import {
  bufferDispose,
  bufferMethod,
  bufferProperty,
  bufferStatic,
  spanMethod,
  spanProperty,
} from "./buffers.ts";
import { DISPOSE, findMember } from "./classes.ts";
import { type E, type Lvalue } from "./context.ts";
import { coreCall, isCoreSymbol } from "./core.ts";
import { type FnEmitter, substitute } from "./function.ts";
import { signalMethod } from "./setups.ts";
import { type IfaceMember, membersOf } from "./interfaces.ts";
import { numberExpr, stringExpr } from "./literals.ts";
import { handleDispose, handleMethodCall } from "./extensions.ts";
import {
  inMainContext,
  nativeCall,
  nativeInstanceOf,
  nativeLvalue,
  nativeMember,
} from "./native.ts";
import {
  requireSubclassMain,
  subclassName,
  subclassNative,
  subclassSuper,
  subclassSuperCall,
} from "./objc-subclass.ts";

type FnT = LType & { k: "fn" };
const fn = (params: LType[], ret: LType): FnT => ({ k: "fn", params, ret });

/** Emits a callback argument as a Fn with exactly `params`. */
function callback(em: FnEmitter, arg: ts.Expression | undefined, params: LType[], ret?: LType): E {
  if (!arg) fail(undefined, Codes.UnsupportedCall, "missing callback");
  const sig = em.checker.getTypeAtLocation(arg).getCallSignatures()[0];
  if (!sig) fail(arg, Codes.UnsupportedCall, "expected a function");
  const r = ret ?? em.reg.lower(em.checker.getReturnTypeOfSignature(sig), arg);
  const target = fn(params, r);
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    const e = em.closure(arg, target);
    return { c: em.coerce(e, target, arg), t: target };
  }
  return { c: em.coerce(em.expr(arg), target, arg), t: target };
}

function argAs(em: FnEmitter, node: ts.CallExpression, i: number, t: LType): cpp.Expr {
  const a = node.arguments[i];
  if (!a) fail(node, Codes.UnsupportedCall, `missing argument ${i + 1}`);
  return em.exprAs(a, t);
}

/** The value JavaScript gives a numeric argument passed as undefined (ToNumber). */
const NAN = cpp.id("lucent::kNaN");

/** An end index passed as undefined: the end. */
const END = cpp.id("lucent::kInfinity");

/**
 * `a` as `t`. When `a` may be undefined, undefined reads as `ifUndefined`:
 * what JavaScript makes of the undefined argument (NaN through ToNumber, or
 * the value of the argument left out).
 */
function orUndefined(em: FnEmitter, a: ts.Expression, t: LType, ifUndefined: cpp.Expr): cpp.Expr {
  if (!mayBeUndefined(em.lt(a))) return em.exprAs(a, t);

  return cpp.call(cpp.dot(em.exprAs(a, unionOf([t, T.undefined])), "valueOr"), [ifUndefined]);
}

/** A number, or an Opt<double> when it may be undefined, for a runtime overload that takes either. */
function numberOrOptional(em: FnEmitter, a: ts.Expression): cpp.Expr {
  return em.exprAs(a, mayBeUndefined(em.lt(a)) ? unionOf([T.number, T.undefined]) : T.number);
}

/** `new Array(n).fill(value)`: every hole `new Array(n)` makes is filled before anything sees it. */
function filledWhole(node: ts.NewExpression): boolean {
  const access = node.parent;

  return (
    ts.isPropertyAccessExpression(access) &&
    access.name.text === "fill" &&
    ts.isCallExpression(access.parent) &&
    access.parent.expression === access &&
    access.parent.arguments.length === 1
  );
}

function holdsNumber(t: LType): boolean {
  const held = stripOpt(t);

  return held.k === "number" || (held.k === "union" && held.ms.some((m) => m.k === "number"));
}

function mayBeUndefined(t: LType): boolean {
  return t.k === "opt" || t.k === "undefined" || t.k === "void";
}

/** An optional argument: undefined when left out, `ifUndefined` when passed as undefined. */
function optArg(
  em: FnEmitter,
  node: ts.CallExpression,
  i: number,
  t: LType,
  ifUndefined: cpp.Expr,
): cpp.Expr | undefined {
  const a = node.arguments[i];
  return a && orUndefined(em, a, t, ifUndefined);
}

/** Arguments up to the first absent one (optional arguments left out). */
function argList(...xs: (cpp.Expr | undefined)[]): cpp.Expr[] {
  const at = xs.indexOf(undefined);
  return (at < 0 ? xs : xs.slice(0, at)) as cpp.Expr[];
}

const num = (c: cpp.Expr): E => ({ c, t: T.number });
const big = (c: cpp.Expr): E => ({ c, t: T.bigint });
const bool = (c: cpp.Expr): E => ({ c, t: T.boolean });
const str = (c: cpp.Expr): E => ({ c, t: T.string });

// --- properties -----------------------------------------------------------------------

export function property(_em: FnEmitter, obj: E, name: string, node: ts.Node): E {
  const t = obj.t;
  const o = obj.c;
  switch (t.k) {
    case "string":
      if (name === "length")
        return num(cpp.staticCast(cpp.type("double"), cpp.call(cpp.dot(o, "length"), [])));
      break;
    case "array":
      if (name === "length") return num(cpp.call(cpp.dot(o, "length"), []));
      break;
    case "tuple":
      if (name === "length") return num(numberExpr(t.es.length));
      break;
    case "map":
    case "set":
      if (name === "size") return num(cpp.call(cpp.dot(o, "size"), []));
      break;
    case "bytes":
      if (name === "length" || name === "byteLength")
        return num(cpp.call(cpp.dot(o, "length"), []));
      break;
    case "dict":
      // `record.key` is `record["key"]` on an index signature.
      return {
        c: cpp.call(cpp.dot(o, "get"), [stringExpr(name)]),
        t: unionOf([t.val, T.undefined]),
      };
    case "regexp":
      if (name === "source") return str(cpp.call(cpp.arrow(o, "source"), []));
      if (name === "flags") return str(cpp.call(cpp.arrow(o, "canonicalFlags"), []));
      if (
        [
          "global",
          "ignoreCase",
          "multiline",
          "dotAll",
          "unicode",
          "unicodeSets",
          "sticky",
          "hasIndices",
        ].includes(name)
      )
        return bool(cpp.call(cpp.arrow(o, name), []));
      if (name === "lastIndex") return num(cpp.arrow(o, "lastIndex"));
      break;
    case "regexMatch":
      if (name === "length")
        return num(
          cpp.staticCast(cpp.type("double"), cpp.call(cpp.dot(cpp.arrow(o, "items"), "size"), [])),
        );
      if (name === "index")
        return { c: cpp.arrow(o, "index"), t: unionOf([T.number, T.undefined]) };
      if (name === "input")
        return { c: cpp.arrow(o, "input"), t: unionOf([T.string, T.undefined]) };
      if (name === "groups")
        return {
          c: cpp.arrow(o, "groups"),
          t: unionOf([{ k: "dict", val: T.string }, T.undefined]),
        };
      break;
    case "iterResult":
      if (name === "done") return bool(cpp.dot(o, "done"));
      if (name === "value") return { c: cpp.dot(o, "value"), t: unionOf([t.e, T.undefined]) };
      break;
    case "abortSignal":
      if (name === "aborted") return bool(cpp.call(cpp.dot(cpp.arrow(o, "aborted"), "load"), []));
      if (name === "reason")
        fail(
          node,
          Codes.UnsupportedBuiltin,
          "signal.reason has no type; catch the error from throwIfAborted() or delay() instead",
        );
      break;
    case "abortController":
      if (name === "signal") return { c: cpp.arrow(o, "signal"), t: T.abortSignal };
      break;
    case "buffer":
      return bufferProperty(obj, name, node);
    case "span":
      return spanProperty(obj, name, node);
    case "error":
      if (name === "message") return str(cpp.arrow(o, "message"));
      if (name === "name") return str(cpp.arrow(o, "name"));
      if (name === "stack")
        return { c: cpp.arrow(o, "stack"), t: unionOf([T.string, T.undefined]) };
      break;
  }
  fail(node, Codes.UnsupportedBuiltin, `.${name} is not supported on ${typeKey(t)}`);
}

// --- classes ---------------------------------------------------------------------------

/** An instance member of `t` or its ancestors, with the class type that declares it. */
function classMemberDecl(
  em: FnEmitter,
  t: LType & { k: "class" },
  name: string,
): { decl: ts.ClassElement | ts.ParameterDeclaration; owner: LType & { k: "class" } } | undefined {
  const found = findMember(em.reg.chain(t), name, () => true);
  return found && { decl: found.decl, owner: found.owner.t };
}

function isStatic(m: ts.Node): boolean {
  return (
    ts.canHaveModifiers(m) &&
    !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)
  );
}

/** Declared (storage) type of a class member, instantiated for `t`'s type arguments. */
export function memberType(em: FnEmitter, t: LType & { k: "class" }, decl: ts.Node): LType {
  const info = em.reg.cls(t.id);
  const declared = em.reg.lower(em.checker.getTypeAtLocation(decl), decl);
  if (!t.args.length) return declared;
  return substitute(declared, new Map(info.typeParams.map((p, i) => [p, t.args[i]!])));
}

export function classMember(
  em: FnEmitter,
  obj: E,
  t0: LType & { k: "class" },
  name: string,
  node: ts.Node,
): E {
  const info = em.reg.cls(t0.id);
  if (info.isError && (name === "message" || name === "name")) return str(cpp.arrow(obj.c, name));
  const found = classMemberDecl(em, t0, name);
  // A member it inherits from the iOS class it extends: its native object's.
  if (!found && info.sdkBase?.platform === "ios")
    return nativeMember(em, subclassNative(obj, info), node);
  if (!found) fail(node, Codes.UnsupportedClassFeature, `unknown member ${name}`);
  const { decl, owner: t } = found;
  if (ts.isGetAccessorDeclaration(decl)) {
    const type = memberType(em, t, decl);
    return { c: cpp.call(cpp.arrow(obj.c, `get_${cppIdent(name)}`), []), t: type };
  }
  if (ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) {
    return { c: cpp.arrow(obj.c, cppIdent(name)), t: memberType(em, t, decl) };
  }
  if (ts.isMethodDeclaration(decl)) {
    // A bound method used as a value.
    const ft = em.lt(node);
    if (ft.k !== "fn") fail(node, Codes.UnsupportedClassFeature, "unsupported method reference");
    // The receiver is captured by reference counting, as `this` is.
    const r = em.ctx.fresh("recv");
    const recv = obj.c.k === "this" ? em.selfRefExpr() : obj.c;
    const params = ft.params.map((p, i) => cpp.param(em.reg.cppType(p), `a${i}`));
    const call = cpp.call(
      cpp.arrow(cpp.id(r), cppIdent(name)),
      params.map((p) => cpp.id(p.name!)),
    );
    const bound = cpp.lambda([{ name: r, init: recv }], params, [cpp.ret(call)]);
    return { c: cpp.construct(em.reg.cppType(ft), [bound]), t: ft };
  }
  fail(node, Codes.UnsupportedClassFeature, `unsupported member ${name}`);
}

export function classMemberLvalue(
  em: FnEmitter,
  obj: E,
  t0: LType & { k: "class" },
  name: string,
  node: ts.Node,
): Lvalue {
  const info = em.reg.cls(t0.id);
  if (info.isError && (name === "message" || name === "name")) {
    const c = cpp.arrow(obj.c, name);
    return { direct: c, get: c, type: T.string };
  }
  const found = classMemberDecl(em, t0, name);
  if (!found && info.sdkBase?.platform === "ios" && ts.isPropertyAccessExpression(node)) {
    const inherited = nativeLvalue(em, node, subclassNative(obj, info));
    if (inherited) return inherited;
  }
  if (!found) fail(node, Codes.UnsupportedClassFeature, `unknown member ${name}`);
  const { decl, owner: t } = found;
  if (ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) {
    const c = cpp.arrow(obj.c, cppIdent(name));
    return { direct: c, get: c, type: memberType(em, t, decl) };
  }
  if (ts.isGetAccessorDeclaration(decl) || ts.isSetAccessorDeclaration(decl))
    return accessorLvalue(obj, name, memberType(em, t, decl));
  fail(node, Codes.UnsupportedAssignmentTarget, `cannot assign to method ${name}`);
}

// --- interfaces ------------------------------------------------------------------------

function ifaceMemberOf(
  em: FnEmitter,
  t: LType & { k: "iface" },
  name: string,
  node: ts.Node,
): IfaceMember {
  const info = em.reg.iface(t.id);
  const m = membersOf(em.ctx, t).find((x) => x.name === name);
  if (!m) fail(node, Codes.UnsupportedSyntax, `unknown member ${name} of ${info.decl.name.text}`);
  return m;
}

export function ifaceMember(
  em: FnEmitter,
  obj: E,
  t: LType & { k: "iface" },
  name: string,
  node: ts.Node,
): E {
  const m = ifaceMemberOf(em, t, name, node);
  if (m.kind === "method")
    fail(
      node,
      Codes.UnsupportedClassFeature,
      `call ${name}() directly; interface methods cannot be used as values`,
    );
  return { c: cpp.call(cpp.arrow(obj.c, `get_${cppIdent(name)}`), []), t: m.type };
}

export function ifaceMemberLvalue(
  em: FnEmitter,
  obj: E,
  t: LType & { k: "iface" },
  name: string,
  node: ts.Node,
): Lvalue {
  const m = ifaceMemberOf(em, t, name, node);
  if (m.kind === "method" || m.readonly)
    fail(node, Codes.UnsupportedAssignmentTarget, `cannot assign to ${name}`);
  return accessorLvalue(obj, name, m.type);
}

/** A property with get_ and set_ accessors; the assignment gives the value set. */
function accessorLvalue(obj: E, name: string, type: LType): Lvalue {
  return {
    get: cpp.call(cpp.arrow(obj.c, `get_${cppIdent(name)}`)),
    set: (v) => cpp.comma(cpp.call(cpp.arrow(obj.c, `set_${cppIdent(name)}`), [v]), v),
    type,
  };
}

function ifaceMethodCall(
  em: FnEmitter,
  obj: E,
  t: LType & { k: "iface" },
  name: string,
  node: ts.CallExpression,
): E {
  const m = ifaceMemberOf(em, t, name, node);
  if (m.kind === "prop") {
    const ft = stripOpt(m.type);
    if (ft.k !== "fn") fail(node, Codes.UnsupportedCall, `${name} is not a function`);
    const f = ifaceMember(em, obj, t, name, node);
    return {
      c: cpp.call(em.coerce(f, ft, node), em.args(node.arguments, ft.params, node)),
      t: isVoidish(ft.ret) ? T.undefined : ft.ret,
    };
  }
  const rest =
    m.params.length && m.params[m.params.length - 1]!.rest
      ? m.params[m.params.length - 1]!.cppType
      : undefined;
  const as = em.args(
    node.arguments,
    m.params.map((p) => p.cppType),
    node,
    rest,
  );
  return {
    c: cpp.call(cpp.arrow(obj.c, cppIdent(name)), as),
    t: isVoidish(m.fn.ret) ? T.undefined : m.fn.ret,
  };
}

/** A static member of a class or its ancestors (statics are inherited in JavaScript). */
function staticMember(
  em: FnEmitter,
  info: ClassInfo,
  name: string,
): { decl: ts.ClassElement | undefined; owner: ClassInfo } {
  for (const c of [info, ...em.reg.ancestors(info)]) {
    const decl = c.decl.members.find(
      (m) => m.name && ts.isIdentifier(m.name) && m.name.text === name && isStatic(m),
    );
    if (decl) return { decl, owner: c };
  }
  return { decl: undefined, owner: info };
}

/** `super.name` / `super.name(...)` inside a subclass. */
export function superMember(
  em: FnEmitter,
  name: string,
  node: ts.Node,
  call?: ts.CallExpression,
): E {
  const cls = em.opts.cls;
  // The iOS class it extends: its implementation of a method the class
  // overrides, or the inherited member on the native object.
  if (cls?.sdkBase?.platform === "ios") {
    const { overridden, self } = subclassSuper(cls, name);
    if (!call) return nativeMember(em, self, node);

    return (
      nativeCall(em, call, self, overridden ? subclassName(cls) : undefined) ??
      fail(node, Codes.UnsupportedCall, `super.${name} is not a method of ${cls.sdkBase.name}`)
    );
  }
  if (!cls?.base)
    fail(node, Codes.UnsupportedClassFeature, "`super` members are only available in subclasses");
  const found = classMemberDecl(em, { k: "class", id: cls.base.id, args: cls.base.args }, name);
  if (!found) fail(node, Codes.UnsupportedClassFeature, `unknown member ${name}`);
  const member = (m: string) => cpp.baseMember(em.self(), em.reg.cppClassType(found.owner), m);
  const d = found.decl;
  if (call) {
    if (!ts.isMethodDeclaration(d))
      fail(node, Codes.UnsupportedClassFeature, `super.${name} is not a method`);
    return callMethodDecl(em, member(cppIdent(name)), d, call, found.owner);
  }
  if (ts.isGetAccessorDeclaration(d))
    return {
      c: cpp.call(member(`get_${cppIdent(name)}`)),
      t: memberType(em, found.owner, d),
    };
  if (ts.isPropertyDeclaration(d) || ts.isParameter(d))
    return { c: member(cppIdent(name)), t: memberType(em, found.owner, d) };
  fail(node, Codes.UnsupportedClassFeature, `super.${name} cannot be used as a value`);
}

function staticClass(em: FnEmitter, id: ts.Expression) {
  if (!ts.isIdentifier(id)) return undefined;
  const sym0 = em.checker.getSymbolAtLocation(id);
  if (!sym0) return undefined;
  const g = em.ctx.globals.get(em.ctx.resolve(sym0));
  return g && g.kind === "class" ? g : undefined;
}

export function staticMemberLvalue(
  em: FnEmitter,
  target: ts.PropertyAccessExpression,
): Lvalue | undefined {
  const g = staticClass(em, target.expression);
  if (!g) return undefined;
  const name = target.name.text;
  const { decl, owner } = staticMember(em, g.info, name);
  if (!decl || !ts.isPropertyDeclaration(decl))
    fail(target, Codes.UnsupportedAssignmentTarget, `unknown static field ${name}`);
  const c = cpp.id(`lucent_app::${owner.cppName}::${cppIdent(name)}`);
  return { direct: c, get: c, type: em.reg.lower(em.checker.getTypeAtLocation(decl), decl) };
}

// --- static properties -----------------------------------------------------------------

const MATH_CONSTANTS: Record<string, number> = {
  E: Math.E,
  LN10: Math.LN10,
  LN2: Math.LN2,
  LOG10E: Math.LOG10E,
  LOG2E: Math.LOG2E,
  PI: Math.PI,
  SQRT1_2: Math.SQRT1_2,
  SQRT2: Math.SQRT2,
};
/** Number's constants, written as C++ gives them exactly. */
const NUMBER_CONSTANTS: Record<string, () => cpp.Expr> = {
  MAX_SAFE_INTEGER: () => cpp.num("9007199254740991.0"),
  MIN_SAFE_INTEGER: () => cpp.num("-9007199254740991.0"),
  EPSILON: () => cpp.num("2.220446049250313e-16"),
  MAX_VALUE: () => cpp.num("1.7976931348623157e+308"),
  MIN_VALUE: () => cpp.num("5e-324"),
  POSITIVE_INFINITY: () => cpp.id("lucent::kInfinity"),
  NEGATIVE_INFINITY: () => cpp.unary("-", cpp.id("lucent::kInfinity")),
  NaN: () => cpp.id("lucent::kNaN"),
};

/** The name JavaScript stacks give the function around `node`. */
/** The name of the function `node` is in, as Errors record their site: `Class.method`, `new Class`… */
export function functionName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n))
      return n.name?.text ?? "<anonymous>";
    if (
      ts.isMethodDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSetAccessorDeclaration(n)
    ) {
      const cls = ts.isClassLike(n.parent) ? n.parent.name?.text : undefined;
      return `${cls ? `${cls}.` : ""}${n.name.getText()}`;
    }
    if (ts.isConstructorDeclaration(n))
      return `new ${ts.isClassLike(n.parent) ? (n.parent.name?.text ?? "") : ""}`;
    if (ts.isArrowFunction(n))
      return ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)
        ? n.parent.name.text
        : "<anonymous>";
  }
  return "<module>";
}

/** An error-creating expression that records its .lucent.ts site. */
export function withSite(expr: cpp.Expr, node: ts.Node): cpp.Expr {
  const site = [cpp.id("__FILE__"), cpp.id("__LINE__"), cpp.str(functionName(node))];
  return cpp.call("lucent::withSite", [expr, ...site]);
}

export function isJsonParse(em: FnEmitter, node: ts.CallExpression): boolean {
  const c = node.expression;
  return (
    ts.isPropertyAccessExpression(c) &&
    c.name.text === "parse" &&
    isLibGlobal(em, c.expression, "JSON")
  );
}

export function isMathGlobal(em: FnEmitter, id: ts.Expression): boolean {
  return isLibGlobal(em, id, "Math");
}

function isLibGlobal(em: FnEmitter, id: ts.Expression, name: string): boolean {
  if (!ts.isIdentifier(id) || id.text !== name) return false;
  const sym = em.checker.getSymbolAtLocation(id);
  const decl = sym?.declarations?.[0];
  return !!decl && isLibFile(decl.getSourceFile());
}

export function staticProperty(em: FnEmitter, node: ts.PropertyAccessExpression): E | undefined {
  const obj = node.expression;
  const name = node.name.text;
  if (isLibGlobal(em, obj, "Math")) {
    if (name in MATH_CONSTANTS) return num(numberExpr(MATH_CONSTANTS[name]!));
    return undefined;
  }
  if (isLibGlobal(em, obj, "Number") && name in NUMBER_CONSTANTS)
    return num(NUMBER_CONSTANTS[name]!());
  // Enum members are constants.
  const memberSym = em.checker.getSymbolAtLocation(node);
  const memberDecl =
    memberSym && memberSym.flags & ts.SymbolFlags.EnumMember
      ? memberSym.valueDeclaration
      : undefined;
  const constant =
    memberDecl && ts.isEnumMember(memberDecl)
      ? em.checker.getConstantValue(memberDecl)
      : em.checker.getConstantValue(node);
  if (constant !== undefined)
    return typeof constant === "number" ? num(numberExpr(constant)) : str(stringExpr(constant));
  const g = staticClass(em, obj);
  if (g) {
    const { decl, owner } = staticMember(em, g.info, name);
    if (!decl) fail(node, Codes.UnsupportedClassFeature, `unknown static member ${name}`);
    if (ts.isPropertyDeclaration(decl)) {
      const t = em.reg.lower(em.checker.getTypeAtLocation(decl), decl);
      // A literal is read as itself, as a literal module constant is.
      const literal = literalConstant(decl);

      return {
        c: literal
          ? em.exprAs(literal, t)
          : cpp.id(`lucent_app::${owner.cppName}::${cppIdent(name)}`),
        t,
      };
    }
    if (ts.isGetAccessorDeclaration(decl))
      return {
        c: cpp.call(`lucent_app::${owner.cppName}::get_${cppIdent(name)}`),
        t: em.reg.lower(em.checker.getTypeAtLocation(decl), decl),
      };
    fail(node, Codes.UnsupportedClassFeature, `static methods cannot be used as values`);
  }
  return undefined;
}

// --- static calls ----------------------------------------------------------------------

const MATH_FUNCTIONS = new Set([
  "abs",
  "floor",
  "ceil",
  "trunc",
  "round",
  "sign",
  "sqrt",
  "cbrt",
  "exp",
  "expm1",
  "log",
  "log2",
  "log10",
  "log1p",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "pow",
  "fround",
  "imul",
  "clz32",
  "hypot",
  "random",
  "min",
  "max",
]);

export function staticCall(
  em: FnEmitter,
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
): E | undefined {
  const buffer = bufferStatic(em, node, callee);
  if (buffer) return buffer;
  const obj = callee.expression;
  const name = callee.name.text;
  const a = node.arguments;
  if (isLibGlobal(em, obj, "Math")) {
    if (!MATH_FUNCTIONS.has(name))
      fail(node, Codes.UnsupportedBuiltin, `Math.${name} is not supported`);
    if ((name === "min" || name === "max") && a.length === 1 && ts.isSpreadElement(a[0]!)) {
      const all = em.exprAs(a[0]!.expression, { k: "array", e: T.number });
      return num(cpp.call(`lucent::math::${name}Of`, [all]));
    }
    if (a.some(ts.isSpreadElement))
      fail(node, Codes.UnsupportedBuiltin, `spread is only supported as Math.${name}(...array)`);
    if (name === "imul" && a.length === 2) {
      const x = em.expr(a[0]!);
      const y = em.expr(a[1]!);
      // Multiplied as uint32 (wrapping), read back as int32.
      const product = cpp.binary(em.u32(x, node), "*", em.u32(y, node));
      return em.intE(cpp.staticCast(cpp.type("int32_t"), product), "i32");
    }
    return num(
      cpp.call(
        `lucent::math::${name}`,
        a.map((x) => em.exprAs(x, T.number)),
      ),
    );
  }
  if (isLibGlobal(em, obj, "Date")) {
    if (name === "now") return num(cpp.call("lucent::dateNow"));
    if (name === "UTC")
      return num(
        cpp.call(
          "lucent::dateUTC",
          a.map((x) => em.exprAs(x, T.number)),
        ),
      );
    if (name === "parse") return num(cpp.call("lucent::dateParse", [argAs(em, node, 0, T.string)]));
    fail(node, Codes.UnsupportedBuiltin, `Date.${name} is not supported`);
  }
  if (isLibGlobal(em, obj, "Number")) {
    switch (name) {
      case "isInteger":
      case "isSafeInteger":
      case "isFinite":
      case "isNaN": {
        const v = em.expr(a[0]!);
        const test = `lucent::${name}`;
        if (v.t.k === "number") return bool(cpp.call(test, [v.c]));
        return bool(cpp.call("lucent::numberIs", [v.c, cpp.id(test)]));
      }
      case "parseFloat":
        return num(cpp.call("lucent::parseFloat", [argAs(em, node, 0, T.string)]));
      case "parseInt":
        return num(
          cpp.call("lucent::parseInt", [
            ...argList(argAs(em, node, 0, T.string), optArg(em, node, 1, T.number, NAN)),
          ]),
        );
    }
    fail(node, Codes.UnsupportedBuiltin, `Number.${name} is not supported`);
  }
  if (isLibGlobal(em, obj, "Object")) {
    const v = em.expr(a[0]!);
    const t = stripOpt(v.t);
    if (t.k === "dict") {
      if (name === "keys")
        return { c: cpp.call(cpp.dot(v.c, "keys"), []), t: { k: "array", e: T.string } };
      if (name === "values")
        return { c: cpp.call(cpp.dot(v.c, "values"), []), t: { k: "array", e: t.val } };
      if (name === "entries")
        return {
          c: cpp.call("lucent::dictEntries", [v.c]),
          t: { k: "array", e: { k: "tuple", es: [T.string, t.val] } },
        };
    }
    if (t.k === "struct" && name === "keys")
      fail(
        node,
        Codes.UnsupportedBuiltin,
        "Object.keys of an object type is not supported: Lucent objects do not record which optional fields are set or the order JavaScript made them in; use a Record<string, T>, or list the fields",
      );
    if (name === "fromEntries") {
      const rt = em.lt(node);
      if (rt.k !== "dict")
        fail(node, Codes.UnsupportedBuiltin, "Object.fromEntries must produce a record");
      const entries = em.exprAs(a[0]!, {
        k: "array",
        e: { k: "tuple", es: [T.string, rt.val] },
      });
      return {
        c: cpp.call("lucent::dictFromEntries", [entries], [em.reg.cppType(rt.val)]),
        t: rt,
      };
    }
    fail(node, Codes.UnsupportedBuiltin, `Object.${name} is not supported on ${typeKey(v.t)}`);
  }
  if (isLibGlobal(em, obj, "Array")) {
    const rt = em.lt(node);
    if (name === "isArray") return heldKind(node, em.expr(a[0]!), "Array");
    if (name === "of") {
      if (rt.k !== "array") fail(node, Codes.UnsupportedBuiltin, "Array.of");
      const items = a.map((x) => em.exprAs(x, rt.e));
      return { c: cpp.construct(em.reg.cppType(rt), items, true), t: rt };
    }
    if (name === "from") {
      if (rt.k !== "array")
        fail(node, Codes.UnsupportedBuiltin, "Array.from must produce an array");
      const src = a[0]!;
      // Array.from({ length: n }, (_, i) => ...)
      if (ts.isObjectLiteralExpression(src)) {
        const lenProp = src.properties.length === 1 ? src.properties[0] : undefined;
        if (!lenProp || !ts.isPropertyAssignment(lenProp) || lenProp.name.getText() !== "length")
          fail(
            src,
            Codes.UnsupportedBuiltin,
            "Array.from needs an iterable or { length: n }: JavaScript reads an array-like's elements, which Lucent objects cannot index",
          );
        const n = em.exprAs(lenProp.initializer, T.number);
        if (!a[1]) {
          if (!mayBeUndefined(rt.e))
            fail(
              node,
              Codes.UnsupportedBuiltin,
              `Array.from({ length: n }) makes n undefined elements, which ${typeKey(rt.e)} cannot hold: pass a map function, or type the elements ${typeKey(rt.e)} | undefined`,
            );
          const count = cpp.call("lucent::arrayLikeLength", [n]);
          const undef = em.coerce({ c: cpp.id("lucent::undefined"), t: T.undefined }, rt.e, node);
          return { c: cpp.call(cpp.scoped(em.reg.cppType(rt), "filled"), [count, undef]), t: rt };
        }
        // The callback called with (undefined, i) for each index.
        const cb = callback(em, a[1], [T.undefined, T.number], rt.e);
        const cbvName = em.ctx.fresh("cb");
        const cbv = cpp.id(cbvName);
        const i = cpp.id("i");
        const each = cpp.lambda(
          ["&"],
          [cpp.param(cpp.type("double"), "i")],
          [cpp.ret(cpp.call(cbv, [cpp.id("lucent::undefined"), i]))],
        );
        return {
          c: cpp.statementExpr(
            [cpp.varDecl(cpp.auto, cbvName, cb.c)],
            cpp.call(cpp.scoped(em.reg.cppType(rt), "generate"), [n, each]),
          ),
          t: rt,
        };
      }
      const s = em.expr(src);
      const items = em.iterableItems(s, src);
      // An array is copied: Array.from gives a new one.
      const copied = stripOpt(s.t).k === "array" ? cpp.call(cpp.dot(items.c, "slice")) : items.c;
      const base: E = { c: copied, t: { k: "array", e: items.e } };
      if (!a[1]) return { c: em.coerce(base, rt, node), t: rt };
      const cb = callback(em, a[1], [items.e, T.number], rt.e);
      return {
        c: cpp.call(cpp.dot(base.c, "map"), [cb.c], [em.reg.cppType(rt.e)]),
        t: rt,
      };
    }
    fail(node, Codes.UnsupportedBuiltin, `Array.${name} is not supported`);
  }
  if (isLibGlobal(em, obj, "BigInt")) {
    if (name !== "asIntN" && name !== "asUintN")
      fail(node, Codes.UnsupportedBuiltin, `BigInt.${name} is not supported`);
    return big(
      cpp.call(`lucent::BigInt::${name}`, [
        argAs(em, node, 0, T.number),
        argAs(em, node, 1, T.bigint),
      ]),
    );
  }
  if (isLibGlobal(em, obj, "String")) {
    const codes = () => cpp.initList(a.map((x) => em.exprAs(x, T.number)));
    if (name === "fromCharCode") return str(cpp.call("lucent::stringFromCharCodes", [codes()]));
    if (name === "fromCodePoint") return str(cpp.call("lucent::stringFromCodePoints", [codes()]));
    fail(node, Codes.UnsupportedBuiltin, `String.${name} is not supported`);
  }
  if (isLibGlobal(em, obj, "console")) {
    const level = name === "warn" ? "Warn" : name === "error" ? "Error" : "Log";
    if (!["log", "info", "debug", "warn", "error"].includes(name))
      fail(node, Codes.UnsupportedBuiltin, `console.${name} is not supported`);
    // The arguments as strings, joined by spaces; a bigint with its `n`, as JavaScript consoles print it.
    const parts = a.map((x) => {
      const v = em.expr(x);
      const text = em.toStringCode(v);
      return cpp.construct(cpp.type("lucent::String"), [
        v.t.k === "bigint" ? cpp.binary(text, "+", stringExpr("n")) : text,
      ]);
    });
    const joined = parts.length
      ? parts.reduce((all, p) => cpp.binary(cpp.binary(all, "+", stringExpr(" ")), "+", p))
      : stringExpr("");
    return {
      c: cpp.call("lucent::consoleWrite", [cpp.id(`lucent::ConsoleLevel::${level}`), joined]),
      t: T.undefined,
    };
  }
  if (isLibGlobal(em, obj, "Date") && name === "now") return num(cpp.call("lucent::dateNow"));
  if (isLibGlobal(em, obj, "JSON")) {
    if (name === "stringify") {
      const v = em.expr(a[0]!);
      if (a.length > 1)
        fail(
          node,
          Codes.UnsupportedBuiltin,
          "JSON.stringify replacer/indent arguments are not supported",
        );
      return str(cpp.call("lucent::json::stringify", [v.c]));
    }
    fail(
      node,
      Codes.UnsupportedBuiltin,
      `JSON.${name} is not supported (Lucent values are typed; parse with explicit code)`,
    );
  }
  if (isLibGlobal(em, obj, "Promise")) {
    const rt = em.lt(node);
    if (rt.k !== "promise") fail(node, Codes.UnsupportedBuiltin, `Promise.${name}`);
    if (name === "resolve") {
      if (!a[0]) return { c: cpp.call("lucent::Promise<void>::resolved"), t: rt };
      const value = em.exprAs(a[0], rt.inner);
      return {
        c: cpp.call("lucent::resolvedPromise", [value], [em.reg.cppRetType(rt.inner)]),
        t: rt,
      };
    }
    if (name === "reject")
      return {
        c: cpp.call(
          cpp.scoped(cpp.type("lucent::Promise", em.reg.cppRetType(rt.inner)), "rejected"),
          [em.exprAs(a[0]!, T.error)],
        ),
        t: rt,
      };
    if (name === "all") {
      const src = em.expr(a[0]!, em.lt(a[0]!));
      const st = stripOpt(src.t);
      if (st.k === "array" && st.e.k === "promise") {
        if (isVoidish(st.e.inner))
          return {
            c: cpp.call("lucent::promiseAllVoid", [src.c]),
            t: { k: "promise", inner: T.void },
          };
        return {
          c: cpp.call("lucent::promiseAll", [src.c]),
          t: { k: "promise", inner: { k: "array", e: st.e.inner } },
        };
      }
      if (st.k === "tuple" && st.es.every((e) => e.k === "promise")) {
        const inners = st.es.map((e) => {
          const inner = (e as LType & { k: "promise" }).inner;
          return isVoidish(inner) ? T.undefined : inner;
        });
        return {
          c: cpp.call("lucent::promiseAllTuple", [src.c]),
          t: { k: "promise", inner: { k: "tuple", es: inners } },
        };
      }
      fail(node, Codes.UnsupportedBuiltin, "Promise.all needs an array of promises of one type");
    }
    fail(node, Codes.UnsupportedBuiltin, `Promise.${name} is not supported`);
  }
  const g = staticClass(em, obj);
  if (g) {
    const { decl, owner } = staticMember(em, g.info, name);
    if (!decl || !ts.isMethodDeclaration(decl))
      fail(node, Codes.UnsupportedClassFeature, `unknown static method ${name}`);
    return callMethodDecl(
      em,
      cpp.id(`lucent_app::${owner.cppName}::${cppIdent(name)}`),
      decl,
      node,
      undefined,
    );
  }
  return undefined;
}

/** The call that disposes a `using` value of type `t` (never null). */
export function disposeCall(em: FnEmitter, v: E, node: ts.Node): cpp.Expr {
  const t = v.t;
  if (t.k === "handle") return handleDispose(v);
  if (
    t.k === "native" &&
    t.platform === "android" &&
    sdkClassIs("android", t.module, t.name, AUTO_CLOSEABLE)
  ) {
    em.ctx.nativeUnit(em.opts.module).include("lucent/platform/android.h");
    return cpp.call("lucent::jni::close", [v.c]);
  }
  if (t.k === "buffer") return bufferDispose(v);
  if (t.k === "class") {
    const found = classMemberDecl(em, t, DISPOSE);
    if (found && ts.isMethodDeclaration(found.decl) && !found.decl.parameters.length)
      return cpp.call(cpp.arrow(v.c, cppIdent(DISPOSE)));
  }
  fail(
    node,
    Codes.UnsupportedType,
    `a using declaration needs a value with a [Symbol.dispose]() method, not ${typeKey(t)}`,
  );
}

/** Calls a class method declaration with arguments coerced to its parameters. */
function callMethodDecl(
  em: FnEmitter,
  target: cpp.Expr,
  decl: ts.MethodDeclaration,
  node: ts.CallExpression,
  classT: (LType & { k: "class" }) | undefined,
): E {
  const sig = em.checker.getSignatureFromDeclaration(decl)!;
  let ft = em.reg.lowerSignature(sig, decl) as FnT;
  if (classT?.args.length) {
    const info = em.reg.cls(classT.id);
    ft = substitute(ft, new Map(info.typeParams.map((p, i) => [p, classT.args[i]!]))) as FnT;
  }
  const isAsync = !!ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  const params = em.paramInfos(decl, ft);
  const rest =
    params.length && params[params.length - 1]!.rest
      ? params[params.length - 1]!.cppType
      : undefined;
  const as = em.args(
    node.arguments,
    params.map((p) => p.cppType),
    node,
    rest,
  );
  const ret = isAsync
    ? ft.ret.k === "promise"
      ? ft.ret
      : ({ k: "promise", inner: ft.ret } as LType)
    : ft.ret;
  return { c: cpp.call(target, as), t: isVoidish(ret) ? T.undefined : ret };
}

// --- methods ---------------------------------------------------------------------------

export function methodCall(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E {
  const t = obj.t;
  if (t.k === "handle") return handleMethodCall(em, obj, name, node);
  if (t.k === "signal") return signalMethod(em, obj, name, node);
  if (t.k === "native" && name === DISPOSE)
    return { c: disposeCall(em, obj, node), t: T.undefined };
  if (t.k === "native")
    return (
      nativeCall(em, node, obj) ??
      fail(node, Codes.UnsupportedCall, `${name} is not a method of ${t.name}`)
    );
  const o = obj.c;
  const a = node.arguments;
  if (name === "toString" && a.length === 0 && t.k !== "number") return str(em.toStringCode(obj));
  switch (t.k) {
    case "class": {
      const info = em.reg.cls(t.id);
      if (info.isError && name === "toString") return str(cpp.call("lucent::errorToString", [o]));
      const found = classMemberDecl(em, t, name);
      const decl = found?.decl;
      // Its methods touch the main-thread class it extends: called there.
      requireSubclassMain(node, info, (n) => inMainContext(em, n));
      if (decl && ts.isMethodDeclaration(decl))
        return callMethodDecl(em, cpp.arrow(o, cppIdent(name)), decl, node, found.owner);
      // A method it inherits from the iOS class it extends: its native object's.
      if (!decl && info.sdkBase?.platform === "ios")
        return (
          nativeCall(em, node, subclassNative(obj, info)) ??
          fail(node, Codes.UnsupportedCall, `${name} is not a method of ${info.sdkBase.name}`)
        );
      if (
        decl &&
        (ts.isPropertyDeclaration(decl) ||
          ts.isParameter(decl) ||
          ts.isGetAccessorDeclaration(decl))
      ) {
        const f = classMember(em, obj, t, name, node);
        const ft = stripOpt(f.t);
        if (ft.k !== "fn") fail(node, Codes.UnsupportedCall, `${name} is not a function`);
        return {
          c: cpp.call(em.coerce(f, ft, node), em.args(a, ft.params, node)),
          t: isVoidish(ft.ret) ? T.undefined : ft.ret,
        };
      }
      fail(node, Codes.UnsupportedClassFeature, `unknown method ${name}`);
    }
    case "iface":
      return ifaceMethodCall(em, obj, t, name, node);
    case "struct": {
      const f = em.member(obj, name, node);
      const ft = stripOpt(f.t);
      if (ft.k !== "fn") fail(node, Codes.UnsupportedCall, `${name} is not a function`);
      return {
        c: cpp.call(em.coerce(f, ft, node), em.args(a, ft.params, node)),
        t: isVoidish(ft.ret) ? T.undefined : ft.ret,
      };
    }
    case "string":
      return stringMethod(em, o, name, node);
    case "number":
      switch (name) {
        case "toString":
          return str(
            cpp.call("lucent::numberToString", [
              ...argList(o, optArg(em, node, 0, T.number, cpp.num("10.0"))),
            ]),
          );
        case "toFixed":
          return str(
            cpp.call("lucent::numberToFixed", [
              o,
              optArg(em, node, 0, T.number, NAN) ?? cpp.num("0.0"),
            ]),
          );
        // Undefined is the argument left out, which no number stands for:
        // the runtime takes the optional.
        case "toPrecision":
          return str(
            a[0]
              ? cpp.call("lucent::numberToPrecision", [o, numberOrOptional(em, a[0])])
              : cpp.call("lucent::numberToString", [o]),
          );
        case "toExponential":
          return str(
            cpp.call("lucent::numberToExponential", [
              ...argList(o, a[0] && numberOrOptional(em, a[0])),
            ]),
          );
        case "valueOf":
          return num(o);
      }
      break;
    case "boolean":
      if (name === "valueOf") return bool(o);
      break;
    case "bigint":
      if (name === "toString")
        return str(
          cpp.call(cpp.dot(o, "toString"), [
            optArg(em, node, 0, T.number, cpp.num("10.0")) ?? cpp.num("10.0"),
          ]),
        );
      if (name === "valueOf") return big(o);
      fail(node, Codes.UnsupportedBuiltin, `bigint.${name}() is not supported`);
    case "array":
      return arrayMethod(em, obj as E & { t: { k: "array"; e: LType } }, name, node);
    case "map":
      return mapMethod(em, obj as E & { t: { k: "map"; key: LType; val: LType } }, name, node);
    case "set":
      return setMethod(em, obj as E & { t: { k: "set"; e: LType } }, name, node);
    case "bytes":
      return bytesMethod(em, o, name, node);
    case "buffer":
      return bufferMethod(em, obj, name, node);
    case "span":
      return spanMethod(em, obj, name, node);
    case "error":
      if (name === "toString") return str(cpp.call("lucent::errorToString", [o]));
      break;
    case "regexp":
      if (name === "exec")
        return {
          c: cpp.call(cpp.arrow(o, "exec"), [argAs(em, node, 0, T.string)]),
          t: unionOf([T.regexMatch, T.null]),
        };
      if (name === "test")
        return bool(cpp.call(cpp.arrow(o, "test"), [argAs(em, node, 0, T.string)]));
      break;
    case "regexMatch":
      return arrayMethod(
        em,
        {
          c: cpp.arrow(o, "items"),
          t: { k: "array", e: unionOf([T.string, T.undefined]) },
        } as E & {
          t: { k: "array"; e: LType };
        },
        name,
        node,
      );
    case "iter":
      if (name === "next" && a.length === 0)
        return { c: cpp.call("lucent::iterNext", [o]), t: { k: "iterResult", e: t.e } };
      if (name === "return" && a.length === 0)
        return {
          c: cpp.comma(
            cpp.call(cpp.arrow(o, "ret")),
            cpp.construct(cpp.type("lucent::IterResult", em.reg.cppType(t.e)), [], true),
          ),
          t: { k: "iterResult", e: t.e },
        };
      fail(node, Codes.UnsupportedBuiltin, `iterator.${name}() is not supported`);
    case "date": {
      if (
        name === "toString" ||
        name === "toISOString" ||
        name === "toDateString" ||
        name === "toTimeString" ||
        name === "toUTCString"
      )
        return str(cpp.call(cpp.arrow(o, name), []));
      if (name === "toJSON") return str(cpp.call(cpp.arrow(o, "toISOString"), []));
      if (
        /^get(UTC)?(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$|^(getTime|valueOf|getTimezoneOffset)$/.test(
          name,
        )
      )
        return num(cpp.call(cpp.arrow(o, name), []));
      if (
        /^set(UTC)?(FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds)$|^setTime$/.test(name)
      ) {
        return num(
          cpp.call(
            cpp.arrow(o, name),
            a.map((x) => orUndefined(em, x, T.number, NAN)),
          ),
        );
      }
      if (name.startsWith("toLocale"))
        fail(
          node,
          Codes.UnsupportedBuiltin,
          `Date.${name} depends on the locale and is not supported; use toISOString() or the get… methods`,
        );
      break;
    }
    case "abortSignal":
      if (name === "throwIfAborted")
        return { c: cpp.call(cpp.arrow(o, "throwIfAborted"), []), t: T.undefined };
      if (name === "addEventListener") {
        if (a.length !== 2)
          fail(
            node,
            Codes.UnsupportedBuiltin,
            "addEventListener takes the event type and a listener (options are not supported)",
          );
        const listener = argAs(em, node, 1, { k: "fn", params: [], ret: T.void });
        return { c: cpp.call(cpp.arrow(o, "addEventListener"), [listener]), t: T.undefined };
      }
      break;
    case "abortController":
      if (name === "abort") {
        if (!a[0])
          return {
            c: cpp.call(cpp.arrow(o, "abort"), [cpp.id("lucent::undefined")]),
            t: T.undefined,
          };
        const reason = em.expr(a[0]);
        const isError =
          reason.t.k === "error" || (reason.t.k === "class" && em.reg.cls(reason.t.id).isError);
        if (!isError) fail(a[0], Codes.UnsupportedBuiltin, "abort reasons must be Error objects");
        return {
          c: cpp.call(cpp.arrow(o, "abort"), [em.coerce(reason, T.error, a[0])]),
          t: T.undefined,
        };
      }
      break;
    case "fn":
      if (name === "call" || name === "apply" || name === "bind")
        fail(node, Codes.UnsupportedBuiltin, `Function.prototype.${name} is not supported`);
      break;
    case "promise":
      fail(node, Codes.UnsupportedBuiltin, `promise.${name}() is not supported; use await`);
  }
  fail(node, Codes.UnsupportedBuiltin, `.${name}() is not supported on ${typeKey(t)}`);
}

/** Capturing groups in a pattern (parentheses, not counting (?: …) or lookarounds). */
function countGroups(src: string): number {
  let n = 0;
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
    } else if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") {
      inClass = true;
    } else if (c === "(") {
      if (src[i + 1] !== "?") n++;
      else if (src[i + 2] === "<" && src[i + 3] !== "=" && src[i + 3] !== "!") n++;
    }
  }
  return n;
}

/** Capture count of a regular expression known at compile time. */
function literalGroupCount(node: ts.Expression): number | undefined {
  if (ts.isRegularExpressionLiteral(node))
    return countGroups(node.text.slice(1, node.text.lastIndexOf("/")));
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "RegExp" &&
    node.arguments?.[0] &&
    ts.isStringLiteralLike(node.arguments[0])
  )
    return countGroups(node.arguments[0].text);
  return undefined;
}

/**
 * A replacement callback: JavaScript passes (match, p1…pn, offset, input);
 * the callback's declared parameters say which of them it takes.
 */
function replacer(em: FnEmitter, reNode: ts.Expression, cb: ts.Expression): cpp.Expr {
  const f = em.expr(cb);
  const ft = stripOpt(f.t);
  if (ft.k !== "fn")
    fail(cb, Codes.UnsupportedBuiltin, "the replacement must be a string or a function");
  const groups = literalGroupCount(reNode);
  if (ft.params.length > 1 && groups === undefined)
    fail(
      cb,
      Codes.UnsupportedBuiltin,
      "a replacement callback that takes captures needs a regular expression literal, so the number of groups is known",
    );
  const n = groups ?? 0;
  // The callback's parameters: the match, its captures, its position, the input.
  const c = cpp.id("c");
  const args = ft.params.map((p, i) => {
    if (i === 0) return em.coerce({ c: cpp.dot(c, "match"), t: T.string }, p, cb);
    if (i <= n) {
      const cap = cpp.call(cpp.dot(cpp.dot(c, "captures"), "at"), [cpp.num(i - 1)]);
      return p.k === "opt" || p.k === "undefined"
        ? em.coerce({ c: cap, t: unionOf([T.string, T.undefined]) }, p, cb)
        : em.coerce(
            { c: cpp.call("lucent::captureOrThrow", [cap, cpp.num(i)]), t: T.string },
            p,
            cb,
          );
    }
    if (i === n + 1) return em.coerce({ c: cpp.dot(c, "position"), t: T.number }, p, cb);
    if (i === n + 2) return em.coerce({ c: cpp.dot(c, "input"), t: T.string }, p, cb);
    fail(
      cb,
      Codes.UnsupportedBuiltin,
      "the groups argument of replacement callbacks is not supported",
    );
  });
  const fv = em.ctx.fresh("repl");
  const call = em.coerce({ c: cpp.call(fv, args), t: ft.ret }, T.string, cb);
  const each = cpp.lambda(
    [{ name: fv, init: em.coerce(f, ft, cb) }],
    [cpp.param(cpp.reference(cpp.constType(cpp.type("lucent::ReplaceCall"))), "c")],
    [cpp.ret(call)],
    { ret: cpp.type("lucent::String") },
  );
  return cpp.construct(cpp.type("lucent::Replacer"), [each]);
}

/** String methods that take a RegExp. */
function regexStringMethod(em: FnEmitter, o: cpp.Expr, name: string, node: ts.CallExpression): E {
  const a = node.arguments;
  const re = em.exprAs(a[0]!, T.regexp);
  switch (name) {
    case "match":
      return {
        c: cpp.call("lucent::stringMatch", [o, re]),
        t: unionOf([T.regexMatch, T.null]),
      };
    case "matchAll":
      return {
        c: cpp.call("lucent::stringMatchAll", [o, re]),
        t: { k: "iter", e: T.regexMatch },
      };
    case "search":
      return num(cpp.call("lucent::stringSearch", [o, re]));
    case "split":
      return {
        c: cpp.call("lucent::stringSplit", [...argList(o, re, a[1] && numberOrOptional(em, a[1]))]),
        t: { k: "array", e: T.string },
      };
    case "replace":
    case "replaceAll": {
      const fn = name === "replace" ? "lucent::stringReplace" : "lucent::stringReplaceAll";
      const second = a[1]!;
      if (stripOpt(em.lt(second)).k === "fn")
        return str(cpp.call(fn, [o, re, replacer(em, a[0]!, second)]));
      return str(cpp.call(fn, [o, re, argAs(em, node, 1, T.string)]));
    }
  }
  fail(node, Codes.UnsupportedBuiltin, `String.${name} does not take a RegExp`);
}

function stringMethod(em: FnEmitter, o: cpp.Expr, name: string, node: ts.CallExpression): E {
  const first = node.arguments[0];
  if (
    first &&
    ["match", "matchAll", "search", "split", "replace", "replaceAll"].includes(name) &&
    stripOpt(em.lt(first)).k === "regexp"
  )
    return regexStringMethod(em, o, name, node);
  const n = (i: number, ifUndefined: cpp.Expr) => optArg(em, node, i, T.number, ifUndefined);
  const s = (i: number, ifUndefined: cpp.Expr) => optArg(em, node, i, T.string, ifUndefined);
  switch (name) {
    case "charCodeAt":
      return num(cpp.call(cpp.dot(o, "charCodeAt"), [n(0, cpp.num("0.0")) ?? cpp.num("0.0")]));
    case "charAt":
      return str(cpp.call(cpp.dot(o, "charAt"), [n(0, cpp.num("0.0")) ?? cpp.num("0.0")]));
    case "at":
      return {
        c: cpp.call(cpp.dot(o, "at"), [argAs(em, node, 0, T.number)]),
        t: unionOf([T.string, T.undefined]),
      };
    case "codePointAt":
      return {
        c: cpp.call(cpp.dot(o, "codePointAt"), [argAs(em, node, 0, T.number)]),
        t: unionOf([T.number, T.undefined]),
      };
    case "indexOf":
      return num(
        cpp.call(cpp.dot(o, "indexOf"), [argAs(em, node, 0, T.string), ...argList(n(1, NAN))]),
      );
    case "lastIndexOf":
      return num(
        cpp.call(cpp.dot(o, "lastIndexOf"), [argAs(em, node, 0, T.string), ...argList(n(1, NAN))]),
      );
    case "includes":
      return bool(
        cpp.call(cpp.dot(o, "includes"), [argAs(em, node, 0, T.string), ...argList(n(1, NAN))]),
      );
    case "startsWith":
      return bool(
        cpp.call(cpp.dot(o, "startsWith"), [argAs(em, node, 0, T.string), ...argList(n(1, NAN))]),
      );
    case "endsWith":
      return bool(
        cpp.call(cpp.dot(o, "endsWith"), [argAs(em, node, 0, T.string), ...argList(n(1, END))]),
      );
    case "slice":
    case "substring":
    case "substr":
      return str(cpp.call(cpp.dot(o, name), [...argList(n(0, NAN) ?? cpp.num("0.0"), n(1, END))]));
    case "toLocaleUpperCase":
    case "toLocaleLowerCase":
      if (first)
        fail(
          first,
          Codes.UnsupportedBuiltin,
          `${name}(locales) is not supported: Lucent has no Intl locale data; call it without arguments for the device's locale`,
        );
      return str(cpp.call(cpp.dot(o, name), []));
    case "toUpperCase":
    case "toLowerCase":
    case "trim":
    case "trimStart":
    case "trimEnd":
      return str(cpp.call(cpp.dot(o, name), []));
    case "trimLeft":
      return str(cpp.call(cpp.dot(o, "trimStart"), []));
    case "trimRight":
      return str(cpp.call(cpp.dot(o, "trimEnd"), []));
    case "repeat":
      return str(cpp.call(cpp.dot(o, "repeat"), [argAs(em, node, 0, T.number)]));
    case "padStart":
    case "padEnd":
      return str(
        cpp.call(cpp.dot(o, name), [
          argAs(em, node, 0, T.number),
          s(1, stringExpr(" ")) ?? stringExpr(" "),
        ]),
      );
    case "replace":
    case "replaceAll": {
      const second = node.arguments[1];
      if (second && (ts.isArrowFunction(second) || ts.isFunctionExpression(second)))
        fail(second, Codes.UnsupportedBuiltin, "replacement functions are not supported");
      return str(
        cpp.call(name === "replace" ? "lucent::stringReplace" : "lucent::stringReplaceAll", [
          o,
          argAs(em, node, 0, T.string),
          argAs(em, node, 1, T.string),
        ]),
      );
    }
    case "split": {
      if (!first)
        return {
          c: cpp.construct(cpp.type("lucent::Array", cpp.type("lucent::String")), [o], true),
          t: { k: "array", e: T.string },
        };
      return {
        c: cpp.call("lucent::split", [
          o,
          argAs(em, node, 0, T.string),
          ...argList(n(1, cpp.num("4294967295.0"))),
        ]),
        t: { k: "array", e: T.string },
      };
    }
    case "concat":
      return str(
        node.arguments.reduce(
          (all, x) => cpp.binary(all, "+", em.toStringCode(em.expr(x))),
          cpp.construct(cpp.type("lucent::String"), [o]),
        ),
      );
    case "localeCompare":
      if (node.arguments[1])
        fail(
          node.arguments[1],
          Codes.UnsupportedBuiltin,
          "localeCompare(other, locales, options) is not supported: Lucent has no Intl locale data; call localeCompare(other) for the device's locale",
        );
      return num(cpp.call(cpp.dot(o, "localeCompare"), [argAs(em, node, 0, T.string)]));
    case "normalize":
      fail(
        node,
        Codes.UnsupportedBuiltin,
        "String.prototype.normalize is not supported: Unicode normalization needs tables the Lucent runtime does not have; normalize the string in JavaScript before passing it",
      );
    case "valueOf":
    case "toString":
      return str(o);
  }
  fail(node, Codes.UnsupportedBuiltin, `String.prototype.${name} is not supported`);
}

function arrayMethod(
  em: FnEmitter,
  obj: E & { t: { k: "array"; e: LType } },
  name: string,
  node: ts.CallExpression,
): E {
  const o = obj.c;
  const e = obj.t.e;
  const at = obj.t;
  const a = node.arguments;
  const n = (i: number, ifUndefined: cpp.Expr) => optArg(em, node, i, T.number, ifUndefined);
  const cb = (params: LType[], ret?: LType) => callback(em, a[0], params, ret);
  const self: LType = at;
  switch (name) {
    case "push": {
      if (a.length === 1 && ts.isSpreadElement(a[0]!))
        return num(
          cpp.statementExpr(
            [
              cpp.varDecl(cpp.reference(cpp.auto), "pa", o),
              cpp.exprStmt(
                cpp.call(cpp.dot(cpp.id("pa"), "append"), [em.exprAs(a[0]!.expression, at)]),
              ),
            ],
            cpp.call(cpp.dot(cpp.id("pa"), "length")),
          ),
        );
      if (a.some(ts.isSpreadElement))
        fail(node, Codes.UnsupportedBuiltin, "push(...items) with other arguments");
      return num(
        cpp.call(
          cpp.dot(o, "push"),
          a.map((x) => em.exprAs(x, e)),
        ),
      );
    }
    case "pop":
    case "shift":
      return { c: cpp.call(cpp.dot(o, name), []), t: unionOf([e, T.undefined]) };
    case "unshift":
      if (a.length !== 1) fail(node, Codes.UnsupportedBuiltin, "unshift takes one item");
      return num(cpp.call(cpp.dot(o, "unshift"), [em.exprAs(a[0]!, e)]));
    case "slice":
      return { c: cpp.call(cpp.dot(o, "slice"), [...argList(n(0, NAN), n(1, END))]), t: at };
    case "splice": {
      const start = n(0, NAN) ?? cpp.num("0.0");
      // A delete count passed as undefined deletes nothing (ToIntegerOrInfinity).
      const count = n(1, NAN);
      const items = a.slice(2).map((x) => em.exprAs(x, e));
      // Items to insert need a delete count: the rest of the array when none is given.
      const counted = count ? [count] : items.length ? [cpp.call(cpp.dot(o, "length"))] : [];
      return {
        c: cpp.call(cpp.dot(o, "splice"), [start, ...counted, ...items]),
        t: at,
      };
    }
    case "concat": {
      const parts = a.map((x) => {
        const v = em.expr(x);
        return stripOpt(v.t).k === "array"
          ? em.coerce(v, at, x)
          : cpp.construct(em.reg.cppType(at), [em.coerce(v, e, x)], true);
      });
      return { c: cpp.call(cpp.dot(o, "concat"), parts), t: at };
    }
    case "join":
      return str(
        cpp.call(cpp.dot(o, "join"), [...argList(optArg(em, node, 0, T.string, stringExpr(",")))]),
      );
    case "indexOf":
    case "lastIndexOf":
    case "includes": {
      if (holdsFunction(e))
        fail(
          node,
          Codes.UnsupportedOperator,
          functionsNotCompared(`, so \`${name}\` cannot search for one`),
        );
      const found = cpp.call(cpp.dot(o, name), [...argList(em.exprAs(a[0]!, e), n(1, NAN))]);
      return name === "includes" ? bool(found) : num(found);
    }
    case "at":
      return {
        c: cpp.call(cpp.dot(o, "atIndex"), [n(0, cpp.num("0.0")) ?? cpp.num("0.0")]),
        t: unionOf([e, T.undefined]),
      };
    case "find":
    case "findLast":
      return {
        c: cpp.call(cpp.dot(o, name), [cb([e, T.number, self], T.boolean).c]),
        t: unionOf([e, T.undefined]),
      };
    case "findIndex":
    case "findLastIndex":
      return num(cpp.call(cpp.dot(o, name), [cb([e, T.number, self], T.boolean).c]));
    case "filter":
      return {
        c: cpp.call(cpp.dot(o, "filter"), [truthyCallback(em, a[0], [e, T.number, self])]),
        t: at,
      };
    case "some":
    case "every":
      return bool(cpp.call(cpp.dot(o, name), [truthyCallback(em, a[0], [e, T.number, self])]));
    case "forEach":
      return {
        c: cpp.call(cpp.dot(o, "forEach"), [cb([e, T.number, self], T.void).c]),
        t: T.undefined,
      };
    case "map": {
      const rt = em.lt(node);
      if (rt.k !== "array") fail(node, Codes.UnsupportedBuiltin, "map");
      return {
        c: cpp.call(
          cpp.dot(o, "map", true),
          [cb([e, T.number, self], rt.e).c],
          [em.reg.cppType(rt.e)],
        ),
        t: rt,
      };
    }
    case "flatMap": {
      const rt = em.lt(node);
      if (rt.k !== "array") fail(node, Codes.UnsupportedBuiltin, "flatMap");
      return {
        c: cpp.call(
          cpp.dot(o, "flatMap", true),
          [cb([e, T.number, self], rt).c],
          [em.reg.cppType(rt.e)],
        ),
        t: rt,
      };
    }
    case "reduce":
    case "reduceRight": {
      const rt = em.lt(node);
      if (a.length < 2)
        return {
          c: cpp.call(cpp.dot(o, name), [cb([e, e, T.number, self], e).c]),
          t: e,
        };
      const init = em.exprAs(a[1]!, rt);
      return {
        c: cpp.call(cpp.dot(o, name), [
          cb([rt, e, T.number, self], rt).c,
          cpp.construct(em.reg.cppType(rt), [init]),
        ]),
        t: rt,
      };
    }
    case "sort":
    case "toSorted": {
      if (!a[0]) return { c: cpp.call(cpp.dot(o, name), []), t: at };
      return { c: cpp.call(cpp.dot(o, name), [cb([e, e], T.number).c]), t: at };
    }
    case "reverse":
    case "toReversed":
      return { c: cpp.call(cpp.dot(o, name), []), t: at };
    case "fill":
      return {
        c: cpp.call(cpp.dot(o, "fill"), [...argList(em.exprAs(a[0]!, e), n(1, NAN), n(2, END))]),
        t: at,
      };
    case "values":
      return { c: cpp.call(cpp.dot(o, "slice"), []), t: at };
    case "keys":
      const index = cpp.lambda([], [cpp.param(cpp.type("double"), "i")], [cpp.ret(cpp.id("i"))]);
      return {
        c: cpp.call("lucent::Array<double>::generate", [cpp.call(cpp.dot(o, "length")), index]),
        t: { k: "array", e: T.number },
      };
    case "entries":
      return {
        c: cpp.call("lucent::arrayEntries", [o]),
        t: { k: "array", e: { k: "tuple", es: [T.number, e] } },
      };
  }
  fail(node, Codes.UnsupportedBuiltin, `Array.prototype.${name} is not supported`);
}

/** A predicate callback whose result is tested for truthiness. */
function truthyCallback(em: FnEmitter, arg: ts.Expression | undefined, params: LType[]): cpp.Expr {
  const own = arg ? em.lt(arg) : undefined;
  const ret = own && own.k === "fn" ? own.ret : T.boolean;
  const c = callback(em, arg, params, ret);
  if (ret.k === "boolean") return c.c;
  const f = em.ctx.fresh("pred");
  const ps = params.map((p, i) => cpp.param(em.reg.cppType(p), `a${i}`));
  const call = cpp.call(
    f,
    ps.map((p) => cpp.id(p.name!)),
  );
  return cpp.lambda([{ name: f, init: c.c }], ps, [cpp.ret(cpp.call("lucent::truthy", [call]))]);
}

function mapMethod(
  em: FnEmitter,
  obj: E & { t: { k: "map"; key: LType; val: LType } },
  name: string,
  node: ts.CallExpression,
): E {
  const { key, val } = obj.t;
  const o = obj.c;
  const a = node.arguments;
  switch (name) {
    case "get":
      return {
        c: cpp.call(cpp.dot(o, "get"), [em.exprAs(a[0]!, key)]),
        t: unionOf([val, T.undefined]),
      };
    case "set":
      return {
        c: cpp.call(cpp.dot(o, "set"), [em.exprAs(a[0]!, key), em.exprAs(a[1]!, val)]),
        t: obj.t,
      };
    case "has":
      return bool(cpp.call(cpp.dot(o, "has"), [em.exprAs(a[0]!, key)]));
    case "delete":
      return bool(cpp.call(cpp.dot(o, "remove"), [em.exprAs(a[0]!, key)]));
    case "clear":
      return { c: cpp.call(cpp.dot(o, "clear"), []), t: T.undefined };
    case "forEach":
      return {
        c: cpp.call(cpp.dot(o, "forEach"), [callback(em, a[0], [val, key, obj.t], T.void).c]),
        t: T.undefined,
      };
    case "keys":
      return { c: cpp.call(cpp.dot(o, "keys"), []), t: { k: "array", e: key } };
    case "values":
      return { c: cpp.call(cpp.dot(o, "values"), []), t: { k: "array", e: val } };
    case "entries":
      return {
        c: cpp.call("lucent::mapEntries", [o]),
        t: { k: "array", e: { k: "tuple", es: [key, val] } },
      };
  }
  fail(node, Codes.UnsupportedBuiltin, `Map.prototype.${name} is not supported`);
}

function setMethod(
  em: FnEmitter,
  obj: E & { t: { k: "set"; e: LType } },
  name: string,
  node: ts.CallExpression,
): E {
  const e = obj.t.e;
  const o = obj.c;
  const a = node.arguments;
  switch (name) {
    case "add":
      return { c: cpp.call(cpp.dot(o, "add"), [em.exprAs(a[0]!, e)]), t: obj.t };
    case "has":
      return bool(cpp.call(cpp.dot(o, "has"), [em.exprAs(a[0]!, e)]));
    case "delete":
      return bool(cpp.call(cpp.dot(o, "remove"), [em.exprAs(a[0]!, e)]));
    case "clear":
      return { c: cpp.call(cpp.dot(o, "clear"), []), t: T.undefined };
    case "forEach":
      return {
        c: cpp.call(cpp.dot(o, "forEach"), [callback(em, a[0], [e, e, obj.t], T.void).c]),
        t: T.undefined,
      };
    case "values":
    case "keys":
      return { c: cpp.call(cpp.dot(o, "values"), []), t: { k: "array", e } };
  }
  fail(node, Codes.UnsupportedBuiltin, `Set.prototype.${name} is not supported`);
}

function bytesMethod(em: FnEmitter, o: cpp.Expr, name: string, node: ts.CallExpression): E {
  const a = node.arguments;
  const n = (i: number, ifUndefined: cpp.Expr) => optArg(em, node, i, T.number, ifUndefined);
  switch (name) {
    case "subarray":
    case "slice":
      return { c: cpp.call(cpp.dot(o, name), [...argList(n(0, NAN), n(1, END))]), t: T.bytes };
    case "fill":
      return {
        c: cpp.call(cpp.dot(o, "fill"), [
          argAs(em, node, 0, T.number),
          ...argList(n(1, NAN), n(2, END)),
        ]),
        t: T.bytes,
      };
    case "indexOf":
      return num(
        cpp.call(cpp.dot(o, "indexOf"), [argAs(em, node, 0, T.number), ...argList(n(1, NAN))]),
      );
    case "includes":
      return bool(
        cpp.call(cpp.dot(o, "includes"), [argAs(em, node, 0, T.number), ...argList(n(1, NAN))]),
      );
    case "set": {
      const src = em.expr(a[0]!);
      const st = stripOpt(src.t);
      if (st.k !== "bytes" && !(st.k === "array" && st.e.k === "number"))
        fail(node, Codes.UnsupportedBuiltin, "set() needs a Uint8Array or number[]");
      return {
        c: cpp.call(cpp.dot(o, "setFrom"), [...argList(src.c, n(1, NAN))]),
        t: T.undefined,
      };
    }
    case "forEach":
      return {
        c: cpp.call(cpp.dot(o, "forEach"), [
          callback(em, a[0], [T.number, T.number, T.bytes], T.void).c,
        ]),
        t: T.undefined,
      };
    case "map":
      return {
        c: cpp.call(cpp.dot(o, "map"), [
          callback(em, a[0], [T.number, T.number, T.bytes], T.number).c,
        ]),
        t: T.bytes,
      };
    case "reduce": {
      const rt = em.lt(node);
      if (!a[1]) fail(node, Codes.UnsupportedBuiltin, "Uint8Array reduce needs an initial value");
      return {
        c: cpp.call(cpp.dot(o, "reduce"), [
          callback(em, a[0], [rt, T.number, T.number, T.bytes], rt).c,
          cpp.construct(em.reg.cppType(rt), [em.exprAs(a[1], rt)]),
        ]),
        t: rt,
      };
    }
    case "join":
      return str(
        cpp.call(cpp.dot(o, "join"), [...argList(optArg(em, node, 0, T.string, stringExpr(",")))]),
      );
  }
  fail(node, Codes.UnsupportedBuiltin, `Uint8Array.prototype.${name} is not supported`);
}

// --- globals -------------------------------------------------------------------------------

export function globalCall(
  em: FnEmitter,
  node: ts.CallExpression,
  name: string,
  sym: ts.Symbol,
): E | undefined {
  const a = node.arguments;
  if (isCoreSymbol(sym)) return coreCall(em, node, name);
  const decl = sym.declarations?.[0];
  if (!decl || !decl.getSourceFile().isDeclarationFile) return undefined;
  switch (name) {
    case "parseInt":
      return num(
        cpp.call("lucent::parseInt", [
          ...argList(argAs(em, node, 0, T.string), optArg(em, node, 1, T.number, NAN)),
        ]),
      );
    case "parseFloat":
      return num(cpp.call("lucent::parseFloat", [argAs(em, node, 0, T.string)]));
    case "isNaN":
      return bool(cpp.call("std::isnan", [argAs(em, node, 0, T.number)]));
    case "isFinite":
      return bool(cpp.call("std::isfinite", [argAs(em, node, 0, T.number)]));
    case "String":
      return str(a[0] ? em.toStringCode(em.expr(a[0])) : stringExpr(""));
    case "Number": {
      if (!a[0]) return num(cpp.num("0.0"));
      const v = em.expr(a[0]);
      const t = stripOpt(v.t);
      if (v.t.k === "string") return num(cpp.call("lucent::stringToNumber", [v.c]));
      if (v.t.k === "number") return num(v.c);
      if (v.t.k === "boolean") return num(cpp.conditional(v.c, cpp.num("1.0"), cpp.num("0.0")));
      if (v.t.k === "bigint") return num(cpp.call(cpp.dot(v.c, "toDouble")));
      // A union of those, possibly absent (a constant group's number or a 64-bit bigint).
      if (convertible(v.t, NUMBER_FROM)) return num(cpp.call("lucent::toNumber", [v.c]));
      fail(node, Codes.UnsupportedBuiltin, `Number() of ${typeKey(v.t)}${t ? "" : ""}`);
    }
    case "Boolean":
      return bool(a[0] ? em.cond(a[0]) : cpp.bool(false));
    case "BigInt": {
      const v = em.expr(a[0]!);
      const from = BIGINT_FROM[v.t.k];
      if (!from && convertible(v.t, new Set(Object.keys(BIGINT_FROM))))
        return big(cpp.call("lucent::toBigInt", [v.c]));
      if (!from)
        fail(
          node,
          Codes.UnsupportedBuiltin,
          `BigInt() of ${typeKey(v.t)} is not supported; narrow it to a number, string, boolean or bigint`,
        );
      return big(from(v.c));
    }
  }
  fail(node, Codes.UnsupportedBuiltin, `${name}() is not supported`);
}

/** What Number(x) converts: each as JavaScript does (undefined to NaN, null to 0). */
const NUMBER_FROM: ReadonlySet<string> = new Set([
  "number",
  "boolean",
  "string",
  "bigint",
  "undefined",
  "null",
]);

/**
 * Whether every value of `t` is of a kind in `kinds`: `t` itself, an
 * optional (absent values: when `kinds` has undefined and null) or a
 * union of them; lucent::toNumber and lucent::toBigInt take it as held.
 */
function convertible(t: LType, kinds: ReadonlySet<string>): boolean {
  if (t.k === "opt")
    return kinds.has("undefined") && kinds.has("null") && convertible(t.inner, kinds);
  if (t.k === "union") return t.ms.every((m) => convertible(m, kinds));

  return kinds.has(t.k);
}

/** BigInt(x) by the type of x: exact, or a RangeError (fractional numbers) or SyntaxError (strings). */
const BIGINT_FROM: Partial<Record<LType["k"], (v: cpp.Expr) => cpp.Expr>> = {
  bigint: (v) => v,
  number: (v) => cpp.call("lucent::BigInt::fromDouble", [v]),
  string: (v) => cpp.call("lucent::BigInt::parse", [v]),
  boolean: (v) =>
    cpp.call("lucent::BigInt::fromInt64", [cpp.conditional(v, cpp.num(1), cpp.num(0))]),
};

// --- new --------------------------------------------------------------------------------------

export function newBuiltin(
  em: FnEmitter,
  node: ts.NewExpression,
  callee: ts.Expression,
  t: LType,
): E {
  const a = node.arguments ?? ts.factory.createNodeArray();
  const name = ts.isIdentifier(callee) ? callee.text : "";
  switch (t.k) {
    case "abortController":
      return {
        c: cpp.call("std::make_shared", [], [cpp.type("lucent::AbortControllerObject")]),
        t,
      };
    case "regexp": {
      const flags = a[1]
        ? cpp.construct(cpp.type("lucent::Opt", cpp.type("lucent::String")), [
            em.exprAs(a[1], T.string),
          ])
        : cpp.id("lucent::undefined");
      const p = em.expr(a[0]!);
      // From another RegExp (its source) or a pattern string.
      const source = em.coerce(p, stripOpt(p.t).k === "regexp" ? T.regexp : T.string, a[0]);
      return { c: cpp.call("lucent::makeRegExp", [source, flags]), t };
    }
    case "date": {
      if (a.length === 0)
        return { c: cpp.call("lucent::makeDate", [cpp.call("lucent::dateNow")]), t };
      if (a.length === 1) {
        const v = em.expr(a[0]!);
        const vt = v.t;
        if (vt.k === "number") return { c: cpp.call("lucent::makeDate", [v.c]), t };
        if (vt.k === "string") return { c: cpp.call("lucent::dateFromString", [v.c]), t };
        if (vt.k === "date")
          return { c: cpp.call("lucent::makeDate", [cpp.call(cpp.arrow(v.c, "getTime"))]), t };
        fail(a[0], Codes.UnsupportedBuiltin, "new Date() takes a number, a string or a Date");
      }
      return {
        c: cpp.call(
          "lucent::dateFromLocal",
          a.map((x) => orUndefined(em, x, T.number, NAN)),
        ),
        t,
      };
    }
    case "map": {
      if (!a[0]) return { c: cpp.construct(em.reg.cppType(t), []), t };
      const entries = em.exprAs(a[0], { k: "array", e: { k: "tuple", es: [t.key, t.val] } });
      return {
        c: cpp.call(
          "lucent::mapFromEntries",
          [entries],
          [em.reg.cppType(t.key), em.reg.cppType(t.val)],
        ),
        t,
      };
    }
    case "set": {
      if (!a[0]) return { c: cpp.construct(em.reg.cppType(t), []), t };
      const src = em.expr(a[0]);
      const st = stripOpt(src.t);
      if (st.k === "array")
        return {
          c: cpp.construct(em.reg.cppType(t), [em.coerce(src, { k: "array", e: t.e }, a[0])]),
          t,
        };
      if (st.k === "set")
        return { c: cpp.construct(em.reg.cppType(t), [cpp.call(cpp.dot(src.c, "values"))]), t };
      if (st.k === "string")
        return {
          c: cpp.construct(em.reg.cppType(t), [cpp.call("lucent::splitCodePoints", [src.c])]),
          t,
        };
      fail(node, Codes.UnsupportedBuiltin, `new Set(${typeKey(src.t)})`);
    }
    case "array": {
      if (a.length === 1) {
        const v = em.expr(a[0]!);
        if (v.t.k === "number" && filledWhole(node))
          return {
            c: cpp.call(cpp.scoped(em.reg.cppType(t), "filled"), [
              cpp.call("lucent::arrayLength", [v.c]),
              cpp.construct(em.reg.cppType(t.e), [], true),
            ]),
            t,
          };
        if (holdsNumber(v.t))
          fail(
            node,
            Codes.UnsupportedBuiltin,
            v.t.k === "number"
              ? "new Array(n) makes n holes, which Lucent arrays cannot hold: write new Array(n).fill(value), or Array.from({ length: n }, (_, i) => …)"
              : "new Array(x) of a value that may be a number is not supported: JavaScript makes x holes for a number and [x] otherwise; write [x], or new Array(n).fill(value)",
          );
      }
      return {
        c: cpp.construct(
          em.reg.cppType(t),
          a.map((x) => em.exprAs(x, t.e)),
          true,
        ),
        t,
      };
    }
    case "bytes": {
      if (!a[0]) return { c: cpp.construct(cpp.type("lucent::Bytes")), t };
      const v = em.expr(a[0]);
      const vt = stripOpt(v.t);
      if (vt.k === "number") return { c: cpp.call("lucent::Bytes", [v.c]), t };
      if (vt.k === "array")
        return {
          c: cpp.call("lucent::Bytes::fromArray", [
            em.coerce(v, { k: "array", e: T.number }, a[0]),
          ]),
          t,
        };
      if (vt.k === "bytes") return { c: cpp.call(cpp.dot(v.c, "slice"), []), t };
      fail(node, Codes.UnsupportedBuiltin, `new Uint8Array(${typeKey(v.t)})`);
    }
    case "promise": {
      // The executor runs now, with functions that settle the promise once;
      // one that throws rejects it.
      const exec = a[0];
      if (!exec || !(ts.isArrowFunction(exec) || ts.isFunctionExpression(exec)))
        fail(
          node,
          Codes.UnsupportedBuiltin,
          "new Promise() takes an executor function: new Promise((resolve, reject) => …)",
        );
      const none = t.inner.k === "void" || t.inner.k === "undefined";
      const resolveT: LType = { k: "fn", params: none ? [] : [t.inner], ret: T.void };
      const rejectT: LType = { k: "fn", params: [T.error], ret: T.void };
      const executor = em.closure(exec, { k: "fn", params: [resolveT, rejectT], ret: T.void });
      const p = cpp.id("p_");
      const settle = (how: string, value: cpp.Expr) =>
        cpp.exprStmt(cpp.call(cpp.dot(p, how), [value]));
      const resolve = cpp.construct(em.reg.cppType(resolveT), [
        none
          ? cpp.lambda(["p_"], [], [settle("resolve", cpp.id("lucent::undefined"))])
          : cpp.lambda(
              ["p_"],
              [cpp.param(em.reg.cppType(t.inner), "v_")],
              [settle("resolve", cpp.call("std::move", [cpp.id("v_")]))],
            ),
      ]);
      const reject = cpp.construct(em.reg.cppType(rejectT), [
        cpp.lambda(
          ["p_"],
          [cpp.param(cpp.type("lucent::Error"), "e_")],
          [settle("reject", cpp.call("std::move", [cpp.id("e_")]))],
        ),
      ]);
      const thrown = cpp.call("lucent::currentError", [cpp.call("std::current_exception")]);
      return {
        c: cpp.statementExpr(
          [
            cpp.varDecl(em.reg.cppType(t), "p_"),
            {
              k: "try",
              body: [cpp.exprStmt(cpp.call(executor.c, [resolve, reject]))],
              catches: [{ body: [settle("reject", thrown)] }],
            },
          ],
          p,
        ),
        t,
      };
    }
    case "error": {
      if (!isErrorName(name) || !isLibGlobal(em, callee, name)) break;
      if (a[1]) refuseCause(a[1]);
      const msg = a[0] ? em.exprAs(a[0], T.string) : stringExpr("");
      return { c: withSite(cpp.call("lucent::makeError", [stringExpr(name), msg]), node), t };
    }
  }
  fail(node, Codes.UnsupportedBuiltin, `new ${name || callee.getText()}() is not supported`);
}

function refuseCause(options: ts.Expression): never {
  fail(
    options,
    Codes.UnsupportedBuiltin,
    "an error's cause (new Error(message, { cause })) is not supported: Lucent errors carry a name, a message and a code; put what the cause says in the message, or keep it in a field of an Error class",
  );
}

// --- instanceof / super ----------------------------------------------------------------------

/** The runtime trait that recognizes each built-in kind `instanceof` and Array.isArray test. */
const KIND_TRAITS = {
  Array: "lucent::IsJsArray",
  Map: "lucent::IsMap",
  Set: "lucent::IsSet",
  Uint8Array: "lucent::IsBytes",
  Date: "lucent::IsDate",
} as const;

type Kind = keyof typeof KIND_TRAITS;

function isKind(name: string): name is Kind {
  return Object.hasOwn(KIND_TRAITS, name);
}

/**
 * Whether the value `v` holds is of the built-in `kind`, as JavaScript
 * tests it: by the value, whatever union or tuple its static type is.
 */
function heldKind(node: ts.Node, v: E, kind: Kind): E {
  const t = stripOpt(v.t);
  if ((t.k === "union" ? t.ms : [t]).some((m) => m.k === "iter"))
    fail(
      node,
      Codes.UnsupportedBuiltin,
      `testing whether an Iterable is a ${kind} is not supported: an Iterable no longer knows what it was made from; take a ${kind === "Array" ? "T[]" : kind} parameter`,
    );
  return bool(cpp.call("lucent::holds", [v.c], [cpp.type(KIND_TRAITS[kind])]));
}

export function instanceOf(em: FnEmitter, node: ts.BinaryExpression): E {
  const sdk = nativeInstanceOf(em, node);
  if (sdk) return sdk;

  const v = em.expr(node.left);
  const right = node.right;
  if (ts.isIdentifier(right)) {
    if (isErrorName(right.text) && isLibGlobal(em, right, right.text)) {
      const kind = right.text === "Error" ? cpp.nullptr : cpp.str(right.text);
      return bool(cpp.call("lucent::isErrorOf", [v.c, kind]));
    }
    const sym = em.checker.getSymbolAtLocation(right);
    const g = sym ? em.ctx.globals.get(em.ctx.resolve(sym)) : undefined;
    if (g && g.kind === "class") {
      if (g.info.typeParams.length)
        fail(node, Codes.UnsupportedOperator, "instanceof with a generic class is not supported");
      return bool(
        cpp.call("lucent::isInstance", [v.c], [cpp.type(`lucent_app::${g.info.cppName}`)]),
      );
    }
    if (isKind(right.text) && isLibGlobal(em, right, right.text))
      return heldKind(node, v, right.text);
  }
  fail(node, Codes.UnsupportedOperator, "unsupported instanceof");
}

export function superCall(em: FnEmitter, node: ts.CallExpression): E {
  const cls = em.opts.cls;
  if (cls?.base)
    fail(node, Codes.UnsupportedClassFeature, "call `super(...)` as a statement of its own");
  // An iOS base: the native object that stands for the instance, made now.
  if (cls?.sdkBase?.platform === "ios") return subclassSuperCall(em, node, cls);
  // An Android base: its Java object is made where the instance goes to Java.
  if (cls?.sdkBase) {
    if (node.arguments.length)
      fail(
        node,
        Codes.UnsupportedClassFeature,
        `extending ${cls.sdkBase.name}: call super() without arguments`,
      );
    return { c: cpp.id("lucent::undefined"), t: T.undefined };
  }
  if (!cls || !cls.isError)
    fail(node, Codes.UnsupportedClassFeature, "`super(...)` is only supported in subclasses");
  if (node.arguments[1]) refuseCause(node.arguments[1]);
  const msg = node.arguments[0] ? em.exprAs(node.arguments[0], T.string) : stringExpr("");
  return {
    c: cpp.comma(cpp.assign(cpp.arrow(cpp.self, "message"), msg), cpp.id("lucent::undefined")),
    t: T.undefined,
  };
}
