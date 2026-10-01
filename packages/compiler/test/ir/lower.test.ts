import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { dump } from "../../src/ir/dump.ts";
import { type IrFunction, type RegionId, regionsOf } from "../../src/ir/ir.ts";
import { IrUnsupported, lower, type LowerHost } from "../../src/ir/lower.ts";
import { createLucentProgram } from "../../src/program.ts";
import { type LType, TypeRegistry } from "../../src/types.ts";
import { cppOf, module } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

const ORDER = path.join(CASES, "order.lucent.ts");

const CONTROL = path.join(CASES, "control-flow.lucent.ts");

/** Lowers function `name` of `file` with a host over the checker alone. */
function lowered(file: string, name: string) {
  const lp = createLucentProgram([file]);
  const sf = lp.modules[0]!.sourceFile;
  const checker = lp.checker;
  const reg = new TypeRegistry(checker, (s) => s === sf);
  const fns = sf.statements.filter(ts.isFunctionDeclaration);
  const signature = (d: ts.FunctionDeclaration) =>
    reg.lowerSignature(checker.getSignatureFromDeclaration(d)!, d) as LType & { k: "fn" };
  const host: LowerHost = {
    checker,
    typeAt: (n) => reg.lower(checker.getTypeAtLocation(n), n),
    typeOf: (s, at) => reg.lower(checker.getTypeOfSymbolAtLocation(s, at), at),
    global: (s) => {
      const d = s.valueDeclaration;

      if (d && ts.isFunctionDeclaration(d)) {
        const t = signature(d);

        return {
          kind: "function",
          id: d.name!.text,
          params: t.params,
          result: t.ret,
          callable: true,
        };
      }

      if (d && ts.isVariableDeclaration(d) && d.parent.parent.parent === sf)
        return {
          kind: "var",
          id: `m::${d.name.getText()}`,
          name: d.name.getText(),
          type: reg.lower(checker.getTypeOfSymbolAtLocation(s, d), d),
          mutable: !(d.parent.flags & ts.NodeFlags.Const),
        };

      return undefined;
    },
  };
  const decl = fns.find((d) => d.name!.text === name)!;
  const t = signature(decl);

  return lower(
    { decl, id: name, params: t.params, result: t.ret, async: false, generic: false },
    host,
  );
}

/**
 * The operations of `fn` as a tree: operators by their symbol, calls by
 * their callee, and an operation owning regions as `{ kind: [regions] }`.
 */
function tree(fn: IrFunction, region: RegionId = fn.body): unknown[] {
  return fn.regions[region]!.ops.map((op) => {
    const name =
      op.kind === "call" && op.callee.kind === "function"
        ? `call ${op.callee.id}`
        : op.kind === "unary" || op.kind === "binary"
          ? op.op
          : op.kind === "convert"
            ? `convert ${op.to.k}`
            : op.kind;
    const owned = regionsOf(op);

    return owned.length ? { [name]: owned.map((r) => tree(fn, r)) } : name;
  });
}

const kinds = (file: string, name: string) =>
  lowered(file, name).fn.regions[0]!.ops.map((op) =>
    op.kind === "call" && op.callee.kind === "function" ? `call ${op.callee.id}` : op.kind,
  );

describe("lowering to the IR", () => {
  it("lowers combine(next(l), next(r)) to three calls in order", () => {
    const text = dump(lowered(ORDER, "pair").fn);

    expect(text.split("\n").slice(2)).toEqual([
      "  r0:",
      '    v0 = const "l" : string  @32:23',
      "    v1 = call next(v0) throws=unknown : string  @32:18",
      '    v2 = const "r" : string  @32:34',
      "    v3 = call next(v2) throws=unknown : string  @32:29",
      "    v4 = call combine(v1, v3) throws=unknown : string  @32:10",
      "    return v4  @32:3",
      "",
    ]);
  });

  it("keeps the first call first when it throws", () => {
    expect(kinds(ORDER, "firstThrows")).toEqual([
      "const",
      "call fail",
      "const",
      "call next",
      "call combine",
      "return",
    ]);

    expect(kinds(ORDER, "fail")).toEqual([
      "param",
      "load",
      "binary",
      "const",
      "binary",
      "store",
      "const",
      "binary",
      "call",
      "throw",
    ]);
  });

  it("reads a variable before the right side of a compound assignment runs", () => {
    const file = module(
      'let log = "";\n' +
        "function next(t: string): string { log = log + t; return t; }\n" +
        'export function f(): void { log += next("x"); }\n',
    );

    expect(kinds(file, "f")).toEqual(["load", "const", "call next", "binary", "store"]);
  });

  it("knows the signatures of the functions it calls", () => {
    const { signatures } = lowered(ORDER, "pair");

    expect([...signatures.keys()].sort()).toEqual(["combine", "next"]);
  });

  it("does not lower what it does not support yet", () => {
    const file = module("export function first(xs: number[]): number { return xs.length; }\n");

    // Without the emitter's leaves, a member read is beyond the IR alone.
    expect(() => lowered(file, "first")).toThrow(IrUnsupported);

    expect(() => lowered(file, "first")).toThrow(
      /does not lower PropertyAccessExpression expressions yet .*:1:54/,
    );
  });
});

