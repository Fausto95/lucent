import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { builtinSdkModuleOf, sdkModuleOf } from "../program.ts";
import { findSdkModule, findSdkType, jniDescriptor, sdkTypeInfo, parseSdkType, type Platform, type SdkClassSchema, type SdkMethodSchema, type SdkPropertySchema, type SdkType } from "../sdk/schema.ts";
import { type LType, T, unionOf } from "../types.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import { cppQuoted, numberLiteral, stringLiteral } from "./literals.ts";

/**
 * Calls into platform SDKs from *.ios.lucent.ts and *.android.lucent.ts:
 * Objective-C message sends (the unit is Objective-C++) and JNI calls. The
 * checker resolves each use to a declaration in a generated SDK .d.ts; the
 * declaration leads back to its binding schema, which has the native names.
 */

interface SdkClassRef {
  platform: Platform;
  module: string;
  cls: SdkClassSchema;
}

/** The schema class a declaration in an SDK .d.ts belongs to. */
function classOfDecl(decl: ts.Node): SdkClassRef | undefined {
  const sdk = sdkModuleOf(decl.getSourceFile());
  if (!sdk) return undefined;
  const owner = ts.isClassDeclaration(decl) ? decl : decl.parent;
  if (!owner || !ts.isClassDeclaration(owner) || !owner.name) return undefined;
  const cls = findSdkType(sdk.platform, sdk.module, owner.name.text);
  return cls?.kind === "class" ? { ...sdk, cls } : undefined;
}

function resolved(em: FnEmitter, node: ts.Node): ts.Symbol | undefined {
  const sym = em.checker.getSymbolAtLocation(node);
  return sym ? em.ctx.resolve(sym) : undefined;
}

/** An expression naming an SDK class (`UIDevice`, `VibrationEffect`), used as a value. */
function sdkClassNamed(em: FnEmitter, expr: ts.Expression): SdkClassRef | undefined {
  if (!ts.isIdentifier(expr) && !ts.isPropertyAccessExpression(expr)) return undefined;
  const decl = resolved(em, expr)?.valueDeclaration;
  return decl && ts.isClassDeclaration(decl) ? classOfDecl(decl) : undefined;
}

function builtinNamed(em: FnEmitter, expr: ts.Expression): { module: string; name: string } | undefined {
  if (!ts.isIdentifier(expr)) return undefined;
  const sym = resolved(em, expr);
  const decl = sym?.declarations?.[0];
  const module = decl && builtinSdkModuleOf(decl.getSourceFile());
  return module && sym ? { module, name: sym.name } : undefined;
}

/** Inside `main(() => …)`: the nearest function is main's argument. */
function inMainContext(em: FnEmitter, node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      const call = n.parent;
      if (!ts.isCallExpression(call) || call.arguments[0] !== n) return false;
      const b = builtinNamed(em, call.expression);
      return b?.module === "lucent:thread" && b.name === "main";
    }
    if (ts.isFunctionLike(n)) return false;
  }
  return false;
}

function requireMain(em: FnEmitter, node: ts.Node, ref: SdkClassRef, member?: { mainActor?: boolean }): void {
  if (!(ref.cls.mainActor || member?.mainActor) || inMainContext(em, node)) return;
  fail(node, Codes.MainThreadOnly, `${ref.cls.name} can only be used on the main thread: call it inside main(() => …) from lucent:thread`);
}

function noteIncludes(em: FnEmitter, ref: SdkClassRef): void {
  const n = em.ctx.nativeUnit(em.opts.module);
  if (ref.platform === "ios") {
    n.includes.add("#include <lucent/platform/ios.h>");
    for (const f of findSdkModuleFrameworks(ref)) {
      n.includes.add(`#import <${f}/${f}.h>`);
      em.ctx.frameworks.add(f);
    }
  } else {
    n.includes.add("#include <lucent/platform/android.h>");
  }
}

function findSdkModuleFrameworks(ref: SdkClassRef): string[] {
  return ref.platform === "ios" ? [ref.module] : [];
}

// --- iOS -----------------------------------------------------------------------------

const OBJC_NUMBER: Record<string, string> = {
  double: "double",
  float: "float",
  CGFloat: "CGFloat",
  NSInteger: "NSInteger",
  NSUInteger: "NSUInteger",
  int: "int",
  long: "long",
  short: "short",
  byte: "int8_t",
  char: "unichar",
  int8: "int8_t",
  uint8: "uint8_t",
  int16: "int16_t",
  uint16: "uint16_t",
  int32: "int32_t",
  uint32: "uint32_t",
  int64: "int64_t",
  uint64: "uint64_t",
};

/** An enum type's native name (from the module's names: no schema needed). */
function sdkEnum(platform: Platform, t: SdkType): { native: string } | undefined {
  if (t.k !== "ref") return undefined;
  const info = sdkTypeInfo(platform, t.module, t.name);
  return info?.kind === "enum" ? info : undefined;
}

/** Objective-C (or CoreFoundation) spelling of a reference type, for casts. */
function objcRefType(t: SdkType & { k: "ref" }): string {
  const info = sdkTypeInfo("ios", t.module, t.name);
  if (!info || info.kind === "enum") throw new Error(`unknown Objective-C type ${t.module}.${t.name}`);
  return info.kind === "protocol" ? `id<${info.native}>` : `${info.native}*`;
}

/**
 * Lucent value → Objective-C value of schema type `t`, for code `c` holding
 * the (non-absent) Lucent value. Collections convert their elements with a
 * generic lambda, so they accept any Lucent representation the checker allowed.
 */
