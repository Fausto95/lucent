/**
 * Calls into a C++ extension's classes (decision 0125), from any unit, as
 * a C extension's calls are: each argument converted and checked into a
 * temporary first, in order, then the constructor or member function
 * called inside `lucent::ext::cxxCall`, which turns what C++ throws into
 * an Error, and the result converted back. A class's objects are
 * lucent::Handle, which delete them once.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import type { ClassBinding, CxxCallBinding, CxxValue } from "../extensions/bind-cxx.ts";
import { findClass, findExtension } from "../extensions/registry.ts";
import { type LType, T } from "../types.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import { DISPOSE } from "./classes.ts";
import { SIGNAL } from "./extensions.ts";
import { inMainContext } from "./native.ts";

/** The Lucent type of a value crossing to or from C++. */
function lucentType(v: CxxValue, extension: string): LType {
  switch (v.kind) {
    case "number":
    case "enum":
      return T.number;
    case "bigint":
      return T.bigint;
    case "boolean":
      return T.boolean;
    case "string":
      return T.string;
    case "array":
      return { k: "array", e: lucentType(v.of, extension) };
    case "optional":
      return { k: "opt", inner: lucentType(v.of, extension), absent: "undefined" };
    case "object":
      return { k: "handle", extension, name: v.class };
    case "callback":
      return {
        k: "fn",
        params: v.params.map((p) => lucentType(p, extension)),
        ret: v.result ? lucentType(v.result, extension) : T.void,
      };
    case "signal":
      return SIGNAL;
  }
}

/** `new Counter(…)`: the overload TypeScript resolved. */
export function cxxNew(
  em: FnEmitter,
  node: ts.NewExpression,
  c: ClassBinding,
  extension: string,
): E {
  const k = c.constructors[overloadIndex(em, node, (d) => ts.isConstructorDeclaration(d))];
  if (!k) fail(node, Codes.UnsupportedCall, `new ${c.name}(…) has no binding`);

  return call(
    em,
    extension,
    c,
    k,
    undefined,
    node.arguments ?? ts.factory.createNodeArray(),
    node,
    `new ${c.name}`,
    constructs,
  );
}

/** A constructor's call: a new object of its class, which the handle owns. */
const constructs = (args: cpp.Expr[], _self: cpp.Expr | undefined, c: ClassBinding): cpp.Expr =>
  cpp.newExpr(cpp.type(`::${c.qualified}`), args);

/** `counter.add(…)`, `counter.close()`: an object's method, or the handle's own. */
export function cxxMethodCall(
  em: FnEmitter,
  obj: E,
  name: string,
  node: ts.CallExpression,
  c: ClassBinding,
  extension: string,
): E {
  if (name === "close" || name === DISPOSE) {
    requireThread(em, node, c.name, c.affinity);
    return { c: cpp.call(cpp.dot(obj.c, "close")), t: T.undefined };
  }

  const m = c.methods.find((x) => x.name === name && !x.static);
  if (!m) fail(node, Codes.UnsupportedCall, `${name} is not a method of ${c.name}`);

  const o = m.overloads[overloadIndex(em, node, (d) => isMethod(d, name, false))]!;
  return call(em, extension, c, o, obj, node.arguments, node, `${c.name}.${name}`, (args, self) =>
    cpp.call(cpp.arrow(self!, name), args),
  );
}

/** `Counter.live()`: a static member function. */
export function cxxStaticCall(
  em: FnEmitter,
  node: ts.CallExpression,
  name: string,
  c: ClassBinding,
  extension: string,
): E {
  const m = c.methods.find((x) => x.name === name && x.static);
  if (!m) fail(node, Codes.UnsupportedCall, `${name} is not a static method of ${c.name}`);

  const o = m.overloads[overloadIndex(em, node, (d) => isMethod(d, name, true))]!;
  return call(em, extension, c, o, undefined, node.arguments, node, `${c.name}.${name}`, (args) =>
    cpp.call(`::${c.qualified}::${name}`, args),
  );
}

const isMethod = (d: ts.Declaration, name: string, isStatic: boolean) =>
  ts.isMethodDeclaration(d) &&
  ts.isIdentifier(d.name) &&
  d.name.text === name &&
  !!ts.getModifiers(d)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) === isStatic;

/**
 * Which overload a call is: its resolved declaration's place among the
 * class's declarations of it, which the declarations write in the
 * binding's order (extensions/dts.ts).
 */
function overloadIndex(
  em: FnEmitter,
  node: ts.CallLikeExpression,
  same: (d: ts.Declaration) => boolean,
): number {
  const decl = em.checker.getResolvedSignature(node)?.declaration;
  const cls = decl?.parent;
  if (!decl || !cls || !ts.isClassDeclaration(cls)) return 0;

  return cls.members.filter(same).indexOf(decl as ts.ClassElement);
}

