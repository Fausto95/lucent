/**
 * Lucent classes extending Objective-C classes (iOS): a generated
 * Objective-C subclass of the base stands for each instance, for its whole
 * life. It is made by `super(…)`, with the base initializer the call
 * resolves to; its overrides of the base's methods call the Lucent ones,
 * while the caller waits; the Lucent class calls the base's through
 * `super`, and every member it inherits on the native object.
 *
 * Ownership: the native object holds the Lucent object, and every Lucent
 * reference to it holds the native object (an aliasing reference, see
 * `lucent::objc::nativeOwned`), so neither outlives the other while the
 * platform or Lucent code uses it, and no cycle keeps them. The Lucent
 * object goes on the Lucent thread when the native object does.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import type { LucentModule } from "../program.ts";
import { type SdkClassRef, sdkInterfacesOf } from "../sdk/declarations.ts";
import {
  findSdkType,
  parseSdkType,
  type SdkMethodSchema,
  type SdkPropertySchema,
  type SdkType,
} from "../sdk/schema.ts";
import { type ClassInfo, T } from "../types.ts";
import { memberName, parameterProperties } from "./classes.ts";
import type { Ctx, E } from "./context.ts";
import { forward, requirementMethods } from "./delegates.ts";
import { FnEmitter } from "./function.ts";
import { iosSuperInit, noteFramework, objcType, superSelector } from "./native.ts";

/** The generated Objective-C class standing for instances of `info`. */
export const subclassName = (info: ClassInfo) => `LucentSub_${info.cppName.replace(/^C_/, "")}`;

const className = (info: ClassInfo) => info.decl.name?.text ?? "class";

/** The iOS classes `base` is, nearest first. */
function sdkChain(base: { module: string; name: string }): SdkClassRef[] {
  const out: SdkClassRef[] = [];
  for (let t: { module: string; name: string } | undefined = base; t;) {
    const cls = findSdkType("ios", t.module, t.name);
    if (cls?.kind !== "class") break;
    out.push({ platform: "ios", module: t.module, cls });
    const up: SdkType | undefined = cls.extends ? parseSdkType(cls.extends, t.module) : undefined;
    t = up?.k === "ref" ? up : undefined;
  }

  return out;
}

/** The Objective-C classes a Lucent class extends, nearest first, when it can extend them. */
function baseChain(info: ClassInfo): SdkClassRef[] {
  const base = info.sdkBase!;
  const reject = (why: string): never =>
    fail(info.decl, Codes.UnsupportedClassFeature, `${className(info)}: ${why}`);

  const chain = sdkChain(base);
  const own = chain[0];
  if (!own) reject(`${base.name} has no binding`);
  if (own!.cls.swift)
    reject(
      `${base.name} is a Swift class: Lucent classes extend Objective-C classes only; subclass it in Swift (a native extension)`,
    );
  if (own!.cls.interface) reject(`${base.name} is a protocol: implement it`);
  if (info.typeParams.length) reject("generic classes cannot extend iOS classes");

  return chain;
}

type Inherited =
  | { ref: SdkClassRef; method: SdkMethodSchema; property?: undefined }
  | { ref: SdkClassRef; property: SdkPropertySchema; method?: undefined };

/** The SDK instance member named `name` of the classes in `chain`, nearest first. */
function inherited(chain: SdkClassRef[], name: string): Inherited | undefined {
  for (const ref of chain) {
    const method = ref.cls.methods?.find((m) => !m.static && m.name === name);
    if (method) return { ref, method };
    const property = ref.cls.properties?.find((p) => !p.static && p.name === name);
    if (property) return { ref, property };
  }

  return undefined;
}

/** A class extending a main-thread iOS class (UIView, UIViewController) is used on the main thread. */
export function isMainSubclass(info: ClassInfo): boolean {
  return info.sdkBase?.platform === "ios" && sdkChain(info.sdkBase).some((r) => r.cls.mainActor);
}

