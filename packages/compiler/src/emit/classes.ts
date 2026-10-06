import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import type { LucentModule } from "../program.ts";
import { stringExpr } from "../lowering/literals.ts";
import {
  type ClassChain,
  type ClassInfo,
  cppIdent,
  type LType,
  substitute,
  T,
  unionOf,
} from "../types.ts";
import type { Ctx, ParamInfo } from "./context.ts";
import { operand } from "../ir/cpp.ts";
import type { ValueId } from "../ir/ir.ts";
import type { Initializer, Leaf } from "../ir/lower.ts";
import { functionName } from "./builtins.ts";
import { type FnOptions, FnEmitter } from "./function.ts";
import { initializationThroughIr, type IrMode, throughIr } from "./through-ir.ts";
import { ifaceOverrides, ifacesOf, virtualMembers } from "./interfaces.ts";
import { subclassImplicitSuper } from "./objc-subclass.ts";

export interface ClassOutput {
  /** Class definition for the header. */
  definition: cpp.Decl;
  /** Out-of-line member definitions (none for generic classes). */
  members: cpp.Decl[];
  /** Each static field, with its initializer and where it goes, which the module's init() runs. */
  statics: { decl: ts.PropertyDeclaration; init: Initializer }[];
}

/** An initializer's value: its expression, or its type's default without one. */
export function initialValue(
  ctx: Ctx,
  initializer: ts.Expression | undefined,
  t: LType,
): Initializer["value"] {
  return initializer
    ? { expr: initializer }
    : { leaf: { name: "default", code: cpp.construct(ctx.reg.cppType(t), [], true), type: t } };
}

function modifiers(n: ts.Node): ts.SyntaxKind[] {
  return ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []).map((m) => m.kind) : [];
}
const isStatic = (n: ts.Node) => modifiers(n).includes(ts.SyntaxKind.StaticKeyword);
const isAsync = (n: ts.Node) => modifiers(n).includes(ts.SyntaxKind.AsyncKeyword);

/** The name of a class's `[Symbol.dispose]()` method: the one symbol-keyed member Lucent classes have. */
export const DISPOSE = "[Symbol.dispose]";

/**
 * `lucentJson_(w, toJson)`, every class's JSON writer (emit/index.ts
 * jsonWriters defines it): virtual, so a base-typed value writes as its class.
 */
export const jsonMemberParams = [
  cpp.param(cpp.reference(cpp.type("lucent::JsonWriter")), "w"),
  cpp.param(cpp.type("bool"), "toJson"),
];

/** `Symbol.dispose`, as written. */
export function isSymbolDispose(e: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(e) &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === "Symbol" &&
    e.name.text === "dispose"
  );
}

/** A member's name, or undefined when it has none Lucent supports. */
function nameOf(n: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!n) return undefined;
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  if (ts.isComputedPropertyName(n) && isSymbolDispose(n.expression)) return DISPOSE;
  return undefined;
}

export function memberName(m: ts.ClassElement | ts.ParameterDeclaration): string {
  if (!m.name) fail(m, Codes.UnsupportedClassFeature, "unnamed class member");
  return (
    nameOf(m.name) ??
    fail(
      m,
      Codes.UnsupportedClassFeature,
      "computed member names are not supported, but for [Symbol.dispose]",
    )
  );
}

/** Parameter properties: `constructor(private x: number)`. */
export function parameterProperties(
  ctor: ts.ConstructorDeclaration | undefined,
): ts.ParameterDeclaration[] {
  return (ctor?.parameters ?? []).filter((p) =>
    modifiers(p).some((k) =>
      [
        ts.SyntaxKind.PrivateKeyword,
        ts.SyntaxKind.PublicKeyword,
        ts.SyntaxKind.ProtectedKeyword,
        ts.SyntaxKind.ReadonlyKeyword,
      ].includes(k),
    ),
  );
}

type InstanceMember = ts.ClassElement | ts.ParameterDeclaration;