function toObjcCode(t: SdkType, c: string, owned: boolean): string {
  switch (t.k) {
    case "prim":
      if (t.name === "bool" || t.name === "boolean") return `(${c} ? YES : NO)`;
      return `static_cast<${OBJC_NUMBER[t.name] ?? "double"}>(${c})`;
    case "string":
      return t.cf ? `(__bridge CFStringRef)lucent::objc::toNSString(${c})` : `lucent::objc::toNSString(${c})`;
    case "bytes":
      return t.cf ? `(__bridge CFDataRef)lucent::objc::toNSData(${c})` : `lucent::objc::toNSData(${c})`;
    case "date":
      return `lucent::objc::toNSDate(${c})`;
    case "id":
      return t.cf ? `(__bridge CFTypeRef)lucent::objc::toId(${c})` : `lucent::objc::toId(${c})`;
    case "array": {
      const arr = `lucent::objc::toNSArray(${c}, [&](const auto& e_) -> id { return ${boxed(t.of, "e_")}; })`;
      return t.cf ? `(__bridge CFArrayRef)${arr}` : arr;
    }
    case "record": {
      const dict = `lucent::objc::toNSDictionary(${c}, [&](const auto& e_) -> id { return ${boxed(t.of, "e_")}; })`;
      return t.cf ? `(__bridge CFDictionaryRef)${dict}` : dict;
    }
    case "out":
      return `lucent::objc::outSlot(${c}, ${owned})`;
    case "ref": {
      const e = sdkEnum("ios", t);
      if (e) return `static_cast<${e.native}>(${c})`;
      return `((${objcRefType(t)})lucent::objc::unwrap(${c}))`;
    }
    default:
      throw new Error(`no Objective-C form for ${t.k}`);
  }
}

/** An element of an NSArray/NSDictionary: an object (numbers and booleans boxed). */
function boxed(t: SdkType, c: string): string {
  if (t.k === "prim" || (t.k === "ref" && sdkEnum("ios", t))) return `@(${toObjcCode(t, c, false)})`;
  if (t.k === "id") return `lucent::objc::toId(${c})`;
  return toObjcCode({ ...t, nullable: false } as SdkType, c, false);
}

function toObjc(em: FnEmitter, arg: ts.Expression, t: SdkType, owned = false): string {
  const scalar = ((): LType | undefined => {
    switch (t.k) {
      case "prim":
        return t.name === "bool" || t.name === "boolean" ? T.boolean : T.number;
      case "string":
        return T.string;
      case "bytes":
        return T.bytes;
      case "date":
        return T.date;
      case "ref":
        return sdkEnum("ios", t) ? T.number : { k: "native", platform: "ios", module: t.module, name: t.name };
      default:
        return undefined;
    }
  })();
  if (t.k === "id") return toObjcCode(t, em.expr(arg).c, owned);
  if (!t.nullable) return toObjcCode(t, scalar ? em.exprAs(arg, scalar) : em.expr(arg).c, owned);
  if (t.k === "out") return toObjcCode(t, em.expr(arg).c, owned);
  const v = scalar ? em.exprAs(arg, unionOf([scalar, T.null])) : em.expr(arg).c;
  return `lucent::objc::ifPresent(${v}, [&](const auto& x_) { return ${toObjcCode({ ...t, nullable: false } as SdkType, "x_", owned)}; })`;
}

/** Objective-C value of schema type `t` → Lucent value of type `lt`. */
function fromObjc(em: FnEmitter, code: string, t: SdkType, lt: LType, what: string, owned = false): E {
  const w = cppQuoted(what);
  const cast = (objc: string) => (owned ? `(__bridge_transfer ${objc})` : `(__bridge ${objc})`);
  const elem = (x: LType): LType => (x.k === "opt" ? x.inner : x);
  switch (t.k) {
    case "prim":
      // A value, so optional chains can use it (`obj?.voidMethod()`).
      if (t.name === "void") return { c: `({ (void)(${code}); lucent::undefined; })`, t: T.undefined };
      if (t.name === "bool" || t.name === "boolean") return { c: `static_cast<bool>(${code})`, t: T.boolean };
      return { c: `static_cast<double>(${code})`, t: T.number };
    case "string": {
      const s = t.cf ? `${cast("NSString*")}${code}` : code;
      return t.nullable ? { c: `lucent::objc::fromNSStringOpt(${s})`, t: lt } : { c: `lucent::objc::fromNSString(${s}, ${w})`, t: T.string };
    }
    case "bytes": {
      const d = t.cf ? `${cast("NSData*")}${code}` : code;
      return t.nullable ? { c: `lucent::objc::fromNSDataOpt(${d})`, t: lt } : { c: `lucent::objc::fromNSData(${d}, ${w})`, t: T.bytes };
    }
    case "date":
      return t.nullable ? { c: `lucent::objc::fromNSDateOpt(${code})`, t: lt } : { c: `lucent::objc::fromNSDate(${code}, ${w})`, t: T.date };
    case "id": {
      const o = t.cf ? `${cast("id")}${code}` : code;
      return lt.k === "opt" ? { c: `lucent::objc::wrapOpt(${o})`, t: lt } : { c: `lucent::objc::wrap(${o}, ${w})`, t: lt };
    }
    case "array":
    case "record": {
      const container = elem(lt);
      const itemLt = container.k === "array" ? container.e : container.k === "dict" ? container.val : undefined;
      if (!itemLt) throw new Error(`unexpected Lucent type for ${t.k}`);
      const item = fromObjcItem(t.of, itemLt, what);
      const lambda = `[&](id e_) -> ${em.cpp(itemLt)} { return ${item}; }`;
      const objcType = t.k === "array" ? "NSArray*" : "NSDictionary*";
      const src = t.cf ? `${cast(objcType)}${code}` : code;
      const fn = t.k === "array" ? "fromNSArray" : "fromNSDictionary";
      return t.nullable ? { c: `lucent::objc::${fn}Opt<${em.cpp(itemLt)}>(${src}, ${lambda})`, t: lt } : { c: `lucent::objc::${fn}<${em.cpp(itemLt)}>(${src}, ${lambda}, ${w})`, t: container };
    }
    case "ref":
      if (sdkEnum("ios", t)) return { c: `static_cast<double>(${code})`, t: T.number };
      return lt.k === "opt" ? { c: `lucent::objc::wrapOpt(${code})`, t: lt } : { c: `lucent::objc::wrap(${code}, ${w})`, t: lt };
    default:
      throw new Error(`no Lucent form for Objective-C ${t.k}`);
  }
}