/** The class a member, constructor or accessor belongs to, when it extends a main-thread iOS class. */
export function inMainSubclass(ctx: Ctx, n: ts.Node): boolean {
  const cls = n.parent;
  if (!cls || !ts.isClassDeclaration(cls)) return false;

  const info = [...ctx.reg.classes.values()].find((c) => c.decl === cls);
  return !!info && isMainSubclass(info);
}

/** An instance of a class extending a main-thread iOS class, made or used at `node`: only on the main thread. */
export function requireSubclassMain(
  node: ts.Node,
  info: ClassInfo,
  inMain: (node: ts.Node) => boolean,
): void {
  if (!isMainSubclass(info) || inMain(node)) return;

  fail(
    node,
    Codes.MainThreadOnly,
    `${className(info)} can only be used on the main thread: call it inside main(() => …) from lucent:thread`,
  );
}

/** The native object of an instance `e` of `info`: what it is to the SDK. */
export function subclassNative(e: E, info: ClassInfo): E {
  const pointer = e.c.k === "this" ? e.c : cpp.call(cpp.dot(e.c, "get"));
  return {
    c: cpp.call(`lucent_app::lucentNativeOf`, [pointer]),
    t: info.sdkBase!,
  };
}

/** What adopts the native object `x` made by `super(…)`: the call the constructor makes. */
const adopt = (info: ClassInfo) => `lucentAdopt_${info.cppName}`;

/** `super(…)` in the constructor of a class extending an iOS class: its native object, made. */
export function subclassSuperCall(em: FnEmitter, node: ts.CallExpression, info: ClassInfo): E {
  baseChain(info);
  const made = iosSuperInit(em, node, info.sdkBase!, subclassName(info));

  return {
    c: cpp.comma(
      cpp.call(`lucent_app::${adopt(info)}`, [cpp.self, made]),
      cpp.id("lucent::undefined"),
    ),
    t: T.undefined,
  };
}

/** The implicit constructor's `super()`: the base's initializer without arguments. */
export function subclassImplicitSuper(info: ClassInfo): cpp.Stmt {
  const chain = baseChain(info);
  const init = chain
    .flatMap((ref) => ref.cls.constructors ?? [])
    .find((c) => !c.params.length && !c.swift);
  if (!init)
    fail(
      info.decl,
      Codes.UnsupportedClassFeature,
      `${className(info)}: ${info.sdkBase!.name} has no initializer without arguments: declare a constructor that calls super(…)`,
    );

  const made = cpp.send(cpp.send(subclassName(info), "alloc"), init!.selector ?? "init");
  return cpp.exprStmt(cpp.call(`lucent_app::${adopt(info)}`, [cpp.self, made]));
}

/**
 * `super.name(…)` / `super.name`: the base's implementation of a method
 * the class overrides (through the subclass's `lucentSuper_` method), or
 * the inherited member itself.
 */
export function subclassSuper(info: ClassInfo, name: string): { overridden: boolean; self: E } {
  const chain = baseChain(info);
  const self = subclassNative({ c: cpp.self, t: { k: "class", id: info.id, args: [] } }, info);
  const found = inherited(chain, name);

  return { overridden: !!found?.method && !!ownMethod(info, name), self };
}

function ownMethod(info: ClassInfo, name: string): ts.MethodDeclaration | undefined {
  return info.decl.members.find(
    (m): m is ts.MethodDeclaration =>
      ts.isMethodDeclaration(m) &&
      !!m.body &&
      !ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) &&
      memberName(m) === name,
  );
}

/**
 * The Objective-C subclass standing for instances of `info` (when it
 * extends an iOS class), and what the header declares for the other
 * modules: the native object of an instance, and a reference to one that
 * holds it.
 */
