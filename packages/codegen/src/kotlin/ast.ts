/**
 * A syntax tree for the Kotlin Lucent generates (the shims that call
 * Kotlin-only APIs: suspend functions, default arguments, extensions), as
 * plain data. print.ts writes it out, adding the parentheses precedence needs
 * and escaping identifiers and strings; it refuses anything else.
 */

// --- types -----------------------------------------------------------------------------

export type Type =
  /** A named type with type arguments: `List<String>`, `Result<Unit>`. */
  | { k: "named"; name: string; args?: Type[] }
  | { k: "nullable"; of: Type }
  /** `(A, B) -> R`, or `suspend () -> R`. */
  | { k: "function"; params: Type[]; ret: Type; suspend?: boolean }
  /** The star projection: `List<*>`. */
  | { k: "star" };

// --- expressions -----------------------------------------------------------------------

export interface Arg {
  /** A named argument: `limit = 20`. */
  name?: string;
  value: Expr;
}

export type BinaryOp =
  | "=="
  | "!="
  | "==="
  | "!=="
  | "&&"
  | "||"
  | "<"
  | ">"
  | "<="
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

export type Expr =
  | { k: "name"; name: string }
  | { k: "number"; text: string }
  | { k: "string"; value: string }
  | { k: "bool"; value: boolean }
  | { k: "null" }
  | { k: "this" }
  | { k: "member"; object: Expr; name: string; safe?: boolean }
  | { k: "index"; object: Expr; index: Expr }
  /** `callee(args) { trailing }`. */
  | { k: "call"; callee: Expr; args: Arg[]; typeArgs?: Type[]; trailing?: Expr & { k: "lambda" } }
  /** `{ a, b -> … }`; one expression statement prints on one line. */
  | { k: "lambda"; params: string[]; body: Stmt[] }
  /** `object : Runnable { … }`. */
  | { k: "object"; supertypes: Type[]; members: Member[] }
  | { k: "cast"; value: Expr; type: Type; safe?: boolean }
  | { k: "is"; value: Expr; type: Type; negated?: boolean }
  | { k: "notNull"; value: Expr }
  | { k: "not"; value: Expr }
  | { k: "elvis"; left: Expr; right: Expr }
  | { k: "binary"; left: Expr; op: BinaryOp; right: Expr }
  /** `if (…) a else b` as an expression. */
  | { k: "ifExpr"; test: Expr; whenTrue: Expr; whenFalse: Expr };

// --- statements ------------------------------------------------------------------------

export interface Catch {
  name: string;
  type: Type;
  body: Stmt[];
}

export interface WhenBranch {
  /** None: the `else` branch. */
  conditions: Expr[];
  body: Stmt[];
}

export type Stmt =
  | { k: "expr"; expr: Expr }
  | { k: "val" | "var"; name: string; type?: Type; init?: Expr }
  | { k: "assign"; target: Expr; value: Expr }
  | { k: "return"; value?: Expr; label?: string }
  | { k: "throw"; value: Expr }
  | { k: "if"; test: Expr; body: Stmt[]; orElse?: Stmt[] }
  | { k: "when"; subject?: Expr; branches: WhenBranch[] }
  | { k: "try"; body: Stmt[]; catches: Catch[]; finally?: Stmt[] };

// --- declarations ----------------------------------------------------------------------

export interface Param {
  name: string;
  type: Type;
  default?: Expr;
}

/** A function: a declaration, a member, an override in an anonymous object. */
export interface Fun {
  k: "fun";
  /** Without `@`: `JvmStatic`, `Suppress("unused")`. */
  annotations?: string[];
  modifiers: Modifier[];
  typeParams?: string[];
  /** An extension function's receiver. */
  receiver?: Type;
  name: string;
  params: Param[];
  ret?: Type;
  /** None: an `external` or `abstract` function. */
  body?: Stmt[];
}

export interface Property {
  k: "val" | "var";
  annotations?: string[];
  modifiers: Modifier[];
  name: string;
  type?: Type;
  init?: Expr;
}

export type Member = Fun | Property;

export type Modifier =
  | "private"
  | "protected"
  | "internal"
  | "public"
  | "override"
  | "open"
  | "abstract"
  | "final"
  | "external"
  | "suspend"
  | "inline"
  | "operator"
  | "const"
  | "lateinit"
  | "data";

export type Decl =
  | Fun
  | Property
  | { k: "object"; name: string; modifiers?: Modifier[]; supertypes?: Type[]; members: Member[] }
  | {
      k: "class";
      name: string;
      modifiers?: Modifier[];
      typeParams?: string[];
      /** The primary constructor's parameters (as properties: `val x: Int`). */
      params?: (Param & { property?: "val" | "var" })[];
      supertypes?: { type: Type; args?: Arg[] }[];
      members: Member[];
    }
  | { k: "comment"; text: string };

/** A .kt file. */
export interface Unit {
  /** The first line, a comment saying where the file comes from. */
  banner?: string;
  /** Without `@file:`: `JvmName("LucentShims")`. */
  fileAnnotations?: string[];
  packageName: string;
  imports?: string[];
  decls: Decl[];
}
