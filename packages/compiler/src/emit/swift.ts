/**
 * Swift-only members (docs/design/swift-shims.md): the glue calls one
 * `@_cdecl` shim per member the program uses, generated with the program
 * (LucentShims.swift) and declared in the glue that calls it.
 *
 * Values cross as the Objective-C values the glue already converts: scalars
 * as C scalars, a Swift enum without payloads as its case's index, and
 * everything else as an object pointer (Foundation values bridged, Swift
 * objects as themselves, other Swift values in a LucentBox). Objects handed
 * to Lucent are retained; arguments are borrowed.
 */
import { createHash } from "node:crypto";
import { cpp, swift } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { sdkModuleOf } from "../program.ts";
import { substitute } from "../sdk/dts.ts";
import { SWIFT_SCALARS, swiftConversion, takenReason } from "../sdk/plans.ts";
import {
  findSdkType,
  formatSchemaType,
  loadSdkModule,
  payloadFields,
  sdkTypeInfo,
  type SdkClassSchema,
  type SdkType,
  type SwiftMember,
} from "../sdk/schema.ts";
import { cppIdent, type LType, T, typeKey, unionOf } from "../types.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import { stringExpr } from "./literals.ts";
import {
  argumentWhat,
  boxed,
  declaredLt,
  fromObjc,
  fromObjcItem,
  ifPresent,
  linkModule,
  noteFramework,
  numberToNative,
  primLt,
  toObjc,
  toObjcExpr,
} from "./native.ts";

/** A use of a Swift-only member: what its shim calls, and with what. */
export interface SwiftUse {
  node: ts.Node;
  /** The member's module; its owner's, when it has one. */
  module: string;
  /** Absent for top-level functions and variables. */
  owner?: SdkClassSchema;
  role: "call" | "init" | "get" | "set";
  static: boolean;
  member: SwiftMember;
  /** The parameters the call gives (default arguments Lucent never gives left out). */
  params: SdkType[];
  /** Their Swift argument labels (none for `_`). */
  labels: (string | undefined)[];
  /** How many a call must give: the rest are default arguments. */
  required: number;
  /** For "init", the type constructed; for "set", void. */
  ret: SdkType;
  what: string;
  /** Runs on the main actor (`@MainActor`). */
  mainActor?: boolean;
  /** The member's own type parameters. */
  typeParams?: string[];
  /** Set by specialize(): the owner's type arguments and the member's. */
  ownerArgs?: SdkType[];
  typeArgs?: SdkType[];
  /** The iOS version its shim needs: its owner's, its own, the Swift runtime's (swiftRuntimeSince). */
  since?: string;
}

/** One shim: a `@_cdecl` function calling one Swift member. */
export interface SwiftShim {
  symbol: string;
  module: string;
  role: SwiftUse["role"];
  /** The owner's Swift name (`Shapes.Point`), and whether its values are boxed. */
  owner?: { name: string; boxed: boolean };
  static: boolean;
  member: SwiftMember;
  params: SdkType[];
  labels: (string | undefined)[];
  ret: SdkType;
  mainActor?: boolean;
  /** A specialization of a generic member: its result's type is spelled out. */
  generic?: boolean;
  /** The iOS version the shim needs (`@available(iOS 16.0, *)`), above the deployment target. */
  since?: string;
}

/** The Swift runtime's support for parameterized protocol types (`any Store<String>`). */
const PARAMETERIZED_EXISTENTIALS = "16.0";

/** The iOS version the Swift runtime needs to pass `params`: a parameterized protocol type's. */
export function swiftRuntimeSince(params: SdkType[]): string | undefined {
  return params.some((t) => isOpened(t) && t.k === "ref" && t.args?.length)
    ? PARAMETERIZED_EXISTENTIALS
    : undefined;
}

type Crossing = "scalar" | "enum" | "object";

/** The numbers and booleans shims pass, with their Swift and C types (bindgen's ABI table). */
const SCALARS: Record<string, { swift: string; c: string } | undefined> = SWIFT_SCALARS;

export const isVoid = (t: SdkType) => t.k === "prim" && t.name === "void";
const isBool = (t: SdkType) => t.k === "prim" && (t.name === "bool" || t.name === "boolean");

/** A Swift enum without payloads: its Swift name and cases, which cross as indexes. */
export function swiftEnum(t: SdkType): { name: string; cases: string[] } | undefined {
  if (t.k !== "ref" || sdkTypeInfo("ios", t.module, t.name)?.kind !== "enum") return undefined;
  const e = findSdkType("ios", t.module, t.name);
  return e?.kind === "enum" && e.swift
    ? { name: e.native, cases: e.cases.map((c) => c.native) }
    : undefined;
}

/** A case of a Swift enum with payloads. */
export interface PayloadCase {
  name: string;
  params: { label?: string; type: SdkType }[];
}

/**
 * A Swift enum with payloads, a union of object types in Lucent: its Swift
 * name and cases, a generic one's on the type arguments `t` gives it.
 */
function payloadEnum(t: SdkType): { name: string; cases: PayloadCase[] } | undefined {
  if (t.k !== "ref" || !sdkTypeInfo("ios", t.module, t.name)?.swift) return undefined;
  const cls = findSdkType("ios", t.module, t.name);
  if (cls?.kind !== "class" || cls.swift?.kind !== "enum" || !cls.swift.cases) return undefined;
  const bound = new Map<string, SdkType>();
  (cls.typeParams ?? []).forEach((p, i) => t.args?.[i] && bound.set(p, t.args[i]!));
  return {
    name: swift.printType(swiftType({ ...t, nullable: false })),
    cases: cls.swift.cases.map((c) => ({
      name: c.name,
      params: c.params.map((p) => ({ ...p, type: substitute(p.type, bound) })),
    })),
  };
}

export const isPayloadEnum = (t: SdkType) => !!payloadEnum(t);

/** Whether a type is, or holds, a Swift enum with payloads. */
const hasUnion = (t: SdkType): boolean =>
  t.k === "array" || t.k === "record" ? hasUnion(t.of) : isPayloadEnum(t);

/** A C struct's native name (it crosses as its bytes). */
function cStruct(t: SdkType): string | undefined {
  if (t.k !== "ref") return undefined;
  const info = sdkTypeInfo("ios", t.module, t.name);
  return info?.kind === "struct" ? info.native : undefined;
}

/** A Lucent value `c` of type `t` as the object it crosses as. */
export function objectOf(t: SdkType, c: cpp.Expr): cpp.Expr {
  return cStruct(t)
    ? cpp.call("lucent::objc::structBytes", [toObjcExpr(t, c, false)])
    : toObjcExpr(t, c, false);
}

/** An object `code` that crossed as type `t`, as a Lucent value of type `lt`. */
export function valueOf(em: FnEmitter, code: cpp.Expr, t: SdkType, lt: LType, what: string): E {
  const s = cStruct(t);
  const c = s ? cpp.call("lucent::objc::structFromBytes", [code], [cpp.type(s)]) : code;
  return fromObjc(em, c, t, lt, what);
}

/** A class's name in Swift: a Swift type's own, an Objective-C class's Swift name. */
function swiftClassName(module: string, cls: SdkClassSchema): string {
  return cls.swift ? cls.native : `${module}.${cls.name.replace(/_/g, ".")}`;
}

/**
 * How values of a type cross: scalars, enums as their case index, or
 * objects. Whether they can is the plans' (requireCrossing).
 */