export function iosSubclass(
  ctx: Ctx,
  module: LucentModule,
  info: ClassInfo,
): { native: cpp.Decl[]; decls: cpp.Decl[] } | undefined {
  if (ctx.platform !== "ios") return undefined;

  const name = className(info);
  // A Lucent class extending one that extends an iOS class.
  const extended = ctx.reg.ancestors(info).find((a) => a.sdkBase?.platform === "ios");
  if (extended)
    fail(
      info.decl,
      Codes.UnsupportedClassFeature,
      `${name}: ${className(extended)} extends ${extended.sdkBase!.name}, an iOS class: Lucent classes cannot extend it in turn`,
    );
  if (info.sdkBase?.platform !== "ios") return undefined;

  const chain = baseChain(info);
  const base = chain[0]!;
  const em = new FnEmitter(ctx, { module, async: false });
  for (const ref of chain) noteFramework(em, ref.module);

  // Fields the base would not see where it has a property, or a method, of the name.
  const ctor = info.decl.members.find(ts.isConstructorDeclaration);
  const fields = [
    ...info.decl.members.filter(
      (m) =>
        (ts.isPropertyDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) &&
        !ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword),
    ),
    ...parameterProperties(ctor),
  ];
  for (const f of fields) {
    const field = memberName(f as ts.ClassElement);
    const found = inherited(chain, field);
    if (found)
      fail(
        f,
        Codes.UnsupportedClassFeature,
        ts.isPropertyDeclaration(f) || ts.isParameter(f)
          ? `${name}.${field}: ${found.ref.cls.name} has a property of that name; set it (this.${field} = …) instead of declaring a field`
          : `${name}.${field}: overriding ${found.ref.cls.name}'s properties is not supported yet`,
      );
  }

  // Overrides: the base's methods the class defines, and the base's own implementation for super.
  const overrides: cpp.ObjcMethod[] = [];
  const supers: cpp.ObjcMethod[] = [];
  for (const m of info.decl.members) {
    if (!ts.isMethodDeclaration(m) || !m.body) continue;
    if (ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)) continue;

    const found = inherited(chain, memberName(m));
    if (!found?.method) continue;
    if (found.method.swift)
      fail(
        m,
        Codes.UnsupportedClassFeature,
        `${name}.${found.method.name}: ${found.ref.cls.name}'s Swift members cannot be overridden`,
      );

    const base = superMethod(found.ref, found.method);
    const override = forward(em, info, found.ref, found.method, m, true);
    // Called by the base's initializer, before super(…) returns: the base's own.
    const early = cpp.ifStmt(cpp.unary("!", cpp.arrow(cpp.id("self"), "self_")), [
      ...base.body,
      ...(base.body[0]!.k === "expr" ? [cpp.ret()] : []),
    ]);
    overrides.push({ ...override, body: [early, ...override.body] });
    supers.push({
      ...base,
      parts: base.parts.map((p, i) => (i ? p : { ...p, name: superSelector(p.name) })),
    });
  }

  // Objective-C protocols the class implements: the subclass adopts them.
  const protocols = sdkInterfacesOf(ctx.checker, info.decl).filter((p) => !p.cls.swift);
  const requirements = requirementMethods(em, info, protocols);

  const sub = subclassName(info);
  const self = cpp.type(`lucent_app::${info.cppName}`);
  const ref = cpp.type("lucent::Ref", self);
  const dealloc: cpp.ObjcMethod = {
    ret: cpp.voidType,
    parts: [{ name: "dealloc" }],
    body: [
      // The Lucent object goes on the Lucent thread.
      cpp.varDecl(
        cpp.auto,
        "o_",
        cpp.newExpr(ref, [cpp.call("std::move", [cpp.arrow(cpp.id("self"), "self_")])]),
      ),
      cpp.exprStmt(
        cpp.call("lucent::postCallback", [
          em.ctx.actorAt(em.opts.module),
          cpp.lambda(
            ["o_"],
            [],
            [
              cpp.exprStmt(
                cpp.cast(
                  "c",
                  cpp.voidType,
                  cpp.construct(cpp.type("std::unique_ptr", ref), [cpp.id("o_")]),
                ),
              ),
            ],
          ),
        ]),
      ),
    ],
  };

  const o = cpp.id("o");
  const x = cpp.id("x");
  const adopted = cpp.fn(
    adopt(info),
    cpp.voidType,
    [cpp.param(cpp.pointer(self), "o"), cpp.param(cpp.type("id"), "made")],
    [
      cpp.varDecl(cpp.pointer(cpp.type(sub)), "x", cpp.id("made")),
      cpp.ifStmt(cpp.unary("!", x), [
        cpp.exprStmt(
          cpp.call("lucent::throwTypeError", [
            cpp.str(`new ${name}: its initializer returned nil`),
          ]),
        ),
      ]),
      cpp.exprStmt(
        cpp.assign(
          cpp.arrow(x, "self_"),
          cpp.call(
            "std::static_pointer_cast",
            [cpp.call(cpp.arrow(o, "shared_from_this"))],
            [self],
          ),
        ),
      ),
      cpp.exprStmt(cpp.call("lucent::objc::adoptSubclassObject", [o, x])),
      // Held until the constructor is done: then Lucent references hold it.
      cpp.exprStmt(
        cpp.assign(
          cpp.arrow(o, "lucentNative_"),
          cpp.call("lucent::objc::wrap", [x, cpp.str(`new ${name}`)]),
        ),
      ),
    ],
    { static: true },
  );

  const constPtr = cpp.param(cpp.pointer(cpp.constType(cpp.type(info.cppName))), "o");
  const nativeOf = (body?: cpp.Stmt[]) =>
    cpp.fn("lucentNativeOf", cpp.type("lucent::NativeRef"), [constPtr], body);
  const owned = (body?: cpp.Stmt[]) =>
    cpp.fn(
      "lucentSelf",
      cpp.type("lucent::Ref", cpp.type(info.cppName)),
      [cpp.param(cpp.pointer(cpp.type(info.cppName)), "o")],
      body,
    );

  em.ctx.nativeUnit(module).include("lucent/platform/ios.h");
  return {
    native: [
      {
        k: "objcInterface",
        name: sub,
        superclass: base.cls.native,
        protocols: protocols.map((p) => p.cls.native),
        ivars: [{ type: ref, name: "self_" }],
      },
      {
        k: "objcImplementation",
        name: sub,
        methods: [...overrides, ...supers, ...requirements, dealloc],
      },
      cpp.namespace("lucent_app", [
        adopted,
        nativeOf([cpp.ret(cpp.call("lucent::objc::nativeOfSubclass", [o, cpp.str(name)]))]),
        owned([cpp.ret(cpp.call("lucent::objc::nativeOwned", [o]))]),
      ]),
    ],
    decls: [nativeOf(), owned()],
  };
}

/**
 * A method with `m`'s selector calling the base's implementation of it:
 * the subclass's `lucentSuper_…` method, once renamed.
 */
function superMethod(ref: SdkClassRef, m: SdkMethodSchema): cpp.ObjcMethod {
  const params: SdkType[] = m.params.map((p) => parseSdkType(p.type, ref.module));
  const ret = parseSdkType(m.returns, ref.module);
  const selector = m.selector ?? m.name;
  const labels = selector.split(":").slice(0, -1);
  const names = params.map((_, i) => `a${i}_`);

  const parts = labels.length
    ? labels.map((part, i) => ({ name: part, param: cpp.param(objcType(params[i]!), names[i]) }))
    : [{ name: selector }];
  const call = cpp.send(
    cpp.id("super"),
    selector,
    names.map((n) => cpp.id(n)),
  );
  const isVoid = ret.k === "prim" && ret.name === "void";

  return { ret: objcType(ret), parts, body: [isVoid ? cpp.exprStmt(call) : cpp.ret(call)] };
}
