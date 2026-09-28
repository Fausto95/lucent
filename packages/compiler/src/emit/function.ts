import { cpp } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import { Codes, CompileError, fail } from "../diagnostics.ts";
import { branchPlatform, isPlatformValue, platformGuard, switchPlatforms } from "../platforms.ts";
import type { Platform } from "../sdk/schema.ts";
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
import {
  containsAwait,
  freeVariables,
  type FunctionLike,
  isFunctionLike,
  parameterSymbol,
  symbolOf,
} from "../analysis/scopes.ts";
import * as builtins from "./builtins.ts";
import { spanElement } from "./buffers.ts";
import { DISPOSE, isSymbolDispose } from "./classes.ts";
import { computeOperands, safepoint, TASK, taskVariant } from "./compute.ts";
import * as extensions from "./extensions.ts";
import * as native from "./native.ts";
import { requireSubclassMain } from "./objc-subclass.ts";
import * as views from "./setups.ts";
import { toolkitCall, toolkitMember } from "./toolkit.ts";
import {
  AlreadyReported,
  type Ctx,
  type E,
  type IntKind,
  type ParamInfo,
  type Lvalue,
} from "./context.ts";
import { inferIntegers } from "./integers.ts";
import { genericFacts, instanceAt } from "./instantiations.ts";
export { substitute } from "../types.ts";
import { type ConversionStep, conversionStep } from "../lowering/conversions.ts";
import { heldAs, throughMembers } from "../lowering/members.ts";
import {
  BIGINT_COMPARISONS,
  BIGINT_OPERATORS,
  comparesMixed,
  numericUnion,
} from "../lowering/bigint.ts";
import { looseConversion, looseConversionMessage } from "../lowering/loose-equality.ts";
import { bigintExpr, bigintLiteralValue, numberExpr, stringExpr } from "../lowering/literals.ts";
import { sourcePath } from "../lowering/source.ts";

interface Local {
  cpp: string;
  type: LType;
  boxed: boolean;
  /** Set when the number lives in an integer register. */
  int?: IntKind;
}

const INT_CPP: Record<IntKind, string> = { i32: "int32_t", u32: "uint32_t", i64: "int64_t" };

interface ControlEntry {
  kind: "loop" | "switch" | "block" | "finally";
  labels: string[];
  breakLabel?: string;
  continueLabel?: string;
  usedBreakLabel?: boolean;
  usedContinueLabel?: boolean;
  // finally
  finLabel?: string;
  finVar?: string;
  pending?: Map<number, () => void>;
}

