import { describe, expect, it } from "vite-plus/test";
import { IrBuilder } from "../../src/ir/build.ts";
import { dump } from "../../src/ir/dump.ts";
import type {
  EffectRef,
  IrFunction,
  IrOp,
  PlaceId,
  RegionId,
  SourceSpan,
  ValueId,
} from "../../src/ir/ir.ts";
import { IrVerifyError, verify, type VerifyEnv } from "../../src/ir/verify.ts";
import { Completion } from "../../src/ir/ir.ts";
import { type LType, T } from "../../src/types.ts";

const FILE = "/app/order.lucent.ts";

/** A span on line 1 of the fixture file. */
function at(start: number, end = start + 1): SourceSpan {
  return { file: FILE, start, end, line: 1, column: start + 1 };
}

const UNKNOWN: EffectRef = { throws: "unknown" };

const fn = (id: string) => ({ kind: "function", id }) as const;

const SIGNATURES: VerifyEnv = {
  signature: (id) =>
    ({
      next: { params: [T.string], result: T.string },
      combine: { params: [T.string, T.string], result: T.string },
    })[id],
};

/** `return combine(next("l"), next("r"))`: three ordered calls. */
function pair(): IrFunction {
  const b = new IrBuilder("pair", T.string, at(0, 100));
  const l = b.const("l", at(10));
  const first = b.call(fn("next"), [l], T.string, { ...UNKNOWN, summary: "next" }, at(5, 14));
  const r = b.const("r", at(20));
  const second = b.call(fn("next"), [r], T.string, { ...UNKNOWN, summary: "next" }, at(15, 24));
  const both = b.call(fn("combine"), [first!, second!], T.string, UNKNOWN, at(0, 25));

  b.return(both, at(0, 26));
  return b.finish();
}

/** `(a, b) => a * 2 - b`: arithmetic on parameters only. */
function arithmetic(): IrFunction {
  const b = new IrBuilder("arith", T.number, at(0, 100));
  const a = b.param(0, T.number, at(1));
  const c = b.param(1, T.number, at(3));
  const two = b.const(2, at(10));
  const doubled = b.binary("*", a, two, at(8, 11));
  const diff = b.binary("-", doubled, c, at(8, 15));

  b.return(diff, at(1, 16));
  return b.finish();
}

function problemsOf(f: IrFunction, env: VerifyEnv = SIGNATURES): string[] {
  try {
    verify(f, env);
    return [];
  } catch (e) {
    if (e instanceof IrVerifyError) return e.problems;
    throw e;
  }
}

/** `f` with the ops of its body replaced. */
function withOps(f: IrFunction, ops: (ops: IrOp[]) => IrOp[]): IrFunction {
  return {
    ...f,
    regions: f.regions.map((r) => (r.id === f.body ? { ...r, ops: ops([...r.ops]) } : r)),
  };
}

const v = (n: number) => n as ValueId;

