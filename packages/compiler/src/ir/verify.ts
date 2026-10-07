/**
 * Checks an IR function before anything is generated from it. Invalid IR is
 * an internal compiler error (IrVerifyError, with the dump), never C++.
 *
 * 1. Every value is defined once, by an operation earlier in its region or
 *    an enclosing one, before any use; a local is declared the same way.
 *    Each region but the body has exactly one owner (an `if`, `loop` or
 *    `block` in its parent region), and what a region defines is not
 *    visible outside it.
 * 2. Operand and result types agree with each operation: operators take the
 *    operands their table lists, conversions are ones the IR knows, calls
 *    match their callee's signature when it is known, and returns give the
 *    function's result type.
 * 3. `return`, `throw`, `break`, `continue` and `yield` end their region.
 *    A body that can end without leaving belongs to a function giving
 *    nothing. `break` names an enclosing loop or block, `continue` an
 *    enclosing loop (never from its own `next` region), and `yield` ends a
 *    branch of an `if` giving a result, with a value of its type; each such
 *    branch ends by yielding or leaving. Conditions are booleans.
 * 4. Every operation and value has a well-formed span inside the function's.
 * 5. Operands are value ids, never nested expressions, so the order of the
 *    operation list is the evaluation order.
 * 6. An integer register (`int`, which emit/integers.ts proves) holds a
 *    number: a value's is on a number, a local's on a number no closure
 *    shares in a box.
 * 7. Nothing claims less than it does: a call's effect reference is at least
 *    as conservative as what is known of its callee, and the function's
 *    summary admits every exit, read and write its operations (and the
 *    callees whose summaries are known) can make; loads and stores of
 *    constant module variables are not state.
 *    Code generation relies on these claims when it keeps (or one day
 *    changes) the order of operations around an exceptional exit. A plan's
 *    effects are the program analysis's to know: the IR cannot see into
 *    one, so the summary is not checked against it.
 */
import { isVoidish, type LType, sameType, T, typeKey } from "../types.ts";
import { dump } from "./dump.ts";
import {
  binaryResult,
  BUILTINS,
  completes,
  constantType,
  convertible,
  elementOf,
  type EffectSummary,
  type FunctionId,
  type IrFunction,
  type IrOp,
  type IrRegion,
  isBinaryOp,
  isBuiltin,
  isTerminator,
  isUnaryOp,
  operandsOf,
  OWNERS,
  type PlaceId,
  resultOf,
  type Signature,
  regionsOf,
  type RegionId,
  type SourceSpan,
  type TargetId,
  type Throws,
  unaryResult,
  type ValueId,
  throwsRangeError,
} from "./ir.ts";

export class IrVerifyError extends Error {
  readonly fn: FunctionId;
  readonly problems: string[];
  readonly dump: string;

  constructor(fn: IrFunction, problems: string[]) {
    const listing = safeDump(fn);
    super(
      `internal compiler error: invalid IR for ${fn.id}\n  ${problems.join("\n  ")}\n${listing}`,
    );
    this.name = "IrVerifyError";
    this.fn = fn.id;
    this.problems = problems;
    this.dump = listing;
  }
}

/** What the verifier may know about the functions a body calls. */
export interface VerifyEnv {
  signature?(id: FunctionId): Signature | undefined;
  /** A callee's effect summary, when the program's analysis knows it. */
  effects?(id: FunctionId): EffectSummary | undefined;
  /** Whether a class type derives from Error (what `throw` may throw); without it, any class may. */
  isError?(t: LType): boolean;
}

/** Throws IrVerifyError listing every invariant `fn` breaks. */
export function verify(fn: IrFunction, env: VerifyEnv = {}): void {
  const problems = new Checker(fn, env).run();

  if (problems.length) throw new IrVerifyError(fn, problems);
}

const THROWS: readonly Throws[] = ["no", "yes", "unknown"];

/** How conservative a claim is: a claim may only be at least as conservative as the truth. */
const RANK: Record<Throws, number> = { no: 0, unknown: 1, yes: 1 };

/** The same for module state: touching none, the module's, or unknown state. */
const STATE: Record<EffectSummary["reads"], number> = { none: 0, module: 1, unknown: 2 };

