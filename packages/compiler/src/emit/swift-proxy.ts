/**
 * Lucent classes conforming to Swift-only protocols
 * (docs/design/swift-shims.md): a generated Swift class conforms for them,
 * and calls each requirement through a C function the glue gives it.
 *
 * A requirement is a method (synchronous, throwing, or async, whose
 * result the glue gives back through the continuation it is handed), or a
 * property's getter or setter. The associated types of a protocol are the
 * type arguments the Lucent class's `implements` clause gives it; `Self` is
 * the proxy class, whose objects cross as the Lucent objects they hold.
 */
import { createHash } from "node:crypto";
import { cpp, swift } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import type { LucentModule } from "../program.ts";
import { type SdkClassRef, sdkInterfacesOf } from "../sdk/declarations.ts";
import { substitute } from "../sdk/dts.ts";
import type { SdkMethodSchema, SdkPropertySchema, SdkType, SwiftMember } from "../sdk/schema.ts";
import { type ClassInfo, cppIdent, type LType } from "../types.ts";
import { classMember, classMemberLvalue } from "./builtins.ts";
import { findMember } from "./classes.ts";
import type { Ctx, E } from "./context.ts";
import { FnEmitter } from "./function.ts";
import { fromObjc, ifPresent, requirePlan, toNativeNumber, toObjcExpr } from "./native.ts";
import {
  baseName,
  call1,
  casesOf,
  crossing,
  cType,
  each,
  fromObject,
  indexOf,
  isVoid,
  modulesOf,
  n,
  nonNull,
  objectOf,
  type ProxyParts,
  raw,
  registerUnions,
  resultValue,
  sdkTypeOf,
  enumFromRaw,
  isScalar,
  objcEnum,
  shimType,
  swiftEnum,
  swiftLabels,
  swiftType,
  valueOf,
} from "./swift.ts";

/** One requirement a proxy implements: a method, or a property's getter or setter. */
export type SwiftRequirement =
  | {
      kind: "method";
      member: SwiftMember;
      params: SdkType[];
      ret: SdkType;
      /** An async one's: the Swift function the glue resumes its continuation with. */
      resume?: string;
    }
  | { kind: "get" | "set"; member: SwiftMember; type: SdkType };

/**
 * A Lucent class conforming to Swift-only protocols: a Swift class that
 * calls back into the glue through C function pointers, one per requirement.
 */
export interface SwiftProxy {
  /** The @_cdecl function that makes one. */
  symbol: string;
  name: string;
  /** The protocols' Swift names, and their modules. */
  protocols: { name: string; module: string }[];
  mainActor: boolean;
  /** The associated types the Lucent class fixes (`typealias Item = String`). */
  associated: { name: string; type: SdkType }[];
  requirements: SwiftRequirement[];
}

/** `Self` in a requirement: the proxy class (the Lucent class, in the glue). */
const isSelf = (t: SdkType) => t.k === "tparam" && t.name === "Self";

/** A requirement as the glue implements it: the Lucent member it calls, and the types as the class fixes them. */
type Requirement =
  | {
      kind: "method";
      p: SdkClassRef;
      m: SdkMethodSchema;
      impl: ts.MethodDeclaration;
      params: SdkType[];
      ret: SdkType;
      now: boolean;
      what: string;
    }
  | {
      kind: "get" | "set";
      p: SdkClassRef;
      prop: SdkPropertySchema;
      node: ts.Node;
      type: SdkType;
      what: string;
    };

/**
 * A Lucent class that implements Swift-only protocols, as a Swift object: a
 * generated class conforming to them, whose requirements call the Lucent
 * members through the glue (on the Lucent thread: queued when nothing waits
 * for them, as for Objective-C protocols). It holds the Lucent object and
 * releases it when it goes; `swiftObjectOf` gives one per Lucent object
 * while it is in use.
 */
