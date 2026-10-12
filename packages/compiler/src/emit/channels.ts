/**
 * lucent:core's Channel (lucent/channel.h): values from a producer to a
 * consumer that may run on another thread. A send copies its value as a
 * compute task's input is copied (a NativeBuffer moves), so the element
 * type must be data the runtime can copy: the program analyses check it
 * where the channel is made, and each send declares the copies of the
 * structs and classes it holds in its unit (requireTransports).
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { cppIdent, type LType, T, typeKey, unionOf } from "../types.ts";
import { factsOf, requireTransports } from "./compute.ts";
import type { E } from "./context.ts";
import type { FnEmitter } from "./function.ts";

type ChannelT = LType & { k: "channel" };

const bool = (c: cpp.Expr): E => ({ c, t: T.boolean });

/** Refuses a channel whose values the runtime cannot copy to its consumer. */
function requireData(em: FnEmitter, node: ts.NewExpression): void {
  const type = em.checker.getTypeAtLocation(node);
  const [element] = (type as ts.TypeReference).target
    ? em.checker.getTypeArguments(type as ts.TypeReference)
    : [];
  const problem = element && factsOf(em.ctx).transfer(element, "value");

  if (problem)
    fail(
      node,
      Codes.NotTransferable,
      `a channel's values are copied to its consumer: \`${problem.path}\` is ${problem.reason}.`,
    );
}

/** `new Channel<T>(policy, capacity?)`: under the scope the calling code's work belongs to. */
export function channelNew(em: FnEmitter, node: ts.NewExpression, t: ChannelT): E {
  const [policy, capacity, ...rest] = node.arguments ?? [];

  if (!policy || rest.length)
    fail(node, Codes.UnsupportedBuiltin, "new Channel() takes its policy, and maybe its capacity");

  requireData(em, node);

  const optionalNumber = unionOf([T.number, T.undefined]);
  const size = capacity
    ? em.exprAs(capacity, optionalNumber)
    : cpp.construct(em.reg.cppType(optionalNumber), [cpp.id("lucent::undefined")]);

  return {
    c: cpp.call("lucent::makeChannel", [em.exprAs(policy, T.string), size], [em.reg.cppType(t.e)]),
    t,
  };
}

export function channelMethod(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E {
  const t = obj.t as ChannelT;
  const o = obj.c;
  const a = node.arguments;

  switch (name) {
    case "send": {
      if (a.length !== 1) fail(node, Codes.UnsupportedCall, "send takes the value to send");

      requireTransports(em, t.e, "value", (path, part) =>
        fail(
          node,
          Codes.NotTransferable,
          `a channel's values are copied to its consumer: \`${path}\` is a ${typeKey(part)}, which the compiler cannot copy yet.`,
        ),
      );
      return bool(cpp.call(cpp.arrow(o, "sendCopy"), [em.exprAs(a[0]!, t.e)]));
    }
    case "receive":
      if (a.length) fail(node, Codes.UnsupportedCall, "receive takes no arguments");

      return {
        c: cpp.call(cpp.arrow(o, "receive")),
        t: { k: "promise", inner: unionOf([t.e, T.undefined]) },
      };
    case "subscribe": {
      if (a.length !== 1) fail(node, Codes.UnsupportedCall, "subscribe takes the function to call");
      const onValue: LType = { k: "fn", params: [t.e], ret: T.void };

      return {
        c: cpp.call(cpp.arrow(o, "subscribe"), [em.exprAs(a[0]!, onValue)]),
        t: T.subscription,
      };
    }
    case "close":
      if (a.length) fail(node, Codes.UnsupportedCall, "close takes no arguments");

      return bool(cpp.call(cpp.arrow(o, "close")));
    case "stats":
      return channelStats(em, o, node);
  }

  return fail(node, Codes.UnsupportedBuiltin, `Channel.prototype.${name} is not supported`);
}

/** `channel.stats()`: the runtime's counts, as lucent:core's ChannelStats. */
function channelStats(em: FnEmitter, o: cpp.Expr, node: ts.CallExpression): E {
  const t = em.lt(node);

  if (t.k !== "struct") throw new Error("Channel.stats() is not a struct");

  const info = em.reg.struct(t.id);
  const countsName = em.ctx.fresh("counts");
  const counts = cpp.id(countsName);
  const stats = em.ctx.fresh("stats");
  const created = cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]);
  const fields = info.fields.map((f) =>
    cpp.exprStmt(
      cpp.assign(
        cpp.arrow(cpp.id(stats), cppIdent(f.name)),
        cpp.staticCast(cpp.type("double"), cpp.dot(counts, f.name)),
      ),
    ),
  );

  return {
    c: cpp.statementExpr(
      [
        cpp.varDecl(cpp.auto, countsName, cpp.call(cpp.arrow(o, "stats"))),
        cpp.varDecl(cpp.auto, stats, created),
        ...fields,
      ],
      cpp.id(stats),
    ),
    t,
  };
}

export function channelProperty(obj: E, name: string, node: ts.Node): E {
  if (name !== "closed")
    fail(node, Codes.UnsupportedBuiltin, `Channel.prototype.${name} is not supported`);

  return bool(cpp.call(cpp.arrow(obj.c, "closed")));
}