describe("lowering control flow to the IR", () => {
  it("lowers if/else chains to ifs owning their branches", () => {
    expect(tree(lowered(CONTROL, "sign").fn)).toEqual([
      "param",
      "const",
      ">",
      {
        if: [
          ["const", "return"],
          [
            "const",
            "<",
            {
              if: [
                ["const", "return"],
                ["const", "===", { if: [["const", "return"], []] }],
              ],
            },
          ],
        ],
      },
      "const",
      "return",
    ]);
  });

  it("tests loop conditions at the top of the body, and runs steps and do-while tests in next", () => {
    const whileLoop = tree(lowered(CONTROL, "sumTo").fn);
    const forLoop = tree(lowered(CONTROL, "oddsBelow").fn);
    const doLoop = tree(lowered(CONTROL, "countdown").fn);

    expect(whileLoop[7]).toEqual({
      loop: [
        [
          "load",
          "<=",
          "!",
          { if: [["break"], []] },
          "load",
          "load",
          "+",
          "store",
          "load",
          "const",
          "+",
          "store",
        ],
      ],
    });

    expect(forLoop[4]).toEqual({
      block: [
        [
          "const",
          "local",
          "store",
          {
            loop: [
              [
                "load",
                "<",
                "!",
                { if: [["break"], []] },
                "load",
                "const",
                "%",
                "const",
                "===",
                { if: [["continue"], []] },
                "load",
                "load",
                "String",
                "const",
                "+",
                "+",
                "store",
              ],
              ["load", "const", "+", "store"],
            ],
          },
        ],
      ],
    });

    expect(doLoop[6]).toMatchObject({
      loop: [expect.any(Array), ["load", "const", ">", "!", { if: [["break"], []] }]],
    });
  });

  it("names the loop or block a labeled jump leaves", () => {
    const text = dump(lowered(CONTROL, "pairs").fn);

    expect(text).toMatch(/loop t0 body r\d+ next r\d+[^]*loop t1 body[^]*continue t0[^]*break t0/);

    expect(dump(lowered(CONTROL, "skipBlock").fn)).toMatch(/block t0 r1[^]*break t0/);
  });

  it("evaluates && and || operands only as far as JavaScript does, giving an operand", () => {
    const text = dump(lowered(CONTROL, "conditions").fn);

    expect(text).toMatch(
      /call check\(v\d+, v\d+\)[^]*= if v\d+ then r\d+ else r\d+ : boolean[^]*call check/,
    );
  });

  it("narrows optionals and unions where the checker does, and tests truthiness", () => {
    const optionals = dump(lowered(CONTROL, "optionals").fn);
    const kindsOf = dump(lowered(CONTROL, "kinds").fn);

    expect(optionals).toMatch(/v\d+ = v0 !== v\d+ : boolean/);

    expect(optionals).toMatch(/v\d+ = convert v0 : number/);

    expect(kindsOf).toMatch(/v\d+ = typeof v0 : string/);

    expect(kindsOf).toMatch(/v\d+ = convert v0 : string/);

    expect(dump(lowered(CONTROL, "truthy").fn)).toMatch(/v\d+ = !! v0 : boolean/);
  });

  it("copies parameters the body assigns into locals", () => {
    expect(tree(lowered(CONTROL, "reassign").fn).slice(0, 6)).toEqual([
      "param",
      "param",
      "local",
      "store",
      "local",
      "store",
    ]);
  });

  it("lowers switch to the matching clause's index, then the clauses from it on", () => {
    const [, , , , block] = tree(lowered(CONTROL, "grade").fn) as { block: unknown[][] }[];
    const body = block!.block[0]!;

    expect(body.slice(0, 4)).toEqual([
      "call tens",
      "const",
      "===",
      { if: [["const", "yield"], expect.any(Array)] },
    ]);

    // One test per clause with statements (`case 10:` has none) but the
    // default, the last clause: whichever clause matches, it runs.
    expect(body.filter((op) => op === "<=")).toHaveLength(4);
  });

  it("returns from a switch whose clauses all return, and leaves one without a default", () => {
    const file = path.join(CASES, "switch-returns.lucent.ts");

    // The last clause runs untested, so the switch's own region returns.
    for (const name of ["size", "rank", "weekday", "steps", "sign"]) {
      const switched = tree(lowered(file, name).fn).find(
        (op): op is { block: unknown[][] } => typeof op === "object" && "block" in op!,
      );

      expect(switched?.block[0]).toContain("return");
    }

    // TypeScript knows the cases cover the union: the end of the body is unreachable.
    expect(tree(lowered(file, "weight").fn).at(-1)).toBe("unreachable");
  });

  it("leaves statements after a return out", () => {
    const file = module(
      "export function f(): number { return 1; f(); }\n" +
        "export function g(x: number): number { while (true) { return x; x++; } }\n",
    );

    expect(tree(lowered(file, "f").fn)).toEqual(["const", "return"]);

    expect(tree(lowered(file, "g").fn)).toEqual([
      "param",
      "local",
      "store",
      { loop: [["load", "return"]] },
    ]);
  });

  it("compiles the control-flow case without a diagnostic", () => {
    const out = cppOf(CONTROL);

    expect(out).toContain("while (true) {");

    expect(out).not.toMatch(/\(\{/);
  });
});

describe("compiling through the IR", () => {
  it("compiles the ordering case, each call a statement of its own", () => {
    const out = cppOf(ORDER);

    expect(out).toContain(
      [
        "lucent::String m_order::pair() {",
        '  lucent::String v1_ = lucent_app::m_order::next(LUCENT_STR("l"));',
        '  lucent::String v3_ = lucent_app::m_order::next(LUCENT_STR("r"));',
        "  return lucent_app::m_order::combine(v1_, v3_);",
        "}",
      ].join("\n"),
    );

    expect(out).not.toMatch(/\(\{/);
  });

  it("reports what Lucent rejects with its diagnostics", () => {
    const file = module(
      [
        "class R { [Symbol.dispose](): void {} }",
        "export function f(n: number): number {",
        "  switch (n) {",
        "    case 1:",
        "      using r = new R();",
        "      return 1;",
        "  }",
        "  return 0;",
        "}",
        "export function g(): void { throw 1; }",
        "export async function h(xs: number[]): Promise<number> {",
        "  for await (const x of xs) return x;",
        "  return 0;",
        "}",
        "export function k(): number { var x = 1; return x; }",
        "",
      ].join("\n"),
    );
    const found = compile([file]).diagnostics.map((d) => [d.code, d.message]);

    expect(found).toEqual([
      ["LUCENT1001", "wrap a using declaration in a case clause in a block"],
      ["LUCENT1006", "only Error values can be thrown; use `throw new Error(...)`"],
      ["LUCENT1009", "`for await` is not supported"],
      ["LUCENT1001", "use `let` or `const` instead of `var`"],
    ]);
  });
});

describe("lowering bigints", () => {
  const file = () =>
    module(
      "export function f(a: bigint, b: bigint): bigint {\n" +
        "  let x = a * b + 18446744073709551616n;\n" +
        "  x += a ** 3n;\n" +
        "  x = -x % b;\n" +
        "  return x & ~a;\n" +
        "}\n" +
        "export function g(a: bigint, b: bigint, n: number): string {\n" +
        "  if (a && a === b) return `${a >> 1n}`;\n" +
        "  return a < n ? typeof a : `${a <= b}`;\n" +
        "}\n",
    );

  it("lowers literals, operators, comparisons and conversions of bigints", () => {
    expect(tree(lowered(file(), "f").fn)).toEqual([
      "param",
      "param",
      "*",
      "const",
      "+",
      "local",
      "store",
      "load",
      "const",
      "**",
      "+",
      "store",
      "load",
      "-",
      "%",
      "store",
      "load",
      "~",
      "&",
      "return",
    ]);
  });

  it("compiles bigint functions without a diagnostic", () => {
    const out = cppOf(file());

    expect(out).toContain('LUCENT_BIGINT("18446744073709551616")');

    expect(out).toContain("lucent::BigInt::pow(");

    expect(out).toContain("lucent::BigInt::fromInt64(3)");

    expect(out).toContain("p0_ * p1_");

    expect(out).toContain("p0_ < p2_");

    expect(out).toContain("p0_ == p1_");

    expect(out).toMatch(/lucent::truthy\(p0_\)/);

    expect(out).not.toContain("lucent::jsMod");

    expect(out).not.toContain("lucent::jsAnd");
  });
});
