import { cpp } from "@lucent-lang/codegen";
import { osMade } from "./java.ts";
import ts from "typescript";
import { literalConstant } from "../analysis/index.ts";
import { Codes, fail } from "../diagnostics.ts";
import { isLibFile } from "../program.ts";
import {
  type ClassInfo,
  cppIdent,
  functionsNotCompared,
  holdsFunction,
  holdsJsValue,
  jsValueOpaque,
  isErrorName,
  isTypedArray,
  isVoidish,
  type LType,
  sameType,
  stripOpt,
  T,
  TYPED_NAMES,
  typedElement,
  typeKey,
  unionOf,
} from "../types.ts";
import { AUTO_CLOSEABLE, sdkClassIs } from "../sdk/schema.ts";
import {
  bufferDispose,
  bufferMethod,
  bufferProperty,
  nativeHandleMethod,
  nativeHandleProperty,
  bufferStatic,
  spanMethod,
  spanProperty,
} from "./buffers.ts";
import { channelMethod, channelNew, channelProperty } from "./channels.ts";
import { emitterMethod, emitterNew, subscriptionMethod } from "./events.ts";
import { assignedRead } from "../lowering/unassigned.ts";
import { DISPOSE, findMember } from "./classes.ts";
import { type E, elementOrUndefined, type Lvalue } from "./context.ts";
import { coreCall, isCoreSymbol } from "./core.ts";
import { type FnEmitter, substitute } from "./function.ts";
import { signalMethod } from "./setups.ts";
import { type IfaceMember, membersOf } from "./interfaces.ts";
import { numberExpr, stringExpr } from "./literals.ts";
import { handleDispose, handleMethodCall } from "./extensions.ts";
import {
  inMainContext,
  collectSequence,
  javaSubclassNative,
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
/** A number that is a size (`size_t`), with its int64 form. */
const sized = (size: cpp.Expr): E => {
  const c = cpp.staticCast(cpp.type("int64_t"), size);

  return { c: cpp.staticCast(cpp.type("double"), c), t: T.number, int: { c, kind: "i64" } };
};

// --- properties -----------------------------------------------------------------------

export function property(em: FnEmitter, obj: E, name: string, node: ts.Node): E {
  const t = obj.t;
  const o = obj.c;
  switch (t.k) {
    // A length is an exact integer: its int64 form compares with a for counter's without doubles.
    case "string":
      if (name === "length") return sized(cpp.call(cpp.dot(o, "length"), []));
      break;
    case "array":
      if (name === "length") return sized(cpp.call(cpp.dot(o, "size"), []));
      break;
    case "tuple":
      if (name === "length") return num(numberExpr(t.es.length));
      break;
    case "map":
    case "set":
      if (name === "size") return num(cpp.call(cpp.dot(o, "size"), []));
      break;
    case "bytes":
    case "typed":
      if (name === "length" || name === "byteLength" || name === "byteOffset")
        return num(cpp.call(cpp.dot(o, name), []));
      if (name === "BYTES_PER_ELEMENT") return num(numberExpr(TYPED_SIZES[typedClass(t)]!));
      if (name === "buffer")
        return { c: cpp.call(cpp.dot(o, "arrayBuffer"), []), t: T.arrayBuffer };
      break;
    case "dataView":
      if (name === "byteLength" || name === "byteOffset")
        return num(cpp.call(cpp.dot(o, name), []));
      if (name === "buffer") return { c: cpp.call(cpp.dot(o, "buffer"), []), t: T.arrayBuffer };
      break;
    case "arrayBuffer":
      if (name === "byteLength") return num(cpp.call(cpp.dot(o, "byteLength"), []));
      break;
    case "dict":
      // `record.key` is `record["key"]` on an index signature.
      return elementOrUndefined(cpp.call(cpp.dot(o, "get"), [stringExpr(name)]), t.val);
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
    case "nativeHandle":
      return nativeHandleProperty(obj, name, node);
    case "executor":
      if (name === "label")
        return str(cpp.call("lucent::String::fromUtf8", [cpp.call(cpp.arrow(o, "label"), [])]));
      break;
    case "channel":
      return channelProperty(obj, name, node);
    case "span":
      return spanProperty(obj, name, node);
    case "error":
      if (name === "message") return str(cpp.arrow(o, "message"));
      if (name === "name") return str(cpp.arrow(o, "name"));
      // An AggregateError's reasons, which its declaration types as any[]: Errors, as Lucent rejects.
      if (
        name === "errors" &&
        ts.isPropertyAccessExpression(node) &&
        isAggregate(em, node.expression)
      )
        return { c: cpp.call("lucent::aggregateErrors", [o]), t: { k: "array", e: T.error } };
      if (name === "stack")
        return { c: cpp.arrow(o, "stack"), t: unionOf([T.string, T.undefined]) };
      // Its declaration types it unknown: an Error here, the only cause Lucent makes or keeps.
      if (name === "cause")
        return { c: cpp.call("lucent::causeOf", [o]), t: unionOf([T.error, T.undefined]) };
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
  if (info.isError && name === "cause" && !classMemberDecl(em, t0, name))
    return {
      c: cpp.call("lucent::causeOf", [cpp.call("lucent::Error", [obj.c])]),
      t: unionOf([T.error, T.undefined]),
    };
  const found = classMemberDecl(em, t0, name);
  // A member it inherits from the iOS class it extends: its native object's.
  if (!found && info.sdkBase?.platform === "ios")
    return nativeMember(em, subclassNative(obj, info), node);
  // From the Android class it extends: its Java object's.
  if (!found && info.sdkBase?.platform === "android")
    return nativeMember(em, javaSubclassNative(em, obj, info), node);
  if (!found) fail(node, Codes.UnsupportedClassFeature, `unknown member ${name}`);
  const { decl, owner: t } = found;
  if (ts.isGetAccessorDeclaration(decl)) {
    const type = memberType(em, t, decl);
    return { c: cpp.call(cpp.arrow(obj.c, `get_${cppIdent(name)}`), []), t: type };
  }
  if (ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) {
    const type = memberType(em, t, decl);
    const what = `${em.reg.cls(t.id).decl.name?.text ?? "this"}.${name}`;

    return { c: assignedRead(cpp.arrow(obj.c, cppIdent(name)), type, what), t: type };
  }
  if (ts.isMethodDeclaration(decl)) {
    // A bound method used as a value.
    if (decl.parameters.at(-1)?.dotDotDotToken)
      fail(
        node,
        Codes.UnsupportedType,
        `${name} takes a rest parameter, so it can only be called, not used as a value`,
        "call it inside an arrow function",
      );
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
    const decl = c.members.find(
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
  // The Android class it extends: its implementation, on the Java object the class's `this` is.
  if (cls?.sdkBase?.platform === "android") {
    if (!call)
      fail(
        node,
        Codes.UnsupportedClassFeature,
        `super.${name}: only methods of ${cls.sdkBase.name} are called through super`,
      );
    const self = javaSubclassNative(
      em,
      { c: cpp.self, t: { k: "class", id: cls.id, args: [] } },
      cls,
    );
    return (
      nativeCall(em, call, self, cls) ??
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

/**
 * How Promise.race and Promise.any over a tuple give an input's value
 * (`from`) as their result (`to`): as it is, or converted.
 */
function inputConverter(em: FnEmitter, from: LType, to: LType, node: ts.Node): cpp.Expr {
  if (isVoidish(to) || from.k === "never" || sameType(from, to)) return cpp.id("lucent::asIs");

  return cpp.lambda(
    [],
    [cpp.param(em.reg.cppType(from), "x")],
    [cpp.ret(em.coerce({ c: cpp.id("x"), t: from }, to, node))],
    { ret: em.reg.cppType(to) },
  );
}

/**
 * Promise.allSettled's functions that make an input's outcome, of the
 * PromiseSettledResult `result`: from its value (of `inner`), and from the
 * Error it rejected with.
 */
function settledMakers(
  em: FnEmitter,
  inner: LType,
  result: LType,
  node: ts.Node,
): [cpp.Expr, cpp.Expr] {
  const members = result.k === "union" ? result.ms : [result];
  const made = (status: string, field: string, from: LType): cpp.Expr => {
    const s = members.find(
      (m) =>
        m.k === "struct" &&
        em.reg.struct(m.id).fields.some((f) => f.name === "status" && f.literal === status),
    );
    if (!s || s.k !== "struct")
      fail(node, Codes.UnsupportedBuiltin, `Promise.allSettled's ${typeKey(result)} results`);
    const info = em.reg.struct(s.id);
    const target = info.fields.find((f) => f.name === field)!;
    const o = cpp.id("o");
    const made = cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]);

    return cpp.lambda(
      [],
      [cpp.param(em.reg.cppType(from), "x")],
      [
        cpp.varDecl(cpp.auto, "o", made),
        cpp.exprStmt(cpp.assign(cpp.arrow(o, "status"), stringExpr(status))),
        cpp.exprStmt(
          cpp.assign(
            cpp.arrow(o, cppIdent(field)),
            em.coerce({ c: cpp.id("x"), t: from }, target.type, node),
          ),
        ),
        cpp.ret(em.coerce({ c: o, t: s }, result, node)),
      ],
      { ret: em.reg.cppType(result) },
    );
  };

  return [made("fulfilled", "value", inner), made("rejected", "reason", T.error)];
}

/** Whether `node`'s type is the library's AggregateError. */
function isAggregate(em: FnEmitter, node: ts.Expression): boolean {
  const sym = em.checker.getNonNullableType(em.checker.getTypeAtLocation(node)).getSymbol();
  const decl = sym?.declarations?.[0];

  return sym?.name === "AggregateError" && !!decl && isLibFile(decl.getSourceFile());
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
  const typed = typedGlobal(em, obj);
  if (typed && name === "BYTES_PER_ELEMENT") return num(numberExpr(TYPED_SIZES[typed]!));
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
          : assignedRead(
              cpp.id(`lucent_app::${owner.cppName}::${cppIdent(name)}`),
              t,
              `${owner.decl.name?.text}.${name}`,
            ),
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

/** The Object functions that list an object's fields. */
const OBJECT_LISTINGS = new Set(["keys", "values", "entries"]);

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
    if (
      (name === "min" || name === "max") &&
      a.length === 1 &&
      ts.isSpreadElement(a[0]!) &&
      !em.spreadsTuple(a[0]!)
    ) {
      const all = em.exprAs(a[0]!.expression, { k: "array", e: T.number });
      return num(cpp.call(`lucent::math::${name}Of`, [all]));
    }
    // A tuple spread is an argument per element.
    const spread = a.some((x) => ts.isSpreadElement(x) && !em.spreadsTuple(x));
    if (spread || (name === "imul" && a.some(ts.isSpreadElement)))
      fail(node, Codes.UnsupportedBuiltin, `spread is only supported as Math.${name}(...array)`);
    if (a.some(ts.isSpreadElement)) {
      const given = a.flatMap((x) =>
        (em.tupleSpread(x) ?? [{ e: em.expr(x, T.number), node: x }]).map((g) =>
          em.coerce(g.e, T.number, g.node),
        ),
      );
      return num(cpp.call(`lucent::math::${name}`, given));
    }
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
          a.map((x) => orUndefined(em, x, T.number, NAN)),
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
  if (isLibGlobal(em, obj, "Object") && name === "groupBy") return groupBy(em, node, "record");
  if (isLibGlobal(em, obj, "Map")) {
    if (name === "groupBy") return groupBy(em, node, "map");
    fail(node, Codes.UnsupportedBuiltin, `Map.${name} is not supported`);
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
    if ((t.k === "struct" || t.k === "class") && name !== "fromEntries")
      fail(
        node,
        Codes.UnsupportedBuiltin,
        `Object.${name} of an object type is not supported${OBJECT_LISTINGS.has(name) ? ": Lucent objects do not record which optional fields are set or the order JavaScript made them in; use a Record<string, T>, or list the fields" : ""}`,
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
        c: cpp.call("lucent::dictFromEntries", [entries], [em.reg.cppType(rt.val, true)]),
        t: rt,
      };
    }
    fail(node, Codes.UnsupportedBuiltin, `Object.${name} is not supported on ${typeKey(v.t)}`);
  }
  if (isLibGlobal(em, obj, "ArrayBuffer")) {
    if (name === "isView") return heldKind(node, em.expr(a[0]!), "View");
    fail(node, Codes.UnsupportedBuiltin, `ArrayBuffer.${name} is not supported`);
  }
  const typed = typedGlobal(em, obj);
  if (typed) {
    const rt = em.lt(node);
    const e = typedElement(rt);
    const cls = typedCpp(rt);
    if (name === "of")
      return {
        c: cpp.call(`${cls}::fromArray`, [
          cpp.construct(
            em.reg.cppType({ k: "array", e }),
            a.map((x) => em.exprAs(x, e)),
            true,
          ),
        ]),
        t: rt,
      };
    if (name === "from" && a.length === 1) {
      const v = em.expr(a[0]!);
      const vt = stripOpt(v.t);
      if (vt.k === "array" && vt.e.k === e.k)
        return {
          c: cpp.call(`${cls}::fromArray`, [em.coerce(v, { k: "array", e }, a[0]!)]),
          t: rt,
        };
      if (isTypedArray(vt) && typedElement(vt).k === e.k)
        return sameType(vt, rt)
          ? { c: cpp.call(cpp.dot(v.c, "slice"), []), t: rt }
          : { c: cpp.call(`${cls}::fromTyped`, [v.c]), t: rt };
    }
    fail(
      node,
      Codes.UnsupportedBuiltin,
      name === "from"
        ? `${typed}.from takes an array or a typed array: map it first (\`${typed}.from(values.map(f))\`)`
        : `${typed}.${name} is not supported`,
    );
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
        c: cpp.call(cpp.dot(base.c, "map"), [cb.c], [em.reg.cppType(rt.e, true)]),
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
      const text = em.toStringCode(v, x);
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
      if (reachesJsValue(em, v.t))
        fail(node, Codes.UnsupportedBuiltin, jsValueOpaque("write as JSON"));
      if (a.length < 2) return str(cpp.call("lucent::json::stringify", [v.c]));
      // The replacer, then the space, as the source has them.
      const keys = jsonKeys(em, a[1]!);
      const gap = a[2] ? jsonGap(em, a[2]) : cpp.construct(cpp.type("lucent::String"), []);
      return str(cpp.call("lucent::json::stringify", [v.c, keys, gap]));
    }
    fail(
      node,
      Codes.UnsupportedBuiltin,
      `JSON.${name} is not supported (Lucent values are typed; parse with explicit code)`,
    );
  }
  if (isLibGlobal(em, obj, "Promise")) {
    if (name === "withResolvers") return withResolvers(em, node);
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
    if (name === "race" || name === "any") {
      const src = em.expr(a[0]!, em.lt(a[0]!));
      const st = stripOpt(src.t);
      const which = name === "race" ? "Race" : "Any";
      if (st.k === "array" && st.e.k === "promise")
        return { c: cpp.call(`lucent::promise${which}`, [src.c]), t: st.e };
      if (st.k === "tuple" && st.es.every((e) => e.k === "promise")) {
        const converters = st.es.map((e) =>
          inputConverter(em, (e as LType & { k: "promise" }).inner, rt.inner, node),
        );
        return {
          c: cpp.call(
            `lucent::promise${which}Tuple`,
            [src.c, ...converters],
            [em.reg.cppRetType(rt.inner)],
          ),
          t: rt,
        };
      }
      fail(node, Codes.UnsupportedBuiltin, `Promise.${name} needs an array or a tuple of promises`);
    }
    if (name === "allSettled") {
      const src = em.expr(a[0]!, em.lt(a[0]!));
      const st = stripOpt(src.t);
      const out = rt.inner;
      if (st.k === "array" && st.e.k === "promise" && out.k === "array") {
        const [fulfilled, rejected] = settledMakers(em, st.e.inner, out.e, node);
        return {
          c: cpp.call(
            "lucent::promiseAllSettled",
            [src.c, fulfilled, rejected],
            [em.reg.cppType(out.e)],
          ),
          t: rt,
        };
      }
      if (
        st.k === "tuple" &&
        st.es.every((e) => e.k === "promise") &&
        out.k === "tuple" &&
        out.es.length === st.es.length
      ) {
        const makers = st.es.map((e, i) =>
          settledMakers(em, (e as LType & { k: "promise" }).inner, out.es[i]!, node),
        );
        return {
          c: cpp.call("lucent::promiseAllSettledTuple", [
            src.c,
            cpp.call(
              "std::make_tuple",
              makers.map(([f]) => f),
            ),
            cpp.call(
              "std::make_tuple",
              makers.map(([, g]) => g),
            ),
          ]),
          t: rt,
        };
      }
      fail(
        node,
        Codes.UnsupportedBuiltin,
        "Promise.allSettled needs an array or a tuple of promises",
      );
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

/**
 * `Object.groupBy(items, key)` and `Map.groupBy(items, key)`: each item of
 * an iterable under the key `key(item, index)` gives, in a record (string
 * keys, listed as an object lists them) or a map (any key, by
 * SameValueZero). Keys of literal types make TypeScript type a record's
 * result as an object type of optional fields (`Partial<Record<"a" | "b",
 * T[]>>`): the groups are made by name, then set as those fields.
 */
function groupBy(em: FnEmitter, node: ts.CallExpression, into: "record" | "map"): E {
  const rt = em.lt(node);
  const a = node.arguments;
  if (into === "record" && rt.k !== "dict" && rt.k !== "struct")
    fail(node, Codes.UnsupportedBuiltin, "Object.groupBy must make a record or an object");
  if (into === "map" && rt.k !== "map")
    fail(node, Codes.UnsupportedBuiltin, "Map.groupBy must make a map");
  const fields = rt.k === "struct" ? em.reg.struct(rt.id).fields : [];
  const groupType =
    rt.k === "dict"
      ? rt.val
      : rt.k === "map"
        ? rt.val
        : (fields[0]?.type ?? fail(node, Codes.UnsupportedBuiltin, "Object.groupBy with no keys"));
  const group = stripOpt(groupType);
  if (
    group.k !== "array" ||
    (rt.k === "struct" && groupType.k !== "opt") ||
    fields.some((f) => typeKey(f.type) !== typeKey(groupType))
  )
    fail(node, Codes.UnsupportedBuiltin, `${node.expression.getText()} of mixed groups`);
  const src = a[0]!;
  const s = em.expr(src);
  const items = em.iterableItems(s, src);
  const list = em.coerce({ c: items.c, t: { k: "array", e: items.e } }, group, src);
  const key = rt.k === "map" ? rt.key : T.string;
  const cb = callback(em, a[1], [group.e, T.number], key);
  if (rt.k === "map")
    return { c: cpp.call("lucent::mapGroupBy", [list, cb.c], [em.reg.cppType(key)]), t: rt };
  const grouped = cpp.call("lucent::dictGroupBy", [list, cb.c], [em.reg.cppType(groupType)]);
  if (rt.k === "dict") return { c: grouped, t: rt };
  // An object type's fields, each the group of its name, when there is one.
  const info = em.reg.struct((rt as LType & { k: "struct" }).id);
  const g = cpp.id("g_");
  const r = cpp.id("r_");
  const read = (name: string) => cpp.call(cpp.dot(g, "get"), [stringExpr(name)]);
  return {
    c: cpp.statementExpr(
      [
        cpp.varDecl(cpp.auto, "g_", grouped),
        cpp.varDecl(
          cpp.auto,
          "r_",
          cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]),
        ),
        ...info.fields.map((f) =>
          cpp.exprStmt(
            cpp.assign(
              cpp.arrow(r, cppIdent(f.name)),
              f.type.k === "opt" ? cpp.call("lucent::flat", [read(f.name)]) : read(f.name),
            ),
          ),
        ),
      ],
      r,
    ),
    t: rt,
  };
}

/**
 * `Promise.withResolvers<T>()`: a new promise and the functions that settle
 * it, once, as a Promise executor's do (types.ts lowers their types).
 */
function withResolvers(em: FnEmitter, node: ts.CallExpression): E {
  const rt = em.lt(node);
  if (rt.k !== "struct") fail(node, Codes.UnsupportedBuiltin, "Promise.withResolvers");
  const info = em.reg.struct(rt.id);
  const typeOf = (name: string) => info.fields.find((f) => f.name === name)!.type;
  const promiseT = typeOf("promise") as LType & { k: "promise" };
  const resolveT = typeOf("resolve") as LType & { k: "fn" };
  const p = cpp.id("p_");
  const r = cpp.id("r_");
  const settle = (how: string, value: cpp.Expr) => cpp.exprStmt(cpp.call(cpp.dot(p, how), [value]));
  const resolve = cpp.construct(em.reg.cppType(resolveT), [
    resolveT.params.length === 0
      ? cpp.lambda(["p_"], [], [settle("resolve", cpp.id("lucent::undefined"))])
      : cpp.lambda(
          ["p_"],
          [cpp.param(em.reg.cppType(promiseT.inner), "v_")],
          [settle("resolve", cpp.call("std::move", [cpp.id("v_")]))],
        ),
  ]);
  const reject = cpp.construct(em.reg.cppType(typeOf("reject")), [
    cpp.lambda(
      ["p_"],
      [cpp.param(cpp.type("lucent::Error"), "e_")],
      [settle("reject", cpp.call("std::move", [cpp.id("e_")]))],
    ),
  ]);
  const set = (field: string, value: cpp.Expr) =>
    cpp.exprStmt(cpp.assign(cpp.arrow(r, cppIdent(field)), value));
  return {
    c: cpp.statementExpr(
      [
        cpp.varDecl(em.reg.cppType(promiseT), "p_"),
        cpp.varDecl(
          cpp.auto,
          "r_",
          cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]),
        ),
        set("promise", p),
        set("resolve", resolve),
        set("reject", reject),
      ],
      r,
    ),
    t: rt,
  };
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

/**
 * A method every alternative of a union of objects has: each
 * alternative's own call, chosen by the variant's index, its result
 * converted to the union of theirs. One call runs, so the arguments are
 * evaluated once.
 */
function unionMethodCall(
  em: FnEmitter,
  obj: E,
  t: LType & { k: "union" },
  name: string,
  node: ts.CallExpression,
): E {
  const u = em.ctx.fresh("u");
  const calls = t.ms.map((m, i) =>
    methodCall(em, { c: cpp.call("std::get", [cpp.id(u)], [cpp.num(i)]), t: m }, name, node),
  );
  const rt = unionOf(calls.map((c) => c.t));
  const value = calls
    .map((c) => (isVoidish(rt) ? c.c : em.coerce(c, rt, node)))
    .reduceRight((rest, call, i) =>
      cpp.conditional(
        cpp.binary(cpp.call(cpp.dot(cpp.id(u), "index")), "==", cpp.num(i)),
        call,
        rest,
      ),
    );
  const held = cpp.varDecl(cpp.reference(cpp.constType(cpp.auto)), u, obj.c);

  return { c: cpp.statementExpr([held], value), t: isVoidish(rt) ? T.undefined : rt };
}

export function methodCall(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E {
  const t = obj.t;
  if (t.k === "handle") return handleMethodCall(em, obj, name, node);
  if (t.k === "signal") return signalMethod(em, obj, name, node);
  if (t.k === "native" && name === DISPOSE)
    return { c: disposeCall(em, obj, node), t: T.undefined };
  if (t.k === "native" && t.module === "lucent:ios" && t.name === "AsyncSequence")
    return collectSequence(em, obj, name, node);
  if (t.k === "native")
    return (
      nativeCall(em, node, obj) ??
      fail(node, Codes.UnsupportedCall, `${name} is not a method of ${t.name}`)
    );
  const o = obj.c;
  const a = node.arguments;
  if (name === "toString" && a.length === 0 && t.k !== "number")
    return str(em.toStringCode(obj, node));
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
      // From the Android class it extends: its Java object's.
      if (!decl && info.sdkBase?.platform === "android")
        return (
          nativeCall(em, node, javaSubclassNative(em, obj, info)) ??
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
    case "union":
      if (t.ms.every((m) => m.k === "class" || m.k === "struct"))
        return unionMethodCall(em, obj, t, name, node);
      break;
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
    case "typed":
      return typedMethod(em, obj, name, node);
    case "dataView":
      return dataViewMethod(em, o, name, node);
    case "arrayBuffer":
      if (name === "slice")
        return {
          c: cpp.call(
            cpp.dot(o, "slice"),
            node.arguments.map((x) => em.exprAs(x, T.number)),
          ),
          t: T.arrayBuffer,
        };
      break;
    case "buffer":
      return bufferMethod(em, obj, name, node);
    case "nativeHandle":
      return nativeHandleMethod(obj, name, node);
    case "executor":
      if (name === "execute")
        fail(
          node,
          Codes.UnsupportedBuiltin,
          "an executor's execute() is for the platform: hand it a function with on(executor, f)",
        );
      break;
    case "weak":
      if (name === "deref" && !a.length)
        return { c: cpp.call(cpp.arrow(o, "deref"), []), t: unionOf([t.inner, T.undefined]) };
      break;
    case "weakMap":
    case "weakSet":
      return weakMethod(em, obj as E & { t: LType & { k: "weakMap" | "weakSet" } }, name, node);
    case "registry":
      return registryMethod(em, obj as E & { t: LType & { k: "registry" } }, name, node);
    case "emitter":
      return emitterMethod(em, obj, name, node);
    case "channel":
      return channelMethod(em, obj, name, node);
    case "subscription":
      return subscriptionMethod(obj, name, node);
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
            cpp.construct(cpp.type("lucent::IterResult", em.reg.cppType(t.e, true)), [], true),
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
      return promiseMethod(em, obj as E & { t: { k: "promise" } }, name, node);
  }
  fail(node, Codes.UnsupportedBuiltin, `.${name}() is not supported on ${typeKey(t)}`);
}

/**
 * `p.then(f, g)`, `p.catch(g)` and `p.finally(f)`, in JavaScript's microtask
 * order (async.h). A handler gives a value, or a promise the result adopts;
 * a rejection handler gets the Error.
 */
function promiseMethod(
  em: FnEmitter,
  obj: E & { t: { k: "promise" } },
  name: string,
  node: ts.CallExpression,
): E {
  const a = node.arguments;
  const rt = em.lt(node);
  if (rt.k !== "promise") fail(node, Codes.UnsupportedBuiltin, `promise.${name}()`);
  const r = em.reg.cppRetType(rt.inner);
  const given = (x: ts.Expression | undefined) =>
    x && !(ts.isIdentifier(x) && x.text === "undefined") && x.kind !== ts.SyntaxKind.NullKeyword
      ? x
      : undefined;
  // What a handler returns: a promise of the result's type, adopted, or a value of it.
  const handler = (x: ts.Expression, params: LType[], ret: LType) => {
    const sig = em.checker.getTypeAtLocation(x).getCallSignatures()[0];
    const own = sig && em.reg.lower(em.checker.getReturnTypeOfSignature(sig), x);
    // finally's handler: a promise of anything is waited for; its value is dropped.
    if (ret.k === "void") return callback(em, x, params, own?.k === "promise" ? own : T.void).c;
    return callback(em, x, params, own?.k === "promise" ? { k: "promise", inner: ret } : ret).c;
  };
  const value = isVoidish(obj.t.inner) ? [] : [obj.t.inner];
  // A promise that never fulfils (`Promise.reject(e)`): its fulfilment handler never runs.
  const fulfils = obj.t.inner.k !== "never";
  const call = (fn: string, args: cpp.Expr[], targs: cpp.Type[]) => ({
    c: cpp.call(fn, [obj.c, ...args], targs),
    t: rt,
  });
  switch (name) {
    case "then": {
      const [f, g] = [fulfils ? given(a[0]) : undefined, given(a[1])];
      if (!f && !g) return call("lucent::promisePass", [], [r]);
      if (!f) return call("lucent::promiseCatch", [handler(g!, [T.error], rt.inner)], [r]);
      if (!g) return call("lucent::promiseThen", [handler(f, value, rt.inner)], [r]);
      return call(
        "lucent::promiseThen",
        [handler(f, value, rt.inner), handler(g, [T.error], rt.inner)],
        [r],
      );
    }
    case "catch": {
      const g = given(a[0]);
      if (!g) return call("lucent::promisePass", [], [r]);
      return call("lucent::promiseCatch", [handler(g, [T.error], rt.inner)], [r]);
    }
    case "finally": {
      const f = given(a[0]);
      if (!f) return call("lucent::promiseFinally", [cpp.lambda([], [], [])], []);
      return call("lucent::promiseFinally", [handler(f, [], T.void)], []);
    }
  }
  fail(node, Codes.UnsupportedBuiltin, `promise.${name}() is not supported`);
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
    case "isWellFormed":
      return bool(cpp.call(cpp.dot(o, "isWellFormed"), []));
    case "toWellFormed":
      return str(cpp.call(cpp.dot(o, "toWellFormed"), []));
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
          (all, x) => cpp.binary(all, "+", em.toStringCode(em.expr(x), x)),
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
  // Integer elements (integers.ts) are only pushed to, indexed and measured.
  if (obj.elements && name !== "push")
    throw new Error(`internal: ${name} on an array of integer elements`);
  const o = obj.c;
  const e = obj.t.e;
  const at = obj.t;
  const a = node.arguments;
  const n = (i: number, ifUndefined: cpp.Expr) => optArg(em, node, i, T.number, ifUndefined);
  const cb = (params: LType[], ret?: LType) => callback(em, a[0], params, ret);
  const self: LType = at;
  switch (name) {
    case "push": {
      // A tuple spread is an item per element.
      if (
        a.some((x) => em.spreadsTuple(x)) &&
        a.every((x) => !ts.isSpreadElement(x) || em.spreadsTuple(x))
      )
        return num(
          cpp.call(
            cpp.dot(o, "push"),
            a.flatMap((x) =>
              (em.tupleSpread(x) ?? [{ e: em.expr(x, e), node: x }]).map((g) =>
                em.coerce(g.e, e, g.node),
              ),
            ),
          ),
        );
      if (a.length === 1 && ts.isSpreadElement(a[0]!))
        return num(
          cpp.statementExpr(
            [
              cpp.varDecl(cpp.reference(cpp.auto), "pa_", o),
              cpp.exprStmt(
                cpp.call(cpp.dot(cpp.id("pa_"), "append"), [em.exprAs(a[0]!.expression, at)]),
              ),
            ],
            cpp.call(cpp.dot(cpp.id("pa_"), "length")),
          ),
        );
      if (a.some(ts.isSpreadElement))
        fail(node, Codes.UnsupportedBuiltin, "push(...items) with other arguments");
      // Integer elements (integers.ts): each item, proved an exact integer of their kind, as one.
      const kind = obj.elements;
      return num(
        cpp.call(
          cpp.dot(o, "push"),
          a.map((x) => (kind ? em.asInteger(em.expr(x, T.number), kind, x) : em.exprAs(x, e))),
        ),
      );
    }
    case "pop":
    case "shift":
      return elementOrUndefined(cpp.call(cpp.dot(o, name), []), e);
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
    case "toSpliced": {
      const start = n(0, NAN) ?? cpp.num("0.0");
      // A skip count passed as undefined skips nothing (ToIntegerOrInfinity); none skips the rest.
      const count = n(1, NAN);
      const items = a.slice(2).map((x) => em.exprAs(x, e));
      return {
        c: cpp.call(cpp.dot(o, "toSpliced"), [start, ...(count ? [count] : []), ...items]),
        t: at,
      };
    }
    case "with":
      return {
        c: cpp.call(cpp.dot(o, "with"), [
          n(0, cpp.num("0.0")) ?? cpp.num("0.0"),
          em.exprAs(a[1]!, e),
        ]),
        t: at,
      };
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
      if (holdsJsValue(e))
        fail(node, Codes.UnsupportedOperator, jsValueOpaque(`search an array for (\`${name}\`)`));
      const found = cpp.call(cpp.dot(o, name), [...argList(em.exprAs(a[0]!, e), n(1, NAN))]);
      return name === "includes" ? bool(found) : num(found);
    }
    case "at":
      return elementOrUndefined(
        cpp.call(cpp.dot(o, "atIndex"), [n(0, cpp.num("0.0")) ?? cpp.num("0.0")]),
        e,
      );
    case "find":
    case "findLast":
      return elementOrUndefined(
        cpp.call(cpp.dot(o, name), [cb([e, T.number, self], T.boolean).c]),
        e,
      );
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
          [em.reg.cppType(rt.e, true)],
        ),
        t: rt,
      };
    }
    case "flat": {
      // The result's type is TypeScript's FlatArray for the depth given.
      const rt = em.lt(node);
      if (rt.k !== "array") fail(node, Codes.UnsupportedBuiltin, "flat");
      return {
        c: cpp.call(
          "lucent::flat",
          [o, n(0, cpp.num("1.0")) ?? cpp.num("1.0")],
          [em.reg.cppType(rt.e, true)],
        ),
        t: rt,
      };
    }
    case "copyWithin":
      return {
        c: cpp.call(cpp.dot(o, "copyWithin"), [
          n(0, cpp.num("0.0")) ?? cpp.num("0.0"),
          n(1, cpp.num("0.0")) ?? cpp.num("0.0"),
          ...argList(n(2, END)),
        ]),
        t: at,
      };
    case "flatMap": {
      const rt = em.lt(node);
      if (rt.k !== "array") fail(node, Codes.UnsupportedBuiltin, "flatMap");
      // A callback giving a value as well as arrays (`x ?? []`): the runtime flattens only the arrays.
      const gives =
        a[0] && em.checker.getTypeAtLocation(a[0]).getCallSignatures()[0]?.getReturnType();
      const mixed =
        !!gives &&
        (gives.isUnion() ? gives.types : [gives]).some((g) => !em.checker.isArrayType(g));
      return {
        c: cpp.call(
          cpp.dot(o, "flatMap", true),
          [cb([e, T.number, self], mixed ? unionOf([rt.e, rt]) : rt).c],
          [em.reg.cppType(rt.e, true)],
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
      // The initial value is lowered before the callback, which follows it in the source: making
      // a callback runs none of its code, and made last it is passed to the method as the lambda.
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
      return elementOrUndefined(cpp.call(cpp.dot(o, "get"), [em.exprAs(a[0]!, key)]), val);
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

/**
 * Whether JSON.stringify of a `t` would write a JSValue: through what it
 * writes the elements and fields of (arrays, tuples, records, objects, the
 * values of optionals and unions). A class instance's fields are checked
 * when it is written (the runtime's TypeError).
 */
function reachesJsValue(em: FnEmitter, t: LType, seen = new Set<string>()): boolean {
  switch (t.k) {
    case "jsvalue":
      return true;
    case "array":
      return reachesJsValue(em, t.e, seen);
    case "tuple":
      return t.es.some((e) => reachesJsValue(em, e, seen));
    case "union":
      return t.ms.some((m) => reachesJsValue(em, m, seen));
    case "opt":
      return reachesJsValue(em, t.inner, seen);
    case "dict":
      return reachesJsValue(em, t.val, seen);
    case "struct":
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return em.reg.struct(t.id).fields.some((f) => reachesJsValue(em, f.type, seen));
    default:
      return false;
  }
}

/** An object a FinalizationRegistry takes as a target or token: what a WeakRef could hold. */
function registryObject(em: FnEmitter, arg: ts.Expression, what: string): cpp.Expr {
  const e = em.expr(arg);
  const t = stripOpt(e.t);
  if (t.k !== "class" && t.k !== "iface" && t.k !== "struct")
    fail(
      arg,
      Codes.UnsupportedType,
      `a FinalizationRegistry's ${what} are class instances or objects, not ${typeKey(t)} values`,
    );
  return e.c;
}

/** FinalizationRegistry's methods (weak.h): `register` is `registerTarget` in C++. */
function registryMethod(
  em: FnEmitter,
  obj: E & { t: LType & { k: "registry" } },
  name: string,
  node: ts.CallExpression,
): E {
  const a = node.arguments;
  switch (name) {
    case "register": {
      const target = registryObject(em, a[0]!, "targets");
      const held = em.exprAs(a[1]!, obj.t.held);
      const token = a[2] ? [registryObject(em, a[2], "tokens")] : [];
      return {
        c: cpp.call(cpp.dot(obj.c, "registerTarget"), [target, held, ...token]),
        t: T.undefined,
      };
    }
    case "unregister":
      return bool(cpp.call(cpp.dot(obj.c, "unregister"), [registryObject(em, a[0]!, "tokens")]));
  }
  fail(node, Codes.UnsupportedBuiltin, `FinalizationRegistry.prototype.${name} is not supported`);
}

/** WeakMap's and WeakSet's methods: by key, as Map's and Set's are (weak.h). */
function weakMethod(
  em: FnEmitter,
  obj: E & { t: LType & { k: "weakMap" | "weakSet" } },
  name: string,
  node: ts.CallExpression,
): E {
  const t = obj.t;
  const o = obj.c;
  const a = node.arguments;
  const key = () => em.exprAs(a[0]!, t.key);
  switch (name) {
    case "get":
      if (t.k === "weakMap") return elementOrUndefined(cpp.call(cpp.dot(o, "get"), [key()]), t.val);
      break;
    case "set":
      if (t.k === "weakMap")
        return { c: cpp.call(cpp.dot(o, "set"), [key(), em.exprAs(a[1]!, t.val)]), t };
      break;
    case "add":
      if (t.k === "weakSet") return { c: cpp.call(cpp.dot(o, "add"), [key()]), t };
      break;
    case "has":
      return bool(cpp.call(cpp.dot(o, "has"), [key()]));
    case "delete":
      return bool(cpp.call(cpp.dot(o, "remove"), [key()]));
  }
  const owner = t.k === "weakMap" ? "WeakMap" : "WeakSet";
  fail(node, Codes.UnsupportedBuiltin, `${owner}.prototype.${name} is not supported`);
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

/**
 * A typed array's methods: Uint8Array's and the other kinds', each of
 * %TypedArray%'s methods. Elements are numbers, or bigints for the 64-bit
 * integer kinds.
 */
function typedMethod(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E {
  const o = obj.c;
  const self = stripOpt(obj.t);
  const e = typedElement(self);
  const a = node.arguments;
  const n = (i: number, ifUndefined: cpp.Expr) => optArg(em, node, i, T.number, ifUndefined);
  const cb = (params: LType[], ret?: LType) => callback(em, a[0], params, ret);
  const cls = typedClass(self);
  switch (name) {
    case "subarray":
    case "slice":
      return { c: cpp.call(cpp.dot(o, name), [...argList(n(0, NAN), n(1, END))]), t: self };
    case "fill":
      return {
        c: cpp.call(cpp.dot(o, "fill"), [argAs(em, node, 0, e), ...argList(n(1, NAN), n(2, END))]),
        t: self,
      };
    case "copyWithin":
      return {
        c: cpp.call(cpp.dot(o, "copyWithin"), [
          n(0, NAN) ?? cpp.num("0.0"),
          n(1, NAN) ?? cpp.num("0.0"),
          ...argList(n(2, END)),
        ]),
        t: self,
      };
    case "indexOf":
    case "lastIndexOf":
      return num(cpp.call(cpp.dot(o, name), [argAs(em, node, 0, e), ...argList(n(1, NAN))]));
    case "includes":
      return bool(cpp.call(cpp.dot(o, "includes"), [argAs(em, node, 0, e), ...argList(n(1, NAN))]));
    case "at":
      return elementOrUndefined(
        cpp.call(cpp.dot(o, "atIndex"), [n(0, cpp.num("0.0")) ?? cpp.num("0.0")]),
        e,
      );
    case "with":
      return {
        c: cpp.call(cpp.dot(o, "with"), [
          n(0, cpp.num("0.0")) ?? cpp.num("0.0"),
          argAs(em, node, 1, e),
        ]),
        t: self,
      };
    case "set": {
      const src = em.expr(a[0]!);
      const st = stripOpt(src.t);
      const same = isTypedArray(st) && typedElement(st).k === e.k;
      if (!same && !(st.k === "array" && st.e.k === e.k))
        fail(
          node,
          Codes.UnsupportedBuiltin,
          `set() needs a typed array or an array of ${e.k === "bigint" ? "bigints" : "numbers"}`,
        );
      return {
        c: cpp.call(cpp.dot(o, "setFrom"), [...argList(src.c, n(1, NAN))]),
        t: T.undefined,
      };
    }
    case "forEach":
      return {
        c: cpp.call(cpp.dot(o, "forEach"), [cb([e, T.number, self], T.void).c]),
        t: T.undefined,
      };
    case "map":
      return { c: cpp.call(cpp.dot(o, "map"), [cb([e, T.number, self], e).c]), t: self };
    case "filter":
      return {
        c: cpp.call(cpp.dot(o, "filter"), [truthyCallback(em, a[0], [e, T.number, self])]),
        t: self,
      };
    case "some":
    case "every":
      return bool(cpp.call(cpp.dot(o, name), [truthyCallback(em, a[0], [e, T.number, self])]));
    case "find":
    case "findLast":
      return elementOrUndefined(
        cpp.call(cpp.dot(o, name), [truthyCallback(em, a[0], [e, T.number, self])]),
        e,
      );
    case "findIndex":
    case "findLastIndex":
      return num(cpp.call(cpp.dot(o, name), [truthyCallback(em, a[0], [e, T.number, self])]));
    case "reduce":
    case "reduceRight": {
      if (a.length < 2)
        return { c: cpp.call(cpp.dot(o, name), [cb([e, e, T.number, self], e).c]), t: e };
      const rt = em.lt(node);
      // The initial value is lowered before the callback, as for arrays.
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
    case "toSorted":
      if (!a[0]) return { c: cpp.call(cpp.dot(o, name), []), t: self };
      return { c: cpp.call(cpp.dot(o, name), [cb([e, e], T.number).c]), t: self };
    case "reverse":
    case "toReversed":
      return { c: cpp.call(cpp.dot(o, name), []), t: self };
    case "join":
      return str(
        cpp.call(cpp.dot(o, "join"), [...argList(optArg(em, node, 0, T.string, stringExpr(",")))]),
      );
    case "toString":
      return str(cpp.call(cpp.dot(o, "join"), []));
    // Arrays of the contents at the call, as arrays' are (docs/semantics.md).
    case "values":
      return { c: cpp.call(cpp.dot(o, "toArray"), []), t: { k: "array", e } };
    case "keys": {
      const index = cpp.lambda([], [cpp.param(cpp.type("double"), "i")], [cpp.ret(cpp.id("i"))]);
      return {
        c: cpp.call("lucent::Array<double>::generate", [cpp.call(cpp.dot(o, "length")), index]),
        t: { k: "array", e: T.number },
      };
    }
    case "entries":
      return {
        c: cpp.call("lucent::arrayEntries", [cpp.call(cpp.dot(o, "toArray"), [])]),
        t: { k: "array", e: { k: "tuple", es: [T.number, e] } },
      };
  }
  fail(node, Codes.UnsupportedBuiltin, `${cls}.prototype.${name} is not supported`);
}

/** Each typed array's element size, in bytes. */
const TYPED_SIZES: Record<string, number> = {
  Uint8Array: 1,
  Int8Array: 1,
  Uint8ClampedArray: 1,
  Int16Array: 2,
  Uint16Array: 2,
  Int32Array: 4,
  Uint32Array: 4,
  Float32Array: 4,
  Float64Array: 8,
  BigInt64Array: 8,
  BigUint64Array: 8,
};

/** The typed array class `obj` names (`Float32Array` in `Float32Array.from`), if it is one. */
function typedGlobal(em: FnEmitter, obj: ts.Expression): string | undefined {
  return ts.isIdentifier(obj) && obj.text in TYPED_SIZES && isLibGlobal(em, obj, obj.text)
    ? obj.text
    : undefined;
}

/** A typed array's C++ type: lucent::Bytes, lucent::Float32Array… */
function typedCpp(t: LType): string {
  return t.k === "typed" ? `lucent::${t.name}` : "lucent::Bytes";
}

/** A typed array's class: Uint8Array, Float32Array… */
function typedClass(t: LType): string {
  return t.k === "typed" ? t.name : "Uint8Array";
}

/** A DataView's getters and setters, each in either byte order. */
function dataViewMethod(em: FnEmitter, o: cpp.Expr, name: string, node: ts.CallExpression): E {
  const match =
    /^(get|set)(Int8|Uint8|Int16|Uint16|Int32|Uint32|Float32|Float64|BigInt64|BigUint64)$/.exec(
      name,
    );
  if (!match) fail(node, Codes.UnsupportedBuiltin, `DataView.prototype.${name} is not supported`);
  const [, how, kind] = match;
  const value = kind!.startsWith("Big") ? T.bigint : T.number;
  const single = kind === "Int8" || kind === "Uint8";
  const at = argAs(em, node, 0, T.number);
  const little = (i: number) =>
    single || !node.arguments[i]
      ? []
      : [cpp.call("lucent::truthy", [em.expr(node.arguments[i]!).c])];
  if (how === "get") {
    const c = cpp.call(cpp.dot(o, name), [at, ...little(1)]);
    return value.k === "bigint" ? big(c) : num(c);
  }
  return {
    c: cpp.call(cpp.dot(o, name), [at, argAs(em, node, 1, value), ...little(2)]),
    t: T.undefined,
  };
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
    // Timers run on the calling context (timers.h).
    case "setTimeout":
    case "setInterval": {
      const handler = em.exprAs(a[0]!, { k: "fn", params: [], ret: T.void });
      const ms = optArg(em, node, 1, T.number, cpp.num("0.0")) ?? cpp.num("0.0");
      return num(cpp.call("lucent::setTimer", [handler, ms, cpp.bool(name === "setInterval")]));
    }
    case "clearTimeout":
    case "clearInterval":
      return {
        c: cpp.call("lucent::clearTimer", [
          a[0] ? em.exprAs(a[0], unionOf([T.number, T.undefined])) : cpp.id("lucent::undefined"),
        ]),
        t: T.undefined,
      };
    case "queueMicrotask":
      return {
        c: cpp.call("lucent::queueMicrotask", [
          em.exprAs(a[0]!, { k: "fn", params: [], ret: T.void }),
        ]),
        t: T.undefined,
      };
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
      return str(a[0] ? em.toStringCode(em.expr(a[0]), a[0]) : stringExpr(""));
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

/** The kind each library constructor makes (the errors are added by name). */
const LIB_CONSTRUCTORS: Record<string, LType["k"]> = {
  AbortController: "abortController",
  WeakRef: "weak",
  WeakMap: "weakMap",
  WeakSet: "weakSet",
  FinalizationRegistry: "registry",
  RegExp: "regexp",
  Date: "date",
  Map: "map",
  Set: "set",
  Array: "array",
  Uint8Array: "bytes",
  ...Object.fromEntries(TYPED_NAMES.map((name) => [name, "typed"])),
  DataView: "dataView",
  ArrayBuffer: "arrayBuffer",
  Promise: "promise",
};

/**
 * Refuses a library constructor that does not make the kind its result is
 * typed as: `new Proxy(target, handler)` is typed as its target, and would
 * otherwise make a fresh value of the target's kind.
 */
export function requireConstructor(em: FnEmitter, node: ts.NewExpression, t: LType): void {
  const callee = node.expression;
  if (!ts.isIdentifier(callee) || !isLibGlobal(em, callee, callee.text)) return;

  const name = callee.text;
  const makes = isErrorName(name) ? "error" : LIB_CONSTRUCTORS[name];
  if (makes !== t.k) fail(node, Codes.UnsupportedBuiltin, `new ${name}() is not supported`);
}

/**
 * `new X(…)` for a typed array: empty; of a length; a view of an
 * ArrayBuffer (at an offset, of a length); or a copy of an array's values or
 * another typed array's, converted.
 */
function newTyped(em: FnEmitter, node: ts.NewExpression, t: LType): E {
  const a = node.arguments ?? ts.factory.createNodeArray();
  const cls = typedCpp(t);
  const e = typedElement(t);
  if (!a[0]) return { c: cpp.construct(cpp.type(cls)), t };
  const v = em.expr(a[0]);
  const vt = stripOpt(v.t);
  if (vt.k === "arrayBuffer") {
    const index = (x: ts.Expression | undefined) =>
      x ? em.exprAs(x, unionOf([T.number, T.undefined])) : cpp.id("lucent::undefined");
    return { c: cpp.call(`${cls}::over`, [em.coerce(v, vt, a[0]), index(a[1]), index(a[2])]), t };
  }
  if (vt.k === "number") return { c: cpp.call(cls, [v.c]), t };
  if (vt.k === "array" && vt.e.k === e.k)
    return { c: cpp.call(`${cls}::fromArray`, [em.coerce(v, { k: "array", e }, a[0])]), t };
  if (isTypedArray(vt) && typedElement(vt).k === e.k)
    return sameType(vt, t)
      ? { c: cpp.call(cpp.dot(v.c, "slice"), []), t }
      : { c: cpp.call(`${cls}::fromTyped`, [v.c]), t };
  fail(node, Codes.UnsupportedBuiltin, `new ${typedClass(t)}(${typeKey(v.t)})`);
}

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
    case "emitter":
      return emitterNew(em, node, t);
    case "channel":
      return channelNew(em, node, t);
    case "weak": {
      if (a.length !== 1) fail(node, Codes.UnsupportedBuiltin, "new WeakRef() takes its target");
      return {
        c: cpp.call(
          "std::make_shared",
          [em.exprAs(a[0]!, t.inner)],
          [cpp.type("lucent::WeakRefObject", em.reg.cppType(t.inner, true))],
        ),
        t,
      };
    }
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
    case "registry": {
      if (a.length !== 1)
        fail(node, Codes.UnsupportedBuiltin, "new FinalizationRegistry() takes its cleanup");
      const cleanup: LType = { k: "fn", params: [t.held], ret: T.void };
      return { c: cpp.construct(em.reg.cppType(t), [em.exprAs(a[0]!, cleanup)]), t };
    }
    case "weakMap":
    case "weakSet":
      if (a.length)
        fail(
          node,
          Codes.UnsupportedBuiltin,
          `new ${name}() takes no entries here: make it empty, then ${t.k === "weakMap" ? "set" : "add"} them`,
        );
      return { c: cpp.construct(em.reg.cppType(t), []), t };
    case "map": {
      if (!a[0]) return { c: cpp.construct(em.reg.cppType(t), []), t };
      const entries = em.exprAs(a[0], { k: "array", e: { k: "tuple", es: [t.key, t.val] } });
      return {
        c: cpp.call(
          "lucent::mapFromEntries",
          [entries],
          [em.reg.cppType(t.key, true), em.reg.cppType(t.val, true)],
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
              cpp.construct(em.reg.cppType(t.e, true), [], true),
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
    case "arrayBuffer":
      // ES2024's options make a resizable buffer, which Lucent's are not.
      if (a[1])
        fail(
          a[1],
          Codes.UnsupportedBuiltin,
          "new ArrayBuffer(length, options) makes a resizable buffer, which Lucent does not support",
          "make a buffer of the size you need, and copy into a larger one with `new Uint8Array(larger).set(...)`",
        );
      return {
        c: a[0]
          ? cpp.call("lucent::ArrayBuffer", [em.exprAs(a[0], T.number)])
          : cpp.construct(cpp.type("lucent::ArrayBuffer")),
        t,
      };
    case "bytes":
    case "typed":
      return newTyped(em, node, t);
    case "dataView": {
      const buffer = a[0] && em.expr(a[0]);
      if (!buffer || stripOpt(buffer.t).k !== "arrayBuffer")
        fail(node, Codes.UnsupportedBuiltin, "new DataView() takes an ArrayBuffer");
      const index = (x: ts.Expression | undefined) =>
        x ? em.exprAs(x, unionOf([T.number, T.undefined])) : cpp.id("lucent::undefined");
      return {
        c: cpp.call("lucent::DataView::over", [
          em.coerce(buffer, T.arrayBuffer, a[0]!),
          index(a[1]),
          index(a[2]),
        ]),
        t,
      };
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
      const made = withSite(
        cpp.call("lucent::makeError", [stringExpr(name), errorMessage(em, a[0])]),
        node,
      );
      const cause = causeOf(em, a[1]);
      return { c: cause ? cpp.call("lucent::withCause", [made, cause]) : made, t };
    }
  }
  fail(node, Codes.UnsupportedBuiltin, `new ${name || callee.getText()}() is not supported`);
}

/**
 * JSON.stringify's replacer, as the property list the runtime takes: an
 * array of keys, or none (undefined, null). A function replacer sees each
 * value as `any`, which has no native form.
 */
function jsonKeys(em: FnEmitter, replacer: ts.Expression): cpp.Expr {
  const fnReplacer = em.checker.getTypeAtLocation(replacer).getCallSignatures().length > 0;
  if (fnReplacer)
    fail(
      replacer,
      Codes.UnsupportedBuiltin,
      "JSON.stringify's replacer function sees each value as `any`, which has no native form: pick the keys with an array, or build the value to write first",
    );

  const r = em.expr(replacer);
  const t = stripOpt(r.t);
  // Strings and numbers, which name keys as their strings do.
  const named = (e: LType): boolean =>
    e.k === "string" || e.k === "number" || (e.k === "union" && e.ms.every(named));
  const keys = t.k === "array" && named(t.e);
  const none = t.k === "undefined" || t.k === "null";

  if (!keys && !none)
    fail(
      replacer,
      Codes.UnsupportedBuiltin,
      `JSON.stringify's replacer is an array of keys (strings and numbers), not ${typeKey(r.t)}`,
    );
  return cpp.call("lucent::json::keysOf", [r.c]);
}

/** JSON.stringify's space, as the gap the runtime indents with. */
function jsonGap(em: FnEmitter, space: ts.Expression): cpp.Expr {
  const s = em.expr(space);
  const t = stripOpt(s.t);

  if (t.k !== "number" && t.k !== "string" && t.k !== "undefined" && t.k !== "null")
    fail(
      space,
      Codes.UnsupportedBuiltin,
      `JSON.stringify's space is a number or a string, not ${typeKey(s.t)}`,
    );
  return cpp.call("lucent::json::gapOf", [s.c]);
}

/** An error's message: undefined is the message left out, "". */
function errorMessage(em: FnEmitter, message: ts.Expression | undefined): cpp.Expr {
  return message ? orUndefined(em, message, T.string, stringExpr("")) : stringExpr("");
}

/**
 * The cause an Error constructor's options give (`{ cause: e }`), as a
 * `lucent::Error`, empty when undefined; undefined when there are no
 * options, or they name no cause. A cause is an Error, as what a `catch`
 * binds is: another value is refused.
 */
export function causeOf(em: FnEmitter, options: ts.Expression | undefined): cpp.Expr | undefined {
  if (!options || (ts.isIdentifier(options) && isVoidish(em.lt(options)))) return undefined;

  if (!ts.isObjectLiteralExpression(options))
    fail(
      options,
      Codes.UnsupportedBuiltin,
      "an Error's options are written in the call: new Error(message, { cause })",
    );

  let cause: ts.Expression | undefined;
  for (const p of options.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === "cause"
    )
      cause = p.initializer;
    else if (ts.isShorthandPropertyAssignment(p) && p.name.text === "cause") cause = p.name;
    else fail(p, Codes.UnsupportedBuiltin, "an Error's options carry its cause, and nothing else");
  }
  if (!cause) return undefined;

  const v = em.expr(cause);
  const t = stripOpt(v.t);
  const isError = t.k === "error" || (t.k === "class" && em.reg.cls(t.id).isError);

  if (!isError)
    fail(
      cause,
      Codes.UnsupportedBuiltin,
      `an Error's cause is an Error, not ${em.checker.typeToString(em.checker.getTypeAtLocation(cause))}: put what it says in the message, or keep it in a field of an Error class`,
    );

  return v.t.k === "opt"
    ? cpp.call("lucent::causeOrNone", [em.coerce(v, unionOf([T.error, T.undefined]), cause)])
    : em.coerce(v, T.error, cause);
}

// --- instanceof / super ----------------------------------------------------------------------

/**
 * The runtime trait that recognizes each built-in kind `instanceof`,
 * Array.isArray and ArrayBuffer.isView (a "View": any typed array or
 * DataView) test.
 */
const KIND_TRAITS = {
  Array: "lucent::IsJsArray",
  Map: "lucent::IsMap",
  Set: "lucent::IsSet",
  Uint8Array: "lucent::IsBytes",
  ...(Object.fromEntries(TYPED_NAMES.map((n) => [n, `lucent::Is${n}`])) as Record<
    (typeof TYPED_NAMES)[number],
    string
  >),
  DataView: "lucent::IsDataView",
  View: "lucent::IsView",
  ArrayBuffer: "lucent::IsArrayBuffer",
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
      `testing whether an Iterable is ${kind === "Array" ? "an" : "a"} ${kind} is not supported: an Iterable no longer knows what it was made from; take a ${kind === "Array" ? "T[]" : kind} parameter`,
    );
  return bool(cpp.call("lucent::holds", [v.c], [cpp.type(KIND_TRAITS[kind])]));
}

/** What `in` refuses, for its diagnostic: a union is told apart by a discriminant instead. */
const NOT_IN: Partial<Record<LType["k"], string>> = {
  class: "a class instance",
  array: "an array",
  tuple: "an array",
  map: "a Map",
  set: "a Set",
};

/**
 * `key in o` on a record. Keys every object inherits (`toString`,
 * `constructor`…) are in, as in JavaScript. The key is evaluated before
 * the object. Object types refuse it: they do not record which optional
 * fields are set.
 */
export function keyIn(em: FnEmitter, node: ts.BinaryExpression): E {
  const k = em.ctx.fresh("key");
  const key = cpp.varDecl(cpp.type("lucent::String"), k, em.exprAs(node.left, T.string));
  const obj = em.expr(node.right);
  const t = stripOpt(obj.t);
  if (t.k === "dict")
    return bool(cpp.statementExpr([key], cpp.call("lucent::keyIn", [cpp.id(k), obj.c])));

  if (t.k === "union")
    fail(
      node,
      Codes.UnsupportedOperator,
      "`in` works on records; tell union members apart by a discriminant field such as `kind`",
      "compare a discriminant field such as `kind`",
    );

  if (t.k === "struct")
    fail(
      node,
      Codes.UnsupportedOperator,
      "`in` on an object type is not supported: Lucent objects do not record which optional fields are set; compare the field with undefined, or use a Record<string, T>",
    );

  fail(
    node,
    Codes.UnsupportedOperator,
    `\`in\` works on records, not on ${NOT_IN[t.k] ?? "this type"}`,
    "use a Map or a Record for keys that come and go",
  );
}

export function instanceOf(em: FnEmitter, node: ts.BinaryExpression): E {
  const sdk = nativeInstanceOf(em, node);
  if (sdk) return sdk;

  const v = em.expr(node.left);
  const right = node.right;
  if (ts.isIdentifier(right)) {
    if (
      (isErrorName(right.text) || right.text === "AggregateError") &&
      isLibGlobal(em, right, right.text)
    ) {
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

/** Whether `call` (a super(…) call) passes its constructor's parameters, unchanged and in order. */
function passesParameters(call: ts.CallExpression): boolean {
  let ctor: ts.Node | undefined = call.parent;
  while (ctor && !ts.isConstructorDeclaration(ctor)) ctor = ctor.parent;
  if (!ctor || !ts.isConstructorDeclaration(ctor)) return false;
  const params = ctor.parameters;
  return (
    call.arguments.length === params.length &&
    call.arguments.every(
      (a, i) =>
        ts.isIdentifier(a) && ts.isIdentifier(params[i]!.name) && a.text === params[i]!.name.text,
    )
  );
}

export function superCall(em: FnEmitter, node: ts.CallExpression): E {
  const cls = em.opts.cls;
  if (cls?.base)
    fail(node, Codes.UnsupportedClassFeature, "call `super(...)` as a statement of its own");
  // An iOS base: the native object that stands for the instance, made now.
  if (cls?.sdkBase?.platform === "ios") return subclassSuperCall(em, node, cls);
  // An Android base: its Java object is made where the instance goes to Java, or, for a class
  // the OS makes, by the OS, whose constructor passes the base its arguments (decision 0097).
  if (cls?.sdkBase) {
    if (node.arguments.length && !(osMade(cls) && passesParameters(node)))
      fail(
        node,
        Codes.UnsupportedClassFeature,
        osMade(cls)
          ? `${cls.decl.name?.text}: the OS makes it, so super(…) passes the constructor's parameters, unchanged and in order`
          : `extending ${cls.sdkBase.name}: call super() without arguments`,
      );
    return { c: cpp.id("lucent::undefined"), t: T.undefined };
  }
  if (!cls || !cls.isError)
    fail(node, Codes.UnsupportedClassFeature, "`super(...)` is only supported in subclasses");
  const msg = errorMessage(em, node.arguments[0]);
  const cause = causeOf(em, node.arguments[1]);
  const set = cpp.assign(cpp.arrow(cpp.self, "message"), msg);
  return {
    c: cpp.comma(
      cause ? cpp.comma(set, cpp.assign(cpp.arrow(cpp.self, "cause"), cause)) : set,
      cpp.id("lucent::undefined"),
    ),
    t: T.undefined,
  };
}
