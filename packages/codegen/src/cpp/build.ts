/**
 * Constructors for C++ syntax trees, so emitters write `call(id("f"), [x])`
 * rather than object literals.
 */
import type {
  AssignOp,
  Base,
  BinaryOp,
  Capture,
  CastKind,
  Decl,
  Expr,
  Member,
  Param,
  Stmt,
  TemplateArg,
  Type,
  UnaryOp,
} from "./ast.ts";

// --- types -----------------------------------------------------------------------------

export const type = (name: string, ...args: TemplateArg[]): Type =>
  args.length ? { k: "named", name, args } : { k: "named", name };
export const pointer = (
  to: Type,
  ownership?: "__autoreleasing" | "__unsafe_unretained" | "__strong",
): Type => (ownership ? { k: "pointer", to, ownership } : { k: "pointer", to });
export const reference = (to: Type, rvalue = false): Type => ({ k: "reference", to, rvalue });
export const constType = (of: Type): Type => ({ k: "const", of });
export const auto: Type = { k: "auto" };
export const decltype = (of: Expr): Type => ({ k: "decltype", of });
export const fnType = (ret: Type, params: Type[]): Type => ({ k: "function", ret, params });
export const blockType = (ret: Type, params: Type[]): Type => ({ k: "block", ret, params });
export const protocol = (name: string): Type => ({ k: "protocol", name });
export const nestedType = (of: Type, name: string): Type => ({ k: "nested", of, name });
export const voidType = type("void");

// --- expressions -----------------------------------------------------------------------

/**
 * Expressions made here refuse to become strings: a tree interpolated into a
 * template literal would print `[object Object]` into the generated code.
 */
function node<T extends Expr>(e: T): T {
  Object.defineProperty(e, "toString", {
    value: () => {
      throw new Error(`a C++ syntax tree (${e.k}) was used as a string: print it`);
    },
    enumerable: false,
  });
  return e;
}

export const id = (name: string): Expr => node({ k: "id", name });
export const templateId = (name: string, args: TemplateArg[]): Expr =>
  node({ k: "id", name, args });
export const scoped = (t: Type, name: string): Expr => node({ k: "scope", type: t, name });
export const num = (text: string | number): Expr => node({ k: "number", text: String(text) });
export const str = (value: string): Expr => node({ k: "string", value });
export const str16 = (value: string): Expr => node({ k: "string", value, prefix: "u" });
export const bool = (value: boolean): Expr => node({ k: "bool", value });
export const nullptr: Expr = node({ k: "nullptr" });
export const self: Expr = node({ k: "this" });
export const call = (
  callee: Expr | string,
  args: Expr[] = [],
  templateArgs?: TemplateArg[],
): Expr =>
  node({
    k: "call",
    callee: typeof callee === "string" ? id(callee) : callee,
    args,
    ...(templateArgs ? { templateArgs } : {}),
  });
export const dot = (object: Expr, name: string, template = false): Expr =>
  node({
    k: "member",
    object,
    name,
    ...(template ? { template } : {}),
  });
/** `object->Base::name`: a member of a base class, bypassing overrides. */
export const baseMember = (object: Expr, base: Type, name: string): Expr =>
  node({ k: "member", object, name, arrow: true, base });
export const arrow = (object: Expr, name: string): Expr =>
  node({
    k: "member",
    object,
    name,
    arrow: true,
  });
export const index = (object: Expr, i: Expr): Expr => node({ k: "index", object, index: i });
export const unary = (op: UnaryOp, operand: Expr): Expr => node({ k: "unary", op, operand });
export const not = (operand: Expr): Expr => unary("!", operand);
export const deref = (operand: Expr): Expr => unary("*", operand);
export const addressOf = (operand: Expr): Expr => unary("&", operand);
export const postfix = (op: "++" | "--", operand: Expr): Expr =>
  node({ k: "postfix", op, operand });
export const binary = (left: Expr, op: BinaryOp, right: Expr): Expr =>
  node({
    k: "binary",
    op,
    left,
    right,
  });
export const and = (...items: Expr[]): Expr => items.reduce((a, b) => binary(a, "&&", b));
export const or = (...items: Expr[]): Expr => items.reduce((a, b) => binary(a, "||", b));
export const assign = (target: Expr, value: Expr, op: AssignOp = "="): Expr =>
  node({
    k: "assign",
    op,
    target,
    value,
  });
export const conditional = (test: Expr, whenTrue: Expr, whenFalse: Expr): Expr =>
  node({
    k: "conditional",
    test,
    whenTrue,
    whenFalse,
  });