export interface FnOptions {
  module: LucentModule;
  async: boolean;
  /** Lucent return type (the promised type for async functions). */
  returnType: LType;
  cls?: ClassInfo;
  /** How `this` is spelled in the current context. */
  thisExpr?: string;
  /** How `this` is spelled as a Ref (for passing it as a value). */
  thisRef?: string;
  isConstructor?: boolean;
  /** A generator body: `yield` becomes co_yield and `return` co_return. */
  generator?: boolean;
  /** In a subclass constructor: the base construct() call and what follows super(). */
  superCtor?: { call: cpp.Expr; params: LType[]; after: (em: FnEmitter) => void };
  /**
   * A compute task's variant of a function (compute.ts): each loop
   * iteration checks for cancellation, and calls of module functions call
   * their variants. Closures inside run as they are.
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

/**
 * Whether C++ statements co_await, co_return or co_yield, which makes the
 * function they are the body of a coroutine. Lambdas are bodies of their own.
 */
function isCoroutine(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(isCoroutine);

  if (typeof node !== "object" || node === null) return false;

  const n = node as { k?: string; co?: boolean };

  if (n.k === "coAwait" || n.k === "coYield" || (n.k === "return" && n.co)) return true;

  if (n.k === "lambda" || n.k === "blockLiteral") return false;

  return Object.values(node).some(isCoroutine);
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

/** Emits the body of one function (or method, or closure) as C++. */
export class FnEmitter {
  /** Statements, innermost block last: collect() opens one. */
  private readonly out: cpp.Stmt[][] = [[]];
  private scopes: Map<ts.Symbol, Local>[] = [new Map()];
  private ctl: ControlEntry[] = [];
  private retVar?: string;
  private readonly prologue: cpp.Stmt[] = [];
  /** Nodes replaced during optional-chain lowering. */
  private readonly subst = new Map<ts.Node, E>();
  /** Locals and loop counters that live in integer registers (integers.ts). */
  private ints = new Map<ts.Symbol, IntKind>();
  private readonly counters = new Set<ts.Symbol>();
  /** Whether the body names its mount's content: code of a setup (setups.ts). */
  usesContent = false;
  readonly ctx: Ctx;
  readonly opts: FnOptions;
  private readonly parentScopes: Map<ts.Symbol, Local>[];

  constructor(ctx: Ctx, opts: FnOptions, parentScopes: Map<ts.Symbol, Local>[] = []) {
    this.ctx = ctx;
    this.opts = opts;
    this.parentScopes = parentScopes;
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

  emit(...stmts: cpp.Stmt[]): void {
    this.out[this.out.length - 1]!.push(...stmts);
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
  /** The finished body: prologue declarations first. */
  body(): cpp.Stmt[] {
    return [...this.prologue, ...this.out[0]!];
  }

  // --- scopes ------------------------------------------------------------------

  pushScope(): void {
    this.scopes.push(new Map());
  }
  popScope(): void {
    this.scopes.pop();
  }
  declare(sym: ts.Symbol, name: string, type: LType): Local {
    const boxed = this.ctx.capture.isBoxed(sym);
    const local: Local = { cpp: cppIdent(name), type, boxed };
    this.scopes[this.scopes.length - 1]!.set(sym, local);
    return local;
  }
  /** A parameter the caller passes as it is (a component's props): its C++ name. */
  declareParam(sym: ts.Symbol | undefined, fallback: string, type: LType): string {
    return sym ? this.declare(sym, sym.name, type).cpp : fallback;
  }

  private findLocal(sym: ts.Symbol): Local | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const l = this.scopes[i]!.get(sym);
      if (l) return l;
    }
    for (let i = this.parentScopes.length - 1; i >= 0; i--) {
      const l = this.parentScopes[i]!.get(sym);
      if (l) return l;
    }
    return undefined;
  }
  allScopes(): Map<ts.Symbol, Local>[] {
    return [...this.parentScopes, ...this.scopes];
  }

  /** `T name = init;`, boxing when a closure captures and mutates it. */
  declareVar(sym: ts.Symbol, name: string, type: LType, init: cpp.Expr | undefined): Local {
    const l = this.declare(sym, name, type);
    const ct = this.reg.cppType(type);
    if (l.boxed)
      this.emit(cpp.varDecl(cpp.type("lucent::Box", ct), l.cpp, init, { style: "construct" }));
    else this.emit(cpp.varDecl(ct, l.cpp, init, init ? {} : { style: "brace" }));
    return l;
  }

  // --- integers --------------------------------------------------------------------

  private isNumberLocal(d: ts.VariableDeclaration, sym: ts.Symbol): boolean {
    try {
      return (
        this.reg.lower(this.checker.getTypeOfSymbolAtLocation(sym, d.name), d.name).k === "number"
      );
    } catch {
      return false;
    }
  }

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
      if (this.reg.derives(from.id, to.id))
        return cpp.call("std::static_pointer_cast", [e.c], [this.reg.cppClassType(to)]);
      if (this.reg.derives(to.id, from.id)) return downcast(to);
    }
    if (from.k === "struct" && to.k === "struct") {
      fail(
        node,
        Codes.InexactObject,
        `object types must match exactly to share a native representation (${this.describe(from)} vs ${this.describe(to)})`,
      );
    }
    if ((from.k === "array" && to.k === "array") || (from.k === "map" && to.k === "map")) {
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

  /** Emits parameter defaults, destructuring and boxing at the top of a body. */
  emitParams(decl: FunctionLike, params: ParamInfo[]): cpp.Param[] {
    const out: cpp.Param[] = [];
    decl.parameters.forEach((p, i) => {
      const info = params[i]!;
      const incomingName = `p${i}_${ts.isIdentifier(p.name) ? cppIdent(p.name.text) : "arg"}`;
      const incoming = cpp.id(incomingName);
      out.push(cpp.param(this.reg.cppType(info.cppType), incomingName));
      // The by-value parameter is only read here: move it into the variable.
      let value = cpp.call("std::move", [incoming]);
      let type = info.cppType;
      if (p.initializer) {
        const inner = stripOpt(info.cppType);
        const given = this.coerce(
          { c: cpp.call(cpp.dot(incoming, "get")), t: inner },
          info.type,
          p,
        );
        value = cpp.conditional(
          cpp.call(cpp.dot(incoming, "isUndefined")),
          this.exprAs(p.initializer, info.type),
          given,
        );
        type = info.type;
      }
      if (ts.isIdentifier(p.name)) {
        const sym = parameterSymbol(
          this.checker,
          p as ts.ParameterDeclaration & { name: ts.Identifier },
        );
        this.declareVar(sym, p.name.text, type, value);
      } else {
        const tmp = this.ctx.fresh("param");
        this.emit(cpp.varDecl(this.reg.cppType(type), tmp, value));
        this.bindPattern(p.name, { c: cpp.id(tmp), t: type }, true);
      }
    });
    return out;
  }

  /** Lowers a nested function or arrow to a C++ lambda wrapped in lucent::Fn. */
  closure(
    node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    target?: LType,
  ): E {
    const sig = this.checker.getTypeAtLocation(node).getCallSignatures()[0];
    if (!sig) fail(node, Codes.UnsupportedType, "expected a function type");
    let fnType: LType & { k: "fn" };
    if (target && target.k === "fn" && target.params.length >= node.parameters.length) {
      // Use the contextual parameter list so the lambda matches Fn<...> exactly.
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
    if (isAsync && isGen) fail(node, Codes.UnsupportedSyntax, "async generators are not supported");
    const ret = isAsync
      ? fnType.ret.k === "promise"
        ? fnType.ret.inner
        : fnType.ret
      : isGen
        ? T.void
        : fnType.ret;
    const params = this.paramInfos(node, fnType);
    const inner = new FnEmitter(
      this.ctx,
      {
        ...this.opts,
        async: isAsync,
        generator: isGen,
        returnType: ret,
        thisExpr: this.opts.thisExpr ? "self" : undefined,
        thisRef: this.opts.thisRef ? "self" : undefined,
        isConstructor: false,
        task: false,
      },
      this.allScopes(),
    );
    const free = freeVariables(this.checker, node);
    const captures: cpp.Capture[] = [];
    for (const sym of free) {
      const l = this.findLocal(sym);
      if (l) captures.push(l.cpp);
    }
    const usesThisVal = this.opts.thisExpr && usesThisIn(node);
    if (usesThisVal) captures.push({ name: "self", init: this.selfRefExpr() });
    const decls = inner.emitParams(node, params);
    // Callbacks may be called with more arguments than they declare.
    for (let i = node.parameters.length; i < fnType.params.length; i++)
      decls.push(cpp.param(this.reg.cppType(fnType.params[i]!), `unused${i}`));
    inner.emitFunctionBody(node);
    if (inner.usesContent) captures.push(views.CONTENT);
    const retType = isAsync
      ? cpp.type("lucent::Promise", this.reg.cppRetType(ret))
      : isGen
        ? this.reg.cppType(fnType.ret)
        : this.reg.cppRetType(ret);
    let lambda: cpp.Expr;
    if (isAsync || isGen) {
      // Coroutine frames must not reference the lambda's captures: pass them
      // as coroutine parameters instead.
      const capNames = captures.map((c) => (typeof c === "string" ? c : c.name));
      const coroutine = cpp.lambda(
        [],
        [...capNames.map((c) => cpp.param(cpp.auto, c)), ...decls],
        inner.body(),
        { ret: retType },
      );
      const call = cpp.call(coroutine, [...capNames, ...decls.map((d) => d.name!)].map(cpp.id));
      lambda = cpp.lambda(captures, decls, [cpp.ret(call)], { ret: retType });
    } else {
      lambda = cpp.lambda(captures, decls, inner.body(), { ret: retType, mutable: true });
    }
    return {
      c: cpp.construct(this.reg.cppType(fnType), [views.enterMount(this, node, lambda)]),
      t: fnType,
    };
  }

  /**
   * A C++ lambda without parameters whose body `write` emits with a nested
   * emitter, capturing `extra` and the locals `node` reads: code that runs
   * later over an expression, such as an effect keeping its value.
   */
  lambdaOver(node: ts.Node, extra: cpp.Capture[], write: (inner: FnEmitter) => void): cpp.Expr {
    const inner = new FnEmitter(
      this.ctx,
      {
        ...this.opts,
        async: false,
        generator: false,
        returnType: T.void,
        isConstructor: false,
        task: false,
      },
      this.allScopes(),
    );
    const captures = [...extra];
    const seen = new Set<string>();
    const visit = (n: ts.Node): void => {
      const sym = ts.isIdentifier(n) ? symbolOf(this.checker, n) : undefined;
      const local = sym && this.findLocal(sym);

      if (local && !seen.has(local.cpp)) {
        seen.add(local.cpp);
        captures.push(local.cpp);
      }

      ts.forEachChild(n, visit);
    };

    visit(node);
    write(inner);

    return cpp.lambda(captures, [], inner.body(), { mutable: true });
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

  /** Statements of a function body, plus the implicit return at the end. */
  emitFunctionBody(node: FunctionLike): void {
    const body = node.body;
    if (!body) return;
    const facts = inferIntegers(body, {
      checker: this.checker,
      // Locals of code this target never runs are not lowered: their types stay out of its output.
      candidate: (d, sym) =>
        this.runsHere(d) && !this.ctx.capture.isBoxed(sym) && this.isNumberLocal(d, sym),
      isBoxed: (sym) => this.ctx.capture.isBoxed(sym),
      isMath: (id) => builtins.isMathGlobal(this, id),
    });
    this.ints = facts.locals;
    for (const c of facts.counters) this.counters.add(c);
    const ret = this.opts.returnType;
    if (ts.isBlock(body)) {
      this.hoistFunctions(body.statements);
      this.statements(body.statements);
      const last = body.statements[body.statements.length - 1];
      // After a using declaration, a final return is routed through its disposal.
      const endsInReturn =
        last &&
        (ts.isReturnStatement(last) || ts.isThrowStatement(last)) &&
        !body.statements.some((x) => ts.isVariableStatement(x) && isUsing(x.declarationList));
      if (!endsInReturn && !this.opts.generator) {
        const unreachable = cpp.exprStmt(cpp.call("lucent::unreachable"));
        const undef = cpp.id("lucent::undefined");
        if (this.opts.async) {
          if (isVoidish(ret)) this.emit(cpp.coReturn());
          else if (ret.k === "opt") this.emit(cpp.coReturn(undef));
          else this.emit(unreachable);
        } else if (ret.k === "opt") {
          this.emit(cpp.ret(undef));
        } else if (!isVoidish(ret) && !this.opts.isConstructor) {
          this.emit(unreachable);
        }
      }
    } else {
      // Expression body.
      if (isVoidish(ret)) {
        const e = this.expr(body);
        this.emit(cpp.exprStmt(e.c));
        if (this.opts.async) this.emit(cpp.coReturn());
      } else if (this.diverges(body)) {
        // It throws: there is no value to return.
        this.emit(...this.diverging(this.expr(body)));
      } else {
        let e = this.expr(body, ret);
        if (this.opts.async && e.t.k === "promise" && ret.k !== "promise")
          e = { c: cpp.coAwait(e.c), t: e.t.inner };
        const value = this.coerce(e, ret, body);
        this.emit(this.opts.async ? cpp.coReturn(value) : cpp.ret(value));
      }
    }

    // A body that never awaits, returns or yields (it only throws, or does no more) would be a
    // plain C++ function, whose throw reaches the caller. A co_return after it makes it a
    // coroutine: what it throws rejects its promise, or runs at a generator's first next().
    if ((this.opts.async || this.opts.generator) && !isCoroutine(this.out[0]!))
      this.emit(cpp.coReturn(isVoidish(ret) ? undefined : this.unreachable(ret)));
  }

  private hoistFunctions(stmts: ts.NodeArray<ts.Statement>): void {
    // Nested function declarations are hoisted: declare them all first
    // (those after a guard clause that exits on this target are never reached).
    const fns = stmts.filter(ts.isFunctionDeclaration).filter((f) => this.runsHere(f));
    for (const f of fns) {
      const sym = this.checker.getSymbolAtLocation(f.name!)!;
      const t = this.lt(f);
      const l = this.declare(sym, f.name!.text, t);
      l.boxed = true;
      this.emit(cpp.varDecl(cpp.type("lucent::Box", this.reg.cppType(t)), l.cpp));
    }
    // A function that captures a variable declared later in this block is
    // defined where it is written (the variable is in its temporal dead zone
    // before that anyway); the others are available from the block's start.
    const laterDecls = new Set<ts.Symbol>();
    for (const st of stmts) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        const names: ts.Identifier[] = [];
        const collect = (n: ts.Node): void => {
          if (
            ts.isIdentifier(n) &&
            (ts.isVariableDeclaration(n.parent) || ts.isBindingElement(n.parent))
          )
            names.push(n);
          ts.forEachChild(n, collect);
        };
        collect(d.name);
        for (const id of names) {
          const sym = this.checker.getSymbolAtLocation(id);
          if (sym) laterDecls.add(sym);
        }
      }
    }
    for (const f of fns) {
      if (freeVariables(this.checker, f).some((v) => laterDecls.has(v))) {
        this.deferredFns.add(f);
        continue;
      }
      this.defineFunction(f);
    }
  }

  private readonly deferredFns = new Set<ts.FunctionDeclaration>();

  private defineFunction(f: ts.FunctionDeclaration): void {
    const sym = this.checker.getSymbolAtLocation(f.name!)!;
    const l = this.findLocal(sym)!;
    const e = this.closure(f);
    this.emit(cpp.exprStmt(cpp.assign(cpp.deref(cpp.id(l.cpp)), e.c)));
  }

  /** The object `this` is, as a reference (`self` in closures and coroutines). */
  selfRefExpr(): cpp.Expr {
    return this.opts.thisRef ? cpp.id(this.opts.thisRef) : cpp.call("lucent::selfRef", [cpp.self]);
  }

  // --- statements --------------------------------------------------------------------

  stmt(s: ts.Statement): void {
    // After a guard clause that exits on this target: code another platform runs.
    if (!this.runsHere(s)) return;
    this.ctx.guard(() => this.stmtInner(s));
  }

  /**
   * Whether this target runs `node`, by the platform branches, cases and
   * guard clauses around it; the host runs no platform's code.
   */
  runsHere(node: ts.Node): boolean {
    const p = branchPlatform(this.checker, node);
    return p === undefined || p === this.ctx.platform;
  }

  private lineDirective(node: ts.Node): void {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    // Absolute, so debuggers and crash symbolication open the source file.
    this.emit(cpp.lineDirective(line + 1, sourcePath(sf.fileName)));
  }

  private stmtInner(s: ts.Statement): void {
    if (!ts.isBlock(s) && !ts.isFunctionDeclaration(s)) this.lineDirective(s);
    switch (s.kind) {
      case ts.SyntaxKind.Block: {
        this.emit(cpp.block(this.nested(s)));
        return;
      }
      case ts.SyntaxKind.EmptyStatement:
        return;
      case ts.SyntaxKind.FunctionDeclaration:
        if (this.deferredFns.has(s as ts.FunctionDeclaration))
          this.defineFunction(s as ts.FunctionDeclaration);
        return; // otherwise hoisted
      case ts.SyntaxKind.VariableStatement:
        return this.varStatement((s as ts.VariableStatement).declarationList);
      case ts.SyntaxKind.ExpressionStatement: {
        const x = (s as ts.ExpressionStatement).expression;
        if (ts.isYieldExpression(x)) return this.yieldStmt(x);
        const sc = this.opts.superCtor;
        if (sc && ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.SuperKeyword) {
          this.emit(cpp.exprStmt(cpp.call(sc.call, this.args(x.arguments, sc.params, x))));
          sc.after(this);
          return;
        }
        const e = this.expr(ts.isVoidExpression(x) ? x.expression : x);
        this.emit(cpp.exprStmt(cpp.cast("c", cpp.voidType, e.c)));
        return;
      }
      case ts.SyntaxKind.ReturnStatement:
        return this.returnStmt(s as ts.ReturnStatement);
      case ts.SyntaxKind.IfStatement:
        return this.ifStmt(s as ts.IfStatement);
      case ts.SyntaxKind.WhileStatement:
        return this.whileStmt(s as ts.WhileStatement, []);
      case ts.SyntaxKind.DoStatement:
        return this.doStmt(s as ts.DoStatement, []);
      case ts.SyntaxKind.ForStatement:
        return this.forStmt(s as ts.ForStatement, []);
      case ts.SyntaxKind.ForOfStatement:
        return this.forOfStmt(s as ts.ForOfStatement, []);
      case ts.SyntaxKind.ForInStatement:
        return this.forInStmt(s as ts.ForInStatement, []);
      case ts.SyntaxKind.SwitchStatement:
        return this.switchStmt(s as ts.SwitchStatement, []);
      case ts.SyntaxKind.LabeledStatement:
        return this.labeled(s as ts.LabeledStatement);
      case ts.SyntaxKind.BreakStatement:
        return this.jump("break", (s as ts.BreakStatement).label?.text, s);
      case ts.SyntaxKind.ContinueStatement:
        return this.jump("continue", (s as ts.ContinueStatement).label?.text, s);
      case ts.SyntaxKind.ThrowStatement:
        return this.throwStmt(s as ts.ThrowStatement);
      case ts.SyntaxKind.TryStatement:
        return this.tryStmt(s as ts.TryStatement);
      case ts.SyntaxKind.TypeAliasDeclaration:
      case ts.SyntaxKind.InterfaceDeclaration:
        return;
      case ts.SyntaxKind.ClassDeclaration:
        fail(s, Codes.UnsupportedSyntax, "classes must be declared at the top level of a module");
      default:
        fail(s, Codes.UnsupportedSyntax, `unsupported statement: ${ts.SyntaxKind[s.kind]}`);
    }
  }

  private varStatement(list: ts.VariableDeclarationList): void {
    if (!(list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
      for (const d of list.declarations) this.ctx.markFailed(d.name);
      fail(list, Codes.UnsupportedSyntax, "use `let` or `const` instead of `var`");
    }
    for (const d of list.declarations) this.declaration(d, !!(list.flags & ts.NodeFlags.Const));
  }

  /** One variable of a `let`, `const` or `using` declaration. */
  private declaration(d: ts.VariableDeclaration, isConst = true): void {
    if (ts.isIdentifier(d.name)) {
      const sym = this.checker.getSymbolAtLocation(d.name)!;
      let declared: LType;
      try {
        declared = this.reg.lower(this.checker.getTypeOfSymbolAtLocation(sym, d.name), d.name);
      } catch (e) {
        this.ctx.failed.add(sym);
        throw e;
      }
      const type = declared.k === "never" ? T.undefined : declared;

      // `const s: string = fail()` throws before `s` has a value: it is declared without one.
      if (d.initializer && this.diverges(d.initializer)) {
        this.emit(...this.diverging(this.expr(d.initializer)));
        this.declareVar(sym, d.name.text, type, undefined);
        return;
      }

      if (this.ctx.capture.isBoxed(sym)) {
        // Declare the box first so a closure in the initializer can refer
        // to the variable itself (recursive arrows).
        const l = this.declareVar(sym, d.name.text, type, undefined);
        if (d.initializer)
          this.emit(
            cpp.exprStmt(cpp.assign(cpp.deref(cpp.id(l.cpp)), this.exprAs(d.initializer, type))),
          );
        return;
      }
      const kind = this.counters.has(sym)
        ? "i64"
        : type.k === "number"
          ? this.ints.get(sym)
          : undefined;
      if (kind && d.initializer) {
        const init = this.toKind(this.expr(d.initializer, T.number), kind, d);
        const l = this.declare(sym, d.name.text, type);
        l.int = kind;
        this.emit(cpp.varDecl(cpp.type(INT_CPP[kind]), l.cpp, init));
        return;
      }
      let init: cpp.Expr | undefined;
      try {
        init = d.initializer ? this.exprAs(d.initializer, type) : undefined;
      } catch (e) {
        // Declared anyway, so later uses do not also report it as unknown.
        this.declareVar(sym, d.name.text, type, undefined);
        throw e;
      }
      this.declareVar(sym, d.name.text, type, init);
      return;
    }
    if (!d.initializer)
      fail(d, Codes.UnsupportedDestructuring, "destructuring requires an initializer");
    const e = this.expr(d.initializer);
    const tmp = this.ctx.fresh("d");
    this.emit(cpp.varDecl(this.reg.cppType(e.t), tmp, e.c));
    this.bindPattern(d.name, { c: cpp.id(tmp), t: e.t }, isConst);
  }

  /** Declares the variables of a destructuring pattern from `source`. */
  bindPattern(pattern: ts.BindingName, source: E, _isConst: boolean): void {
    if (ts.isIdentifier(pattern)) {
      const sym = this.checker.getSymbolAtLocation(pattern)!;
      const type = this.reg.lower(this.checker.getTypeOfSymbolAtLocation(sym, pattern), pattern);
      this.declareVar(sym, pattern.text, type, this.coerce(source, type, pattern));
      return;
    }
    if (ts.isObjectBindingPattern(pattern)) {
      for (const el of pattern.elements) {
        if (el.dotDotDotToken)
          fail(el, Codes.UnsupportedDestructuring, "object rest in destructuring is not supported");
        const key = el.propertyName ?? (el.name as ts.Identifier);
        if (!ts.isIdentifier(key) && !ts.isStringLiteral(key))
          fail(
            el,
            Codes.UnsupportedDestructuring,
            "computed keys in destructuring are not supported",
          );
        const name = key.text;
        let v = this.member(source, name, el);
        if (el.initializer) v = this.withDefault(v, el.initializer, el);
        this.bindPattern(el.name, v, _isConst);
      }
      return;
    }
    // Array pattern
    pattern.elements.forEach((el, i) => {
      if (ts.isOmittedExpression(el)) return;
      if (el.dotDotDotToken) {
        if (source.t.k !== "array")
          fail(el, Codes.UnsupportedDestructuring, "rest elements need an array");
        const rest = cpp.call(cpp.dot(source.c, "slice"), [numberExpr(i)]);
        this.bindPattern(el.name, { c: rest, t: source.t }, _isConst);
        return;
      }
      let v: E;
      const st = stripOpt(source.t);
      if (st.k === "tuple") v = { c: cpp.call("std::get", [source.c], [cpp.num(i)]), t: st.es[i]! };
      else if (st.k === "array")
        v = {
          c: cpp.call(cpp.dot(source.c, "get"), [numberExpr(i)]),
          t: unionOf([st.e, T.undefined]),
        };
      else fail(el, Codes.UnsupportedDestructuring, `cannot destructure ${typeKey(source.t)}`);
      if (el.initializer) v = this.withDefault(v, el.initializer, el);
      this.bindPattern(el.name, v, _isConst);
    });
  }

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

  private returnStmt(s: ts.ReturnStatement): void {
    const ret = this.opts.returnType;
    const co = this.opts.async || this.opts.generator;
    if (this.opts.generator && s.expression)
      fail(s, Codes.UnsupportedSyntax, "generators cannot return a value; use `return;`");
    // `return fail()` throws: there is no value to return, or to route through finally blocks.
    if (s.expression && !isVoidish(ret) && this.diverges(s.expression)) {
      this.emit(...this.diverging(this.expr(s.expression)));
      return;
    }

    let value: cpp.Expr | undefined;
    if (s.expression) {
      let e = this.expr(s.expression, ret);
      // `return promise` in an async function returns the promised value.
      if (this.opts.async && e.t.k === "promise" && ret.k !== "promise")
        e = { c: cpp.coAwait(e.c), t: isVoidish(e.t.inner) ? T.undefined : e.t.inner };
      if (isVoidish(ret)) {
        if (!(e.c.k === "id" && e.c.name === "lucent::undefined")) this.emit(cpp.exprStmt(e.c));
      } else value = this.coerce(e, ret, s.expression);
    } else if (!isVoidish(ret)) {
      value = this.coerce({ c: cpp.id("lucent::undefined"), t: T.undefined }, ret, s);
    }
    if (this.opts.isConstructor) {
      this.emit(cpp.ret());
      return;
    }
    // Route through enclosing finally blocks.
    const fin = this.ctl.findLast((c) => c.kind === "finally");
    if (fin) {
      if (value !== undefined) {
        if (!this.retVar) {
          this.retVar = this.ctx.fresh("ret");
          this.prologue.push(
            cpp.varDecl(this.reg.cppType(ret), this.retVar, undefined, { style: "brace" }),
          );
        }
        this.emit(cpp.exprStmt(cpp.assign(cpp.id(this.retVar), value)));
      }
      this.routeThroughFinally(fin, 1, () => this.emitReturnAfterFinally(fin));
      return;
    }
    this.emit(co ? cpp.coReturn(value) : cpp.ret(value));
  }

  /** `yield x;` and `yield* iterable;` (a yield's own value is not supported). */
  private yieldStmt(y: ts.YieldExpression): void {
    if (!this.opts.generator) fail(y, Codes.UnsupportedSyntax, "`yield` outside a generator");
    const elem = this.generatorElement(y);
    if (!y.asteriskToken) {
      const value = y.expression
        ? this.exprAs(y.expression, elem)
        : this.coerce({ c: cpp.id("lucent::undefined"), t: T.undefined }, elem, y);
      this.emit({ k: "coYield", value });
      return;
    }
    // Delegation: forward each value; closing the outer generator closes the inner one.
    const src = this.iterExpr(this.expr(y.expression!), y.expression!);
    const it = this.ctx.fresh("deleg");
    const [v, close] = [cpp.id(`${it}_v`), cpp.id(`${it}_close`)];
    const next = { c: cpp.call("std::move", [cpp.deref(v)]), t: src.e };
    this.emit(
      cpp.block([
        cpp.varDecl(cpp.auto, it, src.c),
        cpp.varDecl(
          cpp.type("lucent::IterCloser", this.reg.cppType(src.e)),
          `${it}_close`,
          cpp.id(it),
          {
            style: "construct",
          },
        ),
        {
          k: "for",
          body: [
            cpp.varDecl(cpp.auto, `${it}_v`, cpp.call(cpp.arrow(cpp.id(it), "next"))),
            cpp.ifStmt(cpp.not(v), [
              cpp.exprStmt(cpp.call(cpp.dot(close, "exhausted"))),
              { k: "break" },
            ]),
            { k: "coYield", value: this.coerce(next, elem, y) },
          ],
        },
      ]),
    );
  }

  /** The element type the current generator yields. */
  private generatorElement(node: ts.Node): LType {
    let fn: ts.Node | undefined = node.parent;
    while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
    const sig = fn
      ? this.checker.getSignatureFromDeclaration(fn as ts.SignatureDeclaration)
      : undefined;
    const ret = sig ? this.reg.lower(this.checker.getReturnTypeOfSignature(sig), node) : undefined;
    if (!ret || ret.k !== "iter")
      fail(node, Codes.UnsupportedSyntax, "annotate generators with Generator<T> or Iterable<T>");
    return ret.e;
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

  private emitReturnAfterFinally(fin: ControlEntry): void {
    const idx = this.ctl.indexOf(fin);
    const outer = this.ctl.slice(0, idx).findLast((c) => c.kind === "finally");
    const co = this.opts.async || this.opts.generator;
    if (outer) {
      this.routeThroughFinally(outer, 1, () => this.emitReturnAfterFinally(outer));
      return;
    }
    const value = this.retVar ? cpp.id(this.retVar) : undefined;
    this.emit(co ? cpp.coReturn(value) : cpp.ret(value));
  }

  /** Sets the finally completion code and jumps to the finally block. */
  private routeThroughFinally(fin: ControlEntry, code: number, after: () => void): void {
    if (!fin.pending!.has(code)) fin.pending!.set(code, after);
    this.emit(
      cpp.block([
        cpp.exprStmt(cpp.assign(cpp.id(fin.finVar!), cpp.num(code))),
        { k: "goto", label: fin.finLabel! },
      ]),
    );
  }

  /** Code that runs on iOS or Android only, reached on the host: throws, typed as `cpp`. */
  private platformOnly(node: ts.Node, type: cpp.Type): cpp.Expr {
    const sf = node.getSourceFile();
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const message = `${path.basename(sf.fileName)}:${line}: this code runs only on iOS and Android`;
    return cpp.call("lucent::platformOnly", [stringExpr(message)], [type]);
  }

  private ifStmt(s: ts.IfStatement): void {
    // `if (PLATFORM === "ios" && …)`: what this target can run; the host has neither platform.
    const guard = platformGuard(this.checker, s.expression);
    if (guard && !this.ctx.platform)
      return this.emit(cpp.exprStmt(this.platformOnly(s, cpp.voidType)));
    if (guard && (guard.platform !== this.ctx.platform || !guard.rest.length)) {
      const live = guard.platform === this.ctx.platform ? s.thenStatement : s.elseStatement;
      if (live) this.emit(cpp.block(this.nested(live)));
      return;
    }
    const test = guard ? cpp.and(...guard.rest.map((r) => this.cond(r))) : this.cond(s.expression);
    const body = this.nested(s.thenStatement);
    this.emit(cpp.ifStmt(test, body, s.elseStatement ? this.nested(s.elseStatement) : undefined));
  }

  /** A statement as a block body (without extra braces for blocks), in a scope of its own. */
  private nested(s: ts.Statement, before?: () => void): cpp.Stmt[] {
    return this.collect(() => {
      this.pushScope();
      before?.();
      if (ts.isBlock(s)) {
        this.hoistFunctions(s.statements);
        this.statements(s.statements);
      } else this.stmt(s);
      this.popScope();
    });
  }

  private loopEntry(labels: string[]): ControlEntry {
    const e: ControlEntry = {
      kind: "loop",
      labels,
      breakLabel: this.ctx.fresh("brk"),
      continueLabel: this.ctx.fresh("cont"),
    };
    this.ctl.push(e);
    return e;
  }

  /** A loop's body: its statements in a block, then the continue label when used. */
  private loopBody(body: ts.Statement, entry: ControlEntry, before?: () => void): cpp.Stmt[] {
    const check = this.opts.task ? [safepoint()] : [];
    const inner = cpp.block([...check, ...this.nested(body, before)]);
    return entry.usedContinueLabel ? [inner, { k: "label", name: entry.continueLabel! }] : [inner];
  }

  private endLoop(entry: ControlEntry): void {
    this.ctl.pop();
    if (entry.usedBreakLabel) this.emit({ k: "label", name: entry.breakLabel! });
  }

  private whileStmt(s: ts.WhileStatement, labels: string[]): void {
    const entry = this.loopEntry(labels);
    const test = this.cond(s.expression);
    this.emit({ k: "while", test, body: this.loopBody(s.statement, entry) });
    this.endLoop(entry);
  }

  private doStmt(s: ts.DoStatement, labels: string[]): void {
    const entry = this.loopEntry(labels);
    const body = this.loopBody(s.statement, entry);
    this.emit({ k: "doWhile", body, test: this.cond(s.expression) });
    this.endLoop(entry);
  }

  private forStmt(s: ts.ForStatement, labels: string[]): void {
    this.emit(cpp.block(this.collect(() => this.forLoop(s, labels))));
  }

  private forLoop(s: ts.ForStatement, labels: string[]): void {
    this.pushScope();
    const perIteration: { sym: ts.Symbol; name: string; local: Local }[] = [];
    if (s.initializer) {
      if (ts.isVariableDeclarationList(s.initializer)) {
        this.varStatement(s.initializer);
        // `let` loop variables captured by closures get a per-iteration copy.
        for (const d of s.initializer.declarations) {
          if (ts.isIdentifier(d.name)) {
            const sym = this.checker.getSymbolAtLocation(d.name)!;
            const l = this.findLocal(sym)!;
            if (l.boxed && !assignedWithin(this.checker, s.statement, sym))
              perIteration.push({ sym, name: d.name.text, local: l });
          }
        }
      } else this.emit(cpp.exprStmt(this.expr(s.initializer).c));
    }
    const entry = this.loopEntry(labels);
    const test = s.condition ? this.cond(s.condition) : cpp.bool(true);
    const update = s.incrementor
      ? cpp.cast("c", cpp.voidType, this.expr(s.incrementor).c)
      : undefined;
    const body = this.loopBody(s.statement, entry, () => {
      for (const p of perIteration) {
        const copy: Local = { cpp: `${p.local.cpp}_it`, type: p.local.type, boxed: true };
        const box = cpp.type("lucent::Box", this.reg.cppType(p.local.type));
        const value = cpp.deref(cpp.id(p.local.cpp));
        this.emit(cpp.varDecl(box, copy.cpp, value, { style: "construct" }));
        this.scopes[this.scopes.length - 1]!.set(p.sym, copy);
      }
    });
    this.emit({ k: "for", test, ...(update ? { update } : {}), body });
    this.endLoop(entry);
    this.popScope();
  }

  private forOfStmt(s: ts.ForOfStatement, labels: string[]): void {
    if (s.awaitModifier) fail(s, Codes.UnsupportedLoop, "`for await` is not supported");
    const iterable = this.expr(s.expression);
    const it = stripOpt(iterable.t);
    const coll = this.ctx.fresh("coll");
    const idx = this.ctx.fresh("i");
    const [c, i] = [cpp.id(coll), cpp.id(idx)];
    const size = cpp.type("size_t");
    /** `for (size_t i = 0; i < n; i++)` over `items`. */
    const counted = (items: cpp.Expr, body: cpp.Stmt[]): cpp.Stmt => ({
      k: "for",
      init: cpp.varDecl(size, idx, cpp.num(0)),
      test: cpp.binary(i, "<", cpp.call(cpp.dot(items, "size"))),
      update: cpp.postfix("++", i),
      body,
    });
    const bindElem = (value: E) => {
      const init = s.initializer;
      if (ts.isVariableDeclarationList(init)) {
        const d = init.declarations[0]!;
        this.bindPattern(d.name, value, true);
      } else {
        this.emit(cpp.exprStmt(this.assignTo(init, value, init)));
      }
    };
    const block = this.collect(() => {
      this.emit(cpp.varDecl(cpp.auto, coll, iterable.c));
      const entry = this.loopEntry(labels);
      const body = (elem: E, head: cpp.Stmt[] = []) => [
        ...head,
        ...this.loopBody(s.statement, entry, () => bindElem(elem)),
      ];
      const at = (items: cpp.Expr) => cpp.call(cpp.dot(items, "at"), [i]);
      if (it.k === "array" || it.k === "regexMatch") {
        const items = it.k === "regexMatch" ? cpp.arrow(c, "items") : c;
        const elem: E =
          it.k === "regexMatch"
            ? { c: at(items), t: unionOf([T.string, T.undefined]) }
            : { c: at(c), t: it.e };
        this.emit(counted(items, body(elem)));
      } else if (it.k === "string") {
        const cps = cpp.id(`${coll}_cps`);
        this.emit(cpp.varDecl(cpp.auto, `${coll}_cps`, cpp.call("lucent::splitCodePoints", [c])));
        this.emit(counted(cps, body({ c: at(cps), t: T.string })));
      } else if (it.k === "bytes") {
        this.emit(counted(c, body({ c: at(c), t: T.number })));
      } else if (it.k === "map" || it.k === "set" || it.k === "dict") {
        const table = cpp.call(cpp.dot(c, "table"));
        const guard = cpp.nestedType(cpp.type("std::decay_t", cpp.decltype(table)), "Iterating");
        this.emit(cpp.varDecl(guard, `${coll}_guard`, table, { style: "construct" }));
        const slot = cpp.call(cpp.dot(table, "slot"), [i]);
        const entryOf = (key: cpp.Type): cpp.Expr =>
          cpp.construct(cpp.type("std::tuple", key, this.reg.cppType((it as { val: LType }).val)), [
            cpp.dot(slot, "key"),
            cpp.dot(slot, "value"),
          ]);
        const elem: E =
          it.k === "set"
            ? { c: cpp.dot(slot, "key"), t: it.e }
            : it.k === "map"
              ? { c: entryOf(this.reg.cppType(it.key)), t: { k: "tuple", es: [it.key, it.val] } }
              : {
                  c: entryOf(cpp.type("lucent::String")),
                  t: { k: "tuple", es: [T.string, it.val] },
                };
        const live = cpp.ifStmt(cpp.not(cpp.call(cpp.dot(table, "slotLive"), [i])), [
          { k: "continue" },
        ]);
        this.emit({
          k: "for",
          init: cpp.varDecl(size, idx, cpp.num(0)),
          test: cpp.binary(i, "<", cpp.call(cpp.dot(table, "slotCount"))),
          update: cpp.postfix("++", i),
          body: body(elem, [live]),
        });
      } else if (it.k === "iter") {
        // Leaving early (break, return, throw) closes the iterator, which runs
        // a generator's finally blocks; running out does not.
        const [v, close] = [cpp.id(`${coll}_v`), cpp.id(`${coll}_close`)];
        const closer = cpp.type("lucent::IterCloser", this.reg.cppType(it.e));
        this.emit(cpp.varDecl(closer, `${coll}_close`, c, { style: "construct" }));
        const head = [
          cpp.varDecl(cpp.auto, `${coll}_v`, cpp.call(cpp.arrow(c, "next"))),
          cpp.ifStmt(cpp.not(v), [
            cpp.exprStmt(cpp.call(cpp.dot(close, "exhausted"))),
            { k: "break" },
          ]),
        ];
        this.emit({
          k: "for",
          body: body({ c: cpp.call("std::move", [cpp.deref(v)]), t: it.e }, head),
        });
      } else {
        fail(s.expression, Codes.UnsupportedLoop, `cannot iterate over ${typeKey(iterable.t)}`);
      }
      this.endLoop(entry);
    });
    this.emit(cpp.block(block));
  }

  private forInStmt(s: ts.ForInStatement, labels: string[]): void {
    const obj = this.expr(s.expression);
    const t = stripOpt(obj.t);
    const keys = this.ctx.fresh("keys");
    const idx = this.ctx.fresh("i");
    const [k, i] = [cpp.id(keys), cpp.id(idx)];
    const strings = cpp.type("lucent::Array", cpp.type("lucent::String"));
    const block = this.collect(() => {
      if (t.k === "dict") this.emit(cpp.varDecl(cpp.auto, keys, cpp.call(cpp.dot(obj.c, "keys"))));
      else if (t.k === "struct") {
        const names = this.reg.struct(t.id).fields.map((f) => stringExpr(f.name));
        this.emit(cpp.varDecl(strings, keys, cpp.comma(...names), { style: "brace" }));
      } else if (t.k === "array") {
        const n = cpp.id("k");
        this.emit(cpp.varDecl(strings, keys), {
          k: "for",
          init: cpp.varDecl(cpp.type("size_t"), "k", cpp.num(0)),
          test: cpp.binary(n, "<", cpp.call(cpp.dot(obj.c, "size"))),
          update: cpp.postfix("++", n),
          body: [
            cpp.exprStmt(
              cpp.call(cpp.dot(k, "push"), [
                cpp.call("lucent::numberToString", [cpp.staticCast(cpp.type("double"), n)]),
              ]),
            ),
          ],
        });
      } else fail(s.expression, Codes.UnsupportedLoop, `cannot use for-in over ${typeKey(obj.t)}`);
      const entry = this.loopEntry(labels);
      const body = this.loopBody(s.statement, entry, () => {
        const init = s.initializer;
        const value: E = { c: cpp.call(cpp.dot(k, "at"), [i]), t: T.string };
        if (ts.isVariableDeclarationList(init))
          this.bindPattern(init.declarations[0]!.name, value, true);
        else this.emit(cpp.exprStmt(this.assignTo(init, value, init)));
      });
      this.emit({
        k: "for",
        init: cpp.varDecl(cpp.type("size_t"), idx, cpp.num(0)),
        test: cpp.binary(i, "<", cpp.call(cpp.dot(k, "size"))),
        update: cpp.postfix("++", i),
        body,
      });
      this.endLoop(entry);
    });
    this.emit(cpp.block(block));
  }

  private switchStmt(s: ts.SwitchStatement, labels: string[]): void {
    const runs = switchPlatforms(this.checker, s);
    if (runs) return this.platformSwitch(s, labels, runs);
    const e = this.expr(s.expression);
    const disc = this.hold(this.ctx.fresh("sw"), e);
    const m = this.ctx.fresh("case");
    const matched = cpp.id(m);
    const block = this.collect(() => {
      this.emit(...disc.run, cpp.varDecl(cpp.type("int"), m, cpp.num(-1)));
      // The first case equal to the value, as JavaScript compares them (===).
      const tests: { test: cpp.Expr; index: number }[] = [];
      let defaultIndex = -1;
      s.caseBlock.clauses.forEach((c, i) => {
        if (ts.isDefaultClause(c)) {
          defaultIndex = i;
          return;
        }
        const v = this.expr(c.expression);
        tests.push({ test: this.equality(disc.value, v, true, c.expression), index: i });
      });
      const pick = (index: number) => cpp.exprStmt(cpp.assign(matched, cpp.num(index)));
      let chain: cpp.Stmt[] | undefined = defaultIndex >= 0 ? [pick(defaultIndex)] : undefined;
      for (const { test, index } of tests.toReversed())
        chain = [cpp.ifStmt(test, [pick(index)], chain)];
      if (chain) this.emit(...chain);
      const entry: ControlEntry = { kind: "switch", labels, breakLabel: this.ctx.fresh("brk") };
      this.ctl.push(entry);
      const cases = s.caseBlock.clauses.map((c, i) => ({
        values: [cpp.num(i)],
        body: [cpp.block(this.collect(() => this.clause(c)))],
      }));
      this.emit({
        k: "switch",
        on: matched,
        cases: [...cases, { values: [], isDefault: true, body: [{ k: "break" }] }],
      });
      this.ctl.pop();
      if (entry.usedBreakLabel) this.emit({ k: "label", name: entry.breakLabel! });
    });
    this.emit(cpp.block(block));
  }

  /** A case clause's statements, in a scope of their own. */
  private clause(c: ts.CaseOrDefaultClause): void {
    this.pushScope();
    for (const x of c.statements) {
      // Its scope would be the whole switch, disposed after the clauses that fall through.
      if (ts.isVariableStatement(x) && isUsing(x.declarationList))
        fail(x, Codes.UnsupportedSyntax, "wrap a using declaration in a case clause in a block");
      this.stmt(x);
    }
    this.popScope();
  }

  /**
   * `switch (PLATFORM)`: the clauses this target runs, in order (its case and
   * what it falls through to), in a C++ switch that `break` leaves.
   */
  private platformSwitch(s: ts.SwitchStatement, labels: string[], runs: Platform[][]): void {
    if (!this.ctx.platform) return this.emit(cpp.exprStmt(this.platformOnly(s, cpp.voidType)));
    const target = this.ctx.platform;
    const entry: ControlEntry = { kind: "switch", labels, breakLabel: this.ctx.fresh("brk") };
    this.ctl.push(entry);
    const body = s.caseBlock.clauses
      .filter((_, i) => runs[i]!.includes(target))
      .map((c) => cpp.block(this.collect(() => this.clause(c))));
    this.emit({
      k: "switch",
      on: cpp.num(0),
      cases: [
        { values: [cpp.num(0)], body },
        { values: [], isDefault: true, body: [{ k: "break" }] },
      ],
    });
    this.ctl.pop();
    if (entry.usedBreakLabel) this.emit({ k: "label", name: entry.breakLabel! });
  }

  private labeled(s: ts.LabeledStatement): void {
    const labels = [s.label.text];
    let inner: ts.Statement = s.statement;
    while (ts.isLabeledStatement(inner)) {
      labels.push(inner.label.text);
      inner = inner.statement;
    }
    switch (inner.kind) {
      case ts.SyntaxKind.WhileStatement:
        return this.whileStmt(inner as ts.WhileStatement, labels);
      case ts.SyntaxKind.DoStatement:
        return this.doStmt(inner as ts.DoStatement, labels);
      case ts.SyntaxKind.ForStatement:
        return this.forStmt(inner as ts.ForStatement, labels);
      case ts.SyntaxKind.ForOfStatement:
        return this.forOfStmt(inner as ts.ForOfStatement, labels);
      case ts.SyntaxKind.ForInStatement:
        return this.forInStmt(inner as ts.ForInStatement, labels);
      case ts.SyntaxKind.SwitchStatement:
        return this.switchStmt(inner as ts.SwitchStatement, labels);
      default: {
        const entry: ControlEntry = { kind: "block", labels, breakLabel: this.ctx.fresh("brk") };
        this.ctl.push(entry);
        this.emit(cpp.block(this.nested(inner)));
        this.ctl.pop();
        if (entry.usedBreakLabel) this.emit({ k: "label", name: entry.breakLabel! });
      }
    }
  }

  private jump(kind: "break" | "continue", label: string | undefined, node: ts.Node): void {
    // Find the target.
    let targetIndex = -1;
    for (let i = this.ctl.length - 1; i >= 0; i--) {
      const c = this.ctl[i]!;
      if (c.kind === "finally") continue;
      if (label) {
        if (c.labels.includes(label)) {
          targetIndex = i;
          break;
        }
      } else if (c.kind === "loop" || (kind === "break" && c.kind === "switch")) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex < 0) fail(node, Codes.UnsupportedSyntax, `no target for ${kind}`);
    this.emitJump(kind, targetIndex);
  }

  private emitJump(kind: "break" | "continue", targetIndex: number): void {
    const target = this.ctl[targetIndex]!;
    const between = this.ctl.slice(targetIndex + 1);
    const fin = between.findLast((c) => c.kind === "finally");
    if (fin) {
      const code = (kind === "break" ? 100 : 200) + targetIndex;
      this.routeThroughFinally(fin, code, () => this.emitJump(kind, targetIndex));
      return;
    }
    // Plain C++ break/continue reach the innermost loop/switch.
    const innermostLoopOrSwitch = between.filter((c) => c.kind === "loop" || c.kind === "switch");
    if (kind === "break" && target.kind !== "block" && innermostLoopOrSwitch.length === 0) {
      this.emit({ k: "break" });
      return;
    }
    const loopsBetween = between.filter((c) => c.kind === "loop");
    if (kind === "continue" && loopsBetween.length === 0) {
      this.emit({ k: "continue" });
      return;
    }
    if (kind === "break") {
      target.usedBreakLabel = true;
      this.emit({ k: "goto", label: target.breakLabel! });
    } else {
      target.usedContinueLabel = true;
      this.emit({ k: "goto", label: target.continueLabel! });
    }
  }

  private throwStmt(s: ts.ThrowStatement): void {
    const e = this.expr(s.expression);
    const t = stripOpt(e.t);
    if (t.k === "error" || (t.k === "class" && this.reg.cls(t.id).isError))
      this.emit(cpp.exprStmt(cpp.call("lucent::throwError", [e.c])));
    else
      fail(
        s.expression,
        Codes.UnsupportedThrow,
        "only Error values can be thrown; use `throw new Error(...)`",
      );
  }

  private tryStmt(s: ts.TryStatement): void {
    this.emit(cpp.block(this.collect(() => this.tryBody(s))));
  }

  private tryBody(s: ts.TryStatement): void {
    const guarded = () => {
      if (!s.catchClause) return this.emit(...this.nested(s.tryBlock));
      const exceptionPtr = cpp.type("std::exception_ptr");
      const ex = this.ctx.fresh("ex");
      this.emit(cpp.varDecl(exceptionPtr, ex));
      this.emit({
        k: "try",
        body: this.nested(s.tryBlock),
        catches: [
          // iterator.return() unwinds a generator through finally blocks only.
          {
            param: cpp.param(cpp.reference(cpp.constType(cpp.type("lucent::GeneratorReturn")))),
            body: [{ k: "throw" }],
          },
          { body: [cpp.exprStmt(cpp.assign(cpp.id(ex), cpp.call("std::current_exception")))] },
        ],
      });
      const handler = this.collect(() => {
        this.pushScope();
        const v = s.catchClause!.variableDeclaration;
        if (v) {
          if (!ts.isIdentifier(v.name))
            fail(v, Codes.UnsupportedDestructuring, "destructuring in catch is not supported");
          const sym = this.checker.getSymbolAtLocation(v.name)!;
          this.declareVar(
            sym,
            v.name.text,
            T.error,
            cpp.call("lucent::currentError", [cpp.id(ex)]),
          );
        }
        this.statements(s.catchClause!.block.statements);
        this.popScope();
      });
      this.emit(cpp.ifStmt(cpp.id(ex), handler));
    };
    if (!s.finallyBlock) return guarded();
    this.withFinally(guarded, () => this.emit(cpp.block(this.nested(s.finallyBlock!))));
  }

  /**
   * `guarded`, then `final` however `guarded` is left, as try/finally does:
   * returns, breaks and continues out of it run `final` first, and an
   * exception is rethrown after it. `final` gets the pending exception (null
   * when there is none), which it may replace.
   */
  private withFinally(guarded: () => void, final: (pending: cpp.Expr) => void): void {
    const fin: ControlEntry = {
      kind: "finally",
      labels: [],
      finLabel: this.ctx.fresh("fin"),
      finVar: this.ctx.fresh("fc"),
      pending: new Map(),
    };
    const pending = cpp.id(`${fin.finVar}_ex`);
    this.emit(
      cpp.varDecl(cpp.type("int"), fin.finVar!, cpp.num(0)),
      cpp.varDecl(cpp.type("std::exception_ptr"), `${fin.finVar}_ex`),
    );
    this.ctl.push(fin);
    const body = this.collect(guarded);
    this.ctl.pop();
    this.emit(
      {
        k: "try",
        body,
        catches: [
          { body: [cpp.exprStmt(cpp.assign(pending, cpp.call("std::current_exception")))] },
        ],
      },
      { k: "label", name: fin.finLabel! },
    );
    final(pending);
    this.emit(cpp.ifStmt(pending, [cpp.exprStmt(cpp.call("std::rethrow_exception", [pending]))]));
    for (const [code, after] of fin.pending!)
      this.emit(
        cpp.ifStmt(cpp.binary(cpp.id(fin.finVar!), "==", cpp.num(code)), this.collect(after)),
      );
  }

  /**
   * A list of statements. A `using` declaration disposes its value however
   * the rest of the list is left: the rest runs guarded, and disposing is
   * its finally.
   */
  private statements(list: readonly ts.Statement[]): void {
    for (const [i, s] of list.entries()) {
      if (ts.isVariableStatement(s) && isUsing(s.declarationList)) {
        this.lineDirective(s);
        if ((s.declarationList.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing)
          fail(s, Codes.UnsupportedSyntax, "`await using` is not supported; use `using`");
        return this.using(s.declarationList.declarations, () => this.statements(list.slice(i + 1)));
      }
      this.stmt(s);
    }
  }

  /** `using a = …, b = …;` then `rest`: disposed in reverse, each whatever happens to the others. */
  private using(decls: readonly ts.VariableDeclaration[], rest: () => void): void {
    const [d, ...more] = decls;
    if (!d) return rest();
    if (!ts.isIdentifier(d.name))
      fail(d, Codes.UnsupportedDestructuring, "a using declaration names one value");
    this.declaration(d);
    const value = this.expr(d.name);
    this.withFinally(
      () => this.using(more, rest),
      (pending) => this.dispose(value, pending, d),
    );
  }

  /**
   * Disposes a `using` value (nothing for null or undefined). Disposing that
   * throws while an exception is pending replaces it with a SuppressedError
   * of both, as in JavaScript; otherwise its exception propagates.
   */
  private dispose(v: E, pending: cpp.Expr, node: ts.Node): void {
    const t = stripOpt(v.t);
    if (t.k === "null" || t.k === "undefined") return;
    const present = v.t.k === "opt" ? this.coerce(v, t, node) : v.c;
    const suppressed = cpp.call("lucent::suppressedError", [
      cpp.call("std::current_exception"),
      pending,
    ]);
    const call: cpp.Stmt = {
      k: "try",
      body: [cpp.exprStmt(builtins.disposeCall(this, { c: present, t }, node))],
      catches: [
        {
          body: [
            cpp.ifStmt(pending, [cpp.exprStmt(cpp.assign(pending, suppressed))], [{ k: "throw" }]),
          ],
        },
      ],
    };
    this.emit(v.t.k === "opt" ? cpp.ifStmt(cpp.call(cpp.dot(v.c, "has")), [call]) : call);
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
      case ts.SyntaxKind.CallExpression: {
        const call = node as ts.CallExpression;
        // A toolkit's body (`swiftUI(() => …)`, `compose(() => …)`), or withAnimation.
        const drawn = toolkitCall(this, call);
        if (drawn) return drawn;
        this.checkInstance(call);
        if (builtins.isJsonParse(this, call)) return this.jsonParse(call, hint);
        return this.narrowed(node, this.call(call));
      }
      case ts.SyntaxKind.NewExpression:
        this.checkInstance(node as ts.NewExpression);
        return this.newExpr(node as ts.NewExpression);
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
    return this.inOrder(
      node.templateSpans.map((s) => s.expression),
      () => this.templateInner(node),
    );
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
          c: g.literal ? this.exprAs(g.literal, g.type) : cpp.id(g.cpp),
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
    return this.onTarget(target, undefined, () => this.incrementPlace(target, sign, postfix, node));
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

      // The target is written once: only a right side with effects can tell its parts' order.
      return isSimple(node.right) ? assign() : this.onTarget(node.left, node.right, assign);
    }
    const compound = ASSIGN_OPS.get(op);
    if (compound) return this.compoundAssign(node, compound);
    if (
      op === ts.SyntaxKind.QuestionQuestionEqualsToken ||
      op === ts.SyntaxKind.BarBarEqualsToken ||
      op === ts.SyntaxKind.AmpersandAmpersandEqualsToken
    )
      return this.onTarget(node.left, isSimple(node.right) ? undefined : node.right, () =>
        this.logicalAssign(node, op),
      );
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
      case ts.SyntaxKind.InKeyword: {
        const obj = this.expr(node.right);
        const ot = stripOpt(obj.t);
        const key = this.exprAs(node.left, T.string);
        if (ot.k === "dict") return { c: cpp.call(cpp.dot(obj.c, "has"), [key]), t: T.boolean };
        if (ot.k === "struct") {
          // One of the object type's field names.
          const names = this.reg
            .struct(ot.id)
            .fields.map((f) => cpp.binary(key, "==", stringExpr(f.name)));
          return { c: names.length ? cpp.or(...names) : cpp.bool(false), t: T.boolean };
        }
        fail(node, Codes.UnsupportedOperator, "`in` is only supported on records");
      }
    }
    return this.inOrder([node.left, node.right], () => this.binaryOp(node, op));
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
      return this.lvalue(target).type;
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
  private checkInstance(node: ts.CallExpression | ts.NewExpression): void {
    const lower = (t: ts.Type, at: ts.Node) => this.reg.lower(t, at);
    const instance = instanceAt(this.checker, lower, node);
    if (!instance) return;

    const { comparisons, types } = genericFacts(this.checker, lower, instance.generic);
    const { name, args, written } = instance;

    for (const t of types) {
      const broken = unionShapeBreak(t, args);
      if (!broken) continue;

      const arg = this.checker.typeToString(written.get(broken.param)!);

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

    return this.onTarget(node.left, readFirst ? node.right : undefined, () =>
      readFirst ? this.readThenAssign(node, op) : this.assignInPlace(node, op),
    );
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

    const read = () => this.member(this.receiver(node.expression), node.name.text, node);

    if (
      awaits(node.expression) &&
      native.declaredBySdk(this.checker.getSymbolAtLocation(node.name)?.valueDeclaration)
    )
      return this.awaitingFirst([node.expression], read);

    return read();
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
  private callValue(f: E, node: ts.CallExpression): E {
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
   * C++ leaves the evaluation order of function arguments (and of `a + b`)
   * unspecified; JavaScript evaluates left to right. When the order could be
   * observed, arguments are evaluated into temporaries first.
   */
  private inOrder(args: readonly ts.Expression[], build: () => E): E {
    const candidates = args.filter(
      (a) =>
        !isLiteral(a) &&
        !ts.isArrowFunction(a) &&
        !ts.isFunctionExpression(a) &&
        !this.subst.has(a),
    );
    if (candidates.length < 2 || candidates.every(isSimple)) return build();
    return this.evaluatedFirst(
      candidates.map((a) => (ts.isSpreadElement(a) ? a.expression : a)),
      build,
    );
  }

  /**
   * `build()`, after evaluating `nodes` into temporaries, in order: while
   * it runs, those nodes are their temporaries, so each runs exactly once.
   */
  private evaluatedFirst(nodes: readonly ts.Expression[], build: () => E): E {
    if (nodes.length === 0) return build();

    const temps: cpp.Stmt[] = [];
    const saved: ts.Expression[] = [];

    try {
      for (const target of nodes) {
        const e = this.expr(target);
        const { run, value } = this.hold(this.ctx.fresh("arg"), e);

        temps.push(...run);
        this.subst.set(target, value);
        saved.push(target);
      }

      const r = build();

      return {
        c: cpp.statementExpr(temps, r.c),
        t: r.t,
        int: r.int && { c: cpp.statementExpr(temps, r.int.c), kind: r.int.kind },
      };
    } finally {
      for (const s of saved) this.subst.delete(s);
    }
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

  /**
   * `build()` for an SDK call, read or construction, whose glue runs in C++
   * lambdas, where the calling coroutine cannot suspend: the operands up to
   * the last one that awaits are evaluated first, in order.
   */
  private awaitingFirst(operands: readonly ts.Expression[], build: () => E): E {
    const last = operands.findLastIndex(awaits);

    if (last < 0) return build();

    const awaiting = operands[last]!;
    const first = operands
      .slice(0, last + 1)
      .filter(
        (o) =>
          !ts.isSpreadElement(o) &&
          !isFunctionLike(o) &&
          (o === awaiting || !isSimple(o) || !this.unchangedBy(o, awaiting)),
      );

    return this.evaluatedFirst(first, build);
  }

  /**
   * `build()` for an assignment to `target`, whose object and key are
   * evaluated first and once, as JavaScript does: when they could have an
   * effect, or when `later` (a right side that runs before the target is
   * written) could change them.
   */
  private onTarget(target: ts.Expression, later: ts.Expression | undefined, build: () => E): E {
    const parts = targetParts(target).filter(
      (p) => !isSimple(p) || (later && !this.unchangedBy(p, later)),
    );

    return this.evaluatedFirst(parts, build);
  }

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
    const evaluated = computeOperands(this.checker, node) ?? node.arguments;

    const run = () =>
      evaluated.length >= 2
        ? this.inOrder(evaluated, () => this.callInner(node))
        : this.callInner(node);

    let callee: ts.Expression = node.expression;
    while (ts.isNonNullExpression(callee)) callee = callee.expression;
    const operands = [
      ...(ts.isPropertyAccessExpression(callee) ? [callee.expression] : []),
      ...node.arguments,
    ];

    if (
      operands.some(awaits) &&
      native.declaredBySdk(this.checker.getResolvedSignature(node)?.declaration)
    )
      return this.awaitingFirst(operands, run);

    return run();
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
        fail(a, Codes.UnsupportedCall, "spread arguments are only supported for rest parameters");
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

  private newExpr(node: ts.NewExpression): E {
    const args = node.arguments ?? [];

    const run = () =>
      args.length >= 2 ? this.inOrder(args, () => this.newInner(node)) : this.newInner(node);

    if (args.some(awaits) && this.lt(node).k === "native") return this.awaitingFirst(args, run);

    return run();
  }

  private newInner(node: ts.NewExpression): E {
    const callee = node.expression;
    const t = this.lt(node);
    if (t.k === "native") return native.nativeNew(this, node, t);
    if (t.k === "handle") return extensions.handleNew(this, node, t);
    if (t.k === "class") {
      requireSubclassMain(node, this.reg.cls(t.id), (n) => native.inMainContext(this, n));
      // The nearest constructor in the class chain (subclasses may inherit it).
      const owner = this.reg
        .chain(t)
        .find((c) => c.info.decl.members.some(ts.isConstructorDeclaration));
      const ctor = owner?.info.decl.members.find(ts.isConstructorDeclaration);
      const fnType: LType = ctor
        ? (this.reg.lowerSignature(this.checker.getSignatureFromDeclaration(ctor)!, ctor) as LType)
        : { k: "fn", params: [], ret: T.void };
      const params = ctor ? this.paramInfos(ctor, fnType as LType & { k: "fn" }) : [];
      let paramTypes = params.map((p) => p.cppType);
      if (owner && owner.t.args.length) {
        const oi = owner.info;
        const map = new Map(oi.typeParams.map((p, i) => [p, owner.t.args[i]!]));
        paramTypes = paramTypes.map((p) => substitute(p, map));
      }
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
          parts.push(cpp.exprStmt(cpp.call("lucent::assignEntries", [tmp, s.c])));
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
        parts.push(cpp.varDecl(cpp.auto, srcName, this.coerce(s, st, p)));
        const srcFields = this.reg.struct(st.id).fields;
        for (const f of info.fields) {
          const sf = srcFields.find((x) => x.name === f.name);
          if (!sf) continue;
          const value = this.coerce({ c: cpp.arrow(src, cppIdent(f.name)), t: sf.type }, f.type, p);
          parts.push(cpp.exprStmt(cpp.assign(field(f.name), value)));
        }
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

/**
 * What evaluating an assignment target runs before it is read or written:
 * its object and key (`super` names no value to evaluate).
 */
function targetParts(target: ts.Expression): ts.Expression[] {
  const t = unwrapTarget(target);
  const parts = ts.isElementAccessExpression(t)
    ? [t.expression, t.argumentExpression]
    : ts.isPropertyAccessExpression(t)
      ? [t.expression]
      : [];

  return parts.filter((p) => p.kind !== ts.SyntaxKind.SuperKeyword);
}

/** Whether evaluating `n` awaits: it is an `await`, or holds one outside nested functions. */
function awaits(n: ts.Expression): boolean {
  return ts.isAwaitExpression(n) || (!isFunctionLike(n) && containsAwait(n));
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

function usesThisIn(fn: ts.Node): boolean {
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

/** `using` or `await using`. */
function isUsing(list: ts.VariableDeclarationList): boolean {
  return (list.flags & ts.NodeFlags.Using) !== 0;
}