/** A loop or block around the operations being checked. */
interface Enclosing {
  target: TargetId;
  loop: boolean;
  /** Inside the loop's `next` region. */
  next: boolean;
}

class Checker {
  private readonly problems: string[] = [];
  /** Every value defined so far, anywhere. */
  private readonly defined = new Set<ValueId>();
  /** The values the operation being checked can use. */
  private visible = new Set<ValueId>();
  /** The parameter indexes a param operation defines. */
  readonly params = new Set<number>();
  /** Every place declared so far, anywhere. */
  private readonly declared = new Set<PlaceId>();
  /** The places the operation being checked can use. */
  private places = new Map<PlaceId, { type: LType; mutable: boolean; boxed?: boolean }>();
  /** The loops and blocks around the operation being checked, innermost last. */
  private readonly enclosing: Enclosing[] = [];
  /** The result type the region being checked yields, when it is a branch of an if giving one. */
  private yields?: LType;
  /** Whether the region being checked is (inside) a finally region. */
  inFinally = false;
  private readonly fn: IrFunction;
  private readonly env: VerifyEnv;

  constructor(fn: IrFunction, env: VerifyEnv) {
    this.fn = fn;
    this.env = env;
  }

  run(): string[] {
    this.tables();

    const body = this.fn.regions[this.fn.body];

    if (!body) {
      this.problem(`the body region r${this.fn.body} does not exist`);
      return this.problems;
    }

    this.region(body);

    if (!isVoidish(this.fn.result) && completes(this.fn, body.id))
      this.problem(`the body can end without giving a ${typeKey(this.fn.result)}`);

    for (const v of this.fn.values)
      if (!this.defined.has(v.id)) this.problem(`v${v.id} is never defined`);

    this.fn.params.forEach((v, i) => {
      if (!this.params.has(i)) this.problem(`parameter ${i} (v${v}) has no param operation`);
    });

    this.summary();
    return this.problems;
  }

  private problem(text: string): void {
    this.problems.push(text);
  }

  problemAt(where: string, text: string): void {
    this.problems.push(`${where} ${text}`);
  }

  paramAt(index: number): ValueId | undefined {
    return this.fn.params[index];
  }

  /** The value, place, region and target tables, and the spans of values. */
  private tables(): void {
    const fn = this.fn;

    this.spanInside(fn.source, "the function", true);

    fn.values.forEach((v, i) => {
      if (v.id !== i) this.problem(`the value at index ${i} has id v${v.id}`);

      if (v.type.k === "void") this.problem(`v${i} has type void, which has no values`);

      if (v.int && v.type.k !== "number")
        this.problem(`v${i} is held in an ${v.int} register, but is a ${typeKey(v.type)}`);

      if (v.owner !== undefined && !OWNERS.includes(v.owner))
        this.problem(`v${i} has an unknown owner ${JSON.stringify(v.owner)}`);

      this.spanInside(v.source, `v${i}`);
    });

    fn.regions.forEach((r, i) => {
      if (r.id !== i) this.problem(`the region at index ${i} has id r${r.id}`);

      if (r.id === fn.body && r.parent !== undefined)
        this.problem(`the body region r${r.id} has a parent`);
    });

    this.owners();

    for (const p of fn.modulePlaces) {
      if (this.declared.has(p.place)) this.problem(`p${p.place} is declared twice`);

      this.declared.add(p.place);
      this.places.set(p.place, { type: p.type, mutable: p.mutable });
    }

    // A capture holds a copy, which is never written, or shares a box, which is.
    for (const c of fn.captures) {
      if (this.declared.has(c.place)) this.problem(`p${c.place} is declared twice`);

      this.declared.add(c.place);
      this.places.set(c.place, { type: c.type, mutable: c.boxed, boxed: c.boxed });
    }
  }

