import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { builtinSdkModuleOf, sdkModuleOf } from "../program.ts";
import { findSdkType, jniDescriptor, parseSdkType, type Platform, type SdkClassSchema, type SdkEnumSchema, type SdkMethodSchema, type SdkPropertySchema, type SdkType } from "../sdk/schema.ts";
import { type LType, T, unionOf } from "../types.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import { cppQuoted } from "./literals.ts";

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

const OBJC_NUMBER: Record<string, string> = { double: "double", float: "float", CGFloat: "CGFloat", NSInteger: "NSInteger", NSUInteger: "NSUInteger", int: "int", long: "long", short: "short", byte: "int8_t", char: "unichar" };

function sdkEnum(ref: SdkClassRef, t: SdkType): SdkEnumSchema | undefined {
  if (t.k !== "ref") return undefined;
  const e = findSdkType(ref.platform, t.module, t.name);
  return e?.kind === "enum" ? e : undefined;
}

function toObjc(em: FnEmitter, ref: SdkClassRef, arg: ts.Expression, t: SdkType): string {
  if (t.nullable && t.k !== "ref") fail(arg, Codes.UnsupportedType, "optional values of this type are not supported in SDK calls yet");
  switch (t.k) {
    case "prim":
      if (t.name === "bool" || t.name === "boolean") return `(${em.exprAs(arg, T.boolean)} ? YES : NO)`;
      return `static_cast<${OBJC_NUMBER[t.name] ?? "double"}>(${em.exprAs(arg, T.number)})`;
    case "string":
      return `lucent::objc::toNSString(${em.exprAs(arg, T.string)})`;
    case "ref": {
      const e = sdkEnum(ref, t);
      if (e) return `static_cast<${e.native}>(${em.exprAs(arg, T.number)})`;
      const cls = findSdkType(ref.platform, t.module, t.name) as SdkClassSchema;
      const lt: LType = { k: "native", platform: ref.platform, module: t.module, name: t.name };
      return `((${cls.native}*)lucent::objc::unwrap(${em.exprAs(arg, t.nullable ? unionOf([lt, T.null]) : lt)}))`;
    }
    default:
      fail(arg, Codes.UnsupportedType, `${t.k} parameters are not supported in iOS SDK calls yet`);
  }
}

function fromObjc(ref: SdkClassRef, code: string, t: SdkType, lt: LType, what: string): E {
  switch (t.k) {
    case "prim":
      if (t.name === "void") return { c: `(void)(${code})`, t: T.undefined };
      if (t.name === "bool" || t.name === "boolean") return { c: `static_cast<bool>(${code})`, t: T.boolean };
      return { c: `static_cast<double>(${code})`, t: T.number };
    case "string":
      return t.nullable ? { c: `lucent::objc::fromNSStringOpt(${code})`, t: lt } : { c: `lucent::objc::fromNSString(${code}, ${cppQuoted(what)})`, t: T.string };
    case "ref":
      if (sdkEnum(ref, t)) return { c: `static_cast<double>(${code})`, t: T.number };
      return t.nullable ? { c: `lucent::objc::wrapOpt(${code})`, t: lt } : { c: `lucent::objc::wrap(${code}, ${cppQuoted(what)})`, t: lt };
    default:
      throw new Error(`unsupported iOS result type ${t.k}`);
  }
}

function send(receiver: string, selector: string, args: string[]): string {
  if (!selector.includes(":")) return `[${receiver} ${selector}]`;
  const parts = selector.split(":").slice(0, -1);
  return `[${receiver} ${parts.map((p, i) => `${p}:${args[i]}`).join(" ")}]`;
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
    case "array":
      if (t.of.k === "prim" && t.of.name === "long") return `lucent::jni::toLongArray(env, ${em.exprAs(arg, { k: "array", e: T.number })})`;
      if (t.of.k === "prim" && t.of.name === "int") return `lucent::jni::toIntArray(env, ${em.exprAs(arg, { k: "array", e: T.number })})`;
      fail(arg, Codes.UnsupportedType, "only long[] and int[] arrays are supported in Android SDK calls so far");
    case "classOf": {
      const named = sdkClassNamed(em, arg);
      if (!named) fail(arg, Codes.UnsupportedSyntax, "pass the class itself (for example `Vibrator`)");
      return `lucent::jni::findClass(${cppQuoted(named.cls.native)})`;
    }
    case "ref": {
      const lt: LType = { k: "native", platform: ref.platform, module: t.module, name: t.name };
      return `lucent::jni::unwrap(${em.exprAs(arg, t.nullable ? unionOf([lt, T.null]) : lt)})`;
    }
    case "tparam":
      fail(arg, Codes.UnsupportedType, "generic parameters are not supported in Android SDK calls yet");
  }
}

