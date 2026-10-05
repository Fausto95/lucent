/**
 * A syntax tree for the TypeScript Lucent generates (the SDKs' declaration
 * files) and the JavaScript it generates (module proxies, a subset of the
 * same language), as plain data. print.ts writes it out, parenthesizing
 * types where precedence needs it.
 */

// --- types -----------------------------------------------------------------------------

export type Keyword =
  | "number"
  | "bigint"
  | "string"
  | "boolean"
  | "void"
  | "unknown"
  | "never"
  | "null"
  | "undefined"
  | "object"
  | "unique symbol";

export type Type =
  | { k: "keyword"; name: Keyword }
  /** A named type with type arguments: `Record<string, number>`, `NSObject`. */
  | { k: "ref"; name: string; args?: Type[] }
  /** `readonly`: `readonly T[]`, which a call cannot change. */
  | { k: "array"; of: Type; readonly?: boolean }
  | { k: "union"; members: Type[] }
  /** `A & B`. */
  | { k: "intersection"; members: Type[] }
  /** `[A, B?]`. */
  | { k: "tuple"; elements: TupleElement[] }
  | { k: "fn"; params: Param[]; ret: Type }
  | { k: "object"; members: PropertySignature[] }
  | { k: "literal"; value: string | number | bigint | boolean }
  /** `typeof Toast.LENGTH_SHORT`. */
  | { k: "typeof"; name: string };

export interface TupleElement {
  /** Its label: `[min: number, max: number]`. */
  name?: string;
  type: Type;
  /** `T?`: a value may leave it out. */
  optional?: boolean;
}

export interface Param {
  name: string;
  type: Type;
  /** `name?: T`: the call may leave it out. */
  optional?: boolean;
}

export interface PropertySignature {
  name: string;
  type: Type;
  readonly?: boolean;
  optional?: boolean;
}

export interface TypeParam {
  name: string;
  /** `T extends number`: what it may be. */
  extends?: Type;
  default?: Type;
}

// --- expressions and statements (JavaScript) -------------------------------------------

export type Expr =
  | { k: "name"; name: string }
  | { k: "string"; value: string }
  | { k: "number"; value: number }
  | { k: "bool"; value: boolean }
  | { k: "member"; object: Expr; name: string }
  | { k: "call"; callee: Expr; args: Expr[] }
  /** `(a, b) => body`. */
  | { k: "arrow"; params: string[]; body: Expr }
  | { k: "null" }
  /** `multiline`: one entry per line. */
  | { k: "array"; items: Expr[]; multiline?: boolean }
  | { k: "object"; props: { key: string; value: Expr; quoted?: boolean }[]; multiline?: boolean }
  | { k: "assign"; target: Expr; value: Expr };

export type Stmt =
  | { k: "expr"; expr: Expr }
  /** `const x = init;`, or with several names `const { a, b } = init;`. */
  | { k: "const"; name: string | string[]; init: Expr };

// --- declarations ----------------------------------------------------------------------

/** A documentation comment: one line, or one entry per line (tags on lines of their own). */
export type Doc = string | string[];

export type Member =
  | {
      k: "property";
      name: string;
      type: Type;
      static?: boolean;
      readonly?: boolean;
      private?: boolean;
      /** `[name]`: a property keyed by the value `name` (a unique symbol). */
      computed?: boolean;
      /** `name?: T`: an object may leave it out. */
      optional?: boolean;
      /** What it takes when written, where that is more than `type`: a get and a set accessor. */
      set?: Type;
      doc?: Doc;
    }
  | { k: "constructor"; params: Param[]; protected?: boolean; private?: boolean; doc?: Doc }
  | {
      k: "method";
      name: string;
      params: Param[];
      ret: Type;
      static?: boolean;
      optional?: boolean;
      typeParams?: TypeParam[];
      doc?: Doc;
    }
  /** A call signature: `(params): ret`, what calling a value of the type does. */
  | { k: "call"; typeParams?: TypeParam[]; params: Param[]; ret: Type; doc?: Doc };

/** What a file declares: everything exported is `export declare`. */
export type Decl =
  | { k: "importType"; names: string[]; from: string }
  | { k: "exportFrom"; from: string }
  | { k: "enum"; name: string; members: { name: string; value: string | number }[] }
  | { k: "typeAlias"; name: string; typeParams?: TypeParam[]; type: Type }
  | {
      k: "class";
      name: string;
      abstract?: boolean;
      /** A documentation comment, one line of text each. */
      doc?: string[];
      typeParams?: TypeParam[];
      extends?: Type;
      members: Member[];
    }
  | {
      k: "interface";
      name: string;
      typeParams?: TypeParam[];
      extends?: Type[];
      members: Member[];
      /** Not exported: the module's own (with `exportNothing`, a declaration file's too). */
      local?: boolean;
      doc?: Doc;
    }
  | {
      k: "function";
      name: string;
      typeParams?: TypeParam[];
      params: Param[];
      ret: Type;
      doc?: Doc;
    }
  | { k: "const"; name: string; type: Type; local?: boolean; doc?: Doc }
  /**
   * `export declare namespace name { … }`: type aliases and namespaces in it
   * (`Edge.Set`), and constants, functions and interfaces, which merge with
   * the same name's (a companion's members: `Color.White`).
   */
  | { k: "namespace"; name: string; decls: Decl[] }
  /**
   * `export {};`: a declaration file exports only what says `export` (a
   * declaration file otherwise exports every top-level declaration).
   */
  | { k: "exportNothing" }
  /** `declare module "lucent:android/*";`: any import of these is untyped. */
  | { k: "moduleWildcard"; name: string }
  | { k: "stmt"; stmt: Stmt }
  | { k: "blank" };

/** A .d.ts, .ts or .js file. */
export interface Unit {
  /** The first line, a comment saying where the file comes from. */
  banner?: string;
  decls: Decl[];
}
