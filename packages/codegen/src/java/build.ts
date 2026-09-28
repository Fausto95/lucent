/** Constructors for Java syntax trees. */
import type {
  Annotation,
  BinaryOp,
  ClassDecl,
  Expr,
  Member,
  Modifier,
  Param,
  Primitive,
  Stmt,
  Type,
} from "./ast.ts";

// --- types -----------------------------------------------------------------------------

export const primitive = (name: Primitive): Type => ({ k: "primitive", name });
export const type = (name: string, ...args: Type[]): Type =>
  args.length ? { k: "class", name, args } : { k: "class", name };
export const array = (of: Type): Type => ({ k: "array", of });

// --- expressions -----------------------------------------------------------------------

export const name = (n: string): Expr => ({ k: "name", name: n });
export const str = (value: string): Expr => ({ k: "string", value });
export const num = (text: string | number): Expr => ({ k: "number", text: String(text) });
export const bool = (value: boolean): Expr => ({ k: "bool", value });
export const nullLit: Expr = { k: "null" };
export const self: Expr = { k: "this" };
export const superRef: Expr = { k: "super" };
export const access = (object: Expr, n: string): Expr => ({ k: "field", object, name: n });
export const call = (target: Expr | undefined, n: string, args: Expr[] = []): Expr =>
  target ? { k: "call", target, name: n, args } : { k: "call", name: n, args };
export const newObject = (t: Type, args: Expr[] = []): Expr => ({ k: "new", type: t, args });
export const newArray = (t: Type, items: Expr[]): Expr => ({ k: "newArray", type: t, items });
export const arrayInit = (items: Expr[]): Expr => ({ k: "arrayInit", items });
export const cast = (t: Type, operand: Expr): Expr => ({ k: "cast", type: t, operand });
export const assign = (target: Expr, value: Expr): Expr => ({ k: "assign", target, value });
export const binary = (left: Expr, op: BinaryOp, right: Expr): Expr => ({
  k: "binary",
  left,
  op,
  right,
});

// --- statements ------------------------------------------------------------------------

export const exprStmt = (expr: Expr): Stmt => ({ k: "expr", expr });
export const ret = (value?: Expr): Stmt => (value ? { k: "return", value } : { k: "return" });

// --- declarations ----------------------------------------------------------------------

export const param = (t: Type, n: string): Param => ({ type: t, name: n });
export const annotation = (n: string, value?: Expr): Annotation =>
  value ? { name: n, value } : { name: n };

type MemberOpts = { annotations?: Annotation[]; doc?: string; throws?: Type[] };

export const field = (modifiers: Modifier[], t: Type, n: string, init?: Expr): Member => ({
  k: "field",
  modifiers,
  type: t,
  name: n,
  ...(init ? { init } : {}),
});
export const constructor = (
  modifiers: Modifier[],
  n: string,
  params: Param[],
  body: Stmt[],
  opts: MemberOpts = {},
): Member => ({ k: "constructor", modifiers, name: n, params, body, ...opts });
/** A method; without `body`, abstract. */
export const method = (
  modifiers: Modifier[],
  ret: Type,
  n: string,
  params: Param[],
  body?: Stmt[],
  opts: MemberOpts = {},
): Member => ({ k: "method", modifiers, ret, name: n, params, ...(body ? { body } : {}), ...opts });
export const cls = (
  n: string,
  members: Member[],
  opts: Omit<Partial<ClassDecl>, "k" | "name" | "members"> = {},
): ClassDecl => ({ k: "class", name: n, modifiers: [], members, ...opts });
