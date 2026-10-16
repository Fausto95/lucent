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
 *
 * An exported class's subclass is one the OS can make by name (decision
 * 0124), `LucentApp_<module>_<Class>`: when its constructor and super(…)
 * take nothing, its `init` makes the Lucent instance through the native
 * root, and super(…) adopts the object the OS made.
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
import { osObjcName } from "../os-names.ts";
import { type ClassInfo, cppIdent, T } from "../types.ts";
import { memberName, parameterProperties } from "./classes.ts";
import type { Ctx, E } from "./context.ts";
import { forward, requirementMethods } from "./delegates.ts";
import { FnEmitter } from "./function.ts";
import { iosSuperInit, noteFramework, objcType, superSelector } from "./native.ts";

/** The generated Objective-C class standing for instances of `info`. */
export const subclassName = (info: ClassInfo) =>
  iosOsMade(info)
    ? osObjcName(info.module, info.decl.name!.text)
    : `LucentSub_${info.cppName.replace(/^C_/, "")}`;

/** Classes whose Objective-C name another's came out as: they keep a name of the build's (decision 0124). */
const clashing = new WeakSet<ClassInfo>();

/** Gives `info` no name the OS can rely on: another class's came out the same. */
export function refuseIosOsName(info: ClassInfo): void {
  clashing.add(info);
}

/**
 * Whether the OS can make `info`'s Objective-C class by name (decision
 * 0124): an exported, concrete class extending an iOS class.
 */
export function iosOsMade(info: ClassInfo): boolean {
  return (
    info.exported &&
    !info.abstract &&
    !info.typeParams.length &&
    info.sdkBase?.platform === "ios" &&
    !clashing.has(info)
  );
}

/** The `super(…)` call of `info`'s own constructor, if it has one. */
function superCallOf(info: ClassInfo): ts.CallExpression | undefined {
  const ctor = info.members.find(ts.isConstructorDeclaration);
  let found: ts.CallExpression | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.SuperKeyword) found = n;
    else if (!ts.isFunctionLike(n) || n === ctor) ts.forEachChild(n, visit);
  };
  if (ctor) visit(ctor);
  return found;
}

/**
 * Whether the OS can make an instance of `info` with `init`: an OS-made
 * class whose constructor takes no parameters, whose super(…) passes none,
 * and whose base has an `init`. Its `init` then makes the Lucent instance.
 */
function osInit(info: ClassInfo, chain: SdkClassRef[]): boolean {
  if (!iosOsMade(info)) return false;
  const ctor = info.members.find(ts.isConstructorDeclaration);
  if (ctor?.parameters.length) return false;
  if (superCallOf(info)?.arguments.length) return false;
  return chain
    .flatMap((ref) => ref.cls.constructors ?? [])
    .some((c) => !c.params.length && !c.swift && (c.selector ?? "init") === "init");
}

/** `made`, or the object the OS made while `info`'s init makes its Lucent instance. */
function superObject(info: ClassInfo, made: cpp.Expr): cpp.Expr {
  if (!osInit(info, sdkChain(info.sdkBase!))) return made;
  return cpp.call("lucent::objc::superObject", [
    cpp.send(subclassName(info), "class"),
    cpp.lambda(["&"], [], [cpp.ret(made)], { ret: cpp.type("id") }),
  ]);
}

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
  const made = superObject(info, iosSuperInit(em, node, info.sdkBase!, subclassName(info)));

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

  const made = superObject(
    info,
    cpp.send(cpp.send(subclassName(info), "alloc"), init!.selector ?? "init"),
  );
  return cpp.exprStmt(cpp.call(`lucent_app::${adopt(info)}`, [cpp.self, made]));
}

/**
 * `super.name(…)` / `super.name`: the base's implementation of a method
 * the class overrides (through the subclass's `lucentSuper_` method), or
 * the inherited member itself. `getter` and `setter` say whether the class
 * overrides the property's (`super.name` read and written).
 */
export function subclassSuper(
  info: ClassInfo,
  name: string,
): { overridden: boolean; getter: boolean; setter: boolean; self: E } {
  const chain = baseChain(info);
  const self = subclassNative({ c: cpp.self, t: { k: "class", id: info.id, args: [] } }, info);
  const found = inherited(chain, name);
  const property = !!found?.property;

  return {
    overridden: !!found?.method && !!ownMethod(info, name),
    getter: property && !!ownAccessor(info, name, ts.SyntaxKind.GetAccessor),
    setter: property && !!ownAccessor(info, name, ts.SyntaxKind.SetAccessor),
    self,
  };
}

function ownAccessor(
  info: ClassInfo,
  name: string,
  kind: ts.SyntaxKind.GetAccessor | ts.SyntaxKind.SetAccessor,
): ts.AccessorDeclaration | undefined {
  return info.members.find(
    (m): m is ts.AccessorDeclaration =>
      m.kind === kind &&
      !!(m as ts.AccessorDeclaration).body &&
      !ts
        .getModifiers(m as ts.AccessorDeclaration)
        ?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) &&
      memberName(m) === name,
  );
}