export function swiftDelegate(
  ctx: Ctx,
  module: LucentModule,
  info: ClassInfo,
): { native: cpp.Decl[]; decl: cpp.Decl } | undefined {
  if (ctx.platform !== "ios") return undefined;

  const protocols = sdkInterfacesOf(ctx.checker, info.decl).filter((p) => p.cls.swift);
  if (!protocols.length) return undefined;

  const name = info.decl.name?.text ?? "class";
  const reject = (why: string): never =>
    fail(info.decl, Codes.UnsupportedClassFeature, `${name}: ${why}`);
  if (info.typeParams.length) reject("generic classes cannot implement Swift protocols");

  const em = new FnEmitter(ctx, { module, async: false });
  const hash = createHash("sha1").update(`${module.name}|${info.id}`).digest("hex").slice(0, 12);
  const self = cpp.type("lucent::Ref", cpp.type(`lucent_app::${info.cppName}`));
  const voidPtr = cpp.pointer(cpp.voidType);

  const associated = protocols.flatMap((p) => associatedTypes(em, info, p, reject));
  const bound = new Map(associated.map((a) => [a.name, a.type] as const));
  const requirements = protocols.flatMap((p) => requirementsOf(em, info, p, bound, reject));

  const resume = (i: number) => `lucent_swift_resume_${hash}_${i}`;
  const classT: LType & { k: "class" } = { k: "class", id: info.id, args: [] };
  const functions = requirements.map((r, i) =>
    glueFunction(em, `lucentSwiftRequirement_${hash}_${i}`, r, classT, self, resume(i)),
  );
  // The Swift functions async requirements' continuations are resumed with.
  const resumes = requirements.flatMap((r, i) =>
    r.kind === "method" && r.m.swift?.async ? [resumeDeclaration(r, resume(i))] : [],
  );

  const release: cpp.Decl & { k: "function" } = cpp.fn(
    `lucentSwiftRelease_${hash}`,
    cpp.voidType,
    [cpp.param(voidPtr, "ctx_")],
    [
      // The Lucent object goes on the Lucent thread.
      cpp.exprStmt(
        cpp.call("lucent::postCallback", [
          cpp.lambda(
            [{ name: "o_", init: cpp.staticCast(cpp.pointer(self), cpp.id("ctx_")) }],
            [],
            [
              cpp.exprStmt(
                cpp.cast(
                  "c",
                  cpp.voidType,
                  cpp.construct(cpp.type("std::unique_ptr", self), [cpp.id("o_")]),
                ),
              ),
            ],
          ),
        ]),
      ),
    ],
    { static: true },
  ) as cpp.Decl & { k: "function" };

  const symbol = `lucent_swift_proxy_${hash}`;
  const pointer = (d: cpp.Decl & { k: "function" }) =>
    cpp.pointer(
      cpp.type(
        "std::type_identity_t",
        cpp.fnType(
          d.ret,
          d.params.map((x) => x.type),
        ),
      ),
    );
  const make = cpp.fn(symbol, voidPtr, [
    cpp.param(voidPtr, "ctx_"),
    cpp.param(pointer(release), "release_"),
    ...functions.map((f, i) => cpp.param(pointer(f), `r${i}_`)),
  ]);

  const o = cpp.id("o");
  const created = cpp.blockLiteral(
    [],
    [
      cpp.ret(
        cpp.cast(
          "bridge_transfer",
          cpp.type("id"),
          cpp.call(symbol, [
            cpp.newExpr(self, [o]),
            cpp.addressOf(cpp.id(release.name)),
            ...functions.map((f) => cpp.addressOf(cpp.id(f.name))),
          ]),
        ),
      ),
    ],
    cpp.type("id"),
  );
  // Its own table: the same Lucent object may have an Objective-C delegate too.
  const cached = cpp.call(
    "lucent::objc::cachedObject",
    [cpp.call(cpp.dot(o, "get")), created],
    [cpp.num(1)],
  );
  const objectOf = cpp.fn(
    "swiftObjectOf",
    cpp.type("lucent::NativeRef"),
    [cpp.param(cpp.reference(cpp.constType(self)), "o")],
    [cpp.ret(cpp.call("lucent::objc::wrap", [cached, cpp.str(name)]))],
  );

  ctx.swiftProxies.push({
    symbol,
    name: `LucentProxy_${hash}`,
    protocols: protocols.map((p) => ({ name: p.cls.native, module: p.module })),
    mainActor: protocols.some((p) => p.cls.mainActor),
    associated,
    requirements: requirements.map((r, i): SwiftRequirement => {
      if (r.kind !== "method") return { kind: r.kind, member: r.prop.swift!, type: r.type };

      return {
        kind: "method",
        member: r.m.swift!,
        params: r.params,
        ret: r.ret,
        ...(r.m.swift?.async ? { resume: resume(i) } : {}),
      };
    }),
  });

  em.ctx.nativeUnit(module).include("lucent/platform/ios.h");
  return {
    native: [
      { k: "externC", body: [make, ...resumes] },
      ...functions,
      release,
      cpp.namespace("lucent_app", [objectOf]),
    ],
    decl: cpp.fn("swiftObjectOf", cpp.type("lucent::NativeRef"), [
      cpp.param(cpp.reference(cpp.constType(cpp.type("lucent::Ref", cpp.type(info.cppName)))), "o"),
    ]),
  };
}

/**
 * The associated types of `p` as the class's `implements` clause fixes
 * them (`implements Store<string>`): each a Swift type the proxy names.
 */