/** An element (`id e_`) of an NSArray/NSDictionary as a Lucent value. */
function fromObjcItem(t: SdkType, lt: LType, what: string): string {
  const w = cppQuoted(what);
  switch (t.k) {
    case "prim":
      return t.name === "bool" || t.name === "boolean" ? "static_cast<bool>([(NSNumber*)e_ boolValue])" : "[(NSNumber*)e_ doubleValue]";
    case "string":
      return `lucent::objc::fromNSString((NSString*)e_, ${w})`;
    case "bytes":
      return `lucent::objc::fromNSData((NSData*)e_, ${w})`;
    case "date":
      return `lucent::objc::fromNSDate((NSDate*)e_, ${w})`;
    case "ref":
      if (sdkEnum("ios", t)) return "[(NSNumber*)e_ doubleValue]";
      return lt.k === "opt" ? "lucent::objc::wrapOpt(e_)" : `lucent::objc::wrap(e_, ${w})`;
    case "id":
      return lt.k === "opt" ? "lucent::objc::wrapOpt(e_)" : `lucent::objc::wrap(e_, ${w})`;
    default:
      return fail(undefined, Codes.UnsupportedType, `${what}: nested collections from Objective-C are not supported yet`);
  }
}

/** `[receiver sel:a …]`, with the trailing `error:` of throwing methods taking `&err_`. */
function send(receiver: string, selector: string, args: string[], throws = false): string {
  if (!selector.includes(":")) return `[${receiver} ${selector}]`;
  const parts = selector.split(":").slice(0, -1);
  const all = throws ? [...args, "&err_"] : args;
  return `[${receiver} ${parts.map((p, i) => `${p}:${all[i]}`).join(" ")}]`;
}

/** A message send whose NSError** result becomes a thrown Lucent error. */
function throwing(sendCode: string, out: (r: string) => E, isVoid: boolean): E {
  if (isVoid) return { c: `({ NSError* __autoreleasing err_ = nil; (void)${sendCode}; lucent::objc::throwIfError(err_); lucent::undefined; })`, t: T.undefined };
  const e = out("r_");
  return { c: `({ NSError* __autoreleasing err_ = nil; auto r_ = ${sendCode}; lucent::objc::throwIfError(err_); ${e.c}; })`, t: e.t };
}

/** CoreFoundation's Create/Copy rule: such functions return objects the caller owns. */
function ownsResult(name: string): boolean {
  return /Create|Copy/.test(name);
}

// --- Android -------------------------------------------------------------------------

const JNI_CALL: Record<string, string> = { V: "Void", Z: "Boolean", B: "Byte", C: "Char", S: "Short", I: "Int", J: "Long", F: "Float", D: "Double" };
const JNI_PRIM: Record<string, string> = { boolean: "jboolean", byte: "jbyte", char: "jchar", short: "jshort", int: "jint", long: "jlong", float: "jfloat", double: "jdouble" };

function jniKind(desc: string): string {
  return JNI_CALL[desc[0]!] ?? "Object";
}

function toJni(em: FnEmitter, ref: SdkClassRef, arg: ts.Expression, t: SdkType): string {
  switch (t.k) {
    case "prim":
      if (t.name === "boolean") return `static_cast<jboolean>(${em.exprAs(arg, T.boolean)} ? JNI_TRUE : JNI_FALSE)`;
      if (t.name === "int" || t.name === "short" || t.name === "byte" || t.name === "char") return `static_cast<${JNI_PRIM[t.name]}>(lucent::toInt32(${em.exprAs(arg, T.number)}))`;
      return `static_cast<${JNI_PRIM[t.name] ?? "jdouble"}>(${em.exprAs(arg, T.number)})`;
    case "string":
      return t.nullable ? `({ auto s_ = ${em.exprAs(arg, unionOf([T.string, T.null]))}; s_.has() ? lucent::jni::toJString(env, s_.get()) : nullptr; })` : `lucent::jni::toJString(env, ${em.exprAs(arg, T.string)})`;
    case "array": {
      const a = jniArray(t);
      if (!a) fail(arg, Codes.UnsupportedType, "only byte[], int[], long[] and String[] arrays are supported in Android SDK calls so far");
      if (t.nullable) return `lucent::jni::toArrayOpt(env, ${em.exprAs(arg, unionOf([a.lt, T.null]))}, lucent::jni::to${a.name})`;
      return `lucent::jni::to${a.name}(env, ${em.exprAs(arg, a.lt)})`;
    }
    case "classOf": {
      const named = sdkClassNamed(em, arg);
      if (!named) fail(arg, Codes.UnsupportedSyntax, "pass the class itself (for example `Vibrator`)");
      requireAvailable(em, arg, named, named.cls.since, named.cls.name);
      return `lucent::jni::findClass(${cppQuoted(named.cls.native)})`;
    }
    case "ref": {
      const lt: LType = { k: "native", platform: ref.platform, module: t.module, name: t.name };
      return `lucent::jni::unwrap(${em.exprAs(arg, t.nullable ? unionOf([lt, T.null]) : lt)})`;
    }
    case "tparam":
      fail(arg, Codes.UnsupportedType, "generic parameters are not supported in Android SDK calls yet");
    default:
      fail(arg, Codes.UnsupportedType, `${t.k} values are not Java types`);
  }
}