function ownMethod(info: ClassInfo, name: string): ts.MethodDeclaration | undefined {
  return info.members.find(
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
  const ctor = info.members.find(ts.isConstructorDeclaration);
  const fields = [
    ...info.members.filter(
      (m) =>
        (ts.isPropertyDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) &&
        !ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword),
    ),
    ...parameterProperties(ctor),
  ];
  // Accessors overriding the base's properties: an Objective-C getter and setter each.
  const accessors: {
    impl: ts.AccessorDeclaration;
    ref: SdkClassRef;
    property: SdkPropertySchema;
  }[] = [];
  for (const f of fields) {
    const field = memberName(f as ts.ClassElement);
    const found = inherited(chain, field);
    if (!found) continue;
    if (ts.isPropertyDeclaration(f) || ts.isParameter(f))
      fail(
        f,
        Codes.UnsupportedClassFeature,
        `${name}.${field}: ${found.ref.cls.name} has a property of that name; set it (this.${field} = …) instead of declaring a field`,
      );
    const impl = f as ts.AccessorDeclaration;
    if (!found.property)
      fail(
        f,
        Codes.UnsupportedClassFeature,
        `${name}.${field}: ${found.ref.cls.name}.${field} is a method`,
      );
    if (found.property.swift || found.property.cFunctions)
      fail(
        f,
        Codes.UnsupportedClassFeature,
        `${name}.${field}: ${found.ref.cls.name}'s ${found.property.swift ? "Swift" : "C"} properties cannot be overridden`,
      );
    if (ts.isSetAccessorDeclaration(impl) && !found.property.setter)
      fail(
        f,
        Codes.UnsupportedClassFeature,
        `${name}.${field}: ${found.ref.cls.name}.${field} is read-only: it has no setter to override`,
      );
    if (impl.body) accessors.push({ impl, ref: found.ref, property: found.property });
  }

  // Overrides: the base's methods the class defines, and the base's own implementation for super.
  const overrides: cpp.ObjcMethod[] = [];
  const supers: cpp.ObjcMethod[] = [];
  for (const m of info.members) {
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

  for (const { impl, ref, property } of accessors) {
    const getter = ts.isGetAccessorDeclaration(impl);
    const method: SdkMethodSchema = getter
      ? {
          name: property.name,
          params: [],
          returns: property.type,
          selector: property.selector ?? property.name,
        }
      : {
          name: property.name,
          params: [{ name: "value", type: property.type }],
          returns: { k: "prim", name: "void", nullable: false },
          selector: property.setter!,
        };
    const target = `${getter ? "get" : "set"}_${cppIdent(property.name)}`;
    const override = forward(em, info, ref, method, impl, true, target);
    const base = superMethod(ref, method);
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

  // The OS makes it with init (decision 0124): through the native root, module state starts if
  // none lasts, the instance holds it while the object lives, and its constructor runs holding
  // the module's actor, its super(…) adopting the object the OS made.
  const os = osInit(info, chain);
  const factory = `os_${info.cppName}`;
  const osDecls: cpp.Decl[] = [];
  const osMethods: cpp.ObjcMethod[] = [];
  if (os) {
    em.ctx.nativeUnit(module).include("lucent/entries.h");
    osDecls.push(
      cpp.namespace("lucent_app", [
        cpp.fn(
          factory,
          cpp.type("bool"),
          [cpp.param(cpp.type("id"), "self_")],
          [
            cpp.exprStmt(
              cpp.call("lucent::ensureModuleState", [
                cpp.addressOf(cpp.id("lucent_app::initModules")),
              ]),
            ),
            cpp.varDecl(
              cpp.auto,
              "hold_",
              cpp.call("std::make_shared", [], [cpp.type("lucent::ModuleStateHold")]),
            ),
            cpp.varDecl(
              cpp.type("lucent::entries::detail::EntryScope"),
              "scope_",
              em.ctx.actorAt(module),
              { style: "construct" },
            ),
            cpp.ret(
              cpp.call("lucent::objc::adoptOsObject", [
                cpp.id("self_"),
                cpp.send(sub, "class"),
                cpp.id("hold_"),
                cpp.lambda(
                  ["&"],
                  [],
                  [
                    cpp.exprStmt(
                      cpp.cast("c", cpp.voidType, cpp.call(`lucent_app::${info.cppName}::create`)),
                    ),
                  ],
                ),
                cpp.str(name),
              ]),
            ),
          ],
          { static: true },
        ),
      ]),
    );
    osMethods.push({
      ret: cpp.type("instancetype"),
      parts: [{ name: "init" }],
      body: [
        cpp.exprStmt(cpp.assign(cpp.id("self"), cpp.send(cpp.id("super"), "init"))),
        // The OS's (or native code's), not a Lucent super(…)'s: its Lucent instance.
        cpp.ifStmt(
          cpp.binary(
            cpp.binary(cpp.id("self"), "&&", cpp.call("lucent::objc::madeByOs")),
            "&&",
            cpp.unary("!", cpp.call(`lucent_app::${factory}`, [cpp.id("self")])),
          ),
          [cpp.ret(cpp.id("nil"))],
        ),
        cpp.ret(cpp.id("self")),
      ],
    });
  }

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
      ...osDecls,
      {
        k: "objcImplementation",
        name: sub,
        methods: [...osMethods, ...overrides, ...supers, ...requirements, dealloc],
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
