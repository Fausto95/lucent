import { cpp } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import { Codes, CompileError, fail } from "../diagnostics.ts";
import { isPlatformValue, platformGuard } from "../platforms.ts";
import type { LucentModule } from "../program.ts";
import {
  type ClassInfo,
  cppIdent,
  functionsNotCompared,
  holdsFunction,
  isVoidish,
  type LType,
  sameType,
  stripOpt,
  substitute,
  T,
  typeKey,
  unionOf,
  unionShapeBreak,
} from "../types.ts";
import { containsAwait, type FunctionLike, symbolOf } from "../analysis/scopes.ts";
import * as builtins from "./builtins.ts";
import { spanElement } from "./buffers.ts";
import { constructorOf, DISPOSE, isSymbolDispose } from "./classes.ts";
import { TASK, taskVariant } from "./compute.ts";
import * as extensions from "./extensions.ts";
import * as native from "./native.ts";
import { requireSubclassMain } from "./objc-subclass.ts";
import * as views from "./setups.ts";
import { toolkitCall, toolkitJsx, toolkitMember } from "./toolkit.ts";
import {
  AlreadyReported,
  type Ctx,
  type E,
  type IntKind,
  type ParamInfo,
  type Lvalue,
} from "./context.ts";
import { genericFacts, instanceAt } from "./instantiations.ts";
export { substitute } from "../types.ts";
import type { Thunk } from "../ir/lower.ts";
import { type ConversionStep, conversionStep } from "../lowering/conversions.ts";
import { heldAs, throughMembers } from "../lowering/members.ts";
import {
  BIGINT_COMPARISONS,
  BIGINT_OPERATORS,
  comparesMixed,
  numericUnion,
} from "../lowering/bigint.ts";
import { looseConversion, looseConversionMessage } from "../lowering/loose-equality.ts";
import { assignedRead } from "../lowering/unassigned.ts";
import { bigintExpr, bigintLiteralValue, numberExpr, stringExpr } from "../lowering/literals.ts";

export interface Local {
  cpp: string;
  type: LType;
  boxed: boolean;
  /** Set when the number lives in an integer register. */
  int?: IntKind;
}

export interface FnOptions {
  module: LucentModule;
  async: boolean;
  cls?: ClassInfo;
  /** How `this` is spelled in the current context. */
  thisExpr?: string;
  /** How `this` is spelled as a Ref (for passing it as a value). */
  thisRef?: string;
  /** In a subclass constructor: the base construct() call `super(…)` makes. */
  superCtor?: { call: cpp.Expr; params: LType[] };
  /**
   * A compute task's variant of a function (compute.ts): its calls of
   * module functions call their variants (the IR checks for cancellation
   * at each loop iteration). Closures inside run as they are.
   */
  task?: boolean;
}

const ASSIGN_OPS = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.PlusEqualsToken, "+"],
  [ts.SyntaxKind.MinusEqualsToken, "-"],
  [ts.SyntaxKind.AsteriskEqualsToken, "*"],
  [ts.SyntaxKind.SlashEqualsToken, "/"],
  [ts.SyntaxKind.PercentEqualsToken, "%"],
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken, "**"],
  [ts.SyntaxKind.AmpersandEqualsToken, "&"],
  [ts.SyntaxKind.BarEqualsToken, "|"],
  [ts.SyntaxKind.CaretEqualsToken, "^"],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, "<<"],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, ">>"],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ">>>"],
]);

const BITWISE = ["&", "|", "^", "<<", ">>", ">>>"];

const EQUALITY_OPS = ["===", "!==", "==", "!="];

/** Compound assignment operators the runtime computes, by their helper. */
const FN_OPS: Record<string, string | undefined> = {
  "%": "jsMod",
  "**": "jsPow",
  "&": "jsAnd",
  "|": "jsOr",
  "^": "jsXor",
  "<<": "jsShl",
  ">>": "jsSar",
  ">>>": "jsShr",
};

type ApplyStep<K extends ConversionStep["kind"]> = (
  em: FnEmitter,
  e: E,
  to: LType,
  step: ConversionStep & { kind: K },
  node: ts.Node | undefined,
) => cpp.Expr;

/** Whether evaluating a C++ expression can do anything: names, literals and constructions from them cannot. */
function isPure(c: cpp.Expr): boolean {
  switch (c.k) {
    case "id":
    case "number":
    case "string":
    case "bool":
    case "nullptr":
    case "this":
      return true;
    case "construct":
      return c.args.every(isPure);
    default:
      return false;
  }
}

/**
 * `value`, after what evaluating `c` does: an absent value has one C++
 * value, but the call that gave it (a C++ void when it returns nothing)
 * still runs, and may throw.
 */
function afterEffects(c: cpp.Expr, value: cpp.Expr): cpp.Expr {
  if (isPure(c)) return value;

  // Already an effect then a pure value (`(void)f(), lucent::undefined`): the effect, then this value.
  if (c.k === "comma" && isPure(c.items.at(-1)!)) return cpp.comma(...c.items.slice(0, -1), value);

  return cpp.comma(cpp.cast("c", cpp.voidType, c), value);
}

/** Each conversion step (lowering/conversions.ts) as C++, the steps after it through coerce. */
const STEPS: { [K in ConversionStep["kind"]]: ApplyStep<K> } = {
  // An undefined from a call that returns nothing is a C++ void: as a value, it is the constant.
  same: (_, e, to) =>
    to.k === "undefined" && !isPure(e.c) ? afterEffects(e.c, cpp.id("lucent::undefined")) : e.c,

  undefined: (_, e) => afterEffects(e.c, cpp.id("lucent::undefined")),

  absent: (em, e, to, step) =>
    afterEffects(e.c, cpp.construct(em.reg.cppType(to), [cpp.id(`lucent::${step.value}`)])),

  wrap: (em, e, to, step, node) =>
    cpp.construct(em.reg.cppType(to), [em.coerce(e, step.inner, node)]),

  unwrap: (em, e, to, step, node) =>
    em.coerce({ c: cpp.call(cpp.dot(e.c, "value")), t: step.inner }, to, node),

  member: (em, e, to, step, node) =>
    cpp.construct(em.reg.cppType(to), [em.coerce(e, step.member, node)]),

  narrow: (em, e, to) => cpp.call("lucent::narrow", [e.c], [em.reg.cppType(to)]),

  // A member with no conversion to the target at all is one the checker ruled out (a cast, a
  // narrowing): it gets no arm, and holding it throws. One whose conversion is rejected (an
  // object of another shape) is an error, as is a union with no member that converts.
  members: (em, e, to, step, node) => {
    const unrelated: CompileError[] = [];

    const arms = step.members.flatMap((m) => {
      const type = em.reg.cppType(m);

      try {
        return [{ type, value: em.coerce({ c: heldAs(type), t: m }, to, node) }];
      } catch (error) {
        if (!(error instanceof CompileError) || error.code !== Codes.UnsupportedType) throw error;

        unrelated.push(error);
        return [];
      }
    });

    if (!arms.length) throw unrelated[0];

    return throughMembers(e.c, em.reg.cppType(to), arms);
  },

  reshape: (em, e, to) => cpp.call("lucent::convert", [e.c], [em.reg.cppType(to)]),
};

/**
 * Lowers expressions to C++: the code of the semantic IR's leaves
 * (leaf.ts, whose emitter knows the function's locals and operands), and
 * the conversions and signatures the platform glue needs.
 */
export class FnEmitter {
  /** Statements of a statement expression, innermost last: collect() opens one. */
  private readonly out: cpp.Stmt[][] = [];
  /** Nodes replaced during optional-chain lowering. */
  private readonly subst = new Map<ts.Node, E>();
  readonly ctx: Ctx;
  readonly opts: FnOptions;

  constructor(ctx: Ctx, opts: FnOptions) {
    this.ctx = ctx;
    this.opts = opts;
  }

  get checker(): ts.TypeChecker {
    return this.ctx.checker;
  }
  get reg() {
    return this.ctx.reg;
  }
  cpp(t: LType): string {
    return this.ctx.reg.cpp(t);
  }

  // --- output ---------------------------------------------------------------

  /** Statements of the block `collect` opened: an expression has no others. */
  emit(...stmts: cpp.Stmt[]): void {
    const into = this.out.at(-1);

    if (!into) throw new Error("statements outside a statement expression");

    into.push(...stmts);
  }

  /** Whether a block `collect` opened takes statements. */
  protected get collecting(): boolean {
    return this.out.length > 0;
  }
  /** The statements `f` emits, as a block of their own. */
  collect(f: () => void): cpp.Stmt[] {
    const into: cpp.Stmt[] = [];
    this.out.push(into);
    try {
      f();
    } finally {
      this.out.pop();
    }
    return into;
  }

  // --- locals ------------------------------------------------------------------

  /** The local `sym` names: the IR's, which only a leaf's emitter knows. */
  protected findLocal(_sym: ts.Symbol): Local | undefined {
    return undefined;
  }

  // --- integers --------------------------------------------------------------------

  /** A number known to equal the exact integer expression `c`. */
  intE(c: cpp.Expr, kind: IntKind): E {
    return { c: cpp.staticCast(cpp.type("double"), c), t: T.number, int: { c, kind } };
  }

  /** ToInt32 as a C++ int32_t. */
  i32(e: E, node: ts.Node): cpp.Expr {
    if (e.int) return e.int.kind === "i32" ? e.int.c : cpp.staticCast(cpp.type("int32_t"), e.int.c);
    return cpp.call("lucent::toInt32", [this.num(e, node)]);
  }

  /** ToUint32 as a C++ uint32_t. */
  u32(e: E, node: ts.Node): cpp.Expr {
    if (e.int)
      return e.int.kind === "u32" ? e.int.c : cpp.staticCast(cpp.type("uint32_t"), e.int.c);
    return cpp.call("lucent::toUint32", [this.num(e, node)]);
  }

  /** A value the analysis proved fits `kind`, as that register type. */
  private toKind(e: E, kind: IntKind, node: ts.Node): cpp.Expr {
    if (e.int?.kind === kind) return e.int.c;
    if (kind === "i32") return this.i32(e, node);
    if (kind === "u32") return this.u32(e, node);
    return cpp.staticCast(cpp.type("int64_t"), e.int ? e.int.c : this.num(e, node));
  }

  /** `a op b` for the int32 operators, on integer registers. */
  bitwise(op: string, a: E, b: E, node: ts.Node): E {
    // Shift counts are taken modulo 32, as in JavaScript.
    const count = () => cpp.binary(this.u32(b, node), "&", cpp.num("31u"));
    switch (op) {
      case "&":
      case "|":
      case "^":
        return this.intE(cpp.binary(this.i32(a, node), op, this.i32(b, node)), "i32");
      case "<<":
        return this.intE(
          cpp.staticCast(cpp.type("int32_t"), cpp.binary(this.u32(a, node), "<<", count())),
          "i32",
        );
      case ">>":
        return this.intE(cpp.binary(this.i32(a, node), ">>", count()), "i32");
      case ">>>":
        return this.intE(cpp.binary(this.u32(a, node), ">>", count()), "u32");
    }
    fail(node, Codes.UnsupportedOperator, `unsupported operator ${op}`);
  }

  private intLocal(target: ts.Expression): Local | undefined {
    if (!ts.isIdentifier(target)) return undefined;
    const sym = symbolOf(this.checker, target);
    const local = sym ? this.findLocal(this.ctx.resolve(sym)) : undefined;
    return local?.int ? local : undefined;
  }

  // --- types ---------------------------------------------------------------------

  lt(node: ts.Node): LType {
    return this.ctx.lowerAt(node);
  }

  /** Converts a value to another representation the checker proved compatible. */
  coerce(e: E, to: LType, node?: ts.Node): cpp.Expr {
    const from = e.t;

    // A value typed never has any type: it throws before there is one to convert. A value to
    // pass as a never (one the checker narrowed away, as in an exhaustive switch) does not exist.
    if ((from.k === "never" || to.k === "never") && to.k !== "void")
      return this.unreachableAs(e, to);

    const step = conversionStep(from, to, {
      // Different Lucent types with one native representation (platform objects).
      same: (a, b) => this.cpp(a) === this.cpp(b),
      fits: (a, b) => this.compatible(a, b),
    });

    if (step) return (STEPS[step.kind] as ApplyStep<typeof step.kind>)(this, e, to, step, node);

    if (to.k === "fn" && from.k === "fn") return this.adaptFn(e, to, node);
    if (this.cpp(from) === this.cpp(to)) return e.c;
    // Error subclasses: upcast freely, downcast (after instanceof) with a check.
    const downcast = (cls: LType & { k: "class" }) =>
      cpp.call("lucent::downcast", [e.c], [this.reg.cppClassType(cls)]);
    if (to.k === "error" && from.k === "class" && this.reg.cls(from.id).isError)
      return cpp.construct(cpp.type("lucent::Error"), [e.c]);
    if (from.k === "error" && to.k === "class" && this.reg.cls(to.id).isError) return downcast(to);
    if (to.k === "iface") return this.toIface(e, to, node);
    if (to.k === "iter") {
      const src = this.iterExpr(e, node ?? ts.factory.createIdentifier("value"));
      if (this.cpp(src.e) !== this.cpp(to.e))
        fail(
          node,
          Codes.ArrayVariance,
          `iterable element types must match exactly (${typeKey(src.e)} vs ${typeKey(to.e)})`,
        );
      return src.c;
    }
    // Date.prototype.valueOf: relational operators and unary plus.
    if (from.k === "date" && to.k === "number") return cpp.call(cpp.arrow(e.c, "getTime"));
    if (from.k === "iface" && to.k === "class") return downcast(to);
    if (from.k === "class" && to.k === "class") {
      // Upcasts are implicit; downcasts follow instanceof narrowing and are checked.
      if (this.reg.extendsType(from, to))
        return cpp.call("std::static_pointer_cast", [e.c], [this.reg.cppClassType(to)]);
      if (this.reg.extendsType(to, from)) return downcast(to);
      // TypeScript lets `Box<number>` stand for `Box<number | undefined>`; natively they are two
      // classes, and a copy of the instance would not be the same object.
      if (this.reg.derives(from.id, to.id) || this.reg.derives(to.id, from.id))
        fail(
          node,
          Codes.ArrayVariance,
          `an existing ${this.spelled(from)} cannot be used as a ${this.spelled(to)}: each instantiation of a generic class is a native class of its own; give the value that type where it is created`,
        );
    }
    if (from.k === "struct" && to.k === "struct") {
      fail(
        node,
        Codes.InexactObject,
        `object types must match exactly to share a native representation (${this.describe(from)} vs ${this.describe(to)})`,
      );
    }
    if (
      (from.k === "array" && to.k === "array") ||
      (from.k === "map" && to.k === "map") ||
      (from.k === "dict" && to.k === "dict")
    ) {
      fail(
        node,
        Codes.ArrayVariance,
        `collection element types must match exactly (${typeKey(from)} vs ${typeKey(to)}); annotate the value with the target type`,
      );
    }
    // A Lucent class implementing an SDK protocol, where the SDK takes one.
    if (from.k === "class" && to.k === "native") return native.nativeOfClass(this, e, to, node);
    fail(node, Codes.UnsupportedType, `cannot convert ${typeKey(from)} to ${typeKey(to)}`);
  }

