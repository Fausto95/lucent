import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { parseSdkType, type SdkMethodSchema, type SdkType } from "../sdk/schema.ts";
import { cppIdent, type ClassInfo, type LType } from "../types.ts";
import { memberName } from "./classes.ts";
import type { LucentModule } from "../program.ts";
import { cpp } from "@lucent-lang/codegen";
import { type SdkClassRef, sdkInterfacesOf } from "../sdk/declarations.ts";
import type { Ctx } from "./context.ts";
import { FnEmitter } from "./function.ts";
import {
  fromObjc,
  noteFramework,
  objcType,
  requirePlan,
  requireTaken,
  toObjcExpr,
} from "./native.ts";

/**
 * A Lucent class that implements SDK protocols, as an Objective-C object:
 * a class adopting them whose methods forward the requirements the Lucent
 * class implements (optional ones it leaves out stay unimplemented). The
 * Objective-C object holds the Lucent object; `objcObjectOf` gives one per
 * Lucent object while it is in use.
 */
export function objcDelegate(
  ctx: Ctx,
  module: LucentModule,
  info: ClassInfo,
): { native: cpp.Decl[]; decl: cpp.Decl } | undefined {
  // A class extending an Objective-C class: its generated subclass adopts them (objc-subclass.ts).
  if (ctx.platform !== "ios" || info.sdkBase) return undefined;
  // Swift-only protocols get a Swift object instead (swiftDelegate).
  const protocols = sdkInterfacesOf(ctx.checker, info.decl).filter((p) => !p.cls.swift);
  if (!protocols.length) return undefined;
  if (info.typeParams.length)
    fail(
      info.decl,
      Codes.UnsupportedClassFeature,
      "generic classes cannot implement SDK protocols",
    );
  const em = new FnEmitter(ctx, { module, async: false });
  for (const p of protocols) noteFramework(em, p.module);
  const objc = objcClassName(info);
  const self = cpp.type("lucent::Ref", cpp.type(`lucent_app::${info.cppName}`));
  const methods = requirementMethods(em, info, protocols);
  const name = info.decl.name?.text ?? "class";
  // One Objective-C object per Lucent object while it is in use.
  const [o, x] = [cpp.id("o"), cpp.id("x")];
  const make = cpp.blockLiteral(
    [],
    [
      cpp.varDecl(cpp.pointer(cpp.type(objc)), "x", cpp.send(objc, "new")),
      cpp.exprStmt(cpp.assign(cpp.arrow(x, "self_"), o)),
      cpp.ret(x),
    ],
    cpp.type("id"),
  );
  const cached = cpp.call("lucent::objc::cachedObject", [cpp.call(cpp.dot(o, "get")), make]);
  const objectOf = cpp.fn(
    "objcObjectOf",
    cpp.type("lucent::NativeRef"),
    [cpp.param(cpp.reference(cpp.constType(self)), "o")],
    [cpp.ret(cpp.call("lucent::objc::wrap", [cached, cpp.str(name)]))],
  );
  const native: cpp.Decl[] = [
    {
      k: "objcInterface",
      name: objc,
      superclass: "NSObject",
      protocols: protocols.map((p) => p.cls.native),
      ivars: [{ type: self, name: "self_" }],
    },
    { k: "objcImplementation", name: objc, methods },
    cpp.namespace("lucent_app", [objectOf]),
  ];
  const decl = cpp.fn("objcObjectOf", cpp.type("lucent::NativeRef"), [
    cpp.param(cpp.reference(cpp.constType(cpp.type("lucent::Ref", cpp.type(info.cppName)))), "o"),
  ]);
  return { native, decl };
}

/** The methods forwarding the requirements of `protocols` the Lucent class implements. */
export function requirementMethods(
  em: FnEmitter,
  info: ClassInfo,
  protocols: SdkClassRef[],
): cpp.ObjcMethod[] {
  const methods: cpp.ObjcMethod[] = [];
  for (const p of protocols) {
    for (const m of p.cls.methods ?? []) {
      if (m.static) continue;
      const impl = info.members.find(
        (x): x is ts.MethodDeclaration =>
          ts.isMethodDeclaration(x) && memberName(x) === m.name && !!x.body,
      );
      if (impl) methods.push(forward(em, info, p, m, impl));
    }
  }

  return methods;
}

