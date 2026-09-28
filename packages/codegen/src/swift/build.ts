/** Constructors for Swift syntax trees. */
import type { Arg, BinaryOp, Expr, Stmt, Type } from "./ast.ts";

export const type = (name: string, ...args: Type[]): Type =>
  args.length ? { k: "named", name, args } : { k: "named", name };
export const optional = (of: Type): Type => ({ k: "optional", of });
export const array = (of: Type): Type => ({ k: "array", of });
export const dictionary = (key: Type, value: Type): Type => ({ k: "dictionary", key, value });
export const cFunction = (params: Type[], ret: Type): Type => ({ k: "cFunction", params, ret });
export const opaque = (of: Type): Type => ({ k: "opaque", of });

export const name = (n: string): Expr => ({ k: "name", name: n });
export const num = (text: string | number): Expr => ({ k: "number", text: String(text) });
export const str = (value: string): Expr => ({ k: "string", value });
export const bool = (value: boolean): Expr => ({ k: "bool", value });
export const nil: Expr = { k: "nil" };
export const self: Expr = { k: "self" };
export const member = (object: Expr, n: string): Expr => ({ k: "member", object, name: n });
export const arrayLiteral = (items: Expr[]): Expr => ({ k: "arrayLiteral", items });
export const dictionaryLiteral = (entries: { key: Expr; value: Expr }[]): Expr => ({
  k: "dictionaryLiteral",
  entries,
});
export const index = (object: Expr, i: Expr): Expr => ({ k: "index", object, index: i });
export const call = (callee: Expr, args: Arg[], trailing?: Expr): Expr =>
  trailing
    ? { k: "call", callee, args, trailing: trailing as Expr & { k: "closure" } }
    : { k: "call", callee, args };
export const closure = (params: string[], body: Stmt[], attributes?: string[]): Expr => ({
  k: "closure",
  params,
  body,
  ...(attributes?.length ? { attributes } : {}),
});
export const cast = (value: Expr, op: "as" | "as!" | "as?", t: Type): Expr => ({
  k: "cast",
  value,
  op,
  type: t,
});
export const tryExpr = (value: Expr): Expr => ({ k: "try", value });
export const awaitExpr = (value: Expr): Expr => ({ k: "await", value });
export const forceUnwrap = (value: Expr): Expr => ({ k: "forceUnwrap", value });
export const binary = (left: Expr, op: BinaryOp, right: Expr): Expr => ({
  k: "binary",
  left,
  op,
  right,
});
export const conditional = (test: Expr, whenTrue: Expr, whenFalse: Expr): Expr => ({
  k: "conditional",
  test,
  whenTrue,
  whenFalse,
});
export const assign = (target: Expr, value: Expr): Expr => ({ k: "assign", target, value });
export const addressOf = (value: Expr): Expr => ({ k: "addressOf", value });
export const available = (...platforms: string[]): Expr => ({ k: "available", platforms });

export const exprStmt = (expr: Expr): Stmt => ({ k: "expr", expr });
export const ret = (value?: Expr): Stmt => (value ? { k: "return", value } : { k: "return" });
export const throwStmt = (value: Expr): Stmt => ({ k: "throw", value });
export const letStmt = (n: string, init: Expr, t?: Type): Stmt =>
  t ? { k: "let", name: n, type: t, init } : { k: "let", name: n, init };