  /** `JSON.parse(text) as T`: a typed parse into the target type. */
  private jsonParse(node: ts.CallExpression, hint?: LType): E {
    if (!hint || hint.k === "void")
      fail(
        node,
        Codes.UnsupportedBuiltin,
        "JSON.parse needs a target type: write `JSON.parse(text) as T` or annotate the variable",
      );
    if (node.arguments.length !== 1)
      fail(node, Codes.UnsupportedBuiltin, "JSON.parse reviver functions are not supported");
    this.jsonReadable(hint, node, new Set());
    this.ctx.jsonReads.set(typeKey(hint), hint);
    const text = this.exprAs(node.arguments[0]!, T.string);
    return { c: cpp.call("lucent::jsonParse", [text], [this.reg.cppType(hint)]), t: hint };
  }

  /** Types JSON.parse can build: plain data, like JSON itself. */
  private jsonReadable(t: LType, node: ts.Node, seen: Set<string>): void {
    if (seen.has(typeKey(t))) return;
    seen.add(typeKey(t));
    switch (t.k) {
      case "number":
      case "boolean":
      case "string":
      case "null":
        return;
      case "opt":
        return this.jsonReadable(t.inner, node, seen);
      case "array":
        return this.jsonReadable(t.e, node, seen);
      case "dict":
        return this.jsonReadable(t.val, node, seen);
      case "tuple":
        return t.es.forEach((e) => this.jsonReadable(e, node, seen));
      case "struct":
        return this.reg.struct(t.id).fields.forEach((f) => this.jsonReadable(f.type, node, seen));
      case "union":
        return t.ms.forEach((m) => this.jsonReadable(m, node, seen));
      default:
        fail(
          node,
          Codes.UnsupportedBuiltin,
          `JSON.parse cannot create ${t.k === "class" ? "class instances" : typeKey(t)}; parse into plain data types`,
        );
    }
  }

  /** Upcasts a class instance to an interface it declares with `implements`. */
  private toIface(e: E, to: LType & { k: "iface" }, node?: ts.Node): cpp.Expr {
    const info = this.reg.iface(to.id);
    const name = info.decl.name.text;
    if (e.t.k === "class") {
      const cls = this.reg.cls(e.t.id);
      if (!this.reg.implementsIface(e.t, to)) {
        fail(
          node,
          Codes.InterfaceNotImplemented,
          `class ${cls.decl.name!.text} must declare \`implements ${name}\` (with these type arguments) to be used as ${name}`,
        );
      }
      return cpp.call("std::static_pointer_cast", [e.c], [this.reg.cppIfaceType(to)]);
    }
    if (e.t.k === "iface") {
      // An interface that extends the target: an upcast to a virtual base.
      if (this.reg.ifaceChain(e.t).some((x) => typeKey(x) === typeKey(to)))
        return cpp.call("std::static_pointer_cast", [e.c], [this.reg.cppIfaceType(to)]);
      fail(
        node,
        Codes.InterfaceNotImplemented,
        `${this.reg.iface(e.t.id).decl.name.text} does not extend ${name}`,
      );
    }
    this.notAnImplementation(e.t.k === "struct" ? "an object" : typeKey(e.t), to, node);
  }

  private notAnImplementation(what: string, to: LType & { k: "iface" }, node?: ts.Node): never {
    const name = this.reg.iface(to.id).decl.name.text;
    fail(
      node,
      Codes.InterfaceNotImplemented,
      `${what} cannot be used as ${name}; ${name} is implemented by classes that declare \`implements ${name}\``,
    );
  }

  private compatible(from: LType, to: LType): boolean {
    if (sameType(from, to)) return true;
    if (from.k === "fn" && to.k === "fn") return true;

    // A subclass is held as its base class, upcast (coerce).
    if (from.k === "class" && to.k === "class" && this.reg.derives(from.id, to.id)) return true;

    return this.cpp(from) === this.cpp(to);
  }

  private describe(t: LType): string {
    if (t.k === "struct")
      return `{ ${this.reg
        .struct(t.id)
        .fields.map((f) => f.name)
        .join(", ")} }`;
    return typeKey(t);
  }

  /** `t` as TypeScript spells it, for the types a class's type arguments usually are. */
  private spelled(t: LType): string {
    const grouped = (x: LType) =>
      x.k === "opt" || x.k === "union" || x.k === "fn" ? `(${this.spelled(x)})` : this.spelled(x);
    switch (t.k) {
      case "class":
      case "iface": {
        const decl = t.k === "class" ? this.reg.cls(t.id).decl : this.reg.iface(t.id).decl;
        const args = t.args.map((a) => this.spelled(a)).join(", ");
        return t.args.length ? `${decl.name!.text}<${args}>` : decl.name!.text;
      }
      case "opt":
        return `${this.spelled(t.inner)} | undefined`;
      case "union":
        return t.ms.map((m) => this.spelled(m)).join(" | ");
      case "array":
        return `${grouped(t.e)}[]`;
      case "tparam":
        return t.name;
      case "number":
      case "bigint":
      case "boolean":
      case "string":
      case "undefined":
      case "null":
      case "void":
      case "never":
        return t.k;
      default:
        return this.describe(t);
    }
  }

  /** Adapts a function value to a function type with more parameters. */
  private adaptFn(e: E, to: LType & { k: "fn" }, node?: ts.Node): cpp.Expr {
    const from = e.t as LType & { k: "fn" };
    if (this.cpp(from) === this.cpp(to)) return e.c;
    const f = this.ctx.fresh("fn");
    const params = to.params.map((p, i) => cpp.param(this.reg.cppType(p), `a${i}`));
    const args = from.params.map((p, i) =>
      this.coerce({ c: cpp.id(`a${i}`), t: to.params[i] ?? T.undefined }, p, node),
    );
    const call = cpp.call(f, args);
    const body = isVoidish(to.ret)
      ? cpp.exprStmt(call)
      : cpp.ret(this.coerce({ c: call, t: from.ret }, to.ret, node));
    const lambda = cpp.lambda([{ name: f, init: e.c }], params, [body]);
    return cpp.construct(this.reg.cppType(to), [lambda]);
  }

  exprAs(node: ts.Expression, to: LType): cpp.Expr {
    return this.coerce(this.expr(node, to), to, node);
  }

  /** A condition: a C++ bool. */
  cond(node: ts.Expression): cpp.Expr {
    return this.truthy(this.expr(node), node);
  }

  /** ToBoolean: a value typed never has none to test. */
  private truthy(e: E, node: ts.Node): cpp.Expr {
    if (e.t.k === "never") return this.coerce(e, T.boolean, node);

    return e.t.k === "boolean" ? e.c : cpp.call("lucent::truthy", [e.c]);
  }

  // --- functions -------------------------------------------------------------------

  /**
   * A nested function's type (`target`'s parameters, when it becomes a
   * function type taking at least as many, so the lambda matches its Fn
   * exactly), what it returns, and its parameters.
   */
  closureSignature(
    node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    target?: LType,
  ): {
    fnType: LType & { k: "fn" };
    ret: LType;
    params: ParamInfo[];
    isAsync: boolean;
    isGen: boolean;
  } {
    const sig = this.checker.getTypeAtLocation(node).getCallSignatures()[0];
    if (!sig) fail(node, Codes.UnsupportedType, "expected a function type");
    let fnType: LType & { k: "fn" };
    if (target && target.k === "fn" && target.params.length >= node.parameters.length) {
      fnType = {
        k: "fn",
        params: target.params,
        ret: this.reg.lower(this.checker.getReturnTypeOfSignature(sig), node),
      };
    } else {
      fnType = this.reg.lowerSignature(sig, node) as LType & { k: "fn" };
    }
    const isAsync = !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    const isGen = !ts.isArrowFunction(node) && !!node.asteriskToken;
    if (isAsync && isGen) fail(node, Codes.UnsupportedType, "async generators are not supported");
    const ret = isAsync
      ? fnType.ret.k === "promise"
        ? fnType.ret.inner
        : fnType.ret
      : isGen
        ? T.void
        : fnType.ret;
    return { fnType, ret, params: this.paramInfos(node, fnType), isAsync, isGen };
  }

  /** Parameter infos for a function-like node with a known function type. */
  paramInfos(node: FunctionLike, fnType: LType & { k: "fn" }): ParamInfo[] {
    return node.parameters.map((p, i) => {
      const declared = fnType.params[i] ?? this.lt(p);
      const optional = !!p.questionToken || !!p.initializer;
      const rest = !!p.dotDotDotToken;
      let type = declared;
      let cppType = declared;
      if (p.initializer) {
        // Default parameter: callers pass Opt<T>; the body sees the declared type.
        const sym = ts.isIdentifier(p.name) ? this.checker.getSymbolAtLocation(p.name) : undefined;
        const bodyType = p.type
          ? this.checker.getTypeFromTypeNode(p.type)
          : sym
            ? this.checker.getTypeOfSymbolAtLocation(sym, p.name)
            : this.checker.getTypeAtLocation(p);
        type = this.reg.lower(bodyType, p);
        cppType = unionOf([type, T.undefined]);
      } else if (optional && declared.k !== "opt") {
        cppType = type = unionOf([declared, T.undefined]);
      }
      return {
        name: ts.isIdentifier(p.name) ? p.name.text : `p${i}`,
        type,
        cppType,
        optional,
        rest,
      };
    });
  }

  /** A nested function as a function value, `target` the type it becomes: the IR's closure. */
  closure(
    node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    _target?: LType,
  ): E {
    throw new CompileError(node, Codes.UnsupportedSyntax, "a function value outside the IR");
  }

  /** An ambient of the IR's function (a setup's mount): what only the IR's leaves name. */
  ambient(name: string, _node: ts.Node): E {
    throw new Error(`the ambient ${name} outside the IR`);
  }

  /** A function computing `node` later (an effect's): what only the IR's leaves make. */
  thunk(_node: ts.Expression, _thunk?: Thunk): E {
    throw new Error("a thunk outside the IR");
  }

  /** The object `this` is, as a reference (`self` in closures and coroutines). */
  selfRefExpr(): cpp.Expr {
    return this.opts.thisRef ? cpp.id(this.opts.thisRef) : cpp.call("lucent::selfRef", [cpp.self]);
  }

  // --- iteration and platforms ----------------------------------------------------

  private withDefault(v: E, init: ts.Expression, node: ts.Node): E {
    if (v.t.k !== "opt") return v;
    const target = this.lt(node);
    // The default only when the value is undefined, as in JavaScript.
    const tmpName = this.ctx.fresh("dv");
    const tmp = cpp.id(tmpName);
    const pick = cpp.conditional(
      cpp.call(cpp.dot(tmp, "isUndefined")),
      this.exprAs(init, target),
      this.coerce({ c: tmp, t: v.t }, target, node),
    );
    return { c: cpp.statementExpr([cpp.varDecl(cpp.auto, tmpName, v.c)], pick), t: target };
  }

  /** Any iterable as an Iter<T>. */
  iterExpr(e: E, node: ts.Node): { c: cpp.Expr; e: LType } {
    const t = stripOpt(e.t);
    const v = e.t.k === "opt" ? this.coerce(e, t, node) : e.c;
    const iterOf = (el: LType) => ({ c: cpp.call("lucent::iterOf", [v]), e: el });
    switch (t.k) {
      case "iter":
        return { c: v, e: t.e };
      case "array":
      case "set":
        return iterOf(t.e);
      case "map":
        return iterOf({ k: "tuple", es: [t.key, t.val] });
      case "string":
        return iterOf(T.string);
      case "bytes":
        return iterOf(T.number);
    }
    fail(node, Codes.UnsupportedLoop, `${typeKey(e.t)} is not iterable`);
  }

  /** Any iterable's elements as an array: an array is itself, the others are copied into one. */
  iterableItems(e: E, node: ts.Node): { c: cpp.Expr; e: LType } {
    const t = stripOpt(e.t);
    const v = e.t.k === "opt" ? this.coerce(e, t, node) : e.c;

    switch (t.k) {
      case "array":
        return { c: v, e: t.e };
      case "set":
        return { c: cpp.call(cpp.dot(v, "values")), e: t.e };
      case "map":
        return { c: cpp.call("lucent::mapEntries", [v]), e: { k: "tuple", es: [t.key, t.val] } };
      case "string":
        return { c: cpp.call("lucent::splitCodePoints", [v]), e: T.string };
      case "bytes":
        return { c: cpp.call(cpp.dot(v, "toArray")), e: T.number };
      case "iter":
        return { c: cpp.call("lucent::iterToArray", [v]), e: t.e };
    }

    fail(node, Codes.UnsupportedLoop, `${typeKey(e.t)} is not iterable`);
  }

  /** Code that runs on iOS or Android only, reached on the host: throws, typed as `cpp`. */
  platformOnly(node: ts.Node, type: cpp.Type): cpp.Expr {
    const sf = node.getSourceFile();
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const message = `${path.basename(sf.fileName)}:${line}: this code runs only on iOS and Android`;
    return cpp.call("lucent::platformOnly", [stringExpr(message)], [type]);
  }

