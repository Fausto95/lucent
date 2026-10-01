import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { IrBuilder } from "../../src/ir/build.ts";
import { type CppBackend, toCpp } from "../../src/ir/cpp.ts";
import { dump } from "../../src/ir/dump.ts";
import type {
  IrFunction,
  IrOp,
  IrRegion,
  RegionId,
  SourceSpan,
  TargetId,
  ValueId,
} from "../../src/ir/ir.ts";
import { IrVerifyError, verify } from "../../src/ir/verify.ts";
import { T, TypeRegistry } from "../../src/types.ts";

const FILE = "/app/control.lucent.ts";

/** A span on line 1 of the fixture file. */
function at(start: number): SourceSpan {
  return { file: FILE, start, end: start + 1, line: 1, column: start + 1 };
}

const WHOLE: SourceSpan = { file: FILE, start: 0, end: 1000, line: 1, column: 1 };

const reg = new TypeRegistry(ts.createProgram([], {}).getTypeChecker(), () => false);

const backend: CppBackend = {
  cppType: (t) => reg.cppType(t),
  cppRetType: (t) => reg.cppRetType(t),
  site: "control",
};

function printed(f: IrFunction): string {
  const out = toCpp(f, backend);

  return cpp.printDecls([cpp.fn(f.id, out.ret, out.params, out.body)]).replace(/^#line .*\n/gm, "");
}

function problemsOf(f: IrFunction): string[] {
  try {
    verify(f);
    return [];
  } catch (e) {
    if (e instanceof IrVerifyError) return e.problems;
    throw e;
  }
}

/** `f` with region `id`'s operations replaced. */
function withRegion(f: IrFunction, id: number, ops: (ops: IrOp[]) => IrOp[]): IrFunction {
  return {
    ...f,
    regions: f.regions.map((r) => (r.id === id ? { ...r, ops: ops([...r.ops]) } : r)),
  };
}

const v = (n: number) => n as ValueId;

const t = (n: number) => n as TargetId;

/**
 * `let sum = 0; for (let i = 1; i <= n; i++) sum += i; return sum;`,
 * the condition tested at the top of the body and the step in `next`.
 */
function sumTo(): IrFunction {
  const b = new IrBuilder("sumTo", T.number, WHOLE);
  const n = b.param(0, T.number, at(1));
  const zero = b.const(0, at(3));
  const sum = b.local("sum", T.number, at(2));

  b.store(sum, zero, at(2));

  const one = b.const(1, at(5));
  const i = b.local("i", T.number, at(4));

  b.store(i, one, at(4));
  b.loop(
    at(6),
    (loop) => {
      const done = b.unary("!", b.binary("<=", b.load(i, at(7)), n, at(7)), at(7));

      b.if(
        done,
        at(7),
        () => b.break(loop, at(7)),
        () => {},
      );
      b.store(sum, b.binary("+", b.load(sum, at(8)), b.load(i, at(8)), at(8)), at(8));
    },
    () => b.store(i, b.binary("+", b.load(i, at(9)), b.const(1, at(9)), at(9)), at(9)),
  );
  b.return(b.load(sum, at(10)), at(10));
  return b.finish();
}

/** `return x > 0 ? "up" : "down";`: an if giving a result. */
function pick(): IrFunction {
  const b = new IrBuilder("pick", T.string, WHOLE);
  const x = b.param(0, T.number, at(1));
  const up = b.binary(">", x, b.const(0, at(2)), at(2));
  const r = b.if(
    up,
    at(3),
    () => b.yield(b.const("up", at(4)), at(4)),
    () => b.yield(b.const("down", at(5)), at(5)),
    T.string,
  );

  b.return(r, at(6));
  return b.finish();
}

/** Two nested loops: `continue outer` and `break outer` from the inner one, and a labeled block. */
function nested(): IrFunction {
  const b = new IrBuilder("nested", T.void, WHOLE);
  const flag = b.param(0, T.boolean, at(1));

  b.loop(at(2), (outer) => {
    b.loop(at(3), () => {
      b.if(
        flag,
        at(4),
        () => b.continue(outer, at(4)),
        () => b.break(outer, at(5)),
      );
    });
  });
  b.block(
    at(6),
    (section) => {
      b.if(
        flag,
        at(7),
        () => b.break(section!, at(7)),
        () => {},
      );
      b.call({ kind: "function", id: "work" }, [], undefined, { throws: "unknown" }, at(8));
    },
    true,
  );
  return b.finish();
}

describe("structured control flow in the IR", () => {
  it("accepts loops, branches with results and jumps to enclosing targets", () => {
    expect(problemsOf(sumTo())).toEqual([]);

    expect(problemsOf(pick())).toEqual([]);

    expect(problemsOf(nested())).toEqual([]);
  });

  it("dumps regions nested under the operations that own them", () => {
    expect(dump(pick()).split("\n").slice(2)).toEqual([
      "  r0:",
      "    v0 = param 0 : number  @1:2",
      "    v1 = const 0 : number  @1:3",
      "    v2 = v0 > v1 : boolean  @1:3",
      "    v5 = if v2 then r1 else r2 : string  @1:4",
      "      r1:",
      '        v3 = const "up" : string  @1:5',
      "        yield v3  @1:5",
      "      r2:",
      '        v4 = const "down" : string  @1:6',
      "        yield v4  @1:6",
      "    return v5  @1:7",
      "",
    ]);

    expect(dump(nested())).toContain(
      [
        "    loop t0 body r1  @1:3",
        "      r1:",
        "        loop t1 body r2  @1:4",
        "          r2:",
        "            if v0 then r3 else r4  @1:5",
        "              r3:",
        "                continue t0  @1:5",
        "              r4:",
        "                break t0  @1:6",
        "    block t2 r5  @1:7",
      ].join("\n"),
    );
  });

  it("rejects a value used outside the region that defines it", () => {
    const f = withRegion(sumTo(), 0, (ops) => {
      const ret = ops.pop()!;

      return [...ops, { ...ret, value: v(4) } as IrOp];
    });

    expect(problemsOf(f)).toContain("r0[9] return uses v4 outside the region that defines it");
  });

  it("rejects a local used outside the region that declares it", () => {
    const b = new IrBuilder("scoped", T.number, WHOLE);
    let inner = 0;

    b.block(at(1), () => {
      const x = b.local("x", T.number, at(2));

      inner = x;
      b.store(x, b.const(1, at(3)), at(3));
    });
    b.return(b.load(inner as never, at(4)), at(4));

    expect(problemsOf(b.finish())).toContain("r0[1] load uses p0, which is not declared before it");
  });

  it("rejects jumps to targets that do not enclose them, or that they cannot continue", () => {
    const f = nested();
    const sibling = withRegion(f, 5, (ops) => [
      ...ops.slice(0, -1),
      { kind: "break", target: t(0), source: at(8) },
    ]);
    const continueBlock = withRegion(f, 6, () => [
      { kind: "continue", target: t(2), source: at(7) },
    ]);
    const unknown = withRegion(f, 3, () => [{ kind: "break", target: t(9), source: at(4) }]);
    const inNext = withRegion(sumTo(), 2, (ops) => [
      ...ops,
      { kind: "continue", target: t(0), source: at(9) },
    ]);

    expect(problemsOf(sibling)).toContain("r5[1] break jumps to t0, which does not enclose it");

    expect(problemsOf(continueBlock)).toContain("r6[0] continue continues t2, which is not a loop");

    expect(problemsOf(unknown)).toContain("r3[0] break jumps to t9, which does not enclose it");

    expect(problemsOf(inNext)).toContain("r2[4] continue continues t0 from its own next region");
  });

  it("rejects branches that give no result, or another type, and stray yields", () => {
    const f = pick();
    const fallsOff = withRegion(f, 1, (ops) => ops.slice(0, -1));
    const mistyped = withRegion(f, 2, (ops) => [
      ...ops.slice(0, -1),
      { kind: "yield", value: v(2), source: at(5) },
    ]);
    const stray = withRegion(sumTo(), 4, () => [{ kind: "yield", source: at(7) }]);
    const outside = withRegion(f, 0, (ops) => [
      ...ops.slice(0, -1),
      { kind: "yield", value: v(5), source: at(7) },
    ]);

    expect(problemsOf(fallsOff)).toContain("r1 can end without giving the if's string result");

    expect(problemsOf(mistyped)).toContain("r2[1] yield: v2 is boolean, expected string");

    expect(problemsOf(stray)).toContain("r4[0] yield is not in a branch of an if giving a result");

    expect(problemsOf(outside)).toContain(
      "r0[4] yield is not in a branch of an if giving a result",
    );
  });

  it("rejects conditions that are not booleans, and regions owned twice or by another parent", () => {
    const f = pick();
    const numeric = withRegion(f, 0, (ops) =>
      ops.map((op) => (op.kind === "if" ? { ...op, cond: v(0) } : op)),
    );
    const twice = withRegion(f, 0, (ops) =>
      ops.map((op) => (op.kind === "if" ? { ...op, whenFalse: op.whenTrue } : op)),
    );
    const moved = {
      ...f,
      regions: f.regions.map((r): IrRegion => (r.id === 2 ? { ...r, parent: 1 as RegionId } : r)),
    };

    expect(problemsOf(numeric)).toContain("r0[3] if: v0 is number, expected boolean");

    expect(problemsOf(twice)).toContain("r1 is owned by two operations");

    expect(problemsOf(moved)).toContain("r2 has parent r1, but r0[3] if owns it");
  });

  it("knows which bodies can end without a result", () => {
    const forever = new IrBuilder("forever", T.number, WHOLE);

    forever.loop(at(1), () => {
      forever.call({ kind: "function", id: "work" }, [], undefined, { throws: "unknown" }, at(2));
    });

    const both = new IrBuilder("both", T.number, WHOLE);
    const c = both.param(0, T.boolean, at(1));

    both.if(
      c,
      at(2),
      () => both.return(both.const(1, at(3)), at(3)),
      () => both.return(both.const(2, at(4)), at(4)),
    );

    const escapes = new IrBuilder("escapes", T.number, WHOLE);

    escapes.loop(at(1), (loop) => escapes.break(loop, at(2)));

    // The branches' yields give the if's result: the body goes on after it.
    const chosen = new IrBuilder("chosen", T.number, WHOLE);
    const flag = chosen.param(0, T.boolean, at(1));

    chosen.if(
      flag,
      at(2),
      () => chosen.yield(chosen.const(1, at(3)), at(3)),
      () => chosen.yield(chosen.const(2, at(4)), at(4)),
      T.number,
    );

    expect(problemsOf(forever.finish())).toEqual([]);

    expect(problemsOf(both.finish())).toEqual([]);

    expect(problemsOf(escapes.finish())).toContain("the body can end without giving a number");

    expect(problemsOf(chosen.finish())).toContain("the body can end without giving a number");
  });
});

describe("structured control flow in C++", () => {
  it("runs a loop's next region after its body, and breaks out of the innermost loop directly", () => {
    expect(printed(sumTo())).toBe(
      [
        "double sumTo(double p0_) {",
        "  double sum = 0.0;",
        "  double i = 1.0;",
        "  while (true) {",
        "    {",
        "      bool v5_ = !(i <= p0_);",
        "      if (v5_) {",
        "        break;",
        "      }",
        "      sum = sum + i;",
        "    }",
        "    i = i + 1.0;",
        "  }",
        "  return sum;",
        "}",
      ].join("\n"),
    );
  });

  it("assigns an if's result in each branch", () => {
    expect(printed(pick())).toBe(
      [
        "lucent::String pick(double p0_) {",
        "  bool v2_ = p0_ > 0.0;",
        "  lucent::String v5_{};",
        "  if (v2_) {",
        '    v5_ = LUCENT_STR("up");',
        "  } else {",
        '    v5_ = LUCENT_STR("down");',
        "  }",
        "  return v5_;",
        "}",
      ].join("\n"),
    );
  });

  it("gives no variable to the result of an if inside one whose result is unused", () => {
    // `a ? (b ? 1 : 2) : 3;` as a statement.
    const b = new IrBuilder("unused", T.void, WHOLE);
    const [outer, inner] = [b.param(0, T.boolean, at(1)), b.param(1, T.boolean, at(1))];

    b.if(
      outer,
      at(2),
      () => {
        const nested = b.if(
          inner,
          at(3),
          () => b.yield(b.const(1, at(3)), at(3)),
          () => b.yield(b.const(2, at(3)), at(3)),
          T.number,
        );

        b.yield(nested, at(3));
      },
      () => b.yield(b.const(3, at(4)), at(4)),
      T.number,
    );

    expect(printed(b.finish())).toBe(
      [
        "void unused(bool p0_, bool p1_) {",
        "  if (p0_) {",
        "    if (p1_) {",
        "    }",
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("jumps out of or around nested loops and labeled blocks with labels", () => {
    expect(printed(nested())).toBe(
      [
        "void nested(bool p0_) {",
        "  while (true) {",
        "    {",
        "      while (true) {",
        "        if (p0_) {",
        "          goto cont0_;",
        "        } else {",
        "          goto brk0_;",
        "        }",
        "      }",
        "    }",
        "    cont0_:;",
        "  }",
        "  brk0_:;",
        "  {",
        "    if (p0_) {",
        "      goto brk2_;",
        "    }",
        "    work();",
        "  }",
        "  brk2_:;",
        "}",
      ].join("\n"),
    );
  });
});