/** byte[] ↔ Uint8Array, String[] ↔ string[], int[]/long[] ↔ number[]: copied. */
function jniArray(t: SdkType & { k: "array" }): { name: string; cast: string; lt: LType } | undefined {
  const of = t.of;
  if (of.k === "string" && !of.charSequence) return { name: "StringArray", cast: "jobjectArray", lt: { k: "array", e: T.string } };
  if (of.k !== "prim") return undefined;
  if (of.name === "byte") return { name: "ByteArray", cast: "jbyteArray", lt: T.bytes };
  if (of.name === "int") return { name: "IntArray", cast: "jintArray", lt: { k: "array", e: T.number } };
  if (of.name === "long") return { name: "LongArray", cast: "jlongArray", lt: { k: "array", e: T.number } };
  return undefined;
}

function fromJni(em: FnEmitter, code: string, t: SdkType, lt: LType, what: string): E {
  switch (t.k) {
    case "prim":
      if (t.name === "void") return { c: code, t: T.undefined };
      if (t.name === "boolean") return { c: `(${code} == JNI_TRUE)`, t: T.boolean };
      return { c: `static_cast<double>(${code})`, t: T.number };
    case "string":
      if (t.charSequence) return t.nullable ? { c: `lucent::jni::charSequenceToStringOpt(env, ${code})`, t: lt } : { c: `lucent::jni::charSequenceToString(env, ${code}, ${cppQuoted(what)})`, t: T.string };
      return t.nullable ? { c: `lucent::jni::fromJStringOpt(env, static_cast<jstring>(${code}))`, t: lt } : { c: `lucent::jni::fromJString(env, static_cast<jstring>(${code}), ${cppQuoted(what)})`, t: T.string };
    case "array": {
      const a = jniArray(t);
      if (!a) throw new Error(`unsupported Java array result ${JSON.stringify(t)}`);
      if (t.nullable) return { c: `lucent::jni::fromArrayOpt<${em.cpp(a.lt)}>(env, static_cast<${a.cast}>(${code}), lucent::jni::from${a.name})`, t: lt };
      return { c: `lucent::jni::from${a.name}(env, static_cast<${a.cast}>(${code}), ${cppQuoted(what)})`, t: a.lt };
    }
    case "ref":
    case "tparam":
      return lt.k === "opt" ? { c: `lucent::jni::wrapOpt(env, ${code})`, t: lt } : { c: `lucent::jni::wrap(env, ${code}, ${cppQuoted(what)})`, t: lt };
    default:
      throw new Error(`unsupported Java result type ${t.k}`);
  }
}

/**
 * One JNI call: class and member IDs are looked up once per call site, local
 * references are freed, and a pending Java exception becomes a Lucent error.
 */
function jniCall(em: FnEmitter, opts: { cls: SdkClassSchema; lookup: string; name: string; desc: string; access: (id: string) => string; ret: SdkType; lt: LType; what: string; pre?: string[] }): E {
  const result = opts.ret.k === "prim" && opts.ret.name === "void";
  const out = fromJni(em, "r_", opts.ret, opts.lt, opts.what);
  // Void calls are values too, so optional chains can use them.
  const retCpp = result ? "lucent::Undefined" : em.cpp(out.t);
  const body = [
    "JNIEnv* env = lucent::jni::env();",
    ...(opts.pre ?? []),
    "lucent::jni::LocalFrame frame_(env);",
    `static jclass cls_ = lucent::jni::findClass(${cppQuoted(opts.cls.native)});`,
    `static auto id_ = lucent::jni::${opts.lookup}(cls_, ${cppQuoted(opts.name)}, ${cppQuoted(opts.desc)});`,
    result ? `${opts.access("id_")};` : `auto r_ = ${opts.access("id_")};`,
    "lucent::jni::check(env);",
    result ? "return lucent::undefined;" : `return ${out.c};`,
  ];
  return { c: `([&]() -> ${retCpp} { ${body.join(" ")} }())`, t: result ? T.undefined : out.t };
}

function argsOf(node: ts.CallExpression | ts.NewExpression): readonly ts.Expression[] {
  const args = node.arguments ?? ts.factory.createNodeArray();
  if (args.some(ts.isSpreadElement)) fail(node, Codes.UnsupportedSyntax, "spread arguments are not supported in SDK calls");
  return args;
}

// --- availability --------------------------------------------------------------------

/** The oldest OS the app runs on (React Native's minimum). */
const MIN_ANDROID_API = 24;

/**
 * APIs newer than the minimum must be used where the code has checked the
 * OS: under `if (available("android", N))`, `Build_VERSION.SDK_INT >= N`,
 * their `?:` / `&&` forms, or after an early exit on the opposite check.
 */
function requireAvailable(em: FnEmitter, node: ts.Node, ref: SdkClassRef, since: number | string | undefined, what: string): void {
  if (ref.platform !== "android" || typeof since !== "number" || since <= MIN_ANDROID_API) return;
  if (guarded(em, node, since)) return;
  fail(node, Codes.Unavailable, `${what} needs API ${since} (apps run from API ${MIN_ANDROID_API}): use it under if (available("android", ${since})) or Build_VERSION.SDK_INT >= ${since}`);
}

function apiLevelRead(em: FnEmitter, e: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(e) || e.name.text !== "SDK_INT") return false;
  const decl = resolved(em, e)?.valueDeclaration;
  return !!decl && sdkModuleOf(decl.getSourceFile())?.module === "android.os";
}

