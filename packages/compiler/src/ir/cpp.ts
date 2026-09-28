/**
 * IR → the C++ syntax tree. Each operation that does something becomes its
 * own statement, in the IR's order: a call's arguments are always named
 * values or literals, so C++'s unspecified argument order never decides
 * what runs first. Constants are inlined; a result nothing uses is dropped
 * (or, for a call, discarded with `(void)`).
 */
import { cpp } from "@lucent-lang/codegen";
import { type ConversionStep, conversionStep } from "../lowering/conversions.ts";
import { heldAs, throughMembers } from "../lowering/members.ts";
import { BIGINT_OPERATORS } from "../lowering/bigint.ts";
import { bigintExpr, numberExpr, stringExpr } from "../lowering/literals.ts";
import { sourcePath } from "../lowering/source.ts";
import { cppIdent, type LType } from "../types.ts";
import {
  type BinaryOp,
  type BuiltinName,
  type Constant,
  convertible,
  type EqualityOp,
  EXACT,
  type IrFunction,
  type IrOp,
  isAbsent,
  isEqualityOp,
  isPrimitive,
  operandsOf,
  type RegionId,
  type TargetId,
  type UnaryOp,
  type ValueId,
} from "./ir.ts";
import { IrUnsupported, lower, type Lowered, type LowerHost, type LowerInput } from "./lower.ts";
import { verify, type VerifyEnv } from "./verify.ts";

/**
 * Which lowering compiles functions: the legacy emitter (the default), the
 * IR where it supports the function and the legacy emitter elsewhere
 * (`ir`), or the IR only, failing on anything it does not support
 * (`ir-strict`, for tests). Internal: set with LUCENT_LOWERING.
 */
export type Lowering = "legacy" | "ir" | "ir-strict";

const LOWERINGS: readonly Lowering[] = ["legacy", "ir", "ir-strict"];

export function loweringMode(value = process.env.LUCENT_LOWERING): Lowering {
  if (!value) return "legacy";

  if (!(LOWERINGS as readonly string[]).includes(value))
    throw new Error(`LUCENT_LOWERING must be one of ${LOWERINGS.join(", ")} (got "${value}")`);

  return value as Lowering;
}

/**
 * A function lowered through the IR, verified and turned into C++; or,
 * under `ir`, undefined when the IR does not support it yet, for the
 * legacy emitter to lower. Never a JavaScript fallback at runtime.
 */
export function lowerToCpp(
  mode: Exclude<Lowering, "legacy">,
  input: LowerInput,
  host: LowerHost,
  backend: CppBackend,
): CppFunction | undefined {
  let lowered: Lowered;

  try {
    lowered = lower(input, host);
  } catch (e) {
    if (e instanceof IrUnsupported && mode === "ir") return undefined;

    throw e;
  }

  const { fn, signatures, effects } = lowered;

  return toCpp(fn, backend, {
    signature: (id) => signatures.get(id),
    effects: (id) => effects.get(id),
  });
}

/** What the compiler provides: its type representation, and the name Errors record as their site. */
export interface CppBackend {
  cppType(t: LType): cpp.Type;
  cppRetType(t: LType): cpp.Type;
  /** The function name the Errors it creates record as their site. */
  site: string;
}

export interface CppFunction {
  params: cpp.Param[];
  ret: cpp.Type;
  body: cpp.Stmt[];
}

/** The C++ of a function, after verifying it: nothing is generated from invalid IR. */
export function toCpp(fn: IrFunction, backend: CppBackend, env: VerifyEnv = {}): CppFunction {
  verify(fn, env);

  const emitter = new Emitter(fn, backend);
  const params = fn.params.map((v, i) => cpp.param(backend.cppType(fn.values[v]!.type), `p${i}_`));

  return { params, ret: backend.cppRetType(fn.result), body: emitter.region(fn.body) };
}

/** A loop or labeled block around the statement being emitted. */
interface Jump {
  target: TargetId;
  loop: boolean;
  /** A loop with a `next` region, which `continue` must run. */
  next: boolean;
}

class Emitter {
  readonly backend: CppBackend;
  private out: cpp.Stmt[] = [];
  private readonly fn: IrFunction;
  private readonly exprs = new Map<ValueId, cpp.Expr>();
  private readonly places = new Map<number, cpp.Expr>();
  private readonly uses = new Map<ValueId, number>();
  /** The loops and labeled blocks around the statement being emitted, innermost last. */
  private readonly jumps: Jump[] = [];
  /** The labels some `goto` names. */
  private readonly labels = new Set<string>();
  /** The result the `yield`s of the branch being emitted assign. */
  private yieldTo?: ValueId;
  private line?: string;

