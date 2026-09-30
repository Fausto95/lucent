/**
 * Builds IR functions: allocates ids and appends operations in evaluation
 * order, to the region being built (the body, or a region of an `if`,
 * `loop` or `block` while its callback runs).
 */
import type { LType } from "../types.ts";
import {
  binaryResult,
  type BinaryOp,
  type Callee,
  type Constant,
  constantType,
  type EffectRef,
  type EffectSummary,
  type FunctionId,
  type IrFunction,
  type IrModulePlace,
  type IrOp,
  type IrRegion,
  type IrValue,
  type PlaceId,
  isTerminator,
  placeOf,
  type RegionId,
  type SourceSpan,
  type TargetId,
  unaryResult,
  type UnaryOp,
  type ValueId,
} from "./ir.ts";

export class IrBuilder {
  private readonly values: IrValue[] = [];
  private readonly regions: IrRegion[] = [];
  private readonly modulePlaces: IrModulePlace[] = [];
  private readonly placeTypes: LType[] = [];
  private readonly params: ValueId[] = [];
  private readonly body: IrRegion;
  /** The region operations are appended to. */
  private cursor: IrRegion;
  private targets = 0;
  private readonly id: FunctionId;
  private readonly result: LType;
  private readonly source: SourceSpan;
  private readonly async: boolean;

  constructor(id: FunctionId, result: LType, source: SourceSpan, async = false) {
    this.id = id;
    this.result = result;
    this.source = source;
    this.async = async;
    this.body = { id: 0 as RegionId, ops: [] };
    this.cursor = this.body;
    this.regions.push(this.body);
  }

  typeOf(v: ValueId): LType {
    const value = this.values[v];

    if (!value) throw new Error(`IR value v${v} does not exist`);

    return value.type;
  }

  /** The operations appended so far to the body. */
  get ops(): readonly IrOp[] {
    return this.body.ops;
  }

  /** Whether the region being built ends with a terminator: nothing after it would run. */
  get ended(): boolean {
    const last = this.cursor.ops[this.cursor.ops.length - 1];

    return last !== undefined && isTerminator(last);
  }

  param(index: number, type: LType, source: SourceSpan): ValueId {
    const result = this.value(type, source);
    this.params[index] = result;
    this.push({ kind: "param", result, index, source });
    return result;
  }

  const(value: Constant, source: SourceSpan): ValueId {
    const result = this.value(constantType(value), source);
    this.push({ kind: "const", result, value, source });
    return result;
  }

  unary(op: UnaryOp, operand: ValueId, source: SourceSpan): ValueId {
    const type = unaryResult(op, this.typeOf(operand));

    if (!type) throw new Error(`IR: ${op} does not take v${operand}`);

    const result = this.value(type, source);
    this.push({ kind: "unary", result, op, operand, source });
    return result;
  }

  binary(op: BinaryOp, left: ValueId, right: ValueId, source: SourceSpan): ValueId {
    const type = binaryResult(op, this.typeOf(left), this.typeOf(right));

    if (!type) throw new Error(`IR: ${op} does not take v${left}, v${right}`);

    const result = this.value(type, source);
    this.push({ kind: "binary", result, op, left, right, source });
    return result;
  }

  convert(input: ValueId, to: LType, source: SourceSpan): ValueId {
    const result = this.value(to, source);
    this.push({ kind: "convert", result, input, to, source });
    return result;
  }

  local(name: string, type: LType, source: SourceSpan): PlaceId {
    const place = this.place(type);
    this.push({ kind: "local", place, type, name, source });
    return place;
  }

  /** A module variable, declared with the function rather than in its body. */
  modulePlace(symbol: string, name: string, type: LType, mutable: boolean): PlaceId {
    const known = this.modulePlaces.find((p) => p.symbol === symbol);

    if (known) return known.place;

    const place = this.place(type);
    this.modulePlaces.push({ place, symbol, name, type, mutable });
    return place;
  }

  load(place: PlaceId, source: SourceSpan): ValueId {
    const type = this.placeTypes[place];

    if (!type) throw new Error(`IR place p${place} does not exist`);

    const result = this.value(type, source);
    this.push({ kind: "load", result, place, source });
    return result;
  }

  store(place: PlaceId, value: ValueId, source: SourceSpan): void {
    this.push({ kind: "store", place, value, source });
  }

  /** A call; `result` is the type it gives, absent when it gives nothing. */
  call(
    callee: Callee,
    args: ValueId[],
    result: LType | undefined,
    effects: EffectRef,
    source: SourceSpan,
  ): ValueId | undefined {
    const id = result && this.value(result, source);
    this.push({
      kind: "call",
      ...(id === undefined ? {} : { result: id }),
      callee,
      args,
      effects,
      source,
    });
    return id;
  }

  return(value: ValueId | undefined, source: SourceSpan): void {
    this.push(value === undefined ? { kind: "return", source } : { kind: "return", value, source });
  }

  throw(value: ValueId, source: SourceSpan): void {
    this.push({ kind: "throw", value, source });
  }