function literal(e: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(e)) return Number(e.text);
  return undefined;
}

/** `cond` true ⇒ the API level is at least `n`. */
function atLeast(em: FnEmitter, cond: ts.Expression, n: number): boolean {
  const c = ts.skipPartiallyEmittedExpressions(cond);
  if (ts.isParenthesizedExpression(c)) return atLeast(em, c.expression, n);
  if (ts.isCallExpression(c)) {
    const b = builtinNamed(em, c.expression);
    const level = c.arguments[1] && literal(c.arguments[1]);
    return b?.module === "lucent:android" && b.name === "available" && level !== undefined && level >= n;
  }
  if (!ts.isBinaryExpression(c)) return false;
  const op = c.operatorToken.kind;
  if (op === ts.SyntaxKind.AmpersandAmpersandToken) return atLeast(em, c.left, n) || atLeast(em, c.right, n);
  const k = literal(c.right) ?? literal(c.left);
  if (k === undefined) return false;
  if (apiLevelRead(em, c.left)) return (op === ts.SyntaxKind.GreaterThanEqualsToken && k >= n) || (op === ts.SyntaxKind.GreaterThanToken && k + 1 >= n);
  if (apiLevelRead(em, c.right)) return (op === ts.SyntaxKind.LessThanEqualsToken && k >= n) || (op === ts.SyntaxKind.LessThanToken && k + 1 >= n);
  return false;
}

/** `cond` true ⇒ the API level is below `n`. */
function below(em: FnEmitter, cond: ts.Expression, n: number): boolean {
  const c = ts.skipPartiallyEmittedExpressions(cond);
  if (ts.isParenthesizedExpression(c)) return below(em, c.expression, n);
  if (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken) return atLeast(em, c.operand, n);
  if (!ts.isBinaryExpression(c)) return false;
  const op = c.operatorToken.kind;
  if (op === ts.SyntaxKind.BarBarToken) return below(em, c.left, n) || below(em, c.right, n);
  const k = literal(c.right) ?? literal(c.left);
  if (k === undefined) return false;
  if (apiLevelRead(em, c.left)) return (op === ts.SyntaxKind.LessThanToken && k >= n) || (op === ts.SyntaxKind.LessThanEqualsToken && k + 1 >= n);
  if (apiLevelRead(em, c.right)) return (op === ts.SyntaxKind.GreaterThanToken && k >= n) || (op === ts.SyntaxKind.GreaterThanEqualsToken && k + 1 >= n);
  return false;
}

function exits(s: ts.Statement): boolean {
  if (ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isBreakOrContinueStatement(s)) return true;
  if (ts.isBlock(s)) return s.statements.length > 0 && exits(s.statements[s.statements.length - 1]!);
  return false;
}

function guarded(em: FnEmitter, node: ts.Node, n: number): boolean {
  for (let child: ts.Node = node, p = node.parent; p; child = p, p = p.parent) {
    if (ts.isIfStatement(p)) {
      if (child === p.thenStatement && atLeast(em, p.expression, n)) return true;
      if (child === p.elseStatement && below(em, p.expression, n)) return true;
    }
    if (ts.isConditionalExpression(p)) {
      if (child === p.whenTrue && atLeast(em, p.condition, n)) return true;
      if (child === p.whenFalse && below(em, p.condition, n)) return true;
    }
    if (ts.isBinaryExpression(p) && child === p.right) {
      if (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && atLeast(em, p.left, n)) return true;
      if (p.operatorToken.kind === ts.SyntaxKind.BarBarToken && below(em, p.left, n)) return true;
    }
    if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
      const stmts = p.statements as ts.NodeArray<ts.Statement>;
      for (const s of stmts) {
        if (s === child) break;
        if (ts.isIfStatement(s) && !s.elseStatement && exits(s.thenStatement) && below(em, s.expression, n)) return true;
      }
    }
  }
  return false;
}

// --- entry points --------------------------------------------------------------------

/**
 * The Lucent type a glue result has: the schema's declared type, not the
 * checker's view at the use (which narrows `obj.prop` after an assignment
 * or a check). Uses coerce from it as from any other value. Generic results
 * (`T`) take the type of the resolved signature.
 */
function declaredLt(em: FnEmitter, platform: Platform, t: SdkType, node: ts.Node): LType {
  const opt = (x: LType) => (t.nullable ? unionOf([x, T.null]) : x);
  switch (t.k) {
    case "prim":
      if (t.name === "void") return T.undefined;
      return opt(t.name === "bool" || t.name === "boolean" ? T.boolean : T.number);
    case "string":
      return opt(T.string);
    case "bytes":
      return opt(T.bytes);
    case "date":
      return opt(T.date);
    case "id":
      return opt({ k: "native", platform: "ios", module: "lucent:ios", name: "NSObject" });
    case "array":
      if (t.of.k === "prim" && t.of.name === "byte") return opt(T.bytes);
      return opt({ k: "array", e: declaredLt(em, platform, { ...t.of, nullable: false } as SdkType, node) });
    case "record":
      return opt({ k: "dict", val: declaredLt(em, platform, { ...t.of, nullable: false } as SdkType, node) });
    case "ref":
      if (sdkEnum(platform, t)) return opt(T.number);
      return opt({ k: "native", platform, module: t.module, name: t.name });
    default: {
      const sig = ts.isCallExpression(node) ? em.checker.getResolvedSignature(node) : undefined;
      const ret = sig ? em.checker.getReturnTypeOfSignature(sig) : em.checker.getTypeAtLocation(node);
      return em.reg.lower(ret, node);
    }
  }
}