export function crossing(t: SdkType): Crossing {
  if (t.k === "prim") return "scalar";
  if (t.k === "ref" && sdkTypeInfo("ios", t.module, t.name)?.kind === "enum") return "enum";
  return "object";
}

/**
 * The binding plans' verdict on a value a use specialized with its type
 * arguments passes (`in`) or gets back (`out`): the member's own plan was
 * checked where it is used, but not with these types.
 */
function requireCrossing(t: SdkType, node: ts.Node, flow: "in" | "out"): void {
  const reason = takenReason([swiftConversion(t, flow)], 1);
  if (reason) fail(node, Codes.UnsupportedType, reason);
}

// --- the glue's side -------------------------------------------------------------------

/** The C type a value crosses as. */
export function cType(t: SdkType): cpp.Type {
  switch (crossing(t)) {
    case "scalar":
      return cpp.type(SCALARS[(t as SdkType & { k: "prim" }).name]!.c);
    case "enum":
      return cpp.type("NSInteger");
    case "object":
      return cpp.pointer(cpp.voidType);
  }
}

const bridge = (x: cpp.Expr) => cpp.cast("bridge", cpp.pointer(cpp.voidType), x);

/** A Swift member called with the program's arguments. */
export function swiftCall(
  em: FnEmitter,
  generic: SwiftUse,
  receiver: E | undefined,
  args: readonly ts.Expression[],
): E {
  // Default arguments the call leaves out: a shim that leaves them out too.
  const given = Math.max(args.length, generic.required);
  const use = specialize(em, {
    ...generic,
    params: generic.params.slice(0, given),
    labels: generic.labels.slice(0, given),
  });
  use.params.forEach((t, i) => requireCrossing(t, args[i]!, "in"));
  if (!isVoid(use.ret)) requireCrossing(use.ret, use.node, "out");

  const member = { display: use.what };
  const values = use.params.map((t, i): cpp.Expr => {
    const a = args[i]!;
    switch (crossing(t)) {
      case "scalar":
        return numberToNative(t, cType(t), em.exprAs(a, primLt(t)), argumentWhat(em, a));
      case "enum":
        return cpp.staticCast(cpp.type("NSInteger"), em.exprAs(a, T.number));
      case "object":
        if (cStruct(t)) return cpp.call("lucent::objc::structBytes", [toObjc(em, a, t, member)]);
        if (!hasUnion(t)) return toObjc(em, a, t, member);
        // Unions convert from the parameter's declared type (the argument's may be a case).
        return unionToObjc(em, use, t, em.exprAs(a, declaredTypes(em, use).params[i]!), i);
    }
  });
  // An async member's AbortSignal, after the arguments Swift takes.
  const signal = use.member.async ? args[generic.params.length] : undefined;
  return invoke(
    em,
    use,
    receiver,
    values,
    signal && em.exprAs(signal, unionOf([T.abortSignal, T.undefined])),
  );
}

/** A Swift property set to `value` (of the property's Lucent type): gives the value. */
export function swiftSet(
  em: FnEmitter,
  generic: SwiftUse,
  receiver: E | undefined,
  value: cpp.Expr,
): cpp.Expr {
  const use = specialize(em, generic);
  const t = use.params[0]!;
  requireCrossing(t, use.node, "in");

  const v = cpp.id("v_");
  const converted = (() => {
    switch (crossing(t)) {
      case "scalar":
        return numberToNative(t, cType(t), v, use.what);
      case "enum":
        return cpp.staticCast(cpp.type("NSInteger"), v);
      case "object":
        if (hasUnion(t)) return unionToObjc(em, use, t, v, 0);
        return t.nullable
          ? ifPresent(v, (x) => toObjcExpr({ ...t, nullable: false } as SdkType, x, false))
          : objectOf(t, v);
    }
  })();
  const set = invoke(em, use, receiver, [converted]);
  return cpp.statementExpr(
    [cpp.varDecl(cpp.auto, "v_", value), cpp.exprStmt(cpp.cast("c", cpp.voidType, set.c))],
    v,
  );
}

/**
 * Calls the shim: objects held in locals for the call; a synchronous
 * member's error rethrown and result read back, an async member's promise.
 */
function invoke(
  em: FnEmitter,
  use: SwiftUse,
  receiver: E | undefined,
  values: cpp.Expr[],
  signal?: cpp.Expr,
): E {
  const shim = register(em, use);
  const locals: cpp.Stmt[] = [];
  const args: cpp.Expr[] = [];
  if (receiver) {
    locals.push(
      cpp.varDecl(cpp.type("id"), "self_", cpp.call("lucent::objc::unwrap", [receiver.c])),
    );
    args.push(bridge(cpp.id("self_")));
  }
  use.params.forEach((t, i) => {
    if (crossing(t) !== "object") return args.push(values[i]!);
    locals.push(cpp.varDecl(cpp.type("id"), `a${i}_`, values[i]!));
    args.push(bridge(cpp.id(`a${i}_`)));
  });
  return use.member.async
    ? later(em, use, shim, locals, args, signal)
    : now(em, use, shim, locals, args);
}

export const returnsNothing = (use: { role: SwiftUse["role"]; ret: SdkType }) =>
  use.role === "set" || isVoid(use.ret);

/** The result `r` (as the shim returned it: owned objects taken) as a Lucent value. */
function resultOf(em: FnEmitter, use: SwiftUse, r: cpp.Expr): E {
  const ret = use.ret;
  if (returnsNothing(use)) return { c: cpp.id("lucent::undefined"), t: T.undefined };
  if (crossing(ret) === "enum") return { c: cpp.staticCast(cpp.type("double"), r), t: T.number };
  const lt: LType =
    use.role === "init" && ret.k === "ref"
      ? { k: "native", platform: "ios", module: ret.module, name: ret.name }
      : hasUnion(ret) || cStruct(ret)
        ? declaredTypes(em, use).ret
        : declaredLt(em, "ios", ret, use.node);
  return valueOf(em, r, ret, lt, use.what);
}

/** `r_`: the shim's result, as its C type; objects handed to ARC. */
function taken(use: SwiftUse, v: cpp.Expr): cpp.Stmt {
  return crossing(use.ret) === "object"
    ? cpp.varDecl(cpp.type("id"), "r_", cpp.cast("bridge_transfer", cpp.type("id"), v))
    : cpp.varDecl(cType(use.ret), "r_", v);
}

/** The error a shim passed back (retained), handed to ARC. */
const takenError = (e: cpp.Expr) =>
  cpp.cast("bridge_transfer", cpp.pointer(cpp.type("NSError")), e);

/** A synchronous call: its result, or its error thrown. */
function now(
  em: FnEmitter,
  use: SwiftUse,
  shim: SwiftShim,
  locals: cpp.Stmt[],
  args: cpp.Expr[],
): E {
  const throws = !!use.member.throws;
  if (throws) {
    locals.push(cpp.varDecl(cpp.pointer(cpp.voidType), "err_", cpp.nullptr));
    args.push(cpp.addressOf(cpp.id("err_")));
  }
  const call = cpp.call(shim.symbol, args);
  const rethrow = throws
    ? [cpp.exprStmt(cpp.call("lucent::objc::throwIfError", [takenError(cpp.id("err_"))]))]
    : [];
  const value = resultOf(em, use, cpp.id("r_"));
  if (returnsNothing(use))
    return {
      c: cpp.statementExpr([...locals, cpp.exprStmt(call), ...rethrow], value.c),
      t: value.t,
    };
  return { c: cpp.statementExpr([...locals, taken(use, call), ...rethrow], value.c), t: value.t };
}

