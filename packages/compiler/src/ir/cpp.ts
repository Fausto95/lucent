/**
 * IR → the C++ syntax tree. Each operation that does something becomes its
 * own statement, in the IR's order: a call's arguments are always named
 * values or literals, so C++'s unspecified argument order never decides
 * what runs first. Constants are inlined; a result nothing uses is dropped
 * (or, for a call, discarded with `(void)`).
 */
import { cpp } from "@lucent-lang/codegen";
import { Codes, CompileError } from "../diagnostics.ts";
import { type ConversionStep, conversionStep } from "../lowering/conversions.ts";
import { heldAs, throughMembers } from "../lowering/members.ts";
import { BIGINT_OPERATORS } from "../lowering/bigint.ts";
import { bigintExpr, numberExpr, stringExpr } from "../lowering/literals.ts";
import { sourcePath } from "../lowering/source.ts";
import { cppIdent, isVoidish, type LType, T } from "../types.ts";
import {
  type BinaryOp,
  type BuiltinName,
  type Constant,
  convertible,
  type EqualityOp,
  EXACT,
  type IntKind,
  type IrFunction,
  type IrOp,
  isAbsent,
  isEqualityOp,
  isPrimitive,
  completes,
  operandsOf,
  regionsOf,
  resultOf,
  type RegionId,
  runsThrough,
  type TargetId,
  type UnaryOp,
  type ValueId,
} from "./ir.ts";
import {
  IrUnsupported,
  lower,
  type Lowered,
  type LowerHost,
  type LowerInput,
  lowerInit,
  type Initialization,
} from "./lower.ts";
import { verify, type VerifyEnv } from "./verify.ts";

/**
 * A function lowered through the IR, verified and turned into C++. What
 * the IR does not support is a LUCENT diagnostic at the code, never
 * invalid C++, nor a JavaScript fallback at runtime.
 */