  /**
   * `if (cond) then else otherwise`, each callback appending its branch's
   * operations. With a `result` type, each branch yields a value of it,
   * which the `if` gives.
   */
  if(
    cond: ValueId,
    source: SourceSpan,
    then: () => void,
    otherwise: () => void,
    result?: LType,
  ): ValueId | undefined {
    const [thenRegion, elseRegion] = [this.region(), this.region()];

    this.within(thenRegion, then);
    this.within(elseRegion, otherwise);

    const id = result && this.value(result, source);

    this.push({
      kind: "if",
      ...(id === undefined ? {} : { result: id }),
      cond,
      whenTrue: thenRegion.id,
      whenFalse: elseRegion.id,
      source,
    });
    return id;
  }

  /** A loop: `body` repeats, and `next` (when given) runs after it and on `continue`. */
  loop(
    source: SourceSpan,
    body: (loop: TargetId) => void,
    next?: (loop: TargetId) => void,
  ): TargetId {
    const target = this.targets++ as TargetId;
    const bodyRegion = this.region();
    const nextRegion = next && this.region();

    this.within(bodyRegion, () => body(target));

    if (nextRegion) this.within(nextRegion, () => next!(target));

    this.push({
      kind: "loop",
      target,
      body: bodyRegion.id,
      ...(nextRegion ? { next: nextRegion.id } : {}),
      source,
    });
    return target;
  }

  /** A scope of its own; when `breakable`, a target that `break` leaves. */
  block(source: SourceSpan, body: (block?: TargetId) => void, breakable = false): void {
    const target = breakable ? (this.targets++ as TargetId) : undefined;
    const region = this.region();

    this.within(region, () => body(target));
    this.push({
      kind: "block",
      ...(target === undefined ? {} : { target }),
      body: region.id,
      source,
    });
  }

  break(target: TargetId, source: SourceSpan): void {
    this.push({ kind: "break", target, source });
  }

  continue(target: TargetId, source: SourceSpan): void {
    this.push({ kind: "continue", target, source });
  }

  /** Ends a branch of an `if` giving a result. */
  yield(value: ValueId | undefined, source: SourceSpan): void {
    this.push(value === undefined ? { kind: "yield", source } : { kind: "yield", value, source });
  }

  /** The function built, with `effects` when an analysis knows them (else as its body proves). */
  finish(effects?: EffectSummary): IrFunction {
    const parts = {
      values: [...this.values],
      regions: this.regions.map((r) => ({ ...r, ops: [...r.ops] })),
      modulePlaces: [...this.modulePlaces],
      async: this.async,
    };

    return {
      id: this.id,
      params: [...this.params],
      result: this.result,
      body: this.body.id,
      ...parts,
      effects: effects ?? conservativeEffects(parts),
      source: this.source,
    };
  }

  private push(op: IrOp): void {
    this.cursor.ops.push(op);
  }

  /** A new region inside the one being built. */
  private region(): IrRegion {
    const region: IrRegion = {
      id: this.regions.length as RegionId,
      ops: [],
      parent: this.cursor.id,
    };

    this.regions.push(region);
    return region;
  }

  /** Runs `build` appending to `region`. */
  private within(region: IrRegion, build: () => void): void {
    const saved = this.cursor;

    this.cursor = region;

    try {
      build();
    } finally {
      this.cursor = saved;
    }
  }

  private value(type: LType, source: SourceSpan): ValueId {
    const id = this.values.length as ValueId;
    this.values.push({ id, type, source });
    return id;
  }

  private place(type: LType): PlaceId {
    const id = this.placeTypes.length as PlaceId;
    this.placeTypes.push(type);
    return id;
  }
}

/** Nothing known: every field at its most conservative. */
const UNKNOWN: EffectSummary = {
  reads: "unknown",
  writes: "unknown",
  allocates: "unknown",
  throws: "unknown",
  suspends: true,
  callbacks: "unknown",
  affinity: "unknown",
  native: "unknown",
};

/** Operations that neither touch module state, throw nor call out. */
const PURE = new Set<IrOp["kind"]>([
  "const",
  "param",
  "unary",
  "binary",
  "local",
  "load",
  "store",
  "return",
  "if",
  "loop",
  "block",
  "break",
  "continue",
  "yield",
]);

/**
 * What a function may do, as known without analysing its callees: a body
 * of arithmetic on numbers and booleans, its own locals and constant
 * module variables proves itself pure (string operations allocate),
 * everything else stays unknown. A function that is not async cannot
 * suspend.
 */
export function conservativeEffects(
  fn: Pick<IrFunction, "regions" | "values" | "modulePlaces" | "async">,
): EffectSummary {
  const module = new Set(fn.modulePlaces.filter((p) => p.mutable).map((p) => p.place));
  const allocates = (op: IrOp) =>
    (op.kind === "unary" || op.kind === "binary") && fn.values[op.result]?.type.k === "string";
  const pure = (op: IrOp) => {
    const place = placeOf(op);

    return PURE.has(op.kind) && !allocates(op) && (place === undefined || !module.has(place));
  };

  if (!fn.regions.every((r) => r.ops.every(pure))) return { ...UNKNOWN, suspends: fn.async };

  return {
    reads: "none",
    writes: "none",
    allocates: false,
    throws: "no",
    suspends: fn.async,
    callbacks: "none",
    affinity: "any",
    native: "none",
  };
}