/** Main-thread classes are used inside main(() => …), where the compiler can see it. */
function requireThread(em: FnEmitter, node: ts.Node, what: string, affinity: "any" | "main"): void {
  if (affinity !== "main" || inMainContext(em, node)) return;

  fail(
    node,
    Codes.MainThreadOnly,
    `${what} can only be used on the main thread: call it inside main(() => …) from lucent:thread`,
  );
}

/**
 * A call of overload `o`: `receiver` is the object a method is called on;
 * `made(args, self)` is the C++ call, given the converted arguments and
 * the receiver's object.
 */
function call(
  em: FnEmitter,
  extension: string,
  c: ClassBinding,
  o: CxxCallBinding,
  receiver: E | undefined,
  args: ts.NodeArray<ts.Expression>,
  node: ts.Node,
  what: string,
  made: (args: cpp.Expr[], self: cpp.Expr | undefined, c: ClassBinding) => cpp.Expr,
): E {
  const ext = findExtension(extension)!;
  requireThread(em, node, c.name, c.affinity);

  em.ctx.nativeUnit(em.opts.module).add(`extension ${ext.name}`, [cpp.include(ext.include)]);

  const given = em.args(
    args,
    o.params.map((p) => lucentType(p.value, extension)),
    node,
  );

  const stmts: cpp.Stmt[] = [];
  const hold = (value: cpp.Expr): cpp.Expr => {
    const name = em.ctx.fresh("x");
    stmts.push(cpp.varDecl(cpp.auto, name, value));
    return cpp.id(name);
  };

  // The receiver, held for the call: a close meanwhile waits for it.
  const self = receiver
    ? hold(cpp.call(cpp.dot(hold(receiver.c), "use"), [], [cpp.type(`::${c.qualified}`)]))
    : undefined;

  // Converted before the call, in order: a conversion's error is Lucent's to throw. A
  // callback is held for the call, and C++ is given the std::function its parameter is,
  // each copy of which keeps it (decisions 0126 and 0128).
  const values = given.map((g) => hold(g));
  const guards: cpp.Expr[] = [];
  let signal: cpp.Expr | undefined;
  const cArgs = o.params.map((p, i) => {
    // The flag C++ reads: a signal aborted already throws here, and no call is made.
    if (p.value.kind === "signal") {
      signal = hold(cpp.construct(cpp.type("lucent::ext::SignalFlag"), [values[i]!]));
      return cpp.call(cpp.dot(signal, "cxx"));
    }
    if (p.value.kind === "callback") {
      const guard = hold(
        cpp.construct(
          cpp.type("lucent::ext::Callback", em.reg.cppType(lucentType(p.value, extension))),
          [cpp.str(`${what}'s ${p.name}`), cpp.id("lucent::ext::Lives::Copies"), values[i]!],
        ),
      );
      guards.push(guard);
      return cpp.call(cpp.dot(guard, "function"));
    }

    const arg = toCxx(p.value, values[i]!, p.name);
    const temp = hold(arg.init);
    return arg.pass(temp);
  });
  const done = guards.map((g) => cpp.exprStmt(cpp.call(cpp.dot(g, "done"))));

  // An object by value is moved into one of its own inside the call, which may throw too.
  const result = o.result;
  const direct = made(cArgs, self ? cpp.call(cpp.dot(self, "get")) : undefined, c);
  const called =
    result?.kind === "object" ? cpp.newExpr(cpp.type(`::${result.cxx}`), [direct]) : direct;
  const isNew = made === constructs;
  const returns = isNew || o.result !== undefined;
  // With a signal, an abort during the call comes instead of what it threw or returned.
  const invoke = cpp.call("lucent::ext::cxxCall", [
    cpp.str(what),
    ...(signal ? [signal] : []),
    cpp.lambda(["&"], [], [returns ? cpp.ret(called) : cpp.exprStmt(called)]),
  ]);

  if (!returns) {
    stmts.push(cpp.exprStmt(invoke), ...done);
    return { c: cpp.statementExpr(stmts, cpp.id("lucent::undefined")), t: T.undefined };
  }

  const r = cpp.id(em.ctx.fresh("result"));
  stmts.push(cpp.varDecl(cpp.auto, cpp.printExpr(r), invoke), ...done);

  if (isNew)
    return {
      c: cpp.statementExpr(stmts, opened(c, r)),
      t: { k: "handle", extension, name: c.name },
    };

  return {
    c: cpp.statementExpr(stmts, fromCxx(o.result!, r, extension)),
    t: lucentType(o.result!, extension),
  };
}

