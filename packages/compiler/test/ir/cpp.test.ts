import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { IrBuilder } from "../../src/ir/build.ts";
import { type CppBackend, toCpp } from "../../src/ir/cpp.ts";
import type { EffectRef, IrFunction, SourceSpan } from "../../src/ir/ir.ts";
import { IrVerifyError } from "../../src/ir/verify.ts";
import { type LType, T, TypeRegistry } from "../../src/types.ts";

const FILE = "/app/order.lucent.ts";

function at(start: number, line = 1): SourceSpan {
  return { file: FILE, start, end: start + 1, line, column: 1 };
}

const reg = new TypeRegistry(ts.createProgram([], {}).getTypeChecker(), () => false);

/** What the compiler passes: its type representation. */
const backend: CppBackend = {
  cppType: (t) => reg.cppType(t),
  cppRetType: (t) => reg.cppRetType(t),
  site: "pair",
};

const UNKNOWN: EffectRef = { throws: "unknown" };

const fn = (id: string) => ({ kind: "function", id }) as const;

/** The function's C++, without the `#line N` the printer repeats on each line (codegen's tests check those). */
function printed(f: IrFunction): string {
  const out = toCpp(f, backend);

  return cpp
    .printDecls([cpp.fn(f.id, out.ret, out.params, out.body)])
    .split("\n")
    .filter((l) => !/^#line \d+$/.test(l))
    .join("\n");
}

/** `return combine(next("l"), next("r"))`, over three lines. */
function pair(): IrFunction {
  const b = new IrBuilder("pair", T.string, { file: FILE, start: 0, end: 100, line: 1, column: 1 });
  const first = b.call(fn("next"), [b.const("l", at(10, 2))], T.string, UNKNOWN, at(5, 2));
  const second = b.call(fn("next"), [b.const("r", at(20, 3))], T.string, UNKNOWN, at(15, 3));
  const both = b.call(fn("combine"), [first!, second!], T.string, UNKNOWN, at(30, 4));

  b.return(both, at(40, 4));
  return b.finish();
}

/** Every call to a function of the program is the whole expression of its own statement. */
function nestedCalls(stmts: cpp.Stmt[], callees: string[]): string[] {
  const found: string[] = [];
  const visit = (e: unknown, top: boolean): void => {
    if (!e || typeof e !== "object") return;

    const node = e as { k?: string; callee?: { k?: string; name?: string } };

    if (node.k === "call" && node.callee?.k === "id" && callees.includes(node.callee.name!) && !top)
      found.push(node.callee.name!);

    for (const [key, child] of Object.entries(e))
      if (key !== "callee") for (const c of [child].flat()) visit(c, false);
  };

  for (const s of stmts) {
    const root = s.k === "var" ? s.init : s.k === "expr" ? s.expr : s.k === "return" ? s.value : s;
    const bare = root && root.k === "cast" ? root.operand : root;

    if (bare?.k === "call") for (const a of bare.args) visit(a, false);
    else visit(bare, false);
  }

  return found;
}

describe("IR to C++", () => {
  it("emits each call as its own statement, in the IR's order", () => {
    const out = printed(pair());

    expect(out).toBe(
      [
        "lucent::String pair() {",
        '#line 2 "/app/order.lucent.ts"',
        '  lucent::String v1_ = next(LUCENT_STR("l"));',
        '#line 3 "/app/order.lucent.ts"',
        '  lucent::String v3_ = next(LUCENT_STR("r"));',
        '#line 4 "/app/order.lucent.ts"',
        "  return combine(v1_, v3_);",
        "}",
      ].join("\n"),
    );

    expect(nestedCalls(toCpp(pair(), backend).body, ["next", "combine"])).toEqual([]);
  });

  it("keeps JavaScript number semantics with the compiler's literals and runtime helpers", () => {
    const b = new IrBuilder("nums", T.boolean, {
      file: FILE,
      start: 0,
      end: 100,
      line: 1,
      column: 1,
    });
    const x = b.param(0, T.number, at(1));
    const nan = b.const(Number.NaN, at(2));
    const negZero = b.const(-0, at(3));
    const inf = b.const(Infinity, at(4));
    const tenth = b.const(0.1, at(5));
    const mod = b.binary("%", x, negZero, at(6));
    const pow = b.binary("**", mod, inf, at(7));
    const prod = b.binary("*", pow, tenth, at(8));
    const sum = b.binary("+", prod, nan, at(9));
    const neg = b.unary("-", sum, at(10));
    const same = b.binary("===", neg, x, at(11));
    const differ = b.binary("!==", neg, x, at(12));
    const both = b.binary("===", same, differ, at(13));

    b.return(both, at(14));

    expect(printed(b.finish())).toBe(
      [
        "bool nums(double p0_) {",
        '#line 1 "/app/order.lucent.ts"',
        "  double v9_ = -(lucent::jsPow(lucent::jsMod(p0_, -0.0), lucent::kInfinity) * 0.1 + lucent::kNaN);",
        "  bool v10_ = v9_ == p0_;",
        "  return v10_ == !(v9_ == p0_);",
        "}",
      ].join("\n"),
    );
  });

  it("concatenates strings as the legacy emitter does, converting with ToString", () => {
    const b = new IrBuilder("cat", T.string, {
      file: FILE,
      start: 0,
      end: 100,
      line: 1,
      column: 1,
    });
    const n = b.param(0, T.number, at(1));
    const s = b.unary("String", n, at(2));
    const joined = b.binary("+", b.const("n=", at(3)), s, at(4));

    b.return(joined, at(5));

    expect(printed(b.finish())).toContain(
      '  return lucent::String(LUCENT_STR("n=")) + lucent::toJsString(p0_);',
    );
  });

  it("snapshots a place when it is loaded, before a later call can change it", () => {
    const b = new IrBuilder("log", T.void, { file: FILE, start: 0, end: 100, line: 1, column: 1 });
    const log = b.modulePlace("lucent_app::m_order::log", "log", T.string, true);
    const before = b.load(log, at(1));
    const x = b.local("x", T.string, at(2));

    b.store(x, before, at(3));

    const tag = b.call(fn("next"), [b.const("a", at(4))], T.string, UNKNOWN, at(5));
    const joined = b.binary("+", b.load(x, at(6)), tag!, at(7));

    b.store(log, joined, at(8));
    b.call(fn("next"), [b.const("b", at(9))], T.string, UNKNOWN, at(10));

    expect(printed(b.finish())).toBe(
      [
        "void log() {",
        '#line 1 "/app/order.lucent.ts"',
        "  lucent::String v0_ = lucent_app::m_order::log;",
        "  lucent::String x = std::move(v0_);",
        '  lucent::String v2_ = next(LUCENT_STR("a"));',
        // `x` is read where it is used: no call between can change a local.
        "  lucent_app::m_order::log = lucent::String(x) + v2_;",
        '  (void)next(LUCENT_STR("b"));',
        "}",
      ].join("\n"),
    );
  });

  it("throws Errors built with their site, and declares locals that start empty", () => {
    const b = new IrBuilder("boom", T.string, {
      file: FILE,
      start: 0,
      end: 100,
      line: 1,
      column: 1,
    });

    b.local("unused", T.number, at(1));

    const error = b.call(
      { kind: "builtin", name: "new TypeError" },
      [b.const("bad", at(2))],
      T.error,
      { throws: "no" },
      at(3),
    );

    b.throw(error!, at(4));

    expect(printed(b.finish())).toBe(
      [
        "lucent::String boom() {",
        '#line 1 "/app/order.lucent.ts"',
        "  double unused{};",
        '  lucent::Error v1_ = lucent::withSite(lucent::makeError(LUCENT_STR("TypeError"), LUCENT_STR("bad")), __FILE__, __LINE__, "pair");',
        "  lucent::throwError(v1_);",
        "}",
      ].join("\n"),
    );
  });

  it("computes bitwise operators, ToBoolean, typeof and absent tests with the runtime's helpers", () => {
    const maybe: LType = { k: "opt", inner: T.number };
    const b = new IrBuilder("ops", T.void, { file: FILE, start: 0, end: 100, line: 1, column: 1 });
    const x = b.param(0, T.number, at(1));
    const m = b.param(1, maybe, at(2));
    const and = b.binary("&", x, b.const(3, at(3)), at(3));
    const shifted = b.binary(">>>", and, b.const(1, at(4)), at(4));
    const inverted = b.unary("~", shifted, at(5));
    const truthy = b.unary("!!", m, at(6));
    const absent = b.binary("==", m, b.const(null, at(7)), at(7));
    const undef = b.binary("===", m, b.const(undefined, at(8)), at(8));
    const kind = b.unary("typeof", m, at(9));

    b.call(fn("use"), [inverted, truthy, absent, undef, kind], undefined, UNKNOWN, at(10));

    expect(printed(b.finish()).replace(/^#line .*\n/gm, "")).toBe(
      [
        "void ops(double p0_, lucent::Opt<double> p1_) {",
        // The int32 operators work on integer registers, read back as a double where one is needed.
        "  int32_t v6_ = ~static_cast<int32_t>(static_cast<uint32_t>(lucent::toInt32(p0_) & 3) >> (static_cast<uint32_t>(1) & 31u));",
        "  bool v7_ = lucent::truthy(p1_);",
        "  bool v9_ = !p1_.has();",
        "  bool v11_ = lucent::strictEquals(p1_, lucent::undefined);",
        "  use(static_cast<double>(v6_), v7_, v9_, v11_, lucent::typeOf(p1_));",
        "}",
      ].join("\n"),
    );
  });

  it("converts between optionals and unions as the legacy emitter does", () => {
    const u: LType = { k: "union", ms: [T.number, T.string] };
    const maybe: LType = { k: "opt", inner: u };
    const b = new IrBuilder("conv", T.void, { file: FILE, start: 0, end: 100, line: 1, column: 1 });
    const n = b.param(0, T.number, at(1));
    const m = b.param(1, maybe, at(2));
    const wrapped = b.convert(n, maybe, at(3));
    const held = b.convert(m, T.string, at(4));

    b.call(fn("use"), [wrapped, held], undefined, UNKNOWN, at(5));

    expect(printed(b.finish())).toContain(
      [
        "  lucent::Opt<std::variant<double, lucent::String>> v2_ = lucent::Opt<std::variant<double, lucent::String>>(std::variant<double, lucent::String>(p0_));",
        "  use(v2_, lucent::narrow<lucent::String>(p1_.value()));",
      ].join("\n"),
    );
  });

  it("generates nothing from invalid IR", () => {
    const bad = { ...pair(), result: T.number };

    expect(() => toCpp(bad, backend)).toThrow(IrVerifyError);
  });
});

describe("IR to C++ for bigints", () => {
  it("spells bigint constants and operators with the runtime's BigInt", () => {
    const big: LType = { k: "bigint" } as LType;
    const b = new IrBuilder("big", big, { file: FILE, start: 0, end: 100, line: 1, column: 1 });
    const x = b.param(0, big, at(1));
    const small = b.const(-5n, at(2));
    const large = b.const(2n ** 64n, at(3));
    const mod = b.binary("%", x, small, at(4));
    const pow = b.binary("**", mod, large, at(5));
    const shifted = b.binary("<<", pow, b.const(3n, at(6)), at(6));
    const masked = b.binary("^", shifted, b.unary("~", x, at(7)), at(7));

    b.return(masked, at(8));

    expect(printed(b.finish()).replace(/^#line .*\n/gm, "")).toBe(
      [
        "lucent::BigInt big(lucent::BigInt p0_) {",
        '  lucent::BigInt v6_ = lucent::BigInt::pow(p0_ % lucent::BigInt::fromInt64(-5), LUCENT_BIGINT("18446744073709551616")) << lucent::BigInt::fromInt64(3);',
        "  return v6_ ^ ~p0_;",
        "}",
      ].join("\n"),
    );
  });
});