  /** Each region but the body is owned once, by an operation of its parent; each target defined once. */
  private owners(): void {
    const fn = this.fn;
    const owned = new Set<RegionId>();
    const targets = new Set<TargetId>();

    for (const r of fn.regions)
      r.ops.forEach((op, i) => {
        const where = `r${r.id}[${i}] ${op.kind}`;

        if (
          (op.kind === "loop" || op.kind === "block" || op.kind === "iterate") &&
          op.target !== undefined
        ) {
          if (targets.has(op.target)) this.problem(`${where} defines t${op.target} again`);

          targets.add(op.target);
        }

        for (const id of regionsOf(op)) {
          const region = fn.regions[id];

          if (!region) this.problem(`${where} owns r${id}, which does not exist`);
          else if (id === fn.body) this.problem(`${where} owns the body region`);
          else if (owned.has(id)) this.problem(`r${id} is owned by two operations`);
          else if (region.parent !== r.id)
            this.problem(`r${id} has parent r${String(region.parent)}, but ${where} owns it`);

          owned.add(id);
        }
      });

    for (const r of fn.regions)
      if (r.id !== fn.body && !owned.has(r.id))
        this.problem(`r${r.id} is not owned by any operation`);
  }

  private region(region: IrRegion): void {
    const [ops, name] = [region.ops, `r${region.id}`];

    ops.forEach((op, i) => {
      const where = `${name}[${i}] ${op.kind}`;

      if (isTerminator(op) && i !== ops.length - 1)
        this.problem(`${where} is not the last operation of ${name}`);

      this.spanInside(op.source, where);

      for (const v of operandsOf(op)) this.use(v, where);

      const check = CHECKS[op.kind] as ((op: IrOp, c: Checker, where: string) => void) | undefined;

      if (check) check(op, this, where);
      else this.problem(`${where} is not an operation`);

      const result = resultOf(op);

      if (result !== undefined) this.define(result, where);
    });
  }

  private use(v: ValueId, where: string): void {
    if (!this.fn.values[v]) this.problem(`${where} uses v${v}, which does not exist`);
    else if (this.visible.has(v)) return;
    else if (this.defined.has(v))
      this.problem(`${where} uses v${v} outside the region that defines it`);
    else this.problem(`${where} uses v${v} before it is defined`);
  }

  define(v: ValueId, where: string): void {
    if (!this.fn.values[v]) this.problem(`${where} defines v${v}, which does not exist`);
    else if (this.defined.has(v)) this.problem(`${where} defines v${v} again`);

    this.defined.add(v);
    this.visible.add(v);
  }

  /**
   * Checks region `id`, owned by an operation of the region being checked,
   * in a scope of its own: what it defines and declares is not visible after it.
   */
  nested(
    id: RegionId,
    how: {
      enclosing?: Enclosing;
      yields?: LType;
      defines?: ValueId[];
      where?: string;
      finally?: boolean;
    } = {},
  ): void {
    const region = this.fn.regions[id];

    if (!region) return;

    const saved = {
      visible: new Set(this.visible),
      places: new Map(this.places),
      yields: this.yields,
      inFinally: this.inFinally,
    };

    if (how.enclosing) this.enclosing.push(how.enclosing);

    this.yields = how.yields;

    if (how.finally) this.inFinally = true;

    // What the owning operation defines for the region alone (an iteration's element).
    for (const v of how.defines ?? []) this.define(v, how.where ?? `r${id}`);

    try {
      this.region(region);
    } finally {
      if (how.enclosing) this.enclosing.pop();

      Object.assign(this, saved);
    }

    const last = region.ops[region.ops.length - 1];

    if (how.yields && !(last && isTerminator(last)))
      this.problem(`r${id} can end without giving the if's ${typeKey(how.yields)} result`);
  }

  /** A `break` or `continue` names an enclosing loop or block it can jump to. */
  jump(op: IrOp & { kind: "break" | "continue" }, where: string): void {
    const target = this.enclosing.findLast((e) => e.target === op.target);

    if (op.kind === "break") {
      if (!target) this.problemAt(where, `jumps to t${op.target}, which does not enclose it`);

      return;
    }

    if (!target) this.problemAt(where, `continues t${op.target}, which does not enclose it`);
    else if (!target.loop) this.problemAt(where, `continues t${op.target}, which is not a loop`);
    else if (target.next) this.problemAt(where, `continues t${op.target} from its own next region`);
  }