  constructor(fn: IrFunction, backend: CppBackend) {
    this.fn = fn;
    this.backend = backend;

    for (const p of fn.modulePlaces) this.places.set(p.place, cpp.id(p.symbol));

    this.countUses();
  }

  /**
   * How many operations use each value. A `yield` uses its value only when
   * its if's result is used: an unused result is not assigned, and the
   * values its branches give (another if's result) need no variable either.
   */
  private countUses(): void {
    const results = new Map<RegionId, ValueId>();
    const yields: { result: ValueId; value: ValueId }[] = [];
    const use = (v: ValueId) => this.uses.set(v, (this.uses.get(v) ?? 0) + 1);

    for (const r of this.fn.regions)
      for (const op of r.ops)
        if (op.kind === "if" && op.result !== undefined) {
          results.set(op.whenTrue, op.result);
          results.set(op.whenFalse, op.result);
        }

    for (const r of this.fn.regions)
      for (const op of r.ops) {
        const result = results.get(r.id);

        if (op.kind === "yield" && op.value !== undefined && result !== undefined)
          yields.push({ result, value: op.value });
        else operandsOf(op).forEach(use);
      }

    // Nested ifs: a used result makes the values its branches yield used, in turn.
    for (let pending = yields; ;) {
      const next = pending.filter((y) => !this.used(y.result));

      pending.filter((y) => this.used(y.result)).forEach((y) => use(y.value));

      if (next.length === pending.length) return;

      pending = next;
    }
  }

  /** The statements of region `id`. */
  region(id: RegionId): cpp.Stmt[] {
    const saved = this.out;
    const ops = this.fn.regions[id]!.ops;

    this.out = [];

    try {
      ops.forEach((op, i) =>
        (EMIT[op.kind] as (op: IrOp, e: Emitter, index: number, ops: readonly IrOp[]) => void)(
          op,
          this,
          i,
          ops,
        ),
      );
      return this.out;
    } finally {
      this.out = saved;
    }
  }

  /** The statements of a branch of an `if` whose `yield`s assign `result`. */
  branch(id: RegionId, result: ValueId | undefined): cpp.Stmt[] {
    const saved = this.yieldTo;

    this.yieldTo = result;

    try {
      return this.region(id);
    } finally {
      this.yieldTo = saved;
    }
  }

  /** The statements of `id` inside the loop or labeled block `jump`. */
  inside(jump: Jump | undefined, id: RegionId): cpp.Stmt[] {
    if (jump) this.jumps.push(jump);

    try {
      return this.region(id);
    } finally {
      if (jump) this.jumps.pop();
    }
  }

  /** The result a `yield` assigns, when the if's result is used. */
  get yielded(): ValueId | undefined {
    return this.yieldTo;
  }

  typeOf(v: ValueId): LType {
    return this.fn.values[v]!.type;
  }

  value(v: ValueId): cpp.Expr {
    return this.exprs.get(v)!;
  }

  place(p: number): cpp.Expr {
    return this.places.get(p)!;
  }

  used(v: ValueId): boolean {
    return (this.uses.get(v) ?? 0) > 0;
  }

  /** `v` is spelled `c` wherever it is used (a literal or a parameter). */
  inline(v: ValueId, c: cpp.Expr): void {
    this.exprs.set(v, c);
  }

  declarePlace(p: number, name: string): void {
    this.places.set(p, cpp.id(name));
  }

  /** A `#line` when `op` starts another source line. */
  mark(op: IrOp): void {
    const line = `${op.source.file}:${op.source.line}`;

    if (line !== this.line) {
      this.out.push(cpp.lineDirective(op.source.line, sourcePath(op.source.file)));
      this.line = line;
    }
  }

  /** A statement for `op`, after a `#line` when it starts another source line. */
  emit(op: IrOp, stmt: cpp.Stmt): void {
    this.mark(op);
    this.out.push(stmt);
  }

  /**
   * A statement holding nested regions, `build` making it after its `#line`:
   * the next statement names its line again, as the nested ones changed it.
   */
  compound(op: IrOp, build: () => cpp.Stmt[]): void {
    this.mark(op);
    this.out.push(...build());
    this.line = undefined;
  }

