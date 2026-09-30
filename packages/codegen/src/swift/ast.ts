/**
 * A syntax tree for the Swift Lucent generates (the `@_cdecl` shims that
 * call Swift-only APIs, SwiftUI components' views), as plain data. print.ts writes it out, adding the
 * parentheses precedence needs.
 */

// --- types -----------------------------------------------------------------------------

export type Type =
  /** A named type with generic arguments: `LucentBox<Point>`, `UnsafeMutableRawPointer`. */
  | { k: "named"; name: string; args?: Type[] }
  | { k: "optional"; of: Type }
  | { k: "array"; of: Type }
  | { k: "dictionary"; key: Type; value: Type }
  /** `@convention(c) (A, B) -> R`: what a C callback is in Swift. */
  | { k: "cFunction"; params: Type[]; ret: Type }
  /** `(A, B) -> R`: a closure's type. */
  | { k: "function"; params: Type[]; ret: Type }
  /** `some View`: a type the compiler infers, known by a protocol it conforms to. */
  | { k: "opaque"; of: Type };

// --- expressions -----------------------------------------------------------------------

export interface Arg {
  label?: string;
  value: Expr;
}

export type Expr =
  | { k: "name"; name: string }
  | { k: "number"; text: string }
  | { k: "string"; value: string }
  | { k: "bool"; value: boolean }
  | { k: "nil" }
  | { k: "self" }
  | { k: "member"; object: Expr; name: string }
  | { k: "arrayLiteral"; items: Expr[] }
  | { k: "dictionaryLiteral"; entries: { key: Expr; value: Expr }[] }
  | { k: "index"; object: Expr; index: Expr }
  /** `callee(args) { trailing }`. */
  | { k: "call"; callee: Expr; args: Arg[]; trailing?: Expr & { k: "closure" } }
  /**
   * `{ @MainActor a, b in … }`; one statement returning or doing something
   * prints on one line.
   */
  | { k: "closure"; params: string[]; body: Stmt[]; attributes?: string[] }
  | { k: "cast"; value: Expr; op: "as" | "as!" | "as?"; type: Type }
  | { k: "try"; value: Expr }
  | { k: "await"; value: Expr }
  | { k: "forceUnwrap"; value: Expr }
  | { k: "binary"; left: Expr; op: BinaryOp; right: Expr }
  | { k: "conditional"; test: Expr; whenTrue: Expr; whenFalse: Expr }
  | { k: "assign"; target: Expr; value: Expr }
  /** `&value`: an inout argument, or a pointer to a variable for a C function. */
  | { k: "addressOf"; value: Expr }
  /** `#available(iOS 16.0, *)`: an `if`'s test that the running OS is new enough. */
  | { k: "available"; platforms: string[] };

/** `...`: a closed range (`0 ... 1`). */
export type BinaryOp = "==" | "!=" | "&&" | "||" | "??" | "<" | ">" | "...";

// --- statements ------------------------------------------------------------------------

export type Stmt =
  | { k: "expr"; expr: Expr }
  | { k: "let" | "var"; name: string; type?: Type; init?: Expr }
  | { k: "return"; value?: Expr }
  | { k: "throw"; value: Expr }
  | { k: "if"; test: Expr; body: Stmt[]; orElse?: Stmt[] }
  /** `if let name = value { … }`. */
  | { k: "ifLet"; name: string; value: Expr; body: Stmt[]; orElse?: Stmt[] }
  /** `if case let .circle(center, radius) = value { … }`: the pattern as written. */
  | { k: "ifCase"; pattern: string; value: Expr; body: Stmt[] }
  | { k: "guard"; test: Expr; orElse: Stmt[] }
  | { k: "do"; body: Stmt[]; catchBody: Stmt[] }
  /** Patterns as written: `.circle(let center, let radius)`, `default`. */
  | { k: "switch"; on: Expr; cases: { patterns: string[]; body: Stmt[] }[] };

// --- declarations ----------------------------------------------------------------------

export interface Param {
  /** The argument label; `_` for none. Absent: the same as `name`. */
  external?: string;
  name: string;
  type: Type;
  /** Its default value: callers may leave it out. */
  default?: Expr;
}

export type Member =
  | { k: "var" | "let"; modifiers: string[]; name: string; type: Type; init?: Expr }
  | { k: "init"; modifiers: string[]; params: Param[]; body: Stmt[] }
  | { k: "deinit"; body: Stmt[] }
  /** A computed property: its getter's body alone, or a getter and a setter (`newValue`). */
  | { k: "property"; modifiers: string[]; name: string; type: Type; get: Stmt[]; set?: Stmt[] }
  | { k: "typealias"; name: string; type: Type }
  | (Omit<Decl & { k: "func" }, "k"> & { k: "func" });

export type Decl =
  | { k: "import"; module: string }
  | {
      k: "func";
      attributes?: string[];
      modifiers: string[];
      name: string;
      params: Param[];
      ret?: Type;
      /** `async`, `throws`. */
      effects?: string[];
      body: Stmt[];
    }
  | {
      k: "class";
      name: string;
      typeParams?: string[];
      modifiers: string[];
      superclass?: Type;
      /** The protocols it conforms to, after its superclass. */
      protocols?: Type[];
      members: Member[];
    }
  | {
      k: "struct";
      name: string;
      modifiers: string[];
      /** The protocols it conforms to. */
      protocols?: Type[];
      members: Member[];
    }
  | { k: "comment"; text: string };

/** A .swift file. */
export interface Unit {
  /** The first line, a comment saying where the file comes from. */
  banner?: string;
  decls: Decl[];
}