function objcClassName(info: ClassInfo): string {
  return `Lucent${info.cppName.replace(/^C_/, "")}`;
}

/**
 * One requirement: arguments converted to the Lucent method's parameter
 * types (as many as it declares), then the call, queued on the Lucent
 * thread unless the platform waits for it (a result, or the main thread),
 * as its plan says. An override (`now`) always runs while the caller
 * waits: what calls it expects it done when it returns.
 */
export function forward(
  em: FnEmitter,
  info: ClassInfo,
  p: SdkClassRef,
  m: SdkMethodSchema,
  impl: ts.MethodDeclaration,
  now = false,
): cpp.ObjcMethod {
  const params: SdkType[] = m.params.map((x) => parseSdkType(x.type, p.module));
  const ret = parseSdkType(m.returns, p.module);
  const fn = em.reg.lowerSignature(em.checker.getSignatureFromDeclaration(impl)!, impl) as LType & {
    k: "fn";
  };
  const names = params.map((_, i) => `a${i}_`);
  const what = `${info.decl.name?.text}.${m.name}`;
  const n = Math.min(fn.params.length, params.length);
  const isVoid = ret.k === "prim" && ret.name === "void";

  const plan = requirePlan(impl, p, m, "implement");
  requireTaken(impl, plan, plan.inputs, n);

  // Pointers it receives (`BOOL *stop`): an Out each, written back once the method returns.
  const outs = params.slice(0, n).flatMap((x, i) => (x.k === "out" ? [i] : []));
  const args = names
    .slice(0, n)
    .map((a, i) =>
      outs.includes(i)
        ? cpp.id(`o${i}_`)
        : fromObjc(em, cpp.id(a), params[i]!, fn.params[i]!, what).c,
    );
  const before = outs.map((i) =>
    cpp.varDecl(cpp.auto, `o${i}_`, cpp.call("lucent::objc::outOf", [cpp.id(names[i]!)])),
  );
  const after = outs.map((i) =>
    cpp.exprStmt(cpp.call("lucent::objc::writeOut", [cpp.id(`o${i}_`), cpp.id(names[i]!)])),
  );
  const call = cpp.call(cpp.arrow(cpp.id("s_"), cppIdent(m.name)), args);
  const selector = m.selector ?? m.name;
  const labels = selector.split(":").slice(0, -1);
  const parts = labels.length
    ? labels.map((part, i) => ({ name: part, param: cpp.param(objcType(params[i]!), names[i]) }))
    : [{ name: selector }];
  const owner = cpp.varDecl(cpp.auto, "s_", cpp.arrow(cpp.id("self"), "self_"));
  const method = (body: cpp.Stmt[]): cpp.ObjcMethod => ({ ret: objcType(ret), parts, body });
  const discard = cpp.exprStmt(cpp.cast("c", cpp.voidType, call));
  if (!isVoid) {
    const r = cpp.id("r_");
    const result = ret.nullable
      ? cpp.call("lucent::objc::ifPresent", [
          r,
          cpp.lambda(
            ["&"],
            [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "x_")],
            [cpp.ret(toObjcExpr({ ...ret, nullable: false } as SdkType, cpp.id("x_"), false))],
          ),
        ])
      : toObjcExpr(ret, r, false, `${what}'s result`);
    const now = cpp.lambda(["&"], [], [cpp.varDecl(cpp.auto, "r_", call), cpp.ret(result)], {
      ret: objcType(ret),
    });
    if (!outs.length) return method([owner, cpp.ret(cpp.call("lucent::callNow", [now]))]);
    return method([
      owner,
      ...before,
      cpp.varDecl(objcType(ret), "b_", cpp.call("lucent::callNow", [now])),
      ...after,
      cpp.ret(cpp.id("b_")),
    ]);
  }
  if (now || plan.delivery === "sync")
    return method([
      owner,
      ...before,
      cpp.exprStmt(cpp.call("lucent::callNow", [cpp.lambda(["&"], [], [discard])])),
      ...after,
    ]);
  const later = cpp.lambda(
    [{ name: "s_", init: cpp.arrow(cpp.id("self"), "self_") }, ...names.slice(0, n)],
    [],
    [discard],
  );
  return method([cpp.exprStmt(cpp.call("lucent::postCallback", [later]))]);
}
