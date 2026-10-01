/**
 * The semantic IR: what a function does, independent of the C++ it becomes.
 *
 * Values are defined once by an operation and referred to by id; operations
 * run in the order of their region's list, so evaluation order is data, not
 * something a printer or a C++ compiler decides. Control flow is
 * structured: `if`, `loop` and `block` own nested regions, and `break`,
 * `continue` and `yield` leave them. See verify.ts for the invariants every
 * function satisfies before code generation.
 */
import { looseEqualityConverts } from "../lowering/loose-equality.ts";
import { conversionStep, type Representations } from "../lowering/conversions.ts";
import { type LType, sameType, T, unionOf } from "../types.ts";

/** A value, dense per function: `values[id].id === id`. */
export type ValueId = number & { readonly __value: true };

/** A region of ordered operations, dense per function. */
export type RegionId = number & { readonly __region: true };

/** A storage location (a local or a module variable), dense per function. */
export type PlaceId = number & { readonly __place: true };

/** A loop or block that `break` and `continue` name, dense per function. */
export type TargetId = number & { readonly __target: true };

/** A function, by its C++ name. */
export type FunctionId = string;

/** Where something is in the source: offsets, and the 1-based line and column of `start`. */
export interface SourceSpan {
  file: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

/**
 * The execution context a value belongs to, or that runs a unit: module
 * code, the main thread, a compute worker, or a context the compiler cannot
 * name. A helper runs in each context of its callers, so it takes theirs.
 */
export type OwnerId = "legacy-module" | "main" | "task" | "unknown";

export const OWNERS: readonly OwnerId[] = ["legacy-module", "main", "task", "unknown"];

export interface IrValue {
  id: ValueId;
  type: LType;
  source: SourceSpan;
  owner?: OwnerId;
}

/** A module variable the function reads or writes: a place declared outside its body. */
export interface IrModulePlace {
  place: PlaceId;
  /** Its C++ name. */
  symbol: string;
  name: string;
  type: LType;
  mutable: boolean;
}

/**
 * A variable of an enclosing function that a closure uses: a place
 * declared at entry, holding the value it had when the closure was made,
 * or, `boxed`, sharing the enclosing function's box (a variable some
 * code writes after closures capture it).
 */
export interface IrCapture {
  place: PlaceId;
  name: string;
  type: LType;
  boxed: boolean;
}

export interface IrFunction {
  id: FunctionId;
  params: ValueId[];
  result: LType;
  body: RegionId;
  values: IrValue[];
  regions: IrRegion[];
  modulePlaces: IrModulePlace[];
  /** What a closure captures, in the order of its `closure` op's `from`. */
  captures: IrCapture[];
  effects: EffectSummary;
  source: SourceSpan;
  async: boolean;
}

export interface IrRegion {
  id: RegionId;
  ops: IrOp[];
  parent?: RegionId;
}

export type Constant = number | bigint | string | boolean | null | undefined;

/**
 * `!!` is JavaScript's ToBoolean and `String` its ToString (of the
 * primitives, optionals and unions the IR holds); `typeof` gives the
 * type's name.
 */
export type UnaryOp = "-" | "!" | "~" | "!!" | "typeof" | "String";

export type EqualityOp = "===" | "!==" | "==" | "!=";

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "&"
  | "|"
  | "^"
  | "<<"
  | ">>"
  | ">>>"
  | "<"
  | ">"
  | "<="
  | ">="
  | EqualityOp;

export type IrOp =
  | { kind: "const"; result: ValueId; value: Constant; source: SourceSpan }
  | { kind: "param"; result: ValueId; index: number; source: SourceSpan }
  | { kind: "unary"; result: ValueId; op: UnaryOp; operand: ValueId; source: SourceSpan }
  | {
      kind: "binary";
      result: ValueId;
      op: BinaryOp;
      left: ValueId;
      right: ValueId;
      source: SourceSpan;
    }
  | { kind: "convert"; result: ValueId; input: ValueId; to: LType; source: SourceSpan }
  /** A local; `boxed`, one closures share, which some code writes after they capture it. */
  | {
      kind: "local";
      place: PlaceId;
      type: LType;
      name: string;
      boxed?: boolean;
      source: SourceSpan;
    }
  | { kind: "load"; result: ValueId; place: PlaceId; source: SourceSpan }
  | { kind: "store"; place: PlaceId; value: ValueId; source: SourceSpan }
  | {
      kind: "call";
      result?: ValueId;
      callee: Callee;
      args: ValueId[];
      effects: EffectRef;
      source: SourceSpan;
    }
  /**
   * Runs `whenTrue` when `cond` is true, `whenFalse` otherwise. With a `result`,
   * each branch ends by yielding the result's value (or leaves otherwise).
   */
  | {
      kind: "if";
      result?: ValueId;
      cond: ValueId;
      whenTrue: RegionId;
      whenFalse: RegionId;
      source: SourceSpan;
    }
  /**
   * Runs `body` again and again; after the body, and on `continue`, runs
   * `next` first. Only `break` (or a return or throw) leaves it.
   */
  | { kind: "loop"; target: TargetId; body: RegionId; next?: RegionId; source: SourceSpan }
  /** Runs `body`, a scope of its own; with a target, `break` leaves it. */
  | { kind: "block"; target?: TargetId; body: RegionId; source: SourceSpan }
  /**
   * `try`: runs `body`; when it throws, `catch` runs with the error (its
   * `error`, defined for the region alone). However they are left (falling
   * through, a return, a break or continue past the `try`, a throw), the
   * `finally` region runs first; when it completes, so does what left, and
   * when it leaves itself, that replaces it.
   */
  | {
      kind: "try";
      body: RegionId;
      catch?: { region: RegionId; error: ValueId };
      finally?: RegionId;
      source: SourceSpan;
    }
  /**
   * In a `finally` region: disposes `value` with the backend's `code` (a
   * `using` declaration's). When disposing throws while an exception is
   * pending, the pending one becomes a SuppressedError of both.
   */
  | { kind: "dispose"; value: ValueId; code: unknown; source: SourceSpan }
  /**
   * Runs `body` for each element of `iterable` (`for … of`), the element
   * being `element` there; `break` and `continue` name `target`. Leaving
   * early closes an iterator (which runs a generator's `finally`).
   */
  | {
      kind: "iterate";
      target: TargetId;
      iterable: ValueId;
      element: ValueId;
      body: RegionId;
      source: SourceSpan;
    }
  | { kind: "return"; value?: ValueId; source: SourceSpan }
  | { kind: "throw"; value: ValueId; source: SourceSpan }
  /** Leaves the loop or block `target`. */
  | { kind: "break"; target: TargetId; source: SourceSpan }
  /** Ends this iteration of the loop `target`. */
  | { kind: "continue"; target: TargetId; source: SourceSpan }
  /** Ends a branch of an `if`, giving its result. */
  | { kind: "yield"; value?: ValueId; source: SourceSpan }
  /**
   * An operation the IR does not model itself (a member read, a method of
   * the runtime or the SDK, a construction…), on values computed before
   * it: the backend's `code` for it, which `name` describes. Its effects
   * are the program analysis's to know; the IR assumes it may do anything.
   */
  | {
      kind: "plan";
      result?: ValueId;
      name: string;
      code: unknown;
      args: ValueId[];
      source: SourceSpan;
    }
  /**
   * A function value made of `fn`, a nested function: each of its captures
   * is the value `from` gives it, or the box of the place `from` names.
   */
  | {
      kind: "closure";
      result: ValueId;
      fn: IrFunction;
      from: CaptureSource[];
      source: SourceSpan;
    }
  /** A point TypeScript proved no path reaches (a body ending after an exhaustive switch). */
  | { kind: "unreachable"; source: SourceSpan }
  /**
   * The value of what never completes (a call that always throws): of type
   * `never`, it converts to any type, and no code that uses it runs.
   */
  | { kind: "never"; result: ValueId; source: SourceSpan };

/** What a closure's capture holds: a value of the enclosing function, or the box of its place. */
export type CaptureSource = { value: ValueId } | { box: PlaceId };

export type Callee = { kind: "function"; id: FunctionId } | { kind: "builtin"; name: BuiltinName };

export type Throws = "no" | "yes" | "unknown";

export interface EffectRef {
  throws: Throws;
  summary?: FunctionId;
}

export interface EffectSummary {
  reads: "none" | "module" | "unknown";
  writes: "none" | "module" | "unknown";
  allocates: boolean | "unknown";
  throws: Throws;
  suspends: boolean;
  callbacks: "none" | "known" | "unknown";
  affinity: "any" | "main" | "unknown";
  native: "none" | "known" | "unknown";
}

/** A callee's parameter and result types. */
export interface Signature {
  params: LType[];
  result: LType;
}

/** The runtime operations a call can name, with what they take, give and may throw. */
export const BUILTINS = {
  "new Error": { params: [T.string], result: T.error, throws: "no" },
  "new TypeError": { params: [T.string], result: T.error, throws: "no" },
  "new RangeError": { params: [T.string], result: T.error, throws: "no" },
} as const satisfies Record<string, Signature & { throws: Throws }>;

export type BuiltinName = keyof typeof BUILTINS;

export function isBuiltin(name: string): name is BuiltinName {
  return Object.hasOwn(BUILTINS, name);
}

/** A bigint and a number, either way round: relational operators compare them exactly. */
const BIGINT_NUMBER = [
  ["bigint", "number"],
  ["number", "bigint"],
] as const;

/**
 * The operand kinds each operator takes (both operands the same kind, or
 * one of the `mixed` pairs) and what it gives: a value of the operands'
 * kind, or a boolean. Equality operators follow `comparable` instead.
 * bigint has every operator but `>>>` (a TypeError in JavaScript).
 */
const BINARY: Record<
  Exclude<BinaryOp, EqualityOp>,
  {
    operands: readonly LType["k"][];
    gives: "operand" | "boolean";
    mixed?: readonly (readonly [LType["k"], LType["k"]])[];
  }
> = {
  "+": { operands: ["number", "bigint", "string"], gives: "operand" },
  "-": { operands: ["number", "bigint"], gives: "operand" },
  "*": { operands: ["number", "bigint"], gives: "operand" },
  "/": { operands: ["number", "bigint"], gives: "operand" },
  "%": { operands: ["number", "bigint"], gives: "operand" },
  "**": { operands: ["number", "bigint"], gives: "operand" },
  "&": { operands: ["number", "bigint"], gives: "operand" },
  "|": { operands: ["number", "bigint"], gives: "operand" },
  "^": { operands: ["number", "bigint"], gives: "operand" },
  "<<": { operands: ["number", "bigint"], gives: "operand" },
  ">>": { operands: ["number", "bigint"], gives: "operand" },
  ">>>": { operands: ["number"], gives: "operand" },
  "<": { operands: ["number", "bigint", "string"], gives: "boolean", mixed: BIGINT_NUMBER },
  ">": { operands: ["number", "bigint", "string"], gives: "boolean", mixed: BIGINT_NUMBER },
  "<=": { operands: ["number", "bigint", "string"], gives: "boolean", mixed: BIGINT_NUMBER },
  ">=": { operands: ["number", "bigint", "string"], gives: "boolean", mixed: BIGINT_NUMBER },
};

const EQUALITY: readonly string[] = ["===", "!==", "==", "!="];

const PRIMITIVES: readonly LType["k"][] = ["number", "bigint", "string", "boolean"];

/** A value ToString can print: a primitive, an absent value, or an optional or union of them. */
function printable(t: LType): boolean {
  if (t.k === "opt") return printable(t.inner);

  if (t.k === "union") return t.ms.every(printable);

  return PRIMITIVES.includes(t.k) || isAbsent(t);
}

const numeric = (t: LType) => t.k === "number" || t.k === "bigint";

const UNARY: Record<UnaryOp, { takes: (t: LType) => boolean; gives?: LType }> = {
  "-": { takes: numeric },
  "~": { takes: numeric },
  "!": { takes: (t) => t.k === "boolean" },
  "!!": { takes: () => true, gives: T.boolean },
  typeof: { takes: () => true, gives: T.string },
  String: { takes: printable, gives: T.string },
};

export function isBinaryOp(op: string): op is BinaryOp {
  return Object.hasOwn(BINARY, op) || EQUALITY.includes(op);
}

export function isEqualityOp(op: BinaryOp): op is EqualityOp {
  return EQUALITY.includes(op);
}

export function isUnaryOp(op: string): op is UnaryOp {
  return Object.hasOwn(UNARY, op);
}

/** A number, bigint, string or boolean. */
export function isPrimitive(t: LType): boolean {
  return PRIMITIVES.includes(t.k);
}

/** `undefined` or `null`. */
export function isAbsent(t: LType): boolean {
  return t.k === "undefined" || t.k === "null";
}

/** Whether `outer`, an optional or a union, can hold the primitive `inner`. */
function holds(outer: LType, inner: LType): boolean {
  if (!PRIMITIVES.includes(inner.k)) return false;

  if (outer.k === "opt") return sameType(outer.inner, inner) || holds(outer.inner, inner);

  return outer.k === "union" && outer.ms.some((m) => sameType(m, inner));
}

/**
 * Whether an equality operator compares a `left` and a `right`: two
 * primitives of one kind, an absent value and anything that may be
 * absent, or an optional or union and a primitive it can hold. Loose and
 * strict equality agree on all of these but `null == undefined`.
 */
function comparable(left: LType, right: LType): boolean {
  if (left.k === right.k && PRIMITIVES.includes(left.k)) return true;

  const mayBeAbsent = (t: LType) => isAbsent(t) || t.k === "opt";

  if ((isAbsent(left) && mayBeAbsent(right)) || (isAbsent(right) && mayBeAbsent(left))) return true;

  return holds(left, right) || holds(right, left);
}

/** The type `left op right` gives, or undefined when the operator does not take those operands. */
export function binaryResult(op: BinaryOp, left: LType, right: LType): LType | undefined {
  if (isEqualityOp(op)) {
    const converts = (op === "==" || op === "!=") && looseEqualityConverts(left, right);

    return comparable(left, right) && !converts ? T.boolean : undefined;
  }

  const rule = BINARY[op];

  if (rule.mixed?.some(([a, b]) => a === left.k && b === right.k)) return T.boolean;

  if (left.k !== right.k || !rule.operands.includes(left.k)) return undefined;

  return rule.gives === "boolean" ? T.boolean : left;
}

/** The type `op operand` gives, or undefined when the operator does not take that operand. */
export function unaryResult(op: UnaryOp, operand: LType): LType | undefined {
  const rule = UNARY[op];

  return rule.takes(operand) ? (rule.gives ?? operand) : undefined;
}

/** Representations as the IR sees them: each type is its own. */
export const EXACT: Representations = { same: sameType, fits: sameType };

/**
 * Whether `convert` may turn a `from` into a `to`: the same value in
 * another representation, as lowering/conversions.ts plans it (into or
 * out of optionals and unions). Operations such as ToString are not
 * conversions.
 */
export function convertible(from: LType, to: LType): boolean {
  const step = conversionStep(from, to, EXACT);

  if (!step) return false;

  if (step.kind === "wrap") return convertible(from, step.inner);

  if (step.kind === "unwrap") return convertible(step.inner, to);

  if (step.kind === "member") return convertible(from, step.member);

  if (step.kind === "members") return step.members.some((m) => convertible(m, to));

  return true;
}

/**
 * The type of the elements `for … of` gives over a `t`: an array's,
 * a set's, a map's entries, a record's (`[key, value]`), a string's code
 * points, a byte array's numbers, an iterator's, a match's groups. Not
 * iterable: undefined.
 */
export function elementOf(t: LType): LType | undefined {
  switch (t.k) {
    case "array":
    case "set":
    case "iter":
      return t.e;
    case "map":
      return { k: "tuple", es: [t.key, t.val] };
    case "dict":
      return { k: "tuple", es: [T.string, t.val] };
    case "string":
      return T.string;
    case "bytes":
      return T.number;
    case "regexMatch":
      return unionOf([T.string, T.undefined]);
    default:
      return undefined;
  }
}

/** The type of a constant. */
export function constantType(value: Constant): LType {
  if (value === null) return T.null;

  if (value === undefined) return T.undefined;

  if (typeof value === "number") return T.number;

  if (typeof value === "bigint") return T.bigint;

  return typeof value === "string" ? T.string : T.boolean;
}

/** The value an operation defines. */
export function resultOf(op: IrOp): ValueId | undefined {
  return "result" in op ? op.result : undefined;
}

/** The values an operation uses, in the order it uses them. */
export function operandsOf(op: IrOp): ValueId[] {
  switch (op.kind) {
    case "unary":
      return [op.operand];
    case "binary":
      return [op.left, op.right];
    case "convert":
      return [op.input];
    case "store":
      return [op.value];
    case "call":
    case "plan":
      return op.args;
    case "closure":
      return op.from.flatMap((f) => ("value" in f ? [f.value] : []));
    case "return":
      return op.value === undefined ? [] : [op.value];
    case "throw":
      return [op.value];
    case "if":
      return [op.cond];
    case "iterate":
      return [op.iterable];
    case "dispose":
      return [op.value];
    case "yield":
      return op.value === undefined ? [] : [op.value];
    default:
      return [];
  }
}

/** The regions an operation owns, in the order they are listed (not run). */
export function regionsOf(op: IrOp): RegionId[] {
  switch (op.kind) {
    case "if":
      return [op.whenTrue, op.whenFalse];
    case "loop":
      return op.next === undefined ? [op.body] : [op.body, op.next];
    case "block":
    case "iterate":
      return [op.body];
    case "try":
      return [
        op.body,
        ...(op.catch ? [op.catch.region] : []),
        ...(op.finally === undefined ? [] : [op.finally]),
      ];
    default:
      return [];
  }
}

/** The target an operation defines (a loop or block) or jumps to (break, continue). */
export function targetOf(op: IrOp): TargetId | undefined {
  return op.kind === "loop" ||
    op.kind === "block" ||
    op.kind === "iterate" ||
    op.kind === "break" ||
    op.kind === "continue"
    ? op.target
    : undefined;
}

/** The place an operation declares, reads or writes. */
export function placeOf(op: IrOp): PlaceId | undefined {
  return op.kind === "local" || op.kind === "load" || op.kind === "store" ? op.place : undefined;
}

/**
 * Whether running region `id` can reach its end: it does not end with a
 * terminator, nor with an `if` neither of whose branches can, a `loop` no
 * `break` leaves, or a `block` that neither ends nor is left.
 */
export function completes(fn: Pick<IrFunction, "regions">, id: RegionId): boolean {
  return runsThrough(fn, fn.regions[id]?.ops ?? []);
}

/** Whether running `ops`, operations of `fn`, can reach their end (see `completes`). */
export function runsThrough(fn: Pick<IrFunction, "regions">, ops: readonly IrOp[]): boolean {
  const broken = new Set<TargetId>();

  for (const r of fn.regions)
    for (const op of r.ops) if (op.kind === "break") broken.add(op.target);

  const run = (region: RegionId): boolean => through(fn.regions[region]?.ops ?? []);
  const through = (ops: readonly IrOp[]): boolean => {
    for (const op of ops) {
      // A yield gives its if's result: what follows the if runs next.
      if (op.kind === "yield") return true;

      if (isTerminator(op)) return false;

      if (op.kind === "if" && !run(op.whenTrue) && !run(op.whenFalse)) return false;

      if (op.kind === "loop" && !broken.has(op.target)) return false;

      const left = op.kind === "block" && op.target !== undefined && broken.has(op.target);

      if (op.kind === "block" && !left && !run(op.body)) return false;

      // A try completes when its body or its catch does, and so does its finally.
      if (op.kind === "try") {
        const normal = run(op.body) || (op.catch !== undefined && run(op.catch.region));

        if (!normal || (op.finally !== undefined && !run(op.finally))) return false;
      }
    }
    return true;
  };

  return through(ops);
}

const TERMINATORS = new Set<IrOp["kind"]>([
  "return",
  "throw",
  "break",
  "continue",
  "yield",
  "unreachable",
]);

/** Operations that end their region: nothing may follow them. */
export function isTerminator(op: IrOp): boolean {
  return TERMINATORS.has(op.kind);
}
