/**
 * The leaves of the semantic IR (ir/lower.ts): expressions the IR does not
 * model itself, planned by the emitter's code for them. A leaf's
 * subexpressions are operands the IR lowers first, in evaluation order;
 * here they are names (ir/cpp.ts `operand`), so the planned code runs no
 * code of the program's own and decides no order.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { isInside } from "../analysis/scopes.ts";
import { Codes } from "../diagnostics.ts";
import { intOperand, operand } from "../ir/cpp.ts";
import type { ValueId } from "../ir/ir.ts";
import {
  IrUnsupported,
  type Leaf,
  type LeafHost,
  type LeafOperands,
  type LeafPlace,
  type Thunk,
} from "../ir/lower.ts";
import { numberExpr, stringExpr } from "../lowering/literals.ts";
import { type LType, stripOpt, T, typeKey, unionOf } from "../types.ts";
import { disposeCall, methodCall, structKeys } from "./builtins.ts";
import { safepoint } from "./compute.ts";
import type { Ctx, E } from "./context.ts";
import { type FnOptions, FnEmitter, type Local } from "./function.ts";
import { isEventCall } from "./setups.ts";

/** The emitter of one leaf: its subexpressions are the IR's operands. */
class LeafEmitter extends FnEmitter {
  private readonly root: ts.Node;
  private readonly operands: LeafOperands;

  constructor(ctx: Ctx, opts: FnOptions, root: ts.Node, operands: LeafOperands) {
    super(ctx, opts);
    this.root = root;
    this.operands = operands;
  }

  override expr(node: ts.Expression, hint?: LType): E {
    // The leaf itself, or what it reads from elsewhere (a constant's literal), is the emitter's;
    // but a local read anywhere (an action a component's body takes) is the IR's.
    if (node === this.root || (!isInside(node, this.root) && !this.readsLocal(node)))
      return super.expr(node, hint);

    const v = this.operands.operand(node, hint);
    const int = this.operands.intOf(v);

    // An exact integer has its integer register form too (integers.ts), which code like Math.imul's uses.
    return {
      c: operand(v),
      t: this.operands.typeOf(v),
      ...(int ? { int: { c: intOperand(v), kind: int } } : {}),
    };
  }

  private readsLocal(node: ts.Expression): boolean {
    const sym = ts.isIdentifier(node) ? this.checker.getSymbolAtLocation(node) : undefined;

    return sym !== undefined && this.operands.isLocal(sym);
  }

  /** A function the leaf takes: the IR's closure. */
  override closure(
    node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    target?: LType,
  ): E {
    if (ts.isFunctionDeclaration(node))
      throw new IrUnsupported(node, "a function declaration in a plan");

    const v = this.operands.closure(node, target);

    return { c: operand(v), t: this.operands.typeOf(v) };
  }

  override ambient(name: string, node: ts.Node): E {
    const v = this.operands.ambient(name, node);

    return { c: operand(v), t: this.operands.typeOf(v) };
  }

  override thunk(node: ts.Expression, thunk?: Thunk): E {
    const v = this.operands.thunk(node, thunk);

    return { c: operand(v), t: this.operands.typeOf(v) };
  }

  /**
   * A plan is one expression: its statements are a statement expression's
   * own; what needs statements outside one is not (a LUCENT diagnostic).
   */
  override emit(...stmts: cpp.Stmt[]): void {
    if (!this.collecting)
      throw new IrUnsupported(this.root, "code that needs statements of its own");

    super.emit(...stmts);
  }

  /** The IR's locals are its own: code that only asks whether a name is one gets an answer. */
  protected override findLocal(sym: ts.Symbol): Local | undefined {
    if (!this.operands.isLocal(sym)) return undefined;

    const root = this.root;
    const named = (): never => {
      throw new IrUnsupported(root, `the local ${sym.name} by name`);
    };

    return {
      get cpp() {
        return named();
      },
      get type() {
        return named();
      },
      boxed: false,
    };
  }
}

