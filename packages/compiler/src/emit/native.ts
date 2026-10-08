import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { type Code, Codes, fail } from "../diagnostics.ts";
import { builtinSdkModuleOf, sdkModuleOf } from "../program.ts";
import {
  classOfDecl,
  isSdkPropertyDecl,
  promiseForm,
  requirementOf,
  schemaConstructor,
  schemaMethod,
  schemaProperty,
  type SdkClassRef,
  sdkInterfacesOf,
} from "../sdk/declarations.ts";
import {
  type BindingPlan,
  blockConversion,
  explainRefusal,
  isBigIntType,
  isUnsignedWide,
  isWideInteger,
  kotlinFunctionConversion,
  memberPlan,
  provenanceOf,
  type Role,
  takenReason,
} from "../sdk/plans.ts";
import {
  findSdkModule,
  findSdkType,
  loadSdkModule,
  jniDescriptor,
  mainThreadOnly,
  MIN_ANDROID_API,
  oldestIos,
  sdkTypeInfo,
  parseSdkType,
  type Platform,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
  type SdkStructSchema,
  type SdkType,
  type SwiftMember,
  WRAP_UNBOUND,
} from "../sdk/schema.ts";
import { noteSdkUse } from "../sdk/usage.ts";
import type { ViewConstruction } from "../sdk/view-rules.ts";
import { type ClassInfo, cppIdent, type LType, stripOpt, T, unionOf } from "../types.ts";
import { type E, type Lvalue } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import { compareVersions } from "../package-versions.ts";
import { bigintExpr, numberExpr, stringExpr } from "./literals.ts";
import { javaSubclassName, sdkInstanceMethods } from "./java.ts";
import { inMainSubclass, subclassNative } from "./objc-subclass.ts";
import { kotlinShim, type KotlinUse, suspending, type Suspending } from "./kotlin.ts";
import { callbackEntry, setupOf } from "./setups.ts";
import {
  isPayloadEnum,
  swiftCall,
  swiftLabels,
  swiftRuntimeSince,
  swiftSet,
  swiftUnionFromObjc,
  type SwiftUse,
} from "./swift.ts";

/**
 * Calls into platform SDKs from *.ios.lucent.ts and *.android.lucent.ts:
 * Objective-C message sends (the unit is Objective-C++) and JNI calls. The
 * checker resolves each use to a declaration in a generated SDK .d.ts; the
 * declaration leads back to its binding schema, which has the native names.
 */

/** Whether an SDK .d.ts (or a platform built-in module) declares `decl`. */
export function declaredBySdk(decl: ts.Node | undefined): boolean {
  const file = decl?.getSourceFile();

  return !!file && (!!sdkModuleOf(file) || !!builtinSdkModuleOf(file));
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

function builtinNamed(
  em: FnEmitter,
  expr: ts.Expression,
): { module: string; name: string } | undefined {
  if (!ts.isIdentifier(expr)) return undefined;
  const sym = resolved(em, expr);
  const decl = sym?.declarations?.[0];
  const module = decl && builtinSdkModuleOf(decl.getSourceFile());
  return module && sym ? { module, name: sym.name } : undefined;
}

/** The built-ins that run a function argument on the main thread, and which argument. */
const MAIN_CALLBACKS: Record<string, number> = {
  "lucent:thread.main": 0,
  "lucent:ios.present": 0,
  "lucent:ios.onAppEvent": 1,
  "lucent:ios.onSceneEvent": 1,
};

/** Inside `main(() => …)`: the nearest function is main's argument (or another main-thread built-in's). */
export function inMainContext(em: FnEmitter, node: ts.Node): boolean {
  // A component's setup, and every function it creates (the analysis checked them for the main thread).
  if (setupOf(em.ctx, node)) return true;

  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      const call = n.parent;
      // A function the SDK calls back on the main thread.
      if ((ts.isCallExpression(call) || ts.isNewExpression(call)) && call.arguments) {
        const param = sdkParamType(em, call, call.arguments.indexOf(n as ts.Expression));
        if (param?.k === "fn") return param.main;
      }
      if (!ts.isCallExpression(call)) return false;
      const b = builtinNamed(em, call.expression);
      return !!b && MAIN_CALLBACKS[`${b.module}.${b.name}`] === call.arguments.indexOf(n);
    }
    // Members of a class extending a main-thread iOS class: used on the main thread.
    if (
      (ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isAccessor(n)) &&
      inMainSubclass(em.ctx, n)
    )
      return true;
    // A Lucent class's implementation of a protocol requirement run on the main thread.
    if (ts.isMethodDeclaration(n)) return requirementOf(em.checker, n)?.main ?? false;
    if (ts.isFunctionLike(n)) return false;
  }
  return false;
}

/** A Lucent class instance where an SDK protocol is taken: the Objective-C object that forwards to it. */
export function nativeOfClass(
  em: FnEmitter,
  e: E,
  to: LType & { k: "native" },
  node: ts.Node | undefined,
): cpp.Expr {
  if (e.t.k !== "class") throw new Error("not a class instance");
  const info = em.reg.cls(e.t.id);
  const name = info.decl.name?.text ?? "class";
  // The platform would call its methods in module code, holding the Lucent lock, which views never take.
  if (node && setupOf(em.ctx, node))
    fail(
      node,
      Codes.ComponentContract,
      `a view gives the platform \`${name}\`, whose methods would run in module code (holding the Lucent lock), not on the view's main thread: give the platform a function instead`,
    );
  const adopted = sdkInterfacesOf(em.checker, info.decl).some(
    (p) => p.module === to.module && p.cls.name === to.name,
  );
  const swiftOnly = to.platform === "ios" && !!sdkTypeInfo("ios", to.module, to.name)?.swift;
  const based = !!info.sdkBase && extendsSdk(info.sdkBase, to);

  // Extending an Objective-C class: its generated subclass, which adopts its Objective-C protocols too.
  if (info.sdkBase?.platform === "ios" && (based || (adopted && !swiftOnly)))
    return subclassNative(e, info).c;
  if (based) return jni("wrap", jni("env"), javaSubclassOf(em, e, info), cpp.str(name));
  if (!adopted)
    fail(
      node,
      Codes.InterfaceNotImplemented,
      `class ${name} must declare \`implements ${to.name}\` to be used as ${to.name}`,
    );
  if (to.platform === "android")
    return jni("wrap", jni("env"), javaObjectOfClass(em, e, to, node), cpp.str(name));
  return cpp.call(`lucent_app::${swiftOnly ? "swiftObjectOf" : "objcObjectOf"}`, [e.c]);
}

/** The schema type of argument `index` of a call of an SDK method, constructor or function. */
function sdkParamType(
  em: FnEmitter,
  call: ts.CallExpression | ts.NewExpression,
  index: number,
): SdkType | undefined {
  if (index < 0) return undefined;
  const decl = em.checker.getResolvedSignature(call)?.declaration;
  if (!decl) return undefined;
  if (ts.isFunctionDeclaration(decl)) {
    const sdk = sdkModuleOf(decl.getSourceFile());
    const f = sdk
      ? findSdkModule(sdk.platform, sdk.module)?.functions?.find((x) => x.name === decl.name?.text)
      : undefined;
    return f?.params[index] && sdk ? parseSdkType(f.params[index].type, sdk.module) : undefined;
  }
  const declared = classOfDecl(decl);
  if (!declared) return undefined;
  const method = ts.isMethodDeclaration(decl) ? schemaMethod(declared, decl) : undefined;
  const ref = method?.ref ?? declared;
  const callable = method
    ? method.method
    : ts.isConstructorDeclaration(decl)
      ? schemaConstructor(ref, decl)
      : undefined;
  const p = callable?.params[index];
  return p
    ? parseSdkType(p.type, ref.module, (callable as SdkMethodSchema).typeParams ?? [])
    : undefined;
}

function requireMain(
  em: FnEmitter,
  node: ts.Node,
  ref: SdkClassRef,
  member?: { mainActor?: boolean; swift?: SwiftMember },
): void {
  if (!mainThreadOnly(ref.cls, member) || inMainContext(em, node)) return;
  fail(
    node,
    Codes.MainThreadOnly,
    `${ref.cls.name} can only be used on the main thread: call it inside main(() => …) from lucent:thread`,
  );
}

/** The codes of member-level refusals, by rule; a value that cannot cross is LUCENT2002. */
const REFUSAL_CODES: Record<string, Code> = {
  "read-only": Codes.UnsupportedAssignmentTarget,
  "no-setter": Codes.UnsupportedAssignmentTarget,
  "java-field-write": Codes.UnsupportedAssignmentTarget,
  "jvm-mangled-name": Codes.UnsupportedClassFeature,
  "async-initializer": Codes.UnsupportedSyntax,
  "associated-types": Codes.UnsupportedSyntax,
  "requirement-effects": Codes.UnsupportedClassFeature,
};

/**
 * The plan of a use of `member` (of `owner`, in `module`) in `role`: the
 * use fails, at `node`, with the plan's reason and where the declaration
 * comes from when no such use can work, and is noted among the SDK
 * symbols the compile uses when it can, as `declared` (the member the SDK
 * declares, when `member` is a form of it).
 */
export function requirePlan(
  node: ts.Node,
  of: { platform: Platform; module: string; cls?: SdkClassSchema },
  member: SdkMethodSchema | SdkPropertySchema | SdkCallable,
  role?: Role,
  declared: SdkMethodSchema | SdkPropertySchema | SdkCallable = member,
): BindingPlan {
  const plan = memberPlan(of.platform, of.module, of.cls, member, role);

  const why = explainRefusal(plan);
  if (why) {
    // A refused call breaks a rule of its own; a type that cannot cross yet can be wrapped.
    if (plan.refused) fail(node, REFUSAL_CODES[plan.refused.rule] ?? Codes.UnsupportedCall, why);
    fail(node, Codes.UnsupportedType, why, WRAP_UNBOUND[of.platform]);
  }

  noteSdkUse(of.platform, of.module, of.cls, declared, plan);
  return plan;
}

/**
 * Refuses a Lucent function (a block's, a requirement's implementation)
 * that takes one of the first `taken` values `offered` it cannot be given.
 */
export function requireTaken(
  node: ts.Node,
  plan: Pick<BindingPlan, "display" | "symbol" | "artifact">,
  offered: BindingPlan["inputs"],
  taken: number,
): void {
  const reason = takenReason(offered, taken);
  if (reason) fail(node, Codes.UnsupportedType, `${plan.display}: ${reason}${provenanceOf(plan)}`);
}

const VOID: SdkType = { k: "prim", name: "void", nullable: false };

/** A use of a Swift-only member (`m`) of a class (`ref`) or module. */
function swiftUse(
  node: ts.Node,
  of: SdkClassRef | { module: string },
  m: {
    swift?: SwiftMember;
    mainActor?: boolean;
    typeParams?: string[];
    params?: SdkParam[];
    since?: number | string;
  },
  role: SwiftUse["role"],
  params: SdkType[],
  ret: SdkType,
  what: string,
  isStatic = role === "init",
): SwiftUse {
  const owner = "cls" in of ? { owner: of.cls } : {};
  const mainActor = m.mainActor ?? ("cls" in of && !!of.cls.mainActor);
  // Default arguments Lucent has no value for are never given.
  const given = (m.params ?? []).map((p) => p.defaulted !== "omitted");
  const labels = swiftLabels(m.swift!.name).filter((_, i) => given[i] ?? true);
  const passed = params.filter((_, i) => given[i] ?? true);
  const optional = (m.params ?? []).filter((p) => p.defaulted === "optional").length;
  // The shim names its owner and member: it is available where both are.
  const since = ["cls" in of ? of.cls.since : undefined, m.since, swiftRuntimeSince(passed)].filter(
    (v): v is string => typeof v === "string" && !!needOf("ios", v),
  );
  return {
    node,
    module: of.module,
    ...owner,
    role,
    static: isStatic,
    member: m.swift!,
    params: passed,
    labels: role === "call" || role === "init" ? labels : [],
    required: passed.length - optional,
    ret,
    what,
    ...(mainActor ? { mainActor } : {}),
    ...(m.typeParams?.length ? { typeParams: m.typeParams } : {}),
    ...(since.length ? { since: since.sort(compareVersions).at(-1)! } : {}),
  };
}

/** Warns when blocking work (Android `@WorkerThread`) runs on the main thread. */
function warnBlocking(
  em: FnEmitter,
  node: ts.Node,
  ref: SdkClassRef,
  member: { name: string; worker?: boolean },
): void {
  if (!member.worker || !inMainContext(em, node)) return;
  em.ctx.warn(
    node,
    Codes.BlockingOnMain,
    `${ref.cls.name}.${member.name} blocks (@WorkerThread): call it outside main(() => …), on the Lucent thread`,
  );
}

function noteIncludes(em: FnEmitter, ref: SdkClassRef): void {
  const n = em.ctx.nativeUnit(em.opts.module);
  if (ref.platform === "ios") noteFramework(em, ref.module);
  else n.include("lucent/platform/android.h");
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

/**
 * An enum type's native name (from the module's names: no schema needed); a
 * Swift enum's values are its cases' indexes, NSIntegers to the glue.
 */
export function sdkEnum(platform: Platform, t: SdkType): { native: string } | undefined {
  if (t.k !== "ref") return undefined;
  const info = sdkTypeInfo(platform, t.module, t.name);
  if (info?.kind !== "enum") return undefined;
  return info.swift ? { native: "NSInteger" } : info;
}

/**
 * A C struct's schema (iOS), when `t` names one: from its module's names,
 * which hold most structs' fields, else from its schema.
 */
function sdkStruct(t: SdkType): SdkStructSchema | undefined {
  const info = t.k === "ref" ? sdkTypeInfo("ios", t.module, t.name) : undefined;
  if (t.k !== "ref" || info?.kind !== "struct") return undefined;
  if (info.fields)
    return { kind: "struct", name: t.name, native: info.native, fields: info.fields };
  const s = findSdkType("ios", t.module, t.name);
  return s?.kind === "struct" ? s : undefined;
}

const isBool = (t: SdkType) => t.k === "prim" && (t.name === "bool" || t.name === "boolean");

/** A native number's Lucent type: a bigint for a 64-bit integer (but a constant group's), else a number. */
export function primLt(t: SdkType): LType {
  if (isBool(t)) return T.boolean;

  return isBigIntType(t) ? T.bigint : T.number;
}

/** A 64-bit integer that is not a bigint: a constant group's (its plan's `exact`). */
const isGroupWide = (t: SdkType) => t.k === "prim" && isWideInteger(t.name) && !isBigIntType(t);

/**
 * A native number `code` of schema type `t` as its Lucent value (primLt):
 * a 64-bit integer as a bigint, exactly; a group's as a number, exactly
 * or RangeError; the others cast.
 */
export function numberFromNative(t: SdkType, code: cpp.Expr): cpp.Expr {
  // Braced: `BigInt(r_);` alone in a statement expression would declare r_.
  if (isBigIntType(t)) return cpp.construct(cpp.type("lucent::BigInt"), [code], true);

  return isGroupWide(t)
    ? cpp.call("lucent::exactNumber", [code])
    : cpp.staticCast(cpp.type("double"), code);
}

/**
 * A Lucent value `c` of schema type `t` (primLt) as the native number
 * `native`: a bigint exactly, or RangeError naming `what` (the parameter or
 * field); a group's number as WebIDL's [EnforceRange] long long; the
 * others as WebIDL's default conversion (lucent::toNativeNumber). A
 * boolean (a Swift Bool) is no number: it is cast.
 */
export function numberToNative(t: SdkType, native: cpp.Type, c: cpp.Expr, what: string): cpp.Expr {
  if (isBool(t)) return cpp.staticCast(native, c);
  if (isBigIntType(t)) return cpp.call("lucent::toNativeInteger", [c, cpp.str(what)], [native]);

  return isGroupWide(t)
    ? cpp.call("lucent::toExactInteger", [c], [native])
    : toNativeNumber(native, c);
}

/** A number `c` as the native number or enum `native`, defined for every value. */
export function toNativeNumber(native: cpp.Type, c: cpp.Expr): cpp.Expr {
  return cpp.call("lucent::toNativeNumber", [c], [native]);
}

/**
 * What an argument is for, as RangeErrors name it: `index of
 * NSArray.objectAtIndex` (the parameter's name, else its position).
 */
export function argumentWhat(em: FnEmitter, arg: ts.Expression): string {
  const call = arg.parent;
  if (!ts.isCallExpression(call) && !ts.isNewExpression(call)) return "a value";

  const i = call.arguments?.indexOf(arg) ?? -1;
  const decl = em.checker.getResolvedSignature(call)?.declaration;
  if (!decl || ts.isJSDocSignature(decl)) return `argument ${i + 1}`;

  const param = decl.parameters[i]?.name;
  const owner = ts.isClassLike(decl.parent) ? decl.parent.name?.text : undefined;
  const member = ts.isConstructorDeclaration(decl) ? "constructor" : decl.name?.getText();
  const of = [owner, member].filter(Boolean).join(".");

  return `${param && ts.isIdentifier(param) ? param.text : `argument ${i + 1}`} of ${of}`;
}

/**
 * A C struct value `c` as a Lucent object of struct type `lt`, field by
 * field; `depth` keeps nested structs' temporaries apart.
 */
function structFromObjc(
  em: FnEmitter,
  c: cpp.Expr,
  s: SdkStructSchema,
  module: string,
  lt: LType,
  depth = 0,
): cpp.Expr {
  const st = lt.k === "opt" ? lt.inner : lt;
  if (st.k !== "struct") throw new Error(`${s.name} lowers to ${st.k}, not an object type`);
  const info = em.reg.struct(st.id);
  const [sv, ov] = [`s${depth}_`, `o${depth}_`];
  const fields = s.fields.map((f) => {
    const ft = parseSdkType(f.type, module);
    const inner = sdkStruct(ft);
    const flt = info.fields.find((x) => x.name === f.name)!.type;
    const read = cpp.dot(cpp.id(sv), f.name);
    const v = inner
      ? structFromObjc(em, read, inner, ft.k === "ref" ? ft.module : module, flt, depth + 1)
      : isBool(ft)
        ? cpp.staticCast(cpp.type("bool"), read)
        : numberFromNative(ft, read);
    return cpp.exprStmt(cpp.assign(cpp.arrow(cpp.id(ov), cppIdent(f.name)), v));
  });
  const created = cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]);
  return cpp.statementExpr(
    [cpp.varDecl(cpp.auto, sv, c), cpp.varDecl(cpp.auto, ov, created), ...fields],
    cpp.id(ov),
  );
}

/** A Lucent object `c` as the C struct `s`, in field order. */
function structToObjc(c: cpp.Expr, s: SdkStructSchema, module: string): cpp.Expr {
  const fields = s.fields.map((f) => {
    const ft = parseSdkType(f.type, module);
    const inner = sdkStruct(ft);
    const v = cpp.arrow(c, cppIdent(f.name));
    if (inner) return structToObjc(v, inner, ft.k === "ref" ? ft.module : module);
    // The field's own C type: Swift's can differ (NSRange's NSUInteger fields are Int).
    return isBool(ft)
      ? yesNo(v)
      : numberToNative(
          ft,
          cpp.decltype(cpp.id(`${s.native}::${f.name}`)),
          v,
          `${s.name}.${f.name}`,
        );
  });
  return cpp.construct(cpp.type(s.native), fields, true);
}

const yesNo = (c: cpp.Expr) => cpp.conditional(c, cpp.id("YES"), cpp.id("NO"));

/** Objective-C (or CoreFoundation) type of a reference type, for casts. */
function objcRefType(t: SdkType & { k: "ref" }): cpp.Type {
  const info = sdkTypeInfo("ios", t.module, t.name);
  if (!info || info.kind === "enum")
    throw new Error(`unknown Objective-C type ${t.module}.${t.name}`);
  // Swift values are objects to the glue: Swift classes, or boxes.
  if (info.cf || info.swift) return cpp.type(info.cf ? info.native : "id");
  return info.kind === "protocol" ? cpp.protocol(info.native) : objcPointer(info.native);
}

const objcPointer = (name: string) => cpp.pointer(cpp.type(name));

/** The Objective-C type of a schema type, for block signatures. */
export function objcType(t: SdkType): cpp.Type {
  switch (t.k) {
    case "prim":
      return cpp.type(
        t.name === "void" ? "void" : isBool(t) ? "BOOL" : (OBJC_NUMBER[t.name] ?? "double"),
      );
    // CoreFoundation types as themselves (a block's signature must match exactly).
    case "string":
      return t.cf ? cpp.type("CFStringRef") : objcPointer("NSString");
    case "bytes":
      return t.cf ? cpp.type("CFDataRef") : objcPointer("NSData");
    case "date":
      return objcPointer("NSDate");
    case "id":
      return t.cf ? cpp.type("CFTypeRef") : cpp.type("id");
    case "tparam":
      return cpp.type("id");
    case "error":
      return objcPointer("NSError");
    case "array":
      return t.cf ? cpp.type("CFArrayRef") : objcPointer("NSArray");
    case "set":
      return objcPointer("NSSet");
    case "record":
      return t.cf ? cpp.type("CFDictionaryRef") : objcPointer("NSDictionary");
    case "ref": {
      const native = sdkEnum("ios", t)?.native ?? sdkStruct(t)?.native;
      return native ? cpp.type(native) : objcRefType(t);
    }
    case "fn":
      return cpp.blockType(objcType(t.ret), t.params.map(objcType));
    // A pointer a block receives (`BOOL *stop`).
    case "out":
      return cpp.pointer(objcType(t.of));
    default:
      throw new Error(`no Objective-C type for ${t.k}`);
  }
}

