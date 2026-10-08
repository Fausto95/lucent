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
import { type LType, T } from "../types.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";

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

export function emitterMethod(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E {
  const t = obj.t as Emitter;
  const o = obj.c;

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

      return done(cpp.call(cpp.arrow(o, "emit"), args, [cpp.num(index)]));
    }
    case "listenerCount": {
      const { index } = eventAt(em, t, node, 0);

      return { c: cpp.call(cpp.arrow(o, "listenerCount"), [cpp.num(index)]), t: T.number };
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