/** A short description of a leaf, for dumps. */
function nameOf(node: ts.Node): string {
  if (ts.isPropertyAccessExpression(node)) return `.${node.name.text}`;

  if (ts.isElementAccessExpression(node)) return "[]";

  if (ts.isCallExpression(node)) return `${nameOf(node.expression)}()`;

  if (ts.isNewExpression(node)) return `new ${nameOf(node.expression)}`;

  if (ts.isIdentifier(node)) return node.text;

  if (ts.isBinaryExpression(node)) return node.operatorToken.getText();

  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    return ts.tokenToString(node.operator) ?? "unary";

  if (ts.isArrayLiteralExpression(node)) return "[…]";

  if (ts.isObjectLiteralExpression(node)) return "{…}";

  return ts.SyntaxKind[node.kind];
}

/**
 * The leaf `plan` gives at `node`. What the emitter rejects there it
 * reports (a LUCENT diagnostic), which reaches the function's compile as
 * it is.
 */
function planned(node: ts.Node, plan: () => E): Leaf {
  const e = plan();

  return {
    name: nameOf(node),
    code: e.c,
    type: e.t,
    ...(e.int ? { int: { code: e.int.c, kind: e.int.kind } } : {}),
  };
}

/** For a leaf that takes no operands. */
function noOperands(node: ts.Node): LeafOperands {
  return {
    operand: () => {
      throw new IrUnsupported(node, "an operand here");
    },
    typeOf: () => {
      throw new IrUnsupported(node, "an operand here");
    },
    closure: () => {
      throw new IrUnsupported(node, "an operand here");
    },
    ambient: () => {
      throw new IrUnsupported(node, "an operand here");
    },
    thunk: () => {
      throw new IrUnsupported(node, "an operand here");
    },
    intOf: () => undefined,
    isLocal: () => false,
  };
}

