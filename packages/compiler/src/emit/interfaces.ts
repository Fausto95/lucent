import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import {
  type ClassChain,
  type ClassInfo,
  cppIdent,
  type IfaceInfo,
  type IfaceT,
  type LType,
  substitute,
  T,
  typeKey,
} from "../types.ts";
import { argMap, findMember } from "./classes.ts";
import type { Ctx, ParamInfo } from "./context.ts";
import { FnEmitter } from "./function.ts";

type FnT = LType & { k: "fn" };

export type IfaceMember =
  | { kind: "method"; name: string; node: ts.MethodSignature; fn: FnT; params: ParamInfo[] }
  | { kind: "prop"; name: string; node: ts.PropertySignature; type: LType; readonly: boolean };

function emitterFor(ctx: Ctx, node: ts.Node): FnEmitter {
  const sf = node.getSourceFile();
  const module = ctx.modules.find((m) => m.sourceFile === sf)!;
  return new FnEmitter(ctx, { module, async: false, returnType: T.void });
}

function isReadonly(n: ts.Node): boolean {
  return (
    ts.canHaveModifiers(n) &&
    !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
  );
}

function nameOf(n: ts.TypeElement): string {
  if (n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) return n.name.text;
  fail(n, Codes.UnsupportedType, "interface members implemented by classes need plain names");
}

/** The members an interface declares itself, in terms of its own type parameters. */
export function ownMembers(ctx: Ctx, info: IfaceInfo): IfaceMember[] {
  const em = emitterFor(ctx, info.decl);
  return info.decl.members.map((m): IfaceMember => {
    if (ts.isMethodSignature(m)) {
      if (m.questionToken)
        fail(
          m,
          Codes.InterfaceMismatch,
          `optional method ${nameOf(m)} cannot be implemented by classes yet`,
        );
      if (m.typeParameters?.length)
        fail(
          m,
          Codes.InterfaceMismatch,
          `generic method ${nameOf(m)} cannot be dispatched virtually`,
        );
      const fn = ctx.reg.lowerSignature(ctx.checker.getSignatureFromDeclaration(m)!, m) as FnT;
      return {
        kind: "method",
        name: nameOf(m),
        node: m,
        fn,
        params: em.paramInfos(m as never, fn),
      };
    }
    if (ts.isPropertySignature(m)) {
      return {
        kind: "prop",
        name: nameOf(m),
        node: m,
        type: ctx.lowerAt(m),
        readonly: isReadonly(m),
      };
    }
    fail(
      m,
      Codes.UnsupportedType,
      "interfaces implemented by classes can only declare methods and properties",
    );
  });
}

function instantiate(m: IfaceMember, map: Map<string, LType>): IfaceMember {
  if (!map.size) return m;
  if (m.kind === "prop") return { ...m, type: substitute(m.type, map) };
  return {
    ...m,
    fn: substitute(m.fn, map) as FnT,
    params: m.params.map((p) => ({
      ...p,
      type: substitute(p.type, map),
      cppType: substitute(p.cppType, map),
    })),
  };
}

function ifaceMap(ctx: Ctx, t: IfaceT): Map<string, LType> {
  const info = ctx.reg.iface(t.id);
  return new Map(
    info.typeParams.map(
      (p, i) => [p, t.args[i] ?? ({ k: "tparam", name: p } as LType)] as [string, LType],
    ),
  );
}

/** Every member of an interface instantiation, including inherited ones. */
export function membersOf(ctx: Ctx, t: IfaceT): IfaceMember[] {
  const out = new Map<string, IfaceMember>();
  for (const x of ctx.reg.ifaceChain(t)) {
    const map = ifaceMap(ctx, x);
    for (const m of ownMembers(ctx, ctx.reg.iface(x.id)))
      if (!out.has(m.name)) out.set(m.name, instantiate(m, map));
  }
  return [...out.values()];
}

