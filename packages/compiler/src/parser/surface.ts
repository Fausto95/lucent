import type { NativePackage } from "../libraries.ts";
import type { NativeBinding, NativeViewBinding, NativeReferenceBinding, ThreadContext } from "../libraries.ts";
/**
 * The surface AST: the closed set of TypeScript constructs Lucent understands.
 * Produced by `parseModule`; nothing downstream ever sees ESTree.
 */
import type { Span } from "../diagnostics/index.ts";

export type { Span };

export type SurfaceType =
  | { kind: "literal"; value: string; span: Span }
  | { kind: "keyword"; name: string; span: Span }
  | { kind: "reference"; name: string; args: SurfaceType[]; span: Span }
  | { kind: "array"; element: SurfaceType; span: Span }
  | { kind: "union"; members: SurfaceType[]; span: Span }
  | { kind: "object"; fields: SurfaceField[]; span: Span }
  | { kind: "function"; params: SurfaceParam[]; returnType: SurfaceType; span: Span }
  | { kind: "unsupported"; description: string; span: Span };

export interface SurfaceField {
  name: string;
  optional: boolean;
  type: SurfaceType;
  span: Span;
}

export type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "===" | "!==";
export type LogicalOperator = "&&" | "||";
export type UnaryOperator = "-" | "!";
export type AssignOperator = "=" | "+=" | "-=" | "*=" | "/=";
export type UpdateOperator = "++" | "--";

export type Expr =
  | { kind: "closure"; params: SurfaceParam[]; returnType: SurfaceType | null; body: Expr | Stmt[]; span: Span }
  | { kind: "view"; name: string; properties: ObjectProperty[]; children: Expr[]; span: Span }
  | { kind: "number"; value: number; span: Span }
  | { kind: "string"; value: string; span: Span }
  | { kind: "boolean"; value: boolean; span: Span }
  | { kind: "null"; span: Span }
  | { kind: "undefined"; span: Span }
  | { kind: "template"; quasis: string[]; expressions: Expr[]; span: Span }
  | { kind: "array"; elements: Expr[]; span: Span }
  | { kind: "object"; properties: ObjectProperty[]; span: Span }
  | { kind: "identifier"; name: string; span: Span }
  | { kind: "binary"; operator: BinaryOperator; left: Expr; right: Expr; span: Span }
  | { kind: "logical"; operator: LogicalOperator; left: Expr; right: Expr; span: Span }
  | { kind: "conditional"; test: Expr; consequent: Expr; alternate: Expr; span: Span }
  | { kind: "unary"; operator: UnaryOperator; argument: Expr; span: Span }
  | { kind: "assign"; operator: AssignOperator; target: Expr; value: Expr; span: Span }
  | { kind: "update"; operator: UpdateOperator; target: Expr; span: Span }
  | { kind: "call"; callee: string; args: Expr[]; span: Span }
  | { kind: "member"; object: Expr; property: string; span: Span }
  | { kind: "index"; object: Expr; index: Expr; span: Span }
  | { kind: "methodCall"; object: Expr; method: string; args: Expr[]; span: Span }
  | { kind: "await"; argument: Expr; span: Span }
  | { kind: "unsupported"; span: Span };

export interface ObjectProperty {
  name: string;
  value: Expr;
  span: Span;
}

export type Stmt =
  | {
      kind: "variable";
      declaration: "const" | "let";
      name: string;
      type: SurfaceType | null;
      init: Expr | null;
      span: Span;
    }
  | { kind: "if"; test: Expr; consequent: Stmt[]; alternate: Stmt[] | null; span: Span }
  | { kind: "while"; test: Expr; body: Stmt[]; span: Span }
  | { kind: "for"; init: Stmt | null; test: Expr | null; update: Expr | null; body: Stmt[]; span: Span }
  | { kind: "forOf"; variable: string; iterable: Expr; body: Stmt[]; span: Span }
  | { kind: "return"; argument: Expr | null; span: Span }
  | { kind: "break"; span: Span }
  | { kind: "continue"; span: Span }
  | { kind: "throw"; code: string; metadata?: { name: string; value: Expr }[]; message: Expr | null; span: Span }
  | { kind: "expression"; expression: Expr; span: Span }
  | { kind: "block"; body: Stmt[]; span: Span }
  | { kind: "unsupported"; span: Span };

export interface SurfaceParam {
  name: string;
  optional: boolean;
  type: SurfaceType | null;
  span: Span;
}

export interface SurfaceFunction {
  ambient?: boolean;
  classOp?: { className: string; member: string; kind: "constructor" | "method" | "get" | "set" };
  event?: { name: string; id: string; exported: boolean };
  thread?: ThreadContext;
  binding?: NativeBinding;
  name: string;
  exported: boolean;
  async: boolean;
  params: SurfaceParam[];
  returnType: SurfaceType | null;
  body: Stmt[];
  span: Span;
}

export interface SurfaceTypeAlias {
  reference?: { publicName: string; exported: boolean; privateFields?: string[]; native?: NativeReferenceBinding };
  name: string;
  exported: boolean;
  type: SurfaceType;
  span: Span;
}

export interface SurfaceImport {
  source: string;
  bindings?: { imported: string; local: string; typeOnly: boolean }[];
  names: string[];
  typeOnly: boolean;
  span: Span;
}

export interface SurfaceModule {
  overloads?: Record<string, string[]>;
  nativePackages?: Record<string, NativePackage>;
  views?: Record<string, NativeViewBinding>;
  fileName: string;
  imports: SurfaceImport[];
  typeAliases: SurfaceTypeAlias[];
  functions: SurfaceFunction[];
}