function fromJni(code: string, t: SdkType, lt: LType, what: string): E {
  switch (t.k) {
    case "prim":
      if (t.name === "void") return { c: code, t: T.undefined };
      if (t.name === "boolean") return { c: `(${code} == JNI_TRUE)`, t: T.boolean };
      return { c: `static_cast<double>(${code})`, t: T.number };
    case "string":
      return t.nullable ? { c: `lucent::jni::fromJStringOpt(env, static_cast<jstring>(${code}))`, t: lt } : { c: `lucent::jni::fromJString(env, static_cast<jstring>(${code}), ${cppQuoted(what)})`, t: T.string };
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
  const out = fromJni("r_", opts.ret, opts.lt, opts.what);
  const retCpp = result ? "void" : em.cpp(out.t);
  const body = [
    "JNIEnv* env = lucent::jni::env();",
    ...(opts.pre ?? []),
    "lucent::jni::LocalFrame frame_(env);",
    `static jclass cls_ = lucent::jni::findClass(${cppQuoted(opts.cls.native)});`,
    `static auto id_ = lucent::jni::${opts.lookup}(cls_, ${cppQuoted(opts.name)}, ${cppQuoted(opts.desc)});`,
    result ? `${opts.access("id_")};` : `auto r_ = ${opts.access("id_")};`,
    "lucent::jni::check(env);",
    ...(result ? [] : [`return ${out.c};`]),
  ];
  return { c: `([&]() -> ${retCpp} { ${body.join(" ")} }())`, t: result ? T.undefined : out.t };
}

function argsOf(node: ts.CallExpression | ts.NewExpression): readonly ts.Expression[] {
  const args = node.arguments ?? ts.factory.createNodeArray();
  if (args.some(ts.isSpreadElement)) fail(node, Codes.UnsupportedSyntax, "spread arguments are not supported in SDK calls");
  return args;
}

// --- entry points --------------------------------------------------------------------

/** `new C(…)` of an SDK class. */
export function nativeNew(em: FnEmitter, node: ts.NewExpression, t: LType & { k: "native" }): E {
  const sig = em.checker.getResolvedSignature(node);
  const decl = sig?.declaration;
  const ref = decl ? classOfDecl(decl) : undefined;
  if (!ref || !decl || !ts.isConstructorDeclaration(decl)) fail(node, Codes.UnsupportedCall, `${t.name} cannot be constructed`);
  requireMain(em, node, ref);
  noteIncludes(em, ref);
  const index = (decl.parent as ts.ClassDeclaration).members.filter(ts.isConstructorDeclaration).indexOf(decl);
  const ctor = ref.cls.constructors![index]!;
  const args = argsOf(node);
  const params = ctor.params.map((p) => parseSdkType(p.type, ref.module));
  if (ref.platform === "ios") {
    const a = args.map((x, i) => toObjc(em, ref, x, params[i]!));
    return { c: `lucent::objc::wrap(${send(`[${ref.cls.native} alloc]`, ctor.selector ?? "init", a)}, ${cppQuoted(`new ${t.name}`)})`, t };
  }
  const a = args.map((x, i) => toJni(em, ref, x, params[i]!));
  const desc = jniDescriptor(ctor.params.map((p) => p.type), "void");
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
  const decl = resolved(em, name)?.valueDeclaration;
  const ref = decl ? classOfDecl(decl) : undefined;
  if (!ref || !decl || !ts.isPropertyDeclaration(decl)) fail(node, Codes.UnsupportedSyntax, "methods of platform objects must be called directly");
  const prop = ref.cls.properties!.find((p) => p.name === (decl.name as ts.Identifier).text)!;
  return property(em, node, ref, prop, obj);
}

function property(em: FnEmitter, node: ts.Node, ref: SdkClassRef, prop: SdkPropertySchema, obj: E | undefined): E {
  requireMain(em, node, ref);
  noteIncludes(em, ref);
  const t = parseSdkType(prop.type, ref.module);
  const lt = em.lt(node);
  const what = `${ref.cls.name}.${prop.name}`;
  if (ref.platform === "ios") {
    const receiver = obj ? `((${ref.cls.native}*)lucent::objc::unwrap(${obj.c}))` : ref.cls.native;
    return fromObjc(ref, send(receiver, prop.selector ?? prop.name, []), t, lt, what);
  }
  if (prop.getter) {
    const desc = jniDescriptor([], prop.type);
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
  noteIncludes(em, ref);
  return ref.platform === "ios" ? iosCall(em, node, ref, method, obj) : androidCall(em, node, ref, method, obj);
}

function iosCall(em: FnEmitter, node: ts.CallExpression, ref: SdkClassRef, m: SdkMethodSchema, obj: E | undefined): E {
  const tps = m.typeParams ?? [];
  const a = argsOf(node).map((x, i) => toObjc(em, ref, x, parseSdkType(m.params[i]!.type, ref.module, tps)));
  const receiver = obj ? `((${ref.cls.native}*)lucent::objc::unwrap(${obj.c}))` : ref.cls.native;
  return fromObjc(ref, send(receiver, m.selector ?? m.name, a), parseSdkType(m.returns, ref.module, tps), em.lt(node), `${ref.cls.name}.${m.name}()`);
}

function androidCall(em: FnEmitter, node: ts.CallExpression, ref: SdkClassRef, m: SdkMethodSchema, obj: E | undefined): E {
  const tps = m.typeParams ?? [];
  const a = argsOf(node).map((x, i) => toJni(em, ref, x, parseSdkType(m.params[i]!.type, ref.module, tps)));
  const desc = jniDescriptor(m.params.map((p) => p.type), m.returns, tps);
  const ret = parseSdkType(m.returns, ref.module, tps);
  const kind = jniKind(desc.slice(desc.indexOf(")") + 1));
  const recv = obj ? "lucent::jni::unwrap(recv_)" : "cls_";
  return jniCall(em, {
    cls: ref.cls,
    lookup: obj ? "method" : "staticMethod",
    name: m.name,
    desc,
    access: (id) => `env->Call${obj ? "" : "Static"}${kind}Method(${[recv, id, ...a].join(", ")})`,
    ret,
    lt: em.lt(node),
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
