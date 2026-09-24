import ts from "typescript";
import { Codes, CompileError, fail } from "../diagnostics.ts";
import type { LucentModule } from "../program.ts";
import { type ClassInfo, cppIdent, isVoidish, type LType, stripOpt, substitute, T, typeKey } from "../types.ts";
import { memberName, parameterProperties } from "./classes.ts";
import type { Ctx, Global, ParamInfo } from "./context.ts";
import { FnEmitter } from "./function.ts";
import { cppQuoted } from "./literals.ts";

/** Everything JavaScript can see of one module. */
export interface ModuleExports {
  module: LucentModule;
  functions: Extract<Global, { kind: "function" }>[];
  classes: ClassInfo[];
  consts: Extract<Global, { kind: "var" }>[];
  enums: { name: string; members: { name: string; value: string | number }[] }[];
}

const q = cppQuoted;

/** Generates lucent_bindings.cpp: conversions, prototypes and module installers. */
export class BindingsEmitter {
  private readonly structs = new Set<string>();
  private readonly classes = new Set<string>();
  private readonly ifaces = new Map<string, LType & { k: "iface" }>();
  private readonly unions = new Map<string, LType & { k: "union" }>();
  private readonly unionSites = new Map<string, ts.Node>();
  private readonly flows = new Set<string>();

  private readonly ctx: Ctx;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  private get reg() {
    return this.ctx.reg;
  }

  /** Records every type that crosses the boundary so it gets a Convert. */
  use(t: LType, node: ts.Node): void {
    switch (t.k) {
      case "struct": {
        if (this.structs.has(t.id)) return;
        this.structs.add(t.id);
        for (const f of this.reg.struct(t.id).fields) this.use(f.type, node);
        return;
      }
      case "class": {
        const info = this.reg.cls(t.id);
        if (t.args.length || info.typeParams.length) fail(node, Codes.GenericBoundary, `generic class ${info.decl.name?.text} cannot cross the JavaScript boundary`);
        if (this.classes.has(t.id)) return;
        this.classes.add(t.id);
        for (const m of publicMembers(this.ctx, info)) for (const ty of m.types) this.use(ty, m.node);
        // A base-typed value may hold any subclass, and a subclass's prototype
        // extends its base's.
        if (info.base) this.use({ k: "class", id: info.base.id, args: [] }, node);
        for (const d of this.reg.descendants(t.id)) if (!d.typeParams.length) this.use({ k: "class", id: d.id, args: [] }, node);
        return;
      }
      case "iface": {
        if (t.args.some((a) => typeKey(a).includes("T:"))) fail(node, Codes.GenericBoundary, "generic interface values cannot cross the JavaScript boundary");
        if (this.ifaces.has(typeKey(t))) return;
        this.ifaces.set(typeKey(t), t);
        for (const c of this.reg.implementations(t)) this.use({ k: "class", id: c.id, args: [] }, node);
        return;
      }
      case "union":
        if (!this.unions.has(typeKey(t))) {
          this.unions.set(typeKey(t), t);
          this.unionSites.set(typeKey(t), node);
          for (const m of t.ms) this.use(m, node);
        }
        return;
      case "array":
      case "set":
        return this.use(t.e, node);
      case "dict":
        return this.use(t.val, node);
      case "map":
        this.use(t.key, node);
        return this.use(t.val, node);
      case "opt":
        return this.use(t.inner, node);
      case "promise":
        return this.use(t.inner, node);
      case "tuple":
        return t.es.forEach((e) => this.use(e, node));
      case "fn":
        t.params.forEach((p) => this.use(p, node));
        return this.use(t.ret, node);
      case "tparam":
        fail(node, Codes.GenericBoundary, "generic values cannot cross the JavaScript boundary");
      case "iter":
        return this.use(t.e, node);
      case "iterResult":
        fail(node, Codes.BoundaryType, "iterator results cannot cross the JavaScript boundary");
      case "regexMatch":
        fail(node, Codes.BoundaryType, "match results cannot cross the JavaScript boundary; return the strings you need");
    }
  }