/** `lucent::objc::ifPresent(v, [&](const auto& x_) { return f(x_); })`: absent gives nil. */
export function ifPresent(v: cpp.Expr, f: (x: cpp.Expr) => cpp.Expr): cpp.Expr {
  const x = cpp.id("x_");
  const each = cpp.lambda(
    ["&"],
    [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "x_")],
    [cpp.ret(f(x))],
  );
  return cpp.call("lucent::objc::ifPresent", [v, each]);
}

/**
 * A Lucent function `f` (of type `lt`) as an Objective-C block. A block the
 * platform waits for (it returns a value, runs during the call, or on the
 * main thread) runs Lucent code right away, holding the lock; the others
 * queue it on the Lucent thread: its plan says which. The function takes
 * as many of the block's arguments as it declares, as JavaScript callbacks
 * do, and the plan refuses those it cannot be given; `use` is the member
 * the block is passed to, for messages.
 */
function objcBlock(
  em: FnEmitter,
  node: ts.Node,
  f: cpp.Expr,
  lt: LType,
  t: SdkType & { k: "fn" },
  use: Pick<BindingPlan, "display" | "symbol" | "artifact">,
): cpp.Expr {
  const fn = lt.k === "opt" ? lt.inner : lt;
  if (fn.k !== "fn") fail(node, Codes.UnsupportedType, "pass a function");

  const plan = blockConversion(t);
  if (plan.op !== "callback") throw new Error(`${use.display}: a block its plan refuses`);

  const n = Math.min(fn.params.length, t.params.length);
  requireTaken(node, use, plan.of!.slice(0, -1), n);

  const names = t.params.map((_, i) => `a${i}_`);
  const isVoid = t.ret.k === "prim" && t.ret.name === "void";
  const later = plan.delivery === "queued";
  // Pointers it receives (`BOOL *stop`): an Out each, written back once the function returns.
  const outs = t.params.slice(0, n).flatMap((p, i) => (p.k === "out" ? [i] : []));
  const args = names
    .slice(0, n)
    .map((a, i) =>
      outs.includes(i)
        ? cpp.id(`o${i}_`)
        : fromObjc(em, cpp.id(a), t.params[i]!, fn.params[i]!, "callback").c,
    );
  const call = cpp.call("f_", args);
  const before = outs.map((i) =>
    cpp.varDecl(cpp.auto, `o${i}_`, cpp.call("lucent::objc::outOf", [cpp.id(names[i]!)])),
  );
  const after = outs.map((i) =>
    cpp.exprStmt(cpp.call("lucent::objc::writeOut", [cpp.id(`o${i}_`), cpp.id(names[i]!)])),
  );
  const entry = callbackEntry(em, node);
  let body: cpp.Stmt[];
  if (!isVoid) {
    const r = cpp.id("r_");
    const result = t.ret.nullable
      ? ifPresent(r, (x) => toObjcExpr({ ...t.ret, nullable: false } as SdkType, x, false))
      : toObjcExpr(t.ret, r, false, "a callback's result");
    const now = cpp.lambda(["&"], [], [cpp.varDecl(cpp.auto, "r_", call), cpp.ret(result)], {
      ret: objcType(t.ret),
    });
    body = after.length
      ? [
          ...before,
          cpp.varDecl(objcType(t.ret), "b_", entry.now(now)),
          ...after,
          cpp.ret(cpp.id("b_")),
        ]
      : [cpp.ret(entry.now(now))];
  } else if (!later) {
    const now = cpp.lambda(["&"], [], [cpp.exprStmt(call)]);
    body = [...before, cpp.exprStmt(entry.now(now)), ...after];
  } else {
    const queued = cpp.lambda(["f_", ...names.slice(0, n)], [], [cpp.exprStmt(call)]);
    body = [cpp.exprStmt(entry.later(queued))];
  }
  const params = t.params.map((p, i) => cpp.param(objcType(p), names[i]));
  const block = cpp.lambda([{ name: "f_", init: f }], params, body);
  return cpp.call("lucent::objc::block", [block], [objcType({ ...t, nullable: false })]);
}

/** A generic lambda converting a collection's element (`e_`) to an object. */
function eachElement(of: SdkType): cpp.Expr {
  return cpp.lambda(
    ["&"],
    [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "e_")],
    [cpp.ret(boxed(of, cpp.id("e_")))],
    { ret: cpp.type("id") },
  );
}

/** `(__bridge T)x`: an Objective-C object as the toll-free bridged CoreFoundation type. */
const bridgeTo = (cf: string, x: cpp.Expr) => cpp.cast("bridge", cpp.type(cf), x);

/**
 * Lucent value → Objective-C value of schema type `t`, for `c` holding the
 * (non-absent) Lucent value. Collections convert their elements with a
 * generic lambda, so they accept any Lucent representation the checker allowed.
 */
export function toObjcExpr(t: SdkType, c: cpp.Expr, owned: boolean, what = "a value"): cpp.Expr {
  const objc = (fn: string, ...rest: cpp.Expr[]) => cpp.call(`lucent::objc::${fn}`, [c, ...rest]);
  switch (t.k) {
    case "prim":
      if (isBool(t)) return yesNo(c);
      return numberToNative(t, cpp.type(OBJC_NUMBER[t.name] ?? "double"), c, what);
    case "string":
      return t.cf ? bridgeTo("CFStringRef", objc("toNSString")) : objc("toNSString");
    case "bytes":
      return t.cf ? bridgeTo("CFDataRef", objc("toNSData")) : objc("toNSData");
    case "date":
      return objc("toNSDate");
    case "id":
      return t.cf ? bridgeTo("CFTypeRef", objc("toId")) : objc("toId");
    // A type parameter's value: an object, whatever the Lucent value is.
    case "tparam":
      return objc("toId");
    case "array": {
      const arr = objc("toNSArray", eachElement(t.of));
      return t.cf ? bridgeTo("CFArrayRef", arr) : arr;
    }
    case "set":
      return objc("toNSSet", eachElement(t.of));
    // A tuple (to a Swift shim): an array of its elements' objects.
    case "tuple": {
      const v = cpp.id("t_");
      return cpp.statementExpr(
        [cpp.varDecl(cpp.auto, "t_", c)],
        cpp.call(
          "lucent::objc::toNSArrayOf",
          t.of.map((x, i) => boxed(x, cpp.call("std::get", [v], [cpp.num(i)]))),
        ),
      );
    }
    case "record": {
      const dict = objc("toNSDictionary", eachElement(t.of));
      return t.cf ? bridgeTo("CFDictionaryRef", dict) : dict;
    }
    case "out":
      if (t.of.k === "error")
        return cpp.call(cpp.dot(cpp.construct(cpp.type("lucent::objc::ErrorOut"), [c]), "ptr"));
      return objc("outSlot", cpp.bool(owned));
    case "ref": {
      const e = sdkEnum("ios", t);
      if (e) return toNativeNumber(cpp.type(e.native), c);
      // A union (a Swift enum with payloads): the case's dictionary.
      if (isPayloadEnum(t)) return cpp.call("lucentSwiftObject", [c]);
      const s = sdkStruct(t);
      if (s) return structToObjc(c, s, t.module);
      const info = sdkTypeInfo("ios", t.module, t.name);
      // A protocol's value as `id`, which also goes where a declaration composes
      // it with NSObject (`NSObject<NSCopying> *`, read as the protocol).
      if (info?.kind === "protocol") return cpp.cast("c", cpp.type("id"), objc("unwrap"));
      return cpp.cast(info?.cf ? "bridge" : "c", objcRefType(t), objc("unwrap"));
    }
    default:
      throw new Error(`no Objective-C form for ${t.k}`);
  }
}

/** An element of an NSArray/NSDictionary: an object (numbers and booleans boxed). */
export function boxed(t: SdkType, c: cpp.Expr): cpp.Expr {
  if (t.k === "prim" || (t.k === "ref" && sdkEnum("ios", t)))
    return cpp.box(toObjcExpr(t, c, false, "an element"));
  if (t.k === "id") return cpp.call("lucent::objc::toId", [c]);
  return toObjcExpr({ ...t, nullable: false } as SdkType, c, false);
}

/**
 * Argument `arg` as the Objective-C value of schema type `t` a use of
 * `use` passes (its plan accepted it); `owned` when the call returns what
 * it writes through out-parameters owned.
 */
export function toObjc(
  em: FnEmitter,
  arg: ts.Expression,
  t: SdkType,
  use: Pick<BindingPlan, "display" | "symbol" | "artifact">,
  owned = false,
): cpp.Expr {
  if (t.k === "error") throw new Error(`${use.display}: an error its plan refuses`);
  if (t.k === "fn") {
    const f = em.expr(arg);
    // No block: `null` or `undefined` where the platform takes none.
    if (t.nullable && (f.t.k === "null" || f.t.k === "undefined")) return cpp.id("nil");
    if (!t.nullable) return objcBlock(em, arg, f.c, f.t, t, use);
    return ifPresent(f.c, (x) => objcBlock(em, arg, x, f.t, t, use));
  }
  const scalar = ((): LType | undefined => {
    switch (t.k) {
      case "prim":
        return primLt(t);
      case "string":
        return T.string;
      case "bytes":
        return T.bytes;
      case "date":
        return T.date;
      case "ref":
        return sdkEnum("ios", t)
          ? T.number
          : { k: "native", platform: "ios", module: t.module, name: t.name };
      default:
        return undefined;
    }
  })();
  if (t.k === "id" || t.k === "tparam") return toObjcExpr(t, em.expr(arg).c, owned);
  if (t.k === "out") return outArg(em, arg, t, owned);
  const what = argumentWhat(em, arg);
  const struct = sdkStruct(t);
  if (struct || t.k === "tuple") {
    const declared = em.checker.getContextualType(arg);
    const lt = declared ? em.reg.lower(declared, arg) : em.lt(arg);
    return toObjcExpr(t, em.exprAs(arg, lt), owned, what);
  }
  if (!t.nullable)
    return toObjcExpr(t, scalar ? em.exprAs(arg, scalar) : em.expr(arg).c, owned, what);
  const v = scalar ? em.exprAs(arg, unionOf([scalar, T.null])) : em.expr(arg).c;
  return ifPresent(v, (x) => toObjcExpr({ ...t, nullable: false } as SdkType, x, owned, what));
}

/**
 * An Out passed where a method takes a pointer: the helper that gives the
 * call a pointer of the right type, and moves the value between it and the
 * Out (before the call for inout ones, after it for all).
 */
function outArg(
  em: FnEmitter,
  arg: ts.Expression,
  t: SdkType & { k: "out" },
  owned: boolean,
): cpp.Expr {
  const out = em.expr(arg).c;
  const of = t.of;
  const ptr = (helper: cpp.Type, ...more: cpp.Expr[]) =>
    cpp.call(cpp.dot(cpp.construct(helper, [out, ...more]), "ptr"));
  const helper = (name: string, pointee: cpp.Type) => cpp.type(`lucent::objc::${name}`, pointee);
  if (of.k === "prim") return ptr(helper("NumberOut", objcType(of)));
  if (of.k === "ref" && sdkEnum("ios", of)) return ptr(helper("NumberOut", objcType(of)));
  const s = of.k === "ref" ? sdkStruct(of) : undefined;
  if (s && of.k === "ref") {
    const record = outTypeArgument(em, arg);
    if (record?.k !== "struct")
      fail(arg, Codes.UnsupportedType, `pass an Out of the ${of.name} object type`);
    const cls = cpp.type(`lucent_app::${em.reg.struct(record.id).cppName}`);
    const object = cpp.type("std::shared_ptr", cpp.type("lucent::Object"));
    const o = cpp.id("o_");
    const toC = cpp.lambda(
      [],
      [cpp.param(cpp.reference(cpp.constType(object)), "o_")],
      [cpp.ret(structToObjc(cpp.call("std::static_pointer_cast", [o], [cls]), s, of.module))],
      { ret: objcType(of) },
    );
    const fromC = cpp.lambda(
      [],
      [cpp.param(cpp.reference(cpp.constType(objcType(of))), "v_")],
      [cpp.ret(structFromObjc(em, cpp.id("v_"), s, of.module, record))],
      { ret: object },
    );
    return ptr(helper("StructOut", objcType(of)), toC, fromC);
  }
  // CoreFoundation out-parameters (`CFTypeRef *`) keep the slot's Create/Copy ownership.
  const cf =
    ("cf" in of && !!of.cf) || (of.k === "ref" && !!sdkTypeInfo("ios", of.module, of.name)?.cf);
  if (of.k === "error") return ptr(cpp.type("lucent::objc::ErrorOut"));
  if (cf) return toObjcExpr(t, out, owned);
  return ptr(helper("ObjectOut", objcType(of)));
}

/** The type argument of the Out passed as `arg` (`Out<NSRange>`), as a Lucent type. */
function outTypeArgument(em: FnEmitter, arg: ts.Expression): LType | undefined {
  const type = em.checker.getNonNullableType(em.checker.getTypeAtLocation(arg));
  const [t] = em.checker.getTypeArguments(type as ts.TypeReference);
  return t ? em.reg.lower(t, arg) : undefined;
}

/** Objective-C value `code` of schema type `t` → Lucent value of type `lt`. */
export function fromObjc(
  em: FnEmitter,
  code: cpp.Expr,
  t: SdkType,
  lt: LType,
  what: string,
  owned = false,
): E {
  const w = cpp.str(what);
  // A CoreFoundation value as an Objective-C object: owned ones handed to ARC.
  const bridged = (type: cpp.Type) => cpp.cast(owned ? "bridge_transfer" : "bridge", type, code);
  const objc = (fn: string, ...rest: cpp.Expr[]) => cpp.call(`lucent::objc::${fn}`, rest);
  const wrap = (o: cpp.Expr) =>
    lt.k === "opt" ? { c: objc("wrapOpt", o), t: lt } : { c: objc("wrap", o, w), t: lt };
  const elem = (x: LType): LType => (x.k === "opt" ? x.inner : x);
  switch (t.k) {
    case "prim":
      // A value, so optional chains can use it (`obj?.voidMethod()`).
      if (t.name === "void")
        return {
          c: cpp.statementExpr(
            [cpp.exprStmt(cpp.cast("c", cpp.voidType, code))],
            cpp.id("lucent::undefined"),
          ),
          t: T.undefined,
        };
      if (isBool(t)) return { c: cpp.staticCast(cpp.type("bool"), code), t: T.boolean };
      return { c: numberFromNative(t, code), t: primLt(t) };
    case "string": {
      const s = t.cf ? bridged(objcPointer("NSString")) : code;
      return t.nullable
        ? { c: objc("fromNSStringOpt", s), t: lt }
        : { c: objc("fromNSString", s, w), t: T.string };
    }
    case "bytes": {
      const d = t.cf ? bridged(objcPointer("NSData")) : code;
      return t.nullable
        ? { c: objc("fromNSDataOpt", d), t: lt }
        : { c: objc("fromNSData", d, w), t: T.bytes };
    }
    case "date":
      return t.nullable
        ? { c: objc("fromNSDateOpt", code), t: lt }
        : { c: objc("fromNSDate", code, w), t: T.date };
    case "id":
      return wrap(t.cf ? bridged(cpp.type("id")) : code);
    case "tparam":
      return { c: fromObjcObject(code, lt, what), t: lt };
    case "fn":
      return { c: fromObjcBlock(em, code, t, lt), t: lt };
    case "array":
    case "set":
    case "record": {
      const container = elem(lt);
      const itemLt =
        container.k === "array" || container.k === "set"
          ? container.e
          : container.k === "dict"
            ? container.val
            : undefined;
      if (!itemLt) throw new Error(`unexpected Lucent type for ${t.k}`);
      const itemType = em.reg.cppType(itemLt);
      const each = cpp.lambda(
        ["&"],
        [cpp.param(cpp.type("id"), "e_")],
        [cpp.ret(fromObjcItem(em, t.of, itemLt, what))],
        { ret: itemType },
      );
      const src =
        t.k !== "set" && t.cf
          ? bridged(objcPointer(t.k === "array" ? "NSArray" : "NSDictionary"))
          : code;
      const fn = { array: "fromNSArray", set: "fromNSSet", record: "fromNSDictionary" }[t.k];
      return t.nullable
        ? { c: cpp.call(`lucent::objc::${fn}Opt`, [src, each], [itemType]), t: lt }
        : { c: cpp.call(`lucent::objc::${fn}`, [src, each, w], [itemType]), t: container };
    }
    case "ref": {
      if (sdkEnum("ios", t)) return { c: cpp.staticCast(cpp.type("double"), code), t: T.number };
      if (isPayloadEnum(t)) return swiftUnionFromObjc(em, code, t, lt);
      const s = sdkStruct(t);
      if (s) return { c: structFromObjc(em, code, s, t.module, lt), t: lt };
      return wrap(sdkTypeInfo("ios", t.module, t.name)?.cf ? bridged(cpp.type("id")) : code);
    }
    case "error":
      return lt.k === "opt"
        ? { c: objc("fromNSErrorOpt", code), t: lt }
        : { c: objc("fromNSError", code, w), t: lt };
    // A tuple (from a Swift shim): the array of its elements' objects.
    case "tuple": {
      const tuple = elem(lt);
      if (tuple.k !== "tuple") throw new Error(`${what}: a tuple read as ${tuple.k}`);
      const items = t.of.map((x, i) => {
        const read = cpp.lambda(
          ["&"],
          [cpp.param(cpp.type("id"), "e_")],
          [cpp.ret(fromObjcItem(em, x, tuple.es[i]!, what))],
          { ret: em.reg.cppType(tuple.es[i]!) },
        );
        return cpp.call(read, [cpp.send(cpp.id("a_"), "objectAtIndex:", [cpp.num(i)])]);
      });
      return {
        c: cpp.statementExpr(
          [cpp.varDecl(objcPointer("NSArray"), "a_", cpp.cast("c", objcPointer("NSArray"), code))],
          cpp.construct(em.reg.cppType(tuple), items),
        ),
        t: tuple,
      };
    }
    default:
      throw new Error(`${what}: an Objective-C ${t.k} value its plan refuses`);
  }
}

/**
 * A block the platform passes (a completion handler) as a Lucent function
 * that calls it, converting the arguments as for any Objective-C call; nil
 * is absent. The function holds the block (ARC copies it off the stack).
 */
function fromObjcBlock(
  em: FnEmitter,
  code: cpp.Expr,
  t: SdkType & { k: "fn" },
  lt: LType,
): cpp.Expr {
  const fn = stripOpt(lt);
  if (fn.k !== "fn") throw new Error(`a block read as ${fn.k}`);
  if (t.params.some((p) => p.k === "fn"))
    throw new Error("a block taking blocks, which its plan refuses");
  const params = fn.params.map((p, i) => cpp.param(em.reg.cppType(p), `v${i}_`));
  // Arguments the Lucent function leaves out are nil (or zero).
  const args = t.params.map((p, i) => {
    const v = cpp.id(`v${i}_`);
    if (i >= params.length) return p.k === "prim" ? cpp.num(0) : cpp.nullptr;
    return p.nullable && p.k !== "prim"
      ? ifPresent(v, (x) => toObjcExpr({ ...p, nullable: false } as SdkType, x, false))
      : toObjcExpr(p, v, false, `argument ${i + 1} of a block`);
  });
  const call = cpp.call(cpp.id("b_"), args);
  const isVoid = t.ret.k === "prim" && t.ret.name === "void";
  const body = isVoid
    ? [cpp.exprStmt(call)]
    : [cpp.ret(fromObjc(em, call, t.ret, fn.ret, "a block's result").c)];
  const lambda = cpp.lambda(
    [{ name: "b_", init: cpp.cast("c", objcType({ ...t, nullable: false }), code) }],
    params,
    body,
    { ret: em.reg.cppRetType(fn.ret) },
  );
  const value = cpp.construct(em.reg.cppType(fn), [lambda]);
  if (lt.k !== "opt") return value;
  const optional = em.reg.cppType(lt);
  return cpp.conditional(
    code,
    cpp.construct(optional, [value]),
    cpp.construct(optional, [cpp.id("lucent::null")]),
  );
}