  // --- expressions --------------------------------------------------------------------------

  expr(node: ts.Expression, hint?: LType): E {
    const s = this.subst.get(node);
    if (s) return s;

    const e = this.exprInner(node, hint);

    // A call that always throws gives no value: typed never, it converts to any type (coerce).
    if (isVoidish(e.t) && e.t.k !== "never" && !isPure(e.c) && this.diverges(node))
      return { ...e, t: T.never };

    return e;
  }

  private exprInner(node: ts.Expression, hint?: LType): E {
    switch (node.kind) {
      case ts.SyntaxKind.NumericLiteral: {
        const v = Number((node as ts.NumericLiteral).text.replace(/_/g, ""));
        const c = numberExpr(v);
        // Exact integers also have their integer register form (integers.ts).
        if (Number.isInteger(v) && v >= 0 && v <= 2147483647)
          return { c, t: T.number, int: { c: cpp.num(v), kind: "i32" } };
        if (Number.isInteger(v) && v > 2147483647 && v <= 4294967295)
          return { c, t: T.number, int: { c: cpp.num(`${v}u`), kind: "u32" } };
        return { c, t: T.number };
      }
      case ts.SyntaxKind.BigIntLiteral:
        return {
          c: bigintExpr(bigintLiteralValue((node as ts.BigIntLiteral).text)),
          t: T.bigint,
        };
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        return { c: stringExpr((node as ts.StringLiteral).text), t: T.string };
      case ts.SyntaxKind.TemplateExpression:
        return this.template(node as ts.TemplateExpression);
      case ts.SyntaxKind.TrueKeyword:
        return { c: cpp.bool(true), t: T.boolean };
      case ts.SyntaxKind.FalseKeyword:
        return { c: cpp.bool(false), t: T.boolean };
      case ts.SyntaxKind.NullKeyword:
        return { c: cpp.id("lucent::null"), t: T.null };
      case ts.SyntaxKind.Identifier:
        return this.identifier(node as ts.Identifier);
      case ts.SyntaxKind.ThisKeyword:
        return this.thisValue(node);
      // Grouping only: the printer parenthesizes what precedence needs.
      case ts.SyntaxKind.ParenthesizedExpression:
        return this.expr((node as ts.ParenthesizedExpression).expression, hint);
      case ts.SyntaxKind.AsExpression:
      case ts.SyntaxKind.TypeAssertionExpression:
      case ts.SyntaxKind.SatisfiesExpression: {
        const inner = (node as ts.AsExpression).expression;
        if (
          ts.isAsExpression(node) &&
          ts.isTypeReferenceNode(node.type) &&
          node.type.typeName.getText() === "const"
        )
          return this.expr(inner, hint);
        const target = this.lt(node);
        const e = this.expr(inner, target);
        return { c: this.coerce(e, target, node), t: target };
      }
      case ts.SyntaxKind.NonNullExpression: {
        const e = this.expr((node as ts.NonNullExpression).expression);
        if (e.t.k === "opt") return { c: cpp.call(cpp.dot(e.c, "value")), t: e.t.inner };
        return e;
      }
      case ts.SyntaxKind.PrefixUnaryExpression:
        return this.prefix(node as ts.PrefixUnaryExpression);
      case ts.SyntaxKind.PostfixUnaryExpression:
        return this.postfix(node as ts.PostfixUnaryExpression);
      case ts.SyntaxKind.BinaryExpression:
        return this.binary(node as ts.BinaryExpression);
      case ts.SyntaxKind.ConditionalExpression:
        return this.conditional(node as ts.ConditionalExpression, hint);
      case ts.SyntaxKind.RegularExpressionLiteral: {
        const text = (node as ts.RegularExpressionLiteral).text;
        const end = text.lastIndexOf("/");
        const flags = cpp.construct(cpp.type("lucent::Opt", cpp.type("lucent::String")), [
          stringExpr(text.slice(end + 1)),
        ]);
        return {
          c: cpp.call("lucent::makeRegExp", [stringExpr(text.slice(1, end)), flags]),
          t: T.regexp,
        };
      }
      case ts.SyntaxKind.YieldExpression:
        fail(
          node,
          Codes.UnsupportedSyntax,
          "`yield` can only be used as a statement; its value is not supported",
        );
      // A toolkit's body: the JSX its component returns.
      case ts.SyntaxKind.JsxElement:
      case ts.SyntaxKind.JsxSelfClosingElement:
      case ts.SyntaxKind.JsxFragment:
        return toolkitJsx(this, node);
      case ts.SyntaxKind.CallExpression: {
        const call = node as ts.CallExpression;
        // A toolkit's body (JSX with modifiers after it), or withAnimation.
        const drawn = toolkitCall(this, call);
        if (drawn) return drawn;
        this.checkInstance(call);
        if (builtins.isJsonParse(this, call)) return this.jsonParse(call, hint);
        return this.narrowed(node, this.call(call));
      }
      case ts.SyntaxKind.NewExpression:
        this.checkInstance(node as ts.NewExpression);
        return this.newExpr(node as ts.NewExpression, hint);
      case ts.SyntaxKind.PropertyAccessExpression:
        toolkitMember(this, node as ts.PropertyAccessExpression);
        return this.narrowed(node, this.propertyAccess(node as ts.PropertyAccessExpression));
      case ts.SyntaxKind.ElementAccessExpression:
        return this.narrowed(node, this.elementAccess(node as ts.ElementAccessExpression));
      case ts.SyntaxKind.ArrayLiteralExpression:
        return this.arrayLiteral(node as ts.ArrayLiteralExpression, hint);
      case ts.SyntaxKind.ObjectLiteralExpression:
        return this.objectLiteral(node as ts.ObjectLiteralExpression, hint);
      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.FunctionExpression:
        return this.closure(node as ts.ArrowFunction, hint);
      case ts.SyntaxKind.AwaitExpression:
        return this.awaitExpr(node as ts.AwaitExpression);
      case ts.SyntaxKind.TypeOfExpression:
        return {
          c: cpp.call("lucent::typeOf", [
            this.asValue(this.expr((node as ts.TypeOfExpression).expression)).c,
          ]),
          t: T.string,
        };
      case ts.SyntaxKind.VoidExpression: {
        const e = this.expr((node as ts.VoidExpression).expression);
        const discarded = cpp.cast("c", cpp.voidType, e.c);
        return { c: cpp.comma(discarded, cpp.id("lucent::undefined")), t: T.undefined };
      }
      case ts.SyntaxKind.DeleteExpression:
        return this.deleteExpr(node as ts.DeleteExpression);
      default:
        fail(node, Codes.UnsupportedSyntax, `unsupported expression: ${ts.SyntaxKind[node.kind]}`);
    }
  }

  /** Applies the checker's narrowing at `node` to a value read. */
  narrowed(node: ts.Node, e: E): E {
    if (isOptionalChain(node)) return e;
    let t: LType;
    try {
      t = this.lt(node);
    } catch {
      return e;
    }
    if (t.k === "never" || sameType(t, e.t)) return e;

    if (e.t.k === "opt" && (t.k === "undefined" || t.k === "null")) return this.absent(node, e, t);

    // Only narrow (never widen) based on the checker.
    const toSubclass =
      e.t.k === "class" && t.k === "class" && e.t.id !== t.id && this.reg.derives(t.id, e.t.id);
    if (
      e.t.k === "opt" ||
      e.t.k === "union" ||
      ((e.t.k === "error" || e.t.k === "iface") && t.k === "class") ||
      toSubclass
    ) {
      return { c: this.coerce(e, t, node), t };
    }
    return e;
  }

  /**
   * An optional the checker proved absent at `node`: the constant, once `e`
   * ran. `null | undefined` is lowered as undefined but may hold either, so
   * that optional stays as it is.
   */
  private absent(node: ts.Node, e: E, t: LType & { k: "undefined" | "null" }): E {
    const type = this.checker.getTypeAtLocation(node);
    const members = type.isUnion() ? type.types : [type];

    if (t.k === "undefined" && members.some((m) => m.flags & ts.TypeFlags.Null)) return e;

    return { c: afterEffects(e.c, cpp.id(`lucent::${t.k}`)), t };
  }

  private template(node: ts.TemplateExpression): E {
    return this.templateInner(node);
  }

  private templateInner(node: ts.TemplateExpression): E {
    // Numbers go to lucent::concat unformatted (exact integers as such), so
    // the result is built with one allocation.
    const parts: cpp.Expr[] = [];
    if (node.head.text) parts.push(stringExpr(node.head.text));
    for (const span of node.templateSpans) {
      const e = this.expr(span.expression);
      parts.push(e.int ? e.int.c : e.t.k === "number" ? e.c : this.toStringCode(e));
      if (span.literal.text) parts.push(stringExpr(span.literal.text));
    }
    if (parts.length === 0) return { c: stringExpr(""), t: T.string };
    return { c: cpp.call("lucent::concat", parts), t: T.string };
  }

  toStringCode(e: E): cpp.Expr {
    return e.t.k === "string" ? e.c : cpp.call("lucent::toJsString", [this.asValue(e).c]);
  }

  /** A value to inspect: a call that returns nothing is a C++ void, and gives undefined once it ran. */
  asValue(e: E): E {
    return isVoidish(e.t) && !isPure(e.c)
      ? { c: afterEffects(e.c, cpp.id("lucent::undefined")), t: T.undefined }
      : e;
  }

  private identifier(id: ts.Identifier): E {
    if (isPlatformValue(this.checker, id))
      return this.ctx.platform
        ? { c: stringExpr(this.ctx.platform), t: T.string }
        : { c: this.platformOnly(id, cpp.type("lucent::String")), t: T.string };
    const text = id.text;
    const sym0 = symbolOf(this.checker, id);
    if (!sym0) {
      if (text === "undefined") return { c: cpp.id("lucent::undefined"), t: T.undefined };
      fail(id, Codes.UnsupportedSyntax, `unknown identifier ${text}`);
    }
    const sym = this.ctx.resolve(sym0);
    if (this.ctx.failed.has(sym)) throw new AlreadyReported();
    const local = this.findLocal(sym);
    if (local?.int) return this.intE(cpp.id(local.cpp), local.int);
    if (local) {
      const e: E = {
        c: local.boxed ? cpp.deref(cpp.id(local.cpp)) : cpp.id(local.cpp),
        t: local.type,
      };
      return this.narrowed(id, e);
    }
    const g = this.ctx.globals.get(sym);
    if (g) {
      // A literal constant is read as its literal: code on a compute task
      // must not read the storage a reload of JavaScript assigns again.
      if (g.kind === "var")
        return this.narrowed(id, {
          c: g.literal
            ? this.exprAs(g.literal, g.type)
            : assignedRead(cpp.id(g.cpp), g.type, g.decl.name.getText()),
          t: g.type,
        });
      if (g.kind === "function") {
        if (g.generic)
          fail(id, Codes.UnsupportedSyntax, "generic functions cannot be used as values");
        // A top-level function as a value: a lambda forwarding to it.
        const fnType = g.type;
        const params = g.params.map((p, i) => cpp.param(this.reg.cppType(p.cppType), `a${i}`));
        const args = g.params.map((_, i) => cpp.id(`a${i}`));
        const inner = fnType.ret.k === "promise" ? fnType.ret.inner : fnType.ret;
        const ret = g.async
          ? cpp.type("lucent::Promise", this.reg.cppRetType(inner))
          : this.reg.cppRetType(fnType.ret);
        const t: LType = { k: "fn", params: g.params.map((p) => p.cppType), ret: fnType.ret };
        const forward = cpp.lambda([], params, [cpp.ret(cpp.call(g.cpp, args))], { ret });
        return { c: cpp.construct(this.reg.cppType(t), [forward]), t };
      }
      fail(id, Codes.UnsupportedSyntax, `a class cannot be used as a value here`);
    }
    const sdkConstant = native.nativeConstant(this, id);
    if (sdkConstant) return sdkConstant;
    switch (text) {
      case "undefined":
        return { c: cpp.id("lucent::undefined"), t: T.undefined };
      case "NaN":
        return { c: cpp.id("lucent::kNaN"), t: T.number };
      case "Infinity":
        return { c: cpp.id("lucent::kInfinity"), t: T.number };
    }
    fail(id, Codes.UnsupportedSyntax, `unsupported reference to \`${text}\``);
  }

  private thisValue(node: ts.Node): E {
    if (!this.opts.cls)
      fail(node, Codes.UnsupportedSyntax, "`this` is only supported inside class members");
    const t = this.lt(node);
    return { c: this.selfRefExpr(), t };
  }

  /** `this`, or `self` where a coroutine holds it. */
  self(): cpp.Expr {
    return this.opts.thisExpr === "self" ? cpp.id("self") : cpp.self;
  }