  /**
   * Checks the direction values of type `t` travel: `out` is toward
   * JavaScript. Callback parameters travel the opposite way to the callback.
   * AbortSignals only travel into Lucent; controllers never cross.
   */
  private flow(t: LType, out: boolean, node: ts.Node): void {
    const key = `${typeKey(t)}|${out}`;
    if (this.flows.has(key)) return;
    this.flows.add(key);
    switch (t.k) {
      case "native":
        fail(node, Codes.BoundaryType, `${t.name} is a ${t.platform === "ios" ? "iOS" : "Android"} object; platform objects cannot cross the JavaScript boundary, so return the values you need`);
      case "abortSignal":
        if (out) fail(node, Codes.BoundaryType, "an AbortSignal can only be passed from JavaScript to Lucent, not returned or passed to a JavaScript callback");
        return;
      case "abortController":
        fail(node, Codes.BoundaryType, "an AbortController cannot cross the JavaScript boundary; pass its signal instead");
      case "iter":
        // JavaScript iterables come in as a snapshot; iterators do not go out.
        if (out) fail(node, Codes.BoundaryType, "iterators and generators cannot be returned to JavaScript; collect them into an array");
        return this.flow(t.e, out, node);
      case "struct":
        return this.reg.struct(t.id).fields.forEach((f) => this.flow(f.type, out, node));
      case "class":
        return this.classFlow(t.id);
      case "iface":
        return this.reg.implementations(t).forEach((c) => this.classFlow(c.id));
      case "union":
        return t.ms.forEach((m) => this.flow(m, out, node));
      case "tuple":
        return t.es.forEach((e) => this.flow(e, out, node));
      case "array":
      case "set":
        return this.flow(t.e, out, node);
      case "dict":
        return this.flow(t.val, out, node);
      case "map":
        this.flow(t.key, out, node);
        return this.flow(t.val, out, node);
      case "opt":
        return this.flow(t.inner, out, node);
      case "promise":
        return this.flow(t.inner, out, node);
      case "fn":
        t.params.forEach((p) => this.flow(p, !out, node));
        return this.flow(t.ret, out, node);
    }
  }

  /** JavaScript reads a class instance's public members and calls its methods. */
  private classFlow(id: string): void {
    const key = `C:${id}`;
    if (this.flows.has(key)) return;
    this.flows.add(key);
    for (const m of publicMembers(this.ctx, this.reg.cls(id))) {
      if (m.kind === "method") {
        m.params!.forEach((p) => this.flow(p.cppType, false, m.node));
        this.flow(m.ret!, true, m.node);
      } else {
        this.flow(m.types[0]!, true, m.node);
        if (m.writable) this.flow(m.types[0]!, false, m.node);
      }
    }
  }

