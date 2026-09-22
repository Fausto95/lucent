import { describe, expect, test } from "vite-plus/test";
import { printExpr, type KotlinExpr } from "../src/ast.ts";

const n = (text: string): KotlinExpr => ({ k: "lit", text });
const toByte = (value: KotlinExpr): KotlinExpr => ({
  k: "call",
  callee: { k: "member", target: value, name: "toByte" },
  args: [],
});
const bin = (
  op: "+" | "-" | "*" | "/" | "%" | "&&" | "||" | "<" | "==",
  left: KotlinExpr,
  right: KotlinExpr,
): KotlinExpr => ({
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

  test("parenthesises an equal-precedence right operand", () => {
    expect(printExpr(bin("/", n("total"), bin("*", n("columns"), n("rows"))))).toBe("total / (columns * rows)");
    expect(printExpr(bin("-", n("a"), bin("-", n("b"), n("c"))))).toBe("a - (b - c)");
  });

  test("leaves an equal-precedence left operand alone", () => {
    expect(printExpr(bin("/", bin("*", n("a"), n("b")), n("c")))).toBe("a * b / c");
  });

  /**
   * Kotlin ranks comparison above equality, so this needs no parentheses —
   * Swift puts both in one non-associative group and does. The two printers
   * disagree here, which is why the trees are not shared.
   */
  test("ranks comparison above equality", () => {
    expect(printExpr(bin("==", bin("<", n("a"), n("b")), n("c")))).toBe("a < b == c");
    expect(printExpr(bin("<", bin("==", n("a"), n("b")), n("c")))).toBe("(a == b) < c");
  });

  test("orders the logical operators", () => {
    expect(printExpr(bin("||", bin("&&", n("a"), n("b")), n("c")))).toBe("a && b || c");
    expect(printExpr(bin("&&", bin("||", n("a"), n("b")), n("c")))).toBe("(a || b) && c");
  });

  /**
   * `-128.toByte()` is `-(128.toByte())` — a negated Byte, not the Byte -128.
   * The sign has to stay inside the parentheses.
   */
  test("parenthesises a signed receiver of a postfix call", () => {
    expect(printExpr(toByte(n("-128")))).toBe("(-128).toByte()");
    expect(printExpr(toByte(n("128")))).toBe("128.toByte()");
    expect(printExpr(toByte({ k: "unary", op: "-", value: { k: "ref", name: "a" } }))).toBe("(-a).toByte()");
    expect(printExpr(toByte(bin("+", n("a"), n("b"))))).toBe("(a + b).toByte()");
  });

  test("parenthesises an if-expression used as an operand", () => {
    const branch: KotlinExpr = { k: "ifExpr", cond: n("flag"), consequent: n("1"), alternate: n("2") };
    expect(printExpr(bin("+", branch, n("3")))).toBe("(if (flag) 1 else 2) + 3");
  });
});