/**
 * An async call: a native operation of the calling context (operation.h),
 * which the shim's task settles through a C callback: on the Lucent
 * thread, with the result converted there, unless the operation is no
 * longer pending (its signal aborted, or its scope disposed), when what
 * the task produced is released. The operation's cleanup cancels the
 * task (a no-op once it is done) and releases it.
 */
function later(
  em: FnEmitter,
  use: SwiftUse,
  shim: SwiftShim,
  locals: cpp.Stmt[],
  args: cpp.Expr[],
  signal: cpp.Expr | undefined,
): E {
  const value = resultOf(em, use, cpp.id("r_"));
  const inner = em.reg.cppType(value.t);
  const operation = cpp.type("std::shared_ptr", cpp.type("lucent::Operation", inner));
  const pending = cpp.type("std::weak_ptr", cpp.type("lucent::Operation", inner));
  const raw = cpp.pointer(cpp.voidType);
  const nothing = returnsNothing(use);
  em.ctx.nativeUnit(em.opts.module).include("lucent/operation.h");

  const op = cpp.id("op_");
  const failed = (error: cpp.Expr) => cpp.exprStmt(cpp.call(cpp.arrow(op, "fail"), [error]));
  const settle = cpp.lambda(
    ["w_", ...(nothing ? [] : ["r_"]), "err_"],
    [],
    [
      cpp.varDecl(cpp.auto, "op_", cpp.call(cpp.dot(cpp.id("w_"), "lock"))),
      cpp.ifStmt(cpp.unary("!", op), [cpp.ret()]),
      cpp.ifStmt(cpp.id("err_"), [
        failed(cpp.call("lucent::objc::fromNSError", [cpp.id("err_"), cpp.str(use.what)])),
        cpp.ret(),
      ]),
      {
        k: "try",
        body: [cpp.exprStmt(cpp.call(cpp.arrow(op, "succeed"), [value.c]))],
        catches: [
          {
            body: [failed(cpp.call("lucent::currentError", [cpp.call("std::current_exception")]))],
          },
        ],
      },
    ],
  );
  const done = cpp.lambda(
    [],
    [
      cpp.param(raw, "ctx_"),
      ...(nothing ? [] : [cpp.param(cType(use.ret), "v_")]),
      cpp.param(raw, "e_"),
    ],
    [
      cpp.varDecl(
        cpp.auto,
        "w_",
        cpp.deref(
          cpp.construct(cpp.type("std::unique_ptr", pending), [
            cpp.staticCast(cpp.pointer(pending), cpp.id("ctx_")),
          ]),
        ),
      ),
      ...(nothing ? [] : [taken(use, cpp.id("v_"))]),
      cpp.varDecl(cpp.pointer(cpp.type("NSError")), "err_", takenError(cpp.id("e_"))),
      cpp.exprStmt(cpp.call("lucent::postCallback", [settle])),
    ],
  );
  // Starts the task; what ends it, once the operation settles.
  const start = cpp.lambda(
    ["&"],
    [cpp.param(cpp.reference(cpp.constType(operation)), "op_")],
    [
      cpp.varDecl(raw, "task_", cpp.call(shim.symbol, [...args, cpp.newExpr(pending, [op]), done])),
      cpp.ret(cpp.lambda(["task_"], [], [cpp.exprStmt(cpp.call(SWIFT_CANCEL, [cpp.id("task_")]))])),
    ],
    { ret: cpp.type("std::function", cpp.fnType(cpp.voidType, [])) },
  );
  const started = cpp.call(
    "lucent::nativeOperation",
    [start, ...(signal ? [signal] : [])],
    [inner],
  );
  return {
    c: cpp.statementExpr(locals, started),
    t: { k: "promise", inner: value.t },
  };
}

/** The shims file's function that cancels an async shim's task and releases it. */
const SWIFT_CANCEL = "lucent_swift_cancel";

// --- generics: a shim per specialization ---------------------------------------------------

/**
 * A use of a generic member (or a member of a generic type) on the type
 * arguments the checker resolved: the receiver's, and the call's.
 */
function specialize(em: FnEmitter, use: SwiftUse): SwiftUse {
  const own = use.typeParams ?? [];
  const ownerParams = use.owner?.typeParams ?? [];
  if (!own.length && !ownerParams.length) return use;
  const checker = em.checker;
  const node = use.node;
  const bound = new Map<string, SdkType>();
  const bind = (names: readonly string[], types: readonly ts.Type[] | undefined) =>
    names.map((name, i) => {
      const t = types?.[i];
      if (!t) fail(node, Codes.UnsupportedCall, `${use.what}: its type arguments are not known`);
      const arg = sdkTypeOf(em, t, node);
      bound.set(name, arg);
      return arg;
    });
  const receiver = (n: ts.Node): ts.Node =>
    ts.isCallExpression(n)
      ? receiver(n.expression)
      : ts.isPropertyAccessExpression(n)
        ? n.expression
        : n;
  // A static's come from its extension; an instance member's, from its receiver.
  const fixed = use.static ? use.member.ownerArgs : undefined;
  fixed?.forEach((t, i) => bound.set(ownerParams[i]!, t));
  const ownerArgs = fixed
    ? fixed
    : ownerParams.length
      ? bind(
          ownerParams,
          checker.getTypeArguments(
            checker.getTypeAtLocation(
              use.role === "init" ? node : receiver(node),
            ) as ts.TypeReference,
          ),
        )
      : undefined;
  const typeArgs = own.length
    ? bind(
        own,
        checker.getTypeArgumentsForResolvedSignature(
          checker.getResolvedSignature(node as ts.CallExpression)!,
        ),
      )
    : undefined;
  const ret =
    use.role === "init" && use.ret.k === "ref" ? { ...use.ret, args: ownerArgs } : use.ret;
  return {
    ...use,
    params: use.params.map((p) => substitute(p, bound)),
    ret: substitute(ret, bound),
    ...(ownerArgs ? { ownerArgs } : {}),
    ...(typeArgs ? { typeArgs } : {}),
  };
}