/** An element (`id e_`) of an NSArray/NSDictionary as a Lucent value. */
export function fromObjcItem(em: FnEmitter, t: SdkType, lt: LType, what: string): cpp.Expr {
  const w = cpp.str(what);
  const e = cpp.id("e_");
  const as = (cls: string) => cpp.cast("c", objcPointer(cls), e);
  const numberValue = (method: string) => cpp.send(as("NSNumber"), method);
  const wrap = () =>
    lt.k === "opt"
      ? cpp.call("lucent::objc::wrapOpt", [e])
      : cpp.call("lucent::objc::wrap", [e, w]);
  switch (t.k) {
    case "prim": {
      if (isBool(t)) return cpp.staticCast(cpp.type("bool"), numberValue("boolValue"));
      if (!isWideInteger(t.name)) return numberValue("doubleValue");

      // A 64-bit integer, exactly: NSNumber's doubleValue would round it.
      const unsigned = isUnsignedWide(t.name);
      return numberFromNative(t, numberValue(unsigned ? "unsignedLongLongValue" : "longLongValue"));
    }
    case "string":
      return cpp.call("lucent::objc::fromNSString", [as("NSString"), w]);
    case "bytes":
      return cpp.call("lucent::objc::fromNSData", [as("NSData"), w]);
    case "date":
      return cpp.call("lucent::objc::fromNSDate", [as("NSDate"), w]);
    case "ref":
      if (isPayloadEnum(t)) return swiftUnionFromObjc(em, e, t, lt).c;
      return sdkEnum("ios", t) ? numberValue("doubleValue") : wrap();
    case "id":
      return wrap();
    case "tparam":
      return fromObjcObject(e, lt, what);
    default:
      throw new Error(`${what}: ${t.k} elements, which its plan refuses`);
  }
}

/**
 * An object `o` that holds a type parameter's value (Objective-C erases them
 * to id) as the Lucent type its type argument gives: strings, numbers,
 * booleans, data and dates through the Any helpers, objects as they are. A
 * value that is absent, or of another class, throws TypeError unless `lt`
 * allows null.
 */
function fromObjcObject(o: cpp.Expr, lt: LType, what: string): cpp.Expr {
  const inner = stripOpt(lt);
  const as = ANY_HELPERS[inner.k];
  const opt = cpp.call("lucent::objc::wrapOpt", [o]);
  if (!as) return lt.k === "opt" ? opt : cpp.call("lucent::objc::wrap", [o, cpp.str(what)]);
  const value = cpp.call(`lucent::objc::${as}`, [opt]);
  return lt.k === "opt" ? value : cpp.call(cpp.dot(value, "get"));
}

/** lucent:ios's `as? T` helpers, by the Lucent type they give. */
const ANY_HELPERS: Partial<Record<LType["k"], string>> = {
  string: "asString",
  number: "asNumber",
  boolean: "asBoolean",
  bytes: "asData",
  date: "asDate",
};

/** `[receiver sel:a …]`, with the trailing `error:` of throwing methods taking `&err_`. */
function send(receiver: cpp.Expr, selector: string, args: cpp.Expr[], throws = false): cpp.Expr {
  return cpp.send(receiver, selector, throws ? [...args, cpp.addressOf(cpp.id("err_"))] : args);
}

/** A message send whose NSError** result becomes a thrown Lucent error. */
function throwing(message: cpp.Expr, out: (r: cpp.Expr) => E, ret: SdkType): E {
  const isVoid = ret.k === "prim" && ret.name === "void";
  const error = cpp.varDecl(
    cpp.pointer(cpp.type("NSError"), "__autoreleasing"),
    "err_",
    cpp.id("nil"),
  );
  const rethrow = cpp.exprStmt(cpp.call("lucent::objc::throwIfError", [cpp.id("err_")]));
  if (isVoid)
    return {
      c: cpp.statementExpr(
        [error, cpp.exprStmt(cpp.cast("c", cpp.voidType, message)), rethrow],
        cpp.id("lucent::undefined"),
      ),
      t: T.undefined,
    };
  const e = out(cpp.id("r_"));
  // Its declared type: `auto` would deduce id, which clang warns about.
  const result = cpp.varDecl(objcType({ ...ret, nullable: false } as SdkType), "r_", message);
  return { c: cpp.statementExpr([error, result, rethrow], e.c), t: e.t };
}

// --- Android -------------------------------------------------------------------------

const JNI_CALL: Record<string, string> = {
  V: "Void",
  Z: "Boolean",
  B: "Byte",
  C: "Char",
  S: "Short",
  I: "Int",
  J: "Long",
  F: "Float",
  D: "Double",
};
const JNI_PRIM: Record<string, string> = {
  boolean: "jboolean",
  byte: "jbyte",
  char: "jchar",
  short: "jshort",
  int: "jint",
  long: "jlong",
  float: "jfloat",
  double: "jdouble",
};

function jniKind(desc: string): string {
  return JNI_CALL[desc[0]!] ?? "Object";
}

const env = cpp.id("env");
/** `lucent::jni::name(args)`. */
const jni = (name: string, ...args: cpp.Expr[]) => cpp.call(`lucent::jni::${name}`, args);
/** `env->name(args)`: a JNIEnv function. */
const envCall = (name: string, ...args: cpp.Expr[]) => cpp.call(cpp.arrow(env, name), args);

function toJni(em: FnEmitter, ref: SdkClassRef, arg: ts.Expression, t: SdkType): cpp.Expr {
  return jniOf(em, arg, t, jniArgument(em, ref, arg, t));
}

/**
 * An argument where Java takes schema type `t`, evaluated as the Lucent
 * value jniOf converts (a class argument names its class: nothing to
 * evaluate).
 */
function jniArgument(em: FnEmitter, ref: SdkClassRef, arg: ts.Expression, t: SdkType): E {
  switch (t.k) {
    case "prim": {
      // A long is a bigint; other numbers and booleans as they are.
      const lt = primLt(t);
      return { c: em.exprAs(arg, lt), t: lt };
    }
    case "string": {
      const lt = t.nullable ? unionOf([T.string, T.null]) : T.string;
      return { c: em.exprAs(arg, lt), t: lt };
    }
    case "array": {
      const lt = declaredLt(em, ref.platform, { ...t, nullable: false }, arg);
      const typed = t.nullable ? unionOf([lt, T.null]) : lt;
      return { c: em.exprAs(arg, typed), t: typed };
    }
    case "classOf":
      return { c: cpp.id("lucent::undefined"), t: T.undefined };
    case "ref": {
      const lt: LType = { k: "native", platform: ref.platform, module: t.module, name: t.name };
      const value = em.expr(arg);
      if (value.t.k === "fn") return value;

      const typed = t.nullable ? unionOf([lt, T.null]) : lt;
      return { c: em.coerce(value, typed, arg), t: typed };
    }
    case "tparam":
    case "fn":
      // A function as it is (a Kotlin function made of it), or null.
      return em.expr(arg);
    default:
      throw new Error(`${t.k} values, which plans refuse over JNI`);
  }
}

/** The JNI value of `value`, an argument jniArgument evaluated, where Java takes `t`. */
function jniOf(em: FnEmitter, arg: ts.Expression, t: SdkType, value: E): cpp.Expr {
  switch (t.k) {
    case "prim": {
      if (t.name === "boolean")
        return cpp.staticCast(
          cpp.type("jboolean"),
          cpp.conditional(value.c, cpp.id("JNI_TRUE"), cpp.id("JNI_FALSE")),
        );
      // long (a bigint) takes it exactly; the others wrap as on iOS.
      return numberToNative(
        t,
        cpp.type(JNI_PRIM[t.name] ?? "jdouble"),
        value.c,
        argumentWhat(em, arg),
      );
    }
    case "string": {
      if (!t.nullable) return jni("toJString", env, value.c);
      const s = cpp.id("s_");
      return cpp.statementExpr(
        [cpp.varDecl(cpp.auto, "s_", value.c)],
        cpp.conditional(
          cpp.call(cpp.dot(s, "has")),
          jni("toJString", env, cpp.call(cpp.dot(s, "get"))),
          cpp.nullptr,
        ),
      );
    }
    case "array": {
      const what = argumentWhat(em, arg);
      if (t.list) return jniList(em, t, value, what);
      if (!t.nullable) return toJavaArray(em, t, value.c, what);

      const each = cpp.lambda(
        ["&"],
        [
          cpp.param(cpp.pointer(cpp.type("JNIEnv")), "env"),
          cpp.param(cpp.reference(cpp.constType(cpp.auto)), "a_"),
        ],
        [cpp.ret(cpp.staticCast(cpp.type("jobject"), toJavaArray(em, t, cpp.id("a_"), what)))],
      );
      return jni("toArrayOpt", env, value.c, each);
    }
    case "classOf": {
      const named = sdkClassNamed(em, arg);
      if (!named)
        fail(arg, Codes.UnsupportedSyntax, "pass the class itself (for example `Vibrator`)");
      requireAvailable(em, arg, named, named.cls.since, named.cls.name);
      // Looked up once per call site: findClass takes a lock and a lookup by name.
      return cpp.call("LUCENT_JNI_CLASS", [javaClass(em, named.cls.native)]);
    }
    case "ref":
      if (value.t.k === "fn") return javaProxy(em, arg, value, t);
      if (eitherMembers(value.t)) return jniEither(em, arg, t, value);
      return jni("unwrap", value.c);
    case "tparam":
      return toJavaObject(arg, value);
    case "fn":
      return toKotlinFunction(em, arg, t, value);
    default:
      throw new Error(`${t.k} values, which plans refuse over JNI`);
  }
}

/** A Lucent array `value` where Kotlin takes a read-only list: a new java.util.ArrayList, copied. */
function jniList(em: FnEmitter, t: SdkType & { k: "array" }, value: E, what: string): cpp.Expr {
  const array = stripOpt(value.t);
  const lt = array.k === "array" ? array : undefined;
  if (!t.nullable || value.t.k !== "opt") return toJavaList(em, t, value.c, lt, what);

  const each = cpp.lambda(
    ["&"],
    [
      cpp.param(cpp.pointer(cpp.type("JNIEnv")), "env"),
      cpp.param(cpp.reference(cpp.constType(cpp.auto)), "a_"),
    ],
    [cpp.ret(toJavaList(em, t, cpp.id("a_"), lt, what))],
  );
  return jni("toArrayOpt", env, value.c, each);
}

/**
 * A Lucent value where Java takes a type parameter (erased to an object):
 * SDK objects, strings and booleans. Numbers are not boxed, as Java's type
 * (Integer, Long, Double…) would be a guess.
 */
function toJavaObject(arg: ts.Expression, v: E): cpp.Expr {
  const jobject = cpp.type("jobject");
  if (arg.kind === ts.SyntaxKind.NullKeyword) return cpp.staticCast(jobject, cpp.nullptr);
  const inner = stripOpt(v.t);
  const opt = v.t.k === "opt";
  if (inner.k === "native") return jni("unwrap", v.c);
  if (inner.k === "string") {
    if (!opt) return cpp.staticCast(jobject, jni("toJString", env, v.c));
    const s = cpp.id("s_");
    const present = cpp.staticCast(jobject, jni("toJString", env, cpp.call(cpp.dot(s, "get"))));
    return cpp.statementExpr(
      [cpp.varDecl(cpp.auto, "s_", v.c)],
      cpp.conditional(cpp.call(cpp.dot(s, "has")), present, cpp.nullptr),
    );
  }
  if (inner.k === "boolean" && !opt) return jni("boxBoolean", env, v.c);
  fail(
    arg,
    Codes.UnsupportedType,
    "where Java takes a type parameter, pass an SDK object, a string or a boolean",
  );
}

/** A Java object `code` (a type parameter's value) as the Lucent type its use gives it. */
export function fromJavaObject(code: cpp.Expr, lt: LType, what: string, node: ts.Node): E {
  const inner = stripOpt(lt);
  const opt = lt.k === "opt";
  const w = cpp.str(what);
  const jstring = cpp.staticCast(cpp.type("jstring"), code);
  switch (inner.k) {
    case "native":
      return opt
        ? { c: jni("wrapOpt", env, code), t: lt }
        : { c: jni("wrap", env, code, w), t: lt };
    case "string":
      return opt
        ? { c: jni("fromJStringOpt", env, jstring), t: lt }
        : { c: jni("fromJString", env, jstring, w), t: inner };
    case "number":
    case "boolean": {
      const unbox = inner.k === "number" ? "unboxNumber" : "unboxBoolean";
      if (!opt) return { c: jni(unbox, env, code), t: inner };
      // Java null is absent.
      const o = cpp.id("o_");
      const optional = cpp.type("lucent::Opt", cpp.type(inner.k === "number" ? "double" : "bool"));
      return {
        c: cpp.statementExpr(
          [cpp.varDecl(cpp.type("jobject"), "o_", code)],
          cpp.conditional(
            o,
            cpp.construct(optional, [jni(unbox, env, o)]),
            cpp.construct(optional, [cpp.id("lucent::null")]),
          ),
        ),
        t: lt,
      };
    }
    default:
      fail(
        node,
        Codes.UnsupportedType,
        `${what} gives a type parameter's value, which Lucent reads as an SDK object, a string, a number or a boolean`,
      );
  }
}

/**
 * A Lucent function where Java takes an interface with one abstract method:
 * a NativeProxy (one per function and interface) implementing that method.
 */
function javaProxy(em: FnEmitter, arg: ts.Expression, f: E, t: SdkType & { k: "ref" }): cpp.Expr {
  const iface = findSdkType("android", t.module, t.name);
  const sam =
    iface?.kind === "class" && iface.functional
      ? iface.methods?.find((m) => m.name === iface.functional && m.abstract)
      : undefined;
  if (iface?.kind !== "class" || !sam)
    fail(
      arg,
      Codes.UnsupportedType,
      `${t.name} has more than one method to implement: pass an object of a class implementing it`,
    );
  const fv = cpp.id("f_");
  const entry = proxyEntry(
    em,
    arg,
    t.module,
    iface.name,
    sam,
    f.t as LType & { k: "fn" },
    "f_",
    (a) => cpp.call(fv, a),
  );
  const identity = cpp.call(cpp.dot(fv, "identity"));
  return cpp.statementExpr(
    [cpp.varDecl(cpp.auto, "f_", f.c)],
    jni("proxyFor", env, javaClass(em, iface.native), identity, cpp.initList([entry])),
  );
}

/**
 * One method of a proxy: `capture` is what it holds (the function or the
 * object). Its boxed arguments are converted on the calling thread (local
 * references do not outlive it), then the call is queued on the Lucent
 * thread, or, when Java waits for a result, made now holding the lock.
 */
function proxyEntry(
  em: FnEmitter,
  node: ts.Node,
  module: string,
  owner: string,
  m: SdkMethodSchema,
  fn: LType & { k: "fn" },
  capture: cpp.Capture,
  call: (args: cpp.Expr[]) => cpp.Expr,
): cpp.Expr {
  const params = m.params.map((p) => parseSdkType(p.type, module, m.typeParams ?? []));
  const n = Math.min(fn.params.length, params.length);

  // What the method is given and gives back, as a Lucent function implementing it.
  const cls = findSdkType("android", module, owner);
  if (cls?.kind !== "class") throw new Error(`${owner}.${m.name}: no class`);
  const plan = requirePlan(node, { platform: "android", module, cls }, m, "implement");
  requireTaken(node, plan, plan.inputs, n);

  const descriptor =
    m.descriptor ??
    jniDescriptor(
      m.params.map((p) => p.type),
      m.returns,
      m.typeParams,
    );

  const ret = parseSdkType(m.returns, module, m.typeParams ?? []);
  const what = `${owner}.${m.name}`;
  const suspend = !!m.kotlin?.suspend;

  // Value classes the JVM passes as their underlying values: boxed for Lucent, and back.
  const slots = descriptorSlots(descriptor);
  const result = unboxedSlot(ret, suspend ? undefined : slots.ret);
  const valueLt = suspend && fn.ret.k === "promise" ? fn.ret.inner : fn.ret;
  const box = (r: cpp.Expr): cpp.Expr =>
    result
      ? jni(
          "unboxValueClass",
          env,
          cpp.str(result.native),
          cpp.str(result.underlying),
          jni("unwrap", r),
        )
      : suspend && ret.k === "prim" && ret.name === "void"
        ? jni("unit", env)
        : boxJava(em, node, ret, r, what, valueLt);

  return proxyMethod(em, node, {
    key: `${m.java ?? m.name}${descriptor.slice(0, descriptor.indexOf(")") + 1)}`,
    params: params.slice(0, n),
    unboxed: params.slice(0, n).map((p, i) => unboxedSlot(p, slots.params[i])),
    box,
    queued: plan.delivery === "queued",
    // A suspend function's continuation comes after what it declares.
    ...(suspend ? { continuation: params.length } : {}),
    what,
    fn,
    capture,
    call,
  });
}