  generate(mods: ModuleExports[], initOrder: LucentModule[]): string {
    for (const m of mods) {
      for (const f of m.functions) {
        if (f.generic) {
          this.ctx.diagnostics.push({ code: Codes.GenericBoundary, message: `exported function ${f.decl.name?.text} is generic; generic functions cannot be called from JavaScript`, file: m.module.file });
          continue;
        }
        this.ctx.guard(() => {
          f.params.forEach((p) => this.use(p.cppType, f.decl));
          this.use(f.type.ret, f.decl);
          f.params.forEach((p) => this.flow(p.cppType, false, f.decl));
          this.flow(f.type.ret, true, f.decl);
        });
      }
      for (const c of m.classes) {
        this.ctx.guard(() => {
          this.use({ k: "class", id: c.id, args: [] }, c.decl);
          this.classFlow(c.id);
        });
      }
      for (const c of m.consts) {
        this.ctx.guard(() => {
          this.use(c.type, c.decl);
          this.flow(c.type, true, c.decl);
        });
      }
    }
    const out: string[] = [];
    out.push(`// Generated by Lucent. Do not edit.`);
    out.push(`#include "lucent_app.h"`);
    out.push(`#include <lucent/jsi/convert.h>`);
    out.push(`#include <lucent/jsi/host.h>`);
    out.push("");
    out.push("namespace lucent::js {");
    out.push("");
    // Declarations first: conversions can refer to each other recursively.
    for (const id of this.classes) out.push(`void proto_${this.reg.cls(id).cppName}(jsi::Runtime& rt, Host& host, jsi::Object& proto);`);
    const specs: string[] = [];
    // Structs also convert from an object the caller owns (array elements): no handle clone.
    for (const id of this.structs) {
      const s = this.reg.cpp({ k: "struct", id });
      out.push(`template <>\nstruct Convert<${s}> {\n  static ${s} fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);\n  static ${s} fromObject(jsi::Runtime& rt, const jsi::Object& o, const Path& p);\n  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const ${s}& v);\n};`);
    }
    for (const id of this.classes) specs.push(this.reg.cpp({ k: "class", id, args: [] }));
    for (const t of this.ifaces.values()) specs.push(this.reg.cpp(t));
    for (const u of this.unions.values()) specs.push(this.reg.cpp(u));
    for (const s of specs) {
      out.push(`template <>\nstruct Convert<${s}> {\n  static ${s} fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p);\n  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const ${s}& v);\n};`);
    }
    out.push("");
    for (const id of this.structs) out.push(this.structConvert(id));
    for (const id of this.classes) out.push(this.classConvert(id));
    for (const t of this.ifaces.values()) out.push(this.ifaceConvert(t));
    for (const [key, u] of this.unions) {
      const code = this.ctx.guard(() => {
        try {
          return this.unionConvert(u);
        } catch (e) {
          // Report at the declaration that sent the union across the boundary.
          if (e instanceof CompileError && !e.node) throw new CompileError(this.unionSites.get(key), e.code, e.message);
          throw e;
        }
      });
      if (code) out.push(code);
    }
    out.push("}  // namespace lucent::js");
    out.push("");
    out.push("namespace {");
    out.push("using namespace lucent::js;");
    for (const m of mods) out.push(this.installer(m));
    out.push(`const ModuleDef kModules[] = {`);
    for (const m of mods) out.push(`    {${q(m.module.name)}, install_${m.module.ns}},`);
    if (mods.length === 0) out.push(`    {"", nullptr},`);
    out.push("};");
    out.push("}  // namespace");
    out.push("");
    out.push("namespace lucent::js {");
    out.push(`const ModuleDef* registeredModules(size_t& count) {\n  count = ${mods.length};\n  return kModules;\n}`);
    out.push(`void resetModuleState() {\n${initOrder.map((m) => `  lucent_app::${m.ns}::init();`).join("\n")}\n}`);
    out.push("}  // namespace lucent::js");
    return out.join("\n") + "\n";
  }

  private structConvert(id: string): string {
    const info = this.reg.struct(id);
    const s = this.reg.cpp({ k: "struct", id });
    // Field names are interned once per runtime (Host::prop): a struct array
    // reads and writes them for every element.
    const names = info.fields.map((f, i) => `  static const PropName n${i}{${q(f.name)}};`);
    const from: string[] = [];
    const to: string[] = [];
    info.fields.forEach((f, i) => {
      const ft = this.reg.cpp(f.type);
      const field = cppIdent(f.name);
      from.push(`  out->${field} = Convert<${ft}>::fromJs(rt, o.getProperty(rt, h.prop(rt, n${i})), p.field(${q(f.name)}));`);
      if (f.type.k === "opt") to.push(`  if (!v->${field}.isUndefined()) o.setProperty(rt, h.prop(rt, n${i}), Convert<${ft}>::toJs(rt, h, v->${field}));`);
      else to.push(`  o.setProperty(rt, h.prop(rt, n${i}), Convert<${ft}>::toJs(rt, h, v->${field}));`);
    });
    return [
      `inline ${s} Convert<${s}>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {`,
      `  if (!v.isObject()) throwBoundaryError(rt, p, "an object", v);`,
      `  return fromObject(rt, v.getObject(rt), p);`,
      `}`,
      `inline ${s} Convert<${s}>::fromObject(jsi::Runtime& rt, const jsi::Object& o, const Path& p) {`,
      `  if (o.isArray(rt) || o.isFunction(rt)) throwBoundaryError(rt, p, "an object", jsi::Value(rt, o));`,
      ...(info.fields.length ? [`  Host& h = Host::get(rt);`, ...names] : []),
      `  auto out = std::make_shared<lucent_app::${info.cppName}>();`,
      ...from,
      `  return out;`,
      `}`,
      `inline jsi::Value Convert<${s}>::toJs(jsi::Runtime& rt, Host& h, const ${s}& v) {`,
      `  if (!v) return jsi::Value::null();`,
      ...names,
      `  jsi::Object o(rt);`,
      ...to,
      `  return jsi::Value(std::move(o));`,
      `}`,
      "",
    ].join("\n");
  }