/** Plans leaves with the emitter's code, in the function `opts` describes. */
export function leafHost(ctx: Ctx, opts: FnOptions): LeafHost {
  return {
    plan: (node, operands, hint) =>
      planned(node, () => new LeafEmitter(ctx, opts, node, operands).expr(node, hint)),

    convert: (value: ValueId, from: LType, to: LType, node: ts.Node) =>
      planned(node, () => {
        const em = new LeafEmitter(ctx, opts, node, noOperands(node));

        return { c: em.coerce({ c: operand(value), t: from }, to, node), t: to };
      }),

    platformOnly: (node, type) => {
      const em = new LeafEmitter(ctx, opts, node, noOperands(node));

      return { name: "platformOnly", code: em.platformOnly(node, ctx.reg.cppType(type)), type };
    },

    part: (value, from, which, node) =>
      planned(node, () => {
        const em = new LeafEmitter(ctx, opts, node, noOperands(node));
        const v = { c: operand(value), t: from };
        const t = stripOpt(from);

        if ("name" in which) return em.member(v, which.name, node);

        if ("rest" in which) {
          if (t.k !== "array") throw new IrUnsupported(node, `the rest of a ${typeKey(from)}`);

          return { c: cpp.call(cpp.dot(v.c, "slice"), [numberExpr(which.rest)]), t: from };
        }

        if (t.k === "tuple")
          return { c: cpp.call("std::get", [v.c], [cpp.num(which.index)]), t: t.es[which.index]! };

        if (t.k === "array")
          return {
            c: cpp.call(cpp.dot(v.c, "get"), [numberExpr(which.index)]),
            t: unionOf([t.e, T.undefined]),
          };

        throw new IrUnsupported(node, `destructuring a ${typeKey(from)}`);
      }),

    link: (receiver, from, node, kind, operands) =>
      planned(node, () => {
        const em = new LeafEmitter(ctx, opts, node, operands);
        const v = { c: operand(receiver), t: from };

        if (kind === "call") return em.callValue(v, node as ts.CallExpression);

        if (kind === "method") {
          const call = node as ts.CallExpression;
          const callee = call.expression as ts.PropertyAccessExpression;

          return methodCall(em, v, callee.name.text, call);
        }

        if (ts.isPropertyAccessExpression(node)) return em.member(v, node.name.text, node);

        return em.elementOf(v, (node as ts.ElementAccessExpression).argumentExpression, node);
      }),

    safepoint: () => ({ name: "safepoint", code: safepoint(), type: T.void }),

    whole: (node) => ts.isCallExpression(node) && isEventCall(ctx, node),

    step: (value, from, sign, node) =>
      planned(node, () => ({
        c: cpp.call("lucent::stepNumeric", [operand(value), cpp.num(sign === "+" ? 1 : -1)]),
        t: from,
      })),

    equals: (left, leftType, right, rightType, node) =>
      planned(node, () => {
        const em = new LeafEmitter(ctx, opts, node, noOperands(node));
        const [l, r] = [
          { c: operand(left), t: leftType },
          { c: operand(right), t: rightType },
        ];

        return { c: em.equality(l, r, true, node), t: T.boolean };
      }),

    superCall: (node, operands) =>
      planned(node, () => {
        const sc = opts.superCtor;

        if (!sc) throw new IrUnsupported(node, "super() outside a constructor with a Lucent base");

        const em = new LeafEmitter(ctx, opts, node, operands);

        return { c: cpp.call(sc.call, em.args(node.arguments, sc.params, node)), t: T.undefined };
      }),

    dispose: (value, from, node) =>
      planned(node, () => {
        const em = new LeafEmitter(ctx, opts, node, noOperands(node));

        return { c: disposeCall(em, { c: operand(value), t: from }, node), t: T.undefined };
      }),

    keys: (value, from, node) =>
      planned(node, () => {
        const v = operand(value);
        const t = stripOpt(from);
        const strings = cpp.type("lucent::Array", cpp.type("lucent::String"));
        const keys: E["t"] = { k: "array", e: T.string };

        if (t.k === "dict") return { c: cpp.call(cpp.dot(v, "keys")), t: keys };

        if (t.k === "struct") {
          const names = structKeys(ctx.reg, t.id, node, Codes.UnsupportedOperator, "for…in").map(
            stringExpr,
          );

          return { c: cpp.construct(strings, names, true), t: keys };
        }

        if (t.k === "array") {
          const [k, out] = [cpp.id("k"), cpp.id("keys")];
          const index = cpp.call("lucent::numberToString", [cpp.staticCast(cpp.type("double"), k)]);

          return {
            c: cpp.statementExpr(
              [
                cpp.varDecl(strings, "keys"),
                {
                  k: "for",
                  init: cpp.varDecl(cpp.type("size_t"), "k", cpp.num(0)),
                  test: cpp.binary(k, "<", cpp.call(cpp.dot(v, "size"))),
                  update: cpp.postfix("++", k),
                  body: [cpp.exprStmt(cpp.call(cpp.dot(out, "push"), [index]))],
                },
              ],
              out,
            ),
            t: keys,
          };
        }

        throw new IrUnsupported(node, `for in over a ${typeKey(from)}`);
      }),

    place: (target, operands): LeafPlace => {
      const lv = new LeafEmitter(ctx, opts, target, operands).lvalue(target);
      const name = nameOf(target);
      const { direct, set, assign } = lv;

      if (!direct && !set) throw new IrUnsupported(target, "a place that cannot be written");

      return {
        type: lv.type,
        get: { name, code: lv.get, type: lv.type },
        set: (v) => ({
          name: `${name} =`,
          code: direct ? cpp.assign(direct, operand(v)) : set!(operand(v)),
          type: T.void,
        }),
        ...(assign
          ? {
              assign: (v: ValueId, from: LType) => ({
                name: `${name} =`,
                code: assign({ c: operand(v), t: from }),
                type: T.void,
              }),
            }
          : {}),
      };
    },
  };
}