  /** `v`'s value, computed by `c` at this point: a named temporary, or nothing when unused. */
  define(op: IrOp, v: ValueId, c: cpp.Expr, effect = false): void {
    if (this.used(v)) {
      const name = `v${v}_`;

      this.emit(op, cpp.varDecl(this.backend.cppType(this.fn.values[v]!.type), name, c));
      this.exprs.set(v, cpp.id(name));
    } else if (effect) {
      this.emit(op, cpp.exprStmt(cpp.cast("c", cpp.voidType, c)));
    }
  }

  /** `v` declared empty here, for later statements to assign (an if's result). */
  declareEmpty(op: IrOp, v: ValueId): void {
    const name = `v${v}_`;

    this.emit(
      op,
      cpp.varDecl(this.backend.cppType(this.typeOf(v)), name, undefined, { style: "brace" }),
    );
    this.exprs.set(v, cpp.id(name));
  }

  /**
   * A jump to `target`: C++'s own `break` or `continue` when it reaches the
   * innermost loop (and `continue` has no `next` region to run), a `goto`
   * to the target's label otherwise.
   */
  jump(kind: "break" | "continue", target: TargetId): cpp.Stmt {
    const at = this.jumps.findLastIndex((j) => j.target === target);
    const jump = this.jumps[at]!;
    const innermost = jump.loop && !this.jumps.slice(at + 1).some((j) => j.loop);

    if (kind === "break" && innermost) return { k: "break" };

    if (kind === "continue" && innermost && !jump.next) return { k: "continue" };

    const label = labelOf(kind, target);

    this.labels.add(label);
    return { k: "goto", label };
  }

  /** The label of `target` when some `goto` names it. */
  label(kind: "break" | "continue", target: TargetId): cpp.Stmt[] {
    const name = labelOf(kind, target);

    return this.labels.has(name) ? [{ k: "label", name }] : [];
  }
}

function labelOf(kind: "break" | "continue", target: TargetId): string {
  return `${kind === "break" ? "brk" : "cont"}${target}_`;
}

type Emit<K extends IrOp["kind"]> = (
  op: IrOp & { kind: K },
  e: Emitter,
  index: number,
  ops: readonly IrOp[],
) => void;

const EMIT: { [K in IrOp["kind"]]: Emit<K> } = {
  const: (op, e) => e.inline(op.result, constant(op.value)),

  param: (op, e) => e.inline(op.result, cpp.id(`p${op.index}_`)),

  unary: (op, e) => {
    const operand = e.value(op.operand);
    const bigint = e.typeOf(op.operand).k === "bigint" ? BIGINT_UNARY[op.op] : undefined;

    e.define(op, op.result, (bigint ?? UNARY[op.op])(operand));
  },

  binary: (op, e) => {
    const [left, right] = [op.left, op.right].map((v) => ({ c: e.value(v), t: e.typeOf(v) }));
    const c = isEqualityOp(op.op)
      ? equality(op.op, left!, right!)
      : left!.t.k === "bigint" || right!.t.k === "bigint"
        ? bigintBinary(op.op, left!.c, right!.c)
        : BINARY[op.op](left!.c, right!.c, left!.t.k === "string");

    e.define(op, op.result, c);
  },

  convert: (op, e) =>
    e.define(op, op.result, converted(e.value(op.input), e.typeOf(op.input), op.to, e.backend)),

  local: (op, e, index, ops) => {
    const name = cppIdent(op.name);
    const next = ops[index + 1];
    const type = e.backend.cppType(op.type);

    e.declarePlace(op.place, name);

    // Declared where it is first stored, as `T x = v;`.
    if (next?.kind === "store" && next.place === op.place) return;

    e.emit(op, cpp.varDecl(type, name, undefined, { style: "brace" }));
  },

  load: (op, e) => e.define(op, op.result, e.place(op.place)),

  store: (op, e, index, ops) => {
    const prev = ops[index - 1];

    if (prev?.kind === "local" && prev.place === op.place) {
      e.emit(op, cpp.varDecl(e.backend.cppType(prev.type), cppIdent(prev.name), e.value(op.value)));
      return;
    }

    e.emit(op, cpp.exprStmt(cpp.assign(e.place(op.place), e.value(op.value))));
  },

  call: (op, e) => {
    const args = op.args.map((a) => e.value(a));
    const c =
      op.callee.kind === "function"
        ? cpp.call(op.callee.id, args)
        : BUILTIN_CALLS[op.callee.name](args, e.backend);

    if (op.result === undefined) e.emit(op, cpp.exprStmt(c));
    else e.define(op, op.result, c, true);
  },

  return: (op, e) => e.emit(op, cpp.ret(op.value === undefined ? undefined : e.value(op.value))),

  throw: (op, e) => e.emit(op, cpp.exprStmt(cpp.call("lucent::throwError", [e.value(op.value)]))),

  if: (op, e) => {
    const result = op.result !== undefined && e.used(op.result) ? op.result : undefined;

    if (result !== undefined) e.declareEmpty(op, result);

    e.compound(op, () => {
      const then = e.branch(op.whenTrue, result);
      const otherwise = e.branch(op.whenFalse, result);

      return [cpp.ifStmt(e.value(op.cond), then, otherwise.length ? otherwise : undefined)];
    });
  },

  loop: (op, e) =>
    e.compound(op, () => {
      const jump = { target: op.target, loop: true, next: op.next !== undefined };
      const body = e.inside(jump, op.body);
      const next = op.next === undefined ? [] : e.inside(jump, op.next);
      const cont = e.label("continue", op.target);
      // A `goto` to the continue label must not jump over the body's declarations.
      const inner =
        op.next === undefined && !cont.length ? body : [cpp.block(body), ...cont, ...next];

      return [{ k: "while", test: cpp.bool(true), body: inner }, ...e.label("break", op.target)];
    }),

  block: (op, e) =>
    e.compound(op, () => {
      const jump =
        op.target === undefined ? undefined : { target: op.target, loop: false, next: false };
      const body = e.inside(jump, op.body);

      return [cpp.block(body), ...(op.target === undefined ? [] : e.label("break", op.target))];
    }),

  break: (op, e) => e.emit(op, e.jump("break", op.target)),

  continue: (op, e) => e.emit(op, e.jump("continue", op.target)),

  yield: (op, e) => {
    const result = e.yielded;

    if (result !== undefined && op.value !== undefined)
      e.emit(op, cpp.exprStmt(cpp.assign(e.value(result), e.value(op.value))));
  },
};

