import path from "node:path";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { coreTypesPath } from "../program.ts";
import { cppIdent, isVoidish, type LType, stripOpt, T, typeKey, unionOf } from "../types.ts";
import type { E } from "./context.ts";
import { type FnEmitter, substitute } from "./function.ts";
import { numberLiteral, stringLiteral } from "./literals.ts";

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

function argAs(em: FnEmitter, node: ts.CallExpression, i: number, t: LType): string {
  const a = node.arguments[i];
  if (!a) fail(node, Codes.UnsupportedCall, `missing argument ${i + 1}`);
  return em.exprAs(a, t);
}

function optArg(em: FnEmitter, node: ts.CallExpression, i: number, t: LType): string | undefined {
  const a = node.arguments[i];
  return a ? em.exprAs(a, t) : undefined;
}

function args(...xs: (string | undefined)[]): string {
  const out: string[] = [];
  for (const x of xs) {
    if (x === undefined) break;
    out.push(x);
  }
  return out.join(", ");
}

const num = (c: string): E => ({ c, t: T.number });
const bool = (c: string): E => ({ c, t: T.boolean });
const str = (c: string): E => ({ c, t: T.string });

// --- properties -----------------------------------------------------------------------

export function property(em: FnEmitter, obj: E, name: string, node: ts.Node): E {
  const t = obj.t;
  const o = obj.c;
  switch (t.k) {
    case "string":
      if (name === "length") return num(`static_cast<double>((${o}).length())`);
      break;
    case "array":
      if (name === "length") return num(`(${o}).length()`);
      break;
    case "tuple":
      if (name === "length") return num(numberLiteral(t.es.length));
      break;
    case "map":
    case "set":
      if (name === "size") return num(`(${o}).size()`);
      break;
    case "bytes":
      if (name === "length" || name === "byteLength") return num(`(${o}).length()`);
      break;
    case "error":
      if (name === "message") return str(`(${o})->message`);
      if (name === "name") return str(`(${o})->name`);
      if (name === "stack") return { c: `(${o})->stack`, t: unionOf([T.string, T.undefined]) };
      break;
  }
  fail(node, Codes.UnsupportedBuiltin, `.${name} is not supported on ${typeKey(t)}`);
}

// --- classes ---------------------------------------------------------------------------

function classMemberDecl(em: FnEmitter, t: LType & { k: "class" }, name: string): ts.ClassElement | ts.ParameterDeclaration | undefined {
  const info = em.reg.cls(t.id);
  for (const m of info.decl.members) {
    if (m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name) || ts.isStringLiteral(m.name)) && m.name.text === name) return m;
  }
  const ctor = info.decl.members.find(ts.isConstructorDeclaration);
  for (const p of ctor?.parameters ?? []) {
    if (ts.isIdentifier(p.name) && p.name.text === name && ts.getModifiers(p)?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.PublicKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword || m.kind === ts.SyntaxKind.ReadonlyKeyword)) {
      return p;
    }
  }
  return undefined;
}

function isStatic(m: ts.Node): boolean {
  return ts.canHaveModifiers(m) && !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword);
}

/** Declared (storage) type of a class member, instantiated for `t`'s type arguments. */
export function memberType(em: FnEmitter, t: LType & { k: "class" }, decl: ts.Node): LType {
  const info = em.reg.cls(t.id);
  const declared = em.reg.lower(em.checker.getTypeAtLocation(decl), decl);
  if (!t.args.length) return declared;
  return substitute(declared, new Map(info.typeParams.map((p, i) => [p, t.args[i]!])));
}

export function classMember(em: FnEmitter, obj: E, t: LType & { k: "class" }, name: string, node: ts.Node): E {
  const info = em.reg.cls(t.id);
  if (info.isError && (name === "message" || name === "name")) return str(`(${obj.c})->${name}`);
  const decl = classMemberDecl(em, t, name);
  if (!decl) fail(node, Codes.UnsupportedClassFeature, `unknown member ${name}`);
  if (ts.isGetAccessorDeclaration(decl)) {
    const type = memberType(em, t, decl);
    return { c: `(${obj.c})->get_${cppIdent(name)}()`, t: type };
  }
  if (ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) {
    return { c: `(${obj.c})->${cppIdent(name)}`, t: memberType(em, t, decl) };
  }
  if (ts.isMethodDeclaration(decl)) {
    // A bound method used as a value.
    const ft = em.lt(node);
    if (ft.k !== "fn") fail(node, Codes.UnsupportedClassFeature, "unsupported method reference");
    const r = em.ctx.fresh("recv");
    const ps = ft.params.map((p, i) => `${em.cpp(p)} a${i}`).join(", ");
    const as = ft.params.map((_, i) => `a${i}`).join(", ");
    return { c: `${em.cpp(ft)}([${r} = ${obj.c === "this" ? "lucent::selfRef(this)" : obj.c}](${ps}) { return ${r}->${cppIdent(name)}(${as}); })`, t: ft };
  }
  fail(node, Codes.UnsupportedClassFeature, `unsupported member ${name}`);
}

export function classMemberLvalue(em: FnEmitter, obj: E, t: LType & { k: "class" }, name: string, node: ts.Node) {
  const info = em.reg.cls(t.id);
  if (info.isError && (name === "message" || name === "name")) {
    const c = `(${obj.c})->${name}`;
    return { direct: c, get: c, type: T.string };
  }
  const decl = classMemberDecl(em, t, name);
  if (!decl) fail(node, Codes.UnsupportedClassFeature, `unknown member ${name}`);
  if (ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) {
    const c = `(${obj.c})->${cppIdent(name)}`;
    return { direct: c, get: c, type: memberType(em, t, decl) };
  }
  if (ts.isGetAccessorDeclaration(decl) || ts.isSetAccessorDeclaration(decl)) {
    const type = memberType(em, t, decl);
    const recv = em.ctx.fresh("recv");
    void recv;
    return { get: `(${obj.c})->get_${cppIdent(name)}()`, set: (v: string) => `((${obj.c})->set_${cppIdent(name)}(${v}), ${v})`, type };
  }
  fail(node, Codes.UnsupportedAssignmentTarget, `cannot assign to method ${name}`);
}