/** The nearest class in `chain` that declares an instance member `name` matching `test`. */
export function findMember(
  chain: ClassChain,
  name: string,
  test: (m: InstanceMember) => boolean,
): { decl: InstanceMember; owner: ClassChain[number] } | undefined {
  for (const owner of chain) {
    const decls: InstanceMember[] = [
      ...owner.info.decl.members,
      ...parameterProperties(owner.info.decl.members.find(ts.isConstructorDeclaration)),
    ];
    for (const m of decls)
      if (!isStatic(m) && nameOf(m.name) === name && test(m)) return { decl: m, owner };
  }
  return undefined;
}

/** Type-parameter substitution for a class type's own parameters. */
export function argMap(ctx: Ctx, t: LType & { k: "class" }): Map<string, LType> {
  const info = ctx.reg.cls(t.id);
  return new Map(
    info.typeParams.map((p, i) => [p, t.args[i] ?? ({ k: "tparam", name: p } as LType)]),
  );
}

const isField = (m: InstanceMember) => ts.isPropertyDeclaration(m) || ts.isParameter(m);

/**
 * A class's C++: its definition, members and static initializers; its
 * methods, accessors and constructor lower through the semantic IR.
 */
export function emitClass(
  ctx: Ctx,
  module: LucentModule,
  info: ClassInfo,
  ir: IrMode,
): ClassOutput {
  const decl = info.decl;
  const reg = ctx.reg;
  // A decorator may replace what it decorates or add initializers when the
  // class is defined: the class compiles without it, so its uses still check.
  for (const n of [decl, ...decl.members])
    for (const d of (ts.canHaveDecorators(n) && ts.getDecorators(n)) || [])
      ctx.guard(() =>
        fail(
          d,
          Codes.UnsupportedClassFeature,
          "decorators are not supported",
          "call the decorator function on the class or method yourself",
        ),
      );

  const generic = info.typeParams.length > 0;
  const template = generic ? info.typeParams.map(cppIdent) : undefined;
  const selfType = cpp.type(info.cppName, ...info.typeParams.map((p) => cpp.type(cppIdent(p))));
  const baseT: (LType & { k: "class" }) | undefined = info.base
    ? { k: "class", id: info.base.id, args: info.base.args }
    : undefined;
  const ancestry: ClassChain = baseT ? reg.chain(baseT) : [];
  const inherited = (name: string, test: (m: InstanceMember) => boolean) =>
    findMember(ancestry, name, test);
  const inHierarchy = !!info.base || reg.descendants(info.id).length > 0;
  const bases: cpp.Base[] = [
    {
      type: baseT
        ? reg.cppClassType(baseT)
        : cpp.type(info.isError ? "lucent::ErrorObject" : "lucent::Object"),
    },
    // Virtual, so a class implementing both A and B extends A has one A.
    ...ifacesOf(ctx, info).map((i) => ({ type: reg.cppIfaceType(i), virtual: true })),
  ];
  const body: cpp.Member[] = [];
  const members: cpp.Decl[] = [];
  const statics: ClassOutput["statics"] = [];
  const ctor = decl.members.find(ts.isConstructorDeclaration);
  const virtuals = ctx.guard(() => virtualMembers(ctx, info)) ?? new Set<string>();

  const fieldType = (n: ts.Node) => reg.lower(ctx.checker.getTypeAtLocation(n), n);
  /** A field redeclared from a base class shares the base's storage, Error's own fields too. */
  const declareField = (m: ts.PropertyDeclaration | ts.ParameterDeclaration, t: LType) => {
    const name = memberName(m);
    if (info.isError && ERROR_FIELDS.includes(name)) return;
    const base = inherited(name, isField);
    if (!base) return body.push(cpp.field(reg.cppType(t), cppIdent(name)));
    const baseType = substitute(fieldType(base.decl), argMap(ctx, base.owner.t));
    if (reg.cpp(baseType) !== reg.cpp(t))
      fail(
        m,
        Codes.UnsupportedClassFeature,
        `${name} redeclares ${base.owner.info.decl.name!.text}.${name} with a different type`,
      );
  };
  // Fields
  const nativeSubclass = ctx.platform === "ios" && info.sdkBase?.platform === "ios";
  // Its native object, held while the constructor runs (objc-subclass.ts).
  if (nativeSubclass) body.push(cpp.field(cpp.type("lucent::NativeRef"), "lucentNative_"));
  for (const p of parameterProperties(ctor)) declareField(p, fieldType(p));
  for (const m of decl.members) {
    if (!ts.isPropertyDeclaration(m)) continue;
    const t = fieldType(m);
    const name = cppIdent(memberName(m));
    if (isStatic(m)) {
      if (generic)
        fail(
          m,
          Codes.UnsupportedClassFeature,
          "static fields in generic classes are not supported",
        );
      body.push(cpp.field(reg.cppType(t), name, { static: true, inline: true }));
      const field = cpp.scoped(cpp.type(info.cppName), name);

      statics.push({
        decl: m,
        init: {
          value: initialValue(ctx, m.initializer, t),
          type: t,
          into: { write: (v) => assigns(`${info.cppName}::${name} =`, field, v) },
        },
      });
    } else {
      declareField(m, t);
    }
  }

  /** Native signature of a method as seen through its declaring class type. */
  const nativeSignature = (
    node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
    owner?: ClassChain[number],
  ) => {
    const fn = reg.lowerSignature(ctx.checker.getSignatureFromDeclaration(node)!, node) as LType & {
      k: "fn";
    };
    const map = owner ? argMap(ctx, owner.t) : new Map<string, LType>();
    const em = new FnEmitter(ctx, { module, async: false });
    const ret = isAsync(node)
      ? ({ k: "promise", inner: fn.ret.k === "promise" ? fn.ret.inner : fn.ret } as LType)
      : fn.ret;
    return `${reg.cppRet(substitute(ret, map))}(${em
      .paramInfos(node, fn)
      .map((p) => reg.cpp(substitute(p.cppType, map)))
      .join(", ")})`;
  };
  /** `virtual` / `override` for an instance method or accessor in a class hierarchy. */
  const dispatch = (
    node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
    cppName: string,
  ): { virtual?: boolean; override?: boolean } => {
    const name = memberName(node);
    const kind = ts.isMethodDeclaration(node)
      ? ts.isMethodDeclaration
      : ts.isGetAccessorDeclaration(node)
        ? ts.isGetAccessorDeclaration
        : ts.isSetAccessorDeclaration;
    const base = inherited(name, (m) => kind(m as ts.Node));
    if (base) {
      const mine = nativeSignature(node);
      const theirs = nativeSignature(base.decl as ts.MethodDeclaration, base.owner);
      if (mine !== theirs)
        fail(
          node,
          Codes.UnsupportedClassFeature,
          `${info.decl.name!.text}.${name} has native signature ${mine}, but it overrides ${base.owner.info.decl.name!.text}.${name}, which has ${theirs}; declare the same parameter and return types`,
        );
      if (ts.isMethodDeclaration(node) && node.typeParameters?.length)
        fail(node, Codes.UnsupportedClassFeature, "generic methods cannot be overridden");
      return { override: true };
    }
    if (virtuals.has(cppName)) return { override: true };
    const generic = ts.isMethodDeclaration(node) && !!node.typeParameters?.length;
    return inHierarchy && !generic ? { virtual: true } : {};
  };
  /** A member function: defined in the class if it is generic, out of line otherwise. */
  const define = (
    name: string,
    ret: cpp.Type,
    params: cpp.Param[],
    fnBody: cpp.Stmt[],
    opts: { static?: boolean; virtual?: boolean; override?: boolean } = {},
  ) => {
    if (generic) return body.push(cpp.method(name, ret, params, fnBody, opts));
    body.push(cpp.method(name, ret, params, undefined, opts));
    members.push(cpp.fn(name, ret, params, fnBody, { scope: cpp.type(info.cppName) }));
  };

  /**
   * A method, accessor or constructor, through the IR. What the IR rejects
   * in it is its diagnostic; the class still declares the member, so the
   * rest of it compiles on.
   */
  const emitMethod = (
    node:
      | ts.MethodDeclaration
      | ts.ConstructorDeclaration
      | ts.GetAccessorDeclaration
      | ts.SetAccessorDeclaration,
    cppName: string,
    staticMember: boolean,
    superCtor?: { call: cpp.Expr; params: LType[] },
  ) => {
    const sig = ctx.checker.getSignatureFromDeclaration(node)!;
    const fnType = reg.lowerSignature(sig, node) as LType & { k: "fn" };
    const asyncM = isAsync(node);
    const isCtor = ts.isConstructorDeclaration(node);
    const gen = ts.isMethodDeclaration(node) && !!node.asteriskToken;
    let ret: LType = isCtor || gen ? T.void : fnType.ret;
    if (asyncM) ret = ret.k === "promise" ? ret.inner : ret;
    const opts: FnOptions = {
      module,
      async: asyncM,
      ...(staticMember ? {} : { cls: info, thisExpr: "this" }),
      ...(superCtor ? { superCtor } : {}),
    };
    const params = new FnEmitter(ctx, opts).paramInfos(node, fnType);
    const flags = {
      ...(staticMember ? { static: true } : {}),
      ...(staticMember || isCtor ? {} : dispatch(node, cppName)),
    };
    // Coroutines outlive the call: keep the object alive in the frame.
    const keepSelf =
      (asyncM || gen) && !staticMember
        ? [cpp.varDecl(cpp.auto, "self", cpp.call("lucent::selfRef", [cpp.self]))]
        : [];
    const lowered = ctx.guard(() =>
      throughIr(
        ctx,
        {
          decl: node,
          id: `${info.cppName}::${cppName}`,
          params,
          result: ret,
          async: asyncM,
          ...(gen && fnType.ret.k === "iter" ? { generator: fnType.ret.e } : {}),
          generic: ts.isMethodDeclaration(node) && !!node.typeParameters?.length,
          opts,
          site: functionName(node.body ?? node),
          prologue: keepSelf,
          ...(isCtor
            ? {
                construct: { initializers: fieldInitializers(), base: !!superCtor },
                span: decl,
              }
            : {}),
        },
        ir,
      ),
    );

    if (lowered) {
      define(cppName, lowered.ret, lowered.params, lowered.body, flags);
      return { decls: lowered.params, params };
    }

    const decls = params.map((p, i) => cpp.param(reg.cppType(p.cppType), `p${i}_`));
    const retType = asyncM
      ? cpp.type("lucent::Promise", reg.cppRetType(ret))
      : gen
        ? reg.cppType(fnType.ret)
        : reg.cppRetType(ret);

    define(cppName, retType, decls, [cpp.exprStmt(cpp.call("lucent::unreachable"))], flags);
    return { decls, params };
  };

  // Constructor: construct() runs field initializers, then the body.
  const self = (name: string) => cpp.arrow(cpp.self, name);
  /** What construct() initializes, for the IR: an Error's name, parameter properties, fields. */
  const fieldInitializers = (): Initializer[] => {
    const write = (name: string) => (v: ValueId) =>
      assigns(`this.${name} =`, self(cppIdent(name)), v);
    const fields = decl.members.filter(
      (m): m is ts.PropertyDeclaration & { initializer: ts.Expression } =>
        ts.isPropertyDeclaration(m) && !isStatic(m) && !!m.initializer,
    );

    return [
      // A Lucent base class names it first.
      ...(info.isError && !info.base
        ? [{ value: { string: "Error" }, type: T.string, into: { write: write("name") } }]
        : []),
      ...parameterProperties(ctor).map((p) => ({
        value: { param: p },
        type: fieldType(p),
        into: { write: write(memberName(p)) },
      })),
      ...fields.map((m) => ({
        value: { expr: m.initializer },
        type: fieldType(m),
        into: { write: write(memberName(m)) },
      })),
    ];
  };
  let ctorDecls: cpp.Param[] = [];
  /** The implicit constructor, through the IR: its base's construction on its arguments, then the fields. */
  const implicitConstructor = (): void => {
    // Without a Lucent base, an Error subclass's arguments go to Error: its message.
    const toError = !superCtor && info.isError;
    const params = superCtor?.params ?? (toError ? [ERROR_MESSAGE.cppType] : []);
    const sc = superCtor;
    const lowered = initializationThroughIr(
      ctx,
      {
        id: `${info.cppName}::construct`,
        source: decl,
        params,
        ...(sc
          ? {
              first: (args: ValueId[]): Leaf => ({
                name: "super()",
                code: cpp.call(sc.call, args.map(operand)),
                type: T.void,
              }),
            }
          : nativeSubclass
            ? {
                // Extending an iOS class: its native object, made as super() would.
                first: (): Leaf => ({
                  name: "super()",
                  code: cpp.statementExpr(
                    [subclassImplicitSuper(info)],
                    cpp.id("lucent::undefined"),
                  ),
                  type: T.void,
                }),
              }
            : toError
              ? {
                  first: ([message]: ValueId[]): Leaf => ({
                    name: "this->message =",
                    code: cpp.assign(
                      cpp.arrow(cpp.self, "message"),
                      cpp.call(cpp.dot(operand(message!), "valueOr"), [stringExpr("")]),
                    ),
                    type: T.void,
                  }),
                }
              : {}),
        initializers: fieldInitializers(),
      },
      {
        module,
        async: false,
        cls: info,
        thisExpr: "this",
      },
      `new ${decl.name?.text ?? ""}`,
      ir,
    );

    ctorDecls = lowered.params;
    define("construct", cpp.voidType, ctorDecls, lowered.body);
  };
  // With a Lucent base class, super(...) runs the base's construct() and
  // then this class's field initializers, as in JavaScript.
  const superCtor = baseT
    ? {
        call: cpp.baseMember(cpp.self, reg.cppClassType(baseT), "construct"),
        params: constructorOf(ctx, baseT).map((p) => p.cppType),
      }
    : undefined;
  if (ctor) ctorDecls = emitMethod(ctor, "construct", false, superCtor).decls;
  else ctx.guard(implicitConstructor);
  if (!info.abstract) {
    // Abstract classes are only constructed through subclasses.
    const created = cpp.id("self");
    const construct = cpp.exprStmt(
      cpp.call(
        cpp.arrow(created, "construct"),
        ctorDecls.map((p) => cpp.id(p.name!)),
      ),
    );
    // Extending an Objective-C class: the native object made by super(…)
    // owns the Lucent one, and what create() gives holds the native object.
    const letGo = cpp.exprStmt(cpp.assign(cpp.arrow(created, "lucentNative_"), cpp.initList([])));
    const made: cpp.Stmt[] = nativeSubclass
      ? [
          { k: "try", body: [construct], catches: [{ body: [letGo, { k: "throw" }] }] },
          cpp.varDecl(
            cpp.auto,
            "r_",
            cpp.call("lucent::selfRef", [cpp.call(cpp.dot(created, "get"))]),
          ),
          letGo,
          cpp.ret(cpp.id("r_")),
        ]
      : [construct, cpp.ret(created)];
    define(
      "create",
      cpp.type("lucent::Ref", selfType),
      ctorDecls,
      [cpp.varDecl(cpp.auto, "self", cpp.call("std::make_shared", [], [selfType])), ...made],
      { static: true },
    );
  }

  for (const m of decl.members) {
    if (ts.isMethodDeclaration(m)) {
      if (!m.body) {
        if (ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.AbstractKeyword)) {
          const name = cppIdent(memberName(m));
          const d = dispatch(m, name);
          const fn = reg.lowerSignature(ctx.checker.getSignatureFromDeclaration(m)!, m) as LType & {
            k: "fn";
          };
          const em = new FnEmitter(ctx, { module, async: false });
          const ps = em.paramInfos(m, fn).map((p, i) => cpp.param(reg.cppType(p.cppType), `a${i}`));
          body.push(
            cpp.method(name, reg.cppRetType(fn.ret), ps, undefined, {
              virtual: true,
              ...(d.override ? { override: true } : {}),
              pure: true,
            }),
          );
        }
        continue;
      }
      emitMethod(m, cppIdent(memberName(m)), isStatic(m));
    } else if (ts.isGetAccessorDeclaration(m)) {
      emitMethod(m, `get_${cppIdent(memberName(m))}`, isStatic(m));
    } else if (ts.isSetAccessorDeclaration(m)) {
      emitMethod(m, `set_${cppIdent(memberName(m))}`, isStatic(m));
    } else if (
      ts.isPropertyDeclaration(m) ||
      ts.isConstructorDeclaration(m) ||
      ts.isSemicolonClassElement(m)
    ) {
      continue;
    } else if (ts.isClassStaticBlockDeclaration(m)) {
      fail(
        m,
        Codes.UnsupportedClassFeature,
        "static blocks are not supported",
        "give each static field its value in its initializer, or in a function the module calls",
      );
    } else if (ts.isIndexSignatureDeclaration(m)) {
      fail(m, Codes.UnsupportedClassFeature, "index signatures in classes are not supported");
    }
  }
  body.push(
    cpp.method(
      "lucentJson_",
      cpp.type("bool"),
      jsonMemberParams,
      undefined,
      info.base ? { override: true } : { virtual: true },
    ),
  );
  const overrides = ctx.guard(() => ifaceOverrides(ctx, info)) ?? [];
  const definition = cpp.struct(info.cppName, [...body, ...overrides], {
    ...(template ? { template } : {}),
    bases,
  });
  return { definition, members, statics };
}

