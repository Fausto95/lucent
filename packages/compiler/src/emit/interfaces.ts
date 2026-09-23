import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { type ClassInfo, cppIdent, type IfaceInfo, type LType, substitute, T } from "../types.ts";
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
  return ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
}

function nameOf(n: ts.TypeElement): string {
  if (n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) return n.name.text;
  fail(n, Codes.UnsupportedType, "interface members implemented by classes need plain names");
}

export function ifaceMembers(ctx: Ctx, info: IfaceInfo): IfaceMember[] {
  const em = emitterFor(ctx, info.decl);
  return info.decl.members.map((m): IfaceMember => {
    if (ts.isMethodSignature(m)) {
      if (m.questionToken) fail(m, Codes.InterfaceMismatch, `optional method ${nameOf(m)} cannot be implemented by classes yet`);
      if (m.typeParameters?.length) fail(m, Codes.InterfaceMismatch, `generic method ${nameOf(m)} cannot be dispatched virtually`);
      const fn = ctx.reg.lowerSignature(ctx.checker.getSignatureFromDeclaration(m)!, m) as FnT;
      return { kind: "method", name: nameOf(m), node: m, fn, params: em.paramInfos(m as never, fn) };
    }
    if (ts.isPropertySignature(m)) {
      return { kind: "prop", name: nameOf(m), node: m, type: ctx.lowerAt(m), readonly: isReadonly(m) };
    }
    fail(m, Codes.UnsupportedType, "interfaces implemented by classes can only declare methods and properties");
  });
}

/** The C++ signature a method is called through: return type and parameter types. */
function signature(ctx: Ctx, fn: FnT, params: ParamInfo[]): string {
  return `${ctx.reg.cppRet(fn.ret)}(${params.map((p) => ctx.reg.cpp(p.cppType)).join(", ")})`;
}

export function ifaceMethodSignature(ctx: Ctx, m: IfaceMember & { kind: "method" }): string {
  return signature(ctx, m.fn, m.params);
}

/** `struct I_X { virtual ... = 0; };` */
export function emitIface(ctx: Ctx, info: IfaceInfo): string {
  const lines = [`struct ${info.cppName} {`, `  virtual ~${info.cppName}() = default;`];
  for (const m of ifaceMembers(ctx, info)) {
    if (m.kind === "method") {
      const ps = m.params.map((p, i) => `${ctx.reg.cpp(p.cppType)} a${i}`).join(", ");
      lines.push(`  virtual ${ctx.reg.cppRet(m.fn.ret)} ${cppIdent(m.name)}(${ps}) = 0;`);
    } else {
      const t = ctx.reg.cpp(m.type);
      lines.push(`  virtual ${t} get_${cppIdent(m.name)}() = 0;`);
      if (!m.readonly) lines.push(`  virtual void set_${cppIdent(m.name)}(${t} v) = 0;`);
    }
  }
  lines.push("};");
  return lines.join("\n");
}

/** C++ member names a class overrides from its interfaces (`area`, `get_kind`, `set_kind`). */
export function virtualMembers(ctx: Ctx, cls: ClassInfo): Set<string> {
  const names = new Set<string>();
  for (const iface of ifacesOf(ctx, cls)) {
    for (const m of ifaceMembers(ctx, iface)) {
      const n = cppIdent(m.name);
      if (m.kind === "method") names.add(n);
      else names.add(`get_${n}`).add(`set_${n}`);
    }
  }
  return names;
}

export function ifacesOf(ctx: Ctx, cls: ClassInfo): IfaceInfo[] {
  return [...ctx.reg.ifaces.values()].filter((i) => i.implementers.has(cls.id));
}

/**
 * Checks that `cls` implements every member of its interfaces with the same
 * native signature, and returns the overrides it needs: property accessors
 * for fields (methods and accessors override by name).
 */
