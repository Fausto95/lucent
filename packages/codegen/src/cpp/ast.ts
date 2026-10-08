/**
 * A syntax tree for the C++ (and Objective-C++) Lucent generates: types,
 * expressions, statements and declarations, as plain data. print.ts writes
 * it out, adding the parentheses precedence needs; nothing else is decided
 * at printing time.
 */

// --- types -----------------------------------------------------------------------------

export type Type =
  /** A named type, with template arguments: `lucent::Array<double>`. */
  | { k: "named"; name: string; args?: TemplateArg[] }
  /** `T*`, with an ARC ownership qualifier when given (`NSError* __autoreleasing`). */
  | { k: "pointer"; to: Type; ownership?: "__autoreleasing" | "__unsafe_unretained" | "__strong" }
  | { k: "reference"; to: Type; rvalue?: boolean }
  | { k: "const"; of: Type }
  | { k: "auto" }
  | { k: "decltype"; of: Expr }
  /** A function type, as in `lucent::Fn<double(double)>`. */
  | { k: "function"; ret: Type; params: Type[] }
  /** An Objective-C block type: `void (^)(BOOL)`. */
  | { k: "block"; ret: Type; params: Type[] }
  /** An Objective-C object of a protocol: `id<NSCopying>`. */
  | { k: "protocol"; name: string }
  /** A type named inside a dependent type: `typename std::decay_t<T>::Iterating`. */
  | { k: "nested"; of: Type; name: string };

export type TemplateArg = Type | Expr;

// --- expressions -----------------------------------------------------------------------