  private prefix(node: ts.PrefixUnaryExpression): E {
    const op = node.operator;
    if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
      return this.increment(
        node.operand,
        op === ts.SyntaxKind.PlusPlusToken ? "+" : "-",
        false,
        node,
      );
    }
    // A negative literal is one constant: `-5n` is fromInt64(-5).
    if (op === ts.SyntaxKind.MinusToken && ts.isBigIntLiteral(node.operand))
      return { c: bigintExpr(-bigintLiteralValue(node.operand.text)), t: T.bigint };
    const e = this.expr(node.operand);
    if (e.t.k === "bigint") return this.bigintPrefix(op, e, node);
    if (numericUnion(e.t) && op === ts.SyntaxKind.MinusToken)
      return { c: cpp.call("lucent::negateNumeric", [e.c]), t: e.t };
    if (numericUnion(e.t) && op === ts.SyntaxKind.TildeToken)
      return { c: cpp.call("lucent::bitNotNumeric", [e.c]), t: e.t };
    switch (op) {
      case ts.SyntaxKind.ExclamationToken:
        return {
          c: cpp.not(this.truthy(e, node)),
          t: T.boolean,
        };
      case ts.SyntaxKind.MinusToken:
        return { c: cpp.unary("-", this.coerce(e, T.number, node)), t: T.number };
      case ts.SyntaxKind.PlusToken:
        if (stripOpt(e.t).k === "string")
          return {
            c: cpp.call("lucent::stringToNumber", [this.coerce(e, T.string, node)]),
            t: T.number,
          };
        return { c: this.coerce(e, T.number, node), t: T.number };
      case ts.SyntaxKind.TildeToken:
        return this.intE(cpp.unary("~", this.i32(e, node)), "i32");
    }
    fail(node, Codes.UnsupportedOperator, "unsupported prefix operator");
  }

  /** `!x`, `-x` and `~x` on a bigint; `+x` throws in JavaScript, and TypeScript rejects it. */
  private bigintPrefix(op: ts.PrefixUnaryOperator, e: E, node: ts.Node): E {
    switch (op) {
      case ts.SyntaxKind.ExclamationToken:
        return { c: cpp.not(cpp.call("lucent::truthy", [e.c])), t: T.boolean };
      case ts.SyntaxKind.MinusToken:
        return { c: cpp.unary("-", e.c), t: T.bigint };
      case ts.SyntaxKind.TildeToken:
        return { c: cpp.unary("~", e.c), t: T.bigint };
    }
    fail(node, Codes.UnsupportedOperator, "unary plus cannot convert a bigint to a number");
  }

  private postfix(node: ts.PostfixUnaryExpression): E {
    return this.increment(
      node.operand,
      node.operator === ts.SyntaxKind.PlusPlusToken ? "+" : "-",
      true,
      node,
    );
  }

  /** ++x, x++, --x, x-- on locals, fields and elements. */
  private increment(target: ts.Expression, sign: "+" | "-", postfix: boolean, node: ts.Node): E {
    return this.incrementPlace(target, sign, postfix, node);
  }

  private incrementPlace(
    target: ts.Expression,
    sign: "+" | "-",
    postfix: boolean,
    _node: ts.Node,
  ): E {
    const op = sign === "+" ? "++" : "--";
    const step = (x: cpp.Expr) => (postfix ? cpp.postfix(op, x) : cpp.unary(op, x));
    const type = this.lvalueType(target);
    if (type?.k === "bigint") return this.bigintIncrement(target, sign, postfix);
    if (type && numericUnion(type)) return this.numericIncrement(target, type, sign, postfix);
    const il = this.intLocal(target);
    if (il) return { c: cpp.staticCast(cpp.type("double"), step(cpp.id(il.cpp))), t: T.number };
    const lv = this.lvalue(target);
    if (lv.direct) return { c: step(lv.direct), t: T.number };
    // Read, write back the new value, give the old (postfix) or the new one.
    const tmpName = this.ctx.fresh("v");
    const tmp = cpp.id(tmpName);
    const next = cpp.binary(tmp, sign, cpp.num(1));
    return {
      c: cpp.statementExpr(
        [cpp.varDecl(cpp.type("double"), tmpName, lv.get), cpp.exprStmt(lv.set!(next))],
        postfix ? tmp : next,
      ),
      t: T.number,
    };
  }

  /** `x++` and the others on a bigint: `x ± 1n`, stored, giving the old or the new value. */
  private bigintIncrement(target: ts.Expression, sign: "+" | "-", postfix: boolean): E {
    const lv = this.lvalue(target);
    const one = bigintExpr(1n);
    const t = cpp.type("lucent::BigInt");
    if (lv.direct && !postfix)
      return { c: cpp.assign(lv.direct, one, `${sign}=` as cpp.AssignOp), t: T.bigint };
    const [oldName, nextName] = [this.ctx.fresh("v"), this.ctx.fresh("v")];
    const [old, next] = [cpp.id(oldName), cpp.id(nextName)];
    return {
      c: cpp.statementExpr(
        [
          cpp.varDecl(t, oldName, lv.get),
          cpp.varDecl(t, nextName, cpp.binary(old, sign, one)),
          cpp.exprStmt(lv.direct ? cpp.assign(lv.direct, next) : lv.set!(next)),
        ],
        postfix ? old : next,
      ),
      t: T.bigint,
    };
  }

  /** `x++` and the others on a `bigint | number`: stepped on the kind it holds, stored. */
  private numericIncrement(
    target: ts.Expression,
    type: LType,
    sign: "+" | "-",
    postfix: boolean,
  ): E {
    const lv = this.lvalue(target);
    const t = this.reg.cppType(type);
    const [oldName, nextName] = [this.ctx.fresh("v"), this.ctx.fresh("v")];
    const [old, next] = [cpp.id(oldName), cpp.id(nextName)];
    const stepped = cpp.call("lucent::stepNumeric", [old, cpp.num(sign === "+" ? 1 : -1)]);

    return {
      c: cpp.statementExpr(
        [
          cpp.varDecl(t, oldName, lv.get),
          cpp.varDecl(t, nextName, stepped),
          cpp.exprStmt(lv.direct ? cpp.assign(lv.direct, next) : lv.set!(next)),
        ],
        postfix ? old : next,
      ),
      t: type,
    };
  }

  /** An assignable place. */
  lvalue(target: ts.Expression): Lvalue {
    // `xs[i]! += 1`: the element is present (reading it checks), so it is the place.
    if (ts.isParenthesizedExpression(target) || ts.isNonNullExpression(target))
      return this.lvalue(target.expression);
    const place = (c: cpp.Expr, type: LType): Lvalue => ({ direct: c, get: c, type });
    if (ts.isIdentifier(target)) {
      const sym = this.ctx.resolve(symbolOf(this.checker, target)!);
      if (this.ctx.failed.has(sym)) throw new AlreadyReported();
      const local = this.findLocal(sym);
      if (local?.int) {
        const kind = local.int;
        const x = cpp.id(local.cpp);
        return {
          get: cpp.staticCast(cpp.type("double"), x),
          set: (v) => cpp.assign(x, this.toKind({ c: v, t: T.number }, kind, target)),
          type: T.number,
        };
      }
      if (local)
        return place(local.boxed ? cpp.deref(cpp.id(local.cpp)) : cpp.id(local.cpp), local.type);
      const g = this.ctx.globals.get(sym);
      if (g && g.kind === "var") return place(cpp.id(g.cpp), g.type);
      fail(target, Codes.UnsupportedAssignmentTarget, `cannot assign to ${target.text}`);
    }
    if (ts.isPropertyAccessExpression(target)) {
      const name = target.name.text;
      if (ts.isIdentifier(target.expression)) {
        const nativeStatic = native.nativeLvalue(this, target, undefined);
        if (nativeStatic) return nativeStatic;
        const staticLv = builtins.staticMemberLvalue(this, target);
        if (staticLv) return staticLv;
      }
      const obj = this.receiver(target.expression);
      const ot = stripOpt(obj.t);
      if (ot.k === "native") {
        const lv = native.nativeLvalue(this, target, obj);
        if (lv) return lv;
      }
      if (ot.k === "struct") {
        const f = this.reg.struct(ot.id).fields.find((x) => x.name === name);
        if (!f) fail(target, Codes.UnsupportedAssignmentTarget, `unknown field ${name}`);
        return place(cpp.arrow(this.coerce(obj, ot, target), cppIdent(name)), f.type);
      }
      if (ot.k === "class") return builtins.classMemberLvalue(this, obj, ot, name, target);
      if (ot.k === "iface") return builtins.ifaceMemberLvalue(this, obj, ot, name, target);
      if (ot.k === "regexp" && name === "lastIndex")
        return place(cpp.arrow(obj.c, "lastIndex"), T.number);
      if (ot.k === "array" && name === "length") {
        return {
          get: cpp.call(cpp.dot(obj.c, "length")),
          set: (v) => cpp.call(cpp.dot(obj.c, "setLength"), [v]),
          type: T.number,
        };
      }
      fail(
        target,
        Codes.UnsupportedAssignmentTarget,
        `cannot assign to .${name} of ${typeKey(obj.t)}`,
      );
    }
    if (ts.isElementAccessExpression(target)) {
      const obj = this.expr(target.expression);
      const ot = stripOpt(obj.t);
      if (ot.k === "array" || ot.k === "bytes" || (ot.k === "span" && ot.writable)) {
        const elemT = ot.k === "array" ? ot.e : T.number;
        const idx = this.exprAs(target.argumentExpression, T.number);
        return {
          get: cpp.call("lucent::elementAt", [obj.c, idx]),
          set: (v) => cpp.call("lucent::setElement", [obj.c, idx, v]),
          type: elemT,
        };
      }
      if (ot.k === "dict") {
        const key = this.exprAs(target.argumentExpression, T.string);
        return {
          get: cpp.call("lucent::entryAt", [obj.c, key]),
          set: (v) => cpp.call("lucent::setEntry", [obj.c, key, v]),
          type: ot.val,
        };
      }
      fail(
        target,
        Codes.UnsupportedAssignmentTarget,
        `cannot assign to an element of ${typeKey(obj.t)}`,
      );
    }
    fail(target, Codes.UnsupportedAssignmentTarget, "unsupported assignment target");
  }

  /** `target = value` as an expression. */
  assignTo(target: ts.Expression, value: E, node: ts.Node): cpp.Expr {
    const discard = (x: cpp.Expr) => cpp.exprStmt(cpp.cast("c", cpp.voidType, x));
    if (ts.isArrayLiteralExpression(target)) {
      const tmpName = this.ctx.fresh("da");
      const tmp = cpp.id(tmpName);
      const parts: cpp.Stmt[] = [cpp.varDecl(cpp.auto, tmpName, value.c)];
      const vt = stripOpt(value.t);
      target.elements.forEach((el, i) => {
        if (ts.isOmittedExpression(el)) return;
        if (ts.isSpreadElement(el))
          fail(
            el,
            Codes.UnsupportedDestructuring,
            "rest elements in destructuring assignments are not supported",
          );
        const v: E =
          vt.k === "tuple"
            ? { c: cpp.call("std::get", [tmp], [cpp.num(i)]), t: vt.es[i]! }
            : vt.k === "array"
              ? {
                  c: cpp.call(cpp.dot(tmp, "get"), [numberExpr(i)]),
                  t: unionOf([vt.e, T.undefined]),
                }
              : fail(el, Codes.UnsupportedDestructuring, "cannot destructure this value");
        parts.push(discard(this.assignElement(el, v)));
      });
      return cpp.statementExpr(parts, tmp);
    }
    if (ts.isObjectLiteralExpression(target)) {
      const tmpName = this.ctx.fresh("do");
      const tmp = cpp.id(tmpName);
      const parts: cpp.Stmt[] = [cpp.varDecl(cpp.auto, tmpName, value.c)];
      const src: E = { c: tmp, t: value.t };
      for (const p of target.properties) {
        if (ts.isShorthandPropertyAssignment(p)) {
          let v = this.member(src, p.name.text, p);
          if (p.objectAssignmentInitializer)
            v = this.withDefault(v, p.objectAssignmentInitializer, p);
          parts.push(discard(this.assignTo(p.name, v, p)));
        } else if (
          ts.isPropertyAssignment(p) &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
        ) {
          parts.push(discard(this.assignElement(p.initializer, this.member(src, p.name.text, p))));
        } else {
          fail(
            p,
            Codes.UnsupportedDestructuring,
            "only named properties can be destructured in assignments",
          );
        }
      }
      return cpp.statementExpr(parts, tmp);
    }
    const il = this.intLocal(target);
    if (il)
      return cpp.staticCast(
        cpp.type("double"),
        cpp.assign(cpp.id(il.cpp), this.toKind(value, il.int!, node)),
      );
    const lv = this.lvalue(target);
    if (lv.assign) return lv.assign(value);

    const v = this.coerce(value, lv.type, node);
    if (lv.direct) return cpp.assign(lv.direct, v);
    return lv.set!(v);
  }

  /** One element of a destructuring assignment: `x`, `x = default`, or a nested pattern. */
  private assignElement(el: ts.Expression, v: E): cpp.Expr {
    if (ts.isBinaryExpression(el) && el.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return this.assignTo(el.left, this.withDefault(v, el.right, el), el);
    }
    return this.assignTo(el, v, el);
  }

  private binary(node: ts.BinaryExpression): E {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.EqualsToken) {
      const lvType = this.lvalueType(node.left);
      const assign = (): E => {
        const value = this.expr(node.right, lvType);

        return { c: this.assignTo(node.left, value, node), t: lvType ?? value.t };
      };

      return assign();
    }
    const compound = ASSIGN_OPS.get(op);
    if (compound) return this.compoundAssign(node, compound);
    if (
      op === ts.SyntaxKind.QuestionQuestionEqualsToken ||
      op === ts.SyntaxKind.BarBarEqualsToken ||
      op === ts.SyntaxKind.AmpersandAmpersandEqualsToken
    )
      return this.logicalAssign(node, op);
    switch (op) {
      case ts.SyntaxKind.AmpersandAmpersandToken:
      case ts.SyntaxKind.BarBarToken:
        return this.logical(node, op === ts.SyntaxKind.AmpersandAmpersandToken);
      case ts.SyntaxKind.QuestionQuestionToken:
        return this.nullish(node);
      case ts.SyntaxKind.CommaToken: {
        const a = this.expr(node.left);
        const b = this.expr(node.right);
        return { c: cpp.comma(cpp.cast("c", cpp.voidType, a.c), b.c), t: b.t };
      }
      case ts.SyntaxKind.InstanceOfKeyword:
        return builtins.instanceOf(this, node);
      case ts.SyntaxKind.InKeyword:
        return builtins.keyIn(this, node);
    }
    return this.binaryOp(node, op);
  }

  private binaryOp(node: ts.BinaryExpression, op: ts.SyntaxKind): E {
    const a = this.expr(node.left);
    const b = this.expr(node.right);
    const text = node.operatorToken.getText();
    const concatenates =
      op === ts.SyntaxKind.PlusToken && [a, b].some((e) => stripOpt(e.t).k === "string");
    if ((a.t.k === "bigint" || b.t.k === "bigint") && !concatenates && !EQUALITY_OPS.includes(text))
      return this.bigintOp(text, a, b, node);
    switch (op) {
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
        return { c: this.equality(a, b, true, node), t: T.boolean };
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        return { c: cpp.not(this.equality(a, b, true, node)), t: T.boolean };
      case ts.SyntaxKind.EqualsEqualsToken:
        this.looseConverting(a.t, b.t, node);
        return { c: this.equality(a, b, false, node), t: T.boolean };
      case ts.SyntaxKind.ExclamationEqualsToken:
        this.looseConverting(a.t, b.t, node);
        return { c: cpp.not(this.equality(a, b, false, node)), t: T.boolean };
      case ts.SyntaxKind.PlusToken: {
        const at = stripOpt(a.t),
          bt = stripOpt(b.t);
        if (at.k === "string" || bt.k === "string") {
          // A string on the left is a lucent::String, so + concatenates.
          const left =
            at.k === "string" && a.t.k !== "opt"
              ? cpp.construct(cpp.type("lucent::String"), [a.c])
              : this.toStringCode(a);
          return { c: cpp.binary(left, "+", this.toStringCode(b)), t: T.string };
        }
        return this.arith(a, b, "+", node);
      }
      case ts.SyntaxKind.MinusToken:
        return this.arith(a, b, "-", node);
      case ts.SyntaxKind.AsteriskToken:
        return this.arith(a, b, "*", node);
      case ts.SyntaxKind.SlashToken:
        return this.arith(a, b, "/", node);
      case ts.SyntaxKind.PercentToken:
        return {
          c: cpp.call("lucent::jsMod", [this.num(a, node), this.num(b, node)]),
          t: T.number,
        };
      case ts.SyntaxKind.AsteriskAsteriskToken:
        return {
          c: cpp.call("lucent::jsPow", [this.num(a, node), this.num(b, node)]),
          t: T.number,
        };
      case ts.SyntaxKind.AmpersandToken:
        return this.bitwise("&", a, b, node);
      case ts.SyntaxKind.BarToken:
        return this.bitwise("|", a, b, node);
      case ts.SyntaxKind.CaretToken:
        return this.bitwise("^", a, b, node);
      case ts.SyntaxKind.LessThanLessThanToken:
        return this.bitwise("<<", a, b, node);
      case ts.SyntaxKind.GreaterThanGreaterThanToken:
        return this.bitwise(">>", a, b, node);
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
        return this.bitwise(">>>", a, b, node);
      case ts.SyntaxKind.LessThanToken:
      case ts.SyntaxKind.GreaterThanToken:
      case ts.SyntaxKind.LessThanEqualsToken:
      case ts.SyntaxKind.GreaterThanEqualsToken: {
        const sym = node.operatorToken.getText() as cpp.BinaryOp;

        if (comparesMixed(a.t, b.t))
          return {
            c: cpp.binary(cpp.call("lucent::compareNumeric", [a.c, b.c]), sym, cpp.num(0)),
            t: T.boolean,
          };

        const as = stripOpt(a.t).k === "string" ? T.string : T.number;
        return {
          c: cpp.binary(this.coerce(a, as, node), sym, this.coerce(b, as, node)),
          t: T.boolean,
        };
      }
    }
    fail(node, Codes.UnsupportedOperator, `unsupported operator ${node.operatorToken.getText()}`);
  }

  private lvalueType(target: ts.Expression): LType | undefined {
    try {
      if (ts.isArrayLiteralExpression(target)) return undefined;

      // One that takes values of their own type: the value is evaluated as it is.
      const lv = this.lvalue(target);
      return lv.assign ? undefined : lv.type;
    } catch {
      return undefined;
    }
  }

  num(e: E, node: ts.Node): cpp.Expr {
    return this.coerce(e, T.number, node);
  }

  /**
   * `a op b` with a bigint operand: the runtime's BigInt operators, and
   * exact comparisons with numbers. JavaScript throws a TypeError when the
   * other operand of an arithmetic operator is not a bigint, and
   * TypeScript rejects that; so does Lucent, should it get here.
   */
  private bigintOp(op: string, a: E, b: E, node: ts.Node): E {
    if (BIGINT_COMPARISONS.includes(op)) {
      const ordered = (e: E) => e.t.k === "bigint" || e.t.k === "number";
      if (!ordered(a) || !ordered(b))
        fail(
          node,
          Codes.UnsupportedOperator,
          `\`${op}\` compares a bigint with a bigint or a number only`,
        );
      return { c: cpp.binary(a.c, op as cpp.BinaryOp, b.c), t: T.boolean };
    }
    const apply = BIGINT_OPERATORS[op];
    if (!apply)
      fail(
        node,
        Codes.UnsupportedOperator,
        `\`${op}\` is not defined on bigints (JavaScript throws a TypeError)`,
      );
    if (a.t.k !== "bigint" || b.t.k !== "bigint")
      fail(
        node,
        Codes.UnsupportedOperator,
        `\`${op}\` cannot mix a bigint with a ${typeKey(a.t.k === "bigint" ? b.t : a.t)}; convert with BigInt() or Number() first`,
      );
    return { c: apply(a.c, b.c), t: T.bigint };
  }

  private arith(a: E, b: E, op: cpp.BinaryOp, node: ts.Node): E {
    return { c: cpp.binary(this.num(a, node), op, this.num(b, node)), t: T.number };
  }

  /**
   * Refuses a call or `new` whose type arguments a generic cannot take
   * (instantiations.ts): a union holding a type parameter that would lose
   * its shape, or a comparison that becomes one between functions or a
   * converting loose `==`.
   */
  /** The checks a generic asks of its type arguments: `retarget`'s, when a `new` builds another instantiation. */
  private checkInstance(
    node: ts.CallExpression | ts.NewExpression,
    retarget?: Map<string, LType>,
  ): void {
    const lower = (t: ts.Type, at: ts.Node) => this.reg.lower(t, at);
    const instance = instanceAt(this.checker, lower, node);
    if (!instance) return;

    const { comparisons, types } = genericFacts(this.checker, lower, instance.generic);
    const { name, written } = instance;
    const args = retarget ?? instance.args;

    for (const t of types) {
      const broken = unionShapeBreak(t, args);
      if (!broken) continue;

      const arg = retarget
        ? this.spelled(retarget.get(broken.param)!)
        : this.checker.typeToString(written.get(broken.param)!);

      fail(
        node,
        Codes.UnsupportedType,
        `${name} puts its \`${broken.param}\` in a union, which \`${arg}\` would merge into (a union, an optional, null, undefined, or a type the union already holds); pass a type that stays one member`,
      );
    }

    for (const c of comparisons) {
      const [left, right] = [substitute(c.left, args), substitute(c.right, args)];
      const conversion = c.loose ? looseConversion(left, right) : undefined;

      if (holdsFunction(left) && holdsFunction(right))
        fail(
          node,
          Codes.UnsupportedOperator,
          functionsNotCompared(`, and ${name} compares two here`),
        );
      if (conversion)
        fail(node, Codes.UnsupportedOperator, `${looseConversionMessage(conversion)} (in ${name})`);
    }
  }

  /** `===` (strict) or `==` between two values; `node` is the comparison, for diagnostics. */
  equality(left: E, right: E, strict: boolean, node: ts.Node): cpp.Expr {
    const [a, b] = [this.asValue(left), this.asValue(right)];
    const at = a.t,
      bt = b.t;
    const absent = (t: LType) => t.k === "undefined" || t.k === "null";
    // Types that can hold null or undefined: a template parameter may be
    // instantiated with an optional type.
    const mayBeAbsent = (t: LType): boolean =>
      t.k === "opt" ||
      t.k === "void" ||
      t.k === "tparam" ||
      t.k === "never" ||
      absent(t) ||
      (t.k === "union" && t.ms.some(mayBeAbsent));
    // A present value is never null or undefined; it is still evaluated.
    const never = (e: E) => cpp.comma(cpp.cast("c", cpp.voidType, e.c), cpp.bool(false));
    const holdsTypeParameter = (t: LType): boolean =>
      t.k === "tparam" || (t.k === "union" && t.ms.some(holdsTypeParameter));
    if (!strict && (absent(bt) || absent(at))) {
      const [other, known] = absent(bt) ? [a, b] : [b, a];
      const result = (c: cpp.Expr) => afterEffects(known.c, c);

      if (other.t.k === "opt") return result(cpp.not(cpp.call(cpp.dot(other.c, "has"))));
      if (absent(other.t)) return afterEffects(other.c, result(cpp.bool(true)));
      // A template parameter's type is known once instantiated.
      if (holdsTypeParameter(other.t))
        return result(cpp.call("lucent::looseEqualsNull", [other.c]));
      return result(never(other));
    }
    if (absent(at) !== absent(bt)) {
      const other = absent(bt) ? a : b;
      if (!mayBeAbsent(other.t)) return never(other);
    }
    const same = (k: LType["k"]) => at.k === k && bt.k === k;
    if (same("number") || same("boolean") || same("string") || same("bigint"))
      return cpp.binary(a.c, "==", b.c);
    if (holdsFunction(at) && holdsFunction(bt))
      fail(
        node,
        Codes.UnsupportedOperator,
        functionsNotCompared(` (\`${strict ? "===" : "=="}\`)`),
      );
    // Loosely, undefined and null are equal: two values that may each be
    // one compare with looseEquals.
    const loose = !strict && mayBeAbsent(at) && mayBeAbsent(bt);
    return cpp.call(loose ? "lucent::looseEquals" : "lucent::strictEquals", [a.c, b.c]);
  }

  /** Refuses a loose `==` that JavaScript would convert for (lowering/loose-equality.ts). */
  private looseConverting(a: LType, b: LType, node: ts.Node): void {
    const conversion = looseConversion(a, b);

    if (conversion) fail(node, Codes.UnsupportedOperator, looseConversionMessage(conversion));
  }

  /**
   * `target op= value`. JavaScript reads the target before the right side
   * runs; C++ evaluates the right side of `x += y` first. When the right
   * side could write the target, the target is read into a temporary
   * before it runs.
   */
  private compoundAssign(node: ts.BinaryExpression, op: string): E {
    const readFirst =
      !isSimple(node.right) && !this.unchangedBy(unwrapTarget(node.left), node.right);

    return readFirst ? this.readThenAssign(node, op) : this.assignInPlace(node, op);
  }

  /**
   * `e`, run into a temporary named `name`, and the value that reads it.
   * Integers stay integers. A call that returns nothing, or always throws,
   * has no value to hold: it runs, and reads as undefined.
   */
  private hold(name: string, e: E): { run: cpp.Stmt[]; value: E } {
    if (isVoidish(e.t) && !isPure(e.c))
      return {
        run: e.t.k === "never" ? this.diverging(e) : [cpp.exprStmt(e.c)],
        value: { c: cpp.id("lucent::undefined"), t: e.t },
      };

    return {
      run: [cpp.varDecl(cpp.auto, name, e.int ? e.int.c : e.c)],
      value: e.int ? this.intE(cpp.id(name), e.int.kind) : { c: cpp.id(name), t: e.t },
    };
  }

  /** `target op= value` as: read the target, run the right side, combine, store. */
  private readThenAssign(node: ts.BinaryExpression, op: string): E {
    const lv = this.lvalue(node.left);
    const lt = stripOpt(lv.type);
    const [curName, rhsName, valueName] = [
      this.ctx.fresh("cur"),
      this.ctx.fresh("rhs"),
      this.ctx.fresh("v"),
    ];
    const read = cpp.varDecl(cpp.auto, curName, this.coerce({ c: lv.get, t: lv.type }, lt, node));
    const rhs = this.hold(rhsName, this.expr(node.right));
    const value = this.combine(op, { c: cpp.id(curName), t: lt }, rhs.value, node);
    const v = cpp.id(valueName);
    const store = lv.direct ? cpp.assign(lv.direct, v) : lv.set!(v);

    return {
      c: cpp.statementExpr(
        [read, ...rhs.run, cpp.varDecl(cpp.auto, valueName, value.c), cpp.exprStmt(store)],
        v,
      ),
      t: value.t,
    };
  }

  /** `cur op value` for a compound assignment operator. */
  private combine(op: string, cur: E, value: E, node: ts.Node): E {
    if (op === "+" && cur.t.k === "string") {
      const left = cpp.construct(cpp.type("lucent::String"), [cur.c]);

      return { c: cpp.binary(left, "+", this.toStringCode(value)), t: T.string };
    }

    if (cur.t.k === "bigint") return this.bigintOp(op, cur, value, node);

    if (BITWISE.includes(op)) return this.bitwise(op, cur, value, node);

    const helper = FN_OPS[op];

    if (helper)
      return {
        c: cpp.call(`lucent::${helper}`, [this.num(cur, node), this.num(value, node)]),
        t: T.number,
      };

    return this.arith(cur, value, op as cpp.BinaryOp, node);
  }

  /** `target op= value` when the right side cannot write the target. */
  private assignInPlace(node: ts.BinaryExpression, op: string): E {
    const il = this.intLocal(node.left);
    if (il?.int === "i64" && (op === "+" || op === "-")) {
      const value = this.toKind(this.expr(node.right), "i64", node);
      return {
        c: cpp.staticCast(
          cpp.type("double"),
          cpp.assign(cpp.id(il.cpp), value, `${op}=` as cpp.AssignOp),
        ),
        t: T.number,
      };
    }
    if (il && BITWISE.includes(op)) {
      const r = this.bitwise(op, this.intE(cpp.id(il.cpp), il.int!), this.expr(node.right), node);
      return {
        c: cpp.staticCast(
          cpp.type("double"),
          cpp.assign(cpp.id(il.cpp), this.toKind(r, il.int!, node)),
        ),
        t: T.number,
      };
    }
    const lv = this.lvalue(node.left);
    const rhs = this.expr(node.right);
    const lt = stripOpt(lv.type);
    let combine: (cur: cpp.Expr) => cpp.Expr;
    if (op === "+" && lt.k === "string") {
      const r = this.toStringCode(rhs);
      if (lv.direct && lv.type.k === "string")
        return { c: cpp.assign(lv.direct, r, "+="), t: T.string };
      combine = (cur) => cpp.binary(cpp.construct(cpp.type("lucent::String"), [cur]), "+", r);
    } else if (lt.k === "bigint") {
      if (lv.direct && lv.type.k === "bigint" && op !== "**" && rhs.t.k === "bigint")
        return { c: cpp.assign(lv.direct, rhs.c, `${op}=` as cpp.AssignOp), t: T.bigint };
      combine = (cur) => this.bigintOp(op, { c: cur, t: T.bigint }, rhs, node).c;
    } else {
      const r = this.num(rhs, node);
      if (["+", "-", "*", "/"].includes(op)) {
        if (lv.direct && lv.type.k === "number")
          return { c: cpp.assign(lv.direct, r, `${op}=` as cpp.AssignOp), t: T.number };
        combine = (cur) => cpp.binary(cur, op as cpp.BinaryOp, r);
      } else if (BITWISE.includes(op))
        combine = (cur) => this.bitwise(op, { c: cur, t: T.number }, rhs, node).c;
      else combine = (cur) => cpp.call(`lucent::${FN_OPS[op]}`, [cur, r]);
    }
    const cur = this.coerce({ c: lv.get, t: lv.type }, lt, node);
    if (lv.direct) return { c: cpp.assign(lv.direct, combine(cur)), t: lt };
    const tmpName = this.ctx.fresh("v");
    const tmp = cpp.id(tmpName);
    return {
      c: cpp.statementExpr(
        [cpp.varDecl(cpp.auto, tmpName, combine(cur)), cpp.exprStmt(lv.set!(tmp))],
        tmp,
      ),
      t: lt,
    };
  }

  /** `??=`, `||=`, `&&=`: the right side runs, and is stored, only when the test passes. */
  private logicalAssign(node: ts.BinaryExpression, op: ts.SyntaxKind): E {
    const lv = this.lvalue(node.left);
    const cur: E = { c: lv.get, t: lv.type };
    const test =
      op === ts.SyntaxKind.QuestionQuestionEqualsToken
        ? cpp.not(cpp.call(cpp.dot(lv.get, "has")))
        : op === ts.SyntaxKind.BarBarEqualsToken
          ? cpp.not(cpp.call("lucent::truthy", [lv.get]))
          : cpp.call("lucent::truthy", [lv.get]);
    const value = this.expr(node.right, lv.type);
    const run = this.diverges(node.right)
      ? this.diverging(value)
      : [cpp.exprStmt(this.assignTo(node.left, value, node))];

    return {
      c: cpp.statementExpr([cpp.ifStmt(test, run)], this.coerce(cur, lv.type, node)),
      t: lv.type,
    };
  }

  private logical(node: ts.BinaryExpression, isAnd: boolean): E {
    const a = this.expr(node.left);

    // `never || b` throws before there is a value to test, or `b` runs.
    if (a.t.k === "never") {
      const t = this.lt(node);

      return { c: this.coerce(a, t, node), t };
    }

    const b = this.expr(node.right);
    if (a.t.k === "boolean" && b.t.k === "boolean")
      return { c: cpp.binary(a.c, isAnd ? "&&" : "||", b.c), t: T.boolean };
    // Evaluated once; the result is one operand or the other, as in JavaScript.
    const t = this.lt(node);
    const tmpName = this.ctx.fresh("l");
    const tmp = cpp.id(tmpName);
    const test = a.t.k === "boolean" ? tmp : cpp.call("lucent::truthy", [tmp]);
    const left = this.coerceNarrowed({ c: tmp, t: a.t }, t, node);
    const decl = cpp.varDecl(cpp.auto, tmpName, a.c);

    // `a || never` throws when `a` is falsy, `a && never` when it is truthy: otherwise it is `a`.
    if (this.diverges(node.right)) {
      const runs = isAnd ? test : cpp.not(test);

      return { c: cpp.statementExpr([decl, cpp.ifStmt(runs, this.diverging(b))], left), t };
    }

    const right = this.coerce(b, t, node);
    const pick = isAnd ? cpp.conditional(test, right, left) : cpp.conditional(test, left, right);
    return { c: cpp.statementExpr([decl], pick), t };
  }

  /** Coerces a value whose runtime value is known (by a branch) to fit `to`. */
  private coerceNarrowed(e: E, to: LType, node: ts.Node): cpp.Expr {
    try {
      return this.coerce(e, to, node);
    } catch {
      return cpp.call("lucent::convert", [e.c], [this.reg.cppType(to)]);
    }
  }

  private nullish(node: ts.BinaryExpression): E {
    const a = this.expr(node.left);
    const t = this.lt(node);
    const b = this.expr(node.right, t);
    // Always absent: the right side, after the left side runs.
    if (a.t.k === "undefined" || a.t.k === "null")
      return { c: afterEffects(a.c, this.coerce(b, t, node)), t };

    if (a.t.k !== "opt") return { c: this.coerce(a, t, node), t };
    const tmpName = this.ctx.fresh("n");
    const tmp = cpp.id(tmpName);
    const present = this.coerce({ c: cpp.call(cpp.dot(tmp, "get")), t: a.t.inner }, t, node);
    const has = cpp.call(cpp.dot(tmp, "has"));
    const decl = cpp.varDecl(cpp.auto, tmpName, a.c);

    // `a ?? never` throws when `a` is absent: otherwise it is what `a` holds.
    if (this.diverges(node.right))
      return {
        c: cpp.statementExpr([decl, cpp.ifStmt(cpp.not(has), this.diverging(b))], present),
        t,
      };

    const pick = cpp.conditional(has, present, this.coerce(b, t, node));
    return { c: cpp.statementExpr([decl], pick), t };
  }

  /** Whether an expression never gives a value: its type is `never` (a call that always throws). */
  private diverges(node: ts.Expression): boolean {
    return (this.checker.getTypeAtLocation(node).flags & ts.TypeFlags.Never) !== 0;
  }

  /**
   * Runs an operand typed `never` as a statement: it has no value to pick,
   * so the expression it is part of gives the other operand. A value that
   * lied about never completing (a JavaScript callback) throws.
   */
  private diverging(never: E): cpp.Stmt[] {
    return [
      cpp.exprStmt(cpp.cast("c", cpp.voidType, never.c)),
      cpp.exprStmt(cpp.call("lucent::unreachable")),
    ];
  }

  /**
   * A `to` that is never given: `never` runs, and throws. A value that
   * lied about never completing (a JavaScript callback) throws then.
   */
  private unreachableAs(never: E, to: LType): cpp.Expr {
    return afterEffects(never.c, this.unreachable(to));
  }

  /** A `to` there is none of: lucent::unreachable(), in a lambda that returns one. */
  private unreachable(to: LType): cpp.Expr {
    const none = cpp.lambda([], [], [cpp.exprStmt(cpp.call("lucent::unreachable"))], {
      ret: this.reg.cppType(to),
    });

    return cpp.call(none);
  }

  private conditional(node: ts.ConditionalExpression, hint?: LType): E {
    const guard = platformGuard(this.checker, node.condition);
    if (guard && !this.ctx.platform) {
      // A branch's type: the other's may be untyped (its SDK missing here).
      const typed =
        [node.whenTrue, node.whenFalse].find(
          (b) => !(this.checker.getTypeAtLocation(b).flags & ts.TypeFlags.Any),
        ) ?? node;
      const t = this.lt(typed);
      return { c: this.platformOnly(node, this.ctx.reg.cppType(t)), t };
    }
    if (guard && guard.platform !== this.ctx.platform) return this.expr(node.whenFalse, hint);
    if (guard && !guard.rest.length) return this.expr(node.whenTrue, hint);

    // The type the value is used as, when it has one, as for a literal on its own: the checker's
    // type is the union of the branches', where each object literal has a shape of its own. Not
    // for promises: an async function's return awaits the value before it converts to that type.
    const own = this.lt(node);
    const promised =
      own.k === "promise" || (own.k === "union" && own.ms.some((m) => m.k === "promise"));
    const t = hint && hint.k !== "void" && !promised ? hint : own;
    const test = guard
      ? cpp.and(...guard.rest.map((r) => this.cond(r)))
      : this.cond(node.condition);
    const a = this.expr(node.whenTrue, t);
    const b = this.expr(node.whenFalse, t);

    // One branch never gives a value: it runs when its side of the test holds, else the other gives it.
    const [trueNever, falseNever] = [this.diverges(node.whenTrue), this.diverges(node.whenFalse)];

    if (trueNever !== falseNever) {
      const [never, other, runs] = trueNever
        ? [a, { e: b, node: node.whenFalse }, test]
        : [b, { e: a, node: node.whenTrue }, cpp.not(test)];

      return {
        c: cpp.statementExpr(
          [cpp.ifStmt(runs, this.diverging(never))],
          this.coerce(other.e, t, other.node),
        ),
        t,
      };
    }

    return {
      c: cpp.conditional(test, this.coerce(a, t, node.whenTrue), this.coerce(b, t, node.whenFalse)),
      t,
    };
  }

  private awaitExpr(node: ts.AwaitExpression): E {
    if (!this.opts.async) fail(node, Codes.UnsupportedSyntax, "`await` outside an async function");
    const e = this.expr(node.expression);
    const t = stripOpt(e.t);

    // A native object is no promise, whatever its API: the listener or
    // callback that reports its completion, adapted with fromCallback, is.
    if (t.k === "native")
      fail(
        node,
        Codes.AwaitNative,
        `\`await\` does not wait for a native ${t.name}: it is not a promise. Wrap the listener or callback that reports its completion in fromCallback (lucent:core) and await that promise`,
      );

    if (e.t.k === "promise") {
      const inner = e.t.inner;
      return { c: cpp.coAwait(e.c), t: isVoidish(inner) ? T.undefined : inner };
    }
    if (t.k === "promise")
      fail(node, Codes.UnsupportedSyntax, "awaiting an optional promise is not supported");
    return e;
  }

  private deleteExpr(node: ts.DeleteExpression): E {
    const target = node.expression;
    if (ts.isElementAccessExpression(target)) {
      const obj = this.expr(target.expression);
      if (stripOpt(obj.t).k === "dict")
        return {
          c: cpp.call(cpp.dot(obj.c, "remove"), [this.exprAs(target.argumentExpression, T.string)]),
          t: T.boolean,
        };
    }
    fail(
      node,
      Codes.UnsupportedOperator,
      "`delete` is only supported on record entries (`delete record[key]`)",
    );
  }

  // --- member access ---------------------------------------------------------------

  /** Reads `name` from a value (struct field, class member, builtin property). */
  member(obj: E, name: string, node: ts.Node): E {
    const t = obj.t;
    if (t.k === "opt")
      fail(
        node,
        Codes.UnsupportedSyntax,
        `value may be undefined; check it before reading .${name}`,
      );
    if (t.k === "struct") {
      const f = this.reg.struct(t.id).fields.find((x) => x.name === name);
      if (!f) fail(node, Codes.UnsupportedSyntax, `unknown field ${name}`);
      return { c: cpp.arrow(obj.c, cppIdent(name)), t: f.type };
    }
    if (t.k === "union") {
      // A field every member has: read it with std::visit.
      const types = t.ms.map((m) =>
        m.k === "struct" || m.k === "class"
          ? this.member({ c: cpp.id("v"), t: m }, name, node)
          : fail(node, Codes.UnsupportedSyntax, `cannot read .${name} of ${typeKey(t)}`),
      );
      const rt = unionOf(types.map((x) => x.t));
      const read = cpp.lambda(
        ["&"],
        [cpp.param(cpp.reference(cpp.constType(cpp.auto)), "v")],
        [cpp.ret(cpp.arrow(cpp.id("v"), cppIdent(name)))],
        { ret: this.reg.cppType(rt) },
      );
      return { c: cpp.call("std::visit", [read, obj.c]), t: rt };
    }
    if (t.k === "class") return builtins.classMember(this, obj, t, name, node);
    if (t.k === "props") return views.propMember(this, obj, name, node);
    if (t.k === "native") return native.nativeMember(this, obj, node);
    if (t.k === "handle")
      fail(node, Codes.UnsupportedSyntax, `${t.name} has methods only: call ${t.name}.${name}(…)`);
    if (t.k === "iface") return builtins.ifaceMember(this, obj, t, name, node);
    return builtins.property(this, obj, name, node);
  }

  private propertyAccess(node: ts.PropertyAccessExpression): E {
    if (isOptionalChain(node)) return this.chainPart(node).e;
    const nativeE = native.nativeStaticProperty(this, node);
    if (nativeE) return nativeE;
    const staticE = builtins.staticProperty(this, node);
    if (staticE) return staticE;
    if (node.expression.kind === ts.SyntaxKind.SuperKeyword)
      return builtins.superMember(this, node.name.text, node);

    return this.member(this.receiver(node.expression), node.name.text, node);
  }

  /** The object of a member access; `this` stays a raw pointer. */
  receiver(node: ts.Expression): E {
    if (node.kind === ts.SyntaxKind.ThisKeyword && this.opts.cls) {
      return { c: this.self(), t: this.lt(node) };
    }
    return this.expr(node);
  }

  private elementAccess(node: ts.ElementAccessExpression): E {
    if (isOptionalChain(node)) return this.chainPart(node).e;
    return this.elementOf(this.expr(node.expression), node.argumentExpression, node);
  }

  /** `obj[arg]` on an already-evaluated object. */
  elementOf(obj: E, arg: ts.Expression, node: ts.Node): E {
    const t = obj.t;
    switch (t.k) {
      case "array": {
        // An exact integer index skips the double conversion.
        const i = this.expr(arg, T.number);
        const read = i.int
          ? cpp.call(cpp.dot(obj.c, "getIndex"), [cpp.staticCast(cpp.type("int64_t"), i.int.c)])
          : cpp.call(cpp.dot(obj.c, "get"), [this.coerce(i, T.number, arg)]);
        return { c: read, t: unionOf([t.e, T.undefined]) };
      }
      case "regexMatch":
        return {
          c: cpp.call("lucent::matchItem", [obj.c, this.exprAs(arg, T.number)]),
          t: unionOf([T.string, T.undefined]),
        };
      case "tuple": {
        if (!ts.isNumericLiteral(arg))
          fail(arg, Codes.UnsupportedSyntax, "tuple elements need a literal index");
        const i = Number(arg.text);
        return { c: cpp.call("std::get", [obj.c], [cpp.num(i)]), t: t.es[i]! };
      }
      case "dict":
        return {
          c: cpp.call(cpp.dot(obj.c, "get"), [this.exprAs(arg, T.string)]),
          t: unionOf([t.val, T.undefined]),
        };
      case "string":
        return {
          c: cpp.call("lucent::stringIndex", [obj.c, this.exprAs(arg, T.number)]),
          t: unionOf([T.string, T.undefined]),
        };
      case "bytes":
        return {
          c: cpp.call(cpp.dot(obj.c, "get"), [this.exprAs(arg, T.number)]),
          t: unionOf([T.number, T.undefined]),
        };
      case "span":
        return spanElement(obj, this.exprAs(arg, T.number));
      case "struct": {
        if (ts.isStringLiteral(arg)) return this.member(obj, arg.text, node);
        break;
      }
    }
    fail(node, Codes.UnsupportedSyntax, `cannot index ${typeKey(t)}`);
  }

  /**
   * One link of an optional chain (`a?.b.c`, `a?.[i]`, `a?.m()`, `f?.()`).
   * `sc` is true when the value may be undefined because the chain
   * short-circuited; later links then short-circuit too.
   */
  private chainPart(n: ts.Expression): { e: E; sc: boolean } {
    if (!(n.flags & ts.NodeFlags.OptionalChain)) return { e: this.expr(n), sc: false };
    if (ts.isNonNullExpression(n)) {
      const b = this.chainPart(n.expression);
      return b;
    }
    if (ts.isPropertyAccessExpression(n)) {
      const recv = this.chainPart(n.expression);
      return this.guarded(recv, !!n.questionDotToken, (x) => this.member(x, n.name.text, n), n);
    }
    if (ts.isElementAccessExpression(n)) {
      const recv = this.chainPart(n.expression);
      return this.guarded(
        recv,
        !!n.questionDotToken,
        (x) => this.elementOf(x, n.argumentExpression, n),
        n,
      );
    }
    if (ts.isCallExpression(n)) {
      const event = views.eventCall(this, n);
      if (event) return { e: event, sc: false };
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && !n.questionDotToken) {
        const recv = this.chainPart(callee.expression);
        return this.guarded(
          recv,
          !!callee.questionDotToken,
          (x) => builtins.methodCall(this, x, callee.name.text, n),
          n,
        );
      }
      const f = this.chainPart(callee);
      return this.guarded(f, !!n.questionDotToken, (x) => this.callValue(x, n), n);
    }
    return { e: this.expr(n), sc: false };
  }

  private guarded(
    b: { e: E; sc: boolean },
    q: boolean,
    apply: (x: E) => E,
    node: ts.Node,
  ): { e: E; sc: boolean } {
    if (b.e.t.k !== "opt" || (!q && !b.sc)) {
      if (b.e.t.k === "opt" && !q)
        fail(
          node,
          Codes.UnsupportedSyntax,
          "value may be undefined here; use ?. or check it first",
        );
      return { e: apply(b.e), sc: b.sc };
    }
    // Absent: the whole chain is undefined (short-circuit).
    const tmpName = this.ctx.fresh("oc");
    const tmp = cpp.id(tmpName);
    const applied = apply({ c: cpp.call(cpp.dot(tmp, "get")), t: b.e.t.inner });

    // A call that returns nothing is a C++ void: as a value, it is undefined.
    const r = isVoidish(applied.t)
      ? {
          c: cpp.comma(cpp.cast("c", cpp.voidType, applied.c), cpp.id("lucent::undefined")),
          t: T.undefined,
        }
      : applied;
    const rt = unionOf([r.t, T.undefined]);
    const pick = cpp.conditional(
      cpp.call(cpp.dot(tmp, "has")),
      this.coerce(r, rt, node),
      cpp.construct(this.reg.cppType(rt), [cpp.id("lucent::undefined")]),
    );
    return {
      e: { c: cpp.statementExpr([cpp.varDecl(cpp.auto, tmpName, b.e.c)], pick), t: rt },
      sc: true,
    };
  }

  /** Calls a function value with the arguments of `node`. */
  callValue(f: E, node: ts.CallExpression): E {
    const ft = stripOpt(f.t);
    if (ft.k !== "fn")
      fail(node.expression, Codes.UnsupportedCall, `cannot call a value of type ${typeKey(f.t)}`);
    const args = this.args(node.arguments, ft.params, node);
    return {
      c: cpp.call(this.coerce(f, ft, node.expression), args),
      t: isVoidish(ft.ret) ? T.undefined : ft.ret,
    };
  }

  // --- calls ------------------------------------------------------------------------------

  /**
   * Whether evaluating `node` cannot change what `name` names: it is a
   * literal, `this`, a class, enum or namespace, or a local that only its
   * function's own code writes, and `node` does not.
   */
  private unchangedBy(name: ts.Expression, node: ts.Expression | undefined): boolean {
    if (isLiteral(name) || name.kind === ts.SyntaxKind.ThisKeyword) return true;

    if (!ts.isIdentifier(name)) return false;

    const found = symbolOf(this.checker, name);
    const sym = found && this.ctx.resolve(found);

    if (!sym) return false;

    const local = this.findLocal(sym);

    if (local) return !local.boxed && !(node && assignedWithin(this.checker, node, found!));

    // Not a variable: a class, an enum or a namespace.
    return this.ctx.globals.get(sym)?.kind !== "var";
  }

  private call(node: ts.CallExpression): E {
    if (isOptionalChain(node)) return this.chainPart(node).e;

    return this.callInner(node);
  }

  private callInner(node: ts.CallExpression): E {
    // `obj.m!()` is the call `obj.m()`: an SDK interface's default method is optional in TypeScript.
    let callee: ts.Expression = node.expression;
    while (ts.isNonNullExpression(callee)) callee = callee.expression;
    if (callee.kind === ts.SyntaxKind.SuperKeyword) return builtins.superCall(this, node);
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.expression.kind === ts.SyntaxKind.SuperKeyword
    )
      return builtins.superMember(this, callee.name.text, callee, node);
    // `x[Symbol.dispose]()`: the one symbol-keyed method Lucent classes have.
    if (ts.isElementAccessExpression(callee) && isSymbolDispose(callee.argumentExpression)) {
      if (callee.expression.kind === ts.SyntaxKind.SuperKeyword)
        return builtins.superMember(this, DISPOSE, callee, node);
      return builtins.methodCall(this, this.receiver(callee.expression), DISPOSE, node);
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const event = views.eventCall(this, node);
      if (event) return event;
      const n = native.nativeCall(this, node, undefined);
      if (n) return n;
      const s = builtins.staticCall(this, node, callee);
      if (s) return s;
      const obj = this.receiver(callee.expression);
      return builtins.methodCall(this, obj, callee.name.text, node);
    }
    if (ts.isIdentifier(callee)) {
      const sym0 = symbolOf(this.checker, callee);
      const sym = sym0 ? this.ctx.resolve(sym0) : undefined;
      if (sym && !this.findLocal(sym)) {
        const g = this.ctx.globals.get(sym);
        if (g && g.kind === "function") return this.callUserFunction(g, node);
        const n =
          views.uiCall(this, node) ??
          native.nativeBuiltinCall(this, node) ??
          native.nativeFunctionCall(this, node) ??
          extensions.extensionFunctionCall(this, node);
        if (n) return n;
        // By the imported name: `import { errorCode as codeOf }` calls errorCode.
        const b = builtins.globalCall(this, node, sym.name, sym);
        if (b) return b;
      }
    }
    // A function value.
    return this.callValue(this.expr(callee), node);
  }

  /** Arguments coerced to parameter types, with missing optionals as undefined. */
  args(
    args: ts.NodeArray<ts.Expression>,
    params: LType[],
    node: ts.Node,
    rest?: LType,
  ): cpp.Expr[] {
    const out: cpp.Expr[] = [];
    const fixed = rest ? params.length - 1 : params.length;
    const undef = cpp.id("lucent::undefined");
    for (let i = 0; i < fixed; i++) {
      const p = params[i]!;
      const a = args[i];
      if (a && ts.isSpreadElement(a))
        fail(
          a,
          Codes.UnsupportedCall,
          "spread arguments are only supported by built-ins that take any number of arguments",
        );
      if (a) out.push(this.exprAs(a, p));
      else if (p.k === "opt") out.push(cpp.construct(this.reg.cppType(p), [undef]));
      else if (p.k === "undefined") out.push(undef);
      else fail(node, Codes.UnsupportedCall, "missing argument");
    }
    if (rest) {
      // The rest parameter: an array of what is left, spread arrays appended.
      const restT = rest as LType & { k: "array" };
      const tmpName = this.ctx.fresh("rest");
      const tmp = cpp.id(tmpName);
      const parts = args
        .slice(fixed)
        .map((a) =>
          cpp.exprStmt(
            ts.isSpreadElement(a)
              ? cpp.call(cpp.dot(tmp, "append"), [this.exprAs(a.expression, restT)])
              : cpp.call(cpp.dot(tmp, "push"), [this.exprAs(a, restT.e)]),
          ),
        );
      out.push(cpp.statementExpr([cpp.varDecl(this.reg.cppType(restT), tmpName), ...parts], tmp));
    }
    return out;
  }

  private callUserFunction(
    g: Extract<import("./context.ts").Global, { kind: "function" }>,
    node: ts.CallExpression,
  ): E {
    const params = g.params;
    const restParam =
      params.length && params[params.length - 1]!.rest
        ? params[params.length - 1]!.cppType
        : undefined;
    let callee: cpp.Expr = cpp.id(g.cpp);
    let paramTypes = params.map((p) => p.cppType);
    let ret = g.type.ret;
    if (g.generic) {
      // Instantiate: C++ template arguments from the checker's inference.
      const sig = this.checker.getResolvedSignature(node);
      const decl = g.decl;
      const targs = inferTypeArguments(this, decl, sig, node);
      callee = cpp.templateId(
        g.cpp,
        targs.map((t) => this.reg.cppType(t)),
      );
      const map = new Map(decl.typeParameters!.map((p, i) => [p.name.text, targs[i]!]));
      paramTypes = paramTypes.map((p) => substitute(p, map));
      ret = substitute(ret, map);
    }
    const args = this.args(node.arguments, paramTypes, node, restParam);
    const variant = this.opts.task ? taskVariant(this.ctx, g) : undefined;
    if (variant) callee = variant;
    const rt = g.async
      ? ({ k: "promise", inner: ret.k === "promise" ? ret.inner : ret } as LType)
      : ret;
    const all = variant ? [...args, cpp.id(TASK)] : args;
    return { c: cpp.call(callee, all), t: isVoidish(rt) ? T.undefined : rt };
  }

  private newExpr(node: ts.NewExpression, hint?: LType): E {
    return this.newInner(node, hint);
  }

  private newInner(node: ts.NewExpression, hint?: LType): E {
    const callee = node.expression;
    const own = this.lt(node);
    const t = own.k === "class" && hint ? this.constructedAs(node, own, hint) : own;
    builtins.requireConstructor(this, node, t);
    if (t.k === "native") return native.nativeNew(this, node, t);
    if (t.k === "handle") return extensions.handleNew(this, node, t);
    if (t.k === "class") {
      requireSubclassMain(node, this.reg.cls(t.id), (n) => native.inMainContext(this, n));
      const params = constructorOf(this.ctx, t);
      const paramTypes = params.map((p) => p.cppType);
      // An Error subclass without a constructor takes Error's, whose options carry the cause.
      const ownCtor = this.reg
        .chain(t)
        .some((c) => c.info.decl.members.some(ts.isConstructorDeclaration));
      if (!ownCtor && this.reg.cls(t.id).isError) builtins.refuseCause(this, node.arguments?.[1]);
      const rest =
        params.length && params[params.length - 1]!.rest
          ? paramTypes[paramTypes.length - 1]
          : undefined;
      const args = this.args(
        node.arguments ?? ts.factory.createNodeArray(),
        paramTypes,
        node,
        rest,
      );
      return { c: cpp.call(cpp.scoped(this.reg.cppClassType(t), "create"), args), t };
    }
    return builtins.newBuiltin(this, node, callee, t);
  }

  /**
   * The instantiation a `new` builds where its value becomes `hint`: TypeScript lets
   * `new Box(1)` (a `Box<number>`) stand for a `Box<number | undefined>`, a native class of
   * its own, and a new object has no identity yet to keep, so it is built as that one.
   */
  private constructedAs(
    node: ts.NewExpression,
    own: LType & { k: "class" },
    hint: LType,
  ): LType & { k: "class" } {
    const held = stripOpt(hint);
    const targets = (held.k === "union" ? held.ms : [held]).filter(
      (m): m is LType & { k: "class" } => m.k === "class",
    );

    if (targets.some((m) => this.reg.extendsType(own, m))) return own;

    for (const target of targets) {
      const t = this.reg.instantiatedAs(own.id, target);
      if (!t) continue;

      const params = this.reg.cls(t.id).typeParams;
      this.checkInstance(node, new Map(params.map((p, i) => [p, t.args[i]!])));
      return t;
    }

    return own;
  }

  // --- literals ---------------------------------------------------------------------------

  private arrayLiteral(node: ts.ArrayLiteralExpression, hint?: LType): E {
    let t = this.lt(node);
    const ctxT = hint ?? this.contextualType(node);
    if (ctxT) {
      const c = stripOpt(ctxT);
      if (c.k === "array" || c.k === "tuple") t = c;
      else if (c.k === "union") {
        const m = c.ms.find((x) => x.k === "array" || x.k === "tuple");
        if (m) t = m;
      }
    }
    if (t.k === "tuple") {
      const parts = node.elements.map((el, i) =>
        this.exprAs(el, t.k === "tuple" ? t.es[i]! : T.never),
      );
      return { c: cpp.construct(this.reg.cppType(t), parts), t };
    }
    if (t.k !== "array") fail(node, Codes.UnsupportedType, `array literal of type ${typeKey(t)}`);
    const elemT = t.e;
    if (!node.elements.some(ts.isSpreadElement)) {
      const parts = node.elements.map((el) => this.exprAs(el, elemT));
      return { c: cpp.construct(this.reg.cppType(t), parts, true), t };
    }
    // With spreads: built element by element.
    const tmpName = this.ctx.fresh("arr");
    const tmp = cpp.id(tmpName);
    const append = (x: cpp.Expr) => cpp.exprStmt(cpp.call(cpp.dot(tmp, "append"), [x]));
    const push = (x: cpp.Expr) => cpp.exprStmt(cpp.call(cpp.dot(tmp, "push"), [x]));
    const parts: cpp.Stmt[] = [cpp.varDecl(this.reg.cppType(t), tmpName)];
    for (const el of node.elements) {
      if (!ts.isSpreadElement(el)) {
        parts.push(push(this.exprAs(el, elemT)));
        continue;
      }

      const items = this.iterableItems(this.expr(el.expression), el.expression);

      if (sameType(items.e, elemT)) {
        parts.push(append(items.c));
        continue;
      }

      // Elements of another type: converted one by one, from an array that outlives the loop
      // (a range-for keeps only its range's own temporary alive, not the array `items()` is of).
      const from = this.ctx.fresh("from");
      const item = cpp.staticCast(this.reg.cppType(items.e), cpp.id("e"));

      parts.push(cpp.varDecl(cpp.auto, from, items.c), {
        k: "forRange",
        type: cpp.reference(cpp.constType(cpp.auto)),
        name: "e",
        range: cpp.call(cpp.dot(cpp.id(from), "items")),
        body: [push(this.coerce({ c: item, t: items.e }, elemT, el))],
      });
    }
    return { c: cpp.statementExpr(parts, tmp), t };
  }

  contextualType(node: ts.Expression): LType | undefined {
    const ct = this.checker.getContextualType(node);
    if (!ct) return undefined;
    try {
      return this.reg.lower(ct, node);
    } catch {
      return undefined;
    }
  }

  private objectLiteral(node: ts.ObjectLiteralExpression, hint?: LType): E {
    let t = hint ?? this.contextualType(node) ?? this.lt(node);
    t = stripOpt(t);
    if (t.k === "union") {
      // Pick the member this literal belongs to.
      const own = this.checker.getTypeAtLocation(node);
      const ctxTs = this.checker.getContextualType(node);
      const members = ctxTs && ctxTs.isUnion() ? ctxTs.types : [];
      const match = members.find(
        (m) =>
          this.checker.isTypeAssignableTo(own, m) &&
          !(m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
      );
      t = match ? this.reg.lower(match, node) : this.lt(node);
    }
    if (t.k === "dict") {
      const tmpName = this.ctx.fresh("rec");
      const tmp = cpp.id(tmpName);
      const set = (key: cpp.Expr, value: cpp.Expr) =>
        cpp.exprStmt(cpp.call(cpp.dot(tmp, "set"), [key, value]));
      const parts: cpp.Stmt[] = [cpp.varDecl(this.reg.cppType(t), tmpName)];
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p)) {
          const key = ts.isComputedPropertyName(p.name)
            ? this.exprAs(p.name.expression, T.string)
            : stringExpr(propName(p.name));
          parts.push(set(key, this.exprAs(p.initializer, t.val)));
        } else if (ts.isShorthandPropertyAssignment(p)) {
          parts.push(set(stringExpr(p.name.text), this.exprAs(p.name, t.val)));
        } else if (ts.isSpreadAssignment(p)) {
          const s = this.expr(p.expression);
          if (s.t.k === "opt" && s.t.inner.k === "dict") {
            // Spreading undefined adds nothing.
            const srcName = this.ctx.fresh("src");
            const src = cpp.id(srcName);
            const entries = this.coerce({ c: cpp.call(cpp.dot(src, "get")), t: s.t.inner }, t, p);
            parts.push(cpp.varDecl(cpp.auto, srcName, s.c));
            parts.push(
              cpp.ifStmt(cpp.call(cpp.dot(src, "has")), [
                cpp.exprStmt(cpp.call("lucent::assignEntries", [tmp, entries])),
              ]),
            );
            continue;
          }
          // An object's fields have a fixed layout: no key order, no record of which optional
          // fields are set, so its keys can't be enumerated the way JavaScript does.
          if (s.t.k !== "dict")
            fail(
              p,
              Codes.UnsupportedSyntax,
              `only records can be spread into a record literal, not ${this.checker.typeToString(this.checker.getTypeAtLocation(p.expression))}; set the entries one by one (\`r.a = value.a\`)`,
            );
          parts.push(cpp.exprStmt(cpp.call("lucent::assignEntries", [tmp, this.coerce(s, t, p)])));
        } else fail(p, Codes.UnsupportedSyntax, "unsupported property in record literal");
      }
      return { c: cpp.statementExpr(parts, tmp), t };
    }
    if (t.k === "iface") this.notAnImplementation("an object literal", t, node);
    if (t.k !== "struct") fail(node, Codes.UnsupportedType, `object literal of type ${typeKey(t)}`);
    const info = this.reg.struct(t.id);
    const tmpName = this.ctx.fresh("obj");
    const tmp = cpp.id(tmpName);
    const field = (name: string) => cpp.arrow(tmp, cppIdent(name));
    const created = cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]);
    const parts: cpp.Stmt[] = [cpp.varDecl(cpp.auto, tmpName, created)];
    for (const p of node.properties) {
      if (ts.isSpreadAssignment(p)) {
        const s = this.expr(p.expression);
        const st = stripOpt(s.t);
        if (st.k !== "struct")
          fail(p, Codes.UnsupportedSyntax, "only objects can be spread into object literals");
        const srcName = this.ctx.fresh("src");
        const src = cpp.id(srcName);
        parts.push(cpp.varDecl(cpp.auto, srcName, s.c));
        const obj = s.t.k === "opt" ? cpp.call(cpp.dot(src, "get")) : src;
        const srcFields = this.reg.struct(st.id).fields;
        const copies: cpp.Stmt[] = [];
        for (const f of info.fields) {
          const sf = srcFields.find((x) => x.name === f.name);
          if (!sf) continue;
          const read = cpp.arrow(obj, cppIdent(f.name));
          const copy = cpp.exprStmt(
            cpp.assign(field(f.name), this.coerce({ c: read, t: sf.type }, f.type, p)),
          );
          // An unset optional field is a key the source lacks, which JavaScript skips
          // (an explicit `undefined` can't be told apart from it).
          copies.push(
            sf.type.k === "opt"
              ? cpp.ifStmt(cpp.not(cpp.call(cpp.dot(read, "isUndefined"))), [copy])
              : copy,
          );
        }
        // Spreading undefined or null adds nothing.
        parts.push(
          ...(s.t.k === "opt" ? [cpp.ifStmt(cpp.call(cpp.dot(src, "has")), copies)] : copies),
        );
        continue;
      }
      let name: string;
      let value: E;
      if (ts.isPropertyAssignment(p)) {
        if (ts.isComputedPropertyName(p.name))
          fail(p, Codes.UnsupportedSyntax, "computed keys are only supported in records");
        name = propName(p.name);
        const f = info.fields.find((x) => x.name === name);
        value = this.expr(p.initializer, f?.type);
      } else if (ts.isShorthandPropertyAssignment(p)) {
        name = p.name.text;
        value = this.expr(p.name);
      } else if (ts.isMethodDeclaration(p)) {
        fail(
          p,
          Codes.UnsupportedSyntax,
          "methods in object literals are not supported; use `name: (...) => ...`",
        );
      } else fail(p, Codes.UnsupportedSyntax, "unsupported property in object literal");
      const f = info.fields.find((x) => x.name === name);
      if (!f) fail(p, Codes.InexactObject, `property ${name} is not part of the target type`);
      parts.push(cpp.exprStmt(cpp.assign(field(name), this.coerce(value, f.type, p))));
    }
    return { c: cpp.statementExpr(parts, tmp), t };
  }
}

