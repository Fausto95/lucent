/**
 * lucent:core's EventEmitter and EventSubscription (lucent/events.h). An
 * emitter's C++ type lists its events' listener types in declaration
 * order, and code names an event by its index there: the event's name, a
 * string literal, is known here. The instance keeps the names, for
 * JavaScript's calls.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { type LType, T, typeKey } from "../types.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import { inExecutorCode } from "../analysis/index.ts";
import { factsOf, requireTransports } from "./compute.ts";

type Emitter = LType & { k: "emitter" };

/** `new EventEmitter<Events>()`: an emitter that knows its events' names. */
export function emitterNew(em: FnEmitter, node: ts.NewExpression, t: Emitter): E {
  if (node.arguments?.length)
    fail(node, Codes.UnsupportedBuiltin, "new EventEmitter() takes no arguments");

  return {
    c: cpp.call(cpp.scoped(em.reg.cppEmitterType(t), "create"), [
      cpp.initList(t.events.map((e) => cpp.str(e.name))),
    ]),
    t,
  };
}

/** The event a call's argument `i` names: a string literal, or a constant of one string literal type. */
function eventAt(em: FnEmitter, t: Emitter, node: ts.CallExpression, i: number) {
  const a = node.arguments[i];
  const type = a && em.checker.getTypeAtLocation(a);
  const name = type?.isStringLiteral() ? type.value : undefined;

  if (!a || name === undefined)
    fail(
      a ?? node,
      Codes.UnsupportedCall,
      "an event's name is a string literal here: JavaScript may name it with any string",
    );

  const index = t.events.findIndex((e) => e.name === name);
  if (index < 0) fail(a, Codes.UnsupportedCall, `the emitter has no event ${name}`);

  return { index, event: t.events[index]! };
}

const done = (c: cpp.Expr): E => ({ c, t: T.undefined });

/**
 * An emit on an executor: its arguments copied, as a channel's sends are,
 * in order, then emitted in a turn of the emitter's module (its actor),
 * where its listeners run. The executor waits for none of it.
 */
function postedEmit(
  em: FnEmitter,
  node: ts.CallExpression,
  emitter: cpp.Expr,
  index: number,
  name: string,
  params: readonly LType[],
  args: readonly cpp.Expr[],
): cpp.Expr {
  params.forEach((p, i) =>
    requireTransports(em, p, `${name}'s argument ${i + 1}`, (path, part) =>
      fail(
        node.arguments[i + 1] ?? node,
        Codes.NotOnExecutor,
        `an event emitted on an executor is copied to its emitter's module: \`${path}\` is a ${typeKey(part)}, which the compiler cannot copy yet`,
      ),
    ),
  );
  em.ctx.nativeUnit(em.opts.module).include("lucent/transport.h");

  const names = args.map((_, i) => `ea${i}_`);
  const copies = args.map((a, i) =>
    cpp.varDecl(cpp.auto, names[i]!, cpp.call("lucent::transportCopy", [a])),
  );
  const emit = cpp.lambda(
    [
      { name: "e_", init: cpp.id("e_") },
      ...names.map((n) => ({ name: n, init: cpp.call("std::move", [cpp.id(n)]) })),
    ],
    [],
    [
      cpp.exprStmt(
        cpp.call(
          cpp.arrow(cpp.id("e_"), "emit"),
          names.map((n) => cpp.call("std::move", [cpp.id(n)])),
          [cpp.num(index)],
        ),
      ),
    ],
    { mutable: true },
  );
  return cpp.statementExpr(
    [cpp.varDecl(cpp.auto, "e_", emitter), ...copies],
    cpp.call("lucent::postCallback", [cpp.call(cpp.arrow(cpp.id("e_"), "actor")), emit]),
  );
}

export function emitterMethod(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E {
  const t = obj.t as Emitter;
  const o = obj.c;
  // On an executor, an emitter's listeners are its module's: code there only emits, posting to it.
  const onExecutor = inExecutorCode(em.checker, node, factsOf(em.ctx).executorClasses());
  if (onExecutor && name !== "emit")
    fail(
      node,
      Codes.NotOnExecutor,
      `code on an executor only emits on an emitter: its listeners belong to the emitter's module, so ${name}() runs there, not here`,
    );

  switch (name) {
    case "addListener": {
      const { index, event } = eventAt(em, t, node, 0);
      const listener = node.arguments[1];
      if (!listener || node.arguments.length > 2)
        fail(node, Codes.UnsupportedCall, "addListener takes an event's name and its listener");

      return {
        c: cpp.call(cpp.arrow(o, "addListener"), [em.exprAs(listener, event.fn)], [cpp.num(index)]),
        t: T.subscription,
      };
    }
    case "emit": {
      const { index, event } = eventAt(em, t, node, 0);
      const given = node.arguments.slice(1);
      const params = event.fn.params;
      if (given.some(ts.isSpreadElement))
        fail(node, Codes.UnsupportedCall, "emit takes its arguments one by one, without a spread");
      if (given.length > params.length)
        fail(
          node,
          Codes.UnsupportedCall,
          `the event ${event.name} takes ${params.length} arguments`,
        );

      const args = params.map((p, i) => {
        const a = given[i];
        if (a) return em.exprAs(a, p);
        // A listener's optional parameter the emit leaves out is undefined.
        if (p.k === "opt") return cpp.construct(em.reg.cppType(p), [cpp.id("lucent::undefined")]);

        return fail(
          node,
          Codes.UnsupportedCall,
          `the event ${event.name} takes ${params.length} arguments`,
        );
      });

      if (onExecutor) return done(postedEmit(em, node, o, index, event.name, params, args));
      return done(cpp.call(cpp.arrow(o, "emit"), args, [cpp.num(index)]));
    }
    case "listenerCount": {
      const { index } = eventAt(em, t, node, 0);

      return { c: cpp.call(cpp.arrow(o, "listenerCount"), [cpp.num(index)]), t: T.number };
    }
    case "onObserved": {
      const { index } = eventAt(em, t, node, 0);
      const observer = node.arguments[1];
      if (!observer || node.arguments.length > 2)
        fail(node, Codes.UnsupportedCall, "onObserved takes an event's name and its observer");
      const fn: LType = { k: "fn", params: [T.boolean], ret: T.void };

      return {
        c: cpp.call(cpp.arrow(o, "onObserved"), [cpp.num(index), em.exprAs(observer, fn)]),
        t: T.subscription,
      };
    }
    case "removeAllListeners": {
      if (!node.arguments.length) return done(cpp.call(cpp.arrow(o, "removeAllListeners")));
      const { index } = eventAt(em, t, node, 0);

      return done(cpp.call(cpp.arrow(o, "removeAllListeners"), [cpp.num(index)]));
    }
  }

  return fail(node, Codes.UnsupportedBuiltin, `EventEmitter.prototype.${name} is not supported`);
}

export function subscriptionMethod(obj: E, name: string, node: ts.CallExpression): E {
  if (name !== "remove" || node.arguments.length)
    fail(node, Codes.UnsupportedBuiltin, `EventSubscription.prototype.${name} is not supported`);

  return done(cpp.call(cpp.arrow(obj.c, "remove")));
}