function associatedTypes(
  em: FnEmitter,
  info: ClassInfo,
  p: SdkClassRef,
  reject: (why: string) => never,
): { name: string; type: SdkType }[] {
  const names = p.cls.typeParams ?? [];
  if (!names.length) return [];

  const clause = info.decl.heritageClauses
    ?.filter((h) => h.token === ts.SyntaxKind.ImplementsKeyword)
    .flatMap((h) => h.types)
    .find((t) => em.checker.getTypeAtLocation(t).getSymbol()?.name === p.cls.name);
  const args = clause?.typeArguments ?? [];
  if (args.length < names.length)
    reject(`implement ${p.cls.name}<${names.join(", ")}>: the class fixes its associated types`);

  return names.map((name, i) => ({
    name,
    type: sdkTypeOf(em, em.checker.getTypeFromTypeNode(args[i]!), args[i]!),
  }));
}

const isField = (m: ts.Node) => ts.isPropertyDeclaration(m) || ts.isParameter(m);
const isReadonly = (m: ts.Node) =>
  ts.canHaveModifiers(m) &&
  !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword);

/** What the class implements `p`'s requirements with, each checked by its plan. */
function requirementsOf(
  em: FnEmitter,
  info: ClassInfo,
  p: SdkClassRef,
  bound: ReadonlyMap<string, SdkType>,
  reject: (why: string) => never,
): Requirement[] {
  const name = info.decl.name?.text ?? "class";
  const of = { platform: "ios" as const, module: p.module, cls: p.cls };
  const chain = em.reg.chain({ k: "class", id: info.id, args: [] });
  const out: Requirement[] = [];

  const init = p.cls.constructors?.[0];
  if (init)
    reject(
      `${p.cls.name} requires ${init.swift?.name ?? "init()"}, which Swift would call to make one: Lucent classes cannot implement initializer requirements; write the conforming type in Swift (a native extension)`,
    );

  for (const m of p.cls.methods ?? []) {
    // Refused: Swift would call it without an object.
    if (m.static) requirePlan(info.decl, of, m, "implement");

    const found = findMember(chain, m.name, (x) => ts.isMethodDeclaration(x) && !!x.body);
    if (!found) reject(`implement ${p.cls.name}.${m.name}`);

    const impl = found!.decl as ts.MethodDeclaration;
    const plan = requirePlan(impl, of, m, "implement");
    // Swift's `Self`: the proxy gives back the object of this class the method returns.
    if (isSelf(m.returns)) {
      const ret = implSignature(em, impl).ret;
      const settled = ret.k === "promise" ? ret.inner : ret;
      if (settled.k !== "class" || settled.id !== info.id)
        reject(`${name}.${m.name} returns ${p.cls.name}'s Self: declare it to return ${name}`);
    }

    out.push({
      kind: "method",
      p,
      m,
      impl,
      params: m.params.map((x) => substitute(x.type as SdkType, bound)),
      ret: substitute(m.returns as SdkType, bound),
      now: plan.delivery === "sync",
      what: `${name}.${m.name}`,
    });
  }

  for (const prop of p.cls.properties ?? []) {
    if (prop.static) requirePlan(info.decl, of, prop, "implement");

    const found = findMember(
      chain,
      prop.name,
      (x) => isField(x) || ts.isGetAccessorDeclaration(x) || ts.isSetAccessorDeclaration(x),
    );
    if (!found) reject(`implement ${p.cls.name}.${prop.name}`);

    const node = found!.decl;
    requirePlan(node, of, prop, "implement");
    const type = substitute(prop.type as SdkType, bound);
    const what = `${name}.${prop.name}`;
    out.push({ kind: "get", p, prop, node, type, what });
    if (prop.readonly) continue;

    const settable =
      (isField(node) && !isReadonly(node)) ||
      !!findMember(chain, prop.name, (x) => ts.isSetAccessorDeclaration(x));
    if (!settable)
      reject(
        `${p.cls.name}.${prop.name} can be set: make ${what} a field that is not readonly, or give it a setter`,
      );
    out.push({ kind: "set", p, prop, node, type, what });
  }

  return out;
}

/** The Lucent object a proxy's `ctx_` (or a `Self` argument's) points to. */
const lucentObject = (self: cpp.Type, p: cpp.Expr) =>
  cpp.deref(cpp.staticCast(cpp.pointer(self), p));

/**
 * A value that crossed as type `t` (an object handed over as `o<i>_`), as
 * the Lucent value of type `lt` the requirement's implementation takes.
 */
function lucentValue(
  em: FnEmitter,
  t: SdkType,
  i: number,
  lt: LType,
  self: cpp.Type,
  what: string,
): cpp.Expr {
  if (isSelf(t)) return lucentObject(self, cpp.id(`a${i}`));

  switch (crossing(t)) {
    case "object":
      return valueOf(em, cpp.id(`o${i}_`), t, lt, what).c;
    case "enum":
      return cpp.staticCast(cpp.type("double"), cpp.id(`a${i}`));
    case "scalar":
      return fromObjc(em, cpp.id(`a${i}`), t, lt, what).c;
  }
}