  private classConvert(id: string): string {
    const info = this.reg.cls(id);
    const s = this.reg.cpp({ k: "class", id, args: [] });
    const name = info.decl.name!.text;
    const proto = this.prototype(info);
    return [
      `inline ${s} Convert<${s}>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {`,
      `  auto c = std::dynamic_pointer_cast<lucent_app::${info.cppName}>(instanceOf(rt, v));`,
      `  if (!c) throwBoundaryError(rt, p, ${q(`a ${name}`)}, v);`,
      `  return c;`,
      `}`,
      `inline jsi::Value Convert<${s}>::toJs(jsi::Runtime& rt, Host& h, const ${s}& v) {`,
      // The JS object of the most derived class, deepest subclasses first.
      ...this.reg
        .descendants(id)
        .filter((d) => !d.typeParams.length)
        .map((d) => `  if (auto d = std::dynamic_pointer_cast<lucent_app::${d.cppName}>(v)) return Convert<${this.reg.cpp({ k: "class", id: d.id, args: [] })}>::toJs(rt, h, d);`),
      `  return h.wrap(rt, v, ${q(info.id)}, proto_${info.cppName});`,
      `}`,
      proto,
      "",
    ].join("\n");
  }

  /** Interface values cross as their concrete class: every implementer is known. */
  private ifaceConvert(t: LType & { k: "iface" }): string {
    const info = this.reg.iface(t.id);
    const s = this.reg.cpp(t);
    const impls = this.reg.implementations(t);
    const expected = `a ${info.decl.name.text} (${impls.map((c) => c.decl.name!.text).join(", ") || "no implementations"})`;
    return [
      `inline ${s} Convert<${s}>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {`,
      `  auto c = std::dynamic_pointer_cast<${this.reg.cppIface(t)}>(instanceOf(rt, v));`,
      `  if (!c) throwBoundaryError(rt, p, ${q(expected)}, v);`,
      `  return c;`,
      `}`,
      `inline jsi::Value Convert<${s}>::toJs(jsi::Runtime& rt, Host& h, const ${s}& v) {`,
      `  if (!v) return jsi::Value::null();`,
      ...impls.map((c) => {
        const ct = this.reg.cpp({ k: "class", id: c.id, args: [] });
        return `  if (auto c = std::dynamic_pointer_cast<lucent_app::${c.cppName}>(v)) return Convert<${ct}>::toJs(rt, h, c);`;
      }),
      `  throw std::logic_error(${q(`unknown ${info.decl.name.text} implementation`)});`,
      `}`,
      "",
    ].join("\n");
  }

