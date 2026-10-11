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
  typeKey,
} from "../types.ts";
import { argMap, findMember, jsonMemberParams } from "./classes.ts";
import { refsMethod } from "./refs.ts";
import type { Ctx, ParamInfo } from "./context.ts";
import { FnEmitter } from "./function.ts";

type FnT = LType & { k: "fn" };

export type IfaceMember =
  | { kind: "method"; name: string; node: ts.MethodSignature; fn: FnT; params: ParamInfo[] }
  | { kind: "prop"; name: string; node: ts.PropertySignature; type: LType; readonly: boolean };

function emitterFor(ctx: Ctx, node: ts.Node): FnEmitter {
  const sf = node.getSourceFile();
  const module = ctx.modules.find((m) => m.sourceFile === sf)!;
  return new FnEmitter(ctx, { module, async: false });
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
  const bases = ctx.reg.ifaceBases(self);
  // JSON.stringify of an interface value writes it as its class, or its
  // literal, does; the root interfaces declare the writer.
  if (!bases.length)
    members.push(cpp.method("lucentJson_", cpp.type("bool"), jsonMemberParams, undefined, pure));
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
    bases: bases.map((b) => ({ type: ctx.reg.cppIfaceType(b), public: true, virtual: true })),
  });
}

/**
 * Why an object literal cannot stand for interface `t`, or undefined when
 * one can: a method needs a class that declares `implements`; a generic
 * interface is not taken yet.
 */
export function literalRefusal(ctx: Ctx, t: IfaceT): string | undefined {
  const name = ctx.reg.iface(t.id).decl.name.text;
  const generic = ctx.reg.ifaceChain(t).find((x) => ctx.reg.iface(x.id).typeParams.length);
  if (generic)
    return `${name} is generic, which an object literal cannot stand for yet; use a class that declares \`implements ${name}\``;
  const method = membersOf(ctx, t).find((m) => m.kind === "method");
  if (method)
    return `${name}'s method \`${method.name}()\` needs a class: an object literal stands only for an interface of properties`;
  return undefined;
}

/**
 * The literal class of a data-only interface `t`, made on first use: an
 * object literal standing for it is an instance, which holds the
 * interface's properties in a struct of them (the shape).
 */
export function ifaceLiteral(
  ctx: Ctx,
  t: IfaceT,
): { cppName: string; shape: LType & { k: "struct" } } {
  const known = ctx.reg.ifaceLiterals.get(t.id);
  if (known) return known;
  const info = ctx.reg.iface(t.id);
  const made = { cppName: `L_${info.cppName.replace(/^I_/, "")}`, shape: ctx.reg.ifaceShape(info) };
  ctx.reg.ifaceLiterals.set(t.id, made);
  return made;
}

/**
 * `struct L_X final : lucent::Object, virtual I_X`: an object literal's
 * class, holding the shape struct `s`; each property's accessors read and
 * write it, and JSON writes it, as JavaScript writes the literal.
 */
export function emitIfaceLiteral(ctx: Ctx, id: string): cpp.Decl {
  const lit = ctx.reg.ifaceLiterals.get(id)!;
  const self: IfaceT = { k: "iface", id, args: [] };
  const shape = cpp.type(
    "lucent::Ref",
    cpp.type(`lucent_app::${ctx.reg.struct(lit.shape.id).cppName}`),
  );
  const s = cpp.id("s");
  const members: cpp.Member[] = [
    cpp.field(shape, "s"),
    {
      ...cpp.method(lit.cppName, undefined, [cpp.param(shape, "shape")], []),
      initializers: [{ name: "s", args: [cpp.call("std::move", [cpp.id("shape")])] }],
    },
    cpp.method(
      "lucentJson_",
      cpp.type("bool"),
      jsonMemberParams,
      [cpp.exprStmt(cpp.call("jsonWrite", [cpp.id("w"), s])), cpp.ret(cpp.bool(true))],
      { override: true },
    ),
  ];
  members.push(refsMethod());
  for (const m of membersOf(ctx, self)) {
    if (m.kind !== "prop") continue;
    const t = ctx.reg.cppType(m.type);
    const field = cpp.arrow(s, cppIdent(m.name));
    members.push(
      cpp.method(`get_${cppIdent(m.name)}`, t, [], [cpp.ret(field)], { override: true }),
    );
    if (!m.readonly)
      members.push(
        cpp.method(
          `set_${cppIdent(m.name)}`,
          cpp.voidType,
          [cpp.param(t, "v")],
          [cpp.exprStmt(cpp.assign(field, cpp.call("std::move", [cpp.id("v")])))],
          { override: true },
        ),
      );
  }
  return cpp.struct(lit.cppName, members, {
    final: true,
    bases: [
      { type: cpp.type("lucent::Object"), public: true },
      { type: ctx.reg.cppIfaceType(self), public: true, virtual: true },
    ],
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
