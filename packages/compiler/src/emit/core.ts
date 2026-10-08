import { cpp } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { coreTypesPath } from "../program.ts";
import { isVoidish, type LType, T, typeKey, unionOf } from "../types.ts";
import { withSite } from "./builtins.ts";
import type { E } from "./context.ts";
import { computeCall } from "./compute.ts";
import type { FnEmitter } from "./function.ts";

/** How a call of one lucent:core helper lowers. */
type CoreHelper = (em: FnEmitter, node: ts.CallExpression) => E;

type FnT = LType & { k: "fn" };
const fn = (params: LType[], ret: LType): FnT => ({ k: "fn", params, ret });

/** Whether `sym` is declared by lucent:core. */
export function isCoreSymbol(sym: ts.Symbol): boolean {
  const decl = sym.declarations?.[0];

  return !!decl && path.resolve(decl.getSourceFile().fileName) === path.resolve(coreTypesPath());
}

/** A call of the lucent:core helper `name` (its declared name, whatever it was imported as). */
export function coreCall(em: FnEmitter, node: ts.CallExpression, name: string): E {
  const helper = Object.hasOwn(CORE, name) ? CORE[name] : undefined;

  if (!helper)
    fail(node, Codes.UnsupportedBuiltin, `lucent:core ${name} is not implemented natively`);

  return helper(em, node);
}

function argAs(em: FnEmitter, node: ts.CallExpression, i: number, t: LType): cpp.Expr {
  const a = node.arguments[i];

  if (!a) fail(node, Codes.UnsupportedCall, `missing argument ${i + 1}`);

  return em.exprAs(a, t);
}

/** The argument at `i`, when the call gives it. */
function optionalArg(em: FnEmitter, node: ts.CallExpression, i: number, t: LType): cpp.Expr[] {
  return node.arguments[i] ? [argAs(em, node, i, t)] : [];
}

/** The function argument at `i`. */
function functionArg(em: FnEmitter, node: ts.CallExpression, i: number, target: FnT): E {
  const a = node.arguments[i];

  if (!a) fail(node, Codes.UnsupportedCall, `missing argument ${i + 1}`);

  return ts.isArrowFunction(a) || ts.isFunctionExpression(a) ? em.closure(a, target) : em.expr(a);
}

/** The function argument at `i`, as a Fn of exactly `target`'s type. */
function callbackArg(em: FnEmitter, node: ts.CallExpression, i: number, target: FnT): cpp.Expr {
  return em.coerce(functionArg(em, node, i, target), target, node.arguments[i]);
}

/**
 * The registration: a Fn taking what it is handed (`params`) and returning
 * its cleanup as it declares it (a function, maybe absent, or nothing),
 * which the runtime tells apart.
 */
function registrationArg(em: FnEmitter, node: ts.CallExpression, params: LType[]): cpp.Expr {
  const register = functionArg(em, node, 0, fn(params, T.void));
  const returned = register.t.k === "fn" ? register.t.ret : T.never;
  const cleanup = returned.k === "opt" ? returned.inner : returned;

  if (!isVoidish(returned) && !(cleanup.k === "fn" && cleanup.params.length === 0))
    fail(
      node.arguments[0],
      Codes.UnsupportedCall,
      `a registration returns its cleanup (a function taking no arguments) or nothing, not ${typeKey(returned)}`,
    );

  return em.coerce(register, fn(params, returned), node.arguments[0]);
}

const optionalSignal = unionOf([T.abortSignal, T.undefined]);

const reject = fn([T.error], T.void);

/** What reports a value: it takes none when the value is void. */
const reporter = (value: LType): FnT => fn(value.k === "void" ? [] : [value], T.void);

/**
 * The value a composition reports (`T` of fromCallback and subscribe): the
 * parameter of the first function its registration is handed.
 */
function reportedValue(em: FnEmitter, node: ts.CallExpression): LType {
  const c = em.checker;
  const param = (sig: ts.Signature | undefined) => {
    const p = sig?.getParameters()[0];
    return p && c.getTypeOfSymbolAtLocation(p, node);
  };

  const register = param(c.getResolvedSignature(node));
  const report = param(register?.getCallSignatures()[0]);
  const value = param(report?.getCallSignatures()[0]);

  if (!value) fail(node, Codes.UnsupportedCall, "cannot tell what the registration reports");

  const t = em.reg.lower(value, node);

  if (t.k === "promise")
    fail(
      node,
      Codes.UnsupportedCall,
      "a callback reports a value, not a promise: await the promise and report its value",
    );

  return t;
}

const CORE: Record<string, CoreHelper> = {
  compute: computeCall,

  delay: (em, node) => ({
    c: cpp.call("lucent::delay", [
      argAs(em, node, 0, T.number),
      ...optionalArg(em, node, 1, optionalSignal),
    ]),
    t: { k: "promise", inner: T.void },
  }),

  error: (em, node) => ({
    c: withSite(
      cpp.call("lucent::errorWithCode", [
        argAs(em, node, 0, T.string),
        argAs(em, node, 1, T.string),
      ]),
      node,
    ),
    t: T.error,
  }),

  errorCode: (em, node) => ({
    c: cpp.arrow(argAs(em, node, 0, T.error), "code"),
    t: unionOf([T.string, T.undefined]),
  }),

  utf8Encode: (em, node) => ({
    c: cpp.call("lucent::utf8Encode", [argAs(em, node, 0, T.string)]),
    t: T.bytes,
  }),

  utf8Decode: (em, node) => ({
    c: cpp.call("lucent::utf8Decode", [argAs(em, node, 0, T.bytes)]),
    t: T.string,
  }),

  now: () => ({ c: cpp.call("lucent::monotonicNow"), t: T.number }),

  onDestroy: (em, node) => ({
    c: cpp.call("lucent::onDestroy", [argAs(em, node, 0, fn([], T.void))]),
    t: fn([], T.void),
  }),

  fromCallback: (em, node) => {
    const value = reportedValue(em, node);
    const register = registrationArg(em, node, [reporter(value), reject]);

    return {
      c: cpp.call(
        "lucent::fromCallback",
        [register, ...optionalArg(em, node, 1, optionalSignal)],
        [em.reg.cppRetType(value)],
      ),
      t: em.lt(node),
    };
  },

  subscribe: (em, node) => {
    const next = reporter(reportedValue(em, node));
    const register = registrationArg(em, node, [next, fn([], T.void), reject]);
    const onValue = callbackArg(em, node, 1, next);

    return {
      c: cpp.call("lucent::subscribe", [
        register,
        onValue,
        ...optionalArg(em, node, 2, optionalSignal),
      ]),
      t: em.lt(node),
    };
  },
};