const UNARY: Record<UnaryOp, (x: cpp.Expr) => cpp.Expr> = {
  "-": (x) => cpp.unary("-", x),
  "!": (x) => cpp.not(x),
  "~": (x) => cpp.call("lucent::jsNot", [x]),
  "!!": (x) => cpp.call("lucent::truthy", [x]),
  typeof: (x) => cpp.call("lucent::typeOf", [x]),
  String: (x) => cpp.call("lucent::toJsString", [x]),
};

/** The unary operators whose C++ differs for a bigint: BigInt's own `~`. */
const BIGINT_UNARY: Partial<Record<UnaryOp, (x: cpp.Expr) => cpp.Expr>> = {
  "~": (x) => cpp.unary("~", x),
};

/** `left op right` with a bigint operand: BigInt's operators; comparisons with a number are exact. */
function bigintBinary(op: Exclude<BinaryOp, EqualityOp>, l: cpp.Expr, r: cpp.Expr): cpp.Expr {
  return BIGINT_OPERATORS[op]?.(l, r) ?? cpp.binary(l, op as cpp.BinaryOp, r);
}

type Operand = { c: cpp.Expr; t: LType };

/**
 * `left op right` for an equality operator: `==` between primitives of
 * one kind, a constant between absent values, a presence test for loose
 * equality with an absent value, and the runtime's strictEquals otherwise.
 */
function equality(op: EqualityOp, left: Operand, right: Operand): cpp.Expr {
  const loose = op === "==" || op === "!=";
  const [l, r] = [left.t, right.t];
  const test =
    l.k === r.k && isPrimitive(l)
      ? cpp.binary(left.c, "==", right.c)
      : isAbsent(l) && isAbsent(r)
        ? cpp.bool(loose || l.k === r.k)
        : loose && (isAbsent(l) || isAbsent(r))
          ? cpp.not(cpp.call(cpp.dot((isAbsent(l) ? right : left).c, "has")))
          : cpp.call("lucent::strictEquals", [left.c, right.c]);

  return op === "!==" || op === "!=" ? cpp.not(test) : test;
}

const BINARY: Record<
  Exclude<BinaryOp, EqualityOp>,
  (l: cpp.Expr, r: cpp.Expr, strings: boolean) => cpp.Expr