export function ifaceOverrides(ctx: Ctx, cls: ClassInfo): string[] {
  const out: string[] = [];
  const className = cls.decl.name!.text;
  const chain = ctx.reg.chain({ k: "class", id: cls.id, args: cls.typeParams.map((p) => ({ k: "tparam", name: p }) as LType) });
  const em = emitterFor(ctx, cls.decl);
  for (const iface of ifacesOf(ctx, cls)) {
    const ifaceName = iface.decl.name.text;
    for (const m of ifaceMembers(ctx, iface)) {
      const where = `${className}.${m.name}`;
      if (m.kind === "method") {
        const found = findMember(chain, m.name, (x) => ts.isMethodDeclaration(x));
        if (!found) fail(cls.decl, Codes.InterfaceMismatch, `${where} must be a method to implement ${ifaceName}.${m.name}`);
        const decl = found.decl as ts.MethodDeclaration;
        const fn = ctx.reg.lowerSignature(ctx.checker.getSignatureFromDeclaration(decl)!, decl) as FnT;
        const map = argMap(ctx, found.owner.t);
        const actual = `${ctx.reg.cppRet(substitute(fn.ret, map))}(${em.paramInfos(decl, fn).map((p) => ctx.reg.cpp(substitute(p.cppType, map))).join(", ")})`;
        const expected = ifaceMethodSignature(ctx, m);
        if (actual !== expected) {
          fail(decl, Codes.InterfaceMismatch, `${where} has native signature ${actual}, but ${ifaceName}.${m.name} needs ${expected}; declare the same parameter and return types`);
        }
        // A method inherited from a class base does not override the
        // interface's virtual; forward to it.
        if (found.owner.info !== cls) {
          const ps = m.params.map((p, i) => `${ctx.reg.cpp(p.cppType)} a${i}`).join(", ");
          const as = m.params.map((_, i) => `a${i}`).join(", ");
          out.push(`  ${ctx.reg.cppRet(m.fn.ret)} ${cppIdent(m.name)}(${ps}) override { return this->${ctx.reg.cppClass(found.owner.t)}::${cppIdent(m.name)}(${as}); }`);
        }
        continue;
      }
      const t = ctx.reg.cpp(m.type);
      const typed = (node: ts.Node, owner: (typeof chain)[number]) => {
        const actual = ctx.reg.cpp(substitute(ctx.lowerAt(node), argMap(ctx, owner.t)));
        if (actual !== t) fail(node, Codes.InterfaceMismatch, `${where} has type ${actual}, but ${ifaceName}.${m.name} needs ${t}`);
      };
      const getter = findMember(chain, m.name, (x) => ts.isGetAccessorDeclaration(x));
      if (getter) {
        typed(getter.decl, getter.owner);
        const setter = findMember(chain, m.name, (x) => ts.isSetAccessorDeclaration(x));
        if (!m.readonly && !setter) fail(getter.decl, Codes.InterfaceMismatch, `${where} needs a setter: ${ifaceName}.${m.name} is writable`);
        const f = cppIdent(m.name);
        if (getter.owner.info !== cls) out.push(`  ${t} get_${f}() override { return this->${ctx.reg.cppClass(getter.owner.t)}::get_${f}(); }`);
        if (!m.readonly && setter && setter.owner.info !== cls) out.push(`  void set_${f}(${t} v) override { this->${ctx.reg.cppClass(setter.owner.t)}::set_${f}(std::move(v)); }`);
        continue;
      }
      const field = findMember(chain, m.name, (x) => ts.isPropertyDeclaration(x) || ts.isParameter(x));
      if (!field) fail(cls.decl, Codes.InterfaceMismatch, `${className} does not implement ${ifaceName}.${m.name}`);
      typed(field.decl, field.owner);
      if (!m.readonly && isReadonly(field.decl)) fail(field.decl, Codes.InterfaceMismatch, `${where} is readonly, but ${ifaceName}.${m.name} is writable`);
      const f = cppIdent(m.name);
      out.push(`  ${t} get_${f}() override { return this->${f}; }`);
      if (!m.readonly) out.push(`  void set_${f}(${t} v) override { this->${f} = std::move(v); }`);
    }
  }
  return [...new Set(out)];
}