/** A TypeScript type (a type argument) as the schema type of the Swift type it stands for. */
export function sdkTypeOf(em: FnEmitter, t: ts.Type, node: ts.Node): SdkType {
  const checker = em.checker;
  const F = ts.TypeFlags;
  const prim = (name: "double" | "bool") => ({ k: "prim", name, nullable: false }) as SdkType;
  if (t.flags & F.BooleanLike) return prim("bool");
  if (t.flags & F.NumberLike) return prim("double");
  if (t.flags & F.StringLike) return { k: "string", nullable: false };
  if (t.isUnion()) {
    const present = t.types.filter((x) => !(x.flags & (F.Null | F.Undefined)));
    if (present.length === 1 && present.length < t.types.length)
      return { ...sdkTypeOf(em, present[0]!, node), nullable: true };
  }
  if (checker.isArrayType(t)) {
    const [e] = checker.getTypeArguments(t as ts.TypeReference);
    return { k: "array", of: sdkTypeOf(em, e!, node), nullable: false };
  }
  // SDK classes and unions (Swift enums with payloads), with their type arguments.
  const symbol = t.aliasSymbol ?? t.getSymbol();
  const decl = symbol?.declarations?.[0];
  const sdk = decl ? sdkModuleOf(decl.getSourceFile()) : undefined;
  if (symbol && sdk?.platform === "ios") {
    const args = t.aliasSymbol
      ? t.aliasTypeArguments
      : t.flags & F.Object && (t as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
        ? checker.getTypeArguments(t as ts.TypeReference)
        : undefined;
    return {
      k: "ref",
      module: sdk.module,
      name: symbol.name,
      nullable: false,
      ...(args?.length ? { args: args.map((a) => sdkTypeOf(em, a, node)) } : {}),
    };
  }
  if (symbol?.name === "Uint8Array") return { k: "bytes", nullable: false };
  if (symbol?.name === "Date") return { k: "date", nullable: false };
  return fail(
    node,
    Codes.UnsupportedType,
    `${checker.typeToString(t)} cannot be a Swift type argument yet`,
  );
}

// --- enums with payloads: unions in Lucent -----------------------------------------------

/**
 * The Lucent types of a use's parameters and result as its declaration
 * says: an enum with payloads is the union the SDK declarations make of it,
 * which the schema cannot say.
 */
function declaredTypes(em: FnEmitter, use: SwiftUse): { params: LType[]; ret: LType } {
  const checker = em.checker;
  const lower = (t: ts.Type) =>
    em.reg.lower(use.member.async ? (checker.getAwaitedType(t) ?? t) : t, use.node);
  const node = use.node;
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    const sig = checker.getResolvedSignature(node)!;
    return {
      params: sig.getParameters().map((p) => em.reg.lower(checker.getTypeOfSymbol(p), node)),
      ret: lower(sig.getReturnType()),
    };
  }
  const name = ts.isPropertyAccessExpression(node) ? node.name : node;
  const type = lower(checker.getTypeOfSymbol(checker.getSymbolAtLocation(name)!));
  return { params: [type], ret: type };
}

/** The union part of a type, without null. */
function withoutNull(lt: LType): LType {
  if (lt.k === "opt") return lt.inner;
  if (lt.k !== "union") return lt;
  return unionOf(lt.ms.filter((m) => m.k !== "null" && m.k !== "undefined"));
}

/** A value `c` (of its declared Lucent type) as the object parameter `i` crosses as. */
function unionToObjc(em: FnEmitter, use: SwiftUse, t: SdkType, c: cpp.Expr, i: number): cpp.Expr {
  if (t.nullable) throw new Error(`${use.what}: an optional union its plan refuses`);
  registerUnions(em, t, declaredTypes(em, use).params[i]!);
  return toObjcExpr(t, c, false);
}

/** A case's dictionary `code` (enum `t`) as the union `lt`; null for nil when `lt` allows it. */
export function swiftUnionFromObjc(em: FnEmitter, code: cpp.Expr, t: SdkType, lt: LType): E {
  const inner = withoutNull(lt);
  const read = (o: cpp.Expr) => cpp.call(registerUnion(em, t, inner), [o]);
  if (typeKey(inner) === typeKey(lt)) return { c: read(code), t: lt };
  const u = cpp.id("u_");
  const value = cpp.conditional(
    u,
    em.coerce({ c: read(u), t: inner }, lt),
    em.coerce({ c: cpp.id("lucent::null"), t: T.null }, lt),
  );
  return { c: cpp.statementExpr([cpp.varDecl(cpp.type("id"), "u_", code)], value), t: lt };
}

/** Registers the converters of the unions a type holds, as their Lucent types (`lt`) say. */
export function registerUnions(em: FnEmitter, t: SdkType, lt: LType): void {
  const inner = withoutNull(lt);
  if ((t.k === "array" && inner.k === "array") || (t.k === "record" && inner.k === "dict"))
    return registerUnions(em, t.of, inner.k === "array" ? inner.e : inner.val);
  if (isPayloadEnum(t)) registerUnion(em, t, inner);
}

/**
 * The glue's converters between union `lt` and the dictionaries enum `t`
 * crosses as (`{"kind": case, field: payload…}`): `lucentSwiftObject`, an
 * overload per union, and a reader per union, whose name it gives.
 */