function isLiteral(n: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(n) ||
    ts.isBigIntLiteral(n) ||
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    n.kind === ts.SyntaxKind.TrueKeyword ||
    n.kind === ts.SyntaxKind.FalseKeyword ||
    n.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(n) && n.text === "undefined")
  );
}

/** An assignment target without the grouping and non-null assertions around it. */
function unwrapTarget(target: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(target) || ts.isNonNullExpression(target)
    ? unwrapTarget(target.expression)
    : target;
}

/** An expression without side effects (so evaluation order cannot be observed). */
export function isSimple(n: ts.Expression): boolean {
  if (isLiteral(n) || ts.isIdentifier(n) || n.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return true;
  if (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isTypeOfExpression(n)
  ) {
    return isSimple(n.expression);
  }
  if (ts.isPropertyAccessExpression(n)) return isSimple(n.expression);
  if (ts.isElementAccessExpression(n))
    return isSimple(n.expression) && isSimple(n.argumentExpression);
  if (ts.isPrefixUnaryExpression(n))
    return (
      n.operator !== ts.SyntaxKind.PlusPlusToken &&
      n.operator !== ts.SyntaxKind.MinusMinusToken &&
      isSimple(n.operand)
    );
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment) return false;
    return isSimple(n.left) && isSimple(n.right);
  }
  if (ts.isConditionalExpression(n))
    return isSimple(n.condition) && isSimple(n.whenTrue) && isSimple(n.whenFalse);
  if (ts.isTemplateExpression(n)) return n.templateSpans.every((s) => isSimple(s.expression));
  if (ts.isArrayLiteralExpression(n))
    return n.elements.every((e) => !ts.isSpreadElement(e) && isSimple(e));
  return false;
}