/** `new C(…)` of an SDK class. */
export function nativeNew(em: FnEmitter, node: ts.NewExpression, t: LType & { k: "native" }): E {
  if (t.module === "lucent:ios" && t.name === "Out") {
    em.ctx.nativeUnit(em.opts.module).includes.add("#include <lucent/platform/ios.h>");
    return { c: "lucent::objc::makeOut()", t };
  }
  const sig = em.checker.getResolvedSignature(node);
  const decl = sig?.declaration;
  let ref = decl ? classOfDecl(decl) : undefined;
  if (!ref || !decl || !ts.isConstructorDeclaration(decl)) fail(node, Codes.UnsupportedCall, `${t.name} cannot be constructed`);
  requireMain(em, node, ref);
  noteIncludes(em, ref);
  const index = (decl.parent as ts.ClassDeclaration).members.filter(ts.isConstructorDeclaration).indexOf(decl);
  const ctor = ref.cls.constructors![index]!;
  // An inherited initializer allocates the class being constructed.
  const own = findSdkType(t.platform, t.module, t.name);
  if (own?.kind === "class" && own !== ref.cls) ref = { ...ref, module: t.module, cls: own };
  requireAvailable(em, node, ref, ref.cls.since, t.name);
  requireAvailable(em, node, ref, ctor.since, `new ${t.name}(…)`);
  const args = argsOf(node);
  const params = ctor.params.map((p) => parseSdkType(p.type, ref.module));
  if (ref.platform === "ios") {
    const a = args.map((x, i) => toObjc(em, x, params[i]!));
    return { c: `lucent::objc::wrap(${send(`[${ref.cls.native} alloc]`, ctor.selector ?? "init", a)}, ${cppQuoted(`new ${t.name}`)})`, t };
  }
  const a = args.map((x, i) => toJni(em, ref, x, params[i]!));
  const desc = ctor.descriptor ?? jniDescriptor(ctor.params.map((p) => p.type), "void");
  return jniCall(em, { cls: ref.cls, lookup: "method", name: "<init>", desc, access: (id) => `env->NewObject(cls_, ${[id, ...a].join(", ")})`, ret: { k: "ref", module: ref.module, name: ref.cls.name, nullable: false }, lt: t, what: `new ${t.name}` });
}

/** `C.member` where C is an SDK class, or an SDK enum member. */
export function nativeStaticProperty(em: FnEmitter, node: ts.PropertyAccessExpression): E | undefined {
  const sym = resolved(em, node);
  const decl = sym?.valueDeclaration;
  if (!decl) return undefined;
  if (ts.isEnumMember(decl) && sdkModuleOf(decl.getSourceFile())) {
    // Hand-written enum values are checked against the SDK headers at compile time.
    const sdk = sdkModuleOf(decl.getSourceFile())!;
    const e = findSdkType(sdk.platform, sdk.module, (decl.parent as ts.EnumDeclaration).name.text);
    const value = em.checker.getConstantValue(decl);
    if (e?.kind === "enum" && sdk.platform === "ios" && typeof value === "number") {
      const c = e.cases.find((x) => x.name === decl.name.getText())!;
      const unit = em.ctx.nativeUnit(em.opts.module);
      unit.includes.add(`#import <${sdk.module}/${sdk.module}.h>`);
      unit.lines.add(`static_assert(${c.native} == ${value}, "${e.name}.${c.name} in the ${sdk.module} binding schema");`);
    }
    return undefined;
  }
  if (!ts.isPropertyDeclaration(decl)) return undefined;
  const ref = classOfDecl(decl);
  if (!ref || !ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) return undefined;
  const prop = ref.cls.properties!.find((p) => p.name === node.name.text)!;
  return property(em, node, ref, prop, undefined);
}

/** `obj.member` on an SDK object. */
export function nativeMember(em: FnEmitter, obj: E, node: ts.Node): E {
  const name = ts.isPropertyAccessExpression(node) ? node.name : node;
  if (obj.t.k === "native" && obj.t.module === "lucent:ios" && obj.t.name === "Out" && ts.isIdentifier(name) && name.text === "value") {
    return { c: `lucent::objc::outValue(${obj.c})`, t: unionOf([{ k: "native", platform: "ios", module: "lucent:ios", name: "NSObject" }, T.null]) };
  }
  const decl = resolved(em, name)?.valueDeclaration;
  const ref = decl ? classOfDecl(decl) : undefined;
  if (!ref || !decl || !ts.isPropertyDeclaration(decl)) fail(node, Codes.UnsupportedSyntax, "methods of platform objects must be called directly");
  const prop = ref.cls.properties!.find((p) => p.name === (decl.name as ts.Identifier).text)!;
  return property(em, node, ref, prop, obj);
}