/** A JVM method descriptor's parameter and result types, as written (`I`, `Ljava/lang/String;`). */
function descriptorSlots(descriptor: string): { params: string[]; ret: string } {
  const slots = descriptor.match(/\[*(?:[ZBCSIJFDV]|L[^;]+;)/g) ?? [];
  return { params: slots.slice(0, -1), ret: slots.at(-1) ?? "V" };
}

/**
 * Where a value class crosses as its underlying value (its slot in the
 * descriptor is not the class): the class, and that value's descriptor.
 */
function unboxedSlot(
  t: SdkType,
  slot: string | undefined,
): { native: string; underlying: string } | undefined {
  if (t.k !== "ref" || !slot) return undefined;

  const cls = findSdkType("android", t.module, t.name);
  if (cls?.kind !== "class" || !cls.kotlin?.value) return undefined;

  return slot === `L${cls.native};` ? undefined : { native: cls.native, underlying: slot };
}

/**
 * A proxy method's `{ key, lambda }`, the call itself: its `params`
 * (those the Lucent function takes) converted from `args_`, `call` made
 * queued or now, and its result boxed by `box`.
 */
function proxyMethod(
  em: FnEmitter,
  node: ts.Node,
  m: {
    key: string;
    params: SdkType[];
    /** Value classes among `params` the JVM passes as their underlying values. */
    unboxed?: ({ native: string; underlying: string } | undefined)[];
    box: (result: cpp.Expr) => cpp.Expr;
    queued: boolean;
    /** A suspend function's: the index of its continuation among the arguments. */
    continuation?: number;
    what: string;
    fn: LType & { k: "fn" };
    capture: cpp.Capture;
    call: (args: cpp.Expr[]) => cpp.Expr;
  },
): cpp.Expr {
  const args = proxyArguments(em, node, m.params, m.fn, m.what, m.unboxed);
  const names = args.map((_, i) => `a${i}_`);
  const convert = args.map((a, i) => cpp.varDecl(cpp.auto, names[i]!, a));
  const holder = typeof m.capture === "string" ? m.capture : m.capture.name;
  const made = m.call(names.map(cpp.id));
  const jobject = cpp.type("jobject");
  const entry = callbackEntry(em, node);

  // A suspend function: the call is queued, and the continuation resumed once it settles.
  const resumed = (k: number): cpp.Stmt[] => {
    const resume = cpp.id("resume_");
    const boxValue = cpp.lambda(
      [],
      [
        cpp.param(cpp.pointer(cpp.type("JNIEnv")), "env"),
        cpp.param(cpp.reference(cpp.constType(cpp.auto)), "v_"),
      ],
      [cpp.ret(m.box(cpp.id("v_")))],
      { ret: jobject },
    );
    const run = cpp.lambda(
      [holder, ...names, "resume_"],
      [],
      [
        cpp.exprStmt(
          jni("resumeWithResult", resume, cpp.lambda(["&"], [], [cpp.ret(made)]), boxValue),
        ),
      ],
    );
    const start = cpp.lambda(
      [holder, ...names],
      [cpp.param(cpp.type("lucent::jni::Resume"), "resume_")],
      [cpp.exprStmt(entry.later(run))],
    );

    return [
      ...convert,
      cpp.ret(jni("suspendedCall", env, jni("arg", env, cpp.id("args_"), cpp.num(k)), start)),
    ];
  };

  const body: cpp.Stmt[] =
    m.continuation !== undefined
      ? resumed(m.continuation)
      : m.queued
        ? [
            ...convert,
            cpp.exprStmt(
              entry.later(
                cpp.lambda(
                  [holder, ...names],
                  [],
                  [cpp.exprStmt(cpp.cast("c", cpp.voidType, made))],
                ),
              ),
            ),
            cpp.ret(cpp.nullptr),
          ]
        : [
            ...convert,
            cpp.ret(
              entry.now(
                cpp.lambda(
                  ["&"],
                  [],
                  [cpp.varDecl(cpp.auto, "r_", made), cpp.ret(m.box(cpp.id("r_")))],
                  { ret: jobject },
                ),
              ),
            ),
          ];
  const method = cpp.lambda(
    [m.capture],
    [
      cpp.param(cpp.pointer(cpp.type("JNIEnv")), "env"),
      cpp.param(cpp.type("jobjectArray"), "args_"),
    ],
    body,
    { ret: jobject },
  );
  return cpp.initList([cpp.str(m.key), method]);
}

/** A proxy method's boxed arguments (`args_`), as the Lucent function `fn` takes them. */
function proxyArguments(
  em: FnEmitter,
  node: ts.Node,
  params: SdkType[],
  fn: LType & { k: "fn" },
  what: string,
  unboxed: ({ native: string; underlying: string } | undefined)[] = [],
): cpp.Expr[] {
  return params.map((p, i) => {
    const arg = jni("arg", env, cpp.id("args_"), cpp.num(i));
    if (p.k === "prim") return unboxedPrim(p, arg);

    // A value class's underlying value: its boxed object, as Lucent holds it.
    const v = unboxed[i];
    const a = v ? jni("boxValueClass", env, cpp.str(v.native), cpp.str(v.underlying), arg) : arg;
    return fromJni(em, a, p, fn.params[i]!, what, node).c;
  });
}

/**
 * A Lucent function `f` a Kotlin shim runs as a suspend function (see
 * `suspending`): a Kotlin function object (`kotlin.jvm.functions.FunctionN`)
 * whose invoke runs it while Kotlin waits, holding the Lucent lock. What
 * it throws ends the Kotlin call with that error. An async function is
 * refused: Kotlin would go on before its promise settles.
 */
function kotlinFunction(
  em: FnEmitter,
  arg: ts.Expression,
  f: E,
  runs: Suspending,
  what: string,
  site: string,
): cpp.Expr {
  const fn = f.t;
  if (fn.k !== "fn") throw new Error(`${what}: a Kotlin function made of a ${fn.k}`);
  if (stripOpt(fn.ret).k === "promise")
    fail(
      arg,
      Codes.UnsupportedCall,
      `${what}: an async function cannot run as a Kotlin suspend function yet: Kotlin would not wait for its promise`,
    );

  const n = Math.min(fn.params.length, runs.params.length);
  const args = proxyArguments(em, arg, runs.params.slice(0, n), fn, what);
  const names = args.map((_, i) => `a${i}_`);
  const made = cpp.call(cpp.id("f_"), names.map(cpp.id));
  const ret = runs.returns;

  // Its result as Kotlin takes it: an object as a new local reference, since r_ goes first.
  const result = (): cpp.Expr => {
    const r = cpp.id("r_");
    if (ret.k === "tparam") return boxJava(em, arg, ret, r, what, fn.ret);
    if (ret.k === "ref") return envCall("NewLocalRef", toJavaObjectOf(em, ret, r, fn.ret, what));

    return toJavaObjectOf(em, ret, r, fn.ret, what);
  };

  // Its arguments are read inside too: what fails there fails the Kotlin call.
  const run = cpp.lambda(
    ["&"],
    [],
    [
      ...args.map((a, i) => cpp.varDecl(cpp.auto, names[i]!, a)),
      ...(ret.k === "prim" && ret.name === "void"
        ? [cpp.exprStmt(cpp.cast("c", cpp.voidType, made)), cpp.ret(cpp.nullptr)]
        : [cpp.varDecl(cpp.auto, "r_", made), cpp.ret(result())]),
    ],
    { ret: cpp.type("jobject") },
  );
  const method = cpp.lambda(
    ["f_"],
    [
      cpp.param(cpp.pointer(cpp.type("JNIEnv")), "env"),
      cpp.param(cpp.type("jobjectArray"), "args_"),
    ],
    [cpp.ret(jni("callSuspending", env, run))],
    { ret: cpp.type("jobject") },
  );

  // One Kotlin function object per Lucent function and place: another place may read its arguments otherwise.
  const arity = runs.params.length;
  const key = `invoke(${"Ljava/lang/Object;".repeat(arity)})`;
  return cpp.statementExpr(
    [cpp.varDecl(cpp.auto, "f_", f.c)],
    jni(
      "proxyFor",
      env,
      javaClass(em, `kotlin/jvm/functions/Function${arity}`),
      cpp.call(cpp.dot(cpp.id("f_"), "identity")),
      cpp.initList([cpp.initList([cpp.str(key), method])]),
      cpp.str(site),
    ),
  );
}

/** The members of a union (absent or not) of objects and functions: what a fun interface's property is written. */
function eitherMembers(t: LType): LType[] | undefined {
  const inner = stripOpt(t);
  return inner.k === "union" && inner.ms.some((m) => m.k === "fn") ? inner.ms : undefined;
}

/**
 * A value written where Java takes interface `t`, an object or a function
 * (a fun interface's property): the object's reference, or a proxy calling
 * the function. Null, or an absent value, is null.
 */
function jniEither(
  em: FnEmitter,
  arg: ts.Expression,
  t: SdkType & { k: "ref" },
  value: E,
): cpp.Expr {
  const jobject = cpp.type("jobject");
  const present = (v: E): cpp.Expr => {
    const u = cpp.id("u_");
    const each = eitherMembers(v.t)!.map((m, i) => {
      const got: E = { c: cpp.call("std::get", [u], [cpp.num(i)]), t: m };

      return {
        test: cpp.binary(cpp.call(cpp.dot(u, "index")), "==", cpp.num(i)),
        c: cpp.staticCast(
          jobject,
          m.k === "fn" ? javaProxy(em, arg, got, t) : jni("unwrap", got.c),
        ),
      };
    });
    const chain = each
      .slice(0, -1)
      .reduceRight((rest: cpp.Expr, e) => cpp.conditional(e.test, e.c, rest), each.at(-1)!.c);

    return cpp.statementExpr([cpp.varDecl(cpp.auto, "u_", v.c)], chain);
  };

  return value.t.k === "opt" ? whenPresent(value, present) : present(value);
}

/** `value`, an optional, converted by `present` when it holds a value; null otherwise. */
function whenPresent(value: E, present: (v: E) => cpp.Expr): cpp.Expr {
  if (value.t.k !== "opt") throw new Error(`an optional value that is a ${value.t.k}`);

  const jobject = cpp.type("jobject");
  const o = cpp.id("o_");

  return cpp.statementExpr(
    [cpp.varDecl(cpp.auto, "o_", value.c)],
    cpp.conditional(
      cpp.call(cpp.dot(o, "has")),
      cpp.staticCast(jobject, present({ c: cpp.call(cpp.dot(o, "get")), t: value.t.inner })),
      cpp.staticCast(jobject, cpp.nullptr),
    ),
  );
}

/**
 * A Lucent function `value` where Kotlin takes function type `t`: a
 * `kotlin.jvm.functions.FunctionN` whose invoke calls it, queued on the
 * Lucent thread when it gives nothing, else now, holding the lock (in a
 * view's setup, on the main thread). It takes as many of the arguments as
 * it declares. Null, or an absent value, is null.
 */
function toKotlinFunction(
  em: FnEmitter,
  arg: ts.Expression,
  t: SdkType & { k: "fn" },
  value: E,
): cpp.Expr {
  if (value.t.k === "null" || value.t.k === "undefined") return cpp.nullptr;
  if (value.t.k === "opt") return whenPresent(value, (v) => toKotlinFunction(em, arg, t, v));

  const fn = value.t;
  if (fn.k !== "fn") fail(arg, Codes.UnsupportedType, "pass a function");

  const what = argumentWhat(em, arg);
  const plan = kotlinFunctionConversion(t);
  if (plan.op !== "callback") throw new Error(`${what}: a Kotlin function its plan refuses`);

  const n = Math.min(fn.params.length, t.params.length);
  requireTaken(arg, { display: what }, plan.of!.slice(0, -1), n);

  // Its result as Kotlin takes it: an object as a new local reference, since r_ goes first.
  const ret = t.ret;
  const box = (r: cpp.Expr): cpp.Expr => {
    if (ret.k === "tparam") return boxJava(em, arg, ret, r, what, fn.ret);
    if (ret.k === "ref") return envCall("NewLocalRef", toJavaObjectOf(em, ret, r, fn.ret, what));

    return toJavaObjectOf(em, ret, r, fn.ret, what);
  };
  const entry = proxyMethod(em, arg, {
    key: `invoke(${"Ljava/lang/Object;".repeat(t.params.length)})`,
    params: t.params.slice(0, n),
    box,
    queued: plan.delivery === "queued",
    what,
    fn,
    capture: "f_",
    call: (a) => cpp.call(cpp.id("f_"), a),
  });

  return cpp.statementExpr(
    [cpp.varDecl(cpp.auto, "f_", value.c)],
    jni(
      "proxyFor",
      env,
      javaClass(em, `kotlin/jvm/functions/Function${t.params.length}`),
      cpp.call(cpp.dot(cpp.id("f_"), "identity")),
      cpp.initList([entry]),
    ),
  );
}

/**
 * A Kotlin function Java gives (`kotlin.jvm.functions.FunctionN`, `code`)
 * as a Lucent function of type `lt` calling its invoke: its arguments
 * boxed, its result unboxed, a Java exception thrown as a Lucent error.
 * The function holds a global reference to it; null is absent.
 */
function fromKotlinFunction(
  em: FnEmitter,
  code: cpp.Expr,
  t: SdkType & { k: "fn" },
  lt: LType,
  what: string,
  node: ts.Node,
): cpp.Expr {
  const fn = stripOpt(lt);
  if (fn.k !== "fn") throw new Error(`${what}: a Kotlin function read as ${fn.k}`);

  const arity = t.params.length;
  const params = fn.params.map((p, i) => cpp.param(em.reg.cppType(p), `v${i}_`));
  // Arguments its Lucent type leaves out are null.
  const args = t.params.map((p, i) =>
    i < params.length ? toJavaObjectOf(em, p, cpp.id(`v${i}_`), fn.params[i], what) : cpp.nullptr,
  );
  const isVoid = t.ret.k === "prim" && t.ret.name === "void";
  const r = cpp.id("r_");
  const result = isVoid
    ? undefined
    : t.ret.k === "prim"
      ? unboxedPrim(t.ret, r)
      : fromJni(em, r, t.ret, fn.ret, `${what}'s result`, node).c;

  const call = envCall("CallObjectMethod", jni("unwrap", cpp.id("f_")), cpp.id("id_"), ...args);
  const body: cpp.Stmt[] = [
    cpp.varDecl(cpp.pointer(cpp.type("JNIEnv")), "env", jni("env")),
    cpp.varDecl(cpp.type("lucent::jni::LocalFrame"), "frame_", env, { style: "construct" }),
    cpp.varDecl(
      cpp.type("jclass"),
      "cls_",
      jni("findClass", javaClass(em, `kotlin/jvm/functions/Function${arity}`)),
      { static: true },
    ),
    cpp.varDecl(
      cpp.auto,
      "id_",
      jni(
        "method",
        cpp.id("cls_"),
        cpp.str("invoke"),
        javaDescriptor(em, `(${"Ljava/lang/Object;".repeat(arity)})Ljava/lang/Object;`),
      ),
      { static: true },
    ),
    cpp.varDecl(cpp.auto, "r_", call),
    cpp.exprStmt(jni("check", env)),
    ...(result ? [cpp.ret(result)] : []),
  ];
  const lambda = cpp.lambda(
    [{ name: "f_", init: jni("wrap", env, code, cpp.str(what)) }],
    params,
    body,
    { ret: em.reg.cppRetType(fn.ret) },
  );
  const value = cpp.construct(em.reg.cppType(fn), [lambda]);
  if (lt.k !== "opt") return value;

  const optional = em.reg.cppType(lt);
  return cpp.conditional(
    code,
    cpp.construct(optional, [value]),
    cpp.construct(optional, [cpp.id("lucent::null")]),
  );
}

/** Whether SDK class `base` is `to` or extends it. */
function extendsSdk(base: LType & { k: "native" }, to: LType & { k: "native" }): boolean {
  for (let t: { module: string; name: string } | undefined = base; t;) {
    if (t.module === to.module && t.name === to.name) return true;
    const cls = findSdkType(base.platform, t.module, t.name);
    const up =
      cls?.kind === "class" && cls.extends ? parseSdkType(cls.extends, t.module) : undefined;
    t = up?.k === "ref" ? up : undefined;
  }
  return false;
}

/** The methods of a Lucent class `info` that implement `methods` of SDK type `owner`, as proxy entries. */
function implementedEntries(
  em: FnEmitter,
  info: ClassInfo,
  methods: { module: string; owner: string; method: SdkMethodSchema }[],
): cpp.Expr[] {
  const entries: cpp.Expr[] = [];
  const self = cpp.id("s_");
  for (const { module, owner, method } of methods) {
    const impl = info.decl.members.find(
      (x): x is ts.MethodDeclaration =>
        ts.isMethodDeclaration(x) &&
        ts.isIdentifier(x.name) &&
        x.name.text === method.name &&
        !!x.body,
    );
    if (!impl) continue;
    const fn = em.reg.lowerSignature(
      em.checker.getSignatureFromDeclaration(impl)!,
      impl,
    ) as LType & { k: "fn" };
    entries.push(
      proxyEntry(em, impl, module, owner, method, fn, { name: "s_", init: cpp.id("o_") }, (a) =>
        cpp.call(cpp.arrow(self, cppIdent(method.name)), a),
      ),
    );
  }
  em.ctx.nativeUnit(em.opts.module).include("lucent/platform/android.h");
  return entries;
}

/**
 * An instance of a Lucent class extending an SDK class: its generated Java
 * subclass (one per instance while Java holds it), whose overrides call the
 * methods the Lucent class defines.
 */
function javaSubclassOf(em: FnEmitter, e: E, info: ClassInfo): cpp.Expr {
  const entries = implementedEntries(
    em,
    info,
    sdkInstanceMethods(info.sdkBase!).map(({ module, cls, method }) => ({
      module,
      owner: cls.name,
      method,
    })),
  );
  const o = cpp.id("o_");
  return cpp.statementExpr(
    [cpp.varDecl(cpp.auto, "o_", e.c)],
    jni(
      "subclassFor",
      jni("env"),
      cpp.str(javaSubclassName(info)),
      cpp.call(cpp.dot(o, "get")),
      cpp.initList(entries),
    ),
  );
}

/**
 * A Lucent class instance where Java takes an interface it implements: a
 * NativeProxy (one per instance and interface) implementing the methods
 * the class defines; the others keep their Java default.
 */
function javaObjectOfClass(
  em: FnEmitter,
  e: E,
  to: LType & { k: "native" },
  node: ts.Node | undefined,
): cpp.Expr {
  if (e.t.k !== "class") throw new Error("not a class instance");
  const info = em.reg.cls(e.t.id);
  const iface = findSdkType("android", to.module, to.name);
  if (iface?.kind !== "class" || !iface.interface)
    fail(node, Codes.UnsupportedType, `Lucent classes cannot extend ${to.name} yet`);
  const entries = implementedEntries(
    em,
    info,
    (iface.methods ?? [])
      .filter((m) => !m.static)
      .map((method) => ({ module: to.module, owner: iface.name, method })),
  );
  const o = cpp.id("o_");
  return cpp.statementExpr(
    [cpp.varDecl(cpp.auto, "o_", e.c)],
    jni(
      "proxyFor",
      jni("env"),
      javaClass(em, iface.native),
      cpp.call(cpp.dot(o, "get")),
      cpp.initList(entries),
    ),
  );
}

/** A Lucent result `c` as the boxed object a proxy method returns. */
function boxJava(
  em: FnEmitter,
  node: ts.Node,
  t: SdkType,
  c: cpp.Expr,
  what: string,
  lt?: LType,
): cpp.Expr {
  if (t.k === "string") return jni("toJString", env, c);
  if (t.k === "tparam") {
    const inner = lt ? stripOpt(lt) : undefined;
    // A new local reference: the Lucent value holding the global one goes away first.
    if (inner?.k === "native") return envCall("NewLocalRef", jni("unwrap", c));
    if (inner?.k === "string" && lt!.k !== "opt") return jni("toJString", env, c);
    if (inner?.k === "boolean" && lt!.k !== "opt") return jni("boxBoolean", env, c);

    fail(
      node,
      Codes.UnsupportedType,
      `${what} returns a type parameter's value: Lucent functions return an SDK object, a string or a boolean there`,
    );
  }
  // An object: a new local reference, as for a type parameter's.
  if (t.k === "ref") return envCall("NewLocalRef", toJavaObjectOf(em, t, c, lt, what));
  if (t.k !== "prim") throw new Error(`${what}: a ${t.k} result its plan refuses`);

  return boxedForJava(t, c, `${what}'s result`);
}

/**
 * LUCENT3008 for arguments known at compile time (literals and constants, and
 * the elements of array literals) that are not among the constants their
 * parameter's @IntDef or @StringDef allows. A warning: Java compiles it too.
 */
function warnOutsideGroups(
  em: FnEmitter,
  params: SdkParam[],
  args: readonly ts.Expression[],
  what: string,
): void {
  params.forEach((p, i) => {
    const arg = args[i];
    if (!p.oneOf || !arg) return;
    const allowed = p.oneOf.map(constantValue);
    if (allowed.some((v) => v === undefined)) return;
    const values = ts.isArrayLiteralExpression(arg) ? arg.elements : [arg];
    for (const v of values) {
      const t = em.checker.getTypeAtLocation(v);
      const known = t.isNumberLiteral() || t.isStringLiteral() ? t.value : undefined;
      if (known === undefined || allowed.includes(known)) continue;
      em.ctx.warn(
        v,
        Codes.ConstantOutsideGroup,
        `${JSON.stringify(known)} is not one of the constants ${what} takes here: ${p.oneOf
          .map((r) => r.split(".").slice(-2).join("."))
          .join(", ")}`,
      );
    }
  });
}

/** The value of an SDK constant named `package.Class.FIELD`. */
function constantValue(ref: string): number | string | boolean | undefined {
  const dot = ref.lastIndexOf(".");
  const owner = parseSdkType(ref.slice(0, dot));
  if (owner.k !== "ref") return undefined;
  const cls = findSdkType("android", owner.module, owner.name);
  return cls?.kind === "class"
    ? cls.properties?.find((p) => p.name === ref.slice(dot + 1) && p.static)?.value
    : undefined;
}

/** A Java class the glue names (JNI), as a C++ string; recorded for the app's shrinker to keep. */
export function javaClass(em: FnEmitter, internal: string): cpp.Expr {
  em.ctx.javaClasses.add(internal);
  return cpp.str(internal);
}

/**
 * A member's JNI descriptor, as a C++ string. The classes it names are
 * recorded for the app's shrinker to keep: a renamed one changes the
 * descriptor, and JNI finds no such member.
 */
export function javaDescriptor(em: FnEmitter, desc: string): cpp.Expr {
  for (const [, internal] of desc.matchAll(/L([^;]+);/g)) em.ctx.javaClasses.add(internal!);
  return cpp.str(desc);
}

/** byte[] ↔ Uint8Array, String[] ↔ string[], int[]/long[] ↔ number[]: copied. */
function jniArray(
  t: SdkType & { k: "array" },
): { name: string; cast: string; lt: LType } | undefined {
  const of = t.of;
  if (of.k === "string" && !of.charSequence)
    return { name: "StringArray", cast: "jobjectArray", lt: { k: "array", e: T.string } };
  if (of.k !== "prim") return undefined;
  if (of.name === "byte") return { name: "ByteArray", cast: "jbyteArray", lt: T.bytes };
  if (of.name === "int")
    return { name: "IntArray", cast: "jintArray", lt: { k: "array", e: T.number } };
  if (of.name === "long")
    return { name: "LongArray", cast: "jlongArray", lt: { k: "array", e: T.bigint } };
  const numbers: LType = { k: "array", e: T.number };
  if (of.name === "boolean")
    return { name: "BooleanArray", cast: "jbooleanArray", lt: { k: "array", e: T.boolean } };
  const name = `${of.name[0]!.toUpperCase()}${of.name.slice(1)}Array`;
  return JNI_PRIM[of.name] ? { name, cast: `j${of.name}Array`, lt: numbers } : undefined;
}

/**
 * A Lucent value `c` as the Java reference an element of an object array
 * takes (arrays of arrays too): the plan refused the other elements.
 */
function toJavaElement(em: FnEmitter, t: SdkType, c: cpp.Expr, what: string): cpp.Expr {
  switch (t.k) {
    case "ref":
      return jni("unwrap", c);
    case "string":
      return cpp.staticCast(cpp.type("jobject"), jni("toJString", env, c));
    case "array":
      return t.list ? toJavaList(em, t, c, undefined, what) : toJavaArray(em, t, c, what);
    default:
      throw new Error(`${t.k} elements, which plans refuse over JNI`);
  }
}

/** A Lucent array `c` as a Java array of schema type `t`, copied; `what` it is, for errors. */
function toJavaArray(
  em: FnEmitter,
  t: SdkType & { k: "array" },
  c: cpp.Expr,
  what: string,
): cpp.Expr {
  const named = jniArray(t);
  // A long[]'s elements are bigints, each exactly or RangeError.
  if (named?.name === "LongArray") return jni("toLongArray", env, c, cpp.str(what));
  if (named) return jni(`to${named.name}`, env, c);

  const each = cpp.lambda(
    ["&"],
    [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "e_")],
    [cpp.ret(toJavaElement(em, t.of, cpp.id("e_"), what))],
    { ret: cpp.type("jobject") },
  );
  return jni("toObjectArray", env, c, javaElementClass(em, t.of), each);
}