/** Objects handed to the glue: ARC takes them before anything else runs. */
const takenObjects = (params: SdkType[]) =>
  params.flatMap((t, i) =>
    !isSelf(t) && crossing(t) === "object"
      ? [
          cpp.varDecl(
            cpp.type("id"),
            `o${i}_`,
            cpp.cast("bridge_transfer", cpp.type("id"), cpp.id(`a${i}`)),
          ),
        ]
      : [],
  );

/**
 * A Lucent result `r` of type `lt` as the C value it crosses back as
 * (objects retained); `what` names the requirement in range errors.
 */
function crossBack(em: FnEmitter, ret: SdkType, r: cpp.Expr, lt: LType, what: string): cpp.Expr {
  const retained = (x: cpp.Expr) => cpp.cast("bridge_retained", cpp.pointer(cpp.voidType), x);
  if (isSelf(ret))
    return retained(cpp.call("lucent::objc::unwrap", [cpp.call("lucent_app::swiftObjectOf", [r])]));

  registerUnions(em, ret, lt);
  switch (crossing(ret)) {
    case "object":
      return retained(
        ret.nullable && ret.k !== "prim"
          ? ifPresent(r, (x) => toObjcExpr({ ...ret, nullable: false } as SdkType, x, false))
          : objectOf(ret, r),
      );
    case "enum":
      return toNativeNumber(cpp.type("NSInteger"), r);
    case "scalar":
      return toObjcExpr(ret, r, false, `${what}'s result`);
  }
}

/** The glue's function for one requirement, whose pointer the proxy calls. */
function glueFunction(
  em: FnEmitter,
  name: string,
  r: Requirement,
  classT: LType & { k: "class" },
  self: cpp.Type,
  resume: string,
): cpp.Decl & { k: "function" } {
  switch (r.kind) {
    case "get":
    case "set":
      return propertyFunction(em, name, r, classT, self);
    case "method":
      return r.m.swift?.async
        ? asyncFunction(em, name, r, self, resume)
        : methodFunction(em, name, r, self);
  }
}

const staticFn = (
  name: string,
  ret: cpp.Type,
  params: cpp.Param[],
  body: cpp.Stmt[],
): cpp.Decl & { k: "function" } =>
  cpp.fn(name, ret, params, body, { static: true }) as cpp.Decl & { k: "function" };

/** A property requirement: the Lucent field or accessor read, or written, while Swift waits. */
function propertyFunction(
  em: FnEmitter,
  name: string,
  r: Requirement & { kind: "get" | "set" },
  classT: LType & { k: "class" },
  self: cpp.Type,
): cpp.Decl & { k: "function" } {
  const s: E = { c: cpp.id("s_"), t: classT };
  const owner = cpp.varDecl(cpp.auto, "s_", lucentObject(self, cpp.id("ctx_")));
  const ctx = cpp.param(cpp.pointer(cpp.voidType), "ctx_");

  if (r.kind === "get") {
    const value = classMember(em, s, classT, r.prop.name, r.node);
    const cRet = cType(r.type);
    const now = cpp.lambda(
      ["&"],
      [],
      [
        cpp.varDecl(cpp.auto, "r_", value.c),
        cpp.ret(crossBack(em, r.type, cpp.id("r_"), value.t, r.what)),
      ],
      { ret: cRet },
    );
    return staticFn(name, cRet, [ctx], [owner, cpp.ret(cpp.call("lucent::callNow", [now]))]);
  }

  const place = classMemberLvalue(em, s, classT, r.prop.name, r.node);
  const value = lucentValue(em, r.type, 0, place.type, self, r.what);
  const assign = place.set ? place.set(value) : cpp.assign(place.direct ?? place.get, value);
  const now = cpp.lambda(["&"], [], [cpp.exprStmt(cpp.cast("c", cpp.voidType, assign))]);
  return staticFn(
    name,
    cpp.voidType,
    [ctx, cpp.param(cType(r.type), "a0")],
    [owner, ...takenObjects([r.type]), cpp.exprStmt(cpp.call("lucent::callNow", [now]))],
  );
}

/** A method's parameters and result, as its Lucent implementation declares them. */
function implSignature(em: FnEmitter, impl: ts.MethodDeclaration): LType & { k: "fn" } {
  return em.reg.lowerSignature(em.checker.getSignatureFromDeclaration(impl)!, impl) as LType & {
    k: "fn";
  };
}