function staticClass(em: FnEmitter, id: ts.Expression) {
  if (!ts.isIdentifier(id)) return undefined;
  const sym0 = em.checker.getSymbolAtLocation(id);
  if (!sym0) return undefined;
  const g = em.ctx.globals.get(em.ctx.resolve(sym0));
  return g && g.kind === "class" ? g : undefined;
}

export function staticMemberLvalue(em: FnEmitter, target: ts.PropertyAccessExpression) {
  const g = staticClass(em, target.expression);
  if (!g) return undefined;
  const name = target.name.text;
  const decl = g.info.decl.members.find((m) => m.name && ts.isIdentifier(m.name) && m.name.text === name && isStatic(m));
  if (!decl || !ts.isPropertyDeclaration(decl)) fail(target, Codes.UnsupportedAssignmentTarget, `unknown static field ${name}`);
  const c = `lucent_app::${g.info.cppName}::${cppIdent(name)}`;
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
const NUMBER_CONSTANTS: Record<string, string> = {
  MAX_SAFE_INTEGER: "9007199254740991.0",
  MIN_SAFE_INTEGER: "(-9007199254740991.0)",
  EPSILON: "2.220446049250313e-16",
  MAX_VALUE: "1.7976931348623157e+308",
  MIN_VALUE: "5e-324",
  POSITIVE_INFINITY: "lucent::kInfinity",
  NEGATIVE_INFINITY: "(-lucent::kInfinity)",
  NaN: "lucent::kNaN",
};

function isLibGlobal(em: FnEmitter, id: ts.Expression, name: string): boolean {
  if (!ts.isIdentifier(id) || id.text !== name) return false;
  const sym = em.checker.getSymbolAtLocation(id);
  const decl = sym?.declarations?.[0];
  return !!decl && decl.getSourceFile().isDeclarationFile && /[\\/]typescript[\\/]lib[\\/]/.test(decl.getSourceFile().fileName);
}

export function staticProperty(em: FnEmitter, node: ts.PropertyAccessExpression): E | undefined {
  const obj = node.expression;
  const name = node.name.text;
  if (isLibGlobal(em, obj, "Math")) {
    if (name in MATH_CONSTANTS) return num(numberLiteral(MATH_CONSTANTS[name]!));
    return undefined;
  }
  if (isLibGlobal(em, obj, "Number") && name in NUMBER_CONSTANTS) return num(NUMBER_CONSTANTS[name]!);
  // Enum members are constants.
  const memberSym = em.checker.getSymbolAtLocation(node);
  const memberDecl = memberSym && memberSym.flags & ts.SymbolFlags.EnumMember ? memberSym.valueDeclaration : undefined;
  const constant = memberDecl && ts.isEnumMember(memberDecl) ? em.checker.getConstantValue(memberDecl) : em.checker.getConstantValue(node);
  if (constant !== undefined) return typeof constant === "number" ? num(numberLiteral(constant)) : str(stringLiteral(constant));
  const g = staticClass(em, obj);
  if (g) {
    const decl = g.info.decl.members.find((m) => m.name && ts.isIdentifier(m.name) && m.name.text === name && isStatic(m));
    if (!decl) fail(node, Codes.UnsupportedClassFeature, `unknown static member ${name}`);
    if (ts.isPropertyDeclaration(decl)) return { c: `lucent_app::${g.info.cppName}::${cppIdent(name)}`, t: em.reg.lower(em.checker.getTypeAtLocation(decl), decl) };
    if (ts.isGetAccessorDeclaration(decl)) return { c: `lucent_app::${g.info.cppName}::get_${cppIdent(name)}()`, t: em.reg.lower(em.checker.getTypeAtLocation(decl), decl) };
    fail(node, Codes.UnsupportedClassFeature, `static methods cannot be used as values`);
  }
  return undefined;
}

// --- static calls ----------------------------------------------------------------------

const MATH_FUNCTIONS = new Set([
  "abs", "floor", "ceil", "trunc", "round", "sign", "sqrt", "cbrt", "exp", "expm1", "log", "log2", "log10", "log1p",
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "pow",
  "fround", "imul", "clz32", "hypot", "random", "min", "max",
]);

export function staticCall(em: FnEmitter, node: ts.CallExpression, callee: ts.PropertyAccessExpression): E | undefined {
  const obj = callee.expression;
  const name = callee.name.text;
  const a = node.arguments;
  if (isLibGlobal(em, obj, "Math")) {
    if (!MATH_FUNCTIONS.has(name)) fail(node, Codes.UnsupportedBuiltin, `Math.${name} is not supported`);
    if ((name === "min" || name === "max") && a.length === 1 && ts.isSpreadElement(a[0]!)) {
      return num(`lucent::math::${name}Of(${em.exprAs(a[0]!.expression, { k: "array", e: T.number })})`);
    }
    if (a.some(ts.isSpreadElement)) fail(node, Codes.UnsupportedBuiltin, `spread is only supported as Math.${name}(...array)`);
    return num(`lucent::math::${name}(${a.map((x) => em.exprAs(x, T.number)).join(", ")})`);
  }
  if (isLibGlobal(em, obj, "Number")) {
    switch (name) {
      case "isInteger":
      case "isSafeInteger":
      case "isFinite":
      case "isNaN": {
        const v = em.expr(a[0]!);
        if (stripOpt(v.t).k !== "number" || v.t.k === "opt") return bool("false");
        const f = { isInteger: "lucent::isInteger", isSafeInteger: "lucent::isSafeInteger", isFinite: "std::isfinite", isNaN: "std::isnan" }[name];
        return bool(`${f}(${v.c})`);
      }
      case "parseFloat":
        return num(`lucent::parseFloat(${argAs(em, node, 0, T.string)})`);
      case "parseInt":
        return num(`lucent::parseInt(${args(argAs(em, node, 0, T.string), optArg(em, node, 1, T.number))})`);
    }
    fail(node, Codes.UnsupportedBuiltin, `Number.${name} is not supported`);
  }
  if (isLibGlobal(em, obj, "Object")) {
    const v = em.expr(a[0]!);
    const t = stripOpt(v.t);
    if (t.k === "dict") {
      if (name === "keys") return { c: `(${v.c}).keys()`, t: { k: "array", e: T.string } };
      if (name === "values") return { c: `(${v.c}).values()`, t: { k: "array", e: t.val } };
      if (name === "entries") return { c: `lucent::dictEntries(${v.c})`, t: { k: "array", e: { k: "tuple", es: [T.string, t.val] } } };
    }
    if (t.k === "struct" && name === "keys") {
      const fields = em.reg.struct(t.id).fields.map((f) => stringLiteral(f.name));
      return { c: `lucent::Array<lucent::String>{${fields.join(", ")}}`, t: { k: "array", e: T.string } };
    }
    if (name === "fromEntries") {
      const rt = em.lt(node);
      if (rt.k !== "dict") fail(node, Codes.UnsupportedBuiltin, "Object.fromEntries must produce a record");
      return { c: `lucent::dictFromEntries<${em.cpp(rt.val)}>(${em.exprAs(a[0]!, { k: "array", e: { k: "tuple", es: [T.string, rt.val] } })})`, t: rt };
    }
    fail(node, Codes.UnsupportedBuiltin, `Object.${name} is not supported on ${typeKey(v.t)}`);
  }
  if (isLibGlobal(em, obj, "Array")) {
    const rt = em.lt(node);
    if (name === "isArray") {
      const v = em.expr(a[0]!);
      return bool(stripOpt(v.t).k === "array" ? (v.t.k === "opt" ? `(${v.c}).has()` : "true") : "false");
    }
    if (name === "of") {
      if (rt.k !== "array") fail(node, Codes.UnsupportedBuiltin, "Array.of");
      return { c: `${em.cpp(rt)}{${a.map((x) => em.exprAs(x, rt.e)).join(", ")}}`, t: rt };
    }
    if (name === "from") {
      if (rt.k !== "array") fail(node, Codes.UnsupportedBuiltin, "Array.from must produce an array");
      const src = a[0]!;
      // Array.from({ length: n }, (_, i) => ...)
      if (ts.isObjectLiteralExpression(src)) {
        const lenProp = src.properties.find((p) => p.name && p.name.getText() === "length");
        if (!lenProp || !ts.isPropertyAssignment(lenProp)) fail(src, Codes.UnsupportedBuiltin, "Array.from needs an iterable or { length: n }");
        const n = em.exprAs(lenProp.initializer, T.number);
        if (!a[1]) return { c: `${em.cpp(rt)}::filled(static_cast<size_t>(${n}), ${em.cpp(rt.e)}{})`, t: rt };
        const cb = callback(em, a[1], [T.undefined, T.number], rt.e);
        const cbv = em.ctx.fresh("cb");
        return { c: `({ auto ${cbv} = ${cb.c}; ${em.cpp(rt)}::generate(${n}, [&](double i) { return ${cbv}(lucent::undefined, i); }); })`, t: rt };
      }
      const s = em.expr(src);
      const st = stripOpt(s.t);
      let base: E;
      if (st.k === "array") base = { c: `(${s.c}).slice()`, t: st };
      else if (st.k === "string") base = { c: `lucent::splitCodePoints(${s.c})`, t: { k: "array", e: T.string } };
      else if (st.k === "set") base = { c: `(${s.c}).values()`, t: { k: "array", e: st.e } };
      else if (st.k === "map") base = { c: `lucent::mapEntries(${s.c})`, t: { k: "array", e: { k: "tuple", es: [st.key, st.val] } } };
      else if (st.k === "bytes") base = { c: `(${s.c}).toArray()`, t: { k: "array", e: T.number } };
      else fail(src, Codes.UnsupportedBuiltin, `Array.from over ${typeKey(s.t)}`);
      if (!a[1]) return { c: em.coerce(base, rt, node), t: rt };
      const be = (base.t as LType & { k: "array" }).e;
      const cb = callback(em, a[1], [be, T.number], rt.e);
      return { c: `(${base.c}).map<${em.cpp(rt.e)}>(${cb.c})`, t: rt };
    }
    fail(node, Codes.UnsupportedBuiltin, `Array.${name} is not supported`);
  }
  if (isLibGlobal(em, obj, "String")) {
    if (name === "fromCharCode") return str(`lucent::stringFromCharCodes({${a.map((x) => em.exprAs(x, T.number)).join(", ")}})`);
    if (name === "fromCodePoint") return str(`lucent::stringFromCodePoints({${a.map((x) => em.exprAs(x, T.number)).join(", ")}})`);
    fail(node, Codes.UnsupportedBuiltin, `String.${name} is not supported`);
  }
  if (isLibGlobal(em, obj, "console")) {
    const level = name === "warn" ? "Warn" : name === "error" ? "Error" : "Log";
    if (!["log", "info", "debug", "warn", "error"].includes(name)) fail(node, Codes.UnsupportedBuiltin, `console.${name} is not supported`);
    const parts = a.map((x) => em.toStringCode(em.expr(x)));
    const joined = parts.length === 0 ? "lucent::String()" : parts.map((p) => `lucent::String(${p})`).join(' + LUCENT_STR(" ") + ');
    return { c: `lucent::consoleWrite(lucent::ConsoleLevel::${level}, ${joined})`, t: T.undefined };
  }
  if (isLibGlobal(em, obj, "Date") && name === "now") return num("lucent::dateNow()");
  if (isLibGlobal(em, obj, "JSON")) {
    if (name === "stringify") {
      const v = em.expr(a[0]!);
      if (a.length > 1) fail(node, Codes.UnsupportedBuiltin, "JSON.stringify replacer/indent arguments are not supported");
      return str(`lucent::json::stringify(${v.c})`);
    }
    fail(node, Codes.UnsupportedBuiltin, `JSON.${name} is not supported (Lucent values are typed; parse with explicit code)`);
  }
  if (isLibGlobal(em, obj, "Promise")) {
    const rt = em.lt(node);
    if (rt.k !== "promise") fail(node, Codes.UnsupportedBuiltin, `Promise.${name}`);
    if (name === "resolve") {
      if (!a[0]) return { c: `lucent::Promise<void>::resolved()`, t: rt };
      return { c: `lucent::resolvedPromise<${em.reg.cppRet(rt.inner)}>(${em.exprAs(a[0], rt.inner)})`, t: rt };
    }
    if (name === "reject") return { c: `lucent::Promise<${em.reg.cppRet(rt.inner)}>::rejected(${em.exprAs(a[0]!, T.error)})`, t: rt };
    if (name === "all") {
      const src = em.expr(a[0]!, em.lt(a[0]!));
      const st = stripOpt(src.t);
      if (st.k === "array" && st.e.k === "promise") {
        if (isVoidish(st.e.inner)) return { c: `lucent::promiseAllVoid(${src.c})`, t: { k: "promise", inner: T.void } };
        return { c: `lucent::promiseAll(${src.c})`, t: { k: "promise", inner: { k: "array", e: st.e.inner } } };
      }
      if (st.k === "tuple" && st.es.every((e) => e.k === "promise")) {
        const inners = st.es.map((e) => {
          const inner = (e as LType & { k: "promise" }).inner;
          return isVoidish(inner) ? T.undefined : inner;
        });
        return { c: `lucent::promiseAllTuple(${src.c})`, t: { k: "promise", inner: { k: "tuple", es: inners } } };
      }
      fail(node, Codes.UnsupportedBuiltin, "Promise.all needs an array of promises of one type");
    }
    fail(node, Codes.UnsupportedBuiltin, `Promise.${name} is not supported`);
  }
  const g = staticClass(em, obj);
  if (g) {
    const decl = g.info.decl.members.find((m) => m.name && ts.isIdentifier(m.name) && m.name.text === name && isStatic(m));
    if (!decl || !ts.isMethodDeclaration(decl)) fail(node, Codes.UnsupportedClassFeature, `unknown static method ${name}`);
    return callMethodDecl(em, `lucent_app::${g.info.cppName}::${cppIdent(name)}`, decl, node, undefined);
  }
  return undefined;
}

/** Calls a class method declaration with arguments coerced to its parameters. */
function callMethodDecl(em: FnEmitter, target: string, decl: ts.MethodDeclaration, node: ts.CallExpression, classT: (LType & { k: "class" }) | undefined): E {
  const sig = em.checker.getSignatureFromDeclaration(decl)!;
  let ft = em.reg.lowerSignature(sig, decl) as FnT;
  if (classT?.args.length) {
    const info = em.reg.cls(classT.id);
    ft = substitute(ft, new Map(info.typeParams.map((p, i) => [p, classT.args[i]!]))) as FnT;
  }
  const isAsync = !!ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  const params = em.paramInfos(decl, ft);
  const rest = params.length && params[params.length - 1]!.rest ? params[params.length - 1]!.cppType : undefined;
  const as = em.args(node.arguments, params.map((p) => p.cppType), node, rest);
  const ret = isAsync ? (ft.ret.k === "promise" ? ft.ret : ({ k: "promise", inner: ft.ret } as LType)) : ft.ret;
  return { c: `${target}(${as.join(", ")})`, t: isVoidish(ret) ? T.undefined : ret };
}

// --- methods ---------------------------------------------------------------------------

export function methodCall(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E {
  const t = obj.t;
  const o = obj.c;
  const a = node.arguments;
  if (name === "toString" && a.length === 0 && t.k !== "number") return str(em.toStringCode(obj));
  switch (t.k) {
    case "class": {
      const info = em.reg.cls(t.id);
      if (info.isError && name === "toString") return str(`lucent::errorToString(${o})`);
      const decl = info.decl.members.find((m) => m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) && m.name.text === name);
      if (decl && ts.isMethodDeclaration(decl)) return callMethodDecl(em, `(${o})->${cppIdent(name)}`, decl, node, t);
      if (decl && (ts.isPropertyDeclaration(decl) || ts.isGetAccessorDeclaration(decl))) {
        const f = classMember(em, obj, t, name, node);
        const ft = stripOpt(f.t);
        if (ft.k !== "fn") fail(node, Codes.UnsupportedCall, `${name} is not a function`);
        return { c: `${em.coerce(f, ft, node)}(${em.args(a, ft.params, node).join(", ")})`, t: isVoidish(ft.ret) ? T.undefined : ft.ret };
      }
      fail(node, Codes.UnsupportedClassFeature, `unknown method ${name}`);
    }
    case "struct": {
      const f = em.member(obj, name, node);
      const ft = stripOpt(f.t);
      if (ft.k !== "fn") fail(node, Codes.UnsupportedCall, `${name} is not a function`);
      return { c: `${em.coerce(f, ft, node)}(${em.args(a, ft.params, node).join(", ")})`, t: isVoidish(ft.ret) ? T.undefined : ft.ret };
    }
    case "string":
      return stringMethod(em, o, name, node);
    case "number":
      switch (name) {
        case "toString":
          return str(`lucent::numberToString(${args(o, optArg(em, node, 0, T.number))})`);
        case "toFixed":
          return str(`lucent::numberToFixed(${o}, ${optArg(em, node, 0, T.number) ?? "0.0"})`);
        case "toPrecision":
          return str(a[0] ? `lucent::numberToPrecision(${o}, ${argAs(em, node, 0, T.number)})` : `lucent::numberToString(${o})`);
        case "toExponential":
          return str(`lucent::numberToExponential(${args(o, optArg(em, node, 0, T.number))})`);
        case "valueOf":
          return num(o);
      }
      break;
    case "boolean":
      if (name === "valueOf") return bool(o);
      break;
    case "array":
      return arrayMethod(em, obj as E & { t: { k: "array"; e: LType } }, name, node);
    case "map":
      return mapMethod(em, obj as E & { t: { k: "map"; key: LType; val: LType } }, name, node);
    case "set":
      return setMethod(em, obj as E & { t: { k: "set"; e: LType } }, name, node);
    case "bytes":
      return bytesMethod(em, o, name, node);
    case "error":
      if (name === "toString") return str(`lucent::errorToString(${o})`);
      break;
    case "fn":
      if (name === "call" || name === "apply" || name === "bind") fail(node, Codes.UnsupportedBuiltin, `Function.prototype.${name} is not supported`);
      break;
    case "promise":
      fail(node, Codes.UnsupportedBuiltin, `promise.${name}() is not supported; use await`);
  }
  fail(node, Codes.UnsupportedBuiltin, `.${name}() is not supported on ${typeKey(t)}`);
}

function stringMethod(em: FnEmitter, o: string, name: string, node: ts.CallExpression): E {
  const n = (i: number) => optArg(em, node, i, T.number);
  const s = (i: number) => optArg(em, node, i, T.string);
  switch (name) {
    case "charCodeAt":
      return num(`(${o}).charCodeAt(${n(0) ?? "0.0"})`);
    case "charAt":
      return str(`(${o}).charAt(${n(0) ?? "0.0"})`);
    case "at":
      return { c: `(${o}).at(${argAs(em, node, 0, T.number)})`, t: unionOf([T.string, T.undefined]) };
    case "codePointAt":
      return { c: `(${o}).codePointAt(${argAs(em, node, 0, T.number)})`, t: unionOf([T.number, T.undefined]) };
    case "indexOf":
      return num(`(${o}).indexOf(${args(s(0), n(1))})`);
    case "lastIndexOf":
      return num(`(${o}).lastIndexOf(${args(s(0), n(1))})`);
    case "includes":
      return bool(`(${o}).includes(${args(s(0), n(1))})`);
    case "startsWith":
      return bool(`(${o}).startsWith(${args(s(0), n(1))})`);
    case "endsWith":
      return bool(`(${o}).endsWith(${args(s(0), n(1))})`);
    case "slice":
      return str(`(${o}).slice(${args(n(0) ?? "0.0", n(1))})`);
    case "substring":
      return str(`(${o}).substring(${args(n(0) ?? "0.0", n(1))})`);
    case "substr": {
      const start = n(0) ?? "0.0";
      const tmp = em.ctx.fresh("s");
      const st = em.ctx.fresh("st");
      return str(`({ auto ${tmp} = ${o}; double ${st} = ${start}; if (${st} < 0) ${st} = std::max(0.0, ${st} + static_cast<double>(${tmp}.length())); ${tmp}.slice(${st}, ${n(1) ? `${st} + ${n(1)}` : `static_cast<double>(${tmp}.length())`}); })`);
    }
    case "toUpperCase":
    case "toLocaleUpperCase":
      return str(`(${o}).toUpperCase()`);
    case "toLowerCase":
    case "toLocaleLowerCase":
      return str(`(${o}).toLowerCase()`);
    case "trim":
    case "trimStart":
    case "trimEnd":
      return str(`(${o}).${name}()`);
    case "trimLeft":
      return str(`(${o}).trimStart()`);
    case "trimRight":
      return str(`(${o}).trimEnd()`);
    case "repeat":
      return str(`(${o}).repeat(${argAs(em, node, 0, T.number)})`);
    case "padStart":
    case "padEnd":
      return str(`(${o}).${name}(${argAs(em, node, 0, T.number)}, ${s(1) ?? 'LUCENT_STR(" ")'})`);
    case "replace":
    case "replaceAll": {
      const second = node.arguments[1];
      if (second && (ts.isArrowFunction(second) || ts.isFunctionExpression(second))) fail(second, Codes.UnsupportedBuiltin, "replacement functions are not supported");
      return str(`(${o}).${name}(${argAs(em, node, 0, T.string)}, ${argAs(em, node, 1, T.string)})`);
    }
    case "split": {
      if (!node.arguments[0]) return { c: `lucent::Array<lucent::String>{${o}}`, t: { k: "array", e: T.string } };
      return { c: `lucent::split(${args(o, s(0), n(1))})`, t: { k: "array", e: T.string } };
    }
    case "concat":
      return str(`(lucent::String(${o})${node.arguments.map((x) => ` + ${em.toStringCode(em.expr(x))}`).join("")})`);
    case "localeCompare":
      return num(`(${o}).localeCompare(${argAs(em, node, 0, T.string)})`);
    case "normalize":
    case "valueOf":
    case "toString":
      return str(o);
  }
  fail(node, Codes.UnsupportedBuiltin, `String.prototype.${name} is not supported`);
}

function arrayMethod(em: FnEmitter, obj: E & { t: { k: "array"; e: LType } }, name: string, node: ts.CallExpression): E {
  const o = obj.c;
  const e = obj.t.e;
  const at = obj.t;
  const a = node.arguments;
  const n = (i: number) => optArg(em, node, i, T.number);
  const cb = (params: LType[], ret?: LType) => callback(em, a[0], params, ret);
  const self: LType = at;
  switch (name) {
    case "push": {
      if (a.length === 1 && ts.isSpreadElement(a[0]!)) return num(`({ auto& pa = ${o}; pa.append(${em.exprAs(a[0]!.expression, at)}); pa.length(); })`);
      if (a.some(ts.isSpreadElement)) fail(node, Codes.UnsupportedBuiltin, "push(...items) with other arguments");
      return num(`(${o}).push(${a.map((x) => em.exprAs(x, e)).join(", ")})`);
    }
    case "pop":
    case "shift":
      return { c: `(${o}).${name}()`, t: unionOf([e, T.undefined]) };
    case "unshift":
      if (a.length !== 1) fail(node, Codes.UnsupportedBuiltin, "unshift takes one item");
      return num(`(${o}).unshift(${em.exprAs(a[0]!, e)})`);
    case "slice":
      return { c: `(${o}).slice(${args(n(0), n(1))})`, t: at };
    case "splice": {
      const items = a.slice(2).map((x) => em.exprAs(x, e));
      return { c: `(${o}).splice(${[n(0) ?? "0.0", ...(a[1] ? [n(1)!] : items.length ? [`(${o}).length()`] : []), ...items].join(", ")})`, t: at };
    }
    case "concat": {
      const parts = a.map((x) => {
        const v = em.expr(x);
        return stripOpt(v.t).k === "array" ? em.coerce(v, at, x) : `${em.cpp(at)}{${em.coerce(v, e, x)}}`;
      });
      return { c: `(${o}).concat(${parts.join(", ")})`, t: at };
    }
    case "join":
      return str(`(${o}).join(${optArg(em, node, 0, T.string) ?? ""})`);
    case "indexOf":
    case "lastIndexOf":
      return num(`(${o}).${name}(${em.exprAs(a[0]!, e)})`);
    case "includes":
      return bool(`(${o}).includes(${em.exprAs(a[0]!, e)})`);
    case "at":
      return { c: `(${o}).atIndex(${n(0)})`, t: unionOf([e, T.undefined]) };
    case "find":
    case "findLast":
      return { c: `(${o}).${name}(${cb([e, T.number, self], T.boolean).c})`, t: unionOf([e, T.undefined]) };
    case "findIndex":
    case "findLastIndex":
      return num(`(${o}).${name}(${cb([e, T.number, self], T.boolean).c})`);
    case "filter":
      return { c: `(${o}).filter(${truthyCallback(em, a[0], [e, T.number, self])})`, t: at };
    case "some":
    case "every":
      return bool(`(${o}).${name}(${truthyCallback(em, a[0], [e, T.number, self])})`);
    case "forEach":
      return { c: `(${o}).forEach(${cb([e, T.number, self], T.void).c})`, t: T.undefined };
    case "map": {
      const rt = em.lt(node);
      if (rt.k !== "array") fail(node, Codes.UnsupportedBuiltin, "map");
      return { c: `(${o}).template map<${em.cpp(rt.e)}>(${cb([e, T.number, self], rt.e).c})`, t: rt };
    }
    case "flatMap": {
      const rt = em.lt(node);
      if (rt.k !== "array") fail(node, Codes.UnsupportedBuiltin, "flatMap");
      return { c: `(${o}).template flatMap<${em.cpp(rt.e)}>(${cb([e, T.number, self], rt).c})`, t: rt };
    }
    case "reduce":
    case "reduceRight": {
      const rt = em.lt(node);
      if (a.length < 2) return { c: `(${o}).${name}(${cb([e, e, T.number, self], e).c})`, t: e };
      const init = em.exprAs(a[1]!, rt);
      return { c: `(${o}).${name}(${cb([rt, e, T.number, self], rt).c}, ${em.cpp(rt)}(${init}))`, t: rt };
    }
    case "sort":
    case "toSorted": {
      if (!a[0]) return { c: `(${o}).${name}()`, t: at };
      return { c: `(${o}).${name}(${cb([e, e], T.number).c})`, t: at };
    }
    case "reverse":
    case "toReversed":
      return { c: `(${o}).${name}()`, t: at };
    case "fill":
      return { c: `(${o}).fill(${args(em.exprAs(a[0]!, e), n(1), n(2))})`, t: at };
    case "values":
      return { c: `(${o}).slice()`, t: at };
    case "keys":
      return { c: `lucent::Array<double>::generate((${o}).length(), [](double i) { return i; })`, t: { k: "array", e: T.number } };
    case "entries":
      return { c: `lucent::arrayEntries(${o})`, t: { k: "array", e: { k: "tuple", es: [T.number, e] } } };
  }
  fail(node, Codes.UnsupportedBuiltin, `Array.prototype.${name} is not supported`);
}

/** A predicate callback whose result is tested for truthiness. */
function truthyCallback(em: FnEmitter, arg: ts.Expression | undefined, params: LType[]): string {
  const own = arg ? em.lt(arg) : undefined;
  const ret = own && own.k === "fn" ? own.ret : T.boolean;
  const c = callback(em, arg, params, ret);
  if (ret.k === "boolean") return c.c;
  const f = em.ctx.fresh("pred");
  const ps = params.map((p, i) => `${em.cpp(p)} a${i}`).join(", ");
  const as = params.map((_, i) => `a${i}`).join(", ");
  return `[${f} = ${c.c}](${ps}) { return lucent::truthy(${f}(${as})); }`;
}

function mapMethod(em: FnEmitter, obj: E & { t: { k: "map"; key: LType; val: LType } }, name: string, node: ts.CallExpression): E {
  const { key, val } = obj.t;
  const o = obj.c;
  const a = node.arguments;
  switch (name) {
    case "get":
      return { c: `(${o}).get(${em.exprAs(a[0]!, key)})`, t: unionOf([val, T.undefined]) };
    case "set":
      return { c: `(${o}).set(${em.exprAs(a[0]!, key)}, ${em.exprAs(a[1]!, val)})`, t: obj.t };
    case "has":
      return bool(`(${o}).has(${em.exprAs(a[0]!, key)})`);
    case "delete":
      return bool(`(${o}).remove(${em.exprAs(a[0]!, key)})`);
    case "clear":
      return { c: `(${o}).clear()`, t: T.undefined };
    case "forEach":
      return { c: `(${o}).forEach(${callback(em, a[0], [val, key, obj.t], T.void).c})`, t: T.undefined };
    case "keys":
      return { c: `(${o}).keys()`, t: { k: "array", e: key } };
    case "values":
      return { c: `(${o}).values()`, t: { k: "array", e: val } };
    case "entries":
      return { c: `lucent::mapEntries(${o})`, t: { k: "array", e: { k: "tuple", es: [key, val] } } };
  }
  fail(node, Codes.UnsupportedBuiltin, `Map.prototype.${name} is not supported`);
}

function setMethod(em: FnEmitter, obj: E & { t: { k: "set"; e: LType } }, name: string, node: ts.CallExpression): E {
  const e = obj.t.e;
  const o = obj.c;
  const a = node.arguments;
  switch (name) {
    case "add":
      return { c: `(${o}).add(${em.exprAs(a[0]!, e)})`, t: obj.t };
    case "has":
      return bool(`(${o}).has(${em.exprAs(a[0]!, e)})`);
    case "delete":
      return bool(`(${o}).remove(${em.exprAs(a[0]!, e)})`);
    case "clear":
      return { c: `(${o}).clear()`, t: T.undefined };
    case "forEach":
      return { c: `(${o}).forEach(${callback(em, a[0], [e, e, obj.t], T.void).c})`, t: T.undefined };
    case "values":
    case "keys":
      return { c: `(${o}).values()`, t: { k: "array", e } };
  }
  fail(node, Codes.UnsupportedBuiltin, `Set.prototype.${name} is not supported`);
}

function bytesMethod(em: FnEmitter, o: string, name: string, node: ts.CallExpression): E {
  const a = node.arguments;
  const n = (i: number) => optArg(em, node, i, T.number);
  switch (name) {
    case "subarray":
    case "slice":
      return { c: `(${o}).${name}(${args(n(0), n(1))})`, t: T.bytes };
    case "fill":
      return { c: `(${o}).fill(${argAs(em, node, 0, T.number)})`, t: T.bytes };
    case "indexOf":
      return num(`(${o}).indexOf(${argAs(em, node, 0, T.number)})`);
    case "includes":
      return bool(`(${o}).includes(${argAs(em, node, 0, T.number)})`);
    case "set": {
      const src = em.expr(a[0]!);
      const st = stripOpt(src.t);
      if (st.k !== "bytes" && !(st.k === "array" && st.e.k === "number")) fail(node, Codes.UnsupportedBuiltin, "set() needs a Uint8Array or number[]");
      return { c: `(${o}).setFrom(${args(src.c, n(1))})`, t: T.undefined };
    }
    case "forEach":
      return { c: `(${o}).forEach(${callback(em, a[0], [T.number, T.number, T.bytes], T.void).c})`, t: T.undefined };
    case "map":
      return { c: `(${o}).map(${callback(em, a[0], [T.number, T.number, T.bytes], T.number).c})`, t: T.bytes };
    case "reduce": {
      const rt = em.lt(node);
      if (!a[1]) fail(node, Codes.UnsupportedBuiltin, "Uint8Array reduce needs an initial value");
      return { c: `(${o}).reduce(${callback(em, a[0], [rt, T.number, T.number, T.bytes], rt).c}, ${em.cpp(rt)}(${em.exprAs(a[1], rt)}))`, t: rt };
    }
    case "join":
      return str(`(${o}).join(${optArg(em, node, 0, T.string) ?? ""})`);
  }
  fail(node, Codes.UnsupportedBuiltin, `Uint8Array.prototype.${name} is not supported`);
}

// --- globals -------------------------------------------------------------------------------

function isCoreSymbol(sym: ts.Symbol): boolean {
  const decl = sym.declarations?.[0];
  return !!decl && path.resolve(decl.getSourceFile().fileName) === path.resolve(coreTypesPath());
}

export function globalCall(em: FnEmitter, node: ts.CallExpression, name: string, sym: ts.Symbol): E | undefined {
  const a = node.arguments;
  if (isCoreSymbol(sym)) {
    switch (name) {
      case "delay":
        return { c: `lucent::delay(${argAs(em, node, 0, T.number)})`, t: { k: "promise", inner: T.void } };
      case "error":
        return { c: `lucent::errorWithCode(${argAs(em, node, 0, T.string)}, ${argAs(em, node, 1, T.string)})`, t: T.error };
      case "errorCode":
        return { c: `(${argAs(em, node, 0, T.error)})->code`, t: unionOf([T.string, T.undefined]) };
      case "utf8Encode":
        return { c: `lucent::utf8Encode(${argAs(em, node, 0, T.string)})`, t: T.bytes };
      case "utf8Decode":
        return str(`lucent::utf8Decode(${argAs(em, node, 0, T.bytes)})`);
      case "now":
        return num("lucent::monotonicNow()");
    }
    fail(node, Codes.UnsupportedBuiltin, `@lucent-lang/core ${name} is not implemented natively`);
  }
  const decl = sym.declarations?.[0];
  if (!decl || !decl.getSourceFile().isDeclarationFile) return undefined;
  switch (name) {
    case "parseInt":
      return num(`lucent::parseInt(${args(argAs(em, node, 0, T.string), optArg(em, node, 1, T.number))})`);
    case "parseFloat":
      return num(`lucent::parseFloat(${argAs(em, node, 0, T.string)})`);
    case "isNaN":
      return bool(`std::isnan(${argAs(em, node, 0, T.number)})`);
    case "isFinite":
      return bool(`std::isfinite(${argAs(em, node, 0, T.number)})`);
    case "String":
      return str(a[0] ? em.toStringCode(em.expr(a[0])) : "lucent::String()");
    case "Number": {
      if (!a[0]) return num("0.0");
      const v = em.expr(a[0]);
      const t = stripOpt(v.t);
      if (v.t.k === "string") return num(`lucent::stringToNumber(${v.c})`);
      if (v.t.k === "number") return num(v.c);
      if (v.t.k === "boolean") return num(`(${v.c} ? 1.0 : 0.0)`);
      fail(node, Codes.UnsupportedBuiltin, `Number() of ${typeKey(v.t)}${t ? "" : ""}`);
    }
    case "Boolean":
      return bool(a[0] ? em.cond(a[0]) : "false");
  }
  fail(node, Codes.UnsupportedBuiltin, `${name}() is not supported`);
}

// --- new --------------------------------------------------------------------------------------

export function newBuiltin(em: FnEmitter, node: ts.NewExpression, callee: ts.Expression, t: LType): E {
  const a = node.arguments ?? ts.factory.createNodeArray();
  const name = ts.isIdentifier(callee) ? callee.text : "";
  switch (t.k) {
    case "map": {
      if (!a[0]) return { c: `${em.cpp(t)}()`, t };
      return { c: `lucent::mapFromEntries<${em.cpp(t.key)}, ${em.cpp(t.val)}>(${em.exprAs(a[0], { k: "array", e: { k: "tuple", es: [t.key, t.val] } })})`, t };
    }
    case "set": {
      if (!a[0]) return { c: `${em.cpp(t)}()`, t };
      const src = em.expr(a[0]);
      const st = stripOpt(src.t);
      if (st.k === "array") return { c: `${em.cpp(t)}(${em.coerce(src, { k: "array", e: t.e }, a[0])})`, t };
      if (st.k === "set") return { c: `${em.cpp(t)}((${src.c}).values())`, t };
      if (st.k === "string") return { c: `${em.cpp(t)}(lucent::splitCodePoints(${src.c}))`, t };
      fail(node, Codes.UnsupportedBuiltin, `new Set(${typeKey(src.t)})`);
    }
    case "array": {
      if (a.length === 1) {
        const v = em.expr(a[0]!);
        if (v.t.k === "number") return { c: `${em.cpp(t)}::filled(static_cast<size_t>(lucent::toUint32(${v.c})), ${em.cpp(t.e)}{})`, t };
      }
      return { c: `${em.cpp(t)}{${a.map((x) => em.exprAs(x, t.e)).join(", ")}}`, t };
    }
    case "bytes": {
      if (!a[0]) return { c: "lucent::Bytes()", t };
      const v = em.expr(a[0]);
      const vt = stripOpt(v.t);
      if (vt.k === "number") return { c: `lucent::Bytes(${v.c})`, t };
      if (vt.k === "array") return { c: `lucent::Bytes::fromArray(${em.coerce(v, { k: "array", e: T.number }, a[0])})`, t };
      if (vt.k === "bytes") return { c: `(${v.c}).slice()`, t };
      fail(node, Codes.UnsupportedBuiltin, `new Uint8Array(${typeKey(v.t)})`);
    }
    case "error": {
      const kind = ["TypeError", "RangeError"].includes(name) ? name : "Error";
      const msg = a[0] ? em.exprAs(a[0], T.string) : "lucent::String()";
      return { c: `lucent::makeError(LUCENT_STR("${kind}"), ${msg})`, t };
    }
  }
  fail(node, Codes.UnsupportedBuiltin, `new ${name || callee.getText()}() is not supported`);
}

// --- instanceof / super ----------------------------------------------------------------------

export function instanceOf(em: FnEmitter, node: ts.BinaryExpression): E {
  const v = em.expr(node.left);
  const right = node.right;
  if (ts.isIdentifier(right)) {
    if (["Error", "TypeError", "RangeError"].includes(right.text) && isLibGlobal(em, right, right.text)) {
      return bool(`lucent::isErrorOf(${v.c}, ${right.text === "Error" ? "nullptr" : `"${right.text}"`})`);
    }
    const sym = em.checker.getSymbolAtLocation(right);
    const g = sym ? em.ctx.globals.get(em.ctx.resolve(sym)) : undefined;
    if (g && g.kind === "class") {
      if (g.info.typeParams.length) fail(node, Codes.UnsupportedOperator, "instanceof with a generic class is not supported");
      return bool(`lucent::isInstance<lucent_app::${g.info.cppName}>(${v.c})`);
    }
    if (isLibGlobal(em, right, right.text)) {
      const kinds: Record<string, string> = { Array: "array", Map: "map", Set: "set", Uint8Array: "bytes" };
      const k = kinds[right.text];
      if (k) {
        const vt = stripOpt(v.t);
        if (vt.k === k) return bool(v.t.k === "opt" ? `(${v.c}).has()` : "true");
        if (vt.k === "union") return bool(`std::holds_alternative<${em.cpp(vt.ms.find((m) => m.k === k) ?? T.never)}>(${v.c})`);
        return bool("false");
      }
    }
  }
  fail(node, Codes.UnsupportedOperator, "unsupported instanceof");
}

export function superCall(em: FnEmitter, node: ts.CallExpression): E {
  const cls = em.opts.cls;
  if (!cls || !cls.isError) fail(node, Codes.UnsupportedClassFeature, "`super(...)` is only supported in classes that extend Error");
  const msg = node.arguments[0] ? em.exprAs(node.arguments[0], T.string) : "lucent::String()";
  return { c: `(this->message = ${msg}, lucent::undefined)`, t: T.undefined };
}