  /** A `yield` ends a branch of an `if` giving a result, with a value of its type. */
  yield(op: IrOp & { kind: "yield" }, where: string): void {
    if (!this.yields) {
      this.problemAt(where, "is not in a branch of an if giving a result");
      return;
    }

    if (op.value === undefined)
      this.problemAt(where, `gives nothing for the if's ${typeKey(this.yields)} result`);
    else this.expectType(op.value, this.yields, where);
  }

  typeOf(v: ValueId | undefined): LType | undefined {
    return v === undefined ? undefined : this.fn.values[v]?.type;
  }

  /** `v`'s type is `expected`. */
  expectType(v: ValueId | undefined, expected: LType | undefined, where: string): void {
    const actual = this.typeOf(v);

    if (actual && expected && !sameType(actual, expected))
      this.problem(`${where}: v${v} is ${typeKey(actual)}, expected ${typeKey(expected)}`);
  }

  place(p: PlaceId, where: string): { type: LType; mutable: boolean; boxed?: boolean } | undefined {
    const place = this.places.get(p);

    if (!place) this.problem(`${where} uses p${p}, which is not declared before it`);

    return place;
  }

  declare(p: PlaceId, type: LType, where: string, boxed = false): void {
    if (this.declared.has(p)) this.problem(`${where} declares p${p} again`);

    this.declared.add(p);
    this.places.set(p, { type, mutable: true, boxed });
  }

  /** Whether the class type `t` derives from Error, as far as the environment knows. */
  derivesFromError(t: LType): boolean {
    return this.env.isError?.(t) ?? true;
  }

  /**
   * A plan: named; its code names only its operands (as `operand(v)` spells them), each
   * defined before it; an integer form only of a number result, and only
   * when its operands' integer forms it names are exact integers.
   */
  plan(op: IrOp & { kind: "plan" }, where: string): void {
    if (!op.name) this.problemAt(where, "has no name");

    const named = operandsIn(op.code);
    const listed = new Set(op.args);

    for (const v of named.values)
      if (!listed.has(v)) this.problemAt(where, `names v${v}, which is not one of its operands`);

    for (const v of named.ints) {
      if (!listed.has(v)) this.problemAt(where, `names v${v}, which is not one of its operands`);
      else if (!this.fn.values[v]?.int)
        this.problemAt(where, `names the integer form of v${v}, which is not an exact integer`);
    }

    if (op.int) {
      const t = op.result === undefined ? undefined : this.typeOf(op.result);

      if (!t || t.k !== "number")
        this.problemAt(where, "has an integer form, but does not give a number");
      else if (this.fn.values[op.result!]?.int !== op.int.kind)
        this.problemAt(where, `has an ${op.int.kind} form, but v${op.result} is not one`);
    }
  }

  /** An await, in an async function, of a promise, giving what it fulfils with. */
  awaits(op: IrOp & { kind: "await" }, where: string): void {
    const t = this.typeOf(op.promise);

    if (!this.fn.async) this.problemAt(where, "is not in an async function");

    if (t && t.k !== "promise") this.problemAt(where, `awaits a ${typeKey(t)}, not a promise`);
    else if (t && isVoidish(t.inner) !== (op.result === undefined))
      this.problemAt(where, "gives a value just when the promise's has one");
    else if (t && op.result !== undefined) this.expectType(op.result, t.inner, where);
  }

  /** A produce, in a generator, of an element of its type. */
  produces(op: IrOp & { kind: "produce" }, where: string): void {
    if (!this.fn.generator) this.problemAt(where, "is not in a generator");
    else this.expectType(op.value, this.fn.generator, where);
  }