/** The class of a Java array's elements, as FindClass takes it (`[I` for arrays). */
function javaElementClass(em: FnEmitter, t: SdkType): cpp.Expr {
  const desc = jniDescriptor([], { ...t, nullable: false }).slice(2);
  if (desc.startsWith("[")) return javaDescriptor(em, desc);

  return javaClass(em, desc.slice(1, -1));
}

/** A Java reference `code`, an element of an object array, as the Lucent value of type `lt`. */
function fromJavaElement(
  em: FnEmitter,
  t: SdkType,
  code: cpp.Expr,
  lt: LType,
  what: string,
  node: ts.Node,
): cpp.Expr {
  if (t.k === "array")
    return t.list
      ? fromJavaList(em, t, code, lt, what, node)
      : fromJavaArray(em, t, code, lt, what, node);

  return fromJni(em, code, t, lt, what, node).c;
}

/** A Java array `code` (not null) of schema type `t` as the Lucent array `lt`, copied. */
function fromJavaArray(
  em: FnEmitter,
  t: SdkType & { k: "array" },
  code: cpp.Expr,
  lt: LType,
  what: string,
  node: ts.Node,
): cpp.Expr {
  const w = cpp.str(what);
  const named = jniArray(t);
  if (named) return jni(`from${named.name}`, env, cpp.staticCast(cpp.type(named.cast), code), w);

  const array = stripOpt(lt);
  if (array.k !== "array") throw new Error(`${what}: a Java array read as ${array.k}`);

  const item = em.reg.cppType(array.e);
  const each = cpp.lambda(
    ["&"],
    [cpp.param(cpp.type("jobject"), "e_")],
    [cpp.ret(fromJavaElement(em, t.of, cpp.id("e_"), array.e, what, node))],
    { ret: item },
  );
  return cpp.call(
    "lucent::jni::fromObjectArray",
    [env, cpp.staticCast(cpp.type("jobjectArray"), code), each, w],
    [item],
  );
}

// --- Kotlin's read-only lists --------------------------------------------------------

const BOX: Record<string, string> = {
  boolean: "boxBoolean",
  byte: "boxByte",
  char: "boxChar",
  short: "boxShort",
  int: "boxInt",
  long: "boxLong",
  float: "boxFloat",
  double: "boxDouble",
};

/** A number or boolean `c` boxed as the Java class Kotlin's primitive `t` is; `what` it is, for errors. */
function boxedForJava(t: SdkType & { k: "prim" }, c: cpp.Expr, what: string): cpp.Expr {
  const box = BOX[t.name];
  if (!box) throw new Error(`${t.name} values, which Java does not box`);
  if (t.name === "boolean" || t.name === "double") return jni(box, env, c);

  return jni(box, env, numberToNative(t, cpp.type(JNI_PRIM[t.name]!), c, what));
}

/**
 * A Lucent value `c` of type `lt` (its Lucent type, when known) as a Java
 * reference of schema type `t`, as a copied list holds its elements or a
 * Kotlin function gives its result: numbers and booleans boxed as Kotlin's
 * type says, null for null. An object is the reference the Lucent value
 * holds.
 */
function toJavaObjectOf(
  em: FnEmitter,
  t: SdkType,
  c: cpp.Expr,
  lt: LType | undefined,
  what: string,
): cpp.Expr {
  const jobject = cpp.type("jobject");
  if (lt?.k === "opt") {
    const o = cpp.id("o_");
    const present = toJavaObjectOf(
      em,
      { ...t, nullable: false },
      cpp.call(cpp.dot(o, "get")),
      stripOpt(lt),
      what,
    );
    return cpp.statementExpr(
      [cpp.varDecl(cpp.auto, "o_", c)],
      cpp.conditional(
        cpp.call(cpp.dot(o, "has")),
        cpp.staticCast(jobject, present),
        cpp.staticCast(jobject, cpp.nullptr),
      ),
    );
  }

  switch (t.k) {
    case "prim":
      return boxedForJava(t, c, what);
    case "string":
      return cpp.staticCast(jobject, jni("toJString", env, c));
    case "ref":
      return jni("unwrap", c);
    case "array": {
      const inner = lt?.k === "array" ? lt : undefined;
      return t.list
        ? toJavaList(em, t, c, inner, what)
        : cpp.staticCast(jobject, toJavaArray(em, t, c, what));
    }
    case "tparam": {
      const inner = lt ? stripOpt(lt) : undefined;
      if (inner?.k === "native") return jni("unwrap", c);
      if (inner?.k === "string") return cpp.staticCast(jobject, jni("toJString", env, c));
      if (inner?.k === "boolean") return jni("boxBoolean", env, c);
      throw new Error(
        "a type parameter's value other than an object, a string or a boolean in a list",
      );
    }
    default:
      throw new Error(`${t.k} elements, which plans refuse over JNI`);
  }
}

/** A Lucent array `c` (of type `lt`, when known) as a new java.util.ArrayList of schema type `t`, copied. */
function toJavaList(
  em: FnEmitter,
  t: SdkType & { k: "array" },
  c: cpp.Expr,
  lt: (LType & { k: "array" }) | undefined,
  what: string,
): cpp.Expr {
  if (!lt && t.of.nullable)
    throw new Error("a list of nullable elements whose Lucent type is unknown");

  const element = lt?.e;
  const each = cpp.lambda(
    ["&"],
    [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "e_")],
    [cpp.ret(toJavaObjectOf(em, t.of, cpp.id("e_"), element, what))],
    { ret: cpp.type("jobject") },
  );
  return jni("toList", env, c, each);
}

/**
 * A Java reference `code`, an element of a copied list, as the Lucent value
 * of type `lt`: boxed numbers and booleans unboxed, null where Kotlin's
 * element type allows it; a null element where it does not throws TypeError.
 */
function fromJavaListElement(
  em: FnEmitter,
  t: SdkType,
  code: cpp.Expr,
  lt: LType,
  what: string,
  node: ts.Node,
): cpp.Expr {
  const w = cpp.str(what);
  const nullable = lt.k === "opt";
  const item = stripOpt(lt);

  const present = ((): cpp.Expr => {
    switch (t.k) {
      case "prim":
        return unboxedPrim(t, code);
      case "array":
        return t.list
          ? fromJavaList(em, t, code, item, what, node)
          : fromJavaArray(em, t, code, item, what, node);
      default:
        return fromJni(em, code, { ...t, nullable: false }, item, what, node).c;
    }
  })();

  const checked = cpp.statementExpr(
    [cpp.ifStmt(cpp.not(code), [cpp.exprStmt(jni("returnedNull", w))])],
    present,
  );
  if (!nullable) return t.k === "prim" ? checked : present;

  const optional = em.reg.cppType(lt);
  return cpp.conditional(
    code,
    cpp.construct(optional, [present]),
    cpp.construct(optional, [cpp.id("lucent::null")]),
  );
}

/** A java.util.List `code` (not null) of schema type `t` as the Lucent array `lt`, copied. */
function fromJavaList(
  em: FnEmitter,
  t: SdkType & { k: "array" },
  code: cpp.Expr,
  lt: LType,
  what: string,
  node: ts.Node,
): cpp.Expr {
  const array = stripOpt(lt);
  if (array.k !== "array") throw new Error(`${what}: a Java list read as ${array.k}`);

  const item = em.reg.cppType(array.e);
  const each = cpp.lambda(
    ["&"],
    [cpp.param(cpp.type("jobject"), "e_")],
    [cpp.ret(fromJavaListElement(em, t.of, cpp.id("e_"), array.e, what, node))],
    { ret: item },
  );
  return cpp.call("lucent::jni::fromList", [env, code, each, cpp.str(what)], [item]);
}

function fromJni(
  em: FnEmitter,
  code: cpp.Expr,
  t: SdkType,
  lt: LType,
  what: string,
  node: ts.Node,
): E {
  const w = cpp.str(what);
  switch (t.k) {
    case "prim":
      if (t.name === "void") return { c: code, t: T.undefined };
      if (t.name === "boolean")
        return { c: cpp.binary(code, "==", cpp.id("JNI_TRUE")), t: T.boolean };
      return { c: numberFromNative(t, code), t: primLt(t) };
    case "string": {
      if (t.charSequence)
        return t.nullable
          ? { c: jni("charSequenceToStringOpt", env, code), t: lt }
          : { c: jni("charSequenceToString", env, code, w), t: T.string };
      const s = cpp.staticCast(cpp.type("jstring"), code);
      return t.nullable
        ? { c: jni("fromJStringOpt", env, s), t: lt }
        : { c: jni("fromJString", env, s, w), t: T.string };
    }
    case "array": {
      if (t.list) return fromJniList(em, code, t, lt, what, node);

      const array = cpp.staticCast(cpp.type(jniArray(t)?.cast ?? "jobjectArray"), code);
      if (!t.nullable) return { c: fromJavaArray(em, t, array, lt, what, node), t: lt };

      const inner = stripOpt(lt);
      const each = cpp.lambda(
        ["&"],
        [
          cpp.param(cpp.pointer(cpp.type("JNIEnv")), "env"),
          cpp.param(cpp.type(jniArray(t)?.cast ?? "jobjectArray"), "a_"),
          cpp.param(cpp.pointer(cpp.constType(cpp.type("char"))), "w_"),
        ],
        [cpp.ret(fromJavaArray(em, t, cpp.id("a_"), inner, what, node))],
        { ret: em.reg.cppType(inner) },
      );
      return {
        c: cpp.call("lucent::jni::fromArrayOpt", [env, array, each], [em.reg.cppType(inner)]),
        t: lt,
      };
    }
    case "ref":
      return lt.k === "opt"
        ? { c: jni("wrapOpt", env, code), t: lt }
        : { c: jni("wrap", env, code, w), t: lt };
    case "tparam":
      return fromJavaObject(code, lt, what, node);
    case "fn":
      return { c: fromKotlinFunction(em, code, t, lt, what, node), t: lt };
    default:
      throw new Error(`unsupported Java result type ${t.k}`);
  }
}

/** A copied list's result `code` as the Lucent array `lt` (absent for a null list that may be null). */
function fromJniList(
  em: FnEmitter,
  code: cpp.Expr,
  t: SdkType & { k: "array" },
  lt: LType,
  what: string,
  node: ts.Node,
): E {
  if (!t.nullable) return { c: fromJavaList(em, t, code, lt, what, node), t: lt };

  const inner = stripOpt(lt);
  const each = cpp.lambda(
    ["&"],
    [
      cpp.param(cpp.pointer(cpp.type("JNIEnv")), "env"),
      cpp.param(cpp.type("jobject"), "a_"),
      cpp.param(cpp.pointer(cpp.constType(cpp.type("char"))), "w_"),
    ],
    [cpp.ret(fromJavaList(em, t, cpp.id("a_"), inner, what, node))],
    { ret: em.reg.cppType(inner) },
  );
  return {
    c: cpp.call("lucent::jni::fromArrayOpt", [env, code, each], [em.reg.cppType(inner)]),
    t: lt,
  };
}

/**
 * One JNI call: class and member IDs are looked up once per call site, local
 * references are freed, and a pending Java exception becomes a Lucent error.
 * `access` makes the call with the member ID; `pre` runs first (the receiver).
 */
function jniCall(
  em: FnEmitter,
  opts: {
    cls: SdkClassSchema;
    lookup: string;
    name: string;
    desc: string;
    access: (id: cpp.Expr) => cpp.Expr;
    ret: SdkType;
    lt: LType;
    what: string;
    node: ts.Node;
    pre?: cpp.Stmt[];
  },
): E {
  const result = opts.ret.k === "prim" && opts.ret.name === "void";
  const out = fromJni(em, cpp.id("r_"), opts.ret, opts.lt, opts.what, opts.node);
  const id = cpp.id("id_");
  const body: cpp.Stmt[] = [
    cpp.varDecl(cpp.pointer(cpp.type("JNIEnv")), "env", jni("env")),
    ...(opts.pre ?? []),
    cpp.varDecl(cpp.type("lucent::jni::LocalFrame"), "frame_", env, { style: "construct" }),
    cpp.varDecl(cpp.type("jclass"), "cls_", jni("findClass", javaClass(em, opts.cls.native)), {
      static: true,
    }),
    cpp.varDecl(
      cpp.auto,
      "id_",
      jni(opts.lookup, cpp.id("cls_"), cpp.str(opts.name), javaDescriptor(em, opts.desc)),
      { static: true },
    ),
    result ? cpp.exprStmt(opts.access(id)) : cpp.varDecl(cpp.auto, "r_", opts.access(id)),
    cpp.exprStmt(jni("check", env)),
    cpp.ret(result ? cpp.id("lucent::undefined") : out.c),
  ];
  // Void calls are values too, so optional chains can use them.
  const ret = result ? cpp.type("lucent::Undefined") : em.reg.cppType(out.t);
  return { c: cpp.call(cpp.lambda(["&"], [], body, { ret })), t: result ? T.undefined : out.t };
}

function argsOf(node: ts.CallExpression | ts.NewExpression): readonly ts.Expression[] {
  const args = node.arguments ?? ts.factory.createNodeArray();
  if (args.some(ts.isSpreadElement))
    fail(node, Codes.UnsupportedSyntax, "spread arguments are not supported in SDK calls");
  return args;
}

// --- availability --------------------------------------------------------------------

/** An OS version an API needs: an Android API level, or an iOS `major.minor`. */
interface Need {
  platform: Platform;
  version: string;
}

/** What `since` asks of the running OS, when it is above the oldest supported one. */
function needOf(platform: Platform, since: number | string | undefined): Need | undefined {
  // Android levels are numbers, iOS versions `major.minor` strings.
  if (typeof since !== (platform === "android" ? "number" : "string")) return undefined;

  const version = String(since);
  const oldest = platform === "ios" ? oldestIos() : String(MIN_ANDROID_API);
  return compareVersions(version, oldest) > 0 ? { platform, version } : undefined;
}

/** `available("ios", 16, 2)`'s arguments for a version: its minor left out when 0. */
function availableArgs(need: Need): string {
  const [major, minor] = need.version.split(".");
  return minor && minor !== "0" ? `${major}, ${minor}` : `${major}`;
}

/**
 * APIs newer than the minimum must be used where the code has checked the
 * OS: under `if (available("ios", 16))`, `if (available("android", N))`,
 * `Build_VERSION.SDK_INT >= N`, their `?:` / `&&` forms, or after an early
 * exit on the opposite check.
 */
export function requireAvailable(
  em: FnEmitter,
  node: ts.Node,
  ref: { platform: Platform },
  since: number | string | undefined,
  what: string,
): void {
  const need = needOf(ref.platform, since);
  if (!need || guarded(em, node, need)) return;

  fail(
    node,
    Codes.Unavailable,
    need.platform === "ios"
      ? `${what} needs iOS ${need.version} (apps run from iOS ${oldestIos()}): use it under if (available("ios", ${availableArgs(need)}))`
      : `${what} needs API ${need.version} (apps run from API ${MIN_ANDROID_API}): use it under if (available("android", ${need.version})) or Build_VERSION.SDK_INT >= ${need.version}`,
  );
}

/** A member used at `node`: it, and its class when used statically, must exist on the oldest OS. */
function requireAvailableUse(
  em: FnEmitter,
  node: ts.Node,
  ref: SdkClassRef,
  member: { name: string; since?: number | string },
  obj: E | undefined,
): void {
  if (!obj) requireAvailable(em, node, ref, ref.cls.since, ref.cls.name);
  requireAvailable(em, node, ref, member.since, `${ref.cls.name}.${member.name}`);
}

/**
 * The running OS's API level: android.os.Build.VERSION.SDK_INT, by its
 * native identity (a fixed platform fundamental, as the NDK's
 * android_get_device_api_level is), whatever Lucent names it.
 */
const API_LEVEL = "jvm:android/os/Build$VERSION#SDK_INT:I";

function apiLevelRead(em: FnEmitter, e: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(e)) return false;

  const decl = resolved(em, e)?.valueDeclaration;
  const ref = decl && ts.isPropertyDeclaration(decl) ? classOfDecl(decl) : undefined;
  return !!ref?.cls.properties?.some((p) => p.symbol === API_LEVEL && p.name === e.name.text);
}

function literal(e: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(e)) return Number(e.text);
  return undefined;
}

/** The version an `available(platform, …)` call checks for, with literal arguments. */
function checkedVersion(em: FnEmitter, c: ts.CallExpression, platform: Platform) {
  const b = builtinNamed(em, c.expression);
  if (b?.module !== `lucent:${platform}` || b.name !== "available") return undefined;

  const [major, minor] = c.arguments.slice(1).map(literal);
  if (major === undefined || (c.arguments.length > 2 && minor === undefined)) return undefined;
  return minor === undefined ? `${major}` : `${major}.${minor}`;
}

/** `cond` true ⇒ the OS is at least what `need` asks. */
function atLeast(em: FnEmitter, cond: ts.Expression, need: Need): boolean {
  const c = ts.skipPartiallyEmittedExpressions(cond);
  if (ts.isParenthesizedExpression(c)) return atLeast(em, c.expression, need);
  if (ts.isCallExpression(c)) {
    const version = checkedVersion(em, c, need.platform);
    return version !== undefined && compareVersions(version, need.version) >= 0;
  }
  if (!ts.isBinaryExpression(c)) return false;
  const op = c.operatorToken.kind;
  if (op === ts.SyntaxKind.AmpersandAmpersandToken)
    return atLeast(em, c.left, need) || atLeast(em, c.right, need);
  if (need.platform !== "android") return false;
  const n = Number(need.version);
  const k = literal(c.right) ?? literal(c.left);
  if (k === undefined) return false;
  if (apiLevelRead(em, c.left))
    return (
      (op === ts.SyntaxKind.GreaterThanEqualsToken && k >= n) ||
      (op === ts.SyntaxKind.GreaterThanToken && k + 1 >= n)
    );
  if (apiLevelRead(em, c.right))
    return (
      (op === ts.SyntaxKind.LessThanEqualsToken && k >= n) ||
      (op === ts.SyntaxKind.LessThanToken && k + 1 >= n)
    );
  return false;
}

/** `cond` true ⇒ the OS is below what `need` asks. */
function below(em: FnEmitter, cond: ts.Expression, need: Need): boolean {
  const c = ts.skipPartiallyEmittedExpressions(cond);
  if (ts.isParenthesizedExpression(c)) return below(em, c.expression, need);
  if (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken)
    return atLeast(em, c.operand, need);
  if (!ts.isBinaryExpression(c)) return false;
  const op = c.operatorToken.kind;
  if (op === ts.SyntaxKind.BarBarToken) return below(em, c.left, need) || below(em, c.right, need);
  if (need.platform !== "android") return false;
  const n = Number(need.version);
  const k = literal(c.right) ?? literal(c.left);
  if (k === undefined) return false;
  if (apiLevelRead(em, c.left))
    return (
      (op === ts.SyntaxKind.LessThanToken && k >= n) ||
      (op === ts.SyntaxKind.LessThanEqualsToken && k + 1 >= n)
    );
  if (apiLevelRead(em, c.right))
    return (
      (op === ts.SyntaxKind.GreaterThanToken && k >= n) ||
      (op === ts.SyntaxKind.GreaterThanEqualsToken && k + 1 >= n)
    );
  return false;
}

function exits(s: ts.Statement): boolean {
  if (ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isBreakOrContinueStatement(s))
    return true;
  if (ts.isBlock(s))
    return s.statements.length > 0 && exits(s.statements[s.statements.length - 1]!);
  return false;
}