function registerUnion(em: FnEmitter, t: SdkType, lt: LType): string {
  const e = payloadEnum(t)!;
  const key = typeKey(lt);
  const reader = `lucentSwiftValue_${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
  const unit = em.ctx.nativeUnit(em.opts.module);
  if (unit.decls.has(`swift union ${key}`)) return reader;
  const type = em.reg.cppType(lt);
  const [v, o, x] = [cpp.id("v"), cpp.id("o"), cpp.id("x")];
  const toObject = (body?: cpp.Stmt[]) =>
    cpp.fn(
      "lucentSwiftObject",
      cpp.type("id"),
      [cpp.param(cpp.reference(cpp.constType(type)), "v")],
      body,
      { static: true },
    );
  const fromObject = (body?: cpp.Stmt[]) =>
    cpp.fn(reader, type, [cpp.param(cpp.type("id"), "o")], body, { static: true });
  // Declared first: unions nest, and an indirect enum holds itself.
  unit.add(`swift union ${key}`, [toObject(), fromObject()]);
  const structs = (lt.k === "union" ? lt.ms : [lt]).filter((m) => m.k === "struct");
  // Object types are keyed by shape: cases with the same payload fields
  // (`{ kind: "pending" }`, `{ kind: "userCancelled" }`) are one, whose kind
  // is any of theirs.
  const kind = (m: LType & { k: "struct" }) =>
    em.reg.struct(m.id).fields.find((f) => f.name === "kind");
  const shape = (m: LType & { k: "struct" }) =>
    em.reg
      .struct(m.id)
      .fields.map((f) => f.name)
      .sort()
      .join();
  const cases = e.cases.map((c) => {
    const fieldNames = ["kind", ...payloadFields(c.params)].sort().join();
    const struct =
      structs.find((m) => kind(m)?.literal === c.name) ??
      structs.find((m) => kind(m) && kind(m)!.literal === undefined && shape(m) === fieldNames);
    if (!struct) throw new Error(`${e.name}.${c.name} is not in ${key}`);
    const info = em.reg.struct(struct.id);
    const fields = payloadFields(c.params).map((name, i) => {
      const field = info.fields.find((f) => f.name === name)!;
      registerUnions(em, c.params[i]!.type, field.type);
      return { name, t: c.params[i]!.type, lt: field.type };
    });
    return { c, struct, info, fields };
  });
  const single = lt.k === "struct";
  const alternatives = [...new Map(cases.map((x) => [x.struct.id, x])).values()];
  const toObjectBody: cpp.Stmt[] = alternatives.map(({ c, struct, fields }) => {
    const shared = kind(struct)!.literal === undefined;
    const object = (s: cpp.Expr) =>
      cpp.call("lucent::objc::swiftCase", [
        shared ? cpp.arrow(s, "kind") : cpp.str(c.name),
        cpp.initList(
          fields.map((f) => {
            const field = cpp.arrow(s, cppIdent(f.name));
            const object = f.t.nullable
              ? ifPresent(field, (y) => boxed(f.t, y))
              : boxed(f.t, field);
            return cpp.initList([cpp.str(f.name), object]);
          }),
        ),
      ]);
    if (single) return cpp.ret(object(v));
    return {
      k: "if",
      bind: { type: cpp.auto, name: "x" },
      test: cpp.call("std::get_if", [cpp.addressOf(v)], [em.reg.cppType(struct)]),
      body: [cpp.ret(object(cpp.deref(x)))],
    };
  });
  const fromObjectBody: cpp.Stmt[] = cases.map(({ c, struct, info, fields }) => {
    // Numbers and enums from their NSNumbers; the rest as any value of their type.
    const read = (f: (typeof fields)[number]) =>
      f.t.k === "prim" || swiftEnum(f.t)
        ? fromObjcItem(em, f.t, f.lt, `${e.name}.${c.name}`)
        : fromObjc(em, cpp.id("e_"), f.t, f.lt, `${e.name}.${c.name}`).c;
    const item = (f: (typeof fields)[number]) =>
      cpp.statementExpr(
        [
          cpp.varDecl(
            cpp.type("id"),
            "e_",
            cpp.call("lucent::objc::swiftPayload", [o, cpp.str(f.name)]),
          ),
        ],
        read(f),
      );
    const made = single
      ? x
      : cpp.construct(type, [cpp.templateId("std::in_place_type", [em.reg.cppType(struct)]), x]);
    return cpp.ifStmt(cpp.call("lucent::objc::isSwiftCase", [o, cpp.str(c.name)]), [
      cpp.varDecl(
        cpp.auto,
        "x",
        cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]),
      ),
      cpp.exprStmt(cpp.assign(cpp.arrow(x, "kind"), stringExpr(c.name))),
      ...fields.map((f) => cpp.exprStmt(cpp.assign(cpp.arrow(x, cppIdent(f.name)), item(f)))),
      cpp.ret(made),
    ]);
  });
  unit.add(`swift union body ${key}`, [
    toObject([...toObjectBody, ...(single ? [] : [cpp.ret(cpp.id("nil"))])]),
    fromObject([
      ...fromObjectBody,
      cpp.exprStmt(cpp.call("lucent::objc::unknownSwiftCase", [o, cpp.str(e.name)])),
    ]),
  ]);
  return reader;
}

/** The shim a use calls: registered once, and declared in the glue that calls it. */
function register(em: FnEmitter, use: SwiftUse): SwiftShim {
  const args = use.ownerArgs?.length
    ? `<${use.ownerArgs.map((a) => swift.printType(swiftType(a))).join(", ")}>`
    : "";
  const owner = use.owner && {
    // A protocol's members are called on its existential.
    name: `${use.owner.interface ? "any " : ""}${swiftClassName(use.module, use.owner)}${args}`,
    boxed: use.owner.swift?.kind === "struct" || use.owner.swift?.kind === "enum",
  };
  const key = [
    use.module,
    owner?.name ?? "",
    use.role,
    use.static ? "static" : "",
    use.member.name,
    `${use.params.length}`,
    ...(use.typeArgs ?? []).map((a) => formatSchemaType(a)),
  ];
  const hash = createHash("sha1").update(key.join("|")).digest("hex").slice(0, 12);
  const symbol = `lucent_swift_${hash}`;
  // The glue: the Lucent runtime's conversions, the Objective-C classes the values name.
  const unit = em.ctx.nativeUnit(em.opts.module);
  unit.include("lucent/platform/ios.h");
  linkModule(em, loadSdkModule("ios", use.module));
  for (const t of [...use.params, use.ret]) noteObjcModules(em, t);
  let shim = em.ctx.swiftShims.get(symbol);
  if (!shim) {
    shim = {
      symbol,
      module: use.module,
      role: use.role,
      ...(owner ? { owner } : {}),
      static: use.static,
      member: use.member,
      params: use.params,
      labels: use.labels,
      ret: use.ret,
      ...(use.mainActor ? { mainActor: true } : {}),
      ...(use.typeArgs || use.ownerArgs ? { generic: true } : {}),
      ...(use.since ? { since: use.since } : {}),
    };
    em.ctx.swiftShims.set(symbol, shim);
  }
  unit.add(`swift ${symbol}`, [{ k: "externC", body: [declaration(shim)] }]);
  if (shim.member.async)
    unit.add(`swift ${SWIFT_CANCEL}`, [
      {
        k: "externC",
        body: [cpp.fn(SWIFT_CANCEL, cpp.voidType, [cpp.param(cpp.pointer(cpp.voidType), "task")])],
      },
    ]);
  return shim;
}

/** Imports the headers of the Objective-C classes a type names (the glue casts to them). */
function noteObjcModules(em: FnEmitter, t: SdkType): void {
  if (t.k === "array" || t.k === "record") return noteObjcModules(em, t.of);
  if (t.k !== "ref") return;
  const info = sdkTypeInfo("ios", t.module, t.name);
  if (info && !info.swift && info.kind !== "enum") noteFramework(em, t.module);
}

const hasSelf = (s: SwiftShim) => !!s.owner && !s.static && s.role !== "init";

/** The shim's C declaration, for the glue. */
function declaration(s: SwiftShim): cpp.Decl {
  const raw = cpp.pointer(cpp.voidType);
  const params: cpp.Param[] = [];
  if (hasSelf(s)) params.push(cpp.param(raw, "self_"));
  s.params.forEach((t, i) => params.push(cpp.param(cType(t), `a${i}`)));
  const result = returnsNothing(s) ? [] : [cType(s.ret)];
  if (s.member.async) {
    // The promise, and the callback that settles it: (promise, result, error).
    const done = cpp.fnType(cpp.voidType, [raw, ...result, raw]);
    params.push(
      cpp.param(raw, "ctx_"),
      cpp.param(cpp.pointer(cpp.type("std::type_identity_t", done)), "done_"),
    );
    // The task, retained: cancelled and released through SWIFT_CANCEL.
    return cpp.fn(s.symbol, raw, params);
  }
  if (s.member.throws) params.push(cpp.param(cpp.pointer(raw), "error_"));
  return cpp.fn(s.symbol, result[0] ?? cpp.voidType, params);
}

// --- the Swift side --------------------------------------------------------------------

export const n = swift.name;
export const raw = swift.type("UnsafeMutableRawPointer");
export const call1 = (f: string, value: swift.Expr) => swift.call(n(f), [{ value }]);
export const each = (v: swift.Expr, method: string, body: swift.Expr) =>
  swift.call(swift.member(v, method), [], swift.closure([], [swift.ret(body)]));

/** A type's name in Swift. */
export function swiftType(t: SdkType): swift.Type {
  const type = bareSwiftType(t);
  return t.nullable ? swift.optional(type) : type;
}

function bareSwiftType(t: SdkType): swift.Type {
  switch (t.k) {
    case "prim":
      return swift.type(SCALARS[t.name]!.swift);
    case "string":
      return swift.type("String");
    case "bytes":
      return swift.type("Data");
    case "date":
      return swift.type("Date");
    case "id":
      return swift.type("Any");
    case "array":
      return swift.array(swiftType(t.of));
    case "record":
      return swift.dictionary(swift.type("String"), swiftType(t.of));
    // A closure as the Objective-C block it crosses as.
    case "fn":
      return swift.blockFunction(
        t.params.map(swiftType),
        t.ret.k === "prim" && t.ret.name === "void" ? swift.type("Void") : swiftType(t.ret),
      );
    case "ref": {
      const info = sdkTypeInfo("ios", t.module, t.name);
      // C structs by their C name: the Clang module declaring them may not be their schema's.
      if (info?.kind === "struct") return swift.type(info.native);
      const name = info?.swift ? info.native : `${t.module}.${t.name.replace(/_/g, ".")}`;
      return swift.type(
        info?.kind === "protocol" ? `any ${name}` : name,
        ...(t.args ?? []).map(swiftType),
      );
    }
    default:
      throw new Error(`no Swift type for ${t.k}`);
  }
}

/** Whether a Swift value of this type is boxed: structs (enums with payloads are unions). */
function isBoxed(t: SdkType): boolean {
  if (t.k !== "ref" || !sdkTypeInfo("ios", t.module, t.name)?.swift) return false;
  const cls = findSdkType("ios", t.module, t.name);
  const kind = cls?.kind === "class" ? cls.swift?.kind : undefined;
  return kind === "struct" || (kind === "enum" && !(cls as SdkClassSchema).swift!.cases);
}

/** Whether a type is a protocol's: its values are existentials (`any P`). */
const isProtocol = (t: SdkType) =>
  t.k === "ref" && sdkTypeInfo("ios", t.module, t.name)?.kind === "protocol";

/** Whether a type is a protocol's with associated types or `Self` requirements: Swift opens its values. */
const isOpened = (t: SdkType) => {
  if (t.k !== "ref" || !isProtocol(t)) return false;
  const cls = findSdkType("ios", t.module, t.name);
  return cls?.kind === "class" && !!cls.swift?.associatedTypes;
};

/** The Swift file's functions between an enum with payloads and its case's dictionary. */
const unionFunction = (e: { name: string }, to: "Object" | "Value") =>
  `lucent${to}_${e.name.replace(/\W/g, "_")}`;

/** Values Foundation bridges as they are. */
const bridges = (t: SdkType): boolean => ["prim", "string", "bytes", "date", "id"].includes(t.k);

/** `[Palette.red, Palette.green, …]`: what an index picks from. */
export const casesOf = (e: { name: string; cases: string[] }) =>
  swift.arrayLiteral(e.cases.map((c) => swift.member(n(e.name), c)));

/** An enum case's index (-1 for cases added after the program was built). */
export const indexOf = (e: { name: string; cases: string[] }, v: swift.Expr) =>
  swift.binary(
    swift.call(swift.member(casesOf(e), "firstIndex"), [{ label: "of", value: v }]),
    "??",
    swift.num(-1),
  );

/** The Swift value of type `t` an object `o` holds. */
export function fromObject(t: SdkType, o: swift.Expr): swift.Expr {
  const cast = (type: swift.Type) => swift.cast(o, "as!", type);
  if (bridges(t)) return t.k === "id" ? o : cast(swiftType(t));
  switch (t.k) {
    case "array":
      if (bridges(t.of)) return cast(swiftType(t));
      return each(cast(swift.array(swift.type("AnyObject"))), "map", fromObject(t.of, n("$0")));
    case "record":
      if (bridges(t.of)) return cast(swiftType(t));
      return each(
        cast(swift.dictionary(swift.type("String"), swift.type("AnyObject"))),
        "mapValues",
        fromObject(t.of, n("$0")),
      );
    // A Lucent function: the block it crosses as, which Swift calls as a closure.
    case "fn":
      return swift.call(n("unsafeBitCast"), [
        { value: o },
        { label: "to", value: n(`(${swift.printType(swiftType(t))}).self`) },
      ]);
    // A tuple crosses as an array of its elements' objects.
    case "tuple": {
      const items = cast(swift.array(swift.type("AnyObject")));
      return swift.tupleLiteral(
        t.of.map((x, i) => fromObject(x, swift.index(items, swift.num(i)))),
      );
    }
    case "ref": {
      const e = swiftEnum(t);
      if (e) return swift.index(casesOf(e), swift.member(cast(swift.type("NSNumber")), "intValue"));
      const u = payloadEnum(t);
      if (u) return call1(unionFunction(u, "Value"), o);
      // A C struct: its bytes.
      if (cStruct(t)) {
        const load = swift.call(swift.member(n("$0"), "loadUnaligned"), [
          { label: "as", value: n(`${swift.printType(swiftType(t))}.self`) },
        ]);
        return each(cast(swift.type("Data")), "withUnsafeBytes", load);
      }
      if (isBoxed(t)) return swift.member(cast(swift.type("LucentBox", swiftType(t))), "value");
      return cast(swiftType(t));
    }
    default:
      throw new Error(`no Swift form for ${t.k}`);
  }
}

/** An object for the Swift value `v` of type `t`. */
function toObject(t: SdkType, v: swift.Expr): swift.Expr {
  const as = (x: swift.Expr, type: string) => swift.cast(x, "as", swift.type(type));
  switch (t.k) {
    case "prim":
      return as(v, "NSNumber");
    case "string":
      return as(v, "NSString");
    case "bytes":
      return as(v, "NSData");
    case "date":
      return as(v, "NSDate");
    case "id":
      return as(v, "AnyObject");
    case "array":
      return as(bridges(t.of) ? v : each(v, "map", toObject(t.of, n("$0"))), "NSArray");
    case "record":
      return as(bridges(t.of) ? v : each(v, "mapValues", toObject(t.of, n("$0"))), "NSDictionary");
    // A Swift closure: as a block, an object.
    case "fn":
      return swift.call(n("unsafeBitCast"), [
        { value: swift.cast(v, "as", swiftType(t)) },
        { label: "to", value: n("AnyObject.self") },
      ]);
    case "tuple":
      return as(
        swift.arrayLiteral(
          t.of.map((x, i) => as(toObject(x, swift.member(v, String(i))), "AnyObject")),
        ),
        "NSArray",
      );
    case "ref": {
      const e = swiftEnum(t);
      if (e) return swift.call(n("NSNumber"), [{ label: "value", value: indexOf(e, v) }]);
      const u = payloadEnum(t);
      if (u) return call1(unionFunction(u, "Object"), v);
      if (isProtocol(t)) return as(v, "AnyObject");
      if (cStruct(t))
        return as(
          swift.call(
            n("withUnsafeBytes"),
            [{ label: "of", value: v }],
            swift.closure([], [swift.ret(call1("Data", n("$0")))]),
          ),
          "NSData",
        );
      return isBoxed(t) ? call1("LucentBox", v) : v;
    }
    default:
      throw new Error(`no Objective-C form for ${t.k}`);
  }
}

export const nonNull = (t: SdkType) => ({ ...t, nullable: false }) as SdkType;

/** The shim's parameter `p` as the Swift value of type `t` it carries. */
function paramValue(t: SdkType, p: string): swift.Expr {
  if (t.k === "prim") return n(p);
  const e = swiftEnum(t);
  if (e) return swift.index(casesOf(e), n(p));
  if (t.nullable) return each(n(p), "map", fromObject(nonNull(t), call1("lucentObject", n("$0"))));
  return fromObject(t, call1("lucentObject", n(p)));
}

/** A Swift result `v` of type `t` as the shim returns it. */
export function resultValue(t: SdkType, v: swift.Expr): swift.Expr {
  if (t.k === "prim") return v;
  const e = swiftEnum(t);
  if (e) return indexOf(e, v);
  if (t.nullable) return each(v, "map", call1("lucentRetained", toObject(nonNull(t), n("$0"))));
  return call1("lucentRetained", toObject(t, v));
}

/** The type of the shim's parameter or result for a value of type `t`. */
export function shimType(t: SdkType, optional = false): swift.Type {
  if (t.k === "prim") return swift.type(SCALARS[t.name]!.swift);
  if (swiftEnum(t)) return swift.type("Int");
  return t.nullable || optional ? swift.optional(raw) : raw;
}

/** `distance(to:)` → the labels of a call's arguments (none for `_`). */
export function swiftLabels(name: string): (string | undefined)[] {
  const parts = (/\((.*)\)$/.exec(name)?.[1] ?? "").split(":").slice(0, -1);
  return parts.map((p) => (p && p !== "_" ? p : undefined));
}

export const baseName = (name: string) => name.replace(/\(.*$/, "");

function shimFunction(s: SwiftShim): swift.Decl {
  const params: swift.Param[] = [];
  if (hasSelf(s)) params.push({ external: "_", name: "self_", type: raw });
  s.params.forEach((t, i) => params.push({ external: "_", name: `a${i}`, type: shimType(t) }));
  const [async, throws] = [!!s.member.async, !!s.member.throws];
  const owner = s.owner;
  // An async member's task runs after the shim returns, and the arguments
  // are borrowed for the call only: it gets their Swift values.
  const prelude: swift.Stmt[] = [];
  const bound = (name: string, value: swift.Expr) => {
    prelude.push(swift.letStmt(name, value));
    return n(name);
  };
  const later = (name: string, value: swift.Expr) => (async ? bound(name, value) : value);
  const receiver = () => {
    const type = swift.type(owner!.name);
    const o = later(
      "o_",
      swift.cast(
        call1("lucentObject", n("self_")),
        "as!",
        owner!.boxed ? swift.type("LucentBox", type) : type,
      ),
    );
    return owner!.boxed ? swift.member(o, "value") : o;
  };
  const self = !owner ? n(s.module) : hasSelf(s) ? receiver() : n(owner.name);
  // Scalars and enums' indexes are values already.
  // A protocol with associated types is opened from a variable: Swift does
  // not open a cast (`x as! any P`) it is passed.
  const args = s.params.map((t, i) =>
    t.k === "prim" || swiftEnum(t)
      ? paramValue(t, `a${i}`)
      : isOpened(t)
        ? bound(`v${i}`, paramValue(t, `a${i}`))
        : later(`v${i}`, paramValue(t, `a${i}`)),
  );
  const labelled = s.labels.map((label, i) => ({
    ...(label ? { label } : {}),
    value: args[i]!,
  }));
  const target: swift.Expr = (() => {
    switch (s.role) {
      case "init":
        return swift.call(self, labelled);
      case "get":
        // ContiguousBytes' bytes: copied out of the value.
        return s.member.bytes
          ? each(self, "withUnsafeBytes", call1("Data", n("$0")))
          : swift.member(self, s.member.name);
      case "set":
        return swift.assign(swift.member(self, s.member.name), args[0]!);
      case "call":
        return swift.call(swift.member(self, baseName(s.member.name)), labelled);
    }
  })();
  const awaited = async ? swift.awaitExpr(target) : target;
  const effect = throws ? swift.tryExpr(awaited) : awaited;
  const returns = !returnsNothing(s);
  // A specialization spells out its result's type: a type parameter only
  // the result has is inferred from it.
  const resultType =
    !s.generic || !returns
      ? undefined
      : s.role === "init"
        ? swift.type(owner!.name)
        : swiftType(s.ret);
  // What crosses back: a new value boxed as its type is, a result as its type says.
  const out = (v: swift.Expr) =>
    s.role === "init"
      ? call1("lucentRetained", owner?.boxed ? call1("LucentBox", v) : v)
      : resultValue(s.ret, v);
  // Where a result would be, when there is an error instead.
  const none = (type: swift.Type) =>
    type.k === "optional" ? swift.nil : isBool(s.ret) ? swift.bool(false) : swift.num(0);
  const attempt = (body: swift.Stmt[], failed: (error: swift.Expr) => swift.Stmt[]) =>
    throws
      ? [
          {
            k: "do" as const,
            body,
            catchBody: failed(
              call1("lucentRetained", swift.cast(n("error"), "as", swift.type("NSError"))),
            ),
          },
        ]
      : body;
  const decl = (
    ret: swift.Type | undefined,
    body: swift.Stmt[],
    attributes: string[] = [],
  ): swift.Decl => ({
    k: "func",
    attributes: [
      `@_cdecl("${s.symbol}")`,
      ...(s.since ? [`@available(iOS ${s.since}, *)`] : []),
      ...attributes,
    ],
    modifiers: ["public"],
    name: s.symbol,
    params,
    ...(ret ? { ret } : {}),
    body,
  });

  if (async) {
    // The glue's promise, and its callback: (promise, result, error).
    const result = returns ? shimType(s.ret, true) : undefined;
    params.push(
      { external: "_", name: "ctx_", type: raw },
      {
        external: "_",
        name: "done_",
        type: swift.cFunction(
          [raw, ...(result ? [result] : []), swift.optional(raw)],
          swift.type("Void"),
        ),
      },
    );
    const done = (value: swift.Expr | undefined, error: swift.Expr) =>
      swift.exprStmt(
        swift.call(n("done_"), [
          { value: n("ctx_") },
          ...(value ? [{ value }] : []),
          { value: error },
        ]),
      );
    const body = returns
      ? [swift.letStmt("v", effect, resultType), done(out(n("v")), swift.nil)]
      : [swift.exprStmt(effect), done(undefined, swift.nil)];
    const task = swift.closure(
      [],
      attempt(body, (error) => [done(result && none(result), error)]),
      s.mainActor ? ["@MainActor"] : undefined,
    );
    return decl(raw, [
      ...prelude,
      swift.letStmt("task", swift.call(n("Task"), [], task)),
      swift.ret(call1("lucentRetained", call1("LucentTask", n("task")))),
    ]);
  }

  if (throws)
    params.push({
      external: "_",
      name: "error_",
      type: swift.type("UnsafeMutablePointer", swift.optional(raw)),
    });
  const ret = !returns
    ? undefined
    : s.role === "init"
      ? throws
        ? swift.optional(raw)
        : raw
      : shimType(s.ret, throws);
  const body: swift.Stmt[] = returns
    ? [swift.letStmt("v", effect, resultType), swift.ret(out(n("v")))]
    : [swift.exprStmt(effect)];
  const failed = (error: swift.Expr) => [
    swift.exprStmt(swift.assign(swift.member(n("error_"), "pointee"), error)),
    ...(ret ? [swift.ret(none(ret))] : []),
  ];
  return decl(ret, [...prelude, ...attempt(body, failed)], s.mainActor ? ["@MainActor"] : []);
}

/** What async shims need: their tasks as objects, which the glue cancels through SWIFT_CANCEL. */
function taskHelpers(): swift.Decl[] {
  const task = swift.type("Task", swift.type("Void"), swift.type("Never"));
  return [
    {
      k: "class",
      name: "LucentTask",
      modifiers: ["final"],
      superclass: swift.type("NSObject"),
      members: [
        { k: "let", modifiers: [], name: "task", type: task },
        {
          k: "init",
          modifiers: [],
          params: [{ external: "_", name: "task", type: task }],
          body: [swift.exprStmt(swift.assign(swift.member(swift.self, "task"), n("task")))],
        },
      ],
    },
    {
      k: "func",
      attributes: [`@_cdecl("${SWIFT_CANCEL}")`],
      modifiers: ["public"],
      name: SWIFT_CANCEL,
      params: [{ external: "_", name: "t", type: raw }],
      body: [
        swift.exprStmt(
          swift.call(
            swift.member(
              swift.member(
                swift.cast(call1("lucentTaken", n("t")), "as!", swift.type("LucentTask")),
                "task",
              ),
              "cancel",
            ),
            [],
          ),
        ),
      ],
    },
  ];
}

/** What every shim file has: the box for Swift values, and objects to and from pointers. */
function helpers(): swift.Decl[] {
  const value = swift.type("Value");
  const anyObject = swift.type("AnyObject");
  return [
    {
      k: "class",
      name: "LucentBox",
      typeParams: ["Value"],
      modifiers: ["final"],
      superclass: swift.type("NSObject"),
      members: [
        { k: "var", modifiers: [], name: "value", type: value },
        {
          k: "init",
          modifiers: [],
          params: [{ external: "_", name: "value", type: value }],
          body: [swift.exprStmt(swift.assign(swift.member(swift.self, "value"), n("value")))],
        },
      ],
    },
    {
      k: "func",
      modifiers: [],
      name: "lucentObject",
      params: [{ external: "_", name: "p", type: raw }],
      ret: anyObject,
      body: [
        swift.ret(
          swift.call(
            swift.member(call1("Unmanaged<AnyObject>.fromOpaque", n("p")), "takeUnretainedValue"),
            [],
          ),
        ),
      ],
    },
    {
      k: "func",
      modifiers: [],
      name: "lucentTaken",
      params: [{ external: "_", name: "p", type: raw }],
      ret: anyObject,
      body: [
        swift.ret(
          swift.call(
            swift.member(call1("Unmanaged<AnyObject>.fromOpaque", n("p")), "takeRetainedValue"),
            [],
          ),
        ),
      ],
    },
    {
      k: "func",
      modifiers: [],
      name: "lucentRetained",
      params: [{ external: "_", name: "o", type: anyObject }],
      ret: raw,
      body: [
        swift.ret(
          swift.call(swift.member(call1("Unmanaged.passRetained", n("o")), "toOpaque"), []),
        ),
      ],
    },
  ];
}

/**
 * An enum with payloads to and from the dictionary of its case: `kind`,
 * and the payload by field (as the union in Lucent names them).
 */
function unionFunctions(e: { name: string; cases: PayloadCase[] }): swift.Decl[] {
  const type = swift.type(e.name);
  const v = n("v");
  const toObject_ = e.cases.map((c): swift.Stmt => {
    const fields = payloadFields(c.params);
    const bound = c.params.map((_, i) => `p${i}`);
    const dictionary = swift.cast(
      swift.dictionaryLiteral([
        { key: swift.str("kind"), value: swift.str(c.name) },
        ...c.params.map((p, i) => ({
          key: swift.str(fields[i]!),
          // An absent optional payload bridges as NSNull.
          value: p.type.nullable
            ? swift.cast(
                each(n(bound[i]!), "map", toObject(nonNull(p.type), n("$0"))),
                "as",
                swift.type("Any"),
              )
            : toObject(p.type, n(bound[i]!)),
        })),
      ]),
      "as",
      swift.type("NSDictionary"),
    );
    return {
      k: "ifCase",
      pattern: bound.length ? `let .${c.name}(${bound.join(", ")})` : `.${c.name}`,
      value: v,
      body: [swift.ret(dictionary)],
    };
  });
  const d = n("d");
  // An absent optional payload is not in the dictionary.
  const payload = (t: SdkType, field: string) =>
    t.nullable
      ? each(swift.index(d, swift.str(field)), "map", fromObject(nonNull(t), n("$0")))
      : fromObject(t, swift.forceUnwrap(swift.index(d, swift.str(field))));
  const fromObject_: swift.Stmt = {
    k: "switch",
    on: swift.cast(swift.index(d, swift.str("kind")), "as!", swift.type("String")),
    cases: [
      ...e.cases.map((c) => {
        const fields = payloadFields(c.params);
        const made = swift.member(n(e.name), c.name);
        const args = c.params.map((p, i) => ({
          ...(p.label ? { label: p.label } : {}),
          value: payload(p.type, fields[i]!),
        }));
        return {
          patterns: [JSON.stringify(c.name)],
          body: [swift.ret(args.length ? swift.call(made, args) : made)],
        };
      }),
      {
        patterns: ["default"],
        body: [swift.exprStmt(call1("fatalError", swift.str(`${e.name} has no such case`)))],
      },
    ],
  };
  return [
    {
      k: "func",
      modifiers: [],
      name: unionFunction(e, "Object"),
      params: [{ external: "_", name: "v", type }],
      ret: swift.type("AnyObject"),
      // Cases added after the program was built have no kind it knows.
      body: [
        ...toObject_,
        swift.ret(
          swift.cast(
            swift.dictionaryLiteral([{ key: swift.str("kind"), value: swift.str("") }]),
            "as",
            swift.type("NSDictionary"),
          ),
        ),
      ],
    },
    {
      k: "func",
      modifiers: [],
      name: unionFunction(e, "Value"),
      params: [{ external: "_", name: "o", type: swift.type("AnyObject") }],
      ret: type,
      body: [
        swift.letStmt(
          "d",
          swift.cast(
            n("o"),
            "as!",
            swift.dictionary(swift.type("String"), swift.type("AnyObject")),
          ),
        ),
        fromObject_,
      ],
    },
  ];
}

/** The enums with payloads a type holds, those their payloads hold included. */
export function unionsOf(
  t: SdkType,
  out: Map<string, { name: string; cases: PayloadCase[] }>,
): void {
  if (t.k === "array" || t.k === "record") return unionsOf(t.of, out);
  const e = payloadEnum(t);
  if (!e || out.has(e.name)) return;
  out.set(e.name, e);
  for (const c of e.cases) for (const p of c.params) unionsOf(p.type, out);
}

/** The modules a type's Swift name needs imported. */
export function modulesOf(t: SdkType): string[] {
  if (t.k === "array" || t.k === "record") return modulesOf(t.of);
  return t.k === "ref" ? [t.module] : [];
}

/** What a program's Swift protocol proxies add to LucentShims.swift: declarations, and the types and modules they name. */
export interface ProxyParts {
  decls: swift.Decl[];
  types: SdkType[];
  modules: string[];
}

/** LucentShims.swift: the program's shims, each calling one member, and its Swift protocols' proxies. */
export function shimsFile(
  shims: Iterable<SwiftShim>,
  proxies: ProxyParts = { decls: [], types: [], modules: [] },
): string {
  const all = [...shims].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const unions = new Map<string, { name: string; cases: PayloadCase[] }>();
  for (const t of [...all.flatMap((s) => [...s.params, s.ret]), ...proxies.types])
    unionsOf(t, unions);
  const modules = new Set(["Foundation", ...proxies.modules]);
  const types = [
    ...all.flatMap((s) => [...s.params, s.ret]),
    ...proxies.types,
    ...[...unions.values()].flatMap((e) => e.cases.flatMap((c) => c.params.map((p) => p.type))),
  ];
  for (const m of [...all.map((s) => s.module), ...types.flatMap(modulesOf)]) modules.add(m);
  return swift.printUnit({
    banner: "Generated by Lucent. Do not edit.",
    decls: [
      ...[...modules].sort().map((module): swift.Decl => ({ k: "import", module })),
      ...helpers(),
      ...(all.some((x) => x.member.async) ? taskHelpers() : []),
      ...[...unions.values()].sort((a, b) => a.name.localeCompare(b.name)).flatMap(unionFunctions),
      ...all.map(shimFunction),
      ...proxies.decls,
    ],
  });
}