  private prototype(info: ClassInfo): string {
    const name = info.decl.name!.text;
    const selfT = this.reg.cpp({ k: "class", id: info.id, args: [] });
    const lines: string[] = [`void proto_${info.cppName}(jsi::Runtime& rt, Host& host, jsi::Object& proto) {`];
    for (const m of publicMembers(this.ctx, info)) {
      if (m.kind === "method") {
        const d = m.node as ts.MethodDeclaration;
        const fname = `${name}.${memberName(d)}`;
        const body = this.callBody(fname, m.params!, m.ret!, m.async!, `self->${cppIdent(memberName(d))}`, `auto self = Convert<${selfT}>::fromJs(rt, thisVal, Path{${q(fname)}, "this"});`, ["self"]);
        lines.push(`  defineFunction(rt, proto, ${q(memberName(d))}, ${m.params!.length}, [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value& thisVal, const jsi::Value* args, size_t count) -> jsi::Value {\n${body}\n  });`);
      } else {
        const fname = `${name}.${m.name}`;
        const t = this.reg.cpp(m.types[0]!);
        const getExpr = m.kind === "accessor" ? `self->get_${cppIdent(m.name)}()` : `self->${cppIdent(m.name)}`;
        const getter = `[installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value& thisVal, const jsi::Value*, size_t) -> jsi::Value {\n    Host& host = Host::from(rt, installed);\n    return callSync(rt, host, [&]() -> jsi::Value {\n      auto self = Convert<${selfT}>::fromJs(rt, thisVal, Path{${q(fname)}, "this"});\n      return Convert<${t}>::toJs(rt, host, ${getExpr});\n    });\n  }`;
        let setter = "nullptr";
        if (m.writable) {
          const assign = m.kind === "accessor" ? `self->set_${cppIdent(m.name)}(value)` : `self->${cppIdent(m.name)} = value`;
          setter = `[installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value& thisVal, const jsi::Value* args, size_t count) -> jsi::Value {\n    Host& host = Host::from(rt, installed);\n    return callSync(rt, host, [&]() -> jsi::Value {\n      auto self = Convert<${selfT}>::fromJs(rt, thisVal, Path{${q(fname)}, "this"});\n      auto value = Convert<${t}>::fromJs(rt, arg(args, count, 0), Path{${q(fname)}, "value"});\n      ${assign};\n      return jsi::Value::undefined();\n    });\n  }`;
        }
        lines.push(`  defineAccessor(rt, proto, ${q(m.name)}, ${getter}, ${setter});`);
      }
    }
    if (info.base) {
      const base = this.reg.cls(info.base.id);
      lines.push(`  jsi::Object& baseProto = host.prototype(rt, ${q(base.id)}, proto_${base.cppName});`);
      lines.push(`  rt.global().getPropertyAsObject(rt, "Object").getPropertyAsFunction(rt, "setPrototypeOf").call(rt, proto, baseProto);`);
    }
    lines.push("}");
    return lines.join("\n");
  }