  /** A closure: its function is valid, and each capture gets a value of its type or a box. */
  closure(op: IrOp & { kind: "closure" }, where: string): void {
    const fn = op.fn;

    for (const problem of new Checker(fn, this.env).run())
      this.problem(`${where} ${fn.id}: ${problem}`);

    if (op.from.length !== fn.captures.length)
      this.problem(`${where} gives ${op.from.length} captures, ${fn.id} has ${fn.captures.length}`);

    if (op.enters !== undefined) this.expectType(op.enters, { k: "mount" }, `${where} enters`);

    op.from.forEach((from, i) => {
      const capture = fn.captures[i];

      if (!capture) return;

      if ("value" in from) {
        if (capture.boxed)
          this.problem(`${where} gives a value to the boxed capture ${capture.name}`);

        this.expectType(from.value, capture.type, `${where} capture ${capture.name}`);
        return;
      }

      const place = this.place(from.box, where);

      if (place && !place.boxed) this.problem(`${where} shares p${from.box}, which is not boxed`);
      else if (!capture.boxed) this.problem(`${where} shares a box with the copy ${capture.name}`);

      if (place && !sameType(place.type, capture.type))
        this.problem(
          `${where} capture ${capture.name} is ${typeKey(capture.type)}, p${from.box} is ${typeKey(place.type)}`,
        );
    });

    const t = this.typeOf(op.result);

    if (t && (t.k !== "fn" || t.params.length !== fn.params.length))
      this.problem(
        `${where} gives v${op.result}, which is not a function of ${fn.params.length} parameters`,
      );
  }

  call(op: IrOp & { kind: "call" }, where: string): void {
    const c = op.callee;
    const known = c.kind === "builtin" && isBuiltin(c.name) ? BUILTINS[c.name] : undefined;

    if (c.kind === "builtin" && !known)
      this.problem(`${where} calls an unknown builtin "${c.name}"`);

    if (!THROWS.includes(op.effects.throws))
      this.problem(`${where} has an unknown throws claim ${JSON.stringify(op.effects.throws)}`);

    if (known && RANK[op.effects.throws] < RANK[known.throws])
      this.problem(`${where} claims it cannot throw, but its callee can`);

    if (c.kind === "function" && op.effects.summary !== undefined && op.effects.summary !== c.id)
      this.problem(`${where} calls ${c.id} with the effects of ${op.effects.summary}`);

    const sig = known ?? (c.kind === "function" ? this.env.signature?.(c.id) : undefined);

    if (!sig) return;

    if (op.args.length !== sig.params.length)
      this.problem(
        `${where} passes ${op.args.length} arguments, the callee takes ${sig.params.length}`,
      );

    op.args.forEach((a, i) => this.expectType(a, sig.params[i], `${where} argument ${i}`));

    if (isVoidish(sig.result)) {
      if (op.result !== undefined)
        this.problem(`${where} gives v${op.result}, the callee gives nothing`);
    } else if (op.result === undefined) {
      this.problem(`${where} drops the callee's result, which must be defined (and may go unused)`);
    } else this.expectType(op.result, sig.result, where);
  }

  ret(op: IrOp & { kind: "return" }, where: string): void {
    const result = this.fn.result;

    if (op.value === undefined) {
      if (!isVoidish(result))
        this.problem(`${where} gives nothing from a function giving ${typeKey(result)}`);
    } else if (isVoidish(result)) {
      this.problem(`${where} gives v${op.value} from a function giving nothing`);
    } else this.expectType(op.value, result, where);
  }

  /** Every span is well formed and, but for the function's own, inside the function's. */
  private spanInside(s: SourceSpan | undefined, what: string, own = false): void {
    const fn = this.fn.source;

    if (
      !s ||
      typeof s.file !== "string" ||
      !(s.start <= s.end) ||
      !(s.line >= 1) ||
      !(s.column >= 1)
    ) {
      this.problem(`${what} has no valid source span`);
      return;
    }

    const inside = (code: SourceSpan) =>
      s.file === code.file && s.start >= code.start && s.end <= code.end;

    if (!own && !inside(fn) && !this.fn.elsewhere?.some(inside))
      this.problem(`${what} has a span (${s.file}:${s.start}-${s.end}) outside the function's`);
  }

  /**
   * A call of a function whose summary is known: the call claims at least
   * the callee's throwing, and the function's summary the state it touches.
   */
  private callClaims(op: IrOp & { kind: "call" }, claims: EffectSummary): void {
    if (op.callee.kind !== "function") return;

    const name = op.callee.id;
    const callee = this.env.effects?.(name);

    if (!callee) return;

    if (RANK[op.effects.throws] < RANK[callee.throws])
      this.problem(`a call of ${name} claims it cannot throw, but ${name} can`);

    if (STATE[claims.reads] < STATE[callee.reads])
      this.problem(`the summary says the function reads less state than ${name} does`);

    if (STATE[claims.writes] < STATE[callee.writes])
      this.problem(`the summary says the function writes less state than ${name} does`);
  }