/** A plan writing `value` into `place`. */
function assigns(name: string, place: cpp.Expr, value: ValueId): Leaf {
  return { name, code: cpp.assign(place, operand(value)), type: T.void };
}

/** Error's own fields, which a subclass redeclaring them shares. */
const ERROR_FIELDS = ["name", "message"];

/** The message an Error subclass's implicit constructor passes to Error. */
const ERROR_MESSAGE: ParamInfo = {
  name: "message",
  type: unionOf([T.string, T.undefined]),
  cppType: unionOf([T.string, T.undefined]),
  optional: true,
  rest: false,
};

/**
 * The parameters `new` on `t` takes: the nearest constructor its chain
 * declares, in `t`'s type arguments, or, declaring none, Error's message
 * for an Error subclass (JavaScript's implicit constructor forwards its
 * arguments to its base's).
 */
export function constructorOf(ctx: Ctx, t: LType & { k: "class" }): ParamInfo[] {
  const owner = ctx.reg.chain(t).find((c) => c.info.decl.members.some(ts.isConstructorDeclaration));
  if (!owner) return ctx.reg.cls(t.id).isError ? [ERROR_MESSAGE] : [];

  const ctor = owner.info.decl.members.find(ts.isConstructorDeclaration)!;
  const fn = ctx.reg.lowerSignature(
    ctx.checker.getSignatureFromDeclaration(ctor)!,
    ctor,
  ) as LType & { k: "fn" };
  const module = ctx.modules.find((m) => m.sourceFile === ctor.getSourceFile())!;
  const map = argMap(ctx, owner.t);

  return new FnEmitter(ctx, { module, async: false }).paramInfos(ctor, fn).map((p) => ({
    ...p,
    type: substitute(p.type, map),
    cppType: substitute(p.cppType, map),
  }));
}