function guarded(em: FnEmitter, node: ts.Node, need: Need): boolean {
  for (let child: ts.Node = node, p = node.parent; p; child = p, p = p.parent) {
    if (ts.isIfStatement(p)) {
      if (child === p.thenStatement && atLeast(em, p.expression, need)) return true;
      if (child === p.elseStatement && below(em, p.expression, need)) return true;
    }
    if (ts.isConditionalExpression(p)) {
      if (child === p.whenTrue && atLeast(em, p.condition, need)) return true;
      if (child === p.whenFalse && below(em, p.condition, need)) return true;
    }
    if (ts.isBinaryExpression(p) && child === p.right) {
      if (
        p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        atLeast(em, p.left, need)
      )
        return true;
      if (p.operatorToken.kind === ts.SyntaxKind.BarBarToken && below(em, p.left, need))
        return true;
    }
    if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
      const stmts = p.statements as ts.NodeArray<ts.Statement>;
      for (const s of stmts) {
        if (s === child) break;
        if (
          ts.isIfStatement(s) &&
          !s.elseStatement &&
          exits(s.thenStatement) &&
          below(em, s.expression, need)
        )
          return true;
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
export function declaredLt(em: FnEmitter, platform: Platform, t: SdkType, node: ts.Node): LType {
  const opt = (x: LType) => (t.nullable ? unionOf([x, T.null]) : x);
  switch (t.k) {
    case "prim":
      if (t.name === "void") return T.undefined;
      return opt(primLt(t));
    case "string":
      return opt(T.string);
    case "bytes":
      return opt(T.bytes);
    case "date":
      return opt(T.date);
    case "id":
      return opt({ k: "native", platform: "ios", module: "lucent:ios", name: "NSObject" });
    case "array":
      if (t.of.k === "prim" && t.of.name === "byte" && !t.list) return opt(T.bytes);
      // Elements of a type parameter: as the resolved signature gives them.
      if (holdsTypeParam(t))
        return declaredLt(em, platform, { k: "tparam", name: "", nullable: false }, node);
      // A list's elements may be null where Kotlin's type says so; an array's are not.
      return opt({
        k: "array",
        e: declaredLt(
          em,
          platform,
          t.list ? t.of : ({ ...t.of, nullable: false } as SdkType),
          node,
        ),
      });
    case "record":
      return opt({
        k: "dict",
        val: declaredLt(em, platform, { ...t.of, nullable: false } as SdkType, node),
      });
    case "ref":
      if (sdkEnum(platform, t)) return opt(T.number);
      if (sdkStruct(t)) return em.lt(node);
      return opt({ k: "native", platform, module: t.module, name: t.name });
    default: {
      const sig = ts.isCallExpression(node) ? em.checker.getResolvedSignature(node) : undefined;
      const ret = sig
        ? em.checker.getReturnTypeOfSignature(sig)
        : em.checker.getTypeAtLocation(node);
      return em.reg.lower(ret, node);
    }
  }
}

function holdsTypeParam(t: SdkType): boolean {
  return t.k === "tparam" || (t.k === "array" && holdsTypeParam(t.of));
}

/**
 * `super(…)` in a Lucent class extending an Objective-C class: the base's
 * initializer the call resolves to, sent to a new instance of `subclass`
 * (the generated class standing for the Lucent one). An `id`.
 */
export function iosSuperInit(
  em: FnEmitter,
  node: ts.CallExpression,
  base: LType & { k: "native" },
  subclass: string,
): cpp.Expr {
  const decl = em.checker.getResolvedSignature(node)?.declaration;
  const ref = decl ? classOfDecl(decl) : undefined;
  if (!ref || !decl || !ts.isConstructorDeclaration(decl))
    fail(node, Codes.UnsupportedCall, `${base.name} cannot be constructed`);

  const ctor = schemaConstructor(ref, decl);
  if (ctor.swift)
    fail(
      node,
      Codes.UnsupportedClassFeature,
      `${base.name}: Swift initializers cannot be inherited`,
    );
  if (ctor.factory)
    fail(
      node,
      Codes.UnsupportedClassFeature,
      `${base.name}: ${ctor.selector} makes its own object (a class method Swift imports as an initializer), so a subclass cannot call it as super(…): call another of ${base.name}'s initializers`,
    );

  const plan = requirePlan(node, ref, ctor, "new");
  requireAvailable(em, node, ref, ctor.since, `new ${base.name}(…)`);
  noteIncludes(em, ref);

  const params = ctor.params.map((p) => parseSdkType(p.type, ref.module));
  const args = argsOf(node).map((x, i) => toObjc(em, x, params[i]!, plan));
  return send(cpp.send(subclass, "alloc"), ctor.selector ?? "init", args);
}

/** `new C(…)` of an SDK class. */
export function nativeNew(em: FnEmitter, node: ts.NewExpression, t: LType & { k: "native" }): E {
  if (t.module === "lucent:ios" && t.name === "Out") {
    em.ctx.nativeUnit(em.opts.module).include("lucent/platform/ios.h");
    return { c: cpp.call("lucent::objc::makeOut"), t };
  }
  const sig = em.checker.getResolvedSignature(node);
  const decl = sig?.declaration;
  let ref = decl ? classOfDecl(decl) : undefined;
  if (!ref || !decl || !ts.isConstructorDeclaration(decl))
    fail(node, Codes.UnsupportedCall, `${t.name} cannot be constructed`);
  requireMain(em, node, ref);
  const ctor = schemaConstructor(ref, decl);
  const plan = requirePlan(node, ref, ctor, "new");
  const params = ctor.params.map((p) => parseSdkType(p.type, ref!.module));
  // An inherited initializer allocates the class being constructed.
  const own = findSdkType(t.platform, t.module, t.name);
  if (own?.kind === "class" && own !== ref.cls) ref = { ...ref, module: t.module, cls: own };
  requireAvailable(em, node, ref, ref.cls.since, t.name);
  requireAvailable(em, node, ref, ctor.since, `new ${t.name}(…)`);
  const args = argsOf(node);
  if (ctor.swift) {
    requireAvailable(em, node, ref, swiftRuntimeSince(params), `new ${t.name}(…)`);
    const self: SdkType = { k: "ref", module: ref.module, name: ref.cls.name, nullable: false };
    const use = swiftUse(node, ref, ctor, "init", params, self, `new ${t.name}`);
    return swiftCall(em, use, undefined, args);
  }
  noteIncludes(em, ref);
  if (ref.platform === "ios") {
    const a = args.map((x, i) => toObjc(em, x, params[i]!, plan));
    // A C function Swift imports as an initializer: it creates the object, owned.
    if (ctor.cFunction) {
      const made = cpp.cast("bridge_transfer", cpp.type("id"), cpp.call(ctor.cFunction.name, a));
      return { c: cpp.call("lucent::objc::wrap", [made, cpp.str(`new ${t.name}`)]), t };
    }
    // A factory initializer is a class method: sent to the class, which makes the object.
    const receiver = ctor.factory ? cpp.id(ref.cls.native) : cpp.send(ref.cls.native, "alloc");
    const created = send(receiver, ctor.selector ?? "init", a);
    return { c: cpp.call("lucent::objc::wrap", [created, cpp.str(`new ${t.name}`)]), t };
  }
  warnOutsideGroups(em, ctor.params, args, `new ${t.name}`);
  const self: SdkType = { k: "ref", module: ref.module, name: ref.cls.name, nullable: false };
  const given = givenParams(em, `new ${t.name}`, ctor.params, args);
  if (throughKotlin(plan, given))
    return kotlinCall(em, {
      node,
      ref,
      member: ctor,
      role: "new",
      given,
      returns: self,
      lt: t,
      what: `new ${t.name}`,
    });

  const a = args.map((x, i) => toJni(em, ref, x, params[i]!));
  const desc =
    ctor.descriptor ??
    jniDescriptor(
      ctor.params.map((p) => p.type),
      "void",
    );
  return jniCall(em, {
    node,
    cls: ref.cls,
    lookup: "method",
    name: "<init>",
    desc,
    access: (id) => envCall("NewObject", cpp.id("cls_"), id, ...a),
    ret: { k: "ref", module: ref.module, name: ref.cls.name, nullable: false },
    lt: t,
    what: `new ${t.name}`,
  });
}

/** `C.member` where C is an SDK class, or an SDK enum member. */
export function nativeStaticProperty(
  em: FnEmitter,
  node: ts.PropertyAccessExpression,
): E | undefined {
  const sym = resolved(em, node);
  const decl = sym?.valueDeclaration;
  if (!decl) return undefined;
  if (ts.isEnumMember(decl) && sdkModuleOf(decl.getSourceFile())) {
    // Hand-written enum values are checked against the SDK headers at compile time.
    const sdk = sdkModuleOf(decl.getSourceFile())!;
    const e = findSdkType(sdk.platform, sdk.module, (decl.parent as ts.EnumDeclaration).name.text);
    const value = em.checker.getConstantValue(decl);
    // A Swift enum's values are its cases' indexes, which the shims convert: nothing to check.
    if (e?.kind === "enum" && !e.swift && sdk.platform === "ios" && typeof value === "number") {
      const c = e.cases.find((x) => x.name === decl.name.getText())!;
      noteFramework(em, sdk.module);
      em.ctx.nativeUnit(em.opts.module).add(`${e.name}.${c.name}`, [
        {
          k: "staticAssert",
          test: cpp.binary(cpp.id(c.native), "==", cpp.num(value)),
          message: `${e.name}.${c.name} in the ${sdk.module} binding schema`,
        },
      ]);
    }
    return undefined;
  }
  if (!isSdkPropertyDecl(decl)) return undefined;
  const ref = classOfDecl(decl);
  if (!ref || !ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword))
    return undefined;
  const found = schemaProperty(ref, decl)!;
  return readProperty(em, node, found.ref, found.property, undefined);
}

/** `out.value`: what the method wrote, as the Out's type argument says (absent before). */
function outValue(em: FnEmitter, obj: E, node: ts.Node): E {
  const value = em.lt(node);
  const inner = stripOpt(value);
  const t = unionOf([inner, T.null]);
  const objc = (fn: string, ...args: cpp.Expr[]) => cpp.call(`lucent::objc::${fn}`, args);
  switch (inner.k) {
    case "error":
      return { c: objc("outError", obj.c), t };
    case "number":
      return { c: objc("outNumber", obj.c), t };
    case "bigint":
      return { c: objc("outBigInt", obj.c), t };
    case "boolean":
      return { c: objc("outBool", obj.c), t };
    case "struct":
      return {
        c: cpp.call(
          "lucent::objc::outRecord",
          [obj.c],
          [cpp.type(`lucent_app::${em.reg.struct(inner.id).cppName}`)],
        ),
        t,
      };
  }
  const as = ANY_HELPERS[inner.k];
  if (as) return { c: objc(as, objc("outValue", obj.c)), t };
  return {
    c: objc("outValue", obj.c),
    t: inner.k === "native" ? t : unionOf([NS_OBJECT, T.null]),
  };
}

const NS_OBJECT: LType = { k: "native", platform: "ios", module: "lucent:ios", name: "NSObject" };

/** `obj.member` on an SDK object. */
export function nativeMember(em: FnEmitter, obj: E, node: ts.Node): E {
  const name = ts.isPropertyAccessExpression(node) ? node.name : node;
  if (
    obj.t.k === "native" &&
    obj.t.module === "lucent:ios" &&
    obj.t.name === "Out" &&
    ts.isIdentifier(name) &&
    name.text === "value"
  ) {
    return outValue(em, obj, name.parent);
  }
  const decl = resolved(em, name)?.valueDeclaration;
  const ref = decl ? classOfDecl(decl) : undefined;
  if (!ref || !decl || !isSdkPropertyDecl(decl))
    fail(node, Codes.UnsupportedSyntax, "methods of platform objects must be called directly");
  const found = schemaProperty(ref, decl)!;
  return readProperty(em, node, found.ref, found.property, obj);
}

/** A property read: it calls the getter, so it needs the getter's permissions. */
function readProperty(
  em: FnEmitter,
  node: ts.Node,
  ref: SdkClassRef,
  prop: SdkPropertySchema,
  obj: E | undefined,
): E {
  notePermissions(em, accessorOf(ref.cls, prop, "get"));
  return property(em, node, ref, prop, obj);
}

function property(
  em: FnEmitter,
  node: ts.Node,
  ref: SdkClassRef,
  prop: SdkPropertySchema,
  obj: E | undefined,
): E {
  // Compile-time constants need no call, and exist on every API level; a long's are exact.
  if (prop.value !== undefined && isBigIntType(parseSdkType(prop.type, ref.module)))
    return { c: bigintExpr(BigInt(prop.value)), t: T.bigint };
  if (typeof prop.value === "number") return { c: numberExpr(prop.value), t: T.number };
  if (typeof prop.value === "string") return { c: stringExpr(prop.value), t: T.string };
  if (typeof prop.value === "boolean") return { c: cpp.bool(prop.value), t: T.boolean };
  const plan = requirePlan(node, ref, prop, "get");
  requireMain(em, node, ref, prop);
  warnBlocking(em, node, ref, prop);
  requireAvailableUse(em, node, ref, prop, obj);
  const t = parseSdkType(prop.type, ref.module);
  const what = `${ref.cls.name}.${prop.name}`;
  if (prop.swift)
    return swiftCall(em, swiftUse(node, ref, prop, "get", [], t, what, !obj), obj, []);
  noteIncludes(em, ref);
  const lt = declaredLt(em, ref.platform, t, node);
  if (ref.platform === "ios") {
    if (prop.global) return fromObjc(em, cpp.id(prop.global), t, lt, what);
    // A C getter Swift imports as the property: of the object, or of none for a static one.
    if (prop.cFunctions)
      return fromObjc(
        em,
        cpp.call(prop.cFunctions.getter, obj ? [cfReceiver(ref, obj)] : []),
        t,
        lt,
        what,
      );
    const read = send(objcReceiver(ref, obj), prop.selector ?? prop.name, []);
    return fromObjc(em, read, t, lt, what);
  }
  const getter = accessorOf(ref.cls, prop, "get");
  if (plan.backend === "kotlin-shim")
    return kotlinCall(em, {
      node,
      ref,
      member: prop,
      role: "get",
      obj,
      given: [],
      returns: t,
      lt,
      what,
    });
  if (prop.getter) {
    const desc = getter?.descriptor ?? jniDescriptor([], prop.type);
    const recv = obj ? jni("unwrap", cpp.id("recv_")) : cpp.id("cls_");
    return jniCall(em, {
      node,
      cls: ref.cls,
      lookup: obj ? "method" : "staticMethod",
      name: prop.getter,
      desc,
      access: (id) =>
        envCall(`Call${obj ? "" : "Static"}${jniKind(desc.slice(2))}Method`, recv, id),
      ret: t,
      lt,
      what,
      pre: obj ? [cpp.varDecl(cpp.auto, "recv_", obj.c)] : [],
    });
  }
  const sig = jniDescriptor([], prop.type).slice(2);
  const kind = jniKind(sig);
  return jniCall(em, {
    node,
    cls: ref.cls,
    lookup: obj ? "field" : "staticField",
    name: prop.name,
    desc: sig,
    access: (id) =>
      obj
        ? envCall(`Get${kind}Field`, jni("unwrap", cpp.id("recv_")), id)
        : envCall(`GetStatic${kind}Field`, cpp.id("cls_"), id),
    ret: t,
    lt,
    what,
    pre: obj ? [cpp.varDecl(cpp.auto, "recv_", obj.c)] : [],
  });
}

/**
 * A method call on an SDK object (`obj` set) or class. `superOf`: the
 * generated Objective-C subclass whose `super` implementation to call
 * (`super.viewDidLoad()` in a Lucent class overriding it).
 */
export function nativeCall(
  em: FnEmitter,
  node: ts.CallExpression,
  obj: E | undefined,
  superOf?: string,
): E | undefined {
  const decl = em.checker.getResolvedSignature(node)?.declaration;
  if (!decl || !ts.isMethodDeclaration(decl)) return undefined;
  const declared = classOfDecl(decl);
  if (!declared) return undefined;
  const isStatic = !!ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
  if (isStatic === !!obj) return undefined;
  const { ref, method, promise } = schemaMethod(declared, decl);
  const name = method.name;
  // The promise form: the method without its completion handler, giving what the handler gets.
  const plan = requirePlan(node, ref, promise ? promiseForm(method) : method, "call", method);
  if (promise && ref.platform !== "ios")
    fail(
      node,
      Codes.UnsupportedCall,
      `${ref.cls.name}.${name}() as a promise is not supported on ${ref.platform}`,
    );
  requireMain(em, node, ref, method);
  warnBlocking(em, node, ref, method);
  requireAvailableUse(em, node, ref, method, obj);
  if (method.swift) {
    const what = `${ref.cls.name}.${name}()`;
    const params = method.params.map((p) => parseSdkType(p.type, ref.module));
    const ret = parseSdkType(method.returns, ref.module);
    requireAvailable(em, node, ref, swiftRuntimeSince(params), `${ref.cls.name}.${method.name}`);
    const use = swiftUse(node, ref, method, "call", params, ret, what, isStatic);
    return swiftCall(em, use, obj, argsOf(node));
  }
  noteIncludes(em, ref);
  if (promise) return iosPromiseCall(em, node, ref, method, obj, plan);
  return ref.platform === "ios"
    ? iosCall(em, node, ref, method, obj, plan, superOf)
    : androidCall(em, node, ref, method, obj, plan);
}

/**
 * A completion-handler method called without its handler: a promise the
 * glue's block settles on the Lucent thread. The block's error rejects it;
 * its other argument, read as Swift's async form types it, resolves it
 * (nothing, when that form returns nothing).
 */
function iosPromiseCall(
  em: FnEmitter,
  node: ts.CallExpression,
  ref: SdkClassRef,
  m: SdkMethodSchema,
  obj: E | undefined,
  plan: BindingPlan,
): E {
  const tps = m.typeParams ?? [];
  const handler = parseSdkType(m.params[m.params.length - 1]!.type, ref.module, tps);
  if (handler.k !== "fn")
    throw new Error(`${ref.cls.name}.${m.name}: the completion handler is not a block`);
  const a = argsOf(node).map((x, i) =>
    toObjc(em, x, parseSdkType(m.params[i]!.type, ref.module, tps), plan),
  );
  const result = parseSdkType(m.async!.returns, ref.module, tps);
  const isVoid = result.k === "prim" && result.name === "void";
  const names = handler.params.map((_, i) => `a${i}_`);
  const errorAt = handler.params.findIndex((p) => p.k === "error");
  const valueAt = handler.params.findIndex((p) => p.k !== "error");
  const lt: LType = isVoid ? T.undefined : declaredLt(em, "ios", result, node);
  const what = `${ref.cls.name}.${m.name}()`;
  const p = cpp.id("p_");
  const settle = (how: "resolve" | "reject", v: cpp.Expr) =>
    cpp.exprStmt(cpp.call(cpp.dot(p, how), [v]));
  const settled: cpp.Stmt[] = [
    ...(errorAt >= 0
      ? [
          cpp.ifStmt(cpp.id(names[errorAt]!), [
            settle(
              "reject",
              cpp.call("lucent::objc::fromNSError", [cpp.id(names[errorAt]!), cpp.str(what)]),
            ),
            cpp.ret(),
          ]),
        ]
      : []),
    settle(
      "resolve",
      isVoid
        ? cpp.id("lucent::undefined")
        : fromObjc(em, cpp.id(names[valueAt]!), result, lt, what).c,
    ),
  ];
  // The handler's arguments are copied to the Lucent thread, which settles the promise.
  const later = cpp.lambda(["p_", ...names], [], settled, { mutable: true });
  const block = cpp.call(
    "lucent::objc::block",
    [
      cpp.lambda(
        ["p_"],
        handler.params.map((x, i) => cpp.param(objcType(x), names[i])),
        [cpp.exprStmt(cpp.call("lucent::postCallback", [later]))],
      ),
    ],
    [objcType({ ...handler, nullable: false })],
  );
  const promise: LType = { k: "promise", inner: lt };
  const call = send(objcReceiver(ref, obj), m.selector ?? m.name, [...a, block]);
  return {
    c: cpp.statementExpr(
      [cpp.varDecl(em.reg.cppType(promise), "p_"), cpp.exprStmt(cpp.cast("c", cpp.voidType, call))],
      p,
    ),
    t: promise,
  };
}

/** A message send, as its plan says: owned results handed to ARC, an NSError** rethrown. */
function iosCall(
  em: FnEmitter,
  node: ts.CallExpression,
  ref: SdkClassRef,
  m: SdkMethodSchema,
  obj: E | undefined,
  plan: BindingPlan,
  superOf?: string,
): E {
  const tps = m.typeParams ?? [];
  const a = argsOf(node).map((x, i) =>
    toObjc(em, x, parseSdkType(m.params[i]!.type, ref.module, tps), plan),
  );
  const throws = plan.error?.detail === "nserror-out";
  const selector = m.selector ?? m.name;
  const c = m.cFunction;
  // A C function Swift imports as the method: the object among its arguments where its name says.
  const cArgs =
    c && obj && c.self !== undefined
      ? [...a.slice(0, c.self), cfReceiver(ref, obj), ...a.slice(c.self)]
      : a;
  const code = c
    ? cpp.call(c.name, cArgs)
    : superOf
      ? send(
          cpp.cast("c", objcPointer(superOf), cpp.call("lucent::objc::unwrap", [obj!.c])),
          superSelector(selector),
          a,
          throws,
        )
      : send(
          // An initializer declared as a static method: sent to a new instance.
          m.initializer && !obj ? cpp.send(ref.cls.native, "alloc") : objcReceiver(ref, obj),
          selector,
          a,
          throws,
        );
  const ret = parseSdkType(m.returns, ref.module, tps);
  const what = `${ref.cls.name}.${m.name}()`;
  const lt = declaredLt(em, "ios", ret, node);
  const owned = plan.facts.ownership === "transferred";
  if (throws) return throwing(code, (r) => fromObjc(em, r, ret, lt, what, owned), ret);
  return fromObjc(em, code, ret, lt, what, owned);
}

/** The selector of the method a generated subclass calls its base's `selector` with. */
export const superSelector = (selector: string) => `lucentSuper_${selector}`;

/** A CoreFoundation-style handle's object, as the C functions taking it do (`CGImageRef`). */
function cfReceiver(ref: SdkClassRef, obj: E): cpp.Expr {
  return cpp.cast("bridge", cpp.type(ref.cls.native), cpp.call("lucent::objc::unwrap", [obj.c]));
}

function objcReceiver(ref: SdkClassRef, obj: E | undefined): cpp.Expr {
  if (!obj) return cpp.id(ref.cls.native);
  const type = ref.cls.interface ? cpp.protocol(ref.cls.native) : objcPointer(ref.cls.native);
  return cpp.cast("c", type, cpp.call("lucent::objc::unwrap", [obj.c]));
}

/** `obj.prop = v` / `Class.prop = v` on a writable SDK property. */
export function nativeLvalue(
  em: FnEmitter,
  target: ts.PropertyAccessExpression,
  obj: E | undefined,
): Lvalue | undefined {
  // `out.value = x`: what an inout pointer passes in.
  if (
    obj?.t.k === "native" &&
    obj.t.module === "lucent:ios" &&
    obj.t.name === "Out" &&
    target.name.text === "value"
  ) {
    const get = outValue(em, obj, target);
    return {
      get: get.c,
      set: (v) => cpp.call("lucent::objc::setOut", [obj.c, v]),
      type: get.t,
    };
  }
  const decl = resolved(em, target.name)?.valueDeclaration;
  const declaring = decl ? classOfDecl(decl) : undefined;
  if (!declaring || !decl || !isSdkPropertyDecl(decl)) return undefined;
  const found = schemaProperty(declaring, decl);
  if (!found || !!found.property.static !== !obj) return undefined;
  const { ref, property: prop } = found;
  const type = em.lt(target);
  const set = propertySetter(em, target, ref, prop, obj, type);
  const read = property(em, target, ref, prop, obj).c;
  const getter = accessorOf(ref.cls, prop, "get");

  // Only a use that reads the place (`+=`, `++`) calls the getter and needs its permissions.
  const place: Lvalue = {
    get get() {
      notePermissions(em, getter);
      return read;
    },
    set,
    type,
  };
  if (ref.platform !== "android" || !prop.setter) return place;

  // A value of its own type, converted as an argument of the property's type is.
  place.assign = (v: E) => propertySetter(em, target, ref, prop, obj, v.t)(v.c);

  return place;
}

/**
 * How a value of Lucent type `type` is assigned to an SDK property of
 * `obj` (static: none): `set(value)` gives the value assigned, as
 * JavaScript's assignment does. `site` is where the assignment is written.
 */
export function propertySetter(
  em: FnEmitter,
  site: ts.Expression,
  ref: SdkClassRef,
  prop: SdkPropertySchema,
  obj: E | undefined,
  type: LType,
): (value: cpp.Expr) => cpp.Expr {
  const plan = requirePlan(site, ref, prop, "set");
  requireAvailableUse(em, site, ref, prop, obj);
  const t = parseSdkType(prop.type, ref.module);
  if (prop.swift) {
    const what = `${ref.cls.name}.${prop.name}`;
    const use = swiftUse(site, ref, prop, "set", [t], VOID, what, !obj);
    return (v) => swiftSet(em, use, obj, v);
  }
  if (ref.platform === "ios") {
    // Gives the value assigned, as JavaScript's assignment does.
    const set = (value: cpp.Expr) => {
      const v = cpp.id("v_");
      // A function assigned to a block property: a block, as for an argument.
      const one = (x: cpp.Expr) =>
        t.k === "fn"
          ? objcBlock(em, site, x, type, t, plan)
          : toObjcExpr(
              { ...t, nullable: false } as SdkType,
              x,
              false,
              `${ref.cls.name}.${prop.name}`,
            );
      const conv = t.nullable ? ifPresent(v, one) : one(v);
      const held = cpp.varDecl(cpp.auto, "v_", value);
      // A C setter Swift imports as the property's: the object, then the value.
      if (prop.cFunctions?.setter)
        return cpp.statementExpr(
          [
            held,
            cpp.exprStmt(
              cpp.call(prop.cFunctions.setter, [...(obj ? [cfReceiver(ref, obj)] : []), conv]),
            ),
          ],
          v,
        );
      if (!prop.weak)
        return cpp.statementExpr(
          [held, cpp.exprStmt(send(objcReceiver(ref, obj), prop.setter!, [conv]))],
          v,
        );
      // A weak property: its owner keeps the value alive, as long as it holds it.
      const [r, o] = [cpp.id("r_"), cpp.id("o_")];
      const keep = cpp.call("objc_setAssociatedObject", [
        r,
        cpp.selector(prop.setter!),
        o,
        cpp.id("OBJC_ASSOCIATION_RETAIN_NONATOMIC"),
      ]);
      return cpp.statementExpr(
        [
          held,
          cpp.varDecl(cpp.auto, "r_", objcReceiver(ref, obj)),
          cpp.varDecl(cpp.type("id"), "o_", conv),
          cpp.exprStmt(keep),
          cpp.exprStmt(send(r, prop.setter!, [o])),
        ],
        v,
      );
    };
    return set;
  }
  if (!prop.setter) throw new Error(`${plan.display}: a Java field write its plan refuses`);
  const setter = accessorOf(ref.cls, prop, "set");
  notePermissions(em, setter);

  // A Kotlin property's setter, or a shim's (a value class the JVM passes unboxed): gives
  // the value assigned.
  const what = `${ref.cls.name}.${prop.name}`;
  const shim =
    plan.backend === "kotlin-shim"
      ? kotlinShim(em.ctx, {
          node: site,
          module: ref.module,
          cls: ref.cls,
          role: "set",
          member: prop,
          instance: !!obj,
          given: [],
          wrapped: [],
          returns: VOID,
          what,
        })
      : undefined;
  const desc = shim?.descriptor ?? setter?.descriptor ?? jniDescriptor([prop.type], "void");
  const recv = obj ? [jni("unwrap", cpp.id("recv_"))] : [];

  const set = (value: cpp.Expr) => {
    const v = cpp.id("v_");
    const converted = jniOf(em, site, t, jniValue(em, ref, site, t, { c: v, t: type }));
    const call = jniCall(em, {
      node: site,
      cls: shim
        ? ({ kind: "class", name: shim.name, native: shim.owner } as SdkClassSchema)
        : ref.cls,
      lookup: obj && !shim ? "method" : "staticMethod",
      name: shim?.name ?? prop.setter!,
      desc,
      access: (id) =>
        shim
          ? envCall("CallStaticVoidMethod", cpp.id("cls_"), id, ...recv, converted)
          : envCall(
              `Call${obj ? "" : "Static"}VoidMethod`,
              recv[0] ?? cpp.id("cls_"),
              id,
              converted,
            ),
      ret: VOID,
      lt: T.undefined,
      what,
      pre: obj ? [cpp.varDecl(cpp.auto, "recv_", obj.c)] : [],
    });

    return cpp.statementExpr([cpp.varDecl(cpp.auto, "v_", value), cpp.exprStmt(call.c)], v);
  };
  noteIncludes(em, ref);
  return set;
}

/** A C function of an SDK module (iOS): `SecItemCopyMatching(query, out)`. */
export function nativeFunctionCall(em: FnEmitter, node: ts.CallExpression): E | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;
  const decl = resolved(em, node.expression)?.valueDeclaration;
  const sdk =
    decl && ts.isFunctionDeclaration(decl) ? sdkModuleOf(decl.getSourceFile()) : undefined;
  if (!sdk || !decl) return undefined;
  const schema = findSdkModule(sdk.platform, sdk.module)!;
  const name = (decl as ts.FunctionDeclaration).name!.text;
  const f = schema.functions?.find((x) => x.name === name);
  if (!f) fail(node, Codes.UnsupportedCall, `${name} has no binding`);
  const plan = requirePlan(node, sdk, f, "call");
  if (f.swift) {
    const params = f.params.map((p) => parseSdkType(p.type, sdk.module));
    const ret = parseSdkType(f.returns, sdk.module);
    const use = swiftUse(node, sdk, f, "call", params, ret, `${name}()`, true);
    return swiftCall(em, use, undefined, argsOf(node));
  }
  noteFramework(em, sdk.module);
  const owned = plan.facts.ownership === "transferred";
  const a = argsOf(node).map((x, i) =>
    toObjc(em, x, parseSdkType(f.params[i]!.type, sdk.module), plan, owned),
  );
  const ret = parseSdkType(f.returns, sdk.module);
  return fromObjc(em, cpp.call(name, a), ret, declaredLt(em, "ios", ret, node), `${name}()`, owned);
}

/** A C global constant of an SDK module (iOS): `kSecClass`. */
export function nativeConstant(em: FnEmitter, id: ts.Identifier): E | undefined {
  const decl = resolved(em, id)?.valueDeclaration;
  const sdk =
    decl && ts.isVariableDeclaration(decl) ? sdkModuleOf(decl.getSourceFile()) : undefined;
  if (!sdk) return undefined;
  const schema = findSdkModule(sdk.platform, sdk.module)!;
  const c = schema.constants?.find((x) => x.name === id.text);
  if (!c) fail(id, Codes.UnsupportedSyntax, `${id.text} has no binding`);
  requirePlan(id, sdk, c, "get");
  const ct = parseSdkType(c.type, sdk.module);
  if (c.swift)
    return swiftCall(em, swiftUse(id, sdk, c, "get", [], ct, c.name, true), undefined, []);
  noteFramework(em, sdk.module);
  return fromObjc(em, cpp.id(c.name), ct, declaredLt(em, "ios", ct, id), c.name);
}

/** Imports an iOS module's header and links what it needs, as its schema says. */
export function noteFramework(em: FnEmitter, module: string): void {
  const schema = loadSdkModule("ios", module);
  if (!schema.header) throw new Error(`the lucent:ios/${module} binding schema names no header`);
  const n = em.ctx.nativeUnit(em.opts.module);
  n.include("lucent/platform/ios.h");
  n.include(schema.header, { objc: true });
  linkModule(em, schema);
}

/**
 * Links what an iOS module needs: its frameworks, or the pod or Swift
 * package that installed it (as the schema's provenance says), which
 * LucentNative must depend on for its builds to find the module.
 */
export function linkModule(em: FnEmitter, schema: SdkModuleSchema): void {
  for (const f of schema.frameworks ?? []) em.ctx.frameworks.add(f);

  const artifact = schema.provenance?.artifact;
  if (artifact?.startsWith("pod:")) em.ctx.pods.add(artifact.slice("pod:".length).split("@")[0]!);
  if (artifact?.startsWith("spm:")) em.ctx.swiftPackages.add(artifact.slice("spm:".length));
}

/** Declares in the manifest the permissions an Android method needs (its @RequiresPermission). */
function notePermissions(em: FnEmitter, method: { permissions?: string[] } | undefined): void {
  for (const p of method?.permissions ?? []) em.ctx.androidPermissions.add(p);
}

/** The Java method a property's read or write calls: its getter or setter. */
function accessorOf(
  cls: SdkClassSchema,
  prop: SdkPropertySchema,
  role: "get" | "set",
): SdkMethodSchema | undefined {
  const [name, arity] = role === "get" ? [prop.getter, 0] : [prop.setter, 1];
  return cls.methods?.find((m) => (m.java ?? m.name) === name && m.params.length === arity);
}

function androidCall(
  em: FnEmitter,
  node: ts.CallExpression,
  ref: SdkClassRef,
  m: SdkMethodSchema,
  obj: E | undefined,
  plan: BindingPlan,
): E {
  const tps = m.typeParams ?? [];
  notePermissions(em, m);
  warnOutsideGroups(em, m.params, argsOf(node), `${ref.cls.name}.${m.name}`);

  const what = `${ref.cls.name}.${m.name}()`;
  const given = givenParams(em, what, m.params, argsOf(node));
  if (throughKotlin(plan, given)) {
    const ret = parseSdkType(m.returns, ref.module, tps);
    return kotlinCall(em, { node, ref, member: m, role: "call", obj, given, returns: ret, what });
  }

  const a = argsOf(node).map((x, i) =>
    toJni(em, ref, x, parseSdkType(m.params[i]!.type, ref.module, tps)),
  );
  const desc =
    m.descriptor ??
    jniDescriptor(
      m.params.map((p) => p.type),
      m.returns,
      tps,
    );
  const ret = parseSdkType(m.returns, ref.module, tps);
  const kind = jniKind(desc.slice(desc.indexOf(")") + 1));
  const recv = obj ? jni("unwrap", cpp.id("recv_")) : cpp.id("cls_");
  return jniCall(em, {
    node,
    cls: ref.cls,
    lookup: obj ? "method" : "staticMethod",
    name: m.java ?? m.name,
    desc,
    access: (id) => envCall(`Call${obj ? "" : "Static"}${kind}Method`, recv, id, ...a),
    ret,
    lt: declaredLt(em, "android", ret, node),
    what: `${ref.cls.name}.${m.name}()`,
    pre: obj ? [cpp.varDecl(cpp.auto, "recv_", obj.c)] : [],
  });
}

/** The type the called declaration gives an argument: what the runtime takes. */
function declaredArg(em: FnEmitter, arg: ts.Expression): LType {
  return em.ctx.reg.lower(em.checker.getContextualType(arg)!, arg);
}

/** An optional `signal` argument, as the runtime's helpers take it. */
function signalArg(em: FnEmitter, arg: ts.Expression | undefined): cpp.Expr[] {
  return arg ? [em.exprAs(arg, unionOf([T.abortSignal, T.undefined]))] : [];
}

/**
 * `main`, `available` and `appContext` from lucent:thread, lucent:ios and
 * lucent:android, and lucent:ios's presentations and lifecycle events.
 */
export function nativeBuiltinCall(em: FnEmitter, node: ts.CallExpression): E | undefined {
  const b = builtinNamed(em, node.expression);
  if (!b) return undefined;
  const args = argsOf(node);
  const unit = em.ctx.nativeUnit(em.opts.module);
  switch (`${b.module}.${b.name}`) {
    case "lucent:thread.main": {
      const f = args[0];
      if (!f || !(ts.isArrowFunction(f) || ts.isFunctionExpression(f)) || args.length !== 1)
        fail(node, Codes.UnsupportedCall, "main takes one function literal: main(() => …)");
      if (ts.getModifiers(f)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword))
        fail(
          f,
          Codes.UnsupportedCall,
          "the function passed to main runs synchronously on the main thread; it cannot be async",
        );
      unit.include(
        em.ctx.platform === "ios" ? "lucent/platform/ios.h" : "lucent/platform/android.h",
      );
      const closure = em.closure(f);
      const t = em.lt(node);
      if (t.k === "promise" && t.inner.k === "promise")
        fail(f, Codes.UnsupportedCall, "the function passed to main cannot return a promise");
      return { c: cpp.call("lucent::runOnMain", [closure.c]), t };
    }
    case "lucent:ios.asString":
    case "lucent:ios.asNumber":
    case "lucent:ios.asBoolean":
    case "lucent:ios.asData":
    case "lucent:ios.asDate": {
      unit.include("lucent/platform/ios.h");
      const nsObject: LType = {
        k: "native",
        platform: "ios",
        module: "lucent:ios",
        name: "NSObject",
      };
      const value: Record<string, LType> = {
        asString: T.string,
        asNumber: T.number,
        asBoolean: T.boolean,
        asData: T.bytes,
        asDate: T.date,
      };
      return {
        c: cpp.call(`lucent::objc::${b.name}`, [em.exprAs(args[0]!, unionOf([nsObject, T.null]))]),
        t: unionOf([value[b.name]!, T.null]),
      };
    }
    case "lucent:ios.mainQueue":
      unit.include("lucent/platform/ios.h");
      return {
        c: cpp.call("lucent::objc::mainQueue"),
        t: { k: "native", platform: "ios", module: "lucent:ios", name: "NSObject" },
      };
    case "lucent:ios.present": {
      const build = args[0];
      if (
        !build ||
        !(ts.isArrowFunction(build) || ts.isFunctionExpression(build)) ||
        args.length > 2
      )
        fail(
          node,
          Codes.UnsupportedCall,
          "present takes a function literal that returns the view controller: present((resolve, reject) => …)",
        );
      unit.include("lucent/platform/ios_ui.h");
      const t = em.lt(node);
      if (t.k !== "promise") throw new Error("present returns a promise");
      // Settled with nothing: resolve takes no value, as in new Promise().
      const none = t.inner.k === "void" || t.inner.k === "undefined";
      const resolveT: LType = { k: "fn", params: none ? [] : [t.inner], ret: T.void };
      const rejectT: LType = { k: "fn", params: [T.error], ret: T.void };
      // What it returns is a view controller: a Lucent class extending one is its native object.
      const controller: LType = {
        k: "native",
        platform: "ios",
        module: "UIKit",
        name: "UIViewController",
      };
      const buildT: LType = { k: "fn", params: [resolveT, rejectT], ret: controller };
      const closure = em.closure(build, buildT);
      return {
        c: cpp.call(
          cpp.templateId("lucent::objc::present", [none ? cpp.voidType : em.reg.cppType(t.inner)]),
          [em.coerce(closure, buildT, build), ...signalArg(em, args[1])],
        ),
        t,
      };
    }
    case "lucent:ios.onAppEvent":
    case "lucent:ios.onSceneEvent": {
      unit.include("lucent/platform/ios_ui.h");
      const listener: LType = {
        k: "fn",
        params: b.name === "onSceneEvent" ? [T.string] : [],
        ret: T.void,
      };
      const f = args[1]!;
      const e =
        ts.isArrowFunction(f) || ts.isFunctionExpression(f) ? em.closure(f, listener) : em.expr(f);
      return {
        c: cpp.call(`lucent::objc::${b.name}`, [
          em.exprAs(args[0]!, T.string),
          em.coerce(e, listener, f),
          ...signalArg(em, args[2]),
        ]),
        t: { k: "fn", params: [], ret: T.void },
      };
    }
    case "lucent:ios.available":
      unit.include("lucent/platform/ios.h");
      return {
        c: cpp.call(
          "lucent::objc::available",
          args.slice(1).map((a) => em.exprAs(a, T.number)),
        ),
        t: T.boolean,
      };
    case "lucent:android.available":
      unit.include("lucent/platform/android.h");
      return {
        c: cpp.call("lucent::jni::available", [em.exprAs(args[1]!, T.number)]),
        t: T.boolean,
      };
    case "lucent:android.appContext":
      unit.include("lucent/platform/android.h");
      return { c: cpp.call("lucent::jni::appContext"), t: em.lt(node) };
    case "lucent:android.currentActivity":
      unit.include("lucent/platform/android.h");
      return { c: cpp.call("lucent::jni::currentActivity"), t: em.lt(node) };
    case "lucent:android.errorOf":
      unit.include("lucent/platform/android.h");
      return {
        c: cpp.call("lucent::jni::errorOf", [em.exprAs(args[0]!, declaredArg(em, args[0]!))]),
        t: T.error,
      };
    case "lucent:android.startActivityForResult":
    case "lucent:android.requestPermissions": {
      unit.include("lucent/platform/android.h");
      const input = em.exprAs(args[0]!, declaredArg(em, args[0]!));
      const signal = args[1] ? [em.exprAs(args[1], unionOf([T.abortSignal, T.undefined]))] : [];
      return { c: cpp.call(`lucent::jni::${b.name}`, [input, ...signal]), t: em.lt(node) };
    }
    case "lucent:android.onActivityEvent": {
      unit.include("lucent/platform/android.h");
      return {
        c: cpp.call("lucent::jni::onActivityEvent", [
          em.exprAs(args[0]!, T.string),
          em.exprAs(args[1]!, declaredArg(em, args[1]!)),
        ]),
        t: em.lt(node),
      };
    }
  }
  fail(node, Codes.UnsupportedCall, `${b.module} ${b.name} cannot be called here`);
}