  /** The function's summary admits what its operations can do. */
  private summary(): void {
    const claims: EffectSummary = this.fn.effects;
    const ops = this.fn.regions.flatMap((r) => r.ops);
    const module = new Set(this.fn.modulePlaces.filter((p) => p.mutable).map((p) => p.place));
    const mayThrow = ops.find(
      (op) =>
        op.kind === "throw" ||
        (op.kind === "call" && op.effects.throws !== "no") ||
        throwsRangeError(op, this.fn.values),
    );

    if (mayThrow && claims.throws === "no")
      this.problem(`the summary says the function cannot throw, but its ${mayThrow.kind} can`);

    if (claims.reads === "none" && ops.some((op) => op.kind === "load" && module.has(op.place)))
      this.problem("the summary says the function reads no state, but it loads a module variable");

    if (claims.writes === "none" && ops.some((op) => op.kind === "store" && module.has(op.place)))
      this.problem(
        "the summary says the function writes no state, but it stores a module variable",
      );

    const calls = ops.filter((op): op is IrOp & { kind: "call" } => op.kind === "call");
    const opaque = calls.filter(
      (op) => op.callee.kind === "function" && !this.env.effects?.(op.callee.id),
    );

    if (claims.reads === "none" && claims.writes === "none" && opaque.length)
      this.problem("the summary says the function touches no state, but it makes calls");

    for (const op of calls) this.callClaims(op, claims);

    if (this.fn.async && !claims.suspends)
      this.problem("the summary says an async function cannot suspend");
  }
}

type Check<K extends IrOp["kind"]> = (op: IrOp & { kind: K }, c: Checker, where: string) => void;

