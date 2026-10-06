import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, CompileError, fail } from "../diagnostics.ts";
import { sourcePath } from "../lowering/source.ts";
import type { LucentModule } from "../program.ts";
import { type ClassInfo, cppIdent, isVoidish, type LType, stripOpt, typeKey } from "../types.ts";
import { constructorOf, memberName, parameterProperties } from "./classes.ts";
import type { Ctx, Global, ParamInfo } from "./context.ts";
import { FnEmitter } from "./function.ts";

/** Everything JavaScript can see of one module. */
export interface ModuleExports {
  module: LucentModule;
  functions: Extract<Global, { kind: "function" }>[];
  classes: ClassInfo[];
  consts: Extract<Global, { kind: "var" }>[];
  enums: { name: string; members: { name: string; value: string | number }[] }[];
}

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
        if (t.args.length || info.typeParams.length)
          fail(
            node,
            Codes.GenericBoundary,
            `generic class ${info.decl.name?.text} cannot cross the JavaScript boundary`,
          );
        if (this.classes.has(t.id)) return;
        this.classes.add(t.id);
        for (const m of publicMembers(this.ctx, info))
          for (const ty of m.types) this.use(ty, m.node);
        // A base-typed value may hold any subclass, and a subclass's prototype
        // extends its base's.
        if (info.base) this.use({ k: "class", id: info.base.id, args: [] }, node);
        for (const d of this.reg.descendants(t.id))
          if (!d.typeParams.length) this.use({ k: "class", id: d.id, args: [] }, node);
        return;
      }
      case "iface": {
        if (t.args.some((a) => typeKey(a).includes("T:")))
          fail(
            node,
            Codes.GenericBoundary,
            "generic interface values cannot cross the JavaScript boundary",
          );
        if (this.ifaces.has(typeKey(t))) return;
        this.ifaces.set(typeKey(t), t);
        for (const c of this.reg.implementations(t))
          this.use({ k: "class", id: c.id, args: [] }, node);
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
        fail(
          node,
          Codes.BoundaryType,
          "match results cannot cross the JavaScript boundary; return the strings you need",
        );
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
        fail(
          node,
          Codes.BoundaryType,
          `${t.name} is a ${t.platform === "ios" ? "iOS" : "Android"} object; platform objects cannot cross the JavaScript boundary, so return the values you need`,
        );
      case "handle":
        fail(
          node,
          Codes.BoundaryType,
          `${t.name} is a handle of the native extension ${t.extension}; handles cannot cross the JavaScript boundary: keep it in a Lucent class that JavaScript uses`,
        );
      case "abortSignal":
        if (out)
          fail(
            node,
            Codes.BoundaryType,
            "an AbortSignal can only be passed from JavaScript to Lucent, not returned or passed to a JavaScript callback",
          );
        return;
      case "abortController":
        fail(
          node,
          Codes.BoundaryType,
          "an AbortController cannot cross the JavaScript boundary; pass its signal instead",
        );
      case "span":
        fail(
          node,
          Codes.BoundaryType,
          "a byte span is lent for one call and cannot cross the JavaScript boundary; pass the NativeBuffer, or a copy of its bytes (toUint8Array())",
        );
      case "iter":
        // JavaScript iterables come in as a snapshot; iterators do not go out.
        if (out)
          fail(
            node,
            Codes.BoundaryType,
            "iterators and generators cannot be returned to JavaScript; collect them into an array",
          );
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

  /** lucent_bindings.cpp's declarations, after the headers of the modules it installs. */
  generate(mods: ModuleExports[], initOrder: LucentModule[]): cpp.Decl[] {
    for (const m of mods) {
      for (const f of m.functions) {
        if (f.generic) {
          this.ctx.diagnostics.push({
            code: Codes.GenericBoundary,
            message: `exported function ${f.decl.name?.text} is generic; generic functions cannot be called from JavaScript`,
            file: m.module.file,
          });
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
    const js: cpp.Decl[] = [];
    // Declarations first: conversions can refer to each other recursively.
    for (const id of this.classes)
      js.push(cpp.fn(`proto_${this.reg.cls(id).cppName}`, cpp.voidType, PROTO_PARAMS));
    const specialize = (t: cpp.Type, fromObject: boolean) =>
      js.push(
        cpp.struct(
          "Convert",
          [
            cpp.method("fromJs", t, fromJsParams(), undefined, { static: true }),
            // Structs also convert from an object the caller owns (array elements): no handle clone.
            ...(fromObject
              ? [cpp.method("fromObject", t, fromObjectParams(), undefined, { static: true })]
              : []),
            cpp.method("toJs", JS_VALUE, toJsParams(t), undefined, { static: true }),
          ],
          { template: [], args: [t] },
        ),
      );
    for (const id of this.structs) specialize(this.reg.cppType({ k: "struct", id }), true);
    for (const id of this.classes)
      specialize(this.reg.cppType({ k: "class", id, args: [] }), false);
    for (const t of this.ifaces.values()) specialize(this.reg.cppType(t), false);
    for (const u of this.unions.values()) specialize(this.reg.cppType(u), false);
    const guarded = (f: () => cpp.Decl[]) => js.push(...(this.ctx.guard(f) ?? []));
    for (const id of this.structs) guarded(() => this.structConvert(id));
    for (const id of this.classes) guarded(() => this.classConvert(id));
    for (const t of this.ifaces.values()) guarded(() => this.ifaceConvert(t));
    for (const [key, u] of this.unions) {
      const decls = this.ctx.guard(() => {
        try {
          return this.unionConvert(u);
        } catch (e) {
          // Report at the declaration that sent the union across the boundary.
          if (e instanceof CompileError && !e.node)
            throw new CompileError(this.unionSites.get(key), e.code, e.message);
          throw e;
        }
      });
      if (decls) js.push(...decls);
    }
    const installers = mods.flatMap((m) => this.ctx.guard(() => this.installer(m)) ?? []);
    const modules = mods.map((m) =>
      cpp.initList([cpp.str(m.module.name), cpp.id(`install_${m.module.ns}`)]),
    );
    const count = cpp.id("count");
    return [
      cpp.include("lucent/jsi/convert.h", true),
      cpp.include("lucent/jsi/host.h", true),
      cpp.namespace("lucent::js", js),
      cpp.namespace("", [
        { k: "usingNamespace", name: "lucent::js" },
        ...installers,
        {
          k: "var",
          stmt: {
            ...cpp.varDecl(
              cpp.constType(cpp.type("ModuleDef")),
              "kModules",
              cpp.initList(modules.length ? modules : [cpp.initList([cpp.str(""), cpp.nullptr])]),
            ),
            array: true,
          },
        },
      ]),
      cpp.namespace("lucent::js", [
        cpp.fn(
          "registeredModules",
          cpp.pointer(cpp.constType(cpp.type("ModuleDef"))),
          [cpp.param(cpp.reference(cpp.type("size_t")), "count")],
          [cpp.exprStmt(cpp.assign(count, cpp.num(mods.length))), cpp.ret(cpp.id("kModules"))],
        ),
        cpp.fn(
          "resetModuleState",
          cpp.voidType,
          [],
          initOrder.map((m) => cpp.exprStmt(cpp.call(`lucent_app::${m.ns}::init`))),
        ),
      ]),
    ];
  }

  private structConvert(id: string): cpp.Decl[] {
    const info = this.reg.struct(id);
    const s = this.reg.cppType({ k: "struct", id });
    const [o, out, h] = [cpp.id("o"), cpp.id("out"), cpp.id("h")];
    // Field names are interned once per runtime (Host::prop): a struct array
    // reads and writes them for every element.
    const names = info.fields.map((f, i) =>
      cpp.varDecl(cpp.constType(cpp.type("PropName")), `n${i}`, cpp.str(f.name), {
        static: true,
        style: "brace",
      }),
    );
    const prop = (i: number) => cpp.call(cpp.dot(h, "prop"), [rt, cpp.id(`n${i}`)]);
    const from: cpp.Stmt[] = [];
    const to: cpp.Stmt[] = [];
    info.fields.forEach((f, i) => {
      const ft = this.reg.cppType(f.type);
      const field = cpp.arrow(v, cppIdent(f.name));
      from.push(
        cpp.exprStmt(
          cpp.assign(
            cpp.arrow(out, cppIdent(f.name)),
            fromJs(
              ft,
              cpp.call(cpp.dot(o, "getProperty"), [rt, prop(i)]),
              cpp.call(cpp.dot(p, "field"), [cpp.str(f.name)]),
            ),
          ),
        ),
      );
      const set = cpp.exprStmt(
        cpp.call(cpp.dot(o, "setProperty"), [rt, prop(i), toJs(ft, h, field)]),
      );
      to.push(
        f.type.k === "opt"
          ? cpp.ifStmt(cpp.not(cpp.call(cpp.dot(field, "isUndefined"))), [set])
          : set,
      );
    });
    const scope = cpp.type("Convert", s);
    const anObject = (got: cpp.Expr) => boundaryError(p, "an object", got);
    return [
      cpp.fn(
        "fromJs",
        s,
        fromJsParams(),
        [
          cpp.ifStmt(cpp.not(cpp.call(cpp.dot(v, "isObject"))), [anObject(v)]),
          cpp.ret(cpp.call("fromObject", [rt, cpp.call(cpp.dot(v, "getObject"), [rt]), p])),
        ],
        { inline: true, scope },
      ),
      cpp.fn(
        "fromObject",
        s,
        fromObjectParams(),
        [
          cpp.ifStmt(
            cpp.or(cpp.call(cpp.dot(o, "isArray"), [rt]), cpp.call(cpp.dot(o, "isFunction"), [rt])),
            [anObject(cpp.construct(JS_VALUE, [rt, o]))],
          ),
          ...(info.fields.length
            ? [
                cpp.varDecl(cpp.reference(cpp.type("Host")), "h", cpp.call("Host::get", [rt])),
                ...names,
              ]
            : []),
          cpp.varDecl(cpp.auto, "out", makeShared(info.cppName)),
          ...from,
          cpp.ret(out),
        ],
        { inline: true, scope },
      ),
      cpp.fn(
        "toJs",
        JS_VALUE,
        toJsParams(s),
        [
          cpp.ifStmt(cpp.not(v), [cpp.ret(cpp.call("jsi::Value::null"))]),
          ...names,
          cpp.varDecl(cpp.type("jsi::Object"), "o", rt, { style: "construct" }),
          ...to,
          cpp.ret(cpp.construct(JS_VALUE, [cpp.call("std::move", [o])])),
        ],
        { inline: true, scope },
      ),
    ];
  }

  private classConvert(id: string): cpp.Decl[] {
    const info = this.reg.cls(id);
    const s = this.reg.cppType({ k: "class", id, args: [] });
    const name = info.decl.name!.text;
    const h = cpp.id("h");
    return [
      ...this.instanceFromJs(s, cpp.type(`lucent_app::${info.cppName}`), `a ${name}`),
      cpp.fn(
        "toJs",
        JS_VALUE,
        toJsParams(s),
        [
          // The JS object of the most derived class, deepest subclasses first.
          ...this.reg
            .descendants(id)
            .filter((d) => !d.typeParams.length)
            .map((d) => this.asSubclass(d, "d")),
          cpp.ret(
            cpp.call(cpp.dot(h, "wrap"), [
              rt,
              v,
              cpp.str(info.id),
              cpp.id(`proto_${info.cppName}`),
            ]),
          ),
        ],
        { inline: true, scope: cpp.type("Convert", s) },
      ),
      this.prototype(info),
    ];
  }

  /** `if (auto d = std::dynamic_pointer_cast<C>(v)) return Convert<C>::toJs(rt, h, d);` */
  private asSubclass(c: ClassInfo, name: string): cpp.Stmt {
    return {
      k: "if",
      bind: { type: cpp.auto, name },
      test: dynamicCast(cpp.type(`lucent_app::${c.cppName}`), v),
      body: [
        cpp.ret(
          toJs(this.reg.cppType({ k: "class", id: c.id, args: [] }), cpp.id("h"), cpp.id(name)),
        ),
      ],
    };
  }

  /** `fromJs` of a class or interface: the instance JavaScript holds, if it is one. */
  private instanceFromJs(s: cpp.Type, cls: cpp.Type, expected: string): cpp.Decl[] {
    const c = cpp.id("c");
    return [
      cpp.fn(
        "fromJs",
        s,
        fromJsParams(),
        [
          cpp.varDecl(cpp.auto, "c", dynamicCast(cls, cpp.call("instanceOf", [rt, v]))),
          cpp.ifStmt(cpp.not(c), [boundaryError(p, expected, v)]),
          cpp.ret(c),
        ],
        { inline: true, scope: cpp.type("Convert", s) },
      ),
    ];
  }

  /** Interface values cross as their concrete class: every implementer is known. */
  private ifaceConvert(t: LType & { k: "iface" }): cpp.Decl[] {
    const info = this.reg.iface(t.id);
    const s = this.reg.cppType(t);
    const impls = this.reg.implementations(t);
    const expected = `a ${info.decl.name.text} (${impls.map((c) => c.decl.name!.text).join(", ") || "no implementations"})`;
    return [
      ...this.instanceFromJs(s, this.reg.cppIfaceType(t), expected),
      cpp.fn(
        "toJs",
        JS_VALUE,
        toJsParams(s),
        [
          cpp.ifStmt(cpp.not(v), [cpp.ret(cpp.call("jsi::Value::null"))]),
          ...impls.map((c) => this.asSubclass(c, "c")),
          {
            k: "throw",
            value: cpp.construct(cpp.type("std::logic_error"), [
              cpp.str(`unknown ${info.decl.name.text} implementation`),
            ]),
          },
        ],
        { inline: true, scope: cpp.type("Convert", s) },
      ),
    ];
  }

  private prototype(info: ClassInfo): cpp.Decl {
    const name = info.decl.name!.text;
    const selfT = this.reg.cppType({ k: "class", id: info.id, args: [] });
    const [proto, self] = [cpp.id("proto"), cpp.id("self")];
    const body: cpp.Stmt[] = [];
    const selfOf = (fname: string) =>
      cpp.varDecl(cpp.auto, "self", fromJs(selfT, cpp.id("thisVal"), path(fname, "this")));
    for (const m of publicMembers(this.ctx, info)) {
      if (m.kind === "method") {
        const d = m.node as ts.MethodDeclaration;
        const fname = `${name}.${memberName(d)}`;
        const call = this.callBody(
          fname,
          d,
          m.params!,
          m.ret!,
          m.async!,
          cpp.arrow(self, cppIdent(memberName(d))),
          selfOf(fname),
          ["self"],
        );
        body.push(
          cpp.exprStmt(
            cpp.call("defineFunction", [
              rt,
              proto,
              cpp.str(memberName(d)),
              cpp.num(m.params!.length),
              hostFunction(call, "thisVal"),
            ]),
          ),
        );
      } else {
        const fname = `${name}.${m.name}`;
        const t = this.reg.cppType(m.types[0]!);
        const got =
          m.kind === "accessor"
            ? cpp.call(cpp.arrow(self, `get_${cppIdent(m.name)}`))
            : cpp.arrow(self, cppIdent(m.name));
        const getter = cpp.lambda(
          [INSTALLED],
          [
            cpp.param(cpp.reference(cpp.type("jsi::Runtime")), "rt"),
            cpp.param(cpp.reference(cpp.constType(JS_VALUE)), "thisVal"),
            cpp.param(cpp.pointer(cpp.constType(JS_VALUE))),
            cpp.param(cpp.type("size_t")),
          ],
          sync([selfOf(fname), cpp.ret(toJs(t, cpp.id("host"), got))]),
          { ret: JS_VALUE },
        );
        let setter = cpp.nullptr;
        if (m.writable) {
          const value = cpp.id("value");
          const assign =
            m.kind === "accessor"
              ? cpp.call(cpp.arrow(self, `set_${cppIdent(m.name)}`), [value])
              : cpp.assign(cpp.arrow(self, cppIdent(m.name)), value);
          setter = hostFunction(
            sync([
              selfOf(fname),
              cpp.varDecl(cpp.auto, "value", fromJs(t, argAt(0), path(fname, "value"))),
              cpp.exprStmt(assign),
              cpp.ret(cpp.call("jsi::Value::undefined")),
            ]),
            "thisVal",
          );
        }
        body.push(
          cpp.exprStmt(cpp.call("defineAccessor", [rt, proto, cpp.str(m.name), getter, setter])),
        );
      }
    }
    if (info.base) {
      const base = this.reg.cls(info.base.id);
      body.push(
        cpp.varDecl(
          cpp.reference(cpp.type("jsi::Object")),
          "baseProto",
          cpp.call(cpp.dot(cpp.id("host"), "prototype"), [
            rt,
            cpp.str(base.id),
            cpp.id(`proto_${base.cppName}`),
          ]),
        ),
        cpp.exprStmt(
          cpp.call(
            cpp.dot(
              cpp.call(
                cpp.dot(
                  cpp.call(cpp.dot(cpp.call(cpp.dot(rt, "global")), "getPropertyAsObject"), [
                    rt,
                    cpp.str("Object"),
                  ]),
                  "getPropertyAsFunction",
                ),
                [rt, cpp.str("setPrototypeOf")],
              ),
              "call",
            ),
            [rt, proto, cpp.id("baseProto")],
          ),
        ),
      );
    }
    return cpp.fn(`proto_${info.cppName}`, cpp.voidType, PROTO_PARAMS, body);
  }

  /** The body of a host function that converts arguments, calls, and converts back. */
  private callBody(
    fname: string,
    declaration: ts.Node,
    params: ParamInfo[],
    ret: LType,
    isAsync: boolean,
    target: cpp.Expr,
    prelude?: cpp.Stmt,
    captures: string[] = [],
  ): cpp.Stmt[] {
    const site = siteOf(fname, declaration);
    const conv: cpp.Stmt[] = [];
    const names: string[] = [];
    params.forEach((p, i) => {
      const t = this.reg.cppType(p.cppType);
      const n = `a${i}`;
      names.push(n);
      if (p.rest) {
        const elem = this.reg.cppType((p.cppType as LType & { k: "array" }).e);
        const at = cpp.id("i");
        const which = cpp.binary(
          cpp.str("argument "),
          "+",
          cpp.call("std::to_string", [cpp.binary(at, "+", cpp.num(1))]),
        );
        conv.push(cpp.varDecl(t, n), {
          k: "for",
          init: cpp.varDecl(cpp.type("size_t"), "i", cpp.num(i)),
          test: cpp.binary(at, "<", cpp.id("count")),
          update: cpp.postfix("++", at),
          body: [
            cpp.exprStmt(
              cpp.call(cpp.dot(cpp.id(n), "push"), [
                fromJs(elem, cpp.index(cpp.id("args"), at), path(fname, which)),
              ]),
            ),
          ],
        });
      } else {
        conv.push(
          cpp.varDecl(cpp.auto, n, fromJs(t, argAt(i), path(fname, `argument '${p.name}'`))),
        );
      }
    });
    // Each converted argument is used once: synchronous calls move them in;
    // async ones copy them into the job's lambda.
    const ids = names.map((n) => cpp.id(n));
    const moved = cpp.call(
      target,
      ids.map((n) => cpp.call("std::move", [n])),
    );
    const host = cpp.id("host");
    const result: cpp.Stmt[] = isAsync
      ? [
          cpp.ret(
            cpp.call(
              "callAsync",
              [
                rt,
                host,
                site,
                cpp.lambda([...captures, ...names], [], [cpp.ret(cpp.call(target, ids))]),
              ],
              [this.reg.cppRetType(ret)],
            ),
          ),
        ]
      : isVoidish(ret)
        ? [cpp.exprStmt(moved), cpp.ret(cpp.call("jsi::Value::undefined"))]
        : [cpp.ret(toJs(this.reg.cppType(ret), host, moved))];
    // An async call is traced by callAsync, which carries its id on.
    return sync([...(prelude ? [prelude] : []), ...conv, ...result], isAsync ? undefined : site);
  }

  private installer(m: ModuleExports): cpp.Decl {
    const ns = `lucent_app::${m.module.ns}`;
    const exports = cpp.id("exports");
    const body: cpp.Stmt[] = [];
    for (const f of m.functions) {
      if (f.generic) continue;
      const name = f.decl.name!.text;
      const ret = f.async
        ? f.type.ret.k === "promise"
          ? f.type.ret.inner
          : f.type.ret
        : f.type.ret;
      const call = this.callBody(
        name,
        f.decl,
        f.params,
        ret,
        f.async,
        cpp.id(`${ns}::${cppIdent(name)}`),
      );
      body.push(
        cpp.exprStmt(
          cpp.call("defineFunction", [
            rt,
            exports,
            cpp.str(name),
            cpp.num(f.params.length),
            hostFunction(call),
          ]),
        ),
      );
    }
    for (const c of m.classes) {
      if (c.typeParams.length) continue;
      const name = c.decl.name!.text;
      const em = new FnEmitter(this.ctx, { module: m.module, async: false });
      const params = constructorOf(this.ctx, { k: "class", id: c.id, args: [] });
      const selfT: LType = { k: "class", id: c.id, args: [] };
      const construct = c.abstract
        ? [
            cpp.exprStmt(cpp.cast("c", cpp.voidType, cpp.id("installed"))),
            {
              k: "throw" as const,
              value: cpp.construct(cpp.type("jsi::JSError"), [
                rt,
                cpp.str(`${name} is abstract and cannot be constructed`),
              ]),
            },
          ]
        : this.callBody(
            name,
            c.decl,
            params,
            selfT,
            false,
            cpp.id(`lucent_app::${c.cppName}::create`),
          );
      body.push(
        cpp.exprStmt(
          cpp.call("defineClass", [
            rt,
            cpp.id("host"),
            exports,
            cpp.str(name),
            cpp.str(c.id),
            cpp.id(`proto_${c.cppName}`),
            cpp.num(params.length),
            hostFunction(construct),
          ]),
        ),
      );
      // Static methods live on the constructor.
      const statics = c.decl.members.filter(
        (x): x is ts.MethodDeclaration => ts.isMethodDeclaration(x) && isStaticPublic(x),
      );
      if (statics.length) {
        const inner: cpp.Stmt[] = [
          cpp.varDecl(
            cpp.type("jsi::Object"),
            "ctor",
            cpp.call(cpp.dot(exports, "getPropertyAsObject"), [rt, cpp.str(name)]),
          ),
        ];
        for (const s of statics) {
          const sig = this.ctx.checker.getSignatureFromDeclaration(s)!;
          const ft = this.reg.lowerSignature(sig, s) as LType & { k: "fn" };
          const isAsync = !!ts.getModifiers(s)?.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
          const ret = isAsync && ft.ret.k === "promise" ? ft.ret.inner : ft.ret;
          const ps = em.paramInfos(s, ft);
          ps.forEach((p) => this.ctx.guard(() => this.use(p.cppType, s)));
          const fname = `${name}.${memberName(s)}`;
          const call = this.callBody(
            fname,
            s,
            ps,
            ret,
            isAsync,
            cpp.id(`lucent_app::${c.cppName}::${cppIdent(memberName(s))}`),
          );
          inner.push(
            cpp.exprStmt(
              cpp.call("defineFunction", [
                rt,
                cpp.id("ctor"),
                cpp.str(memberName(s)),
                cpp.num(ps.length),
                hostFunction(call),
              ]),
            ),
          );
        }
        body.push(cpp.block(inner));
      }
    }
    for (const c of m.consts) {
      const name = c.decl.name.getText();
      body.push(
        cpp.exprStmt(
          cpp.call(cpp.dot(exports, "setProperty"), [
            rt,
            cpp.str(name),
            toJs(this.reg.cppType(c.type), cpp.id("host"), cpp.id(c.cpp)),
          ]),
        ),
      );
    }
    return cpp.fn(
      `install_${m.module.ns}`,
      cpp.voidType,
      [
        cpp.param(cpp.reference(cpp.type("jsi::Runtime")), "rt"),
        cpp.param(cpp.reference(cpp.type("Host")), "host"),
        cpp.param(cpp.reference(cpp.type("jsi::Object")), "exports"),
      ],
      body,
    );
  }

  private unionConvert(u: LType & { k: "union" }): cpp.Decl[] {
    const s = this.reg.cppType(u);
    const tests: cpp.Stmt[] = [];
    const objectMembers: LType[] = [];
    const describe: string[] = [];
    const object = cpp.call(cpp.dot(v, "getObject"), [rt]);
    const isObject = cpp.call(cpp.dot(v, "isObject"));
    const instance = (cls: string) =>
      cpp.and(isObject, cpp.call("isInstanceOf", [rt, object, cpp.str(cls)]));
    for (const m of u.ms) {
      const test = (t: cpp.Expr) => tests.push(cpp.ifStmt(t, [this.unionMember(s, m)]));
      const is = (what: string) => cpp.call(cpp.dot(v, what));
      switch (m.k) {
        case "number":
          test(is("isNumber"));
          describe.push("a number");
          break;
        case "string":
          test(is("isString"));
          describe.push("a string");
          break;
        case "bigint":
          test(is("isBigInt"));
          describe.push("a bigint");
          break;
        case "boolean":
          test(is("isBool"));
          describe.push("a boolean");
          break;
        case "array":
        case "tuple":
          test(cpp.and(isObject, cpp.call(cpp.dot(object, "isArray"), [rt])));
          describe.push("an array");
          break;
        case "fn":
          test(cpp.and(isObject, cpp.call(cpp.dot(object, "isFunction"), [rt])));
          describe.push("a function");
          break;
        case "bytes":
          test(instance("Uint8Array"));
          break;
        case "map":
          test(instance("Map"));
          break;
        case "set":
          test(instance("Set"));
          break;
        case "error":
          test(instance("Error"));
          break;
        case "class": {
          const info = this.reg.cls(m.id);
          test(
            dynamicCast(cpp.type(`lucent_app::${info.cppName}`), cpp.call("instanceOf", [rt, v])),
          );
          describe.push(`a ${info.decl.name!.text}`);
          break;
        }
        case "struct":
        case "dict":
          objectMembers.push(m);
          break;
        default:
          fail(
            undefined,
            Codes.AmbiguousUnion,
            `union member ${typeKey(m)} cannot cross the JavaScript boundary`,
          );
      }
    }
    if (objectMembers.length === 1) {
      tests.push(cpp.ifStmt(isObject, [this.unionMember(s, objectMembers[0]!)]));
      describe.push("an object");
    } else if (objectMembers.length > 1) {
      tests.push(this.discriminate(s, objectMembers));
      describe.push("an object");
    }
    const x = cpp.id("x");
    const visitor = cpp.lambda(
      ["&"],
      [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "x")],
      [cpp.ret(toJs(cpp.type("std::decay_t", cpp.decltype(x)), cpp.id("h"), x))],
      { ret: JS_VALUE },
    );
    const scope = cpp.type("Convert", s);
    return [
      cpp.fn(
        "fromJs",
        s,
        fromJsParams(),
        [...tests, boundaryError(p, describe.join(" or ") || "a value of the union", v)],
        { inline: true, scope },
      ),
      cpp.fn("toJs", JS_VALUE, toJsParams(s), [cpp.ret(cpp.call("std::visit", [visitor, v]))], {
        inline: true,
        scope,
      }),
    ];
  }

  /** `return U(Convert<M>::fromJs(rt, v, p));` */
  private unionMember(s: cpp.Type, m: LType): cpp.Stmt {
    return cpp.ret(cpp.construct(s, [fromJs(this.reg.cppType(m), v, p)]));
  }

  /** Tells union object members apart by a string-literal discriminant field. */
  private discriminate(s: cpp.Type, members: LType[]): cpp.Stmt {
    const structs = members.map((m) =>
      m.k === "struct"
        ? this.reg.struct(m.id)
        : fail(
            undefined,
            Codes.AmbiguousUnion,
            "a union of a record and objects cannot cross the boundary",
          ),
    );
    const candidates = structs[0]!.fields.filter((f) => f.literal !== undefined).map((f) => f.name);
    for (const name of candidates) {
      const values = structs.map((st) => st.fields.find((f) => f.name === name)?.literal);
      if (values.every((x) => x !== undefined) && new Set(values).size === values.length) {
        const [dv, d] = [cpp.id("dv"), cpp.id("d")];
        return cpp.ifStmt(cpp.call(cpp.dot(v, "isObject")), [
          cpp.varDecl(
            JS_VALUE,
            "dv",
            cpp.call(cpp.dot(cpp.call(cpp.dot(v, "getObject"), [rt]), "getProperty"), [
              rt,
              cpp.str(name),
            ]),
          ),
          cpp.ifStmt(cpp.call(cpp.dot(dv, "isString")), [
            cpp.varDecl(
              cpp.type("std::string"),
              "d",
              cpp.call(cpp.dot(cpp.call(cpp.dot(dv, "getString"), [rt]), "utf8"), [rt]),
            ),
            ...members.map((m, i) =>
              cpp.ifStmt(cpp.binary(d, "==", cpp.str(values[i]!)), [this.unionMember(s, m)]),
            ),
          ]),
        ]);
      }
    }
    fail(
      undefined,
      Codes.AmbiguousUnion,
      `cannot tell apart the object members of a union at the JavaScript boundary (${structs.map((st) => `{ ${st.fields.map((f) => f.name).join(", ")} }`).join(" | ")}); add a string-literal discriminant such as \`kind: "a"\``,
    );
  }
}

const [rt, v, p] = [cpp.id("rt"), cpp.id("v"), cpp.id("p")];
const JS_VALUE = cpp.type("jsi::Value");
const RUNTIME = cpp.param(cpp.reference(cpp.type("jsi::Runtime")), "rt");
const PATH = cpp.param(cpp.reference(cpp.constType(cpp.type("Path"))), "p");
const PROTO_PARAMS = [
  RUNTIME,
  cpp.param(cpp.reference(cpp.type("Host")), "host"),
  cpp.param(cpp.reference(cpp.type("jsi::Object")), "proto"),
];
const fromJsParams = () => [RUNTIME, cpp.param(cpp.reference(cpp.constType(JS_VALUE)), "v"), PATH];
const fromObjectParams = () => [
  RUNTIME,
  cpp.param(cpp.reference(cpp.constType(cpp.type("jsi::Object"))), "o"),
  PATH,
];
const toJsParams = (t: cpp.Type) => [
  RUNTIME,
  cpp.param(cpp.reference(cpp.type("Host")), "h"),
  cpp.param(cpp.reference(cpp.constType(t)), "v"),
];
/** The Host that installed a function, kept alive by it. */
const INSTALLED: cpp.Capture = {
  name: "installed",
  init: cpp.call(cpp.dot(cpp.id("host"), "shared_from_this")),
};

const fromJs = (t: cpp.Type, value: cpp.Expr, at: cpp.Expr) =>
  cpp.call(cpp.scoped(cpp.type("Convert", t), "fromJs"), [rt, value, at]);
const toJs = (t: cpp.Type, host: cpp.Expr, value: cpp.Expr) =>
  cpp.call(cpp.scoped(cpp.type("Convert", t), "toJs"), [rt, host, value]);
/** `Path{"Point.move", "argument 'dx'"}`: where a conversion failed, for its error. */
const path = (fname: string, what: string | cpp.Expr) =>
  cpp.construct(
    cpp.type("Path"),
    [cpp.str(fname), typeof what === "string" ? cpp.str(what) : what],
    true,
  );
const boundaryError = (at: cpp.Expr, expected: string, got: cpp.Expr) =>
  cpp.exprStmt(cpp.call("throwBoundaryError", [rt, at, cpp.str(expected), got]));
const argAt = (i: number) => cpp.call("arg", [cpp.id("args"), cpp.id("count"), cpp.num(i)]);
const dynamicCast = (t: cpp.Type, x: cpp.Expr) => cpp.call("std::dynamic_pointer_cast", [x], [t]);
const makeShared = (cppName: string) =>
  cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${cppName}`)]);

/** `Host& host = …; return callSync(rt, host, [site,] [&]() -> jsi::Value { … });` */
function sync(body: cpp.Stmt[], site?: cpp.Expr): cpp.Stmt[] {
  const lambda = cpp.lambda(["&"], [], body, { ret: JS_VALUE });

  return [
    cpp.varDecl(
      cpp.reference(cpp.type("Host")),
      "host",
      cpp.call("Host::from", [rt, cpp.id("installed")]),
    ),
    cpp.ret(cpp.call("callSync", [rt, cpp.id("host"), ...(site ? [site] : []), lambda])),
  ];
}

/**
 * Where an export is declared, for traces: its name, its .lucent.ts file
 * as `#line` names it, and its line (`LUCENT_TRACE_SITE_AT`, a static).
 */
function siteOf(name: string, node: ts.Node): cpp.Expr {
  const sf = node.getSourceFile();
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  return cpp.call("LUCENT_TRACE_SITE_AT", [
    cpp.str(name),
    cpp.str(sourcePath(sf.fileName)),
    cpp.num(line),
  ]);
}

/** A JSI host function holding its Host; `thisVal` named when the body reads it. */
function hostFunction(body: cpp.Stmt[], thisVal?: string): cpp.Expr {
  return cpp.lambda(
    [INSTALLED],
    [
      RUNTIME,
      cpp.param(cpp.reference(cpp.constType(JS_VALUE)), thisVal),
      cpp.param(cpp.pointer(cpp.constType(JS_VALUE)), "args"),
      cpp.param(cpp.type("size_t"), "count"),
    ],
    body,
    { ret: JS_VALUE },
  );
}

export function isStaticPublic(m: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
  if (!mods.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)) return false;
  if (
    mods.some(
      (x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword,
    )
  )
    return false;
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

const membersOf = new WeakMap<ClassInfo, PublicMember[]>();

/**
 * Instance members JavaScript can use: public, non-static. Lowered once per
 * class: a member that fails is reported once and left out.
 */
export function publicMembers(ctx: Ctx, info: ClassInfo): PublicMember[] {
  let members = membersOf.get(info);
  if (!members) membersOf.set(info, (members = lowerPublicMembers(ctx, info)));
  return members;
}

function lowerPublicMembers(ctx: Ctx, info: ClassInfo): PublicMember[] {
  const out: PublicMember[] = [];
  const isPublic = (m: ts.Node & { name?: ts.PropertyName | ts.BindingName }) => {
    const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
    if (
      mods.some(
        (x) =>
          x.kind === ts.SyntaxKind.PrivateKeyword ||
          x.kind === ts.SyntaxKind.ProtectedKeyword ||
          x.kind === ts.SyntaxKind.StaticKeyword,
      )
    )
      return false;
    return !(m.name && ts.isPrivateIdentifier(m.name as ts.Node));
  };
  const reg = ctx.reg;
  const em = new FnEmitter(ctx, {
    module: undefined as unknown as LucentModule,
    async: false,
  });
  const ctor = info.decl.members.find(ts.isConstructorDeclaration);
  for (const p of parameterProperties(ctor)) {
    if (!isPublic(p)) continue;
    const readonly = !!ts.getModifiers(p)?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword);
    ctx.guard(() =>
      out.push({
        kind: "field",
        name: memberName(p),
        node: p,
        types: [reg.lower(ctx.checker.getTypeAtLocation(p), p)],
        writable: !readonly,
      }),
    );
  }
  const accessors = new Map<string, PublicMember>();
  for (const m of info.decl.members) {
    // Symbol-keyed methods ([Symbol.dispose]) are for Lucent code: JSI names properties by string.
    if (!isPublic(m) || (m.name && ts.isComputedPropertyName(m.name))) continue;
    ctx.guard(() => lowerMember(m));
  }
  return out;

  function lowerMember(m: ts.ClassElement): void {
    if (ts.isPropertyDeclaration(m)) {
      const readonly = !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword);
      out.push({
        kind: "field",
        name: memberName(m),
        node: m,
        types: [reg.lower(ctx.checker.getTypeAtLocation(m), m)],
        writable: !readonly,
      });
    } else if (ts.isMethodDeclaration(m)) {
      const sig = ctx.checker.getSignatureFromDeclaration(m)!;
      const ft = reg.lowerSignature(sig, m) as LType & { k: "fn" };
      const isAsync = !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
      const params = em.paramInfos(m, ft);
      const ret = isAsync && ft.ret.k === "promise" ? ft.ret.inner : ft.ret;
      out.push({
        kind: "method",
        name: memberName(m),
        node: m,
        types: [...params.map((p) => p.cppType), ret],
        params,
        ret,
        async: isAsync,
      });
    } else if (ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
      const name = memberName(m);
      const t = reg.lower(ctx.checker.getTypeAtLocation(m), m);
      const existing = accessors.get(name);
      if (existing) {
        if (ts.isSetAccessorDeclaration(m)) existing.writable = true;
      } else {
        const acc: PublicMember = {
          kind: "accessor",
          name,
          node: m,
          types: [t],
          writable: ts.isSetAccessorDeclaration(m),
        };
        accessors.set(name, acc);
        out.push(acc);
      }
    }
  }
}

export { stripOpt };