/**
 * A synchronous method requirement: its arguments (objects passed
 * retained) converted to the Lucent method's parameters, and its result
 * back (objects retained). A throwing one gives back what the Lucent
 * method throws, as an NSError, through its last parameter.
 */
function methodFunction(
  em: FnEmitter,
  name: string,
  r: Requirement & { kind: "method" },
  self: cpp.Type,
): cpp.Decl & { k: "function" } {
  const fn = implSignature(em, r.impl);
  const count = Math.min(fn.params.length, r.params.length);
  const throws = !!r.m.swift?.throws;
  const cParams = [
    cpp.param(cpp.pointer(cpp.voidType), "ctx_"),
    ...r.params.map((t, i) => cpp.param(cType(t), `a${i}`)),
    ...(throws ? [cpp.param(cpp.pointer(cpp.pointer(cpp.voidType)), "error_")] : []),
  ];
  const args = r.params
    .slice(0, count)
    .map((t, i) => lucentValue(em, t, i, fn.params[i]!, self, r.what));
  const owner = cpp.varDecl(cpp.auto, "s_", lucentObject(self, cpp.id("ctx_")));
  const call = cpp.call(cpp.arrow(cpp.id("s_"), cppIdent(r.m.name)), args);

  const cRet = isVoid(r.ret) ? cpp.voidType : cType(r.ret);
  const body: cpp.Stmt[] = isVoid(r.ret)
    ? [cpp.exprStmt(cpp.cast("c", cpp.voidType, call))]
    : [
        cpp.varDecl(cpp.auto, "r_", call),
        cpp.ret(crossBack(em, r.ret, cpp.id("r_"), fn.ret, r.what)),
      ];
  // What the Lucent method throws goes back to Swift, which throws it.
  const guarded: cpp.Stmt[] = throws
    ? [
        {
          k: "try",
          body,
          catches: [
            {
              body: [
                cpp.exprStmt(cpp.call("lucent::objc::setError", [cpp.id("error_")])),
                ...(isVoid(r.ret) ? [] : [cpp.ret(cpp.initList([]))]),
              ],
            },
          ],
        } as cpp.Stmt,
      ]
    : body;

  if (isVoid(r.ret) && !r.now) {
    // Nothing waits for it off the main thread: queued, with copies of what it needs.
    const later = cpp.lambda(["="], [], guarded, { mutable: true });
    return staticFn(name, cRet, cParams, [
      owner,
      ...takenObjects(r.params),
      cpp.exprStmt(cpp.call("lucent::postCallback", [later])),
    ]);
  }

  const now = cpp.lambda(["&"], [], guarded, isVoid(r.ret) ? {} : { ret: cRet });
  const run = cpp.call("lucent::callNow", [now]);
  return staticFn(name, cRet, cParams, [
    owner,
    ...takenObjects(r.params),
    isVoid(r.ret) ? cpp.exprStmt(run) : cpp.ret(run),
  ]);
}

/**
 * An async method requirement: the Lucent method called on the Lucent
 * thread, and the continuation Swift waits on (`k_`, retained) resumed when
 * its promise settles, with the result or, for a throwing requirement, the
 * error. A non-throwing one's rejection is reported, and Swift gets a
 * default result, as a platform callback's.
 */