/** The type rules of each operation (invariant 2). */
const CHECKS: { [K in IrOp["kind"]]: Check<K> } = {
  const: (op, c, where) => {
    const v = op.value;
    const kinds = ["number", "bigint", "string", "boolean", "undefined"];

    if (!(v === null || kinds.includes(typeof v)))
      c.problemAt(where, "has a constant of no JavaScript primitive type");
    else c.expectType(op.result, constantType(v), where);
  },

  param: (op, c, where) => {
    c.params.add(op.index);

    if (c.paramAt(op.index) !== op.result)
      c.problemAt(
        where,
        `defines v${op.result}, but parameter ${op.index} is v${String(c.paramAt(op.index))}`,
      );
  },

  unary: (op, c, where) => {
    const operand = c.typeOf(op.operand);

    if (!isUnaryOp(op.op)) c.problemAt(where, `has an unknown operator ${JSON.stringify(op.op)}`);
    else if (operand && !unaryResult(op.op, operand))
      c.problemAt(where, `${op.op} does not take a ${typeKey(operand)}`);
    else c.expectType(op.result, operand && unaryResult(op.op, operand), where);
  },

  binary: (op, c, where) => {
    const [l, r] = [c.typeOf(op.left), c.typeOf(op.right)];

    if (!isBinaryOp(op.op)) c.problemAt(where, `has an unknown operator ${JSON.stringify(op.op)}`);
    else if (l && r && !binaryResult(op.op, l, r))
      c.problemAt(where, `${op.op} does not take a ${typeKey(l)} and a ${typeKey(r)}`);
    else c.expectType(op.result, l && r && binaryResult(op.op, l, r), where);
  },

  convert: (op, c, where) => {
    const from = c.typeOf(op.input);

    c.expectType(op.result, op.to, where);

    if (from && !convertible(from, op.to))
      c.problemAt(where, `cannot convert a ${typeKey(from)} to ${typeKey(op.to)}`);
  },

  local: (op, c, where) => {
    c.declare(op.place, op.type, where, op.boxed);

    if (op.int && (op.type.k !== "number" || op.boxed))
      c.problemAt(
        where,
        `holds p${op.place} in an ${op.int} register, but it is not a local number`,
      );
  },

  load: (op, c, where) => c.expectType(op.result, c.place(op.place, where)?.type, where),

  store: (op, c, where) => {
    const place = c.place(op.place, where);

    if (place && !place.mutable) c.problemAt(where, `stores into the constant p${op.place}`);

    c.expectType(op.value, place?.type, where);
  },

  renew: (op, c, where) => {
    const place = c.place(op.place, where);

    if (place && !place.boxed) c.problemAt(where, `renews p${op.place}, which is not boxed`);
    else if (place && !sameType(place.type, op.type))
      c.problemAt(where, `renews p${op.place} as ${typeKey(op.type)}, not ${typeKey(place.type)}`);
  },

  call: (op, c, where) => c.call(op, where),

  return: (op, c, where) => c.ret(op, where),

  throw: (op, c, where) => {
    const t = c.typeOf(op.value);

    // An Error, or an object of a class deriving from Error.
    if (t && t.k !== "error" && !(t.k === "class" && c.derivesFromError(t)))
      c.problemAt(where, `throws a ${typeKey(t)}, not an Error`);
  },

  if: (op, c, where) => {
    const result = op.result === undefined ? undefined : c.typeOf(op.result);

    c.expectType(op.cond, T.boolean, where);
    c.nested(op.whenTrue, { yields: result });
    c.nested(op.whenFalse, { yields: result });
  },

  loop: (op, c) => {
    c.nested(op.body, { enclosing: { target: op.target, loop: true, next: false } });

    if (op.next !== undefined)
      c.nested(op.next, { enclosing: { target: op.target, loop: true, next: true } });
  },

  try: (op, c, where) => {
    c.nested(op.body);

    if (op.catch) {
      c.expectType(op.catch.error, T.error, where);
      c.nested(op.catch.region, { defines: [op.catch.error], where });
    }

    if (op.finally !== undefined) c.nested(op.finally, { finally: true });
  },

  dispose: (_op, c, where) => {
    if (!c.inFinally) c.problemAt(where, "is not in a finally region");
  },

  iterate: (op, c, where) => {
    const iterable = c.typeOf(op.iterable);
    const element = iterable && elementOf(iterable);

    if (iterable && !element) c.problemAt(where, `cannot iterate over a ${typeKey(iterable)}`);
    else c.expectType(op.element, element, where);

    c.nested(op.body, {
      enclosing: { target: op.target, loop: true, next: false },
      defines: [op.element],
      where,
    });
  },

  block: (op, c) =>
    c.nested(
      op.body,
      op.target === undefined ? {} : { enclosing: { target: op.target, loop: false, next: false } },
    ),

  break: (op, c, where) => c.jump(op, where),

  continue: (op, c, where) => c.jump(op, where),

  yield: (op, c, where) => c.yield(op, where),

  // Its operands are checked like every operation's; what it does is the backend's. Its code
  // names exactly its operands, and an integer form only for a number result.
  plan: (op, c, where) => c.plan(op, where),

  closure: (op, c, where) => c.closure(op, where),

  unreachable: () => {},

  never: (op, c, where) => c.expectType(op.result, T.never, where),

  await: (op, c, where) => c.awaits(op, where),

  produce: (op, c, where) => c.produces(op, where),
};

function safeDump(fn: IrFunction): string {
  try {
    return dump(fn);
  } catch (e) {
    return `(no dump: ${(e as Error).message})`;
  }
}

/**
 * The values a plan's code names: as values (`$vN`), and as their integer
 * forms (`$iN`), the spellings ir/cpp.ts's `operand` and `intOperand` give.
 */
function operandsIn(code: unknown): { values: Set<ValueId>; ints: Set<ValueId> } {
  const values = new Set<ValueId>();
  const ints = new Set<ValueId>();
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null || seen.has(node)) return;

    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const n = node as { k?: unknown; name?: unknown };

    if (n.k === "id" && typeof n.name === "string") {
      const int = /^\$i(\d+)$/.exec(n.name);
      const value = /^\$v(\d+)$/.exec(n.name);

      if (int) ints.add(Number(int[1]) as ValueId);
      else if (value) values.add(Number(value[1]) as ValueId);
    }

    for (const v of Object.values(node)) visit(v);
  };

  visit(code);
  return { values, ints };
}