// --- Kotlin shims ----------------------------------------------------------------------

/** Whether `e`'s type includes undefined. */
function mayBeUndefined(em: FnEmitter, e: ts.Expression): boolean {
  const t = em.checker.getTypeAtLocation(e);
  const has = (x: ts.Type) => !!(x.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void));
  return has(t) || (t.isUnion() && t.types.some(has));
}

/**
 * Which of a member's parameters a call gives: those it writes an argument
 * for, but where Kotlin has a default and the argument is `undefined`. An
 * argument that may be undefined there is refused: Lucent chooses between
 * Kotlin's default and the value when it compiles the call.
 */
function givenParams(
  em: FnEmitter,
  what: string,
  params: SdkParam[],
  args: readonly ts.Expression[],
): boolean[] {
  return params.map((p, i) => {
    const a = args[i];
    if (!a) return false;
    if (!p.kotlin?.default) return true;
    if (ts.isIdentifier(a) && a.text === "undefined") return false;

    if (mayBeUndefined(em, a))
      fail(
        a,
        Codes.UnsupportedCall,
        `${what}: ${p.name} may be undefined, and Lucent leaves out a Kotlin default only where the call does: pass a value, or leave the argument out`,
      );
    return true;
  });
}

/** Whether a use goes through a Kotlin shim: its plan says so, or it leaves out defaults. */
function throughKotlin(plan: BindingPlan, given: boolean[]): boolean {
  return plan.backend === "kotlin-shim" || given.some((g) => !g);
}

interface KotlinCall {
  node: ts.Node;
  ref: SdkClassRef;
  member: SdkMethodSchema | SdkCallable | SdkPropertySchema;
  role: KotlinUse["role"];
  obj?: E;
  given: boolean[];
  returns: SdkType;
  /** The value's Lucent type; by default, as the schema declares it (a suspend call's: the promise's). */
  lt?: LType;
  what: string;
}