function asyncFunction(
  em: FnEmitter,
  name: string,
  r: Requirement & { kind: "method" },
  self: cpp.Type,
  resume: string,
): cpp.Decl & { k: "function" } {
  const fn = implSignature(em, r.impl);
  const count = Math.min(fn.params.length, r.params.length);
  const throws = !!r.m.swift?.throws;
  const voidPtr = cpp.pointer(cpp.voidType);
  const cParams = [
    cpp.param(voidPtr, "ctx_"),
    ...r.params.map((t, i) => cpp.param(cType(t), `a${i}`)),
    cpp.param(voidPtr, "k_"),
  ];

  const args = r.params
    .slice(0, count)
    .map((t, i) => lucentValue(em, t, i, fn.params[i]!, self, r.what));
  const resolved = fn.ret.k === "promise" ? fn.ret.inner : fn.ret;
  const nothing = isVoid(r.ret);
  const p = cpp.id("p_");

  const resumeWith = (value: cpp.Expr | undefined, error: cpp.Expr | undefined) =>
    cpp.exprStmt(
      cpp.call(resume, [
        cpp.id("k_"),
        ...(nothing ? [] : [value ?? cpp.initList([])]),
        ...(throws ? [error ?? cpp.nullptr] : []),
      ]),
    );
  const failed = (error: cpp.Expr): cpp.Stmt[] =>
    throws
      ? [
          resumeWith(
            undefined,
            cpp.cast("bridge_retained", voidPtr, cpp.call("lucent::objc::toNSError", [error])),
          ),
        ]
      : [
          cpp.exprStmt(cpp.call("lucent::objc::reportError", [error, cpp.str(r.what)])),
          resumeWith(undefined, undefined),
        ];

  const settled = cpp.lambda(
    ["p_", "k_"],
    [],
    [
      cpp.ifStmt(cpp.unary("!", cpp.call(cpp.dot(p, "fulfilled"))), [
        ...failed(cpp.call(cpp.dot(p, "error"))),
        cpp.ret(),
      ]),
      ...(nothing
        ? [resumeWith(undefined, undefined)]
        : [
            cpp.varDecl(cpp.auto, "r_", cpp.call(cpp.dot(p, "value"))),
            resumeWith(crossBack(em, r.ret, cpp.id("r_"), resolved, r.what), undefined),
          ]),
    ],
  );
  const start = cpp.lambda(
    ["="],
    [],
    [
      {
        k: "try",
        body: [
          cpp.varDecl(cpp.auto, "p_", cpp.call(cpp.arrow(cpp.id("s_"), cppIdent(r.m.name)), args)),
          cpp.exprStmt(cpp.call(cpp.dot(p, "onSettled"), [settled])),
        ],
        catches: [
          {
            body: failed(cpp.call("lucent::currentError", [cpp.call("std::current_exception")])),
          },
        ],
      } as cpp.Stmt,
    ],
    { mutable: true },
  );

  return staticFn(name, cpp.voidType, cParams, [
    cpp.varDecl(cpp.auto, "s_", lucentObject(self, cpp.id("ctx_"))),
    ...takenObjects(r.params),
    cpp.exprStmt(cpp.call("lucent::postCallback", [start])),
  ]);
}

/** The glue's declaration of the Swift function an async requirement's continuation is resumed with. */
function resumeDeclaration(r: Requirement & { kind: "method" }, symbol: string): cpp.Decl {
  const voidPtr = cpp.pointer(cpp.voidType);
  return cpp.fn(symbol, cpp.voidType, [
    cpp.param(voidPtr, "k_"),
    ...(isVoid(r.ret) ? [] : [cpp.param(cType(r.ret), "v_")]),
    ...(r.m.swift?.throws ? [cpp.param(voidPtr, "e_")] : []),
  ]);
}

// --- the Swift side ---------------------------------------------------------------------

/** A requirement's C function type in Swift. */
function functionType(r: SwiftRequirement): swift.Type {
  if (r.kind !== "method")
    return r.kind === "get"
      ? swift.cFunction([raw], shimType(r.type))
      : swift.cFunction([raw, shimType(r.type)], swift.type("Void"));

  const params = [raw, ...r.params.map((t) => shimType(t))];
  if (r.resume) return swift.cFunction([...params, raw], swift.type("Void"));

  const throws = !!r.member.throws;
  const errorOut = swift.type("UnsafeMutablePointer", swift.optional(raw));
  return swift.cFunction(
    throws ? [...params, errorOut] : params,
    isVoid(r.ret) ? swift.type("Void") : shimType(r.ret, throws),
  );
}

/**
 * The Swift class a Lucent class conforms to Swift protocols through: each
 * requirement calls its C function pointer with the Lucent object's handle
 * (objects passed and returned retained); the handle is released with it.
 */