function propName(n: ts.PropertyName): string {
  if (
    ts.isIdentifier(n) ||
    ts.isStringLiteral(n) ||
    ts.isNumericLiteral(n) ||
    ts.isPrivateIdentifier(n)
  )
    return n.text;
  return n.getText();
}

export function isOptionalChain(node: ts.Node): boolean {
  return !!(node.flags & ts.NodeFlags.OptionalChain);
}

export function usesThisIn(fn: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword) {
      found = true;
      return;
    }
    if (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

function assignedWithin(checker: ts.TypeChecker, node: ts.Node, sym: ts.Symbol): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isIdentifier(n.left) &&
      checker.getSymbolAtLocation(n.left) === sym
    )
      found = true;
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      ts.isIdentifier(n.operand) &&
      checker.getSymbolAtLocation(n.operand) === sym
    )
      found = true;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Replaces type parameters in `t`. */
/** Type arguments the checker inferred for a call to a generic function. */
function inferTypeArguments(
  em: FnEmitter,
  decl: ts.FunctionDeclaration,
  sig: ts.Signature | undefined,
  node: ts.CallExpression,
): LType[] {
  const tps = decl.typeParameters ?? ts.factory.createNodeArray();
  if (node.typeArguments)
    return node.typeArguments.map((t) => em.ctx.reg.lower(em.checker.getTypeFromTypeNode(t), t));
  if (!sig) fail(node, Codes.UnsupportedCall, "could not resolve this generic call");
  // Unify the declared signature (with type parameters) against the
  // instantiated one the checker resolved.
  const declared = em.checker.getSignatureFromDeclaration(decl)!;
  const map = new Map<string, LType>();
  const pairs: [ts.Type, ts.Type][] = [];
  declared.getParameters().forEach((p, i) => {
    const q = sig.getParameters()[i];
    if (q) pairs.push([em.checker.getTypeOfSymbol(p), em.checker.getTypeOfSymbol(q)]);
  });
  pairs.push([
    em.checker.getReturnTypeOfSignature(declared),
    em.checker.getReturnTypeOfSignature(sig),
  ]);
  for (const [d, a] of pairs) {
    try {
      unify(em.ctx.reg.lower(d, node), em.ctx.reg.lower(a, node), map);
    } catch {
      // Parameters we cannot lower (e.g. callbacks) do not constrain.
    }
  }
  return tps.map((tp) => {
    const t = map.get(tp.name.text);
    if (!t)
      fail(
        node,
        Codes.UnsupportedCall,
        `could not infer type argument ${tp.name.text}; pass it explicitly`,
      );
    return t;
  });
}