/**
 * A use through a Kotlin shim, called over JNI like a static Java method:
 * its receiver first, then the arguments the call gives. A suspend
 * function's shim takes a completion and gives back what cancels it: the
 * call is a promise of the context that makes it, cancelled by the
 * AbortSignal the call passes last.
 */
function kotlinCall(em: FnEmitter, call: KotlinCall): E {
  const { node, ref, member, obj, given, returns, what } = call;
  const params = "params" in member ? member.params : [];
  const args = ts.isCallExpression(node) || ts.isNewExpression(node) ? argsOf(node) : [];

  // Lucent functions the shim runs as suspend functions.
  const runs = params.map((p, i) =>
    given[i] && em.lt(args[i]!).k === "fn" ? suspending(p, ref.module) : undefined,
  );
  const shim = kotlinShim(em.ctx, {
    node,
    module: ref.module,
    cls: ref.cls,
    role: call.role,
    member,
    instance: !!obj,
    given,
    wrapped: runs.map((r) => !!r),
    returns,
    what,
  });
  noteIncludes(em, ref);

  const passed = params.flatMap((p, i) =>
    given[i] ? [{ arg: args[i]!, t: parseSdkType(p.type, ref.module), runs: runs[i] }] : [],
  );
  const owner = { kind: "class", name: shim.name, native: shim.owner } as SdkClassSchema;
  const recv = obj ? [jni("unwrap", cpp.id("recv_"))] : [];
  const pre = obj ? [cpp.varDecl(cpp.auto, "recv_", obj.c)] : [];

  if (!member.kotlin?.suspend) {
    const a = passed.map(({ arg, t, runs: r }, i) =>
      r
        ? kotlinFunction(em, arg, em.expr(arg), r, what, `${shim.name}#${i}`)
        : toJni(em, ref, arg, t),
    );
    const kind = jniKind(shim.descriptor.slice(shim.descriptor.indexOf(")") + 1));

    return jniCall(em, {
      node,
      cls: owner,
      lookup: "staticMethod",
      name: shim.name,
      desc: shim.descriptor,
      access: (id) => envCall(`CallStatic${kind}Method`, cpp.id("cls_"), id, ...recv, ...a),
      ret: returns,
      lt: call.lt ?? declaredLt(em, "android", returns, node),
      what,
      pre,
    });
  }

  // Arguments are evaluated before the call starts, as JavaScript evaluates them.
  const values = passed.map(({ arg, t, runs: r }, i) => {
    const v = r ? em.expr(arg) : jniArgument(em, ref, arg, t);
    return { arg, t, runs: r, local: `a${i}_`, value: v };
  });
  const signalArg = args[params.length];
  const signalType = unionOf([T.abortSignal, T.undefined]);
  const signal = signalArg
    ? em.exprAs(signalArg, signalType)
    : cpp.construct(em.reg.cppType(signalType), []);

  const promise = em.lt(node);
  if (promise.k !== "promise") throw new Error(`${what}: a suspend call typed ${promise.k}`);
  const value = promise.inner;
  const r = em.reg.cppRetType(value);

  const start = cpp.lambda(
    ["&"],
    [cpp.param(cpp.pointer(cpp.type("JNIEnv")), "env"), cpp.param(cpp.type("jobject"), "done_")],
    [
      cpp.varDecl(cpp.type("jclass"), "cls_", jni("findClass", javaClass(em, shim.owner)), {
        static: true,
      }),
      cpp.varDecl(
        cpp.auto,
        "id_",
        jni(
          "staticMethod",
          cpp.id("cls_"),
          cpp.str(shim.name),
          javaDescriptor(em, shim.descriptor),
        ),
        { static: true },
      ),
      cpp.ret(
        envCall(
          "CallStaticObjectMethod",
          cpp.id("cls_"),
          cpp.id("id_"),
          ...recv,
          ...values.map(({ arg, t, runs: r, local, value: v }, i) => {
            const held = { c: cpp.id(local), t: v.t };
            return r
              ? kotlinFunction(em, arg, held, r, what, `${shim.name}#${i}`)
              : jniOf(em, arg, t, held);
          }),
          cpp.id("done_"),
        ),
      ),
    ],
    { ret: cpp.type("jobject") },
  );

  // Where the coroutine completes: nothing captured, it may run long after this call.
  const done = cpp.lambda(
    [],
    [cpp.param(cpp.pointer(cpp.type("JNIEnv")), "env"), cpp.param(cpp.type("jobject"), "v_")],
    [cpp.ret(completion(em, cpp.id("v_"), returns, value, what, node))],
    {
      ret:
        value.k === "void" || value.k === "undefined"
          ? cpp.type("lucent::Undefined")
          : em.reg.cppType(value),
    },
  );

  const body: cpp.Stmt[] = [
    ...pre,
    ...values.map(({ local, value: v }) => cpp.varDecl(cpp.auto, local, v.c)),
    cpp.varDecl(cpp.auto, "signal_", signal),
    cpp.ret(cpp.call("lucent::jni::launch", [cpp.id("signal_"), cpp.str(what), start, done], [r])),
  ];

  return {
    c: cpp.call(cpp.lambda(["&"], [], body, { ret: em.reg.cppType(promise) })),
    t: promise,
  };
}

/** A suspend function's value `code`, as its completion receives it (boxed), as Lucent's `lt`. */
function completion(
  em: FnEmitter,
  code: cpp.Expr,
  t: SdkType,
  lt: LType,
  what: string,
  node: ts.Node,
): cpp.Expr {
  if (t.k !== "prim") return fromJni(em, code, t, lt, what, node).c;
  if (t.name === "void") return cpp.id("lucent::undefined");

  return unboxedPrim(t, code);
}

/**
 * A boxed Java number or boolean `code` (a suspend function's value, a
 * list's element, a proxy's argument) of primitive type `t`, as its Lucent
 * value (primLt): a Long as any long, a bigint (a constant group's, a
 * number) exactly.
 */
function unboxedPrim(t: SdkType & { k: "prim" }, code: cpp.Expr): cpp.Expr {
  if (t.name === "boolean") return jni("unboxBoolean", env, code);

  return t.name === "long"
    ? numberFromNative(t, jni("unboxLong", env, code))
    : jni("unboxNumber", env, code);
}

// --- instanceof ------------------------------------------------------------------------

/**
 * `value instanceof C` for an Android SDK class: whether the Java object is
 * one (JNI's IsInstanceOf), so Lucent code matches the cases of a sealed
 * class and reads their payloads. null is no instance. Undefined when `C`
 * is not an Android SDK class.
 */
export function nativeInstanceOf(em: FnEmitter, node: ts.BinaryExpression): E | undefined {
  const ref = sdkClassNamed(em, node.right);
  if (!ref) return undefined;
  if (ref.platform === "ios") return objcInstanceOf(em, node, ref);

  const v = em.expr(node.left);
  const inner = stripOpt(v.t);
  if (inner.k !== "native" || inner.platform !== "android")
    fail(node, Codes.UnsupportedOperator, `instanceof ${ref.cls.name} tests Java objects only`);
  requireAvailable(em, node, ref, ref.cls.since, ref.cls.name);
  noteIncludes(em, ref);

  const o = cpp.id("o_");
  const object = jni("unwrap", o);
  const test = cpp.binary(
    envCall("IsInstanceOf", object, cpp.id("cls_")),
    "==",
    cpp.id("JNI_TRUE"),
  );
  const body: cpp.Stmt[] = [
    cpp.varDecl(cpp.pointer(cpp.type("JNIEnv")), "env", jni("env")),
    cpp.varDecl(cpp.auto, "o_", v.c),
    cpp.varDecl(cpp.type("jclass"), "cls_", jni("findClass", javaClass(em, ref.cls.native)), {
      static: true,
    }),
    cpp.ret(v.t.k === "opt" ? cpp.and(cpp.call(cpp.dot(o, "has")), test) : test),
  ];

  return { c: cpp.call(cpp.lambda(["&"], [], body, { ret: cpp.type("bool") })), t: T.boolean };
}

/** `x instanceof Cls` on an Objective-C object: `[x isKindOfClass:[Cls class]]`, false for nil. */
function objcInstanceOf(em: FnEmitter, node: ts.BinaryExpression, ref: SdkClassRef): E {
  const name = ref.cls.name;
  const info = sdkTypeInfo("ios", ref.module, name);

  if (!info || info.swift || info.cf)
    fail(
      node,
      Codes.UnsupportedOperator,
      `instanceof ${name} tests Objective-C classes only: ${name} has no Objective-C class`,
    );

  const v = em.expr(node.left);
  const inner = stripOpt(v.t);

  if (inner.k !== "native" || inner.platform !== "ios")
    fail(node, Codes.UnsupportedOperator, `instanceof ${name} tests Objective-C objects only`);

  requireAvailable(em, node, ref, ref.cls.since, name);
  noteIncludes(em, ref);

  const test = cpp.send(cpp.call("lucent::objc::unwrap", [v.c]), "isKindOfClass:", [
    cpp.send(info.native, "class"),
  ]);

  return { c: cpp.staticCast(cpp.type("bool"), test), t: T.boolean };
}

// --- native views in JSX (T48) ---------------------------------------------------------

/** The SDK class a JSX tag names (`<UILabel/>`), if it names one. */
export function sdkTagClass(em: FnEmitter, tag: ts.JsxTagNameExpression): SdkClassRef | undefined {
  return ts.isIdentifier(tag) || ts.isPropertyAccessExpression(tag)
    ? sdkClassNamed(em, tag)
    : undefined;
}

/**
 * A view a tag makes by rule, at `site` (its tag): iOS a zero frame or
 * `init`, its own or inherited; Android its `(Context)` constructor, given
 * the hosting view's context.
 */
export function viewNew(
  em: FnEmitter,
  site: ts.Expression,
  ref: SdkClassRef,
  construction: ViewConstruction & { kind: "frame" | "init" | "context" },
  lt: LType,
): E {
  const owner = findSdkType(ref.platform, construction.module, construction.owner);
  const declaring =
    owner?.kind === "class" ? { ...ref, module: construction.module, cls: owner } : ref;
  const what = `<${ref.cls.name}>`;

  requireMain(em, site, ref);
  requirePlan(site, declaring, construction.ctor, "new");
  requireAvailable(em, site, ref, ref.cls.since, ref.cls.name);
  requireAvailable(em, site, ref, construction.ctor.since, what);
  if (construction.ctor.swift)
    fail(
      site,
      Codes.NativeViewJsx,
      `${ref.cls.name} is made through Swift: make it with create={() => new ${ref.cls.name}(…)}`,
    );
  noteIncludes(em, ref);

  if (ref.platform === "ios") {
    const alloc = cpp.send(ref.cls.native, "alloc");
    const frame = construction.kind === "frame" ? [cpp.id("CGRectZero")] : [];
    const made = send(alloc, construction.ctor.selector ?? "init", frame);

    return { c: cpp.call("lucent::objc::wrap", [made, cpp.str(what)]), t: lt };
  }

  const self: SdkType = { k: "ref", module: ref.module, name: ref.cls.name, nullable: false };
  const desc =
    construction.ctor.descriptor ??
    jniDescriptor(
      construction.ctor.params.map((p) => p.type),
      "void",
    );
  return jniCall(em, {
    node: site,
    cls: ref.cls,
    lookup: "method",
    name: "<init>",
    desc,
    access: (id) => envCall("NewObject", cpp.id("cls_"), id, jni("unwrap", cpp.id("context_"))),
    ret: self,
    lt,
    what,
    pre: [cpp.varDecl(cpp.auto, "context_", jni("viewContext"))],
  });
}

/** The Lucent value's fit for a parameter type, to choose among a setter's overloads. */
function takes(t: SdkType, lt: LType): boolean {
  const v = stripOpt(lt);

  switch (t.k) {
    case "string":
      return v.k === "string";
    case "prim":
      return t.name === "boolean" || t.name === "bool"
        ? v.k === "boolean"
        : isWideInteger(t.name)
          ? v.k === "bigint"
          : v.k === "number";
    default:
      return !["string", "boolean", "number", "bigint"].includes(v.k);
  }
}

/** A value computed already, as jniArgument converts an argument: in its parameter's Lucent type. */
function jniValue(em: FnEmitter, ref: SdkClassRef, site: ts.Expression, t: SdkType, value: E): E {
  const as = (lt: LType): E => ({ c: em.coerce(value, lt, site), t: lt });

  switch (t.k) {
    case "prim":
      return as(primLt(t));
    case "string":
      return as(t.nullable ? unionOf([T.string, T.null]) : T.string);
    case "array": {
      const lt = declaredLt(em, ref.platform, { ...t, nullable: false }, site);
      return as(t.nullable ? unionOf([lt, T.null]) : lt);
    }
    case "ref": {
      if (value.t.k === "fn" || eitherMembers(value.t)) return value;
      const lt: LType = { k: "native", platform: ref.platform, module: t.module, name: t.name };
      return as(t.nullable ? unionOf([lt, T.null]) : lt);
    }
    default:
      return value;
  }
}

/**
 * A one-value setter (Android `setText(value)`) called on `obj` with
 * `value`: the overload whose parameter takes the value's type. `site` is
 * the attribute's value.
 */
export function setterCall(
  em: FnEmitter,
  site: ts.Expression,
  ref: SdkClassRef,
  overloads: readonly SdkMethodSchema[],
  obj: E,
  value: E,
): cpp.Expr {
  const method =
    overloads.find((m) => takes(parseSdkType(m.params[0]!.type, ref.module), value.t)) ??
    overloads[0]!;
  const t = parseSdkType(method.params[0]!.type, ref.module);
  const what = `${ref.cls.name}.${method.name}`;

  requirePlan(site, ref, method, "call");
  requireMain(em, site, ref, method);
  requireAvailable(em, site, ref, method.since, what);
  notePermissions(em, method);
  noteIncludes(em, ref);

  return jniCall(em, {
    node: site,
    cls: ref.cls,
    lookup: "method",
    name: method.java ?? method.name,
    desc: method.descriptor ?? jniDescriptor([method.params[0]!.type], "void"),
    access: (id) =>
      envCall(
        "CallVoidMethod",
        jni("unwrap", cpp.id("recv_")),
        id,
        jniOf(em, site, t, jniValue(em, ref, site, t, value)),
      ),
    ret: VOID,
    lt: T.undefined,
    what,
    pre: [cpp.varDecl(cpp.auto, "recv_", obj.c)],
  }).c;
}

/** Inserts `child` at `index` among `parent`'s children, by the method its class declares. */
export function insertChild(
  em: FnEmitter,
  site: ts.Expression,
  ref: SdkClassRef,
  method: SdkMethodSchema,
  parent: E,
  child: E,
  index: cpp.Expr,
): cpp.Expr {
  const what = `${ref.cls.name}.${method.selector ?? method.name}`;
  const childType = parseSdkType(method.params[0]!.type, ref.module);

  requirePlan(site, ref, method, "call");
  requireMain(em, site, ref, method);
  requireAvailable(em, site, ref, method.since, what);
  notePermissions(em, method);
  noteIncludes(em, ref);

  if (ref.platform === "ios")
    return send(objcReceiver(ref, parent), method.selector!, [
      toObjcExpr({ ...childType, nullable: false } as SdkType, child.c, false, what),
      index,
    ]);

  return jniCall(em, {
    node: site,
    cls: ref.cls,
    lookup: "method",
    name: method.java ?? method.name,
    desc:
      method.descriptor ??
      jniDescriptor(
        method.params.map((p) => p.type),
        "void",
      ),
    access: (id) =>
      envCall(
        "CallVoidMethod",
        jni("unwrap", cpp.id("recv_")),
        id,
        jni("unwrap", cpp.id("child_")),
        cpp.staticCast(cpp.type("jint"), index),
      ),
    ret: VOID,
    lt: T.undefined,
    what,
    pre: [cpp.varDecl(cpp.auto, "recv_", parent.c), cpp.varDecl(cpp.auto, "child_", child.c)],
  }).c;
}

/**
 * Lets `child` go from `parent`'s children (T49): by `method`, the
 * parent's own (`removeArrangedSubview:`, `removeView`), then on iOS by
 * the child's `removeFromSuperview`, which is all a parent inserting
 * subviews has.
 */
export function removeChild(
  em: FnEmitter,
  site: ts.Expression,
  ref: SdkClassRef,
  method: SdkMethodSchema | undefined,
  parent: E,
  child: E,
): cpp.Stmt[] {
  const fromSuperview = cpp.send(
    cpp.cast("c", objcPointer("UIView"), cpp.call("lucent::objc::unwrap", [child.c])),
    "removeFromSuperview",
  );

  if (!method) {
    if (ref.platform === "ios") return [cpp.exprStmt(fromSuperview)];
    throw new Error(`${ref.cls.name}: no method letting a child go`);
  }

  const what = `${ref.cls.name}.${method.selector ?? method.name}`;
  const childType = parseSdkType(method.params[0]!.type, ref.module);

  requirePlan(site, ref, method, "call");
  requireMain(em, site, ref, method);
  requireAvailable(em, site, ref, method.since, what);
  noteIncludes(em, ref);

  if (ref.platform === "ios")
    return [
      cpp.exprStmt(
        send(objcReceiver(ref, parent), method.selector!, [
          toObjcExpr({ ...childType, nullable: false } as SdkType, child.c, false, what),
        ]),
      ),
      cpp.exprStmt(fromSuperview),
    ];

  return [
    cpp.exprStmt(
      jniCall(em, {
        node: site,
        cls: ref.cls,
        lookup: "method",
        name: method.java ?? method.name,
        desc:
          method.descriptor ??
          jniDescriptor(
            method.params.map((p) => p.type),
            "void",
          ),
        access: (id) =>
          envCall(
            "CallVoidMethod",
            jni("unwrap", cpp.id("recv_")),
            id,
            jni("unwrap", cpp.id("child_")),
          ),
        ret: VOID,
        lt: T.undefined,
        what,
        pre: [cpp.varDecl(cpp.auto, "recv_", parent.c), cpp.varDecl(cpp.auto, "child_", child.c)],
      }).c,
    ),
  ];
}

/**
 * A listener event (Android `onClick`): `handler` given to the setter as
 * its one-method listener, and taken back with null.
 */
export function listenerEvent(
  em: FnEmitter,
  site: ts.Expression,
  ref: SdkClassRef,
  setter: SdkMethodSchema,
  obj: E,
  handler: E,
): { add: cpp.Expr; remove: cpp.Expr } {
  const listener = parseSdkType(setter.params[0]!.type, ref.module);
  if (listener.k !== "ref") throw new Error(`${setter.name}: its listener is no class`);
  const what = `${ref.cls.name}.${setter.name}`;

  requirePlan(site, ref, setter, "call");
  requireMain(em, site, ref, setter);
  requireAvailable(em, site, ref, setter.since, what);
  notePermissions(em, setter);
  noteIncludes(em, ref);

  const call = (given: cpp.Expr) =>
    jniCall(em, {
      node: site,
      cls: ref.cls,
      lookup: "method",
      name: setter.java ?? setter.name,
      desc: setter.descriptor ?? jniDescriptor([setter.params[0]!.type], "void"),
      access: (id) => envCall("CallVoidMethod", jni("unwrap", cpp.id("recv_")), id, given),
      ret: VOID,
      lt: T.undefined,
      what,
      pre: [cpp.varDecl(cpp.auto, "recv_", obj.c)],
    }).c;

  return {
    add: call(javaProxy(em, site, handler, { ...listener, nullable: false })),
    remove: call(cpp.id("nullptr")),
  };
}

/**
 * A control event (iOS `onValueChanged`): `handler`, called with the
 * control (the tag's class `tag`), registered as a UIAction for the
 * event's mask; `add` gives the action, which `remove(action)` takes back.
 */
export function controlEvent(
  em: FnEmitter,
  site: ts.Expression,
  ref: SdkClassRef,
  tag: SdkClassRef,
  register: SdkMethodSchema,
  value: number,
  obj: E,
  handler: E,
): { add: cpp.Expr; remove: (action: cpp.Expr) => cpp.Expr } {
  const what = `${ref.cls.name}.${register.selector}`;
  const sender: SdkType = { k: "ref", module: tag.module, name: tag.cls.name, nullable: false };
  const fn: SdkType & { k: "fn" } = {
    k: "fn",
    params: [sender],
    ret: VOID,
    escaping: true,
    main: true,
    nullable: false,
  };

  requirePlan(site, ref, register, "call");
  requireAvailable(em, site, ref, register.since, what);
  noteIncludes(em, ref);
  em.ctx.nativeUnit(em.opts.module).include("lucent/platform/ios_ui.h");

  const block = objcBlock(em, site, handler.c, handler.t, fn, { display: what });
  const control = cpp.call("lucent::objc::unwrap", [obj.c]);

  return {
    add: cpp.call("lucent::objc::addControlAction", [control, cpp.num(value), block]),
    remove: (action) =>
      cpp.call("lucent::objc::removeControlAction", [control, action, cpp.num(value)]),
  };
}