describe("IR verifier", () => {
  it("accepts well-formed functions", () => {
    expect(problemsOf(pair())).toEqual([]);

    expect(problemsOf(arithmetic())).toEqual([]);
  });

  it("dumps calls in evaluation order", () => {
    expect(dump(pair())).toBe(
      [
        "fn pair() -> string @1:1",
        "  effects reads=unknown writes=unknown allocates=unknown throws=unknown suspends=false callbacks=unknown affinity=unknown native=unknown",
        "  r0:",
        '    v0 = const "l" : string  @1:11',
        "    v1 = call next(v0) throws=unknown : string  @1:6",
        '    v2 = const "r" : string  @1:21',
        "    v3 = call next(v2) throws=unknown : string  @1:16",
        "    v4 = call combine(v1, v3) throws=unknown : string  @1:1",
        "    return v4  @1:1",
        "",
      ].join("\n"),
    );
  });

  it("summarizes pure arithmetic as pure, and anything else conservatively", () => {
    expect(arithmetic().effects).toEqual({
      reads: "none",
      writes: "none",
      allocates: false,
      throws: "no",
      suspends: false,
      callbacks: "none",
      affinity: "any",
      native: "none",
    });

    expect(pair().effects).toMatchObject({ reads: "unknown", throws: "unknown", suspends: false });
  });

  it("rejects a use before the definition", () => {
    const swapped = withOps(pair(), (ops) => {
      const [combine] = ops.splice(4, 1);
      ops.splice(3, 0, combine!);
      return ops;
    });

    expect(problemsOf(swapped)).toContain("r0[3] call uses v3 before it is defined");
  });

  it("rejects values defined twice, never defined, or missing", () => {
    const twice = withOps(pair(), (ops) => [ops[0]!, ...ops]);
    const extra = {
      ...pair(),
      values: [...pair().values, { id: v(5), type: T.number, source: at(1) }],
    };
    const missing = withOps(pair(), (ops) =>
      ops.map((op) => (op.kind === "return" ? { ...op, value: v(99) } : op)),
    );

    expect(problemsOf(twice)).toContain("r0[1] const defines v0 again");

    expect(problemsOf(extra)).toContain("v5 is never defined");

    expect(problemsOf(missing)).toContain("r0[5] return uses v99, which does not exist");
  });

  it("rejects operators on operands they do not take", () => {
    const f = arithmetic();
    const onStrings = withOps(pair(), (ops) => [
      ...ops.slice(0, 4),
      { kind: "binary", result: v(4), op: "-", left: v(1), right: v(3), source: at(0, 25) },
      ops[5]!,
    ]);
    const unknownOp = withOps(f, (ops) =>
      ops.map((op) => (op.kind === "binary" ? { ...op, op: "<=>" as never } : op)),
    );

    expect(problemsOf(onStrings)).toContain("r0[4] binary - does not take a string and a string");

    expect(problemsOf(unknownOp)).toContain('r0[3] binary has an unknown operator "<=>"');
  });

  it("rejects conversions to another type than their result, or that the IR does not know", () => {
    const maybe: LType = { k: "opt", inner: T.number };
    const b = new IrBuilder("conv", maybe, at(0, 100));
    const n = b.const(1, at(1));
    const s = b.convert(n, maybe, at(2));

    b.return(s, at(3));

    const good = b.finish();
    const wrongTarget = withOps(good, (ops) =>
      ops.map((op) => (op.kind === "convert" ? { ...op, to: T.boolean } : op)),
    );
    const unknown = withOps(good, (ops) =>
      ops.map((op) => (op.kind === "const" ? { ...op, value: "x" } : op)),
    );
    const toString = withOps(good, (ops) =>
      ops.map((op) => (op.kind === "convert" ? { ...op, to: T.string } : op)),
    );

    expect(problemsOf(good)).toEqual([]);

    expect(problemsOf(wrongTarget)).toContain("r0[1] convert: v1 is number?, expected boolean");

    expect(
      problemsOf({
        ...unknown,
        values: unknown.values.map((x, i) => (i === 0 ? { ...x, type: T.string } : x)),
      }),
    ).toContain("r0[1] convert cannot convert a string to number?");

    // ToString is the String operator: a conversion keeps the value.
    expect(problemsOf(toString)).toContain("r0[1] convert cannot convert a number to string");
  });

  it("rejects calls that do not match their callee's signature", () => {
    const arity = withOps(pair(), (ops) =>
      ops.map((op) => (op.kind === "call" && op.args.length === 2 ? { ...op, args: [v(1)] } : op)),
    );
    const argType = withOps(arithmetic(), (ops) => [
      ...ops.slice(0, 5),
      {
        kind: "call",
        result: undefined,
        callee: fn("next"),
        args: [v(4)],
        effects: UNKNOWN,
        source: at(20),
      },
      ops[5]!,
    ]);

    expect(problemsOf(arity)).toContain("r0[4] call passes 1 arguments, the callee takes 2");

    expect(problemsOf(argType)).toContain("r0[5] call argument 0: v4 is number, expected string");

    expect(problemsOf(argType)).toContain(
      "r0[5] call drops the callee's result, which must be defined (and may go unused)",
    );
  });

  it("rejects a return of another type than the function's", () => {
    const f = { ...pair(), result: T.number };

    expect(problemsOf(f)).toContain("r0[5] return: v4 is string, expected number");
  });

  it("rejects operations after a terminator, and bodies that end without a result", () => {
    const after = withOps(pair(), (ops) => [
      ...ops,
      { kind: "const", result: v(5), value: 1, source: at(30) },
    ]);
    const fallsOff = withOps(pair(), (ops) => ops.slice(0, -1));

    expect(
      problemsOf({
        ...after,
        values: [...after.values, { id: v(5), type: T.number, source: at(30) }],
      }),
    ).toContain("r0[5] return is not the last operation of r0");

    expect(problemsOf(fallsOff)).toContain("the body can end without giving a string");
  });

  it("rejects spans outside the function", () => {
    const outside = withOps(pair(), (ops) =>
      ops.map((op, i) => (i === 1 ? { ...op, source: at(150, 160) } : op)),
    );
    const otherFile = withOps(pair(), (ops) =>
      ops.map((op, i) => (i === 1 ? { ...op, source: { ...op.source, file: "/other.ts" } } : op)),
    );
    const broken = withOps(pair(), (ops) =>
      ops.map((op, i) => (i === 1 ? { ...op, source: { ...op.source, line: 0 } } : op)),
    );

    expect(problemsOf(outside)).toContain(
      `r0[1] call has a span (${FILE}:150-160) outside the function's`,
    );

    expect(problemsOf(otherFile)).toContain(
      "r0[1] call has a span (/other.ts:5-14) outside the function's",
    );

    expect(problemsOf(broken)).toContain("r0[1] call has no valid source span");
  });

  it("accepts spans in the code a function computes from elsewhere (a helper view's)", () => {
    const moved = withOps(pair(), (ops) =>
      ops.map((op, i) => (i === 1 ? { ...op, source: at(150, 160) } : op)),
    );

    expect(problemsOf({ ...moved, elsewhere: [at(140, 170)] })).toEqual([]);
  });

  it("makes a closure enter a mount, which only a mount may be", () => {
    const made = (enters: LType): IrFunction => {
      const b = new IrBuilder("setup", T.void, at(0, 100));
      const mount = b.param(0, enters, at(1));
      const inner = new IrBuilder("setup$1", T.void, at(20, 40));

      inner.return(undefined, at(30));
      b.closure(inner.finish(), [], { k: "fn", params: [], ret: T.void }, at(20, 40), mount);
      b.return(undefined, at(50));
      return b.finish();
    };

    expect(problemsOf(made({ k: "mount" }))).toEqual([]);

    expect(dump(made({ k: "mount" }))).toMatch(/= closure setup\$1\(\) enters v0/);

    expect(problemsOf(made(T.number))).toContain(
      "r0[1] closure enters: v0 is number, expected mount",
    );
  });

  it("rejects places that are not declared, stores into constants and mistyped stores", () => {
    const b = new IrBuilder("places", T.void, at(0, 100));
    const log = b.modulePlace("m::log", "log", T.string, false);
    const x = b.local("x", T.number, at(1));
    const one = b.const(1, at(2));

    b.store(x, one, at(3));

    const s = b.load(log, at(4));

    b.store(log, s, at(5));
    b.store(x, s, at(6));

    const built = b.finish();
    const f = withOps(
      { ...built, values: [...built.values, { id: v(2), type: T.number, source: at(7) }] },
      (ops) => [...ops, { kind: "load", result: v(2), place: 7 as PlaceId, source: at(7) }],
    );

    expect(problemsOf(f)).toEqual([
      "r0[4] store stores into the constant p0",
      "r0[5] store: v1 is string, expected number",
      "r0[6] load uses p7, which is not declared before it",
    ]);
  });

  it("rejects an integer register on anything but a number, or on a boxed local", () => {
    const b = new IrBuilder("ints", T.void, at(0, 100));

    b.local("n", T.number, at(1), false, "i64");
    b.local("s", T.string, at(2), false, "i32");
    b.local("shared", T.number, at(3), true, "i64");

    const built = b.finish();
    const t = new IrBuilder("text", T.string, at(0, 100));

    t.return(t.const("x", at(1)), at(2));

    const text = t.finish();
    // A string claimed to be held in an integer register.
    const f = { ...text, values: text.values.map((x) => ({ ...x, int: "u32" as const })) };

    expect(problemsOf(built)).toEqual([
      "r0[1] local holds p1 in an i32 register, but it is not a local number",
      "r0[2] local holds p2 in an i64 register, but it is not a local number",
    ]);

    expect(problemsOf(f)).toContain("v0 is held in an u32 register, but is a string");
  });

  it("rejects integer elements on anything but a local array of numbers, or seen by anything but plans", () => {
    const numbers = { k: "array", e: T.number } as const;
    const b = new IrBuilder("elements", T.number, at(0, 100));
    const table = b.local("table", numbers, at(1), false, undefined, undefined, "u32");

    b.local("names", { k: "array", e: T.string }, at(2), false, undefined, undefined, "i32");
    b.store(table, b.plan("[…]", "made", [], numbers, at(3), undefined, "u32")!, at(3));

    const read = b.load(table, at(4));
    const other = b.local("other", numbers, at(5));

    b.store(other, read, at(6));
    b.return(b.plan(".length", "length", [read], T.number, at(7))!, at(8));

    expect(problemsOf(b.finish())).toEqual([
      "r0[1] local holds p1 as i32 elements, but it is not a local array of numbers",
      "r0[6] store uses v1, an array of u32 elements, which only plans read",
    ]);
  });

  it("rejects an object on the stack that is not a local of an object type, or seen by anything but plans", () => {
    const point = { k: "struct", id: "x:number" } as const;
    const b = new IrBuilder("stack", T.number, at(0, 100));
    const p = b.local("p", point, at(1), false, undefined, undefined, undefined, true);

    b.local("n", T.number, at(2), false, undefined, undefined, undefined, true);
    b.store(p, b.plan("{…}", "made", [], point, at(3), undefined, undefined, true)!, at(3));

    const read = b.load(p, at(4));

    b.return(b.plan(".x", "x", [read], T.number, at(5))!, at(6));

    const kept = new IrBuilder("kept", point, at(0, 100));
    const q = kept.local("q", point, at(1), false, undefined, undefined, undefined, true);

    kept.store(q, kept.plan("{…}", "made", [], point, at(2), undefined, undefined, true)!, at(2));
    kept.return(kept.load(q, at(3)), at(4));

    expect(problemsOf(b.finish())).toEqual([
      "r0[1] local holds p1 on the stack, but it is not a local of an object type",
    ]);

    expect(problemsOf(kept.finish())).toEqual([
      "r0[4] return uses v1, an object on the stack, which only plans read",
    ]);
  });

  it("rejects throwing a value that is not an Error", () => {
    const b = new IrBuilder("boom", T.string, at(0, 100));

    b.throw(b.const("oops", at(1)), at(2));

    expect(problemsOf(b.finish())).toContain("r0[1] throw throws a string, not an Error");
  });

  it("rejects throwing an object of a class that does not derive from Error", () => {
    const thrown = (cls: LType) => {
      const b = new IrBuilder("boom", T.void, at(0, 100));

      b.throw(b.param(0, cls, at(1)), at(2));
      return b.finish();
    };
    const env: VerifyEnv = { isError: (t) => t.k === "class" && t.id === "Failure" };
    const point: LType = { k: "class", id: "Point", args: [] };
    const failure: LType = { k: "class", id: "Failure", args: [] };

    expect(problemsOf(thrown(point), env)).toContain("r0[1] throw throws a C:Point, not an Error");
    expect(problemsOf(thrown(failure), env)).toEqual([]);
  });

  it("rejects plans naming values they do not take, or integer forms they do not have", () => {
    const b = new IrBuilder("plans", T.number, at(0, 100));
    const a = b.param(0, T.number, at(1));
    const s = b.param(1, T.string, at(2));
    const named = (v: ValueId) => ({ k: "id", name: `$v${v}` });
    const int = (v: ValueId) => ({ k: "id", name: `$i${v}` });

    b.plan("stray", { k: "call", callee: named(s), args: [] }, [a], T.number, at(3));
    b.plan("not an integer", int(a), [a], T.number, at(4));
    b.plan("int of a string", named(s), [s], T.string, at(5));
    b.return(b.plan("fine", named(a), [a], T.number, at(6)), at(7));

    // The builder never gives a string an integer form: the IR is edited to.
    const f = b.finish();
    const ops = f.regions[0]!.ops;

    ops[4] = { ...(ops[4] as IrOp & { kind: "plan" }), int: { code: named(s), kind: "i32" } };

    expect(problemsOf(f)).toEqual(
      expect.arrayContaining([
        "r0[2] plan names v1, which is not one of its operands",
        "r0[3] plan names the integer form of v0, which is not an exact integer",
        "r0[4] plan has an integer form, but does not give a number",
      ]),
    );
  });

  it("rejects summaries and effect references that claim less than the operations do", () => {
    const f = pair();
    const lies = {
      ...f,
      effects: {
        ...f.effects,
        throws: "no" as const,
        reads: "none" as const,
        writes: "none" as const,
      },
    };
    const builtin = withOps(pair(), (ops) =>
      ops.map((op) =>
        op.kind === "call" && op.args.length === 2
          ? { ...op, callee: { kind: "builtin", name: "Math.max" as never } }
          : op,
      ),
    );
    const borrowed = withOps(pair(), (ops) =>
      ops.map((op, i) =>
        i === 1 && op.kind === "call"
          ? { ...op, effects: { throws: "unknown", summary: "combine" } }
          : op,
      ),
    );

    expect(problemsOf(lies)).toEqual([
      "the summary says the function cannot throw, but its call can",
      "the summary says the function touches no state, but it makes calls",
    ]);

    expect(problemsOf(builtin)).toContain('r0[4] call calls an unknown builtin "Math.max"');

    expect(problemsOf(borrowed)).toContain("r0[1] call calls next with the effects of combine");
  });

  it("rejects unknown owners, stray regions and parameters without a param operation", () => {
    const f = arithmetic();
    const owned = {
      ...f,
      values: f.values.map((x, i) => (i === 0 ? { ...x, owner: "worker" as never } : x)),
    };
    const stray = { ...f, regions: [...f.regions, { id: 1 as RegionId, ops: [], parent: f.body }] };
    const noParam = withOps(f, (ops) =>
      ops.map((op) => (op.kind === "param" && op.index === 1 ? { ...op, index: 0 } : op)),
    );

    expect(problemsOf(owned)).toContain('v0 has an unknown owner "worker"');

    expect(problemsOf(stray)).toContain("r1 is not owned by any operation");

    expect(problemsOf(noParam)).toContain("parameter 1 (v1) has no param operation");
  });

  it("reports the dump with the problems", () => {
    const f = { ...pair(), result: T.number as LType };

    expect(() => verify(f, SIGNATURES)).toThrow(
      /invalid IR for pair\n {2}r0\[5\] return[^]*fn pair\(\) -> number/,
    );
  });
});