function unify(pattern: LType, actual: LType, map: Map<string, LType>): void {
  if (pattern.k === "tparam") {
    if (!map.has(pattern.name)) map.set(pattern.name, actual);
    return;
  }
  if (pattern.k === "iter") {
    // Any iterable matches Iterable<T>.
    const a = stripOpt(actual);
    const e =
      a.k === "iter" || a.k === "array" || a.k === "set"
        ? a.e
        : a.k === "string"
          ? T.string
          : a.k === "bytes"
            ? T.number
            : a.k === "map"
              ? ({ k: "tuple", es: [a.key, a.val] } as LType)
              : undefined;
    if (e) unify(pattern.e, e, map);
    return;
  }
  if (pattern.k !== actual.k) {
    if (pattern.k === "opt") unify(pattern.inner, stripOpt(actual), map);
    return;
  }
  switch (pattern.k) {
    case "array":
    case "set":
      unify(pattern.e, (actual as typeof pattern).e, map);
      return;
    case "dict":
      unify(pattern.val, (actual as typeof pattern).val, map);
      return;
    case "map":
      unify(pattern.key, (actual as typeof pattern).key, map);
      unify(pattern.val, (actual as typeof pattern).val, map);
      return;
    case "opt":
      unify(pattern.inner, (actual as typeof pattern).inner, map);
      return;
    case "promise":
      unify(pattern.inner, (actual as typeof pattern).inner, map);
      return;
    case "tuple":
      pattern.es.forEach((e, i) => {
        const a = (actual as typeof pattern).es[i];
        if (a) unify(e, a, map);
      });
      return;
    case "fn": {
      const a = actual as typeof pattern;
      pattern.params.forEach((p, i) => {
        if (a.params[i]) unify(p, a.params[i]!, map);
      });
      unify(pattern.ret, a.ret, map);
      return;
    }
    case "class":
      pattern.args.forEach((p, i) => {
        const a = (actual as typeof pattern).args[i];
        if (a) unify(p, a, map);
      });
      return;
    default:
      return;
  }
}

export { containsAwait };
