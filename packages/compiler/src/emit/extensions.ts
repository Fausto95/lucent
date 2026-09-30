/**
 * Calls into native extensions (lucent:ext/…): plain C calls from any
 * unit, shared code included, since the extension's C code builds on
 * every platform. Each call converts and checks its arguments, runs the C
 * function where an escaping exception ends the process instead of
 * unwinding through Lucent, and turns a failure its result reports into
 * an Error with C's message. Handles are lucent::Handle: made by their
 * create, destroyed once by close() or their last reference.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import type { FunctionBinding, HandleBinding, ParamBinding } from "../extensions/bind.ts";
import { findExtension, findFunction, findHandle } from "../extensions/registry.ts";
import { extensionModuleOf } from "../program.ts";
import { type LType, T } from "../types.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import { DISPOSE } from "./classes.ts";
import { inMainContext } from "./native.ts";

/** `new OrbitFilter(…)`: the handle's create. */
export function handleNew(em: FnEmitter, node: ts.NewExpression, t: LType & { k: "handle" }): E {
  const h = handleOf(t, node);

  return call(
    em,
    t.extension,
    h.create,
    undefined,
    node.arguments ?? ts.factory.createNodeArray(),
    node,
    t.name,
  );
}

/** `orbit_filter_apply(…)`: a function of an extension, by its C name. */
export function extensionFunctionCall(em: FnEmitter, node: ts.CallExpression): E | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;

  const sym = em.checker.getSymbolAtLocation(node.expression);
  const decl = sym && em.ctx.resolve(sym).valueDeclaration;
  const extension =
    decl && ts.isFunctionDeclaration(decl) ? extensionModuleOf(decl.getSourceFile()) : undefined;
  if (!extension) return undefined;

  const f = findFunction(extension, node.expression.text);
  if (!f) fail(node, Codes.UnsupportedCall, `${node.expression.text} has no binding`);

  return call(em, extension, f, undefined, node.arguments, node, f.name);
}

