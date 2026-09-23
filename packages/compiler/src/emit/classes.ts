import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import type { LucentModule } from "../program.ts";
import { type ClassChain, type ClassInfo, cppIdent, type LType, substitute, T } from "../types.ts";
import type { Ctx } from "./context.ts";
import { FnEmitter } from "./function.ts";
import { ifaceOverrides, ifacesOf, virtualMembers } from "./interfaces.ts";

export interface ClassOutput {
  /** Class definition for the header. */
  definition: string;
  /** Out-of-line member definitions (empty for generic classes). */
  members: string;
  /** Static field initializers, run by the module's init(). */
  staticInits: string[];
}

function modifiers(n: ts.Node): ts.SyntaxKind[] {
  return ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []).map((m) => m.kind) : [];
}
const isStatic = (n: ts.Node) => modifiers(n).includes(ts.SyntaxKind.StaticKeyword);
const isAsync = (n: ts.Node) => modifiers(n).includes(ts.SyntaxKind.AsyncKeyword);

export function memberName(m: ts.ClassElement | ts.ParameterDeclaration): string {
  const n = m.name;
  if (!n) fail(m, Codes.UnsupportedClassFeature, "unnamed class member");
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  fail(m, Codes.UnsupportedClassFeature, "computed member names are not supported");
}

/** Parameter properties: `constructor(private x: number)`. */
export function parameterProperties(ctor: ts.ConstructorDeclaration | undefined): ts.ParameterDeclaration[] {
  return (ctor?.parameters ?? []).filter((p) =>
    modifiers(p).some((k) => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(k)),
  );
}

type InstanceMember = ts.ClassElement | ts.ParameterDeclaration;

/** The nearest class in `chain` that declares an instance member `name` matching `test`. */
export function findMember(chain: ClassChain, name: string, test: (m: InstanceMember) => boolean): { decl: InstanceMember; owner: ClassChain[number] } | undefined {
  for (const owner of chain) {
    const decls: InstanceMember[] = [...owner.info.decl.members, ...parameterProperties(owner.info.decl.members.find(ts.isConstructorDeclaration))];
    for (const m of decls) {
      if (!m.name || ts.isComputedPropertyName(m.name) || isStatic(m)) continue;
      if ((ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name) || ts.isStringLiteral(m.name)) && m.name.text === name && test(m)) return { decl: m, owner };
    }
  }
  return undefined;
}

/** Type-parameter substitution for a class type's own parameters. */
export function argMap(ctx: Ctx, t: LType & { k: "class" }): Map<string, LType> {
  const info = ctx.reg.cls(t.id);
  return new Map(info.typeParams.map((p, i) => [p, t.args[i] ?? ({ k: "tparam", name: p } as LType)]));
}

const isField = (m: InstanceMember) => ts.isPropertyDeclaration(m) || ts.isParameter(m);

