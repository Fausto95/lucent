/** Constructors for Kotlin syntax trees. */
import type { Arg, BinaryOp, Expr, Member, Param, Stmt, Type } from "./ast.ts";

// --- types -----------------------------------------------------------------------------

export const type = (name: string, ...args: Type[]): Type =>
  args.length ? { k: "named", name, args } : { k: "named", name };

export const nullable = (of: Type): Type => ({ k: "nullable", of });

export const fn = (params: Type[], ret: Type, options: { suspend?: boolean } = {}): Type => ({
  k: "function",
  params,
  ret,
  ...(options.suspend ? { suspend: true } : {}),
});

export const star: Type = { k: "star" };

// --- expressions -----------------------------------------------------------------------

export const name = (n: string): Expr => ({ k: "name", name: n });
export const num = (text: string | number): Expr => ({ k: "number", text: String(text) });
export const str = (value: string): Expr => ({ k: "string", value });
export const bool = (value: boolean): Expr => ({ k: "bool", value });
export const nullLit: Expr = { k: "null" };
export const thisExpr: Expr = { k: "this" };

export const member = (object: Expr, n: string): Expr => ({ k: "member", object, name: n });
export const safeMember = (object: Expr, n: string): Expr => ({
  k: "member",
  object,
  name: n,
  safe: true,
});
export const index = (object: Expr, i: Expr): Expr => ({ k: "index", object, index: i });

export const call = (callee: Expr, args: Arg[], trailing?: Expr, typeArgs?: Type[]): Expr => ({
  k: "call",
  callee,
  args,
  ...(typeArgs?.length ? { typeArgs } : {}),
  ...(trailing ? { trailing: trailing as Expr & { k: "lambda" } } : {}),
});

export const lambda = (params: string[], body: Stmt[]): Expr => ({ k: "lambda", params, body });

export const objectExpr = (supertypes: Type[], members: Member[]): Expr => ({
  k: "object",
  supertypes,
  members,
});

export const cast = (value: Expr, t: Type, safe = false): Expr => ({
  k: "cast",
  value,
  type: t,
  ...(safe ? { safe: true } : {}),
});
export const isType = (value: Expr, t: Type, negated = false): Expr => ({
  k: "is",
  value,
  type: t,
  ...(negated ? { negated: true } : {}),
});
export const notNull = (value: Expr): Expr => ({ k: "notNull", value });
export const not = (value: Expr): Expr => ({ k: "not", value });
export const elvis = (left: Expr, right: Expr): Expr => ({ k: "elvis", left, right });
export const binary = (left: Expr, op: BinaryOp, right: Expr): Expr => ({
  k: "binary",
  left,
  op,
  right,
});
export const ifExpr = (test: Expr, whenTrue: Expr, whenFalse: Expr): Expr => ({
  k: "ifExpr",
  test,
  whenTrue,
  whenFalse,
});

// --- statements and declarations -------------------------------------------------------

export const exprStmt = (expr: Expr): Stmt => ({ k: "expr", expr });
export const val = (n: string, init: Expr, t?: Type): Stmt => ({
  k: "val",
  name: n,
  init,
  ...(t ? { type: t } : {}),
});
export const ret = (value?: Expr): Stmt => (value ? { k: "return", value } : { k: "return" });
export const throwStmt = (value: Expr): Stmt => ({ k: "throw", value });
export const assign = (target: Expr, value: Expr): Stmt => ({ k: "assign", target, value });

export const param = (n: string, t: Type, defaultValue?: Expr): Param => ({
  name: n,
  type: t,
  ...(defaultValue ? { default: defaultValue } : {}),
});