/** `filter.apply(…)`, `filter.close()`, `filter[Symbol.dispose]()`. */
export function handleMethodCall(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E {
  const t = obj.t as LType & { k: "handle" };
  const h = handleOf(t, node);

  if (name === "close" || name === DISPOSE) {
    requireThread(em, node, t.name, h.affinity);
    return { c: cpp.call(cpp.dot(obj.c, "close")), t: T.undefined };
  }

  const m = h.methods.find((x) => x.name === name);
  if (!m) fail(node, Codes.UnsupportedCall, `${name} is not a method of ${t.name}`);

  return call(em, t.extension, m.fn, obj, node.arguments, node, `${t.name}.${name}`);
}

/** The call a `using` declaration makes when it disposes a handle. */
export function handleDispose(v: E): cpp.Expr {
  return cpp.call(cpp.dot(v.c, "close"));
}

function handleOf(t: LType & { k: "handle" }, node: ts.Node): HandleBinding {
  return (
    findHandle(t.extension, t.name) ??
    fail(node, Codes.UnsupportedType, `${t.name} is not a handle of lucent:ext/${t.extension}`)
  );
}

/** Main-thread handles and functions are used inside main(() => …), where the compiler can see it. */
function requireThread(em: FnEmitter, node: ts.Node, what: string, affinity: "any" | "main"): void {
  if (affinity !== "main" || inMainContext(em, node)) return;

  fail(
    node,
    Codes.MainThreadOnly,
    `${what} can only be used on the main thread: call it inside main(() => …) from lucent:thread`,
  );
}

/** The Lucent type of what Lucent code passes for a C parameter (none for lengths and errors). */
function lucentType(p: ParamBinding, extension: string): LType | undefined {
  switch (p.kind) {
    case "number":
      return T.number;
    case "bigint":
      return T.bigint;
    case "boolean":
      return T.boolean;
    case "handle":
      return { k: "handle", extension, name: p.handle };
    case "bytes":
      return T.bytes;
    case "string":
      return T.string;
    case "length":
    case "error":
      return undefined;
  }
}

/**
 * A call of `f`: `receiver` is the handle a method is called on, `args`
 * the rest of what Lucent passes, evaluated in order into temporaries.
 */
function call(
  em: FnEmitter,
  extension: string,
  f: FunctionBinding,
  receiver: E | undefined,
  args: ts.NodeArray<ts.Expression>,
  node: ts.Node,
  what: string,
): E {
  const ext = findExtension(extension)!;

  requireThread(em, node, handleName(f, receiver) ?? what, f.affinity);
  if (f.blocking && inMainContext(em, node))
    em.ctx.warn(
      node,
      Codes.BlockingOnMain,
      `${f.name} blocks: call it outside main(() => …), on the Lucent thread`,
    );

  // Include the header once per unit; binding checked it declares its functions extern "C".
  em.ctx.nativeUnit(em.opts.module).add(`extension ${ext.name}`, [cpp.include(ext.include)]);

  const visible = f.params
    .map((p, i) => ({ p, i, t: lucentType(p, extension) }))
    .filter((x): x is { p: ParamBinding; i: number; t: LType } => x.t !== undefined);
  const passed = receiver ? visible.slice(1) : visible;
  const given = em.args(
    args,
    passed.map((x) => x.t),
    node,
  );

  const stmts: cpp.Stmt[] = [];
  const temp = new Map<number, cpp.Expr>();
  const hold = (i: number, value: cpp.Expr) => {
    const name = em.ctx.fresh("x");
    stmts.push(cpp.varDecl(cpp.auto, name, value));
    temp.set(i, cpp.id(name));
  };

  if (receiver) hold(visible[0]!.i, receiver.c);
  passed.forEach((x, k) => hold(x.i, given[k]!));

  const error = f.params.find((p) => p.kind === "error");
  const e = cpp.id(em.ctx.fresh("error"));
  if (error)
    stmts.push(
      cpp.varDecl(cpp.type(`::${error.error.type}`), printed(e), undefined, { style: "brace" }),
    );

  // Converted before the call, in order: a conversion's error (a closed handle, a number out of
  // range) is Lucent's to throw. Inside the call, an exception escaping C ends the process.
  const cArgs = f.params.map((p, i): cpp.Expr => {
    const c = conversion(p, temp.get(i)!, temp, f, i);
    if (!c) return cpp.addressOf(e);

    const name = em.ctx.fresh("c");
    stmts.push(cpp.varDecl(cpp.auto, name, c.init));

    return c.arg(cpp.id(name));
  });

  const called = cpp.call(`::${f.name}`, cArgs);
  const returns = f.result.kind !== "void" || f.failsWhen !== undefined;
  const invoke = cpp.call("lucent::ext::call", [
    cpp.lambda(["&"], [], [returns ? cpp.ret(called) : cpp.exprStmt(called)]),
  ]);

  const r = cpp.id(em.ctx.fresh("result"));
  stmts.push(returns ? cpp.varDecl(cpp.auto, printed(r), invoke) : cpp.exprStmt(invoke));
  stmts.push(...afterCall(em, f, r, error, e));

  return { c: cpp.statementExpr(stmts, value(f, r, extension)), t: resultType(f, extension) };
}

const printed = (id: cpp.Expr) => cpp.printExpr(id);

/**
 * What a C parameter's Lucent value becomes before the call (`init`, held
 * in a temporary) and what the call is given (`arg` of that temporary);
 * none for the error struct, which the call is given by address.
 */
function conversion(
  p: ParamBinding,
  v: cpp.Expr,
  temp: Map<number, cpp.Expr>,
  f: FunctionBinding,
  i: number,
): { init: cpp.Expr; arg: (c: cpp.Expr) => cpp.Expr } | undefined {
  const at = cpp.str(p.name || `argument ${i + 1}`);
  const same = (c: cpp.Expr) => c;

  switch (p.kind) {
    case "number":
      return {
        init:
          p.c === "float" || p.c === "double"
            ? cpp.call(cpp.templateId("lucent::ext::real", [cpp.type(p.c)]), [v])
            : cpp.call(cpp.templateId("lucent::ext::integer", [cpp.type(p.c)]), [v, at]),
        arg: same,
      };
    case "bigint":
      return {
        init: cpp.call(cpp.templateId("lucent::ext::integer", [cpp.type(p.c)]), [v, at]),
        arg: same,
      };
    case "boolean":
      return { init: v, arg: same };
    case "handle":
      // Held until the statement ends: a close meanwhile waits for the call.
      return {
        init: cpp.call(cpp.dot(v, "use"), [], [cpp.type(`::${p.handle}`)]),
        arg: (c) => cpp.call(cpp.dot(c, "get")),
      };
    case "bytes":
      return {
        init: cpp.call("lucent::ext::data", [v]),
        arg: (c) => cpp.cast("reinterpret", cpp.type(p.c), c),
      };
    case "length":
      return {
        init: cpp.call(cpp.templateId("lucent::ext::length", [cpp.type(p.c)]), [
          cpp.call(cpp.dot(temp.get(p.of)!, "size")),
          cpp.str(f.params[p.of]!.name),
        ]),
        arg: same,
      };
    case "string":
      return {
        init: cpp.call("lucent::ext::utf8", [v, at]),
        arg: (c) => cpp.call(cpp.dot(c, "c_str")),
      };
    case "error":
      return undefined;
  }
}

/**
 * After the call: whether it failed; the error struct's message and code,
 * copied, then the struct released (after every call, when the package
 * names a release); then the failure thrown.
 */
function afterCall(
  em: FnEmitter,
  f: FunctionBinding,
  r: cpp.Expr,
  error: (ParamBinding & { kind: "error" }) | undefined,
  e: cpp.Expr,
): cpp.Stmt[] {
  const test = failedTest(f, r);
  const name = cpp.str(f.name);
  const release = error?.error.release
    ? [cpp.exprStmt(cpp.call(`::${error.error.release}`, [cpp.addressOf(e)]))]
    : [];

  if (!test) return release;

  // No error struct: the result is the code, when it is a number.
  if (!error) {
    const numeric = f.failsWhen === "negative" || f.failsWhen === "nonzero";
    const code = numeric ? [cpp.staticCast(cpp.type("long long"), r)] : [];

    return [
      cpp.ifStmt(test, [cpp.exprStmt(cpp.call("lucent::ext::fail", [name, cpp.nullptr, ...code]))]),
    ];
  }

  const failed = cpp.id(em.ctx.fresh("failed"));
  const message = cpp.id(em.ctx.fresh("message"));
  const code = cpp.id(em.ctx.fresh("code"));
  const field = cpp.dot(e, error.error.message);

  return [
    cpp.varDecl(cpp.type("bool"), printed(failed), test),
    cpp.varDecl(cpp.type("std::string"), printed(message)),
    ...(error.error.code ? [cpp.varDecl(cpp.type("long long"), printed(code), cpp.num(0))] : []),
    cpp.ifStmt(failed, [
      cpp.exprStmt(cpp.assign(message, cpp.conditional(field, field, cpp.str("")))),
      ...(error.error.code
        ? [
            cpp.exprStmt(
              cpp.assign(code, cpp.staticCast(cpp.type("long long"), cpp.dot(e, error.error.code))),
            ),
          ]
        : []),
    ]),
    ...release,
    cpp.ifStmt(failed, [
      cpp.exprStmt(
        cpp.call("lucent::ext::fail", [
          name,
          cpp.call(cpp.dot(message, "c_str")),
          ...(error.error.code ? [code] : []),
        ]),
      ),
    ]),
  ];
}

const handleName = (f: FunctionBinding, receiver: E | undefined) =>
  receiver && receiver.t.k === "handle"
    ? receiver.t.name
    : f.params.find((p) => p.kind === "handle")?.name;

/** The C condition that says the call failed, from its result. */
function failedTest(f: FunctionBinding, r: cpp.Expr): cpp.Expr | undefined {
  switch (f.failsWhen) {
    case undefined:
      return undefined;
    case "null":
    case "false":
      return cpp.not(r);
    case "negative":
      return cpp.binary(r, "<", cpp.num(0));
    case "nonzero":
      return cpp.binary(r, "!=", cpp.num(0));
    case "zero":
      return cpp.binary(r, "==", cpp.num(0));
  }
}

/** The call's value in Lucent. */
function value(f: FunctionBinding, r: cpp.Expr, extension: string): cpp.Expr {
  const res = f.result;

  switch (res.kind) {
    case "void":
      return cpp.id("lucent::undefined");
    case "number":
      return res.c === "float" || res.c === "double"
        ? cpp.staticCast(cpp.type("double"), r)
        : cpp.call("lucent::ext::number", [r]);
    case "bigint":
      return cpp.call("lucent::ext::bigint", [r]);
    case "boolean":
      return cpp.staticCast(cpp.type("bool"), r);
    case "handle": {
      const h = findHandle(extension, res.handle)!;
      const p = cpp.id("p_");
      const destroy = cpp.lambda(
        [],
        [cpp.param(cpp.pointer(cpp.voidType), "p_")],
        [
          cpp.exprStmt(
            cpp.call(`::${h.destroy}`, [cpp.staticCast(cpp.pointer(cpp.type(`::${h.name}`)), p)]),
          ),
        ],
      );
      const on =
        h.affinity === "main" ? [cpp.addressOf(cpp.call("lucent::ExecutionContext::main"))] : [];

      return cpp.call("lucent::Handle::open", [cpp.str(h.name), r, destroy, ...on]);
    }
  }
}

function resultType(f: FunctionBinding, extension: string): LType {
  const res = f.result;

  switch (res.kind) {
    case "void":
      return T.undefined;
    case "number":
      return T.number;
    case "bigint":
      return T.bigint;
    case "boolean":
      return T.boolean;
    case "handle":
      return { k: "handle", extension, name: res.handle };
  }
}
