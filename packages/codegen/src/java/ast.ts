/**
 * A syntax tree for the Java Lucent generates (subclasses of SDK classes
 * that forward to C++), as plain data. print.ts writes it out, adding the
 * parentheses precedence needs.
 */

// --- types -----------------------------------------------------------------------------

export type Primitive =
  | "boolean"
  | "byte"
  | "char"
  | "short"
  | "int"
  | "long"
  | "float"
  | "double"
  | "void";

export type Type =
  | { k: "primitive"; name: Primitive }
  /** A class, qualified or not, with type arguments: `java.util.List<String>`. */
  | { k: "class"; name: string; args?: Type[] }
  | { k: "array"; of: Type };

// --- expressions -----------------------------------------------------------------------

export type Expr =
  /** A variable, parameter or class name: `handle`, `NativeProxy`. */
  | { k: "name"; name: string }
  | { k: "string"; value: string }
  /** A numeric literal, as written: `1`, `2L`, `0.5f`. */
  | { k: "number"; text: string }
  | { k: "bool"; value: boolean }
  | { k: "null" }
  | { k: "this" }
  | { k: "super" }
  | { k: "field"; object: Expr; name: string }
  /** `target.name(args)`; no target for an unqualified call, `super(…)` included. */
  | { k: "call"; target?: Expr; name: string; args: Expr[] }
  | { k: "new"; type: Type; args: Expr[] }
  /** `new T[] {a, b}`. */
  | { k: "newArray"; type: Type; items: Expr[] }
  /** `{a, b}`: an array initializer, as an annotation's value. */
  | { k: "arrayInit"; items: Expr[] }
  | { k: "cast"; type: Type; operand: Expr }
  | { k: "assign"; target: Expr; value: Expr }
  | { k: "binary"; left: Expr; op: BinaryOp; right: Expr }
  | { k: "unary"; op: "!" | "-"; operand: Expr };

export type BinaryOp = "+" | "-" | "*" | "/" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "&&" | "||";

// --- statements ------------------------------------------------------------------------

export type Stmt =
  | { k: "expr"; expr: Expr }
  | { k: "var"; type: Type; name: string; init?: Expr; final?: boolean }
  | { k: "return"; value?: Expr }
  | { k: "if"; test: Expr; body: Stmt[]; orElse?: Stmt[] }
  | { k: "throw"; value: Expr }
  | {
      k: "try";
      body: Stmt[];
      catches?: { types: Type[]; name: string; body: Stmt[] }[];
      finally?: Stmt[];
    }
  | { k: "block"; body: Stmt[] };

// --- declarations ----------------------------------------------------------------------

export type Modifier =
  | "public"
  | "protected"
  | "private"
  | "static"
  | "final"
  | "abstract"
  | "synchronized";

/** `@Name`, `@Name(value)`. */
export interface Annotation {
  name: string;
  value?: Expr;
}

export interface Param {
  type: Type;
  name: string;
  final?: boolean;
}

interface MemberBase {
  modifiers: Modifier[];
  annotations?: Annotation[];
  /** A Javadoc comment, one line per line of text. */
  doc?: string;
}

export type Member =
  | (MemberBase & { k: "field"; type: Type; name: string; init?: Expr })
  | (MemberBase & {
      k: "constructor";
      name: string;
      params: Param[];
      body: Stmt[];
      throws?: Type[];
    })
  | (MemberBase & {
      k: "method";
      ret: Type;
      name: string;
      params: Param[];
      /** Absent: an abstract or interface method. */
      body?: Stmt[];
      throws?: Type[];
    });

export interface ClassDecl {
  k: "class";
  name: string;
  modifiers: Modifier[];
  annotations?: Annotation[];
  doc?: string;
  extends?: Type;
  implements?: Type[];
  members: Member[];
}

/** A .java file. */
export interface Unit {
  /** The first line, a comment saying where the file comes from. */
  banner?: string;
  package: string;
  imports: string[];
  types: ClassDecl[];
}