describe("completion", () => {
  /** `try { try { … throw } catch {} } finally {}`, `depth` deep, counting reads of its regions. */
  function nested(depth: number): { f: IrFunction; reads: () => number } {
    const b = new IrBuilder("deep", T.undefined, at(0, 100));
    const inner = (n: number): void => {
      if (n === 0) {
        b.throw(b.const(null, at(1)), at(1));
        return;
      }
      b.try(
        at(n),
        () => inner(n - 1),
        () => {},
        () => {},
      );
    };

    inner(depth);
    b.return(undefined, at(99));

    const f = b.finish();
    let reads = 0;
    const regions = new Proxy(f.regions, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });

    return { f: { ...f, regions }, reads: () => reads };
  }

  it("decides each region once, however many operations ask", () => {
    const { f, reads } = nested(200);
    const tries = f.regions.flatMap((r) => r.ops.filter((op) => op.kind === "try"));
    const outer = f.regions[f.body]!.ops.filter((op) => op.kind === "try");
    const before = reads();
    const c = new Completion(f);

    // Every try asks, as the emitter does: once each is linear, not quadratic.
    for (const op of tries) c.ops([op]);

    expect(c.ops(outer)).toBe(true);
    expect(c.region(f.body)).toBe(false);
    expect(reads() - before).toBeLessThanOrEqual(f.regions.length);
  });

  it("does not complete a try whose body throws and whose catch never ends", () => {
    const b = new IrBuilder("stuck", T.number, at(0, 100));

    b.try(
      at(1),
      () => b.throw(b.const(null, at(2)), at(2)),
      () => b.return(b.const(1, at(3)), at(3)),
    );
    b.return(b.const(2, at(4)), at(4));

    const f = b.finish();
    const tries = f.regions[f.body]!.ops.filter((op) => op.kind === "try");

    expect(new Completion(f).ops(tries)).toBe(false);
  });
});