> = {
  // A string on the left is a lucent::String, so + concatenates.
  "+": (l, r, strings) =>
    strings
      ? cpp.binary(cpp.construct(cpp.type("lucent::String"), [l]), "+", r)
      : cpp.binary(l, "+", r),
  "-": (l, r) => cpp.binary(l, "-", r),
  "*": (l, r) => cpp.binary(l, "*", r),
  "/": (l, r) => cpp.binary(l, "/", r),
  "%": (l, r) => cpp.call("lucent::jsMod", [l, r]),
  "**": (l, r) => cpp.call("lucent::jsPow", [l, r]),
  "&": (l, r) => cpp.call("lucent::jsAnd", [l, r]),
  "|": (l, r) => cpp.call("lucent::jsOr", [l, r]),
  "^": (l, r) => cpp.call("lucent::jsXor", [l, r]),
  "<<": (l, r) => cpp.call("lucent::jsShl", [l, r]),
  ">>": (l, r) => cpp.call("lucent::jsSar", [l, r]),
  ">>>": (l, r) => cpp.call("lucent::jsShr", [l, r]),
  "<": (l, r) => cpp.binary(l, "<", r),
  ">": (l, r) => cpp.binary(l, ">", r),
  "<=": (l, r) => cpp.binary(l, "<=", r),
  ">=": (l, r) => cpp.binary(l, ">=", r),
};

type ApplyStep<K extends ConversionStep["kind"]> = (
  input: cpp.Expr,
  from: LType,
  to: LType,
  step: ConversionStep & { kind: K },
  b: CppBackend,
) => cpp.Expr;

/** Each conversion step as C++, as the legacy emitter's coerce applies it. */
const STEPS: { [K in ConversionStep["kind"]]: ApplyStep<K> } = {
  same: (input) => input,

  undefined: () => cpp.id("lucent::undefined"),

  absent: (_, _from, to, step, b) =>
    cpp.construct(b.cppType(to), [cpp.id(`lucent::${step.value}`)]),

  wrap: (input, from, to, step, b) =>
    cpp.construct(b.cppType(to), [converted(input, from, step.inner, b)]),

  unwrap: (input, _, to, step, b) =>
    converted(cpp.call(cpp.dot(input, "value")), step.inner, to, b),

  member: (input, from, to, step, b) =>
    cpp.construct(b.cppType(to), [converted(input, from, step.member, b)]),

  narrow: (input, _, to, _step, b) => cpp.call("lucent::narrow", [input], [b.cppType(to)]),

  // Members that do not convert get no arm (convertible: at least one does), and holding one throws.
  members: (input, _, to, step, b) =>
    throughMembers(
      input,
      b.cppType(to),
      step.members
        .filter((m) => convertible(m, to))
        .map((m) => ({ type: b.cppType(m), value: converted(heldAs(b.cppType(m)), m, to, b) })),
    ),

  reshape: (input, _, to, _step, b) => cpp.call("lucent::convert", [input], [b.cppType(to)]),
};

/** `input`, a `from`, as a `to` (the verifier proved the conversion exists). */
function converted(input: cpp.Expr, from: LType, to: LType, b: CppBackend): cpp.Expr {
  const step = conversionStep(from, to, EXACT)!;

  return (STEPS[step.kind] as ApplyStep<typeof step.kind>)(input, from, to, step, b);
}

/** Errors record where they were created (`lucent::withSite`), as the legacy emitter's do. */
const BUILTIN_CALLS: Record<BuiltinName, (args: cpp.Expr[], b: CppBackend) => cpp.Expr> = {
  "new Error": (args, b) => newError("Error", args, b),
  "new TypeError": (args, b) => newError("TypeError", args, b),
  "new RangeError": (args, b) => newError("RangeError", args, b),
};

function newError(kind: string, args: cpp.Expr[], b: CppBackend): cpp.Expr {
  const error = cpp.call("lucent::makeError", [stringExpr(kind), ...args]);

  return cpp.call("lucent::withSite", [
    error,
    cpp.id("__FILE__"),
    cpp.id("__LINE__"),
    cpp.str(b.site),
  ]);
}

function constant(value: Constant): cpp.Expr {
  if (value === null) return cpp.id("lucent::null");

  if (value === undefined) return cpp.id("lucent::undefined");

  if (typeof value === "number") return numberExpr(value);

  if (typeof value === "bigint") return bigintExpr(value);

  return typeof value === "string" ? stringExpr(value) : cpp.bool(value);
}