/** The C++ signature a method is called through: return type and parameter types. */
function signature(ctx: Ctx, fn: FnT, params: ParamInfo[]): string {
  return `${ctx.reg.cppRet(fn.ret)}(${params.map((p) => ctx.reg.cpp(p.cppType)).join(", ")})`;
}

/** `template <…> struct I_X : virtual I_Base… { virtual … = 0; };` */
export function emitIface(ctx: Ctx, info: IfaceInfo): cpp.Decl {
  const self: IfaceT = {
    k: "iface",
    id: info.id,
    args: info.typeParams.map((p) => ({ k: "tparam", name: p }) as LType),
  };
  const members: cpp.Member[] = [
    cpp.method(`~${info.cppName}`, undefined, [], undefined, { virtual: true, default: true }),
  ];
  const pure = { virtual: true, pure: true };
  for (const m of ownMembers(ctx, info)) {
    if (m.kind === "method") {
      const ps = m.params.map((p, i) => cpp.param(ctx.reg.cppType(p.cppType), `a${i}`));
      members.push(cpp.method(cppIdent(m.name), ctx.reg.cppRetType(m.fn.ret), ps, undefined, pure));
    } else {
      const t = ctx.reg.cppType(m.type);
      members.push(cpp.method(`get_${cppIdent(m.name)}`, t, [], undefined, pure));
      if (!m.readonly)
        members.push(
          cpp.method(`set_${cppIdent(m.name)}`, cpp.voidType, [cpp.param(t, "v")], undefined, pure),
        );
    }
  }
  return cpp.struct(info.cppName, members, {
    ...(info.typeParams.length ? { template: info.typeParams.map(cppIdent) } : {}),
    bases: ctx.reg
      .ifaceBases(self)
      .map((b) => ({ type: ctx.reg.cppIfaceType(b), public: true, virtual: true })),
  });
}

/** Interfaces a class declares, minus those an ancestor already implements identically. */
export function ifacesOf(ctx: Ctx, cls: ClassInfo): IfaceT[] {
  const inherited = new Set(
    ctx.reg.ancestors(cls).flatMap((a) => ctx.reg.declaredIfaces(a).map(typeKey)),
  );
  return ctx.reg.declaredIfaces(cls).filter((i) => !inherited.has(typeKey(i)));
}

/** Every interface member a class must provide, across all it implements. */
function requiredMembers(ctx: Ctx, cls: ClassInfo): IfaceMember[] {
  const out = new Map<string, IfaceMember>();
  for (const i of ifacesOf(ctx, cls))
    for (const m of membersOf(ctx, i)) if (!out.has(m.name)) out.set(m.name, m);
  return [...out.values()];
}

/** C++ member names a class overrides from its interfaces (`area`, `get_kind`, `set_kind`). */
export function virtualMembers(ctx: Ctx, cls: ClassInfo): Set<string> {
  const names = new Set<string>();
  for (const m of requiredMembers(ctx, cls)) {
    const n = cppIdent(m.name);
    if (m.kind === "method") names.add(n);
    else names.add(`get_${n}`).add(`set_${n}`);
  }
  return names;
}

/**
 * Checks that `cls` implements every member of its interfaces with the same
 * native signature, and returns the overrides it needs: property accessors
 * for fields, and forwarders for members inherited from a base class.
 */
