/**
 * Builds IR functions: allocates ids and appends operations in evaluation
 * order, to the region being built (the body, or a region of an `if`,
 * `loop` or `block` while its callback runs).
 */
import { type LType, T } from "../types.ts";
import {
  binaryResult,
  type BinaryOp,
  completes,
  type Callee,
  type CaptureSource,
  type Constant,
  constantType,
  type EffectRef,
  type EffectSummary,
  type FunctionId,
  type IrCapture,
  type IrFunction,
  type IntKind,
  intKindOf,
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
  private readonly captures: IrCapture[] = [];
  private readonly placeTypes: LType[] = [];
  /** The places held in integer registers, by their kind. */
  private readonly placeInts = new Map<PlaceId, IntKind>();
  /** The arrays held as integer elements, by their kind. */
  private readonly placeElements = new Map<PlaceId, IntKind>();
  private readonly params: ValueId[] = [];
  private readonly body: IrRegion;
  /** The region operations are appended to. */
  private cursor: IrRegion;
  private targets = 0;
  private readonly id: FunctionId;
  private readonly result: LType;
  private readonly source: SourceSpan;
  private readonly async: boolean;
  private readonly generator?: LType;
  /** The name the Errors the function makes record as their site. */
  site?: string;
  /** Code it computes from outside its own span (`IrFunction.elsewhere`). */
  readonly elsewhere: SourceSpan[] = [];

  constructor(id: FunctionId, result: LType, source: SourceSpan, async = false, generator?: LType) {
    this.id = id;
    this.result = result;
    this.source = source;
    this.async = async;
    this.generator = generator;
    this.body = { id: 0 as RegionId, ops: [] };
    this.cursor = this.body;
    this.regions.push(this.body);
  }

  typeOf(v: ValueId): LType {
    const value = this.values[v];

    if (!value) throw new Error(`IR value v${v} does not exist`);

    return value.type;
  }

  /** The integer kind `v` is an exact integer of, if any. */
  intOf(v: ValueId): IntKind | undefined {
    return this.values[v]?.int;
  }

  /** The integer kind of the elements `v`, an array, holds as such, if any. */
  elementsOf(v: ValueId): IntKind | undefined {
    return this.values[v]?.elements;
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

  /** Whether the body built so far can reach its end (see `completes`). */
  get completes(): boolean {
    return completes({ regions: this.regions }, this.body.id);
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
    return this.exact(result);
  }

  unary(op: UnaryOp, operand: ValueId, source: SourceSpan): ValueId {
    const type = unaryResult(op, this.typeOf(operand));

    if (!type) throw new Error(`IR: ${op} does not take v${operand}`);

    const result = this.value(type, source);
    this.push({ kind: "unary", result, op, operand, source });
    return this.exact(result);
  }

  binary(op: BinaryOp, left: ValueId, right: ValueId, source: SourceSpan): ValueId {
    const type = binaryResult(op, this.typeOf(left), this.typeOf(right));

    if (!type) throw new Error(`IR: ${op} does not take v${left}, v${right}`);

    const result = this.value(type, source);
    this.push({ kind: "binary", result, op, left, right, source });
    return this.exact(result);
  }

  /** `v`, just defined by the last operation, marked an exact integer when that gives one. */
  private exact(v: ValueId): ValueId {
    const op = this.cursor.ops[this.cursor.ops.length - 1]!;
    const kind = intKindOf(op, this.typeOf(v));

    if (kind) this.values[v]!.int = kind;

    return v;
  }

  convert(input: ValueId, to: LType, source: SourceSpan): ValueId {
    const result = this.value(to, source);
    this.push({ kind: "convert", result, input, to, source });
    return result;
  }

  local(
    name: string,
    type: LType,
    source: SourceSpan,
    boxed = false,
    int?: IntKind,
    spelled?: string,
    elements?: IntKind,
  ): PlaceId {
    const place = this.place(type);

    if (int) this.placeInts.set(place, int);

    if (elements) this.placeElements.set(place, elements);

    this.push({
      kind: "local",
      place,
      type,
      name,
      ...(spelled ? { spelled } : {}),
      ...(boxed ? { boxed } : {}),
      ...(int ? { int } : {}),
      ...(elements ? { elements } : {}),
      source,
    });
    return place;
  }

  /** A variable of an enclosing function this closure uses, declared at entry. */
  capture(name: string, type: LType, boxed: boolean, spelled?: string): PlaceId {
    const place = this.place(type);
    this.captures.push({ place, name, type, boxed, ...(spelled ? { spelled } : {}) });
    return place;
  }

  /** A function value made of the nested function `fn`, its captures from `from`; entering a mount. */
  closure(
    fn: IrFunction,
    from: CaptureSource[],
    type: LType,
    source: SourceSpan,
    enters?: ValueId,
  ): ValueId {
    const result = this.value(type, source);
    this.push({
      kind: "closure",
      result,
      fn,
      from,
      ...(enters === undefined ? {} : { enters }),
      source,
    });
    return result;
  }

  /** Waits for `promise`, giving what it fulfils with as a `result` (none for void). */
  await(promise: ValueId, result: LType | undefined, source: SourceSpan): ValueId | undefined {
    const id = result && this.value(result, source);
    this.push({ kind: "await", ...(id === undefined ? {} : { result: id }), promise, source });
    return id;
  }

  /** Gives the generator's caller `value`. */
  produce(value: ValueId, source: SourceSpan): void {
    this.push({ kind: "produce", value, source });
  }

  unreachable(source: SourceSpan): void {
    this.push({ kind: "unreachable", source });
  }

  /** The value of what never completes: the operation before it always throws. */
  never(source: SourceSpan): ValueId {
    const result = this.value(T.never, source);
    this.push({ kind: "never", result, source });
    return result;
  }

  /** A module variable, declared with the function rather than in its body. */
  modulePlace(symbol: string, name: string, type: LType, mutable: boolean): PlaceId {
    const known = this.modulePlaces.find((p) => p.symbol === symbol);

    if (known) return known.place;

    const place = this.place(type);
    this.modulePlaces.push({ place, symbol, name, type, mutable });
    return place;
  }

  /** The type of what `place` holds. */
  placeType(place: PlaceId): LType {
    const type = this.placeTypes[place];

    if (!type) throw new Error(`IR place p${place} does not exist`);

    return type;
  }

  load(place: PlaceId, source: SourceSpan): ValueId {
    const type = this.placeTypes[place];

    if (!type) throw new Error(`IR place p${place} does not exist`);

    const result = this.value(type, source);
    const int = this.placeInts.get(place);
    const elements = this.placeElements.get(place);

    if (int) this.values[result]!.int = int;

    if (elements) this.values[result]!.elements = elements;

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

  /** A plan: the backend's `code` on `args`; `result` is the type it gives, absent when it gives nothing. */
  plan(
    name: string,
    code: unknown,
    args: ValueId[],
    result: LType | undefined,
    source: SourceSpan,
    int?: { code: unknown; kind: IntKind },
    elements?: IntKind,
  ): ValueId | undefined {
    const id = result && this.value(result, source);
    const exact = id !== undefined && int && result?.k === "number" ? int : undefined;

    if (exact) this.values[id!]!.int = exact.kind;

    if (id !== undefined && elements) this.values[id]!.elements = elements;

    this.push({
      kind: "plan",
      ...(id === undefined ? {} : { result: id }),
      name,
      code,
      args,
      ...(exact ? { int: exact } : {}),
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

  /**
   * `cond ? absent : present`, whose result type comes from what `present`
   * gives (built first): `result` makes it of `present`'s type, and each
   * branch converts its value (`absent` a value of the type, `convert` the
   * one `present` gave) to it.
   */
  choose(
    cond: ValueId,
    source: SourceSpan,
    present: () => ValueId,
    result: (given: LType) => LType,
    absent: (type: LType) => ValueId,
    convert: (given: ValueId, type: LType) => ValueId,
  ): ValueId {
    const [thenRegion, elseRegion] = [this.region(), this.region()];
    let given!: ValueId;

    this.within(elseRegion, () => {
      given = present();
    });

    const type = result(this.typeOf(given));
    const ended = () => {
      const last = elseRegion.ops[elseRegion.ops.length - 1];

      return last !== undefined && isTerminator(last);
    };

    // What gave the value may never complete (it throws): the branch ends there.
    if (!ended()) this.within(elseRegion, () => this.yield(convert(given, type), source));

    this.within(thenRegion, () => this.yield(absent(type), source));

    const id = this.value(type, source);

    this.push({
      kind: "if",
      result: id,
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

  /** `for … of`: `body` runs for each element of `iterable`, which it gets as a value. */
  iterate(
    source: SourceSpan,
    iterable: ValueId,
    elementType: LType,
    body: (target: TargetId, element: ValueId) => void,
  ): void {
    const target = this.targets++ as TargetId;
    const region = this.region();
    const element = this.value(elementType, source);

    this.within(region, () => body(target, element));
    this.push({ kind: "iterate", target, iterable, element, body: region.id, source });
  }

  /**
   * `try`: `body`, then `onError` with the error when it throws, and
   * `onExit` however they are left.
   */
  try(
    source: SourceSpan,
    body: () => void,
    onError?: (error: ValueId) => void,
    onExit?: () => void,
  ): void {
    const region = this.region();

    this.within(region, body);

    let caught: { region: RegionId; error: ValueId } | undefined;

    if (onError) {
      const handler = this.region();
      const error = this.value(T.error, source);

      this.within(handler, () => onError(error));
      caught = { region: handler.id, error };
    }

    const final = onExit && this.region();

    if (final) this.within(final, onExit!);

    this.push({
      kind: "try",
      body: region.id,
      ...(caught ? { catch: caught } : {}),
      ...(final ? { finally: final.id } : {}),
      source,
    });
  }

  /** Disposes `value` with the backend's `code`, in a `finally` region. */
  dispose(value: ValueId, code: unknown, source: SourceSpan): void {
    this.push({ kind: "dispose", value, code, source });
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
      captures: [...this.captures],
      async: this.async,
      ...(this.generator ? { generator: this.generator } : {}),
      ...(this.site ? { site: this.site } : {}),
      ...(this.elsewhere.length ? { elsewhere: [...this.elsewhere] } : {}),
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
  "unreachable",
  "never",
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