function property(em: FnEmitter, node: ts.Node, ref: SdkClassRef, prop: SdkPropertySchema, obj: E | undefined): E {
  // Compile-time constants need no call, and exist on every API level.
  if (typeof prop.value === "number") return { c: numberLiteral(prop.value), t: T.number };
  if (typeof prop.value === "string") return { c: stringLiteral(prop.value), t: T.string };
  if (typeof prop.value === "boolean") return { c: String(prop.value), t: T.boolean };
  requireMain(em, node, ref);
  if (!obj) requireAvailable(em, node, ref, ref.cls.since, ref.cls.name);
  requireAvailable(em, node, ref, prop.since, `${ref.cls.name}.${prop.name}`);
  noteIncludes(em, ref);
  const t = parseSdkType(prop.type, ref.module);
  const lt = declaredLt(em, ref.platform, t, node);
  const what = `${ref.cls.name}.${prop.name}`;
  if (ref.platform === "ios") {
    if (prop.global) return fromObjc(em, prop.global, t, lt, what);
    return fromObjc(em, send(objcReceiver(ref, obj), prop.selector ?? prop.name, []), t, lt, what);
  }
  if (prop.getter) {
    const desc = ref.cls.methods?.find((m) => (m.java ?? m.name) === prop.getter && !m.params.length)?.descriptor ?? jniDescriptor([], prop.type);
    const recv = obj ? `lucent::jni::unwrap(recv_)` : "cls_";
    return jniCall(em, { cls: ref.cls, lookup: obj ? "method" : "staticMethod", name: prop.getter, desc, access: (id) => `env->Call${obj ? "" : "Static"}${jniKind(desc.slice(2))}Method(${recv}, ${id})`, ret: t, lt, what, pre: obj ? [`auto recv_ = ${obj.c};`] : [] });
  }
  const sig = jniDescriptor([], prop.type).slice(2);
  const kind = jniKind(sig);
  return jniCall(em, {
    cls: ref.cls,
    lookup: obj ? "field" : "staticField",
    name: prop.name,
    desc: sig,
    access: (id) => (obj ? `env->Get${kind}Field(lucent::jni::unwrap(recv_), ${id})` : `env->GetStatic${kind}Field(cls_, ${id})`),
    ret: t,
    lt,
    what,
    pre: obj ? [`auto recv_ = ${obj.c};`] : [],
  });
}

/** A method call on an SDK object (`obj` set) or class. */
export function nativeCall(em: FnEmitter, node: ts.CallExpression, obj: E | undefined): E | undefined {
  const decl = em.checker.getResolvedSignature(node)?.declaration;
  if (!decl || !ts.isMethodDeclaration(decl)) return undefined;
  const ref = classOfDecl(decl);
  if (!ref) return undefined;
  const isStatic = !!ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
  if (isStatic === !!obj) return undefined;
  const name = (decl.name as ts.Identifier).text;
  const index = (decl.parent as ts.ClassDeclaration).members.filter((m) => ts.isMethodDeclaration(m) && (m.name as ts.Identifier).text === name).indexOf(decl);
  const method = (ref.cls.methods ?? []).filter((m) => m.name === name)[index]!;
  requireMain(em, node, ref, method);
  if (!obj) requireAvailable(em, node, ref, ref.cls.since, ref.cls.name);
  requireAvailable(em, node, ref, method.since, `${ref.cls.name}.${method.name}`);
  noteIncludes(em, ref);
  return ref.platform === "ios" ? iosCall(em, node, ref, method, obj) : androidCall(em, node, ref, method, obj);
}

function iosCall(em: FnEmitter, node: ts.CallExpression, ref: SdkClassRef, m: SdkMethodSchema, obj: E | undefined): E {
  const tps = m.typeParams ?? [];
  const a = argsOf(node).map((x, i) => toObjc(em, x, parseSdkType(m.params[i]!.type, ref.module, tps)));
  const code = send(objcReceiver(ref, obj), m.selector ?? m.name, a, m.throws);
  const ret = parseSdkType(m.returns, ref.module, tps);
  const what = `${ref.cls.name}.${m.name}()`;
  const lt = declaredLt(em, "ios", ret, node);
  if (m.throws) return throwing(code, (r) => fromObjc(em, r, ret, lt, what), ret.k === "prim" && ret.name === "void");
  return fromObjc(em, code, ret, lt, what);
}

function objcReceiver(ref: SdkClassRef, obj: E | undefined): string {
  if (!obj) return ref.cls.native;
  return `((${ref.cls.interface ? `id<${ref.cls.native}>` : `${ref.cls.native}*`})lucent::objc::unwrap(${obj.c}))`;
}

/** `obj.prop = v` / `Class.prop = v` on a writable SDK property. */
export function nativeLvalue(em: FnEmitter, target: ts.PropertyAccessExpression, obj: E | undefined): { get: string; set: (v: string) => string; type: LType } | undefined {
  const decl = resolved(em, target.name)?.valueDeclaration;
  const ref = decl ? classOfDecl(decl) : undefined;
  if (!ref || !decl || !ts.isPropertyDeclaration(decl)) return undefined;
  const prop = ref.cls.properties?.find((p) => p.name === target.name.text);
  if (!prop || !!prop.static !== !obj) return undefined;
  if (prop.readonly) fail(target, Codes.UnsupportedAssignmentTarget, `${ref.cls.name}.${prop.name} is read-only`);
  const get = property(em, target, ref, prop, obj);
  const t = parseSdkType(prop.type, ref.module);
  const type = em.lt(target);
  if (ref.platform === "ios") {
    if (!prop.setter) fail(target, Codes.UnsupportedAssignmentTarget, `${ref.cls.name}.${prop.name} has no setter`);
    const set = (v: string) => {
      const conv = t.nullable ? `lucent::objc::ifPresent(v_, [&](const auto& x_) { return ${toObjcCode({ ...t, nullable: false } as SdkType, "x_", false)}; })` : toObjcCode(t, "v_", false);
      return `({ auto v_ = ${v}; ${send(objcReceiver(ref, obj), prop.setter!, [conv])}; v_; })`;
    };
    return { get: get.c, set, type };
  }
  fail(target, Codes.UnsupportedAssignmentTarget, `assigning Java fields is not supported yet (${ref.cls.name}.${prop.name})`);
}

