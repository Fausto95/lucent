import type { NativeExecutor, NativeTargets } from "../native-contracts.ts";
import type { NativePackage } from "../libraries.ts";
import type {
  NativeBinding,
  NativeEnumBinding,
  NativeViewBinding,
  NativeReferenceBinding,
  ThreadContext,
} from "../libraries.ts";
/**
 * Lucent IR (HIR): a structured, fully typed representation with every
 * JavaScript-only construct removed. Resolved ownership, effects, and symbol
 * identity live on call nodes so backends print already-understood operations.
 * See docs/ir.md.
 */
import type { NativeType } from "../types/native-type.ts";

/** Ownership of a call argument or result after checking. */
export type IROwnership = "value" | "owned" | "borrowed" | "retained" | "external";

/** Effects known for a resolved call. Unknown native work is conservatively native. */
export interface IRCallEffects {
  async: boolean;
  throws: boolean;
  native: boolean;
  executor?: NativeExecutor;
}

/**
 * Resolved call semantics carried through the HIR. Backends must not reinterpret
 * ownership, cancellation, or executor requirements from the callee name alone.
 */
export interface IRCallSemantics {
  /** Stable ABI identity when the callee has a native contract. */
  symbolId?: string;
  argumentOwnership: IROwnership[];
  resultOwnership: IROwnership;
  effects: IRCallEffects;
  suspension: boolean;
  cancellation: "none" | "cooperative";
}

/** Locals are `%name`, with `.n` suffixes when a name is shadowed. */
export type LocalId = string;

export type BinaryOp = "add" | "sub" | "mul" | "div" | "rem" | "lt" | "le" | "gt" | "ge" | "eq" | "ne";

export type IRConst = number | string | boolean | null;

interface Typed {
  readonly type: NativeType;
}

export interface IRStateSlot {
  name: string;
  type: NativeType;
  value: IRConst;
}

/** Component-owned closeable resource, created once per host identity. */
export interface IRResourceSlot {
  name: string;
  type: NativeType;
  /** Linked create callee, typically `Type__create`. */
  initCallee: string;
  /** `contract.close` method name invoked on unmount. */
  close: string;
}

/** Dependency-scoped component effect with optional sync or async cleanup. */
export interface IREffectSlot {
  /** Stable slot id for backends (`effect0`, …). */
  id: string;
  body: IRStmt[];
  cleanup: IRStmt[];
  deps: string[];
  /** When true, backends cancel/join via TaskScope before replacement or unmount. */
  async?: boolean;
}

export interface IRCapture {
  name: string;
  kind: "value" | "retained" | "borrowed" | "weak";
}
export type IRExpr =
  | ({
      op: "closure";
      params: { name: string; type: NativeType }[];
      captures: IRCapture[];
      body: IRExpr | IRStmt[];
    } & Typed)
  | ({ op: "weak"; name: string } & Typed)
  | ({ op: "move"; value: IRExpr } & Typed)
  | ({ op: "copy"; value: IRExpr } & Typed)
  | ({ op: "stateRead"; name: string } & Typed)
  | ({ op: "stateWrite"; name: string; value: IRExpr } & Typed)
  | ({ op: "resourceRead"; name: string } & Typed)
  | ({ op: "ifExpr"; cond: IRExpr; consequent: IRExpr; alternate: IRExpr } & Typed)
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
  | ({ op: "widen"; value: IRExpr } & Typed)
  | ({ op: "unwrap"; value: IRExpr } & Typed)
  | ({ op: "binary"; operator: BinaryOp; left: IRExpr; right: IRExpr } & Typed)
  | ({ op: "concat"; parts: IRExpr[] } & Typed)
  | ({ op: "str"; value: IRExpr } & Typed)
  | ({ op: "and"; left: IRExpr; right: IRExpr } & Typed)
  | ({ op: "or"; left: IRExpr; right: IRExpr } & Typed)
  | ({ op: "not"; value: IRExpr } & Typed)
  | ({ op: "neg"; value: IRExpr } & Typed)
  | ({ op: "call"; callee: string; args: IRExpr[]; semantics: IRCallSemantics } & Typed)
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
  | { op: "push"; array: IRExpr; value: IRExpr }
  | { op: "stateWrite"; name: string; value: IRExpr };

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
  /** Scalar view state, initialized once per host instance. */
  state?: IRStateSlot[];
  /** Owned resources closed when the host identity unmounts. */
  resources?: IRResourceSlot[];
  /** Component effects: run on mount, cleanup on unmount (sync or async). */
  effectSlots?: IREffectSlot[];
  /** Lightweight effects inferred from the async flag and body native calls. */
  effects?: IRCallEffects;
}

export interface IRUnion {
  tag: string;
  variants: { tag: string; fields: { name: string; type: NativeType }[] }[];
}

export interface IRStruct {
  reference?: {
    publicName: string;
    exported: boolean;
    privateFields?: string[];
    native?: NativeReferenceBinding;
    implements?: string[];
  };
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
  /** SDK enums reachable from this module, keyed by their Lucent name. */
  enums?: Record<string, NativeEnumBinding>;
  targets?: NativeTargets;
  nativePackages?: Record<string, NativePackage>;
  views?: Record<string, NativeViewBinding>;
  events?: IREvent[];
  capabilities?: string[];
  name: string;
  structs: IRStruct[];
  functions: IRFunction[];
}
