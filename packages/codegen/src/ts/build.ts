/** Constructors for TypeScript and JavaScript syntax trees. */
import type { Decl, Expr, Keyword, Param, PropertySignature, Stmt, Type } from "./ast.ts";
import { printType } from "./print.ts";

// --- types -----------------------------------------------------------------------------

export const keyword = (name: Keyword): Type => ({ k: "keyword", name });
export const nullType = keyword("null");
export const ref = (name: string, ...args: Type[]): Type =>
  args.length ? { k: "ref", name, args } : { k: "ref", name };
export const array = (of: Type): Type => ({ k: "array", of });
/** `readonly T[]`. */
export const readonlyArray = (of: Type): Type => ({ k: "array", of, readonly: true });
export const fn = (ps: Param[], ret: Type): Type => ({ k: "fn", params: ps, ret });
export const object = (members: PropertySignature[]): Type => ({ k: "object", members });
export const literal = (value: string | number | bigint | boolean): Type => ({
  k: "literal",
  value,
});
export const typeOf = (name: string): Type => ({ k: "typeof", name });
/** A union, nested unions flattened and each member kept once; one member is itself. */
export const union = (members: Type[]): Type => {
  const flat = new Map<string, Type>();
  for (const m of members.flatMap((x) => (x.k === "union" ? x.members : [x])))
    flat.set(printType(m), m);
  const all = [...flat.values()];
  return all.length === 1 ? all[0]! : { k: "union", members: all };
};
export const param = (name: string, t: Type): Param => ({ name, type: t });

// --- expressions and statements --------------------------------------------------------

export const name = (n: string): Expr => ({ k: "name", name: n });
export const str = (value: string): Expr => ({ k: "string", value });
export const num = (value: number): Expr => ({ k: "number", value });
export const bool = (value: boolean): Expr => ({ k: "bool", value });
export const member = (object: Expr, n: string): Expr => ({ k: "member", object, name: n });
export const call = (callee: Expr, args: Expr[] = []): Expr => ({ k: "call", callee, args });
export const arrow = (params: string[], body: Expr): Expr => ({ k: "arrow", params, body });
export const nullLit: Expr = { k: "null" };
/** `[a, b]`; `multiline`: one item per line. */
export const arrayLit = (items: Expr[], multiline = false): Expr =>
  multiline ? { k: "array", items, multiline } : { k: "array", items };
/** `{ key: value }`; `multiline`: one property per line. */
export const objectLit = (
  props: { key: string; value: Expr; quoted?: boolean }[],
  multiline = false,
): Expr => (multiline ? { k: "object", props, multiline } : { k: "object", props });
export const assign = (target: Expr, value: Expr): Expr => ({ k: "assign", target, value });
export const exprStmt = (expr: Expr): Stmt => ({ k: "expr", expr });

// --- declarations ----------------------------------------------------------------------

export const stmt = (s: Stmt): Decl => ({ k: "stmt", stmt: s });
export const blank: Decl = { k: "blank" };