  /** The body of a host function that converts arguments, calls, and converts back. */
  private callBody(fname: string, params: ParamInfo[], ret: LType, isAsync: boolean, target: string, prelude = "", captures: string[] = []): string {
    const conv: string[] = [];
    const names: string[] = [];
    params.forEach((p, i) => {
      const t = this.reg.cpp(p.cppType);
      const n = `a${i}`;
      names.push(n);
      if (p.rest) {
        const elem = (p.cppType as LType & { k: "array" }).e;
        conv.push(`${t} ${n}; for (size_t i = ${i}; i < count; i++) ${n}.push(Convert<${this.reg.cpp(elem)}>::fromJs(rt, args[i], Path{${q(fname)}, "argument " + std::to_string(i + 1)}));`);
      } else {
        conv.push(`auto ${n} = Convert<${t}>::fromJs(rt, arg(args, count, ${i}), Path{${q(fname)}, ${q(`argument '${p.name}'`)}});`);
      }
    });
    // Each converted argument is used once: synchronous calls move them in;
    // async ones copy them into the job's lambda.
    const call = `${target}(${names.join(", ")})`;
    const moved = `${target}(${names.map((n) => `std::move(${n})`).join(", ")})`;
    let result: string;
    if (isAsync) {
      const inner = this.reg.cppRet(ret);
      result = `return callAsync<${inner}>(rt, host, [${[...captures, ...names].join(", ")}]() { return ${call}; });`;
    } else if (isVoidish(ret)) {
      result = `${moved};\n      return jsi::Value::undefined();`;
    } else {
      result = `return Convert<${this.reg.cpp(ret)}>::toJs(rt, host, ${moved});`;
    }
    return [
      `    Host& host = Host::from(rt, installed);`,
      `    return callSync(rt, host, [&]() -> jsi::Value {`,
      prelude ? `      ${prelude}` : "",
      ...conv.map((c) => `      ${c}`),
      `      ${result}`,
      `    });`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private installer(m: ModuleExports): string {
    const ns = `lucent_app::${m.module.ns}`;
    const lines: string[] = [`void install_${m.module.ns}(jsi::Runtime& rt, Host& host, jsi::Object& exports) {`];
    for (const f of m.functions) {
      if (f.generic) continue;
      const name = f.decl.name!.text;
      const ret = f.async ? (f.type.ret.k === "promise" ? f.type.ret.inner : f.type.ret) : f.type.ret;
      const body = this.callBody(name, f.params, ret, f.async, `${ns}::${cppIdent(name)}`);
      lines.push(`  defineFunction(rt, exports, ${q(name)}, ${f.params.length}, [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {\n${body}\n  });`);
    }
    for (const c of m.classes) {
      if (c.typeParams.length) continue;
      const name = c.decl.name!.text;
      // The nearest constructor in the chain; subclasses may inherit theirs.
      const owner = this.reg.chain({ k: "class", id: c.id, args: [] }).find((x) => x.info.decl.members.some(ts.isConstructorDeclaration));
      const ctor = owner?.info.decl.members.find(ts.isConstructorDeclaration);
      const em = new FnEmitter(this.ctx, { module: m.module, async: false, returnType: T.void });
      const ctorType = ctor ? (this.reg.lowerSignature(this.ctx.checker.getSignatureFromDeclaration(ctor)!, ctor) as LType & { k: "fn" }) : { k: "fn" as const, params: [], ret: T.void };
      const map = owner ? new Map(owner.info.typeParams.map((p, i) => [p, owner.t.args[i]!] as [string, LType])) : new Map<string, LType>();
      const params = (ctor ? em.paramInfos(ctor, ctorType) : []).map((p) => ({ ...p, type: substitute(p.type, map), cppType: substitute(p.cppType, map) }));
      const selfT: LType = { k: "class", id: c.id, args: [] };
      const body = c.abstract
        ? `    (void)installed;\n    throw jsi::JSError(rt, ${q(`${name} is abstract and cannot be constructed`)});`
        : this.callBody(name, params, selfT, false, `lucent_app::${c.cppName}::create`);
      lines.push(`  defineClass(rt, host, exports, ${q(name)}, ${q(c.id)}, proto_${c.cppName}, ${params.length}, [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {\n${body}\n  });`);
      // Static methods live on the constructor.
      const statics = c.decl.members.filter((x): x is ts.MethodDeclaration => ts.isMethodDeclaration(x) && isStaticPublic(x));
      if (statics.length) {
        lines.push(`  {\n    jsi::Object ctor = exports.getPropertyAsObject(rt, ${q(name)});`);
        for (const s of statics) {
          const sig = this.ctx.checker.getSignatureFromDeclaration(s)!;
          const ft = this.reg.lowerSignature(sig, s) as LType & { k: "fn" };
          const isAsync = !!ts.getModifiers(s)?.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
          const ret = isAsync && ft.ret.k === "promise" ? ft.ret.inner : ft.ret;
          const ps = em.paramInfos(s, ft);
          ps.forEach((p) => this.ctx.guard(() => this.use(p.cppType, s)));
          const fname = `${name}.${memberName(s)}`;
          const b = this.callBody(fname, ps, ret, isAsync, `lucent_app::${c.cppName}::${cppIdent(memberName(s))}`);
          lines.push(`    defineFunction(rt, ctor, ${q(memberName(s))}, ${ps.length}, [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {\n${b}\n    });`);
        }
        lines.push("  }");
      }
    }
    for (const c of m.consts) {
      const name = c.decl.name.getText();
      lines.push(`  exports.setProperty(rt, ${q(name)}, Convert<${this.reg.cpp(c.type)}>::toJs(rt, host, ${c.cpp}));`);
    }
    lines.push("}");
    return lines.join("\n");
  }

  private unionConvert(u: LType & { k: "union" }): string {
    const s = this.reg.cpp(u);
    const tests: string[] = [];
    const objectMembers: LType[] = [];
    const describe: string[] = [];
    for (const m of u.ms) {
      const mt = this.reg.cpp(m);
      const ret = `return ${s}(Convert<${mt}>::fromJs(rt, v, p));`;
      switch (m.k) {
        case "number":
          tests.push(`if (v.isNumber()) ${ret}`);
          describe.push("a number");
          break;
        case "string":
          tests.push(`if (v.isString()) ${ret}`);
          describe.push("a string");
          break;
        case "boolean":
          tests.push(`if (v.isBool()) ${ret}`);
          describe.push("a boolean");
          break;
        case "array":
        case "tuple":
          tests.push(`if (v.isObject() && v.getObject(rt).isArray(rt)) ${ret}`);
          describe.push("an array");
          break;
        case "fn":
          tests.push(`if (v.isObject() && v.getObject(rt).isFunction(rt)) ${ret}`);
          describe.push("a function");
          break;
        case "bytes":
          tests.push(`if (v.isObject() && isInstanceOf(rt, v.getObject(rt), "Uint8Array")) ${ret}`);
          break;
        case "map":
          tests.push(`if (v.isObject() && isInstanceOf(rt, v.getObject(rt), "Map")) ${ret}`);
          break;
        case "set":
          tests.push(`if (v.isObject() && isInstanceOf(rt, v.getObject(rt), "Set")) ${ret}`);
          break;
        case "error":
          tests.push(`if (v.isObject() && isInstanceOf(rt, v.getObject(rt), "Error")) ${ret}`);
          break;
        case "class": {
          const info = this.reg.cls(m.id);
          tests.push(`if (std::dynamic_pointer_cast<lucent_app::${info.cppName}>(instanceOf(rt, v))) ${ret}`);
          describe.push(`a ${info.decl.name!.text}`);
          break;
        }
        case "struct":
        case "dict":
          objectMembers.push(m);
          break;
        default:
          fail(undefined, Codes.AmbiguousUnion, `union member ${typeKey(m)} cannot cross the JavaScript boundary`);
      }
    }
    if (objectMembers.length === 1) {
      tests.push(`if (v.isObject()) return ${s}(Convert<${this.reg.cpp(objectMembers[0]!)}>::fromJs(rt, v, p));`);
      describe.push("an object");
    } else if (objectMembers.length > 1) {
      tests.push(this.discriminate(s, objectMembers));
      describe.push("an object");
    }
    return [
      `inline ${s} Convert<${s}>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {`,
      ...tests.map((t) => `  ${t}`),
      `  throwBoundaryError(rt, p, ${q(describe.join(" or ") || "a value of the union")}, v);`,
      `}`,
      `inline jsi::Value Convert<${s}>::toJs(jsi::Runtime& rt, Host& h, const ${s}& v) {`,
      `  return std::visit([&](const auto& x) -> jsi::Value { return Convert<std::decay_t<decltype(x)>>::toJs(rt, h, x); }, v);`,
      `}`,
      "",
    ].join("\n");
  }

  /** Tells union object members apart by a string-literal discriminant field. */
  private discriminate(s: string, members: LType[]): string {
    const structs = members.map((m) => (m.k === "struct" ? this.reg.struct(m.id) : fail(undefined, Codes.AmbiguousUnion, "a union of a record and objects cannot cross the boundary")));
    const candidates = structs[0]!.fields.filter((f) => f.literal !== undefined).map((f) => f.name);
    for (const name of candidates) {
      const values = structs.map((st) => st.fields.find((f) => f.name === name)?.literal);
      if (values.every((v) => v !== undefined) && new Set(values).size === values.length) {
        const branches = structs.map((_st, i) => `if (d == ${q(values[i]!)}) return ${s}(Convert<${this.reg.cpp(members[i]!)}>::fromJs(rt, v, p));`);
        return `if (v.isObject()) {\n    jsi::Value dv = v.getObject(rt).getProperty(rt, ${q(name)});\n    if (dv.isString()) {\n      std::string d = dv.getString(rt).utf8(rt);\n      ${branches.join("\n      ")}\n    }\n  }`;
      }
    }
    fail(undefined, Codes.AmbiguousUnion, `cannot tell apart the object members of a union at the JavaScript boundary (${structs.map((st) => `{ ${st.fields.map((f) => f.name).join(", ")} }`).join(" | ")}); add a string-literal discriminant such as \`kind: "a"\``);
  }
}

function isStaticPublic(m: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(m) ? ts.getModifiers(m) ?? [] : [];
  if (!mods.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)) return false;
  if (mods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword)) return false;
  return !(m.name && ts.isPrivateIdentifier(m.name));
}

