import type { NativeTargets } from "../native-contracts.ts";
import type { NativePackage } from "../libraries.ts";
import type { NativeBinding, NativeViewBinding, NativeReferenceBinding, ThreadContext } from "../libraries.ts";
/**
 * Lucent IR: a structured, fully typed representation with every JavaScript-only
 * construct removed. Backends emit it directly; see docs/ir.md for the rationale.
 */
import type { NativeType } from "../types/native-type.ts";

/** Locals are `%name`, with `.n` suffixes when a name is shadowed. */
export type LocalId = string;

export type BinaryOp = "add" | "sub" | "mul" | "div" | "rem" | "lt" | "le" | "gt" | "ge" | "eq" | "ne";

export type IRConst = number | string | boolean | null;

interface Typed {
  readonly type: NativeType;
}

export type IRExpr =
  | ({ op: "closure"; params: { name: string; type: NativeType }[]; body: IRExpr } & Typed)
  | ({ op: "functionRef"; name: string } & Typed)
  | ({ op: "invoke"; callback: IRExpr; args: IRExpr[] } & Typed)
  | ({
      op: "view";
      native?: NativeViewBinding;
      name: string;
      props: { name: string; value: IRExpr }[];
      children: IRExpr[];
    } & Typed)
  | ({ op: "const"; value: IRConst } & Typed)
  | ({ op: "param"; name: string } & Typed)
  | ({ op: "local"; id: LocalId } & Typed)
  | ({ op: "unwrap"; value: IRExpr } & Typed)
  | ({ op: "binary"; operator: BinaryOp; left: IRExpr; right: IRExpr } & Typed)
  | ({ op: "concat"; parts: IRExpr[] } & Typed)
  | ({ op: "str"; value: IRExpr } & Typed)
  | ({ op: "and"; left: IRExpr; right: IRExpr } & Typed)
  | ({ op: "or"; left: IRExpr; right: IRExpr } & Typed)
  | ({ op: "not"; value: IRExpr } & Typed)
  | ({ op: "neg"; value: IRExpr } & Typed)
  | ({ op: "call"; callee: string; args: IRExpr[] } & Typed)
  | ({ op: "await"; value: IRExpr } & Typed)
  | ({ op: "field"; object: IRExpr; field: string } & Typed)
  | ({ op: "length"; object: IRExpr } & Typed)
  | ({ op: "index"; object: IRExpr; index: IRExpr } & Typed)
  | ({ op: "mapGet"; map: IRExpr; key: IRExpr } & Typed)
  | ({ op: "array"; elements: IRExpr[] } & Typed)
  | ({ op: "struct"; name: string; fields: { name: string; value: IRExpr }[] } & Typed);

export type IRPlace =
  | { kind: "local"; id: LocalId; type: NativeType }
  | { kind: "field"; object: IRExpr; field: string; type: NativeType }
  | { kind: "index"; object: IRExpr; index: IRExpr; type: NativeType };

export type IRStmt =
  | { op: "let"; id: LocalId; value: IRExpr }
  | { op: "assign"; target: IRPlace; value: IRExpr }
  | { op: "if"; cond: IRExpr; consequent: IRStmt[]; alternate: IRStmt[] }
  | { op: "while"; cond: IRExpr; body: IRStmt[] }
  | { op: "forEach"; id: LocalId; iterable: IRExpr; body: IRStmt[] }
  | { op: "break" }
  | { op: "continue" }
  | { op: "return"; value: IRExpr | null }
  | { op: "throw"; code: string; metadata?: { name: string; value: IRExpr }[]; message: IRExpr | null }
  | { op: "expr"; value: IRExpr }
  | { op: "push"; array: IRExpr; value: IRExpr };

export interface IRLocal {
  id: LocalId;
  name: string;
  type: NativeType;
  mutable: boolean;
}

export interface IRParam {
  name: string;
  type: NativeType;
}

export interface IRFunction {
  classOp?: { className: string; member: string; kind: "constructor" | "method" | "get" | "set" };
  event?: { name: string; id: string; exported: boolean };
  thread?: ThreadContext;
  binding?: NativeBinding;
  name: string;
  exported: boolean;
  async: boolean;
  params: IRParam[];
  /** For async functions, the value type of the promise. */
  returnType: NativeType;
  locals: IRLocal[];
  body: IRStmt[];
}

export interface IRUnion {
  tag: string;
  variants: { tag: string; fields: { name: string; type: NativeType }[] }[];
}

export interface IRStruct {
  reference?: { publicName: string; exported: boolean; privateFields?: string[]; native?: NativeReferenceBinding };
  union?: IRUnion;
  name: string;
  exported: boolean;
  fields: { name: string; type: NativeType }[];
}

export interface IREvent {
  name: string;
  id: string;
  exported: boolean;
  payload: NativeType;
}

export interface IRModule {
  targets?: NativeTargets;
  nativePackages?: Record<string, NativePackage>;
  views?: Record<string, NativeViewBinding>;
  events?: IREvent[];
  capabilities?: string[];
  name: string;
  structs: IRStruct[];
  functions: IRFunction[];
}