function proxyDecls(p: SwiftProxy): swift.Decl[] {
  const ctx = n("ctx_");
  const proxyType = swift.type(p.name);
  /** A requirement's type in Swift: `Self` is the proxy class. */
  const typeOf = (t: SdkType) => (isSelf(t) ? proxyType : swiftType(t));

  const release = swift.cFunction([raw], swift.type("Void"));
  const stored: swift.Param[] = [
    { external: "_", name: "ctx_", type: raw },
    { external: "_", name: "release_", type: release },
    ...p.requirements.map((r, i) => ({ external: "_", name: `r${i}_`, type: functionType(r) })),
  ];

  /** A Swift argument as the C function takes it: `Self` as the Lucent object it holds. */
  const argument = (t: SdkType, a: swift.Expr) => {
    if (isSelf(t)) return swift.member(a, "ctx_");
    if (isScalar(t)) return a;

    const e = swiftEnum(t);
    return e ? indexOf(e, a) : resultValue(t, a);
  };
  /** What a C function gave back, as the Swift value of type `t`. */
  const value = (t: SdkType, v: swift.Expr): swift.Expr => {
    if (isSelf(t)) return swift.cast(call1("lucentTaken", v), "as!", proxyType);
    if (isScalar(t)) return v;

    const e = swiftEnum(t);
    if (e) return swift.index(casesOf(e), v);
    if (objcEnum(t)) return enumFromRaw(t, v);
    if (t.nullable) return each(v, "map", fromObject(nonNull(t), call1("lucentTaken", n("$0"))));
    return fromObject(t, call1("lucentTaken", v));
  };

  const members: swift.Member[] = p.associated.map((a) => ({
    k: "typealias" as const,
    name: a.name,
    type: swiftType(a.type),
  }));
  const resumes: swift.Decl[] = [];

  // Properties: a getter, and a setter when the requirement has one.
  const getters = new Map<string, number>();
  p.requirements.forEach((r, i) => {
    if (r.kind === "get") getters.set(r.member.name, i);
  });
  for (const [name, i] of getters) {
    const r = p.requirements[i] as SwiftRequirement & { kind: "get" };
    const setter = p.requirements.findIndex((x) => x.kind === "set" && x.member.name === name);
    const get = [swift.ret(value(r.type, swift.call(n(`r${i}_`), [{ value: ctx }])))];
    members.push({
      k: "property",
      modifiers: [],
      name,
      type: typeOf(r.type),
      get,
      ...(setter >= 0
        ? {
            set: [
              swift.exprStmt(
                swift.call(n(`r${setter}_`), [
                  { value: ctx },
                  { value: argument(r.type, n("newValue")) },
                ]),
              ),
            ],
          }
        : {}),
    });
  }

  p.requirements.forEach((r, i) => {
    if (r.kind !== "method") return;

    const names = r.params.map((_, j) => `a${j}`);
    const labelled = swiftLabels(r.member.name);
    const args = r.params.map((t, j) => ({ value: argument(t, n(names[j]!)) }));
    const nothing = isVoid(r.ret);
    const throws = !!r.member.throws;
    const params = r.params.map((t, j) => ({
      external: labelled[j] ?? "_",
      name: names[j]!,
      type: typeOf(t),
    }));
    const signature = {
      k: "func" as const,
      modifiers: [],
      name: baseName(r.member.name),
      params,
      ...(r.resume || throws
        ? { effects: [...(r.resume ? ["async"] : []), ...(throws ? ["throws"] : [])] }
        : {}),
      ...(nothing ? {} : { ret: typeOf(r.ret) }),
    };

    if (r.resume) {
      // The glue resumes the continuation, handed over retained, when the Lucent promise settles.
      const wait = throws ? "withCheckedThrowingContinuation" : "withCheckedContinuation";
      const handed = call1("lucentRetained", call1("LucentContinuation", n("k")));
      const call = swift.call(n(`r${i}_`), [{ value: ctx }, ...args, { value: handed }]);
      const waited = swift.awaitExpr(
        swift.call(n(wait), [], swift.closure(["k"], [swift.exprStmt(call)])),
      );
      members.push({ ...signature, body: [swift.ret(throws ? swift.tryExpr(waited) : waited)] });
      resumes.push(resumeFunction(r, r.resume, typeOf));
      return;
    }

    const call = swift.call(n(`r${i}_`), [
      { value: ctx },
      ...args,
      ...(throws ? [{ value: swift.addressOf(n("e_")) }] : []),
    ]);
    if (!throws) {
      members.push({
        ...signature,
        body: [nothing ? swift.exprStmt(call) : swift.ret(value(r.ret, call))],
      });
      return;
    }

    // The error the glue gives back, thrown; the result only without one.
    const result =
      isSelf(r.ret) || (!isScalar(r.ret) && !swiftEnum(r.ret) && !objcEnum(r.ret) && !r.ret.nullable)
        ? swift.forceUnwrap(n("v"))
        : n("v");
    members.push({
      ...signature,
      body: [
        { k: "var", name: "e_", type: swift.optional(raw), init: swift.nil },
        nothing ? swift.exprStmt(call) : swift.letStmt("v", call),
        {
          k: "ifLet",
          name: "e_",
          value: n("e_"),
          body: [
            swift.throwStmt(
              swift.cast(call1("lucentTaken", n("e_")), "as!", swift.type("NSError")),
            ),
          ],
        },
        ...(nothing ? [] : [swift.ret(value(r.ret, result))]),
      ],
    });
  });

  return [
    {
      k: "class",
      name: p.name,
      modifiers: [...(p.mainActor ? ["@MainActor"] : []), "final"],
      superclass: swift.type("NSObject"),
      protocols: p.protocols.map((x) => swift.type(x.name)),
      members: [
        ...stored.map((x): swift.Member => ({
          k: "let",
          modifiers: [],
          name: x.name,
          type: x.type,
        })),
        {
          k: "init",
          modifiers: [],
          params: stored,
          body: stored.map((x) =>
            swift.exprStmt(swift.assign(swift.member(swift.self, x.name), n(x.name))),
          ),
        },
        { k: "deinit", body: [swift.exprStmt(swift.call(n("release_"), [{ value: ctx }]))] },
        ...members,
      ],
    },
    {
      k: "func",
      attributes: [`@_cdecl("${p.symbol}")`],
      modifiers: ["public"],
      name: p.symbol,
      params: stored,
      ret: raw,
      body: [
        swift.ret(
          call1(
            "lucentRetained",
            swift.call(
              n(p.name),
              stored.map((x) => ({ value: n(x.name) })),
            ),
          ),
        ),
      ],
    },
    ...resumes,
  ];
}

