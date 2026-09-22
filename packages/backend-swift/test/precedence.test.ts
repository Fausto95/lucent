import { describe, expect, test } from "vite-plus/test";
import { printExpr, type SwiftExpr } from "../src/ast.ts";

const n = (text: string): SwiftExpr => ({ k: "lit", text });
const bin = (op: "+" | "-" | "*" | "/" | "&&" | "||" | "<" | "==", left: SwiftExpr, right: SwiftExpr): SwiftExpr => ({
  k: "binary",
  op,
  left,
  right,
});

describe("parenthesisation", () => {
  test("drops parentheses a tighter child does not need", () => {
    expect(printExpr(bin("+", n("a"), bin("*", n("b"), n("c"))))).toBe("a + b * c");
  });

  test("keeps parentheses a looser child does need", () => {
    expect(printExpr(bin("*", bin("+", n("a"), n("b")), n("c")))).toBe("(a + b) * c");
  });

  /**
   * The regression: `/` and `*` share a precedence and associate left, so an
   * unparenthesised right operand silently re-associates. This compiles, runs,
   * and returns the wrong number.
   */
  test("parenthesises an equal-precedence right operand of a left-associative operator", () => {
    expect(printExpr(bin("/", n("total"), bin("*", n("columns"), n("rows"))))).toBe("total / (columns * rows)");
  });

  test("leaves an equal-precedence left operand alone", () => {
    expect(printExpr(bin("/", bin("*", n("a"), n("b")), n("c")))).toBe("a * b / c");
  });

  test("parenthesises subtraction on the right of subtraction", () => {
    expect(printExpr(bin("-", n("a"), bin("-", n("b"), n("c"))))).toBe("a - (b - c)");
  });

  test("orders the logical operators", () => {
    expect(printExpr(bin("||", bin("&&", n("a"), n("b")), n("c")))).toBe("a && b || c");
    expect(printExpr(bin("&&", bin("||", n("a"), n("b")), n("c")))).toBe("(a || b) && c");
  });

  test("parenthesises a comparison nested in a comparison", () => {
    expect(printExpr(bin("==", bin("<", n("a"), n("b")), n("c")))).toBe("(a < b) == c");
  });

  test("parenthesises a ternary used as an operand", () => {
    const t: SwiftExpr = { k: "ternary", cond: n("flag"), consequent: n("1"), alternate: n("2") };
    expect(printExpr(bin("+", t, n("3")))).toBe("(flag ? 1 : 2) + 3");
  });
});