/** A C function of an SDK module (iOS): `SecItemCopyMatching(query, out)`. */
export function nativeFunctionCall(em: FnEmitter, node: ts.CallExpression): E | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;
  const decl = resolved(em, node.expression)?.valueDeclaration;
  const sdk = decl && ts.isFunctionDeclaration(decl) ? sdkModuleOf(decl.getSourceFile()) : undefined;
  if (!sdk || !decl) return undefined;
  const schema = findSdkModule(sdk.platform, sdk.module)!;
  const name = (decl as ts.FunctionDeclaration).name!.text;
  const f = schema.functions?.find((x) => x.name === name);
  if (!f) fail(node, Codes.UnsupportedCall, `${name} has no binding`);
  noteFramework(em, sdk.module);
  const owned = ownsResult(name);
  const a = argsOf(node).map((x, i) => toObjc(em, x, parseSdkType(f.params[i]!.type, sdk.module), owned));
  const ret = parseSdkType(f.returns, sdk.module);
  return fromObjc(em, `${name}(${a.join(", ")})`, ret, declaredLt(em, "ios", ret, node), `${name}()`, owned);
}

/** A C global constant of an SDK module (iOS): `kSecClass`. */
export function nativeConstant(em: FnEmitter, id: ts.Identifier): E | undefined {
  const decl = resolved(em, id)?.valueDeclaration;
  const sdk = decl && ts.isVariableDeclaration(decl) ? sdkModuleOf(decl.getSourceFile()) : undefined;
  if (!sdk) return undefined;
  const schema = findSdkModule(sdk.platform, sdk.module)!;
  const c = schema.constants?.find((x) => x.name === id.text);
  if (!c) fail(id, Codes.UnsupportedSyntax, `${id.text} has no binding`);
  noteFramework(em, sdk.module);
  const ct = parseSdkType(c.type, sdk.module);
  return fromObjc(em, c.name, ct, declaredLt(em, "ios", ct, id), c.name);
}

function noteFramework(em: FnEmitter, module: string): void {
  const n = em.ctx.nativeUnit(em.opts.module);
  n.includes.add("#include <lucent/platform/ios.h>");
  n.includes.add(`#import <${module}/${module}.h>`);
  em.ctx.frameworks.add(module);
}

function androidCall(em: FnEmitter, node: ts.CallExpression, ref: SdkClassRef, m: SdkMethodSchema, obj: E | undefined): E {
  const tps = m.typeParams ?? [];
  const a = argsOf(node).map((x, i) => toJni(em, ref, x, parseSdkType(m.params[i]!.type, ref.module, tps)));
  const desc = m.descriptor ?? jniDescriptor(m.params.map((p) => p.type), m.returns, tps);
  const ret = parseSdkType(m.returns, ref.module, tps);
  const kind = jniKind(desc.slice(desc.indexOf(")") + 1));
  const recv = obj ? "lucent::jni::unwrap(recv_)" : "cls_";
  return jniCall(em, {
    cls: ref.cls,
    lookup: obj ? "method" : "staticMethod",
    name: m.java ?? m.name,
    desc,
    access: (id) => `env->Call${obj ? "" : "Static"}${kind}Method(${[recv, id, ...a].join(", ")})`,
    ret,
    lt: declaredLt(em, "android", ret, node),
    what: `${ref.cls.name}.${m.name}()`,
    pre: obj ? [`auto recv_ = ${obj.c};`] : [],
  });
}

/** `main`, `available` and `appContext` from lucent:thread, lucent:ios and lucent:android. */
export function nativeBuiltinCall(em: FnEmitter, node: ts.CallExpression): E | undefined {
  const b = builtinNamed(em, node.expression);
  if (!b) return undefined;
  const args = argsOf(node);
  const unit = em.ctx.nativeUnit(em.opts.module);
  switch (`${b.module}.${b.name}`) {
    case "lucent:thread.main": {
      const f = args[0];
      if (!f || !(ts.isArrowFunction(f) || ts.isFunctionExpression(f)) || args.length !== 1) fail(node, Codes.UnsupportedCall, "main takes one function literal: main(() => …)");
      if (ts.getModifiers(f)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) fail(f, Codes.UnsupportedCall, "the function passed to main runs synchronously on the main thread; it cannot be async");
      unit.includes.add(em.ctx.platform === "ios" ? "#include <lucent/platform/ios.h>" : "#include <lucent/platform/android.h>");
      const closure = em.closure(f);
      const t = em.lt(node);
      if (t.k === "promise" && t.inner.k === "promise") fail(f, Codes.UnsupportedCall, "the function passed to main cannot return a promise");
      return { c: `lucent::runOnMain(${closure.c})`, t };
    }
    case "lucent:ios.asString":
    case "lucent:ios.asNumber":
    case "lucent:ios.asBoolean":
    case "lucent:ios.asData":
    case "lucent:ios.asDate": {
      unit.includes.add("#include <lucent/platform/ios.h>");
      const nsObject: LType = { k: "native", platform: "ios", module: "lucent:ios", name: "NSObject" };
      const value: Record<string, LType> = { asString: T.string, asNumber: T.number, asBoolean: T.boolean, asData: T.bytes, asDate: T.date };
      return { c: `lucent::objc::${b.name}(${em.exprAs(args[0]!, unionOf([nsObject, T.null]))})`, t: unionOf([value[b.name]!, T.null]) };
    }
    case "lucent:ios.available":
      unit.includes.add("#include <lucent/platform/ios.h>");
      return { c: `lucent::objc::available(${args.slice(1).map((a) => em.exprAs(a, T.number)).join(", ")})`, t: T.boolean };
    case "lucent:android.available":
      unit.includes.add("#include <lucent/platform/android.h>");
      return { c: `lucent::jni::available(${em.exprAs(args[1]!, T.number)})`, t: T.boolean };
    case "lucent:android.appContext":
      unit.includes.add("#include <lucent/platform/android.h>");
      return { c: "lucent::jni::appContext()", t: em.lt(node) };
  }
  fail(node, Codes.UnsupportedCall, `${b.module} ${b.name} cannot be called here`);
}