/**
 * The function the glue resumes an async requirement's continuation with:
 * the continuation (retained), the result, and for a throwing requirement
 * the error (retained) that replaces it.
 */
function resumeFunction(
  r: SwiftRequirement & { kind: "method" },
  symbol: string,
  typeOf: (t: SdkType) => swift.Type,
): swift.Decl {
  const nothing = isVoid(r.ret);
  const throws = !!r.member.throws;
  const valueType = nothing ? swift.type("Void") : typeOf(r.ret);
  const box = swift.type("LucentContinuation", valueType, swift.type(throws ? "Error" : "Never"));
  const k = swift.member(
    swift.call(
      swift.member(
        swift.call(swift.member(n(swift.printType(swift.type("Unmanaged", box))), "fromOpaque"), [
          { value: n("k_") },
        ]),
        "takeRetainedValue",
      ),
      [],
    ),
    "continuation",
  );

  const received = (): swift.Expr => {
    const v = n("v_");
    if (isSelf(r.ret))
      return swift.cast(call1("lucentTaken", swift.forceUnwrap(v)), "as!", valueType);
    if (isScalar(r.ret)) return v;

    const e = swiftEnum(r.ret);
    if (e) return swift.index(casesOf(e), v);
    if (objcEnum(r.ret)) return enumFromRaw(r.ret, v);
    if (r.ret.nullable)
      return each(v, "map", fromObject(nonNull(r.ret), call1("lucentTaken", n("$0"))));
    return fromObject(r.ret, call1("lucentTaken", throws ? swift.forceUnwrap(v) : v));
  };

  const resumed = swift.call(swift.member(n("k"), "resume"), [
    { label: "returning", value: nothing ? n("()") : received() },
  ]);
  const body: swift.Stmt[] = [swift.letStmt("k", k)];
  if (throws)
    body.push({
      k: "ifLet",
      name: "e_",
      value: n("e_"),
      body: [
        swift.exprStmt(
          swift.call(swift.member(n("k"), "resume"), [
            {
              label: "throwing",
              value: swift.cast(call1("lucentTaken", n("e_")), "as!", swift.type("NSError")),
            },
          ]),
        ),
        swift.ret(),
      ],
    });
  body.push(swift.exprStmt(resumed));

  return {
    k: "func",
    attributes: [`@_cdecl("${symbol}")`],
    modifiers: ["public"],
    name: symbol,
    params: [
      { external: "_", name: "k_", type: raw },
      ...(nothing ? [] : [{ external: "_", name: "v_", type: shimType(r.ret, throws) }]),
      ...(throws ? [{ external: "_", name: "e_", type: swift.optional(raw) }] : []),
    ],
    body,
  };
}

/** A continuation handed to the glue as an object, which it gives back to resume it. */
function continuationBox(): swift.Decl {
  const type = swift.type("CheckedContinuation", swift.type("Value"), swift.type("Failure"));
  return {
    k: "class",
    name: "LucentContinuation",
    typeParams: ["Value", "Failure: Error"],
    modifiers: ["final"],
    superclass: swift.type("NSObject"),
    members: [
      { k: "let", modifiers: [], name: "continuation", type },
      {
        k: "init",
        modifiers: [],
        params: [{ external: "_", name: "continuation", type }],
        body: [
          swift.exprStmt(swift.assign(swift.member(swift.self, "continuation"), n("continuation"))),
        ],
      },
    ],
  };
}

/** What a program's proxies add to LucentShims.swift. */
export function proxyParts(proxies: SwiftProxy[]): ProxyParts {
  const types = proxies.flatMap((p) => [
    ...p.associated.map((a) => a.type),
    ...p.requirements.flatMap((r) =>
      (r.kind === "method" ? [...r.params, r.ret] : [r.type]).filter((t) => !isSelf(t)),
    ),
  ]);

  const waits = proxies.some((p) => p.requirements.some((r) => r.kind === "method" && r.resume));

  return {
    decls: [...(waits ? [continuationBox()] : []), ...proxies.flatMap(proxyDecls)],
    types,
    modules: [
      ...proxies.flatMap((p) => p.protocols.map((x) => x.module)),
      ...types.flatMap(modulesOf),
    ],
  };
}