export function lowerToCpp(
  input: LowerInput | Initialization,
  host: LowerHost,
  backend: CppBackend,
): CppFunction {
  let lowered: Lowered;

  try {
    lowered = "initializers" in input ? lowerInit(input, host) : lower(input, host);
  } catch (e) {
    if (e instanceof IrUnsupported)
      throw new CompileError(
        e.node,
        Codes.UnsupportedSyntax,
        `Lucent does not compile ${e.what} yet`,
      );

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
  /** Statements the function's body starts with (a method coroutine's `self`). */
  prologue?: cpp.Stmt[];
}

export interface CppFunction {
  params: cpp.Param[];
  ret: cpp.Type;
  body: cpp.Stmt[];
  /** The ambients (`LowerInput.ambient`) its code reads, by name: the caller declares them. */
  ambient: string[];
}

/** The C++ of a function, after verifying it: nothing is generated from invalid IR. */
export function toCpp(fn: IrFunction, backend: CppBackend, env: VerifyEnv = {}): CppFunction {
  verify(fn, env);

  const emitter = new Emitter(fn, backend);
  const params = fn.params.map((v, i) => cpp.param(backend.cppType(fn.values[v]!.type), `p${i}_`));

  return {
    params,
    ret: returnType(fn, backend),
    body: emitter.body(),
    ambient: fn.captures.map((c) => c.name),
  };
}

/** What a function's C++ returns: its result, a promise of it, or a generator's iterator. */
function returnType(fn: IrFunction, b: CppBackend): cpp.Type {
  if (fn.async) return cpp.type("lucent::Promise", b.cppRetType(fn.result));

  if (fn.generator) return b.cppType({ k: "iter", e: fn.generator });

  return b.cppRetType(fn.result);
}

/** A loop or labeled block around the statement being emitted. */
interface Jump {
  target: TargetId;
  loop: boolean;
  /** A loop with a `next` region, which `continue` must run. */
  next: boolean;
  /** How many finally frames were around it: a jump from inside more runs theirs first. */
  frames?: number;
}

/**
 * A `try` with a `finally` around the statement being emitted. A jump past
 * it (a return, a break or continue to a target outside) stores its code
 * and goes to the finally; after the finally, its code picks what the jump
 * then does (which may go through the next frame's finally in turn).
 */
interface Frame {
  /** The completion code, the pending exception and the label of the finally. */
  code: string;
  pending: string;
  label: string;
  routes: { key: string; code: number; after: () => cpp.Stmt[] }[];
}

class Emitter {
  readonly backend: CppBackend;
  private out: cpp.Stmt[] = [];
  private readonly fn: IrFunction;
  private readonly exprs = new Map<ValueId, cpp.Expr>();
  /** The integer register forms of exact integers, which their double forms convert. */
  private readonly ints = new Map<ValueId, cpp.Expr>();
  /** The places held in integer registers. */
  private readonly placeInts = new Map<number, IntKind>();
  private readonly places = new Map<number, cpp.Expr>();
  /** The box variable of each boxed place (its place reads `*box`). */
  private readonly boxes = new Map<number, cpp.Expr>();
  private readonly uses = new Map<ValueId, number>();
  /** The loops and labeled blocks around the statement being emitted, innermost last. */
  private readonly jumps: Jump[] = [];
  /** The labels some `goto` names. */
  private readonly labels = new Set<string>();
  /** The result the `yield`s of the branch being emitted assign. */
  private yieldTo?: ValueId;
  /** The finally frames around the statement being emitted, innermost last. */
  private readonly frames: Frame[] = [];
  /** The pending exception of each finally region being emitted, innermost last. */
  private readonly finallies: string[] = [];
  /** Declarations the body starts with (where a return through a finally keeps its value). */
  private readonly prologue: cpp.Stmt[] = [];
  private returned?: string;
  private framesMade = 0;
  /** An async function's or a generator's body: a C++ coroutine. */
  private readonly coroutine: boolean;
  /** Whether the body emitted so far suspends or returns as a coroutine (co_await, co_yield, co_return). */
  private suspended = false;
  private line?: string;

  /** Whether this is the function's own body, not a closure's. */
  private readonly top: boolean;

  constructor(fn: IrFunction, backend: CppBackend, top = true) {
    this.fn = fn;
    this.backend = backend;
    this.top = top;
    this.coroutine = fn.async || fn.generator !== undefined;

    for (const p of fn.modulePlaces) this.places.set(p.place, cpp.id(p.symbol));

    // A lambda's captures, by the names its capture list gives them.
    for (const c of fn.captures) this.declarePlace(c.place, c.spelled ?? cppIdent(c.name), c.boxed);

    this.countUses();
    this.spellings();
  }

  /** Loads spelled as their variable, and values spelled where their one use is (see `spellings`). */
  private readonly aliases = new Set<ValueId>();
  private readonly inlined = new Set<ValueId>();
  /** The operation defining each value. */
  private readonly definitions = new Map<ValueId, IrOp>();

  /**
   * Which values need no variable of their own. A load of a local nothing
   * else writes (not boxed, not the module's) before the value's last use
   * is the variable itself: reading a string does not copy it. And a
   * value used once, by the operation right after the one defining it, is
   * spelled there: nothing runs between them, so the order stays the
   * IR's. A plan's code may have a C++ type of its own, so its value is
   * spelled in place only where a declaration or an assignment converts it.
   */
  private spellings(): void {
    const plain = new Set<number>();

    for (const r of this.fn.regions)
      for (const op of r.ops) if (op.kind === "local" && !op.boxed) plain.add(op.place);

    for (const c of this.fn.captures) if (!c.boxed) plain.add(c.place);

    for (const r of this.fn.regions)
      for (const op of r.ops) {
        const result = resultOf(op);

        if (result !== undefined) this.definitions.set(result, op);
      }

    for (const r of this.fn.regions)
      r.ops.forEach((op, i) => {
        const result = resultOf(op);

        if (result === undefined || !this.used(result)) return;

        if (op.kind === "load" && plain.has(op.place) && this.unwritten(r.ops, i, op.place, result))
          this.aliases.add(result);
        else if (this.inPlace(op, nextUse(r.ops, i), result)) this.inlined.add(result);
      });
  }

  /** Whether nothing in `ops` after `at` stores into `place` before the last use of `v`. */
  private unwritten(ops: readonly IrOp[], at: number, place: number, v: ValueId): boolean {
    const uses = (op: IrOp) => deep(this.fn, op).some((o) => operandsOf(o).includes(v));
    const stores = (op: IrOp) =>
      deep(this.fn, op).some((o) => o.kind === "store" && o.place === place);
    const last = ops.findLastIndex((op, j) => j > at && uses(op));

    if (last < 0) return false;

    // The last use may itself be the store: it reads the value before writing it.
    for (let j = at + 1; j <= last; j++) {
      const op = ops[j]!;

      if (stores(op) && !(j === last && op.kind === "store" && op.place === place)) return false;
    }
    return true;
  }

  /** Whether `v`, defined by `op`, can be spelled in `next`, its one use. */
  private inPlace(op: IrOp, next: IrOp | undefined, v: ValueId): boolean {
    if (!next || this.uses.get(v) !== 1 || !operandsOf(next).includes(v)) return false;

    const assigns = next.kind === "store" || next.kind === "return" || next.kind === "yield";
    // Operations whose C++ spells each operand, once (a plan's code may not, nor may it run it).
    const spells = assigns || ["call", "unary", "binary", "convert", "throw"].includes(next.kind);

    // A call (or a plan, whose C++ type an assignment converts) only where it is assigned: each
    // call stays a statement of its own, never a C++ argument of another.
    if (op.kind === "call" || op.kind === "plan") return assigns;

    return spells && ["unary", "binary", "convert"].includes(op.kind);
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

  /**
   * The statements of the function's body, after its prologue. A
   * coroutine's ends with `co_return` when it can get there, and has one in
   * any case: one that only throws must still reject its promise, or throw
   * at its generator's first next(), rather than at its call.
   */
  body(): cpp.Stmt[] {
    const body = this.region(this.fn.body);
    const end = this.coroutine && completes(this.fn, this.fn.body) ? [cpp.coReturn()] : [];
    const result = this.fn.result;
    const none = isVoidish(result)
      ? undefined
      : converted(cpp.id("lucent::undefined"), T.never, result, this.backend);
    const still = this.coroutine && !this.suspended && !end.length ? [cpp.coReturn(none)] : [];

    const first = this.top ? (this.backend.prologue ?? []) : [];

    return [...first, ...this.prologue, ...body, ...end, ...still];
  }

  /** The body suspends or returns as a coroutine here. */
  suspending(): void {
    this.suspended = true;
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
    if (jump) this.jumps.push({ ...jump, frames: this.frames.length });

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

  /**
   * Of `store p = v` where `v` is `p + x` on strings, spelled in place, its
   * left side the variable itself: `x`, which the store appends.
   */
  appended(op: IrOp & { kind: "store" }): ValueId | undefined {
    const def = this.definitions.get(op.value);

    if (def?.kind !== "binary" || def.op !== "+" || this.typeOf(def.result).k !== "string")
      return undefined;

    const left = this.definitions.get(def.left);
    const same = left?.kind === "load" && left.place === op.place && this.aliases.has(def.left);

    return same && this.inlined.has(def.result) ? def.right : undefined;
  }

  /** Whether the load `v` is spelled as its variable. */
  aliased(v: ValueId): boolean {
    return this.aliases.has(v);
  }

  /** The integer kind of the exact integer `v`, if it is one. */
  intKind(v: ValueId): IntKind | undefined {
    return this.fn.values[v]?.int;
  }

  /** The kind of integer register the place `p` is, if it is one. */
  placeInt(p: number): IntKind | undefined {
    return this.placeInts.get(p);
  }

  /** The integer register form of `v`, an exact integer. */
  intValue(v: ValueId): cpp.Expr {
    const int = this.ints.get(v);

    if (!int) throw new Error(`IR value v${v} has no integer register form`);

    return int;
  }

  /** `v`'s integer register form is `c`: its double form converts it. */
  inlineInt(v: ValueId, c: cpp.Expr): void {
    this.ints.set(v, c);

    if (!this.exprs.has(v)) this.exprs.set(v, cpp.staticCast(cpp.type("double"), c));
  }

  /**
   * `v`, an exact integer, computed by `c` in its integer register: a
   * variable of that type (none when it is unused, or spelled in place),
   * which its double form converts.
   */
  defineInt(op: IrOp, v: ValueId, c: cpp.Expr): void {
    const kind = this.intKind(v)!;

    if (this.inlined.has(v)) {
      this.inlineInt(v, c);
      return;
    }

    if (!this.used(v)) {
      if (op.kind === "plan") this.emit(op, cpp.exprStmt(cpp.cast("c", cpp.voidType, c)));
      return;
    }

    const name = `v${v}_`;

    this.emit(op, cpp.varDecl(cpp.type(INT_CPP[kind]), name, c));
    this.inlineInt(v, cpp.id(name));
  }

  /** ToInt32 of `v`, as an int32_t: its register, converted when another kind, or the double's. */
  i32(v: ValueId): cpp.Expr {
    const kind = this.intKind(v);

    if (!kind) return cpp.call("lucent::toInt32", [this.value(v)]);

    return kind === "i32"
      ? this.intValue(v)
      : cpp.staticCast(cpp.type("int32_t"), this.intValue(v));
  }

  /** ToUint32 of `v`, as a uint32_t. */
  u32(v: ValueId): cpp.Expr {
    const kind = this.intKind(v);

    if (!kind) return cpp.call("lucent::toUint32", [this.value(v)]);

    return kind === "u32"
      ? this.intValue(v)
      : cpp.staticCast(cpp.type("uint32_t"), this.intValue(v));
  }

  /** `left op right` for an int32 operator, on integer registers: shift counts taken modulo 32. */
  bitwise(op: BinaryOp, left: ValueId, right: ValueId): cpp.Expr {
    const count = () => cpp.binary(this.u32(right), "&", cpp.num("31u"));

    if (op === "<<")
      return cpp.staticCast(cpp.type("int32_t"), cpp.binary(this.u32(left), "<<", count()));

    if (op === ">>") return cpp.binary(this.i32(left), ">>", count());

    if (op === ">>>") return cpp.binary(this.u32(left), ">>", count());

    return cpp.binary(this.i32(left), op as cpp.BinaryOp, this.i32(right));
  }

  /**
   * `v` as the integer register `kind` a store writes (the analysis proved
   * it an exact integer of that kind): its own register converted, or the
   * double's; a sum or difference of integers, for an int64 (a loop
   * counter's step), computed in int64.
   */
  stored(v: ValueId, kind: IntKind): cpp.Expr {
    const type = cpp.type(INT_CPP[kind]);
    const own = this.intKind(v);

    if (own) return own === kind ? this.intValue(v) : cpp.staticCast(type, this.intValue(v));

    const def = this.definitions.get(v);

    if (
      kind === "i64" &&
      def?.kind === "binary" &&
      (def.op === "+" || def.op === "-") &&
      this.inlined.has(v) &&
      this.intKind(def.left) &&
      this.intKind(def.right)
    ) {
      const [l, r] = [def.left, def.right].map((x) => cpp.staticCast(type, this.intValue(x)));

      return cpp.binary(l!, def.op, r!);
    }

    if (kind === "i32") return cpp.call("lucent::toInt32", [this.value(v)]);

    if (kind === "u32") return cpp.call("lucent::toUint32", [this.value(v)]);

    return cpp.staticCast(type, this.value(v));
  }

  /** `v` is spelled `c` wherever it is used (a literal or a parameter). */
  inline(v: ValueId, c: cpp.Expr): void {
    this.exprs.set(v, c);
  }

  declarePlace(p: number, name: string, boxed = false, int?: IntKind): void {
    this.places.set(p, boxed ? cpp.deref(cpp.id(name)) : cpp.id(name));

    if (int) this.placeInts.set(p, int);

    if (boxed) this.boxes.set(p, cpp.id(name));
  }

  /** The box variable of the boxed place `p`. */
  box(p: number): cpp.Expr {
    return this.boxes.get(p)!;
  }

  /** A `#line` when `op` starts another source line. */
  mark(op: IrOp): void {
    const line = `${op.source.file}:${op.source.line}`;

    if (line !== this.line) {
      this.out.push(cpp.lineDirective(op.source.line, sourcePath(op.source.file)));
      this.line = line;
    }
  }

  /** Statements nested in the last one named other lines: the next names its line again. */
  lineChanged(): void {
    this.line = undefined;
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
    // Spelled where its one use is.
    if (this.inlined.has(v)) {
      this.exprs.set(v, c);
      return;
    }

    if (this.used(v)) {
      const name = `v${v}_`;

      this.emit(op, cpp.varDecl(this.backend.cppType(this.fn.values[v]!.type), name, c));
      this.exprs.set(v, cpp.id(name));
    } else if (effect) {
      this.emit(op, cpp.exprStmt(cpp.cast("c", cpp.voidType, c)));
    }
  }

  /** `v`, given the value of `c`, as a statement declaring it (none when it is unused). */
  bind(v: ValueId, c: cpp.Expr): cpp.Stmt[] {
    if (!this.used(v)) return [];

    const name = `v${v}_`;

    this.exprs.set(v, cpp.id(name));
    return [cpp.varDecl(this.backend.cppType(this.typeOf(v)), name, c)];
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

    // Past a finally: it runs first.
    if (this.frames.length > (jump.frames ?? 0))
      return this.route(`${kind} t${target}`, () => [this.jump(kind, target)]);

    if (kind === "break" && innermost) return { k: "break" };

    if (kind === "continue" && innermost && !jump.next) return { k: "continue" };

    const label = labelOf(kind, target);

    this.labels.add(label);
    return { k: "goto", label };
  }

  /** `return value`; past a finally, the value is kept and the finally runs first. */
  ret(value: cpp.Expr | undefined): cpp.Stmt {
    if (!this.frames.length) {
      if (!this.coroutine) return cpp.ret(value);

      this.suspending();
      return cpp.coReturn(value);
    }

    const kept = value === undefined ? undefined : cpp.id(this.returnVariable());
    const keep = kept ? [cpp.exprStmt(cpp.assign(kept, value!))] : [];

    return cpp.block([...keep, this.route("return", () => [this.ret(kept)])]);
  }

  /** Where a return through a finally keeps its value, declared at the start of the body. */
  private returnVariable(): string {
    if (!this.returned) {
      this.returned = "ret_";
      this.prologue.push(
        cpp.varDecl(this.backend.cppType(this.fn.result), this.returned, undefined, {
          style: "brace",
        }),
      );
    }
    return this.returned;
  }

  /** A jump past the innermost finally: its code, and the finally; `after` is what it does then. */
  private route(key: string, after: () => cpp.Stmt[]): cpp.Stmt {
    const frame = this.frames[this.frames.length - 1]!;
    let route = frame.routes.find((r) => r.key === key);

    if (!route) {
      route = { key, code: frame.routes.length + 1, after };
      frame.routes.push(route);
    }

    return cpp.block([
      cpp.exprStmt(cpp.assign(cpp.id(frame.code), cpp.num(route.code))),
      { k: "goto", label: frame.label },
    ]);
  }

  /**
   * `guarded`, then the finally `final` however `guarded` is left: an
   * exception is kept and thrown again after it, and each jump past it
   * continues after it, by its code.
   */
  withFinally(guarded: () => cpp.Stmt[], final: () => cpp.Stmt[]): cpp.Stmt[] {
    const n = this.framesMade++;
    const frame: Frame = { code: `fc${n}_`, pending: `fc${n}_ex`, label: `fin${n}_`, routes: [] };
    const pending = cpp.id(frame.pending);

    this.frames.push(frame);

    let body: cpp.Stmt[];

    try {
      body = guarded();
    } finally {
      this.frames.pop();
    }

    this.finallies.push(frame.pending);

    let after: cpp.Stmt[];

    try {
      after = final();
    } finally {
      this.finallies.pop();
    }

    return [
      cpp.varDecl(cpp.type("int"), frame.code, cpp.num(0)),
      cpp.varDecl(cpp.type("std::exception_ptr"), frame.pending),
      {
        k: "try",
        body,
        catches: [
          { body: [cpp.exprStmt(cpp.assign(pending, cpp.call("std::current_exception")))] },
        ],
      },
      { k: "label", name: frame.label },
      cpp.block(after),
      cpp.ifStmt(pending, [cpp.exprStmt(cpp.call("std::rethrow_exception", [pending]))]),
      ...frame.routes.map((r) =>
        cpp.ifStmt(cpp.binary(cpp.id(frame.code), "==", cpp.num(r.code)), r.after()),
      ),
    ];
  }

  /** Whether running `op` can reach what follows it. */
  completes(op: IrOp): boolean {
    return runsThrough(this.fn, [op]);
  }

  /** The exception pending in the innermost finally region being emitted. */
  pendingException(): cpp.Expr {
    return cpp.id(this.finallies[this.finallies.length - 1]!);
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
  const: (op, e) => {
    e.inline(op.result, constant(op.value));

    const int = e.intKind(op.result);

    // An exact integer's register form: the literal itself (`7`, `4294967295u`).
    if (int)
      e.inlineInt(op.result, cpp.num(int === "u32" ? `${String(op.value)}u` : String(op.value)));
  },

  param: (op, e) => e.inline(op.result, cpp.id(`p${op.index}_`)),

  unary: (op, e) => {
    if (e.intKind(op.result)) {
      e.defineInt(op, op.result, cpp.unary("~", e.i32(op.operand)));
      return;
    }

    const operand = e.value(op.operand);
    const bigint = e.typeOf(op.operand).k === "bigint" ? BIGINT_UNARY[op.op] : undefined;

    e.define(op, op.result, (bigint ?? UNARY[op.op])(operand));
  },

  binary: (op, e) => {
    // The int32 operators, on integer registers.
    if (e.intKind(op.result)) {
      e.defineInt(op, op.result, e.bitwise(op.op, op.left, op.right));
      return;
    }

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
    const type = op.int ? cpp.type(INT_CPP[op.int]) : boxOf(e.backend.cppType(op.type), op.boxed);

    e.declarePlace(op.place, name, op.boxed, op.int);

    // Declared where it is first stored, as `T x = v;` (or `lucent::Box<T> x(v);`).
    if (next?.kind === "store" && next.place === op.place) return;

    e.emit(op, cpp.varDecl(type, name, undefined, { style: "brace" }));
  },

  load: (op, e) => {
    const int = e.placeInt(op.place);

    if (int && e.aliased(op.result)) e.inlineInt(op.result, e.place(op.place));
    else if (int) e.defineInt(op, op.result, e.place(op.place));
    else if (e.aliased(op.result)) e.inline(op.result, e.place(op.place));
    else e.define(op, op.result, e.place(op.place));
  },

  store: (op, e, index, ops) => {
    const prev = ops[index - 1];

    const int = e.placeInt(op.place);

    if (prev?.kind === "local" && prev.place === op.place) {
      const type = int ? cpp.type(INT_CPP[int]) : boxOf(e.backend.cppType(prev.type), prev.boxed);
      const style = prev.boxed ? { style: "construct" as const } : {};
      const value = int ? e.stored(op.value, int) : e.value(op.value);

      e.emit(op, cpp.varDecl(type, cppIdent(prev.name), value, style));
      return;
    }

    if (int) {
      e.emit(op, cpp.exprStmt(cpp.assign(e.place(op.place), e.stored(op.value, int))));
      return;
    }

    // `s = s + x` on a string appends to it in place: copying it whole each time is quadratic.
    const appended = e.appended(op);

    if (appended !== undefined) {
      e.emit(op, cpp.exprStmt(cpp.assign(e.place(op.place), e.value(appended), "+=")));
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

  plan: (op, e) => {
    // Its integer register form, when its code has one: the value, held as that.
    if (op.int && op.result !== undefined) {
      const int = withOperands(
        op.int.code as cpp.Expr,
        (v) => e.value(v),
        (v) => e.intValue(v),
      );

      e.defineInt(op, op.result, int);
      return;
    }

    const c = withOperands(
      op.code as cpp.Expr,
      (v) => e.value(v),
      (v) => e.intValue(v),
    );

    // What gives nothing may still be a value in C++ (`(void)x, lucent::undefined`): discarded.
    const statement = c.k === "call" || c.k === "assign" ? c : cpp.cast("c", cpp.voidType, c);

    if (op.result === undefined) e.emit(op, cpp.exprStmt(statement));
    else e.define(op, op.result, c, true);
  },

  // A C++ lambda: its captures are copies of values, or copies of boxes, which share the variable.
  closure: (op, e) => {
    const fn = op.fn;
    const inner = new Emitter(fn, { ...e.backend, site: fn.site ?? e.backend.site }, false);
    const params = fn.params.map((v, i) =>
      cpp.param(e.backend.cppType(fn.values[v]!.type), `p${i}_`),
    );
    const captures = fn.captures.map((c, i) => {
      const from = op.from[i]!;

      return {
        name: c.spelled ?? cppIdent(c.name),
        init: "value" in from ? e.value(from.value) : e.box(from.box),
      };
    });
    const ret = returnType(fn, e.backend);
    const body = inner.body();
    // A coroutine's frame must not reference the lambda's captures: they are its parameters.
    const coroutine = fn.async || fn.generator !== undefined;
    const names = captures.map((c) => c.name);
    const lambda = coroutine
      ? cpp.lambda(
          captures,
          params,
          [
            cpp.ret(
              cpp.call(
                cpp.lambda([], [...names.map((n) => cpp.param(cpp.auto, n)), ...params], body, {
                  ret,
                }),
                [...names, ...params.map((p) => p.name!)].map((n) => cpp.id(n)),
              ),
            ),
          ],
          { ret },
        )
      : cpp.lambda(captures, params, body, { ret, mutable: true });
    const made =
      op.enters === undefined
        ? lambda
        : cpp.call("lucent::ui::inContent", [e.value(op.enters), lambda]);

    e.define(op, op.result, cpp.construct(e.backend.cppType(e.typeOf(op.result)), [made]));

    // The lambda's statements named lines of their own.
    e.lineChanged();
  },

  unreachable: (op, e) => e.emit(op, cpp.exprStmt(cpp.call("lucent::unreachable"))),

  await: (op, e) => {
    const awaited = cpp.coAwait(e.value(op.promise));

    e.suspending();

    if (op.result === undefined) e.emit(op, cpp.exprStmt(awaited));
    else e.define(op, op.result, awaited, true);
  },

  produce: (op, e) => {
    e.suspending();
    e.emit(op, { k: "coYield", value: e.value(op.value) });
  },

  // No code using it runs: it is spelled as the constant its C++ type holds.
  never: (op, e) => e.inline(op.result, cpp.id("lucent::undefined")),

  return: (op, e) => e.emit(op, e.ret(op.value === undefined ? undefined : e.value(op.value))),

  // The catch gets the exception as an Error; iterator.return() unwinds a generator through
  // finally blocks only, so it passes catches.
  try: (op, e) =>
    e.compound(op, () => {
      const guarded = (): cpp.Stmt[] => {
        const body = e.region(op.body);

        if (!op.catch) return [cpp.block(body)];

        const ex = `ex${op.catch.error}_`;
        const error = e.bind(op.catch.error, cpp.call("lucent::currentError", [cpp.id(ex)]));
        const handler = e.region(op.catch.region);

        return [
          cpp.varDecl(cpp.type("std::exception_ptr"), ex),
          {
            k: "try",
            body,
            catches: [
              {
                param: cpp.param(cpp.reference(cpp.constType(cpp.type("lucent::GeneratorReturn")))),
                body: [{ k: "throw" }],
              },
              {
                body: [cpp.exprStmt(cpp.assign(cpp.id(ex), cpp.call("std::current_exception")))],
              },
            ],
          },
          cpp.ifStmt(cpp.id(ex), [...error, ...handler]),
        ];
      };
      const final = op.finally;
      const stmts =
        final === undefined
          ? [cpp.block(guarded())]
          : [cpp.block(e.withFinally(guarded, () => e.region(final)))];

      // C++ cannot see that a try whose every way out leaves does not complete.
      return e.completes(op) ? stmts : [...stmts, cpp.exprStmt(cpp.call("lucent::unreachable"))];
    }),

  // Disposing that throws while an exception is pending replaces it with a SuppressedError.
  dispose: (op, e) => {
    const pending = e.pendingException();
    const suppressed = cpp.call("lucent::suppressedError", [
      cpp.call("std::current_exception"),
      pending,
    ]);

    e.emit(op, {
      k: "try",
      body: [cpp.exprStmt(withOperands(op.code as cpp.Expr, (v) => e.value(v)))],
      catches: [
        {
          body: [
            cpp.ifStmt(pending, [cpp.exprStmt(cpp.assign(pending, suppressed))], [{ k: "throw" }]),
          ],
        },
      ],
    });
  },

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

  iterate: (op, e) =>
    e.compound(op, () => {
      const t = e.typeOf(op.iterable);
      const name = `coll${op.target}_`;
      const [coll, idx] = [cpp.id(name), cpp.id(`i${op.target}_`)];
      const jump = { target: op.target, loop: true, next: false };
      // The element, then the body, then where a `continue` that is a `goto` lands.
      const body = (element: cpp.Expr, head: cpp.Stmt[] = []) => {
        const bound = e.bind(op.element, element);
        const inner = e.inside(jump, op.body);

        return [...head, ...bound, cpp.block(inner), ...e.label("continue", op.target)];
      };
      const counted = (size: cpp.Expr, stmts: cpp.Stmt[]): cpp.Stmt => ({
        k: "for",
        init: cpp.varDecl(cpp.type("size_t"), `i${op.target}_`, cpp.num(0)),
        test: cpp.binary(idx, "<", size),
        update: cpp.postfix("++", idx),
        body: stmts,
      });
      const at = (items: cpp.Expr) => cpp.call(cpp.dot(items, "at"), [idx]);
      const size = (items: cpp.Expr) => cpp.call(cpp.dot(items, "size"));
      const loop = ITERATIONS[t.k]!({ name, coll, idx, t, e, body, counted, at, size });

      return [
        cpp.block([cpp.varDecl(cpp.auto, name, e.value(op.iterable)), ...loop]),
        ...e.label("break", op.target),
      ];
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

/** The prefix of the names plan code gives its operands (see `operand`). */
const OPERAND = "$v";

/** How a plan's code names the value `v`, an operand computed before it. */
export function operand(v: ValueId): cpp.Expr {
  return cpp.id(`${OPERAND}${v}`);
}

/** The prefix of the names plan code gives its operands' integer forms. */
const INT_OPERAND = "$i";

/** How a plan's code names the integer register form of `v`, an exact integer operand. */
export function intOperand(v: ValueId): cpp.Expr {
  return cpp.id(`${INT_OPERAND}${v}`);
}

/** Plan code, with each operand it names replaced by that value's C++ (or its integer form's). */
function withOperands(
  code: cpp.Expr,
  value: (v: ValueId) => cpp.Expr,
  int: (v: ValueId) => cpp.Expr = value,
): cpp.Expr {
  const replace = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(replace);

    if (typeof node !== "object" || node === null) return node;

    const n = node as { k?: string; name?: unknown };

    if (n.k === "id" && typeof n.name === "string" && n.name.startsWith(INT_OPERAND))
      return int(Number(n.name.slice(INT_OPERAND.length)) as ValueId);

    if (n.k === "id" && typeof n.name === "string" && n.name.startsWith(OPERAND))
      return value(Number(n.name.slice(OPERAND.length)) as ValueId);

    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, replace(v)]));
  };

  return replace(code) as cpp.Expr;
}

/** What iterating a collection takes: its variable, the counter, and how to make the loop. */
interface Iteration {
  /** The collection's variable, which names the loop's others. */
  name: string;
  coll: cpp.Expr;
  idx: cpp.Expr;
  t: LType;
  e: Emitter;
  body(element: cpp.Expr, head?: cpp.Stmt[]): cpp.Stmt[];
  counted(size: cpp.Expr, body: cpp.Stmt[]): cpp.Stmt;
  at(items: cpp.Expr): cpp.Expr;
  size(items: cpp.Expr): cpp.Expr;
}

/** A hash table's slots, live ones only, while it is guarded against changes that move them. */
function tableLoop(it: Iteration, element: (slot: cpp.Expr) => cpp.Expr): cpp.Stmt[] {
  const table = cpp.call(cpp.dot(it.coll, "table"));
  const guard = cpp.nestedType(cpp.type("std::decay_t", cpp.decltype(table)), "Iterating");
  const slot = cpp.call(cpp.dot(table, "slot"), [it.idx]);
  const live = cpp.ifStmt(cpp.not(cpp.call(cpp.dot(table, "slotLive"), [it.idx])), [
    { k: "continue" },
  ]);

  return [
    cpp.varDecl(guard, `${it.name}guard`, table, { style: "construct" }),
    it.counted(cpp.call(cpp.dot(table, "slotCount")), it.body(element(slot), [live])),
  ];
}

/** A map's or a record's `[key, value]` entry of a table slot. */
function entry(it: Iteration, key: cpp.Type, val: LType): (slot: cpp.Expr) => cpp.Expr {
  return (slot) =>
    cpp.construct(cpp.type("std::tuple", key, it.e.backend.cppType(val)), [
      cpp.dot(slot, "key"),
      cpp.dot(slot, "value"),
    ]);
}

/** How `for … of` goes over each kind of collection, as the legacy emitter's loops do. */
const ITERATIONS: Partial<Record<LType["k"], (it: Iteration) => cpp.Stmt[]>> = {
  array: (it) => [it.counted(it.size(it.coll), it.body(it.at(it.coll)))],

  bytes: (it) => [it.counted(it.size(it.coll), it.body(it.at(it.coll)))],

  regexMatch: (it) => {
    const items = cpp.arrow(it.coll, "items");

    return [it.counted(it.size(items), it.body(it.at(items)))];
  },

  // Code points, not UTF-16 units.
  string: (it) => {
    const cps = cpp.id(`${it.name}cps`);

    return [
      cpp.varDecl(cpp.auto, `${it.name}cps`, cpp.call("lucent::splitCodePoints", [it.coll])),
      it.counted(it.size(cps), it.body(it.at(cps))),
    ];
  },

  set: (it) => tableLoop(it, (slot) => cpp.dot(slot, "key")),

  map: (it) => {
    const t = it.t as LType & { k: "map" };

    return tableLoop(it, entry(it, it.e.backend.cppType(t.key), t.val));
  },

  dict: (it) =>
    tableLoop(it, entry(it, cpp.type("lucent::String"), (it.t as LType & { k: "dict" }).val)),

  // Leaving early (break, return, throw) closes the iterator, running a generator's finally
  // blocks; running out does not.
  iter: (it) => {
    const t = it.t as LType & { k: "iter" };
    const [v, close] = [cpp.id(`${it.name}v`), cpp.id(`${it.name}close`)];
    const closer = cpp.type("lucent::IterCloser", it.e.backend.cppType(t.e));
    const head = [
      cpp.varDecl(cpp.auto, `${it.name}v`, cpp.call(cpp.arrow(it.coll, "next"))),
      cpp.ifStmt(cpp.not(v), [cpp.exprStmt(cpp.call(cpp.dot(close, "exhausted"))), { k: "break" }]),
    ];

    return [
      cpp.varDecl(closer, `${it.name}close`, it.coll, { style: "construct" }),
      { k: "for", body: it.body(cpp.call("std::move", [cpp.deref(v)]), head) },
    ];
  },
};

/** `value`, after what evaluating `effect` does (nothing, when it is a name or a literal). */
function after(effect: cpp.Expr, value: cpp.Expr): cpp.Expr {
  const pure = ["id", "number", "string", "bool"].includes(effect.k);

  return pure ? value : cpp.comma(cpp.cast("c", cpp.voidType, effect), value);
}

/** The operation after `ops[at]`, past a local declared where it is first stored (`T x = v;`). */
function nextUse(ops: readonly IrOp[], at: number): IrOp | undefined {
  const next = ops[at + 1];
  const after = ops[at + 2];

  return next?.kind === "local" && after?.kind === "store" && after.place === next.place
    ? after
    : next;
}

/** `op` and the operations in the regions it owns, at any depth. */
function deep(fn: IrFunction, op: IrOp): IrOp[] {
  return [op, ...regionsOf(op).flatMap((r) => fn.regions[r]!.ops.flatMap((o) => deep(fn, o)))];
}

/** The C++ type of each integer register. */
const INT_CPP: Record<IntKind, string> = { i32: "int32_t", u32: "uint32_t", i64: "int64_t" };

/** A place's C++ type: `lucent::Box<T>` when it is boxed. */
function boxOf(type: cpp.Type, boxed: boolean | undefined): cpp.Type {
  return boxed ? cpp.type("lucent::Box", type) : type;
}

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
        ? after(left.c, after(right.c, cpp.bool(loose || l.k === r.k)))
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

  undefined: (input) => after(input, cpp.id("lucent::undefined")),

  absent: (input, _from, to, step, b) =>
    after(input, cpp.construct(b.cppType(to), [cpp.id(`lucent::${step.value}`)])),

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
  // What never completes has no value, and a value to pass as a never (one the checker narrowed
  // away, as in an exhaustive switch) does not exist: a `to` that is never given.
  if ((from.k === "never" || to.k === "never") && to.k !== "void")
    return cpp.call(
      cpp.lambda([], [], [cpp.exprStmt(cpp.call("lucent::unreachable"))], { ret: b.cppType(to) }),
    );

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