export type Expr =
  /** A name, qualified or not: `x`, `lucent::undefined`; a template-id with `args`: `std::in_place_type<T>`. */
  | { k: "id"; name: string; args?: TemplateArg[] }
  /** A member of a type: `JsonRead<double>::read`. */
  | { k: "scope"; type: Type; name: string }
  /** A numeric literal, as written: `1.0`, `42`, `0x10u`. */
  | { k: "number"; text: string }
  /** A string literal of these UTF-8 bytes, escaped when printed (`u` prefix: UTF-16 units). */
  | { k: "string"; value: string; prefix?: "u" }
  | { k: "bool"; value: boolean }
  | { k: "nullptr" }
  | { k: "this" }
  | { k: "call"; callee: Expr; args: Expr[]; templateArgs?: TemplateArg[] }
  /** `obj.name` / `obj->name`; `template` for a dependent member template (`.template map<T>`). */
  | {
      k: "member";
      object: Expr;
      name: string;
      arrow?: boolean;
      template?: boolean;
      /** The base class it is reached through: `this->C_Base::construct`. */
      base?: Type;
    }
  | { k: "index"; object: Expr; index: Expr }
  | { k: "unary"; op: UnaryOp; operand: Expr }
  | { k: "postfix"; op: "++" | "--"; operand: Expr }
  | { k: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { k: "assign"; op: AssignOp; target: Expr; value: Expr }
  | { k: "conditional"; test: Expr; whenTrue: Expr; whenFalse: Expr }
  | { k: "comma"; items: Expr[] }
  /** `static_cast<T>(x)` and the other named casts, a C cast `(T)x`, or ARC's bridging casts. */
  | { k: "cast"; kind: CastKind; type: Type; operand: Expr }
  /** `T(args)` or `T{args}`. */
  | { k: "construct"; type: Type; args: Expr[]; braces?: boolean }
  /** `{a, b}`: an initializer list where the type is implied. */
  | { k: "initList"; items: Expr[] }
  | { k: "new"; type: Type; args: Expr[] }
  | {
      k: "lambda";
      /** By name (`x`, `&`, `this`), or init-captures (`f_ = expr`). */
      captures: Capture[];
      params: Param[];
      ret?: Type;
      mutable?: boolean;
      body: Stmt[];
    }
  /** A GNU statement expression, `({ …; value; })`. */
  | { k: "statementExpr"; body: Stmt[]; value: Expr }
  | { k: "coAwait"; operand: Expr }
  | { k: "sizeof"; of: Type | Expr }
  /** An Objective-C message send, `[receiver selector:arg …]`; the receiver may be a class name. */
  | { k: "send"; receiver: Expr; selector: string; args: Expr[] }
  /** An Objective-C block literal, `^ret (params) { … }`. */
  | { k: "blockLiteral"; ret?: Type; params: Param[]; body: Stmt[] }
  /** `@(x)`: a boxed number. */
  | { k: "box"; operand: Expr }
  /** `@selector(name)`. */
  | { k: "selector"; name: string };

export type UnaryOp = "!" | "~" | "-" | "+" | "*" | "&" | "++" | "--";
export type BinaryOp =
  | "*"
  | "/"
  | "%"
  | "+"
  | "-"
  | "<<"
  | ">>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&"
  | "^"
  | "|"
  | "&&"
  | "||";
export type AssignOp = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "<<=" | ">>=" | "&=" | "^=" | "|=";
export type CastKind =
  | "static"
  | "reinterpret"
  | "const"
  | "c"
  | "bridge"
  | "bridge_transfer"
  | "bridge_retained";

export type Capture = string | { name: string; init: Expr };

export interface Param {
  type: Type;
  name?: string;
}

// --- statements ------------------------------------------------------------------------

export type Stmt =
  | { k: "expr"; expr: Expr }
  /** A variable: `T x = init;`, `T x(args);`, `T x{};` (`init` absent: `T x;`). */
  | {
      k: "var";
      type: Type;
      name: string;
      init?: Expr;
      style?: "assign" | "construct" | "brace";
      static?: boolean;
      constexpr?: boolean;
      /** An array of `type`, its length from the initializer: `T x[] = {…}`. */
      array?: boolean;
    }
  | { k: "return"; value?: Expr; co?: boolean }
  | { k: "coYield"; value: Expr }
  /** With `bind`, a declaring condition: `if (auto d = test)`. */
  | { k: "if"; test: Expr; bind?: { type: Type; name: string }; body: Stmt[]; orElse?: Stmt[] }
  | { k: "while"; test: Expr; body: Stmt[] }
  | { k: "doWhile"; body: Stmt[]; test: Expr }
  | { k: "for"; init?: Stmt; test?: Expr; update?: Expr; body: Stmt[] }
  | { k: "forRange"; type: Type; name: string; range: Expr; body: Stmt[] }
  | { k: "switch"; on: Expr; cases: { values: Expr[]; isDefault?: boolean; body: Stmt[] }[] }
  | { k: "block"; body: Stmt[] }
  | { k: "break" }
  | { k: "continue" }
  | { k: "goto"; label: string }
  | { k: "label"; name: string }
  | { k: "throw"; value?: Expr }
  | { k: "try"; body: Stmt[]; catches: { param?: Param; body: Stmt[] }[] }
  /** `#line N "file"`: what follows comes from this source line. */
  | { k: "line"; line: number; file: string }
  | { k: "comment"; text: string };

// --- declarations ----------------------------------------------------------------------

export type Decl =
  | { k: "include"; path: string; system?: boolean; objc?: boolean }
  | { k: "pragmaOnce" }
  /** An empty name: an anonymous namespace. */
  | { k: "namespace"; name: string; body: Decl[] }
  | { k: "usingNamespace"; name: string }
  | {
      k: "function";
      name: string;
      /** The class it is a member of, for an out-of-line definition: `C_Point::create`. */
      scope?: Type;
      ret: Type;
      params: Param[];
      /** Absent: a declaration only. */
      body?: Stmt[];
      template?: string[];
      inline?: boolean;
      static?: boolean;
      /** `[[noreturn]]` and other attributes, as written between the brackets. */
      attributes?: string[];
      /** A constructor (`ret` is not printed), with its member initializers. */
      ctor?: boolean;
      initializers?: { name: string; args: Expr[] }[];
      /** A const member function. */
      const?: boolean;
    }
  | {
      k: "struct";
      name: string;
      /** The template's parameters; empty for an explicit specialization (`template <>`). */
      template?: string[];
      /** An explicit specialization's arguments: `JsonRead<double>`. */
      args?: TemplateArg[];
      bases?: Base[];
      members: Member[];
      /** `class` rather than `struct`. */
      class?: boolean;
      final?: boolean;
      /** Absent: a forward declaration only. */
      forward?: boolean;
    }
  | { k: "var"; stmt: Stmt & { k: "var" }; inline?: boolean; extern?: boolean }
  | { k: "using"; name: string; type: Type }
  | { k: "staticAssert"; test: Expr; message: string }
  | { k: "externC"; body: Decl[] }
  | {
      k: "objcInterface";
      name: string;
      superclass: string;
      protocols?: string[];
      /** Public instance variables. */
      ivars?: { type: Type; name: string }[];
    }
  | { k: "objcImplementation"; name: string; methods: ObjcMethod[] }
  /**
   * `body` where none of `names` is a macro: each saved and undefined
   * before it (`#pragma push_macro`, `#undef`), restored after.
   */
  | { k: "withoutMacros"; names: string[]; body: Decl[] }
  | { k: "comment"; text: string }
  | { k: "blank" };

/** A base class: `lucent::Object`, `public virtual I_Shape`. */
export interface Base {
  type: Type;
  virtual?: boolean;
  public?: boolean;
}

export type Member =
  | { k: "field"; type: Type; name: string; init?: Expr; static?: boolean; inline?: boolean }
  | {
      k: "method";
      name: string;
      ret?: Type;
      params: Param[];
      body?: Stmt[];
      static?: boolean;
      virtual?: boolean;
      override?: boolean;
      const?: boolean;
      /** `= 0`. */
      pure?: boolean;
      /** `= default`. */
      default?: boolean;
      /** A constructor's member initializers, `: a(x), b(y)`. */
      initializers?: { name: string; args: Expr[] }[];
    }
  | { k: "access"; level: "public" | "private" | "protected" }
  /** `using Base::Base;`: a base's constructors, or another of its members. */
  | { k: "using"; name: string }
  | { k: "comment"; text: string };

/** An Objective-C method, `- (ret)part:(T)a part:(T)b { … }`. */
export interface ObjcMethod {
  static?: boolean;
  ret: Type;
  /** The selector's parts, each with its parameter (none for a unary selector). */
  parts: { name: string; param?: Param }[];
  body: Stmt[];
}

/** A translation unit (a .cpp, .h or .mm file). */
export interface Unit {
  /** The first line, a comment saying where the file comes from. */
  banner?: string;
  /**
   * The file's own name, as `#line` gives it: after a declaration whose
   * code names source lines, a `#line` makes the next lines this file's again.
   */
  file?: string;
  decls: Decl[];
}
