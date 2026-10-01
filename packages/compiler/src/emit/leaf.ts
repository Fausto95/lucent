/**
 * The leaves of the semantic IR (ir/lower.ts): expressions the IR does not
 * model itself, planned by the emitter's code for them. A leaf's
 * subexpressions are operands the IR lowers first, in evaluation order;
 * here they are names (ir/cpp.ts `operand`), so the planned code runs no
 * code of the program's own and decides no order.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { CompileError } from "../diagnostics.ts";
import { operand } from "../ir/cpp.ts";
import type { ValueId } from "../ir/ir.ts";
import {
  IrUnsupported,
  type Leaf,
  type LeafHost,
  type LeafOperands,
  type LeafPlace,
} from "../ir/lower.ts";
import { type LType, T } from "../types.ts";
import { AlreadyReported, type Ctx, type E } from "./context.ts";
import { type FnOptions, FnEmitter, type Local } from "./function.ts";

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
    if (node === this.root) return super.expr(node, hint);

    const v = this.operands.operand(node);

    return { c: operand(v), t: this.operands.typeOf(v) };
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

  /** A plan is one expression: what needs statements stays the legacy emitter's. */
  override emit(): void {
    throw new IrUnsupported(this.root, "code that needs statements of its own");
  }

  // The IR evaluated the operands already, in order.
  protected override inOrder(_args: readonly ts.Expression[], build: () => E): E {
    return build();
  }

  protected override evaluatedFirst(_nodes: readonly ts.Expression[], build: () => E): E {
    return build();
  }

  protected override awaitingFirst(_operands: readonly ts.Expression[], build: () => E): E {
    return build();
  }

  protected override onTarget(
    _target: ts.Expression,
    _later: ts.Expression | undefined,
    build: () => E,
  ): E {
    return build();
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
 * Runs `plan`; what the emitter rejects there is unsupported for now, and
 * the legacy emitter, lowering the whole function again, reports it.
 */
function rejected<R>(node: ts.Node, plan: () => R): R {
  try {
    return plan();
  } catch (e) {
    if (e instanceof CompileError || e instanceof AlreadyReported)
      throw new IrUnsupported(node, `what the emitter rejects here (${e.message})`);

    throw e;
  }
}

function planned(node: ts.Node, plan: () => E): Leaf {
  return rejected(node, () => {
    const e = plan();

    return { name: nameOf(node), code: e.c, type: e.t };
  });
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

    place: (target, operands): LeafPlace =>
      rejected(target, () => {
        const lv = new LeafEmitter(ctx, opts, target, operands).lvalue(target);
        const name = nameOf(target);
        const { direct, set } = lv;

        if (!direct && !set) throw new IrUnsupported(target, "a place that cannot be written");

        return {
          type: lv.type,
          get: { name, code: lv.get, type: lv.type },
          set: (v) => ({
            name: `${name} =`,
            code: direct ? cpp.assign(direct, operand(v)) : set!(operand(v)),
            type: T.void,
          }),
        };
      }),
  };
}