export const comma = (...items: Expr[]): Expr => node({ k: "comma", items });
export const cast = (kind: CastKind, t: Type, operand: Expr): Expr =>
  node({
    k: "cast",
    kind,
    type: t,
    operand,
  });
export const staticCast = (t: Type, operand: Expr): Expr => cast("static", t, operand);
export const construct = (t: Type, args: Expr[] = [], braces = false): Expr =>
  node({
    k: "construct",
    type: t,
    args,
    ...(braces ? { braces } : {}),
  });
export const initList = (items: Expr[]): Expr => node({ k: "initList", items });
export const newExpr = (t: Type, args: Expr[] = []): Expr => node({ k: "new", type: t, args });
export const lambda = (
  captures: Capture[],
  params: Param[],
  body: Stmt[],
  opts: { ret?: Type; mutable?: boolean } = {},
): Expr => node({ k: "lambda", captures, params, body, ...opts });
export const statementExpr = (body: Stmt[], value: Expr): Expr =>
  node({
    k: "statementExpr",
    body,
    value,
  });
export const coAwait = (operand: Expr): Expr => node({ k: "coAwait", operand });
export const send = (receiver: Expr | string, selector: string, args: Expr[] = []): Expr =>
  node({
    k: "send",
    receiver: typeof receiver === "string" ? id(receiver) : receiver,
    selector,
    args,
  });
export const blockLiteral = (params: Param[], body: Stmt[], ret?: Type): Expr =>
  node({
    k: "blockLiteral",
    params,
    body,
    ...(ret ? { ret } : {}),
  });
export const box = (operand: Expr): Expr => node({ k: "box", operand });
export const selector = (name: string): Expr => node({ k: "selector", name });

export const param = (t: Type, name?: string): Param => (name ? { type: t, name } : { type: t });

// --- statements ------------------------------------------------------------------------

export const exprStmt = (expr: Expr): Stmt => ({ k: "expr", expr });
export const varDecl = (
  t: Type,
  name: string,
  init?: Expr,
  opts: { style?: "assign" | "construct" | "brace"; static?: boolean; constexpr?: boolean } = {},
): Stmt & { k: "var" } => ({ k: "var", type: t, name, ...(init ? { init } : {}), ...opts });
export const ret = (value?: Expr): Stmt => (value ? { k: "return", value } : { k: "return" });
export const coReturn = (value?: Expr): Stmt =>
  value ? { k: "return", value, co: true } : { k: "return", co: true };
export const ifStmt = (test: Expr, body: Stmt[], orElse?: Stmt[]): Stmt => ({
  k: "if",
  test,
  body,
  ...(orElse ? { orElse } : {}),
});
export const block = (body: Stmt[]): Stmt => ({ k: "block", body });
export const lineDirective = (line: number, file: string): Stmt => ({ k: "line", line, file });

// --- declarations ----------------------------------------------------------------------

export const include = (path: string, system = false): Decl => ({ k: "include", path, system });
export const namespace = (name: string, body: Decl[]): Decl => ({ k: "namespace", name, body });
export const withoutMacros = (names: string[], body: Decl[]): Decl => ({
  k: "withoutMacros",
  names,
  body,
});
export const struct = (
  name: string,
  members: Member[],
  opts: {
    template?: string[];
    args?: TemplateArg[];
    bases?: Base[];
    final?: boolean;
    forward?: boolean;
  } = {},
): Decl => ({ k: "struct", name, members, ...opts });
/** A function: a declaration without `body`, a definition with one. */
export const fn = (
  name: string,
  ret: Type,
  params: Param[],
  body?: Stmt[],
  opts: { scope?: Type; template?: string[]; inline?: boolean; static?: boolean } = {},
): Decl => ({ k: "function", name, ret, params, ...(body ? { body } : {}), ...opts });
export const field = (
  t: Type,
  name: string,
  opts: { init?: Expr; static?: boolean; inline?: boolean } = {},
): Member => ({ k: "field", type: t, name, ...opts });
/** A member function; no `ret` for constructors and destructors. */
export const method = (
  name: string,
  ret: Type | undefined,
  params: Param[],
  body?: Stmt[],
  opts: {
    static?: boolean;
    virtual?: boolean;
    override?: boolean;
    const?: boolean;
    pure?: boolean;
    default?: boolean;
  } = {},
): Member & { k: "method" } => ({
  k: "method",
  name,
  ...(ret ? { ret } : {}),
  params,
  ...(body ? { body } : {}),
  ...opts,
});