/** A handle owning `pointer`, an object of `c` it deletes once. */
function opened(c: ClassBinding, pointer: cpp.Expr): cpp.Expr {
  const destroy = cpp.addressOf(
    cpp.templateId("lucent::ext::deleteObject", [cpp.type(`::${c.qualified}`)]),
  );
  const on =
    c.affinity === "main" ? [cpp.addressOf(cpp.call("lucent::ExecutionContext::main"))] : [];

  return cpp.call("lucent::Handle::open", [cpp.str(c.name), pointer, destroy, ...on]);
}

/**
 * What a Lucent value `v` becomes for C++ (`init`, held in a temporary),
 * and what the call is given of that temporary (`pass`).
 */
function toCxx(
  t: CxxValue,
  v: cpp.Expr,
  name: string,
): { init: cpp.Expr; pass: (temp: cpp.Expr) => cpp.Expr } {
  const same = (x: cpp.Expr) => x;
  const at = cpp.str(name);

  switch (t.kind) {
    case "object": {
      // Held for the call; a reference is to its object, a pointer is it.
      const pointer = t.by === "pointer" || t.by === "constPointer";
      return {
        init: cpp.call(cpp.dot(v, "use"), [], [cpp.type(`::${t.cxx}`)]),
        pass: (u) =>
          pointer ? cpp.call(cpp.dot(u, "get")) : cpp.deref(cpp.call(cpp.dot(u, "get"))),
      };
    }
    case "string":
      // A const char * is NUL-terminated: a NUL inside is a TypeError, as for a C function.
      return t.of === "chars"
        ? {
            init: cpp.call("lucent::ext::utf8", [v, at]),
            pass: (u) => cpp.call(cpp.dot(u, "c_str")),
          }
        : { init: cpp.call("lucent::ext::cxxString", [v]), pass: same };
    default:
      return { init: value(t, v, name), pass: same };
  }
}

/** A Lucent value as the C++ value of `t` (a vector's or an optional's element too). */
function value(t: CxxValue, v: cpp.Expr, name: string): cpp.Expr {
  const at = cpp.str(name);
  const each = (of: CxxValue) =>
    cpp.lambda(
      ["&"],
      [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "x")],
      [cpp.ret(value(of, cpp.id("x"), `${name}[]`))],
    );

  switch (t.kind) {
    case "number":
      return t.c === "float" || t.c === "double"
        ? cpp.call(cpp.templateId("lucent::ext::real", [cpp.type(t.c)]), [v])
        : cpp.call(cpp.templateId("lucent::ext::integer", [cpp.type(t.c)]), [v, at]);
    case "bigint":
      return cpp.call(cpp.templateId("lucent::ext::integer", [cpp.type(t.c)]), [v, at]);
    case "boolean":
      return v;
    case "string":
      return cpp.call("lucent::ext::cxxString", [v]);
    case "enum":
      return cpp.staticCast(
        cpp.type(`::${t.cxx}`),
        cpp.call(cpp.templateId("lucent::ext::integer", [cpp.type("long long")]), [v, at]),
      );
    case "array":
      return cpp.call(cpp.templateId("lucent::ext::cxxVector", [cpp.type(t.c)]), [v, each(t.of)]);
    case "optional":
      return cpp.call(cpp.templateId("lucent::ext::cxxOptional", [cpp.type(t.c)]), [v, each(t.of)]);
    case "object":
      throw new Error("an object crosses into C++ by reference only");
    case "callback":
      throw new Error("a callback crosses into C++ as its guard's function()");
    case "signal":
      throw new Error("a signal crosses into C++ as its flag");
  }
}

/** A C++ result `r` of `t` as Lucent's value. */
function fromCxx(t: CxxValue, r: cpp.Expr, extension: string): cpp.Expr {
  const each = (of: CxxValue) =>
    cpp.lambda(
      ["&"],
      [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "x")],
      [cpp.ret(fromCxx(of, cpp.id("x"), extension))],
    );

  switch (t.kind) {
    case "number":
      return t.c === "float" || t.c === "double"
        ? cpp.staticCast(cpp.type("double"), r)
        : cpp.call("lucent::ext::number", [r]);
    case "bigint":
      return cpp.call("lucent::ext::bigint", [r]);
    case "boolean":
      return cpp.staticCast(cpp.type("bool"), r);
    case "string":
      return cpp.call("lucent::ext::fromCxx", [r]);
    case "enum":
      return cpp.staticCast(cpp.type("double"), cpp.staticCast(cpp.type("long long"), r));
    case "array":
      return cpp.call("lucent::ext::fromCxxVector", [r, each(t.of)]);
    case "optional":
      return cpp.call("lucent::ext::fromCxxOptional", [r, each(t.of)]);
    // Made inside the call (see `call`): the handle owns it.
    case "object":
      return opened(findClass(extension, t.class)!, r);
    case "callback":
    case "signal":
      throw new Error(`a ${t.kind} is a parameter only`);
  }
}