export function ifaceOverrides(ctx: Ctx, cls: ClassInfo): cpp.Member[] {
  const out = new Map<string, cpp.Member>();
  const add = (m: cpp.Member & { k: "method" }) => out.set(m.name, m);
  const override = { override: true };
  const inherited = (owner: ClassChain[number], name: string) =>
    cpp.baseMember(cpp.self, ctx.reg.cppClassType(owner.t), name);
  const className = cls.decl.name!.text;
  const chain = ctx.reg.chain({
    k: "class",
    id: cls.id,
    args: cls.typeParams.map((p) => ({ k: "tparam", name: p }) as LType),
  });
  const em = emitterFor(ctx, cls.decl);
  for (const m of requiredMembers(ctx, cls)) {
    const where = `${className}.${m.name}`;
    if (m.kind === "method") {
      const found = findMember(chain, m.name, (x) => ts.isMethodDeclaration(x));
      if (!found)
        fail(cls.decl, Codes.InterfaceMismatch, `${where} must be a method to implement ${m.name}`);
      const decl = found.decl as ts.MethodDeclaration;
      const fn = ctx.reg.lowerSignature(
        ctx.checker.getSignatureFromDeclaration(decl)!,
        decl,
      ) as FnT;
      const map = argMap(ctx, found.owner.t);
      const actual = `${ctx.reg.cppRet(substitute(fn.ret, map))}(${em
        .paramInfos(decl, fn)
        .map((p) => ctx.reg.cpp(substitute(p.cppType, map)))
        .join(", ")})`;
      const expected = signature(ctx, m.fn, m.params);
      if (actual !== expected) {
        fail(
          decl,
          Codes.InterfaceMismatch,
          `${where} has native signature ${actual}, but the interface needs ${expected}; declare the same parameter and return types`,
        );
      }
      // A method inherited from a class base does not override the
      // interface's virtual; forward to it.
      if (found.owner.info !== cls) {
        const ps = m.params.map((p, i) => cpp.param(ctx.reg.cppType(p.cppType), `a${i}`));
        const call = cpp.call(
          inherited(found.owner, cppIdent(m.name)),
          ps.map((p) => cpp.id(p.name!)),
        );
        add(
          cpp.method(cppIdent(m.name), ctx.reg.cppRetType(m.fn.ret), ps, [cpp.ret(call)], override),
        );
      }
      continue;
    }
    const f = cppIdent(m.name);
    const t = ctx.reg.cpp(m.type);
    const type = ctx.reg.cppType(m.type);
    const v = cpp.id("v");
    const getterOf = (value: cpp.Expr) =>
      add(cpp.method(`get_${f}`, type, [], [cpp.ret(value)], override));
    const setterOf = (set: cpp.Expr) =>
      add(
        cpp.method(`set_${f}`, cpp.voidType, [cpp.param(type, "v")], [cpp.exprStmt(set)], override),
      );
    const typed = (node: ts.Node, owner: (typeof chain)[number]) => {
      const actual = ctx.reg.cpp(substitute(ctx.lowerAt(node), argMap(ctx, owner.t)));
      if (actual !== t)
        fail(
          node,
          Codes.InterfaceMismatch,
          `${where} has type ${actual}, but the interface needs ${t}`,
        );
    };
    const getter = findMember(chain, m.name, (x) => ts.isGetAccessorDeclaration(x));
    if (getter) {
      typed(getter.decl, getter.owner);
      const setter = findMember(chain, m.name, (x) => ts.isSetAccessorDeclaration(x));
      if (!m.readonly && !setter)
        fail(
          getter.decl,
          Codes.InterfaceMismatch,
          `${where} needs a setter: the interface's ${m.name} is writable`,
        );
      if (getter.owner.info !== cls) getterOf(cpp.call(inherited(getter.owner, `get_${f}`)));
      if (!m.readonly && setter && setter.owner.info !== cls)
        setterOf(cpp.call(inherited(setter.owner, `set_${f}`), [cpp.call("std::move", [v])]));
      continue;
    }
    const field = findMember(
      chain,
      m.name,
      (x) => ts.isPropertyDeclaration(x) || ts.isParameter(x),
    );
    if (!field)
      fail(cls.decl, Codes.InterfaceMismatch, `${className} does not implement ${m.name}`);
    typed(field.decl, field.owner);
    if (!m.readonly && isReadonly(field.decl))
      fail(
        field.decl,
        Codes.InterfaceMismatch,
        `${where} is readonly, but the interface's ${m.name} is writable`,
      );
    getterOf(cpp.arrow(cpp.self, f));
    if (!m.readonly) setterOf(cpp.assign(cpp.arrow(cpp.self, f), cpp.call("std::move", [v])));
  }
  return [...out.values()];
}
