import type { NativePackage } from "../libraries.ts";
import type { NativeBinding, NativeViewBinding, NativeReferenceBinding, ThreadContext } from "../libraries.ts";
import type { IRUnion } from "../ir/types.ts";
/** The typed AST: the surface AST with every expression annotated by its NativeType. */
import type { Span } from "../diagnostics/index.ts";
import type {
  AssignOperator,
  BinaryOperator,
  LogicalOperator,
  UnaryOperator,
  UpdateOperator,
} from "../parser/surface.ts";
import type { NativeType } from "../types/native-type.ts";

export interface StructField {
  name: string;
  type: NativeType;
}

export interface StructDef {
  reference?: { publicName: string; exported: boolean; privateFields?: string[]; native?: NativeReferenceBinding };
  union?: IRUnion;
  name: string;
  exported: boolean;
  fields: StructField[];
}

export interface TypedParam {
  name: string;
  type: NativeType;
}

export interface TypedFunction {
  classOp?: { className: string; member: string; kind: "constructor" | "method" | "get" | "set" };
  event?: { name: string; id: string; exported: boolean };
  thread?: ThreadContext;
  binding?: NativeBinding;
  name: string;
  exported: boolean;
  async: boolean;
  params: TypedParam[];
  /** For async functions this is the promise's value type. */
  returnType: NativeType;
  body: TStmt[];
  span: Span;
}

export interface TypedModule {
  nativePackages?: Record<string, NativePackage>;
  views?: Record<string, NativeViewBinding>;
  name: string;
  fileName: string;
  structs: StructDef[];
  functions: TypedFunction[];
}

interface Typed {
  type: NativeType;
  span: Span;
  /** Set on placeholders produced after a diagnostic, so later checks do not cascade. */
  poisoned?: true;
}

export type TExpr =
  | ({ kind: "closure"; params: TypedParam[]; body: TExpr } & Typed)
  | ({ kind: "functionRef"; name: string } & Typed)
  | ({ kind: "invoke"; callback: TExpr; args: TExpr[] } & Typed)
  | ({
      kind: "view";
      native?: NativeViewBinding;
      name: string;
      properties: { name: string; value: TExpr }[];
      children: TExpr[];
    } & Typed)
  | ({ kind: "number"; value: number } & Typed)
  | ({ kind: "string"; value: string } & Typed)
  | ({ kind: "boolean"; value: boolean } & Typed)
  | ({ kind: "null" } & Typed)
  | ({ kind: "template"; quasis: string[]; expressions: TExpr[] } & Typed)
  | ({ kind: "array"; elements: TExpr[] } & Typed)
  | ({ kind: "object"; properties: { name: string; value: TExpr }[] } & Typed)
  | ({ kind: "identifier"; name: string } & Typed)
  | ({ kind: "unwrap"; argument: TExpr } & Typed)
  | ({ kind: "binary"; operator: BinaryOperator; left: TExpr; right: TExpr } & Typed)
  | ({ kind: "logical"; operator: LogicalOperator; left: TExpr; right: TExpr } & Typed)
  | ({ kind: "unary"; operator: UnaryOperator; argument: TExpr } & Typed)
  | ({ kind: "assign"; operator: AssignOperator; target: TExpr; value: TExpr } & Typed)
  | ({ kind: "update"; operator: UpdateOperator; target: TExpr } & Typed)
  | ({ kind: "call"; callee: string; args: TExpr[] } & Typed)
  | ({ kind: "member"; object: TExpr; property: string } & Typed)
  | ({ kind: "length"; object: TExpr } & Typed)
  | ({ kind: "index"; object: TExpr; index: TExpr } & Typed)
  | ({ kind: "methodCall"; object: TExpr; method: string; args: TExpr[] } & Typed)
  | ({ kind: "await"; argument: TExpr } & Typed);

export type TStmt =
  | { kind: "variable"; declaration: "const" | "let"; name: string; type: NativeType; init: TExpr; span: Span }
  | { kind: "if"; test: TExpr; consequent: TStmt[]; alternate: TStmt[] | null; span: Span }
  | { kind: "while"; test: TExpr; body: TStmt[]; span: Span }
  | { kind: "for"; init: TStmt | null; test: TExpr | null; update: TExpr | null; body: TStmt[]; span: Span }
  | { kind: "forOf"; variable: string; elementType: NativeType; iterable: TExpr; body: TStmt[]; span: Span }
  | { kind: "return"; argument: TExpr | null; span: Span }
  | { kind: "break"; span: Span }
  | { kind: "continue"; span: Span }
  | { kind: "throw"; code: string; metadata?: { name: string; value: TExpr }[]; message: TExpr | null; span: Span }
  | { kind: "expression"; expression: TExpr; span: Span }
  | { kind: "block"; body: TStmt[]; span: Span };