export function emitClass(ctx: Ctx, module: LucentModule, info: ClassInfo): ClassOutput {
  const decl = info.decl;
  const reg = ctx.reg;
  const generic = info.typeParams.length > 0;
  const tmpl = generic ? `template <${info.typeParams.map((p) => `class ${cppIdent(p)}`).join(", ")}>\n` : "";
  const selfType: LType = { k: "class", id: info.id, args: info.typeParams.map((p) => ({ k: "tparam", name: p }) as LType) };
  const qual = `${info.cppName}${generic ? `<${info.typeParams.map(cppIdent).join(", ")}>` : ""}`;
  const baseT: (LType & { k: "class" }) | undefined = info.base ? { k: "class", id: info.base.id, args: info.base.args } : undefined;
  const ancestry: ClassChain = baseT ? reg.chain(baseT) : [];
  const inherited = (name: string, test: (m: InstanceMember) => boolean) => findMember(ancestry, name, test);
  const inHierarchy = !!info.base || reg.descendants(info.id).length > 0;
  const ancestorIfaces = new Set(reg.ancestors(info).flatMap((a) => ifacesOf(ctx, a).map((i) => i.id)));
  const bases = [
    baseT ? reg.cppClass(baseT) : info.isError ? "lucent::ErrorObject" : "lucent::Object",
    ...ifacesOf(ctx, info)
      .filter((i) => !ancestorIfaces.has(i.id))
      .map((i) => `lucent_app::${i.cppName}`),
  ];
  const body: string[] = [];
  const members: string[] = [];
  const staticInits: string[] = [];
  const ctor = decl.members.find(ts.isConstructorDeclaration);
  const virtuals = ctx.guard(() => virtualMembers(ctx, info)) ?? new Set<string>();

  const fieldType = (n: ts.Node) => reg.lower(ctx.checker.getTypeAtLocation(n), n);
  /** A field redeclared from a base class shares the base's storage. */
  const declareField = (m: ts.PropertyDeclaration | ts.ParameterDeclaration, t: LType) => {
    const name = memberName(m);
    const base = inherited(name, isField);
    if (!base) return body.push(`  ${reg.cpp(t)} ${cppIdent(name)}{};`);
    const baseType = substitute(fieldType(base.decl), argMap(ctx, base.owner.t));
    if (reg.cpp(baseType) !== reg.cpp(t)) fail(m, Codes.UnsupportedClassFeature, `${name} redeclares ${base.owner.info.decl.name!.text}.${name} with a different type`);
  };
  // Fields
  for (const p of parameterProperties(ctor)) declareField(p, fieldType(p));
  for (const m of decl.members) {
    if (!ts.isPropertyDeclaration(m)) continue;
    const t = fieldType(m);
    const name = cppIdent(memberName(m));
    if (isStatic(m)) {
      if (generic) fail(m, Codes.UnsupportedClassFeature, "static fields in generic classes are not supported");
      body.push(`  static inline ${reg.cpp(t)} ${name}{};`);
      if (m.initializer) {
        const em = new FnEmitter(ctx, { module, async: false, returnType: T.void });
        const v = ctx.guard(() => em.exprAs(m.initializer!, t));
        if (v !== undefined) staticInits.push(...em.lines, `  ${info.cppName}::${name} = ${v};`);
      }
    } else {
      declareField(m, t);
    }
  }

  /** Native signature of a method as seen through its declaring class type. */
  const nativeSignature = (node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration, owner?: ClassChain[number]) => {
    const fn = reg.lowerSignature(ctx.checker.getSignatureFromDeclaration(node)!, node) as LType & { k: "fn" };
    const map = owner ? argMap(ctx, owner.t) : new Map<string, LType>();
    const em = new FnEmitter(ctx, { module, async: false, returnType: T.void });
    const ret = isAsync(node) ? { k: "promise", inner: fn.ret.k === "promise" ? fn.ret.inner : fn.ret } as LType : fn.ret;
    return `${reg.cppRet(substitute(ret, map))}(${em.paramInfos(node, fn).map((p) => reg.cpp(substitute(p.cppType, map))).join(", ")})`;
  };
  /** `virtual` / `override` for an instance method or accessor in a class hierarchy. */
  const dispatch = (node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration, cppName: string): { prefix: string; suffix: string } => {
    const name = memberName(node);
    const kind = ts.isMethodDeclaration(node) ? ts.isMethodDeclaration : ts.isGetAccessorDeclaration(node) ? ts.isGetAccessorDeclaration : ts.isSetAccessorDeclaration;
    const base = inherited(name, (m) => kind(m as ts.Node));
    if (base) {
      const mine = nativeSignature(node);
      const theirs = nativeSignature(base.decl as ts.MethodDeclaration, base.owner);
      if (mine !== theirs) fail(node, Codes.UnsupportedClassFeature, `${info.decl.name!.text}.${name} has native signature ${mine}, but it overrides ${base.owner.info.decl.name!.text}.${name}, which has ${theirs}; declare the same parameter and return types`);
      if (ts.isMethodDeclaration(node) && node.typeParameters?.length) fail(node, Codes.UnsupportedClassFeature, "generic methods cannot be overridden");
      return { prefix: "", suffix: " override" };
    }
    if (virtuals.has(cppName)) return { prefix: "", suffix: " override" };
    const generic = ts.isMethodDeclaration(node) && !!node.typeParameters?.length;
    return { prefix: inHierarchy && !generic ? "virtual " : "", suffix: "" };
  };

  const emitMethod = (
    node: ts.MethodDeclaration | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
    cppName: string,
    staticMember: boolean,
    prelude?: (em: FnEmitter) => void,
    superCtor?: { call: string; params: LType[]; after: (em: FnEmitter) => void },
  ) => {
    const sig = ctx.checker.getSignatureFromDeclaration(node)!;
    const fnType = reg.lowerSignature(sig, node) as LType & { k: "fn" };
    const asyncM = isAsync(node);
    const isCtor = ts.isConstructorDeclaration(node);
    let ret: LType = isCtor ? T.void : fnType.ret;
    if (asyncM) ret = ret.k === "promise" ? ret.inner : ret;
    const em = new FnEmitter(ctx, {
      module,
      async: asyncM,
      returnType: ret,
      cls: staticMember ? undefined : info,
      thisExpr: staticMember ? undefined : "this",
      isConstructor: isCtor,
      superCtor,
    });
    const params = em.paramInfos(node, fnType);
    let decls: string[] = [];
    ctx.guard(() => {
      if (asyncM && !staticMember) em.line("auto self = lucent::selfRef(this);");
      decls = em.emitParams(node, params);
      prelude?.(em);
      em.emitFunctionBody(node);
    });
    const retCpp = asyncM ? `lucent::Promise<${reg.cppRet(ret)}>` : reg.cppRet(ret);
    const d = staticMember || ts.isConstructorDeclaration(node) ? { prefix: "", suffix: "" } : dispatch(node, cppName);
    const sigText = `${retCpp} ${cppName}(${decls.join(", ")})${d.suffix}`;
    const bodyText = em.body().join("\n");
    if (generic) {
      body.push(`  ${staticMember ? "static " : d.prefix}${sigText} {\n${indent(bodyText)}\n  }`);
    } else {
      body.push(`  ${staticMember ? "static " : d.prefix}${sigText};`);
      members.push(`${retCpp} ${info.cppName}::${cppName}(${decls.join(", ")}) {\n${bodyText}\n}`);
    }
    return { decls, params };
  };

  // Constructor: construct() runs field initializers, then the body.
  const initFields = (em: FnEmitter) => {
    if (info.isError) em.line(`this->name = LUCENT_STR("Error");`);
    for (const p of parameterProperties(ctor)) {
      const sym = ctx.checker.getSymbolAtLocation(p.name as ts.Identifier)!;
      const local = em.allScopes().map((s) => s.get(sym)).find(Boolean)!;
      em.line(`this->${cppIdent(memberName(p))} = ${local.boxed ? `*${local.cpp}` : local.cpp};`);
    }
    for (const m of decl.members) {
      if (!ts.isPropertyDeclaration(m) || isStatic(m) || !m.initializer) continue;
      const t = fieldType(m);
      const v = ctx.guard(() => em.exprAs(m.initializer!, t));
      if (v !== undefined) em.line(`this->${cppIdent(memberName(m))} = ${v};`);
    }
  };
  let ctorDecls: string[] = [];
  let ctorArgs: string[] = [];
  // With a Lucent base class, super(...) runs the base's construct() and
  // then this class's field initializers, as in JavaScript.
  const superCtor = baseT ? { call: `this->${reg.cppClass(baseT)}::construct`, params: inheritedCtorParams(ctx, ancestry), after: initFields } : undefined;
  if (ctor) {
    const r = superCtor ? emitMethod(ctor, "construct", false, undefined, superCtor) : emitMethod(ctor, "construct", false, initFields);
    ctorDecls = r.decls;
    ctorArgs = r.decls.map((d) => d.split(" ").pop()!);
  } else if (superCtor) {
    // Implicit constructor(...args) { super(...args); }
    const em = new FnEmitter(ctx, { module, async: false, returnType: T.void, cls: info, thisExpr: "this", isConstructor: true });
    ctorDecls = superCtor.params.map((p, i) => `${reg.cpp(p)} a${i}`);
    ctorArgs = superCtor.params.map((_, i) => `a${i}`);
    em.line(`${superCtor.call}(${ctorArgs.join(", ")});`);
    initFields(em);
    const bodyText = em.body().join("\n");
    if (generic) body.push(`  void construct(${ctorDecls.join(", ")}) {\n${indent(bodyText)}\n  }`);
    else {
      body.push(`  void construct(${ctorDecls.join(", ")});`);
      members.push(`void ${info.cppName}::construct(${ctorDecls.join(", ")}) {\n${bodyText}\n}`);
    }
  } else {
    const em = new FnEmitter(ctx, { module, async: false, returnType: T.void, cls: info, thisExpr: "this", isConstructor: true });
    initFields(em);
    const bodyText = em.body().join("\n");
    if (generic) body.push(`  void construct() {\n${indent(bodyText)}\n  }`);
    else {
      body.push("  void construct();");
      members.push(`void ${info.cppName}::construct() {\n${bodyText}\n}`);
    }
  }
  const createBody = `  auto self = std::make_shared<${qual}>();\n  self->construct(${ctorArgs.join(", ")});\n  return self;`;
  if (info.abstract) {
    // Abstract classes are only constructed through subclasses.
  } else if (generic) body.push(`  static lucent::Ref<${qual}> create(${ctorDecls.join(", ")}) {\n${indent(createBody)}\n  }`);
  else {
    body.push(`  static lucent::Ref<${info.cppName}> create(${ctorDecls.join(", ")});`);
    members.push(`lucent::Ref<${info.cppName}> ${info.cppName}::create(${ctorDecls.join(", ")}) {\n${createBody}\n}`);
  }

  for (const m of decl.members) {
    if (ts.isMethodDeclaration(m)) {
      if (!m.body) {
        if (ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.AbstractKeyword)) {
          const name = cppIdent(memberName(m));
          const d = dispatch(m, name);
          const fn = reg.lowerSignature(ctx.checker.getSignatureFromDeclaration(m)!, m) as LType & { k: "fn" };
          const em = new FnEmitter(ctx, { module, async: false, returnType: T.void });
          const ps = em.paramInfos(m, fn).map((p, i) => `${reg.cpp(p.cppType)} a${i}`).join(", ");
          body.push(`  virtual ${reg.cppRet(fn.ret)} ${name}(${ps})${d.suffix} = 0;`);
        }
        continue;
      }
      emitMethod(m, cppIdent(memberName(m)), isStatic(m));
    } else if (ts.isGetAccessorDeclaration(m)) {
      emitMethod(m, `get_${cppIdent(memberName(m))}`, isStatic(m));
    } else if (ts.isSetAccessorDeclaration(m)) {
      emitMethod(m, `set_${cppIdent(memberName(m))}`, isStatic(m));
    } else if (ts.isPropertyDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isSemicolonClassElement(m)) {
      continue;
    } else if (ts.isClassStaticBlockDeclaration(m)) {
      fail(m, Codes.UnsupportedClassFeature, "static blocks are not supported");
    } else if (ts.isIndexSignatureDeclaration(m)) {
      fail(m, Codes.UnsupportedClassFeature, "index signatures in classes are not supported");
    }
  }
  const overrides = ctx.guard(() => ifaceOverrides(ctx, info)) ?? [];
  void selfType;
  const definition = `${tmpl}struct ${info.cppName} : ${bases.join(", ")} {\n${[...body, ...overrides].join("\n")}\n};`;
  return { definition, members: generic ? "" : members.join("\n\n"), staticInits };
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => (l.startsWith("#line") ? l : `  ${l}`))
    .join("\n");
}

/** Parameters of the nearest ancestor constructor, in terms of the subclass's type arguments. */
function inheritedCtorParams(ctx: Ctx, ancestry: ClassChain): LType[] {
  for (const a of ancestry) {
    const ctor = a.info.decl.members.find(ts.isConstructorDeclaration);
    if (!ctor) continue;
    const fn = ctx.reg.lowerSignature(ctx.checker.getSignatureFromDeclaration(ctor)!, ctor) as LType & { k: "fn" };
    const module = ctx.modules.find((m) => m.sourceFile === ctor.getSourceFile())!;
    const em = new FnEmitter(ctx, { module, async: false, returnType: T.void });
    const map = argMap(ctx, a.t);
    return em.paramInfos(ctor, fn).map((p) => substitute(p.cppType, map));
  }
  return [];
}
