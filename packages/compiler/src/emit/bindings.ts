import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, CompileError, fail } from "../diagnostics.ts";
import type { LucentModule } from "../program.ts";
import { type ClassInfo, cppIdent, isVoidish, type LType, stripOpt, typeKey } from "../types.ts";
import { constructorOf, memberName, parameterProperties } from "./classes.ts";
import type { Ctx, Global, ParamInfo } from "./context.ts";
import { FnEmitter } from "./function.ts";
import { traceSite } from "./trace-site.ts";

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
      case "emitter":
        // JavaScript adds listeners, and emits.
        return t.events.forEach((e) => this.use(e.fn, node));
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
      case "weak":
        fail(
          node,
          Codes.BoundaryType,
          "a WeakRef cannot cross the JavaScript boundary: pass its target, from deref()",
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
      case "emitter":
        // A listener JavaScript adds gets the arguments; an emit from JavaScript gives them.
        return t.events.forEach((e) =>
          e.fn.params.forEach((p) => {
            this.flow(p, true, node);
            this.flow(p, false, node);
          }),
        );
    }
  }

  /** JavaScript reads a class instance's public members and calls its methods. */
  private classFlow(id: string): void {
    const key = `C:${id}`;
    if (this.flows.has(key)) return;
    this.flows.add(key);
    for (const m of publicMembers(this.ctx, this.reg.cls(id))) this.memberFlow(m);
  }

  /** JavaScript calls a method, or reads (and writes, if writable) a property. */
  private memberFlow(m: PublicMember): void {
    if (m.kind === "method") {
      m.params!.forEach((p) => this.flow(p.cppType, false, m.node));
      this.flow(m.ret!, true, m.node);
    } else {
      this.flow(m.types[0]!, true, m.node);
      if (m.writable) this.flow(m.types[0]!, false, m.node);
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
          if (c.typeParams.length) return;
          for (const p of constructorOf(this.ctx, { k: "class", id: c.id, args: [] })) {
            this.use(p.cppType, c.decl);
            this.flow(p.cppType, false, c.decl);
          }
          for (const s of staticMembers(this.ctx, c)) {
            for (const t of s.types) this.use(t, s.node);
            this.memberFlow(s);
          }
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
    js.push(this.errorInstances());
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
            this.convertFromJs(
              f.type,
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

  /**
   * `errorInstanceToJs`: an error that is an instance of a class extending
   * Error crosses as that instance, its root class's conversion finding
   * the most derived one. Other errors are left to Host::errorToJs, an
   * Error subclass no export names too: it has no prototype.
   */
  private errorInstances(): cpp.Decl {
    const roots = [...this.classes]
      .map((id) => this.reg.cls(id))
      .filter((c) => c.isError && !c.base);

    return cpp.fn(
      "errorInstanceToJs",
      JS_VALUE,
      [
        RUNTIME,
        cpp.param(cpp.reference(cpp.type("Host")), "h"),
        cpp.param(cpp.reference(cpp.constType(cpp.type("Error"))), "v"),
      ],
      [...roots.map((c) => this.asSubclass(c, "c")), cpp.ret(cpp.call("jsi::Value::undefined"))],
    );
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
    const selfOf = (fname: string) =>
      cpp.varDecl(cpp.auto, "self", fromJs(selfT, cpp.id("thisVal"), path(fname, "this")));
    const body = [
      // An Error subclass's instances are Errors; members it declares come after.
      ...(info.isError && !info.base
        ? [cpp.exprStmt(cpp.call("defineErrorPrototype", [rt, cpp.id("host"), proto]))]
        : []),
      ...publicMembers(this.ctx, info).map((m) =>
        this.defineMember(proto, name, m, (n) => cpp.arrow(self, n), selfOf),
      ),
    ];
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

  /**
   * Defines member `m` on `target`, the prototype or a constructor: a method,
   * or an accessor property for a field or accessor. `place` names the
   * member in C++; `selfOf` converts `thisVal` to the instance it is on.
   */
  private defineMember(
    target: cpp.Expr,
    cls: string,
    m: PublicMember,
    place: (cppName: string) => cpp.Expr,
    selfOf?: (fname: string) => cpp.Stmt,
  ): cpp.Stmt {
    const fname = `${cls}.${m.name}`;
    const prelude = selfOf?.(fname);
    const thisVal = prelude ? "thisVal" : undefined;
    const captures = prelude ? ["self"] : [];
    if (m.kind === "method") {
      const call = this.callBody(
        fname,
        m.node,
        m.params!,
        m.ret!,
        m.async!,
        place(cppIdent(m.name)),
        prelude,
        captures,
      );

      return cpp.exprStmt(
        cpp.call("defineFunction", [
          rt,
          target,
          cpp.str(m.name),
          cpp.num(m.params!.length),
          hostFunction(call, thisVal),
        ]),
      );
    }

    const t = this.reg.cppType(m.types[0]!);
    const got =
      m.kind === "accessor" ? cpp.call(place(`get_${cppIdent(m.name)}`)) : place(cppIdent(m.name));
    const getter = cpp.lambda(
      [INSTALLED],
      [
        cpp.param(cpp.reference(cpp.type("jsi::Runtime")), "rt"),
        cpp.param(cpp.reference(cpp.constType(JS_VALUE)), thisVal),
        cpp.param(cpp.pointer(cpp.constType(JS_VALUE))),
        cpp.param(cpp.type("size_t")),
      ],
      sync([...(prelude ? [prelude] : []), cpp.ret(toJs(t, cpp.id("host"), got))]),
      { ret: JS_VALUE },
    );
    let setter = cpp.nullptr;
    if (m.writable) {
      const value = cpp.id("value");
      const assign =
        m.kind === "accessor"
          ? cpp.call(place(`set_${cppIdent(m.name)}`), [value])
          : cpp.assign(place(cppIdent(m.name)), value);
      setter = hostFunction(
        sync([
          ...(prelude ? [prelude] : []),
          cpp.varDecl(
            cpp.auto,
            "value",
            this.convertFromJs(m.types[0]!, argAt(0), path(fname, "value")),
          ),
          cpp.exprStmt(assign),
          cpp.ret(cpp.call("jsi::Value::undefined")),
        ]),
        thisVal,
      );
    }

    return cpp.exprStmt(cpp.call("defineAccessor", [rt, target, cpp.str(m.name), getter, setter]));
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
    const site = traceSite(fname, declaration);
    const conv: cpp.Stmt[] = [];
    const names: string[] = [];
    params.forEach((p, i) => {
      const t = this.reg.cppType(p.cppType);
      const n = `a${i}`;
      names.push(n);
      if (p.rest) {
        const elem = (p.cppType as LType & { k: "array" }).e;
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
                this.convertFromJs(elem, cpp.index(cpp.id("args"), at), path(fname, which)),
              ]),
            ),
          ],
        });
      } else {
        conv.push(
          cpp.varDecl(
            cpp.auto,
            n,
            this.convertFromJs(p.cppType, argAt(i), path(fname, `argument '${p.name}'`)),
          ),
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
      // Static members live on the constructor.
      const statics = staticMembers(this.ctx, c);
      if (statics.length)
        body.push(
          cpp.block([
            cpp.varDecl(
              cpp.type("jsi::Object"),
              "ctor",
              cpp.call(cpp.dot(exports, "getPropertyAsObject"), [rt, cpp.str(name)]),
            ),
            ...statics.map((s) =>
              this.defineMember(cpp.id("ctor"), name, s, (n) =>
                cpp.scoped(this.reg.cppClassType(s.owner!), n),
              ),
            ),
          ]),
        );
    }
    for (const c of m.consts) {
      const name = cpp.str(c.decl.name.getText());
      const value = toJs(this.reg.cppType(c.type), cpp.id("host"), cpp.id(c.cpp));
      // One copy per value the module assigns, as JavaScript holds one object.
      const read = copiedOnce(c.type)
        ? cpp.call(cpp.dot(cpp.id("host"), "exported"), [
            rt,
            cpp.id(c.cpp),
            cpp.lambda(["&"], [], [cpp.ret(value)], { ret: JS_VALUE }),
          ])
        : value;

      // A `let` the module may reassign is read live, as an ES module
      // binding; a `const` binding never changes, so one copy is enough.
      body.push(
        cpp.exprStmt(
          c.isConst
            ? cpp.call(cpp.dot(exports, "setProperty"), [rt, name, value])
            : cpp.call("defineAccessor", [
                rt,
                exports,
                name,
                hostFunction(sync([cpp.ret(read)])),
                cpp.nullptr,
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
          break;
        case "string":
          test(is("isString"));
          break;
        case "bigint":
          test(is("isBigInt"));
          break;
        case "boolean":
          test(is("isBool"));
          break;
        case "array":
        case "tuple":
          test(cpp.and(isObject, cpp.call(cpp.dot(object, "isArray"), [rt])));
          break;
        case "fn":
          test(cpp.and(isObject, cpp.call(cpp.dot(object, "isFunction"), [rt])));
          break;
        case "bytes":
          test(instance("Uint8Array"));
          break;
        case "arrayBuffer":
          test(cpp.and(isObject, cpp.call(cpp.dot(object, "isArrayBuffer"), [rt])));
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
    } else if (objectMembers.length > 1) {
      tests.push(this.discriminate(s, objectMembers));
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
      cpp.fn("fromJs", s, fromJsParams(), [...tests, boundaryError(p, this.describe(u), v)], {
        inline: true,
        scope,
      }),
      cpp.fn("toJs", JS_VALUE, toJsParams(s), [cpp.ret(cpp.call("std::visit", [visitor, v]))], {
        inline: true,
        scope,
      }),
    ];
  }

  /**
   * Converts `value` to `t`. An optional typed with one absent value
   * (`T | undefined` or `T | null`) rejects the other here: Convert<Opt<T>>
   * takes both.
   */
  private convertFromJs(t: LType, value: cpp.Expr, at: cpp.Expr): cpp.Expr {
    if (t.k !== "opt" || t.absent === undefined) return fromJs(this.reg.cppType(t), value, at);

    return cpp.call(
      "optionalFromJs",
      [rt, value, at, cpp.bool(t.absent === "null"), cpp.str(this.describe(t))],
      [this.reg.cppType(t.inner)],
    );
  }

  /** What a boundary error says `t` must be: "a string or undefined". */
  private describe(t: LType): string {
    switch (t.k) {
      case "class":
        return `a ${this.reg.cls(t.id).decl.name!.text}`;
      case "iface":
        return `a ${this.reg.iface(t.id).decl.name.text}`;
      case "union":
        return [...new Set(t.ms.map((m) => this.describe(m)))].join(" or ");
      case "opt":
        return `${this.describe(t.inner)} or ${t.absent ?? "null or undefined"}`;
      default:
        return DESCRIPTIONS[t.k] ?? "a value";
    }
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
          cpp.exprStmt(
            cpp.call("throwUnknownDiscriminant", [
              rt,
              cpp.call(cpp.dot(p, "field"), [cpp.str(name)]),
              cpp.str(values.map((x) => JSON.stringify(x)).join(" or ")),
              dv,
            ]),
          ),
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

/** Kinds the boundary copies into a new JavaScript object at each conversion. */
const COPIED = new Set<LType["k"]>(["struct", "array", "tuple", "map", "set", "dict", "bytes"]);
/** Kinds `lucent::strictEquals` compares: by identity, or as primitives. */
const COMPARED = new Set<LType["k"]>([
  ...COPIED,
  "number",
  "string",
  "boolean",
  "bigint",
  "null",
  "undefined",
  "class",
]);

/**
 * Whether an exported variable of type `t` is copied once per value
 * (Host::exported) rather than at each read: one the boundary copies,
 * made only of what strictEquals compares.
 */
function copiedOnce(t: LType): boolean {
  const members = (x: LType): LType[] =>
    x.k === "opt" ? members(x.inner) : x.k === "union" ? x.ms.flatMap(members) : [x];
  const compared = (x: LType): boolean =>
    x.k === "tuple" ? x.es.every(compared) : members(x).every((m) => COMPARED.has(m.k));
  const ms = members(t);

  return ms.some((m) => COPIED.has(m.k)) && ms.every(compared);
}
/** How boundary errors name the values a type accepts, as the runtime's Convert does. */
const DESCRIPTIONS: Partial<Record<LType["k"], string>> = {
  number: "a number",
  bigint: "a bigint",
  boolean: "a boolean",
  string: "a string",
  undefined: "undefined",
  null: "null",
  array: "an array",
  tuple: "an array",
  map: "a Map",
  set: "a Set",
  dict: "an object",
  struct: "an object",
  fn: "a function",
  bytes: "a Uint8Array",
  error: "an Error",
  date: "a Date",
  regexp: "a RegExp",
  abortSignal: "an AbortSignal",
  buffer: "a NativeBuffer",
  emitter: "an EventEmitter",
  subscription: "an EventSubscription",
};
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

interface PublicMember {
  kind: "method" | "field" | "accessor";
  name: string;
  node: ts.Node;
  types: LType[];
  params?: ParamInfo[];
  ret?: LType;
  async?: boolean;
  writable?: boolean;
  /** For a static member: the class in the chain that declares it. */
  owner?: LType & { k: "class" };
}

/** Instance members JavaScript can use: public, non-static. */
export function publicMembers(ctx: Ctx, info: ClassInfo): PublicMember[] {
  return declaredMembers(ctx, info, false);
}

/**
 * Static members JavaScript can use on a class's constructor: public, its
 * own and those its ancestors declare (nearest first), as JavaScript's
 * constructors inherit them.
 */
export function staticMembers(ctx: Ctx, info: ClassInfo): PublicMember[] {
  const out = new Map<string, PublicMember>();

  for (const link of ctx.reg.chain({ k: "class", id: info.id, args: [] }))
    for (const m of declaredMembers(ctx, link.info, true))
      if (!out.has(m.name)) out.set(m.name, { ...m, owner: link.t });

  return [...out.values()];
}

const instanceMembersOf = new WeakMap<ClassInfo, PublicMember[]>();
const staticMembersOf = new WeakMap<ClassInfo, PublicMember[]>();

/**
 * The public members `info` declares: its instance members, or its static
 * ones. Lowered once per class: a member that fails is reported once and
 * left out.
 */
function declaredMembers(ctx: Ctx, info: ClassInfo, statics: boolean): PublicMember[] {
  const cache = statics ? staticMembersOf : instanceMembersOf;
  let members = cache.get(info);
  if (!members) cache.set(info, (members = lowerMembers(ctx, info, statics)));
  return members;
}

function lowerMembers(ctx: Ctx, info: ClassInfo, statics: boolean): PublicMember[] {
  const out: PublicMember[] = [];
  const isPublic = (m: ts.Node & { name?: ts.PropertyName | ts.BindingName }) => {
    const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
    if (
      mods.some(
        (x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword,
      )
    )
      return false;
    if (mods.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) !== statics) return false;
    return !(m.name && ts.isPrivateIdentifier(m.name as ts.Node));
  };
  const reg = ctx.reg;
  const em = new FnEmitter(ctx, {
    module: undefined as unknown as LucentModule,
    async: false,
  });
  const ctor = statics ? undefined : info.members.find(ts.isConstructorDeclaration);
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
  for (const m of info.members) {
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