interface PublicMember {
  kind: "method" | "field" | "accessor";
  name: string;
  node: ts.Node;
  types: LType[];
  params?: ParamInfo[];
  ret?: LType;
  async?: boolean;
  writable?: boolean;
}

/** Instance members JavaScript can use: public, non-static. */
export function publicMembers(ctx: Ctx, info: ClassInfo): PublicMember[] {
  const out: PublicMember[] = [];
  const isPublic = (m: ts.Node & { name?: ts.PropertyName | ts.BindingName }) => {
    const mods = ts.canHaveModifiers(m) ? ts.getModifiers(m) ?? [] : [];
    if (mods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword || x.kind === ts.SyntaxKind.StaticKeyword)) return false;
    return !(m.name && ts.isPrivateIdentifier(m.name as ts.Node));
  };
  const reg = ctx.reg;
  const em = new FnEmitter(ctx, { module: undefined as unknown as LucentModule, async: false, returnType: T.void });
  const ctor = info.decl.members.find(ts.isConstructorDeclaration);
  for (const p of parameterProperties(ctor)) {
    if (!isPublic(p)) continue;
    const readonly = !!ts.getModifiers(p)?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword);
    out.push({ kind: "field", name: memberName(p), node: p, types: [reg.lower(ctx.checker.getTypeAtLocation(p), p)], writable: !readonly });
  }
  const accessors = new Map<string, PublicMember>();
  for (const m of info.decl.members) {
    if (!isPublic(m)) continue;
    if (ts.isPropertyDeclaration(m)) {
      const readonly = !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword);
      out.push({ kind: "field", name: memberName(m), node: m, types: [reg.lower(ctx.checker.getTypeAtLocation(m), m)], writable: !readonly });
    } else if (ts.isMethodDeclaration(m)) {
      const sig = ctx.checker.getSignatureFromDeclaration(m)!;
      const ft = reg.lowerSignature(sig, m) as LType & { k: "fn" };
      const isAsync = !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
      const params = em.paramInfos(m, ft);
      const ret = isAsync && ft.ret.k === "promise" ? ft.ret.inner : ft.ret;
      out.push({ kind: "method", name: memberName(m), node: m, types: [...params.map((p) => p.cppType), ret], params, ret, async: isAsync });
    } else if (ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
      const name = memberName(m);
      const t = reg.lower(ctx.checker.getTypeAtLocation(m), m);
      const existing = accessors.get(name);
      if (existing) {
        if (ts.isSetAccessorDeclaration(m)) existing.writable = true;
      } else {
        const acc: PublicMember = { kind: "accessor", name, node: m, types: [t], writable: ts.isSetAccessorDeclaration(m) };
        accessors.set(name, acc);
        out.push(acc);
      }
    }
  }
  return out;
}

export { stripOpt };
